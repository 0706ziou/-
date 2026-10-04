// Run with: node map-verify.cjs. Verify the playable chapter layouts, not just their pictures.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

function loadMaps() {
  const sandbox = vm.createContext({ window: {} });
  for (const name of ['art-catalog.js', 'relic-data.js', 'world-data.js', 'map-data.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, name), 'utf8'), sandbox, { filename: name });
  }
  return { art: sandbox.window.ORCHARD_ART, relics: sandbox.window.ORCHARD_RELIC_POINTS,
    relicDefinitions: sandbox.window.ORCHARD_RELICS,
    world: sandbox.window.ORCHARD_WORLD, maps: sandbox.window.ORCHARD_MAPS };
}

function assertDeepFrozen(value, label = 'layout') {
  if (!value || typeof value !== 'object') return;
  assert(Object.isFrozen(value), label + ' must be frozen');
  for (const [key, child] of Object.entries(value)) assertDeepFrozen(child, label + '.' + key);
}

function pointXY(point) { return Array.isArray(point) ? { x: point[0], y: point[1] } : point; }

function obstacleBounds(obstacle, padding = 0) {
  const xReach = obstacle.shape === 'circle' ? obstacle.r : obstacle.w / 2;
  const yReach = obstacle.shape === 'circle' ? obstacle.r : obstacle.h / 2;
  return { left: obstacle.x - xReach - padding, right: obstacle.x + xReach + padding,
    top: obstacle.y - yReach - padding, bottom: obstacle.y + yReach + padding };
}

// Broad phase makes fine-grained checks cheap while using the actual game's narrow phase.
function spatialQueries(layout, world, radius) {
  const bucketSize = 240, buckets = new Map();
  const key = (x, y) => x + ':' + y;
  for (const obstacle of layout.obstacles) {
    const b = obstacleBounds(obstacle, radius + 1);
    for (let x = Math.floor(b.left / bucketSize); x <= Math.floor(b.right / bucketSize); x++) {
      for (let y = Math.floor(b.top / bucketSize); y <= Math.floor(b.bottom / bucketSize); y++) {
        const k = key(x, y); if (!buckets.has(k)) buckets.set(k, []); buckets.get(k).push(obstacle);
      }
    }
  }
  const near = (x, y) => buckets.get(key(Math.floor(x / bucketSize), Math.floor(y / bucketSize))) || [];
  function free(x, y) { return world.isFree(x, y, radius, near(x, y), layout.width, layout.height); }
  function clear(x1, y1, x2, y2) {
    const local = new Set();
    for (let x = Math.floor(Math.min(x1, x2) / bucketSize); x <= Math.floor(Math.max(x1, x2) / bucketSize); x++) {
      for (let y = Math.floor(Math.min(y1, y2) / bucketSize); y <= Math.floor(Math.max(y1, y2) / bucketSize); y++) {
        for (const obstacle of buckets.get(key(x, y)) || []) local.add(obstacle);
      }
    }
    const solids = [...local];
    if (!world.blocksSegment(x1, y1, x2, y2, solids, radius)) return true;
    // blocksSegment expands rectangles into boxes; real circular bodies can traverse their rounded corners.
    // The exact movement primitive confirms those short links while still preventing thin-wall tunnelling.
    const body = { x: x1, y: y1, r: radius };
    world.move(body, x2 - x1, y2 - y1, solids, layout.width, layout.height);
    return Math.hypot(body.x - x2, body.y - y2) < 1e-5;
  }
  return { free, clear };
}

function connectivity(layout, world, radius, spacing = 60) {
  const query = spatialQueries(layout, world, radius), margin = radius + 1;
  const columns = Math.floor((layout.width - 2 * margin) / spacing) + 1;
  const rows = Math.floor((layout.height - 2 * margin) / spacing) + 1;
  const count = columns * rows, open = new Uint8Array(count), visited = new Uint8Array(count);
  const coordinates = index => ({ x: margin + (index % columns) * spacing,
    y: margin + Math.floor(index / columns) * spacing });
  let freeCount = 0;
  for (let index = 0; index < count; index++) {
    const point = coordinates(index); if (query.free(point.x, point.y)) { open[index] = 1; freeCount++; }
  }
  function attachment(point) {
    point = pointXY(point);
    const column = Math.round((point.x - margin) / spacing), row = Math.round((point.y - margin) / spacing);
    for (let ring = 0; ring <= 4; ring++) {
      for (let dy = -ring; dy <= ring; dy++) for (let dx = -ring; dx <= ring; dx++) {
        if (ring && Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
        const x = column + dx, y = row + dy;
        if (x < 0 || y < 0 || x >= columns || y >= rows) continue;
        const index = y * columns + x, coordinate = coordinates(index);
        if (open[index] && query.clear(point.x, point.y, coordinate.x, coordinate.y)) return index;
      }
    }
    return -1;
  }
  const origin = attachment(layout.spawn); assert(origin >= 0, 'spawn cannot attach to the navigation grid');
  const queue = new Int32Array(count); let head = 0, tail = 1; queue[0] = origin; visited[origin] = 1;
  while (head < tail) {
    const index = queue[head++], x = index % columns, y = Math.floor(index / columns), current = coordinates(index);
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const nextX = x + dx, nextY = y + dy;
      if (nextX < 0 || nextY < 0 || nextX >= columns || nextY >= rows) continue;
      const next = nextY * columns + nextX;
      if (!open[next] || visited[next]) continue;
      const destination = coordinates(next);
      // Checking the whole swept segment prevents falsely crossing a thin fence between free nodes.
      if (!query.clear(current.x, current.y, destination.x, destination.y)) continue;
      visited[next] = 1; queue[tail++] = next;
    }
  }
  const disconnected = [];
  for (let index = 0; index < count; index++) if (open[index] && !visited[index]) disconnected.push(coordinates(index));
  return { reachableCount: tail, freeCount, disconnected,
    reaches(point) { const index = attachment(point); return index >= 0 && Boolean(visited[index]); } };
}

function run() {
  const { art, relics, world, maps } = loadMaps(), width = 6788, height = 4808;
  let checks = 0; const fingerprints = new Set();
  const chapterFeatures = [
    ['gate'], ['pond'], ['moss', 'rock'], ['apiary'], ['water', 'bridge'], ['pergola', 'hedge'],
    ['cherryTree'], ['terrace'], ['hedge', 'fountain'], ['pumpkinBed'], ['windmill'], ['hive'],
    ['thorn'], ['greenhouse', 'flower'], ['lantern', 'pond'], ['redTree', 'leaves'],
    ['chasm', 'bridge'], ['pumpkinTower', 'fence'], ['fenceGate', 'fence'], ['heartTree']
  ];
  function check(name, callback) { callback(); checks++; console.log('PASS ' + name); }
  assert(maps && typeof maps.build === 'function', 'ORCHARD_MAPS.build must be shipped');
  check('All twenty illustrated chapters have a matching playable world', () => {
    assert.equal(art.stages.length, 20);
    assert.equal(relics.length, 6, 'the chapter geometry keeps six slots independently of the 50-effect catalog');
    assert.deepEqual(Array.from(relics, point => point.id), Array.from({ length: 6 }, (_, index) => 'slot-' + (index + 1)));
    for (const chapter of art.stages) {
      const layout = maps.build(chapter.id, width, height, relics);
      assert.equal(layout.id, chapter.id); assert.equal(layout.name, chapter.name); assert.equal(layout.theme, chapter.theme);
      assert.equal(layout.width, width); assert.equal(layout.height, height);
    }
  });
  for (const chapter of art.stages) {
    const layout = maps.build(chapter.id, width, height, relics), label = String(chapter.id).padStart(2, '0') + ' ' + chapter.name;
    check(label + ': deterministic, immutable, distinct geometry', () => {
      assertDeepFrozen(layout); assert.equal(JSON.stringify(layout), JSON.stringify(maps.build(chapter.id, width, height, relics)));
      assert(layout.roads.length > 0); assert(layout.landmarks.length > 0); assert(layout.obstacles.length > 0);
      const geometry = JSON.stringify({ roads: layout.roads.map(road => ({ points: road.points, width: road.width })),
        solids: layout.obstacles.map(o => ({ x: o.x, y: o.y, shape: o.shape, r: o.r, w: o.w, h: o.h })),
        areas: layout.areas.map(area => ({ kind: area.kind, points: area.points })) });
      const fingerprint = crypto.createHash('sha256').update(geometry).digest('hex');
      assert(!fingerprints.has(fingerprint), 'chapter geometry must differ, not merely its colors'); fingerprints.add(fingerprint);
      const ids = layout.obstacles.map(o => o.id); assert.equal(new Set(ids).size, ids.length);
      for (const obstacle of layout.obstacles) {
        assert(['circle', 'rect'].includes(obstacle.shape)); assert(Number.isFinite(obstacle.x) && Number.isFinite(obstacle.y));
        if (obstacle.shape === 'circle') assert(obstacle.r > 0 && Number.isFinite(obstacle.r));
        else assert(obstacle.w > 0 && obstacle.h > 0 && Number.isFinite(obstacle.w) && Number.isFinite(obstacle.h));
        const b = obstacleBounds(obstacle); assert(b.left >= 0 && b.right <= width && b.top >= 0 && b.bottom <= height,
          obstacle.id + ' footprint must stay inside the world');
      }
    });
    check(label + ': protected spawn and all six random relic placement slots', () => {
      assert(world.isFree(layout.spawn.x, layout.spawn.y, 140, layout.obstacles, width, height), 'spawn needs a safe clearing');
      assert.equal(layout.relics.length, relics.length); assert.equal(new Set(layout.relics.map(r => r.id)).size, relics.length);
      for (const relic of layout.relics) {
        assert(relics.some(point => point.id === relic.id), 'every pickup location needs a recognized geometry slot');
        assert(world.isFree(relic.x, relic.y, 100, layout.obstacles, width, height), 'relic ' + relic.id + ' needs accessible ground');
      }
    });
    check(label + ': the illustrated scene has its actual terrain and landmark anchors', () => {
      const kinds = new Set([...layout.areas, ...layout.landmarks, ...layout.obstacles].map(object => object.kind));
      for (const kind of chapterFeatures[chapter.id - 1]) assert(kinds.has(kind), 'missing pictured scene feature: ' + kind);
      if (chapter.id === 5 || chapter.id === 17) {
        assert.equal(layout.landmarks.filter(landmark => landmark.kind === 'bridge').length, 3);
        assert(layout.landmarks.filter(landmark => landmark.kind === 'bridge').every(bridge => bridge.passable && bridge.clearWidth >= 180));
      }
    });
    check(label + ': every drawn road centerline remains clear for the largest boss', () => {
      const query = spatialQueries(layout, world, 44);
      for (const road of layout.roads) {
        assert(road.width >= 180 && Number.isFinite(road.width), 'roads need useful traversal width');
        for (let index = 1; index < road.points.length; index++) {
          const a = pointXY(road.points[index - 1]), b = pointXY(road.points[index]);
          const samples = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 20);
          for (let step = 0; step <= samples; step++) {
            const t = step / Math.max(1, samples), x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t;
            assert(query.free(x, y), road.id + ' blocked at ' + x + ',' + y);
          }
        }
      }
    });
    for (const radius of [17, 44]) check(label + ': spawn, relics and all free ground connect at radius ' + radius, () => {
      const result = connectivity(layout, world, radius);
      for (const relic of layout.relics) assert(result.reaches(relic), 'unreachable relic ' + relic.id + ' at ' + relic.x + ',' + relic.y);
      assert.equal(result.disconnected.length, 0,
        result.disconnected.length + ' unreachable free nodes; first: ' + JSON.stringify(result.disconnected.slice(0, 5)));
      assert(result.reachableCount > 3000, 'the kept world size must remain broadly playable');
    });
    check(label + ': bridge centerlines are passable by the largest boss', () => {
      for (const bridge of layout.landmarks.filter(landmark => /bridge/i.test(landmark.kind))) {
        const vertical = Math.abs(Math.sin(bridge.rotation || 0)) > .7;
        const half = (vertical ? bridge.h : bridge.w) / 2;
        for (let t = -.8; t <= .8; t += .1) {
          const x = bridge.x + (vertical ? 0 : half * t), y = bridge.y + (vertical ? half * t : 0);
          assert(world.isFree(x, y, 44, layout.obstacles, width, height), 'bridge ' + bridge.id + ' blocked at ' + x + ',' + y);
        }
      }
    });
  }
  console.log('\n' + checks + ' chapter map checks passed.');
  return checks;
}

if (require.main === module) run();
module.exports = { loadMaps, pointXY, obstacleBounds, spatialQueries, connectivity, run };
