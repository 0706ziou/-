/* Game navigation integration: ranking never becomes a local or world reward write. */
'use strict';
const assert = require('node:assert/strict');
const { createGame, click } = require('./verify.cjs');
let count = 0;
const flush = async () => { for(let i=0;i<12;i++) await Promise.resolve(); };
function fixture(options={}) {
  const calls={open:[],close:0,worldOpen:0,worldClaim:0,worldBegin:0};
  const leaderboardClient={
    open(input) {
      calls.open.push(input);
      input.overlay.innerHTML='<div class="ranking-test"><button id="rankingBack">返回关卡</button></div>';
    },
    close() {calls.close++;}
  };
  const frontierClient={close(){},open(){calls.worldOpen++;},isAuthenticated:()=>true,
    async beginCampaign(){calls.worldBegin++;return {ticket:'fixture-campaign-ticket'};},
    async claimCampaign(){calls.worldClaim++;return {rewards:{}};}};
  return {...createGame(new Map(),{...options,leaderboardClient,frontierClient}),calls};
}
async function check(name,fn){await fn();count++;console.log('PASS '+name);}
(async()=>{
  await check('Leaderboard entry: signed-out players cannot open a game ranking panel',async()=>{
    const game=fixture({auth:true});assert.equal(game.t.state,'cover');
    assert.equal(game.t.showLeaderboard(),false);assert.equal(game.calls.open.length,0);
  });
  await check('Leaderboard entry: the lobby button opens a separate screen without combat or world writes',async()=>{
    const game=fixture();const {t,calls,element}=game;await flush();
    const profile=JSON.stringify(t.profile),elapsed=t.elapsed,field=JSON.stringify(t.enemies),worldCalls=[calls.worldBegin,calls.worldClaim,calls.worldOpen];
    assert.equal(t.state,'lobby');assert.equal(t.profile.clearedStages.length,0,'The ranking can be read before the first clear');
    assert(element('overlay').innerHTML.includes('id="navLeaderboard"'));
    click(game,'navLeaderboard');assert.equal(t.state,'leaderboard');assert.equal(calls.open.length,1);
    assert.equal(calls.open[0].overlay,element('overlay'));assert.equal(calls.open[0].name,t.currentAccount.nickname);
    assert.equal(t.isRunActive(),false);assert.equal(t.startEndless(),false);
    t.frame(1000);t.frame(2000);await flush();
    assert.equal(t.elapsed,elapsed);assert.equal(JSON.stringify(t.enemies),field);assert.equal(JSON.stringify(t.profile),profile);
    assert.deepEqual([calls.worldBegin,calls.worldClaim,calls.worldOpen],worldCalls);
  });
  await check('Leaderboard entry: battle, pause and upgrade cannot be replaced by a ranking screen',async()=>{
    const game=fixture();const {t,calls}=game;t.start();
    const opened=calls.open.length;assert.equal(t.showLeaderboard(),false);assert.equal(t.state,'playing');
    t.pause();assert.equal(t.showLeaderboard(),false);assert.equal(t.state,'paused');
    t.resume();t.upgrade();const choices=JSON.stringify(t.choices);assert.equal(t.showLeaderboard(),false);assert.equal(t.state,'upgrade');
    assert.equal(JSON.stringify(t.choices),choices);assert.equal(calls.open.length,opened);
  });
  await check('Leaderboard entry: help returns to ranking and Escape returns to the lobby',async()=>{
    const game=fixture();const {t,calls,listeners}=game;assert(t.showLeaderboard());
    const profile=JSON.stringify(t.profile);assert(t.openGameHelp());assert.equal(t.state,'help');assert.equal(t.helpReturnState,'leaderboard');
    assert(t.closeGameHelp());assert.equal(t.state,'leaderboard');assert.equal(calls.open.length,2);
    listeners.keydown({key:'Escape',preventDefault(){}});assert.equal(t.state,'lobby');
    assert.equal(JSON.stringify(t.profile),profile);assert.equal(calls.worldOpen,0);assert.equal(calls.worldBegin,0);
  });
  await check('Leaderboard entry: exit callbacks and menu transitions release the ranking component',async()=>{
    const game=fixture();const {t,calls}=game;assert(t.showLeaderboard());let closed=calls.close;
    assert.equal(typeof calls.open.at(-1).onExit,'function');calls.open.at(-1).onExit();assert.equal(t.state,'lobby');assert(calls.close>closed);
    assert(t.showLeaderboard());closed=calls.close;t.showHeroes();assert.equal(t.state,'heroes');assert(calls.close>closed);
    t.profile.clearedStages=[1];t.profile.unlockedStage=2;t.startScreen();assert(t.showLeaderboard());closed=calls.close;
    assert(t.showWorld());assert.equal(t.state,'world');assert.equal(calls.worldOpen,1);assert(calls.close>closed,'World transition must release pending ranking work');
  });
  console.log(count+' leaderboard game integration checks passed.');
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
