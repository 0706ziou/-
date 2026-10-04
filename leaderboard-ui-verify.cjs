'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const flush = async () => { for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve)); };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

function fixture() {
  const calls = [], results = [], classes = new Set(), events = new Map(), fields = new Map();
  const document = { activeElement: null, getElementById() { return null; } };
  const host = {
    innerHTML: '', attributes: {}, classList: { add(...values) { values.forEach(value => classes.add(value)); }, remove(...values) { values.forEach(value => classes.delete(value)); }, contains(value) { return classes.has(value); } },
    setAttribute(key, value) { this.attributes[key] = value; }, removeAttribute(key) { delete this.attributes[key]; },
    addEventListener(key, value) { if (!events.has(key)) events.set(key, new Set()); events.get(key).add(value); },
    removeEventListener(key, value) { events.get(key)?.delete(value); }, contains(value) { return !!value?.belongsToHost; },
    querySelector(selector) {
      const action = /data-board-action="([^"]+)"/.exec(selector)?.[1];
      const source = this.innerHTML.match(new RegExp(`<button[^>]*data-board-action="${action}"[^>]*>`))?.[0];
      if (!source) return null;
      const button = { dataset: { boardAction: action }, disabled: / disabled/.test(source), belongsToHost: true, focus() { if (!this.disabled) document.activeElement = this; } };
      fields.set(action, button); return button;
    },
    click(action) {
      const button = this.querySelector(`[data-board-action="${action}"]`);
      assert.ok(button, `Button ${action} exists`);
      for (const callback of [...(events.get('click') || [])]) callback({ target: { closest() { return button; } } });
    },
    escape() {
      const event = { key: 'Escape', prevented: false, stopped: false, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; } };
      for (const callback of [...(events.get('keydown') || [])]) callback(event);
      return event;
    }, events
  };
  const sandbox = { window: { ORCHARD_FRONTIER: { async getLeaderboard(page, name) {
    calls.push({ page, name });
    const result = results.shift();
    if (result instanceof Error) throw result;
    return await result;
  } } }, document, Number, String, Object, Array, Math, console };
  vm.createContext(sandbox); vm.runInContext(fs.readFileSync(require.resolve('./leaderboard-ui.js'), 'utf8'), sandbox);
  return { ui: sandbox.window.ORCHARD_LEADERBOARD, host, calls, results, document };
}

const entry = (rank, highestStage, name = `守护者${rank}`, isSelf = false) => ({ rank, playerId: name, name, highestStage, reachedAt: 1000 + rank, isSelf });
const response = (entries = [], extra = {}) => ({ entries, self: null, totalPlayers: entries.length, page: 1, pageSize: 20, totalPages: 1, serverTime: 123456, ...extra });
let checks = 0;
function passed(label) { checks++; console.log(`PASS ${label}`); }

(async () => {
  {
    const f = fixture(), held = deferred(); f.results.push(held.promise);
    const pending = f.ui.open({ overlay: f.host, name: '字欧' });
    assert.match(f.host.innerHTML, /正在寻找果园勇士/); assert.equal(f.host.attributes['aria-busy'], 'true');
    assert.equal(f.calls[0].page, 1); assert.equal(f.calls[0].name, '字欧');
    assert.equal(f.host.querySelector('[data-board-action="refresh"]').disabled, true);
    assert.equal(f.host.querySelector('[data-board-action="exit"]').disabled, false);
    held.resolve(response()); await pending;
    assert.equal(f.host.attributes['aria-busy'], 'false'); assert.match(f.host.innerHTML, /第一位果园勇士/);
    passed('Loading remains escapable and an empty server board stays empty');
  }
  {
    const f = fixture();
    f.results.push(response([entry(1, 100, '百关勇士'), entry(1, 100, '并列勇士'), entry(3, 99, '第三名')], { self: entry(1, 100, '百关勇士', true) }));
    await f.ui.open({ overlay: f.host, name: '百关勇士', localHighestStage: 100 });
    assert.equal((f.host.innerHTML.match(/podium-1/g) || []).length, 2, 'Tied first ranks both receive the first medal');
    assert.match(f.host.innerHTML, /podium-3/); assert.doesNotMatch(f.host.innerHTML, /podium-2/);
    assert.match(f.host.innerHTML, /第 100 关/); assert.match(f.host.innerHTML, /第 1 名/);
    assert.equal((f.host.innerHTML.match(/class="leaderboard-row(?: |")/g) || []).length, 3);
    assert.match(f.host.innerHTML, /leaderboard-row is-self podium-1/);
    assert.doesNotMatch(f.host.innerHTML, /线上成绩尚未同步/);
    passed('Tied rank medals and the 100th cleared stage follow server records');
  }
  {
    const f = fixture();
    const firstPage = Array.from({ length: 20 }, (_, index) => entry(index + 1, 90 - index));
    const own = entry(35, 27, '页外玩家', true);
    f.results.push(response(firstPage, { self: own, totalPlayers: 42, totalPages: 3 }));
    await f.ui.open({ overlay: f.host, name: own.name, localHighestStage: 42 });
    assert.match(f.host.innerHTML, /第 35 名/); assert.match(f.host.innerHTML, /第 27 关/);
    assert.match(f.host.innerHTML, /本机已通关第 42 关，线上成绩尚未同步/);
    assert.equal((f.host.innerHTML.match(/class="leaderboard-row(?: |")/g) || []).length, 20, 'Page-outside self is a summary, not an invented list row');
    assert.doesNotMatch(f.host.innerHTML, /<strong>42<\/strong><small>关/);
    f.results.push(response([entry(21, 65)], { self: own, totalPlayers: 42, totalPages: 3, page: 2 }));
    f.host.click('next'); await flush();
    assert.equal(f.calls.at(-1).page, 2); assert.match(f.host.innerHTML, /<span>2 \/ 3/); assert.match(f.host.innerHTML, /第 35 名/);
    f.results.push(response(firstPage, { self: own, totalPlayers: 42, totalPages: 3, page: 1 }));
    f.host.click('previous'); await flush(); assert.equal(f.calls.at(-1).page, 1);
    passed('Independent self card, unsynced browser notice and real pagination');
  }
  {
    const f = fixture(); f.results.push(new Error('Connection failed'));
    await f.ui.open({ overlay: f.host, name: '离线玩家', localHighestStage: 100 });
    assert.match(f.host.innerHTML, /暂时连接不上排行榜/); assert.match(f.host.innerHTML, /重新连接/);
    assert.doesNotMatch(f.host.innerHTML, /第 100 关/); assert.doesNotMatch(f.host.innerHTML, /Connection failed/);
    f.results.push(response([entry(1, 5, '联网玩家')])); f.host.click('retry'); await flush();
    assert.match(f.host.innerHTML, /联网玩家/); assert.doesNotMatch(f.host.innerHTML, /has-error/);
    f.results.push(new Error('A temporary refresh failure')); f.host.click('refresh'); await flush();
    assert.match(f.host.innerHTML, /联网玩家/); assert.match(f.host.innerHTML, /has-error/);
    f.results.push(response([entry(1, 6, '新成绩')])); f.host.click('retry'); await flush();
    assert.match(f.host.innerHTML, /新成绩/); assert.doesNotMatch(f.host.innerHTML, /has-error/);
    passed('Initial errors and failed refreshes retry without inventing scores');
  }
  {
    const f = fixture(), old = deferred(); f.results.push(old.promise);
    const previous = f.ui.open({ overlay: f.host, name: '旧账号' });
    f.results.push(response([entry(1, 77, '新账号')], { self: entry(1, 77, '新账号', true) }));
    await f.ui.open({ overlay: f.host, name: '新账号' });
    const html = f.host.innerHTML;
    old.resolve(response([entry(1, 100, '旧账号')], { self: entry(1, 100, '旧账号', true) })); await previous;
    assert.equal(f.host.innerHTML, html); assert.equal(f.host.events.get('click').size, 1); assert.equal(f.host.events.get('keydown').size, 1);
    passed('Account replacement ignores old success and keeps exactly one listener');
  }
  {
    const f = fixture(), old = deferred(); f.results.push(old.promise);
    const previous = f.ui.open({ overlay: f.host, name: '旧账号' });
    f.results.push(response([entry(1, 44, '当前账号')])); await f.ui.open({ overlay: f.host, name: '当前账号' });
    const html = f.host.innerHTML; old.reject(new Error('Old account failure')); await previous;
    assert.equal(f.host.innerHTML, html); assert.equal(f.host.attributes['aria-busy'], 'false');
    passed('Late failures cannot replace the active account or its loading state');
  }
  {
    const f = fixture(), old = deferred(); let exits = 0; f.results.push(old.promise);
    const previous = f.ui.open({ overlay: f.host, name: '返回玩家', onExit() { exits++; f.host.innerHTML = '选关界面'; } });
    f.host.click('exit'); assert.equal(exits, 1); assert.equal(f.host.events.get('click').size, 0); assert.equal(f.host.events.get('keydown').size, 0);
    assert.equal(f.host.classList.contains('leaderboard-overlay'), false);
    old.resolve(response([entry(1, 100, '晚到成绩')])); await previous;
    assert.equal(f.host.innerHTML, '选关界面'); assert.equal(exits, 1);
    f.results.push(response()); await f.ui.open({ overlay: f.host, name: '返回玩家', onExit() { exits++; } });
    const key = f.host.escape(); assert.equal(exits, 2); assert.equal(key.prevented, true); assert.equal(key.stopped, true);
    f.ui.close(); assert.equal(exits, 2, 'Cleanup is distinct from a user exit');
    passed('Return and Escape clean the board and ignore a late response');
  }
  {
    const f = fixture(), evil = '<img src=x onerror="alert(1)">&\'';
    f.results.push(response([entry(1, 100, evil, true)], { self: entry(1, 100, evil, true) }));
    await f.ui.open({ overlay: f.host, name: evil });
    assert.doesNotMatch(f.host.innerHTML, /<img|onerror="alert/); assert.match(f.host.innerHTML, /&lt;img/); assert.match(f.host.innerHTML, /&quot;alert/); assert.match(f.host.innerHTML, /&amp;&#39;/);
    passed('Online names and self names remain escaped in visible text and ARIA');
  }
  {
    const f = fixture(); f.results.push({ error: '<script>invalid</script>' });
    await f.ui.open({ overlay: f.host, name: '数据错误玩家' });
    assert.match(f.host.innerHTML, /暂时连接不上排行榜/); assert.doesNotMatch(f.host.innerHTML, /<script>/);
    f.ui.close();
    passed('Malformed responses fail safely instead of rendering untrusted payloads');
  }
  console.log(`${checks} leaderboard component checks passed.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
