#!/usr/bin/env python3
"""Reset only the managed production Orchard player database after release QA.

Inputs must come from the reviewed commit's raw Git blobs and static package.
There is deliberately no --db, --host or service override and no default SHA.
Backups contain private player data: keep them root-only for rollback.
"""
import argparse
import concurrent.futures
import contextlib
import hashlib
import json
import os
import re
import secrets
import signal
import sqlite3
import stat
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path, PurePosixPath


ORIGIN = "https://111.230.149.65"
STATIC_OPS = Path("/opt/orchard-site")
STATIC_BASE = Path("/var/www/orchard-guardians")
OPS = Path("/opt/orchard-world")
DATA = Path("/var/lib/orchard-world")
DATABASE = DATA / "world.sqlite"
SERVICE = "orchard-world.service"
UNIT = Path("/etc/systemd/system") / SERVICE
WORLD_MARKER = "orchard-world-managed-v1"
EPOCH_KEY = "player_data_epoch"
PLAYER_TABLES = ("sessions", "requests", "campaign_completions", "campaigns", "reports", "plots", "guilds", "players")
TABLE_COLUMNS = {
    "metadata": ("key", "value"),
    "players": ("id", "name", "salt", "password_hash", "payload"),
    "sessions": ("token_hash", "player_id", "expires_at"),
    "plots": ("x", "y", "player_id"),
    "guilds": ("id", "name", "owner_id", "payload"),
    "requests": ("player_id", "request_id", "fingerprint", "result", "at"),
    "campaigns": ("ticket", "player_id", "stage", "started_at", "expires_at", "claimed_at", "result"),
    "campaign_completions": ("ticket", "player_id", "stage", "completed_at"),
    "reports": ("id", "at", "attacker_id", "defender_id", "payload"),
}
MAX_TOTAL_BYTES = 100 * 1024 * 1024


class ResetError(RuntimeError):
    pass


def require(condition, message):
    if not condition:
        raise ResetError(message)


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def valid_epoch(value):
    return value == "initial" or isinstance(value, str) and re.fullmatch(r"reset-[0-9a-f]{32}", value) is not None


def safe_ancestors(path):
    path = Path(path).absolute()
    for parent in reversed((path, *path.parents)):
        require(not parent.is_symlink(), "Unexpected symlink at managed path: " + str(parent))


def regular_file(path, uid=None, private=False):
    safe_ancestors(path)
    info = path.lstat()
    require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1, "Expected one regular managed file: " + str(path))
    require(uid is None or info.st_uid == uid, "Unexpected file owner: " + str(path))
    require(not private or not info.st_mode & 0o077, "Private file has non-owner permissions: " + str(path))
    return info


def check_marker(directory, name, content=None, uid=None):
    safe_ancestors(directory)
    require(directory.is_dir(), "Managed directory is missing: " + str(directory))
    marker = directory / name
    regular_file(marker, uid=uid)
    if content is not None:
        require(marker.stat().st_size <= 128 and marker.read_text().strip() == content,
                "Managed owner marker mismatch: " + str(directory))


def manifest_fingerprint(manifest):
    signed = {key: manifest[key] for key in ("version", "fileCount", "totalBytes", "files")}
    return sha256(json.dumps(signed, separators=(",", ":"), ensure_ascii=False).encode("utf-8"))


def validate_manifest(root, expected):
    safe_ancestors(root)
    require(root.is_dir(), "Static release is missing.")
    manifest_path = root / "static-manifest.json"
    regular_file(manifest_path, uid=0 if sys.platform.startswith("linux") and os.geteuid() == 0 else None)
    require(manifest_path.stat().st_size <= 1024 * 1024, "Static manifest is oversized.")
    manifest = json.loads(manifest_path.read_bytes())
    require(manifest_fingerprint(manifest) == expected, "Static manifest differs from reviewed raw-Git package.")
    require(manifest["version"] == 1 and type(manifest["fileCount"]) is int and 0 < manifest["fileCount"] <= 2048
            and isinstance(manifest["files"], list) and len(manifest["files"]) == manifest["fileCount"],
            "Invalid static manifest shape.")
    files, directories, total = {"static-manifest.json"}, set(), 0
    for item in manifest["files"]:
        require(isinstance(item, dict) and set(item) == {"path", "bytes", "sha256"}, "Invalid runtime entry.")
        name = item["path"]
        require(isinstance(name, str) and name and "\\" not in name and ":" not in name
                and not any(ord(char) < 32 or ord(char) == 127 for char in name), "Unsafe runtime path.")
        relative = PurePosixPath(name)
        require(not relative.is_absolute() and relative.as_posix() == name
                and all(part not in ("", ".", "..") and not part.startswith(".") for part in relative.parts)
                and name not in files, "Duplicate or unsafe runtime path.")
        require(type(item["bytes"]) is int and 0 <= item["bytes"] <= 50 * 1024 * 1024
                and isinstance(item["sha256"], str) and re.fullmatch(r"[0-9a-f]{64}", item["sha256"]),
                "Invalid runtime hash or size.")
        files.add(name)
        directories.update(str(parent) for parent in relative.parents if str(parent) != ".")
        path = root / name
        regular_file(path)
        require(path.stat().st_size == item["bytes"] and sha256(path.read_bytes()) == item["sha256"],
                "Static runtime differs from reviewed Git bytes: " + name)
        total += item["bytes"]
    require(total == manifest["totalBytes"] and total <= MAX_TOTAL_BYTES, "Static release totals are invalid.")
    actual_files, actual_dirs = set(), set()
    for path in root.rglob("*"):
        require(not path.is_symlink(), "Static release contains a symlink.")
        name = path.relative_to(root).as_posix()
        if path.is_file():
            actual_files.add(name)
        elif path.is_dir():
            actual_dirs.add(name)
        else:
            raise ResetError("Static release contains a special file.")
    require(actual_files == files and actual_dirs == directories, "Static release inventory mismatch.")
    require("online-reset.js" in files, "Deploy the browser data-reset guard before resetting players.")
    return manifest


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, newurl):
        raise ResetError("HTTPS verification redirected; no reset permitted.")


def public_bytes(path, limit, *, payload=None, epoch=None):
    require(path.startswith("/") and not path.startswith("//"), "Invalid fixed verification URL.")
    url = ORIGIN + path
    headers = {"Accept": "application/json", "Cache-Control": "no-cache", "Connection": "close"}
    if payload is not None:
        headers.update({"Content-Type": "application/json", "Origin": ORIGIN})
    if epoch is not None:
        headers["X-Orchard-Data-Epoch"] = epoch
    request = urllib.request.Request(url, data=None if payload is None else json.dumps(payload).encode(), headers=headers)
    # No proxy environment, redirects, cookie jar or unverified SSL context.
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    try:
        response = opener.open(request, timeout=20)
    except urllib.error.HTTPError as error:
        if payload is None:
            raise ResetError("Public verification returned HTTP " + str(error.code)) from None
        response = error
    with response:
        require(response.geturl() == url, "Unexpected HTTPS verification origin.")
        body = response.read(limit + 1)
        require(len(body) <= limit, "Oversized public verification response.")
        return response.status, body


def public_json(path, **kwargs):
    status, body = public_bytes(path, 2 * 1024 * 1024, **kwargs)
    return status, json.loads(body)


def verify_public_release(root, manifest):
    manifest_path = root / "static-manifest.json"
    status, body = public_bytes("/orchard/static-manifest.json", 1024 * 1024)
    require(status == 200 and body == manifest_path.read_bytes(), "Public static manifest differs from active local release.")
    def check(item):
        path = "/orchard/" + urllib.parse.quote(item["path"], safe="/")
        status, body = public_bytes(path, item["bytes"])
        require(status == 200 and len(body) == item["bytes"] and sha256(body) == item["sha256"],
                "Public runtime mismatch: " + item["path"])
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as workers:
        list(workers.map(check, manifest["files"]))
    status, health = public_json("/api/world/health")
    require(status == 200 and health.get("ok") is True and health.get("version") == "orchard-world-1"
            and health.get("storage") == "sqlite" and valid_epoch(health.get("dataEpoch")),
            "The deployed backend data-reset guard is not ready.")
    return health["dataEpoch"]


def run(*args):
    result = subprocess.run(args, capture_output=True, text=True, timeout=30, check=False,
                            env={"PATH": "/usr/sbin:/usr/bin:/sbin:/bin", "LANG": "C.UTF-8"})
    require(result.returncode == 0, "Managed service command failed: " + " ".join(args[:2]))
    return result.stdout.strip()


def service_property(name):
    return run("systemctl", "show", SERVICE, "--property=" + name, "--value")


def verify_service(commit, backend_sha256):
    import pwd
    import grp
    account, group = pwd.getpwnam("orchardworld"), grp.getgrnam("orchardworld")
    require(account.pw_uid != 0 and account.pw_dir == "/nonexistent"
            and account.pw_shell in ("/sbin/nologin", "/usr/sbin/nologin")
            and group.gr_gid == account.pw_gid and not group.gr_mem, "Unexpected service identity.")
    check_marker(OPS, ".orchard-world-managed", WORLD_MARKER, uid=0)
    check_marker(DATA, ".orchard-world-managed", WORLD_MARKER, uid=account.pw_uid)
    info = DATA.stat()
    require(info.st_uid == account.pw_uid and not info.st_mode & 0o077, "Unsafe world data directory.")
    for item in DATA.iterdir():
        require(item.name in {".orchard-world-managed", "world.sqlite", "world.sqlite-wal", "world.sqlite-shm"},
                "Unexpected file in managed world data directory.")
        regular_file(item, uid=account.pw_uid, private=True)
    regular_file(DATABASE, uid=account.pw_uid, private=True)
    regular_file(UNIT, uid=0)
    unit = UNIT.read_text()
    require("# Managed by Orchard Guardians World." in unit.splitlines(), "Unmanaged service unit.")
    for name, expected in (("FragmentPath", str(UNIT)), ("User", "orchardworld"), ("Group", "orchardworld"),
                           ("WorkingDirectory", str(OPS)), ("ActiveState", "active")):
        require(service_property(name) == expected, "Unexpected active world service " + name)
    require(not service_property("DropInPaths"), "World service has unreviewed unit overrides.")
    current = OPS / "current"
    require(current.is_symlink() and current.resolve(strict=True) == OPS / "releases" / commit,
            "Active backend is not the reviewed deployment commit.")
    release = current.resolve(strict=True)
    safe_ancestors(release)
    require({item.name for item in release.iterdir()} == {".orchard-world-release", "world-server.py"},
            "Unexpected backend release inventory.")
    for item in release.iterdir():
        regular_file(item, uid=0)
    require((release / ".orchard-world-release").read_text().strip() == commit, "Backend release marker mismatch.")
    source = (release / "world-server.py").read_bytes()
    require(sha256(source) == backend_sha256 and all(word in source for word in
            (b"player_data_epoch", b"data_reset", b"X-Orchard-Data-Epoch")), "Backend differs from reviewed reset-enabled Git blob.")
    pid = service_property("MainPID")
    require(pid.isdigit() and int(pid) > 0, "Cannot identify running backend process.")
    process = Path("/proc") / pid
    command = [value.decode() for value in (process / "cmdline").read_bytes().split(b"\0") if value]
    arguments = [str(current / "world-server.py"), "--host", "127.0.0.1", "--port", "8766", "--db", str(DATABASE),
                 "--site", str(STATIC_BASE / "orchard"), "--public-origin", ORIGIN, "--secure-cookie"]
    require(len(command) == len(arguments) + 1 and command[1:] == arguments
            and process.stat().st_uid == account.pw_uid, "Running backend does not use the fixed managed database and site.")
    listener = run("ss", "-Hlnpt", "sport = :8766")
    lines = listener.splitlines()
    require(lines and all("127.0.0.1:8766" in line and re.findall(r"\bpid=(\d+)", line)
                        and set(re.findall(r"\bpid=(\d+)", line)) == {pid} for line in lines),
            "Backend listener belongs to an unexpected process.")
    return account.pw_uid, account.pw_gid


@contextlib.contextmanager
def deployment_locks():
    import fcntl
    descriptors = []
    try:
        for directory in (STATIC_OPS, OPS):
            path = directory / "deploy.lock"
            safe_ancestors(path)
            fd = os.open(path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600)
            descriptors.append(fd)
            info = os.fstat(fd)
            require(stat.S_ISREG(info.st_mode) and info.st_uid == 0 and info.st_nlink == 1
                    and not info.st_mode & 0o022, "Unsafe deployment lock.")
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise ResetError("A deployment/renewal is in progress; no player data changed.") from None
        yield
    finally:
        for fd in reversed(descriptors):
            os.close(fd)


def database_connection(path):
    return sqlite3.connect(path.as_uri() + "?mode=rw", uri=True, timeout=15)


def verify_schema(connection):
    require(connection.execute("PRAGMA integrity_check").fetchall() == [("ok",)], "Database integrity check failed.")
    actual = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")}
    require(actual == set(TABLE_COLUMNS), "Unexpected database tables; manual migration review required.")
    for table, columns in TABLE_COLUMNS.items():
        require(tuple(row[1] for row in connection.execute("PRAGMA table_info(" + table + ")")) == columns,
                "Unexpected schema in managed table: " + table)
    require(not connection.execute("SELECT 1 FROM sqlite_master WHERE type='trigger' LIMIT 1").fetchone(),
            "Unexpected database triggers.")
    require(connection.execute("SELECT value FROM metadata WHERE key='schema'").fetchone() == ("1",), "Unexpected database schema version.")
    row = connection.execute("SELECT value FROM metadata WHERE key=?", (EPOCH_KEY,)).fetchone()
    require(row and valid_epoch(row[0]), "Reset-enabled metadata is missing.")
    return row[0]


def table_counts(connection):
    return {table: connection.execute("SELECT COUNT(*) FROM " + table).fetchone()[0] for table in PLAYER_TABLES}


def backup_database(database, destination):
    require(not destination.exists() and not destination.is_symlink(), "Backup destination already exists.")
    with contextlib.closing(database_connection(database)) as source:
        epoch = verify_schema(source)
        counts = table_counts(source)
        with contextlib.closing(sqlite3.connect(destination)) as backup:
            source.backup(backup)
            require(verify_schema(backup) == epoch and table_counts(backup) == counts, "Consistent SQLite backup failed.")
    os.chmod(destination, 0o600)
    return epoch, counts


def reset_database(database, expected_epoch, new_epoch):
    require(re.fullmatch(r"reset-[0-9a-f]{32}", new_epoch) and expected_epoch != new_epoch, "Invalid new player-data epoch.")
    with contextlib.closing(database_connection(database)) as connection:
        require(verify_schema(connection) == expected_epoch, "Database epoch changed after verification.")
        connection.execute("PRAGMA secure_delete=ON")
        connection.execute("BEGIN IMMEDIATE")
        try:
            for table in PLAYER_TABLES:
                connection.execute("DELETE FROM " + table)
            connection.execute("UPDATE metadata SET value=? WHERE key=?", (new_epoch, EPOCH_KEY))
            require(not any(table_counts(connection).values()), "Player data was not fully cleared.")
            connection.commit()
        except BaseException:
            connection.rollback()
            raise
        connection.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        connection.execute("VACUUM")
        connection.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        require(verify_schema(connection) == new_epoch and not any(table_counts(connection).values()),
                "Database verification after reset failed.")


def restore_database(database, backup):
    with contextlib.closing(database_connection(backup)) as source:
        expected_epoch, expected_counts = verify_schema(source), table_counts(source)
        with contextlib.closing(database_connection(database)) as target:
            source.backup(target)
            target.execute("PRAGMA wal_checkpoint(TRUNCATE)")
            require(verify_schema(target) == expected_epoch and table_counts(target) == expected_counts,
                    "SQLite rollback verification failed; retain backup and leave service stopped.")


def fix_database_permissions(uid, gid):
    for name in ("world.sqlite", "world.sqlite-wal", "world.sqlite-shm"):
        path = DATA / name
        if path.exists() or path.is_symlink():
            regular_file(path)
            os.chown(path, uid, gid)
            os.chmod(path, 0o600)


def verify_empty_public(new_epoch, old_epoch):
    last_error = None
    for _ in range(8):
        try:
            status, health = public_json("/api/world/health")
            require(status == 200 and health.get("ok") is True and health.get("dataEpoch") == new_epoch,
                    "Public backend has not adopted the new data epoch.")
            status, result = public_json("/api/world/state")
            state = result.get("state", {})
            require(status == 200 and result.get("ok") is True and state.get("self") is None
                    and all(state.get(key) == [] for key in ("players", "guilds", "reports"))
                    and state.get("map", {}).get("cells") == [], "Public world player data is not empty.")
            status, result = public_json("/api/world/leaderboard?page=1")
            board = result.get("leaderboard", {})
            require(status == 200 and result.get("ok") is True and board.get("entries") == []
                    and board.get("self") is None and board.get("totalPlayers") == 0,
                    "Public leaderboard is not empty.")
            # Empty name/password cannot register under either epoch; test only
            # the old-tab rejection, never a real account or score mutation.
            status, guard = public_json("/api/world/enter", payload={"name": "", "password": ""}, epoch=old_epoch)
            require(status == 409 and guard.get("code") == "data_reset", "Old browser writes are not blocked.")
            return
        except (ResetError, OSError, ValueError) as error:
            last_error = error
            time.sleep(0.5)
    raise ResetError("Public reset verification failed: " + str(last_error))


def execute(arguments):
    require(sys.platform.startswith("linux") and os.geteuid() == 0, "Run only in the original Linux server root terminal.")
    os.umask(0o077)
    check_marker(STATIC_OPS, ".orchard-managed", uid=0)
    check_marker(STATIC_BASE, ".orchard-managed", uid=0)
    check_marker(OPS, ".orchard-world-managed", WORLD_MARKER, uid=0)
    with deployment_locks():
        uid, gid = verify_service(arguments.commit, arguments.backend_sha256)
        link = STATIC_BASE / "orchard"
        require(link.is_symlink() and link.resolve(strict=True) == STATIC_BASE / "releases" / arguments.commit,
                "The active static release is not the reviewed deployment commit.")
        release = link.resolve(strict=True)
        manifest = validate_manifest(release, arguments.manifest_sha256)
        old_epoch = verify_public_release(release, manifest)
        # Recheck paths/service after the longer public all-resource audit.
        require(link.resolve(strict=True) == release, "Static release changed during verification.")
        require(verify_service(arguments.commit, arguments.backend_sha256) == (uid, gid), "Service identity changed.")
        backups = OPS / "backups"
        safe_ancestors(backups)
        require(backups.is_dir() and backups.stat().st_uid == 0 and not backups.stat().st_mode & 0o077,
                "Private managed backups directory is missing.")
        backup = Path(tempfile.mkdtemp(prefix="reset-", dir=backups))
        os.chmod(backup, 0o700)
        saved_database = backup / "world.sqlite"
        new_epoch = "reset-" + secrets.token_hex(16)
        audit = {"commit": arguments.commit, "manifestSha256": arguments.manifest_sha256,
                 "backendSha256": arguments.backend_sha256, "oldEpoch": old_epoch, "newEpoch": new_epoch,
                 "startedAt": int(time.time()), "status": "verified-deployment"}
        (backup / "service").write_bytes(UNIT.read_bytes())
        audit_path = backup / "reset-audit.json"
        def save_audit():
            audit_path.write_text(json.dumps(audit, ensure_ascii=False, indent=2) + "\n")
        save_audit()
        stopped, changed, complete = False, False, False
        try:
            # This is the first production mutation: all preflight checks passed.
            print("DEPLOYMENT_VERIFIED; stopping only " + SERVICE, flush=True)
            stopped = True
            run("systemctl", "stop", SERVICE)
            require(service_property("ActiveState") == "inactive" and service_property("MainPID") == "0",
                    "World service did not fully stop.")
            require(not run("ss", "-Hlnpt", "sport = :8766"), "Backend listener remains active.")
            saved_epoch, counts = backup_database(DATABASE, saved_database)
            require(saved_epoch == old_epoch, "Backend and database epochs differ.")
            audit.update({"countsBefore": counts, "backupSha256": sha256(saved_database.read_bytes()), "status": "backup-ready"})
            save_audit()
            changed = True
            reset_database(DATABASE, old_epoch, new_epoch)
            fix_database_permissions(uid, gid)
            run("systemctl", "start", SERVICE)
            verify_service(arguments.commit, arguments.backend_sha256)
            verify_empty_public(new_epoch, old_epoch)
            audit.update({"status": "reset-complete", "completedAt": int(time.time()), "sessionsRevoked": counts["sessions"]})
            save_audit()
            complete = True
            print("PLAYER_DATA_RESET_OK " + ORIGIN + "/orchard/", flush=True)
            print("Data epoch: " + new_epoch + "\nPrivate rollback backup: " + str(backup), flush=True)
            print("Cleared table counts: " + json.dumps(counts, separators=(",", ":")), flush=True)
        finally:
            if stopped and not complete:
                try:
                    run("systemctl", "stop", SERVICE)
                    require(service_property("MainPID") == "0" and not run("ss", "-Hlnpt", "sport = :8766"),
                            "Cannot safely restore while backend remains running.")
                    if changed:
                        restore_database(DATABASE, saved_database)
                    fix_database_permissions(uid, gid)
                    run("systemctl", "start", SERVICE)
                    audit["status"] = "failed-player-data-restored" if changed else "failed-no-player-data-changed"
                    save_audit()
                    print("RESET_FAILED; original player data retained/restored. Private backup: " + str(backup), file=sys.stderr)
                except BaseException:
                    audit["status"] = "rollback-needs-attention"
                    save_audit()
                    print("ROLLBACK_NEEDS_ATTENTION; private backup: " + str(backup)
                          + "; check the service before starting it.", file=sys.stderr)
                    raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--commit", required=True)
    parser.add_argument("--manifest-sha256", required=True, help="normalized raw-Git static manifest fingerprint")
    parser.add_argument("--backend-sha256", required=True, help="raw Git world-server.py SHA256")
    arguments = parser.parse_args()
    require(re.fullmatch(r"[0-9a-f]{40}", arguments.commit) and
            all(re.fullmatch(r"[0-9a-f]{64}", value) for value in (arguments.manifest_sha256, arguments.backend_sha256)),
            "Provide reviewed full commit and raw-byte SHA256 values.")
    def interrupted(signum, frame):
        raise KeyboardInterrupt
    signal.signal(signal.SIGTERM, interrupted)
    if hasattr(signal, "SIGHUP"):
        signal.signal(signal.SIGHUP, interrupted)
    execute(arguments)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("ERROR: reset interrupted; inspect the rollback status printed above.", file=sys.stderr)
        sys.exit(130)
    except (ResetError, OSError, ValueError, sqlite3.Error, subprocess.SubprocessError) as error:
        print("ERROR: " + str(error), file=sys.stderr)
        sys.exit(1)
