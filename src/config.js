/* =========================================================================
 * config.js — 全局常量与平衡数值
 * 边境行动：弹药 / 枪械成色 / 配件词缀 / 枪型 / PMC 定义
 * 移除全部超现实与制式词条，改为拟真军械体系；v0.16.1 起弹药按塔科夫口径 + 弹种代号命名。
 *   内部键名（element / mayhem / elemPct 等）一律保留，仅语义与显示改名，
 *   保证旧 localStorage 存档、联机快照与拍卖行数据可直接读取。
 * ========================================================================= */

const CFG = {
  version: "0.21.9",
  name: "边境行动",
  en: "BORDER OPS",
  // 界面开关（其他模式代码仍保留，只是不显示入口）
  onlyRaid: true,        // 只显示塔科夫模式
  raidMinimap: false,    // 塔科夫 HUD 小地图
  /* v0.21.1：显示密度（设置里可切）
   *   "compact" 精简 —— 枪名只留型号 / 枪型，不显示厂商、前后缀词、弹种尾巴
   *   "full"    完整 —— 厂商 + 型号 + 前后缀 + 弹种，卡片里也展开完整词缀
   * showManufacturer 保留为兼容字段，切到 full 时同步为 true。 */
  display: "compact",
  showManufacturer: false, // 由 display 派生：display==="full" 时为 true
  weaponQuality: true,     // 武器品质总开关（v0.21.6：恢复生成；精简模式只在显示层隐藏品质与前后缀）
  // 画布逻辑分辨率基准（实际按窗口缩放）
  worldTile: 64,
  // 玩家基础
  player: {
    radius: 16,
    baseHP: 100,
    baseShield: 50,
    shieldDelay: 3.0,      // 无防弹插板时的兜底整备延迟
    shieldRegen: 12,       // 无防弹插板时的兜底整备速度
    hpRegen: 0,            // 基础不回血
    speed: 230,            // px/s
    pickupRange: 70,
    abilityCD: 12,         // 战术动作冷却（秒）
  },
  // 升级
  level: {
    baseXP: 60,
    xpGrowth: 1.32,
    skillPointsPerLevel: 1,
    maxLevel: Infinity,   // 等级不设上限：持续变强，技能点持续投放
  },
};

/* ----------------------------- 弹种 / 终点效应 -----------------------------
 * 玩家可见名称、配色与描述全部为现实弹药；内部键名 element 与 ELEMENTS 别名保持兼容。
 * pen   穿透等级（对应护甲穿透计算）
 * mult  对无防护(flesh) / 护盾(shield) / 硬质插板(armor) 的终点效应系数
 * dot   终点效应强度（0 / 5 / 6）：>0 时命中会附加持续状态，由 raid.js 结算。
 *       引燃 / 撕裂创口 / 钝击失能 / 跳弹 都是可解释的弹道终点效应，不是魔法。
 * status 状态在 HUD 与头顶标签上的名称（拟真化后的元素状态名）
 */
const AMMO_TYPES = {
  none:      { id:"none",      name:"5.45×39mm PS gs",  short:"PS",   color:"#cfcabb", pen:12, dot:0, strong:null,     status:"",         mult:{flesh:1.00,shield:0.95,armor:0.80}, desc:"7N6 钢芯全被甲弹，AK-74 系列制式弹，穿深低、对软目标停止作用一般" },
  fire:      { id:"fire",      name:"5.45×39mm T gs",   short:"T",    color:"#d97a3c", pen:14, dot:6, strong:"flesh",  status:"引燃",     mult:{flesh:1.20,shield:0.90,armor:0.80}, desc:"T-45 曳光弹，弹尾曳光剂便于修正弹道，命中可引燃；对护盾与插板乏力" },
  shock:     { id:"shock",     name:"7.62×39mm BP gzh", short:"BP",   color:"#9fb0bd", pen:36, dot:0, strong:"armor",  status:"钝击失能", mult:{flesh:0.90,shield:1.30,armor:1.45}, desc:"7N23 淬火钢芯穿甲弹，对硬质插板穿深高；冲击造成短暂失能并额外削护盾" },
  corrosive: { id:"corrosive", name:"9×19mm RIP",       short:"RIP",  color:"#8fae72", pen:5,  dot:6, strong:"flesh",  status:"撕裂",     mult:{flesh:1.55,shield:1.10,armor:0.42}, desc:"RIP 扩张弹头撕裂创口、啃噬软质防护，几乎打不穿硬质插板" },
  cryo:      { id:"cryo",      name:"9×39mm SP-6 gs",   short:"SP-6", color:"#7fa2b8", pen:11, dot:0, strong:"flesh",  status:"迟滞",     mult:{flesh:1.15,shield:0.95,armor:0.78}, desc:"SP-6 亚音速穿甲弹，配消音器枪声传播距离短；命中失衡造成短暂迟滞" },
  explosive: { id:"explosive", name:"40mm VOG-25",      short:"VOG",  color:"#c2a05a", pen:6,  dot:0, strong:null,     status:"",         mult:{flesh:1.30,shield:1.15,armor:0.95}, desc:"GP-25 系列用破片榴弹战斗部，溅射半径有限" },
  radiation: { id:"radiation", name:"5.45×39mm BT gs",  short:"BT",   color:"#b6b073", pen:30, dot:5, strong:"armor",  status:"跳弹",     mult:{flesh:1.05,shield:1.05,armor:1.30}, desc:"7N24 钢芯穿甲曳光弹，兼顾穿深与弹道观察，穿透后跳弹可伤及附近目标" },
};
// ELEMENTS 作为兼容别名保留 —— 21 个脚本、旧 localStorage 存档与联机快照仍按 element 字段读写。
const ELEMENTS = AMMO_TYPES;
/* 战斗弹种梯队（按穿深升序）：RIP(5) → SP-6(11) → T(14) → BT(30) → BP(36)。
 * 生成枪械时用截断正态抽样（RNG.normPick），中段常规弹最常见，两端扩张弹 / 穿甲弹罕见 ——
 * 均匀分布会让「每五把枪就有一把 RIP」这种不真实情况出现。
 * 顺序即正态轴：改顺序前先确认 pen 仍然升序。 */
const AMMO_POOL_BY_PEN = ["corrosive","cryo","fire","radiation","shock"];

/* ============================ 弹药物品（v0.21.1） ============================
 * 子弹从「枪上的计数器」变成背包里的独立物品（可堆叠，按发计数）：
 *   4 个弹族 × 5 个级别 = 20 种
 *
 *   弹族（口径）：口径与枪型绑定，见 shot 的 cal 字段
 *     light 轻弹 9×19mm     → 手枪 / 冲锋枪
 *     mid   中弹 5.45×39mm  → 步枪
 *     heavy 重弹 7.62×54R / 12-70 → 狙击枪 / 霰弹枪
 *     grenade 榴弹 40mm VOG → 榴弹发射器
 *
 *   级别（共用一套，穿深单调递增，复用 AMMO_TYPES 的终点效应）：
 *     T1 民用 扩张弹(pen 5) → T2 制式 亚音速(11) → T3 军规 曳光(14)
 *     → T4 精工 穿甲曳光(30) → T5 特种 淬火穿甲(36)
 *   特效从 T3 才出现，且 dotK 随级别递减 —— 高级弹靠穿深，不靠烧灼。
 *   power 叠在 elemMult 之外，提供整体威力递进（1.00 → 1.30）。
 * ============================================================================ */
const AMMO_CALS = {
  light:  { id:"light",   name:"轻弹", spec:"9×19mm",           short:"9×19", types:["pistol","smg"],     k:1.00, color:"#c9c3b4" },
  mid:    { id:"mid",     name:"中弹", spec:"5.45×39mm",        short:"5.45", types:["rifle"],            k:1.60, color:"#a9bc9a" },
  heavy:  { id:"heavy",   name:"重弹", spec:"7.62×54R / 12-70", short:"7.62", types:["sniper","shotgun"], k:2.40, color:"#c2a888" },
  grenade:{ id:"grenade", name:"榴弹", spec:"40mm VOG-25",      short:"40mm", types:["launcher"],         k:5.00, color:"#c2a05a" },
};
const AMMO_CAL_LIST = ["light","mid","heavy","grenade"];

/* 5 个级别：name 级别名 / elem 终点效应 / power 整体威力 / dotK 持续效果折减 / value 基准估值（每发）*/
/* power 梯度（v0.21.1 平衡重算）：
 * T1 是扩张弹，对裸目标天然最强（mult.flesh 1.55）；若 power 只涨 6%，T2 对无甲
 * 反而比 T1 弱（1.15×1.06=1.22 < 1.55）——「升级弹药」就变成了降级。
 * 这组值是用真实 mult 反解出来的，保证 T1→T5 对「无防护 / 护盾 / 插板」三轴都单调：
 *   无防护 1.55 → 1.55 → 1.72 → 1.73 → 1.74 （对裸目标基本持平，不会变弱）
 *   护盾   1.10 → 1.28 → 1.29 → 1.73 → 2.51
 *   插板   0.42 → 1.05 → 1.14 → 2.15 → 2.80 （高弹级专治护甲，6.7 倍差距）
 * 改 power 前请先用 verify 的「弹级对 X 单调变强」三条断言验一遍。 */
const AMMO_GRADES = [
  { lv:1, name:"民用", elem:"corrosive", power:1.00, dotK:1.00, value:2   },
  { lv:2, name:"制式", elem:"cryo",      power:1.35, dotK:1.00, value:5   },
  { lv:3, name:"军规", elem:"fire",      power:1.43, dotK:0.60, value:13  },
  { lv:4, name:"精工", elem:"radiation", power:1.65, dotK:0.45, value:38  },
  { lv:5, name:"特种", elem:"shock",     power:1.93, dotK:0.35, value:105 },
];
const AMMO_GRADE_BY_LV = {};
for(const g of AMMO_GRADES) AMMO_GRADE_BY_LV[g.lv]=g;

/* 枪型 → 弹族 */
function ammoCalOfType(type){
  for(let i=0;i<AMMO_CAL_LIST.length;i++){
    const c=AMMO_CALS[AMMO_CAL_LIST[i]];
    if(c.types.indexOf(type)>=0) return c.id;
  }
  return "mid";
}
function ammoItemId(cal, lv){ return "ammo_"+cal+"_"+lv; }
function ammoGradeOf(lv){
  const n=Math.max(1, Math.min(5, Math.round(lv)||1));
  return AMMO_GRADE_BY_LV[n] || AMMO_GRADES[0];
}
/* 从物品 id 反解（"ammo_mid_3" → {cal:"mid", lv:3}），不认识返回 null */
function ammoParseId(id){
  const m=/^ammo_([a-z]+)_(\d)$/.exec(String(id||""));
  if(!m || !AMMO_CALS[m[1]]) return null;
  return { cal:m[1], lv:Math.max(1, Math.min(5, +m[2])) };
}
/* 单发估值：级别基准 × 弹族系数 */
function ammoValue(cal, lv){
  const c=AMMO_CALS[cal]||AMMO_CALS.mid, g=ammoGradeOf(lv);
  return Math.max(1, Math.round(g.value*c.k));
}
/* 一发子弹的完整定义（拾取物 / 商店货 / 弹道结算都用它） */
function ammoDef(cal, lv){
  const c=AMMO_CALS[cal]||AMMO_CALS.mid, g=ammoGradeOf(lv);
  return {
    id: ammoItemId(c.id, g.lv), kind:"ammo", cal:c.id, lv:g.lv,
    name: c.name+" · "+g.name, short:c.short+" "+g.name, elem:g.elem,
    power:g.power, dotK:g.dotK, value:ammoValue(c.id, g.lv),
    color:c.color, spec:c.spec, types:c.types,
  };
}
/* id → 定义（枪的 loaded 字段、存档里的 ammo 键都用 id） */
function ammoDefFromId(id){
  const p=ammoParseId(id);
  return p ? ammoDef(p.cal, p.lv) : null;
}
const AMMO_DEFS = {};
for(const cal of AMMO_CAL_LIST) for(const g of AMMO_GRADES) AMMO_DEFS[ammoItemId(cal,g.lv)]=ammoDef(cal,g.lv);
// 防护类型（raidArmorType 返回值）的显示名与血条色
const ARMOR_TYPE_NAME  = { flesh:"无防护", shield:"护盾", armor:"硬质插板" };
const ARMOR_TYPE_COLOR = { flesh:"#e23b3b", shield:"#4fd6ff", armor:"#ffd23f" };
// 弹种对目标防护类型的终点效应倍率；none / 未知弹种恒为 1
function elemMult(element, armorType){
  if(!element || element==="none") return 1;
  const E=ELEMENTS[element];
  return E ? (E.mult[armorType||"flesh"] ?? 1) : 1;
}

/* ----------------------------- 枪械成色 / 品级 ----------------------------- */
/*
 * 12 档品级，权重极度偏斜（民用 : 出厂封存 ≈ 1000 : 1）。
 * 低档靠「改装词条数量」，高档靠「工艺倍率」补偿。
 * affixes:[最少,最多] / mult:全局数值倍率 / price:物价倍率
 * 名称与颜色改为军工品质刻度，不再使用奇幻稀有度配色。
 */
/* ----------------------------- 品质阶梯（v0.21.7 重排） -----------------------------
 * 12 阶，**名字按「越往下越高级」的采购 / 收藏逻辑排**，颜色同时满足两个条件：
 *   ① 相邻两阶色相至少差 30°（实测最小 32°）、Lab 色差 ΔE ≥ 22（能一眼分辨）；
 *   ② 相对亮度**严格递增** 0.20 → 0.80（一眼能看出「更高级 = 更亮」）。
 * 亮度是用 sRGB 相对亮度算的（见 verify 第 29 组的单调断言），改色请同时保证这两条。
 *
 *   序号  名字    色      说明
 *   1   民用    #867b61  哑褐灰 · 民品
 *   2   制式    #4c9d2e  军绿   · 列装
 *   3   军规    #559edf  钢蓝   · 军规件
 *   4   精选    #bc94e9  紫罗兰 · 挑选件
 *   5   精工    #ef93d6  品红   · 精加工
 *   6   特种    #f5a8a2  珊瑚   · 特种部队
 *   7   试验    #f2bd54  琥珀   · 试验批
 *   8   原型    #b6de19  黄绿   · 原型机
 *   9   定型    #76ebd7  青玉   · 定型批
 *   10  特供    #c7e1f4  冰蓝   · 特殊供应（黑市赌博机专供）
 *   11  珍藏    #f8e289  香槟金 · 珍藏品
 *   12  孤品    #fce0ee  虹彩粉 · 孤品
 *
 * 注：`id` 是历史主键（存档里的 rarity / CSS 类名 loot-orange 等全靠它），**不要再改**；
 * 名字与颜色只是显示，两者已经和 id 的字面意思解耦（比如 orange 现在是品红）。
 * ========================================================================= */
const RARITIES = [
  { id:"white",       name:"民用", color:"#867b61", weight:40,     mult:1.00, affixes:[0,0],   minLv:1,  price:1    },
  { id:"green",       name:"制式", color:"#4c9d2e", weight:30,     mult:1.00, affixes:[1,2],   minLv:1,  price:2.2  },
  { id:"blue",        name:"军规", color:"#559edf", weight:12,     mult:1.00, affixes:[2,4],   minLv:2,  price:5.5  },
  { id:"purple",      name:"精选", color:"#bc94e9", weight:3,      mult:1.28, affixes:[4,6],   minLv:4,  price:13   },
  { id:"orange",      name:"精工", color:"#ef93d6", weight:0.70,   mult:3.50, affixes:[3,3],   minLv:6,  price:44,  named:true },
  /* v0.21.7：原 3.20 比上一档 3.50 还低（品质越高反而越弱），已拉平为 4.10 */
  /* v0.21.9：price 同一处漏改 —— 38 比上一档 44 还低（品质越高反而越便宜），拉平为 68 保持价格序列单调 */
  { id:"pearl",       name:"特种", color:"#f5a8a2", weight:0.42,   mult:4.10, affixes:[4,4],   minLv:10, price:68,  named:true },
  { id:"ancient",     name:"试验", color:"#f2bd54", weight:0.20,   mult:4.80, affixes:[6,6],   minLv:14, price:96,  named:true, power:true },
  { id:"rainbow",     name:"原型", color:"#b6de19", weight:0.06,   mult:5.60, affixes:[6,6],   minLv:18, price:280, named:true, power:true },
  { id:"mythic",      name:"定型", color:"#76ebd7", weight:0.030,  mult:6.20, affixes:[7,7],   minLv:22, price:620, named:true, power:true },
  /* v0.21.8：最高三档（特供 / 珍藏 / 孤品 = 第 10/11/12 阶）默认权重归零，
   * 不再出现在任何随机掉落 / 商店 / 盲盒里；唯一获取途径是【黑市赌博机】（见 SHOPS.gamble.weights）。 */
  { id:"primordial",  name:"特供", color:"#c7e1f4", weight:0,      mult:7.60, affixes:[8,8],   minLv:28, price:1150,named:true, power:true },
  { id:"celestial",   name:"珍藏", color:"#f8e289", weight:0,      mult:9.50, affixes:[9,9],   minLv:34, price:2300,named:true, power:true },
  { id:"singularity", name:"孤品", color:"#fce0ee", weight:0,      mult:12.0, affixes:[10,10], minLv:40, price:4200,named:true, power:true },
];
const RARITY_BY_ID = {};
for(const r of RARITIES) RARITY_BY_ID[r.id]=r;

/* ----------------------------- 改装词条池 ----------------------------- */
/*
 * 全部改为可解释的枪械改装 / 弹药工艺术语。
 * 已删除：急救效率、吸盾、弹药效能/触发、额外弹丸（双管/蜂群）、溅射、省弹、
 *         以及「出厂精调」「湮灭」「裂空」等超现实命名。
 * stat 说明（内部键名保留以兼容旧存档与伤害管线）：
 *   dmgPct 枪口动能% / fireRatePct 理论射速% / accPct 射击精度%
 *   magPct 弹匣容量% / reloadPct 换弹速度% / critDmg 要害伤害 / critChance 要害命中
 *   projSpeed 弹头初速% / pierce 穿透等级 / recoil 后坐控制
 *   moveSpeed 机动性% / range 有效射程%
 */
const AFFIXES = {
  prefix: [
  // v0.16.0：双方词缀池全部保留 —— 合作者 27 前缀 / 19 后缀的军工工艺术语 +
  // 原 64 前缀 / 45 后缀（已逐条真实化命名、死属性重映射）。共 91 前缀 / 64 后缀。
    { nm:"冷锻枪管",   lvl:1,  mods:[{stat:"dmgPct",      min:8,  max:16}] },
    { nm:"加重枪管",   lvl:10, mods:[{stat:"dmgPct",      min:16, max:28}] },
    { nm:"比赛级膛线", lvl:20, mods:[{stat:"dmgPct",      min:28, max:45}] },
    { nm:"高膛压装药", lvl:26, mods:[{stat:"dmgPct",      min:40, max:60}] },
    { nm:"轻量枪机",   lvl:1,  mods:[{stat:"fireRatePct", min:8,  max:16}] },
    { nm:"强化复进簧", lvl:12, mods:[{stat:"fireRatePct", min:16, max:28}] },
    { nm:"精磨枪管",   lvl:1,  mods:[{stat:"accPct",      min:6,  max:12}] },
    { nm:"浮置枪管",   lvl:9,  mods:[{stat:"accPct",      min:12, max:20}] },
    { nm:"扩容弹匣",   lvl:1,  mods:[{stat:"magPct",      min:15, max:28}] },
    { nm:"并联弹匣",   lvl:13, mods:[{stat:"magPct",      min:28, max:50}] },
    { nm:"精磨扳机",   lvl:4,  mods:[{stat:"critDmg",     min:20, max:38}] },
    { nm:"两道火扳机", lvl:17, mods:[{stat:"critDmg",     min:40, max:70}] },
    { nm:"可调照门",   lvl:7,  mods:[{stat:"critChance",  min:4,  max:8}] },
    { nm:"快拆弹匣井", lvl:2,  mods:[{stat:"reloadPct",   min:12, max:22}] },
    { nm:"长枪管",     lvl:3,  mods:[{stat:"projSpeed",   min:15, max:28}] },
    { nm:"钨芯弹头",   lvl:15, mods:[{stat:"pierce",      min:1,  max:1}] },
    { nm:"重枪管",     lvl:5,  mods:[{stat:"dmgPct", min:12, max:22},{stat:"fireRatePct", min:-12, max:-6}] },
    { nm:"短突入型",   lvl:6,  mods:[{stat:"fireRatePct", min:10, max:18},{stat:"reloadPct", min:10, max:18}] },
    { nm:"枪口制退器", lvl:1,  mods:[{stat:"recoil",      min:8,  max:16}] },
    { nm:"人体工学",   lvl:1,  mods:[{stat:"moveSpeed",   min:6,  max:12}] },
    { nm:"精密枪管",   lvl:3,  mods:[{stat:"range",       min:10, max:20}] },
    { nm:"战术前握把", lvl:2,  mods:[{stat:"moveSpeed", min:5, max:10},{stat:"fireRatePct", min:5, max:10}] },
    { nm:"光学座",     lvl:4,  mods:[{stat:"range", min:8, max:16},{stat:"accPct", min:5, max:10}] },
    { nm:"枪管镀铬",   lvl:12, mods:[{stat:"dmgPct", min:14, max:24},{stat:"recoil", min:8, max:16}] },
    { nm:"折叠托",     lvl:7,  mods:[{stat:"moveSpeed", min:6, max:12},{stat:"reloadPct", min:8, max:16}] },
    { nm:"消焰器",     lvl:9,  mods:[{stat:"range", min:10, max:18},{stat:"projSpeed", min:10, max:18}] },
    { nm:"缓冲垫",     lvl:10, mods:[{stat:"recoil", min:12, max:22},{stat:"reloadPct", min:8, max:16}] },
    // —— 扩展前缀池（拟真命名）——
    { nm:"强装药",   lvl:1,  mods:[{stat:"dmgPct",      min:8,  max:16}] },
    { nm:"加大装药量",   lvl:10, mods:[{stat:"dmgPct",      min:16, max:28}] },
    { nm:"竞赛级装药",   lvl:20, mods:[{stat:"dmgPct",      min:28, max:45}] },
    { nm:"超载膛压",   lvl:26, mods:[{stat:"dmgPct",      min:40, max:60}] },
    { nm:"短行程导气",   lvl:1,  mods:[{stat:"fireRatePct", min:8,  max:16}] },
    { nm:"强化导气",   lvl:12, mods:[{stat:"fireRatePct", min:16, max:28}] },
    { nm:"精磨来复线",   lvl:1,  mods:[{stat:"accPct",      min:6,  max:12}] },
    { nm:"微光瞄准镜",   lvl:9,  mods:[{stat:"accPct",      min:12, max:20}] },
    { nm:"加长弹匣井",   lvl:1,  mods:[{stat:"magPct",      min:15, max:28}] },
    { nm:"弹鼓供弹",   lvl:13, mods:[{stat:"magPct",      min:28, max:50}] },
    { nm:"加重击针",   lvl:4,  mods:[{stat:"critDmg",     min:20, max:38}] },
    { nm:"竞赛扳机组",   lvl:17, mods:[{stat:"critDmg",     min:40, max:70}] },
    { nm:"可调扳机力",   lvl:7,  mods:[{stat:"critChance",  min:4,  max:8}] },
    { nm:"快速装填导槽",   lvl:2,  mods:[{stat:"reloadPct",   min:12, max:22}] },
    { nm:"加长线膛",   lvl:3,  mods:[{stat:"projSpeed",   min:15, max:28}] },
    { nm:"曳光弹适配",   lvl:6,  mods:[{stat:"elemPct",     min:12, max:22}], elem:"fire" },
    { nm:"空尖弹适配",   lvl:6,  mods:[{stat:"elemPct",     min:12, max:22}], elem:"corrosive" },
    { nm:"钢芯弹适配",   lvl:6,  mods:[{stat:"elemPct",     min:12, max:22}], elem:"shock" },
    { nm:"亚音速适配",   lvl:6,  mods:[{stat:"elemPct",     min:12, max:22}], elem:"cryo" },
    { nm:"破片战斗部",   lvl:8,  mods:[{stat:"splashPct",   min:20, max:35}], needSplash:true },
    // v0.12.5 每次射击发数改为「稀有词条」体系：
    //   常规非霰弹枪恒定 1 发/次；并联枪管（稀有+）→ 2 发；三发点放（高阶+）→ 3 发
    { nm:"并联霰弹枪管", lvl:14, minQ:3, pellet:1, mods:[{stat:"pellets",     min:1,  max:1}] },
    { nm:"硬芯弹头",   lvl:15, mods:[{stat:"pierce",      min:1,  max:1}] },
    { nm:"战地快拆",   lvl:18, mods:[{stat:"reloadPct",   min:2,  max:4}] },
    { nm:"特种弹击针",   lvl:11, mods:[{stat:"critChance",  min:8,  max:15}], elemOnly:true },
    { nm:"加厚枪管",   lvl:5,  mods:[{stat:"dmgPct", min:12, max:22},{stat:"fireRatePct", min:-12, max:-6}] },
    { nm:"铝合金机匣",   lvl:6,  mods:[{stat:"fireRatePct", min:10, max:18},{stat:"reloadPct", min:10, max:18}] },
    { nm:"精工装配",   lvl:16, mods:[{stat:"accPct", min:8, max:14},{stat:"critDmg", min:15, max:30}] },
    { nm:"三发点放",   lvl:24, minQ:6, pellet:3, mods:[{stat:"pellets",     min:2,  max:2}] },
    // —— 扩展词缀（枪型/配件联动的新维度）——
    { nm:"液压缓冲",   lvl:1,  mods:[{stat:"recoil",      min:8,  max:16}] },
    { nm:"轻装携行",   lvl:1,  mods:[{stat:"moveSpeed",   min:6,  max:12}] },
    { nm:"加长瞄准基线",   lvl:3,  mods:[{stat:"range",       min:10, max:20}] },
    { nm:"预制破片",   lvl:6,  mods:[{stat:"splashDmg",   min:15, max:30}] },
    { nm:"缓冲枪托",   lvl:8,  mods:[{stat:"recoil", min:4,  max:10}] },
    { nm:"扩容弹匣卡榫",   lvl:5,  mods:[{stat:"magPct",     min:8,  max:18}] },
    { nm:"轻量护木",   lvl:2,  mods:[{stat:"moveSpeed", min:5, max:10},{stat:"fireRatePct", min:5, max:10}] },
    { nm:"光学测距座",   lvl:4,  mods:[{stat:"range", min:8, max:16},{stat:"accPct", min:5, max:10}] },
    { nm:"加重枪机框",   lvl:12, mods:[{stat:"dmgPct", min:14, max:24},{stat:"recoil", min:8, max:16}] },
    { nm:"折叠枪托",   lvl:7,  mods:[{stat:"moveSpeed", min:6, max:12},{stat:"reloadPct", min:8, max:16}] },
    { nm:"延长枪管",   lvl:9,  mods:[{stat:"range", min:10, max:18},{stat:"projSpeed", min:10, max:18}] },
    { nm:"缓冲复进簧",   lvl:10, mods:[{stat:"recoil", min:12, max:22},{stat:"reloadPct", min:8, max:16}] },
    // —— v0.14.10 扩充①：元素专属（只在对应元素的枪上出现）——
    { nm:"曳光装药",   lvl:12, elem:"fire",      mods:[{stat:"dmgPct",min:14,max:24},{stat:"critChance",min:8,max:14}] },
    { nm:"燃烧剂配方",   lvl:24, elem:"fire",      mods:[{stat:"elemPct",min:18,max:32},{stat:"splashDmg",min:12,max:22}] },
    { nm:"钢芯供弹",   lvl:12, elem:"shock",     mods:[{stat:"fireRatePct",min:12,max:22},{stat:"critChance",min:8,max:14}] },
    { nm:"淬火钢芯",   lvl:26, elem:"shock",     mods:[{stat:"elemPct",min:18,max:32},{stat:"critChance",min:5,max:10}] },
    { nm:"铜被甲扩张",   lvl:14, elem:"corrosive", mods:[{stat:"dmgPct",min:16,max:28},{stat:"pierce",min:1,max:1}] },
    { nm:"扩张弹头",   lvl:26, elem:"corrosive", mods:[{stat:"elemPct",min:20,max:34},{stat:"dmgPct",min:12,max:22}] },
    { nm:"亚音速消音",   lvl:12, elem:"cryo",      mods:[{stat:"critChance",min:10,max:18},{stat:"accPct",min:8,max:16}] },
    { nm:"低温发射药",   lvl:24, elem:"cryo",      mods:[{stat:"elemPct",min:18,max:30},{stat:"moveSpeed",min:8,max:16}] },
    { nm:"高爆破片战斗部",   lvl:14, elem:"explosive", needSplash:true, mods:[{stat:"splashDmg",min:18,max:32},{stat:"splashPct",min:12,max:22}] },
    { nm:"穿甲曳光适配",   lvl:16, elem:"radiation", mods:[{stat:"elemPct",min:14,max:26},{stat:"fireRatePct",min:10,max:18}] },
    // —— v0.14.10 扩充②：代价权衡（高收益 + 明确负面，让词缀有取舍）——
    { nm:"高速枪机",   lvl:18, mods:[{stat:"fireRatePct",min:28,max:45},{stat:"accPct",min:-18,max:-10}] },
    { nm:"单发强装药",   lvl:20, mods:[{stat:"dmgPct",min:40,max:60},{stat:"magPct",min:-20,max:-12}] },
    { nm:"加速导气",   lvl:16, mods:[{stat:"fireRatePct",min:25,max:40},{stat:"reloadPct",min:-20,max:-12}] },
    { nm:"重型机匣",   lvl:22, mods:[{stat:"dmgPct",min:35,max:55},{stat:"moveSpeed",min:-14,max:-8}] },
    { nm:"紧公差膛线",   lvl:14, mods:[{stat:"accPct",min:20,max:32},{stat:"fireRatePct",min:-16,max:-10}] },
    { nm:"精密击针组",   lvl:28, mods:[{stat:"critDmg",min:60,max:100},{stat:"critChance",min:8,max:14},{stat:"fireRatePct",min:-14,max:-8}] },
    { nm:"轻量快拆",   lvl:20, mods:[{stat:"reloadPct",min:4,max:7},{stat:"dmgPct",min:-14,max:-8}] },
    { nm:"双芯穿甲",   lvl:24, mods:[{stat:"pierce",min:2,max:2},{stat:"dmgPct",min:-16,max:-10}] },
    // —— v0.14.10 扩充③：机制向与高等级档位（ilvl 24+ 才开放）——
    { nm:"超长枪管",   lvl:30, mods:[{stat:"range",min:25,max:40},{stat:"projSpeed",min:20,max:35}] },
    { nm:"双路供弹",   lvl:28, mods:[{stat:"magPct",min:18,max:30},{stat:"magPct",min:15,max:28}] },
    { nm:"重型缓冲托",   lvl:20, mods:[{stat:"recoil",min:8,max:14},{stat:"dmgPct",min:-10,max:-6}] },
    { nm:"骨架化枪托",   lvl:22, mods:[{stat:"moveSpeed",min:14,max:24},{stat:"fireRatePct",min:8,max:14}] },
    { nm:"四发点放",   lvl:34, minQ:8, pellet:4, mods:[{stat:"pellets",min:3,max:3},{stat:"dmgPct",min:10,max:20}] },
    { nm:"竞赛级强装药",   lvl:36, mods:[{stat:"dmgPct",min:55,max:80},{stat:"critChance",min:10,max:18},{stat:"fireRatePct",min:-18,max:-10}] },
  ],
  suffix: [

    { nm:"·军用批次", lvl:1,  mods:[{stat:"dmgPct",      min:6,  max:12}] },
    { nm:"·快拔套",   lvl:2,  mods:[{stat:"reloadPct",   min:10, max:20}] },
    { nm:"·校准",     lvl:3,  mods:[{stat:"accPct",      min:6,  max:14}] },
    { nm:"·测距分划", lvl:6,  mods:[{stat:"critChance",  min:3,  max:7}] },
    { nm:"·强化供弹", lvl:5,  mods:[{stat:"fireRatePct", min:5,  max:10}] },
    { nm:"·精修",     lvl:10, mods:[{stat:"critDmg",     min:18, max:34}] },
    { nm:"·大容量",   lvl:7,  mods:[{stat:"magPct",      min:12, max:24}] },
    { nm:"·钢芯",     lvl:16, mods:[{stat:"pierce",      min:1,  max:1}] },
    { nm:"·高初速",   lvl:5,  mods:[{stat:"projSpeed",   min:10, max:20}] },
    { nm:"·归零",     lvl:12, mods:[{stat:"dmgPct", min:8, max:16},{stat:"critChance", min:2, max:5}] },
    { nm:"·弹匣并联", lvl:11, mods:[{stat:"reloadPct", min:12, max:22},{stat:"magPct", min:8, max:16}] },
    { nm:"·重弹头",   lvl:13, mods:[{stat:"dmgPct", min:12, max:20},{stat:"fireRatePct", min:-8, max:-4}] },
    { nm:"·轻枪机",   lvl:14, mods:[{stat:"fireRatePct", min:10, max:18}] },
    { nm:"·精选批次", lvl:22, mods:[{stat:"dmgPct",      min:16, max:28}] },
    { nm:"·长射程",   lvl:4,  mods:[{stat:"range",       min:8,  max:18}] },
    { nm:"·低后坐",   lvl:2,  mods:[{stat:"recoil",      min:8,  max:16}] },
    { nm:"·轻量骨架", lvl:1,  mods:[{stat:"moveSpeed",   min:5,  max:12}] },
    { nm:"·两脚架",   lvl:10, mods:[{stat:"moveSpeed", min:5, max:10},{stat:"accPct", min:5, max:10}] },
    { nm:"·橡胶托底", lvl:11, mods:[{stat:"recoil", min:10, max:20},{stat:"reloadPct", min:8, max:16}] },
    // —— 扩展后缀池（拟真命名）——

    { nm:"·强装药", lvl:1,  mods:[{stat:"dmgPct",      min:6,  max:12}] },
    { nm:"·快速装填", lvl:4,  mods:[{stat:"reloadPct",   min:1,  max:3}] },
    { nm:"·快拆卡榫", lvl:2,  mods:[{stat:"reloadPct",   min:10, max:20}] },
    { nm:"·密位归零", lvl:3,  mods:[{stat:"accPct",      min:6,  max:14}] },
    { nm:"·精密击针", lvl:6,  mods:[{stat:"critChance",  min:3,  max:7}] },
    { nm:"·特种击针", lvl:8,  mods:[{stat:"critChance",  min:6,  max:12}] },
    { nm:"·破片扩散", lvl:9,  mods:[{stat:"splashPct",   min:12, max:24}], needSplash:true },
    { nm:"·加速供弹", lvl:5,  mods:[{stat:"fireRatePct", min:5,  max:10}] },
    { nm:"·精修扳机", lvl:10, mods:[{stat:"critDmg",     min:18, max:34}] },
    { nm:"·扩容弹匣", lvl:7,  mods:[{stat:"magPct",      min:12, max:24}] },
    { nm:"·弹药适配", lvl:9,  mods:[{stat:"elemPct",     min:8,  max:16}], elemOnly:true },
    { nm:"·硬芯弹头", lvl:16, mods:[{stat:"pierce",      min:1,  max:1}] },
    { nm:"·初速增益", lvl:5,  mods:[{stat:"projSpeed",   min:10, max:20}] },
    { nm:"·全被甲", lvl:12, mods:[{stat:"dmgPct", min:8, max:16},{stat:"critChance", min:2, max:5}] },
    { nm:"·并联供弹", lvl:11, mods:[{stat:"reloadPct", min:12, max:22},{stat:"magPct", min:8, max:16}] },
    { nm:"·加重弹头", lvl:13, mods:[{stat:"dmgPct", min:12, max:20},{stat:"fireRatePct", min:-8, max:-4}] },
    { nm:"·轻量枪机", lvl:14, mods:[{stat:"fireRatePct", min:10, max:18}] },
    { nm:"·特种弹配方", lvl:15, mods:[{stat:"elemPct", min:10, max:18},{stat:"critChance", min:6, max:12}], elemOnly:true },
    { nm:"·校验批次", lvl:22, mods:[{stat:"dmgPct",      min:16, max:28}] },
    // —— 扩展词缀（后缀）——
    { nm:"·长射程基线", lvl:4,  mods:[{stat:"range",       min:8,  max:18}] },
    { nm:"·缓冲垫", lvl:6,  mods:[{stat:"recoil", min:3,  max:8}] },
    { nm:"·扩容卡榫", lvl:3,  mods:[{stat:"magPct",     min:6,  max:14}] },
    { nm:"·后坐缓冲", lvl:2,  mods:[{stat:"recoil",      min:8,  max:16}] },
    { nm:"·轻量化", lvl:1,  mods:[{stat:"moveSpeed",   min:5,  max:12}] },
    { nm:"·预制破片", lvl:8,  mods:[{stat:"splashDmg",   min:12, max:24}] },
    { nm:"·稳定握把", lvl:10, mods:[{stat:"moveSpeed", min:5, max:10},{stat:"accPct", min:5, max:10}] },
    { nm:"·缓冲托底", lvl:11, mods:[{stat:"recoil", min:10, max:20},{stat:"reloadPct", min:8, max:16}] },
    // —— v0.14.10 扩充①：元素专属后缀（与前缀的元素组呼应）——
    { nm:"·曳光剂", lvl:12, elem:"fire",      mods:[{stat:"elemPct",min:12,max:22},{stat:"critChance",min:6,max:12}] },
    { nm:"·钢芯弹链", lvl:12, elem:"shock",     mods:[{stat:"critChance",min:10,max:18},{stat:"fireRatePct",min:6,max:12}] },
    { nm:"·软尖弹", lvl:14, elem:"corrosive", mods:[{stat:"elemPct",min:12,max:22},{stat:"pierce",min:1,max:1}] },
    { nm:"·消音套筒", lvl:12, elem:"cryo",      mods:[{stat:"critChance",min:10,max:18},{stat:"moveSpeed",min:6,max:12}] },
    { nm:"·破片装药", lvl:16, elem:"explosive", needSplash:true, mods:[{stat:"splashDmg",min:18,max:32}] },
    { nm:"·穿甲曳光", lvl:16, elem:"radiation", mods:[{stat:"elemPct",min:10,max:18},{stat:"dmgPct",min:6,max:12}] },
    // —— v0.14.10 扩充②：代价权衡后缀 ——
    { nm:"·高压装药", lvl:18, mods:[{stat:"dmgPct",min:20,max:34},{stat:"reloadPct",min:-4,max:-2}] },
    { nm:"·加速枪机", lvl:16, mods:[{stat:"fireRatePct",min:18,max:30},{stat:"reloadPct",min:-18,max:-10}] },
    { nm:"·亚音速配重", lvl:14, mods:[{stat:"dmgPct",min:18,max:30},{stat:"projSpeed",min:-20,max:-12}] },
    { nm:"·竞赛扳机", lvl:20, mods:[{stat:"critChance",min:8,max:14},{stat:"accPct",min:-14,max:-8}] },
    { nm:"·精修击针", lvl:22, mods:[{stat:"critDmg",min:40,max:70},{stat:"magPct",min:-20,max:-12}] },
    { nm:"·制退器", lvl:18, mods:[{stat:"recoil",min:8,max:14},{stat:"reloadPct",min:-14,max:-8}] },
    // —— v0.14.10 扩充③：后期档位（ilvl 24+）——
    { nm:"·远程分划", lvl:24, mods:[{stat:"range",min:20,max:34},{stat:"projSpeed",min:14,max:26}] },
    { nm:"·弹道适配", lvl:26, elemOnly:true, mods:[{stat:"elemPct",min:18,max:30},{stat:"critChance",min:8,max:16}] },
    { nm:"·钨芯穿甲", lvl:28, mods:[{stat:"pierce",min:2,max:2},{stat:"dmgPct",min:-14,max:-8}] },
    { nm:"·竞赛级装配", lvl:30, mods:[{stat:"dmgPct",min:22,max:38},{stat:"critDmg",min:30,max:55}] },
    { nm:"·大容量弹鼓", lvl:32, mods:[{stat:"magPct",min:16,max:28},{stat:"magPct",min:12,max:22}] },
    { nm:"·出厂校验", lvl:36, mods:[{stat:"dmgPct",min:30,max:48},{stat:"fireRatePct",min:12,max:20},{stat:"accPct",min:-12,max:-6}] },  ],
};

// 顶级品级专属的「出厂精调」词条（原「出厂精调威能」）
const POWERS = [
  { nm:"出厂精调 · 膛压", mods:[{stat:"dmgPct",     min:25, max:45}] },
  { nm:"出厂精调 · 扳机", mods:[{stat:"critDmg",    min:60, max:110}] },
  { nm:"出厂精调 · 枪机", mods:[{stat:"fireRatePct",min:20, max:35}] },
  { nm:"出厂精调 · 弹匣", mods:[{stat:"magPct",     min:40, max:80}] },
  { nm:"出厂精调 · 瞄具", mods:[{stat:"critChance", min:8,  max:16}] },
  { nm:"出厂精调 · 穿深", mods:[{stat:"pierce",     min:2,  max:2}] },
];

/* ----------------------------- 改装等级（原「改装等级」） -----------------------------
 * 不再有「改装」概念，改为可解释的「改装等级」——
 * 高等级代表更高膛压装药与更精密的配件公差，收益按线性工程余量给，
 * 不再使用 1.18^m 的指数膨胀（5 级 ×2.29 倍伤害不拟真）。
 *   gearPower 1.12 → 1.05、corePower 1.18 → 1.06（5 级由 ×2.29 降为 ×1.34）。
 */
const MAYHEM = {
  hpMul: 1.40,         // 敌方生命 / 级
  dmgMul: 1.15,        // 敌方伤害 / 级
  xpAdd: 0.15,         // 经验加成 / 级
  lootAdd: 0.25,       // 战利品 / 级
  lvlStep: 0.5,
  lvlBase: 1,
  gearPower: 1.05,
  corePower: 1.06,
  capBase: 1,
  capPerRebirth: 1,
  capBuyStep: 5,
  capBuyBase: 20,
  capBuyPer: 5,
};
// 改装装备的等级抽取：m ∈ [0,n]
function rollGearMayhem(n){
  if(n<=0) return 0;
  let tot=0; const cw=[];
  for(let k=0;k<=n;k++){ const w = k>=n ? 1 : Math.pow(2, n-1-k); cw.push(w); tot+=w; }
  let r=RNG.f()*tot;
  for(let k=0;k<=n;k++){ r-=cw[k]; if(r<=0) return k; }
  return 0;
}

/* ----------------------------- 重新部署（保留内部机制，文案拟真化） ----------------------------- */
/* 功勋 = 等级 + 装备评分 + 改装等级，整体 ×0.5；只用于永久训练与改装上限。 */
const PERM_UPGRADES = [
  { id:"hp",   name:"体格训练", stat:"生命上限", base:5,  grow:1.9, per:2,  unit:"% 生命" },
  { id:"dmg",  name:"射击训练", stat:"全部伤害", base:7,  grow:2.0, per:2,  unit:"% 伤害" },
  { id:"mf",   name:"搜集训练", stat:"搜集效率", base:9,  grow:2.1, per:3,  unit:" 点 搜集" },
  { id:"gf",   name:"交易关系", stat:"现金获取", base:7,  grow:2.0, per:4,  unit:"% 现金" },
  { id:"soul", name:"战地履历", stat:"功勋收益", base:22, grow:2.5, per:10, unit:"% 功勋" },
  { id:"drop", name:"战利品直觉", stat:"装备掉率", base:26, grow:2.7, per:2,  unit:"% 掉率" },
];
const PRESTIGE = {
  gearDiv: 8000,
  base: 0.5,
  mayhemSoul: 4,
  keepGold: 500,
  minLevel: 5,
};

/* ----------------------------- 商店 ----------------------------- */
const SHOPS = {
  marcus: {
    id:"marcus", name:"军械补给站", icon:"▮", tag:"制式军械商",
    desc:"登记在册的渠道，货真价实，也只卖登记在册的东西。",
    slots:5, refreshBase:300, refreshLv:220, priceMul:1.15,
    weights:{ white:5, green:8, blue:6, purple:2.2, orange:0.5, pearl:0.28, ancient:0.12 },
    ilvlBonus:5,
  },
  black: {
    id:"black", name:"地下军械商", icon:"◐", tag:"不开发票",
    desc:"好东西都在这儿，价格嘛……只收美元，不谈现金。",
    slots:3, refreshBase:600, refreshLv:420, priceMul:1.45,
    currency:"eridium",
    weights:{ blue:3, purple:3.2, orange:1.1, pearl:0.7, ancient:0.35, rainbow:0.06, mythic:0.022 },
    ilvlBonus:11,
  },
  gamble: {
    id:"gamble", name:"黑市赌博机", icon:"✦", tag:"盲盒 · 仅此处出特供/珍藏/孤品",
    desc:"黑市地下的封存赌博机：投入金币开箱，只有这里能开出【特供 / 珍藏 / 孤品】三档神兵——其余所有掉落与商店都不再出产。",
    basePrice:4, lvPrice:2,
    // v0.21.8：最高三档（特供/珍藏/孤品）的唯一产出表；其余渠道权重已归零
    weights:{ white:6, green:7, blue:5, purple:2.0, orange:0.6, pearl:0.35, ancient:0.16, rainbow:0.05, mythic:0.03, primordial:0.012, celestial:0.005, singularity:0.0018 },
  },
};

/* ----------------------------- 掉落 ----------------------------- */
const DROP = {
  itemChanceBase:0.075,
  itemChancePerLv:0.0012,
  miniBonus:0.62,
  bossBonus:1.8,
  bossCount:[4,6],
  miniCount:[1,2],
  goldBase:6, goldPerLv:5, goldSpread:6,
  goldBoss:12, goldMini:2.5,
  potion:0.10, ammo:0.32,
  // 搜集效率对高品级权重的加成分母
  mfDiv:{ green:200, blue:180, purple:180, orange:150, pearl:150, ancient:120, rainbow:100, mythic:90, primordial:75, celestial:60, singularity:50 },
};

/* ----------------------------- 兵工厂（原虚构厂商） -----------------------------
 * 改用现实军工体系命名。内部 key 保留以兼容旧存档中的 manufacturer 字段。
 * throwable / homing / laser 全部关闭：只保留实体弹丸与真实弹道。
 * elemChance 语义改为「特种弹适配率」（对弹种加成的适配倾向），不再产生制式效果。
 */
const MANUFACTURERS = {
  Jakobs:  { name:"图拉兵工厂", color:"#8a6a4a", dmg:1.30, fireRate:0.82, accuracy:1.20, mag:0.8,  reload:1.05, crit:1.6, elemChance:0,    style:"高初速 · 栓动 · 精密", throwable:false },
  Maliwan: { name:"伊热夫斯克", color:"#5d7885", dmg:0.95, fireRate:0.85, accuracy:1.15, mag:0.9,  reload:1.1,  crit:1.0, elemChance:0,    style:"冷锻枪管 · 高精度",   throwable:false },
  Tediore: { name:"莫洛特工厂", color:"#6b7452", dmg:0.95, fireRate:1.05, accuracy:0.95, mag:1.0,  reload:0.55, crit:1.0, elemChance:0,    style:"快拆弹匣 · 短换弹",   throwable:false },
  Vladof:  { name:"卡拉什尼科夫", color:"#9a5a3a", dmg:0.95, fireRate:1.35, accuracy:0.9,  mag:1.3,  reload:1.0,  crit:1.0, elemChance:0,    style:"高射速 · 大容量",     throwable:false },
  Hyperion:{ name:"赫克勒-科赫", color:"#4a5158", dmg:1.0,  fireRate:0.95, accuracy:1.35, mag:0.95, reload:1.05, crit:1.1, elemChance:0,    style:"滚柱闭锁 · 稳定连发", throwable:false },
  Torgue:  { name:"捷格加廖夫厂", color:"#85704c", dmg:1.1,  fireRate:0.8,  accuracy:0.95, mag:0.7,  reload:1.2,  crit:1.0, elemChance:0,    style:"重弹头 · 大口径",     throwable:false, forceExplosive:false },
  Dahl:    { name:"FN 赫斯塔尔", color:"#4e6350", dmg:1.0,  fireRate:1.05, accuracy:1.05, mag:1.05, reload:1.0,  crit:1.05,elemChance:0,    style:"导气式 · 均衡",       throwable:false },
  Atlas:   { name:"西格绍尔",   color:"#455873", dmg:1.02, fireRate:1.0,  accuracy:1.1,  mag:1.0,  reload:1.0,  crit:1.1, elemChance:0,    style:"模块化 · 通用件",     throwable:false, homing:false },
};

/* ----------------------------- 枪型 ----------------------------- */
// 具名池全部改为现实枪械型号
const WEAPON_TYPES = {
  pistol:  { name:"手枪",   baseDmg:11, fireRate:3.2, accuracy:0.92, mag:12, reload:1.1, speed:760, pellets:1, ammoType:"pistol",  spread:0.05, auto:false,
             named:["PM","GSh-18","MP-443 Grach","PB","PL-15","Glock 17"],
             /* v0.21.6：型号池 —— 「完整显示」下每条枪都有自己的真实型号，
              * 不再所有手枪都叫「手枪」。精简模式只显示型号，完整模式再叠厂商 / 前后缀 / 品质。 */
             models:["PM","PB","TT","MP-443 Grach","GSh-18","PL-15","P226R","M1911A1","Glock 17","Glock 19",
                     "PX4 Storm","Five-seveN","USP .45","APS Stechkin","RSh-12","Desert Eagle"] },
  smg:     { name:"冲锋枪", baseDmg:6,  fireRate:11,  accuracy:0.82, mag:30, reload:1.5, speed:720, pellets:1, ammoType:"smg",     spread:0.10, auto:true,
             named:["PP-19-01 Vityaz","MP5","MP7A1","PP-9 Klin","PPSh-41","FN P90"],
             models:["PP-91 Kedr","PP-9 Klin","PP-19-01 Vityaz","PP-19 Bizon","PPSh-41","MP5","MP5SD","MP7A1",
                     "UMP .45","FN P90","SIG MPX","Vector .45","UZI","MAC-10","Scorpion EVO 3","PP-90M1"] },
  shotgun: { name:"霰弹枪", baseDmg:7,  fireRate:1.8, accuracy:0.65, mag:6,  reload:2.2, speed:680, pellets:8, ammoType:"shotgun", spread:0.22, auto:false,
             named:["Saiga-12","TOZ-106","MP-153","MP-155","M870","KS-23M"],
             models:["MP-133","MP-153","MP-155","TOZ-106","TOZ-34","KS-23M","M870","M590A1","Saiga-12",
                     "Vepr-12","S12K","Benelli M4","SPAS-12","Remington 11-87"] },
  rifle:   { name:"步枪", baseDmg:16, fireRate:6.0, accuracy:0.9,  mag:24, reload:1.8, speed:820, pellets:1, ammoType:"rifle",   spread:0.06, auto:true,
             named:["AK-74N","AK-103","AKM","M4A1","HK 416A5","ADAR 2-15"],
             models:["AK-74N","AK-74M","AKM","AK-103","AK-105","AK-12","AK-15","M4A1","M16A4","HK 416A5",
                     "HK G36","SCAR-L","SCAR-H","SIG SG550","FN FAL","ADAR 2-15","SKS","VPO-136","AS VAL","SR-3M"] },
  sniper:  { name:"狙击枪", baseDmg:55, fireRate:1.1, accuracy:0.99, mag:5,  reload:2.0, speed:1100,pellets:1, ammoType:"sniper",  spread:0.01, auto:false, charge:true,
             named:["SVD-S","SV-98","VSS Vintorez","M700","DVL-10","ORSIS T-5000"],
             models:["SVD-S","SVDS","SV-98","VSS Vintorez","M700","M24","DVL-10","ORSIS T-5000","TRG-42",
                     "AWM","M82A1","RSASS","M1A","Sako TRG","SVCh"] },
  launcher:{ name:"榴弹发射器", baseDmg:70, fireRate:0.9, accuracy:0.88, mag:4,  reload:2.6, speed:300, pellets:1, ammoType:"launcher",spread:0.04, auto:false, splash:120,
             named:["GP-25 Kostyor","GP-34","GM-94","RGM-40 Kastet","M203","GP-25"],
             models:["GP-25 Kostyor","GP-34","GM-94","RGM-40 Kastet","M203","M320 GLM","Milkor MGL","RG-6","Hawk MM-1"] },
};

/* ----------------------------- Scav 低阶武器池 -----------------------------
 * 塔科夫 Scav 是拾荒者，不是 PMC：只配发廉价、老旧、短射程的枪械。
 * 这里单独建池，避免他们从战利品 / 玩家装备强度里拿到高穿透弹和高阶枪。
 * 全部型号均为塔科夫实装名称；Scav 不会使用步枪 / 狙击枪 / 榴弹发射器。
 */
const SCAV_GUN_TYPES = ["pistol","shotgun","smg"];
const SCAV_GUN_MODELS = {
  pistol:  ["PM","PB","MP-443 Grach","GSh-18","TT"],
  shotgun: ["MP-133","TOZ-106","M870","MP-153","KS-23M"],
  smg:     ["PP-91 Kedr","PP-9 Klin","PP-19-01 Vityaz","MP5"],
};
// Scav 弹药：PS / T / RIP 一类低穿深弹，绝不出现 BP / BT / SP-6。
const SCAV_AMMO = ["none","none","none","fire","corrosive"];
const SCAV_GUN_ILVL_MAX = 8;   // 枪械等级硬上限：再肥的 Scav 也只能拿低阶枪
const SCAV_ARMOR_TIER_MAX = 3; // 护甲等级上限（塔科夫 Scav 极少出 4 级甲）
const SCAV_HELMET_TIER_MAX = 2;

/* ----------------------------- PMC ----------------------------- */
// 移除「侦察兵 / 标记法师 / 掩护火力 / 突入 / 压制」等超能力设定，改为现实PMC分工
const CLASSES = {
  siren: {
    id:"siren", name:"侦察手", en:"Scout", color:"#9a86b5",
    tag:"前沿观察", desc:"观察与标记目标，优先获取交战信息。",
    hp:90, shield:70, speed:235, dmgMul:1.0, elemMul:1.5, ability:{name:"目标标记", cd:14, type:"phaselock"},
  },
  soldier: {
    id:"soldier", name:"突击手", en:"Assault", color:"#5b86ad",
    tag:"火力掩护", desc:"依托掩体压制火线，防护与持续输出均衡。",
    hp:120, shield:60, speed:220, dmgMul:1.1, elemMul:1.0, ability:{name:"掩护火力", cd:16, type:"turret"},
  },
  psycho: {
    id:"psycho", name:"破门手", en:"Breacher", color:"#a35c4c",
    tag:"近距离突入", desc:"高机动近距离交战，擅长快速清房。",
    hp:140, shield:30, speed:250, dmgMul:1.2, elemMul:0.9, ability:{name:"突入冲刺", cd:18, type:"bloodlust"},
  },
  gunner: {
    id:"gunner", name:"机枪手", en:"Gunner", color:"#a5794a",
    tag:"火力压制", desc:"携行量大、防护厚，负责持续压制。",
    hp:160, shield:50, speed:205, dmgMul:1.05, elemMul:1.0, ability:{name:"持续压制", cd:15, type:"overload"},
  },
};

/* =========================================================================
 * 防弹插板 / 随身装备
 * 「护甲」在显示层一律称为防弹插板／护甲，不再描述为能量立场；
 * 自动整备机制属隐藏的旧模式，塔科夫模式使用 raid.js 的护甲耐久系统。
 * effect 概率全部置 0 —— 不再产生冲击波 / 荆棘反伤 / 虹吸等超现实特效。
 * ========================================================================= */
const SHIELD_RARITY = {
  white:  { cap:0.90, delay:4.8, rech:6.2, effect:0 },
  green:  { cap:1.00, delay:4.3, rech:5.6, effect:0 },
  blue:   { cap:1.16, delay:3.9, rech:5.0, effect:0 },
  purple: { cap:1.37, delay:3.3, rech:4.2, effect:0 },
  orange: { cap:1.78, delay:2.7, rech:3.5, effect:0 },
  pearl:  { cap:1.86, delay:2.5, rech:3.2, effect:0 },
  ancient:{ cap:2.15, delay:2.1, rech:2.8, effect:0 },
  rainbow:{ cap:2.45, delay:1.8, rech:2.4, effect:0 },
  mythic:     { cap:2.85, delay:1.6, rech:2.0, effect:0 },
  primordial: { cap:3.25, delay:1.4, rech:1.8, effect:0 },
  celestial:  { cap:3.75, delay:1.2, rech:1.6, effect:0 },
  singularity: { cap:4.40, delay:1.0, rech:1.4, effect:0 },
};

const SHIELD_EFFECTS = {
  nova:   { id:"nova",   name:"缓冲内衬", color:"#c2a05a", desc:"插板受冲击时的缓冲层，降低瞬时冲击" },
  amp:    { id:"amp",    name:"贴合剪裁", color:"#9fb0bd", desc:"完整贴合时防护效果更好" },
  thorns: { id:"thorns", name:"硬质面板", color:"#8fae72", desc:"高硬度面板，降低穿透伤害" },
  reboot: { id:"reboot", name:"快拆扣具", color:"#7fa2b8", desc:"可快速更换插板" },
  vamp:   { id:"vamp",   name:"衬垫层",   color:"#b06a62", desc:"软质衬垫，减轻钝性冲击" },
};

const SHIELD_NAMES = {
  white:  ["旧式软质内衬","备用插板","民版防护背心"],
  green:  ["翻新插板","标准内衬","II 级软甲"],
  blue:   ["制式插板","钢制面板","III 级软甲"],
  purple: ["陶瓷复合插板","加压层压板","军规防护板"],
  orange: ["重型陶瓷插板","突击型护甲板","IV 级插板"],
  pearl:  ["模块化插板","轻量复合板"],
  ancient:["试验型插板","复合装甲板"],
  rainbow:["原型插板","多层复合板"],
  mythic:     ["定制插板","精密复合板"],
  primordial: ["竞赛级护具","高规格层压板"],
  celestial:  ["收藏级防护组件","特种复合板"],
  singularity:["出厂封存插板","全新 IV+ 插板"],
};

// 随身装备词条池：全部改为现实属性
const RELIC_MODS = [
  { stat:"dmgPct",     label:"枪口动能",   min:4,  max:9,  scale:0.05 },
  { stat:"fireRatePct",label:"理论射速",   min:3,  max:8,  scale:0.04 },
  { stat:"critChance", label:"要害命中",   min:2,  max:5,  scale:0.03 },
  { stat:"critDmg",    label:"要害伤害",   min:8,  max:18, scale:0.05 },
  { stat:"moveSpeed",  label:"机动性",     min:3,  max:7,  scale:0.02 },
  { stat:"magPct",     label:"弹匣容量",   min:4,  max:10, scale:0.04 },
  { stat:"reloadPct",  label:"换弹速度",   min:4,  max:10, scale:0.04 },
  { stat:"elemPct",    label:"弹药效能",   min:5,  max:12, scale:0.05 },
  { stat:"lifesteal",  label:"急救效率",   min:1,  max:3,  scale:0.02 },
  { stat:"goldPct",    label:"交易收益",   min:5,  max:14, scale:0.03 },
  { stat:"mfFlat",     label:"搜集效率",   min:4,  max:10, scale:0.15 },
  { stat:"xpPct",      label:"经验获取",   min:4,  max:10, scale:0.03 },
  { stat:"shieldPct",  label:"护甲容量",   min:6,  max:14, scale:0.05 },
  { stat:"shieldDelay",label:"整备时间缩短",min:0.2,max:0.5,scale:0.004 },
  { stat:"abilityCD",  label:"战术动作冷却",min:4, max:9,  scale:0.02 },
];

const RELIC_NAMES = {
  white:  ["旧识别牌","磨损臂章"],
  green:  ["PMC 臂章","野战标尺"],
  blue:   ["测距卡","弹道计算尺"],
  purple: ["战术手册","急救记录本"],
  orange: ["军械库通行证","射击考核徽章"],
  pearl:  ["静音通讯耳塞","夜视电池组"],
  ancient:["试验型瞄具校验证","低温润滑脂"],
  rainbow:["多层复合垫片","高规格扳机组"],
  mythic:     ["定制枪托贴腮板","精密轴承组"],
  primordial: ["竞赛级扳机组件","高规格导气件"],
  celestial:  ["收藏级枪号铭牌","特种工具组"],
  singularity:["出厂封存工具组","整套校验规"],
};

// 掉落权重：武器为主，插板次之，随身装备最少
const ITEM_DROP = { weapon:0.72, shield:0.20, relic:0.08 };

/* 美元（地下军械商货币） */
const ERIDIUM = {
  mini: 2,
  boss: 14,
  eliteChance:0.18,
  eliteAmount:1,
  sellPurple:2, sellOrange:4, sellPearl:4, sellAncient:6, sellRainbow:9,
  chest:1,
};

/* =========================================================================
 * 沙二模式 — 5v5 爆破，CS2 竞技规则
 * 真实武器表：dmg 单发伤害 / ap 护甲穿透 / rpm 射速 / spread 散布 / mag 弹匣
 * ========================================================================= */
const CS2 = {
  freezeTime: 5,         // 购买/冻结时间（每回合开局可移动前的等待）
  roundTime: 115,        // 单回合时长
  bombTime: 40,          // C4 倒计时
  plantTime: 3.2,        // 下包耗时
  defuseTime: 10,        // 拆包（无钳）
  defuseKitTime: 5,      // 拆包（有钳）
  startMoney: 800,
  maxMoney: 16000,
  winElim: 3250,         // 团灭 / 时间耗尽
  winExplode: 3500,      // 炸弹爆炸（T）
  winDefuse: 3500,       // 拆包成功（CT）
  lossBonus: [1400, 1900, 2400, 2900, 3400],
  plantReward: 300,
  defuseReward: 300,
  roundsToWin: 13,
  halftime: 12,
  maxRounds: 24,
  botCount: 5,
  dmgMul: 0.7,          // 沙二模式枪械伤害系数（整体下调）

  weapons: {
    // ---- 手枪 ---- （散布 ×1.4）
    glock:     { id:"glock",     name:"Glock-18",  cat:"pistol", price:200,  dmg:30, ap:0.47, rpm:400, spread:0.08,  mag:20, reload:2.2, kill:300, auto:false, side:"t" },
    usp:       { id:"usp",       name:"USP-S",     cat:"pistol", price:200,  dmg:35, ap:0.505,rpm:352, spread:0.075, mag:12, reload:2.2, kill:300, auto:false, side:"ct" },
    p250:      { id:"p250",      name:"P250",      cat:"pistol", price:300,  dmg:38, ap:0.605,rpm:400, spread:0.085, mag:13, reload:2.2, kill:300, auto:false },
    tec9:      { id:"tec9",      name:"Tec-9",     cat:"pistol", price:500,  dmg:33, ap:0.90, rpm:500, spread:0.10,  mag:18, reload:2.2, kill:300, auto:false, side:"t" },
    fiveseven: { id:"fiveseven", name:"Five-SeveN",cat:"pistol", price:500,  dmg:32, ap:0.912,rpm:400, spread:0.085, mag:20, reload:2.2, kill:300, auto:false, side:"ct" },
    deagle:    { id:"deagle",    name:"沙漠之鹰",   cat:"pistol", price:700,  dmg:63, ap:0.93, rpm:267, spread:0.065, mag:7,  reload:2.2, kill:300, auto:false },
    // ---- 微冲 ---- （散布大幅上调 ×2.2～2.4，冲锋枪最飘）
    mac10:     { id:"mac10",     name:"MAC-10",    cat:"smg",    price:1050, dmg:29, ap:0.675,rpm:800, spread:0.20,  mag:30, reload:2.6, kill:600, auto:true, side:"t" },
    mp9:       { id:"mp9",       name:"MP9",       cat:"smg",    price:1250, dmg:26, ap:0.69, rpm:857, spread:0.18,  mag:30, reload:2.1, kill:600, auto:true, side:"ct" },
    mp7:       { id:"mp7",       name:"MP7",       cat:"smg",    price:1500, dmg:25, ap:0.66, rpm:750, spread:0.18,  mag:30, reload:3.1, kill:600, auto:true },
    mp5sd:     { id:"mp5sd",     name:"MP5-SD",    cat:"smg",    price:1500, dmg:27, ap:0.675,rpm:750, spread:0.17,  mag:30, reload:2.7, kill:600, auto:true },
    ump45:     { id:"ump45",     name:"UMP-45",    cat:"smg",    price:1200, dmg:35, ap:0.65, rpm:666, spread:0.22,  mag:25, reload:3.5, kill:600, auto:true },
    p90:       { id:"p90",       name:"P90",       cat:"smg",    price:2350, dmg:26, ap:0.69, rpm:857, spread:0.19,  mag:50, reload:3.4, kill:300, auto:true },
    // ---- 霰弹 ---- （散布 ×1.3）
    nova:      { id:"nova",      name:"Nova",      cat:"shotgun",price:1050, dmg:24, ap:0.50, rpm:68,  spread:0.21,  mag:8,  reload:3.3, kill:900, auto:false, pellets:9 },
    xm1014:    { id:"xm1014",    name:"XM1014",    cat:"shotgun",price:2000, dmg:22, ap:0.50, rpm:171, spread:0.20,  mag:7,  reload:3.6, kill:900, auto:true,  pellets:6 },
    mag7:      { id:"mag7",      name:"MAG-7",     cat:"shotgun",price:1300, dmg:32, ap:0.50, rpm:85,  spread:0.18,  mag:5,  reload:2.7, kill:900, auto:false, pellets:8, side:"ct" },
    sawedoff:  { id:"sawedoff",  name:"Sawed-Off", cat:"shotgun",price:1100, dmg:30, ap:0.50, rpm:85,  spread:0.22,  mag:7,  reload:2.6, kill:900, auto:false, pellets:9, side:"t" },
    // ---- 步枪 ---- （散布 ×1.5）
    galil:     { id:"galil",     name:"Galil AR",  cat:"rifle",  price:1800, dmg:30, ap:0.775,rpm:666, spread:0.085, mag:35, reload:3.0, kill:300, auto:true, side:"t" },
    famas:     { id:"famas",     name:"FAMAS",     cat:"rifle",  price:2050, dmg:30, ap:0.70, rpm:666, spread:0.085, mag:25, reload:3.3, kill:300, auto:true, side:"ct" },
    ak:        { id:"ak",        name:"AK-47",     cat:"rifle",  price:2700, dmg:36, ap:0.775,rpm:600, spread:0.08,  mag:30, reload:2.5, kill:300, auto:true, side:"t" },
    m4a4:      { id:"m4a4",      name:"M4A4",      cat:"rifle",  price:3000, dmg:33, ap:0.70, rpm:666, spread:0.075, mag:30, reload:3.1, kill:300, auto:true, side:"ct" },
    m4a1s:     { id:"m4a1s",     name:"M4A1-S",    cat:"rifle",  price:2900, dmg:38, ap:0.705,rpm:600, spread:0.065, mag:20, reload:3.1, kill:300, auto:true, side:"ct" },
    sg553:     { id:"sg553",     name:"SG 553",    cat:"rifle",  price:3000, dmg:30, ap:1.00, rpm:545, spread:0.08,  mag:30, reload:2.8, kill:300, auto:true, side:"t" },
    aug:       { id:"aug",       name:"AUG",       cat:"rifle",  price:3300, dmg:28, ap:0.90, rpm:666, spread:0.07,  mag:30, reload:3.8, kill:300, auto:true, side:"ct" },
    // ---- 狙击 ---- （精密武器，散布轻微上调）
    scout:     { id:"scout",     name:"SSG 08",    cat:"sniper", price:1700, dmg:88, ap:0.90, rpm:48,  spread:0.016, mag:10, reload:3.7, kill:300, auto:false },
    awp:       { id:"awp",       name:"AWP",       cat:"sniper", price:4750, dmg:115,ap:0.975,rpm:41,  spread:0.011, mag:10, reload:3.7, kill:100, auto:false },
  },
  gear: {
    kevlar:    { id:"kevlar",   name:"防弹衣",        cat:"gear", price:650,  armor:100, helmet:false },
    kevlarhelm:{ id:"kevlarhelm",name:"防弹衣 + 头盔", cat:"gear", price:1000, armor:100, helmet:true },
    kit:       { id:"kit",      name:"拆弹工具",      cat:"gear", price:400,  kit:true, side:"ct" },
  },
  nades: {
    he:     { id:"he",     name:"高爆手雷", cat:"nade", price:300, dmg:57, radius:150 },
    flash:  { id:"flash",  name:"闪光弹",   cat:"nade", price:200, dmg:0,  radius:0 },
    smoke:  { id:"smoke",  name:"烟雾弹",   cat:"nade", price:300, dmg:0,  radius:0 },
    molly:  { id:"molly",  name:"燃烧瓶",   cat:"nade", price:600, dmg:13, radius:120 },
  },
  // 购买菜单分类（对齐 CS2 五列布局）
  buyTabs: [
    { id:"gear",  name:"装备",    en:"Equipment" },
    { id:"pistol",name:"手枪",    en:"Pistols" },
    { id:"smg",   name:"中档",    en:"Mid-Tier" },
    { id:"rifle", name:"步枪",    en:"Rifles" },
    { id:"nade",  name:"手雷",    en:"Grenades" },
  ],
  buyTabsBL: [
    { id:"pistol", name:"手枪",       en:"Pistols" },
    { id:"smg",    name:"中档",       en:"Mid-Tier" },
    { id:"rifle",  name:"步枪",       en:"Rifles" },
    { id:"nade",   name:"手雷",       en:"Grenades" },
    { id:"blgear", name:"护甲 / 配件", en:"Armor & Parts" },
  ],
};

/* 无尽模式：每波指数增强，5 波一个首领 */
const ENDLESS = {
  waveTime: 26,
  hpPerWave: 0.28,
  dmgPerWave: 0.10,
  countBase: 6,
  countPerWave: 1.1,
  maxConcurrent: 13,
  bossEvery: 5,
  xpPerWave: 0.22,
  lootPerWave: 0.18,
  eriPerBoss: 8,
};
