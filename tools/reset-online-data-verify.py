#!/usr/bin/env python3
"""Isolated SQLite/HTTP-boundary QA; never contacts or resets the live server."""
import contextlib
import hashlib
import importlib.util
import io
import json
import os
import sqlite3
import tempfile
import types
import unittest
import urllib.error
import urllib.request
from pathlib import Path
from unittest.mock import patch


HERE = Path(__file__).resolve().parent


def module(name, filename):
    spec = importlib.util.spec_from_file_location(name, HERE / filename)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


reset = module("orchard_reset_qa", "reset-online-data.py")
server = module("orchard_server_reset_qa", "world-server.py")
INITIAL = "initial"
NEW_EPOCH = "reset-" + "d" * 32


class ResetQA(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="orchard-reset-qa-")
        self.root = Path(self.temporary.name)
        self.database = self.root / "world.sqlite"
        self.store = server.WorldStore(self.database)
        with contextlib.closing(sqlite3.connect(self.database)) as connection:
            connection.execute("INSERT OR REPLACE INTO metadata VALUES(?,?)", (reset.EPOCH_KEY, INITIAL))
            connection.execute("INSERT INTO metadata VALUES('unrelated_config','keep')")
            connection.execute("INSERT INTO players VALUES(?,?,?,?,?)", ("qa-id", "QA", "00" * 16, "synthetic-hash", "{}"))
            connection.execute("INSERT INTO sessions VALUES(?,?,?)", (hashlib.sha256(b"qa-old-cookie-abcdefghijklmnopqrstuvwxyz").hexdigest(), "qa-id", 9999999999999))
            connection.execute("INSERT INTO plots VALUES(?,?,?)", (2, 3, "qa-id"))
            connection.execute("INSERT INTO guilds VALUES(?,?,?,?)", ("qa-guild", "QA", "qa-id", "{}"))
            connection.execute("INSERT INTO requests VALUES(?,?,?,?,?)", ("qa-id", "qa-request", "fixture", "{}", 1))
            connection.execute("INSERT INTO campaigns VALUES(?,?,?,?,?,?,?)", ("qa-ticket", "qa-id", 100, 1, 9999999999999, 2, "{}"))
            connection.execute("INSERT INTO campaign_completions VALUES(?,?,?,?)", ("qa-ticket", "qa-id", 100, 2))
            connection.execute("INSERT INTO reports VALUES(?,?,?,?,?)", ("qa-report", 2, "qa-id", "qa-other", "{}"))
            connection.commit()

    def tearDown(self):
        resolved = self.root.resolve()
        self.assertEqual(resolved, Path(self.temporary.name).resolve())
        self.assertEqual(resolved.parent, Path(tempfile.gettempdir()).resolve())
        self.assertTrue(resolved.name.startswith("orchard-reset-qa-"))
        self.temporary.cleanup()

    def connection(self):
        return contextlib.closing(reset.database_connection(self.database))

    def test_backup_all_tables_private_and_restore_exact_database(self):
        backup = self.root / "backup.sqlite"
        self.assertEqual(self.store.session_player("qa-old-cookie-abcdefghijklmnopqrstuvwxyz"), "qa-id")
        self.assertEqual(self.store.leaderboard()["leaderboard"]["entries"][0]["highestStage"], 100)
        epoch, counts = reset.backup_database(self.database, backup)
        self.assertEqual(epoch, INITIAL)
        self.assertEqual(counts, {name: 1 for name in reset.PLAYER_TABLES})
        reset.reset_database(self.database, INITIAL, NEW_EPOCH)
        self.assertIsNone(self.store.session_player("qa-old-cookie-abcdefghijklmnopqrstuvwxyz"))
        self.assertEqual(self.store.leaderboard()["leaderboard"]["totalPlayers"], 0)
        with self.connection() as connection:
            self.assertEqual(reset.verify_schema(connection), NEW_EPOCH)
            self.assertFalse(any(reset.table_counts(connection).values()))
            self.assertEqual(connection.execute("SELECT value FROM metadata WHERE key='unrelated_config'").fetchone(), ("keep",))
            self.assertEqual(connection.execute("SELECT value FROM metadata WHERE key='schema'").fetchone(), ("1",))
        reset.restore_database(self.database, backup)
        with self.connection() as connection:
            self.assertEqual(reset.verify_schema(connection), INITIAL)
            self.assertEqual(reset.table_counts(connection), counts)
        self.assertEqual(self.store.session_player("qa-old-cookie-abcdefghijklmnopqrstuvwxyz"), "qa-id")
        self.assertEqual(self.store.leaderboard()["leaderboard"]["entries"][0]["highestStage"], 100)

    def test_unknown_table_aborts_without_touching_player_rows(self):
        with self.connection() as connection:
            connection.execute("CREATE TABLE other_site (value TEXT)")
            connection.commit()
        with self.assertRaises(reset.ResetError):
            reset.reset_database(self.database, INITIAL, NEW_EPOCH)
        with self.connection() as connection:
            self.assertEqual(reset.table_counts(connection), {name: 1 for name in reset.PLAYER_TABLES})

    def test_epoch_mismatch_or_missing_guard_aborts(self):
        with self.assertRaises(reset.ResetError):
            reset.reset_database(self.database, "reset-" + "a" * 32, NEW_EPOCH)
        with self.connection() as connection:
            connection.execute("DELETE FROM metadata WHERE key=?", (reset.EPOCH_KEY,))
            connection.commit()
        with self.assertRaises(reset.ResetError):
            reset.backup_database(self.database, self.root / "no-guard.sqlite")
        with self.connection() as connection:
            self.assertEqual(reset.table_counts(connection)["players"], 1)

    def test_trigger_or_schema_change_aborts(self):
        with self.connection() as connection:
            connection.execute("CREATE TRIGGER unrelated AFTER DELETE ON players BEGIN SELECT 1; END")
            connection.commit()
            with self.assertRaises(reset.ResetError):
                reset.verify_schema(connection)
            connection.execute("DROP TRIGGER unrelated")
            connection.execute("ALTER TABLE players ADD COLUMN extra TEXT")
            connection.commit()
            with self.assertRaises(reset.ResetError):
                reset.verify_schema(connection)

    def test_transaction_failure_is_all_or_nothing(self):
        class FailedConnection:
            def __init__(self, connection):
                self.connection = connection
            def execute(self, statement, *args):
                if statement == "DELETE FROM guilds":
                    raise sqlite3.OperationalError("isolated QA injected failure")
                return self.connection.execute(statement, *args)
            def __getattr__(self, key):
                return getattr(self.connection, key)
        original = reset.database_connection
        with patch.object(reset, "database_connection", side_effect=lambda path: FailedConnection(original(path))):
            with self.assertRaises(sqlite3.OperationalError):
                reset.reset_database(self.database, INITIAL, NEW_EPOCH)
        with self.connection() as connection:
            self.assertEqual(reset.verify_schema(connection), INITIAL)
            self.assertEqual(reset.table_counts(connection), {name: 1 for name in reset.PLAYER_TABLES})

    def release(self):
        root = self.root / "site"
        root.mkdir()
        (root / "assets").mkdir()
        content = {"index.html": b"<script src='online-reset.js'></script>", "online-reset.js": b"reset guard", "assets/sprite.webp": b"fixture-image"}
        files = []
        for name, data in sorted(content.items()):
            (root / name).write_bytes(data)
            files.append({"path": name, "bytes": len(data), "sha256": reset.sha256(data)})
        manifest = {"version": 1, "fileCount": len(files), "totalBytes": sum(item["bytes"] for item in files), "files": files}
        (root / "static-manifest.json").write_text(json.dumps(manifest))
        return root, manifest

    def test_manifest_raw_hash_inventory_and_tamper_rejection(self):
        root, manifest = self.release()
        fingerprint = reset.manifest_fingerprint(manifest)
        self.assertEqual(reset.validate_manifest(root, fingerprint), manifest)
        target = root / "online-reset.js"
        original = target.read_bytes()
        target.write_bytes(b"tampr guard")
        with self.assertRaises(reset.ResetError):
            reset.validate_manifest(root, fingerprint)
        target.write_bytes(original)
        (root / "unexpected.txt").write_text("not a runtime file")
        with self.assertRaises(reset.ResetError):
            reset.validate_manifest(root, fingerprint)

    def test_manifest_guard_required(self):
        root, manifest = self.release()
        (root / "online-reset.js").rename(root / "old-reset.js")
        for item in manifest["files"]:
            if item["path"] == "online-reset.js":
                item["path"] = "old-reset.js"
        (root / "static-manifest.json").write_text(json.dumps(manifest))
        with self.assertRaises(reset.ResetError):
            reset.validate_manifest(root, reset.manifest_fingerprint(manifest))

    def test_no_redirects_cookie_or_proxy_exfiltration(self):
        for destination in ("http://111.230.149.65/api/world/health", "https://example.com/", reset.ORIGIN + "/other"):
            with self.assertRaises(reset.ResetError):
                reset.NoRedirect().redirect_request(urllib.request.Request(reset.ORIGIN + "/api/world/health"), None, 302, "redirect", {}, destination)
        class Response(io.BytesIO):
            status = 200
            def geturl(self):
                return reset.ORIGIN + "/api/world/health"
        class Opener:
            def open(self, request, timeout):
                self.request = request
                return Response(b"{}")
        opener = Opener()
        with patch.object(reset.urllib.request, "build_opener", return_value=opener) as build:
            self.assertEqual(reset.public_bytes("/api/world/health", 2), (200, b"{}"))
            self.assertFalse(any(key.lower() == "cookie" for key in opener.request.headers))
            self.assertIsInstance(build.call_args.args[0], urllib.request.ProxyHandler)
            self.assertEqual(build.call_args.args[0].proxies, {})
        with self.assertRaises(reset.ResetError):
            reset.public_bytes("//example.com", 10)

    def test_full_public_release_checks_every_resource(self):
        root, manifest = self.release()
        checked = []
        def download(path, limit, **kwargs):
            checked.append(path)
            return 200, (root / path.removeprefix("/orchard/")).read_bytes()
        with patch.object(reset, "public_bytes", side_effect=download), patch.object(reset, "public_json", return_value=(200, {"ok": True, "version": "orchard-world-1", "storage": "sqlite", "dataEpoch": INITIAL})):
            self.assertEqual(reset.verify_public_release(root, manifest), INITIAL)
        self.assertEqual(set(checked), {"/orchard/static-manifest.json", *["/orchard/" + item["path"] for item in manifest["files"]]})

    def test_empty_world_board_and_old_epoch_guard(self):
        requests = []
        def api(path, **kwargs):
            requests.append((path, kwargs))
            if path.endswith("health"):
                return 200, {"ok": True, "dataEpoch": NEW_EPOCH}
            if path.endswith("state"):
                return 200, {"ok": True, "state": {"self": None, "players": [], "guilds": [], "reports": [], "map": {"cells": []}}}
            if "leaderboard" in path:
                return 200, {"ok": True, "leaderboard": {"entries": [], "self": None, "totalPlayers": 0}}
            return 409, {"ok": False, "code": "data_reset"}
        with patch.object(reset, "public_json", side_effect=api):
            reset.verify_empty_public(NEW_EPOCH, INITIAL)
        self.assertEqual(requests[-1], ("/api/world/enter", {"payload": {"name": "", "password": ""}, "epoch": INITIAL}))
        def stale_world(path, **kwargs):
            status, result = api(path, **kwargs)
            if path.endswith("state"):
                result["state"]["players"] = [{"id": "fixture"}]
            return status, result
        with patch.object(reset, "public_json", side_effect=stale_world), patch.object(reset.time, "sleep"):
            with self.assertRaises(reset.ResetError):
                reset.verify_empty_public(NEW_EPOCH, INITIAL)

    def orchestration(self, *, failure=None):
        """Mock Linux ownership/systemd/network, retain real backup/reset SQLite."""
        ops, static_ops, static_base = self.root / "ops", self.root / "static-ops", self.root / "static"
        for directory in (ops, static_ops, static_base, ops / "backups"):
            directory.mkdir(exist_ok=True)
        commit = "a" * 40
        release = static_base / "releases" / commit
        release.mkdir(parents=True)
        unit = self.root / "service"
        unit.write_text("isolated service fixture")
        class Link:
            def is_symlink(self):
                return True
            def resolve(self, **kwargs):
                return release
        class Base:
            def __truediv__(self, name):
                return Link() if name == "orchard" else static_base / name
        active = [True]
        commands = []
        def command(*args):
            commands.append(args)
            if args[:2] == ("systemctl", "stop"):
                active[0] = False
            if args[:2] == ("systemctl", "start"):
                active[0] = True
            return ""
        def property_value(name):
            return str(int(active[0])) if name == "MainPID" else "active" if active[0] else "inactive"
        original_require = reset.require
        def fixture_require(condition, message):
            # NTFS does not model Unix mode bits. This single permission gate is
            # independently enforced by production; no schema/data gate mocked.
            if message == "Private managed backups directory is missing." and os.name == "nt":
                condition = (ops / "backups").is_dir()
            return original_require(condition, message)
        arguments = types.SimpleNamespace(commit=commit, manifest_sha256="b" * 64, backend_sha256="c" * 64)
        with contextlib.ExitStack() as stack:
            for key, value in (("OPS", ops), ("STATIC_OPS", static_ops), ("STATIC_BASE", Base()),
                               ("DATABASE", self.database), ("UNIT", unit)):
                stack.enter_context(patch.object(reset, key, value))
            for key, value in (("check_marker", lambda *args, **kwargs: None),
                               ("deployment_locks", contextlib.nullcontext), ("verify_service", lambda *args: (0, 0)),
                               ("validate_manifest", lambda *args: {}), ("verify_public_release", lambda *args: INITIAL),
                               ("fix_database_permissions", lambda *args: None), ("run", command),
                               ("service_property", property_value), ("require", fixture_require)):
                stack.enter_context(patch.object(reset, key, value))
            stack.enter_context(patch.object(reset.sys, "platform", "linux"))
            stack.enter_context(patch.object(reset.os, "geteuid", return_value=0, create=True))
            if failure == "after-clear":
                def verify_failure(*args):
                    with self.connection() as connection:
                        self.assertFalse(any(reset.table_counts(connection).values()))
                    raise reset.ResetError("isolated public verification failure")
                stack.enter_context(patch.object(reset, "verify_empty_public", side_effect=verify_failure))
            else:
                stack.enter_context(patch.object(reset, "verify_empty_public", return_value=None))
            stack.enter_context(contextlib.redirect_stdout(io.StringIO()))
            stack.enter_context(contextlib.redirect_stderr(io.StringIO()))
            if failure:
                with self.assertRaises(reset.ResetError):
                    reset.execute(arguments)
            else:
                reset.execute(arguments)
        self.assertTrue(active[0])
        return commands, next((ops / "backups").glob("reset-*"))

    def test_complete_orchestration_stops_before_consistent_backup(self):
        commands, backup = self.orchestration()
        self.assertEqual(commands[0], ("systemctl", "stop", reset.SERVICE))
        self.assertEqual(commands[-1], ("systemctl", "start", reset.SERVICE))
        with self.connection() as connection:
            self.assertFalse(any(reset.table_counts(connection).values()))
            self.assertTrue(reset.verify_schema(connection).startswith("reset-"))
        audit = json.loads((backup / "reset-audit.json").read_text())
        self.assertEqual(audit["status"], "reset-complete")
        self.assertEqual(audit["sessionsRevoked"], 1)

    def test_public_verification_failure_restores_account_sessions_scores(self):
        commands, backup = self.orchestration(failure="after-clear")
        with self.connection() as connection:
            self.assertEqual(reset.verify_schema(connection), INITIAL)
            self.assertEqual(reset.table_counts(connection), {name: 1 for name in reset.PLAYER_TABLES})
        self.assertEqual(self.store.session_player("qa-old-cookie-abcdefghijklmnopqrstuvwxyz"), "qa-id")
        self.assertEqual(self.store.leaderboard()["leaderboard"]["entries"][0]["highestStage"], 100)
        self.assertGreaterEqual(commands.count(("systemctl", "stop", reset.SERVICE)), 2)
        self.assertEqual(json.loads((backup / "reset-audit.json").read_text())["status"], "failed-player-data-restored")


if __name__ == "__main__":
    unittest.main(verbosity=2)
