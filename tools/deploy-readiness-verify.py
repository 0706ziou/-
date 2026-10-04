#!/usr/bin/env python3
"""Exercise the installer's real readiness/cache code with local, bounded fixtures.

No server, network request, Nginx process, or Git mutation is used. Curl and sleep
are shell functions in each isolated fixture, so retry checks finish immediately.
"""
import argparse
import json
import os
import pathlib
import re
import shlex
import shutil
import subprocess
import sys
import tempfile


WORKSPACE = pathlib.Path(__file__).resolve().parent.parent
INSTALLER = WORKSPACE / "tools" / "deploy-ip-site.sh"
PINNED_SITE = WORKSPACE / "deployment-artifacts" / "pinned-036e28a" / "source-zip" / "deployment-artifacts" / "orchard-site-20261004T093247558Z-cjWgs2" / "site"
GIT_BASH = pathlib.Path("C:/Program Files/Git/bin/bash.exe")

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--site", type=pathlib.Path, default=PINNED_SITE,
                    help="Pristine, pinned 036e28a runtime site fixture")
arguments = parser.parse_args()
source = INSTALLER.read_text(encoding="utf-8")
helpers = re.findall(r"^wait_for_served_file\(\) \{\n.*?^\}", source, re.M | re.S)
assert len(helpers) == 1, "Expected one actual Bash readiness helper"
embedded = re.findall(r"^[ \t]*python3[^\n]*<<'PY'\n(.*?)^PY$", source, re.M | re.S)
caches = [code for code in embedded if "EXPECTED_CACHE =" in code]
assert len(caches) == 1, "Expected one actual embedded pinned-cache verifier"
READY_CODE, CACHE_CODE = helpers[0], caches[0]
BASH = str(GIT_BASH) if GIT_BASH.is_file() else shutil.which("bash")
assert BASH, "Bash is required to exercise the actual readiness function"
assert arguments.site.is_dir(), "Pristine pinned runtime fixture is missing: " + str(arguments.site)

passed = 0
failures = []
skipped = []


class UnsupportedSymlink(Exception):
    pass


def check(name, function):
    global passed
    try:
        function()
        passed += 1
        print("PASS " + name, flush=True)
    except UnsupportedSymlink as error:
        skipped.append(name)
        print("SKIP " + name + ": " + str(error), flush=True)
    except Exception as error:
        failures.append(name)
        print("FAIL " + name + ": " + str(error), file=sys.stderr, flush=True)


def run_cache(site):
    return subprocess.run([sys.executable, "-", str(site)], input=CACHE_CODE,
                          text=True, encoding="utf-8", capture_output=True,
                          env=dict(os.environ, PYTHONUTF8="1"), timeout=15)


def require_cache(site, success):
    result = run_cache(site)
    assert (result.returncode == 0) == success, result.stderr or "Unexpected cache-verification success"
    if success:
        assert "Pinned cached release verified" in result.stdout, result.stdout


def shell_array(values):
    return "(" + " ".join(shlex.quote(str(value)) for value in values) + ")"


def readiness_fixture(directory, responses, success, attempts, url="https://111.230.149.65/orchard/index.html"):
    """responses entries are (HTTP status, payload kind, curl return code)."""
    (directory / "expected").write_bytes(b"reviewed-game-payload\x00\n")
    (directory / "wrong").write_bytes(b"previous-game-payload\x00\n")
    (directory / "empty").write_bytes(b"")
    (directory / "count").write_text("0", encoding="ascii")
    stub = """#!/usr/bin/env bash
set -euo pipefail
export PATH="/usr/bin:/bin:$PATH"
root=$1
codes=__CODES__
bodies=__BODIES__
returns=__RETURNS__
curl() {
  local count index output='' previous='' value
  count=$(cat "$root/count")
  count=$((count + 1))
  printf '%s' "$count" > "$root/count"
  printf '%s\\n' "$@" > "$root/args-$count"
  for value in "$@"; do
    if [[ $previous == -o ]]; then output=$value; fi
    previous=$value
  done
  [[ -n $output ]] || return 99
  index=$((count - 1))
  if [[ $index -ge ${#codes[@]} ]]; then index=$((${#codes[@]} - 1)); fi
  cp "$root/${bodies[$index]}" "$output"
  printf '%s' "${codes[$index]}"
  if [[ ${returns[$index]} != 0 ]]; then
    printf 'Simulated curl error %s\\n' "${returns[$index]}" >&2
  fi
  return "${returns[$index]}"
}
sleep() {
  printf '%s\\n' "$*" >> "$root/sleeps"
}
__HELPER__
if wait_for_served_file __URL__ '111.230.149.65:443:127.0.0.1' "$root/expected" "$root/output"; then
  exit 0
else
  exit 23
fi
"""
    stub = stub.replace("__CODES__", shell_array([response[0] for response in responses]))
    stub = stub.replace("__BODIES__", shell_array([response[1] for response in responses]))
    stub = stub.replace("__RETURNS__", shell_array([response[2] for response in responses]))
    stub = stub.replace("__HELPER__", READY_CODE).replace("__URL__", shlex.quote(url))
    script = directory / "exercise.sh"
    script.write_text(stub, encoding="utf-8", newline="\n")
    result = subprocess.run([BASH, script.as_posix(), directory.as_posix()],
                            text=True, encoding="utf-8", capture_output=True, timeout=15)
    assert result.returncode == (0 if success else 23), result.stderr or result.stdout
    assert int((directory / "count").read_text()) == attempts, "Unexpected attempt count"
    sleep_file = directory / "sleeps"
    sleeps = sleep_file.read_text().splitlines() if sleep_file.exists() else []
    assert sleeps == ["1"] * (attempts - 1), "Delay count or bounded interval changed"
    if not success:
        assert "Route readiness failed after 15 attempts" in result.stderr, result.stderr
    for attempt in range(1, attempts + 1):
        args = (directory / ("args-" + str(attempt))).read_text().splitlines()
        for flag, value in [("--noproxy", "*"), ("--header", "Connection: close"),
                            ("--connect-timeout", "3"), ("--max-time", "5"),
                            ("--resolve", "111.230.149.65:443:127.0.0.1"),
                            ("--write-out", "%{http_code}")]:
            assert flag in args and args[args.index(flag) + 1] == value, "Curl option changed: " + flag
        assert "--fail" in args and url in args, "Curl no longer rejects HTTP errors or uses the supplied URL"
        assert not any(arg in ("-k", "--insecure", "--proxy-insecure") for arg in args), "TLS validation bypassed"


def make_symlink(target, link, is_directory=False):
    try:
        link.symlink_to(target, target_is_directory=is_directory)
    except OSError as error:
        if os.name == "nt" and getattr(error, "winerror", None) == 1314:
            raise UnsupportedSymlink("Windows does not grant symlink creation to this process") from error
        raise


temporary_parent = WORKSPACE / "deployment-artifacts"
temporary_parent.mkdir(exist_ok=True)
with tempfile.TemporaryDirectory(prefix="readiness-qa-", dir=temporary_parent) as temporary:
    root = pathlib.Path(temporary)
    cases = [
        ("Immediate HTTP 200 with exact bytes succeeds in one request", [(200, "expected", 0)], True, 1),
        ("Initial reload HTTP 404 then correct response succeeds", [(404, "empty", 22), (200, "expected", 0)], True, 2),
        ("Old HTTP 200 payload then correct bytes succeeds", [(200, "wrong", 0), (200, "expected", 0)], True, 2),
        ("Permanent HTTP 404 rejects after exactly 15 requests", [(404, "empty", 22)], False, 15),
        ("Permanent stale payload rejects after exactly 15 requests", [(200, "wrong", 0)], False, 15),
        ("HTTP 302 with matching bytes is rejected", [(302, "expected", 0)], False, 15),
        ("Untrusted TLS certificate rejects without disabling validation", [("000", "empty", 60)], False, 15),
        ("Connection failure rejects after bounded retries", [("000", "empty", 7)], False, 15),
        ("Curl error despite HTTP 200 and matching bytes is rejected", [(200, "expected", 35)], False, 15),
    ]
    for index, (name, responses, success, attempts) in enumerate(cases):
        directory = root / ("http-" + str(index))
        directory.mkdir()
        check(name, lambda directory=directory, responses=responses, success=success, attempts=attempts:
              readiness_fixture(directory, responses, success, attempts))

    check("Real pinned 036e28a release satisfies the embedded cache signature", lambda: require_cache(arguments.site, True))
    original_manifest_bytes = (arguments.site / "static-manifest.json").read_bytes()
    original_manifest = json.loads(original_manifest_bytes)
    assert original_manifest["fileCount"] == 53, "Pristine fixture is not the reviewed 53-file release"
    payload = original_manifest["files"][0]["path"]

    def cache_fixture(name, change, success=False):
        directory = root / name
        shutil.copytree(arguments.site, directory)
        change(directory)
        require_cache(directory, success)

    def tamper_payload(directory):
        path = directory / payload
        body = path.read_bytes()
        assert body, "The selected runtime fixture should be nonempty"
        path.write_bytes(bytes([body[0] ^ 1]) + body[1:])

    def change_manifest(directory, change):
        manifest_path = directory / "static-manifest.json"
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        change(manifest)
        manifest_path.write_text(json.dumps(manifest, ensure_ascii=False), encoding="utf-8")

    def change_timestamps(directory):
        for item in directory.rglob("*"):
            os.utime(item, (1_700_000_000, 1_700_000_000))
        change_manifest(directory, lambda manifest: manifest.update(generatedAt="2030-01-01T00:00:00.000Z"))

    def replaced_payload_and_manifest(directory):
        import hashlib
        tamper_payload(directory)
        body = (directory / payload).read_bytes()
        def change(manifest):
            entry = next(entry for entry in manifest["files"] if entry["path"] == payload)
            entry["sha256"] = hashlib.sha256(body).hexdigest()
        change_manifest(directory, change)

    check("Cache accepts file mtimes and generatedAt changes", lambda: cache_fixture("timestamps", change_timestamps, True))
    check("Cache rejects same-size tampered runtime bytes", lambda: cache_fixture("tampered", tamper_payload))
    check("Cache rejects a replaced payload with a matching forged file hash", lambda: cache_fixture("forged", replaced_payload_and_manifest))
    check("Cache rejects changed signed manifest metadata", lambda: cache_fixture("metadata", lambda directory: change_manifest(directory, lambda manifest: manifest.update(version=2))))
    check("Cache rejects invalid JSON manifest", lambda: cache_fixture("invalid-json", lambda directory: (directory / "static-manifest.json").write_text("{", encoding="utf-8")))
    check("Cache rejects missing manifest", lambda: cache_fixture("missing-manifest", lambda directory: (directory / "static-manifest.json").unlink()))
    check("Cache rejects missing runtime file", lambda: cache_fixture("missing-file", lambda directory: (directory / payload).unlink()))
    check("Cache rejects an unlisted file", lambda: cache_fixture("extra-file", lambda directory: (directory / "unexpected.txt").write_text("unreviewed", encoding="utf-8")))
    check("Cache rejects an unlisted empty directory", lambda: cache_fixture("extra-directory", lambda directory: (directory / "unexpected-empty").mkdir()))

    def symlink_runtime(directory):
        path = directory / payload
        path.unlink()
        make_symlink(arguments.site / payload, path)

    def symlink_manifest(directory):
        path = directory / "static-manifest.json"
        path.unlink()
        make_symlink(arguments.site / "static-manifest.json", path)

    def symlink_directory(directory):
        make_symlink(arguments.site / "assets", directory / "unlisted-link", True)

    def symlink_root():
        path = root / "linked-root"
        make_symlink(arguments.site, path, True)
        require_cache(path, False)

    check("Cache rejects a symlinked runtime file before reading payloads", lambda: cache_fixture("link-file", symlink_runtime))
    check("Cache rejects a symlinked manifest", lambda: cache_fixture("link-manifest", symlink_manifest))
    check("Cache rejects a directory symlink", lambda: cache_fixture("link-directory", symlink_directory))
    check("Cache rejects a symlinked release root", symlink_root)
    assert (arguments.site / "static-manifest.json").read_bytes() == original_manifest_bytes, "QA unexpectedly changed the pristine fixture"

print(f"{passed} readiness/cache checks passed; {len(failures)} failed; {len(skipped)} skipped. No network or server accessed.")
if failures:
    sys.exit(1)
