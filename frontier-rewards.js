/* Campaign receipts are issued and redeemed by the world server. No local currency is exchanged. */
(() => {
  'use strict';
  const LABELS = { wood: '木材', stone: '石料', grain: '粮草', iron: '铁矿', token: '世界令' };
  const KEY = 'orchard-world-pending-v1:';
  function create({ getClient, getName, getOwner, storage, onChange = () => {} }) {
    let active = null;
    const memory = new Map();
    const owner = () => String(getOwner() || '');
    function read(id) {
      if (memory.has(id)) return memory.get(id);
      let records = [];
      try {
        const saved = JSON.parse(storage?.getItem(KEY + id) || '[]');
        if (Array.isArray(saved)) records = saved.filter(item => item && typeof item.ticket === 'string' && item.ticket.length <= 200 && typeof item.name === 'string').slice(-20);
      } catch {}
      memory.set(id, records); return records;
    }
    function write(id, records) {
      memory.set(id, records);
      try { storage?.setItem(KEY + id, JSON.stringify(records)); } catch {}
    }
    function remember(record) {
      const records = read(record.owner);
      if (!records.some(item => item.ticket === record.ticket)) write(record.owner, [...records, { ticket: record.ticket, name: record.name, stage: record.stage }].slice(-20));
    }
    function message(record, text, retry = false) {
      record.text = text; record.retry = retry;
      if (active === record && owner() === record.owner) onChange(status());
    }
    function status() {
      return active && owner() === active.owner ? { text: active.text, canRetry: !!active.retry } : { text: '先进入世界登录，再挑战关卡即可领取世界专属物资。', canRetry: false };
    }
    async function redeem(record) {
      if (record.busy || record.done || owner() !== record.owner) return false;
      const client = getClient();
      if (!client?.isAuthenticated(record.name)) {
        message(record, '世界物资待入库，请用本次挑战的名字登录世界后重试。', true); return false;
      }
      record.busy = true; message(record, '正在将世界专属物资存入世界仓库…');
      try {
        const result = await client.claimCampaign(record.ticket, record.name);
        record.done = true;
        write(record.owner, read(record.owner).filter(item => item.ticket !== record.ticket));
        const rewards = result.rewards || {};
        const text = Object.entries(LABELS).filter(([key]) => Number(rewards[key]) > 0).map(([key, label]) => label + ' +' + rewards[key]).join(' · ');
        message(record, '世界物资已入库' + (text ? '：' + text : '') + '，只能用于世界建造、造兵与公会。');
        return true;
      } catch (error) {
        if (['invalid_ticket', 'ticket_expired'].includes(error.code)) {
          write(record.owner, read(record.owner).filter(item => item.ticket !== record.ticket));
          record.done = true;
          message(record, '本次世界奖励凭证已失效，请登录世界后重新挑战关卡。');
          return true;
        }
        message(record, '世界物资待入库：' + (error.message || '暂时无法连接世界') + '。可稍后重试。', true); return false;
      } finally { record.busy = false; }
    }
    function begin(stage) {
      const record = { owner: owner(), name: String(getName() || ''), stage, text: '', ticket: '', victory: false, done: false, busy: false, retry: false };
      active = record;
      const client = getClient();
      if (!record.owner || !client?.isAuthenticated(record.name)) {
        record.pending = Promise.resolve(null);
        message(record, '本次未登录世界，无法领取世界物资；先进入世界登录后再挑战。'); return record.pending;
      }
      message(record, '世界物资凭证正在准备…');
      record.pending = Promise.resolve().then(() => client.beginCampaign(stage, record.name)).then(result => {
        if (!result?.ticket) throw new Error('世界未签发本次挑战凭证');
        record.ticket = result.ticket;
        message(record, '通关后自动领取世界专属物资。');
        return result;
      }).catch(error => {
        message(record, '本次世界奖励未启用：' + (error.message || '世界服务未连接') + '。关卡养成奖励照常获得。'); return null;
      });
      return record.pending;
    }
    function victory() {
      const record = active;
      if (!record || record.victory) return Promise.resolve(false);
      record.victory = true;
      return record.pending.then(result => {
        if (!result?.ticket) return false;
        remember(record);
        return redeem(record);
      });
    }
    async function retry() {
      const id = owner(), name = String(getName() || '');
      if (!id) return false;
      let ok = true;
      for (const receipt of [...read(id)]) {
        if (receipt.name !== name || owner() !== id) continue;
        const record = active?.ticket === receipt.ticket ? active : { ...receipt, owner: id, text: '', done: false, busy: false };
        if (!await redeem(record)) { ok = false; break; }
      }
      return ok;
    }
    function reset() { active = null; }
    return Object.freeze({ begin, victory, retry, reset, status });
  }
  window.ORCHARD_FRONTIER_REWARDS = Object.freeze({ create });
})();
