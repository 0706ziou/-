/*
 * 100位果园伙伴与100位关底首领；每关救援一位，十座果园各住十位。
 * 每位伙伴在对应关卡首通后获救；刚入住为 0 级，最高培养至 5 级。
 * damage / rate 为比例加成，其余为数值加成，均按培养等级累加。
 * 前三关各一位对应首领；4～20关第N关包含前N位首领；后80关采用5～10位短队列。数量、出场节奏由 progression.js 配置。
 * 首领按独立实战时间表登场，上一位未死也不阻挡下一位；暂停、升级和轮盘冻结计时。
 * 首领生命以 10～30 秒的中等成型输出窗口为纸面目标，仍需完整试玩校准；0.9 秒冲刺预警保留。
 */
(() => {
  'use strict';

  const rescues = [
    { id: 1, name: '苹果铃铃', icon: '🍎', color: '#ef7d75', personality: '爱把晨露装成小铃铛，给果园报平安。', bonusType: 'hp', bonusPerLevel: 2 },
    { id: 2, name: '豌豆跳跳', icon: '🫛', color: '#9ed97d', personality: '练习把小石子弹进篮子，偶尔打中自己的帽子。', bonusType: 'rate', bonusPerLevel: .005 },
    { id: 3, name: '梨子绒绒', icon: '🍐', color: '#cde291', personality: '总把落叶叠成软垫，等朋友来歇脚。', bonusType: 'pickup', bonusPerLevel: 2 },
    { id: 4, name: '草莓点点', icon: '🍓', color: '#f38e9b', personality: '喜欢沿着花香奔跑，熟记每条近路。', bonusType: 'speed', bonusPerLevel: 1 },
    { id: 5, name: '蓝莓墨墨', icon: '🫐', color: '#a5a4eb', personality: '用浆果汁画作战图，画完会偷偷舔画笔。', bonusType: 'damage', bonusPerLevel: .006 },
    { id: 6, name: '橘子暖暖', icon: '🍊', color: '#f6bc73', personality: '把晒热的果皮铺进小屋，让雨天也温暖。', bonusType: 'hp', bonusPerLevel: 2 },
    { id: 7, name: '樱桃双双', icon: '🍒', color: '#ed91a1', personality: '和自己的倒影比谁射得快，从来不认输。', bonusType: 'rate', bonusPerLevel: .005 },
    { id: 8, name: '桃子团团', icon: '🍑', color: '#efb5ae', personality: '收集圆滚滚的小果核，给每颗取名字。', bonusType: 'pickup', bonusPerLevel: 2 },
    { id: 9, name: '葡萄蹦蹦', icon: '🍇', color: '#c0a0df', personality: '沿藤蔓练跳高，摔下来就装作在摘露水。', bonusType: 'speed', bonusPerLevel: 1 },
    { id: 10, name: '西瓜盾盾', icon: '🍉', color: '#8fd2a1', personality: '每天打磨自己的瓜皮盾，愿意站在朋友前面。', bonusType: 'damage', bonusPerLevel: .006 },
    { id: 11, name: '柠檬亮亮', icon: '🍋', color: '#efdf82', personality: '替大家熬醒神果茶，酸得虫子直打喷嚏。', bonusType: 'hp', bonusPerLevel: 2 },
    { id: 12, name: '玉米粒粒', icon: '🌽', color: '#e8d490', personality: '数清每一颗种子，发射节拍永远不乱。', bonusType: 'rate', bonusPerLevel: .005 },
    { id: 13, name: '猕猴桃茸茸', icon: '🥝', color: '#bfd198', personality: '用毛绒小口袋收露珠，常常装到满出来。', bonusType: 'pickup', bonusPerLevel: 2 },
    { id: 14, name: '香蕉弯弯', icon: '🍌', color: '#f0dd85', personality: '把弯弯果皮当滑梯，总是第一个滑到终点。', bonusType: 'speed', bonusPerLevel: 1 },
    { id: 15, name: '菠萝刺刺', icon: '🍍', color: '#dabd79', personality: '看起来不好接近，其实偷偷替大家修篱笆。', bonusType: 'damage', bonusPerLevel: .006 },
    { id: 16, name: '胡萝卜芽芽', icon: '🥕', color: '#f4a874', personality: '研究松软土壤，能把受伤嫩芽照顾得精神满满。', bonusType: 'hp', bonusPerLevel: 2 },
    { id: 17, name: '番茄红红', icon: '🍅', color: '#e88177', personality: '唱歌总抢半拍，连种子也跟着加快节奏。', bonusType: 'rate', bonusPerLevel: .005 },
    { id: 18, name: '南瓜灯灯', icon: '🎃', color: '#f1b16c', personality: '夜里点起果核灯，替迷路伙伴照亮回家的路。', bonusType: 'pickup', bonusPerLevel: 2 },
    { id: 19, name: '芒果晃晃', icon: '🥭', color: '#f2c879', personality: '在树枝间荡秋千，把每次冒险都当旅行。', bonusType: 'speed', bonusPerLevel: 1 },
    { id: 20, name: '椰子船船', icon: '🥥', color: '#d4baa0', personality: '驾着果壳小船守住溪口，梦想让整座果园安宁。', bonusType: 'damage', bonusPerLevel: .006 }
  ];

  // Local portraits avoid relying on newer emoji fonts for rescued companions.
  const spriteImages = [
    'assets/sprites/apple.svg', 'assets/sprites/pea.svg', 'assets/sprites/pear.svg',
    'assets/sprites/strawberry.svg', 'assets/sprites/blueberry.svg', 'assets/sprites/orange.svg',
    'assets/sprites/cherry.svg', 'assets/sprites/peach.svg', 'assets/sprites/grape.svg',
    'assets/sprites/watermelon.svg', 'assets/sprites/lemon.svg', 'assets/sprites/corn.svg',
    'assets/sprites/kiwi.svg', 'assets/sprites/banana.svg', 'assets/sprites/pineapple.svg',
    'assets/sprites/carrot.svg', 'assets/sprites/tomato.svg', 'assets/sprites/pumpkin.svg',
    'assets/sprites/mango.svg', 'assets/sprites/coconut.svg'
  ];
  rescues.forEach((sprite, index) => { sprite.image = spriteImages[index]; sprite.artVariant = 0; });

  const gardens = ['青叶小院', '溪畔果园', '月露花园', '潮汐果园', '赤焰果园', '藤影果园', '霜晶果园', '雪芽果园', '星辉果园', '天穹果园'];
  const rescueRegions = ['月露', '赤焰', '霜晶', '星辉'];
  const regionStories = ['喜欢收集月光，替晚归的伙伴点灯。', '喜欢照顾暖阳下的花苗，每天给大家准备果茶。', '擅长保护雪里的嫩芽，盼着朋友一起看春天。', '把星星画成地图，带伙伴寻找新的果树。'];
  for (let id = 21; id <= 100; id++) {
    const base = rescues[(id - 1) % 20], region = Math.floor((id - 21) / 20);
    rescues.push({ ...base, id, name: rescueRegions[region] + base.name, artVariant: region + 1,
      personality: regionStories[region], bonusPerLevel: base.bonusPerLevel / 2 });
  }
  for (const sprite of rescues) sprite.gardenId = Math.ceil(sprite.id / 10);
  window.ORCHARD_GARDENS = Object.freeze(gardens.map((name, index) => Object.freeze({ id: index + 1, name, firstStage: index * 10 + 1, lastStage: index * 10 + 10 })));

  const bosses = [
    { stageId: 1, name: '铁壳拦路虫', hp: 1600, speed: 76, damage: 22, radius: 32, color: '#9fa970', chargeInterval: 7, chargeSpeed: 250 },
    { stageId: 2, name: '露珠锹甲', hp: 1830, speed: 78, damage: 23, radius: 33, color: '#86b7aa', chargeInterval: 7, chargeSpeed: 254 },
    { stageId: 3, name: '苔背大甲虫', hp: 2070, speed: 80, damage: 24, radius: 33, color: '#91ac75', chargeInterval: 6.9, chargeSpeed: 258 },
    { stageId: 4, name: '蜂鸣重卫', hp: 2320, speed: 82, damage: 25, radius: 34, color: '#caba72', chargeInterval: 6.8, chargeSpeed: 262 },
    { stageId: 5, name: '溪石硬壳王', hp: 2580, speed: 84, damage: 26, radius: 35, color: '#93b8bd', chargeInterval: 6.7, chargeSpeed: 266 },
    { stageId: 6, name: '藤刺掘地虫', hp: 2850, speed: 86, damage: 27, radius: 35, color: '#9fb77e', chargeInterval: 6.6, chargeSpeed: 270 },
    { stageId: 7, name: '樱红犀甲', hp: 3130, speed: 88, damage: 28, radius: 36, color: '#d6938c', chargeInterval: 6.5, chargeSpeed: 274 },
    { stageId: 8, name: '斜阳金翅虫', hp: 3420, speed: 90, damage: 29, radius: 36, color: '#d5ba7d', chargeInterval: 6.4, chargeSpeed: 278 },
    { stageId: 9, name: '密叶角斗虫', hp: 3720, speed: 93, damage: 30, radius: 37, color: '#82a18e', chargeInterval: 6.3, chargeSpeed: 282 },
    { stageId: 10, name: '瓜田巨盾虫', hp: 4030, speed: 96, damage: 32, radius: 39, color: '#b1b77d', chargeInterval: 6.2, chargeSpeed: 286 },
    { stageId: 11, name: '风暴钳甲', hp: 4350, speed: 99, damage: 33, radius: 38, color: '#99a8c4', chargeInterval: 6.1, chargeSpeed: 290 },
    { stageId: 12, name: '虫巢门卫', hp: 4680, speed: 102, damage: 34, radius: 39, color: '#b1a3be', chargeInterval: 6, chargeSpeed: 294 },
    { stageId: 13, name: '荆棘刃甲', hp: 5020, speed: 105, damage: 35, radius: 39, color: '#b58c94', chargeInterval: 5.9, chargeSpeed: 298 },
    { stageId: 14, name: '金穗掠夺者', hp: 5370, speed: 108, damage: 36, radius: 40, color: '#dac47c', chargeInterval: 5.8, chargeSpeed: 302 },
    { stageId: 15, name: '暮色重角虫', hp: 5730, speed: 111, damage: 38, radius: 40, color: '#b299c0', chargeInterval: 5.7, chargeSpeed: 306 },
    { stageId: 16, name: '赤叶铁钳王', hp: 6100, speed: 114, damage: 40, radius: 41, color: '#d0937d', chargeInterval: 5.6, chargeSpeed: 310 },
    { stageId: 17, name: '裂谷震地甲', hp: 6510, speed: 117, damage: 42, radius: 42, color: '#aaa092', chargeInterval: 5.4, chargeSpeed: 314 },
    { stageId: 18, name: '南瓜破城虫', hp: 7010, speed: 120, damage: 44, radius: 42, color: '#d5aa7d', chargeInterval: 5.2, chargeSpeed: 318 },
    { stageId: 19, name: '篱笆噬木王', hp: 7660, speed: 123, damage: 46, radius: 43, color: '#b7aa7f', chargeInterval: 5, chargeSpeed: 322 },
    { stageId: 20, name: '黑冠虫群领主', hp: 8500, speed: 126, damage: 48, radius: 44, color: '#a7a0c4', chargeInterval: 4.8, chargeSpeed: 326 }
  ];

  const regions = ['月露', '赤焰', '霜晶', '星辉'];
  for (let id = 21; id <= 100; id++) {
    const source = bosses[(id - 1) % 20], step = id - 20;
    bosses.push({ ...source, stageId: id, name: regions[Math.floor((id - 21) / 20)] + ' · ' + source.name,
      hp: Math.round(8500 * (1 + step * .024)), speed: Math.min(145, 126 + step * .22),
      damage: Math.round(48 * (1 + step * .006)), radius: 44,
      chargeInterval: Math.max(4, 4.8 - step * .01), chargeSpeed: Math.min(350, 326 + step * .3) });
  }
  window.ORCHARD_RESCUES = Object.freeze(rescues.map(Object.freeze));
  window.ORCHARD_BOSSES = Object.freeze(bosses.map(Object.freeze));
})();
