// Run with: node verify.cjs. Tests the shipped scripts in an isolated browser mock.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const html = fs.readFileSync(__dirname+'/index.html','utf8');
const gameScriptIndex = html.search(/<script\b[^>]*src="game\.js(?:\?[^"]*)?"/);
const experienceSource = fs.readFileSync(__dirname+'/experience-data.js','utf8');
const progressionSource = fs.readFileSync(__dirname+'/progression.js','utf8');
const orchardSource = fs.readFileSync(__dirname+'/orchard-data.js','utf8');
const relicSource = fs.readFileSync(__dirname+'/relic-data.js','utf8');
const relicEffectsSource = fs.readFileSync(__dirname+'/relic-effects.js','utf8');
const buildSource = fs.readFileSync(__dirname+'/build-data.js','utf8');
const worldSource = fs.readFileSync(__dirname+'/world-data.js','utf8');
const growthSource = fs.readFileSync(__dirname+'/growth-data.js','utf8');
const artSource = fs.readFileSync(__dirname+'/art-catalog.js','utf8');
const mapSource = fs.readFileSync(__dirname+'/map-data.js','utf8');
const navigationSource = fs.readFileSync(__dirname+'/navigation.js','utf8');
const mapRendererSource = fs.readFileSync(__dirname+'/map-renderer.js','utf8');
const conversationSource = fs.readFileSync(__dirname+'/conversation-data.js','utf8');
const authSource = fs.readFileSync(__dirname+'/auth-data.js','utf8');
const trainingSource = fs.readFileSync(__dirname+'/training-data.js','utf8');
const frontierRewardsSource = fs.readFileSync(__dirname+'/frontier-rewards.js','utf8');
let gameSource = fs.readFileSync(__dirname+'/game.js','utf8');
const boot = 'showCover();requestAnimationFrame(frame);';
assert(gameSource.includes(boot), 'Keep the game bootstrap available for the test hook.');
gameSource = gameSource.replace(boot,
  `globalThis.test={start,update,frame,pause,resume,choose,upgrade,draw,spawn,shoot,upgradeDefs,keys,
  stages,gearDefs,gearGrowth,combat,gearCost,gearStats,equipGear,upgradeGear,selectStage,finish,saveProfile,loadProfile,freshProfile,startScreen,showArmory,browseStage,showWorld,frontierRewards,
  openGameHelp,closeGameHelp,openTutorial,nextTutorial,tutorialSteps,
  startTraining,finishTraining,exitTraining,skipTraining,needsFirstTraining,trainingTick,get training(){return training},
  submitLogin,acceptAccount,logoutAccount,showCover,
  get currentAccount(){return currentAccount},get currentSaveKey(){return currentSaveKey},get loginBusy(){return loginBusy},
  get previewStage(){return previewStage},get helpTab(){return helpTab},get tutorialStep(){return tutorialStep},get helpReturnState(){return helpReturnState},
  showOrchard,upgradeOrchard,upgradeSprite,orchardCost,spriteCost,completeRescue,readyBoss,announceBossArrival,
  startEndless,spawnEndlessWave,bankEndlessRewards,finishEndless,
  dropExperience,XP_NODE_CAP,W,H,WORLD_W,WORLD_H,seedDamage,experienceNeed,upgradeBase,experience,checkStageCompletion,
  get stageXP(){return stageXP},
  get nextBossAllowedAt(){return nextBossAllowedAt},
  relicDefs,relicPoints,relicEffects,builds,resetRelics,claimRelic,updateSkills,activateDash,showRelicMap,closeRelicMap,isRunActive,skillHit,healPlayer,
  get runRelicDefs(){return runRelicDefs},set runRelicDefs(v){runRelicDefs=v},
  get noticeQueue(){return noticeQueue},get currentNotice(){return currentNotice},get noticeClock(){return noticeClock},
  world,growth,art,mapCatalog,mapRenderer,showHeroes,selectHero,trainHero,researchTalent,activateHeroSkill,
  get obstacles(){return obstacles},get mapLayout(){return mapLayout},get navigator(){return navigator},
  get heroEffects(){return heroEffects},
  get relicDrops(){return relicDrops},get skillEffects(){return skillEffects},get selectedRelic(){return selectedRelic},get mapReturnState(){return mapReturnState},
  get player(){return player},get enemies(){return enemies},get bullets(){return bullets},
  get gems(){return gems},get state(){return state},get elapsed(){return elapsed},get still(){return still},
  get camera(){return camera},get kills(){return kills},get profile(){return profile},
  get nonBossKills(){return nonBossKills},get bossKills(){return bossKills},get bossIndex(){return bossIndex},
  get selectedStage(){return selectedStage},get activeStage(){return activeStage},
  get selectedGearSlot(){return selectedGearSlot},get selectedSprite(){return selectedSprite},
  get runMode(){return runMode},get endlessWave(){return endlessWave},
  get shotClock(){return shotClock},
  get endlessCreditedSeeds(){return endlessCreditedSeeds},get endlessCreditedCores(){return endlessCreditedCores},
  set elapsed(v){elapsed=v},set enemies(v){enemies=v},set gems(v){gems=v},set shotClock(v){shotClock=v},
  get choices(){return choices}};${boot}`);

function createGame(storage = new Map(), options = {}) {
  const elements = new Map(), listeners = {}, drawCalls = [];
  function classList() {
    const names=new Set();return {
      add(...tokens){for(const token of tokens)names.add(token)},
      remove(...tokens){for(const token of tokens)names.delete(token)},
      contains(token){return names.has(token)},
      toggle(token,force){const add=force===undefined?!names.has(token):Boolean(force);if(add)names.add(token);else names.delete(token);return add}
    };
  }
  const context2d = new Proxy({}, {
    get: (o,k) => o[k] ?? ((...args) => drawCalls.push({method:k,args})),
    set: (o,k,v) => (o[k]=v,true)
  });
  function element(id) {
    if (!elements.has(id)) elements.set(id, {
      style: {setProperty(key,value){this[key]=value}}, dataset: {}, textContent: '', _innerHTML: '', disabled: false,
      classList: classList(),
      getContext: () => context2d,
      addEventListener: (name, fn) => listeners[id+':'+name]=fn,
      closest: () => null, setPointerCapture(){},
      focus(){sandbox.document.activeElement=this},
      setAttribute(name,value){this.ariaProps??={};this.ariaProps[name]=String(value)},
      removeAttribute(name){if(this.ariaProps)delete this.ariaProps[name]},
      getBoundingClientRect: () => ({left:0,top:0,width:960,height:680}),
      get innerHTML() { return this._innerHTML; },
      set innerHTML(value) {
        this._innerHTML=value;this._buttons=[];
        for(const m of value.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)){
          const attrs=m[1],buttonId=attrs.match(/(?:^|\s)id=["']([^"']+)["']/)?.[1];
          const button=buttonId?element(buttonId):{style:{},dataset:{},onclick:null,focus(){sandbox.document.activeElement=this}};
          button.dataset={};button.disabled=/\bdisabled(?:\s|=|$)/.test(attrs);
          button.textContent=m[2].replace(/<[^>]*>/g,'');button.onclick=null;
          button.attributes=attrs;
          for(const [,key,v]of attrs.matchAll(/data-([\w-]+)=["']([^"']*)["']/g))button.dataset[key.replace(/-([a-z])/g,(_,v)=>v.toUpperCase())]=v;
          this._buttons.push(button);
        }
      },
      querySelectorAll(selector) {
        if(selector==='button, [tabindex="0"]')return this._buttons||[];
        const match=selector.match(/\[([^\]=]+)(?:=["']?([^\]"']+)["']?)?\]/);
        if(!match)return [];
        const key=match[1].replace(/^data-/,'').replace(/-([a-z])/g,(_,v)=>v.toUpperCase());
        return (this._buttons||[]).filter(b=>Object.hasOwn(b.dataset,key)&&(match[2]===undefined||b.dataset[key]===match[2]));
      }
    });
    return elements.get(id);
  }
  let randomSeed = 0x12345678;
  const seededMath = Object.create(Math);
  seededMath.random = () => {
    randomSeed ^= randomSeed << 13;
    randomSeed ^= randomSeed >>> 17;
    randomSeed ^= randomSeed << 5;
    return (randomSeed >>> 0) / 0x100000000;
  };
  const localStorage = {
    getItem: key => storage.has(key) ? storage.get(key) : null,
    setItem: (key,value) => storage.set(key,String(value)),
    removeItem: key => storage.delete(key)
  };
  const sandbox = {
    document: { body:{classList:classList()}, getElementById: element, addEventListener: (n,f)=>listeners[n]=f },
    window: {localStorage,crypto:require('node:crypto').webcrypto}, localStorage,
    addEventListener: (n,f)=>listeners[n]=f, requestAnimationFrame(){}, console, Math: seededMath, TextEncoder
  };
  if(options.loadedAtlas)sandbox.Image=class {
    constructor(){this.complete=true;this.naturalWidth=1024;this.naturalHeight=1024;this.src=''}
  };
  vm.createContext(sandbox);
  vm.runInContext(authSource,sandbox,{filename:'auth-data.js'});
  if(!options.auth)sandbox.window.ORCHARD_AUTH={create:()=>({profileKey:()=> 'orchard-save-v1',getLastAccount:()=>''})};
  vm.runInContext(experienceSource,sandbox,{filename:'experience-data.js'});
  vm.runInContext(progressionSource,sandbox,{filename:'progression.js'});
  vm.runInContext(orchardSource,sandbox,{filename:'orchard-data.js'});
  vm.runInContext(relicSource,sandbox,{filename:'relic-data.js'});
  vm.runInContext(relicEffectsSource,sandbox,{filename:'relic-effects.js'});
  vm.runInContext(buildSource,sandbox,{filename:'build-data.js'});
  vm.runInContext(worldSource,sandbox,{filename:'world-data.js'});
  vm.runInContext(growthSource,sandbox,{filename:'growth-data.js'});
  vm.runInContext(artSource,sandbox,{filename:'art-catalog.js'});
  vm.runInContext(mapSource,sandbox,{filename:'map-data.js'});
  vm.runInContext(navigationSource,sandbox,{filename:'navigation.js'});
  vm.runInContext(mapRendererSource,sandbox,{filename:'map-renderer.js'});
  vm.runInContext(conversationSource,sandbox,{filename:'conversation-data.js'});
  vm.runInContext(trainingSource,sandbox,{filename:'training-data.js'});
  vm.runInContext(frontierRewardsSource,sandbox,{filename:'frontier-rewards.js'});
  if(options.frontierClient)sandbox.window.ORCHARD_FRONTIER=options.frontierClient;
  if(options.conversation)sandbox.window.ORCHARD_CONVERSATION=options.conversation;
  // Ordinary combat fixtures represent an existing player before the new-login gate runs.
  // Keep original storage bytes intact, including corrupt or inaccessible storage cases.
  const fixtureSource=!options.auth&&!options.tutorial
    ? gameSource.replace('profile = loadProfile(); resetAccountSession();','profile = loadProfile(); profile.tutorialSeen = true; resetAccountSession();')
    : gameSource;
  vm.runInContext(fixtureSource,sandbox,{filename:'game.js'});
  // This fixture-only identity keeps old save-key checks independent of the login module.
  if(!options.auth)sandbox.test.acceptAccount(Object.freeze({id:'fixture',account:'fixture',nickname:'测试守护者'}));
  // Combat regression fixtures have already finished onboarding; dedicated tests use tutorial:true.
  if(!options.tutorial)sandbox.test.profile.tutorialSeen=true;
  if(!options.randomRelics){
    const fixedRelics=()=>{sandbox.test.runRelicDefs=sandbox.window.ORCHARD_RELICS.slice(0,6);sandbox.test.resetRelics(false)};
    if(sandbox.test.runMode!=='training')fixedRelics();
    const realStart=sandbox.test.start;sandbox.test.start=()=>{const started=realStart();if(sandbox.test.runMode!=='training')fixedRelics();return started};
  }
  return {t:sandbox.test,element,listeners,drawCalls,storage,document:sandbox.document,bosses:sandbox.window.ORCHARD_BOSSES,rescues:sandbox.window.ORCHARD_RESCUES,relics:sandbox.window.ORCHARD_RELICS,setRandom:value=>{seededMath.random=()=>value}};
}
let count=0;const failures=[];
function test(name,fn,{start=true}={}) {
  if(require.main!==module)return;
  if(process.env.ORCHARD_TEST_FILTER&&!new RegExp(process.env.ORCHARD_TEST_FILTER,'i').test(name))return;
  try {
    const game=createGame();
    if(start)game.t.start();
    fn(game);console.log('PASS '+name);count++;
  } catch(error) { failures.push(name);console.error('FAIL '+name+'\n'+error.stack); }
}
function enemy(x,y,extra={}) {
  return {x,y,r:19,hp:100,speed:0,type:0,phase:0,flash:0,aggro:true,pursuitAt:0,damage:15,xp:2,...extra};
}
function quietField(t) {
  // An empty field deliberately wins; retain a distant, inactive survivor.
  t.enemies=[enemy(40,40,{hp:1e9,pursuitAt:Infinity,aggro:false})];
  t.shotClock=Infinity;
}
function clearStage(t) {
  for (const e of t.enemies) if (!e.boss) e.hp=0;
  t.shotClock=Infinity;t.update(.001);
  for(let i=0;i<t.activeStage.bossCount;i++){
    while(t.state==='upgrade')t.choose(0);
    t.elapsed=Math.max(t.elapsed,t.activeStage.bossSchedule[i],t.nextBossAllowedAt);
    if(t.state==='playing')t.update(.001);
    assert.equal(t.state,'playing');assert.equal(t.state,'playing');
    const boss=t.enemies.find(e=>e.boss&&e.aggro);assert(boss);assert.equal(boss.stageId,t.activeStage.bossIds[i]);boss.hp=0;
    t.update(.001);
  }
  drainUpgradeChoices(t);
  assert.equal(t.nonBossKills,t.activeStage.normalCount+t.activeStage.eliteCount);
  assert.equal(t.bossKills,t.activeStage.bossCount);assert.equal(t.kills,t.activeStage.enemyCount);
  assert.equal(t.state,'rescue');t.completeRescue();assert.equal(t.state,'ended');
}
function enterEndless(t) {
  clearStage(t);t.gems=[];t.player.xp=0;
  assert(t.startEndless());assert.equal(t.state,'playing');assert.equal(t.runMode,'endless');
}
function drainUpgradeChoices(t) {
  for(let safety=0;t.state==='upgrade'&&safety<100;safety++)t.choose(0);
  assert.notEqual(t.state,'upgrade','Every accumulated experience reward must remain resolvable');
}
function freezeBuildAttacks(t) {
  // These fixtures inspect wave timing or incoming damage, independent of the earned automatic attacks.
  for(const def of [...t.builds.defs,...t.builds.recipes])t.player.build.timers[def.id]=1e9;
  t.player.build.zones=[];
}
function killNonBossCount(t,count) {
  const targets=t.enemies.filter(e=>!e.boss&&e.hp>0).slice(0,count);assert.equal(targets.length,count);
  for(const e of targets)e.hp=0;t.update(.001);
}
function prepareStage(t,id) {
  t.startScreen();t.profile.unlockedStage=Math.max(id,t.profile.unlockedStage);assert(t.selectStage(id));t.start();
  // Schedule checks kill their targets explicitly; incidental build skills must not clear small bugs early.
  t.player.inv=1e9;t.shotClock=Infinity;for(const e of t.enemies){e.speed=0;if(!e.boss)e.hp=1e9;}
}
function claimSkill(t,key) {
  const def=t.relicDefs.find(r=>r.key===key);assert(def,'The requested skill must have a relic: '+key);
  const drop=t.relicDrops.find(r=>r.id===def.id);assert(drop);t.player.x=drop.x;t.player.y=drop.y;
  assert(t.claimRelic(drop.id),'A nearby, unclaimed relic must be claimable');assert.equal(t.player.skills[key],true);return def;
}
function relicMarkerButtons(game) {
  return game.element('overlay').querySelectorAll('[data-relic-id]').filter(button=>/\bclass=["'][^"']*\brelic-marker\b/.test(button.attributes));
}
function click(game,id) {
  assert(game.element('overlay').innerHTML.includes('id="'+id+'"'),'The current menu must render '+id);
  const button=game.element(id);assert(!button.disabled,'The current action must be enabled: '+id);
  assert.equal(typeof button.onclick,'function','The current action must have a callback: '+id);
  button.onclick();
}
function dataButton(game,attribute,value) {
  const buttons=game.element('overlay').querySelectorAll('['+attribute+']');
  const key=attribute.replace(/^data-/,'').replace(/-([a-z])/g,(_,v)=>v.toUpperCase());
  const button=buttons.find(b=>b.dataset[key]===String(value));assert(button,'The current menu must render '+attribute+'='+value);
  assert.equal(typeof button.onclick,'function');return button;
}
function menuControls(game) {
  const markup=game.element('overlay').innerHTML;
  if(markup.includes('chapter-showcase')){
    assert(markup.includes('lobby-footer'));assert(markup.includes('chapter-image'));
    for(const id of ['start','navArmory','navHeroes','navOrchard','navMap','previousStage','nextStagePreview']){
      assert(markup.includes('id="'+id+'"'));assert.equal(typeof game.element(id).onclick,'function');
    }
    assert(markup.indexOf('id="start"')>markup.indexOf('chapter-showcase'),'Enter game remains below the chapter image');
    return;
  }
  assert(markup.includes('menu-dialog'));assert(markup.includes('class="menu-body"'));
  for(const id of ['navStages','navArmory','navOrchard','navMap','navHeroes']){
    assert(markup.includes('id="'+id+'"'));assert.equal(typeof game.element(id).onclick,'function');
  }
  const footer=markup.indexOf('class="menu-footer"');assert(footer>=0);
  assert(markup.indexOf('id="start"')>footer,'The challenge action stays in the dedicated footer');
  assert.equal(typeof game.element('start').onclick,'function');
}

test('External scripts are referenced in the correct load order',({t})=>{
  assert(html.includes('src="progression.js"'));assert(gameScriptIndex >= 0);
  assert(html.includes('src="orchard-data.js"'));
  assert(html.includes('src="relic-data.js"'));
  assert(html.indexOf('src="progression.js"')<html.indexOf('src="orchard-data.js"'));
  assert(html.indexOf('src="orchard-data.js"')<gameScriptIndex);
  assert(html.indexOf('src="relic-data.js"')<gameScriptIndex);
  for(const file of ['world-data.js','growth-data.js','art-catalog.js']) {
    assert(html.includes('src="'+file+'"'));assert(html.indexOf('src="'+file+'"')<gameScriptIndex);
  }
  assert.equal(t.stages.length,100);
});
test('Map area grows five times from the previous world and movement reaches all boundaries',({t})=>{
  assert.equal(t.W,960);assert.equal(t.H,680);
  assert.equal(t.WORLD_W,Math.round(t.W*Math.sqrt(50)));
  assert.equal(t.WORLD_H,Math.round(t.H*Math.sqrt(50)));
  assert(Math.abs(t.WORLD_W*t.WORLD_H/(t.W*t.H)-50)<.02);
  assert(Math.abs(t.WORLD_W*t.WORLD_H/(Math.round(t.W*Math.sqrt(10))*Math.round(t.H*Math.sqrt(10)))-5)<.002);
  quietField(t);const startX=t.player.x;t.keys.add('d');t.update(.1);assert(t.player.x>startX);
  t.player.x=t.WORLD_W-28;t.update(.1);assert(t.player.x<=t.WORLD_W-t.player.r);
  t.keys.clear();t.keys.add('a');t.player.x=28;t.update(.1);assert(t.player.x>=t.player.r);
  t.keys.clear();t.keys.add('s');t.player.y=t.WORLD_H-28;t.update(.1);assert(t.player.y<=t.WORLD_H-t.player.r);
  t.keys.clear();t.keys.add('w');t.player.y=28;t.update(.1);assert(t.player.y>=t.player.r);
});
test('Camera follows and clamps at map boundaries',({t})=>{
  quietField(t);t.player.x=t.WORLD_W/2;t.player.y=t.WORLD_H/2;t.update(.01);t.draw();
  assert.equal(t.camera.x,t.player.x-t.W/2);assert.equal(t.camera.y,t.player.y-t.H/2);
  t.player.x=28;t.player.y=28;t.update(.01);t.draw();assert.equal(t.camera.x,0);assert.equal(t.camera.y,0);
  t.player.x=t.WORLD_W-28;t.player.y=t.WORLD_H-28;t.update(.01);t.draw();
  assert.equal(t.camera.x,t.WORLD_W-t.W);assert.equal(t.camera.y,t.WORLD_H-t.H);
});
test('Stage one has its fixed normal, elite and boss roster without replacement spawns',({t})=>{
  const s=t.activeStage;assert.equal(t.enemies.length,s.enemyCount);assert.equal(t.enemies.filter(e=>!e.boss&&!e.elite).length,398);
  assert.equal(t.enemies.filter(e=>e.elite).length,6);assert.equal(t.enemies.filter(e=>e.boss).length,1);
  assert(t.enemies.some(e=>e.type===0));assert(t.enemies.some(e=>e.type===1));
  for(const e of t.enemies){assert(e.x>=0&&e.x<=t.WORLD_W);assert(e.y>=0&&e.y<=t.WORLD_H);e.speed=0;e.hp=1e9}
  t.player.inv=1e9;t.shotClock=Infinity;
  for(let i=0;i<500;i++){t.update(.04);if(t.state==='playing'){t.shotClock=Infinity;}}
  assert.equal(t.state,'playing');assert.equal(t.enemies.length,s.enemyCount);
  t.enemies[0].hp=0;t.update(.01);assert.equal(t.enemies.length,s.enemyCount-1);
  for(let i=0;i<100;i++)t.update(.04);assert.equal(t.enemies.length,s.enemyCount-1);
});
test('Ordinary pursuit keeps increasing alongside the timed boss encounter',({t})=>{
  for(const e of t.enemies){e.speed=0;e.hp=1e9}
  t.player.inv=1e9;t.shotClock=Infinity;
  const s=t.activeStage;assert.equal(s.initialPursuers,20);assert.equal(s.batchSize,20);assert.equal(s.pursuitInterval,10);
  const activeNormals=()=>t.enemies.filter(e=>e.aggro&&!e.elite&&!e.boss).length;
  t.update(.001);assert.equal(activeNormals(),s.initialPursuers);
  t.elapsed=s.pursuitInterval-.002;t.update(.001);assert.equal(activeNormals(),s.initialPursuers);
  t.update(.002);assert.equal(activeNormals(),s.initialPursuers+s.batchSize);
  const lastTime=Math.max(...t.enemies.filter(e=>!e.boss&&!e.elite).map(e=>e.pursuitAt));
  t.elapsed=lastTime-.002;t.update(.001);assert.equal(activeNormals(),380);
  assert.equal(t.state,'playing');assert.equal(t.nonBossKills,0);t.shotClock=Infinity;
  t.update(.002);assert.equal(activeNormals(),398);
  assert.equal(t.enemies.find(e=>e.boss).aggro,true);
});
test('Dormant enemies do not draw in the world or on the minimap',({t,drawCalls})=>{
  t.enemies=[];drawCalls.length=0;t.draw();const base=JSON.stringify(drawCalls);
  t.enemies=[enemy(t.player.x+73,t.player.y+37,{aggro:false,pursuitAt:10})];
  drawCalls.length=0;t.draw();assert.equal(JSON.stringify(drawCalls),base);
  t.enemies[0].aggro=true;drawCalls.length=0;t.draw();assert.notEqual(JSON.stringify(drawCalls),base);
});
test('A nearby dormant enemy waits and cannot deal contact damage',({t})=>{
  const x=t.player.x,y=t.player.y,hp=t.player.hp;
  t.enemies=[enemy(x,y,{speed:56,pursuitAt:10,aggro:false})];t.shotClock=Infinity;
  t.elapsed=9;t.update(.04);assert.equal(t.enemies[0].x,x);assert.equal(t.enemies[0].aggro,false);
  assert.equal(t.player.hp,hp);
  t.enemies[0].x=x-80;t.elapsed=9.99;t.update(.02);assert(t.enemies[0].x>x-80);assert.equal(t.enemies[0].aggro,true);
});
test('Distant reinforcements arrive only on activation while nearby, active and boss enemies keep their positions',({t})=>{
  const x=t.player.x,y=t.player.y,far=enemy(40,40,{aggro:false,pursuitAt:10,elite:true}),near=enemy(x+899,y,{aggro:false,pursuitAt:10});
  const active=enemy(t.WORLD_W-40,t.WORLD_H-40,{aggro:true,pursuitAt:0});
  const pendingBoss=enemy(40,t.WORLD_H-40,{boss:true,type:2,aggro:false,pursuitAt:Infinity});
  const activeBoss=enemy(t.WORLD_W-100,100,{boss:true,type:2,introduced:true,pursuitAt:0,chargeClock:100,windup:0,dashTime:0,chargeSpeed:0});
  t.enemies=[far,near,active,pendingBoss,activeBoss];t.shotClock=Infinity;t.player.inv=1e9;
  const snapshots=new Map(t.enemies.map(e=>[e,{x:e.x,y:e.y}]));t.elapsed=9.99;t.update(.005);
  for(const e of t.enemies){assert.equal(e.x,snapshots.get(e).x);assert.equal(e.y,snapshots.get(e).y)}
  t.update(.01);assert.equal(far.aggro,true);assert(Math.hypot(far.x-x,far.y-y)>=640);assert(Math.hypot(far.x-x,far.y-y)<=800);
  for(const e of [near,active,pendingBoss,activeBoss]){assert.equal(e.x,snapshots.get(e).x);assert.equal(e.y,snapshots.get(e).y)}
  assert.equal(pendingBoss.aggro,false);const arrived={x:far.x,y:far.y};t.update(.05);
  assert.equal(far.x,arrived.x);assert.equal(far.y,arrived.y);assert.equal(t.kills,0);assert.equal(t.enemies.length,5);
});
test('Distant reinforcement arrival and fallback stay outside the viewport with full elite margins at all four corners',({t,setRandom})=>{
  t.shotClock=Infinity;t.player.inv=1e9;
  for(const [x,y] of [[28,28],[t.WORLD_W-28,28],[28,t.WORLD_H-28],[t.WORLD_W-28,t.WORLD_H-28]]){
    for(const randomValue of [0,.125,.25,.375,.5,.625,.75,.875]){
      setRandom(randomValue);t.player.x=x;t.player.y=y;
      const far=enemy(x<t.WORLD_W/2?t.WORLD_W-40:40,y<t.WORLD_H/2?t.WORLD_H-40:40,{elite:true,r:25,aggro:false,pursuitAt:1});
      t.enemies=[far];t.elapsed=.999;t.update(.002);const distance=Math.hypot(far.x-x,far.y-y),margin=far.r+22,buffer=far.r+25;
      assert(distance>=640&&distance<=800);assert(far.x>=margin&&far.x<=t.WORLD_W-margin);assert(far.y>=margin&&far.y<=t.WORLD_H-margin);
      assert(far.x+buffer<t.camera.x||far.x-buffer>t.camera.x+t.W||far.y+buffer<t.camera.y||far.y-buffer>t.camera.y+t.H,'The arrival cannot appear directly inside the actual clamped viewport');
    }
  }
});
test('Auto-targeting ignores hidden bugs and fires at an active target',({t})=>{
  t.enemies=[enemy(t.player.x+30,t.player.y,{aggro:false,pursuitAt:10})];
  t.shoot(false);assert.equal(t.bullets.length,0);
  t.enemies.push(enemy(t.player.x,t.player.y+120));t.shoot(false);
  assert(t.bullets.length>0);assert(Math.abs(t.bullets[0].vx)<1e-8);assert(t.bullets[0].vy>0);
});
test('Projectiles cannot damage dormant enemies',({t})=>{
  t.enemies=[enemy(t.player.x+100,t.player.y,{aggro:false,pursuitAt:10})];t.shotClock=Infinity;
  const hidden=t.enemies[0];t.bullets.push({x:hidden.x,y:hidden.y,vx:0,vy:0,damage:1000,life:1});
  t.update(.01);assert.equal(hidden.hp,100);assert.equal(t.kills,0);assert.equal(t.gems.length,0);
});
test('Standstill boost resets when moving',({t})=>{
  quietField(t);t.update(.61);assert(t.still>=.6);t.keys.add('w');t.update(.02);assert.equal(t.still,0);
});
test('Automatic fire spreads volley damage across extra seeds and keeps the standstill boost',({t})=>{
  t.enemies=[enemy(t.player.x+120,t.player.y)];t.player.shots=3;const damage=t.player.damage;
  t.shoot(false);assert.equal(t.bullets.length,3);assert.equal(t.bullets[0].damage,damage/3);
  assert.equal(t.bullets.reduce((n,b)=>n+b.damage,0),damage);
  t.shoot(true);assert.equal(t.bullets[3].damage,damage/3*1.35);
});
test('Projectiles kill in world coordinates beyond the old viewport',({t})=>{
  quietField(t);assert(t.player.x>t.W);assert(t.player.y>t.H);
  t.enemies.push(enemy(t.player.x+80,t.player.y,{hp:t.player.damage}));
  t.shoot(false);t.update(.1);
  assert.equal(t.enemies.length,1);assert.equal(t.kills,1);assert.equal(t.gems.length,1);assert(t.gems[0].value>0);
});
test('Pursuing enemies chase and contact damage has invulnerability',({t})=>{
  const x=t.player.x-80;t.enemies=[enemy(x,t.player.y,{speed:56})];t.shotClock=Infinity;
  t.update(.1);assert(t.enemies[0].x>x);t.enemies[0].x=t.player.x;t.enemies[0].y=t.player.y;
  const hp=t.player.hp;t.update(.01);assert.equal(t.player.hp,hp-15);t.update(.01);assert.equal(t.player.hp,hp-15);
});
test('Kills drop XP and collecting it triggers three distinct random choices',({t})=>{
  quietField(t);t.enemies.push(enemy(t.player.x+200,t.player.y,{hp:0}));
  t.enemies.push(enemy(t.player.x+300,t.player.y,{hp:0,type:1,xp:3}));t.update(.01);
  assert.equal(t.kills,2);assert.equal(t.enemies.length,1);assert.equal(t.gems.length,2);
  assert.equal(t.gems.reduce((sum,g)=>sum+g.value,0),5);
  t.player.xp=t.player.need-1;t.gems=[{x:t.player.x,y:t.player.y,value:1}];t.update(.01);
  assert.equal(t.state,'upgrade');assert.equal(t.choices.length,3);
  assert.equal(new Set(t.choices.map(u=>u.id)).size,3);
  const selected=t.choices[0].id;t.choose(0);assert.equal(t.player.level,2);
  assert.equal(t.player.upgrades[selected],1);assert.equal(t.state,'playing');
});
test('Experience drops draw a large outlined crystal, halo and XP label',({t,drawCalls})=>{
  t.enemies=[];t.gems=[];drawCalls.length=0;t.draw();
  const baseCrystalCount=drawCalls.filter(c=>c.method==='strokeRect').length;
  t.gems=[{x:t.player.x+80,y:t.player.y+45,value:3}];drawCalls.length=0;t.draw();
  const crystal=drawCalls.filter(c=>c.method==='strokeRect');assert.equal(crystal.length,baseCrystalCount+1);
  assert(crystal.some(c=>c.args[2]>=12&&c.args[3]>=12));
  assert(drawCalls.some(c=>c.method==='ellipse'&&c.args[2]>=15&&c.args[0]===t.gems[0].x));
  assert(drawCalls.some(c=>c.method==='fillText'&&c.args[0]==='XP'));
  t.gems[0].x=-200;drawCalls.length=0;t.draw();assert(!drawCalls.some(c=>c.method==='fillText'&&c.args[0]==='XP'));
});
function freshBuildPlayer(t,extra={}) {
  const p={damage:18,rate:2,speed:190,maxHp:100,hp:50,shots:1,pickup:62,volleyBonus:0,xpMult:1,critChance:0,critMultiplier:1.5,skillCooldown:1,baseSkillCooldown:1,defense:0,regen:0,upgrades:{},...extra};
  p.baseStats=Object.freeze({damage:p.damage,rate:p.rate,speed:p.speed,pickup:p.pickup,shots:p.shots});t.builds.init(p);return p;
}
function cloneBuildPlayer(p) { const copy=JSON.parse(JSON.stringify(p));copy.baseStats=p.baseStats;return copy; }
test('All thirty-two upgrade types, two categories and all three rarities are reachable',({t})=>{
  assert.equal(t.upgradeDefs.length,32);assert.equal(t.upgradeDefs.filter(d=>d.category==='attack').length,16);assert.equal(t.upgradeDefs.filter(d=>d.category==='attribute').length,16);
  t.player.critChance=.04; // The full catalog becomes reachable after the critical-damage prerequisite.
  const draws=new Set(),qualities=new Set(),types=new Set();
  for(let i=0;i<300;i++){
    t.upgrade();assert.equal(t.choices.length,3);assert.equal(new Set(t.choices.map(u=>u.id)).size,3);draws.add(t.choices.map(u=>u.id).sort().join(','));
    for(const u of t.choices){assert([1,1.5,2].includes(u.rarity.mult));assert(u.rarity.name);assert.equal(u.desc,u.describe(u.rarity.mult,t.player));qualities.add(u.rarity.mult);types.add(u.id)}
  }
  assert(draws.size>1);assert(qualities.has(1));assert(qualities.has(1.5));assert(qualities.has(2));assert.equal(types.size,32);
  for(const id of ['damage','rate','speed','hp','shots','pickup']){
    const p=freshBuildPlayer(t),ordinary=t.builds.choose(p,id,1);assert(ordinary.applied);const stat=id==='hp'?'maxHp':id;
    const epic=freshBuildPlayer(t);assert(t.builds.choose(epic,id,2).applied);
    assert(p[stat]>freshBuildPlayer(t)[stat]);if(id==='shots'){assert.equal(epic.shots,p.shots);assert(epic.volleyBonus>p.volleyBonus)}else assert(epic[stat]>p[stat]);
  }
});
test('Choosing an upgrade applies its displayed rarity and counts exactly one build level',({t})=>{
  t.upgrade();const choice=t.choices[0],expected=cloneBuildPlayer(t.player);assert(t.builds.choose(expected,choice.id,choice.rarity.mult).applied);
  t.player.xp=t.player.need;t.choose(0);assert.equal(t.player.level,2);assert.equal(t.player.build.levels[choice.id],1);assert.equal(t.player.build.powers[choice.id],choice.rarity.mult);assert.equal(t.player.upgrades[choice.id],1);
  for(const key of Object.keys(expected))if(typeof expected[key]==='number'&&!['xp','need','level'].includes(key))assert.equal(t.player[key],expected[key],key);
});
test('All six base upgrade rewards match the ordinary, rare and epic build budgets',({t})=>{
  const close=(a,b)=>assert(Math.abs(a-b)<1e-8,`${a} should equal ${b}`);
  for(const m of [1,1.5,2])for(const id of ['damage','rate','speed','hp','shots','pickup']){
    const p=freshBuildPlayer(t);assert(t.builds.choose(p,id,m).applied);
    if(id==='damage')close(p.damage,18+18*.12*m);if(id==='rate')close(p.rate,2+2*.08*m);
    if(id==='speed')close(p.speed,190+190*.04*m);if(id==='pickup')close(p.pickup,62+62*.20*m);
    if(id==='hp'){assert.equal(p.maxHp,100+14*m);assert.equal(p.hp,50+21*m)}
    if(id==='shots'){assert.equal(p.shots,2);close(p.volleyBonus,.18*m);close(t.seedDamage(p)*p.shots,18*(1+.18*m))}
  }
});
test('Damage and rate add to the original loadout and stop at level five',({t})=>{
  const base=t.player.baseStats;assert(Object.isFrozen(base));
  for(let i=0;i<5;i++){assert(t.builds.choose(t.player,'damage',1).applied);assert(t.builds.choose(t.player,'rate',1).applied)}
  assert(Math.abs(t.player.damage-base.damage*1.6)<1e-8);assert(Math.abs(t.player.rate-base.rate*1.4)<1e-8);
  const before={damage:t.player.damage,rate:t.player.rate};for(let i=0;i<15;i++){assert(!t.builds.choose(t.player,'damage',2).applied);assert(!t.builds.choose(t.player,'rate',2).applied)}
  assert.equal(t.player.damage,before.damage);assert.equal(t.player.rate,before.rate);assert.equal(t.player.build.attackChoices,10);assert.equal(t.player.baseStats,base);
});
test('Movement, pickup and multishot stop at independent level and numerical limits',({t})=>{
  const base=t.player.baseStats;for(let i=0;i<5;i++)for(const id of ['speed','pickup','shots'])assert(t.builds.choose(t.player,id,2).applied);
  assert(Math.abs(t.player.speed-base.speed*1.4)<1e-8);assert(Math.abs(t.player.pickup-base.pickup*3)<1e-8);assert.equal(t.player.shots,base.shots+5);
  const before=JSON.stringify(t.player);for(const id of ['speed','pickup','shots']){assert(!t.builds.available(t.player,id));assert(!t.builds.choose(t.player,id,2).applied)}assert.equal(JSON.stringify(t.player),before);
});
test('The fifth multishot choice adds one seed and inherits its own epic damage quality',({t})=>{
  for(let i=0;i<4;i++)assert(t.builds.choose(t.player,'shots',1).applied);const shots=t.player.shots,bonus=t.player.volleyBonus;
  assert(t.builds.available(t.player,'shots'));assert(t.builds.choose(t.player,'shots',2).applied);assert.equal(t.player.shots,shots+1);assert(Math.abs(t.player.volleyBonus-bonus-.36)<1e-8);
  assert.equal(t.player.build.levels.shots,5);assert(!t.builds.available(t.player,'shots'));assert(!t.builds.choose(t.player,'shots').applied);
});
test('Final multishot quality keeps ordinary, rare and epic volley benefits ascending',({t})=>{
  for(let i=0;i<4;i++)assert(t.builds.choose(t.player,'shots',1).applied);const before=t.seedDamage(t.player)*t.player.shots,benefits=[];
  for(const m of [1,1.5,2]){
    const p=cloneBuildPlayer(t.player),bonus=p.volleyBonus;assert(t.builds.choose(p,'shots',m).applied);assert.equal(p.shots,p.baseStats.shots+5);assert(Math.abs(p.volleyBonus-bonus-.18*m)<1e-8);
    const volley=t.seedDamage(p)*p.shots;assert(volley>before);benefits.push(volley);const snapshot=JSON.stringify(p);assert(!t.builds.choose(p,'shots',m).applied);assert.equal(JSON.stringify(p),snapshot);
  }
  assert(benefits[0]<benefits[1]);assert(benefits[1]<benefits[2]);
});
test('Four slots per category exclude new types while preserving levels of selected types',({t})=>{
  for(const id of ['damage','rate','shots','chain','speed','hp','pickup','range'])assert(t.builds.choose(t.player,id).applied);
  const allowed=new Set(['damage','rate','shots','chain','speed','hp','pickup','range']);
  for(let i=0;i<40;i++){t.upgrade();assert(t.choices.length>0&&t.choices.length<=3);assert(t.choices.every(u=>allowed.has(u.id)))}
  assert(!t.builds.choose(t.player,'bees').applied);assert(!t.builds.choose(t.player,'xp').applied);assert.equal(t.player.build.attackSlots.length,4);assert.equal(t.player.build.attributeSlots.length,4);
});
test('Fully developed builds convert later XP into 25 percent healing without another build choice',({t,element})=>{
  quietField(t);for(const id of ['damage','rate','shots','chain','speed','hp','pickup','range'])for(let i=0;i<5;i++)assert(t.builds.choose(t.player,id).applied);
  assert.equal(t.builds.pool(t.player).length,0);assert.equal(t.player.build.attackChoices,20);assert.equal(t.player.build.attributeChoices,20);
  t.player.hp=1;const maxHp=t.player.maxHp,level=t.player.level,buildBefore=JSON.stringify(t.player.build),need=t.player.need;t.player.xp=need;t.update(.01);
  assert.equal(t.state,'playing');assert.equal(t.player.level,level+1);assert.equal(t.player.xp,0);assert.equal(t.player.hp,Math.min(maxHp,1+maxHp*.25));assert.equal(JSON.stringify(t.player.build),buildBefore);
  assert(element('overlay').classList.contains('hidden'));
  for(let i=0;i<10;i++){t.player.xp=t.player.need;t.update(.01);assert.equal(t.state,'playing')}
  assert.equal(t.player.hp,maxHp);assert.equal(t.player.build.attackChoices,20);assert.equal(t.player.build.attributeChoices,20);assert.equal(t.player.level,level+11);
});
test('Rare multishot cards grant one added seed and the advertised intermediate volley gain',({t})=>{
  let found=null;for(let i=0;i<300&&!found;i++){t.upgrade();found=t.choices.find(u=>u.id==='shots'&&u.rarity.mult===1.5)}
  assert(found);const p=cloneBuildPlayer(t.player);assert(t.builds.choose(p,found.id,found.rarity.mult).applied);assert.equal(p.shots,t.player.shots+1);assert(Math.abs(p.volleyBonus-.27)<1e-8);
  assert(Math.abs(t.seedDamage(p)*p.shots/(t.seedDamage(t.player)*t.player.shots)-1.27)<1e-8);
});
test('Health rewards heal injured spirits and never exceed the new maximum',({t})=>{
  for(const m of [1,1.5,2])for(const hp of [0,1,50,100]){const p=freshBuildPlayer(t,{hp});assert(t.builds.choose(p,'hp',m).applied);assert.equal(p.maxHp,100+14*m);assert.equal(p.hp,Math.min(p.maxHp,hp+21*m));assert(p.hp>hp);assert(p.hp<=p.maxHp)}
});
test('Upgrade descriptions state the rarity gain and selected cards match their description',({t})=>{
  for(const d of t.upgradeDefs)for(const m of [1,1.5,2]){const description=d.describe(m,t.player);assert(description.length>10);assert(!/NaN|undefined|Infinity/.test(description))}
  const damage=t.upgradeDefs.find(u=>u.id==='damage'),hp=t.upgradeDefs.find(u=>u.id==='hp');assert.notEqual(damage.describe(1,t.player),damage.describe(2,t.player));assert.notEqual(hp.describe(1,t.player),hp.describe(2,t.player));
  t.upgrade();for(const u of t.choices)assert.equal(u.desc,u.describe(u.rarity.mult,t.player));
});
test('Level costs increase smoothly and every chapter provides exactly thirty upgrade choices',({t})=>{
  assert.equal(t.experienceNeed(1),180);assert.equal(t.experienceNeed(2),184);assert.equal(t.experienceNeed(3),189);
  assert.equal(t.experienceNeed(10),243);assert.equal(t.experienceNeed(20),377);
  assert.equal(t.experienceNeed(30),577);assert.equal(t.experienceNeed(31),601);
  assert.equal(t.experienceNeed(40),844);assert.equal(t.experienceNeed(41),850);assert.equal(t.experienceNeed(42),885);
  for(let level=2;level<=100;level++)assert(t.experienceNeed(level)>t.experienceNeed(level-1));
  for(const s of t.stages){
    assert.equal(s.xpRewards.length,s.enemyCount);let xp=s.xpRewards.reduce((sum,value)=>sum+value,0),level=1;
    assert.equal(xp,10000);assert.equal(xp,t.experience.budget());
    while(xp>=t.experienceNeed(level)){xp-=t.experienceNeed(level);level++}
    assert.equal(level,31);assert.equal(xp,0);
  }
});
test('Actual chapter kills and pickups take eight kills for the first choice and offer only two choices across twenty kills',({t,element})=>{
  const victims=t.enemies.filter(e=>!e.boss&&!e.elite).slice(0,20);
  assert.equal(victims.reduce((sum,e)=>sum+e.xp,0),470);assert.equal(t.player.xpMult,1);
  quietField(t);let selected=0;
  for(let i=0;i<victims.length;i++){
    const victim=victims[i];victim.hp=0;victim.x=t.player.x;victim.y=t.player.y;t.enemies.push(victim);t.update(.001);
    const collected=t.stageXP.collected,issued=t.stageXP.issued;
    if(i<7){assert.equal(t.state,'playing');assert.equal(t.player.level,1)}
    if(i===7){assert.equal(t.state,'upgrade');assert.equal(t.player.level,1);assert(element('overlay').innerHTML.includes('本关总经验 10,000 · 30 次升级'))}
    while(t.state==='upgrade'){
      const index=t.choices.findIndex(choice=>choice.id!=='xp');assert(index>=0);t.choose(index);selected++;
    }
    t.update(.001);assert.equal(t.stageXP.collected,collected);assert.equal(t.stageXP.issued,issued);
    assert.equal(t.gems.length,0);
  }
  assert.equal(t.kills,20);assert.equal(t.stageXP.issued,470);assert.equal(t.stageXP.collected,470);
  assert.equal(selected,2);assert.equal(t.player.level,3);assert.equal(t.player.xp,106);assert.equal(t.state,'playing');
  assert.equal(element('level').textContent,'LV. 3 / 31');assert.equal(element('xpText').textContent,'106 / 189');
});
test('Stacked experience bonuses on a real first fly kill cannot trigger an opening upgrade',({t})=>{
  const victim=t.enemies.find(e=>!e.boss&&!e.elite&&e.type===1);assert(victim);
  quietField(t);t.player.xpMult=1.06*1.10*1.15*1.5+.08;
  victim.hp=0;victim.x=t.player.x;victim.y=t.player.y;t.enemies.push(victim);t.update(.001);
  const award=Math.floor(victim.xp*t.player.xpMult);
  assert.equal(t.player.xp,award);assert(award<t.experienceNeed(1));assert.equal(t.player.level,1);assert.equal(t.state,'playing');
  const snapshot=JSON.stringify(t.stageXP.snapshot());t.update(.001);assert.equal(JSON.stringify(t.stageXP.snapshot()),snapshot);
});
test('Surplus XP offers a fresh choice for each earned level',({t})=>{
  quietField(t);t.player.xp=t.experienceNeed(1)+t.experienceNeed(2)+t.experienceNeed(3);t.update(.01);assert.equal(t.state,'upgrade');
  t.choose(0);assert.equal(t.player.level,2);assert.equal(t.state,'upgrade');assert.equal(t.choices.length,3);
  t.choose(1);assert.equal(t.player.level,3);assert.equal(t.state,'upgrade');
  t.choose(2);assert.equal(t.player.level,4);assert.equal(t.state,'playing');assert(t.player.xp<t.player.need);
});
test('Pause and upgrade dialogs freeze gameplay frames',({t})=>{
  quietField(t);t.frame(1000);t.pause();let time=t.elapsed;t.frame(2000);assert.equal(t.elapsed,time);
  t.resume();t.frame(2020);assert(t.elapsed>time);t.upgrade();time=t.elapsed;t.frame(3000);assert.equal(t.elapsed,time);
});
test('The compact upgrade layout clears before pause, stage, equipment or orchard panels reopen',({t,element})=>{
  t.upgrade();assert(element('overlay').classList.contains('upgrade-overlay'));
  t.player.xp=t.player.need;t.choose(0);assert(element('overlay').classList.contains('hidden'));
  t.pause();assert.equal(t.state,'paused');assert(!element('overlay').classList.contains('upgrade-overlay'));
  t.startScreen();assert(!element('overlay').classList.contains('upgrade-overlay'));
  t.showArmory();assert(!element('overlay').classList.contains('upgrade-overlay'));
  t.showOrchard();assert(!element('overlay').classList.contains('upgrade-overlay'));
});
test('Touch drag moves and releasing stops movement',({t,listeners})=>{
  quietField(t);listeners['arena:pointerdown']({pointerId:1,clientX:300,clientY:300,target:{closest:()=>null}});
  listeners['arena:pointermove']({pointerId:1,clientX:360,clientY:300});let x=t.player.x;t.update(.1);assert(t.player.x>x);
  listeners['arena:pointerup']({pointerId:1});x=t.player.x;t.update(.1);assert.equal(t.player.x,x);
});
test('Defeat gives no rewards and restart resets run-only upgrades',({t})=>{
  const before=JSON.stringify(t.profile);t.player.hp=1;t.enemies=[enemy(t.player.x,t.player.y)];t.shotClock=Infinity;t.update(.01);
  assert.equal(t.state,'ended');assert.equal(JSON.stringify(t.profile),before);
  t.start();assert.equal(t.player.hp,t.player.maxHp);assert.equal(t.elapsed,0);assert.equal(t.enemies.length,t.activeStage.enemyCount);
  assert.equal(t.player.level,1);assert.equal(t.kills,0);assert.equal(t.gems.length,0);assert.equal(Object.keys(t.player.upgrades).length,0);
});
test('No countdown or elapsed-time victory remains',({t})=>{
  assert(!/id=["']timer["']/.test(html));assert(!html.includes('守护倒计时'));
  quietField(t);t.elapsed=179.98;t.update(.04);assert.equal(t.state,'playing');assert(t.elapsed>180);
  t.elapsed=3600;t.update(.04);assert.equal(t.state,'playing');assert.equal(t.enemies.length,1);
});
test('A timed boss encounter saves the rescued spirit only after the entire roster is defeated',({t,element,bosses,rescues,storage})=>{
  const profile=JSON.stringify(t.profile);
  for(const e of t.enemies)if(!e.boss)e.hp=0;
  t.shotClock=Infinity;t.elapsed=t.activeStage.bossSchedule[0];t.update(.01);assert.equal(t.kills,t.activeStage.normalCount+t.activeStage.eliteCount);assert.equal(t.enemies.length,1);
  assert.equal(t.state,'playing');assert.equal(JSON.stringify(t.profile),profile);
  assert(element('bossForecast').textContent.includes(bosses[0].name));
  assert.equal(t.state,'playing');const boss=t.enemies[0];assert(boss.boss&&boss.aggro);
  assert.equal(boss.xp,t.activeStage.xpRewards[t.activeStage.normalCount+t.activeStage.eliteCount]);
  boss.hp=0;t.update(.01);assert.equal(t.state,'upgrade');assert.equal(t.kills,t.activeStage.enemyCount);assert.equal(t.enemies.length,0);
  assert(t.profile.clearedStages.includes(1),'The actual victory is saved while final growth choices remain pending');
  drainUpgradeChoices(t);assert.equal(t.state,'rescue');assert.equal(t.player.level,31);assert.equal(t.player.xp,0);assert.equal(t.gems.length,0);
  assert(element('overlay').innerHTML.includes(rescues[0].name));
  assert.equal(t.profile.unlockedStage,2);assert(t.profile.clearedStages.includes(1));assert.equal(t.profile.rescuedSprites.length,1);
  const saved=JSON.stringify(t.profile),reloaded=createGame(storage);assert.equal(JSON.stringify(reloaded.t.profile),saved);
  t.completeRescue();assert.equal(t.state,'ended');assert.equal(JSON.stringify(t.profile),saved);t.draw();
});

test('First twenty stages have complete rising combat values, valid batches and rewards',({t})=>{
  const names=new Set();let previous=null;
  for(const s of t.stages.slice(0,20)){
    assert.equal(s.id,names.size+1);assert(s.name&&s.description);names.add(s.name);
    assert.equal(s.normalCount,398);assert.equal(s.eliteCount,4+2*s.id);assert.equal(s.bossCount,s.id);
    assert.equal(s.enemyCount,s.normalCount+s.eliteCount+s.bossCount);assert(Number.isInteger(s.fastCount)&&s.fastCount>0&&s.fastCount<s.normalCount);
    assert.deepEqual(Array.from(s.bossIds),Array.from({length:s.id},(_,i)=>i+1));
    assert.equal(s.bossSchedule.length,s.id);assert(s.bossSchedule[0]>=60&&s.bossSchedule[0]<=65);
    assert(s.bossSchedule.every((at,i)=>at>=60&&(i===0||at-s.bossSchedule[i-1]>=22)));
    assert.equal(s.bossActiveCap,1);assert.equal(s.bossRecovery,12);assert(!Object.hasOwn(s,'bossTriggers'));
    assert.equal(s.fastCount%2,0);assert.equal(s.initialPursuers%2,0);assert.equal(s.batchSize%2,0);
    for(const type of ['slow','fast'])for(const stat of ['hp','speed','damage','xp']){
      assert(Number.isFinite(s[type][stat])&&s[type][stat]>0);
      if(previous)assert(s[type][stat]>=previous[type][stat]);
    }
    assert(s.fast.speed>s.slow.speed);assert(s.slow.hp>s.fast.hp);
    for(const n of [s.initialPursuers,s.batchSize,s.pursuitInterval,s.reward.seeds,s.reward.cores])assert(Number.isFinite(n)&&n>0);
    assert(s.initialPursuers<398);assert(Number.isInteger(s.initialPursuers)&&Number.isInteger(s.batchSize));
    if(previous){assert(s.pursuitInterval<=previous.pursuitInterval);assert(s.reward.seeds>=previous.reward.seeds);assert(s.reward.cores>=previous.reward.cores)}
    if(s.firstClearGear)assert(t.gearDefs[s.firstClearGear]);
    previous=s;
  }
  assert.equal(names.size,20);assert(t.stages[19].slow.hp>t.stages[0].slow.hp);assert(t.stages[19].fast.hp>t.stages[0].fast.hp);
});
test('Every stage spawns the exact normal, elite and accumulated boss roster with independent schedules',({t,bosses})=>{
  t.startScreen();t.profile.unlockedStage=100;
  for(const s of t.stages){
    t.startScreen();assert(t.selectStage(s.id));t.start();assert.equal(t.activeStage.id,s.id);assert.equal(t.enemies.length,s.enemyCount);
    assert.equal(t.enemies.filter(e=>e.type===1).length,s.fastCount);
    assert.equal(t.enemies.filter(e=>!e.boss&&!e.elite&&e.type===0).length,s.normalCount-s.fastCount);
    assert.equal(t.enemies.filter(e=>e.elite).length,s.eliteCount);assert.equal(t.enemies.filter(e=>e.boss).length,s.bossCount);
    assert.equal(t.enemies.filter(e=>e.aggro).length,s.initialPursuers);
    for(let i=0;i<t.enemies.length;i++){
      const e=t.enemies[i];
      assert.equal(e.xp,s.xpRewards[i]);
      if(e.boss){const order=i-s.normalCount-s.eliteCount,stats=bosses[s.bossIds[order]-1];assert.equal(e.type,2);assert.equal(e.hp,stats.hp);assert.equal(e.speed,stats.speed);assert.equal(e.damage,stats.damage);assert.equal(e.pursuitAt,Infinity);assert.equal(e.aggro,false);assert.equal(e.introduced,false);assert.equal(e.bossOrder,order);assert.equal(e.bossArrivalAt,s.bossSchedule[order]);continue}
      if(e.elite){
        for(const key of ['hp','speed','damage'])assert.equal(e[key],s.elite[key]);
        assert.equal(e.r,25);assert.equal(e.maxHp,s.elite.hp);assert.equal(e.type,0);
        assert.equal(e.pursuitAt,s.eliteFirstAt+Math.floor((i-s.normalCount)/s.eliteBatchSize)*s.eliteInterval);continue;
      }
      const stats=e.type?s.fast:s.slow;
      for(const key of ['hp','speed','damage'])assert.equal(e[key],stats[key]);
      assert.equal(e.pursuitAt,i<s.initialPursuers?0:(1+Math.floor((i-s.initialPursuers)/s.batchSize))*s.pursuitInterval);
    }
    const lastTime=Math.max(...t.enemies.filter(e=>!e.boss).map(e=>e.pursuitAt));t.elapsed=lastTime;t.player.inv=1e9;t.shotClock=Infinity;
    t.update(.001);assert.equal(t.enemies.filter(e=>e.aggro).length,s.normalCount+s.eliteCount+1);assert.equal(t.state,'playing');
  }
});
test('Elite reinforcements use their own clock independently of ordinary pursuit batches',({t})=>{
  const s=t.activeStage;t.player.inv=1e9;t.shotClock=Infinity;for(const e of t.enemies)e.speed=0;
  const activeElites=()=>t.enemies.filter(e=>e.elite&&e.aggro).length;
  assert.equal(activeElites(),0);t.elapsed=s.eliteFirstAt-.002;t.update(.001);assert.equal(activeElites(),0);
  t.update(.002);assert.equal(activeElites(),s.eliteBatchSize);
  t.elapsed=s.eliteFirstAt+s.eliteInterval-.002;t.update(.001);assert.equal(activeElites(),s.eliteBatchSize);
  t.update(.002);assert.equal(activeElites(),Math.min(s.eliteCount,2*s.eliteBatchSize));
  assert.equal(t.bossIndex,0);assert.equal(t.nonBossKills,0);assert.equal(t.readyBoss(),null);
});
test('Dormant elites remain invisible, intangible and untargetable until their reinforcement time',({t,drawCalls})=>{
  const elite=t.enemies.find(e=>e.elite);assert(elite);elite.x=t.player.x;elite.y=t.player.y;
  t.enemies=[];drawCalls.length=0;t.draw();const empty=JSON.stringify(drawCalls);
  t.enemies=[elite];drawCalls.length=0;t.draw();assert.equal(JSON.stringify(drawCalls),empty);
  t.shoot(false);assert.equal(t.bullets.length,0);const hp=t.player.hp,eliteHp=elite.hp;
  t.bullets.push({x:elite.x,y:elite.y,vx:0,vy:0,damage:1e6,life:1});t.shotClock=Infinity;t.update(.001);
  assert.equal(t.player.hp,hp);assert.equal(elite.hp,eliteHp);assert.equal(t.kills,0);
  elite.aggro=true;drawCalls.length=0;t.draw();assert.notEqual(JSON.stringify(drawCalls),empty);
});
test('Visible elites draw their identity and a health bar matching current health',({t,drawCalls})=>{
  const elite=t.enemies.find(e=>e.elite);elite.x=t.player.x+100;elite.y=t.player.y;elite.aggro=true;elite.hp=elite.maxHp/2;
  t.enemies=[elite];drawCalls.length=0;t.draw();
  assert(drawCalls.some(c=>c.method==='fillText'&&c.args[0]==='精英'&&c.args[1]===elite.x));
  assert(drawCalls.some(c=>c.method==='fillRect'&&c.args[0]===elite.x-25&&c.args[2]===50&&c.args[3]===5));
  assert(drawCalls.some(c=>c.method==='fillRect'&&c.args[0]===elite.x-25&&c.args[2]===25&&c.args[3]===5));
});
test('The combat HUD separately counts ordinary bugs, elite reinforcements and defeated bosses',({t,element})=>{
  const s=t.activeStage;assert.equal(element('enemyTypes').textContent,`普通 ${s.normalCount} · 精英 ${s.eliteCount} · Boss 0 / ${s.bossCount}`);
  t.enemies.find(e=>!e.boss&&!e.elite).hp=0;t.enemies.find(e=>e.elite).hp=0;t.shotClock=Infinity;t.update(.001);
  assert.equal(element('enemyTypes').textContent,`普通 ${s.normalCount-1} · 精英 ${s.eliteCount-1} · Boss 0 / ${s.bossCount}`);
  assert.equal(element('remaining').textContent,s.enemyCount-2);
});
test('A defeated elite gives its larger experience reward while Boss eligibility uses only time',({t})=>{
  const elite=t.enemies.find(e=>e.elite);assert(elite.xp>t.activeStage.slow.xp);
  elite.x=t.player.x+300;elite.y=t.player.y;elite.hp=0;
  t.enemies=[elite,enemy(40,40,{aggro:false,pursuitAt:Infinity})];t.shotClock=Infinity;t.update(.001);
  assert.equal(t.kills,1);assert.equal(t.nonBossKills,1);assert.equal(t.bossKills,0);
  assert.equal(t.gems.length,1);assert.equal(t.gems[0].value,elite.xp*t.player.xpMult);
});
test('Stage two mixes sequential bosses with surviving bugs, respects recovery and pays after the complete roster',({t,element,bosses})=>{
  prepareStage(t,2);const s=t.activeStage,before=JSON.stringify(t.profile);
  assert.equal(t.bossIndex,0);assert.equal(t.bossKills,0);assert.equal(t.nonBossKills,0);
  assert.equal(t.readyBoss(),null);assert.equal(t.announceBossArrival(),false);
  t.elapsed=s.bossSchedule[0]-.002;t.update(.001);assert.equal(t.state,'playing');assert.equal(t.readyBoss(),null);
  t.update(.002);assert.equal(t.state,'playing');assert.equal(t.bossIndex,1);assert.equal(t.nonBossKills,0);
  assert(element('bossForecast').textContent.includes(bosses[0].name));assert.equal(t.enemies.filter(e=>e.boss&&e.introduced).length,1);
  assert.equal(element('bossName').textContent,'1 / 2 · '+bosses[0].name);assert(!element('bossHud').classList.contains('hidden'));
  assert.equal(t.enemies.filter(e=>e.boss&&e.aggro).length,1);assert.equal(JSON.stringify(t.profile),before);
  const first=t.enemies.find(e=>e.boss&&e.aggro);assert.equal(first.stageId,1);
  const elapsed=t.elapsed;t.pause();t.frame(1000);assert.equal(t.elapsed,elapsed);t.resume();
  t.elapsed=s.bossSchedule[1]-.002;t.update(.001);assert.equal(t.state,'playing');assert.equal(t.readyBoss(),null);
  t.update(.002);
  assert.equal(t.state,'playing');assert.equal(t.bossIndex,1);assert.equal(t.readyBoss(),null);
  assert.equal(t.enemies.filter(e=>e.boss&&e.aggro).length,1);
  first.hp=0;t.update(.001);assert.equal(t.bossKills,1);assert.equal(JSON.stringify(t.profile),before);
  assert.notEqual(t.state,'rescue');assert.notEqual(t.state,'ended');assert.equal(t.startEndless(),false);
  const recovery=t.nextBossAllowedAt;assert(Math.abs(recovery-t.elapsed-12)<1e-8);drainUpgradeChoices(t);
  t.elapsed=recovery-.002;t.update(.001);assert.equal(t.state,'playing');assert.equal(t.readyBoss(),null);
  t.update(.002);assert.equal(t.state,'playing');assert.equal(t.bossIndex,2);assert(element('bossForecast').textContent.includes(bosses[1].name));
  assert.equal(t.nonBossKills,0);assert.equal(t.enemies.filter(e=>!e.boss&&e.hp>0).length,s.normalCount+s.eliteCount);
  assert.equal(t.enemies.filter(e=>e.boss&&e.aggro).length,1);
  const second=t.enemies.find(e=>e.boss&&e.stageId===2);assert(second.aggro);
  assert.equal(t.enemies.filter(e=>e.boss&&e.aggro).length,1);assert.equal(t.readyBoss(),null);
  second.hp=0;t.update(.001);drainUpgradeChoices(t);assert.equal(t.bossKills,2);assert.equal(t.state,'playing');assert.equal(JSON.stringify(t.profile),before);
  killNonBossCount(t,s.normalCount+s.eliteCount);assert.equal(t.state,'upgrade');assert(t.profile.clearedStages.includes(2));
  drainUpgradeChoices(t);assert.equal(t.state,'rescue');assert.equal(t.kills,s.enemyCount);assert.equal(t.player.level,31);assert.equal(t.player.xp,0);
  assert.equal(t.profile.seeds,s.reward.seeds);assert.equal(t.profile.cores,s.reward.cores);
  assert.deepEqual(Array.from(t.profile.clearedStages),[2]);assert.deepEqual(Array.from(t.profile.rescuedSprites),[2]);
  const paid=JSON.stringify(t.profile);t.completeRescue();t.completeRescue();t.finish(true);t.finish(false);assert.equal(JSON.stringify(t.profile),paid);
});
test('Stage twenty encounters every earlier boss in order and pays only after the complete roster is defeated',({t,bosses,element})=>{
  prepareStage(t,20);const s=t.activeStage,before=JSON.stringify(t.profile),seen=[];
  for(let i=0;i<20;i++){
    t.elapsed=Math.max(s.bossSchedule[i],t.nextBossAllowedAt);drainUpgradeChoices(t);if(t.state==='playing')t.update(.001);
    assert.equal(t.state,'playing');assert.equal(t.bossIndex,i+1);assert(element('bossForecast').textContent.includes(bosses[i].name));
    const hp=t.player.hp,time=t.elapsed;for(let frame=0;frame<15;frame++)t.frame(1000+(i*20+frame)*40);
    assert.equal(t.state,'playing');assert.equal(t.player.hp,hp);assert(t.elapsed>time);
    assert.equal(t.enemies.filter(e=>e.boss&&e.aggro).length,1);
    const boss=t.enemies.find(e=>e.boss&&e.aggro);assert.equal(boss.stageId,i+1);seen.push(boss.name);boss.hp=0;t.update(.001);
    assert.equal(t.bossKills,i+1);
    assert.notEqual(t.state,'rescue');assert.equal(JSON.stringify(t.profile),before);assert.equal(t.nonBossKills,0);drainUpgradeChoices(t);
  }
  assert.deepEqual(seen,Array.from(bosses.slice(0,20).map(b=>b.name)));assert.equal(t.nonBossKills,0);
  killNonBossCount(t,s.normalCount+s.eliteCount);assert.equal(t.nonBossKills,s.normalCount+s.eliteCount);
  assert.equal(t.kills,s.enemyCount);assert.equal(t.enemies.length,0);assert.equal(t.state,'upgrade');assert(t.profile.clearedStages.includes(20));
  drainUpgradeChoices(t);assert.equal(t.state,'rescue');assert.equal(t.player.level,31);assert.equal(t.player.xp,0);
  assert.equal(t.profile.seeds,s.reward.seeds);assert.equal(t.profile.cores,s.reward.cores);assert.deepEqual(Array.from(t.profile.rescuedSprites),[20]);
  t.completeRescue();assert.equal(t.state,'ended');assert(t.startEndless());assert(t.enemies.every(e=>!e.boss&&!e.elite));
});
test('Returning to or reloading a stage restarts elite and boss schedules without premature rewards',({t,storage})=>{
  prepareStage(t,3);const s=t.activeStage,oldProfile=JSON.stringify(t.profile);t.elapsed=s.bossSchedule[0];t.update(.001);
  assert.equal(t.state,'playing');t.enemies.find(e=>e.boss&&e.aggro).hp=0;t.update(.001);
  assert.equal(t.bossKills,1);assert.equal(JSON.stringify(t.profile),oldProfile);t.startScreen();t.saveProfile();
  t.start();assert.equal(t.kills,0);assert.equal(t.nonBossKills,0);assert.equal(t.bossKills,0);assert.equal(t.bossIndex,0);
  assert.equal(t.enemies.length,s.enemyCount);assert(t.enemies.filter(e=>e.boss).every(e=>!e.introduced&&!e.aggro));
  const loaded=createGame(storage);assert(loaded.t.selectStage(3));loaded.t.start();assert.equal(loaded.t.activeStage.id,3);
  assert.equal(loaded.t.nonBossKills,0);assert.equal(loaded.t.bossKills,0);assert.equal(loaded.t.bossIndex,0);
  assert.equal(loaded.t.enemies.filter(e=>e.elite&&e.aggro).length,0);assert.equal(loaded.t.readyBoss(),null);
  assert.equal(JSON.stringify(loaded.t.profile),oldProfile);
});
test('Boss time arrivals are not accelerated by clearing all small bugs early',({t})=>{
  t.player.inv=1e9;t.shotClock=Infinity;
  killNonBossCount(t,t.activeStage.normalCount+t.activeStage.eliteCount);
  assert.equal(t.state,'playing');assert.equal(t.bossIndex,0);assert.equal(t.readyBoss(),null);
  t.elapsed=t.activeStage.bossSchedule[0]-.002;t.update(.001);assert.equal(t.state,'playing');
  t.update(.002);assert.equal(t.state,'playing');assert.equal(t.bossIndex,1);
});
test('Later chapters serialize all time-ready bosses and keep the twelve-second recovery frozen while paused',({t})=>{
  prepareStage(t,6);const s=t.activeStage,before=JSON.stringify(t.profile);t.elapsed=s.bossSchedule.at(-1)+20;
  for(let order=1;order<=s.bossCount;order++){
    t.update(.001);assert.equal(t.state,'playing');assert.equal(t.bossIndex,order);
    const arriving=t.enemies.find(e=>e.boss&&e.introduced&&e.aggro&&e.hp>0);
    assert(arriving);assert.equal(arriving.stageId,order);assert.equal(t.nonBossKills,0);
    assert(arriving.aggro);
    assert.equal(t.enemies.filter(e=>e.boss&&e.aggro&&e.hp>0).length,1);
    t.update(.001);assert.equal(t.state,'playing');assert.equal(t.readyBoss(),null);
    assert(t.enemies.filter(e=>e.boss&&e.stageId>order).every(e=>!e.introduced&&!e.aggro));
    arriving.hp=0;t.update(.001);drainUpgradeChoices(t);assert.equal(t.bossKills,order);
    assert.equal(t.enemies.filter(e=>e.boss&&e.aggro&&e.hp>0).length,0);
    const recovery=t.nextBossAllowedAt,time=t.elapsed;assert(Math.abs(recovery-time-12)<1e-8);
    t.pause();for(let i=0;i<10;i++)t.frame(1000+order*500+i*40);assert.equal(t.elapsed,time);assert.equal(t.nextBossAllowedAt,recovery);t.resume();
    t.elapsed=recovery-.002;t.update(.001);assert.equal(t.state,'playing');assert.equal(t.readyBoss(),null);
    t.elapsed=recovery;assert.equal(t.nonBossKills,0);assert.equal(JSON.stringify(t.profile),before);
  }
  assert.equal(t.bossIndex,s.bossCount);assert.equal(t.readyBoss(),null);
  assert.equal(t.nonBossKills,0);assert.equal(JSON.stringify(t.profile),before);
});
test('All 100 victories unlock consecutive stages, pay rewards and award the intended gear',({t,element,rescues})=>{
  let seeds=0,cores=0;
  for(const s of t.stages){
    if(s.id>1){assert(t.selectStage(s.id));t.start()}
    clearStage(t);
    assert.equal(t.state,'ended');seeds+=s.reward.seeds;cores+=s.reward.cores;
    assert.equal(t.profile.seeds,seeds);assert.equal(t.profile.cores,cores);
    assert.equal(t.profile.unlockedStage,Math.min(100,s.id+1));assert.equal(t.profile.clearedStages.length,s.id);
    assert.equal(t.profile.rescuedSprites.length,Math.min(20,s.id));
    assert(element('overlay').innerHTML.includes('id="startEndless"'));
    assert(t.profile.rescuedSprites.includes(rescues[(s.id-1)%20].id));
    if(s.firstClearGear)assert.equal(t.profile.inventory[s.firstClearGear].level,0);
    const rewarded=JSON.stringify(t.profile);t.finish(true);assert.equal(JSON.stringify(t.profile),rewarded);
  }
  assert.equal(Object.keys(t.profile.inventory).length,Object.keys(t.gearDefs).length);
  assert(!element('overlay').innerHTML.includes('id="nextStage"'));assert(!t.selectStage(101));
});
test('Replaying a cleared stage pays reduced currency without duplicate gear or stage records',({t})=>{
  clearStage(t);const s=t.activeStage,firstSeeds=t.profile.seeds,firstCores=t.profile.cores;
  t.start();clearStage(t);
  assert.equal(t.profile.seeds,firstSeeds+Math.max(1,Math.floor(s.reward.seeds*.25)));
  assert.equal(t.profile.cores,firstCores+Math.max(1,Math.floor(s.reward.cores*.25)));
  assert.equal(t.profile.clearedStages.length,1);assert.equal(t.profile.unlockedStage,2);
  assert.equal(t.profile.rescuedSprites.length,1);
  const paid=JSON.stringify(t.profile);t.finish(true);t.finish(false);assert.equal(JSON.stringify(t.profile),paid);
});
test('Stage selection rejects locked levels and cannot alter an active run',({t})=>{
  assert(!t.selectStage(2));assert.equal(t.selectedStage,1);
  t.pause();assert(!t.selectStage(1));assert(!t.selectStage(2));t.resume();t.upgrade();assert(!t.selectStage(1));
  t.startScreen();assert(!t.selectStage(0));assert(!t.selectStage(21));assert(!t.selectStage(1.5));assert(!t.selectStage('1'));
  assert(t.selectStage(1));assert.equal(t.selectedStage,1);
});
test('Weapons, armor and charms change the next run with their displayed stats',({t})=>{
  t.startScreen();
  for(const id of Object.keys(t.gearDefs))t.profile.inventory[id]={level:0};
  assert(t.equipGear('weapon_pea'));t.start();assert.equal(t.player.damage,16);assert.equal(t.player.rate,4.3);assert.equal(t.player.shots,1);
  t.startScreen();assert(t.equipGear('weapon_cherry'));assert(t.equipGear('armor_bark'));assert(t.equipGear('charm_bloom'));t.start();
  assert.equal(t.player.damage,18);assert.equal(t.player.rate,2.05);assert.equal(t.player.shots,2);assert.equal(t.player.maxHp,140);assert.equal(t.player.defense,2);
  assert.equal(t.player.speed,215*.97);assert.equal(t.player.pickup,115);
  t.startScreen();assert(t.equipGear('weapon_pumpkin'));assert(t.equipGear('armor_rind'));assert(t.equipGear('charm_harvest'));t.start();
  assert.equal(t.player.damage,27);assert.equal(t.player.rate,1.05);assert.equal(t.player.shots,3);assert.equal(t.player.maxHp,170);assert.equal(t.player.defense,4);
  assert.equal(t.player.speed,220*.95);assert.equal(t.player.pickup,140);assert.equal(t.player.xpMult,1.15);
  assert(!t.equipGear('weapon_seed'));assert(!t.upgradeGear('weapon_seed'));
});
test('Strengthening gear deducts its cost, improves stats and stops at level 10',({t})=>{
  t.startScreen();assert(!t.upgradeGear('weapon_seed'));assert.equal(t.profile.seeds,0);
  assert(!t.equipGear('weapon_pumpkin'));assert(!t.equipGear('unknown'));assert(!t.upgradeGear('unknown'));
  t.profile.seeds=10000;t.profile.cores=1000;
  for(let level=0;level<10;level++){
    const seeds=t.profile.seeds,cores=t.profile.cores,cost=t.gearCost('weapon_seed');
    assert.equal(cost.seeds,35+level*25);assert.equal(cost.cores,1+Math.floor(level/4));
    assert(t.upgradeGear('weapon_seed'));assert.equal(t.profile.inventory.weapon_seed.level,level+1);
    assert.equal(t.profile.seeds,seeds-cost.seeds);assert.equal(t.profile.cores,cores-cost.cores);
  }
  const before=JSON.stringify(t.profile);assert(!t.upgradeGear('weapon_seed'));assert.equal(JSON.stringify(t.profile),before);
  assert(t.upgradeGear('armor_leaf'));assert(t.upgradeGear('charm_sprout'));t.start();
  assert.equal(t.player.damage,35.2);assert(Math.abs(t.player.rate-3.6)<1e-8);assert.equal(t.player.maxHp,118);assert.equal(t.player.defense,.5);
  assert.equal(t.player.speed,208);assert.equal(t.player.pickup,91);
});
test('Armor mitigates enemy damage and a harvest charm increases kill experience',({t})=>{
  t.startScreen();t.profile.inventory.armor_rind={level:2};t.profile.inventory.charm_harvest={level:0};
  t.equipGear('armor_rind');t.equipGear('charm_harvest');t.start();const hp=t.player.hp;
  t.enemies=[enemy(t.player.x,t.player.y)];t.shotClock=Infinity;t.update(.001);
  assert.equal(t.player.hp,hp-10);t.enemies.push(enemy(t.player.x+200,t.player.y,{hp:0,xp:20}));t.update(.001);
  assert.equal(t.gems.length,1);assert.equal(t.gems[0].value,23);
});
test('Permanent rewards, unlocks, equipped items and gear levels survive a page reload',({t,storage})=>{
  clearStage(t);assert(t.selectStage(2));t.start();clearStage(t);
  assert(t.equipGear('weapon_pea'));assert(t.upgradeGear('weapon_pea'));
  const saved=JSON.stringify(t.profile),reloaded=createGame(storage);
  assert.equal(JSON.stringify(reloaded.t.profile),saved);assert.equal(reloaded.t.selectedStage,3);reloaded.t.start();
  t.start();for(const stat of ['damage','rate','maxHp','defense','speed','pickup','xpMult'])assert.equal(reloaded.t.player[stat],t.player[stat]);
  assert.equal(reloaded.t.player.level,1);assert.equal(reloaded.t.player.xp,0);assert.equal(Object.keys(reloaded.t.player.upgrades).length,0);
});
test('Invalid or stale saves fall back safely and numeric fields are bounded',()=>{
  for(const value of ['{bad json',JSON.stringify({version:0}),JSON.stringify(null)]){
    const {t}=createGame(new Map([['orchard-save-v1',value]]));assert.equal(t.profile.unlockedStage,1);assert.equal(t.profile.seeds,0);t.start();
  }
  const raw={version:1,unlockedStage:99,seeds:-200,cores:1e30,clearedStages:[1,1,-2,21,'3'],inventory:{weapon_seed:{level:99},armor_leaf:{level:-3},charm_sprout:{level:2.7},fake:{level:10}},equipped:{weapon:'fake',armor:'weapon_seed',charm:'charm_sprout'}};
  const {t}=createGame(new Map([['orchard-save-v1',JSON.stringify(raw)]]));
  assert.equal(t.profile.unlockedStage,99);assert.equal(t.profile.seeds,0);assert.equal(t.profile.cores,999999);
  assert.equal(JSON.stringify(t.profile.clearedStages),'[1,21]');assert.equal(t.profile.inventory.weapon_seed.level,10);assert.equal(t.profile.inventory.armor_leaf.level,0);
  assert.equal(t.profile.inventory.charm_sprout.level,2);assert(!t.profile.inventory.fake);assert.equal(t.profile.equipped.weapon,'weapon_seed');assert.equal(t.profile.equipped.armor,'armor_leaf');t.start();
});
test('Unavailable browser storage keeps the game and its current-page rewards usable',()=>{
  const blocked={has(){throw new Error('Storage disabled')},set(){throw new Error('Storage disabled')}};
  const {t,element}=createGame(blocked);
  assert.equal(t.state,'lobby');assert(element('overlay').innerHTML.includes('存储不可用'));
  t.start();clearStage(t);assert.equal(t.profile.unlockedStage,2);assert(t.profile.seeds>0);
  assert(element('overlay').innerHTML.includes('存储不可用'));assert(t.selectStage(2));t.start();assert.equal(t.activeStage.id,2);
});
test('Menu buttons support the complete start, next-stage, workshop and return flow',(game)=>{
  const {t,element}=game;
  t.startScreen();assert.equal(t.state,'lobby');menuControls(game);click(game,'start');assert.equal(t.state,'playing');
  clearStage(t);
  assert.equal(t.state,'ended');click(game,'nextStage');assert.equal(t.state,'playing');assert.equal(t.activeStage.id,2);
  t.pause();assert.equal(t.state,'paused');click(game,'leave');assert.equal(t.state,'lobby');
  click(game,'navArmory');assert.equal(t.state,'armory');assert(element('overlay').innerHTML.includes('橙籽弹弓'));menuControls(game);
  click(game,'backLobby');assert.equal(t.state,'lobby');assert.equal(t.selectedStage,2);
});

test('The single-page navigation retains the chosen stage and starts it from every menu',(game)=>{
  const {t}=game;t.startScreen();t.profile.unlockedStage=20;t.startScreen();
  for(let id=2;id<=20;id++)click(game,'nextStagePreview');assert.equal(t.selectedStage,20);menuControls(game);
  click(game,'navArmory');assert.equal(t.state,'armory');menuControls(game);
  click(game,'navOrchard');assert.equal(t.state,'orchard');menuControls(game);
  click(game,'navStages');assert.equal(t.state,'lobby');assert.equal(t.selectedStage,20);menuControls(game);
  for(const open of ['navArmory','navOrchard','navHeroes']){
    click(game,open);menuControls(game);click(game,'start');assert.equal(t.activeStage.id,20);assert.equal(t.state,'playing');t.startScreen();
  }
});
test('All hundred carousel previews remain accessible while locked stages cannot be entered',(game)=>{
  const {t,element}=game;t.startScreen();assert(element('previousStage').disabled);assert(!element('start').disabled);
  for(let id=2;id<=100;id++){
    click(game,'nextStagePreview');assert.equal(t.previewStage,id);assert.equal(t.selectedStage,1);assert(element('start').disabled);
    element('start').onclick();assert.equal(t.state,'lobby');assert.equal(t.selectedStage,1);
    assert(element('overlay').innerHTML.includes(t.art.stages[id-1].image));assert(element('overlay').innerHTML.includes(t.stages[id-1].name));
  }
  assert(element('nextStagePreview').disabled);assert(!t.browseStage(1));
  click(game,'previousStage');assert.equal(t.previewStage,99);assert(!t.selectStage(99));
  t.profile.unlockedStage=20;t.startScreen();
  for(let id=1;id<=20;id++){assert.equal(t.selectedStage,id);assert(!element('start').disabled);menuControls(game);if(id<20)click(game,'nextStagePreview')}
});
test('Workshop category buttons show four weapons or three items and preserve equipment actions',(game)=>{
  const {t,element}=game;t.startScreen();t.profile.seeds=10000;t.profile.cores=1000;
  for(const id of Object.keys(t.gearDefs))t.profile.inventory[id]={level:0};click(game,'navArmory');
  for(const [slot,count]of [['weapon',4],['armor',3],['charm',3]]){
    dataButton(game,'data-gear-slot',slot).onclick();assert.equal(t.selectedGearSlot,slot);menuControls(game);
    const markup=element('overlay').innerHTML;assert.equal((markup.match(/<article class="gear-card/g)||[]).length,count);
    const equipment=element('overlay').querySelectorAll('[data-equip]');assert.equal(equipment.length,count);
    assert(equipment.every(b=>t.gearDefs[b.dataset.equip].slot===slot));
    const id=Object.keys(t.gearDefs).find(id=>t.gearDefs[id].slot===slot&&id!==t.profile.equipped[slot]);
    dataButton(game,'data-equip',id).onclick();assert.equal(t.profile.equipped[slot],id);assert.equal(t.selectedGearSlot,slot);
    assert.equal(dataButton(game,'data-equip',id).disabled,true);
    const seeds=t.profile.seeds,cores=t.profile.cores,cost=t.gearCost(id);dataButton(game,'data-enhance',id).onclick();
    assert.equal(t.profile.inventory[id].level,1);assert.equal(t.profile.seeds,seeds-cost.seeds);assert.equal(t.profile.cores,cores-cost.cores);
    assert.equal(t.selectedGearSlot,slot);menuControls(game);
  }
  click(game,'navOrchard');click(game,'navArmory');assert.equal(t.selectedGearSlot,'charm');
  click(game,'start');assert.equal(t.player.maxHp,148);assert.equal(t.player.pickup,121);assert.equal(t.player.shots,1);
});
test('Locked equipment stays visible in its category without equip or strengthen actions',(game)=>{
  const {t,element}=game;t.startScreen();click(game,'navArmory');
  for(const slot of ['weapon','armor','charm']){
    dataButton(game,'data-gear-slot',slot).onclick();menuControls(game);
    const visible=element('overlay').querySelectorAll('[data-equip]');assert.equal(visible.length,1);
    assert(t.profile.inventory[visible[0].dataset.equip]);assert.equal(visible[0].disabled,true);
    const upgrades=element('overlay').querySelectorAll('[data-enhance]');assert.equal(upgrades.length,1);assert.equal(upgrades[0].disabled,true);
  }
});
test('All twenty orchard residents select one training panel and keep their selection during growth',(game)=>{
  const {t,element,rescues}=game;t.startScreen();t.profile.rescuedSprites=rescueCopy(rescues);t.profile.seeds=10000;t.profile.cores=1000;
  for(const id of t.profile.rescuedSprites)t.profile.spriteLevels[id]=0;click(game,'navOrchard');
  assert.equal(element('overlay').querySelectorAll('[data-select-sprite]').length,20);
  for(const sprite of rescues){
    dataButton(game,'data-select-sprite',sprite.id).onclick();assert.equal(t.selectedSprite,sprite.id);menuControls(game);
    assert.equal(element('overlay').querySelectorAll('[data-grow-sprite]').length,1);
    assert.equal(element('growSelectedSprite').dataset.growSprite,String(sprite.id));
    assert.equal((element('overlay').innerHTML.match(/sprite-detail/g)||[]).length,1);
  }
  const id=rescues[19].id,cost=t.spriteCost(id),seeds=t.profile.seeds,cores=t.profile.cores;
  click(game,'growSelectedSprite');assert.equal(t.profile.spriteLevels[id],1);assert.equal(t.profile.seeds,seeds-cost.seeds);assert.equal(t.profile.cores,cores-cost.cores);
  click(game,'growOrchard');assert.equal(t.profile.orchard.level,1);assert.equal(t.selectedSprite,id);menuControls(game);
  click(game,'navArmory');click(game,'navOrchard');assert.equal(t.selectedSprite,id);
  for(let i=1;i<5;i++)click(game,'growSelectedSprite');assert.equal(t.profile.spriteLevels[id],5);assert.equal(element('growSelectedSprite').disabled,true);
  click(game,'backLobby');assert.equal(t.state,'lobby');assert.equal(t.profile.rescuedSprites.length,20);
});
function rescueCopy(rescues) { return Array.from(rescues,sprite=>sprite.id); }

test('Twenty unique bosses and rescue spirits cover every stage with valid combat values',({bosses,rescues})=>{
  assert.equal(bosses.length,100);assert.equal(rescues.length,20);
  assert.equal(new Set(rescues.map(s=>s.id)).size,20);assert.equal(new Set(bosses.map(b=>b.name)).size,100);
  let previous=null;
  for(let i=0;i<20;i++){
    const boss=bosses[i],spirit=rescues[i];assert(boss.name);assert(spirit.id&&spirit.name);
    for(const stat of ['hp','speed','damage']){assert(Number.isFinite(boss[stat])&&boss[stat]>0);if(previous)assert(boss[stat]>=previous[stat]);}
    previous=boss;
  }
  assert(bosses[19].hp>bosses[0].hp);assert(bosses[19].damage>bosses[0].damage);
});
test('Boss arrival preserves held input, projectiles and clocks, and only activates once',({t,element,listeners})=>{
  prepareStage(t,1);t.elapsed=t.activeStage.bossSchedule[0];t.keys.add('d');
  listeners['arena:pointerdown']({pointerId:17,clientX:100,clientY:100,target:{closest:()=>null}});
  listeners['arena:pointermove']({pointerId:17,clientX:140,clientY:100});
  t.bullets.push({x:t.player.x,y:t.player.y,vx:1,vy:0,life:10,damage:1,hitTargets:new Set()});
  const bullets=t.bullets,still=t.still,shotClock=t.shotClock,inv=t.player.inv,elapsed=t.elapsed;
  const before=JSON.stringify(t.profile);assert(t.announceBossArrival());
  assert.equal(t.state,'playing');assert(t.keys.has('d'));assert.equal(t.bullets,bullets);assert.equal(t.bullets.length,1);
  assert.equal(t.still,still);assert.equal(t.shotClock,shotClock);assert.equal(t.player.inv,inv);assert.equal(t.elapsed,elapsed);
  assert(element('overlay').classList.contains('hidden'));assert(!element('overlay').innerHTML.includes('fightBoss'));
  assert(element('bossForecast').textContent.includes('Boss登场'));assert(!element('bossForecast').classList.contains('hidden'));
  assert(!t.announceBossArrival());assert.equal(t.bossIndex,1);assert.equal(JSON.stringify(t.profile),before);
  const boss=t.enemies.find(e=>e.boss&&e.aggro);assert(boss);assert.equal(boss.chargeClock,3);
  t.keys.clear();const x=t.player.x;t.update(.04);assert(t.player.x>x,'The held touch drag survives arrival');assert(t.elapsed>elapsed);
});

test('Bosses activate immediately and rescue animations complete automatically through animation frames',({t})=>{
  t.frame(1000);for(const e of t.enemies)if(!e.boss)e.hp=0;t.shotClock=Infinity;t.elapsed=t.activeStage.bossSchedule[0];t.update(.001);
  let now=1000;
  for(let i=0;i<150&&t.state==='playing';i++){now+=40;t.frame(now)}
  assert.equal(t.state,'playing');const boss=t.enemies.find(e=>e.boss);assert(boss.aggro);boss.hp=0;t.update(.001);
  assert.equal(t.state,'upgrade');drainUpgradeChoices(t);assert.equal(t.state,'rescue');const elapsed=t.elapsed,hp=t.player.hp;
  for(let i=0;i<20;i++){now+=40;t.frame(now)}
  assert.equal(t.state,'rescue');assert.equal(t.elapsed,elapsed);assert.equal(t.player.hp,hp);
  for(let i=0;i<150&&t.state==='rescue';i++){now+=40;t.frame(now)}
  assert.equal(t.state,'ended');assert.equal(t.profile.rescuedSprites.length,1);
  const paid=JSON.stringify(t.profile);t.completeRescue();assert.equal(JSON.stringify(t.profile),paid);
});
test('Pausing after a boss arrival freezes combat, and hidden tabs still freeze rescue animations',({t,document})=>{
  t.frame(1000);for(const e of t.enemies)if(!e.boss)e.hp=0;t.shotClock=Infinity;t.elapsed=t.activeStage.bossSchedule[0];t.update(.001);
  assert.equal(t.state,'playing');t.pause();const elapsed=t.elapsed;let now=1000;document.hidden=true;
  for(let i=0;i<150;i++){now+=40;t.frame(now)}
  assert.equal(t.state,'paused');assert.equal(t.elapsed,elapsed);document.hidden=false;t.resume();
  t.enemies.find(e=>e.boss).hp=0;t.update(.001);assert.equal(t.state,'upgrade');drainUpgradeChoices(t);assert.equal(t.state,'rescue');document.hidden=true;
  for(let i=0;i<150;i++){now+=40;t.frame(now)}
  assert.equal(t.state,'rescue');document.hidden=false;
  for(let i=0;i<150&&t.state==='rescue';i++){now+=40;t.frame(now)}assert.equal(t.state,'ended');
});

test('Earned upgrades are resolved before a simultaneous boss time arrival',({t})=>{
  for(const e of t.enemies)if(!e.boss)e.hp=0;t.shotClock=Infinity;t.player.xp=t.player.need;t.elapsed=t.activeStage.bossSchedule[0];t.update(.001);
  assert.equal(t.state,'upgrade');assert.equal(t.enemies.length,1);assert.equal(t.enemies[0].aggro,false);
  t.choose(0);assert.equal(t.player.level,2);assert.equal(t.state,'playing');t.update(.001);
  assert.equal(t.state,'playing');assert.equal(t.enemies.length,1);
});
test('Boss arrival notice is immediate despite queued relic notices and expires without clicks',({t,element})=>{
  prepareStage(t,1);t.noticeQueue.push({title:'等待展示的饰品',kind:'relic'});const queued=t.noticeQueue.length;
  t.elapsed=t.activeStage.bossSchedule[0];assert(t.announceBossArrival());assert.equal(t.noticeQueue.length,queued);
  assert(element('bossForecast').classList.contains('arrival-notice'));
  assert.equal(t.enemies.filter(e=>e.boss&&e.aggro).length,1);assert.equal(t.readyBoss(),null);
  for(const e of t.enemies)e.chargeClock=100;t.keys.add('d');
  t.update(1);assert(!element('bossForecast').classList.contains('hidden'));t.update(3.01);
  assert.equal(t.state,'playing');assert(t.keys.has('d'));assert(element('bossForecast').classList.contains('hidden'));
  assert(!element('bossForecast').classList.contains('arrival-notice'));assert(element('overlay').classList.contains('hidden'));
});

test('Freshly introduced bosses wait three combat seconds and then warn for nine tenths before charging',({t})=>{
  prepareStage(t,1);t.elapsed=t.activeStage.bossSchedule[0];t.update(.001);assert.equal(t.state,'playing');
  const boss=t.enemies.find(e=>e.boss&&e.aggro);boss.speed=0;boss.x=t.player.x+300;boss.y=t.player.y;
  const x=boss.x,y=boss.y;assert.equal(boss.chargeClock,3);
  t.update(1);t.update(1);t.update(.999);assert.equal(boss.windup,0);assert.equal(boss.dashTime,0);
  t.update(.002);assert.equal(boss.windup,.9);assert.equal(boss.x,x);assert.equal(boss.y,y);
  t.update(.4);t.update(.4);assert(boss.windup>0);assert.equal(boss.dashTime,0);
  t.update(.101);assert.equal(boss.windup,0);assert.equal(boss.dashTime,.7);assert.equal(boss.x,x);assert.equal(boss.y,y);
});

test('Boss charges warn before moving, keep their aimed direction and respect collision invulnerability',({t})=>{
  for(const e of t.enemies)if(!e.boss)e.hp=0;t.shotClock=Infinity;t.elapsed=t.activeStage.bossSchedule[0];t.update(.001);t.gems=[];
  const boss=t.enemies[0];boss.x=t.player.x-boss.r-t.player.r-5;boss.y=t.player.y;boss.chargeClock=0;
  const x=boss.x,y=boss.y,hp=t.player.hp;t.update(.01);assert(boss.windup>0);assert.equal(boss.x,x);assert.equal(t.player.hp,hp);
  t.update(.4);t.update(.4);assert.equal(boss.x,x);assert.equal(boss.y,y);assert.equal(t.player.hp,hp);
  t.update(.11);assert(boss.dashTime>0);assert.equal(boss.x,x);t.update(.04);
  assert(boss.x>x);assert.equal(t.player.hp,hp-Math.max(1,boss.damage-t.player.defense));
  const hitHp=t.player.hp;t.update(.04);assert.equal(t.player.hp,hitHp);
  t.player.y+=100;const dashX=boss.x;t.update(.04);assert(boss.x>dashX);assert.equal(boss.y,y);
  boss.x=t.WORLD_W-boss.r-22;boss.dashX=1;boss.dashY=0;boss.dashTime=.7;t.update(.04);
  assert.equal(boss.x,t.WORLD_W-boss.r-22);
});
test('Defeat or abandoned boss encounters never rescue a spirit or pay clear rewards',({t})=>{
  for(const e of t.enemies)if(!e.boss)e.hp=0;t.shotClock=Infinity;t.elapsed=t.activeStage.bossSchedule[0];t.update(.001);
  const before=JSON.stringify(t.profile);t.player.hp=1;t.player.inv=0;
  const boss=t.enemies.find(e=>e.boss);boss.x=t.player.x;boss.y=t.player.y;t.update(.001);
  assert.equal(t.state,'ended');assert.equal(JSON.stringify(t.profile),before);t.completeRescue();assert.equal(JSON.stringify(t.profile),before);
  t.start();for(const e of t.enemies)if(!e.boss)e.hp=0;t.shotClock=Infinity;t.elapsed=t.activeStage.bossSchedule[0];t.update(.001);
  t.startScreen();assert.equal(JSON.stringify(t.profile),before);assert.equal(t.state,'lobby');
});
test('The orchard starts empty and exposes rescued residents through the lobby and results',(game)=>{
  const {t,element,rescues}=game;
  t.startScreen();assert.deepEqual(Array.from(t.profile.rescuedSprites),[]);assert.equal(t.profile.orchard.level,0);
  click(game,'navOrchard');assert.equal(t.state,'orchard');assert(element('overlay').innerHTML.includes('0 / 20'));menuControls(game);
  assert.equal(element('overlay').querySelectorAll('[data-select-sprite]').length,0);assert.equal(element('overlay').querySelectorAll('[data-grow-sprite]').length,0);
  click(game,'backLobby');t.start();clearStage(t);
  click(game,'resultOrchard');assert.equal(t.state,'orchard');assert(element('overlay').innerHTML.includes(rescues[0].name));menuControls(game);
  assert.equal(t.profile.rescuedSprites[0],rescues[0].id);assert.equal(t.profile.spriteLevels[rescues[0].id],0);
  assert.equal(t.selectedSprite,rescues[0].id);click(game,'backLobby');assert.equal(t.state,'lobby');
});
test('Orchard improvements charge earned materials, improve the next run and stop at level ten',({t})=>{
  t.startScreen();assert(!t.upgradeOrchard());t.profile.seeds=10000;t.profile.cores=1000;
  t.start();const baseline={...t.player};t.startScreen();
  for(let level=0;level<10;level++){
    const seeds=t.profile.seeds,cores=t.profile.cores,cost=t.orchardCost();
    assert.equal(cost.seeds,50+level*35);assert.equal(cost.cores,1+Math.floor(level/4));
    assert(t.upgradeOrchard());assert.equal(t.profile.orchard.level,level+1);
    assert.equal(t.profile.seeds,seeds-cost.seeds);assert.equal(t.profile.cores,cores-cost.cores);
  }
  const saved=JSON.stringify(t.profile);assert(!t.upgradeOrchard());assert.equal(JSON.stringify(t.profile),saved);
  t.start();assert(t.player.maxHp>baseline.maxHp);assert(t.player.pickup>baseline.pickup);
  assert(!t.upgradeOrchard());assert.equal(JSON.stringify(t.profile),saved);
});
test('Rescued spirit training charges materials, adds combat benefits and stops at level five',({t,rescues})=>{
  t.startScreen();assert(!t.upgradeSprite(rescues[0].id));assert(!t.upgradeSprite('missing'));
  t.profile.seeds=10000;t.profile.cores=1000;t.start();clearStage(t);
  const id=rescues[0].id;t.start();const baseline={...t.player};t.startScreen();t.showOrchard();
  for(let level=0;level<5;level++){
    const seeds=t.profile.seeds,cores=t.profile.cores,cost=t.spriteCost(id);
    assert.equal(cost.seeds,20+level*22);assert.equal(cost.cores,1+Math.floor(level/4));
    assert(t.upgradeSprite(id));assert.equal(t.profile.spriteLevels[id],level+1);
    assert.equal(t.profile.seeds,seeds-cost.seeds);assert.equal(t.profile.cores,cores-cost.cores);
  }
  const saved=JSON.stringify(t.profile);assert(!t.upgradeSprite(id));assert.equal(JSON.stringify(t.profile),saved);
  t.start();assert.equal(t.player.maxHp,baseline.maxHp+5*rescues[0].bonusPerLevel);
  assert(!t.upgradeSprite(id));assert.equal(JSON.stringify(t.profile),saved);
});
test('Orchard and spirit growth survive reload and repeated clears preserve training',({t,storage,rescues})=>{
  clearStage(t);t.showOrchard();t.profile.seeds=2000;t.profile.cores=100;const id=rescues[0].id;
  assert(t.upgradeOrchard());assert(t.upgradeSprite(id));t.start();clearStage(t);
  assert.equal(t.profile.rescuedSprites.length,1);assert.equal(t.profile.spriteLevels[id],1);
  t.start();const expected={...t.player};const saved=JSON.stringify(t.profile),reloaded=createGame(storage);
  assert.equal(JSON.stringify(reloaded.t.profile),saved);reloaded.t.start();
  for(const stat of ['damage','rate','maxHp','defense','speed','pickup','xpMult'])assert.equal(reloaded.t.player[stat],expected[stat]);
});
test('Legacy saves migrate their cleared stages into residents and bound new growth fields',({rescues})=>{
  const legacy={version:1,unlockedStage:4,clearedStages:[1,2,3],seeds:100,cores:10};
  const migrated=createGame(new Map([['orchard-save-v1',JSON.stringify(legacy)]]));
  assert.equal(migrated.t.profile.orchard.level,0);assert.equal(migrated.t.profile.rescuedSprites.length,3);
  assert.equal(JSON.stringify(migrated.t.profile.rescuedSprites),JSON.stringify(rescues.slice(0,3).map(s=>s.id)));
  const raw={...legacy,orchard:{level:99},rescuedSprites:[rescues[0].id,rescues[0].id,rescues[1].id,rescues[2].id,'fake'],spriteLevels:{[rescues[0].id]:99,[rescues[1].id]:-3,[rescues[2].id]:2.7,fake:99}};
  const loaded=createGame(new Map([['orchard-save-v1',JSON.stringify(raw)]]));
  assert.equal(loaded.t.profile.orchard.level,10);assert.equal(loaded.t.profile.spriteLevels[rescues[0].id],5);
  assert.equal(loaded.t.profile.spriteLevels[rescues[1].id],0);assert.equal(loaded.t.profile.spriteLevels[rescues[2].id],2);
  assert(!loaded.t.profile.rescuedSprites.includes('fake'));assert(!Object.hasOwn(loaded.t.profile.spriteLevels,'fake'));loaded.t.start();
});

test('Endless mode is available only after a real boss victory and completed rescue',({t,element})=>{
  assert.equal(t.runMode,'stage');assert(!t.startEndless());assert(!t.finishEndless());
  t.pause();assert(!t.startEndless());t.resume();
  for(const e of t.enemies)if(!e.boss)e.hp=0;t.shotClock=Infinity;t.elapsed=t.activeStage.bossSchedule[0];t.update(.001);
  assert.equal(t.state,'playing');assert(!t.startEndless());
  assert(!t.startEndless());t.enemies.find(e=>e.boss).hp=0;t.update(.001);
  assert.equal(t.state,'upgrade');assert(!t.startEndless());drainUpgradeChoices(t);
  assert.equal(t.state,'rescue');assert(!t.startEndless());t.completeRescue();
  assert(element('overlay').innerHTML.includes('id="startEndless"'));t.player.xp=0;t.gems=[];
  assert(t.startEndless());assert(!t.startEndless());
  t.finishEndless(true);assert(!t.startEndless());t.start();
  t.player.hp=1;t.player.inv=0;t.enemies=[enemy(t.player.x,t.player.y)];t.update(.001);
  assert.equal(t.state,'ended');assert(!element('overlay').innerHTML.includes('id="startEndless"'));assert(!t.startEndless());
});
test('Endless entry keeps the current build and experience, heals health and resets its own stats',({t,element})=>{
  clearStage(t);t.player.upgrades.damage=2;t.player.damage*=1.6;t.player.shots=4;t.player.hp=3;t.player.xp=2;t.gems=[{x:40,y:40,value:7}];
  const before={...t.player},saved=JSON.stringify(t.profile),gem=t.gems[0];
  element('startEndless').onclick();assert.equal(t.state,'playing');assert.equal(t.runMode,'endless');
  for(const key of ['damage','rate','shots','speed','pickup','level','xp','need','maxHp'])assert.equal(t.player[key],before[key]);
  assert.equal(t.player.upgrades.damage,2);assert.equal(t.player.hp,t.player.maxHp);assert(t.player.inv>0);
  assert.equal(t.gems[0],gem);assert.equal(t.elapsed,0);assert.equal(t.kills,0);assert.equal(t.endlessWave,1);
  assert.equal(JSON.stringify(t.profile),saved);assert(t.enemies.length>0);assert(t.enemies.every(e=>e.aggro&&!e.boss));
});
test('All 100 cleared stages enter endless using their own enemy stats without new bosses or rescues',({t})=>{
  t.startScreen();t.profile.unlockedStage=100;
  for(const s of t.stages){
    t.startScreen();assert(t.selectStage(s.id));t.start();enterEndless(t);
    assert.equal(t.activeStage.id,s.id);assert.equal(t.endlessWave,1);assert.equal(t.enemies.length,Math.min(90,s.initialPursuers+16));
    for(const e of t.enemies){
      const base=e.type?s.fast:s.slow;
      assert(!e.boss);assert(e.aggro);assert.equal(e.pursuitAt,0);
      assert.equal(e.hp,Math.round(base.hp*1.122));assert.equal(e.damage,Math.round(base.damage*1.045));
      assert.equal(e.speed,base.speed*1.012);assert.equal(e.xp,s.experience.typical[e.type?'fast':'slow']);
    }
    t.enemies=[];t.update(.001);assert.equal(t.state,'playing');assert.equal(t.profile.rescuedSprites.length,Math.min(20,s.id));
    assert(t.finishEndless(true));assert.equal(t.state,'ended');
  }
});
test('Endless waves increase every eight seconds, ramp stats and stay within a performance cap',({t})=>{
  enterEndless(t);freezeBuildAttacks(t);t.player.inv=1e9;t.shotClock=Infinity;for(const e of t.enemies)e.speed=0;
  const firstCount=t.enemies.length;assert.equal(firstCount,t.activeStage.initialPursuers+16);
  for(let i=0;i<199;i++)t.update(.04);assert.equal(t.endlessWave,1);assert.equal(t.enemies.length,firstCount);
  t.update(.05);assert.equal(t.endlessWave,2);assert.equal(t.enemies.length,firstCount+Math.min(90,t.activeStage.initialPursuers+21));
  const secondWave=t.enemies.slice(firstCount);
  for(const e of secondWave){const base=e.type?t.activeStage.fast:t.activeStage.slow;assert.equal(e.hp,Math.round(base.hp*1.248));assert.equal(e.damage,Math.round(base.damage*1.09));}
  for(let i=0;i<40;i++){t.spawnEndlessWave();assert(t.enemies.length<=240)}
  assert.equal(t.enemies.length,240);assert(t.endlessWave>20);assert(t.enemies.every(e=>e.aggro&&!e.boss));
  t.enemies=[];t.spawnEndlessWave();assert.equal(t.enemies.length,90);
  for(const e of t.enemies){const base=e.type?t.activeStage.fast:t.activeStage.slow;assert(e.hp>Math.round(base.hp*1.248));assert.equal(e.speed,base.speed*1.3);assert(e.xp>t.activeStage.experience.typical[e.type?'fast':'slow']);}
});
test('Endless enemies spawn at a safe distance even when the player stands in map corners',({t})=>{
  enterEndless(t);
  for(const [x,y] of [[28,28],[t.WORLD_W-28,28],[28,t.WORLD_H-28],[t.WORLD_W-28,t.WORLD_H-28]]){
    t.player.x=x;t.player.y=y;t.enemies=[];assert(t.spawnEndlessWave());
    for(const e of t.enemies){assert(Math.hypot(e.x-x,e.y-y)>=350);assert(e.x>=40&&e.x<=t.WORLD_W-40);assert(e.y>=40&&e.y<=t.WORLD_H-40);}
  }
});
test('Endless kills still drop experience and award fresh random upgrades without a victory on an empty field',({t})=>{
  enterEndless(t);t.shotClock=Infinity;t.player.xp=t.player.need-1;
  t.enemies=[enemy(t.player.x,t.player.y,{hp:0,xp:1})];t.update(.001);
  assert.equal(t.kills,1);assert.equal(t.state,'upgrade');assert.equal(t.choices.length,3);
  const previous=t.player.level;t.choose(0);assert.equal(t.player.level,previous+1);assert.equal(t.runMode,'endless');
  t.update(.001);assert.equal(t.state,'playing');assert.equal(t.enemies.length,0);
  const rescued=JSON.stringify(t.profile.rescuedSprites);t.spawnEndlessWave();
  assert(t.enemies.length>0);assert.equal(t.state,'playing');assert.equal(JSON.stringify(t.profile.rescuedSprites),rescued);
});
test('Endless loot banks in increments, survives reload and cannot be paid twice on exit',({t,storage})=>{
  enterEndless(t);t.shotClock=Infinity;
  const seeds=t.profile.seeds,cores=t.profile.cores,cleared=JSON.stringify(t.profile.clearedStages),residents=JSON.stringify(t.profile.rescuedSprites);
  const kill=(count)=>{t.enemies=Array.from({length:count},()=>enemy(40,40,{hp:0,xp:0}));t.update(.001)};
  kill(4);assert.equal(t.profile.seeds,seeds);kill(1);assert.equal(t.profile.seeds,seeds+2);assert.equal(t.profile.cores,cores);
  kill(35);assert.equal(t.kills,40);assert.equal(t.profile.seeds,seeds+16);assert.equal(t.profile.cores,cores+1);
  assert.equal(t.endlessCreditedSeeds,16);assert.equal(t.endlessCreditedCores,1);
  const saved=JSON.stringify(t.profile),reloaded=createGame(storage);assert.equal(JSON.stringify(reloaded.t.profile),saved);
  assert.equal(JSON.stringify(t.profile.clearedStages),cleared);assert.equal(JSON.stringify(t.profile.rescuedSprites),residents);
  t.bankEndlessRewards();assert.equal(JSON.stringify(t.profile),saved);assert(t.finishEndless(true));assert.equal(t.state,'ended');
  assert(!t.finishEndless(true));assert(!t.finishEndless(false));t.finish(true);t.finish(false);assert.equal(JSON.stringify(t.profile),saved);
});
test('Endless pause freezes wave spawning and its leave button settles before returning home',({t,element})=>{
  enterEndless(t);t.frame(1000);t.pause();const wave=t.endlessWave,time=t.elapsed;
  assert.equal(t.state,'paused');assert(element('overlay').innerHTML.includes('结束无尽并结算'));
  for(let i=0;i<250;i++)t.frame(1040+i*40);assert.equal(t.endlessWave,wave);assert.equal(t.elapsed,time);
  assert(!t.upgradeGear('weapon_seed'));assert(!t.upgradeOrchard());assert(!t.selectStage(1));
  const before=JSON.stringify(t.profile);element('leave').onclick();assert.equal(t.state,'ended');assert.equal(JSON.stringify(t.profile),before);
  element('resultOrchard').onclick();assert.equal(t.state,'orchard');element('backLobby').onclick();assert.equal(t.state,'lobby');
  assert.equal(t.runMode,'stage');assert(!t.startEndless());t.start();assert.equal(t.enemies.length,t.activeStage.enemyCount);assert.equal(t.runMode,'stage');
});
test('The visible endless exit button and defeat both retain the saved clear and reset for the next stage',({t,element})=>{
  enterEndless(t);t.shotClock=Infinity;t.enemies=Array.from({length:5},()=>enemy(40,40,{hp:0,xp:0}));t.update(.001);
  const saved=JSON.stringify(t.profile);element('endEndless').onclick();assert.equal(t.state,'ended');assert.equal(JSON.stringify(t.profile),saved);
  element('nextStage').onclick();assert.equal(t.activeStage.id,2);assert.equal(t.runMode,'stage');assert.equal(t.enemies.length,t.activeStage.enemyCount);
  enterEndless(t);freezeBuildAttacks(t);t.player.hp=1;t.player.inv=0;t.player.dodge=0;t.player.shield=0;t.enemies=[enemy(t.player.x,t.player.y)];t.shotClock=Infinity;
  const beforeDeath=JSON.stringify(t.profile);t.update(.001);assert.equal(t.state,'ended');assert.equal(t.player.hp,0);assert.equal(JSON.stringify(t.profile),beforeDeath);
  assert(!element('overlay').innerHTML.includes('id="startEndless"'));assert(element('overlay').innerHTML.includes('无尽虫潮结算'));
  element('nextStage').onclick();assert.equal(t.activeStage.id,3);assert.equal(t.runMode,'stage');assert.equal(t.player.level,1);
});
test('New endless XP resolves as random upgrades at entry without losing the completed stage build',({t})=>{
  clearStage(t);t.gems=[];t.player.xp=t.player.need;const level=t.player.level;
  assert(t.startEndless());assert.equal(t.state,'upgrade');assert.equal(t.runMode,'endless');assert.equal(t.endlessWave,1);
  t.choose(0);assert.equal(t.player.level,level+1);assert.equal(t.state,'playing');assert.equal(t.player.xp,0);
});
test('Nearby and capped experience drops merge without losing any earned value',({t})=>{
  t.gems=[];t.dropExperience(40,40,2);t.dropExperience(52,49,3);
  assert.equal(t.gems.length,1);assert.equal(t.gems[0].value,5);
  t.gems=[];let total=0;
  for(let i=0;i<t.XP_NODE_CAP;i++){
    const value=1+i%5;total+=value;t.dropExperience(40+(i%25)*50,40+Math.floor(i/25)*50,value);
  }
  assert.equal(t.gems.length,t.XP_NODE_CAP);assert.equal(t.XP_NODE_CAP,400);
  for(let i=0;i<200;i++){const value=1+i%7;total+=value;t.dropExperience(t.WORLD_W-40-i,t.WORLD_H-40,value)}
  assert.equal(t.gems.length,t.XP_NODE_CAP);assert.equal(t.gems.reduce((sum,g)=>sum+g.value,0),total);
  t.stageXP.grant(total);
  const collected=t.gems[0].value;t.enemies=[enemy(40,t.WORLD_H-40,{aggro:false,pursuitAt:Infinity})];t.shotClock=Infinity;
  t.player.x=t.gems[0].x;t.player.y=t.gems[0].y;t.update(.001);
  assert.equal(t.player.xp,collected);assert.equal(t.gems.reduce((sum,g)=>sum+g.value,0)+t.player.xp,total);
});
test('Very large multishot builds fuse into sixteen projectiles while preserving the balanced volley damage',({t})=>{
  t.enemies=[enemy(t.player.x+400,t.player.y)];t.player.shots=123;t.player.damage=37.5;t.player.volleyBonus=4.5;
  const totalDamage=t.player.damage*t.player.baseStats.shots*(1+t.player.volleyBonus);
  t.shoot(false);assert.equal(t.bullets.length,16);
  assert(Math.abs(t.bullets.reduce((sum,b)=>sum+b.damage,0)-totalDamage)<1e-8);
  for(const b of t.bullets){assert(b.size>=5&&b.size<=8);assert(b.vx>0)}
  t.bullets.length=0;t.shoot(true);
  assert.equal(t.bullets.length,16);assert(Math.abs(t.bullets.reduce((sum,b)=>sum+b.damage,0)-totalDamage*1.35)<1e-8);
});
test('High fire-rate compensation preserves combined standstill damage and rate bonuses',({t})=>{
  t.enemies=[enemy(t.player.x+400,t.player.y)];t.player.rate=1000;t.player.shots=80;t.player.damage=18;t.player.volleyBonus=3;
  t.keys.add('d');t.shotClock=0;t.update(.001);assert.equal(t.bullets.length,16);
  const movingDamage=t.bullets.reduce((sum,b)=>sum+b.damage,0);
  assert(Math.abs(movingDamage*14-t.player.damage*t.player.baseStats.shots*(1+t.player.volleyBonus)*t.player.rate)<1e-6);
  assert.equal(t.shotClock,1/14);t.bullets.length=0;t.keys.clear();t.shotClock=Infinity;t.update(.61);
  assert(t.still>=.6);t.shotClock=0;t.update(.001);assert.equal(t.bullets.length,16);
  const standingDamage=t.bullets.reduce((sum,b)=>sum+b.damage,0);
  assert(Math.abs(standingDamage/movingDamage-1.35*1.35)<1e-10);assert.equal(t.shotClock,1/14);
  for(const b of t.bullets)assert(b.size<=8);
});

test('Fifty immutable relics feed exactly six unique reachable map placements',({t,relics})=>{
  assert.equal(relics.length,50);assert(Object.isFrozen(relics));assert(relics.every(Object.isFrozen));
  assert.equal(new Set(relics.map(r=>r.key)).size,50);assert.equal(new Set(relics.map(r=>r.id)).size,50);
  assert.equal(t.relicPoints.length,6);assert(Object.isFrozen(t.relicPoints));assert.equal(t.mapLayout.relics.length,6);
  assert.equal(t.relicDrops.length,6);assert.equal(t.runRelicDefs.length,6);assert.equal(new Set(t.relicDrops.map(r=>r.id)).size,6);
  const cooldowns={lightning:4.8,orbit:.85,dash:6.5,frost:9,shield:24,bees:2.2};
  for(const def of relics){
    assert(def.name&&def.skillName&&def.description&&def.summary&&def.icon&&def.color&&def.family);
    if(def.legacy)assert.equal(def.cooldown,cooldowns[def.key]);else if(def.family!=='stats')assert(Number.isFinite(def.cooldown)&&def.cooldown>0);
  }
  for(const def of t.runRelicDefs){
    const drop=t.relicDrops.find(r=>r.id===def.id);assert(drop);assert.equal(drop.key,def.key);assert.equal(drop.claimed,false);
    assert(Number.isFinite(drop.x)&&Number.isFinite(drop.y));assert(drop.x>=56&&drop.x<=t.WORLD_W-56);
    assert(drop.y>=56&&drop.y<=t.WORLD_H-56);
    assert(t.world.isFree(drop.x,drop.y,44,t.obstacles,t.WORLD_W,t.WORLD_H));
    const point=t.mapLayout.relics.find(p=>p.id===drop.slotId);assert(point);assert(Math.hypot(point.x-drop.x,point.y-drop.y)<=70.001);
  }
});
test('Relic collection enforces distance and gameplay state, grants a skill once and leaves permanent growth untouched',({t,storage})=>{
  const drop=t.relicDrops[0],before=JSON.stringify(t.profile),defs=JSON.stringify(t.relicDefs);
  t.player.x=drop.x+57;t.player.y=drop.y;assert.equal(t.claimRelic(drop.id),false);assert.equal(drop.claimed,false);
  t.player.x=drop.x;t.player.y=drop.y+56;t.pause();assert.equal(t.claimRelic(drop.id),false);t.resume();assert(t.claimRelic(drop.id));
  assert.equal(drop.claimed,true);assert.equal(t.player.skills[drop.key],true);assert.equal(t.claimRelic(drop.id),false);
  assert.equal(t.claimRelic('missing-id'),false);assert.equal(JSON.stringify(t.profile),before);assert.equal(JSON.stringify(t.relicDefs),defs);
  const loaded=createGame(storage);loaded.t.start();assert.equal(Object.keys(loaded.t.player.skills).length,0);
  assert(loaded.t.relicDrops.every(r=>!r.claimed));
});
test('Walking into a relic claims it automatically and updates its HUD and distribution marker once',({t,element})=>{
  quietField(t);const drop=t.relicDrops.find(r=>r.key==='lightning'),before=JSON.stringify(t.profile);
  t.player.x=drop.x+55;t.player.y=drop.y;t.update(.001);
  assert.equal(drop.claimed,true);assert.equal(t.player.skills.lightning,true);assert.equal(t.relicDrops.filter(r=>r.claimed).length,1);
  assert(!element('relicHud').classList.contains('hidden'));assert(element('relicStatus').textContent.includes('1 / 6'));assert(element('relicSlots').innerHTML.includes(t.relicDefs.find(r=>r.key==='lightning').name));
  t.update(.001);assert.equal(t.relicDrops.filter(r=>r.claimed).length,1);assert.equal(JSON.stringify(t.profile),before);
  t.showRelicMap();const marker=relicMarkerButtons({element}).find(b=>b.dataset.relicId===drop.id);assert(marker);assert(/\bclaimed\b/.test(marker.attributes));
  t.closeRelicMap();assert.equal(t.state,'playing');assert.equal(t.relicDrops.filter(r=>r.claimed).length,1);
});
test('Lightning chains to at most three active bugs and ignores dormant or defeated nearby targets',({t})=>{
  claimSkill(t,'lightning');t.player.x=t.WORLD_W*.25;t.player.y=t.WORLD_H*.25;const x=t.player.x,y=t.player.y;
  const targets=[100,250,390,520].map(dx=>enemy(x+dx,y,{hp:1000}));
  const dormant=enemy(x+1,y,{hp:1000,aggro:false,pursuitAt:Infinity}),dead=enemy(x+2,y,{hp:0});
  t.enemies=[dormant,dead,...targets];t.updateSkills(.001);
  for(const e of targets.slice(0,3))assert(Math.abs(e.hp-(1000-t.player.damage*1.05))<1e-8);
  assert.equal(targets[3].hp,1000);assert.equal(dormant.hp,1000);assert.equal(dead.hp,0);
  assert.equal(t.player.skillTimers.lightning,4.8);assert(t.skillEffects.length>0);
});
test('Orbit damage stays local and is limited to six active enemies per pulse',({t})=>{
  claimSkill(t,'orbit');const x=t.player.x,y=t.player.y;
  const near=Array.from({length:7},(_,i)=>enemy(x+40*Math.cos(i),y+40*Math.sin(i),{hp:1000}));
  const outside=enemy(x+130,y,{hp:1000}),hidden=enemy(x+5,y,{hp:1000,aggro:false,pursuitAt:Infinity});
  t.enemies=[...near,outside,hidden];t.updateSkills(.001);
  assert.equal(near.filter(e=>e.hp<1000).length,6);
  assert(Math.abs(near.reduce((n,e)=>n+1000-e.hp,0)-6*t.player.damage*.26)<1e-8);
  assert.equal(outside.hp,1000);assert.equal(hidden.hp,1000);assert.equal(t.player.skillTimers.orbit,.85);
});
test('Two bees can strike one active boss twice within range without attacking hidden enemies',({t})=>{
  claimSkill(t,'bees');t.player.x=t.WORLD_W*.25;t.player.y=t.WORLD_H*.25;const x=t.player.x,y=t.player.y;
  const boss=enemy(x+500,y,{hp:1000,boss:true,type:2}),hidden=enemy(x+1,y,{hp:1000,aggro:false,pursuitAt:Infinity});
  t.enemies=[hidden,boss];t.updateSkills(.001);
  assert(Math.abs(boss.hp-(1000-2*t.player.damage*.55))<1e-8);assert.equal(hidden.hp,1000);assert.equal(t.player.skillTimers.bees,2.2);
});
test('Attack skills stay ready without active targets and respect their respective targeting range',({t})=>{
  for(const key of ['lightning','orbit','frost','bees'])claimSkill(t,key);
  const x=t.player.x,y=t.player.y,dormant=enemy(x+1,y,{aggro:false,pursuitAt:Infinity,hp:1000}),far=enemy(x+800,y,{hp:1000});
  t.enemies=[dormant,far];t.updateSkills(1);
  for(const key of ['lightning','orbit','frost','bees'])assert.equal(t.player.skillTimers[key],0);
  assert.equal(dormant.hp,1000);assert.equal(far.hp,1000);
});
test('Skill kills use the same experience and boss-progress accounting without duplicate credit',({t})=>{
  claimSkill(t,'lightning');const target=enemy(t.player.x+100,t.player.y,{hp:1,xp:3});
  t.enemies=[target,enemy(40,40,{aggro:false,pursuitAt:Infinity})];t.shotClock=Infinity;t.update(.001);
  assert.equal(t.kills,1);assert.equal(t.nonBossKills,1);assert.equal(t.bossKills,0);assert.equal(t.enemies.length,1);
  assert.equal(t.gems.length,1);assert.equal(t.gems[0].value,3*t.player.xpMult);
  t.update(.001);assert.equal(t.kills,1);assert.equal(t.nonBossKills,1);assert.equal(t.gems.length,1);
});
test('Frost deals area damage and slows normal walking by thirty-five percent and boss walking by fifteen percent',({t})=>{
  claimSkill(t,'frost');t.player.inv=1e9;t.shotClock=Infinity;const x=t.player.x,y=t.player.y;
  const ordinary=enemy(x-100,y,{hp:1000,speed:100});
  const boss=enemy(x-150,y,{hp:1000,speed:100,boss:true,type:2,introduced:true,chargeClock:100,windup:0,dashTime:0,chargeSpeed:200});
  const outside=enemy(x-240,y,{hp:1000}),hidden=enemy(x-10,y,{hp:1000,aggro:false,pursuitAt:Infinity});
  t.enemies=[ordinary,boss,outside,hidden];t.updateSkills(.001);
  assert.equal(ordinary.hp,1000-t.player.damage*.55);assert.equal(boss.hp,1000-t.player.damage*.55);
  assert.equal(outside.hp,1000);assert.equal(hidden.hp,1000);assert.equal(t.player.skillTimers.frost,9);
  const a=ordinary.x,b=boss.x;t.update(.1);assert(Math.abs(ordinary.x-a-6.5)<1e-8);assert(Math.abs(boss.x-b-8.5)<1e-8);
  t.update(2.4);ordinary.x=x-100;boss.x=x-150;const expiredA=ordinary.x,expiredB=boss.x;
  t.update(.1);assert(Math.abs(ordinary.x-expiredA-10)<1e-8);assert(Math.abs(boss.x-expiredB-10)<1e-8);
});
test('Frost also slows an active boss charge by fifteen percent',({t})=>{
  claimSkill(t,'frost');t.player.inv=1e9;t.shotClock=Infinity;const x=t.player.x,y=t.player.y;
  const boss=enemy(x-160,y,{hp:1000,speed:0,boss:true,type:2,introduced:true,chargeClock:100,windup:0,dashTime:1,dashX:1,dashY:0,chargeSpeed:200});
  t.enemies=[boss];t.updateSkills(.001);const before=boss.x;t.update(.1);assert(Math.abs(boss.x-before-17)<1e-8);assert.equal(boss.y,y);
});
test('Dash requires its relic, follows recent movement, respects its cooldown and clamps at map edges',({t})=>{
  assert.equal(t.activateDash(),false);claimSkill(t,'dash');quietField(t);t.player.x=t.mapLayout.spawn.x;t.player.y=t.mapLayout.spawn.y+140;
  t.keys.add('w');t.update(.01);t.keys.clear();const x=t.player.x,y=t.player.y;assert(t.activateDash());
  assert.equal(t.player.x,x);assert(Math.abs(t.player.y-(y-270))<1e-8);assert(t.player.inv>=.28);
  assert.equal(t.player.skillTimers.dash,6.5);assert.equal(t.activateDash(),false);
  t.updateSkills(6.5);t.player.x=t.WORLD_W-30;t.player.y=t.WORLD_H-30;t.player.facingX=1;t.player.facingY=0;
  assert(t.activateDash());assert(t.player.x<=t.WORLD_W-t.player.r);assert(t.player.x>=t.WORLD_W-30);assert.equal(t.player.y,t.WORLD_H-30);
  t.updateSkills(6.5);t.player.x=30;t.player.y=30;t.player.facingX=0;t.player.facingY=-1;
  assert(t.activateDash());assert.equal(t.player.x,30);assert(t.player.y>=t.player.r);assert(t.player.y<=30);
});
test('Shield blocks exactly one contact hit and regenerates one layer twenty-four seconds after consumption',({t})=>{
  claimSkill(t,'shield');assert.equal(t.player.shield,1);t.player.inv=0;t.shotClock=Infinity;
  const contact=enemy(t.player.x,t.player.y,{hp:1000});t.enemies=[contact];const hp=t.player.hp;
  t.update(.001);assert.equal(t.player.hp,hp);assert.equal(t.player.shield,0);assert(t.player.skillTimers.shield>23.9);
  t.player.inv=0;t.update(.001);assert.equal(t.player.hp,hp-15);t.enemies=[];
  t.updateSkills(23.9);assert.equal(t.player.shield,0);t.updateSkills(.11);assert.equal(t.player.shield,1);
  t.updateSkills(100);assert.equal(t.player.shield,1);
});
test('Keyboard and phone dash controls work while M and Escape open and close the paused distribution map',({t,element,listeners})=>{
  claimSkill(t,'dash');quietField(t);t.player.x=t.WORLD_W*.25;t.player.y=t.WORLD_H*.25;
  const press=key=>listeners.keydown({key,repeat:false,preventDefault(){}});
  let x=t.player.x;press(' ');assert(Math.abs(t.player.x-x-270)<1e-8);assert(element('dashSkill').disabled);
  t.updateSkills(6.5);t.update(.001);assert(!element('dashSkill').disabled);assert(!element('dashSkill').classList.contains('hidden'));
  x=t.player.x;element('dashSkill').onclick();assert(Math.abs(t.player.x-x-270)<1e-8);
  press('M');assert.equal(t.state,'relicMap');assert.equal(t.mapReturnState,'playing');x=t.player.x;press(' ');assert.equal(t.player.x,x);
  press('Escape');assert.equal(t.state,'playing');t.pause();press('m');assert.equal(t.state,'relicMap');assert.equal(t.mapReturnState,'paused');
  press('m');assert.equal(t.state,'paused');assert.equal(t.activateDash(),false);
});
test('Skill cooldowns freeze in pause, upgrades and rescue while boss arrivals keep combat running',({t})=>{
  claimSkill(t,'lightning');t.shotClock=Infinity;t.player.inv=1e9;t.enemies.push(enemy(t.player.x+100,t.player.y,{hp:1000}));
  t.updateSkills(.001);t.frame(1000);
  const snapshot=()=>JSON.stringify({time:t.elapsed,timers:t.player.skillTimers,effects:t.skillEffects});
  const frozenFrames=(first)=>{const before=snapshot();for(let i=0;i<15;i++)t.frame(first+i*40);assert.equal(snapshot(),before)};
  t.pause();frozenFrames(1040);t.resume();t.player.xp=t.player.need;t.upgrade();frozenFrames(2000);
  assert.equal(t.showRelicMap(),false);assert.equal(t.activateDash(),false);t.choose(0);
  for(const e of t.enemies)if(!e.boss)e.hp=0;t.elapsed=t.activeStage.bossSchedule[0];t.update(.001);assert.equal(t.state,'playing');
  const beforeArrivalFrames=snapshot();for(let i=0;i<15;i++)t.frame(3000+i*40);assert.notEqual(snapshot(),beforeArrivalFrames);
  assert(t.showRelicMap());t.closeRelicMap();t.enemies.find(e=>e.boss&&e.aggro).hp=0;t.update(.001);
  drainUpgradeChoices(t);assert.equal(t.state,'rescue');frozenFrames(4000);assert.equal(t.showRelicMap(),false);
});
test('Relic distribution previews show six selectable points and keep the selected stage across menu navigation',(game)=>{
  const {t,element}=game;t.startScreen();t.profile.unlockedStage=20;assert(t.selectStage(20));click(game,'navMap');
  assert.equal(t.state,'relicMap');menuControls(game);assert.equal(relicMarkerButtons(game).length,6);
  assert(element('overlay').classList.contains('relic-map-overlay'));
  for(const def of t.runRelicDefs){dataButton(game,'data-relic-id',def.id).onclick();assert.equal(t.selectedRelic,def.id);assert(element('overlay').innerHTML.includes(def.skillName))}
  click(game,'navArmory');assert.equal(t.state,'armory');assert(!element('overlay').classList.contains('relic-map-overlay'));
  click(game,'navMap');click(game,'start');assert.equal(t.activeStage.id,20);assert.equal(t.state,'playing');
});
test('The battlefield distribution map freezes combat and returns from playing or paused with the same build',(game)=>{
  const {t,element}=game;claimSkill(t,'lightning');quietField(t);t.enemies.push(enemy(t.player.x+100,t.player.y,{hp:1000}));
  t.updateSkills(.001);t.frame(1000);const build=JSON.stringify(t.player),effects=JSON.stringify(t.skillEffects),enemies=JSON.stringify(t.enemies),time=t.elapsed;
  assert.equal(typeof element('openRelicMap').onclick,'function');element('openRelicMap').onclick();assert.equal(t.state,'relicMap');assert.equal(t.mapReturnState,'playing');
  assert(!element('overlay').innerHTML.includes('id="navStages"'));assert.equal(relicMarkerButtons(game).length,6);
  for(let i=0;i<30;i++)t.frame(1040+i*40);
  assert.equal(t.elapsed,time);assert.equal(JSON.stringify(t.player),build);assert.equal(JSON.stringify(t.enemies),enemies);assert.equal(JSON.stringify(t.skillEffects),effects);
  click(game,'closeRelicMap');assert.equal(t.state,'playing');assert.equal(JSON.stringify(t.player),build);
  t.pause();t.showRelicMap();assert.equal(t.mapReturnState,'paused');for(let i=0;i<30;i++)t.frame(3000+i*40);
  click(game,'closeRelicMap');assert.equal(t.state,'paused');assert.equal(t.elapsed,time);assert.equal(JSON.stringify(t.player),build);
});
test('The battle map preserves active-run restrictions against stage, gear and orchard changes',({t})=>{
  t.profile.unlockedStage=2;t.profile.seeds=10000;t.profile.cores=1000;t.profile.inventory.weapon_pea={level:0};
  t.profile.rescuedSprites=[1];t.profile.spriteLevels[1]=0;t.showRelicMap();assert(t.isRunActive());
  const profile=JSON.stringify(t.profile),roster=t.enemies;
  assert.equal(t.selectStage(2),false);assert.equal(t.equipGear('weapon_pea'),false);assert.equal(t.upgradeGear('weapon_seed'),false);
  assert.equal(t.upgradeOrchard(),false);assert.equal(t.upgradeSprite(1),false);assert.equal(t.showArmory(),false);assert.equal(t.showOrchard(),false);
  assert.equal(t.state,'relicMap');assert.equal(JSON.stringify(t.profile),profile);assert.equal(t.enemies,roster);
  t.closeRelicMap();assert.equal(t.state,'playing');
});
test('Skill collection survives endless entry but resets for a new attempt or the next stage',({t})=>{
  for(const def of t.runRelicDefs)claimSkill(t,def.key);assert.equal(Object.keys(t.player.skills).length,6);
  clearStage(t);const skills=JSON.stringify(t.player.skills),timers=JSON.stringify(t.player.skillTimers),drops=JSON.stringify(t.relicDrops),shield=t.player.shield;
  t.player.xp=0;t.gems=[];assert(t.startEndless());assert.equal(JSON.stringify(t.player.skills),skills);
  assert.equal(JSON.stringify(t.player.skillTimers),timers);assert.equal(JSON.stringify(t.relicDrops),drops);assert.equal(t.player.shield,shield);
  t.finishEndless(true);assert(t.selectStage(2));t.start();assert.equal(t.activeStage.id,2);
  assert.equal(Object.keys(t.player.skills).length,0);assert.equal(t.player.shield,0);assert(t.relicDrops.every(r=>!r.claimed));
  claimSkill(t,t.runRelicDefs[0].key);t.start();assert.equal(Object.keys(t.player.skills).length,0);assert(t.relicDrops.every(r=>!r.claimed));
});

test('Thirteen heroes are unlocked without a cleared stage and orange has the rebalanced starter loadout',({t})=>{
  assert.equal(t.growth.heroes.length,13);assert.equal(new Set(t.growth.heroes.map(h=>h.id)).size,13);
  assert.equal(t.player.heroId,'orange');assert.equal(t.player.damage,22);assert.equal(t.player.rate,3);
  assert.equal(t.player.hp,110);assert.equal(t.player.speed,205);assert.equal(t.player.pickup,85);
  t.startScreen();assert.equal(t.selectHero('missing'),false);assert.equal(t.trainHero('berry'),false);
  for(const hero of t.growth.heroes){
    assert.equal(hero.unlockStage,0);assert(t.selectHero(hero.id));assert.equal(t.profile.selectedHero,hero.id);
    assert.equal(t.player.heroId,hero.id);assert.equal(t.profile.clearedStages.length,0);
  }
});
test('Hero training debits exact costs, changes the next run once and stops at thirty levels',({t})=>{
  t.startScreen();assert(!t.trainHero('orange'));t.profile.seeds=999999;t.profile.cores=9999;
  for(let level=0;level<30;level++){
    const cost=t.growth.cost('hero','orange',level),seeds=t.profile.seeds,cores=t.profile.cores;
    assert(t.trainHero('orange'));assert.equal(t.profile.heroLevels.orange,level+1);
    assert.equal(t.profile.seeds,seeds-cost.seeds);assert.equal(t.profile.cores,cores-cost.cores);
  }
  const saved=JSON.stringify(t.profile);assert(!t.trainHero('orange'));assert.equal(JSON.stringify(t.profile),saved);
  t.start();assert(Math.abs(t.player.damage-22*1.375)<1e-8);assert.equal(t.player.hp,210);
  assert(Math.abs(t.player.skillCooldown-.7)<1e-8);const damage=t.player.damage;t.start();assert.equal(t.player.damage,damage);
});
test('Four permanent research trees debit their costs and cap their shared next-run benefits',({t})=>{
  t.startScreen();assert(!t.researchTalent('vitality'));assert(!t.researchTalent('missing'));
  t.profile.seeds=999999;t.profile.cores=9999;
  for(const item of t.growth.talents){
    for(let level=0;level<item.maxLevel;level++){
      const cost=t.growth.cost('talent',item.id,level),seeds=t.profile.seeds,cores=t.profile.cores;
      assert(t.researchTalent(item.id));assert.equal(t.profile.talents[item.id],level+1);
      assert.equal(t.profile.seeds,seeds-cost.seeds);assert.equal(t.profile.cores,cores-cost.cores);
    }
    const saved=JSON.stringify(t.profile);assert(!t.researchTalent(item.id));assert.equal(JSON.stringify(t.profile),saved);
  }
  t.start();assert.equal(t.player.maxHp,190);assert(Math.abs(t.player.damage-22*1.40)<1e-8);
  assert(Math.abs(t.player.rate-3*1.20)<1e-8);assert(Math.abs(t.player.xpMult-1.3)<1e-8);
});
test('Hero selection, training and research survive reload and stale saves receive safe growth defaults',({t,storage})=>{
  t.startScreen();t.profile.clearedStages=[2,5,8];t.profile.unlockedStage=9;t.profile.seeds=5000;t.profile.cores=1000;
  assert(t.selectHero('lime'));assert(t.trainHero('lime'));assert(t.researchTalent('insight'));t.saveProfile();
  const loaded=createGame(storage);assert.equal(JSON.stringify(loaded.t.profile),JSON.stringify(t.profile));loaded.t.start();
  assert.equal(loaded.t.player.heroId,'lime');assert.equal(loaded.t.profile.heroLevels.lime,1);assert.equal(loaded.t.profile.talents.insight,1);
  const invalid=createGame(new Map([['orchard-save-v1',JSON.stringify({version:1,selectedHero:'lime',heroLevels:{orange:900,lime:900,fake:4},talents:{vitality:900,damage:-1,fake:4}})]]));
  assert.equal(invalid.t.profile.selectedHero,'lime');assert.equal(invalid.t.profile.heroLevels.orange,30);assert.equal(invalid.t.profile.heroLevels.lime,30);
  assert.equal(invalid.t.profile.talents.vitality,20);assert.equal(invalid.t.profile.talents.damage,0);assert(!Object.hasOwn(invalid.t.profile.talents,'fake'));
});
test('Battle, pause and exploration map protect the active hero and permanent growth',({t})=>{
  t.profile.clearedStages=[2,5,8];t.profile.seeds=999999;t.profile.cores=9999;
  function reject(){const saved=JSON.stringify(t.profile),build=JSON.stringify(t.player),phase=t.state;
    assert.equal(t.selectHero('berry'),false);assert.equal(t.trainHero('orange'),false);assert.equal(t.researchTalent('damage'),false);
    assert.equal(t.showHeroes(),false);assert.equal(JSON.stringify(t.profile),saved);assert.equal(JSON.stringify(t.player),build);assert.equal(t.state,phase);
  }
  reject();t.pause();reject();t.showRelicMap();reject();t.closeRelicMap();assert.equal(t.state,'paused');
});
test('Hero menu presents thirteen portraits, passive and active skills, training and all research actions',(game)=>{
  const {t,element}=game;t.startScreen();t.profile.clearedStages=[2,5,8];t.profile.seeds=999999;t.profile.cores=9999;
  click(game,'navHeroes');assert.equal(t.state,'heroes');menuControls(game);
  assert.equal(element('overlay').querySelectorAll('[data-inspect-hero]').length,13);
  dataButton(game,'data-inspect-hero','berry').onclick();assert(element('overlay').innerHTML.includes('莓影齐射'));
  dataButton(game,'data-hero-view','passive').onclick();assert(element('overlay').innerHTML.includes('莓心敏锐'));
  click(game,'equipHero');assert.equal(t.profile.selectedHero,'berry');
  click(game,'trainHero');assert.equal(t.profile.heroLevels.berry,1);dataButton(game,'data-growth-tab','talents').onclick();
  assert.equal(element('overlay').querySelectorAll('[data-research]').length,4);dataButton(game,'data-research','damage').onclick();
  assert.equal(t.profile.talents.damage,1);click(game,'navMap');assert.equal(t.mapReturnState,'heroes');
  click(game,'closeRelicMap');assert.equal(t.state,'heroes');click(game,'start');assert.equal(t.player.heroId,'berry');
});
test('Orange active skill limits targets, ignores hidden bugs and heals once while spending its cooldown',({t})=>{
  quietField(t);t.player.hp=50;const x=t.player.x,y=t.player.y;
  const bugs=Array.from({length:15},(_,i)=>enemy(x+70+i*5,y,{hp:1000}));
  const hidden=enemy(x+20,y,{hp:1000,aggro:false,pursuitAt:Infinity});t.enemies.push(...bugs,hidden);
  assert(t.activateHeroSkill());assert.equal(t.player.heroClock,16);assert.equal(t.player.hp,55);assert.equal(t.player.heroCasts,1);
  assert.equal(bugs.filter(e=>e.hp<1000).length,10);for(const e of bugs.filter(e=>e.hp<1000))assert.equal(e.hp,1000-t.player.damage*2.8);
  assert.equal(hidden.hp,1000);assert(t.heroEffects.length>0);assert.equal(t.activateHeroSkill(),false);
});
test('Orange skill kills drop normal XP once and advance ordinary kill accounting',({t})=>{
  quietField(t);t.enemies.push(enemy(t.player.x+100,t.player.y,{hp:1,xp:3}));assert(t.activateHeroSkill());t.update(.001);
  assert.equal(t.kills,1);assert.equal(t.nonBossKills,1);assert.equal(t.gems.length,1);assert.equal(t.gems[0].value,3*t.player.xpMult);
  t.update(.001);assert.equal(t.kills,1);assert.equal(t.gems.length,1);
});
test('Berry active volley follows its aim and has seven finite-life projectiles with its stated power',({t})=>{
  t.startScreen();t.profile.clearedStages=[2];assert(t.selectHero('berry'));t.start();quietField(t);
  t.player.facingX=0;t.player.facingY=-1;const prior=t.bullets.length;assert(t.activateHeroSkill());
  const volley=t.bullets.slice(prior);assert.equal(volley.length,7);assert.equal(t.player.heroClock,14);
  for(const b of volley){assert(Math.abs(Math.hypot(b.vx,b.vy)-520)<1e-8);assert(b.vy<0);assert.equal(b.life,1.4);assert(Math.abs(b.damage-t.player.damage*.8)<1e-8)}
  assert.equal(t.player.critChance,.06);assert.equal(t.player.maxHp,100);
});
test('Pumpkin active slows bosses less, knocks back only smaller bugs and leaves victims outside solids',({t})=>{
  t.startScreen();t.profile.clearedStages=[5];assert(t.selectHero('pumpkin'));t.start();quietField(t);
  const x=t.player.x,y=t.player.y,normal=enemy(x+100,y,{hp:1000}),boss=enemy(x,y+140,{hp:1000,boss:true,type:2,introduced:true,chargeClock:100,windup:0,dashTime:0});
  t.enemies.push(normal,boss);assert(t.activateHeroSkill());assert.equal(t.player.heroClock,18);
  assert(normal.x>x+100);assert(normal.x<=x+180.001);assert.equal(normal.slowAmount,.35);
  assert.equal(boss.x,x);assert.equal(boss.y,y+140);assert.equal(boss.slowAmount,.15);assert.equal(normal.hp,1000-t.player.damage*3.2);
  assert(t.world.isFree(normal.x,normal.y,normal.r,t.obstacles,t.WORLD_W,t.WORLD_H));assert.equal(t.player.defense,2);
});
test('Lime pulse respects maximum HP and passive regeneration waits six seconds after life damage',({t})=>{
  t.startScreen();t.profile.clearedStages=[8];assert(t.selectHero('lime'));t.start();quietField(t);t.player.hp=30;
  const target=enemy(t.player.x+100,t.player.y,{hp:1000});t.enemies.push(target);assert(t.activateHeroSkill());
  assert(Math.abs(t.player.hp-(30+5+t.player.maxHp*.07))<1e-8);assert.equal(t.player.heroClock,20);
  assert.equal(target.hp,1000-t.player.damage*1.2);t.player.sinceHit=0;const hp=t.player.hp;
  t.update(5.9);assert.equal(t.player.hp,hp);t.update(.2);assert(t.player.hp>hp);
  t.player.hp=t.player.maxHp-.01;t.player.sinceHit=7;t.update(1);assert.equal(t.player.hp,t.player.maxHp);
});
test('Hero skill control is available on keyboard and phone and cooldown/effects freeze in all noncombat phases',({t,element,listeners})=>{
  t.shotClock=Infinity;t.player.inv=1e9;for(const e of t.enemies){e.speed=0;if(!e.boss)e.hp=1e9}
  t.enemies.push(enemy(t.player.x+100,t.player.y,{hp:1000}));
  listeners.keydown({key:'e',repeat:false,preventDefault(){}});assert(t.player.heroClock>0);assert.equal(t.player.heroCasts,1);
  assert.equal(typeof element('heroSkill').onclick,'function');element('heroSkill').onclick();assert.equal(t.player.heroCasts,1);
  t.frame(1000);const frozen=()=>JSON.stringify({clock:t.player.heroClock,effects:t.heroEffects,life:t.player.hp,time:t.elapsed});
  function waitFrames(time){const before=frozen();for(let i=0;i<10;i++)t.frame(time+i*40);assert.equal(frozen(),before);assert.equal(t.activateHeroSkill(),false)}
  t.pause();waitFrames(1100);t.resume();t.showRelicMap();waitFrames(2000);t.closeRelicMap();
  t.player.xp=t.player.need;t.upgrade();waitFrames(3000);t.choose(0);
  for(const e of t.enemies)if(!e.boss)e.hp=0;t.elapsed=t.activeStage.bossSchedule[0];t.update(.001);assert.equal(t.state,'playing');
  const clockBeforeArrivalFrames=t.player.heroClock;for(let i=0;i<10;i++)t.frame(4000+i*40);assert(t.player.heroClock<clockBeforeArrivalFrames);
  t.enemies.find(e=>e.boss&&e.aggro).hp=0;t.update(.001);drainUpgradeChoices(t);assert.equal(t.state,'rescue');waitFrames(5000);
});
test('Six new run upgrades obey rarity budgets, saturation limits and description values',({t})=>{
  for(const m of [1,1.5,2]){
    const p={...t.player},byId=Object.fromEntries(t.growth.runUpgrades.map(u=>[u.id,u]));
    byId.critChance.apply(p,m);assert(Math.abs(p.critChance-.04*m)<1e-8);
    byId.critMultiplier.apply(p,m);assert(Math.abs(p.critMultiplier-(1.5+.15*m))<1e-8);
    byId.pierce.apply(p,m);assert.equal(p.pierce,.5*m);byId.defense.apply(p,m);assert.equal(p.defense,m);
    byId.regen.apply(p,m);assert(Math.abs(p.regen-.12*m)<1e-8);
    byId.skillCooldown.apply(p,m);assert(Math.abs(p.skillCooldown-(1-.06*m))<1e-8);
    for(let repeat=0;repeat<60;repeat++)for(const u of t.growth.runUpgrades)u.apply(p,m);
    assert.equal(p.critChance,.35);assert.equal(p.critMultiplier,2.5);assert.equal(p.pierce,3);
    assert.equal(p.defense,6);assert(Math.abs(p.regen-1.2)<1e-8);assert.equal(p.skillCooldown,.6);
    for(const u of t.growth.runUpgrades){assert.equal(u.available(p),false);assert.equal(typeof u.describe(m,p),'string')}
  }
});
test('Critical damage rewards enter random upgrade choices only after the hero has critical chance',({t})=>{
  assert.equal(t.player.critChance,0);
  for(let roll=0;roll<60;roll++){t.upgrade();assert(!t.choices.some(u=>u.id==='critDamage'))}
  t.player.critChance=.04;let found=false;
  for(let roll=0;roll<60;roll++){t.upgrade();found ||= t.choices.some(u=>u.id==='critDamage')}
  assert(found,'Once critical chance exists, the critical damage reward must become reachable');
});
test('Weapon criticals apply their run multiplier and fractional pierce uses one probability per projectile',({t,setRandom})=>{
  t.enemies=[enemy(t.player.x+100,t.player.y)];t.player.critChance=.35;t.player.critMultiplier=2.5;t.player.pierce=1.5;
  setRandom(0);t.shoot(false);assert.equal(t.bullets.length,1);assert.equal(t.bullets[0].damage,t.player.damage*2.5);
  assert.equal(t.bullets[0].pierces,2);t.bullets.length=0;setRandom(.99);t.shoot(false);
  assert.equal(t.bullets[0].damage,t.player.damage);assert.equal(t.bullets[0].pierces,1);
});
test('A piercing projectile cannot repeatedly damage the same target on successive frames',({t})=>{
  const target=enemy(t.player.x+100,t.player.y,{hp:1000});t.enemies=[target];t.shotClock=Infinity;
  t.bullets.push({x:target.x,y:target.y,vx:0,vy:0,damage:20,life:1,pierces:3,hitTargets:new Set()});
  t.update(.001);const hp=target.hp;assert.equal(hp,980);t.update(.001);assert.equal(target.hp,hp);
});
test('Real obstacles exist in the run and all stage spawns and reinforcement arrivals are collision-free',({t})=>{
  assert(t.obstacles.length>=96);assert.equal(t.mapLayout.id,t.activeStage.id);assert(t.world.isFree(t.player.x,t.player.y,t.player.r,t.obstacles,t.WORLD_W,t.WORLD_H));
  for(const e of t.enemies)assert(t.world.isFree(e.x,e.y,e.r,t.obstacles,t.WORLD_W,t.WORLD_H),'spawn must be on free ground');
  t.player.inv=1e9;t.shotClock=Infinity;for(const e of t.enemies)e.speed=0;t.elapsed=200;t.update(.001);
  for(const e of t.enemies)assert(t.world.isFree(e.x,e.y,e.r,t.obstacles,t.WORLD_W,t.WORLD_H),'activated reinforcement must avoid solids');
});
test('Walking and relic dash collide with visible map solids and preserve legal positions',({t})=>{
  prepareStage(t,6);quietField(t);const obstacle=t.obstacles.find(o=>o.kind==='hedge');assert(obstacle);
  const half=obstacle.w/2;t.player.x=obstacle.x-half-t.player.r-35;t.player.y=obstacle.y;t.keys.add('d');
  for(let i=0;i<20;i++)t.update(.04);assert(t.player.x<=obstacle.x-half-t.player.r+.001);
  assert(t.world.isFree(t.player.x,t.player.y,t.player.r,t.obstacles,t.WORLD_W,t.WORLD_H));t.keys.clear();
  t.player.skills.dash=true;t.player.skillTimers.dash=0;t.player.facingX=1;t.player.facingY=0;
  assert(t.activateDash());assert(t.player.x<=obstacle.x-half-t.player.r+.001);
  assert(t.world.isFree(t.player.x,t.player.y,t.player.r,t.obstacles,t.WORLD_W,t.WORLD_H));
});
test('Pressing against a solid restores the standstill fire boost once real movement stops',({t})=>{
  prepareStage(t,6);quietField(t);const obstacle=t.obstacles.find(o=>o.kind==='hedge');const half=obstacle.w/2;
  t.player.x=obstacle.x-half-t.player.r-1;t.player.y=obstacle.y;t.keys.add('d');const x=t.player.x,y=t.player.y;
  for(let frame=0;frame<20;frame++)t.update(.04);
  assert.equal(t.player.x,x);assert.equal(t.player.y,y);assert(t.still>=.6);
  t.keys.clear();t.keys.add('a');t.update(.04);assert(t.player.x<x);assert.equal(t.still,0);
});
test('Bullets stop at map solids instead of damaging a target through cover',({t})=>{
  quietField(t);const obstacle=t.obstacles.find(o=>o.kind==='crate');assert(obstacle);const half=obstacle.w/2;
  t.player.x=obstacle.x-half-90;t.player.y=obstacle.y;const target=enemy(obstacle.x+half+80,obstacle.y,{hp:1000});t.enemies.push(target);
  t.bullets.push({x:t.player.x,y:t.player.y,vx:1000,vy:0,damage:100,life:1,pierces:0,hitTargets:new Set()});
  t.update(.25);assert.equal(target.hp,1000);assert.equal(t.bullets.length,0);
});
test('Automatic weapons and area skills respect cover when selecting their targets',({t})=>{
  quietField(t);const obstacle=t.obstacles.find(o=>o.kind==='crate');const half=obstacle.w/2;
  t.player.x=obstacle.x-half-70;t.player.y=obstacle.y;
  const blocked=enemy(obstacle.x+half+50,obstacle.y,{hp:1000});t.enemies.push(blocked);
  t.shoot(false);assert.equal(t.bullets.length,0);assert(t.activateHeroSkill());assert.equal(blocked.hp,1000);
  for(const key of ['lightning','orbit','frost','bees']){t.player.skills[key]=true;t.player.skillTimers[key]=0}
  t.updateSkills(.001);assert.equal(blocked.hp,1000);
});
test('Pumpkin knockback stops at a solid rather than throwing a victim through cover',({t})=>{
  t.startScreen();t.profile.clearedStages=[5];assert(t.selectHero('pumpkin'));t.start();quietField(t);
  const obstacle=t.obstacles.find(o=>o.kind==='crate'),half=obstacle.w/2;
  const victim=enemy(obstacle.x-half-30,obstacle.y,{hp:1000});t.player.x=victim.x-75;t.player.y=victim.y;t.enemies.push(victim);
  assert(t.activateHeroSkill());assert(victim.x<=obstacle.x-half-victim.r+.001);
  assert(t.world.isFree(victim.x,victim.y,victim.r,t.obstacles,t.WORLD_W,t.WORLD_H));assert.equal(victim.slowAmount,.35);
});
test('An active pursuer detours around a map hedge without entering it or getting stuck',({t})=>{
  prepareStage(t,6);quietField(t);const obstacle=t.obstacles.find(o=>o.kind==='hedge'&&o.h>o.w);assert(obstacle);
  t.player.x=obstacle.x+obstacle.w/2+150;t.player.y=obstacle.y;const target=enemy(obstacle.x-obstacle.w/2-150,obstacle.y,{hp:1e9,speed:100});
  t.enemies.push(target);t.player.inv=1e9;
  for(let i=0;i<500;i++){t.update(.04);assert(t.world.isFree(target.x,target.y,target.r,t.obstacles,t.WORLD_W,t.WORLD_H));if(Math.hypot(target.x-t.player.x,target.y-t.player.y)<40)break}
  assert(Math.hypot(target.x-t.player.x,target.y-t.player.y)<40);
});
test('Endless spawns also avoid solids and retain hero, research bonuses and earned run upgrades',({t})=>{
  t.growth.runUpgrades.find(u=>u.id==='pierce').apply(t.player,2);clearStage(t);const heroId=t.player.heroId,pierce=t.player.pierce;
  assert(t.startEndless());assert.equal(t.player.heroId,heroId);assert.equal(t.player.pierce,pierce);
  for(const e of t.enemies)assert(t.world.isFree(e.x,e.y,e.r,t.obstacles,t.WORLD_W,t.WORLD_H));
  t.spawnEndlessWave();for(const e of t.enemies)assert(t.world.isFree(e.x,e.y,e.r,t.obstacles,t.WORLD_W,t.WORLD_H));
});
test('One hundred stage names and local preview images are connected to the carousel',({t,element})=>{
  assert.equal(t.art.stages.length,100);assert.equal(new Set(t.stages.map(s=>s.name)).size,100);
  assert.equal(new Set(t.art.stages.map(s=>s.image)).size,20);assert(fs.existsSync(__dirname+'/'+t.art.atlas));
  t.startScreen();t.profile.unlockedStage=100;
  for(const s of t.stages){
    const stage=t.art.stages[s.id-1];assert.equal(stage.id??stage.stageId,s.id);assert.equal(stage.name,s.name);assert(fs.existsSync(__dirname+'/'+stage.image));
    assert(t.selectStage(s.id));t.startScreen();const markup=element('overlay').innerHTML;
    assert(markup.includes(stage.image));assert(markup.includes(s.name));assert(markup.includes('主题图'));
  }
});
test('Loaded art atlas draws the selected hero and all visible enemy classes from valid sprite cells',()=>{
  const {t,drawCalls}=createGame(undefined,{loadedAtlas:true});t.profile.clearedStages=[2,5,8];
  for(const hero of t.growth.heroes){
    t.startScreen();assert(t.selectHero(hero.id));t.start();const x=t.player.x,y=t.player.y;
    t.enemies=[enemy(x+80,y),enemy(x+120,y,{type:1}),enemy(x-80,y,{elite:true,maxHp:100}),
      enemy(x,y+100,{boss:true,type:2,maxHp:100,color:'#abc',windup:0})];
    drawCalls.length=0;t.draw();const calls=drawCalls.filter(call=>call.method==='drawImage');assert(calls.length>5);
    for(const key of [hero.id,'beetle','fly','elite','boss']){
      if(t.art.heroImages[key]){assert(calls.some(c=>c.args[0].src===t.art.heroImages[key]&&c.args.length===5),'Expected dedicated '+key+' image');continue}
      const index=t.art.sprites[key];assert(calls.some(c=>c.args[1]===index%4*256&&c.args[2]===Math.floor(index/4)*256),'Expected rendered '+key+' cell');
    }
    for(const call of calls){if(Object.values(t.art.heroImages).includes(call.args[0].src)){assert.equal(call.args.length,5);assert(call.args[3]>0&&call.args[4]>0);continue}
      assert([t.art.atlas,t.mapRenderer.environmentAtlas].includes(call.args[0].src));assert.equal(call.args[3],256);assert.equal(call.args[4],256);
      assert(call.args[1]>=0&&call.args[1]<=768);assert(call.args[2]>=0&&call.args[2]<=768);assert(call.args[7]>0&&call.args[8]>0)}
  }
});
test('A loaded atlas still excludes hidden enemies and keeps the visible elite identity and health bar',()=>{
  const {t,drawCalls}=createGame(undefined,{loadedAtlas:true});t.start();t.enemies=[];drawCalls.length=0;t.draw();const baseline=JSON.stringify(drawCalls);
  const hidden=enemy(t.player.x+73,t.player.y+33,{aggro:false,pursuitAt:100,elite:true,maxHp:100});t.enemies=[hidden];
  drawCalls.length=0;t.draw();assert.equal(JSON.stringify(drawCalls),baseline);
  hidden.aggro=true;hidden.hp=50;drawCalls.length=0;t.draw();assert(drawCalls.some(c=>c.method==='fillText'&&c.args[0]==='精英'));
  assert(drawCalls.some(c=>c.method==='fillRect'&&c.args[2]===25&&c.args[3]===5));
});

test('Each chapter switches actual geometry, tactical SVG and battle rendering while retaining world size',({t,element,drawCalls})=>{
  t.profile.unlockedStage=20;
  const signatures=new Set();
  for(let id=1;id<=20;id++){
    t.startScreen();assert(t.selectStage(id));t.startScreen();
    assert.equal(t.mapLayout.id,id);assert.equal(t.mapLayout.width,t.WORLD_W);assert.equal(t.mapLayout.height,t.WORLD_H);
    assert.equal(t.mapLayout.name,t.stages[id-1].name);
    signatures.add(JSON.stringify(t.obstacles.map(o=>[o.kind,o.shape,o.x,o.y,o.r,o.w,o.h])));
    element('navMap').onclick();assert.equal(t.state,'relicMap');
    assert(element('overlay').innerHTML.includes(t.mapLayout.name+'真实地形与饰品分布'));
    assert(!element('overlay').innerHTML.includes('M 60 175 H 935'));
    t.closeRelicMap();t.start();assert.equal(t.activeStage.id,id);
    assert.deepEqual(t.obstacles,t.mapLayout.obstacles);
    for(const drop of t.relicDrops){const p=t.mapLayout.relics.find(p=>p.id===drop.slotId);assert(p);assert(Math.hypot(drop.x-p.x,drop.y-p.y)<=70.001);assert(t.world.isFree(drop.x,drop.y,44,t.obstacles,t.WORLD_W,t.WORLD_H));}
    drawCalls.length=0;t.draw();assert(drawCalls.some(c=>c.method==='fillText'&&c.args[0]===id+' · '+t.mapLayout.name));
    assert.equal(t.selectStage(id===20?1:id+1),false,'A live run cannot change its terrain');
  }
  assert.equal(signatures.size,20);
});
test('Endless mode retains chapter terrain, relic ownership and the existing navigation world',({t})=>{
  prepareStage(t,5);claimSkill(t,'dash');const layout=t.mapLayout,solids=t.obstacles,nav=t.navigator;
  enterEndless(t);assert.equal(t.mapLayout,layout);assert.equal(t.obstacles,solids);assert.equal(t.navigator,nav);
  assert(t.player.skills.dash);assert(t.relicDrops.find(p=>p.key==='dash').claimed);
});
test('Opening the real terrain map freezes pursuit navigation along with the battle',({t})=>{
  t.update(.04);const before=t.navigator.stats().elapsed;
  assert(t.showRelicMap());t.frame(1000);assert.equal(t.navigator.stats().elapsed,before);
  t.closeRelicMap();t.frame(1040);assert(t.navigator.stats().elapsed>before);
});
function draftRelics(t, keys) {
  const chosen=keys.map(key=>t.relicDefs.find(d=>d.key===key));assert(chosen.every(Boolean));
  const remainder=t.relicDefs.filter(d=>!keys.includes(d.key));t.runRelicDefs=[...chosen,...remainder.slice(0,6-chosen.length)];t.resetRelics(false);
}
test('Real random runs choose six without duplicates, vary drafts and can deliver every catalog item',()=>{
  const {t}=createGame(undefined,{randomRelics:true}),drafts=new Set(),seen=new Set();
  for(let attempt=0;attempt<120;attempt++){
    t.start();assert.equal(t.runRelicDefs.length,6);assert.equal(t.relicDrops.length,6);
    assert.equal(new Set(t.runRelicDefs.map(d=>d.id)).size,6);assert.equal(new Set(t.relicDrops.map(d=>d.slotId)).size,6);
    const ids=Array.from(t.runRelicDefs,d=>d.id);ids.forEach(id=>seen.add(id));drafts.add(ids.sort().join(','));
    for(const drop of t.relicDrops){const slot=t.mapLayout.relics.find(p=>p.id===drop.slotId);assert(slot);assert(Math.hypot(drop.x-slot.x,drop.y-slot.y)<=70.001);assert(t.world.isFree(drop.x,drop.y,44,t.obstacles,t.WORLD_W,t.WORLD_H));}
  }
  assert(drafts.size>110);assert.equal(seen.size,50);
},{start:false});
test('Relic preview keeps the six promised drops when the player starts the challenge',()=>{
  const {t}=createGame(undefined,{randomRelics:true});t.showRelicMap();
  const preview=JSON.stringify(t.relicDrops);t.closeRelicMap();t.start();assert.equal(JSON.stringify(t.relicDrops),preview);
},{start:false});
test('Collecting six relics fills six owned HUD slots and queues every name and effect without replacing notices',({t,element})=>{
  draftRelics(t,['sunDisk','needleLeaf','dewFlask','barkAmulet','venomBerry','amberKernel']);
  for(const def of t.runRelicDefs)claimSkill(t,def.key);
  assert.equal(t.relicDrops.filter(d=>d.claimed).length,6);assert.equal(Object.keys(t.player.skills).length,6);
  assert(!element('lootTicker').classList.contains('hidden'));assert(!element('relicHud').classList.contains('hidden'));
  assert.equal(t.currentNotice.title,t.runRelicDefs[0].name);assert.equal(t.noticeQueue.length,5);
  assert(element('lootTickerTitle').textContent.includes(t.runRelicDefs[0].name));assert(element('lootTickerText').textContent.includes(t.runRelicDefs[0].description));
  const names=new Set([t.currentNotice.title,...t.noticeQueue.map(n=>n.title)]);assert.equal(names.size,6);
  for(const def of t.runRelicDefs)assert(element('relicSlots').innerHTML.includes(def.name));
  assert.equal(t.claimRelic(t.relicDrops[0].id),false);assert.equal(t.noticeQueue.length,5);
});
test('Relic notices advance in order, display each effect and freeze in the map and pause screens',({t,element})=>{
  claimSkill(t,'lightning');claimSkill(t,'orbit');quietField(t);t.frame(1000);
  const title=t.currentNotice.title,clock=t.noticeClock;t.pause();for(let i=0;i<20;i++)t.frame(1040+i*40);
  assert.equal(t.currentNotice.title,title);assert.equal(t.noticeClock,clock);t.resume();t.showRelicMap();
  for(let i=0;i<20;i++)t.frame(2000+i*40);assert.equal(t.currentNotice.title,title);assert.equal(t.noticeClock,clock);t.closeRelicMap();
  t.updateSkills(8.01);assert.equal(t.currentNotice.title,'旋叶环');assert(element('lootTickerText').textContent.includes(t.relicDefs.find(d=>d.key==='orbit').description));
  t.updateSkills(8.01);assert.equal(t.currentNotice,null);assert(element('lootTicker').classList.contains('hidden'));
});
test('New relic pulses apply skill strength once, preserve range and ignore hidden enemies',({t})=>{
  draftRelics(t,['sunDisk']);claimSkill(t,'sunDisk');quietField(t);t.player.x=t.mapLayout.spawn.x;t.player.y=t.mapLayout.spawn.y;t.player.skillPower=2;
  const target=enemy(t.player.x+90,t.player.y,{hp:1000}),hidden=enemy(t.player.x+30,t.player.y,{hp:1000,aggro:false,pursuitAt:Infinity}),outside=enemy(t.player.x+240,t.player.y,{hp:1000});
  t.enemies.push(target,hidden,outside);t.updateSkills(.01);assert(Math.abs(target.hp-(1000-t.player.damage*1.1*2))<1e-8);
  assert.equal(hidden.hp,1000);assert.equal(outside.hp,1000);assert.equal(t.player.skillTimers.sunDisk,6);
});
test('New relic projectiles carry the advertised pierce and multiply skill strength once through their full collision path',({t})=>{
  draftRelics(t,['needleLeaf']);claimSkill(t,'needleLeaf');quietField(t);t.player.x=t.mapLayout.spawn.x;t.player.y=t.mapLayout.spawn.y;t.player.skillPower=2;
  const target=enemy(t.player.x+100,t.player.y,{hp:1000});t.enemies.push(target);t.updateSkills(.001);
  assert.equal(t.bullets.length,1);const expected=t.player.damage*1.5*2;assert(Math.abs(t.bullets[0].damage-expected)<1e-8);assert.equal(t.bullets[0].pierces,2);
  t.update(.12);assert(Math.abs(target.hp-(1000-expected))<1e-8);
});
test('Relic poison receives skill strength once across its whole duration and pauses its remaining damage',({t})=>{
  draftRelics(t,['acidLime']);claimSkill(t,'acidLime');quietField(t);t.player.x=t.mapLayout.spawn.x;t.player.y=t.mapLayout.spawn.y;t.player.skillPower=2;
  const target=enemy(t.player.x+100,t.player.y,{hp:1000});t.enemies.push(target);t.updateSkills(.001);assert.equal(target.hp,1000);
  t.frame(1000);t.pause();const remaining=t.player.relicDots[0].remaining;for(let i=0;i<20;i++)t.frame(1040+i*40);
  assert.equal(t.player.relicDots[0].remaining,remaining);assert.equal(target.hp,1000);t.resume();
  for(let i=0;i<50;i++)t.updateSkills(.05);
  const expected=t.player.damage*.4*2.5*2;assert(Math.abs(target.hp-(1000-expected))<1e-8);assert.equal(t.player.relicDots.length,0);
});
test('Three ward relics share a single shield and restart every replenishment timer on contact consumption',({t})=>{
  draftRelics(t,['shield','barkAmulet','prismShell']);for(const key of ['shield','barkAmulet','prismShell'])claimSkill(t,key);
  assert.equal(t.player.shield,1);t.player.x=t.mapLayout.spawn.x;t.player.y=t.mapLayout.spawn.y;t.player.inv=0;t.shotClock=Infinity;
  t.enemies=[enemy(t.player.x,t.player.y,{hp:1000})];const hp=t.player.hp;t.update(.001);assert.equal(t.player.hp,hp);assert.equal(t.player.shield,0);
  for(const key of ['shield','barkAmulet','prismShell'])assert(Math.abs(t.player.skillTimers[key]-t.relicDefs.find(d=>d.key===key).cooldown)<1e-8);
  t.enemies=[];for(let i=0;i<23;i++)t.updateSkills(1);assert.equal(t.player.shield,0);t.updateSkills(1);assert.equal(t.player.shield,1);
});
test('Passive relic pickup applies initial-base additive bonuses once without touching permanent progress',({t})=>{
  draftRelics(t,['amberKernel','windAnklet','heartApple','starBrooch','ironBark','mossBand']);
  const base=t.player.baseStats,before=JSON.stringify(t.profile);t.player.damage=base.damage*2;t.player.speed=base.speed*2;
  const hp=t.player.maxHp,crit=t.player.critChance,defense=t.player.defense,regen=t.player.regen;
  for(const def of t.runRelicDefs)claimSkill(t,def.key);
  assert(Math.abs(t.player.damage-base.damage*2.1)<1e-8);assert(Math.abs(t.player.speed-base.speed*2.08)<1e-8);assert.equal(t.player.maxHp,hp+16);
  assert(Math.abs(t.player.critChance-crit-.05)<1e-8);assert.equal(t.player.defense,defense+1.5);assert(Math.abs(t.player.regen-regen-.2)<1e-8);
  const damage=t.player.damage;assert.equal(t.claimRelic(t.relicDrops[0].id),false);assert.equal(t.player.damage,damage);assert.equal(JSON.stringify(t.profile),before);
});
function pickBuild(t,id,m=1){
  assert(t.builds.available(t.player,id));t.player.xp=t.player.need;t.upgrade();assert.equal(t.state,'upgrade');
  t.choices.splice(0,t.choices.length,{...t.builds.get(id),rarity:{mult:m,name:'测试品质',color:'#abc'}});t.choose(0);
}
test('Every super recipe fuses through real upgrade choices, occupies its original slots and executes a valid battle effect',()=>{
  for(const recipe of createGame().t.builds.recipes){
    const {t,element}=createGame();t.start();quietField(t);
    for(let n=0;n<5;n++)pickBuild(t,recipe.attack);
    for(let n=0;n<5;n++)pickBuild(t,recipe.attribute);
    assert.equal(t.player.build.superSkills.length,1);assert.equal(t.player.build.superSkills[0],recipe.id);
    assert.equal(t.player.build.attackSlots.length,1);assert.equal(t.player.build.attributeSlots.length,1);
    assert.equal(t.player.build.attackChoices,5);assert.equal(t.player.build.attributeChoices,5);
    assert.equal(t.builds.available(t.player,recipe.attack),false);assert.equal(t.builds.available(t.player,recipe.attribute),false);
    assert.equal(t.currentNotice.kind,'super');assert(element('superSkills').innerHTML.includes(recipe.name));
    const victim=enemy(t.player.x+60,t.player.y,{hp:10000});t.enemies.push(victim);
    let visible=false;for(let n=0;n<20;n++){t.updateSkills(.05);visible ||= t.skillEffects.length>0;}
    assert(victim.hp<10000,'The fused '+recipe.name+' must damage its active target');assert(visible);
    assert.equal(t.player.build.superSkills.length,1);
  }
},{start:false});
test('Build and hero combat damage apply skill strength exactly once and preserve stronger unexpired slows',({t})=>{
  quietField(t);const victim=enemy(t.player.x+80,t.player.y,{hp:10000});t.enemies.push(victim);t.player.skillPower=1.6;
  pickBuild(t,'chain');t.updateSkills(.01);assert(Math.abs(victim.hp-(10000-t.player.damage*.75*1.6))<1e-8);
  const before=victim.hp;assert(t.activateHeroSkill());assert(Math.abs(victim.hp-(before-t.player.damage*2.8*1.6))<1e-8);
  t.player.skills.frost=true;t.player.skillTimers.frost=0;victim.slowUntil=t.elapsed+4;victim.slowAmount=.5;
  t.updateSkills(.01);assert.equal(victim.slowAmount,.5);assert.equal(victim.slowUntil,t.elapsed+4);
});
test('Life steal uses actual lost enemy HP and caps total healing in each rolling second',({t})=>{
  t.player.hp=40;t.player.lifeSteal=.06;const small=enemy(0,0,{hp:10});t.skillHit(small,1000,'#abc');
  assert(Math.abs(t.player.hp-40.6)<1e-8);const large=enemy(0,0,{hp:10000});t.skillHit(large,2000,'#abc');
  const cap=t.player.maxHp*.03;
  assert(Math.abs(t.player.hp-(40+cap))<1e-8);t.skillHit(large,2000,'#abc');assert(Math.abs(t.player.hp-(40+cap))<1e-8);
  t.elapsed=1.01;t.skillHit(large,2000,'#abc');assert(Math.abs(t.player.hp-(40+cap*2))<1e-8);
});
test('Contact dodge prevents damage and thorn retaliation while accepted hits reflect damage and kill healing credits once',({t,setRandom})=>{
  quietField(t);const victim=enemy(t.player.x,t.player.y,{hp:8});t.enemies.push(victim);
  t.player.hp=90;t.player.inv=0;t.player.dodge=.2;t.player.thorns=1;t.player.killHeal=1;setRandom(0);
  t.update(.01);assert.equal(t.player.hp,90);assert.equal(victim.hp,8);assert.equal(t.kills,0);
  t.player.inv=0;t.player.dodge=0;t.update(.01);assert.equal(t.player.hp,76);assert.equal(t.kills,1);
  const hp=t.player.hp;t.update(.01);assert.equal(t.player.hp,hp);assert.equal(t.kills,1);
});
test('Range, projectile speed, stationary strength and XP attraction upgrades change actual combat and collection',({t})=>{
  quietField(t);for(let n=0;n<5;n++)pickBuild(t,'range');pickBuild(t,'projectileSpeed');pickBuild(t,'standPower');pickBuild(t,'magnet');
  let point;
  for(let n=0;n<32;n++){const a=n*Math.PI/16,x=t.player.x+Math.cos(a)*620,y=t.player.y+Math.sin(a)*620;
    if(t.world.isFree(x,y,19,t.obstacles,t.WORLD_W,t.WORLD_H)&&!t.world.blocksSegment(t.player.x,t.player.y,x,y,t.obstacles,2)){point={x,y};break}}
  assert(point);t.enemies.push(enemy(point.x,point.y,{hp:1e9}));t.shoot(true);assert.equal(t.bullets.length,1);
  const bullet=t.bullets[0];assert(Math.abs(Math.hypot(bullet.vx,bullet.vy)-450*1.08)<1e-8);
  assert(Math.abs(bullet.damage-t.seedDamage()*1.4)<1e-8);t.bullets.length=0;
  t.player.pickup=140;const gem={x:t.player.x+100,y:t.player.y,value:1};t.gems=[gem];t.update(.1);
  assert(Math.abs(gem.x-(t.player.x+100-320*1.15*.1))<1e-8);
});
test('A completed super and all its ranks survive endless entry while a fresh challenge resets every build slot',({t})=>{
  for(let n=0;n<5;n++)pickBuild(t,'chain');for(let n=0;n<5;n++)pickBuild(t,'range');
  // The ten fixture-supplied choices consume chapter XP instead of granting ten free ranks above the real budget.
  const spent=t.experience.budget(10);assert.equal(t.stageXP.collect(t.stageXP.grant(spent)),spent);
  clearStage(t);const build=t.player.build,levels=JSON.stringify(build.levels);assert(t.startEndless());
  assert.equal(t.player.level,31);
  assert.equal(t.player.build,build);assert.equal(JSON.stringify(t.player.build.levels),levels);assert(t.player.build.superSkills.includes('skyweb'));
  t.finishEndless(true);t.start();assert.equal(t.player.build.attackSlots.length,0);assert.equal(t.player.build.attributeSlots.length,0);assert.equal(t.player.build.superSkills.length,0);
});
test('Passive relic map descriptions show a lasting buff without undefined cooldowns and owned inventory buttons remain stable between frames',({t,element})=>{
  draftRelics(t,['amberKernel','windAnklet','heartApple','starBrooch','ironBark','mossBand']);claimSkill(t,'amberKernel');
  const button=element('relicSlots').querySelectorAll('[data-owned-relic]')[0];quietField(t);t.update(.01);
  assert.equal(element('relicSlots').querySelectorAll('[data-owned-relic]')[0],button);assert.equal(typeof button.onclick,'function');button.onclick();
  assert.equal(t.state,'relicMap');assert(element('overlay').innerHTML.includes('本局持续属性增益'));assert(!element('overlay').innerHTML.includes('undefined'));
});
test('All shipped real chapter clears reconcile exactly 10000 XP into thirty ranks before rescue under varying XP bonuses',({t})=>{
  for(const stage of t.stages){
    const id=stage.id;
    prepareStage(t,id);t.player.xpMult=[1,1.2,1.65,2.8][(id-1)%4];clearStage(t);
    assert.equal(t.player.level,31);assert.equal(t.player.xp,0);assert.equal(t.player.need,601);
    assert.equal(t.stageXP.budget,10000);assert.equal(t.stageXP.issued,10000);assert.equal(t.stageXP.collected,10000);assert(t.stageXP.settled);
    const build=t.player.build,summary=t.builds.summary(t.player);
    assert.equal(t.gems.length,0);assert.equal(build.mode,'stage');assert.equal(build.attackChoices+build.attributeChoices,30);
    assert(build.attackChoices<=20&&build.attributeChoices<=20);assert(build.attackSlots.length<=4&&build.attributeSlots.length<=4);
    assert(Object.values(build.levels).every(level=>level>=1&&level<=5));
    // Thirty choices may fill six slots to rank five; unused slots still allow further growth.
    assert.equal(summary.limits.totalChoices,40);assert.equal(summary.exhausted,false);
  }
});
test('Stage XP bonuses release more of the same reserve early without fractional gems or an extra final upgrade',()=>{
  const trials=[1,1.2].map(multiplier=>{
    const {t}=createGame();t.start();t.player.xpMult=multiplier;t.shotClock=Infinity;
    const victim=t.enemies.find(e=>!e.boss&&!e.elite);victim.hp=0;t.update(.001);
    assert(t.stageXP.issued>0);assert(Number.isInteger(t.stageXP.issued));
    const early=t.stageXP.issued;clearStage(t);assert.equal(t.stageXP.collected,10000);assert.equal(t.player.level,31);assert.equal(t.player.xp,0);return early;
  });
  assert(trials[1]>trials[0]);
},{start:false});
test('Endless combat XP bypasses the settled chapter budget and funds a real sixth rank through the upgrade panel',({t,element})=>{
  clearStage(t);const source=t.player.build.attackSlots[0];assert.equal(t.player.build.levels[source],5);assert(t.startEndless());
  assert.equal(t.player.build.mode,'endless');const previousPower=t.player.build.powers[source],ledger=JSON.stringify(t.stageXP.snapshot());
  t.shotClock=Infinity;t.enemies=[enemy(t.player.x,t.player.y,{hp:0,xp:t.player.need})];t.update(.001);
  assert.equal(t.state,'upgrade');assert(element('overlay').innerHTML.includes('无尽突破'));assert(!element('overlay').innerHTML.includes('每种最高 5 级'));
  t.choices.splice(0,t.choices.length,{...t.builds.get(source),rarity:{mult:1,name:'普通',color:'#abc'}});t.choose(0);
  assert.equal(t.player.level,32);assert.equal(t.player.build.levels[source],6);assert(t.player.build.powers[source]>previousPower);
  assert.equal(t.player.build.attackChoices+t.player.build.attributeChoices,31);assert.equal(JSON.stringify(t.stageXP.snapshot()),ledger);
  assert(element('buildSlots').innerHTML.includes('Lv.6'));assert(!element('buildSlots').innerHTML.includes('/20 次'));
});
test('A fifth distinct skill is learnable in endless and new challenges restore the four-slot five-rank rules',({t})=>{
  clearStage(t);assert(t.startEndless());const newAttack=t.builds.defs.find(def=>def.category==='attack'&&!t.player.build.attackSlots.includes(def.id)&&t.builds.available(t.player,def.id));assert(newAttack);
  pickBuild(t,newAttack.id);assert.equal(t.player.build.attackSlots.length,5);assert.equal(t.player.build.levels[newAttack.id],1);
  const existing=t.player.build.attributeSlots[0],previousLevel=t.player.build.levels[existing];pickBuild(t,existing);assert.equal(t.player.build.levels[existing],previousLevel+1);
  t.finishEndless(true);t.start();assert.equal(t.player.build.mode,'stage');assert.equal(t.player.level,1);assert.equal(t.player.xp,0);
  assert.equal(t.player.build.attackSlots.length,0);assert.equal(t.builds.getLimits(t.player).maxLevel,5);assert.equal(t.stageXP.issued,0);
});
test('Hero roster integration: all thirteen heroes are selectable before the first clear',({t,element})=>{
  assert.equal(t.profile.clearedStages.length,0);assert.equal(t.growth.heroes.length,13);
  for(const hero of t.growth.heroes){assert.equal(hero.unlockStage,0);assert(t.selectHero(hero.id));assert.equal(t.profile.selectedHero,hero.id);assert.equal(t.player.heroId,hero.id)}
  t.showHeroes();assert.equal(element('overlay').querySelectorAll('[data-inspect-hero]').length,13);
  assert(!element('overlay').innerHTML.includes('尚未解锁'));assert(!element('overlay').innerHTML.includes('关解锁'));
},{start:false});
test('Hero roster integration: cherry fires two real rows of twelve matching projectiles',({t})=>{
  t.startScreen();assert(t.selectHero('cherry'));t.start();t.shotClock=Infinity;
  t.enemies=[enemy(t.player.x+90,t.player.y,{hp:10000,xp:0})];assert(t.activateHeroSkill());assert.equal(t.bullets.length,12);
  const spec=t.growth.active('cherry',t.player);
  for(let i=0;i<6;i++){
    assert(Math.abs(t.bullets[i].vx-t.bullets[i+6].vx)<1e-8);assert(Math.abs(t.bullets[i].vy-t.bullets[i+6].vy)<1e-8);
    assert(Math.abs(t.bullets[i+6].y-t.bullets[i].y-10)<1e-8);
    assert(Math.abs(t.bullets[i].damage-spec.damage*t.player.skillPower)<1e-8);assert.equal(t.bullets[i].life,1.35);
  }
  assert.equal(t.activateHeroSkill(),false);
});
test('Hero roster integration: blueberry chain decays across five unique active targets',({t})=>{
  t.startScreen();assert(t.selectHero('blueberry'));t.start();t.shotClock=Infinity;
  const victims=[60,180,300,420,540,660].map(offset=>enemy(t.player.x+offset,t.player.y,{hp:10000,xp:0}));
  const dormant=enemy(t.player.x+30,t.player.y,{hp:10000,aggro:false,pursuitAt:Infinity});
  const defeated=enemy(t.player.x+20,t.player.y,{hp:0});t.enemies=[dormant,defeated,...victims];
  const spec=t.growth.active('blueberry',t.player);assert(t.activateHeroSkill());
  for(let i=0;i<5;i++)assert(Math.abs(victims[i].hp-(10000-spec.damage*t.player.skillPower*Math.pow(.9,i)))<1e-8);
  assert.equal(victims[5].hp,10000);assert.equal(dormant.hp,10000);assert.equal(defeated.hp,0);
  assert(t.skillEffects.some(effect=>effect.type==='chain'&&effect.points.length===6));
});
test('Hero roster integration: blueberry cannot acquire or chain through a real solid obstacle',({t})=>{
  t.startScreen();assert(t.selectHero('blueberry'));t.start();t.shotClock=Infinity;
  let placement=null;
  for(const obstacle of t.obstacles){
    if(obstacle.shape!=='circle'||obstacle.r>40)continue;
    const left={x:obstacle.x-obstacle.r-100,y:obstacle.y},first={x:obstacle.x-obstacle.r-55,y:obstacle.y},blocked={x:obstacle.x+obstacle.r+55,y:obstacle.y};
    if(![left,first,blocked].every(point=>t.world.isFree(point.x,point.y,19,t.obstacles,t.WORLD_W,t.WORLD_H)))continue;
    if(t.world.blocksSegment(left.x,left.y,first.x,first.y,t.obstacles)||!t.world.blocksSegment(first.x,first.y,blocked.x,blocked.y,t.obstacles))continue;
    placement={left,first,blocked};break;
  }
  assert(placement,'The shipped map must offer a small obstacle for the line-of-sight fixture');
  Object.assign(t.player,placement.left);const first=enemy(placement.first.x,placement.first.y,{hp:10000,xp:0}),blocked=enemy(placement.blocked.x,placement.blocked.y,{hp:10000,xp:0});
  t.enemies=[blocked,first];const spec=t.growth.active('blueberry',t.player);assert(t.activateHeroSkill());
  assert(Math.abs(first.hp-(10000-spec.damage*t.player.skillPower))<1e-8);assert.equal(blocked.hp,10000);
  t.player.heroClock=0;first.aggro=false;assert(t.activateHeroSkill());assert.equal(blocked.hp,10000);
});
test('Hero roster integration: pineapple guard lasts five seconds and leaves base defense intact',({t})=>{
  t.startScreen();assert(t.selectHero('pineapple'));t.start();t.shotClock=Infinity;
  t.enemies=[enemy(t.player.x,t.player.y,{hp:10000,damage:20,xp:0})];t.player.hp=100;t.player.defense=0;t.player.regen=0;
  assert(t.activateHeroSkill());assert.equal(t.player.guardUntil,5);assert.equal(t.player.guardDefense,3);assert.equal(t.player.defense,0);
  const hp=t.player.hp;t.update(.001);assert.equal(t.player.hp,hp-17);
  t.player.inv=0;t.elapsed=4.998;t.update(.001);assert.equal(t.player.hp,hp-34);
  t.player.inv=0;t.elapsed=5.001;t.update(.001);assert.equal(t.player.hp,hp-54);assert.equal(t.player.defense,0);
});
test('Hero roster integration: pineapple thorns require life damage and do not fire from a blocked hit',({t})=>{
  t.startScreen();assert(t.selectHero('pineapple'));t.start();t.shotClock=Infinity;
  const victim=enemy(t.player.x,t.player.y,{hp:10000,damage:20,xp:0});t.enemies=[victim];t.player.shield=1;t.player.inv=0;
  const hp=t.player.hp;t.update(.001);assert.equal(t.player.hp,hp);assert.equal(victim.hp,10000);
  t.player.inv=0;t.update(.001);assert(t.player.hp<hp);assert(Math.abs(victim.hp-(10000-t.player.damage*.12))<1e-8);
});
test('Hero roster integration: temporary guard and its cooldown freeze in pause and map panels',({t})=>{
  t.startScreen();assert(t.selectHero('pineapple'));t.start();quietField(t);t.frame(1000);assert(t.activateHeroSkill());
  const elapsed=t.elapsed,until=t.player.guardUntil,cooldown=t.player.heroClock;
  t.pause();for(let i=0;i<30;i++)t.frame(1040+i*40);
  assert.equal(t.elapsed,elapsed);assert.equal(t.player.guardUntil,until);assert.equal(t.player.heroClock,cooldown);
  t.showRelicMap();for(let i=0;i<30;i++)t.frame(3000+i*40);
  assert.equal(t.elapsed,elapsed);assert.equal(t.player.guardUntil,until);assert.equal(t.player.heroClock,cooldown);
  t.closeRelicMap();assert.equal(t.state,'paused');t.resume();t.update(.25);
  assert(Math.abs(t.elapsed-elapsed-.25)<1e-8);assert(Math.abs(t.player.heroClock-cooldown+.25)<1e-8);
  assert.equal(t.player.guardUntil,until);
});
for(const id of ['cherry','pear','blueberry','pineapple'])test('Hero roster integration: '+id+' uses its real SVG in both menu and Canvas drawing',()=>{
  const game=createGame(new Map(),{loadedAtlas:true}),{t,element,drawCalls}=game;
  assert(t.selectHero(id));t.showHeroes();assert(element('overlay').innerHTML.includes(t.art.heroImages[id]));
  assert(fs.existsSync(__dirname+'/'+t.art.heroImages[id]));t.start();drawCalls.length=0;t.draw();
  assert(drawCalls.some(call=>call.method==='drawImage'&&call.args[0].src===t.art.heroImages[id]));
},{start:false});
test('Balanced recovery: mass kills respect the rolling healing budget and credit each enemy once',({t})=>{
  quietField(t);t.player.hp=20;t.player.killHeal=100;
  const cap=t.player.maxHp*.015;
  t.enemies.push(...Array.from({length:50},()=>enemy(t.player.x+200,t.player.y,{hp:0,xp:0})));
  t.update(.001);assert.equal(t.kills,50);assert(Math.abs(t.player.hp-20-cap)<1e-8);
  assert(Math.abs(t.player.killHealEvents.reduce((sum,event)=>sum+event.amount,0)-cap)<1e-8);
  t.update(.001);assert.equal(t.kills,50);assert(Math.abs(t.player.hp-20-cap)<1e-8);
  t.elapsed=1.005;t.enemies.push(enemy(t.player.x+200,t.player.y,{hp:0,xp:0}));t.update(.001);
  assert.equal(t.kills,51);assert(Math.abs(t.player.hp-20-2*cap)<1e-8);
});
test('Balanced recovery: endless clock resets cannot carry a temporary guard or lock old healing history',({t})=>{
  clearStage(t);t.player.guardUntil=t.elapsed+5;t.player.guardDefense=3;
  t.player.leechEvents=[{at:t.elapsed,amount:10000}];t.player.killHealEvents=[{at:t.elapsed,amount:10000}];
  assert(t.startEndless());assert.equal(t.elapsed,0);assert.equal(t.player.guardUntil,0);assert.equal(t.player.guardDefense,0);
  assert.equal(t.player.leechEvents.length,0);assert.equal(t.player.killHealEvents.length,0);
  t.player.hp=t.player.maxHp-30;t.player.lifeSteal=.04;
  t.skillHit(enemy(0,0,{hp:100000}),10000,'#abc');assert(Math.abs(t.player.hp-(t.player.maxHp-30+t.player.maxHp*.03))<1e-8);
});
test('Balanced boss forecast announces arrival then hides while its active health bar remains',({t,element})=>{
  t.player.inv=1e9;t.shotClock=Infinity;t.update(.001);
  assert(!element('bossForecast').classList.contains('hidden'));assert(element('bossForecast').textContent.includes('60 秒'));
  t.elapsed=60;t.update(.001);assert.equal(t.state,'playing');assert(!element('bossForecast').classList.contains('hidden'));
  assert(element('bossForecast').textContent.includes('Boss登场'));t.elapsed+=4.01;t.update(.001);
  assert(element('bossForecast').classList.contains('hidden'));assert(!element('bossHud').classList.contains('hidden'));
  assert.equal(t.enemies.filter(e=>e.boss&&e.aggro).length,1);
});
test('New UI: the image precedes all four home actions and the selected relic draft survives entry',(game)=>{
  const {t,element}=game;t.startScreen();const markup=element('overlay').innerHTML;
  assert(markup.indexOf('chapter-name')<markup.indexOf('chapter-image'));
  for(const id of ['start','navArmory','navHeroes','navOrchard'])assert(markup.indexOf('id="'+id+'"')>markup.indexOf('chapter-image'));
  assert(!markup.includes('stage-grid'));assert(markup.includes('进入游戏'));assert(element('arena').classList.contains('is-lobby'));
  const draft=Array.from(t.runRelicDefs,d=>d.id);click(game,'navMap');click(game,'closeRelicMap');click(game,'start');
  assert.deepEqual(Array.from(t.runRelicDefs,d=>d.id),draft);assert.equal(t.state,'playing');assert(!element('arena').classList.contains('is-lobby'));
});
test('New UI: first login enters playable training automatically and an explicit skip survives reload',()=>{
  const game=createGame(new Map(),{tutorial:true}),{t,storage}=game;
  assert.equal(t.profile.tutorialSeen,false);assert.equal(t.state,'playing');assert.equal(t.runMode,'training');assert.equal(t.training.firstEntry,true);
  assert.equal(t.training.step,0);assert.equal(game.element('trainingExit').textContent,'跳过引导');assert(t.isRunActive());
  const before=permanentTrainingSnapshot(t.profile);t.pause();const field=JSON.stringify(t.enemies),player=JSON.stringify(t.player);
  for(let i=0;i<30;i++)t.frame(1000+i*40);
  assert.equal(t.elapsed,0);assert.equal(JSON.stringify(t.enemies),field);assert.equal(JSON.stringify(t.player),player);
  click(game,'leave');assert.equal(t.state,'lobby');assert.equal(t.training,null);assert.equal(t.profile.tutorialSeen,true);assert.equal(t.profile.trainingSkipped,true);
  assert.equal(t.profile.trainingComplete,false);assert.equal(permanentTrainingSnapshot(t.profile),before);
  const saved=JSON.parse(storage.get(t.currentSaveKey));assert.equal(saved.trainingSkipped,true);assert.equal(saved.trainingComplete,false);
  const loaded=createGame(storage,{tutorial:true});assert.equal(loaded.t.state,'lobby');assert.equal(loaded.t.profile.trainingSkipped,true);
  loaded.t.start();assert.equal(loaded.t.state,'playing');assert.equal(loaded.t.runMode,'stage');
},{start:false});
test('New UI: every manual guide step is reachable and completing it preserves an untouched battle',()=>{
  const game=createGame(),{t,element}=game;t.start();assert(t.openTutorial(false));const spawn=JSON.stringify(t.enemies);
  assert(element('previousTutorial').disabled);assert.equal(t.tutorialSteps().length,6);
  for(let step=0;step<6;step++){
    assert.equal(t.tutorialStep,step);assert(element('overlay').innerHTML.includes(t.tutorialSteps()[step].title));
    if(step===3){click(game,'previousTutorial');assert.equal(t.tutorialStep,2);click(game,'nextTutorial')}
    click(game,'nextTutorial');
  }
  assert.equal(t.state,'playing');assert.equal(t.profile.tutorialSeen,true);assert.equal(t.elapsed,0);assert.equal(JSON.stringify(t.enemies),spawn);
},{start:false});
test('New UI: the conversation modal freezes all combat clocks and rejects permanent growth',(game)=>{
  const {t,element}=game;quietField(t);t.frame(1000);t.player.heroClock=4;t.keys.add('d');
  assert(t.openGameHelp());assert.equal(t.state,'help');assert.equal(t.helpReturnState,'playing');assert.equal(t.keys.size,0);
  const elapsed=t.elapsed,battle=JSON.stringify(t.player),field=JSON.stringify(t.enemies),profile=JSON.stringify(t.profile);
  for(let i=0;i<30;i++)t.frame(1040+i*40);
  assert.equal(t.elapsed,elapsed);assert.equal(JSON.stringify(t.player),battle);assert.equal(JSON.stringify(t.enemies),field);
  assert(!t.selectStage(1));assert(!t.selectHero('cherry'));assert(!t.upgradeOrchard());assert(!t.trainHero('orange'));assert(!t.activateHeroSkill());assert(!t.claimRelic(t.relicDrops[0].id));
  assert.equal(JSON.stringify(t.profile),profile);assert(element('overlay').innerHTML.includes('可以看到我跟你之间的对话'));
  assert(!element('overlay').innerHTML.includes('id="navStages"'));click(game,'closeGameHelp');assert.equal(t.state,'playing');assert.equal(t.elapsed,elapsed);
});
test('New UI: help returns to the original pause state and can replay the chosen hero tutorial',(game)=>{
  const {t,element,listeners}=game;quietField(t);t.pause();assert(t.openGameHelp());assert.equal(t.helpReturnState,'paused');
  click(game,'viewTutorial');assert.equal(t.helpTab,'guide');for(let i=0;i<3;i++)click(game,'nextTutorial');
  assert(element('overlay').innerHTML.includes(t.growth.hero(t.player.heroId).skillName));
  listeners.keydown({key:'Escape',preventDefault(){}});assert.equal(t.state,'paused');assert(element('overlay').innerHTML.includes('id="resume"'));
  click(game,'resume');assert.equal(t.state,'playing');element('gameHelp').onclick();assert.equal(t.state,'help');click(game,'closeGameHelp');assert.equal(t.state,'playing');
});
test('New UI: native conversation scrolling and guide shortcuts never leave held movement inputs',(game)=>{
  const {t,listeners}=game;let prevented=false;listeners.keydown({key:'h',preventDefault(){}});assert.equal(t.state,'help');
  listeners.keydown({key:'ArrowDown',preventDefault(){prevented=true}});assert.equal(prevented,false);assert.equal(t.keys.size,0);
  click(game,'viewTutorial');listeners.keydown({key:'Enter',preventDefault(){}});assert.equal(t.tutorialStep,1);
  listeners.keydown({key:'Enter',target:{closest:()=>({})},preventDefault(){}});assert.equal(t.tutorialStep,1,'Focused buttons use native click exactly once');
  listeners.keydown({key:'d',preventDefault(){}});assert.equal(t.keys.size,0);listeners.keydown({key:'h',preventDefault(){}});assert.equal(t.state,'playing');assert.equal(t.keys.size,0);
});
test('New UI: conversation content is escaped and its snapshot is declared before the game boots',()=>{
  const game=createGame(new Map(),{conversation:{description:'<script>bad</script>',messages:[{role:'user',text:'<img src=x onerror=bad()> & "quoted"'}]}});
  game.t.start();assert(game.t.openGameHelp());const markup=game.element('overlay').innerHTML;
  assert(markup.includes('&lt;img'));assert(markup.includes('&lt;script&gt;'));assert(!markup.includes('<script>bad'));assert(!markup.includes('<img src=x'));
  const conversationScriptIndex=html.search(/<script\b[^>]*src="conversation-data\.js(?:\?[^" ]*)?"/);
  assert(conversationScriptIndex>=0&&conversationScriptIndex<gameScriptIndex);assert(/href="lobby-ui\.css(?:\?[^" ]*)?"/.test(html));assert(html.includes('id="gameHelp"'));
},{start:false});
test('New UI: help is unavailable in conflicting overlays and endless waves freeze during reading',(game)=>{
  const {t}=game;t.showRelicMap();assert(!t.openGameHelp());t.closeRelicMap();t.upgrade();assert(!t.openGameHelp());t.choose(0);
  clearStage(t);assert(!t.openGameHelp());assert(t.startEndless());quietField(t);assert(t.openGameHelp());const wave=t.endlessWave,elapsed=t.elapsed;
  for(let i=0;i<100;i++)t.frame(1000+i*40);assert.equal(t.endlessWave,wave);assert.equal(t.elapsed,elapsed);t.closeGameHelp();assert.equal(t.runMode,'endless');assert.equal(t.state,'playing');
});
test('New UI: help isolates keyboard focus and cannot activate the background endless exit',(game)=>{
  const {t,element,listeners,document}=game;clearStage(t);t.startEndless();t.openGameHelp();
  assert.equal(element('overlay').ariaProps.role,'dialog');assert.equal(element('overlay').ariaProps['aria-modal'],'true');
  assert(element('endEndless').disabled);assert.equal(element('endEndless').onclick(),false);assert.equal(t.state,'help');
  let prevented=false;listeners.keydown({key:'Tab',preventDefault(){prevented=true}});
  assert(prevented);assert.equal(document.activeElement,element('viewConversation'));
  listeners.keydown({key:'Tab',shiftKey:true,preventDefault(){}});assert.equal(document.activeElement,element('closeGameHelp'));
  click(game,'viewTutorial');assert.equal(document.activeElement,element('nextTutorial'));
  listeners.keydown({key:'Tab',preventDefault(){}});assert.equal(document.activeElement,element('viewConversation'));
  t.closeGameHelp();assert.equal(t.state,'playing');assert(!element('endEndless').disabled);element('endEndless').onclick();assert.equal(t.state,'ended');
});
test('Combat HUD: build icons freeze battle clocks and restore focus when details close',(game)=>{
  const {t,element,listeners,document}=game;quietField(t);
  assert(t.builds.choose(t.player,'chain').applied);t.update(.01);t.player.heroClock=4;t.keys.add('d');
  listeners['arena:pointerdown']({pointerId:7,clientX:300,clientY:300,target:{closest:()=>null}});
  listeners['arena:pointermove']({pointerId:7,clientX:370,clientY:300});
  const button=element('buildSlots').querySelectorAll('[data-build-category="attack"]')[0];
  assert.equal(typeof button.onclick,'function');assert(button.onclick());assert.equal(t.state,'help');
  assert(element('overlay').innerHTML.includes(t.builds.get('chain').name));assert.equal(t.keys.size,0);
  const elapsed=t.elapsed,player=JSON.stringify(t.player),field=JSON.stringify(t.enemies);
  for(let i=0;i<30;i++)t.frame(1000+i*40);
  assert.equal(t.elapsed,elapsed);assert.equal(JSON.stringify(t.player),player);assert.equal(JSON.stringify(t.enemies),field);
  click(game,'closeGameHelp');assert.equal(t.state,'playing');assert.equal(document.activeElement,button);
  const x=t.player.x;t.update(.01);assert.equal(t.player.x,x,'Reading clears both keyboard and touch movement');
  assert(t.builds.choose(t.player,'chain').applied);t.update(.01);
  const upgraded=element('buildSlots').querySelectorAll('[data-build-category="attack"]')[0];
  assert.notEqual(upgraded,button);assert(upgraded.onclick());assert(element('overlay').innerHTML.includes('Lv.2'));
  listeners.keydown({key:'Escape',preventDefault(){}});assert.equal(t.state,'playing');assert.equal(document.activeElement,upgraded);
});
test('Combat HUD: attribute details opened during pause return to pause with Escape',(game)=>{
  const {t,element,listeners,document}=game;quietField(t);assert(t.builds.choose(t.player,'speed').applied);t.update(.01);t.pause();
  const button=element('buildSlots').querySelectorAll('[data-build-category="attribute"]')[0];
  assert(button.onclick());assert.equal(t.state,'help');assert.equal(t.helpReturnState,'paused');
  assert(element('overlay').innerHTML.includes(t.builds.get('speed').name));const elapsed=t.elapsed;
  for(let i=0;i<20;i++)t.frame(1000+i*40);assert.equal(t.elapsed,elapsed);
  listeners.keydown({key:'Escape',preventDefault(){}});assert.equal(t.state,'paused');assert.equal(document.activeElement,button);
  assert(element('overlay').innerHTML.includes('id="resume"'));t.frame(2500);assert.equal(t.elapsed,elapsed);
  click(game,'resume');assert.equal(t.state,'playing');
});
test('Combat HUD: synthesized skill icons show effects and reject conflicting overlays',(game)=>{
  const {t,element}=game;quietField(t);const recipe=t.builds.recipes[0];
  for(let i=0;i<5;i++)for(const id of [recipe.attack,recipe.attribute])assert(t.builds.choose(t.player,id).applied);
  t.update(.01);const button=element('superSkills').querySelectorAll('[data-build-category="super"]')[0];
  assert(button);assert.equal(typeof button.onclick,'function');assert(button.onclick());
  assert(element('overlay').innerHTML.includes(recipe.name));assert(element('overlay').innerHTML.includes(recipe.description));
  assert(button.disabled);assert.equal(button.onclick(),false,'A second panel cannot replace an active detail dialog');
  click(game,'closeGameHelp');assert(!button.disabled);t.upgrade();
  const upgrade=element('overlay').innerHTML;assert(button.disabled);assert.equal(button.onclick(),false);assert.equal(t.state,'upgrade');assert.equal(element('overlay').innerHTML,upgrade);
  t.choose(0);assert(t.showRelicMap());const map=element('overlay').innerHTML;
  assert(button.disabled);assert.equal(button.onclick(),false);assert.equal(t.state,'relicMap');assert.equal(element('overlay').innerHTML,map);
  t.closeRelicMap();assert.equal(t.state,'playing');assert(!element('combatGuide').disabled);assert(element('combatGuide').onclick());
  assert.equal(t.state,'help');assert.equal(t.helpTab,'guide');click(game,'closeGameHelp');assert.equal(t.state,'playing');
});
function trainingUntil(t,condition,seconds=25) {
  for(let frame=0;!condition()&&frame<Math.ceil(seconds/.04);frame++) {
    assert.equal(t.state,'playing','A training task must remain playable until its actual objective is completed');
    t.update(.04);
  }
  assert(condition(),'The current training objective must be reachable through gameplay');
}
function trainingToExperience(t) {
  assert.equal(t.training.step,0);t.keys.add('d');trainingUntil(t,()=>t.training.step===1,3);t.keys.clear();
  trainingUntil(t,()=>t.training.step===2,3);assert.equal(t.enemies.length,2);
  trainingUntil(t,()=>t.training.step===3);assert.equal(t.kills,2);
}
function trainingToMap(t) {
  trainingToExperience(t);
  assert.equal(t.gems.length,2);
  for(const gem of [...t.gems]) {t.player.x=gem.x;t.player.y=gem.y;t.update(.001);}
  assert.equal(t.state,'upgrade');assert.equal(t.training.step,4);assert.equal(t.choices.length,3);
  assert.equal(t.training.xpCollected,t.experienceNeed(1));const level=t.player.level;t.choose(0);
  assert.equal(t.player.level,level+1);assert.equal(t.builds.summary(t.player).totalChoices,1);assert.equal(t.training.step,5);
  assert(t.activateHeroSkill());t.update(.001);assert.equal(t.training.step,6);
  const relic=t.relicDrops[0];t.player.x=relic.x;t.player.y=relic.y;t.update(.001);
  assert(relic.claimed);assert.equal(t.player.skills.lightning,true);assert.equal(t.training.step,7);
}
function completeTrainingRun(t) {
  trainingToMap(t);assert(t.showRelicMap());assert.equal(t.state,'relicMap');assert(t.closeRelicMap());t.update(.001);
  assert.equal(t.state,'playing');assert.equal(t.training.step,8);assert.equal(t.enemies.filter(e=>e.elite).length,1);
  trainingUntil(t,()=>t.training.step===9);assert.equal(t.enemies.filter(e=>e.boss).length,1);
  assert.equal(t.bossKills,0);trainingUntil(t,()=>t.state==='trainingDone');
  assert.equal(t.training,null);assert.equal(t.state,'trainingDone');
}
function permanentTrainingSnapshot(profile) {
  const saved=JSON.parse(JSON.stringify(profile));delete saved.trainingComplete;delete saved.trainingSkipped;delete saved.tutorialSeen;return JSON.stringify(saved);
}
test('First training: a fresh login cannot silently enter campaign and an unfinished course restarts after reload',()=>{
  const storage=new Map(),game=createGame(storage,{tutorial:true}),{t}=game;
  assert.equal(t.state,'playing');assert.equal(t.runMode,'training');assert.equal(t.training.firstEntry,true);assert(t.needsFirstTraining());
  const course=t.training;t.keys.add('d');t.update(.1);t.keys.clear();const distance=t.training.distance;
  assert.equal(t.start(),false);assert.equal(t.training,course);assert.equal(t.training.distance,distance);assert.equal(t.runMode,'training');
  assert.equal(t.profile.trainingSkipped,false);assert.equal(t.profile.trainingComplete,false);
  const restored=createGame(storage,{tutorial:true});assert.equal(restored.t.state,'playing');assert.equal(restored.t.runMode,'training');
  assert.equal(restored.t.training.firstEntry,true);assert.equal(restored.t.training.step,0);assert.equal(restored.t.training.distance,0);
  restored.t.exitTraining();assert.equal(restored.t.start(),true);assert.equal(restored.t.runMode,'training');assert.equal(restored.t.training.firstEntry,true);
},{start:false});
test('First training: the visible skip is explicit, permanent, account-scoped and manual replay preserves it',()=>{
  const storage=new Map(),game=createGame(storage,{auth:true,tutorial:true}),{t}=game;
  const account=id=>Object.freeze({id,account:id,nickname:id});t.acceptAccount(account('新芽'));const before=permanentTrainingSnapshot(t.profile);
  assert.equal(game.element('trainingExit').textContent,'跳过引导');game.element('trainingExit').onclick();
  assert.equal(t.state,'lobby');assert.equal(t.training,null);assert.equal(t.profile.trainingSkipped,true);assert.equal(t.profile.trainingComplete,false);
  assert.equal(permanentTrainingSnapshot(t.profile),before);assert.equal(t.needsFirstTraining(),false);assert(t.logoutAccount());
  t.acceptAccount(account('新芽'));assert.equal(t.state,'lobby');assert.equal(t.training,null);assert.equal(t.profile.trainingSkipped,true);
  const skipped=JSON.stringify(t.profile);assert(t.startTraining());assert.equal(t.training.firstEntry,false);assert.equal(game.element('trainingExit').textContent,'退出练习');
  game.element('trainingExit').onclick();assert.equal(JSON.stringify(t.profile),skipped);assert.equal(t.state,'lobby');assert(t.logoutAccount());
  t.acceptAccount(account('新叶'));assert.equal(t.runMode,'training');assert.equal(t.training.firstEntry,true);assert.equal(t.profile.trainingSkipped,false);
},{start:false});
test('First training: completed, explicitly skipped and existing progressed saves bypass automatic practice',()=>{
  for(const existing of [{trainingComplete:true},{trainingSkipped:true},{tutorialSeen:true},{unlockedStage:2},{clearedStages:[1]}]){
    const storage=new Map([['orchard-save-v1',JSON.stringify({version:1,unlockedStage:1,clearedStages:[],seeds:19,cores:3,...existing})]]);
    const {t}=createGame(storage,{tutorial:true});assert.equal(t.state,'lobby');assert.equal(t.training,null);assert.equal(t.needsFirstTraining(),false);
    assert.equal(t.profile.seeds,19);assert.equal(t.profile.cores,3);t.start();assert.equal(t.state,'playing');assert.equal(t.runMode,'stage');
  }
},{start:false});
test('First training: closing a reference guide does not mark unfinished practice complete or skipped',()=>{
  const {t}=createGame(new Map(),{tutorial:true});assert.equal(t.runMode,'training');assert(t.openTutorial(false));
  assert.equal(t.skipTraining(),false);assert.equal(t.start(),false);assert(t.closeGameHelp());assert.equal(t.runMode,'training');
  assert.equal(t.profile.trainingComplete,false);assert.equal(t.profile.trainingSkipped,false);assert.equal(t.profile.tutorialSeen,false);
},{start:false});
test('Pause control: a text label and accessible action survive pause, help, resume and upgrade',game=>{
  const {t,element}=game,button=element('pause');
  const expect=label=>{assert.equal(button.dataset.action,label);assert(button.innerHTML.includes('pause-label'));assert(button.innerHTML.includes('>'+label+'</span>'));assert.equal(button.ariaProps['aria-label'],label)};
  expect('暂停');assert.equal(button.disabled,false);button.onclick();assert.equal(t.state,'paused');expect('继续');
  button.onclick();assert.equal(t.state,'playing');expect('暂停');assert(t.openGameHelp());expect('返回');button.onclick();expect('暂停');
  assert.equal(t.state,'playing');t.upgrade();assert.equal(button.disabled,true);assert(button.innerHTML.includes('pause-label'));t.choose(0);expect('暂停');assert.equal(button.disabled,false);
  assert(/<button\b[^>]*id="pause"[^>]*>[\s\S]*?class="pause-label">暂停<\/span>/.test(html));
});
test('Training: the lobby entrance starts an isolated course and prevents premature completion',(game)=>{
  const {t,element}=game;t.startScreen();click(game,'startTraining');assert.equal(t.state,'trainingIntro');
  const before=JSON.stringify(t.profile);click(game,'beginTraining');assert.equal(t.runMode,'training');assert.equal(t.state,'playing');
  assert.equal(t.training.step,0);assert.equal(t.enemies.length,0);assert.equal(t.elapsed,0);assert.equal(t.player.level,1);
  assert(!t.startTraining());assert(!t.finishTraining());assert(!t.startEndless());assert(!t.completeRescue());assert(!t.checkStageCompletion());
  assert.equal(JSON.stringify(t.profile),before);
  assert(!t.selectStage(1));assert(!t.selectHero('cherry'));assert(!t.upgradeOrchard());assert(!t.trainHero('orange'));
  assert(!element('trainingHud').classList.contains('hidden'));t.finish(true);assert.equal(t.state,'lobby');assert.equal(t.training,null);assert.equal(JSON.stringify(t.profile),before);
},{start:false});
test('Training: actual movement, standing, auto attacks, XP, choice, skill, relic, map and bosses complete the course',()=>{
  const game=createGame(new Map(),{tutorial:true}),{t,storage,element}=game;
  const before=permanentTrainingSnapshot(t.profile);assert.equal(t.runMode,'training');assert(t.training.firstEntry);completeTrainingRun(t);
  assert.equal(permanentTrainingSnapshot(t.profile),before,'Practice cannot award currency, gear, residents or campaign unlocks');
  assert.equal(t.profile.trainingComplete,true);assert.equal(t.profile.tutorialSeen,true);
  const saved=JSON.parse(storage.get(t.currentSaveKey));assert.equal(saved.trainingComplete,true);assert.equal(saved.tutorialSeen,true);
  assert(element('overlay').innerHTML.includes('id="trainingCampaign"'));assert(!t.finishTraining());assert(!t.startEndless());
  const loaded=createGame(storage,{tutorial:true});assert.equal(loaded.t.profile.trainingComplete,true);assert.equal(loaded.t.state,'lobby');assert.equal(loaded.t.training,null);
  click(game,'trainingCampaign');assert.equal(t.state,'playing');assert.equal(t.runMode,'stage');assert.equal(t.player.level,1);
  assert.equal(t.player.need,t.experienceNeed(1));assert.equal(t.enemies.length,t.activeStage.enemyCount);assert.equal(t.training,null);
},{start:false});
test('Training: pause and help freeze task progress, combat clocks and guarded actions',(game)=>{
  const {t,element}=game;assert(t.startTraining());t.keys.add('d');t.update(.2);t.keys.clear();t.frame(1000);t.pause();
  const progress=JSON.stringify(t.training),player=JSON.stringify(t.player),elapsed=t.elapsed;
  assert(!t.trainingTick(100,100000));assert(!t.activateHeroSkill());assert(!t.claimRelic(t.relicDrops[0].id));assert(!t.finishTraining());
  for(let i=0;i<60;i++)t.frame(1040+i*40);
  assert.equal(JSON.stringify(t.training),progress);assert.equal(JSON.stringify(t.player),player);assert.equal(t.elapsed,elapsed);
  click(game,'resume');assert(t.openTutorial(false));assert.equal(t.tutorialSteps().length,10);
  const helpProgress=JSON.stringify(t.training),helpElapsed=t.elapsed;
  for(let i=0;i<60;i++)t.frame(4000+i*40);assert.equal(JSON.stringify(t.training),helpProgress);assert.equal(t.elapsed,helpElapsed);
  click(game,'closeGameHelp');assert.equal(t.state,'playing');t.keys.add('d');trainingUntil(t,()=>t.training.step===1,3);t.keys.clear();
  t.update(.6);assert.equal(t.training.step,1);t.keys.add('a');t.update(.05);t.keys.clear();
  assert.equal(t.training.standTime,0,'Moving restarts the continuous standing objective');
  t.update(.6);assert.equal(t.training.step,1);trainingUntil(t,()=>t.training.step===2,2);
  assert(!element('trainingHud').classList.contains('hidden'));assert(t.exitTraining());
},{start:false});
test('Training: the distribution map pauses learning and closing it advances only the map objective',(game)=>{
  const {t}=game;assert(t.startTraining());trainingToMap(t);assert(t.showRelicMap());
  assert.equal(t.training.step,7);const elapsed=t.elapsed,progress=JSON.stringify(t.training),field=JSON.stringify(t.enemies);
  assert(!t.trainingTick(100,100000));assert(!t.activateHeroSkill());
  for(let i=0;i<80;i++)t.frame(1000+i*40);
  assert.equal(t.elapsed,elapsed);assert.equal(JSON.stringify(t.training),progress);assert.equal(JSON.stringify(t.enemies),field);
  assert(t.closeRelicMap());t.update(.001);assert.equal(t.training.step,8);assert.equal(t.state,'playing');assert.equal(t.enemies.filter(e=>e.elite).length,1);
  assert(!t.closeRelicMap());assert.equal(t.training.step,8);assert(t.exitTraining());
},{start:false});
test('Training: quitting restores the selected stage, relic draft and normal run values',()=>{
  const game=createGame(new Map(),{randomRelics:true});
  const {t,element}=game;t.profile.unlockedStage=7;assert(t.selectStage(7));t.startScreen();
  const draft=JSON.stringify(t.runRelicDefs),drops=JSON.stringify(t.relicDrops),before=JSON.stringify(t.profile);
  assert(t.startTraining());trainingToMap(t);assert.equal(t.player.level,2);assert(t.player.skills.lightning);
  element('trainingExit').onclick();assert.equal(t.state,'lobby');assert.equal(t.training,null);assert.equal(t.runMode,'stage');
  assert.equal(t.selectedStage,7);assert.equal(t.previewStage,7);assert.equal(t.mapLayout.id,7);
  assert.equal(JSON.stringify(t.runRelicDefs),draft);assert.equal(JSON.stringify(t.relicDrops),drops);assert.equal(JSON.stringify(t.profile),before);
  assert(t.startTraining());assert.equal(t.training.step,0);assert.equal(t.training.distance,0);assert.equal(t.player.level,1);assert(!t.player.skills.lightning);
  t.start();assert.equal(t.training,null);assert.equal(t.runMode,'stage');assert.equal(t.activeStage.id,7);
  assert.equal(t.player.level,1);assert.equal(t.player.xp,0);assert.equal(t.player.need,t.experienceNeed(1));assert(!t.player.skills.lightning);
  assert.equal(t.enemies.length,t.activeStage.enemyCount);assert.equal(JSON.stringify(t.runRelicDefs),draft);assert.equal(JSON.stringify(t.profile),before);
},{start:false});
test('Training: learning completion belongs to the logged-in account and legacy saves remain valid',()=>{
  const storage=new Map(),game=createGame(storage,{auth:true,tutorial:true}),{t}=game;
  t.acceptAccount(Object.freeze({id:'sprouta',account:'sprouta',nickname:'芽芽'}));assert.equal(t.profile.trainingComplete,false);
  assert.equal(t.state,'playing');assert.equal(t.runMode,'training');completeTrainingRun(t);const aKey=t.currentSaveKey;assert.equal(JSON.parse(storage.get(aKey)).trainingComplete,true);
  t.startScreen();assert(t.logoutAccount());t.acceptAccount(Object.freeze({id:'sproutb',account:'sproutb',nickname:'叶叶'}));
  assert.notEqual(t.currentSaveKey,aKey);assert.equal(t.profile.trainingComplete,false);assert.equal(t.profile.tutorialSeen,false);
  assert.equal(t.runMode,'training');assert.equal(t.training.firstEntry,true);
  t.startScreen();assert(t.logoutAccount());t.acceptAccount(Object.freeze({id:'sprouta',account:'sprouta',nickname:'芽芽'}));assert.equal(t.profile.trainingComplete,true);
  const legacy=createGame(new Map([['orchard-save-v1',JSON.stringify({version:1,unlockedStage:3,seeds:17,cores:4,tutorialSeen:true})]]));
  assert.equal(legacy.t.profile.trainingComplete,false);assert.equal(legacy.t.profile.unlockedStage,3);assert.equal(legacy.t.profile.seeds,17);assert.equal(legacy.t.profile.cores,4);
},{start:false});
test('Training: experience bonuses cannot skip the pickup lesson or trigger a second practice upgrade',()=>{
  const {t}=createGame(new Map(),{randomRelics:true});assert(t.startTraining());t.player.xpMult=4;
  trainingToMap(t);assert.equal(t.training.xpCollected,t.experienceNeed(1));assert.equal(t.player.level,2);assert.equal(t.player.xp,0);
  assert.equal(t.builds.summary(t.player).totalChoices,1);assert.equal(t.state,'playing');t.update(.2);assert.equal(t.state,'playing');
  assert.equal(t.player.level,2);assert.equal(t.training.step,7);assert(t.exitTraining());
},{start:false});
test('Training: incoming hits preserve the practice health floor without granting a clear',(game)=>{
  const {t}=game;assert(t.startTraining());t.keys.add('d');trainingUntil(t,()=>t.training.step===1,3);t.keys.clear();
  trainingUntil(t,()=>t.training.step===2,3);const before=JSON.stringify(t.profile);t.shotClock=Infinity;
  t.enemies=[enemy(t.player.x+1,t.player.y,{hp:1e9,maxHp:1e9,damage:9999,xp:0})];
  for(let hit=0;hit<4;hit++){t.player.inv=0;t.update(.01);assert.equal(t.player.hp,t.player.maxHp*.5);assert.equal(t.state,'playing');}
  assert.equal(t.training.step,2);assert.equal(t.kills,0);assert.equal(JSON.stringify(t.profile),before);assert(t.exitTraining());
},{start:false});
test('Prompt placement: out-of-combat menus open help and return without starting a run',({t,element})=>{
  const saved=JSON.stringify(t.profile);t.startScreen();
  for(const [open,expected] of [[()=>t.startScreen(),'lobby'],[()=>t.showHeroes(),'heroes'],[()=>t.showArmory(),'armory'],[()=>t.showOrchard(),'orchard'],[()=>t.showRelicMap(),'relicMap']]){
    open();assert.equal(t.state,expected);assert(!element('gameHelp').classList.contains('hidden'));assert(!element('gameHelp').disabled);
    element('gameHelp').onclick();assert.equal(t.state,'help');assert.equal(t.helpReturnState,expected);assert(!t.isRunActive());
    element('viewTutorial').onclick();element('closeGameHelp').onclick();assert.equal(t.state,expected);assert(!t.isRunActive());
  }
  assert.equal(JSON.stringify(t.profile),saved);t.startScreen();t.start();assert(element('gameHelp').classList.contains('hidden'));
});
test('Prompt placement: locked chapter preview remains selected after closing help',({t,element})=>{
  t.startScreen();t.browseStage(1);assert.equal(t.previewStage,2);assert.equal(t.selectedStage,1);
  assert(t.openGameHelp());assert(element('overlay').innerHTML.includes('返回局外'));assert(t.closeGameHelp());
  assert.equal(t.state,'lobby');assert.equal(t.previewStage,2);assert.equal(t.selectedStage,1);assert(element('start').disabled);
  assert(html.indexOf('id="gameHelp"')>html.indexOf('<header>'));assert(html.indexOf('id="gameHelp"')<html.indexOf('</header>'));
});
test('Campaign: later eighty chapters have bounded encounters, rising stats and their own final boss',({t,bosses})=>{
  let previous=t.stages[19];
  for(const s of t.stages.slice(20)){
    assert.equal(s.chapter,Math.floor((s.id-1)/20)+1);
    assert.equal(s.normalCount,398);assert.equal(s.eliteCount,44+Math.ceil((s.id-20)/4));
    assert(s.bossCount>=5&&s.bossCount<=10);assert.equal(s.bossIds.length,s.bossCount);
    assert.equal(new Set(s.bossIds).size,s.bossCount);assert.equal(s.bossIds.at(-1),s.id);
    assert.equal(s.bossActiveCap,1);assert.equal(s.bossRecovery,12);
    assert(s.bossIds.every(id=>bosses[id-1]?.stageId===id));
    for(const type of ['slow','fast','elite']){
      assert(s[type].hp>=previous[type].hp);assert(s[type].damage>=previous[type].damage);
      assert(s[type].speed<205);
    }
    assert.equal(s.xpRewards.reduce((a,b)=>a+b,0),10000);assert.equal(s.experience.choices,30);
    previous=s;
  }
});
test('Campaign: the old level-five save stays earned and level-thirty training is affordable across the campaign',({t})=>{
  const p=t.growth.migrate({selectedHero:'orange',heroLevels:{orange:5},talents:{damage:6}},{clearedStages:[20]});
  assert.equal(p.heroLevels.orange,5);assert.equal(p.talents.damage,6);
  const b=t.growth.bonuses(p);assert(Math.abs(b.damage-.245)<1e-8);assert.equal(b.hp,25);
  const budget=t.stages.reduce((sum,s)=>sum+s.reward.seeds,0);
  let total=0,previous=0;
  for(let level=0;level<30;level++) {const cost=t.growth.cost('hero','orange',level);assert(cost.seeds>previous);previous=cost.seeds;total+=cost.seeds;}
  assert(total>960&&total<budget);assert.equal(t.growth.cost('hero','orange',30),null);
});
test('Campaign: later saves preserve clears, selected new hero and extended training levels',()=>{
  const raw={version:1,unlockedStage:100,clearedStages:[20,21,40,99,100,101],selectedHero:'coconut',heroLevels:{coconut:29,orange:5},talents:{damage:18},rescuedSprites:[1,20]};
  const {t}=createGame(new Map([['orchard-save-v1',JSON.stringify(raw)]]));
  assert.equal(t.profile.unlockedStage,100);assert.deepEqual(Array.from(t.profile.clearedStages),[20,21,40,99,100]);
  assert.equal(t.profile.selectedHero,'coconut');assert.equal(t.profile.heroLevels.coconut,29);assert.equal(t.profile.talents.damage,18);
  t.startScreen();assert(t.selectStage(100));t.start();assert.equal(t.activeStage.id,100);assert.equal(t.mapLayout.id,100);
});
test('Campaign: chapter and stage selectors preview locked content and start unlocked content',(game)=>{
  const {t,element}=game;t.startScreen();element('chapterJump').value='81';element('chapterJump').onchange();
  assert.equal(t.previewStage,81);assert.equal(t.selectedStage,1);assert(element('start').disabled);
  t.profile.unlockedStage=100;element('stageJump').value='100';element('stageJump').onchange();
  assert.equal(t.selectedStage,100);assert.equal(t.previewStage,100);assert(!element('start').disabled);
  element('start').onclick();assert.equal(t.activeStage.id,100);assert.equal(t.state,'playing');
});
test('Campaign: peach heals within the health cap and its timed defense expires',({t})=>{
  t.startScreen();assert(t.selectHero('peach'));t.start();quietField(t);t.player.hp=t.player.maxHp-30;
  const hp=t.player.hp;t.activateHeroSkill();assert(Math.abs(t.player.hp-hp-(t.player.maxHp*.08+6))<1e-8);
  assert.equal(t.player.guardDefense,2);assert.equal(t.player.guardUntil,t.elapsed+4);assert(!t.activateHeroSkill());
  t.update(4.1);assert(t.player.guardUntil<t.elapsed);
});
test('Campaign: grape launches twelve finite projectiles covering the full circle with penetration',({t})=>{
  t.startScreen();assert(t.selectHero('grape'));t.start();quietField(t);assert(t.activateHeroSkill());
  assert.equal(t.bullets.length,12);assert(t.bullets.every(b=>b.pierces===1&&Number.isFinite(b.damage)&&b.life===1.5));
  assert(t.bullets.some(b=>b.vx>470)&&t.bullets.some(b=>b.vx< -470));assert(t.bullets.some(b=>b.vy>470)&&t.bullets.some(b=>b.vy< -470));
});
test('Campaign: watermelon slows ordinary enemies and bosses differently and grants a single shield',({t})=>{
  t.startScreen();assert(t.selectHero('watermelon'));t.start();quietField(t);
  const normal=enemy(t.player.x+50,t.player.y,{hp:1000}),boss=enemy(t.player.x+100,t.player.y,{hp:1000,boss:true});
  t.enemies=[normal,boss];assert(t.activateHeroSkill());assert.equal(normal.slowAmount,.45);assert.equal(boss.slowAmount,.2);
  assert.equal(t.player.shield,1);assert.equal(t.player.standPower,.1);
  t.player.heroClock=0;assert(t.activateHeroSkill());assert.equal(t.player.shield,1);
});
test('Campaign: banana strikes at the dash destination and collisions keep it outside solids',({t})=>{
  t.startScreen();assert(t.selectHero('banana'));t.start();quietField(t);
  const start=t.player.x,point=t.world.safePoint(t.player.x+210,t.player.y,44,t.obstacles,t.WORLD_W,t.WORLD_H);
  const victim=enemy(point.x-40,point.y,{hp:1000});t.enemies=[victim];assert(t.activateHeroSkill());
  assert(t.player.x>start);assert(t.player.x<=start+210+1e-7);assert.equal(t.player.inv,.6);
  assert(t.world.isFree(t.player.x,t.player.y,t.player.r||17,t.obstacles,t.WORLD_W,t.WORLD_H));assert(victim.hp<1000);
  const solid=t.obstacles.find(o=>o.shape==='circle'&&t.world.isFree(o.x-o.r-40,o.y,17,t.obstacles,t.WORLD_W,t.WORLD_H));
  assert(solid);t.player.x=solid.x-solid.r-40;t.player.y=solid.y;t.player.heroClock=0;
  assert(t.activateHeroSkill());assert(t.player.x<solid.x-solid.r);
  assert(t.world.isFree(t.player.x,t.player.y,17,t.obstacles,t.WORLD_W,t.WORLD_H));
});
test('Campaign: coconut targets the weakest health ratio and applies its execute threshold',({t})=>{
  t.startScreen();assert(t.selectHero('coconut'));t.start();quietField(t);
  const healthy=enemy(t.player.x+50,t.player.y,{hp:1000,maxHp:1000}),wounded=enemy(t.player.x+100,t.player.y,{hp:300,maxHp:1000});
  t.enemies=[healthy,wounded];const damage=t.player.damage;assert(t.activateHeroSkill());assert.equal(healthy.hp,1000);
  assert(Math.abs(wounded.hp-(300-damage*8*t.player.skillPower))<1e-8);
  t.player.heroClock=0;t.enemies=[healthy];assert(t.activateHeroSkill());assert(Math.abs(healthy.hp-(1000-damage*4*t.player.skillPower))<1e-8);
});
if(require.main===module){
  console.log(`${count} gameplay checks passed.`);
  if(failures.length){console.error(`${failures.length} checks failed.`);process.exitCode=1;}
}
module.exports={createGame,quietField,clearStage,click};
