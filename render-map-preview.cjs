// Produce previews from the same geometry and SVG renderer used by the in-game tactical map.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { loadMaps } = require('./map-verify.cjs');
const sharp = require('C:/Users/admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp');

function escape(value) { return String(value).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&apos;' }[c])); }

async function main() {
  const { art, relics, relicDefinitions, maps } = loadMaps();
  const sandbox = vm.createContext({ window: { ORCHARD_ART: art }, Math });
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'map-renderer.js'), 'utf8'), sandbox, { filename: 'map-renderer.js' });
  const renderer = sandbox.window.ORCHARD_MAP_RENDER;
  const destination = path.join(__dirname, 'assets', 'maps'); fs.mkdirSync(destination, { recursive: true });
  const atlasPath = path.join(__dirname, renderer.environmentAtlas);
  if (!fs.existsSync(atlasPath)) throw new Error('The real environment atlas must exist before generating map previews.');
  const atlasData = 'data:image/png;base64,' + fs.readFileSync(atlasPath).toString('base64');
  const previews = [];
  for (const chapter of art.stages) {
    const layout = maps.build(chapter.id, 6788, 4808, relics);
    let svg = renderer.svg(layout);
    let markers = '<g font-family="Microsoft YaHei,sans-serif" text-anchor="middle" font-weight="700">';
    layout.relics.forEach((relic, index) => {
      // The six positions are independent of the 50-effect catalog; preview uses six representative colors.
      const definition = relicDefinitions[index];
      markers += '<circle cx="' + relic.x + '" cy="' + relic.y + '" r="98" fill="#182d25" stroke="' + escape(definition.color) + '" stroke-width="24"/>' +
        '<text x="' + relic.x + '" y="' + (relic.y + 35) + '" font-size="108" fill="' + escape(definition.color) + '">' + (index + 1) + '</text>';
    });
    markers += '<circle cx="' + layout.spawn.x + '" cy="' + layout.spawn.y + '" r="92" fill="#fff5c9" stroke="#243e30" stroke-width="20"/>' +
      '<text x="' + layout.spawn.x + '" y="' + (layout.spawn.y + 34) + '" font-size="88" fill="#243e30">起</text></g>';
    const lastClose = svg.lastIndexOf('</svg>'); svg = svg.slice(0, lastClose) + markers + svg.slice(lastClose);
    const filename = 'map-' + String(chapter.id).padStart(2, '0');
    // The SVG references the one shared atlas; twenty identical embedded copies would bloat the game directory.
    const relativeAtlas = path.posix.relative('assets/maps', renderer.environmentAtlas.replace(/\\/g, '/'));
    fs.writeFileSync(path.join(destination, filename + '.svg'), svg.split(renderer.environmentAtlas).join(relativeAtlas));
    // For rasterization, embed once so Sharp resolves sprites without external file access.
    svg = svg.replace('<rect ', '<defs><image id="environment-atlas" href="' + atlasData + '" width="1280" height="1280"/></defs><rect ');
    svg = svg.split('<image href="' + renderer.environmentAtlas + '" width="1280" height="1280"/>')
      .join('<use href="#environment-atlas"/>');
    const png = await sharp(Buffer.from(svg)).resize({ width: 1280 }).png().toBuffer();
    fs.writeFileSync(path.join(destination, filename + '.png'), png);
    const metadata = await sharp(png).metadata();
    previews.push({ chapter, png, width: metadata.width, height: metadata.height });
  }
  const columns = 5, tileWidth = 460, mapHeight = 326, labelHeight = 49, gap = 15, header = 135;
  const totalWidth = gap + columns * (tileWidth + gap), totalHeight = header + 4 * (mapHeight + labelHeight + gap) + 65;
  let sheet = '<svg xmlns="http://www.w3.org/2000/svg" width="' + totalWidth + '" height="' + totalHeight + '">' +
    '<rect width="100%" height="100%" fill="#13251e"/>' +
    '<text x="25" y="55" fill="#fff2bf" font-family="Microsoft YaHei,sans-serif" font-size="34" font-weight="700">果园保卫战 · 二十关真实俯视地图</text>' +
    '<text x="25" y="94" fill="#b8c6a1" font-family="Microsoft YaHei,sans-serif" font-size="21">每关 6788 × 4808 · 与游戏共用地图数据与渲染器 · 数字为六处饰品，起为出生点</text>';
  previews.forEach(({ chapter, png }, index) => {
    const x = gap + index % columns * (tileWidth + gap), y = header + Math.floor(index / columns) * (mapHeight + labelHeight + gap);
    sheet += '<rect x="' + x + '" y="' + y + '" width="' + tileWidth + '" height="' + (mapHeight + labelHeight) + '" rx="12" fill="#20392c"/>' +
      '<image x="' + x + '" y="' + y + '" width="' + tileWidth + '" height="' + mapHeight + '" href="data:image/png;base64,' + png.toString('base64') + '"/>' +
      '<text x="' + (x + 14) + '" y="' + (y + mapHeight + 31) + '" fill="' + escape(chapter.palette.accent) + '" font-family="Microsoft YaHei,sans-serif" font-size="22" font-weight="700">' +
      String(chapter.id).padStart(2, '0') + ' · ' + escape(chapter.name) + '</text>';
  });
  sheet += '<text x="25" y="' + (totalHeight - 27) + '" fill="#b8c6a1" font-family="Microsoft YaHei,sans-serif" font-size="20">河流、裂谷、篱笆与地标使用实际碰撞轮廓；木桥、门口与迷宫缺口为可通行道路。</text></svg>';
  const sheetFile = path.join(destination, '二十关真实地图总览.png');
  await sharp(Buffer.from(sheet)).png().toFile(sheetFile);
  console.log('Generated ' + previews.length + ' maps and overview: ' + sheetFile);
}

main().catch(error => { console.error(error.stack); process.exitCode = 1; });
