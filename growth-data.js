/*
 * 英雄、永久研究与局内追加词条。纯数据和纯数值函数；战斗对象由 game.js 接管。
 * bonuses: damage/rate 为比例，hp/speed/pickup 为固定增量，xpMult/skillCooldown 为倍率。
 * makeRunStats: 先与武器/护甲基础值合并，再冻结为本局基础值；永久加成每局只应用一次。
 * 局内 pierce 为平均穿透次数：每颗子弹取整数部分，再按小数部分概率加 1 次。
 */
(() => {
  'use strict';
  const training = Object.freeze({ damage: .025, hp: 5, cooldown: .02 });
  const heroes = [
    {
      id: 'orange', name: '橙橙', icon: '🍊', color: '#ffbb56', role: '站定爆发', unlockStage: 0, maxLevel: 30,
      description: '均衡的橙子守卫，用日光冲击打开近身虫群。',
      statsText: '均衡基础属性',
      skillName: '日耀冲击', skillIcon: '☀', cooldown: 16,
      skillDescription: '对 220 范围内最多 10 个敌人造成当前伤害 280% 的日光伤害。冷却 16 秒。',
      passiveName: '向阳果心', passiveDescription: '日耀冲击命中至少一个敌人时，恢复 5 点生命；每次施放只回复一次，不超过生命上限。',
      runModifiers: { damageMult: 1, rateMult: 1, hp: 0, speedMult: 1, speed: 0, pickup: 0, xpMult: 1,
        critChance: 0, defense: 0, regen: 0, regenDelay: 6, standDamage: 0 },
      active: { kind: 'ring', radius: 220, power: 2.8, targets: 10, healOnHit: 5 }
    },
    {
      id: 'berry', name: '莓莓', icon: '🍓', color: '#ff859c', role: '灵巧暴击', unlockStage: 0, maxLevel: 30,
      description: '穿过虫群的草莓游侠，擅长移动和连续齐射。',
      statsText: '基础伤害 −4% · 生命 −10 · 移速 +8%',
      skillName: '莓影齐射', skillIcon: '✦', cooldown: 14,
      skillDescription: '朝移动方向（静止时朝最后朝向）发射 7 枚莓影弹，每枚造成当前伤害 80%；弹速 520，飞行 1.4 秒。冷却 14 秒。',
      passiveName: '莓心敏锐', passiveDescription: '初始暴击率 +6%，暴击造成 150% 伤害；暴击作用于武器子弹。',
      runModifiers: { damageMult: .96, rateMult: 1, hp: -10, speedMult: 1.08, speed: 0, pickup: 0, xpMult: 1,
        critChance: .06, defense: 0, regen: 0, regenDelay: 6, standDamage: 0 },
      active: { kind: 'volley', count: 7, spread: .95, speed: 520, life: 1.4, radius: 728, power: .8 }
    },
    {
      id: 'pumpkin', name: '南瓜', icon: '🎃', color: '#ed9950', role: '坚韧控场', unlockStage: 0, maxLevel: 30,
      description: '厚实的南瓜卫士，用震地冲击创造安全距离。',
      statsText: '基础伤害 +3% · 生命 +28 · 移速 −4%',
      skillName: '震地重击', skillIcon: '◉', cooldown: 18,
      skillDescription: '对 240 范围内最多 10 个敌人造成当前伤害 320%，击退普通与精英敌人 80 距离，并减速 35% 持续 1.8 秒；Boss 不受击退，减速 15%。冷却 18 秒。',
      passiveName: '厚皮果壳', passiveDescription: '初始固定减伤 +2；最终受到的每次伤害至少为 1。',
      runModifiers: { damageMult: 1.03, rateMult: 1, hp: 28, speedMult: .96, speed: 0, pickup: 0, xpMult: 1,
        critChance: 0, defense: 2, regen: 0, regenDelay: 6, standDamage: 0 },
      active: { kind: 'slam', radius: 240, power: 3.2, targets: 10, knockback: 80, slow: .35, bossSlow: .15, duration: 1.8 }
    },
    {
      id: 'lime', name: '青柠', icon: '🍋', color: '#b5df72', role: '恢复采集', unlockStage: 0, maxLevel: 30,
      description: '照顾同伴的青柠园丁，用回春脉冲维持长线探索。',
      statsText: '基础伤害 −6% · 生命 +5 · 拾取范围 +18 · 经验 +6%',
      skillName: '回春脉冲', skillIcon: '✚', cooldown: 20,
      skillDescription: '恢复生命上限 7% + 5 点生命（不超过生命上限），同时对 190 范围内最多 10 个敌人造成当前伤害 120%。冷却 20 秒。',
      passiveName: '林间呼吸', passiveDescription: '连续 6 秒未受到生命伤害后，每秒恢复 0.25 生命；生命满时不储存回复。',
      runModifiers: { damageMult: .94, rateMult: 1, hp: 5, speedMult: 1, speed: 0, pickup: 18, xpMult: 1.06,
        critChance: 0, defense: 0, regen: .25, regenDelay: 6, standDamage: 0 },
      active: { kind: 'healPulse', radius: 190, power: 1.2, targets: 10, healFlat: 5, healMaxHp: .07 }
    },
    {
      id: 'cherry', name: '双双', icon: '🍒', color: '#f36c86', role: '双列穿透', unlockStage: 0, maxLevel: 30,
      description: '总是结伴的樱桃姐妹，把成排的虫群变成齐射的靶场。',
      statsText: '基础伤害 −4% · 射速 +6% · 生命 −8',
      skillName: '双樱连珠', skillIcon: '⋈', cooldown: 16,
      skillDescription: '朝移动方向（静止时朝最后朝向）发射双列共 12 枚樱桃弹，每枚造成当前伤害 58%；弹速 560，飞行 1.35 秒。冷却 16 秒。',
      passiveName: '并蒂尖籽', passiveDescription: '基础武器平均穿透 +0.35；每颗种子有 35% 概率多穿过一个敌人，能与穿透词条叠加。',
      runModifiers: { damageMult: .96, rateMult: 1.06, hp: -8, speedMult: 1, speed: 0, pickup: 0, xpMult: 1,
        critChance: 0, defense: 0, regen: 0, regenDelay: 6, standDamage: 0, pierce: .35 },
      active: { kind: 'volley', count: 12, rows: 2, rowOffset: 10, spread: .72, speed: 560, life: 1.35, radius: 756, power: .58 }
    },
    {
      id: 'pear', name: '绒绒', icon: '🍐', color: '#d1df8a', role: '闪避护圈', unlockStage: 0, maxLevel: 30,
      description: '轻盈的梨子巡林者，以柔风切开包围，留出闪避的位置。',
      statsText: '基础伤害 −5% · 生命 +8 · 移速 +4%',
      skillName: '梨风旋环', skillIcon: '◎', cooldown: 16,
      skillDescription: '对 210 范围内最多 10 个敌人造成当前伤害 240% 的环形风刃伤害。冷却 16 秒。',
      passiveName: '轻绒果衣', passiveDescription: '初始闪避率 +7%；成功闪避时免除本次生命伤害，能够与闪避词条叠加。',
      runModifiers: { damageMult: .95, rateMult: 1, hp: 8, speedMult: 1.04, speed: 0, pickup: 0, xpMult: 1,
        critChance: 0, defense: 0, regen: 0, regenDelay: 6, standDamage: 0, dodge: .07 },
      active: { kind: 'ring', radius: 210, power: 2.4, targets: 10 }
    },
    {
      id: 'blueberry', name: '墨墨', icon: '🫐', color: '#879aed', role: '连锁法术', unlockStage: 0, maxLevel: 30,
      description: '收集月露的蓝莓术士，让一束电光沿虫群跳跃。',
      statsText: '基础伤害 −2% · 生命 −6 · 拾取范围 +12',
      skillName: '月露连锁', skillIcon: 'ϟ', cooldown: 18,
      skillDescription: '锁定 430 范围内最近敌人并连锁最多 5 个不同目标，首跳造成当前伤害 145%，每跳保留前一跳 90% 的伤害；跳跃距离 190。冷却 18 秒。',
      passiveName: '浓缩月露', passiveDescription: '技能伤害 +8%，作用于英雄主动、饰品自动技能与攻击词条；基础武器伤害不受影响。',
      runModifiers: { damageMult: .98, rateMult: 1, hp: -6, speedMult: 1, speed: 0, pickup: 12, xpMult: 1,
        critChance: 0, defense: 0, regen: 0, regenDelay: 6, standDamage: 0, skillPower: 1.08 },
      active: { kind: 'chain', radius: 430, power: 1.45, targets: 5, jumpRadius: 190, falloff: .9 }
    },
    {
      id: 'pineapple', name: '刺刺', icon: '🍍', color: '#e4c965', role: '荆棘坚守', unlockStage: 0, maxLevel: 30,
      description: '守在林间路口的菠萝卫兵，用果刺与短时护甲稳住阵脚。',
      statsText: '基础伤害 +2% · 生命 +18 · 移速 −4%',
      skillName: '金棘守阵', skillIcon: '▣', cooldown: 20,
      skillDescription: '对 220 范围内最多 10 个敌人造成当前伤害 160%，并在随后 5 秒获得固定减伤 +3；每次受伤至少为 1。冷却 20 秒。',
      passiveName: '尖刺果壳', passiveDescription: '接触攻击造成生命损失后，存活时对该虫子造成当前伤害 12% 的反击；护盾完全抵挡或闪避时不触发。',
      runModifiers: { damageMult: 1.02, rateMult: 1, hp: 18, speedMult: .96, speed: 0, pickup: 0, xpMult: 1,
        critChance: 0, defense: 0, regen: 0, regenDelay: 6, standDamage: 0, thorns: .12 },
      active: { kind: 'guardRing', radius: 220, power: 1.6, targets: 10, guardDefense: 3, guardDuration: 5 }
    }
  ];
  heroes.push(...[
  {
    "id": "peach",
    "name": "团团",
    "icon": "🍑",
    "color": "#f6b2bd",
    "role": "治愈守护",
    "description": "桃子医师撑起花瓣屏障，在危急时保护自己。",
    "statsText": "生命 +16 · 基础伤害 −5%",
    "skillName": "桃花庇护",
    "skillIcon": "✚",
    "cooldown": 20,
    "skillDescription": "恢复生命上限8% + 6点生命，并获得固定减伤 +2，持续4秒。冷却20秒。",
    "passiveName": "桃露回春",
    "passiveDescription": "连续6秒未受生命伤害，每秒恢复0.4生命。",
    "runModifiers": {
      "damageMult": 0.95,
      "rateMult": 1,
      "hp": 16,
      "speedMult": 1,
      "speed": 0,
      "pickup": 0,
      "xpMult": 1,
      "critChance": 0,
      "defense": 0,
      "regen": 0.4,
      "regenDelay": 6,
      "standDamage": 0
    },
    "active": {
      "kind": "healGuard",
      "radius": 180,
      "power": 0,
      "targets": 0,
      "healFlat": 6,
      "healMaxHp": 0.08,
      "guardDefense": 2,
      "guardDuration": 4
    }
  },
  {
    "id": "grape",
    "name": "蹦蹦",
    "icon": "🍇",
    "color": "#bd95e5",
    "role": "环射清群",
    "description": "葡萄火炮手把一串葡萄籽洒向四面八方。",
    "statsText": "射速 +8% · 生命 −8",
    "skillName": "紫晶星雨",
    "skillIcon": "✹",
    "cooldown": 18,
    "skillDescription": "朝四周均匀发射12枚葡萄弹，每枚造成当前伤害75%，各可穿透1只敌人；弹速480，持续1.5秒。冷却18秒。",
    "passiveName": "连珠藤脉",
    "passiveDescription": "基础武器射速 +8%，平均穿透 +0.2（每颗20%概率额外穿透一只）。",
    "runModifiers": {
      "damageMult": 1,
      "rateMult": 1.08,
      "hp": -8,
      "speedMult": 1,
      "speed": 0,
      "pickup": 0,
      "xpMult": 1,
      "critChance": 0,
      "defense": 0,
      "regen": 0,
      "regenDelay": 6,
      "standDamage": 0,
      "pierce": 0.2
    },
    "active": {
      "kind": "radialVolley",
      "radius": 720,
      "power": 0.75,
      "count": 12,
      "speed": 480,
      "life": 1.5,
      "pierces": 1
    }
  },
  {
    "id": "watermelon",
    "name": "盾盾",
    "icon": "🍉",
    "color": "#79d7a2",
    "role": "冰霜壁垒",
    "description": "西瓜重卫用冰凉瓜汁冻结身边的虫群。",
    "statsText": "生命 +24 · 移速 −4% · 固定减伤 +1",
    "skillName": "冰瓜护盾",
    "skillIcon": "❄",
    "cooldown": 20,
    "skillDescription": "对230范围内最多12个敌人造成当前伤害180%，减速45%持续3秒（Boss减速20%）；同时获得1层护盾，已有护盾时不叠加。冷却20秒。",
    "passiveName": "厚实瓜皮",
    "passiveDescription": "初始固定减伤 +1；站定蓄力后的伤害倍率额外 +10%。",
    "runModifiers": {
      "damageMult": 1,
      "rateMult": 1,
      "hp": 24,
      "speedMult": 0.96,
      "speed": 0,
      "pickup": 0,
      "xpMult": 1,
      "critChance": 0,
      "defense": 1,
      "regen": 0,
      "regenDelay": 6,
      "standDamage": 0.1
    },
    "active": {
      "kind": "frostShield",
      "radius": 230,
      "power": 1.8,
      "targets": 12,
      "slow": 0.45,
      "bossSlow": 0.2,
      "duration": 3
    }
  },
  {
    "id": "banana",
    "name": "弯弯",
    "icon": "🍌",
    "color": "#f3dc7e",
    "role": "冲刺突围",
    "description": "香蕉斥候沿着果皮滑步，在包围中穿出一条路。",
    "statsText": "移速 +8% · 基础伤害 −3% · 生命 −6",
    "skillName": "蕉影滑步",
    "skillIcon": "➶",
    "cooldown": 14,
    "skillDescription": "朝移动方向（静止时朝最后朝向）冲刺210距离，冲刺时绕不过实体障碍；获得0.6秒无敌，并在落点对170范围内最多8个敌人造成当前伤害220%。冷却14秒。",
    "passiveName": "轻步果皮",
    "passiveDescription": "初始闪避率 +5%，移速 +8%。",
    "runModifiers": {
      "damageMult": 0.97,
      "rateMult": 1,
      "hp": -6,
      "speedMult": 1.08,
      "speed": 0,
      "pickup": 0,
      "xpMult": 1,
      "critChance": 0,
      "defense": 0,
      "regen": 0,
      "regenDelay": 6,
      "standDamage": 0,
      "dodge": 0.05
    },
    "active": {
      "kind": "dashStrike",
      "radius": 170,
      "power": 2.2,
      "targets": 8,
      "distance": 210,
      "invDuration": 0.6
    }
  },
  {
    "id": "coconut",
    "name": "船船",
    "icon": "🥥",
    "color": "#d2b998",
    "role": "远程斩杀",
    "description": "椰子猎手瞄准负伤虫王，投出沉重的果核。",
    "statsText": "基础伤害 +4% · 射速 −4% · 生命 +12",
    "skillName": "椰核终击",
    "skillIcon": "◆",
    "cooldown": 18,
    "skillDescription": "锁定600范围内生命比例最低的1个敌人，造成当前伤害400%；目标生命不高于30%时造成800%。冷却18秒。",
    "passiveName": "坚壳猎手",
    "passiveDescription": "初始固定减伤 +1，基础伤害 +4%。",
    "runModifiers": {
      "damageMult": 1.04,
      "rateMult": 0.96,
      "hp": 12,
      "speedMult": 1,
      "speed": 0,
      "pickup": 0,
      "xpMult": 1,
      "critChance": 0,
      "defense": 1,
      "regen": 0,
      "regenDelay": 6,
      "standDamage": 0
    },
    "active": {
      "kind": "execute",
      "radius": 600,
      "power": 4,
      "targets": 1,
      "threshold": 0.3,
      "executePower": 8
    }
  }
].map(item => ({ ...item, unlockStage: 0, maxLevel: 30 })));
  const talents = [
    { id: 'vitality', name: '丰汁研究', icon: '♥', maxLevel: 20, description: '每级永久生命上限 +4，满级 +80。',
      bonus: { hp: 4 }, baseSeeds: 45, seedStep: 25, seedCurve: 6, baseCores: 1, coreStep: 3 },
    { id: 'damage', name: '日光淬籽', icon: '☀', maxLevel: 20, description: '每级永久基础伤害 +2%，满级 +40%。',
      bonus: { damage: .02 }, baseSeeds: 65, seedStep: 35, seedCurve: 8, baseCores: 2, coreStep: 2 },
    { id: 'rate', name: '枝脉传导', icon: '»', maxLevel: 20, description: '每级永久基础射速 +1%，满级 +20%。',
      bonus: { rate: .01 }, baseSeeds: 60, seedStep: 30, seedCurve: 8, baseCores: 2, coreStep: 2 },
    { id: 'insight', name: '虫群研习', icon: '✧', maxLevel: 15, description: '每级经验倍率 +2%，满级 +30%；关卡提前领取固定经验预算，无尽增加经验收益，与装备倍率相乘。',
      bonus: { xpBonus: .02 }, baseSeeds: 55, seedStep: 30, seedCurve: 7, baseCores: 1, coreStep: 2 }
  ];
  for (const item of heroes) { Object.freeze(item.runModifiers); Object.freeze(item.active); Object.freeze(item); }
  for (const item of talents) { Object.freeze(item.bonus); Object.freeze(item); }
  Object.freeze(heroes); Object.freeze(talents);

  const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
  const integer = (value, min, max) => Math.max(min, Math.min(max, Math.floor(finite(value, min))));
  const hero = id => heroes.find(item => item.id === id) || null;
  const talent = id => talents.find(item => item.id === id) || null;
  const ownValue = (object, key) => object && typeof object === 'object' && Object.hasOwn(object, key) ? object[key] : undefined;
  function isUnlocked(heroOrId, profile) {
    const item = typeof heroOrId === 'string' ? hero(heroOrId) : hero(heroOrId?.id);
    if (!item) return false;
    if (!item.unlockStage) return true;
    return Array.isArray(profile?.clearedStages) && profile.clearedStages.some(stage => Number.isInteger(stage) && stage >= item.unlockStage && stage <= 100);
  }
  function migrate(raw, resultProfile = {}) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const savedHeroLevels = ownValue(source, 'heroLevels'), savedTalents = ownValue(source, 'talents'), savedHero = ownValue(source, 'selectedHero');
    resultProfile.heroLevels = {};
    for (const item of heroes) {
      resultProfile.heroLevels[item.id] = isUnlocked(item, resultProfile) ? integer(ownValue(savedHeroLevels, item.id), 0, item.maxLevel) : 0;
    }
    resultProfile.talents = {};
    for (const item of talents) resultProfile.talents[item.id] = integer(ownValue(savedTalents, item.id), 0, item.maxLevel);
    const selected = hero(savedHero);
    resultProfile.selectedHero = selected && isUnlocked(selected, resultProfile) ? selected.id : 'orange';
    return resultProfile;
  }
  function cost(kind, id, level = 0) {
    const item = kind === 'hero' ? hero(id) : kind === 'talent' ? talent(id) : null;
    if (!item || !Number.isInteger(level) || level < 0 || level >= item.maxLevel) return null;
    if (kind === 'hero') {
      if (level < 5) return { seeds: 60 + level * 30 + level * level * 12, cores: 1 + Math.floor(level / 2) };
      const step = level - 5;
      return { seeds: 510 + step * 60 + step * step * 4, cores: 3 + Math.floor(step / 3) };
    }
    return { seeds: item.baseSeeds + level * item.seedStep + level * level * item.seedCurve, cores: item.baseCores + Math.floor(level / item.coreStep) };
  }
  function bonuses(profile = {}) {
    const selected = hero(profile.selectedHero);
    const current = selected && isUnlocked(selected, profile) ? selected : hero('orange');
    const level = integer(ownValue(profile.heroLevels, current.id), 0, current.maxLevel);
    const result = { damage: Math.min(level, 5) * training.damage + Math.max(0, level - 5) * .01, rate: 0, hp: Math.min(level, 5) * training.hp + Math.max(0, level - 5) * 3, speed: 0, pickup: 0, xpMult: 1, skillCooldown: 1 - Math.min(level, 5) * training.cooldown - Math.max(0, level - 5) * .008 };
    for (const item of talents) {
      const level = integer(ownValue(profile.talents, item.id), 0, item.maxLevel);
      for (const [key, amount] of Object.entries(item.bonus)) {
        if (key === 'xpBonus') result.xpMult += amount * level;
        else result[key] += amount * level;
      }
    }
    return result;
  }
  function makeRunStats(profile = {}) {
    const selected = hero(profile.selectedHero);
    const current = selected && isUnlocked(selected, profile) ? selected : hero('orange');
    const bonus = bonuses(profile), m = current.runModifiers;
    return { heroId: current.id, damageMult: m.damageMult * (1 + bonus.damage), rateMult: m.rateMult * (1 + bonus.rate),
      hp: m.hp + bonus.hp, speedMult: m.speedMult, speed: m.speed + bonus.speed, pickup: m.pickup + bonus.pickup,
      xpMult: m.xpMult * bonus.xpMult, skillCooldown: bonus.skillCooldown, critChance: m.critChance,
      critMultiplier: 1.5, pierce: m.pierce || 0, defense: m.defense, regen: m.regen, regenDelay: m.regenDelay, standDamage: m.standDamage,
      dodge: m.dodge || 0, thorns: m.thorns || 0, skillPower: m.skillPower || 1 };
  }
  function active(heroOrId, player = {}) {
    const item = typeof heroOrId === 'string' ? hero(heroOrId) : hero(heroOrId?.id);
    if (!item) return null;
    const spec = item.active, damage = Math.max(0, finite(player.damage));
    const result = { ...spec, heroId: item.id, name: item.skillName, color: item.color, damage: damage * spec.power,
      cooldown: item.cooldown * Math.max(.12, Math.min(1, finite(player.skillCooldown, 1))) };
    if (['healPulse', 'healGuard'].includes(spec.kind)) {
      const maxHp = Math.max(0, finite(player.maxHp)), hp = Math.max(0, finite(player.hp));
      result.heal = Math.max(0, Math.min(Math.max(0, maxHp - hp), spec.healFlat + maxHp * spec.healMaxHp));
    }
    return result;
  }

  const value = (p, key, fallback = 0) => finite(p?.[key], fallback);
  const quality = m => Math.max(1, Math.min(2, finite(m, 1)));
  const text = n => (Math.round(n * 100) / 100).toString();
  const percent = n => text(n * 100) + '%';
  const capped = (p, key, increment, limit, m, fallback = 0) => Math.min(limit, value(p, key, fallback) + increment * quality(m));
  const cooldownBase = p => Math.max(.35, Math.min(1, finite(p?.baseSkillCooldown, finite(p?.baseStats?.skillCooldown, 1))));
  const cooldownNext = (p, m) => Math.max(cooldownBase(p) * .6, value(p, 'skillCooldown', 1) - cooldownBase(p) * .06 * quality(m));
  const runUpgrades = [
    { id: 'critChance', icon: '✦', name: '星芒果籽',
      describe: (m, p) => '暴击率 ' + percent(value(p, 'critChance')) + ' → ' + percent(capped(p, 'critChance', .04, .35, m)) + ' · 上限 35%',
      available: p => value(p, 'critChance') < .35 - 1e-7,
      apply: (p, m = 1) => { p.critChance = capped(p, 'critChance', .04, .35, m); } },
    { id: 'critMultiplier', icon: '✹', name: '爆汁果心',
      describe: (m, p) => '暴击伤害 ' + percent(value(p, 'critMultiplier', 1.5)) + ' → ' + percent(capped(p, 'critMultiplier', .15, 2.5, m, 1.5)) + ' · 上限 250%',
      available: p => value(p, 'critChance') > 0 && value(p, 'critMultiplier', 1.5) < 2.5 - 1e-7,
      apply: (p, m = 1) => { p.critMultiplier = capped(p, 'critMultiplier', .15, 2.5, m, 1.5); } },
    { id: 'pierce', icon: '➶', name: '尖叶穿籽',
      describe: (m, p) => '平均穿透 ' + text(value(p, 'pierce')) + ' → ' + text(capped(p, 'pierce', .5, 3, m)) + ' 只 / 籽 · 上限 3；小数按概率生效',
      available: p => value(p, 'pierce') < 3 - 1e-7,
      apply: (p, m = 1) => { p.pierce = capped(p, 'pierce', .5, 3, m); } },
    { id: 'defense', icon: '▣', name: '叠叶护身',
      describe: (m, p) => '固定减伤 ' + text(value(p, 'defense')) + ' → ' + text(value(p, 'defense') + capped(p, 'defenseBonus', 1, 6, m) - value(p, 'defenseBonus')) + ' · 本局额外上限 +6，受伤至少 1',
      available: p => value(p, 'defenseBonus') < 6 - 1e-7,
      apply: (p, m = 1) => { const next = capped(p, 'defenseBonus', 1, 6, m); p.defense = value(p, 'defense') + next - value(p, 'defenseBonus'); p.defenseBonus = next; } },
    { id: 'regen', icon: '✚', name: '晨露滋养',
      describe: (m, p) => '脱战回复 ' + text(value(p, 'regen')) + ' → ' + text(value(p, 'regen') + capped(p, 'regenBonus', .12, 1.2, m) - value(p, 'regenBonus')) + ' 生命 / 秒 · 未受生命伤害 6 秒后生效，本局额外上限 +1.2',
      available: p => value(p, 'regenBonus') < 1.2 - 1e-7,
      apply: (p, m = 1) => { const next = capped(p, 'regenBonus', .12, 1.2, m); p.regen = value(p, 'regen') + next - value(p, 'regenBonus'); p.regenBonus = next; } },
    { id: 'skillCooldown', icon: '◷', name: '四季轮转',
      describe: (m, p) => { const item = hero(p?.heroId) || hero('orange'); return '英雄技能冷却 ' + text(item.cooldown * value(p, 'skillCooldown', 1)) + ' → ' + text(item.cooldown * cooldownNext(p, m)) + ' 秒 · 本局最多再缩短 40%'; },
      available: p => value(p, 'skillCooldown', 1) > cooldownBase(p) * .6 + 1e-7,
      apply: (p, m = 1) => { p.skillCooldown = cooldownNext(p, m); } }
  ];
  Object.freeze(runUpgrades.map(Object.freeze));
  Object.freeze(runUpgrades);
  window.ORCHARD_GROWTH = Object.freeze({ heroes, talents, training, hero, isUnlocked, migrate, cost, bonuses, makeRunStats, active, runUpgrades });
})();
