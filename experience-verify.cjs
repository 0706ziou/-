const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const sandbox = { window: {} }; vm.createContext(sandbox);
for (const file of ['experience-data.js', 'progression.js']) vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox);
const xp = sandbox.window.ORCHARD_EXPERIENCE, stages = sandbox.window.ORCHARD_STAGES;
for (const stage of stages) {
  const rewards = stage.xpRewards, total = rewards.reduce((a,b) => a+b,0);
  assert.deepEqual(Array.from(xp.assign(stage)), Array.from(rewards));
  assert(rewards.slice(0,stage.normalCount).every(n => n > 0));
  assert(rewards.slice(stage.normalCount).every(n => n === 0));
  assert.equal(stage.experience.budget,total); assert(total < 10000);
  let level = 1, remainder = total; while (remainder >= xp.need(level)) { remainder -= xp.need(level++); }
  assert.equal(stage.experience.choices, level-1);
  for (const multiplier of [1,1.2,2.8]) {
    const ledger = xp.create(stage);
    rewards.forEach((value,index) => {
      const granted = ledger.grant(value,multiplier,index);
      assert.equal(ledger.grant(value,multiplier,index),0);
      assert.equal(ledger.collect(granted,index),granted);
      assert.equal(ledger.collect(granted,index),0);
    });
    assert.equal(ledger.issued,total); assert.equal(ledger.collected,total);
    assert.equal(ledger.finish(),0); assert.equal(ledger.finish(),0);
    assert.equal(ledger.grant(999,2,'late'),0);
  }
  if (stage.id <= 2) {
    assert(stage.experience.choices <= 19);
    assert(rewards.slice(0,2).reduce((a,b)=>a+b,0) < xp.need(1));
  }
}
// Exercise the shipped UI handler, including its labeled wheel and animation lock.
const {createGame, quietField} = require('./verify.cjs');
for (const count of [1,3]) {
  const game=createGame(),{t,element}=game;t.start();
  const victim=t.enemies.find(e=>count===3?e.boss:e.elite);quietField(t);
  victim.hp=0;t.enemies.push(victim);t.update(0);assert.equal(t.state,'roulette');
  const before=t.player.build.attackChoices+t.player.build.attributeChoices;
  assert(element('overlay').innerHTML.includes('wheel-name'));
  element('spinReward').onclick();
  assert.equal(t.player.build.attackChoices+t.player.build.attributeChoices,before+count);
  assert.equal(t.player.xp,0);assert.equal(t.player.level,1);
  element('spinReward').onclick();assert.equal(t.state,'roulette');
  t.rouletteTick(2);element('spinReward').onclick();assert.equal(t.state,'playing');
}
console.log('PASS: 100关固定经验账本、递增升级曲线及精英/Boss真实轮盘奖励');
