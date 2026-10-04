#!/usr/bin/env bash
# Managed by Orchard Guardians. Target: the owner's OpenCloudOS server.
# Usage: bash tools/deploy-ip-site.sh <reviewed Git commit SHA>
set -Eeuo pipefail
umask 022

ip=111.230.149.65
repo=https://github.com/0706ziou/-.git
commit=${1:-}
nginx=/usr/sbin/nginx
http_conf=/etc/nginx/conf.d/youxi1.conf
tls_conf=/etc/nginx/conf.d/orchard-guardians-https.conf
base=/var/www/orchard-guardians
ops=/opt/orchard-site
acme=/var/www/orchard-acme
venv=/opt/orchard-certbot
cert_config=/etc/orchard-letsencrypt
cert_work=/var/lib/orchard-letsencrypt
cert_logs=/var/log/orchard-letsencrypt
service=/etc/systemd/system/orchard-certbot-renew.service
timer=/etc/systemd/system/orchard-certbot-renew.timer
marker='# Managed by Orchard Guardians'
backup=
task_source=
incoming=
changed=0
completed=0
old_link=

fail() { printf '%s\n' "ERROR: $*" >&2; exit 1; }
# Reload sends a signal; old workers may still answer the first request.
# Use fresh, bounded GETs and verify bytes instead of assuming reload is ready.
wait_for_served_file() {
  local url=$1 resolve=$2 expected=$3 output=$4 attempt
  for attempt in {1..15}; do
    if curl --noproxy '*' --fail --silent --show-error --connect-timeout 3 --max-time 5 \
      --header 'Connection: close' --resolve "$resolve" "$url" -o "$output" \
      --write-out '%{http_code}' > "$output.status" 2> "$output.error"; then
      if [[ $(cat "$output.status") == 200 ]] && cmp -s "$expected" "$output"; then return 0; fi
    fi
    if [[ $attempt -lt 15 ]]; then sleep 1; fi
  done
  printf 'Route readiness failed after 15 attempts: %s (HTTP %s)\n' "$url" "$(cat "$output.status")" >&2
  cat "$output.error" >&2
  return 1
}
[[ $EUID -eq 0 ]] || fail 'Run in the root Tencent Cloud terminal.'
[[ $commit =~ ^[0-9a-f]{40}$ ]] || fail 'Supply a full, reviewed 40-character Git commit SHA.'
for binary in python3 node git curl openssl systemctl ss flock tar; do
  command -v "$binary" >/dev/null || fail "Required command is missing: $binary"
done
[[ -x $nginx && -f $http_conf && ! -L $http_conf ]] || fail 'The expected system Nginx site was not found.'
"$nginx" -t

# Never take over a directory, SSL listener, or timer owned by another app.
for directory in "$ops" "$base" "$venv" "$acme" "$cert_config" "$cert_work" "$cert_logs"; do
  [[ ! -L $directory ]] || fail "Unexpected directory symlink: $directory"
  [[ ! -e $directory || -f $directory/.orchard-managed ]] || fail "Unmanaged directory exists: $directory"
done
for file in "$tls_conf" "$service" "$timer" "$ops/reload-nginx.sh" "$ops/renew-certificate.sh"; do
  [[ ! -L $file ]] || fail "Unexpected configuration symlink: $file"
  [[ ! -e $file ]] || grep -qF "$marker" "$file" || fail "Unmanaged configuration exists: $file"
done
if [[ ! -e $tls_conf ]] && [[ -n $(ss -Hln 'sport = :443') ]]; then
  fail 'Port 443 is already in use; inspect that site before deploying.'
fi
for directory in "$ops" "$base" "$venv" "$acme" "$cert_config" "$cert_work" "$cert_logs"; do
  install -d -m 755 "$directory"
  touch "$directory/.orchard-managed"
done
install -d -m 700 "$cert_config" "$cert_work" "$cert_logs"
exec 9>"$ops/deploy.lock"
flock -n 9 || fail 'Another orchard deployment or renewal is running; retry after it finishes.'
[[ ! -L $base/releases && ( ! -e $base/releases || -d $base/releases ) ]] || fail 'Unexpected managed releases path.'
if [[ -e $base/orchard && ! -L $base/orchard ]]; then
  fail 'The orchard URL is already owned by an ordinary file or directory.'
fi
if [[ -L $base/orchard ]]; then
  old_link=$(readlink "$base/orchard")
  resolved_old=$(readlink -f "$base/orchard")
  [[ $resolved_old == "$base/releases/"* && -d $resolved_old ]] || fail 'The current orchard symlink points outside managed releases.'
fi
install -d -m 700 "$ops/backups"
backup=$(mktemp -d "$ops/backups/deploy-XXXXXXXX")
cp -p "$http_conf" "$backup/http.conf"
for pair in "tls:$tls_conf" "service:$service" "timer:$timer" "reload:$ops/reload-nginx.sh" "renew:$ops/renew-certificate.sh"; do
  name=${pair%%:*}; file=${pair#*:}
  [[ ! -e $file ]] || cp -p "$file" "$backup/$name"
done
if systemctl is-enabled --quiet orchard-certbot-renew.timer 2>/dev/null; then touch "$backup/timer-enabled"; fi
if systemctl is-active --quiet orchard-certbot-renew.timer 2>/dev/null; then touch "$backup/timer-active"; fi

finish() {
  code=$?
  trap - EXIT
  if [[ $completed -eq 0 && $changed -eq 1 ]]; then
    printf '%s\n' 'Deployment failed; restoring the previous Nginx configuration and game release.' >&2
    cp -p "$backup/http.conf" "$http_conf"
    for pair in "tls:$tls_conf" "service:$service" "timer:$timer" "reload:$ops/reload-nginx.sh" "renew:$ops/renew-certificate.sh"; do
      name=${pair%%:*}; file=${pair#*:}
      if [[ -f $backup/$name ]]; then cp -p "$backup/$name" "$file"; else rm -f -- "$file"; fi
    done
    if [[ -n $old_link ]]; then
      ln -s "$old_link" "$base/.orchard-restore-$$"
      mv -Tf "$base/.orchard-restore-$$" "$base/orchard"
    else rm -f -- "$base/orchard"; fi
    systemctl daemon-reload || true
    if [[ -f $backup/timer-enabled ]]; then systemctl enable orchard-certbot-renew.timer || true;
    else systemctl disable orchard-certbot-renew.timer 2>/dev/null || true; fi
    if [[ -f $backup/timer-active ]]; then systemctl start orchard-certbot-renew.timer || true;
    else systemctl stop orchard-certbot-renew.timer 2>/dev/null || true; fi
    "$nginx" -t && "$nginx" -s reload || true
    printf 'Backup retained at: %s\n' "$backup" >&2
  fi
  if [[ -n $task_source && -d $task_source && $(readlink -f "$task_source") == "$ops/source-"* ]]; then
    rm -rf -- "$task_source"
  fi
  if [[ -n $incoming && -d $incoming && $(readlink -f "$incoming") == "$base/releases/.incoming-"* ]]; then
    rm -rf -- "$incoming"
  fi
  exit "$code"
}
trap finish EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# Check loaded configuration too: an existing 443 site may currently be stopped.
"$nginx" -T > "$backup/nginx-current.txt" 2>&1
python3 - "$backup/nginx-current.txt" "$tls_conf" <<'PY'
import pathlib, re, sys
section = ''
active = []
for line in pathlib.Path(sys.argv[1]).read_text().splitlines():
    match = re.match(r'# configuration file (.*):$', line)
    if match:
        section = match[1]
    if section == sys.argv[2] or line.lstrip().startswith('#'):
        continue
    active.append(line.split('#', 1)[0])
for match in re.finditer(r'\blisten\s+([^;]+);', '\n'.join(active)):
    address = match[1].split()[0]
    if address == '443' or address.endswith(':443'):
        raise SystemExit('Another HTTPS site is configured; inspect it before deploying.')
PY

selinux=0
if command -v getenforce >/dev/null && [[ $(getenforce) != Disabled ]]; then
  selinux=1
  for binary in restorecon semanage; do
    command -v "$binary" >/dev/null || fail 'SELinux needs policycoreutils-python-utils; install that package and retry.'
  done
  semanage fcontext -a -t cert_t "$cert_config(/.*)?" 2>/dev/null || semanage fcontext -m -t cert_t "$cert_config(/.*)?"
fi

release="$base/releases/$commit"
if [[ $commit == 036e28a9c0d61b2218e168a7c18ba4c9713a34a9 && -d $release ]]; then
  printf '%s\n' '1/6 Verifying and reusing the already downloaded, pinned game release.'
  python3 - "$release" <<'PY'
import hashlib, json, pathlib, sys
EXPECTED_CACHE = 'f900084d2d41eda395e4619416d62c4e591086409b3f5b606f712655737bbc24'
root = pathlib.Path(sys.argv[1])
manifest_path = root / 'static-manifest.json'
if root.is_symlink() or manifest_path.is_symlink() or not manifest_path.is_file() or manifest_path.stat().st_size > 1024 * 1024:
    raise SystemExit('Cached release or manifest is invalid; nothing overwritten.')
manifest = json.loads(manifest_path.read_text())
signed = {key: manifest[key] for key in ('version', 'fileCount', 'totalBytes', 'files')}
encoded = json.dumps(signed, separators=(',', ':'), ensure_ascii=False).encode()
if hashlib.sha256(encoded).hexdigest() != EXPECTED_CACHE:
    raise SystemExit('Cached release does not match the reviewed commit; nothing overwritten.')
expected_files = {'static-manifest.json'}
expected_dirs = set()
for entry in manifest['files']:
    relative = pathlib.PurePosixPath(entry['path'])
    if relative.is_absolute() or '\\' in entry['path'] or any(part in ('.', '..') or part.startswith('.') for part in relative.parts):
        raise SystemExit('Unsafe cached release path.')
    expected_files.add(entry['path'])
    expected_dirs.update(str(parent) for parent in relative.parents if str(parent) != '.')
actual_files, actual_dirs = set(), set()
for item in root.rglob('*'):
    if item.is_symlink():
        raise SystemExit('Cached release contains a symlink.')
    name = item.relative_to(root).as_posix()
    if item.is_file(): actual_files.add(name)
    elif item.is_dir(): actual_dirs.add(name)
    else: raise SystemExit('Cached release contains a special file.')
if actual_files != expected_files or actual_dirs != expected_dirs:
    raise SystemExit('Cached release contains missing or unexpected entries.')
for entry in manifest['files']:
    file = root / entry['path']
    if not file.is_file() or file.is_symlink() or file.stat().st_size != entry['bytes']:
        raise SystemExit('Cached release file is missing or changed: ' + entry['path'])
    if hashlib.sha256(file.read_bytes()).hexdigest() != entry['sha256']:
        raise SystemExit('Cached release hash mismatch: ' + entry['path'])
print('Pinned cached release verified: all 53 runtime files are unchanged.')
PY
else
printf '%s\n' '1/6 Downloading the reviewed game version and building a static-only release.'
task_source=$(mktemp -d "$ops/source-XXXXXXXX")
GIT_TERMINAL_PROMPT=0 git -C "$task_source" init -q
git -C "$task_source" remote add origin "$repo"
GIT_TERMINAL_PROMPT=0 git -C "$task_source" fetch --depth=1 origin "$commit"
git -C "$task_source" checkout --detach -q FETCH_HEAD
[[ $(git -C "$task_source" rev-parse HEAD) == "$commit" ]] || fail 'Downloaded commit does not match.'
node "$task_source/tools/package-site.cjs" --out deployment-artifacts/server-release
# The packager prints and returns one archive plus a staged site directory.
site=$(find "$task_source/deployment-artifacts/server-release" -type d -name site -print -quit)
[[ -n $site && -f $site/static-manifest.json ]] || fail 'Static release manifest is missing.'
node "$task_source/tools/package-site-verify.cjs" --site "$site"
install -d -m 755 "$base/releases"
if [[ ! -e $release ]]; then
  incoming=$(mktemp -d "$base/releases/.incoming-$commit-XXXXXXXX")
  cp -a "$site/." "$incoming/"
  node "$task_source/tools/package-site-verify.cjs" --site "$incoming"
  find "$incoming" -type d -exec chmod 755 {} +
  find "$incoming" -type f -exec chmod 644 {} +
  mv -T "$incoming" "$release"
  incoming=
else
  [[ ! -L $release ]] || fail 'Unexpected release symlink.'
  node "$task_source/tools/package-site-verify.cjs" --site "$release"
  python3 - "$site/static-manifest.json" "$release/static-manifest.json" <<'PY'
import json, pathlib, sys
a, b = [json.loads(pathlib.Path(p).read_text()) for p in sys.argv[1:]]
if a['files'] != b['files']:
    raise SystemExit('This release already exists with different contents; no files overwritten.')
PY
fi
fi
find "$release" -type d -exec chmod 755 {} +
find "$release" -type f -exec chmod 644 {} +
if [[ $selinux -eq 1 ]]; then restorecon -RF "$base" "$acme"; fi

printf '%s\n' '2/6 Preparing an isolated Certbot 5.8 environment; the existing Certbot is retained.'
if [[ ! -x $venv/bin/python ]]; then
  if ! python3 -m venv "$venv"; then
    printf '%s\n' 'Python venv needs pip support. Install python3-pip, then rerun this command.' >&2
    exit 1
  fi
fi
if [[ ! -x $venv/bin/certbot ]] || ! "$venv/bin/certbot" --version 2>&1 | grep -q 'certbot 5.8.0'; then
  "$venv/bin/python" -m pip install --disable-pip-version-check 'certbot==5.8.0'
fi

printf '%s\n' '3/6 Adding the ACME challenge and the dedicated /orchard/ URL to the existing HTTP site.'
changed=1
python3 - "$http_conf" "$ip" "$acme" <<'PY'
import pathlib, re, sys
path, ip, acme = sys.argv[1:]
p = pathlib.Path(path)
text = p.read_text()
hostnames = [match.group(1).split() for match in re.finditer(r'^\s*server_name\s+([^;]+);', text, re.M)]
if not any(ip in names for names in hostnames):
    raise SystemExit('Expected IP hostname is absent; no configuration changed.')
begin, end = '# BEGIN ORCHARD DEPLOYMENT', '# END ORCHARD DEPLOYMENT'
if begin in text or end in text:
    if text.count(begin) != 1 or text.count(end) != 1:
        raise SystemExit('Existing managed marker is duplicated or incomplete; no configuration changed.')
    pattern = r'^[ \t]*' + re.escape(begin) + r'[ \t]*\n.*?^[ \t]*' + re.escape(end) + r'[ \t]*(?:\n|$)'
    text, count = re.subn(pattern, '', text, flags=re.M | re.S)
    if count != 1:
        raise SystemExit('Existing managed marker is malformed; no configuration changed.')
if re.search(r'location\s+[^\n{]*(?:/orchard|acme-challenge)', text):
    raise SystemExit('An unmanaged orchard or ACME route exists; inspect it first.')
matches = list(re.finditer(r'^[ \t]*location\s+/\s*\{', text, re.M))
if len(matches) != 1 or len(re.findall(r'^\s*server\s*\{', text, re.M)) != 1:
    raise SystemExit('Unexpected HTTP site layout; no configuration changed.')
insert = f'''    {begin}
    location ^~ /.well-known/acme-challenge/ {{
        root {acme};
        default_type text/plain;
        try_files $uri =404;
    }}
    location = /orchard {{ return 302 https://{ip}/orchard/; }}
    location ^~ /orchard/ {{ return 302 https://{ip}$request_uri; }}
    {end}
'''
pos = matches[0].start()
p.write_text(text[:pos] + insert + text[pos:])
PY
"$nginx" -t
install -d -m 755 "$acme/.well-known/acme-challenge"
challenge="orchard-preflight-$commit"
printf '%s' "$commit" > "$acme/.well-known/acme-challenge/$challenge"
if [[ $selinux -eq 1 ]]; then restorecon -RF "$acme"; fi
"$nginx" -s reload
wait_for_served_file "http://$ip/.well-known/acme-challenge/$challenge" "$ip:80:127.0.0.1" \
  "$acme/.well-known/acme-challenge/$challenge" "$backup/check-challenge" || fail 'The HTTP challenge route did not become ready; previous site will be restored.'
rm -f -- "$acme/.well-known/acme-challenge/$challenge"

printf '%s\n' '4/6 Requesting a trusted, short-lived IP certificate.'
certbot=("$venv/bin/certbot" --config-dir "$cert_config" --work-dir "$cert_work" --logs-dir "$cert_logs")
"${certbot[@]}" certonly --non-interactive --agree-tos --register-unsafely-without-email \
  --preferred-profile shortlived --webroot --webroot-path "$acme" --ip-address "$ip" --cert-name orchard-ip
certificate="$cert_config/live/orchard-ip/fullchain.pem"
key="$cert_config/live/orchard-ip/privkey.pem"
openssl x509 -in "$certificate" -noout -checkip "$ip"
if [[ $selinux -eq 1 ]]; then restorecon -RF "$cert_config"; fi
ln -s "$release" "$base/.orchard-publish-$$"
mv -Tf "$base/.orchard-publish-$$" "$base/orchard"
if [[ $selinux -eq 1 ]]; then restorecon "$base/orchard"; fi

printf '%s\n' '5/6 Enabling HTTPS and validating the actual served game files.'
cat > "$tls_conf" <<NGINX
$marker. Do not add another default listener on port 443.
server {
    listen 443 ssl default_server;
    listen [::]:443 ssl default_server;
    server_name $ip;
    root $base;
    index index.html;
    ssl_certificate $certificate;
    ssl_certificate_key $key;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_session_cache shared:OrchardTLS:1m;
    ssl_session_timeout 10m;
    add_header X-Content-Type-Options nosniff always;
    gzip on;
    gzip_min_length 1024;
    gzip_types application/javascript text/javascript text/css image/svg+xml application/json;
    location = / { return 302 /orchard/; }
    location = /orchard { return 302 /orchard/; }
    location ~ (^|/)\. { return 404; }
    location ~* ^/orchard/assets/.*\.(webp|png|svg)$ {
        try_files \$uri =404;
        expires 1h;
    }
    location /orchard/ {
        try_files \$uri \$uri/ =404;
        add_header Cache-Control "no-cache";
        add_header X-Content-Type-Options nosniff always;
    }
    location / { return 404; }
}
NGINX
"$nginx" -t
"$nginx" -s reload
for path in index.html auth-data.js game.js static-manifest.json; do
  wait_for_served_file "https://$ip/orchard/$path" "$ip:443:127.0.0.1" \
    "$release/$path" "$backup/check-$path" || fail "HTTPS file did not become ready: $path"
done

printf '%s\n' '6/6 Testing certificate renewal and enabling automatic twice-daily renewal checks.'
cat > "$ops/reload-nginx.sh" <<'HOOK'
#!/usr/bin/env bash
# Managed by Orchard Guardians.
set -euo pipefail
/usr/sbin/nginx -t
/usr/sbin/nginx -s reload
HOOK
chmod 755 "$ops/reload-nginx.sh"
cat > "$ops/renew-certificate.sh" <<RENEW
#!/usr/bin/env bash
$marker.
set -euo pipefail
exec 9>$ops/deploy.lock
flock -n 9 || exit 0
$venv/bin/certbot renew --quiet --config-dir $cert_config --work-dir $cert_work --logs-dir $cert_logs --deploy-hook $ops/reload-nginx.sh
RENEW
chmod 755 "$ops/renew-certificate.sh"
"${certbot[@]}" renew --dry-run --deploy-hook "$ops/reload-nginx.sh"
"$ops/reload-nginx.sh"
"$venv/bin/python" -m pip check
bash -n "$ops/renew-certificate.sh"
cat > "$service" <<SERVICE
$marker.
[Unit]
Description=Renew the Orchard Guardians IP certificate
Wants=network-online.target
After=network-online.target
[Service]
Type=oneshot
ExecStart=$ops/renew-certificate.sh
SERVICE
cat > "$timer" <<TIMER
$marker.
[Unit]
Description=Check the Orchard Guardians IP certificate twice a day
[Timer]
OnCalendar=*-*-* 00,12:00:00
RandomizedDelaySec=30m
Persistent=true
[Install]
WantedBy=timers.target
TIMER
systemctl daemon-reload
if command -v systemd-analyze >/dev/null; then systemd-analyze verify "$service" "$timer"; fi
systemctl enable --now orchard-certbot-renew.timer
systemctl is-active --quiet orchard-certbot-renew.timer
completed=1
printf '\n%s\n' "DEPLOY_OK https://$ip/orchard/" "Version: $commit" "Configuration backup: $backup"
printf '%s\n' 'Allow inbound TCP 443 in the Tencent Cloud firewall if this URL is not reachable externally.'
