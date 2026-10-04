'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {createGame}=require('./verify.cjs');
let count=0;
function check(name,fn){fn();console.log('PASS '+name);count++;}
check('Twenty equipment items use finite stats and all three slots contain real choices',()=>{
 const {t}=createGame();assert.equal(Object.keys(t.gearDefs).length,20);
 for(const [slot,total] of [['weapon',8],['armor',6],['charm',6]]){
  const items=Object.values(t.gearDefs).filter(g=>g.slot===slot);assert.equal(items.length,total);
  for(const g of items)for(const key of slot==='weapon'?['damage','rate','shots']:slot==='armor'?['hp','defense','speedMult']:['speed','pickup','xpMult'])assert(Number.isFinite(g[key]));
 }
});
check('New chapter equipment is awarded once at the intended stage and survives a reload',()=>{
 const {t}=createGame();t.profile.unlockedStage=100;
 const chapters=t.stages.filter(s=>s.firstClearGear&&s.id>20);assert.equal(chapters.length,10);
 for(const s of chapters){assert(!t.profile.inventory[s.firstClearGear]);t.selectStage(s.id);t.start();t.finish(true);assert.equal(t.profile.inventory[s.firstClearGear].level,0);
  const before=Object.keys(t.profile.inventory).length;t.finish(true);assert.equal(Object.keys(t.profile.inventory).length,before);
 }
 const saved=t.loadProfile();for(const s of chapters)assert(saved.inventory[s.firstClearGear]);
});
check('Existing saves retroactively receive earned equipment, preserve upgrades and never gain currency',()=>{
 const raw={version:1,clearedStages:Array.from({length:100},(_,i)=>i+1),unlockedStage:100,seeds:123,cores:45,inventory:{weapon_seed:{level:7},armor_leaf:{level:3},charm_sprout:{level:2}},equipped:{weapon:'weapon_seed',armor:'armor_leaf',charm:'charm_sprout'}};
 const storage=new Map([['orchard-save-v1',JSON.stringify(raw)]]),{t}=createGame(storage);
 assert.equal(Object.keys(t.profile.inventory).length,20);assert.equal(t.profile.inventory.weapon_seed.level,7);assert.equal(t.profile.seeds,123);assert.equal(t.profile.cores,45);
 assert.equal(t.profile.equipped.weapon,'weapon_seed');assert.equal(t.profile.inventory.weapon_coconut.level,0);
 assert.equal(Object.keys(t.loadProfile().inventory).length,20);
});
check('New weapon range and penetration affect actual run stats alongside hero passives',()=>{
 const {t}=createGame();for(const id of Object.keys(t.gearDefs))t.profile.inventory[id]={level:0};
 assert(t.equipGear('weapon_sunbow'));t.start();assert.equal(t.player.weaponRange,720);assert.equal(t.player.pierce,1);assert.equal(t.player.damage,46);
 t.startScreen();t.selectHero('cherry');t.equipGear('weapon_blueberry');t.start();assert.equal(t.player.weaponRange,620);assert(Math.abs(t.player.pierce-.85)<1e-8);
});
check('New armor, charms and strengthening produce their advertised permanent values',()=>{
 const {t}=createGame();for(const id of Object.keys(t.gearDefs))t.profile.inventory[id]={level:0};t.profile.seeds=10000;t.profile.cores=1000;
 t.equipGear('armor_frost');t.equipGear('charm_star');t.start();assert.equal(t.player.maxHp,220);assert.equal(t.player.defense,6);assert.equal(t.player.pickup,185);assert.equal(t.player.xpMult,1.25);
 t.startScreen();assert(t.upgradeGear('armor_frost'));assert(t.upgradeGear('charm_star'));t.start();assert.equal(t.player.maxHp,228);assert.equal(t.player.defense,6.5);assert.equal(t.player.pickup,191);assert.equal(t.player.xpMult,1.25);
});
check('Locked chapter cards display art and unlock conditions but offer no purchases',()=>{
 const {t,element}=createGame();t.showArmory();let content=element('overlay').innerHTML;
 assert(content.includes('紫藤连珠弩'));assert(content.includes('首通第 <b>25</b> 关获得'));assert(content.includes('装备图'));assert(content.includes('equipment-equipped'));
 assert(content.includes('clipPathUnits="userSpaceOnUse"'));assert(content.includes('clip-path="url(#equipment-clip-weapon_seed-card)"'));assert(content.includes('2.05'));
 assert(!element('overlay').querySelectorAll('[data-equip]').some(b=>b.dataset.equip==='weapon_grape'));
 assert(!t.equipGear('weapon_grape'));assert(!t.upgradeGear('weapon_grape'));
 t.showOrchard();assert(!element('overlay').classList.contains('armory-overlay'));
});
check('Atlas PNGs, compact workshop stylesheet and all chapter rewards are included in the static release',()=>{
 const release=require('./tools/package-site.cjs').collectRelease();
 for(const [name,w,h]of [['weapons',1254,1254],['armor',1536,1024],['charms',1536,1024]]){
  const file='assets/equipment/'+name+'.png';assert(release.files.has(file));const bytes=fs.readFileSync(file);assert.equal(bytes.readUInt32BE(16),w);assert.equal(bytes.readUInt32BE(20),h);
 }
 assert(release.files.has('armory-ui.css'));assert(fs.readFileSync('armory-ui.css','utf8').includes('grid-auto-rows:max-content'));
});
console.log(count+' equipment checks passed.');
