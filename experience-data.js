/*
 * 固定关卡经验账本。普通虫提供经验，精英与虫王提供轮盘奖励。
 * XP 加成在关卡中提前释放储备，不改变本关普通虫经验总额；无尽不使用账本。
 * 先加载本文件，再加载 progression.js。
 */
(() => {
  'use strict';
  const CHOICES = 30, LEVEL_CAP = CHOICES + 1, CURVE_LEVELS = 40;
  // 少发放经验并提高开局门槛；最大余数法生成基准，再扣除轮盘替代的经验。
  const STAGE_BUDGET = 10000, FIRST_COST = 180, LINEAR_GROWTH = 4;
  const sumIndices = CHOICES * (CHOICES - 1) / 2;
  const sumSquares = CHOICES * (CHOICES - 1) * (2 * CHOICES - 1) / 6;
  const quadraticGrowth = (STAGE_BUDGET - CHOICES * FIRST_COST - LINEAR_GROWTH * sumIndices) / sumSquares;
  const exactCosts = Array.from({ length: CHOICES }, (_, n) => FIRST_COST + LINEAR_GROWTH * n + quadraticGrowth * n * n);
  const roundedCosts = exactCosts.map(Math.floor);
  const roundingRemainder = STAGE_BUDGET - roundedCosts.reduce((total, value) => total + value, 0);
  const roundingOrder = exactCosts.map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  for (let index = 0; index < roundingRemainder; index++) roundedCosts[roundingOrder[index].index]++;
  const costs = Object.freeze(roundedCosts);
  const need = level => {
    const n = Math.max(0, Math.floor(Number(level) || 1) - 1);
    if (n < CHOICES) return costs[n];
    // 无尽从 LV.31 接续同一条曲线，到 LV.40 后接回原来的后期成本。
    if (n < CURVE_LEVELS) return Math.round(FIRST_COST + LINEAR_GROWTH * n + quadraticGrowth * n * n);
    return Math.round(10 + 7 * n + .35 * n * n);
  };
  function budget(choices = CHOICES) {
    const count = Number.isFinite(choices) ? Math.max(0, Math.floor(choices)) : CHOICES;
    let total = 0;
    for (let level = 1; level <= count; level++) total += need(level);
    return total;
  }
  const TOTAL = budget();
  function roster(stage) {
    const normal = stage.normalCount ?? 398, fast = stage.fastCount, elite = stage.eliteCount ?? 4 + stage.id * 2, boss = stage.bossCount ?? stage.id;
    if (![normal, fast, elite, boss].every(n => Number.isInteger(n) && n >= 0) || fast > normal || normal + elite + boss <= 0) throw new RangeError('Invalid stage experience roster');
    const groups = [];
    for (let index = 0; index < normal; index++) groups.push(Math.floor((index + 1) * fast / normal) > Math.floor(index * fast / normal) ? 'fast' : 'slow');
    for (let index = 0; index < elite; index++) groups.push('elite');
    for (let index = 0; index < boss; index++) groups.push('boss');
    const weights = {
      slow: stage.slow.xp, fast: stage.fast.xp,
      elite: stage.elite?.xp ?? stage.slow.xp * 4,
      boss: stage.fast.xp * 8
    };
    if (!Object.values(weights).every(n => Number.isFinite(n) && n > 0)) throw new RangeError('Invalid stage experience weights');
    return { groups, weights, counts: { slow: normal - fast, fast, elite, boss } };
  }
  function assign(stage) {
    const { groups, weights } = roster(stage);
    const totalWeight = groups.reduce((sum, type) => sum + weights[type], 0);
    const exact = groups.map(type => TOTAL * weights[type] / totalWeight);
    const result = exact.map(Math.floor);
    let remainder = TOTAL - result.reduce((sum, xp) => sum + xp, 0);
    // Largest remainders preserve relative enemy weights without fractional XP.
    // Equal remainders use enemy index, so assignment is deterministic across reloads.
    const order = exact.map((xp, index) => ({ index, fraction: xp - Math.floor(xp) }))
      .sort((a, b) => b.fraction - a.fraction || a.index - b.index);
    for (let index = 0; index < remainder; index++) result[order[index].index]++;
    return Object.freeze(result.map((value, index) => groups[index] === 'elite' || groups[index] === 'boss' ? 0 : Math.floor(value * (stage.id <= 2 ? .55 : 1))));
  }
  function summary(stage) {
    const { groups, counts } = roster(stage), values = stage.xpRewards || assign(stage);
    const typical = {}, ranges = {}, totals = {};
    for (const type of ['slow', 'fast', 'elite', 'boss']) {
      const group = values.filter((xp, index) => groups[index] === type);
      const sum = group.reduce((total, xp) => total + xp, 0);
      totals[type] = sum;
      typical[type] = group.length ? Math.round(sum / group.length) : 0;
      ranges[type] = Object.freeze({ min: group.length ? Math.min(...group) : 0, max: group.length ? Math.max(...group) : 0 });
    }
    return Object.freeze({ budget: values.reduce((sum, value) => sum + value, 0), choices: costs.filter((_, index) => budget(index + 1) <= values.reduce((sum, value) => sum + value, 0)).length, levelCap: LEVEL_CAP,
      typical: Object.freeze(typical), ranges: Object.freeze(ranges), totals: Object.freeze(totals), counts: Object.freeze(counts) });
  }
  function create(stage) {
    const total = stage?.experience?.budget ?? TOTAL;
    let issued = 0, collected = 0, baseGranted = 0, carry = 0, settled = false;
    const credited = new Set(), claimed = new Set();
    const amount = value => Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
    const hasKey = key => key !== undefined && key !== null;
    const ledger = {
      get budget() { return total; }, get issued() { return issued; }, get collected() { return collected; },
      get baseGranted() { return baseGranted; }, get carry() { return carry; }, get settled() { return settled; },
      grant(raw, multiplier = 1, key) {
        if (settled || hasKey(key) && credited.has(key)) return 0;
        if (hasKey(key)) credited.add(key);
        const base = Math.min(amount(raw), total - baseGranted);
        if (!base) return 0;
        baseGranted += base;
        const rate = Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1;
        const exact = base * rate + carry;
        const whole = Math.floor(exact + 1e-9);
        carry = Math.max(0, exact - whole);
        const value = Math.min(whole, total - issued);
        issued += value;
        if (issued === total) carry = 0;
        return value;
      },
      collect(raw, key) {
        if (hasKey(key) && claimed.has(key)) return 0;
        if (hasKey(key)) claimed.add(key);
        const value = Math.min(amount(raw), issued - collected);
        collected += value;
        return value;
      },
      finish() {
        const value = total - issued;
        issued = total; baseGranted = total; carry = 0; settled = true;
        return value;
      },
      snapshot() { return Object.freeze({ budget: total, issued, collected, baseGranted, carry, settled, unissued: total - issued, uncollected: issued - collected }); }
    };
    return Object.freeze(ledger);
  }
  window.ORCHARD_EXPERIENCE = Object.freeze({ choices: CHOICES, levelCap: LEVEL_CAP, costs, need, budget, assign, summary, create });
})();
