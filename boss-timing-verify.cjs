const assert=require('node:assert/strict');
const {createGame}=require('./verify.cjs');
let checks=0;
function check(name,fn){fn();checks++;console.log('PASS '+name);}
function stageGame(id=6){const g=createGame();g.t.profile.unlockedStage=100;g.t.selectStage(id);g.t.start();g.t.shotClock=Infinity;g.t.player.inv=1e9;return g;}
const active=t=>t.enemies.filter(e=>e.boss&&e.introduced&&e.aggro&&e.hp>0);
function drain(g){for(let i=0;i<500&&['roulette','upgrade'].includes(g.t.state);i++){if(g.t.state==='roulette'){g.element('spinReward').onclick();g.t.rouletteTick(2);g.element('spinReward').onclick();}else g.t.choose(0);}}
check('All 100 stages release each boss at its exact deadline while all earlier bosses remain alive',()=>{
  for(let id=1;id<=100;id++){
    const {t}=stageGame(id),s=t.activeStage;
    assert.equal(s.bossFirstAt,60);assert.equal(s.bossActiveCap,s.bossCount);assert.equal(s.bossRecovery,0);
    for(let i=0;i<s.bossCount;i++){
      t.elapsed=s.bossSchedule[i]-.0001;t.update(0);assert.equal(active(t).length,i);
      t.elapsed=s.bossSchedule[i];t.update(0);assert.equal(active(t).length,i+1);
      assert.equal(t.bossIndex,i+1);assert.equal(t.bossKills,0);assert.equal(t.nonBossKills,0);assert.equal(t.state,'playing');
      assert.deepEqual(Array.from(active(t),e=>e.stageId),Array.from(s.bossIds.slice(0,i+1)));
    }
    const snapshots=active(t).map(e=>({e,hp:e.hp,maxHp:e.maxHp,at:e.strengthAt}));
    t.update(0);assert.equal(t.bossIndex,s.bossCount);
    for(const before of snapshots){assert.equal(before.e.hp,before.hp);assert.equal(before.e.maxHp,before.maxHp);assert.equal(before.e.strengthAt,before.at);}
    const gold=t.profile.seeds;t.start();assert.equal(t.elapsed,0);assert.equal(t.bossIndex,0);assert.equal(active(t).length,0);assert.equal(t.profile.seeds,gold);
  }
});
check('Intervals progress smoothly and keep exact representative end times',()=>{
  const {t}=stageGame(),ss=t.stages;
  for(const s of ss){assert.equal(s.bossSchedule[0],60);for(let i=1;i<s.bossCount;i++)assert.equal(s.bossSchedule[i]-s.bossSchedule[i-1],s.bossInterval);}
  assert.equal(ss[3].bossInterval,42);assert.equal(ss[19].bossInterval,30);assert.equal(ss[20].bossInterval,36);assert.equal(ss[99].bossInterval,30);
  for(const group of [ss.slice(3,20),ss.slice(20)])for(let i=1;i<group.length;i++)assert(group[i].bossInterval<=group[i-1].bossInterval&&group[i-1].bossInterval-group[i].bossInterval<=1);
  assert.deepEqual(Array.from(ss[3].bossSchedule),[60,102]);
  assert.equal(ss[19].bossSchedule.at(-1),630);assert.equal(ss[39].bossSchedule.at(-1),375);assert.equal(ss[99].bossSchedule.at(-1),330);
});
check('Boss kills cannot add recovery time, and clearing ordinary or elite enemies cannot skip time',()=>{
  const g=stageGame(),{t}=g,s=t.activeStage;
  for(const e of t.enemies)if(!e.boss)e.hp=0;t.update(0);drain(g);
  assert.equal(t.bossIndex,0);assert.equal(active(t).length,0);assert.equal(t.readyBoss(),null);
  t.elapsed=s.bossSchedule[0];t.update(0);active(t)[0].hp=0;t.update(0);drain(g);
  assert.equal(t.bossKills,1);assert.equal(active(t).length,0);
  t.elapsed=s.bossSchedule[1]-.0001;t.update(0);assert.equal(t.bossIndex,1);
  t.elapsed=s.bossSchedule[1];t.update(0);assert.equal(t.bossIndex,2);assert.equal(active(t).length,1);
  // Die a frame before the following arrival: the old twelve-second recovery must not block it.
  t.elapsed=s.bossSchedule[2]-.01;active(t)[0].hp=0;t.update(0);drain(g);
  t.elapsed=s.bossSchedule[2];t.update(0);assert.equal(t.bossIndex,3);assert.equal(active(t).length,1);
});
check('Pauses, help, maps, XP choices and reward wheels freeze independent battle time',()=>{
  for(const panel of ['pause','help','map','upgrade','roulette']){
    const g=stageGame(),{t}=g,s=t.activeStage;t.elapsed=s.bossSchedule[1]-1;t.update(0);
    assert.equal(active(t).length,1);
    if(panel==='pause')t.pause();
    if(panel==='help')t.openGameHelp();
    if(panel==='map')t.showRelicMap();
    if(panel==='upgrade'){t.player.xp=t.player.need;t.upgrade();}
    if(panel==='roulette'){t.enemies.find(e=>e.elite).hp=0;t.update(0);assert.equal(t.state,'roulette');}
    const at=t.elapsed;for(let i=0;i<20;i++)t.frame(10000+i*1000);
    assert.equal(t.elapsed,at);assert.equal(active(t).length,1);
    if(panel==='pause')t.resume();if(panel==='help')t.closeGameHelp();if(panel==='map')t.closeRelicMap();if(['upgrade','roulette'].includes(panel))drain(g);
    assert.equal(t.state,'playing');t.elapsed=s.bossSchedule[1];t.update(0);assert.equal(active(t).length,2);
  }
});
check('Catch-up activates all due bosses in the same frame, before an XP menu opens',()=>{
  const {t}=stageGame(20),s=t.activeStage;t.elapsed=s.bossSchedule.at(-1);t.player.xp=t.player.need;
  t.update(0);assert.equal(t.state,'upgrade');assert.equal(active(t).length,20);assert.equal(t.bossIndex,20);
  t.choose(0);assert.equal(t.state,'playing');t.update(0);assert.equal(active(t).length,20);
});
check('HUD retains a countdown with a living boss, displays the latest arrival and tracks extra health bars',()=>{
  const {t,element}=stageGame(6),s=t.activeStage;t.elapsed=60;t.update(0);
  t.elapsed=65;t.update(0);assert(!element('bossForecast').classList.contains('hidden'));
  assert(element('bossForecast').textContent.includes('下一位虫王'));assert(element('bossForecast').textContent.includes('不等击杀'));
  const first=active(t)[0];first.hp-=20;
  t.elapsed=s.bossSchedule[1];t.update(0);const second=active(t)[1];
  assert(element('bossForecast').textContent.includes(second.name));assert(element('bossName').textContent.includes('同场 2 位'));
  assert(element('bossOthers').innerHTML.includes(second.name));assert.equal(first.hp,first.maxHp-20);
  first.hp=0;t.update(0);assert(element('bossName').textContent.includes(second.name));assert(!element('bossOthers').innerHTML.includes(first.name));
});
check('All overlapping bosses must die before rewards settle, and payouts occur only once',()=>{
  const g=stageGame(4),{t}=g,s=t.activeStage;
  for(const e of t.enemies)if(!e.boss)e.hp=0;t.update(0);drain(g);
  t.elapsed=s.bossSchedule.at(-1);t.update(0);assert.equal(active(t).length,s.bossCount);
  for(const e of active(t).slice(0,-1))e.hp=0;t.update(0);drain(g);
  assert.equal(t.state,'playing');assert.equal(t.bossKills,s.bossCount-1);assert.equal(t.profile.seeds,0);
  active(t)[0].hp=0;t.update(0);assert.equal(t.state,'roulette');assert.equal(t.profile.seeds,0);
  drain(g);assert.equal(t.state,'rescue');assert.equal(t.profile.seeds,s.reward.seeds);
  const profile=JSON.stringify(t.profile);t.completeRescue();assert.equal(t.state,'ended');t.completeRescue();assert.equal(JSON.stringify(t.profile),profile);
});
console.log(`${checks} independent Boss schedule checks passed.`);
