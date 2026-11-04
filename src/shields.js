/* =========================================================================
 * shields.js — 护盾装备（v0.16.0 全新装备类型）
 *
 * 与枪械一样「由配件组成」：电池组 / 充能模块 / 延时继电器 / 承载框架 四槽，
 * 每个配件自带 1 前缀 + 1 后缀并贡献数值；整件护盾另有 1 前缀 + 1 后缀。
 * 三主数值：容量 capacity / 充能速度 rate（每秒）/ 充能延迟 delay（不受伤害多少秒后开始回盾）。
 * 战斗侧（raid.js）：血条上方独立蓝色护盾条 → 先扣盾 → 再扣护甲耐久 → 最后扣血；
 * 护盾被打空时给一小段无敌，随后按延迟与速度自主回充。
 * 命名沿用 v0.15.x 的军工品质刻度，全部为可解释的现实装备 / 工艺词，无奇幻命名。
 * ========================================================================= */

/* 9 阶品级（与 raid.js 的 RAID_TIERS 一一对应，本模块自带一份以免加载顺序耦合） */
const SHIELD_GRADE = [
  { name:"民用", color:"#cfc9bb" }, { name:"翻新", color:"#93ad7c" },
  { name:"制式", color:"#7b9ab5" }, { name:"军规", color:"#c1a85a" },
  { name:"精工", color:"#9c8fb5" }, { name:"特种", color:"#c68b4c" },
  { name:"试验", color:"#79a9a2" }, { name:"原型", color:"#b06a62" },
  { name:"竞赛", color:"#c9b878" },
];
function shieldGrade(i){ return SHIELD_GRADE[M.clamp(Math.round(i||0),0,8)]; }
function shieldColor(s){
  if(s && s.qColor) return s.qColor;
  return shieldGrade(s && (s.qTier!==undefined?s.qTier:s.rarity)).color;
}

/* ----------------------------- 底材（T1~T9） ----------------------------- */
const SHIELD_BASES = {
  1:{ name:"T1 便携拦截模块",   cap:46,  rate:9,  delay:5.0, invuln:0.40, value:1400   },
  2:{ name:"T2 单兵护盾组件",   cap:72,  rate:12, delay:4.6, invuln:0.45, value:3600   },
  3:{ name:"T3 战术偏转护盾",   cap:108, rate:16, delay:4.2, invuln:0.50, value:8600   },
  4:{ name:"T4 复合拦截模块", cap:155, rate:20, delay:3.8, invuln:0.58, value:22000  },
  5:{ name:"T5 全向拦截阵列",   cap:215, rate:25, delay:3.4, invuln:0.65, value:58000  },
  6:{ name:"T6 车载级护盾组",   cap:290, rate:30, delay:3.0, invuln:0.72, value:145000 },
  7:{ name:"T7 双层防护阵列",   cap:385, rate:36, delay:2.7, invuln:0.82, value:360000 },
  8:{ name:"T8 高功率拦截系统", cap:500, rate:43, delay:2.4, invuln:0.92, value:880000 },
  9:{ name:"T9 全向防护阵列",   cap:640, rate:52, delay:2.1, invuln:1.05, value:2100000},
};
const SHIELD_TIERS = [1,2,3,4,5,6,7,8,9];

/* ----------------------------- 四个配件槽 ----------------------------- */
const SHIELD_SLOTS = [
  { id:"cell",    name:"电池组",     stat:"capacity", label:"容量",     unit:"%" },
  { id:"charger", name:"充能模块",   stat:"rate",     label:"充能速度", unit:"%" },
  { id:"relay",   name:"延时继电器", stat:"delay",    label:"充能延迟", unit:"s" },
  { id:"frame",   name:"承载框架",   stat:"invuln",   label:"破盾无敌", unit:"s" },
];
const SHIELD_SLOT_BY_ID = {};
for(const s of SHIELD_SLOTS) SHIELD_SLOT_BY_ID[s.id]=s;

/* 配件前后缀池：与枪械一样「每件配件必有 1 前缀 + 1 后缀」，且都是工艺词 */
const SHIELD_PART_PREFIX = [
  { nm:"高密度",   cap:10, rate:0,  dly:0,    inv:0    },
  { nm:"锂聚合物", cap:14, rate:0,  dly:0,    inv:0    },
  { nm:"快速",     cap:0,  rate:12, dly:0,    inv:0    },
  { nm:"双路",     cap:0,  rate:16, dly:0,    inv:0    },
  { nm:"低滞后",   cap:0,  rate:0,  dly:-0.35,inv:0    },
  { nm:"瞬时",     cap:0,  rate:0,  dly:-0.50,inv:0    },
  { nm:"缓冲",     cap:0,  rate:0,  dly:0,    inv:0.10 },
  { nm:"钛合金",   cap:0,  rate:0,  dly:0,    inv:0.16 },
  { nm:"模块化",   cap:8,  rate:8,  dly:0,    inv:0    },
  { nm:"军规",     cap:6,  rate:6,  dly:-0.15,inv:0.05 },
];
const SHIELD_PART_SUFFIX = [
  { nm:"·标准批次", cap:5,  rate:0,  dly:0,    inv:0    },
  { nm:"·大容量",   cap:12, rate:0,  dly:0,    inv:0    },
  { nm:"·高功率",   cap:0,  rate:14, dly:0,    inv:0    },
  { nm:"·快充",     cap:0,  rate:10, dly:-0.10,inv:0    },
  { nm:"·低延迟",   cap:0,  rate:0,  dly:-0.40,inv:0    },
  { nm:"·抗冲击",   cap:0,  rate:0,  dly:0,    inv:0.12 },
  { nm:"·加固框",   cap:0,  rate:0,  dly:0,    inv:0.18 },
  { nm:"·校验件",   cap:6,  rate:6,  dly:-0.10,inv:0.04 },
];

/* 整件护盾前后缀 */
const SHIELD_PREFIX = [
  { nm:"加固型",   mods:[{stat:"capacity", min:8,  max:16}] },
  { nm:"高功率型", mods:[{stat:"rate",     min:10, max:20}] },
  { nm:"快反型",   mods:[{stat:"delay",    min:-0.5,max:-0.25}] },
  { nm:"缓冲型",   mods:[{stat:"invuln",   min:0.10,max:0.20}] },
  { nm:"复合型",   mods:[{stat:"capacity", min:6,  max:12},{stat:"rate",min:5,max:10}] },
  { nm:"长续航型", mods:[{stat:"capacity", min:12, max:22},{stat:"delay",min:0.15,max:0.35}] },
  { nm:"轻载型",   mods:[{stat:"rate",     min:14, max:24},{stat:"capacity",min:-10,max:-5}] },
  { nm:"全向型",   mods:[{stat:"capacity", min:10, max:18},{stat:"invuln",min:0.06,max:0.12}] },
  { nm:"低温型",   mods:[{stat:"delay",    min:-0.7,max:-0.4},{stat:"rate",min:6,max:12}] },
  { nm:"竞赛型",   mods:[{stat:"capacity", min:18, max:30},{stat:"rate",min:12,max:22}] },
];
const SHIELD_SUFFIX = [
  { nm:"·军用批次", mods:[{stat:"capacity", min:6,  max:12}] },
  { nm:"·快充模块", mods:[{stat:"rate",     min:8,  max:16}] },
  { nm:"·低滞后",   mods:[{stat:"delay",    min:-0.4,max:-0.2}] },
  { nm:"·缓冲内衬", mods:[{stat:"invuln",   min:0.08,max:0.16}] },
  { nm:"·校验合格", mods:[{stat:"capacity", min:5,  max:9},{stat:"rate",min:5,max:9}] },
  { nm:"·高规格",   mods:[{stat:"capacity", min:10, max:18},{stat:"delay",min:0.1,max:0.3}] },
  { nm:"·轻量化",   mods:[{stat:"rate",     min:12, max:20},{stat:"capacity",min:-8,max:-4}] },
  { nm:"·出厂封存", mods:[{stat:"capacity", min:14, max:24},{stat:"invuln",min:0.06,max:0.12}] },
];

/* ----------------------------- 独特加成 ----------------------------- */
/* 每件护盾按品级 / 配件随机获得 1~3 条；key 会随存档与联机快照一起走。 */
const SHIELD_PERKS = {
  overcharge:{ id:"overcharge", name:"过载容量", color:"#7fd0ff", desc:"护盾上限额外 +12%" },
  siphon:    { id:"siphon",     name:"击杀回充", color:"#8fe07a", desc:"每次击杀立即回充 18% 容量" },
  surge:     { id:"surge",      name:"破盾冲击", color:"#c07bff", desc:"破盾时迟滞周围 140px 内的目标" },
  plate:     { id:"plate",      name:"护甲保全", color:"#9fb0bd", desc:"有盾时护甲耐久损耗 -35%" },
  quickstart:{ id:"quickstart", name:"快速整备", color:"#ffd23f", desc:"充能延迟 -0.8s" },
  still:     { id:"still",      name:"静止增益", color:"#79a9a2", desc:"静止不动时充能速度 ×2" },
  bulwark:   { id:"bulwark",    name:"延时护罩", color:"#4fd6ff", desc:"破盾无敌 +0.4s" },
  emitter:   { id:"emitter",    name:"定向泄能", color:"#c9a13a", desc:"护盾吸收伤害 +8%" },
};
const SHIELD_PERK_KEYS = Object.keys(SHIELD_PERKS);

/* ----------------------------- 具名护盾 ----------------------------- */
/* 高品质专属：现实军工型号式命名，固定词条与固定独特加成，同档数值显著高于随机件。 */
const SHIELD_UNIQUES = [
  { id:"s_bastion", name:"堡垒-MK2 单兵护盾", tier:5, qTier:4,
    perk:"加固框架 · 破盾无敌 +0.4s，护甲耐久损耗 -35%",
    perks:["bulwark","plate"], affix:["加固型","·缓冲内衬"], bonus:{capacity:1.20, invuln:0.20} },
  { id:"s_sentry",  name:"哨兵-6 拦截护盾", tier:6, qTier:5,
    perk:"双路充能模块 · 充能速度 +35%，静止时再翻倍",
    perks:["still","quickstart"], affix:["高功率型","·快充模块"], bonus:{rate:1.35, delay:-0.6} },
  { id:"s_curtain", name:"铁幕-9 全向阵列", tier:7, qTier:6,
    perk:"全向拦截面板 · 容量 +45%，破盾冲击迟滞周围目标",
    perks:["overcharge","surge"], affix:["全向型","·出厂封存"], bonus:{capacity:1.45} },
  { id:"s_vanguard",name:"先锋-4 快反护盾", tier:5, qTier:5,
    perk:"低滞后继电器 · 充能延迟 -1.2s，击杀立即回充",
    perks:["quickstart","siphon"], affix:["快反型","·低滞后"], bonus:{delay:-1.2} },
  { id:"s_bulwark", name:"壁垒-7 复合防护组", tier:7, qTier:6,
    perk:"双层缓冲框架 · 无敌 +0.3s，护盾吸伤 +8%",
    perks:["bulwark","emitter"], affix:["缓冲型","·缓冲内衬"], bonus:{invuln:0.30} },
  { id:"s_aegis",   name:"铁穹-8 高功率系统", tier:8, qTier:7,
    perk:"高功率拦截系统 · 容量 +60%，四条独特加成齐备",
    perks:["overcharge","siphon","surge","plate"], affix:["竞赛型","·高规格"], bonus:{capacity:1.60} },
  { id:"s_watch",   name:"守望-3 便携拦截件", tier:3, qTier:4,
    perk:"轻量化封装 · 充能速度 +40%，破盾后立即整备",
    perks:["still","quickstart"], affix:["轻载型","·快充模块"], bonus:{rate:1.40} },
  { id:"s_ironveil",name:"铁幕-12 竞赛级阵列", tier:9, qTier:8,
    perk:"出厂封存全向阵列 · 容量 +80%，全部独特加成",
    perks:["overcharge","siphon","surge","plate","bulwark","emitter"],
    affix:["竞赛型","·出厂封存"], bonus:{capacity:1.80, rate:1.30, delay:-0.7, invuln:0.30} },
];

/* ----------------------------- 配件生成 ----------------------------- */
function shieldRollPart(slotId, q, ilvl){
  const S=SHIELD_SLOT_BY_ID[slotId]||SHIELD_SLOTS[0];
  const k=1+(q||0)*0.16+((ilvl||10)/240);
  const p=RNG.pick(SHIELD_PART_PREFIX), s=RNG.pick(SHIELD_PART_SUFFIX);
  const mods=[
    { stat:"capacity", value:Math.round((p.cap+s.cap)*k*10)/10 },
    { stat:"rate",     value:Math.round((p.rate+s.rate)*k*10)/10 },
    { stat:"delay",    value:Math.round((p.dly+s.dly)*k*100)/100 },
    { stat:"invuln",   value:Math.round((p.inv+s.inv)*k*100)/100 },
  ].filter(m=>m.value!==0);
  return {
    uid:"sp"+Math.floor(Math.random()*1e9).toString(36), kind:"shieldpart", slot:S.id,
    name:p.nm+S.name+s.nm, rarity:q, ilvl:ilvl||10, mods,
    prefix:p.nm, suffix:s.nm,
    value:Math.round((180+q*140+(ilvl||10)*22)/10)*10,
  };
}
function shieldPartText(pt){
  const out=[];
  for(const m of (pt.mods||[])){
    const S=SHIELD_SLOT_BY_ID[pt.slot];
    const nm=({capacity:"容量",rate:"充能",delay:"延迟",invuln:"无敌"})[m.stat]||m.stat;
    if(m.stat==="delay"||m.stat==="invuln") out.push(`${nm} ${m.value>0?"+":""}${m.value}s`);
    else out.push(`${nm} ${m.value>0?"+":""}${m.value}%`);
  }
  return out.join(" · ")||"标准件";
}

/* ----------------------------- 整件词缀 ----------------------------- */
function shieldRollAffixes(q){
  const k=1+(q||0)*0.12;
  const P=RNG.pick(SHIELD_PREFIX), S=RNG.pick(SHIELD_SUFFIX);
  const roll=(a)=>({ kind:a===P?"prefix":"suffix", nm:a.nm,
    mods:a.mods.map(m=>{
      let v=RNG.fr(m.min,m.max)*k;
      v=(m.stat==="delay"||m.stat==="invuln")?Math.round(v*100)/100:Math.round(v*10)/10;
      return { stat:m.stat, value:v };
    }) });
  return [roll(P),roll(S)];
}
function shieldAffixSum(affixes, stat){
  let v=0;
  for(const a of (affixes||[])) for(const m of (a.mods||[])) if(m.stat===stat) v+=m.value;
  return v;
}
function shieldPartSum(parts, stat){
  let v=0;
  for(const p of (parts||[])) for(const m of (p.mods||[])) if(m.stat===stat) v+=m.value;
  return v;
}

/* ----------------------------- 数值计算 ----------------------------- */
function shieldStats(tier, q, parts, affixes, perks, bonus){
  const base=SHIELD_BASES[M.clamp(Math.round(tier||1),1,9)]||SHIELD_BASES[1];
  const rar=M.clamp(Math.round(q||0),0,8);
  const grade=1+rar*0.22;                       // 品级带来的全局工程余量
  const aCap=shieldAffixSum(affixes,"capacity")+shieldPartSum(parts,"capacity");
  const aRate=shieldAffixSum(affixes,"rate")+shieldPartSum(parts,"rate");
  const aDly=shieldAffixSum(affixes,"delay")+shieldPartSum(parts,"delay");
  const aInv=shieldAffixSum(affixes,"invuln")+shieldPartSum(parts,"invuln");
  const pk=new Set(perks||[]);
  const B=bonus||{};
  let capMul=grade*(1+aCap/100)*(B.capacity||1);
  if(pk.has("overcharge")) capMul*=1.12;
  let capacity=Math.max(20,Math.round(base.cap*capMul));
  let rate=Math.max(3,Math.round(base.rate*(1+rar*0.09)*(1+aRate/100)*(B.rate||1)*10)/10);
  let delay=Math.max(0.6,Math.round((base.delay-rar*0.12+aDly+(B.delay||0))*10)/10);
  if(pk.has("quickstart")) delay=Math.max(0.6,Math.round((delay-0.8)*10)/10);
  let invuln=Math.max(0.25,Math.round((base.invuln+aInv+(B.invuln||0)+(pk.has("bulwark")?0.4:0))*100)/100);
  const value=Math.round(base.value*(1+rar*0.55)*(1+(affixes||[]).length*0.06)
    *(1+(perks||[]).length*0.10)*(B.value||1)/100)*100;
  return { capacity, rate, delay, invuln, value };
}

function shieldName(baseName, affixes, q){
  const p=(affixes||[]).find(a=>a.kind==="prefix");
  const s=(affixes||[]).find(a=>a.kind==="suffix");
  return (p?p.nm+" ":"")+baseName+(s?s.nm:"");
}

/* ----------------------------- 生成一件护盾 ----------------------------- */
function raidMakeShield(tier, rarity){
  const t=M.clamp(Math.round(tier||1),1,9);
  const q=rarity===undefined
    ? M.clamp(Math.round((typeof raidBudgetTier==="function"?raidBudgetTier(0):0)),0,8)
    : M.clamp(Math.round(rarity),0,8);
  const ilvl=8+t*4+q*2;
  const parts=SHIELD_SLOTS.map(S=>shieldRollPart(S.id,q,ilvl));
  const affixes=shieldRollAffixes(q);
  // 品级越高，独特加成越多：民用 1 条 → 竞赛 3 条；具名件另由 raidMakeShieldUnique 指定
  const perkN=M.clamp(1+Math.floor(q/3),1,3);
  const pool=SHIELD_PERK_KEYS.slice();
  const perks=[];
  for(let i=0;i<perkN && pool.length;i++){
    const idx=RNG.ri(0,pool.length-1);
    perks.push(pool.splice(idx,1)[0]);
  }
  const st=shieldStats(t,q,parts,affixes,perks);
  const g=shieldGrade(q);
  return Object.assign({
    uid:"sh"+Math.floor(Math.random()*1e9).toString(36), kind:"shield",
    tier:t, rarity:q, ilvl, qTier:q, qName:g.name, qColor:g.color,
    baseName:SHIELD_BASES[t].name,
    name:shieldName(SHIELD_BASES[t].name,affixes,q),
    parts, affixes, perks,
  }, st);
}

/* 具名护盾：固定词条 / 配件 / 加成，名字与加成写死，同档数值显著更高 */
function raidMakeShieldUnique(u){
  const stamp=Date.now().toString(36)+Math.floor(Math.random()*999).toString(36);
  const q=M.clamp(u.qTier!==undefined?u.qTier:u.tier,0,8);
  const parts=SHIELD_SLOTS.map(S=>shieldRollPart(S.id,q,10+u.tier*5));
  const P=SHIELD_PREFIX.find(a=>a.nm===u.affix[0])||SHIELD_PREFIX[0];
  const S=SHIELD_SUFFIX.find(a=>a.nm===u.affix[1])||SHIELD_SUFFIX[0];
  const affixes=[
    { kind:"prefix", nm:P.nm, mods:P.mods.map(m=>({stat:m.stat,value:m.max*1.4})) },
    { kind:"suffix", nm:S.nm, mods:S.mods.map(m=>({stat:m.stat,value:m.max*1.4})) },
  ];
  const st=shieldStats(u.tier,q,parts,affixes,u.perks,Object.assign({value:1.8},u.bonus||{}));
  const g=shieldGrade(q);
  return Object.assign({
    uid:"uq"+stamp, kind:"shield", tier:u.tier, rarity:q, ilvl:10+u.tier*5,
    qTier:q, qName:g.name, qColor:g.color,
    baseName:SHIELD_BASES[u.tier].name,
    name:"「"+u.name+"」",
    parts, affixes, perks:u.perks.slice(),
    unique:u.id, uniqPerk:u.perk, uniqTitle:u.name,
  }, st);
}
function raidRollShieldUnique(luck){
  const maxT=M.clamp(5+Math.round(M.clamp(luck||0,0,1)*3),5,9);
  const pool=SHIELD_UNIQUES.filter(u=>u.tier<=maxT);
  return raidMakeShieldUnique(RNG.pick(pool.length?pool:SHIELD_UNIQUES));
}

/* ----------------------------- 展示 ----------------------------- */
function shieldLines(s){
  const out=[
    `容量 ${s.capacity}`,
    `充能 ${s.rate.toFixed(1)}/s`,
    `延迟 ${s.delay.toFixed(1)}s`,
    `破盾无敌 ${s.invuln.toFixed(2)}s`,
  ];
  const names=(s.perks||[]).map(k=>SHIELD_PERKS[k]?SHIELD_PERKS[k].name:k);
  if(names.length) out.push("加成："+names.join(" · "));
  return out;
}
function shieldAffixText(a){
  return a.mods.map(m=>{
    const nm=({capacity:"容量",rate:"充能速度",delay:"充能延迟",invuln:"破盾无敌"})[m.stat]||m.stat;
    return (m.stat==="delay"||m.stat==="invuln")
      ? `${nm} ${m.value>0?"+":""}${m.value}s`
      : `${nm} ${m.value>0?"+":""}${m.value}%`;
  }).join(" · ");
}
/* 物品栏 / 商店 / 配装 / 融合结果卡共用的一张卡 */
function shieldCard(s,opts){
  opts=opts||{};
  const col=shieldColor(s), g=shieldGrade(s.qTier!==undefined?s.qTier:s.rarity);
  const parts=(s.parts||[]).map(p=>`<span class="part-chip" style="border-color:${col};color:${col}">${p.name}<em>${shieldPartText(p)}</em></span>`).join("");
  return `<div class="shop-item" style="border-left-color:${col}${opts.margin?';margin:12px 0':''}">
    <div class="si-name" style="color:${col}">${opts.prefix||""}${s.name}<span style="font-size:11px;opacity:.9"> · ${g.name}</span></div>
    <div class="si-meta">T${s.tier} 护盾 · ${(s.parts||[]).length} 个配件 · ${(s.affixes||[]).length} 条前后缀${s.uniqPerk?' · <b style="color:#ffd23f">具名装备</b>':''}</div>
    ${s.uniqPerk?`<div class="uniq-perk">✦ ${s.uniqPerk}</div>`:''}
    <div class="si-stats">${shieldLines(s).slice(0,4).join(" · ")} · 估值 ₽${(typeof priceTextShort==="function"?priceTextShort(s.value):s.value)}
      ${parts?`<br><span class="part-row">${parts}</span>`:''}
      <br><span style="color:#9fd0ff">${(s.affixes||[]).map(shieldAffixText).join(" ； ")}</span></div>
    ${opts.sell?`<div class="si-buy"><span class="si-price">₽ ${(typeof priceTextShort==="function"?priceTextShort(Math.round((s.value||0)*(typeof RAID_VENDOR_RATE!=="undefined"?RAID_VENDOR_RATE:0.42))):0)}</span>
        <button class="btn ghost" data-sell="s:${s.uid}">售卖</button></div>`:''}
  </div>`;
}
/* 存档迁移：老档没有护盾字段时补齐 */
function ensureShield(it){
  if(!it || it.kind!=="shield") return it;
  if(it.capacity===undefined || !it.parts){
    const t=M.clamp(it.tier||1,1,9), q=M.clamp(it.qTier!==undefined?it.qTier:(it.rarity||0),0,8);
    return raidMakeShield(t,q);
  }
  if(!it.perks) it.perks=[];
  if(it.qColor===undefined){ const g=shieldGrade(qOf(it)); it.qTier=qOf(it); it.qName=g.name; it.qColor=g.color; }
  return it;
}
function qOf(s){ return M.clamp(s.qTier!==undefined?s.qTier:(s.rarity||0),0,8); }
