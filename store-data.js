/* Diamond monetization prototype. Credits are FREE test credits, not a live paid wallet. */
(() => {
  'use strict';
  const mode = 'free-preview', MAX = 999999;
  const packs = Object.freeze([
    Object.freeze({ id: 'small', name: '轻量体验', diamonds: 180 }),
    Object.freeze({ id: 'medium', name: '畅玩体验', diamonds: 600 }),
    Object.freeze({ id: 'large', name: '满仓体验', diamonds: 1800 })
  ]);
  const products = Object.freeze([
    Object.freeze({ id: 'star_aura', name: '星辉守护光环', category: '外观', kind: 'aura', price: 240, art: 'assets/store/star-aura.svg', description: '角色脚下出现星辉光环，全英雄通用；只改变外观，不增加战斗属性。' }),
    Object.freeze({ id: 'gold_frame', name: '丰收头像框', category: '外观', kind: 'frame', price: 120, art: 'assets/store/gold-frame.svg', description: '为战斗中的英雄头像装上金色果园边框；只改变外观，不增加战斗属性。' }),
    Object.freeze({ id: 'seed_bundle', name: '阳光补给礼包', category: '补给', kind: 'supply', price: 60, art: 'assets/store/seed-bundle.svg', seeds: 180, cores: 0, description: '获得180阳光籽，可用于已有的英雄训练和果园养成。支持重复购买。' }),
    Object.freeze({ id: 'core_bundle', name: '果核补给礼包', category: '补给', kind: 'supply', price: 90, art: 'assets/store/core-bundle.svg', seeds: 0, cores: 6, description: '获得6枚果核，可用于已有的装备强化与英雄训练。支持重复购买。' })
  ]);
  const get = id => products.find(product => product.id === id) || null;
  const getPack = id => packs.find(pack => pack.id === id) || null;
  const integer = (value, max = MAX) => Number.isSafeInteger(value) && value >= 0 && value <= max ? value : 0;
  function migrate(raw = {}, target = {}) {
    const data = raw.commerce && typeof raw.commerce === 'object' ? raw.commerce : {};
    const owned = [...new Set((Array.isArray(data.owned) ? data.owned : []).filter(id => get(id) && get(id).kind !== 'supply'))];
    target.commerce = { version: 1, diamonds: integer(data.diamonds), owned,
      equippedAura: owned.includes(data.equippedAura) && get(data.equippedAura)?.kind === 'aura' ? data.equippedAura : '',
      equippedFrame: owned.includes(data.equippedFrame) && get(data.equippedFrame)?.kind === 'frame' ? data.equippedFrame : '',
      sequence: integer(data.sequence, 999999999), receipts: [] };
    // The removed dew_charm is deliberately not migrated into a new paid item or buff.
    for (const record of (Array.isArray(data.receipts) ? data.receipts : []).slice(-20)) {
      if (record && Number.isSafeInteger(record.id) && record.id > 0 && record.id <= target.commerce.sequence &&
          (record.kind === 'preview-topup' && getPack(record.sku) && record.delta === getPack(record.sku).diamonds ||
           record.kind === 'diamond-purchase' && get(record.sku) && record.delta === -get(record.sku).price)) {
        target.commerce.receipts.push({ id: record.id, kind: record.kind, sku: record.sku, delta: record.delta });
      }
    }
    return target;
  }
  const owns = (profile, id) => !!get(id) && get(id).kind !== 'supply' && profile?.commerce?.owned?.includes(id) === true;
  function transaction(profile, kind, id) {
    const c = profile?.commerce;
    if (!c || !Number.isSafeInteger(c.diamonds) || c.diamonds < 0 || c.diamonds > MAX) return { ok: false, message: '钻石账户异常，请重新登录。' };
    if (!Array.isArray(c.owned) || !Array.isArray(c.receipts)) return { ok: false, message: '账户记录异常，请重新登录。' };
    const next = { ...c, owned: [...c.owned], receipts: [...c.receipts] };
    let seeds = profile.seeds, cores = profile.cores, delta = 0, message = '';
    if (kind === 'preview-topup') {
      const pack = getPack(id);
      if (mode !== 'free-preview' || !pack) return { ok: false, message: '测试充值暂不可用。' };
      if (c.diamonds > MAX - pack.diamonds) return { ok: false, message: '钻石已接近上限，未执行充值。' };
      delta = pack.diamonds; next.diamonds += delta; message = '测试充值成功，+' + delta + '钻石；没有支付真钱。';
    } else if (kind === 'diamond-purchase') {
      const product = get(id);
      if (!product) return { ok: false, message: '商品不存在。' };
      if (owns(profile, id)) return { ok: false, message: '此外观已经拥有，无需重复购买。' };
      if (c.diamonds < product.price) return { ok: false, insufficient: true, message: '钻石不足，还差' + (product.price - c.diamonds) + '钻石。点击钻石旁的＋进入测试充值。' };
      if (product.kind === 'supply') {
        if (!Number.isSafeInteger(seeds) || !Number.isSafeInteger(cores) || seeds < 0 || cores < 0 || seeds > MAX - product.seeds || cores > MAX - product.cores) return { ok: false, message: '材料已接近上限，本次没有扣钻。' };
        seeds += product.seeds; cores += product.cores;
      } else {
        next.owned.push(id);
        if (product.kind === 'aura') next.equippedAura = id;
        if (product.kind === 'frame') next.equippedFrame = id;
      }
      delta = -product.price; next.diamonds += delta;
      message = '已购买' + product.name + '，扣除' + product.price + '钻石。' + (product.kind === 'supply' ? '补给已入账。' : '外观已自动装备。');
    } else if (kind === 'equip') {
      const product = get(id); if (!product || !owns(profile, id)) return { ok: false, message: '请先购买此外观。' };
      const key = product.kind === 'aura' ? 'equippedAura' : 'equippedFrame';
      next[key] = next[key] === id ? '' : id;
      message = (next[key] ? '已装备' : '已取消装备') + product.name + '；不扣钻石。';
      return { ok: true, commerce: next, seeds, cores, message };
    } else return { ok: false, message: '操作不支持。' };
    if (!Number.isSafeInteger(c.sequence) || c.sequence < 0 || c.sequence >= 999999999) return { ok: false, message: '测试记录已达上限，未执行操作。' };
    next.sequence++; next.receipts = [...next.receipts, { id: next.sequence, kind, sku: id, delta }].slice(-20);
    return { ok: true, commerce: next, seeds, cores, message };
  }
  window.ORCHARD_STORE = Object.freeze({ mode, MAX, packs, products, get, getPack, owns, migrate, transaction });
})();
