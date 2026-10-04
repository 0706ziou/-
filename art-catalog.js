/* Original Orchard Guardians artwork. Chapter names match progression.js. */
(() => {
  'use strict';
  const entries = [
    ['青叶入口', 'gate', '#294c3b', '#709a58', '#ad8c58', '#407446', '#ebdc91'],
    ['露水小径', 'dew', '#244b46', '#65a58c', '#9d976e', '#397e6a', '#9ce6ed'],
    ['苔石果园', 'moss', '#354b3b', '#7e9865', '#a19871', '#547b48', '#b7cc8d'],
    ['蜂鸣林地', 'apiary', '#414b2d', '#95a45b', '#c19b51', '#577936', '#ffe07b'],
    ['溪边果坡', 'creek', '#294b42', '#71a479', '#b8a075', '#438361', '#8cddd4'],
    ['藤蔓回廊', 'vines', '#27482d', '#65a052', '#a08756', '#3c772f', '#b5de8b'],
    ['樱红果林', 'cherry', '#4b3f42', '#899b64', '#bc9278', '#667b47', '#f9a0a4'],
    ['斜阳梯田', 'terrace', '#544837', '#a1a158', '#ba8a55', '#746f36', '#f6b877'],
    ['密叶迷径', 'maze', '#233b30', '#507b52', '#8c805b', '#346e45', '#a3c68b'],
    ['厚皮瓜田', 'pumpkin-field', '#494631', '#829249', '#b18c51', '#657343', '#f5b464'],
    ['风暴果坳', 'storm', '#303e4b', '#6d897a', '#969789', '#466f65', '#b7d5f3'],
    ['虫巢外沿', 'hive', '#4a4335', '#7d8050', '#b29361', '#5b6f42', '#f5ce78'],
    ['荆棘环道', 'thorns', '#3e3d44', '#6d8262', '#9c8772', '#476454', '#ccacd6'],
    ['金穗花圃', 'flower', '#485136', '#a0b967', '#c9a869', '#6f9448', '#ffe59b'],
    ['暮色果谷', 'twilight', '#393b52', '#768581', '#9b8893', '#4e766f', '#d6b9ee'],
    ['赤叶深林', 'redleaf', '#503e36', '#a48556', '#bd8756', '#8a5c3a', '#ffba82'],
    ['虫潮裂谷', 'rift', '#3c4547', '#7e9274', '#a1937d', '#556e51', '#badad6'],
    ['南瓜堡垒', 'fortress', '#484532', '#829352', '#b98a53', '#607143', '#f2b064'],
    ['最后一道篱笆', 'fence', '#444939', '#8ea165', '#b19d77', '#617b50', '#f7e3a6'],
    ['果园终极保卫战', 'heart', '#3a4544', '#759d79', '#ba9f6d', '#557c58', '#ffe697']
  ];
  const stages = entries.map(([name, theme, ground, grass, road, tree, accent], i) => Object.freeze({
    id: i + 1, name, theme, image: 'assets/stages/stage-' + String(i + 1).padStart(2, '0') + '.webp',
    sourceImage: 'assets/stages/stage-' + String(i + 1).padStart(2, '0') + '.png',
    palette: Object.freeze({ ground, grass, road, tree, accent })
  }));
  window.ORCHARD_ART = Object.freeze({
    stages: Object.freeze(stages), atlas: 'assets/guardian-atlas.png',
    heroImages: Object.freeze({ cherry: 'assets/heroes/cherry.svg', pear: 'assets/heroes/pear.svg', blueberry: 'assets/heroes/blueberry.svg', pineapple: 'assets/heroes/pineapple.svg' }),
    sprites: Object.freeze({ orange: 0, berry: 1, pumpkin: 2, lime: 3,
      beetle: 4, fly: 5, elite: 6, boss: 7, tree: 8, rock: 9,
      stump: 10, crate: 11, hedge: 12, xp: 13, relic: 14, flower: 15 })
  });
})();
