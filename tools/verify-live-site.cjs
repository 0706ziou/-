// Bounded read-only verification of the owner's deployed HTTPS game.
'use strict';
const fs = require('node:fs');
const https = require('node:https');
const crypto = require('node:crypto');
const path = require('node:path');
const { allowedPath } = require('./package-site.cjs');
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const MIME = { '.html': ['text/html'], '.css': ['text/css'], '.js': ['application/javascript', 'text/javascript'],
  '.json': ['application/json'], '.png': ['image/png'], '.webp': ['image/webp'], '.svg': ['image/svg+xml'] };

function get(url, maxBytes) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { headers: { 'User-Agent': 'Orchard-Deployment-Check/1', 'Cache-Control': 'no-cache' } }, response => {
      const chunks = []; let size = 0;
      if (response.statusCode !== 200) { response.resume(); reject(new Error(url.pathname + ': HTTP ' + response.statusCode)); return; }
      if (response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity') {
        response.resume(); reject(new Error(url.pathname + ': unexpected encoded response')); return;
      }
      response.on('data', chunk => {
        size += chunk.length;
        if (size > maxBytes) { request.destroy(new Error(url.pathname + ': response exceeds expected size')); return; }
        chunks.push(chunk);
      });
      response.on('error', reject);
      response.on('end', () => resolve({ bytes: Buffer.concat(chunks), headers: response.headers }));
    });
    request.setTimeout(20000, () => request.destroy(new Error(url.pathname + ': idle timeout')));
    request.on('error', reject);
  });
}
async function verify(base, manifestPath) {
  const url = new URL(base);
  if (url.protocol !== 'https:' || url.hostname !== '111.230.149.65' || url.username || url.password || url.search || url.hash ||
      url.pathname !== '/orchard/' || (url.port && url.port !== '443')) {
    throw new Error('Use the authorized game URL: https://111.230.149.65/orchard/');
  }
  const expected = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (expected.version !== 1 || !Array.isArray(expected.files) || expected.fileCount !== expected.files.length ||
      !expected.files.length || expected.files.length > 1000 || expected.totalBytes > 100 * 1024 * 1024) throw new Error('Invalid expected manifest');
  const seen = new Set(); let budget = 0;
  for (const file of expected.files) {
    allowedPath(file.path);
    if (seen.has(file.path) || !Number.isSafeInteger(file.bytes) || file.bytes < 0 || file.bytes > 50 * 1024 * 1024 ||
        !/^[a-f0-9]{64}$/.test(file.sha256)) throw new Error('Invalid expected file: ' + file.path);
    seen.add(file.path); budget += file.bytes;
  }
  if (budget !== expected.totalBytes) throw new Error('Invalid expected byte total');
  const live = await get(new URL('static-manifest.json', url), 1024 * 1024);
  const actual = JSON.parse(live.bytes.toString('utf8'));
  const signature = files => JSON.stringify(files.map(file => [file.path, file.bytes, file.sha256]).sort((a, b) => a[0].localeCompare(b[0], 'en')));
  if (actual.version !== expected.version || actual.fileCount !== expected.fileCount || actual.totalBytes !== expected.totalBytes ||
      !Array.isArray(actual.files) || signature(actual.files) !== signature(expected.files)) throw new Error('The live release does not match the expected version');
  console.log('Trusted HTTPS/IP certificate and release manifest verified; checking ' + expected.fileCount + ' files with two connections.');
  let cursor = 0, checked = 0;
  const failures = [];
  async function worker() {
    while (cursor < expected.files.length && !failures.length) {
      const file = expected.files[cursor++];
      try {
        const response = await get(new URL(file.path, url), file.bytes);
        if (response.bytes.length !== file.bytes || digest(response.bytes) !== file.sha256) throw new Error(file.path + ': hash or size mismatch');
        const mime = String(response.headers['content-type'] || '').split(';', 1)[0].trim().toLowerCase();
        if (MIME[path.extname(file.path)] && !MIME[path.extname(file.path)].includes(mime)) throw new Error(file.path + ': incorrect MIME type ' + mime);
        checked++;
      } catch (error) { failures.push(error); }
    }
  }
  await Promise.all([worker(), worker()]);
  if (failures.length) throw failures[0];
  console.log(JSON.stringify({ valid: true, url: url.href, files: checked, bytes: budget, certificateTrusted: true }, null, 2));
}
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length !== 3 || args[1] !== '--manifest') {
    console.error('Usage: node tools/verify-live-site.cjs https://111.230.149.65/orchard/ --manifest /expected/static-manifest.json');
    process.exitCode = 1;
  } else verify(args[0], args[2]).catch(error => { console.error(error.message); process.exitCode = 1; });
}
module.exports = { verify };
