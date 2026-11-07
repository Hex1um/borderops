/* =========================================================================
 * raid-render.js — RenderRaid 俯视渲染 + HUD + Raid 可见性补丁
 * v0.22.0：由 raid.js 按自然边界物理拆分，逻辑零改写。经典脚本按 index.html 顺序加载，
 * 共享同一全局词法作用域。verify 的 raidSrc 会聚合全部 raid-*.js 做源码断言。
 * ========================================================================= */

/* =========================================================================
 * RenderRaid — 俯视角渲染 + 自绘 HUD（含左上角击杀提示）
 * ========================================================================= */
const RenderRaid = {
  render(ctx, game){
    const R=Raid, v=game.view;
    if(!R.active && game.state!=="raidover"){ /* 结束瞬间仍出一帧 */ }
    ctx.setTransform(v.dpr,0,0,v.dpr,0,0);
    ctx.fillStyle="#070a08"; ctx.fillRect(0,0,v.w,v.h);
    if(!R.player) return;
    const cam=R.camera, z=game.zoom||1;
    if(typeof ViewMode!=="undefined" && ViewMode.is3D() && typeof FPView!=="undefined"){
      /* 维度切换：只替换世界层，暗角 / HUD / DOM 物品栏全部复用同一套 */
      FPView.render(ctx, game, R);
    } else {
      ctx.save(); ctx.scale(z,z); ctx.translate(-cam.x,-cam.y);
      this.scene(ctx, game, cam, z);
      ctx.restore();
    }
    // 冷色雾气暗角——中心透明、边缘泛冷蓝灰，强化荒凉紧张的氛围（绘制于 HUD 之下）
    const vg=ctx.createRadialGradient(v.w/2, v.h/2, Math.min(v.w,v.h)*0.30, v.w/2, v.h/2, Math.max(v.w,v.h)*0.78);
    vg.addColorStop(0,"rgba(0,0,0,0)"); vg.addColorStop(1,"rgba(14,20,32,0.42)");
    ctx.fillStyle=vg; ctx.fillRect(0,0,v.w,v.h);
    ctx.fillStyle="rgba(28,40,58,0.06)"; ctx.fillRect(0,0,v.w,v.h);
    /* v0.23.3：室内压暗已移到 scene() 内、_lightLayer() **之前**。
       原来这层 0.52 的暗色盖在世界层之后 —— 也就是盖在手电加色光斑之上，
       把刚提上来的亮度又打了对折，所以「参数翻倍、画面几乎没变亮」。
       3D 的 FPView._lighting 一直是「先压暗、后 lighter 打光」，2D 现在与它对齐。
       共用 Raid.indoor，切维度零状态迁移。 */
    this.hud(ctx, game, v);
  },

  /* 户外掩体绘制：按类型区分轮廓，避免整张图全是“灰色方块” */
  prop(ctx,p){
    const k=p.kind, x=p.x, y=p.y, w=p.w, h=p.h;
    /* v0.25.0：长条形（长宽比 > 1.7）的装饰改画长方形。
     * 椭圆投影只有在近似各向同性时才像「一丛草 / 一块石头」；拉长之后
     * 两端收尖，反而比矩形更假，而且和「整块走不过去」的碰撞体对不上。 */
    const roundOK = (typeof raidRoundShape==="function") ? raidRoundShape(w,h) : (k==="bush"||k==="rock"||k==="tree"||k==="scrap");
    if((k==="bush"||k==="rock"||k==="tree"||k==="scrap") && roundOK){
      // 圆形 / 不规则物用椭圆投影，否则地上会出现一个方块状黑斑
      ctx.fillStyle="rgba(0,0,0,0.24)";
      ctx.beginPath(); ctx.ellipse(x+w/2+5, y+h/2+7, w*0.46, h*0.40, 0, 0, 6.2832); ctx.fill();
    } else {
      ctx.fillStyle="rgba(0,0,0,0.30)"; ctx.fillRect(x+4,y+6,w,h);
    }
    if(k==="bush" && roundOK){
      const cx=x+w/2, cy=y+h/2;
      ctx.fillStyle="rgba(28,46,26,0.95)";
      ctx.beginPath(); ctx.ellipse(cx,cy,w*0.5,h*0.46,0,0,6.2832); ctx.fill();
      ctx.fillStyle=p.fill;
      ctx.beginPath(); ctx.ellipse(cx-w*0.14,cy-h*0.10,w*0.34,h*0.32,0.4,0,6.2832); ctx.fill();
      ctx.beginPath(); ctx.ellipse(cx+w*0.16,cy+h*0.08,w*0.30,h*0.30,-0.3,0,6.2832); ctx.fill();
      ctx.fillStyle="rgba(120,170,110,0.16)";
      ctx.beginPath(); ctx.ellipse(cx-w*0.06,cy-h*0.20,w*0.20,h*0.16,0,0,6.2832); ctx.fill();
      return;
    }
    if(k==="bush"){
      // 长条形灌木：矩形底 + 内缩亮面，保持「灌木」的层次但不出现尖角
      ctx.fillStyle="rgba(28,46,26,0.95)"; ctx.fillRect(x,y,w,h);
      ctx.fillStyle=p.fill; ctx.fillRect(x+w*0.06,y+h*0.10,w*0.88,h*0.80);
      ctx.fillStyle="rgba(120,170,110,0.16)"; ctx.fillRect(x+w*0.14,y+h*0.18,w*0.40,h*0.30);
      return;
    }
    if(k==="rock"){
      const cx=x+w/2, cy=y+h/2;
      ctx.fillStyle=p.fill;
      ctx.beginPath();
      ctx.moveTo(x+w*0.06,y+h*0.55);
      ctx.lineTo(x+w*0.24,y+h*0.10);
      ctx.lineTo(x+w*0.62,y+h*0.04);
      ctx.lineTo(x+w*0.94,y+h*0.42);
      ctx.lineTo(x+w*0.84,y+h*0.90);
      ctx.lineTo(x+w*0.36,y+h*0.96);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle="rgba(180,190,170,0.12)";
      ctx.beginPath();
      ctx.moveTo(x+w*0.24,y+h*0.10); ctx.lineTo(x+w*0.62,y+h*0.04);
      ctx.lineTo(x+w*0.58,y+h*0.34); ctx.lineTo(x+w*0.22,y+h*0.40);
      ctx.closePath(); ctx.fill();
      return;
    }
    /* v0.24.0：圆形/不规则装饰不该有方形底。
     * 原来这两行无条件执行，而 tree / scrap 的形状画在后面同一条 else-if 链里
     * （151 / 145 行），于是「圆形树冠底下压着一个实心方块 + 一圈方形描边」——
     * 就是玩家截图里的「圆套方」。bush / rock 因为提前 return 躲过，这两个没有。
     * 3D 的 _propSprite 里 tree/scrap 是独立分支，本来就没有方底。 */
    const boxy = (k!=="tree" && k!=="scrap");
    if(boxy){
      ctx.fillStyle=p.fill; ctx.fillRect(x,y,w,h);
      ctx.strokeStyle=p.edge; ctx.lineWidth=2; ctx.strokeRect(x,y,w,h);
    }
    if(k==="container"){
      ctx.strokeStyle="rgba(0,0,0,0.16)"; ctx.lineWidth=1.5;
      ctx.beginPath();
      if(w>h){ for(let i=x+26;i<x+w-14;i+=26){ ctx.moveTo(i,y+5); ctx.lineTo(i,y+h-5); } }
      else   { for(let i=y+26;i<y+h-14;i+=26){ ctx.moveTo(x+5,i); ctx.lineTo(x+w-5,i); } }
      ctx.stroke();
      // 箱门锁扣
      ctx.fillStyle="rgba(0,0,0,0.35)";
      if(w>h){ ctx.fillRect(x+6,y+h*0.34,5,h*0.32); ctx.fillRect(x+w-11,y+h*0.34,5,h*0.32); }
      else   { ctx.fillRect(x+w*0.34,y+6,w*0.32,5); ctx.fillRect(x+w*0.34,y+h-11,w*0.32,5); }
      ctx.fillStyle="rgba(255,255,255,0.075)"; ctx.fillRect(x+2,y+2,w-4,4);
    } else if(k==="truck"){
      const cab = w>h ? {x:x, y:y+2, w:w*0.30, h:h-4} : {x:x+2, y:y, w:w-4, h:h*0.30};
      ctx.fillStyle="#2b2721"; ctx.fillRect(cab.x,cab.y,cab.w,cab.h);
      ctx.fillStyle="rgba(150,190,210,0.16)";
      if(w>h) ctx.fillRect(cab.x+3,cab.y+3,cab.w-6,cab.h*0.4);
      else    ctx.fillRect(cab.x+3,cab.y+3,cab.w*0.4,cab.h-6);
      ctx.fillStyle="#171512";
      if(w>h){ ctx.fillRect(x+w*0.34,y+h-3,w*0.12,5); ctx.fillRect(x+w*0.76,y+h-3,w*0.12,5); }
      else   { ctx.fillRect(x+w-3,y+h*0.34,5,h*0.12); ctx.fillRect(x+w-3,y+h*0.76,5,h*0.12); }
    } else if(k==="barrier"){
      ctx.save(); ctx.beginPath(); ctx.rect(x+2,y+2,w-4,h-4); ctx.clip();
      ctx.fillStyle="rgba(196,164,58,0.55)";
      const step=26;
      if(w>h){ for(let i=-h;i<w+h;i+=step){ ctx.beginPath(); ctx.moveTo(x+i,y+h); ctx.lineTo(x+i+h,y); ctx.lineTo(x+i+h+12,y); ctx.lineTo(x+i+12,y+h); ctx.closePath(); ctx.fill(); } }
      else   { for(let i=-w;i<h+w;i+=step){ ctx.beginPath(); ctx.moveTo(x,y+i); ctx.lineTo(x+w,y+i-w); ctx.lineTo(x+w,y+i-w+12); ctx.lineTo(x,y+i+12); ctx.closePath(); ctx.fill(); } }
      ctx.restore();
    } else if(k==="crate"){
      ctx.strokeStyle="rgba(0,0,0,0.35)"; ctx.lineWidth=3;
      ctx.beginPath(); ctx.moveTo(x+5,y+5); ctx.lineTo(x+w-5,y+h-5);
      ctx.moveTo(x+w-5,y+5); ctx.lineTo(x+5,y+h-5); ctx.stroke();
    } else if(k==="pipe"){
      ctx.strokeStyle="rgba(0,0,0,0.30)"; ctx.lineWidth=3;
      ctx.beginPath();
      if(w>h){ for(let i=1;i<3;i++){ ctx.moveTo(x+3,y+h*i/3); ctx.lineTo(x+w-3,y+h*i/3); } }
      else   { for(let i=1;i<3;i++){ ctx.moveTo(x+w*i/3,y+3); ctx.lineTo(x+w*i/3,y+h-3); } }
      ctx.stroke();
      ctx.fillStyle="rgba(200,200,190,0.10)"; ctx.fillRect(x+2,y+2,w-4,3);
    } else if(k==="shelf"){
      ctx.strokeStyle="rgba(0,0,0,0.34)"; ctx.lineWidth=2;
      ctx.beginPath();
      if(w>h){ for(let i=1;i<3;i++){ ctx.moveTo(x+4,y+h*i/3); ctx.lineTo(x+w-4,y+h*i/3); } }
      else   { for(let i=1;i<3;i++){ ctx.moveTo(x+w*i/3,y+4); ctx.lineTo(x+w*i/3,y+h-4); } }
      ctx.stroke();
      ctx.fillStyle="rgba(220,200,150,0.10)"; ctx.fillRect(x+3,y+3,w-6,3);
    } else if(k==="table"){
      ctx.fillStyle="rgba(255,255,255,0.06)"; ctx.fillRect(x+4,y+4,w-8,h-8);
      ctx.strokeStyle="rgba(0,0,0,0.28)"; ctx.lineWidth=2; ctx.strokeRect(x+8,y+8,w-16,h-16);
    } else if(k==="machine"){
      ctx.fillStyle="rgba(0,0,0,0.26)"; ctx.fillRect(x+w*0.16,y+h*0.16,w*0.68,h*0.62);
      ctx.fillStyle="rgba(120,220,200,0.14)"; ctx.fillRect(x+w*0.24,y+h*0.24,w*0.24,h*0.20);
      ctx.fillStyle="rgba(230,150,60,0.18)"; ctx.fillRect(x+w*0.16,y+h-10,w*0.68,5);
    } else if(k==="sandbag"){
      ctx.strokeStyle="rgba(0,0,0,0.30)"; ctx.lineWidth=2;
      ctx.beginPath();
      if(w>h){ for(let i=x+22;i<x+w-8;i+=22){ ctx.moveTo(i,y+3); ctx.lineTo(i,y+h-3); } }
      else   { for(let i=y+22;i<y+h-8;i+=22){ ctx.moveTo(x+3,i); ctx.lineTo(x+w-3,i); } }
      ctx.stroke();
    } else if(k==="locker"){
      ctx.strokeStyle="rgba(0,0,0,0.34)"; ctx.lineWidth=2;
      ctx.beginPath();
      if(w<h){ ctx.moveTo(x+4,y+h/2); ctx.lineTo(x+w-4,y+h/2); }
      else   { ctx.moveTo(x+w/2,y+4); ctx.lineTo(x+w/2,y+h-4); }
      ctx.stroke();
      ctx.fillStyle="rgba(180,200,220,0.16)"; ctx.fillRect(x+w*0.34,y+h*0.30,4,4);
    } else if(k==="scrap"){
      ctx.fillStyle="rgba(0,0,0,0.22)";
      for(let i=0;i<4;i++){
        const sx=x+((i*37)%Math.max(2,w-26)), sy=y+((i*53)%Math.max(2,h-20));
        ctx.fillRect(sx, sy, 18+(i%2)*12, 12+(i%2)*8);
      }
    } else if(k==="tree"){
      // 常绿树：树冠由三层同心椭圆叠加，顶端高光，俯视角识别度高
      const cx=x+w/2, cy=y+h/2, r=w/2;
      ctx.fillStyle="rgba(20,34,18,0.96)";
      ctx.beginPath(); ctx.ellipse(cx,cy,r*1.0,r*0.94,0,0,6.2832); ctx.fill();
      ctx.fillStyle=p.fill;
      ctx.beginPath(); ctx.ellipse(cx,cy,r*0.80,r*0.74,0,0,6.2832); ctx.fill();
      ctx.fillStyle="rgba(66,92,46,0.95)";
      ctx.beginPath(); ctx.ellipse(cx-r*0.18,cy-r*0.16,r*0.50,r*0.46,0,0,6.2832); ctx.fill();
      ctx.fillStyle="rgba(96,128,68,0.55)";
      ctx.beginPath(); ctx.ellipse(cx-r*0.22,cy-r*0.22,r*0.24,r*0.20,0,0,6.2832); ctx.fill();
    } else if(k==="railcar"){
      // 货运车厢：深色车体 + 侧板棱线 + 顶部高光
      ctx.fillStyle=p.fill; ctx.fillRect(x,y,w,h);
      ctx.strokeStyle=p.edge||"#15181d"; ctx.lineWidth=2; ctx.strokeRect(x,y,w,h);
      ctx.strokeStyle="rgba(0,0,0,0.35)"; ctx.lineWidth=1.5;
      ctx.beginPath();
      if(w>h){ for(let i=x+26;i<x+w-10;i+=26){ ctx.moveTo(i,y+3); ctx.lineTo(i,y+h-3); } }
      else   { for(let i=y+26;i<y+h-10;i+=26){ ctx.moveTo(x+3,i); ctx.lineTo(x+w-3,i); } }
      ctx.stroke();
      ctx.fillStyle="rgba(180,200,220,0.10)"; ctx.fillRect(x+2,y+2,w-4,4);
    } else {
      ctx.fillStyle="rgba(255,255,255,0.05)"; ctx.fillRect(x+2,y+2,w-4,4);
    }
  },

  /* 单块地表 decal 的绘制（确定性几何，按类型分支；全部为廉价填充/描边） */
  _decal(ctx, d){
    const x=d.x, y=d.y;
    switch(d.t){
      case "oil": {
        ctx.fillStyle="rgba(8,14,10,"+d.a+")";
        ctx.beginPath(); ctx.ellipse(x,y,d.r,d.r*0.72,0,0,6.2832); ctx.fill();
        ctx.fillStyle="rgba(90,110,95,"+(d.a*0.5)+")";
        ctx.beginPath(); ctx.ellipse(x-d.r*0.18,y-d.r*0.14,d.r*0.34,d.r*0.26,0,0,6.2832); ctx.fill();
        break;
      }
      case "stain": {
        ctx.fillStyle="rgba(70,54,38,"+d.a+")";
        ctx.beginPath(); ctx.ellipse(x,y,d.r,d.r*0.78,0.4,0,6.2832); ctx.fill();
        break;
      }
      case "blood": {
        ctx.fillStyle="rgba(120,22,26,"+d.a+")";
        ctx.beginPath(); ctx.ellipse(x,y,d.r,d.r*0.7,0,0,6.2832); ctx.fill();
        ctx.fillStyle="rgba(90,16,20,"+(d.a*0.8)+")";
        ctx.beginPath(); ctx.ellipse(x+d.r*0.4,y+d.r*0.2,d.r*0.4,d.r*0.3,0,0,6.2832); ctx.fill();
        break;
      }
      case "crack": {
        ctx.strokeStyle="rgba(150,160,150,0.13)"; ctx.lineWidth=1.4;
        ctx.beginPath();
        ctx.moveTo(x-Math.cos(d.ang)*d.w/2, y-Math.sin(d.ang)*d.w/2);
        const mx=x+Math.cos(d.ang)*d.w*0.1, my=y+Math.sin(d.ang)*d.w*0.1;
        ctx.lineTo(mx,my); ctx.lineTo(x+Math.cos(d.ang)*d.w/2, y+Math.sin(d.ang)*d.w/2);
        ctx.stroke();
        ctx.beginPath(); ctx.moveTo(mx,my);
        ctx.lineTo(mx+Math.cos(d.ang+1.1)*d.w*0.3, my+Math.sin(d.ang+1.1)*d.w*0.3);
        ctx.stroke();
        break;
      }
      case "line": {
        ctx.save(); ctx.translate(x,y); ctx.rotate(d.ang||0);
        ctx.strokeStyle="rgba(220,210,150,"+(d.a||0.06)+")"; ctx.lineWidth=3;
        ctx.setLineDash([14,12]);
        ctx.beginPath(); ctx.moveTo(-d.w/2,0); ctx.lineTo(d.w/2,0); ctx.stroke();
        ctx.setLineDash([]); ctx.restore();
        break;
      }
      case "grass": {
        // 荒野底色偏暗，草簇要更亮一点才读得出来
        ctx.strokeStyle="rgba(96,140,72,0.62)"; ctx.lineWidth=1.8;
        for(let i=0;i<4;i++){
          const a=(i/4)*6.2832+x*0.013;
          ctx.beginPath(); ctx.moveTo(x,y);
          ctx.quadraticCurveTo(x+Math.cos(a)*d.r*0.5, y+Math.sin(a)*d.r*0.5-d.r*0.3,
                               x+Math.cos(a)*d.r, y+Math.sin(a)*d.r);
          ctx.stroke();
        }
        break;
      }
      case "rocklet": {
        ctx.fillStyle="rgba(78,80,74,0.62)";
        ctx.beginPath(); ctx.ellipse(x,y,d.r,d.r*0.8,0,0,6.2832); ctx.fill();
        ctx.fillStyle="rgba(132,134,124,0.30)";
        ctx.beginPath(); ctx.ellipse(x-d.r*0.2,y-d.r*0.2,d.r*0.4,d.r*0.3,0,0,6.2832); ctx.fill();
        break;
      }
      case "glyph": {
        ctx.save(); ctx.translate(x,y); ctx.rotate(d.ang||0);
        ctx.strokeStyle=d.c; ctx.globalAlpha=d.a; ctx.lineWidth=2.4; ctx.lineCap="round";
        ctx.beginPath();
        ctx.moveTo(-d.r,0); ctx.lineTo(d.r,0);
        ctx.moveTo(0,-d.r); ctx.lineTo(0,d.r);
        ctx.arc(0,0,d.r,0.2,2.6);
        ctx.stroke();
        ctx.globalAlpha=1; ctx.restore();
        break;
      }
    }
  },

  /* 区域明暗：确定性暗斑，叠加在地面/房间之上、道具之下 */
  _drawAmbient(ctx, cam, vw, vh){
    const S=Raid.darkSpots; if(!S||!S.length) return;
    for(const s of S){
      if(s.x>cam.x+vw+s.r||s.x<cam.x-s.r||s.y>cam.y+vh+s.r||s.y<cam.y-s.r) continue;
      const g=ctx.createRadialGradient(s.x,s.y,0,s.x,s.y,s.r);
      g.addColorStop(0,`rgba(2,6,10,${s.a})`);
      g.addColorStop(1,"rgba(2,6,10,0)");
      ctx.fillStyle=g; ctx.beginPath(); ctx.arc(s.x,s.y,s.r,0,6.2832); ctx.fill();
    }
  },

  /* 光锥可见轮廓：以 (x,y) 为原点、沿 [a0,a1] 均分 rays 条射线，
     每条求最近遮挡距离后回落到半径上，返回可直接 lineTo 的点序列。
     光束因此停在墙上 / 灌木上，不会再「穿过遮挡照亮后面」。

     v0.22.3：改用 `_rayLight`（精确 DDA 求交 + 包含灌木/岩石等 sight:false 的碰撞体）。
     原来用 `_rayWall` 的 13px 采样，每条射线会冲进墙里最多 13px、角度上又只有 40 条，
     拼出来的轮廓就是玩家看到的「光照边缘明显锯齿」。这里射线数提到 96、距离精确到像素，
     边界才真正贴着墙面。 */
  _lightFan(x, y, a0, a1, reach, rays){
    const pts=[];
    const hasRay = typeof Raid._rayLight==="function" && Raid.navCS!=null;
    for(let i=0;i<=rays;i++){
      const a=a0+(a1-a0)*i/rays;
      const dx=Math.cos(a), dy=Math.sin(a);
      let rr=reach;
      if(hasRay){
        // 减 2 让光边缘正好压在遮挡物表面，不会溢出到墙里形成一圈毛边
        rr=M.clamp(Raid._rayLight(x, y, dx, dy, reach)-2, 10, reach);
      }
      pts.push(x+dx*rr, y+dy*rr);
    }
    return pts;
  },

  /* 探照灯光池的静态可见轮廓：探照灯本局不动，扇形只算一次并缓存，
     之后每帧只需一次 fill，不会因为加了遮挡把帧率吃掉。 */
  _floodFan(f){
    if(f._fan) return f._fan;
    const fan=this._lightFan(f.x, f.y, -Math.PI, Math.PI, f.r||220, 72);
    // 视线索引（navCS）还没建好时算出来的扇形是无遮挡的，不能缓存，否则会永久记住错的结果
    if(Raid.navCS!=null) f._fan=fan;
    return fan;
  },

  /* 光照层：探照灯（静态）+ 玩家手电（动态）+ 其他 AI / 玩家手电（v0.25.0） */
  _lightLayer(ctx, game, cam, vw, vh){
    const R=Raid;
    ctx.save();
    ctx.globalCompositeOperation="lighter";
    if(R.floodlights){
      for(const f of R.floodlights){
        if(f.x>cam.x+vw+f.r||f.x<cam.x-f.r||f.y>cam.y+vh+f.r||f.y<cam.y-f.r) continue;
        const g=ctx.createRadialGradient(f.x,f.y,0,f.x,f.y,f.r);
        g.addColorStop(0,"rgba(255,228,160,0.20)");
        g.addColorStop(0.55,"rgba(255,210,140,0.07)");
        g.addColorStop(1,"rgba(255,210,140,0)");
        ctx.fillStyle=g;
        const fan=this._floodFan(f);
        ctx.beginPath(); ctx.moveTo(f.x, f.y);
        for(let i=0;i<fan.length;i+=2) ctx.lineTo(fan[i], fan[i+1]);
        ctx.closePath(); ctx.fill();
      }
    }
    /* 单束光锥：径向渐变 + 多层角度羽化扇形（各层各自按遮挡裁剪）。
       本地玩家和 op 共用这一段 —— 这样「光锥长什么样」只有一份实现，
       不会出现「自己的手电贴墙、别人的手电穿墙」这种两套规则。
       参数：起点 / 朝向 / 射程 / 半角 / 中心 alpha / 半程 alpha / 增益 / 羽化层表 */
    const beam=(x,y,ang,reach,half,a0,a1,fh,layers)=>{
      const g=ctx.createRadialGradient(x,y,0,x,y,reach);
      g.addColorStop(0,"rgba(255,236,182,"+(a0*fh).toFixed(3)+")");
      g.addColorStop(0.5,"rgba(255,224,160,"+(a1*fh).toFixed(3)+")");
      g.addColorStop(1,"rgba(255,224,160,0)");
      ctx.fillStyle=g;
      for(const L of layers){
        const fan=this._lightFan(x, y, ang-half*L.widen, ang+half*L.widen, reach, L.rays);
        ctx.globalAlpha=L.alpha;
        ctx.beginPath(); ctx.moveTo(x, y);
        for(let i=0;i<fan.length;i+=2) ctx.lineTo(fan[i], fan[i+1]);
        ctx.closePath(); ctx.fill();
      }
      ctx.globalAlpha=1;
    };
    const p=R.player;
    if(p){
      /* v0.23.0：室内手电增益。室内压暗只压环境光，手电光锥反而按 indoor 提亮，
         形成「屋子越黑、手电越亮」的对比；reach 保持 560 不变（加射程 = 光穿墙）。 */
      beam(p.x, p.y, p.angle||0, 560, 0.42,
           RAID_FLASH.cone2d, RAID_FLASH.cone2dMid, raidFlashGain(R.indoor), RAID_FLASH_FAN);
    }
    /* v0.25.0：其他 AI / 远端玩家的手电。
     * 以前只有本地玩家发光 —— 黑夜里的敌人完全不显形，等于把夜战变成热成像。
     * 现在每个活着的 op 打一束自己的光锥：亮度是本地的 ~54%（不抢戏）、
     * 羽化层数与射线数更少（不拖帧）、按距离淡出（不把整张图点成圣诞树）。
     * 每个 op 的室内增益按它**自己**的坐标算，站在屋里的敌人手电会更亮。 */
    const ops=R.ops;
    if(ops && ops.length){
      const list=[];
      for(const o of ops){
        if(o===p || o.isPlayer) continue;
        if(o.alive===false || (o.hp!==undefined && o.hp<=0)) continue;
        if(o.flash===false) continue;                       // 预留：AI 主动关灯
        const d=M.dist(o.x, o.y, cam.x+vw/2, cam.y+vh/2);
        if(d>RAID_FLASH_OP.fadeFar) continue;
        list.push({o,d});
      }
      if(list.length){
        list.sort((a,b)=>a.d-b.d);                          // 近的先画，远的自然被压暗
        const n=Math.min(list.length, RAID_FLASH_OP.maxOps);
        const span=RAID_FLASH_OP.fadeFar-RAID_FLASH_OP.fadeNear;
        for(let i=0;i<n;i++){
          const o=list[i].o, d=list[i].d;
          const k=span>0 ? M.clamp((RAID_FLASH_OP.fadeFar-d)/span, 0, 1) : 1;
          if(k<=0.02) continue;
          const ind=(typeof raidIndoorAt==="function" && raidIndoorAt(o.x,o.y)) ? 1 : 0;
          /* v0.27.0：长度跟着它的感知档位走（Scav 520 / PMC 900 / Boss 1250），
             与 raidAiLit 的判定同源，不再一律画 560。 */
          const opReach=(typeof raidAiBeamReach==="function") ? raidAiBeamReach(o) : 560;
          beam(o.x, o.y, o.angle||0, opReach, 0.42,
               RAID_FLASH_OP.cone2d, RAID_FLASH_OP.cone2dMid,
               raidFlashGain(ind)*k, RAID_FLASH_OP.fan);
        }
      }
    }
    ctx.restore();
  },

  scene(ctx, game, cam, z){
    const R=Raid, v=game.view;
    const vw=v.w/z, vh=v.h/z;

    // 地图底面
    ctx.fillStyle="#0d1114"; ctx.fillRect(0,0,RAID_MAP_W,RAID_MAP_H);

    /* ---- 地表分区（大块弱色差，让荒野有“地貌”而不是一堵墙一样的纯色） ---- */
    const ZS=560;
    const zx0=Math.floor((cam.x-40)/ZS), zx1=Math.floor((cam.x+vw+40)/ZS);
    const zy0=Math.floor((cam.y-40)/ZS), zy1=Math.floor((cam.y+vh+40)/ZS);
    for(let gy=zy0;gy<=zy1;gy++){
      for(let gx=zx0;gx<=zx1;gx++){
        const hv=R._hash2(gx*7+3, gy*11+5);
        ctx.fillStyle = hv<0.32 ? "#14191b" : hv<0.62 ? "#101618" : hv<0.84 ? "#181a1c" : "#0c1012";
        ctx.fillRect(gx*ZS, gy*ZS, ZS, ZS);
      }
    }

    /* ---- 密林地表：树冠之下的暗绿林地底色（按视口裁剪） ---- */
    if(R.forests){
      for(const fz of R.forests){
        if(fz.x>cam.x+vw||fz.x+fz.w<cam.x||fz.y>cam.y+vh||fz.y+fz.h<cam.y) continue;
        ctx.fillStyle="rgba(30,44,26,0.55)"; ctx.fillRect(fz.x,fz.y,fz.w,fz.h);
        ctx.fillStyle="rgba(46,64,36,0.30)"; ctx.fillRect(fz.x+12,fz.y+12,fz.w-24,fz.h-24);
      }
    }

    /* ---- 道路 / 门外铺装 ---- */
    for(const rd of R.roads){
      if(rd.x>cam.x+vw+40||rd.x+rd.w<cam.x-40||rd.y>cam.y+vh+40||rd.y+rd.h<cam.y-40) continue;
      ctx.fillStyle="rgba(52,50,43,0.62)"; ctx.fillRect(rd.x,rd.y,rd.w,rd.h);
      ctx.fillStyle="rgba(96,92,78,0.20)"; ctx.fillRect(rd.x,rd.y,rd.w,2);
      // 中线虚线
      if(rd.w>=rd.h && rd.w>420){
        ctx.strokeStyle="rgba(150,140,100,0.13)"; ctx.lineWidth=3; ctx.setLineDash([26,30]);
        ctx.beginPath(); ctx.moveTo(rd.x,rd.y+rd.h/2); ctx.lineTo(rd.x+rd.w,rd.y+rd.h/2); ctx.stroke();
        ctx.setLineDash([]);
      } else if(rd.h>rd.w && rd.h>420){
        ctx.strokeStyle="rgba(150,140,100,0.13)"; ctx.lineWidth=3; ctx.setLineDash([26,30]);
        ctx.beginPath(); ctx.moveTo(rd.x+rd.w/2,rd.y); ctx.lineTo(rd.x+rd.w/2,rd.y+rd.h); ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    /* ---- 草丛 / 碎石斑块 ---- */
    const PS=134;
    const px0=Math.floor((cam.x-60)/PS), px1=Math.floor((cam.x+vw+60)/PS);
    const py0=Math.floor((cam.y-60)/PS), py1=Math.floor((cam.y+vh+60)/PS);
    for(let gy=py0;gy<=py1;gy++){
      for(let gx=px0;gx<=px1;gx++){
        const hv=R._hash2(gx*5+91, gy*3+37);
        if(hv<0.54) continue;
        const cx=gx*PS+R._hash2(gx,gy*7)*PS;
        const cy=gy*PS+R._hash2(gx*13,gy)*PS;
        ctx.fillStyle = hv>0.88 ? "rgba(86,116,72,0.085)" : (hv>0.70 ? "rgba(62,86,58,0.070)" : "rgba(48,60,44,0.060)");
        ctx.beginPath();
        ctx.ellipse(cx, cy, 14+hv*22, 10+hv*15, hv*3.14, 0, 6.2832);
        ctx.fill();
      }
    }

    // 户外网格（弱化，避免抢视觉）
    ctx.strokeStyle="rgba(120,160,110,0.035)"; ctx.lineWidth=1;
    const gx0=Math.floor(cam.x/160)*160, gx1=cam.x+vw, gy0=Math.floor(cam.y/160)*160, gy1=cam.y+vh;
    for(let x=gx0;x<=gx1;x+=160){ ctx.beginPath();ctx.moveTo(x,cam.y);ctx.lineTo(x,cam.y+vh);ctx.stroke(); }
    for(let y=gy0;y<=gy1;y+=160){ ctx.beginPath();ctx.moveTo(cam.x,y);ctx.lineTo(cam.x+vw,y);ctx.stroke(); }

    /* ---- 泄洪后的库底：淤泥 + 残水洼（只在水放空时出现） ---- */
    if(R.damOpen && R.reservoirRect){
      const rr=R.reservoirRect;
      const rx0=rr.x, ry0=rr.y, rx1=rr.x+rr.w, ry1=rr.y+rr.h;
      if(!(rx0>cam.x+vw||rx1<cam.x||ry0>cam.y+vh||ry1<cam.y)){
        ctx.fillStyle="#35312a"; ctx.fillRect(rx0, ry0, rx1-rx0, ry1-ry0);
        ctx.fillStyle="rgba(72,66,52,0.45)";
        for(let y=ry0+46;y<ry1;y+=72) ctx.fillRect(rx0, y, rx1-rx0, 24);
        // 搁浅的沉箱 / 残骸
        for(let i=0;i<7;i++){
          const bx2=rx0+120+((i*283)%(rx1-rx0-260)), by2=ry0+90+((i*197)%(ry1-ry0-160));
          ctx.fillStyle="rgba(58,46,34,0.92)"; ctx.fillRect(bx2, by2, 52, 34);
          ctx.strokeStyle="rgba(20,16,12,0.8)"; ctx.lineWidth=2; ctx.strokeRect(bx2, by2, 52, 34);
        }
        ctx.fillStyle="rgba(46,86,104,0.55)";
        for(let i=0;i<9;i++){
          const wx=rx0+80+((i*157)%(rx1-rx0-160)), wy=ry1-80-((i*211)%260);
          /* v0.25.0：残水洼是典型的长条形装饰 —— 长宽比 3~5 的椭圆两端会收成尖角，
             看着像一道裂缝而不是积水。改成同尺寸的旋转矩形（角度 0.4 保持不变）。 */
          const hw=58+((i*37)%46), hh=20;
          ctx.save(); ctx.translate(wx,wy); ctx.rotate(0.4);
          ctx.fillRect(-hw,-hh,hw*2,hh*2);
          ctx.restore();
        }
      }
    }

    /* ---- 大坝水库（矩形库区，视觉与碰撞一致） ---- */
    if(R.reservoirRect && !R.damOpen){
      const rr=R.reservoirRect;
      if(!(rr.x>cam.x+vw||rr.x+rr.w<cam.x||rr.y>cam.y+vh||rr.y+rr.h<cam.y)){
        ctx.fillStyle="rgba(20,38,50,0.97)"; ctx.fillRect(rr.x, rr.y, rr.w, rr.h);
        ctx.fillStyle="rgba(32,58,74,0.5)"; ctx.fillRect(rr.x, rr.y+26, rr.w, rr.h-26);
        ctx.strokeStyle="rgba(130,190,210,0.22)"; ctx.lineWidth=3;
        ctx.beginPath(); ctx.moveTo(rr.x, rr.y+2); ctx.lineTo(rr.x+rr.w, rr.y+2); ctx.stroke();
        ctx.strokeStyle="rgba(150,200,215,0.10)"; ctx.lineWidth=2;
        for(let i=0;i<26;i++){
          const wy=rr.y+44+((i*67)%(rr.h-64));
          const wx=rr.x+30+((i*233)%(rr.w-200));
          ctx.beginPath(); ctx.moveTo(wx, wy); ctx.lineTo(wx+120+((i*31)%110), wy); ctx.stroke();
        }
      }
    }

    /* ---- 中央河谷：水面（水圆叠加成连续河带）+ 桥面 + 铁路 ---- */
    if(R.waterCircles && R.waterCircles.length){
      const vis=(c)=>!(c.x>cam.x+vw+c.r||c.x<cam.x-c.r||c.y>cam.y+vh+c.r||c.y<cam.y-c.r);
      // 主体水面：先用略小的深蓝铺底，再用更暗的圆覆盖，避免圆边叠加出同心环
      ctx.fillStyle="rgba(20,38,50,0.96)";
      for(const c of R.waterCircles){ if(!vis(c)) continue; ctx.beginPath(); ctx.arc(c.x,c.y,c.r+2,0,6.2832); ctx.fill(); }
      ctx.fillStyle="rgba(30,56,72,0.55)";
      for(const c of R.waterCircles){ if(!vis(c)) continue; ctx.beginPath(); ctx.arc(c.x,c.y,c.r*0.52,0,6.2832); ctx.fill(); }
      // 稀疏波光：只画水平短划，避免同心环视觉噪声
      ctx.strokeStyle="rgba(150,200,215,0.12)"; ctx.lineWidth=1.6;
      for(let i=0;i<R.waterCircles.length;i+=5){
        const c=R.waterCircles[i]; if(!vis(c)) continue;
        const wv=R._hash2(c.x|0,c.y|0);
        ctx.beginPath(); ctx.moveTo(c.x-c.r*0.36, c.y+(wv-0.5)*50); ctx.lineTo(c.x+c.r*0.36, c.y+(wv-0.5)*50); ctx.stroke();
      }
    }
    // 桥面：河道上的安全通道（与碰撞中的桥矩形一致）；大桥有双黄线与更厚的护栏
    if(R.bridges){
      for(const b of R.bridges){
        if(b.x-b.w/2>cam.x+vw||b.x+b.w/2<cam.x-40||b.y-b.h/2>cam.y+vh||b.y+b.h/2<cam.y-40) continue;
        const bw=b.w, bh=b.h, x0=b.x-bw/2, y0=b.y-bh/2;
        ctx.fillStyle=b.big?"#2b3036":"#25282c"; ctx.fillRect(x0,y0,bw,bh);
        ctx.fillStyle="rgba(150,160,170,0.14)"; ctx.fillRect(x0,y0,bw,4);
        // 混凝土桥墩（沿桥面中段）
        ctx.fillStyle="rgba(24,28,32,0.55)";
        for(let px=x0+40; px<x0+bw-30; px+=110) ctx.fillRect(px, y0+bh*0.32, 16, bh*0.36);
        if(b.big){
          // 双黄中线 + 更厚的护栏
          ctx.strokeStyle="rgba(226,196,86,0.55)"; ctx.lineWidth=2; ctx.setLineDash([18,14]);
          ctx.beginPath(); ctx.moveTo(x0+10, b.y); ctx.lineTo(x0+bw-10, b.y); ctx.stroke();
          ctx.setLineDash([]);
          ctx.strokeStyle="rgba(180,192,205,0.6)"; ctx.lineWidth=5;
          ctx.beginPath(); ctx.moveTo(x0,y0+3); ctx.lineTo(x0+bw,y0+3);
          ctx.moveTo(x0,y0+bh-3); ctx.lineTo(x0+bw,y0+bh-3); ctx.stroke();
        }
        ctx.strokeStyle="#0d0f12"; ctx.lineWidth=2; ctx.strokeRect(x0,y0,bw,bh);
        ctx.strokeStyle="rgba(96,106,116,0.85)"; ctx.lineWidth=3;
        ctx.beginPath(); ctx.moveTo(x0,y0); ctx.lineTo(x0+bw,y0);
        ctx.moveTo(x0,y0+bh); ctx.lineTo(x0+bw,y0+bh); ctx.stroke();
      }
    }
    // 铁路：路基 + 枕木 + 双轨（纯视觉，可通行）
    if(R.rails){
      for(const rl of R.rails){
        for(let s=0;s<rl.pts.length-1;s++){
          const [x1,y1]=rl.pts[s], [x2,y2]=rl.pts[s+1];
          if(Math.max(x1,x2)<cam.x-40||Math.min(x1,x2)>cam.x+vw+40||Math.max(y1,y2)<cam.y-40||Math.min(y1,y2)>cam.y+vh+40) continue;
          const ang=Math.atan2(y2-y1,x2-x1), len=Math.hypot(x2-x1,y2-y1);
          ctx.save(); ctx.translate(x1,y1); ctx.rotate(ang);
          ctx.fillStyle="rgba(40,40,38,0.55)"; ctx.fillRect(0,-26,len,52);
          ctx.fillStyle="rgba(58,48,36,0.9)";
          for(let d=0;d<len;d+=30){ ctx.fillRect(d,-22,10,44); }
          ctx.strokeStyle="rgba(150,158,166,0.55)"; ctx.lineWidth=3;
          ctx.beginPath(); ctx.moveTo(0,-14); ctx.lineTo(len,-14); ctx.moveTo(0,14); ctx.lineTo(len,14); ctx.stroke();
          ctx.strokeStyle="rgba(200,210,220,0.18)"; ctx.lineWidth=1;
          ctx.beginPath(); ctx.moveTo(0,-15); ctx.lineTo(len,-15); ctx.moveTo(0,15); ctx.lineTo(len,15); ctx.stroke();
          ctx.restore();
        }
      }
    }

    /* ---- 建筑院子（底座水泥地）：让孤立的房子有占地，视觉上不再是“散落的盒子” ---- */
    for(const yd of R.yards){
      if(yd.x>cam.x+vw+120||yd.x+yd.w<cam.x-120||yd.y>cam.y+vh+120||yd.y+yd.h<cam.y-120) continue;
      ctx.fillStyle=yd.tint; ctx.globalAlpha=0.62; ctx.fillRect(yd.x,yd.y,yd.w,yd.h); ctx.globalAlpha=1;
      // 水泥分块缝
      ctx.strokeStyle="rgba(170,200,180,0.05)"; ctx.lineWidth=1;
      for(let i=yd.x+70;i<yd.x+yd.w;i+=70){ ctx.beginPath(); ctx.moveTo(i,yd.y); ctx.lineTo(i,yd.y+yd.h); ctx.stroke(); }
      for(let i=yd.y+70;i<yd.y+yd.h;i+=70){ ctx.beginPath(); ctx.moveTo(yd.x,i); ctx.lineTo(yd.x+yd.w,i); ctx.stroke(); }
    }

    // 房间地面
    for(const rm of R.roomRects){
      if(rm.x>cam.x+vw+200||rm.x+rm.w<cam.x-200||rm.y>cam.y+vh+200||rm.y+rm.h<cam.y-200) continue;
      /* v0.22.2：屋子里面是黑的（原来按 tint 上色，室内外几乎一样亮）。
         撤离区保留绿色标识，它不算室内。 */
      ctx.fillStyle=rm.extract?"#25452f":"#010203";
      ctx.globalAlpha=0.95; ctx.fillRect(rm.x,rm.y,rm.w,rm.h); ctx.globalAlpha=1;
      ctx.fillStyle="rgba(0,0,0,0.16)"; ctx.fillRect(rm.x,rm.y,rm.w,rm.h);
      // 地面砖缝（横竖两层，提升质感）
      ctx.strokeStyle="rgba(170,200,180,0.06)"; ctx.lineWidth=1;
      for(let gx=rm.x+40;gx<rm.x+rm.w;gx+=60){ ctx.beginPath();ctx.moveTo(gx,rm.y);ctx.lineTo(gx,rm.y+rm.h);ctx.stroke(); }
      for(let gy=rm.y+40;gy<rm.y+rm.h;gy+=60){ ctx.beginPath();ctx.moveTo(rm.x,gy);ctx.lineTo(rm.x+rm.w,gy);ctx.stroke(); }
    }

    /* ---- 房间踢脚板：沿房间内侧一圈深色墙裙 + 极淡高光，让室内边界更立体 ---- */
    ctx.strokeStyle="rgba(0,0,0,0.20)"; ctx.lineWidth=7;
    for(const rm of R.roomRects){
      if(rm.x>cam.x+vw+120||rm.x+rm.w<cam.x-120||rm.y>cam.y+vh+120||rm.y+rm.h<cam.y-120) continue;
      ctx.strokeRect(rm.x+4, rm.y+4, rm.w-8, rm.h-8);
    }
    ctx.strokeStyle="rgba(255,255,255,0.05)"; ctx.lineWidth=1.5;
    for(const rm of R.roomRects){
      if(rm.x>cam.x+vw+120||rm.x+rm.w<cam.x-120||rm.y>cam.y+vh+120||rm.y+rm.h<cam.y-120) continue;
      ctx.strokeRect(rm.x+8, rm.y+8, rm.w-16, rm.h-16);
    }

    /* ---- 地表细节 decals（油渍/血迹/裂缝/草簇/碎石/标线/涂鸦）：纯视觉，按视口裁剪 ---- */
    if(R.decals){
      for(const d of R.decals){
        if(d.x>cam.x+vw+44||d.x<cam.x-44||d.y>cam.y+vh+44||d.y<cam.y-44) continue;
        this._decal(ctx, d);
      }
    }

    // 区域明暗（暗斑），落在地面/房间之上、道具之下，制造受光层次
    this._drawAmbient(ctx, cam, vw, vh);

    /* ---- 户外掩体（先画投影再画本体，压实地面） ---- */
    for(const p of R.props){
      if(p.x>cam.x+vw+120||p.x+p.w<cam.x-120||p.y>cam.y+vh+120||p.y+p.h<cam.y-120) continue;
      this.prop(ctx,p);
    }

    // 围墙（房间墙体；掩体已在上面单独绘制）
    for(const w of R.walls){
      if(w.kind!=="wall") continue;
      if(w.x>cam.x+vw+120||w.x+w.w<cam.x-120||w.y>cam.y+vh+120||w.y+w.h<cam.y-120) continue;
      if(w.dam){
        /* 坝体 —— 混凝土色 + 顶部栏板 + 朝水面一侧的水痕 */
        ctx.fillStyle="#4b545c"; ctx.fillRect(w.x,w.y,w.w,w.h);
        ctx.fillStyle="rgba(200,214,224,0.20)"; ctx.fillRect(w.x,w.y,w.w,6);
        ctx.fillStyle="rgba(10,14,17,0.45)"; ctx.fillRect(w.x,w.y+w.h-7,w.w,7);
        ctx.strokeStyle="rgba(120,170,200,0.30)"; ctx.lineWidth=2;
        for(let sx=w.x+26; sx<w.x+w.w-10; sx+=58){
          ctx.beginPath(); ctx.moveTo(sx,w.y+w.h-4); ctx.lineTo(sx,w.y+w.h-4-Math.min(26,w.h*0.4)); ctx.stroke();
        }
        ctx.strokeStyle="#0b0e10"; ctx.lineWidth=2; ctx.strokeRect(w.x,w.y,w.w,w.h);
        continue;
      }
      ctx.fillStyle="#272d31"; ctx.fillRect(w.x,w.y,w.w,w.h);
      ctx.fillStyle="rgba(170,195,205,0.16)"; ctx.fillRect(w.x,w.y,w.w,4);
      ctx.strokeStyle="#0b0e10"; ctx.lineWidth=2; ctx.strokeRect(w.x,w.y,w.w,w.h);
    }

    /* v0.23.3：室内压暗放在光照层**之前** —— 只压地物与环境，不压手电。
       手电是紧随其后的加色（lighter）层，压它等于把提亮再打五折；
       3D 的 _lighting 早就是这个顺序，这里对齐后两个维度的观感才一致。
       用世界坐标覆盖当前可见区域即可（scene 的 ctx 已 scale/translate 到相机）。 */
    const indoor=R.indoor||0;
    if(indoor>0.01){
      ctx.save();
      ctx.globalCompositeOperation="source-over";
      ctx.fillStyle="rgba(2,3,5,"+(0.52*indoor).toFixed(3)+")";
      ctx.fillRect(cam.x, cam.y, vw, vh);
      ctx.restore();
    }

    // 光照层（探照灯 + 玩家手电），暖色加色叠加，强化荒凉紧张氛围
    this._lightLayer(ctx, game, cam, vw, vh);

    /* v0.23.0：空投信标（涌潮落点）。画在光照层之上，远处也能一眼看到 ——
       否则「再等一分钟」只存在于 HUD 的一行字里，玩家根本感知不到。
       这里只画光柱 / 光斑，**不写文字**：文字统一由 hud() 的方位指示负责，
       否则屏幕上会同时出现两条「空投」标签，而且位置还对不上。 */
    if(R.airdrops && R.airdrops.length){
      const now=raidElapsed(R);
      for(const a of R.airdrops){
        if(a.x<cam.x-240||a.x>cam.x+vw+240||a.y<cam.y-240||a.y>cam.y+vh+240) continue;
        const pulse=0.55+0.45*Math.sin(now*3.4);
        ctx.fillStyle="rgba(255,210,63,"+(0.09+0.09*pulse).toFixed(3)+")";
        ctx.beginPath(); ctx.arc(a.x, a.y, 96+18*pulse, 0, 6.2832); ctx.fill();
        ctx.fillStyle="rgba(255,210,63,0.85)";
        ctx.fillRect(a.x-2.5, a.y-58, 5, 46);
        ctx.beginPath(); ctx.arc(a.x, a.y-58, 5+2*pulse, 0, 6.2832); ctx.fill();
      }
    }

    // 撤离点（塔科夫式：关闭=灰、付费=金、开放=绿）
    for(const e of R.extracts){
      const pulse=0.5+0.5*Math.sin(M.now()*3);
      if(e.closed){
        ctx.fillStyle="rgba(90,100,105,0.10)"; ctx.fillRect(e.x,e.y,e.w,e.h);
        ctx.strokeStyle="rgba(150,160,165,0.4)"; ctx.lineWidth=2;
        ctx.setLineDash([10,10]); ctx.strokeRect(e.x,e.y,e.w,e.h); ctx.setLineDash([]);
        ctx.fillStyle="rgba(190,200,205,0.75)"; ctx.font="bold 20px system-ui,sans-serif"; ctx.textAlign="center";
        ctx.fillText("✕ "+e.name, e.x+e.w/2, e.y+e.h/2-6);
        ctx.font="12px system-ui,sans-serif"; ctx.fillStyle="rgba(190,200,205,0.5)";
        ctx.fillText("本局未开放", e.x+e.w/2, e.y+e.h/2+18);
        continue;
      }
      const paid=e.cost>0;
      // 被封锁：整片区域转红并标注，玩家一眼能看到哪条撤离路线不通
      const blockedNow=R.ops.some(o=>o.alive && o.blockZone===e &&
        M.dist(o.x,o.y, e.x+e.w/2, e.y+e.h/2) < 300);
      const col=blockedNow?"255,80,70":(paid?"200,180,80":"90,220,140");
      ctx.fillStyle=`rgba(${col},${0.10+pulse*0.10})`; ctx.fillRect(e.x,e.y,e.w,e.h);
      ctx.strokeStyle=`rgba(${col},${0.5+pulse*0.3})`; ctx.lineWidth=3;
      ctx.setLineDash([14,10]); ctx.strokeRect(e.x,e.y,e.w,e.h); ctx.setLineDash([]);
      ctx.fillStyle=blockedNow?"#ff8a80":(paid?"#e8d48a":"#8fe0a8"); ctx.font="bold 20px system-ui,sans-serif"; ctx.textAlign="center";
      ctx.fillText((blockedNow?"⛔ ":"▲ ")+e.name, e.x+e.w/2, e.y+e.h/2-6);
      ctx.font="12px system-ui,sans-serif"; ctx.fillStyle=`rgba(${col},0.8)`;
      ctx.fillText(blockedNow?"被封锁 · 清除封锁者":(paid?`雇车费 ${raidExtractFee(e, R.carryVal||0)} 卢布（按带入装备）· 坚守 ${e.need} 秒`:`坚守 ${e.need} 秒`), e.x+e.w/2, e.y+e.h/2+18);
    }

    // 局内商店摊位（枪店 / 材料店 / 回收超市 / 黑市）
    for(const s of R.shops){
      if(s.x>cam.x+vw+200||s.x<cam.x-200||s.y>cam.y+vh+200||s.y<cam.y-200) continue;
      const pl=0.5+0.5*Math.sin(M.now()*2.2+s.x*0.013);
      const rgb = s.kind==="black" ? "160,110,235" : s.kind==="rec" ? "70,165,215" : s.kind==="mat" ? "120,210,120" : "225,180,80";
      ctx.save(); ctx.translate(s.x, s.y);
      // 地面光圈：远处也能看出「这里有活人做买卖」
      ctx.fillStyle=`rgba(${rgb},0.10)`;
      ctx.beginPath(); ctx.ellipse(0,14,92,60,0,0,6.2832); ctx.fill();
      ctx.strokeStyle=`rgba(${rgb},${0.20+pl*0.16})`; ctx.lineWidth=2; ctx.setLineDash([12,9]);
      ctx.beginPath(); ctx.ellipse(0,14,92,60,0,0,6.2832); ctx.stroke(); ctx.setLineDash([]);
      // 遮阳棚
      ctx.fillStyle=`rgba(${rgb},0.20)`; ctx.fillRect(-60,-48,120,44);
      ctx.strokeStyle=`rgba(${rgb},0.85)`; ctx.lineWidth=2; ctx.strokeRect(-60,-48,120,44);
      ctx.fillStyle=`rgba(${rgb},0.42)`;
      for(let i=0;i<6;i++) ctx.fillRect(-58+i*20,-46,9,42);
      // 支柱 + 柜台
      ctx.fillStyle="#3a4047"; ctx.fillRect(-56,-2,8,48); ctx.fillRect(48,-2,8,48);
      ctx.fillStyle="#262c33"; ctx.strokeStyle="#0b0e10"; ctx.lineWidth=2;
      ctx.fillRect(-46,22,92,28); ctx.strokeRect(-46,22,92,28);
      // 招牌
      ctx.fillStyle="rgba(6,10,14,0.92)"; ctx.fillRect(-58,-76,116,26);
      ctx.strokeStyle=`rgba(${rgb},0.9)`; ctx.lineWidth=2; ctx.strokeRect(-58,-76,116,26);
      ctx.fillStyle=s.color; ctx.textAlign="center"; ctx.font="bold 14px system-ui,sans-serif";
      ctx.fillText(s.name, 0, -58);
      ctx.font="bold 15px system-ui,sans-serif";
      ctx.fillText(s.kind==="gun"?"⌖":s.kind==="mat"?"▤":s.kind==="rec"?"♻":"◈", 0, 14);
      ctx.restore();
    }

    /* 可互动设施（医疗站 / 弹药箱 / 泄洪闸） */
    for(const g of (R.gadgets||[])){
      if(g.x>cam.x+vw+200||g.x<cam.x-200||g.y>cam.y+vh+200||g.y<cam.y-200) continue;
      const dim = g.used && g.kind!=="dam" && g.kind!=="siren";
      const rgb = g.kind==="med" ? "120,220,140" : g.kind==="ammo" ? "225,190,90"
                : g.kind==="siren" ? "235,130,90" : "110,180,235";
      const pl=0.5+0.5*Math.sin(M.now()*2.6+g.x*0.01);
      ctx.save(); ctx.translate(g.x,g.y);
      ctx.globalAlpha=dim?0.42:1;
      ctx.fillStyle=`rgba(${rgb},0.10)`;
      ctx.beginPath(); ctx.ellipse(0,12,54,34,0,0,6.2832); ctx.fill();
      ctx.strokeStyle=`rgba(${rgb},${0.25+pl*0.30})`; ctx.lineWidth=2; ctx.setLineDash([8,7]);
      ctx.beginPath(); ctx.ellipse(0,12,54,34,0,0,6.2832); ctx.stroke(); ctx.setLineDash([]);
      // 箱体
      ctx.fillStyle=g.kind==="med"?"#dfe6e8":g.kind==="ammo"?"#6a5a34":g.kind==="siren"?"#5a3a2e":"#3b4752";
      ctx.strokeStyle="#0b0e10"; ctx.lineWidth=2;
      ctx.fillRect(-20,-26,40,34); ctx.strokeRect(-20,-26,40,34);
      if(g.kind==="med"){
        ctx.fillStyle="#c93b3b"; ctx.fillRect(-4,-20,8,22); ctx.fillRect(-11,-13,22,8);
      } else if(g.kind==="ammo"){
        ctx.fillStyle="#31280f";
        for(let i=0;i<3;i++) ctx.fillRect(-14+i*11,-20,7,22);
      } else if(g.kind==="siren"){
        // 喇叭：梯形 + 声波弧
        ctx.fillStyle="#e8a06a";
        ctx.beginPath(); ctx.moveTo(-12,-18); ctx.lineTo(2,-24); ctx.lineTo(2,-4); ctx.lineTo(-12,-10); ctx.closePath(); ctx.fill();
        ctx.strokeStyle="#e8a06a"; ctx.lineWidth=2;
        for(let r=4;r<=10;r+=4){ ctx.beginPath(); ctx.arc(4,-14,r,-0.9,0.9); ctx.stroke(); }
      } else {
        ctx.strokeStyle= dim?"#6f8290":"#9fd0ef"; ctx.lineWidth=3;
        ctx.beginPath(); ctx.arc(0,-9,10,0,6.2832); ctx.stroke();
        for(let i=0;i<4;i++){ const a=i*1.5708;
          ctx.beginPath(); ctx.moveTo(0,-9); ctx.lineTo(Math.cos(a)*10,-9+Math.sin(a)*10); ctx.stroke(); }
        // 闸门状态灯
        ctx.fillStyle=R.damOpen?"#62c8ff":"#ff8a5a";
        ctx.beginPath(); ctx.arc(0,2,4,0,6.2832); ctx.fill();
      }
      ctx.globalAlpha=1;
      ctx.textAlign="center"; ctx.font="bold 12px system-ui,sans-serif";
      ctx.fillStyle=dim?"rgba(180,190,190,0.6)":`rgb(${rgb})`;
      const cdLeft=g.kind==="siren" ? Math.max(0, Math.ceil(((g.cdUntil||0)-M.now())/1000)) : 0;
      const glabel = g.kind==="dam" ? (R.damOpen?"泄洪闸 · 已开":"泄洪闸 · 已关")
                   : g.kind==="siren" ? (cdLeft>0?g.label+" · "+cdLeft+"s":g.label)
                   : (g.label+(dim?"（已用）":""));
      ctx.fillText(glabel, 0, -36);
      ctx.restore();
    }

    // 房间名
    ctx.textAlign="center"; ctx.font="bold 17px system-ui,sans-serif";    for(const rm of R.roomRects){
      if(rm.extract) continue;
      if(rm.x>cam.x+vw||rm.x+rm.w<cam.x||rm.y>cam.y+vh||rm.y+rm.h<cam.y) continue;
      ctx.fillStyle="rgba(210,222,235,0.30)";
      ctx.font="bold 15px system-ui,sans-serif";
      ctx.fillText(rm.name, rm.x+rm.w/2, rm.y+rm.h-14);
    }

    // 地面物品堆（背包满时溢出落地，腾出空间后可回来捡）
    if(R.grounds){
      for(const g of R.grounds){
        if(!raidContainerVisible(R,g)) continue;   // v0.26.0：与箱子同一套光照可见性
        if(g.searched) continue;
        if(g.x>cam.x+vw+60||g.x<cam.x-60||g.y>cam.y+vh+60||g.y<cam.y-60) continue;
        const n=(g.drops||[]).length;
        ctx.save(); ctx.translate(g.x, g.y);
        const pulse=0.5+0.5*Math.sin(M.now()/300);
        // 地面光晕
        ctx.globalAlpha=0.10+0.14*pulse;
        ctx.fillStyle="#ffd98a";
        ctx.beginPath(); ctx.arc(0,0,26,0,6.2832); ctx.fill();
        ctx.globalAlpha=1;
        // 散落的三件小包裹
        ctx.fillStyle="rgba(0,0,0,0.30)";
        ctx.beginPath(); ctx.ellipse(0,6,19,8,0,0,6.2832); ctx.fill();
        const cols=["#7d6a45","#6b5a3c","#8d7851"];
        for(let i=0;i<3;i++){
          const a=i*2.15+0.4, rr=7+i*3;
          const bx=Math.cos(a)*rr-4.5, by=Math.sin(a)*rr*0.6-3.5;
          ctx.fillStyle=cols[i];
          ctx.fillRect(bx,by,10,8);
          ctx.strokeStyle="rgba(232,202,132,0.95)"; ctx.lineWidth=1.2;
          ctx.strokeRect(bx,by,10,8);
        }
        // 上浮的小箭头（提示可拾取）
        ctx.globalAlpha=0.45+0.4*pulse;
        ctx.fillStyle="#ffe08a"; ctx.textAlign="center";
        ctx.font="bold 12px system-ui,sans-serif";
        ctx.fillText("▲", 0, -12);
        ctx.globalAlpha=1;
        ctx.fillStyle="#ffe08a"; ctx.font="bold 11px system-ui,sans-serif";
        ctx.fillText("×"+n, 0, 22);
        ctx.restore();
      }
    }

    // 补给箱
    /* v0.26.0：删掉 v0.25.0 的「进屋才看到」房间过滤（玩家明确要求移除）。
       现在统一按「玩家手电照到 或 就在身边」判定：远处黑暗里的箱子不再透显，
       但也不再因为隔着一堵房间墙就必须进屋才看得见。判定放在 raidContainerVisible，
       2D 渲染 / 3D 精灵 / E 交互共用一份，切视角不会错位。 */
    for(const c of R.containers){
      if(c.x>cam.x+vw+80||c.x<cam.x-80||c.y>cam.y+vh+80||c.y<cam.y-80) continue;
      if(!raidContainerVisible(R,c)) continue;
      const s=13;
      if(c.body){
        // 尸体：暗红色
        ctx.save(); ctx.translate(c.x,c.y);
        ctx.fillStyle=c.searched?"#3a2a2a":"#5a3030"; ctx.beginPath(); ctx.ellipse(0,0,s*0.9,s*0.6,0.6,0,6.28); ctx.fill();
        ctx.restore();
        continue;
      }
      ctx.save(); ctx.translate(c.x,c.y); ctx.rotate(0.2);
      // 箱子按类型着色：武器(橙) / 护甲(蓝) / 医疗(绿) / 杂项(棕) / 上锁保险箱(按保险等级 I~V)
      let col;
      const lv=c.locked?M.clamp(c.lockLv||1,1,5):0;
      if(c.searched) col="#3a3a30";
      else if(c.locked) col=raidKeyDef(lv).color;
      else if(c.kind==="weapon") col="#c07a33";
      else if(c.kind==="armor") col="#3d7ba8";
      else if(c.kind==="medical") col="#4a9a55";
      else col="#5f5238";
      ctx.fillStyle=col; ctx.fillRect(-s,-s*0.7,s*2,s*1.4);
      ctx.strokeStyle="#0a0c0d"; ctx.lineWidth=2; ctx.strokeRect(-s,-s*0.7,s*2,s*1.4);
      ctx.fillStyle="rgba(0,0,0,0.28)"; ctx.fillRect(-s,-s*0.7,s*2,s*0.3);
      // 上锁箱：横跨箱体的锁扣 + 等级罗马数字（未搜过才亮）
      if(c.locked && !c.searched){
        ctx.rotate(-0.2);
        ctx.fillStyle="rgba(10,14,18,0.9)";
        ctx.fillRect(-13,-6,26,11);
        ctx.strokeStyle=col; ctx.lineWidth=1.6; ctx.strokeRect(-13,-6,26,11);
        ctx.fillStyle=col; ctx.textAlign="center"; ctx.font="bold 11px system-ui,sans-serif";
        ctx.fillText(RAID_ROMAN[lv]||lv, 0, 4);
        // 锁鼻
        ctx.strokeStyle=col; ctx.lineWidth=2;
        ctx.beginPath(); ctx.arc(0,-11,5,Math.PI,0); ctx.stroke();
      }
      ctx.restore();
    }

    // 玩家搜索高亮
    if(R.search){
      const c=R.search.c;
      const t=M.clamp(R.search.t/Math.max(0.01, R._searchNeed(c)), 0, 1);
      ctx.strokeStyle="rgba(120,220,255,0.9)"; ctx.lineWidth=4;
      ctx.beginPath(); ctx.arc(c.x,c.y,20,-Math.PI/2,-Math.PI/2+t*6.2832); ctx.stroke();
    }

    // PMC
    for(const o of R.ops){
      if(!o.alive) continue;
      if(o.x>cam.x+vw+60||o.x<cam.x-60||o.y>cam.y+vh+60||o.y<cam.y-60) continue;
      this.unit(ctx, o, game);
    }

    // 涉水涟漪（任何踩在河里的单位脚下都有一圈扩散水波）
    for(const o of R.ops){
      if(!o.alive || !o._wet) continue;
      if(o.x>cam.x+vw+60||o.x<cam.x-60||o.y>cam.y+vh+60||o.y<cam.y-60) continue;
      for(let k=0;k<2;k++){
        const t=((M.now()/850)+k*0.5+o.x*0.011)%1;
        ctx.strokeStyle=`rgba(165,225,245,${(0.6*(1-t)).toFixed(3)})`; ctx.lineWidth=2;
        ctx.beginPath(); ctx.ellipse(o.x, o.y+o.r*0.6, 10+t*26, 5+t*11, 0, 0, 6.2832); ctx.stroke();
      }
    }

    // 火箭弹：尾焰 + 弹体
    for(const rk of R.rockets){
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
    // 爆炸冲击环
    for(const bl of R.blasts){
      const k=1-bl.life/bl.maxLife;
      ctx.globalAlpha=Math.max(0,1-k);
      ctx.strokeStyle="#ffb020"; ctx.lineWidth=4;
      ctx.beginPath(); ctx.arc(bl.x,bl.y, bl.r + k*bl.r*1.8, 0, 6.2832); ctx.stroke();
      ctx.globalAlpha=1;
    }

    // 弹头渲染：实体弹丸 + 曳光尾迹
    for(const tr of R.tracers){
      const al=M.clamp(tr.life/(tr.maxLife||0.08),0,1);
      if(tr.laser){
        ctx.globalAlpha=al; ctx.lineCap="round";
        ctx.strokeStyle=rgba(tr.color,0.28); ctx.lineWidth=6;
        ctx.beginPath(); ctx.moveTo(tr.x1,tr.y1); ctx.lineTo(tr.x2,tr.y2); ctx.stroke();
        ctx.shadowColor=tr.color; ctx.shadowBlur=9;
        ctx.strokeStyle=tr.color; ctx.lineWidth=2.6;
        ctx.beginPath(); ctx.moveTo(tr.x1,tr.y1); ctx.lineTo(tr.x2,tr.y2); ctx.stroke();
        ctx.shadowBlur=0; ctx.strokeStyle="rgba(255,255,255,0.9)"; ctx.lineWidth=1.1;
        ctx.beginPath(); ctx.moveTo(tr.x1,tr.y1); ctx.lineTo(tr.x2,tr.y2); ctx.stroke();
        ctx.globalAlpha=1;
      } else {
        const bx=tr.bx!==undefined?tr.bx:tr.x1, by=tr.by!==undefined?tr.by:tr.y1;
        const ang=Math.atan2(tr.y2-tr.y1, tr.x2-tr.x1);
        const dist=Math.hypot(tr.x2-tr.x1, tr.y2-tr.y1);
        const tl=Math.min(88, Math.max(26, dist*0.5));
        Render.tracerStreak(ctx, bx, by, bx-Math.cos(ang)*tl, by-Math.sin(ang)*tl, tr.color, 2.4, al);
        ctx.save(); ctx.globalAlpha=al; ctx.translate(bx,by); ctx.rotate(ang);
        Render.bulletShape(ctx, tr.shape||"round", 4.2, tr.color);
        ctx.restore(); ctx.globalAlpha=1;
      }
    }

    // 粒子
    for(const q of R.particles){ ctx.globalAlpha=M.clamp(q.life/q.maxLife,0,1); ctx.fillStyle=q.color; ctx.fillRect(q.x-q.size/2,q.y-q.size/2,q.size,q.size); }
    ctx.globalAlpha=1;

    // 飘字
    ctx.textAlign="center"; ctx.font="bold 13px system-ui,sans-serif";
    for(const f of R.floats){ ctx.globalAlpha=M.clamp(f.life/f.maxLife,0,1); ctx.fillStyle=f.color; ctx.fillText(f.text,f.x,f.y); }
    ctx.globalAlpha=1;

    // 桌面准星
    if(!Input.isTouch){
      const w=R._screenToWorld(Input.mouse.sx,Input.mouse.sy,game);
      ctx.strokeStyle="rgba(255,255,255,0.75)"; ctx.lineWidth=1.5;
      ctx.beginPath(); ctx.arc(w.x,w.y,7,0,6.28); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(w.x-12,w.y); ctx.lineTo(w.x-4,w.y); ctx.moveTo(w.x+4,w.y); ctx.lineTo(w.x+12,w.y); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(w.x,w.y-12); ctx.lineTo(w.x,w.y-4); ctx.moveTo(w.x,w.y+4); ctx.lineTo(w.x,w.y+12); ctx.stroke();
    }
  },

  /* 2D 俯视角的手持武器平面模型（v0.19.3）
   *   以前 2D 只在单位中心画一条「枪线」，看不出手里拿的是什么；这里按枪型画出
   *   枪托 / 机匣 / 弹匣 / 枪管 / 瞄具，画在角色「右手」的位置并随朝向旋转。
   *   空手（跑刀）画战术匕首 —— 跑刀流也能一眼认出来。
   *   局部坐标：+x = 朝向，握把在原点，单位是世界像素，最后按 r/15 缩放。 */
  handWeapon(ctx, o, r){
    const k = r/15, ang = o.angle||0;
    const ca = Math.cos(ang), sa = Math.sin(ang);
    // 右手：身体右前方（屏幕 y 向下时，(-sin, cos) 就是角色自己的右手边）
    ctx.save();
    ctx.translate(o.x + ca*r*0.40 - sa*r*0.90, o.y + sa*r*0.40 + ca*r*0.90);
    ctx.rotate(ang);
    ctx.scale(k, k);
    // v0.21.2：开火后坐 —— 整枪沿朝向后退一点点，视觉上才「打得动」
    if((o.kick||0)>0) ctx.translate(-Math.min(2.6,(o.kick||0)*1.9), 0);
    const dark = "#1d2228", mid = "#333a42", edge = "#0a0d10";
    const g = o.gun;
    if(!g){
      /* 战术匕首 */
      ctx.fillStyle = mid; ctx.strokeStyle = edge; ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(3,-2.4); ctx.lineTo(23,-0.8); ctx.lineTo(25,0); ctx.lineTo(23,0.8); ctx.lineTo(3,2.4);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#93a0ac"; ctx.fillRect(4.5, 0.7, 17, 0.9);     // 刃口
      ctx.fillStyle = dark;  ctx.fillRect(-1.6,-4.4, 3.4, 8.8);       // 护手
      ctx.fillStyle = "#3b3f45"; ctx.fillRect(-8.6,-2.2, 7, 4.4);     // 握柄
      ctx.fillStyle = "#12151a"; ctx.fillRect(-8.6,-2.2, 1.4, 4.4);
      ctx.restore(); return;
    }
    const S = {
      pistol:  { body:9,  bh:5.0, bar:4,  mag:0,  stock:0,  scope:0, mw:2.2 },
      smg:     { body:15, bh:5.2, bar:6,  mag:7,  stock:0,  scope:0, mw:2.0 },
      shotgun: { body:19, bh:5.4, bar:12, mag:0,  stock:6,  scope:0, mw:2.6 },
      rifle:   { body:18, bh:5.4, bar:12, mag:8,  stock:8,  scope:1, mw:2.0 },
      sniper:  { body:20, bh:5.2, bar:17, mag:5,  stock:9,  scope:1, mw:1.7 },
      launcher:{ body:20, bh:7.0, bar:6,  mag:0,  stock:0,  scope:0, mw:3.4 },
    }[g.type] || { body:15, bh:5.2, bar:8, mag:6, stock:5, scope:0, mw:2.0 };
    const acc = raidGunColor(g);
    const el = (g.element && g.element!=="none" && ELEMENTS[g.element]) ? ELEMENTS[g.element].color : null;
    ctx.strokeStyle = edge; ctx.lineWidth = 1;
    // 枪托（在握把之后）
    if(S.stock){
      ctx.fillStyle = dark;
      ctx.beginPath();
      ctx.moveTo(-1, -S.bh*0.45); ctx.lineTo(-1-S.stock, -S.bh*0.62);
      ctx.lineTo(-1-S.stock, S.bh*0.62); ctx.lineTo(-1, S.bh*0.45);
      ctx.closePath(); ctx.fill(); ctx.stroke();
    }
    // 机匣
    ctx.fillStyle = mid;
    ctx.fillRect(-1, -S.bh/2, S.body, S.bh);
    ctx.strokeRect(-1, -S.bh/2, S.body, S.bh);
    // 品质色装饰条（和物品栏、浮字同一个颜色体系）
    ctx.fillStyle = acc; ctx.globalAlpha = 0.85;
    ctx.fillRect(S.body*0.22, -S.bh/2+0.6, S.body*0.5, 1.1);
    ctx.globalAlpha = 1;
    // 弹匣
    if(S.mag){
      ctx.fillStyle = dark;
      ctx.fillRect(S.body*0.30, S.bh/2, 3.2, S.mag);
      ctx.strokeRect(S.body*0.30, S.bh/2, 3.2, S.mag);
    }
    // 枪管
    ctx.fillStyle = "#2a3037";
    ctx.fillRect(S.body-1, -S.mw/2, S.bar+1, S.mw);
    ctx.strokeRect(S.body-1, -S.mw/2, S.bar+1, S.mw);
    if(el){                                   // 元素枪：枪口一圈发光
      ctx.fillStyle = el; ctx.globalAlpha = 0.9;
      ctx.fillRect(S.body+S.bar-1.6, -S.mw/2-0.4, 1.8, S.mw+0.8);
      ctx.globalAlpha = 1;
    }
    // 瞄具
    if(S.scope && (g.parts||[]).some(p=>p.slot==="optic")){
      ctx.fillStyle = "#141a20";
      ctx.fillRect(S.body*0.34, -S.bh/2-2.1, 5.5, 2.1);
      ctx.fillStyle = "#ffd23f";
      ctx.fillRect(S.body*0.34+0.8, -S.bh/2-1.7, 1.1, 1.1);
    }
    // v0.21.2：开火瞬间的枪口火光（和 3D 视图模型同一个 muzzleT 驱动）
    if((o.muzzleT||0)>0){
      const mx=S.body+S.bar+1;
      const flick=0.7+0.3*Math.random();
      // 辉光：叠加混合，俯视角下才看得见（不来这一下就只有 2px 的小黄点）
      ctx.save();
      ctx.globalCompositeOperation="lighter";
      const gr=6.5+S.mw*0.7;
      const gl=ctx.createRadialGradient(mx+2, 0, 0, mx+2, 0, gr);
      gl.addColorStop(0, "rgba(255,238,190,"+(0.85*flick).toFixed(2)+")");
      gl.addColorStop(0.45, "rgba(255,186,86,"+(0.42*flick).toFixed(2)+")");
      gl.addColorStop(1, "rgba(255,150,60,0)");
      ctx.fillStyle=gl;
      ctx.beginPath(); ctx.arc(mx+2, 0, gr, 0, 6.2832); ctx.fill();
      ctx.restore();
      // 星芒
      const sp=4.2+S.mw*1.1;
      ctx.fillStyle="rgba(255,214,120,0.95)";
      ctx.beginPath();
      ctx.moveTo(mx, -1.1); ctx.lineTo(mx+sp, -3.2);
      ctx.lineTo(mx+sp*0.68, 0); ctx.lineTo(mx+sp, 3.2);
      ctx.lineTo(mx, 1.1); ctx.closePath(); ctx.fill();
      ctx.fillStyle="rgba(255,248,214,1)";
      ctx.beginPath(); ctx.arc(mx+1.4, 0, 1.5, 0, 6.2832); ctx.fill();
    }
    ctx.restore();
  },

  unit(ctx, o, game){
    const r=o.r;
    // v0.14.10：血条颜色 = 目标护甲类型（血肉红 / 护盾蓝 / T4+ 装甲黄）
    const at=raidArmorType(o), atCol=ARMOR_TYPE_COLOR[at]||ARMOR_TYPE_COLOR.flesh;
    // 阴影
    ctx.beginPath(); ctx.ellipse(o.x,o.y+r*0.5,r*0.95,r*0.5,0,0,6.2832); ctx.fillStyle="rgba(0,0,0,0.32)"; ctx.fill();
    /* 玩家 / 队友：画真正的手持武器模型（枪型 / 品质色 / 元素枪口 / 瞄具，
     * 空手则是战术匕首）；远处 AI 保留廉价的「枪线」，几十个单位不必每个都描一遍细节。 */
    if(o.isPlayer || o.remote){
      this.handWeapon(ctx, o, r);
    } else {
      // 枪（随枪型长度 / 弹种颜色变化，瞄具配件额外描金点）
      const GUN_LEN={pistol:r+10,smg:r+14,shotgun:r+18,rifle:r+20,sniper:r+30,launcher:r+16};
      const g=o.gun; const gLen=(g&&GUN_LEN[g.type])||(r+14);
      const gCol=(g&&g.element!=="none"&&ELEMENTS[g.element])?ELEMENTS[g.element].color:"#2a2f35";
      const gx=Math.cos(o.angle), gy=Math.sin(o.angle);
      ctx.lineCap="round";
      ctx.strokeStyle="#16191e"; ctx.lineWidth=5.5;
      ctx.beginPath(); ctx.moveTo(o.x,o.y); ctx.lineTo(o.x+gx*gLen, o.y+gy*gLen); ctx.stroke();
      ctx.strokeStyle=gCol; ctx.lineWidth=2.4;
      ctx.beginPath(); ctx.moveTo(o.x,o.y); ctx.lineTo(o.x+gx*gLen, o.y+gy*gLen); ctx.stroke();
      if(g && (g.parts||[]).some(p=>p.slot==="optic")){
        ctx.fillStyle="#ffd23f"; ctx.beginPath(); ctx.arc(o.x+gx*gLen*0.42, o.y+gy*gLen*0.42, 2.2,0,6.28); ctx.fill();
      }
    }
    // 身体
    ctx.beginPath(); ctx.arc(o.x,o.y,r,0,6.2832);
    ctx.fillStyle=o.color; ctx.fill();
    ctx.lineWidth=3; ctx.strokeStyle=(o.isPlayer||o.remote)?"#0a2a33":"#0d0a07"; ctx.stroke();
    // v0.14.10：装甲型单位一圈黄色描边，和黄色血条呼应
    if(at==="armor"){
      ctx.beginPath(); ctx.arc(o.x,o.y,r+2,0,6.2832);
      ctx.strokeStyle="rgba(255,210,63,0.60)"; ctx.lineWidth=2; ctx.stroke();
    }
    // v0.14.10：冰冻呈现 —— 半透明冰霜覆层 + 冰蓝外环 + 六向冰晶
    if(o.freezeT>0){
      const fa=M.clamp(o.freezeT/2.8,0,1);
      ctx.save();
      ctx.globalAlpha=0.22+0.26*fa; ctx.fillStyle="#8fe4ff";
      ctx.beginPath(); ctx.arc(o.x,o.y,r+1,0,6.2832); ctx.fill();
      ctx.globalAlpha=0.55+0.35*fa; ctx.strokeStyle="#bdefff"; ctx.lineWidth=2;
      ctx.beginPath(); ctx.arc(o.x,o.y,r+4,0,6.2832); ctx.stroke();
      ctx.lineWidth=1.4;
      for(let k=0;k<6;k++){
        const a2=k*Math.PI/3+o.freezeT*0.6;
        const cx=o.x+Math.cos(a2)*(r+4), cy=o.y+Math.sin(a2)*(r+4);
        ctx.beginPath();
        ctx.moveTo(cx-Math.cos(a2)*4, cy-Math.sin(a2)*4);
        ctx.lineTo(cx+Math.cos(a2)*4, cy+Math.sin(a2)*4);
        ctx.stroke();
      }
      ctx.restore();
    }
    /* v0.14.11：四种元素持续状态的可视化（不看血条也能知道身上挂了什么） */
    if(o.burnT>0){
      const t=o.burnT;
      ctx.save(); ctx.globalAlpha=0.55;
      ctx.strokeStyle="#ff7a1f"; ctx.lineWidth=2;
      ctx.beginPath(); ctx.arc(o.x,o.y,r+6,0,6.2832); ctx.stroke();
      for(let k=0;k<3;k++){
        const a2=k*2.094+t*2.1;
        const h=6+((t*7+k*3)%9);
        ctx.fillStyle=k%2?"#ffd23f":"#ff5a1f";
        ctx.beginPath(); ctx.arc(o.x+Math.cos(a2)*(r*0.6), o.y+Math.sin(a2)*(r*0.6)-h, 2.4,0,6.28); ctx.fill();
      }
      ctx.restore();
    }
    if(o.corrodeT>0){
      ctx.save(); ctx.globalAlpha=0.7; ctx.strokeStyle="#7bff3a"; ctx.lineWidth=2;
      ctx.setLineDash([3,4]); ctx.lineDashOffset=-o.corrodeT*10;
      ctx.beginPath(); ctx.arc(o.x,o.y,r+8,0,6.2832); ctx.stroke();
      ctx.setLineDash([]); ctx.restore();
    }
    if(o.shockT>0){
      ctx.save(); ctx.globalAlpha=0.8; ctx.strokeStyle="#7be3ff"; ctx.lineWidth=1.6;
      for(let k=0;k<3;k++){
        const a2=k*2.094+o.shockT*3;
        ctx.beginPath();
        ctx.moveTo(o.x+Math.cos(a2)*(r+2),o.y+Math.sin(a2)*(r+2));
        ctx.lineTo(o.x+Math.cos(a2+0.25)*(r+10),o.y+Math.sin(a2+0.25)*(r+10));
        ctx.stroke();
      }
      ctx.restore();
    }
    if(o.radT>0){
      ctx.save(); ctx.globalAlpha=0.45; ctx.strokeStyle="#c8ff32"; ctx.lineWidth=2;
      ctx.beginPath(); ctx.arc(o.x,o.y,r+11-o.radT*5,0,6.2832); ctx.stroke(); ctx.restore();
    }
    if(o.isPlayer||o.remote){
      ctx.beginPath(); ctx.arc(o.x,o.y,r+4,0,6.2832);
      ctx.strokeStyle=o.remote?"rgba(126,224,138,0.9)":"rgba(79,214,255,0.85)"; ctx.lineWidth=2; ctx.stroke();
    }
    if(o.bounty){
      // Boss：金色外环 + 脉冲星标
      ctx.beginPath(); ctx.arc(o.x,o.y,r+6,0,6.2832); ctx.strokeStyle="#ffd23f"; ctx.lineWidth=2.5; ctx.stroke();
      ctx.fillStyle="#ffd23f"; ctx.font="bold 14px system-ui,sans-serif"; ctx.textAlign="center";
      ctx.fillText("★", o.x, o.y-r-20);
    }
    // 朝向眼
    ctx.fillStyle="#fff";
    const ex=Math.cos(o.angle)*r*0.4, ey=Math.sin(o.angle)*r*0.4;
    ctx.beginPath(); ctx.arc(o.x+ex,o.y+ey,r*0.22,0,6.28); ctx.fill();
    // 名字 + 血条（v0.14.10：名字后缀标注护甲类型，血条按类型着色）
    const atTag=(at!=="flesh")?(" ·"+ARMOR_TYPE_NAME[at]):"";
    if(o.remote){
      ctx.font="bold 11px system-ui,sans-serif"; ctx.textAlign="center";
      ctx.fillStyle="#8fe0a0";
      ctx.fillText("◈ "+(o.name||"队友")+atTag, o.x, o.y-r-10);
      if(!o.alive){
        ctx.fillStyle="rgba(255,120,120,0.9)"; ctx.font="bold 10px system-ui,sans-serif";
        ctx.fillText("已阵亡", o.x, o.y-r-22);
      }
    } else if(!o.isPlayer){
      ctx.font="11px system-ui,sans-serif"; ctx.textAlign="center";
      ctx.fillStyle=o.smart?"rgba(255,210,63,0.92)":"rgba(255,190,190,0.85)";
      ctx.fillText(o.name+atTag, o.x, o.y-r-8);
      if(o.state==="loot"){
        ctx.font="bold 9px system-ui,sans-serif"; ctx.fillStyle="#8fe07a";
        ctx.fillText("搜刮中", o.x, o.y-r-(o.bounty?42:24));
      }
    }
    const w=40;
    ctx.fillStyle="rgba(0,0,0,0.55)"; ctx.fillRect(o.x-w/2-1,o.y-r-6,w+2,5);
    // 血肉型保留阵营色；装甲型覆盖为黄色类型色
    // v0.21.2：去掉血条右侧那个「类型色小方块」—— 护盾兵会多出一个突兀的蓝点，
    // 而类型信息名字后缀（·装甲 / ·护盾）和上方护盾条已经说清楚了。
    const hpCol=(at==="armor")?atCol:(o.remote?"#7ee08a":"#d8564a");
    ctx.fillStyle=hpCol; ctx.fillRect(o.x-w/2,o.y-r-5.5,w*M.clamp(o.hp/o.maxHP,0,1),4);
    if(o.maxArmor>0){
      ctx.fillStyle="rgba(120,180,255,0.85)"; ctx.fillRect(o.x-w/2,o.y-r-10.5,w*M.clamp(o.armor/o.maxArmor,0,1),3);
    }
    // v0.16.0：护盾条（青蓝）画在护甲条 / 血条之上，三层防护一眼可读
    if(o.maxShield>0){
      ctx.fillStyle="rgba(0,0,0,0.5)"; ctx.fillRect(o.x-w/2-1,o.y-r-15.5,w+2,5);
      ctx.fillStyle="rgba(79,214,255,0.92)"; ctx.fillRect(o.x-w/2,o.y-r-14.5,w*M.clamp((o.shield||0)/o.maxShield,0,1),3);
    }
    if((o.shieldInvuln||0)>0){
      ctx.strokeStyle="rgba(150,230,255,"+(0.45+0.35*Math.sin(M.now()*14)).toFixed(2)+")";
      ctx.lineWidth=2; ctx.beginPath(); ctx.arc(o.x,o.y,o.r+7,0,6.28); ctx.stroke();
    }
    const tags=[];
    if(o.freezeT>0)  tags.push({t:"迟滞",c:"#bdefff"});
    if(o.burnT>0)    tags.push({t:"引燃",c:"#ff8a3a"});
    if(o.corrodeT>0) tags.push({t:"撕裂",c:"#9bff5a"});
    if(o.shockT>0)   tags.push({t:"失能",c:"#7be3ff"});
    if(tags.length){
      ctx.font="bold 9px system-ui,sans-serif"; ctx.textAlign="center";
      const line=tags.map(x=>x.t).join("·");
      ctx.fillStyle=tags[0].c; ctx.fillText(line, o.x, o.y+r+12);
    }
  },

  /* v0.22.2 引入 / v0.24.0 泛化：靠近地上的**任何装备**（枪 / 护盾 / 护甲 / 头盔）
     都展示对比面板，与当前身上的同类装备逐项比较。函数名沿用历史名（verify 锁着）。
     背包满溢出落地的装备也会进这个面板 —— 之前只认 weapon，掉件头盔等于什么提示都没有。
     画在 HUD 层（世界层之外），2D / 3D 都可见；位置跟随交互提示条，避开准星。 */
  _groundGunPanel(ctx, R, c, v, hintY){
    const drops=(c && c.drops)||[];
    const GEAR=["weapon","shield","armor","helmet"];
    // 武器优先（玩家最常换的就是枪），其次护盾 / 护甲 / 头盔
    let g=null;
    for(const k of GEAR){ g=drops.find(d=>d && d.kind===k); if(g) break; }
    if(!g) return;
    const kind=g.kind, p=R.player||{}, carried=R.carried||{};
    /* 当前装备：枪看主手，护盾看身上模块，护甲/头盔看 carried（带入的那件）。
       裸装进场时 carried 为空但玩家仍可能被 AI 掉落/设施临时上了甲，用 tier 兜底。 */
    const cur = kind==="weapon" ? (p.gun||null)
      : kind==="shield" ? (p.shieldGear||null)
      : kind==="armor"  ? (carried.armor || (p.armorTier?{maxArmor:p.maxArmor,dr:p.dr,tier:p.armorTier,value:0}:null))
      : (carried.helmet || (p.helmetTier?{maxArmor:p.maxHelmetArmor,dr:p.helmetDr,tier:p.helmetTier,value:0}:null));
    /* 数值格式化：估值动辄七位数，直接拼数字既撑破面板也没法一眼比大小 */
    const fmt=(n,big)=>{
      n=Math.round(n||0);
      if(!big) return String(n);
      if(n>=1000000) return "₽"+(n/1000000).toFixed(2)+"M";
      if(n>=10000) return "₽"+(n/1000).toFixed(1)+"k";
      return "₽"+n;
    };
    const rows = kind==="weapon" ? [
      { k:"伤害", a:Math.round(g.dmg||0), b:cur?Math.round(cur.dmg||0):0 },
      { k:"弹匣", a:Math.round(g.mag||0), b:cur?Math.round(cur.mag||0):0 },
      { k:"射速", a:Math.round(g.rpm||0), b:cur?Math.round(cur.rpm||0):0 },
      { k:"估值", a:Math.round(g.value||0), b:cur?Math.round(cur.value||0):0, big:true },
    ] : kind==="shield" ? [
      { k:"容量", a:Math.round(g.capacity||0), b:cur?Math.round(cur.capacity||0):0 },
      { k:"充能/s", a:Math.round(g.rate||0), b:cur?Math.round(cur.rate||0):0 },
      { k:"延迟s", a:Math.round(g.delay||0), b:cur?Math.round(cur.delay||0):0 },
      { k:"估值", a:Math.round(g.value||0), b:cur?Math.round(cur.value||0):0, big:true },
    ] : [
      { k:"耐久", a:Math.round(g.maxArmor||0), b:cur?Math.round(cur.maxArmor||0):0 },
      { k:"减伤%", a:Math.round((g.dr||0)*100), b:cur?Math.round((cur.dr||0)*100):0 },
      { k:"品阶", a:Math.round(g.tier||0), b:cur?Math.round(cur.tier||0):0 },
      { k:"估值", a:Math.round(g.value||0), b:cur?Math.round(cur.value||0):0, big:true },
    ];
    const title = kind==="weapon" ? (gunNameOf(g)||"地上枪械")
      : kind==="shield" ? (g.name||"地上护盾")
      : kind==="armor" ? (g.name||"地上护甲") : (g.name||"地上头盔");
    const tint = kind==="weapon" ? raidGunColor(g)
      : kind==="shield" ? shieldColor(g)
      : (RAID_RARITY_COLOR[g.rarity|0]||"#dfe7f0");
    const W=276, H=34+rows.length*20+10;
    const x=Math.max(8, Math.min(v.w-W-8, v.w/2+28));
    const y=Math.max(8, Math.min(v.h-H-8, hintY-H-16));
    ctx.save();
    ctx.fillStyle="rgba(8,12,16,0.90)"; ctx.fillRect(x,y,W,H);
    ctx.strokeStyle="rgba(120,150,180,0.45)"; ctx.lineWidth=1; ctx.strokeRect(x+0.5,y+0.5,W-1,H-1);
    ctx.textAlign="left";
    ctx.font="bold 12px system-ui,sans-serif";
    ctx.fillStyle=tint;
    ctx.fillText(String(title).slice(0,18), x+10, y+18);
    /* 溢出标记：让玩家知道「这几件是我背包塞不下才留在这的」 */
    if(c.spill){
      ctx.textAlign="right"; ctx.fillStyle="#ff8a5a";
      ctx.font="10px system-ui,sans-serif"; ctx.fillText("背包溢出", x+W-10, y+18);
      ctx.textAlign="left";
    }
    ctx.font="10px system-ui,sans-serif"; ctx.fillStyle="rgba(180,195,210,0.75)";
    ctx.fillText(cur
      ? (kind==="weapon"?"左：地上 / 右：手持":"左：地上 / 右：已穿戴")
      : (kind==="weapon"?"手持为空 · 直接拾取":"当前未装备 · 可直接穿戴"), x+10, y+32);
    ctx.font="11px system-ui,sans-serif";
    for(let i=0;i<rows.length;i++){
      const r=rows[i], ry=y+50+i*20;
      // 身上没同类装备时不做对比，免得每一行都亮成「提升」
      const better=!!cur && r.a>r.b, worse=!!cur && r.a<r.b;
      ctx.fillStyle="rgba(200,212,224,0.85)"; ctx.fillText(r.k, x+10, ry);
      ctx.fillStyle=better?"#8fe07a":worse?"#ff8a5a":"#dfe7f0";
      ctx.textAlign="right"; ctx.fillText(fmt(r.a,r.big)+(better?" ▲":worse?" ▼":""), x+168, ry);
      ctx.fillStyle="rgba(170,185,200,0.70)"; ctx.fillText(cur?fmt(r.b,r.big):"—", x+W-10, ry);
      ctx.textAlign="left";
    }
    ctx.restore();
  },

  /* ----------------------------- HUD ----------------------------- */
  hud(ctx, game, v){
    const R=Raid, p=R.player;
    if(!p) return;
    const mob=!!Input.isTouch;      // 手机端：HUD 让位给右下触屏按钮，避免重叠

    // 受击红晕
    if(R.hitFlash>0){
      ctx.fillStyle=`rgba(200,30,30,${R.hitFlash*0.5})`; ctx.fillRect(0,0,v.w,v.h);
    }

    /* --- 左上角击杀提示 --- */
    ctx.textAlign="left";
    ctx.font=mob?"bold 11px system-ui,sans-serif":"bold 13px system-ui,sans-serif";
    // 手机端信息流从 Boss 行下面开始（原来 y=58 与 Boss 提示直接压在一起），
    // 并按可用宽度截断，避免长句冲出屏幕、盖住右侧战况面板。
    let y=mob?86:18;
    const feedMax=(mob? v.w*0.58 : v.w*0.46)-30;
    const fit=(t)=>{
      if(ctx.measureText(t).width<=feedMax) return t;
      let lo=0, hi=t.length;
      while(lo<hi){ const mid=(lo+hi+1)>>1; if(ctx.measureText(t.slice(0,mid)+"…").width<=feedMax) lo=mid; else hi=mid-1; }
      return t.slice(0,lo)+"…";
    };
    for(const k of R.killfeed){
      const alpha=M.clamp(k.t/6,0,1);
      ctx.globalAlpha=alpha;
      let text;
      if(k.type==="extract") text=`${k.a}  已撤离`;
      else if(k.type==="info") text=`${k.a} · ${k.v}`;
      else if(k.type==="warn") text=`⚠ ${k.v}`;
      else text=`${k.a}  ▸  ${k.v}`;
      text=fit(text);
      const col = k.mine ? "#ffd23f" : (k.type==="warn"?"#ff8a5a":k.type==="info"?"#8fd0ff":"#cfd8e2");
      // 背景条
      let w=ctx.measureText(text).width + (k.type==="kill"? 62:16);
      if(mob) w=Math.min(w, v.w-24);
      ctx.fillStyle="rgba(8,12,16,0.55)";
      ctx.beginPath(); ctx.roundRect? ctx.roundRect(12,y-13,w,20,5) : ctx.rect(12,y-13,w,20); ctx.fill();
      ctx.fillStyle=col;
      ctx.fillText(text, 20, y+2);
      if(k.type==="kill" && k.gun){
        ctx.fillStyle="rgba(150,170,190,0.8)"; ctx.font="11px system-ui,sans-serif";
        ctx.fillText(`[${k.gun}]`, 12+w-58, y+2);
        ctx.font="bold 13px system-ui,sans-serif";
      }
      ctx.globalAlpha=1;
      y+=24;
    }

    // Boss 存活数（顶部居中偏下提示）
    const bountyN=R.ops.filter(o=>o.alive && o.bounty).length;
    if(bountyN>0){
      ctx.textAlign="center"; ctx.font=mob?"bold 11px system-ui,sans-serif":"bold 12px system-ui,sans-serif";
      ctx.fillStyle="#ffd23f";
      // 避免和左侧信息流叠在一起：信息流每行 24px，Boss 行随之下移
      const by=Math.max(mob?62:66, (mob?86:18)+Math.min(4,R.killfeed.length)*24);
      ctx.fillText(`★ Boss ×${bountyN}（击杀保底 3 件高品阶战利品）`, v.w/2, by);
    }

    /* --- 顶部计时 --- */
    const mm=Math.floor(R.timer/60), ss=Math.floor(R.timer%60);
    ctx.textAlign="center"; ctx.font=mob?"bold 21px system-ui,sans-serif":"bold 26px system-ui,sans-serif";
    ctx.fillStyle=R.timer<=60?"#ff6a5a":"#e8eef4";
    ctx.fillText(`${mm}:${ss<10?"0":""}${ss}`, v.w/2, mob?26:38);
    ctx.font=mob?"9px system-ui,sans-serif":"11px system-ui,sans-serif";
    ctx.fillStyle="rgba(180,195,210,0.75)";
    ctx.fillText("剩余撤离时间", v.w/2, mob?40:54);

    /* --- 右上角状态 --- */
    const lootN=R.inv.weapons.length+R.inv.armors.length+R.inv.helmets.length+(R.inv.shields||[]).length+R.inv.parts.length;
    const capN=RAID_INV_CAP.weapons+RAID_INV_CAP.armors+RAID_INV_CAP.helmets+RAID_INV_CAP.shields+RAID_INV_CAP.parts;
    const mateN=(R.online && typeof Net!=="undefined") ? Net.peers.size : 0;
    if(mob){
      // 手机：暂停键在右上角，状态文字下移到它下面一行
      ctx.textAlign="right"; ctx.font="bold 12px system-ui,sans-serif";
      ctx.fillStyle="#cfd8e2"; ctx.fillText(`在场 ${R.aliveFoes()+1+mateN}`, v.w-12, 70);
      ctx.fillStyle="#8fe07a"; ctx.fillText(`₽ ${R.creds}`, v.w-12, 86);
      ctx.fillStyle=lootN>=capN?"#ff8a5a":"#c9a13a"; ctx.fillText(`物品栏 ${lootN}/${capN}`, v.w-12, 102);
      if(mateN){
        ctx.font="bold 10px system-ui,sans-serif"; ctx.fillStyle="#7ee08a";
        ctx.fillText(`联机 ${Net.code} · 队友 ${mateN}`, v.w-12, 118);
      }
    } else {
      ctx.textAlign="right"; ctx.font="bold 14px system-ui,sans-serif";
      ctx.fillStyle="#cfd8e2";
      ctx.fillText(`在场 ${R.aliveFoes()+1+mateN} 人`, v.w-20, 30);
      ctx.fillStyle="#8fe07a";
      ctx.fillText(`₽ ${R.creds}`, v.w-20, 50);
      ctx.fillStyle=lootN>=capN?"#ff8a5a":"#c9a13a";
      ctx.fillText(`物品栏 ${lootN}/${capN}`, v.w-20, 70);
      if(mateN){
        ctx.font="bold 11px system-ui,sans-serif"; ctx.fillStyle="#7ee08a";
        ctx.fillText(`联机 ${Net.code} · 队友 ${mateN}`, v.w-20, 90);
      }
    }

    /* --- 底部状态（手机版整体上移 + 收窄，让开右下触屏键） --- */
    const bx=mob?14:24, by=mob?(v.h-214):(v.h-92), bw=mob?Math.min(150,v.w*0.42):220;
    // 生命
    ctx.textAlign="left";
    // v0.16.0：独立蓝色护盾条画在血条「上方」，血条本身保持红色 —— 不是把血条染蓝
    if(p.maxShield>0){
      ctx.fillStyle="rgba(0,0,0,0.5)"; ctx.fillRect(bx,by-18,bw,12);
      ctx.fillStyle=(p.shieldInvuln>0)?"#bdefff":"#4fd6ff";
      ctx.fillRect(bx,by-18,bw*M.clamp((p.shield||0)/p.maxShield,0,1),12);
      ctx.fillStyle="#04141a"; ctx.font="bold 10px system-ui,sans-serif";
      ctx.fillText(`护盾 ${Math.ceil(p.shield)} / ${Math.round(p.maxShield)}${p.shieldInvuln>0?" · 无敌":""}`, bx+8, by-9);
    }
    ctx.font="bold 12px system-ui,sans-serif";
    ctx.fillStyle="rgba(0,0,0,0.5)"; ctx.fillRect(bx,by,bw,16);
    ctx.fillStyle=p.bleed>0?"#ff8a5a":"#d8564a"; ctx.fillRect(bx,by,bw*M.clamp(p.hp/p.maxHP,0,1),16);
    ctx.fillStyle="#04141a"; ctx.fillText(`生命 ${Math.ceil(p.hp)} / ${p.maxHP}`, bx+8, by+12);
    // 护甲
    if(p.maxArmor>0){
      ctx.fillStyle="rgba(0,0,0,0.5)"; ctx.fillRect(bx,by+20,bw,12);
      // v0.16.0：护甲条改琥珀 / 黄色，蓝色只留给上方那条独立护盾条，避免两条蓝条混淆
      ctx.fillStyle=(p.armorTier>=RAID_ARMOR_TYPE_TIER && p.armor>0)?"#ffd23f":"#d8b26a"; ctx.fillRect(bx,by+20,bw*M.clamp(p.armor/p.maxArmor,0,1),12);
      ctx.fillStyle="#04141a"; ctx.fillText(`护甲 ${Math.ceil(p.armor)} · 减伤 ${Math.round(p.dr*100)}%`, bx+8, by+30);
    }
    // 弹药 / 武器（空手时给出引导）
    if(p.gun){
      const magN=p.gun.ammoMag||0, backN=p.gun.ammoRes||0;
      const ad=p.gun.loaded ? ammoDefFromId(p.gun.loaded) : null;
      const dry=magN<=0 && backN<=0;                 // 弹匣空 + 背包空 = 真打不响
      ctx.fillStyle=dry?(Math.sin(M.now()*8)>0?"#ff5a4a":"#ff8a5a"):"#e8eef4";
      ctx.font=mob?"bold 16px system-ui,sans-serif":"bold 18px system-ui,sans-serif";
      ctx.fillText(`${magN} / ${backN}`, bx, by+56);
      ctx.font=mob?"11px system-ui,sans-serif":"12px system-ui,sans-serif";
      ctx.fillStyle=dry?"#ff9a8a":"rgba(180,195,210,0.85)";
      ctx.fillText(gunNameOf(p.gun)+" · "+(ad?ad.short:"未装填")
        +(p.reloadT>0?" · 换弹中…":(dry?" · 没有子弹":(magN<=0?" · 弹匣空（R 换弹）":""))), bx, by+74);
    } else {
      ctx.fillStyle="#ffb35a"; ctx.font=mob?"bold 15px system-ui,sans-serif":"bold 17px system-ui,sans-serif";
      ctx.fillText("空手 · 跑刀（+"+Math.round((RAID_BAREHAND_SPEED-1)*100)+"% 移速）", bx, by+56);
      ctx.font=mob?"10px system-ui,sans-serif":"11px system-ui,sans-serif"; ctx.fillStyle="rgba(200,180,150,0.9)";
      ctx.fillText(Input.isTouch?"靠近补给箱点「★」搜索 · 受伤点「+」包扎":"翻箱搜刮捡枪，捡到即自动上手", bx, by+74);
    }

    // 流血 / 绷带状态（塔科夫式医疗）
    if(p.bleed>0){
      ctx.font=mob?"bold 12px system-ui,sans-serif":"bold 13px system-ui,sans-serif";
      ctx.fillStyle=Math.sin(M.now()*8)>0?"#ff5a4a":"#ff8a5a";
      ctx.fillText(`⚠ 流血 x${p.bleed} · 每秒掉血`, bx, by-8);
    }
    /* v0.19.0：只显示「身上真有」的医疗品，0 件不再占位（旧版固定显示「绷带 x0 · 医疗 x0」）。
     * 每件按品级着色，换行绘制；一件都没有时给一句获取提示。 */
    const mdx=mob?bx:(bx+bw+14), mdy=mob?(by+94):(by+14);
    ctx.textAlign="left";
    ctx.font=mob?"bold 12px system-ui,sans-serif":"bold 13px system-ui,sans-serif";
    const owned=R._medOwnedList();
    let medY=mdy;
    if(!owned.length){
      ctx.fillStyle="rgba(205,175,175,0.72)";
      ctx.fillText(Input.isTouch?"无医疗用品 · 搜箱点「★」":"无医疗用品 · 翻箱搜刮", mdx, mdy);
    } else {
      const limit = mob ? (v.w-mdx-14) : Math.min(v.w-mdx-260, 620);
      let cx=mdx;
      for(let i=0;i<owned.length;i++){
        const txt=(i?"· ":"")+owned[i].name+" x"+owned[i].n;
        const tw=ctx.measureText(txt).width;
        if(cx>mdx && cx+tw>mdx+limit){ cx=mdx; medY+=17; }
        ctx.fillStyle=owned[i].color||"#ffb0b0";
        ctx.fillText(txt, cx, medY);
        cx+=tw;
      }
      if(!mob){
        ctx.font="11px system-ui,sans-serif"; ctx.fillStyle="rgba(190,200,210,0.55)";
        ctx.fillText(R.medT>0?"治疗中…（移动会打断）":"H 自动用最合适的一件", mdx, medY+17);
      }
    }
    if(R.stimT>0){
      ctx.font="11px system-ui,sans-serif"; ctx.fillStyle="#8fe07a";
      ctx.fillText(`加速 ${R.stimT.toFixed(0)}s`, mdx, medY+34);
    }
    if(R.medT>0){
      const u=R.medUse||{cast:2.2};
      const t=1-R.medT/(u.cast||2.2);
      const by2=medY+(mob?6:22);
      ctx.fillStyle="rgba(0,0,0,0.5)"; ctx.fillRect(mdx, by2, 90, 9);
      ctx.fillStyle=u.color||"#ffb0b0"; ctx.fillRect(mdx, by2, 90*M.clamp(t,0,1), 9);
      ctx.font="10px system-ui,sans-serif"; ctx.fillStyle="#ffd8d8";
      ctx.fillText((u.name||"治疗"), mdx+98, by2+8);
      medY=by2;
    }

    /* --- 撤离进度 --- */
    let inZone=null;
    for(const z of R.extracts){ if(!z.closed && p.x>=z.x&&p.x<=z.x+z.w&&p.y>=z.y&&p.y<=z.y+z.h){ inZone=z; break; } }
    if(inZone){
      const t=R.extractT/inZone.need;
      const cw=Math.min(300,v.w-36), cx=v.w/2-cw/2, cy=mob?v.h*0.56:(v.h-140);
      const blocked = R._extractBlockReason;
      /* 钱不够和「被封锁」是两回事，颜色与文案都要分开：一个是去清人，一个是去搞钱 */
      const money = !!blocked && blocked.indexOf("撤离费")===0;
      ctx.fillStyle=blocked?(money?"rgba(46,34,6,0.90)":"rgba(52,10,8,0.88)"):"rgba(8,16,12,0.8)"; ctx.fillRect(cx,cy,cw,26);
      ctx.fillStyle=blocked?(money?"#e8c05a":"#ff6a5a"):"#4fe08a"; ctx.fillRect(cx,cy,cw*Math.max(0.02,t),26);
      ctx.textAlign="center"; ctx.font=mob?"bold 12px system-ui,sans-serif":"bold 13px system-ui,sans-serif";
      ctx.fillStyle=blocked?(money?"#ffe9b8":"#ffe0dc"):"#04140c";
      const exLabel = blocked ? ((money?"⛕ ":"⛔ ")+blocked)
        : (mob ? `撤离中 ${(R.extractT).toFixed(1)} / ${inZone.need.toFixed(0)} 秒`
               : `撤离中 · ${inZone.name}  ${(R.extractT).toFixed(1)} / ${inZone.need.toFixed(0)} 秒`);
      ctx.fillText(exLabel, v.w/2, cy+18);
    }

    /* --- 涉水提示 --- */
    if(R.wadeT>0.5 && R.player.alive){
      const safe=Math.max(0, 4.5-R.wadeT);
      const warn=safe<=0;
      const txt=warn ? "⚠ 失温 · 立刻上岸！"
                     : `涉水中 · 流速拖慢 · 再过 ${safe.toFixed(1)} 秒开始失温`;
      ctx.font=mob?"bold 12px system-ui,sans-serif":"bold 13px system-ui,sans-serif";
      const tw=ctx.measureText(txt).width;
      const ty=mob?v.h*0.70:(v.h-196);
      ctx.fillStyle=warn?"rgba(60,12,10,0.86)":"rgba(8,20,28,0.80)";
      ctx.fillRect(v.w/2-tw/2-12, ty-16, tw+24, 24);
      ctx.strokeStyle=warn?"rgba(255,120,100,0.75)":"rgba(120,200,225,0.45)";
      ctx.lineWidth=1.5; ctx.strokeRect(v.w/2-tw/2-12, ty-16, tw+24, 24);
      ctx.textAlign="center"; ctx.fillStyle=warn?"#ff9a8a":"#a8dcef";
      ctx.fillText(txt, v.w/2, ty+1);
    }

    /* --- 搜索提示 --- */
    if(R.search){
      const t=M.clamp(R.search.t/R._searchNeed(R.search.c),0,1), cw=180, cx=v.w/2-cw/2, cy=mob?v.h*0.52:(v.h-176);
      ctx.fillStyle="rgba(8,12,16,0.8)"; ctx.fillRect(cx,cy,cw,14);
      ctx.fillStyle="#8fd0ff"; ctx.fillRect(cx,cy,cw*t,14);
      ctx.textAlign="center"; ctx.font="11px system-ui,sans-serif"; ctx.fillStyle="#dbe8f2";
      ctx.fillText("搜索中…", v.w/2, cy-6);
    } else {
      // 靠近商店优先提示交易，其次才是搜箱
      // 提示文字加暗色底衬，避免与房间名重叠时读不清
      const hintAt=(txt, col, size)=>{
        ctx.font=`bold ${size||13}px system-ui,sans-serif`;
        const tw=ctx.measureText(txt).width;
        const ty=mob?v.h*0.6:(v.h-150)-18;
        ctx.fillStyle="rgba(6,10,14,0.72)";
        ctx.fillRect(v.w/2-tw/2-10, ty-14, tw+20, 21);
        ctx.textAlign="center"; ctx.fillStyle=col;
        ctx.fillText(txt, v.w/2, ty);
      };
      const it=R._interactTarget();
      if(it && it.kind==="shop"){
        const sh=it.ref;
        hintAt(Input.isTouch?"点「★」进入 "+sh.name:"按 E 进入 "+sh.name+" · "+sh.tag, sh.color, 14);
      } else if(it && it.kind==="gadget"){
        const gd=it.ref;
        const cdLeft=gd.kind==="siren" ? Math.max(0, Math.ceil(((gd.cdUntil||0)-M.now())/1000)) : 0;
        const used=cdLeft>0 || (gd.used && gd.kind!=="dam");
        const col = cdLeft>0 ? "#ffb44a"
                  : gd.kind==="med"?"#8fe07a":gd.kind==="ammo"?"#ffd36a"
                  : gd.kind==="siren"?"#ff8a5a":"#8fd0ff";
        hintAt(Input.isTouch
          ? (used?(cdLeft>0?`警报冷却 ${cdLeft} 秒`:"该设施已用完"):`点「★」使用 ${gd.label}`)
          : (used?(cdLeft>0?`警报冷却 ${cdLeft} 秒`:"该设施已用完"):`按 E 使用 ${gd.label}`),
          used&&!cdLeft?"#8a9aac":col, 14);
      } else if(it && it.kind==="container"){
        const c=it.ref;
        /* v0.24.0：只要这堆里有装备就显示对比面板，不局限于 ground 堆。
           开箱后因背包满留在原箱的几件（c.drops=rest、ground=false）旧版被排除，
           玩家走回来完全看不到对比 —— 正是本次要修的。面板内部找不到装备会直接 return。 */
        this._groundGunPanel(ctx, R, c, v, mob?v.h*0.6:(v.h-150)-18);
        if(c.ground){
          const n=(c.drops||[]).length;
          const tail=R._groundEquipItem(c)
            ? (Input.isTouch?" · 长按 ★ 替换手上":" · 按住 E 替换手上") : "";
          hintAt((Input.isTouch?`点「★」拾取地面物资 ×${n}`:`按 E 拾取地面物资 ×${n}`)+tail, "#ffe08a");
        } else if(c.locked && !c.searched){
          const lv=M.clamp(c.lockLv||1,1,5);
          const has=R._hasKeyFor(lv);
          hintAt(has
            ? `保险箱 · ${RAID_LOCK_NAME[lv]} · 按住 E 开锁（消耗 1 次钥匙）`
            : `保险箱 · ${RAID_LOCK_NAME[lv]} · 缺「${raidKeyDef(lv).name}」（商店有售 / 箱内掉落）`,
            has?"#8fe07a":"#ff8a5a");
        } else if(!c.searched){
          const tail=R._groundEquipItem(c)
            ? (Input.isTouch?" · 长按 ★ 替换":" · 按住 E 替换") : "";
          hintAt((Input.isTouch?"点「★」搜索补给 · 点「+」包扎":"按 E 搜索补给 · H 包扎")+tail, "#ffe08a");
        }
      }
    }

    /* --- v0.23.0：空投方位指示（2D / 3D 通用） ---
     * CFG.raidMinimap 默认是关的，空投不能只靠小地图标点（那等于没有）。
     * 这里用「相对朝向的方位 + 距离」画一个屏幕边缘的信标：
     *   2D —— 用相机投影，在视野内就落在真实位置，出屏就夹到边缘；
     *   3D —— 用 yaw 差角摆到准星周围一圈，不依赖世界投影（3D 下世界投影会算错）。
     * 两种情况都从屏幕中心连线画一个指向三角，方向语义一致。 */
    if(R.airdrops && R.airdrops.length){
      const is3=(typeof ViewMode!=="undefined" && ViewMode.is3D());
      const cx0=v.w*0.5, cy0=is3 ? v.h*0.55 : v.h*0.5;
      const mgx=mob?52:66, mgy=mob?86:78;
      const marks=[];
      for(const a of R.airdrops){
        const dd=M.dist(p.x,p.y,a.x,a.y);
        let sx, sy;
        if(is3){
          const rel=M.normAngle(Math.atan2(a.y-p.y, a.x-p.x) - (ViewMode.yaw||0));
          const rr=Math.min(v.w,v.h)*0.33;
          sx=cx0 + Math.sin(rel)*rr;
          sy=cy0 - Math.cos(rel)*rr;
        }else{
          sx=(a.x-R.camera.x)*(game.zoom||1);
          sy=(a.y-R.camera.y)*(game.zoom||1);
          sx=M.clamp(sx, mgx, v.w-mgx);
          sy=M.clamp(sy, mgy+72, v.h-mgy-48);
        }
        marks.push({ sx, sy, dd,
          label:"空投 "+a.name+(dd>=1000? " "+(dd/1000).toFixed(1)+"k":" "+Math.round(dd)) });
      }
      /* 方位相近的几个空投会落在同一片屏幕位置，标签会叠成一坨。
         按 y 排序后逐条下推：只要和上一条水平接近且垂直间隔不够，就往下让 19px。 */
      marks.sort((a,b)=>a.sy-b.sy);
      for(let i=1;i<marks.length;i++){
        const prev=marks[i-1], cur=marks[i];
        if(Math.abs(cur.sx-prev.sx)<86 && (cur.sy-prev.sy)<19) cur.sy=prev.sy+19;
      }
      for(const m of marks){
        const ang=Math.atan2(m.sy-cy0, m.sx-cx0);
        ctx.save();
        ctx.translate(m.sx, m.sy); ctx.rotate(ang);
        ctx.fillStyle="#ffd23f";
        ctx.beginPath(); ctx.moveTo(11,0); ctx.lineTo(-6,6.5); ctx.lineTo(-6,-6.5); ctx.closePath(); ctx.fill();
        ctx.restore();
        ctx.font=(mob?"bold 10px":"bold 11px")+" system-ui,sans-serif";
        ctx.textAlign="center";
        const tw=ctx.measureText(m.label).width;
        ctx.fillStyle="rgba(14,11,4,0.82)";
        ctx.fillRect(m.sx-tw/2-6, m.sy+11, tw+12, 16);
        ctx.fillStyle="#ffd23f";
        ctx.fillText(m.label, m.sx, m.sy+23);
      }
      ctx.textAlign="left";
    }

    /* --- 小地图 --- */
    if(CFG.raidMinimap) this.minimap(ctx, v);

    /* --- 触屏瞄准指示（仅 2D：3D 第一人称用屏幕中心准星，且此处用 2D 相机投影，
     *   在 3D 下会落到错误位置、变成「天空红圈」；3D 模式直接跳过）--- */
    if(Input.isTouch && R.aimTgt && R.aimTgt.alive && !(typeof ViewMode!=="undefined" && ViewMode.is3D())){
      const t=R.aimTgt;
      const sx=(t.x-R.camera.x)*(game.zoom||1), sy=(t.y-R.camera.y)*(game.zoom||1);
      ctx.strokeStyle="rgba(255,90,90,0.8)"; ctx.lineWidth=2;
      ctx.beginPath(); ctx.arc(sx,sy,18,0,6.28); ctx.stroke();
    }

    /* --- 3D 拾取提示（v0.21.4）---
     * 2D 的「+ 5.45×39 PS」是画在世界坐标里的，第一人称不铺那层变换 → 3D 下什么都看不到。
     * 这里把 Raid.toasts 按屏幕空间自下而上排一列，滑入 + 淡出，位置取准星正下方（原版「拾取物名」的位置）。 */
    if(typeof ViewMode!=="undefined" && ViewMode.is3D() && R.toasts && R.toasts.length){
      ctx.textAlign="center";
      const fs=mob?12:14;
      let ty=v.h-(mob?150:Math.max(118, Math.round(v.h*0.15)));
      for(let i=R.toasts.length-1;i>=0;i--){
        const t=R.toasts[i];
        const fade=Math.min(1, t.life/0.5);
        const rise=Math.min(1,(t.maxLife-t.life)/0.14)*12;
        ctx.font=`bold ${fs}px system-ui,sans-serif`;
        const tw=ctx.measureText(t.text).width;
        const bw=Math.min(tw+30, v.w-60), bh=fs+11;
        const bx=v.w/2-bw/2, by=ty-rise;
        ctx.globalAlpha=fade;
        ctx.fillStyle="rgba(8,12,16,0.88)";   // 底要够实，枪身 / 刀身从底下透上来会糊字
        ctx.beginPath();
        if(ctx.roundRect) ctx.roundRect(bx,by,bw,bh,6); else ctx.rect(bx,by,bw,bh);
        ctx.fill();
        ctx.strokeStyle="rgba(126,208,140,0.30)"; ctx.lineWidth=1;
        ctx.beginPath();
        if(ctx.roundRect) ctx.roundRect(bx,by,bw,bh,6); else ctx.rect(bx,by,bw,bh);
        ctx.stroke();
        ctx.fillStyle=t.color||"#dfe7f0";
        ctx.fillText(t.text, v.w/2, by+bh-6);
        ctx.globalAlpha=1;
        ty-=bh+5;
      }
    }

    /* --- 物品栏（Tab 开关）：现为 DOM 面板（#inv-layer），可逐件丢弃 --- */
  },

  /* 物品栏：携带武器 / 护甲 / 头盔 / 绷带 / 战利品 */
  drawInventory(ctx, v){
    const R=Raid, p=R.player;
    const mob=!!Input.isTouch;
    const w=Math.min(560, v.w-40), h=Math.min(mob?500:560, v.h-70);
    const x=(v.w-w)/2, y=(v.h-h)/2-(mob?32:0);

    ctx.fillStyle="rgba(4,7,10,0.86)";
    ctx.beginPath(); ctx.roundRect? ctx.roundRect(x,y,w,h,10) : ctx.rect(x,y,w,h); ctx.fill();
    ctx.strokeStyle="rgba(120,150,180,0.35)"; ctx.lineWidth=1; ctx.stroke();

    ctx.textAlign="left";
    ctx.fillStyle="#e8eef6"; ctx.font="bold 16px system-ui,sans-serif";
    ctx.fillText("物品栏", x+18, y+28);
    ctx.fillStyle="rgba(150,170,190,0.8)"; ctx.font="11px system-ui,sans-serif";
    ctx.fillText(mob?"点背包键关闭 · 撤离成功才带回仓库":"Tab 关闭 · 撤离成功才带回仓库", x+72, y+27);

    let ly=y+56;
    const line=(label,val,col,sub)=>{
      ctx.textAlign="left";
      ctx.fillStyle="rgba(150,170,190,0.85)"; ctx.font="11px system-ui,sans-serif";
      ctx.fillText(label, x+18, ly);
      ctx.fillStyle=col||"#dfe7f0"; ctx.font="13px system-ui,sans-serif";
      ctx.fillText(val, x+86, ly);
      if(sub){ ctx.fillStyle="rgba(140,160,180,0.75)"; ctx.font="10px system-ui,sans-serif";
        ctx.fillText(sub, x+86, ly+13); ly+=13; }
      ly+=21;
      if(ly>y+h-24){ ly=y+56; }
    };

    // 武器
    const icon=(g,gy)=>{
      const spec=gunModelSpec(g);
      const bodyC=(MANUFACTURERS[g.manufacturer]&&MANUFACTURERS[g.manufacturer].color)||"#3a3f47";
      const accC=(g.element!=="none"&&ELEMENTS[g.element])?ELEMENTS[g.element].color:"#aab2bd";
      ctx.save(); ctx.translate(x+w-40, gy-2); ctx.scale(0.62,0.62);
      drawGunCanvas(ctx, spec, 0.8, bodyC, accC); ctx.restore();
    };
    const guns=[p.gun, p.secondary].filter(Boolean);
    if(!guns.length){ line("主武器","（无）","#8b95a5"); }
    guns.forEach((g,i)=>{
      const gy=ly;
      const col=raidGunColor(g);
      const elem=g.element&&g.element!=="none"&&ELEMENTS[g.element]?(" · "+ELEMENTS[g.element].name):"";
      line(i===0?"主武器":"副武器", gunNameOf(g), col,
        `伤害 ${g.dmg} · 穿甲 ${Math.round((g.armorPen||0)*100)}% · 弹药 ${g.ammoMag}/${g.mag} · 背包 ${g.ammoRes} · ${g.loaded?(ammoDefFromId(g.loaded)||{}).short||"未装填":"未装填"}${elem}`);
      icon(g, gy);
    });
    if(guns.length){
      const bagN=(R._gunBag?R._gunBag():[]).length;   // 多枪 = 手持 + 副手 + 背包
      line("切换", "[Q] 循环 · [1~4] 直选", "#8fd0ff",
        `手持 ${p.gun?p.gun.name:"空手"} · 副手 ${p.secondary?p.secondary.name:"—"} · 背包 ${bagN} 把`);
    }
    // 护甲 / 头盔
    const ar=p.armorTier?RAID_ARMORS[p.armorTier]:null;
    line("护甲", ar?ar.name:"（未穿戴）", ar?(ARMOR_TIER_COLOR[p.armorTier]||"#dfe7f0"):"#8b95a5",
      ar?`T${p.armorTier} · 耐久 ${Math.round(p.armor)}/${Math.round(p.maxArmor)} · 减伤 ${Math.round(p.dr*100)}%${p.armorRegen?(' · 待维修 '+p.armorRegen+'/s'):''}`:"无防护");
    // v0.16.0：护盾装备三数值 + 破盾无敌 / 独特加成
    if(p.maxShield>0){
      const sg=p.shieldGear||null;
      const _ps=(sg&&sg.perks||[]).map(k=>(SHIELD_PERKS[k]?SHIELD_PERKS[k].name:k)).join(" · ")||"无";
      line("护盾", sg?sg.name:"（未装备）", "#4fd6ff",
        `容量 ${Math.round(p.shield)}/${Math.round(p.maxShield)} · 充能 ${p.shieldRate}/s · 延迟 ${p.shieldDelay}s${p.shieldInvuln>0?(' · 无敌 '+p.shieldInvuln.toFixed(1)+'s'):''}`);
      if(sg) line("护盾加成", _ps, "#8fd0ff", "破盾后短暂无敌 · 充能延迟 = 不受伤害多久后开始回盾");
    }
    // 防护类型与弹种终点效应：提示按当前数值表动态生成，不再写死倍率
    const _at=raidArmorType(p);
    const _hints=[];
    for(const k of ["fire","shock","corrosive","cryo","explosive","radiation"]){
      const E=ELEMENTS[k]; if(!E) continue;
      const m=elemMult(k,_at);
      if(m>=1.15) _hints.push(E.short+" ×"+m.toFixed(2));
      else if(m<=0.85) _hints.push(E.short+" ×"+m.toFixed(2));
    }
    line("防护类型", ARMOR_TYPE_NAME[_at]+(_at==="armor"?"（黄色血条）":""), ARMOR_TYPE_COLOR[_at],
      "当前弹种终点效应："+(_hints.length?_hints.join(" · "):"各弹种均在 ×0.85~1.15 之间"));
    // 身上的弹种终点效应状态（拟真命名）
    const _es=[];
    if((p.burnT||0)>0)    _es.push("引燃 "+p.burnT.toFixed(1)+"s");
    if((p.corrodeT||0)>0) _es.push("撕裂 "+p.corrodeT.toFixed(1)+"s");
    if((p.shockT||0)>0)   _es.push("失能 "+p.shockT.toFixed(1)+"s");
    if((p.freezeT||0)>0)  _es.push("迟滞 "+p.freezeT.toFixed(1)+"s");
    if(_es.length) line("弹种状态", _es.join(" · "), "#ff9a5a", "引燃持续掉血 · 撕裂降低防护 · 失能拉长开火间隔");
    const hm=p.helmetTier?RAID_HELMETS[p.helmetTier]:null;
    line("头盔", hm?hm.name:"（未佩戴）", hm?(ARMOR_TIER_COLOR[p.helmetTier]||"#dfe7f0"):"#8b95a5",
      hm?`T${p.helmetTier} · 耐久 ${Math.round(p.helmetArmor)}/${Math.round(p.maxHelmetArmor)} · 躯干减伤 ${Math.round(p.helmetDr*HELMET_BODY_SHARE*100)}% / 爆头 ${Math.round(p.helmetDr*100)}%`:"无减免");
    // 医疗 / 卢布（v0.19.0：只列实际拥有的医疗品，没有就明确写「无」）
    const ownedMed=R._medOwnedList();
    line("医疗", ownedMed.length ? ownedMed.map(m=>`${m.name} ×${m.n}`).join(" · ") : "（无 · 翻箱或到医疗站补给）",
      ownedMed.length?"#ff9a9a":"#8b95a5", "H 键 / 医疗键：流血自动止血，缺血自动回血；物品栏可逐件使用");
    line("卢布", "₽ "+R.creds, "#8fe07a", "撤离后结算进仓库");
    if((R.tokens||0)>0) line("GP 币", "◈ "+R.tokens, "#ffd23f", "黑市专用货币 · 撤离才落袋");

    // 物品栏汇总（含容量上限，超出将无法继续拾取）
    const cap = (label, n, capN, col) => {
      ctx.textAlign="left";
      ctx.fillStyle="rgba(150,170,190,0.85)"; ctx.font="11px system-ui,sans-serif";
      ctx.fillText(label, x+18, ly);
      ctx.fillStyle = n>=capN ? "#ff8a5a" : (col||"#dfe7f0"); ctx.font="bold 12px system-ui,sans-serif";
      ctx.fillText(`${n}/${capN}`, x+86, ly); ly+=18;
    };
    cap("背包武器", R.inv.weapons.length, RAID_INV_CAP.weapons);
    cap("护甲",     R.inv.armors.length, RAID_INV_CAP.armors);
    cap("头盔",     R.inv.helmets.length, RAID_INV_CAP.helmets);
    cap("护盾",     (R.inv.shields||[]).length, RAID_INV_CAP.shields, "#4fd6ff");
    cap("配件",     R.inv.parts.length, RAID_INV_CAP.parts, "#c9a13a");
    // 原材料（带品质颜色，撤离带回仓库可高价出售 / 用于合成与组装）
    cap("原材料",   R.inv.materials.length, RAID_INV_CAP.materials, "#ffd76a");
    for(const m of R.inv.materials.slice(0,4)){
      ctx.textAlign="left";
      ctx.fillStyle=m.color||"#dfe7f0"; ctx.font="10px system-ui,sans-serif";
      ctx.fillText(`· ${m.name} · ₽${priceText(m.value)}`, x+86, ly); ly+=13;
      if(ly>y+h-20) break;
    }
    // 改装模块 / 底材（改装模块现已并入配件栏，单独列出便于查看）
    const _cores=R.inv.parts.filter(p=>p.core);
    cap("改装模块",     _cores.length, RAID_INV_CAP.parts, "#8fd0ff");
    cap("底材",     R.inv.receivers.length, RAID_INV_CAP.receivers, "#8fd0ff");
    // 钥匙串：按等级显示剩余开锁次数
    const _keys=R.inv.keys||[];
    cap("钥匙",     _keys.length, RAID_INV_CAP.keys, "#ffd23f");
    for(const k of _keys.slice(0,3)){
      ctx.textAlign="left";
      ctx.fillStyle=k.color||"#dfe7f0"; ctx.font="10px system-ui,sans-serif";
      ctx.fillText(`· ${k.name} [${RAID_LOCK_NAME[k.lv]}] 剩 ${k.uses} 次`, x+86, ly); ly+=13;
      if(ly>y+h-20) break;
    }
    for(const c of _cores.slice(0,2)){
      ctx.textAlign="left";
      ctx.fillStyle=c.color||"#dfe7f0"; ctx.font="10px system-ui,sans-serif";
      ctx.fillText(`· ${c.name}`, x+86, ly); ly+=13;
      if(ly>y+h-20) break;
    }
    // 底部提示
    ctx.textAlign="left";
    ctx.fillStyle="rgba(120,140,160,0.7)"; ctx.font="10px system-ui,sans-serif";
    ctx.fillText("阵亡或超时未撤离将全部丢失", x+18, y+h-20);
  },

  minimap(ctx, v){
    const R=Raid;
    const mob=!!Input.isTouch;
    const mw=mob?104:160, mh=mob?88:134;
    const mx=v.w-mw-(mob?10:20), my=mob?110:(v.h-mh-20);
    ctx.fillStyle="rgba(6,10,14,0.8)"; ctx.fillRect(mx,my,mw,mh);
    ctx.strokeStyle="rgba(120,140,160,0.4)"; ctx.lineWidth=1; ctx.strokeRect(mx,my,mw,mh);
    const sx=mw/RAID_MAP_W, sy=mh/RAID_MAP_H;
    // 密林绿底 + 河流蓝带 + 铁路灰线，让小地图能一眼读出地貌
    if(R.forests){
      ctx.fillStyle="rgba(46,74,40,0.55)";
      for(const fz of R.forests){ ctx.fillRect(mx+fz.x*sx, my+fz.y*sy, Math.max(2,fz.w*sx), Math.max(2,fz.h*sy)); }
    }
    if(R.waterCircles){
      ctx.fillStyle="rgba(56,110,140,0.75)";
      for(let i=0;i<R.waterCircles.length;i+=2){
        const c=R.waterCircles[i];
        ctx.beginPath(); ctx.arc(mx+c.x*sx, my+c.y*sy, Math.max(1.2,c.r*sx), 0, 6.28); ctx.fill();
      }
    }
    if(R.reservoirRect && !R.damOpen){
      const rr=R.reservoirRect;
      ctx.fillStyle="rgba(56,110,140,0.75)";
      ctx.fillRect(mx+rr.x*sx, my+rr.y*sy, Math.max(2,rr.w*sx), Math.max(2,rr.h*sy));
    }
    // 桥梁（浅灰短横条，大桥更亮更粗）—— 小地图上能直接看出过河路线
    if(R.bridges){
      for(const b of R.bridges){
        ctx.fillStyle=b.big?"rgba(230,238,246,0.92)":"rgba(190,200,212,0.75)";
        ctx.fillRect(mx+(b.x-b.w/2)*sx, my+(b.y-b.h/2)*sy,
          Math.max(2,b.w*sx), Math.max(1.6,b.h*sy));
      }
    }
    if(R.rails){
      ctx.strokeStyle="rgba(170,180,190,0.55)"; ctx.lineWidth=1;
      for(const rl of R.rails){
        ctx.beginPath();
        for(let s=0;s<rl.pts.length;s++){ const p=rl.pts[s]; if(s===0) ctx.moveTo(mx+p[0]*sx, my+p[1]*sy); else ctx.lineTo(mx+p[0]*sx, my+p[1]*sy); }
        ctx.stroke();
      }
    }
    // 野外工棚：小地图上也给个淡点，方便判断哪片空地有掩体可绕
    ctx.fillStyle="rgba(120,140,150,0.22)";
    for(const sh of R.sheds){ ctx.fillRect(mx+sh.x*sx, my+sh.y*sy, Math.max(2,sh.w*sx), Math.max(2,sh.h*sy)); }
    for(const rm of R.roomRects){
      if(rm.extract){
        const e=R.extracts.find(z=>z.id===rm.id);
        ctx.fillStyle = (e&&e.closed) ? "rgba(120,130,135,0.55)" : "rgba(90,220,140,0.7)";
      } else ctx.fillStyle="rgba(150,170,190,0.35)";
      ctx.fillRect(mx+rm.x*sx, my+rm.y*sy, Math.max(2,rm.w*sx), Math.max(2,rm.h*sy));
    }
    /* v0.23.0：8 个核心 POI —— 淡金底 + 单字标识，一眼看出「哪片值得跑一趟」。
       单字而不是全名：小地图只有 160×134，写全名会糊成一团。 */
    ctx.font="9px ui-monospace,monospace"; ctx.textAlign="center";
    for(const poi of (typeof RAID_POI!=="undefined"?RAID_POI:[])){
      if(!poi.box) continue;
      ctx.fillStyle="rgba(255,210,80,0.18)";
      ctx.fillRect(mx+poi.box.x*sx, my+poi.box.y*sy,
        Math.max(3,poi.box.w*sx), Math.max(3,poi.box.h*sy));
      ctx.fillStyle="rgba(255,214,110,0.92)";
      ctx.fillText(poi.tag, mx+poi.cx*sx, my+poi.cy*sy+3);
    }
    ctx.textAlign="left";
    // 空投：亮黄方块，压在所有标识之上
    for(const a of (R.airdrops||[])){
      const ax2=mx+a.x*sx, ay2=my+a.y*sy;
      ctx.fillStyle="#ffd23f";
      ctx.fillRect(ax2-2.5, ay2-2.5, 5, 5);
    }

    // 商店（枪=金 / 材料=绿 / 回收=蓝 / 黑市=紫），一眼决定往哪跑
    for(const s of (R.shops||[])){
      ctx.fillStyle = s.kind==="black"?"#ffd23f":s.kind==="rec"?"#62c8ff":s.kind==="mat"?"#8fe07a":"#ffb44a";
      const px2=mx+s.x*sx, py2=my+s.y*sy;
      ctx.fillRect(px2-1.6, py2-1.6, 3.2, 3.2);
      ctx.strokeStyle="rgba(0,0,0,0.7)"; ctx.lineWidth=0.8; ctx.strokeRect(px2-1.6, py2-1.6, 3.2, 3.2);
    }
    // 可互动设施（医疗站=绿 / 弹药=黄 / 泄洪闸=蓝）
    for(const g of (R.gadgets||[])){
      ctx.fillStyle = g.kind==="med"?"#8fe07a":g.kind==="ammo"?"#ffd36a":g.kind==="siren"?"#ff8a5a":"#6fb6e8";
      const gx2=mx+g.x*sx, gy2=my+g.y*sy;
      ctx.fillRect(gx2-1.4, gy2-1.4, 2.8, 2.8);
    }
    for(const o of R.ops){
      if(!o.alive) continue;
      if(o.bounty){
        ctx.fillStyle="#ffd23f"; ctx.beginPath(); ctx.arc(mx+o.x*sx, my+o.y*sy, 4, 0, 6.28); ctx.fill();
      } else {
        ctx.fillStyle=o.isPlayer?"#4fd6ff":(o.remote?"#7ee08a":"#ff5a5a");
        ctx.beginPath(); ctx.arc(mx+o.x*sx, my+o.y*sy, (o.isPlayer||o.remote)?3.5:2.2, 0, 6.28); ctx.fill();
      }
    }
  },
};

// 小地图/提示用：视野内最近的可搜索箱（需视线可达）
Raid.nearestContainerVisible = function(){
  const p=this.player;
  const c=this._nearestContainer(p.x, p.y, 78);
  if(!c) return null;
  if(c.damLoot && !this.damOpen) return null;   // 水下保险箱：开闸前不提示
  if(!this._los(p.x,p.y,c.x,c.y)) return null;
  return c;
};

/* =========================================================================
 * UI — 塔科夫模式：仓库/配装、结算
 * ========================================================================= */
