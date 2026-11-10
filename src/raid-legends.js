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
    perk:"军规冷锻枪管，枪口动能 +30%，理论射速 +14%",
    affixes:[ { kind:"prefix", nm:"冷锻枪管", mods:[{stat:"dmgPct",value:30},{stat:"projSpeed",value:20}] },
              { kind:"suffix", nm:"·军用批次", mods:[{stat:"fireRatePct",value:14},{stat:"magPct",value:30}] } ] },
  { id:"u_humming", name:"PP-19-01 Vityaz 9×19 短突型", kind:"weapon", type:"pistol", tier:5, elem:"none", ilvl:28,
    perk:"轻量枪机，理论射速 +48%，换弹速度 +30%",
    affixes:[ { kind:"prefix", nm:"轻量枪机", mods:[{stat:"fireRatePct",value:48}] },
              { kind:"suffix", nm:"·快拔套", mods:[{stat:"magPct",value:35},{stat:"reloadPct",value:30}] } ] },
  { id:"u_butcher", name:"Saiga-12K 12/70 破门型", kind:"weapon", type:"shotgun", tier:5, elem:"none", ilvl:30,
    perk:"短管鹿弹配置，枪口动能 +46%，弹头初速 +18%",
    affixes:[ { kind:"prefix", nm:"加重枪管", mods:[{stat:"dmgPct",value:46}] },
              { kind:"suffix", nm:"·高初速", mods:[{stat:"projSpeed",value:18},{stat:"recoil",value:20}] } ] },
  { id:"u_plague", name:"MP5 9×19 消音型", kind:"weapon", type:"smg", tier:6, elem:"cryo", ilvl:36,
    perk:"一体消音器 + 亚音速弹，射击精度 +35%，有效射程 +20%",
    affixes:[ { kind:"prefix", nm:"精磨枪管", mods:[{stat:"accPct",value:35},{stat:"range",value:20}] },
              { kind:"suffix", nm:"·亚音速", mods:[{stat:"fireRatePct",value:16},{stat:"magPct",value:40}] } ] },
  { id:"u_fox", name:"HK 416A5 5.56×45 侦察型", kind:"weapon", type:"rifle", tier:6, elem:"none", ilvl:36,
    perk:"浮置枪管 + 光学座，射击精度 +40%，有效射程 +30%",
    affixes:[ { kind:"prefix", nm:"浮置枪管", mods:[{stat:"accPct",value:40},{stat:"range",value:30}] },
              { kind:"suffix", nm:"·归零", mods:[{stat:"dmgPct",value:22},{stat:"projSpeed",value:35}] } ] },
  { id:"u_guillotine", name:"SV-98 7.62×54R 精确型", kind:"weapon", type:"sniper", tier:7, elem:"shock", ilvl:42,
    perk:"比赛级枪管 + 钢芯弹，要害命中 +20%，要害伤害 +80%",
    affixes:[ { kind:"prefix", nm:"比赛级膛线", mods:[{stat:"dmgPct",value:55},{stat:"critChance",value:20}] },
              { kind:"suffix", nm:"·精修", mods:[{stat:"critDmg",value:80}] } ] },
  { id:"u_thousand", name:"RPK-16 5.45×39 轻机枪型", kind:"weapon", type:"rifle", tier:7, elem:"radiation", ilvl:42,
    perk:"重枪管 + 弹鼓，枪口动能 +35%，弹匣容量 +50%",
    affixes:[ { kind:"prefix", nm:"重枪管", mods:[{stat:"dmgPct",value:35},{stat:"magPct",value:50}] },
              { kind:"suffix", nm:"·大容量", mods:[{stat:"fireRatePct",value:12},{stat:"reloadPct",value:25}] } ] },
  { id:"u_thor", name:"ORSIS T-5000 .338 LM 远程型", kind:"weapon", type:"sniper", tier:8, elem:"shock", ilvl:48,
    perk:"加长枪管 + 高膛压装药，枪口动能 +70%，要害伤害 +100%",
    affixes:[ { kind:"prefix", nm:"高膛压装药", mods:[{stat:"dmgPct",value:70},{stat:"critChance",value:15}] },
              { kind:"suffix", nm:"·精选批次", mods:[{stat:"critDmg",value:100},{stat:"projSpeed",value:40}] } ] },
  { id:"u_tsunami", name:"KS-23M 23×75 重型霰弹型", kind:"weapon", type:"shotgun", tier:8, elem:"none", ilvl:48,
    perk:"23×75 重弹头，枪口动能 +65%，后坐控制 +30%",
    affixes:[ { kind:"prefix", nm:"加重枪管", mods:[{stat:"dmgPct",value:65},{stat:"recoil",value:30}] },
              { kind:"suffix", nm:"·低后坐", mods:[{stat:"dmgPct",value:35}] } ] },
  // —— 护甲 / 头盔：现实装备型号 ——
  { id:"u_ritual", name:"6B23-1 附加插板", kind:"armor", tier:5,
    perk:"加装侧插板，减伤 +7%，耐久 +80%",
    affixes:[ { kind:"prefix", nm:"加固的", mods:[{stat:"dr",value:0.07}] },
              { kind:"suffix", nm:"·复合层压", mods:[{stat:"armor",value:80}] } ] },
  { id:"u_valkyr", name:"Fort Redut-M", kind:"armor", tier:6,
    perk:"全套插板，减伤 +8%，耐久 +100%",
    affixes:[ { kind:"prefix", nm:"陶瓷的", mods:[{stat:"dr",value:0.08}] },
              { kind:"suffix", nm:"·军用规格", mods:[{stat:"armor",value:100}] } ] },
  { id:"u_obsidian", name:"Zhuk-6a", kind:"armor", tier:7,
    perk:"多层陶瓷面板，减伤 +9%，耐久 +120%",
    affixes:[ { kind:"prefix", nm:"复合的", mods:[{stat:"dr",value:0.09}] },
              { kind:"suffix", nm:"·防弹插板", mods:[{stat:"armor",value:120}] } ] },
  { id:"u_singular", name:"6B43 6A 重型防弹衣", kind:"armor", tier:8,
    perk:"全防护配置，减伤 +10%，耐久 +140%",
    affixes:[ { kind:"prefix", nm:"重装的", mods:[{stat:"dr",value:0.10}] },
              { kind:"suffix", nm:"·重装规格", mods:[{stat:"armor",value:140}] } ] },
  { id:"u_watch", name:"Altyn 全罩头盔", kind:"helmet", tier:6,
    perk:"带面罩，爆头减伤 +8%，耐久 +100%",
    affixes:[ { kind:"prefix", nm:"密封的", mods:[{stat:"dr",value:0.08}] },
              { kind:"suffix", nm:"·钢制面罩", mods:[{stat:"armor",value:100}] } ] },
  { id:"u_ironveil", name:"Vulkan-5 面罩头盔", kind:"helmet", tier:8,
    perk:"钛合金面罩，爆头减伤 +10%，耐久 +130%",
    affixes:[ { kind:"prefix", nm:"加固的", mods:[{stat:"dr",value:0.10}] },
              { kind:"suffix", nm:"·钛合金", mods:[{stat:"armor",value:130}] } ] },
// —— v0.31.0 秘藏原型（改编传奇，T8）——
  { id:"bl_conference", name:"调度总机 · 12/70 分流型", kind:"weapon", type:"shotgun", tier:8, elem:"shock", ilvl:52,
    model:"Saiga-12K", legend:"bl", bindPart:"np_switch",
    perk:"分流枪口，一次抛出 14 枚弹丸并横向铺开，近距覆盖整条通道（单发合计见面板）",
    ov:{ pellets:14, dmgMul:0.70, spread:0.30, armorPen:0.34 },
    affixes:[ { kind:"prefix", nm:"分流膛口", mods:[{stat:"dmgPct",value:26},{stat:"magPct",value:20}] },
              { kind:"suffix", nm:"·调度批次", mods:[{stat:"reloadPct",value:22},{stat:"recoil",value:18}] } ] },
  { id:"bl_lyuda", name:"三向审查 · 7.62×54R 分裂型", kind:"weapon", type:"sniper", tier:8, elem:"none", ilvl:52,
    model:"SV-98", legend:"bl", bindPart:"np_prism",
    perk:"一发三裂，单发分裂为 3 枚弹头，扇形微张，中远距离仍能同时压住多个目标",
    ov:{ pellets:3, dmgMul:0.45, spread:0.035, armorPen:0.52 },
    affixes:[ { kind:"prefix", nm:"三棱膛线", mods:[{stat:"accPct",value:34},{stat:"projSpeed",value:30}] },
              { kind:"suffix", nm:"·审查批次", mods:[{stat:"critDmg",value:55},{stat:"range",value:18}] } ] },
  { id:"bl_infinity", name:"永动机构 · 9×19 无壳型", kind:"weapon", type:"smg", tier:8, elem:"cryo", ilvl:50,
    model:"PP-19-01 Vityaz", legend:"bl", bindPart:"np_loop",
    perk:"闭合供弹，弹匣不消耗，可持续压制；代价是单发装药下调与更长的散热间隔",
    ov:{ noAmmo:true, dmgMul:0.68, rpmMul:0.86, magMul:0.60 },
    affixes:[ { kind:"prefix", nm:"无壳弹链", mods:[{stat:"fireRatePct",value:22},{stat:"accPct",value:18}] },
              { kind:"suffix", nm:"·永动批次", mods:[{stat:"reloadPct",value:30},{stat:"moveSpeed",value:10}] } ] },
  { id:"bl_harold", name:"双联裁决 · 12.7×55 爆裂型", kind:"weapon", type:"pistol", tier:8, elem:"explosive", ilvl:52,
    model:"RSh-12", legend:"bl", bindPart:"np_dual",
    perk:"双联击发，每扣一次扳机打出 2 枚爆裂弹头，命中后小范围溅射",
    ov:{ pellets:2, dmgMul:0.78, splash:96, armorPen:0.40 },
    affixes:[ { kind:"prefix", nm:"双联击针", mods:[{stat:"dmgPct",value:32},{stat:"critChance",value:12}] },
              { kind:"suffix", nm:"·裁决批次", mods:[{stat:"splashDmg",value:28},{stat:"recoil",value:14}] } ] },
  { id:"bl_flakker", name:"空爆幕 · 23×75 空爆型", kind:"weapon", type:"shotgun", tier:8, elem:"explosive", ilvl:54,
    model:"KS-23M", legend:"bl", bindPart:"np_fuze",
    perk:"弹丸近炸，8 枚重弹头命中即空爆，清角落极强，但贴脸会伤到自己",
    ov:{ pellets:8, dmgMul:0.52, splash:148, spread:0.27, armorPen:0.30 },
    affixes:[ { kind:"prefix", nm:"近炸引信", mods:[{stat:"splashDmg",value:34},{stat:"dmgPct",value:20}] },
              { kind:"suffix", nm:"·幕射批次", mods:[{stat:"magPct",value:24},{stat:"reloadPct",value:18}] } ] },
  { id:"bl_swarm", name:"蜂群协议 · 5.45×39 穿甲型", kind:"weapon", type:"rifle", tier:8, elem:"shock", ilvl:54,
    model:"AK-12", legend:"bl", bindPart:"np_swarm",
    perk:"高导气射速 + 钢芯穿甲，持续泼洒穿透弹，对掩体后的目标照样有效",
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

/* =========================================================================
 * v0.40.0 — 回收超市「收购单」品类表
 *
 * 用户要求：回收超市只收**指定品类**（不再是自由选择），但收购价给到估价的 2~3 倍。
 * mul 是倍率区间、left 是该品类本摊位的**收购件数上限** —— 上限是这套设计的关键：
 * 局内商店 0.8× 买、回收 2~3× 卖，如果无限收就是无限刷钱；限量之后搬砖有天花板。
 * 表放这个文件是因为 raid-data.js 只剩 9 行、raid-core2 只剩 20 行。
 * ========================================================================= */
const RAID_REC_WANTS = [
  { cat:"weapon",   label:"枪械",           mul:[2.0,2.6], left:[1,1] },
  { cat:"part",     label:"配件 / 改装模块", mul:[2.2,3.0], left:[2,3] },
  { cat:"material", label:"原材料",          mul:[2.4,3.0], left:[4,6] },
  { cat:"med",      label:"医疗品",          mul:[2.6,3.0], left:[3,5] },
  { cat:"gear",     label:"护甲 / 头盔 / 护盾", mul:[2.0,2.8], left:[1,2] },
  { cat:"key",      label:"钥匙",            mul:[2.2,2.8], left:[1,2] },
];
/* 收购单里某个品类当前还能收几件；没有该品类返回 0 */
function raidRecWant(sh, cat){
  const ws=(sh && sh.wants)||[];
  for(const w of ws){ if(w.cat===cat) return w; }
  return null;
}


/* =========================================================================
 * v0.39.0 — 局外契约（击杀指标 / 搜刮配额）+ 阵亡装备限时赎回
 *
 * 为什么放这个文件：契约的奖励载体就是上面的 RAID_UNIQUES 具名装备表；
 * 而 raid-data.js 只剩 1 行、raid-core3 只剩 4 行，这里还有 150 多行余量。
 *
 * 存档只往 stash 上挂两个**可选字段**（contract / buyback），不参与 RaidStash.load
 * 的迁移白名单 —— 旧档没有这两个字段就是「没有契约 / 没有待赎回」，天然向后兼容。
 * ========================================================================= */
const RAID_CONTRACT_HOURS = 24;     // 契约与待赎回装备的有效期
const RAID_BUYBACK_RATE   = 3.0;    // 赎回价 = 装备估值 ×300%（比重新买一件更贵，但胜在确定）

/* v0.40.0（用户要求）：契约扩到 6 种任务类型，奖励改成**显式可读的具体物品**，
 * 完成即刻刷新下一批，且「越做越难」（难度与奖励都随完成数抬）。
 *
 * 判定全部落在引擎已有的两个 hook 上（_onBotDeath / 撤离结算），不新增结算分支：
 *   boss / elite / scav → _onBotDeath 里按 victim 分类
 *   extract / money / time → 撤离成功那一次按背包件数 / 局内现金 / 存活时长
 * need 与奖励都由「UTC 天数 + 已完成数」决定，所以同一玩家重开、联机两端都一致。 */
const RAID_CONTRACT_KINDS = {
  boss:    { name:"猎杀", base:1,     step:1,     title:(n)=>"击杀 "+n+" 名封锁区指挥官", desc:"Boss 在地图上以黄色标记显示，3 名同时在场" },
  elite:   { name:"清剿", base:2,     step:1,     title:(n)=>"击杀 "+n+" 名精锐（★）",       desc:"POI 精英与名字带 ★ 的 Raider 都算" },
  scav:    { name:"清扫", base:5,     step:2,     title:(n)=>"击杀 "+n+" 名 Scav",           desc:"拾荒者数量最多，多在建筑群外围游荡" },
  extract: { name:"搜刮", base:5,     step:2,     title:(n)=>"带出 "+n+" 件战利品",           desc:"只统计成功撤离的那一趟，装备/配件/材料/钥匙都算" },
  money:   { name:"运货", base:20000, step:12000, title:(n)=>"单局带出 ₽"+n+" 现金",          desc:"撤离那一刻手上的局内卢布要够这个数" },
  time:    { name:"死守", base:240,   step:45,    title:(n)=>"存活 "+Math.floor(n/60)+" 分 "+(n%60)+" 秒后撤离", desc:"在本局撑到这个时间再走" },
};
const RAID_CONTRACT_ORDER = ["boss","elite","scav","extract","money","time"];

/* 用固定种子跑一段会用到 RNG 的生成（不污染主随机流 —— 联机两端结算必须一致） */
function raidSeeded(seed, fn){
  const prev=RNG.rng;
  const snap=(typeof RNG.snapshot==="function")?RNG.snapshot():null;
  RNG.setSeed((seed>>>0)||1);
  try{ return fn(); }
  finally{
    RNG.rng=prev;
    if(snap!==null && typeof RNG.restoreSnap==="function") RNG.restoreSnap(snap);
  }
}

/* 奖励真身：给什么就写着什么，不做「集齐折现」这种模糊承诺。
 * 每种都返回 { type, label, give(stash) }，label 直接上大厅界面。 */
function raidContractRewardFor(kind, seed, scale){
  const s=Math.max(1, scale||1);
  return raidSeeded(seed, ()=>{
    /* 加权：具名装备偏少但存在，材料 / 弹药 / 卢布为主，保证「看得见的收益」 */
    const roll=RNG.f();
    if(roll<0.22){
      const pool=RAID_UNIQUES.filter(u=>u.kind==="weapon");
      const u=pool[RNG.ri(0,pool.length-1)];
      return { type:"uniqGun", name:u.name, label:"具名枪「"+u.name+"」",
        give:(st)=>{ const w=raidMakeUnique(u); st.weapons.push(w); return w.name; } };
    }
    if(roll<0.40){
      const pool=RAID_NAMED_PARTS;
      const d=pool[RNG.ri(0,pool.length-1)];
      return { type:"uniqPart", name:d.name, label:"具名配件"+d.name,
        give:(st)=>{ const pt=raidMakeNamedPart(d.id); st.parts=st.parts||[]; st.parts.push(pt); return pt.name; } };
    }
    if(roll<0.62){
      const pool=RAID_MATERIALS.filter(x=>x.tier>=5);
      const pickPool=pool.length?pool:RAID_MATERIALS;
      const m=pickPool[RNG.ri(0,pickPool.length-1)];
      const n=Math.round((4+RNG.ri(0,3))*s);
      return { type:"material", id:m.id, n, label:"原材料「"+m.name+"」×"+n,
        give:(st)=>{ st.materials=st.materials||[];
          for(let i=0;i<n;i++) st.materials.push(Object.assign({},m,{n:1}));
          return m.name+" ×"+n; } };
    }
    if(roll<0.80){
      const cal=RNG.pick(["light","mid","heavy"]);
      const lv=3+RNG.ri(1,2);                     // T4 / T5 高级弹
      const d=ammoDef(cal, lv);
      const n=Math.round(60*s/10)*10;
      return { type:"ammo", id:d.id, n, label:"弹药「"+d.name+"」×"+n,
        give:(st)=>{ st.ammo=st.ammo||{}; st.ammo[d.id]=(st.ammo[d.id]||0)+n; return d.name+" ×"+n; } };
    }
    if(roll<0.92){
      const lv=3+RNG.ri(0,2);
      return { type:"key", lv, label:"「"+RAID_LOCK_NAME[lv]+"钥匙」×1",
        give:(st)=>{ st.keys=st.keys||[]; const k=raidMakeKey(lv); st.keys.push(k); return k.name; } };
    }
    const amount=Math.round((30000+RNG.ri(0,20000))*s/1000)*1000;
    return { type:"creds", amount, label:"卢布 ₽"+amount,
      give:(st)=>{ st.creds=(st.creds||0)+amount; return "₽"+amount; } };
  });
}

/* 难度：完成得越多需求越高（每 2 单抬一档），奖励同步放大（每单 +12%，封顶 2.5 倍） */
function raidContractTier(done){ return 1+Math.floor((done||0)/2); }
function raidContractRewardScale(done){ return Math.min(2.5, 1+(done||0)*0.12); }

/* 当前可接的报价：3 条不同种类，种子 =「天数 + 已完成数」→ 完成即刻换成新的一批 */
function raidContractOffers(now, done){
  const t=Number(now)||Date.now();
  const day=Math.floor(t/86400000);
  const d=done||0;
  const tier=raidContractTier(d), scale=raidContractRewardScale(d);
  const list=[];
  for(let i=0;i<3;i++){
    /* +d*5：每完成一单整体换组（5 与 6 互质，6 单内轮完整个种类表） */
    const kind=RAID_CONTRACT_ORDER[(day*3+i+d*5)%RAID_CONTRACT_ORDER.length];
    const kd=RAID_CONTRACT_KINDS[kind];
    const need=kd.base + kd.step*(tier-1);
    const seed=raidDealSeed("contract-"+kind, day+d*97, tier);
    const reward=raidContractRewardFor(kind, seed, scale);
    list.push({ id:kind+"-"+day+"-"+d, kind, need, tier, progress:0, at:t,
      title:kd.title(need), desc:kd.desc, name:kd.name,
      reward:{ type:reward.type, label:reward.label, seed } });
  }
  return list;
}
function raidContractActive(stash, now){
  const c=stash && stash.contract;
  if(!c || !c.id) return null;
  if((Number(now)||Date.now())-c.at > RAID_CONTRACT_HOURS*3600000){ stash.contract=null; return null; }
  return c;
}
function raidContractAccept(stash, offer, now){
  if(!stash || !offer) return false;
  stash.contract={ id:offer.id, kind:offer.kind, need:offer.need, tier:offer.tier||1, progress:0,
    at:Number(now)||Date.now(), title:offer.title, desc:offer.desc, name:offer.name,
    reward:offer.reward||null };
  return true;
}
function raidContractAbandon(stash){ if(stash) stash.contract=null; }

/* 发奖：按契约上**写明的**那份奖励发放（种子可复算 → 接单看到什么就拿到什么）。
 * 没有任何「集齐后折现」兜底 —— 用户明确要求奖励必须是具体物品。 */
function raidContractGrant(stash, contract){
  if(!stash) return null;
  const c=contract||stash.contract||{};
  const seed=(c.reward && c.reward.seed) || raidDealSeed("contract-"+(c.kind||"boss"), 0, 1);
  const got=raidContractRewardFor(c.kind||"boss", seed, raidContractRewardScale(stash.contractDone));
  const name=got.give(stash);
  return { kind:got.type, name:name||got.label, label:got.label, perk:"" };
}

/* 进度推进。done 的那次会发奖，并让 contractDone +1 → 报价与难度都刷新。 */
function raidContractProgress(stash, kind, n){
  const c=raidContractActive(stash, Date.now());
  if(!c || c.kind!==kind) return { done:false };
  /* money / time 是「单局阈值」型：只认最好的一次，不能跨局累加（否则攒钱也算完成） */
  if(kind==="money" || kind==="time") c.progress=Math.max(c.progress||0, Math.min(c.need, Math.round(n||0)));
  else c.progress=Math.min(c.need, (c.progress||0)+(n||1));
  if(c.progress<c.need) return { done:false };
  const grant=raidContractGrant(stash, c);
  stash.contractDone=(stash.contractDone||0)+1;
  stash.contract=null;
  return { done:true, grant, doneCount:stash.contractDone };
}

/* ---- 阵亡装备限时赎回 ----
 * 投保之后仍然「没人捡走」那 35% 里的装备，进赎回池：24 小时内按估值 300% 买回来。
 * 保险因此从「纯赌运气」变成「65% 免费退回 / 35% 付钱赎回」，阵亡的挫败感有了出口。 */
function raidBuybackAdd(stash, items, now){
  if(!stash || !items || !items.length) return 0;
  const t=Number(now)||Date.now();
  stash.buyback=raidBuybackList(stash, t);          // 先按 24h 清掉过期项
  let n=0;
  for(const it of items){
    if(!it || !it.kind) continue;
    if((it.value||0)<=0) continue;
    stash.buyback.push({ at:t, price:Math.round((it.value||0)*RAID_BUYBACK_RATE), item:it });
    n++;
  }
  if(stash.buyback.length>40) stash.buyback=stash.buyback.slice(-40);
  return n;
}
/* 取出仍在有效期内的待赎清单（顺手清掉过期项，不写盘 —— 调用方负责 save） */
function raidBuybackList(stash, now){
  const t=Number(now)||Date.now();
  const live=[];
  for(const b of (stash && stash.buyback) || []){
    if(!b || !b.item) continue;
    if(t-b.at > RAID_CONTRACT_HOURS*3600000) continue;
    live.push(b);
  }
  return live;
}
function raidBuybackBuy(stash, idx, now){
  const live=raidBuybackList(stash, now);
  const b=live[idx];
  if(!b) return { ok:false, msg:"这件已经过期或不存在" };
  if((stash.creds||0) < b.price) return { ok:false, msg:"卢布不足 ₽"+b.price };
  stash.creds-=b.price;
  const it=b.item;
  if(it.kind==="weapon") stash.weapons.push(it);
  else if(it.kind==="helmet") stash.helmets.push(it);
  else if(it.kind==="shield"){ stash.shields=stash.shields||[]; stash.shields.push(it); }
  else stash.armors.push(it);
  stash.buyback=(stash.buyback||[]).filter(x=>x!==b);
  return { ok:true, item:it };
}
