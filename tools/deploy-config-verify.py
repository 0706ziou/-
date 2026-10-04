#!/usr/bin/env python3
"""Run only the deploy script's embedded Python against temporary config fixtures."""
import os, pathlib, re, subprocess, sys, tempfile

SCRIPT = pathlib.Path(__file__).with_name("deploy-ip-site.sh")
source = SCRIPT.read_text(encoding="utf-8")
blocks = re.findall(r"^python3[^\n]*<<'PY'\n(.*?)^PY$", source, flags=re.M | re.S)

def block(signature):
    selected = [code for code in blocks if signature in code]
    if len(selected) != 1:
        raise AssertionError("Expected one real embedded Python block: " + signature)
    return selected[0]

HTTP_CODE = block("begin, end =")
TLS_CODE = block("section =")
IP = "111.230.149.65"
OWN_TLS = "/etc/nginx/conf.d/orchard-guardians-https.conf"
BEGIN, END = "# BEGIN ORCHARD DEPLOYMENT", "# END ORCHARD DEPLOYMENT"
BASE = """# An existing unrelated game; every original route must survive.
server {
    listen 80;
    listen [::]:80;
    server_name 111.230.149.65 youxi1.111-230-149-65.sslip.io;
    root /srv/original-game;
    location /assets/ { alias /srv/original-game/assets/; }
    location = /health { return 200 'old-game-ok'; }
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
    }
}
"""
passed, failures = 0, []

def check(name, function):
    global passed
    try:
        function()
        passed += 1
        print("PASS " + name)
    except Exception as error:
        failures.append(name)
        print("FAIL " + name + ": " + str(error), file=sys.stderr)

def execute(code, *args):
    environment = dict(os.environ, PYTHONUTF8="1")
    return subprocess.run([sys.executable, "-", *map(str, args)], input=code,
                          text=True, encoding="utf-8", capture_output=True,
                          env=environment, timeout=5)

def http_fixture(text, expect_success):
    with tempfile.TemporaryDirectory(prefix="orchard-config-verify-") as directory:
        fixture = pathlib.Path(directory) / "youxi1.conf"
        fixture.write_text(text, encoding="utf-8", newline="\n")
        original = fixture.read_bytes()
        result = execute(HTTP_CODE, fixture, IP, "/var/www/orchard-acme")
        assert (result.returncode == 0) == expect_success, result.stderr or "Expected rejection, but config was accepted"
        if not expect_success:
            assert fixture.read_bytes() == original, "Rejected input was nevertheless modified"
        return fixture.read_text(encoding="utf-8")

def preserved_routes():
    output = http_fixture(BASE, True)
    unmanaged = re.sub(r"^[ \t]*" + re.escape(BEGIN) + r".*?" + re.escape(END) + r"\n?", "", output, flags=re.M | re.S)
    assert unmanaged == BASE, "An original directive or proxy route changed"
    assert "location ^~ /.well-known/acme-challenge/" in output
    assert "root /var/www/orchard-acme;" in output
    assert "location = /orchard { return 302 https://" + IP + "/orchard/; }" in output
    assert "location ^~ /orchard/ { return 302 https://" + IP + "$request_uri; }" in output
    assert output.index(BEGIN) < output.index("    location / {"), "Managed routes are not before the proxy root"

def idempotence():
    with tempfile.TemporaryDirectory(prefix="orchard-config-rerun-") as directory:
        fixture = pathlib.Path(directory) / "youxi1.conf"
        fixture.write_text(BASE, encoding="utf-8", newline="\n")
        for attempt in range(3):
            result = execute(HTTP_CODE, fixture, IP, "/var/www/orchard-acme")
            assert result.returncode == 0, result.stderr
            output = fixture.read_text(encoding="utf-8")
            assert output.count(BEGIN) == output.count(END) == 1
            assert output.count("location ^~ /.well-known/acme-challenge/") == 1
            if attempt == 0: initial = fixture.read_bytes()
            else: assert fixture.read_bytes() == initial, "Rerun changed bytes or duplicated managed routes"

check("HTTP additions preserve the exact existing root, proxy and other routes", preserved_routes)
check("Repeated HTTP config generation is byte-stable with one marker block", idempotence)

for name, text in [
    ("different hostname", BASE.replace(IP, "111.230.149.66")),
    ("IP-looking hostname is not the exact IP token", BASE.replace(IP + " ", IP + ".evil.example ")),
    ("missing BEGIN marker", BASE.replace("    location / {", "    " + END + "\n    location / {")),
    ("missing END marker", BASE.replace("    location / {", "    " + BEGIN + "\n    location / {")),
    ("reversed markers", BASE.replace("    location / {", "    " + END + "\n    " + BEGIN + "\n    location / {")),
    ("duplicate nested BEGIN marker", BASE.replace("    location / {", "    " + BEGIN + "\n    " + BEGIN + "\n    " + END + "\n    location / {")),
    ("duplicate marker blocks", BASE.replace("    location / {", ("    " + BEGIN + "\n    " + END + "\n") * 2 + "    location / {")),
    ("unmanaged exact orchard route", BASE.replace("    location / {", "    location = /orchard { return 200; }\n    location / {")),
    ("unmanaged prefix orchard route", BASE.replace("    location / {", "    location ^~ /orchard/ { root /srv/other; }\n    location / {")),
    ("unmanaged ACME route", BASE.replace("    location / {", "    location /.well-known/acme-challenge/ { root /srv/other; }\n    location / {")),
    ("duplicate root location", BASE.replace("    location / {", "    location / { return 404; }\n    location / {")),
    ("multiple server blocks", BASE + "server {\n    listen 8080;\n    location / { return 200; }\n}\n"),
    ("missing expected root location", BASE.replace("    location / {", "    location = / {")),
]:
    check("HTTP rejects " + name + " without changing the file", lambda text=text: http_fixture(text, False))

def tls_fixture(text, expect_success):
    with tempfile.TemporaryDirectory(prefix="orchard-listener-verify-") as directory:
        fixture = pathlib.Path(directory) / "nginx-current.txt"
        fixture.write_text(text, encoding="utf-8", newline="\n")
        original = fixture.read_bytes()
        result = execute(TLS_CODE, fixture, OWN_TLS)
        assert (result.returncode == 0) == expect_success, result.stderr or "Expected conflicting listener rejection"
        assert fixture.read_bytes() == original, "Listener inspection changed its input"

OTHER = "# configuration file /etc/nginx/conf.d/original.conf:\n"
OWN = "# configuration file " + OWN_TLS + ":\n"
for name, text, success in [
    ("ordinary IPv4 and IPv6 HTTP routes", OTHER + "listen 80;\nlisten [::]:80;\n", True),
    ("commented TLS template", OTHER + "  # listen 443 ssl;\n# listen [::]:443 ssl;\nlisten 80; # example: listen 443;\n", True),
    ("similar non-TLS ports", OTHER + "listen 1443;\nlisten [::]:4430;\n", True),
    ("owned TLS section only", OWN + "listen 443 ssl default_server;\nlisten [::]:443 ssl default_server;\n" + OTHER + "listen 80;\n", True),
    ("unowned IPv4 TLS", OTHER + "listen 443 ssl;\n", False),
    ("unowned IPv6 TLS", OTHER + "listen [::]:443 ssl;\n", False),
    ("unowned explicit-address TLS", OTHER + "listen 127.0.0.1:443 ssl default_server;\n", False),
    ("conflict after owned TLS section", OWN + "listen 443 ssl;\n" + OTHER + "listen 443 ssl;\n", False),
    ("valid inline Nginx TLS directive", OTHER + "server { listen 443 ssl; }\n", False),
    ("valid multiline Nginx TLS directive", OTHER + "listen\n    443\n    ssl;\n", False),
]:
    check("TLS listener detector handles " + name, lambda text=text, success=success: tls_fixture(text, success))

print(f"{passed} deployment config checks passed; {len(failures)} failed. No server or Nginx was accessed.")
if failures: sys.exit(1)
