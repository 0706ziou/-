/* Only the production game's player data follows the server reset epoch. */
(() => {
  'use strict';
  const EPOCH_KEY = 'orchard-online-epoch-v1';
  const ORIGIN = 'https://111.230.149.65';
  const validEpoch = value => value === 'initial' || typeof value === 'string' && /^reset-[0-9a-f]{32}$/.test(value);
  const playerKey = key => ['orchard-accounts-v1', 'orchard-last-account-v1', 'orchard-save-v1', 'orchard-world-pending-v1']
    .some(base => key === base || key?.startsWith(base + ':'));

  function create({ storage, sessionStorage, location, fetch: fetcher, onReset = () => {},
    schedule = globalThis.setTimeout, cancel = globalThis.clearTimeout } = {}) {
    const online = location?.origin === ORIGIN;
    let epoch = '', pending = null, established = false, blocked = false;
    function clear(storageArea) {
      if (!storageArea) return;
      const keys = [];
      for (let index = 0; index < storageArea.length; index++) keys.push(storageArea.key(index));
      for (const key of keys) if (playerKey(key)) storageArea.removeItem(key);
    }
    async function check() {
      if (!online) return '';
      if (!storage || typeof fetcher !== 'function') throw new Error('无法连接游戏账号，请允许浏览器保存游戏数据后重试。');
      const controller = new AbortController();
      const timeout = schedule(() => controller.abort(), 10000);
      try {
        const response = await fetcher(ORIGIN + '/api/world/health', {
          credentials: 'same-origin', cache: 'no-store', redirect: 'error',
          headers: { Accept: 'application/json' }, signal: controller.signal
        });
        const result = await response.json();
        if (!response.ok || result?.ok !== true || !validEpoch(result.dataEpoch)) throw new Error('invalid epoch');
        const next = result.dataEpoch, saved = storage.getItem(EPOCH_KEY);
        // First visits after a reset must also discard pre-epoch legacy saves.
        const changed = next !== 'initial' && saved !== next;
        if (changed) { clear(storage); clear(sessionStorage); }
        storage.setItem(EPOCH_KEY, next);
        const liveReset = established && epoch !== next;
        epoch = next; established = true;
        if (liveReset) {
          blocked = true; onReset();
          throw new Error('游戏数据已重置，请刷新页面后重新注册。');
        }
        return epoch;
      } catch (error) {
        throw new Error(blocked ? '游戏数据已重置，请刷新页面后重新注册。' : '暂时无法连接游戏账号，请检查网络后重新登录。', { cause: error });
      } finally { cancel(timeout); }
    }
    function ensure({ force = false } = {}) {
      if (!online) return Promise.resolve('');
      if (blocked) return Promise.reject(new Error('游戏数据已重置，请刷新页面后重新注册。'));
      if (pending) return pending;
      if (epoch && !force) return Promise.resolve(epoch);
      pending = check().finally(() => { pending = null; });
      return pending;
    }
    async function requestHeaders() {
      const current = await ensure();
      assertCurrent(current);
      return current ? { 'X-Orchard-Data-Epoch': current } : {};
    }
    function assertCurrent(expected = epoch) {
      if (online && (blocked || !epoch || expected !== epoch || storage.getItem(EPOCH_KEY) !== epoch)) {
        throw new Error('游戏数据已重置，请刷新页面后重新注册。');
      }
    }
    function storageKey(base) {
      if (!online) return base;
      assertCurrent();
      return epoch.startsWith('reset-') ? base + ':epoch:' + epoch : base;
    }
    async function handleReset() { return ensure({ force: true }); }
    return Object.freeze({ ensure, requestHeaders, handleReset, storageKey, assertCurrent, currentEpoch: () => epoch, isOnline: online });
  }

  let storage, sessionStorage;
  try { storage = window.localStorage; sessionStorage = window.sessionStorage; } catch {}
  const service = create({ storage, sessionStorage, location: window.location,
    fetch: (...args) => globalThis.fetch(...args),
    onReset: () => {
      window.dispatchEvent?.(new Event('orchard-player-data-reset'));
      window.location.reload();
    }
  });
  window.ORCHARD_ONLINE_RESET = Object.freeze({ ...service, create, epochKey: EPOCH_KEY });
  if (service.isOnline) {
    void service.ensure().catch(() => {});
    window.addEventListener?.('storage', event => {
      if (event.key === EPOCH_KEY) void service.handleReset().catch(() => {});
    });
  }
})();
