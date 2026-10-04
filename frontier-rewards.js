/* Campaign receipts are issued and redeemed by the world server. No local currency is exchanged. */
(() => {
  'use strict';
  const LABELS = { wood: '木材', stone: '石料', grain: '粮草', iron: '铁矿', token: '世界令' };
  const KEY = 'orchard-world-pending-v1:';
  function create({ getClient, getName, getOwner, storage, onChange = () => {}, schedule = globalThis.setTimeout, cancel = globalThis.clearTimeout, clock = () => Date.now() }) {
    let active = null;
    let generation = 0;
    const memory = new Map();
    const timers = new Map();
    const owner = () => String(getOwner() || '');
    const current = record => record.generation === generation && owner() === record.owner && String(getName() || '') === record.name;
    const receiptKey = id => (window.ORCHARD_ONLINE_RESET?.storageKey(KEY.slice(0, -1)) || KEY.slice(0, -1)) + ':' + id;
    function read(id) {
      if (memory.has(id)) return memory.get(id);
      let records = [];
      try {
        const saved = JSON.parse(storage?.getItem(receiptKey(id)) || '[]');
        if (Array.isArray(saved)) records = saved.filter(item => item && typeof item.ticket === 'string' && item.ticket.length <= 200 && typeof item.name === 'string').slice(-20);
      } catch {}
      memory.set(id, records); return records;
    }
    function write(id, records) {
      memory.set(id, records);
      try { storage?.setItem(receiptKey(id), JSON.stringify(records)); } catch {}
    }
    function remember(record) {
      const records = read(record.owner);
      if (!records.some(item => item.ticket === record.ticket)) write(record.owner, [...records, { ticket: record.ticket, name: record.name, stage: record.stage, readyAt: record.readyAt || 0 }].slice(-20));
    }
    function message(record, text, retry = false) {
      record.text = text; record.retry = retry;
      if (active === record && owner() === record.owner) onChange(status());
    }
    function status() {
      return active && owner() === active.owner ? { text: active.text, canRetry: !!active.retry } : { text: '游戏账号会自动连接世界，通关后领取世界专属物资。', canRetry: false };
    }
    function queueRetry(record, wait) {
      if (typeof schedule !== 'function' || record.generation !== generation || owner() !== record.owner || record.done || (record.attempts || 0) >= 3) return;
      const key = record.owner + ':' + record.ticket;
      if (timers.has(key)) return;
      record.attempts = (record.attempts || 0) + 1;
      const timer = schedule(() => {
        timers.delete(key);
        if (record.generation === generation && owner() === record.owner && String(getName() || '') === record.name) void redeem(record);
      }, Math.min(65000, Math.max(1000, wait)));
      timers.set(key, timer);
    }
    function stopRetry(record) {
      const key = record.owner + ':' + record.ticket;
      if (timers.has(key)) { cancel?.(timers.get(key)); timers.delete(key); }
    }
    async function redeem(record) {
      if (record.busy || record.done || !current(record)) return false;
      const client = getClient();
      if (!client?.isAuthenticated(record.name) && !client?.hasGameLogin?.(record.name)) {
        message(record, '世界物资待入库，请用本次挑战的游戏账号登录后重试。', true); return false;
      }
      record.busy = true; message(record, '正在将世界专属物资存入世界仓库…');
      try {
        if (!record.completeDone && typeof client.completeCampaign === 'function') {
          const completed = await client.completeCampaign(record.ticket, record.name);
          if (!current(record)) return false;
          record.completeDone = true;
          const remaining = Number(completed.state?.self?.claimReadyAt || 0) - Number(completed.state?.serverTime || 0);
          if (remaining > 0) record.readyAt = Math.max(record.readyAt || 0, clock() + remaining);
        }
        if (!current(record)) return false;
        if (Number(record.readyAt) > clock()) {
          message(record, '通关成绩已同步到排行榜，世界物资稍后自动入库。', true);
          queueRetry(record, Number(record.readyAt) - clock()); return false;
        }
        const result = await client.claimCampaign(record.ticket, record.name);
        if (!current(record)) return false;
        record.done = true;
        stopRetry(record);
        write(record.owner, read(record.owner).filter(item => item.ticket !== record.ticket));
        const rewards = result.rewards || {};
        const text = Object.entries(LABELS).filter(([key]) => Number(rewards[key]) > 0).map(([key, label]) => label + ' +' + rewards[key]).join(' · ');
        message(record, '世界物资已入库' + (text ? '：' + text : '') + '，只能用于世界建造、造兵与公会。');
        return true;
      } catch (error) {
        if (!current(record)) return false;
        if (['invalid_ticket', 'ticket_expired'].includes(error.code)) {
          write(record.owner, read(record.owner).filter(item => item.ticket !== record.ticket));
          record.done = true;
          stopRetry(record);
          message(record, '本次世界奖励凭证已失效，请连接世界后重新挑战关卡。');
          return true;
        }
        if (['claim_too_early', 'claim_rate_limit'].includes(error.code)) {
          message(record, '通关成绩已同步到排行榜，世界物资稍后自动入库。', true);
          queueRetry(record, 60000); return false;
        }
        message(record, '世界物资待入库：' + (error.message || '暂时无法连接世界') + '。可稍后重试。', true); return false;
      } finally { record.busy = false; }
    }
    function begin(stage) {
      const previous = active?.victory ? active.settlement : null;
      const record = { owner: owner(), name: String(getName() || ''), stage, generation, text: '', ticket: '', victory: false, done: false, busy: false, retry: false };
      active = record;
      const client = getClient();
      if (!record.owner || (!client?.isAuthenticated(record.name) && !client?.hasGameLogin?.(record.name))) {
        record.pending = Promise.resolve(null);
        message(record, '本次尚未连接世界，无法领取世界物资；用游戏账号完成连接后再挑战。'); return record.pending;
      }
      message(record, '世界物资凭证正在准备…');
      record.pending = Promise.resolve(previous).catch(() => {}).then(() => {
        if (record.generation !== generation || owner() !== record.owner || String(getName() || '') !== record.name) return null;
        return client.beginCampaign(stage, record.name);
      }).then(result => {
        if (record.generation !== generation) return null;
        if (!result?.ticket) throw new Error('世界未签发本次挑战凭证');
        record.ticket = result.ticket;
        const remaining = Number(result.claimAfter || 0) - Number(result.state?.serverTime || clock());
        record.readyAt = remaining > 0 ? clock() + remaining : 0;
        message(record, '通关后自动领取世界专属物资。');
        return result;
      }).catch(error => {
        if (record.generation !== generation) return null;
        message(record, '本次世界奖励未启用：' + (error.message || '世界服务未连接') + '。关卡养成奖励照常获得。'); return null;
      });
      return record.pending;
    }
    function victory() {
      const record = active;
      if (!record || record.victory) return Promise.resolve(false);
      record.victory = true;
      record.settlement = record.pending.then(result => {
        if (!result?.ticket || record.generation !== generation) return false;
        remember(record);
        return redeem(record);
      });
      return record.settlement;
    }
    async function retry() {
      const id = owner(), name = String(getName() || '');
      if (!id) return false;
      let ok = true;
      for (const receipt of [...read(id)]) {
        if (receipt.name !== name || owner() !== id) continue;
        const record = active?.ticket === receipt.ticket ? active : { ...receipt, owner: id, generation, text: '', done: false, busy: false };
        if (!await redeem(record)) ok = false;
      }
      return ok;
    }
    function reset() { active = null; generation++; for (const timer of timers.values()) cancel?.(timer); timers.clear(); memory.clear(); }
    globalThis.addEventListener?.('orchard-player-data-reset', reset);
    return Object.freeze({ begin, victory, retry, reset, status });
  }
  window.ORCHARD_FRONTIER_REWARDS = Object.freeze({ create });
})();
