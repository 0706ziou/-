const assert=require('node:assert/strict');const {createGame}=require('./verify.cjs');let checks=0;function check(name,fn){fn();checks++;console.log('PASS '+name);}
function game(){const g=createGame();g.t.profile.seeds=999999;g.t.profile.cores=999999;g.t.startScreen();return g;}
const button=(g,attr,value)=>g.element('overlay').querySelectorAll('['+attr+']').find(b=>b.dataset[attr.replace(/^data-/,'').replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]===value);
check('Repeated talent research stays on talents and charges only each new level cost',()=>{
 const g=game(),{t,element}=g;t.showHeroes('talents');let seeds=t.profile.seeds,cores=t.profile.cores;
 for(let i=0;i<4;i++){const cost=t.growth.cost('talent','insight',i);assert(button(g,'data-research','insight').onclick());seeds-=cost.seeds;cores-=cost.cores;assert.equal(t.state,'heroes');assert.equal(t.profile.talents.insight,i+1);assert.equal(t.profile.seeds,seeds);assert.equal(t.profile.cores,cores);assert(element('overlay').innerHTML.includes('talent-grid'));assert(element('overlay').innerHTML.includes('研究 '+(i+1)+' / 15'));}
 assert.equal(t.loadProfile().talents.insight,4);
});
check('Hero training retains the inspected hero and passive view instead of returning to the roster default',()=>{
 const g=game(),{t,element}=g;t.showHeroes('heroes');button(g,'data-inspect-hero','berry').onclick();button(g,'data-hero-view','passive').onclick();
 for(let i=0;i<3;i++){assert(element('trainHero').onclick());assert.equal(t.profile.heroLevels.berry,i+1);assert.equal(t.profile.selectedHero,'orange');assert(element('overlay').innerHTML.includes(t.growth.hero('berry').passiveDescription));assert(element('overlay').innerHTML.includes('训练 '+(i+1)+' / 30'));}
});
check('Equipment enhancements keep the selected charm tab and update level, cost and permanent values',()=>{
 const g=game(),{t,element}=g;t.showArmory('charm');let seeds=t.profile.seeds,cores=t.profile.cores;
 for(let i=0;i<4;i++){const cost=t.gearCost('charm_sprout');assert(button(g,'data-enhance','charm_sprout').onclick());seeds-=cost.seeds;cores-=cost.cores;assert.equal(t.profile.inventory.charm_sprout.level,i+1);assert.equal(t.selectedGearSlot,'charm');assert.equal(t.profile.seeds,seeds);assert.equal(t.profile.cores,cores);assert(element('overlay').innerHTML.includes('强化 +'+(i+1)));}
});
check('Orchard and sprite upgrades keep the selected garden and resident',()=>{
 const g=game(),{t,element}=g;t.profile.rescuedSprites=Array.from({length:30},(_,i)=>i+1);for(const id of t.profile.rescuedSprites)t.profile.spriteLevels[id]=0;
 t.showOrchard(3);button(g,'data-select-sprite','23').onclick();
 for(let i=0;i<3;i++){assert(element('growSelectedSprite').onclick());assert.equal(t.profile.spriteLevels[23],i+1);assert.equal(t.selectedSprite,23);assert.equal(t.profile.spriteLevels[1],0);assert.equal(t.state,'orchard');}
 for(let i=0;i<3;i++){assert(element('growOrchard').onclick());assert.equal(t.profile.orchard.level,i+1);assert.equal(t.selectedSprite,23);assert(element('overlay').innerHTML.includes('第 21–30 关'));}
});
check('Reaching max research disables only the completed action and cannot spend again',()=>{
 const g=game(),{t}=g;t.profile.talents.insight=14;t.showHeroes('talents');assert(button(g,'data-research','insight').onclick());assert.equal(t.profile.talents.insight,15);const before=JSON.stringify(t.profile);const b=button(g,'data-research','insight');assert.equal(b.disabled,true);assert.equal(b.onclick(),false);assert.equal(JSON.stringify(t.profile),before);
});
check('Insufficient materials and active combat block stale upgrade controls without spending or rerendering',()=>{
 const g=game(),{t,element}=g;t.profile.seeds=0;t.profile.cores=0;t.showHeroes('talents');const before=element('overlay').innerHTML;assert.equal(button(g,'data-research','rate').onclick(),false);assert.equal(element('overlay').innerHTML,before);
 t.profile.seeds=5000;t.profile.cores=50;t.showHeroes('talents');const stale=button(g,'data-research','rate').onclick,profile=JSON.stringify(t.profile);t.start();assert.equal(stale(),false);assert.equal(JSON.stringify(t.profile),profile);assert.equal(t.state,'playing');
});
console.log(`${checks} permanent growth UI checks passed.`);
