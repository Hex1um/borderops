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
  CELL: 256,             // 参照网格（地面分区 / 网格间距对照用）
  LIGHT_REACH: 560,      // 与 raid.js _lightLayer 的手电射程一致

  _zbuf: null,
  _cols: 0,
  _step: 3,
  _colors: null,

  /* 面法线明暗：0 = X 面（与视轴垂直，最亮），1 = Z 面（侧向，压暗）
     色阶 0 = 最远（融进雾里），15 = 最近（2D 同款 #272d31） */
  _initColors(){
    if(this._colors) return;
    const haze = [26, 35, 41];
    const base = [[39, 45, 49], [29, 34, 38]];       // 与 2D 墙体填充 #272d31 一致，Z 面压暗
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
    if(!this._zbuf || this._zbuf.length < n){
      this._zbuf = new Float32Array(n);
    }
    this._cols = n;
    this._step = step;

    ctx.save();
    this._sky(ctx, w, h, horizon);
    /* 画家算法三段式：算遮挡深度（只写 _zbuf） → 铺地面 → 按面画墙盖住地面 → 精灵 */
    this._setProj(p, w, h, horizon, proj, yaw, ca, sa);
    const near = this._castWalls(ctx, R, p, w, h, horizon, proj, yaw, step, n);
    this._floorLayer(ctx, R, p, w, h, horizon, proj, yaw);
    this._paintWalls(ctx, near);
    this._drawSprites(ctx, R, p, w, h, horizon, proj, yaw, ca, sa, step, n, near);
    this._lighting(ctx, R, p, w, h, horizon, proj, yaw, ca, sa);
    this._drawWeapon(ctx, R, w, h);
    this._crosshair(ctx, R, w, h);
    ctx.restore();
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

  _castWalls(ctx, R, p, w, h, horizon, proj, yaw, step, n){
    const src = R.walls || [];
    let pool = (typeof R._nearWalls === "function") ? R._nearWalls(p.x, p.y, this.MAX_D) : src;

    /* 预筛：一次算好每面墙的「方位角 + 角半径」。
       内层是 400 多列 × 上千面墙，逐个做 slab 求交是这一帧最贵的地方；
       先用方位角把不在该列视锥里的墙剔掉，能砍掉九成以上。 */
    const near = [];
    const TAU = Math.PI*2;
    for(let i=0;i<pool.length;i++){
      const wl = pool[i];
      // 站在墙里（出生点容差 / 贴墙滑行）时忽略这一面，否则整屏糊死
      if(p.x >= wl.x-0.5 && p.x <= wl.x+wl.w+0.5 && p.y >= wl.y-0.5 && p.y <= wl.y+wl.h+0.5) continue;
      const cx = wl.x + wl.w/2, cy = wl.y + wl.h/2;
      const dx0 = cx-p.x, dy0 = cy-p.y;
      if(Math.abs(dx0) > this.MAX_D + wl.w/2) continue;
      if(Math.abs(dy0) > this.MAX_D + wl.h/2) continue;
      const dist = Math.hypot(dx0, dy0);
      const rad = Math.hypot(wl.w, wl.h)/2;
      if(dist - rad > this.MAX_D) continue;
      // 包围圆含相机时不裁角度（贴墙时整面墙都在视野里）
      const halfAng = (dist <= rad + 1) ? Math.PI : Math.atan2(rad, dist-rad) + 0.02;
      near.push({ wl, ac: Math.atan2(dy0, dx0), halfAng });
    }
    const MAX = this.MAX_D, MIND = this.MIN_D;

    /* 逐列求「最近墙面距离」——只写深度缓冲，供精灵遮挡使用。
     * v0.19.2 起墙面几何不再从这里出：逐列矩形是「墙壁伸缩」的根源，见 _paintWalls。 */
    for(let c=0; c<n; c++){
      const sx = c*step;
      const a = yaw + Math.atan((sx + step*0.5 - w/2)/proj);
      const dx = Math.cos(a), dy = Math.sin(a);
      const adx = Math.abs(dx) < 1e-9, ady = Math.abs(dy) < 1e-9;
      let best = MAX;

      for(let i=0;i<near.length;i++){
        const item = near[i], wl = item.wl;
        // 方位角粗筛：这一列根本不朝这面墙，直接跳过
        if(item.halfAng < Math.PI){
          let da = a - item.ac;
          if(da > Math.PI) da -= TAU; else if(da < -Math.PI) da += TAU;
          if(da > item.halfAng || da < -item.halfAng) continue;
        }
        let tmin = MIND, tmax = best;
        if(adx){ if(p.x < wl.x || p.x > wl.x+wl.w) continue; }
        else {
          let t1 = (wl.x-p.x)/dx, t2 = (wl.x+wl.w-p.x)/dx;
          if(t1 > t2){ const t=t1; t1=t2; t2=t; }
          if(t1 > tmin){ tmin=t1; }
          if(t2 < tmax) tmax=t2;
          if(tmin > tmax) continue;
        }
        if(ady){ if(p.y < wl.y || p.y > wl.y+wl.h) continue; }
        else {
          let t1 = (wl.y-p.y)/dy, t2 = (wl.y+wl.h-p.y)/dy;
          if(t1 > t2){ const t=t1; t1=t2; t2=t; }
          if(t1 > tmin){ tmin=t1; }
          if(t2 < tmax) tmax=t2;
          if(tmin > tmax) continue;
        }
        if(tmin < best) best = tmin;
      }

      this._zbuf[c] = best;
    }

    return near;
  },

  /* ===================== 墙面：按「面」渲染（v0.19.2 · Minecraft 式） =====================
   *
   *  上一版为了省绘制调用，把「颜色相同的相邻列」合批成一次 fillRect —— 整段墙共用
   *  一个 yTop/yBot，墙面因此退化成矩形（正确形状是梯形）；批次边界还随移动不断变化，
   *  屏幕上看就成了「墙壁在伸缩」。这里改成按面渲染：
   *
   *    每面墙 = 一个长方体 · 只画朝向相机的侧面（最多 2 个）
   *    每个侧面 = 4 个世界顶点 → 近平面裁剪 → 透视投影 → 填充
   *    面内的板缝 / 水平缝 / 墙裙 / 顶沿都在世界空间里定位后再投影，天然跟着透视收拢
   *
   *  明暗按面法线固定（X 面亮、Z 面暗），与《我的世界》一致：不管怎么转身、
   *  同一个面的亮度都不变，眼睛就不会读到「明暗在流动」。
   *
   *  性能约束：单帧最多几百个面，所以
   *    · 顶点缓冲复用，热路径不分配数组（每帧上千个临时数组是最大的一笔开销）
   *    · 不用 createLinearGradient（每面一个渐变对象，几百个直接吃掉 20ms）
   *      长墙改成沿长度切 ≤3 段、每段一个雾阶，肉眼是连续渐变，代价只是几次 fill
   * ====================================================================================== */

  _fq: null,       // 复用的四点世界坐标缓冲
  _fs: null,       // 复用的四点屏幕坐标缓冲

  /* 世界点 (x, y, 世界高度 hgt) → [sx, sy, depth]；在相机后方返回 null
     （面渲染的热路径不调它，见 _facePoly；这条给缝线 / 顶沿用，数量少） */
  _p3(x, y, hgt){
    const c = this._pf;
    const rx = x-c.p.x, ry = y-c.p.y;
    const d = rx*c.ca + ry*c.sa;
    if(d < 8) return null;
    const lat = -rx*c.sa + ry*c.ca;
    return [c.w/2 + (lat/d)*c.proj, c.horizon + ((this.EYE_H-hgt)/d)*c.proj, d];
  },

  /* 三维顶点多边形裁到 depth >= near（Sutherland–Hodgman，只裁一个平面） */
  _clipNear3(pts, near){
    const c = this._pf, ca = c.ca, sa = c.sa, px = c.p.x, py = c.p.y;
    const out = [];
    for(let i=0;i<pts.length;i++){
      const a = pts[i], b = pts[(i+1)%pts.length];
      const da = (a[0]-px)*ca + (a[1]-py)*sa - near;
      const db = (b[0]-px)*ca + (b[1]-py)*sa - near;
      if(da >= 0) out.push(a);
      if((da >= 0) !== (db >= 0)){
        const t = da/(da-db);
        out.push([a[0]+(b[0]-a[0])*t, a[1]+(b[1]-a[1])*t, a[2]+(b[2]-a[2])*t]);
      }
    }
    return out;
  },

  /* 把一个世界矩形面 (x0,y0)-(x1,y1) × 高度 [h0,h1] 建成 ctx path。
     顶点缓冲复用 → 每帧零分配；完全在身后 / 屏幕上太小时返回 false。 */
  _facePoly(ctx, x0, y0, x1, y1, h0, h1){
    const c = this._pf, ca = c.ca, sa = c.sa, px = c.p.x, py = c.p.y;
    const b = this._fq || (this._fq = [[0,0,0],[0,0,0],[0,0,0],[0,0,0]]);
    b[0][0]=x0; b[0][1]=y0; b[0][2]=h0;
    b[1][0]=x1; b[1][1]=y1; b[1][2]=h0;
    b[2][0]=x1; b[2][1]=y1; b[2][2]=h1;
    b[3][0]=x0; b[3][1]=y0; b[3][2]=h1;
    let need = false;
    for(let i=0;i<4;i++){ if((b[i][0]-px)*ca + (b[i][1]-py)*sa < 12){ need = true; break; } }
    const poly = need ? this._clipNear3(b, 12) : b;
    if(poly.length < 3) return false;

    const proj = c.proj, hw = c.w/2, hor = c.horizon, eye = this.EYE_H;
    ctx.beginPath();
    for(let i=0;i<poly.length;i++){
      const rx = poly[i][0]-px, ry = poly[i][1]-py;
      const d = rx*ca + ry*sa;
      if(d < 8) return false;
      const sx = hw + ((-rx*sa + ry*ca)/d)*proj;
      const sy = hor + ((eye-poly[i][2])/d)*proj;
      if(i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
    }
    ctx.closePath();
    return true;
  },

  /* 距离 → 雾阶（0 = 纯雾，15 = 最近） */
  _fogLvl(d){
    const f = 1 - d/this.MAX_D;
    return Math.max(0, Math.min(15, Math.round((f > 0 ? f : 0)*15)));
  },

  /* 把一条「世界高度 = hh 的水平线」加进当前 path；任一端在身后就放弃 */
  _faceH(ctx, f, hh){
    const p0 = this._p3(f.ax, f.ay, hh), p1 = this._p3(f.bx, f.by, hh);
    if(!p0 || !p1) return false;
    ctx.moveTo(p0[0], p0[1]); ctx.lineTo(p1[0], p1[1]);
    return true;
  },

  _paintWalls(ctx, near){
    const pf = this._pf;
    if(!pf || !near || !near.length) return;
    const P = pf.p, ca = pf.ca, sa = pf.sa, proj = pf.proj;
    const MAX = this.MAX_D;
    const faces = [];

    /* 只收朝向相机的侧面：法线点向相机才画（背面剔除） */
    for(let i=0;i<near.length;i++){
      const wl = near[i].wl;
      const x0 = wl.x, y0 = wl.y, x1 = wl.x+wl.w, y1 = wl.y+wl.h;
      const top = wl.hgt || this.WALL_H;
      if(P.y <= y0) faces.push({ wl, ax:x0, ay:y0, bx:x1, by:y0, top, sh:1 });   // 北面（-Z）
      if(P.y >= y1) faces.push({ wl, ax:x1, ay:y1, bx:x0, by:y1, top, sh:1 });   // 南面（+Z）
      if(P.x <= x0) faces.push({ wl, ax:x0, ay:y1, bx:x0, by:y0, top, sh:0 });   // 西面（-X）
      if(P.x >= x1) faces.push({ wl, ax:x1, ay:y0, bx:x1, by:y1, top, sh:0 });   // 东面（+X）
    }
    if(!faces.length) return;

    const valid = [];
    for(let i=0;i<faces.length;i++){
      const f = faces[i];
      f.d1 = (f.ax-P.x)*ca + (f.ay-P.y)*sa;
      f.d2 = (f.bx-P.x)*ca + (f.by-P.y)*sa;
      f.dm = (f.d1+f.d2)*0.5;
      const dn = f.d1 < f.d2 ? f.d1 : f.d2;
      const df = f.d1 < f.d2 ? f.d2 : f.d1;
      if(df < 14 || dn > MAX) continue;             // 整面在身后 / 整面在雾外
      /* 屏幕上不到 1px 的面直接丢：远墙段有上千段，省下来的是纯利润 */
      const len = Math.abs(f.bx-f.ax) + Math.abs(f.by-f.ay);
      const widthPx = (len/Math.max(14, f.dm))*proj;
      if(widthPx < 1) continue;
      f.len = len; f.widthPx = widthPx;
      valid.push(f);
    }
    if(!valid.length) return;
    valid.sort((a,b)=> b.dm - a.dm);               // 远 → 近（画家算法）

    for(let i=0;i<valid.length;i++){
      const f = valid[i];
      const fog = Math.max(0, Math.min(1, 1 - f.dm/MAX));
      const pal = this._colors[f.sh];

      /* 主体：长墙沿长度切段，每段一个雾阶 —— 视觉上是渐变，代价只有几次 fill。
         避免 createLinearGradient：每面一个渐变对象，几百面就是 20ms 级别。 */
      const pieces = f.len > 420 ? Math.min(3, Math.ceil(f.len/420)) : 1;
      for(let s=0; s<pieces; s++){
        const u0 = s/pieces, u1 = (s+1)/pieces;
        const xa = f.ax+(f.bx-f.ax)*u0, ya = f.ay+(f.by-f.ay)*u0;
        const xb = f.ax+(f.bx-f.ax)*u1, yb = f.ay+(f.by-f.ay)*u1;
        const dm = f.d1+(f.d2-f.d1)*((u0+u1)*0.5);
        if(!this._facePoly(ctx, xa, ya, xb, yb, 0, f.top)) continue;
        ctx.fillStyle = pal[this._fogLvl(Math.max(14, dm))];
        ctx.fill();
      }

      /* 坝体 / 牢房隔断：2D 的混凝土冷灰叠加 */
      if(f.wl.dam || f.wl.cell){
        if(this._facePoly(ctx, f.ax, f.ay, f.bx, f.by, 0, f.top)){
          ctx.fillStyle = "rgba(92,120,140," + (0.12 + 0.20*fog).toFixed(3) + ")";
          ctx.fill();
        }
      }

      /* 远墙只保留轮廓；近墙才补细节（每面 5~7 次绘制，不能无条件铺开） */
      if(f.dm > 900 || f.widthPx < 34) continue;

      /* 墙裙（2D 房间里的踢脚板） */
      const sk = f.top*0.12;
      if(this._facePoly(ctx, f.ax, f.ay, f.bx, f.by, 0, sk)){
        ctx.fillStyle = "rgba(0,0,0," + (0.22*fog).toFixed(3) + ")";
        ctx.fill();
      }

      /* 板缝：按世界 X/Y 每 170 一条，锚在世界上而不是屏幕上 —— 移动时会正确滑动收拢 */
      const spanX = Math.abs(f.bx-f.ax) > 0.5;
      const t0 = spanX ? f.ax : f.ay, t1 = spanX ? f.bx : f.by;
      const lo = t0 < t1 ? t0 : t1, hi = t0 < t1 ? t1 : t0;
      if(hi - lo > 170){
        ctx.beginPath();
        let drew = false;
        for(let t = Math.ceil(lo/170)*170; t < hi; t += 170){
          if(t - lo < 24 || hi - t < 24) continue;
          const u = (t - t0)/(t1 - t0);
          const x = f.ax + (f.bx-f.ax)*u, y = f.ay + (f.by-f.ay)*u;
          const pb = this._p3(x, y, 0), pt = this._p3(x, y, f.top);
          if(!pb || !pt) continue;
          ctx.moveTo(pb[0], pb[1]); ctx.lineTo(pt[0], pt[1]);
          drew = true;
        }
        if(drew){
          ctx.strokeStyle = "rgba(0,0,0," + (0.26*fog).toFixed(3) + ")";
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }

      /* 水平砖缝：世界高度 1/4、2/4、3/4 三档，近处不再是灰板 */
      ctx.beginPath();
      let anyH = false;
      anyH = this._faceH(ctx, f, f.top*0.25) || anyH;
      anyH = this._faceH(ctx, f, f.top*0.50) || anyH;
      anyH = this._faceH(ctx, f, f.top*0.75) || anyH;
      if(anyH){
        ctx.strokeStyle = "rgba(0,0,0," + (0.18*fog).toFixed(3) + ")";
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      /* 顶沿：2D 的 #0b0e10 外框 + rgba(170,195,205,0.16) 高光 */
      const e0 = this._p3(f.ax, f.ay, f.top), e1 = this._p3(f.bx, f.by, f.top);
      if(e0 && e1){
        ctx.beginPath();
        ctx.moveTo(e0[0], e0[1]); ctx.lineTo(e1[0], e1[1]);
        ctx.strokeStyle = "rgba(6,9,11," + (0.45 + 0.40*fog).toFixed(3) + ")";
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(e0[0], e0[1]+1.5); ctx.lineTo(e1[0], e1[1]+1.5);
        ctx.strokeStyle = "rgba(170,195,205," + (0.10 + 0.16*fog).toFixed(3) + ")";
        ctx.lineWidth = Math.max(1, Math.min(2.5, f.top*0.012));
        ctx.stroke();
      }
    }
  },

  /* ===================== 地面层：与 2D scene() 同数据 · 同顺序 · 真透视 =====================
   *
   *  2D 里所有地面元素都是「平铺在地面上」的矩形 / 椭圆 / 线段。地面是一个平面，
   *  平面上的直线投影到图像后仍然是直线，所以只要把世界坐标顶点做透视变换再连线，
   *  形状、位置、遮挡关系就与 2D 完全一致，而不是近似画几块色板。
   *
   *  地面在墙之前铺（一次无裁剪的全铺），墙体随后按面盖上去 —— 画家算法，
   *  不需要一条 400 多点的裁剪路径（那种 clip 会让每次 fill 都重新栅格化）。
   *  图层顺序照抄 2D scene()：
   *    底面 → 分区 → 密林 → 道路 → 草丛碎石 → 网格 → 泄洪库底 → 水库 → 水面
   *    → 桥 → 铁路 → 院子 → 房间 → 贴花 → 暗斑 → 距离雾
   * ====================================================================================== */

  _pf: null,       // 本帧投影上下文

  _setProj(p, w, h, horizon, proj, yaw, ca, sa){
    this._pf = { p, w, h, horizon, proj, ca, sa };
  },

  /* 世界点 → [sx, sy, depth]；在相机后方返回 null */
  _toScreen(x, y){
    const c = this._pf;
    const rx = x-c.p.x, ry = y-c.p.y;
    const d = rx*c.ca + ry*c.sa;
    if(d < 6) return null;
    const lat = -rx*c.sa + ry*c.ca;
    return [c.w/2 + (lat/d)*c.proj, c.horizon + (this.EYE_H/d)*c.proj, d];
  },

  /* 对象整体在相机后方就跳过（省掉逐顶点判断） */
  _behind(x, y, r){
    const c = this._pf;
    return ((x-c.p.x)*c.ca + (y-c.p.y)*c.sa) < -(r||0) - 6;
  },

  /* 世界多边形裁到 depth >= near 再投影填充 */
  _clipNear(pts, near){
    const c = this._pf, ca = c.ca, sa = c.sa, px = c.p.x, py = c.p.y;
    const out = [];
    for(let i=0;i<pts.length;i++){
      const a = pts[i], b = pts[(i+1)%pts.length];
      const da = (a[0]-px)*ca + (a[1]-py)*sa - near;
      const db = (b[0]-px)*ca + (b[1]-py)*sa - near;
      if(da >= 0) out.push(a);
      if((da >= 0) !== (db >= 0)){
        const t = da/(da-db);
        out.push([a[0]+(b[0]-a[0])*t, a[1]+(b[1]-a[1])*t]);
      }
    }
    return out;
  },

  _poly(ctx, pts, style){
    if(!pts || pts.length < 3) return false;
    const c = this._pf;
    let needClip = false;
    for(let i=0;i<pts.length;i++){
      if((pts[i][0]-c.p.x)*c.ca + (pts[i][1]-c.p.y)*c.sa < 8){ needClip = true; break; }
    }
    const poly = needClip ? this._clipNear(pts, 8) : pts;
    if(poly.length < 3) return false;
    ctx.beginPath();
    for(let i=0;i<poly.length;i++){
      const s = this._toScreen(poly[i][0], poly[i][1]);
      if(!s) return false;
      if(i === 0) ctx.moveTo(s[0], s[1]); else ctx.lineTo(s[0], s[1]);
    }
    ctx.closePath();
    ctx.fillStyle = style;
    ctx.fill();
    return true;
  },

  /* 只追加子路径、不 fill：同色的大批多边形可以一次 stroke / fill 掉 */
  _polyPath(ctx, pts){
    if(!pts || pts.length < 3) return false;
    const c = this._pf;
    let needClip = false;
    for(let i=0;i<pts.length;i++){
      if((pts[i][0]-c.p.x)*c.ca + (pts[i][1]-c.p.y)*c.sa < 8){ needClip = true; break; }
    }
    const poly = needClip ? this._clipNear(pts, 8) : pts;
    if(poly.length < 3) return false;
    for(let i=0;i<poly.length;i++){
      const sp = this._toScreen(poly[i][0], poly[i][1]);
      if(!sp) return false;
      if(i === 0) ctx.moveTo(sp[0], sp[1]); else ctx.lineTo(sp[0], sp[1]);
    }
    ctx.closePath();
    return true;
  },

  /* 视锥 / 距离裁剪：后方、屏幕外、超远的对象直接跳过，省掉逐顶点投影 */
  _off(x, y, r){
    const c = this._pf;
    const rx = x-c.p.x, ry = y-c.p.y;
    const d = rx*c.ca + ry*c.sa;
    if(d < -(r||0) - 6) return true;
    if(d > this.MAX_D + (r||0)) return true;
    if(d <= (r||0) + 8) return false;                    // 包围球含相机：不裁
    const lat = -rx*c.sa + ry*c.ca;
    const sx = c.w/2 + (lat/d)*c.proj;
    const half = ((r||0)/d)*c.proj;
    return (sx + half < -20 || sx - half > c.w + 20);
  },

  _rectPoly(x, y, w, h){ return [[x,y],[x+w,y],[x+w,y+h],[x,y+h]]; },

  _circlePoly(x, y, r, seg){
    seg = seg || 16;
    const a = [];
    for(let i=0;i<seg;i++){ const t = i/seg*6.2832; a.push([x+Math.cos(t)*r, y+Math.sin(t)*r]); }
    return a;
  },

  /* 地面上的一条线段（两端近裁剪后投影，线宽不随距离变化，够用且便宜） */
  _line(ctx, x1, y1, x2, y2, style, width){
    const c = this._pf;
    const d1 = (x1-c.p.x)*c.ca + (y1-c.p.y)*c.sa - 8;
    const d2 = (x2-c.p.x)*c.ca + (y2-c.p.y)*c.sa - 8;
    if(d1 < 0 && d2 < 0) return;
    let ax = x1, ay = y1, bx = x2, by = y2;
    if(d1 < 0){ const t = d1/(d1-d2); ax = x1+(x2-x1)*t; ay = y1+(y2-y1)*t; }
    else if(d2 < 0){ const t = d2/(d2-d1); bx = x2+(x1-x2)*t; by = y2+(y1-y2)*t; }
    const s1 = this._toScreen(ax, ay), s2 = this._toScreen(bx, by);
    if(!s1 || !s2) return;
    ctx.strokeStyle = style; ctx.lineWidth = width || 1;
    ctx.beginPath(); ctx.moveTo(s1[0], s1[1]); ctx.lineTo(s2[0], s2[1]); ctx.stroke();
  },

  /* 把一条地面线段追加进当前 path（不 stroke），用于批量画网格 */
  _segPath(ctx, x1, y1, x2, y2){
    const c = this._pf;
    const d1 = (x1-c.p.x)*c.ca + (y1-c.p.y)*c.sa - 8;
    const d2 = (x2-c.p.x)*c.ca + (y2-c.p.y)*c.sa - 8;
    if(d1 < 0 && d2 < 0) return;
    let ax = x1, ay = y1, bx = x2, by = y2;
    if(d1 < 0){ const t = d1/(d1-d2); ax = x1+(x2-x1)*t; ay = y1+(y2-y1)*t; }
    else if(d2 < 0){ const t = d2/(d2-d1); bx = x2+(x1-x2)*t; by = y2+(y1-y2)*t; }
    const s1 = this._toScreen(ax, ay), s2 = this._toScreen(bx, by);
    if(!s1 || !s2) return;
    ctx.moveTo(s1[0], s1[1]); ctx.lineTo(s2[0], s2[1]);
  },

  /* 贴地的椭圆（油渍 / 血渍 / 草丛）：按透视压扁，模拟平铺在地面上 */
  _flatEllipse(ctx, x, y, r, style, ratio){
    if(this._behind(x, y, r)) return;
    const s = this._toScreen(x, y);
    if(!s || s[2] < 30) return;
    const rx = (r/s[2])*this._pf.proj;
    if(rx < 0.7 || rx > 6000) return;
    const ry = Math.max(0.5, rx*(ratio || 0.42));
    ctx.fillStyle = style;
    ctx.beginPath(); ctx.ellipse(s[0], s[1], rx, ry, 0, 0, 6.2832); ctx.fill();
  },

  /* 贴地的旋转矩形（枕木 / 停车线 / 桥墩）：给中心 + 半长 + 半宽 + 角度 */
  _flatBar(ctx, x, y, halfLen, halfWid, ang, style){
    if(this._behind(x, y, Math.max(halfLen, halfWid))) return;
    const cx = Math.cos(ang), sy = Math.sin(ang);
    const ex = cx*halfLen, ey = sy*halfLen;      // 长轴方向
    const fx = -sy*halfWid, fy = cx*halfWid;     // 短轴方向
    this._poly(ctx, [
      [x-ex-fx, y-ey-fy], [x+ex-fx, y+ey-fy],
      [x+ex+fx, y+ey+fy], [x-ex+fx, y-ey+fy],
    ], style);
  },

  /* ---------------------------------------------------------------- 主入口 */
  _floorLayer(ctx, R, p, w, h, horizon, proj, yaw){
    const ca = Math.cos(yaw), sa = Math.sin(yaw);
    this._setProj(p, w, h, horizon, proj, yaw, ca, sa);
    const MAX = this.MAX_D;

    ctx.save();
    /* ---- 1. 底面 ---- */
    ctx.fillStyle = "#0d1114"; ctx.fillRect(0, horizon-2, w, h-horizon+2);

    /* ---- 2. 地表分区（2D 同款 560 网格 + 同款四色） ---- */
    const ZS = 560, ZR = 1650;
    const gx0 = Math.floor((p.x-ZR)/ZS), gx1 = Math.floor((p.x+ZR)/ZS);
    const gy0 = Math.floor((p.y-ZR)/ZS), gy1 = Math.floor((p.y+ZR)/ZS);
    /* 四种底色按色分批：格子互不重叠，同色合并成一个 path 只 fill 一次 */
    const ZPAL = ["#14191b", "#101618", "#181a1c", "#0c1012"];
    const zb = this._zbuckets || (this._zbuckets = [[], [], [], []]);
    for(let k=0;k<4;k++) zb[k].length = 0;
    for(let gy=gy0; gy<=gy1; gy++){
      for(let gx=gx0; gx<=gx1; gx++){
        if(this._off(gx*ZS+ZS/2, gy*ZS+ZS/2, ZS*0.75)) continue;
        const hv = (typeof R._hash2 === "function") ? R._hash2(gx*7+3, gy*11+5) : 0.5;
        zb[hv < 0.32 ? 0 : hv < 0.62 ? 1 : hv < 0.84 ? 2 : 3].push(this._rectPoly(gx*ZS, gy*ZS, ZS, ZS));
      }
    }
    for(let k=0;k<4;k++){
      if(!zb[k].length) continue;
      ctx.beginPath();
      for(const poly of zb[k]) this._polyPath(ctx, poly);
      ctx.fillStyle = ZPAL[k]; ctx.fill();
    }

    /* ---- 3. 密林地表 ---- */
    for(const fz of (R.forests||[])){
      if(this._behind(fz.x+fz.w/2, fz.y+fz.h/2, Math.hypot(fz.w, fz.h)/2)) continue;
      if(!this._poly(ctx, this._rectPoly(fz.x, fz.y, fz.w, fz.h), "rgba(30,44,26,0.55)")) continue;
      this._poly(ctx, this._rectPoly(fz.x+12, fz.y+12, fz.w-24, fz.h-24), "rgba(46,64,36,0.30)");
    }

    /* ---- 4. 道路 / 门外铺装 ---- */
    for(const rd of (R.roads||[])){
      if(this._behind(rd.x+rd.w/2, rd.y+rd.h/2, Math.hypot(rd.w, rd.h)/2)) continue;
      if(!this._poly(ctx, this._rectPoly(rd.x, rd.y, rd.w, rd.h), "rgba(52,50,43,0.62)")) continue;
      // 上沿高光
      if(rd.w >= rd.h) this._line(ctx, rd.x, rd.y, rd.x+rd.w, rd.y, "rgba(96,92,78,0.20)", 2);
      else this._line(ctx, rd.x, rd.y, rd.x, rd.y+rd.h, "rgba(96,92,78,0.20)", 2);
      // 中线虚线（2D：26 划 / 30 空）
      const horiz = rd.w >= rd.h;
      const len = horiz ? rd.w : rd.h;
      if(len <= 420) continue;
      const lx = horiz ? rd.x : rd.x+rd.w/2;
      const ly = horiz ? rd.y+rd.h/2 : rd.y;
      for(let d=0; d+26<len; d+=56){
        if(horiz) this._line(ctx, lx+d, ly, lx+d+26, ly, "rgba(150,140,100,0.15)", 2);
        else      this._line(ctx, lx, ly+d, lx, ly+d+26, "rgba(150,140,100,0.15)", 2);
      }
    }

    /* ---- 5. 草丛 / 碎石斑块（134 网格，2D 同源哈希） ---- */
    const PS = 134, PR = 1150;
    const px0 = Math.floor((p.x-PR)/PS), px1 = Math.floor((p.x+PR)/PS);
    const py0 = Math.floor((p.y-PR)/PS), py1 = Math.floor((p.y+PR)/PS);
    for(let gy=py0; gy<=py1; gy++){
      for(let gx=px0; gx<=px1; gx++){
        const hv = (typeof R._hash2 === "function") ? R._hash2(gx*5+91, gy*3+37) : 0;
        if(hv < 0.54) continue;
        const cx = gx*PS + R._hash2(gx, gy*7)*PS;
        const cy = gy*PS + R._hash2(gx*13, gy)*PS;
        if(this._off(cx, cy, 40)) continue;
        this._flatEllipse(ctx, cx, cy, 14+hv*22,
          hv > 0.88 ? "rgba(86,116,72,0.085)" : (hv > 0.70 ? "rgba(62,86,58,0.070)" : "rgba(48,60,44,0.060)"), 0.66);
      }
    }

    /* ---- 6. 户外 160 网格（真投影：地面直线的两端投影后连线，近粗远细自然出现） ---- */
    const G = 160, span = 1900;
    ctx.beginPath();
    for(let gx=Math.floor((p.x-span)/G)*G; gx<=p.x+span; gx+=G) this._segPath(ctx, gx, p.y-span, gx, p.y+span);
    for(let gy=Math.floor((p.y-span)/G)*G; gy<=p.y+span; gy+=G) this._segPath(ctx, p.x-span, gy, p.x+span, gy);
    ctx.strokeStyle = "rgba(120,160,110,0.062)"; ctx.lineWidth = 1; ctx.stroke();

    /* ---- 7. 泄洪后的库底：淤泥 + 残水洼 ---- */
    if(R.damOpen && R.reservoirRect){
      const rr = R.reservoirRect;
      if(this._poly(ctx, this._rectPoly(rr.x, rr.y, rr.w, rr.h), "#35312a")){
        for(let y=rr.y+46; y<rr.y+rr.h; y+=72){
          this._poly(ctx, this._rectPoly(rr.x, y, rr.w, 24), "rgba(72,66,52,0.45)");
        }
        for(let i=0;i<7;i++){
          const bx2 = rr.x+120+((i*283)%Math.max(1, rr.w-260));
          const by2 = rr.y+90+((i*197)%Math.max(1, rr.h-160));
          if(this._poly(ctx, this._rectPoly(bx2, by2, 52, 34), "rgba(58,46,34,0.92)")) continue;
        }
        for(let i=0;i<9;i++){
          const wx = rr.x+80+((i*157)%Math.max(1, rr.w-160));
          const wy = rr.y+rr.h-80-((i*211)%260);
          this._flatEllipse(ctx, wx, wy, 58+((i*37)%46), "rgba(46,86,104,0.55)", 0.36);
        }
      }
    }

    /* ---- 8. 大坝水库 ---- */
    if(R.reservoirRect && !R.damOpen){
      const rr = R.reservoirRect;
      if(this._poly(ctx, this._rectPoly(rr.x, rr.y, rr.w, rr.h), "rgba(20,38,50,0.97)")){
        this._poly(ctx, this._rectPoly(rr.x, rr.y+26, rr.w, rr.h-26), "rgba(32,58,74,0.5)");
        this._line(ctx, rr.x, rr.y+2, rr.x+rr.w, rr.y+2, "rgba(130,190,210,0.22)", 3);
        for(let i=0;i<26;i++){
          const wy = rr.y+44+((i*67)%Math.max(1, rr.h-64));
          const wx = rr.x+30+((i*233)%Math.max(1, rr.w-200));
          this._line(ctx, wx, wy, wx+120+((i*31)%110), wy, "rgba(150,200,215,0.10)", 2);
        }
      }
    }

    /* ---- 9. 中央河谷水面 ---- */
    if(R.waterCircles){
      const wOut = this._wout || (this._wout = []), wIn = this._win || (this._win = []);
      wOut.length = 0; wIn.length = 0;
      for(const c of R.waterCircles){
        if(this._off(c.x, c.y, c.r)) continue;
        wOut.push(this._circlePoly(c.x, c.y, c.r+2, 14));
        wIn.push(this._circlePoly(c.x, c.y, c.r*0.52, 12));
      }
      if(wOut.length){
        ctx.beginPath(); for(const q of wOut) this._polyPath(ctx, q);
        ctx.fillStyle = "rgba(20,38,50,0.96)"; ctx.fill();
        ctx.beginPath(); for(const q of wIn) this._polyPath(ctx, q);
        ctx.fillStyle = "rgba(30,56,72,0.55)"; ctx.fill();
      }
      for(let i=0;i<R.waterCircles.length;i+=5){
        const c = R.waterCircles[i];
        if(this._behind(c.x, c.y, c.r)) continue;
        const wv = R._hash2(c.x|0, c.y|0);
        this._line(ctx, c.x-c.r*0.36, c.y+(wv-0.5)*50, c.x+c.r*0.36, c.y+(wv-0.5)*50, "rgba(150,200,215,0.12)", 1.6);
      }
    }

    /* ---- 10. 桥面 ---- */
    for(const b of (R.bridges||[])){
      const x0 = b.x-b.w/2, y0 = b.y-b.h/2;
      if(this._behind(b.x, b.y, Math.hypot(b.w, b.h)/2)) continue;
      if(!this._poly(ctx, this._rectPoly(x0, y0, b.w, b.h), b.big ? "#2b3036" : "#25282c")) continue;
      this._poly(ctx, this._rectPoly(x0, y0, b.w, 4), "rgba(150,160,170,0.14)");
      // 桥墩
      for(let px=x0+40; px<x0+b.w-30; px+=110){
        this._poly(ctx, this._rectPoly(px, y0+b.h*0.32, 16, b.h*0.36), "rgba(24,28,32,0.55)");
      }
      if(b.big){
        for(let d=10; d<b.w-28; d+=32) this._line(ctx, x0+d, b.y, x0+d+18, b.y, "rgba(226,196,86,0.55)", 2);
      }
      this._line(ctx, x0, y0, x0+b.w, y0, "rgba(96,106,116,0.85)", 3);
      this._line(ctx, x0, y0+b.h, x0+b.w, y0+b.h, "rgba(96,106,116,0.85)", 3);
    }

    /* ---- 11. 铁路：路基 + 枕木 + 双轨 ---- */
    for(const rl of (R.rails||[])){
      for(let s=0;s<rl.pts.length-1;s++){
        const [x1,y1] = rl.pts[s], [x2,y2] = rl.pts[s+1];
        const ang = Math.atan2(y2-y1, x2-x1), len = Math.hypot(x2-x1, y2-y1);
        const mx = (x1+x2)/2, my = (y1+y2)/2;
        if(this._behind(mx, my, len/2+26)) continue;
        // 路基（一条与轨道同向的带）
        this._flatBar(ctx, mx, my, len/2, 26, ang, "rgba(40,40,38,0.55)");
        // 枕木
        const cx = Math.cos(ang), sy2 = Math.sin(ang);
        const stepD = len > 900 ? 60 : 30;          // 远处枕木抽稀，肉眼分辨不出来
        for(let d=0; d<len; d+=stepD){
          const px2 = x1+cx*d, py2 = y1+sy2*d;
          if(this._off(px2, py2, 26)) continue;
          this._flatBar(ctx, px2, py2, 5, 22, ang, "rgba(58,48,36,0.9)");
        }
        // 双轨
        const nx = -Math.sin(ang), ny = Math.cos(ang);
        this._line(ctx, x1+nx*14, y1+ny*14, x2+nx*14, y2+ny*14, "rgba(150,158,166,0.55)", 3);
        this._line(ctx, x1-nx*14, y1-ny*14, x2-nx*14, y2-ny*14, "rgba(150,158,166,0.55)", 3);
      }
    }

    /* ---- 12. 建筑院子：水泥地 + 分块缝 ---- */
    for(const yd of (R.yards||[])){
      if(this._behind(yd.x+yd.w/2, yd.y+yd.h/2, Math.hypot(yd.w, yd.h)/2)) continue;
      if(!this._poly(ctx, this._rectPoly(yd.x, yd.y, yd.w, yd.h), yd.tint || "#2a2f2c")) continue;
      ctx.save();
      for(let i=yd.x+70;i<yd.x+yd.w;i+=70) this._line(ctx, i, yd.y, i, yd.y+yd.h, "rgba(170,200,180,0.05)", 1);
      for(let i=yd.y+70;i<yd.y+yd.h;i+=70) this._line(ctx, yd.x, i, yd.x+yd.w, i, "rgba(170,200,180,0.05)", 1);
      ctx.restore();
    }

    /* ---- 13. 房间地面 + 砖缝 + 踢脚板 ---- */
    for(const rm of (R.roomRects||[])){
      if(this._behind(rm.x+rm.w/2, rm.y+rm.h/2, Math.hypot(rm.w, rm.h)/2)) continue;
      if(!this._poly(ctx, this._rectPoly(rm.x, rm.y, rm.w, rm.h), rm.extract ? "#25452f" : (rm.tint || "#2a2f2c"))) continue;
      this._poly(ctx, this._rectPoly(rm.x, rm.y, rm.w, rm.h), "rgba(0,0,0,0.16)");
      for(let gx=rm.x+40; gx<rm.x+rm.w; gx+=60) this._line(ctx, gx, rm.y, gx, rm.y+rm.h, "rgba(170,200,180,0.06)", 1);
      for(let gy=rm.y+40; gy<rm.y+rm.h; gy+=60) this._line(ctx, rm.x, gy, rm.x+rm.w, gy, "rgba(170,200,180,0.06)", 1);
      // 踢脚板：沿房间内侧一圈深色墙裙（2D 同款 inset 4 / 8）
      const ix = rm.x+4, iy = rm.y+4, iw = rm.w-8, ih = rm.h-8;
      this._line(ctx, ix, iy, ix+iw, iy, "rgba(0,0,0,0.20)", 4);
      this._line(ctx, ix, iy+ih, ix+iw, iy+ih, "rgba(0,0,0,0.20)", 4);
      this._line(ctx, ix, iy, ix, iy+ih, "rgba(0,0,0,0.20)", 4);
      this._line(ctx, ix+iw, iy, ix+iw, iy+ih, "rgba(0,0,0,0.20)", 4);
    }

    /* ---- 14. 地表贴花：油渍 / 血渍 / 裂缝 / 草簇 / 碎石 / 标线 / 涂鸦 ---- */
    const pfc = this._pf;
    for(const d of (R.decals||[])){
      const dep = (d.x-pfc.p.x)*pfc.ca + (d.y-pfc.p.y)*pfc.sa;
      if(dep < 8 || dep > 900) continue;            // 贴花很小，900 之外看不见
      if(this._off(d.x, d.y, 60)) continue;
      switch(d.t){
        case "oil":
          this._flatEllipse(ctx, d.x, d.y, d.r||16, "rgba(8,14,10,"+(d.a||0.08)+")", 0.5);
          this._flatEllipse(ctx, d.x-d.r*0.18, d.y-d.r*0.14, (d.r||16)*0.34, "rgba(90,110,95,"+((d.a||0.08)*0.5)+")", 0.5);
          break;
        case "stain":
          this._flatEllipse(ctx, d.x, d.y, d.r||14, "rgba(70,54,38,"+(d.a||0.06)+")", 0.5);
          break;
        case "blood":
          this._flatEllipse(ctx, d.x, d.y, d.r||12, "rgba(120,22,26,"+(d.a||0.1)+")", 0.5);
          this._flatEllipse(ctx, d.x+d.r*0.4, d.y+d.r*0.2, (d.r||12)*0.4, "rgba(90,16,20,"+((d.a||0.1)*0.8)+")", 0.5);
          break;
        case "grass":
          this._flatEllipse(ctx, d.x, d.y, d.r||14, "rgba(74,104,62,0.13)", 0.6);
          break;
        case "rocklet":
          this._flatEllipse(ctx, d.x, d.y, d.r||6, "rgba(150,158,150,0.16)", 0.6);
          break;
        case "crack": {
          const ang = d.ang||0, ww = d.w||40;
          const c0 = Math.cos(ang), s0 = Math.sin(ang);
          this._line(ctx, d.x-c0*ww/2, d.y-s0*ww/2, d.x+c0*ww/2, d.y+s0*ww/2, "rgba(150,160,150,0.13)", 1.4);
          this._line(ctx, d.x, d.y, d.x+Math.cos(ang+1.1)*ww*0.3, d.y+Math.sin(ang+1.1)*ww*0.3, "rgba(150,160,150,0.13)", 1.2);
          break;
        }
        case "line": {
          const ang = d.ang||0, ww = d.w||60;
          this._flatBar(ctx, d.x, d.y, ww/2, 3, ang, "rgba(220,210,150,"+(d.a||0.06)+")");
          break;
        }
        case "glyph":
          this._flatEllipse(ctx, d.x, d.y, d.r||16, d.c || "#b84a3a", 0.55);
          break;
      }
    }

    /* ---- 15. 区域明暗暗斑（2D 同源数据，压成地面上的大椭圆） ---- */
    for(const s of (R.darkSpots||[])){
      if(this._behind(s.x, s.y, s.r)) continue;
      const sc = this._toScreen(s.x, s.y);
      if(!sc || sc[2] < 20) continue;
      const rr = (s.r/sc[2])*this._pf.proj;
      if(rr < 2 || rr > 4000) continue;
      const g = ctx.createRadialGradient(sc[0], sc[1], 0, sc[0], sc[1], rr);
      g.addColorStop(0, "rgba(2,6,10,"+(s.a||0.1)+")");
      g.addColorStop(1, "rgba(2,6,10,0)");
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.ellipse(sc[0], sc[1], rr, rr*0.5, 0, 0, 6.2832); ctx.fill();
    }

    /* ---- 15.5 房间名（2D 在房间底部写名字，3D 贴到房间中心偏下，近处才显示） ---- */
    ctx.textAlign = "center";
    for(const rm of (R.roomRects||[])){
      if(rm.extract || !rm.name) continue;
      const cx = rm.x + rm.w/2, cy = rm.y + rm.h - 40;
      const sp = this._toScreen(cx, cy);
      if(!sp || sp[2] > 1300 || sp[2] < 40) continue;
      const size = Math.max(11, Math.min(26, (46/sp[2])*this._pf.proj*0.55));
      ctx.font = "bold " + size.toFixed(0) + "px system-ui,sans-serif";
      ctx.fillStyle = "rgba(210,222,235,0.30)";
      ctx.fillText(rm.name, sp[0], sp[1]);
    }

    /* ---- 16. 地面距离雾：把远景压进雾里，地面才不像一块立起来的色板 ---- */
    const fog = ctx.createLinearGradient(0, horizon, 0, h);
    fog.addColorStop(0, "rgba(20,27,32,0.62)");
    fog.addColorStop(0.10, "rgba(19,25,30,0.34)");
    fog.addColorStop(0.30, "rgba(16,21,25,0.10)");
    fog.addColorStop(1, "rgba(14,18,21,0)");
    ctx.fillStyle = fog; ctx.fillRect(0, horizon, w, h-horizon);
    // 补一层极淡的环境光：2D 的画面是全场可见的，3D 不该压成纯夜景
    ctx.fillStyle = "rgba(150,172,184,0.045)"; ctx.fillRect(0, horizon, w, h-horizon);

    ctx.restore();
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
    vig.addColorStop(0.55, "rgba(5,8,10,0.14)");
    vig.addColorStop(1, "rgba(4,7,9,0.42)");
    ctx.fillStyle = vig; ctx.fillRect(0, 0, w, h);

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    // 2) 玩家手电：2D 是 560 射程 ±0.42rad 的暖色锥；第一人称等价于屏幕中下偏窄的暖色亮斑
    const reach = Math.max(w, h) * 0.52;
    const g = ctx.createRadialGradient(cx, h*0.60, Math.max(8, reach*0.06), cx, h*0.60, reach);
    // 色值与 2D _lightLayer 手电锥完全一致（255,236,182 / 255,224,160），只压强度
    g.addColorStop(0, "rgba(255,236,182,0.20)");
    g.addColorStop(0.5, "rgba(255,224,160,0.075)");
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
    // 前臂：从画布底边伸上来，握拳位置在 (10, -128)
    ctx.fillStyle = "#333f39";
    ctx.beginPath();
    ctx.moveTo(-14, -112); ctx.lineTo(78, -150); ctx.lineTo(196, 150); ctx.lineTo(74, 210);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.05)";
    ctx.beginPath();
    ctx.moveTo(4, -120); ctx.lineTo(56, -140); ctx.lineTo(122, 70); ctx.lineTo(70, 92);
    ctx.closePath(); ctx.fill();
    // 袖口
    ctx.fillStyle = "#28322d";
    ctx.beginPath();
    ctx.moveTo(96, 40); ctx.lineTo(196, 150); ctx.lineTo(74, 210); ctx.lineTo(34, 110);
    ctx.closePath(); ctx.fill();

    // 刀柄（握拳处）
    ctx.fillStyle = "#1f2529";
    ctx.beginPath();
    ctx.moveTo(-16, -152); ctx.lineTo(46, -174); ctx.lineTo(68, -114); ctx.lineTo(2, -94);
    ctx.closePath(); ctx.fill();
    // 护手
    ctx.fillStyle = "#3a4448";
    ctx.beginPath();
    ctx.moveTo(-28, -160); ctx.lineTo(0, -172); ctx.lineTo(20, -124); ctx.lineTo(-10, -112);
    ctx.closePath(); ctx.fill();
    // 刀身（指向左上方）
    ctx.fillStyle = "#8894a0";
    ctx.beginPath();
    ctx.moveTo(-24, -162); ctx.lineTo(-168, -244); ctx.lineTo(-192, -232); ctx.lineTo(-40, -128);
    ctx.closePath(); ctx.fill();
    // 刀背高光
    ctx.fillStyle = "rgba(220,232,240,0.26)";
    ctx.beginPath();
    ctx.moveTo(-28, -164); ctx.lineTo(-164, -240); ctx.lineTo(-166, -230); ctx.lineTo(-34, -150);
    ctx.closePath(); ctx.fill();
    // 握拳
    this._glove(ctx, 6, -124, 1.0, -0.16);
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
