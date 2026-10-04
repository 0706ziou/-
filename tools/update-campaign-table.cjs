// Regenerate the shipped campaign and hero guide from actual runtime data.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),sandbox={window:{}};
vm.createContext(sandbox);
for(const file of ['experience-data.js','progression.js','orchard-data.js','growth-data.js']) vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),sandbox);
const {ORCHARD_STAGES:stages,ORCHARD_GROWTH:g,ORCHARD_BOSSES:bosses}=sandbox.window;
const lines=['果园保卫战 · 100关远征与长期养成','',
  '五大篇章：1～20 青叶启程；21～40 月露群岛；41～60 赤焰山林；61～80 霜晶高原；81～100 星辉王庭。',
  '首页新增篇章与关卡选择。未解锁关卡可以预览，必须通关上一关才能出战。',
  '原前20关配置保留。后80关使用20种主题美术，篇章色调、镜像道路与独立随机障碍布局，碰撞与投放图同步。',
  '每关398只普通虫，每关固定10000经验、30次升级；经验加成提前发放固定储备。',
  '前20关逐关增加Boss；21关起一般5～8位，40/60/80/100关10位。全部逐位登场，击杀后至少12秒喘息。',
  '后80关各有对应篇章虫王，每关最后一位Boss为本关虫王。',
  '果园仍有20位伙伴；21关起循环守护伙伴家园，不重复添加精灵。每关首通材料和进度独立保存。',
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
for(const s of stages) lines.push(`${s.id}｜${s.name}｜${s.slow.hp}/${s.fast.hp}/${s.elite.hp}｜${s.normalCount}/${s.eliteCount}/${s.bossCount}｜${s.reward.seeds}/${s.reward.cores}｜${bosses[s.bossIds.at(-1)-1].hp}`);
fs.writeFileSync(path.join(root,'100关与英雄养成说明.txt'),lines.join('\n')+'\n');
const heroes=['果园保卫战 · 十三位初始解锁英雄','',
  '点击首页“英雄”选择出战。13位英雄全部初始解锁，各有独立30级训练；四项研究全队共享。',
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
