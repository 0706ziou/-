#!/usr/bin/env python3
"""Exercise the actual static/world TLS builders using temporary files only."""
import os
import pathlib
import re
import subprocess
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parent


def embedded(file, signature):
    source = file.read_text(encoding="utf-8")
    blocks = re.findall(r"^[ \t]*python3[^\n]*<<'PY'\n(.*?)^PY$", source, re.M | re.S)
    selected = [block for block in blocks if signature in block]
    assert len(selected) == 1, "Expected one real embedded block: " + signature
    return selected[0]


EXTRACT = embedded(ROOT / "deploy-ip-site.sh", "WORLD_PROXY_REQUIREMENTS")
RENDER = embedded(ROOT / "deploy-ip-site.sh", "template, world_block, output")
INSTALL = embedded(ROOT / "deploy-world-server.sh", "begin, end = '# BEGIN ORCHARD WORLD API'")
BASE = """# Managed by Orchard Guardians. Original TLS routes.
server {
    listen 443 ssl default_server;
    listen [::]:443 ssl default_server;
    server_name 111.230.149.65;
    ssl_certificate /etc/managed/fullchain.pem;
    ssl_certificate_key /etc/managed/privkey.pem;
    location /orchard/ { try_files $uri $uri/ =404; }
    location = /quoted { return 200 "braces {} and # quoted"; }
    location / { return 404; }
}
"""
BEGIN, END = "# BEGIN ORCHARD WORLD API", "# END ORCHARD WORLD API"
passed = 0
failures = []


def run(code, *args):
    return subprocess.run([sys.executable, "-", *map(str, args)], input=code, text=True,
                          encoding="utf-8", capture_output=True,
                          env=dict(os.environ, PYTHONUTF8="1"), timeout=5)


def check(name, function):
    global passed
    try:
        function()
        passed += 1
        print("PASS " + name, flush=True)
    except Exception as error:
        failures.append(name)
        print("FAIL " + name + ": " + str(error), file=sys.stderr, flush=True)


def installed_world():
    with tempfile.TemporaryDirectory(prefix="orchard-world-proxy-") as directory:
        source, output = pathlib.Path(directory) / "original", pathlib.Path(directory) / "world"
        source.write_bytes(BASE.encode())
        result = run(INSTALL, source, output, "111.230.149.65")
        assert result.returncode == 0, result.stderr
        assert source.read_bytes() == BASE.encode()
        return output.read_text(encoding="utf-8")


WORLD = installed_world()


def extract(text, expected=True):
    with tempfile.TemporaryDirectory(prefix="orchard-world-extract-") as directory:
        source, output = pathlib.Path(directory) / "original", pathlib.Path(directory) / "block"
        if text is not None:
            source.write_bytes(text.encode())
        result = run(EXTRACT, source, output)
        assert (result.returncode == 0) == expected, result.stderr or "Unsafe config accepted"
        if text is not None:
            assert source.read_bytes() == text.encode(), "Inspection modified original TLS config"
        if expected:
            return output.read_bytes()
        assert not output.exists(), "Rejected config left an accepted proxy block"


def publish(block, template=BASE):
    with tempfile.TemporaryDirectory(prefix="orchard-world-publish-") as directory:
        root = pathlib.Path(directory)
        (root / "new").write_bytes(template.encode())
        (root / "block").write_bytes(block)
        result = run(RENDER, root / "new", root / "block", root / "output")
        assert result.returncode == 0, result.stderr
        assert (root / "new").read_bytes() == template.encode()
        assert (root / "block").read_bytes() == block
        return (root / "output").read_bytes()


def first_static():
    assert extract(None) == extract(BASE) == b""
    assert publish(b"") == BASE.encode()


def preserve_world():
    block = extract(WORLD)
    expected = re.search(r"^[ \t]*" + re.escape(BEGIN) + r"\n.*?^[ \t]*" + re.escape(END) + r"\n",
                         WORLD, re.M | re.S).group().encode()
    assert block == expected, "Original world block bytes changed"
    result = publish(block)
    assert result == WORLD.encode(), "Static rendering lost or changed a TLS route"
    for _ in range(3):
        replayed = publish(extract(result.decode()))
        assert replayed == result, "Repeated static deployment changed bytes"


def preserve_headers_and_custom_timeouts():
    custom = WORLD.replace("proxy_read_timeout 15s;", "proxy_read_timeout 30s;")
    custom = custom.replace("proxy_set_header X-Forwarded-Proto $scheme;", "proxy_set_header X-Forwarded-Proto https;")
    custom = custom.replace("http://127.0.0.1:8766", "http://localhost:8766")
    block = extract(custom)
    assert publish(block) == custom.encode()


check("First static-only deployment and existing site without world route work unchanged", first_static)
check("Actual installer world block survives static upgrades byte-for-byte and three repeated upgrades", preserve_world)
check("Reviewed localhost upstream, HTTPS header and bounded timeout variants remain intact", preserve_headers_and_custom_timeouts)

for name, text in [
    ("missing BEGIN marker", WORLD.replace(BEGIN, "# no begin")),
    ("missing END marker", WORLD.replace(END, "# no end")),
    ("reversed markers", WORLD.replace(BEGIN, "# placeholder").replace(END, BEGIN).replace("# placeholder", END)),
    ("duplicate markers", WORLD.replace(BEGIN, BEGIN + "\n    " + BEGIN)),
    ("marker embedded in comment", WORLD.replace(BEGIN, "# prefix " + BEGIN)),
    ("world location outside its marker", WORLD.replace("    location / {", "    location /api/world/private { return 200; }\n    location / {")),
    ("unmarked world route", BASE.replace("    location / {", "    location /api/world/ { return 200; }\n    location / {")),
    ("second server block", WORLD + "server { listen 8443; }\n"),
    ("incomplete route braces", WORLD.replace("    # END", "    }\n    # END")),
    ("world block outside server", WORLD.replace("    " + BEGIN, "}\n    " + BEGIN)),
    ("wrong world location", WORLD.replace("location ^~ /api/world/", "location /api/world/")),
    ("wrong upstream port", WORLD.replace("127.0.0.1:8766", "127.0.0.1:8765")),
    ("remote upstream", WORLD.replace("http://127.0.0.1:8766", "http://other.example:8766")),
    ("missing scheme header", WORLD.replace("        proxy_set_header X-Forwarded-Proto $scheme;\n", "")),
    ("unsafe scheme header", WORLD.replace("X-Forwarded-Proto $scheme", "X-Forwarded-Proto $http_x_forwarded_proto")),
    ("unsafe real IP header", WORLD.replace("X-Real-IP $remote_addr", "X-Real-IP $http_x_real_ip")),
    ("unsafe Host header", WORLD.replace("Host $host", "Host $http_x_forwarded_host")),
    ("duplicate required directive", WORLD.replace("        proxy_pass", "        proxy_pass http://127.0.0.1:8766;\n        proxy_pass")),
    ("unreviewed include directive", WORLD.replace("    # END", "        include /etc/unrelated.conf;\n    # END")),
    ("missing directive semicolon", WORLD.replace("proxy_read_timeout 15s;", "proxy_read_timeout 15s")),
    ("unbounded timeout", WORLD.replace("proxy_read_timeout 15s;", "proxy_read_timeout 90s;")),
    ("oversized request setting", WORLD.replace("client_max_body_size 8k;", "client_max_body_size 10m;")),
]:
    check("Static deployment rejects " + name + " without modifying its source", lambda text=text: extract(text, False))

print(f"{passed} world deployment config checks passed; {len(failures)} failed. No server, network or Git writes used.")
if failures:
    sys.exit(1)
