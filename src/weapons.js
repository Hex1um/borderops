/* =========================================================================
 * weapons.js — 程序化武器生成（底材 + ilvl + 品质 + 词缀）
 *
 * 借鉴刷宝游戏的三段式流水线：
 *   1) rollQuality —— 品质随机（权重极度偏斜，MF 让高品质更容易）
 *   2) rollAffixes —— 按品质决定词缀数量，按 ilvl 开放词缀池，数值随 ilvl 缩放
 *   3) 属性聚合   —— 底材基础值 × 厂商修正 × 品质倍率 × 词缀加成
 * 低品质靠「词缀数量」，高品质靠「数值倍率」，两条曲线交叉形成刷宝手感。
 * ========================================================================= */

// 词缀数值缩放分组
const AFFIX_PCT  = ["dmgPct","fireRatePct","accPct","magPct","reloadPct","elemPct","elemChance","splashPct","projSpeed","lifesteal",
                    "recoil","moveSpeed","range","splashDmg","shieldOnHit","ammoEff","critDmg","critChance"];
const AFFIX_INT  = ["pierce","pellets"];       // 整数，不缩放
// 反向语义：数值越高越「减负」（后坐力-、省弹）的词缀，文案用减号呈现
const AFFIX_INVERT = { recoil:true, ammoEff:true };

/* ----------------------------- 品质随机 ----------------------------- */
function rollQuality(ilvl, opts={}){
  if(opts.rarity) return opts.rarity;
  const mf = opts.mf||0, luck = !!opts.luck, table = opts.weights;
  const pool=[];
  for(const r of RARITIES){
    if(ilvl < r.minLv) continue;              // 品质等级门槛
    let w = table ? (table[r.id]||0) : r.weight;
    if(w<=0) continue;
    const div = DROP.mfDiv[r.id];
    if(div && mf>0) w *= 1 + mf/div;          // MF：越稀有加成越明显
    if(luck && (r.id==="orange"||r.id==="pearl")) w *= 1.2;
    pool.push({w, k:r.id});
  }
  if(!pool.length) return "white";
  return pool[RNG.weighted(pool,"w")].k;
}

/* ----------------------------- 词缀 ----------------------------- */
function scaleModValue(m, ilvl){
  const v = RNG.fr(m.min, m.max);
  if(AFFIX_INT.includes(m.stat)) return Math.round(v);
  const scale = AFFIX_PCT.includes(m.stat) ? (1 + ilvl/180) : (1 + ilvl/120);
  return Math.round(v*scale*10)/10;
}

function affixFits(a, ctx){
  if(a.elem && ctx.element!==a.elem) return false;      // 弹种专属词缀只落在对应弹种武器上
  if(a.elemOnly && ctx.element==="none") return false;
  if(a.needSplash && !(ctx.splash>0)) return false;
  // 品质门槛：minQ 词条（双管的 / 蜂群的）只在足够高品质的枪上出现
  if(a.minQ!==undefined){
    const q = (ctx.q===undefined||ctx.q===null) ? -1 : ctx.q;
    if(q < a.minQ) return false;
  }
  return true;
}

/* v0.19.0 词缀数量分布：枪械与配件「大部分只有 1 条词缀，少部分 2 条及以上」。
 * 旧版直接吃 RARITIES 的 affixes:[min,max]，蓝色以上动辄 4~10 条，
 * 一把枪光词缀就占满整张卡片，也和「改装件 + 配件」的定位重复。
 * 现在统一按 1 条为主：1 条约 75%，2 条约 20%，3 条及以上约 5%（高品级只小幅上调）。 */
function rollAffixCount(rarityId){
  const idx = Math.max(0, RARITIES.findIndex(r=>r.id===rarityId));
  const p3 = 0.05 + Math.min(0.05, idx*0.006);   // 3 条及以上
  const p2 = 0.20 + Math.min(0.10, idx*0.012);   // 恰好 2 条
  const r = RNG.f();
  if(r < p3) return 3 + (RNG.chance(0.15 + Math.min(0.25, idx*0.02)) ? 1 : 0);
  if(r < p3 + p2) return 2;
  return 1;
}

// 按品质词缀数 + ilvl 门槛抽词缀
function rollAffixes(R, ilvl, ctx){
  const n = rollAffixCount(R.id);
  const out=[], used=new Set();
  // 品质下标（RARITIES 序号）统一注入 ctx，供 minQ 类稀有词条判定
  const q = Math.max(0, RARITIES.findIndex(r=>r.id===R.id));
  ctx = Object.assign({ q }, ctx||{});
  for(let i=0;i<n;i++){
    for(let tries=0;tries<40;tries++){
      const isPre = RNG.chance(0.5);
      const pool = (isPre?AFFIXES.prefix:AFFIXES.suffix).filter(a=>
        a.lvl <= ilvl+6 && !used.has(a.nm) && affixFits(a, ctx));
      if(!pool.length) break;
      const a = RNG.pick(pool);
      used.add(a.nm);
      out.push({ nm:a.nm, kind:isPre?"prefix":"suffix",
                 mods:a.mods.map(m=>({stat:m.stat, value:scaleModValue(m, ilvl)})) });
      break;
    }
  }
  // 试验型 / 原型：额外一条专属威能
  if(R.power){
    const pool = POWERS.filter(p=>affixFits(p, ctx));
    const p = pool.length ? RNG.pick(pool) : null;
    if(p) out.push({ nm:p.nm, kind:"power",
                     mods:p.mods.map(m=>({stat:m.stat, value:scaleModValue(m, ilvl)})) });
  }
  return out;
}

// 词缀 -> 加成汇总
function affixTotals(affixes){
  const t={};
  for(const a of affixes) for(const m of a.mods) t[m.stat]=(t[m.stat]||0)+m.value;
  return t;
}

/* ----------------------------- 枪械配件 ----------------------------- */
/*
 * 一把枪 = 底材 + 若干改装件。每个部件自带品级与工艺参数，
 * 部件参数会并入总词条池参与属性计算（所以换部件 = 换性能）。
 * 拆解枪械可得到部件，再装到别的枪上。
 */
const GUN_SLOTS = [
  { id:"barrel",      name:"枪管",     stats:["dmgPct","projSpeed","accPct","range"] },
  { id:"mag",         name:"弹匣",     stats:["magPct","reloadPct","critChance"] },
  { id:"optic",       name:"瞄具",     stats:["accPct","critChance","critDmg"] },
  { id:"grip",        name:"握把",     stats:["accPct","fireRatePct","recoil"] },
  { id:"stock",       name:"枪托",     stats:["fireRatePct","reloadPct","moveSpeed"] },
  { id:"muzzle",      name:"枪口",     stats:["projSpeed","critChance","recoil","range"] },
  { id:"underbarrel", name:"下挂",     stats:["accPct","recoil","range"] },
  { id:"trigger",     name:"扳机",     stats:["fireRatePct","critChance","recoil"] },
  { id:"body",        name:"机匣",     stats:["dmgPct","magPct","recoil"] },
];
const GUN_SLOT_BY_ID = {};
for(const s of GUN_SLOTS) GUN_SLOT_BY_ID[s.id]=s;

// 单条配件词缀数值
function partStatValue(stat, ilvl, R){
  if(AFFIX_INT.includes(stat)) return Math.max(1, Math.round(2 + ilvl*0.06 + R.mult*0.6));
  const scale = AFFIX_PCT.includes(stat) ? (1 + ilvl/150) : (1 + ilvl/100);
  const v = 6 * scale * (0.7 + R.mult*0.42) * (0.85 + Math.random()*0.35);
  return Math.round(v*10)/10;
}

// 生成一个配件
function rollPart(slotId, ilvl, rarityId){
  const slot = GUN_SLOT_BY_ID[slotId] || GUN_SLOTS[0];
  const R = RARITY_BY_ID[rarityId] || RARITIES[1];
  const n = R.id==="white" ? 1 : (R.mult>=3 ? 3 : 2);
  const mods=[], used=new Set();
  for(let i=0;i<n;i++){
    let st = i===0 ? RNG.pick(slot.stats) : RNG.pick(slot.stats);
    if(used.has(st)){
      const alt = slot.stats.filter(s=>!used.has(s));
      if(alt.length) st = RNG.pick(alt);
    }
    used.add(st);
    mods.push({ stat:st, value:partStatValue(st, ilvl, R) });
  }
  /* v0.19.0：配件词缀同样「大部分 1 条、少部分 2 条以上」
   * 旧版固定 1 前缀 + 1 后缀；现在按 rollAffixCount 掷数量，1 条时只出前缀或后缀之一。 */
  const cleanPool = arr => arr.filter(a=>!a.elem && !a.elemOnly && !a.needSplash && a.minQ===undefined);
  const want = rollAffixCount(R.id);
  const affixes = [];
  const usedNm = new Set();
  for(let i=0;i<want;i++){
    const isPre = i===0 ? RNG.chance(0.5) : RNG.chance(0.35);
    const pool = cleanPool(isPre?AFFIXES.prefix:AFFIXES.suffix).filter(a=>!usedNm.has(a.nm));
    const a = pool.length ? RNG.pick(pool) : RNG.pick(cleanPool(isPre?AFFIXES.prefix:AFFIXES.suffix));
    if(!a || usedNm.has(a.nm)) continue;
    usedNm.add(a.nm);
    affixes.push({ kind:isPre?"prefix":"suffix", nm:a.nm, mods:a.mods.map(m=>({stat:m.stat, value:scaleModValue(m, ilvl)})) });
  }
  for(const a of affixes) for(const m of a.mods) mods.push({ stat:m.stat, value:m.value });
  return {
    uid: "pt" + Math.floor(Math.random()*1e9).toString(36) + (ilvl%97),
    slot: slot.id,
    name: affixes.map(a=>a.nm).join("") || slot.name,
    shortName: slot.name,
    rarity: R.id,
    ilvl,
    mods, affixes,
  };
}

// 给一把枪 roll 更多不重复槽位的配件（稀有度越高配件越多，顶级填满全部槽位）
function rollGunParts(type, ilvl, rarityId){
  const R = RARITY_BY_ID[rarityId] || RARITIES[0];
  const partCount = {
    white:3, green:3, blue:4, purple:5, orange:6, pearl:7,
    ancient:8, rainbow:9, mythic:9, primordial:10, celestial:10, singularity:10,
  };
  const n = Math.min(GUN_SLOTS.length, partCount[R.id] || 3);
  const pool = GUN_SLOTS.slice();
  const idx = Math.max(0, RARITIES.findIndex(r=>r.id===rarityId));
  const out=[];
  for(let i=0;i<n && pool.length;i++){
    const slot = pool.splice(RNG.ri(0,pool.length-1),1)[0];
    // 配件稀有度锚定在枪身稀有度附近（±1 档），高稀有度更易出高词条配件
    const j = M.clamp(idx + RNG.ri(-1,1), 0, Math.min(idx+1, RARITIES.length-1));
    out.push(rollPart(slot.id, ilvl, RARITIES[j].id));
  }
  return out;
}

// 配件 -> 参与属性计算的词缀条目
function partsAsAffixes(parts){
  return (parts||[]).map(p=>({ nm:p.name, kind:"part", mods:p.mods }));
}

// 配件文案（给 UI 用）
function partText(p){
  return (p.mods||[]).map(m=>affixText(m)).join(" · ");
}
// 配件估值
function partValue(p){
  if(!p) return 0;
  const R = RARITY_BY_ID[p.rarity] || RARITIES[0];
  const n = (p.mods||[]).length;
  return Math.round((30 + (p.ilvl||1)*9) * R.price * (0.5 + n*0.35) / 5) * 5;
}

/* ----------------------------- 武器 ----------------------------- */
class Weapon {
  constructor(spec){
    Object.assign(this, spec);
    this.laser=false;   // 一律实体弹丸（旧存档的 laser 字段强制归一）
    if(!this.affixes) this.affixes=[];
    if(this.power===undefined) this.power=null;
    if(this.ilvl===undefined) this.ilvl=1;
    this.magSizeBase = spec.magSize;   // 生成时的基准弹匣（已含词缀）
    this.mag = spec.magSize;
    // 旧存档兼容：补齐新字段
    if(this.stats){
      if(this.stats.critChance===undefined) this.stats.critChance=0.15;
      if(this.stats.pierce===undefined) this.stats.pierce=0;
      if(this.stats.lifesteal===undefined) this.stats.lifesteal=0;
      if(this.stats.elemChance===undefined) this.stats.elemChance=0;
      if(this.stats.recoil===undefined) this.stats.recoil=0;
      if(this.stats.moveMul===undefined) this.stats.moveMul=1;
      if(this.stats.rangeMul===undefined) this.stats.rangeMul=1;
      if(this.stats.splashDmgMul===undefined) this.stats.splashDmgMul=1;
      if(this.stats.shieldOnHit===undefined) this.stats.shieldOnHit=0;
      if(this.stats.ammoEff===undefined) this.stats.ammoEff=0;
    }
    this.reloading = false;
    this.reloadT = 0;
    this.cd = 0;
    this.chargeT = 0;
    this.held = false;
  }

  get rarityDef(){ return RARITY_BY_ID[this.rarity] || RARITIES[0]; }
  get rarityColor(){ return this.rarityDef.color; }
  get rarityName(){ return this.rarityDef.name; }
  get elemName(){ return AMMO_TYPES[this.element] ? AMMO_TYPES[this.element].name : AMMO_TYPES.none.name; }
  get elemColor(){ return AMMO_TYPES[this.element] ? AMMO_TYPES[this.element].color : "#cfcabb"; }
  get value(){ return weaponPrice(this); }
  // 改装等级标记：代表高膛压装药与更精密的配件公差
  get mayhemTag(){ return (this.mayhem||0)>0 ? `改装${this.mayhem}级` : ""; }

  // 实际弹匣容量（叠加玩家弹匣加成）
  getMagSize(owner){ return Math.max(1, Math.round(this.magSizeBase * (owner&&owner.stats?owner.stats.magMul:1))); }

  // 词缀摘要：给 UI 展示用，一行一条
  affixLines(){
    return this.affixes.map(a=>{
      const txt=a.mods.map(m=>affixText(m)).join('，');
      return { nm:a.nm, kind:a.kind, txt };
    });
  }

  // 改装模块属性行（背包/商店）
  statLines(){
    const s=this.stats;
    const cc=Math.round((s.critChance!==undefined?s.critChance:0.15)*100);
    return [
      `伤害 ${s.damage.toFixed(1)}`,
      `射速 ${s.fireRate.toFixed(1)}/s`,
      `弹匣 ${this.magSizeBase} · 精准 ${(s.accuracy*100|0)}%`,
      `换弹 ${s.reload.toFixed(2)}s`,
      `要害命中 ${cc}% · x${s.crit.toFixed(2)}`,
    ];
  }

  startReload(player){
    const cap = this.getMagSize(player);
    if(this.reloading || this.mag>=cap) return false;
    const reserve = player.ammo[this.stats.ammoType]||0;
    if(reserve<=0 && this.mag<=0) return false;
    this.reloading = true;
    this.reloadT = this.stats.reload * (player&&player.effReloadMul?player.effReloadMul():1);
    SFX.reload();
    return true;
  }
  updateReload(dt, player){
    if(!this.reloading) return;
    this.reloadT -= dt;
    if(this.reloadT<=0){
      const cap = this.getMagSize(player);
      const need = cap - this.mag;
      const reserve = player.ammo[this.stats.ammoType]||0;
      const take = Math.min(need, reserve);
      this.mag += take;
      player.ammo[this.stats.ammoType] = reserve - take;
      this.reloading = false;
    }
  }

  fire(game, x, y, angle, owner){
    if(this.reloading || this.cd>0) return false;
    if(this.mag<=0){ this.startReload(owner); return false; }
    const s=this.stats;
    const fr = owner&&owner.effFireRateMul ? owner.effFireRateMul() : 1;
    const acc = owner&&owner.effAccuracyMul ? owner.effAccuracyMul() : 1;
    const effFR = s.fireRate * fr;
    const effAcc = M.clamp(s.accuracy * acc, 0.3, 0.999);
    this.cd = 1/effFR;

    // 移除「换弹即扔枪」——现实枪械打空弹匣只会触发换弹
    const dm = owner&&owner.effDamageMul ? owner.effDamageMul() : 1;
    const dmgMul = dm;
    const pellets = s.pellets||1;
    // 移动射击：位移越大扩散越夸张，且按枪种分档（冲锋枪保持原样，不吃新增惩罚）
    const mv = owner ? Math.min(1, Math.hypot(owner.moveX||0, owner.moveY||0)) : 0;
    const moveMul = moveSpreadMul(this.type, mv);
    const baseSpread = (1 - (effAcc-0.5)) * s.spread * 2.2;
    const life = (s.splash?2.2:1.4) * (s.rangeMul||1);
    for(let i=0;i<pellets;i++){
      let spread = baseSpread * moveMul;
      if(mv>0.05 && !isSMG(this.type)) spread = Math.min(spread, Math.max(baseSpread*1.35, moveSpreadCap(this.type)));
      const a = angle + RNG.gauss()*spread;
      // Projectile 构造器强制直线实体弹道，不再传 homing / laser / lifesteal / elemChance
      spawnProjectile(game, {
        x, y, angle:a,
        speed:s.speed,
        damage:s.damage * dmgMul,
        element:this.element,
        radius: s.splash?6:4,
        splash:s.splash||0,
        life,
        owner, weapon:this,
        shape: this.projShape,
        pierce: s.pierce||0,
        color: (AMMO_TYPES[this.element]||AMMO_TYPES.none).color,
      });
    }
    this.mag--;
    SFX.shoot();
    if(owner && owner.applyRecoil) owner.applyRecoil(angle, 6);
    return true;
  }

}

/* ----------------------------- 生成 ----------------------------- */
function generateWeapon(level, opts={}){
  const ilvl = Math.max(1, Math.round(opts.ilvl!==undefined ? opts.ilvl : level));
  const quality = opts.rarity || rollQuality(ilvl, opts);
  const R = RARITY_BY_ID[quality] || RARITIES[0];

  // 枪型 / 厂商
  const typeKeys = Object.keys(WEAPON_TYPES);
  const type = opts.type || RNG.pick(typeKeys);
  const base = WEAPON_TYPES[type];
  const manKeys = Object.keys(MANUFACTURERS);
  const man = opts.manufacturer || RNG.pick(manKeys);
  const M0 = MANUFACTURERS[man] || MANUFACTURERS.Jakobs;   // 旧存档的未知厂商不再导致启动崩溃

  // 适配弹种：现实弹药，不再有火焰 / 电击 / 腐蚀等属性
  let element = "none";
  if(type==="launcher") element = "explosive";
  else if(M0.forceExplosive) element = "explosive";
  else if(RNG.chance(0.35 + ilvl*0.006)){
    element = RNG.normPick(AMMO_POOL_BY_PEN, { mid:2, sigma:1.0 });   // 截断正态：中段弹最常见
  }
  if(opts.element && AMMO_TYPES[opts.element]) element = opts.element;   // 枪匠台：指定弹种

  // 底材基础值
  let dmg      = base.baseDmg * (1 + ilvl/45) * M0.dmg;
  let fireRate = base.fireRate * M0.fireRate;
  let accuracy = base.accuracy * M0.accuracy;
  let magSize  = base.mag * M0.mag;
  let reload   = base.reload * M0.reload;
  let crit     = 1.5 * M0.crit;
  let critChance = 0.15;
  let speed    = base.speed;
  let pellets  = base.pellets;
  let splash   = base.splash || 0;
  let pierce   = 0;
  const spread = base.spread;

  // 品质：低档词缀多、高档倍率猛
  // 枪匠台：可传入固定词缀（升阶/更换弹种时保留原词缀，只重算数值）
  const affixes = (opts.affixes && opts.affixes.length!==undefined)
    ? opts.affixes
    : rollAffixes(R, ilvl, { element, splash });
  // 部件：可传入固定部件（枪匠台换装/升阶时保留），否则按品级生成
  const allParts = (opts.parts && opts.parts.length!==undefined)
    ? opts.parts
    : rollGunParts(type, ilvl, quality);
  // 改装模块部件（slot:"core"）单独解析 —— 取最高膛压组件等级为改装等级，弹种适配组件定弹种
  const _cores = allParts.filter(p=>p && p.core);
  const _plain = allParts.filter(p=>!(p && p.core));
  let _coreMayhem = Math.max(0, Math.round(opts.mayhem||0));
  let _chaosFromCore = 0;   // 记录由膛压组件提供的改装等级
  let _coreElem = (opts.element && AMMO_TYPES[opts.element]) ? opts.element : "none";
  let _coreElemLv = -1;
  for(const c of _cores){
    if(c.core==="chaos"){
      const cl=M.clamp(c.lv||0, 0, 9);
      if(cl>_coreMayhem) _coreMayhem = cl;
      _chaosFromCore = Math.max(_chaosFromCore, cl);
    }
    else if(c.core==="elem" && c.elem){ if((c.lv||0) > _coreElemLv){ _coreElemLv=c.lv||0; _coreElem=c.elem; } }
  }
  if(_coreElem!=="none") element = _coreElem;          // 弹种适配组件决定枪械弹种
  const t = affixTotals(affixes.concat(partsAsAffixes(_plain), partsAsAffixes(_cores)));

  dmg      *= 1 + (t.dmgPct||0)/100;
  fireRate *= 1 + (t.fireRatePct||0)/100;
  accuracy *= 1 + (t.accPct||0)/100;
  magSize  *= 1 + (t.magPct||0)/100;
  reload   /= 1 + (t.reloadPct||0)/100;
  if(element!=="none") dmg *= 1 + (t.elemPct||0)/100;
  speed    *= 1 + (t.projSpeed||0)/100;
  if(splash>0) splash *= 1 + (t.splashPct||0)/100;
  pellets  += t.pellets||0;
  /* 发数规则（重要）：
   *   · 霰弹枪底材本身多发，照旧；
   *   · 其余枪「一次一发」——配件/随机词缀一律不再加发数，
   *     只有枪身自带「双管的（稀有）」+1 或「蜂群的（试验型）」+2 才突破。 */
  if((base.pellets||1)<=1){
    let pb=0;
    for(const a of (affixes||[])) for(const m of (a.mods||[])) if(m.stat==="pellets") pb+=m.value;
    pellets = 1 + M.clamp(Math.round(pb), 0, 3);
  }
  pierce   += t.pierce||0;
  crit     += (t.critDmg||0)/100;
  critChance += (t.critChance||0)/100;
  // 扩展词缀：后坐力减免 / 移速 / 射程 / 溅射伤害（命中回血与省弹恒为 0）
  const recoil      = (t.recoil||0);
  const moveSpeed   = (t.moveSpeed||0);
  const rangePct    = (t.range||0);
  const splashDmg   = (t.splashDmg||0);

  // 品质全局倍率（传奇以上是碾压级）
  dmg *= R.mult;
  if(R.mult>1) fireRate *= 1 + (R.mult-1)*0.10;

  // 改装等级：按工程余量线性小幅放大
  // 改装等级由装入的「最高级膛压组件」决定（_coreMayhem 已在部件解析阶段算出）
  const mh = _coreMayhem;
  if(mh>0){
    const gp = _chaosFromCore>0 ? MAYHEM.corePower : MAYHEM.gearPower;   // 改装模块更猛
    const k = Math.pow(gp, mh);
    dmg *= k;
    fireRate *= 1 + (k-1)*0.06;
  }

  // 取整
  dmg      = Math.round(dmg*10)/10;
  fireRate = Math.round(Math.max(0.25, fireRate)*100)/100;
  magSize  = Math.max(1, Math.round(magSize));
  reload   = Math.round(Math.max(0.25, reload)*100)/100;
  accuracy = M.clamp(accuracy, 0.40, 0.999);
  critChance = M.clamp(critChance, 0, 0.85);
  crit     = Math.round(crit*100)/100;
  splash   = Math.round(splash);
  speed    = Math.round(speed);

  const name = weaponName(man, base, R, element, affixes);

  return new Weapon({
    name, type, manufacturer:man, element, rarity:quality, ilvl,
    magSize,
    mayhem: mh>0 ? mh : 0,
    power: R.power ? true : null,
    affixes,
    laser: false,                      // 实体弹丸
    projShape: projShapeFor(man, element, type),
    stats:{
      damage:dmg, fireRate, accuracy, mag:magSize, reload,
      speed, pellets, splash, crit, critChance,
      auto: base.auto, charge:!!base.charge, spread,
      ammoType: base.ammoType, pierce,
      homing: false,                   // 直线弹道
      lifesteal: 0,                   // 无急救效率
      elemChance: 0,                  // 无弹种增益
      recoil: M.clamp(recoil,0,80),
      moveMul: 1 + moveSpeed/100,
      rangeMul: 1 + rangePct/100,
      splashDmgMul: 1 + splashDmg/100,
      shieldOnHit: 0,                 // 命中不再回复插板耐久
      ammoEff: 0,                     // 无省弹
    },
    parts: allParts,
  });
}

/* ----------------------------- 命名 ----------------------------- */
// 厂商显示中文兵工厂名，具名档用真实枪械型号，不再拼接奇幻词与弹种标签
function weaponName(man, base, R, element, affixes){
  const M0 = MANUFACTURERS[man] || MANUFACTURERS.Jakobs;
  const ammoTag = element!=="none" && AMMO_TYPES[element] ? " · "+AMMO_TYPES[element].short : "";
  if(R.named){
    const nm = RNG.pick(base.named || ["制式"]);
    return `${M0.name} ${nm}${ammoTag}`;
  }
  if(R.id==="white") return `${M0.name}${base.name}${ammoTag}`;
  const pre = affixes.find(a=>a.kind==="prefix");
  const suf = affixes.find(a=>a.kind==="suffix");
  return `${M0.name}${base.name}${pre?" "+pre.nm:""}${suf?suf.nm:""}${ammoTag}`;
}

/* ----------------------------- 定价 / 词缀文案 ----------------------------- */
function weaponPrice(w){
  const R = RARITY_BY_ID[w.rarity] || RARITIES[0];
  let p = (60 + (w.ilvl||1)*22) * R.price;
  p += (w.affixes?w.affixes.length:0) * 140;
  for(const pt of (w.parts||[])) p += pt.core ? (pt.value||0) : partValue(pt);   // 配件 / 改装模块计入估值
  if(w.power) p *= 1.35;
  if((w.mayhem||0)>0) p *= 1 + w.mayhem*0.12;     // 改装等级溢价 0.12/级
  return Math.round(p/10)*10;
}

const AFFIX_LABEL = {
  dmgPct:"枪口动能", fireRatePct:"理论射速", accPct:"射击精度", magPct:"弹匣容量",
  reloadPct:"换弹速度", critDmg:"要害伤害", critChance:"要害命中",
  elemPct:"弹药效能", elemChance:"特殊弹触发", splashPct:"破片半径",
  projSpeed:"弹头初速", pierce:"穿透等级", pellets:"弹丸数", lifesteal:"急救效率",
  recoil:"后坐控制", moveSpeed:"机动性", range:"有效射程", splashDmg:"破片伤害",
  shieldOnHit:"护甲维护", ammoEff:"供弹可靠性",
};
function affixText(m){
  const nm = AFFIX_LABEL[m.stat] || m.stat;
  const v = m.value;
  if(m.stat==="pierce") return `+${v} ${nm}`;
  if(m.stat==="pellets") return `+${v} ${nm}`;
  if(m.stat==="critDmg") return `${nm} +${v}%`;
  if(m.stat==="lifesteal") return `${nm} ${v}%`;
  if(AFFIX_INVERT[m.stat]) return `${nm} -${Math.abs(v)}%`;   // 越高越减负（后坐力/省弹）
  return v>=0 ? `${nm} +${v}%` : `${nm} ${v}%`;
}

/* ----------------------------- 战术模式转换器 ----------------------------- */
/*
 * 把「旧刷宝体系」程序化武器（Weapon 实例）转成 塔科夫 / 吃鸡 模式所用的
 * 轻量枪械对象 {name,cat,dmg,mag,reserve,rpm,spread,range,auto,pellets,...}。
 * 两模式都用自家的射线命中（hit-scan），所以只取数值，不依赖 Weapon.fire。
 * cat 直接沿用 BL 的 type（pistol/smg/...），moveSpread 系统能识别。
 */
const MODE_RANGE    = { pistol:520, smg:430, shotgun:290, rifle:660, sniper:1040, launcher:600 };
const MODE_RESERVE  = { pistol:4,   smg:3,   shotgun:5,   rifle:3,   sniper:4,    launcher:4 };

/* 护甲穿透：越高越能无视高级护甲的减伤。
 * 由枪型 + 稀有度决定——狙击/步枪天然穿甲强，白板手枪打 T8 基本挠痒。
 * 只影响塔科夫 / 吃鸡的护甲结算，不改战役伤害。 */
const AP_BY_TYPE = { pistol:0.05, smg:0.09, shotgun:0.03, rifle:0.16, sniper:0.26, launcher:0.30 };
function gunArmorPen(type, rarityId, ilvl){
  const R = RARITY_BY_ID[rarityId] || RARITIES[0];
  const idx = Math.max(0, RARITIES.indexOf(R));
  const base = AP_BY_TYPE[type]!==undefined ? AP_BY_TYPE[type] : 0.10;
  const lv = Math.max(0, (ilvl||10)-10)*0.002;
  return Math.round(M.clamp(base + Math.min(6,idx)*0.030 + lv, 0.02, 0.58)*1000)/1000;
}

function blGunConvert(w){
  const s=w.stats, t=w.type;
  return {
    name: w.name,
    type: t,
    cat: t,
    manufacturer: w.manufacturer,
    element: w.element,
    rarity: w.rarity,
    ilvl: w.ilvl,
    mayhem: w.mayhem||0,
    projShape: w.projShape||"round",
    laser: w.laser||false,
    affixes: w.affixes||[],
    parts: w.parts||[],
    dmg: Math.round(s.damage*10)/10,
    mag: s.mag,
    reserve: Math.max(s.mag, Math.round(s.mag*(MODE_RESERVE[t]||3))),
    rpm: Math.max(40, Math.round(s.fireRate*60)),
    spread: s.spread,
    range: MODE_RANGE[t]||560,
    auto: !!s.auto,
    pellets: s.pellets||1,
    splash: s.splash||0,
    armorPen: gunArmorPen(t, w.rarity, w.ilvl),
    value: w.value,
    color: w.element!=="none"
      ? (ELEMENTS[w.element]?ELEMENTS[w.element].color:"#fff")
      : (MANUFACTURERS[w.manufacturer]?MANUFACTURERS[w.manufacturer].color:"#cfcabb"),
  };
}
function blGunGen(ilvl, opts){
  const w=blGunConvert(generateWeapon(ilvl, opts));
  // Scav 等低阶配装可强制指定塔科夫实装型号，避免生成「兵工厂+枪型+词缀」的泛称。
  if(opts && opts.model){
    const ammo=(w.element && w.element!=="none" && AMMO_TYPES[w.element]) ? " · "+AMMO_TYPES[w.element].short : "";
    w.name=String(opts.model)+ammo;
  }
  return w;
}

// 稀有度 → 颜色（兼容字符串 / 数字两种表示，供战利品与商店着色）
function gunRarColor(r){
  if(typeof r==="string"){ const R=RARITY_BY_ID[r]; return R?R.color:"#e9e4dc"; }
  const arr=["#9aa4b2","#5bd75b","#4aa3ff","#c77dff","#ffd200","#ff5c5c"];
  return arr[r]||"#e9e4dc";
}

/* ----------------------------- 枪匠台：精密改装 -----------------------------
/*
 * 原「精密改装 / 更换弹种」改为现实枪械工位操作。
 * 做法是把枪的固定参数（类型/兵工厂/品级/等级/改装等级/弹种）喂回 generateWeapon，
 * 由同一条生成管线重算数值与词条，保证动能·射速·弹匣·估值全部自洽。
 *   op = "reroll"  重调部件（类型/兵工厂/弹种/品级不变，词条重掷）
 *   op = "element" 更换弹种（指定 newElement，词条随之重算）
 *   op = "mayhem"  提升改装等级（mayhem+1，数值按 1.05^m 工程余量放大）
 */
function reforgeBlGun(gun, op, arg){
  const base = {
    rarity: gun.rarity,
    type: gun.type,
    manufacturer: gun.manufacturer,
    ilvl: gun.ilvl,
    mayhem: gun.mayhem||0,
    element: gun.element || "none",
    parts: (gun.parts||[]).slice(),
  };
  if(op==="element"){
    base.element = AMMO_TYPES[arg] ? arg
      : RNG.normPick(AMMO_POOL_BY_PEN, { mid:2, sigma:1.0 });
    base.affixes = gun.affixes || [];      // 换弹种：保留原词条，只换弹种并重算
  } else if(op==="mayhem"){
    base.mayhem = (gun.mayhem||0)+1;
    base.affixes = gun.affixes || [];      // 提升改装等级：保留原词条 → 数值严格增大
  } else if(op==="part"){
    // 重铸单个槽位配件：其余配件与主词缀全部保留
    const slotId = arg;
    base.parts = (gun.parts||[]).filter(p=>p.slot!==slotId);
    base.parts.push(rollPart(slotId, gun.ilvl, gun.rarity));
    base.affixes = gun.affixes || [];
  }
  // reroll：不传 affixes，由生成管线重掷全部词缀（配件保留）
  const out = blGunConvert(generateWeapon(gun.ilvl, base));
  out.uid = gun.uid;
  out.kind = gun.kind || "weapon";
  return out;
}

/* 把一个现成配件装到枪上（替换同槽位），重算属性 */
function installPartOnGun(gun, part){
  if(!gun || !part) return gun;
  const parts = (gun.parts||[]).filter(p=>p.slot!==part.slot);
  parts.push(part);
  const out = blGunConvert(generateWeapon(gun.ilvl, {
    rarity: gun.rarity, type: gun.type, manufacturer: gun.manufacturer,
    ilvl: gun.ilvl, mayhem: gun.mayhem||0, element: gun.element||"none",
    affixes: gun.affixes||[], parts,
  }));
  out.uid = gun.uid; out.kind = gun.kind || "weapon";
  return out;
}

/* 拆解：枪 → 配件数组（枪本身消失） */
function salvageGun(gun){
  return (gun && gun.parts) ? gun.parts.slice() : [];
}

/* 售卖价：估价 × 0.5（背包/仓库直售，与 raid.js 的 RAID_VENDOR_RATE 保持一致；v0.19.0 由 0.42 → 0.5） */
function gunSellPrice(gun){
  return Math.max(20, Math.round((gun.value||0) * 0.5 / 10) * 10);
}

/* =========================================================================
 * 枪械外观系统：弹头形状 + 枪模型变化
 * 形状只由枪型 / 弹头类型 / 兵工厂决定，全部为实体弹丸轮廓。
 * ========================================================================= */
function projShapeFor(man, elem, type){
  if(type==="launcher" || elem==="explosive") return "bomb";   // 榴弹战斗部
  if(man==="Jakobs" || man==="Torgue") return "slug";         // 重弹头
  if(man==="Vladof" || man==="Hyperion") return "dart";       // 尖头高速弹
  if(man==="Tediore")    return "box";                        // 方形弹托
  return "round";                                             // 标准弹头
}

// 枪模型规格：由枪型决定基础轮廓，配件叠加细节
function gunModelSpec(gun){
  const type = gun.type || gun.cat || "rifle";
  const base = {
    pistol:  { len:20, barrel:9,  stock:false },
    smg:     { len:24, barrel:13, stock:false },
    shotgun: { len:28, barrel:19, stock:true  },
    rifle:   { len:32, barrel:23, stock:true  },
    sniper:  { len:44, barrel:36, stock:true  },
    launcher:{ len:30, barrel:17, stock:true  },
  }[type] || { len:32, barrel:23, stock:true };
  const parts = gun.parts || [];
  const has = id => parts.some(p=>p.slot===id);
  const color = (gun.color)
    || (gun.element && gun.element!=="none" && AMMO_TYPES[gun.element] ? AMMO_TYPES[gun.element].color : "#cfd2d8");
  return {
    type,
    len:    base.len,
    barrel: base.barrel + (has("barrel")?7:0),
    stock:  base.stock || has("stock"),
    optic:  has("optic"),
    muzzle: has("muzzle"),
    underbarrel: has("underbarrel"),
    grip:   has("grip"),
    body:   has("body"),
    core:   has("core"),
    color,
  };
}

// 在 Canvas 上画枪（已 translate 到持枪点、rotate 到朝向；枪朝 +x 方向）
function drawGunCanvas(ctx, spec, scale, bodyC, accC){
  const L=spec.len*scale, B=spec.barrel*scale;
  const stroke=(x,y,w,h)=>{ ctx.strokeStyle="#0d0a07"; ctx.lineWidth=1.4; ctx.strokeRect(x,y,w,h); };
  ctx.save();
  // 枪托（向后 -x）
  if(spec.stock){
    ctx.fillStyle=bodyC; ctx.fillRect(-L*0.52, -3.2*scale, L*0.22, 6.4*scale); stroke(-L*0.52, -3.2*scale, L*0.22, 6.4*scale);
  }
  // 机匣/主体
  ctx.fillStyle=bodyC; ctx.fillRect(-L*0.30, -5*scale, L*0.62, 10*scale); stroke(-L*0.30, -5*scale, L*0.62, 10*scale);
  // 枪管（向前 +x，颜色由配件/弹种决定）
  ctx.fillStyle=accC; ctx.fillRect(L*0.30, -2.6*scale, B*scale*0.62, 5.2*scale); stroke(L*0.30, -2.6*scale, B*scale*0.62, 5.2*scale);
  // 瞄具
  if(spec.optic){
    ctx.fillStyle="#1b1b22"; ctx.fillRect(-L*0.04, -10*scale, 9*scale, 5*scale); stroke(-L*0.04, -10*scale, 9*scale, 5*scale);
    ctx.fillStyle=accC;      ctx.fillRect(-L*0.01, -9*scale, 3*scale, 3*scale);
  }
  // 枪口装置
  if(spec.muzzle){
    ctx.fillStyle="#3a3f47"; ctx.fillRect(L*0.30 + B*scale*0.62, -3.8*scale, 4*scale, 7.6*scale);
    stroke(L*0.30 + B*scale*0.62, -3.8*scale, 4*scale, 7.6*scale);
  }
  // 下挂（护木下）
  if(spec.underbarrel){
    ctx.fillStyle=accC; ctx.fillRect(L*0.18, 5*scale, 11*scale, 4*scale); stroke(L*0.18, 5*scale, 11*scale, 4*scale);
  }
  // 握把 / 弹匣井
  ctx.fillStyle=bodyC; ctx.fillRect(-L*0.12, 5*scale, 5.5*scale, 8*scale); stroke(-L*0.12, 5*scale, 5.5*scale, 8*scale);
  ctx.restore();
}

// 生成 SVG 缩略图字符串（用于 HTML 商店 / 枪匠台卡片）
function gunSvg(gun, size){
  const spec = gunModelSpec(gun);
  const s = size/40;
  const c = spec.color;
  const dark = "#10131a";
  let g = "";
  if(spec.stock) g += `<rect x="${2*s}" y="${19*s}" width="${9*s}" height="${6*s}" rx="1.5" fill="${c}" stroke="${dark}" stroke-width="1"/>`;
  g += `<rect x="${8*s}" y="${17*s}" width="${22*s}" height="${7*s}" rx="1.5" fill="${c}" stroke="${dark}" stroke-width="1"/>`;
  g += `<rect x="${28*s}" y="${18*s}" width="${Math.min(spec.barrel,36)*s}" height="${5*s}" rx="1" fill="#9aa6b4" stroke="${dark}" stroke-width="1"/>`;
  if(spec.optic) g += `<rect x="${14*s}" y="${11*s}" width="${8*s}" height="${6*s}" rx="1" fill="#20242e" stroke="${c}" stroke-width="1"/>`;
  if(spec.muzzle) g += `<rect x="${(28+Math.min(spec.barrel,36))*s}" y="${17*s}" width="${3.4*s}" height="${7*s}" fill="#333a44" stroke="${dark}"/>`;
  if(spec.underbarrel) g += `<rect x="${18*s}" y="${24*s}" width="${10*s}" height="${3.4*s}" fill="${c}" stroke="${dark}" stroke-width="1"/>`;
  g += `<rect x="${10*s}" y="${24*s}" width="${5*s}" height="${7*s}" rx="1" fill="${c}" stroke="${dark}" stroke-width="1"/>`;
  return `<svg width="${size}" height="${size}" viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">${g}</svg>`;
}
