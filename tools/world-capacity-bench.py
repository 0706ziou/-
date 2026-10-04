#!/usr/bin/env python3
"""Bounded, local SQLite model only; never connects to a server or opens game saves."""
import argparse, asyncio, concurrent.futures, contextlib, json, math, os, platform, sqlite3, sys, tempfile, time
from pathlib import Path

RATES = {"read": 4 / 60, "write": 1 / 60, "attack": .2 / 60}

def arguments(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--seconds", type=float, default=10, help="Seconds per stage, 1..30 (default 10)")
    parser.add_argument("--players", default="50,100,200,400", help="1..8 comma-separated counts, each 1..1000")
    args = parser.parse_args(argv)
    if not math.isfinite(args.seconds) or not 1 <= args.seconds <= 30:
        parser.error("--seconds must be finite and within 1..30")
    try:
        args.players = [int(value) for value in args.players.split(",")]
        if not 1 <= len(args.players) <= 8 or any(not 1 <= count <= 1000 for count in args.players): raise ValueError()
        if len(set(args.players)) != len(args.players): raise ValueError()
    except ValueError:
        parser.error("--players needs 1..8 distinct integers within 1..1000")
    return args

def host_sample(previous=None):
    sample = {"system_cpu_pct": None, "available_memory_mb": None, "rss_mb": None}
    try:
        values = list(map(int, Path("/proc/stat").read_text().splitlines()[0].split()[1:9]))
        total, idle = sum(values), values[3] + values[4]
        if previous and total > previous[0]: sample["system_cpu_pct"] = 100 * (1 - (idle - previous[1]) / (total - previous[0]))
        previous = (total, idle)
        info = dict(line.split(":", 1) for line in Path("/proc/meminfo").read_text().splitlines())
        sample["available_memory_mb"] = int(info["MemAvailable"].split()[0]) / 1024
        status = dict(line.split(":", 1) for line in Path("/proc/self/status").read_text().splitlines() if ":" in line)
        sample["rss_mb"] = int(status["VmRSS"].split()[0]) / 1024
    except (OSError, ValueError, KeyError): pass
    return sample, previous

def setup(db, players):
    with contextlib.closing(sqlite3.connect(db)) as connection:
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute("CREATE TABLE players(id INTEGER PRIMARY KEY, payload TEXT NOT NULL)")
        connection.execute("CREATE TABLE events(id INTEGER PRIMARY KEY, payload TEXT NOT NULL)")
        for number in range(1, players + 1):
            data = {"id": number, "name": "守护者" + str(number), "level": 1 + number % 20,
                    "position": [number * 73 % 5000, number * 37 % 5000],
                    "orchard": {"level": 3, "hp": 500, "buildings": [{"type": kind, "level": 2} for kind in ["farm", "wall", "tower", "barracks"]]},
                    "army": 12, "seeds": 200, "training": [{"unit": "leaf", "readyAt": 1700000000}]}
            connection.execute("INSERT INTO players VALUES(?,?)", (number, json.dumps(data, ensure_ascii=False)))
        connection.commit()

def operation(db, kind, player):
    connection = sqlite3.connect(db, timeout=1)
    try:
        if kind != "read": connection.execute("BEGIN IMMEDIATE")
        own = json.loads(connection.execute("SELECT payload FROM players WHERE id=?", (player,)).fetchone()[0])
        if kind == "read":
            rows = connection.execute("SELECT payload FROM players WHERE id<>? ORDER BY id LIMIT 20", (player,)).fetchall()
            nearby = [{key: data[key] for key in ["id", "name", "level", "position", "orchard", "army"]} for data in map(lambda row: json.loads(row[0]), rows)]
            events = [json.loads(row[0]) for row in connection.execute("SELECT payload FROM events ORDER BY id DESC LIMIT 20")]
            response = {"self": own, "nearby": nearby, "events": events}
        else:
            if kind == "write":
                if player % 2: own["orchard"]["level"] += 1
                else: own["army"] += 1
                response = {"ok": True, "player": own}
            else:
                own["army"] = max(0, own["army"] - 1)
                response = {"ok": True, "attacker": player, "army": own["army"], "result": "model-only"}
            connection.execute("UPDATE players SET payload=? WHERE id=?", (json.dumps(own, ensure_ascii=False), player))
            connection.execute("INSERT INTO events(payload) VALUES(?)", (json.dumps({"kind": kind, "player": player, "army": own["army"]}),))
            connection.commit()
        return len(json.dumps(response, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))
    finally: connection.close()

async def stage(db, players, seconds):
    samples, latencies, counts, sizes = [], [], {kind: 0 for kind in RATES}, {kind: [] for kind in RATES}
    errors, reason, previous = 0, None, None
    start, cpu_start = time.perf_counter(), time.process_time()
    first, previous = host_sample(previous); samples.append(first)
    if first["available_memory_mb"] is not None and first["available_memory_mb"] < 128: reason = "available memory below 128 MiB"
    plan = sorted(((index + .5) / (players * rate), kind, index % players + 1)
                  for kind, rate in RATES.items() for index in range(math.ceil(seconds * players * rate))
                  if (index + .5) / (players * rate) < seconds)
    async def request(at, kind, player):
        nonlocal errors
        try:
            size = await asyncio.get_running_loop().run_in_executor(pool, operation, db, kind, player)
            counts[kind] += 1; sizes[kind].append(size)
        except Exception: errors += 1
        latencies.append(max(0, (time.perf_counter() - start - at) * 1000))
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        pending = set(); next_sample = 0
        for at, kind, player in plan:
            if reason: break
            await asyncio.sleep(max(0, start + at - time.perf_counter()))
            if time.perf_counter() - start >= seconds: reason = "workload exceeded stage deadline"; break
            if time.perf_counter() - start >= next_sample:
                sample, previous = host_sample(previous); samples.append(sample); next_sample = time.perf_counter() - start + .5
                if sample["system_cpu_pct"] is not None and sample["system_cpu_pct"] >= 85: reason = "host CPU reached 85%"
                if sample["available_memory_mb"] is not None and sample["available_memory_mb"] < 128: reason = "available memory below 128 MiB"
                if reason: break
            pending = {task for task in pending if not task.done()}
            if len(pending) >= 32: await asyncio.wait(pending, return_when=asyncio.FIRST_COMPLETED)
            if time.perf_counter() - start >= seconds: reason = "workload exceeded stage deadline"; break
            pending.add(asyncio.create_task(request(at, kind, player)))
        if pending: await asyncio.gather(*pending)
        if not reason: await asyncio.sleep(max(0, start + seconds - time.perf_counter()))
    elapsed = time.perf_counter() - start; last, previous = host_sample(previous); samples.append(last)
    def metric(key, pick):
        available = [sample[key] for sample in samples if sample[key] is not None]
        return round(pick(available), 2) if available else None
    means = {kind: sum(values) / len(values) if values else (operation(db, "read", 1) if kind == "read" else 400) for kind, values in sizes.items()}
    bytes_sec = players * sum(RATES[kind] * (means[kind] + 400) for kind in RATES)
    ordered = sorted(latencies); p95 = ordered[max(0, math.ceil(len(ordered) * .95) - 1)] if ordered else None
    return {"players": players, "elapsed_s": round(elapsed, 3), "stopped": reason, "success_counts": counts, "errors": errors,
            "p95_ms": round(p95, 3) if p95 is not None else None, "process_cpu_pct_of_host": round(100 * (time.process_time() - cpu_start) / elapsed / (os.cpu_count() or 1), 2),
            "peak_system_cpu_pct": metric("system_cpu_pct", max), "peak_rss_mb": metric("rss_mb", max), "min_available_memory_mb": metric("available_memory_mb", min),
            "mean_payload_bytes": {key: round(value) for key, value in means.items()}, "bytes_per_second_estimate": round(bytes_sec),
            "mbps_estimate": round(bytes_sec * 8 / 1e6, 3), "within_2mbps_70pct": bytes_sec * 8 <= 1400000,
            "gb_per_30days_24h_estimate": round(bytes_sec * 30 * 86400 / 1e9, 2), "daily_active_hours_for_100gb": round(min(24, 100e9 / bytes_sec / 30 / 3600), 2)}

def main(argv=None):
    args = arguments(argv); results = []
    with tempfile.TemporaryDirectory(prefix="orchard-capacity-") as directory:
        for players in args.players:
            db = str(Path(directory) / (str(players) + ".sqlite")); setup(db, players)
            result = asyncio.run(stage(db, players, args.seconds)); results.append(result)
            if result["stopped"]: break
    print(json.dumps({"warning": "Synthetic local SQLite model; not a production-world or network test. No real player accounts or saves touched.",
          "model": {"per_player_per_minute": {"world_reads": 4, "build_or_train": 1, "attacks": .2}, "nearby_limit": 20, "event_limit": 20, "workers": 8, "estimated_response_overhead_bytes": 400},
          "host": {"platform": platform.system(), "logical_cpus": os.cpu_count()}, "stages": results}, ensure_ascii=False, indent=2))
    print("Players  Read/Write/Attack  Errors  p95 ms  Est Mbps  2Mbps@70%", file=sys.stderr)
    for result in results:
        c = result["success_counts"]
        print(f'{result["players"]:7}  {c["read"]}/{c["write"]}/{c["attack"]:5}  {result["errors"]:6}  {str(result["p95_ms"]):>6}  {result["mbps_estimate"]:8.3f}  {result["within_2mbps_70pct"]}', file=sys.stderr)

if __name__ == "__main__": main()
