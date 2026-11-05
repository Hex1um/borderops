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
  sensitivity: 1.0,
  minimap: false,      // v0.19.1：3D 不再提供小地图（已在设置里移除入口）
  pointerLock: false,  // 点击画面锁定鼠标
  _from: "pause",
  _drag: null,
  _yawFor: null,        // 已经为哪个玩家对象定过朝向（换局 / 换维度时重置）

  is3D(){ return this.mode === "3d"; },

  load(){
    try{
      const raw = localStorage.getItem(this.KEY);
      if(!raw) return;
      const s = JSON.parse(raw);
      if(s && (s.mode === "2d" || s.mode === "3d")) this.mode = s.mode;
      if(typeof s.sensitivity === "number") this.sensitivity = Math.max(0.3, Math.min(2.5, s.sensitivity));
      if(typeof s.pointerLock === "boolean") this.pointerLock = s.pointerLock;
    }catch(e){}
  },
  save(){
    try{
      localStorage.setItem(this.KEY, JSON.stringify({
        mode:this.mode, sensitivity:this.sensitivity, minimap:this.minimap, pointerLock:this.pointerLock,
      }));
    }catch(e){}
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
      if(R && R.active && p) this._yawFor = null;   // 让 ensureYaw 在下一帧接手
    } else {
      try{
        const cv = document.getElementById("game");
        if(cv) { Input.mouse.sx = cv.clientWidth/2; Input.mouse.sy = cv.clientHeight/2 - 60; }
      }catch(e){}
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
    if(!this.is3D() || !R || !R.active || !R.player) return;
    if(this._yawFor === R.player) return;
    this.yaw = this.pickOpenYaw(R);
    this._yawFor = R.player;
  },

  /* ----------------------------- 输入 ----------------------------- */
  _turn(dx){
    this.yaw += dx * 0.0022 * this.sensitivity;
    if(this.yaw > Math.PI*4 || this.yaw < -Math.PI*4) this.yaw %= Math.PI*2;
  },
  _releaseLock(){
    try{ if(document.pointerLockElement) document.exitPointerLock(); }catch(e){}
  },

  bindInput(){
    /* 桌面：鼠标相对位移转向。不强制锁定鼠标，移到边缘仍可用 pointerLock 补救。 */
    window.addEventListener("mousemove", (e)=>{
      if(!this.is3D()) return;
      if(typeof UI !== "undefined" && UI.overlay && !UI.overlay.classList.contains("hidden")) return;
      const dx = e.movementX || 0;
      if(dx) this._turn(dx);
    });

    /* 键盘备用：V 在局内战局里随时切换维度（设置面板只在局内出现，所以给一个快捷键）；
     * [ ] 在 3D 下做小幅转向，方向键仍保留给移动。 */
    window.addEventListener("keydown", (e)=>{
      const inRaid = (typeof Raid !== "undefined") && Raid.active;
      if(e.code === "KeyV" && inRaid){ this.toggle(); return; }
      if(!this.is3D()) return;
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
      cv.addEventListener("click", ()=>{
        if(!this.is3D() || !this.pointerLock) return;
        if(!document.pointerLockElement && cv.requestPointerLock) cv.requestPointerLock();
      });
    }

    /* 设置入口只在局内（暂停面板）。标题页不提供 2D/3D 开关，维度属于「战局内显示选项」。 */
    document.addEventListener("click", (e)=>{
      if(e.target.closest && e.target.closest("#btn-pause-settings")){
        e.preventDefault(); this.openSettings("pause");
      } else if(e.target.closest && e.target.closest("#vm-back")){
        e.preventDefault(); this.closeSettings();
      }
    });
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
               鼠标移动转向 · <span class="kbd">W A S D</span> 前后左右移动 · <span class="kbd">左键</span> 开火<br>
               <span class="kbd">[</span> <span class="kbd">]</span> 键盘转向 · <span class="kbd">V</span> 快速切换维度 ·
               <span class="kbd">E</span> 交互 / 搜索 · <span class="kbd">Tab</span> 物品栏<br>
               3D 视图由同一份地图 / 墙 / 单位数据实时投射渲染，拾取、AI、撤离等规则完全不变。`
            : `<b style="color:var(--accent);">俯视角模式</b><br>
               原有的 2D 俯视渲染：<span class="kbd">W A S D</span> 移动 · 鼠标瞄准 · 左键开火。<br>
               这是游戏默认状态，切换维度不会丢失任何战局进度。`}
        </div>

        <div style="margin:18px 0;text-align:left;font-size:14px;line-height:2.2;">
          <div>鼠标灵敏度　<input id="vm-sens" type="range" min="0.3" max="2.5" step="0.1" value="${this.sensitivity}" style="vertical-align:middle;width:190px;">　<span id="vm-sens-val">${this.sensitivity.toFixed(1)}×</span></div>
          <label style="cursor:pointer;"><input id="vm-lock" type="checkbox" ${this.pointerLock?"checked":""} style="vertical-align:middle;"> 点击画面锁定鼠标（按 ESC 退出）</label>
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
    const lk = document.getElementById("vm-lock");
    if(lk) lk.onchange = ()=>{
      this.pointerLock = !!lk.checked; this.save();
      if(!this.pointerLock) this._releaseLock();
    };
  },
};

ViewMode.load();
ViewMode.bindInput();
