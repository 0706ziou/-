// node relic-verify.cjs: real behavior checks for the 50-item relic catalog and combat module.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const sandbox = { window: {} };
for (const file of ['relic-data.js', 'relic-effects.js']) vm.runInNewContext(fs.readFileSync(__dirname + '/' + file, 'utf8'), sandbox);
const defs = sandbox.window.ORCHARD_RELICS, points = sandbox.window.ORCHARD_RELIC_POINTS, effects = sandbox.window.ORCHARD_RELIC_EFFECTS;
let checks = 0;
function test(name, run) { run(); checks++; console.log('✓ ' + name); }
function near(a, b) { assert(Math.abs(a - b) < 1e-7, a + ' != ' + b); }
function player() { return { x: 0, y: 0, damage: 100, rate: 2, speed: 190, maxHp: 100, hp: 50, pickup: 62, critChance: 0, pierce: 0, regen: 0, regenDelay: 6, defense: 0, xpMult: 1, sinceHit: 8, facingX: 1, facingY: 0, shield: 0, skills: {}, skillTimers: {}, baseStats: Object.freeze({ damage: 100, rate: 2, speed: 190, pickup: 62 }) }; }
function battle(p, overrides = {}) {
  const enemies = Array.from({ length: 30 }, (_, i) => ({ x: 45 + i * 7, y: 0, hp: 100000, maxHp: 100000, r: 10, boss: i === 0, aggro: true }));
  const log = { hits: [], visuals: [], shots: [], heals: [] };
  const context = {
    elapsed: 20,
    targets(x, y, radius) { return enemies.filter(e => e.aggro && e.hp > 0 && Math.hypot(e.x - x, e.y - y) <= radius + e.r).sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y)); },
    hit(enemy, amount, color) { assert(Number.isFinite(amount) && amount >= 0); enemy.hp -= amount; log.hits.push({ enemy, amount, color }); },
    effect(key, values) { log.visuals.push({ key, values }); },
    heal(amount) { assert(amount > 0); p.hp = Math.min(p.maxHp, p.hp + amount); log.heals.push(amount); },
    projectile(spec) { log.shots.push(spec); },
    ...overrides
  };
  return { enemies, context, log };
}
test('50 unique immutable relics with readable real effect descriptions', () => {
  assert.equal(defs.length, 50); assert(Object.isFrozen(defs));
  for (const key of ['id', 'key', 'name', 'skillName']) assert.equal(new Set(defs.map(d => d[key])).size, 50);
  assert(defs.every(d => Object.isFrozen(d) && d.icon && d.color && d.summary && d.description && d.family));
  assert.equal(defs.filter(d => d.legacy).length, 6);
});
test('six immutable normalized slots remain separate from the 50-item catalog', () => {
  assert.equal(points.length, 6); assert(Object.isFrozen(points));
  for (let i = 0; i < 6; i++) { assert(Object.isFrozen(points[i])); assert.equal(points[i].id, 'slot-' + (i + 1)); assert.equal(points[i].x, defs[i].x); assert.equal(points[i].y, defs[i].y); }
});
test('the original six ids retain compatibility with newly balanced parameters', () => {
  assert.equal(defs[0].id, 'lightning'); near(defs[0].cooldown, 4.8); near(defs[0].power, 1.05); assert.equal(defs[0].targets, 3);
  near(defs[1].cooldown, .85); near(defs[1].power, .26); assert.equal(defs[2].distance, 270); near(defs[2].duration, .28);
  near(defs[3].slow, .35); near(defs[3].bossSlow, .15); assert.equal(defs[4].cooldown, 24); assert.equal(defs[5].targets, 2);
});
for (const def of defs.filter(d => !d.legacy)) test(def.name + ' produces a distinct active or passive result', () => {
  const p = player(), b = battle(p); assert.equal(effects.applyPickup(p, def), true);
  if (def.family === 'stats') {
    for (const [key, bonus] of Object.entries(def.bonus)) {
      if (key === 'heal') near(p.hp, 50 + bonus);
      else if (['damage', 'rate', 'speed'].includes(key)) near(p[key], p.baseStats[key] * (1 + bonus));
      else near(p[key], player()[key] + bonus);
    }
    const before = JSON.stringify(p); assert.equal(effects.applyPickup(p, def), false); assert.equal(JSON.stringify(p), before);
    return;
  }
  if (def.family === 'ward') { assert.equal(p.shield, 1); effects.consumeShield(p, [def]); assert.equal(p.shield, 0); p.skillTimers[def.key] = 0; }
  effects.tick(p, [def], .05, b.context);
  if (def.family === 'poison') { assert.equal(p.relicDots.length, def.targets); effects.tick(p, [def], .5, b.context); assert(b.log.hits.length > 0); }
  else if (def.family === 'projectile') { assert.equal(b.log.shots.length, def.count); for (const shot of b.log.shots) { near(Math.hypot(shot.vx, shot.vy), def.speed); near(shot.damage, p.damage * def.power); assert.equal(shot.pierce, def.pierce); } }
  else if (def.family === 'heal') { assert(b.log.heals.length > 0); assert(p.hp > 50 && p.hp <= p.maxHp); }
  else if (def.family === 'ward') assert.equal(p.shield, 1);
  else assert(b.log.hits.length > 0);
  assert(p.skillTimers[def.key] > 0); assert(Number.isFinite(p.skillTimers[def.key]));
});
test('legacy skills do not execute twice when the main game owns their timers', () => {
  const p = player(), b = battle(p); for (const d of defs.slice(0, 6)) effects.applyPickup(p, d);
  p.skillTimers.lightning = 1; effects.tick(p, defs.slice(0, 6), .1, b.context);
  assert.equal(b.log.hits.length, 0); near(p.skillTimers.lightning, 1);
});
test('new attack timers wait ready without a valid target and do not touch dormant enemies', () => {
  const d = defs.find(d => d.id === 'sunDisk'), p = player(), b = battle(p);
  b.enemies.forEach(e => e.aggro = false); effects.applyPickup(p, d); effects.tick(p, [d], .1, b.context);
  assert.equal(p.skillTimers[d.key], 0); assert.equal(b.log.hits.length, 0);
});
test('all cooldowns freeze during pauses, zero or invalid frame durations', () => {
  for (const duration of [0, -1, NaN]) { const p = player(), b = battle(p), d = defs[6]; p.skillTimers[d.key] = 4; effects.tick(p, [d], duration, b.context); near(p.skillTimers[d.key], 4); }
  for (const flag of [{ paused: true }, { active: false }]) { const p = player(), b = battle(p, flag), d = defs[6]; p.skillTimers[d.key] = 4; effects.tick(p, [d], .5, b.context); near(p.skillTimers[d.key], 4); assert.equal(b.log.hits.length, 0); }
});
test('chain attacks use distinct targets and their advertised hop count', () => {
  const p = player(), b = battle(p), d = defs.find(d => d.id === 'thunderFork'); effects.tick(p, [d], .01, b.context);
  assert.equal(b.log.hits.length, d.targets); assert.equal(new Set(b.log.hits.map(hit => hit.enemy)).size, d.targets);
  near(b.log.hits.reduce((sum, hit) => sum + hit.amount, 0), p.damage * d.power * d.targets);
});
test('slow effects use weaker Boss control and do not overwrite a stronger active slow', () => {
  const p = player(), b = battle(p), d = defs.find(d => d.id === 'snowRibbon');
  b.enemies[1].slowUntil = 24; b.enemies[1].slowAmount = .8; effects.tick(p, [d], .05, b.context);
  near(b.enemies[0].slowAmount, d.bossSlow); near(b.enemies[1].slowAmount, .8); near(b.enemies[1].slowUntil, 24);
});
test('execute requires actual low health and honors both damage multipliers', () => {
  const p = player(), b = battle(p), d = defs.find(d => d.id === 'harvestSickle');
  b.enemies[0].hp = b.enemies[0].maxHp * .24; effects.tick(p, [d], .01, b.context);
  near(b.log.hits[0].amount, p.damage * d.executePower); near(b.log.hits[1].amount, p.damage * d.power);
});
test('poison total matches its duration, ticks in bounded batches and never stacks itself', () => {
  const p = player(), b = battle(p), d = defs.find(d => d.id === 'acidLime'); effects.tick(p, [d], .01, b.context);
  for (let i = 0; i < 250; i++) effects.tick(p, [d], .01, b.context);
  near(b.log.hits.reduce((sum, hit) => sum + hit.amount, 0), p.damage * d.dotPower * d.duration * d.targets);
  assert.equal(b.log.hits.length, 10); assert.equal(p.relicDots.length, 0);
  p.skillTimers[d.key] = 0; effects.tick(p, [d], .01, b.context); p.skillTimers[d.key] = 0; effects.tick(p, [d], .01, b.context);
  assert.equal(p.relicDots.length, d.targets);
});
test('poison freezes while paused and expires when its enemy dies or source is removed', () => {
  const p = player(), b = battle(p), d = defs.find(d => d.id === 'venomBerry'); effects.tick(p, [d], .01, b.context);
  const remaining = p.relicDots[0].remaining; effects.tick(p, [d], .5, { ...b.context, paused: true }); near(p.relicDots[0].remaining, remaining);
  b.enemies.forEach(e => e.hp = 0); effects.tick(p, [d], .1, b.context); assert.equal(p.relicDots.length, 0);
});
test('ward items share only one charge and replenish from consumption, never stack layers', () => {
  const p = player(), b = battle(p), wards = defs.filter(d => d.family === 'ward');
  for (const d of wards) effects.applyPickup(p, d); assert.equal(p.shield, 1);
  effects.consumeShield(p, wards); assert.equal(p.shield, 0); for (const d of wards) near(p.skillTimers[d.key], d.cooldown);
  for (let i = 0; i < 23; i++) effects.tick(p, wards, 1, { ...b.context, includeLegacy: true }); assert.equal(p.shield, 0);
  effects.tick(p, wards, 1, { ...b.context, includeLegacy: true }); assert.equal(p.shield, 1);
  for (let i = 0; i < 40; i++) effects.tick(p, wards, 1, { ...b.context, includeLegacy: true }); assert.equal(p.shield, 1);
  effects.consumeShield(p, wards); for (const d of wards) near(p.skillTimers[d.key], d.cooldown);
});
test('healing is clamped and no-hit healing waits for its condition', () => {
  const d = defs.find(d => d.id === 'cloverCup'), p = player(), b = battle(p); p.hp = 99; p.sinceHit = 0;
  effects.tick(p, [d], .1, b.context); assert.equal(p.hp, 99); assert.equal(b.log.heals.length, 0);
  p.sinceHit = 6; effects.tick(p, [d], .1, b.context); assert.equal(p.hp, 100); near(b.log.heals[0], 1);
});
test('cooldown reduction stays finite with a 50% factor floor and 0.5-second floor', () => {
  const p = player(); p.relicCooldown = .01;
  near(effects.cooldown({ cooldown: 8 }, p), 4); near(effects.cooldown({ cooldown: .6 }, p), .5);
  p.relicCooldown = NaN; near(effects.cooldown({ cooldown: 8 }, p), 8);
});
test('stat additions use the immutable run base and do not multiply earlier damage upgrades', () => {
  const p = player(); p.damage = 200; p.rate = 4; p.speed = 380;
  for (const id of ['amberKernel', 'swiftSpring', 'windAnklet']) effects.applyPickup(p, defs.find(d => d.id === id));
  near(p.damage, 210); near(p.rate, 4.16); near(p.speed, 395.2); near(p.relicBonuses.damage, 10); near(p.relicBonuses.speed, 15.2);
});
test('six concurrent offensive relics do not accelerate each other or repeatedly apply passives', () => {
  const owned = defs.slice(6, 12), p = player(), b = battle(p); owned.forEach(d => effects.applyPickup(p, d));
  effects.tick(p, owned, .01, b.context); const afterFirst = b.log.hits.length;
  effects.tick(p, owned, .01, b.context); assert.equal(b.log.hits.length, afterFirst);
  for (const d of owned) assert(p.skillTimers[d.key] > 2);
});
test('projectile decorations cannot deal instant damage if the host projectile callback is absent', () => {
  const p = player(), d = defs.find(d => d.family === 'projectile'), b = battle(p, { projectile: undefined });
  effects.tick(p, [d], .05, b.context); assert.equal(b.log.hits.length, 0); assert.equal(p.skillTimers[d.key], 0);
});
test('stat relics preserve endless growth and keep their real bonus beyond stage build caps', () => {
  const crit = defs.find(d => d.id === 'starBrooch'), pierce = defs.find(d => d.id === 'arrowPod');
  const stage = player(); stage.critChance = .4; stage.pierce = 4;
  effects.applyPickup(stage, crit); effects.applyPickup(stage, pierce);
  near(stage.critChance, .45); near(stage.pierce, 4.6);
  near(stage.relicBonuses.critChance, .05); near(stage.relicBonuses.pierce, .6);
  const endless = player(); endless.build = { mode: 'endless' }; endless.critChance = .65; endless.pierce = 8;
  effects.applyPickup(endless, crit); effects.applyPickup(endless, pierce);
  near(endless.critChance, .7); near(endless.pierce, 8.6);
  near(endless.relicBonuses.critChance, .05); near(endless.relicBonuses.pierce, .6);
  const stronger = player(); stronger.build = { mode: 'endless' }; stronger.critChance = .8; stronger.pierce = 10;
  effects.applyPickup(stronger, crit); effects.applyPickup(stronger, pierce);
  near(stronger.critChance, .8); near(stronger.pierce, 10);
  near(stronger.relicBonuses.critChance, 0); near(stronger.relicBonuses.pierce, 0);
});
test('all fifty displayed effects describe the final numerical configuration', () => {
  for (const d of defs) {
    assert(!/NaN|undefined|Infinity/.test(d.summary));
    assert(d.description.startsWith(d.summary));
    const number = n => String(Math.round(n * 100) / 100);
    if (d.cooldown) assert(d.summary.includes(number(d.cooldown)), d.id + ' cooldown text');
    if (d.power) assert(d.summary.includes(number(d.power * 100) + '%'), d.id + ' damage text');
    if (d.dotPower) assert(d.summary.includes(number(d.dotPower * 100) + '%'), d.id + ' poison text');
    if (d.slow) assert(d.summary.includes(number(d.slow * 100) + '%'), d.id + ' slow text');
    if (d.bossSlow) assert(d.summary.includes(number(d.bossSlow * 100) + '%'), d.id + ' boss slow text');
  }
});
test('six healing and shielding relics cannot create stacked shields or replenish every frame', () => {
  const owned = defs.filter(d => d.family === 'heal' || d.family === 'ward').slice(0, 6), p = player(), b = battle(p);
  owned.forEach(d => effects.applyPickup(p, d)); effects.consumeShield(p, owned);
  effects.tick(p, owned, .1, { ...b.context, includeLegacy: true });
  const healed = p.hp; effects.tick(p, owned, .1, { ...b.context, includeLegacy: true });
  near(p.hp, healed); assert.equal(p.shield, 0);
  assert(owned.filter(d => d.family === 'ward').every(d => p.skillTimers[d.key] > 23));
});
console.log(checks + ' relic checks passed.');
