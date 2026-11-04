/* =========================================================================
 * items.js — 护盾 / 圣物（可掉落、可购买的装备）
 *
 * 护盾是唯一能提供「可恢复血量」的装备，但恢复被三重参数约束：
 *   capacity 容量 / delay 受击后充能延迟 / rate 每秒充能量
 * 高品质护盾靠「延迟更短、充能更快、附带特效」体现价值，
 * 而不是单纯堆容量——否则就退化成「随时补满」。
 * 圣物是纯被动词条装备，一个槽位，词条数值随 ilvl 与品质缩放。
 * ========================================================================= */

const RARITY_ORDER = ["white","green","blue","purple","orange","pearl","ancient","rainbow","mythic","primordial","celestial","singularity"];
const RARITY_INDEX = {};
RARITY_ORDER.forEach((r,i)=>RARITY_INDEX[r]=i);

/* ----------------------------- 护盾 ----------------------------- */
function generateShield(ilvl, opts={}){
  ilvl = Math.max(1, Math.round(opts.ilvl!==undefined?opts.ilvl:ilvl));
  const q = opts.rarity || rollQuality(ilvl, { mf:opts.mf, weights:opts.weights, luck:opts.luck });
  const R = RARITY_BY_ID[q] || RARITIES[0];
  const S = SHIELD_RARITY[q] || SHIELD_RARITY.white;

  const capacity = Math.round((34 + ilvl*8.4) * S.cap * RNG.fr(0.94,1.06));
  const delay    = Math.round(Math.max(1.2, S.delay - RNG.fr(0,0.5))*10)/10;
  const rechDur  = S.rech * RNG.fr(0.9,1.1);
  const rate     = Math.round(capacity/rechDur*10)/10;

  // 特效：品质越高越可能出现，且数值更强
  let effect=null, effectVal=0;
  if(RNG.chance(S.effect)){
    const id = RNG.pick(Object.keys(SHIELD_EFFECTS));
    effect = id;
    const t = (RARITY_INDEX[q]||0)/(RARITY_ORDER.length-1);   // 0..1
    if(id==="nova")       effectVal = Math.round(capacity*(0.55+t*0.75));
    else if(id==="amp")   effectVal = Math.round((10+t*22)*10)/10;
    else if(id==="thorns")effectVal = Math.round((12+t*22)*10)/10;
    else if(id==="reboot")effectVal = Math.round((55+t*25)*10)/10;
    else if(id==="vamp")  effectVal = Math.round(capacity*(0.20+t*0.30));
  }

  const base = RNG.pick(SHIELD_NAMES[q] || SHIELD_NAMES.white);
  const idx = RARITY_INDEX[q]||0;
  const SH_TOP = { mythic:"神话·", primordial:"原初·", celestial:"寰宇·", singularity:"奇点·" };
  const adj  = ["强化","过载","相位","静滞","谐振","锋锐","灼热","湮灭","星界","太初"];
  const nm   = (SH_TOP[q] ? SH_TOP[q] : (idx>=3 ? RNG.pick(adj) : "")) + base;

  return {
    kind:"shield", name:nm, rarity:q, ilvl,
    capacity, delay, rate, effect, effectVal,
    mayhem: Math.max(0, Math.round(opts.mayhem||0)),
  };
}

function shieldLines(s){
  const out = [
    `容量 ${s.capacity}`,
    `充能延迟 ${s.delay.toFixed(1)}s`,
    `充能 ${s.rate.toFixed(1)}/s`,
  ];
  if(s.effect && SHIELD_EFFECTS[s.effect]){
    const e = SHIELD_EFFECTS[s.effect];
    let v = "";
    if(s.effect==="nova") v = ` ${s.effectVal} 伤害`;
    else if(s.effect==="amp") v = ` +${s.effectVal}% 伤害`;
    else if(s.effect==="thorns") v = ` 反弹 ${s.effectVal}%`;
    else if(s.effect==="reboot") v = ` 延迟×${(1-s.effectVal/100).toFixed(2)}`;
    else if(s.effect==="vamp") v = ` +${s.effectVal} 生命`;
    out.push(`${e.name}${v}`);
  }
  return out;
}

function shieldEffectText(s){
  if(!s.effect) return null;
  const e = SHIELD_EFFECTS[s.effect]; if(!e) return null;
  let v="";
  if(s.effect==="nova") v=`（${s.effectVal} 伤害）`;
  else if(s.effect==="amp") v=`（+${s.effectVal}% 伤害）`;
  else if(s.effect==="thorns") v=`（反弹 ${s.effectVal}%）`;
  else if(s.effect==="reboot") v=`（延迟 ×${(1-s.effectVal/100).toFixed(2)}）`;
  else if(s.effect==="vamp") v=`（+${s.effectVal} 生命）`;
  return { name:e.name, desc:e.desc, extra:v, color:e.color };
}

/* ----------------------------- 圣物 ----------------------------- */
function generateRelic(ilvl, opts={}){
  ilvl = Math.max(1, Math.round(opts.ilvl!==undefined?opts.ilvl:ilvl));
  const q = opts.rarity || rollQuality(ilvl, { mf:opts.mf, weights:opts.weights, luck:opts.luck });
  const R = RARITY_BY_ID[q] || RARITIES[0];
  const count = [1,1,2,2,3,3,4,4,5,5,6,6][RARITY_INDEX[q]] || 1;

  const pool = RELIC_MODS.slice();
  const mods = [];
  for(let i=0;i<count && pool.length;i++){
    const idx = Math.floor(RNG.f()*pool.length);
    const m = pool.splice(idx,1)[0];
    let v = RNG.fr(m.min, m.max) * (1 + ilvl*m.scale) * (1 + (RARITY_INDEX[q]||0)*0.12);
    v = m.stat==="shieldDelay" ? Math.round(v*100)/100 : Math.round(v*10)/10;
    mods.push({ stat:m.stat, label:m.label, value:v });
  }
  const base = RNG.pick(RELIC_NAMES[q] || RELIC_NAMES.white);
  const idx = RARITY_INDEX[q]||0;
  const TOP_PREFIX = { mythic:"神话·", primordial:"原初·", celestial:"寰宇·", singularity:"奇点·" };
  const nm = (TOP_PREFIX[q] ? TOP_PREFIX[q] : (idx>=4 ? "秘藏·" : "")) + base;

  return { kind:"relic", name:nm, rarity:q, ilvl, mods, mayhem:Math.max(0, Math.round(opts.mayhem||0)) };
}

function relicLines(r){
  return r.mods.map(m=>{
    if(m.stat==="shieldDelay") return `充能延迟 -${m.value}s`;
    if(m.stat==="lifesteal")   return `吸血 ${m.value}%`;
    if(m.stat==="mfFlat")      return `魔法寻找 +${m.value}`;
    if(m.stat==="critChance")  return `暴击几率 +${m.value}%`;
    if(m.stat==="critDmg")     return `暴击伤害 +${m.value}%`;
    return `${m.label} +${m.value}%`;
  });
}

function relicModMap(r){
  const t={};
  if(!r) return t;
  for(const m of r.mods) t[m.stat]=(t[m.stat]||0)+m.value;
  return t;
}

/* ----------------------------- 定价 / 拆解 ----------------------------- */
function itemPrice(it){
  const R = RARITY_BY_ID[it.rarity] || RARITIES[0];
  const base = it.kind==="shield" ? (70 + it.ilvl*24) * 0.62 + it.capacity*1.6
                                  : (70 + it.ilvl*24) * 0.70;
  return Math.round(base * R.price / 10)*10;
}
function itemSellGold(it){ return Math.max(12, Math.floor(itemPrice(it)*0.25)); }
function itemSellEridium(it){
  const map = { purple:ERIDIUM.sellPurple, orange:ERIDIUM.sellOrange, pearl:ERIDIUM.sellPearl,
                ancient:ERIDIUM.sellAncient, rainbow:ERIDIUM.sellRainbow,
                mythic:14, primordial:22, celestial:34, singularity:52 };
  return map[it.rarity] || 0;
}

/* 掉落类型抽取：武器 / 护盾 / 圣物 */
function rollItemKind(){
  const r = RNG.f();
  if(r < ITEM_DROP.weapon) return "weapon";
  if(r < ITEM_DROP.weapon+ITEM_DROP.shield) return "shield";
  return "relic";
}
function generateItem(ilvl, opts={}){
  const kind = opts.kind || rollItemKind();
  if(kind==="shield") return generateShield(ilvl, opts);
  if(kind==="relic")  return generateRelic(ilvl, opts);
  return generateWeapon(ilvl, opts);
}
