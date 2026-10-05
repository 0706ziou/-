const assert=require('node:assert/strict');
const {createGame,quietField}=require('./verify.cjs');
let count=0;function check(name,fn){fn();console.log('PASS '+name);count++;}
function game(stage=4){const g=createGame();g.t.profile.unlockedStage=100;g.t.selectStage(stage);g.t.start();g.t.player.inv=1e9;g.t.shotClock=Infinity;return g;}
check('All stage time curves are monotonic, bounded and milder for elites/bosses',()=>{
  const {t}=game();for(const s of t.stages)for(const kind of ['normal','elite','boss']){
    let hp=1,damage=1;for(const at of [0,20,30,60,120,180,300,600,3600]){
      const m=t.pressure.multipliers(s,at,kind);assert(m.hp>=hp);assert(m.damage>=damage);assert(m.hp<=2.5);assert(m.damage<=1.35);hp=m.hp;damage=m.damage;
      if(kind==='boss')assert(m.hp<=1.8);
    }
    const grace=s.beginner?20:30;assert.equal(t.pressure.multipliers(s,grace,kind).hp,1);
  }
  assert(t.pressure.multipliers(t.stages[0],180).hp<t.pressure.multipliers(t.stages[3],180).hp);
});
check('Later reinforcements gain HP/damage once, retain XP/speed and never refill active HP',()=>{
  const {t}=game();const enemy=t.enemies.find(e=>!e.boss&&!e.elite&&!e.aggro),base={...enemy.baseCombat},xp=enemy.xp,speed=enemy.speed;
  quietField(t);enemy.pursuitAt=60;t.enemies.push(enemy);t.elapsed=60;t.update(0);
  const m=t.pressure.multipliers(t.activeStage,60);assert.equal(enemy.maxHp,Math.ceil(base.hp*m.hp));assert.equal(enemy.hp,enemy.maxHp);
  assert.equal(enemy.damage,Math.round(base.damage*m.damage*10)/10);assert.equal(enemy.xp,xp);assert.equal(enemy.speed,speed);
  enemy.hp-=5;const hp=enemy.hp,max=enemy.maxHp;t.elapsed=300;t.update(0);assert.equal(enemy.hp,hp);assert.equal(enemy.maxHp,max);
  t.applyTimeGrowth(enemy);assert.equal(enemy.hp,hp);
});
check('A later ordinary reinforcement is tougher than an earlier one at the same stage',()=>{
  const {t}=game();const early=t.enemies.find(e=>!e.boss&&!e.elite&&!e.aggro&&!e.type);
  const late=t.enemies.find(e=>e!==early&&!e.boss&&!e.elite&&!e.aggro&&!e.type);quietField(t);
  early.pursuitAt=30;late.pursuitAt=180;t.enemies.push(early,late);t.elapsed=30;t.update(0);assert.equal(early.hp,early.baseCombat.hp);
  t.elapsed=180;t.update(0);assert(late.hp>early.hp);assert(late.damage>early.damage);
  assert.equal(early.maxHp,early.baseCombat.hp);
});
check('Boss strength locks on arrival, and the clock cannot scale it repeatedly',()=>{
  const {t}=game();const boss=t.enemies.find(e=>e.boss),base={...boss.baseCombat};t.enemies=t.enemies.filter(e=>!e.boss||e===boss);
  t.elapsed=120;assert(t.announceBossArrival());const m=t.pressure.multipliers(t.activeStage,120,'boss');
  assert.equal(boss.hp,Math.ceil(base.hp*m.hp));assert.equal(boss.maxHp,boss.hp);assert(boss.damage>base.damage);
  boss.hp-=100;const hp=boss.hp;t.elapsed=300;t.update(0);assert.equal(boss.hp,hp);
});
check('Pauses do not awaken or strengthen dormant enemies and fresh starts reset pressure',()=>{
  const {t}=game();const enemy=t.enemies.find(e=>!e.boss&&!e.elite&&!e.aggro);enemy.pursuitAt=60;t.elapsed=50;t.pause();
  const hp=enemy.hp;t.frame(1000);t.frame(200000);assert.equal(t.elapsed,50);assert.equal(enemy.hp,hp);assert(!enemy.aggro);
  t.resume();t.start();assert.equal(t.elapsed,0);for(const e of t.enemies.filter(e=>e.aggro))assert.equal(e.hp,e.baseCombat.hp);
});
console.log(`${count} enemy time-strength checks passed.`);
