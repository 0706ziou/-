// Check the installer's sparse inputs against the real static runtime dependencies.
// Read-only: no Git checkout, network request or deployment mutation.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
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
const equipment = ['assets/equipment/armor.png', 'assets/equipment/charms.png', 'assets/equipment/weapons.png'];
assert.deepEqual(files.filter(file => file.startsWith('assets/equipment/')).sort(), equipment);
assert.deepEqual(missing(patterns.filter(pattern => !pattern.startsWith('/assets/equipment/'))).sort(), equipment,
  'Removing the equipment sparse entry must detect all three real missing atlases');
assert.deepEqual(missing(patterns.filter(pattern => pattern !== '/index.html')), ['index.html'],
  'Root dependency omissions must also be detected');
console.log('PASS sparse checkout covers all ' + files.length + ' runtime files; missing equipment and root dependencies are rejected.');
