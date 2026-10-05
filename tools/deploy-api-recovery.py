#!/usr/bin/env python3
"""Recover one reviewed release through GitHub's raw Contents API, then use its installers.

No Git network transport or deployment-script edits are used. --prepare-only is
for isolated fixtures; actual deployment requires Linux root and managed paths.
"""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import signal
import ssl
import stat
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request

COMMIT = "5a4e9c8998d90d72f535bb3a797144aa1f7b504e"
TREE = "27cd1825bbac07261bd5cff87e6a831a70a511a8"
RUNTIME_FINGERPRINT = "3bb34c6f22159c48c3fac64d97a1fbde3e97e7151de2f6f88dd2d41527c51b36"
RUNTIME_FILES = 138
RUNTIME_BYTES = 23760091
REVIEWED_OBJECTS = 14
TRUSTED_CACHE = {
    "2dfd8d6017b9561191fc755282c697da161a484550a61585d8d7614d38d079bb",  # previous reviewed raw release
    "5b6e01e552d14e87b8a0d3baf43f668c491b123bddeb763123d3d9de6cbbfdce",  # c149 raw runtime
    "dc296d324445c1a42c4bc1977ac4e980561187e639091e2260f7cff62bdab516",
    "5635e6a321e78c6ee4c8d2c9b4cfc1522ce908a4bce1c5cd8821c6c328144152",
    "7ab2e63bf2a0ed0e5a0b385d94f7abd39d7afcbc926199cc394d5a2204cf6c00",  # previous reviewed roulette release
    "22bfad0d2c6b6dd8b4d73945e90b45fd7c34f6d79acdf47c4873eabefce2bcf0",  # previously deployed progressive growth release
    RUNTIME_FINGERPRINT,
    "c8c15291d877fd25457f9be8f684daaf5527f9db3d57fcf4bd60e59893a0af31",
    "7fa18ad8124df2a49971125d256dcb702807042d666f6d73d8af8dd8cb4a66a9",
}
SCRIPT_HASHES = {
    "tools/deploy-ip-site.sh": "56b4a09084bc5a675e045b1edd015e9a4fb4f208180f9c86809cab3f0e0b5c00",
    "tools/deploy-world-server.sh": "b9876bfe10c0a503d5568207cbf6d821902d13d1c16e16135bffb21403baf305",
}
EXTRA_FILES = {".gitattributes", "tools/package-site.cjs", "tools/package-site-verify.cjs",
               "tools/deploy-ip-site.sh", "tools/deploy-world-server.sh", "tools/world-server.py"}
REPO = "https://github.com/0706ziou/-.git"
API = "https://api.github.com/repos/0706ziou/-/contents/"
DEFAULT_CACHE = Path("/var/www/orchard-guardians/orchard")
MANAGED_BASE = Path("/var/www/orchard-guardians")
MANAGED_OPS = Path("/opt/orchard-site")
MAX_FILE_BYTES = 32 * 1024 * 1024
HEX40 = re.compile(r"[0-9a-f]{40}\Z")
HEX64 = re.compile(r"[0-9a-f]{64}\Z")


class RecoveryError(Exception):
    pass


def require(condition, message):
    if not condition:
        raise RecoveryError(message)


def sha256(payload):
    return hashlib.sha256(payload).hexdigest()


def git_oid(kind, payload):
    return hashlib.sha1(f"{kind} {len(payload)}\0".encode("ascii") + payload).hexdigest()


def safe_path(value, attributes=False):
    require(isinstance(value, str) and value and "\\" not in value and
            not any(ord(char) < 32 or ord(char) == 127 for char in value), "Unsafe release path.")
    path = PurePosixPath(value)
    require(not path.is_absolute() and str(path) == value and
            all(part not in (".", "..") and not part.startswith(".") for part in path.parts)
            or attributes and value == ".gitattributes", "Unsafe release path.")
    return value


def metadata(entry, attributes=False):
    require(isinstance(entry, dict), "Invalid file metadata.")
    safe_path(entry.get("path"), attributes)
    require(type(entry.get("bytes")) is int and 0 <= entry["bytes"] <= MAX_FILE_BYTES and
            isinstance(entry.get("sha256"), str) and HEX64.fullmatch(entry["sha256"]), "Invalid file size or hash.")


def normalized_manifest(manifest):
    require(isinstance(manifest, dict) and all(key in manifest for key in ("version", "fileCount", "totalBytes", "files")),
            "Invalid runtime manifest.")
    signed = {key: manifest[key] for key in ("version", "fileCount", "totalBytes", "files")}
    require(signed["version"] == 1 and type(signed["fileCount"]) is int and
            type(signed["totalBytes"]) is int and isinstance(signed["files"], list), "Invalid runtime manifest fields.")
    require(0 < signed["fileCount"] <= 200 and signed["fileCount"] == len(signed["files"]), "Invalid runtime file count.")
    paths = set()
    for entry in signed["files"]:
        metadata(entry)
        require(set(entry) == {"path", "bytes", "sha256"} and entry["path"] not in paths, "Duplicated or invalid runtime entry.")
        paths.add(entry["path"])
    require(sum(entry["bytes"] for entry in signed["files"]) == signed["totalBytes"], "Invalid runtime byte total.")
    fingerprint = sha256(json.dumps(signed, separators=(",", ":"), ensure_ascii=False).encode("utf-8"))
    return signed, fingerprint


def decode_objects(descriptor):
    records = descriptor.get("objects")
    require(isinstance(records, list) and len(records) == REVIEWED_OBJECTS,
            "Expected exactly the reviewed commit and tree inventory.")
    decoded = {}
    for item in records:
        require(isinstance(item, dict) and set(item) == {"type", "oid", "data"} and
                item["type"] in ("commit", "tree") and isinstance(item["oid"], str) and HEX40.fullmatch(item["oid"])
                and isinstance(item["data"], str) and len(item["data"]) <= 2 * 1024 * 1024, "Invalid reviewed Git object.")
        try:
            raw = base64.b64decode(item["data"], validate=True)
        except (ValueError, TypeError) as error:
            raise RecoveryError("Invalid Git object encoding.") from error
        require(len(raw) <= 1024 * 1024 and git_oid(item["type"], raw) == item["oid"] and
                item["oid"] not in decoded, "Reviewed Git object hash mismatch or duplicate.")
        decoded[item["oid"]] = (item["type"], raw)
    require(decoded.get(COMMIT, (None,))[0] == "commit" and
            sum(kind == "commit" for kind, _ in decoded.values()) == 1, "Descriptor is not the fixed reviewed commit.")
    require(decoded[COMMIT][1].split(b"\n", 1)[0] == f"tree {TREE}".encode("ascii"), "Reviewed commit tree mismatch.")
    require(descriptor.get("tree") == TREE, "Descriptor root tree mismatch.")
    files, visited = {}, set()

    def walk(oid, prefix="", depth=0):
        require(depth <= 12 and oid in decoded and decoded[oid][0] == "tree" and oid not in visited,
                "Missing, reused, or cyclic reviewed tree.")
        visited.add(oid)
        raw, offset = decoded[oid][1], 0
        while offset < len(raw):
            space = raw.find(b" ", offset)
            zero = raw.find(b"\0", space + 1)
            require(space > offset and zero > space + 1 and zero + 21 <= len(raw), "Malformed reviewed tree.")
            try:
                mode, name = raw[offset:space].decode("ascii"), raw[space + 1:zero].decode("utf-8")
            except UnicodeError as error:
                raise RecoveryError("Invalid reviewed tree entry.") from error
            require("/" not in name and "\\" not in name and name not in (".", "..") and
                    not any(ord(char) < 32 for char in name), "Unsafe reviewed tree name.")
            child = raw[zero + 1:zero + 21].hex()
            path = prefix + name
            require(path not in files, "Duplicated reviewed tree entry.")
            if mode == "40000":
                walk(child, path + "/", depth + 1)
            else:
                files[path] = (mode, child)
            offset = zero + 21
    walk(TREE)
    require(visited == {oid for oid, (kind, _) in decoded.items() if kind == "tree"}, "Unexpected unreferenced tree.")
    return decoded, files


def load_descriptor(path, expected_sha256):
    require(isinstance(expected_sha256, str) and HEX64.fullmatch(expected_sha256), "Supply the full reviewed descriptor SHA256.")
    path = Path(path)
    require(path.is_file() and not path.is_symlink() and path.stat().st_size <= 2 * 1024 * 1024, "Descriptor is not a small regular file.")
    raw = path.read_bytes()
    require(sha256(raw) == expected_sha256, "Descriptor SHA256 mismatch; nothing deployed.")
    try:
        descriptor = json.loads(raw)
    except (ValueError, UnicodeError) as error:
        raise RecoveryError("Invalid descriptor JSON.") from error
    return validate_descriptor(descriptor)


def validate_descriptor(descriptor):
    require(isinstance(descriptor, dict) and descriptor.get("version") == 1 and descriptor.get("commit") == COMMIT,
            "Descriptor version or reviewed commit mismatch.")
    signed, fingerprint = normalized_manifest(descriptor.get("runtime"))
    require(fingerprint == RUNTIME_FINGERPRINT == descriptor.get("runtimeFingerprint") and
            signed["fileCount"] == RUNTIME_FILES and signed["totalBytes"] == RUNTIME_BYTES, "Descriptor runtime differs from the reviewed release.")
    _objects, tree_files = decode_objects(descriptor)
    records = descriptor.get("files")
    require(isinstance(records, list) and len(records) == RUNTIME_FILES + len(EXTRA_FILES), "Expected exactly the reviewed runtime and installer files.")
    paths = set()
    runtime = {item["path"]: item for item in signed["files"]}
    for item in records:
        metadata(item, attributes=True)
        require(set(item) == {"path", "bytes", "sha256", "mode", "oid"} and item["path"] not in paths,
                "Unexpected or duplicate release file.")
        paths.add(item["path"])
        require(item["mode"] in ("100644", "100755") and isinstance(item["oid"], str) and HEX40.fullmatch(item["oid"])
                and tree_files.get(item["path"]) == (item["mode"], item["oid"]), "Release file is not anchored by its reviewed Git tree.")
        if item["path"] in runtime:
            require(all(item[key] == runtime[item["path"]][key] for key in ("path", "bytes", "sha256")), "Runtime metadata differs from the reviewed manifest.")
        if item["path"] in SCRIPT_HASHES:
            require(item["sha256"] == SCRIPT_HASHES[item["path"]], "Reviewed deployment-script hash mismatch.")
    require(paths == set(runtime) | EXTRA_FILES, "Descriptor contains an unreviewed file or misses a required file.")
    inline_payloads(descriptor)
    return descriptor


def inline_payloads(descriptor):
    records = {entry["path"]: entry for entry in descriptor["files"]}
    inline = descriptor.get("inlineFiles", [])
    require(isinstance(inline, list) and len(inline) <= RUNTIME_FILES, "Invalid inline-file inventory.")
    result = {}
    for item in inline:
        require(isinstance(item, dict) and set(item) == {"path", "data"} and item["path"] in records
                and item["path"] not in result and isinstance(item["data"], str), "Unexpected inline payload.")
        require(item["path"].startswith("assets/sprites/") or item["path"] == "online-reset.js", "Only reviewed tiny sprite/reset assets may be inline.")
        try:
            raw = base64.b64decode(item["data"], validate=True)
        except ValueError as error:
            raise RecoveryError("Invalid inline payload encoding.") from error
        result[item["path"]] = verify_payload(records[item["path"]], raw)
    return result


def no_symlink_ancestors(path):
    path = Path(path).absolute()
    for candidate in (path, *path.parents):
        require(not candidate.is_symlink(), "Unexpected symlink in a managed working path.")


def validate_cache(path, allow_test=False):
    path = Path(path)
    if not allow_test:
        require(path == DEFAULT_CACHE and path.is_symlink(), "Current game must be the managed orchard symlink.")
        no_symlink_ancestors(MANAGED_BASE)
        no_symlink_ancestors(MANAGED_BASE / "releases")
        marker = MANAGED_BASE / ".orchard-managed"
        require(marker.is_file() and not marker.is_symlink(), "The managed game owner marker is missing.")
        resolved = path.resolve(strict=True)
        require(resolved.parent == MANAGED_BASE / "releases", "Current game points outside the managed release directory.")
        path = resolved
    no_symlink_ancestors(path)
    require(path.is_dir(), "Reviewed cache directory is missing.")
    manifest = path / "static-manifest.json"
    require(manifest.is_file() and not manifest.is_symlink() and manifest.stat().st_size <= 1024 * 1024, "Cache manifest is not a regular file.")
    try:
        signed, fingerprint = normalized_manifest(json.loads(manifest.read_bytes()))
    except (ValueError, UnicodeError) as error:
        raise RecoveryError("Invalid cache manifest.") from error
    require(fingerprint in TRUSTED_CACHE, "Cache manifest fingerprint is not reviewed.")
    expected_files = {"static-manifest.json"} | {entry["path"] for entry in signed["files"]}
    expected_dirs = {str(parent) for entry in signed["files"] for parent in PurePosixPath(entry["path"]).parents if str(parent) != "."}
    actual_files, actual_dirs = set(), set()
    for item in path.rglob("*"):
        info = item.lstat()
        name = item.relative_to(path).as_posix()
        require(not stat.S_ISLNK(info.st_mode), "Cache contains a symlink.")
        if stat.S_ISREG(info.st_mode):
            actual_files.add(name)
        elif stat.S_ISDIR(info.st_mode):
            actual_dirs.add(name)
        else:
            raise RecoveryError("Cache contains a special file.")
    require(actual_files == expected_files and actual_dirs == expected_dirs, "Cache inventory has missing or unexpected entries.")
    result = {}
    for entry in signed["files"]:
        item = path / entry["path"]
        require(item.stat().st_size == entry["bytes"] and sha256(item.read_bytes()) == entry["sha256"], "Cache file differs from its reviewed manifest: " + entry["path"])
        result[entry["path"]] = (item, entry)
    return result, fingerprint


def verify_payload(entry, raw):
    require(isinstance(raw, bytes) and len(raw) == entry["bytes"] and sha256(raw) == entry["sha256"]
            and git_oid("blob", raw) == entry["oid"], "File bytes do not match reviewed SHA256/Git blob: " + entry["path"])
    return raw


class OfficialRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, url):
        target = urllib.parse.urlsplit(url)
        require(target.scheme == "https" and target.hostname == "api.github.com", "Contents API redirected outside official HTTPS API.")
        return super().redirect_request(request, response, code, message, headers, url)


def download_file(entry):
    url = API + urllib.parse.quote(entry["path"], safe="/") + "?ref=" + COMMIT
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), OfficialRedirect(),
                                        urllib.request.HTTPSHandler(context=ssl.create_default_context()))
    request = urllib.request.Request(url, headers={"Accept": "application/vnd.github.raw+json",
        "Accept-Encoding": "identity", "User-Agent": "Orchard-Reviewed-Recovery/1"})
    for attempt in range(1, 4):
        print(f"API_DOWNLOAD {entry['path']} attempt={attempt}/3", flush=True)
        try:
            with opener.open(request, timeout=25) as response:
                require(response.status == 200, "Contents API did not return HTTP 200.")
                length = response.headers.get("Content-Length")
                if length is not None:
                    require(length.isdigit() and int(length) == entry["bytes"], "Contents API size differs from reviewed file.")
                raw = response.read(entry["bytes"] + 1)
            return verify_payload(entry, raw)
        except (OSError, urllib.error.URLError, RecoveryError) as error:
            if attempt == 3:
                raise RecoveryError("Contents API failed or returned different bytes: " + entry["path"]) from error
            time.sleep(attempt)
    raise RecoveryError("Contents API retries exhausted.")


def clean_git_environment():
    env = {key: value for key, value in os.environ.items() if not key.startswith("GIT_")}
    env.update({"GIT_TERMINAL_PROMPT": "0", "GIT_ALLOW_PROTOCOL": "file",
                "GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": os.devnull})
    return env


def native_git(arguments, cwd=None, raw=None, timeout=90):
    env = clean_git_environment()
    result = subprocess.run(["git", *arguments], cwd=cwd, env=env, input=raw, stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE, timeout=timeout, check=False)
    require(result.returncode == 0, "Native Git preparation failed (no Git network access permitted).")
    return result.stdout.decode("ascii").strip()


def private_work(work_root, descriptor_hash, resume_work=None):
    marker_name = ".orchard-api-recovery.json"
    expected = {"version": 1, "commit": COMMIT, "descriptorSha256": descriptor_hash}
    if resume_work is not None:
        work = Path(resume_work).absolute()
        no_symlink_ancestors(work)
        info = work.stat()
        require(work.is_dir() and not info.st_mode & 0o077 and
                (not hasattr(os, "geteuid") or info.st_uid == os.geteuid()), "Resume directory is not private and owned by the current user.")
        marker = work / marker_name
        require(marker.is_file() and not marker.is_symlink() and marker.stat().st_size < 1024 and
                json.loads(marker.read_bytes()) == expected, "Resume directory does not belong to this reviewed recovery.")
    else:
        parent = Path(work_root).absolute()
        no_symlink_ancestors(parent)
        parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        work = Path(tempfile.mkdtemp(prefix="api-recovery-", dir=parent))
        work.chmod(0o700)
        (work / marker_name).write_text(json.dumps(expected, separators=(",", ":")), encoding="utf-8")
    print("RECOVERY_WORK " + str(work), flush=True)
    return work


def write_private(path, raw):
    no_symlink_ancestors(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    require(not path.exists(), "Refusing to overwrite an existing recovery file.")
    with path.open("xb") as output:
        output.write(raw)
    path.chmod(0o600)


def prepare(descriptor, descriptor_hash, work_root=None, cache_site=None, resume_work=None, allow_test=False):
    # Also validate in-process fixture/resume callers, not just the CLI loader.
    validate_descriptor(descriptor)
    require(isinstance(descriptor_hash, str) and HEX64.fullmatch(descriptor_hash), "Invalid reviewed descriptor hash.")
    objects, _ = decode_objects(descriptor)
    inline = inline_payloads(descriptor)
    if not allow_test:
        require(sys.platform.startswith("linux") and os.geteuid() == 0, "Real recovery requires the Linux root Tencent terminal.")
        no_symlink_ancestors(MANAGED_OPS)
        marker = MANAGED_OPS / ".orchard-managed"
        require(MANAGED_OPS.is_dir() and marker.is_file() and not marker.is_symlink(), "The existing static deployment owner marker is missing.")
        require(cache_site is None and work_root is None, "Production recovery uses only its managed paths.")
        if resume_work is not None:
            require(Path(resume_work).absolute().parent == MANAGED_OPS, "Resume directory must belong to managed Orchard operations.")
    work = private_work(work_root or (tempfile.gettempdir() if allow_test else MANAGED_OPS), descriptor_hash, resume_work)
    cache = {}
    selected_cache = Path(cache_site) if cache_site is not None else DEFAULT_CACHE
    require(allow_test or selected_cache.exists() or selected_cache.is_symlink(),
            "The managed current release is missing; refusing to redownload the full game during recovery.")
    if cache_site is not None or selected_cache.exists() or selected_cache.is_symlink():
        try:
            cache, fingerprint = validate_cache(selected_cache, allow_test=allow_test and cache_site is not None)
            print(f"REVIEWED_CACHE_OK {fingerprint} files={len(cache)}", flush=True)
        except (RecoveryError, OSError, ValueError) as error:
            if cache_site is not None or not allow_test:
                raise RecoveryError("Cache validation failed; nothing deployed and no full-asset download started.") from error
            print("CACHE_NOT_REUSED Validation failed; downloading only reviewed API files.", flush=True)
    files_root = work / "files"
    no_symlink_ancestors(files_root)
    files_root.mkdir(mode=0o700, exist_ok=True)
    reused, downloaded, resumed, embedded = 0, 0, 0, 0
    download_deadline = time.monotonic() + 900
    blobs = {}
    for entry in descriptor["files"]:
        target = files_root / entry["path"]
        no_symlink_ancestors(target)
        if target.exists():
            require(target.is_file() and target.stat().st_size == entry["bytes"], "Resume file is not the reviewed file: " + entry["path"])
            raw = verify_payload(entry, target.read_bytes())
            resumed += 1
            print("RESUME_VERIFIED " + entry["path"], flush=True)
        elif entry["path"] in cache and cache[entry["path"]][1]["sha256"] == entry["sha256"] and cache[entry["path"]][1]["bytes"] == entry["bytes"]:
            raw = verify_payload(entry, cache[entry["path"]][0].read_bytes())
            write_private(target, raw)
            reused += 1
            print("CACHE_REUSED " + entry["path"], flush=True)
        elif entry["path"] in inline:
            raw = verify_payload(entry, inline[entry["path"]])
            write_private(target, raw)
            embedded += 1
            print("INLINE_VERIFIED " + entry["path"], flush=True)
        else:
            require(time.monotonic() < download_deadline, "Preparation download budget exhausted; resume the retained verified work directory.")
            raw = verify_payload(entry, download_file(entry))
            write_private(target, raw)
            downloaded += 1
        blobs[entry["oid"]] = raw
    repo = work / "snapshot.git"
    no_symlink_ancestors(repo)
    if repo.exists():
        require(repo.is_dir(), "Unexpected snapshot path.")
        # Keep a previous snapshot for diagnosis and create a new private one.
        repo = Path(tempfile.mkdtemp(prefix="snapshot-", suffix=".git", dir=work))
    no_symlink_ancestors(repo)
    native_git(["init", "--bare", "--quiet", str(repo)])
    for oid, (kind, raw) in objects.items():
        actual = native_git(["--git-dir", str(repo), "hash-object", "-w", "--stdin", "-t", kind], raw=raw)
        require(actual == oid, "Native Git object differs from its reviewed raw bytes.")
    for oid, raw in blobs.items():
        actual = native_git(["--git-dir", str(repo), "hash-object", "--no-filters", "-w", "--stdin"], raw=raw)
        require(actual == oid, "Native Git blob differs from its reviewed raw bytes.")
    write_private(repo / "shallow", (COMMIT + "\n").encode("ascii"))
    native_git(["--git-dir", str(repo), "update-ref", "refs/heads/reviewed", COMMIT])
    for setting in ("uploadpack.allowFilter", "uploadpack.allowAnySHA1InWant", "uploadpack.allowReachableSHA1InWant"):
        native_git(["--git-dir", str(repo), "config", setting, "true"])
    for name, expected in SCRIPT_HASHES.items():
        require(sha256((files_root / name).read_bytes()) == expected, "Installer bytes changed after preparation.")
    result = {"commit": COMMIT, "work": str(work), "repo": str(repo), "files": str(files_root),
              "runtimeFingerprint": RUNTIME_FINGERPRINT, "runtimeFiles": RUNTIME_FILES,
              "reusedFiles": reused, "downloadedFiles": downloaded, "resumedFiles": resumed, "inlineFiles": embedded}
    proof = work / "prepare-proof.json"
    if proof.exists():
        require(proof.is_file() and not proof.is_symlink(), "Unexpected proof path.")
        proof = work / ("prepare-proof-" + str(time.time_ns()) + ".json")
    write_private(proof, json.dumps(result, separators=(",", ":")).encode("utf-8"))
    print("PREPARE_OK " + json.dumps(result, separators=(",", ":")), flush=True)
    return result


def deployment_environment(repo):
    env = clean_git_environment()
    env.update({"GIT_CONFIG_COUNT": "1", "GIT_CONFIG_KEY_0": "url." + Path(repo).resolve().as_uri() + "/.insteadOf",
                "GIT_CONFIG_VALUE_0": REPO, "GIT_ALLOW_PROTOCOL": "file", "GIT_TERMINAL_PROMPT": "0"})
    return env


def run_installer(path, env, label):
    expected = SCRIPT_HASHES["tools/" + path.name]
    require(path.is_file() and not path.is_symlink() and sha256(path.read_bytes()) == expected,
            "Installer differs from its reviewed bytes.")
    print(label + "_START", flush=True)
    process = subprocess.Popen(["bash", str(path), COMMIT], env=env, start_new_session=True)
    try:
        code = process.wait(timeout=600)
    except (subprocess.TimeoutExpired, KeyboardInterrupt) as interrupted:
        # First let the reviewed installer's own TERM/EXIT rollback run.
        os.killpg(process.pid, signal.SIGTERM)
        try:
            process.wait(timeout=20)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait(timeout=10)
        reason = "timed out" if isinstance(interrupted, subprocess.TimeoutExpired) else "was interrupted"
        raise RecoveryError(label + " " + reason + "; inspect the retained backup and work directory.")
    require(code == 0, label + " failed; installer rollback/backup output above is authoritative.")
    print(label + "_OK", flush=True)


class NoLeaderboardRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, url):
        raise RecoveryError("The fixed leaderboard HTTPS endpoint must answer directly without redirection.")


def check_leaderboard():
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoLeaderboardRedirect(),
                                        urllib.request.HTTPSHandler(context=ssl.create_default_context()))
    request = urllib.request.Request("https://111.230.149.65/api/world/leaderboard?page=1",
                                    headers={"User-Agent": "Orchard-Recovery-Check/1", "Cache-Control": "no-cache", "Connection": "close"})
    for attempt in range(1, 6):
        try:
            with opener.open(request, timeout=10) as response:
                require(response.status == 200, "Leaderboard did not return HTTP 200.")
                raw = response.read(1024 * 1024 + 1)
            require(len(raw) <= 1024 * 1024, "Leaderboard response is too large.")
            body = json.loads(raw)
            board = body.get("leaderboard") if isinstance(body, dict) else None
            require(body.get("ok") is True and isinstance(board, dict) and board.get("self") is None and
                    isinstance(board.get("entries"), list) and len(board["entries"]) <= 20 and
                    board.get("pageSize") == 20 and board.get("page") == 1 and
                    type(board.get("totalPlayers")) is int and board["totalPlayers"] >= 0 and
                    type(board.get("totalPages")) is int and board["totalPages"] >= 1 and
                    type(board.get("serverTime")) is int, "Unexpected anonymous leaderboard shape.")
            previous = 101
            for entry in board["entries"]:
                require(isinstance(entry, dict) and isinstance(entry.get("name"), str) and
                        isinstance(entry.get("playerId"), str) and type(entry.get("rank")) is int and entry["rank"] > 0 and
                        type(entry.get("highestStage")) is int and 1 <= entry["highestStage"] <= previous and
                        entry.get("isSelf") is False, "Unexpected leaderboard entry shape or order.")
                previous = entry["highestStage"]
            print("LEADERBOARD_API_OK https://111.230.149.65/api/world/leaderboard?page=1", flush=True)
            return
        except (RecoveryError, OSError, urllib.error.URLError, ValueError, AttributeError) as error:
            if attempt == 5:
                raise RecoveryError("Static and world installers succeeded, but public leaderboard HTTPS validation failed.") from error
            time.sleep(1)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--descriptor", required=True)
    parser.add_argument("--descriptor-sha256", required=True)
    parser.add_argument("--prepare-only", action="store_true", help="Build isolated reviewed files/snapshot; do not deploy.")
    parser.add_argument("--work-root", help="Parent for private fixture work directories; prepare-only only.")
    parser.add_argument("--cache-site", help="Explicit cache fixture; prepare-only only.")
    parser.add_argument("--resume-work", help="Resume a retained private recovery directory.")
    arguments = parser.parse_args()
    os.umask(0o077)
    descriptor = load_descriptor(arguments.descriptor, arguments.descriptor_sha256)
    require(shutil.which("git"), "Native Git is required to construct the reviewed local snapshot.")
    if not arguments.prepare_only:
        require(sys.platform.startswith("linux") and hasattr(os, "geteuid") and os.geteuid() == 0,
                "Real deployment is Linux-only and requires root; use --prepare-only for fixtures.")
        require(shutil.which("bash"), "Native Bash is required for the unchanged reviewed installers.")
    result = prepare(descriptor, arguments.descriptor_sha256, arguments.work_root,
                     arguments.cache_site, arguments.resume_work, allow_test=arguments.prepare_only)
    if arguments.prepare_only:
        return 0
    env = deployment_environment(result["repo"])
    root = Path(result["files"])
    run_installer(root / "tools/deploy-ip-site.sh", env, "STATIC_DEPLOY")
    try:
        run_installer(root / "tools/deploy-world-server.sh", env, "WORLD_DEPLOY")
    except (RecoveryError, OSError) as error:
        print("PARTIAL_SUCCESS Static release installed; world upgrade failed. Existing world rollback/backup was retained.", file=sys.stderr, flush=True)
        raise error
    check_leaderboard()
    print("RECOVERY_INSTALLERS_OK Public static manifest and all runtime resources still require the external release check.", flush=True)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (RecoveryError, OSError, ValueError, subprocess.SubprocessError) as error:
        print("RECOVERY_FAILED " + str(error), file=sys.stderr, flush=True)
        raise SystemExit(1)
