const assert=require('node:assert/strict');
const {createGame,quietField}=require('./verify.cjs');
let count=0;function check(name,fn){fn();console.log('PASS '+name);count++;}
function lobby(storage=new Map()){const g=createGame(storage);g.t.startScreen();return g;}
function user(id){return Object.freeze({id,account:id,nickname:id});}
function open(g){g.t.openItemStore();}
check('Diamond currency replaces the removed direct paid-buff item and offers explicit FREE preview packs',()=>{
 const {t,element}=lobby();assert.equal(t.store.mode,'free-preview');assert.equal(t.store.get('dew_charm'),null);
 assert.deepEqual(Array.from(t.store.packs,p=>p.diamonds),[180,600,1800]);assert.equal(t.profile.commerce.diamonds,0);
 element('openStoreLobby').onclick();const html=element('overlay').innerHTML;assert(html.includes('钻石充值'));assert(html.includes('免费测试充值'));assert(html.includes('不支付真钱'));
 assert(!html.includes('晨露护符'));assert.equal(t.topUpDiamonds('unknown'),false);
});
check('The wallet PLUS credits test diamonds, without consuming cash, seeds or cores',()=>{
 const {t,element,storage}=lobby();t.profile.seeds=120;t.profile.cores=30;element('openStoreLobby').onclick();assert.equal(t.state,'itemStore');
 assert(t.topUpDiamonds('medium'));assert.equal(t.profile.commerce.diamonds,600);assert.equal(t.profile.seeds,120);assert.equal(t.profile.cores,30);
 assert.equal(element('diamondBalance').textContent,'600');assert.equal(t.profile.commerce.receipts[0].delta,600);
 assert.equal(JSON.parse(storage.get(t.currentSaveKey)).commerce.diamonds,600);assert(element('commerceFeedback').textContent.includes('没有支付真钱'));
});
check('Insufficient funds cannot buy, award goods, change money or create a receipt',()=>{
 const g=lobby(),{t,element}=g;open(g);const profile=JSON.stringify(t.profile);
 for(const product of t.store.products)assert.equal(t.buyDiamondProduct(product.id),false);
 assert.equal(JSON.stringify(t.profile),profile);assert(element('commerceFeedback').textContent.includes('钻石不足'));assert.equal(t.buyDiamondProduct('fake'),false);
 assert.equal(t.performCommerce('unsupported','small'),false);t.closeItemStore();assert.equal(t.topUpDiamonds('medium'),false);assert.equal(t.buyDiamondProduct('star_aura'),false);
});
check('Diamond-priced cosmetics cost their exact price, equip once, and never add battle stats',()=>{
 const g=lobby(),{t,element}=g;const before=JSON.stringify(t.player);open(g);t.topUpDiamonds('medium');
 assert(t.buyDiamondProduct('star_aura'));assert.equal(t.profile.commerce.diamonds,360);assert(t.store.owns(t.profile,'star_aura'));assert.equal(t.profile.commerce.equippedAura,'star_aura');
 assert(t.buyDiamondProduct('gold_frame'));assert.equal(t.profile.commerce.diamonds,240);assert.equal(t.profile.commerce.equippedFrame,'gold_frame');
 assert.equal(t.buyDiamondProduct('gold_frame'),false);assert.equal(t.buyDiamondProduct('star_aura'),false);assert.equal(t.profile.commerce.diamonds,240);
 assert(element('heroIcon').classList.contains('commerce-gold-frame'));assert.equal(JSON.stringify(t.player),before);
 assert(t.performCommerce('equip','star_aura'));assert.equal(t.profile.commerce.equippedAura,'');assert.equal(t.profile.commerce.diamonds,240);
 assert(t.performCommerce('equip','star_aura'));t.closeItemStore();t.start();assert.equal(t.player.maxHp,110);assert.equal(t.player.pickup,85);
});
check('Repeatable supply packs exchange diamonds for the declared materials and log each exchange',()=>{
 const g=lobby(),{t}=g;open(g);t.topUpDiamonds('medium');
 assert(t.buyDiamondProduct('seed_bundle'));assert.equal(t.profile.seeds,180);assert.equal(t.profile.commerce.diamonds,540);
 assert(t.buyDiamondProduct('seed_bundle'));assert.equal(t.profile.seeds,360);assert.equal(t.profile.commerce.diamonds,480);
 assert(t.buyDiamondProduct('core_bundle'));assert.equal(t.profile.cores,6);assert.equal(t.profile.commerce.diamonds,390);
 assert.equal(t.store.owns(t.profile,'core_bundle'),false);assert.equal(t.profile.commerce.receipts.length,4);
 assert.equal(t.profile.commerce.receipts.reduce((sum,r)=>sum+r.delta,0),390);
});
check('Stale or duplicate UI callbacks cannot charge twice or credit the same interaction twice',()=>{
 const g=lobby(),{t,element}=g;open(g);element('commerceWalletPlus').onclick();
 const topup=element('overlay').querySelectorAll('[data-commerce-topup]').find(b=>b.dataset.commerceTopup==='medium').onclick;
 assert(topup());const after=JSON.stringify(t.profile);assert.equal(topup(),false);assert.equal(JSON.stringify(t.profile),after);
 element('commerceShopTab').onclick();
 const buy=element('overlay').querySelectorAll('[data-commerce-buy]').find(b=>b.dataset.commerceBuy==='core_bundle').onclick;
 assert(buy());const bought=JSON.stringify(t.profile);assert.equal(buy(),false);assert.equal(JSON.stringify(t.profile),bought);
});
check('Wallet, cosmetics and preview records persist on reload and belong only to their own account',()=>{
 const storage=new Map(),g=createGame(storage,{auth:true}),{t}=g;t.acceptAccount(user('钻石甲'));if(t.training)t.skipTraining();t.startScreen();open(g);t.topUpDiamonds('medium');t.buyDiamondProduct('star_aura');t.closeItemStore();assert(t.logoutAccount());
 t.acceptAccount(user('钻石乙'));if(t.training)t.skipTraining();t.startScreen();assert.equal(t.profile.commerce.diamonds,0);assert(!t.store.owns(t.profile,'star_aura'));assert(t.logoutAccount());
 t.acceptAccount(user('钻石甲'));assert.equal(t.profile.commerce.diamonds,360);assert.equal(t.profile.commerce.equippedAura,'star_aura');
 const loaded=createGame(storage,{auth:true});loaded.t.acceptAccount(user('钻石甲'));assert.equal(loaded.t.profile.commerce.diamonds,360);assert(loaded.t.store.owns(loaded.t.profile,'star_aura'));assert.equal(loaded.t.profile.commerce.receipts.length,2);
});
check('Migration rejects malformed balances, unknown goods and old paid-buff ownership without granting stats',()=>{
 const {t,storage}=lobby(),key=t.currentSaveKey,raw={...t.profile,storeItems:['dew_charm'],commerce:{diamonds:-500,owned:['fake','dew_charm','star_aura','star_aura'],equippedAura:'fake',equippedFrame:'gold_frame',sequence:2,receipts:[{id:1,kind:'real-payment',sku:'small',delta:999}]}};
 storage.set(key,JSON.stringify(raw));const loaded=createGame(storage).t;assert.equal(loaded.profile.commerce.diamonds,0);assert.deepEqual(Array.from(loaded.profile.commerce.owned),['star_aura']);assert.equal(loaded.profile.commerce.equippedAura,'');assert.equal(loaded.profile.commerce.equippedFrame,'');assert.equal(loaded.profile.commerce.receipts.length,0);assert.equal(loaded.player.maxHp,110);assert.equal(loaded.player.pickup,85);assert(!Object.hasOwn(loaded.profile,'storeItems'));
 for(const diamonds of [1.5,NaN,Infinity,1000000,'600']){const migrated=t.store.migrate({commerce:{diamonds}},{});assert.equal(migrated.commerce.diamonds,0);}
});
check('A failed save atomically rolls back both the debit and the awarded goods; retry succeeds exactly once',()=>{
 class Storage extends Map{set(k,v){if(this.fail)throw Error('quota');return super.set(k,v);}}
 const storage=new Storage(),g=lobby(storage),{t,element}=g;open(g);t.topUpDiamonds('medium');const before=JSON.stringify(t.profile),saved=storage.get(t.currentSaveKey);
 storage.fail=true;assert.equal(t.buyDiamondProduct('core_bundle'),false);assert.equal(JSON.stringify(t.profile),before);assert.equal(storage.get(t.currentSaveKey),saved);assert(element('commerceFeedback').textContent.includes('已撤销'));
 assert.equal(t.topUpDiamonds('small'),false);assert.equal(JSON.stringify(t.profile),before);
 storage.fail=false;assert(t.buyDiamondProduct('core_bundle'));assert.equal(t.profile.commerce.diamonds,510);assert.equal(t.profile.cores,6);assert.equal(t.profile.commerce.receipts.length,2);
});
check('Balance, material and sequence ceilings fail closed instead of wasting diamonds or overflowing',()=>{
 const g=lobby(),{t}=g;open(g);t.profile.commerce.diamonds=999900;const before=JSON.stringify(t.profile);assert.equal(t.topUpDiamonds('small'),false);assert.equal(JSON.stringify(t.profile),before);
 t.profile.commerce.diamonds=600;t.profile.seeds=999900;const beforeSupply=JSON.stringify(t.profile);assert.equal(t.buyDiamondProduct('seed_bundle'),false);assert.equal(JSON.stringify(t.profile),beforeSupply);
 t.profile.cores=999999;assert.equal(t.buyDiamondProduct('core_bundle'),false);assert.equal(t.profile.commerce.diamonds,600);
 t.profile.commerce.sequence=999999999;assert.equal(t.topUpDiamonds('small'),false);assert.equal(t.buyDiamondProduct('star_aura'),false);assert.equal(t.profile.commerce.diamonds,600);
});
check('Battle commerce freezes time and preserves all live player, enemy, build and XP state',()=>{
 const g=createGame(),{t,element,listeners}=g;t.start();quietField(t);t.player.hp=43;t.player.xp=37;t.keys.add('d');const player=t.player,enemies=t.enemies,before=JSON.stringify(t.player),clock=t.elapsed;
 element('openStoreRun').onclick();assert.equal(t.state,'itemStore');assert(t.isRunActive());assert.equal(t.keys.size,0);
 for(let i=0;i<100;i++)t.frame(1000+i*40);assert.equal(t.elapsed,clock);assert(t.topUpDiamonds('medium'));assert(t.buyDiamondProduct('star_aura'));assert(t.buyDiamondProduct('seed_bundle'));
 assert.equal(t.player,player);assert.equal(t.enemies,enemies);assert.equal(JSON.stringify(t.player),before);assert.equal(t.profile.seeds,180);
 listeners.keydown({key:'Escape',preventDefault(){}});assert.equal(t.state,'playing');assert.equal(t.player.hp,43);assert.equal(t.player.xp,37);
 t.pause();t.openItemStore();t.closeItemStore();assert.equal(t.state,'paused');assert.equal(t.elapsed,clock);
});
check('Equipped aura actually draws around the hero and can be removed without changing combat stats',()=>{
 const g=lobby(),{t,drawCalls}=g;open(g);t.topUpDiamonds('medium');t.buyDiamondProduct('star_aura');t.closeItemStore();t.start();quietField(t);drawCalls.length=0;t.draw();
 assert(drawCalls.some(c=>c.method==='ellipse'&&c.args[0]===t.player.x&&c.args[1]===t.player.y+19&&c.args[2]===33));
 const before=JSON.stringify(t.player);t.openItemStore();t.performCommerce('equip','star_aura');t.closeItemStore();assert.equal(JSON.stringify(t.player),before);drawCalls.length=0;t.draw();assert(!drawCalls.some(c=>c.method==='ellipse'&&c.args[0]===t.player.x&&c.args[2]===33));
});
check('Training and conflicting overlays cannot spend currency, and modal shortcuts stay contained',()=>{
 const g=lobby(),{t,element,listeners,document}=g;open(g);t.topUpDiamonds('medium');t.closeItemStore();assert(t.startTraining());assert.equal(t.openItemStore(),false);assert.equal(t.topUpDiamonds('small'),false);assert(element('commerceHeader').classList.contains('hidden'));assert(element('storeHud').classList.contains('hidden'));assert.equal(t.profile.commerce.diamonds,600);
 t.exitTraining();t.startScreen();open(g);const back=element('closeItemStore');assert.equal(document.activeElement,back);listeners.keydown({key:'Tab',preventDefault(){}});assert.equal(document.activeElement,element('commerceShopTab'));
 for(const key of ['d','e',' ','m','h','1'])listeners.keydown({key,preventDefault(){}});assert.equal(t.state,'itemStore');assert.equal(t.keys.size,0);
 t.closeItemStore();t.start();t.player.xp=t.player.need;t.upgrade();assert.equal(t.openItemStore(),false);assert.equal(t.buyDiamondProduct('star_aura'),false);
});
check('Repeated supply purchases retain the exact dialog, live button and focused element',()=>{
 const g=lobby(),{t,element,document}=g;open(g);t.topUpDiamonds('medium');
 const dialog=element('overlay').innerHTML,button=element('overlay').querySelectorAll('[data-commerce-product]').find(b=>b.dataset.commerceProduct==='seed_bundle');
 button.focus();
 for(let i=0;i<4;i++){
  assert(button.onclick());assert.equal(t.state,'itemStore');assert.equal(element('overlay').innerHTML,dialog);
  assert.equal(document.activeElement,button);assert.equal(element('overlay').querySelectorAll('[data-commerce-product]').find(b=>b.dataset.commerceProduct==='seed_bundle'),button);
 }
 assert.equal(t.profile.seeds,720);assert.equal(t.profile.commerce.diamonds,360);assert.equal(element('commerceDiamondBalance').textContent,'360');
});
check('Test recharge stays on the recharge page and supports repeated clicks without losing focus',()=>{
 const g=lobby(),{t,element,document}=g;element('openStoreLobby').onclick();
 const button=element('overlay').querySelectorAll('[data-commerce-topup]').find(b=>b.dataset.commerceTopup==='small'),dialog=element('overlay').innerHTML;
 button.focus();assert(button.onclick());assert(button.onclick());assert(button.onclick());
 assert.equal(t.profile.commerce.diamonds,540);assert.equal(element('overlay').innerHTML,dialog);assert.equal(document.activeElement,button);
 assert.equal(element('overlay').querySelectorAll('[data-commerce-topup]').length,3);assert.equal(element('overlay').querySelectorAll('[data-commerce-product]').length,0);
 element('commerceShopTab').onclick();assert.equal(element('overlay').querySelectorAll('[data-commerce-product]').length,4);
});
check('Failures report in place without resetting the product page or focus',()=>{
 const g=lobby(),{t,element,document}=g;open(g);const button=element('overlay').querySelectorAll('[data-commerce-product]').find(b=>b.dataset.commerceProduct==='core_bundle'),dialog=element('overlay').innerHTML;
 button.focus();assert.equal(button.onclick(),false);assert.equal(element('overlay').innerHTML,dialog);assert.equal(document.activeElement,button);
 assert(element('commerceFeedback').textContent.includes('钻石不足'));assert.equal(t.profile.commerce.diamonds,0);
});
console.log(`${count} diamond commerce checks passed.`);
