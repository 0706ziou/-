// Exact thirty-choice chapter XP and front-loaded XP bonus checks; no browser needed.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const sandbox = { window: {} };
vm.createContext(sandbox);
for (const file of ['experience-data.js', 'progression.js']) vm.runInContext(fs.readFileSync(__dirname + '/' + file, 'utf8'), sandbox, { filename: file });
const xp = sandbox.window.ORCHARD_EXPERIENCE, stages = sandbox.window.ORCHARD_STAGES;
let checks = 0;
function check(name, fn) { fn(); checks++; console.log('PASS ' + name); }
const sum = list => list.reduce((total, value) => total + value, 0);
function levels(total) {
  let level = 1, remainder = total;
  while (remainder >= xp.need(level)) { remainder -= xp.need(level); level++; }
  return { level, remainder };
}
check('The shipped thirty-choice curve costs exactly 10,000 integer XP', () => {
  assert.equal(xp.choices, 30); assert.equal(xp.levelCap, 31); assert.equal(xp.budget(), 10000);
  assert(Object.isFrozen(xp.costs)); assert.equal(xp.costs.length, 30);
  assert.equal(sum(xp.costs), 10000);
  assert.deepEqual(Array.from(xp.costs.slice(0, 6)), [180, 184, 189, 195, 201, 208]);
  assert.deepEqual(levels(10000), { level: 31, remainder: 0 });
  assert.deepEqual(levels(9999), { level: 30, remainder: xp.need(30) - 1 });
  assert.equal(xp.budget(0), 0); assert.equal(xp.budget(1), 180); assert.equal(xp.need(31), 601);
});
check('Endless continues smoothly from level 31 and retains the prior costs from level 41', () => {
  let previous = 0;
  for (let level = 1; level <= 200; level++) {
    const cost = xp.need(level);
    assert(Number.isInteger(cost) && cost > previous);
    if (level >= 41) assert.equal(cost, Math.round(10 + 7 * (level - 1) + .35 * (level - 1) ** 2));
    previous = cost;
  }
  assert.equal(xp.need(30), 577); assert.equal(xp.need(31), 601); assert.equal(xp.need(40), 844);
  assert.equal(xp.need(41), 850); assert.equal(xp.need(42), 885);
  assert.equal(xp.budget(10), 2073); assert.equal(xp.budget(20), 5185);
});
check('Chapter one grants the first choice at eight ordinary kills, two by twenty, four by forty and nine by eighty', () => {
  const rewards = stages[0].xpRewards;
  assert.equal(sum(rewards.slice(0, 7)), 160);
  assert.equal(levels(sum(rewards.slice(0, 7))).level, 1);
  assert.deepEqual(levels(sum(rewards.slice(0, 8))), { level: 2, remainder: 0 });
  assert.equal(sum(rewards.slice(0, 20)), 470);
  assert.deepEqual([1, 5, 10, 20, 40, 80].map(count => levels(sum(rewards.slice(0, count))).level - 1), [0, 0, 1, 2, 4, 9]);
  assert.equal(levels(sum(rewards.slice(0, 20)) + rewards[stages[0].normalCount]).level - 1, 2);
  assert.equal(stages[0].experience.ranges.slow.min, 20); assert.equal(stages[0].experience.ranges.slow.max, 20);
  assert.equal(stages[0].experience.ranges.fast.min, 29); assert.equal(stages[0].experience.ranges.fast.max, 30);
});
for (const stage of stages) {
  check(`Chapter ${stage.id}: normal opening pacing and stacked bonuses cannot multi-level on a first kill`, () => {
    const normalRewards = stage.xpRewards.slice(0, stage.normalCount);
    let total = 0, firstChoiceAt = 0;
    for (let index = 0; index < normalRewards.length; index++) {
      total += normalRewards[index];
      if (total >= xp.need(1)) { firstChoiceAt = index + 1; break; }
    }
    assert(firstChoiceAt >= 8 && firstChoiceAt <= 14);
    const initialBonus = 1.06 * 1.10 * 1.15 + .08;
    const fullyStackedBonus = 1.06 * 1.10 * 1.15 * 1.5 + .08;
    for (const bonus of [1, initialBonus, fullyStackedBonus]) {
      const ledger = xp.create(stage), first = ledger.grant(Math.max(...normalRewards), bonus, 'first-normal');
      assert.equal(levels(first).level, 1);
      assert.equal(ledger.grant(Math.max(...normalRewards), bonus, 'first-normal'), 0);
    }
    // 初次击杀还不能拥有局内经验词条；即使先杀精英也不会连续弹出两次选择。
    const eliteFirst = xp.create(stage).grant(stage.xpRewards[stage.normalCount], initialBonus, 'first-elite');
    assert(levels(eliteFirst).level <= 2);
  });
  check(`Chapter ${stage.id}: complete roster has deterministic integer XP summing to the cap`, () => {
    const rewards = xp.assign(stage);
    assert(Object.isFrozen(rewards)); assert.equal(rewards.length, stage.enemyCount);
    assert.equal(sum(rewards), 10000); assert(rewards.every(value => Number.isInteger(value) && value > 0));
    assert.deepEqual(Array.from(rewards), Array.from(stage.xpRewards));
    assert.deepEqual(Array.from(xp.assign(stage)), Array.from(rewards));
    assert(Object.isFrozen(stage.xpRewards)); assert(Object.isFrozen(stage.experience));
    assert.deepEqual(levels(sum(rewards)), { level: 31, remainder: 0 });
  });
  check(`Chapter ${stage.id}: fly, elite and boss rewards remain successively larger`, () => {
    const groups = { slow: [], fast: [], elite: [], boss: [] };
    stage.xpRewards.forEach((value, index) => {
      const type = index >= stage.normalCount + stage.eliteCount ? 'boss' : index >= stage.normalCount ? 'elite' :
        Math.floor((index + 1) * stage.fastCount / stage.normalCount) > Math.floor(index * stage.fastCount / stage.normalCount) ? 'fast' : 'slow';
      groups[type].push(value);
    });
    for (const type of Object.keys(groups)) {
      assert.equal(groups[type].length, stage.experience.counts[type]);
      assert.equal(sum(groups[type]), stage.experience.totals[type]);
      assert.equal(Math.min(...groups[type]), stage.experience.ranges[type].min);
      assert.equal(Math.max(...groups[type]), stage.experience.ranges[type].max);
      assert.equal(Math.round(sum(groups[type]) / groups[type].length), stage.experience.typical[type]);
      assert(stage.experience.typical[type] >= 1);
    }
    assert(Math.max(...groups.slow) < Math.min(...groups.fast));
    assert(Math.max(...groups.fast) < Math.min(...groups.elite));
    assert(Math.max(...groups.elite) < Math.min(...groups.boss));
  });
  for (const multiplier of [1, 1.2, 1.65, 2.8]) {
    check(`Chapter ${stage.id}: XP rate ${multiplier} accelerates progression without an extra choice`, () => {
      const ledger = xp.create(stage);
      let first = 0;
      stage.xpRewards.forEach((value, index) => {
        const released = ledger.grant(value, multiplier, index);
        if (index === 0) first = released;
        assert(Number.isInteger(released) && released >= 0);
        assert.equal(ledger.collect(released), released);
        assert(ledger.issued <= ledger.budget); assert(ledger.collected <= ledger.issued);
      });
      if (multiplier === 1) assert.equal(first, stage.xpRewards[0]); else assert(first > stage.xpRewards[0]);
      assert.equal(ledger.issued, 10000); assert.equal(ledger.collected, 10000); assert.equal(ledger.baseGranted, 10000);
      assert.equal(ledger.finish(), 0); assert.equal(ledger.finish(), 0); assert.equal(ledger.carry, 0);
      assert.deepEqual(levels(ledger.collected), { level: 31, remainder: 0 });
    });
  }
}
check('Fractional XP bonus carries between kills instead of silently rounding every bonus away', () => {
  const ledger = xp.create(stages[0]);
  assert.deepEqual(Array.from({ length: 5 }, () => ledger.grant(1, 1.2)), [1, 1, 1, 1, 2]);
  assert.equal(ledger.issued, 6); assert(ledger.carry < 1e-8);
});
check('Changing bonuses halfway through a chapter still settles to exactly the same cap', () => {
  const stage = stages[stages.length - 1], ledger = xp.create(stage);
  for (let index = 0; index < stage.xpRewards.length; index++) ledger.collect(ledger.grant(stage.xpRewards[index], index < 100 ? 1 : 1.56));
  assert.equal(ledger.collected, 10000); assert.equal(ledger.finish(), 0);
});
check('Dropped XP, direct Boss XP and remaining reserves reconcile without double credit', () => {
  const ledger = xp.create(stages[0]);
  const ground = ledger.grant(25, 1.2, 'bug-1'), boss = ledger.grant(300, 1.2, 'boss-1');
  assert.equal(ground, 30); assert.equal(boss, 360); assert.equal(ledger.collect(boss, 'boss-claim'), 360);
  assert.equal(ledger.grant(25, 1.2, 'bug-1'), 0); assert.equal(ledger.collect(boss, 'boss-claim'), 0);
  assert.equal(ledger.snapshot().uncollected, ground); assert.equal(ledger.collect(ground, 'gem-1'), ground);
  const remainder = ledger.finish(); assert.equal(remainder, 10000 - ground - boss);
  assert.equal(ledger.collect(remainder), remainder); assert.equal(ledger.collected, 10000);
  assert.equal(ledger.finish(), 0); assert.equal(ledger.grant(400, 2, 'late'), 0); assert.equal(ledger.collect(999999), 0);
});
check('Oversized bonuses use only the existing reserve and never create infinite XP', () => {
  const ledger = xp.create(stages[0]);
  assert.equal(ledger.grant(50, 1e100), 10000); assert.equal(ledger.grant(50, 2), 0);
  assert.equal(ledger.collect(1e100), 10000); assert.equal(ledger.carry, 0); assert.equal(ledger.finish(), 0);
});
check('Invalid input cannot reduce already released or collected experience', () => {
  const ledger = xp.create(stages[0]);
  for (const amount of [0, -1, NaN, Infinity, undefined]) { assert.equal(ledger.grant(amount), 0); assert.equal(ledger.collect(amount), 0); }
  assert.equal(ledger.grant(10, NaN), 10); assert.equal(ledger.collect(10), 10);
  assert.equal(ledger.grant(1, -3), 1); assert.equal(ledger.collect(1), 1);
  assert.equal(ledger.collected, 11);
});
console.log(`${checks} exact chapter experience checks passed.`);
