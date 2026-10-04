// node growth-verify.cjs: verifies data contracts, save migration and bounded growth.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const sandbox = { window: {} };
vm.runInNewContext(fs.readFileSync(__dirname + '/growth-data.js', 'utf8'), sandbox);
const g = sandbox.window.ORCHARD_GROWTH;
let checks = 0;
function test(name, fn) { fn(); checks++; console.log('✓ ' + name); }
function plain(value) { return JSON.parse(JSON.stringify(value)); }
function near(a, b) { assert(Math.abs(a - b) < 1e-9, a + ' != ' + b); }
function profile(raw = {}, clearedStages = []) { return g.migrate(raw, { clearedStages, seeds: 321, cores: 9, version: 1 }); }

test('eight unique, immutable heroes and four immutable talents', () => {
  assert.equal(g.heroes.length, 8); assert.equal(new Set(g.heroes.map(h => h.id)).size, 8);
  assert.equal(g.talents.length, 4); assert(Object.isFrozen(g.heroes)); assert(Object.isFrozen(g.talents));
  assert(g.heroes.every(h => Object.isFrozen(h) && Object.isFrozen(h.active) && Object.isFrozen(h.runModifiers)));
});
test('old save receives neutral growth fields and preserves its resource fields', () => {
  const p = profile(); assert.equal(p.selectedHero, 'orange'); assert.equal(p.seeds, 321); assert.equal(p.cores, 9);
  assert.deepEqual(plain(p.heroLevels), { orange: 0, berry: 0, pumpkin: 0, lime: 0, cherry: 0, pear: 0, blueberry: 0, pineapple: 0 });
  assert.deepEqual(plain(p.talents), { vitality: 0, damage: 0, rate: 0, insight: 0 });
});
test('migration returns the supplied profile object', () => { const p = { clearedStages: [] }; assert.equal(g.migrate(null, p), p); });
test('aliased raw/result migration preserves its earned levels', () => {
  const p = { clearedStages: [8], selectedHero: 'lime', heroLevels: { lime: 4 }, talents: { vitality: 3 } };
  g.migrate(p, p); assert.equal(p.heroLevels.lime, 4); assert.equal(p.talents.vitality, 3); assert.equal(p.selectedHero, 'lime');
});
test('unknown hero cannot be selected, including prototype names', () => {
  for (const id of ['missing', '__proto__', 'constructor', {}, null]) { assert.equal(profile({ selectedHero: id }, [20]).selectedHero, 'orange'); assert.equal(g.hero(id), null); }
});
test('every hero can be selected and trained in a fresh profile without stage clears', () => {
  for (const h of g.heroes) {
    const p = profile({ selectedHero: h.id, heroLevels: { [h.id]: 3 } });
    assert.equal(p.selectedHero, h.id); assert.equal(p.heroLevels[h.id], 3); assert.equal(g.makeRunStats(p).heroId, h.id);
    assert(g.isUnlocked(h, p)); assert(g.cost('hero', h.id, 0));
  }
});
test('all eight heroes are unlocked before entering the first stage', () => {
  assert(g.heroes.every(h => h.unlockStage === 0 && g.isUnlocked(h.id, {})));
});
test('hero lookup remains strict even though heroes are all initially unlocked', () => {
  assert(g.isUnlocked('lime', { clearedStages: [100, '8', 8.1, NaN, null] }));
  assert(!g.isUnlocked({ id: 'bogus', unlockStage: 0 }, { clearedStages: [20] }));
});
test('training levels sanitize NaN, strings, negatives, fractions and over-cap values', () => {
  const p = profile({ heroLevels: { orange: NaN, berry: '5', pumpkin: -10, lime: 99.9 } }, [20]);
  assert.deepEqual(plain(p.heroLevels), { orange: 0, berry: 0, pumpkin: 0, lime: 5, cherry: 0, pear: 0, blueberry: 0, pineapple: 0 });
  assert.equal(profile({ heroLevels: { orange: 2.9 } }).heroLevels.orange, 2);
});
test('research levels are bounded and unknown fields are discarded', () => {
  const p = profile({ talents: { vitality: 99, damage: -2, rate: Infinity, insight: '5', invented: 10 } });
  assert.deepEqual(plain(p.talents), { vitality: 8, damage: 0, rate: 0, insight: 0 });
});
test('prototype-inherited growth values are ignored', () => {
  const inherited = Object.create({ selectedHero: 'lime', heroLevels: { orange: 5 }, talents: { vitality: 8 } });
  const p = profile(inherited, [20]); assert.equal(p.selectedHero, 'orange'); assert.equal(p.heroLevels.orange, 0); assert.equal(p.talents.vitality, 0);
});
test('hero training cost is positive and increases across all five levels', () => {
  let previous = 0;
  for (let level = 0; level < 5; level++) { const c = g.cost('hero', 'orange', level); assert(c.seeds > previous); assert(c.cores > 0); previous = c.seeds; }
  assert.deepEqual(plain(g.cost('hero', 'orange', 0)), { seeds: 60, cores: 1 });
  assert.deepEqual(plain(g.cost('hero', 'orange', 4)), { seeds: 372, cores: 3 });
});
test('every permanent research cost increases and reaches a true max-level stop', () => {
  for (const item of g.talents) {
    let previous = 0;
    for (let level = 0; level < item.maxLevel; level++) { const c = g.cost('talent', item.id, level); assert(c.seeds > previous); assert(c.cores >= 1); previous = c.seeds; }
    assert.equal(g.cost('talent', item.id, item.maxLevel), null);
  }
});
test('invalid and capped purchase requests never return a charge or credit', () => {
  for (const level of [-1, .5, NaN, Infinity, '0', 5]) assert.equal(g.cost('hero', 'orange', level), null);
  assert.equal(g.cost('other', 'orange', 0), null); assert.equal(g.cost('talent', '__proto__', 0), null);
});
test('baseline orange retains neutral weapon/health/movement multipliers', () => {
  const s = g.makeRunStats(profile()); near(s.damageMult, 1); near(s.rateMult, 1); near(s.speedMult, 1);
  assert.equal(s.hp, 0); assert.equal(s.pickup, 0); assert.equal(s.standDamage, 0); near(s.skillCooldown, 1); near(s.xpMult, 1);
});
test('training cap contributes +12.5% damage, +25 health and -10% skill cooldown', () => {
  const b = g.bonuses(profile({ heroLevels: { orange: 100 } })); near(b.damage, .125); near(b.hp, 25); near(b.skillCooldown, .9);
  assert(Object.isFrozen(g.training)); near(g.training.damage, .025); near(g.training.hp, 5); near(g.training.cooldown, .02);
});
test('only the selected unlocked hero contributes training', () => {
  const p = profile({ selectedHero: 'berry', heroLevels: { orange: 5, berry: 1, pumpkin: 5, lime: 5 } }, [20]);
  near(g.bonuses(p).damage, .025); assert.equal(g.bonuses(p).hp, 5);
});
test('max permanent research stays within planned finite budgets', () => {
  const p = profile({ talents: { vitality: 999, damage: 999, rate: 999, insight: 999 } });
  const b = g.bonuses(p); assert.equal(b.hp, 32); near(b.damage, .12); near(b.rate, .06); near(b.xpMult, 1.10);
});
test('repeated stat assembly neither modifies save nor compounds permanent bonuses', () => {
  const p = profile({ heroLevels: { orange: 3 }, talents: { damage: 2, vitality: 3 } });
  const before = JSON.stringify(p), first = plain(g.makeRunStats(p));
  for (let n = 0; n < 30; n++) assert.deepEqual(plain(g.makeRunStats(p)), first);
  assert.equal(JSON.stringify(p), before);
});
test('berry gains speed and critical chance with compensated base health/damage', () => {
  const s = g.makeRunStats(profile({ selectedHero: 'berry' }, [2])); near(s.damageMult, .96); near(s.speedMult, 1.08); near(s.critChance, .06); assert.equal(s.hp, -10);
});
test('pumpkin gains health and armor with movement cost', () => {
  const s = g.makeRunStats(profile({ selectedHero: 'pumpkin' }, [5])); near(s.damageMult, 1.03); near(s.speedMult, .96); assert.equal(s.hp, 28); assert.equal(s.defense, 2);
});
test('lime has distinct support, collection and experience statistics', () => {
  const s = g.makeRunStats(profile({ selectedHero: 'lime' }, [8])); near(s.damageMult, .94); assert.equal(s.hp, 5); assert.equal(s.pickup, 18); near(s.regen, .25); near(s.xpMult, 1.06);
});
test('malformed selected-hero field cannot grant unrelated hero bonuses', () => {
  const s = g.makeRunStats({ clearedStages: [], selectedHero: '__proto__', heroLevels: { pumpkin: 5 } }); assert.equal(s.heroId, 'orange'); assert.equal(s.hp, 0); near(s.damageMult, 1);
});
test('orange active is a 280% ring with single-hit healing passive', () => {
  const s = g.active('orange', { damage: 22, skillCooldown: 1 }); assert.equal(s.kind, 'ring'); near(s.damage, 61.6); assert.equal(s.radius, 220); assert.equal(s.targets, 10); assert.equal(s.healOnHit, 5); assert.equal(s.cooldown, 16);
});
test('berry active creates seven direction-based seeds with controlled lifetime', () => {
  const s = g.active('berry', { damage: 22 }); assert.equal(s.kind, 'volley'); assert.equal(s.count, 7); near(s.damage, 17.6); near(s.life, 1.4); assert.equal(s.speed, 520); assert.equal(s.cooldown, 14);
});
test('pumpkin active explicitly limits Boss control while keeping area damage', () => {
  const s = g.active('pumpkin', { damage: 20 }); assert.equal(s.kind, 'slam'); assert.equal(s.knockback, 80); near(s.damage, 64); near(s.slow, .35); near(s.bossSlow, .15); near(s.duration, 1.8);
});
test('lime pulse heals according to max HP without over-healing', () => {
  const s = g.active('lime', { damage: 18, hp: 80, maxHp: 100 }); assert.equal(s.kind, 'healPulse'); near(s.heal, 12); near(s.damage, 21.6);
  near(g.active('lime', { hp: 99, maxHp: 100 }).heal, 1); near(g.active('lime', { hp: 110, maxHp: 100 }).heal, 0);
});
test('active specifications are pure and cannot mutate frozen hero definitions', () => {
  const p = { damage: 18, hp: 10, maxHp: 100, skillCooldown: .9 }, before = JSON.stringify(p);
  const s = g.active('orange', p); s.damage = 999; assert.equal(JSON.stringify(p), before); near(g.active('orange', p).damage, 50.4); near(g.active('orange', p).cooldown, 14.4);
  assert.equal(g.active('missing', p), null);
});
test('active spec tolerates malformed live-player values without NaN', () => {
  const s = g.active('lime', { damage: NaN, hp: Infinity, maxHp: '100', skillCooldown: NaN }); near(s.damage, 0); near(s.heal, 0); near(s.cooldown, 20);
});
test('endless cooldown growth reaches its real multiplier with a safe absolute floor', () => {
  for (const h of g.heroes) {
    near(g.active(h, { skillCooldown: .25 }).cooldown, h.cooldown * .25);
    near(g.active(h, { skillCooldown: .12 }).cooldown, h.cooldown * .12);
    near(g.active(h, { skillCooldown: -1 }).cooldown, h.cooldown * .12);
    near(g.active(h, { skillCooldown: NaN }).cooldown, h.cooldown);
    near(g.active(h, { skillCooldown: Infinity }).cooldown, h.cooldown);
  }
});
test('new heroes preserve independent passive bonuses through the run stat contract', () => {
  const cherry = g.makeRunStats(profile({ selectedHero: 'cherry' })); near(cherry.pierce, .35); near(cherry.rateMult, 1.06); assert.equal(cherry.hp, -8);
  const pear = g.makeRunStats(profile({ selectedHero: 'pear' })); near(pear.dodge, .07); near(pear.speedMult, 1.04); assert.equal(pear.hp, 8);
  const blueberry = g.makeRunStats(profile({ selectedHero: 'blueberry' })); near(blueberry.skillPower, 1.08); near(blueberry.damageMult, .98); assert.equal(blueberry.pickup, 12);
  const pineapple = g.makeRunStats(profile({ selectedHero: 'pineapple' })); near(pineapple.thorns, .12); near(pineapple.damageMult, 1.02); assert.equal(pineapple.hp, 18);
});
test('new passive fields use neutral defaults for the original roster', () => {
  for (const id of ['orange', 'berry', 'pumpkin', 'lime']) {
    const s = g.makeRunStats(profile({ selectedHero: id })); near(s.dodge, 0); near(s.thorns, 0); near(s.pierce, 0); near(s.skillPower, 1);
  }
});
test('cherry creates two rows with an even projectile split and finite lifetime', () => {
  const spec = g.active('cherry', { damage: 22 }); assert.equal(spec.kind, 'volley'); assert.equal(spec.count, 12);
  assert.equal(spec.rows, 2); assert.equal(spec.count % spec.rows, 0); assert.equal(spec.rowOffset, 10);
  near(spec.damage, 12.76); near(spec.life, 1.35); assert.equal(spec.cooldown, 16);
});
test('pear supplies a short-range ring that fits the agile role', () => {
  const spec = g.active('pear', { damage: 22 }); assert.equal(spec.kind, 'ring'); assert.equal(spec.radius, 210);
  assert.equal(spec.targets, 10); near(spec.damage, 52.8); assert.equal(spec.cooldown, 16);
});
test('blueberry chain specifies unique bounded targets, jump reach and decaying damage', () => {
  const spec = g.active('blueberry', { damage: 22 }); assert.equal(spec.kind, 'chain'); assert.equal(spec.targets, 5);
  assert.equal(spec.radius, 430); assert.equal(spec.jumpRadius, 190); near(spec.falloff, .9); near(spec.damage, 31.9);
  assert(spec.damage * Math.pow(spec.falloff, 4) > 0); assert(spec.damage * spec.falloff < spec.damage);
});
test('pineapple guard has bounded duration and no permanent defense modifier', () => {
  const spec = g.active('pineapple', { damage: 22 }); assert.equal(spec.kind, 'guardRing'); near(spec.damage, 35.2);
  assert.equal(spec.guardDefense, 3); assert.equal(spec.guardDuration, 5); assert.equal(spec.cooldown, 20);
  assert.equal(g.makeRunStats(profile({ selectedHero: 'pineapple' })).defense, 0);
});
test('new hero saves retain selected hero and training without requiring old stage thresholds', () => {
  for (const id of ['cherry', 'pear', 'blueberry', 'pineapple']) {
    const raw = { selectedHero: id, heroLevels: { [id]: 4 }, talents: { vitality: 2 } };
    const p = profile(raw); const reloaded = profile(p); assert.deepEqual(plain(reloaded), plain(p));
    assert.equal(reloaded.selectedHero, id); assert.equal(reloaded.heroLevels[id], 4);
  }
});
test('all fresh heroes stay within controlled starting damage, health and movement bands', () => {
  for (const h of g.heroes) {
    const s = g.makeRunStats(profile({ selectedHero: h.id })); const weaponDps = 22 * 3 * s.damageMult * s.rateMult;
    assert(weaponDps >= 60 && weaponDps <= 72, h.id + ': weapon DPS ' + weaponDps);
    assert(110 + s.hp >= 100 && 110 + s.hp <= 140, h.id + ': HP');
    assert(205 * s.speedMult + s.speed >= 190 && 205 * s.speedMult + s.speed <= 225, h.id + ': movement');
    assert(h.cooldown >= 14 && h.cooldown <= 20, h.id + ': cooldown');
    const spec = g.active(h, { damage: 22 * s.damageMult });
    const totalTargets = spec.kind === 'volley' ? spec.count : spec.targets;
    assert(spec.damage * totalTargets * s.skillPower / spec.cooldown <= weaponDps, h.id + ': sustained max crowd skill damage');
  }
});
test('all eight heroes have the same attainable five-level training cost', () => {
  for (const h of g.heroes) {
    let seeds = 0, cores = 0;
    for (let level = 0; level < 5; level++) { const c = g.cost('hero', h.id, level); seeds += c.seeds; cores += c.cores; }
    assert.equal(seeds, 960); assert.equal(cores, 9); assert.equal(g.cost('hero', h.id, 5), null);
  }
});
test('maximum research and training are additive before hero multipliers, not repeatedly compounded', () => {
  for (const h of g.heroes) {
    const p = profile({ selectedHero: h.id, heroLevels: { [h.id]: 5 }, talents: { vitality: 8, damage: 6, rate: 6, insight: 5 } });
    const before = JSON.stringify(p), s = g.makeRunStats(p);
    near(s.damageMult, h.runModifiers.damageMult * 1.245); near(s.rateMult, h.runModifiers.rateMult * 1.06);
    assert.equal(s.hp, h.runModifiers.hp + 57); near(s.skillCooldown, .9);
    for (let n = 0; n < 10; n++) assert.deepEqual(plain(g.makeRunStats(p)), plain(s));
    assert.equal(JSON.stringify(p), before);
  }
});
test('six additional unique upgrade entries match the shipped interface', () => {
  assert.equal(g.runUpgrades.length, 6); assert.equal(new Set(g.runUpgrades.map(u => u.id)).size, 6);
  assert(g.runUpgrades.every(u => typeof u.apply === 'function' && typeof u.describe === 'function' && typeof u.available === 'function' && Object.isFrozen(u)));
});
test('critical chance scales exactly with common/rare/epic quality', () => {
  const u = g.runUpgrades.find(u => u.id === 'critChance');
  for (const m of [1, 1.5, 2]) { const p = { critChance: 0 }; u.apply(p, m); near(p.critChance, .04 * m); }
});
test('critical damage scales exactly with common/rare/epic quality', () => {
  const u = g.runUpgrades.find(u => u.id === 'critMultiplier');
  for (const m of [1, 1.5, 2]) { const p = { critMultiplier: 1.5 }; u.apply(p, m); near(p.critMultiplier, 1.5 + .15 * m); }
});
test('critical damage is offered only after a hero or upgrade supplies critical chance', () => {
  const u = g.runUpgrades.find(u => u.id === 'critMultiplier');
  assert(!u.available({ critChance: 0, critMultiplier: 1.5 })); assert(u.available({ critChance: .06, critMultiplier: 1.5 }));
});
test('average penetration keeps quality scaling without hidden integer rounding', () => {
  const u = g.runUpgrades.find(u => u.id === 'pierce');
  for (const m of [1, 1.5, 2]) { const p = { pierce: 0 }; u.apply(p, m); near(p.pierce, .5 * m); }
});
test('armor upgrade tracks only its own bounded contribution', () => {
  const u = g.runUpgrades.find(u => u.id === 'defense');
  const p = { defense: 14, defenseBonus: 0 }; u.apply(p, 1.5); near(p.defense, 15.5); near(p.defenseBonus, 1.5);
  for (let n = 0; n < 20; n++) u.apply(p, 2); near(p.defense, 20); near(p.defenseBonus, 6); assert(!u.available(p));
});
test('regeneration upgrade preserves passive healing and caps only added regeneration', () => {
  const u = g.runUpgrades.find(u => u.id === 'regen');
  const p = { regen: .25, regenBonus: 0 }; u.apply(p, 1.5); near(p.regen, .43); near(p.regenBonus, .18);
  for (let n = 0; n < 20; n++) u.apply(p, 2); near(p.regen, 1.45); near(p.regenBonus, 1.2); assert(!u.available(p));
});
test('run cooldown reductions are bounded relative to permanent training', () => {
  const u = g.runUpgrades.find(u => u.id === 'skillCooldown'), p = { heroId: 'orange', skillCooldown: .9, baseSkillCooldown: .9 };
  u.apply(p, 1.5); near(p.skillCooldown, .819);
  for (let n = 0; n < 20; n++) u.apply(p, 2); near(p.skillCooldown, .54); assert(!u.available(p)); near(g.active('orange', p).cooldown, 8.64);
});
test('all bounded upgrades stay finite and disappear once saturated', () => {
  const p = { ...g.makeRunStats(profile()), baseSkillCooldown: 1, defenseBonus: 0, regenBonus: 0 };
  for (let n = 0; n < 100; n++) for (const u of g.runUpgrades) u.apply(p, 2);
  near(p.critChance, .35); near(p.critMultiplier, 2.5); near(p.pierce, 3); near(p.defense, 6); near(p.regen, 1.2); near(p.skillCooldown, .6);
  assert(g.runUpgrades.every(u => !u.available(p)));
});
test('descriptions contain actual before and after values for every upgrade', () => {
  const p = { ...g.makeRunStats(profile()), baseSkillCooldown: 1, defenseBonus: 0, regenBonus: 0 };
  for (const u of g.runUpgrades) for (const m of [1, 1.5, 2]) { const description = u.describe(m, p); assert(description.includes('→')); assert(!description.includes('NaN')); }
});
console.log('\n' + checks + ' growth data checks passed.');
