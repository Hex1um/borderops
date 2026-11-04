/* =========================================================================
 * config.js — 全局常量与平衡数值
 * 无主之地网页版：厂商 / 元素 / 稀有度 / 枪型 / 职业 定义
 * ========================================================================= */

const CFG = {
  version: "0.14.7",
  name: "边境行动",
  en: "BORDER OPS",
  // 画布逻辑分辨率基准（实际按窗口缩放）
  worldTile: 64,
  // 玩家基础
  player: {
    radius: 16,
    baseHP: 100,
    baseShield: 50,
    shieldDelay: 3.0,      // 无护盾装备时的兜底充能延迟
    shieldRegen: 12,       // 无护盾装备时的兜底回盾速度
    hpRegen: 0,            // 基础不回血
    speed: 230,            // px/s
    pickupRange: 70,
    abilityCD: 12,         // 职业技能冷却（秒）
  },
  // 升级
  level: {
    baseXP: 60,
    xpGrowth: 1.32,
    skillPointsPerLevel: 1,
    maxLevel: Infinity,   // 等级不设上限：持续变强，技能点持续投放
  },
};

/* ----------------------------- 元素系统 ----------------------------- */
// 克制：flesh(血肉) / shield(护盾) / armor(护甲)
const ELEMENTS = {
  none:      { id:"none",      name:"无",   color:"#dfd8c8", dot:0,   mult:{flesh:1,shield:1,armor:1},  desc:"物理伤害" },
  fire:      { id:"fire",      name:"火焰", color:"#ff5a1f", dot:6,   mult:{flesh:1.6,shield:0.5,armor:1}, desc:"持续灼烧，克血肉" },
  shock:     { id:"shock",     name:"电击", color:"#4ad6ff", dot:0,   mult:{flesh:0.8,shield:2.0,armor:1}, desc:"高伤破盾，克护盾" },
  corrosive: { id:"corrosive", name:"腐蚀", color:"#7bff3a", dot:6,   mult:{flesh:1,shield:0.5,armor:2.0}, desc:"溶解装甲，克护甲" },
  cryo:      { id:"cryo",      name:"冰冻", color:"#6fd6ff", dot:0,   mult:{flesh:1.5,shield:1,armor:1}, desc:"减速并被冻裂，克血肉" },
  explosive: { id:"explosive", name:"爆炸", color:"#ffb020", dot:0,   mult:{flesh:1.25,shield:1.25,armor:1.25}, desc:"范围溅射，全面" },
  radiation: { id:"radiation", name:"辐射", color:"#c8ff32", dot:5,   mult:{flesh:1,shield:1,armor:1}, desc:"连锁引爆周围敌人" },
};

/* ----------------------------- 稀有度 ----------------------------- */
/*
 * 8 档品质，权重极度偏斜（普通 : 彩虹 ≈ 1000 : 1），
 * 低档靠「词缀数量」，高档靠「数值倍率」补偿——这是刷宝手感的骨架。
 * affixes:[最少,最多] / mult:全局数值倍率 / price:物价倍率
 */
const RARITIES = [
  { id:"white",   name:"普通", color:"#e9e4dc", weight:40,    mult:1.00, affixes:[0,0], minLv:1,  price:1   },
  { id:"green",   name:"罕见", color:"#5bd66a", weight:30,    mult:1.00, affixes:[1,2], minLv:1,  price:2.2 },
  { id:"blue",    name:"稀有", color:"#4aa3ff", weight:12,    mult:1.00, affixes:[2,4], minLv:2,  price:5.5 },
  { id:"purple",  name:"史诗", color:"#b061ff", weight:3,     mult:1.28, affixes:[4,6], minLv:4,  price:13  },
  { id:"orange",  name:"传奇", color:"#ff8a1e", weight:0.70,  mult:3.50, affixes:[3,3], minLv:6,  price:44, named:true },
  { id:"pearl",   name:"珍珠", color:"#6fe8d0", weight:0.42,  mult:3.20, affixes:[4,4], minLv:10, price:38, named:true },
  { id:"ancient", name:"远古", color:"#ff4d6d", weight:0.20,  mult:4.00, affixes:[6,6], minLv:14, price:96, named:true, power:true },
  { id:"rainbow", name:"彩虹", color:"#ff5ce0", weight:0.06,  mult:5.00, affixes:[6,6], minLv:18, price:280, named:true, power:true },
  // —— 以下为「超越彩虹」的顶级品质：参考 Rakanishu 的多层稀有度，并额外追加 ——
  { id:"mythic",     name:"神话", color:"#ff3d6e", weight:0.030, mult:6.20, affixes:[7,7], minLv:22, price:620,  named:true, power:true },
  { id:"primordial", name:"原初", color:"#c77dff", weight:0.014, mult:7.60, affixes:[8,8], minLv:28, price:1150, named:true, power:true },
  { id:"celestial",  name:"寰宇", color:"#7df9ff", weight:0.006, mult:9.50, affixes:[9,9], minLv:34, price:2300, named:true, power:true },
  { id:"singularity",name:"奇点", color:"#ffd200", weight:0.0024,mult:12.0, affixes:[10,10],minLv:40, price:4200, named:true, power:true },
];
const RARITY_BY_ID = {};
for(const r of RARITIES) RARITY_BY_ID[r.id]=r;

/* ----------------------------- 词缀池 ----------------------------- */
/*
 * 复刻刷宝游戏的词缀生成：前缀/后缀各一半概率，按 ilvl 开放，
 * 数值在后缀生成时按 ilvl 缩放（见 weapons.js scaleMod）。
 * stat 说明：
 *   dmgPct 伤害% / fireRatePct 射速% / accPct 精准% / magPct 弹匣%
 *   reloadPct 换弹提速% / critDmg 暴击伤害(点) / critChance 暴击几率%
 *   elemPct 元素伤害% / elemChance 元素触发% / splashPct 溅射范围%
 *   projSpeed 弹速% / pierce 穿透 / pellets 额外弹丸 / lifesteal 吸血%
 */
const AFFIXES = {
  prefix: [
    { nm:"毁灭的",   lvl:1,  mods:[{stat:"dmgPct",      min:8,  max:16}] },
    { nm:"凶暴的",   lvl:10, mods:[{stat:"dmgPct",      min:16, max:28}] },
    { nm:"屠戮的",   lvl:20, mods:[{stat:"dmgPct",      min:28, max:45}] },
    { nm:"湮灭的",   lvl:26, mods:[{stat:"dmgPct",      min:40, max:60}] },
    { nm:"迅捷的",   lvl:1,  mods:[{stat:"fireRatePct", min:8,  max:16}] },
    { nm:"狂暴的",   lvl:12, mods:[{stat:"fireRatePct", min:16, max:28}] },
    { nm:"精准的",   lvl:1,  mods:[{stat:"accPct",      min:6,  max:12}] },
    { nm:"鹰眼的",   lvl:9,  mods:[{stat:"accPct",      min:12, max:20}] },
    { nm:"扩容的",   lvl:1,  mods:[{stat:"magPct",      min:15, max:28}] },
    { nm:"弹鼓的",   lvl:13, mods:[{stat:"magPct",      min:28, max:50}] },
    { nm:"致命的",   lvl:4,  mods:[{stat:"critDmg",     min:20, max:38}] },
    { nm:"断头的",   lvl:17, mods:[{stat:"critDmg",     min:40, max:70}] },
    { nm:"磨利的",   lvl:7,  mods:[{stat:"critChance",  min:4,  max:8}] },
    { nm:"迅装的",   lvl:2,  mods:[{stat:"reloadPct",   min:12, max:22}] },
    { nm:"高速的",   lvl:3,  mods:[{stat:"projSpeed",   min:15, max:28}] },
    { nm:"灼热的",   lvl:6,  mods:[{stat:"elemPct",     min:12, max:22}], elem:"fire" },
    { nm:"腐蚀的",   lvl:6,  mods:[{stat:"elemPct",     min:12, max:22}], elem:"corrosive" },
    { nm:"带电的",   lvl:6,  mods:[{stat:"elemPct",     min:12, max:22}], elem:"shock" },
    { nm:"霜冻的",   lvl:6,  mods:[{stat:"elemPct",     min:12, max:22}], elem:"cryo" },
    { nm:"熔核的",   lvl:8,  mods:[{stat:"splashPct",   min:20, max:35}], needSplash:true },
    // v0.12.5 每次射击发数改为「稀有词条」体系：
    //   常规非霰弹枪恒定 1 发/次；双管的（稀有+）→ 2 发；蜂群的（远古+）→ 3 发
    { nm:"双管的",   lvl:14, minQ:3, pellet:1, mods:[{stat:"pellets",     min:1,  max:1}] },
    { nm:"贯通的",   lvl:15, mods:[{stat:"pierce",      min:1,  max:1}] },
    { nm:"吸血的",   lvl:18, mods:[{stat:"lifesteal",   min:2,  max:4}] },
    { nm:"炽烈的",   lvl:11, mods:[{stat:"elemChance",  min:8,  max:15}], elemOnly:true },
    { nm:"沉重的",   lvl:5,  mods:[{stat:"dmgPct", min:12, max:22},{stat:"fireRatePct", min:-12, max:-6}] },
    { nm:"轻量的",   lvl:6,  mods:[{stat:"fireRatePct", min:10, max:18},{stat:"reloadPct", min:10, max:18}] },
    { nm:"精工的",   lvl:16, mods:[{stat:"accPct", min:8, max:14},{stat:"critDmg", min:15, max:30}] },
    { nm:"蜂群的",   lvl:24, minQ:6, pellet:3, mods:[{stat:"pellets",     min:2,  max:2}] },
    // —— 扩展词缀（枪型/配件联动的新维度）——
    { nm:"稳定的",   lvl:1,  mods:[{stat:"recoil",      min:8,  max:16}] },
    { nm:"矫健的",   lvl:1,  mods:[{stat:"moveSpeed",   min:6,  max:12}] },
    { nm:"远见的",   lvl:3,  mods:[{stat:"range",       min:10, max:20}] },
    { nm:"爆裂的",   lvl:6,  mods:[{stat:"splashDmg",   min:15, max:30}] },
    { nm:"守盾的",   lvl:8,  mods:[{stat:"shieldOnHit", min:4,  max:10}] },
    { nm:"节俭的",   lvl:5,  mods:[{stat:"ammoEff",     min:8,  max:18}] },
    { nm:"疾行的",   lvl:2,  mods:[{stat:"moveSpeed", min:5, max:10},{stat:"fireRatePct", min:5, max:10}] },
    { nm:"鹰扬的",   lvl:4,  mods:[{stat:"range", min:8, max:16},{stat:"accPct", min:5, max:10}] },
    { nm:"重锤的",   lvl:12, mods:[{stat:"dmgPct", min:14, max:24},{stat:"recoil", min:8, max:16}] },
    { nm:"游侠的",   lvl:7,  mods:[{stat:"moveSpeed", min:6, max:12},{stat:"reloadPct", min:8, max:16}] },
    { nm:"裂空的",   lvl:9,  mods:[{stat:"range", min:10, max:18},{stat:"projSpeed", min:10, max:18}] },
    { nm:"镇定的",   lvl:10, mods:[{stat:"recoil", min:12, max:22},{stat:"reloadPct", min:8, max:16}] },
  ],
  suffix: [
    { nm:"之怒", lvl:1,  mods:[{stat:"dmgPct",      min:6,  max:12}] },
    { nm:"之噬", lvl:4,  mods:[{stat:"lifesteal",   min:1,  max:3}] },
    { nm:"之速", lvl:2,  mods:[{stat:"reloadPct",   min:10, max:20}] },
    { nm:"之稳", lvl:3,  mods:[{stat:"accPct",      min:6,  max:14}] },
    { nm:"之暴", lvl:6,  mods:[{stat:"critChance",  min:3,  max:7}] },
    { nm:"之涌", lvl:8,  mods:[{stat:"elemChance",  min:6,  max:12}] },
    { nm:"之爆", lvl:9,  mods:[{stat:"splashPct",   min:12, max:24}], needSplash:true },
    { nm:"之嗜", lvl:5,  mods:[{stat:"fireRatePct", min:5,  max:10}] },
    { nm:"之裁", lvl:10, mods:[{stat:"critDmg",     min:18, max:34}] },
    { nm:"之匣", lvl:7,  mods:[{stat:"magPct",      min:12, max:24}] },
    { nm:"之焰", lvl:9,  mods:[{stat:"elemPct",     min:8,  max:16}], elemOnly:true },
    { nm:"之贯", lvl:16, mods:[{stat:"pierce",      min:1,  max:1}] },
    { nm:"之潮", lvl:5,  mods:[{stat:"projSpeed",   min:10, max:20}] },
    { nm:"之钉", lvl:12, mods:[{stat:"dmgPct", min:8, max:16},{stat:"critChance", min:2, max:5}] },
    { nm:"之息", lvl:11, mods:[{stat:"reloadPct", min:12, max:22},{stat:"magPct", min:8, max:16}] },
    { nm:"之牙", lvl:13, mods:[{stat:"dmgPct", min:12, max:20},{stat:"fireRatePct", min:-8, max:-4}] },
    { nm:"之翼", lvl:14, mods:[{stat:"fireRatePct", min:10, max:18}] },
    { nm:"之雷", lvl:15, mods:[{stat:"elemPct", min:10, max:18},{stat:"elemChance", min:6, max:12}], elemOnly:true },
    { nm:"之渊", lvl:22, mods:[{stat:"dmgPct",      min:16, max:28}] },
    // —— 扩展词缀（后缀）——
    { nm:"之远", lvl:4,  mods:[{stat:"range",       min:8,  max:18}] },
    { nm:"之盾", lvl:6,  mods:[{stat:"shieldOnHit", min:3,  max:8}] },
    { nm:"之省", lvl:3,  mods:[{stat:"ammoEff",     min:6,  max:14}] },
    { nm:"之定", lvl:2,  mods:[{stat:"recoil",      min:8,  max:16}] },
    { nm:"之捷", lvl:1,  mods:[{stat:"moveSpeed",   min:5,  max:12}] },
    { nm:"之裂", lvl:8,  mods:[{stat:"splashDmg",   min:12, max:24}] },
    { nm:"之衡", lvl:10, mods:[{stat:"moveSpeed", min:5, max:10},{stat:"accPct", min:5, max:10}] },
    { nm:"之韧", lvl:11, mods:[{stat:"recoil", min:10, max:20},{stat:"reloadPct", min:8, max:16}] },
  ],
};

// 远古/彩虹专属威能（稀有度 power 标记时额外附赠一条）
const POWERS = [
  { nm:"太古之力", mods:[{stat:"dmgPct",     min:25, max:45}] },
  { nm:"太古之怒", mods:[{stat:"critDmg",    min:60, max:110}] },
  { nm:"太古之速", mods:[{stat:"fireRatePct",min:20, max:35}] },
  { nm:"太古之壁", mods:[{stat:"lifesteal",  min:3,  max:6}] },
  { nm:"太古之瞳", mods:[{stat:"critChance", min:8,  max:16}] },
  { nm:"太古之流", mods:[{stat:"elemPct",    min:25, max:45}], elemOnly:true },
  { nm:"太古之量", mods:[{stat:"magPct",     min:40, max:80}] },
  { nm:"太古之贯", mods:[{stat:"pierce",     min:2,  max:2}] },
];

/* ----------------------------- 混乱等级（Mayhem） ----------------------------- */
/*
 * 参考 BL3 的混乱 / 刷宝游戏的「难度换收益」：
 *   怪物生命按 1.5^n 指数膨胀，伤害按 1.2^n 膨胀；
 *   经验 +15%/级，金币与掉落数量 +25%/级；
 *   掉落装备自带「混乱等级 m ∈ [0,n]」，m 越高词缀数值越猛（×1.12^m），
 *   但 m 的抽取权重极度偏斜：w(m)= m>=n ? 1 : 2^(n-1-m)。
 * 也就是说：混乱 8 时，出「混乱 8」装备的概率只有「混乱 0」的 1/128。
 */
const MAYHEM = {
  hpMul: 1.40,         // 怪物生命 / 级（混乱 1 +40%，混乱 8 ≈ 14 倍）
  dmgMul: 1.15,        // 怪物伤害 / 级
  xpAdd: 0.15,         // 经验加成 / 级
  lootAdd: 0.25,       // 金币与掉落 / 级
  lvlStep: 0.5,        // 怪物等级额外拔高 = floor(n*0.5)（混乱主要加血，不猛提等级）
  lvlBase: 1,          // 再 +1 级
  gearPower: 1.12,     // 混乱 m 装备的数值倍率底数
  corePower: 1.18,     // v0.14.6：由「混乱核心」提供的混乱等级乘区更强（底数更高）
  capBase: 1,          // 解锁后基础上限
  capPerRebirth: 1,    // 每次转生 +1 上限
  capBuyStep: 5,       // 灵魂购买一次 +5 上限
  capBuyBase: 20,      // 首次购买成本
  capBuyPer: 5,        // 每买一次成本 +5
};
// 混乱装备的混乱等级抽取：m ∈ [0,n]，n 与 n-1 并列最低权重 1
function rollGearMayhem(n){
  if(n<=0) return 0;
  let tot=0; const cw=[];
  for(let k=0;k<=n;k++){ const w = k>=n ? 1 : Math.pow(2, n-1-k); cw.push(w); tot+=w; }
  let r=RNG.f()*tot;
  for(let k=0;k<=n;k++){ r-=cw[k]; if(r<=0) return k; }
  return 0;
}

/* ----------------------------- 转生（Rebirth） ----------------------------- */
/*
 * 灵魂 = 等级 + 装备评分 + 混乱等级，整体 ×0.5。
 * 灵魂只用于「永久升级」与「混乱上限」，跨转生保留。
 * 转生重置：等级 / 经验 / 技能 / 武器库（只留一把最高价值）/ 金币，
 * 保留：灵魂 / 永久升级 / 混乱解锁与上限 / 转生次数。
 */
const PERM_UPGRADES = [
  { id:"hp",   name:"血脉记忆", stat:"生命上限", base:5,  grow:1.9, per:2,  unit:"% 生命" },
  { id:"dmg",  name:"战场记忆", stat:"全部伤害", base:7,  grow:2.0, per:2,  unit:"% 伤害" },
  { id:"mf",   name:"寻宝记忆", stat:"魔法寻找", base:9,  grow:2.1, per:3,  unit:" 点 MF" },
  { id:"gf",   name:"财富记忆", stat:"金币获取", base:7,  grow:2.0, per:4,  unit:"% 金币" },
  { id:"soul", name:"灵魂亲和", stat:"灵魂收益", base:22, grow:2.5, per:10, unit:"% 灵魂" },
  { id:"drop", name:"掉落亲和", stat:"装备掉率", base:26, grow:2.7, per:2,  unit:"% 掉率" },
];
const PRESTIGE = {
  gearDiv: 8000,       // 装备评分（价值总和）除数
  base: 0.5,           // 整体系数
  mayhemSoul: 4,       // 每级混乱折算灵魂
  keepGold: 500,       // 转生后保留金币
  minLevel: 5,         // 低于此等级不许转生（避免开局限定）
};

/* ----------------------------- 商店 ----------------------------- */
/*
 * 三个铺位：军火（走量）、黑市（高品质高溢价）、赌枪机（盲盒）
 * 品质权重独立于掉落表——商店侧重可买性，掉落侧重惊喜。
 */
const SHOPS = {
  marcus: {
    id:"marcus", name:"马库斯军火", icon:"▮", tag:"正规军火商",
    desc:"“买枪找我，别问枪从哪来的。”",
    slots:5, refreshBase:300, refreshLv:220, priceMul:1.15,
    weights:{ white:5, green:8, blue:6, purple:2.2, orange:0.5, pearl:0.28, ancient:0.12 },
    ilvlBonus:5,
  },
  black: {
    id:"black", name:"黑市", icon:"◐", tag:"不开发票",
    desc:"“好东西都在这儿，价格嘛……只收镒矿，不谈金币。”",
    slots:3, refreshBase:600, refreshLv:420, priceMul:1.45,
    currency:"eridium",
    weights:{ blue:3, purple:3.2, orange:1.1, pearl:0.7, ancient:0.35, rainbow:0.06, mythic:0.022, primordial:0.008, celestial:0.003, singularity:0.001 },
    ilvlBonus:11,
  },
  gamble: {
    id:"gamble", name:"赌枪机", icon:"✦", tag:"盲盒",
    desc:"“投币，拉杆，祈祷。”随机一把，品质完全看脸。",
    basePrice:500, lvPrice:260,
  },
};
const SHOP_REFRESH = { base:800, perLv:1400 };  // 军火刷新价

/* ----------------------------- 掉落 ----------------------------- */
const DROP = {
  // 掉落判定：基础命中率 + 区域等级系数
  itemChanceBase:0.075,
  itemChancePerLv:0.0012,
  miniBonus:0.62,
  bossBonus:1.8,
  bossCount:[4,6],
  miniCount:[1,2],
  // 金币
  goldBase:6, goldPerLv:5, goldSpread:6,
  goldBoss:12, goldMini:2.5,
  // 特殊掉落概率
  potion:0.10, ammo:0.32,
  // MF 兑换：每点 MF 对高品质权重的加成分母
  mfDiv:{ green:200, blue:180, purple:180, orange:150, pearl:150, ancient:120, rainbow:100, mythic:90, primordial:75, celestial:60, singularity:50 },
};

/* ----------------------------- 厂商 ----------------------------- */
// 每个厂商对基础属性做乘区修正 + 风格标签（影响名称与手感）
const MANUFACTURERS = {
  Jakobs:  { name:"Jakobs",  color:"#9a2b2b", dmg:1.30, fireRate:0.82, accuracy:1.20, mag:0.8,  reload:1.05, crit:1.6, elemChance:0,    style:"高伤·栓动·暴击", throwable:false },
  Maliwan: { name:"Maliwan", color:"#1f8fb0", dmg:0.95, fireRate:0.85, accuracy:1.15, mag:0.9,  reload:1.1,  crit:1.0, elemChance:1.0,  style:"纯元素·精准",     throwable:false },
  Tediore: { name:"Tediore", color:"#2f7d3a", dmg:0.95, fireRate:1.05, accuracy:0.95, mag:1.0,  reload:0.55, crit:1.0, elemChance:0.4,  style:"换弹即扔·爆裂", throwable:true },
  Vladof:  { name:"Vladof",  color:"#b0451f", dmg:0.95, fireRate:1.35, accuracy:0.9,  mag:1.3,  reload:1.0,  crit:1.0, elemChance:0.4,  style:"恐怖射速·大弹匣", throwable:false },
  Hyperion:{ name:"Hyperion",color:"#2a2a2a", dmg:1.0,  fireRate:0.95, accuracy:1.35, mag:0.95, reload:1.05, crit:1.1, elemChance:0.5,  style:"越打越准",       throwable:false },
  Torgue:  { name:"Torgue",  color:"#7a4a12", dmg:1.1,  fireRate:0.8,  accuracy:0.95, mag:0.7,  reload:1.2,  crit:1.0, elemChance:0,    style:"爆炸专用",       throwable:false, forceExplosive:true },
  Dahl:    { name:"Dahl",    color:"#356b3a", dmg:1.0,  fireRate:1.05, accuracy:1.05, mag:1.05, reload:1.0,  crit:1.05,elemChance:0.5,  style:"全自动·均衡",     throwable:false },
  Atlas:   { name:"Atlas",   color:"#2a3b6b", dmg:1.02, fireRate:1.0,  accuracy:1.1,  mag:1.0,  reload:1.0,  crit:1.1, elemChance:0.5,  style:"追踪弹",         throwable:false, homing:true },
};

/* ----------------------------- 枪型 ----------------------------- */
// 基础属性 + 弹药类型 + 弹丸数 + 具名池（传奇以上用它命名）
const WEAPON_TYPES = {
  pistol:  { name:"手枪",   baseDmg:11, fireRate:3.2, accuracy:0.92, mag:12, reload:1.1, speed:760, pellets:1, ammoType:"pistol",  spread:0.05, auto:false,
             named:["无情","电话会议","蜂巢","独角兽","小妖精","最后一击"] },
  smg:     { name:"冲锋枪", baseDmg:6,  fireRate:11,  accuracy:0.82, mag:30, reload:1.5, speed:720, pellets:1, ammoType:"smg",     spread:0.10, auto:true,
             named:["会议召唤","蜂群","暴雨","余烬","低语","撕裂者"] },
  shotgun: { name:"霰弹枪", baseDmg:7,  fireRate:1.8, accuracy:0.65, mag:6,  reload:2.2, speed:680, pellets:8, ammoType:"shotgun", spread:0.22, auto:false,
             named:["野蛮人","碎骨者","屠夫","轰鸣","审判日","双生牙"] },
  rifle:   { name:"步枪",   baseDmg:16, fireRate:6.0, accuracy:0.9,  mag:24, reload:1.8, speed:820, pellets:1, ammoType:"rifle",   spread:0.06, auto:true,
             named:["哈罗德","诺法雷","瘟疫","闪电球","腐蚀者","长夜"] },
  sniper:  { name:"狙击枪", baseDmg:55, fireRate:1.1, accuracy:0.99, mag:5,  reload:2.0, speed:1100,pellets:1, ammoType:"sniper",  spread:0.01, auto:false, charge:true,
             named:["穿透者","长眠","寂静","断头台","一线天","守夜人"] },
  launcher:{ name:"火箭筒", baseDmg:70, fireRate:0.9, accuracy:0.88, mag:4,  reload:2.6, speed:300, pellets:1, ammoType:"launcher",spread:0.04, auto:false, splash:120,
             named:["诺瓦","雷神","末日","轰炸机","地裂","陨星"] },
};

// 部件词缀池（颜色/稀有度越高，越可能抽到高级部件）
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
    { name:"致命",     crit:1.4, dmg:1.05 },
    { name:"凶猛",     dmg:1.25, fireRate:0.95 },
    { name:"迅捷",     fireRate:1.25, reload:0.9 },
    { name:"稳定",     accuracy:1.18, recoil:0.7 },
    { name:"稳固",     mag:1.25, reload:0.95 },
  ],
};

// 名称前缀（随厂商/元素/稀有度变化）
const PREFIX = ["暴力","嗜血","迅捷","致命","狂怒","破晓","余烬","雷霆","剧毒","寒霜","轰鸣","辐能","孽火","双生","审判","荒芜"];
const SUFFIX = ["之握","之噬","之怒","之拥","之罚","之裔","终结","审判","回响","撕裂","制裁","陨落","猎杀","咆哮"];

/* ----------------------------- 职业 ----------------------------- */
// 4 职业，含基础属性修正与技能树（见 skills.js 取用）
const CLASSES = {
  siren: {
    id:"siren", name:"魔女", en:"Siren", color:"#b061ff",
    tag:"相位法师", desc:"操控元素与相位能量，元素伤害与控场极强。",
    hp:90, shield:70, speed:235, dmgMul:1.0, elemMul:1.5, ability:{name:"相位锁", cd:14, type:"phaselock"},
  },
  soldier: {
    id:"soldier", name:"士兵", en:"Soldier", color:"#4aa3ff",
    tag:"战术兵", desc:"部署自动炮塔并强化护盾，攻守兼备。",
    hp:120, shield:60, speed:220, dmgMul:1.1, elemMul:1.0, ability:{name:"炮塔", cd:16, type:"turret"},
  },
  psycho: {
    id:"psycho", name:"狂战士", en:"Psycho", color:"#e23b3b",
    tag:"近战狂人", desc:"越高伤越疯狂，近战与爆发输出恐怖。",
    hp:140, shield:30, speed:250, dmgMul:1.2, elemMul:0.9, ability:{name:"狂暴", cd:18, type:"bloodlust"},
  },
  gunner: {
    id:"gunner", name:"炮手", en:"Gunner", color:"#ff8a1e",
    tag:"重火力", desc:"高生命高射速，正面碾压的火力平台。",
    hp:160, shield:50, speed:205, dmgMul:1.05, elemMul:1.0, ability:{name:"过载", cd:15, type:"overload"},
  },
};

/* =========================================================================
 * 护盾 / 圣物（v0.4.0）
 * 护盾不再是「脱战自动回满」：每个护盾有自己的容量、充能延迟与充能速度，
 * 受击后必须等满 `delay` 秒才开始充能，且只能按 `rate` 慢慢补。
 * 圣物是纯被动词条装备，一个槽位。
 * ========================================================================= */
const SHIELD_RARITY = {
  white:  { cap:0.90, delay:4.8, rech:6.2, effect:0 },
  green:  { cap:1.00, delay:4.3, rech:5.6, effect:0 },
  blue:   { cap:1.16, delay:3.9, rech:5.0, effect:0.35 },
  purple: { cap:1.37, delay:3.3, rech:4.2, effect:0.85 },
  orange: { cap:1.78, delay:2.7, rech:3.5, effect:1 },
  pearl:  { cap:1.86, delay:2.5, rech:3.2, effect:1 },
  ancient:{ cap:2.15, delay:2.1, rech:2.8, effect:1 },
  rainbow:{ cap:2.45, delay:1.8, rech:2.4, effect:1 },
  mythic:     { cap:2.85, delay:1.6, rech:2.0, effect:1 },
  primordial: { cap:3.25, delay:1.4, rech:1.8, effect:1 },
  celestial:  { cap:3.75, delay:1.2, rech:1.6, effect:1 },
  singularity: { cap:4.40, delay:1.0, rech:1.4, effect:1 },
};

const SHIELD_EFFECTS = {
  nova:   { id:"nova",   name:"破裂冲击", color:"#ffb020", desc:"护盾破碎时向四周释放能量冲击，对附近敌人造成伤害" },
  amp:    { id:"amp",    name:"满盾增幅", color:"#ff5ce0", desc:"护盾全满时全部伤害提升" },
  thorns: { id:"thorns", name:"荆棘回馈", color:"#7bff3a", desc:"受到攻击时把一部分伤害反弹给攻击者" },
  reboot: { id:"reboot", name:"急速重启", color:"#4ad6ff", desc:"护盾破碎后充能延迟大幅缩短" },
  vamp:   { id:"vamp",   name:"护盾虹吸", color:"#ff4d6d", desc:"护盾破碎时把部分护盾值转化为生命" },
};

const SHIELD_NAMES = {
  white:  ["废铁力场","应急护盾","旧型号护盾"],
  green:  ["能量屏障","回流护盾","腐蚀力场"],
  blue:   ["相位力场","涌流护盾","共振护罩"],
  purple: ["高压壁垒","过载护罩","潮汐力场"],
  orange: ["不朽壁垒","破晓之盾","警戒方尖"],
  pearl:  ["静电力场","深渊护罩"],
  ancient:["远古壁垒","秘藏之壁"],
  rainbow:["彩虹奇点","万象壁垒"],
  mythic:     ["神话壁垒","湮灭力场"],
  primordial: ["原初奇点","太初之壁"],
  celestial:  ["寰宇圣盾","星界护罩"],
  singularity: ["奇点核心","终焉壁垒"],
};

// 圣物词条池：value 为 1 级基准，随 ilvl 与品质缩放
const RELIC_MODS = [
  { stat:"dmgPct",     label:"全部伤害",   min:4,  max:9,  scale:0.05 },
  { stat:"fireRatePct",label:"射速",       min:3,  max:8,  scale:0.04 },
  { stat:"critChance", label:"暴击几率",   min:2,  max:5,  scale:0.03 },
  { stat:"critDmg",    label:"暴击伤害",   min:8,  max:18, scale:0.05 },
  { stat:"moveSpeed",  label:"移动速度",   min:3,  max:7,  scale:0.02 },
  { stat:"magPct",     label:"弹匣容量",   min:4,  max:10, scale:0.04 },
  { stat:"reloadPct",  label:"换弹速度",   min:4,  max:10, scale:0.04 },
  { stat:"elemPct",    label:"元素伤害",   min:5,  max:12, scale:0.05 },
  { stat:"lifesteal",  label:"吸血",       min:1,  max:3,  scale:0.02 },
  { stat:"goldPct",    label:"金币获取",   min:5,  max:14, scale:0.03 },
  { stat:"mfFlat",     label:"魔法寻找",   min:4,  max:10, scale:0.15 },
  { stat:"xpPct",      label:"经验获取",   min:4,  max:10, scale:0.03 },
  { stat:"shieldPct",  label:"护盾容量",   min:6,  max:14, scale:0.05 },
  { stat:"shieldDelay",label:"充能延迟缩短",min:0.2,max:0.5,scale:0.004 },
  { stat:"abilityCD",  label:"技能冷却缩短",min:4, max:9,  scale:0.02 },
];

const RELIC_NAMES = {
  white:  ["旧日徽记","磨损护符"],
  green:  ["猎人印记","荒野护符"],
  blue:   ["相位棱镜","潮汐徽记"],
  purple: ["深渊之眼","烈焰之心"],
  orange: ["秘藏钥匙","屠戮圣徽"],
  pearl:  ["静海之核","潮声遗物"],
  ancient:["太古残响","虚空王冠"],
  rainbow:["万象之心","彩虹奇点"],
  mythic:     ["神话遗物","湮灭之徽"],
  primordial: ["原初残响","太初王冠"],
  celestial:  ["寰宇之心","星界圣物"],
  singularity:["奇点之眼","终焉圣徽"],
};

// 掉落权重：武器为主，护盾次之，圣物最少
const ITEM_DROP = { weapon:0.72, shield:0.20, relic:0.08 };

/* 镒矿（黑市货币）：只从精英 / 首领 / 分解高品质装备获得，不能与金币互换 */
const ERIDIUM = {
  mini: 2,          // 精英击杀
  boss: 14,         // 首领击杀
  eliteChance:0.18, // 普通怪小概率
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
  // 无主之地模式五列：不卖 CS2 护甲（BL 用护盾），圣物 / 护盾固定置底
  buyTabsBL: [
    { id:"pistol", name:"手枪",       en:"Pistols" },
    { id:"smg",    name:"中档",       en:"Mid-Tier" },
    { id:"rifle",  name:"步枪",       en:"Rifles" },
    { id:"nade",   name:"手雷",       en:"Grenades" },
    { id:"blgear", name:"圣物 / 护盾", en:"Relics & Shields" },
  ],
};

/* 无尽模式：每波指数增强，5 波一个首领 */
const ENDLESS = {
  waveTime: 26,          // 每波基础时长（清空则提前）
  hpPerWave: 0.28,       // 每波生命 +28%
  dmgPerWave: 0.10,      // 每波伤害 +10%
  countBase: 6,          // 首波数量
  countPerWave: 1.1,     // 每波 +1.1 只
  maxConcurrent: 13,
  bossEvery: 5,
  xpPerWave: 0.22,
  lootPerWave: 0.18,
  eriPerBoss: 8,
};
