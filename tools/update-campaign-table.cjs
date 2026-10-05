// Regenerate the shipped campaign and hero guide from actual runtime data.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),sandbox={window:{}};
vm.createContext(sandbox);
for(const file of ['experience-data.js','progression.js','orchard-data.js','growth-data.js']) vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),sandbox);
const {ORCHARD_STAGES:stages,ORCHARD_GROWTH:g,ORCHARD_BOSSES:bosses}=sandbox.window;
const lines=['果园保卫战 · 100关远征与长期养成','',
  '五大篇章：1～20 青叶启程；21～40 月露群岛；41～60 赤焰山林；61～80 霜晶高原；81～100 星辉王庭。',
  '首页新增篇章与关卡选择。未解锁关卡可以预览，必须通关上一关才能出战。',
  '前三关为新手友好关，普通虫72/96/120只，精英1/2/3只，各1位虫王。脱离伤害3秒后每秒恢复2生命，第四关起恢复原难度。',
  '第四关起每关398只普通虫，普通经验预算按轮盘替代份额独立核算；升级成本逐级增加、每关升级次数按实际预算计算，经验加成只提前发放储备。',
  '4～20关逐关增加Boss；21关起一般5～8位，40/60/80/100关10位。首只60秒，后续按独立时间登场、可同时在场，不等待击杀。',
  '后80关各有对应篇章虫王，每关最后一位Boss为本关虫王。',
  '每关首通救援1位精灵，共100位，入住10座果园，每座10位。每关首通材料和进度独立保存。',
  '重复通关奖励为首通25%（两类材料各至少1），每关通关后仍可进入无尽。','',
  '英雄训练由5级延长到30级，旧等级、出战英雄、账号材料与研究等级全部保留。',
  '1～5级：每级基础伤害 +2.5%、生命 +5、英雄技能冷却 −2%。',
  '6～30级：每级基础伤害 +1%、生命 +3、英雄技能冷却 −0.8%。',
  '训练满级：伤害 +37.5%、生命 +100、冷却 −30%。',
  '全队研究：生命/伤害/射速各20级，经验15级；满级分别 +80生命/+40%伤害/+20%射速/+30%经验。',
  '训练与研究伤害先相加，再乘英雄倍率；不影响已开始的一局。技能冷却始终保持正值。','',
  '训练费用（目标等级｜阳光籽｜果核）：'];
let seeds=0,cores=0;
for(let level=0;level<30;level++){const c=g.cost('hero','orange',level);seeds+=c.seeds;cores+=c.cores;lines.push(`${level+1}｜${c.seeds}｜${c.cores}`);}
lines.push(`一位英雄训练满级总计：${seeds}阳光籽、${cores}果核。`,
  `100关全部首通总计：${stages.reduce((sum,s)=>sum+s.reward.seeds,0)}阳光籽、${stages.reduce((sum,s)=>sum+s.reward.cores,0)}果核。`,'',
  '100关数值表（关号｜名称｜普通生命/飞虫生命/精英生命｜普通/精英/Boss数量｜首通籽/核｜最终Boss生命）：');
for(const s of stages) lines.push(`${s.id}｜${s.name}｜${s.slow.hp}/${s.fast.hp}/${s.elite.hp}｜${s.normalCount}/${s.eliteCount}/${s.bossCount}｜${s.reward.seeds}/${s.reward.cores}｜${s.beginner?.bossHp??bosses[s.bossIds.at(-1)-1].hp}`);
fs.writeFileSync(path.join(root,'100关与英雄养成说明.txt'),lines.join('\n')+'\n');
const heroes=['果园保卫战 · 首次通关解锁十三位英雄','',
  '新账号先用橙橙挑战第一关。首次通关解锁装备、英雄、果园和世界，并触发四项点击指引；第二关首通再触发装备、英雄、果园三项指引，各轮完成后不重复。13位英雄都有独立30级训练，四项天赋全队共享。',
  '旧版8位英雄保留，新增团团、蹦蹦、盾盾、弯弯、船船。以下为无强化、无训练、无研究及无精灵祝福的初始数值。',''];
for(const [index,h] of g.heroes.entries()){
  const p=g.migrate({selectedHero:h.id},{clearedStages:[]}),s=g.makeRunStats(p),n=v=>Math.round(v*100)/100;
  heroes.push(`${index+1}. ${h.icon} ${h.name} · ${h.role}`,h.description,
    `初始生命 ${110+s.hp}，基础伤害 ${n(22*s.damageMult)}，射速 ${n(3*s.rateMult)}/秒，移速 ${n(205*s.speedMult+s.speed)}。`,
    `${h.skillName}：${h.skillDescription}`,`${h.passiveName}：${h.passiveDescription}`,'');
}
heroes.push(...lines.slice(10,lines.indexOf('100关数值表（关号｜名称｜普通生命/飞虫生命/精英生命｜普通/精英/Boss数量｜首通籽/核｜最终Boss生命）：')));
fs.writeFileSync(path.join(root,'英雄与训练说明.txt'),heroes.join('\n')+'\n');
console.log('Updated campaign and hero guides from the shipped data.');
