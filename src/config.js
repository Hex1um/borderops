/* =========================================================================
 * config.js — 全局常量与平衡数值
 * 边境行动：弹药 / 枪械成色 / 配件词缀 / 枪型 / 干员 定义
 * v0.15.0：移除全部超现实与制式词条，改为拟真军械体系。
 *   内部键名（element / mayhem / elemPct 等）一律保留，仅语义与显示改名，
 *   保证旧 localStorage 存档、联机快照与拍卖行数据可直接读取。
 * ========================================================================= */

const CFG = {
  version: "0.15.1",
  name: "边境行动",
  en: "BORDER OPS",
  // 界面开关（其他模式代码仍保留，只是不显示入口）
  onlyRaid: true,        // 只显示塔科夫模式
  raidMinimap: false,    // 塔科夫 HUD 小地图
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

/* ----------------------------- 弹种（原「弹种」） -----------------------------
 * 全部为现实弹药：以「穿透等级 pen」与对软目标 / 护甲的终点效应区分，
 * 没有持续伤害、没有状态异常、没有连锁引爆。dot 恒为 0，保留字段仅为兼容旧伤害管线。
 * mult.flesh / .shield / .armor = 对无防护 / 软质护甲 / 硬质插板的终点效应系数。
 */
const AMMO_TYPES = {
  none:      { id:"none",      name:"FMJ 全被甲弹", short:"FMJ", color:"#cfcabb", pen:12, dot:0, mult:{flesh:1.00,shield:0.95,armor:0.80}, desc:"铅芯全被甲，穿深低，对软目标停止作用一般" },
  fire:      { id:"fire",      name:"T 曳光弹",     short:"T",   color:"#d97a3c", pen:14, dot:0, mult:{flesh:1.05,shield:0.95,armor:0.82}, desc:"弹尾曳光剂，便于观察弹道，无额外杀伤" },
  shock:     { id:"shock",     name:"AP 钢芯穿甲弹",short:"AP",  color:"#9fb0bd", pen:36, dot:0, mult:{flesh:0.90,shield:1.10,armor:1.45}, desc:"淬火钢芯，对硬质插板穿深高，空腔效应小" },
  corrosive: { id:"corrosive", name:"HP 空尖弹",    short:"HP",  color:"#8fae72", pen:5,  dot:0, mult:{flesh:1.55,shield:1.10,armor:0.42}, desc:"扩张弹头，对无防护目标停止作用强，几乎打不穿护甲" },
  cryo:      { id:"cryo",      name:"US 亚音速弹",  short:"US",  color:"#7fa2b8", pen:11, dot:0, mult:{flesh:1.00,shield:0.95,armor:0.78}, desc:"配重亚音速弹头，配合消音器，枪声传播距离短" },
  explosive: { id:"explosive", name:"HE 破片弹",    short:"HE",  color:"#c2a05a", pen:6,  dot:0, mult:{flesh:1.30,shield:1.15,armor:0.95}, desc:"仅榴弹发射器使用的破片战斗部，溅射半径有限" },
  radiation: { id:"radiation", name:"BT 穿甲曳光弹",short:"BT",  color:"#b6b073", pen:30, dot:0, mult:{flesh:1.05,shield:1.05,armor:1.30}, desc:"钢芯 + 曳光剂，兼顾穿深与弹道观察" },
};
// v0.15.0：ELEMENTS 作为兼容别名保留 —— 21 个脚本与旧存档仍按 element 字段读写，
// 但玩家看到的名称、颜色、描述全部来自 AMMO_TYPES。新代码请优先使用 AMMO_TYPES。
const ELEMENTS = AMMO_TYPES;

/* ----------------------------- 枪械成色 / 品级 ----------------------------- */
/*
 * 12 档品级，权重极度偏斜（民用 : 出厂封存 ≈ 1000 : 1）。
 * 低档靠「改装词条数量」，高档靠「工艺倍率」补偿。
 * affixes:[最少,最多] / mult:全局数值倍率 / price:物价倍率
 * v0.15.0：名称与颜色改为军工品相刻度，不再使用奇幻稀有度配色。
 */
const RARITIES = [
  { id:"white",   name:"民用",     color:"#cfc9bb", weight:40,    mult:1.00, affixes:[0,0], minLv:1,  price:1   },
  { id:"green",   name:"翻新",     color:"#93ad7c", weight:30,    mult:1.00, affixes:[1,2], minLv:1,  price:2.2 },
  { id:"blue",    name:"制式",     color:"#7b9ab5", weight:12,    mult:1.00, affixes:[2,4], minLv:2,  price:5.5 },
  { id:"purple",  name:"军规",     color:"#9c8fb5", weight:3,     mult:1.28, affixes:[4,6], minLv:4,  price:13  },
  { id:"orange",  name:"精工",     color:"#c68b4c", weight:0.70,  mult:3.50, affixes:[3,3], minLv:6,  price:44, named:true },
  { id:"pearl",   name:"特种",     color:"#79a9a2", weight:0.42,  mult:3.20, affixes:[4,4], minLv:10, price:38, named:true },
  { id:"ancient", name:"试验型",   color:"#b06a62", weight:0.20,  mult:4.00, affixes:[6,6], minLv:14, price:96, named:true, power:true },
  { id:"rainbow", name:"原型",     color:"#c2a76a", weight:0.06,  mult:5.00, affixes:[6,6], minLv:18, price:280, named:true, power:true },
  { id:"mythic",     name:"定制",     color:"#b2645c", weight:0.030, mult:6.20, affixes:[7,7], minLv:22, price:620,  named:true, power:true },
  { id:"primordial", name:"竞赛级",   color:"#9a86a8", weight:0.014, mult:7.60, affixes:[8,8], minLv:28, price:1150, named:true, power:true },
  { id:"celestial",  name:"收藏级",   color:"#7fa8a0", weight:0.006, mult:9.50, affixes:[9,9], minLv:34, price:2300, named:true, power:true },
  { id:"singularity",name:"出厂封存", color:"#c9b878", weight:0.0024,mult:12.0, affixes:[10,10],minLv:40, price:4200, named:true, power:true },
];
const RARITY_BY_ID = {};
for(const r of RARITIES) RARITY_BY_ID[r.id]=r;

/* ----------------------------- 改装词条池 ----------------------------- */
/*
 * v0.15.0：全部改为可解释的枪械改装 / 弹药工艺术语。
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
  ],
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
 * v0.15.0：不再有「改装」概念，改为可解释的「改装等级」——
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
    desc:"好东西都在这儿，价格嘛……只收配给券，不谈现金。",
    slots:3, refreshBase:600, refreshLv:420, priceMul:1.45,
    currency:"eridium",
    weights:{ blue:3, purple:3.2, orange:1.1, pearl:0.7, ancient:0.35, rainbow:0.06, mythic:0.022, primordial:0.008, celestial:0.003, singularity:0.001 },
    ilvlBonus:11,
  },
  gamble: {
    id:"gamble", name:"封存枪箱", icon:"✦", tag:"盲盒",
    desc:"来源不明的封存箱，开箱前谁也不知道里面是哪一支。",
    basePrice:500, lvPrice:260,
  },
};
const SHOP_REFRESH = { base:800, perLv:1400 };

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
 * v0.15.0：改用现实军工体系命名。内部 key 保留以兼容旧存档中的 manufacturer 字段。
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
             named:["PM","GSh-18","P226","MP-443","USP .45","P-07"] },
  smg:     { name:"冲锋枪", baseDmg:6,  fireRate:11,  accuracy:0.82, mag:30, reload:1.5, speed:720, pellets:1, ammoType:"smg",     spread:0.10, auto:true,
             named:["PP-19-01","MP5A3","MP7A1","UMP .45","PP-9 Klin","P90"] },
  shotgun: { name:"霰弹枪", baseDmg:7,  fireRate:1.8, accuracy:0.65, mag:6,  reload:2.2, speed:680, pellets:8, ammoType:"shotgun", spread:0.22, auto:false,
             named:["Saiga-12","TOZ-106","MP-153","M870","SPAS-12","KS-23"] },
  rifle:   { name:"步枪", baseDmg:16, fireRate:6.0, accuracy:0.9,  mag:24, reload:1.8, speed:820, pellets:1, ammoType:"rifle",   spread:0.06, auto:true,
             named:["AK-74N","AK-103","AKM","M4A1","HK416","FN SCAR-L"] },
  sniper:  { name:"狙击枪", baseDmg:55, fireRate:1.1, accuracy:0.99, mag:5,  reload:2.0, speed:1100,pellets:1, ammoType:"sniper",  spread:0.01, auto:false, charge:true,
             named:["SVD-S","SV-98","VSS Vintorez","M24","DVL-10","ORSIS T-5000"] },
  launcher:{ name:"榴弹发射器", baseDmg:70, fireRate:0.9, accuracy:0.88, mag:4,  reload:2.6, speed:300, pellets:1, ammoType:"launcher",spread:0.04, auto:false, splash:120,
             named:["GP-25","GM-94","RG-6","M203","AGS-17","RGM-40"] },
};

// 部件词缀池（品级越高，越可能抽到高规格部件）
const PARTS = {
  barrel: [
    { name:"短管",   dmg:0.85, accuracy:0.9,  fireRate:1.1 },
    { name:"标准管", dmg:1.0,  accuracy:1.0,  fireRate:1.0 },
    { name:"长管",   dmg:1.2,  accuracy:1.12, fireRate:0.92 },
    { name:"重型管", dmg:1.35, accuracy:0.95, fireRate:0.85 },
  ],
  grip: [
    { name:"轻握把",   reload:0.85, fireRate:1.08, accuracy:1.05 },
    { name:"标准握把", reload:1.0,   fireRate:1.0,  accuracy:1.0 },
    { name:"重握把",   reload:1.15,  fireRate:0.95, accuracy:1.12 },
  ],
  magazine: [
    { name:"小弹匣",   mag:0.7,  reload:0.85 },
    { name:"标准弹匣", mag:1.0,  reload:1.0 },
    { name:"大弹匣",   mag:1.5,  reload:1.15 },
    { name:"弹鼓",     mag:2.0,  reload:1.3 },
  ],
  sight: [
    { name:"机械瞄具", accuracy:1.0,  zoom:1.0 },
    { name:"红点",     accuracy:1.06, zoom:1.1 },
    { name:"镜筒",     accuracy:1.14, zoom:1.4 },
  ],
  accessory: [
    { name:"",         dmg:1, fireRate:1, accuracy:1, mag:1, crit:1 },
    { name:"比赛级",   crit:1.4, dmg:1.05 },
    { name:"加重",     dmg:1.25, fireRate:0.95 },
    { name:"轻枪机",   fireRate:1.25, reload:0.9 },
    { name:"稳定",     accuracy:1.18, recoil:0.7 },
    { name:"扩容",     mag:1.25, reload:0.95 },
  ],
};

// 型号修饰词（现实枪械命名习惯）
const PREFIX = ["短管","折叠托","消音型","战术","侦察","突击","精工","军规","比赛级","夜战","伞兵","警用"];
const SUFFIX = ["-N","-S","-M","-SB","-T","-A1","-K","·战术","·出口型","·改进型","·空降型","·制式"];

/* ----------------------------- 干员 ----------------------------- */
// v0.15.0：移除「侦察兵 / 标记法师 / 掩护火力 / 突入 / 压制」等超能力设定，改为现实干员分工
const CLASSES = {
  siren: {
    id:"siren", name:"侦察兵", en:"Scout", color:"#9a86b5",
    tag:"前沿观察", desc:"观察与标记目标，优先获取交战信息。",
    hp:90, shield:70, speed:235, dmgMul:1.0, elemMul:1.5, ability:{name:"目标标记", cd:14, type:"phaselock"},
  },
  soldier: {
    id:"soldier", name:"突击兵", en:"Assault", color:"#5b86ad",
    tag:"火力掩护", desc:"依托掩体压制火线，防护与持续输出均衡。",
    hp:120, shield:60, speed:220, dmgMul:1.1, elemMul:1.0, ability:{name:"掩护火力", cd:16, type:"turret"},
  },
  psycho: {
    id:"psycho", name:"突入手", en:"Breacher", color:"#a35c4c",
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
 * 防弹插板 / 随身装备（v0.4.0，v0.15.0 拟真化）
 * 「护甲」在显示层一律称为防弹插板／护甲，不再描述为能量立场；
 * 自动整备机制属隐藏的旧模式，塔科夫模式使用 raid.js 的护甲耐久系统。
 * v0.15.0：effect 概率全部置 0 —— 不再产生冲击波 / 荆棘反伤 / 虹吸等超现实特效。
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
  green:  ["猎人臂章","野战标尺"],
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

/* 配给券（地下军械商货币） */
const ERIDIUM = {
  mini: 2,
  boss: 14,
  eliteChance:0.18,
  eliteAmount:1,
  sellPurple:2, sellOrange:4, sellPearl:4, sellAncient:6, sellRainbow:9,
  chest:1,
};

/* =========================================================================
 * 沙二模式（v0.4.0）— 5v5 爆破，CS2 竞技规则
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
