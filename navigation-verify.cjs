// Run with: node navigation-verify.cjs. Shared navigation checks independent of a browser.
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const context = vm.createContext({ window: {} });
for (const file of ['world-data.js', 'navigation.js', 'relic-data.js', 'map-data.js']) vm.runInContext(fs.readFileSync(__dirname + '/' + file, 'utf8'), context);
const world = context.window.ORCHARD_WORLD, navigation = context.window.ORCHARD_NAV;
let checks = 0;
function check(name, callback) { callback(); checks++; console.log('✓ ' + name); }
const rect = (x, y, w, h) => ({ shape: 'rect', kind: 'water', x, y, w, h });
function pursue(layout, start, target, frames = 1800, radius = 19) {
  const nav = navigation.create(layout, world), body = { ...start, r: radius }, dt = 1 / 60, speed = 240;
  assert(world.isFree(body.x, body.y, body.r, layout.obstacles, layout.width, layout.height));
  let traversed = 0;
  for (let frame = 0; frame < frames && Math.hypot(body.x - target.x, body.y - target.y) > 8; frame++) {
    nav.beginFrame(target.x, target.y, dt);
    const x = body.x, y = body.y;
    nav.moveEnemy(body, target.x, target.y, speed, dt);
    const moved = Math.hypot(body.x - x, body.y - y); traversed += moved;
    assert(moved <= speed * dt + .001, 'a detour must not add movement speed');
    assert(world.isFree(body.x, body.y, body.r, layout.obstacles, layout.width, layout.height), 'every traversed point stays outside solids');
  }
  assert(Math.hypot(body.x - target.x, body.y - target.y) <= 8, 'pursuer did not reach target: ' + JSON.stringify(body));
  return { nav, body, traversed };
}
check('straight pursuit skips grid construction and obeys the actual speed', () => {
  const result = pursue({ width: 2400, height: 1800, obstacles: [] }, { x: 250, y: 600 }, { x: 2150, y: 600 });
  assert.equal(result.nav.stats().grids, 0); assert.equal(result.nav.stats().fields, 0); assert(result.nav.stats().direct > 400);
});
const river = { width: 2400, height: 1800, obstacles: [rect(1200, 140, 380, 280), rect(1200, 1180, 380, 1240)] };
check('ordinary pursuers travel to a remote bridge and cross the river without entering water', () => {
  const result = pursue(river, { x: 450, y: 1450 }, { x: 1950, y: 1450 });
  assert(result.traversed > 2300); assert.equal(result.nav.stats().fields, 1); assert(result.nav.stats().routed > 200);
});
check('the same bridge admits both elites and the largest 44 px boss', () => {
  for (const radius of [25, 44]) pursue(river, { x: 450, y: 1450 }, { x: 1950, y: 1450 }, 1800, radius);
});
const maze = { width: 2400, height: 2000, obstacles: [rect(800, 700, 100, 1400), rect(1600, 1300, 100, 1400)] };
check('a zigzag maze follows successive openings instead of oscillating against a long wall', () => {
  const result = pursue(maze, { x: 300, y: 350 }, { x: 2200, y: 1650 }, 2400, 44);
  assert(result.traversed > 3200); assert.equal(result.nav.stats().fields, 1);
});
check('a 4 px solid wall cannot be skipped between two free grid centres', () => {
  const layout = { width: 2400, height: 1800, obstacles: [rect(1000, 900, 4, 1800)] }, nav = navigation.create(layout, world);
  assert(!nav.routeReachable(300, 900, 2100, 900, 19));
  const body = { x: 950, y: 900, r: 19 };
  for (let i = 0; i < 120; i++) { nav.beginFrame(2100, 900, 1 / 60); nav.moveEnemy(body, 2100, 900, 240, 1 / 60); }
  assert(body.x <= 979); assert(world.isFree(body.x, body.y, body.r, layout.obstacles, layout.width, layout.height));
});
check('body size changes reachability of a narrow gate', () => {
  const layout = { width: 2000, height: 1600, obstacles: [rect(1000, 370, 220, 740), rect(1000, 1220, 220, 760)] };
  const nav = navigation.create(layout, world);
  assert(nav.routeReachable(400, 800, 1600, 800, 19));
  assert(!nav.routeReachable(400, 800, 1600, 800, 60));
});
check('240 simultaneous pursuers share just three radius groups and three goal fields', () => {
  const layout = { width: 6788, height: 4808, obstacles: [rect(3394, 1100, 400, 2200), rect(3394, 3650, 400, 2316)] };
  const nav = navigation.create(layout, world), bodies = Array.from({ length: 240 }, (_, i) =>
    ({ x: 1100 + i % 12 * 20, y: 3300 + Math.floor(i / 12) * 20, r: [15, 19, 25, 32, 44][i % 5] }));
  for (let f = 0; f < 8; f++) {
    nav.beginFrame(5650, 3700, 1 / 60);
    for (const body of bodies) nav.moveEnemy(body, 5650, 3700, 140, 1 / 60);
  }
  assert.equal(nav.stats().grids, 3); assert.equal(nav.stats().fields, 3);
  assert(nav.stats().cells < 5300); assert(nav.stats().routed > 1000);
});
check('moving a goal repeatedly inside one cell reuses all distance calculations', () => {
  const nav = navigation.create(river, world), body = { x: 450, y: 1450, r: 19 };
  for (let f = 0; f < 120; f++) { nav.beginFrame(1940 + f % 15, 1450, 1 / 60); nav.steer(body, 1940 + f % 15, 1450); }
  assert.equal(nav.stats().fields, 1);
});
check('goal changes are throttled by simulated frame time; a paused frame adds no time', () => {
  const nav = navigation.create(river, world), body = { x: 450, y: 1450, r: 19 };
  nav.beginFrame(1900, 1450, .01); nav.steer(body, 1900, 1450);
  const initial = nav.stats();
  for (let i = 0; i < 100; i++) { nav.beginFrame(2150, 1650, 0); nav.steer(body, 2150, 1650); }
  assert.equal(nav.stats().fields, initial.fields); assert.equal(nav.stats().elapsed, initial.elapsed);
  nav.beginFrame(2150, 1650, .3); nav.steer(body, 2150, 1650);
  assert.equal(nav.stats().fields, initial.fields + 1);
});
check('a target beside a solid stays approachable without letting a boss clip through it', () => {
  const target = { x: 990, y: 1450 }, layout = { width: 2400, height: 1800, obstacles: [rect(1200, 900, 380, 1800)] };
  const nav = navigation.create(layout, world), body = { x: 250, y: 300, r: 44 };
  for (let f = 0; f < 900; f++) {
    nav.beginFrame(target.x, target.y, 1 / 60); nav.moveEnemy(body, target.x, target.y, 240, 1 / 60);
    assert(world.isFree(body.x, body.y, body.r, layout.obstacles, layout.width, layout.height));
  }
  assert(Math.hypot(body.x - target.x, body.y - target.y) <= body.r + 17, 'boss must reach contact range');
});
check('zero speed and paused movement do not create a navigation field or change a body', () => {
  const nav = navigation.create(river, world), body = { x: 450, y: 1450, r: 44 };
  for (let i = 0; i < 100; i++) { nav.moveEnemy(body, 1950, 1450, 0, 1 / 60); nav.moveEnemy(body, 1950, 1450, 240, 0); }
  assert.deepEqual(body, { x: 450, y: 1450, r: 44 }); assert.equal(nav.stats().grids, 0);
});
check('long-ray spatial filtering exactly matches collision rays, including bucket boundaries and tangency', () => {
  const layout = context.window.ORCHARD_MAPS.build(5, 6788, 4808, context.window.ORCHARD_RELIC_POINTS);
  const nav = navigation.create(layout, world);
  let seed = 213984;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  for (let i = 0; i < 600; i++) {
    const start = { x: (1 + Math.floor(random() * 28)) * 240, y: (1 + Math.floor(random() * 19)) * 240, r: 19 };
    const target = { x: (1 + Math.floor(random() * 28)) * 240, y: (1 + Math.floor(random() * 19)) * 240 };
    if (start.x === target.x && start.y === target.y) continue;
    assert.equal(nav.steer(start, target.x, target.y).direct,
      !world.blocksSegment(start.x, start.y, target.x, target.y, layout.obstacles, 19.5));
  }
  const obstacle = { shape: 'circle', kind: 'rock', x: 1000, y: 600, r: 120 };
  const tangentNav = navigation.create({ width: 2400, height: 1800, obstacles: [obstacle] }, world);
  assert.equal(tangentNav.steer({ x: 240, y: 460.5, r: 19 }, 2160, 460.5).direct, false);
});
check('all 20 actual chapters provide boss-safe pursuit from all six relics to the spawn', () => {
  for (let id = 1; id <= 20; id++) {
    const layout = context.window.ORCHARD_MAPS.build(id, 6788, 4808, context.window.ORCHARD_RELIC_POINTS);
    const nav = navigation.create(layout, world);
    for (const relic of layout.relics) assert(nav.routeReachable(relic.x, relic.y, layout.spawn.x, layout.spawn.y, 44),
      'chapter ' + id + ' isolates relic ' + relic.id);
  }
});
check('real creek, hedge maze, thorn ring, rift and fortress maps let a boss pursue across the map', () => {
  for (const id of [5, 9, 13, 17, 18]) {
    const layout = context.window.ORCHARD_MAPS.build(id, 6788, 4808, context.window.ORCHARD_RELIC_POINTS);
    const result = pursue(layout, layout.relics[3], layout.relics[5], 3000, 44);
    assert(result.nav.stats().fields <= 1, 'fixed player position should reuse its flow field');
  }
});
check('actual maze performance uses one cached flow field per body size for 240 and 400 pursuers', () => {
  const layout = context.window.ORCHARD_MAPS.build(9, 6788, 4808, context.window.ORCHARD_RELIC_POINTS);
  const start = layout.relics[3], target = layout.relics[5];
  for (const enemyCount of [240, 400]) {
    const nav = navigation.create(layout, world), bodies = Array.from({ length: enemyCount }, (_, i) =>
      ({ x: start.x + i % 20 * 4 - 38, y: start.y + Math.floor(i / 20) * 4 - 38, r: [19, 25, 44][i % 3] }));
    let began = performance.now();
    nav.beginFrame(target.x, target.y, 1 / 60);
    for (const body of bodies) nav.moveEnemy(body, target.x, target.y, 140, 1 / 60);
    const coldMs = performance.now() - began;
    began = performance.now();
    for (let f = 0; f < 90; f++) {
      nav.beginFrame(target.x, target.y, 1 / 60);
      for (const body of bodies) nav.moveEnemy(body, target.x, target.y, 140, 1 / 60);
    }
    const warmMs = (performance.now() - began) / 90;
    assert.equal(nav.stats().grids, 3); assert.equal(nav.stats().fields, 3); assert(nav.stats().cached > enemyCount * 50);
    console.log('  ' + enemyCount + ' enemies: cold ' + coldMs.toFixed(1) + ' ms, warm ' + warmMs.toFixed(2) + ' ms/frame; ' + layout.obstacles.length + ' solids.');
  }
});
check('400 awakened pursuers in the actual 640–800 px spawn ring retain collision and cached navigation', () => {
  const layout = context.window.ORCHARD_MAPS.build(18, 6788, 4808, context.window.ORCHARD_RELIC_POINTS), nav = navigation.create(layout, world);
  const target = layout.spawn, bodies = [];
  for (let i = 0; i < 400; i++) {
    const radius = [19, 25, 44][i % 3], distance = 640 + i * 17 % 160;
    for (let attempt = 0; attempt < 100; attempt++) {
      const angle = i / 400 * Math.PI * 2 + attempt * .29;
      const x = target.x + Math.cos(angle) * distance, y = target.y + Math.sin(angle) * distance;
      if (world.isFree(x, y, radius, layout.obstacles, layout.width, layout.height)) { bodies.push({ x, y, r: radius }); break; }
    }
  }
  assert.equal(bodies.length, 400);
  nav.beginFrame(target.x, target.y, 1 / 60);
  for (const body of bodies) nav.moveEnemy(body, target.x, target.y, 140, 1 / 60);
  const began = performance.now();
  for (let f = 0; f < 90; f++) {
    nav.beginFrame(target.x, target.y, 1 / 60);
    for (const body of bodies) nav.moveEnemy(body, target.x, target.y, 140, 1 / 60);
  }
  const warmMs = (performance.now() - began) / 90;
  assert(nav.stats().grids <= 3); assert(nav.stats().fields <= 3); assert(nav.stats().cached > 15000);
  for (const body of bodies) assert(world.isFree(body.x, body.y, body.r, layout.obstacles, layout.width, layout.height));
  console.log('  400 awakened enemies within 800 px: warm ' + warmMs.toFixed(2) + ' ms/frame; ' + layout.obstacles.length + ' solids.');
});
console.log('Passed ' + checks + ' navigation checks.');
