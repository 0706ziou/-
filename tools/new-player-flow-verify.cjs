const assert=require('node:assert/strict');
const {createGame,clearStage,click,quietField}=require('../verify.cjs');
const user=Object.freeze({id:'flowcheck',account:'flowcheck',nickname:'新手验收'});
const storage=new Map();let worldOptions;
const frontier={open(options){worldOptions=options;},close(){},isAuthenticated(){return false;},hasGameLogin(){return false;}};
const make=()=>{const g=createGame(storage,{auth:true,tutorial:true,frontierClient:frontier});g.t.acceptAccount(user);return g;};
let g=make(),t=g.t;
assert.equal(t.runMode,'training');t.skipTraining();
for(const fn of [()=>t.showArmory(),()=>t.showHeroes(),()=>t.showOrchard(),()=>t.showWorld(),()=>t.selectHero('cherry'),()=>t.upgradeGear('weapon_seed'),()=>t.researchTalent('vitality'),()=>t.upgradeOrchard()])assert.equal(fn(),false);
for(const id of ['navArmory','navHeroes','navOrchard','navWorld'])assert.equal(g.element(id).disabled,true);
assert(g.element('overlay').innerHTML.includes('首次通关后解锁'));
console.log('PASS fresh account locks all four features and mutations after training');
t.start();t.finish(false);for(const id of ['resultWorld','resultOrchard','resultArmory'])assert.equal(g.element(id).disabled,true);
t.startScreen();t.start();clearStage(t);assert(t.profile.clearedStages.includes(1));assert.equal(t.state,'ended');
assert(g.element('overlay').innerHTML.includes('新功能已解锁'));
click(g,'backLobby');for(const id of ['navArmory','navHeroes','navOrchard','navWorld'])assert.equal(g.element(id).disabled,false);
assert(g.element('navArmory').classList.contains('feature-guide-target'));
assert(!g.element('overlay').innerHTML.includes('id="startTraining"'));
click(g,'navOrchard');assert(!g.element('overlay').innerHTML.includes('id="nextFeatureGuide"'));assert.equal(t.profile.featureGuideStep,0);
t.startScreen();click(g,'navArmory');assert(g.element('overlay').innerHTML.includes('选择武器'));click(g,'nextFeatureGuide');assert.equal(t.profile.featureGuideStep,1);
g=make();t=g.t;assert.equal(t.profile.featureGuideStep,1);assert(g.element('navHeroes').classList.contains('feature-guide-target'));
for(const id of ['navHeroes','navOrchard']){click(g,id);click(g,'nextFeatureGuide');}
click(g,'navWorld');assert(worldOptions.guideHTML.includes('空地'));worldOptions.onGuideDone();assert.equal(t.profile.featureGuideStep,4);
assert(!g.element('overlay').innerHTML.includes('class="feature-guide"'));
console.log('PASS first clear unlocks four features, ordered click guide, refresh resumes and completion persists');
t.selectStage(2);t.start();clearStage(t);click(g,'backLobby');assert.equal(t.profile.featureGuideRound,2);assert.equal(t.profile.featureGuideStep,0);assert(g.element('overlay').innerHTML.includes('第二关成长练习'));
for(const id of ['navArmory','navHeroes','navOrchard']){click(g,id);click(g,'nextFeatureGuide');}
assert.equal(t.profile.featureGuideStep,3);assert(!g.element('overlay').innerHTML.includes('class="feature-guide"'));
t.selectStage(2);t.start();clearStage(t);click(g,'backLobby');assert.equal(t.profile.featureGuideStep,3);
g=make();assert.equal(g.t.profile.featureGuideRound,2);assert.equal(g.t.profile.featureGuideStep,3);assert(!g.element('overlay').innerHTML.includes('class="feature-guide"'));
console.log('PASS second clear repeats three features once, repeat victories and reload do not restart it');
const newUser=Object.freeze({id:'otherflow',account:'otherflow',nickname:'另一新芽'});g.t.startScreen();assert(g.t.logoutAccount());g.t.acceptAccount(newUser);assert.equal(g.t.profile.featureGuideStep,0);assert.equal(g.t.profile.featureGuideRound,1);assert.equal(g.t.runMode,'training');g.t.skipTraining();assert.equal(g.t.showArmory(),false);
const legacyStorage=new Map([['orchard-save-v1',JSON.stringify({version:1,unlockedStage:3,clearedStages:[1,2],tutorialSeen:true,seeds:77,cores:8})]]);
const legacy=createGame(legacyStorage,{tutorial:true});assert.equal(legacy.t.profile.featureGuideStep,4);assert.equal(legacy.t.profile.seeds,77);assert(legacy.t.showHeroes());assert(!legacy.element('overlay').innerHTML.includes('id="nextFeatureGuide"'));
console.log('PASS guide state stays account-scoped and old progressed saves remain unlocked without forced replays');
for(let id=1;id<=4;id++){
 const h=createGame();h.t.selectStage(id);h.t.profile.unlockedStage=4;h.t.selectStage(id);h.t.start();const s=h.t.activeStage;
 if(id<=3){assert.equal(s.normalCount,48+id*24);assert.equal(s.eliteCount,id);assert.equal(s.bossCount,1);const boss=h.t.enemies.find(e=>e.boss);assert.equal(boss.hp,120+id*60);assert(boss.damage<=5);assert(boss.chargeSpeed<h.t.player.speed);assert.equal(s.xpRewards.reduce((a,b)=>a+b,0),10000);quietField(h.t);h.t.player.hp=40;h.t.player.sinceHit=3;h.t.update(.2);assert(h.t.player.hp>40);}
 else{assert.equal(s.normalCount,398);assert.equal(s.beginner,undefined);quietField(h.t);h.t.player.hp=40;h.t.player.sinceHit=3;h.t.update(.2);assert.equal(h.t.player.hp,40);}
}
console.log('PASS three gentle stages retain exact XP, slow bosses and recovery; stage four tuning remains unchanged');
