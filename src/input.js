/* =========================================================================
 * input.js — 桌面键鼠 + 移动端「元气骑士式」单摇杆
 *
 * 移动端：左半屏任意处按下 → 浮动摇杆出现，拖动移动；松手归位。
 *         无需右摇杆：每帧自动锁定最近敌人，平滑转向并自动开火。
 * 桌面  ：WASD 移动，鼠标瞄准，左键开火。
 * ========================================================================= */

const Input = {
  keys:{},
  mouse:{sx:0, sy:0, down:false, seen:false},
  isTouch:false,
  stick:{active:false, id:null, cx:0, cy:0, dx:0, dy:0, mag:0, born:0},
  stickRadius:76,
  act:{reload:false, ability:false, interact:false, med:false, switch:false, slot:0, skill:false, inv:false, pause:false, melee:false, buy:false, nade:false},
  useHeld:false,            // 沙二：按住 E 下包/拆包（触摸用）

  aimTarget:null,
  aimAngle:0,
  moveMag:0,
  _firing:false,
  _autoFiring:false,
  fireHeld:false,        // 开火键是否被按住
  autoFire:true,         // 自动开火开关（关掉后必须按开火键）
  _firePointer:null,
  game:null,
  canvas:null,

  init(game){
    this.game=game;
    this.canvas=game.canvas;
    // 主指针为粗指针（触摸）才走移动端逻辑，避免触屏笔记本被误判
    const coarse = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
    const hasTouch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
    this.isTouch = hasTouch && (coarse || window.innerWidth <= 820);

    /* ----- 键盘 ----- */
    window.addEventListener('keydown',(e)=>{
      this.keys[e.code]=true;
      if(['Tab','Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code)) e.preventDefault();
      switch(e.code){
        case 'KeyR': this.act.reload=true; break;
        case 'Space': this.act.ability=true; break;
        case 'KeyE': this.act.interact=true; break;
        // keys['KeyE'] / keys['Space'] 由下面的 keyup 清零，Raid 用它做长按判定
        case 'KeyH': this.act.med=true; break;
        case 'KeyF': this.act.melee=true; break;
        case 'KeyQ': this.act.switch=true; break;
        case 'Digit1': this.act.slot=1; break;
        case 'Digit2': this.act.slot=2; break;
        case 'Digit3': this.act.slot=3; break;
        case 'Digit4': this.act.slot=4; break;
        case 'KeyK': this.act.skill=true; break;
        case 'KeyB': this.act.buy=true; break;
        case 'KeyG': this.act.nade=true; break;
        case 'Tab': this.act.inv=true; break;
        case 'Escape': this.act.pause=true; break;
      }
    });
    window.addEventListener('keyup',(e)=>{ this.keys[e.code]=false; });

    /* ----- 鼠标（桌面） ----- */
    if(!this.isTouch){
      const cv=game.canvas;
      cv.addEventListener('mousemove',(e)=>{
        const r=cv.getBoundingClientRect();
        this.mouse.sx=e.clientX-r.left; this.mouse.sy=e.clientY-r.top; this.mouse.seen=true;
      });
      cv.addEventListener('mousedown',(e)=>{ if(e.button===0) this.mouse.down=true; });
      window.addEventListener('mouseup',(e)=>{ if(e.button===0) this.mouse.down=false; });
      cv.addEventListener('contextmenu',(e)=>e.preventDefault());
    }

    /* ----- 触摸 ----- */
    if(this.isTouch) this._initTouch();

    // 失焦时清空状态，避免按键/摇杆卡住
    window.addEventListener('blur',()=>{ this.keys={}; this.mouse.down=false; this.resetStick(); });
  },

  /* ----------------------------- 触摸初始化 ----------------------------- */
  _initTouch(){
    const layer=document.getElementById('touch-layer');
    if(layer) layer.classList.remove('hidden');
    this._layoutJoystickZone();
    this._syncAutoBtn();

    const opts={passive:false};

    const onDown=(e)=>{
      if(e.pointerType==='mouse') return;          // 鼠标事件走桌面逻辑
      if(this._isUiTarget(e.target)) return;        // 按钮自行处理
      if(this.stick.active) return;                 // 已有一根手指在控制
      this.stick.active=true; this.stick.id=e.pointerId;
      this.stick.cx=e.clientX; this.stick.cy=e.clientY;
      this.stick.dx=0; this.stick.dy=0; this.stick.mag=0;
      this.stick.born=performance.now();
      e.preventDefault();
    };

    const onMove=(e)=>{
      if(!this.stick.active || e.pointerId!==this.stick.id) return;
      let dx=e.clientX-this.stick.cx, dy=e.clientY-this.stick.cy;
      const R=this.stickRadius, len=Math.hypot(dx,dy);
      if(len>R){ dx=dx/len*R; dy=dy/len*R; }
      this.stick.dx=dx/R; this.stick.dy=dy/R;
      this.stick.mag=Math.min(1,len/R);
      // 摇杆底座随手指轻微漂移（超出半径时跟随），避免手指移到屏幕边缘拉不满
      if(len>R){
        this.stick.cx=e.clientX-dx; this.stick.cy=e.clientY-dy;
      }
      e.preventDefault();
    };

    const onUp=(e)=>{
      if(e.pointerId!==this.stick.id) return;
      this.resetStick();
    };

    window.addEventListener('pointerdown', onDown, opts);
    window.addEventListener('pointermove', onMove, opts);
    window.addEventListener('pointerup', onUp, opts);
    window.addEventListener('pointercancel', onUp, opts);

    // iOS：阻止双指缩放与长按菜单
    document.addEventListener('gesturestart',(e)=>e.preventDefault());
    document.addEventListener('contextmenu',(e)=>e.preventDefault());

    // 星键：战役=职业技能；塔科夫=搜索/交互（与医疗键完全分开）
    /* v0.24.0：改成按住型 —— 短按仍是一次性 act.ability，长按由 useHeld 告诉 Raid。
       useHeld 原本只给沙二下包用，两种模式不会同时运行，复用不冲突。 */
    this._bindHold('touch-ability',
      ()=>{ this.act.ability=true; this.useHeld=true; },
      ()=>{ this.useHeld=false; });
    this._bindBtn('touch-switch',  ()=>{ this.act.switch=true; });
    // 加号键：只负责医疗（塔科夫=绷带/药品，大逃杀=医疗）
    this._bindBtn('touch-med',     ()=>{ this.act.med=true; });
    this._bindBtn('touch-inv',     ()=>{ this.act.inv=true; });
    this._bindBtn('touch-reload',  ()=>{ this.act.reload=true; });
    this._bindBtn('touch-pause',   ()=>{ this.act.pause=true; });
    this._bindBtn('touch-auto',    ()=>{ this.toggleAutoFire(); });
    this._bindBtn('touch-buy',     ()=>{ this.act.buy=true; });
    // 下包 / 拆包：按住生效
    this._bindHold('touch-use',
      ()=>{ this.useHeld=true; },
      ()=>{ this.useHeld=false; });

    // 开火键：按住持续射击，松开停火（手指滑出按钮也能正确松开）
    this._bindHold('touch-fire',
      ()=>{ this.fireHeld=true; },
      ()=>{ this.fireHeld=false; });
  },

  _layoutJoystickZone(){
    // 摇杆可激活区域：左 58% 屏幕、底边向上 78% —— 由 pointerdown 位置决定，无需固定底座
    this.zone={w:window.innerWidth, h:window.innerHeight};
    window.addEventListener('resize',()=>{ this.zone={w:window.innerWidth,h:window.innerHeight}; this.resetStick(); });
  },

  _bindBtn(id, fn){
    const el=document.getElementById(id);
    if(!el) return;
    el.addEventListener('pointerdown',(e)=>{
      e.preventDefault(); e.stopPropagation();
      if(el.disabled) return;
      fn();
      el.classList.add('pressed');
      setTimeout(()=>el.classList.remove('pressed'),110);
    }, {passive:false});
  },

  // 按住型按钮：down 触发开始，全局 up 结束（手指移出按钮也不丢事件）
  _bindHold(id, onDown, onUp){
    const el=document.getElementById(id);
    if(!el) return;
    let pid=null;
    el.addEventListener('pointerdown',(e)=>{
      e.preventDefault(); e.stopPropagation();
      if(pid!==null) return;
      pid=e.pointerId; onDown();
      el.classList.add('pressed');
      el.classList.add('held');
    }, {passive:false});
    const up=(e)=>{
      if(pid===null) return;
      if(e && e.pointerId!==undefined && e.pointerId!==pid) return;
      pid=null; onUp();
      el.classList.remove('pressed');
      el.classList.remove('held');
    };
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  },

  toggleAutoFire(){
    this.autoFire=!this.autoFire;
    this._syncAutoBtn();
    if(this.game) this.game.toast(this.autoFire ? "自动开火" : "手动开火，按住扳机");
    SFX.ui();
  },
  _syncAutoBtn(){
    const el=document.getElementById('touch-auto');
    if(el){
      el.classList.toggle('on', this.autoFire);
      el.textContent = this.autoFire ? "AUTO" : "MAN";
    }
  },

  _isUiTarget(el){
    return !!(el && el.closest && el.closest('button, .touch-btn, #overlay, .btn'));
  },

  resetStick(){
    this.stick.active=false; this.stick.id=null;
    this.stick.dx=0; this.stick.dy=0; this.stick.mag=0;
  },

  /* ----------------------------- 每帧采样 ----------------------------- */
  sample(game){
    const p=game.player; if(!p) return;

    /* 移动 */
    let mx=0, my=0;
    if(this.isTouch){
      if(this.stick.active) { mx=this.stick.dx; my=this.stick.dy; }
    } else {
      if(this.keys['KeyW']||this.keys['ArrowUp']) my-=1;
      if(this.keys['KeyS']||this.keys['ArrowDown']) my+=1;
      if(this.keys['KeyA']||this.keys['ArrowLeft']) mx-=1;
      if(this.keys['KeyD']||this.keys['ArrowRight']) mx+=1;
    }
    let ml=Math.hypot(mx,my);
    if(ml>1){ mx/=ml; my/=ml; ml=1; }
    p.moveX=mx; p.moveY=my;
    this.moveMag=ml;

    /* 瞄准 / 开火 */
    if(this.isTouch){
      this._autoAim(game,p);
      // 开火键按住 = 强制开火；否则看自动开火开关
      this._firing = this.fireHeld || (this.autoFire && this._autoFiring);
    } else {
      this._mouseAim(game,p);
    }
  },

  /* 自动锁定「最近的敌人」——每帧重新求最近，目标一旦被别的敌人抢近就立刻切换 */
  _autoAim(game,p){
    const RANGE=560, R2=RANGE*RANGE;
    let best=null, bd=R2;
    for(let i=0;i<game.enemies.length;i++){
      const e=game.enemies[i];
      if(!e.alive) continue;
      const d=M.dist2(p.x,p.y,e.x,e.y);
      if(d<bd){ bd=d; best=e; }
    }
    this.aimTarget=best;
    if(best){
      // 提前量预测：按弹速与距离推算目标未来位置，移动目标才打得中
      const w=p.activeWeapon;
      const bs=w?w.stats.speed:800;
      const d=Math.sqrt(bd);
      const t=d/Math.max(220,bs);
      const tx=best.x+(best.vx||0)*t*0.85;
      const ty=best.y+(best.vy||0)*t*0.85;
      const want=M.angle(p.x,p.y,tx,ty);
      // 快速收敛，兼顾手感与命中
      p.angle=M.lerpAngle(p.angle, want, 0.5);
      this.aimAngle=want;
      this._autoFiring=true;
    } else {
      // 无目标：面朝移动方向，不开火
      if(this.moveMag>0.12){
        const want=Math.atan2(p.moveY,p.moveX);
        p.angle=M.lerpAngle(p.angle, want, 0.3);
      }
      this.aimAngle=p.angle;
      this._autoFiring=false;
    }
  },

  /* 鼠标瞄准 */
  _mouseAim(game,p){
    const ps=game.worldToScreen(p.x,p.y);
    if(this.mouse.down){
      const a=Math.atan2(this.mouse.sy-ps.y, this.mouse.sx-ps.x);
      p.angle=a; this.aimAngle=a; this._firing=true;
    } else {
      if(this.mouse.seen){
        const a=Math.atan2(this.mouse.sy-ps.y, this.mouse.sx-ps.x);
        p.angle=a; this.aimAngle=a;
      }
      this._firing=false;
    }
  },

  /* 消费一次性动作 */
  consume(){
    const a=this.act;
    const out={...a};
    this.act={reload:false,ability:false,interact:false,med:false,switch:false,slot:0,skill:false,inv:false,pause:false,melee:false,buy:false,nade:false};
    return out;
  },
};
