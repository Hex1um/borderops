/* =========================================================================
 * raid-data.js — 数据表 / 顶层工具函数 / RaidStash 仓库持久化
 * v0.22.0：由 raid.js 按自然边界物理拆分，逻辑零改写。经典脚本按 index.html 顺序加载，
 * 共享同一全局词法作用域。verify 的 raidSrc 会聚合全部 raid-*.js 做源码断言。
 * ========================================================================= */
/* =========================================================================
 * raid.js — 塔科夫模式（Escape from Tarkov 风格离线突袭）
 *
 * 参考《逃离塔科夫》玩法：
 *   · 硬核撤离射击：地图「海关流域」（工业区 + 北境密林 + 中央河谷 + 铁路枢纽），
 *     PMC 与 Scav 同场（本页用 1 名玩家 + 33 名 AI 模拟满员服务器：30 名普通 AI + 3 名 Boss）；河流可涉水缓行，桥面免减速
 *   · 开局可携带仓库里的装备，也可真空手进场（只带 1 卷绷带，进图翻箱捡枪）
 *   · 中弹会流血，需要绷带止血（桌面 H 键 / 移动端医疗键）
 *   · 撤离点条件化：铁路隧道每局随机开放、旧卡车常驻、雇车撤离费按带入装备估值浮动
 *   · 上锁保险箱分 I~V 级，须用同级钥匙开启（钥匙有使用次数，可买 / 可掉落 / 工坊 16 份材料合成）
 *   · 可在配装时为携带装备购买保险，阵亡后有几率被退回仓库
 *   · 只有撤离成功，身上的装备与战利品才写回仓库；阵亡或超时未撤离，全部丢失
 *   · 左上角实时击杀提示（Kill Feed）
 *
 * 依赖：util.js(M/RNG/rgba/SFX)、input.js(Input)；渲染走 RenderRaid。
 * ========================================================================= */

/* ----------------------------- 地图 / 房间 ----------------------------- */
// 三大生态区（树林、河流、铁路），不再只有海关工业集群。
const RAID_MAP_W = 13000, RAID_MAP_H = 9600;

/* v0.14.10 元素克制 / 防护类型：
 *   T4+ 护甲 → 装甲型（黄色血条，被腐蚀克制）；有护盾值 → 护盾型（被电击克制）；其余 → 血肉型（被火焰/冰冻克制）。
 *   血条颜色即「目标类型」，让玩家一眼判断该换哪把元素枪。 */
const RAID_ARMOR_TYPE_TIER = 4;
const HELMET_BODY_SHARE = 0.40;   // 头盔对非爆头伤害只贡献 40% 减伤系数，爆头时全额
const FREEZE_SLOW = 0.45;         // 冰冻时的位移倍率

/* v0.14.11 元素持续效果参数（倍率之外的玩法差异） */
const BURN_DPS_RATE = 0.06;       // 灼烧每秒伤害 = 本次命中「克制后」伤害 × 6%
const BURN_ADD = 2.0;             // 每次命中叠加 2 秒
const BURN_CAP = 4.5;             // 灼烧最长 4.5 秒（约 27% 额外伤害）
const CORRODE_BITE = 0.35;        // 腐蚀立刻啃掉「命中伤害 × 35%」的护甲耐久
const CORRODE_TIME = 3.0;         // 破甲 debuff 持续时间
const CORRODE_DR = 0.75;          // 破甲期间护甲减伤打七五折
const SHOCK_TIME = 1.6;           // 电击干扰持续
const SHOCK_FIRE_CD = 0.25;       // 干扰期间最短开火间隔
const RAD_RADIUS = 150, RAD_FACTOR = 0.5, RAD_MAX = 4;  // 辐射连锁范围 / 伤害系数 / 最多目标

function raidArmorType(o){
  if(!o) return "flesh";
  if(o.shield>0) return "shield";
  // v0.14.11：护甲耐久打穿后回归血肉型（黄条转红、不再被腐蚀克制）。
  // undefined 视为「有甲」，兼容没有耐久字段的精简对象。
  if((o.armorTier||0)>=RAID_ARMOR_TYPE_TIER && (o.armor===undefined || o.armor>0)) return "armor";
  return "flesh";
}

// 房间沿用塔科夫「海关」地图风格的命名与相对位置
const RAID_ROOMS = [
  { id:"dorm",   name:"宿舍楼",       x:140,  y:170,  w:340, h:250, tint:"#3a3550" },
  { id:"west",   name:"西侧检查站",   x:140,  y:660,  w:300, h:260, tint:"#3a3030" },
  { id:"living", name:"宿舍二号楼",   x:520,  y:640,  w:340, h:300, tint:"#43363a" },
  { id:"ctrl",   name:"工程部",       x:920,  y:110,  w:460, h:300, tint:"#39434f" },
  { id:"core",   name:"海关办公室",   x:1000, y:720,  w:480, h:340, tint:"#33333f" },
  { id:"hoist",  name:"三号仓库",     x:1720, y:150,  w:300, h:250, tint:"#43394a" },
  { id:"assem",  name:"坦克修理厂",   x:2040, y:150,  w:320, h:250, tint:"#3a4a44" },
  { id:"print",  name:"加油站",       x:2040, y:450,  w:320, h:200, tint:"#3a4055" },
  { id:"hoist2", name:"二号仓库",     x:1560, y:640,  w:260, h:220, tint:"#43394a" },
  { id:"ebridge",name:"铁路桥",       x:1700, y:930,  w:300, h:150, tint:"#3a3a3a" },
  { id:"launch", name:"卡车停车场",   x:320,  y:1280, w:360, h:280, tint:"#3a3040" },
  { id:"test",   name:"水泥厂",       x:1200, y:1140, w:440, h:320, tint:"#3a4242" },
  { id:"rope",   name:"工地",         x:1740, y:1340, w:320, h:260, tint:"#3a3a30" },
  // —— 扩建区（地图从 2480×2080 扩到 3500×2900）——
  { id:"dorm2",  name:"宿舍三号楼",   x:140,  y:1000, w:320, h:260, tint:"#3a3550" },
  { id:"gasS",   name:"加油站南站",   x:520,  y:1000, w:300, h:220, tint:"#3a4055" },
  { id:"cross",  name:"十字路口",     x:560,  y:1900, w:320, h:240, tint:"#3a3a3a" },
  { id:"yard",   name:"集装箱堆场",   x:960,  y:1860, w:420, h:280, tint:"#43394a" },
  { id:"mill",   name:"锯木厂",       x:1180, y:2200, w:380, h:260, tint:"#4a3f30" },
  { id:"farm",   name:"农庄",         x:1900, y:1900, w:380, h:260, tint:"#3a4a38" },
  { id:"depot",  name:"军械库",       x:1560, y:1660, w:360, h:240, tint:"#43394a" },
  { id:"tower",  name:"瞭望塔",       x:2560, y:760,  w:260, h:240, tint:"#3a3a48" },
  { id:"tunnel", name:"地下通道",     x:2560, y:1200, w:320, h:220, tint:"#2e2e38" },
  { id:"scrap",  name:"废料场",       x:2900, y:1700, w:340, h:260, tint:"#3f3a30" },
  // —— 撤离点 ——
  { id:"extA",   name:"撤离点·铁路隧道", x:2100, y:760,  w:300, h:220, tint:"#22462f", extract:true },
  { id:"extB",   name:"撤离点·旧卡车",   x:1240, y:1580, w:320, h:220, tint:"#22462f", extract:true },
  { id:"extC",   name:"撤离点·V-EX 雇车", x:150,  y:450,  w:280, h:180, tint:"#22462f", extract:true },
  { id:"extD",   name:"撤离点·沼泽小径", x:2950, y:2300, w:320, h:240, tint:"#22462f", extract:true },
  { id:"extE",   name:"撤离点·林间空投", x:620,  y:2500, w:300, h:220, tint:"#22462f", extract:true },
  // —— 扩建区（地图扩到 4400×3600，新增东部/南部据点）——
  { id:"factory",name:"机械工厂",   x:3360, y:380,  w:380, h:300, tint:"#3a4a44" },
  { id:"sawmill",name:"东锯木厂",   x:3360, y:1850, w:340, h:260, tint:"#4a3f30" },
  { id:"village",name:"废弃村庄",   x:3500, y:1300, w:360, h:280, tint:"#3a4a38" },
  { id:"dock",   name:"东码头",     x:3720, y:2250, w:420, h:300, tint:"#2e3a44" },
  { id:"ranch",  name:"南部牧场",   x:2020, y:2960, w:400, h:300, tint:"#3a4a38" },
  { id:"temple", name:"古神庙",     x:980,  y:3000, w:360, h:300, tint:"#43364a" },
  // 新增撤离点（总 8 个，含付费/随机开放）
  { id:"extF",   name:"撤离点·东港",     x:4040, y:1500, w:300, h:220, tint:"#22462f", extract:true },
  { id:"extG",   name:"撤离点·南岸哨站", x:2000, y:3320, w:340, h:220, tint:"#22462f", extract:true },
  { id:"extH",   name:"撤离点·北关检查", x:2450, y:200,  w:320, h:200, tint:"#22462f", extract:true },
  // —— 东部 / 南部大区（地图扩到 7000×5600）——
  { id:"nx1",  name:"北岭哨所",   x:4520, y:230,  w:360, h:270, tint:"#3a3030" },
  { id:"nx2",  name:"炼油厂",     x:4980, y:180,  w:470, h:340, tint:"#3f3a30" },
  { id:"nx3",  name:"铁路调度站", x:5570, y:240,  w:400, h:290, tint:"#3a3a3a" },
  { id:"nx4",  name:"东岭军营",   x:6110, y:200,  w:420, h:320, tint:"#3a4a44" },
  { id:"nx5",  name:"通讯塔",     x:4560, y:840,  w:300, h:250, tint:"#39434f" },
  { id:"nx6",  name:"化学工厂",   x:5020, y:780,  w:480, h:330, tint:"#3a4a44" },
  { id:"nx7",  name:"集装箱码头", x:5680, y:820,  w:420, h:290, tint:"#43394a" },
  { id:"nx8",  name:"海关大楼",   x:6240, y:760,  w:400, h:320, tint:"#33333f" },
  { id:"nx9",  name:"南部新村",   x:4600, y:1820, w:400, h:290, tint:"#3a4a38" },
  { id:"nx10", name:"采石场",     x:5180, y:1780, w:460, h:330, tint:"#3a4242" },
  { id:"nx11", name:"油罐区",     x:5800, y:1840, w:380, h:290, tint:"#3f3a30" },
  { id:"nx12", name:"东岭要塞",   x:6340, y:1800, w:440, h:350, tint:"#43394a" },
  { id:"nx13", name:"废弃医院",   x:4680, y:2720, w:420, h:330, tint:"#3a4055" },
  { id:"nx14", name:"地下掩体",   x:5300, y:2760, w:360, h:290, tint:"#2e2e38" },
  { id:"nx15", name:"弹药库",     x:5920, y:2720, w:400, h:310, tint:"#43394a" },
  { id:"nx16", name:"南岭矿洞",   x:5200, y:3720, w:420, h:330, tint:"#3f3a30" },
  { id:"nx17", name:"东部农场",   x:5900, y:3720, w:440, h:310, tint:"#3a4a38" },
  { id:"nx18", name:"旧教堂",     x:4680, y:3720, w:340, h:290, tint:"#43364a" },
  { id:"nx19", name:"南港仓库",   x:5300, y:4620, w:460, h:330, tint:"#2e3a44" },
  { id:"nx20", name:"南岸灯塔",   x:6120, y:4620, w:340, h:290, tint:"#2e3a44" },
  { id:"ny1",  name:"铁路涵洞",   x:4200, y:2600, w:300, h:240, tint:"#2e2e38" },
  { id:"ny2",  name:"东部检查站", x:4060, y:3620, w:320, h:260, tint:"#3a3030" },
  { id:"extI", name:"撤离点·东岭索道", x:6700, y:1320, w:270, h:230, tint:"#22462f", extract:true },
  { id:"extJ", name:"撤离点·南港货轮", x:6660, y:4820, w:300, h:230, tint:"#22462f", extract:true },
  { id:"extK", name:"撤离点·医院天台", x:4900, y:3130, w:260, h:200, tint:"#22462f", extract:true },
  // —— 生态扩张：北境密林 / 中央河谷 / 铁路枢纽 ——
  { id:"fWatch", name:"林间哨站",     x:7100, y:700,  w:320, h:240, tint:"#2e3a2c" },
  { id:"fMill",  name:"伐木场",       x:7400, y:2050, w:360, h:260, tint:"#3a3326" },
  { id:"fRanger",name:"护林站",       x:7100, y:5200, w:340, h:260, tint:"#2e3a2c" },
  { id:"fCamp",  name:"林间营地",     x:7300, y:7700, w:380, h:280, tint:"#343a2c" },
  { id:"fHunt",  name:"猎人小屋",     x:7100, y:8600, w:320, h:240, tint:"#2e3a2c" },
  { id:"fDepot", name:"机车段",       x:7400, y:5488, w:360, h:260, tint:"#3a3a3a" },
  { id:"fNBridge",name:"北桥检查站",   x:7600, y:1700, w:300, h:210, tint:"#2e3a3a" },
  { id:"fSBridge",name:"南桥营地",     x:7700, y:8000, w:320, h:220, tint:"#2e3a3a" },
  { id:"rTower", name:"瞭望木塔",     x:10800,y:2300, w:260, h:240, tint:"#39434f" },
  { id:"rHydro", name:"水电站",       x:9700, y:6000, w:380, h:280, tint:"#26323a" },
  { id:"rStation",name:"火车站",      x:11400,y:5050, w:420, h:300, tint:"#33383e" },
  { id:"rFreight",name:"货运站",      x:11450,y:6900, w:400, h:300, tint:"#33383e" },
  { id:"rCtrl",  name:"调度中心",     x:11800,y:7400, w:360, h:260, tint:"#39434f" },
  { id:"rExpl",  name:"硝石炸药库",   x:11800,y:5400, w:320, h:240, tint:"#3a3030" },
  { id:"rYard",  name:"货运栈道",     x:10600,y:8200, w:360, h:260, tint:"#2e3a44" },
  { id:"rDock",  name:"河港码头",     x:9700, y:7700, w:400, h:300, tint:"#2e3a44" },
  // 新生态区撤离点
  { id:"extL", name:"撤离点·林间空投", x:7300, y:7998, w:300, h:220, tint:"#22462f", extract:true },
  { id:"extM", name:"撤离点·山顶缆车", x:10800,y:2558, w:280, h:200, tint:"#22462f", extract:true },
  { id:"extN", name:"撤离点·河港渡轮", x:9700, y:8018, w:300, h:220, tint:"#22462f", extract:true },
  { id:"extO", name:"撤离点·火车站台", x:11400,y:5368, w:280, h:200, tint:"#22462f", extract:true },
  { id:"extP", name:"撤离点·北桥栈道", x:7778, y:2050, w:260, h:180, tint:"#22462f", extract:true },
  { id:"extQ", name:"撤离点·货运专线", x:10700,y:8300, w:280, h:200, tint:"#22462f", extract:true },
  { id:"extR", name:"撤离点·南岭索道", x:11800,y:7678, w:260, h:200, tint:"#22462f", extract:true },
  // —— 西南开发区：监狱 / 小镇 / 大坝（填补 x<4500 · y>4500 的大片空白）——
  { id:"prisonYard", name:"监狱操场",   x:1150, y:5250, w:900, h:620, tint:"#2f3238", open:true },
  { id:"prisonA", name:"监狱主楼",     x:1180, y:4850, w:460, h:300, tint:"#3a3a44" },
  { id:"prisonB", name:"狱警办公楼",   x:1720, y:4850, w:300, h:260, tint:"#3f3a42" },
  { id:"prisonC", name:"监狱医务室",   x:1720, y:5250, w:240, h:200, tint:"#3a4055" },
  { id:"prisonT", name:"监狱岗楼",     x:2100, y:5620, w:180, h:180, tint:"#33333f" },
  { id:"townSq",  name:"小镇广场",     x:1750, y:7050, w:760, h:420, tint:"#30322e", open:true },
  { id:"townHall",name:"镇政厅",       x:1700, y:6750, w:340, h:260, tint:"#3a4a44" },
  { id:"townShop",name:"杂货店",       x:2080, y:6750, w:220, h:180, tint:"#43394a" },
  { id:"townH1",  name:"民宅一号",     x:1700, y:7500, w:170, h:150, tint:"#3a3a34" },
  { id:"townH2",  name:"民宅二号",     x:1900, y:7500, w:170, h:150, tint:"#3a3a34" },
  { id:"townH3",  name:"民宅三号",     x:2100, y:7500, w:170, h:150, tint:"#3a3a34" },
  { id:"townH4",  name:"民宅四号",     x:2300, y:7500, w:170, h:150, tint:"#3a3a34" },
  { id:"townChurch",name:"小镇教堂",   x:2340, y:6750, w:240, h:270, tint:"#43364a" },
  { id:"damCtrl", name:"大坝控制室",   x:3150, y:8520, w:280, h:200, tint:"#2e3a44" },
  { id:"damGate", name:"大坝闸室",     x:3480, y:8580, w:200, h:170, tint:"#39434f" },
  { id:"quarry",  name:"采石场",       x:3520, y:6480, w:420, h:320, tint:"#3a4242" },
  { id:"gasSW",   name:"西南加油站",   x:1260, y:6480, w:280, h:220, tint:"#3a4055" },
  { id:"extS",    name:"撤离点·大坝坝顶", x:3300, y:8180, w:300, h:220, tint:"#22462f", extract:true },
];

// 三大生态区布局（树林 / 河流 / 铁路）。全部为确定性生成，联机两端完全一致。
// 河流以中心线 + 半宽表示，按段离散成「水圆」用于碰撞与渲染；此后河面可缓慢涉水（停留过久失温扣血），桥面（8 座，含 3 座大桥）完全免减速。
const RAID_BIOMES = {
  forest: [
    { x:7000, y:200,  w:2300, h:1500 }, { x:9400, y:200,  w:1800, h:1500 },
    { x:7000, y:2000, w:1800, h:1300 }, { x:9500, y:2000, w:1800, h:1400 },
    { x:7000, y:5600, w:2000, h:1400 }, { x:7200, y:7200, w:1800, h:1400 },
    { x:9500, y:5600, w:1800, h:1600 }, { x:7000, y:8600, w:2000, h:800  },
  ],
  // 河流中心线（自北向南，略带蛇曲），半宽 220
  // 桥从 4 座加到 8 座，其中 3 座是双向四车道的「大桥」（big），
  //   桥面豁免涉水判定；河面本身改成可缓慢涉水通过（停留过久会失温扣血）。
  river: { half:220, pts:[
    [8400,-200],[8200,1500],[8700,3100],[8200,4700],[9000,6300],[8600,7900],[9300,9800]
  ], bridges:[
    [8200,1500],[8200,4700],[9000,6300],[8900,8800],
    { x:8420, y:420,  w:640, h:340, big:true },   // 北境大桥
    { x:8700, y:3100, w:660, h:340, big:true },   // 河谷中央大桥
    { x:8600, y:7900, w:650, h:340, big:true },   // 南岭大桥
    { x:9170, y:9430, w:560, h:300 },             // 南下便桥
  ] },
  // 铁路：纵向主线 + 横向支线（与河流交叉处为铁路桥，纯视觉）
  // 新增 3 条支线 —— 西南干线 / 监狱支线 / 工业南延线，把左下半张图串起来
  rails: [
    { pts:[ [11100,200],[11100,9400] ] },
    { pts:[ [7000,5400],[12600,5400] ] },
    { pts:[ [300,6150],[12600,6150] ] },     // 南横干线（贯穿监狱—小镇—货运区）
    { pts:[ [1000,4300],[1000,9450] ] },     // 西纵支线（监狱西侧）
    { pts:[ [4300,2500],[4300,5900] ] },     // 工业区南延线
  ],
  // 货运列车（dir:"v" 沿纵向铁路排列，dir:"h" 沿横向铁路排列）
  trains: [
    { x:11100, y:3600, cars:5, dir:"v" },
    { x:1000,  y:6900, cars:4, dir:"v" },
    { x:5200,  y:6150, cars:5, dir:"h" },
    { x:11480, y:8400, cars:4, dir:"v" },
  ],
};

// 撤离点规则（塔科夫式：条件撤离 / 付费撤离）
// 付费撤离不再固定 4000~6000 的高价，改为「基础价 + 带入装备估值 × 费率」，
//          轻装跑刀几乎白坐，重装才多付一点（见 raidExtractFee）。
const RAID_EXTRACT_RULES = {
  extA: { need:7, cost:0,    openChance:0.5,  note:"每局随机开放" },
  extB: { need:7, cost:0,    openChance:1.0,  note:"常驻开放" },
  extC: { need:4, cost:1600, feeRate:0.020, openChance:1.0, note:"V-EX 雇车 · 按带入装备估价" },
  extD: { need:9, cost:0,    openChance:0.65, note:"每局随机开放" },
  extE: { need:8, cost:0,    openChance:0.55, note:"每局随机开放" },
  extF: { need:7, cost:0,    openChance:0.6,  note:"每局随机开放" },
  extG: { need:10,cost:0,    openChance:0.5,  note:"每局随机开放" },
  extH: { need:4, cost:1400, feeRate:0.016, openChance:1.0, note:"北关雇车 · 按带入装备估价" },
  extI: { need:9, cost:0,    openChance:0.55, note:"东岭索道 · 每局随机开放" },
  extJ: { need:8, cost:2000, feeRate:0.024, openChance:1.0, note:"南港货轮 · 按带入装备估价" },
  extK: { need:6, cost:0,    openChance:0.6,  note:"医院天台 · 每局随机开放" },
  extL: { need:8, cost:0,    openChance:0.55, note:"林间空投 · 每局随机开放" },
  extM: { need:9, cost:0,    openChance:0.6,  note:"山顶缆车 · 每局随机开放" },
  extN: { need:7, cost:0,    openChance:1.0,  note:"河港渡轮 · 常驻开放" },
  extO: { need:9, cost:0,    openChance:0.6,  note:"火车站台 · 每局随机开放" },
  extP: { need:4, cost:1200, feeRate:0.014, openChance:1.0, note:"北桥栈道 · 按带入装备估价" },
  extQ: { need:8, cost:0,    openChance:0.6,  note:"货运专线 · 每局随机开放" },
  extR: { need:9, cost:0,    openChance:0.55, note:"南岭索道 · 每局随机开放" },
  extS: { need:8, cost:0,    openChance:0.75, note:"大坝坝顶 · 每局随机开放" },
};

/* 撤离费 = (基础价×0.28 + 带入装备估值×费率) × 轻装折扣
 *   轻装折扣 mult = 0.2 + 0.8 × v/(v+90000)
 *     · 裸装跑刀 v=0      → 0.20 倍，约 70~110 卢布（基本等于白坐）
 *     · 带 ₽30,000        → 0.40 倍
 *     · 带 ₽90,000        → 0.60 倍
 *     · 带 ₽300,000       → 0.82 倍（重装几乎按原价付）
 *   「带的装备越多，折扣越小」，绝对金额仍随装备升值上升，重装才该多付。
 *   封顶 = 基础价×1.4，避免顶级装备出现天价车费。 */
const RAID_FEE_LIGHT = 0.20;     // 裸装折扣下限
const RAID_FEE_SOFT  = 90000;    // 折扣衰减半程的装备估值
/* 折扣系数本体：0.2 → 趋近 1.0 的单调递增曲线（拆出来便于单独校验） */
function raidExtractFeeMult(carryVal){
  const v=Math.max(0, carryVal||0);
  return RAID_FEE_LIGHT + (1-RAID_FEE_LIGHT)*(v/(v+RAID_FEE_SOFT));
}
function raidExtractFee(zone, carryVal){
  if(!zone || !zone.cost) return 0;
  const v=Math.max(0, carryVal||0);
  const base = zone.cost*0.28 + v*(zone.feeRate||0.018);
  return Math.round(M.clamp(base*raidExtractFeeMult(v), 60, zone.cost*1.4)/10)*10;
}

// PMC / Scav巡逻点（开阔处）
const RAID_PATROL = [
  [310,295],[290,790],[690,790],[1150,260],[1240,890],[1870,275],[2200,275],[2200,550],
  [1690,750],[1850,1005],[500,1420],[1420,1300],[1900,1470],[760,560],[940,470],[1400,540],
  [1000,1050],[240,1000],[700,1300],[1650,1300],
  // 扩建区巡逻点
  [300,1130],[670,1110],[720,2020],[1170,2000],[1370,2330],[2080,2030],[1740,1780],
  [2690,880],[2720,1310],[3070,1830],[2500,1500],[2450,2000],[900,2500],[1650,2450],
  [600,1750],[2200,2400],[3000,2450],
  // 扩建区巡逻点
  [3550,530],[3680,1450],[3900,2400],[2220,3110],[1160,3150],[3500,1980],
  [4060,1620],[2140,3430],[980,3300],[3300,2200],[3900,2050],[4100,2900],
  // 东部 / 南部大区巡逻点
  [4700,700],[5150,620],[5750,650],[6320,620],[4720,1250],[5250,1260],
  [5900,1230],[6480,1220],[4750,2250],[5300,2250],[5980,2260],[6520,2280],
  [4760,3150],[5350,3170],[6000,3200],[5350,4150],[6000,4150],[4760,4150],
  [5400,5050],[6180,5050],[6800,1450],[6800,4980],[5050,3230],[4200,2600],
  [4150,3750],[5600,3300],[6300,3700],[4900,2400],[5700,2550],
  // 生态扩张：北境密林 / 河谷 / 铁路枢纽巡逻点
  [7250,850],[7550,2150],[7250,5300],[7450,7800],[7250,8700],[7650,1850],
  [10950,2450],[9850,6100],[11550,5150],[11600,7000],[11950,7500],
  [10650,8300],[9850,7800],[7750,8100],[7800,4800],[7600,5500],
  [7700,1550],[8950,4500],[9500,6300],[9450,8800],[10800,3600],[10200,1200],
  // 西南开发区：监狱 / 小镇 / 大坝巡逻点（全部避开水域）
  [1450,5050],[1950,5350],[1620,5600],[1560,6250],[1220,6900],
  [2000,6900],[2120,7300],[2450,7420],[1800,7660],[2620,7800],
  [3050,8300],[3560,8690],[3900,8130],[2760,8600],[4180,7800],
];

/* ----------------------------- 户外掩体 / 装饰 ----------------------------- */
// 地图原先只有「房间 + 十几条手写遮挡墙」，房门外大片空地既没有掩体
// 也没有视觉层次。这里改为按网格程序化撒点，物件分「硬掩体（挡子弹+视线）」
// 与「软掩体（只挡移动，不挡视线）」两类，避免地图变成一览无余的靶场。
const RAID_PROPS = [
  { kind:"container", w:118, h:238, sight:true,  fill:"#3f4a52", edge:"#1d2429", weight:10 },
  { kind:"container", w:238, h:118, sight:true,  fill:"#3f4a52", edge:"#1d2429", weight:10 },
  { kind:"container", w:118, h:238, sight:true,  fill:"#4a4438", edge:"#221f18", weight:6  },
  { kind:"container", w:238, h:118, sight:true,  fill:"#4a4438", edge:"#221f18", weight:6  },
  { kind:"truck",     w:92,  h:196, sight:true,  fill:"#4a4034", edge:"#201a14", weight:8  },
  { kind:"truck",     w:196, h:92,  sight:true,  fill:"#4a4034", edge:"#201a14", weight:8  },
  { kind:"barrier",   w:206, h:38,  sight:true,  fill:"#67675e", edge:"#2a2a26", weight:12 },
  { kind:"barrier",   w:38,  h:206, sight:true,  fill:"#67675e", edge:"#2a2a26", weight:12 },
  { kind:"crate",     w:74,  h:74,  sight:true,  fill:"#6a5638", edge:"#241c10", weight:12 },
  { kind:"pipe",      w:164, h:56,  sight:true,  fill:"#4c4c46", edge:"#1f1f1b", weight:7  },
  { kind:"pipe",      w:56,  h:164, sight:true,  fill:"#4c4c46", edge:"#1f1f1b", weight:7  },
  { kind:"rock",      w:82,  h:66,  sight:true,  fill:"#4a4e46", edge:"#23261f", weight:9, wild:true },
  { kind:"wall",      w:150, h:30,  sight:true,  fill:"#3a3a34", edge:"#16160f", weight:9  },
  { kind:"wall",      w:30,  h:150, sight:true,  fill:"#3a3a34", edge:"#16160f", weight:9  },
  { kind:"bush",      w:74,  h:62,  sight:false, fill:"#2b4529", edge:"#16220f", weight:14, wild:true },
  { kind:"bush",      w:96,  h:78,  sight:false, fill:"#2b4529", edge:"#16220f", weight:8, wild:true },
  { kind:"scrap",     w:104, h:86,  sight:false, fill:"#454238", edge:"#1c1a14", weight:10, wild:true },
];

// 室内家具：房间不该是空盒子——货架/机床/沙袋既是掩体也是视觉地标
const RAID_INDOOR = [
  { kind:"shelf",   w:186, h:42, sight:true, fill:"#4a4030", edge:"#1d1710", weight:16 },
  { kind:"shelf",   w:42,  h:186, sight:true, fill:"#4a4030", edge:"#1d1710", weight:16 },
  { kind:"table",   w:96,  h:62, sight:true, fill:"#3f3a30", edge:"#171410", weight:14 },
  { kind:"machine", w:124, h:84, sight:true, fill:"#37403c", edge:"#141a17", weight:10 },
  { kind:"sandbag", w:134, h:38, sight:true, fill:"#5a5236", edge:"#241f12", weight:14 },
  { kind:"sandbag", w:38,  h:134, sight:true, fill:"#5a5236", edge:"#241f12", weight:14 },
  { kind:"locker",  w:46,  h:76, sight:true, fill:"#3b4450", edge:"#151a20", weight:10 },
];

/* ----------------------------- 枪械 / 护甲 ----------------------------- */
// 塔科夫模式已全面改用「旧刷宝体系」程序化枪械（blGunGen / blGunConvert），
// 此处只保留 AI / 掉落 / 超市铺货所用的枪型池
const RAID_GUN_TYPES = ["pistol","smg","shotgun","rifle","sniper"];

// 1~9 级护甲：现实防护等级（软质内衬 → 陶瓷/钢制插板 → 全防护重型）
// 移除超现实护甲命名与自动回复设定，改用现实防护等级
const RAID_ARMORS = {
  1: { name:"T1 软质防护背心", dr:0.10, maxArmor:25,   value:180     },
  2: { name:"T2 轻型战术背心", dr:0.17, maxArmor:45,   value:420     },
  3: { name:"T3 II 级防弹衣",  dr:0.26, maxArmor:78,   value:980     },
  4: { name:"T4 III 级插板背心",dr:0.36, maxArmor:130, value:2600    },
  5: { name:"T5 IV 级复合防弹衣",dr:0.48,maxArmor:210, value:7200    },
  6: { name:"T6 重型插板背心", dr:0.60, maxArmor:330,  value:19000   },
  7: { name:"T7 全防护突击甲", dr:0.71, maxArmor:500,  value:48000   },
  8: { name:"T8 多层复合装甲", dr:0.80, maxArmor:720,  value:128000  },
  9: { name:"T9 VI 级重型防弹衣",dr:0.86,maxArmor:960, value:340000  },
};
// 1~9 级头盔：减爆头伤害，独立耐久池
const RAID_HELMETS = {
  1: { name:"T1 软质头套",     dr:0.08, maxArmor:10,  value:130   },
  2: { name:"T2 钢制头盔",     dr:0.15, maxArmor:20,  value:320   },
  3: { name:"T3 战术头盔",     dr:0.23, maxArmor:36,  value:760   },
  4: { name:"T4 III 级防弹盔", dr:0.32, maxArmor:58,  value:1900  },
  5: { name:"T5 复合防弹头盔", dr:0.43, maxArmor:92,  value:5200  },
  6: { name:"T6 重型防弹头盔", dr:0.54, maxArmor:145, value:13000 },
  7: { name:"T7 高切防弹头盔", dr:0.65, maxArmor:220, value:33000 },
  8: { name:"T8 全罩式头盔",   dr:0.74, maxArmor:320, value:88000 },
  9: { name:"T9 面罩一体头盔", dr:0.81, maxArmor:430, value:240000 },
};
const RAID_ARMOR_TIERS = [1,2,3,4,5,6,7,8,9];
// 局内物品栏容量上限（超出则无法继续拾取，提示「物品栏已满」）
const RAID_INV_CAP = { weapons:6, armors:4, helmets:4, shields:3, parts:16, materials:24, meds:6, receivers:4, keys:8 };

/* ---- 弹药（v0.20.0）----
 * 子弹是背包里的独立物品，按发堆叠：inv.ammo = { "ammo_mid_3": 120, ... }
 * 枪上只记「装填的是哪一种」（loaded）与弹匣内发数（ammoMag），不再有凭空的 ammoRes。 */
const RAID_AMMO_CAP = 720;      // 局内可携带的总发数（跨口径合计）
const RAID_AMMO_STACK = 30;     // 一条货 / 一次拾取 = 30 发
const RAID_SUPPORT_CASH = 512;  // 「初始装备包」售价（v0.21.2）：进场时从带入现金里支付，出生点投放一套起步装备
const RAID_AMMO_STARTER = {     // 新档 / 旧档迁移时发的起步弹药（全是民用级）
  ammo_light_1: 120, ammo_mid_1: 150, ammo_heavy_1: 60, ammo_grenade_1: 12,
};

/* ----------------------------- 9 阶统一品级 -----------------------------
 * 塔科夫全战利品共用同一套品级刻度（共 9 阶，严格由低到高）：
 *   民用 · 翻新 · 制式 · 军规 · 精工 · 特种 · 试验 · 原型 · 竞赛
 * 改为军工品质刻度和低饱和军规配色；
 *   regen（护甲自动回复）全部归零 —— 现实护甲耐久只能维修，不会待维修。
 * 护甲等级 T1~T9、枪械品级、部件品级、原材料品级全部共用此刻度。 */
/* 护甲 / 头盔 / 盾的 9 阶刻度 —— 名字与颜色**必须和前 9 阶武器品质一一对齐**
 * （config.js RARITIES 的注释里有完整 12 阶对照表 + 亮度单调性说明）。
 * 以前这两张表各叫各的（这边「翻新 / 制式 / 军规…」、那边「民用 / 翻新 / 制式…」），
 * 完整显示下同一档护甲和枪会显示两个不同名字 —— v0.21.7 统一。 */
const RAID_TIERS = [
  { id:"common",  name:"民用", color:"#867b61", dr:0,     arm:0,    val:0,    regen:0, affix:0 },
  { id:"uncommon",name:"制式", color:"#4c9d2e", dr:0.020, arm:0.15, val:0.40, regen:0, affix:1 },
  { id:"magic",   name:"军规", color:"#559edf", dr:0.040, arm:0.30, val:0.80, regen:0, affix:2 },
  { id:"rare",    name:"精选", color:"#bc94e9", dr:0.062, arm:0.50, val:1.35, regen:0, affix:3 },
  { id:"epic",    name:"精工", color:"#ef93d6", dr:0.090, arm:0.75, val:2.20, regen:0, affix:4 },
  { id:"legend",  name:"特种", color:"#f5a8a2", dr:0.122, arm:1.10, val:3.50, regen:0, affix:5 },
  { id:"ancient", name:"试验", color:"#f2bd54", dr:0.155, arm:1.60, val:5.20, regen:0, affix:6 },
  { id:"myth",    name:"原型", color:"#b6de19", dr:0.190, arm:2.20, val:7.60, regen:0, affix:7 },
  { id:"rainbow", name:"定型", color:"#76ebd7", dr:0.225, arm:2.90, val:11.0, regen:0, affix:8 },
];
// 护甲稀有度数组（与 RAID_TIERS 一一对应，保留旧字段名以兼容 UI）
const RAID_RARITY_NAME  = RAID_TIERS.map(t=>t.name);
const RAID_RARITY_COLOR = RAID_TIERS.map(t=>t.color);
const RAID_RARITY_DR    = RAID_TIERS.map(t=>t.dr);
const RAID_RARITY_ARM   = RAID_TIERS.map(t=>t.arm);
const RAID_RARITY_VAL   = RAID_TIERS.map(t=>t.val);

// 9 阶品质图例（配装大厅 / 商店展示用）
function raidTierLegend(){
  if(weaponQualityHidden()) return `<b style="color:#cfcabb">精简显示（品质 / 前后缀 / 厂商已隐藏 · 设置里切换到「完整」即可查看）</b>`;
  return RAID_TIERS.map(t=>`<b style="color:${t.color}">${t.name}</b>`).join(" / ");
}

// 枪械生成：把塔科夫品质档位映射到全局 RARITIES 的 id（仅取数值/词缀，显示色由 qColor 覆盖）
const RAID_TIER_TO_RARITY = ["white","green","blue","purple","orange","pearl","ancient","mythic","rainbow"];

/* ----------------------------- 具名装备 -----------------------------
 * 高档位除了随机改装枪甲之外，还会掉落现实型号 + 出厂改装方案的「具名装备」：
 * 词条全部手工配置，同档数值远高于随机生成，名字固定（如「AK-74N 5.45×39 战术型」）。
 * 移除制式/定制命名与急救效率、额外弹丸、特殊弹触发、溅射等超现实词条。 */
/* AI 索敌感知分级：Scav 迟钝、PMC 警觉、Boss 提前锁定。
 * 只影响「发现目标」这一段；射击精度 / 走位 / 包扎仍按 smart 与 cls 原逻辑结算。
 * 旧值（v0.16.0 全档统一）：视距 1000、视线记忆 7.0s、无反应延迟、
 *   主动搜寻 smart 0.88 / pmc 0.74 / scav 0.56、枪声听距系数 1.0。 */
/* ==================== v0.22.2：静态地形分区 ====================
 * biome / 室内 / 危险度全部由坐标查表得到，不读 RNG、不依赖运行时动态量
 * （AI 数量、玩家路径、计时都会让联机两端 seed 重放分叉）。
 * 400px 网格在模块加载时预计算一次，热路径 O(1)：30+ AI 每帧调 raidAISense，
 * 不能在这里遍历 103 个房间矩形 + 8 片密林。 */
const RAID_BIOME_CELL = 400;
const RAID_BIOME_COLS = Math.ceil(RAID_MAP_W/RAID_BIOME_CELL);
const RAID_BIOME_ROWS = Math.ceil(RAID_MAP_H/RAID_BIOME_CELL);
const RAID_BIOME_ROOM = 1, RAID_BIOME_FOREST = 2;
const RAID_BIOME_GRID = (function(){
  const g = new Uint8Array(RAID_BIOME_COLS*RAID_BIOME_ROWS);
  const mark = (rect, bit) => {
    const x0=Math.max(0,Math.floor(rect.x/RAID_BIOME_CELL));
    const x1=Math.min(RAID_BIOME_COLS-1,Math.floor((rect.x+rect.w)/RAID_BIOME_CELL));
    const y0=Math.max(0,Math.floor(rect.y/RAID_BIOME_CELL));
    const y1=Math.min(RAID_BIOME_ROWS-1,Math.floor((rect.y+rect.h)/RAID_BIOME_CELL));
    for(let gy=y0;gy<=y1;gy++) for(let gx=x0;gx<=x1;gx++) g[gy*RAID_BIOME_COLS+gx] |= bit;
  };
  for(const rm of RAID_ROOMS) if(!rm.open) mark(rm, RAID_BIOME_ROOM);
  for(const fz of RAID_BIOMES.forest) mark(fz, RAID_BIOME_FOREST);
  return g;
})();
function raidBiomeAt(x,y){
  const gx=Math.floor(x/RAID_BIOME_CELL), gy=Math.floor(y/RAID_BIOME_CELL);
  if(gx<0||gy<0||gx>=RAID_BIOME_COLS||gy>=RAID_BIOME_ROWS) return 0;
  return RAID_BIOME_GRID[gy*RAID_BIOME_COLS+gx];
}
/* 玩家进屋判定：先用网格位快速排除，命中边界才做一次精确矩形复核 */
function raidIndoorAt(x,y){
  if(!(raidBiomeAt(x,y)&RAID_BIOME_ROOM)) return false;
  for(const rm of RAID_ROOMS){
    if(!rm.open && x>rm.x && x<rm.x+rm.w && y>rm.y && y<rm.y+rm.h) return true;
  }
  return false;
}
/* 3×3 行政区危险度（与 raid-core.js 的 CW=W/3 / CH=H/3 分区一致）。
   越靠东部铁路 / 西南监狱越危险；穿越大图才该有掉落回报。 */
const RAID_ZONE_DANGER = [
  [0.00, 0.10, 0.30],
  [0.08, 0.18, 0.36],
  [0.14, 0.24, 0.42],
];
function raidDangerAt(x,y){
  const gx=M.clamp(Math.floor(x/(RAID_MAP_W/3)),0,2);
  const gy=M.clamp(Math.floor(y/(RAID_MAP_H/3)),0,2);
  return RAID_ZONE_DANGER[gy][gx];
}
function raidLuckAt(R,x,y){
  return M.clamp((R.lootLuck||0) + raidDangerAt(x,y)*0.35, 0, 0.85);
}

const RAID_AI_SENSE = {
  scav: { sight:520,  memory:2.5, react:0.55, hunt:0.30, hear:0.65 },
  pmc:  { sight:900,  memory:5.5, react:0.22, hunt:0.70, hear:1.00 },
  boss: { sight:1250, memory:9.0, react:0.06, hunt:0.95, hear:1.40 },
};
function raidAISense(b){
  let base = RAID_AI_SENSE.scav;
  if(b){
    if(b.bounty) base = RAID_AI_SENSE.boss;                    // Boss
    else if(b.cls==="pmc") base = RAID_AI_SENSE.pmc;           // Raider 由 smart 单独判定
    else if(b.smart) base = RAID_AI_SENSE.pmc;
  }
  /* v0.22.2：感知乘 biome。没带坐标时（单测 / 纯类型查询）直接返回原对象引用，
     既保持旧调用约定，也避免每帧无谓地新建对象。 */
  if(!b || typeof b.x!=="number" || typeof b.y!=="number") return base;
  const bio = raidBiomeAt(b.x, b.y);
  const sMul = (bio & RAID_BIOME_FOREST) ? 0.80 : 1;          // 密林视距 -20%（按区域，网格位即可）
  /* 室内必须精确判定：400px 网格会把房间外一大圈空地也标成 ROOM，
     直接用网格位会让听距加成在室外也生效。raidIndoorAt 内部先用网格位 O(1) 排除，
     只有落在候选格才做一次矩形复核，热路径开销可忽略。 */
  const hMul = raidIndoorAt(b.x, b.y) ? 1.30 : 1;             // 室内听距 ×1.3
  if(sMul===1 && hMul===1) return base;
  return { sight:base.sight*sMul, memory:base.memory, react:base.react,
           hunt:base.hunt, hear:base.hear*hMul };
}

/* Scav 制式武器：塔科夫拾荒者只会拿低阶手枪 / 霰弹枪 / 冲锋枪。
 * 硬封顶等级与品质，并强制低穿深弹种，避免高装备玩家把全场 Scav 一起养肥。 */
function raidScavGun(level, opts){
  opts=opts||{};
  const type=opts.type || RNG.pick(SCAV_GUN_TYPES);
  const pool=SCAV_GUN_MODELS[type] || SCAV_GUN_MODELS.pistol;
  const ilvl=M.clamp(Math.round(level||1), 1, SCAV_GUN_ILVL_MAX);
  const rarity=opts.rarity || RNG.pick(["white","white","green","green","blue"]);
  const element=opts.element || RNG.pick(SCAV_AMMO);
  return blGunGen(ilvl, { type, rarity, element, model:RNG.pick(pool) });
}

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
];

// 运气 → 可出的最高档（0 裸装最多到特种，1 满配可达竞赛）
function raidUniqueMaxTier(luck){
  return M.clamp(5 + Math.round(M.clamp(luck||0, 0, 1)*3), 5, 8);
}

function raidMakeUnique(u){
  const stamp=Date.now().toString(36)+Math.floor(Math.random()*999).toString(36);
  if(u.kind==="weapon"){
    // 传奇底子：固定比同档随机枪多 45% 基础伤害（写进前缀词条，数值面板可见）
    const aff=JSON.parse(JSON.stringify(u.affixes));
    const pre=aff.find(a=>a.kind==="prefix")||aff[0];
    pre.mods=pre.mods||[]; pre.mods.push({stat:"dmgPct", value:45});
    const w=blGunGen(u.ilvl, {
      type:u.type,
      rarity:RAID_TIER_TO_RARITY[u.tier],
      element:u.elem||"none",
      affixes:aff,
    });
    w.uid="uq"+stamp; w.kind="weapon";
    w.name="「"+u.name+"」";
    w.qTier=u.tier; w.qName=RAID_TIERS[u.tier].name; w.qColor=RAID_TIERS[u.tier].color;
    w.unique=u.id; w.uniqPerk=u.perk; w.uniqTitle=u.name;
    w.value=Math.round((w.value||0)*1.8/10)*10;
    ensureGunAffixes(w);
    return w;
  }
  const isH=u.kind==="helmet";
  const tier=M.clamp(u.tier,1,9), rar=M.clamp(u.tier,0,8);
  const it=isH?raidMakeHelmet(tier,rar):raidMakeArmor(tier,rar);
  const base=isH?RAID_HELMETS[tier]:RAID_ARMORS[tier];
  it.affixes=JSON.parse(JSON.stringify(u.affixes));
  const st=raidArmorStats(base, rar, it.affixes);
  it.dr=st.dr; it.maxArmor=st.maxArmor; it.armorRegen=st.armorRegen;
  it.value=Math.round(st.value*1.6/100)*100;
  it.name="「"+u.name+"」";
  it.uid="uq"+stamp; it.kind=isH?"helmet":"armor";
  it.baseName=base.name;
  it.unique=u.id; it.uniqPerk=u.perk; it.uniqTitle=u.name;
  it.qTier=rar; it.qName=RAID_TIERS[rar].name; it.qColor=RAID_TIERS[rar].color;
  return it;
}

// 随机一件命名装备（档位受运气限制，高档更稀有）
function raidRollUnique(luck, kindFilter){
  const maxT=raidUniqueMaxTier(luck);
  let pool=RAID_UNIQUES.filter(u=>u.tier<=maxT);
  if(kindFilter) { const f=pool.filter(kindFilter); if(f.length) pool=f; }
  if(!pool.length) pool=RAID_UNIQUES.slice(0,1);
  // v0.21.9：权重方向原先写反（tier-5 让 tier8 反而最常见，约占具名掉落 46%），倒置为 5-tier
  const w=pool.map(u=>({ weight:Math.pow(1.55, 5-u.tier) }));
  return raidMakeUnique(pool[RNG.weighted(w)]);
}

// 9 阶品质的「幸运加权」：luck 0→1 时，高段位权重按倍率表指数抬升
// （单纯整体平移会把顶端档位卡死在门槛外，这里改成逐档乘法加权）
function raidLuckPick(baseW, luck, mults){
  const k=M.clamp(luck||0, 0, 1);
  let tot=0;
  const w=baseW.map((bw,i)=>{ const v=bw*(1+k*(mults[i]||0)); tot+=v; return v; });
  let r=RNG.f()*tot;
  for(let i=0;i<w.length;i++){ r-=w[i]; if(r<=0) return i; }
  return w.length-1;
}
// 携带价值只给「很小的」品质加成（原表满配会把顶档权重放大 12 倍，太容易出神装）
const RAID_LUCK_MULT = [0, 0.07, 0.14, 0.24, 0.38, 0.58, 0.85, 1.15, 1.50];  // 高阶倍率再压低
/* 只要携带了任何装备，就不再算「裸装进场」——
 *   RAID_LUCK_FLOOR：最低运气档（≈携带估值 ₽7000），箱子不会全是垫底货
 *   RAID_GEAR_BASE：AI 装备强度下限（≈常规配装），裸手才是 0 */
const RAID_LUCK_FLOOR = 0.06;
const RAID_GEAR_BASE  = 0.32;

/* ---------------- 硬性稀有度预算 ----------------
 * 目标（用户明确要求）：每 100 件战利品里
 *   · 精选及以上（T3 精选 / T4 精工）≈ 3.2 件（原 5 件）
 *   · 特种及以上（T5 特种 ~ T8 原型）≈ 0.55 件（原 1 件）
 * 做法：先掷「是否进精选段 / 特种段」，再在段内按权重挑档。
 * 携带估值的「运气」只做两件小事：段内更偏顶端（T4 而非 T3、T8 而非 T5），
 * 以及总量最多 +30%（3.2%→4.2%）、+40%（0.55%→0.8%），不会把整局刷成高阶品。 */
const RAID_BUDGET = { lv0:0.032, lvCap:0.042, lg0:0.0055, lgCap:0.008,
                      wLow:[{weight:0.72},{weight:0.21},{weight:0.07}] };
function raidBudgetTier(luck){
  const k=M.clamp(luck||0, 0, 1);
  const pL=Math.min(RAID_BUDGET.lgCap, RAID_BUDGET.lg0*(1+k*0.40));
  const pR=Math.min(RAID_BUDGET.lvCap, RAID_BUDGET.lv0*(1+k*0.30));
  const r=RNG.f();
  if(r<pL){   // 特种段 T5~T8：运气越好越偏 T7 / T8
    return 5 + RNG.weighted([{weight:0.82-0.30*k},{weight:0.15},{weight:0.025+0.20*k},{weight:0.005+0.10*k}]);
  }
  if(r<pR){   // 精选段 T3 / T4
    return 3 + RNG.weighted([{weight:0.88-0.22*k},{weight:0.12+0.22*k}]);
  }
  return RNG.weighted(RAID_BUDGET.wLow);   // T0 / T1 / T2
}

// 高级护甲天然偏向高稀有度（T9 基本不出普通），但顶端受等级上限约束、始终极稀有
// 品质也走「硬预算」，护甲不再满地图刷紫 / 橙
function raidRollArmorRarity(tier, luck){
  const t=M.clamp(Math.round(tier||1),1,9);
  const maxRar=M.clamp(t-1, 0, 8);
  return M.clamp(Math.min(raidBudgetTier(luck||0), maxRar), 0, 8);
}

// 掉落等级权重：T7+ 极稀有（上锁箱 / 增援封锁者才较常见）
const RAID_TIER_W    = [23, 30, 25, 14, 4.0, 1.3, 0.28, 0.055, 0.010];   // T6+ 掉落率再降约 40~50%
function raidRollArmorTier(luck){
  return 1 + raidLuckPick(RAID_TIER_W, luck, RAID_LUCK_MULT);   // 1..9
}

/* ----------------------------- 原材料（18 种，每阶 2 种） ----------------------------- */
/* 经济收紧：低阶材料估值大幅下调；进一步大幅压低低价值材料
 * （T0/T1/T2 再砍约 40~55%），高价值材料依旧稀有但捡一局卖不出好价钱。 */
// 全部改为现实中能在仓库 / 军械所找到的物资，保留 id 以兼容旧存档与合成配方
/* v0.21.6：跑刀（空手）移速加成 —— 手里没枪时脚步最轻，敢贴着人跑。
 * 这也是「捡到枪自动上门」的代价交换：有枪就慢一点，没枪就快一点。 */
const RAID_BAREHAND_SPEED = 1.20;

/* ----------------------------- 配件拆解 → 原材料（v0.21.6） -----------------------------
 * 配件不再只是「卖钱」或「装枪」：拆掉能换回同族的原材料，材料再拿去工坊开工。
 * 产出按槽位归属的材料族（金属 / 电子 / 化工 / 织物）与配件档次折算，
 * 高档配件拆出高档料 —— 拆一堆垃圾配件不会凭空变出航空铝坯。 */
const SALVAGE_FAMILY = {
  metal:  ["scrap","steel","alloy","stariron"],   // T0 / T1 / T2 / T6
  elec:   ["copper","circuit","coil"],            // T1 / T3 / T5
  chem:   ["rubber","polymer","eridium"],         // T2 / T3 / T5
  textile:["cloth","fiber"],                      // T0 / T4
};
const SALVAGE_BY_SLOT = {
  barrel:["metal","metal"], mag:["chem","metal"], optic:["elec","elec"],
  grip:["chem","textile"],  stock:["chem","metal"], muzzle:["metal","metal"],
  underbarrel:["metal","chem"], trigger:["elec","metal"], body:["metal","metal"],
  core:["elec","elec"],
};
/* 从某个材料族里挑「不超过目标档次」的最高一级；没有就退回最低一级 */
function raidSalvageMat(family, wantTier){
  const list = SALVAGE_FAMILY[family] || SALVAGE_FAMILY.metal;
  let best = list[0];
  for(const id of list){
    const m = RAID_MAT_BY_ID[id];
    if(m && m.tier <= wantTier) best = id;
  }
  return best;
}
/* 配件 → [{id,n}]（纯数据，不改动任何状态） */
function raidSalvageYield(pt){
  if(!pt || pt.core) return null;                 // 改装模块不可拆（它是模块不是配件）
  const rar = Math.max(0, RARITIES.findIndex(r=>r.id===pt.rarity));
  const tier = M.clamp(Math.round((pt.ilvl||10)/8) + (rar>=5?1:0), 0, 6);
  const fams = SALVAGE_BY_SLOT[pt.slot] || ["metal","metal"];
  const out = [];
  const push=(fam,n)=>{
    if(n<=0) return;
    const id = raidSalvageMat(fam, tier);
    const hit = out.find(x=>x.id===id);
    if(hit) hit.n += n; else out.push({ id, n });
  };
  push(fams[0], 1 + (tier>=2?1:0));                // 主材 1~2 份
  push(fams[1], tier>=1?1:0);                      // 副材 1 份（T0 配件只出主材）
  return out;
}

const RAID_MATERIALS = [
  { id:"scrap",    name:"废金属",     tier:0, value:7,    tag:"金属" },
  { id:"cloth",    name:"破布",       tier:0, value:5,    tag:"织物" },
  { id:"steel",    name:"特种钢",     tier:1, value:20,   tag:"金属" },
  { id:"copper",   name:"铜线",       tier:1, value:16,   tag:"电子" },
  { id:"alloy",    name:"钛合金板",   tier:2, value:70,   tag:"金属" },
  { id:"rubber",   name:"合成橡胶",   tier:2, value:60,   tag:"化工" },
  { id:"circuit",  name:"军用电路板", tier:3, value:400,  tag:"电子" },
  { id:"polymer",  name:"聚合物",     tier:3, value:340,  tag:"化工" },
  { id:"fiber",    name:"芳纶纤维",   tier:4, value:1050, tag:"织物" },
  { id:"magnet",   name:"伺服电机",   tier:4, value:1180, tag:"电子" },
  { id:"eridium",  name:"发射药",     tier:5, value:2600, tag:"化工" },
  { id:"coil",     name:"火控线缆",   tier:5, value:3000, tag:"电子" },
  { id:"stariron", name:"航空铝坯",   tier:6, value:6500, tag:"金属" },
  { id:"antibat",  name:"锂电组",     tier:6, value:7300, tag:"电子" },
  { id:"void",     name:"复合陶瓷板", tier:7, value:16000,tag:"金属" },
  { id:"mythshard",name:"精密轴承",   tier:7, value:18000,tag:"金属" },
  { id:"singul",   name:"光学测距模块",tier:8, value:46000,tag:"光学" },
  { id:"prism",    name:"镀膜镜片组", tier:8, value:53000,tag:"光学" },
];
const RAID_MAT_BY_ID = {};
for(const m of RAID_MATERIALS) RAID_MAT_BY_ID[m.id]=m;

/* Boss 保底战利品：击杀 Boss「至少 3 件高品阶」
 *   ① 一件 T4~T6 原材料　② 一件精选 / 特种配件　③ 一件精选以上护甲 / 头盔 / 整枪 */
function raidBountyLoot(){
  const out=[];
  // ① 原材料
  const mt=RNG.ri(4,6);
  const pool=RAID_MATERIALS.filter(m=>m.tier===mt);
  const base=pool.length?RNG.pick(pool):RAID_MATERIALS[RAID_MATERIALS.length-1];
  out.push({ kind:"material", id:base.id, name:base.name, tier:mt, rarity:mt,
    value:Math.round(base.value*(1+RAID_RARITY_VAL[mt])/10)*10,
    color:RAID_RARITY_COLOR[mt], qName:RAID_TIERS[mt].name,
    uid:"bq"+Math.floor(Math.random()*1e9).toString(36) });
  // ② 配件：精选起，25% 直接给特种档
  const pt=rollPart(RNG.pick(GUN_SLOTS).id, 18, RNG.chance(0.25)?"orange":"purple");
  pt.kind="part"; pt.uid="bq"+Math.floor(Math.random()*1e9).toString(36);
  out.push(pt);
  // ③ 装备三选一（护甲 / 头盔 / 整枪），品质至少 T3
  const qt=RNG.ri(3,4);
  const pick=RNG.ri(0,3);
  if(pick===0)      out.push(raidMakeArmor(RNG.ri(4,6), qt));
  else if(pick===1) out.push(raidMakeHelmet(RNG.ri(4,6), qt));
  else if(pick===3) out.push(raidMakeShield(RNG.ri(4,6), qt));
  else {
    const g=blGunGen(24, { type:RNG.pick(RAID_GUN_TYPES), rarity:RAID_TIER_TO_RARITY[qt] });
    ensureGunAffixes(g);
    g.uid="bq"+Math.floor(Math.random()*1e9).toString(36); g.kind="weapon";
    g.qTier=qt; g.qName=RAID_TIERS[qt].name; g.qColor=RAID_TIERS[qt].color;
    out.push(g);
  }
  return out;
}
/* ------------------------- v0.19.0 经济数值（单一来源） -------------------------
 * 四个价格口径全部以「估价 value」为基准，浮动用稳定伪随机（同一件货每次进店同价）：
 *   · 局内商店售价    估价 × (0.80 ± 0.10)  → 0.70 ~ 0.90
 *   · 回收超市收购    估价 × (1.20 ± 0.40)  → 0.80 ~ 1.60
 *   · 背包 / 仓库直售 估价 × 0.50
 *   · 局外军火超市    估价 × (2.00 ± 0.50)  → 1.50 ~ 2.50
 * 注意：局内买 0.8×、回收卖 1.2× 存在理论套利空间，靠「每摊位限购 + 局内负重 + 撤离风险」约束，
 *       数值由设计方（用户）指定，这里只负责统一实现，不擅自改动比例。 */
const RAID_VENDOR_RATE = 0.50;          // 背包 / 仓库直售
const RAID_FIELD_SELL_RATE = 1.20;      // 回收超市基础收购倍率
const RAID_FIELD_SELL_JITTER = 0.40;    // 回收超市浮动
const RAID_SHOP_RATE = 0.80;            // 局内商店基础售价倍率
const RAID_SHOP_JITTER = 0.10;          // 局内商店浮动
const RAID_SUPER_RATE = 2.00;           // 局外军火超市基础售价倍率
const RAID_SUPER_JITTER = 0.50;         // 局外军火超市浮动

/* 稳定伪随机：同一 key 永远得到同一个浮动系数，避免价格每帧跳动 */
function raidEconJitter(key, jitter){
  const s=String(key==null?"":key);
  let h=2166136261;
  for(let i=0;i<s.length;i++){ h^=s.charCodeAt(i); h=Math.imul(h,16777619); }
  const u=((h>>>0)%1000)/1000;                  // 0 ~ 0.999
  return (u*2-1)*jitter;                        // -jitter ~ +jitter
}
/* 取整：小额按 1、中等按 5、大额按 10。
 * 一律 /10 取整会把 ₽10 的破布永远四舍五入回 ₽10、把 ₽20 的铜线抬到 ₽20，
 * 于是低价货看起来「售价 = 估值」、也完全看不出浮动（v0.19.4 修）。 */
const raidEconRound=(v)=>{
  const a=Math.abs(v);
  const step = a < 60 ? 1 : a < 320 ? 5 : 10;
  return Math.max(1, Math.round(v/step)*step);
};
function raidShopPrice(value, key){             // 局内商店售价
  return raidEconRound((value||0)*(RAID_SHOP_RATE + raidEconJitter(key, RAID_SHOP_JITTER)));
}
function raidFieldSellPrice(value, key){        // 回收超市收购
  return raidEconRound((value||0)*(RAID_FIELD_SELL_RATE + raidEconJitter(key, RAID_FIELD_SELL_JITTER)));
}
/* 弹药回收价（v0.21.0）：子弹是消耗品，回收价必须低于局内买价，否则就是无限套利
 * —— 材料店 0.8× 买、回收超市 1.2× 卖，一条 T1 中弹净赚 ₽35，白嫖无风险。
 *   · 局内买 0.80× → 回收 0.55×（仍高于背包直售 0.50×，鼓励跑一趟摊位） */
function raidAmmoSellPrice(value){
  return raidEconRound((value||0)*0.55);
}
function raidBagSellPrice(value){               // 背包 / 仓库直售
  return raidEconRound((value||0)*RAID_VENDOR_RATE);
}
function raidSuperPrice(value, key){            // 局外军火超市售价
  return raidEconRound((value||0)*(RAID_SUPER_RATE + raidEconJitter(key, RAID_SUPER_JITTER)));
}

/* ----------------------------- 钥匙（5 级，开对应等级的上锁箱） -----------------------------
 * 上锁箱按保险等级分成 5 档（lockLv），钥匙也分 5 级。
 * 一把钥匙能开「同级或更低」的箱子，有使用次数（用尽即报废）。
 * 获取：材料商店（I~II，卢布）/ 黑市（III~V，GP 币）/ 上锁箱与 Raider 掉落（不可合成）。
 */
const RAID_KEYS = [
  { lv:1, name:"生锈钥匙",   color:"#b08e60", uses:6, value:4200,   shop:2600,  token:0  },
  { lv:2, name:"铜制钥匙",   color:"#d08a4a", uses:5, value:12000,  shop:7800,  token:0  },
  { lv:3, name:"钢制钥匙",   color:"#9fb4c8", uses:4, value:34000,  shop:0,     token:5  },
  { lv:4, name:"钛合金钥匙", color:"#7fd0ff", uses:3, value:86000,  shop:0,     token:14 },
  { lv:5, name:"V 级电子钥匙",color:"#b8946a", uses:2, value:210000, shop:0,    token:34 },
];
/* GP 币 → 卢布 的「估值汇率」（按黑市 III~V 级钥匙定价反推：
 *   34000/5 = 6800 · 86000/14 ≈ 6143 · 210000/34 ≈ 6176 → 取 6200）
 * 只用于配装大厅的「总价值」展示，GP 币仍是黑市专用货币，不提供任何兑换入口。 */
const RAID_TOKEN_RATE = 6200;
function raidTokenWorth(n){ return Math.max(0, Math.round((n||0)*RAID_TOKEN_RATE)); }

const RAID_LOCK_NAME = ["", "I 级", "II 级", "III 级", "IV 级", "V 级"];
function raidKeyDef(lv){ return RAID_KEYS[M.clamp(Math.round(lv||1),1,5)-1]; }
function raidMakeKey(lv, uses){
  const d=raidKeyDef(lv);
  return { kind:"key", id:"key"+d.lv, lv:d.lv, name:d.name, color:d.color,
    uses:Math.max(1, Math.round(uses||d.uses)), maxUses:d.uses, value:d.value,
    uid:"ky"+Math.floor(Math.random()*1e9).toString(36) };
}
/* 钥匙的获取路径（v0.21.7 起第三条回来了）：
 *   ① 掉落：上锁保险箱（等级 i 的箱子最多掉 i+1 级的钥匙）与 Raider；
 *   ② 购买：材料商店 I~II（卢布）、黑市 III~V（GP 币）；
 *   ③ 合成：工坊合成表「保险箱钥匙」—— 16 份原材料，级别由投料品质决定（I~V）。
 * 16 份料本身就是不小的成本，所以钥匙依然是稀缺资源，开箱前要算账。 */
function raidRollBoxKey(boxLv){
  // 箱子等级 i → 掉落上限 i+1（V 级封顶），越接近上限越罕见
  const cap=M.clamp((boxLv|0)+1, 1, 5);
  const w=[];
  for(let l=1;l<=cap;l++){
    w.push({ weight: l===cap ? 0.35 : Math.pow(1.35, cap-l), lv:l });
  }
  const idx=RNG.weighted(w);             // weighted 返回索引（0 起）
  return raidMakeKey(w[idx].lv);
}
function raidRollMaterialTier(luck){
  return raidBudgetTier(luck);   // 0..8：T3+ 约 5%、T5+ 约 1%
}
function raidMakeMaterial(luck){
  luck=luck||0;
  const tier=raidRollMaterialTier(luck);
  const pool=RAID_MATERIALS.filter(m=>m.tier===tier);
  const base=pool.length?RNG.pick(pool):RAID_MATERIALS[Math.min(tier, RAID_MATERIALS.length-1)];
  const mult=1 + RAID_RARITY_VAL[tier];   // 复用品质估值倍率，高稀有度原材料极值钱
  return { kind:"material", id:base.id, name:base.name, tier,
    rarity:tier, value:Math.round(base.value*mult/10)*10,
    color:RAID_RARITY_COLOR[tier] };
}

/* ----------------------------- 医疗用品（5 种） ----------------------------- */
const RAID_MEDS = [
  { id:"bandage", name:"绷带",   tier:0, value:180,  heal:0,   bleed:true,  cast:2.2, desc:"止血，移动会打断" },
  { id:"hemo",    name:"止血针", tier:1, value:680,  heal:15,  bleed:true,  cast:1.2, desc:"瞬间止血 + 少量回血" },
  { id:"medkit",  name:"急救包", tier:2, value:1900, heal:65,  bleed:false, cast:3.0, desc:"回复 65 生命" },
  { id:"stim",    name:"强心针", tier:3, value:4300, heal:35,  bleed:false, cast:1.0, boost:true, desc:"回血 35 · 8 秒加速" },
  { id:"surgery", name:"手术包", tier:4, value:9500, heal:100, bleed:true,  cast:4.0, desc:"回满血并止血（耗时最长）" },
];
const RAID_MED_BY_ID={}; for(const m of RAID_MEDS) RAID_MED_BY_ID[m.id]=m;
function raidMakeMed(id){
  const b=RAID_MED_BY_ID[id]||RAID_MEDS[0];
  return { kind:"med", id:b.id, name:b.name, tier:b.tier, heal:b.heal, bleed:b.bleed,
    cast:b.cast, boost:!!b.boost, value:Math.round(b.value*(1+RAID_RARITY_VAL[b.tier])),
    color:RAID_RARITY_COLOR[b.tier], uid:"md"+Math.floor(Math.random()*1e9).toString(36) };
}
// 医疗箱里掷一件医疗品（品质越高越稀有）
function raidRollMed(luck){
  const tier=Math.min(4, raidLuckPick([52,26,13,6.5,2.5], luck, [0,0.3,0.9,1.8,3.2]));
  const pool=RAID_MEDS.filter(m=>m.tier===tier);
  return raidMakeMed((pool.length?RNG.pick(pool):RAID_MEDS[0]).id);
}

/* ----------------------------- 改装模块（slot:"core"） -----------------------------
 * 原「弹种适配组件 / 膛压组件 / 改装模块」全部改为现实可解释的改装模块，
 *   内部 core 字段值（elem / chaos / boost）保留，兼容旧存档与联机快照。
 * 三类模块：
 *   · 弹种适配组件(core:"elem")  → 更换枪械适配弹种，附加弹药效能词条
 *   · 膛压组件(core:"chaos")     → 「最高等级膛压组件」决定改装等级（1.06^m 工程余量）
 *   · 改装模块(core:"boost")     → 7 类工艺增益（导气 / 扳机 / 供弹 / 枪管 / 枪口 / 人体工学 / 综合）
 * 模块不可合成、不可融合升阶，只能从保险箱、Raider 掉落，或在商店购买。
 * 模块槽数量由枪械品级决定，1~8 个。 */
const RAID_CORE_MAX = 5;
const RAID_ROMAN = ["","I","II","III","IV","V"];
const RAID_ELEM_CORE_ELEMS = ["fire","shock","corrosive","cryo","explosive","radiation"];
const RAID_CORE_RARITY = ["green","blue","purple","orange","pearl"];   // lv1~5 对应稀有度 id
function raidCoreValue(coreType, lv){
  const base = coreType==="chaos" ? 3900 : coreType==="boost" ? 3000 : 3300;   // 增益提升后估值同步上调
  return Math.round(base * Math.pow(2.35,(lv||1)-1)/10)*10;
}
// 改装模块定义：每种给出名称/颜色/属性词缀/每级基础值
/* 7 类现实改装模块，全部为可解释的工艺参数；内部 id 保留以兼容旧存档。
 * 模块只能掉落或购买，不可合成；估值随等级按 2.35 倍递增。 */
const BOOST_CORE_TYPES = {
  berserk:   { name:"导气增压模块", color:"#b07a4a", stats:["dmgPct","fireRatePct"],        base:[26,23] },
  lethal:    { name:"精磨扳机组",   color:"#a86262", stats:["critChance","critDmg"],        base:[17,40] },
  barrage:   { name:"扩容供弹组件", color:"#5e8fa8", stats:["magPct","reloadPct"],          base:[33,26] },
  precision: { name:"比赛级枪管",   color:"#7d7ba0", stats:["accPct","range"],              base:[28,23] },
  annihil:   { name:"枪口制退组件", color:"#89729c", stats:["dmgPct","recoil","projSpeed"], base:[27,23,20] },
  vampire:   { name:"人体工学套件", color:"#9c6b74", stats:["moveSpeed","reloadPct"],       base:[16,20] },
  omni:      { name:"综合改装套件", color:"#b09a4c", stats:["dmgPct","accPct","critChance"],base:[15,15,12] },
};
const BOOST_CORE_IDS = Object.keys(BOOST_CORE_TYPES);
function raidCoreModValue(stat, lv){ return Math.round((BASE_FOR_STAT(stat))*(1+(lv-1)*0.95)*10)/10; }   // 每级 +95%
function BASE_FOR_STAT(stat){
  for(const k in BOOST_CORE_TYPES){ const i=BOOST_CORE_TYPES[k].stats.indexOf(stat); if(i>=0) return BOOST_CORE_TYPES[k].base[i]; }
  if(stat==="elemPct") return 30; if(stat==="elemChance") return 13;   // 弹种适配组件
  return 14;
}
function raidCoreMods(coreType, sub, lv){
  lv=M.clamp(Math.round(lv||1),1,RAID_CORE_MAX);
  if(coreType==="elem"){
    const E=ELEMENTS[sub]||ELEMENTS.fire;
    return [
      { stat:"elemPct",    value: raidCoreModValue("elemPct", lv) },
      { stat:"elemChance", value: 0 },   // 不再有弹种增益
    ];
  }
  if(coreType==="chaos") return [];   // 膛压组件：效果由「改装等级」承载，无词条
  const def=BOOST_CORE_TYPES[sub];
  if(def) return def.stats.map((s,i)=>({ stat:s, value: Math.round(def.base[i]*(1+(lv-1)*0.95)*10)/10 }));   // 每级 +95%
  return [];
}
function raidCoreName(c){
  if(!c) return "改装模块";
  if(c.core==="chaos") return `膛压组件 [${RAID_ROMAN[c.lv]||c.lv}]`;
  if(c.core==="elem"){ const E=AMMO_TYPES[c.elem]||AMMO_TYPES.fire; return `弹种适配组件·${E.short} [${RAID_ROMAN[c.lv]||c.lv}]`; }
  if(c.core==="boost"){ const d=BOOST_CORE_TYPES[c.boost]; return `${d?d.name:"改装模块"} [${RAID_ROMAN[c.lv]||c.lv}]`; }
  return "改装模块";
}
function raidCoreColor(c){
  if(!c) return "#8fb0c8";
  if(c.core==="chaos") return "#b08a58";
  if(c.core==="elem"){ const E=AMMO_TYPES[c.elem]||AMMO_TYPES.fire; return E.color; }
  if(c.core==="boost"){ const d=BOOST_CORE_TYPES[c.boost]; return d?d.color:"#b09a4c"; }
  return "#8fb0c8";
}
function _mkCore(o){
  const lv=M.clamp(Math.round(o.lv||1),1,RAID_CORE_MAX);
  const rar=RAID_CORE_RARITY[lv-1]||"blue";
  // 子类型：弹种适配组件用 elem、改装模块用 boost、膛压组件无
  const sub = o.core==="boost" ? (o.boost||o.sub) : (o.core==="elem" ? (o.elem||o.sub) : o.sub);
  return Object.assign({
    uid:"co"+Math.floor(Math.random()*1e9).toString(36),
    kind:"part", slot:"core",
    lv, rarity:rar,
    value: raidCoreValue(o.core, lv),
    ilvl: lv*8,
    mods: raidCoreMods(o.core, sub, lv),
    affixes: [],
  }, o);
}
function raidMakeElemCore(elem, lv){
  const E=AMMO_TYPES[elem]||AMMO_TYPES.fire;
  return _mkCore({ core:"elem", elem:E.id, lv,
    name:`弹种适配组件·${E.short} [${RAID_ROMAN[lv]}]`, color:E.color });
}
function raidMakeChaosCore(lv){
  return _mkCore({ core:"chaos", lv,
    name:`膛压组件 [${RAID_ROMAN[lv]}]`, color:"#b08a58" });
}
function raidMakeBoostCore(type, lv){
  const d=BOOST_CORE_TYPES[type]||BOOST_CORE_TYPES.berserk;
  return _mkCore({ core:"boost", boost:type, lv,
    name:`${d.name} [${RAID_ROMAN[lv]}]`, color:d.color });
}
// 改装槽数量：由枪械稀有度档位决定（白板 1 个 → 每升一档 +1，最高 8 个）
function raidCoreSlotCount(rarityId){
  const idx = Math.max(0, RARITIES.findIndex(r=>r.id===(rarityId||"white")));
  return M.clamp(idx+1, 1, 8);
}
// 重排枪械上的改装槽位序号为 core0..coreN（保证每个改装槽位唯一、无空洞）
function raidReindexCores(gun){
  let i=0;
  for(const p of (gun.parts||[])){ if(p && p.core){ p.slot="core"+i; i++; } }
}
/* 膛压组件掉落分布单独走一套权重 —— 每高一级权重减半（i+1 = i / 2）。
 * 高改装等级需要极其罕见的对应组件，膛压组件在模块掉落里占 25%。 */
const RAID_CHAOS_LV_W = [40, 20, 10, 5, 2.5];
const RAID_CHAOS_CORE_SHARE = 0.25;
function raidRollCore(luck){
  // 7 成概率产出改装模块（箱子里最常见的模块），3 成走弹种 / 膛压组件
  if(RNG.chance(0.30)){
    if(RNG.chance(RAID_CHAOS_CORE_SHARE)){
      // 固定减半分布：不受携带估值影响（luck 只作用于弹种适配组件）
      const lv = M.clamp(1 + raidLuckPick(RAID_CHAOS_LV_W, 0, []), 1, RAID_CORE_MAX);
      return raidMakeChaosCore(lv);
    }
    const lv = M.clamp(1 + raidLuckPick([40,30,16,9,5], luck, [0,0.4,1.1,2.2,3.6]), 1, RAID_CORE_MAX);
    return raidMakeElemCore(RNG.pick(RAID_ELEM_CORE_ELEMS), lv);
  }
  const t=RNG.pick(BOOST_CORE_IDS);
  const lv=M.clamp(1+RNG.weighted([{weight:34},{weight:28},{weight:20},{weight:11},{weight:7}]),1,RAID_CORE_MAX);
  return raidMakeBoostCore(t, lv);
}

/* ----------------------------- 枪械底材（机匣） ----------------------------- */
const RAID_RECEIVERS = [
  { id:"recAR",  name:"突击步枪机匣", short:"AR机匣",  type:"rifle",   tier:2, value:2600,  cost:{steel:3, alloy:1} },
  { id:"recSR",  name:"狙击机匣",     short:"SR机匣",  type:"sniper",  tier:3, value:7200,  cost:{steel:4, magnet:2} },
  { id:"recSMG", name:"冲锋枪机匣",   short:"SMG机匣", type:"smg",     tier:1, value:1400,  cost:{steel:2, polymer:2} },
  { id:"recSG",  name:"霰弹枪机匣",   short:"SG机匣",  type:"shotgun", tier:1, value:1100,  cost:{scrap:4, rubber:2} },
  { id:"recPS",  name:"手枪机匣",     short:"PS机匣",  type:"pistol",  tier:0, value:700,   cost:{scrap:3, cloth:2} },
  // v0.21.3：榴弹发射器底材 —— 投料 32 份（RAID_RECV_SLOTS.launcher），产线最贵的一档
  { id:"recGL",  name:"榴弹发射器机匣", short:"GL机匣", type:"launcher", tier:4, value:16000, cost:{steel:8, alloy:4} },
];
const RAID_RECEIVER_BY_ID={}; for(const r of RAID_RECEIVERS) RAID_RECEIVER_BY_ID[r.id]=r;
function raidMakeReceiver(r, tier){
  // 机匣等级不再写死，由合成时投入的材料等级决定
  const t = (tier===undefined || tier===null) ? r.tier : M.clamp(Math.round(tier),0,8);
  const name = t===r.tier ? r.name : `${RAID_TIERS[t].name}·${r.name}`;
  return { kind:"receiver", id:r.id, name, short:r.short, gunType:r.type,
    tier:t, rarity:t, value:Math.round(r.value*(1+RAID_RARITY_VAL[t]*1.4)),
    color:RAID_RARITY_COLOR[t],
    uid:"rc"+Math.floor(Math.random()*1e9).toString(36) };
}

/* ----------------------------- 合成表（自选原材料 → 产物） -----------------------------
 * 配方不再写死材料，改成「槽位 + 自选材料」。
 * 产物品质 = 所选材料平均等级（T0 材料 → 普通，T8 材料 → 原型），
 * 材料越混搭浮动越大，同阶材料越多产物越稳定、越贴近材料本身等级。 */
function raidAvgMatTier(mats){
  if(!mats||!mats.length) return 0;
  return mats.reduce((s,m)=>s+(m.tier||0),0)/mats.length;
}
function raidCraftJitter(mats){
  const avg=raidAvgMatTier(mats);
  const tiers=(mats||[]).map(m=>m.tier||0);
  const spread=tiers.length?Math.max(...tiers)-Math.min(...tiers):0;
  return (avg<2?0.95:avg<5?0.75:0.50) + spread*0.12;
}
// 实际掷品质（点「合成」时调用一次）
function raidCraftQTier(mats){
  if(!mats||!mats.length) return 0;
  const avg=raidAvgMatTier(mats), j=raidCraftJitter(mats);
  return M.clamp(Math.round(avg + RNG.fr(-j, j)), 0, 8);
}
// 预览用区间（纯函数，不消耗随机数，避免每次重绘数字乱跳）
function raidCraftQRange(mats){
  if(!mats||!mats.length) return [0,0];
  const avg=raidAvgMatTier(mats), j=raidCraftJitter(mats);
  return [M.clamp(Math.round(avg-j),0,8), M.clamp(Math.round(avg+j),0,8)];
}
function raidCraftFee(mats, slots){
  const avg=raidAvgMatTier(mats);
  const n=slots || (mats&&mats.length) || 3;
  const scale=M.clamp(0.6 + 0.11*n, 0.8, 2.6);   // 2 槽 0.82× · 6 槽 1.26× · 12 槽 1.92× · 16~20 槽封顶 2.6×
  return Math.round((160 + 150*avg + 30*avg*avg)*scale/10)*10;
}

// slots: 需要几个原材料；make(mats, qTier) 产出成品
const RAID_RECIPES = [
  // 注意：弹种适配组件 / 膛压组件 不在合成表内——只能从突袭箱子里搜出，或在拍卖行竞拍
  { id:"r_medkit", name:"医疗品", kind:"med", tag:"医疗", slots:2,
    desc:"按材料等级产出 绷带 / 止血针 / 急救包 / 强心针 / 手术包",
    make:(mats,q)=>{
      const t=M.clamp(Math.round(q*0.55),0,4);
      const pool=RAID_MEDS.filter(m=>m.tier===t);
      return raidMakeMed((pool.length?RNG.pick(pool):RAID_MEDS[0]).id);
    } },
  { id:"r_part", name:"枪械配件", kind:"part", tag:"配件", slots:2,
    desc:"产出与材料同档的配件 · 槽位随机 · 带前后缀",
    make:(mats,q)=>rollPart(RNG.pick(GUN_SLOTS).id, 10+q*3, RAID_TIER_TO_RARITY[q]) },
  { id:"r_armor", name:"护甲板", kind:"armor", tag:"装备", slots:16,
    desc:"产出与材料同档的护甲（品质在档位内浮动）",
    make:(mats,q)=>raidMakeArmor(M.clamp(q+1,1,9), M.clamp(q,0,8)) },
  { id:"r_helmet", name:"战术头盔", kind:"helmet", tag:"装备", slots:9,
    desc:"产出与材料同档的头盔（品质在档位内浮动）",
    make:(mats,q)=>raidMakeHelmet(M.clamp(q+1,1,9), M.clamp(q,0,8)) },
  { id:"r_shield", name:"护盾发生器", kind:"shield", tag:"装备", slots:12,
    desc:"产出与材料同档的护盾 · 4 个配件 + 前后缀 + 独特加成",
    make:(mats,q)=>raidMakeShield(M.clamp(q+1,1,9), M.clamp(q,0,8)) },
];
// 底材按枪型定投料量——枪越大结构越复杂，要的材料越多
const RAID_RECV_SLOTS = { rifle:16, sniper:20, smg:6, shotgun:12, pistol:2, launcher:32 };
for(const r of RAID_RECEIVERS){
  const slots = RAID_RECV_SLOTS[r.type] || 3;
  RAID_RECIPES.push({ id:"r_"+r.id, name:r.name, kind:"receiver", tag:"底材", slots:slots,
    desc:`组装枪的底材 · ${WEAPON_TYPES[r.type]?WEAPON_TYPES[r.type].name:r.type} · 需 ${slots} 份材料 · 等级由材料决定`,
    make:(mats,q)=>raidMakeReceiver(r, M.clamp(q,0,8)) });
}

/* v0.20.0：弹药合成 —— 每个弹族一张配方，产出的「级别」由投料品质决定。
 * 材料越贵弹药越高级；一次固定出 30 发。
 * v0.21.3：投料份数按弹族分档（轻 1 / 中 2 / 重 4 / 榴弹 8）—— 越重的弹越费材料。 */
const AMMO_CRAFT_SLOTS = { light:1, mid:2, heavy:4, grenade:8 };
for(const cal of AMMO_CAL_LIST){
  const slots = AMMO_CRAFT_SLOTS[cal] || 3;
  RAID_RECIPES.push({
    id:"r_ammo_"+cal, name:AMMO_CALS[cal].name+"（30 发）", kind:"ammo", tag:"弹药", slots:slots,
    desc:`产出 ${AMMO_CALS[cal].spec} · 适用 ${AMMO_CALS[cal].types.map(t=>WEAPON_TYPES[t]?WEAPON_TYPES[t].name:t).join(" / ")} · 每次 ${slots} 份材料 → ${RAID_AMMO_STACK} 发 · 级别由材料品质决定`,
    make:(mats,q)=>({ kind:"ammo", id:ammoItemId(cal, M.clamp(1+Math.floor(q*0.62),1,5)), n:RAID_AMMO_STACK }),
  });
}

/* v0.21.7：钥匙重新可以合成 —— 造价 16 份原材料，产出的级别由投料品质决定（I~V）。
 * 钥匙仍然是稀缺资源：16 份料不是小数，够买半把枪了，所以「合成一把钥匙」永远是个取舍。 */
RAID_RECIPES.push({
  id:"r_key", name:"保险箱钥匙", kind:"key", tag:"钥匙", slots:16,
  desc:`投入 16 份材料 → 1 把钥匙（I~V 级，级别由材料品质决定）· 越好的料出越高级的钥匙`,
  make:(mats,q)=>{
    const lv = M.clamp(1 + Math.round(q*0.62), 1, 5);
    return raidMakeKey(lv);
  },
});

/* v0.19.0：保证一把枪至少 1 条词缀；条数由 rollAffixCount 决定（大多数只有 1 条，
 * 少数 2 条及以上）。旧版强制「1 前缀 + 1 后缀」，导致每把枪都恰好 2 条，数量过于单一。 */
function ensureGunAffixes(w){
  if(!w) return w;
  w.affixes=w.affixes||[];
  if(w.affixes.length) return w;
  const R0=RARITY_BY_ID[w.rarity]||RARITIES[0];
  const R = (R0.affixes && R0.affixes[1]>0) ? R0 : Object.assign({}, R0, {affixes:[2,2]});
  const pool=rollAffixes(R, w.ilvl||14, {element:w.element||"none", splash:w.splash||0});
  const want=Math.max(1, rollAffixCount(w.rarity));
  w.affixes=pool.slice(0, want);
  // 兜底：词条池被抽空时也给一条可解释的工艺词缀
  if(!w.affixes.length)
    w.affixes=[{ kind:"prefix", nm:"精磨枪管", mods:[{ stat:"dmgPct", value:6 }] }];
  return w;
}

// 塔科夫枪械显示：优先使用本次掉落的 qTier/qName/qColor（与 9 阶品质刻度一致）
function raidGunColor(g){
  if(weaponQualityHidden()) return "#cfcabb";
  return (g && g.qColor) ? g.qColor : gunRarColor(g && g.rarity);
}
function raidGunName(g){
  if(weaponQualityHidden()) return "";
  return (g && g.qName) ? g.qName : ((g && g.rarity && RARITY_BY_ID[g.rarity]) ? RARITY_BY_ID[g.rarity].name : "普通");
}

/* 配件小徽章：物品栏武器卡与融合台结果卡共用（原先定义在 UI.raidStash 内部，
 * 抽成共享武器卡后必须提到全局，否则会 ReferenceError） */
function partChip(pt){
  const col=(RARITY_BY_ID[pt.rarity]||{color:"#cfd8e2"}).color;
  const sn=GUN_SLOT_BY_ID[pt.slot]?GUN_SLOT_BY_ID[pt.slot].name:pt.slot;
  return `<span class="part-chip" style="border-color:${col};color:${col}">${partNameOf(pt)}<em>${partText(pt)}</em></span>`;
}

/* 共享的武器卡片渲染：物品栏与融合台结果卡用同一套，保证显示完全一致
 * opts.prefix  前缀文案（如「融合成功 · 」）
 * opts.sell    是否带售卖/拆解按钮（物品栏 true，融合结果卡 false）
 * opts.margin  是否带纵向外边距（融合结果卡 true） */
function raidWeaponCard(w, opts){
  opts=opts||{};
  const col=raidGunColor(w);
  const tname=WEAPON_TYPES[w.type]?WEAPON_TYPES[w.type].name:(w.cat||w.type||"枪械");
  const parts=(w.parts||[]);
  const sellP=gunSellPrice(w);
  const head=(opts.prefix||"")+gunNameOf(w);
  return `<div class="shop-item" style="border-left-color:${col}${opts.margin?';margin:12px 0':''}">
    <div class="si-name" style="color:${col}">${head}</div>
    <div class="si-meta">${tname} · ${parts.length} 个配件${w.uniqPerk?' · <b style="color:#ffd23f">具名装备</b>':''}${w.pellets>1&&w.type!=="shotgun"?` · <b style="color:#ffd54a">${w.pellets} 发/次</b>`:''}</div>
    ${w.uniqPerk?`<div class="uniq-perk">✦ ${w.uniqPerk}</div>`:''}
    <div class="si-stats">伤害 ${w.dmg} · 弹匣 ${w.mag} · 射速 ${w.rpm} · 估值 ₽${priceTextShort(w.value)}
      ${parts.length?`<br><span class="part-row">${parts.slice(0,4).map(partChip).join("")}</span>`:''}</div>
    ${opts.sell?`<div class="si-buy"><span class="si-price">₽ ${priceTextShort(sellP)}</span>
        <button class="btn ghost" data-sell="w:${w.uid}">售卖</button>
        <button class="btn ghost" data-salvage="${w.uid}">拆解</button></div>`:''}
  </div>`;
}


/* 护甲 / 头盔词缀：每件都必带 1 前缀 + 1 后缀（强度随品质提升） */
const RAID_ARMOR_PREFIX = [
  { nm:"加固的", dr:0.012 }, { nm:"复合的", dr:0.016 }, { nm:"轻量的", dr:0.008 },
  { nm:"陶瓷的", dr:0.014 }, { nm:"凯夫拉内衬", dr:0.020 }, { nm:"钢制的", dr:0.018 },
  { nm:"重装的", dr:0.024 }, { nm:"多层插板的", dr:0.022 },
];
const RAID_ARMOR_SUFFIX = [
  { nm:"·耐冲击", armor:10 }, { nm:"·缓冲层", armor:14 }, { nm:"·可维修", armor:8 },
  { nm:"·复合层压", armor:18 }, { nm:"·轻量化", armor:6 }, { nm:"·军用规格", armor:16 },
  { nm:"·陶瓷面板", armor:24 }, { nm:"·钛合金扣具", armor:20 },
];
function raidRollArmorAffixes(rar){
  const k = 1 + (rar||0)*0.55;
  const p = RNG.pick(RAID_ARMOR_PREFIX), s = RNG.pick(RAID_ARMOR_SUFFIX);
  return [
    { kind:"prefix", nm:p.nm, mods:[{ stat:"dr", value: Math.round(p.dr*k*1000)/1000 }] },
    { kind:"suffix", nm:s.nm, mods:[{ stat:"armor", value: Math.round(s.armor*k) }] },
  ];
}
function raidAffixSum(affixes, stat){
  let v=0;
  for(const a of (affixes||[])) for(const m of (a.mods||[])) if(m.stat===stat) v+=m.value;
  return v;
}
function raidArmorStats(base, rar, affixes){
  const aDr = raidAffixSum(affixes,"dr");
  const aArm = raidAffixSum(affixes,"armor");
  return {
    rarity: rar,
    affixes: affixes||[],
    dr: Math.round(Math.min(0.92, base.dr + RAID_RARITY_DR[rar] + aDr)*1000)/1000,
    maxArmor: Math.round(base.maxArmor*(1+RAID_RARITY_ARM[rar])*(1+aArm/100)),
    armorRegen: 0,   // 现实护甲耐久只能维修，不自动回复
    value: Math.round(base.value*(1+RAID_RARITY_VAL[rar]+(affixes?0.24:0))/100)*100,
  };
}
// 装备名 = 前缀 + 底名 + 后缀（所有护甲 / 头盔都有前后缀）
function raidArmorName(baseName, affixes, rar){
  const p=(affixes||[]).find(a=>a.kind==="prefix");
  const s=(affixes||[]).find(a=>a.kind==="suffix");
  return (p?(p.nm+" "):"") + baseName + (s?s.nm:"");
}

// 生成一件指定等级的护甲 / 头盔（rarity 省略时按等级掷稀有度）
function raidMakeArmor(tier, rarity){
  const t = M.clamp(Math.round(tier||1), 1, 9);
  const r = rarity===undefined ? raidRollArmorRarity(t) : M.clamp(Math.round(rarity),0,8);
  const af = raidRollArmorAffixes(r);
  return Object.assign({
    uid:"ar"+Math.floor(Math.random()*1e9).toString(36), kind:"armor", tier:t,
    baseName:RAID_ARMORS[t].name,
    name: raidArmorName(RAID_ARMORS[t].name, af, r),
  }, raidArmorStats(RAID_ARMORS[t], r, af));
}
function raidMakeHelmet(tier, rarity){
  const t = M.clamp(Math.round(tier||1), 1, 9);
  const r = rarity===undefined ? raidRollArmorRarity(t) : M.clamp(Math.round(rarity),0,8);
  const af = raidRollArmorAffixes(r);
  return Object.assign({
    uid:"hm"+Math.floor(Math.random()*1e9).toString(36), kind:"helmet", tier:t,
    baseName:RAID_HELMETS[t].name,
    name: raidArmorName(RAID_HELMETS[t].name, af, r),
  }, raidArmorStats(RAID_HELMETS[t], r, af));
}
// 价格千分位（₽ 128,000）
function priceText(v){
  return String(Math.max(0, Math.round(v||0))).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
// 大额价格的紧凑写法（具名装备动辄上千万，卡片里放不下千分位）
function priceTextShort(v){
  v=Math.max(0, Math.round(v||0));
  if(v>=1e8) return (v/1e8).toFixed(2).replace(/\.?0+$/,"")+"亿";
  if(v>=1e4) return (v/1e4).toFixed(v>=1e6?0:1).replace(/\.0$/,"")+"万";
  return String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
// 护甲/头盔等级 → 颜色（T1 灰 → T9 黄铜）
// 补上索引 9（原表缺 T9，护甲卡片会渲染出 color:undefined），并统一为低饱和军规色
const ARMOR_TIER_COLOR = ["#9aa4b2","#9aa4b2","#9db39a","#93ad7c","#7b9ab5","#9c8fb5","#c68b4c","#b06a62","#c2a76a","#c9b878"];

// 所有新物品统一用尽量唯一的 uid；商店反复购买不再产生重复 uid。
function raidUniqueUid(prefix){
  try{
    if(typeof crypto!=="undefined" && typeof crypto.randomUUID==="function")
      return String(prefix||"")+crypto.randomUUID();
  }catch(e){}
  return String(prefix||"")+Date.now().toString(36)+Math.random().toString(36).slice(2,9);
}

function raidGunFromItem(it){ return Object.assign({}, it); }

/* ----------------------------- 仓库持久化 ----------------------------- */
// 给旧枪补齐配件（老存档迁移用）
function ensureGunParts(w){
  if(!w) return w;
  if(w.parts && w.parts.length) return w;
  if(!w.type || !RARITY_BY_ID[w.rarity]) return Object.assign({parts:[]}, w);
  const parts = rollGunParts(w.type, w.ilvl||10, w.rarity);
  const out = blGunConvert(generateWeapon(w.ilvl||10, {
    rarity:w.rarity, type:w.type, manufacturer:w.manufacturer,
    ilvl:w.ilvl, mayhem:w.mayhem||0, element:w.element||"none",
    affixes:w.affixes||[], parts,
  }));
  out.uid=w.uid; out.kind="weapon";
  return out;
}
// 旧护甲（light/heavy）→ 新 tier 格式；数值重做后统一按新表重算
function ensureArmorTier(a){
  if(!a) return a;
  const isHelm = a.kind==="helmet" || (a.name||"").indexOf("盔")>=0;
  if(!a.tier){
    const tier = a.id==="heavy" ? 4 : (a.id==="light" ? 2 : 3);
    const b = RAID_ARMORS[tier];
    a = Object.assign({}, a, {
      kind:"armor", tier, id:undefined,
      name:a.name && a.name.indexOf("护甲")>=0 ? b.name : (a.name||b.name),
    });
  }
  if(a.rarity===undefined) a.rarity=0;
  if(a.baseVer!==3){
    const base = (isHelm ? RAID_HELMETS : RAID_ARMORS)[a.tier] || RAID_ARMORS[1];
    if(!a.affixes || a.affixes.length<2) a.affixes = raidRollArmorAffixes(a.rarity|0);
    const st = raidArmorStats(base, M.clamp(a.rarity|0,0,8), a.affixes);
    a.dr=st.dr; a.maxArmor=st.maxArmor; a.armorRegen=st.armorRegen;
    a.value=st.value; a.baseName=base.name;
    a.name=raidArmorName(base.name, a.affixes, a.rarity|0);
    a.baseVer=3;
  }
  if(!a.affixes) a.affixes = raidRollArmorAffixes(a.rarity|0);
  if(!a.baseName) a.baseName = ((isHelm ? RAID_HELMETS : RAID_ARMORS)[a.tier]||RAID_ARMORS[1]).name;
  return a;
}

const RaidStash = {
  KEY:"raid_stash_v2",
  load(){
    const seed=()=>{
      const a=blGunGen(11,{type:"rifle",rarity:"blue"}); a.uid="seed-rifle"; a.kind="weapon";
      const b=blGunGen(11,{type:"smg",rarity:"green"});  b.uid="seed-smg";   b.kind="weapon";
      return { creds:800, gunVer:3, weapons:[a,b],
        armors:[raidMakeArmor(2,0)],
        helmets:[raidMakeHelmet(2,0)],
        shields:[raidMakeShield(2,0)],
        parts:[], materials:[], cores:[], receivers:[], meds:{hemo:0,medkit:0,stim:0,surgery:0}, bandages:1,
        tokens:0, keys:[raidMakeKey(1)],
        ammo:Object.assign({}, RAID_AMMO_STARTER) };
    };
    try{
      const r=localStorage.getItem(this.KEY);
      if(r){
        const d=JSON.parse(r);
        if(d && d.weapons){
          if(d.gunVer!==3){            // 旧档迁移：补配件 / 护甲分级
            d.gunVer=3;
            d.weapons=(d.weapons||[]).map(ensureGunParts);
          }
          /* v0.21.1：不再改写旧档枪名（改了就回不去）。只清掉缓存的精简名，
           * 让 gunNameOf() 按当前「精简 / 完整」设置重新推导。 */
          for(const w of (d.weapons||[])){ if(w) delete w.short; }
          // 护甲 / 头盔：无论档位版本，一律按当前数值表校正
          d.armors=(d.armors||[]).map(ensureArmorTier);
          d.helmets=(d.helmets||[]).map(ensureArmorTier);
          // v0.16.0：老档没有护盾栏 → 补空数组；已有护盾走字段迁移
          d.shields=(d.shields||[]).map(ensureShield);
          if(!d.armors) d.armors=[];
          if(!d.helmets) d.helmets=[];
          if(!d.shields) d.shields=[];
          if(!d.parts) d.parts=[];
          if(!d.materials) d.materials=[];
          if(!d.cores) d.cores=[];
          if(!d.receivers) d.receivers=[];
          if(!d.meds) d.meds={hemo:0,medkit:0,stim:0,surgery:0};
          // 旧独立改装模块库存 stash.cores → 并入配件池（slot:"core"）
          if(d.cores && d.cores.length){
            for(const c of d.cores){
              const lv=c.lv||1;
              d.parts.push({ uid:c.uid||("co"+Math.random().toString(36).slice(2)),
                kind:"part", slot:"core", core:c.core, elem:c.elem, boost:c.boost, lv,
                name:c.name||raidCoreName({core:c.core,elem:c.elem,boost:c.boost,lv}),
                rarity:RAID_CORE_RARITY[lv-1]||"blue", value:c.value||raidCoreValue(c.core,lv),
                color:c.color||raidCoreColor(c), ilvl:lv*8,
                mods:raidCoreMods(c.core,c.elem||c.boost,lv), affixes:[] });
            }
            delete d.cores;
          }
          if(d.bandages===undefined) d.bandages=1;
          if(d.creds===undefined) d.creds=800;
          if(d.tokens===undefined) d.tokens=0;      // GP 币
          /* v0.20.0：子弹变成独立物品 —— 旧档没有弹药栏就发一套民用弹，
           * 旧枪身上残留的 loaded 一律作废（按约定统一回落到 T1 民用弹）。 */
          if(!d.ammo || typeof d.ammo!=="object") d.ammo=Object.assign({}, RAID_AMMO_STARTER);
          for(const k in d.ammo){ if(!ammoParseId(k) || !(d.ammo[k]>0)) delete d.ammo[k]; }
          for(const w of (d.weapons||[])){
            if(w && w.loaded && !ammoParseId(w.loaded)) delete w.loaded;
            if(w && !w.cal) w.cal=ammoCalOfType(w.type);
          }
          if(!Array.isArray(d.keys)) d.keys=[];      // 钥匙（5 级）
          for(const k of d.keys){ if(!k.uses) k.uses=raidKeyDef(k.lv).uses; if(!k.maxUses) k.maxUses=raidKeyDef(k.lv).uses; }
          return d;
        }
      }
    }catch(e){}
    // 首次进游戏就把默认档落盘 —— 否则每次 load 都会重新生成一把
    // 带随机 uid 的钥匙，导致「钥匙勾选」状态在每次重渲染时被当成已失效而清空。
    const d=seed(); this.save(d); return d;
  },
  save(d){ try{ localStorage.setItem(this.KEY, JSON.stringify(d)); return true; }catch(e){ return false; } },
};

/* ----------------------------- PMC / Scav ----------------------------- */
class RaidOperator {
  constructor(o){
    this.id=o.id; this.name=o.name; this.isPlayer=!!o.isPlayer; this.cls=o.cls||"pmc"; this.bounty=!!o.bounty;
    this.x=o.x; this.y=o.y; this.angle=o.angle!==undefined?o.angle:0;
    this.r=13; this.speed=o.speed||150; this.color=o.color||"#e06a4a";
    // 护甲 / 头盔按 tier 给角色额外血量，高 tier 装备更耐打
    const eqHP=(o.armorTier||0)*14 + (o.helmetTier||0)*8;
    this.hp=(o.hp||100)+eqHP; this.maxHP=this.hp;
    this.armor=o.armor||0; this.maxArmor=this.armor; this.dr=o.dr||0;
    // 打穿即报废：纳米自愈不能把已归零的护甲救回来（否则「回归血肉」会每帧反复横跳）
    this.armorBroken=this.maxArmor>0 && this.armor<=0;
    // v0.14.11：能量护盾层（精锐 / Boss）——优先级高于护甲，破盾后才轮到护甲，
    // 让「护盾型蓝血条 / 电击 ×2.00」在塔科夫模式里真的有目标。
    this.shieldGear=o.shieldGear||null;
    this.shieldPerks=(o.shieldPerks||[]).slice();
    const _sp=new Set(this.shieldPerks);
    this.shield=o.shield||0; this.maxShield=this.shield;
    this.shieldRate=o.shieldRate||0;
    this.shieldDelay=o.shieldDelay||0;
    this.shieldTimer=0;                 // 受击后需等待的充能延迟余量
    this.shieldInvuln=0;                // 破盾无敌余量
    this.shieldInvulnBase=o.shieldInvulnBase||0;
    this.shieldAbsorbMul=_sp.has("emitter")?1.08:1;   // 定向泄能：护盾吸伤 +8%
    // 头盔：独立耐久池，只吸收「头部命中」的那部分伤害
    this.helmetArmor=o.helmetArmor||0; this.maxHelmetArmor=this.helmetArmor;
    this.helmetDr=o.helmetDr||0; this.helmetTier=o.helmetTier||0;
    this.armorTier=o.armorTier||0;
    this.armorRegen=o.armorRegen||0;   // 护甲耐久不再自动回复，仅保留字段兼容旧存档
    this.gun=o.gun||null; this.secondary=o.secondary||null;
    /* 每把枪独立记录弹药（修复：换枪瞬间满弹的漏洞）。
     * v0.20.0：玩家的子弹在背包里，装填由 _prepPlayerAmmo / 换弹流程决定，
     * 这里只给 AI 直接满上（AI 没有物品栏，靠「翻尸补弹」维持）。 */
    if(this.gun && !this.isPlayer){ this.gun.ammoMag=this.gun.mag; this.gun.ammoRes=this.gun.reserve; }
    if(this.secondary && !this.isPlayer){ this.secondary.ammoMag=this.secondary.mag; this.secondary.ammoRes=this.secondary.reserve; }
    // —— v1.0 AI 独立搜刮：每人自己的背包 / 钱包 / 智能等级 ——
    this.inv=o.inv||{ weapons:[], armors:[], helmets:[], parts:[], materials:[], meds:[], cores:[], receivers:[] };
    this.creds=o.creds||0;
    this.smart=!!o.smart;
    // 增援小队 / 撤离点封锁者
    this.squadId=o.squadId||null;
    this.isLeader=!!o.isLeader;
    this.blockZone=o.blockZone||null;
    this.lootTarget=null; this.lootT=0; this.aiT=RNG.f()*1.2;
    this.lootCount=0; this.lootLimit=(o.lootLimit!==undefined && o.lootLimit!==null) ? o.lootLimit : (this.smart?9:5);
    this.bandages=(o.bandages!==undefined && o.bandages!==null) ? o.bandages : (this.smart?3:(o.cls==="pmc"?2:1));
    this.medT=0;
    this._lastSeen=0;
    this.fireCd=0; this.reloadT=0; this.alive=true;
    this._dodgeT=0; this._dodgeSide=1;   // 子弹擦身时的侧闪计时 / 方向
    this.moveX=0; this.moveY=0; this.vx=0; this.vy=0;
    this.roamT=0; this.roamPt=null; this.state="roam"; this._stuck=0;
    this.kills=0;
    // 塔科夫式流血状态（玩家用）
    this.bleed=0;
    // v0.14.10：冰冻剩余时间（秒）；元素克制提示节流
    this.freezeT=0;
    this._elemTipT=-99;
    /* v0.14.11 元素持续状态（灼烧 / 破甲 / 电磁干扰 / 辐射标记）
     * 全部只在「本地结算侧」写入：远端玩家与影子 AI 由各自权威端负责，避免联机重复结算。 */
    this.burnT=0; this.burnDps=0; this.burnSrc=null;
    this.corrodeT=0; this.shockT=0; this.radT=0;
  }
  activeGun(){ return this.gun; }
}

/* ----------------------------- 主控 ----------------------------- */
