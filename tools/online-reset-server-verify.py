#!/usr/bin/env python3
"""Real loopback HTTP/SQLite reset-epoch checks; no production connection."""
import contextlib
import http.cookiejar
import importlib.util
import json
import sqlite3
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path


HERE = Path(__file__).resolve().parent


def module(name, filename):
    specification = importlib.util.spec_from_file_location(name, HERE / filename)
    result = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(result)
    return result


WORLD = module("online_reset_http_world", "world-server.py")
RESET = module("online_reset_http_tool", "reset-online-data.py")
EPOCH = "reset-" + "b" * 32


@contextlib.contextmanager
def running(store, site):
    server = WORLD.WorldHTTPServer(("127.0.0.1", 0), store, site)
    original = WORLD.WorldHandler.log_message
    WORLD.WorldHandler.log_message = lambda *args: None
    thread = threading.Thread(target=server.serve_forever, kwargs={"poll_interval": .02}, daemon=True)
    thread.start()
    try:
        yield server
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)
        WORLD.WorldHandler.log_message = original


class Client:
    def __init__(self, server, jar=None):
        self.base = "http://127.0.0.1:" + str(server.server_address[1])
        self.jar = jar if jar is not None else http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), urllib.request.HTTPCookieProcessor(self.jar))

    def send(self, path, payload=None, epoch=None):
        headers = {"Origin": self.base, "Accept": "application/json"}
        if payload is not None:
            headers["Content-Type"] = "application/json"
        if epoch is not None:
            headers["X-Orchard-Data-Epoch"] = epoch
        request = urllib.request.Request(self.base + "/api/world/" + path,
                                        data=None if payload is None else json.dumps(payload).encode(), headers=headers)
        try:
            response = self.opener.open(request, timeout=5)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            return response.status, json.loads(response.read()), response.headers


class EpochHTTPQA(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="orchard-epoch-http-qa-")
        self.root = Path(self.temporary.name)
        self.site = self.root / "site"
        self.site.mkdir()
        (self.site / "index.html").write_text("<!doctype html><title>Isolated epoch test</title>")
        self.database = self.root / "world.sqlite"
        self.clock = [1800010000000]
        self.store = WORLD.WorldStore(self.database, clock=lambda: self.clock[0])

    def tearDown(self):
        resolved = self.root.resolve()
        self.assertEqual(resolved, Path(self.temporary.name).resolve())
        self.assertEqual(resolved.parent, Path(tempfile.gettempdir()).resolve())
        self.assertTrue(resolved.name.startswith("orchard-epoch-http-qa-"))
        self.temporary.cleanup()

    def success(self, client, path, payload=None, epoch=None):
        status, body, headers = client.send(path, payload, epoch)
        self.assertEqual(status, 200, (path, status, body.get("code")))
        self.assertIs(body.get("ok"), True)
        return body

    def counts(self):
        with contextlib.closing(self.store.connect()) as connection:
            return RESET.table_counts(connection)

    def test_initial_compatibility_reset_write_guards_and_rollback_persistence(self):
        self.assertEqual(self.store.data_epoch(), "initial")
        backup = self.root / "before-reset.sqlite"
        with running(self.store, self.site) as server:
            alice = Client(server)
            visitor = Client(server)
            self.assertEqual(self.success(visitor, "health")["dataEpoch"], "initial")
            # Existing pre-epoch browsers can still register, login and enter
            # while the database has never been reset.
            registered = self.success(alice, "register", {"name": "旧玩家", "password": "qa-password"})
            old_id = registered["state"]["self"]["id"]
            self.success(alice, "login", {"name": "旧玩家", "password": "qa-password"}, "obsolete-header")
            self.success(alice, "enter", {"name": "旧玩家", "password": "qa-password"})
            self.success(alice, "action", {"type": "settle", "requestId": "qa_settle_0001", "accountName": "旧玩家", "x": 2, "y": 3})
            self.success(alice, "action", {"type": "guild-create", "requestId": "qa_guild_00001", "accountName": "旧玩家", "name": "旧公会"})
            ticket = self.success(alice, "campaign/start", {"stage": 1, "name": "旧玩家"})["ticket"]
            self.success(alice, "campaign/complete", {"ticket": ticket, "name": "旧玩家"})
            self.clock[0] += 60000
            self.success(alice, "campaign/claim", {"ticket": ticket, "name": "旧玩家"})
            self.assertEqual(self.success(alice, "leaderboard")["leaderboard"]["self"]["highestStage"], 1)
            old_jar = alice.jar
            old_token = next(cookie.value for cookie in old_jar if cookie.name == "orchard_world")
        original_counts = self.counts()
        self.assertGreater(original_counts["sessions"], 0)
        self.assertGreater(original_counts["plots"], 0)
        self.assertGreater(original_counts["guilds"], 0)
        RESET.backup_database(self.database, backup)
        RESET.reset_database(self.database, "initial", EPOCH)
        self.assertFalse(any(self.counts().values()))
        self.assertIsNone(self.store.session_player(old_token))
        restarted_store = WORLD.WorldStore(self.database, clock=lambda: self.clock[0])
        self.assertEqual(restarted_store.data_epoch(), EPOCH)
        with running(restarted_store, self.site) as server:
            old_browser = Client(server, old_jar)
            visitor = Client(server)
            status, health, headers = visitor.send("health")
            self.assertEqual(status, 200)
            self.assertEqual(health["dataEpoch"], EPOCH)
            self.assertEqual(headers.get("Cache-Control"), "no-store")
            for client in (old_browser, visitor):
                self.assertIsNone(self.success(client, "state")["state"]["self"])
                board = self.success(client, "leaderboard")["leaderboard"]
                self.assertEqual(board["entries"], [])
                self.assertEqual(board["totalPlayers"], 0)
                self.assertIsNone(board["self"])
            mutations = (
                ("register", {"name": "被拦甲", "password": "qa-password"}),
                ("enter", {"name": "被拦乙", "password": "qa-password"}),
                ("login", {"name": "旧玩家", "password": "qa-password"}),
                ("link", {"name": "旧玩家", "password": "qa-password", "worldPassword": "qa-password"}),
                ("campaign/start", {"stage": 1, "name": "旧玩家"}),
                ("campaign/complete", {"ticket": ticket, "name": "旧玩家"}),
                ("campaign/claim", {"ticket": ticket, "name": "旧玩家"}),
                ("action", {"type": "settle", "requestId": "qa_reset_00001", "accountName": "旧玩家", "x": 2, "y": 3}),
                ("logout", {}),
            )
            for epoch in (None, "wrong", "initial"):
                for path, payload in mutations:
                    with self.subTest(path=path, epoch=epoch):
                        before = self.counts()
                        status, body, _ = old_browser.send(path, payload, epoch)
                        self.assertEqual(status, 409)
                        self.assertEqual(body.get("code"), "data_reset")
                        self.assertEqual(self.counts(), before)
                        self.assertFalse(any(self.counts().values()))
            # Current epoch does not make an old cookie valid again.
            status, result, _ = old_browser.send("campaign/start", {"stage": 1, "name": "旧玩家"}, EPOCH)
            self.assertEqual((status, result.get("code")), (401, "login_required"))
            self.assertFalse(any(self.counts().values()))
            fresh = Client(server)
            registered = self.success(fresh, "register", {"name": "新玩家", "password": "qa-password"}, EPOCH)
            self.assertNotEqual(registered["state"]["self"]["id"], old_id)
            self.assertEqual(registered["state"]["self"]["unlockedStage"], 1)
            self.assertEqual(registered["state"]["self"]["resources"], WORLD.RULES["initialResources"])
            self.assertIsNone(registered["state"]["self"]["home"])
            self.assertIsNone(registered["state"]["self"]["guildId"])
            self.success(fresh, "login", {"name": "新玩家", "password": "qa-password"}, EPOCH)
            self.success(fresh, "action", {"type": "settle", "requestId": "qa_fresh_00001", "accountName": "新玩家", "x": 2, "y": 3}, EPOCH)
            new_ticket = self.success(fresh, "campaign/start", {"stage": 1, "name": "新玩家"}, EPOCH)["ticket"]
            self.success(fresh, "campaign/complete", {"ticket": new_ticket, "name": "新玩家"}, EPOCH)
            self.assertEqual(self.success(fresh, "leaderboard")["leaderboard"]["self"]["highestStage"], 1)
            # Previously registered names can enter as completely fresh users.
            recreated = self.success(Client(server), "enter", {"name": "旧玩家", "password": "qa-password"}, EPOCH)
            self.assertNotEqual(recreated["state"]["self"]["id"], old_id)
            self.assertEqual(recreated["state"]["self"]["unlockedStage"], 1)
            self.assertIsNone(recreated["state"]["self"]["home"])
        # A deployment/reset failure can restore the pre-reset epoch and all
        # original session, account, progression and home/guild rows together.
        RESET.restore_database(self.database, backup)
        restored = WORLD.WorldStore(self.database, clock=lambda: self.clock[0])
        self.assertEqual(restored.data_epoch(), "initial")
        self.assertEqual(self.counts(), original_counts)
        self.assertEqual(restored.session_player(old_token), old_id)
        with running(restored, self.site) as server:
            old_browser = Client(server, old_jar)
            self.assertEqual(self.success(Client(server), "health")["dataEpoch"], "initial")
            state = self.success(old_browser, "state")["state"]
            self.assertEqual(state["self"]["id"], old_id)
            self.assertEqual(state["self"]["home"]["x"], 2)
            self.assertTrue(state["self"]["guildId"])
            self.assertEqual(self.success(old_browser, "leaderboard")["leaderboard"]["self"]["highestStage"], 1)


if __name__ == "__main__":
    unittest.main(verbosity=2)
