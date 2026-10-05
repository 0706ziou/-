// Verify the actual runtime: progressive XP, retained growth and fair, labeled roulette.
const assert = require('node:assert/strict');
const { createGame, quietField, clearStage } = require('./verify.cjs');
let count = 0;
function check(name, fn) { fn(); console.log('PASS ' + name); count++; }
function campaign(id = 1) {
  const game = createGame(); game.t.profile.unlockedStage = 100;
  game.t.selectStage(id); game.t.start(); quietField(game.t); game.t.player.inv = 1e9;
  return game;
}
check('XP costs are convex through campaign and endless, without encoding the example seconds', () => {
  const { t } = campaign(), xp = t.experience;
  assert.deepEqual([1,2,3,4,5].map(xp.need), [140,197,262,335,416]);
  let priorDifference = 0;
  for (let level = 2; level <= 100; level++) {
    const difference = xp.need(level) - xp.need(level-1);
    assert(difference > priorDifference); priorDifference = difference;
    assert(xp.interval(level) >= xp.interval(level-1)); assert(xp.interval(level) <= 8);
  }
  for (const bad of [NaN,Infinity,-Infinity,0,-1,'bad']) assert.equal(xp.need(bad),140);
  // At a steady reference collection rate the levels get slower by costs, not forced timers.
  const waits = Array.from({length:15},(_,i)=>xp.need(i+1)/xp.referenceXPPerSecond);
  for(let i=1;i<waits.length;i++) assert(waits[i]>waits[i-1]);
  assert.notDeepEqual(waits.slice(0,3),[3,5,7]);
});
check('Beginner budgets stay fixed while their ordinary XP popup count falls', () => {
  const {t}=campaign();
  assert.deepEqual(Array.from(t.stages.slice(0,3),s=>s.experience.budget),[4536,4560,8518]);
  assert.deepEqual(Array.from(t.stages.slice(0,3),s=>s.experience.choices),[9,9,12]);
  for(const stage of t.stages){
    let bank=stage.experience.budget,choices=0;
    while(bank>=t.experience.need(choices+1))bank-=t.experience.need(++choices);
    assert.equal(choices,stage.experience.choices);assert(choices>=8&&choices<=14);
  }
});
check('Anti-popup gate retains XP and resets correctly, across beginner and late stages', () => {
  for (const id of [1,2,3,20,100]) {
    const {t,element}=campaign(id),xp=t.experience;
    const bank=xp.need(1)+xp.need(2)+xp.need(3);t.player.xp=bank;
    t.elapsed=xp.interval(1)-.001;t.update(0);
    assert.equal(t.state,'playing');assert.equal(t.player.xp,bank);assert(element('xpText').textContent.includes('待选'));
    let next=xp.interval(1);
    for(let level=1;level<=3;level++){
      t.elapsed=next;t.update(0);assert.equal(t.state,'upgrade');
      t.choose(level-1);assert.equal(t.state,'playing');assert.equal(t.player.level,level+1);
      next+=xp.interval(level+1);
      t.elapsed=next-.001;t.update(0);assert.equal(t.state,'playing');
    }
    assert.equal(t.player.xp,0);t.start();quietField(t);t.player.xp=t.player.need;t.update(0);
    assert.equal(t.state,'playing');assert.equal(t.elapsed,0);assert.equal(t.player.level,1);
  }
});
check('Actual high-bonus kill credits the ledger once and cannot interrupt entry', () => {
  const game=createGame(),{t}=game;t.start();const victim=t.enemies.find(e=>!e.boss&&!e.elite&&e.type===1);
  quietField(t);t.player.inv=1e9;t.player.xpMult=2.8;
  victim.hp=0;victim.x=t.player.x;victim.y=t.player.y;t.enemies.push(victim);t.update(.001);
  const bank=t.player.xp,ledger=JSON.stringify(t.stageXP.snapshot());assert(bank>=t.player.need);assert.equal(t.state,'playing');
  t.update(.001);assert.equal(t.player.xp,bank);assert.equal(JSON.stringify(t.stageXP.snapshot()),ledger);
  t.elapsed=t.experience.interval(1);t.update(0);assert.equal(t.state,'upgrade');t.choose(0);
  assert.equal(t.state,'playing');assert.equal(JSON.stringify(t.stageXP.snapshot()),ledger);
});
check('Pause, help and upgrade overlays do not consume the breathing window', () => {
  const {t}=campaign();t.player.xp=t.player.need*4;t.elapsed=1;t.frame(1000);t.pause();
  const at=t.elapsed;t.frame(100000);assert.equal(t.elapsed,at);t.openGameHelp();t.frame(200000);assert.equal(t.elapsed,at);
  t.closeGameHelp();t.resume();t.elapsed=t.experience.interval(1);t.update(0);assert.equal(t.state,'upgrade');
  const upgradedAt=t.elapsed;t.frame(300000);assert.equal(t.elapsed,upgradedAt);t.choose(0);t.update(0);assert.equal(t.state,'playing');
  t.elapsed+=t.experience.interval(2);t.update(0);assert.equal(t.state,'upgrade');
});
check('Wheel labels, pointer landing, receipt, lock and actual single/triple rewards agree', () => {
  for(const boss of [false,true]){
    const game=createGame(),{t,element}=game;t.start();const victim=t.enemies.find(e=>boss?e.boss:e.elite);
    quietField(t);victim.hp=0;t.enemies.push(victim);t.update(0);assert.equal(t.state,'roulette');
    const initial=element('overlay').innerHTML;assert.equal((initial.match(/class="wheel-name"/g)||[]).length,6);
    assert(initial.includes('wheel-pointer'));assert(initial.includes('本次收获'));
    const before=t.player.build.attackChoices+t.player.build.attributeChoices,level=t.player.level;
    element('spinReward').onclick();const expected=boss?3:1;
    assert.equal(t.player.build.attackChoices+t.player.build.attributeChoices,before+expected);
    assert.equal(t.player.level,level);assert.equal(t.player.xp,0);
    const svg=element('rewardWheel').innerHTML;
    const ids=[...svg.matchAll(/data-reward-id="([^"]+)"/g)].map(m=>m[1]);
    const rotation=parseFloat(element('rewardWheel').style.transform.slice(7));
    const index=Math.round(((360-rotation%360)%360)/60),landed=t.builds.get(ids[index]);
    assert(landed);assert(element('wheelResults').innerHTML.includes(landed.name));
    assert.equal((element('wheelResults').innerHTML.match(/class="wheel-reward"/g)||[]).length,expected);
    element('spinReward').onclick();assert.equal(t.state,'roulette');
    assert.equal(t.player.build.attackChoices+t.player.build.attributeChoices,before+expected);
    t.rouletteTick(1);assert.equal(element('spinReward').disabled,true);
    t.rouletteTick(1);assert(element('wheelResults').classList.contains('is-revealed'));
    element('spinReward').onclick();assert.equal(t.state,'playing');
    assert(!element('spinReward').textContent.includes('转动中'));
  }
});
check('A completed build displays healing sectors and each wheel reward heals only once', () => {
  const game=createGame(),{t,element}=game;t.start();const elite=t.enemies.find(e=>e.elite);quietField(t);
  for(const id of ['damage','rate','shots','chain','speed','hp','pickup','range'])for(let i=0;i<5;i++)t.builds.choose(t.player,id);
  assert.equal(t.builds.pool(t.player).length,0);t.player.hp=1;const hp=1+t.player.maxHp*.25;
  elite.hp=0;t.enemies.push(elite);t.update(0);assert(element('overlay').innerHTML.includes('生命补给'));
  element('spinReward').onclick();assert.equal(t.player.hp,hp);
  element('spinReward').onclick();assert.equal(t.player.hp,hp);t.rouletteTick(2);element('spinReward').onclick();assert.equal(t.player.hp,hp);
});
check('Stage settlement and endless entry resolve retained XP without a long forced timer', () => {
  const game=createGame(),{t,element}=game;t.start();clearStage(t);assert(t.startEndless());
  for(let i=0;i<500&&['roulette','upgrade'].includes(t.state);i++){
    if(t.state==='roulette'){element('spinReward').onclick();t.rouletteTick(2);element('spinReward').onclick();}else t.choose(0);
  }
  assert.equal(t.state,'playing');assert.equal(t.elapsed,0);assert.equal(t.player.level,t.activeStage.experience.choices+1);
});
console.log(`${count} growth and roulette checks passed.`);
