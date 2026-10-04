#!/usr/bin/env python3
"""Real HTTP/SQLite integration checks, temporary data and a controlled clock."""
import concurrent.futures
import contextlib
import http.cookiejar
import importlib.util
import json
import tempfile
import threading
import urllib.error
import urllib.request
from pathlib import Path

SPEC = importlib.util.spec_from_file_location("orchard_world", Path(__file__).with_name("world-server.py"))
WORLD = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(WORLD)
ASSERTIONS = 0


def check(condition, message):
    global ASSERTIONS
    ASSERTIONS += 1
    if not condition:
        raise AssertionError(message)


class Client:
    def __init__(self, server, jar=None, public_origin=None):
        self.base = f"http://127.0.0.1:{server.server_address[1]}"
        self.origin = public_origin or self.base
        self.jar = jar or http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))
        self.counter = 0
        self.account_name = None

    def send(self, path, payload=None, headers=None, expected=200):
        defaults = {"Origin": self.origin}
        if payload is not None:
            defaults["Content-Type"] = "application/json"
        if headers:
            defaults.update(headers)
        request = urllib.request.Request(self.base + path, data=json.dumps(payload).encode() if payload is not None else None, headers=defaults)
        try:
            response = self.opener.open(request, timeout=10)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            status, raw, response_headers = response.status, response.read(), response.headers
        check(status in expected if isinstance(expected, tuple) else status == expected,
              f"{path}: expected HTTP {expected}, got {status}: {raw[:400]!r}")
        try:
            value = json.loads(raw)
        except (ValueError, UnicodeError):
            value = raw
        if isinstance(value, dict) and value.get("ok") and isinstance(value.get("state"), dict):
            own = value["state"].get("self")
            self.account_name = own["name"] if own else None
        return value, response_headers

    def get(self):
        return self.send("/api/world/state")[0]["state"]

    def post(self, path, payload, expected=200, code=None, headers=None):
        if path == "action" and "accountName" not in payload and self.account_name:
            payload = dict(payload, accountName=self.account_name)
        value, response_headers = self.send("/api/world/" + path, payload, headers, expected)
        if code:
            check(value.get("code") == code, f"expected {code}, got {value}")
        else:
            check(value.get("ok") is True, f"unexpected rejection: {value}")
        return value

    def action(self, kind, expected=200, code=None, request_id=None, **kwargs):
        self.counter += 1
        payload = {"type": kind, "requestId": request_id or f"request_{self.counter:08d}", **kwargs}
        return self.post("action", payload, expected, code)


@contextlib.contextmanager
def running(store, site, public_origin=None, secure=False):
    server = WORLD.WorldHTTPServer(("127.0.0.1", 0), store, site, (public_origin,) if public_origin else (), secure)
    # Silence access logs during verification, without changing production logging.
    original_log = WORLD.WorldHandler.log_message
    WORLD.WorldHandler.log_message = lambda *args: None
    thread = threading.Thread(target=server.serve_forever, kwargs={"poll_interval": .05}, daemon=True)
    thread.start()
    try:
        yield server
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)
        WORLD.WorldHandler.log_message = original_log


def main():
    with tempfile.TemporaryDirectory(prefix="orchard-world-verify-") as temp:
        root = Path(temp)
        database = root / "private" / "world.sqlite"
        site = root / "site"
        site.mkdir()
        (site / "index.html").write_text('<title>world-test</title><script src="game.js"></script>', encoding="utf-8")
        (site / "game.js").write_text("window.test = true;", encoding="utf-8")
        (site / "secret.env").write_text("private", encoding="utf-8")
        (site / "secret.js").write_text("private", encoding="utf-8")
        (site / "tools").mkdir()
        (site / "tools" / "world-server.py").write_text("private", encoding="utf-8")
        clock = [1800000000000]
        store = WORLD.WorldStore(database, clock=lambda: clock[0])
        with running(store, site) as server:
            alice, bob = Client(server), Client(server)
            check(alice.get()["self"] is None, "anonymous state must have no player")
            alice.post("action", {"type": "settle", "requestId": "anonymous_123", "x": 1, "y": 1}, 401, "login_required")
            value, headers = alice.send("/api/world/register", {"name": "字欧", "password": "secret-alice"})
            check(value["ok"] and "HttpOnly" in headers.get("Set-Cookie", "") and "SameSite=Lax" in headers.get("Set-Cookie", ""), "safe session cookie")
            alice_id = value["state"]["self"]["id"]
            bob_id = bob.post("register", {"name": "李总", "password": "secret-bob"})["state"]["self"]["id"]
            bob.post("register", {"name": "字欧", "password": "another-pass"}, 409, "name_taken")
            bob.post("login", {"name": "字欧", "password": "wrong-pass"}, 401, "invalid_credentials")
            alice.post("action", {"type": [], "requestId": "invalid_kind_1"}, 400, "invalid_action")
            alice.post("action", {"type": "settle"}, 400, "request_id_required")
            alice.post("logout", {}, 403, "invalid_origin", headers={"Origin": "https://evil.example"})
            alice.post("logout", {}, 415, "invalid_content_type", headers={"Content-Type": "text/plain"})
            alice.post("logout", {}, 403, "invalid_host", headers={"Host": "evil.example"})
            alice.action("settle", x=1, y=1, request_id="settle_alice_1")
            alice.post("action", {"type": "build", "building": "farm", "requestId": "wrong_account_1", "accountName": "李总"},
                       409, "account_mismatch")
            resources = dict(alice.get()["self"]["resources"])
            replay = alice.action("settle", x=1, y=1, request_id="settle_alice_1")
            check(replay.get("replayed") and replay["state"]["self"]["resources"] == resources, "settle idempotency")
            reordered = {"y": 1, "x": 1, "requestId": "settle_alice_1", "type": "settle", "accountName": "字欧"}
            check(alice.post("action", reordered).get("replayed"), "key order does not change idempotent fingerprint")
            alice.action("settle", x=2, y=2, request_id="settle_alice_1", expected=409, code="request_conflict")
            bob.action("settle", x=1, y=1, expected=409, code="plot_occupied")
            check(bob.get()["self"]["resources"] == WORLD.RULES["initialResources"], "conflict must not spend resources")
            bob.action("settle", x=2, y=1, request_id="settle_alice_1")
            alice.action("build", building="farm")
            alice.action("build", building="barracks")
            bob.action("build", building="wall")
            alice.action("build", building="farm", expected=400, code="keep_required")
            alice.action("train", unit="infantry", count=-1, expected=400, code="invalid_input")
            alice.action("train", unit="infantry", count=30, request_id="train_alice_1")
            training_state = alice.get()["self"]
            check(training_state["troops"]["infantry"] == 0 and len(training_state["queues"]) == 1, "training requires elapsed time")
            alice.action("train", unit="infantry", count=30, request_id="train_alice_1")
            check(len(alice.get()["self"]["queues"]) == 1, "training idempotency")
            alice.action("train", unit="cavalry", count=100, expected=400, code="insufficient_resources")
            alice.action("attack", targetId=bob_id, expected=400, code="target_protected")
            alice.action("attack", targetId=alice_id, expected=400, code="invalid_target")
            alice.action("attack", targetId="unknown_player", expected=404, code="target_missing")
            alice.post("campaign/start", {"stage": 2, "name": "字欧"}, 400, "stage_locked")
            alice.post("campaign/start", {"stage": 1, "name": "李总"}, 409, "account_mismatch")
            ticket = alice.post("campaign/start", {"stage": 1, "name": "字欧"})["ticket"]
            alice.post("campaign/claim", {"ticket": ticket, "name": "字欧"}, 400, "claim_too_early")
            alice.post("campaign/claim", {"ticket": ticket, "name": "李总"}, 409, "account_mismatch")
            bob.post("campaign/claim", {"ticket": ticket, "name": "李总"}, 404, "invalid_ticket")
            clock[0] += 60001
            newer_ticket = alice.post("campaign/start", {"stage": 1, "name": "字欧"})["ticket"]
            before_reward = alice.get()["self"]["resources"]
            claimed = alice.post("campaign/claim", {"ticket": ticket, "name": "字欧", "wood": 999999999})
            check(claimed["rewards"] == WORLD.campaign_reward(1), "client quantities cannot forge reward")
            check(claimed["state"]["self"]["unlockedStage"] == 2, "sequential server unlock")
            check(all(claimed["state"]["self"]["resources"][key] == before_reward[key] + value for key, value in claimed["rewards"].items()), "fixed reward credits")
            duplicated = alice.post("campaign/claim", {"ticket": ticket, "name": "字欧"})
            check(duplicated.get("replayed") and duplicated["state"]["self"]["resources"] == claimed["state"]["self"]["resources"], "claim exactly once")
            alice.post("campaign/claim", {"ticket": newer_ticket, "name": "字欧"}, 400, "claim_too_early")
            clock[0] += 60001
            alice.post("campaign/claim", {"ticket": newer_ticket, "name": "字欧"})
            third = alice.post("campaign/start", {"stage": 2, "name": "字欧"})["ticket"]
            clock[0] += 60000
            fourth = alice.post("campaign/start", {"stage": 1, "name": "字欧"})["ticket"]
            clock[0] += 60000
            alice.post("campaign/claim", {"ticket": third, "name": "字欧"})
            alice.post("campaign/claim", {"ticket": fourth, "name": "字欧"}, 429, "claim_rate_limit")
            clock[0] += 120000
            check(alice.get()["self"]["troops"]["infantry"] == 30, "training completes once by server clock")
            check(alice.get()["self"]["troops"]["infantry"] == 30, "repeated state does not add troops again")
            guild = alice.action("guild-create", name="果园盟")["state"]["self"]["guildId"]
            bob.action("guild-join", guildId=guild)
            alice.action("attack", targetId=bob_id, expected=400, code="same_guild")
            bob.action("guild-donate", resource="grain", amount=400)
            bob.action("guild-donate", resource="wood", amount=100)
            check(bob.get()["guilds"][0]["level"] == 2, "guild donation upgrades guild")
            guild_balance = bob.get()["self"]["resources"]["grain"]
            bob.action("guild-donate", resource="grain", amount=1000, expected=400, code="insufficient_resources")
            check(bob.get()["self"]["resources"]["grain"] == guild_balance, "failed donation rolls back")
            bob.action("guild-leave")
            previous_bob = bob.get()["self"]
            battle = alice.action("attack", targetId=bob_id, request_id="attack_alice_1")["report"]
            check(battle["won"] and sum(battle["loot"].values()) > 0, "server resolves attack and loot")
            check(battle["loot"]["token"] == 0, "guild tokens cannot be stolen")
            bob_after = bob.get()["self"]
            check(all(previous_bob["resources"][key] - bob_after["resources"][key] == amount for key, amount in battle["loot"].items()), "defender loses exactly credited loot")
            check(len(alice.get()["reports"]) == 1 and len(bob.get()["reports"]) == 1, "both players see report")
            replay_attack = alice.action("attack", targetId=bob_id, request_id="attack_alice_1")
            check(replay_attack["replayed"] and replay_attack["report"]["id"] == battle["id"], "attack idempotency")
            check(len(bob.get()["reports"]) == 1, "repeated attack cannot duplicate reports or damage")
            alice.action("attack", targetId=bob_id, expected=400, code="attack_cooldown")
            check(alice.get()["self"]["home"]["protectedUntil"] <= clock[0], "attack ends own protection")
            check(bob_after["home"] is not None, "attacks do not destroy homes")
            serialized = json.dumps(alice.get())
            check("password_hash" not in serialized and "salt" not in serialized and "token_hash" not in serialized, "state must not disclose credentials")
            other = next(item for item in alice.get()["players"] if item["id"] == bob_id)
            check("resources" not in other and "queues" not in other, "other-player resources and queues remain private")
            # Competing real requests for a shared tile: exactly one transaction wins.
            competitors = [Client(server), Client(server)]
            for index, client in enumerate(competitors):
                client.post("register", {"name": f"并发{index}", "password": "concurrent-test"})
            def compete(client):
                value, _ = client.send("/api/world/action", {"type": "settle", "requestId": "contest_tile_1", "accountName": client.account_name, "x": 6, "y": 6}, expected=(200, 409))
                return True if value["ok"] else value["code"]
            with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
                results = list(pool.map(compete, competitors))
            check(results.count(True) == 1 and results.count("plot_occupied") == 1, "only one owner can claim contested plot")
            commander = competitors[results.index(True)]
            commander.action("build", building="barracks")
            commander.action("build", building="warehouse")
            for unit in WORLD.UNITS:
                commander.action("train", unit=unit, count=1)
            commander.action("train", unit="infantry", count=1, expected=400, code="queue_full")
            check(len(commander.get()["self"]["queues"]) == 3, "all three unit queues exist")
            clock[0] += 10001
            check(commander.get()["self"]["troops"] == {unit: 1 for unit in WORLD.UNITS}, "all three troop types complete")
            for stage in range(1, 11):
                run_ticket = commander.post("campaign/start", {"stage": stage, "name": commander.account_name})["ticket"]
                clock[0] += 60001
                commander.post("campaign/claim", {"ticket": run_ticket, "name": commander.account_name})
            before_keep = commander.get()["self"]["resources"]
            upgraded = commander.action("build", building="keep")["state"]["self"]
            check(upgraded["home"]["level"] == 2 and upgraded["home"]["buildings"]["keep"] == 2,
                  "main city upgrades consistently")
            check(all(before_keep[key] - upgraded["resources"][key] == amount for key, amount in WORLD.BUILD_COSTS["keep"][2].items()),
                  "upgrade deducts exact server cost")
            commander.action("guild-join", guildId=guild)
            alice.action("guild-leave")
            check(commander.get()["guilds"][0]["ownerId"] == commander.get()["self"]["id"], "owner leaving transfers leadership")
            commander.action("guild-leave")
            check(not commander.get()["guilds"], "last member leaving removes empty guild")
            for path in ("/.git/config", "/tools/world-server.py", "/.world-server-data/world.sqlite", "/../secret.env", "/%2e%2e/secret.env", "/secret.env", "/secret.js", "/assets/../../secret.env", "/world-server-verify.py"):
                alice.send(path, expected=404)
            check(b"world-test" in alice.send("/")[0], "static index is served")
            alice.send("/game.js")
            expired_ticket = alice.post("campaign/start", {"stage": 1, "name": "字欧"})["ticket"]
            clock[0] += WORLD.RULES["campaignTicketTtlMs"] + 1
            alice.post("campaign/claim", {"ticket": expired_ticket, "name": "字欧"}, 400, "ticket_expired")
            clock[0] += 31 * 3600000
            passive_state = alice.get()["self"]
            check(passive_state["resources"]["wood"] <= passive_state["capacity"] and passive_state["resources"]["grain"] <= passive_state["capacity"],
                  "offline farm income respects warehouse cap")
            check(alice.get()["self"]["resources"] == passive_state["resources"], "repeated refresh does not duplicate passive income")
            check(all(amount >= 0 for amount in alice.get()["self"]["resources"].values()), "balances never become negative")
            alice_cookie = next(cookie.value for cookie in alice.jar if cookie.name == "orchard_world")
            alice_saved = alice.get()["self"]
            alice_jar = alice.jar
            bob.post("logout", {})
            check(bob.get()["self"] is None, "logout invalidates session")
            bob.post("action", {"type": "guild-leave", "requestId": "logout_check_1"}, 401, "login_required")
        # Reopen the actual database and HTTP service: no in-memory game state.
        reopened = WORLD.WorldStore(database, clock=lambda: clock[0])
        check(reopened.session_player(alice_cookie) == alice_id, "session survives server restart")
        with running(reopened, site) as restarted:
            restored = Client(restarted, jar=alice_jar).get()["self"]
            check(restored["id"] == alice_id and restored["resources"] == alice_saved["resources"] and restored["home"] == alice_saved["home"], "home/resource ownership persists after restart")
            Client(restarted).post("login", {"name": "李总", "password": "secret-bob"})
        with contextlib.closing(reopened.connect()) as connection:
            row = connection.execute("SELECT * FROM players WHERE id=?", (alice_id,)).fetchone()
            check(row["password_hash"] != "secret-alice" and len(row["salt"]) == 32 and len(row["password_hash"]) == 64, "password stored as salted PBKDF2")
            check(connection.execute("PRAGMA journal_mode").fetchone()[0] == "wal", "SQLite WAL mode")
        # Production origin + Secure flag, only trusting a loopback HTTPS proxy.
        with running(reopened, site, "https://game.example", True) as production:
            client = Client(production, public_origin="https://game.example")
            proxy_headers = {"Host": "game.example", "X-Forwarded-Proto": "https", "X-Real-IP": "203.0.113.9"}
            _, headers = client.send("/api/world/login", {"name": "字欧", "password": "secret-alice"}, proxy_headers)
            check("Secure" in headers.get("Set-Cookie", ""), "production cookies are Secure")
            client.post("login", {"name": "字欧", "password": "secret-alice"}, 403, "https_required", headers={"Host": "game.example"})
        check(WORLD.valid_name("É小树_1") and not WORLD.valid_name("<script") and not WORLD.valid_name("太长的名字不能用"), "Unicode name validation matches local account constraints")
    print(f"World server verification passed: {ASSERTIONS} assertions (HTTP, ownership, transactions, timing, persistence, safety).")


if __name__ == "__main__":
    main()
