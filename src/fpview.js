/* =========================================================================
 * fpview.js — 第一人称视图渲染器（纯 Canvas 2D 光线投射，零依赖）
 *
 *   不做第二套游戏逻辑：直接读 Raid 已有的 walls / props / roomRects /
 *   yards / roads / forests / waterCircles / reservoirRect / bridges /
 *   ops / containers / grounds / shops / extracts / gadgets / floodlights，
 *   把同一份 2D 世界数据投射成第一人称画面。
 *
 *   v0.19.0 起与 2D 场景逐层对齐：
 *     · 地面：分区底色（_hash2 网格）→ 密林 → 道路 → 水面 / 水库 → 桥 → 院子 → 房间
 *     · 墙体：取 2D 同款 #272d31 / 坝体冷灰，带板缝、上下沿、距离雾
 *     · 装饰：树 / 灌木 / 岩石 / 集装箱 / 卡车 / 木箱 / 油桶 / 沙袋 / 路障…
 *     · 光照：与 2D _lightLayer 同色温的暖光——玩家手电（560 射程）+ 静态探照灯
 *
 *   拾取、AI、伤害、撤离、联机快照在 2D / 3D 下完全一致，切换零状态迁移。
 * ========================================================================= */

const FPView = {
  FOV: Math.PI*0.40,     // 72° 水平视角（略宽于 60°，近距离墙体不再糊满屏）
  WALL_H: 168,           // 墙体世界高度
  EYE_H: 84,             // 视点离地高度
  MAX_D: 2600,           // 最远可见距离（同时是雾的终点）
  MIN_D: 22,             // 近裁剪：贴脸墙不参与求交，避免投影爆炸
  CELL: 256,             // 小地图 / 参照网格
  LIGHT_REACH: 560,      // 与 raid.js _lightLayer 的手电射程一致

  _zbuf: null,
  _cols: 0,
  _step: 3,
  _colors: null,

  /* 墙面色阶：0 = 最远（融进雾里），15 = 最近（2D 同款 #272d31） */
  _initColors(){
    if(this._colors) return;
    const haze = [26, 35, 41];
    const base = [[62, 70, 76], [44, 50, 56]];       // X 面 / Y 面（暗面）
    this._colors = [];
    for(let s=0;s<2;s++){
      const arr=[];
      for(let i=0;i<16;i++){
        const m = 0.26 + 0.74*(i/15);
        arr.push(`rgb(${Math.round(haze[0]+(base[s][0]-haze[0])*m)},${Math.round(haze[1]+(base[s][1]-haze[1])*m)},${Math.round(haze[2]+(base[s][2]-haze[2])*m)})`);
      }
      this._colors.push(arr);
    }
  },

  render(ctx, game, R){
    const p = R.player;
    const v = game.view, w = v.w, h = v.h;
    if(!p || w < 2 || h < 2) return;

    /* 开局 / 切维度时按「最开阔方向」定一次朝向，避免一睁眼糊在墙柱上 */
    if(typeof ViewMode !== "undefined" && ViewMode.ensureYaw) ViewMode.ensureYaw(R);

    this._initColors();
    const yaw = ViewMode.yaw;
    const ca = Math.cos(yaw), sa = Math.sin(yaw);
    const proj = (w/2) / Math.tan(this.FOV/2);
    const horizon = h*0.5;
    const step = w > 1100 ? 3 : 2;
    const n = Math.ceil(w/step);
    if(!this._zbuf || this._zbuf.length < n) this._zbuf = new Float32Array(n);
    this._cols = n;
    this._step = step;

    ctx.save();
    this._sky(ctx, w, h, horizon);
    this._floorBase(ctx, w, h, horizon, proj, p, R);
    const near = this._castWalls(ctx, R, p, w, h, horizon, proj, yaw, step, n);
    this._floorPatches(ctx, R, p, w, h, horizon, proj, yaw, step, n);
    this._floorFog(ctx, w, h, horizon);      // 地面距离雾：让贴片边缘融进远处，而不是一块块硬边
    this._floorGrid(ctx, w, h, horizon, proj, p);  // 网格压在雾上面，近处才看得见
    this._drawSprites(ctx, R, p, w, h, horizon, proj, yaw, ca, sa, step, n, near);
    this._lighting(ctx, R, p, w, h, horizon, proj, yaw, ca, sa);
    this._drawWeapon(ctx, R, w, h);
    this._crosshair(ctx, R, w, h);
    ctx.restore();

    /* 3D 下俯视小地图仍然有用（导航 / 找撤离点），复用 raid 自带实现。
     * 它挂在 RenderRaid 上（不是 Raid），默认画在右下角会被手持武器压住，
     * 这里传一个矮一点的 v 把它挪到屏幕右侧中段。 */
    if(ViewMode.minimap && typeof RenderRaid !== "undefined" && typeof RenderRaid.minimap === "function"){
      try{ RenderRaid.minimap(ctx, { w: v.w, h: Math.max(440, v.h*0.60) }); }catch(e){}
    }
  },

  /* ----------------------------- 天空 ----------------------------- */
  _sky(ctx, w, h, horizon){
    const sky = ctx.createLinearGradient(0, 0, 0, horizon);
    sky.addColorStop(0, "#070a0d");
    sky.addColorStop(0.65, "#111a20");
    sky.addColorStop(1, "#26313a");
    ctx.fillStyle = sky; ctx.fillRect(0, 0, w, horizon);

    // 地表反光把地平线托亮一点，避免上半屏死黑
    const haze = ctx.createLinearGradient(0, horizon-70, 0, horizon+6);
    haze.addColorStop(0, "rgba(38,49,58,0)");
    haze.addColorStop(1, "rgba(58,72,82,0.55)");
    ctx.fillStyle = haze; ctx.fillRect(0, horizon-70, w, 76);
  },

  /* 地面分区色：与 2D scene() 的 560px 网格同源（_hash2） */
  _zoneColor(R, x, y){
    const ZS = 560;
    let hv = 0.5;
    try{ if(typeof R._hash2 === "function") hv = R._hash2(Math.floor(x/ZS)*7+3, Math.floor(y/ZS)*11+5); }catch(e){}
    return hv < 0.32 ? "#14191b" : hv < 0.62 ? "#101618" : hv < 0.84 ? "#181a1c" : "#0c1012";
  },

  _floorBase(ctx, w, h, horizon, proj, p, R){
    const zone = this._zoneColor(R, p.x, p.y);
    const g = ctx.createLinearGradient(0, horizon, 0, h);
    g.addColorStop(0, "#0a0e11");
    g.addColorStop(0.30, "#0d1214");
    g.addColorStop(1, zone);
    ctx.fillStyle = g; ctx.fillRect(0, horizon, w, h-horizon);
  },

  /* 地面距离雾：以 horizon 为最远点做一层由「雾色」到透明的渐变，
   * 作用是把 _floorPatches 的硬边贴片压进远景，读起来才像地面而不是立着的色块。 */
  _floorFog(ctx, w, h, horizon){
    const g = ctx.createLinearGradient(0, horizon, 0, h);
    g.addColorStop(0, "rgba(20,27,32,0.92)");
    g.addColorStop(0.14, "rgba(19,25,30,0.62)");
    g.addColorStop(0.42, "rgba(16,21,25,0.22)");
    g.addColorStop(1, "rgba(14,18,21,0)");
    ctx.fillStyle = g; ctx.fillRect(0, horizon, w, h-horizon);
  },

  /* 160px 世界网格（与 2D 户外网格同间距），透视投影后只留近处几格 */
  _floorGrid(ctx, w, h, horizon, proj, p){
    const G = 160, yaw = ViewMode.yaw;
    const ca = Math.cos(yaw), sa = Math.sin(yaw);
    const span = 1500;
    ctx.strokeStyle = "rgba(122,164,112,0.11)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    const put = (wx, wy, move)=>{
      const rx = wx-p.x, ry = wy-p.y;
      const depth = rx*ca + ry*sa;
      if(depth < 60) return false;
      const lat = -rx*sa + ry*ca;
      const sx = w/2 + (lat/depth)*proj;
      const sy = horizon + (this.EYE_H/depth)*proj;
      if(sy > h+4) return false;
      if(move) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
      return true;
    };
    // 沿 X 方向的线（固定 world y）
    let gy0 = Math.floor((p.y-span)/G)*G;
    for(let gy=gy0; gy<=p.y+span; gy+=G){
      let open=false;
      for(let s=-8; s<=8; s++){
        const ok = put(p.x + s*(span/8), gy, !open);
        open = ok || open;
      }
    }
    // 沿 Y 方向的线（固定 world x）
    let gx0 = Math.floor((p.x-span)/G)*G;
    for(let gx=gx0; gx<=p.x+span; gx+=G){
      let open=false;
      for(let s=-8; s<=8; s++){
        const ok = put(gx, p.y + s*(span/8), !open);
        open = ok || open;
      }
    }
    ctx.stroke();
  },

  /* ----------------------------- 墙 ----------------------------- */
  _castWalls(ctx, R, p, w, h, horizon, proj, yaw, step, n){
    const src = R.walls || [];
    let pool = (typeof R._nearWalls === "function") ? R._nearWalls(p.x, p.y, this.MAX_D) : src;
    const near = [];
    for(let i=0;i<pool.length;i++){
      const wl = pool[i];
      // 站在墙里（出生点容差 / 贴墙滑行）时忽略这一面，否则整屏糊死
      if(p.x >= wl.x-0.5 && p.x <= wl.x+wl.w+0.5 && p.y >= wl.y-0.5 && p.y <= wl.y+wl.h+0.5) continue;
      const cx = wl.x + wl.w/2, cy = wl.y + wl.h/2;
      if(Math.abs(cx-p.x) > this.MAX_D + wl.w/2) continue;
      if(Math.abs(cy-p.y) > this.MAX_D + wl.h/2) continue;
      near.push(wl);
    }
    const MAX = this.MAX_D, MIND = this.MIN_D;

    for(let c=0; c<n; c++){
      const sx = c*step;
      const a = yaw + Math.atan((sx + step*0.5 - w/2)/proj);
      const dx = Math.cos(a), dy = Math.sin(a);
      const adx = Math.abs(dx) < 1e-9, ady = Math.abs(dy) < 1e-9;
      let best = MAX, side = 0, hit = null;

      for(let i=0;i<near.length;i++){
        const wl = near[i];
        let tmin = MIND, tmax = best, sd = 0;
        if(adx){ if(p.x < wl.x || p.x > wl.x+wl.w) continue; }
        else {
          let t1 = (wl.x-p.x)/dx, t2 = (wl.x+wl.w-p.x)/dx;
          if(t1 > t2){ const t=t1; t1=t2; t2=t; }
          if(t1 > tmin){ tmin=t1; sd=0; }
          if(t2 < tmax) tmax=t2;
          if(tmin > tmax) continue;
        }
        if(ady){ if(p.y < wl.y || p.y > wl.y+wl.h) continue; }
        else {
          let t1 = (wl.y-p.y)/dy, t2 = (wl.y+wl.h-p.y)/dy;
          if(t1 > t2){ const t=t1; t1=t2; t2=t; }
          if(t1 > tmin){ tmin=t1; sd=1; }
          if(t2 < tmax) tmax=t2;
          if(tmin > tmax) continue;
        }
        if(tmin < best){ best=tmin; side=sd; hit=wl; }
      }

      this._zbuf[c] = best;
      if(!hit) continue;

      const perp = Math.max(MIND, best*Math.cos(a-yaw));
      const yTop = horizon - ((this.WALL_H-this.EYE_H)/perp)*proj;
      const yBot = horizon + (this.EYE_H/perp)*proj;
      const hh = yBot-yTop;
      const fog = Math.max(0, 1-perp/MAX);
      const lvl = Math.max(0, Math.min(15, Math.round(fog*15)));

      ctx.fillStyle = this._colors[side][lvl];
      ctx.fillRect(sx, yTop, step+1, hh);

      // 坝体：2D 里的混凝土冷灰 + 水痕，3D 里用冷色叠加区分
      if(hit.dam || hit.kind === "cell"){
        ctx.fillStyle = `rgba(92,120,140,${0.12+0.20*fog})`;
        ctx.fillRect(sx, yTop, step+1, hh);
      }

      // 竖向板缝：命中点沿墙边的位置决定，给墙面一个真实尺度
      const hx = p.x+dx*best, hy = p.y+dy*best;
      const u = side===0
        ? (hy-hit.y)/Math.max(1, hit.h)
        : (hx-hit.x)/Math.max(1, hit.w);
      const panels = Math.max(1, Math.round((side===0?hit.h:hit.w)/170));
      if(((u*panels)%1) < 0.05 && perp < 1500){
        ctx.fillStyle = `rgba(0,0,0,${0.34*fog})`;
        ctx.fillRect(sx, yTop, step+1, hh);
      }

      /* 水平砖缝 / 墙裙：把 y 轴线性映射到墙体世界高度，近距离也不会退化成一块灰板 */
      if(hh > 18){
        for(let b=1;b<=3;b++){
          const yy = yBot - hh*(b/4);
          if(yy <= 0 || yy >= h) continue;
          ctx.fillStyle = `rgba(0,0,0,${0.20*fog})`;
          ctx.fillRect(sx, yy, step+1, Math.max(1, hh*0.012));
          ctx.fillStyle = `rgba(210,220,226,${0.05*fog})`;
          ctx.fillRect(sx, yy+Math.max(1,hh*0.012), step+1, Math.max(1, hh*0.006));
        }
        // 墙裙（底部 12% 压暗，让墙脚落地）
        const yb = yBot - hh*0.12;
        if(yb > 0 && yb < h){
          ctx.fillStyle = `rgba(0,0,0,${0.26*fog})`;
          ctx.fillRect(sx, yb, step+1, Math.min(hh*0.12, h-yb));
        }
      }
      // 顶沿高光（2D 的 rgba(170,195,205,0.16) 顶边）
      if(yTop > -hh && yTop < h){
        ctx.fillStyle = `rgba(170,195,205,${0.22*fog})`;
        ctx.fillRect(sx, Math.max(0,yTop), step+1, Math.max(1, hh*0.014));
      }
    }
    return near;
  },

  /* ----------------------------- 地面贴片（道路 / 河 / 院子 / 房间） ----------------------------- */
  _patchList(R){
    const out = [];
    const addRect = (x,y,w2,h2,color,alpha)=> out.push({ t:"r", x, y, w:w2, h:h2, color, alpha });
    const addCircle = (x,y,r,color,alpha)=> out.push({ t:"c", x, y, r, color, alpha });

    // 与 2D 绘制顺序一致：密林 → 道路 → 水面 / 水库 → 桥 → 院子 → 房间
    for(const fz of (R.forests||[])) addRect(fz.x, fz.y, fz.w, fz.h, "#1e2c1a", 0.55);
    for(const rd of (R.roads||[])) addRect(rd.x, rd.y, rd.w, rd.h, "#34322b", 0.62);
    for(const c of (R.waterCircles||[])) addCircle(c.x, c.y, c.r, "#142632", 0.96);
    if(R.reservoirRect && !R.damOpen){
      const rr=R.reservoirRect; addRect(rr.x, rr.y, rr.w, rr.h, "#142632", 0.97);
    }
    for(const b of (R.bridges||[])) addRect(b.x-b.w/2, b.y-b.h/2, b.w, b.h, b.big?"#2b3036":"#25282c", 1);
    for(const yd of (R.yards||[])) addRect(yd.x, yd.y, yd.w, yd.h, yd.tint || "#2a2f2c", 0.62);
    for(const rm of (R.roomRects||[])) addRect(rm.x, rm.y, rm.w, rm.h, rm.extract ? "#25452f" : (rm.tint || "#2a2f2c"), 0.95);
    return out;
  },

  _floorPatches(ctx, R, p, w, h, horizon, proj, yaw, step, n){
    const list = this._patchList(R);
    const MAX = this.MAX_D, MIND = this.MIN_D;

    for(const pt of list){
      let cx, cy, rad;
      if(pt.t === "r"){ cx = pt.x+pt.w/2; cy = pt.y+pt.h/2; rad = Math.hypot(pt.w, pt.h)/2; }
      else { cx = pt.x; cy = pt.y; rad = pt.r; }

      const dx0 = cx-p.x, dy0 = cy-p.y;
      const dist = Math.hypot(dx0, dy0);
      if(dist - rad > MAX) continue;
      const ac = Math.atan2(dy0, dx0);
      const half = dist <= rad ? Math.PI : Math.atan2(rad, Math.max(1, dist-rad));
      if(half < 0.02) continue;

      ctx.fillStyle = pt.color;
      ctx.globalAlpha = pt.alpha;

      for(let c=0; c<n; c++){
        const sx = c*step;
        const a = yaw + Math.atan((sx + step*0.5 - w/2)/proj);
        // 角度粗筛：不在贴片角宽内直接跳过（省掉绝大多数求交）
        let da = a - ac;
        while(da > Math.PI) da -= Math.PI*2;
        while(da < -Math.PI) da += Math.PI*2;
        if(Math.abs(da) > half + 0.06) continue;

        const dx = Math.cos(a), dy = Math.sin(a);
        let t0, t1;
        if(pt.t === "r"){
          let tmin = 0, tmax = MAX;
          if(Math.abs(dx) < 1e-9){ if(p.x < pt.x || p.x > pt.x+pt.w) continue; }
          else {
            let a1 = (pt.x-p.x)/dx, a2 = (pt.x+pt.w-p.x)/dx;
            if(a1 > a2){ const t=a1; a1=a2; a2=t; }
            if(a1 > tmin) tmin = a1;
            if(a2 < tmax) tmax = a2;
            if(tmin > tmax) continue;
          }
          if(Math.abs(dy) < 1e-9){ if(p.y < pt.y || p.y > pt.y+pt.h) continue; }
          else {
            let b1 = (pt.y-p.y)/dy, b2 = (pt.y+pt.h-p.y)/dy;
            if(b1 > b2){ const t=b1; b1=b2; b2=t; }
            if(b1 > tmin) tmin = b1;
            if(b2 < tmax) tmax = b2;
            if(tmin > tmax) continue;
          }
          t0 = Math.max(0, tmin); t1 = Math.min(MAX, tmax);
        } else {
          const ox = p.x-pt.x, oy = p.y-pt.y;
          const b = ox*dx + oy*dy;
          const cq = ox*ox + oy*oy - pt.r*pt.r;
          const disc = b*b - cq;
          if(disc < 0) continue;
          const sq = Math.sqrt(disc);
          t0 = Math.max(0, -b - sq);
          t1 = Math.min(MAX, -b + sq);
        }
        if(t1 <= t0) continue;

        // 被墙挡住的部分不要
        const wallD = this._zbuf[c];
        const nearD = Math.max(t0, 6);
        const farD = Math.min(t1, wallD);
        if(farD <= nearD) continue;

        const yFar = horizon + (this.EYE_H/Math.max(MIND, farD))*proj;
        const yNear = horizon + (this.EYE_H/Math.max(MIND, nearD))*proj;
        const y0 = Math.max(horizon, Math.min(h, yFar));
        const y1 = Math.max(horizon, Math.min(h+2, yNear));
        if(y1 - y0 < 0.6) continue;
        ctx.fillRect(sx, y0, step+1, y1-y0);
      }
      ctx.globalAlpha = 1;
    }
  },

  /* ----------------------------- 精灵（单位 / 箱子 / 掩体 / 设施 / 探照灯） ----------------------------- */
  _propHeight(q){
    const k = q.kind || "";
    const base = {
      tree:270, bush:64, rock:78, container:135, truck:180, crate:88, barrel:82,
      sandbag:54, barrier:74, pipe:74, shelf:100, table:64, machine:96, wall:120,
    }[k];
    if(base) return base * (k==="tree" ? (0.85 + Math.min(0.5, (q.w||40)/120)) : 1);
    return Math.max(50, Math.min(160, Math.max(q.w||40, q.h||40)*1.1));
  },

  _drawSprites(ctx, R, p, w, h, horizon, proj, yaw, ca, sa, step, n, near){
    const list = [];
    const add = (x,y,kind,obj,hh,label,color)=>{ list.push({x,y,kind,obj,hh,label,color}); };

    for(const o of (R.ops||[])){
      if(o.isPlayer || (o.hp!==undefined && o.hp<=0)) continue;
      const col = o.remote ? "#7ee08a"
                : o.bounty ? "#d8b04a"
                : (o.shield>0) ? "#6fb6d6"
                : (o.cls === "scav") ? "#c0705a" : "#88a078";
      add(o.x, o.y, "unit", o, 168, o.name||"", col);
    }
    for(const c of (R.containers||[])){
      add(c.x, c.y, "box", c, 76, c.locked?"上锁箱":"物资箱", c.searched?"#5d5a50":"#a2895c");
    }
    for(const g of (R.grounds||[])){
      add(g.x, g.y, "ground", g, 34, "", "#e2c46a");
    }
    for(const s of (R.shops||[])){
      add(s.x, s.y, "shop", s, 124, s.name || s.label || "摊位", "#c8a86a");
    }
    for(const e of (R.extracts||[])){
      add(e.x+e.w/2, e.y+e.h/2, "extract", e, 210, "撤离点", "#7fd6a0");
    }
    for(const g of (R.gadgets||[])){
      add(g.x, g.y, "gadget", g, 96, g.label||"设施", "#7fa8c0");
    }
    for(const f of (R.floodlights||[])){
      add(f.x, f.y, "light", f, 150, "", "#ffe4a0");
    }
    // 掩体：与 2D 相同的种类，按种类给不同高度与外观
    for(const q of (R.props||[])){
      add(q.x+q.w/2, q.y+q.h/2, "prop", q, this._propHeight(q), "", q.fill||"#6e6552");
    }

    const projList = [];
    for(const s of list){
      const rx = s.x-p.x, ry = s.y-p.y;
      const depth = rx*ca + ry*sa;
      /* 近裁剪：贴脸的箱子 / 掩体投出来动辄三四千像素，会把整屏糊成一块色板；
       * 单位放宽一点（近战单位还要看得见），其余按 0.9m 级别切掉。 */
      const nearClip = s.kind === "unit" ? 40 : 74;
      if(depth < nearClip || depth > this.MAX_D) continue;
      const lateral = -rx*sa + ry*ca;
      const sx = w/2 + (lateral/depth)*proj;
      const size = (s.hh/depth)*proj;
      if(sx + size < -40 || sx - size > w+40) continue;
      projList.push({s, depth, sx, size, footY: horizon + (this.EYE_H/depth)*proj});
    }
    projList.sort((a,b)=> b.depth - a.depth);   // 远 → 近

    for(const it of projList){
      const {s, depth, sx, size} = it;
      if(size < 0.8) continue;
      const half = Math.max(2, size*0.42);
      const c0 = Math.max(0, Math.floor((sx-half)/step));
      const c1 = Math.min(n-1, Math.ceil((sx+half)/step));
      let seg = -1;
      for(let c=c0; c<=c1+1; c++){
        const vis = c<=c1 && this._zbuf[c] > depth;
        if(vis && seg<0) seg=c;
        if(!vis && seg>=0){
          ctx.save();
          ctx.beginPath(); ctx.rect(seg*step, 0, (c-seg)*step, h); ctx.clip();
          this._sprite(ctx, s, sx, it.footY, size, depth);
          ctx.restore();
          seg=-1;
        }
      }
    }
  },

  _sprite(ctx, s, cx, foot, size, depth){
    const fog = Math.max(0.16, 1-depth/this.MAX_D);
    ctx.globalAlpha = fog;
    const k = size;

    if(s.kind === "unit"){
      const bw = k*0.38;
      ctx.fillStyle = "rgba(0,0,0,0.38)";
      ctx.beginPath(); ctx.ellipse(cx, foot, bw*0.62, k*0.045, 0, 0, 6.2832); ctx.fill();
      ctx.fillStyle = "#252b2b";
      ctx.fillRect(cx-bw*0.40, foot-k*0.30, bw*0.28, k*0.30);
      ctx.fillRect(cx+bw*0.12, foot-k*0.30, bw*0.28, k*0.30);
      ctx.fillStyle = s.color;
      ctx.fillRect(cx-bw/2, foot-k*0.72, bw, k*0.44);
      ctx.fillStyle = "rgba(0,0,0,0.28)";
      ctx.fillRect(cx-bw/2, foot-k*0.52, bw, k*0.10);
      ctx.fillStyle = "#b6a58c";
      ctx.beginPath(); ctx.arc(cx, foot-k*0.80, bw*0.23, 0, 6.2832); ctx.fill();
      ctx.fillStyle = "#3b4238";
      ctx.fillRect(cx-bw*0.25, foot-k*0.86, bw*0.50, k*0.045);
      if(s.obj && s.obj.shield > 0){
        ctx.strokeStyle = "rgba(105,190,230,0.75)"; ctx.lineWidth = Math.max(1,k*0.012);
        ctx.strokeRect(cx-bw*0.62, foot-k*0.90, bw*1.24, k*0.90);
      }
      const o = s.obj||{};
      if(o.maxHP){
        const bw2 = bw*1.15, ratio = Math.max(0, Math.min(1, (o.hp||0)/o.maxHP));
        ctx.fillStyle = "rgba(0,0,0,0.65)"; ctx.fillRect(cx-bw2/2, foot-k*0.97, bw2, Math.max(2,k*0.026));
        ctx.fillStyle = o.bounty ? "#d8b04a" : "#c85a4a";
        ctx.fillRect(cx-bw2/2, foot-k*0.97, bw2*ratio, Math.max(2,k*0.026));
      }
      if(depth < 620 && s.label){
        ctx.fillStyle = "rgba(230,235,230,0.85)";
        ctx.textAlign = "center"; ctx.font = `${Math.max(9, Math.min(16, k*0.10))}px system-ui,sans-serif`;
        ctx.fillText(String(s.label).slice(0,12), cx, foot-k*1.02);
      }
    } else if(s.kind === "box"){
      const bw = k*1.25, bh = k;
      ctx.fillStyle = s.color; ctx.fillRect(cx-bw/2, foot-bh, bw, bh);
      ctx.strokeStyle = "rgba(20,20,18,0.85)"; ctx.lineWidth = Math.max(1,k*0.045);
      ctx.strokeRect(cx-bw/2, foot-bh, bw, bh);
      ctx.beginPath(); ctx.moveTo(cx-bw/2, foot-bh); ctx.lineTo(cx+bw/2, foot); ctx.stroke();
      ctx.fillStyle = s.obj && s.obj.locked ? "#e0c060" : "rgba(230,220,190,0.55)";
      ctx.fillRect(cx-k*0.09, foot-bh*0.58, k*0.18, k*0.18);
    } else if(s.kind === "ground"){
      ctx.fillStyle = "rgba(226,196,106,0.35)";
      ctx.beginPath(); ctx.arc(cx, foot-k*0.3, k*1.1, 0, 6.2832); ctx.fill();
      ctx.fillStyle = "#e2c46a";
      ctx.beginPath(); ctx.moveTo(cx, foot-k*0.9); ctx.lineTo(cx+k*0.5, foot-k*0.35);
      ctx.lineTo(cx, foot); ctx.lineTo(cx-k*0.5, foot-k*0.35); ctx.closePath(); ctx.fill();
    } else if(s.kind === "shop"){
      const bw = k*1.6, bh = k*0.78;
      ctx.fillStyle = "rgba(18,22,24,0.88)"; ctx.fillRect(cx-bw/2, foot-k, bw, bh);
      ctx.strokeStyle = "#c8a86a"; ctx.lineWidth = Math.max(1,k*0.035);
      ctx.strokeRect(cx-bw/2, foot-k, bw, bh);
      ctx.fillStyle = "#c8a86a"; ctx.textAlign = "center";
      ctx.font = `bold ${Math.max(9, Math.min(18, k*0.19))}px system-ui,sans-serif`;
      ctx.fillText(String(s.label||"摊位").slice(0,6), cx, foot-k*0.55);
      ctx.fillStyle = "rgba(90,84,70,0.9)"; ctx.fillRect(cx-bw*0.42, foot-k*0.22, bw*0.84, k*0.22);
    } else if(s.kind === "extract"){
      ctx.fillStyle = "rgba(80,200,130,0.16)"; ctx.fillRect(cx-k*0.5, foot-k, k, k);
      ctx.strokeStyle = "rgba(120,230,165,0.8)"; ctx.lineWidth = Math.max(1,k*0.02);
      ctx.strokeRect(cx-k*0.5, foot-k, k, k);
      ctx.fillStyle = "#9ce8b8"; ctx.textAlign = "center";
      ctx.font = `bold ${Math.max(10, Math.min(20, k*0.11))}px system-ui,sans-serif`;
      ctx.fillText("撤 离", cx, foot-k*0.48);
    } else if(s.kind === "gadget"){
      ctx.fillStyle = "rgba(20,28,32,0.85)";
      ctx.beginPath(); ctx.arc(cx, foot-k*0.5, k*0.42, 0, 6.2832); ctx.fill();
      ctx.strokeStyle = s.color; ctx.lineWidth = Math.max(1,k*0.04);
      ctx.stroke();
      if(depth < 700 && s.label){
        ctx.fillStyle = "rgba(200,225,235,0.9)"; ctx.textAlign="center";
        ctx.font = `${Math.max(9, Math.min(15, k*0.15))}px system-ui,sans-serif`;
        ctx.fillText(String(s.label).slice(0,6), cx, foot-k*1.05);
      }
    } else if(s.kind === "light"){
      // 探照灯：灯杆 + 暖色光晕（与 2D _lightLayer 的暖光同色）
      const r = Math.max(8, k*0.55);
      const glow = ctx.createRadialGradient(cx, foot-k*0.55, 0, cx, foot-k*0.55, r);
      glow.addColorStop(0, "rgba(255,228,160,0.42)");
      glow.addColorStop(0.55, "rgba(255,210,140,0.14)");
      glow.addColorStop(1, "rgba(255,210,140,0)");
      ctx.fillStyle = glow;
      ctx.beginPath(); ctx.arc(cx, foot-k*0.55, r, 0, 6.2832); ctx.fill();
      ctx.fillStyle = "#2b3336"; ctx.fillRect(cx-Math.max(1,k*0.03), foot-k*0.62, Math.max(2,k*0.06), k*0.62);
      ctx.fillStyle = "#ffe9b8"; ctx.beginPath(); ctx.arc(cx, foot-k*0.72, Math.max(2,k*0.09), 0, 6.2832); ctx.fill();
    } else if(s.kind === "prop"){
      this._propSprite(ctx, s, cx, foot, size);
    }
    ctx.globalAlpha = 1;
  },

  /* 掩体外观：与 2D prop() 同种类、同配色（树 / 灌木 / 岩石 / 集装箱 / 卡车 / 木箱 / 油桶…） */
  _propSprite(ctx, s, cx, foot, k){
    const q = s.obj || {}, kind = q.kind || "";
    const fill = q.fill || "#6e6552", edge = q.edge || "rgba(0,0,0,0.55)";

    // 统一投影（圆物用椭圆，方物用矩形）
    ctx.fillStyle = "rgba(0,0,0,0.30)";
    if(kind==="tree"||kind==="bush"||kind==="rock"){
      ctx.beginPath(); ctx.ellipse(cx, foot, k*0.36, k*0.055, 0, 0, 6.2832); ctx.fill();
    } else {
      ctx.fillRect(cx-k*0.45, foot-k*0.05, k*0.9, k*0.07);
    }

    if(kind === "tree"){
      const trunkW = Math.max(2, k*0.10), trunkH = k*0.46;
      ctx.fillStyle = "#3a2f22"; ctx.fillRect(cx-trunkW/2, foot-trunkH, trunkW, trunkH);
      ctx.fillStyle = "rgba(24,40,22,0.96)";
      ctx.beginPath(); ctx.ellipse(cx, foot-k*0.70, k*0.34, k*0.30, 0, 0, 6.2832); ctx.fill();
      ctx.fillStyle = fill;
      ctx.beginPath(); ctx.ellipse(cx-k*0.10, foot-k*0.80, k*0.26, k*0.22, 0.3, 0, 6.2832); ctx.fill();
      ctx.beginPath(); ctx.ellipse(cx+k*0.12, foot-k*0.64, k*0.24, k*0.20, -0.2, 0, 6.2832); ctx.fill();
      ctx.fillStyle = "rgba(140,190,120,0.14)";
      ctx.beginPath(); ctx.ellipse(cx-k*0.04, foot-k*0.88, k*0.14, k*0.09, 0, 0, 6.2832); ctx.fill();
    } else if(kind === "bush"){
      ctx.fillStyle = "rgba(28,46,26,0.95)";
      ctx.beginPath(); ctx.ellipse(cx, foot-k*0.34, k*0.46, k*0.34, 0, 0, 6.2832); ctx.fill();
      ctx.fillStyle = fill;
      ctx.beginPath(); ctx.ellipse(cx-k*0.12, foot-k*0.40, k*0.30, k*0.24, 0.3, 0, 6.2832); ctx.fill();
      ctx.beginPath(); ctx.ellipse(cx+k*0.14, foot-k*0.30, k*0.28, k*0.22, -0.2, 0, 6.2832); ctx.fill();
    } else if(kind === "rock"){
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.moveTo(cx-k*0.44, foot-k*0.44);
      ctx.lineTo(cx-k*0.24, foot-k*0.92);
      ctx.lineTo(cx+k*0.16, foot-k*0.98);
      ctx.lineTo(cx+k*0.44, foot-k*0.58);
      ctx.lineTo(cx+k*0.34, foot-k*0.06);
      ctx.lineTo(cx-k*0.14, foot);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = "rgba(180,190,170,0.16)";
      ctx.beginPath();
      ctx.moveTo(cx-k*0.24, foot-k*0.92); ctx.lineTo(cx+k*0.16, foot-k*0.98);
      ctx.lineTo(cx+k*0.10, foot-k*0.62); ctx.lineTo(cx-k*0.26, foot-k*0.56);
      ctx.closePath(); ctx.fill();
    } else if(kind === "barrel"){
      const bw = k*0.62, bh = k*0.94;
      ctx.fillStyle = fill;
      ctx.fillRect(cx-bw/2, foot-bh, bw, bh);
      ctx.beginPath(); ctx.ellipse(cx, foot-bh, bw/2, k*0.07, 0, 0, 6.2832); ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,0.5)"; ctx.lineWidth = Math.max(1,k*0.03);
      ctx.strokeRect(cx-bw/2, foot-bh, bw, bh);
      ctx.beginPath(); ctx.moveTo(cx-bw/2, foot-bh*0.66); ctx.lineTo(cx+bw/2, foot-bh*0.66);
      ctx.moveTo(cx-bw/2, foot-bh*0.34); ctx.lineTo(cx+bw/2, foot-bh*0.34); ctx.stroke();
    } else if(kind === "container" || kind === "truck" || kind === "crate" || kind === "shelf" || kind === "table" || kind === "machine"){
      const bw = k*(kind==="container"?1.25:kind==="truck"?1.5:0.95);
      const bh = k*(kind==="container"?0.85:kind==="truck"?0.95:0.9);
      ctx.fillStyle = fill; ctx.fillRect(cx-bw/2, foot-bh, bw, bh);
      ctx.strokeStyle = edge; ctx.lineWidth = Math.max(1,k*0.028);
      ctx.strokeRect(cx-bw/2, foot-bh, bw, bh);
      ctx.strokeStyle = "rgba(0,0,0,0.22)"; ctx.lineWidth = 1;
      ctx.beginPath();
      for(let i=1;i<4;i++){ const xx=cx-bw/2+bw*i/4; ctx.moveTo(xx, foot-bh+2); ctx.lineTo(xx, foot-2); }
      ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,0.08)";
      ctx.fillRect(cx-bw/2+1, foot-bh+1, bw-2, Math.max(1,k*0.03));
      if(kind==="truck"){
        ctx.fillStyle = "#171512";
        ctx.fillRect(cx-bw*0.42, foot-k*0.10, bw*0.18, k*0.16);
        ctx.fillRect(cx+bw*0.22, foot-k*0.10, bw*0.18, k*0.16);
        ctx.fillStyle = "rgba(150,190,210,0.16)";
        ctx.fillRect(cx-bw*0.46, foot-bh+k*0.10, bw*0.42, bh*0.34);
      }
    } else if(kind === "sandbag"){
      const bw = k*1.1, bh = k*0.46;
      ctx.fillStyle = fill;
      for(let i=0;i<3;i++){
        ctx.beginPath();
        ctx.ellipse(cx-bw/3+bw*i/3, foot-bh*0.6, bw*0.20, bh*0.52, 0, 0, 6.2832);
        ctx.fill();
      }
      ctx.strokeStyle = "rgba(0,0,0,0.28)"; ctx.lineWidth = 1;
      for(let i=0;i<3;i++){
        ctx.beginPath(); ctx.ellipse(cx-bw/3+bw*i/3, foot-bh*0.6, bw*0.20, bh*0.52, 0, 0, 6.2832); ctx.stroke();
      }
    } else if(kind === "barrier"){
      const bw = k*1.1, bh = k*0.62;
      ctx.fillStyle = fill; ctx.fillRect(cx-bw/2, foot-bh, bw, bh);
      ctx.strokeStyle = edge; ctx.lineWidth = 1; ctx.strokeRect(cx-bw/2, foot-bh, bw, bh);
      ctx.fillStyle = "rgba(196,164,58,0.55)";
      for(let i=0;i<5;i++){
        ctx.beginPath();
        const x0 = cx-bw/2 + i*bw/5;
        ctx.moveTo(x0, foot); ctx.lineTo(x0+bw/10, foot-bh);
        ctx.lineTo(x0+bw/10+4, foot-bh); ctx.lineTo(x0+4, foot);
        ctx.closePath(); ctx.fill();
      }
    } else {
      const bw = k*0.95, bh = k*0.85;
      ctx.fillStyle = fill; ctx.fillRect(cx-bw/2, foot-bh, bw, bh);
      ctx.strokeStyle = edge; ctx.lineWidth = Math.max(1,k*0.03);
      ctx.strokeRect(cx-bw/2, foot-bh, bw, bh);
    }
  },

  /* ----------------------------- 光照（与 2D 暖光层对齐） ----------------------------- */
  _lighting(ctx, R, p, w, h, horizon, proj, yaw, ca, sa){
    /* 1) 夜视暗角：2D 里视野边缘本来就比手电锥暗，第一人称用暗角还原这个层次，
     *    否则整屏一层平光，墙和地分不开。 */
    const cx = w*0.5, cy = h*0.55;
    const vig = ctx.createRadialGradient(cx, cy, Math.min(w,h)*0.18, cx, cy, Math.max(w,h)*0.78);
    vig.addColorStop(0, "rgba(5,8,10,0)");
    vig.addColorStop(0.55, "rgba(5,8,10,0.26)");
    vig.addColorStop(1, "rgba(4,7,9,0.68)");
    ctx.fillStyle = vig; ctx.fillRect(0, 0, w, h);

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    // 2) 玩家手电：2D 是 560 射程 ±0.42rad 的暖色锥；第一人称等价于屏幕中下偏窄的暖色亮斑
    const reach = Math.max(w, h) * 0.52;
    const g = ctx.createRadialGradient(cx, h*0.60, Math.max(8, reach*0.06), cx, h*0.60, reach);
    // 色值与 2D _lightLayer 手电锥完全一致（255,236,182 / 255,224,160），只压强度
    g.addColorStop(0, "rgba(255,236,182,0.13)");
    g.addColorStop(0.5, "rgba(255,224,160,0.055)");
    g.addColorStop(1, "rgba(255,224,160,0)");
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);

    // 3) 静态探照灯：把 2D 的光池按世界坐标投到屏幕上（超出视锥自动裁剪）
    for(const f of (R.floodlights||[])){
      const rx = f.x-p.x, ry = f.y-p.y;
      const depth = rx*ca + ry*sa;
      if(depth < 30 || depth > this.MAX_D) continue;
      const lat = -rx*sa + ry*ca;
      const sx = w/2 + (lat/depth)*proj;
      const sy = horizon + (this.EYE_H/depth)*proj;
      const rr = Math.max(30, (f.r||220)/depth*proj*0.8);
      if(sx+rr < 0 || sx-rr > w) continue;
      const lg = ctx.createRadialGradient(sx, sy, 0, sx, sy, rr);
      lg.addColorStop(0, "rgba(255,228,160,0.20)");
      lg.addColorStop(0.55, "rgba(255,210,140,0.06)");
      lg.addColorStop(1, "rgba(255,210,140,0)");
      ctx.fillStyle = lg;
      ctx.beginPath(); ctx.arc(sx, sy, rr, 0, 6.2832); ctx.fill();
    }
    ctx.restore();
  },

  /* ----------------------------- 手持武器模型 ----------------------------- */
  _drawWeapon(ctx, R, w, h){
    const p = R.player;
    if(!p) return;
    const sc = Math.max(0.66, Math.min(1.24, Math.min(w, h)/900));
    const mv = Math.hypot(p.vx||0, p.vy||0);
    const t = R.elapsed||0;
    const bobX = Math.cos(t*4.6) * Math.min(5, mv*0.012);
    const bobY = Math.sin(t*6.4) * Math.min(6, mv*0.016);
    const recoil = p.fireCd > 0 ? Math.min(20, p.fireCd*58) : 0;
    const reload = p.reloadT > 0 ? Math.min(1, p.reloadT/1.1) : 0;

    ctx.save();
    /* 基准锚在屏幕右下角（y=0 即画布底边，模型一律用负 y 向上画），
     * 走路晃动 + 后坐上跳 + 换弹下沉，换弹时枪口压低。 */
    ctx.translate(w*0.745 + bobX, h - 4 + bobY - recoil + reload*52);
    ctx.rotate(0.132 - reload*0.40);   // 枪口微微上扬，换弹时压低
    ctx.scale(sc, sc);
    if(p.gun) this._gunModel(ctx, p, p.gun);
    else this._meleeModel(ctx, p);
    ctx.restore();
  },

  /* 有枪：按枪型给出不同轮廓（手枪 / 冲锋枪 / 霰弹枪 / 步枪 / 狙击 / 榴弹），
   * 并读取配件（瞄具 / 弹匣 / 枪口 / 枪托）改变外观，颜色取该枪的品质色。 */
  _gunModel(ctx, p, g){
    const col = (typeof raidGunColor === "function") ? raidGunColor(g) : "#8d938a";
    const dark = "#2b3332", metal = "#3d4744";
    const type = g.type || "rifle";
    const has = (slot)=>(g.parts||[]).some(pt=>pt.slot===slot);

    // 以枪口为左端，枪身沿 -X 展开；y0 是枪管轴线（负 y = 屏幕上方）
    const y0 = -238;                                   // 枪管轴线
    const len = type==="pistol" ? 210 : type==="smg" ? 300 : type==="shotgun" ? 360 : type==="sniper" ? 470 : 410;
    const muzzle = -len;
    const barrelEnd = muzzle + len*0.30;
    const hgEnd = barrelEnd + len*0.24;
    const recvEnd = hgEnd + (type==="pistol" ? 92 : 138);
    const stockEnd = recvEnd + (type==="pistol" ? 0 : 112);

    // 枪口制退器 / 消焰器
    ctx.fillStyle = metal;
    ctx.fillRect(muzzle-22, y0-15, 24, 30);
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    for(let i=0;i<3;i++) ctx.fillRect(muzzle-18, y0-9+i*9, 14, 3);

    // 枪管
    ctx.fillStyle = dark;
    ctx.fillRect(muzzle, y0-9, len*0.30, 18);
    ctx.fillStyle = "rgba(214,226,220,0.20)";
    ctx.fillRect(muzzle, y0-9, len*0.30, 3);
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.fillRect(muzzle, y0+5, len*0.30, 4);

    // 护木 / 前握把
    ctx.fillStyle = col;
    ctx.fillRect(barrelEnd, y0-26, len*0.24, 52);
    ctx.fillStyle = "rgba(0,0,0,0.30)";
    ctx.fillRect(barrelEnd, y0+10, len*0.24, 16);
    // 顶部导轨齿
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    for(let x=barrelEnd+6; x<barrelEnd+len*0.24-6; x+=12) ctx.fillRect(x, y0-30, 7, 5);

    // 机匣
    ctx.fillStyle = col;
    ctx.fillRect(hgEnd-6, y0-34, recvEnd-hgEnd+6, 68);
    ctx.fillStyle = "rgba(255,255,255,0.10)";
    ctx.fillRect(hgEnd-6, y0-34, recvEnd-hgEnd+6, 5);
    ctx.fillStyle = "rgba(0,0,0,0.34)";
    ctx.fillRect(hgEnd-6, y0+22, recvEnd-hgEnd+6, 12);
    // 抛壳口
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillRect(hgEnd+16, y0-18, 42, 18);

    // 枪托
    if(type !== "pistol"){
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(recvEnd-2, y0-30);
      ctx.lineTo(stockEnd, y0-24);
      ctx.lineTo(stockEnd, y0+22);
      ctx.lineTo(recvEnd-2, y0+30);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = "rgba(0,0,0,0.30)";
      ctx.fillRect(recvEnd, y0+12, stockEnd-recvEnd, 12);
    }

    // 握把
    ctx.fillStyle = "#202624";
    ctx.beginPath();
    ctx.moveTo(hgEnd+42, y0+30);
    ctx.lineTo(hgEnd+86, y0+30);
    ctx.lineTo(hgEnd+104, y0+128);
    ctx.lineTo(hgEnd+52, y0+132);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.06)"; ctx.fillRect(hgEnd+48, y0+44, 34, 8);

    // 弹匣（有扩容配件则更长）
    const magLen = has("mag") ? 96 : 70;
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(hgEnd+6, y0+32);
    ctx.lineTo(hgEnd+40, y0+32);
    ctx.lineTo(hgEnd+52, y0+32+magLen);
    ctx.lineTo(hgEnd+8, y0+32+magLen);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = "rgba(0,0,0,0.28)";
    ctx.fillRect(hgEnd+10, y0+40, 34, 6);

    // 瞄具：狙击 / 有瞄具配件 → 高倍镜，否则机械瞄具
    if(type === "sniper" || has("scope")){
      ctx.fillStyle = "#1b201f";
      ctx.fillRect(hgEnd+34, y0-64, 78, 26);
      ctx.fillStyle = "#0d1110";
      ctx.beginPath(); ctx.arc(hgEnd+34, y0-51, 13, 0, 6.2832); ctx.fill();
      ctx.fillStyle = "rgba(140,200,220,0.45)";
      ctx.beginPath(); ctx.arc(hgEnd+34, y0-51, 8, 0, 6.2832); ctx.fill();
      ctx.fillStyle = "#1b201f";
      ctx.fillRect(hgEnd+44, y0-40, 10, 8);
      ctx.fillRect(hgEnd+96, y0-40, 10, 8);
    } else {
      ctx.fillStyle = "#1b201f";
      ctx.fillRect(hgEnd+18, y0-46, 26, 12);
      ctx.fillRect(barrelEnd+8, y0-42, 10, 10);
      ctx.fillStyle = "#3d4a46";
      ctx.fillRect(barrelEnd+10, y0-38, 6, 6);
    }

    // 前手（护木）与后手（握把）+ 前臂
    this._glove(ctx, hgEnd-24, y0+18, 1.0, -0.18);
    ctx.fillStyle = "#33403a";
    ctx.beginPath();
    ctx.moveTo(hgEnd-40, y0+40);
    ctx.lineTo(hgEnd+10, y0+40);
    ctx.lineTo(hgEnd+64, y0+210);
    ctx.lineTo(hgEnd-10, y0+230);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.05)";
    ctx.fillRect(hgEnd-30, y0+60, 26, 90);

    this._glove(ctx, hgEnd+72, y0+84, 1.05, 0.12);
    ctx.fillStyle = "#2c3833";
    ctx.beginPath();
    ctx.moveTo(hgEnd+52, y0+120);
    ctx.lineTo(hgEnd+120, y0+104);
    ctx.lineTo(hgEnd+250, y0+250);
    ctx.lineTo(hgEnd+120, y0+280);
    ctx.closePath(); ctx.fill();

    // 枪口火焰
    if(p.fireCd > 0.04){
      const fx = muzzle-24, fy = y0;
      ctx.fillStyle = "rgba(255,196,90,0.95)";
      ctx.beginPath();
      ctx.moveTo(fx, fy);
      ctx.lineTo(fx-46, fy-26);
      ctx.lineTo(fx-30, fy-4);
      ctx.lineTo(fx-62, fy+2);
      ctx.lineTo(fx-30, fy+12);
      ctx.lineTo(fx-44, fy+30);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = "rgba(255,240,190,0.75)";
      ctx.beginPath(); ctx.moveTo(fx, fy); ctx.lineTo(fx-26, fy-10); ctx.lineTo(fx-24, fy+10); ctx.closePath(); ctx.fill();
    }
  },

  _glove(ctx, x, y, sc, rot){
    ctx.save();
    ctx.translate(x, y); ctx.rotate(rot||0); ctx.scale(sc||1, sc||1);
    ctx.fillStyle = "#3c4a44";
    if(ctx.roundRect){
      ctx.beginPath(); ctx.roundRect(-26, -18, 52, 40, 10); ctx.fill();
    } else {
      ctx.fillRect(-26, -18, 52, 40);
    }
    ctx.fillStyle = "rgba(255,255,255,0.06)";
    ctx.fillRect(-22, -14, 44, 8);
    ctx.strokeStyle = "rgba(0,0,0,0.35)"; ctx.lineWidth = 2;
    ctx.beginPath();
    for(let i=0;i<3;i++){ ctx.moveTo(-14+i*12, -8); ctx.lineTo(-14+i*12, 18); }
    ctx.stroke();
    ctx.restore();
  },

  /* 空手：握战术匕首的前臂特写（跑刀状态也有模型，而不是一把凭空的长枪） */
  _meleeModel(ctx, p){
    ctx.save();
    // 前臂：从画布底边伸上来，握拳位置在 (24, -168)
    ctx.fillStyle = "#333f39";
    ctx.beginPath();
    ctx.moveTo(-26, -150); ctx.lineTo(82, -190); ctx.lineTo(238, 96); ctx.lineTo(96, 150);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.055)";
    ctx.beginPath();
    ctx.moveTo(-6, -158); ctx.lineTo(56, -182); ctx.lineTo(150, 30); ctx.lineTo(84, 56);
    ctx.closePath(); ctx.fill();
    // 袖口
    ctx.fillStyle = "#28322d";
    ctx.beginPath();
    ctx.moveTo(120, 10); ctx.lineTo(238, 96); ctx.lineTo(96, 150); ctx.lineTo(52, 74);
    ctx.closePath(); ctx.fill();

    // 刀柄（握拳处）
    ctx.fillStyle = "#1f2529";
    ctx.beginPath();
    ctx.moveTo(-18, -196); ctx.lineTo(56, -222); ctx.lineTo(82, -152); ctx.lineTo(6, -128);
    ctx.closePath(); ctx.fill();
    // 护手
    ctx.fillStyle = "#3a4448";
    ctx.beginPath();
    ctx.moveTo(-30, -204); ctx.lineTo(4, -218); ctx.lineTo(26, -160); ctx.lineTo(-10, -146);
    ctx.closePath(); ctx.fill();
    // 刀身（指向左上方）
    ctx.fillStyle = "#a3b0b5";
    ctx.beginPath();
    ctx.moveTo(-26, -206); ctx.lineTo(-214, -318); ctx.lineTo(-244, -308); ctx.lineTo(-46, -168);
    ctx.closePath(); ctx.fill();
    // 刀背高光
    ctx.fillStyle = "rgba(255,255,255,0.34)";
    ctx.beginPath();
    ctx.moveTo(-30, -208); ctx.lineTo(-210, -314); ctx.lineTo(-214, -300); ctx.lineTo(-38, -196);
    ctx.closePath(); ctx.fill();
    // 握拳
    this._glove(ctx, 14, -166, 1.0, -0.16);
    ctx.restore();
  },

  _crosshair(ctx, R, w, h){
    const p = R.player;
    const moving = Math.hypot(p.vx||0, p.vy||0);
    const spread = 6 + (p.fireCd>0 ? 4 : 0) + Math.min(7, moving*0.022);
    const cx = w/2, cy = h/2;
    ctx.strokeStyle = "rgba(232,240,234,0.85)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx-spread-7, cy); ctx.lineTo(cx-spread, cy);
    ctx.moveTo(cx+spread, cy);   ctx.lineTo(cx+spread+7, cy);
    ctx.moveTo(cx, cy-spread-7); ctx.lineTo(cx, cy-spread);
    ctx.moveTo(cx, cy+spread);   ctx.lineTo(cx, cy+spread+7);
    ctx.stroke();
    ctx.fillStyle = "rgba(232,240,234,0.9)";
    ctx.fillRect(cx-1, cy-1, 2, 2);
  },
};
