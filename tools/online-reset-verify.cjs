/* Production reset boundaries in isolated VM/storage; never writes real player data. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const ROOT=path.resolve(__dirname,'..'),PRODUCTION='https://111.230.149.65';
const EPOCH_A='reset-'+'a'.repeat(32),EPOCH_B='reset-'+'b'.repeat(32);
const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
function storage(map=new Map()){
  const writes=[];return {map,writes,get length(){return map.size;},key(index){return [...map.keys()][index]??null;},
    getItem(key){return map.has(key)?map.get(key):null;},setItem(key,value){writes.push({key,value:String(value)});map.set(key,String(value));},removeItem(key){writes.push({key,remove:true});map.delete(key);}};
}
const oldPlayerData=()=>new Map([['orchard-accounts-v1','old registry'],['orchard-last-account-v1','old'],['orchard-save-v1','old legacy'],
  ['orchard-save-v1:user:甲','old user'],['orchard-save-v1:user:乙','old user'],['orchard-world-pending-v1:甲','old receipt'],
  ['another-app:player','keep me'],['orchard-art-preferences','keep me too']]);
function sandbox({origin=PRODUCTION,map=oldPlayerData(),sessionMap=oldPlayerData(),epoch='initial',health,world}={}){
  const local=storage(map),session=storage(sessionMap),listeners=new Map(),timers=new Map(),calls=[];
  let currentEpoch=epoch,reloads=0,healthCalls=0;
  const location={origin,protocol:origin==='null'?'file:':origin.split(':')[0]+':',reload(){reloads++;}};
  const addEventListener=(name,callback)=>{if(!listeners.has(name))listeners.set(name,[]);listeners.get(name).push(callback);};
  const dispatchEvent=event=>{for(const callback of listeners.get(event.type)||[])callback(event);};
  const window={localStorage:local,sessionStorage:session,location,addEventListener,dispatchEvent};
  const context={window,location,localStorage:local,sessionStorage:session,console,TextEncoder,AbortController,Event,
    addEventListener,dispatchEvent,setTimeout(callback,ms){const id={callback,ms};timers.set(id,callback);return id;},clearTimeout(id){timers.delete(id);},
    setInterval(){return 1;},clearInterval(){},document:{hidden:false,activeElement:null,getElementById(){return {classList:{add(){},remove(){}}};}}};
  context.fetch=async(url,options={})=>{
    calls.push({url,options});
    if(String(url).endsWith('/api/world/health')){healthCalls++;if(health)return health(url,options);return {ok:true,status:200,json:async()=>({ok:true,dataEpoch:currentEpoch})};}
    if(world)return world(url,options);
    const state={self:{id:'alpha-id',name:'alpha'},serverTime:1,rules:{},players:[],guilds:[],reports:[]};
    const leaderboard={entries:[],self:null,page:1,pageSize:20,totalPlayers:0,totalPages:1};
    return {ok:true,status:200,json:async()=>({ok:true,state,ticket:'t'.repeat(40),claimAfter:0,rewards:{wood:48},leaderboard})};
  };
  vm.createContext(context);
  const load=file=>vm.runInContext(fs.readFileSync(path.join(ROOT,file),'utf8'),context,{filename:file});
  load('online-reset.js');
  return {context,window,local,session,listeners,timers,calls,load,dispatchEvent,
    setEpoch(value){currentEpoch=value;},get reloads(){return reloads;},get healthCalls(){return healthCalls;},guard:window.ORCHARD_ONLINE_RESET};
}
function cryptoFixture({hold=false}={}){
  const waits=[],calls={derive:0};return {waits,calls,provider:{getRandomValues(value){value.fill(17);return value;},subtle:{
    async importKey(){return {};},deriveBits(){calls.derive++;if(!hold)return Promise.resolve(new Uint8Array(32).fill(1).buffer);const wait=deferred();waits.push(wait);return wait.promise;}}}};
}
function authService(sandbox,crypto=cryptoFixture()){
  sandbox.load('auth-data.js');return {auth:sandbox.window.ORCHARD_AUTH.create({storage:sandbox.local,crypto:crypto.provider}),crypto};
}
function rewardService(sandbox,client){
  sandbox.load('frontier-rewards.js');return sandbox.window.ORCHARD_FRONTIER_REWARDS.create({getClient:()=>client,getName:()=> 'alpha',getOwner:()=> 'alpha',storage:sandbox.local,
    schedule:sandbox.context.setTimeout,cancel:sandbox.context.clearTimeout,clock:()=>1000});
}
const playerKey=key=>/^orchard-(accounts|last-account|save|world-pending)/.test(key)||key.includes(':orchard-save-v1')||key.includes(':orchard-world-pending-v1');
let count=0;const failures=[];
async function test(name,callback){try{await callback();count++;console.log('PASS '+name);}catch(error){failures.push(name);console.error('FAIL '+name+'\n'+error.stack);}}
(async()=>{
  await test('Reset: only the exact production HTTPS origin can inspect or erase player data',async()=>{
    for(const origin of ['null','http://localhost:8765','http://127.0.0.1:8765','https://localhost','http://111.230.149.65','https://111.230.149.65:8443','https://example.com']){
      const s=sandbox({origin,epoch:EPOCH_A});const before=JSON.stringify([...s.local.map]);await s.guard.ensure({force:true});
      assert.equal(s.guard.isOnline,false);assert.equal(s.calls.length,0);assert.equal(JSON.stringify([...s.local.map]),before);assert.equal(s.reloads,0);
      assert.equal(Object.keys(await s.guard.requestHeaders()).length,0);
    }
  });
  await test('Reset: initial server baseline preserves established accounts and legacy profiles',async()=>{
    const s=sandbox();const before=[...s.local.map];await s.guard.ensure();
    for(const [key,value]of before)assert.equal(s.local.getItem(key),value);
    assert.equal(s.local.getItem(s.guard.epochKey),'initial');assert.equal(s.reloads,0);
  });
  await test('Reset: first reset visit without a marker clears all known local and session player keys',async()=>{
    const s=sandbox({epoch:EPOCH_A});await s.guard.ensure();
    for(const area of [s.local,s.session])for(const [key]of oldPlayerData())assert.equal(area.getItem(key),key.startsWith('another-app:')?'keep me':key==='orchard-art-preferences'?'keep me too':null,key);
    assert.equal(s.local.getItem(s.guard.epochKey),EPOCH_A);assert.equal(s.reloads,0);
  });
  await test('Reset: repeated visits to the same epoch preserve a newly registered player',async()=>{
    const shared=new Map(),first=sandbox({map:shared,epoch:EPOCH_A}),{auth}=authService(first);await first.guard.ensure();
    await auth.login({account:'alpha',password:'secret1'});const profileKey=auth.profileKey('alpha');first.local.setItem(profileKey,'{"seeds":7}');
    const accountBytes=[...shared].filter(([key])=>playerKey(key));
    const second=sandbox({map:shared,epoch:EPOCH_A});await second.guard.ensure({force:true});
    for(const [key,value]of accountBytes)assert.equal(shared.get(key),value);assert.equal(shared.get(profileKey),'{"seeds":7}');assert.equal(second.reloads,0);
  });
  await test('Reset: invalid or failed epoch responses cannot remove saves or advance the marker',async()=>{
    for(const response of [{ok:true,json:async()=>({ok:true,dataEpoch:'reset-invalid'})},{ok:false,json:async()=>({ok:true,dataEpoch:EPOCH_A})},{ok:true,json:async()=>({ok:false,dataEpoch:EPOCH_A})}]){
      const s=sandbox({health:async()=>response}),before=JSON.stringify([...s.local.map]);await assert.rejects(s.guard.ensure());
      assert.equal(JSON.stringify([...s.local.map]),before);assert.equal(s.reloads,0);
    }
  });
  await test('Reset: health checks use bounded same-origin requests without redirect or cache reuse',async()=>{
    const s=sandbox({map:new Map()});await s.guard.ensure();const request=s.calls[0];
    assert.equal(request.url,PRODUCTION+'/api/world/health');assert.equal(request.options.redirect,'error');assert.equal(request.options.cache,'no-store');
    assert.equal(request.options.credentials,'same-origin');assert(request.options.signal instanceof AbortSignal);assert.equal(s.timers.size,0);
  });
  await test('Reset: cross-tab epoch changes reload the old tab without clearing a new tab player twice',async()=>{
    const shared=new Map(),oldTab=sandbox({map:shared}),other=sandbox({map:shared});await Promise.all([oldTab.guard.ensure(),other.guard.ensure()]);
    oldTab.setEpoch(EPOCH_A);other.setEpoch(EPOCH_A);await assert.rejects(oldTab.guard.ensure({force:true}));assert.equal(oldTab.reloads,1);
    const fresh=sandbox({map:shared,epoch:EPOCH_A}),{auth}=authService(fresh);await fresh.guard.ensure();await auth.login({account:'alpha',password:'secret1'});
    const profileKey=auth.profileKey('alpha');fresh.local.setItem(profileKey,'{"hp":20}');
    other.dispatchEvent({type:'storage',key:other.guard.epochKey,newValue:EPOCH_A});await flush();
    assert.equal(other.reloads,1);assert.equal(shared.get(profileKey),'{"hp":20}');await assert.rejects(other.guard.requestHeaders());
  });
  await test('Reset: local legacy and previous-epoch writes cannot become a fresh online profile',async()=>{
    const s=sandbox({map:new Map()}),{auth}=authService(s);await s.guard.ensure();const oldKey=auth.profileKey('alpha');s.local.setItem(oldKey,'{"seeds":999}');
    s.setEpoch(EPOCH_A);await assert.rejects(s.guard.ensure({force:true}));s.local.setItem(oldKey,'{"seeds":999}');s.local.setItem('orchard-save-v1','{"seeds":999}');
    const fresh=sandbox({map:s.local.map,epoch:EPOCH_A}),next=authService(fresh).auth;await fresh.guard.ensure();const newKey=next.profileKey('alpha');
    assert.notEqual(newKey,oldKey,'Online player profiles must follow the active epoch');assert.equal(fresh.local.getItem(newKey),null);
    const registered=await next.login({account:'alpha',password:'secret1'});assert.equal(registered.created,true);assert.equal(registered.legacyClaimed,false);
    assert.equal(fresh.local.getItem(newKey),null,'Old legacy data must not migrate into the reset namespace');
  });
  await test('Auth reset: login waits for the epoch guard before hashing or registration',async()=>{
    const health=deferred(),s=sandbox({map:new Map(),health:()=>health.promise}),{auth,crypto}=authService(s);const login=auth.login({account:'alpha',password:'secret1'});
    await flush();assert.equal(crypto.calls.derive,0);assert(![...s.local.map.keys()].some(playerKey));
    health.resolve({ok:true,status:200,json:async()=>({ok:true,dataEpoch:'initial'})});await login;assert.equal(crypto.calls.derive,1);
  });
  await test('Auth reset: a pending new registration cannot write after a live reset',async()=>{
    const s=sandbox({map:new Map()}),crypto=cryptoFixture({hold:true}),{auth}=authService(s,crypto);await s.guard.ensure();
    const result=auth.login({account:'alpha',password:'secret1'}).then(value=>({value}),error=>({error}));await flush();assert.equal(crypto.waits.length,1);
    s.setEpoch(EPOCH_A);await assert.rejects(s.guard.ensure({force:true}));crypto.waits[0].resolve(new Uint8Array(32).fill(1).buffer);
    const settled=await result;assert(settled.error,'Pre-reset registration must fail');assert(![...s.local.map.keys()].some(playerKey));
  });
  await test('Auth reset: an existing password check cannot restore a last-account hint after reset',async()=>{
    const s=sandbox({map:new Map()}),first=authService(s).auth;await s.guard.ensure();await first.login({account:'alpha',password:'secret1'});
    const crypto=cryptoFixture({hold:true}),auth=authService(s,crypto).auth;
    const result=auth.login({account:'alpha',password:'secret1'}).then(value=>({value}),error=>({error}));await flush();assert.equal(crypto.waits.length,1);
    s.setEpoch(EPOCH_A);await assert.rejects(s.guard.ensure({force:true}));const writes=s.local.writes.length;
    crypto.waits[0].resolve(new Uint8Array(32).fill(1).buffer);const settled=await result;assert(settled.error);
    assert(!s.local.writes.slice(writes).some(entry=>playerKey(entry.key)),'A late existing login must not recreate any account or profile key');
  });
  await test('Auth reset: cross-tab marker changes stop a pending hash before its storage event arrives',async()=>{
    const shared=new Map(),old=sandbox({map:shared}),crypto=cryptoFixture({hold:true}),auth=authService(old,crypto).auth;await old.guard.ensure();
    const result=auth.login({account:'alpha',password:'secret1'}).then(value=>({value}),error=>({error}));await flush();
    const fresh=sandbox({map:shared,epoch:EPOCH_A}),next=authService(fresh).auth;await fresh.guard.ensure();await next.login({account:'bravo',password:'secret1'});
    const before=JSON.stringify([...shared]);crypto.waits[0].resolve(new Uint8Array(32).fill(1).buffer);const settled=await result;
    assert(settled.error);assert.equal(JSON.stringify([...shared]),before,'Old-tab hashing must not overwrite a fresh epoch registry');
  });
  await test('Auth reset: file and localhost registration keeps the original local storage keys',async()=>{
    for(const origin of ['null','http://localhost:8765']){
      const s=sandbox({origin,map:new Map(),epoch:EPOCH_A}),{auth}=authService(s);await auth.login({account:'alpha',password:'secret1'});
      assert.equal(auth.profileKey('alpha'),'orchard-save-v1:user:alpha');assert(s.local.getItem('orchard-accounts-v1'));assert.equal(s.calls.length,0);
    }
  });
  await test('World reset: every core request carries the verified data epoch header',async()=>{
    const s=sandbox({map:new Map()});await s.guard.ensure();s.load('frontier-ui.js');const client=s.window.ORCHARD_FRONTIER;
    await client.enterGame('alpha','secret1');const receipt=await client.beginCampaign(1,'alpha');await client.completeCampaign(receipt.ticket,'alpha');
    await client.claimCampaign(receipt.ticket,'alpha');await client.getLeaderboard(1,'alpha');
    const requests=s.calls.filter(call=>!call.url.endsWith('/health'));assert(requests.length>=6);
    for(const request of requests)assert.equal(request.options.headers['X-Orchard-Data-Epoch'],'initial',request.url);
    assert(requests.some(call=>call.url.endsWith('/campaign/complete')));assert(requests.some(call=>call.url.includes('/leaderboard?')));
  });
  await test('World reset: newly registered reset-epoch players use that epoch on every API request',async()=>{
    const s=sandbox({map:new Map(),epoch:EPOCH_A});await s.guard.ensure();s.load('frontier-ui.js');const client=s.window.ORCHARD_FRONTIER;
    await client.enterGame('alpha','secret1');const receipt=await client.beginCampaign(1,'alpha');await client.completeCampaign(receipt.ticket,'alpha');
    await client.claimCampaign(receipt.ticket,'alpha');await client.getLeaderboard(1,'alpha');
    for(const request of s.calls.filter(call=>!call.url.endsWith('/health')))assert.equal(request.options.headers['X-Orchard-Data-Epoch'],EPOCH_A,request.url);
  });
  await test('World reset: a data_reset response forces epoch verification and hard reload',async()=>{
    let s; s=sandbox({map:new Map(),world:async()=>{s.setEpoch(EPOCH_A);return {ok:false,status:409,json:async()=>({ok:false,code:'data_reset',error:'reset'})};}});
    await s.guard.ensure();s.load('frontier-ui.js');await assert.rejects(s.window.ORCHARD_FRONTIER.prepareSession('alpha'));
    assert.equal(s.reloads,1);assert(s.healthCalls>=2);await assert.rejects(s.guard.requestHeaders());
  });
  await test('World reset: a late old login response cannot authenticate after the reset event',async()=>{
    const response=deferred(),s=sandbox({map:new Map(),world:()=>response.promise});await s.guard.ensure();s.load('frontier-ui.js');
    const client=s.window.ORCHARD_FRONTIER,result=client.enterGame('alpha','secret1').then(value=>({value}),error=>({error}));await flush();
    s.setEpoch(EPOCH_A);await assert.rejects(s.guard.ensure({force:true}));response.resolve({ok:true,status:200,json:async()=>({ok:true,state:{self:{id:'old',name:'alpha'},serverTime:1}})});
    const settled=await result;assert(!settled.value);assert.equal(client.isAuthenticated('alpha'),false);
  });
  await test('World reset: a successful response body from an old cross-tab epoch cannot be adopted',async()=>{
    const body=deferred(),shared=new Map(),s=sandbox({map:shared,world:async()=>({ok:true,status:200,json:()=>body.promise})});
    await s.guard.ensure();s.load('frontier-ui.js');const client=s.window.ORCHARD_FRONTIER;
    const result=client.enterGame('alpha','secret1').then(value=>({value}),error=>({error}));await flush();
    const fresh=sandbox({map:shared,epoch:EPOCH_A});await fresh.guard.ensure();
    body.resolve({ok:true,state:{self:{id:'old',name:'alpha'},serverTime:1}});const settled=await result;
    assert(!settled.value);assert.equal(client.isAuthenticated('alpha'),false,'Marker verification must precede state adoption, even without a delivered storage event');
  });
  await test('Rewards reset: an old ticket arriving after reset cannot recreate a pending key',async()=>{
    const s=sandbox({map:new Map()}),issued=deferred();await s.guard.ensure();const bridge=rewardService(s,{isAuthenticated:()=>true,beginCampaign:()=>issued.promise,claimCampaign:async()=>({rewards:{}})});
    const begin=bridge.begin(1),win=bridge.victory();await flush();s.setEpoch(EPOCH_A);await assert.rejects(s.guard.ensure({force:true}));
    issued.resolve({ticket:'old-ticket'});await begin;await win;assert(![...s.local.map.keys()].some(key=>key.includes('world-pending')));
  });
  await test('Rewards reset: late completion and claim responses cannot restore receipts or continue old settlement',async()=>{
    for(const held of ['complete','claim']){
      const s=sandbox({map:new Map()}),response=deferred();await s.guard.ensure();let claims=0;
      const client={isAuthenticated:()=>true,beginCampaign:async()=>({ticket:'old-ticket'}),completeCampaign:()=>held==='complete'?response.promise:Promise.resolve({}),claimCampaign:()=>{claims++;return held==='claim'?response.promise:Promise.resolve({rewards:{}});}};
      const bridge=rewardService(s,client);await bridge.begin(1);const win=bridge.victory();await flush();
      s.setEpoch(EPOCH_A);await assert.rejects(s.guard.ensure({force:true}));const writes=s.local.writes.length;response.resolve({rewards:{wood:48}});await win;
      assert.equal(claims,held==='complete'?0:1);assert(!s.local.writes.slice(writes).some(entry=>entry.key.includes('world-pending')));
      assert(![...s.local.map.keys()].some(key=>key.includes('world-pending')));
    }
  });
  await test('Rewards reset: clearing storage and memory removes old pending retry records',async()=>{
    const s=sandbox({map:new Map()});await s.guard.ensure();let claims=0,broken=true;
    const bridge=rewardService(s,{isAuthenticated:()=>true,beginCampaign:async()=>({ticket:'old-ticket'}),claimCampaign:async()=>{claims++;if(broken)throw new Error('offline');return {rewards:{}};}});
    await bridge.begin(1);await bridge.victory();assert.equal(claims,1);s.setEpoch(EPOCH_A);await assert.rejects(s.guard.ensure({force:true}));
    broken=false;await bridge.retry();assert.equal(claims,1,'Cached old receipts must not survive reset()');
  });
  if(failures.length){console.error(failures.length+' failed reset checks: '+failures.join('; '));process.exitCode=1;}
  else console.log(count+' online reset boundary checks passed.');
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
