// Verify the real archive and its runtime references; no network or browser required.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const pack = require('./package-site.cjs');
const args = process.argv.slice(2);
if (args.length) {
  try {
    if (args.length !== 2 || args[0] !== '--site' || !path.isAbsolute(args[1])) throw new Error('Usage: node tools/package-site-verify.cjs --site ABSOLUTE_PATH');
    console.log(JSON.stringify(pack.validateSite(args[1]), null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
} else {
let count = 0;
function check(name, fn) { fn(); count++; console.log('PASS ' + name); }
const source = pack.collectRelease();
check('Every loaded root file and all dynamic chapter, hero and terrain assets are selected', () => {
  for (const root of pack.ROOT_FILES) assert(source.files.has(root), root);
  const context = vm.createContext({ window: {} }, { codeGeneration: { strings: false, wasm: false } });
  vm.runInContext(source.files.get('art-catalog.js').toString(), context, { timeout: 1000 });
  const catalog = context.window.ORCHARD_ART;
  assert(catalog.stages.length > 0); assert(Object.keys(catalog.heroImages).length > 0);
  for (const file of [catalog.atlas, ...catalog.stages.map(stage => stage.image), ...Object.values(catalog.heroImages)]) assert(source.files.has(file), file);
  for (const file of ['assets/guardian-atlas.png', 'assets/environment-atlas-clean.png', 'assets/cover/orchard-cover.webp']) assert(source.files.has(file));
});
check('Unused originals, authoring previews, tools, backups and account data are excluded', () => {
  for (const name of source.files.keys()) assert(!/^(?:tools\/|github-branch-backups\/|\.git\/)|\.txt$|(?:stage-\d+|orchard-cover|hero-preview)\.png$|^assets\/maps\//.test(name), name);
  assert(!source.files.has('assets/environment-atlas.png'));
  assert(source.files.get('index.html').toString().match(/src="auth-data\.js(?:\?[^"]*)?"/));
});
check('Traversal, absolute paths, hidden files and unknown root scripts cannot enter the release', () => {
  for (const name of ['../.env', '/etc/passwd', 'C:/secret.png', 'assets/../secret.png', '.env', 'assets/.private/secret.png', 'tools/secret.js', 'private.js']) {
    assert.throws(() => pack.allowedPath(name), undefined, name);
  }
  assert.throws(() => pack.localReference('../secret.png', 'screen.css'));
  assert.throws(() => pack.localReference('https://example.com/secret.js', 'index.html'));
});
const result = pack.packageSite({ output: 'deployment-artifacts/package-verification' });
const manifest = JSON.parse(fs.readFileSync(result.manifest, 'utf8'));
check('Manifest hashes the current shipped bytes and excludes its own circular hash', () => {
  assert.equal(manifest.version, 1); assert.equal(manifest.fileCount, source.files.size);
  assert.equal(manifest.totalBytes, source.totalBytes); assert(!manifest.files.some(file => file.path === pack.MANIFEST_NAME));
  for (const file of manifest.files) {
    const original = source.files.get(file.path);
    assert.equal(file.bytes, original.length); assert.equal(file.sha256, pack.sha256(original));
    assert.equal(pack.sha256(fs.readFileSync(path.join(result.site, file.path))), file.sha256);
  }
});
const extracted = path.join(result.folder, 'extracted'); fs.mkdirSync(extracted);
pack.tar(['-xzf', result.archive, '-C', extracted]);
check('The actual tar.gz has only allowlisted payloads plus the static manifest and extracts intact', () => {
  const inventory = pack.tar(['-tzf', result.archive]).trim().split(/\r?\n/).sort();
  assert.deepEqual(inventory, [...source.files.keys(), pack.MANIFEST_NAME].sort());
  for (const file of manifest.files) {
    const bytes = fs.readFileSync(path.join(extracted, file.path));
    assert.equal(bytes.length, file.bytes); assert.equal(pack.sha256(bytes), file.sha256);
  }
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(extracted, pack.MANIFEST_NAME), 'utf8')), manifest);
});
check('All runtime references resolve within the extracted release with matching contents', () => {
  const shipped = pack.collectRelease(extracted);
  assert.deepEqual([...shipped.files.keys()], [...source.files.keys()]);
  for (const [name, bytes] of shipped.files) assert.equal(pack.sha256(bytes), pack.sha256(source.files.get(name)));
});
check('The read-only server validator accepts the real staged and extracted folders', () => {
  for (const site of [result.site, extracted]) {
    const validation = pack.validateSite(site);
    assert(validation.valid); assert.equal(validation.fileCount, source.files.size); assert.equal(validation.totalBytes, source.totalBytes);
    assert.equal(validation.manifestSha256, pack.sha256(fs.readFileSync(path.join(site, pack.MANIFEST_NAME))));
  }
});
const mutationSite = path.join(result.folder, 'mutation-site'); fs.cpSync(result.site, mutationSite, { recursive: true });
check('The server validator rejects a tampered payload even when all files are present', () => {
  const target = path.join(mutationSite, 'game.js'), original = fs.readFileSync(target);
  fs.appendFileSync(target, '\n// tampered verification fixture\n');
  assert.throws(() => pack.validateSite(mutationSite), /mismatch: game\.js/);
  fs.writeFileSync(target, original);
});
check('The server validator rejects a missing runtime reference even with a matching reduced manifest', () => {
  const relative = 'assets/stages/stage-01.webp', target = path.join(mutationSite, relative), original = fs.readFileSync(target);
  const manifestTarget = path.join(mutationSite, pack.MANIFEST_NAME), originalManifest = fs.readFileSync(manifestTarget);
  const altered = JSON.parse(originalManifest);
  altered.files = altered.files.filter(file => file.path !== relative); altered.fileCount = altered.files.length;
  altered.totalBytes = altered.files.reduce((sum, file) => sum + file.bytes, 0);
  fs.unlinkSync(target); fs.writeFileSync(manifestTarget, JSON.stringify(altered));
  assert.throws(() => pack.validateSite(mutationSite), /ENOENT|no such file/i);
  fs.writeFileSync(target, original); fs.writeFileSync(manifestTarget, originalManifest);
});
check('The server validator rejects an extra secret file not listed by the manifest', () => {
  const target = path.join(mutationSite, '.env'); fs.writeFileSync(target, 'FAKE_VERIFICATION_SECRET=fixture-only\n');
  assert.throws(() => pack.validateSite(mutationSite), /Unsafe release path/);
  fs.unlinkSync(target); assert(pack.validateSite(mutationSite).valid);
});
check('Outputs cannot overwrite project source or leave the deployment-artifacts folder', () => {
  for (const output of ['.', 'assets', 'tools', '../release']) assert.throws(() => pack.packageSite({ output }));
});
const fixtures = path.join(result.folder, 'guard-fixtures'); fs.mkdirSync(fixtures);
const linked = path.join(fixtures, 'linked');
const outside = path.join(result.folder, 'outside'); fs.mkdirSync(outside);
try {
  fs.symlinkSync(outside, linked, process.platform === 'win32' ? 'junction' : 'dir');
  check('Directory symlinks and Windows junctions are rejected as source roots', () => assert.throws(() => pack.safeSource(linked, 'index.html'), /symlink/));
} catch (error) {
  if (!['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) throw error;
  console.log('SKIP Symlink creation unavailable on this host; path and realpath guards remain verified.');
}
console.log(count + ' static release checks passed.');
console.log(JSON.stringify(result, null, 2));
}
