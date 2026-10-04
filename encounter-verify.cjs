// Validate the shipped encounter roster and pressure curve: node encounter-verify.cjs.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const sandbox = { window: {} };
vm.createContext(sandbox);
for (const filename of ['experience-data.js', 'progression.js', 'orchard-data.js']) {
  vm.runInContext(fs.readFileSync(__dirname + '/' + filename, 'utf8'), sandbox, { filename });
}
const stages = sandbox.window.ORCHARD_STAGES;
const bosses = sandbox.window.ORCHARD_BOSSES;
const rescues = sandbox.window.ORCHARD_RESCUES;
let checks = 0;
function check(name, fn) { fn(); checks++; console.log('PASS ' + name); }
check('First chapter leaves a full 60 seconds before its first boss', () => {
  assert.deepEqual(Array.from(stages[0].bossSchedule), [60]);
  assert.equal(stages[0].bossActiveCap, 1);
  assert(!Object.hasOwn(stages[0], 'bossTriggers'));
});
check('Second chapter introduces the old and new bosses no earlier than 65 and 110 seconds', () => {
  assert.deepEqual(Array.from(stages[1].bossIds), [1, 2]);
  assert.deepEqual(Array.from(stages[1].bossSchedule), [65, 110]);
  assert.equal(stages[1].bossActiveCap, 1);
});
check('Basic moving fire can clear the first ordinary enemy in two hits', () => {
  assert.equal(Math.ceil(stages[0].slow.hp / 22), 2);
  assert.equal(Math.ceil(stages[0].fast.hp / 22), 2);
  assert(stages[0].initialPursuers <= 20);
  assert(stages[0].eliteFirstAt >= 16);
});
check('First boss survives at least ten seconds of naked standing weapon fire', () => {
  const standingDps = 22 * 3 * 1.35 * 1.35;
  assert(bosses[0].hp / standingDps >= 10);
  assert(bosses[0].hp / standingDps <= 20);
});
for (const stage of stages.slice(0, 20)) {
  const boss = bosses[stage.id - 1];
  check(`Chapter ${stage.id}: the fixed roster and exact thirty-choice XP budget remain intact`, () => {
    assert.equal(stage.normalCount, 398);
    assert.equal(stage.eliteCount, 4 + stage.id * 2);
    assert.equal(stage.bossCount, stage.id);
    assert.equal(stage.enemyCount, stage.normalCount + stage.eliteCount + stage.bossCount);
    assert.deepEqual(Array.from(stage.bossIds), Array.from({ length: stage.id }, (_, i) => i + 1));
    assert.equal(stage.xpRewards.length, stage.enemyCount);
    assert(stage.xpRewards.every(xp => Number.isInteger(xp) && xp > 0));
    assert.equal(stage.xpRewards.reduce((sum, xp) => sum + xp, 0), 10000);
    assert.equal(stage.experience.choices, 30);
    assert.equal(stage.experience.levelCap, 31);
    assert(Object.isFrozen(stage));
  });
  check(`Chapter ${stage.id}: slower ordinary and elite enemies preserve a movement escape`, () => {
    assert(stage.fast.speed < 205);
    assert(stage.slow.speed < stage.fast.speed);
    assert(stage.elite.speed < stage.fast.speed);
    assert(stage.slow.damage < 110 / 3);
    assert(stage.fast.damage < stage.slow.damage);
    assert(stage.elite.hp > stage.slow.hp && stage.elite.damage > stage.slow.damage);
    assert(stage.initialPursuers >= 20 && stage.initialPursuers <= 36);
    assert(stage.batchSize >= 20 && stage.batchSize <= 32);
    assert(stage.pursuitInterval >= 7 && stage.pursuitInterval <= 10);
  });
  check(`Chapter ${stage.id}: elite pressure starts after ordinary-only movement practice`, () => {
    assert(stage.eliteFirstAt >= 12 && stage.eliteFirstAt <= 16);
    assert(stage.eliteFirstAt > stage.pursuitInterval);
    assert(stage.eliteInterval >= 6.6 && stage.eliteInterval <= 8.8);
    assert(stage.eliteBatchSize >= 1 && stage.eliteBatchSize <= 3);
    const lastAt = stage.eliteFirstAt + Math.floor((stage.eliteCount - 1) / stage.eliteBatchSize) * stage.eliteInterval;
    assert(lastAt >= 50 && lastAt <= 150, `Elites remain staggered, last at ${lastAt}`);
    assert(stage.eliteFirstAt < stage.bossSchedule[0]);
  });
  check(`Chapter ${stage.id}: bosses wait for growth and arrive one at a time with a recovery window`, () => {
    assert.equal(stage.bossSchedule.length, stage.bossCount);
    assert(Object.isFrozen(stage.bossSchedule));
    assert(stage.bossSchedule[0] >= 60 && stage.bossSchedule[0] <= 65);
    assert.equal(stage.bossActiveCap, 1);
    assert.equal(stage.bossRecovery, 12);
    for (let i = 0; i < stage.bossSchedule.length; i++) {
      const at = stage.bossSchedule[i];
      assert(Number.isFinite(at) && at >= 60);
      if (i) {
        const gap = at - stage.bossSchedule[i - 1];
        assert(gap >= 22 && gap <= 45, `Boss interval is ${gap}`);
      }
    }
    assert(!Object.hasOwn(stage, 'bossTriggers'), 'Boss time eligibility must not depend on killing ordinary enemies');
  });
  check(`Chapter ${stage.id}: new boss health, speed, contact damage and charges stay in playable paper bounds`, () => {
    assert.equal(boss.stageId, stage.id);
    assert(boss.hp >= 1600 && boss.hp <= 8500);
    assert(boss.speed < 205);
    assert(boss.damage <= 110 / 2, 'Unarmored full-health heroes survive two contacts');
    assert(boss.chargeSpeed >= 250 && boss.chargeSpeed <= 326);
    assert(boss.chargeInterval >= 4.8 && boss.chargeInterval <= 7);
    // Assumed effective focused output, after movement / swarm target splitting.
    // This checks a design envelope; it is not a measured live-browser win rate.
    const effectiveDps = 140 + (stage.id - 1) * 240 / 19;
    const expectedSeconds = boss.hp / effectiveDps;
    assert(expectedSeconds >= 10 && expectedSeconds <= 30, `Paper fight length ${expectedSeconds}`);
  });
  if (stage.id > 1) {
    const previous = stages[stage.id - 2], previousBoss = bosses[stage.id - 2];
    check(`Chapter ${stage.id}: pressure grows smoothly instead of a health or damage jump`, () => {
      for (const type of ['slow', 'fast', 'elite']) {
        assert(stage[type].hp >= previous[type].hp);
        assert(stage[type].hp / previous[type].hp <= 1.2);
        assert(stage[type].damage >= previous[type].damage);
        assert(stage[type].speed >= previous[type].speed);
      }
      assert(boss.hp > previousBoss.hp && boss.hp / previousBoss.hp <= 1.2);
      assert(boss.damage >= previousBoss.damage);
      assert(stage.bossInterval <= previous.bossInterval);
    });
  }
}
check('Late bosses remain serial instead of compressing all twenty arrivals into the opening', () => {
  assert.equal(stages[19].bossSchedule[19], 478);
  assert(stages[19].bossSchedule[19] > 180);
});
check('Fully raised residents add useful but bounded permanent offensive bonuses', () => {
  let damage = 0, rate = 0;
  for (const rescue of rescues) {
    assert(rescue.bonusPerLevel > 0);
    if (rescue.bonusType === 'damage') damage += rescue.bonusPerLevel * 6;
    if (rescue.bonusType === 'rate') rate += rescue.bonusPerLevel * 6;
  }
  assert(damage <= .15 && rate <= .13);
});
console.log(`${checks} encounter schedule and pressure checks passed.`);
