#!/usr/bin/env python3
"""Shared Orchard world: standard-library HTTP, authenticated sessions and SQLite.

The local campaign still runs in a browser. Reward tickets enforce fixed rewards,
account ownership, elapsed time and progression; they are not a server simulation
of combat and cannot prove that a modified client actually defeated a boss.
"""
import argparse
import contextlib
import hashlib
import hmac
import ipaddress
import json
import math
import mimetypes
import re
import secrets
import sqlite3
import threading
import time
import unicodedata
from http import HTTPStatus
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlsplit

VERSION = "orchard-world-1"
RESOURCE_KEYS = ("wood", "stone", "grain", "iron", "token")
UNITS = {
    "infantry": {"name": "青叶步兵", "cost": {"grain": 8, "wood": 3}, "seconds": 5, "power": 3},
    "archer": {"name": "果核弓兵", "cost": {"grain": 10, "wood": 5, "iron": 2}, "seconds": 7, "power": 4},
    "cavalry": {"name": "疾风骑兵", "cost": {"grain": 16, "wood": 4, "iron": 5}, "seconds": 10, "power": 6},
}
BASE_COSTS = {
    "keep": {"wood": 100, "stone": 120, "iron": 10},
    "farm": {"wood": 65, "stone": 25},
    "lumbermill": {"wood": 55, "stone": 35},
    "quarry": {"wood": 75, "stone": 30},
    "ironworks": {"wood": 85, "stone": 65, "iron": 10},
    "warehouse": {"wood": 70, "stone": 55},
    "wall": {"wood": 45, "stone": 90, "iron": 10},
    "barracks": {"wood": 90, "stone": 55, "iron": 20},
}
PRODUCTION = {
    "farm": {"resource": "grain", "ratePerMinute": 8},
    "lumbermill": {"resource": "wood", "ratePerMinute": 6},
    "quarry": {"resource": "stone", "ratePerMinute": 5},
    "ironworks": {"resource": "iron", "ratePerMinute": 3},
}
SETTLE_COST = {"wood": 120, "stone": 80}
BUILD_COSTS = {kind: [None] + [{key: amount * level * level for key, amount in base.items()}
                              for level in range(1, 6)] for kind, base in BASE_COSTS.items()}
RULES = {
    "version": VERSION, "buildMaxLevel": 5, "maxTrainCount": 100, "maxQueues": 3, "maxSquads": 3,
    "production": PRODUCTION,
    "mapWidth": 16, "mapHeight": 16, "protectionMs": 300000, "attackCooldownMs": 120000,
    "defenderCooldownMs": 60000, "campaignMinimumMs": 60000, "campaignTicketTtlMs": 7200000,
    "campaignMaxStage": 100, "campaignClaimCooldownMs": 60000, "training": UNITS,
    "costs": {"settle": SETTLE_COST, "buildings": BUILD_COSTS,
              "guildCreate": {"token": 10, "wood": 100}, "guildDonate": {"min": 10, "max": 1000}},
    "resourceNames": {"wood": "木材", "stone": "石料", "grain": "粮草", "iron": "铁矿", "token": "世界令"},
    "buildingNames": {"keep": "主城", "farm": "农田", "lumbermill": "伐木场", "quarry": "采石场", "ironworks": "铁矿场",
                      "warehouse": "仓库", "wall": "城墙", "barracks": "兵营"},
    "initialResources": {"wood": 400, "stone": 350, "grain": 450, "iron": 150, "token": 25},
    "notes": ["游戏登录会自动进入对应世界账号，通关可获世界物资。", "世界物资不影响局内战斗、装备或英雄养成。",
              "生产建筑每分钟积累对应物资，最多补计24小时；返回主城手动收取，仓库满时保留未收取物资。",
              "最多编组3支小队，同一士兵不能重复编组；攻打可选择小队，会发生伤亡并解除自己的新手保护。",
              "胜利可掠夺部分物资，不能永久摧毁家园；同公会成员免战。",
              "关卡仍由本地浏览器运行；奖励票据的时间与次数限制不等于完整反作弊。"],
}
REQUEST_PATTERN = re.compile(r"[A-Za-z0-9_-]{8,96}\Z")
SESSION_SECONDS = 7 * 24 * 3600
PBKDF_ROUNDS = 240000
LEADERBOARD_PAGE_SIZE = 20
LEADERBOARD_MAX_PAGE = 1000000


class WorldError(Exception):
    def __init__(self, code, message, status=400):
        self.code, self.message, self.status = code, message, status
        super().__init__(message)


def require(condition, code, message, status=400):
    if not condition:
        raise WorldError(code, message, status)


def integer(value, low, high, label):
    require(type(value) is int and low <= value <= high, "invalid_input", f"{label}必须是{low}至{high}的整数。")
    return value


def dumps(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False)


def valid_name(value):
    return (isinstance(value, str) and 1 <= len(value) <= 7 and value == unicodedata.normalize("NFC", value)
            and all(char == "_" or unicodedata.category(char)[0] in ("L", "N") for char in value))


def valid_password(value):
    return (isinstance(value, str) and 6 <= len(value) <= 64
            and not any(unicodedata.category(char) == "Cs" for char in value))


def password_hash(password, salt):
    return hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), bytes.fromhex(salt), PBKDF_ROUNDS).hex()


def campaign_reward(stage):
    return {"wood": 45 + stage * 3, "stone": 35 + stage * 2,
            "grain": 60 + stage * 4, "iron": 8 + stage, "token": 1 + stage // 10}


class WorldStore:
    def __init__(self, database, clock=None):
        self.database = str(Path(database).resolve())
        self.clock = clock or (lambda: int(time.time() * 1000))
        Path(self.database).parent.mkdir(parents=True, exist_ok=True)
        with contextlib.closing(self.connect()) as connection:
            connection.execute("PRAGMA journal_mode=WAL")
            connection.executescript("""
                CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS players(id TEXT PRIMARY KEY,name TEXT UNIQUE NOT NULL,
                    salt TEXT NOT NULL,password_hash TEXT NOT NULL,payload TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,player_id TEXT NOT NULL,
                    expires_at INTEGER NOT NULL);
                CREATE TABLE IF NOT EXISTS plots(x INTEGER NOT NULL,y INTEGER NOT NULL,
                    player_id TEXT UNIQUE NOT NULL,PRIMARY KEY(x,y));
                CREATE TABLE IF NOT EXISTS guilds(id TEXT PRIMARY KEY,name TEXT UNIQUE NOT NULL,
                    owner_id TEXT NOT NULL,payload TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS requests(player_id TEXT NOT NULL,request_id TEXT NOT NULL,
                    fingerprint TEXT NOT NULL,result TEXT NOT NULL,at INTEGER NOT NULL,
                    PRIMARY KEY(player_id,request_id));
                CREATE TABLE IF NOT EXISTS campaigns(ticket TEXT PRIMARY KEY,player_id TEXT NOT NULL,
                    stage INTEGER NOT NULL,started_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,
                    claimed_at INTEGER,result TEXT);
                CREATE TABLE IF NOT EXISTS campaign_completions(ticket TEXT PRIMARY KEY,player_id TEXT NOT NULL,
                    stage INTEGER NOT NULL,completed_at INTEGER NOT NULL);
                CREATE TABLE IF NOT EXISTS reports(id TEXT PRIMARY KEY,at INTEGER NOT NULL,
                    attacker_id TEXT NOT NULL,defender_id TEXT NOT NULL,payload TEXT NOT NULL);
                CREATE INDEX IF NOT EXISTS reports_attacker ON reports(attacker_id,at DESC);
                CREATE INDEX IF NOT EXISTS reports_defender ON reports(defender_id,at DESC);
                CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
                CREATE INDEX IF NOT EXISTS campaigns_player ON campaigns(player_id,started_at DESC);
                CREATE INDEX IF NOT EXISTS campaigns_leaderboard
                    ON campaigns(player_id,stage DESC,claimed_at) WHERE claimed_at IS NOT NULL;
                CREATE INDEX IF NOT EXISTS campaign_completions_leaderboard
                    ON campaign_completions(player_id,stage DESC,completed_at);
            """)
            row = connection.execute("SELECT value FROM metadata WHERE key='schema'").fetchone()
            require(not row or row[0] == "1", "schema_mismatch", "世界数据库版本不兼容。", 500)
            connection.execute("INSERT OR IGNORE INTO metadata VALUES('schema','1')")
            connection.commit()

    def connect(self):
        connection = sqlite3.connect(self.database, timeout=15)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys=ON")
        connection.execute("PRAGMA busy_timeout=15000")
        return connection

    @contextlib.contextmanager
    def transaction(self):
        with contextlib.closing(self.connect()) as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                yield connection
                connection.commit()
            except Exception:
                connection.rollback()
                raise

    def save(self, connection, player):
        connection.execute("UPDATE players SET payload=? WHERE id=?", (dumps(player), player["id"]))

    def capacity(self, player):
        buildings = (player.get("home") or {}).get("buildings", {})
        return 1000 + buildings.get("warehouse", 0) * 750 + buildings.get("keep", 0) * 250

    def tick(self, player):
        now = self.clock()
        queues = player["queues"]
        for queued in queues:
            if queued["readyAt"] <= now:
                player["troops"][queued["unit"]] += queued["count"]
        player["queues"] = [item for item in queues if item["readyAt"] > now]
        player.setdefault("squads", [])
        home = player.get("home")
        if home:
            buildings = home["buildings"]
            for kind in BASE_COSTS:
                buildings.setdefault(kind, 0)
            limit = self.capacity(player)
            if "production" not in player:
                # Migrate old automatic farm income exactly once. Existing inventory
                # is untouched; even legacy wood remains harvestable without a mill.
                old_at = player.get("productionAt", now)
                minutes = min(1440, max(0, (now - old_at) // 60000))
                farm = buildings.get("farm", 0)
                player["production"] = {kind: {"stored": 0, "at": now} for kind in PRODUCTION}
                player["production"]["farm"]["stored"] = min(limit, minutes * farm * 8)
                player["production"]["lumbermill"]["stored"] = min(limit, minutes * farm * 4)
            for kind, rule in PRODUCTION.items():
                production = player["production"].setdefault(kind, {"stored": 0, "at": now})
                elapsed = max(0, now - production["at"])
                minutes = min(1440, elapsed // 60000)
                if minutes:
                    earned = minutes * buildings[kind] * rule["ratePerMinute"]
                    production["stored"] += min(earned, max(0, limit - production["stored"]))
                    production["at"] = now - elapsed % 60000
        return player

    def production_state(self, player):
        if not player.get("home"):
            return {}
        buildings = player["home"]["buildings"]
        return {kind: {"resource": rule["resource"],
                       "ratePerMinute": rule["ratePerMinute"] * buildings[kind],
                       "stored": player["production"][kind]["stored"],
                       "capacity": self.capacity(player),
                       "nextTickAt": player["production"][kind]["at"] + 60000 if buildings[kind] else None}
                for kind, rule in PRODUCTION.items()}

    def harvest(self, player, kinds):
        require(player["home"], "home_required", "先建造主城，再收取生产物资。")
        harvested = {resource: 0 for resource in RESOURCE_KEYS}
        limit = self.capacity(player)
        for kind in kinds:
            resource = PRODUCTION[kind]["resource"]
            production = player["production"][kind]
            amount = min(production["stored"], max(0, limit - player["resources"][resource]))
            player["resources"][resource] += amount
            production["stored"] -= amount
            harvested[resource] += amount
        return harvested

    def reconcile_squads(self, player, preferred=None):
        # Allocations are reservations, not extra troops. Casualties must never
        # leave duplicate or nonexistent soldiers assigned to any squad.
        available = dict(player["troops"])
        squads = player.get("squads", [])
        ordered = sorted(squads, key=lambda squad: squad["id"] != preferred) if preferred else squads
        for squad in ordered:
            for unit in UNITS:
                squad["units"][unit] = min(squad["units"][unit], available[unit])
                available[unit] -= squad["units"][unit]

    def load(self, connection, player_id, tick=True):
        row = connection.execute("SELECT payload FROM players WHERE id=?", (player_id,)).fetchone()
        require(row is not None, "login_required", "请先登录世界账号。", 401)
        player = json.loads(row[0])
        return self.tick(player) if tick else player

    def session_player(self, token):
        if not token or not re.fullmatch(r"[A-Za-z0-9_-]{40,96}", token):
            return None
        with contextlib.closing(self.connect()) as connection:
            row = connection.execute("SELECT player_id FROM sessions WHERE token_hash=? AND expires_at>?",
                                     (hashlib.sha256(token.encode()).hexdigest(), self.clock())).fetchone()
            return row[0] if row else None

    def issue_session(self, connection, player_id):
        token = secrets.token_urlsafe(32)
        connection.execute("DELETE FROM sessions WHERE expires_at<=?", (self.clock(),))
        connection.execute("INSERT INTO sessions VALUES(?,?,?)", (
            hashlib.sha256(token.encode()).hexdigest(), player_id, self.clock() + SESSION_SECONDS * 1000))
        return token

    def register(self, name, password):
        require(valid_name(name), "invalid_name", "名字需1至7个中文、字母、数字或下划线。")
        require(valid_password(password), "invalid_password", "密码长度需6至64个有效字符。")
        salt = secrets.token_hex(16)
        hashed = password_hash(password, salt)
        now = self.clock()
        player_id = secrets.token_hex(12)
        player = {"id": player_id, "name": name, "resources": dict(RULES["initialResources"]),
                  "home": None, "troops": {kind: 0 for kind in UNITS}, "queues": [],
                  "guildId": None, "unlockedStage": 1, "attackReadyAt": 0,
                  "defenseReadyAt": 0, "productionAt": now, "createdAt": now}
        with self.transaction() as connection:
            require(connection.execute("SELECT id FROM players WHERE name=?", (name,)).fetchone() is None,
                    "name_taken", "这个世界名字已经注册，请登录或换一个名字。", 409)
            connection.execute("INSERT INTO players VALUES(?,?,?,?,?)", (player_id, name, salt, hashed, dumps(player)))
            token = self.issue_session(connection, player_id)
            state = self.state_in(connection, player_id)
        return {"ok": True, "state": state}, token

    def enter(self, name, password, current_token=None, before_create=None):
        require(valid_name(name), "invalid_name", "名字需1至7个中文、字母、数字或下划线。")
        require(valid_password(password), "invalid_password", "密码长度需6至64个有效字符。")
        with self.transaction() as connection:
            row = connection.execute("SELECT * FROM players WHERE name=?", (name,)).fetchone()
            if row is None:
                if before_create:
                    before_create()
                now, player_id, salt = self.clock(), secrets.token_hex(12), secrets.token_hex(16)
                player = {"id": player_id, "name": name, "resources": dict(RULES["initialResources"]),
                          "home": None, "troops": {kind: 0 for kind in UNITS}, "queues": [], "squads": [],
                          "guildId": None, "unlockedStage": 1, "attackReadyAt": 0,
                          "defenseReadyAt": 0, "productionAt": now, "createdAt": now}
                connection.execute("INSERT INTO players VALUES(?,?,?,?,?)",
                                   (player_id, name, salt, password_hash(password, salt), dumps(player)))
            else:
                player_id = row["id"]
                correct = hmac.compare_digest(password_hash(password, row["salt"]), row["password_hash"])
                current_session = None
                if isinstance(current_token, str) and re.fullmatch(r"[A-Za-z0-9_-]{40,96}", current_token):
                    # Check the ownership proof within this same write transaction:
                    # a session revoked by another migration cannot overwrite it.
                    current_session = connection.execute("SELECT player_id FROM sessions WHERE token_hash=? AND expires_at>?",
                        (hashlib.sha256(current_token.encode()).hexdigest(), self.clock())).fetchone()
                require(correct or current_session is not None and current_session[0] == player_id, "world_link_required",
                        "这个名字已有世界存档，首次合并请验证原世界密码。", 409)
                if not correct:
                    self.replace_password(connection, player_id, password)
            token = self.issue_session(connection, player_id)
            state = self.state_in(connection, player_id)
        return {"ok": True, "state": state}, token

    def replace_password(self, connection, player_id, password):
        salt = secrets.token_hex(16)
        connection.execute("UPDATE players SET salt=?,password_hash=? WHERE id=?",
                           (salt, password_hash(password, salt), player_id))
        # A credential migration invalidates every old browser session.
        connection.execute("DELETE FROM sessions WHERE player_id=?", (player_id,))

    def link(self, name, password, world_password):
        require(valid_name(name) and valid_password(password) and valid_password(world_password),
                "invalid_credentials", "原世界密码不正确，游戏密码长度需6至64个字符。", 401)
        with self.transaction() as connection:
            row = connection.execute("SELECT * FROM players WHERE name=?", (name,)).fetchone()
            derived = password_hash(world_password, row["salt"] if row else "00" * 16)
            require(row is not None and hmac.compare_digest(derived, row["password_hash"]),
                    "invalid_credentials", "原世界密码不正确，存档未改变。", 401)
            self.replace_password(connection, row["id"], password)
            token = self.issue_session(connection, row["id"])
            state = self.state_in(connection, row["id"])
        return {"ok": True, "state": state}, token

    def login(self, name, password):
        require(isinstance(name, str) and 1 <= len(name) <= 7 and valid_password(password),
                "invalid_credentials", "世界名字或密码不正确。", 401)
        with contextlib.closing(self.connect()) as connection:
            row = connection.execute("SELECT * FROM players WHERE name=?", (name,)).fetchone()
        # A dummy derivation keeps unknown names from bypassing password-work limits.
        derived = password_hash(password, row["salt"] if row else "00" * 16)
        require(row is not None and hmac.compare_digest(derived, row["password_hash"]),
                "invalid_credentials", "世界名字或密码不正确。", 401)
        with self.transaction() as connection:
            token = self.issue_session(connection, row["id"])
            state = self.state_in(connection, row["id"])
        return {"ok": True, "state": state}, token

    def logout(self, token):
        with self.transaction() as connection:
            if token:
                connection.execute("DELETE FROM sessions WHERE token_hash=?", (hashlib.sha256(token.encode()).hexdigest(),))
            return {"ok": True, "state": self.state_in(connection, None)}

    def public_player(self, player):
        return {key: player[key] for key in ("id", "name", "home", "guildId", "createdAt")} | {
            "army": sum(player["troops"].values()), "attackReadyAt": player["attackReadyAt"]}

    def state_in(self, connection, player_id):
        own = self.load(connection, player_id) if player_id else None
        if own:
            self.save(connection, own)
        players = [self.tick(json.loads(row[0])) for row in connection.execute("SELECT payload FROM players ORDER BY name")]
        if own:
            players = [own if item["id"] == player_id else item for item in players]
        guilds = []
        for row in connection.execute("SELECT * FROM guilds ORDER BY name"):
            guild = json.loads(row["payload"])
            guild["members"] = [item["id"] for item in players if item["guildId"] == guild["id"]]
            guilds.append(guild)
        guild_names = {item["id"]: item["name"] for item in guilds}
        public = [self.public_player(item) | {"guildName": guild_names.get(item["guildId"], "")} for item in players]
        cells = [{"x": item["home"]["x"], "y": item["home"]["y"], "ownerId": item["id"],
                  "ownerName": item["name"], "level": item["home"]["level"], "guildId": item["guildId"],
                  "protectedUntil": item["home"]["protectedUntil"]} for item in players if item.get("home")]
        reports = []
        if player_id:
            rows = connection.execute("SELECT payload FROM reports WHERE attacker_id=? OR defender_id=? ORDER BY at DESC,id DESC LIMIT 30",
                                      (player_id, player_id))
            reports = [json.loads(row[0]) for row in rows]
            own = dict(own, capacity=self.capacity(own), guildName=guild_names.get(own["guildId"], ""))
        if own:
            last_claim = connection.execute("SELECT MAX(claimed_at) FROM campaigns WHERE player_id=?", (player_id,)).fetchone()[0]
            own["claimReadyAt"] = (last_claim + RULES["campaignClaimCooldownMs"]) if last_claim is not None else 0
            if own.get("home"):
                own["home"] = dict(own["home"], production=self.production_state(own))
        return {"self": own, "map": {"width": 16, "height": 16, "cells": cells}, "players": public,
                "guilds": guilds, "reports": reports, "rules": RULES, "serverTime": self.clock()}

    def state(self, player_id=None):
        with self.transaction() as connection:
            return {"ok": True, "state": self.state_in(connection, player_id)}

    def leaderboard(self, player_id=None, page=1):
        integer(page, 1, LEADERBOARD_MAX_PAGE, "排行榜页码")
        offset = (page - 1) * LEADERBOARD_PAGE_SIZE
        # Scores use server-issued tickets completed by the campaign client,
        # plus historical successful reward claims. The capped unlockedStage
        # cannot distinguish an
        # account which unlocked stage 100 from one which actually cleared it.
        # A repeated or lower-stage claim cannot replace the first arrival time
        # at the highest cleared stage. Historical claimed tickets work as-is.
        with contextlib.closing(self.connect()) as connection:
            connection.execute("BEGIN")
            total = connection.execute("""
                SELECT COUNT(*) FROM players p WHERE EXISTS (
                    SELECT 1 FROM campaigns c WHERE c.player_id=p.id
                    AND c.claimed_at IS NOT NULL AND c.stage BETWEEN 1 AND 100
                ) OR EXISTS (
                    SELECT 1 FROM campaign_completions c WHERE c.player_id=p.id
                    AND c.stage BETWEEN 1 AND 100
                )
            """).fetchone()[0]
            rows = connection.execute("""
                WITH completed AS (
                    SELECT player_id,stage,claimed_at AS reached_at FROM campaigns
                    WHERE claimed_at IS NOT NULL AND stage BETWEEN 1 AND 100
                    UNION ALL
                    SELECT player_id,stage,completed_at AS reached_at FROM campaign_completions
                    WHERE stage BETWEEN 1 AND 100
                ), highest AS (
                    SELECT player_id,MAX(stage) AS stage FROM completed
                    GROUP BY player_id
                ), scores AS (
                    SELECT p.id,p.name,COALESCE(h.stage,0) AS highest_stage,
                        MIN(c.reached_at) AS reached_at
                    FROM players p LEFT JOIN highest h ON h.player_id=p.id
                    LEFT JOIN completed c ON c.player_id=p.id AND c.stage=h.stage
                    GROUP BY p.id,p.name,h.stage
                ), ranked AS (
                    SELECT id,name,highest_stage,reached_at,
                        RANK() OVER (ORDER BY highest_stage DESC) AS rank,
                        ROW_NUMBER() OVER (
                            ORDER BY highest_stage DESC,reached_at ASC,id ASC
                        ) AS position
                    FROM scores WHERE highest_stage>0
                )
                SELECT * FROM ranked WHERE (position>? AND position<=?) OR id=?
                ORDER BY position
            """, (offset, offset + LEADERBOARD_PAGE_SIZE, player_id)).fetchall()
            entries, own = [], None
            for row in rows:
                entry = {"rank": row["rank"], "playerId": row["id"], "name": row["name"],
                         "highestStage": row["highest_stage"], "reachedAt": row["reached_at"],
                         "isSelf": row["id"] == player_id}
                if entry["isSelf"]:
                    own = entry
                if offset < row["position"] <= offset + LEADERBOARD_PAGE_SIZE:
                    entries.append(entry)
            if player_id and own is None:
                player = connection.execute("SELECT id,name FROM players WHERE id=?", (player_id,)).fetchone()
                if player:
                    own = {"rank": 0, "playerId": player["id"], "name": player["name"],
                           "highestStage": 0, "reachedAt": None, "isSelf": True}
            connection.commit()
        return {"ok": True, "leaderboard": {"entries": entries, "self": own,
                "totalPlayers": total, "page": page, "pageSize": LEADERBOARD_PAGE_SIZE,
                "totalPages": max(1, (total + LEADERBOARD_PAGE_SIZE - 1) // LEADERBOARD_PAGE_SIZE),
                "serverTime": self.clock()}}

    def spend(self, player, cost):
        require(all(player["resources"].get(key, 0) >= value for key, value in cost.items()),
                "insufficient_resources", "世界物资不足，请通关获取物资或等待农田生产。")
        for key, value in cost.items():
            player["resources"][key] -= value

    def request_key(self, payload):
        request_id = payload.get("requestId")
        require(isinstance(request_id, str) and REQUEST_PATTERN.fullmatch(request_id),
                "request_id_required", "操作需要8至96位唯一请求编号。")
        fingerprint = hashlib.sha256(json.dumps({key: value for key, value in payload.items() if key != "requestId"},
                                              ensure_ascii=True, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()).hexdigest()
        return request_id, fingerprint

    def action(self, player_id, payload):
        require(player_id, "login_required", "请先登录世界账号。", 401)
        request_id, fingerprint = self.request_key(payload)
        kind = payload.get("type")
        require(isinstance(kind, str) and kind in {"settle", "build", "harvest", "harvest-all", "train", "squad-save", "squad-delete",
                                                   "attack", "guild-create", "guild-join", "guild-leave", "guild-donate"},
                "invalid_action", "未知的世界操作。")
        with self.transaction() as connection:
            player = self.load(connection, player_id)
            require(payload.get("accountName") == player["name"], "account_mismatch",
                    "世界账号与当前游戏名字不一致，请刷新并切换世界账号。", 409)
            old = connection.execute("SELECT fingerprint,result FROM requests WHERE player_id=? AND request_id=?", (player_id, request_id)).fetchone()
            if old:
                require(hmac.compare_digest(fingerprint, old[0]), "request_conflict", "同一请求编号不能用于不同操作。", 409)
                return {"ok": True, **json.loads(old[1]), "replayed": True, "state": self.state_in(connection, player_id)}
            result = {}
            now = self.clock()
            if kind == "settle":
                require(player["home"] is None, "already_settled", "每个世界账号只能拥有一座家园。")
                x = integer(payload.get("x"), 0, 15, "地块横坐标")
                y = integer(payload.get("y"), 0, 15, "地块纵坐标")
                require(not connection.execute("SELECT 1 FROM plots WHERE x=? AND y=?", (x, y)).fetchone(),
                        "plot_occupied", "这块土地已经有其他玩家建家，请选择空地。", 409)
                self.spend(player, SETTLE_COST)
                player["home"] = {"x": x, "y": y, "level": 1, "protectedUntil": now + RULES["protectionMs"],
                                  "buildings": {kind: 1 if kind == "keep" else 0 for kind in BASE_COSTS}}
                player["productionAt"] = now
                player["production"] = {building: {"stored": 0, "at": now} for building in PRODUCTION}
                connection.execute("INSERT INTO plots VALUES(?,?,?)", (x, y, player_id))
            elif kind == "build":
                require(player["home"], "home_required", "先选择一块空地建家。")
                building = payload.get("building")
                require(isinstance(building, str) and building in BASE_COSTS, "invalid_building", "未知的建筑。")
                buildings = player["home"]["buildings"]
                level = buildings[building] + 1
                require(level <= 5, "max_level", "这座建筑已达到5级。")
                require(building == "keep" or level <= buildings["keep"], "keep_required", "建筑等级不能超过主城，请先升级主城。")
                self.spend(player, BUILD_COSTS[building][level])
                buildings[building] = level
                if building in PRODUCTION:
                    # Rate changes begin now, never backdate a new building or upgrade.
                    player["production"][building]["at"] = now
                player["home"]["level"] = buildings["keep"]
            elif kind in ("harvest", "harvest-all"):
                building = payload.get("building")
                require(kind == "harvest-all" or isinstance(building, str) and building in PRODUCTION,
                        "invalid_building", "只能收取生产建筑的物资。")
                result = {"harvested": self.harvest(player, PRODUCTION if kind == "harvest-all" else (building,))}
            elif kind == "train":
                require(player["home"] and player["home"]["buildings"]["barracks"] > 0,
                        "barracks_required", "先建造兵营才能训练部队。")
                unit = payload.get("unit")
                require(isinstance(unit, str) and unit in UNITS, "invalid_unit", "未知的兵种。")
                count = integer(payload.get("count"), 1, 100, "训练数量")
                require(len(player["queues"]) < 3, "queue_full", "最多同时安排3队训练，请等待完成。")
                require(sum(player["troops"].values()) + sum(item["count"] for item in player["queues"]) + count <= 2000,
                        "army_limit", "每座家园最多拥有2000名士兵（包括训练中）。")
                self.spend(player, {key: amount * count for key, amount in UNITS[unit]["cost"].items()})
                barracks_level = player["home"]["buildings"]["barracks"]
                duration = math.ceil(UNITS[unit]["seconds"] * count * 1000 / (1 + .15 * (barracks_level - 1)))
                player["queues"].append({"id": secrets.token_hex(8), "unit": unit, "count": count, "readyAt": now + duration})
            elif kind == "squad-save":
                require(player["home"] and player["home"]["buildings"]["barracks"] > 0,
                        "barracks_required", "先建造兵营并训练士兵，再编组小队。")
                squad_id = payload.get("squadId")
                squad = next((item for item in player["squads"] if item["id"] == squad_id), None)
                require(squad_id is None or isinstance(squad_id, str) and squad is not None,
                        "squad_missing", "这支小队不存在或不属于你。", 404)
                require(squad is not None or len(player["squads"]) < RULES["maxSquads"],
                        "squad_limit", "最多编组3支小队。")
                name = payload.get("name")
                require(isinstance(name, str) and 1 <= len(name) <= 12 and name.strip() == name
                        and name == unicodedata.normalize("NFC", name)
                        and not any(unicodedata.category(char)[0] == "C" for char in name),
                        "invalid_squad_name", "小队名字需1至12个有效字符。")
                units = payload.get("units")
                require(isinstance(units, dict) and all(unit in UNITS for unit in units),
                        "invalid_units", "小队只能配置步兵、弓兵和骑兵。")
                assigned = {unit: integer(units.get(unit, 0), 0, 2000, "编组数量") for unit in UNITS}
                require(sum(assigned.values()) > 0, "army_required", "小队至少需要一名已训练完成的士兵。")
                other = [item for item in player["squads"] if item is not squad]
                require(all(assigned[unit] + sum(item["units"][unit] for item in other) <= player["troops"][unit]
                            for unit in UNITS), "insufficient_troops", "可用士兵不足，同一士兵不能加入多支小队。")
                if squad is None:
                    squad = {"id": secrets.token_hex(10)}
                    player["squads"].append(squad)
                squad.update(name=name, units=assigned)
                result = {"squadId": squad["id"]}
            elif kind == "squad-delete":
                squad_id = payload.get("squadId")
                require(isinstance(squad_id, str) and any(item["id"] == squad_id for item in player["squads"]),
                        "squad_missing", "这支小队不存在或不属于你。", 404)
                player["squads"] = [item for item in player["squads"] if item["id"] != squad_id]
            elif kind == "attack":
                result = {"report": self.attack(connection, player, payload.get("targetId"), payload.get("squadId"))}
            elif kind == "guild-create":
                require(not player["guildId"], "already_in_guild", "请先退出当前公会。")
                name = payload.get("name")
                require(valid_name(name), "invalid_name", "公会名需1至7个中文、字母、数字或下划线。")
                require(not connection.execute("SELECT 1 FROM guilds WHERE name=?", (name,)).fetchone(), "guild_name_taken", "公会名已存在。", 409)
                self.spend(player, RULES["costs"]["guildCreate"])
                guild_id = secrets.token_hex(10)
                guild = {"id": guild_id, "name": name, "ownerId": player_id, "level": 1, "donations": 0,
                         "createdAt": now, "nextLevelAt": 500}
                connection.execute("INSERT INTO guilds VALUES(?,?,?,?)", (guild_id, name, player_id, dumps(guild)))
                player["guildId"] = guild_id
            elif kind == "guild-join":
                require(not player["guildId"], "already_in_guild", "请先退出当前公会。")
                guild_id = payload.get("guildId")
                require(isinstance(guild_id, str) and connection.execute("SELECT 1 FROM guilds WHERE id=?", (guild_id,)).fetchone(),
                        "guild_missing", "这个公会不存在。", 404)
                members = sum(json.loads(row[0])["guildId"] == guild_id for row in connection.execute("SELECT payload FROM players"))
                require(members < 30, "guild_full", "公会已达到30名成员上限。")
                player["guildId"] = guild_id
            elif kind == "guild-leave":
                guild_id = player["guildId"]
                require(guild_id, "not_in_guild", "你还没有加入公会。")
                guild_row = connection.execute("SELECT * FROM guilds WHERE id=?", (guild_id,)).fetchone()
                player["guildId"] = None
                members = [json.loads(row[0]) for row in connection.execute("SELECT payload FROM players WHERE id<>?", (player_id,))]
                members = sorted([item for item in members if item["guildId"] == guild_id], key=lambda item: (item["createdAt"], item["id"]))
                if not members:
                    connection.execute("DELETE FROM guilds WHERE id=?", (guild_id,))
                elif guild_row and guild_row["owner_id"] == player_id:
                    guild = json.loads(guild_row["payload"])
                    guild["ownerId"] = members[0]["id"]
                    connection.execute("UPDATE guilds SET owner_id=?,payload=? WHERE id=?", (guild["ownerId"], dumps(guild), guild_id))
            elif kind == "guild-donate":
                guild_id = player["guildId"]
                require(guild_id, "not_in_guild", "先加入公会再捐献。")
                resource = payload.get("resource", "wood")
                require(resource in ("wood", "stone", "grain", "iron"), "invalid_resource", "只能捐献木材、石料、粮食或铁矿。")
                amount = integer(payload.get("amount"), 10, 1000, "捐献数量")
                guild_row = connection.execute("SELECT payload FROM guilds WHERE id=?", (guild_id,)).fetchone()
                require(guild_row, "guild_missing", "公会不存在，请重新登录世界。", 409)
                self.spend(player, {resource: amount})
                guild = json.loads(guild_row[0])
                guild["donations"] += amount
                guild["level"] = min(10, 1 + int(math.sqrt(guild["donations"] / 500)))
                guild["nextLevelAt"] = None if guild["level"] == 10 else 500 * guild["level"] ** 2
                connection.execute("UPDATE guilds SET payload=? WHERE id=?", (dumps(guild), guild_id))
            self.save(connection, player)
            connection.execute("INSERT INTO requests VALUES(?,?,?,?,?)", (player_id, request_id, fingerprint, dumps(result), now))
            return {"ok": True, **result, "state": self.state_in(connection, player_id)}

    def attack(self, connection, attacker, target_id, squad_id=None):
        now = self.clock()
        require(attacker["home"], "home_required", "先建家才能派兵。")
        require(isinstance(target_id, str) and target_id != attacker["id"], "invalid_target", "请选择其他玩家的家园。")
        require(connection.execute("SELECT 1 FROM players WHERE id=?", (target_id,)).fetchone(), "target_missing", "目标玩家不存在。", 404)
        defender = self.load(connection, target_id)
        require(defender["home"], "target_no_home", "这位玩家还没有建家。")
        require(not attacker["guildId"] or attacker["guildId"] != defender["guildId"], "same_guild", "同公会成员不能互相攻打。")
        require(defender["home"]["protectedUntil"] <= now, "target_protected", "目标处于新手保护期，暂时不能攻打。")
        require(attacker["attackReadyAt"] <= now, "attack_cooldown", "部队正在休整，请等待进攻冷却结束。")
        require(defender["defenseReadyAt"] <= now, "target_cooldown", "目标刚经历战斗，请稍后再攻打。")
        squad = next((item for item in attacker["squads"] if item["id"] == squad_id), None)
        require(squad_id is None or isinstance(squad_id, str) and squad is not None,
                "squad_missing", "出战小队不存在或不属于你。", 404)
        army = dict(squad["units"] if squad else attacker["troops"])
        defense = dict(defender["troops"])
        require(sum(army.values()) > 0, "army_required", "没有已完成训练的部队。")
        beats = {"infantry": "archer", "archer": "cavalry", "cavalry": "infantry"}
        def power(troops, opponent):
            count = max(1, sum(opponent.values()))
            return sum(amount * UNITS[unit]["power"] * (1 + .25 * opponent[beats[unit]] / count)
                       for unit, amount in troops.items())
        attack_power = power(army, defense)
        buildings = defender["home"]["buildings"]
        defend_power = power(defense, army) + buildings["keep"] * 25 + buildings["wall"] * 45
        won = attack_power > defend_power
        attack_ratio = min(.35, max(.15, .15 + .2 * defend_power / max(1, attack_power))) if won else .6
        defend_ratio = .45 if won else .15
        losses = {unit: min(amount, math.floor(amount * attack_ratio)) for unit, amount in army.items()}
        defender_losses = {unit: min(amount, math.floor(amount * defend_ratio)) for unit, amount in defense.items()}
        for unit in UNITS:
            attacker["troops"][unit] -= losses[unit]
            defender["troops"][unit] -= defender_losses[unit]
            if squad:
                squad["units"][unit] -= losses[unit]
        self.reconcile_squads(attacker, squad_id)
        self.reconcile_squads(defender)
        loot = {resource: 0 for resource in RESOURCE_KEYS}
        if won:
            carrying = sum(army[unit] - losses[unit] for unit in UNITS) * 6
            for resource in ("wood", "stone", "grain", "iron"):
                amount = min(carrying, defender["resources"][resource] * 15 // 100)
                loot[resource] = amount
                carrying -= amount
                defender["resources"][resource] -= amount
                attacker["resources"][resource] += amount
        attacker["attackReadyAt"] = now + RULES["attackCooldownMs"]
        attacker["home"]["protectedUntil"] = min(attacker["home"]["protectedUntil"], now)
        defender["defenseReadyAt"] = now + RULES["defenderCooldownMs"]
        report = {"id": secrets.token_hex(12), "at": now, "attackerId": attacker["id"], "attackerName": attacker["name"],
                  "defenderId": defender["id"], "defenderName": defender["name"], "won": won, "loot": loot,
                  "squadId": squad_id, "squadName": squad["name"] if squad else "全军", "deployed": army,
                  "losses": losses, "defenderLosses": defender_losses, "attackPower": round(attack_power, 1),
                  "defendPower": round(defend_power, 1), "detail": "进攻获胜，带回部分世界物资。" if won else "守军挡住进攻，部队返回休整。"}
        self.save(connection, defender)
        connection.execute("INSERT INTO reports VALUES(?,?,?,?,?)", (report["id"], now, attacker["id"], defender["id"], dumps(report)))
        return report

    def campaign_start(self, player_id, payload):
        require(player_id, "login_required", "先登录世界再挑战关卡，可获得世界物资。", 401)
        stage = integer(payload.get("stage"), 1, 100, "关卡")
        with self.transaction() as connection:
            player = self.load(connection, player_id)
            require(payload.get("name") == player["name"], "account_mismatch", "世界账号与当前游戏名字不一致，请切换世界账号。", 409)
            require(stage <= player["unlockedStage"], "stage_locked", f"世界物资关卡需逐关解锁，请先完成第{player['unlockedStage']}关。")
            last = connection.execute("SELECT started_at FROM campaigns WHERE player_id=? ORDER BY started_at DESC LIMIT 1", (player_id,)).fetchone()
            now = self.clock()
            require(not last or now - last[0] >= 5000, "campaign_rate_limit", "挑战准备过于频繁，请稍等5秒。", 429)
            # Completed browser runs may still be awaiting a network retry. Preserve
            # their tickets and rate-limit grants per account instead of discarding them.
            ticket = secrets.token_urlsafe(32)
            connection.execute("INSERT INTO campaigns(ticket,player_id,stage,started_at,expires_at) VALUES(?,?,?,?,?)",
                               (ticket, player_id, stage, now, now + RULES["campaignTicketTtlMs"]))
            return {"ok": True, "ticket": ticket, "claimAfter": now + RULES["campaignMinimumMs"],
                    "rewards": campaign_reward(stage), "state": self.state_in(connection, player_id)}

    def campaign_claim(self, player_id, payload):
        require(player_id, "login_required", "请先登录世界账号。", 401)
        ticket = payload.get("ticket")
        require(isinstance(ticket, str) and 30 <= len(ticket) <= 96, "invalid_ticket", "挑战凭证无效。")
        with self.transaction() as connection:
            row = connection.execute("SELECT * FROM campaigns WHERE ticket=? AND player_id=?", (ticket, player_id)).fetchone()
            require(row, "invalid_ticket", "挑战凭证不存在或不属于当前账号。", 404)
            player = self.load(connection, player_id)
            require(payload.get("name") == player["name"], "account_mismatch", "世界账号与当前游戏名字不一致，奖励暂未发放。", 409)
            if row["claimed_at"] is not None:
                return {"ok": True, "replayed": True, "rewards": json.loads(row["result"]), "state": self.state_in(connection, player_id)}
            now = self.clock()
            require(now <= row["expires_at"], "ticket_expired", "挑战凭证已过期，请重新挑战。")
            require(now - row["started_at"] >= RULES["campaignMinimumMs"], "claim_too_early", "挑战时间不足60秒，尚不能领取世界物资。")
            last_claim = connection.execute("SELECT MAX(claimed_at) FROM campaigns WHERE player_id=?", (player_id,)).fetchone()[0]
            require(last_claim is None or now - last_claim >= RULES["campaignClaimCooldownMs"],
                    "claim_rate_limit", "世界物资每60秒最多入库一次，凭证已保留，请稍后重试。", 429)
            require(row["stage"] <= player["unlockedStage"], "stage_locked", "请先通关已解锁的世界物资关卡。")
            rewards = campaign_reward(row["stage"])
            for resource, amount in rewards.items():
                player["resources"][resource] += amount
            player["unlockedStage"] = min(100, max(player["unlockedStage"], row["stage"] + 1))
            self.save(connection, player)
            connection.execute("UPDATE campaigns SET claimed_at=?,result=? WHERE ticket=?", (now, dumps(rewards), ticket))
            return {"ok": True, "rewards": rewards, "state": self.state_in(connection, player_id)}

    def campaign_complete(self, player_id, payload):
        require(player_id, "login_required", "请先登录游戏账号。", 401)
        ticket = payload.get("ticket")
        require(isinstance(ticket, str) and 30 <= len(ticket) <= 96, "invalid_ticket", "挑战凭证无效。")
        with self.transaction() as connection:
            row = connection.execute("SELECT * FROM campaigns WHERE ticket=? AND player_id=?", (ticket, player_id)).fetchone()
            require(row, "invalid_ticket", "挑战凭证不存在或不属于当前账号。", 404)
            player = self.load(connection, player_id)
            require(payload.get("name") == player["name"], "account_mismatch", "游戏账号与挑战名字不一致，成绩暂未记录。", 409)
            previous = connection.execute("SELECT completed_at FROM campaign_completions WHERE ticket=? AND player_id=?",
                                          (ticket, player_id)).fetchone()
            reached_at = previous[0] if previous else row["claimed_at"]
            if reached_at is not None:
                return {"ok": True, "replayed": True, "completedStage": row["stage"], "completedAt": reached_at,
                        "state": self.state_in(connection, player_id)}
            now = self.clock()
            require(now <= row["expires_at"], "ticket_expired", "挑战凭证已过期，请重新挑战。")
            require(row["stage"] <= player["unlockedStage"], "stage_locked", "请先通关当前已解锁关卡。")
            # Campaign victory and world-material redemption are independent:
            # completion advances rank immediately but never credits resources.
            # The claim endpoint keeps its original minimum time and cooldown.
            connection.execute("INSERT INTO campaign_completions VALUES(?,?,?,?)",
                               (ticket, player_id, row["stage"], now))
            player["unlockedStage"] = min(100, max(player["unlockedStage"], row["stage"] + 1))
            self.save(connection, player)
            return {"ok": True, "completedStage": row["stage"], "completedAt": now,
                    "state": self.state_in(connection, player_id)}


class WorldHTTPServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True
    request_queue_size = 64

    def __init__(self, address, store, site, public_origins=(), secure_cookie=False):
        self.store, self.site = store, Path(site).resolve()
        self.static_files = {"index.html", "特殊饰品投放图.png", "特殊饰品投放图.svg"}
        index = self.site / "index.html"
        if index.is_file():
            for reference in re.findall(r'''(?:src|href)\s*=\s*["']([^"']+)["']''', index.read_text(encoding="utf-8")):
                parsed = urlsplit(reference)
                name = parsed.path
                if not parsed.scheme and not parsed.netloc and "/" not in name and "\\" not in name and not name.startswith(".") and Path(name).suffix.lower() in (".js", ".css"):
                    self.static_files.add(name)
        self.secure_cookie = secure_cookie
        self.rate_lock, self.rate_buckets = threading.Lock(), {}
        self.public_origins = frozenset(public_origins)
        super().__init__(address, WorldHandler)
        port = self.server_address[1]
        self.local_origins = frozenset((f"http://127.0.0.1:{port}", f"http://localhost:{port}"))
        self.origins = self.public_origins | self.local_origins
        self.hosts = frozenset(urlsplit(origin).netloc.lower() for origin in self.origins)

    def rate_limit(self, key, maximum, window):
        now = time.monotonic()
        with self.rate_lock:
            # Bound memory even when probes invent many client identities.
            if len(self.rate_buckets) > 10000:
                self.rate_buckets = {bucket: values for bucket, values in self.rate_buckets.items() if values and now - values[-1] < 3600}
            values = [stamp for stamp in self.rate_buckets.get(key, []) if now - stamp < window]
            require(len(values) < maximum, "rate_limited", "操作过于频繁，请稍后再试。", 429)
            values.append(now)
            self.rate_buckets[key] = values


class WorldHandler(BaseHTTPRequestHandler):
    server_version = "OrchardWorld"
    sys_version = ""
    protocol_version = "HTTP/1.1"

    def setup(self):
        super().setup()
        self.connection.settimeout(15)

    def log_message(self, format_string, *args):
        # Never log cookies, passwords, request bodies, tickets or query strings.
        if args and isinstance(args[0], str) and " " in args[0]:
            safe = args[0].split(" ")
            if len(safe) >= 2:
                safe[1] = safe[1].split("?")[0]
                args = (" ".join(safe),) + args[1:]
        super().log_message(format_string, *args)

    def headers_for(self, status, content_type, length, cookie=None, cache="no-store"):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(length))
        self.send_header("Cache-Control", cache)
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "same-origin")
        if cookie is not None:
            value = f"orchard_world={cookie}; Path=/api/world; HttpOnly; SameSite=Lax; Max-Age={SESSION_SECONDS if cookie else 0}"
            if self.server.secure_cookie:
                value += "; Secure"
            self.send_header("Set-Cookie", value)
        self.end_headers()

    def send_json(self, value, status=200, cookie=None):
        body = dumps(value).encode("utf-8")
        self.headers_for(status, "application/json; charset=utf-8", len(body), cookie)
        if self.command != "HEAD":
            self.wfile.write(body)

    def fail(self, error):
        self.send_json({"ok": False, "error": error.message, "code": error.code}, error.status)

    def token(self):
        cookie = SimpleCookie()
        try:
            cookie.load(self.headers.get("Cookie", ""))
            return cookie["orchard_world"].value if "orchard_world" in cookie else None
        except Exception:
            return None

    def client_ip(self):
        # Nginx must overwrite this header. Only loopback proxies are trusted;
        # clients on untrusted sockets cannot manufacture rate-limit identities.
        if self.client_address[0] in ("127.0.0.1", "::1"):
            value = self.headers.get("X-Real-IP", "")
            try:
                return str(ipaddress.ip_address(value))
            except ValueError:
                pass
        return self.client_address[0]

    def validate_host(self):
        require(self.headers.get("Host", "").lower() in self.server.hosts,
                "invalid_host", "服务器地址不在允许列表。", 403)

    def csrf(self):
        self.validate_host()
        origin = self.headers.get("Origin", "")
        require(origin in self.server.origins, "invalid_origin", "只允许游戏网页从同一来源提交世界操作。", 403)
        require(urlsplit(origin).netloc.lower() == self.headers.get("Host", "").lower(),
                "invalid_origin", "世界操作必须来自当前游戏网址。", 403)
        fetch_site = self.headers.get("Sec-Fetch-Site")
        require(fetch_site in (None, "same-origin", "none"), "invalid_origin", "不允许跨站提交世界操作。", 403)
        if self.server.secure_cookie:
            proxied_https = self.client_address[0] in ("127.0.0.1", "::1") and self.headers.get("X-Forwarded-Proto") == "https"
            require(proxied_https, "https_required", "生产世界账号必须通过HTTPS访问。", 403)

    def body(self):
        require(not self.headers.get("Transfer-Encoding"), "invalid_body", "不支持分块请求。", 400)
        content_type = self.headers.get("Content-Type", "").split(";", 1)[0].strip().lower()
        require(content_type == "application/json", "invalid_content_type", "世界操作必须提交JSON。", 415)
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            raise WorldError("invalid_body", "请求长度无效。")
        require(0 < length <= 8192, "invalid_body", "世界请求大小需在1至8192字节。", 413)
        raw = self.rfile.read(length)
        require(len(raw) == length, "invalid_body", "请求内容不完整。")
        try:
            data = json.loads(raw.decode("utf-8"), parse_constant=lambda value: (_ for _ in ()).throw(ValueError(value)))
        except (ValueError, UnicodeError, RecursionError):
            raise WorldError("invalid_json", "请求不是有效的JSON。")
        require(isinstance(data, dict), "invalid_json", "请求必须是JSON对象。")
        return data

    def do_GET(self):
        try:
            self.validate_host()
            parsed = urlsplit(self.path)
            path = parsed.path
            if path == "/api/world/health":
                with contextlib.closing(self.server.store.connect()) as connection:
                    connection.execute("SELECT 1 FROM metadata LIMIT 1").fetchone()
                self.send_json({"ok": True, "version": VERSION, "storage": "sqlite"})
            elif path == "/api/world/state":
                self.server.rate_limit((self.client_ip(), "read"), 240, 60)
                self.send_json(self.server.store.state(self.server.store.session_player(self.token())))
            elif path == "/api/world/leaderboard":
                self.server.rate_limit((self.client_ip(), "read"), 240, 60)
                require(len(parsed.query) <= 256, "invalid_input", "排行榜查询过长。")
                try:
                    query = parse_qs(parsed.query, keep_blank_values=True, max_num_fields=8)
                except ValueError:
                    raise WorldError("invalid_input", "排行榜查询无效。")
                pages = query.get("page", ["1"])
                require(len(pages) == 1 and re.fullmatch(r"[1-9][0-9]{0,6}", pages[0]),
                        "invalid_input", "排行榜页码必须是正整数。")
                page = integer(int(pages[0]), 1, LEADERBOARD_MAX_PAGE, "排行榜页码")
                self.send_json(self.server.store.leaderboard(self.server.store.session_player(self.token()), page))
            elif path.startswith("/api/"):
                raise WorldError("not_found", "接口不存在。", 404)
            else:
                self.static(path)
        except WorldError as error:
            self.fail(error)
        except (BrokenPipeError, ConnectionResetError, TimeoutError):
            self.close_connection = True
        except Exception:
            self.fail(WorldError("server_error", "世界服务暂时不可用，请稍后重试。", 500))

    def do_HEAD(self):
        self.do_GET()

    def static(self, raw_path):
        path = unquote(raw_path)
        require("\\" not in path and "\x00" not in path and not any(ord(char) < 32 for char in path),
                "not_found", "文件不存在。", 404)
        parts = path.lstrip("/").split("/")
        require(not any(part in (".", "..") or part.startswith(".") for part in parts), "not_found", "文件不存在。", 404)
        if path in ("/", "/index.html"):
            relative = "index.html"
        elif len(parts) == 1 and parts[0] in self.server.static_files:
            # Serve only the application's declared JS/CSS dependency graph and
            # explicit public illustrations, never arbitrary root source files.
            relative = parts[0]
        elif len(parts) >= 2 and parts[0] == "assets" and Path(parts[-1]).suffix.lower() in (".png", ".jpg", ".jpeg", ".webp", ".svg", ".gif", ".mp3", ".ogg", ".wav"):
            relative = "/".join(parts)
        else:
            raise WorldError("not_found", "文件不存在。", 404)
        target = (self.server.site / relative).resolve()
        require(target.is_relative_to(self.server.site) and target.is_file(), "not_found", "文件不存在。", 404)
        content_type = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        if target.suffix.lower() in (".js", ".css", ".html"):
            content_type += "; charset=utf-8"
        with target.open("rb") as source:
            self.headers_for(200, content_type, target.stat().st_size, cache="no-cache")
            if self.command != "HEAD":
                while chunk := source.read(65536):
                    self.wfile.write(chunk)

    def do_POST(self):
        try:
            self.csrf()
            payload = self.body()
            path = urlsplit(self.path).path
            ip = self.client_ip()
            self.server.rate_limit((ip, "write"), 120, 60)
            if path in ("/api/world/register", "/api/world/login", "/api/world/enter", "/api/world/link"):
                self.server.rate_limit((ip, "auth"), 20, 60)
                if path.endswith("register"):
                    self.server.rate_limit((ip, "register"), 10, 3600)
                    response, token = self.server.store.register(payload.get("name"), payload.get("password"))
                elif path.endswith("login"):
                    response, token = self.server.store.login(payload.get("name"), payload.get("password"))
                elif path.endswith("enter"):
                    response, token = self.server.store.enter(payload.get("name"), payload.get("password"),
                        self.token(),
                        lambda: self.server.rate_limit((ip, "register"), 10, 3600))
                else:
                    response, token = self.server.store.link(payload.get("name"), payload.get("password"), payload.get("worldPassword"))
                self.send_json(response, cookie=token)
                return
            token = self.token()
            player_id = self.server.store.session_player(token)
            require(player_id, "login_required", "请先登录世界账号。", 401)
            if path == "/api/world/logout":
                self.send_json(self.server.store.logout(token), cookie="")
            elif path == "/api/world/action":
                self.send_json(self.server.store.action(player_id, payload))
            elif path == "/api/world/campaign/start":
                self.send_json(self.server.store.campaign_start(player_id, payload))
            elif path == "/api/world/campaign/claim":
                self.send_json(self.server.store.campaign_claim(player_id, payload))
            elif path == "/api/world/campaign/complete":
                self.send_json(self.server.store.campaign_complete(player_id, payload))
            else:
                raise WorldError("not_found", "接口不存在。", 404)
        except WorldError as error:
            # Invalid unread bodies must not desynchronize a reused HTTP connection.
            self.close_connection = True
            self.fail(error)
        except (BrokenPipeError, ConnectionResetError, TimeoutError):
            self.close_connection = True
        except Exception:
            self.close_connection = True
            self.fail(WorldError("server_error", "世界服务暂时不可用，请稍后重试。", 500))


def arguments(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8766)
    parser.add_argument("--db", default=".world-server-data/world.sqlite")
    parser.add_argument("--site", default=str(Path(__file__).resolve().parent.parent))
    parser.add_argument("--public-origin", default="", help="Comma-separated exact HTTPS origins allowed behind a reverse proxy")
    parser.add_argument("--secure-cookie", action="store_true", help="Require a loopback HTTPS proxy and set Secure cookies")
    args = parser.parse_args(argv)
    if args.host not in ("127.0.0.1", "localhost"):
        parser.error("Bind the world server to loopback and expose it through HTTPS Nginx.")
    if not 1 <= args.port <= 65535:
        parser.error("--port must be between 1 and 65535")
    if not Path(args.site).is_dir():
        parser.error("--site must be an existing game directory")
    origins = []
    for value in filter(None, (item.strip() for item in args.public_origin.split(","))):
        parsed = urlsplit(value)
        if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.path or parsed.query or parsed.fragment:
            parser.error("--public-origin must contain exact HTTPS origins without paths")
        origins.append(value)
    if origins and not args.secure_cookie:
        parser.error("Public HTTPS origins require --secure-cookie")
    args.public_origins = origins
    return args


def main(argv=None):
    args = arguments(argv)
    server = WorldHTTPServer((args.host, args.port), WorldStore(args.db), args.site, args.public_origins, args.secure_cookie)
    print(f"{VERSION}: http://{args.host}:{args.port}/ (SQLite persistent world; Ctrl+C to stop)", flush=True)
    try:
        server.serve_forever(poll_interval=.25)
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
