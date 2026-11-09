/* =========================================================================
 * util.js — 随机数 / 数学 / 通用工具
 * ========================================================================= */

// 可重播随机（mulberry32）
function makeRNG(seed){
  let a = seed >>> 0;
  const f = function(){
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  /* v0.28.0：暴露内部状态，供「确定性生成后精确恢复」用。
     每日特价要在渲染时按 时间桶+分支 重放一次货品，如果不管序列，
     房主与客户端的 RNG 会错位（生成链路靠同种子同步推进）。 */
  f.state   = () => a;
  f.restore = (s) => { a = s >>> 0; };
  return f;
}

const RNG = {
  rng: Math.random,
  setSeed(s){ this.rng = makeRNG(s); },
  snapshot(){ return (this.rng && typeof this.rng.state==="function") ? this.rng.state() : null; },
  restoreSnap(s){ if(s!==null && s!==undefined && this.rng && typeof this.rng.restore==="function") this.rng.restore(s); },
  // 0..1
  f(){ return this.rng(); },
  /* 区间浮点。参数写反会自动交换，非数字回落到 0 —— 
     生成表里手写 `fr(20,10)` 这类反向区间不会静默产出负数。 */
  fr(min,max){
    let a = Number(min), b = Number(max);
    if(!Number.isFinite(a)) a = 0;
    if(!Number.isFinite(b)) b = a;
    if(a > b){ const t = a; a = b; b = t; }
    return a + this.rng()*(b-a);
  },
  /* 区间整数（含两端）；容忍反向区间。
     公式刻意与旧版逐字一致 —— 生成链路（拍卖期号货池、POI 掉落）靠固定种子
     重放，改动抽样公式会让全服同一期号的货品集体变样。 */
  ri(min,max){
    let a = Number(min), b = Number(max);
    if(!Number.isFinite(a)) a = 0;
    if(!Number.isFinite(b)) b = a;
    if(a > b){ const t = a; a = b; b = t; }
    return Math.floor(a + this.rng()*(b-a+1));
  },
  /* 数组随机取。空数组 / 非数组返回 undefined —— 调用方若直接取属性会报错，
     但那是「调用方没判空」的显性 bug，比返回一个假的元素更容易发现。 */
  pick(arr){
    if(!arr || !arr.length) return undefined;
    return arr[Math.floor(this.rng()*arr.length)];
  },
  /* 加权取：items=[{weight}], 返回索引。
     空集返回 -1；权重非正数按 1 处理（原写法 `||1` 会把负数也算进总数，
     导致总权重被拉低、抽中分布整体偏移）；总权重为 0 时退化成等概率。 */
  weighted(items, key="weight"){
    if(!items || !items.length) return -1;
    let total=0;
    for(const it of items){
      const w = it ? Number(it[key]) : NaN;
      total += (Number.isFinite(w) && w > 0) ? w : 1;
    }
    if(!(total > 0)) return Math.floor(this.rng()*items.length);
    let r=this.rng()*total;
    for(let i=0;i<items.length;i++){
      const w = items[i] ? Number(items[i][key]) : NaN;
      r -= (Number.isFinite(w) && w > 0) ? w : 1;
      if(r<=0) return i;
    }
    return items.length-1;
  },
  // 概率命中
  chance(p){ return this.rng() < p; },
  // 正态分布近似（用于散布）
  gauss(){ return (this.rng()+this.rng()+this.rng()-1.5)/1.5; },
  /* 截断正态抽样：把数组下标当连续轴，越靠近 mid 权重越高，两端衰减。
   * 用途：弹种 / 枪型这类「有梯队、但中段才常见」的随机，比均匀分布更像真实世界。
   *   opts.mid    中心下标（默认取正中）
   *   opts.sigma  以「下标」为单位的宽度（默认 (n-1)/2.6，保证两端仍有极小概率） */
  normPick(items, opts){
    const n=items.length;
    if(!n) return undefined;
    if(n===1) return items[0];
    const o=opts||{};
    const mid=(o.mid!==undefined)?o.mid:(n-1)/2;
    const sg=(o.sigma&&o.sigma>0)?o.sigma:Math.max(0.85,(n-1)/2.6);
    const w=new Array(n);
    let total=0;
    for(let i=0;i<n;i++){ const d=(i-mid)/sg; const v=Math.exp(-0.5*d*d); w[i]=v; total+=v; }
    let r=this.rng()*total;
    for(let i=0;i<n;i++){ r-=w[i]; if(r<=0) return items[i]; }
    return items[n-1];
  },
};

const M = {
  /* 数值钳制。对 NaN / Infinity / 数字字符串都给出**确定结果**。
   *
   * 为什么不能简单写 `v<a?a:(v>b?b:v)`：NaN 与任何数比较都是 false，
   * 于是 clamp 会把 NaN 原样放过去。而 NaN 在 JS 里会**传染** ——
   * 一个 NaN 坐标会让整个对象在渲染层隐身、让 HP 永远打不死、
   * 让结算奖金显示 NaN，且无法从表现反推是哪一环出的问题。
   * 与其让它在画面里以「隐形」的方式出现，不如在入口就落回下限。 */
  clamp(v,a,b){
    const lo = Number.isFinite(a) ? a : -Infinity;
    const hi = Number.isFinite(b) ? b : Infinity;
    let n = (typeof v === "number") ? v : Number(v);
    // 非法输入落回下限；下限本身也没给就用 0（中性值）
    if(!Number.isFinite(n)) n = Number.isFinite(a) ? a : 0;
    return n<lo?lo:(n>hi?hi:n);
  },

  /* 通用数值校验：把「任意来源的值」变成可参与运算的有限数。
   * 典型来源：读档、网络消息、DOM 输入框、URL 参数。 */
  num(v, def, min, max){
    const n = (typeof v === "number") ? v : Number(v);
    let r = Number.isFinite(n) ? n : (Number.isFinite(def) ? def : 0);
    if(Number.isFinite(min) && r < min) r = min;
    if(Number.isFinite(max) && r > max) r = max;
    return r;
  },

  lerp(a,b,t){ return a+(b-a)*t; },
  dist(ax,ay,bx,by){ return Math.hypot(ax-bx,ay-by); },
  dist2(ax,ay,bx,by){ const dx=ax-bx,dy=ay-by; return dx*dx+dy*dy; },
  angle(ax,ay,bx,by){ return Math.atan2(by-ay,bx-ax); },
  // 角度归一化到 -PI..PI
  normAngle(a){ while(a>Math.PI)a-=Math.PI*2; while(a<-Math.PI)a+=Math.PI*2; return a; },
  // 角度插值（最短路径）
  /* v0.29.0：结果也归一化。旧实现只归一化「差值」，a 本身会无限累加（可到几十弧度），
     某些直接比较 / 序列化角度的地方会出现跳变；归一化后角度恒在 [-π, π]。 */
  lerpAngle(a,b,t){ return M.normAngle(a + M.normAngle(b-a)*t); },
  now(){ return performance.now()/1000; },
};

/* ------------------------------------------------------------
   诊断日志限流
   ------------------------------------------------------------
   给「可能每帧 / 每条网络消息都失败」的热路径用：同一个 tag 只输出一次。
   既留下现场供排查，又不会把控制台刷爆 —— console 输出本身是有代价的，
   在 60fps 渲染循环里反复打印会直接拖低帧率，反而掩盖真正的问题。 */
const LOGGED_ONCE = new Set();
function warnOnce(tag, err){
  if(LOGGED_ONCE.has(tag)) return;
  LOGGED_ONCE.add(tag);
  try{
    const extra = (err && err.message) ? " — " + err.message : (err ? " " + err : "");
    console.warn("[BORDER OPS] " + tag + extra);
  }catch(e){ /* 控制台不可用（被策略禁用）时也不能因此中断游戏 */ }
}

/* ------------------------------------------------------------
   颜色工具
   ------------------------------------------------------------
   十六进制解析统一收口到这里。之前 rgba() / hexLighten() 各自
   `parseInt(substring(...),16)`，一旦拿到非法色值（undefined、
   少一位、带 alpha 的 8 位写法）就产出 `rgba(NaN,NaN,NaN,a)`——
   浏览器会**整条声明丢弃**，表现为「这个 UI 元素直接透明」，
   排查时完全看不出是颜色的问题。现在非法值一律回落到白色。 */

/** 解析 #rgb / #rrggbb（# 可省），非法输入回落为纯白 */
function parseHex(hex){
  const s = String(hex === null || hex === undefined ? "" : hex).trim().replace(/^#/, "");
  if(/^[0-9a-f]{3}$/i.test(s)){
    return { r:parseInt(s[0]+s[0],16), g:parseInt(s[1]+s[1],16), b:parseInt(s[2]+s[2],16) };
  }
  if(/^[0-9a-f]{6}$/i.test(s)){
    return { r:parseInt(s.slice(0,2),16), g:parseInt(s.slice(2,4),16), b:parseInt(s.slice(4,6),16) };
  }
  return { r:255, g:255, b:255 };
}

/** 十六进制颜色 -> rgba 字符串。alpha 会被钳制到 0..1，非法时按不透明处理。 */
function rgba(hex, a){
  if(!Number.isFinite(a)) a = 1;
  const c = parseHex(hex);
  const al = a < 0 ? 0 : (a > 1 ? 1 : a);
  return `rgba(${c.r},${c.g},${c.b},${al})`;
}

/** 按比例向白色提亮（amt 0..1）。amt 非法时按 0 处理（即原色）。 */
function hexLighten(hex, amt){
  const c = parseHex(hex);
  const k = Number.isFinite(amt) ? amt : 0;
  const mix = ch => Math.round(M.clamp(ch + (255-ch)*k, 0, 255));
  return `rgb(${mix(c.r)},${mix(c.g)},${mix(c.b)})`;
}

/* =========================================================================
 * v0.36.0：音效系统重做（用户要求「全面优化游戏声音，开火声音可以学习无主之地」）
 * -------------------------------------------------------------------------
 * 旧版每个音效就是一个 50ms 的方波 blip：开火像按鼠标、爆炸像点了一下。
 * 这里改成**分层合成**（零外部资源，仍然是 WebAudio）：
 *
 *   1. 瞬态（crack） —— 高通噪声 15~35ms，提供「啪」的锐度；
 *   2. 枪身（body） —— 正弦/三角从 ~170Hz 扫到 ~45Hz，提供「咚」的胸腔感；
 *   3. 中频颗粒（grit）—— 带通噪声 + 波形整形器，无主之地那种「厚实沙砾味」；
 *   4. 尾音（tail） —— 低通噪声 120~380ms，给室内反射感。
 *
 * 每种枪型（手枪 / 冲锋枪 / 步枪 / 霰弹 / 狙击 / 榴弹）都有自己的一套参数，
 * 每发还有 ±6% 的随机音高与音量抖动 —— 连发时不会听成一段机械重复。
 * 全链路过一个 DynamicsCompressor 收尾，保证叠了很多层也不破音、并且更「顶」。
 * 所有节点都判空：没有音频设备 / 自动播放被拦时静音运行，不影响玩法。
 * ========================================================================= */
const SFX = (function(){
  let ctx=null, master=null, comp=null, noiseBuf=null, voices=0;
  let vol = 0.85, muted = false, prefsLoaded = false;
  /* 音量偏好走 Store（项目约定：只有 store.js 直连 localStorage）。
     util.js 比 store.js 先加载，所以这里**懒读**，第一次发声时再取。 */
  function prefs(){
    if(prefsLoaded) return;
    prefsLoaded = true;
    if(typeof Store==="undefined" || !Store.get) return;
    try{
      const v=Store.get("bops_sfx_vol", null);
      if(v!==null && v!==undefined){ const n=parseFloat(v); if(isFinite(n)) vol=Math.max(0,Math.min(1,n)); }
      muted = Store.get("bops_sfx_mute", "0")==="1";
    }catch(e){ /* 存储不可用就保持默认音量 */ }
  }
  function savePref(k, val){
    if(typeof Store==="undefined" || !Store.set) return;
    try{ Store.set(k, String(val)); }catch(e){ /* 存储不可用则放弃持久化 */ }
  }

  function ensure(){
    if(ctx) return ctx;
    try{
      const AC = window.AudioContext||window.webkitAudioContext;
      if(!AC) return null;
      ctx=new AC();
      /* 压缩器：把多层叠加压成「一块」，这是无主之地枪声听起来有分量的关键 */
      comp=ctx.createDynamicsCompressor();
      comp.threshold.value=-16; comp.knee.value=12; comp.ratio.value=5.5;
      comp.attack.value=0.002; comp.release.value=0.14;
      master=ctx.createGain();
      master.gain.value=(muted?0:vol);
      comp.connect(master); master.connect(ctx.destination);
      // 白噪声 1s，反复复用（不要每发都新建 buffer）
      const len=Math.floor(ctx.sampleRate*1.0);
      noiseBuf=ctx.createBuffer(1,len,ctx.sampleRate);
      const d=noiseBuf.getChannelData(0);
      for(let i=0;i<len;i++) d[i]=Math.random()*2-1;
    }catch(e){ ctx=null; }
    return ctx;
  }
  function unlock(){
    const c=ensure(); if(c && c.state==="suspended"){ try{ c.resume(); }catch(e){ /* 自动播放被拦：静默 */ } }
  }
  if(typeof window!=="undefined" && window.addEventListener){
    ["pointerdown","keydown","touchstart"].forEach(ev=>
      window.addEventListener(ev, unlock, { passive:true }));
  }
  function volNow(){ const c=ensure(); if(c&&master) master.gain.value=(muted?0:vol); return (muted?0:vol); }

  /* 单层噪声：filter 类型 / 频率 / Q / 增益 / 持续时间 / 延迟 / 波形整形量 */
  function noise(t0, dur, type, freq, q, gain, distortAmt, dest){
    const c=ctx;
    const src=c.createBufferSource();
    src.buffer=noiseBuf;
    src.loop=true;
    src.playbackRate.value=0.85+Math.random()*0.3;
    const f=c.createBiquadFilter();
    f.type=type; f.frequency.value=freq; f.Q.value=q;
    const g=c.createGain();
    g.gain.setValueAtTime(0.0001,t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002,gain), t0+0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t0+dur);
    let node=f;
    if(distortAmt>0 && c.createWaveShaper){
      const ws=c.createWaveShaper();
      const n=1024, curve=new Float32Array(n);
      for(let i=0;i<n;i++){ const x=i*2/n-1; curve[i]=Math.tanh(x*(1+distortAmt*6)); }
      ws.curve=curve; ws.oversample="2x";
      f.connect(ws); node=ws;
    }
    src.connect(f); node.connect(g); g.connect(dest||comp);
    src.start(t0); src.stop(t0+dur+0.02);
  }
  /* 单层音调：扫频 + 指数衰减 */
  function sweep(t0, f0, f1, dur, type, gain){
    const c=ctx;
    const o=c.createOscillator(), g=c.createGain();
    o.type=type||"sine";
    o.frequency.setValueAtTime(f0,t0);
    o.frequency.exponentialRampToValueAtTime(Math.max(20,f1), t0+dur*0.9);
    g.gain.setValueAtTime(0.0001,t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002,gain), t0+0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t0+dur);
    o.connect(g); g.connect(comp);
    o.start(t0); o.stop(t0+dur+0.02);
  }
  function click(t0, freq, gain, dur, type){
    sweep(t0, freq, freq*0.55, dur||0.035, type||"square", gain||0.03);
  }

  /* =========================================================================
   * v0.36.2：枪声重做 —— 目标是「像真枪」，不是「像合成器」
   * -------------------------------------------------------------------------
   * 上一版错在拿**正弦扫频**当枪身：真实枪声里几乎没有纯音成分，那是
   * 爆轰在管内的宽带噪声 + 出口的冲击波。听感上就变成「电子枪/激光」。
   *
   * 真实枪声可以拆成四段（顺序即时间顺序）：
   *   ① 冲击波（crack）   1~3ms 起音、6~20ms 衰减，3~6kHz 高通 —— 耳朵先听到的「啪」
   *   ② 炮口爆音（blast） 30~90ms，700~1500Hz 带通 + 轻微削波 —— 枪声的「实体感」
   *   ③ 低频推力（body）  60~160ms，低通扫频 200→60Hz 的**噪声**（不是正弦）—— 胸腔的「咚」
   *   ④ 尾音（tail）      100~350ms，房间/地形反射，低通噪声随距离变长变闷
   * 另加：自动武器在 +40ms 处的机件「咔嗒」、每发 ±6% 抖动、全链路过压缩器。
   * 远处（AI 开火）走单独的低通 + 更长的尾音 —— 距离感主要来自高频衰减，不是音量。
   * ========================================================================= */

  /* 单层噪声，带「快起音 + 两段衰减」包络与可选扫频。
   * opts: { attack, mid, midGain, freqEnd, sat, bus } —— 全部可选。 */
  function burst(t0, dur, type, freq, q, gain, opts){
    const c=ctx; if(!c) return;
    opts=opts||{};
    const src=c.createBufferSource();
    src.buffer=noiseBuf; src.loop=true;
    src.playbackRate.value=0.8+Math.random()*0.4;      // 每发纹理不同，连发不「机关枪复读」
    const f=c.createBiquadFilter();
    f.type=type;
    f.frequency.setValueAtTime(Math.max(40,freq), t0);
    if(opts.freqEnd && opts.freqEnd>0)
      f.frequency.exponentialRampToValueAtTime(Math.max(30,opts.freqEnd), t0+dur*0.85);
    f.Q.value=q;
    const g=c.createGain();
    const atk=opts.attack||0.0018;                     // 真实起音 1~3ms，慢一点就成了「吹气」
    const peak=Math.max(0.0003,gain);
    g.gain.setValueAtTime(0.00001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0+atk);
    const mid=opts.mid||0.30;
    g.gain.exponentialRampToValueAtTime(Math.max(0.0004, peak*(opts.midGain||0.22)), t0+dur*mid);
    g.gain.exponentialRampToValueAtTime(0.00001, t0+dur);
    let node=f;
    if(opts.sat && c.createWaveShaper){
      const ws=c.createWaveShaper();
      const n=1024, curve=new Float32Array(n), k=1+opts.sat*5;
      for(let i=0;i<n;i++){ const x=i*2/n-1; curve[i]=Math.tanh(x*k)/Math.tanh(k); }
      ws.curve=curve; ws.oversample="2x";
      f.connect(ws); node=ws;
    }
    src.connect(f); node.connect(g); g.connect(opts.bus||comp);
    src.start(t0); src.stop(t0+dur+0.02);
  }

  /* 每次开火一条临时总线：远处直接挂低通（高频先衰减），近处原样直连。 */
  function shotBus(far){
    const c=ctx;
    if(!far) return comp;
    const g=c.createGain(); g.gain.value=1;
    const lp=c.createBiquadFilter();
    lp.type="lowpass"; lp.frequency.value=1500; lp.Q.value=0.6;
    g.connect(lp); lp.connect(comp);
    return g;
  }

  /* ---- 开火：六种枪型各自的「物理参数」，全部由口径/装药量推出来 ---- */
  const GUNSHOT = {
    /*                 crack(Hz,秒,增益)     blast(Hz,Q,秒,增益)    body(起,止,秒,增益)   tail(秒,增益)  sub */
    pistol:  { crack:[4600,0.016,0.30], blast:[1250,1.0,0.040,0.20], body:[210,80,0.075,0.55], tail:[0.11,0.09], sub:0.20 },
    smg:     { crack:[5200,0.013,0.26], blast:[1600,1.0,0.032,0.17], body:[230,90,0.060,0.42], tail:[0.08,0.07], sub:0.15 },
    rifle:   { crack:[3800,0.020,0.36], blast:[1000,0.9,0.048,0.26], body:[190,72,0.100,0.70], tail:[0.17,0.13], sub:0.28 },
    shotgun: { crack:[2600,0.024,0.32], blast:[720,0.8,0.075,0.33], body:[150,55,0.145,0.90], tail:[0.26,0.18], sub:0.40 },
    sniper:  { crack:[5400,0.022,0.40], blast:[1450,1.1,0.042,0.24], body:[175,62,0.120,0.78], tail:[0.30,0.19], sub:0.32 },
    launcher:{ crack:[2000,0.030,0.26], blast:[560,0.7,0.100,0.32], body:[120,46,0.190,0.95], tail:[0.32,0.20], sub:0.46 },
  };
  function shotOf(kind){
    const k=String(kind||"").toLowerCase();
    if(k==="shotgun"||k==="霰弹枪"||k==="霰弹") return GUNSHOT.shotgun;
    if(k==="sniper"||k==="狙击枪"||k==="狙击") return GUNSHOT.sniper;
    if(k==="rifle"||k==="步枪"||k==="lmg"||k==="机枪") return GUNSHOT.rifle;
    if(k==="smg"||k==="冲锋枪") return GUNSHOT.smg;
    if(k==="launcher"||k==="火箭筒"||k==="榴弹发射器") return GUNSHOT.launcher;
    return GUNSHOT.pistol;
  }
  return {
    /* 保留旧 API 的默认参数，同时支持 shoot("rifle") / shoot({kind, far}) */
    shoot(kind, opts){
      const c=ensure(); if(!c || muted) return;
      if(voices>26) return;                       // 极端连发时丢弃多余声部，避免卡顿
      const p=shotOf(typeof kind==="object"&&kind?kind.kind:kind);
      const far=!!(opts&&opts.far);
      const t=c.currentTime+0.001;
      const j=0.94+Math.random()*0.12;            // 每发音高/频谱抖动
      const bus=shotBus(far);
      voices++;
      const durAll=Math.max(p.tail[0], p.body[2], p.blast[2])*1000;
      setTimeout(()=>{ voices=Math.max(0,voices-1); }, Math.max(160, durAll));
      /* 远处：冲击波与爆音都被空气吃掉大半，只剩低频与长尾 —— 这是「距离感」的来源 */
      const airK = far ? 0.45 : 1.0;
      const tailK = far ? 1.5 : 1.0;
      // ① 冲击波：高通噪声，极短
      burst(t, p.crack[1], "highpass", p.crack[0]*j, 0.7, p.crack[2]*airK,
        { attack:0.0012, mid:0.25, midGain:0.12, bus });
      // ② 炮口爆音：带通 + 轻微削波，枪声的「实体」
      burst(t+0.001, p.blast[2], "bandpass", p.blast[0]*j, p.blast[1], p.blast[3]*airK,
        { attack:0.0016, mid:0.35, midGain:0.20, sat:0.7, bus });
      // ③ 低频推力：低通**噪声**扫频（不是正弦），胸腔那一下
      burst(t+0.002, p.body[2], "lowpass", p.body[0]*j, 0.9, p.body[3],
        { attack:0.0022, mid:0.45, midGain:0.30, freqEnd:p.body[1], sat:0.35, bus });
      // ③b 一点点次低频正弦（60~100Hz），只补「推力」不构成音高
      sweep(t+0.001, p.body[0]*0.45, p.body[1]*0.5, p.body[2]*0.55, "sine", p.sub*(far?0.55:0.9));
      // ④ 尾音：房间 / 地形反射
      burst(t+0.010, p.tail[0]*tailK, "lowpass", (far?700:1300)*j, 0.5, p.tail[1]*(far?1.15:1),
        { attack:0.012, mid:0.4, midGain:0.45, bus });
      /* ⑤ 机件声：自动武器在 +38~52ms 有一个很轻的「咔嗒」，
            单发武器没有 —— 这一层是「真枪」与「合成枪」最容易分辨的细节。 */
      const auto = (p===GUNSHOT.smg || p===GUNSHOT.rifle);
      if(auto && !far){
        const dt=0.038+Math.random()*0.014;
        burst(t+dt, 0.014, "bandpass", 2600+Math.random()*600, 2.2, 0.035,
          { attack:0.0012, mid:0.3, midGain:0.15, bus });
      }
    },
    /* 命中：打在护甲上是金属声，打在血肉上是闷响 */
    hit(metal){
      const c=ensure(); if(!c || muted) return;
      const t=c.currentTime+0.001;
      if(metal){ noise(t,0.055,"bandpass",2600,2.2,0.16,0.5,null); sweep(t,1400,700,0.05,"square",0.045); }
      else { noise(t,0.075,"lowpass",520,0.8,0.18,0.4,null); sweep(t,150,60,0.09,"sine",0.10); }
    },
    pickup(){
      const c=ensure(); if(!c || muted) return;
      const t=c.currentTime+0.001;
      click(t,640,0.05,0.05,"triangle"); click(t+0.06,960,0.045,0.06,"triangle"); click(t+0.12,1280,0.03,0.08,"sine");
    },
    reload(){
      const c=ensure(); if(!c || muted) return;
      const t=c.currentTime+0.001;
      noise(t,0.035,"bandpass",1800,3.0,0.10,0.3,null);      // 弹匣脱开
      click(t+0.10,420,0.04,0.04,"square");
      noise(t+0.20,0.045,"bandpass",2400,2.4,0.09,0.3,null); // 插入
    },
    hurt(){
      const c=ensure(); if(!c || muted) return;
      const t=c.currentTime+0.001;
      sweep(t,190,70,0.16,"sawtooth",0.10); noise(t,0.10,"lowpass",700,0.7,0.10,0.5,null);
    },
    boom(){
      const c=ensure(); if(!c || muted) return;
      const t=c.currentTime+0.001;
      /* v0.36.2：爆炸也按「冲击 → 低频 → 碎片/回响」三段做，比单根正弦扫频真实得多 */
      burst(t, 0.55, "lowpass", 340, 0.9, 0.34, { attack:0.006, mid:0.42, midGain:0.34, freqEnd:90, sat:0.9 });
      burst(t+0.006, 0.22, "bandpass", 950, 0.8, 0.15, { attack:0.004, mid:0.3, midGain:0.2, sat:0.6 });
      sweep(t, 92, 26, 0.42, "sine", 0.22);
      burst(t+0.05, 0.55, "lowpass", 760, 0.4, 0.10, { attack:0.02, mid:0.5, midGain:0.4 });
    },
    levelup(){
      const c=ensure(); if(!c || muted) return;
      const t=c.currentTime+0.001;
      [523,659,784,1046].forEach((f,i)=>click(t+i*0.075,f,0.05,0.14,"triangle"));
    },
    ui(){ const c=ensure(); if(!c || muted) return; click(c.currentTime+0.001, 620, 0.035, 0.035,"triangle"); },
    /* 音量 / 静音（设置面板或调试用；持久化经 Store） */
    setVolume(v){
      vol=Math.max(0,Math.min(1,Number(v)||0));
      savePref("bops_sfx_vol", vol);
      volNow();
    },
    getVolume(){ return vol; },
    setMuted(m){
      muted=!!m;
      savePref("bops_sfx_mute", muted?"1":"0");
      volNow();
    },
    isMuted(){ return muted; },
    unlock: unlock,
  };
})();

/* ------------------------------------------------------------
   移动射击散布系数（四大模式共用，玩家与电脑同一公式）
   冲锋枪（SMG）几乎不受移动影响，其余枪械移动中散布暴涨。
   cat 兼容英文类别与中文类别名。
   v0.29.0：整体 K ×1.5 左右 —— 拉大「静止 vs 运动」的精度差：
   站定几乎指哪打哪，一跑起来子弹就散了（狙击尤其明显）。
   ------------------------------------------------------------ */
const MOVE_SPREAD_K = {
  smg:4.8,      "冲锋枪":4.8,
  pistol:16.5,  "手枪":16.5,
  shotgun:18.0, "霰弹":18.0, "霰弹枪":18.0,
  rifle:24.0,   "步枪":24.0,
  lmg:27.0,     "机枪":27.0,
  sniper:39.0,  "狙击":39.0, "狙击枪":39.0,
  launcher:18.0,"火箭筒":18.0,
};
function isSMG(cat){ return cat==="smg" || cat==="冲锋枪"; }
function moveSpreadMul(cat, mv){
  const k = MOVE_SPREAD_K[cat];
  const K = (k===undefined) ? 24.0 : k;      // 未分类按步枪处理
  const m = Math.max(0, Math.min(1, mv||0));
  return 1 + m*K;
}

/* 移动散布的物理上限（弧度，半宽）：防止扩散大到全向乱飞，
   仍然远大于站立散布，近距离勉强、中远距离彻底失准。
   v0.29.0：上限同步抬高，避免 K 调大后被 cap 提前截断（否则移动惩罚形同虚设）。 */
const MOVE_SPREAD_CAP = {
  pistol:0.72,   "手枪":0.72,
  shotgun:1.05,  "霰弹":1.05, "霰弹枪":1.05,
  rifle:0.98,    "步枪":0.98,
  lmg:1.05,      "机枪":1.05,
  sniper:0.98,   "狙击":0.98, "狙击枪":0.98,
  launcher:0.80, "火箭筒":0.80,
};
function moveSpreadCap(cat){
  const c = MOVE_SPREAD_CAP[cat];
  return (c===undefined) ? 0.98 : c;
}

/* ---------------- v0.31.1：存档字符串净化 / HTML 出口转义 ----------------
 * 存档码 BOPS1-<FNV-1a>-<base64> 的校验和只保完整性，不保真实性：
 * 任何人都能重算 8 位哈希，把 <img onerror=...> 塞进武器名 / 挂单名，
 * 再把这个码分享给别人。server.js 同源部署有 CSP 的 script-src 'self'
 * 挡住内联脚本，但 GitHub Pages 纯静态部署没有该响应头，一旦被 innerHTML
 * 插值就是可执行 XSS。两道防线：
 *   cleanSaveStrings —— 读档入口递归剥离危险字符（只动字符串，不动数值）
 *   escHtml          —— 显示出口转义（保留原字符，只是不再被当成标签）
 * 不能复用 Sanitize.cleanValue：它会按 NUM_CAPS 削装备属性、按深度裁词条。 */
function escHtml(v){
  const MAP={"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"};
  return String(v==null?"":v).replace(/[&<>"']/g, c=>MAP[c]);
}
function cleanSaveStrings(v){
  const DANGER=["__proto__","prototype","constructor"];
  const st={n:0};
  function strip(s){
    return (typeof Sanitize!=="undefined" && typeof Sanitize.stripHtml==="function")
      ? Sanitize.stripHtml(s)
      : String(s).replace(/[\u0000-\u001f\u007f]/g," ").replace(/[<>&"'`]/g," ");
  }
  function walk(x, d){
    if(++st.n>200000) return null;
    if(typeof x==="string") return strip(x);
    if(x===null || typeof x!=="object") return x;
    if(d>=16) return Array.isArray(x) ? [] : {};
    if(Array.isArray(x)){
      for(let i=0;i<Math.min(x.length,20000);i++) x[i]=walk(x[i], d+1);
      return x;
    }
    for(const k of Object.keys(x)){
      if(DANGER.indexOf(k)>=0){ delete x[k]; continue; }
      x[k]=walk(x[k], d+1);
    }
    return x;
  }
  return walk(v, 0);
}
