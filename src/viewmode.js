/* =========================================================================
 * viewmode.js — 显示维度（2D 俯视 / 3D 第一人称）与游戏设置面板
 *
 *   设计意图：把「维度」做成一个独立子系统，主战场只保留 3 处最小钩子
 *   （渲染分支 / 朝向覆盖 / 移动方向旋转），新代码不再往 raid.js 里堆。
 *   零依赖经典脚本，状态存 localStorage，与联机 / 存档互不影响。
 * ========================================================================= */

const ViewMode = {
  KEY: "borderops_viewmode_v1",
  mode: "2d",          // "2d" 俯视角（原版） | "3d" 第一人称
  yaw: 0,              // 3D 视角朝向（弧度），等于玩家开火方向
  /* v0.33.0：俯仰（弧度）。旧版 3D 只能左右看，「瞄头」在物理上不可能，
     爆头只能靠随机 —— 用户要求「3D 有且仅有爆头会暴击」，必须先有纵向瞄准。 */
  pitch: 0,
  sensitivity: 1.0,
  minimap: false,      // v0.19.1：3D 不再提供小地图（已在设置里移除入口）
  /* v0.21.4：3D 默认锁定鼠标 —— Minecraft / FPS 那样的「鼠标永远锁在屏幕中心」。
   * ESC（浏览器会自己解掉指针锁）→ 当作用户要开菜单：自动弹出暂停面板，鼠标自由移动。 */
  pointerLock: true,
  LOCK_VER: 2,         // 锁定语义版本：旧存档的 false 一次性升级为 true
  _hasLock: false,     // 当前是否真的锁着（以 document.pointerLockElement 为准）
  _selfUnlock: false,  // 是我们主动放的锁（开面板 / 切回 2D），不该再顺手弹暂停面板
  _from: "pause",
  _drag: null,
  _yawFor: null,        // 已经为哪个玩家对象定过朝向（换局 / 换维度时重置）

  is3D(){ return this.mode === "3d"; },

  load(){
    /* v0.23.1：走 Store 统一读写。视角设置是纯偏好，单个字段坏掉只丢那一个字段，
       不整块作废 —— 所以这里不加 validate，逐字段校验在下面做。 */
    const s = Store.getJSON(this.KEY, null,
      v=>v && typeof v==="object" && !Array.isArray(v));
    if(!s) return;
    if(s.mode === "2d" || s.mode === "3d") this.mode = s.mode;
    /* Number.isFinite 而不是 typeof === "number"：JSON 里能写出 NaN / null 这类值，
       旧代码把 NaN 传进 Math.min 会得到 NaN，灵敏度一旦成 NaN 鼠标视角就整个失灵。 */
    if(Number.isFinite(s.sensitivity)) this.sensitivity = Math.max(0.3, Math.min(2.5, s.sensitivity));
    if(typeof s.pointerLock === "boolean") this.pointerLock = s.pointerLock;
    if(s.display === "compact" || s.display === "full") this.applyDisplay(s.display);
    /* 旧的 pointerLock 语义是「点一下画面才锁」，默认关；v0.21.4 改成默认锁定，
     * 所以旧存档里的 false 要一次性提上来 —— 之后再手动关掉就是用户自己的选择。 */
    if(s.lockVer !== this.LOCK_VER){ this.pointerLock = true; this.save(); }
  },
  save(){
    /* 纯用户偏好，写失败无需补偿；Store 已限流告警并降级到内存 */
    Store.setJSON(this.KEY, {
      mode:this.mode, sensitivity:this.sensitivity, minimap:this.minimap, pointerLock:this.pointerLock,
      lockVer:this.LOCK_VER,
      display:(typeof CFG!=="undefined"?(CFG.display||"compact"):"compact"),
    });
  },

  /* 显示密度：精简 / 完整（v0.21.1）
   * 只影响**显示**：枪名的厂商 / 前后缀、卡片里的厂商字段。
   * 存档里 name 永远是完整名，所以随时可以切回来（不会像改写 name 那样一去不回）。 */
  applyDisplay(mode){
    const m = (mode==="full") ? "full" : "compact";
    if(typeof CFG!=="undefined"){
      CFG.display = m;
      CFG.showManufacturer = (m==="full");
    }
    /* 已经缓存过 short 的枪在切到完整模式时不需要清 —— gunNameOf 会直接用 name。
     * 但切回精简时要保证缓存与当前 name 一致，所以统一清掉让它们重算。 */
    try{
      const st = (typeof RaidStash!=="undefined" && RaidStash.load) ? RaidStash.load() : null;
      if(st){ for(const w of (st.weapons||[])) if(w) delete w.short; }
      const R = (typeof Raid!=="undefined") ? Raid : null;
      if(R && R.inv){ for(const w of (R.inv.weapons||[])) if(w) delete w.short; }
    }catch(e){ /* 清缓存纯属优化：读档失败也只会让枪名晚一帧才更新，可忽略 */ }
    return m;
  },

  /* 切换维度：进入 3D 时沿用当前朝向并立刻按开阔度修正一次；
   * 退出时把鼠标放回屏幕中心，避免 2D 瞄准方向突变。 */
  set(mode){
    if(mode !== "2d" && mode !== "3d") return;
    const R = (typeof Raid !== "undefined") ? Raid : null;
    const p = (R && R.player) ? R.player : null;
    this._releaseLock();
    this._yawFor = null;
    if(mode === "3d"){
      this.yaw = p ? p.angle : this.yaw;
      this.pitch = 0;
      if(R && R.active && p) this._yawFor = null;   // 让 ensureYaw 在下一帧接手
    } else {
      try{
        const cv = document.getElementById("game");
        if(cv) { Input.mouse.sx = cv.clientWidth/2; Input.mouse.sy = cv.clientHeight/2 - 60; }
      }catch(e){ /* 画布尚未挂载时拿不到尺寸，下一帧会重新居中，可忽略 */ }
    }
    this.mode = mode;
    this.save();
    if(typeof SFX !== "undefined" && SFX.ui) SFX.ui();
  },
  toggle(){ this.set(this.is3D() ? "2d" : "3d"); },

  /* WASD 的世界方向 → 以视角为基准的「前后 / 左右」。输出保持单位长度。 */
  rotateMove(mx, my){
    if(!this.is3D() || (!mx && !my)) return { x:mx, y:my };
    const f = -my, r = mx;                 // W 前进 / D 右移
    const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
    return { x: c*f - s*r, y: s*f + c*r };
  },

  /* 单条射线到最近墙面的距离（AABB slab 求交）；起点在墙内时忽略该墙 */
  _rayDist(pool, px, py, a, limit){
    const dx = Math.cos(a), dy = Math.sin(a);
    const adx = Math.abs(dx) < 1e-9, ady = Math.abs(dy) < 1e-9;
    let d = limit;
    for(let i=0;i<pool.length;i++){
      const wl = pool[i];
      if(px >= wl.x-0.5 && px <= wl.x+wl.w+0.5 && py >= wl.y-0.5 && py <= wl.y+wl.h+0.5) continue;
      let tmin = 8, tmax = d;
      if(adx){ if(px < wl.x || px > wl.x+wl.w) continue; }
      else {
        let t1=(wl.x-px)/dx, t2=(wl.x+wl.w-px)/dx;
        if(t1>t2){ const t=t1;t1=t2;t2=t; }
        if(t1>tmin) tmin=t1;
        if(t2<tmax) tmax=t2;
        if(tmin>tmax) continue;
      }
      if(ady){ if(py < wl.y || py > wl.y+wl.h) continue; }
      else {
        let t1=(wl.y-py)/dy, t2=(wl.y+wl.h-py)/dy;
        if(t1>t2){ const t=t1;t1=t2;t2=t; }
        if(t1>tmin) tmin=t1;
        if(t2<tmax) tmax=t2;
        if(tmin>tmax) continue;
      }
      if(tmin < d) d = tmin;
    }
    return d;
  },

  /* 挑一个「最开阔」的朝向：24 个方向 × 3 条子射线取最小距离，
   * 这样不会选中一条只够侧身通过的门缝，而是真正看得远的方位。 */
  pickOpenYaw(R){
    const p = R && R.player;
    if(!p || !R.walls || !R.walls.length) return this.yaw;
    const pool = (typeof R._nearWalls === "function") ? R._nearWalls(p.x, p.y, 1200) : R.walls;
    const limit = 1200, spread = Math.PI/45;      // 子射线 ±4°
    let bestA = this.yaw, bestD = -1;
    for(let k=0; k<24; k++){
      const a = k*Math.PI/12;
      const d = Math.min(
        this._rayDist(pool, p.x, p.y, a-spread, limit),
        this._rayDist(pool, p.x, p.y, a, limit),
        this._rayDist(pool, p.x, p.y, a+spread, limit)
      );
      // 略微偏好当前朝向，避免与刚看到的画面差太多
      const score = d * (1 + 0.05*Math.cos(a-this.yaw));
      if(score > bestD){ bestD = score; bestA = a; }
    }
    return bestA;
  },

  /* 每个战局 + 每次切维度只定一次朝向；由第一人称渲染器每帧调用（幂等、开销极低） */
  ensureYaw(R){
    /* 兜底：战局结束 / 切回 2D / 面板弹出来时把指针锁放掉（render 每帧都会走到这里） */
    if(this._hasLock && !this._wantLock()) this._releaseLock();
    if(!this.is3D() || !R || !R.active || !R.player) return;
    if(this._yawFor === R.player) return;
    this.yaw = this.pickOpenYaw(R);
    this._yawFor = R.player;
  },

  /* ----------------------------- 输入 ----------------------------- */
  _turn(dx, dy){
    this.yaw += dx * 0.0022 * this.sensitivity;
    /* v0.33.0：纵轴 → 俯仰，限 ±0.30rad（约 ±17°）：能抬头看天、低头看脚前，不会翻过去 */
    if(dy) this.pitch = Math.max(-0.30, Math.min(0.30, this.pitch - dy*0.0018*this.sensitivity));
    if(this.yaw > Math.PI*4 || this.yaw < -Math.PI*4) this.yaw %= Math.PI*2;
  },

  /* ---------------------- 指针锁定（v0.21.4） ----------------------
   * 目标：3D 下鼠标**始终**锁在屏幕中心（视角跟手、光标不飞出窗口）；
   * 打开任何面板（暂停 / 设置 / 物品栏 / 商店）时自动放开，鼠标恢复自由移动。
   *
   * 浏览器限制：requestPointerLock 需要「用户手势」（点击 / 按键），否则静默失败。
   * 所以所有申请点都挂在真实输入上（点画面、按任意键、关掉面板的那一下点击）。 */
  isLocked(){ return !!this._hasLock; },

  /* 该不该锁：3D + 开关打开 + 战局在跑 + 没有任何面板开着 */
  _wantLock(){
    if(!this.is3D() || this.pointerLock === false) return false;
    const R = (typeof Raid !== "undefined") ? Raid : null;
    if(!R || !R.active) return false;
    if(typeof game !== "undefined" && game && game.state && game.state !== "playing") return false;
    if(typeof UI !== "undefined" && UI.overlay && !UI.overlay.classList.contains("hidden")) return false;
    return true;
  },

  /* 申请锁定：失败（iframe 没给 pointer-lock 权限 / 浏览器拒绝）就静默退回相对位移转向 */
  lock(){
    if(!this._wantLock() || this._hasLock) return;
    const cv = document.getElementById("game");
    if(!cv || !cv.requestPointerLock) return;
    try{
      const r = cv.requestPointerLock();
      /* 新版浏览器的 requestPointerLock 返回 Promise，用户按 ESC 或不满足
         用户手势条件时会 reject —— 这是正常的“没锁上”，不是错误。 */
      if(r && typeof r.then === "function") r.then(()=>{}).catch(()=>{});
    }catch(e){ /* 老浏览器同步抛错，同样只是没锁上 */ }
  },

  _releaseLock(){
    // 没锁着的时候不要把 _selfUnlock 留成 true，否则下一次真正的 ESC 会被忽略
    if(!document.pointerLockElement){ this._selfUnlock = false; return; }
    this._selfUnlock = true;
    try{ document.exitPointerLock(); }catch(e){ /* 本来就没锁时部分浏览器会抛，忽略 */ }
  },

  _onLockChange(){
    const el = document.pointerLockElement;
    const had = this._hasLock;
    this._hasLock = !!el && el.id === "game";
    const cv = document.getElementById("game");
    if(cv) cv.classList.toggle("locked", this._hasLock);
    if(had && !this._hasLock){
      const self = this._selfUnlock;
      this._selfUnlock = false;
      /* 用户按 ESC：浏览器吃掉那次 keydown 并解掉指针锁，页面收不到 Escape。
       * 所以在这里补一次「开菜单」，鼠标恢复自由 —— 与 Minecraft 的 ESC 行为一致。 */
      if(!self && this.is3D() && (typeof document === "undefined" || document.visibilityState !== "hidden")){
        const R = (typeof Raid !== "undefined") ? Raid : null;
        const overlayOpen = (typeof UI !== "undefined" && UI.overlay && !UI.overlay.classList.contains("hidden"));
        const G = (typeof game !== "undefined" && game) ? game : ((typeof window !== "undefined" && window.game) || null);
        if(R && R.active && !overlayOpen && G && typeof G.pause === "function"){
          try{ G.pause(); }catch(e){ warnOnce("viewmode:pause", e); }   // 走正规暂停：state="paused" + 弹暂停面板，战局计时停住
        }
      }
    }
  },

  bindInput(){
    /* 指针锁状态：锁上 → 隐藏光标、只吃相对位移；被解掉（ESC / 切窗口）→ 按需补一次暂停面板 */
    document.addEventListener("pointerlockchange", ()=>this._onLockChange());
    document.addEventListener("pointerlockerror", ()=>{ this._hasLock=false; });

    /* 桌面：鼠标相对位移转向。
     * 锁定后 clientX/Y 固定在锁点，只有 movementX 有意义；未锁定时仍按相对位移转向，
     * 保证 iframe 里拿不到 pointer-lock 权限时也能玩。 */
    window.addEventListener("mousemove", (e)=>{
      if(!this.is3D()) return;
      if(typeof UI !== "undefined" && UI.overlay && !UI.overlay.classList.contains("hidden")) return;
      const dx = e.movementX || 0, dy = e.movementY || 0;
      // 刚锁上 / 刚解锁那一下浏览器会给一个巨大的位移，丢掉，否则视角瞬移
      if(Math.abs(dx) > 260 || Math.abs(dy) > 260) return;
      if(dx || dy) this._turn(dx, dy);
    });

    /* 键盘备用：V 在局内战局里随时切换维度（设置面板只在局内出现，所以给一个快捷键）；
     * [ ] 在 3D 下做小幅转向，方向键仍保留给移动。 */
    window.addEventListener("keydown", (e)=>{
      const inRaid = (typeof Raid !== "undefined") && Raid.active;
      if(e.code === "KeyV" && inRaid){ this.toggle(); if(this.is3D()) this.lock(); return; }
      if(!this.is3D()) return;
      // 键盘也能触发锁定（keydown 属于用户手势）；面板开着时 _wantLock 会拦住
      if(!this._hasLock) this.lock();
      if(e.code === "BracketLeft")  this._turn(-90);
      if(e.code === "BracketRight") this._turn(90);
    });

    /* 触摸：右半屏拖动转向，左半屏仍是摇杆移动。 */
    const cv = document.getElementById("game");
    if(cv){
      cv.addEventListener("touchstart", (e)=>{
        if(!this.is3D()) return;
        const t = e.changedTouches[0];
        if(t.clientX > window.innerWidth*0.42) this._drag = { id:t.identifier, x:t.clientX };
      }, {passive:true});
      cv.addEventListener("touchmove", (e)=>{
        if(!this.is3D() || !this._drag) return;
        for(const t of e.changedTouches){
          if(t.identifier !== this._drag.id) continue;
          this._turn((t.clientX - this._drag.x) * 1.6);
          this._drag.x = t.clientX;
        }
      }, {passive:true});
      cv.addEventListener("touchend", ()=>{ this._drag = null; }, {passive:true});
      /* 桌面点画面 = 锁定鼠标（也是开火的那一下，两者不冲突：锁定是异步的） */
      cv.addEventListener("mousedown", ()=>{ if(this.is3D()) this.lock(); });
      cv.addEventListener("click", ()=>{ if(this.is3D()) this.lock(); });
    }

    /* 面板开 / 关：DOM 上只表现成 #overlay 的 hidden 类，直接盯属性最省事，
     * 不用往 raid.js 那几十个 UI.raidXxx 里各插一行。
     * 注意 bindInput 跑在 main.js 之前（那时 UI.init 还没执行、UI.overlay 还是 null），
     * 所以这里轮询等 overlay 挂上去。 */
    this._watchOverlay();

    /* 设置入口只在局内（暂停面板）。标题页不提供 2D/3D 开关，维度属于「战局内显示选项」。 */
    document.addEventListener("click", (e)=>{
      if(e.target.closest && e.target.closest("#btn-pause-settings")){
        e.preventDefault(); this.openSettings("pause");
      } else if(e.target.closest && e.target.closest("#vm-back")){
        e.preventDefault(); this.closeSettings();
      }
    });
  },

  _watchOverlay(){
    if(this._overlayWatched) return;
    const ov = (typeof UI !== "undefined") ? UI.overlay : null;
    if(ov && typeof MutationObserver === "function"){
      this._overlayWatched = true;
      new MutationObserver(()=>{
        const open = !ov.classList.contains("hidden");
        if(open){ this._releaseLock(); }               // 面板打开 → 鼠标自由移动
        else if(this.is3D()) this.lock();              // 面板关掉 → 回到锁定（这一下通常带着点击手势）
      }).observe(ov, { attributes:true, attributeFilter:["class"] });
      return;
    }
    this._watchTries = (this._watchTries||0) + 1;
    if(this._watchTries < 300 && typeof requestAnimationFrame === "function")
      requestAnimationFrame(()=>this._watchOverlay());
  },

  /* ----------------------------- 设置面板 ----------------------------- */
  openSettings(from){
    this._from = from || "title";
    this.renderSettings();
  },
  closeSettings(){
    try{
      if(this._from === "pause" && typeof UI.raidPause === "function") UI.raidPause();
      else if(typeof UI.title === "function") UI.title();
    }catch(e){ if(typeof UI !== "undefined" && UI.hide) UI.hide(); }
  },

  renderSettings(){
    const is3 = this.is3D();
    const disp = (typeof CFG!=="undefined" && CFG.display==="full") ? "full" : "compact";
    const btn = (id, on, label)=>`<button class="btn ${on?"":"ghost"}" id="${id}">${label}</button>`;
    const html = `
      <div class="panel" style="max-width:540px;text-align:center;">
        <h2 class="title-big" style="font-size:30px;">设置</h2>
        <div class="subtitle">显示与操作 · 仅在战局内可调（ESC 暂停 → 设置，或直接按 V） · 保存在本机浏览器</div>

        <h3 style="margin:22px 0 4px;">视图维度</h3>
        <div class="subtitle" style="margin-bottom:12px;">切换后立刻生效，战局数据与操作逻辑共用同一套模拟</div>
        <div class="row" style="justify-content:center;gap:10px;flex-wrap:wrap;">
          ${btn("vm-2d", !is3, "2D · 俯视角")}
          ${btn("vm-3d", is3, "3D · 第一人称")}
        </div>
        <div style="margin:14px 0 4px;padding:12px 14px;border:1px solid rgba(160,180,200,0.18);border-radius:10px;text-align:left;color:var(--muted);font-size:13px;line-height:1.75;">
          ${is3
            ? `<b style="color:var(--accent);">第一人称模式</b><br>
               鼠标<b style="color:var(--accent);">锁定在屏幕中心</b>（像 Minecraft）：直接移动鼠标转向，光标不会飘出窗口<br>
               <span class="kbd">ESC</span> 打开菜单，此时鼠标自动放开、可自由点选 · <span class="kbd">W A S D</span> 移动 ·
               <span class="kbd">左键</span> 开火<br>
               <span class="kbd">[</span> <span class="kbd">]</span> 键盘转向 · <span class="kbd">V</span> 快速切换维度 ·
               <span class="kbd">E</span> 交互 / 搜索 · <span class="kbd">Tab</span> 物品栏<br>
               3D 视图由同一份地图 / 墙 / 单位数据实时投射渲染，拾取、AI、撤离等规则完全不变。`
            : `<b style="color:var(--accent);">俯视角模式</b><br>
               原有的 2D 俯视渲染：<span class="kbd">W A S D</span> 移动 · 鼠标瞄准 · 左键开火。<br>
               这是游戏默认状态，切换维度不会丢失任何战局进度。`}
        </div>

        <div style="margin:18px 0;text-align:left;font-size:14px;line-height:2.2;">
          <div>鼠标灵敏度　<input id="vm-sens" type="range" min="0.3" max="2.5" step="0.1" value="${this.sensitivity}" style="vertical-align:middle;width:190px;">　<span id="vm-sens-val">${this.sensitivity.toFixed(1)}×</span></div>
          <div>显示　<span style="display:inline-flex;gap:6px;vertical-align:middle;">
            <button class="btn ghost small ${disp==="compact"?'on':''}" data-disp="compact" style="padding:2px 10px;font-size:12px;">精简</button>
            <button class="btn ghost small ${disp==="full"?'on':''}" data-disp="full" style="padding:2px 10px;font-size:12px;">完整</button>
          </span>　<span style="font-size:12px;color:var(--muted);">${disp==="full"?"厂商 + 型号 + 前后缀，信息最全":"只显示型号 / 枪型，界面更干净"}</span></div>
          <label style="cursor:pointer;"><input id="vm-lock" type="checkbox" ${this.pointerLock?"checked":""} style="vertical-align:middle;"> 3D 下锁定鼠标（推荐 · 关掉则靠鼠标相对位移转向，光标会跑到屏幕边缘）</label>
        </div>

        <div class="row" style="justify-content:center;margin-top:8px;">
          <button class="btn" id="vm-back">返回</button>
        </div>
      </div>`;
    UI._set(html);

    const pick = (id, fn)=>{ const el=document.getElementById(id); if(el) el.onclick=fn; };
    pick("vm-2d", ()=>{ this.set("2d"); this.renderSettings(); });
    pick("vm-3d", ()=>{ this.set("3d"); this.renderSettings(); });

    const sens = document.getElementById("vm-sens");
    if(sens) sens.oninput = ()=>{
      this.sensitivity = Math.max(0.3, Math.min(2.5, Number(sens.value)||1));
      const lab = document.getElementById("vm-sens-val");
      if(lab) lab.textContent = this.sensitivity.toFixed(1)+"×";
      this.save();
    };
    document.querySelectorAll("[data-disp]").forEach(el=>{
      el.onclick=()=>{ this.applyDisplay(el.dataset.disp); this.save(); SFX.ui(); this.renderSettings(); };
    });
    const lk = document.getElementById("vm-lock");
    if(lk) lk.onchange = ()=>{
      this.pointerLock = !!lk.checked; this.save();
      if(!this.pointerLock) this._releaseLock();
    };
  },
};

ViewMode.load();
ViewMode.bindInput();
