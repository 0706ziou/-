/* Client integration checks: real API contracts, identity isolation and retry ids. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const clone = value => JSON.parse(JSON.stringify(value));
const flush = async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve)); };
function classList() { const names = new Set(); return { add(...values) { values.forEach(value => names.add(value)); }, remove(...values) { values.forEach(value => names.delete(value)); }, toggle(value, condition) { condition ? names.add(value) : names.delete(value); }, contains(value) { return names.has(value); } }; }
function makeHost() {
  const events = {}, fields = {}, body = { scrollTop: 0, scrollTo() {}, insertAdjacentHTML() {} };
  return { innerHTML: '', classList: classList(), events, fields, attributes: {},
    setAttribute(key, value) { this.attributes[key] = value; },
    addEventListener(name, callback) { events[name] = callback; },
    removeEventListener(name) { delete events[name]; },
    querySelector(selector) { return selector === '.world-body' ? body : fields[selector] || null; },
    querySelectorAll() { return []; }, contains() { return true; },
    click(action, data = {}) { const button = { dataset: { worldAction: action, ...data }, disabled: false }; events.click({ target: { closest() { return button; } } }); },
    submit(id, values) { events.submit({ preventDefault() {}, target: { id, querySelector(selector) { return { value: values[selector] }; } } }); }
  };
}

async function verify() {
  const calls = [], intervals = new Set(), replay = new Map();
  let clock = Date.now(), cookieName = null, failActionOnce = false, unavailable = false;
  const alice = { id: 'alice-id', name: '字欧', resources: { wood: 500, stone: 500, grain: 500, iron: 500, token: 25 }, home: null, troops: { infantry: 0, archer: 0, cavalry: 0 }, queues: [], guildId: null, unlockedStage: 1, attackReadyAt: 0, capacity: 1000 };
  const bob = { ...clone(alice), id: 'bob-id', name: '李总' };
  const state = { self: null, map: { width: 16, height: 16, cells: [] }, players: [], guilds: [], reports: [], rules: { costs: { settle: { wood: 120, stone: 80 }, buildings: { keep: [null, {}, { wood: 400 }], farm: [null, { wood: 65 }, { wood: 260 }], warehouse: [null, {}], wall: [null, {}], barracks: [null, {}] }, guildCreate: { wood: 100, token: 10 } }, training: { infantry: { seconds: 5, power: 3, cost: { grain: 8 } } }, buildMaxLevel: 5, maxQueues: 3, maxTrainCount: 100 }, serverTime: clock };
  function snapshot() { state.self = cookieName === alice.name ? alice : cookieName === bob.name ? bob : null; state.serverTime = ++clock; return clone(state); }
  const sandbox = { window: {}, location: { protocol: 'http:' }, AbortController, console, Date, Math, Number, String, Object, Array, Map, Set, Promise,
    setTimeout, clearTimeout,
    setInterval(callback) { const id = { callback }; intervals.add(id); return id; }, clearInterval(id) { intervals.delete(id); },
    localStorage: { getItem() { throw new Error('World must not read local passwords or saves'); } },
    document: { hidden: false, activeElement: { matches() { return false; } }, getElementById() { return { classList: classList() }; } },
    async fetch(url, options) {
      const payload = options.body ? JSON.parse(options.body) : undefined;
      calls.push({ url, options: { ...options, signal: undefined }, payload });
      if (unavailable) return { ok: false, status: 404, async json() { throw new Error('HTML response'); } };
      let result = { ok: true };
      if (url.endsWith('/login') || url.endsWith('/register')) cookieName = payload.name;
      if (url.endsWith('/logout')) cookieName = null;
      if (url.endsWith('/campaign/start')) result = { ok: true, ticket: 'ticket-123456789', claimAfter: clock + 60000 };
      if (url.endsWith('/campaign/claim')) result = { ok: true, rewards: { wood: 48, token: 1 } };
      if (url.endsWith('/action')) {
        assert.equal(payload.accountName, cookieName, 'Every action binds the intended current game account');
        if (!replay.has(payload.requestId)) {
          alice.resources.wood -= 120; alice.resources.stone -= 80;
          alice.home = { x: payload.x, y: payload.y, level: 1, protectedUntil: clock + 300000, buildings: { keep: 1, farm: 0, warehouse: 0, wall: 0, barracks: 0 } };
          replay.set(payload.requestId, true);
        }
        if (failActionOnce) { failActionOnce = false; throw new Error('Lost response after server commit'); }
      }
      return { ok: true, status: 200, async json() { return { ...result, state: snapshot() }; } };
    }
  };
  vm.createContext(sandbox); vm.runInContext(fs.readFileSync(require.resolve('./frontier-ui.js'), 'utf8'), sandbox);
  const client = sandbox.window.ORCHARD_FRONTIER, host = makeHost();
  assert.equal(client.isAuthenticated('字欧'), false);
  assert.equal(await client.prepareSession('字欧'), false, 'Anonymous preview must not register a world identity');
  assert.equal(calls.length, 1); assert.equal(calls[0].url, '/api/world/state');
  cookieName = alice.name;
  assert.equal(await client.prepareSession('字欧'), true);
  assert.equal(client.isAuthenticated('李总'), false);
  const ticket = await client.beginCampaign(1, '字欧');
  assert.equal(ticket.ticket, 'ticket-123456789');
  assert.equal(calls.at(-1).payload.name, '字欧'); assert.equal(calls.at(-1).payload.stage, 1);
  const claim = await client.claimCampaign(ticket.ticket, '字欧');
  assert.equal(claim.rewards.wood, 48); assert.equal(calls.at(-1).payload.name, '字欧');
  assert.equal(calls.at(-1).payload.requestId, 'claim-ticket-123456789');
  cookieName = bob.name;
  await assert.rejects(client.beginCampaign(1, '字欧'), error => error.code === 'WORLD_LOGIN_REQUIRED');
  assert.equal(client.isAuthenticated('字欧'), false, 'A changed server session cannot award the previous identity');
  assert.equal(calls.at(-1).url, '/api/world/state');
  cookieName = alice.name; await client.prepareSession('字欧');
  client.open({ overlay: host, name: '字欧', onExit() {} }); await flush();
  assert.equal(host.classList.contains('frontier-overlay'), true);
  assert.equal((host.innerHTML.match(/class="world-tile /g) || []).length, 256, 'Map reflects the full real 16 × 16 world');
  assert.match(host.innerHTML, /0 座家园/); assert.doesNotMatch(host.innerHTML, /虚拟玩家|模拟玩家/);
  failActionOnce = true; host.click('settle'); await flush();
  assert.match(host.innerHTML, /重试刚才操作/);
  const firstAction = calls.find(call => call.url.endsWith('/action'));
  host.click('retry'); await flush();
  const actions = calls.filter(call => call.url.endsWith('/action'));
  assert.equal(actions.length, 2); assert.equal(actions[1].payload.requestId, firstAction.payload.requestId, 'Ambiguous mutations retry the same id');
  assert.equal(alice.resources.wood, 380, 'Retry does not double spend');
  assert.match(host.innerHTML, /家园建成/); assert.match(host.innerHTML, /world-building-card/);
  alice.home.buildings.farm = 1; state.players = [{ id: 'evil-id', name: '<img src=x onerror=alert(1)>', army: 10, guildId: null }];
  state.map.cells = [{ x: 1, y: 1, ownerId: 'evil-id', ownerName: '<img src=x onerror=alert(1)>', level: 1, protectedUntil: 0 }];
  await client.prepareSession('字欧'); host.click('tab', { tab: 'home' });
  assert.match(host.innerHTML, /先升级主城/);
  host.click('tab', { tab: 'map' });
  assert.doesNotMatch(host.innerHTML, /<img src=x/); assert.match(host.innerHTML, /&lt;img/);
  host.click('target', { targetId: 'evil-id' });
  assert.match(host.innerHTML, /结束保护并全军出征/); assert.match(host.innerHTML, /主动出征将立即结束自己的保护/);
  client.close(); assert.equal(intervals.size, 0); assert.equal(host.classList.contains('frontier-overlay'), false);
  assert.equal(Object.keys(host.events).length, 0, 'Closed world detaches interactions and polling');
  cookieName = null; client.setPlayerName('李总');
  let authenticatedCalls = 0;
  client.open({ overlay: host, name: '李总', onAuthenticated() { authenticatedCalls++; } }); await flush();
  host.submit('worldAuthForm', { '#worldPassword': 'secret-test-123' }); await flush();
  assert.equal(authenticatedCalls, 1); assert.equal(client.isAuthenticated('李总'), true);
  await client.prepareSession('李总'); assert.equal(authenticatedCalls, 1, 'Polling never fires the authentication callback');
  client.close(); unavailable = true;
  client.open({ overlay: host, name: '李总' }); await flush();
  assert.match(host.innerHTML, /世界服务未连接/); assert.match(host.innerHTML, /尚未连接世界服务/); client.close();
  for (const call of calls) {
    assert.equal(call.options.credentials, 'same-origin');
    if (call.payload) assert.equal(call.options.headers['Content-Type'], 'application/json');
  }
  console.log('PASS frontier client: sessions, campaign contracts, account isolation, real map, safe text, idempotent retry, building gates, authentication callback and cleanup');
}
verify().catch(error => { console.error(error); process.exitCode = 1; });
