'use strict';
// Regression checks for earned XP collection, reward sequencing and useful loss feedback.
const assert = require('node:assert/strict');
const {createGame, quietField, clearStage, enemy, drainUpgradeChoices} = require('../verify.cjs');
let checks = 0;
function check(name, run) { run(); checks++; console.log('PASS ' + name); }
function game(id = 4) {
  const g = createGame(); g.t.profile.unlockedStage = 100; g.t.selectStage(id); g.t.start();
  g.t.player.inv = 1e9; g.t.shotClock = Infinity; return g;
}
function eliteWheel(g) {
  const elite = g.t.enemies.find(e => e.elite); assert(elite); elite.hp = 0; g.t.update(0);
  assert.equal(g.t.state, 'roulette');
}
const choices = t => t.builds.summary(t.player).totalChoices;
check('First-ten collection assistance only moves earned nearby drops and preserves the XP reserve', () => {
  for(const id of [1,3,4,10,11]) {
    const {t} = game(id), victim = t.enemies.find(e => !e.boss && !e.elite);
    quietField(t); victim.x = t.player.x + 300; victim.y = t.player.y; victim.hp = 0;
    t.enemies.push(victim); t.update(.01); const gem = t.gems[0], at = gem.x;
    const issued = t.stageXP.issued; t.update(.1);
    assert.equal(t.runStats.experienceDropped,issued);
    assert.equal(gem.x < at, id <= 10); assert.equal(t.stageXP.issued, issued);
    assert.equal(t.stageXP.collected,0); assert.equal(t.runStats.experienceCollected,0);
    assert(t.stageXP.issued <= t.activeStage.experience.budget);
  }
});
check('Recurring attraction collects nearby earned XP after the first level, leaves distant XP and freezes in pause', () => {
  for(const id of [4,11]) {
    const g = game(id), t = g.t, nearby = t.enemies.find(e => !e.boss && !e.elite), far = t.enemies.find(e => !e.boss && !e.elite && e !== nearby);
    quietField(t); t.player.level = 2; t.player.need = t.experienceNeed(2);
    nearby.x = t.player.x + (id <= 10 ? 800 : 600); nearby.y = t.player.y; nearby.hp = 0;
    far.x = t.player.x + 1400; far.y = t.player.y; far.hp = 0; t.enemies.push(nearby,far); t.update(.01);
    const nearGem = t.gems[0], farGem = t.gems[1], nearAt = nearGem.x, farAt = farGem.x;
    const issued = t.stageXP.issued, budget = t.activeStage.experience.budget, pulse = id <= 10 ? 20 : 30;
    t.elapsed = pulse - .1; t.update(.04); assert.equal(nearGem.x, nearAt);
    t.pause(); const at = t.elapsed; for(let i=0;i<200;i++)t.frame(1000+i*40);
    assert.equal(t.elapsed, at); assert.equal(nearGem.x, nearAt); t.resume();
    t.elapsed = pulse - .01; t.update(.02); assert(nearGem.x < nearAt); assert(g.element('xpGuide').textContent.includes('晨露吸附'));
    assert(g.element('lootTickerTitle').textContent.includes('经验拾取 · 晨露吸附'));
    for(let i=0;i<80;i++)t.update(.04);
    assert(!t.gems.includes(nearGem)); assert.equal(farGem.x, farAt);
    assert.equal(t.stageXP.issued, issued); assert.equal(t.activeStage.experience.budget, budget);
    assert.equal(t.runStats.experienceDropped,issued);
    assert.equal(t.stageXP.collected,nearGem.value); assert.equal(t.runStats.experienceCollected,nearGem.value);
    t.elapsed = pulse + 4; const before = farGem.x; t.update(.04); assert.equal(farGem.x,before);
  }
});
check('Quick reveal skips the animation and cannot redraw even through stale or repeated handlers', () => {
  const g = game(), t = g.t; eliteWheel(g);
  assert(!g.element('overlay').innerHTML.includes('id="autoContinueReward" checked'));
  const spin = g.element('spinReward').onclick, quick = g.element('quickReward').onclick, before = choices(t);
  quick(); assert.equal(choices(t),before+1); assert(g.element('wheelResults').classList.contains('is-revealed'));
  assert.equal(g.element('spinReward').disabled,false); quick(); spin(); assert.equal(choices(t),before+1);
  const accept = g.element('spinReward').onclick; accept(); assert.equal(t.state,'playing');
  eliteWheel(g); const next = choices(t); accept(); quick(); spin(); assert.equal(t.state,'roulette'); assert.equal(choices(t),next);
  g.element('spinReward').onclick(); assert.equal(choices(t),next+1); assert(g.element('spinReward').disabled);
  g.element('quickReward').onclick(); assert(g.element('wheelResults').classList.contains('is-revealed'));
  assert.equal(choices(t),next+1);
});
check('Opt-in automatic wheels freeze in hidden tabs, can be cancelled and retain readable reward time', () => {
  const g = game(), t = g.t; eliteWheel(g); const before = choices(t);
  const auto = g.element('autoContinueReward'); auto.checked = true; auto.onchange();
  assert.equal(choices(t),before+1); t.rouletteTick(2); assert.equal(t.state,'roulette');
  const battleTime = t.elapsed; g.document.hidden = true;
  for(let i=0;i<200;i++)t.frame(1000+i*40);
  assert.equal(t.state,'roulette'); assert.equal(t.elapsed,battleTime);
  g.document.hidden = false; t.rouletteTick(1.5); assert.equal(t.state,'roulette');
  auto.checked = false; auto.onchange(); t.rouletteTick(10); assert.equal(t.state,'roulette');
  assert(!g.element('wheelStatus').textContent.includes('自动继续'));
  auto.checked = true; auto.onchange(); t.rouletteTick(1.99); assert.equal(t.state,'roulette');
  t.rouletteTick(.02); assert.equal(t.state,'playing'); assert.equal(choices(t),before+1);
  eliteWheel(g); assert.equal(choices(t),before+2); assert(g.element('overlay').innerHTML.includes('id="autoContinueReward" checked'));
  t.acceptAccount({id:'second',nickname:'第二位测试者'}); t.profile.unlockedStage=4; t.selectStage(4); t.start(); eliteWheel(g);
  assert(!g.element('overlay').innerHTML.includes('id="autoContinueReward" checked')); assert.equal(choices(t),0);
});
check('Every final boss pays three picks before rescue; subsequent endless entry cannot pay it again', () => {
  for(const id of [1,4,10,20,100]) {
    const g = game(id), t = g.t; clearStage(t);
    assert.equal(t.runStats.bossRewards,t.activeStage.bossCount*3);
    assert.equal(t.runStats.eliteRewards,t.activeStage.eliteCount);
    const paid = t.runStats.bossRewards; assert(g.element('overlay').innerHTML.includes('虫王奖励'));
    t.gems=[]; t.player.xp=0; const before = choices(t); assert(t.startEndless());
    assert.notEqual(t.state,'roulette'); assert.equal(choices(t),before);
    drainUpgradeChoices(t); assert.equal(t.runStats.bossRewards,0); assert(paid>0);
  }
});
check('Damage feedback excludes shields and dodge, counts actual lost health after defense and includes the lethal hit', () => {
  const g = game(), t = g.t; quietField(t); t.player.inv=0; t.player.defense=10; t.player.shield=1;
  const attacker = enemy(t.player.x,t.player.y,{damage:30}); t.enemies.push(attacker); t.update(0);
  assert.equal(Object.keys(t.runStats.damage).length,0);
  t.player.inv=0; t.player.dodge=1; t.update(0); assert.equal(Object.keys(t.runStats.damage).length,0);
  t.player.inv=0; t.player.dodge=0; const health=t.player.hp; t.update(0);
  assert.equal(t.player.hp,health-20); assert.equal(t.runStats.damage.normal,20);
  t.player.inv=0; t.player.hp=3; attacker.type=1; t.update(0);
  assert.equal(t.state,'ended'); assert.equal(t.runStats.damage.fast,3); assert.equal(t.runStats.lastHit,'fast');
  const html=g.element('overlay').innerHTML;
  assert(html.includes('累计损血 23')); assert(html.includes('普通虫接触（87%）')); assert(html.includes('最后受击：飞虫接触'));
  assert(html.includes('本局移动较少、经验成长不足')); assert(!html.includes('undefined'));
});
check('A lethal charge produces a specific dodge suggestion instead of generic equipment advice', () => {
  const g=game(),t=g.t,boss=t.enemies.find(e=>e.boss); quietField(t);
  Object.assign(boss,{x:t.player.x,y:t.player.y,pursuitAt:0,aggro:true,introduced:true,speed:0,chargeClock:100,dashTime:1,dashX:0,dashY:0,chargeSpeed:0,damage:20});
  t.enemies.push(boss); t.player.hp=5; t.player.defense=0; t.player.inv=0; t.update(0);
  assert.equal(t.state,'ended'); assert.equal(t.runStats.damage.charge,5);
  assert(g.element('overlay').innerHTML.includes('看到冲锋预警先横向移动'));
});
check('XP choices and real hero activations are counted once, and a new attempt clears the previous run', () => {
  const {t}=game(); quietField(t); t.elapsed=3; t.player.xp=t.player.need; t.upgrade(); t.choose(0);
  assert.equal(t.runStats.experienceChoices,1); t.choose(0); assert.equal(t.runStats.experienceChoices,1);
  assert(t.activateHeroSkill()); assert.equal(t.activateHeroSkill(),false); assert.equal(t.runStats.heroUses,1);
  t.start(); assert.equal(t.runStats.experienceChoices,0); assert.equal(t.runStats.heroUses,0); assert.equal(Object.keys(t.runStats.damage).length,0);
});
check('Full builds still count consumed XP levels as healing supplies without inflating chosen build rewards', () => {
  const {t}=game(); quietField(t);
  for(const id of ['damage','rate','shots','chain','speed','hp','pickup','range'])for(let i=0;i<5;i++)assert(t.builds.choose(t.player,id).applied);
  assert.equal(t.builds.pool(t.player).length,0); const before=choices(t),level=t.player.level;
  t.player.xp=t.experienceNeed(level)+t.experienceNeed(level+1); t.upgrade();
  assert.equal(t.player.level,level+2); assert.equal(t.runStats.experienceChoices,2); assert.equal(choices(t),before);
});
console.log(`${checks} run-feedback regression checks passed.`);
