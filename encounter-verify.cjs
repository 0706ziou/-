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
check('Opening chapters each schedule one corresponding boss at sixty seconds when small bugs remain', () => {
  for (const stage of stages.slice(0, 3)) {
    assert.deepEqual(Array.from(stage.bossIds), [stage.id]);
    assert.deepEqual(Array.from(stage.bossSchedule), [60]);
    assert.equal(stage.bossCount, 1);
    assert.equal(stage.bossActiveCap, 1);
  }
});
check('First chapter retains its scheduled eligibility and single-boss cap', () => {
  assert.deepEqual(Array.from(stages[0].bossSchedule), [60]);
  assert.equal(stages[0].bossActiveCap, 1);
  assert(!Object.hasOwn(stages[0], 'bossTriggers'));
});
check('Basic moving fire clears opening ordinary enemies within two hits', () => {
  for (const stage of stages.slice(0, 3)) {
    assert(Math.ceil(stage.slow.hp / 22) <= 2);
    assert(Math.ceil(stage.fast.hp / 22) <= 2);
  }
  assert(stages[0].initialPursuers <= 20);
  assert(stages[0].eliteFirstAt >= 16);
});
check('Opening boss base health and disclosed arrival guard fit a readable beginner encounter', () => {
  const standingDps = 22 * 3 * 1.35 * 1.35;
  for (const stage of stages.slice(0, 3)) {
    const beginner = stage.beginner;
    assert(Object.isFrozen(beginner));
    assert(beginner.bossHp >= 900 && beginner.bossHp <= 1800);
    assert(beginner.bossTargetSeconds >= 8 && beginner.bossTargetSeconds <= 12);
    assert(beginner.arrivalGuard >= 1 && beginner.arrivalGuard <= 2);
    assert(beginner.bossHp / standingDps >= 7 && beginner.bossHp / standingDps <= 15);
    assert(stage.description.includes('护壳') && stage.description.includes('减伤90%'));
    assert(stage.description.includes('小怪清空则立即到达'));
  }
});
for (const stage of stages.slice(0, 20)) {
  const sourceBoss = bosses[stage.id - 1], opening = !!stage.beginner;
  const boss = opening ? { ...sourceBoss, hp: stage.beginner.bossHp, speed: stage.beginner.bossSpeed,
    damage: stage.beginner.bossDamage, chargeSpeed: stage.beginner.chargeSpeed, chargeInterval: stage.beginner.chargeInterval } : sourceBoss;
  check(`Chapter ${stage.id}: the fixed roster and exact thirty-choice XP budget remain intact`, () => {
    assert.equal(stage.normalCount, opening ? 48 + stage.id * 24 : 398);
    assert.equal(stage.eliteCount, opening ? stage.id : 4 + stage.id * 2);
    assert.equal(stage.bossCount, opening ? 1 : stage.id);
    assert.equal(stage.enemyCount, stage.normalCount + stage.eliteCount + stage.bossCount);
    assert.deepEqual(Array.from(stage.bossIds), opening ? [stage.id] : Array.from({ length: stage.id }, (_, i) => i + 1));
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
    assert(opening ? stage.fast.damage <= stage.slow.damage : stage.fast.damage < stage.slow.damage);
    assert(stage.elite.hp > stage.slow.hp && stage.elite.damage > stage.slow.damage);
    assert(stage.initialPursuers >= (opening ? 6 : 20) && stage.initialPursuers <= (opening ? 10 : 36));
    assert(stage.batchSize >= (opening ? 10 : 20) && stage.batchSize <= (opening ? 14 : 32));
    assert(stage.pursuitInterval >= (opening ? 5 : 7) && stage.pursuitInterval <= (opening ? 5 : 10));
  });
  check(`Chapter ${stage.id}: elite pressure starts after ordinary-only movement practice`, () => {
    assert(stage.eliteFirstAt >= (opening ? 25 : 12) && stage.eliteFirstAt <= (opening ? 25 : 16));
    assert(stage.eliteFirstAt > stage.pursuitInterval);
    assert(stage.eliteInterval >= (opening ? 14 : 6.6) && stage.eliteInterval <= (opening ? 14 : 8.8));
    assert(stage.eliteBatchSize >= 1 && stage.eliteBatchSize <= 3);
    const lastAt = stage.eliteFirstAt + Math.floor((stage.eliteCount - 1) / stage.eliteBatchSize) * stage.eliteInterval;
    assert(lastAt >= (opening ? 25 : 50) && lastAt <= (opening ? 53 : 150), `Elites remain staggered, last at ${lastAt}`);
    assert(stage.eliteFirstAt < stage.bossSchedule[0]);
  });
  check(`Chapter ${stage.id}: time eligibility and recovery remain configured for a field with surviving small bugs`, () => {
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
  });
  check(`Chapter ${stage.id}: new boss health, speed, contact damage and charges stay in playable paper bounds`, () => {
    assert.equal(boss.stageId, stage.id);
    assert(boss.hp >= (opening ? 900 : 1600) && boss.hp <= 8500);
    assert(boss.speed < 205);
    assert(boss.damage <= 110 / 2, 'Unarmored full-health heroes survive two contacts');
    assert(boss.chargeSpeed >= (opening ? 115 : 250) && boss.chargeSpeed <= (opening ? 135 : 326));
    assert(boss.chargeInterval >= (opening ? 8 : 4.8) && boss.chargeInterval <= (opening ? 8 : 7));
    // Assumed effective focused output, after movement / swarm target splitting.
    // This checks a design envelope; it is not a measured live-browser win rate.
    const effectiveDps = opening ? 22 * 3 * 1.35 * 1.35 : 140 + (stage.id - 1) * 240 / 19;
    const expectedSeconds = boss.hp / effectiveDps;
    assert(expectedSeconds >= (opening ? 7 : 10) && expectedSeconds <= (opening ? 15 : 30), `Paper fight length ${expectedSeconds}`);
  });
  if (stage.id > 1 && stage.id !== 4) {
    const previous = stages[stage.id - 2], previousSourceBoss = bosses[stage.id - 2];
    const previousBoss = opening ? { ...previousSourceBoss, hp: previous.beginner.bossHp, damage: previous.beginner.bossDamage } : previousSourceBoss;
    check(`Chapter ${stage.id}: pressure grows smoothly instead of a health or damage jump`, () => {
      for (const type of ['slow', 'fast', 'elite']) {
        assert(stage[type].hp >= previous[type].hp);
        assert(stage[type].hp / previous[type].hp <= (opening ? 1.5 : 1.2));
        assert(stage[type].damage >= previous[type].damage);
        assert(stage[type].speed >= previous[type].speed);
      }
      assert(boss.hp > previousBoss.hp && boss.hp / previousBoss.hp <= (opening ? 1.5 : 1.2));
      assert(boss.damage >= previousBoss.damage);
      assert(stage.bossInterval <= previous.bossInterval);
    });
  }
}
check('Fourth chapter deliberately starts the full roster after three gentle opening stages', () => {
  assert(stages.slice(0, 3).every(stage => stage.beginner));
  assert(stages.slice(3).every(stage => !stage.beginner));
  assert.equal(stages[3].normalCount, 398);
  assert(stages[3].slow.hp / stages[2].slow.hp <= 2.2);
  assert(stages[3].fast.speed < 205);
});
check('Late boss schedules retain a serialized queue before the small-bug clear override applies', () => {
  assert.equal(stages[19].bossSchedule[19], 478);
  assert(stages[19].bossSchedule[19] > 180);
});
check('All hundred chapters have unique identities and matching boss and rescued-spirit coverage', () => {
  assert.equal(stages.length, 100);assert.equal(bosses.length, 100);assert.equal(rescues.length, 100);
  assert.equal(new Set(stages.map(stage => stage.name)).size, 100);
  assert.equal(new Set(bosses.map(boss => boss.name)).size, 100);
  assert.equal(new Set(rescues.map(rescue => rescue.name)).size, 100);
  for (const stage of stages) {
    assert.equal(bosses[stage.id - 1].stageId, stage.id);
    assert.equal(rescues[stage.id - 1].id, stage.id);
  }
});
for (const stage of stages.slice(20)) {
  check(`Chapter ${stage.id}: bounded late roster, exact XP, serial eligibility and movement escapes persist`, () => {
    assert.equal(stage.normalCount, 398);
    assert(stage.eliteCount >= 45 && stage.eliteCount <= 64);
    assert(stage.bossCount >= 5 && stage.bossCount <= 10);
    assert.equal(stage.bossIds.length, stage.bossCount);
    assert.equal(new Set(stage.bossIds).size, stage.bossCount);
    assert.equal(stage.bossIds.at(-1), stage.id);
    assert(stage.bossIds.every(id => bosses[id - 1]?.stageId === id));
    assert.equal(stage.enemyCount, stage.normalCount + stage.eliteCount + stage.bossCount);
    assert.equal(stage.xpRewards.length, stage.enemyCount);
    assert(stage.xpRewards.every(xp => Number.isInteger(xp) && xp > 0));
    assert.equal(stage.xpRewards.reduce((sum, xp) => sum + xp, 0), 10000);
    assert.equal(stage.experience.choices, 30);assert.equal(stage.experience.levelCap, 31);
    assert.equal(stage.bossActiveCap, 1);assert.equal(stage.bossRecovery, 12);
    assert.equal(stage.bossSchedule[0], 60);
    assert.equal(stage.bossSchedule.length, stage.bossCount);
    for (let i = 1; i < stage.bossSchedule.length; i++) assert(stage.bossSchedule[i] - stage.bossSchedule[i - 1] >= 22);
    assert(stage.fast.speed < 205 && stage.slow.speed < stage.fast.speed && stage.elite.speed < stage.fast.speed);
    assert(stage.fast.damage < stage.slow.damage);
    const previous = stages[stage.id - 2];
    for (const type of ['slow', 'fast', 'elite']) {
      assert(stage[type].hp >= previous[type].hp);assert(stage[type].hp / previous[type].hp <= 1.04);
      assert(stage[type].damage >= previous[type].damage);
    }
    assert(bosses[stage.id - 1].speed < 205);
    assert(bosses[stage.id - 1].hp >= bosses[stage.id - 2].hp);
  });
}
check('The first twenty fully raised residents retain their original bounded offensive bonuses', () => {
  let damage = 0, rate = 0;
  for (const rescue of rescues.slice(0, 20)) {
    assert(rescue.bonusPerLevel > 0);
    if (rescue.bonusType === 'damage') damage += rescue.bonusPerLevel * 6;
    if (rescue.bonusType === 'rate') rate += rescue.bonusPerLevel * 6;
  }
  assert(damage <= .15 && rate <= .13);
});
check('All hundred fully raised residents provide useful bounded cumulative offensive bonuses', () => {
  let damage = 0, rate = 0;
  for (const rescue of rescues) {
    assert(Number.isFinite(rescue.bonusPerLevel) && rescue.bonusPerLevel > 0);
    if (rescue.bonusType === 'damage') damage += rescue.bonusPerLevel * 6;
    if (rescue.bonusType === 'rate') rate += rescue.bonusPerLevel * 6;
  }
  assert(damage > .15 && damage <= .45);
  assert(rate > .13 && rate <= .4);
});
console.log(`${checks} encounter schedule and pressure checks passed.`);
