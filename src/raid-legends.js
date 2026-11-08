/* =========================================================================
 * raid-legends.js — 秘藏原型：改编传奇枪 + 配套具名配件（v0.31.0）
 *
 * 独立分片的原因：raid-data.js 已经贴着 2000 行的物理拆分上限，再塞 6 把
 * 传奇与 6 件配件会触发门禁。本文件必须在 raid-data.js **之后** 加载：
 *   · 具名装备表 RAID_UNIQUES 整张定义在这里，raid-data.js 只保留调用；
 *   · raidMakeUnique / 箱子掉落只在运行时调用 raidNamedPartFor 等函数，
 *     函数声明全局提升，加载顺序不影响调用。
 *
 * 设计说明：「无主之地」系列传奇枪只取招牌机制作为灵感，不沿用原作名称、
 * 世界观与商标；全部改成现实军械口径 + 中文制式命名，机制落地为本作已有的
 * pellets / splash / armorPen / rpm / noAmmo，数值压回 T8 带宽。
 * ========================================================================= */

const RAID_UNIQUES = [
// —— 枪械：现实型号 + 出厂改装方案 ——
  { id:"u_dawn", name:"AK-74N 5.45×39 战术型", kind:"weapon", type:"rifle", tier:5, elem:"fire", ilvl:30,
    perk:"军规冷锻枪管 · 枪口动能 +30%，理论射速 +14%",
    affixes:[ { kind:"prefix", nm:"冷锻枪管", mods:[{stat:"dmgPct",value:30},{stat:"projSpeed",value:20}] },
              { kind:"suffix", nm:"·军用批次", mods:[{stat:"fireRatePct",value:14},{stat:"magPct",value:30}] } ] },
  { id:"u_humming", name:"PP-19-01 Vityaz 9×19 短突型", kind:"weapon", type:"pistol", tier:5, elem:"none", ilvl:28,
    perk:"轻量枪机 · 理论射速 +48%，换弹速度 +30%",
    affixes:[ { kind:"prefix", nm:"轻量枪机", mods:[{stat:"fireRatePct",value:48}] },
              { kind:"suffix", nm:"·快拔套", mods:[{stat:"magPct",value:35},{stat:"reloadPct",value:30}] } ] },
  { id:"u_butcher", name:"Saiga-12K 12/70 破门型", kind:"weapon", type:"shotgun", tier:5, elem:"none", ilvl:30,
    perk:"短管鹿弹配置 · 枪口动能 +46%，弹头初速 +18%",
    affixes:[ { kind:"prefix", nm:"加重枪管", mods:[{stat:"dmgPct",value:46}] },
              { kind:"suffix", nm:"·高初速", mods:[{stat:"projSpeed",value:18},{stat:"recoil",value:20}] } ] },
  { id:"u_plague", name:"MP5 9×19 消音型", kind:"weapon", type:"smg", tier:6, elem:"cryo", ilvl:36,
    perk:"一体消音器 + 亚音速弹 · 射击精度 +35%，有效射程 +20%",
    affixes:[ { kind:"prefix", nm:"精磨枪管", mods:[{stat:"accPct",value:35},{stat:"range",value:20}] },
              { kind:"suffix", nm:"·亚音速", mods:[{stat:"fireRatePct",value:16},{stat:"magPct",value:40}] } ] },
  { id:"u_fox", name:"HK 416A5 5.56×45 侦察型", kind:"weapon", type:"rifle", tier:6, elem:"none", ilvl:36,
    perk:"浮置枪管 + 光学座 · 射击精度 +40%，有效射程 +30%",
    affixes:[ { kind:"prefix", nm:"浮置枪管", mods:[{stat:"accPct",value:40},{stat:"range",value:30}] },
              { kind:"suffix", nm:"·归零", mods:[{stat:"dmgPct",value:22},{stat:"projSpeed",value:35}] } ] },
  { id:"u_guillotine", name:"SV-98 7.62×54R 精确型", kind:"weapon", type:"sniper", tier:7, elem:"shock", ilvl:42,
    perk:"比赛级枪管 + 钢芯弹 · 要害命中 +20%，要害伤害 +80%",
    affixes:[ { kind:"prefix", nm:"比赛级膛线", mods:[{stat:"dmgPct",value:55},{stat:"critChance",value:20}] },
              { kind:"suffix", nm:"·精修", mods:[{stat:"critDmg",value:80}] } ] },
  { id:"u_thousand", name:"RPK-16 5.45×39 轻机枪型", kind:"weapon", type:"rifle", tier:7, elem:"radiation", ilvl:42,
    perk:"重枪管 + 弹鼓 · 枪口动能 +35%，弹匣容量 +50%",
    affixes:[ { kind:"prefix", nm:"重枪管", mods:[{stat:"dmgPct",value:35},{stat:"magPct",value:50}] },
              { kind:"suffix", nm:"·大容量", mods:[{stat:"fireRatePct",value:12},{stat:"reloadPct",value:25}] } ] },
  { id:"u_thor", name:"ORSIS T-5000 .338 LM 远程型", kind:"weapon", type:"sniper", tier:8, elem:"shock", ilvl:48,
    perk:"加长枪管 + 高膛压装药 · 枪口动能 +70%，要害伤害 +100%",
    affixes:[ { kind:"prefix", nm:"高膛压装药", mods:[{stat:"dmgPct",value:70},{stat:"critChance",value:15}] },
              { kind:"suffix", nm:"·精选批次", mods:[{stat:"critDmg",value:100},{stat:"projSpeed",value:40}] } ] },
  { id:"u_tsunami", name:"KS-23M 23×75 重型霰弹型", kind:"weapon", type:"shotgun", tier:8, elem:"none", ilvl:48,
    perk:"23×75 重弹头 · 枪口动能 +65%，后坐控制 +30%",
    affixes:[ { kind:"prefix", nm:"加重枪管", mods:[{stat:"dmgPct",value:65},{stat:"recoil",value:30}] },
              { kind:"suffix", nm:"·低后坐", mods:[{stat:"dmgPct",value:35}] } ] },
  // —— 护甲 / 头盔：现实装备型号 ——
  { id:"u_ritual", name:"6B23-1 附加插板", kind:"armor", tier:5,
    perk:"加装侧插板 · 减伤 +7%，耐久 +80%",
    affixes:[ { kind:"prefix", nm:"加固的", mods:[{stat:"dr",value:0.07}] },
              { kind:"suffix", nm:"·复合层压", mods:[{stat:"armor",value:80}] } ] },
  { id:"u_valkyr", name:"Fort Redut-M", kind:"armor", tier:6,
    perk:"全套插板 · 减伤 +8%，耐久 +100%",
    affixes:[ { kind:"prefix", nm:"陶瓷的", mods:[{stat:"dr",value:0.08}] },
              { kind:"suffix", nm:"·军用规格", mods:[{stat:"armor",value:100}] } ] },
  { id:"u_obsidian", name:"Zhuk-6a", kind:"armor", tier:7,
    perk:"多层陶瓷面板 · 减伤 +9%，耐久 +120%",
    affixes:[ { kind:"prefix", nm:"复合的", mods:[{stat:"dr",value:0.09}] },
              { kind:"suffix", nm:"·防弹插板", mods:[{stat:"armor",value:120}] } ] },
  { id:"u_singular", name:"6B43 6A 重型防弹衣", kind:"armor", tier:8,
    perk:"全防护配置 · 减伤 +10%，耐久 +140%",
    affixes:[ { kind:"prefix", nm:"重装的", mods:[{stat:"dr",value:0.10}] },
              { kind:"suffix", nm:"·重装规格", mods:[{stat:"armor",value:140}] } ] },
  { id:"u_watch", name:"Altyn 全罩头盔", kind:"helmet", tier:6,
    perk:"带面罩 · 爆头减伤 +8%，耐久 +100%",
    affixes:[ { kind:"prefix", nm:"密封的", mods:[{stat:"dr",value:0.08}] },
              { kind:"suffix", nm:"·钢制面罩", mods:[{stat:"armor",value:100}] } ] },
  { id:"u_ironveil", name:"Vulkan-5 面罩头盔", kind:"helmet", tier:8,
    perk:"钛合金面罩 · 爆头减伤 +10%，耐久 +130%",
    affixes:[ { kind:"prefix", nm:"加固的", mods:[{stat:"dr",value:0.10}] },
              { kind:"suffix", nm:"·钛合金", mods:[{stat:"armor",value:130}] } ] },
// —— v0.31.0 秘藏原型（改编传奇，T8）——
  { id:"bl_conference", name:"调度总机 · 12/70 分流型", kind:"weapon", type:"shotgun", tier:8, elem:"shock", ilvl:52,
    model:"Saiga-12K", legend:"bl", bindPart:"np_switch",
    perk:"分流枪口 · 一次抛出 14 枚弹丸并横向铺开，近距覆盖整条通道（单发合计见面板）",
    ov:{ pellets:14, dmgMul:0.70, spread:0.30, armorPen:0.34 },
    affixes:[ { kind:"prefix", nm:"分流膛口", mods:[{stat:"dmgPct",value:26},{stat:"magPct",value:20}] },
              { kind:"suffix", nm:"·调度批次", mods:[{stat:"reloadPct",value:22},{stat:"recoil",value:18}] } ] },
  { id:"bl_lyuda", name:"三向审查 · 7.62×54R 分裂型", kind:"weapon", type:"sniper", tier:8, elem:"none", ilvl:52,
    model:"SV-98", legend:"bl", bindPart:"np_prism",
    perk:"一发三裂 · 单发分裂为 3 枚弹头，扇形微张，中远距离仍能同时压住多个目标",
    ov:{ pellets:3, dmgMul:0.45, spread:0.035, armorPen:0.52 },
    affixes:[ { kind:"prefix", nm:"三棱膛线", mods:[{stat:"accPct",value:34},{stat:"projSpeed",value:30}] },
              { kind:"suffix", nm:"·审查批次", mods:[{stat:"critDmg",value:55},{stat:"range",value:18}] } ] },
  { id:"bl_infinity", name:"永动机构 · 9×19 无壳型", kind:"weapon", type:"smg", tier:8, elem:"cryo", ilvl:50,
    model:"PP-19-01 Vityaz", legend:"bl", bindPart:"np_loop",
    perk:"闭合供弹 · 弹匣不消耗，可持续压制；代价是单发装药下调与更长的散热间隔",
    ov:{ noAmmo:true, dmgMul:0.68, rpmMul:0.86, magMul:0.60 },
    affixes:[ { kind:"prefix", nm:"无壳弹链", mods:[{stat:"fireRatePct",value:22},{stat:"accPct",value:18}] },
              { kind:"suffix", nm:"·永动批次", mods:[{stat:"reloadPct",value:30},{stat:"moveSpeed",value:10}] } ] },
  { id:"bl_harold", name:"双联裁决 · 12.7×55 爆裂型", kind:"weapon", type:"pistol", tier:8, elem:"explosive", ilvl:52,
    model:"RSh-12", legend:"bl", bindPart:"np_dual",
    perk:"双联击发 · 每扣一次扳机打出 2 枚爆裂弹头，命中后小范围溅射",
    ov:{ pellets:2, dmgMul:0.78, splash:96, armorPen:0.40 },
    affixes:[ { kind:"prefix", nm:"双联击针", mods:[{stat:"dmgPct",value:32},{stat:"critChance",value:12}] },
              { kind:"suffix", nm:"·裁决批次", mods:[{stat:"splashDmg",value:28},{stat:"recoil",value:14}] } ] },
  { id:"bl_flakker", name:"空爆幕 · 23×75 空爆型", kind:"weapon", type:"shotgun", tier:8, elem:"explosive", ilvl:54,
    model:"KS-23M", legend:"bl", bindPart:"np_fuze",
    perk:"弹丸近炸 · 8 枚重弹头命中即空爆，清角落极强，但贴脸会伤到自己",
    ov:{ pellets:8, dmgMul:0.52, splash:148, spread:0.27, armorPen:0.30 },
    affixes:[ { kind:"prefix", nm:"近炸引信", mods:[{stat:"splashDmg",value:34},{stat:"dmgPct",value:20}] },
              { kind:"suffix", nm:"·幕射批次", mods:[{stat:"magPct",value:24},{stat:"reloadPct",value:18}] } ] },
  { id:"bl_swarm", name:"蜂群协议 · 5.45×39 穿甲型", kind:"weapon", type:"rifle", tier:8, elem:"shock", ilvl:54,
    model:"AK-12", legend:"bl", bindPart:"np_swarm",
    perk:"高导气射速 + 钢芯穿甲 · 持续泼洒穿透弹，对掩体后的目标照样有效",
    ov:{ rpmMul:1.24, dmgMul:0.80, armorPen:0.55, spread:0.095 },
    affixes:[ { kind:"prefix", nm:"蜂群导气", mods:[{stat:"fireRatePct",value:30},{stat:"pierce",value:2}] },
              { kind:"suffix", nm:"·协议批次", mods:[{stat:"magPct",value:38},{stat:"recoil",value:20}] } ] },
];

/* --------------------- 具名配件（v0.31.0 秘藏原型配套） ---------------------
 * 与 rollPart 产出的字段同构：slot / mods / affixes / rarity / ilvl。
 * 因此 partsAsAffixes、installPartOnGun、partChip 全都无需特判。
 * named:true 只用于「拆解后不可被普通重铸洗掉」的识别与面板金框。 */
const RAID_NAMED_PARTS = [
  { id:"np_switch", name:"「总机分流器」", shortName:"分流枪口", slot:"muzzle",     bindTo:"bl_conference",
    mods:[{stat:"pellets",value:3},{stat:"accPct",value:16}] },
  { id:"np_prism",  name:"「三棱分划镜」", shortName:"分划瞄具", slot:"scope",      bindTo:"bl_lyuda",
    mods:[{stat:"accPct",value:28},{stat:"critDmg",value:32}] },
  { id:"np_loop",   name:"「永动供弹环」", shortName:"闭合弹匣", slot:"mag",        bindTo:"bl_infinity",
    mods:[{stat:"magPct",value:30},{stat:"reloadPct",value:22}] },
  { id:"np_dual",   name:"「双联击发组」", shortName:"双联扳机", slot:"trigger",    bindTo:"bl_harold",
    mods:[{stat:"fireRatePct",value:18},{stat:"critChance",value:10}] },
  { id:"np_fuze",   name:"「空爆引信座」", shortName:"引信下挂", slot:"underbarrel",bindTo:"bl_flakker",
    mods:[{stat:"splashDmg",value:26},{stat:"dmgPct",value:12}] },
  { id:"np_swarm",  name:"「蜂群导气座」", shortName:"导气机匣", slot:"body",       bindTo:"bl_swarm",
    mods:[{stat:"fireRatePct",value:16},{stat:"pierce",value:1}] },
];
function raidMakeNamedPart(id){
  const d=RAID_NAMED_PARTS.find(p=>p.id===id);
  if(!d) return null;
  const mods=d.mods.map(m=>({ stat:m.stat, value:m.value }));
  return {
    uid:"np"+Date.now().toString(36)+Math.floor(Math.random()*9999).toString(36),
    kind:"part", named:true, bindTo:d.bindTo,
    slot:d.slot, name:d.name, shortName:d.shortName,
    rarity:"orange", ilvl:50, value:48000,
    mods, affixes:[{ kind:"prefix", nm:d.shortName, mods:[] }],
  };
}
function raidNamedPartFor(uniqueId){
  const d=RAID_NAMED_PARTS.find(p=>p.bindTo===uniqueId);
  return d ? raidMakeNamedPart(d.id) : null;
}
