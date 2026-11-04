/* =========================================================================
 * render.js — Canvas 卡通描边（cell-shaded）渲染
 * 世界层：地形/装饰/实体/瞄准辅助；屏幕层：单摇杆/暗角/BOSS 血条
 * ========================================================================= */

/* 区域主题调色板：每个战役区域一套配色 + 装饰色，缓解地图同质化 */
const ZONE_PALETTES = {
  desert:  { g0:"#5a4630", g1:"#473525", g2:"#32261a", grid:"rgba(255,210,63,0.045)", accent:"#e0a85a", decor:["#4a3826","#3a2c1c","#e0a85a"] },
  ruins:   { g0:"#4a4a52", g1:"#3a3a44", g2:"#26262e", grid:"rgba(180,200,255,0.05)", accent:"#9fb0d0", decor:["#3a3a44","#2a2a32","#9fb0d0"] },
  camp:    { g0:"#5e4636", g1:"#4a3526", g2:"#33241a", grid:"rgba(255,180,80,0.05)",  accent:"#d98a4a", decor:["#4a3424","#3a2818","#d98a4a"] },
  ice:     { g0:"#3a5066", g1:"#2e4256", g2:"#1e2e3e", grid:"rgba(170,200,220,0.05)", accent:"#9fb8c8", decor:["#5a7e96","#3a6076","#9fb8c8"] },
  swamp:   { g0:"#3a4a32", g1:"#2e3c28", g2:"#1f2a1a", grid:"rgba(150,180,120,0.04)", accent:"#8fae72", decor:["#33402a","#26331f","#8fae72"] },
  volcano: { g0:"#5a2e26", g1:"#481f1a", g2:"#301310", grid:"rgba(255,120,60,0.06)",  accent:"#ff6b3d", decor:["#5a2a20","#3a1812","#ff7a3d"] },
  tech:    { g0:"#33414a", g1:"#28333a", g2:"#1a232a", grid:"rgba(120,220,255,0.05)", accent:"#4ad6ff", decor:["#2e3b44","#1d2730","#4ad6ff"] },
  void:    { g0:"#323a42", g1:"#262d34", g2:"#181e24", grid:"rgba(160,180,200,0.05)", accent:"#8fa0b0", decor:["#2e3740","#1e252c","#8fa0b0"] },
  hive:    { g0:"#423a32", g1:"#332d27", g2:"#231e1a", grid:"rgba(200,170,130,0.04)", accent:"#b09470", decor:["#3e362e","#2a241e","#b09470"] },
  sanctum: { g0:"#4a3e22", g1:"#3a3018", g2:"#26200f", grid:"rgba(255,210,63,0.07)",  accent:"#ffd23f", decor:["#4a3a20","#342a14","#ffd23f"] },
};
// 各主题装饰类型权重：0碎石 1弹坑 2枯枝 3碎冰/玻璃 4立柱 5积水 6炉渣裂纹
const THEME_DECOR = {
  desert:[0,1,2], ruins:[0,4,4], camp:[0,1,2], ice:[3,3,0], swamp:[5,5,2],
  volcano:[6,6,0], tech:[4,4,1], void:[3,3,4], hive:[0,2,2], sanctum:[4,4,3],
};

// 暗色厂商（Atlas #2a3b6b / Hyperion #2a2a2a）的子弹在深色地面上几乎不可见，
// 渲染前统一做亮度提亮，保证任何厂商色都能看清弹头与曳光。
function brightenBulletColor(c){
  const m=/^#([0-9a-f]{6})$/i.exec(c||"");
  if(!m) return c;
  const r=parseInt(m[1].substr(0,2),16), g=parseInt(m[1].substr(2,2),16), b=parseInt(m[1].substr(4,2),16);
  const lum=(0.2126*r + 0.7152*g + 0.0722*b)/255;
  if(lum>=0.40) return c;
  const k=0.40/Math.max(0.05, lum);
  const cl=v=>Math.round(Math.min(255, v*k)).toString(16).padStart(2,"0");
  return `#${cl(r)}${cl(g)}${cl(b)}`;
}

const Render = {
  _vig:null, _vigKey:"",

  render(game){
    const ctx=game.ctx, v=game.view;
    ctx.setTransform(v.dpr,0,0,v.dpr,0,0);
    ctx.clearRect(0,0,v.w,v.h);
    ctx.fillStyle="#0b0906"; ctx.fillRect(0,0,v.w,v.h);
    if(game.mode==="dust2"){ RenderDust.render(ctx,game); return; }
    if(game.mode==="raid"){ RenderRaid.render(ctx,game); return; }
    if(game.mode==="br"){ RenderBR.render(ctx,game); return; }
    if(!game.world||!game.player) return;

    const cam=game.camera;
    let sx=0,sy=0;
    if(game.shakeT>0){ sx=(Math.random()-0.5)*game.shakeAmt; sy=(Math.random()-0.5)*game.shakeAmt; }

    ctx.save();
    ctx.translate(sx,sy);
    ctx.scale(game.zoom||1, game.zoom||1);
    ctx.translate(-cam.x, -cam.y);

    this.arena(ctx,game);
    for(const c of game.world.chests) this.chest(ctx,c);
    for(const l of game.loot) this.loot(ctx,l);
    for(const a of game.allies) this.turret(ctx,a);
    // 按 y 排序，制造前后遮挡的层次感
    const es=game.enemies.filter(e=>e.alive).sort((a,b)=>a.y-b.y);
    for(const e of es) this.enemy(ctx,e);
    if(game.player.alive) this.player(ctx,game.player);
    for(const p of game.projectiles) this.projectile(ctx,p);
    this.aimAssist(ctx,game);
    this.particles(ctx,game.particles);
    this.floats(ctx,game.floats);

    ctx.restore();

    // ---- 屏幕空间 ----
    this.vignette(ctx,game);
    this.targetEdge(ctx,game);
    this.bossBar(ctx,game);
    this.minimap(ctx,game);
    this.joystick(ctx);
  },

  /* ----------------------------- 场景 ----------------------------- */
  arena(ctx,game){
    const b=game.world.bounds;
    const z=game.zoom||1;
    const vx0=game.camera.x, vy0=game.camera.y;
    const vx1=vx0+game.view.w/z, vy1=vy0+game.view.h/z;

    // 地面渐变（按区域主题配色）
    const wz=game.world||{};
    const pal=ZONE_PALETTES[wz.theme]||ZONE_PALETTES.desert;
    const g=ctx.createLinearGradient(b.minX,b.minY,b.maxX,b.maxY);
    g.addColorStop(0,pal.g0); g.addColorStop(0.5,pal.g1); g.addColorStop(1,pal.g2);
    ctx.fillStyle=g;
    const fx=Math.max(b.minX,vx0-4), fy=Math.max(b.minY,vy0-4);
    const fw=Math.min(b.maxX,vx1+4)-fx, fh=Math.min(b.maxY,vy1+4)-fy;
    if(fw>0 && fh>0) ctx.fillRect(fx,fy,fw,fh);

    // 静态装饰（每个区域只生成一次；按主题产出异构装饰；只绘制视野附近的）
    const c0=pal.decor[0], c1=pal.decor[1], c2=pal.decor[2];
    if(!b._decor) b._decor=this._makeDecor(b, wz.theme);
    for(const d of b._decor){
      if(d.x<vx0-60 || d.x>vx1+60 || d.y<vy0-60 || d.y>vy1+60) continue;
      if(d.t===0){          // 岩石
        ctx.save(); ctx.translate(d.x,d.y); ctx.rotate(d.a);
        ctx.beginPath();
        const n=6;
        for(let i=0;i<n;i++){ const ang=i/n*6.2832, rr=d.r*(0.72+((i*37)%7)/16); const px=Math.cos(ang)*rr, py=Math.sin(ang)*rr; i?ctx.lineTo(px,py):ctx.moveTo(px,py); }
        ctx.closePath();
        ctx.fillStyle=c0; ctx.fill();
        ctx.lineWidth=2.5; ctx.strokeStyle="#0d0a07"; ctx.stroke();
        ctx.beginPath(); ctx.arc(-d.r*0.22,-d.r*0.26,d.r*0.32,0,6.2832);
        ctx.fillStyle="rgba(255,255,255,0.10)"; ctx.fill();
        ctx.restore();
      } else if(d.t===1){   // 弹坑
        ctx.beginPath(); ctx.ellipse(d.x,d.y,d.r,d.r*0.62,d.a,0,6.2832);
        ctx.fillStyle="rgba(0,0,0,0.20)"; ctx.fill();
        ctx.lineWidth=1.6; ctx.strokeStyle="rgba(0,0,0,0.16)"; ctx.stroke();
      } else if(d.t===2){   // 枯枝
        ctx.save(); ctx.translate(d.x,d.y);
        ctx.strokeStyle=rgba(c0,0.55); ctx.lineWidth=2; ctx.lineCap="round";
        for(let i=0;i<3;i++){ ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(Math.cos(d.a+i*0.7)*d.r, Math.sin(d.a+i*0.7)*d.r); ctx.stroke(); }
        ctx.restore();
      } else if(d.t===3){   // 水晶簇
        ctx.save(); ctx.translate(d.x,d.y); ctx.rotate(d.a);
        const shards=3;
        for(let i=0;i<shards;i++){
          const ox=(i-(shards-1)/2)*d.r*0.52, hh=d.r*(0.95+0.3*i/shards);
          ctx.beginPath();
          ctx.moveTo(ox-d.r*0.30,0); ctx.lineTo(ox,-hh); ctx.lineTo(ox+d.r*0.30,0); ctx.closePath();
          ctx.fillStyle=c2; ctx.fill();
          ctx.lineWidth=1.6; ctx.strokeStyle="#0d0a07"; ctx.stroke();
          ctx.beginPath(); ctx.moveTo(ox-hh*0.10,-hh*0.62); ctx.lineTo(ox+hh*0.06,-hh*0.62);
          ctx.strokeStyle="rgba(255,255,255,0.4)"; ctx.lineWidth=1.2; ctx.stroke();
        }
        ctx.restore();
      } else if(d.t===4){   // 断柱
        ctx.save(); ctx.translate(d.x,d.y);
        const bw=d.r*0.95, bh=d.r*1.85;
        ctx.fillStyle=c1; ctx.fillRect(-bw/2,-bh/2,bw,bh);
        ctx.lineWidth=2.5; ctx.strokeStyle="#0d0a07"; ctx.strokeRect(-bw/2,-bh/2,bw,bh);
        ctx.fillStyle="rgba(0,0,0,0.28)"; ctx.fillRect(-bw/2,-bh/2,bw,bh*0.16);
        ctx.fillStyle="rgba(255,255,255,0.08)"; ctx.fillRect(-bw/2,-bh/2,bw*0.38,bh);
        ctx.restore();
      } else if(d.t===5){   // 发光水潭
        ctx.beginPath(); ctx.ellipse(d.x,d.y,d.r*1.35,d.r*0.82,d.a,0,6.2832);
        const wg=ctx.createRadialGradient(d.x,d.y,1,d.x,d.y,d.r*1.35);
        wg.addColorStop(0,rgba(c2,0.55)); wg.addColorStop(1,rgba(c2,0.10));
        ctx.fillStyle=wg; ctx.fill();
        ctx.lineWidth=1.4; ctx.strokeStyle=rgba(c2,0.4); ctx.stroke();
      } else if(d.t===6){   // 熔岩裂纹（预生成折点，避免逐帧抖动）
        ctx.save(); ctx.translate(d.x,d.y); ctx.rotate(d.a);
        ctx.strokeStyle=c2; ctx.lineWidth=2.4; ctx.lineCap="round";
        ctx.beginPath(); ctx.moveTo(-d.r*1.4,0);
        for(const pt of d.pts) ctx.lineTo(d.r*pt[0], d.r*pt[1]);
        ctx.stroke();
        ctx.strokeStyle="rgba(255,255,255,0.35)"; ctx.lineWidth=1; ctx.stroke();
        ctx.restore();
      }
    }

    // 细网格（很淡，帮助判断移动；按主题着色）
    ctx.strokeStyle=pal.grid; ctx.lineWidth=1;
    for(let x=b.minX;x<=b.maxX;x+=80){ ctx.beginPath();ctx.moveTo(x,b.minY);ctx.lineTo(x,b.maxY);ctx.stroke(); }
    for(let y=b.minY;y<=b.maxY;y+=80){ ctx.beginPath();ctx.moveTo(b.minX,y);ctx.lineTo(b.maxX,y);ctx.stroke(); }

    // 边界（双层描边 + 内侧警示条；按主题强调色）
    ctx.lineWidth=10; ctx.strokeStyle="#0d0a07"; ctx.strokeRect(b.minX,b.minY,b.maxX-b.minX,b.maxY-b.minY);
    ctx.lineWidth=4; ctx.strokeStyle=pal.accent; ctx.strokeRect(b.minX+6,b.minY+6,b.maxX-b.minX-12,b.maxY-b.minY-12);
    ctx.lineWidth=1.5; ctx.strokeStyle=rgba(pal.accent,0.45); ctx.strokeRect(b.minX+14,b.minY+14,b.maxX-b.minX-28,b.maxY-b.minY-28);
  },

  _makeDecor(b, theme){
    const arr=[], W=b.maxX-b.minX, H=b.maxY-b.minY;
    const count=Math.round(W*H/22000);
    const pool=THEME_DECOR[theme]||THEME_DECOR.desert;
    for(let i=0;i<count;i++){
      const t=pool[Math.floor(Math.random()*pool.length)];
      const d={
        x:b.minX+30+Math.random()*(W-60),
        y:b.minY+30+Math.random()*(H-60),
        r:7+Math.random()*15,
        a:Math.random()*6.2832,
        t,
      };
      if(t===6){ // 熔岩裂纹：预生成归一化折点
        d.pts=[]; let cx=-1.4, cy=0;
        for(let k=1;k<=4;k++){ cx+=0.7; cy=(Math.random()-0.5)*0.5; d.pts.push([cx,cy]); }
      }
      arr.push(d);
    }
    return arr;
  },

  /* ----------------------------- 绘制工具 ----------------------------- */
  cellCircle(ctx,x,y,r,fill,ow=4){
    ctx.beginPath(); ctx.arc(x,y,r,0,6.2832);
    ctx.fillStyle=fill; ctx.fill();
    ctx.lineWidth=ow; ctx.strokeStyle="#0d0a07"; ctx.stroke();
  },
  eyes(ctx,x,y,a,r){
    const ex=Math.cos(a)*r*0.4, ey=Math.sin(a)*r*0.4;
    const px=-Math.sin(a)*r*0.35, py=Math.cos(a)*r*0.35;
    ctx.fillStyle="#fff";
    ctx.beginPath();ctx.arc(x+ex+px,y+ey+py,r*0.18,0,6.2832);ctx.fill();
    ctx.beginPath();ctx.arc(x+ex-px,y+ey-py,r*0.18,0,6.2832);ctx.fill();
    ctx.fillStyle="#0d0a07";
    ctx.beginPath();ctx.arc(x+ex+px,y+ey+py,r*0.09,0,6.2832);ctx.fill();
    ctx.beginPath();ctx.arc(x+ex-px,y+ey-py,r*0.09,0,6.2832);ctx.fill();
  },
  shadow(ctx,x,y,r,squash=0.5){
    ctx.beginPath(); ctx.ellipse(x,y+r*0.5,r*0.95,r*squash,0,0,6.2832);
    ctx.fillStyle="rgba(0,0,0,0.30)"; ctx.fill();
  },
  hpbar(ctx,x,y,w,hp,max){
    if(hp>=max) return;
    const h=5;
    ctx.fillStyle="#000a"; ctx.fillRect(x-w/2-1,y-1,w+2,h+2);
    ctx.fillStyle="#e23b3b"; ctx.fillRect(x-w/2,y,w*M.clamp(hp/max,0,1),h);
  },

  /* ----------------------------- 玩家 ----------------------------- */
  player(ctx,p){
    const C=CLASSES[p.classId], r=p.radius;
    this.shadow(ctx,p.x,p.y,r,0.52);

    // 护甲环：满盾实线；充能中画进度弧；破碎后闪烁提示延迟
    if(p.stats.maxShield>0){
      const rr=(r+8)*(1+Math.sin(M.now()*4)*0.03);
      if(p.shield>0){
        ctx.beginPath(); ctx.arc(p.x,p.y,rr,0,6.2832);
        ctx.strokeStyle=rgba("#3fa9f5",0.55); ctx.lineWidth=3; ctx.stroke();
      }
      if(p.shieldCharging){
        const frac=M.clamp(p.shield/p.stats.maxShield,0,1);
        ctx.beginPath(); ctx.arc(p.x,p.y,rr,-Math.PI/2,-Math.PI/2+Math.PI*2*frac);
        ctx.strokeStyle=rgba("#8fe0ff",0.95); ctx.lineWidth=3.5; ctx.stroke();
      } else if(p.shield<=0 && p.shieldTimer>0){
        ctx.beginPath(); ctx.arc(p.x,p.y,rr,0,6.2832);
        ctx.strokeStyle=rgba("#7f4a4a",0.45); ctx.lineWidth=2; ctx.setLineDash([4,6]); ctx.stroke(); ctx.setLineDash([]);
      }
    }
    // 主动技能光环
    if(p.abilityActive>0){
      ctx.beginPath(); ctx.arc(p.x,p.y,r+13+Math.sin(M.now()*8)*2.5,0,6.2832);
      ctx.strokeStyle=rgba(C.color,0.65); ctx.lineWidth=3; ctx.stroke();
    }

    // 武器（程序化枪模型：随枪型/配件/厂商变化）
    const w=p.activeWeapon;
    if(w){
      const spec=gunModelSpec(w);
      const bodyC=(MANUFACTURERS[w.manufacturer]&&MANUFACTURERS[w.manufacturer].color)||"#3a3f47";
      const accC=(w.element!=="none"&&ELEMENTS[w.element])?ELEMENTS[w.element].color:"#aab2bd";
      ctx.save(); ctx.translate(p.x,p.y); ctx.rotate(p.angle);
      drawGunCanvas(ctx, spec, 0.9, bodyC, accC);
      // 枪口闪光
      if(w.cd>0){
        const fr=(w.getFireRate?w.getFireRate(p):w.stats.fireRate)||1;
        if(w.cd > (1/fr)*0.62){
          const tip=(spec.len*0.30 + spec.barrel*0.90*0.9)*0.9;
          ctx.beginPath(); ctx.arc(tip,0,7.5,0,6.2832);
          ctx.fillStyle="rgba(255,232,130,0.92)"; ctx.fill();
          ctx.beginPath(); ctx.arc(tip,0,12,0,6.2832);
          ctx.fillStyle="rgba(255,180,60,0.25)"; ctx.fill();
        }
      }
      ctx.restore();
    }

    // 躯干
    this.cellCircle(ctx,p.x,p.y,r,C.color,4);
    // 背心内圈，制造立体层次
    ctx.beginPath(); ctx.arc(p.x,p.y,r*0.70,0,6.2832);
    ctx.fillStyle="rgba(0,0,0,0.20)"; ctx.fill();
    // 头部（更小、偏朝向，露出躯干边缘）
    const hx=p.x+Math.cos(p.angle)*r*0.18, hy=p.y+Math.sin(p.angle)*r*0.18;
    this.cellCircle(ctx,hx,hy,r*0.50,hexLighten(C.color,0.30),3);
    ctx.beginPath(); ctx.arc(hx-r*0.14,hy-r*0.16,r*0.22,0,6.2832);
    ctx.fillStyle="rgba(255,255,255,0.26)"; ctx.fill();
    this.eyes(ctx,hx,hy,p.angle,r*0.50);
  },

  /* ----------------------------- 敌人 ----------------------------- */
  enemy(ctx,e){
    const r=e.radius, x=e.x, y=e.y;
    const col = e.flash>0 ? "#ffffff" : e.color;
    const phasing = !!e.phasing;
    ctx.save();
    if(phasing) ctx.globalAlpha=0.42;          // 标记半透明
    this.shadow(ctx,x,y,r,e.type==="boss"?0.55:0.48);

    if(e.phaselocked>0){
      ctx.beginPath(); ctx.arc(x,y,r+11,0,6.2832);
      ctx.strokeStyle=rgba("#b061ff",0.85); ctx.lineWidth=3.5; ctx.stroke();
    }

    this.cellCircle(ctx,x,y,r,col, e.type==="badass"||e.type==="boss"?6:4);
    // 高光
    ctx.beginPath(); ctx.arc(x-r*0.26,y-r*0.3,r*0.5,0,6.2832);
    ctx.fillStyle="rgba(255,255,255,0.12)"; ctx.fill();

    // 类型特征
    if(e.type==="skag"){
      ctx.fillStyle="#7a3d0a"; ctx.beginPath();
      ctx.moveTo(x+Math.cos(e.angle)*(r+6),y+Math.sin(e.angle)*(r+6));
      ctx.lineTo(x+Math.cos(e.angle+0.4)*r,y+Math.sin(e.angle+0.4)*r);
      ctx.lineTo(x+Math.cos(e.angle-0.4)*r,y+Math.sin(e.angle-0.4)*r);
      ctx.closePath(); ctx.fill();
    }
    if(e.type==="boss"){
      ctx.fillStyle="#ffd23f";
      for(let i=0;i<8;i++){ const a=i/8*6.2832; ctx.beginPath();
        ctx.moveTo(x+Math.cos(a)*r,y+Math.sin(a)*r);
        ctx.lineTo(x+Math.cos(a)*(r+15),y+Math.sin(a)*(r+15));
        ctx.lineTo(x+Math.cos(a+0.22)*r,y+Math.sin(a+0.22)*r);
        ctx.closePath(); ctx.fill(); }
    }
    if(e.type==="turret"){
      ctx.fillStyle="#2a2a2a"; ctx.fillRect(x-r*0.7,y-r*0.18,r*1.4,r*0.36);
    }
    if(e.type==="badass"){
      ctx.fillStyle="#ffd23f";
      ctx.beginPath(); ctx.moveTo(x,y-r-2); ctx.lineTo(x-r*0.35,y-r*0.45); ctx.lineTo(x+r*0.35,y-r*0.45); ctx.closePath(); ctx.fill();
    }

    this.eyes(ctx,x,y,e.angle,r);
    if(e.armorType==="shield"){
      ctx.beginPath(); ctx.arc(x,y,r+5,0,6.2832);
      ctx.strokeStyle=rgba("#3fa9f5",0.45); ctx.lineWidth=2; ctx.stroke();
    }
    this.hpbar(ctx,x,y-r-13,r*2.2,e.hp,e.maxHP);
    if(e.type==="boss"){
      ctx.fillStyle="#ffd23f"; ctx.font="bold 14px sans-serif"; ctx.textAlign="center";
      ctx.strokeStyle="#0d0a07"; ctx.lineWidth=3;
      ctx.strokeText(e.name,x,y-r-20); ctx.fillText(e.name,x,y-r-20);
    }
    ctx.restore();
  },

  turret(ctx,t){
    this.shadow(ctx,t.x,t.y,t.radius,0.45);
    ctx.save(); ctx.translate(t.x,t.y); ctx.rotate(t.angle);
    ctx.fillStyle="#2a2a2a"; ctx.fillRect(0,-4,22,8);
    ctx.strokeStyle="#0d0a07"; ctx.lineWidth=2; ctx.strokeRect(0,-4,22,8);
    ctx.restore();
    this.cellCircle(ctx,t.x,t.y,t.radius,"#4aa3ff",4);
    ctx.fillStyle="#fff"; ctx.beginPath(); ctx.arc(t.x,t.y,4,0,6.2832); ctx.fill();
    this.hpbar(ctx,t.x,t.y-t.radius-8,t.radius*2,t.life,9);
  },

  /* ----------------------------- 战利品 / 宝箱 ----------------------------- */
  loot(ctx,l){
    l.bob+=0.05;
    const yy=l.y+Math.sin(l.bob)*3;
    // 光柱
    const gg=ctx.createLinearGradient(l.x,l.y-46,l.x,l.y);
    gg.addColorStop(0,rgba(l.color,0)); gg.addColorStop(1,rgba(l.color,0.22));
    ctx.fillStyle=gg; ctx.fillRect(l.x-7,l.y-46,14,46);
    if(l.kind==="weapon"){
      ctx.save(); ctx.translate(l.x,yy);
      ctx.shadowColor=l.color; ctx.shadowBlur=12;
      ctx.fillStyle=l.color; ctx.fillRect(-11,-4,22,8);
      ctx.fillStyle="#0d0a07"; ctx.fillRect(7,-2,8,4);
      ctx.shadowBlur=0; ctx.restore();
    } else if(l.kind==="shielditem"){
      ctx.save(); ctx.translate(l.x,yy);
      ctx.shadowColor=l.color; ctx.shadowBlur=14;
      ctx.beginPath();
      for(let i=0;i<6;i++){ const a=i/6*6.2832-Math.PI/2; const px=Math.cos(a)*10, py=Math.sin(a)*10; i?ctx.lineTo(px,py):ctx.moveTo(px,py); }
      ctx.closePath(); ctx.fillStyle=l.color; ctx.fill();
      ctx.strokeStyle="#0d0a07"; ctx.lineWidth=2; ctx.stroke();
      ctx.shadowBlur=0;
      ctx.beginPath(); ctx.arc(0,0,4,0,6.2832); ctx.fillStyle="#0d0a07"; ctx.fill();
      ctx.restore();
    } else if(l.kind==="relic"){
      ctx.save(); ctx.translate(l.x,yy); ctx.rotate(Math.PI/4);
      ctx.shadowColor=l.color; ctx.shadowBlur=14;
      ctx.fillStyle=l.color; ctx.fillRect(-7,-7,14,14);
      ctx.strokeStyle="#0d0a07"; ctx.lineWidth=2; ctx.strokeRect(-7,-7,14,14);
      ctx.shadowBlur=0; ctx.fillStyle="#0d0a07"; ctx.fillRect(-3,-3,6,6);
      ctx.restore();
    } else {
      ctx.save(); ctx.translate(l.x,yy);
      ctx.shadowColor=l.color; ctx.shadowBlur=9;
      ctx.fillStyle=l.color;
      ctx.beginPath(); ctx.arc(0,0,8,0,6.2832); ctx.fill();
      ctx.shadowBlur=0; ctx.fillStyle="#0d0a07";
      if(l.kind==="health"){ ctx.fillRect(-4,-1.5,8,3); ctx.fillRect(-1.5,-4,3,8); }
      else if(l.kind==="ammo"){ ctx.fillRect(-4,-4,8,8); }
      ctx.restore();
    }
  },

  chest(ctx,c){
    this.shadow(ctx,c.x,c.y,16,0.4);
    if(!c.opened){
      ctx.save(); ctx.translate(c.x,c.y);
      ctx.shadowColor="#ffd23f"; ctx.shadowBlur=14;
      ctx.fillStyle="#7a4a12"; ctx.fillRect(-16,-12,32,24);
      ctx.shadowBlur=0;
      ctx.strokeStyle="#0d0a07"; ctx.lineWidth=3; ctx.strokeRect(-16,-12,32,24);
      ctx.fillStyle="#ffd23f"; ctx.fillRect(-16,-3,32,4);
      ctx.fillStyle="#c98a00"; ctx.fillRect(-3,-8,6,7);
      ctx.restore();
    } else {
      ctx.fillStyle="#3a2a18"; ctx.fillRect(c.x-16,c.y-12,32,8);
      ctx.strokeStyle="#0d0a07"; ctx.lineWidth=2; ctx.strokeRect(c.x-16,c.y-12,32,8);
    }
  },

  projectile(ctx,p){
    if(p.laser) return this._laserBeam(ctx, p);   // 兼容旧快照：按曳光弹尾迹绘制
    // 曳光：弹头后方渐隐光带（用真实飞行轨迹做尾迹）
    const tail = p.trail.length>1 ? p.trail[0]
               : {x:p.x-Math.cos(p.angle)*42, y:p.y-Math.sin(p.angle)*42};
    this.tracerStreak(ctx, p.x, p.y, tail.x, tail.y, p.color, Math.max(2.2, p.radius*0.8));
    // 花哨弹头（沿运动方向旋转）
    ctx.save();
    ctx.translate(p.x,p.y); ctx.rotate(p.angle);
    this.bulletShape(ctx, p.shape, p.radius, p.color);
    ctx.restore();
  },

  // 曳光光带：从 (hx,hy) 弹头向 (tx,ty) 尾端渐隐，带外层光晕
  tracerStreak(ctx, hx, hy, tx, ty, color, w=2.6, alpha=1){
    color = brightenBulletColor(color);
    ctx.save();
    ctx.lineCap="round";
    // 外层光晕
    ctx.globalAlpha=0.22*alpha; ctx.strokeStyle=color; ctx.lineWidth=w*2.6;
    ctx.beginPath(); ctx.moveTo(tx,ty); ctx.lineTo(hx,hy); ctx.stroke();
    // 渐变芯线（尾透明 → 头实色）
    const g=ctx.createLinearGradient(tx,ty,hx,hy);
    g.addColorStop(0, rgba(color,0)); g.addColorStop(0.55, rgba(color,0.38*alpha)); g.addColorStop(1, rgba(color,0.9*alpha));
    ctx.globalAlpha=1; ctx.strokeStyle=g; ctx.lineWidth=w;
    ctx.beginPath(); ctx.moveTo(tx,ty); ctx.lineTo(hx,hy); ctx.stroke();
    ctx.restore();
  },

  // 弹头轮廓：在原点、+x 朝前的坐标系里画一个实体弹丸（兵工厂 / 弹种 / 枪型决定）
  bulletShape(ctx, shape, r, color){
    color = brightenBulletColor(color);
    ctx.save();
    ctx.fillStyle=color; ctx.shadowColor=color; ctx.shadowBlur=9;
    ctx.lineJoin="round";
    ctx.beginPath();
    switch(shape){
      case "dart":
        ctx.moveTo(r*2,0); ctx.lineTo(-r,r*0.8); ctx.lineTo(-r*0.4,0); ctx.lineTo(-r,-r*0.8); ctx.closePath(); break;
      case "slug":
        ctx.rect(-r*1.4,-r*0.55,r*2.8,r*1.1); break;
      case "box":
        ctx.rect(-r,-r,r*2,r*2); break;
      case "bomb":
        ctx.arc(0,0,r,0,6.2832); break;
      default:                // v0.15.0：旧存档中的特殊弹型统一回落为实体弹头
        ctx.arc(0,0,r,0,6.2832);
    }
    ctx.fill();
    ctx.shadowBlur=0;
    // 深色描边增强轮廓
    ctx.lineWidth=1.1; ctx.strokeStyle="rgba(13,10,7,0.8)"; ctx.stroke();
    // 榴弹战斗部的引信高光
    if(shape==="bomb"){ ctx.beginPath(); ctx.arc(r*0.8,-r*0.6,r*0.4,0,6.2832); ctx.fillStyle="#c8a86a"; ctx.fill(); }
    ctx.restore();
  },

  // 曳光弹：沿弹道的高亮尾迹（外发光 + 白色芯线），仅用于兼容旧快照
  _laserBeam(ctx, p){
    const len = Math.max(20, p.radius*5);
    ctx.save();
    ctx.translate(p.x,p.y); ctx.rotate(p.angle);
    ctx.lineCap="round";
    // 外层光晕
    ctx.strokeStyle=rgba(p.color,0.35); ctx.lineWidth=len*0.18;
    ctx.beginPath(); ctx.moveTo(-len*0.6,0); ctx.lineTo(len*0.7,0); ctx.stroke();
    // 中层
    ctx.shadowColor=p.color; ctx.shadowBlur=10;
    ctx.strokeStyle=p.color; ctx.lineWidth=3.4;
    ctx.beginPath(); ctx.moveTo(-len*0.6,0); ctx.lineTo(len*0.7,0); ctx.stroke();
    // 白色芯线
    ctx.shadowBlur=0; ctx.strokeStyle="rgba(255,255,255,0.92)"; ctx.lineWidth=1.4;
    ctx.beginPath(); ctx.moveTo(-len*0.6,0); ctx.lineTo(len*0.7,0); ctx.stroke();
    ctx.restore();
  },

  particles(ctx,arr){
    for(const p of arr){
      const a=M.clamp(p.life/p.maxLife,0,1);
      if(p.ring){
        ctx.strokeStyle=rgba(p.color,a); ctx.lineWidth=4*a+1;
        ctx.beginPath(); ctx.arc(p.x,p.y,p.size*(1-a)+p.size*0.2,0,6.2832); ctx.stroke();
      } else {
        ctx.fillStyle=rgba(p.color,a);
        ctx.beginPath(); ctx.arc(p.x,p.y,p.size*a+0.5,0,6.2832); ctx.fill();
      }
    }
  },

  floats(ctx,arr){
    ctx.textAlign="center";
    for(const f of arr){
      const a=M.clamp(f.life/f.maxLife,0,1);
      ctx.font=`900 ${f.size||14}px "Trebuchet MS",sans-serif`;
      ctx.fillStyle=rgba(f.color,a);
      ctx.strokeStyle=rgba("#0d0a07",a*0.85); ctx.lineWidth=3;
      ctx.strokeText(f.text,f.x,f.y); ctx.fillText(f.text,f.x,f.y);
    }
  },

  /* ----------------------------- 自动瞄准辅助 ----------------------------- */
  aimAssist(ctx,game){
    if(!Input.isTouch || !Input.aimTarget) return;
    const p=game.player, t=Input.aimTarget;
    if(!t.alive) return;
    const a=M.angle(p.x,p.y,t.x,t.y);
    const r=t.radius+11;
    const pulse=1+Math.sin(M.now()*9)*0.06;

    // 旋转锁定括弧
    ctx.save(); ctx.translate(t.x,t.y); ctx.rotate(M.now()*1.7);
    ctx.strokeStyle="rgba(255,72,72,0.9)"; ctx.lineWidth=2.6; ctx.lineCap="round";
    const gap=0.5;
    for(let i=0;i<4;i++){
      const base=i*Math.PI/2;
      ctx.beginPath(); ctx.arc(0,0,r*pulse, base+gap/2, base+Math.PI/2-gap/2); ctx.stroke();
    }
    ctx.restore();

    // 流向目标的虚线
    ctx.save();
    ctx.setLineDash([6,10]); ctx.lineDashOffset=-M.now()*30;
    ctx.strokeStyle="rgba(255,90,90,0.30)"; ctx.lineWidth=1.6;
    ctx.beginPath();
    ctx.moveTo(p.x+Math.cos(a)*(p.radius+10), p.y+Math.sin(a)*(p.radius+10));
    ctx.lineTo(t.x-Math.cos(a)*r, t.y-Math.sin(a)*r);
    ctx.stroke();
    ctx.restore();
  },

  /* ----------------------------- 屏幕层 ----------------------------- */
  joystick(ctx){
    if(!Input.isTouch) return;
    const s=Input.stick;
    if(!s.active) return;
    const R=Input.stickRadius;
    ctx.save();
    // 外圈
    ctx.beginPath(); ctx.arc(s.cx,s.cy,R,0,6.2832);
    ctx.fillStyle="rgba(0,0,0,0.24)"; ctx.fill();
    ctx.lineWidth=3; ctx.strokeStyle="rgba(255,210,63,0.38)"; ctx.stroke();
    // 内圈
    ctx.beginPath(); ctx.arc(s.cx,s.cy,R*0.56,0,6.2832);
    ctx.strokeStyle="rgba(255,255,255,0.12)"; ctx.lineWidth=2; ctx.stroke();
    // 摇杆头
    const kx=s.cx+s.dx*R*0.72, ky=s.cy+s.dy*R*0.72, kr=R*0.36;
    const g=ctx.createRadialGradient(kx-kr*0.35,ky-kr*0.4,kr*0.15,kx,ky,kr);
    g.addColorStop(0,"#ffe98a"); g.addColorStop(1,"#c98900");
    ctx.beginPath(); ctx.arc(kx,ky,kr,0,6.2832);
    ctx.fillStyle=g; ctx.fill();
    ctx.lineWidth=3; ctx.strokeStyle="#0d0a07"; ctx.stroke();
    // 方向三角
    if(s.mag>0.18){
      const a=Math.atan2(s.dy,s.dx);
      ctx.beginPath();
      ctx.moveTo(s.cx+Math.cos(a)*(R+9), s.cy+Math.sin(a)*(R+9));
      ctx.lineTo(s.cx+Math.cos(a+0.52)*(R-2), s.cy+Math.sin(a+0.52)*(R-2));
      ctx.lineTo(s.cx+Math.cos(a-0.52)*(R-2), s.cy+Math.sin(a-0.52)*(R-2));
      ctx.closePath();
      ctx.fillStyle="rgba(255,210,63,0.55)"; ctx.fill();
    }
    ctx.restore();
  },

  vignette(ctx,game){
    const v=game.view, key=v.w+"x"+v.h;
    if(this._vigKey!==key){
      const g=ctx.createRadialGradient(v.w/2,v.h/2,Math.min(v.w,v.h)*0.42, v.w/2,v.h/2, Math.max(v.w,v.h)*0.78);
      g.addColorStop(0,"rgba(0,0,0,0)"); g.addColorStop(0.62,"rgba(0,0,0,0.10)"); g.addColorStop(1,"rgba(0,0,0,0.48)");
      this._vig=g; this._vigKey=key;
    }
    ctx.fillStyle=this._vig; ctx.fillRect(0,0,v.w,v.h);
  },

  /* 锁定目标在屏幕外时，在屏幕边缘画指向箭头 */
  targetEdge(ctx,game){
    if(!Input.isTouch || !Input.aimTarget) return;
    const t=Input.aimTarget; if(!t.alive) return;
    const v=game.view, s=game.worldToScreen(t.x,t.y);
    const m=36;
    if(s.x>=m && s.x<=v.w-m && s.y>=m && s.y<=v.h-m) return;
    const cx=v.w/2, cy=v.h/2;
    const a=Math.atan2(s.y-cy, s.x-cx);
    const hw=v.w/2-m, hh=v.h/2-m;
    const scale=Math.min(hw/Math.max(1e-3,Math.abs(Math.cos(a))), hh/Math.max(1e-3,Math.abs(Math.sin(a))));
    const px=cx+Math.cos(a)*scale, py=cy+Math.sin(a)*scale;
    ctx.save(); ctx.translate(px,py); ctx.rotate(a);
    ctx.beginPath(); ctx.moveTo(12,0); ctx.lineTo(-7,-8); ctx.lineTo(-7,8); ctx.closePath();
    ctx.fillStyle="rgba(255,72,72,0.92)"; ctx.fill();
    ctx.strokeStyle="#0d0a07"; ctx.lineWidth=2; ctx.stroke();
    ctx.restore();
  },

  /* 区域小地图 */
  minimap(ctx,game){
    const b=game.bounds, v=game.view;
    if(!b || !game.player) return;
    const w=Input.isTouch?92:132;
    const h=w*(b.maxY-b.minY)/Math.max(1,b.maxX-b.minX);
    const x=12, y=120;
    ctx.save();
    ctx.globalAlpha=0.88;
    ctx.fillStyle="rgba(8,6,4,0.62)"; ctx.fillRect(x,y,w,h);
    ctx.strokeStyle="#0d0a07"; ctx.lineWidth=2; ctx.strokeRect(x,y,w,h);
    ctx.strokeStyle="rgba(255,210,63,0.35)"; ctx.lineWidth=1; ctx.strokeRect(x+2,y+2,w-4,h-4);
    const sx=w/(b.maxX-b.minX), sy=h/(b.maxY-b.minY);
    // 敌人
    ctx.fillStyle="#ff5a5a";
    for(const e of game.enemies){ if(!e.alive) continue;
      const ex=x+(e.x-b.minX)*sx, ey=y+(e.y-b.minY)*sy;
      ctx.fillRect(ex-1.5,ey-1.5,e.type==="boss"?5:3,e.type==="boss"?5:3);
    }
    // 宝箱
    ctx.fillStyle="#ffd23f";
    for(const c of game.world.chests){ if(c.opened) continue;
      ctx.fillRect(x+(c.x-b.minX)*sx-2, y+(c.y-b.minY)*sy-2, 4,4);
    }
    // 玩家
    const px=x+(game.player.x-b.minX)*sx, py=y+(game.player.y-b.minY)*sy;
    ctx.fillStyle="#7fd0ff";
    ctx.beginPath(); ctx.arc(px,py,3.2,0,6.2832); ctx.fill();
    ctx.strokeStyle="#0d0a07"; ctx.lineWidth=1.5; ctx.stroke();
    ctx.restore();
  },

  bossBar(ctx,game){
    let boss=null;
    for(const e of game.enemies){ if(e.alive && e.type==="boss"){ boss=e; break; } }
    if(!boss) return;
    const v=game.view, w=Math.min(v.w*0.66,520), x=(v.w-w)/2, y=96, h=14;
    ctx.save();
    // 背板
    ctx.fillStyle="rgba(0,0,0,0.55)"; ctx.fillRect(x-4,y-4,w+8,h+8);
    ctx.strokeStyle="#0d0a07"; ctx.lineWidth=3; ctx.strokeRect(x-4,y-4,w+8,h+8);
    // 血量
    const pct=M.clamp(boss.hp/boss.maxHP,0,1);
    const g=ctx.createLinearGradient(x,0,x+w,0);
    g.addColorStop(0,"#ff4b4b"); g.addColorStop(0.6,"#e23b3b"); g.addColorStop(1,"#ff8a1e");
    ctx.fillStyle=g; ctx.fillRect(x,y,w*pct,h);
    ctx.strokeStyle="rgba(0,0,0,0.5)"; ctx.lineWidth=1; ctx.strokeRect(x,y,w*pct,h);
    // 名称 + 等级
    const label = `${boss.name}  Lv.${boss.level}`;
    ctx.font='900 13px "Trebuchet MS",sans-serif'; ctx.textAlign="center";
    ctx.fillStyle="#ffd23f"; ctx.strokeStyle="#0d0a07"; ctx.lineWidth=3;
    ctx.strokeText(label, v.w/2, y-10); ctx.fillText(label, v.w/2, y-10);
    // 血量数值（右对齐）
    ctx.textAlign="right"; ctx.font='700 11px "Trebuchet MS",sans-serif';
    ctx.fillStyle="#e8dcc4";
    const hpTxt=`${Math.ceil(boss.hp)} / ${boss.maxHP}`;
    ctx.strokeText(hpTxt, x+w, y+h+15); ctx.fillText(hpTxt, x+w, y+h+15);
    // 阶段刻度（1/3、2/3）
    ctx.strokeStyle="rgba(0,0,0,0.45)"; ctx.lineWidth=2;
    for(const q of [0.33,0.66]){
      ctx.beginPath(); ctx.moveTo(x+w*q,y); ctx.lineTo(x+w*q,y+h); ctx.stroke();
    }
    ctx.restore();
  },
};

/* =========================================================================
 * RenderDust — 沙二模式的俯视角渲染 + 自绘 HUD
 * ========================================================================= */
const RenderDust = {
  TCOL:"#d9a441", CTCOL:"#5ea9ff",

  render(ctx, game){
    const D=Dust2, map=D.map, v=game.view;
    if(!map) return;
    const cam=game.camera;
    const z=game.zoom||1;
    let sx=0,sy=0;
    if(D.shakeT>0){ sx=(Math.random()-0.5)*8; sy=(Math.random()-0.5)*8; }

    ctx.save();
    ctx.translate(sx,sy);
    ctx.scale(z,z);                     // 镜头缩放：视野更大，能看到视线远端
    ctx.translate(-cam.x,-cam.y);
    this.terrain(ctx, game, cam, z);
    this.sites(ctx);
    this.groundFx(ctx, D);
    this.bomb(ctx, D);
    this.drops(ctx, D);
    this.units(ctx, D);
    this.tracers(ctx, D);
    this.nades(ctx, D);
    this.rockets(ctx, D);
    ctx.restore();

    this.blind(ctx, D);
    this.hud(ctx, game);
  },

  terrain(ctx, game, cam, z){
    const map=Dust2.map, TS=DUST_TILE, v=game.view;
    const vw=v.w/z, vh=v.h/z;
    const x0=Math.max(0, Math.floor(cam.x/TS)-1), x1=Math.min(DUST_COLS-1, Math.ceil((cam.x+vw)/TS)+1);
    const y0=Math.max(0, Math.floor(cam.y/TS)-1), y1=Math.min(DUST_ROWS-1, Math.ceil((cam.y+vh)/TS)+1);
    // 岩体底色：整片先铺墙色，再挖出可走区域，避免出现"黑洞"
    ctx.fillStyle="#2b2118"; ctx.fillRect(cam.x-20,cam.y-20,vw+40,vh+40);

    // 可走层：地面 / A 点高架平台 / 坡道，三种质感
    for(let y=y0;y<=y1;y++){
      for(let x=x0;x<=x1;x++){
        const gv=map.grid[y][x];
        if(gv!==DUST_GROUND && gv!==DUST_PLAT && gv!==DUST_RAMP) continue;
        const px=x*TS, py=y*TS;
        if(gv===DUST_PLAT){
          // 高架平台：更亮的沙色 + 抬升感
          ctx.fillStyle=((x*7+y*3)%5<2)?"#cfa968":"#c39a58";
          ctx.fillRect(px,py,TS,TS);
          ctx.strokeStyle="rgba(255,235,190,0.28)"; ctx.lineWidth=1.5;
          ctx.strokeRect(px+1,py+1,TS-2,TS-2);
        } else if(gv===DUST_RAMP){
          // 坡道 / 楼梯：地面色 + 台阶纹
          ctx.fillStyle=((x*7+y*3)%5<2)?"#b28d52":"#a6824a";
          ctx.fillRect(px,py,TS,TS);
          ctx.strokeStyle="rgba(60,42,22,0.4)"; ctx.lineWidth=1.5;
          ctx.beginPath();
          const horiz=(x+y)%2===0;
          for(let s=6;s<TS;s+=10){
            if(horiz){ ctx.moveTo(px+3,py+s); ctx.lineTo(px+TS-3,py+s); }
            else{ ctx.moveTo(px+s,py+3); ctx.lineTo(px+s,py+TS-3); }
          }
          ctx.stroke();
        } else {
          ctx.fillStyle=((x*7+y*3)%5<2)?"#a9834f":"#9d7845";
          ctx.fillRect(px,py,TS,TS);
          // 细沙纹
          if((x*13+y*7)%11===0){
            ctx.fillStyle="rgba(0,0,0,0.045)";
            ctx.fillRect(px+6,py+10,TS-12,3);
          }
        }
      }
    }
    // 平台外缘描边（双层结构的"悬崖"）
    ctx.strokeStyle="rgba(43,29,12,0.85)"; ctx.lineWidth=3;
    for(let y=y0;y<=y1;y++){
      for(let x=x0;x<=x1;x++){
        if(map.grid[y][x]!==DUST_PLAT) continue;
        const px=x*TS, py=y*TS;
        if(map.grid[y+1]&&map.grid[y+1][x]===DUST_GROUND){ ctx.beginPath(); ctx.moveTo(px,py+TS); ctx.lineTo(px+TS,py+TS); ctx.stroke(); }
        if(map.grid[y]&&map.grid[y][x+1]===DUST_GROUND){ ctx.beginPath(); ctx.moveTo(px+TS,py); ctx.lineTo(px+TS,py+TS); ctx.stroke(); }
        if(map.grid[y]&&map.grid[y][x-1]===DUST_GROUND){ ctx.beginPath(); ctx.moveTo(px,py); ctx.lineTo(px,py+TS); ctx.stroke(); }
        if(map.grid[y-1]&&map.grid[y-1][x]===DUST_GROUND){ ctx.beginPath(); ctx.moveTo(px,py); ctx.lineTo(px+TS,py); ctx.stroke(); }
      }
    }
    // 墙体
    for(let y=y0;y<=y1;y++){
      for(let x=x0;x<=x1;x++){
        const gv=map.grid[y][x];
        if(gv===DUST_GROUND||gv===DUST_PLAT||gv===DUST_RAMP||gv===DUST_LOW) continue;
        const px=x*TS, py=y*TS;
        let near=false;
        const nb=[[1,0],[-1,0],[0,1],[0,-1]];
        for(const [dx,dy] of nb){
          const tv=map.grid[y+dy]&&map.grid[y+dy][x+dx];
          if(tv===DUST_GROUND||tv===DUST_PLAT||tv===DUST_RAMP){ near=true; break; }
        }
        if(!near) continue;
        ctx.fillStyle="#3f3122"; ctx.fillRect(px,py,TS,TS);
        ctx.fillStyle="#57442e"; ctx.fillRect(px,py,TS,7);
        ctx.strokeStyle="rgba(0,0,0,0.35)"; ctx.lineWidth=1.5;
        ctx.strokeRect(px+0.5,py+0.5,TS-1,TS-1);
      }
    }
    // 墙体边缘阴影，让通道更有厚度
    for(let y=y0;y<=y1;y++){
      for(let x=x0;x<=x1;x++){
        const gv=map.grid[y][x];
        if(gv===DUST_GROUND||gv===DUST_PLAT||gv===DUST_RAMP) continue;
        const px=x*TS, py=y*TS;
        const tv=map.grid[y+1]&&map.grid[y+1][x];
        if(tv===DUST_GROUND||tv===DUST_PLAT||tv===DUST_RAMP){ ctx.fillStyle="rgba(0,0,0,0.22)"; ctx.fillRect(px,py+TS-6,TS,6); }
      }
    }
    // 掩体 / 箱子
    for(const c of map.crates){
      if(c.x>cam.x+vw+80||c.x+c.w<cam.x-80||c.y>cam.y+vh+80||c.y+c.h<cam.y-80) continue;
      ctx.fillStyle="#6d4f2c"; ctx.fillRect(c.x,c.y,c.w,c.h);
      ctx.fillStyle="#8a663a"; ctx.fillRect(c.x,c.y,c.w,6);
      ctx.strokeStyle="#241a10"; ctx.lineWidth=2.5; ctx.strokeRect(c.x+1,c.y+1,c.w-2,c.h-2);
      ctx.strokeStyle="rgba(0,0,0,0.25)"; ctx.lineWidth=1.5;
      ctx.beginPath(); ctx.moveTo(c.x+2,c.y+c.h-2); ctx.lineTo(c.x+c.w-2,c.y+2); ctx.stroke();
    }
    // 场地边界
    ctx.strokeStyle="#0d0b09"; ctx.lineWidth=6;
    ctx.strokeRect(0,0,map.w,map.h);
  },

  sites(ctx){
    const map=Dust2.map;
    for(const k in map.sites){
      const s=map.sites[k];
      const col = k==="A" ? "rgba(255,120,60," : "rgba(90,160,255,";
      ctx.fillStyle=col+"0.10)";
      ctx.fillRect(s.x0,s.y0,s.x1-s.x0,s.y1-s.y0);
      ctx.strokeStyle=col+"0.42)"; ctx.lineWidth=3;
      ctx.setLineDash([12,10]);
      ctx.strokeRect(s.x0+2,s.y0+2,s.x1-s.x0-4,s.y1-s.y0-4);
      ctx.setLineDash([]);
      ctx.font='900 64px "Trebuchet MS",sans-serif';
      ctx.textAlign="center";
      ctx.fillStyle=col+"0.16)";
      ctx.fillText(k,(s.x0+s.x1)/2,(s.y0+s.y1)/2+22);
      ctx.font='700 13px "Trebuchet MS",sans-serif';
      ctx.fillStyle=col+"0.55)";
      ctx.fillText("BOMBSITE "+k,(s.x0+s.x1)/2,s.y0+22);
    }
  },

  groundFx(ctx, D){
    for(const f of D.fires){
      const a=Math.min(1, f.t/1.0)*0.45;
      const g=ctx.createRadialGradient(f.x,f.y,f.r*0.1,f.x,f.y,f.r);
      g.addColorStop(0,`rgba(255,190,60,${a})`);
      g.addColorStop(0.6,`rgba(255,90,20,${a*0.6})`);
      g.addColorStop(1,"rgba(255,60,0,0)");
      ctx.fillStyle=g; ctx.beginPath(); ctx.arc(f.x,f.y,f.r,0,6.2832); ctx.fill();
    }
    for(const s of D.smokes){
      const a=Math.min(0.85, s.t/3, 1)*0.8;
      const g=ctx.createRadialGradient(s.x,s.y,10,s.x,s.y,s.r);
      g.addColorStop(0,`rgba(220,220,225,${a})`);
      g.addColorStop(0.7,`rgba(190,190,200,${a*0.8})`);
      g.addColorStop(1,"rgba(170,170,180,0)");
      ctx.fillStyle=g; ctx.beginPath(); ctx.arc(s.x,s.y,s.r,0,6.2832); ctx.fill();
    }
  },

  bomb(ctx, D){
    const b=D.bomb; if(!b||b.planted===false&&!b.dropped) return;
    if(b.planted){
      const pulse=0.5+Math.sin(M.now()*8)*0.5;
      ctx.save();
      ctx.beginPath(); ctx.arc(b.x,b.y,34+pulse*8,0,6.2832);
      ctx.fillStyle=`rgba(255,60,40,${0.10+pulse*0.12})`; ctx.fill();
      ctx.fillStyle="#241a12"; ctx.fillRect(b.x-11,b.y-8,22,16);
      ctx.strokeStyle="#ff5a3c"; ctx.lineWidth=2.5; ctx.strokeRect(b.x-11,b.y-8,22,16);
      ctx.fillStyle=`rgba(255,80,60,${0.5+pulse*0.5})`;
      ctx.fillRect(b.x-3,b.y-3,6,6);
      ctx.restore();
    } else if(b.dropped){
      ctx.save();
      ctx.translate(b.x,b.y);
      ctx.fillStyle="#2a2018"; ctx.fillRect(-8,-6,16,12);
      ctx.strokeStyle="#ffb020"; ctx.lineWidth=2; ctx.strokeRect(-8,-6,16,12);
      ctx.restore();
    }
  },

  /* 死亡掉落的枪械 / 装备 */
  drops(ctx, D){
    for(const d of D.drops){
      const bob=Math.sin(M.now()*4 + d.x)*2;
      ctx.save();
      ctx.translate(d.x, d.y+bob);
      // 地面阴影
      ctx.fillStyle="rgba(0,0,0,0.35)";
      ctx.beginPath(); ctx.ellipse(0, 9, 13, 5, 0, 0, 6.2832); ctx.fill();
      // 武器箱
      ctx.fillStyle="#33271c"; ctx.fillRect(-12,-9,24,18);
      ctx.strokeStyle=d.side==="t"?"#d9a441":"#5ea9ff"; ctx.lineWidth=2; ctx.strokeRect(-12,-9,24,18);
      // 枪械剪影
      ctx.strokeStyle="#e9e4dc"; ctx.lineWidth=2; ctx.lineCap="round";
      ctx.beginPath();
      ctx.moveTo(-8,-1); ctx.lineTo(8,-1);
      ctx.moveTo(-2,-1); ctx.lineTo(-2,-6);
      ctx.stroke();
      if(d.helmet){ ctx.fillStyle="#5ea9ff"; ctx.fillRect(-12,-12,5,4); }
      if(d.kit){ ctx.fillStyle="#9be07a"; ctx.fillRect(7,-12,5,4); }
      ctx.restore();
    }
  },

  units(ctx, D){
    const D2=Dust2;
    // 玩家最后画，保证永远在最上层不被队友盖住
    const list=D2.allDuelists().filter(d=>d.alive).sort((a,b)=>(a.isPlayer?1:0)-(b.isPlayer?1:0));
    for(const d of list){
      const col = d.side==="t" ? this.TCOL : this.CTCOL;
      ctx.beginPath(); ctx.ellipse(d.x, d.y+d.radius*0.55, d.radius*0.95, d.radius*0.5, 0,0,6.2832);
      ctx.fillStyle="rgba(0,0,0,0.32)"; ctx.fill();

      // 枪
      ctx.save(); ctx.translate(d.x,d.y); ctx.rotate(d.angle);
      ctx.fillStyle="#1d1a16"; ctx.fillRect(d.radius-3,-3.5,20,7);
      ctx.strokeStyle="rgba(0,0,0,0.6)"; ctx.lineWidth=1.4; ctx.strokeRect(d.radius-3,-3.5,20,7);
      ctx.restore();

      // 身体
      ctx.beginPath(); ctx.arc(d.x,d.y,d.radius,0,6.2832);
      ctx.fillStyle = d.flash>0 ? "#ffffff" : col; ctx.fill();
      ctx.lineWidth=3; ctx.strokeStyle="#0d0b09"; ctx.stroke();

      // 头
      ctx.beginPath();
      ctx.arc(d.x+Math.cos(d.angle)*d.radius*0.28, d.y+Math.sin(d.angle)*d.radius*0.28, d.radius*0.46,0,6.2832);
      ctx.fillStyle=hexLighten(col,0.35); ctx.fill();
      ctx.lineWidth=2; ctx.strokeStyle="#0d0b09"; ctx.stroke();

      if(d.isPlayer){
        // 玩家：双层白环 + 头顶箭头，混在人群里也能一眼找到
        ctx.beginPath(); ctx.arc(d.x,d.y,d.radius+6,0,6.2832);
        ctx.strokeStyle="rgba(0,0,0,0.55)"; ctx.lineWidth=4; ctx.stroke();
        ctx.beginPath(); ctx.arc(d.x,d.y,d.radius+6,0,6.2832);
        ctx.strokeStyle="rgba(255,255,255,0.95)"; ctx.lineWidth=2; ctx.stroke();
        const ty0=d.y-d.radius-17;
        ctx.beginPath();
        ctx.moveTo(d.x, ty0+7); ctx.lineTo(d.x-6, ty0-2); ctx.lineTo(d.x+6, ty0-2); ctx.closePath();
        ctx.fillStyle="#fff"; ctx.fill();
        ctx.strokeStyle="#0d0b09"; ctx.lineWidth=1.5; ctx.stroke();
      } else if(d.team==="A"){
        ctx.beginPath(); ctx.arc(d.x,d.y,d.radius+3,0,6.2832);
        ctx.strokeStyle="rgba(120,220,140,0.55)"; ctx.lineWidth=1.6; ctx.stroke();
      }

      // 血条
      if(d.hp<100){
        const w=30;
        ctx.fillStyle="rgba(0,0,0,0.6)"; ctx.fillRect(d.x-w/2-1, d.y-d.radius-11, w+2, 5);
        ctx.fillStyle=d.hp>50?"#5bd66a":d.hp>25?"#ffb020":"#e23b3b";
        ctx.fillRect(d.x-w/2, d.y-d.radius-10, w*M.clamp(d.hp/100,0,1), 3);
      }
      // 带包标记
      if(d.hasBomb){
        ctx.fillStyle="#ffb020"; ctx.font="bold 12px sans-serif"; ctx.textAlign="center";
        ctx.fillText("C4", d.x, d.y-d.radius-16);
      }
      // 下包 / 拆包进度
      if(d.plantT>0){
        this.progress(ctx, d.x, d.y-34, d.plantT/CS2.plantTime, "#ff8a1e", "安放");
      }
      if(d.defuseT>0){
        const need=d.kit?CS2.defuseKitTime:CS2.defuseTime;
        this.progress(ctx, d.x, d.y-34, d.defuseT/need, "#4ad6ff", "拆除");
      }
    }
  },

  progress(ctx,x,y,pct,color,label){
    const w=44,h=5;
    ctx.fillStyle="rgba(0,0,0,0.7)"; ctx.fillRect(x-w/2-1,y-1,w+2,h+2);
    ctx.fillStyle=color; ctx.fillRect(x-w/2,y,w*M.clamp(pct,0,1),h);
    ctx.font="bold 10px sans-serif"; ctx.textAlign="center"; ctx.fillStyle=color;
    ctx.fillText(label, x, y-5);
  },

  tracers(ctx, D){
    // 实体弹丸 = 飞行色块；曳光尾迹 = 弹道光带
    for(const t of D.tracers){
      const a=M.clamp(t.t/(t.t0||0.07),0,1);
      if(t.laser){
        ctx.lineCap="round";
        ctx.strokeStyle=rgba(t.color,a*0.28); ctx.lineWidth=6;
        ctx.beginPath(); ctx.moveTo(t.x1,t.y1); ctx.lineTo(t.x2,t.y2); ctx.stroke();
        ctx.shadowColor=t.color; ctx.shadowBlur=9;
        ctx.strokeStyle=rgba(t.color,a*0.9); ctx.lineWidth=2.6;
        ctx.beginPath(); ctx.moveTo(t.x1,t.y1); ctx.lineTo(t.x2,t.y2); ctx.stroke();
        ctx.shadowBlur=0; ctx.strokeStyle=rgba("#ffffff",a*0.9); ctx.lineWidth=1.1;
        ctx.beginPath(); ctx.moveTo(t.x1,t.y1); ctx.lineTo(t.x2,t.y2); ctx.stroke();
      } else {
        const bx=t.bx!==undefined?t.bx:t.x1, by=t.by!==undefined?t.by:t.y1;
        const ang=Math.atan2(t.y2-t.y1, t.x2-t.x1);
        const dist=Math.hypot(t.x2-t.x1, t.y2-t.y1);
        const tl=Math.min(88, Math.max(26, dist*0.5));
        Render.tracerStreak(ctx, bx, by, bx-Math.cos(ang)*tl, by-Math.sin(ang)*tl, t.color, 2.4, a);
        ctx.save(); ctx.globalAlpha=a; ctx.translate(bx,by); ctx.rotate(ang);
        Render.bulletShape(ctx, t.shape||"round", 4.2, t.color);
        ctx.restore(); ctx.globalAlpha=1;
      }
    }
    for(const h of D.hitmarks){
      const a=M.clamp(h.t/0.25,0,1);
      ctx.fillStyle=`rgba(${h.head?"255,210,63":"255,255,255"},${a})`;
      ctx.beginPath(); ctx.arc(h.x,h.y,4*a+1,0,6.2832); ctx.fill();
    }
  },

  nades(ctx,D){
    for(const n of D.nades){
      const k=M.clamp(n.t/n.dur,0,1);
      const y=n.y-Math.sin(k*Math.PI)*22;
      ctx.beginPath(); ctx.arc(n.x,y,5,0,6.2832);
      ctx.fillStyle= n.type==="he"?"#ffb020":n.type==="smoke"?"#c8c8d0":n.type==="flash"?"#fff6a0":"#ff6b3d";
      ctx.fill(); ctx.strokeStyle="#0d0b09"; ctx.lineWidth=1.5; ctx.stroke();
    }
  },

  // 火箭弹：尾焰 + 弹体
  rockets(ctx,D){
    for(const rk of (D.rockets||[])){
      const bx=rk.x-Math.cos(rk.ang)*8, by=rk.y-Math.sin(rk.ang)*8;
      ctx.save(); ctx.lineCap="round";
      ctx.strokeStyle=rgba("#ff9a1f",0.55); ctx.lineWidth=5;
      ctx.beginPath(); ctx.moveTo(bx-Math.cos(rk.ang)*16, by-Math.sin(rk.ang)*16); ctx.lineTo(bx,by); ctx.stroke();
      ctx.strokeStyle=rgba("#ffe08a",0.85); ctx.lineWidth=2;
      ctx.beginPath(); ctx.moveTo(bx-Math.cos(rk.ang)*9, by-Math.sin(rk.ang)*9); ctx.lineTo(bx,by); ctx.stroke();
      ctx.restore();
      ctx.save(); ctx.translate(rk.x,rk.y); ctx.rotate(rk.ang);
      ctx.fillStyle="#c9d1da"; ctx.fillRect(-7,-3,13,6);
      ctx.fillStyle=rk.color||"#ffb020"; ctx.beginPath(); ctx.moveTo(10,0); ctx.lineTo(5,-3.2); ctx.lineTo(5,3.2); ctx.closePath(); ctx.fill();
      ctx.strokeStyle="#0d0a07"; ctx.lineWidth=1; ctx.strokeRect(-7,-3,13,6);
      ctx.restore();
    }
  },

  blind(ctx, D){
    if(D.playerFlashed>0){
      const a=M.clamp(D.playerFlashed,0,1);
      ctx.fillStyle=`rgba(255,255,255,${a})`;
      ctx.fillRect(0,0,game_view_w(),game_view_h());
    }
  },

  /* ----------------------------- HUD ----------------------------- */
  hud(ctx, game){
    const D=Dust2, v=game.view, p=D.player;
    if(!p) return;

    /* 顶部比分条（移动端收窄，给雷达和暂停键让位） */
    const touch=Input.isTouch;
    const panelW = touch ? Math.min(226, v.w-150) : Math.min(430, v.w-24);
    const px = touch ? Math.max(98, (v.w-panelW)/2) : (v.w-panelW)/2;
    const py = 10;
    ctx.save();
    ctx.fillStyle="rgba(10,9,8,0.78)";
    ctx.fillRect(px,py,panelW,46);
    ctx.strokeStyle="rgba(255,255,255,0.10)"; ctx.lineWidth=1; ctx.strokeRect(px+0.5,py+0.5,panelW-1,45);

    const mySide=D.playerSide();
    const leftSide = mySide==="ct" ? "ct" : "t";
    ctx.textAlign="center";
    ctx.font=`900 ${touch?20:26}px "Trebuchet MS",sans-serif`;
    ctx.fillStyle = D.score.A>D.score.B ? "#ffd23f" : "#e8dcc4";
    ctx.fillText(String(D.score.A), px+panelW*0.30, py+32);
    ctx.fillStyle = D.score.B>D.score.A ? "#ffd23f" : "#e8dcc4";
    ctx.fillText(String(D.score.B), px+panelW*0.70, py+32);

    // 计时
    const t=Math.max(0,D.timer);
    const mm=Math.floor(t/60), ss=Math.floor(t%60);
    const timeStr = D.bomb.planted ? "C4 " + Math.max(0,Math.ceil(D.bomb.timer)) : `${mm}:${String(ss).padStart(2,"0")}`;
    ctx.font=`900 ${touch?16:20}px "Trebuchet MS",sans-serif`;
    ctx.fillStyle = D.bomb.planted ? "#ff5a3c" : (t<15&&D.state==="live" ? "#ffb020" : "#e8dcc4");
    ctx.fillText(timeStr, px+panelW/2, py+24);
    ctx.font='700 10px "Trebuchet MS",sans-serif';
    ctx.fillStyle="rgba(200,190,170,0.7)";
    ctx.fillText(`第 ${D.round} 回合 · ${mySide==="t"?"T 进攻":"CT 防守"}`, px+panelW/2, py+38);

    // 左右小字
    ctx.font='700 11px "Trebuchet MS",sans-serif'; ctx.textAlign="left";
    ctx.fillStyle=this.CTCOL; ctx.fillText("CT", px+8, py+18);
    ctx.fillStyle=this.TCOL;  ctx.fillText("T", px+panelW-18, py+18);
    ctx.restore();

    /* 雷达 */
    this.radar(ctx, D);

    /* 左下：血量 / 护甲 */
    const bw = touch?152:196;
    const panH = touch?60:58;
    const bx = touch?12:16, by=v.h-(touch?74:72);
    ctx.save();
    ctx.fillStyle="rgba(10,9,8,0.82)"; ctx.fillRect(bx,by,bw,panH);
    ctx.strokeStyle="rgba(255,255,255,0.10)"; ctx.strokeRect(bx+0.5,by+0.5,bw-1,panH-1);
    const barW=bw-66;
    // HP
    ctx.fillStyle="#2a1414"; ctx.fillRect(bx+10,by+12,barW,10);
    ctx.fillStyle=p.hp>50?"#5bd66a":p.hp>25?"#ffb020":"#e23b3b";
    ctx.fillRect(bx+10,by+12,barW*M.clamp(p.hp/100,0,1),10);
    ctx.font='900 13px "Trebuchet MS",sans-serif'; ctx.fillStyle="#e8dcc4"; ctx.textAlign="left";
    ctx.fillText(Math.ceil(p.hp), bx+barW+16, by+22);
    // Shield（旧刷宝体系模式护甲池）+ Armor
    if(p.maxShield>0){
      ctx.fillStyle="#0e2536"; ctx.fillRect(bx+10,by+30,barW,6);
      ctx.fillStyle="#4ad6ff"; ctx.fillRect(bx+10,by+30,barW*M.clamp(p.shield/p.maxShield,0,1),6);
      ctx.fillStyle="#12202c"; ctx.fillRect(bx+10,by+39,barW,5);
      ctx.fillStyle="#5ea9ff"; ctx.fillRect(bx+10,by+39,barW*M.clamp(p.armor/100,0,1),5);
      ctx.font='700 11px "Trebuchet MS",sans-serif'; ctx.fillStyle="#7fd4ee";
      ctx.fillText(`${Math.ceil(p.shield)}/${p.maxShield}`, bx+barW+16, by+38);
    } else {
      ctx.fillStyle="#12202c"; ctx.fillRect(bx+10,by+30,barW,7);
      ctx.fillStyle="#5ea9ff"; ctx.fillRect(bx+10,by+30,barW*M.clamp(p.armor/100,0,1),7);
      ctx.font='700 11px "Trebuchet MS",sans-serif'; ctx.fillStyle="#9fc7ee";
      ctx.fillText(p.armor>0?(p.helmet?"护甲+头盔":"护甲"):"无护甲", bx+barW+16, by+38);
    }
    // 手雷 / 拆弹器
    ctx.fillStyle="rgba(220,200,160,0.75)"; ctx.font='700 10px "Trebuchet MS",sans-serif';
    ctx.fillText(`手雷 ${p.nades.length}${p.kit?" · 拆弹器":""}`, bx+10, by+panH-8);
    ctx.restore();

    /* 弹药 / 金钱 */
    const g=p.activeGun();
    ctx.save();
    if(touch){
      /* 移动端：弹药收进雷达下方的小胶囊，彻底避开 BUY / USE / 开火键 */
      const ax=8, ay0=98, aw=156, ah=44;
      ctx.fillStyle="rgba(10,9,8,0.72)"; ctx.fillRect(ax,ay0,aw,ah);
      ctx.strokeStyle="rgba(255,255,255,0.08)"; ctx.lineWidth=1;
      ctx.strokeRect(ax+0.5,ay0+0.5,aw-1,ah-1);
      ctx.textAlign="left"; ctx.font='700 11px "Trebuchet MS",sans-serif';
      ctx.fillStyle="rgba(232,220,196,0.9)";
      ctx.fillText(g?g.name:"徒手", ax+10, ay0+16);
      const resStr = g?("/ "+p.reserve):"";
      ctx.textAlign="right"; ctx.font='700 12px "Trebuchet MS",sans-serif';
      ctx.fillStyle="rgba(200,190,170,0.75)";
      ctx.fillText(resStr, ax+aw-10, ay0+37);
      const rw=ctx.measureText(resStr).width;
      ctx.font='900 21px "Trebuchet MS",sans-serif'; ctx.fillStyle="#ffd23f";
      ctx.fillText(g?String(p.mag):"0", ax+aw-10-rw-6, ay0+38);
      ctx.fillStyle="#9be07a"; ctx.font='900 15px "Trebuchet MS",sans-serif';
      ctx.fillText("$ "+p.money.toLocaleString(), v.w-16, 74);
    } else {
      const ay = v.h-44;
      ctx.textAlign="right";
      ctx.font='900 30px "Trebuchet MS",sans-serif';
      ctx.fillStyle="#ffd23f";
      ctx.fillText(g?`${p.mag}`:"0", v.w-16, ay);
      ctx.font='700 14px "Trebuchet MS",sans-serif';
      ctx.fillStyle="rgba(200,190,170,0.75)";
      ctx.fillText(g?`/ ${p.reserve}`:"", v.w-52, ay);
      ctx.font='700 12px "Trebuchet MS",sans-serif';
      ctx.fillStyle="rgba(232,220,196,0.9)";
      ctx.fillText(g?g.name:"徒手", v.w-16, ay-18);
      ctx.fillStyle="#9be07a"; ctx.font='900 15px "Trebuchet MS",sans-serif';
      ctx.fillText("$ "+p.money.toLocaleString(), v.w-16, v.h-20);
    }
    ctx.restore();

    /* 击杀提示（移动端不显示，避免遮挡） */
    if(touch){ /* skip */ } else {
    ctx.save(); ctx.textAlign="left";
    D.killfeed.forEach((k,i)=>{
      const y=70+i*20;
      ctx.font='700 12px "Trebuchet MS",sans-serif';
      const a=Math.min(1,k.t/1.5);
      ctx.fillStyle=`rgba(255,210,63,${a})`;
      ctx.fillText(k.killer||"—", v.w-300, y);
      ctx.fillStyle=`rgba(200,190,170,${a*0.85})`;
      ctx.fillText(" ▸ "+k.gun+" ▸ ", v.w-300+ctx.measureText(k.killer||"—").width, y);
      ctx.fillStyle=`rgba(255,120,120,${a})`;
      ctx.fillText(k.victim, v.w-190, y);
      if(k.money){
        ctx.fillStyle=`rgba(155,224,122,${a})`;
        ctx.fillText("+$"+k.money, v.w-110, y);
      }
    });
    ctx.restore();
    }

    /* 操作提示 / 状态 */
    ctx.save(); ctx.textAlign="center";
    if(D.state==="freeze"){
      ctx.font='900 16px "Trebuchet MS",sans-serif';
      ctx.fillStyle="rgba(255,210,63,0.95)";
      const ty = touch ? 172 : 120;
      ctx.fillText(touch?"购买时间 · 点 BUY 打开菜单":"购买时间 · 按 B 打开购买菜单", v.w/2, ty);
      ctx.font='700 12px "Trebuchet MS",sans-serif';
      ctx.fillStyle="rgba(220,210,190,0.7)";
      ctx.fillText("冻结时间内可以购买，回合开始后关闭", v.w/2, ty+18);
    } else if(p.alive){
      const site=D.map.whichSite(p.x,p.y);
      let tip="";
      if(p.side==="t" && p.hasBomb && site && !D.bomb.planted) tip=Input.isTouch?"按住 USE 安放炸弹":"按住 E 安放炸弹";
      else if(p.side==="ct" && D.bomb.planted && M.dist(p.x,p.y,D.bomb.x,D.bomb.y)<70) tip=Input.isTouch?"按住 USE 拆除炸弹":"按住 E 拆除炸弹";
      if(tip){
        ctx.font='900 15px "Trebuchet MS",sans-serif';
        ctx.fillStyle="#ffd23f"; ctx.fillText(tip, v.w/2, v.h*0.62);
      }
    }
    ctx.restore();

    /* 死亡观战 */
    if(!p.alive){
      ctx.save();
      ctx.fillStyle="rgba(0,0,0,0.35)"; ctx.fillRect(0,0,v.w,v.h);
      ctx.textAlign="center";
      const dy = touch ? v.h*0.26 : 120;
      ctx.font='900 26px "Trebuchet MS",sans-serif';
      ctx.fillStyle="#ff6b6b";
      ctx.fillText("你已阵亡", v.w/2, dy);
      ctx.font='700 13px "Trebuchet MS",sans-serif';
      ctx.fillStyle="rgba(220,210,190,0.8)";
      ctx.fillText(D.spectate?`观战：${D.spectate.name}`:"观战中", v.w/2, dy+26);
      ctx.restore();
    }

    /* 回合横幅 */
    if(D.roundMsgT>0 && D.roundMsg){
      const k=Math.min(1, D.roundMsgT/0.6);
      ctx.save();
      ctx.globalAlpha=k;
      ctx.textAlign="center";
      const w=Math.min(520,v.w-40);
      ctx.fillStyle="rgba(8,7,6,0.82)";
      ctx.fillRect((v.w-w)/2, v.h*0.30, w, 74);
      ctx.strokeStyle=D.roundMsg.color; ctx.lineWidth=2;
      ctx.strokeRect((v.w-w)/2+1, v.h*0.30+1, w-2, 72);
      ctx.font='900 28px "Trebuchet MS",sans-serif';
      ctx.fillStyle=D.roundMsg.color;
      ctx.fillText(D.roundMsg.title, v.w/2, v.h*0.30+34);
      ctx.font='700 13px "Trebuchet MS",sans-serif';
      ctx.fillStyle="rgba(230,220,200,0.85)";
      ctx.fillText(D.roundMsg.sub, v.w/2, v.h*0.30+56);
      ctx.restore();
    }

    /* 准星（桌面） */
    if(!Input.isTouch && p.alive){
      const m=Input.mouse;
      ctx.save();
      ctx.strokeStyle="rgba(255,255,255,0.85)"; ctx.lineWidth=1.5;
      const s=7, gap=3;
      ctx.beginPath();
      ctx.moveTo(m.sx-gap-s,m.sy); ctx.lineTo(m.sx-gap,m.sy);
      ctx.moveTo(m.sx+gap,m.sy); ctx.lineTo(m.sx+gap+s,m.sy);
      ctx.moveTo(m.sx,m.sy-gap-s); ctx.lineTo(m.sx,m.sy-gap);
      ctx.moveTo(m.sx,m.sy+gap); ctx.lineTo(m.sx,m.sy+gap+s);
      ctx.stroke();
      ctx.restore();
    }
  },

  radar(ctx, D){
    const map=D.map, v=window.game.view;
    const w=Input.isTouch?84:150, h=w*map.h/map.w;
    const x=Input.isTouch?8:12, y=Input.isTouch?8:12;
    ctx.save();
    ctx.globalAlpha=0.92;
    ctx.fillStyle="rgba(8,7,6,0.72)"; ctx.fillRect(x,y,w,h);
    ctx.strokeStyle="rgba(255,210,63,0.28)"; ctx.lineWidth=1; ctx.strokeRect(x+0.5,y+0.5,w-1,h-1);
    // 真实地图轮廓：按 tile 烘焙到离屏画布，每帧只贴图
    if(!this._radarCv || this._radarKey!==DUST_COLS+"x"+DUST_ROWS){
      const cv=document.createElement("canvas");
      cv.width=DUST_COLS; cv.height=DUST_ROWS;
      const rc=cv.getContext("2d");
      for(let ty=0;ty<DUST_ROWS;ty++) for(let tx=0;tx<DUST_COLS;tx++){
        const gv=map.grid[ty][tx];
        if(gv===DUST_GROUND) rc.fillStyle="rgba(196,158,104,0.85)";
        else if(gv===DUST_PLAT) rc.fillStyle="rgba(238,204,138,0.95)";   // A 点高架：亮色
        else if(gv===DUST_RAMP) rc.fillStyle="rgba(255,230,160,0.75)";   // 坡道
        else if(gv===DUST_LOW) rc.fillStyle="rgba(90,64,32,0.95)";       // 低箱
        else continue;
        rc.fillRect(tx,ty,1,1);
      }
      this._radarCv=cv; this._radarKey=DUST_COLS+"x"+DUST_ROWS;
    }
    ctx.imageSmoothingEnabled=false;
    ctx.drawImage(this._radarCv, x, y, w, h);
    ctx.imageSmoothingEnabled=true;
    const sx=w/map.w, sy=h/map.h;
    // 点位
    for(const k in map.sites){
      const s=map.sites[k];
      ctx.strokeStyle=k==="A"?"rgba(255,140,80,0.75)":"rgba(110,170,255,0.75)";
      ctx.lineWidth=1.4;
      ctx.strokeRect(x+s.x0*sx, y+s.y0*sy, (s.x1-s.x0)*sx, (s.y1-s.y0)*sy);
      ctx.fillStyle=k==="A"?"rgba(255,140,80,0.95)":"rgba(110,170,255,0.95)";
      ctx.font="bold 9px sans-serif"; ctx.textAlign="center";
      ctx.fillText(k, x+(s.x0+s.x1)/2*sx, y+(s.y0+s.y1)/2*sy+3);
    }
    // 敌人（仅可见的）
    for(const b of D.allDuelists()){
      if(!b.alive) continue;
      const mine = b.side===D.playerSide();
      if(!mine && !(D.player.alive && D.canSee(D.player,b))) continue;
      ctx.fillStyle = mine ? "rgba(120,220,140,0.95)" : "#ff5a5a";
      ctx.beginPath(); ctx.arc(x+b.x*sx, y+b.y*sy, mine?2.6:3, 0, 6.2832); ctx.fill();
    }
    // 炸弹
    if(D.bomb.planted || D.bomb.dropped){
      ctx.fillStyle="#ffb020";
      ctx.fillRect(x+D.bomb.x*sx-2, y+D.bomb.y*sy-2, 4,4);
    }
    ctx.restore();
  },
};

function game_view_w(){ return window.game.view.w; }
function game_view_h(){ return window.game.view.h; }
