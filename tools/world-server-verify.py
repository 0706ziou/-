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


def city_checks(root, site):
    clock = [1800010000000]
    store = WORLD.WorldStore(root / "city.sqlite", clock=lambda: clock[0])

    def fixture(player_id, change):
        # Fixtures touch only this temporary database; all asserted mutations use HTTP.
        with store.transaction() as connection:
            player = store.load(connection, player_id, tick=False)
            change(player)
            store.save(connection, player)

    with running(store, site) as server:
        alice, bob, visitor = Client(server), Client(server), Client(server)
        first, headers = alice.send("/api/world/enter", {"name": "城主甲", "password": "game-alice"})
        alice_id = first["state"]["self"]["id"]
        check("HttpOnly" in headers.get("Set-Cookie", ""), "unified entry uses protected cookie")
        repeated = alice.post("enter", {"name": "城主甲", "password": "game-alice"})
        check(repeated["state"]["self"]["id"] == alice_id and repeated["state"]["self"]["resources"] == WORLD.RULES["initialResources"],
              "repeated entry authenticates without duplicating world")
        visitor.post("enter", {"name": "城主甲", "password": "wrong-pass"}, 409, "world_link_required")
        bob_id = bob.post("enter", {"name": "城主乙", "password": "game-bob"})["state"]["self"]["id"]
        bob.post("enter", {"name": "城主甲", "password": "wrong-pass"}, 409, "world_link_required")
        check(bob.get()["self"]["id"] == bob_id, "foreign cookie cannot change target identity or its password")
        copy_jar = http.cookiejar.CookieJar()
        for cookie in alice.jar:
            copy_jar.set_cookie(cookie)
        previous_session = Client(server, jar=copy_jar)
        changed = alice.post("enter", {"name": "城主甲", "password": "new-game-pass"})
        check(changed["state"]["self"]["id"] == alice_id, "owned cookie seamlessly merges old world account")
        check(previous_session.get()["self"] is None, "credential migration revokes old sessions")
        visitor.post("login", {"name": "城主甲", "password": "game-alice"}, 401, "invalid_credentials")
        visitor.post("link", {"name": "城主甲", "password": "final-game-pass", "worldPassword": "wrong-pass"}, 401, "invalid_credentials")
        check(alice.get()["self"]["id"] == alice_id, "failed link leaves active account intact")
        visitor.post("link", {"name": "城主甲", "password": "final-game-pass", "worldPassword": "new-game-pass"})
        check(alice.get()["self"] is None, "password verified link revokes old browser session")
        alice.post("enter", {"name": "城主甲", "password": "final-game-pass"})
        visitor.post("link", {"name": "城主甲", "password": "another-pass", "worldPassword": "new-game-pass"}, 401, "invalid_credentials")
        check(alice.post("enter", {"name": "城主甲", "password": "final-game-pass"})["state"]["self"]["id"] == alice_id,
              "old link cannot overwrite unified credential on repetition")
        visitor.post("enter", {"name": "新账号", "password": "new-game-pass"}, 403, "invalid_origin", headers={"Origin": "https://evil.example"})
        clock[0] += 60001
        competitors = [Client(server), Client(server)]
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            ids = list(pool.map(lambda client: client.post("enter", {"name": "并发城主", "password": "same-game-pass"})["state"]["self"]["id"], competitors))
        check(ids[0] == ids[1], "concurrent entry atomically creates a single shared account")
        with store.transaction() as connection:
            check(connection.execute("SELECT COUNT(*) FROM players WHERE name='并发城主'").fetchone()[0] == 1,
                  "concurrent registration has one stored identity")
        alice.action("settle", x=0, y=0)
        bob.action("settle", x=1, y=0)
        alice.action("build", building="farm")
        alice.action("build", building="lumbermill")
        alice.action("build", building="quarry")
        alice.action("build", building="ironworks")
        alice.action("harvest", building="keep", expected=400, code="invalid_building")
        before = alice.get()["self"]["resources"]
        clock[0] += 180000
        accumulated = alice.get()["self"]
        check(accumulated["resources"] == before, "reading state never auto-credits spendable building income")
        expected = {kind: rule["ratePerMinute"] * 3 for kind, rule in WORLD.PRODUCTION.items()}
        check(all(accumulated["home"]["production"][kind]["stored"] == amount for kind, amount in expected.items()),
              "four production buildings accumulate their own resources")
        check(alice.get()["self"]["home"]["production"] == accumulated["home"]["production"], "refresh never duplicates stored income")
        grain_only = alice.action("harvest", building="farm", request_id="harvest_farm_once")
        check(grain_only["harvested"]["grain"] == 24 and grain_only["state"]["self"]["resources"]["grain"] == before["grain"] + 24,
              "manual harvest moves only corresponding building resource")
        replay = alice.action("harvest", building="farm", request_id="harvest_farm_once")
        check(replay["replayed"] and replay["state"]["self"]["resources"] == grain_only["state"]["self"]["resources"], "harvest exactly once")
        all_income = alice.action("harvest-all", request_id="harvest_all_once")
        check(all_income["harvested"] == {"wood": 18, "stone": 15, "grain": 0, "iron": 9, "token": 0},
              "collect all transfers only accumulated independent resource amounts")
        check(alice.action("harvest-all", request_id="harvest_all_once")["replayed"], "collect all replay is harmless")

        def warehouse_full(player):
            limit = store.capacity(player)
            player["resources"]["wood"] = limit - 3
            player["production"]["lumbermill"]["stored"] = 20
        fixture(alice_id, warehouse_full)
        partial = alice.action("harvest", building="lumbermill")
        check(partial["harvested"]["wood"] == 3 and partial["state"]["self"]["home"]["production"]["lumbermill"]["stored"] == 17,
              "full warehouse preserves earned uncollected overflow")
        check(alice.action("harvest", building="lumbermill")["harvested"]["wood"] == 0, "full inventory cannot destroy or double-credit pending resources")
        fixture(alice_id, lambda player: player["resources"].update(wood=store.capacity(player) + 50))
        check(alice.action("harvest-all")["state"]["self"]["resources"]["wood"] == store.capacity(accumulated) + 50,
              "campaign inventory above warehouse cap is never clipped")
        fixture(alice_id, lambda player: player["resources"].update(wood=5000, stone=5000, grain=5000, iron=5000))
        alice.action("build", building="keep")
        alice.action("build", building="farm")
        upgraded = alice.get()["self"]
        check(upgraded["home"]["production"]["farm"]["ratePerMinute"] == 16, "production upgrade uses actual level")
        clock[0] += 60000
        check(alice.get()["self"]["home"]["production"]["farm"]["stored"] == 16, "upgrade begins future production without retroactive credit")
        before_offline = dict(alice.get()["self"]["resources"])
        clock[0] += 48 * 3600000
        offline = alice.get()["self"]
        check(offline["resources"] == before_offline and all(item["stored"] <= item["capacity"] for item in offline["home"]["production"].values()),
              "offline production caps pending stores without modifying inventory")
        alice.action("build", building="barracks")
        alice.action("train", unit="infantry", count=30)
        alice.action("train", unit="archer", count=10)
        alice.action("train", unit="cavalry", count=4)
        clock[0] += 150001
        squad = alice.action("squad-save", name="青叶先锋", units={"infantry": 10})["squadId"]
        reserve = alice.action("squad-save", name="后备队", units={"infantry": 10})["squadId"]
        third = alice.action("squad-save", name="机动队", units={"infantry": 5, "archer": 10, "cavalry": 4})["squadId"]
        alice.action("squad-save", name="第四队", units={"infantry": 1}, expected=400, code="squad_limit")
        alice.action("squad-save", squadId=squad, name="超编队", units={"infantry": 20}, expected=400, code="insufficient_troops")
        alice.action("squad-save", squadId=squad, name="负数队", units={"infantry": -1}, expected=400, code="invalid_input")
        alice.action("squad-save", squadId=squad, name="空队", units={}, expected=400, code="army_required")
        alice.action("squad-save", squadId=squad, name="异种队", units={"dragon": 1}, expected=400, code="invalid_units")
        alice.action("squad-save", squadId=squad, name="abcdefghijklmnop", units={"infantry": 1}, expected=400, code="invalid_squad_name")
        bob.action("build", building="barracks")
        bob.action("squad-delete", squadId=squad, expected=404, code="squad_missing")
        alice.action("attack", targetId=bob_id, squadId="foreign_squad", expected=404, code="squad_missing")
        battle = alice.action("attack", targetId=bob_id, squadId=squad, request_id="selected_squad_raid")
        report = battle["report"]
        check(report["squadId"] == squad and report["deployed"] == {"infantry": 10, "archer": 0, "cavalry": 0}, "selected squad alone participates in attack")
        after = battle["state"]["self"]
        check(after["troops"]["infantry"] == 30 - report["losses"]["infantry"] and next(item for item in after["squads"] if item["id"] == reserve)["units"]["infantry"] == 10,
              "selected casualties reduce trained troops without harming idle reserve")
        check(next(item for item in after["squads"] if item["id"] == squad)["units"]["infantry"] == 10 - report["losses"]["infantry"], "selected squad records its own casualties")
        check(alice.action("attack", targetId=bob_id, squadId=squad, request_id="selected_squad_raid")["replayed"], "selected attack idempotent")
        fixture(bob_id, lambda player: player["resources"].update(wood=5000, grain=5000, iron=5000))
        bob.action("train", unit="archer", count=20)
        clock[0] += 140001
        bob.action("squad-save", name="守军甲", units={"archer": 10})
        bob.action("squad-save", name="守军乙", units={"archer": 10})
        alice.action("attack", targetId=bob_id)
        defense = bob.get()["self"]
        check(all(sum(item["units"][unit] for item in defense["squads"]) <= defense["troops"][unit] for unit in WORLD.UNITS),
              "defender casualties reconcile reservations without nonexistent soldiers")
        attack_state = alice.get()["self"]
        check(all(sum(item["units"][unit] for item in attack_state["squads"]) <= attack_state["troops"][unit] for unit in WORLD.UNITS),
              "all-army compatibility attack preserves valid squad allocations")
        alice.action("squad-delete", squadId=third, request_id="delete_squad_once")
        check(alice.action("squad-delete", squadId=third, request_id="delete_squad_once")["replayed"], "squad delete exactly once")
        free = alice.get()["self"]
        available = {unit: free["troops"][unit] - sum(item["units"][unit] for item in free["squads"]) for unit in WORLD.UNITS}
        check(sum(available.values()) > 0, "deleting a squad frees its surviving soldiers")
        replaced = alice.action("squad-save", name="新编队", units=available, request_id="replace_squad_once")
        check(len(replaced["state"]["self"]["squads"]) == 3 and alice.action("squad-save", name="新编队", units=available, request_id="replace_squad_once")["squadId"] == replaced["squadId"],
              "freed soldiers can be regrouped once with idempotent save")

        def legacy(player):
            player.pop("production", None)
            player.pop("squads", None)
            player["home"]["buildings"] = {"keep": 1, "farm": 1, "warehouse": 0, "wall": 0, "barracks": 1}
            player["home"]["level"] = 1
            player["productionAt"] = clock[0] - 180000
            player["resources"] = {"wood": 200, "stone": 190, "grain": 180, "iron": 170, "token": 10}
            player["queues"] = [{"id": "legacy_training", "unit": "infantry", "count": 2, "readyAt": clock[0] + 60000}]
        fixture(bob_id, legacy)
        legacy_troops = dict(bob.get()["self"]["troops"])
        migrated = bob.get()["self"]
        check(migrated["resources"] == {"wood": 200, "stone": 190, "grain": 180, "iron": 170, "token": 10}, "legacy inventory remains unchanged by migration")
        check(migrated["home"]["production"]["farm"]["stored"] == 24 and migrated["home"]["production"]["lumbermill"]["stored"] == 12,
              "legacy elapsed farm grain and wood become pending exactly once")
        check(migrated["troops"] == legacy_troops and len(migrated["queues"]) == 1 and migrated["squads"] == [], "migration preserves troops and training queues")
        check(bob.get()["self"]["home"]["production"] == migrated["home"]["production"], "legacy pending cannot replay on refresh")
        check(bob.action("harvest", building="lumbermill")["harvested"]["wood"] == 12, "legacy wood remains collectable before mill construction")
        check(bob.action("harvest-all")["harvested"]["grain"] == 24, "legacy grain becomes spendable only after manual collection")
        producer = competitors[0]
        producer_id = producer.get()["self"]["id"]
        producer.action("settle", x=2, y=0)
        def large_capacity(player):
            player["home"]["buildings"].update(keep=5, warehouse=5, ironworks=1)
            player["home"]["level"] = 5
        fixture(producer_id, large_capacity)
        before_production = producer.get()["self"]["resources"]
        clock[0] += 48 * 3600000
        capped_day = producer.get()["self"]
        check(capped_day["home"]["production"]["ironworks"]["stored"] == 3 * 1440,
              "offline accrual accounts at most 24 hours even below warehouse limit")
        check(capped_day["resources"] == before_production, "large-capacity offline income remains pending until collection")
        saved, jar = alice.get()["self"], alice.jar
        stored_cookie = next(cookie.value for cookie in jar if cookie.name == "orchard_world")
    reopened = WORLD.WorldStore(store.database, clock=lambda: clock[0])
    check(reopened.session_player(stored_cookie) == alice_id, "unified session persists across restart")
    with running(reopened, site) as restarted:
        restored = Client(restarted, jar=jar).get()["self"]
        check(restored["squads"] == saved["squads"] and restored["home"]["production"] == saved["home"]["production"],
              "pending production and squad composition survive restart")
        Client(restarted).post("enter", {"name": "城主甲", "password": "final-game-pass"})


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
        city_checks(root, site)
    print(f"World server verification passed: {ASSERTIONS} assertions (HTTP, ownership, transactions, timing, persistence, safety).")


if __name__ == "__main__":
    main()
