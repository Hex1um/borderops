/* =========================================================================
 * util.js — 随机数 / 数学 / 通用工具
 * ========================================================================= */

// 可重播随机（mulberry32）
function makeRNG(seed){
  let a = seed >>> 0;
  return function(){
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const RNG = {
  rng: Math.random,
  setSeed(s){ this.rng = makeRNG(s); },
  // 0..1
  f(){ return this.rng(); },
  // 区间浮点
  fr(min,max){ return min + this.rng()*(max-min); },
  // 区间整数
  ri(min,max){ return Math.floor(min + this.rng()*(max-min+1)); },
  // 数组随机取
  pick(arr){ return arr[Math.floor(this.rng()*arr.length)]; },
  // 加权取：items=[{weight}], 返回索引
  weighted(items, key="weight"){
    let total=0; for(const it of items) total += (it[key]||1);
    let r=this.rng()*total;
    for(let i=0;i<items.length;i++){ r-=(items[i][key]||1); if(r<=0) return i; }
    return items.length-1;
  },
  // 概率命中
  chance(p){ return this.rng() < p; },
  // 正态分布近似（用于散布）
  gauss(){ return (this.rng()+this.rng()+this.rng()-1.5)/1.5; },
};

const M = {
  clamp(v,a,b){ return v<a?a:(v>b?b:v); },
  lerp(a,b,t){ return a+(b-a)*t; },
  dist(ax,ay,bx,by){ return Math.hypot(ax-bx,ay-by); },
  dist2(ax,ay,bx,by){ const dx=ax-bx,dy=ay-by; return dx*dx+dy*dy; },
  angle(ax,ay,bx,by){ return Math.atan2(by-ay,bx-ax); },
  // 角度归一化到 -PI..PI
  normAngle(a){ while(a>Math.PI)a-=Math.PI*2; while(a<-Math.PI)a+=Math.PI*2; return a; },
  // 角度插值（最短路径）
  lerpAngle(a,b,t){ return a + M.normAngle(b-a)*t; },
  now(){ return performance.now()/1000; },
};

// 颜色：十六进制 -> rgba 字符串
function rgba(hex, a){
  const h = hex.replace("#","");
  const r=parseInt(h.substring(0,2),16), g=parseInt(h.substring(2,4),16), b=parseInt(h.substring(4,6),16);
  return `rgba(${r},${g},${b},${a})`;
}
function hexLighten(hex, amt){
  const h=hex.replace("#","");
  let r=parseInt(h.substring(0,2),16),g=parseInt(h.substring(2,4),16),b=parseInt(h.substring(4,6),16);
  r=Math.round(M.clamp(r+(255-r)*amt,0,255));
  g=Math.round(M.clamp(g+(255-g)*amt,0,255));
  b=Math.round(M.clamp(b+(255-b)*amt,0,255));
  return `rgb(${r},${g},${b})`;
}

// 简易音效（WebAudio），无外部资源
const SFX = (function(){
  let ctx=null;
  function ensure(){ if(!ctx){ try{ ctx=new (window.AudioContext||window.webkitAudioContext)(); }catch(e){} } return ctx; }
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
   ------------------------------------------------------------ */
const MOVE_SPREAD_K = {
  smg:3.2,      "冲锋枪":3.2,
  pistol:11.0,  "手枪":11.0,
  shotgun:12.0, "霰弹":12.0, "霰弹枪":12.0,
  rifle:16.0,   "步枪":16.0,
  lmg:18.0,     "机枪":18.0,
  sniper:26.0,  "狙击":26.0, "狙击枪":26.0,
  launcher:12.0,"火箭筒":12.0,
};
function isSMG(cat){ return cat==="smg" || cat==="冲锋枪"; }
function moveSpreadMul(cat, mv){
  const k = MOVE_SPREAD_K[cat];
  const K = (k===undefined) ? 16.0 : k;      // 未分类按步枪处理
  const m = Math.max(0, Math.min(1, mv||0));
  return 1 + m*K;
}

/* 移动散布的物理上限（弧度，半宽）：防止扩散大到全向乱飞，
   仍然远大于站立散布，近距离勉强、中远距离彻底失准。 */
const MOVE_SPREAD_CAP = {
  pistol:0.58,   "手枪":0.58,
  shotgun:0.95,  "霰弹":0.95, "霰弹枪":0.95,
  rifle:0.85,    "步枪":0.85,
  lmg:0.95,      "机枪":0.95,
  sniper:0.48,   "狙击":0.48, "狙击枪":0.48,
  launcher:0.70, "火箭筒":0.70,
};
function moveSpreadCap(cat){
  const c = MOVE_SPREAD_CAP[cat];
  return (c===undefined) ? 0.85 : c;
}
