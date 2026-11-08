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

// 简易音效（WebAudio），无外部资源
const SFX = (function(){
  let ctx=null;
  /* 无音频设备 / 浏览器禁止自动播放时会构造失败 → 静音运行，不影响玩法 */
  function ensure(){ if(!ctx){ try{ ctx=new (window.AudioContext||window.webkitAudioContext)(); }catch(e){ ctx=null; } } return ctx; }
  function blip(freq, dur, type="square", vol=0.08){
    const c=ensure(); if(!c) return;
    const o=c.createOscillator(), g=c.createGain();
    o.type=type; o.frequency.value=freq;
    g.gain.value=vol; o.connect(g); g.connect(c.destination);
    const t=c.currentTime; o.start(t);
    g.gain.exponentialRampToValueAtTime(0.0001, t+dur);
    o.stop(t+dur);
  }
  return {
    shoot(){ blip(420+Math.random()*120, 0.05, "square", 0.04); },
    hit(){ blip(180,0.05,"sawtooth",0.05); },
    pickup(){ blip(660,0.08,"triangle",0.06); blip(880,0.08,"triangle",0.05); },
    reload(){ blip(300,0.06,"square",0.05); },
    hurt(){ blip(140,0.12,"sawtooth",0.07); },
    boom(){ blip(90,0.25,"sawtooth",0.09); },
    levelup(){ blip(520,0.1,"triangle",0.07); blip(780,0.12,"triangle",0.06); blip(1040,0.14,"triangle",0.05); },
    ui(){ blip(520,0.04,"triangle",0.04); },
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
