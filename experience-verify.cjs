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
// Execute the actual roulette handler with deterministic UI and build mocks.
const game = fs.readFileSync('game.js','utf8');
const handler = game.slice(game.indexOf('  function openRoulette() {'),game.indexOf('  function upgrade() {'));
for (const count of [1,3]) {
  const elements = { spinReward: {}, rewardWheel: {style:{}}, wheelResults: {} };
  let applied = 0, completed = 0;
  const context = { rouletteQueue: [{count,boss:count===3}], state:'playing', keys:new Set(), pointer:null,
    player: {xp:0,need:180,maxHp:100,build:{levels:{}}},
    el:id=>elements[id], showPanel:()=>{}, updateHUD:()=>{}, escapeHTML:s=>s,
    overlay:{classList:{add:()=>{}}}, rarities:[{name:'普通',mult:1}],
    builds:{pool:()=>[{id:'test',name:'词条'}],choose:(p,id)=>{applied++;p.build.levels[id]=applied;return {applied:true,newSuper:[]};}},
    healPlayer:()=>{}, queueNotice:()=>{}, upgrade:()=>{throw Error('No XP upgrades');},
    checkStageCompletion:()=>{completed++;}
  };
  vm.createContext(context); vm.runInContext(handler+';openRoulette();',context);
  assert.equal(context.state,'roulette'); elements.spinReward.onclick(); assert.equal(applied,count);
  assert.equal(context.player.xp,0); assert.equal(context.player.level,undefined);
  elements.spinReward.onclick(); assert.equal(context.state,'playing'); assert.equal(completed,1);
}
console.log('PASS: 100关经验账本、前两关节奏、精英单抽及Boss三连抽');
