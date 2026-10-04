#!/usr/bin/env bash
# Managed by Orchard Guardians World. Installs only the shared-world API.
# Usage: bash tools/deploy-world-server.sh <reviewed full Git commit SHA>
set -Eeuo pipefail
umask 027

commit=${1:-}
repo=https://github.com/0706ziou/-.git
ip=111.230.149.65
ops=/opt/orchard-world
data=/var/lib/orchard-world
site=/var/www/orchard-guardians/orchard
tls=/etc/nginx/conf.d/orchard-guardians-https.conf
unit=/etc/systemd/system/orchard-world.service
nginx=/usr/sbin/nginx
marker='orchard-world-managed-v1'
unit_marker='# Managed by Orchard Guardians World.'
task_source=
backup=
old_link=
changed=0
complete=0

fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
[[ $EUID -eq 0 ]] || fail 'Run in the root terminal of the existing Orchard server.'
[[ $# -eq 1 && $commit =~ ^[0-9a-f]{40}$ ]] || fail 'Supply one reviewed full 40-character Git commit SHA.'
for command in python3 git curl systemctl ss flock install getent useradd readlink sha256sum; do
  command -v "$command" >/dev/null || fail "Required command missing: $command"
done
python=$(command -v python3)
nologin=$(command -v nologin) || fail 'A nologin shell is required.'
python3 -c 'import sys; assert sys.version_info >= (3, 10), "Python 3.10 or newer is required"'
[[ -x $nginx && -f $tls && ! -L $tls ]] || fail 'Deploy the managed static HTTPS site first.'
grep -q '^# Managed by Orchard Guardians' "$tls" || fail 'The HTTPS configuration is not managed by Orchard.'
[[ -d /opt/orchard-site && ! -L /opt/orchard-site && -f /opt/orchard-site/.orchard-managed ]] || fail 'The static deployment owner marker is missing.'
[[ ! -L /opt/orchard-site/deploy.lock ]] || fail 'Unexpected static deployment lock symlink.'
exec 9>/opt/orchard-site/deploy.lock
flock -n 9 || fail 'An Orchard static deployment or renewal is running. Retry when it finishes.'
[[ -L $site && -d $site ]] || fail 'The managed static game release is not ready.'
resolved_site=$(readlink -f "$site")
[[ $resolved_site == /var/www/orchard-guardians/releases/* ]] || fail 'Static release points outside the managed releases.'
[[ -f $site/index.html && -f $site/static-manifest.json ]] || fail 'The static game or its release manifest is missing.'
python3 - "$site" <<'PY'
import json, pathlib, re, sys
root = pathlib.Path(sys.argv[1])
html = (root / 'index.html').read_text(encoding='utf-8')
scripts = re.findall(r'<script\b[^>]*\bsrc=["\']([^"\']+)["\']', html, re.I)
world = [name.split('?', 1)[0] for name in scripts if name.split('/')[-1].startswith('frontier')]
if len(world) < 2 or any(not (root / name).is_file() for name in world):
    raise SystemExit('Publish the new static game with its world UI and reward scripts first.')
manifest = json.loads((root / 'static-manifest.json').read_text())
files = {item['path'] for item in manifest.get('files', [])}
if any(name not in files for name in world):
    raise SystemExit('The static manifest does not declare the new world scripts.')
PY
"$nginx" -t

# Marked, dedicated paths only; never adopt somebody else's directories or unit.
for directory in "$ops" "$data"; do
  [[ ! -L $directory && ( ! -e $directory || -d $directory ) ]] || fail "Unexpected managed path: $directory"
  if [[ -e $directory ]]; then
    [[ -f $directory/.orchard-world-managed && ! -L $directory/.orchard-world-managed ]] || fail "Unmanaged directory: $directory"
    [[ $(cat "$directory/.orchard-world-managed") == "$marker" ]] || fail "Owner marker mismatch: $directory"
  fi
done
[[ ! -L $unit && ( ! -e $unit || -f $unit ) ]] || fail 'Unexpected world service unit path.'
if [[ -e $unit ]]; then grep -qFx "$unit_marker" "$unit" || fail 'An unmanaged world service unit exists.'; fi
for path in "$ops/releases" "$ops/backups"; do
  [[ ! -L $path && ( ! -e $path || -d $path ) ]] || fail "Unexpected managed subdirectory: $path"
done
[[ ! -e $ops/current || -L $ops/current ]] || fail 'The world current version must be a managed symlink.'
if [[ -L $ops/current ]]; then
  old_link=$(readlink "$ops/current")
  resolved_old=$(readlink -f "$ops/current")
  [[ $resolved_old == "$ops/releases/"* && -f $resolved_old/world-server.py && ! -L $resolved_old/world-server.py ]] || fail 'Old world version points outside managed releases.'
fi

listener=$(ss -Hlnpt 'sport = :8766')
if [[ -n $listener ]]; then
  [[ -f $unit ]] && systemctl is-active --quiet orchard-world.service || fail 'Port 8766 belongs to an unmanaged process.'
  task_pid=$(systemctl show orchard-world.service --property MainPID --value)
  python3 - "$task_pid" "$listener" <<'PY'
import re, sys
pid, listeners = sys.argv[1], sys.argv[2].splitlines()
if not pid.isdigit() or int(pid) <= 0:
    raise SystemExit('Cannot identify the existing world service process.')
for line in listeners:
    owners = re.findall(r'\bpid=(\d+)', line)
    if '127.0.0.1:8766' not in line or not owners or any(owner != pid for owner in owners):
        raise SystemExit('Port 8766 is occupied by an unexpected listener; nothing taken over.')
PY
fi

if getent passwd orchardworld >/dev/null; then
  python3 - "$(getent passwd orchardworld)" "$(getent group orchardworld || true)" <<'PY'
import sys
account, group = sys.argv[1].split(':'), sys.argv[2].split(':')
if (len(account) != 7 or account[0] != 'orchardworld' or int(account[2]) == 0 or
    account[5] != '/nonexistent' or account[6] not in ('/sbin/nologin', '/usr/sbin/nologin') or
    len(group) != 4 or group[0] != 'orchardworld' or group[2] != account[3] or group[3]):
    raise SystemExit('Existing orchardworld account/group is not the dedicated non-login service identity.')
PY
else
  [[ -z $(getent group orchardworld || true) ]] || fail 'An unmanaged orchardworld group already exists.'
  useradd --system --user-group --home-dir /nonexistent --shell "$nologin" orchardworld
fi
install -d -m 755 "$ops" "$ops/releases"
install -d -m 700 "$ops/backups"
install -d -m 700 -o orchardworld -g orchardworld "$data"
printf '%s\n' "$marker" > "$ops/.orchard-world-managed"
printf '%s\n' "$marker" > "$data/.orchard-world-managed"
chmod 600 "$data/.orchard-world-managed"
chown orchardworld:orchardworld "$data/.orchard-world-managed"
[[ ! -L $ops/deploy.lock ]] || fail 'Unexpected world deployment lock symlink.'
exec 8>"$ops/deploy.lock"
flock -n 8 || fail 'Another world deployment is running.'
python3 - "$data" "$(id -u orchardworld)" <<'PY'
import pathlib, stat, sys
root, uid = pathlib.Path(sys.argv[1]), int(sys.argv[2])
allowed = {'.orchard-world-managed', 'world.sqlite', 'world.sqlite-wal', 'world.sqlite-shm'}
for item in root.iterdir():
    info = item.lstat()
    if item.name not in allowed or not stat.S_ISREG(info.st_mode) or info.st_uid != uid or info.st_mode & 0o077:
        raise SystemExit('Unexpected owner, permissions, or file in world data directory; do not overwrite it.')
PY
backup=$(mktemp -d "$ops/backups/world-XXXXXXXX")
cp -p "$tls" "$backup/https.conf"
[[ ! -f $unit ]] || cp -p "$unit" "$backup/service"
[[ -z $old_link ]] || printf '%s\n' "$old_link" > "$backup/old-link"
if systemctl is-active --quiet orchard-world.service; then touch "$backup/was-active"; fi
if systemctl is-enabled --quiet orchard-world.service 2>/dev/null; then touch "$backup/was-enabled"; fi

finish() {
  code=$?
  trap - EXIT
  if [[ $complete -eq 0 && $changed -eq 1 ]]; then
    printf '%s\n' 'World deployment failed; restoring its code, service, and HTTPS route. Database is retained.' >&2
    systemctl stop orchard-world.service || true
    cp -p "$backup/https.conf" "$tls" || true
    if [[ -f $backup/service ]]; then cp -p "$backup/service" "$unit" || true; else rm -f -- "$unit"; fi
    if [[ -n $old_link ]]; then
      ln -s "$old_link" "$ops/.restore-$$" && mv -Tf "$ops/.restore-$$" "$ops/current" || true
    else rm -f -- "$ops/current"; fi
    systemctl daemon-reload || true
    if [[ -f $backup/was-enabled ]]; then systemctl enable orchard-world.service || true;
    else systemctl disable orchard-world.service 2>/dev/null || true; fi
    if [[ -f $backup/was-active ]]; then systemctl restart orchard-world.service || true; fi
    "$nginx" -t && "$nginx" -s reload || true
    printf 'Rollback backup: %s\n' "$backup" >&2
  fi
  if [[ -n $task_source && -d $task_source && $(readlink -f "$task_source") == "$ops/source-"* ]]; then
    rm -rf -- "$task_source"
  fi
  exit "$code"
}
trap finish EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

printf '%s\n' '1/4 Fetching one fixed server blob and checking the release.'
task_source=$(mktemp -d "$ops/source-XXXXXXXX")
git -C "$task_source" init --bare --quiet
git -C "$task_source" remote add origin "$repo"
git -C "$task_source" config remote.origin.promisor true
git -C "$task_source" config remote.origin.partialclonefilter blob:none
git -C "$task_source" config http.lowSpeedLimit 1024
git -C "$task_source" config http.lowSpeedTime 60
GIT_TERMINAL_PROMPT=0 git -C "$task_source" \
  fetch --quiet --filter=blob:none --depth=1 origin "$commit"
[[ $(git -C "$task_source" rev-parse FETCH_HEAD) == "$commit" ]] || fail 'Fetched commit does not match the reviewed version.'
# Raw bytes anchored by the Git commit; no Windows checkout/archive conversion.
GIT_TERMINAL_PROMPT=0 git -C "$task_source" cat-file blob "$commit:tools/world-server.py" > "$task_source/world-server.py"
python3 - "$task_source/world-server.py" <<'PY'
import ast, pathlib, sys
source = pathlib.Path(sys.argv[1]).read_bytes()
if len(source) > 1024 * 1024 or not source.startswith(b'#!/usr/bin/env python3\n'):
    raise SystemExit('Unexpected server blob size or format.')
compile(source, 'world-server.py', 'exec')
tree = ast.parse(source)
versions = [ast.literal_eval(node.value) for node in tree.body if isinstance(node, ast.Assign)
            and any(isinstance(target, ast.Name) and target.id == 'VERSION' for target in node.targets)]
if versions != ['orchard-world-1']:
    raise SystemExit('Unexpected world API version; review its migration before deployment.')
PY
release="$ops/releases/$commit"
[[ ! -L $release && ( ! -e $release || -d $release ) ]] || fail 'Unexpected world release path.'
if [[ -d $release ]]; then
  python3 - "$release" "$task_source/world-server.py" <<'PY'
import hashlib, pathlib, sys
root, source = map(pathlib.Path, sys.argv[1:])
if set(item.name for item in root.iterdir()) != {'world-server.py', '.orchard-world-release'}:
    raise SystemExit('Existing world release contains unexpected files.')
for item in root.iterdir():
    if item.is_symlink() or not item.is_file():
        raise SystemExit('Existing world release contains a non-regular file.')
if (root / '.orchard-world-release').read_text().strip() != root.name:
    raise SystemExit('Existing world release owner marker is invalid.')
if hashlib.sha256((root / 'world-server.py').read_bytes()).digest() != hashlib.sha256(source.read_bytes()).digest():
    raise SystemExit('Existing world release bytes differ from the fixed Git blob.')
PY
else
  install -d -m 755 "$release"
  install -m 644 "$task_source/world-server.py" "$release/world-server.py"
  printf '%s\n' "$commit" > "$release/.orchard-world-release"
fi
sha256sum "$release/world-server.py" > "$backup/server-sha256.txt"
printf '%s\n' "$commit" > "$backup/commit.txt"

printf '%s\n' '2/4 Preparing the dedicated service and preserving all existing HTTPS routes.'
cat > "$backup/new-service" <<SERVICE
$unit_marker
[Unit]
Description=Orchard Guardians shared world
After=network.target

[Service]
Type=simple
User=orchardworld
Group=orchardworld
WorkingDirectory=$ops
ExecStart=$python $ops/current/world-server.py --host 127.0.0.1 --port 8766 --db $data/world.sqlite --site $site --public-origin https://$ip --secure-cookie
Environment=PYTHONUNBUFFERED=1
Environment=PYTHONDONTWRITEBYTECODE=1
Restart=on-failure
RestartSec=3
TimeoutStopSec=10
UMask=0077
NoNewPrivileges=yes
PrivateTmp=yes
PrivateDevices=yes
ProtectSystem=strict
ProtectHome=yes
ReadWritePaths=$data
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectControlGroups=yes
RestrictSUIDSGID=yes
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
MemoryMax=256M
TasksMax=64
LimitNOFILE=1024

[Install]
WantedBy=multi-user.target
SERVICE
python3 - "$tls" "$backup/new-https.conf" "$ip" <<'PY'
import pathlib, re, sys
source, output, ip = sys.argv[1:]
text = pathlib.Path(source).read_text(encoding='utf-8')
begin, end = '# BEGIN ORCHARD WORLD API', '# END ORCHARD WORLD API'
if not text.startswith('# Managed by Orchard Guardians'):
    raise SystemExit('Refusing an unmanaged HTTPS configuration.')
if text.count(begin) != text.count(end) or text.count(begin) > 1:
    raise SystemExit('World route marker is duplicated or incomplete.')
if begin in text:
    pattern = r'^[ \t]*' + re.escape(begin) + r'\n.*?^[ \t]*' + re.escape(end) + r'\n?'
    text, count = re.subn(pattern, '', text, flags=re.M | re.S)
    if count != 1:
        raise SystemExit('World route marker is malformed.')
if '/api/world' in text:
    raise SystemExit('An unmanaged world API route exists; nothing overwritten.')
if len(re.findall(r'^\s*server\s*\{', text, re.M)) != 1:
    raise SystemExit('Expected exactly one managed HTTPS server block.')
names = re.findall(r'^\s*server_name\s+([^;]+);', text, re.M)
if names != [ip]:
    raise SystemExit('Managed server_name changed; inspect before deployment.')
# Scan braces while respecting quoted strings and comments, so insertion cannot escape the server.
depth = 0
quote = None
comment = False
escaped = False
closing = []
for offset, char in enumerate(text):
    if comment:
        if char == '\n': comment = False
        continue
    if escaped:
        escaped = False
        continue
    if char == '\\':
        escaped = True
        continue
    if quote:
        if char == quote: quote = None
        continue
    if char in ('"', "'"): quote = char
    elif char == '#': comment = True
    elif char == '{': depth += 1
    elif char == '}':
        depth -= 1
        if depth < 0: raise SystemExit('Invalid HTTPS brace structure.')
        if depth == 0: closing.append(offset)
if depth or quote or len(closing) != 1 or text[closing[0]+1:].strip():
    raise SystemExit('Unexpected HTTPS server structure; original configuration preserved.')
block = '''    # BEGIN ORCHARD WORLD API
    location ^~ /api/world/ {
        proxy_pass http://127.0.0.1:8766;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_connect_timeout 5s;
        proxy_read_timeout 15s;
        client_max_body_size 8k;
    }
    # END ORCHARD WORLD API
'''
at = closing[0]
prepared = text[:at] + block + text[at:]
pathlib.Path(output).write_text(prepared, encoding='utf-8', newline='')
PY

changed=1
ln -s "$release" "$ops/.publish-$$"
mv -Tf "$ops/.publish-$$" "$ops/current"
install -m 644 "$backup/new-service" "$unit"
install -m 644 "$backup/new-https.conf" "$tls"
systemctl daemon-reload
systemctl enable orchard-world.service
systemctl restart orchard-world.service

wait_health() {
  local url=$1 output=$2 attempt
  shift 2
  for attempt in {1..15}; do
    if curl --noproxy '*' --fail --silent --show-error --connect-timeout 3 --max-time 5 \
      --header 'Connection: close' "$@" "$url" -o "$output" \
      --write-out '%{http_code}' > "$output.status" 2> "$output.error"; then
      if [[ $(cat "$output.status") == 200 ]] && python3 - "$output" <<'PY'
import json, pathlib, re, sys
response = json.loads(pathlib.Path(sys.argv[1]).read_text())
assert response.get('ok') is True and response.get('version') == 'orchard-world-1' and response.get('storage') == 'sqlite', 'Unexpected health response'
epoch = response.get('dataEpoch')
assert epoch == 'initial' or isinstance(epoch, str) and re.fullmatch(r'reset-[0-9a-f]{32}', epoch), 'Unexpected player data epoch'
PY
      then return 0; fi
    fi
    [[ $attempt -eq 15 ]] || sleep 1
  done
  cat "$output.error" >&2
  return 1
}
printf '%s\n' '3/4 Checking persistent local API, then reloading Nginx.'
wait_health http://127.0.0.1:8766/api/world/health "$backup/local-health.json" || fail 'World process failed to become ready; inspect its journal.'
[[ -f $data/world.sqlite && ! -L $data/world.sqlite ]] || fail 'Persistent database was not created.'
"$nginx" -t
"$nginx" -s reload
printf '%s\n' '4/4 Waiting for the HTTPS route to serve the verified API.'
wait_health "https://$ip/api/world/health" "$backup/https-health.json" \
  --resolve "$ip:443:127.0.0.1" || fail 'Trusted HTTPS world route did not become ready.'
curl --noproxy '*' --fail --silent --show-error --connect-timeout 3 --max-time 10 \
  --resolve "$ip:443:127.0.0.1" "https://$ip/api/world/state" -o "$backup/anonymous-state.json"
python3 - "$backup/anonymous-state.json" <<'PY'
import json, pathlib, sys
body = json.loads(pathlib.Path(sys.argv[1]).read_text())
state = body.get('state', {})
assert body.get('ok') is True and state.get('self') is None
assert state.get('rules', {}).get('version') == 'orchard-world-1'
assert state.get('map', {}).get('width') == 16 and state.get('map', {}).get('height') == 16
PY
systemctl is-active --quiet orchard-world.service || fail 'World service stopped during verification.'
complete=1
printf 'WORLD_API_READY https://%s/api/world/health\nCommit: %s\nBackup: %s\nGame: https://%s/orchard/\n' "$ip" "$commit" "$backup" "$ip"
printf '%s\n' 'API installed. Verify the public HTTPS game and two-player world operations before announcing the new world online.'
