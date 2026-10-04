// Build an allowlisted static release. No browser, network, credentials or server configuration.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const ROOT_FILES = new Set([
  'armory-ui.css', 'rogue-guide.css', 'index.html', 'auth-data.js', 'experience-data.js', 'progression.js', 'orchard-data.js',
  'relic-data.js', 'relic-effects.js', 'build-data.js', 'growth-data.js', 'world-data.js',
  'art-catalog.js', 'map-data.js', 'navigation.js', 'map-renderer.js', 'conversation-data.js',
  'game.js', 'training-data.js', 'frontier-ui.js', 'frontier-rewards.js', 'frontier-ui.css', 'leaderboard-ui.js', 'leaderboard-ui.css',
  'screen.css', 'expansion.css', 'run-expansion.css', 'lobby-ui.css', 'cover-ui.css'
]);
const ASSET_EXTENSION = /\.(?:png|webp|svg|jpe?g|gif|avif|ico|woff2?|ttf|ogg|mp3|wav)$/i;
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const MAX_TOTAL_BYTES = 100 * 1024 * 1024;
const MANIFEST_NAME = 'static-manifest.json';
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function allowedPath(relative) {
  if (typeof relative !== 'string' || !relative || relative.includes('\\') || relative.includes(':') ||
      relative.startsWith('/') || /[\x00-\x1f\x7f]/.test(relative) ||
      relative.split('/').some(part => !part || part === '.' || part === '..' || part.startsWith('.'))) {
    throw new Error('Unsafe release path: ' + String(relative));
  }
  if (!ROOT_FILES.has(relative) && !(relative.startsWith('assets/') && ASSET_EXTENSION.test(relative))) {
    throw new Error('File is outside the static release allowlist: ' + relative);
  }
  return relative;
}
function inside(root, target) {
  const relative = path.relative(root, target);
  return relative !== '' && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
}
function safeSource(root, relative) {
  allowedPath(relative);
  let current = root;
  if (fs.lstatSync(root).isSymbolicLink()) throw new Error('Source root cannot be a symlink.');
  for (const part of relative.split('/')) {
    current = path.join(current, part);
    if (fs.lstatSync(current).isSymbolicLink()) throw new Error('Symlink excluded from release: ' + relative);
  }
  if (!inside(fs.realpathSync(root), fs.realpathSync(current))) throw new Error('Source escapes the project: ' + relative);
  const stat = fs.statSync(current);
  if (!stat.isFile() || stat.size > MAX_FILE_BYTES) throw new Error('Invalid or oversized source: ' + relative);
  return current;
}
function localReference(reference, from) {
  const raw = String(reference).trim();
  if (!raw || raw.startsWith('#') || raw.startsWith('data:')) return null;
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(raw)) throw new Error('External runtime dependency: ' + raw);
  const decoded = decodeURIComponent(raw.split(/[?#]/, 1)[0]);
  if (decoded.includes('\\') || decoded.startsWith('/') || decoded.split('/').includes('..')) {
    throw new Error('Unsafe runtime reference: ' + raw);
  }
  return allowedPath(path.posix.join(path.posix.dirname(from), decoded));
}
function attributes(tag) {
  const result = {};
  for (const match of tag.matchAll(/\b([\w-]+)\s*=\s*(["'])(.*?)\2/g)) result[match[1].toLowerCase()] = match[3];
  return result;
}
function references(text, relative) {
  const found = [];
  const add = value => { const item = localReference(value, relative); if (item) found.push(item); };
  if (relative.endsWith('.html')) {
    for (const match of text.matchAll(/<(?:script|link|img|audio|video|source)\b[^>]*>/gi)) {
      const attrs = attributes(match[0]);
      if (attrs.src) add(attrs.src);
      if (/^<link\b/i.test(match[0]) && attrs.href) add(attrs.href);
      if (attrs.poster) add(attrs.poster);
    }
  }
  if (/\.(?:css|html|svg)$/.test(relative)) {
    for (const match of text.matchAll(/url\(\s*(?:(["'])(.*?)\1|([^)]*?))\s*\)/gi)) add(match[2] ?? match[3]);
    for (const match of text.matchAll(/@import\s+(["'])(.*?)\1/gi)) add(match[2]);
  }
  if (relative.endsWith('.svg')) {
    for (const match of text.matchAll(/\b(?:href|xlink:href)\s*=\s*(["'])(.*?)\1/g)) add(match[2]);
  }
  if (relative.endsWith('.js')) {
    // Literal assets include the environment atlas. Dynamically generated chapter paths are resolved below.
    for (const match of text.matchAll(/(["'])(assets\/[^"'\r\n]+)\1/g)) {
      if (ASSET_EXTENSION.test(match[2])) add(match[2]);
    }
  }
  return found;
}
function collectRelease(root = PROJECT_ROOT) {
  root = path.resolve(root);
  const files = new Map(), pending = ['index.html'];
  function add(relative) { if (!files.has(relative) && !pending.includes(relative)) pending.push(relative); }
  while (pending.length) {
    const relative = pending.shift();
    if (files.has(relative)) continue;
    const bytes = fs.readFileSync(safeSource(root, relative));
    if (bytes.length > MAX_FILE_BYTES) throw new Error('Oversized source: ' + relative);
    files.set(relative, bytes);
    if (/\.(?:html|css|js|svg)$/.test(relative)) {
      const text = bytes.toString('utf8');
      references(text, relative).forEach(add);
      if (relative === 'art-catalog.js') {
        const context = vm.createContext({ window: {} }, { codeGeneration: { strings: false, wasm: false } });
        vm.runInContext(text, context, { timeout: 1000, filename: relative });
        const art = context.window.ORCHARD_ART;
        if (!art || !Array.isArray(art.stages) || !art.stages.length) throw new Error('Artwork catalog is unavailable.');
        [art.atlas, ...Object.values(art.heroImages || {}), ...art.stages.map(stage => stage.image)]
          .forEach(reference => add(localReference(reference, relative)));
        // sourceImage is authoring metadata; the runtime uses stage.image (WebP).
      }
    }
  }
  const totalBytes = [...files.values()].reduce((sum, bytes) => sum + bytes.length, 0);
  if (totalBytes > MAX_TOTAL_BYTES) throw new Error('Static release exceeds the 100 MiB size limit.');
  return { root, files: new Map([...files].sort(([a], [b]) => a.localeCompare(b, 'en'))), totalBytes };
}
function tar(args) {
  const result = spawnSync('tar', args, { encoding: 'utf8', timeout: 60000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error('tar failed: ' + (result.error?.message || result.stderr.trim()));
  return result.stdout;
}
function safeOutput(root, output) {
  const base = path.join(root, 'deployment-artifacts'), resolved = path.resolve(root, output);
  if (resolved !== base && !inside(base, resolved)) throw new Error('Output must stay inside deployment-artifacts/.');
  let current = root;
  for (const part of path.relative(root, resolved).split(path.sep)) {
    current = path.join(current, part);
    if (fs.existsSync(current) && (fs.lstatSync(current).isSymbolicLink() || !fs.statSync(current).isDirectory())) {
      throw new Error('Output contains a symlink or non-directory component.');
    }
  }
  fs.mkdirSync(resolved, { recursive: true });
  if (!inside(fs.realpathSync(root), fs.realpathSync(resolved))) throw new Error('Output escapes the project.');
  return resolved;
}
function packageSite({ root = PROJECT_ROOT, output = 'deployment-artifacts' } = {}) {
  const release = collectRelease(root), destination = safeOutput(release.root, output);
  const stamp = new Date().toISOString().replace(/[-:.]/g, ''), folder = fs.mkdtempSync(path.join(destination, 'orchard-site-' + stamp + '-'));
  const site = path.join(folder, 'site'); fs.mkdirSync(site);
  const entries = [];
  for (const [relative, bytes] of release.files) {
    const target = path.join(site, ...relative.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, bytes, { flag: 'wx' });
    entries.push({ path: relative, bytes: bytes.length, sha256: sha256(bytes) });
  }
  const manifest = { version: 1, generatedAt: new Date().toISOString(), fileCount: entries.length, totalBytes: release.totalBytes, files: entries };
  const manifestText = JSON.stringify(manifest, null, 2) + '\n';
  fs.writeFileSync(path.join(site, MANIFEST_NAME), manifestText, { flag: 'wx' });
  const manifestPath = path.join(folder, MANIFEST_NAME); fs.writeFileSync(manifestPath, manifestText, { flag: 'wx' });
  const archive = path.join(folder, 'orchard-site.tar.gz'), listing = path.join(folder, 'archive-files.txt');
  fs.writeFileSync(listing, [...release.files.keys(), MANIFEST_NAME].join('\n') + '\n', { flag: 'wx' });
  tar(['-czf', archive, '-C', site, '-T', listing]);
  const archived = tar(['-tzf', archive]).trim().split(/\r?\n/).sort();
  const expected = [...release.files.keys(), MANIFEST_NAME].sort();
  if (JSON.stringify(archived) !== JSON.stringify(expected)) throw new Error('Archive inventory differs from the release manifest.');
  const archiveBytes = fs.readFileSync(archive);
  return { folder, site, archive, manifest: manifestPath, fileCount: entries.length, totalBytes: release.totalBytes,
    archiveBytes: archiveBytes.length, archiveSha256: sha256(archiveBytes) };
}
function validateSite(site) {
  if (typeof site !== 'string' || !site) throw new Error('A site directory is required.');
  site = path.resolve(site);
  const rootStat = fs.lstatSync(site);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) throw new Error('Site root must be a regular directory, not a symlink.');
  const actualFiles = new Set(), actualDirectories = new Set();
  function inventory(directory, prefix = '', depth = 0) {
    if (depth > 10) throw new Error('Site directory nesting is excessive.');
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const relative = prefix + entry.name;
      if (entry.isSymbolicLink()) throw new Error('Symlink excluded from release: ' + relative);
      if (entry.isDirectory()) {
        if (!relative.startsWith('assets') || relative.split('/').some(part => part.startsWith('.'))) {
          throw new Error('Unexpected directory in static site: ' + relative);
        }
        actualDirectories.add(relative); inventory(path.join(directory, entry.name), relative + '/', depth + 1);
      } else if (entry.isFile()) {
        if (relative !== MANIFEST_NAME) allowedPath(relative);
        actualFiles.add(relative);
        if (actualFiles.size > 1000) throw new Error('Static site contains excessive files.');
      } else throw new Error('Non-regular file excluded from release: ' + relative);
    }
  }
  inventory(site);
  const manifestPath = path.join(site, MANIFEST_NAME);
  if (!actualFiles.has(MANIFEST_NAME) || fs.statSync(manifestPath).size > 1024 * 1024) throw new Error('Static manifest is missing or oversized.');
  const manifestBytes = fs.readFileSync(manifestPath);
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  if (!manifest || manifest.version !== 1 || !Array.isArray(manifest.files) || !manifest.files.length ||
      !Number.isInteger(manifest.fileCount) || manifest.fileCount !== manifest.files.length ||
      !Number.isInteger(manifest.totalBytes) || manifest.totalBytes < 0 || manifest.totalBytes > MAX_TOTAL_BYTES ||
      typeof manifest.generatedAt !== 'string' || !Number.isFinite(Date.parse(manifest.generatedAt))) {
    throw new Error('Invalid static manifest schema or version.');
  }
  const declared = new Set(), expectedDirectories = new Set(); let totalBytes = 0;
  for (const file of manifest.files) {
    if (!file || typeof file !== 'object') throw new Error('Invalid static manifest entry.');
    allowedPath(file.path);
    if (declared.has(file.path) || !Number.isInteger(file.bytes) || file.bytes < 0 || file.bytes > MAX_FILE_BYTES ||
        typeof file.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(file.sha256)) {
      throw new Error('Invalid or duplicate manifest entry: ' + file.path);
    }
    declared.add(file.path);
    const components = file.path.split('/'); components.pop();
    for (let index = 1; index <= components.length; index++) expectedDirectories.add(components.slice(0, index).join('/'));
    const bytes = fs.readFileSync(safeSource(site, file.path));
    if (bytes.length !== file.bytes || sha256(bytes) !== file.sha256) throw new Error('File hash or byte count mismatch: ' + file.path);
    totalBytes += bytes.length;
  }
  if (totalBytes !== manifest.totalBytes) throw new Error('Static manifest total byte count mismatch.');
  const expectedFiles = new Set([...declared, MANIFEST_NAME]);
  if (actualFiles.size !== expectedFiles.size || [...actualFiles].some(name => !expectedFiles.has(name)) ||
      actualDirectories.size !== expectedDirectories.size || [...actualDirectories].some(name => !expectedDirectories.has(name))) {
    throw new Error('Static site inventory contains missing or extra files/directories.');
  }
  const runtime = collectRelease(site);
  if (runtime.files.size !== declared.size || [...runtime.files.keys()].some(name => !declared.has(name))) {
    throw new Error('Manifest inventory differs from the complete runtime reference graph.');
  }
  return { valid: true, site: fs.realpathSync(site), fileCount: declared.size, totalBytes, manifestSha256: sha256(manifestBytes) };
}
if (require.main === module) {
  try {
    const args = process.argv.slice(2);
    if (args.length && (args.length !== 2 || args[0] !== '--out')) throw new Error('Usage: node tools/package-site.cjs [--out deployment-artifacts/subfolder]');
    console.log(JSON.stringify(packageSite({ output: args[1] || 'deployment-artifacts' }), null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { PROJECT_ROOT, ROOT_FILES, MANIFEST_NAME, allowedPath, safeSource, localReference, collectRelease, packageSite, validateSite, sha256, tar };
