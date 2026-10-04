#!/usr/bin/env python3
"""Fast correctness/safety checks; no server or network access."""
import asyncio, concurrent.futures, contextlib, importlib.util, io, json, sqlite3, subprocess, sys, tempfile
from pathlib import Path

SCRIPT = Path(__file__).with_name("world-capacity-bench.py")
spec = importlib.util.spec_from_file_location("capacity", SCRIPT)
bench = importlib.util.module_from_spec(spec); spec.loader.exec_module(bench)
checks = 0

def check(name, fn):
    global checks
    fn(); checks += 1; print("PASS " + name)

def arguments():
    assert bench.arguments([]).seconds == 10
    assert bench.arguments([]).players == [50, 100, 200, 400]
    for args in [["--seconds", "0"], ["--seconds", "31"], ["--seconds", "nan"], ["--players", "0"],
                 ["--players", "1001"], ["--players", "1,1"], ["--players", "1,2,3,4,5,6,7,8,9"], ["--players", ""]]:
        try:
            with contextlib.redirect_stderr(io.StringIO()): bench.arguments(args)
        except SystemExit as error: assert error.code == 2
        else: raise AssertionError("Invalid input accepted")

check("Input stages, durations and player counts stay bounded", arguments)

with tempfile.TemporaryDirectory(prefix="orchard-capacity-verify-") as directory:
    db = str(Path(directory) / "model.sqlite"); bench.setup(db, 25)
    def serialized_snapshots():
        assert bench.operation(db, "read", 1) > 1000
        assert bench.operation(db, "write", 1) > 100
        assert bench.operation(db, "attack", 1) > 40
        with contextlib.closing(sqlite3.connect(db)) as connection:
            assert connection.execute("SELECT count(*) FROM players").fetchone()[0] == 25
            assert connection.execute("SELECT count(*) FROM events").fetchone()[0] == 2
    check("Temporary SQLite reads serialize a real-sized snapshot and writes commit", serialized_snapshots)
    def transactions():
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            list(pool.map(lambda _: bench.operation(db, "write", 2), range(20)))
        with contextlib.closing(sqlite3.connect(db)) as connection:
            data = json.loads(connection.execute("SELECT payload FROM players WHERE id=2").fetchone()[0])
            assert data["army"] == 32
            assert connection.execute("SELECT count(*) FROM events").fetchone()[0] == 22
    check("Concurrent connections serialize writes without losing an update", transactions)
    def safety_stops():
        original = bench.host_sample
        try:
            bench.host_sample = lambda previous=None: ({"system_cpu_pct": None, "available_memory_mb": 64, "rss_mb": 20}, previous)
            low_memory = asyncio.run(bench.stage(db, 25, 1))
            assert "128 MiB" in low_memory["stopped"] and sum(low_memory["success_counts"].values()) == 0
            bench.host_sample = lambda previous=None: ({"system_cpu_pct": 90, "available_memory_mb": 512, "rss_mb": 20}, previous)
            high_cpu = asyncio.run(bench.stage(db, 25, 1))
            assert "85%" in high_cpu["stopped"] and sum(high_cpu["success_counts"].values()) == 0
        finally: bench.host_sample = original
    check("Linux low-memory and high-CPU guards stop before submitting workload", safety_stops)

def short_run():
    result = subprocess.run([sys.executable, str(SCRIPT), "--seconds", "1", "--players", "12"], capture_output=True, text=True, timeout=8)
    assert result.returncode == 0, result.stderr
    report = json.loads(result.stdout); stage = report["stages"][0]
    assert report["model"]["workers"] == 8
    assert "not a production-world or network test" in report["warning"]
    assert stage["players"] == 12 and stage["errors"] == 0
    if not stage["stopped"]:
        assert stage["elapsed_s"] >= .95
        assert stage["success_counts"]["read"] >= 1
        assert stage["p95_ms"] >= 0
    assert stage["mbps_estimate"] > 0 and stage["gb_per_30days_24h_estimate"] > 0
    assert 0 < stage["daily_active_hours_for_100gb"] <= 24
    assert "Read/Write/Attack" in result.stderr
check("One-second small model produces JSON and a clear bounded sample table", short_run)
print(str(checks) + " capacity model checks passed.")
