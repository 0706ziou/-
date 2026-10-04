/* Shared terrain renderer: the combat view, tactical map and previews use the same layout. */
(() => {
  'use strict';
  const envKeys = ['gate','fountain','apiary','bridge','pergola','cherryTree','windmill','greenhouse','hive','thorn','redTree','pumpkinTower','fenceGate','heartTree','pumpkinBed','lantern'];
  const atlasPath = 'assets/environment-atlas-clean.png';
  const atlas = typeof Image === 'function' ? new Image() : null;
  if (atlas) atlas.src = atlasPath;
  const colors = { water:'#418c9b', pond:'#4b989e', chasm:'#243c4e', field:'#7a804b', terrace:'#7b8051', flower:'#829853', flowers:'#829853', soil:'#746146', orchard:'#49673d', clearing:'#75905c', moss:'#5a7761', mud:'#536873', petal:'#77505c', leaves:'#77513e', glow:'#566647' };
  const solidColors = { hedge:'#436740', fence:'#967b50', thorn:'#765275', rock:'#899285', stump:'#9a7954', crate:'#af8654', tree:'#447b48', cherryTree:'#ca8b98', redTree:'#c7784d', pumpkinBed:'#bb914a', water:'#418c9b', pond:'#4b989e', chasm:'#243c4e', terrace:'#989573' };
  function palette(layout) { return window.ORCHARD_ART.stages[layout.id - 1].palette; }
  function bounds(object) {
    if (object.points?.length) return { minX:Math.min(...object.points.map(p=>p.x)), maxX:Math.max(...object.points.map(p=>p.x)), minY:Math.min(...object.points.map(p=>p.y)), maxY:Math.max(...object.points.map(p=>p.y)) };
    const w=object.w || object.r*2 || 100, h=object.h || object.r*2 || 100;
    return {minX:object.x-w/2,maxX:object.x+w/2,minY:object.y-h/2,maxY:object.y+h/2};
  }
  function visible(object, camera, margin=80) { const b=bounds(object);return b.maxX>=camera.x-margin&&b.minX<=camera.x+camera.w+margin&&b.maxY>=camera.y-margin&&b.minY<=camera.y+camera.h+margin; }
  function path(ctx, points, close=false) {ctx.beginPath();points.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));if(close)ctx.closePath();}
  function ellipse(ctx,x,y,rx,ry,color) {ctx.fillStyle=color;ctx.beginPath();ctx.ellipse(x,y,rx,ry,0,0,Math.PI*2);ctx.fill();}
  function shape(ctx, area) {
    if (area.points?.length) path(ctx,area.points,true);
    else {ctx.beginPath();if(area.shape==='circle'||area.r)ctx.arc(area.x,area.y,area.r,0,Math.PI*2);else ctx.rect(area.x-area.w/2,area.y-area.h/2,area.w,area.h);}
  }
  function drawEnvironment(ctx,key,x,y,w,h=w,angle=0) {
    const index=envKeys.indexOf(key);
    if(index<0||!atlas?.complete||!atlas.naturalWidth||!atlas.naturalHeight)return false;
    const cw=atlas.naturalWidth/4,ch=atlas.naturalHeight/4;
    ctx.save();ctx.translate(x,y);if(angle)ctx.rotate(angle);
    ctx.drawImage(atlas,index%4*cw,Math.floor(index/4)*ch,cw,ch,-w/2,-h/2,w,h);ctx.restore();return true;
  }
  function areaColor(area,p) {return area.color||colors[area.kind]||p.grass;}
  function roadLine(ctx,road,color,width) {ctx.strokeStyle=color;ctx.lineWidth=width;ctx.lineCap='round';ctx.lineJoin='round';path(ctx,road.points);ctx.stroke();}
  function ground(ctx,layout,camera,time=0,sprite) {
    const p=palette(layout);
    ctx.fillStyle=p.ground;ctx.fillRect(camera.x,camera.y,camera.w,camera.h);
    // Irregular light and grass flecks replace the previous repeating horizontal bands.
    for(let y=Math.floor(camera.y/96)*96;y<camera.y+camera.h+96;y+=96)for(let x=Math.floor(camera.x/112)*112;x<camera.x+camera.w+112;x+=112){
      const n=Math.abs(Math.sin(x*.023+y*.041+layout.id)*1000)%1;
      ellipse(ctx,x+n*55,y+n*32,55+n*40,32+n*23,p.grass+'18');
      ctx.fillStyle=p.grass+'55';ctx.fillRect(x+14+n*51,y+31,2,5);ctx.fillRect(x+18+n*51,y+28,2,7);
    }
    for(const area of layout.areas||[]){
      if(!visible(area,camera))continue;
      ctx.save();shape(ctx,area);ctx.fillStyle=areaColor(area,p);ctx.fill();ctx.clip();
      const b=bounds(area),minX=Math.max(camera.x-50,b.minX),maxX=Math.min(camera.x+camera.w+50,b.maxX),minY=Math.max(camera.y-50,b.minY),maxY=Math.min(camera.y+camera.h+50,b.maxY);
      if(['water','pond','chasm'].includes(area.kind)){
        ctx.strokeStyle=area.kind==='chasm'?'#0d283555':'#a9eddf66';ctx.lineWidth=area.kind==='chasm'?12:2;
        for(let y=Math.floor(minY/64)*64;y<maxY;y+=64)for(let x=Math.floor(minX/130)*130;x<maxX;x+=130){
          const shift=Math.sin(time*.8+y*.01)*10;ctx.beginPath();ctx.moveTo(x+shift,y);ctx.quadraticCurveTo(x+27+shift,y-8,x+58+shift,y);ctx.stroke();
        }
      }else if(['field','soil','terrace','pumpkin-field'].includes(area.kind)){
        ctx.strokeStyle='#e7c78b22';ctx.lineWidth=4;
        for(let y=Math.floor(minY/46)*46;y<maxY;y+=46){ctx.beginPath();ctx.moveTo(minX,y);ctx.lineTo(maxX,y);ctx.stroke();}
      }else if(['flower','flowers'].includes(area.kind)){
        for(let y=Math.floor(minY/38)*38;y<maxY;y+=38)for(let x=Math.floor(minX/43)*43;x<maxX;x+=43){ellipse(ctx,x+Math.sin(y)*12,y,5,5,'#ffe09a');ellipse(ctx,x+Math.sin(y)*12,y,2,2,'#a87c39');}
      }else if(['petal','leaves','glow'].includes(area.kind)){
        for(let y=Math.floor(minY/45)*45;y<maxY;y+=45)for(let x=Math.floor(minX/51)*51;x<maxX;x+=51){
          const color=area.kind==='petal'?'#f3b2c07a':area.kind==='leaves'?'#e297547c':'#f9da8380';
          ellipse(ctx,x+Math.sin(y+x)*17,y+Math.cos(x)*15,area.kind==='glow'?2:5,area.kind==='glow'?2:3,color);
        }
      }
      ctx.restore();shape(ctx,area);ctx.strokeStyle=['water','pond','chasm'].includes(area.kind)?'#a5baa777':'#c4d09622';ctx.lineWidth=7;ctx.stroke();
    }
    for(const road of layout.roads||[]){
      if(!visible(road,camera,road.width||150))continue;
      roadLine(ctx,road,'#18322255',(road.width||150)+14);roadLine(ctx,road,road.color||p.road,road.width||150);
      roadLine(ctx,road,'#fff0be16',Math.max(8,(road.width||150)-28));
    }
    if(sprite&&!['cherry','redleaf'].includes(layout.theme)){
      const distance=(x,y,a,b)=>{const dx=b.x-a.x,dy=b.y-a.y,t=Math.max(0,Math.min(1,((x-a.x)*dx+(y-a.y)*dy)/(dx*dx+dy*dy||1)));return Math.hypot(x-a.x-dx*t,y-a.y-dy*t);};
      for(let row=Math.floor(camera.y/137);row<Math.ceil((camera.y+camera.h)/137);row++)for(let col=Math.floor(camera.x/151);col<Math.ceil((camera.x+camera.w)/151);col++){
        const x=col*151+44+(row*37+col*11)%51,y=row*137+45+(col*29)%43;
        if(x<40||y<40||x>layout.width-40||y>layout.height-40)continue;
        if((layout.roads||[]).some(r=>r.points.some((p,i)=>i&&distance(x,y,r.points[i-1],p)<r.width/2+28)))continue;
        if(!window.ORCHARD_WORLD.isFree(x,y,35,layout.obstacles,layout.width,layout.height))continue;
        if((layout.relics||[]).some(r=>Math.hypot(x-r.x,y-r.y)<80))continue;
        sprite('flower',x,y,26,28);
      }
    }
    // Bridges are walkable decks across a real water/chasm collision gap.
    for(const lm of layout.landmarks||[])if(lm.kind==='bridge'&&visible(lm,camera))bridge(ctx,lm);
    ctx.strokeStyle=p.accent+'70';ctx.lineWidth=5;ctx.strokeRect(20,20,layout.width-40,layout.height-40);
  }
  function bridge(ctx,lm){
    const w=lm.w||320,h=lm.h||260;
    ctx.save();ctx.translate(lm.x,lm.y);if(lm.rotation)ctx.rotate(lm.rotation);
    ctx.fillStyle='#795d40';ctx.fillRect(-w/2-8,-h/2-8,w+16,h+16);
    ctx.fillStyle='#b99a69';ctx.fillRect(-w/2,-h/2,w,h);
    ctx.strokeStyle='#66513a';ctx.lineWidth=3;
    for(let x=-w/2+18;x<w/2;x+=24){ctx.beginPath();ctx.moveTo(x,-h/2);ctx.lineTo(x,h/2);ctx.stroke();}
    ctx.fillStyle='#d3b780';ctx.fillRect(-w/2,-h/2,w,9);ctx.fillRect(-w/2,h/2-9,w,9);
    for(const y of [-h/2,h/2])for(let x=-w/2;x<=w/2;x+=w/4)ellipse(ctx,x,y,7,7,'#685137');
    ctx.restore();
    drawEnvironment(ctx,'bridge',lm.x,lm.y,w,h,lm.rotation||0);
  }
  function tiledSolid(ctx,o,sprite){
    const w=o.w,h=o.h,tall=h>w,length=tall?h:w,short=tall?w:h;
    ctx.fillStyle=solidColors[o.kind]||'#697254';ctx.fillRect(o.x-w/2,o.y-h/2,w,h);
    if(['hedge','thorn'].includes(o.kind)){
      for(let offset=-length/2+Math.min(42,length/2);offset<length/2;offset+=64){
        const x=o.x+(tall?0:offset),y=o.y+(tall?offset:0);
        if(o.kind==='thorn'&&drawEnvironment(ctx,'thorn',x,y,tall?short*1.35:82,tall?82:short*1.35))continue;
        if(sprite?.('hedge',x,y,tall?short*1.25:84,tall?84:short*1.25))continue;
        ellipse(ctx,x,y,tall?short*.65:44,tall?44:short*.65,'#4b7844');
      }
    }else{
      ctx.strokeStyle='#ddc08a99';ctx.lineWidth=5;
      ctx.beginPath();if(tall){ctx.moveTo(o.x-6,o.y-h/2);ctx.lineTo(o.x-6,o.y+h/2);ctx.moveTo(o.x+6,o.y-h/2);ctx.lineTo(o.x+6,o.y+h/2);}else{ctx.moveTo(o.x-w/2,o.y-6);ctx.lineTo(o.x+w/2,o.y-6);ctx.moveTo(o.x-w/2,o.y+6);ctx.lineTo(o.x+w/2,o.y+6);}ctx.stroke();
      ctx.fillStyle='#6d5036';for(let v=-length/2;v<=length/2;v+=40){const x=o.x+(tall?0:v),y=o.y+(tall?v:0);ctx.fillRect(x-(tall?short/2:6),y-(tall?6:short/2),tall?short:12,tall?12:short);}
    }
  }
  function fallbackLandmark(ctx,lm,p){
    const w=lm.w||130,h=lm.h||130;
    ellipse(ctx,lm.x,lm.y+12,w*.43,h*.22,'#11271c55');
    if(['gate','fenceGate','pergola'].includes(lm.kind)){
      ctx.fillStyle='#997649';ctx.fillRect(lm.x-w/2,lm.y-h/2,18,h);ctx.fillRect(lm.x+w/2-18,lm.y-h/2,18,h);ctx.fillRect(lm.x-w/2,lm.y-h/2,w,20);
      for(let i=0;i<7;i++)ellipse(ctx,lm.x-w/2+i*w/6,lm.y-h/2,28,18,p.tree);
    }else if(lm.kind==='fountain'){
      ellipse(ctx,lm.x,lm.y,w*.45,h*.35,'#a9b1a1');ellipse(ctx,lm.x,lm.y,w*.33,h*.25,'#70bec0');ellipse(ctx,lm.x,lm.y-15,13,28,'#c5d1b4');
    }else if(['heartTree','redTree','cherryTree'].includes(lm.kind)){
      const c=lm.kind==='heartTree'?'#deb85b':lm.kind==='redTree'?'#b85d42':'#dd969f';ellipse(ctx,lm.x,lm.y,w*.45,h*.44,c);ellipse(ctx,lm.x-20,lm.y-18,w*.2,h*.2,'#ffffff22');
    }else{
      ctx.fillStyle=lm.kind==='greenhouse'?'#95b8a0':lm.kind==='hive'||lm.kind==='apiary'?'#d4a451':lm.kind==='pumpkinTower'||lm.kind==='pumpkinBed'?'#d99648':'#a98a60';
      ctx.fillRect(lm.x-w*.4,lm.y-h*.4,w*.8,h*.8);ctx.strokeStyle='#f1d39d99';ctx.lineWidth=5;ctx.strokeRect(lm.x-w*.4,lm.y-h*.4,w*.8,h*.8);
    }
  }
  function solids(ctx,layout,camera,time,sprite){
    const p=palette(layout),landmarkIds=new Set((layout.landmarks||[]).map(l=>l.obstacleId).filter(Boolean));
    for(const o of layout.obstacles||[]){
      if(!visible(o,camera,140)||['water','chasm','pond'].includes(o.kind)||landmarkIds.has(o.id)||o.landmark||o.hidden)continue;
      const w=o.shape==='circle'?o.r*2:o.w,h=o.shape==='circle'?o.r*2:o.h;
      ellipse(ctx,o.x+5,o.y+h*.2,w*.55,Math.min(h*.35,45),'#0d251a66');
      if(o.kind==='terrace'){
        ctx.fillStyle='#989573';ctx.fillRect(o.x-w/2,o.y-h/2,w,h);ctx.strokeStyle='#c5b98d';ctx.lineWidth=3;ctx.strokeRect(o.x-w/2,o.y-h/2,w,h);
        ctx.strokeStyle='#5d6854';ctx.lineWidth=2;for(let x=o.x-w/2+46;x<o.x+w/2;x+=46){ctx.beginPath();ctx.moveTo(x,o.y-h/2);ctx.lineTo(x+8,o.y+h/2);ctx.stroke();}continue;
      }
      if(o.shape==='rect'&&['hedge','fence','thorn','wall'].includes(o.kind)){tiledSolid(ctx,o,sprite);continue;}
      const treeKey=layout.theme==='cherry'?'cherryTree':layout.theme==='redleaf'?'redTree':null;
      if((o.kind==='tree'||o.kind==='stump'&&o.variant===2)&&treeKey&&drawEnvironment(ctx,treeKey,o.x,o.y-12,w*1.5,h*1.6))continue;
      if(envKeys.includes(o.kind)&&drawEnvironment(ctx,o.kind,o.x,o.y,w*1.15,h*1.15))continue;
      const key=o.kind==='tree'||o.kind==='stump'&&o.variant===2?'tree':o.kind;
      if(sprite?.(key,o.x,o.y,w*1.2,h*(key==='tree'?1.5:1.2)))continue;
      ctx.fillStyle=solidColors[o.kind]||p.tree;if(o.shape==='circle')ellipse(ctx,o.x,o.y,o.r,o.r,ctx.fillStyle);else ctx.fillRect(o.x-w/2,o.y-h/2,w,h);
    }
    for(const lm of layout.landmarks||[]){
      if(lm.kind==='bridge'||!visible(lm,camera,180))continue;
      if(!drawEnvironment(ctx,lm.kind,lm.x,lm.y,lm.w||140,lm.h||140,lm.rotation||0))fallbackLandmark(ctx,lm,p);
      if(lm.kind==='heartTree'||lm.kind==='lantern'){
        ctx.save();ctx.globalAlpha=.16+Math.sin(time*2+lm.x)*.04;ellipse(ctx,lm.x,lm.y,(lm.w||140)*.65,(lm.h||140)*.65,'#ffdb85');ctx.restore();
      }
    }
  }
  function mini(ctx,layout,x,y,w,h){
    ctx.save();ctx.translate(x,y);ctx.scale(w/layout.width,h/layout.height);
    const p=palette(layout);ctx.fillStyle=p.ground;ctx.fillRect(0,0,layout.width,layout.height);
    for(const a of layout.areas||[]){shape(ctx,a);ctx.fillStyle=areaColor(a,p);ctx.fill();}
    for(const r of layout.roads||[])roadLine(ctx,r,r.color||p.road,r.width||150);
    for(const o of layout.obstacles||[]){ctx.fillStyle=solidColors[o.kind]||p.tree;if(o.shape==='circle')ellipse(ctx,o.x,o.y,Math.max(32,o.r),Math.max(32,o.r),ctx.fillStyle);else ctx.fillRect(o.x-o.w/2,o.y-o.h/2,o.w,o.h);}
    for(const l of layout.landmarks||[]){ctx.fillStyle=l.kind==='bridge'?'#d2b681':l.kind==='heartTree'?'#f4d880':'#d8b58b';ctx.fillRect(l.x-(l.w||120)/2,l.y-(l.h||120)/2,l.w||120,l.h||120);}
    ctx.restore();
  }
  const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
  function svg(layout){
    const p=palette(layout),pts=points=>points.map(v=>Math.round(v.x)+','+Math.round(v.y)).join(' ');
    let s='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 '+layout.width+' '+layout.height+'" preserveAspectRatio="none" role="img" aria-label="'+escape(layout.name)+'真实地形与饰品分布"><rect width="100%" height="100%" fill="'+p.ground+'"/>';
    for(const a of layout.areas||[]){const color=escape(areaColor(a,p));s+=a.points?.length?'<polygon points="'+pts(a.points)+'" fill="'+color+'"/>':a.r?'<circle cx="'+a.x+'" cy="'+a.y+'" r="'+a.r+'" fill="'+color+'"/>':'<rect x="'+(a.x-a.w/2)+'" y="'+(a.y-a.h/2)+'" width="'+a.w+'" height="'+a.h+'" fill="'+color+'"/>';}
    for(const r of layout.roads||[])s+='<polyline points="'+pts(r.points)+'" fill="none" stroke="'+escape(r.color||p.road)+'" stroke-width="'+(r.width||150)+'" stroke-linecap="round" stroke-linejoin="round"/>';
    for(const o of layout.obstacles||[]){const color=solidColors[o.kind]||p.tree;s+=o.shape==='circle'?'<circle cx="'+o.x+'" cy="'+o.y+'" r="'+o.r+'" fill="'+color+'" stroke="#d7e1c022" stroke-width="7"/>':'<rect x="'+(o.x-o.w/2)+'" y="'+(o.y-o.h/2)+'" width="'+o.w+'" height="'+o.h+'" fill="'+color+'"/>';}
    for(const l of layout.landmarks||[]){const index=envKeys.indexOf(l.kind),w=l.w||140,h=l.h||140;
      const rotation=l.rotation?' transform="rotate('+l.rotation*180/Math.PI+' '+l.x+' '+l.y+')"':'';
      s+='<g'+rotation+'>';
      if(l.kind==='bridge')s+='<rect x="'+(l.x-w/2)+'" y="'+(l.y-h/2)+'" width="'+w+'" height="'+h+'" fill="#c8a873" stroke="#665237" stroke-width="14"/>';
      if(index>=0)s+='<svg x="'+(l.x-w/2)+'" y="'+(l.y-h/2)+'" width="'+w+'" height="'+h+'" viewBox="'+index%4*320+' '+Math.floor(index/4)*320+' 320 320" overflow="hidden"><image href="'+atlasPath+'" width="1280" height="1280"/></svg>';
      s+='</g>';
    }
    s+='<rect x="20" y="20" width="'+(layout.width-40)+'" height="'+(layout.height-40)+'" fill="none" stroke="'+p.accent+'" stroke-width="12"/><text x="120" y="180" fill="#f6efca" font-family="Microsoft YaHei,sans-serif" font-size="110">'+escape(layout.name)+' · 北 ↑</text></svg>';
    return s;
  }
  window.ORCHARD_MAP_RENDER=Object.freeze({ground,solids,mini,svg,drawEnvironment,environmentAtlas:atlasPath,environmentKeys:Object.freeze(envKeys)});
})();
