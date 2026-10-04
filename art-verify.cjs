/* Run with the bundled Node runtime after assets are saved. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const context = vm.createContext({ window: {} });
for (const file of ['experience-data.js', 'progression.js', 'art-catalog.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, file), 'utf8'), context, { filename: file });
const art = context.window.ORCHARD_ART;
const stages = context.window.ORCHARD_STAGES;
const seenHashes = new Set();
const themes = new Set();
let count = 0;
const check = (value, message) => { if (!value) throw new Error(message); count++; };
check(art.stages.length === 20, 'Exactly 20 stage illustrations');
check(Object.isFrozen(art) && Object.isFrozen(art.stages), 'Art catalog immutable');
for (const stage of art.stages) {
  check(stage.name === stages[stage.id - 1].name, 'Stage ' + stage.id + ' name preserved');
  check(!themes.has(stage.theme), 'Stage ' + stage.id + ' unique theme');
  themes.add(stage.theme);
  check(Object.keys(stage.palette).join(',') === 'ground,grass,road,tree,accent' && Object.values(stage.palette).every(color => /^#[0-9a-f]{6}$/i.test(color)), 'Stage ' + stage.id + ' complete palette');
  const file = path.join(__dirname, stage.sourceImage);
  check(fs.existsSync(file), 'Stage ' + stage.id + ' local file exists');
  const png = fs.readFileSync(file);
  check(png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), 'Stage ' + stage.id + ' valid PNG signature');
  const width = png.readUInt32BE(16), height = png.readUInt32BE(20);
  check(width > height && width >= 960 && height >= 540, 'Stage ' + stage.id + ' landscape resolution');
  const hash = crypto.createHash('sha256').update(png).digest('hex');
  check(!seenHashes.has(hash), 'Stage ' + stage.id + ' independent image');
  seenHashes.add(hash);
  const webp = fs.readFileSync(path.join(__dirname, stage.image));
  check(webp.toString('ascii', 0, 4) === 'RIFF' && webp.toString('ascii', 8, 12) === 'WEBP', 'Stage ' + stage.id + ' WEBP packing');
  let dimensions = null;
  for (let offset = 12; offset + 8 < webp.length;) {
    const chunk = webp.toString('ascii', offset, offset + 4);
    const size = webp.readUInt32LE(offset + 4), content = offset + 8;
    if (chunk === 'VP8X') dimensions = [1 + webp.readUIntLE(content + 4, 3), 1 + webp.readUIntLE(content + 7, 3)];
    if (chunk === 'VP8 ') dimensions = [webp.readUInt16LE(content + 6) & 0x3fff, webp.readUInt16LE(content + 8) & 0x3fff];
    if (dimensions) break;
    offset += 8 + size + (size & 1);
  }
  check(dimensions && dimensions[0] === 960 && dimensions[1] > 500 && dimensions[1] < 600, 'Stage ' + stage.id + ' WEBP 960px');
  check(webp.length < png.length * .2, 'Stage ' + stage.id + ' compact website asset');
}
check(Object.keys(art.sprites).length === 16 && Object.values(art.sprites).every((frame, index) => frame === index), '16 sprite atlas frames ordered');
check(Object.isFrozen(art.heroImages) && Object.keys(art.heroImages).length === 4, 'Four additional dedicated hero images');
for (const [id, asset] of Object.entries(art.heroImages)) {
  const svg = fs.readFileSync(path.join(__dirname, asset), 'utf8');
  check(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"') && svg.includes('viewBox="0 0 128 128"'), id + ' valid local SVG');
  check(!svg.includes('<script') && !svg.includes('href=') && svg.includes('Gradient'), id + ' independent vector artwork without remote dependencies');
  const hash = crypto.createHash('sha256').update(svg).digest('hex');
  check(!seenHashes.has(hash), id + ' distinct original drawing'); seenHashes.add(hash);
}
const css = fs.readFileSync(path.join(__dirname, 'expansion.css'), 'utf8');
check((css.match(/\{/g) || []).length === (css.match(/\}/g) || []).length, 'CSS braces balanced');
for (const cls of ['hero-layout', 'hero-grid', 'hero-card', 'hero-portrait', 'hero-detail', 'hero-tabs', 'growth-grid', 'growth-card', 'hero-actions', 'stage-art', 'stage-thumb', 'hero-skill-btn', 'hero-skill-tabs', 'hero-compact-description']) check(css.includes('.' + cls), 'Style interface .' + cls);
vm.runInContext(fs.readFileSync(path.join(__dirname,'map-renderer.js'),'utf8'),context,{filename:'map-renderer.js'});
const mapArt=context.window.ORCHARD_MAP_RENDER;
check(Object.isFrozen(mapArt)&&mapArt.environmentKeys.length===16&&new Set(mapArt.environmentKeys).size===16,'16 distinct immutable environment sprites');
const environment=fs.readFileSync(path.join(__dirname,mapArt.environmentAtlas));
check(environment.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),'Shipped environment atlas is a real PNG');
check(environment.readUInt32BE(16)>=1024&&environment.readUInt32BE(20)>=1024,'Environment atlas retains detailed sprite resolution');
check(environment[25]===6,'Environment atlas preserves an RGBA alpha channel');
check(fs.existsSync(path.join(__dirname,'assets/environment-atlas-prompt.txt'))&&fs.existsSync(path.join(__dirname,'assets/environment-atlas-clean-prompt.txt')),'Generation and edge-cleanup prompts are saved');
console.log(count + ' art checks passed; chapter illustrations and both production sprite atlases are valid.');
