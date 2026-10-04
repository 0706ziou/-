/* 关卡构筑：攻击 / 属性各 4 槽、每种 5 级；无尽模式开放全部槽与超限等级。
 * init 仅用于新局；setMode 保留原 build。choose 已经应用属性并计入 upgrades。
 * tick 只在战斗实际推进时调用。targets 必须只返回可见、存活、可命中的敌人。
 */
(() => {
  'use strict';
  const limits = Object.freeze({ attackSlots: 4, attributeSlots: 4, maxLevel: 5, attackChoices: 20, attributeChoices: 20, totalChoices: 40 });
  const endlessLimits = Object.freeze({ attackSlots: 16, attributeSlots: 16, maxLevel: Infinity, attackChoices: Infinity, attributeChoices: Infinity, totalChoices: Infinity });
  const finite = (n, fallback = 0) => Number.isFinite(n) ? n : fallback;
  const value = (p, key, fallback = 0) => finite(p[key], fallback);
  const quality = m => Math.max(1, Math.min(2, finite(m, 1)));
  const number = n => String(Math.round(n * 100) / 100);
  const percent = n => number(n * 100) + '%';
  const base = (p, key) => finite(p.baseStats?.[key], p.build?.base?.[key] ?? value(p, key));
  const outside = (p, key) => Math.max(0, finite(p.relicBonuses?.[key]));
  const isEndless = p => p?.build?.mode === 'endless';
  const getLimits = p => isEndless(p) ? endlessLimits : limits;
  // Beyond Lv.5, every choice still changes a real statistic. Declining marginal
  // gains keep long runs playable without locking another level behind a hard cap.
  const gainScale = (p, id, rank = (p?.build?.levels?.[id] || 0) + 1) => isEndless(p) && rank > 5 ? 1 / Math.sqrt(1 + (rank - 5) / 8) : 1;
  // A capped build choice cannot erase a stronger hero / relic bonus already on the player.
  const add = (p, key, amount, cap = Infinity, fallback = 0) => { const before = value(p, key, fallback); p[key] = Math.max(before, Math.min(cap, before + amount)); };
  const pictures = Object.freeze({
    damage: 'assets/skills/damage.svg',
    rate: 'assets/skills/rate.svg',
    shots: 'assets/skills/shots.svg',
    crit: 'assets/skills/crit.svg',
    critDamage: 'assets/skills/critDamage.svg',
    pierce: 'assets/skills/pierce.svg',
    chain: 'assets/skills/chain.svg',
    leafstorm: 'assets/skills/leafstorm.svg',
    fireball: 'assets/skills/fireball.svg',
    poison: 'assets/skills/poison.svg',
    pulse: 'assets/skills/pulse.svg',
    bees: 'assets/skills/bees.svg',
    boomerang: 'assets/skills/boomerang.svg',
    frostburst: 'assets/skills/frostburst.svg',
    solar: 'assets/skills/solar.svg',
    ricochet: 'assets/skills/ricochet.svg',
    speed: 'assets/skills/speed.svg',
    hp: 'assets/skills/hp.svg',
    pickup: 'assets/skills/pickup.svg',
    defense: 'assets/skills/defense.svg',
    regen: 'assets/skills/regen.svg',
    skillCooldown: 'assets/skills/skillCooldown.svg',
    xp: 'assets/skills/xp.svg',
    range: 'assets/skills/range.svg',
    projectileSpeed: 'assets/skills/projectileSpeed.svg',
    lifeSteal: 'assets/skills/lifeSteal.svg',
    dodge: 'assets/skills/dodge.svg',
    thorns: 'assets/skills/thorns.svg',
    standPower: 'assets/skills/standPower.svg',
    killHeal: 'assets/skills/killHeal.svg',
    skillPower: 'assets/skills/skillPower.svg',
    magnet: 'assets/skills/magnet.svg',
    skyweb: 'assets/skills/skyweb.svg',
    leafcyclone: 'assets/skills/leafcyclone.svg',
    sunheart: 'assets/skills/sunheart.svg',
    greenhouse: 'assets/skills/greenhouse.svg',
    earthguard: 'assets/skills/earthguard.svg',
    queenbees: 'assets/skills/queenbees.svg',
    everturn: 'assets/skills/everturn.svg',
    icegarden: 'assets/skills/icegarden.svg'
  });
  const recipes = Object.freeze([
    ['skyweb', '天穹雷网', 'chain', 'range', '⚡', '#ffe998', '连锁 6 个目标，每个造成 250% 伤害，链距 260，冷却 3.8 秒。'],
    ['leafcyclone', '风暴叶轮', 'leafstorm', 'speed', '🍃', '#abef9b', '每 0.9 秒切割 210 范围内最多 12 个目标，造成 115% 伤害。'],
    ['sunheart', '熔日果核', 'fireball', 'hp', '☀', '#ffc282', '每 4.2 秒向最近目标投放 210 半径爆炸，最多 14 个目标，各受 480% 伤害。'],
    ['greenhouse', '翠毒温室', 'poison', 'regen', '♧', '#b5e877', '每 5.5 秒布置 280 范围毒域：每 0.6 秒造成 52% 伤害，持续 4 秒，减速 15%。'],
    ['earthguard', '大地守望', 'pulse', 'defense', '◉', '#ead09d', '每 5.2 秒冲击 300 范围内最多 12 个目标，造成 380% 伤害，并回复最大生命 2.5%。'],
    ['queenbees', '蜂后军团', 'bees', 'pickup', '🐝', '#ffe3a0', '每 2.6 秒派出 5 次追踪蜂击，每次造成 120% 伤害，索敌 700。'],
    ['everturn', '无尽回旋', 'boomerang', 'projectileSpeed', '↬', '#abddec', '每 2.4 秒发出回旋刃，扇形 700 范围内最多 10 个目标，各受 210% 伤害。'],
    ['icegarden', '极寒果域', 'frostburst', 'skillCooldown', '❄', '#bce9ff', '每 5.8 秒冻结 320 范围内最多 14 个目标，造成 190% 伤害；减速 45%（Boss 20%）3.2 秒。']
  ].map(([id, name, attack, attribute, icon, color, description]) => Object.freeze({ id, name, attack, attribute, icon, color,
    image: pictures[id], description: description + ' 继承攻击词条品质：关卡额外伤害最多 +60%；无尽中继续升级原攻击会进一步增强超级伤害。枝脉共鸣另计。' })));
  const superBasePower = Object.freeze({ skyweb: 2.5, leafcyclone: 1.15, sunheart: 4.8, greenhouse: .52, earthguard: 3.8, queenbees: 1.2, everturn: 2.1, icegarden: 1.9 });
  const superCadence = Object.freeze({ skyweb: [3.8, 1], leafcyclone: [.9, 1], sunheart: [4.2, 1], greenhouse: [5.5, 7], earthguard: [5.2, 1], queenbees: [2.6, 5], everturn: [2.4, 1], icegarden: [5.8, 1] });
  const defs = [];
  function stat(id, category, icon, name, describe, apply) {
    const primaryChanges = (p, q) => {
      const copy = { ...p }; apply(copy, q);
      return Object.keys(copy).some(key => typeof copy[key] === 'number' && Math.abs(copy[key] - finite(p[key])) > 1e-9);
    };
    defs.push({ id, category, icon, name, maxLevel: limits.maxLevel,
      describe: (m, p) => {
        const q = quality(m) * gainScale(p, id);
        if (primaryChanges(p, q)) return describe(q, p) + (isEndless(p) && (p.build.levels[id] || 0) >= 5 ? ' · 超限收益递减' : '');
        return category === 'attack' ? '主属性已达安全值；转为开局伤害 +' + percent(.025 * q) : '主属性已达安全值；转为生命上限 +' + number(5 * q) + '，并恢复同量生命';
      },
      apply: (p, m, rank) => {
        const q = quality(m) * gainScale(p, id, rank);
        if (primaryChanges(p, q)) apply(p, q);
        else if (category === 'attack') add(p, 'damage', base(p, 'damage') * .025 * q);
        else { add(p, 'maxHp', 5 * q); p.hp = Math.min(p.maxHp, value(p, 'hp') + 5 * q); }
      } });
  }
  const modeCap = (p, stage, endless) => isEndless(p) ? endless : stage;
  const capText = (p, stage, endless) => isEndless(p) ? endless : stage;
  stat('damage', 'attack', '✹', '饱满种子', m => '基础伤害 +' + percent(.12 * m) + '（按开局伤害相加）', (p, m) => add(p, 'damage', base(p, 'damage') * .12 * m));
  stat('rate', 'attack', '»', '连发嫩芽', m => '基础射速 +' + percent(.08 * m) + '（按开局射速相加）', (p, m) => add(p, 'rate', base(p, 'rate') * .08 * m));
  stat('shots', 'attack', '⋮', '一果多籽', m => '每轮额外 +1 籽，齐射总伤害 +' + percent(.18 * m) + '；总伤害分摊到各籽', (p, m) => { add(p, 'shots', 1); add(p, 'volleyBonus', .18 * m); });
  stat('crit', 'attack', '✦', '星芒果籽', (m, p) => '暴击率 +' + percent(.03 * m) + '，构筑最高 ' + capText(p, '40%', '65%') + '，饰品另加', (p, m) => add(p, 'critChance', .03 * m, Math.min(.85, modeCap(p, .4, .65) + outside(p, 'critChance'))));
  stat('critDamage', 'attack', '✧', '爆汁果心', (m, p) => '暴击伤害 +' + percent(.13 * m) + (isEndless(p) ? '，无尽可持续提升' : '，构筑最高 280%，饰品另加') + '；先拥有暴击率才可选择', (p, m) => add(p, 'critMultiplier', .13 * m, modeCap(p, 2.8, Infinity) + outside(p, 'critMultiplier'), 1.5));
  stat('pierce', 'attack', '➶', '尖叶穿籽', (m, p) => '平均穿透 +' + number(.4 * m) + '，构筑最高 ' + capText(p, '4', '8') + '，饰品另加；小数按概率生效', (p, m) => add(p, 'pierce', .4 * m, modeCap(p, 4, 8) + outside(p, 'pierce')));
  stat('speed', 'attribute', '〰', '轻盈叶步', (m, p) => '开局移速 +' + percent(.04 * m) + '，构筑最高开局的 ' + capText(p, '140%', '190%') + '，饰品另加', (p, m) => add(p, 'speed', base(p, 'speed') * .04 * m, base(p, 'speed') * modeCap(p, 1.4, 1.9) + outside(p, 'speed')));
  stat('hp', 'attribute', '♥', '丰沛果汁', m => '生命上限 +' + number(14 * m) + '，同时恢复新增上限 + ' + number(7 * m) + ' 生命', (p, m) => { add(p, 'maxHp', 14 * m); p.hp = Math.min(p.maxHp, value(p, 'hp') + 21 * m); });
  stat('pickup', 'attribute', '◎', '绿叶引力', (m, p) => '开局拾取范围 +' + percent(.2 * m) + '，构筑最高 ' + capText(p, '开局的 300%', '900 距离') + '，饰品另加', (p, m) => add(p, 'pickup', base(p, 'pickup') * .2 * m, modeCap(p, base(p, 'pickup') * 3, Math.max(900, base(p, 'pickup') * 3)) + outside(p, 'pickup')));
  stat('defense', 'attribute', '▣', '叠叶护身', (m, p) => '固定减伤 +' + number(.5 * m) + '，本构筑最多 +' + capText(p, '5', '20') + '；受伤至少 1', (p, m) => { const before = value(p, 'defenseBonus'); add(p, 'defenseBonus', .5 * m, modeCap(p, 5, 20)); add(p, 'defense', p.defenseBonus - before); });
  stat('regen', 'attribute', '✚', '晨露滋养', (m, p) => '脱战回复 +' + number(.1 * m) + ' 生命/秒，最多额外 +' + capText(p, '1', '10') + '；未受伤 6 秒后生效', (p, m) => { const before = value(p, 'regenBonus'); add(p, 'regenBonus', .1 * m, modeCap(p, 1, 10)); add(p, 'regen', p.regenBonus - before); });
  stat('skillCooldown', 'attribute', '◷', '四季轮转', (m, p) => '英雄冷却减少开局值的 ' + percent(.04 * m) + '，最多缩短 ' + capText(p, '40%', '75%（至少 0.12 秒）'), (p, m) => { const initial = value(p, 'baseSkillCooldown', p.build.base.skillCooldown), before = value(p, 'skillCooldown', 1); p.skillCooldown = Math.min(before, Math.max(modeCap(p, initial * .6, Math.max(.12, initial * .25)), before - initial * .04 * m)); });
  stat('xp', 'attribute', '✧', '果园学识', (m, p) => (isEndless(p) ? '经验收益增加开局倍率的 ' : '经验提前释放增加开局倍率的 ') + percent(.05 * m) + (isEndless(p) ? '，无尽可持续提升' : '；加快升级，关卡总成长次数固定'), (p, m) => { const before = value(p, 'buildXpBonus'); add(p, 'buildXpBonus', .05 * m, modeCap(p, .5, Infinity)); add(p, 'xpMult', p.build.base.xpMult * (p.buildXpBonus - before), Infinity, 1); });
  stat('range', 'attribute', '⌖', '远枝视野', (m, p) => '自动射击索敌 +' + number(28 * m) + ' 距离，构筑最高 ' + capText(p, '900', '1100') + '，饰品另加', (p, m) => add(p, 'weaponRange', 28 * m, modeCap(p, 900, 1100) + outside(p, 'weaponRange'), 540));
  stat('projectileSpeed', 'attribute', '➤', '顺风果籽', (m, p) => '基础子弹速度 +' + percent(.08 * m) + '，构筑最高 ' + capText(p, '180%', '260%') + '，饰品另加', (p, m) => add(p, 'projectileSpeedMult', .08 * m, modeCap(p, 1.8, 2.6) + outside(p, 'projectileSpeedMult'), 1));
  stat('lifeSteal', 'attribute', '♦', '甘露汲取', (m, p) => '有效伤害吸血 +' + percent(.004 * m) + '，构筑最高 ' + capText(p, '4%', '8%') + '，饰品另加；每秒回复不超过最大生命 3%', (p, m) => add(p, 'lifeSteal', .004 * m, modeCap(p, .04, .08) + outside(p, 'lifeSteal')));
  stat('dodge', 'attribute', '◇', '蝶影闪避', (m, p) => '接触伤害闪避率 +' + percent(.02 * m) + '，构筑最高 ' + capText(p, '20%', '45%') + '，总闪避安全值 60%', (p, m) => add(p, 'dodge', .02 * m, Math.min(.6, modeCap(p, .2, .45) + outside(p, 'dodge'))));
  stat('thorns', 'attribute', '♠', '荆棘果壳', (m, p) => '受到实际接触生命伤害时反击当前伤害的 ' + percent(.16 * m) + (isEndless(p) ? '，无尽可持续提升' : '，构筑最高 160%，饰品另加') + '；闪避和完全护盾不触发', (p, m) => add(p, 'thorns', .16 * m, modeCap(p, 1.6, Infinity) + outside(p, 'thorns')));
  stat('standPower', 'attribute', '☀', '扎根果心', (m, p) => '站定伤害倍率额外 +' + percent(.05 * m) + (isEndless(p) ? '，无尽可持续提升' : '，构筑最高 +50%，饰品另加') + '（仅站定生效）', (p, m) => add(p, 'standPower', .05 * m, modeCap(p, .5, Infinity) + outside(p, 'standPower')));
  stat('killHeal', 'attribute', '❧', '丰收回甘', (m, p) => '每击杀一只敌人回复 ' + number(.15 * m) + ' 生命，构筑最高 ' + capText(p, '1.5', '6') + '，饰品另加；每秒不超过最大生命 1.5%', (p, m) => add(p, 'killHeal', .15 * m, modeCap(p, 1.5, 6) + outside(p, 'killHeal')));
  stat('skillPower', 'attribute', '✺', '枝脉共鸣', (m, p) => '英雄、饰品和构筑技能伤害 +' + percent(.06 * m) + (isEndless(p) ? '，无尽可持续提升' : '，构筑最高 160%，饰品另加'), (p, m) => add(p, 'skillPower', .06 * m, modeCap(p, 1.6, Infinity) + outside(p, 'skillPower'), 1));
  stat('magnet', 'attribute', '∩', '柔枝牵引', (m, p) => '已进入拾取圈的经验飞向玩家速度 +' + percent(.15 * m) + '，构筑最高 ' + capText(p, '250%', '500%') + '，饰品另加', (p, m) => add(p, 'magnetMult', .15 * m, modeCap(p, 2.5, 5) + outside(p, 'magnetMult'), 1));
  const attacks = Object.freeze({
    chain: { icon: 'ϟ', name: '雷芽连锁', color: '#ffe794', kind: 'chain', cooldown: 4.8, radius: 480, chainRadius: 160, targets: 3, power: .75 },
    leafstorm: { icon: '🍃', name: '旋叶切割', color: '#a9e68e', kind: 'ring', cooldown: 1.6, radius: 112, targets: 6, power: .42 },
    fireball: { icon: '☄', name: '烈果火球', color: '#ffb46e', kind: 'blast', cooldown: 5.8, radius: 520, blastRadius: 110, targets: 8, power: 1.65 },
    poison: { icon: '♧', name: '青藤毒雾', color: '#9edd76', kind: 'poison', cooldown: 7, radius: 460, blastRadius: 135, targets: 8, power: .22, duration: 3 },
    pulse: { icon: '◉', name: '根系震荡', color: '#d9c094', kind: 'ring', cooldown: 4.8, radius: 175, targets: 8, power: .95 },
    bees: { icon: '🐝', name: '勤蜂护卫', color: '#ffe29a', kind: 'bees', cooldown: 3, radius: 580, targets: 2, power: .55 },
    boomerang: { icon: '↬', name: '回旋叶刃', color: '#8cddc4', kind: 'cone', cooldown: 3.8, radius: 510, targets: 4, power: .75 },
    frostburst: { icon: '❄', name: '冰露绽放', color: '#b5e1ff', kind: 'frost', cooldown: 7, radius: 160, targets: 8, power: .45, slow: .30, bossSlow: .15, duration: 2 },
    solar: { icon: '☀', name: '向阳蓄光', color: '#ffdfa0', kind: 'solar', cooldown: 3.8, radius: 430, blastRadius: 90, targets: 5, power: 1.25 },
    ricochet: { icon: '⌁', name: '弹跳果核', color: '#dcc19a', kind: 'chain', cooldown: 3.7, radius: 540, chainRadius: 200, targets: 4, power: .5 }
  });
  function evolutionPower(recipe, rank, totalPower) {
    const source = attacks[recipe.attack], [cooldown, hits] = superCadence[recipe.id];
    const inherited = superBasePower[recipe.id] * (1 + .12 * Math.max(0, totalPower - 5));
    const sourceHits = source.kind === 'bees' ? source.targets : source.kind === 'poison' ? Math.ceil(source.duration / .6 - 1e-9) : 1;
    const sourceCooldown = source.cooldown * Math.max(.62, 1 - (rank - 1) * .065);
    const sourceDps = source.power * (1 + .35 * (totalPower - 1)) * sourceHits / sourceCooldown;
    // A late endless fusion must not punish someone who first invested dozens of
    // ranks in its source attack. Compare complete cycles, including poison and bees.
    return Math.max(inherited, sourceDps * cooldown / hits * 1.05);
  }
  const attackHint = a => a.kind === 'solar' ? '站定后释放光束' : a.kind === 'poison' ? '布置持续毒雾' : a.kind === 'frost' ? '范围伤害并减速' : a.kind === 'blast' ? '远程小范围爆炸' : a.kind === 'cone' ? '对前方扇形虫群攻击' : a.kind === 'chain' ? '连续跳跃攻击' : a.kind === 'bees' ? '重复追击最近目标' : '攻击身边虫群';
  for (const [id, a] of Object.entries(attacks)) {
    Object.freeze(a);
    defs.push({ id, category: 'attack', icon: a.icon, name: a.name, maxLevel: 5, color: a.color,
      describe: (m, p) => {
        const b = ensure(p), level = (b.levels[id] || 0) + 1, power = (b.powers[id] || 0) + quality(m) * gainScale(p, id);
        const evolved = recipes.find(r => r.attack === id && b.superSkills.includes(r.id));
        if (evolved) return '强化 ' + evolved.name + ' · 下一级超级伤害 ' + percent(evolutionPower(evolved, level, power)) + '（继续保留合成；超限收益递减）';
        const scaled = a.power * (1 + .35 * (power - 1));
        return attackHint(a) + ' · 伤害 ' + percent(scaled) + ' · 冷却 ' + number(a.cooldown * Math.max(.62, 1 - (level - 1) * .065)) + ' 秒' + (a.kind === 'poison' ? '（每 0.6 秒一次，持续 3 秒）' : '');
      }, apply: () => {} });
  }
  for (const def of defs) {
    def.image = pictures[def.id];
    def.available = p => available(p, def);
    const pair = recipes.find(r => r.attack === def.id || r.attribute === def.id);
    def.recipe = pair?.id || null;
    Object.freeze(def);
  }
  Object.freeze(defs);
  const get = id => defs.find(d => d.id === id) || null;
  function init(p) {
    for (const [key, initial] of Object.entries({ weaponRange: 540, projectileSpeedMult: 1, lifeSteal: 0, dodge: 0, thorns: 0, standPower: 0, killHeal: 0, skillPower: 1, magnetMult: 1, buildXpBonus: 0 })) {
      if (!Number.isFinite(p[key])) p[key] = initial;
    }
    p.build = { mode: 'stage', levels: {}, powers: {}, attackSlots: [], attributeSlots: [], attackChoices: 0, attributeChoices: 0, superSkills: [], timers: {}, zones: [],
      base: Object.freeze({ damage: value(p, 'damage'), rate: value(p, 'rate'), shots: value(p, 'shots', 1), speed: value(p, 'speed'), pickup: value(p, 'pickup'),
        skillCooldown: value(p, 'skillCooldown', 1), xpMult: value(p, 'xpMult', 1) }) };
    p.upgrades ??= {};
    return p.build;
  }
  function ensure(p) { return p.build || init(p); }
  function setMode(p, mode) {
    const b = ensure(p); b.mode = mode === 'endless' ? 'endless' : 'stage';
    return getLimits(p);
  }
  function available(p, defOrId) {
    const d = typeof defOrId === 'string' ? get(defOrId) : get(defOrId?.id);
    if (!d || !p) return false;
    if (d.id === 'critDamage' && value(p, 'critChance') <= 0) return false;
    const b = ensure(p), slots = b[d.category + 'Slots'], currentLimits = getLimits(p);
    if ((b.levels[d.id] || 0) >= currentLimits.maxLevel || b[d.category + 'Choices'] >= currentLimits[d.category + 'Choices'] ||
      (!slots.includes(d.id) && slots.length >= currentLimits[d.category + 'Slots'])) return false;
    // A safe numerical cap provides a named overflow gain, so all eight occupied
    // stage slots remain trainable to Lv.5 and exactly forty choices are possible.
    return true;
  }
  function pool(p) { return defs.filter(d => available(p, d)); }
  function choose(p, id, m = 1) {
    const d = get(id);
    if (!d || !available(p, d)) return { applied: false, def: d, level: p?.build?.levels?.[id] || 0, newSuper: [] };
    const b = ensure(p), q = quality(m), slots = b[d.category + 'Slots'];
    if (!slots.includes(id)) slots.push(id);
    b.levels[id] = (b.levels[id] || 0) + 1; b.powers[id] = (b.powers[id] || 0) + q * gainScale(p, id, b.levels[id]); b[d.category + 'Choices']++;
    d.apply(p, q, b.levels[id]); p.upgrades[id] = (p.upgrades[id] || 0) + 1;
    const newSuper = [];
    for (const r of recipes) {
      if (b.levels[r.attack] >= limits.maxLevel && b.levels[r.attribute] >= limits.maxLevel && !b.superSkills.includes(r.id)) {
        b.superSkills.push(r.id); b.timers[r.id] = 0; delete b.timers[r.attack]; newSuper.push(r);
      }
    }
    noteChoice(p, id);
    return { applied: true, def: d, level: b.levels[id], newSuper };
  }
  function summary(p) {
    const b = ensure(p), currentLimits = getLimits(p), slots = category => b[category + 'Slots'].map(id => ({ ...get(id), maxLevel: currentLimits.maxLevel, level: b.levels[id], power: b.powers[id] }));
    return { mode: b.mode || 'stage', attack: slots('attack'), attribute: slots('attribute'), attackChoices: b.attackChoices, attributeChoices: b.attributeChoices,
      totalChoices: b.attackChoices + b.attributeChoices, supers: b.superSkills.map(id => recipes.find(r => r.id === id)),
      exhausted: pool(p).length === 0, limits: currentLimits, recipes: recipes.map(r => ({ ...r, attackLevel: b.levels[r.attack] || 0, attributeLevel: b.levels[r.attribute] || 0, crafted: b.superSkills.includes(r.id) })) };
  }
  function tick(p, dt, ctx = {}) {
    if (!p?.build || !Number.isFinite(dt) || dt <= 0 || typeof ctx.targets !== 'function' || typeof ctx.hit !== 'function') return;
    const b = p.build, elapsed = finite(ctx.elapsed), damage = Math.max(0, value(p, 'damage')) * value(p, 'skillPower', 1);
    const targets = (x, y, radius) => (ctx.targets(x, y, radius) || []).filter(e => e.hp > 0);
    const hit = (enemy, power, color) => { if (enemy?.hp > 0) ctx.hit(enemy, damage * Math.max(0, power), color); };
    const effect = options => ctx.effect?.({ life: .4, max: .4, ...options });
    const slow = (enemy, amount, duration) => {
      const existing = enemy.slowUntil > elapsed ? finite(enemy.slowAmount) : 0;
      if (existing > amount) return;
      enemy.slowUntil = existing === amount ? Math.max(enemy.slowUntil || 0, elapsed + duration) : elapsed + duration;
      enemy.slowAmount = amount;
    };
    // Timed poison fields use their own fixed budget and cannot accumulate unlimited objects.
    for (const zone of b.zones) {
      const duration = zone.duration ?? zone.life, age = finite(zone.age), end = Math.min(duration, age + dt);
      let pulses = 0;
      // A field expires at its end timestamp: a 3-second field has five pulses,
      // not a sixth pulse at 3.0 seconds. Small and large frames use the same budget.
      while (finite(zone.nextPulse) <= end + 1e-9 && finite(zone.nextPulse) < duration - 1e-9 && pulses++ < 8) {
        for (const enemy of targets(zone.x, zone.y, zone.radius).slice(0, zone.targets)) {
          hit(enemy, zone.power, zone.color);
          if (zone.slow) slow(enemy, enemy.boss ? zone.slow / 2 : zone.slow, .8);
        }
        zone.nextPulse = finite(zone.nextPulse) + .6;
      }
      zone.age = end; zone.life = duration - end > 1e-9 ? duration - end : 0;
    }
    b.zones = b.zones.filter(zone => zone.life > 0);
    const casts = [];
    for (const id of b.attackSlots) {
      const a = attacks[id];
      if (!a || recipes.some(r => r.attack === id && b.superSkills.includes(r.id))) continue;
      const level = b.levels[id], power = a.power * (1 + .35 * ((b.powers[id] || level) - 1));
      casts.push({ id, ...a, level, power, cooldown: a.cooldown * Math.max(.62, 1 - (level - 1) * .065), radius: Math.min(a.kind === 'ring' || a.kind === 'frost' ? 360 : 900, a.radius + (level - 1) * (a.kind === 'ring' || a.kind === 'frost' ? 12 : 14)) });
    }
    const superSpecs = {
      skyweb: { kind: 'chain', cooldown: 3.8, radius: 700, chainRadius: 260, targets: 6, power: 2.5 },
      leafcyclone: { kind: 'ring', cooldown: .9, radius: 210, targets: 12, power: 1.15 },
      sunheart: { kind: 'blast', cooldown: 4.2, radius: 650, blastRadius: 210, targets: 14, power: 4.8 },
      greenhouse: { kind: 'poison', cooldown: 5.5, radius: 1, blastRadius: 280, targets: 14, power: .52, duration: 4, slow: .15, self: true },
      earthguard: { kind: 'ring', cooldown: 5.2, radius: 300, targets: 12, power: 3.8, heal: .025 },
      queenbees: { kind: 'bees', cooldown: 2.6, radius: 700, targets: 5, power: 1.2 },
      everturn: { kind: 'cone', cooldown: 2.4, radius: 700, targets: 10, power: 2.1 },
      icegarden: { kind: 'frost', cooldown: 5.8, radius: 320, targets: 14, power: 1.9, slow: .45, bossSlow: .2, duration: 3.2 }
    };
    for (const id of b.superSkills) {
      const r = recipes.find(r => r.id === id), spec = superSpecs[id];
      casts.push({ id, ...spec, power: evolutionPower(r, b.levels[r.attack] || 5, b.powers[r.attack] || 5), color: r.color });
    }
    for (const a of casts) {
      b.timers[a.id] = Math.max(0, finite(b.timers[a.id]) - dt);
      if (b.timers[a.id] > 0 || (a.kind === 'solar' && !ctx.standing)) continue;
      const initial = targets(p.x, p.y, a.radius);
      if (!initial.length && !a.self && !a.heal) continue;
      const color = a.color;
      if (a.kind === 'chain') {
        const used = new Set(), points = [{ x: p.x, y: p.y }]; let target = initial[0];
        for (let i = 0; target && i < a.targets; i++) {
          used.add(target); hit(target, a.power, color); points.push({ x: target.x, y: target.y });
          target = targets(target.x, target.y, a.chainRadius).find(e => !used.has(e));
        }
        effect({ key: a.id, type: 'chain', points, color, life: .3, max: .3 });
      } else if (a.kind === 'bees') {
        for (let i = 0; i < a.targets; i++) { const target = targets(p.x, p.y, a.radius)[0]; if (!target) break; hit(target, a.power, color); effect({ key: a.id, type: 'bee', x: p.x, y: p.y, tx: target.x, ty: target.y, color }); }
      } else if (a.kind === 'cone') {
        const first = initial[0], dx = first.x - p.x, dy = first.y - p.y, length = Math.hypot(dx, dy) || 1;
        const sliced = initial.filter(e => { const ex = e.x - p.x, ey = e.y - p.y; return (ex * dx + ey * dy) / Math.max(1, Math.hypot(ex, ey) * length) >= .67; }).slice(0, a.targets);
        sliced.forEach(e => hit(e, a.power, color)); effect({ key: a.id, type: 'chain', points: [{ x: p.x, y: p.y }, ...sliced.map(e => ({ x: e.x, y: e.y })), { x: p.x, y: p.y }], color });
      } else if (a.kind === 'poison') {
        const center = a.self ? p : initial[0];
        if (b.zones.length >= 12) b.zones.shift();
        b.zones.push({ x: center.x, y: center.y, radius: a.blastRadius, targets: a.targets, power: a.power, color, life: a.duration, duration: a.duration, age: 0, nextPulse: 0, slow: a.slow || 0 });
        effect({ key: a.id, type: 'ring', x: center.x, y: center.y, radius: a.blastRadius, color, life: a.duration, max: a.duration });
      } else if (a.kind === 'blast' || a.kind === 'solar') {
        const center = initial[0];
        targets(center.x, center.y, a.blastRadius).slice(0, a.targets).forEach(e => hit(e, a.power, color));
        effect({ key: a.id, type: 'line', x: p.x, y: p.y, tx: center.x, ty: center.y, color });
        effect({ key: a.id, type: 'ring', x: center.x, y: center.y, radius: a.blastRadius, color });
      } else {
        for (const enemy of initial.slice(0, a.targets)) {
          hit(enemy, a.power, color);
          if (a.kind === 'frost') slow(enemy, enemy.boss ? a.bossSlow : a.slow, a.duration);
        }
        if (a.heal) ctx.heal?.(Math.max(0, value(p, 'maxHp')) * a.heal);
        effect({ key: a.id, type: 'ring', x: p.x, y: p.y, radius: a.radius, color });
      }
      b.timers[a.id] = a.cooldown;
    }
  }
  // Recipe goals only guide offers. They never spend XP, add slots, or grant skills.
  function recipeState(p, recipeOrId) {
    const r = recipes.find(item => item.id === (typeof recipeOrId === 'string' ? recipeOrId : recipeOrId?.id));
    if (!r || !p) return null;
    const b = ensure(p), attackLevel = b.levels[r.attack] || 0, attributeLevel = b.levels[r.attribute] || 0;
    const crafted = b.superSkills.includes(r.id);
    const remaining = Math.max(0, 5 - attackLevel) + Math.max(0, 5 - attributeLevel);
    const blockedSlot = [[r.attack, 'attack'], [r.attribute, 'attribute']].find(([id, category]) => !b[category + 'Slots'].includes(id) && b[category + 'Slots'].length >= getLimits(p)[category + 'Slots']);
    const budget = Math.max(0, 30 - b.attackChoices - b.attributeChoices);
    const reason = crafted ? '已合成' : blockedSlot ? (blockedSlot[1] === 'attack' ? '攻击槽已满' : '属性槽已满') : !isEndless(p) && remaining > budget ? '本关升级次数不足' : '';
    return { ...r, attackLevel, attributeLevel, crafted, remaining, reason, possible: !crafted && !reason, started: attackLevel > 0 || attributeLevel > 0 };
  }
  function goal(p) { return recipeState(p, ensure(p).goalRecipe); }
  function setGoal(p, id) {
    if (id === '') { ensure(p).goalRecipe = ''; ensure(p).goalDismissed = true; return true; }
    const target = recipeState(p, id);
    if (!target?.possible) return false;
    ensure(p).goalRecipe = target.id; ensure(p).goalDismissed = false; return true;
  }
  function noteChoice(p, id) {
    if (ensure(p).goalDismissed) return;
    const target = goal(p);
    if (target?.possible) return;
    const pair = recipes.find(r => (r.attack === id || r.attribute === id) && recipeState(p, r)?.possible);
    if (pair) ensure(p).goalRecipe = pair.id;
  }
  function recommended(p) {
    const target = goal(p);
    if (!target?.possible) return null;
    const candidates = [target.attack, target.attribute].filter(id => (p.build.levels[id] || 0) < 5 && available(p, id));
    candidates.sort((a, b) => (p.build.levels[a] || 0) - (p.build.levels[b] || 0));
    return get(candidates[0]);
  }
  const attackBrief = { chain: '连锁3个目标', leafstorm: '切割身边6个目标', fireball: '爆炸命中8个目标', poison: '毒雾3秒，共5次伤害', pulse: '震击身边8个目标', bees: '追踪蜂击2次', boomerang: '前方扇形攻击4个目标', frostburst: '范围攻击，减速2秒', solar: '站定后释放范围光束', ricochet: '弹跳攻击4个目标' };
  const recipeBriefs = { skyweb: '6目标雷链 · 每3.8秒', leafcyclone: '近身叶轮 · 每0.9秒', sunheart: '大范围爆炸 · 每4.2秒', greenhouse: '持续毒域 · 伤害＋减速', earthguard: '范围震击 · 回复2.5%生命', queenbees: '5次追踪蜂击 · 每2.6秒', everturn: '大范围回旋 · 每2.4秒', icegarden: '范围冰霜 · 减速3.2秒' };
  const briefRecipe = id => recipeBriefs[id] || '';
  function brief(defOrId, m, p) {
    const d = typeof defOrId === 'string' ? get(defOrId) : defOrId;
    if (!d) return '';
    const text = d.describe(m, p);
    if (text.includes('转为')) return text.slice(text.indexOf('转为') + 2).replace('开局', '').replace('，并恢复同量生命', '，同步回血');
    if (attacks[d.id]) {
      if (text.startsWith('强化')) return text.replace(' · 下一级超级伤害 ', ' · 伤害 ').replace(/（.*$/, '');
      const power = text.match(/伤害 ([\d.]+%)/)?.[1], cooldown = text.match(/冷却 ([\d.]+)/)?.[1];
      return attackBrief[d.id] + ' · ' + power + '伤害 · ' + cooldown + '秒';
    }
    return text.replace(/（[^）]*）/g, '').replace(/，构筑最高.*|，本构筑最多.*|，最多额外.*|，最多缩短.*|，关卡构筑最多.*|；.*|，本构筑额外.*|，无尽可持续提升.*/g, '')
      .replace('基础伤害', '伤害').replace('基础射速', '射速').replace('开局移速', '移速').replace('开局拾取范围', '拾取范围').replace('英雄冷却减少开局值的 ', '英雄冷却 −')
      .replace('经验提前释放增加开局倍率的 ', '升级速度 +').replace('经验收益增加开局倍率的 ', '经验收益 +').replace('英雄、饰品和构筑技能伤害', '技能伤害').replace('已进入拾取圈的经验飞向玩家速度', '经验吸附速度');
  }
  window.ORCHARD_BUILDS = Object.freeze({ defs, recipes, limits, endlessLimits, getLimits, setMode, init, get, available, pool, choose, summary, tick, recipeState, goal, setGoal, recommended, brief, briefRecipe });
})();
