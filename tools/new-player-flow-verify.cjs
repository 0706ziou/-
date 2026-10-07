'use strict';
const assert = require('node:assert/strict');
const { createGame, clearStage, click, quietField } = require('../verify.cjs');
let checks = 0;
const check = (name, test) => { test(); checks++; console.log('PASS ' + name); };
check('Fresh accounts keep feature gates; the first clear offers actual cultivation, strengthening and the next stage', () => {
  const g = createGame(new Map(), { tutorial: true }), t = g.t;
  t.skipTraining();
  assert.equal(t.showArmory(), false); assert.equal(t.upgradeSprite(1), false);
  t.start(); clearStage(t);
  assert.equal(g.element('resultGrowth').textContent, '免费培养伙伴');
  assert(!g.element('startEndless').classList.contains('primary'));
  click(g, 'resultGrowth'); assert.equal(t.state, 'orchard');
  const wallet = [t.profile.seeds, t.profile.cores];
  click(g, 'growthNext'); assert.equal(t.profile.spriteLevels[1], 1);
  assert.deepEqual([t.profile.seeds, t.profile.cores], wallet);
  assert(g.element('growthNext').textContent.includes('强化'));
  click(g, 'growthNext'); assert.equal(t.state, 'armory');
  assert(g.element('overlay').innerHTML.includes('22 → 23.32'));
  assert(g.element('overlay').innerHTML.includes('3 → 3.06'));
  assert(g.element('overlay').innerHTML.includes('66 → 71.36'));
  click(g, 'growthNext'); assert.equal(t.profile.inventory.weapon_seed.level, 0, 'The guide first reveals the actual effects and price');
  const enhance=g.element('overlay').querySelectorAll('[data-enhance]').find(button=>button.dataset.enhance==='weapon_seed');
  assert(enhance); enhance.onclick(); assert.equal(t.profile.inventory.weapon_seed.level, 1);
  assert.equal(t.profile.seeds, wallet[0] - 35);
  assert(g.element('growthNext').textContent.includes('第二关'));
  const reloaded = createGame(g.storage, { tutorial: true });
  assert(reloaded.element('growthNext').textContent.includes('第二关'));
  click(reloaded, 'growthNext'); assert.equal(reloaded.t.activeStage.id, 2);
  assert.equal(reloaded.t.player.maxHp, 114);
  clearStage(reloaded.t); reloaded.t.startScreen();
  assert(!reloaded.element('overlay').innerHTML.includes('id="growthNext"'));
});
check('Spending materials elsewhere never traps the soft growth route, and old earned progress remains intact', () => {
  const g = createGame(), t = g.t; t.start(); clearStage(t); t.startScreen();
  t.upgradeSprite(1); t.profile.seeds = 0; t.profile.cores = 0; t.startScreen();
  assert(g.element('growthNext').textContent.includes('第二关'));
  assert(!g.element('overlay').innerHTML.includes('class="done">✓ 强化武器'));
  const prior = new Map([['orchard-save-v1', JSON.stringify({ version: 1, unlockedStage: 3, clearedStages: [1,2], seeds: 77, cores: 8, spriteLevels: {1:2}, tutorialSeen: true })]]);
  const old = createGame(prior); assert.equal(old.t.profile.seeds,77); assert.equal(old.t.profile.spriteLevels[1],2);
  assert(!old.element('overlay').innerHTML.includes('growth-route'));
});
check('An ordinary opening reaches the first XP choice within thirty battle seconds using only earned drops', () => {
  for (const id of [1,2]) {
    const g = createGame(), t = g.t;
    t.profile.unlockedStage = id; t.selectStage(id); t.start();
    for (let frames=0; frames<750 && t.state !== 'upgrade'; frames++) {
      if(t.state === 'roulette') { click(g,'spinReward'); t.rouletteTick(2); click(g,'spinReward'); }
      else t.update(.04);
    }
    assert.equal(t.state,'upgrade', 'Opening stage ' + id + ' must reach a real XP choice');
    assert(t.elapsed<=30); assert(t.stageXP.collected >= t.experienceNeed(1));
    assert.equal(t.player.level,1); assert(t.stageXP.collected<=t.stageXP.issued);
    assert(t.stageXP.issued<=t.activeStage.experience.budget);
    assert(t.choices.some(card=>['chain','leafstorm','fireball'].includes(card.id)));
    const issued=t.stageXP.issued, collected=t.stageXP.collected, elapsed=t.elapsed;
    for(let i=0;i<10;i++)t.frame(1000+i*40);
    assert.equal(t.stageXP.issued,issued); assert.equal(t.stageXP.collected,collected); assert.equal(t.elapsed,elapsed);
    t.choose(0);
  }
});
check('The opening assist leaves distant XP and later stages under the normal pickup rules', () => {
  for(const id of [1,3,10,11]) {
    const g=createGame(),t=g.t; t.profile.unlockedStage=id; t.selectStage(id); t.start();
    const victim=t.enemies.find(e=>!e.boss&&!e.elite); quietField(t);
    victim.x=t.player.x+300; victim.y=t.player.y; victim.hp=0; t.enemies.push(victim); t.update(.001);
    const gem=t.gems[0], x=gem.x; t.update(.1);
    assert.equal(gem.x<x,id<=10);
    const far=t.player.x+1800; t.dropExperience(far,t.player.y,1); const farGem=t.gems.find(gem=>gem.x===far); t.update(.1);
    assert.equal(farGem.x,far);
  }
});
check('Nearest map selection is useful, viewing does not start tracking, and explicit tracking cancels without consuming battle time', () => {
  const g=createGame(),t=g.t; t.start(); quietField(t);
  const nearest=t.relicDrops.reduce((a,b)=>Math.hypot(a.x-t.player.x,a.y-t.player.y)<Math.hypot(b.x-t.player.x,b.y-t.player.y)?a:b);
  t.showRelicMap(); assert.equal(t.selectedRelic,nearest.id); const elapsed=t.elapsed;
  t.closeRelicMap(); assert(g.element('relicTracker').classList.contains('hidden'));
  t.showRelicMap(); click(g,'trackSelectedRelic'); assert(!g.element('relicTracker').classList.contains('hidden'));
  t.showRelicMap(); assert.equal(g.element('trackSelectedRelic').textContent,'取消追踪');
  click(g,'trackSelectedRelic'); assert(g.element('relicTracker').classList.contains('hidden')); assert.equal(t.elapsed,elapsed);
  t.showRelicMap(); click(g,'trackSelectedRelic'); t.player.x=nearest.x; t.player.y=nearest.y; t.update(.001);
  assert(nearest.claimed); assert(g.element('relicTracker').classList.contains('hidden'));
  t.showRelicMap(nearest.id); assert.equal(g.element('trackSelectedRelic').disabled,true);
});
check('World harvest guidance persists per game account and a stale callback cannot update another account', () => {
  let options; const client={open(value){options=value;},close(){},isAuthenticated(){return false;}};
  const g=createGame(new Map(),{frontierClient:client}),t=g.t;
  t.profile.clearedStages=[1,2]; t.showWorld(); const harvest=options.onHarvest; harvest();
  assert.equal(t.profile.worldHarvestSeen,true); assert.equal(t.loadProfile().worldHarvestSeen,true);
  t.acceptAccount({id:'next',nickname:'另一个测试账号'}); t.profile.worldHarvestSeen=false; harvest();
  assert.equal(t.profile.worldHarvestSeen,false);
});
console.log(checks+' first-minutes flow checks passed.');
