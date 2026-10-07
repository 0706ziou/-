'use strict';
const assert = require('node:assert/strict');
const {createGame, clearStage, click, quietField} = require('../verify.cjs');
let checks = 0;
function check(name, run) { run(); checks++; console.log('PASS ' + name); }
check('Every first offer has a visible skill, three unique eligible cards and an attribute', () => {
  for (let roll = 0; roll <= 100; roll++) {
    const g = createGame(); g.t.start(); g.setRandom(roll / 101); g.t.upgrade();
    const cards = g.t.choices;
    assert.equal(cards.length, 3); assert.equal(new Set(cards.map(card => card.id)).size, 3);
    assert(cards.some(card => ['chain', 'leafstorm', 'fireball'].includes(card.id)));
    assert(cards.some(card => card.category === 'attribute'));
    assert(cards.every(card => g.t.builds.available(g.t.player, card.id)));
    assert.equal(g.t.builds.summary(g.t.player).totalChoices, 0);
  }
  // An elite can die before the player collects the first XP drop.
  for(const reward of ['damage', 'hp', 'chain']) {
    const g=createGame();g.t.start();assert(g.t.builds.choose(g.t.player,reward).applied);
    g.t.upgrade();assert(g.t.choices.some(card => ['chain','leafstorm','fireball'].includes(card.id)));
    assert.equal(g.t.choices.length,3);assert.equal(g.t.player.level,1);
  }
});
check('Strengthening the first weapon still leaves a free first companion cultivation', () => {
  const g = createGame(), t = g.t; t.start(); clearStage(t); t.startScreen();
  assert(t.upgradeGear('weapon_seed'));
  const before = {seeds:t.profile.seeds, cores:t.profile.cores};
  t.showOrchard(); assert.equal(g.element('growSelectedSprite').disabled, false);
  assert(g.element('growSelectedSprite').textContent.includes('免费'));
  assert(t.upgradeSprite(1)); assert.equal(t.profile.spriteLevels[1], 1);
  assert.equal(t.profile.seeds, before.seeds); assert.equal(t.profile.cores, before.cores);
  assert(t.profile.firstCultivationUsed); assert.equal(t.spriteCost(1).seeds, 42);
  const reloaded = createGame(g.storage);
  assert(reloaded.t.profile.firstCultivationUsed); assert.equal(reloaded.t.spriteCost(1).seeds, 42);
});
check('Cultivation is guarded during combat, never applies to unrescued companions, and migrates old saves', () => {
  const g = createGame(), t = g.t; t.start(); const original = JSON.stringify(t.profile);
  assert.equal(t.upgradeSprite(1), false); assert.equal(JSON.stringify(t.profile), original);
  const legacy = new Map([['orchard-save-v1', JSON.stringify({version:1, unlockedStage:2, clearedStages:[1], spriteLevels:{1:2}, seeds:19, cores:1})]]);
  const migrated = createGame(legacy).t;
  assert(migrated.profile.firstCultivationUsed); assert.equal(migrated.spriteCost(1).seeds, 64);
  assert.equal(migrated.profile.seeds, 19); assert.equal(migrated.profile.spriteLevels[1], 2);
});
check('Map tracking shows a bearing and distance, clears on collection and resets each run', () => {
  const g = createGame(), t = g.t; t.start(); quietField(t);
  assert.equal(g.element('level').textContent, 'LV. 1 / 10');
  assert(t.showRelicMap());
  const target = t.relicDrops[0];
  const marker = g.element('overlay').querySelectorAll('[data-relic-id]').find(button => button.dataset.relicId === String(target.id));
  marker.onclick(); const elapsed = t.elapsed; click(g, 'trackSelectedRelic');
  assert.equal(t.elapsed, elapsed); assert(!g.element('relicTracker').classList.contains('hidden'));
  assert(g.element('relicTrackerText').textContent.includes('距离'));
  const label = g.element('relicTrackerText').textContent;
  t.player.x = target.x; t.player.y = target.y; t.update(.001);
  assert(target.claimed); assert(g.element('relicTracker').classList.contains('hidden'));
  assert(label.includes(t.runRelicDefs[0].name));
  t.startScreen(); t.start(); assert(g.element('relicTracker').classList.contains('hidden'));
});
check('Pause retains detailed attributes and the store, freezes combat and returns to pause after shopping', () => {
  const g = createGame(), t = g.t; t.start(); quietField(t); t.pause();
  assert(g.element('overlay').innerHTML.includes('本局详细属性'));
  assert(g.element('overlay').innerHTML.includes('单籽伤害')); const elapsed = t.elapsed;
  for(let i=0;i<30;i++)t.frame(1000+i*40);
  assert.equal(t.elapsed, elapsed); click(g, 'pauseStore');
  assert.equal(t.state, 'itemStore'); t.closeItemStore(); assert.equal(t.state, 'paused');
  click(g, 'resume'); assert.equal(t.state, 'playing');
});
function until(t, condition, seconds = 30) {
  for (let i=0; !condition() && i<seconds/.04; i++) t.update(.04);
  assert(condition(), 'Training objective is reachable');
}
check('The practice boss survives standing fire and only unlocks after a real unharmed dodge', () => {
  const g = createGame(), t = g.t; t.startScreen(); assert(t.startTraining());
  t.keys.add('d'); until(t, () => t.training.step === 1, 3); t.keys.clear();
  until(t, () => t.training.step === 3);
  for (const gem of [...t.gems]) { t.player.x=gem.x; t.player.y=gem.y; t.update(.001); }
  assert.equal(t.state, 'upgrade'); t.choose(0); t.activateHeroSkill(); t.update(.001);
  t.player.x=t.relicDrops[0].x; t.player.y=t.relicDrops[0].y; t.update(.001);
  t.showRelicMap(); t.closeRelicMap(); t.update(.001); until(t, () => t.training.step === 9);
  const boss=t.enemies.find(enemy => enemy.boss);
  t.skillHit(boss, 1e9, '#fff'); assert.equal(boss.hp, 1);
  for(let i=0;i<100;i++)t.update(.04);
  assert.equal(t.training.step,9); assert.equal(t.training.bossDodges,0); assert.equal(t.bossKills,0);
  // Restart the positioning on this isolated practice field, then move sideways
  // during a real windup and let the normal collision and charge code resolve it.
  boss.x=t.player.x+170; boss.y=t.player.y; boss.chargeClock=0; boss.windup=0; boss.dashTime=0; delete boss.trainingCharge;
  t.update(.04); assert(boss.windup>0); t.keys.add('w');
  until(t, () => t.state==='trainingDone' || t.training.bossDodges>0, 3); t.keys.clear();
  until(t, () => t.state==='trainingDone');
  assert(t.profile.trainingComplete);
  assert(g.element('overlay').innerHTML.includes('training-more'));
});
console.log(checks + ' playtest improvement checks passed.');
