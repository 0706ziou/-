// Check the installer's sparse inputs against the real static runtime dependencies.
// Read-only: no Git checkout, network request or deployment mutation.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { collectRelease } = require('./package-site.cjs');
const source = fs.readFileSync(path.join(__dirname, 'deploy-ip-site.sh'), 'utf8');
const blocks = [...source.matchAll(/<<'SPARSE'\r?\n([\s\S]*?)^SPARSE\r?$/gm)];
assert.equal(blocks.length, 1, 'Expected the actual installer sparse-checkout block');
const patterns = blocks[0][1].trim().split(/\r?\n/);
// The installer uses positive, root-anchored paths with single-directory '*'
// globs. Refuse unsupported forms instead of guessing Git wildmatch behavior.
function matcher(pattern) {
  assert(/^\/[A-Za-z0-9_./*-]+$/.test(pattern) && !pattern.includes('**'), 'Unsupported sparse pattern: ' + pattern);
  if (pattern.endsWith('/')) return file => file.startsWith(pattern.slice(1));
  const escaped = pattern.slice(1).split('*').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*');
  const expression = new RegExp('^' + escaped + '$');
  return file => expression.test(file);
}
const files = [...collectRelease().files.keys()];
function missing(selected) {
  const matches = selected.map(matcher);
  return files.filter(file => !matches.some(match => match(file)));
}
assert.deepEqual(missing(patterns), [], 'Sparse checkout omits required runtime files');
// The API snapshot contains runtime blobs plus the explicit installer inputs.
// A broad asset glob can select a preview that is absent from that snapshot,
// making Git's lazy checkout fail even though every runtime file is present.
const checkoutInputs = new Set([...files, '.gitattributes', 'tools/package-site.cjs', 'tools/package-site-verify.cjs']);
const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: path.join(__dirname, '..'), encoding: 'utf8' }).split('\0').filter(Boolean);
function unexpected(selected) {
  const matches = selected.map(matcher);
  return tracked.filter(file => matches.some(match => match(file)) && !checkoutInputs.has(file));
}
assert.deepEqual(unexpected(patterns), [], 'Sparse checkout includes files absent from the reviewed API snapshot');
assert.deepEqual(unexpected(patterns.map(pattern => pattern === '/assets/heroes/guardian-heroes-v2.png' ? '/assets/heroes/*.png' : pattern)),
  ['assets/heroes/hero-preview.png'], 'A broad hero PNG glob must detect the unbundled preview');
const equipment = ['assets/equipment/armor.png', 'assets/equipment/charms.png', 'assets/equipment/weapons.png'];
assert.deepEqual(files.filter(file => file.startsWith('assets/equipment/')).sort(), equipment);
assert.deepEqual(missing(patterns.filter(pattern => !pattern.startsWith('/assets/equipment/'))).sort(), equipment,
  'Removing the equipment sparse entry must detect all three real missing atlases');
assert.deepEqual(missing(patterns.filter(pattern => pattern !== '/index.html')), ['index.html'],
  'Root dependency omissions must also be detected');
console.log('PASS sparse checkout covers all ' + files.length + ' runtime files; missing equipment and root dependencies are rejected.');
