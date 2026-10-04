#!/usr/bin/env python3
"""Real HTTP/SQLite checks for campaign completion and the public leaderboard.

All accounts, tickets and clocks below are isolated temporary fixtures. No live
server, user save or production resource balance is read or modified.
"""
import contextlib
import http.cookiejar
import importlib.util
import json
import tempfile
import threading
import urllib.error
import urllib.request
from pathlib import Path

SPEC = importlib.util.spec_from_file_location("orchard_leaderboard_world", Path(__file__).with_name("world-server.py"))
WORLD = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(WORLD)
ASSERTIONS = 0
PUBLIC_KEYS = {"rank", "playerId", "name", "highestStage", "reachedAt", "isSelf"}


def check(condition, message):
    global ASSERTIONS
    ASSERTIONS += 1
    if not condition:
        raise AssertionError(message)


class Client:
    def __init__(self, server):
        self.base = f"http://127.0.0.1:{server.server_address[1]}"
        self.jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))

    def send(self, path, payload=None, expected=200, code=None):
        headers = {"Origin": self.base}
        if payload is not None:
            headers["Content-Type"] = "application/json"
        request = urllib.request.Request(self.base + "/api/world/" + path,
            data=json.dumps(payload).encode() if payload is not None else None, headers=headers)
        try:
            response = self.opener.open(request, timeout=10)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            value = json.loads(response.read())
            check(response.status == expected, f"{path}: expected HTTP {expected}, got {response.status}: {value}")
            if path.startswith("leaderboard"):
                check(response.headers.get("Cache-Control") == "no-store", "rank and self response are never cached across accounts")
        if code:
            check(value.get("code") == code, f"{path}: expected {code}, got {value}")
        else:
            check(value.get("ok") is True, f"{path}: unsuccessful response {value}")
        return value

    def board(self, query=""):
        return self.send("leaderboard" + query)["leaderboard"]


@contextlib.contextmanager
def running(store, site):
    server = WORLD.WorldHTTPServer(("127.0.0.1", 0), store, site)
    previous = WORLD.WorldHandler.log_message
    WORLD.WorldHandler.log_message = lambda *args: None
    thread = threading.Thread(target=server.serve_forever, kwargs={"poll_interval": .05}, daemon=True)
    thread.start()
    try:
        yield server
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)
        WORLD.WorldHandler.log_message = previous


def run_checks(root):
    site = root / "site"
    site.mkdir()
    (site / "index.html").write_text("<!doctype html><title>Temporary leaderboard verification</title>", encoding="utf-8")
    clock = [1800010000000]
    store = WORLD.WorldStore(root / "world.sqlite", clock=lambda: clock[0])

    def row_for(board, player_id):
        return next((item for item in board["entries"] if item["playerId"] == player_id), None)

    def snapshot():
        with contextlib.closing(store.connect()) as connection:
            return {table: [tuple(row) for row in connection.execute(f"SELECT * FROM {table} ORDER BY 1")]
                    for table in ("players", "campaigns", "campaign_completions", "sessions")}

    def historical_player(player_id, name, stage=None, reached_at=None, unlocked=1):
        with store.transaction() as connection:
            player = {"id": player_id, "name": name, "resources": dict(WORLD.RULES["initialResources"]),
                      "home": None, "troops": {kind: 0 for kind in WORLD.UNITS}, "queues": [], "squads": [],
                      "guildId": None, "unlockedStage": unlocked, "attackReadyAt": 0,
                      "defenseReadyAt": 0, "productionAt": clock[0], "createdAt": clock[0]}
            connection.execute("INSERT INTO players VALUES(?,?,?,?,?)",
                               (player_id, name, "11" * 16, "private-test-password-hash", WORLD.dumps(player)))
            if stage is not None:
                connection.execute("INSERT INTO campaigns VALUES(?,?,?,?,?,?,?)",
                    ("historical-" + player_id, player_id, stage, reached_at - 60000, reached_at + 7200000,
                     reached_at, WORLD.dumps(WORLD.campaign_reward(stage))))

    with running(store, site) as server:
        alice, bob, visitor = Client(server), Client(server), Client(server)
        empty = visitor.board()
        check(empty["entries"] == [] and empty["self"] is None and empty["totalPlayers"] == 0,
              "new database returns an empty public board")
        check((empty["page"], empty["pageSize"], empty["totalPages"]) == (1, 20, 1), "empty paging contract is stable")

        registered = alice.send("register", {"name": "通关甲", "password": "alice-password"})
        alice_id = registered["state"]["self"]["id"]
        bob_id = bob.send("register", {"name": "通关乙", "password": "bob-password"})["state"]["self"]["id"]
        zero = visitor.board()
        check(zero["entries"] == [] and zero["self"] is None and zero["totalPlayers"] == 0,
              "accounts without any successful clear are excluded from public ranks and counts")
        zero_self = alice.board()["self"]
        check(zero_self["rank"] == 0 and zero_self["highestStage"] == 0 and zero_self["reachedAt"] is None
              and zero_self["isSelf"], "zero-stage account receives an unranked personal row without a false medal")
        check(set(zero_self) == PUBLIC_KEYS, "unranked personal row exposes only allowed ranking fields")

        ticket_one = alice.send("campaign/start", {"stage": 1, "name": "通关甲"})["ticket"]
        alice.send("campaign/claim", {"ticket": ticket_one, "name": "通关甲"}, 400, "claim_too_early")
        check(alice.board()["self"]["highestStage"] == 0, "failed early reward claim does not create a score")
        visitor.send("campaign/complete", {"ticket": ticket_one, "name": "通关甲"}, 401, "login_required")
        bob.send("campaign/complete", {"ticket": ticket_one, "name": "通关乙"}, 404, "invalid_ticket")
        alice.send("campaign/complete", {"ticket": ticket_one, "name": "错误名字"}, 409, "account_mismatch")
        check(alice.board()["self"]["highestStage"] == 0, "ownership and name failures cannot increase a score")

        initial_resources = registered["state"]["self"]["resources"]
        completed_one = alice.send("campaign/complete", {"ticket": ticket_one, "name": "通关甲", "stage": 100, "highestStage": 100})
        check(completed_one["completedStage"] == 1 and completed_one["completedAt"] == clock[0], "completion ignores injected stage and uses signed ticket stage")
        check(completed_one["state"]["self"]["unlockedStage"] == 2, "immediate campaign completion unlocks the next campaign")
        check(completed_one["state"]["self"]["resources"] == initial_resources and "rewards" not in completed_one,
              "ranking completion never grants world materials")
        one = alice.board()
        check(one["self"]["highestStage"] == 1 and one["self"]["reachedAt"] == clock[0], "victory enters the leaderboard immediately before 60 seconds")

        # The existing 5-second ticket-start throttle is preserved; a real play
        # session lasts beyond it even when it wins before the reward minimum.
        clock[0] += 5001
        repeated_one = alice.send("campaign/complete", {"ticket": ticket_one, "name": "通关甲"})
        check(repeated_one.get("replayed") and repeated_one["completedAt"] == completed_one["completedAt"], "duplicate completion is idempotent with the first arrival time")
        ticket_two = alice.send("campaign/start", {"stage": 2, "name": "通关甲"})["ticket"]
        completed_two = alice.send("campaign/complete", {"ticket": ticket_two, "name": "通关甲"})
        check(completed_two["state"]["self"]["unlockedStage"] == 3 and completed_two["completedStage"] == 2,
              "a fast first win can immediately progress to stage 2 without waiting for world rewards")
        check(completed_two["state"]["self"]["resources"] == initial_resources, "consecutive fast victories do not grant resources")
        first_two_at = completed_two["completedAt"]
        alice.send("campaign/claim", {"ticket": ticket_two, "name": "通关甲"}, 400, "claim_too_early")
        check(alice.board()["self"]["highestStage"] == 2, "world reward timing does not hide a completed stage")

        clock[0] += 60000
        claimed_one = alice.send("campaign/claim", {"ticket": ticket_one, "name": "通关甲", "stage": 100})
        check(claimed_one["rewards"] == WORLD.campaign_reward(1), "completion still leaves world reward stage server controlled")
        alice.send("campaign/claim", {"ticket": ticket_two, "name": "通关甲"}, 429, "claim_rate_limit")
        check(alice.board()["self"]["reachedAt"] == first_two_at, "delayed and failed reward claims preserve completion arrival time")
        clock[0] += 60000
        claimed_two = alice.send("campaign/claim", {"ticket": ticket_two, "name": "通关甲"})
        replayed = alice.send("campaign/claim", {"ticket": ticket_two, "name": "通关甲"})
        check(replayed.get("replayed") and replayed["state"]["self"]["resources"] == claimed_two["state"]["self"]["resources"],
              "duplicate successful claims never grant rewards twice")
        check(alice.board()["self"]["reachedAt"] == first_two_at, "duplicate reward redemption never replaces first arrival time")

        ticket_lower = alice.send("campaign/start", {"stage": 1, "name": "通关甲"})["ticket"]
        clock[0] += 10
        alice.send("campaign/complete", {"ticket": ticket_lower, "name": "通关甲"})
        check(alice.board()["self"]["highestStage"] == 2 and alice.board()["self"]["reachedAt"] == first_two_at,
              "replaying a lower stage cannot reduce the best clear or change its arrival")
        clock[0] += 5001
        ticket_expired = alice.send("campaign/start", {"stage": 3, "name": "通关甲"})["ticket"]
        clock[0] += WORLD.RULES["campaignTicketTtlMs"] + 1
        alice.send("campaign/complete", {"ticket": ticket_expired, "name": "通关甲"}, 400, "ticket_expired")
        check(alice.board()["self"]["highestStage"] == 2, "expired uncompleted tickets cannot increase score")
        after_expiry_replay = alice.send("campaign/complete", {"ticket": ticket_two, "name": "通关甲"})
        check(after_expiry_replay.get("replayed") and after_expiry_replay["completedAt"] == first_two_at,
              "a prior completed ticket stays idempotent after its expiry")

        # Legacy successful claims and payloads predate the completion table.
        # They must contribute without an upload, migration or client claim.
        historical_player("000000000000000000000001", "较晚百关", 100, 2000, 100)
        historical_player("ffffffffffffffffffffffff", "最早百关", 100, 1000, 100)
        historical_player("000000000000000000000003", "已开百关", 99, 800, 100)
        historical_player("000000000000000000000004", "尚未通关", None, None, 100)
        for index in range(25):
            historical_player(f"100000000000000000000{index:03d}", f"玩家{index}", 1, 500, 2)
        board = visitor.board()
        check([item["name"] for item in board["entries"][:3]] == ["最早百关", "较晚百关", "已开百关"],
              "highest-stage sorting uses earlier arrival before stable player ID")
        check([item["rank"] for item in board["entries"][:4]] == [1, 1, 3, 4], "equal-stage competition ranks are 1,1,3,4")
        check([item["highestStage"] for item in board["entries"][:4]] == [100, 100, 99, 2], "actual stage 100 clear differs from only unlocking stage 100")
        check(board["totalPlayers"] == 29 and board["totalPages"] == 2 and len(board["entries"]) == 20,
              "twenty-row paging counts only accounts with actual completed stages")
        remaining = visitor.board("?page=2")
        check(len(remaining["entries"]) == 9 and remaining["page"] == 2, "second page contains only the remaining rows")
        all_entries = board["entries"] + remaining["entries"]
        check(len({item["playerId"] for item in all_entries}) == 29, "pagination has no duplicate or missing ranked account")
        check(not any(item["name"] == "尚未通关" for item in all_entries), "forged or legacy unlockedStage payload is never a ranking source")
        check(all_entries[4:] == sorted(all_entries[4:], key=lambda item: item["playerId"]), "equal-stage and arrival tied pages retain stable ID order")
        myself = bob.board()
        check(myself["self"]["playerId"] == bob_id and myself["self"]["isSelf"] and myself["self"]["highestStage"] == 0
              and myself["self"]["rank"] == 0,
              "authenticated unranked account receives its own row without entering the public list")
        # The personal row is also available beyond the current final page.
        beyond = bob.board("?page=1000000")
        check(beyond["entries"] == [] and beyond["self"] == myself["self"], "out-of-page self result is returned even beyond the final page")
        check(all(set(item) == PUBLIC_KEYS for item in all_entries) and set(myself["self"]) == PUBLIC_KEYS,
              "all historical and personalized ranking rows retain the privacy allowlist")

        offpage = Client(server)
        offpage_id = offpage.send("register", {"name": "榜外玩家", "password": "offpage-password"})["state"]["self"]["id"]
        offpage_ticket = offpage.send("campaign/start", {"stage": 1, "name": "榜外玩家"})["ticket"]
        offpage.send("campaign/complete", {"ticket": offpage_ticket, "name": "榜外玩家"})
        offpage_board = offpage.board()
        check(offpage_board["self"]["rank"] == 5 and offpage_board["self"]["highestStage"] == 1
              and not any(item["playerId"] == offpage_id for item in offpage_board["entries"]),
              "ranked account on the second page still receives its own rank on page 1")
        offpage_second = offpage.board("?page=2")
        offpage_row = row_for(offpage_second, offpage_id)
        check(offpage_row == offpage_second["self"] and offpage_row["isSelf"],
              "account's page entry and separate self row are identical")

        before = snapshot()
        forged = visitor.board("?highestStage=100&stage=100&pageSize=1000")
        check(forged["pageSize"] == 20 and forged["entries"] == board["entries"], "client score and page-size query parameters cannot alter board results")
        check(snapshot() == before, "anonymous leaderboard GET is fully read-only")
        for query in ("?page=0", "?page=-1", "?page=1.5", "?page=", "?page=01", "?page=true",
                      "?page=1000001", "?page=" + "9" * 220, "?page=1&page=2", "?" + "a=1&" * 9,
                      "?page=" + "9" * 500):
            visitor.send("leaderboard" + query, expected=400, code="invalid_input")
        invalid_session = Client(server)
        invalid_session.opener.addheaders = [("Cookie", "orchard_world=invalid-session-value")]
        check(invalid_session.board()["self"] is None, "invalid or expired session cannot personalize another player's row")

        with store.transaction() as connection:
            # Issue a deliberately inconsistent temporary ticket: the server must
            # still reject a stage no longer allowed by current progression.
            connection.execute("INSERT INTO campaigns(ticket,player_id,stage,started_at,expires_at) VALUES(?,?,?,?,?)",
                ("locked-ticket-fixture-" + "x" * 20, bob_id, 2, clock[0], clock[0] + 60000))
        bob.send("campaign/complete", {"ticket": "locked-ticket-fixture-" + "x" * 20, "name": "通关乙"}, 400, "stage_locked")
        check(bob.board()["self"]["highestStage"] == 0, "stage permission rejection records no completion")

        # Stage 100's real HTTP completion cannot turn into stage 99 at the cap.
        with store.transaction() as connection:
            player = store.load(connection, bob_id, tick=False)
            player["unlockedStage"] = 100
            store.save(connection, player)
        clock[0] += 5001
        ticket_hundred = bob.send("campaign/start", {"stage": 100, "name": "通关乙"})["ticket"]
        hundred = bob.send("campaign/complete", {"ticket": ticket_hundred, "name": "通关乙"})
        hundred_board = bob.board()
        check(hundred["state"]["self"]["unlockedStage"] == 100 and hundred_board["self"]["highestStage"] == 100,
              "server-confirmed highest 100 is represented exactly, independently of capped unlock")
        check(hundred_board["self"]["rank"] == 1 and hundred_board["entries"][3]["rank"] == 4,
              "new stage-100 tie updates competition ranks across all records")

        # A historical already-redeemed ticket behaves as an idempotent clear,
        # even if its original expiry has passed, preserving its historical time.
        with store.transaction() as connection:
            old_ticket = "legacy-claimed-ticket-" + "y" * 20
            connection.execute("INSERT INTO campaigns VALUES(?,?,?,?,?,?,?)",
                (old_ticket, bob_id, 99, 1000, 2000, 1500, WORLD.dumps(WORLD.campaign_reward(99))))
        old_complete = bob.send("campaign/complete", {"ticket": old_ticket, "name": "通关乙"})
        check(old_complete.get("replayed") and old_complete["completedAt"] == 1500, "historical claimed records do not acquire a new arrival time")
        check(bob.board()["self"]["highestStage"] == 100, "old successful ticket cannot lower a newer best clear")

        with contextlib.closing(store.connect()) as connection:
            indexes = {row[1] for row in connection.execute("PRAGMA index_list('campaigns')")}
            completion_indexes = {row[1] for row in connection.execute("PRAGMA index_list('campaign_completions')")}
            check("campaigns_leaderboard" in indexes and "campaign_completions_leaderboard" in completion_indexes,
                  "highest-stage and arrival aggregation have covering indexes")
            query_plan = connection.execute("EXPLAIN QUERY PLAN SELECT player_id,stage,claimed_at FROM campaigns WHERE claimed_at IS NOT NULL").fetchall()
            check(any("campaigns_leaderboard" in row[3] for row in query_plan), "legacy claimed scan uses its partial covering index")

        # Both GET endpoints share the existing read bucket, so the new public
        # endpoint does not provide an unlimited alternate polling route.
        with server.rate_lock:
            server.rate_buckets[('127.0.0.1', 'read')] = [WORLD.time.monotonic()] * 240
        visitor.send("leaderboard", expected=429, code="rate_limited")
        visitor.send("state", expected=429, code="rate_limited")

    # Opening an existing schema-1 database restores the additive completion
    # table/index without deleting or resetting any historical claimed score.
    with contextlib.closing(store.connect()) as connection:
        connection.execute("DROP INDEX campaigns_leaderboard")
        connection.execute("DROP INDEX campaign_completions_leaderboard")
        connection.commit()
    reopened = WORLD.WorldStore(root / "world.sqlite", clock=lambda: clock[0])
    migrated = reopened.leaderboard()
    check(migrated["leaderboard"]["entries"][0]["name"] == "最早百关", "existing schema-1 claimed history survives initialization")
    with contextlib.closing(reopened.connect()) as connection:
        check(connection.execute("SELECT value FROM metadata WHERE key='schema'").fetchone()[0] == "1", "additive leaderboard migration retains schema compatibility")

    legacy_database = root / "legacy.sqlite"
    with contextlib.closing(store.connect()) as source, contextlib.closing(WORLD.sqlite3.connect(legacy_database)) as legacy:
        source.backup(legacy)
        legacy.execute("DROP TABLE campaign_completions")
        legacy.execute("DROP INDEX campaigns_leaderboard")
        legacy.commit()
    legacy_store = WORLD.WorldStore(legacy_database, clock=lambda: clock[0])
    legacy_board = legacy_store.leaderboard()["leaderboard"]
    check(legacy_board["entries"][0]["name"] == "最早百关" and legacy_board["entries"][0]["highestStage"] == 100,
          "old database without completion table creates it and immediately exposes historical stage-100 claims")
    with contextlib.closing(legacy_store.connect()) as connection:
        check(connection.execute("SELECT COUNT(*) FROM campaign_completions").fetchone()[0] == 0,
              "initializing an old database does not invent any campaign completion")


if __name__ == "__main__":
    with tempfile.TemporaryDirectory(prefix="orchard-leaderboard-check-") as temporary:
        run_checks(Path(temporary))
    print(json.dumps({"valid": True, "assertions": ASSERTIONS, "suite": "leaderboard-http-sqlite"}))
