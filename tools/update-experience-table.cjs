// Regenerate balance documentation from the shipped runtime, without hand-copied tables.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),context={window:{}};vm.createContext(context);
for(const file of ['experience-data.js','progression.js','orchard-data.js'])vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),context);
const xp=context.window.ORCHARD_EXPERIENCE,stages=context.window.ORCHARD_STAGES,pressure=context.window.ORCHARD_PRESSURE;
const range = value => value.min === value.max ? String(value.min) : value.min + '～' + value.max;
const tablePath = path.join(root, '20关数值表.txt');
const table = ['果园保卫战 — 前20关实际数值表', '',
  '前三关为新手关：72/96/120只普通虫，1/2/3只精英，各1位虫王；脱离伤害3秒后每秒恢复2生命。',
  '第四关起保留原强度。所有关卡同时最多1位Boss，后续Boss需等待前一位被击杀及12秒喘息。',
  '普通虫提供经验，前两关经验降低45%；精英轮盘抽1个，Boss抽3个肉鸽词条。经验加成不增加本关经验总量。清场剩余成长及最后轮盘进入无尽后领取。',
  '新账号首次通关解锁装备、英雄、果园、世界并触发点击指引；第二关起不再重复养成指引。',
  '以下为基础数值；后续登场怪物随实战时间增强，完整倍率与升级次数见经验升级数值表.txt。',
  '格式：数量 / 生命 / 移速 / 接触伤害 / 掉落经验。', ''];
for (const stage of stages.slice(0,20)) {
  table.push(String(stage.id).padStart(2,'0')+' '+stage.name+'（共'+stage.enemyCount+'个敌人）');
  for (const [label,type,count] of [['普通甲虫','slow',stage.normalCount-stage.fastCount],['普通飞虫','fast',stage.fastCount],['精英','elite',stage.eliteCount]]) {
    const stats=stage[type];table.push('  '+label+'：'+[count,stats.hp,stats.speed,stats.damage,range(stage.experience.ranges[type])].join(' / '));
  }
  table.push('  普通追击：开局'+stage.initialPursuers+'，每'+stage.pursuitInterval+'秒新增'+stage.batchSize,
    '  精英追击：'+stage.eliteFirstAt+'秒首批，每'+stage.eliteInterval+'秒新增'+stage.eliteBatchSize,
    '  Boss时间资格：'+stage.bossSchedule.join('/')+'秒（同时最多1位）');
  for(const id of stage.bossIds) {const boss=context.window.ORCHARD_BOSSES[id-1],b=stage.beginner;table.push('  Boss '+id+' '+boss.name+'：生命'+(b?.bossHp??boss.hp)+' / 移速'+(b?.bossSpeed??boss.speed)+' / 伤害'+(b?.bossDamage??boss.damage)+' / 冲刺速度'+(b?.chargeSpeed??boss.chargeSpeed));}
  table.push('  每只Boss经验：'+range(stage.experience.ranges.boss), '  通关奖励：阳光籽'+stage.reward.seeds+'，果核'+stage.reward.cores, '');
}
fs.writeFileSync(tablePath, table.join('\n'), 'utf8');
const lines=['果园保卫战 — 递增成长与时间压力数值','',
 '设计目标：开局较快获得成长，随后逐步变慢；秒数仅用于校准手感，不是自动升级倒计时。',
 '升级需求：140 + 53×(当前等级−1) + 4×(当前等级−1)²。关卡与无尽沿用同一条平滑曲线，不在LV.31或LV.41跳回低需求。',
 '参考收集速度为40经验/实战秒，仅用于横向比较；真实时间由击杀、拾取、英雄和经验加成共同决定。',
 '正式关卡另有短防连弹窗口：min(8, 2.5 + 1.8×sqrt(当前等级−1)) 秒，四舍五入到0.1秒。',
 '开局使用LV.1窗口；选完升级后使用新的当前等级窗口。经验达标且窗口结束才弹窗；窗口不替代经验要求。',
 '等待时继续积累经验，不扣除、不丢失；暂停、轮盘、菜单不计入实战时间。',
 '新手教学仍需180经验且不使用防连弹窗口；无尽使用新的经验曲线，但不延迟通关储备结算。','',
 '经验总量与轮盘：',
 '怪物掉落仍按10000经验的固定分配基准计算；精英/Boss份额由轮盘替代，经验为0；前两关普通经验再乘55%。',
 '本次只提高中后期升级成本，不提高掉落量。前两关各4536/4560经验，可支持9次经验升级，精英/Boss仍抽1/3个词条。',
 '经验加成提前发放本关预算，不改变完整预算支持的升级次数；清场后未领取的成长与最后轮盘在无尽领取。',
 '下表为消耗整关预算后的理论上限，不保证通关前所有经验选择都已弹完。','',
 '逐级成本（当前等级 → 下一等级 | 本级经验 | 累计经验 | 40经验/秒下的单级参考时间 | 关卡防连弹窗口）'];
for(let level=1;level<=60;level++)lines.push(`LV.${level} → LV.${level+1} | ${xp.need(level)} | ${xp.budget(level)} | ${(xp.need(level)/xp.referenceXPPerSecond).toFixed(1)}秒 | ${xp.interval(level).toFixed(1)}秒`);
lines.push('','100关预算与成长上限（关号 名称 | 普通经验预算 | 经验升级次数 | 预算可达等级 | 精英/Boss轮盘词条）');
for(const s of stages)lines.push(`${s.id} ${s.name} | ${s.experience.budget} | ${s.experience.choices} | LV.${s.experience.choices+1} | ${s.eliteCount+s.bossCount*3}`);
lines.push('','怪物随时间强化：','后续虫群首次进入追击时锁定血量与接触伤害；Boss在正式登场时锁定。已交战单位不重新强化、不突然回血；移速及冲刺预警保持原值。',
 '普通关卡前30实战秒为缓冲期；之后每分钟：普通生命+30%、精英+24%、Boss+16%，最高分别为基础2.5/2.2/1.8倍。',
 '普通关卡每分钟伤害增加：普通+6%、精英+5%、Boss+3.5%，最高分别为基础1.35/1.30/1.20倍。',
 '前三关前20秒缓冲；之后每分钟生命增加：普通+20%、精英+15%、Boss+10%，最高分别为基础1.8/1.55/1.3倍；伤害最高仅1.12/1.10/1.08倍。',
 '无尽沿用每8秒虫潮的现有强化，不再叠加正式关卡时间倍率；新手练习不强化。','',
 '时间倍率实例（模式 | 实战时间 | 普通生命/伤害 | 精英生命/伤害 | Boss生命/伤害）');
for(const [name,s]of [['新手关',stages[0]],['普通关',stages[3]]])for(const at of [0,30,60,120,180,300,600]){
 const pairs=['normal','elite','boss'].map(kind=>{const m=pressure.multipliers(s,at,kind);return `${m.hp.toFixed(2)} / ${m.damage.toFixed(2)}`;});lines.push(`${name} | ${at}秒 | ${pairs.join(' | ')}`);
}
lines.push('','精致轮盘：扇区显示实际词条名称、图标、品质；固定指针落点与抽中奖励一致。Boss三连抽按每次更新后的合法词条池结算，防止满级词条被无效抽取。',
 '转动时按钮锁定，结束后显示收获卡片（名称、品质、等级、效果），再次点击仅继续游戏，不重复发奖。构筑已满时改为生命补给。');
fs.writeFileSync(path.join(root,'经验升级数值表.txt'),lines.join('\n')+'\n');
console.log('Updated runtime-derived experience and time-pressure tables.');
