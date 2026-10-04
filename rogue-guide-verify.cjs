'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {createGame, quietField} = require('./verify.cjs');
let count = 0;
function check(name, fn) { fn(); console.log('PASS ' + name); count++; }
function game() { const g = createGame(); g.t.start(); quietField(g.t); return g; }
function levelUp(g) { g.t.player.xp = g.t.player.need; g.t.upgrade(); }
function goalButton(g, id) { return g.element('overlay').querySelectorAll('[data-recipe-goal]').find(b => b.dataset.recipeGoal === id); }
check('Choosing a recipe material immediately creates its super-skill goal', () => {
  const {t} = game(); t.builds.choose(t.player, 'chain');
  assert.equal(t.builds.goal(t.player).id, 'skyweb');
  assert.equal(t.builds.recommended(t.player).id, 'range');
  assert.equal(t.builds.recipeState(t.player, 'skyweb').remaining, 9);
});
check('The next offer contains the missing companion without consuming an extra choice', () => {
  const g = game(), {t} = g; t.builds.choose(t.player, 'chain'); levelUp(g);
  assert(t.choices.some(c => c.id === 'range')); assert.equal(t.choices.length, 3);
  assert.equal(new Set(t.choices.map(c => c.id)).size, 3);
  assert(t.choices.some(c => c.category === 'attack')); assert(t.choices.some(c => c.category === 'attribute'));
  assert.equal(t.player.build.attackChoices, 1); assert.equal(t.player.build.attributeChoices, 0);
  assert(g.element('overlay').innerHTML.includes('✦ 推荐 · 天穹雷网'));
});
check('Players can change goals while paused without rerolling cards, spending XP or granting a skill', () => {
  const g = game(), {t} = g; levelUp(g);
  const cards = t.choices, xp = t.player.xp, level = t.player.level;
  assert(goalButton(g, 'sunheart')); goalButton(g, 'sunheart').onclick();
  assert.equal(t.builds.goal(t.player).id, 'sunheart'); assert.equal(t.choices, cards);
  assert.equal(t.player.xp, xp); assert.equal(t.player.level, level); assert.equal(t.player.build.superSkills.length, 0);
  assert.equal(t.state, 'upgrade');
  const elapsed = t.elapsed; t.frame(1000); t.frame(6000); assert.equal(t.elapsed, elapsed);
  t.choose(0); levelUp(g);
  assert(t.choices.some(c => ['fireball', 'hp'].includes(c.id)));
});
check('All eight routes guide both materials to a real, single automatic fusion', () => {
  const {t} = game();
  for (const r of t.builds.recipes) {
    const p = {...t.player, build: null, upgrades: {}}; t.builds.init(p);
    assert(t.builds.setGoal(p, r.id));
    for (let i = 0; i < 10; i++) { const d = t.builds.recommended(p); assert(d); assert(t.builds.choose(p, d.id).applied); }
    assert.equal(p.build.superSkills.length, 1); assert.equal(p.build.superSkills[0], r.id);
    assert(t.builds.goal(p).crafted); assert.equal(t.builds.recommended(p), null);
  }
});
check('Full slots never recommend inaccessible companion skills', () => {
  const {t} = game(); for (const id of ['hp', 'speed', 'defense', 'regen']) t.builds.choose(t.player, id);
  t.builds.choose(t.player, 'chain');
  const r = t.builds.recipeState(t.player, 'skyweb'); assert.equal(r.reason, '属性槽已满');
  assert(!t.builds.setGoal(t.player, 'skyweb'));
  const d = t.builds.recommended(t.player); if (d) assert(t.builds.available(t.player, d));
});
check('Insufficient remaining stage choices disable a route, but endless restores it', () => {
  const {t} = game(); for (const id of ['damage', 'rate', 'shots', 'hp', 'speed']) for (let i=0;i<5;i++) t.builds.choose(t.player, id);
  assert.equal(t.builds.recipeState(t.player, 'icegarden').reason, '本关升级次数不足');
  assert(!t.builds.setGoal(t.player, 'icegarden'));
  t.builds.setMode(t.player, 'endless'); assert(t.builds.setGoal(t.player, 'icegarden'));
});
check('Clearing a goal preserves free choice, and a new run clears goal preferences', () => {
  const {t} = game(); t.builds.choose(t.player, 'chain'); assert(t.builds.setGoal(t.player, ''));
  t.builds.choose(t.player, 'fireball'); assert.equal(t.builds.goal(t.player), null);
  assert.equal(t.builds.recommended(t.player), null); t.start(); assert.equal(t.builds.goal(t.player), null);
  t.builds.choose(t.player, 'chain'); assert.equal(t.builds.goal(t.player).id, 'skyweb');
});
check('Every choice and fusion has a packaged, valid local SVG illustration', () => {
  const {t} = game();
  for (const d of [...t.builds.defs, ...t.builds.recipes]) {
    assert(fs.existsSync(d.image)); const svg = fs.readFileSync(d.image, 'utf8');
    assert(svg.startsWith('<svg')); assert(svg.endsWith('</svg>')); assert(!/<script|https?:\/\/(?!www\.w3\.org)/.test(svg));
  }
  const release = require('./tools/package-site.cjs').collectRelease();
  for (const d of [...t.builds.defs, ...t.builds.recipes]) assert(release.files.has(d.image));
  assert(release.files.has('rogue-guide.css'));
});
check('Cards show compact effect text and actual rolled rarity with accessible image labels', () => {
  const g = game(), {t} = g; levelUp(g); const content = g.element('overlay').innerHTML;
  for (const d of t.choices) {
    const brief = t.builds.brief(d, d.rarity.mult, t.player);
    assert(brief); assert(!brief.includes('undefined')); assert(brief.length <= d.desc.length + 15);
    assert(content.includes(d.image)); assert(content.includes(d.rarity.name)); assert(content.includes(d.name + '技能图示'));
  }
  for (const d of t.builds.defs) for (const q of [1,1.5,2]) { const text=t.builds.brief(d,q,t.player); assert(text); assert(!text.includes('undefined')); }
});
check('Keyboard selection and automatic fusion remain intact with the guide present', () => {
  const g = game(), {t} = g; t.builds.setGoal(t.player, 'skyweb');
  for (let i=0;i<10;i++) { levelUp(g); const index=t.choices.findIndex(c=>['chain','range'].includes(c.id)); assert(index>=0); g.listeners.keydown({key:String(index+1),preventDefault(){}}); }
  assert.equal(t.player.level,11); assert(t.player.build.superSkills.includes('skyweb')); assert.equal(t.state,'playing');
});
console.log(count + ' recipe guide checks passed.');
