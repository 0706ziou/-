'use strict';
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const context = { window: {} };
vm.runInNewContext(fs.readFileSync(__dirname + '/frontier-rewards.js', 'utf8'), context);
const { create } = context.window.ORCHARD_FRONTIER_REWARDS;
const { createGame } = require('./verify.cjs');
const tick = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
let count = 0;
async function check(name, fn) { await fn(); count++; console.log('PASS ' + name); }
function fixture({ authenticated = true, gameLogin = false, store = new Map(), begin, claim } = {}) {
  let owner = 'alpha', name = '甲甲';
  const calls = { begin: [], claim: [] };
  const client = {
    isAuthenticated: value => authenticated && value === name,
    hasGameLogin: value => gameLogin && value === name,
    beginCampaign: async (stage, player) => { calls.begin.push({ stage, player }); return begin ? begin(stage, player) : { ticket: 'ticket-' + stage }; },
    claimCampaign: async (ticket, player) => { calls.claim.push({ ticket, player }); return claim ? claim(ticket, player) : { rewards: { wood: 48, stone: 37, grain: 64, iron: 9, token: 1 } }; }
  };
  const storage = { getItem: key => store.get(key) || null, setItem: (key, value) => store.set(key, value) };
  const options = { getClient: () => client, getName: () => name, getOwner: () => owner, storage };
  return { bridge: create(options), options, calls, store, switchAccount(next, display) { owner = next; name = display; } };
}
(async () => {
  await check('Unlinked runs never call world APIs or create local world currency', async () => {
    const f = fixture({ authenticated: false }); await f.bridge.begin(1); await f.bridge.victory();
    assert.equal(f.calls.begin.length, 0); assert.equal(f.calls.claim.length, 0); assert.equal(f.store.size, 0);
  });
  await check('Victory before ticket response redeems the exact ticket once', async () => {
    let release; const f = fixture({ begin: () => new Promise(resolve => { release = resolve; }) });
    f.bridge.begin(3); const win = f.bridge.victory(); await f.bridge.victory(); await tick();
    release({ ticket: 'delayed-ticket' }); await win;
    assert.deepEqual(f.calls.claim, [{ ticket: 'delayed-ticket', player: '甲甲' }]);
    assert(f.bridge.status().text.includes('木材 +48')); assert.equal(f.bridge.status().canRetry, false);
  });
  await check('Immediate campaign entry waits for automatic world login instead of dropping the whole reward', async () => {
    let release;
    const f = fixture({ authenticated: false, gameLogin: true, begin: () => new Promise(resolve => { release = resolve; }) });
    const start = f.bridge.begin(1), victory = f.bridge.victory();await tick();
    assert.equal(f.calls.begin.length,1);assert.equal(f.calls.claim.length,0);
    release({ticket:'automatic-login-ticket'});await start;await victory;
    assert.equal(f.calls.claim.length,1);assert.equal(f.calls.claim[0].ticket,'automatic-login-ticket');
    assert(f.bridge.status().text.includes('世界物资已入库'));assert.equal(f.store.get('orchard-world-pending-v1:alpha'),'[]');
  });
  await check('Network failure survives reload and retries without touching campaign saves', async () => {
    const store = new Map([['orchard-save-v1', '{"seeds":123,"cores":9}']]);
    let broken = true;
    const f = fixture({ store, claim: () => { if (broken) throw new Error('离线'); return { rewards: { wood: 48 } }; } });
    await f.bridge.begin(1); await f.bridge.victory(); assert(f.bridge.status().canRetry);
    assert(JSON.parse(store.get('orchard-world-pending-v1:alpha')).length === 1);
    broken = false; const reloaded = create(f.options); assert(await reloaded.retry());
    assert.equal(JSON.parse(store.get('orchard-world-pending-v1:alpha')).length, 0);
    assert.equal(store.get('orchard-save-v1'), '{"seeds":123,"cores":9}');
  });
  await check('Late victory response cannot redeem using another local identity', async () => {
    let release; const f = fixture({ begin: () => new Promise(resolve => { release = resolve; }) });
    f.bridge.begin(1); const win = f.bridge.victory(); await tick(); f.switchAccount('beta', '乙乙');
    release({ ticket: 'belongs-to-alpha' }); await win;
    assert.equal(f.calls.claim.length, 0); assert.equal(f.store.has('orchard-world-pending-v1:beta'), false);
    f.switchAccount('alpha', '甲甲'); assert(await f.bridge.retry()); assert.equal(f.calls.claim.length, 1);
  });
  await check('Expired receipts do not block valid pending rewards', async () => {
    const store = new Map([['orchard-world-pending-v1:alpha', JSON.stringify([{ name: '甲甲', ticket: 'expired' }, { name: '甲甲', ticket: 'valid' }])]]);
    const f = fixture({ store, claim: ticket => { if (ticket === 'expired') throw Object.assign(new Error('已过期'), { code: 'ticket_expired' }); return { rewards: { iron: 9 } }; } });
    assert(await f.bridge.retry()); assert.equal(f.calls.claim.length, 2); assert.equal(JSON.parse(store.get('orchard-world-pending-v1:alpha')).length, 0);
  });
  await check('Temporary early claims remain pending for a later retry', async () => {
    const f = fixture({ claim: () => { throw Object.assign(new Error('时间不足'), { code: 'claim_too_early' }); } });
    await f.bridge.begin(1); await f.bridge.victory(); assert(f.bridge.status().canRetry);
    assert.equal(JSON.parse(f.store.get('orchard-world-pending-v1:alpha')).length, 1);
  });
  await check('Shipped campaign starts and wins connect to world receipts exactly once', async () => {
    const calls = { begin: 0, claim: 0 };
    const client = { close() {}, isAuthenticated: () => true, beginCampaign: async () => { calls.begin++; return { ticket: 'game-run' }; }, claimCampaign: async () => { calls.claim++; return { rewards: { wood: 48 } }; } };
    const { t, element } = createGame(new Map(), { frontierClient: client }); t.start(); t.finish(true); t.finish(true); await tick();
    assert.equal(calls.begin, 1); assert.equal(calls.claim, 1); assert(element('worldRewardStatus').textContent.includes('世界物资已入库'));
    assert(t.startEndless()); t.finish(false); await tick(); assert.equal(calls.claim, 1);
  });
  await check('Training issues no world reward ticket, and world menus do not start combat', async () => {
    let starts = 0, opens = 0, closes = 0;
    const client = { close() { closes++; }, open() { opens++; }, isAuthenticated: () => true, beginCampaign: async () => { starts++; return { ticket: 'bad' }; } };
    const { t, element } = createGame(new Map(), { frontierClient: client }); t.startScreen();
    assert(t.showWorld()); assert.equal(t.state, 'world'); assert.equal(t.isRunActive(), false); assert.equal(opens, 1);
    assert(t.openGameHelp()); assert(t.closeGameHelp()); assert.equal(t.state, 'world'); assert.equal(opens, 2); assert(closes > 0);
    t.startScreen(); element('startTraining').onclick(); t.startTraining(); t.finish(false); await tick(); assert.equal(starts, 0);
  });
  console.log(count + ' world reward/integration checks passed.');
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
