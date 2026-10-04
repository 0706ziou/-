// Raster scene inspection with the shipped terrain functions; this does not launch a browser.
'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createCanvas,loadImage}=require('C:/Users/admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@napi-rs/canvas');
const sharp=require('C:/Users/admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp');
async function main(){
  const context=vm.createContext({window:{}});
  for(const file of ['art-catalog.js','relic-data.js','world-data.js','map-data.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,file),'utf8'),context,{filename:file});
  const art=context.window.ORCHARD_ART,world=context.window.ORCHARD_WORLD,maps=context.window.ORCHARD_MAPS;
  const environment=await loadImage(path.join(__dirname,'assets/environment-atlas-clean.png'));
  const guardians=await loadImage(path.join(__dirname,art.atlas));
  // Supply a preloaded native image, preserving the actual renderer and atlas cell selection.
  context.Image=function(){return environment};
  const rendererSource=fs.readFileSync(path.join(__dirname,'map-renderer.js'),'utf8').replace('if (atlas) atlas.src = atlasPath;','');
  vm.runInContext(rendererSource,context,{filename:'map-renderer.js'});
  const renderer=context.window.ORCHARD_MAP_RENDER,destination=path.join(__dirname,'assets/maps');
  fs.mkdirSync(destination,{recursive:true});
  const scenes=[];
  const focuses=['gate','fountain','fountain','apiary','bridge','pergola','cherryTree','bridge','fountain','pumpkinTower','windmill','hive','thorn','greenhouse','lantern','lantern','bridge','pumpkinTower','fenceGate','heartTree'];
  for(const chapter of art.stages){
    const layout=maps.build(chapter.id,6788,4808,context.window.ORCHARD_RELIC_POINTS),focus=layout.landmarks.find(l=>l.kind===focuses[chapter.id-1])||layout.spawn;
    const camera={x:Math.max(0,Math.min(layout.width-960,focus.x-480)),y:Math.max(0,Math.min(layout.height-680,focus.y-340)),w:960,h:680};
    const canvas=createCanvas(960,680),ctx=canvas.getContext('2d');
    const sprite=(key,x,y,w,h=w,rotation=0)=>{
      const index=art.sprites[key];if(!Number.isInteger(index))return false;
      const sw=guardians.width/4,sh=guardians.height/4;ctx.save();ctx.translate(x,y);if(rotation)ctx.rotate(rotation);
      ctx.drawImage(guardians,index%4*sw,Math.floor(index/4)*sh,sw,sh,-w/2,-h/2,w,h);ctx.restore();return true;
    };
    ctx.save();ctx.translate(-camera.x,-camera.y);renderer.ground(ctx,layout,camera,4,sprite);renderer.solids(ctx,layout,camera,4,sprite);
    const hero=world.safePoint(focus.x,focus.y+175,17,layout.obstacles,layout.width,layout.height);
    if(!hero.free)throw Error('No legal hero position for scene '+chapter.id);
    sprite('orange',hero.x,hero.y,49,52);ctx.restore();
    ctx.fillStyle='#13271fde';ctx.fillRect(15,15,460,69);ctx.font='bold 22px "Microsoft YaHei",sans-serif';ctx.fillStyle='#fff0bc';ctx.fillText(String(chapter.id).padStart(2,'0')+' · '+chapter.name,31,45);
    ctx.font='13px "Microsoft YaHei",sans-serif';ctx.fillStyle='#c1d3ae';ctx.fillText('实际地图近景 · '+layout.width+' × '+layout.height,31,68);
    const image=canvas.toBuffer('image/png');fs.writeFileSync(path.join(destination,'scene-'+String(chapter.id).padStart(2,'0')+'.png'),image);scenes.push({chapter,image});
  }
  const sheet=createCanvas(2450,1650),ctx=sheet.getContext('2d');ctx.fillStyle='#14271f';ctx.fillRect(0,0,sheet.width,sheet.height);
  ctx.fillStyle='#fff1c2';ctx.font='bold 32px "Microsoft YaHei",sans-serif';ctx.fillText('果园保卫战 · 二十关地图场景近景',20,48);
  ctx.fillStyle='#bbcea9';ctx.font='19px "Microsoft YaHei",sans-serif';ctx.fillText('与游戏共用地形、碰撞数据、透明素材和 Canvas 绘制函数',20,83);
  for(let i=0;i<scenes.length;i++){
    const x=20+i%5*486,y=110+Math.floor(i/5)*380,img=await loadImage(scenes[i].image);
    ctx.drawImage(img,x,y,470,333);ctx.font='bold 20px "Microsoft YaHei",sans-serif';ctx.fillStyle=scenes[i].chapter.palette.accent;
    ctx.fillText(String(i+1).padStart(2,'0')+' · '+scenes[i].chapter.name,x+9,y+361);
  }
  await sharp(sheet.toBuffer('image/png')).jpeg({quality:90}).toFile(path.join(destination,'地图场景近景总览.jpg'));
  console.log('20 actual terrain scenes rendered with the shipped Canvas functions.');
}
main().catch(error=>{console.error(error.stack);process.exitCode=1});
