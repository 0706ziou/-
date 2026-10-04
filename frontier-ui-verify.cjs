/* Unified-account world client: credentials in memory, manual production and saved squads. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const clone = value => JSON.parse(JSON.stringify(value));
const flush = async () => { for (let i = 0; i < 12; i++) await new Promise(resolve => setImmediate(resolve)); };
function classList() { const names = new Set(); return { add(...values) { values.forEach(value => names.add(value)); }, remove(...values) { values.forEach(value => names.delete(value)); }, toggle(value, condition) { condition ? names.add(value) : names.delete(value); }, contains(value) { return names.has(value); } }; }
function makeHost() {
  const events = {}, fields = {}, body = { scrollTop: 0, scrollTo() {}, insertAdjacentHTML() {} };
  return { innerHTML: '', classList: classList(), events, fields, attributes: {},
    setAttribute(key, value) { this.attributes[key] = value; }, addEventListener(name, callback) { events[name] = callback; }, removeEventListener(name) { delete events[name]; },
    querySelector(selector) { return selector === '.world-body' ? body : fields[selector] || null; }, querySelectorAll() { return []; }, contains() { return true; },
    click(action, data = {}) { const button = { dataset: { worldAction: action, ...data }, disabled: false }; events.click({ target: { closest() { return button; } } }); },
    change(id, value) { events.change({ target: { id, value } }); },
    submit(id, values) { events.submit({ preventDefault() {}, target: { id, querySelector(selector) { return { value: values[selector] }; } } }); }
  };
}
async function verify() {
  const calls = [], intervals = new Set(), replay = new Map(), users = new Map();
  let clock = Date.now(), cookieName = null, failActionOnce = false, unavailable = false, heldEnter = null;
  const player = name => ({ id: `${name}-id`, name, resources: { wood: 500, stone: 500, grain: 500, iron: 500, token: 25 }, home: null, troops: { infantry: 0, archer: 0, cavalry: 0 }, squads: [], queues: [], guildId: null, unlockedStage: 1, attackReadyAt: 0, capacity: 1000 });
  const alice = player('字欧'), bob = player('李总');
  users.set(alice.name, { player: alice, password: 'alice-game-password' }); users.set(bob.name, { player: bob, password: 'bob-game-password' });
  const state = { self: null, map: { width: 16, height: 16, cells: [] }, players: [], guilds: [], reports: [], rules: { costs: { settle: { wood: 120, stone: 80 }, buildings: { keep: [null, {}, { wood: 400 }], farm: [null, { wood: 65 }, { wood: 260 }], lumbermill: [null, { wood: 55 }], quarry: [null, { wood: 75 }], ironworks: [null, { wood: 85 }], warehouse: [null, {}], wall: [null, {}], barracks: [null, {}] }, guildCreate: { wood: 100, token: 10 } }, production: { farm: { resource: 'grain', ratePerMinute: 8 }, lumbermill: { resource: 'wood', ratePerMinute: 6 }, quarry: { resource: 'stone', ratePerMinute: 5 }, ironworks: { resource: 'iron', ratePerMinute: 3 } }, training: { infantry: { seconds: 5, power: 3, cost: { grain: 8 } } }, buildMaxLevel: 5, maxQueues: 3, maxTrainCount: 100, maxSquads: 3 }, serverTime: clock };
  function snapshot() { state.self = users.get(cookieName)?.player || null; state.serverTime = ++clock; return clone(state); }
  const sandbox = { window: {}, location: { protocol: 'http:' }, AbortController, console, Date, Math, Number, String, Object, Array, Map, Set, Promise,
    setTimeout, clearTimeout, setInterval(callback) { const id = { callback }; intervals.add(id); return id; }, clearInterval(id) { intervals.delete(id); },
    localStorage: { getItem() { throw new Error('No reading local passwords or saves'); }, setItem() { throw new Error('No persisted credentials'); } },
    sessionStorage: { setItem() { throw new Error('No persisted credentials'); } },
    document: { hidden: false, activeElement: { matches() { return false; } }, getElementById() { return { classList: classList() }; } },
    async fetch(url, options) {
      const payload = options.body ? JSON.parse(options.body) : undefined;
      calls.push({ url, options: { ...options, signal: undefined }, payload });
      if (unavailable) return { ok: false, status: 404, async json() { throw new Error('HTML response'); } };
      const fail = (code, error, status = 409) => ({ ok: false, status, async json() { return { ok: false, code, error }; } });
      let result = { ok: true };
      if (url.endsWith('/enter')) {
        if (heldEnter) { const wait = heldEnter; heldEnter = null; await wait; }
        let user = users.get(payload.name);
        if (user && user.password !== payload.password && cookieName !== payload.name) return fail('world_link_required', '请输入原世界密码连接旧家园。');
        if (!user) { user = { player: player(payload.name), password: payload.password }; users.set(payload.name, user); }
        user.password = payload.password; cookieName = payload.name;
      }
      if (url.endsWith('/link')) {
        const user = users.get(payload.name);
        if (!user || user.password !== payload.worldPassword) return fail('invalid_password', '原世界密码不正确。', 401);
        user.password = payload.password; cookieName = payload.name;
      }
      if (url.endsWith('/logout')) cookieName = null;
      if (url.endsWith('/campaign/start')) result = { ok: true, ticket: 'ticket-123456789', claimAfter: clock + 60000 };
      if (url.endsWith('/campaign/claim')) result = { ok: true, rewards: { wood: 48, token: 1 } };
      if (url.endsWith('/action')) {
        assert.equal(payload.accountName, cookieName, 'Actions bind the intended game account');
        const me = users.get(cookieName).player;
        if (!replay.has(payload.requestId)) {
          if (payload.type === 'settle') { me.resources.wood -= 120; me.resources.stone -= 80; me.home = { x: payload.x, y: payload.y, level: 1, protectedUntil: clock + 300000, buildings: { keep: 1, farm: 0, warehouse: 0, wall: 0, barracks: 0, lumbermill: 0, quarry: 0, ironworks: 0 }, production: {} }; }
          if (payload.type === 'harvest' || payload.type === 'harvest-all') {
            result.harvested = { wood: 0, stone: 0, grain: 0, iron: 0, token: 0 };
            for (const [key, item] of Object.entries(me.home.production)) if (payload.type === 'harvest-all' || key === payload.building) { me.resources[item.resource] += item.stored; result.harvested[item.resource] += item.stored; item.stored = 0; }
          }
          if (payload.type === 'squad-save') { const id = payload.squadId || `squad-${me.squads.length + 1}`, prior = me.squads.find(squad => squad.id === id); if (prior) Object.assign(prior, { name: payload.name, units: payload.units }); else me.squads.push({ id, name: payload.name, units: payload.units }); result.squadId = id; }
          if (payload.type === 'squad-delete') me.squads = me.squads.filter(squad => squad.id !== payload.squadId);
          replay.set(payload.requestId, true);
        }
        if (failActionOnce) { failActionOnce = false; throw new Error('Lost response after commit'); }
      }
      return { ok: true, status: 200, async json() { return { ...result, state: snapshot() }; } };
    }
  };
  vm.createContext(sandbox); vm.runInContext(fs.readFileSync(require.resolve('./frontier-ui.js'), 'utf8'), sandbox);
  const client = sandbox.window.ORCHARD_FRONTIER, host = makeHost();
  assert.equal(await client.prepareSession('字欧'), false); assert.equal(calls.length, 1);
  assert.equal(client.hasGameLogin('字欧'), false);
  await client.enterGame('字欧', 'alice-game-password'); assert.equal(client.hasGameLogin('字欧'), true); assert.equal(client.hasGameLogin('李总'), false); assert.equal(client.isAuthenticated('字欧'), true);
  client.open({ overlay: host, name: '字欧', initialTab: 'home' }); await flush();
  assert.match(host.innerHTML, /我的主城/); assert.match(host.innerHTML, /回到主城/); assert.doesNotMatch(host.innerHTML, /worldAuthForm|worldPassword|首次登记|退出世界账号/);
  host.click('tab', { tab: 'map' }); assert.equal((host.innerHTML.match(/class="world-tile /g) || []).length, 256);
  failActionOnce = true; host.click('settle'); await flush(); assert.match(host.innerHTML, /重试刚才操作/);
  const firstAction = calls.find(call => call.url.endsWith('/action')); host.click('retry'); await flush();
  const settleCalls = calls.filter(call => call.payload?.type === 'settle'); assert.equal(settleCalls.length, 2); assert.equal(settleCalls[1].payload.requestId, firstAction.payload.requestId); assert.equal(alice.resources.wood, 380);
  assert.match(host.innerHTML, /world-town-scene/); assert.equal((host.innerHTML.match(/class="world-town-plot /g) || []).length, 8); assert.match(host.innerHTML, /伐木场/); assert.match(host.innerHTML, /打造我的小队/);
  alice.home.buildings.farm = 1;
  alice.home.production = { farm: { resource: 'grain', ratePerMinute: 8, stored: 24, capacity: 400, nextTickAt: clock + 60000 }, lumbermill: { resource: 'wood', ratePerMinute: 0, stored: 18, capacity: 400, nextTickAt: 0 } };
  await client.prepareSession('字欧'); assert.match(host.innerHTML, /旧家园结余 · 可以收取/); assert.match(host.innerHTML, /24 粮草/); assert.match(host.innerHTML, /先升级主城/);
  host.click('harvest', { building: 'lumbermill' }); await flush(); assert.equal(calls.at(-1).payload.building, 'lumbermill'); assert.equal(alice.resources.wood, 398);
  host.click('harvest-all'); await flush(); assert.equal(calls.at(-1).payload.type, 'harvest-all'); assert.equal(alice.resources.grain, 524); assert.match(host.innerHTML, /物资已入库/);
  alice.troops = { infantry: 20, archer: 10, cavalry: 2 }; alice.home.buildings.barracks = 1;
  await client.prepareSession('字欧'); host.click('tab', { tab: 'army' });
  host.submit('worldSquadForm', { '#worldSquadName': '青叶小队', '#worldSquad-infantry': '8', '#worldSquad-archer': '4', '#worldSquad-cavalry': '0' }); await flush();
  assert.equal(calls.at(-1).payload.type, 'squad-save'); assert.deepEqual(calls.at(-1).payload.units, { infantry: 8, archer: 4, cavalry: 0 }); assert.match(host.innerHTML, /青叶小队/);
  host.click('squad-edit', { squadId: 'squad-1' }); assert.match(host.innerHTML, /value="8"/);
  host.submit('worldSquadForm', { '#worldSquadName': '青叶远征队', '#worldSquad-infantry': '10', '#worldSquad-archer': '5', '#worldSquad-cavalry': '1' }); await flush(); assert.equal(calls.at(-1).payload.squadId, 'squad-1');
  const beforeInvalid = calls.length; host.submit('worldSquadForm', { '#worldSquadName': '空队', '#worldSquad-infantry': '0', '#worldSquad-archer': '0', '#worldSquad-cavalry': '0' }); await flush(); assert.equal(calls.length, beforeInvalid);
  state.players = [{ id: 'evil-id', name: '<img src=x onerror=alert(1)>', army: 10, guildId: null }]; state.map.cells = [{ x: 1, y: 1, ownerId: 'evil-id', ownerName: '<img src=x onerror=alert(1)>', level: 1, protectedUntil: 0 }];
  await client.prepareSession('字欧'); host.click('tab', { tab: 'map' }); assert.doesNotMatch(host.innerHTML, /<img src=x/); assert.match(host.innerHTML, /&lt;img/);
  host.click('target', { targetId: 'evil-id' }); host.change('worldAttackSquad', 'squad-1'); assert.match(host.innerHTML, /仅所选小队出征/); assert.match(host.innerHTML, /16 人 · 青叶远征队/);
  host.click('attack', { targetId: 'evil-id' }); await flush(); assert.equal(calls.at(-1).payload.squadId, 'squad-1');
  host.click('squad-delete', { squadId: 'squad-1' }); await flush(); assert.equal(alice.squads.length, 0); assert.equal(alice.troops.infantry, 20);
  const ticket = await client.beginCampaign(1, '字欧'); assert.equal(ticket.ticket, 'ticket-123456789'); await client.claimCampaign(ticket.ticket, '字欧'); assert.equal(calls.at(-1).payload.requestId, 'claim-ticket-123456789');
  cookieName = bob.name; const entersBefore = calls.filter(call => call.url.endsWith('/enter')).length;
  await Promise.all([client.prepareSession('字欧'), client.prepareSession('字欧')]); assert.equal(client.isAuthenticated('字欧'), true); assert.equal(calls.filter(call => call.url.endsWith('/enter')).length, entersBefore + 1, 'Auto reconnect uses a single enter request');
  client.close(); assert.equal(intervals.size, 0); assert.equal(Object.keys(host.events).length, 0); assert.equal(client.hasGameLogin('字欧'), true, 'Closing UI keeps current game identity');
  await client.leaveGame(); assert.equal(client.hasGameLogin('字欧'), false); assert.equal(client.isAuthenticated('字欧'), false); assert.equal(cookieName, null);
  users.get(bob.name).password = 'legacy-world-password';
  await assert.rejects(client.enterGame('李总', 'bob-game-password'), error => error.code === 'world_link_required');
  let authenticatedCalls = 0; client.open({ overlay: host, name: '李总', onAuthenticated() { authenticatedCalls++; } }); await flush();
  assert.match(host.innerHTML, /worldLinkForm/); assert.match(host.innerHTML, /连接并保留旧家园/); assert.doesNotMatch(host.innerHTML, /worldAuthForm/);
  const failedEnterCount = calls.filter(call => call.url.endsWith('/enter')).length; await client.prepareSession('李总'); host.click('refresh'); await flush(); assert.equal(calls.filter(call => call.url.endsWith('/enter')).length, failedEnterCount, 'Legacy linking does not automatically loop');
  host.submit('worldLinkForm', { '#worldLegacyPassword': 'wrong-password' }); await flush(); assert.match(host.innerHTML, /原世界密码不正确/);
  host.submit('worldLinkForm', { '#worldLegacyPassword': 'legacy-world-password' }); await flush(); assert.equal(authenticatedCalls, 1); assert.equal(calls.at(-1).payload.password, 'bob-game-password'); assert.equal(client.isAuthenticated('李总'), true); assert.doesNotMatch(host.innerHTML, /worldLinkForm/);
  client.close(); cookieName = null; await client.prepareSession('李总'); assert.equal(client.isAuthenticated('李总'), true, 'Unified credential reconnects after old link');
  await client.leaveGame(); let releaseEnter; heldEnter = new Promise(resolve => { releaseEnter = resolve; }); const stale = client.enterGame('字欧', 'alice-game-password'); await flush(); client.setPlayerName('李总'); releaseEnter(); await stale; assert.equal(client.hasGameLogin('字欧'), false); assert.equal(client.isAuthenticated('字欧'), false, 'Stale enter response cannot adopt a previous account');
  await client.enterGame('李总', 'bob-game-password'); client.close(); unavailable = true; client.open({ overlay: host, name: '李总' }); await flush(); assert.match(host.innerHTML, /世界服务未连接/); assert.match(host.innerHTML, /尚未连接世界服务/); client.close();
  for (const call of calls) { assert.equal(call.options.credentials, 'same-origin'); if (call.payload) assert.equal(call.options.headers['Content-Type'], 'application/json'); if (!call.url.endsWith('/enter') && !call.url.endsWith('/link')) assert.equal(call.payload?.password, undefined, 'Credentials appear only in authentication requests'); }
  console.log('PASS frontier client: unified entry and single-flight reconnect, password memory only, legacy link preservation, logout identity isolation, main-city scene, manual harvest, squads and selected attack, idempotent retry, campaign tickets, escaping and cleanup');
}
verify().catch(error => { console.error(error); process.exitCode = 1; });
