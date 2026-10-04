// Run with: node world-verify.cjs. Collision and deterministic layout checks without a browser.
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const context = vm.createContext({ window: {} });
for (const name of ['relic-data.js', 'world-data.js']) vm.runInContext(fs.readFileSync(__dirname + '/' + name, 'utf8'), context);
const world = context.window.ORCHARD_WORLD, width = 6788, height = 4808;
const relics = context.window.ORCHARD_RELIC_POINTS, obstacles = world.build(width, height, relics);
let checks = 0;
function check(name, callback) { callback(); checks++; console.log('✓ ' + name); }
check('96 deterministic, immutable obstacles with four render kinds', () => {
  assert.equal(obstacles.length, 96); assert.equal(JSON.stringify(obstacles), JSON.stringify(world.build(width, height, relics)));
  assert.equal(new Set(obstacles.map(o => o.kind)).size, 4); assert(Object.isFrozen(obstacles));
  assert(obstacles.every(Object.isFrozen));
});
check('start and every relic keep their full safe areas', () => {
  assert(world.isFree(width / 2, height / 2, 240, obstacles, width, height));
  for (const relic of relics) assert(world.isFree(relic.x * width, relic.y * height, 140, obstacles, width, height));
});
check('four main roads are unobstructed for the largest boss', () => {
  for (const ratio of [.25, .76]) for (let y = 44; y <= height - 44; y += 35) assert(world.isFree(width * ratio, y, 44, obstacles, width, height));
  for (const ratio of [.25, .75]) for (let x = 44; x <= width - 44; x += 35) assert(world.isFree(x, height * ratio, 44, obstacles, width, height));
});
check('all solids are separated by passages wider than any enemy', () => {
  const extent = o => o.shape === 'circle' ? o.r : Math.hypot(o.w, o.h) / 2;
  for (let i = 0; i < obstacles.length; i++) for (let j = i + 1; j < obstacles.length; j++) {
    assert(Math.hypot(obstacles[i].x - obstacles[j].x, obstacles[i].y - obstacles[j].y) >= extent(obstacles[i]) + extent(obstacles[j]) + 180);
  }
});
const wall = [{ shape: 'rect', kind: 'hedge', x: 400, y: 300, w: 34, h: 210 }];
const stone = [{ shape: 'circle', kind: 'rock', x: 400, y: 300, r: 40 }];
check('walking and a long 280 px dash cannot pass through a thin hedge', () => {
  for (const distance of [280, 1000]) {
    const body = { x: 250, y: 300, r: 17 }; const result = world.move(body, distance, 0, wall, 960, 680);
    assert(result.blocked); assert(body.x <= 366); assert(world.isFree(body.x, body.y, body.r, wall, 960, 680));
  }
});
check('movement slides along a wall while maintaining a collision-free circle', () => {
  const body = { x: 360, y: 240, r: 17 }; world.move(body, 100, 85, wall, 960, 680);
  assert(body.y > 300); assert(body.x <= 366); assert(world.isFree(body.x, body.y, body.r, wall, 960, 680));
});
check('diagonal movement cannot clip an expanded rectangle corner', () => {
  const body = { x: 340, y: 150, r: 25 }; world.move(body, 150, 180, wall, 960, 680);
  assert(world.isFree(body.x, body.y, body.r, wall, 960, 680));
});
check('circular rocks block movement and high-speed dashes', () => {
  const body = { x: 240, y: 300, r: 19 }; const result = world.move(body, 350, 0, stone, 960, 680);
  assert(result.blocked); assert(body.x <= 341); assert(world.isFree(body.x, body.y, body.r, stone, 960, 680));
});
check('world edge stops motion using the actual body radius', () => {
  const body = { x: 50, y: 50, r: 44 }; world.move(body, -900, -900, [], 960, 680);
  assert(body.x >= 44 && body.y >= 44); assert(world.isFree(body.x, body.y, body.r, [], 960, 680));
});
check('safePoint repairs spawns inside each obstacle and near the world edge', () => {
  for (const obstacle of obstacles) for (const r of [15, 25, 44]) {
    const point = world.safePoint(obstacle.x, obstacle.y, r, obstacles, width, height);
    assert(point.free); assert(world.isFree(point.x, point.y, r, obstacles, width, height));
  }
  const point = world.safePoint(-500, height + 500, 44, obstacles, width, height);
  assert(point.free); assert(world.isFree(point.x, point.y, 44, obstacles, width, height));
});
check('enemy steering gets around a hedge and rock without crossing their solids', () => {
  for (const solids of [wall, stone]) {
    const body = { x: 220, y: 300, r: 19 }, target = { x: 600, y: 300 };
    for (let frame = 0; frame < 650; frame++) {
      const dx = target.x - body.x, dy = target.y - body.y, d = Math.hypot(dx, dy);
      if (d < 6) break;
      const beforeX = body.x, beforeY = body.y;
      world.moveEnemy(body, dx / d * 3, dy / d * 3, solids, 960, 680);
      assert(world.isFree(body.x, body.y, body.r, solids, 960, 680));
      assert(Math.hypot(body.x - beforeX, body.y - beforeY) <= 3.001);
    }
    assert(Math.hypot(target.x - body.x, target.y - body.y) < 6, 'enemy should reach the player after detouring');
  }
});
check('projectile segments hit both shapes including tangent and inside starts', () => {
  assert(world.blocksSegment(100, 300, 600, 300, wall)); assert(!world.blocksSegment(100, 180, 600, 180, wall));
  assert(world.blocksSegment(400, 300, 600, 300, wall)); assert(world.blocksSegment(400, 200, 400, 500, wall));
  assert(world.blocksSegment(100, 300, 600, 300, stone)); assert(world.blocksSegment(100, 260, 600, 260, stone));
  assert(!world.blocksSegment(100, 250, 600, 250, stone)); assert(world.blocksSegment(100, 250, 600, 250, stone, 10));
  assert(!world.blocksSegment(100, 100, 100, 100, stone)); assert(world.blocksSegment(400, 300, 400, 300, stone));
});
check('large boss spawns and routes are collision-free across the full map', () => {
  const body = world.safePoint(width * .07, height * .06, 44, obstacles, width, height); body.r = 44;
  const target = world.safePoint(width * .89, height * .91, 44, obstacles, width, height);
  for (let frame = 0; frame < 3500; frame++) {
    const dx = target.x - body.x, dy = target.y - body.y, d = Math.hypot(dx, dy);
    if (d < 15) break;
    world.moveEnemy(body, dx / d * 9, dy / d * 9, obstacles, width, height);
    assert(world.isFree(body.x, body.y, body.r, obstacles, width, height));
  }
  assert(Math.hypot(target.x - body.x, target.y - body.y) < 15);
});
check('40 cross-map paths detour around solids without cancelling or accelerating movement', () => {
  for (let route = 0; route < 40; route++) {
    const r = [15, 25, 44][route % 3];
    const body = world.safePoint(100 + (route * 317) % 6400, 100 + (route * 563) % 4500, r, obstacles, width, height); body.r = r;
    const target = world.safePoint(100 + (route * 977 + 2500) % 6400, 100 + (route * 811 + 1700) % 4500, r, obstacles, width, height);
    for (let frame = 0; frame < 2200; frame++) {
      const dx = target.x - body.x, dy = target.y - body.y, distance = Math.hypot(dx, dy);
      if (distance < 10) break;
      const previousX = body.x, previousY = body.y;
      world.moveEnemy(body, dx / distance * 6, dy / distance * 6, obstacles, width, height);
      assert(world.isFree(body.x, body.y, r, obstacles, width, height));
      assert(Math.hypot(body.x - previousX, body.y - previousY) <= 6.001);
    }
    assert(Math.hypot(target.x - body.x, target.y - body.y) < 10, 'route ' + route + ' must reach its destination');
  }
});
console.log('\n' + checks + ' world geometry checks passed.');
