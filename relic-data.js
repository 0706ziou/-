/*
 * 50 件特殊饰品配置，每局随机投放 6 件；ORCHARD_RELIC_POINTS 是独立的 6 个地图槽位。
 * 目录中的 x / y 仅保留旧版兼容，实际饰品投放位置由本局分配决定。
 * 当前世界为 6788 × 4808，面积为前一版的 5 倍、最初地图的 50 倍。
 * 靠近投放点 56 像素自动领取；每局每件只能领取一次。
 * 技能保留到本局的无尽模式，新关卡重置领取状态。
 * power 乘以玩家当前伤害，不乘以多发子弹分摊后的单粒伤害。
 * cooldown / duration 单位为秒，radius / chainRadius / distance 单位为像素。
 */
(() => {
  'use strict';
  const relics = [
    {
      id: 'lightning', key: 'lightning', name: '雷种坠', icon: '⚡', color: '#ffe48a',
      x: .602, y: .50, skillName: '连锁雷种',
      summary: '最多 3 目标 · 每只 115% 伤害 · 连锁距离 160',
      description: '每 4.5 秒释放连锁闪电，最多命中 3 只虫子，每只造成当前伤害的 115%。',
      cooldown: 4.8, radius: 430, chainRadius: 160, power: 1.05, targets: 3
    },
    {
      id: 'orbit', key: 'orbit', name: '旋叶环', icon: '🍃', color: '#a6ec9d',
      x: .76, y: .27, skillName: '护身旋叶',
      summary: '半径 96 · 最多 6 目标 · 每只 24% 伤害',
      description: '旋叶环绕身边，每 0.75 秒攻击 96 像素内最多 6 个目标，造成当前伤害的 24%。',
      cooldown: .85, radius: 96, power: .26, targets: 6
    },
    {
      id: 'dash', key: 'dash', name: '风种徽章', icon: '➤', color: '#8bdde8',
      x: .47, y: .17, skillName: '风种闪步',
      summary: '闪步 280 · 无敌 0.28 秒 · 沿移动或上次朝向',
      description: '空格或手机技能按钮向移动方向闪步 280 像素，获得 0.28 秒无敌，冷却 6 秒。',
      cooldown: 6.5, distance: 270, duration: .28
    },
    {
      id: 'frost', key: 'frost', name: '冰露铃', icon: '❄', color: '#a3dffa',
      x: .22, y: .30, skillName: '冰露脉冲',
      summary: '半径 180 · 伤害 50% · 减速 40%（Boss 20%）2.6 秒',
      description: '每 9 秒冻结周围 180 像素的虫群，造成当前伤害的 50%，减速 40% 持续 2.6 秒；Boss 减速 20%。',
      cooldown: 9, radius: 180, power: .55, duration: 2.4, slow: .35, bossSlow: .15, targets: 24
    },
    {
      id: 'shield', key: 'shield', name: '护芽坠', icon: '🛡', color: '#f6bbd0',
      x: .27, y: .76, skillName: '萌芽护盾',
      summary: '抵挡 1 次接触伤害 · 最多 1 层 · 消耗后补充',
      description: '领取立刻获得一层护盾，抵挡一次接触伤害；每 18 秒补充，最多保留一层。',
      cooldown: 24, targets: 1
    },
    {
      id: 'bees', key: 'bees', name: '蜂群符', icon: '🐝', color: '#ffc977',
      x: .84, y: .70, skillName: '双蜂护卫',
      summary: '半径 560 · 2 次攻击 · 每次 60% 伤害',
      description: '两只蜜蜂护卫每 1.8 秒攻击 560 像素内虫子，每只造成当前伤害的 60%。',
      cooldown: 2.2, radius: 560, power: .55, targets: 2
    }
  ];
  const additions = [
    { id: 'thunderFork', name: '雷叉枝', icon: 'ϟ', color: '#f6e68d', family: 'chain', skillName: '分枝电弧', cooldown: 6.2, radius: 460, chainRadius: 210, power: .9, targets: 4, summary: '6.2 秒 / 次 · 连锁 4 只 × 90% · 链距 210' },
    { id: 'staticPearl', name: '静电露珠', icon: '🔮', color: '#bcb4ff', family: 'chain', skillName: '近距电击', cooldown: 2.8, radius: 270, chainRadius: 115, power: .7, targets: 2, summary: '2.8 秒 / 次 · 连锁 2 只 × 70% · 链距 115' },
    { id: 'stormAcorn', name: '风暴橡果', icon: '🌩', color: '#a7ccff', family: 'chain', skillName: '远雷接力', cooldown: 8.5, radius: 620, chainRadius: 180, power: 1.55, targets: 3, summary: '8.5 秒 / 次 · 连锁 3 只 × 155% · 索敌 620' },
    { id: 'sunDisk', name: '日轮果盘', icon: '☀', color: '#ffda81', family: 'pulse', skillName: '日轮震波', cooldown: 5.8, radius: 170, power: 1.15, targets: 8, summary: '5.8 秒 / 次 · 半径 170 · 最多 8 只 × 115%' },
    { id: 'pollenBell', name: '花粉风铃', icon: '🔔', color: '#fff3ac', family: 'pulse', skillName: '花粉脉冲', cooldown: 3.4, radius: 135, power: .55, targets: 10, summary: '3.4 秒 / 次 · 半径 135 · 最多 10 只 × 55%' },
    { id: 'moonBasin', name: '月露小碗', icon: '🌙', color: '#d0c4ff', family: 'pulse', skillName: '月光潮汐', cooldown: 9.5, radius: 280, power: 1.25, targets: 10, summary: '9.5 秒 / 次 · 半径 280 · 最多 10 只 × 125%' },
    { id: 'emberLantern', name: '萤火灯笼', icon: '🏮', color: '#ffaf76', family: 'pulse', skillName: '暖焰爆发', cooldown: 7.8, radius: 205, power: 1.45, targets: 6, summary: '7.8 秒 / 次 · 半径 205 · 最多 6 只 × 145%' },
    { id: 'thornWreath', name: '荆棘花冠', icon: '🌹', color: '#ec99af', family: 'orbit', skillName: '荆棘护环', cooldown: 1.3, radius: 118, power: .36, targets: 5, summary: '1.3 秒 / 次 · 半径 118 · 最多 5 只 × 36%' },
    { id: 'shellRing', name: '果壳圆环', icon: '◎', color: '#d9bf8f', family: 'orbit', skillName: '贴身碎壳', cooldown: .9, radius: 74, power: .45, targets: 3, summary: '0.9 秒 / 次 · 半径 74 · 最多 3 只 × 45%' },
    { id: 'petalWheel', name: '花瓣风车', icon: '🌸', color: '#ffb8d3', family: 'orbit', skillName: '远叶环舞', cooldown: 2.2, radius: 158, power: .55, targets: 7, summary: '2.2 秒 / 次 · 半径 158 · 最多 7 只 × 55%' },
    { id: 'seedSlingshot', name: '橡皮籽弹弓', icon: '🏹', color: '#d6df88', family: 'projectile', skillName: '三籽扇射', cooldown: 3.6, radius: 580, power: .75, count: 3, spread: .4, speed: 480, life: 1.35, pierce: 0, summary: '3.6 秒 / 次 · 扇射 3 籽 × 75% · 弹速 480' },
    { id: 'needleLeaf', name: '针叶胸针', icon: '➶', color: '#a7dd93', family: 'projectile', skillName: '穿透叶针', cooldown: 4.5, radius: 690, power: 1.45, count: 1, spread: 0, speed: 620, life: 1.25, pierce: 2, summary: '4.5 秒 / 次 · 1 枚叶针 145% · 穿透 2 只' },
    { id: 'berryFan', name: '莓果折扇', icon: '🪭', color: '#ff9caf', family: 'projectile', skillName: '莓籽散花', cooldown: 6.8, radius: 520, power: .52, count: 5, spread: .85, speed: 430, life: 1.45, pierce: 0, summary: '6.8 秒 / 次 · 扇射 5 籽 × 52% · 扇角 49°' },
    { id: 'spicePod', name: '辣椒种荚', icon: '🌶', color: '#ff827a', family: 'projectile', skillName: '辣籽重弹', cooldown: 7.2, radius: 600, power: 2.4, count: 1, spread: 0, speed: 350, life: 1.9, pierce: 1, size: 7, summary: '7.2 秒 / 次 · 1 枚重弹 240% · 穿透 1 只' },
    { id: 'twinBud', name: '双芽发夹', icon: '🌱', color: '#c0eda4', family: 'projectile', skillName: '双芽齐射', cooldown: 2.6, radius: 540, power: .6, count: 2, spread: .13, speed: 500, life: 1.2, pierce: 0, summary: '2.6 秒 / 次 · 双弹 × 60% · 索敌 540' },
    { id: 'ladybugBadge', name: '瓢虫徽章', icon: '🐞', color: '#ff9d8e', family: 'bee', skillName: '瓢虫点射', cooldown: 2.7, radius: 440, power: 1.15, targets: 1, summary: '2.7 秒 / 次 · 半径 440 · 1 次 115% 伤害' },
    { id: 'butterflyKnot', name: '蝶翼丝结', icon: '🦋', color: '#b3c8ff', family: 'bee', skillName: '蝶群协击', cooldown: 4.6, radius: 580, power: .7, targets: 3, summary: '4.6 秒 / 次 · 半径 580 · 3 次 × 70% 伤害' },
    { id: 'hiveWhistle', name: '蜂巢小哨', icon: '📯', color: '#fbd68a', family: 'bee', skillName: '远蜂冲刺', cooldown: 7.4, radius: 760, power: 1.7, targets: 2, summary: '7.4 秒 / 次 · 半径 760 · 2 次 × 170% 伤害' },
    { id: 'dewFlask', name: '晨露水壶', icon: '💧', color: '#9fe0ed', family: 'heal', skillName: '定时润芽', cooldown: 12, healFlat: 3, healMaxHp: 0, summary: '每 12 秒恢复 3 生命 · 满血时不储存' },
    { id: 'peachCharm', name: '桃心香囊', icon: '🍑', color: '#ffc0ad', family: 'heal', skillName: '桃香养息', cooldown: 18, healFlat: 2, healMaxHp: .025, summary: '每 18 秒恢复 2 + 生命上限 2.5%' },
    { id: 'cloverCup', name: '四叶草杯', icon: '🍀', color: '#b4e69a', family: 'heal', skillName: '脱战露饮', cooldown: 8, healFlat: 2.5, healMaxHp: 0, requireNoHit: 6, summary: '每 8 秒恢复 2.5 生命 · 需 6 秒未受伤' },
    { id: 'barkAmulet', name: '树皮护符', icon: '🪵', color: '#d9b68d', family: 'ward', skillName: '树皮护层', cooldown: 25, summary: '立即获得 1 层护盾 · 消耗后 25 秒补充 · 不叠层' },
    { id: 'prismShell', name: '棱光果壳', icon: '💎', color: '#bacffa', family: 'ward', skillName: '棱壳护层', cooldown: 31, wardHeal: 2, summary: '立即获得 1 层护盾 · 消耗后 31 秒补充并回复 2 · 不叠层' },
    { id: 'venomBerry', name: '幽绿莓珠', icon: '🟢', color: '#b4d580', family: 'poison', skillName: '莓毒侵染', cooldown: 6.5, radius: 320, dotPower: .3, duration: 3, targets: 4, summary: '6.5 秒 / 次 · 最多 4 只 · 每秒 30% 持续 3 秒' },
    { id: 'mushroomCap', name: '菌菇小帽', icon: '🍄', color: '#d7b7e6', family: 'poison', skillName: '孢子侵染', cooldown: 10, radius: 215, dotPower: .25, duration: 4, targets: 8, summary: '10 秒 / 次 · 最多 8 只 · 每秒 25% 持续 4 秒' },
    { id: 'acidLime', name: '酸柠滴管', icon: '🧪', color: '#d8ee87', family: 'poison', skillName: '酸露蚀伤', cooldown: 4.8, radius: 500, dotPower: .42, duration: 2.5, targets: 2, summary: '4.8 秒 / 次 · 最多 2 只 · 每秒 42% 持续 2.5 秒' },
    { id: 'snowRibbon', name: '霜叶丝带', icon: '🎗', color: '#b8e7f4', family: 'slow', skillName: '霜叶缠绕', cooldown: 7.5, radius: 240, power: .4, slow: .3, bossSlow: .12, duration: 2.2, targets: 8, summary: '7.5 秒 / 次 · 8 只 × 40% · 减速 30% / Boss 12% · 2.2 秒' },
    { id: 'stickyHoney', name: '蜜糖琥珀', icon: '🍯', color: '#efd18b', family: 'slow', skillName: '蜜糖黏足', cooldown: 11, radius: 185, power: .6, slow: .48, bossSlow: .2, duration: 3, targets: 10, summary: '11 秒 / 次 · 10 只 × 60% · 减速 48% / Boss 20% · 3 秒' },
    { id: 'harvestSickle', name: '丰收小镰', icon: '🌾', color: '#efdaa0', family: 'execute', skillName: '收割尾击', cooldown: 5, radius: 420, power: .75, executePower: 2, threshold: .3, targets: 2, summary: '5 秒 / 次 · 2 只 × 75% · 目标生命低于 30% 时 200%' },
    { id: 'crowFeather', name: '乌羽吊坠', icon: '🪶', color: '#c8bedf', family: 'execute', skillName: '暮羽终击', cooldown: 8, radius: 560, power: 1.3, executePower: 3, threshold: .2, targets: 1, summary: '8 秒 / 次 · 单体 130% · 目标生命低于 20% 时 300%' },
    { id: 'rootPendant', name: '根脉挂坠', icon: '〰', color: '#c4ad8c', family: 'leech', skillName: '根脉汲养', cooldown: 10, radius: 260, power: .9, targets: 3, healFlat: 1.2, summary: '10 秒 / 次 · 3 只 × 90% · 命中时恢复 1.2 生命' },
    { id: 'rubyPit', name: '红玉果核', icon: '♦', color: '#f69ba9', family: 'leech', skillName: '红玉采血', cooldown: 13, radius: 470, power: 1.6, targets: 1, healFlat: 2.2, summary: '13 秒 / 次 · 单体 160% · 命中时恢复 2.2 生命' },
    { id: 'tideConch', name: '溪潮螺哨', icon: '🐚', color: '#b3e7df', family: 'surge', skillName: '溪潮双拍', cooldown: 8.8, radius: 245, power: .65, targets: 6, repeats: 2, summary: '8.8 秒 / 次 · 半径 245 · 6 只 × 65% 连击 2 次' },
    { id: 'drumSeed', name: '节拍籽鼓', icon: '🥁', color: '#f4c391', family: 'surge', skillName: '三拍鼓震', cooldown: 12, radius: 200, power: .48, targets: 5, repeats: 3, summary: '12 秒 / 次 · 半径 200 · 5 只 × 48% 连击 3 次' },
    { id: 'amberKernel', name: '琥珀籽心', icon: '🟠', color: '#f2cd87', family: 'stats', skillName: '籽心强化', bonus: { damage: .12 }, summary: '至本局结束：伤害 + 初始基础伤害的 12%' },
    { id: 'swiftSpring', name: '弹簧嫩枝', icon: '»', color: '#d8e19b', family: 'stats', skillName: '枝脉加速', bonus: { rate: .1 }, summary: '至本局结束：射速 + 初始基础射速的 10%' },
    { id: 'windAnklet', name: '轻风脚环', icon: '🪽', color: '#a8e3e6', family: 'stats', skillName: '顺风轻步', bonus: { speed: .08 }, summary: '至本局结束：移速 + 初始基础移速的 8%' },
    { id: 'heartApple', name: '爱心苹果', icon: '🍎', color: '#f7a7a0', family: 'stats', skillName: '丰汁果心', bonus: { maxHp: 18, heal: 18 }, summary: '至本局结束：生命上限 +18，立即回复 18' },
    { id: 'magnetNut', name: '磁石果仁', icon: '🧲', color: '#aecddf', family: 'stats', skillName: '磁籽采集', bonus: { pickup: 35 }, summary: '至本局结束：经验拾取半径 +35' },
    { id: 'wisdomSprout', name: '智芽书签', icon: '📗', color: '#bfe19b', family: 'stats', skillName: '新芽研习', bonus: { xpMult: .08 }, summary: '至本局结束：经验倍率 +0.08（基础 1.00 → 1.08）' },
    { id: 'starBrooch', name: '星籽胸针', icon: '⭐', color: '#ffe7a7', family: 'stats', skillName: '星芒精准', bonus: { critChance: .05 }, summary: '至本局结束：暴击率 +5%，关卡总上限 45%，无尽 70%' },
    { id: 'arrowPod', name: '箭叶种荚', icon: '↗', color: '#b7dfaf', family: 'stats', skillName: '箭叶穿行', bonus: { pierce: .6 }, summary: '至本局结束：平均穿透 +0.6，小数按概率生效；关卡总上限 4.6，无尽 8.6' },
    { id: 'ironBark', name: '铁树皮扣', icon: '▣', color: '#cebc9e', family: 'stats', skillName: '硬皮护身', bonus: { defense: 2 }, summary: '至本局结束：固定减伤 +2，最终受伤至少 1' },
    { id: 'mossBand', name: '青苔腕带', icon: '✚', color: '#abcba1', family: 'stats', skillName: '苔息恢复', bonus: { regen: .2 }, summary: '至本局结束：6 秒未受伤后每秒回复 +0.2 生命' }
  ];
  const families = ['chain', 'orbit', 'dash', 'slow', 'ward', 'bee'];
  // Balance families separately: ranged tracking has lower sustained damage than
  // risky close circles, while heals and wards have independent long cooldowns.
  const revisions = {
    thunderFork: { cooldown: 6, power: .85 }, staticPearl: { cooldown: 3, power: .75 }, stormAcorn: { cooldown: 8.2, power: 1.45 },
    sunDisk: { cooldown: 6, power: 1.1 }, pollenBell: { cooldown: 3.8, power: .6, targets: 8 }, moonBasin: { cooldown: 9.2, power: 1.3, targets: 8 },
    emberLantern: { cooldown: 7.6, power: 1.4 }, thornWreath: { cooldown: 1.4, power: .4 }, shellRing: { cooldown: 1, power: .48 }, petalWheel: { cooldown: 2.4, power: .6 },
    seedSlingshot: { cooldown: 3.8, power: .8 }, needleLeaf: { cooldown: 4.8, power: 1.5 }, berryFan: { cooldown: 6.5, power: .56 },
    spicePod: { cooldown: 7.5, power: 2.5 }, twinBud: { cooldown: 2.8, power: .62 }, ladybugBadge: { cooldown: 2.9, power: 1.1 },
    butterflyKnot: { cooldown: 4.8, power: .72 }, hiveWhistle: { cooldown: 7.8, power: 1.6 },
    peachCharm: { cooldown: 20, healMaxHp: .02 }, cloverCup: { cooldown: 9, healFlat: 2.5 }, barkAmulet: { cooldown: 30 }, prismShell: { cooldown: 36, wardHeal: 1.5 },
    venomBerry: { cooldown: 7, dotPower: .28 }, mushroomCap: { cooldown: 10.5, dotPower: .24 }, acidLime: { cooldown: 5, dotPower: .4 },
    snowRibbon: { cooldown: 8, slow: .3, bossSlow: .12 }, stickyHoney: { cooldown: 12, slow: .45, bossSlow: .18, duration: 2.8 },
    harvestSickle: { cooldown: 5.4, power: .8, executePower: 2.1, threshold: .25 }, crowFeather: { cooldown: 8.5, power: 1.35, executePower: 3.1 },
    rootPendant: { cooldown: 11, power: .9, healFlat: 1 }, rubyPit: { cooldown: 14, power: 1.6, healFlat: 2 },
    tideConch: { cooldown: 9, power: .7 }, drumSeed: { cooldown: 12, power: .5 },
    amberKernel: { bonus: { damage: .1 } }, swiftSpring: { bonus: { rate: .08 } }, heartApple: { bonus: { maxHp: 16, heal: 16 } }, ironBark: { bonus: { defense: 1.5 } }
  };
  const number = n => String(Math.round(n * 100) / 100), percent = n => number(n * 100) + '%';
  function describe(def) {
    const cd = number(def.cooldown) + ' 秒 / 次', hit = percent(def.power), area = '半径 ' + def.radius;
    if (def.family === 'chain') return cd + ' · 连锁 ' + def.targets + ' 只 × ' + hit + ' · 链距 ' + def.chainRadius;
    if (def.family === 'dash') return '闪步 ' + def.distance + ' · 无敌 ' + number(def.duration) + ' 秒 · 冷却 ' + number(def.cooldown) + ' 秒 · 沿移动或上次朝向';
    if (def.family === 'ward') return '立即获得 1 层护盾 · 消耗后 ' + def.cooldown + ' 秒补充' + (def.wardHeal ? '并回复 ' + def.wardHeal : '') + ' · 共用 1 层';
    if (def.family === 'heal') return '每 ' + def.cooldown + ' 秒恢复 ' + number(def.healFlat) + (def.healMaxHp ? ' + 生命上限 ' + percent(def.healMaxHp) : '') + ' 生命' + (def.requireNoHit ? ' · 需 ' + def.requireNoHit + ' 秒未受伤' : ' · 满血不储存');
    if (def.family === 'bee') return cd + ' · ' + area + ' · ' + def.targets + ' 次 × ' + hit + ' 伤害';
    if (def.family === 'projectile') return cd + ' · ' + def.count + ' 籽 × ' + hit + ' · 弹速 ' + def.speed + (def.pierce ? ' · 穿透 ' + def.pierce : '');
    if (def.family === 'poison') return cd + ' · 最多 ' + def.targets + ' 只 · 每秒 ' + percent(def.dotPower) + ' 持续 ' + number(def.duration) + ' 秒';
    if (def.family === 'slow') return cd + ' · ' + area + ' · ' + (def.targets || 24) + ' 只 × ' + hit + ' · 减速 ' + percent(def.slow) + ' / Boss ' + percent(def.bossSlow) + ' · ' + number(def.duration) + ' 秒';
    if (def.family === 'execute') return cd + ' · ' + def.targets + ' 只 × ' + hit + ' · 生命低于 ' + percent(def.threshold) + ' 时 ' + percent(def.executePower);
    if (def.family === 'leech') return cd + ' · ' + def.targets + ' 只 × ' + hit + ' · 命中恢复 ' + number(def.healFlat) + ' 生命';
    if (def.family === 'stats') {
      const b = def.bonus;
      if (b.damage) return '至本局结束：伤害 + 初始基础伤害的 ' + percent(b.damage);
      if (b.rate) return '至本局结束：射速 + 初始基础射速的 ' + percent(b.rate);
      if (b.speed) return '至本局结束：移速 + 初始基础移速的 ' + percent(b.speed);
      if (b.maxHp) return '至本局结束：生命上限 +' + b.maxHp + '，立即回复 ' + b.heal;
      if (b.pickup) return '至本局结束：经验拾取半径 +' + b.pickup;
      if (b.xpMult) return '至本局结束：经验倍率 +' + number(b.xpMult) + '；关卡加快释放固定经验，无尽增加实际经验';
      if (b.critChance) return '至本局结束：暴击率 +' + percent(b.critChance) + '，关卡总上限 45%，无尽 70%';
      if (b.pierce) return '至本局结束：平均穿透 +' + b.pierce + '，小数按概率生效；关卡总上限 4.6，无尽 8.6';
      if (b.defense) return '至本局结束：固定减伤 +' + b.defense + '，最终受伤至少 1';
      if (b.regen) return '至本局结束：6 秒未受伤后每秒回复 +' + b.regen + ' 生命';
    }
    return cd + ' · ' + area + ' · 最多 ' + def.targets + ' 只 × ' + hit + (def.repeats ? ' 连击 ' + def.repeats + ' 次' : '');
  }
  window.ORCHARD_RELIC_POINTS = Object.freeze(relics.map((def, index) => Object.freeze({ id: 'slot-' + (index + 1), x: def.x, y: def.y })));
  const all = relics.map((def, index) => ({ ...def, family: families[index], legacy: true })).concat(additions);
  window.ORCHARD_RELICS = Object.freeze(all.map((def, index) => {
    const slot = relics[index % 6];
    const result = { key: def.id, x: slot.x, y: slot.y, ...def, ...(revisions[def.id] || {}) };
    // UI and the catalog derive text from the final configuration, including the
    // original six legacy skills, so old labels cannot survive a rebalance.
    result.summary = describe(result);
    result.description = result.summary + '。技能保留到本局无尽模式，新挑战重置。';
    if (result.bonus) Object.freeze(result.bonus);
    return Object.freeze(result);
  }));
})();
