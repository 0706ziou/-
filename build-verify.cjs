// Pure VM checks for bounded two-category builds and actual skill / evolution effects.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const sandbox = { window: {} };
vm.runInNewContext(fs.readFileSync(__dirname + '/build-data.js', 'utf8'), sandbox);
const b = sandbox.window.ORCHARD_BUILDS;
let checks = 0;
const test = (name, fn) => { fn(); checks++; console.log('✓ ' + name); };
const plain = x => JSON.parse(JSON.stringify(x));
const near = (a, c) => assert(Math.abs(a - c) < 1e-8, `${a} != ${c}`);
function player(extra = {}) {
  const p = { x: 500, y: 500, hp: 50, maxHp: 100, damage: 18, rate: 2, shots: 1, speed: 190, pickup: 62, xpMult: 1.06,
    critChance: 0, critMultiplier: 1.5, pierce: 0, skillCooldown: .9, baseSkillCooldown: .9, defense: 2, regen: .25, regenDelay: 6, upgrades: {}, ...extra };
  p.baseStats = Object.freeze({ damage: p.damage, rate: p.rate, shots: p.shots, speed: p.speed, pickup: p.pickup });
  b.init(p); return p;
}
function max(p, id, quality = 1) { for (let i = 0; i < 5; i++) assert(b.choose(p, id, quality).applied, `${id} upgrade ${i + 1}`); }
function context(p, list, extra = {}) {
  const events = { hits: [], effects: [], heal: 0 };
  return { events, elapsed: 20, standing: true,
    targets: (x, y, radius) => list.filter(e => e.hp > 0 && Math.hypot(e.x - x, e.y - y) <= radius + (e.r || 0)).sort((a, c) => Math.hypot(a.x - x, a.y - y) - Math.hypot(c.x - x, c.y - y)),
    hit: (e, damage, color) => { events.hits.push({ e, damage, color }); e.hp -= damage; },
    effect: e => events.effects.push(e), heal: n => { events.heal += n; p.hp = Math.min(p.maxHp, p.hp + n); }, ...extra };
}
test('32 unique immutable options, exactly 16 per category', () => {
  assert.equal(b.defs.length, 32); assert.equal(new Set(b.defs.map(d => d.id)).size, 32);
  for (const category of ['attack', 'attribute']) assert.equal(b.defs.filter(d => d.category === category).length, 16);
  assert(Object.isFrozen(b.defs)); assert(b.defs.every(Object.isFrozen)); assert(Object.isFrozen(b.limits));
});
test('eight unique immutable recipes join an attack and an attribute', () => {
  assert.equal(b.recipes.length, 8); assert.equal(new Set(b.recipes.map(r => r.id)).size, 8);
  for (const r of b.recipes) { assert.equal(b.get(r.attack).category, 'attack'); assert.equal(b.get(r.attribute).category, 'attribute'); assert(Object.isFrozen(r)); assert(r.description.length > 15); }
});
test('initialization preserves permanent hero / equipment statistics', () => {
  const p = player({ damage: 25, defense: 7, critChance: .06, skillCooldown: .72, baseSkillCooldown: .72, xpMult: 1.4, weaponRange: 720 });
  assert.equal(p.damage, 25); assert.equal(p.defense, 7); assert.equal(p.critChance, .06); assert.equal(p.skillCooldown, .72); assert.equal(p.xpMult, 1.4); assert.equal(p.weaponRange, 720);
  assert.equal(p.build.attackSlots.length, 0); assert.equal(p.build.attributeSlots.length, 0); assert.equal(p.build.superSkills.length, 0);
});
test('all descriptions are concrete and finite for every rarity and option', () => {
  const p = player();
  for (const d of b.defs) for (const m of [1, 1.5, 2]) { const text = d.describe(m, p); assert.equal(typeof text, 'string'); assert(text.length > 10); assert(!/NaN|undefined|Infinity/.test(text)); }
});
test('first four attacks reserve exactly four slots; fifth attack is rejected', () => {
  const p = player(); for (const id of ['chain', 'leafstorm', 'fireball', 'poison']) assert(b.choose(p, id).applied);
  assert.equal(p.build.attackSlots.length, 4); const before = JSON.stringify(p); assert(!b.choose(p, 'bees').applied); assert.equal(JSON.stringify(p), before);
  assert(b.available(p, 'chain')); assert(!b.available(p, 'damage'));
});
test('attribute capacity is separate from attack capacity', () => {
  const p = player(); for (const id of ['damage', 'rate', 'shots', 'chain']) assert(b.choose(p, id).applied);
  for (const id of ['speed', 'hp', 'regen', 'pickup']) assert(b.choose(p, id).applied);
  assert.equal(p.build.attributeSlots.length, 4); assert(!b.choose(p, 'xp').applied); assert(b.available(p, 'hp'));
});
test('each category stops after twenty selections, total forty; exhausted pool is empty', () => {
  const p = player(); for (const id of ['damage', 'rate', 'shots', 'chain', 'hp', 'speed', 'pickup', 'range']) max(p, id);
  assert.equal(p.build.attackChoices, 20); assert.equal(p.build.attributeChoices, 20); assert.equal(b.pool(p).length, 0);
  const s = b.summary(p); assert.equal(s.totalChoices, 40); assert(s.exhausted); assert.equal(s.attack.length, 4); assert.equal(s.attribute.length, 4);
});
test('five levels count choices rather than rarity multiplier', () => {
  const p = player(); max(p, 'damage', 2); assert.equal(p.build.levels.damage, 5); assert.equal(p.build.powers.damage, 10); assert.equal(p.upgrades.damage, 5);
  const before = p.damage; assert(!b.choose(p, 'damage', 2).applied); assert.equal(p.damage, before);
});
test('normal, rare and epic gains scale monotonically without compounding the start base', () => {
  const values = [1, 1.5, 2].map(m => { const p = player(); max(p, 'damage', m); return p.damage; });
  near(values[0], 18 * 1.6); near(values[1], 18 * 1.9); near(values[2], 18 * 2.2);
  const rates = [1, 2].map(m => { const p = player(); max(p, 'rate', m); return p.rate; }); near(rates[0], 2.8); near(rates[1], 3.6);
});
test('multishot always consumes one level and one added seed; rarity improves total volley damage', () => {
  for (const m of [1, 1.5, 2]) { const p = player(); max(p, 'shots', m); assert.equal(p.shots, 6); near(p.volleyBonus, .9 * m); assert.equal(p.build.levels.shots, 5); }
});
test('quality validation cannot create nonfinite or negative numbers', () => {
  for (const m of [NaN, Infinity, -10, null, '2']) { const p = player(); assert(b.choose(p, 'damage', m).applied); near(p.damage, 20.16); }
  const p = player(); b.choose(p, 'damage', 100); near(p.damage, 22.32);
});
test('unknown and prototype option IDs are rejected without modifying the player', () => {
  const p = player(), before = JSON.stringify(p);
  for (const id of ['missing', '__proto__', 'constructor', null, {}, 4]) { assert(!b.choose(p, id).applied); assert.equal(b.get(id), null); }
  assert.equal(JSON.stringify(p), before);
});
for (const r of b.recipes) test(`${r.name}: exact full pair creates one super and retains occupied slots`, () => {
  const p = player(); max(p, r.attack);
  for (let i = 0; i < 4; i++) assert.equal(b.choose(p, r.attribute).newSuper.length, 0);
  const result = b.choose(p, r.attribute); assert.equal(result.newSuper.length, 1); assert.equal(result.newSuper[0].id, r.id);
  assert(p.build.superSkills.includes(r.id)); assert(p.build.attackSlots.includes(r.attack)); assert(p.build.attributeSlots.includes(r.attribute));
  assert.equal(p.build.attackChoices, 5); assert.equal(p.build.attributeChoices, 5); assert(!b.choose(p, r.attribute).applied); assert.equal(p.build.superSkills.length, 1);
});
test('two mismatched full options never fabricate a super', () => { const p = player(); max(p, 'chain'); max(p, 'hp'); assert.equal(p.build.superSkills.length, 0); });
test('four evolved pairs keep all eight slots and cannot bypass the cap', () => {
  const p = player(); for (const r of b.recipes.slice(0, 4)) { max(p, r.attack); max(p, r.attribute); }
  assert.equal(p.build.superSkills.length, 4); assert.equal(p.build.attackSlots.length, 4); assert.equal(p.build.attributeSlots.length, 4); assert.equal(b.pool(p).length, 0);
});
const bounds = { crit: ['critChance', .4], critDamage: ['critMultiplier', 2.8], pierce: ['pierce', 4], defense: ['defenseBonus', 5], regen: ['regenBonus', 1], lifeSteal: ['lifeSteal', .04], dodge: ['dodge', .2], thorns: ['thorns', 1.6], standPower: ['standPower', .5], killHeal: ['killHeal', 1.5], skillPower: ['skillPower', 1.6], magnet: ['magnetMult', 2.5], projectileSpeed: ['projectileSpeedMult', 1.8] };
for (const [id, [field, limit]] of Object.entries(bounds)) test(`${id}: up to five epic choices respect the numerical cap`, () => {
  const p = player(id === 'critDamage' ? { critChance: .04 } : {}); for (let i = 0; i < 5 && b.available(p, id); i++) assert(b.choose(p, id, 2).applied);
  assert(p[field] > 0); assert(p[field] <= limit + 1e-8); assert(p.build.levels[id] <= 5);
});
test('critical damage requires a real critical source and cannot reserve a permanently useless attack slot', () => {
  const p = player(); assert(!b.available(p, 'critDamage')); assert(!b.choose(p, 'critDamage').applied); assert.equal(p.build.attackSlots.length, 0);
  assert(!b.pool(p).some(d => d.id === 'critDamage')); b.choose(p, 'crit'); assert(b.available(p, 'critDamage')); assert(b.choose(p, 'critDamage').applied);
  const hero = player({ critChance: .06 }); assert(b.available(hero, 'critDamage'));
  const relic = player(); relic.critChance += .05; assert(b.available(relic, 'critDamage'));
});
test('mobility, pickup, XP and cooldown have explicit start-relative limits', () => {
  const p = player(); for (const id of ['speed', 'pickup', 'xp', 'skillCooldown']) max(p, id, 2);
  near(p.speed, 190 * 1.4); near(p.pickup, 62 * 3); near(p.xpMult, 1.06 * 1.5); near(p.skillCooldown, .9 * .6);
});
test('health increases max life and heals within that new cap', () => { const p = player({ hp: 95 }); b.choose(p, 'hp', 2); assert.equal(p.maxHp, 128); assert.equal(p.hp, 128); });
test('capped upgrades never reduce stronger bonuses from a picked relic', () => {
  const p = player(); p.speed = 310; p.pickup = 220; p.skillPower = 1.9; p.weaponRange = 980;
  for (const id of ['speed', 'pickup', 'skillPower', 'range']) b.choose(p, id, 2);
  assert.equal(p.speed, 310); assert.equal(p.pickup, 220); assert.equal(p.skillPower, 1.9); assert.equal(p.weaponRange, 980);
  const q = player(); q.skillCooldown = .4; b.choose(q, 'skillCooldown', 2); assert.equal(q.skillCooldown, .4);
});
test('XP upgrade adds its own gain while preserving a relic XP bonus', () => {
  const p = player(); p.xpMult += .3; b.choose(p, 'xp', 2); near(p.xpMult, 1.06 + .3 + .106);
});
test('relic numerical deltas are excluded from the independent build ceilings', () => {
  const p = player({ critChance: .10 }); p.relicBonuses = { speed: 15.2, pickup: 35, critChance: .05, pierce: .6 };
  p.speed += 15.2; p.pickup += 35; p.critChance += .05; p.pierce += .6;
  max(p, 'speed', 2); max(p, 'pickup', 2); max(p, 'crit', 2);
  for (let i = 0; i < 5 && b.available(p, 'pierce'); i++) b.choose(p, 'pierce', 2);
  near(p.speed, 190 * 1.4 + 15.2); near(p.pickup, 62 * 3 + 35); near(p.critChance, .45); near(p.pierce, 4.6);
});
test('five epic piercing ranks all improve the stat and do not truncate stage choices', () => {
  const p = player(); for (let i = 0; i < 4; i++) assert(b.choose(p, 'pierce', 2).applied);
  near(p.pierce, 3.2); assert.equal(p.build.levels.pierce, 4); assert(b.available(p, 'pierce'));
  assert(b.choose(p, 'pierce', 2).applied); near(p.pierce, 4); assert(!b.available(p, 'pierce'));
});
test('a capped recipe attribute remains available for meaningful super-skill progression', () => {
  const p = player(); p.speed = 310; max(p, 'leafstorm'); max(p, 'speed'); assert(p.build.superSkills.includes('leafcyclone')); assert.equal(p.speed, 310);
});
const attackIds = ['chain', 'leafstorm', 'fireball', 'poison', 'pulse', 'bees', 'boomerang', 'frostburst', 'solar', 'ricochet'];
for (const id of attackIds) test(`${id}: creates real damage, finite visual feedback and a running cooldown`, () => {
  const p = player(); b.choose(p, id);
  const enemies = [{ x: 550, y: 500, hp: 10000, r: 19 }, { x: 585, y: 505, hp: 10000, r: 19 }, { x: 610, y: 490, hp: 10000, r: 19 }];
  const ctx = context(p, enemies); b.tick(p, .03, ctx); b.tick(p, .03, ctx);
  assert(ctx.events.hits.length > 0); assert(ctx.events.hits.every(h => h.damage > 0 && Number.isFinite(h.damage)));
  assert(ctx.events.effects.length > 0); assert(p.build.timers[id] > 0);
});
for (const r of b.recipes) test(`${r.name}: upgraded attack deals damage and suppresses its source skill`, () => {
  const p = player(); max(p, r.attack); max(p, r.attribute);
  const enemies = Array.from({ length: 8 }, (_, i) => ({ x: 520 + i * 15, y: 500 + i % 2 * 15, hp: 10000, r: 19, boss: i === 7 }));
  const ctx = context(p, enemies); b.tick(p, .03, ctx); b.tick(p, .03, ctx);
  assert(ctx.events.hits.length > 0); assert(p.build.timers[r.id] > 0); assert.equal(p.build.timers[r.attack], undefined);
  assert(ctx.events.effects.some(e => e.key === r.id)); assert(!ctx.events.effects.some(e => e.key === r.attack));
});
test('stationary solar requires standing, leaving cooldown ready while moving', () => {
  const p = player(); b.choose(p, 'solar'); const ctx = context(p, [{ x: 550, y: 500, hp: 1000 }], { standing: false });
  b.tick(p, .1, ctx); assert.equal(ctx.events.hits.length, 0); assert.equal(p.build.timers.solar, 0);
  ctx.standing = true; b.tick(p, .1, ctx); assert(ctx.events.hits.length > 0);
});
test('frost slows bosses less and preserves stronger existing slow', () => {
  const p = player(); b.choose(p, 'frostburst'); const enemies = [{ x: 530, y: 500, hp: 1000 }, { x: 550, y: 500, hp: 1000, boss: true }, { x: 560, y: 500, hp: 1000, slowAmount: .5, slowUntil: 30 }];
  b.tick(p, .1, context(p, enemies)); near(enemies[0].slowAmount, .3); near(enemies[1].slowAmount, .15); near(enemies[2].slowAmount, .5); assert.equal(enemies[2].slowUntil, 30);
});
test('an expired stronger slow cannot be resurrected by a weaker fresh cast', () => {
  const p = player(); b.choose(p, 'frostburst'); const enemies = [{ x: 530, y: 500, hp: 1000, slowAmount: .5, slowUntil: 10 }];
  b.tick(p, .03, context(p, enemies)); near(enemies[0].slowAmount, .3); assert.equal(enemies[0].slowUntil, 22);
});
test('an attack does not consume cooldown with no targets, allowing immediate response to reinforcements', () => {
  const p = player(); b.choose(p, 'chain'); const enemies = [], ctx = context(p, enemies); b.tick(p, 4, ctx); assert.equal(p.build.timers.chain, 0);
  enemies.push({ x: 560, y: 500, hp: 1000 }); b.tick(p, .03, ctx); assert(ctx.events.hits.length > 0);
});
test('chain never strikes the same surviving target twice in one cast', () => {
  const p = player(); b.choose(p, 'chain'); const enemies = Array.from({ length: 6 }, (_, i) => ({ x: 540 + i * 10, y: 500, hp: 1000 }));
  const ctx = context(p, enemies); b.tick(p, .03, ctx); assert.equal(ctx.events.hits.length, 3); assert.equal(new Set(ctx.events.hits.map(h => h.e)).size, 3);
});
test('poison produces a finite duration field that damages repeatedly and then expires', () => {
  const p = player(); b.choose(p, 'poison'); const ctx = context(p, [{ x: 540, y: 500, hp: 10000 }]);
  b.tick(p, .03, ctx); assert.equal(p.build.zones.length, 1); const before = ctx.events.hits.length;
  for (let i = 0; i < 31; i++) b.tick(p, .1, ctx);
  assert(ctx.events.hits.length >= before + 5); assert.equal(p.build.zones.length, 0);
});
test('skill damage boost applies to periodic attacks exactly once', () => {
  const results = [1, 1.6].map(skillPower => { const p = player({ skillPower }); b.choose(p, 'leafstorm'); const ctx = context(p, [{ x: 520, y: 500, hp: 1000 }]); b.tick(p, .03, ctx); return ctx.events.hits[0].damage; }); near(results[1], results[0] * 1.6);
});
test('evolved skills retain attack rarity, preventing an epic attack from weakening at fusion', () => {
  const values = [1, 1.5, 2].map(quality => {
    const p = player(); max(p, 'fireball', quality); max(p, 'hp'); const ctx = context(p, [{ x: 550, y: 500, hp: 10000 }]);
    b.tick(p, .03, ctx); return ctx.events.hits[0].damage;
  });
  near(values[0], 18 * 4.8); near(values[1], 18 * 4.8 * 1.3); near(values[2], 18 * 4.8 * 1.6);
  const originalEpic = 18 * 1.65 * (1 + .35 * 9); assert(values[2] > originalEpic);
});
test('earthguard heals even with no enemy and never goes over max life', () => {
  const p = player({ hp: 99 }); max(p, 'pulse'); max(p, 'defense'); const ctx = context(p, []); b.tick(p, .1, ctx); assert.equal(p.hp, 100); assert.equal(ctx.events.heal, 2.5);
});
test('zero, negative and invalid dt do not mutate timers or deal damage', () => {
  const p = player(); b.choose(p, 'chain'); const ctx = context(p, [{ x: 550, y: 500, hp: 1000 }]); const before = JSON.stringify(p);
  for (const dt of [0, -1, NaN, Infinity]) b.tick(p, dt, ctx); assert.equal(ctx.events.hits.length, 0); assert.equal(JSON.stringify(p), before);
});
test('mode API defaults to stage and switches a full build without changing owned growth', () => {
  const p = player(); for (const r of b.recipes.slice(0, 4)) { max(p, r.attack); max(p, r.attribute); }
  assert.equal(b.summary(p).mode, 'stage'); assert.equal(b.getLimits(p), b.limits);
  const owned = plain(p); b.setMode(p, 'endless'); owned.build.mode = 'endless'; assert.deepEqual(plain(p), owned);
  assert.equal(b.summary(p).mode, 'endless'); assert.equal(b.getLimits(p), b.endlessLimits);
  assert.equal(b.summary(p).limits.maxLevel, Infinity); assert.equal(b.summary(p).limits.attackSlots, 16); assert(!b.summary(p).exhausted);
  assert(b.available(p, 'damage')); assert(b.available(p, 'chain'));
});
test('every legal stage option can gain five ranks, including externally capped primary statistics', () => {
  for (const d of b.defs) {
    const p = player({ critChance: .7, critMultiplier: 5, pierce: 8, speed: 400, pickup: 1000, weaponRange: 2000, projectileSpeedMult: 4,
      lifeSteal: .2, dodge: .7, thorns: 4, standPower: 2, killHeal: 8, skillPower: 3, magnetMult: 5,
      defenseBonus: 7, regenBonus: 1.2, buildXpBonus: .5, skillCooldown: .2, baseSkillCooldown: .9 });
    for (let rank = 1; rank <= 5; rank++) {
      const numbers = Object.keys(p).filter(k => typeof p[k] === 'number').map(k => [k, p[k]]);
      const oldPower = p.build.powers[d.id] || 0;
      assert(b.choose(p, d.id, 2).applied, `${d.id} stopped at ${rank}`);
      assert(numbers.some(([k, before]) => p[k] > before || (k === 'skillCooldown' && p[k] < before)) || (attackIds.includes(d.id) && p.build.powers[d.id] > oldPower), `${d.id} has no gain`);
    }
    assert.equal(p.build.levels[d.id], 5); assert(!b.available(p, d.id));
  }
});
test('overflow descriptions match an actual additional statistic instead of advertising a capped upgrade', () => {
  const p = player({ pierce: 8 }); assert.match(b.get('pierce').describe(2, p), /主属性已达安全值.*伤害/);
  const damage = p.damage; b.choose(p, 'pierce', 2); near(p.damage - damage, 18 * .05); assert.equal(p.pierce, 8);
  const q = player(); q.speed = 400; assert.match(b.get('speed').describe(2, q), /转为生命上限/);
  b.choose(q, 'speed', 2); assert.equal(q.speed, 400); assert.equal(q.maxHp, 110); assert.equal(q.hp, 60);
});
test('many different legal stage paths all reach exactly forty meaningful choices', () => {
  let seed = 1273; const random = n => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n; };
  for (let route = 0; route < 100; route++) {
    const p = player({ critChance: route % 2 ? .06 : 0 });
    let count = 0;
    while (b.pool(p).length) {
      const options = b.pool(p), d = options[random(options.length)]; assert(b.choose(p, d.id, [1, 1.5, 2][random(3)]).applied); count++;
      assert(count <= 40);
    }
    assert.equal(count, 40); assert.equal(p.build.attackChoices, 20); assert.equal(p.build.attributeChoices, 20);
    assert.equal(p.build.attackSlots.length, 4); assert.equal(p.build.attributeSlots.length, 4);
    assert([...p.build.attackSlots, ...p.build.attributeSlots].every(id => p.build.levels[id] === 5));
  }
});
test('endless opens all sixteen options per category and every acquired option beyond rank five', () => {
  const p = player(); b.setMode(p, 'endless');
  for (const d of b.defs) for (let i = 0; i < 8; i++) assert(b.choose(p, d.id, 2).applied, d.id);
  assert.equal(p.build.attackSlots.length, 16); assert.equal(p.build.attributeSlots.length, 16);
  assert.equal(b.summary(p).totalChoices, 256); assert.equal(p.build.superSkills.length, 8);
  assert(b.defs.every(d => p.build.levels[d.id] === 8 && b.available(p, d))); assert.equal(b.pool(p).length, 32);
  assert.equal(b.summary(p).attack[0].maxLevel, Infinity);
});
test('super recipes accept an attack already beyond level five and never craft duplicate skills', () => {
  const p = player(); b.setMode(p, 'endless'); for (let i = 0; i < 12; i++) assert(b.choose(p, 'chain', 2).applied);
  let crafted = 0; for (let i = 0; i < 12; i++) crafted += b.choose(p, 'range', 2).newSuper.length;
  assert.equal(crafted, 1); assert.deepEqual(plain(p.build.superSkills), ['skyweb']);
});
test('endless marginal growth decreases after rank five while damage and rate keep increasing', () => {
  const p = player(); b.setMode(p, 'endless'); max(p, 'damage');
  const at5 = p.damage; b.choose(p, 'damage'); const rank6 = p.damage - at5;
  let before = p.damage; for (let i = 0; i < 194; i++) { before = p.damage; assert(b.choose(p, 'damage').applied); }
  const rank200 = p.damage - before; assert(rank200 > 0 && rank200 < rank6); assert.equal(p.build.levels.damage, 200);
  for (let i = 0; i < 200; i++) assert(b.choose(p, 'rate').applied);
  assert(p.rate > 2); assert(p.rate < 2 + 200 * .2); assert(Number.isFinite(p.damage));
});
test('endless defensive choices retain positive cooldowns and avoid guaranteed dodge at high levels', () => {
  const p = player(); b.setMode(p, 'endless');
  for (const id of ['dodge', 'skillCooldown', 'lifeSteal', 'speed', 'pickup', 'projectileSpeed', 'range', 'regen', 'defense', 'magnet', 'killHeal', 'crit', 'pierce']) {
    for (let i = 0; i < 1000; i++) assert(b.choose(p, id, 2).applied, id);
    assert(!/NaN|Infinity|undefined/.test(b.get(id).describe(2, p)));
  }
  assert(p.dodge <= .45 + 1e-9); assert(p.skillCooldown >= .225 - 1e-9); assert(p.skillCooldown > 0);
  assert(p.lifeSteal <= .08 + 1e-9); assert(p.speed <= 190 * 1.9 + 1e-9); assert(p.pickup <= 900 + 1e-9);
  assert(p.projectileSpeedMult <= 2.6 + 1e-9); assert(p.weaponRange <= 1100 + 1e-9); assert(p.pierce <= 8 + 1e-9);
  assert(p.defenseBonus <= 20 + 1e-9); assert(p.regenBonus <= 10 + 1e-9); assert(p.magnetMult <= 5 + 1e-9); assert(p.killHeal <= 6 + 1e-9);
  assert(p.maxHp > 100); assert(p.damage > 18); assert(b.pool(p).length > 0);
});
for (const r of b.recipes) test(`${r.name}: a rank six source strengthens the real evolved damage`, () => {
  const damages = [5, 6].map(rank => {
    const p = player(); b.setMode(p, 'endless'); for (let i = 0; i < rank; i++) b.choose(p, r.attack, 2); max(p, r.attribute);
    const ctx = context(p, [{ x: 540, y: 500, hp: 1000000 }]); b.tick(p, .03, ctx); b.tick(p, .03, ctx);
    assert.equal(p.build.superSkills.length, 1); assert.equal(p.build.timers[r.attack], undefined);
    assert(!ctx.events.effects.some(e => e.key === r.attack)); assert(ctx.events.hits.length);
    if (rank === 6) assert.match(b.get(r.attack).describe(2, p), /强化.*超级伤害/);
    return ctx.events.hits[0].damage;
  }); assert(damages[1] > damages[0]);
});
for (const id of attackIds) test(`${id}: ordinary unmerged attack levels also grow past rank five`, () => {
  const damages = [5, 6].map(rank => {
    const p = player(); b.setMode(p, 'endless'); for (let i = 0; i < rank; i++) b.choose(p, id);
    const ctx = context(p, [{ x: 540, y: 500, hp: 1000000 }]); b.tick(p, .03, ctx); b.tick(p, .03, ctx); return ctx.events.hits[0].damage;
  }); assert(damages[1] > damages[0]);
});
test('starting a new build restores stage capacity and clears endless ranks', () => {
  const p = player(); b.setMode(p, 'endless'); for (let i = 0; i < 12; i++) b.choose(p, 'damage');
  b.init(p); assert.equal(b.summary(p).mode, 'stage'); assert.equal(b.getLimits(p), b.limits); assert.equal(b.summary(p).totalChoices, 0); assert.equal(p.build.levels.damage, undefined);
});
test('poison has an exact pulse budget independent of frame length', () => {
  for (const step of [.05, .1, .6, 1]) {
    const p = player(); b.choose(p, 'poison'); const ctx = context(p, [{ x: 540, y: 500, hp: 1000000 }]);
    b.tick(p, .01, ctx);
    let seconds = 0;
    while (seconds < 3 - 1e-9) { const dt = Math.min(step, 3 - seconds); b.tick(p, dt, ctx); seconds += dt; }
    assert.equal(ctx.events.hits.length, 5, 'extra end pulse with dt=' + step);
    near(ctx.events.hits.reduce((sum, hit) => sum + hit.damage, 0), p.damage * .22 * 5);
    assert.equal(p.build.zones.length, 0);
  }
});
for (const r of b.recipes) test(`${r.name}: common, rare and epic fusion all improve sustained single-target damage`, () => {
  for (const q of [1, 1.5, 2]) {
    const totals = [false, true].map(evolve => {
      const p = player(); max(p, r.attack, q); if (evolve) max(p, r.attribute, q);
      const ctx = context(p, [{ x: 540, y: 500, hp: 1e9 }]);
      for (let i = 0; i < 3600; i++) { ctx.elapsed = i * .05; b.tick(p, .05, ctx); }
      return ctx.events.hits.reduce((sum, hit) => sum + hit.damage, 0);
    });
    assert(totals[1] > totals[0], `${r.id} quality ${q}: ${totals[1]} <= ${totals[0]}`);
  }
});
for (const r of b.recipes) test(`${r.name}: late endless fusion never reduces a high-rank source attack`, () => {
  for (const rank of [6, 20, 80]) for (const q of [1, 2]) {
    const totals = [false, true].map(evolve => {
      const p = player(); b.setMode(p, 'endless'); for (let i = 0; i < rank; i++) b.choose(p, r.attack, q);
      if (evolve) max(p, r.attribute, q);
      const ctx = context(p, [{ x: 540, y: 500, hp: 1e12 }]);
      for (let i = 0; i < 6000; i++) { ctx.elapsed = i * .05; b.tick(p, .05, ctx); }
      return ctx.events.hits.reduce((sum, hit) => sum + hit.damage, 0);
    });
    assert(totals[1] > totals[0], `${r.id} rank ${rank} quality ${q}: ${totals[1]} <= ${totals[0]}`);
  }
});
console.log(`${checks} build checks passed`);
