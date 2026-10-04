// Refresh the XP columns and the detailed progression report from shipped data.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const sandbox = { window: {} };
vm.createContext(sandbox);
for (const file of ['experience-data.js', 'progression.js', 'orchard-data.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), sandbox, { filename: file });
}
const experience = sandbox.window.ORCHARD_EXPERIENCE;
const stages = sandbox.window.ORCHARD_STAGES;
const range = value => value.min === value.max ? String(value.min) : value.min + '～' + value.max;
const tablePath = path.join(root, '20关数值表.txt');
const table = ['果园保卫战 — 前20关实际数值表', '',
  '前三关为新手关：72/96/120只普通虫，1/2/3只精英，各1位虫王；脱离伤害3秒后每秒恢复2生命。',
  '第四关起保留原强度。所有关卡同时最多1位Boss，后续Boss需等待前一位被击杀及12秒喘息。',
  '每关精确10,000经验，完整清剿提供30次升级。经验加成提前发放固定储备，不增加最终总量。',
  '新账号首次通关解锁装备、英雄、果园、世界并触发点击指引；第二关首通再指引装备、英雄、果园。',
  '格式：数量 / 生命 / 移速 / 接触伤害 / 掉落经验。', ''];
for (const stage of stages.slice(0,20)) {
  table.push(String(stage.id).padStart(2,'0')+' '+stage.name+'（共'+stage.enemyCount+'个敌人）');
  for (const [label,type,count] of [['普通甲虫','slow',stage.normalCount-stage.fastCount],['普通飞虫','fast',stage.fastCount],['精英','elite',stage.eliteCount]]) {
    const stats=stage[type];table.push('  '+label+'：'+[count,stats.hp,stats.speed,stats.damage,range(stage.experience.ranges[type])].join(' / '));
  }
  table.push('  普通追击：开局'+stage.initialPursuers+'，每'+stage.pursuitInterval+'秒新增'+stage.batchSize,
    '  精英追击：'+stage.eliteFirstAt+'秒首批，每'+stage.eliteInterval+'秒新增'+stage.eliteBatchSize,
    '  Boss时间资格：'+stage.bossSchedule.join('/')+'秒（同时最多1位）');
  for(const id of stage.bossIds) {const boss=sandbox.window.ORCHARD_BOSSES[id-1],b=stage.beginner;table.push('  Boss '+id+' '+boss.name+'：生命'+(b?.bossHp??boss.hp)+' / 移速'+(b?.bossSpeed??boss.speed)+' / 伤害'+(b?.bossDamage??boss.damage)+' / 冲刺速度'+(b?.chargeSpeed??boss.chargeSpeed));}
  table.push('  每只Boss经验：'+range(stage.experience.ranges.boss), '  通关奖励：阳光籽'+stage.reward.seeds+'，果核'+stage.reward.cores, '');
}
fs.writeFileSync(tablePath, table.join('\n'), 'utf8');
const report = [
  '果园保卫战 — 经验掉落与逐级升级数值', '',
  '每关总经验：10,000；完整清剿提供30次升级，从LV.1到LV.31。',
  '经验加成提前发放本关预算，不增加最终升级次数；无尽经验不受本关预算限制。',
  '下表“本级经验条”是从当前等级升到下一等级所需经验；“累计”从LV.1开始计算。', '',
  'LV.41起需求为 round(10 + 7×(等级−1) + 0.35×(等级−1)²)，后续等级继续按此公式递增。', '',
  '关卡与无尽逐级门槛（LV.31起为无尽成长）',
  '当前等级 → 下一等级 | 本级经验条 | 累计到下一等级'
];
let cumulative = 0;
for (let level = 1; level <= 60; level++) {
  const cost = experience.need(level);
  cumulative += cost;
  report.push('LV.' + level + ' → LV.' + (level + 1) + ' | ' + cost + ' | ' + cumulative);
}
report.push('', '各关单只敌人经验（基础倍率）', '关卡 | 甲虫 | 飞虫 | 精英 | Boss');
for (const stage of stages) {
  report.push(String(stage.id).padStart(2, '0') + ' ' + stage.name + ' | ' +
    ['slow', 'fast', 'elite', 'boss'].map(type => range(stage.experience.ranges[type])).join(' | '));
}
report.push('', '第一关成长节奏（基础倍率、按配置顺序击杀普通虫并立即拾取）');
const opening=stages[0];let first=0,earned=0;
for(let index=0;index<opening.normalCount;index++){earned+=opening.xpRewards[index];if(earned>=experience.need(1)){first=index+1;break;}}
report.push('首次升级：第'+first+'只普通虫。');
for(const count of [20,40,opening.normalCount]) {const total=opening.xpRewards.slice(0,count).reduce((a,b)=>a+b,0);let rest=total,level=1;while(rest>=experience.need(level)){rest-=experience.need(level);level++;}report.push('前'+count+'只普通虫：'+total+'经验，'+(level-1)+'次升级。');}
report.push('完整清剿：10,000经验、30次升级。不同击杀顺序及经验加成会改变升级时机。','');
fs.writeFileSync(path.join(root, '经验升级数值表.txt'), report.join('\n'), 'utf8');
console.log('Updated chapter XP columns, ' + stages.length + ' chapter reward rows and 60 level thresholds.');
