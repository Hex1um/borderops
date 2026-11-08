/* =========================================================================
 * items.js — 防弹插板 / 随身装备（可掉落、可购买的装备）
 * 全部改为现实军械名词，插板特效概率置 0（不再产生冲击波 / 反伤 / 虹吸）。
 * 插板容量 / 受击后整备延迟 / 每秒整备量三重约束防护恢复。
 * 随身装备是纯被动参数，一个槽位，数值随 ilvl 与品级缩放。
 * ========================================================================= */

const RARITY_ORDER = ["white","green","blue","purple","orange","pearl","ancient","rainbow","mythic","primordial","celestial","singularity"];
const RARITY_INDEX = {};
RARITY_ORDER.forEach((r,i)=>RARITY_INDEX[r]=i);
// 高规格品质的名称前缀（插板与随身装备共用一份）
const TOP_PREFIX = { mythic:"定型·", primordial:"定制·", celestial:"珍藏·", singularity:"孤品·" };

/* ----------------------------- 防弹插板 ----------------------------- */
function generateShield(ilvl, opts={}){
  ilvl = Math.max(1, Math.round(opts.ilvl!==undefined?opts.ilvl:ilvl));
  const q = opts.rarity || rollQuality(ilvl, { mf:opts.mf, weights:opts.weights, luck:opts.luck });
  const R = RARITY_BY_ID[q] || RARITIES[0];
  const S = SHIELD_RARITY[q] || SHIELD_RARITY.white;

  const capacity = Math.round((34 + ilvl*8.4) * S.cap * RNG.fr(0.94,1.06));
  const delay    = Math.round(Math.max(1.2, S.delay - RNG.fr(0,0.5))*10)/10;
  const rechDur  = S.rech * RNG.fr(0.9,1.1);
  const rate     = Math.round(capacity/rechDur*10)/10;

  // SHIELD_RARITY[*].effect 全为 0，不再生成新插板特效。
  // 保留一次 RNG 消耗，使 RNG.setSeed 确定性重播的随机数序列与旧版一致；
  // 旧存档插板的 effect / effectVal 仍由 shieldLines() 与结算路径读取。
  RNG.chance(S.effect);
  const effect=null, effectVal=0;

  const base = RNG.pick(SHIELD_NAMES[q] || SHIELD_NAMES.white);
  const idx = RARITY_INDEX[q]||0;
  const adj  = ["加固","加厚","轻量","模块化","军规","陶瓷","复合","层压","缓冲","精工"];
  const nm   = (TOP_PREFIX[q] ? TOP_PREFIX[q] : (idx>=3 ? RNG.pick(adj) : "")) + base;

  return {
    kind:"shield", name:nm, rarity:q, ilvl,
    capacity, delay, rate, effect, effectVal,
    mayhem: Math.max(0, Math.round(opts.mayhem||0)),
  };
}

/* v0.21.9：原名 shieldLines 与 shields.js 的新护盾展示函数同名冲突，
 * 后加载的 shields.js 版本会覆盖本函数，旧式防弹插板（无 invuln 字段）渲染必抛 TypeError。
 * 改名 plateShieldLines 专供旧式插板（战役 / 商店路径）使用。 */
function plateShieldLines(s){
  const out = [
    `防护值 ${s.capacity}`,
    `整备延迟 ${s.delay.toFixed(1)}s`,
    `整备 ${s.rate.toFixed(1)}/s`,
  ];
  if(s.effect && SHIELD_EFFECTS[s.effect]){
    const e = SHIELD_EFFECTS[s.effect];
    let v = "";
    if(s.effect==="nova") v = ` 缓冲 ${s.effectVal}`;
    else if(s.effect==="amp") v = ` +${s.effectVal}% 稳定`;
    else if(s.effect==="thorns") v = ` 减伤 ${s.effectVal}%`;
    else if(s.effect==="reboot") v = ` 延迟×${(1-s.effectVal/100).toFixed(2)}`;
    else if(s.effect==="vamp") v = ` 缓冲 ${s.effectVal}`;
    out.push(`${e.name}${v}`);
  }
  return out;
}

function shieldEffectText(s){
  if(!s.effect) return null;
  const e = SHIELD_EFFECTS[s.effect]; if(!e) return null;
  let v="";
  if(s.effect==="nova") v=`（缓冲 ${s.effectVal}）`;
  else if(s.effect==="amp") v=`（+${s.effectVal}% 稳定）`;
  else if(s.effect==="thorns") v=`（减伤 ${s.effectVal}%）`;
  else if(s.effect==="reboot") v=`（整备 ×${(1-s.effectVal/100).toFixed(2)}）`;
  else if(s.effect==="vamp") v=`（缓冲 ${s.effectVal}）`;
  return { name:e.name, desc:e.desc, extra:v, color:e.color };
}

/* ----------------------------- 随身装备 ----------------------------- */
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
  const nm = (TOP_PREFIX[q] ? TOP_PREFIX[q] : (idx>=4 ? "档案·" : "")) + base;

  return { kind:"relic", name:nm, rarity:q, ilvl, mods, mayhem:Math.max(0, Math.round(opts.mayhem||0)) };
}

function relicLines(r){
  return r.mods.map(m=>{
    if(m.stat==="shieldDelay") return `整备时间 -${m.value}s`;
    if(m.stat==="lifesteal")   return `急救效率 +${m.value}%`;
    if(m.stat==="mfFlat")      return `搜集效率 +${m.value}`;
    if(m.stat==="critChance")  return `要害命中 +${m.value}%`;
    if(m.stat==="critDmg")     return `要害伤害 +${m.value}%`;
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

/* 掉落类型抽取：武器 / 护甲 / 随身装备 */
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
