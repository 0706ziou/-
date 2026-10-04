// Offline cover + real Web Crypto account integration, using the shipped game scripts.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {createGame,quietField,clearStage,click}=require('./verify.cjs');
let count=0;
async function test(name,fn){await fn();count++;console.log('PASS '+name)}
function game(storage=new Map()){return createGame(storage,{auth:true,tutorial:true})}
async function login(g,account,password='orchard-pass-123'){
  g.element('loginAccount').value=account;g.element('loginPassword').value=password;
  return g.t.submitLogin();
}
function skipFirstTraining(g){
  assert.equal(g.t.state,'playing');assert.equal(g.t.runMode,'training');assert.equal(g.t.training.firstEntry,true);
  assert.equal(g.element('trainingExit').textContent,'跳过引导');g.element('trainingExit').onclick();
  assert.equal(g.t.state,'lobby');assert.equal(g.t.profile.trainingSkipped,true);assert.equal(g.t.profile.trainingComplete,false);
}
(async()=>{
  await test('Cover blocks combat and growth while preserving native form keyboard input',async()=>{
    const g=game(),{t,element,listeners,document}=g;
    assert.equal(t.state,'cover');assert.equal(t.currentAccount,null);assert(document.body.classList.contains('is-cover'));
    assert(!t.start());assert(!t.selectStage(1));assert(!t.selectHero('cherry'));assert(!t.equipGear('weapon_seed'));
    assert(!t.showHeroes());assert(!t.showArmory());assert(!t.showOrchard());assert(!t.showRelicMap());assert(!t.saveProfile());
    const snapshot=JSON.stringify(t.profile);let prevented=false;
    for(const key of ['w','e','p','m','h','ArrowLeft',' ','Escape','Enter'])listeners.keydown({key,preventDefault(){prevented=true}});
    for(let i=0;i<30;i++)t.frame(1000+i*40);
    assert(!prevented);assert.equal(t.keys.size,0);assert.equal(t.elapsed,0);assert.equal(t.enemies.length,0);assert.equal(JSON.stringify(t.profile),snapshot);
    assert.equal(g.drawCalls.length,0);assert(!element('coverScreen').classList.contains('hidden'));
  });
  await test('One Chinese name registers as both account and nickname and preserves the original single-player save',async()=>{
    const legacy={version:1,unlockedStage:4,clearedStages:[1,2,3],seeds:300,cores:20,tutorialSeen:true,selectedHero:'pear',heroLevels:{pear:2}};
    const original=JSON.stringify(legacy),storage=new Map([['orchard-save-v1',original]]),g=game(storage);
    assert(await login(g,'果园主人'));assert.equal(g.t.state,'lobby');assert.equal(g.t.currentAccount.id,'果园主人');
    assert.equal(g.t.profile.seeds,300);assert.equal(g.t.profile.selectedHero,'pear');assert.equal(g.t.selectedStage,4);
    assert.equal(storage.get('orchard-save-v1'),original);assert.equal(g.t.currentSaveKey,'orchard-save-v1:user:果园主人');
    assert(g.element('overlay').innerHTML.includes('注册成功'));assert(g.element('overlay').innerHTML.includes('果园主人'));
    assert.equal(g.t.currentAccount.nickname,'果园主人');assert.equal(g.element('playerName').textContent,'果园主人');
    assert(g.element('coverScreen').classList.contains('hidden'));assert(!g.document.body.classList.contains('is-cover'));
  });
  await test('Two real accounts retain separate stage, hero, resources, training and tutorial progress',async()=>{
    const storage=new Map(),g=game(storage);assert(await login(g,'player1'));
    skipFirstTraining(g);
    g.t.profile.seeds=800;g.t.profile.cores=40;g.t.profile.unlockedStage=3;g.t.profile.clearedStages=[1,2];g.t.profile.tutorialSeen=true;
    assert(g.t.selectHero('blueberry'));g.t.profile.heroLevels.blueberry=3;g.t.profile.orchard.level=2;assert(g.t.saveProfile());
    assert(g.t.logoutAccount());assert.equal(g.t.state,'cover');assert.equal(g.element('loginPassword').value,'');
    assert(await login(g,'player2','different-pass-456'));assert.equal(g.t.profile.seeds,0);assert.equal(g.t.profile.cores,0);
    assert.equal(g.t.profile.unlockedStage,1);assert.equal(g.t.profile.selectedHero,'orange');assert.equal(g.t.profile.orchard.level,0);assert.equal(g.t.profile.tutorialSeen,false);
    assert.equal(g.t.profile.trainingSkipped,false);skipFirstTraining(g);
    g.t.profile.seeds=70;assert(g.t.logoutAccount());assert(await login(g,'PLAYER1'));
    assert.equal(g.t.profile.seeds,800);assert.equal(g.t.profile.cores,40);assert.equal(g.t.selectedStage,3);assert.equal(g.t.profile.selectedHero,'blueberry');
    assert.equal(g.t.profile.heroLevels.blueberry,3);assert.equal(g.t.profile.orchard.level,2);assert.equal(g.t.profile.tutorialSeen,true);
    assert.equal(JSON.parse(storage.get('orchard-save-v1:user:player2')).seeds,70);assert.equal(g.t.player.heroId,'blueberry');
    assert.equal(g.t.kills,0);assert.equal(g.t.elapsed,0);assert.equal(g.t.enemies.length,0);assert.equal(g.t.currentNotice,null);
  });
  await test('Refreshing requires login again, remembers only the account name, and rejects the wrong password',async()=>{
    const storage=new Map(),g=game(storage);assert(await login(g,'记住我'));skipFirstTraining(g);g.t.profile.seeds=55;g.t.saveProfile();
    const restored=game(storage);assert.equal(restored.t.state,'cover');assert.equal(restored.t.currentAccount,null);
    assert.equal(restored.element('loginAccount').value,'记住我');assert.equal(restored.element('loginPassword').value,'');
    assert(!(await login(restored,'记住我','wrong-password')));assert.equal(restored.t.state,'cover');assert.equal(restored.t.currentAccount,null);
    assert(restored.element('loginFeedback').classList.contains('error'));assert.equal(restored.element('loginSubmit').disabled,false);
    assert.equal(restored.element('loginPassword').value,'');assert(await login(restored,'记住我'));
    assert.equal(restored.t.profile.seeds,55);assert.equal(restored.t.state,'lobby');assert.equal(restored.t.profile.trainingSkipped,true);
    assert(![...storage.values()].some(value=>value.includes('orchard-pass-123')));
  });
  await test('Registering a fresh account leads to onboarding and active overlays cannot switch the save owner',async()=>{
    const g=game();assert(await login(g,'新守护者'));assert.equal(g.t.state,'playing');assert.equal(g.t.runMode,'training');assert.equal(g.t.training.firstEntry,true);
    const account=g.t.currentAccount,key=g.t.currentSaveKey;assert(!g.t.logoutAccount());assert(g.t.openGameHelp());assert(!g.t.logoutAccount());g.t.closeGameHelp();
    assert.equal(g.t.profile.tutorialSeen,false);skipFirstTraining(g);click(g,'start');assert.equal(g.t.runMode,'stage');assert.equal(g.t.profile.tutorialSeen,true);
    quietField(g.t);assert(!g.t.logoutAccount());g.t.pause();assert(!g.t.logoutAccount());g.t.showRelicMap();assert(!g.t.logoutAccount());
    g.t.closeRelicMap();g.t.resume();g.t.openGameHelp();assert(!g.t.logoutAccount());g.t.closeGameHelp();g.t.upgrade();assert(!g.t.logoutAccount());g.t.choose(0);
    assert.equal(g.t.currentAccount,account);assert.equal(g.t.currentSaveKey,key);g.t.startScreen();assert(g.t.logoutAccount());
    assert.equal(g.t.currentAccount,null);assert.equal(g.t.state,'cover');assert.equal(g.t.player.level,1);assert.equal(g.t.player.heroClock,0);
  });
  await test('Pending login disables submission and cannot create a second competing session',async()=>{
    const g=game();g.element('loginAccount').value='双双';g.element('loginPassword').value='orchard-pass-123';
    const pending=g.t.submitLogin();assert(g.t.loginBusy);assert(g.element('loginSubmit').disabled);assert(!(await g.t.submitLogin()));
    assert(await pending);assert(!g.t.loginBusy);assert.equal(g.t.currentAccount.id,'双双');assert.equal(g.element('loginSubmit').disabled,false);
    assert.equal(JSON.parse(g.storage.get('orchard-accounts-v1')).accounts.length,1);
  });
  await test('Empty and eight-character new names are rejected while one and seven-character names register without a second input',async()=>{
    const g=game();
    for(const name of ['', '一二三四五六七八']){
      assert(!(await login(g,name)));assert.equal(g.t.state,'cover');assert.equal(g.t.currentAccount,null);
      assert(g.element('loginFeedback').textContent.includes('1～7'));assert.equal(g.storage.has('orchard-accounts-v1'),false);
    }
    assert(await login(g,'果'));assert.equal(g.t.state,'playing');assert.equal(g.t.runMode,'training');assert.equal(g.t.currentAccount.nickname,'果');assert(g.t.profile.tutorialSeen===false);
    skipFirstTraining(g);
    assert(g.t.logoutAccount());assert(await login(g,'一二三四五六七'));assert.equal(g.t.currentAccount.nickname,'一二三四五六七');
  });
  await test('An original long account still logs in with its original password, profile key and safely displayed old nickname',async()=>{
    const storage=new Map(),seed=game(storage);assert(await login(seed,'种','legacy-pass-123'));
    const registry=JSON.parse(storage.get('orchard-accounts-v1')),hash=registry.accounts[0].passwordHash;
    registry.accounts[0]={...registry.accounts[0],id:'legacy_guardian',account:'legacy_guardian',nickname:'<果>'};
    storage.set('orchard-accounts-v1',JSON.stringify(registry));storage.set('orchard-last-account-v1','legacy_guardian');
    storage.set('orchard-save-v1:user:legacy_guardian',JSON.stringify({version:1,unlockedStage:4,clearedStages:[1,2,3],seeds:300,cores:20,tutorialSeen:true,selectedHero:'pear'}));
    const g=game(storage);assert.equal(g.element('loginAccount').value,'legacy_guardian');
    assert(!(await login(g,'legacy_guardian','wrong-password')));assert(await login(g,'LEGACY_GUARDIAN','legacy-pass-123'));
    assert.equal(g.t.currentSaveKey,'orchard-save-v1:user:legacy_guardian');assert.equal(g.t.profile.seeds,300);assert.equal(g.t.selectedStage,4);
    assert.equal(g.t.profile.selectedHero,'pear');assert.equal(g.element('playerName').textContent,'<果>');
    assert(g.element('overlay').innerHTML.includes('&lt;果&gt;'));assert(!g.element('overlay').innerHTML.includes('欢迎回来，<果>'));
    const saved=JSON.parse(storage.get('orchard-accounts-v1'));assert.equal(saved.accounts.length,1);assert.equal(saved.accounts[0].passwordHash,hash);
  });
  await test('Cover art, styles, labels and auth load order are present in the offline package',async()=>{
    const html=fs.readFileSync(__dirname+'/index.html','utf8');
    for(const file of ['auth-data.js','cover-ui.css','assets/cover/orchard-cover.png','assets/cover/orchard-cover.webp','assets/cover/cover-prompt.txt'])assert(fs.existsSync(__dirname+'/'+file));
    const gameScriptIndex = html.search(/<script\b[^>]*src="game\.js(?:\?[^"]*)?"/);
    assert(html.indexOf('src="auth-data.js"')<gameScriptIndex);
    for(const id of ['loginAccount','loginPassword'])assert(html.includes('for="'+id+'"'));
    assert(!html.includes('loginNickname'));assert(!fs.readFileSync(__dirname+'/game.js','utf8').includes('loginNickname'));
    const field=html.match(/<input\b[^>]*id="loginAccount"[^>]*>/)?.[0];assert(field);assert(field.includes('minlength="1"'));assert(field.includes('maxlength="24"'));
    assert(field.includes('aria-describedby="loginNameHint"'));assert(html.includes('1–7'));assert(html.includes('已有账号可输入原账号登录'));
    assert(html.includes('首次使用这个名字'));assert(html.includes('账号与进度保存在当前浏览器'));
  });
  console.log(count+' real login/game integration checks passed.');
})().catch(error=>{console.error(error);process.exitCode=1});
