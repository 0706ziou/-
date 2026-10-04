// Refresh the XP columns and the detailed progression report from shipped data.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const sandbox = { window: {} };
vm.createContext(sandbox);
for (const file of ['experience-data.js', 'progression.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), sandbox, { filename: file });
}
const experience = sandbox.window.ORCHARD_EXPERIENCE;
const stages = sandbox.window.ORCHARD_STAGES;
const range = value => value.min === value.max ? String(value.min) : value.min + '～' + value.max;
const tablePath = path.join(root, '20关数值表.txt');
let activeStage;
const table = fs.readFileSync(tablePath, 'utf8').split(/\r?\n/).map(line => {
  const heading = line.match(/^(\d{2}) .+（共\d+个敌人）$/);
  if (heading) activeStage = stages.find(stage => stage.id === Number(heading[1]));
  if (!activeStage) return line;
  for (const [label, type] of [['普通甲虫', 'slow'], ['普通飞虫', 'fast'], ['精英', 'elite']]) {
    if (line.startsWith('  ' + label + '：')) return line.replace(/ \/ [^/]+$/, ' / ' + range(activeStage.experience.ranges[type]));
  }
  if (line.startsWith('  每只Boss经验：')) return '  每只Boss经验：' + range(activeStage.experience.ranges.boss) +
    '；全关精确10,000经验，30次升级（LV.1 → LV.31，经验增益提前发放储备）';
  return line;
}).join('\n');
fs.writeFileSync(tablePath, table, 'utf8');
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
report.push('', '第一关节奏对照（基础倍率、按配置顺序击杀普通怪并立即拾取）',
  '首次升级：第4只 → 第8只普通怪。',
  '前20只普通怪：5次 → 2次升级；新经验合计470点。',
  '前40只普通怪：10次 → 4次升级。',
  '前80只普通怪：16次 → 9次升级。',
  '整关：40次 → 30次升级。',
  '不同击杀顺序、精英/Boss和经验加成会改变到达升级门槛的时机。',
  '少10次成长会降低通关时的构筑战力；剩余词条可在无尽继续培养。',
  '完整通关率和长局操作手感需要实际试玩校准。', '');
fs.writeFileSync(path.join(root, '经验升级数值表.txt'), report.join('\n'), 'utf8');
console.log('Updated chapter XP columns, ' + stages.length + ' chapter reward rows and 60 level thresholds.');
