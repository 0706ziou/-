/*
 * 果园远征：20 关独立配置。固定 398 普通虫、6→44 精英与前 N 位累计 Boss。
 * Boss 时间仅授予登场资格：首关 60 秒、第二关 65 / 110 秒，后期首位 60 秒。
 * 所有关卡同时最多 1 位 Boss；击败后额外 12 秒喘息，再按资格排程逐位放行。
 * 普通追击开局 20→36，每批 20→32，间隔 10→7 秒；精英首批 16→12 秒。
 * 普通、精英和 Boss 按不同压力曲线分别调校，飞虫始终慢于基础玩家 205 移速。
 * 表中 XP 字段仅是相对权重；每关精确分配 13,046 XP，完成 40 次关卡构筑选择。
 * 经验加成提前发放固定储备，不增关卡总量；动画、暂停与升级冻结战斗排程。
 */
(() => {
  'use strict';
  const stages = [
    {
      id: 1, name: '青叶入口', description: '用第一分钟熟悉移动与短暂停步；精英16秒后加入，虫王60秒登场。',
      fastCount: 140,
      slow: { hp: 44, speed: 76, damage: 14, xp: 2 },
      fast: { hp: 30, speed: 126, damage: 10, xp: 3 },
      initialPursuers: 20, batchSize: 20, pursuitInterval: 10,
      eliteStats: { hp: 110, speed: 108, damage: 18 },
      eliteFirstAt: 16, eliteInterval: 8.8, eliteBatchSize: 1,
      bossFirstAt: 60, bossInterval: 45,
      reward: { seeds: 54, cores: 2 }, firstClearGear: null
    },
    {
      id: 2, name: '露水小径', description: '先积累伤害与射速；65秒迎来旧虫王，110秒后再挑战露珠锹甲。',
      fastCount: 132,
      slow: { hp: 49, speed: 78, damage: 15, xp: 2 },
      fast: { hp: 33, speed: 129, damage: 10, xp: 3 },
      initialPursuers: 20, batchSize: 20, pursuitInterval: 9.8,
      eliteStats: { hp: 124, speed: 110, damage: 19 },
      eliteFirstAt: 16, eliteInterval: 8.7, eliteBatchSize: 1,
      bossFirstAt: 65, bossInterval: 45,
      reward: { seeds: 63, cores: 2 }, firstClearGear: 'weapon_pea'
    },
    {
      id: 3, name: '苔石果园', description: '利用苔石边缘清出退路；每45秒轮到一位虫王，击败后仍有喘息时间。',
      fastCount: 144,
      slow: { hp: 55, speed: 80, damage: 15, xp: 2 },
      fast: { hp: 37, speed: 132, damage: 11, xp: 3 },
      initialPursuers: 22, batchSize: 20, pursuitInterval: 9.6,
      eliteStats: { hp: 140, speed: 112, damage: 20 },
      eliteFirstAt: 16, eliteInterval: 8.6, eliteBatchSize: 1,
      bossFirstAt: 65, bossInterval: 45,
      reward: { seeds: 72, cores: 2 }, firstClearGear: 'armor_bark'
    },
    {
      id: 4, name: '蜂鸣林地', description: '飞虫占比增加，沿林间空隙横移；精英单只加入，别站在两侧虫群中间。',
      fastCount: 168,
      slow: { hp: 61, speed: 83, damage: 16, xp: 2 },
      fast: { hp: 41, speed: 136, damage: 11, xp: 3 },
      initialPursuers: 22, batchSize: 22, pursuitInterval: 9.4,
      eliteStats: { hp: 158, speed: 115, damage: 20 },
      eliteFirstAt: 15.5, eliteInterval: 8.5, eliteBatchSize: 1,
      bossFirstAt: 65, bossInterval: 42,
      reward: { seeds: 81, cores: 3 }, firstClearGear: null
    },
    {
      id: 5, name: '溪边果坡', description: '桥头集中火力，移动时留出另一座桥；虫王之间至少40秒排程间距。',
      fastCount: 148,
      slow: { hp: 68, speed: 85, damage: 17, xp: 3 },
      fast: { hp: 45, speed: 139, damage: 12, xp: 4 },
      initialPursuers: 24, batchSize: 22, pursuitInterval: 9.2,
      eliteStats: { hp: 180, speed: 118, damage: 21 },
      eliteFirstAt: 15.5, eliteInterval: 8.4, eliteBatchSize: 1,
      bossFirstAt: 64, bossInterval: 40,
      reward: { seeds: 93, cores: 3 }, firstClearGear: 'charm_bloom'
    },
    {
      id: 6, name: '藤蔓回廊', description: '双只精英批次开始，先拆掉一侧；沿藤廊边退边收经验。',
      fastCount: 164,
      slow: { hp: 76, speed: 88, damage: 18, xp: 3 },
      fast: { hp: 50, speed: 143, damage: 12, xp: 4 },
      initialPursuers: 24, batchSize: 24, pursuitInterval: 9,
      eliteStats: { hp: 204, speed: 121, damage: 22 },
      eliteFirstAt: 15, eliteInterval: 8.3, eliteBatchSize: 2,
      bossFirstAt: 64, bossInterval: 38,
      reward: { seeds: 105, cores: 3 }, firstClearGear: null
    },
    {
      id: 7, name: '樱红果林', description: '飞虫继续提速，优先清理贴身目标；精英之间仍保留输出与拾取窗口。',
      fastCount: 176,
      slow: { hp: 85, speed: 90, damage: 18, xp: 3 },
      fast: { hp: 56, speed: 147, damage: 13, xp: 4 },
      initialPursuers: 24, batchSize: 24, pursuitInterval: 8.9,
      eliteStats: { hp: 230, speed: 124, damage: 23 },
      eliteFirstAt: 15, eliteInterval: 8.2, eliteBatchSize: 2,
      bossFirstAt: 63, bossInterval: 36,
      reward: { seeds: 117, cores: 5 }, firstClearGear: 'weapon_cherry'
    },
    {
      id: 8, name: '斜阳梯田', description: '利用梯田转角聚拢虫群，短暂停步打开缺口；不要连续硬吃精英攻击。',
      fastCount: 184,
      slow: { hp: 95, speed: 93, damage: 19, xp: 3 },
      fast: { hp: 62, speed: 151, damage: 14, xp: 4 },
      initialPursuers: 26, batchSize: 24, pursuitInterval: 8.8,
      eliteStats: { hp: 258, speed: 127, damage: 24 },
      eliteFirstAt: 14.5, eliteInterval: 8.1, eliteBatchSize: 2,
      bossFirstAt: 63, bossInterval: 34,
      reward: { seeds: 129, cores: 5 }, firstClearGear: null
    },
    {
      id: 9, name: '密叶迷径', description: '飞虫接近半数，交替横移与站定；虫王只会逐只登场。',
      fastCount: 196,
      slow: { hp: 106, speed: 96, damage: 20, xp: 3 },
      fast: { hp: 69, speed: 155, damage: 14, xp: 4 },
      initialPursuers: 26, batchSize: 26, pursuitInterval: 8.6,
      eliteStats: { hp: 288, speed: 130, damage: 25 },
      eliteFirstAt: 14.5, eliteInterval: 8, eliteBatchSize: 2,
      bossFirstAt: 62, bossInterval: 32,
      reward: { seeds: 141, cores: 5 }, firstClearGear: null
    },
    {
      id: 10, name: '厚皮瓜田', description: '中段厚壳试炼，形成至少一种攻击技能再迎战；Boss排程间隔30秒。',
      fastCount: 176,
      slow: { hp: 118, speed: 99, damage: 21, xp: 4 },
      fast: { hp: 76, speed: 159, damage: 15, xp: 5 },
      initialPursuers: 28, batchSize: 26, pursuitInterval: 8.4,
      eliteStats: { hp: 320, speed: 133, damage: 26 },
      eliteFirstAt: 14, eliteInterval: 7.8, eliteBatchSize: 2,
      bossFirstAt: 62, bossInterval: 30,
      reward: { seeds: 159, cores: 6 }, firstClearGear: 'armor_rind'
    },
    {
      id: 11, name: '风暴果坳', description: '风暴虫群更耐打，先清出移动走廊；避免在转角被精英封住。',
      fastCount: 192,
      slow: { hp: 130, speed: 102, damage: 22, xp: 4 },
      fast: { hp: 84, speed: 163, damage: 16, xp: 5 },
      initialPursuers: 28, batchSize: 26, pursuitInterval: 8.3,
      eliteStats: { hp: 354, speed: 136, damage: 27 },
      eliteFirstAt: 14, eliteInterval: 7.7, eliteBatchSize: 2,
      bossFirstAt: 61, bossInterval: 29,
      reward: { seeds: 174, cores: 6 }, firstClearGear: null
    },
    {
      id: 12, name: '虫巢外沿', description: '飞虫过半，进攻后及时撤步拾取；三类敌人独立计时登场。',
      fastCount: 200,
      slow: { hp: 142, speed: 105, damage: 23, xp: 4 },
      fast: { hp: 92, speed: 167, damage: 17, xp: 5 },
      initialPursuers: 28, batchSize: 28, pursuitInterval: 8.1,
      eliteStats: { hp: 390, speed: 139, damage: 28 },
      eliteFirstAt: 13.5, eliteInterval: 7.6, eliteBatchSize: 2,
      bossFirstAt: 61, bossInterval: 28,
      reward: { seeds: 189, cores: 6 }, firstClearGear: null
    },
    {
      id: 13, name: '荆棘环道', description: '高速飞虫围绕荆棘压缩退路，站定蓄力前先观察下一段通道。',
      fastCount: 216,
      slow: { hp: 154, speed: 108, damage: 24, xp: 4 },
      fast: { hp: 100, speed: 171, damage: 17, xp: 5 },
      initialPursuers: 30, batchSize: 28, pursuitInterval: 8,
      eliteStats: { hp: 428, speed: 142, damage: 29 },
      eliteFirstAt: 13.5, eliteInterval: 7.4, eliteBatchSize: 2,
      bossFirstAt: 60, bossInterval: 27,
      reward: { seeds: 207, cores: 8 }, firstClearGear: null
    },
    {
      id: 14, name: '金穗花圃', description: '精英生命继续增加，利用花圃通路分割虫团；虫王逐只通过试炼。',
      fastCount: 208,
      slow: { hp: 166, speed: 111, damage: 25, xp: 4 },
      fast: { hp: 108, speed: 175, damage: 18, xp: 5 },
      initialPursuers: 30, batchSize: 28, pursuitInterval: 7.8,
      eliteStats: { hp: 468, speed: 145, damage: 30 },
      eliteFirstAt: 13, eliteInterval: 7.3, eliteBatchSize: 2,
      bossFirstAt: 60, bossInterval: 26,
      reward: { seeds: 225, cores: 8 }, firstClearGear: 'charm_harvest'
    },
    {
      id: 15, name: '暮色果谷', description: '每批三只精英开始，先击杀最近的一只；攻击与生存培养交替搭配。',
      fastCount: 220,
      slow: { hp: 179, speed: 114, damage: 26, xp: 5 },
      fast: { hp: 116, speed: 179, damage: 19, xp: 6 },
      initialPursuers: 32, batchSize: 30, pursuitInterval: 7.7,
      eliteStats: { hp: 500, speed: 148, damage: 31 },
      eliteFirstAt: 13, eliteInterval: 7.2, eliteBatchSize: 3,
      bossFirstAt: 60, bossInterval: 25,
      reward: { seeds: 246, cores: 9 }, firstClearGear: null
    },
    {
      id: 16, name: '赤叶深林', description: '飞虫逼近但仍慢于基础英雄，借转向拉开距离；站定时保持退路。',
      fastCount: 228,
      slow: { hp: 192, speed: 117, damage: 27, xp: 5 },
      fast: { hp: 124, speed: 182, damage: 20, xp: 6 },
      initialPursuers: 32, batchSize: 30, pursuitInterval: 7.5,
      eliteStats: { hp: 530, speed: 151, damage: 32 },
      eliteFirstAt: 12.5, eliteInterval: 7.1, eliteBatchSize: 3,
      bossFirstAt: 60, bossInterval: 24,
      reward: { seeds: 267, cores: 9 }, firstClearGear: null
    },
    {
      id: 17, name: '虫潮裂谷', description: '甲虫更密集，散射与穿透覆盖前排；裂谷边缘避免连续受击。',
      fastCount: 216,
      slow: { hp: 205, speed: 120, damage: 28, xp: 5 },
      fast: { hp: 132, speed: 185, damage: 20, xp: 6 },
      initialPursuers: 34, batchSize: 30, pursuitInterval: 7.4,
      eliteStats: { hp: 560, speed: 154, damage: 33 },
      eliteFirstAt: 12.5, eliteInterval: 7, eliteBatchSize: 3,
      bossFirstAt: 60, bossInterval: 24,
      reward: { seeds: 291, cores: 11 }, firstClearGear: null
    },
    {
      id: 18, name: '南瓜堡垒', description: '每批32只普通虫，城门口留出撤退路线；高血量Boss需技能集中输出。',
      fastCount: 232,
      slow: { hp: 218, speed: 123, damage: 29, xp: 5 },
      fast: { hp: 140, speed: 188, damage: 21, xp: 7 },
      initialPursuers: 34, batchSize: 32, pursuitInterval: 7.2,
      eliteStats: { hp: 590, speed: 157, damage: 34 },
      eliteFirstAt: 12, eliteInterval: 6.8, eliteBatchSize: 3,
      bossFirstAt: 60, bossInterval: 23,
      reward: { seeds: 318, cores: 11 }, firstClearGear: 'weapon_pumpkin'
    },
    {
      id: 19, name: '最后一道篱笆', description: '飞虫最多且速度较高，别让虫团在篱笆口汇合；优先清理近身精英。',
      fastCount: 248,
      slow: { hp: 232, speed: 126, damage: 30, xp: 5 },
      fast: { hp: 148, speed: 190, damage: 22, xp: 7 },
      initialPursuers: 36, batchSize: 32, pursuitInterval: 7.1,
      eliteStats: { hp: 620, speed: 160, damage: 35 },
      eliteFirstAt: 12, eliteInterval: 6.7, eliteBatchSize: 3,
      bossFirstAt: 60, bossInterval: 22,
      reward: { seeds: 351, cores: 12 }, firstClearGear: null
    },
    {
      id: 20, name: '果园终极保卫战', description: '终局按顺序挑战20位虫王，始终只面对一位；击杀后有12秒喘息再迎下一位。',
      fastCount: 236,
      slow: { hp: 246, speed: 129, damage: 32, xp: 6 },
      fast: { hp: 156, speed: 192, damage: 23, xp: 7 },
      initialPursuers: 36, batchSize: 32, pursuitInterval: 7,
      eliteStats: { hp: 650, speed: 163, damage: 37 },
      eliteFirstAt: 12, eliteInterval: 6.6, eliteBatchSize: 3,
      bossFirstAt: 60, bossInterval: 22,
      reward: { seeds: 405, cores: 15 }, firstClearGear: null
    }
  ];
  window.ORCHARD_STAGES = Object.freeze(stages.map(stage => {
    const normalCount = 398;
    const eliteCount = 4 + stage.id * 2;
    const bossCount = stage.id;
    const bossSchedule = Object.freeze(Array.from({ length: bossCount }, (_, index) =>
      Number((stage.bossFirstAt + index * stage.bossInterval).toFixed(1))
    ));
    const { eliteStats, ...source } = stage;
    const configured = {
      ...source,
      normalCount,
      eliteCount,
      elite: Object.freeze({ ...eliteStats, xp: stage.slow.xp * 4 }),
      bossCount,
      bossIds: Object.freeze(Array.from({ length: bossCount }, (_, i) => i + 1)),
      bossSchedule,
      bossActiveCap: 1,
      bossRecovery: 12,
      enemyCount: normalCount + eliteCount + bossCount,
      slow: Object.freeze(stage.slow),
      fast: Object.freeze(stage.fast),
      reward: Object.freeze(stage.reward)
    };
    configured.xpRewards = window.ORCHARD_EXPERIENCE.assign(configured);
    configured.experience = window.ORCHARD_EXPERIENCE.summary(configured);
    return Object.freeze(configured);
  }));
})();
