/* =========================================================================
 * raid.js — 塔科夫模式（Escape from Tarkov 风格离线突袭）
 *
 * 参考《逃离塔科夫》玩法：
 *   · 硬核撤离射击：地图「海关流域」（工业区 + 北境密林 + 中央河谷 + 铁路枢纽），
 *     PMC 与 Scav 同场（本页用 1 名玩家 + 33 名 AI 模拟满员服务器：30 名普通 AI + 3 名 Boss）；河流可涉水缓行，桥面免减速
 *   · 开局可携带仓库里的装备，也可真空手进场（只带 1 卷绷带，进图翻箱捡枪）
 *   · 中弹会流血，需要绷带止血（桌面 H 键 / 移动端医疗键）
 *   · 撤离点条件化：铁路隧道每局随机开放、旧卡车常驻、雇车撤离费按带入装备估值浮动
 *   · 上锁保险箱分 I~V 级，须用同级钥匙开启（钥匙有使用次数，可买 / 可掉落，不可合成）
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
const RAID_SUPPORT_CASH = 200;  // 带走这么多「卢布现金」进场 → 出生点投放支援物资（按现金，不看配装估值）
const RAID_AMMO_STARTER = {     // 新档 / 旧档迁移时发的起步弹药（全是民用级）
  ammo_light_1: 120, ammo_mid_1: 150, ammo_heavy_1: 60, ammo_grenade_1: 12,
};

/* ----------------------------- 9 阶统一品级 -----------------------------
 * 塔科夫全战利品共用同一套品级刻度（共 9 阶，严格由低到高）：
 *   民用 · 翻新 · 制式 · 军规 · 精工 · 特种 · 试验 · 原型 · 竞赛
 * 改为军工品质刻度和低饱和军规配色；
 *   regen（护甲自动回复）全部归零 —— 现实护甲耐久只能维修，不会待维修。
 * 护甲等级 T1~T9、枪械品级、部件品级、原材料品级全部共用此刻度。 */
const RAID_TIERS = [
  { id:"common",  name:"民用", color:"#cfc9bb", dr:0,     arm:0,    val:0,    regen:0, affix:0 },
  { id:"uncommon",name:"翻新", color:"#93ad7c", dr:0.020, arm:0.15, val:0.40, regen:0, affix:1 },
  { id:"magic",   name:"制式", color:"#7b9ab5", dr:0.040, arm:0.30, val:0.80, regen:0, affix:2 },
  { id:"rare",    name:"军规", color:"#c1a85a", dr:0.062, arm:0.50, val:1.35, regen:0, affix:3 },
  { id:"epic",    name:"精工", color:"#9c8fb5", dr:0.090, arm:0.75, val:2.20, regen:0, affix:4 },
  { id:"legend",  name:"特种", color:"#c68b4c", dr:0.122, arm:1.10, val:3.50, regen:0, affix:5 },
  { id:"ancient", name:"试验", color:"#79a9a2", dr:0.155, arm:1.60, val:5.20, regen:0, affix:6 },
  { id:"myth",    name:"原型", color:"#b06a62", dr:0.190, arm:2.20, val:7.60, regen:0, affix:7 },
  { id:"rainbow", name:"竞赛", color:"#c9b878", dr:0.225, arm:2.90, val:11.0, regen:0, affix:8 },
];
// 护甲稀有度数组（与 RAID_TIERS 一一对应，保留旧字段名以兼容 UI）
const RAID_RARITY_NAME  = RAID_TIERS.map(t=>t.name);
const RAID_RARITY_COLOR = RAID_TIERS.map(t=>t.color);
const RAID_RARITY_DR    = RAID_TIERS.map(t=>t.dr);
const RAID_RARITY_ARM   = RAID_TIERS.map(t=>t.arm);
const RAID_RARITY_VAL   = RAID_TIERS.map(t=>t.val);

// 9 阶品质图例（配装大厅 / 商店展示用）
function raidTierLegend(){
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
const RAID_AI_SENSE = {
  scav: { sight:520,  memory:2.5, react:0.55, hunt:0.30, hear:0.65 },
  pmc:  { sight:900,  memory:5.5, react:0.22, hunt:0.70, hear:1.00 },
  boss: { sight:1250, memory:9.0, react:0.06, hunt:0.95, hear:1.40 },
};
function raidAISense(b){
  if(!b) return RAID_AI_SENSE.scav;
  if(b.bounty) return RAID_AI_SENSE.boss;                    // Boss
  if(b.cls==="pmc") return RAID_AI_SENSE.pmc;                // Raider 由 smart 单独判定
  if(b.smart) return RAID_AI_SENSE.pmc;
  return RAID_AI_SENSE.scav;
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
  const w=pool.map(u=>({ weight:Math.pow(1.55, u.tier-5) }));
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
 *   · 稀有及以上（T3 稀有 / T4 军规）≈ 3.2 件（原 5 件）
 *   · 特种及以上（T5 特种 ~ T8 原型）≈ 0.55 件（原 1 件）
 * 做法：先掷「是否进稀有段 / 特种段」，再在段内按权重挑档。
 * 携带估值的「运气」只做两件小事：段内更偏顶端（T4 而非 T3、T8 而非 T5），
 * 以及总量最多 +30%（3.2%→4.2%）、+40%（0.55%→0.8%），不会把整局刷成紫橙。 */
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
  if(r<pR){   // 稀有段 T3 / T4
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

/* Boss 保底战利品：击杀 Boss「至少 3 件稀有及以上」
 *   ① 一件 T4~T6 原材料　② 一件稀有 / 特种配件　③ 一件稀有以上护甲 / 头盔 / 整枪 */
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
  // ② 配件：稀有起，25% 直接给特种档
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
/* 钥匙不再可合成 —— 只有两条获取路径：
 *   ① 掉落：上锁保险箱（等级 i 的箱子最多掉 i+1 级的钥匙）与 Raider；
 *   ② 购买：材料商店 I~II（卢布）、黑市 III~V（GP 币）。
 * 由此钥匙成为真正的稀缺资源，开箱决策成本更高。 */
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
const RAID_RECV_SLOTS = { rifle:16, sniper:20, smg:6, shotgun:12, pistol:2 };
for(const r of RAID_RECEIVERS){
  const slots = RAID_RECV_SLOTS[r.type] || 3;
  RAID_RECIPES.push({ id:"r_"+r.id, name:r.name, kind:"receiver", tag:"底材", slots:slots,
    desc:`组装枪的底材 · ${WEAPON_TYPES[r.type]?WEAPON_TYPES[r.type].name:r.type} · 需 ${slots} 份材料 · 等级由材料决定`,
    make:(mats,q)=>raidMakeReceiver(r, M.clamp(q,0,8)) });
}

/* v0.20.0：弹药合成 —— 每个弹族一张配方，产出的「级别」由投料品质决定。
 * 材料越贵弹药越高级；投料 3 份，一次固定出 30 发。 */
for(const cal of AMMO_CAL_LIST){
  RAID_RECIPES.push({
    id:"r_ammo_"+cal, name:AMMO_CALS[cal].name+"（30 发）", kind:"ammo", tag:"弹药", slots:3,
    desc:`产出 ${AMMO_CALS[cal].spec} · 适用 ${AMMO_CALS[cal].types.map(t=>WEAPON_TYPES[t]?WEAPON_TYPES[t].name:t).join(" / ")} · 级别由材料品质决定`,
    make:(mats,q)=>({ kind:"ammo", id:ammoItemId(cal, M.clamp(1+Math.floor(q*0.62),1,5)), n:RAID_AMMO_STACK }),
  });
}

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
function raidGunColor(g){ return (g && g.qColor) ? g.qColor : gunRarColor(g && g.rarity); }
function raidGunName(g){ return (g && g.qName) ? g.qName : ((g && g.rarity && RARITY_BY_ID[g.rarity]) ? RARITY_BY_ID[g.rarity].name : "普通"); }

/* 配件小徽章：物品栏武器卡与融合台结果卡共用（原先定义在 UI.raidStash 内部，
 * 抽成共享武器卡后必须提到全局，否则会 ReferenceError） */
function partChip(pt){
  const col=(RARITY_BY_ID[pt.rarity]||{color:"#cfd8e2"}).color;
  const sn=GUN_SLOT_BY_ID[pt.slot]?GUN_SLOT_BY_ID[pt.slot].name:pt.slot;
  return `<span class="part-chip" style="border-color:${col};color:${col}">${pt.name}<em>${partText(pt)}</em></span>`;
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
  const head=(opts.prefix||"")+w.name;
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
          // 隐藏厂商名时，旧仓库里的枪名也要剥前缀（只影响显示名）
          if(typeof CFG!=="undefined" && CFG.showManufacturer===false){
            for(const w of (d.weapons||[])){ if(w && w.name) w.name=stripManufacturer(w.name); }
          }
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
const Raid = {
  active:false,
  map:null,
  player:null,
  ops:[],
  containers:[],
  extracts:[],
  walls:[],
  roomRects:[],
  tracers:[],
  killfeed:[],
  floats:[],
  particles:[],
  camera:{x:0,y:0},
  timer:480,
  creds:0,
  inv:{weapons:[],armors:[],helmets:[],shields:[],parts:[]},
  carried:{weapons:[],armor:null,helmet:null},
  stash:null,
  extractT:0,
  bandages:1, medT:0,
  insured:false, insuredVal:0,
  search:null,
  serverT:8,
  hitFlash:0,
  aimTgt:null,
  uidN:0,
  showInv:false,
  _shownWarn:false,
  // 战利品品质随携带装备估值浮动 + 增援系统
  carriedValue:0,
  carryVal:0,          // 带入装备估值（撤离费 / 商店定价基准）
  tokens:0,            // GP 币（局内拾取 + 撤离结算）
  shops:[],            // 局内商店摊位
  shopOpen:null,       // 当前打开的商店（DOM 面板）
  _rtCache:null,       // 枪械运行时缓存（多枪切换时保留各自弹药）
  lootLuck:0,
  elapsed:0,
  reinforceT:0,
  _squadN:0,
  maxOps:42,

  /* ----------------------------- 启动 ----------------------------- */
  // 启动失败时把已从仓库扣除的装备/现金/钥匙/医疗品原样退回，避免“局没进去装备没了”。
  start(game, opts={}){
    try{ this._start(game, opts); }
    catch(err){
      console.error("[Raid.start]", err);
      try{ this.abortStart(); }catch(e){ console.error("[Raid.abortStart]", e); }
      throw err;
    }
  },

  abortStart(){
    this.active=false; this.spectate=false; this._ended=true;
    const st=this.stash;
    // 只有开局扣装已经成功落盘时才回滚；如果那次 save 失败，旧存档本来就没变，不能再加一遍。
    if(st && this._stashPersisted){
      const carried=this.carried||{ weapons:[], armor:null, helmet:null };
      for(const w of (carried.weapons||[])) if(w) st.weapons.push(w);
      if(carried.armor) st.armors.push(carried.armor);
      if(carried.helmet) st.helmets.push(carried.helmet);
      if(carried.shield) (st.shields=st.shields||[]).push(carried.shield);
      for(const k of ((this.inv&&this.inv.keys)||[])) (st.keys=st.keys||[]).push(k);
      if(this.cashIn) st.creds=(st.creds||0)+this.cashIn;
      if(this.tokensIn) st.tokens=(st.tokens||0)+this.tokensIn;
      if(this.insured) st.creds=(st.creds||0)+(this.insuredVal||0);
      if(this.medsIn) st.meds=Object.assign({},this.medsIn);
      if(this.bandagesIn!==undefined) st.bandages=this.bandagesIn;
      try{ RaidStash.save(st); }catch(e){}
    }
    this.carried={ weapons:[], armor:null, helmet:null, shield:null };
    this.cashIn=0; this.tokensIn=0; this.insured=false; this.insuredVal=0;
    this._stashPersisted=false;
    this.resetUiState();
  },

  // 统一关闭局内所有 DOM 弹层，避免 shopOpen / showInv 跨暂停、跨局残留。
  resetUiState(){
    this.showInv=false;
    this.shopOpen=null;
    this.search=null;
    this.medT=0; this.medUse=null;
    if(typeof document!=="undefined"){
      document.body.classList.remove("inv-open");
      const el=document.getElementById("inv-layer");
      if(el){ el.classList.add("hidden"); el.innerHTML=""; }
    }
  },

  _start(game, opts={}){
    // 联机：所有客户端必须用同一个种子，地图 / 箱子 / 撤离点开放状态才会一致
    this.online=!!opts.online;
    if(this.online && opts.seed) RNG.setSeed(opts.seed>>>0);
    else RNG.setSeed((Date.now()^(Math.random()*1e9))>>>0);
    this.active=true;
    this.game=game;
    this.resetUiState();
    this.carried={ weapons:[], armor:null, helmet:null, shield:null };
    this.medsIn=null; this.bandagesIn=undefined;
    this.cashIn=0; this.tokensIn=0; this.insured=false; this.insuredVal=0;
    this._stashPersisted=false;
    this.map={w:RAID_MAP_W,h:RAID_MAP_H};
    this.tracers=[]; this.killfeed=[]; this.floats=[]; this.particles=[]; this.rockets=[]; this.blasts=[];
    this.timer=480; this.creds=0; this.extractT=0; this.search=null;
    this.bandages=1; this.medT=0; this.medUse=null; this.stimT=0;
    this.meds={hemo:0,medkit:0,stim:0,surgery:0};
    this.insured=false; this.insuredVal=0;
    this.serverT=8; this.hitFlash=0; this.aimTgt=null; this._shownWarn=false;
    this.inv={weapons:[],armors:[],helmets:[],shields:[],parts:[],materials:[],meds:[],cores:[],receivers:[],keys:[],ammo:{}};
    this.uidN=0;
    this.elapsed=0; this.reinforceT=0; this._squadN=0;
    this.spawnGrace=8;                        // 开局 8 秒 AI 不主动锁定（玩家先开枪即失效）
    this.spectate=false; this._ended=false;

    this.stash=RaidStash.load();
    this.tokens=0;                            // 本局拾取的 GP 币（撤离才落袋）
    this._firstKillToken=false;               // 本局首杀名额（首个击杀必得 1 枚）
    /* 医疗品/绷带也要从仓库扣除——阵亡后不能“用掉的还在仓库里”，
     * 成功撤离时再把本局剩余量写回。bandages 用显式判断，0 卷不会再被 ||1 变成 1 卷。 */
    this.medsIn = Object.assign({hemo:0,medkit:0,stim:0,surgery:0}, this.stash.meds||{});
    this.bandagesIn = (this.stash.bandages===undefined || this.stash.bandages===null)
      ? 1 : Math.max(0, Math.floor(this.stash.bandages));
    this.meds = Object.assign({}, this.medsIn);
    this.bandages = this.bandagesIn;
    this.stash.meds = { hemo:0, medkit:0, stim:0, surgery:0 };
    this.stash.bandages = 0;
    this._applyLoadout(opts);
    // 仓库钥匙串随入场携带（最多 8 把，死了就丢；撤离成功才带回）
    this.stash.keys=this.stash.keys||[];
    if(Array.isArray(opts.keys)){
      // 只带玩家勾选的钥匙，未选的留在仓库（不会因为死一局被清空）
      const want=new Set(opts.keys), take=[], keep=[];
      for(const k of this.stash.keys){ if(want.has(k.uid)) take.push(k); else keep.push(k); }
      this.inv.keys=take.slice(0, RAID_INV_CAP.keys);
      this.stash.keys=keep.concat(take.slice(RAID_INV_CAP.keys));
    } else {
      this.inv.keys=this.stash.keys.splice(0, RAID_INV_CAP.keys);
    }
    // 塔科夫式保险：为携带装备投保，阵亡后有几率退回
    const baseVal=this.carried.weapons.reduce((s,w)=>s+(w.value||0),0)
      +(this.carried.armor?(this.carried.armor.value||0):0)
      +(this.carried.helmet?(this.carried.helmet.value||0):0)
      +(this.carried.shield?(this.carried.shield.value||0):0);
    this.carryVal=baseVal;   // 撤离费按带入装备估值浮动
    if(opts.insure && baseVal>0){
      const fee=Math.max(200, Math.round(baseVal*0.35));
      // 联机入口不再经过大厅的 canIns 检查，这里必须确认真的付得起，避免“0 元投保”。
      if((this.stash.creds||0) >= fee){
        this.insured=true;
        this.insuredVal=fee;
        this.stash.creds-=fee;
      }
    }
    // 把玩家选择带入的卢布 / GP 币从仓库搬进本局（阵亡即丢，撤离原样带回）
    {
      const cashIn2=Math.max(0, Math.min(Math.round(opts.cash||0), Math.floor(this.stash.creds||0)));
      const tokIn2=Math.max(0, Math.min(Math.round(opts.tokens||0), Math.floor(this.stash.tokens||0)));
      if(cashIn2>0){ this.stash.creds-=cashIn2; this.creds=cashIn2; }
      if(tokIn2>0){ this.stash.tokens=Math.max(0,(this.stash.tokens||0)-tokIn2); this.tokens=tokIn2; }
      this.cashIn=cashIn2; this.tokensIn=tokIn2;
    }
    // 携带的装备已从仓库取出并保存，防刷新复制；记录是否真的落盘，供启动失败回滚判断。
    this._stashPersisted = RaidStash.save(this.stash);
    if(!this._stashPersisted) throw new Error("仓库写入失败（可能是 localStorage 已满）");

    // 只要带了任何一件装备（枪 / 甲 / 盔），就不再按「裸装」处理
    const carriedAny = this.carried.weapons.length>0 || !!this.carried.armor || !!this.carried.helmet || !!this.carried.shield;

    // 携带装备估值 → 战利品品质浮动因子。
    // 带得越值钱，箱子里刷出高等级 / 高稀有度物品的概率越高；裸装进场则大幅下降。
    this.carriedValue=baseVal;
    // 即使带满配高价值装备入场，品质加成也被压到最多 +55%（原为最高 +93%）
    this.lootLuck = (1 - Math.exp(-baseVal/62000)) * 0.55;   // 30k≈0.21, 100k≈0.44, 裸装=0
    // 带了东西就给一个最低运气档（≈估值 ₽7000），不再顶着「裸装」标签刷最低阶箱子
    if(carriedAny) this.lootLuck = Math.max(this.lootLuck, RAID_LUCK_FLOOR);

    // 携带装备越强，AI 入场装备也越强。
    // gearStrength 归一化：0 = 真空手，≈0.5 = 常规配装，≈1.0 = 满配（ilvl45 + T8 甲 + T8 盔）
    let gIlvlSum=0, gn=0;
    for(const w of this.carried.weapons){ if(w.ilvl){ gIlvlSum+=w.ilvl; gn++; } }
    const avgIlvl = gn ? gIlvlSum/gn : 0;
    const aTier = (this.carried.armor && this.carried.armor.tier) || 0;
    const hTier = (this.carried.helmet && this.carried.helmet.tier) || 0;
    let gs = (avgIlvl/45)*0.5 + (aTier/8)*0.3 + (hTier/8)*0.2;
    // 带装备即脱离裸装档：即便只带一把破手枪，AI 也按「常规配装」起步
    if(carriedAny) gs = Math.max(gs, RAID_GEAR_BASE);
    this.gearStrength = M.clamp(gs, 0, 1.6);

    // 出生点不再固定卡车停车场 —— 全图 3×3 分区抽取，避免每局都从左上角开跑
    const spawnRoom=this._pickSpawnRoom();
    this.spawnRoomId=spawnRoom.id;
    // _buildShops 早于 player 创建，先把出生区中心记下来给「起点补给点」用
    this.spawnPoint={ x:spawnRoom.x+spawnRoom.w/2, y:spawnRoom.y+spawnRoom.h/2 };
    this._buildMap();
    this.containers=[]; this._spawnContainers();

    const sp=this._spawnSafePoint(spawnRoom.x+spawnRoom.w/2, spawnRoom.y+spawnRoom.h/2, 24);
    const px=sp.x, py=sp.y;
    const prim=this.carried.weapons[0];
    const sec=this.carried.weapons[1];
    this._rtCache={};                       // 多枪切换共用的运行时缓存
    this.player=new RaidOperator({
      id:"you", name:"你", isPlayer:true, x:px, y:py, angle:-Math.PI/2,
      speed:184, hp:100, color:"#4fd6ff",
      gun: prim?this._rtGun(prim):null,      // 裸装进场：真的空手，靠局内搜刮捡枪
      secondary: sec?this._rtGun(sec):null,
      armor: this.carried.armor?this.carried.armor.maxArmor:0,
      dr: this.carried.armor?this.carried.armor.dr:0,
      armorTier: this.carried.armor?this.carried.armor.tier:0,
      armorRegen: this.carried.armor?(this.carried.armor.armorRegen||0):0,
      helmetArmor: this.carried.helmet?this.carried.helmet.maxArmor:0,
      helmetDr: this.carried.helmet?this.carried.helmet.dr:0,
      helmetTier: this.carried.helmet?this.carried.helmet.tier:0,
      // v0.16.0：护盾装备 → 容量 / 充能速度 / 充能延迟 / 破盾无敌 / 独特加成
      shieldGear: this.carried.shield||null,
      shield: this.carried.shield?this.carried.shield.capacity:0,
      shieldRate: this.carried.shield?this.carried.shield.rate:0,
      shieldDelay: this.carried.shield?this.carried.shield.delay:0,
      shieldInvulnBase: this.carried.shield?this.carried.shield.invuln:0,
      shieldPerks: this.carried.shield?(this.carried.shield.perks||[]).slice():[],
    });

    // v0.20.0：把仓库里的子弹搬进本局并给枪上膛（必须在 player 建好之后）
    this._prepPlayerAmmo(opts);
    this._dropStarterCache(px, py);
    this._dropSupportCache(px, py);
    if(typeof RaidStash!=="undefined" && RaidStash.save) RaidStash.save(this.stash);

    // AI：补满服务器 —— 只有房主（或单机）生成 AI；客户端等房主快照
    this.ops=[this.player];
    // 入场携带的武器也纳入物品栏统一管理（据此计算容量上限）
    for(const it of this.carried.weapons) this.inv.weapons.push(it);
    const hostSim = !this.online || (typeof Net==="undefined") || Net.isHost;
    if(hostSim){
      const pmcNames=["USEC·猎犬","BEAR·雪松","USEC·游骑兵","BEAR·极地","PMC·审判者","PMC·铁锤"];
      const scavNames=["破烂王·瓦夏","赌徒·谢尔盖","醉汉·鲍里斯","老猎人·米沙","暴躁哥·尤拉","捡漏的·科利亚"];
      const colors=["#e06a4a","#e0b84a","#b06ae0","#4ae0a0","#e04a8a","#7a9be0","#d0d04a","#4ac0d0","#d06a6a"];
      // AI 全图刷 —— 取消"只刷在距玩家>620px 房间"的限制，
      // 改为先构建全图候选生成点池（房间内部点 + 院子/道路室外点），再均匀挑选，
      // 让整张地图（含玩家附近的房间与街道）都散布 AI，而不是只在最远端扎堆。
      const cand=[];
      for(const r of RAID_ROOMS){
        if(r.extract || r.id===spawnRoom.id) continue;
        for(let t=0;t<3;t++){
          const raw=this._openPointInRoom(r, 78);
          const pt=this._spawnSafePoint(raw.x, raw.y, 16);
          if(!this._blockedAt(pt.x,pt.y,15)) cand.push({x:pt.x,y:pt.y});
        }
      }
      // 室外：院子与道路安全点，让荒野、街道也有 AI 巡逻
      for(const yd of this.yards){
        for(let t=0;t<2;t++){
          const x=yd.x+RNG.fr(28,Math.max(29,yd.w-28)), y=yd.y+RNG.fr(28,Math.max(29,yd.h-28));
          const pt=this._spawnSafePoint(x,y,16);
          if(!this._blockedAt(pt.x,pt.y,15) && M.dist(pt.x,pt.y,px,py)>200) cand.push({x:pt.x,y:pt.y});
        }
      }
      for(const rd of this.roads){
        if(rd.w<70||rd.h<70) continue;
        const x=rd.x+RNG.fr(24,Math.max(25,rd.w-24)), y=rd.y+RNG.fr(24,Math.max(25,rd.h-24));
        const pt=this._spawnSafePoint(x,y,16);
        if(!this._blockedAt(pt.x,pt.y,15) && M.dist(pt.x,pt.y,px,py)>200) cand.push({x:pt.x,y:pt.y});
      }
      // Fisher–Yates 打乱，保证每局抽样点不同
      for(let i=cand.length-1;i>0;i--){ const j=RNG.ri(0,i); const tmp=cand[i]; cand[i]=cand[j]; cand[j]=tmp; }
      // 两遍挑选：先要求距玩家 ≥ MIN_DIST（不贴脸），挑不够再放宽到 430，保证全图都能铺满
      const MIN_DIST=620, SEP=118;   // AI 视野提到 1000，出生点最近的 AI 也拉开到 620 以外
      const slots=[];
      const _pick=(minD)=>{
        for(const c of cand){
          if(M.dist(c.x,c.y,px,py)<minD) continue;
          let clash=false;
          for(const s of slots){ if(M.dist(s.x,s.y,c.x,c.y)<SEP){ clash=true; break; } }
          if(clash) continue;
          slots.push(c);
          if(slots.length>=36) break;
        }
      };
      _pick(MIN_DIST);
      if(slots.length<30) _pick(430);
      const total=Math.min(slots.length, 30);  // 普通 AI（不含 Boss）：略多于原 28，配合全图分布更充实
      for(let i=0;i<total;i++){
        const pt=slots[i];
        const isPMC=RNG.chance(0.36);
        let gun, hp, speed, armor, dr, armorTier, helmetArmor, helmetDr, helmetTier;
        let smart=false, creds=RNG.ri(20,70), lootLimit=4;
        // 携带装备越强，AI 入场装备也越强
        const gs=this.gearStrength||0;                // 0（裸装）~ 1.0（满配）
        const gIlvl=Math.round(gs*8);                 // 枪械等级 +0 ~ +8
        const gArmor=gs>=0.30?Math.round(gs*gs*7):0;   // 护甲/头盔 tier 抬 0 ~ +7（平方曲线，低强度几乎不抬）
        if(isPMC){
          // v1.0：PMC 也从低配起步，靠搜刮升级；30% 为「Raider」（更聪明、会优先抢好箱）
          smart = RNG.chance(0.45);
          if(smart){
            const gid=RNG.pick(["rifle","smg","sniper","rifle"]);
            gun=blGunGen(RNG.ri(11,15)+gIlvl,{type:gid});
            hp=100; speed=RNG.fr(142,160);
            armorTier=RNG.chance(0.75)?Math.min(8,RNG.ri(3,5)+gArmor):(gs>1.0?Math.min(6,RNG.ri(2,4)+gArmor):0);
            helmetTier=armorTier?Math.min(8,RNG.ri(2,4)+gArmor):0;
            creds=RNG.ri(150,400); lootLimit=5;
          } else {
            const gid=RNG.pick(["pistol","smg","pistol","shotgun"]);
            gun=blGunGen(RNG.ri(6,10)+gIlvl,{type:gid});
            hp=100; speed=RNG.fr(135,152);
            armorTier=RNG.chance(0.40+gs*0.08)?Math.min(7,RNG.ri(1,2)+gArmor):0;
            helmetTier=0;
            lootLimit=3;
          }
          armor=armorTier?RAID_ARMORS[armorTier].maxArmor:0;
          dr=armorTier?RAID_ARMORS[armorTier].dr:0;
          helmetArmor=helmetTier?RAID_HELMETS[helmetTier].maxArmor:0;
          helmetDr=helmetTier?RAID_HELMETS[helmetTier].dr:0;
        } else {
          // Scav：塔科夫拾荒者只拿低阶武器。玩家携带再强也不会抬高他们的枪械等级，
          // 只会让他们更常带枪（0.72 → 0.90），不会变成高穿深 PMC。
          const gid=RNG.pick(["pistol","shotgun","smg","pistol"]);
          gun=RNG.chance(0.72+Math.min(0.18,gs*0.10)) ? raidScavGun(RNG.ri(2,7),{type:gid}) : null;
          hp=RNG.ri(70,95); speed=RNG.fr(115,140);
          armorTier=RNG.chance(0.20+gs*0.08)?Math.min(SCAV_ARMOR_TIER_MAX,RNG.ri(1,2)):0;
          armor=armorTier?RAID_ARMORS[armorTier].maxArmor:0;
          dr=armorTier?RAID_ARMORS[armorTier].dr:0;
          helmetTier=0; helmetArmor=0; helmetDr=0;
          creds=RNG.ri(10,40); lootLimit=2;
        }
        // 携带装备强 → 更多 AI 带装备进场（不再一半人空手巡逻）
        if(!smart && !RNG.chance(0.45+gs*0.18)) lootLimit=0;
        // 满配入场（gearStrength 高）时，强制全员带枪带甲，避免一身神装却全是裸装杂兵；
        // Scav 仍然只拿低阶枪、低阶甲，不参与 PMC 的装备膨胀。
        if(gs>0.72){
          if(!gun){
            const gid=RNG.pick(["pistol","smg","shotgun"]);
            gun=isPMC ? blGunGen(RNG.ri(6,10)+gIlvl,{type:gid}) : raidScavGun(RNG.ri(3,7),{type:gid});
          }
          if(armorTier<2){
            armorTier=isPMC ? 2 : Math.min(SCAV_ARMOR_TIER_MAX,2);
            armor=RAID_ARMORS[armorTier].maxArmor; dr=RAID_ARMORS[armorTier].dr;
          }
          if(isPMC && helmetTier<1){ helmetTier=1; helmetArmor=RAID_HELMETS[helmetTier].maxArmor; helmetDr=RAID_HELMETS[helmetTier].dr; }
        }
        /* v0.14.11：约 1/5 的 PMC 固定编为「护盾兵」——轻甲 + 能量护盾（蓝色血条）。
         * 保证电击 ×2.00 每局都有够多的明确目标，同时把 T4+ 重甲留给黄色装甲条，
         * 避免「护盾优先级盖掉黄条」把用户要的装甲型藏起来。 */
        let shieldVal=0;
        if(isPMC && RNG.chance(0.22)){
          armorTier=Math.min(armorTier||2, 3);
          armor=armorTier?RAID_ARMORS[armorTier].maxArmor:0;
          dr=armorTier?RAID_ARMORS[armorTier].dr:0;
          shieldVal=Math.round(45+armorTier*10+gs*20);
        } else if(smart && armorTier>0 && armorTier<RAID_ARMOR_TYPE_TIER){
          shieldVal=Math.round(30+armorTier*7+gs*18);
        }
        this.ops.push(new RaidOperator({
          id:"op"+i, cls:isPMC?"pmc":"scav",
          name:(smart?"◆ ":"")+(isPMC?(pmcNames[i%pmcNames.length]):(scavNames[i%scavNames.length])),
          x:pt.x, y:pt.y, angle:RNG.fr(0,6.28),
          speed, hp, color:isPMC?colors[i%4]:colors[4+(i%5)],
          gun, armor, dr, armorTier, helmetArmor, helmetDr, helmetTier,
          shield: shieldVal,
          smart, creds, lootLimit,
        }));
      }

      // Boss：3 名精锐，掉落保底好枪 + 带词条配件，HUD 高亮
      // 塔科夫 Boss 名称：Reshala / Killa / Shturman。
      const bountyNames=["Reshala","Killa","Shturman"];
      const bountyRooms=["factory","village","dock","temple","depot"];
      const bountyOrder=bountyRooms.map(id=>RAID_ROOMS.find(r=>r.id===id)).filter(Boolean)
        .sort((a,b)=>M.dist(b.x+b.w/2,b.y+b.h/2,px,py)-M.dist(a.x+a.w/2,a.y+a.h/2,px,py));
      const bountyFallback=RAID_ROOMS.filter(r=>!r.extract);
      for(let b=0;b<3;b++){
        const rm=(bountyOrder.length ? bountyOrder[b%bountyOrder.length] : null)
          || (bountyFallback.length ? bountyFallback[b%bountyFallback.length] : null)
          || RAID_ROOMS[0];
        if(!rm) continue;
        const rawB=this._openPointInRoom(rm, 80);
        const pt=this._spawnSafePoint(rawB.x, rawB.y, 18);
        const g=blGunGen(RNG.ri(13,17),{type:RNG.pick(["rifle","sniper","smg"]), rarity:"purple"});
        g.uid=this._uid(); g.kind="weapon";
        const at=RNG.pick([7,7,8]), ht=RNG.pick([6,7,7]);
        this.ops.push(new RaidOperator({
          id:"bounty"+b, cls:"pmc", bounty:true,
          name:bountyNames[b],
          x:pt.x, y:pt.y, angle:RNG.fr(0,6.28),
          speed:RNG.fr(140,160), hp:RNG.ri(180,240), color:"#ff5c5c",
          gun:g, armor:RAID_ARMORS[at].maxArmor, dr:RAID_ARMORS[at].dr, armorTier:at,
          helmetArmor:RAID_HELMETS[ht].maxArmor, helmetDr:RAID_HELMETS[ht].dr, helmetTier:ht,
          // Boss 保持 T7/T8 黄色装甲条（腐蚀克制），不叠护盾层
          smart:true, creds:RNG.ri(380,850), lootLimit:7,
        }));
      }

    }

    // 摄像机对准玩家
    this.camera.x=px-game.view.w/(2*(game.zoom||1));
    this.camera.y=py-game.view.h/(2*(game.zoom||1));
    this._updateCamera(game);

    this._feed("系统", "PMC 已进入战区 · 小心 Scav 出没", "部署", false, "info");
    // 让玩家看懂「携带价值 → 战利品品质」的关系
    const lk=this.lootLuck;
    const lkTxt = !carriedAny ? "裸装进场 · 箱子多为低阶物资" :
                  lk<0.10 ? "轻装进场 · 战利品以低阶为主" :
                  lk<0.25 ? "轻装进场 · 战利品品质一般" :
                  lk<0.40 ? "重装进场 · 战利品略好一点" : "满配进场 · 战利品小幅提升";
    this._feed("战利品", lkTxt+"（携带估值 ₽"+priceText(this.carriedValue)+"）", "", false, lk>=0.40?"info":"warn");
    if(this.online && typeof Net!=="undefined") Net.attach(this, opts);
  },

  /* 房主掉线后由下一位玩家接管 AI。
   * 客户端原本只拿到 ghost 视觉快照；这里补齐模拟所需字段并把 gun 重建成可开火的运行时枪。 */
  promoteGhostsForHost(){
    if(!this.ops || !this.player) return 0;
    let n=0;
    for(const o of this.ops){
      if(!o || (!o.ghost && !o.isGhost)) continue;
      o.ghost=false; o.isGhost=false; o.isNet=false;
      o.isPlayer=false; o.remote=false;
      o.inv=o.inv||{ weapons:[], armors:[], helmets:[], parts:[], materials:[], meds:[], cores:[], receivers:[] };
      o.creds=o.creds||RNG.ri(20,80);
      o.lootLimit=o.lootLimit||(o.smart?9:4);
      o.lootCount=0; o.lootTarget=null; o.lootT=0; o._lootProg=null; o._lootDetour=null;
      o.aiT=RNG.f()*1.2; o._badT=0; o._badC=null; o._badPtT=0; o._badPt=null;
      o.armorTier=o.armorTier||0; o.helmetTier=o.helmetTier||0;
      // Scav 接管模拟时同样受低阶装备上限约束，不会因为房主迁移变成重甲兵。
      if(o.cls==="scav"){
        o.armorTier=Math.min(o.armorTier,SCAV_ARMOR_TIER_MAX);
        o.helmetTier=Math.min(o.helmetTier,SCAV_HELMET_TIER_MAX);
        o.maxShield=0; o.shield=0;
      }
      o.maxHelmetArmor=o.maxHelmetArmor||o.helmetArmor||0;
      o.helmetArmor=Math.min(o.helmetArmor||0, o.maxHelmetArmor);
      o.maxArmor=o.maxArmor||0; o.armor=Math.min(o.armor||0, o.maxArmor);
      o.armorBroken=o.armorBroken!==undefined?o.armorBroken:(o.maxArmor>0&&o.armor<=0);
      o.maxShield=o.maxShield||o.shield||0; o.shield=Math.min(o.shield||0,o.maxShield);
      o.speed=o.speed||150; o.r=o.r||14;
      o._dodgeT=0; o._dodgeSide=1; o._stuck=0;
      o.roamT=0; o.roamPt=null;
      o.state=o.state||"roam"; o.lastSeen=null; o.investigate=null;
      o.bandages=o.bandages||(o.smart?3:1); o.medT=0;
      o.fireCd=0; o.reloadT=0; o.kills=0; o.bleed=0;
      o.freezeT=0; o.burnT=0; o.burnDps=0; o.burnSrc=null;
      o.corrodeT=0; o.shockT=0; o.radT=0;   // v0.14.11：影子转真人时清掉残留元素状态
      o.squadId=null; o.isLeader=false; o.blockZone=null;
      o.tx=o.x; o.ty=o.y; o.ta=o.angle||0;
      if(o.gun && (!o.gun.mag || !o.gun.dmg)){
        const t=o.gun.type||"pistol";
        const g=o.cls==="scav"
          ? raidScavGun(RNG.ri(2,7), { type:SCAV_GUN_TYPES.includes(t)?t:"pistol" })
          : blGunGen(RNG.ri(8,14), { type:t, element:o.gun.element||"none" });
        g.ammoMag=g.mag; g.ammoRes=g.reserve;
        o.gun=g;
      } else if(o.gun){
        if(o.gun.ammoMag===undefined) o.gun.ammoMag=o.gun.mag;
        if(o.gun.ammoRes===undefined) o.gun.ammoRes=o.gun.reserve;
      }
      n++;
    }
    return n;
  },

  _roomById(id){ return RAID_ROOMS.find(r=>r.id===id); },

  /* 出生房：先按 3×3 分区随机一格，再在格内随机房间；避开撤离点附近，且尽量不连着两局同一个格 */
  _pickSpawnRoom(){
    const CW=RAID_MAP_W/3, CH=RAID_MAP_H/3;
    const cells={};
    for(const rm of RAID_ROOMS){
      if(rm.extract) continue;
      // 出生就贴着撤离点 = 白嫖，留出 450px 缓冲
      let nearExt=false;
      for(const e of RAID_ROOMS){
        if(!e.extract) continue;
        if(M.dist(rm.x+rm.w/2, rm.y+rm.h/2, e.x+e.w/2, e.y+e.h/2) < 450){ nearExt=true; break; }
      }
      if(nearExt) continue;
      const cx=M.clamp(Math.floor((rm.x+rm.w/2)/CW),0,2);
      const cy=M.clamp(Math.floor((rm.y+rm.h/2)/CH),0,2);
      const k=cy*3+cx;
      (cells[k]=cells[k]||[]).push(rm);
    }
    let keys=Object.keys(cells);
    if(!keys.length){
      const pool=RAID_ROOMS.filter(r=>!r.extract);
      return pool.length?RNG.pick(pool):RAID_ROOMS[0];
    }
    let k=RNG.pick(keys);
    if(keys.length>1 && this._lastSpawnCell===k){
      const alt=keys.filter(x=>x!==this._lastSpawnCell);
      if(alt.length) k=RNG.pick(alt);
    }
    this._lastSpawnCell=k;
    return RNG.pick(cells[k]);
  },
  _blockedAt(x,y,r){
    if(this._inWater(x,y)) return true;   // 河流不可驻留：出生点 / AI 目标点均避开水域
    const list=this._nearWalls?this._nearWalls(x,y,r):this.walls;
    for(let i=0;i<list.length;i++){
      const w=list[i];
      const nx=M.clamp(x,w.x,w.x+w.w), ny=M.clamp(y,w.y,w.y+w.h);
      if((x-nx)*(x-nx)+(y-ny)*(y-ny) < r*r) return true;
    }
    return false;
  },
  // 出生点可能正好压着家具：螺旋外扩找第一个空地，避免开局就卡在货架里
  /* 巡逻点预处理 —— 手写点位可能压在墙上或水里，统一推到最近的可站位置 */
  _buildPatrolPoints(){
    this.patrolPts=[];
    for(const p of RAID_PATROL){
      const s=this._spawnSafePoint(p[0], p[1], 18);
      this.patrolPts.push([s.x, s.y]);
    }
  },

  _spawnSafePoint(x,y,r){
    r=r||22;
    if(!this._blockedAt(x,y,r)) return {x:x,y:y};
    for(let ring=1;ring<=18;ring++){
      const rr=ring*16;
      for(let i=0;i<20;i++){
        const a=i/20*6.2832;
        const nx=x+Math.cos(a)*rr, ny=y+Math.sin(a)*rr;
        if(nx<r||ny<r||nx>RAID_MAP_W-r||ny>RAID_MAP_H-r) continue;
        if(!this._blockedAt(nx,ny,r)) return {x:nx,y:ny};
      }
    }
    return {x:x,y:y};
  },
  _openPointInRoom(rm, inset){
    inset=inset||60;
    // 避开门廊与墙体：箱子不再生成在门洞正中间卡住出入口
    for(let k=0;k<26;k++){
      const x=RNG.fr(rm.x+inset, Math.max(rm.x+inset+1, rm.x+rm.w-inset));
      const y=RNG.fr(rm.y+inset, Math.max(rm.y+inset+1, rm.y+rm.h-inset));
      let bad=false;
      for(const L of this.doorLanes){
        if(x>L.x-6&&x<L.x+L.w+6&&y>L.y-6&&y<L.y+L.h+6){ bad=true; break; }
      }
      if(!bad){
        for(const w of this.walls){
          if(x>w.x-22&&x<w.x+w.w+22&&y>w.y-22&&y<w.y+w.h+22){ bad=true; break; }
        }
      }
      if(!bad) return {x:x,y:y};
    }
    return { x:rm.x+rm.w/2, y:rm.y+rm.h/2 };
  },

  _applyLoadout(opts){
    this.carried={ weapons:[], armor:null, helmet:null, shield:null };
    for(const uid of (opts.weapons||[])){
      const i=this.stash.weapons.findIndex(w=>w.uid===uid);
      if(i>=0){ this.carried.weapons.push(this.stash.weapons.splice(i,1)[0]); }
      if(this.carried.weapons.length>=4) break;   // 手持 1 + 副手 1 + 背包 2
    }
    if(opts.armor){
      const i=this.stash.armors.findIndex(a=>a.uid===opts.armor);
      if(i>=0) this.carried.armor=this.stash.armors.splice(i,1)[0];
    }
    if(opts.helmet){
      const i=this.stash.helmets.findIndex(h=>h.uid===opts.helmet);
      if(i>=0) this.carried.helmet=this.stash.helmets.splice(i,1)[0];
    }
    if(opts.shield){
      this.stash.shields=this.stash.shields||[];
      const i=this.stash.shields.findIndex(s=>s.uid===opts.shield);
      if(i>=0) this.carried.shield=ensureShield(this.stash.shields.splice(i,1)[0]);
    }
  },

  /* ----------------------------- 地图构建 ----------------------------- */
  _hash2(x,y){
    let h=(Math.imul(x|0,374761393)+Math.imul(y|0,668265263))|0;
    h=Math.imul(h^(h>>>13),1274126177);
    return ((h^(h>>>16))>>>0)/4294967296;
  },
  _hitRect(a,b,pad){
    pad=pad||0;
    return a.x-pad<b.x+b.w && a.x+a.w+pad>b.x && a.y-pad<b.y+b.h && a.y+a.h+pad>b.y;
  },
  // 房间某一侧到最近邻房间的净空：决定门开在哪，绝不把门开在隔壁墙上
  _roomGap(rm,dir){
    const mx=rm.x+rm.w/2, my=rm.y+rm.h/2;
    let best=460;
    for(const o of RAID_ROOMS){
      if(o.id===rm.id) continue;
      if(dir==="right"){
        if(my>o.y-6 && my<o.y+o.h+6 && o.x>=rm.x+rm.w) best=Math.min(best,o.x-(rm.x+rm.w));
      } else if(dir==="left"){
        if(my>o.y-6 && my<o.y+o.h+6 && o.x+o.w<=rm.x) best=Math.min(best,rm.x-(o.x+o.w));
      } else if(dir==="bottom"){
        if(mx>o.x-6 && mx<o.x+o.w+6 && o.y>=rm.y+rm.h) best=Math.min(best,o.y-(rm.y+rm.h));
      } else {
        if(mx>o.x-6 && mx<o.x+o.w+6 && o.y+o.h<=rm.y) best=Math.min(best,rm.y-(o.y+o.h));
      }
    }
    return best;
  },

  _buildMap(){
    this.walls=[]; this.props=[]; this.extracts=[]; this.roomRects=[];
    this.doorLanes=[]; this.doorInner=[];     this.roads=[]; this.yards=[]; this.sheds=[]; this._navQ=0;
    this.shops=[];   // 局内商店摊位（枪店 / 材料店 / 回收超市 / 黑市）
    this.gadgets=[]; // 可互动设施（医疗站 / 弹药箱 / 泄洪闸）
    this.grounds=[]; // 背包溢出后落在地上的物品堆（独立数组，不打乱联机用的箱子索引）
    // 生态数据（供碰撞 / 渲染 / 小地图共用）
    this.waterCircles=[]; this.bridges=[]; this.forests=[]; this.rails=[]; this.railCars=[];
    const TH=16;
    const addWall=(x,y,w,h)=>{ if(w>0.5&&h>0.5) this.walls.push({x,y,w,h,kind:"wall"}); };

    for(const rm of RAID_ROOMS){
      rm._doors=[];
      /* open（操场 / 广场 / 坝顶这类开放场地）不砌围墙、不开门，
         只作为地面区域参与摆放与刷箱，避免把「院子」做成密不透风的方盒子。 */
      if(rm.open){
        this.roomRects.push(rm);
        if(rm.extract){
          const rule=RAID_EXTRACT_RULES[rm.id]||{ need:7, cost:0, openChance:1 };
          const closed = RNG.f() >= rule.openChance;
          this.extracts.push({ x:rm.x+30, y:rm.y+30, w:rm.w-60, h:rm.h-60,
            name:rm.name, id:rm.id, need:rule.need, cost:rule.cost, feeRate:rule.feeRate||0, closed,
            note:closed?("已关闭 · "+rule.note):rule.note });
        }
        continue;
      }
      /* 门：按「外部净空」从大到小挑 2~3 侧开门。
         旧版每间只开 1 扇 92px 的门，且门可能正对隔壁外墙 —— 玩家和 AI 全卡在门口。 */
      const g={ top:this._roomGap(rm,"top"), bottom:this._roomGap(rm,"bottom"),
                left:this._roomGap(rm,"left"), right:this._roomGap(rm,"right") };
      // 优先「对穿」两扇门（前后门），房间结构才完整；两侧都不通时退回单门
      const pairs=[{d:["top","bottom"], s:g.top+g.bottom},{d:["left","right"], s:g.left+g.right}]
        .sort((a,b)=>b.s-a.s);
      const doors={};
      for(const k of pairs[0].d){ if(g[k]>=96) doors[k]=true; }
      if(!Object.keys(doors).length){
        const best=["top","bottom","left","right"].sort((a,b)=>g[b]-g[a])[0];
        doors[best]=true;
      }

      const side=(dir)=>{
        const horiz = dir==="top"||dir==="bottom";
        const from  = horiz ? rm.x : rm.y;
        const to    = horiz ? rm.x+rm.w : rm.y+rm.h;
        const fixed = dir==="top" ? rm.y : dir==="bottom" ? rm.y+rm.h-TH
                    : dir==="left"? rm.x : rm.x+rm.w-TH;
        const len=to-from;
        if(!doors[dir]){
          if(horiz) addWall(from, fixed, len, TH);
          else addWall(fixed, from, TH, len);
          return;
        }
        // 门洞最小 104px：玩家直径 30，留足两人并排 / AI 侧身通过的空间
        const gap=Math.round(Math.min(152, Math.max(104, len*0.44)));
        const mid=(from+to)/2;
        const a2=mid-gap/2, b1=mid+gap/2;
        if(horiz){
          if(a2>from) addWall(from, fixed, a2-from, TH);
          if(to>b1) addWall(b1, fixed, to-b1, TH);
        } else {
          if(a2>from) addWall(fixed, from, TH, a2-from);
          if(to>b1) addWall(fixed, b1, TH, to-b1);
        }
        // 门口走廊：装饰物一律回避，保证「门→户外」永远有一条净空通道
        if(dir==="top")         this.doorLanes.push({x:mid-gap/2-34, y:rm.y-180,       w:gap+68, h:180});
        else if(dir==="bottom") this.doorLanes.push({x:mid-gap/2-34, y:rm.y+rm.h,      w:gap+68, h:180});
        else if(dir==="left")   this.doorLanes.push({x:rm.x-180,      y:mid-gap/2-34,  w:180,    h:gap+68});
        else                    this.doorLanes.push({x:rm.x+rm.w,     y:mid-gap/2-34,  w:180,    h:gap+68});
        rm._doors.push({ dir:dir, mid:mid, gap:gap });
        // 门内禁区：室内家具不得堵在门口
        if(dir==="top")         this.doorInner.push({x:mid-gap/2-20, y:rm.y+TH,          w:gap+40, h:74});
        else if(dir==="bottom") this.doorInner.push({x:mid-gap/2-20, y:rm.y+rm.h-TH-74, w:gap+40, h:74});
        else if(dir==="left")   this.doorInner.push({x:rm.x+TH,       y:mid-gap/2-20,  w:74,     h:gap+40});
        else                    this.doorInner.push({x:rm.x+rm.w-TH-74, y:mid-gap/2-20, w:74,    h:gap+40});
        // 门外铺装（纯视觉）：远处也能一眼看出哪面墙有门
        const roadW=Math.max(72, gap-8);
        if(dir==="top")         this.roads.push({x:mid-roadW/2, y:rm.y-210,     w:roadW, h:210});
        else if(dir==="bottom") this.roads.push({x:mid-roadW/2, y:rm.y+rm.h,    w:roadW, h:210});
        else if(dir==="left")   this.roads.push({x:rm.x-210,    y:mid-roadW/2,  w:210,   h:roadW});
        else                    this.roads.push({x:rm.x+rm.w,   y:mid-roadW/2,  w:210,   h:roadW});
      };

      side("top"); side("bottom"); side("left"); side("right");
      this.roomRects.push(rm);
      if(rm.extract){
        const rule=RAID_EXTRACT_RULES[rm.id]||{ need:7, cost:0, openChance:1 };
        const closed = RNG.f() >= rule.openChance;   // 铁路隧道每局掷签
        this.extracts.push({ x:rm.x+30, y:rm.y+30, w:rm.w-60, h:rm.h-60,
          name:rm.name, id:rm.id, need:rule.need, cost:rule.cost, feeRate:rule.feeRate||0, closed,
          note:closed?("已关闭 · "+rule.note):rule.note });
      }
    }

    // 全区主干道（视觉）：东西 / 南北各一条，让大地图有“行政区”结构
    this.roads.push({x:0, y:2680, w:RAID_MAP_W, h:120});
    this.roads.push({x:3380, y:0, w:120, h:RAID_MAP_H});
    this.roads.push({x:0, y:1160, w:RAID_MAP_W, h:84});
    this.roads.push({x:2120, y:0, w:84, h:RAID_MAP_H});
    this.roads.push({x:1200, y:3600, w:RAID_MAP_W-1200, h:96});
    // 新生态区的两条纵向干道（均避开河道，AI 也据此在新区域刷新巡逻）
    this.roads.push({x:7000, y:0, w:96, h:RAID_MAP_H});
    this.roads.push({x:9800, y:0, w:96, h:RAID_MAP_H});

    this._buildWater();    // 河流先建，后续建筑/物件避免长在水面上
    this._buildDam();      // 大坝坝体（墙）+ 溢洪道，早于棚屋/杂物
    this._buildPrisonCell();// 监狱牢房隔断
    this._clipRoads();
    this._buildYards();
    this._buildSheds();
    this._fillProps();
    this._buildScenes();   // 室外场景化（集装箱堆场 / 车辆残骸群 / 铁丝网带 / 杂物堆）
    this._buildTerrain();  // 北境密林 / 中央河谷 / 铁路枢纽（树林·河流·铁路）
    this._buildShops();    // 局内商店（需在水面/建筑/树都就位后选点）
    this._buildGadgets();  // 医疗站 / 弹药箱 / 泄洪闸（新建筑内的可互动设施）
    this._buildNavGrid();
    this._buildPatrolPoints();  // 把落在墙里/水里的巡逻点推开，AI 不再卡住
    this._buildDecals();   // 地表细节（油渍/血迹/裂缝/草簇/停车线/涂鸦），纯视觉、确定性生成
    this._buildFloodlights();   // 探照灯（确定性位置，强化氛围）
    this._buildAmbient();       // 区域明暗分级（暗斑，确定性生成）
  },

  /* -------------------- 监狱牢房隔断 --------------------
     主楼中间一道带 96px 中央过道的隔断，把大房间切成上下两排牢房；
     只是多两段墙，AI 寻路与家具摆放都沿用现有逻辑。 */
  _buildPrisonCell(){
    const rm=RAID_ROOMS.find(r=>r.id==="prisonA"); if(!rm) return;
    const y=rm.y+Math.round(rm.h/2)-8;
    const seg=Math.round((rm.w-96)/2);
    this.walls.push({ x:rm.x+16,       y:y, w:seg, h:16, kind:"wall", cell:true });
    this.walls.push({ x:rm.x+rm.w-16-seg, y:y, w:seg, h:16, kind:"wall", cell:true });
    // 牢房门：隔断上的窄口（视觉提示，不阻挡）
    this.doorLanes.push({ x:rm.x+rm.w/2-60, y:y-40, w:120, h:96 });
  },

  /* -------------------- 大坝坝体 --------------------
     横跨水库北缘的两段混凝土坝 + 中间 210px 溢洪闸。闸门由 gadget「泄洪闸」控制，
     开启后水库水圆移除，水底露出高级保险箱。 */
  _buildDam(){
    const Y=8760, H=60;
    this.damOpen=false;
    this.walls.push({ x:2330, y:Y, w:1100, h:H, kind:"wall", dam:true });
    this.walls.push({ x:3640, y:Y, w:840,  h:H, kind:"wall", dam:true });
    this.roads.push({ x:2330, y:Y-72, w:2150, h:66 });   // 坝顶通道铺装
    this.yards.push({ x:3390, y:8820, w:290, h:140, tint:"#20262b" });   // 溢洪道口
  },

  /* -------------------- 生态扩张：河流（先建，供避让） -------------------- */
  // 河流：沿中心线按步长离散成「水圆」；桥梁处额外记录豁免矩形，桥面视作干地。
  // 必须在 _buildSheds / _fillProps / _buildScenes 之前调用，这样建筑与物件不会长在河面上。
  _buildWater(){
    const R=RAID_BIOMES.river, half=R.half, STEP=88, pts=R.pts;
    for(let s=0;s<pts.length-1;s++){
      const [x1,y1]=pts[s], [x2,y2]=pts[s+1];
      const len=Math.hypot(x2-x1,y2-y1), n=Math.max(1,Math.round(len/STEP));
      for(let i=0;i<=n;i++){
        const t=i/n, x=x1+(x2-x1)*t, y=y1+(y2-y1)*t;
        if(x<-half||y<-half||x>RAID_MAP_W+half||y>RAID_MAP_H+half) continue;
        this.waterCircles.push({ x, y, r:half });
      }
    }
    // 桥：轴对齐矩形净空（横向桥面横跨河道，安全通行带与画面对齐）
    // 支持 [x,y] 简写与 {x,y,w,h,big} 完整写法
    for(const b of R.bridges){
      if(Array.isArray(b)) this.bridges.push({ x:b[0], y:b[1], w:half*2.5, h:half*1.1 });
      else this.bridges.push({ x:b.x, y:b.y, w:b.w||half*2.5, h:b.h||half*1.1, big:!!b.big });
    }
    // 河带包围盒（含桥面外扩），用于水判定的快速剔除
    let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9;
    for(const c of this.waterCircles){
      x0=Math.min(x0,c.x-c.r); x1=Math.max(x1,c.x+c.r);
      y0=Math.min(y0,c.y-c.r); y1=Math.max(y1,c.y+c.r);
    }
    for(const b of this.bridges){
      x0=Math.min(x0,b.x-b.w/2); x1=Math.max(x1,b.x+b.w/2);
      y0=Math.min(y0,b.y-b.h/2); y1=Math.max(y1,b.y+b.h/2);
    }
    this._waterBox={ x0:x0-40, y0:y0-40, x1:x1+40, y1:y1+40 };

    /* 大坝水库（西南开发区）。用矩形库区（视觉与碰撞一致，比水圆拼合更干净），
     * 开闸后 damOpen=true，库区不再判定为水，露出库底与两个高级保险箱。 */
    this.reservoirRect={ x:2260, y:8790, w:2290, h:810 };
    this.reservoir=[];
  },

  /* -------------------- 生态扩张：密林 / 铁路 -------------------- */
  _buildTerrain(){
    const B=RAID_BIOMES;
    const TREE={ kind:"tree", w:46, h:46, sight:true, fill:"#2f3a22", edge:"#1c2614" };

    /* ① 密林：在每个林区按网格撒树，避开门/河道/桥/既有建筑，构成可穿行的树林掩体 */
    for(const fz of B.forest){
      this.forests.push({ x:fz.x, y:fz.y, w:fz.w, h:fz.h });
      const SP=140, occ=new Set();
      for(let gy=fz.y+SP/2; gy<fz.y+fz.h; gy+=SP){
        for(let gx=fz.x+SP/2; gx<fz.x+fz.w; gx+=SP){
          const jx=gx+RNG.fr(-30,30), jy=gy+RNG.fr(-30,30);
          if(this._blockedSpawn(jx,jy)) continue;
          if(this._distToRoom(jx,jy)<86) continue;   // 不压建筑院子
          const cx=Math.floor(jx/70), cy=Math.floor(jy/70);
          if(occ.has(cx+","+cy)) continue;
          let near=false;
          for(const p of this.props){ if(Math.abs(p.x+p.w/2-jx)<64 && Math.abs(p.y+p.h/2-jy)<64){ near=true; break; } }
          if(near) continue;
          occ.add(cx+","+cy);
          this._pushProp(TREE, jx-TREE.w/2, jy-TREE.h/2);
        }
      }
    }

    /* ③ 铁路：记录轨道折线（纯视觉，可通行）；货运列车以车厢形式作为硬掩体 */
    this.rails=B.rails;
    const trains = B.trains || (B.train?[B.train]:[]);
    for(const T of trains){
      const CW=64, CH=150, GAP=18, n=T.cars, horiz=(T.dir==="h");
      for(let i=0;i<n;i++){
        const off=(i-(n-1)/2)*(CH+GAP);
        const tx=horiz?T.x+off:T.x, ty=horiz?T.y:T.y+off;
        // 车厢仅在非水域、远离建筑处生成，避免列车卡在桥里
        if(this._blockedSpawn(tx,ty) || this._distToRoom(tx,ty)<120) continue;
        const w=horiz?CH:CW, h=horiz?CW:CH;
        this._pushProp({ kind:"railcar", w:w, h:h, sight:true, fill:"#33383f", edge:"#15181d" }, tx-w/2, ty-h/2);
      }
    }
  },

  /* 水域种类：
   *   0 = 干地 / 桥面     1 = 河流浅水（可缓慢涉水，停留过久失温扣血）
   *   2 = 深水（大坝水库未开闸，不可通行，只能先开泄洪闸）
   * 桥面在此处就短路返回 0，所以踩桥既不会减速也不会扣血。 */
  _waterKind(x,y){
    if(this.reservoirRect && !this.damOpen){
      const rr=this.reservoirRect;
      if(x>=rr.x && x<=rr.x+rr.w && y>=rr.y && y<=rr.y+rr.h) return 2;
    }
    if(!this.waterCircles || !this.waterCircles.length) return 0;
    // 快速剔除：河带只占地图中东部一条窄带，绝大多数坐标一次 AABB 比较就返回，
    // 否则 30 个 AI × 每帧 4 次 × 上千个水圆的开销会明显拖帧。
    const wb=this._waterBox;
    if(wb && (x<wb.x0 || x>wb.x1 || y<wb.y0 || y>wb.y1)) return 0;
    for(const b of this.bridges){
      if(x>b.x-b.w/2 && x<b.x+b.w/2 && y>b.y-b.h/2 && y<b.y+b.h/2) return 0;   // 桥面通行
    }
    for(const c of this.waterCircles){ const dx=x-c.x, dy=y-c.y; if(dx*dx+dy*dy < c.r*c.r) return 1; }
    return 0;
  },

  // 水体内是否「不可站」（深水/浅水）；生成阶段用它避让
  _inWater(x,y){ return this._waterKind(x,y) > 0; },
  _onBridge(x,y){
    for(const b of this.bridges){
      if(x>b.x-b.w/2 && x<b.x+b.w/2 && y>b.y-b.h/2 && y<b.y+b.h/2) return true;
    }
    return false;
  },
  // 生成避让：水面 + 桥面都不长树/箱子/工棚 —— 桥是通行带，别被杂物堵住
  _blockedSpawn(x,y){ return this._waterKind(x,y) > 0 || this._onBridge(x,y); },

  /* -------------------- 室外场景化 --------------------
     把零散物件聚成「据点」：集装箱堆场 / 车辆残骸群 / 铁丝网带 / 杂物堆。
     仅 push 进 props+walls（碰撞/视线沿用现有空间索引），所有候选都用
     _canPlaceSceneBox 做整群避让，确保不堵门、不压房、不重叠既有物件。 */
  _pickProp(kind, pred){
    for(const t of RAID_PROPS){ if(t.kind===kind && (!pred||pred(t))) return t; }
    return null;
  },
  _canPlaceSceneBox(box){
    if(box.x<96||box.y<96||box.x+box.w>RAID_MAP_W-96||box.y+box.h>RAID_MAP_H-96) return false;
    if(this._blockedSpawn(box.x+box.w/2, box.y+box.h/2)) return false;   // 不占河面
    for(const rm of RAID_ROOMS){ if(this._hitRect(box, rm, 56)) return false; }
    for(const L of this.doorLanes){ if(this._hitRect(box, L, 10)) return false; }
    for(const sh of this.sheds){ if(this._hitRect(box, sh, 40)) return false; }
    for(const p of this.props){ if(this._hitRect(box, p, 46)) return false; }
    return true;
  },
  _buildScenes(){
    const placed=[];
    const ok=(box)=>{
      if(!this._canPlaceSceneBox(box)) return false;
      for(const b of placed){ if(this._hitRect(box, b, 120)) return false; }
      return true;
    };
    const CELL=240;

    // ① 集装箱堆场：2 行阵列 + 两端护栏 + 地面铺装
    { let n=0, guard=0;
      while(n<6 && guard<500){ guard++;
        const cols=RNG.ri(3,5), rows=2;
        const W=cols*CELL+40, H=rows*CELL+40;
        const x=RNG.fr(140, RAID_MAP_W-W-140), y=RNG.fr(140, RAID_MAP_H-H-140);
        const box={x,y,w:W,h:H}; if(!ok(box)) continue;
        this.yards.push({x:x-24,y:y-24,w:W+48,h:H+48,tint:"#262a23"});
        const barH=this._pickProp("barrier", t=>t.w>t.h);
        if(barH){ this._pushProp(barH, x-30, y+H/2-19); this._pushProp(barH, x+W+30-206, y+H/2-19); }
        for(let r=0;r<rows;r++) for(let c=0;c<cols;c++){
          const horiz=RNG.chance(0.5);
          const t=this._pickProp("container", t=>horiz?t.w>t.h:t.w<t.h);
          if(!t) continue;
          this._pushProp(t, x+20+c*CELL+(CELL-t.w)/2, y+20+r*CELL+(CELL-t.h)/2);
        }
        placed.push(box); n++;
      }
    }

    // ② 车辆残骸群：中心卡车 + 周围错位残骸
    { let n=0, guard=0;
      while(n<8 && guard<500){ guard++;
        const cx=RNG.fr(320, RAID_MAP_W-320), cy=RNG.fr(320, RAID_MAP_H-320);
        if(this._distToRoom(cx,cy)<340) continue;
        const box={x:cx-190,y:cy-190,w:380,h:380}; if(!ok(box)) continue;
        const truck=this._pickProp("truck", t=>t.w>t.h);
        if(truck) this._pushProp(truck, cx-truck.w/2, cy-truck.h/2);
        const k=RNG.ri(2,4);
        for(let i=0;i<k;i++){
          const a=RNG.fr(0,6.2832), rad=RNG.fr(95,175);
          const t=RNG.chance(0.5)?this._pickProp("truck", t=>t.w>t.h):this._pickProp("scrap");
          if(!t) continue;
          this._pushProp(t, cx+Math.cos(a)*rad-t.w/2, cy+Math.sin(a)*rad-t.h/2);
        }
        placed.push(box); n++;
      }
    }

    // ③ 铁丝网带：一排橙黑护栏（水平或垂直），两端加短柱
    { let n=0, guard=0;
      while(n<10 && guard<500){ guard++;
        const len=RNG.ri(280,560), horiz=RNG.chance(0.5);
        const bar=this._pickProp("barrier", t=>horiz?t.w>t.h:t.w<t.h);
        if(!bar) break;
        const cnt=Math.max(1, Math.floor(len/bar.w));
        const cx=RNG.fr(300, RAID_MAP_W-300), cy=RNG.fr(300, RAID_MAP_H-300);
        let bx,by,bw,bh;
        if(horiz){ bw=cnt*bar.w; bh=bar.h; bx=cx-bw/2; by=cy-bar.h/2; }
        else      { bw=bar.w; bh=cnt*bar.h; bx=cx-bar.w/2; by=cy-bh/2; }
        const box={x:bx-20,y:by-20,w:bw+40,h:bh+40}; if(!ok(box)) continue;
        for(let i=0;i<cnt;i++){
          if(horiz) this._pushProp(bar, bx+i*bar.w, by);
          else       this._pushProp(bar, bx, by+i*bar.h);
        }
        placed.push(box); n++;
      }
    }

    // ④ 杂物堆：中心货箱 + 周围散落 crate/sandbag/rock/scrap（荒野感）
    { let n=0, guard=0;
      while(n<16 && guard<600){ guard++;
        const cx=RNG.fr(280, RAID_MAP_W-280), cy=RNG.fr(280, RAID_MAP_H-280);
        if(this._distToRoom(cx,cy)<260) continue;
        const box={x:cx-130,y:cy-130,w:260,h:260}; if(!ok(box)) continue;
        const crate=this._pickProp("crate");
        if(crate) this._pushProp(crate, cx-crate.w/2, cy-crate.h/2);
        const pool=["crate","sandbag","scrap","rock"];
        const k=RNG.ri(4,7);
        for(let i=0;i<k;i++){
          const a=RNG.fr(0,6.2832), rad=RNG.fr(40,120);
          const t=this._pickProp(pool[RNG.ri(0,pool.length-1)]);
          if(!t) continue;
          this._pushProp(t, cx+Math.cos(a)*rad-t.w/2, cy+Math.sin(a)*rad-t.h/2);
        }
        placed.push(box); n++;
      }
    }
  },

  /* 探照灯：确定性位置——每个撤离点 1 盏 + 主干道交点 + 院子抽样，
     联机同 seed 下地图一致。渲染在 _lightLayer 中以暖色光池叠加。 */
  _buildFloodlights(){
    this.floodlights=[];
    const push=(x,y,r)=>{ if(x>0&&y>0&&x<RAID_MAP_W&&y<RAID_MAP_H) this.floodlights.push({x,y,r}); };
    for(const e of this.extracts) push(e.x+e.w/2, e.y+e.h/2, 380);
    const pts=[[3380,2680],[2120,1160],[3380,1160],[2120,2680],[1200,3600],[3380,3600],[1760,1920]];
    for(const [px,py] of pts) push(px,py,420);
    let yi=0;
    for(const yd of this.yards){ if((yi++)%3===0 && this.floodlights.length<18) push(yd.x+yd.w/2, yd.y+yd.h/2, 240); }
  },

  /* 区域明暗：基于确定性哈希生成暗斑，纯视觉，渲染在地面层之上、
     props 之下，让大地图有「受光/背光」的层次而非一整片均色。 */
  _buildAmbient(){
    this.darkSpots=[];
    const G=440;
    for(let gy=0; gy*G<RAID_MAP_H; gy++){
      for(let gx=0; gx*G<RAID_MAP_W; gx++){
        const hv=this._hash2(gx*3+1, gy*5+2);
        if(hv<0.5) continue;
        const hx=this._hash2(gx*7+3, gy*11+5), hy=this._hash2(gx*13+7, gy*17+3);
        const cx=gx*G+hx*G, cy=gy*G+hy*G, r=180+hv*260;
        this.darkSpots.push({x:cx,y:cy,r, a:0.08+hv*0.16});
      }
    }
  },

  /* 地表细节层：用 _hash2（坐标确定性哈希）生成 decals，不依赖全局 RNG 序列，
     保证联机两端地图完全一致；全部为纯几何绘制，按视口裁剪，几乎零性能开销。 */
  _buildDecals(){
    this.decals=[];
    const D=this.decals;
    const H=(a,b)=>this._hash2(a,b);                 // [0,1)
    const CELL=168;
    const inRoom=(x,y)=>{ for(const rm of RAID_ROOMS){ if(x>rm.x&&x<rm.x+rm.w&&y>rm.y&&y<rm.y+rm.h) return true; } return false; };
    for(let gy=0; gy*CELL<RAID_MAP_H; gy++){
      for(let gx=0; gx*CELL<RAID_MAP_W; gx++){
        const cx=gx*CELL+CELL/2, cy=gy*CELL+CELL/2;
        const d=this._distToRoom(cx,cy);
        const count = d<280 ? 3 : (d<700 ? 2 : (H(gx*2+1,gy*2+1)<0.6?1:0));
        for(let i=0;i<count;i++){
          const h1=H(gx*7+i*3+3, gy*13+i*5+1);
          const h2=H(gx*11+i*3+7, gy*5+i*2+9);
          const h3=H(gx*3+i*5+5, gy*17+i+2);
          const x=cx+(h1-0.5)*CELL*0.82, y=cy+(h2-0.5)*CELL*0.82;
          if(x<40||y<40||x>RAID_MAP_W-40||y>RAID_MAP_H-40) continue;
          if(this._blockedSpawn(x,y)) continue;   // 河面上不撒油渍/草簇
          if(inRoom(x,y) && d>40) { /* 室内仍允许，下面按 d 分支处理 */ }
          let type;
          if(d>820)       type = h3<0.62?"grass":(h3<0.84?"rocklet":"oil");
          else if(d>300)  type = h3<0.34?"rocklet":(h3<0.52?"blood":(h3<0.82?"oil":"stain"));
          else            type = h3<0.5?"oil":(h3<0.78?"stain":"crack");
          const o={t:type, x, y};
          if(type==="oil"){ o.r=14+h3*22; o.a=0.05+h1*0.07; }
          else if(type==="stain"){ o.r=10+h3*18; o.a=0.05+h1*0.06; }
          else if(type==="blood"){ o.r=8+h3*16; o.a=0.08+h1*0.12; }
          else if(type==="crack"){ o.w=30+h3*70; o.ang=h1*6.2832; }
          else if(type==="grass"){ o.r=10+h3*14; }
          else if(type==="rocklet"){ o.r=4+h3*8; }
          D.push(o);
        }
      }
    }
    // 院子/道路停车线与磨损标线
    for(const yd of this.yards){
      const bx=(yd.x|0), by=(yd.y|0);
      const ln=1+Math.floor(H(bx+1,by+1)*3);
      for(let i=0;i<ln;i++){
        const hx=H(bx+i*3+2, by+i*5+3), hy=H(bx+i*7+5, by+i*2+9);
        D.push({t:"line", x:yd.x+20+hx*(yd.w-40), y:yd.y+20+hy*(yd.h-40),
                w:50+hy*70, ang:hx<0.5?1.57:0, a:0.04+hx*0.04});
      }
    }
    for(const rd of this.roads){
      const horiz=rd.w>=rd.h;
      const bx=(rd.x|0), by=(rd.y|0);
      const cnt=Math.max(1, Math.floor((horiz?rd.w:rd.h)/240));
      for(let i=0;i<cnt;i++){
        const hx=H(bx+i*4+1, by+i*6+2), hy=H(bx+i*2+7, by+i*3+5);
        D.push({t:"line", x:rd.x+20+hx*(rd.w-40), y:rd.y+20+hy*(rd.h-40),
                w:40+hy*70, ang:horiz?1.57:0, a:0.05+hx*0.05});
      }
    }
    // 涂鸦符号点缀（确定性）
    for(let i=0;i<44;i++){
      const hx=H(i*9+1,3), hy=H(7,i*5+2);
      const x=120+hx*(RAID_MAP_W-240), y=120+hy*(RAID_MAP_H-240);
      const d=this._distToRoom(x,y);
      if(d<120||d>920) continue;
      D.push({t:"glyph", x, y, r:14+H(i*3+4,9)*18,
              c:["#b84a3a","#caa23a","#4a8ab0","#7a5ab0"][i%4],
              a:0.12+H(i*2+1,5)*0.16, ang:H(i*6+3,1)*6.2832});
    }
  },

  /* 道路穿过建筑时按建筑轮廓裁掉，避免“路从屋里穿过去”的违和感 */
  _clipRoads(){
    const out=[];
    for(const rd of this.roads){
      let segs=[rd];
      for(const rm of RAID_ROOMS){
        const next=[];
        const box={x:rm.x-6,y:rm.y-6,w:rm.w+12,h:rm.h+12};
        for(const sg of segs){
          if(!this._hitRect(sg,box,0)){ next.push(sg); continue; }
          if(sg.y<box.y) next.push({x:sg.x,y:sg.y,w:sg.w,h:box.y-sg.y});
          if(sg.y+sg.h>box.y+box.h) next.push({x:sg.x,y:box.y+box.h,w:sg.w,h:sg.y+sg.h-(box.y+box.h)});
          const y0=Math.max(sg.y,box.y), y1=Math.min(sg.y+sg.h,box.y+box.h);
          if(y1-y0>0.5){
            if(sg.x<box.x) next.push({x:sg.x,y:y0,w:box.x-sg.x,h:y1-y0});
            if(sg.x+sg.w>box.x+box.w) next.push({x:box.x+box.w,y:y0,w:sg.x+sg.w-(box.x+box.w),h:y1-y0});
          }
        }
        segs=next;
      }
      for(const sg of segs){ if(sg.w>2&&sg.h>2) out.push(sg); }
    }
    this.roads=out;
  },

  /* 野外工棚：U 形残墙 + 一个敞口，既是天然掩体，也让空地有小据点 */
  _buildSheds(){
    const TH=14;
    for(let i=0;i<220 && this.sheds.length<32;i++){
      const w=RNG.ri(156,246), h=RNG.ri(132,204);
      const x=RNG.fr(320,RAID_MAP_W-320-w), y=RNG.fr(320,RAID_MAP_H-320-h);
      const box={x:x,y:y,w:w,h:h};
      if(this._distToRoom(x+w/2, y+h/2) < 300) continue;
      if(this._blockedSpawn(x+w/2, y+h/2)) continue;   // 工棚不建在河面上
      let bad=false;
      for(const L of this.doorLanes){ if(this._hitRect(box,L,50)){ bad=true; break; } }
      if(bad) continue;
      for(const p of this.props){ if(this._hitRect(box,p,54)){ bad=true; break; } }
      if(!bad) for(const w of this.walls){ if(this._hitRect(box,w,44)){ bad=true; break; } }   // 不压在坝体/围墙上
      if(bad) continue;
      for(const sh of this.sheds){ if(this._hitRect(box,sh,96)){ bad=true; break; } }
      if(bad) continue;
      const open=RNG.pick(["top","bottom","left","right"]);
      const add=(x2,y2,w2,h2)=>{ if(w2>0&&h2>0) this.walls.push({x:x2,y:y2,w:w2,h:h2,kind:"wall"}); };
      if(open!=="top")    add(x, y, w, TH);
      if(open!=="bottom") add(x, y+h-TH, w, TH);
      if(open!=="left")   add(x, y, TH, h);
      if(open!=="right")  add(x+w-TH, y, TH, h);
      this.sheds.push({ x:x, y:y, w:w, h:h, open:open });
      this.yards.push({ x:x-18, y:y-18, w:w+36, h:h+36, tint:"#2a2d26" });
    }
  },

  /* 建筑“院子”：房间外一圈水泥地，让孤零零的房子有占地感，也压住大片空地 */
  _buildYards(){
    for(const rm of RAID_ROOMS){
      if(rm.open) continue;   // 开放场地本身就是一大片铺装，不再叠水泥院子
      const p=RNG.ri(30,92), px=RNG.ri(18,70), py=RNG.ri(18,70);
      this.yards.push({ x:rm.x-px, y:rm.y-py, w:rm.w+px*2, h:rm.h+py*2,
        tint: rm.extract?"#1f3a2b":"#282b26" });
    }
  },

  /* 到最近建筑外墙的距离（0=贴在房间里侧），用于分区控制掩体密度 */
  _distToRoom(x,y){
    let best=1e9;
    for(const rm of RAID_ROOMS){
      const dx=Math.max(rm.x-x, 0, x-(rm.x+rm.w));
      const dy=Math.max(rm.y-y, 0, y-(rm.y+rm.h));
      const d=Math.hypot(dx,dy);
      if(d<best) best=d;
    }
    return best;
  },

  /* 室内家具：贴墙摆放，避开门内侧通道；贴边放不下时改摆房间中部 */
  _fillIndoor(){
    for(const rm of RAID_ROOMS){
      if(rm.extract || rm.open || rm.id===this.spawnRoomId) continue;
      const n=RNG.ri(3,5)+Math.floor(rm.w*rm.h/62000);   // 大房间不再空荡
      for(let i=0;i<n;i++){
        const t=RAID_INDOOR[RNG.weighted(RAID_INDOOR)];
        if(!t) continue;
        let done=false;
        for(let k=0;k<8 && !done;k++){
          let x,y;
          if(k<5){
            // 贴墙：随便挑一面，沿墙滑一段
            const edge=RNG.pick(["top","bottom","left","right"]);
            if(edge==="top"){ x=rm.x+RNG.fr(28,Math.max(29,rm.w-t.w-28)); y=rm.y+24; }
            else if(edge==="bottom"){ x=rm.x+RNG.fr(28,Math.max(29,rm.w-t.w-28)); y=rm.y+rm.h-t.h-24; }
            else if(edge==="left"){ x=rm.x+24; y=rm.y+RNG.fr(28,Math.max(29,rm.h-t.h-28)); }
            else { x=rm.x+rm.w-t.w-24; y=rm.y+RNG.fr(28,Math.max(29,rm.h-t.h-28)); }
          } else {
            x=rm.x+RNG.fr(40,Math.max(41,rm.w-t.w-40));
            y=rm.y+RNG.fr(40,Math.max(41,rm.h-t.h-40));
          }
          const box={x:x,y:y,w:t.w,h:t.h};
          if(x<rm.x+20||y<rm.y+20||x+t.w>rm.x+rm.w-20||y+t.h>rm.y+rm.h-20) continue;
          let bad=this._blocksLane(rm,box);
          if(!bad) for(const L of this.doorInner){ if(this._hitRect(box,L,4)){ bad=true; break; } }
          if(bad) continue;
          for(const p of this.props){ if(this._hitRect(box,p,24)){ bad=true; break; } }
          if(bad) continue;
          for(const w of this.walls){ if(this._hitRect(box,w,10)){ bad=true; break; } }   // 不压在牢房隔断上
          if(bad) continue;
          this._pushProp(t,x,y); done=true;
        }
      }
    }
  },

  /* 两门对穿的房间，中央要留出一条能直接跑过去的通道，家具不得横在中间 */
  _blocksLane(rm,box){
    const ds=rm._doors||[];
    if(!ds.length) return false;
    if(ds.length===1){
      // 单门房间：门到房间中心也要留一条直通带
      const a=ds[0], half=a.gap/2+14;
      if(a.dir==="top"||a.dir==="bottom"){
        const cy=rm.y+rm.h/2;
        return box.y+box.h>Math.min(a.mid,cy)-half && box.y<Math.max(a.mid,cy)+half;
      }
      const cx=rm.x+rm.w/2;
      return box.x+box.w>Math.min(a.mid,cx)-half && box.x<Math.max(a.mid,cx)+half;
    }
    const a=ds[0], b=ds[1];
    const half=Math.max(a.gap,b.gap)/2+16;
    if(a.dir==="top"&&b.dir==="bottom"){
      const y0=Math.min(a.mid,b.mid)-half, y1=Math.max(a.mid,b.mid)+half;
      return box.y+box.h>y0 && box.y<y1;
    }
    if(a.dir==="left"&&b.dir==="right"){
      const x0=Math.min(a.mid,b.mid)-half, x1=Math.max(a.mid,b.mid)+half;
      return box.x+box.w>x0 && box.x<x1;
    }
    return false;
  },

  /* 户外掩体：按离建筑远近分档密度 + 成簇（堆场/营地），避免"撒芝麻"式的均匀铺满 */
  _fillProps(){
    this._fillIndoor();

    const urban=[], wild=[];
    for(const t of RAID_PROPS){ if(t.wild) wild.push(t); else urban.push(t); }

    // 成簇：先选种子点，再围绕它堆 3~6 件同类物件
    for(let i=0;i<46;i++){
      const sx=RNG.fr(200,RAID_MAP_W-200), sy=RNG.fr(200,RAID_MAP_H-200);
      const d=this._distToRoom(sx,sy);
      if(d<130||d>1250) continue;
      const pool = d<430 ? urban : wild;
      const t0=pool[RNG.weighted(pool)];
      if(!t0) continue;
      const n=RNG.ri(3,6);
      for(let k=0;k<n;k++){
        const a=RNG.fr(0,6.2832), r=RNG.fr(70,240);
        const t=RNG.chance(0.74)?t0:pool[RNG.weighted(pool)];
        if(!t) continue;
        this._addProp(t, sx+Math.cos(a)*r-t.w/2, sy+Math.sin(a)*r-t.h/2);
      }
    }

    const CELL=234;
    const cols=Math.ceil(RAID_MAP_W/CELL), rows=Math.ceil(RAID_MAP_H/CELL);
    for(let gy=0;gy<rows;gy++){
      for(let gx=0;gx<cols;gx++){
        const hv=this._hash2(gx+13, gy+7);
        const cx0=gx*CELL+CELL/2, cy0=gy*CELL+CELL/2;
        const d=this._distToRoom(cx0,cy0);
        // 近建筑：密（堆场/街区）；中距：疏；荒野：很疏且只长灌木石头
        const skip = d<300 ? 0.05 : d<680 ? 0.20 : 0.46;
        if(hv<skip) continue;
        const pool = d<520 ? urban : wild;
        const n = hv>0.84 ? 3 : (hv>0.62 ? 2 : 1);
        for(let i=0;i<n;i++){
          const t=pool[RNG.weighted(pool)];
          if(!t) continue;
          let placed=false;
          for(let k=0;k<4 && !placed;k++){
            const cx=gx*CELL+RNG.fr(26,CELL-26), cy=gy*CELL+RNG.fr(26,CELL-26);
            if(this._addProp(t, cx-t.w/2, cy-t.h/2)) placed=true;
          }
        }
      }
    }

    // 房间外墙边的「废料带」：让建筑与荒野之间有过渡
    for(const rm of RAID_ROOMS){
      if(RNG.chance(0.45)) continue;
      const side=RNG.pick(["top","bottom","left","right"]);
      const t=RAID_PROPS[RNG.weighted(RAID_PROPS)];
      if(!t) continue;
      let x,y;
      if(side==="top"){ x=rm.x+RNG.fr(10,Math.max(11,rm.w-t.w)); y=rm.y-t.h-RNG.fr(26,64); }
      else if(side==="bottom"){ x=rm.x+RNG.fr(10,Math.max(11,rm.w-t.w)); y=rm.y+rm.h+RNG.fr(26,64); }
      else if(side==="left"){ x=rm.x-t.w-RNG.fr(26,64); y=rm.y+RNG.fr(10,Math.max(11,rm.h-t.h)); }
      else { x=rm.x+rm.w+RNG.fr(26,64); y=rm.y+RNG.fr(10,Math.max(11,rm.h-t.h)); }
      this._addProp(t,x,y);
    }
  },

  _canPlaceProp(x,y,t,roomPad){
    const box={x:x,y:y,w:t.w,h:t.h};
    if(x<72||y<72||x+t.w>RAID_MAP_W-72||y+t.h>RAID_MAP_H-72) return false;
    if(this._blockedSpawn(x+t.w/2, y+t.h/2)) return false;   // 物件不长在水面上
    for(const rm of RAID_ROOMS){
      if(this._hitRect(box, rm, roomPad||52)) return false;   // 房间外墙留出通行带
    }
    for(const L of this.doorLanes){
      if(this._hitRect(box, L, 6)) return false;              // 绝不堵门
    }
    for(const sh of this.sheds){
      if(this._hitRect(box, sh, 34)) return false;            // 棚子内外留出通行空间
    }
    for(const p of this.props){
      if(this._hitRect(box, p, 34)) return false;             // 物件间留 34px 缝隙，能侧身穿过
    }
    return true;
  },

  _pushProp(t,x,y){
    const p={ x:x, y:y, w:t.w, h:t.h, kind:t.kind, sight:t.sight!==false,
      soft:!t.sight, fill:t.fill, edge:t.edge };
    this.props.push(p);
    this.walls.push(p);
    return p;
  },

  _addProp(t,x,y){
    if(!this._canPlaceProp(x,y,t)) return false;
    this._pushProp(t,x,y);
    return true;
  },

  /* 碰撞 / 视线空间索引（256px 网格）：物件从 300 涨到上千，逐一遍历会拖慢帧率 */
  /* -------------------- 局内商店（枪店 / 材料店 / 回收超市 / 黑市） -------------------- */
  /* 摊位不再钉死在固定坐标 —— 每局按「区域锚点池」随机落点，数量 6 → 9。
   *   · 同类多摊位各有名字后缀，货架依然完全独立（见 _shopStock / URL 里的 sid）
   *   · 锚点池按地貌分区（工业区 / 北境 / 中央河谷 / 东部铁路 / 西南监狱·小镇 / 南岭），
   *     每局从池里随机抽，再叠 ±420 抖动 → 玩家每局都得重新摸商店位置。 */
  _buildShops(){
    const DEFS=[
      // 枪械商店 ×2：一个靠工业区起点，一个在东部/南岭（重装玩家常去的方向）
      { id:"shopGun",  kind:"gun",  name:"枪械商店",     tag:"GUNS",         color:"#ffb44a",
        anchors:[[2600,2900],[2900,1500],[5250,1600],[6200,1300]] },
      { id:"shopGun2", kind:"gun",  name:"枪械商店 II", tag:"GUNS",        color:"#ffb44a",
        anchors:[[10020,2900],[9300,6400],[11200,4600],[8600,8200]] },
      // 材料商店 ×3：工业区 / 西南南站 / 中央河谷或南岭
      { id:"shopMat",  kind:"mat",  name:"材料商店",     tag:"MATERIALS",    color:"#8fe07a",
        spawnNear:true,   // 起点补给点：固定在出生点 760~1500px 环内随机，保证开局有地方买绷带/钥匙
        anchors:[[3560,2900]] },
      { id:"shopMat2", kind:"mat",  name:"材料商店 II", tag:"MATERIALS",   color:"#8fe07a",
        anchors:[[1500,6180],[1900,7300],[2500,8600],[1200,8000]] },
      { id:"shopMat3", kind:"mat",  name:"材料商店 III", tag:"MATERIALS",   color:"#8fe07a",
        anchors:[[7400,4700],[8600,5400],[6500,6500],[9600,7300]] },
      // 回收超市 ×2：工业区 + 小镇
      { id:"shopRec",  kind:"rec",  name:"回收超市",     tag:"RECYCLE",      color:"#62c8ff",
        anchors:[[7400,2900],[6800,2400],[8200,3600]] },
      { id:"shopRec2", kind:"rec",  name:"回收超市 II", tag:"RECYCLE",     color:"#62c8ff",
        anchors:[[2740,7350],[2200,7900],[3400,7800],[3800,8600]] },
      // 黑市 ×2：东部铁路枢纽 + 北境（高风险区，离撤离点远）
      { id:"shopBlack",  kind:"black", name:"黑市",       tag:"BLACK MARKET", color:"#c07bff",
        anchors:[[10020,2900],[10800,4200],[9300,2200]] },
      { id:"shopBlack2", kind:"black", name:"黑市 II",  tag:"BLACK MARKET", color:"#c07bff",
        anchors:[[6900,900],[7400,1800],[8200,5200],[6500,8300]] },
    ];
    const usedAnchors=[];
    for(const d of DEFS){
      let px, py;
      const sp=this.spawnPoint||(this.player?{x:this.player.x,y:this.player.y}:{x:RAID_MAP_W/2,y:RAID_MAP_H/2});
      if(d.spawnNear){
        // 以出生点为圆心，760~1500px 的环内随机找净空（太近会刷脸上）
        let pt=null;
        for(let i=0;i<16 && !pt;i++){
          const a=RNG.fr(0,6.2832), r=RNG.fr(760,1500);
          const cand=this._shopSpot(sp.x+Math.cos(a)*r, sp.y+Math.sin(a)*r);
          if(M.dist(cand.x,cand.y,sp.x,sp.y)>620) pt=cand;
        }
        px=pt?pt.x:sp.x+900; py=pt?pt.y:sp.y;
        usedAnchors.push([px,py]);
      } else {
        // 先挑一个没被同类占用的锚点（避免两家摊位刷在同一个路口）
        let a=d.anchors[0];
        for(let i=0;i<12;i++){
          const cand=RNG.pick(d.anchors);
          if(usedAnchors.every(u=>M.dist(u[0],u[1],cand[0],cand[1])>820)){ a=cand; break; }
          a=cand;
        }
        usedAnchors.push(a);
        px=a[0]+RNG.fr(-420,420); py=a[1]+RNG.fr(-420,420);
      }
      const pt=this._shopSpot(px, py);
      const s=Object.assign({}, d, { x:pt.x, y:pt.y, r:66 });
      delete s.anchors; delete s.spawnNear;
      s.stock=this._shopStock(s.kind);
      this.shops.push(s);
    }
  },

  /* ------------- 可互动设施（医疗站 / 弹药箱 / 泄洪闸） ------------- */
  _buildGadgets(){
    this.gadgets=[];
    const byId=id=>RAID_ROOMS.find(r=>r.id===id);
    const put=(kind, id, label)=>{
      const rm=byId(id); if(!rm) return;
      const p=this._openPointInRoom(rm, 62);
      this.gadgets.push({ kind:kind, x:p.x, y:p.y, r:22, label:label, used:false, room:id });
    };
    put("med",  "prisonC",  "监狱医务站");
    put("ammo", "prisonB",  "狱警弹药柜");
    put("med",  "townHall", "镇政厅急救箱");
    put("ammo", "townShop", "杂货店弹药箱");
    put("med",  "damCtrl",  "大坝急救站");
    put("ammo", "quarry",   "采石场炸药箱");
    put("med",  "gasSW",    "加油站急救箱");
    // 广场警报器：拉响可把附近 AI 引过来（撤离前调虎离山，也能当诱饵）
    const yard=byId("prisonYard"), sq=byId("townSq");
    if(yard) this.gadgets.push({ kind:"siren", x:yard.x+yard.w/2, y:yard.y+yard.h/2,
      r:24, label:"监狱警报器", used:false, cdUntil:0 });
    if(sq) this.gadgets.push({ kind:"siren", x:sq.x+sq.w*0.34, y:sq.y+sq.h*0.6,
      r:24, label:"小镇广播喇叭", used:false, cdUntil:0 });
    // 泄洪闸：固定卡在坝体缺口，可反复开关
    this.gadgets.push({ kind:"dam", x:3535, y:8780, r:30, label:"泄洪闸", used:false });
  },

  _nearestGadget(x,y,range){
    if(!this.gadgets || !this.gadgets.length) return null;
    let best=null, bd=range*range;
    for(const g of this.gadgets){
      if(g.used && g.kind!=="dam") continue;         // 医疗站 / 弹药箱一次性；闸门与警报可复用
      const d2=M.dist2(x,y,g.x,g.y);
      if(d2<bd){ bd=d2; best=g; }
    }
    return best;
  },

  _useGadget(g){
    const p=this.player;
    if(g.kind==="med"){
      if(p.hp>=p.maxHP && !p.bleed){ this._float(p.x,p.y-52,"生命值已满","#8fd0ff"); return; }
      p.hp=Math.min(p.maxHP, p.hp+45);
      if(p.bleed) p.bleed=0;
      g.used=true;
      this._float(p.x,p.y-56,"+45 生命 · 已止血","#8fe07a");
      this._feed("设施", g.label+" · 完成急救","",false,"info");
      SFX.pickup();
    } else if(g.kind==="ammo"){
      /* v0.20.0：弹药柜直接往背包里塞两条同口径子弹（口径跟手上的枪走） */
      const gun=p.gun;
      const cal=gun ? (gun.cal||ammoCalOfType(gun.type)) : "mid";
      const lv=gun&&gun.loaded ? ((ammoParseId(gun.loaded)||{}).lv||1) : 1;
      const add=this._ammoAdd(ammoItemId(cal, lv), RAID_AMMO_STACK*2);
      g.used=true;
      if(add>0){
        this._float(p.x,p.y-56,"+ "+add+" 发 "+((ammoDefFromId(ammoItemId(cal,lv))||{}).short||"弹药"),"#ffd36a");
        this._feed("设施", g.label+" · 补给了 "+add+" 发弹药","",false,"info");
        SFX.reload();
      } else {
        this._float(p.x,p.y-56,"弹药已满","#ff8a5a");
      }
    } else if(g.kind==="siren"){
      const now=M.now();
      if((g.cdUntil||0)>now){
        this._float(g.x,g.y-70,`警报冷却中 · 还需 ${Math.ceil((g.cdUntil-now)/1000)} 秒`,"#ffb44a");
        return;
      }
      g.cdUntil=now+25000;
      this._noise(g.x, g.y, 2000, this.player);
      for(const o of this.ops){
        if(o.alive && !o.isPlayer && !o.remote && !o.ghost)
          o.investigate={ x:g.x, y:g.y, t:12 };
      }
      this._float(g.x,g.y-70,"警报拉响 · 附近 AI 正在赶来","#ff8a5a");
      this._feed("设施", g.label+" · 已拉响，AI 被引向该区域","",false,"warn");
      SFX.hurt();
    } else if(g.kind==="dam"){
      // 关闸前确认玩家不在库区里，否则会被水困住
      if(this.damOpen){
        const rr=this.reservoirRect;
        const inRes=rr && p.x>=rr.x && p.x<=rr.x+rr.w && p.y>=rr.y && p.y<=rr.y+rr.h;
        if(inRes){ this._float(g.x,g.y-70,"先离开水库再关闸","#ff8a5a"); SFX.hurt(); return; }
      }
      this.damOpen=!this.damOpen;
      if(this.damOpen){
        this._float(g.x, g.y-70, "泄洪闸开启 · 水库放空中","#8fd0ff");
        this._feed("系统","泄洪闸开启：水库底露出两个高级保险箱（巨响会引来 AI）","事件",false,"info");
        this._noise(g.x, g.y, 2400, this.player);
        SFX.boom();
      } else {
        this._float(g.x, g.y-70, "泄洪闸已关闭","#ffd36a");
        SFX.levelup();
      }
    }
  },
  // 沿主干道找净空：不压墙 / 不入水 / 不挨建筑 / 不撞树，找不到就绕圈扩大搜索
  _shopSpot(x,y){
    // 直接扫 this.walls，不用 _nearWalls 索引（索引在 _buildNavGrid 后才可靠）
    const hitWall=(px,py,r)=>{
      for(const w of this.walls){
        const nx=Math.max(w.x,Math.min(px,w.x+w.w)), ny=Math.max(w.y,Math.min(py,w.y+w.h));
        if((px-nx)*(px-nx)+(py-ny)*(py-ny) < r*r) return true;
      }
      return false;
    };
    const ok=(px,py)=>{
      if(px<220||py<220||px>RAID_MAP_W-220||py>RAID_MAP_H-220) return false;
      if(this._blockedSpawn(px,py)) return false;
      if(hitWall(px,py,72)) return false;
      if(this._distToRoom && this._distToRoom(px,py)<170) return false;
      for(const pr of this.props){ if(pr.kind==="tree" && M.dist(px,py,pr.x+pr.w/2,pr.y+pr.h/2)<130) return false; }
      for(const sh of this.sheds){ if(px>sh.x-90&&px<sh.x+sh.w+90&&py>sh.y-90&&py<sh.y+sh.h+90) return false; }
      for(const s of this.shops){ if(M.dist(px,py,s.x,s.y)<460) return false; }   // 摊位之间别挤在一起（9 家店仍要留出跑图空间）
      return true;
    };
    if(ok(x,y)) return {x,y};
    for(let i=0;i<120;i++){
      const a=i/120*6.2832, rr=130+i*11;
      const px=x+Math.cos(a)*rr, py=y+Math.sin(a)*rr;
      if(ok(px,py)) return {x:px,y:py};
    }
    // 兜底：全图粗网格扫描，取离目标最近的有效点（保证摊位一定可达、不卡墙里）
    let best=null, bd=1e9;
    for(let gx=420; gx<RAID_MAP_W-420; gx+=300){
      for(let gy=420; gy<RAID_MAP_H-420; gy+=300){
        if(!ok(gx,gy)) continue;
        const d=M.dist(gx,gy,x,y);
        if(d<bd){ bd=d; best={x:gx,y:gy}; }
      }
    }
    return best||{x,y};
  },
  _shopGun(rarTier, type){
    const cfgId=RAID_TIER_TO_RARITY[rarTier]||"white";
    const hi=rarTier>=4?(rarTier-3)*3:0;
    const ilvl=rarTier*3 + hi + 12 + RNG.ri(0,4);
    const w=blGunGen(ilvl,{ type:type||RNG.pick(RAID_GUN_TYPES), rarity:cfgId });
    ensureGunAffixes(w);
    w.uid=this._uid(); w.kind="weapon";
    w.qTier=rarTier; w.qName=RAID_TIERS[rarTier].name; w.qColor=RAID_TIERS[rarTier].color;
    return w;
  },
  _shopStock(kind){
    const out={ guns:[], parts:[], mats:[], meds:[], keys:[], ammo:[] };
    /* 一条子弹（30 发）：价格按「单发估值 × 30」走局内 0.8× 折扣 */
    const pack=(cal, lv, payKind)=>{
      const d=ammoDef(cal, lv);
      const it={ id:d.id, cal:d.cal, lv:d.lv, n:RAID_AMMO_STACK, name:d.name, short:d.short,
        spec:d.spec, color:d.color, value:d.value*RAID_AMMO_STACK, elem:d.elem };
      if(payKind==="token") it.tokenPrice=Math.max(3, Math.round(d.value*RAID_AMMO_STACK/380));
      else it.shopPrice=raidShopPrice(it.value, d.id);
      return it;
    };
    if(kind==="gun"){
      const tiers=[1,2,3,4];
      if(RNG.chance(0.35)) tiers.push(5);
      for(const t of tiers){
        const g=this._shopGun(t);
        g.shopPrice=raidShopPrice(g.value||1000, g.uid);
        out.guns.push(g);
      }
      // 改装模块不可合成 —— 枪械店常备一枚低阶改装模块（卢布可买）
      {
        const c=raidMakeBoostCore(RNG.pick(BOOST_CORE_IDS), 2+RNG.ri(0,1));
        c.shopPrice=raidShopPrice(raidCoreValue("boost", c.lv), c.uid);
        out.parts.push(c);
      }
      /* v0.20.0：枪械店兼卖弹药 —— 按本店在售枪型的口径，T2 / T3 各一条 */
      {
        const cals=[];
        for(const g of out.guns){
          const cal=g.cal||ammoCalOfType(g.type);
          if(cals.indexOf(cal)<0) cals.push(cal);
        }
        if(!cals.length) cals.push("mid");
        for(const cal of cals){ out.ammo.push(pack(cal, 2, "cash"), pack(cal, 3, "cash")); }
      }
    } else if(kind==="mat"){
      for(let i=0;i<6;i++){
        const m=raidMakeMaterial(0.35);
        // 按材料 id 定价：同一种材料在同一个摊位上价格一致，不会出现「三块破布三个价」
        m.shopPrice=raidShopPrice(m.value||40, m.id||m.uid);
        out.mats.push(m);
      }
      for(let i=0;i<3;i++){
        const pt=this._rollPartGear("pmc", 0.35);
        pt.shopPrice=raidShopPrice(partValue(pt), pt.uid);
        out.parts.push(pt);
      }
      /* v0.19.0：局内医疗品也按 0.8× 估价定价，并且五种全上架（旧版只有绷带/急救包/手术包/强心针） */
      out.meds=["bandage","hemo","medkit","stim","surgery"].map(id=>({
        id, n:1, price:raidShopPrice((RAID_MED_BY_ID[id]||{}).value||100, id),
      }));
      /* v0.20.0：材料店是弹药的主要补给点 —— 全口径 T1 民用、T2 制式 */
      for(const cal of AMMO_CAL_LIST){ out.ammo.push(pack(cal, 1, "cash"), pack(cal, 2, "cash")); }
      // 钥匙：材料商店只卖低阶 I~II，卢布结算
      out.keys=[raidMakeKey(1), raidMakeKey(2)];
      for(const k of out.keys) k.shopPrice=raidShopPrice(raidKeyDef(k.lv).value, "key"+k.lv);
    } else if(kind==="black"){
      const tokenPrice={ 6:26, 7:48, 8:86 };
      for(const t of [6,7,8]){
        const g=this._shopGun(t);
        g.tokenPrice=tokenPrice[t]||60;
        out.guns.push(g);
      }
      /* v0.20.0：黑市卖高级弹（T4 / T5），GP 币结算 —— 高级弹只能从这里或 V 级箱稳定拿到 */
      for(const cal of ["light","mid","heavy"]){ out.ammo.push(pack(cal, 4, "token"), pack(cal, 5, "token")); }
      if(!out.ammo.length) out.ammo.push(pack("mid", 4, "token"));
      // 改装模块不可合成，黑市是唯一能稳定买到高阶改装模块的地方
      {
        const c1=raidMakeBoostCore(RNG.pick(BOOST_CORE_IDS), 4+RNG.ri(0,1));
        c1.tokenPrice=c1.lv>=5?18:10;
        out.parts.push(c1);
        const c2=RNG.chance(0.5)
          ? raidMakeElemCore(RNG.pick(RAID_ELEM_CORE_ELEMS), 3+RNG.ri(0,1))
          : raidMakeChaosCore(3+RNG.ri(0,1));
        c2.tokenPrice = c2.core==="chaos" ? (c2.lv>=4?24:12) : (c2.lv>=4?14:8);
        out.parts.push(c2);
      }
      // 钥匙：黑市卖高阶 III~V，只收 GP 币
      out.keys=[raidMakeKey(3), raidMakeKey(4), raidMakeKey(5)];
      for(const k of out.keys) k.tokenPrice=raidKeyDef(k.lv).token;
    }
    return out;
  },

  _buildNavGrid(){
    const CS=256;
    const cols=Math.ceil(RAID_MAP_W/CS), rows=Math.ceil(RAID_MAP_H/CS);
    this.navCS=CS; this.navCols=cols; this.navRows=rows;
    this.navCell=new Array(cols*rows); this.losCell=new Array(cols*rows);
    const put=(arr,w)=>{
      const x0=Math.max(0,Math.floor(w.x/CS)), x1=Math.min(cols-1,Math.floor((w.x+w.w)/CS));
      const y0=Math.max(0,Math.floor(w.y/CS)), y1=Math.min(rows-1,Math.floor((w.y+w.h)/CS));
      for(let gy=y0;gy<=y1;gy++) for(let gx=x0;gx<=x1;gx++){
        const i=gy*cols+gx;
        (arr[i]||(arr[i]=[])).push(w);
      }
    };
    for(const w of this.walls){
      put(this.navCell,w);
      if(w.sight!==false) put(this.losCell,w);
    }
  },

  _nearWalls(x,y,r){
    const CS=this.navCS, cols=this.navCols, rows=this.navRows;
    if(!CS) return this.walls;
    const x0=Math.max(0,Math.floor((x-r)/CS)), x1=Math.min(cols-1,Math.floor((x+r)/CS));
    const y0=Math.max(0,Math.floor((y-r)/CS)), y1=Math.min(rows-1,Math.floor((y+r)/CS));
    const q=++this._navQ; const out=[];
    for(let gy=y0;gy<=y1;gy++) for(let gx=x0;gx<=x1;gx++){
      const a=this.navCell[gy*cols+gx]; if(!a) continue;
      for(let i=0;i<a.length;i++){
        const w=a[i]; if(w._q===q) continue;
        w._q=q; out.push(w);
      }
    }
    return out;
  },

  _spawnContainers(){
    // 箱子类型：weapon 武器箱 / medical 医疗箱 / armor 护甲箱 / random 杂项箱
    const randKind=()=>{ const a=[
      {weight:30, v:"weapon"}, {weight:24, v:"armor"},
      {weight:18, v:"medical"}, {weight:28, v:"random"} ]; return a[RNG.weighted(a)].v; };
    // 房间内箱子：密度随地图扩大（每间 2 起、每 9 万像素 +1）
    for(const rm of RAID_ROOMS){
      if(rm.extract) continue;
      const area=rm.w*rm.h;
      const n=2+Math.floor(area/90000);
      for(let i=0;i<n;i++){
        const p=this._openPointInRoom(rm, 66);
        this.containers.push({ x:p.x, y:p.y, tier:RNG.weighted([{weight:52},{weight:34},{weight:14}]),
          kind:randKind(), searched:false, drop:null });
      }
    }
    // 房间外的散落补给（地图空旷处，绕开房间矩形与户外掩体）
    let guard=0, added=0;
    while(added<88 && guard<2400){
      guard++;
      const x=RNG.fr(80, RAID_MAP_W-80), y=RNG.fr(80, RAID_MAP_H-80);
      if(this._blockedSpawn(x,y)) continue;   // 河面上不生箱子
      let inside=false;
      for(const rm of RAID_ROOMS){
        if(x>rm.x-44 && x<rm.x+rm.w+44 && y>rm.y-44 && y<rm.y+rm.h+44){ inside=true; break; }
      }
      if(inside) continue;
      for(const p of this.props){
        if(x>p.x-26 && x<p.x+p.w+26 && y>p.y-26 && y<p.y+p.h+26){ inside=true; break; }
      }
      if(inside) continue;
      this.containers.push({ x, y, tier:RNG.weighted([{weight:44},{weight:34},{weight:22}]),
        kind:"random", searched:false, drop:null, field:true });
      added++;
    }
    // 野外工棚内的补给（每个棚 1 个，玩家有理由往偏僻处跑）
    for(const sh of this.sheds){
      const p=this._openPointInRoom(sh, 46);
      this.containers.push({ x:p.x, y:p.y, tier:RNG.weighted([{weight:38},{weight:36},{weight:26}]),
        kind:randKind(), searched:false, drop:null });
    }
    // 上锁保险箱：分 5 档保险等级（lockLv），必须用对应等级钥匙打开
    //   V 级（军火箱）改为「全图随机、每局 20% 概率一口」，不再固定藏在大坝库底。
    //   其余 13 口：I 约六成、II 两成半、III 零星，IV 只保底一口（最大房间的军械库）。
    const rooms=RAID_ROOMS.filter(r=>!r.extract);
    const bigRooms=rooms.slice().sort((a,b)=>b.w*b.h-a.w*a.h);
    const LOCK_W=[{weight:64,lv:1},{weight:26,lv:2},{weight:8,lv:3},{weight:2,lv:4}];
    const VAULT_LV=[4];
    // 落箱位置：避开普通补给箱 / 设施，否则按 E 会先摸到旁边的木箱
    const spotIn=(rm, pad)=>{
      let p=this._openPointInRoom(rm, pad);
      for(let t=0;t<10;t++){
        const clash=this.containers.some(c=>M.dist(c.x,c.y,p.x,p.y)<92)
          || (this.gadgets||[]).some(g=>M.dist(g.x,g.y,p.x,p.y)<110);
        if(!clash) break;
        p=this._openPointInRoom(rm, pad);
      }
      return p;
    };
    for(let i=0;i<13;i++){
      const vault=i<VAULT_LV.length;
      const rm=vault?bigRooms[i%bigRooms.length]:RNG.pick(rooms);
      const p=spotIn(rm, vault?100:82);
      const lv=vault?VAULT_LV[i]:LOCK_W[RNG.weighted(LOCK_W)].lv;
      this.containers.push({ x:p.x, y:p.y, tier:2, locked:true, lockLv:lv,
        kind:"weapon", searched:false, drop:null });
    }
    // V 级军火箱：期望 0.2 口/局，随机落在中大型房间（含大坝控制室、监狱等），
    //   箱内是打穿整局的目标 —— 保底 T5 装备、4 件战利品、更高整枪/改装模块权重。
    if(RNG.chance(0.20)){
      const cand=rooms.filter(r=>r.w*r.h>=260*200);
      const rm=cand.length?RNG.pick(cand):RNG.pick(rooms);
      const p=spotIn(rm, 104);
      this.containers.push({ x:p.x, y:p.y, tier:2, locked:true, lockLv:5,
        kind:"weapon", searched:false, drop:null });
    }
    // 水库底的高级保险箱 —— 先开泄洪闸放水，才能走进去拿
    this.containers.push({ x:3250, y:9200, tier:2, locked:true, lockLv:4, kind:"weapon",
      searched:false, drop:null, damLoot:true });
    this.containers.push({ x:3720, y:9250, tier:2, locked:true, lockLv:3, kind:"weapon",
      searched:false, drop:null, damLoot:true });
  },

  _uid(){ return "g"+(this.uidN++)+"-"+Math.floor(Math.random()*9999); },

  _rollRarity(luck){
    // 9 阶品质：走硬预算——稀有及以上总量锁在 5% 左右，特种及以上约 1%
    return raidBudgetTier(luck);
  },

  // 通用战利品骰点：箱子以「原材料 + 配件」为主，整枪 / 护甲大幅降低
  // 无论带什么装备，任意品质都可能出现——携带估值只改变权重，不封顶。
  _rollGear(cls, luck){
    luck=luck||0;
    // 命名具名装备：独立骰点（裸装约 0.08%，满配约 0.3%）—— 特种总量仍受 1% 预算约束
    if(RNG.chance(0.0005 + luck*0.0014))                                // 命名特种更稀有
      return RNG.chance(0.35) ? raidRollShieldUnique(luck) : raidRollUnique(luck);
    const r=RNG.f();
    if(r < 0.78) return this._rollMaterial(cls==="scav"?0:luck);   // 78% 原材料
    if(r < 0.905) return this._rollPartGear(cls, luck);            // 12.5% 配件
    if(r < 0.917) return this._rollGunLoot(cls, luck);             // 1.2% 整枪
    if(r < 0.932){                                                 // 1.5% 护甲
      let tier=raidRollArmorTier(cls==="scav"?0:luck);
      if(cls==="scav") tier=Math.min(tier,SCAV_ARMOR_TIER_MAX);
      return raidMakeArmor(tier);
    }
    if(r < 0.942){                                                 // 1.0% 头盔
      let tier=raidRollArmorTier(cls==="scav"?0:(luck*0.85));
      if(cls==="scav") tier=Math.min(tier,SCAV_HELMET_TIER_MAX);
      return raidMakeHelmet(tier);
    }
    if(r < 0.952){                                                 // 1.0% 护盾
      let tier=raidRollArmorTier(cls==="scav"?0:luck);
      if(cls==="scav") tier=Math.min(tier,SCAV_ARMOR_TIER_MAX);
      return raidMakeShield(tier, this._rollRarity(cls==="scav"?0:luck));
    }
    return raidRollCore(luck);                                     // 5.8% 改装模块（唯一稳定来源）
  },

  // 散装配件：品质随运气浮动（越高档词缀越好）；floorTier 为品质保底（V 级军火箱用）
  _rollPartGear(cls, luck, floorTier){
    const slot=RNG.pick(GUN_SLOTS).id;
    const lt=raidBudgetTier(cls==="scav"?0:luck);
    let idx=M.clamp(lt, 0, RARITIES.length-1);
    if(floorTier) idx=Math.max(idx, Math.min(floorTier, RARITIES.length-1));
    const pt=rollPart(slot, cls==="scav"?8:14, RARITIES[idx].id);
    pt.kind="part";
    return pt;
  },

  // 枪械战利品：按塔科夫品质档位生成，高稀有度枪更强，并打上 qTier/qName/qColor 供显示
  // floorTier：品质保底（上锁保险箱按 lockLv 抬高下限，等级越高必出越好的枪）
  _rollGunLoot(cls, luck, floorTier){
    luck=luck||0;
    // Scav 的枪永远封顶在低阶池：不掉具名枪、不出高品级、不用步枪/狙击枪。
    if(cls==="scav"){
      const rarity=Math.min(2, this._rollRarity(0));
      const cfgId=RAID_TIER_TO_RARITY[rarity]||"white";
      let w=raidScavGun(3 + rarity*2 + RNG.ri(0,2), {
        type:RNG.pick(SCAV_GUN_TYPES), rarity:cfgId,
      });
      ensureGunAffixes(w);
      w.uid=this._uid(); w.kind="weapon";
      w.qTier=rarity; w.qName=RAID_TIERS[rarity].name; w.qColor=RAID_TIERS[rarity].color;
      return w;
    }
    let rarity=this._rollRarity(luck);
    if(floorTier) rarity=Math.max(rarity, floorTier);
    const id=RNG.pick(RAID_GUN_TYPES);
    const hi = rarity>=4 ? (rarity-3)*3 : 0;        // 高稀有度枪额外抬升等级 → 更强
    const ilvl=rarity*3 + hi + 9 + RNG.ri(0,3);
    const cfgId=RAID_TIER_TO_RARITY[rarity]||"white";
    let w=blGunGen(ilvl,{type:id, rarity:cfgId});
    ensureGunAffixes(w);   // 任何品质都要有前后缀
    w.uid=this._uid(); w.kind="weapon";
    w.qTier=rarity; w.qName=RAID_TIERS[rarity].name; w.qColor=RAID_TIERS[rarity].color;
    // 特种及以上有几率直接出「有名字」的传奇枪
    if(rarity>=5 && RNG.chance(0.10 + luck*0.08)){
      const uq=raidRollUnique(luck, u=>u.kind==="weapon");
      if(uq){ uq.uid=this._uid(); return uq; }
    }
    return w;
  },

  _rollMaterial(luck){ return raidMakeMaterial(luck); },

  /* ------------------------- 钥匙 / 上锁保险箱 ------------------------- */
  _keysInInv(){ return (this.inv && this.inv.keys) || []; },
  // 能不能开 lockLv 级箱子：优先用「刚好够级、剩余次数最少」的钥匙，把高级钥匙留给更硬的箱子
  _bestKeyFor(lv){
    const need=M.clamp(Math.round(lv||1),1,5);
    let best=null;
    for(const k of this._keysInInv()){
      if((k.lv||1) < need) continue;
      if(!best || k.lv<best.lv || (k.lv===best.lv && (k.uses||0)<(best.uses||0))) best=k;
    }
    return best;
  },
  _hasKeyFor(lv){ return !!this._bestKeyFor(lv); },
  // 消耗一次钥匙耐久；用尽即从物品栏移除（钥匙报废）
  _useKey(lv){
    const k=this._bestKeyFor(lv);
    if(!k) return null;
    k.uses=(k.uses||1)-1;
    if(k.uses<=0){
      const i=this.inv.keys.indexOf(k);
      if(i>=0) this.inv.keys.splice(i,1);
      if(this.player) this._float(this.player.x, this.player.y-56, k.name+" 用尽 · 报废", "#ff8a5a");
    }
    return k;
  },
  // 保险箱战利品：等级越高 → 运气加成 + 品质保底 + 件数更多
  _rollVaultLoot(lv){
    const L=M.clamp(Math.round(lv||1),1,5);
    const luck=this.lootLuck + L*0.10;
    // 装备品质保底（T0~T5）：V 级军火箱直接 T5 起步，基本只出橙品以上
    const floorT=[0,0,1,2,3,5][L];
    const r=RNG.f();
    // V 级：整枪 / 改装模块权重显著上调，材料让路（开一次就够本）
    if(L>=5){
      if(r<0.46) return this._rollGunLoot("pmc", luck+0.10, floorT);
      if(r<0.60) return raidMakeArmor(M.clamp(raidRollArmorTier(luck+0.08), 1+floorT, 9));
      if(r<0.72) return raidMakeHelmet(M.clamp(raidRollArmorTier(luck+0.06), 1+floorT, 9));
      if(r<0.92) return raidRollCore(luck+0.20);
      return this._rollPartGear("pmc", luck+0.06, floorT);
    }
    if(r<0.34) return this._rollGunLoot("pmc", luck, floorT);
    if(r<0.48) return raidMakeArmor(M.clamp(raidRollArmorTier(luck), 1+floorT, 9));
    if(r<0.60) return raidMakeHelmet(M.clamp(raidRollArmorTier(luck*0.9), 1+floorT, 9));
    if(r<0.76) return raidRollCore(luck);
    if(r<0.90) return this._rollPartGear("pmc", luck);
    return this._rollMaterial(luck);
  },

  /* ----------------------------- 更新 ----------------------------- */
  update(game, dt){
    if(!this.active) return;
    const act=Input.consume();
    if(act.pause){ this.shopOpen=null; game.pause(); return; }
    if(act.inv){
      this.showInv=!this.showInv; SFX.ui();
      document.body.classList.toggle('inv-open', this.showInv);   // 只收起其它触屏键，保留背包键可点
      this._invToggleDom();
    }
    // 面板开着时，拾取/丢弃后自动刷新（节流，避免每帧重建 DOM）
    if(this.showInv && this._invDirty){
      this._invT=(this._invT||0)-dt;
      if(this._invT<=0){ this._invDirty=false; this._invT=0.30; this._invRender(); }
    }

    const p=this.player;
    if(this.hitFlash>0) this.hitFlash-=dt;
    if(this.stimT>0) this.stimT=Math.max(0,this.stimT-dt);

    // 护甲耐久不自动回复（打穿即报废）；护盾按充能延迟 / 充能速度自主回充
    for(const o of this.ops){ this._tickArmorRegen(o, dt); this._tickShield(o, dt); }

    // 冷却与换弹（v0.14.10：冰冻状态在这里统一递减，玩家与 AI 一致）
    for(const o of this.ops){
      if(!o.alive) continue;
      if(o.freezeT>0) o.freezeT=Math.max(0, o.freezeT-dt);
      // v0.14.11：元素持续状态统一结算；玩家被引燃致死时 _fail 已收尾，直接退出本帧
      if(this._tickElementStatus(o,dt)) return;
      o.fireCd=Math.max(0,o.fireCd-dt);
      if(o.reloadT>0){
        o.reloadT-=dt;
        if(o.reloadT<=0) this._finishReload(o);
      }
    }

    // 绷带使用（塔科夫式：边走边撕会被打断）
    const p0=this.player;
    if(this.medT>0){
      if(Math.hypot(p0.moveX,p0.moveY)>0.2){
        this.medT=0; this.medUse=null;
        this._float(p0.x,p0.y-30,"移动打断治疗","#ff8a5a");
      } else {
        this.medT-=dt;
        if(this.medT<=0) this._finishMed();
      }
    }

    // 流血：每层每秒 -1 HP
    if(p0.alive && p0.bleed>0){
      p0.hp-=1.0*p0.bleed*dt;
      if(p0.hp<=0){ p0.hp=0; p0.alive=false; this._fail("失血过多"); return; }
    }

    if(!this.spectate){
      this._playerControl(dt, game, act);
      if(!this.active) return;
    }
    if(this.online && typeof Net!=="undefined") Net.tick(dt);
    this._botsUpdate(dt, game);
    if(!this.active) return;
    if(!this.spectate){
      this._searchUpdate(dt);
      this._extractUpdate(dt, game);
      if(!this.active) return;
    }

    // 计时
    this.timer-=dt;
    if(this.timer<=60 && !this._shownWarn){ this._shownWarn=true; this._feed("系统","撤离窗口将在 60 秒后关闭","警告",false,"warn"); }
    if(this.timer<=0){ this.timer=0; this._fail("超时未撤离"); return; }

    // 世界模拟只由房主（或单机）负责；客户端只接收快照
    const hostSim = !this.online || (typeof Net!=="undefined" && Net.isHost);
    if(hostSim){
      // 服务器背景交火（模拟其他玩家互相击杀 / 撤离）
      this.serverT-=dt;
      if(this.serverT<=0){ this.serverT=RNG.fr(26,42); this._backgroundFight(); }

      // 增援：开局 3 分钟后，全图缓慢刷出带装备的 AI（含小队 / 撤离点封锁者）
      this.elapsed+=dt;
      if(this.elapsed>=180){
        this.reinforceT-=dt;
        const aliveCount=this.ops.filter(o=>!o.isPlayer&&!o.remote&&!o.ghost&&o.alive).length;
        if(this.reinforceT<=0 && aliveCount<this.maxOps){
          this._spawnReinforcement();
          this.reinforceT=RNG.fr(20,32);   // 缓慢刷新间隔
        }
      }
    }

    this._updateCamera(game);

    // 粒子/飘字
    for(let i=this.tracers.length-1;i>=0;i--){
      const tr=this.tracers[i]; tr.life-=dt;
      if(tr.life<=0){ this.tracers.splice(i,1); continue; }
      // 普通子弹：色块沿弹道飞行（激光弹道直接画整条光束，无需位移）
      if(!tr.laser){ const f=1-M.clamp(tr.life/(tr.maxLife||0.08),0,1); tr.bx=tr.x1+(tr.x2-tr.x1)*f; tr.by=tr.y1+(tr.y2-tr.y1)*f; }
    }
    // 火箭弹：慢速飞行 + 命中/撞墙/超时爆炸
    for(let i=this.rockets.length-1;i>=0;i--){ if(this._updateRocket(this.rockets[i],dt)) this.rockets.splice(i,1); }
    for(let i=this.blasts.length-1;i>=0;i--){ const b=this.blasts[i]; b.life-=dt; if(b.life<=0) this.blasts.splice(i,1); }
    for(let i=this.floats.length-1;i>=0;i--){ const f=this.floats[i]; f.y+=f.vy*dt; f.life-=dt; if(f.life<=0) this.floats.splice(i,1); }
    for(let i=this.particles.length-1;i>=0;i--){ const q=this.particles[i]; q.x+=q.vx*dt; q.y+=q.vy*dt; q.vx*=0.9; q.vy*=0.9; q.life-=dt; if(q.life<=0) this.particles.splice(i,1); }
    // 击杀提示老化
    for(let i=this.killfeed.length-1;i>=0;i--){ this.killfeed[i].t-=dt; if(this.killfeed[i].t<=0) this.killfeed.splice(i,1); }
  },

  /* ----------------------------- 医疗系统 ----------------------------- */
  /* v0.19.0：医疗品统一走「仓库带入的计数 + 局内捡到的背包物品」两条来源。
   * 旧版只认 this.meds，导致局内翻箱捡到的止血针 / 强心针 / 手术包进得了背包却永远用不了，
   * 只剩绷带（独立计数）和急救包（多半是带入的）能用。现在两者合并计数、合并扣除。 */
  _medCount(id){
    if(id==="bandage") return Math.max(0, this.bandages|0);
    let n=Math.max(0, (this.meds && this.meds[id])|0);
    for(const m of (this.inv.meds||[])) if(m.id===id) n += Math.max(0, m.n|0);
    return n;
  },
  _medTake(id){
    if(id==="bandage"){ if(this.bandages>0){ this.bandages--; return true; } return false; }
    if((this.meds[id]|0) > 0){ this.meds[id]--; return true; }
    for(let i=0;i<this.inv.meds.length;i++){
      const m=this.inv.meds[i];
      if(m.id!==id || !(m.n>0)) continue;
      m.n--;
      if(m.n<=0) this.inv.meds.splice(i,1);
      this._invDirty=false;
      return true;
    }
    return false;
  },
  _medStart(id){
    const p=this.player, m=RAID_MED_BY_ID[id];
    if(!p || !m) return false;
    if(this.medT>0) return false;                 // 正在治疗，不打断
    if(!this._medTake(id)) return false;
    this.medUse={ id, name:m.name, heal:m.heal, bleed:m.bleed, cast:m.cast, boost:!!m.boost, color:RAID_RARITY_COLOR[m.tier] };
    this.medT=m.cast;
    this._float(p.x,p.y-34,"使用 "+m.name, RAID_RARITY_COLOR[m.tier]);
    return true;
  },
  // 指定使用某一种医疗品（HUD / 物品栏点「使用」都走这里）
  _useMed(id){ return this._medStart(id); },
  // 自动选择：流血→先止血；血量低→大回血；否则用最便宜可用的
  _useBestMed(){
    const p=this.player;
    const has=(id)=> this._medCount(id)>0;
    const pick=(id)=> this._medStart(id);
    if(p.bleed>0){
      if(has("bandage")) return pick("bandage");
      if(has("hemo"))    return pick("hemo");
      if(has("surgery")) return pick("surgery");
    }
    if(p.hp < p.maxHP*0.45 && has("surgery")) return pick("surgery");
    if(p.hp < p.maxHP*0.80 && has("medkit"))  return pick("medkit");
    if(has("hemo"))   return pick("hemo");
    if(has("medkit")) return pick("medkit");
    if(has("stim"))   return pick("stim");
    if(has("surgery"))return pick("surgery");
    if(has("bandage"))return pick("bandage");
    this._float(p.x,p.y-34,"没有医疗用品","#ff8a5a");
    return false;
  },
  /* HUD 用：按固定顺序返回「实际拥有」的医疗品，0 件不出现 */
  _medOwnedList(){
    const out=[];
    for(const m of RAID_MEDS){
      const n=this._medCount(m.id);
      if(n>0) out.push({ id:m.id, name:m.name, n, color:RAID_RARITY_COLOR[m.tier] });
    }
    return out;
  },
  _finishMed(){
    const p=this.player, u=this.medUse;
    if(!u){ this.medT=0; return; }
    if(u.bleed && p.bleed>0) p.bleed=0;
    if(u.heal>0) p.hp=Math.min(p.maxHP, p.hp+u.heal);
    if(u.boost) this.stimT=8;
    /* v0.14.11：治疗类物资顺带「净化」身上的元素状态。
     * 之前玩家被 AI 的曳光 / 亚音速 / 钢芯弹命中后毫无反制手段，只能干等计时结束；
     * 现在消耗一份医疗包可以止燃 / 恢复平衡 / 解除失能（破甲是装备 debuff，不在此列）。 */
    let cleansed="";
    if(u.heal>0 && ((p.burnT||0)>0 || (p.freezeT||0)>0 || (p.shockT||0)>0)){
      p.burnT=0; p.burnDps=0; p.burnSrc=null; p.freezeT=0; p.shockT=0;
      cleansed=" · 清除弹种状态";
    }
    this._float(p.x,p.y-30, (u.bleed?"已止血":"") + (u.heal>0?(" +"+u.heal+" HP"):"") + (u.boost?" · 加速":"") + cleansed, "#8fe07a");
    SFX.pickup();
    this.medUse=null; this.medT=0;
  },

  /* -------------------- 多枪：手持 / 副手 / 背包 -------------------- */
  // 每把枪的运行时对象按 uid 缓存：切回来时弹药状态连续，也不会出现「换手满弹」
  _rtGun(it){
    if(!it) return null;
    this._rtCache=this._rtCache||{};
    if(!it.uid) it.uid="rt"+Math.floor(Math.random()*1e9).toString(36);
    const key=it.uid;
    let g=this._rtCache[key];
    if(!g){
      g=raidGunFromItem(it);
      g.cal=ammoCalOfType(g.type);          // 口径跟枪型走
      g.ammoMag=0; g.ammoRes=0;             // 子弹在背包里，装填见 _prepPlayerAmmo / _startReload
      this._rtCache[key]=g;
    }
    return g;
  },
  // 背包里的枪 = 物品栏中「既不在手上、也不在副手位」的那些
  _gunBag(){
    const p=this.player; if(!p) return [];
    return (this.inv.weapons||[]).filter(it=>{ const g=this._rtGun(it); return g!==p.gun && g!==p.secondary; });
  },
  _gunList(){
    const p=this.player; if(!p) return [];
    return [p.gun, p.secondary, ...this._gunBag()].filter(Boolean);
  },

  /* -------------------- 局内商店交互 -------------------- */
  _nearestShop(x,y,range){
    let best=null, bd=range||120;
    for(const s of (this.shops||[])){
      const d=M.dist(x,y,s.x,s.y);
      if(d<bd){ bd=d; best=s; }
    }
    return best;
  },
  _openShop(sh){
    if(!sh) return;
    if(this.showInv){ this.showInv=false; document.body.classList.remove('inv-open'); this._invToggleDom(); }
    this.shopOpen=sh.id;
    SFX.ui();
    UI.raidFieldShop(sh.id);
  },
  _closeShop(){
    this.shopOpen=null;
    UI.hide();
    // UI.show() 会藏起 HUD / 触屏按钮，关商店后必须还回来，
    // 否则「退出商店所有按钮都消失」（手机上摇杆与★/+ 键全没了）。
    // 注意塔科夫/沙二/大逃杀用的是 _showDustHUD（DOM 血条隐藏、只留触屏层），
    // 不能一律调 _showHUD，否则会多出一套战役 HUD。
    if(typeof game!=="undefined" && game){
      const fn=(game.mode==="raid"||game.mode==="dust2"||game.mode==="br") ? game._showDustHUD : game._showHUD;
      if(fn) fn.call(game);
    }
    // 商店开着时摇杆被藏起来，关店后把残留方向清掉，免得一关店人就自己往前跑
    if(typeof Input!=="undefined" && Input.resetStick) Input.resetStick();
  },
  // 把手上的枪与目标枪交换；被换下的枪自动留在物品栏（= 放进背包）
  _equipGun(g){
    const p=this.player;
    if(!g || g===p.gun) return;
    const old=p.gun;
    if(g===p.secondary){ p.secondary=old||null; p.gun=g; }
    else { p.gun=g; }   // 背包枪：手上的旧枪条目仍在 inv.weapons 里，等于收回背包
    p.reloadT=0; p.fireCd=Math.max(p.fireCd,0.25);
    this._float(p.x, p.y-34, "手持 "+g.name, raidGunColor(g));
  },
  // Q / 切枪：优先从背包取下一把；背包空则与副手互换；只剩一把则收枪入包（空手跑更快）
  _cycleGun(){
    const p=this.player; if(!p) return;
    const bag=this._gunBag();
    if(bag.length){ this._equipGun(this._rtGun(bag[0])); return; }
    if(p.gun && p.secondary){
      const t=p.gun; p.gun=p.secondary; p.secondary=t;
      p.reloadT=0; p.fireCd=Math.max(p.fireCd,0.25);
      this._float(p.x, p.y-34, "手持 "+p.gun.name, raidGunColor(p.gun));
    } else if(p.gun){
      // 只有一把 → 收进背包，空手移动（跑刀 / 谈判时腾出手）
      this._float(p.x, p.y-34, "收进背包 · 空手", "#8fd0ff");
      p.gun=null; p.reloadT=0;
    } else if(p.secondary){
      p.gun=p.secondary; p.secondary=null; p.reloadT=0; p.fireCd=Math.max(p.fireCd,0.25);
      this._float(p.x, p.y-34, "手持 "+p.gun.name, raidGunColor(p.gun));
    }
  },

  /* ----------------------------- 玩家控制 ----------------------------- */
  _playerControl(dt, game, act){
    const p=this.player;
    let mx=0,my=0;
    if(Input.isTouch){
      if(Input.stick.active){ mx=Input.stick.dx; my=Input.stick.dy; }
    } else {
      if(Input.keys['KeyW']||Input.keys['ArrowUp']) my-=1;
      if(Input.keys['KeyS']||Input.keys['ArrowDown']) my+=1;
      if(Input.keys['KeyA']||Input.keys['ArrowLeft']) mx-=1;
      if(Input.keys['KeyD']||Input.keys['ArrowRight']) mx+=1;
    }
    let ml=Math.hypot(mx,my); if(ml>1){ mx/=ml; my/=ml; ml=1; }
    /* 3D：WASD 从世界方向转为「相对视角」的前后左右 */
    if(typeof ViewMode!=="undefined" && ViewMode.is3D()){
      const mv=ViewMode.rotateMove(mx,my); mx=mv.x; my=mv.y;
    }
    p.moveX=mx; p.moveY=my;

    // 换枪（弹药状态跟随枪支，不再瞬间满弹）
    // 手上 1 把 + 副手 1 把 + 背包 N 把，Q 循环取背包里的下一把
    if(act.switch) this._cycleGun();
    if(act.slot>0){
      const list=this._gunList();
      if(list[act.slot-1]) this._equipGun(list[act.slot-1]);
    }

    // 瞄准 / 开火
    let fire=false;
    if(Input.isTouch){
      const tgt=p.gun?this._nearestFoe(p, p.gun.range):null;
      this.aimTgt=tgt;
      if(tgt){
        p.angle=M.lerpAngle(p.angle, M.angle(p.x,p.y,tgt.x,tgt.y), 0.42);
        fire=Input.fireHeld || Input.autoFire;
      } else {
        if(ml>0.12) p.angle=M.lerpAngle(p.angle, Math.atan2(my,mx), 0.25);
        fire=Input.fireHeld;
      }
    } else {
      const w=this._screenToWorld(Input.mouse.sx, Input.mouse.sy, game);
      p.angle=Math.atan2(w.y-p.y, w.x-p.x);
      fire=Input.mouse.down;
    }
    /* 3D：视角朝向即开火方向，覆盖 2D 下由鼠标世界坐标反算的角度 */
    if(typeof ViewMode!=="undefined" && ViewMode.is3D()) p.angle=ViewMode.yaw;

    // 移动（强心针：8 秒内 +25% 移速）
    const sp=p.speed*(p.reloadT>0?0.7:1)*(this.stimT>0?1.25:1);
    this._moveOp(p, mx*sp*dt, my*sp*dt);
    p.vx=mx*sp; p.vy=my*sp;

    /* 涉水失温 —— 河流可以慢慢趟过去（4.5 秒安全期覆盖整条河宽），
     * 但泡在水里不动超过安全期就开始掉血，越泡掉得越快，逼玩家别把河当掩体。 */
    if(this._waterKind(p.x,p.y)===1){
      this.wadeT=(this.wadeT||0)+dt;
      if(this.wadeT>4.5){
        this.wadeDmgT=(this.wadeDmgT||0)+dt;
        if(this.wadeDmgT>=0.5){
          this.wadeDmgT-=0.5;
          this._wadeHurt(M.clamp(3+Math.floor((this.wadeT-4.5)/1.5), 3, 12));
        }
      }
    } else { this.wadeT=0; this.wadeDmgT=0; }

    // 换弹 / 射击（空手时跳过）
    if(p.gun){
      if(act.reload) this._startReload(p);
      if(p.gun.ammoMag<=0 && p.reloadT<=0) this._startReload(p);
      if(fire && p.fireCd<=0 && p.reloadT<=0){
        if(p.gun.ammoMag>0) this._fire(p, p.angle, game);
        else this._startReload(p);
      }
    }

    // 医疗（桌面 H / 移动端医疗键）：自动挑最合适的一件——流血先止血，血量低先回血
    let bandaging=false;
    if(act.med && this.medT<=0 && this._useBestMed()){ SFX.ui(); bandaging=true; }

    // 搜索补给（手机端「★」搜索键 / 桌面 E；「+」键只负责医疗，两键互不干扰）
    if((act.interact || act.ability) && !bandaging && !this.search && !this.shopOpen){
      const it=this._interactTarget();
      if(it && it.kind==="shop"){ this._openShop(it.ref); }
      else if(it && it.kind==="gadget"){ this._useGadget(it.ref); }
      else if(it && it.kind==="container"){
        const c=it.ref;
        if(!c.searched){
          if(c.locked && !this._hasKeyFor(c.lockLv)){
            const lv=M.clamp(c.lockLv||1,1,5);
            this._float(p.x, p.y-52, `需要「${RAID_LOCK_NAME[lv]}钥匙」才能开这个保险箱`, "#ff8a5a");
            SFX.ui();
          } else { this.search={ c, t:0 }; SFX.ui(); }
        }
      }
    }
  },

  /* 按 E 时到底该操作什么 —— 商铺 / 设施 / 箱子按「贴脸程度」决胜。
   * 商铺不再无条件抢优先级（站在保险箱前、商铺在 110px 外时也要能开箱），
   *   改成各自用「距离 ÷ 触发半径」归一化比较，越贴脸越优先。 */
  _interactTarget(){
    const p=this.player;
    const sh=this._nearestShop(p.x, p.y, 118);
    const gd=this._nearestGadget(p.x, p.y, 96);
    let c=this._nearestContainer(p.x, p.y, 78);
    if(c && c.damLoot && !this.damOpen) c=null;   // 水下保险箱：开闸前不可交互
    const cands=[];
    if(sh) cands.push({ kind:"shop", ref:sh, s:M.dist(p.x,p.y,sh.x,sh.y)/118 });
    if(gd) cands.push({ kind:"gadget", ref:gd, s:M.dist(p.x,p.y,gd.x,gd.y)/96 });
    if(c) cands.push({ kind:"container", ref:c, s:M.dist(p.x,p.y,c.x,c.y)/78 });
    if(!cands.length) return null;
    cands.sort((a,b)=>a.s-b.s);
    return { kind:cands[0].kind, ref:cands[0].ref };
  },

  /* 涉水失温伤害 —— 直接扣血（泡水不是被子弹打，护甲不吸收） */
  _wadeHurt(d){
    const p=this.player;
    if(!p.alive || this._ended) return;
    p.hp-=d;
    this.hitFlash=Math.min(0.30, this.hitFlash+0.06);
    this._float(p.x, p.y-26, "-"+d+" 失温", "#7fc8e8");
    if(p.hp<=0){ p.hp=0; p.alive=false; this._fail("失温溺亡", null, null); }
  },

  /* ----------------------------- 弹药（v0.20.0） -----------------------------
   * 子弹是背包里的独立物品：inv.ammo = { "ammo_mid_3": 120, ... }
   * 枪上只存「装填的是哪一种」（loaded）与弹匣内发数（ammoMag）。 */
  _ammoTotal(){
    const a=(this.inv && this.inv.ammo)||{}; let n=0;
    for(const k in a) n+=a[k]||0;
    return n;
  },
  _ammoCount(id){ return (this.inv && this.inv.ammo && this.inv.ammo[id])||0; },
  _ammoAdd(id, n){
    if(!id || !(n>0) || !ammoParseId(id)) return 0;
    this.inv.ammo=this.inv.ammo||{};
    const room=Math.max(0, RAID_AMMO_CAP-this._ammoTotal());
    const add=Math.min(n, room);
    if(add<=0) return 0;
    this.inv.ammo[id]=(this.inv.ammo[id]||0)+add;
    this._invDirty=true;
    return add;
  },
  _ammoTake(id, n){
    if(!id || !(n>0)) return 0;
    const have=this._ammoCount(id);
    const take=Math.min(have, n);
    if(take<=0) return 0;
    const left=have-take;
    if(left>0) this.inv.ammo[id]=left; else delete this.inv.ammo[id];
    this._invDirty=true;
    return take;
  },
  /* 按口径列出背包里的子弹，高级在前（换弹时优先用好的） */
  _ammoListByCal(cal){
    const out=[];
    for(let lv=5; lv>=1; lv--){
      const id=ammoItemId(cal, lv), n=this._ammoCount(id);
      if(n>0) out.push({ id, lv, n, def:ammoDef(cal, lv) });
    }
    return out;
  },
  _bestAmmoFor(gun){
    if(!gun) return null;
    if(gun.loaded && this._ammoCount(gun.loaded)>0) return gun.loaded;
    const cal=gun.cal||ammoCalOfType(gun.type);
    const list=this._ammoListByCal(cal);
    return list.length ? list[0].id : null;
  },
  /* 装填：同时改写 element / power / dotK —— 战斗结算只认这三个字段 */
  _loadAmmo(gun, id){
    const d=ammoDefFromId(id);
    if(!gun || !d) return false;
    gun.loaded=d.id; gun.cal=d.cal;
    gun.element=d.elem; gun.power=d.power; gun.dotK=d.dotK;
    return true;
  },
  _syncAmmo(o){
    if(!o || !o.gun) return 0;
    if(!o.isPlayer) return o.gun.ammoRes||0;
    o.gun.ammoRes=this._ammoCount(o.gun.loaded);
    return o.gun.ammoRes;
  },
  _noAmmoWarn(gun){
    const now=M.now();
    if((this._noAmmoT||0) > now-1.6) return;
    this._noAmmoT=now;
    const d=gun&&gun.loaded ? ammoDefFromId(gun.loaded) : null;
    this._float(this.player.x, this.player.y-40,
      d ? (d.name+" 打空了 · 去搜刮或买弹药") : "没有子弹 · 去搜刮或买弹药", "#ff8a5a");
  },

  /* 把一件护盾装备穿到玩家身上（含独特加成解析） */
  _wearShield(it){
    const p=this.player;
    if(!p || !it) return false;
    const s=ensureShield(it);
    p.shieldGear=s;
    p.maxShield=s.capacity||0;
    p.shield=p.maxShield;
    p.shieldRate=s.rate||0;
    p.shieldDelay=s.delay||0;
    p.shieldInvulnBase=s.invuln||0;
    p.shieldPerks=(s.perks||[]).slice();
    p.shieldTimer=0; p.shieldInvuln=0;
    p.shieldAbsorbMul=p.shieldPerks.indexOf("emitter")>=0 ? 1.08 : 1;
    return true;
  },

  /* 出生点旁的起始补给：**只在手上这把枪一发子弹都没有时**才投放，
   * 免得「默认零携带」把裸装玩家直接锁死成走不动的靶子。
   * 不是白送进背包 —— 要走到旁边按 E 搜（0.3 秒），带弹进场的玩家不会看到它。 */
  _dropStarterCache(x, y){
    const p=this.player;
    if(!p) return;
    const gun=p.gun||p.secondary;
    const cal=gun ? (gun.cal||ammoCalOfType(gun.type))
                  : (this.carried.weapons[0] ? ammoCalOfType(this.carried.weapons[0].type) : "mid");
    if(this._ammoListByCal(cal).length) return;      // 已经有这个口径的子弹 → 不投放
    if(!this.grounds) this.grounds=[];
    const spot=this._spawnSafePoint(x+92, y+64, 18);
    const ammo=ammoDef(cal, 1);
    ammo.n=RAID_AMMO_STACK*2;                        // 两条民用弹（60 发）
    this.grounds.push({ x:spot.x, y:spot.y, tier:0, ground:true, searched:false,
      drops:[ammo, raidMakeMed("bandage")], cash:0, starter:true });
    this._starterCache=true;
  },

  /* 带够现金的「支援物资」（v0.21.0）：
   * 判定的是**带进局的卢布现金**（opts.cash），不是配装估值 —— 愿意把钱带进图，
   * 就等于把身家押在这一局上，系统给一套最基础的货兜底：
   * 2 把白枪 + 每条一把 T2 制式弹 + T1 护盾 / 护甲 / 头盔 + 绷带与止血针各一。
   * 和起始补给一样，要走到旁边按 E 搜（0.3 秒）才进包。 */
  _dropSupportCache(x, y){
    if((this.cashIn||0) < RAID_SUPPORT_CASH) return;
    if(!this.grounds) this.grounds=[];
    const spot=this._spawnSafePoint(x-92, y+64, 18);
    const drops=[];
    const cals=[];
    for(let i=0;i<2;i++){
      const g=blGunGen(8, { type: i ? "smg" : "rifle", rarity:"white" });
      g.kind="weapon"; g.uid=this._uid();
      drops.push(g);
      const cal=ammoCalOfType(g.type);
      if(cals.indexOf(cal)<0){
        cals.push(cal);
        const a=ammoDef(cal, 2);          // T2 制式
        a.n=RAID_AMMO_STACK;
        drops.push(a);
      }
    }
    drops.push(raidMakeShield(1, 0));      // T1 民用护盾
    drops.push(raidMakeArmor(1, 0));       // T1 护甲
    drops.push(raidMakeHelmet(1, 0));      // T1 头盔
    for(const id of ["bandage","hemo"]){
      const m=raidMakeMed(id);
      if(m) drops.push(m);
    }
    this.grounds.push({ x:spot.x, y:spot.y, tier:0, ground:true, searched:false,
      drops, cash:0, support:true });
    this._supportDropped=true;
    this._feed("支援", "携带 ₽"+this.cashIn+" 进场 · 出生点已投放支援物资", "", false, "info");
  },

  /* 进场装填：按配装大厅的选择把子弹搬进本局，给手上的枪上膛 */
  _prepPlayerAmmo(opts){
    this.inv.ammo=this.inv.ammo||{};
    const st=this.stash||{}, stAmmo=st.ammo||(st.ammo={});
    const want=(opts && opts.ammo)||null;
    const take=(id, n)=>{
      const have=Math.max(0, stAmmo[id]||0);
      const room=Math.max(0, RAID_AMMO_CAP-this._ammoTotal());
      const k=Math.min(have, room, Math.max(0, Math.round(n)||0));
      if(k<=0) return 0;
      if(have-k>0) stAmmo[id]=have-k; else delete stAmmo[id];
      this.inv.ammo[id]=(this.inv.ammo[id]||0)+k;
      return k;
    };
    if(want){
      for(const cal of Object.keys(want)){
        const w=want[cal];
        if(!w || !w.id) continue;
        take(w.id, w.n===undefined ? 9999 : w.n);
      }
    }
    /* v0.20.1：没指定（opts.ammo 缺省 / 为空）= 一发都不带。
     * 之前「没指定就全带」会让玩家默认背满 720 发，与「弹药要自己负责」的设计相反。 */
    const p=this.player;
    if(!p) return;
    for(const gun of [p.gun, p.secondary]){
      if(!gun) continue;
      gun.cal=ammoCalOfType(gun.type);
      const wantId=want && want[gun.cal] && want[gun.cal].id;
      let id=(wantId && this._ammoCount(wantId)>0) ? wantId : this._bestAmmoFor(gun);
      if(!id){ gun.ammoMag=0; gun.ammoRes=0; continue; }
      this._loadAmmo(gun, id);
      gun.ammoMag=this._ammoTake(id, gun.mag);
      gun.ammoRes=this._ammoCount(id);
    }
  },

  _startReload(o){
    if(!o.gun) return;
    if(o.reloadT>0 || o.gun.ammoMag>=o.gun.mag) return;
    if(o.isPlayer){
      this._syncAmmo(o);
      if(o.gun.ammoRes<=0){
        /* 当前那档打光了：自动换用背包里同口径还没打光的子弹（高级优先） */
        const alt=this._bestAmmoFor(o.gun);
        if(alt && alt!==o.gun.loaded){
          this._loadAmmo(o.gun, alt);
          this._syncAmmo(o);
          if(o.gun.ammoRes>0) this._float(o.x, o.y-40, "换用 "+ammoDefFromId(alt).short, "#ffd36a");
        }
      }
      if(o.gun.ammoRes<=0){ this._noAmmoWarn(o.gun); return; }
    } else if(o.gun.ammoRes<=0) return;
    o.reloadT = Math.max(0.9, 2.4 - o.gun.mag*0.02);
    SFX.reload();
  },

  /* 换弹读条结束：玩家从背包扣子弹，AI 直接补满（AI 没有物品栏） */
  _finishReload(o){
    if(!o || !o.gun) return;
    const g=o.gun;
    const need=Math.max(0, g.mag-g.ammoMag);
    if(!o.isPlayer){
      if(g.ammoRes < g.mag) g.ammoRes = g.mag;
      const take=Math.min(need, g.ammoRes);
      g.ammoMag+=take; g.ammoRes-=take;
      return;
    }
    const id=g.loaded;
    const take=id ? this._ammoTake(id, need) : 0;
    g.ammoMag+=take;
    g.ammoRes=id ? this._ammoCount(id) : 0;
    if(take<=0) this._noAmmoWarn(g);
  },

  _moveOp(o, dx, dy){
    const px=o.x, py=o.y;
    /* 河流不再整条封死 —— 浅水可涉水通过，但速度只剩 45%；
     * 深水（大坝水库未开闸）依旧硬阻挡，踩桥面（kind=0）不受影响。 */
    const wetHere=this._waterKind(o.x,o.y)===1;
    const wetNext=this._waterKind(o.x+dx,o.y+dy)===1;
    if(wetHere || wetNext){ dx*=0.45; dy*=0.45; }
    // v0.14.10：冰冻减速与涉水减速叠乘（玩家 / AI 共用此入口）
    if(o.freezeT>0){ dx*=FREEZE_SLOW; dy*=FREEZE_SLOW; }
    let nx=o.x+dx, ny=o.y+dy;
    // 分轴滑行：先 X 后 Y，贴墙时仍能滑动
    let r=this._resolve(nx, o.y, o.r); nx=r.x;
    r=this._resolve(nx, ny, o.r); nx=r.x; ny=r.y;
    o.x=M.clamp(nx, o.r, RAID_MAP_W-o.r);
    o.y=M.clamp(ny, o.r, RAID_MAP_H-o.r);
    // 深水阻挡：落深水则沿岸边滑行（仅保留未落深水的单轴位移）
    if(this._waterKind(o.x,o.y)===2){
      if(this._waterKind(px, o.y)!==2) o.x=px;
      else if(this._waterKind(o.x, py)!==2) o.y=py;
      else { o.x=px; o.y=py; }
    }
    o._wet = this._waterKind(o.x,o.y)===1;
    // 移动幅度（0..1）：180px/s÷60 ≈ 3px/帧
    o._mv = Math.min(1, Math.hypot(o.x-px, o.y-py)/3.0);
  },

  _resolve(x, y, r){
    const list=this._nearWalls ? this._nearWalls(x, y, r+6) : this.walls;
    for(let i=0;i<list.length;i++){
      const w=list[i];
      const nx=M.clamp(x, w.x, w.x+w.w), ny=M.clamp(y, w.y, w.y+w.h);
      const dx=x-nx, dy=y-ny; const d2=dx*dx+dy*dy;
      if(d2<r*r){
        const d=Math.sqrt(d2)||0.0001, push=r-d;
        x+=(dx/d)*push; y+=(dy/d)*push;
      }
    }
    return {x,y};
  },

  /* ----------------------------- AI PMC ----------------------------- */
  _botsUpdate(dt, game){
    // 联机非房主：AI 完全由房主模拟，这里只渲染影子
    if(this.online && typeof Net!=="undefined" && !Net.isHost) return;
    if(this.spawnGrace>0) this.spawnGrace=Math.max(0,this.spawnGrace-dt);   // 整帧只递减一次
    let p=this.player;
    for(const b of this.ops){
      if(b.isPlayer||b.remote||b.ghost||!b.alive) continue;
      const sense=raidAISense(b);
      // 联机房主：AI 会在「自己 + 所有远端玩家」里挑最近的可见目标
      // AI 之间也会交火 —— 把「其他敌对 AI」也纳入候选目标（同小队不互打、流浪 Scav 之间友好）
      let tgt=p, d=M.dist(b.x,b.y,p.x,p.y);
      const _consider=(o)=>{
        if(o===b || !o.alive || o.ghost) return;
        let enemy;
        if(o.isPlayer || o.remote) enemy=true;                              // 玩家永远是敌人
        else if(b.bounty || o.bounty) enemy=true;                           // Boss 敌对所有
        else if(b.cls==="scav" && o.cls==="scav") enemy=false;             // 流浪 Scav 之间友好
        else if(o.squadId && o.squadId===b.squadId && b.squadId) enemy=false; // 同小队不互打
        else enemy=true;
        if(!enemy) return;
        const dd=M.dist(b.x,b.y,o.x,o.y);
        // 视距按 Scav / PMC / Boss 分级；玩家在近身范围内仍强行抢目标
        const sight = sense.sight;
        const pri = (o.isPlayer||o.remote) ? (dd<720 ? -2000 : 0) : 0;   // 玩家近身时强行抢目标
        if((dd+pri)<d && dd<sight && this._los(b.x,b.y,o.x,o.y)){ d=dd; tgt=o; }
      };
      _consider(p);
      if(this.online){ for(const o of this.ops){ if(o.isPlayer||o.remote) _consider(o); } }
      for(const o of this.ops){ if(!o.isPlayer && !o.remote) _consider(o); }
      if(!tgt.alive) tgt=p;
      /* 索敌分级：Scav 视距短、反应慢、忘得快；PMC 更警觉；Boss 几乎即时锁定。
       * _detectT 累积「持续看见」的时间，视线中断会快速衰减；已警觉的 AI 重新发现目标时不再重复反应延迟。 */
      const grace = this.spawnGrace>0 && (tgt.isPlayer || tgt.remote);
      const seenNow = tgt.alive && d<sense.sight && !grace && this._los(b.x,b.y,tgt.x,tgt.y);
      b._detectT = seenNow ? (b._detectT||0)+dt : Math.max(0,(b._detectT||0)-dt*1.5);
      const canSee = seenNow && (b._detectT>=sense.react || !!b.lastSeen);
      if(canSee) b.lastSeen={ x:tgt.x, y:tgt.y, t:sense.memory };   // 记住最后位置，丢失视线也不马上忘

      /* 所有 AI 都会用医疗品 —— 血量低于阈值且暂时脱离火线时自行包扎 */
      if(b.medT>0){
        b.medT-=dt;
        if(b.medT<=0 && b.bandages>0){
          b.bandages--; b.hp=Math.min(b.maxHP, b.hp + Math.max(40, b.maxHP*0.42));
          if(b.smart) this._float(b.x, b.y-30, "包扎 +"+Math.round(Math.max(40,b.maxHP*0.42)), "#8fe07a");
        }
        b.state="heal";
        const a=M.angle(tgt.x,tgt.y,b.x,b.y);
        this._moveOp(b, Math.cos(a)*b.speed*0.5*dt, Math.sin(a)*b.speed*0.5*dt);
        continue;
      }
      {
        const lowHP = b.smart ? 0.58 : (b.cls==="pmc" ? 0.45 : 0.38);
        const safe = !canSee || d>560;
        if(b.hp < b.maxHP*lowHP && b.bandages>0 && safe && b._dodgeT<=0){
          b.medT = b.smart ? 1.3 : 2.0; b.state="heal"; continue;
        }
      }

      /* 有枪 + 看见玩家 → 交战 */
      if(canSee && b.gun){
        b.state="engage"; b.lootTarget=null; b.lootT=0;
        b.angle=M.lerpAngle(b.angle, M.angle(b.x,b.y,tgt.x,tgt.y), b.smart?0.26:0.19);
        let mx=0,my=0;
        // 压得更狠（170 才开始保持距离，60 以内才后退）
        if(d>170){ mx=Math.cos(b.angle); my=Math.sin(b.angle); }
        else if(d<60){ mx=-Math.cos(b.angle); my=-Math.sin(b.angle); }
        // 换弹时不再「端着空枪往前冲」——拉开距离等装填完
        if(b.reloadT>0 && d<620){ mx=-Math.cos(b.angle); my=-Math.sin(b.angle); b.state="reload"; }
        // 交战时左右游走，不再站桩对射（玩家更难被「固定靶」式预瞄）
        b._strafeT=(b._strafeT||0)-dt;
        if(b._strafeT<=0){ b._strafeT=RNG.fr(0.7,1.7); b._strafe=RNG.chance(0.5)?1:-1; }
        const inRange = d <= Math.min(560, (b.gun.range||700)*0.82);
        if(inRange){
          const sw=(b.smart?0.72:0.52)*b._strafe;
          mx+=-Math.sin(b.angle)*sw; my+=Math.cos(b.angle)*sw;
        }
        // 子弹擦身而过就侧向急闪（Raider 闪得更快更远），这就是「会躲子弹」
        if(b._dodgeT>0){
          b._dodgeT-=dt;
          const ds=(b._dodgeSide||1)*(b.smart?1.65:1.15);
          mx+=-Math.sin(b.angle)*ds; my+=Math.cos(b.angle)*ds;
        }
        const ml=Math.hypot(mx,my); if(ml>1){ mx/=ml; my/=ml; }
        const ex=b.x, ey=b.y;
        this._moveOp(b, mx*b.speed*dt, my*b.speed*dt);
        if((mx||my) && Math.hypot(b.x-ex,b.y-ey) < b.speed*dt*0.45){
          b._fleeT=(b._fleeT||0)+dt;
          if(b._fleeT>0.5){ b._fleeA=RNG.fr(0,6.2832); b._fleeT=0; }
          const a2=(b._fleeA!==undefined)?b._fleeA:b.angle+(b._fleeSide||(b._fleeSide=1))*1.3;
          this._moveOp(b, Math.cos(a2)*b.speed*dt, Math.sin(a2)*b.speed*dt);
        } else if(mx||my){ b._fleeT=0; b._fleeA=undefined; }
        if(b.fireCd<=0 && b.reloadT<=0){
          if(b.gun.ammoMag>0){
            // 枪法更准、开火间隔更短（jitter 0.026→0.018 / 0.072→0.050，CD 0.04→0.02 / 0.14→0.085）
            const jitter = b.smart ? 0.008 : (b.cls==="scav" ? 0.050 : 0.018);
            const cd = b.smart ? 0 : (b.cls==="scav" ? 0.085 : 0.02);
            this._fire(b, b.angle+M.normAngle(Math.random()-0.5)*jitter, game);
            // 修复：额外射击间隔必须放在 _fire 之后 —— _fire 开头会因 fireCd>0 直接 return，
            // 旧顺序导致所有非 Raider 一枪都打不出来（表现为「看见人却不开枪」）。
            if(cd>0) b.fireCd=Math.max(b.fireCd, cd);
          } else {
            // AI 会就地摸弹 —— 备弹打完自动补两个弹匣（否则永远开不了枪）
            if(b.gun.ammoRes<=0) b.gun.ammoRes=b.gun.mag*2;
            this._startReload(b);
          }
        }
        b._stuck=0;
        continue;
      }

      /* 空手 / 无枪：看见玩家就逃，边逃边找枪 */
      if(tgt.alive && d<340){
        b.state="flee";
        const a=M.angle(tgt.x,tgt.y,b.x,b.y);
        b.angle=M.lerpAngle(b.angle, a, 0.14);
        const fx=b.x, fy=b.y;
        this._moveOp(b, Math.cos(a)*b.speed*1.05*dt, Math.sin(a)*b.speed*1.05*dt);
        // 贴墙逃不掉时先沿墙侧移，再不行就换一个随机方向挣扎一会儿
        if(Math.hypot(b.x-fx,b.y-fy) < b.speed*dt*0.5){
          b._fleeT=(b._fleeT||0)+dt;
          if(b._fleeT>0.4){ b._fleeA=RNG.fr(0,6.2832); b._fleeT=0; }
          const a2=(b._fleeA!==undefined)?b._fleeA:a+(b._fleeSide||(b._fleeSide=1))*1.35;
          this._moveOp(b, Math.cos(a2)*b.speed*dt, Math.sin(a2)*b.speed*dt);
        } else { b._fleeT=0; b._fleeA=undefined; }
        continue;
      }

      /* 空手 / 没有枪：第一要务是搞到一把枪 —— 满图找武器箱，不再跟着玩家跑 */
      if(!b.gun && this._botLootUpdate(b, dt, true)) continue;

      /* 撤离点封锁者：无敌人时驻守目标撤离点，玩家靠近即交火（见上方 canSee 分支） */
      if(b.blockZone){
        const cx=b.blockZone.x+b.blockZone.w/2, cy=b.blockZone.y+b.blockZone.h/2;
        const dz=M.dist(b.x,b.y,cx,cy);
        if(dz>64){
          const a=M.angle(b.x,b.y,cx,cy);
          b.angle=M.lerpAngle(b.angle,a,0.12);
          this._moveOp(b, Math.cos(a)*b.speed*0.9*dt, Math.sin(a)*b.speed*0.9*dt);
          b.state="move"; continue;
        }
        b.state="guard";
        b.roamT-=dt;
        if(b.roamT<=0){ b.angle=RNG.fr(0,6.28); b.roamT=RNG.fr(1.5,3); }
        continue;
      }

      /* 小队抱团：非队长朝队友集结点靠拢，避免散开（交战 / 驻守优先级更高，已先行处理） */
      if(b.squadId && !b.isLeader){
        const mates=this.ops.filter(o=>o!==b && o.alive && o.squadId===b.squadId);
        if(mates.length){
          const ax=mates.reduce((s,o)=>s+o.x,0)/mates.length;
          const ay=mates.reduce((s,o)=>s+o.y,0)/mates.length;
          const ad=M.dist(b.x,b.y,ax,ay);
          if(ad>150){
            const a=M.angle(b.x,b.y,ax,ay);
            b.angle=M.lerpAngle(b.angle,a,0.10);
            this._moveOp(b, Math.cos(a)*b.speed*0.85*dt, Math.sin(a)*b.speed*0.85*dt);
            b.state="move"; continue;
          }
        }
      }

      /* 丢失视线后仍会朝最后位置追一段 */
      if(b.lastSeen && b.gun){
        b.lastSeen.t-=dt;
        if(b.lastSeen.t<=0) b.lastSeen=null;
        else {
          const dl=M.dist(b.x,b.y,b.lastSeen.x,b.lastSeen.y);
          if(dl>70){
            const a=M.angle(b.x,b.y,b.lastSeen.x,b.lastSeen.y);
            b.angle=M.lerpAngle(b.angle,a,0.14);
            const ox=b.x, oy=b.y;
            this._moveOp(b, Math.cos(a)*b.speed*dt, Math.sin(a)*b.speed*dt);
            // 目标在墙后就放弃，避免顶着掩体原地抽搐
            if(Math.hypot(b.x-ox,b.y-oy) < b.speed*dt*0.35){ b.lastSeen=null; }
            else { b.state="chase"; continue; }
          }
          b.lastSeen=null;
        }
      }

      /* 听到枪声：朝声源方向摸过去 */
      if(b.investigate){
        b.investigate.t-=dt;
        const iv=b.investigate;
        if(iv.t<=0){ b.investigate=null; }
        else {
          const di=M.dist(b.x,b.y,iv.x,iv.y);
          if(di>64){
            const a=M.angle(b.x,b.y,iv.x,iv.y);
            b.angle=M.lerpAngle(b.angle,a,0.13);
            const ox=b.x, oy=b.y;
            this._moveOp(b, Math.cos(a)*b.speed*dt, Math.sin(a)*b.speed*dt);
            if(Math.hypot(b.x-ox,b.y-oy) < b.speed*dt*0.35){ b.investigate=null; }
            else { b.state="hunt"; continue; }
          } else b.investigate=null;
        }
      }

      /* 独立搜刮：走向附近的未搜索容器，停留开箱 */
      if(this._botLootUpdate(b, dt)) continue;

      /* 巡逻 */
      b.state="roam";
      b.roamT-=dt;
      if(!b.roamPt || b.roamT<=0 || M.dist(b.x,b.y,b.roamPt.x,b.roamPt.y)<40){
        // PMC / Raider 有较大概率直接朝玩家所在区域游走，而不是在固定巡逻点之间晃
        // 只有手里有枪的 AI 才会主动压向玩家；空手的先去找装备
        // 主动搜寻概率按索敌等级：Scav 0.30 / PMC 0.70 / Boss 0.95
        const huntP = sense.hunt;
        const hunts = b.gun && tgt.alive && RNG.chance(huntP);
        const pt = hunts
          ? [tgt.x+RNG.fr(-560,560), tgt.y+RNG.fr(-560,560)]
          : RNG.pick((this.patrolPts&&this.patrolPts.length)?this.patrolPts:RAID_PATROL);
        b.roamPt={x:M.clamp(pt[0]+RNG.fr(-40,40),60,RAID_MAP_W-60),
                  y:M.clamp(pt[1]+RNG.fr(-40,40),60,RAID_MAP_H-60)};
        b.roamT=RNG.fr(3,7);   // 巡逻换点更勤
      }
      if(b.roamPt){
        const a=M.angle(b.x,b.y,b.roamPt.x,b.roamPt.y);
        b.angle=M.lerpAngle(b.angle, a, 0.08);
        const ox=b.x, oy=b.y;
        this._moveOp(b, Math.cos(a)*b.speed*0.8*dt, Math.sin(a)*b.speed*0.8*dt);
        if(Math.hypot(b.x-ox,b.y-oy) < b.speed*0.8*dt*0.25){
          b._stuck+=dt;
          if(b._stuck>0.5){ b.roamPt=null; b.roamT=0; b._stuck=0; }
        } else b._stuck=0;
      }
    }
  },

  /* AI 搜刮：返回 true 表示本帧正在前往 / 开箱（不再巡逻） */
  _botLootUpdate(b, dt, needGun){
    const gunless = needGun || !b.gun;
    // 空手的 AI 不算「搜刮额度」：它们会一直找枪，直到弄到一把为止
    if(!gunless && b.lootCount>=b.lootLimit) return false;
    if(b._badT>0){ b._badT-=dt; if(b._badT<=0) b._badC=null; }
    if(b._badPtT>0){ b._badPtT-=dt; if(b._badPtT<=0) b._badPt=null; }
    if(b.lootTarget && b.lootTarget.searched){ b.lootTarget=null; b.lootT=0; b._lootProg=null; }
    b.aiT-=dt;
    if(!b.lootTarget && b.aiT<=0){
      b.aiT = gunless ? 0.8 : (b.smart ? 1.6 : 3.2);
      b.lootTarget = this._nearestLootContainer(b, gunless);
      b.lootT = 0; b._lootProg=null; b._lootDetour=null;
    }
    const c=b.lootTarget;
    if(!c) return false;
    const dd=M.dist(b.x,b.y,c.x,c.y);
    if(dd>54){
      const a=M.angle(b.x,b.y,c.x,c.y);
      b.angle=M.lerpAngle(b.angle,a,0.14);
      // 卡住绕行：撞墙时先侧移一段，还是走不通才放弃这个箱子
      if(b._lootDetour && b._lootDetour.t>0){
        b._lootDetour.t-=dt;
        const a2=a+b._lootDetour.side*1.45;
        this._moveOp(b, Math.cos(a2)*b.speed*0.95*dt, Math.sin(a2)*b.speed*0.95*dt);
        b.state="loot";
        return true;
      }
      const ox=b.x, oy=b.y;
      this._moveOp(b, Math.cos(a)*b.speed*0.95*dt, Math.sin(a)*b.speed*0.95*dt);
      // 进度判定：1.2 秒内没靠近目标 24px，就先绕行 0.9 秒，再不行拉黑 8 秒
      if(!b._lootProg) b._lootProg={ d0:dd, t:0 };
      b._lootProg.t += dt;
      if(b._lootProg.t>=1.2){
        if(dd > b._lootProg.d0-24){
          if(!b._lootDetour){
            b._lootDetour={ side: RNG.chance(0.5)?1:-1, t:0.9 };
            b._lootProg=null;
          } else {
            b._badC=c; b._badT=8; b.lootTarget=null; b.lootT=0; b.aiT=0.4;
            b._lootProg=null; b._lootDetour=null;
            b._badPt={ x:b.x, y:b.y }; b._badPtT=14;   // 这一片都绕不进去，先别在这附近找
            b.state="loot";
            return false;
          }
        } else b._lootProg={ d0:dd, t:0 };
      }
      b.state="loot";
      return true;
    }
    b._lootProg=null; b._lootDetour=null;
    b.state="loot";
    b.lootT += dt*(b.smart?1.2:0.6);
    const need = c.locked?2.2:1.25;
    if(b.lootT>=need){
      c.searched=true;
      this._botLoot(b, c, b.smart?0.35:0.10);   // AI 按自身水平掷品质，Raider 搜到更好的货
      b.lootTarget=null; b.lootT=0; b.lootCount++;
    }
    return true;
  },

  _nearestLootContainer(b, needGun){
    const rawCap = needGun ? 2600 : (b.smart?820:470);
    const usable=(c)=>{
      if(c.searched || c.body || c.ground || c===b._badC) return false;
      if(this.search && this.search.c===c) return false;
      // AI 没有高级钥匙，只能撬 I~II 级保险箱，把高阶金库留给玩家
      if(c.locked && M.clamp(c.lockLv||1,1,5)>2) return false;
      if(b._badPtT>0 && b._badPt && M.dist2(c.x,c.y,b._badPt.x,b._badPt.y) < 350*350) return false;
      return true;
    };
    const score=(c)=>{
      let eff=M.dist2(b.x,b.y,c.x,c.y);
      if(needGun){
        // 找枪优先级：武器箱 ≫ 上锁军用箱 > 护甲箱 > 其他
        if(c.kind==="weapon") eff*=0.10;
        else if(c.locked) eff*=0.42;
        else if(c.kind==="armor") eff*=0.55;
      } else if(b.smart && (c.kind==="weapon"||c.kind==="armor")) eff*=0.55;
      return eff;
    };
    // 三档退让：① 半径内视线可达 ② 半径内任意 ③ 全图任意
    for(const pass of [0,1,2]){
      if(pass===2 && !needGun) break;
      const cap = pass===2 ? 1e9 : rawCap;
      let best=null, bestEff=Infinity;
      for(const c of this.containers){
        if(!usable(c)) continue;
        const raw=M.dist(b.x,b.y,c.x,c.y);
        if(raw>cap) continue;
        if(pass===0 && !this._los(b.x,b.y,c.x,c.y)) continue;
        const eff=score(c);
        if(eff<bestEff){ bestEff=eff; best=c; }
      }
      if(best) return best;
    }
    return null;
  },

  _botLoot(b, c, luck){
    luck=luck||0;
    let got=null;
    if(c.kind==="weapon"){
      // 空手的 AI 翻武器箱更容易翻到枪（否则永远在找枪的路上）
      const pGun = b.gun ? 0.25 : 0.72;
      // Scav 翻到的仍是低阶枪，不会因为摸到武器箱就掏出高品级步枪。
      if(RNG.chance(pGun)) got=this._rollGunLoot(b.cls==="scav"?"scav":"pmc", b.cls==="scav"?0:luck);
      else got=this._rollMaterial(luck);
    } else if(c.kind==="armor"){
      if(RNG.chance(0.22)) got=RNG.chance(0.6)?raidMakeArmor(raidRollArmorTier(luck)):raidMakeHelmet(raidRollArmorTier(luck*0.85));
      else if(RNG.chance(0.70)) got=this._rollMaterial(luck);
    } else if(c.kind==="medical"){
      b.bandages=(b.bandages||0)+1;
      b.creds+=RNG.ri(6,30);
      if(RNG.chance(0.38)) got=this._rollMaterial(luck);
    } else if(c.locked){
      const lv=M.clamp(c.lockLv||1,1,5);
      if(RNG.chance(0.80)) got=this._rollVaultLoot(lv);   // 保险箱：按等级掷装备
      b.creds+=RNG.ri(25,80)*lv;
    } else {
      // 杂项箱：原材料为主，配件其次，现金只是零头
      if(RNG.chance(0.62)) got=this._rollMaterial(luck);
      else if(RNG.chance(0.55)) got=this._rollPartGear();
      else b.creds+=RNG.ri(15,55);
    }
    if(got) this._botTakeItem(b, got);
    // 搜到钱
    if(!got && RNG.chance(0.35)) b.creds+=RNG.ri(8,30);
  },

  _botTakeItem(b, it){
    if(!it) return;
    // Scav 的装备上限：即使翻到高阶箱，也不会换掉手里的低阶枪 / 甲。
    if(b.cls==="scav"){
      if(it.kind==="weapon"){
        const ri=RARITIES.findIndex(r=>r.id===it.rarity);
        if(!SCAV_GUN_TYPES.includes(it.type) || (it.ilvl||0)>SCAV_GUN_ILVL_MAX || ri>2) return;
      }
      if(it.kind==="armor" && (it.tier||0)>SCAV_ARMOR_TIER_MAX) return;
      if(it.kind==="helmet" && (it.tier||0)>SCAV_HELMET_TIER_MAX) return;
      if(it.kind==="shield") return;
    }
    if(it.kind==="weapon"){
      if(!b.gun){
        b.gun=Object.assign({}, it); b.gun.ammoMag=b.gun.mag; b.gun.ammoRes=b.gun.reserve;
        return;
      }
      if((it.value||0) > (b.gun.value||0)*1.02 || (it.dmg||0) > (b.gun.dmg||0)*1.15){
        if((b.gun.value||0) > 0 && b.inv.weapons.length<2) b.inv.weapons.push(b.gun);
        b.gun=Object.assign({}, it); b.gun.ammoMag=b.gun.mag; b.gun.ammoRes=b.gun.reserve;
      } else if(b.inv.weapons.length<2) b.inv.weapons.push(it);
      return;
    }
    if(it.kind==="armor"){
      if(!b.armorTier || it.dr>b.dr+0.02){
        if(b.armorTier && b.inv.armors.length<2)
          b.inv.armors.push({uid:"aiar"+Math.floor(Math.random()*1e9).toString(36),kind:"armor",tier:b.armorTier,
            name:RAID_ARMORS[b.armorTier].name,rarity:0,dr:b.dr,maxArmor:b.maxArmor,value:RAID_ARMORS[b.armorTier].value});
        b.armorTier=it.tier; b.dr=it.dr; b.maxArmor=it.maxArmor; b.armor=it.maxArmor;
        b.armorBroken=false;   // v0.14.11：换上新甲后重新允许纳米自愈 / 恢复装甲型
      } else if(b.inv.armors.length<2) b.inv.armors.push(it);
      return;
    }
    if(it.kind==="helmet"){
      if(!b.helmetTier || it.dr>b.helmetDr+0.02){
        b.helmetTier=it.tier; b.helmetDr=it.dr; b.maxHelmetArmor=it.maxArmor; b.helmetArmor=it.maxArmor;
      } else if(b.inv.helmets.length<1) b.inv.helmets.push(it);
      return;
    }
    if(it.kind==="part" && b.inv.parts.length<4){ b.inv.parts.push(it); return; }
    if(it.kind==="med"){ b.bandages=(b.bandages||0)+1; return; }
  },

  /* 枪声扩散：范围内的 AI 记下声源位置，冲过去查看 */
  _noise(x, y, r, src){
    for(const b of this.ops){
      if(b===src || !b.alive || b.isPlayer || b.remote || b.ghost) continue;
      if(b.state==="engage" || b.state==="heal") continue;
      if(!b.gun) continue;            // 空手的 AI 忙着找枪，听到枪声也不去送
      if(this.online && !Net.isHost) continue;
      if(M.dist(b.x,b.y,x,y) > r*raidAISense(b).hear) continue;   // 枪声听距按索敌等级缩放
      // 已经有更近的线索就不覆盖
      if(b.investigate && b.investigate.t>2.5) continue;
      b.investigate={ x:x+RNG.fr(-80,80), y:y+RNG.fr(-80,80), t:RNG.fr(7,12) };   // 听到动静后追得更久
    }
  },

  _nearestFoe(o, range){
    let best=null, bd=range*range;
    for(const e of this.ops){
      if(e===o||!e.alive) continue;
      const dd=M.dist2(o.x,o.y,e.x,e.y);
      if(dd<bd && this._los(o.x,o.y,e.x,e.y)){ bd=dd; best=e; }
    }
    return best;
  },

  _nearestContainer(x,y,range){
    let best=null, bd=range*range;
    for(const c of this.containers){
      if(c.searched) continue;
      const dd=M.dist2(x,y,c.x,c.y);
      if(dd<bd){ bd=dd; best=c; }
    }
    // 地面物品堆同样可以按 E 拾取
    for(const c of (this.grounds||[])){
      if(c.searched) continue;
      const dd=M.dist2(x,y,c.x,c.y);
      if(dd<bd){ bd=dd; best=c; }
    }
    return best;
  },

  /* v0.14.11：子弹命中的小范围溅射（爆炸元素 / splash 词缀）。
   * 主目标已在 _fire 里吃过全额直伤，这里只打周围最多 3 个目标，不再触发元素效果。 */
  _bulletSplash(hit, dmg, sh, gun){
    const R=M.clamp(gun.splash||90,60,180);
    let n=0;
    for(const o of this.ops){
      if(n>=3) break;
      if(!o.alive || o===hit || o===sh || o.remote || o.ghost) continue;
      const dd=M.dist(hit.x,hit.y,o.x,o.y);
      if(dd>R) continue;
      const fall=M.clamp(1-dd/R*0.5,0.5,1);
      this._damage(o, dmg*0.35*fall, sh, {element:"none",armorPen:gun.armorPen}, {chain:true});
      n++;
    }
    if(n>0){
      for(let i=0;i<6;i++){ const a=Math.random()*6.28, s=Math.random()*90+20;
        this.particles.push({x:hit.x,y:hit.y,vx:Math.cos(a)*s,vy:Math.sin(a)*s,
          life:0.35,maxLife:0.35,color:i%2?"#ffd23f":"#ff7a1f",size:2.6}); }
      this.blasts.push({x:hit.x,y:hit.y,r:R*0.35,life:0.22,maxLife:0.22});
    }
  },

  /* ----------------------------- 射击 / 伤害 ----------------------------- */
  _fire(sh, angle, game){
    if(sh.fireCd>0 || sh.reloadT>0) return;
    if(!sh.gun) return;
    if(sh.gun.ammoMag<=0){ this._startReload(sh); return; }
    sh.gun.ammoMag--;
    sh.fireCd = 60/Math.max(40, sh.gun.rpm);
    // v0.14.11：电磁干扰期间射速被强制压到最低 SHOCK_FIRE_CD 间隔（电击的持续效果）
    if(sh.shockT>0) sh.fireCd=Math.max(sh.fireCd, SHOCK_FIRE_CD);
    // 枪声传得远：附近待机的 AI 会摸过来（全局节流，避免每发子弹都算一遍）
    this._nzT=(this._nzT||0)+1;
    if(this._nzT%3===0 && !sh.ghost && (sh.isPlayer || !sh.remote))
      this._noise(sh.x, sh.y, sh.isPlayer?1200:820, sh);   // 枪声传得更远，更多 AI 会摸过来
    if(sh.isPlayer){ this.spawnGrace=0; SFX.shoot(); }   // 先开枪就先暴露
    // 联机：房主把 AI 开火广播给客户端（只画弹道，不重复结算伤害）
    if(this.online && typeof Net!=="undefined" && Net.isHost && !sh.isPlayer && !sh.ghost && !sh.remote)
      Net.maybeSendShot(sh, angle);

    // 火箭筒：发射慢速火箭弹（命中/撞墙后范围爆炸），不走射线
    if(sh.gun.cat==="launcher"){
      this.rockets.push({ x:sh.x, y:sh.y, ang:angle, speed:240, dmg:sh.gun.dmg,
        splash:Math.max(96, sh.gun.splash||120), owner:sh, gun:sh.gun, life:3.4,
        color:sh.gun.color||"#ffb020", trail:[] });
      return;
    }

    const pellets = sh.gun.pellets || 1;
    /* 非霰弹枪的「双发的 / 蜂群的」是稀有词条，不是「8 颗霰弹」：
     * 总伤害只提升 30%，平均分摊到每颗弹丸（2 发 0.65×、3 发 0.433×），
     * 换来的收益是更多命中判定 / 特殊弹触发机会，而不是直接 1.8 倍 DPS。 */
    const pelletMul = pellets<=1 ? 1
      : ((sh.gun.type==="shotgun"||sh.gun.cat==="shotgun") ? 0.9 : (1.30/pellets));
    const mv = sh._mv||0;
    const moveMul = moveSpreadMul(sh.gun.cat, mv);
    const baseSpread = sh.gun.spread * (sh.isPlayer?1.0:2.0) * 2.3;   // AI 命中率上调（6.24x → 4.6x）
    for(let k=0;k<pellets;k++){
      let spread = baseSpread * moveMul;
      if(mv>0.05 && !isSMG(sh.gun.cat)) spread = Math.min(spread, Math.max(baseSpread*1.35, moveSpreadCap(sh.gun.cat)));
      const a = angle + (Math.random()-0.5)*spread*2;
      const range = sh.gun.range;
      const ex = sh.x+Math.cos(a)*range, ey = sh.y+Math.sin(a)*range;
      const wh = this._rayWall(sh.x, sh.y, ex, ey);
      let cut = wh ? wh.t : 1;
      const bx = sh.x + (ex-sh.x)*cut, by = sh.y + (ey-sh.y)*cut;

      let hit=null, hitDist=Infinity;
      for(const o of this.ops){
        if(o===sh || !o.alive) continue;
        const dd=this._pointSeg(o.x,o.y, sh.x,sh.y, bx,by);
        if(dd < o.r+2){ const d2=M.dist(sh.x,sh.y,o.x,o.y); if(d2<hitDist){ hitDist=d2; hit=o; } }
        else if(dd < 200 && !o.isPlayer && !o.remote && !o.ghost){
          // 子弹从身边飞过 → 侧向急闪（朝自己所在的一侧躲开弹道）
          const cross=(o.x-sh.x)*Math.sin(a)-(o.y-sh.y)*Math.cos(a);
          o._dodgeT=Math.max(o._dodgeT||0, o.smart?0.55:0.38);
          o._dodgeSide=cross>=0?1:-1;
        }
      }
      let hx=bx, hy=by;
      if(hit){
        hx=hit.x; hy=hit.y;
        const falloff = M.clamp(1 - hitDist/range*0.45, 0.55, 1);
        const dmg = sh.gun.dmg * falloff * pelletMul;
        if(this.online && hit.ghost && typeof Net!=="undefined" && !Net.isHost){
          // 影子 AI：本地只放命中特效，血量由房主权威结算
          Net.sendHitAI(hit.id, dmg, sh.gun && sh.gun.name);
          this._float(hit.x, hit.y-24, "-"+Math.round(dmg), "#ffd36a");
          this.spawnHit(hit.x, hit.y, "#ff9a5a");
        } else if(hit.remote){
          // 玩家间 PvP 开启 —— 打中远程玩家照常结算，伤害经 Net.sendDamage 转发给对方本地扣血
          this.spawnHit(hit.x, hit.y, "#7fd0ff");
          this._float(hit.x, hit.y-24, "-"+Math.round(dmg), "#ff8a5a");
          this._damage(hit, dmg, sh, sh.gun);
        } else {
          this._damage(hit, dmg, sh, sh.gun);
          /* v0.14.11：爆炸元素 / splash 词缀的普通子弹也要有范围溅射。
           * 之前只有火箭筒走 _explodeRocket，普通爆炸枪只是 ×1.20 平伤，
           * 元素描述「范围溅射」和 splash 系词缀在突袭里全是死的。 */
          if(sh.gun.cat!=="launcher" && (sh.gun.element==="explosive" || (sh.gun.splash||0)>0))
            this._bulletSplash(hit, dmg, sh, sh.gun);
        }
      }
      this.tracers.push({ x1:sh.x, y1:sh.y, x2:hx, y2:hy, bx:sh.x, by:sh.y, life:0.08, maxLife:0.08,
        laser: !!sh.gun.laser, shape: sh.gun.projShape||"round",
        color: sh.gun.color || (sh.isPlayer?"#ffe08a":"#ff7a5a") });
    }
  },

  /* opts.chain = 由辐射连锁触发的二次伤害，不再继续连锁，避免无限递归 */
  _damage(target, dmg, attacker, gun, opts){
    opts=opts||{};
    if(!target.alive) return;
    /* v0.16.0：破盾无敌期间完全免伤（飘字节流，连发不刷屏） */
    if((target.shieldInvuln||0)>0){
      if(this.elapsed-(target._ivTipT||-99)>0.35){
        target._ivTipT=this.elapsed;
        this._float(target.x,target.y-52,"无敌","#7be3ff");
      }
      return;
    }
    /* AI 互殴伤害折减：全图 AI 会自己打起来，但一轮交火不该两分钟清场。
     * （玩家打 AI 不受影响，AI 打玩家也不受影响） */
    if(attacker && !attacker.isPlayer && !attacker.remote
       && !target.isPlayer && !target.remote && target.id!=="you") dmg *= 0.45;   // v0.14.6：AI 互殴折减加深，避免 AI 自己清场
    // 远端玩家：伤害由对方本地结算（只有他知道自己的护甲/血量），这里只转发。
    // v0.14.10：元素克制 / 冰冻只在「本地结算侧」生效，避免联机两端重复计算。
    if(target.remote && this.online && typeof Net!=="undefined"){
      Net.sendDamage(target.peerId||String(target.id||"").replace(/^net_/,""), dmg, attacker&&attacker.name);
      return;
    }
    let d=dmg;
    const _armorAtHit=target.armor||0;   // v0.14.11：用于判定「护甲是否在本次命中被打穿」

    /* ---------------- v0.14.10 元素克制 ---------------- */
    const elem=(gun && gun.element && ELEMENTS[gun.element]) ? gun.element : "none";
    const at=raidArmorType(target);
    const eMul=elemMult(elem, at);
    /* v0.20.0：子弹级别带来的整体威力（T1 1.00 → T5 1.30），叠在终点效应倍率之外 */
    const pow=(gun && gun.power) ? gun.power : 1;
    d*=eMul*pow;
    const E=elem!=="none"?ELEMENTS[elem]:null;
    const dmgCol=E?E.color:(target.isPlayer?"#ff6a6a":"#ffd36a");

    /* ---------------- v0.14.11 元素持续效果 ----------------
     * 之前 ELEMENTS.dot 只是摆设（火焰/腐蚀 6、辐射 5），元素之间除了倍率没有任何玩法差异：
     *   火焰   → 叠加灼烧 DOT（每秒按本次命中原始伤害结算，最长 4.5s，约 +27% 总伤）
     *   腐蚀   → 立刻啃护甲耐久 + 3s 破甲（期间护甲减伤 ×0.75），打穿后回归血肉型
     *   电击   → 1.6s 电磁干扰（强制拉长开火间隔 / 打断瞄准），另额外削护盾
     *   辐射   → 命中后向附近单位连锁，连锁伤害不再二次触发连锁
     * 状态只在权威结算侧写入；远端玩家 / 影子 AI 走上面的转发分支，不会重复结算。 */
    if(d>0 && E){
      /* dotK 随子弹级别递减：高级弹靠穿深，不靠烧灼 */
      const dotK=((E.dot||0)/6)*((gun && gun.dotK!==undefined) ? gun.dotK : 1);
      if(elem==="fire" && dotK>0){
        const fresh=(target.burnT||0)<=0;
        target.burnT=Math.min(BURN_CAP,(target.burnT||0)+BURN_ADD*dotK);
        // 用克制后伤害 d 结算 DOT，避免「火焰对装甲 ×0.70、但灼烧照全额跳」绕过抗性
        target.burnDps=Math.max(target.burnDps||0, d*BURN_DPS_RATE*dotK);
        target.burnSrc=attacker||null;
        if(fresh) this._float(target.x,target.y-58,"引燃 "+target.burnT.toFixed(1)+"s","#ff8a3a");
      } else if(elem==="corrosive" && dotK>0){
        const before=target.armor||0;
        const bite=Math.min(before, d*CORRODE_BITE*dotK);
        if(bite>0) target.armor=before-bite;
        target.corrodeT=Math.max(target.corrodeT||0, CORRODE_TIME);
        if(bite>0 && (this.elapsed-(target._armorTipT||-99))>0.8){
          target._armorTipT=this.elapsed;
          this._float(target.x,target.y-58,"撕裂破甲 -"+Math.round(bite),"#9bff5a");
        }
      } else if(elem==="radiation"){
        target.radT=Math.max(target.radT||0,0.7);
      } else if(elem==="shock"){
        const fresh=(target.shockT||0)<=0;
        target.shockT=Math.max(target.shockT||0,SHOCK_TIME);
        if(target.shield>0) target.shield=Math.max(0,target.shield-d*0.6);   // 电击额外击穿护盾
        if(fresh && !target.isPlayer) this._float(target.x,target.y-58,"电磁干扰","#7be3ff");
      }
    }
    // 玩家命中时按目标节流给一句克制 / 抗性反馈，连发不刷屏
    if(attacker && attacker.isPlayer && elem!=="none" && Math.abs(eMul-1)>0.05
       && this.elapsed-(target._elemTipT||0)>0.55){
      target._elemTipT=this.elapsed;
      const tip=(eMul>1?"克制 ×":"抗性 ×")+eMul.toFixed(2);
      this._float(target.x, target.y-40, (E?E.name:"")+" "+tip, eMul>1?(E?E.color:"#ffd23f"):"#9aa4b2");
    }
    // 冰冻命中：叠加冻结时间并撒冰晶（视觉在 unit() 里绘制）
    if(elem==="cryo" && d>0){
      target.freezeT=Math.min(2.8, (target.freezeT||0)+1.4);
      this._freezeBurst(target.x, target.y);
    }

    /* ---------------- v0.14.10 护甲 / 头盔：乘法律叠加 ---------------- */
    // 护甲穿透：高穿甲武器能显著削弱高级护甲的减伤（T8 也不是无敌）
    const pen = (gun && gun.armorPen!==undefined) ? gun.armorPen : 0.10;
    const penMul = 1 - pen*0.90;
    // 头部命中（15%）：伤害 ×1.8，头盔对爆头全额生效
    const headshot=RNG.chance(0.15);
    if(headshot) d*=1.8;
    // 能量护盾优先于护甲吸收（护盾型 → 蓝色血条，被电击克制）。护盾破了才轮到护甲 / 头盔。
    const hadShield=(target.shield||0)>0;
    if(hadShield){
      const mul=target.shieldAbsorbMul||1;
      const sAbs=Math.min(target.shield*mul,d);
      target.shield=Math.max(0,target.shield-sAbs/mul); d-=sAbs;
      if(sAbs>0 && target.isPlayer) this._float(target.x,target.y-52,"护盾 -"+Math.round(sAbs),"#7be3ff");
      if(target.shield<=0){
        const iv=target.shieldInvulnBase||0;
        target.shieldInvuln=Math.max(target.shieldInvuln||0,iv);
        this._float(target.x,target.y-70,iv>0?`护盾破裂 · 无敌 ${iv.toFixed(2)}s`:"护盾破裂","#4fd6ff");
        if(target.isPlayer && iv>0) this._feed("防护",`护盾破裂 · ${iv.toFixed(2)}s 无敌`,"",false,"info");
        if((target.shieldPerks||[]).includes("surge")) this._shieldSurge(target);
      }
    }
    // 任何一次受击都把「多久没挨打」重新计时 —— 这就是充能延迟的定义
    if(target.maxShield>0) target.shieldTimer=target.shieldDelay||0;
    // p = 护甲减伤，q = 头盔减伤；总减伤 = 1-(1-p)(1-q)，不再线性相加成 1-p-q。
    // 头盔对非爆头按 HELMET_BODY_SHARE 计入，因此也能「减少一定的非暴击伤害」。
    // v0.14.11：腐蚀破甲期间护甲减伤打七五折，让「溶解装甲」有实感。
    const corrodeMul=(target.corrodeT||0)>0?CORRODE_DR:1;
    const p=M.clamp((target.dr||0)*penMul*corrodeMul, 0, 0.92);
    const q=M.clamp((target.helmetDr||0)*penMul*(headshot?1:HELMET_BODY_SHARE), 0, 0.92);
    const totalDr=1-(1-p)*(1-q);
    const absorbWant=d*totalDr;                          // 两件装备合计应吸收的伤害
    const armorWant=Math.max(0, d*p);                   // 护甲先吸收
    const helmWant=Math.max(0, absorbWant-armorWant);   // 头盔吸收护甲没挡下的那部分里的份额
    let armorAbs=0, helmAbs=0;
    if(armorWant>0 && target.armor>0){
      armorAbs=Math.min(target.armor, armorWant);
      const plateMul=(hadShield && (target.shieldPerks||[]).includes("plate"))?0.65:1;
      target.armor-=armorAbs*plateMul;
    }
    if(helmWant>0 && target.helmetArmor>0){
      helmAbs=Math.min(target.helmetArmor, helmWant);
      target.helmetArmor-=helmAbs;
    }
    d-=armorAbs+helmAbs;
    if(headshot && helmAbs>0 && target.isPlayer)
      this._float(target.x, target.y-52, "头盔 -"+Math.round(helmAbs), "#8fd0ff");
    /* v0.14.11 改2：T4+ 护甲耐久归零 → 不再是装甲型（黄条转红、腐蚀克制失效）。
     * 一次性提示，避免连发刷屏；HUD 的防护类型行会同步变成「无防护」。 */
    if(_armorAtHit>0 && (target.armor||0)<=0 && (target.armorTier||0)>=RAID_ARMOR_TYPE_TIER){
      target.armorBroken=true;   // 报废后不再纳米自愈，类型稳定停留在血肉
      this._float(target.x,target.y-72,"护甲击穿 · 转为无防护","#ffd23f");
      if(target.isPlayer) this._feed("防护", "护甲耐久耗尽 · 已转为无防护", "", false, "warn");
    }
    const absorbedAll=hadShield && d<=0;
    d=absorbedAll?0:Math.max(1,Math.round(d));
    if(d<=0){
      // 伤害被护盾完全吸收：不扣血、不触发流血，但跳弹连锁仍按原命中结算
      if(elem==="radiation" && !opts.chain && dmg>0) this._chainRadiation(target,dmg,attacker,gun);
      return;
    }
    target.hp-=d;

    if(target.isPlayer){
      this.hitFlash=Math.min(0.35, this.hitFlash+0.18);
      SFX.hurt();
      this._float(target.x, target.y-24, "-"+Math.round(d), "#ff6a6a");
      // 塔科夫式流血：被击中有几率开始流血（最多叠 3 层）
      if(dmg>0 && RNG.chance(0.30) && target.bleed<3){
        target.bleed++;
        this._float(target.x, target.y-40, "⚠ 流血 x"+target.bleed+"（H/医疗键 包扎）", "#ff8a5a");
      }
      if(target.hp<=0){
        target.hp=0; target.alive=false;
        this._fail("阵亡", attacker, gun);
      }
    } else {
      /* 被击中立刻锁定攻击者（转身 + 摸过去还击）。
       * 玩家 / 远端玩家打它、或 AI 互殴都生效；友善关系由索敌逻辑决定，这里只负责「注意到」攻击者 */
      if(attacker && attacker!==target && !attacker.ghost){
        target.lastSeen={ x:attacker.x, y:attacker.y, t:raidAISense(target).memory };
        target.investigate={ x:attacker.x, y:attacker.y, t:Math.max((target.investigate&&target.investigate.t)||0, 6.5) };
      }
      this._float(target.x, target.y-24, "-"+Math.round(d), dmgCol);
      this.spawnHit(target.x, target.y, dmgCol);
      if(target.hp<=0){
        target.hp=0; target.alive=false;
        this._onBotDeath(target, attacker);
      }
    }
    // 辐射连锁：命中后向周围 RAD_MAX 个单位传导 RAD_FACTOR 倍伤害，二次命中不再连锁。
    if(elem==="radiation" && !opts.chain && dmg>0) this._chainRadiation(target,dmg,attacker,gun);
  },

  /* v0.14.11：辐射连锁 —— 不打自己 / 攻击者 / 远端玩家（远端由对方本地结算），
   * 只挑最近的活单位，附一道绿色链路特效，伤害不再带元素倍率二次放大。 */
  _chainRadiation(origin, dmg, attacker, gun){
    const near=[];
    for(const o of this.ops){
      if(!o.alive || o===origin || o===attacker || o.remote || o.ghost) continue;
      const dd=M.dist(origin.x,origin.y,o.x,o.y);
      if(dd<=RAD_RADIUS) near.push({o,dd});
    }
    near.sort((a,b)=>a.dd-b.dd);
    for(const {o} of near.slice(0,RAD_MAX)){
      this.tracers.push({ x1:origin.x, y1:origin.y, x2:o.x, y2:o.y, bx:origin.x, by:origin.y,
        life:0.18, maxLife:0.18, laser:false, shape:"round", color:"#c8ff32" });
      this.spawnHit(o.x,o.y,"#c8ff32");
      this._damage(o, dmg*RAD_FACTOR, attacker, {element:"none", armorPen:gun&&gun.armorPen, dmg:0}, {chain:true});
    }
    if(near.length && attacker && attacker.isPlayer)
      this._float(origin.x,origin.y-58,"辐射连锁 ×"+Math.min(near.length,RAD_MAX),"#c8ff32");
  },

  /* v0.14.11：每帧结算元素持续状态。灼烧按真实秒数扣血（无视护甲），击杀归属点火者；
   * 影子 AI / 远端玩家不在这里扣血，避免联机双份伤害。返回 true 表示玩家阵亡、调用方应退出本帧。 */
  /* v0.14.11：护甲打穿后标记报废，纳米自愈不再把它救回来，
   * 否则 T4+ 血条会在「装甲黄 → 血肉红」之间每帧反复横跳。 */
  _tickArmorRegen(o, dt){
    if(o.alive && o.armorRegen>0 && !o.armorBroken && o.armor<o.maxArmor)
      o.armor=Math.min(o.maxArmor, o.armor+o.armorRegen*dt);
  },

  /* v0.16.0：护盾回充 —— 每次受击把 shieldTimer 重置为「充能延迟」，
   * 计时归零后才按「充能速度」回充，破盾后也能从 0 重新起盾。
   * 「静止增益」在不动时把速度翻倍；远端玩家 / 影子 AI 只读快照，不自行结算。 */
  _tickShield(o, dt){
    if(!o.alive || !(o.maxShield>0)) return;
    if(o.shieldInvuln>0) o.shieldInvuln=Math.max(0,o.shieldInvuln-dt);
    const _wait=o.shieldTimer||0;
    if(_wait>0){
      o.shieldTimer=Math.max(0,_wait-dt);
      if(o.shieldTimer>0) return;
      // 延迟在本帧内走完：把剩余 dt 交给回充，避免掉帧 / 切后台时白等一整帧
      dt=Math.max(0,dt-_wait);
      if(dt<=0) return;
    }
    if(o.remote || o.ghost || o.isGhost || !o.shieldRate) return;
    if((o.shield||0)>=o.maxShield) return;
    const still=(o.moveX||0)===0 && (o.moveY||0)===0;
    const k=(still && (o.shieldPerks||[]).includes("still")) ? 2 : 1;
    o.shield=Math.min(o.maxShield,(o.shield||0)+o.shieldRate*k*dt);
  },

  /* 破盾冲击：迟滞周围目标（独特加成 surge） */
  _shieldSurge(origin){
    let n=0;
    for(const o of this.ops){
      if(!o.alive || o===origin || o.remote || o.ghost) continue;
      if(M.dist(origin.x,origin.y,o.x,o.y)<=140){
        o.freezeT=Math.max(o.freezeT||0,1.0);
        this.spawnHit(o.x,o.y,"#4fd6ff"); n++;
      }
    }
    if(n) this._float(origin.x,origin.y-58,"破盾冲击 ×"+n,"#c07bff");
  },

  _tickElementStatus(o, dt){
    const burnLeft=o.burnT||0;               // 先记住剩余时长，收尾那一帧只结算实际剩余部分
    if(o.burnT>0)   o.burnT=Math.max(0,o.burnT-dt);
    if(o.corrodeT>0)o.corrodeT=Math.max(0,o.corrodeT-dt);
    if(o.shockT>0)  o.shockT=Math.max(0,o.shockT-dt);
    if(o.radT>0)    o.radT=Math.max(0,o.radT-dt);
    if(burnLeft>0 && o.burnDps>0 && !o.remote && !o.ghost){
      o.hp-=o.burnDps*Math.min(dt,burnLeft);
      if(o.maxShield>0) o.shieldTimer=o.shieldDelay||0;   // 持续掉血同样算「正在受伤害」
      if(o.isPlayer) this.hitFlash=Math.min(0.18,(this.hitFlash||0)+dt*0.15);
      if(o.hp<=0){
        o.hp=0; o.alive=false; o.burnT=0; o.burnDps=0;
        if(o.isPlayer){ this._fail("引燃致死", o.burnSrc, null); return true; }
        this._onBotDeath(o, o.burnSrc);
      }
    }
    if(o.burnT<=0){ o.burnDps=0; o.burnSrc=null; }
    return false;
  },

  _onBotDeath(victim, killer){
    if(killer && killer.isPlayer){
      killer.kills++;
      if((killer.shieldPerks||[]).includes("siphon") && killer.maxShield>0){
        killer.shield=Math.min(killer.maxShield,(killer.shield||0)+killer.maxShield*0.18);
        this._float(killer.x,killer.y-58,"击杀回充","#8fe07a");
      }
      /* GP 币改为「本局首杀必得」——
       * 原来撤离时无条件发 1 枚，等于打不打架都有进账；现在只有开张见血才给，
       * 且整局只算一次，鼓励玩家真的去交火而不是绕开所有人。 */
      if(!killer.netKiller && !this._firstKillToken){
        this._firstKillToken=true;
        this.tokens=(this.tokens||0)+1;
        this._float(victim.x, victim.y-72, "◆ 首杀 · GP 币 +1", "#c07bff");
        this._feed("黑市", "首杀确认 · GP 币 +1（撤离才落袋）", "奖励", false, "info");
      }
      this._feed(killer.netKiller?(killer.name||"队友"):"你", victim.name, killer.gun?killer.gun.name:"徒手", !killer.netKiller, "kill");
      const drops=this._dropFromBot(victim);
      // 联机：队友击杀的 AI，把尸体同步给所有人（否则队友看不到战利品）
      if(killer.netKiller && this.online && typeof Net!=="undefined" && Net.isHost && drops && drops.length){
        try{ Net.sendCorpse(victim.x, victim.y, victim.name, drops.slice(0,6)); }catch(e){}
      }
      if(!killer.netKiller) SFX.hit();
    } else if(killer){
      this._feed(killer.name, victim.name, killer.gun?killer.gun.name:"徒手", false, "kill");
      this._dropFromBot(victim, true);
    } else {
      this._feed("未知", victim.name, "交火", false, "kill");
    }
  },

  _dropFromBot(bot, silent){
    // v1.0：AI 身上带的是它自己搜刮来的东西——枪 / 甲 / 头盔 / 背包里的备用枪与配件
    const drops=[];
    const mkUid=p=>p+Math.floor(Math.random()*1e9).toString(36);
    if(bot.gun){
      const g=Object.assign({}, bot.gun);
      g.kind="weapon"; g.uid=mkUid("bg");
      drops.push(g);
    }
    if(bot.armorTier) drops.push(raidMakeArmor(bot.armorTier, 0));
    if(bot.helmetTier) drops.push(raidMakeHelmet(bot.helmetTier, 0));
    if(bot.maxShield>0 && RNG.chance(bot.smart?0.5:0.2))
      drops.push(raidMakeShield(M.clamp(bot.armorTier||1,1,9), M.clamp((bot.armorTier||1)-1,0,8)));
    for(const w of (bot.inv.weapons||[]).slice(0,1)){
      const g=Object.assign({},w); g.kind="weapon"; g.uid=mkUid("bw"); drops.push(g);
    }
    for(const a of (bot.inv.armors||[]).slice(0,1)) drops.push(a);
    for(const pt of (bot.inv.parts||[]).slice(0,1)) drops.push(pt);
    for(const c of (bot.inv.parts||[]).filter(p=>p.core).slice(0,1)) drops.push(c);
    /* 弹药：按它自己那把枪的口径掉一批（级别跟枪的品级走，Scav 只会民用/制式） */
    {
      const gcal=bot.gun?(bot.gun.cal||ammoCalOfType(bot.gun.type)):null;
      if(gcal && RNG.chance(0.78)){
        const lv=bot.bounty?RNG.ri(4,5)
          : bot.smart?RNG.ri(2,4)
          : RNG.ri(1,2);
        drops.push(ammoDef(gcal, lv));
      }
    }
    // PMC 身上（尤其 Raider）可能揣着保险箱钥匙
    if(RNG.chance(bot.smart?0.20:0.07)){
      const KLV=[{weight:52,lv:1},{weight:26,lv:2},{weight:14,lv:3},{weight:6,lv:4},{weight:2,lv:5}];
      drops.push(raidMakeKey(KLV[RNG.weighted(KLV)].lv));
    }
    // Boss：保底 3 件「稀有及以上」战利品（材料 / 配件 / 装备）
    if(bot.bounty) for(const it of raidBountyLoot()) drops.push(it);
    const cash=Math.max(0, Math.round((bot.creds||0)*0.3));
    if(drops.length || cash>0){
      this.containers.push({ x:bot.x, y:bot.y, tier:2, searched:false,
        drops, cash, body:true, botName:bot.name });
    }
    return drops;
  },

  /* ----------------------------- 搜索补给 ----------------------------- */
  // 搜索耗时：保险箱按等级加长（V 级要撬 3.3 秒），普通箱 1.1 秒，地面物品堆几乎瞬拾
  _searchNeed(c){ return c && c.ground ? 0.3 : ((c && c.locked) ? (1.6 + M.clamp(c.lockLv||1,1,5)*0.35) : 1.1); },
  _searchUpdate(dt){
    if(!this.search) return;
    const { c }=this.search;
    if(c.searched){ this.search=null; return; }
    if(M.dist(this.player.x,this.player.y,c.x,c.y)>86){ this.search=null; return; }
    this.search.t+=dt;
    const need = this._searchNeed(c);
    if(this.search.t>=need){
      /* 地面物品堆 —— 逐件尝试装包；装不下的留在原地，这里绝不新生成堆（否则会无限增殖） */
      if(c.ground){
        const rest=[];
        for(const d of (c.drops||[])){ if(!this._collect(d, c.x, c.y, true)) rest.push(d); }
        c.drops=rest;
        if(rest.length){
          c.searched=false;
          this._float(c.x, c.y-38, `背包已满 · 还有 ${rest.length} 件留在地上`, "#ff8a5a");
          SFX.ui();
        } else {
          c.searched=true;
          SFX.pickup();
        }
        this.search=null;
        return;
      }
      c.searched=true;
      // 开锁：消耗一次钥匙耐久
      if(c.locked){
        const k=this._useKey(c.lockLv||1);
        if(k) this._float(c.x, c.y-30, k.name+" 开锁", k.color||"#8fe07a");
      }
      if(this.online && typeof Net!=="undefined"){
        Net.sendLoot(this.containers.indexOf(c), c.kind||"");
      }
      if(c.drops && c.drops.length){
        for(const d of c.drops) this._collect(d, c.x, c.y);
        if(c.cash){
          this.creds+=c.cash;
          this._float(c.x, c.y-46, "+₽"+c.cash+"（搜尸）", "#8fe07a");
        }
      } else if(c.drop){
        this._collect(c.drop, c.x, c.y);
        if(c.cash){ this.creds+=c.cash; this._float(c.x, c.y-46, "+₽"+c.cash, "#8fe07a"); }
      } else if(c.locked){
        // 上锁保险箱：按 lockLv 决定件数与品质（等级越高装备越好），并稳定出卢布
        const lv=M.clamp(c.lockLv||1,1,5);
        const n=1+(lv>=3?1:0)+(lv>=5?2:0);   // V 级军火箱 4 件
        for(let i=0;i<n;i++) this._collect(this._rollVaultLoot(lv), c.x, c.y);
        const gain=RNG.ri(45,120)*lv;
        this.creds+=gain;
        this._float(c.x, c.y-46, "+"+gain+" 卢布", "#8fe07a");
        // 箱内可能藏着钥匙 —— 等级上限 = 本箱等级 +1（V 级封顶），越高越罕见
        if(RNG.chance(0.34)) this._collect(raidRollBoxKey(lv), c.x, c.y);
        if(RNG.chance(0.55)) this._collect(this._rollAmmo(0.35+lv*0.16), c.x, c.y);
      } else if(c.kind==="weapon"){
        // 武器箱也以原材料为主，整枪极少
        const wr=RNG.f();
        if(wr<0.05) this._collect(this._rollGunLoot("pmc", this.lootLuck), c.x, c.y);
        else if(wr<0.23) this._collect(this._rollPartGear("pmc", this.lootLuck), c.x, c.y);
        else if(wr<0.52) this._collect(this._rollAmmo(this.lootLuck), c.x, c.y);   // 武器箱是找子弹的首选
        else this._collect(this._rollMaterial(this.lootLuck), c.x, c.y);
      } else if(c.kind==="medical"){
        if(RNG.chance(0.72)){
          const n=RNG.ri(1,2);
          for(let i=0;i<n;i++) this._collect(raidRollMed(this.lootLuck), c.x, c.y);
          SFX.pickup();
        }
        else if(RNG.chance(0.45)) this._collect(this._rollMaterial(this.lootLuck), c.x, c.y);
        else { const g=RNG.ri(25,65); this.creds+=g; this._float(c.x,c.y-30,"+"+g+" 卢布","#8fe07a"); }
      } else if(c.kind==="armor"){
        const roll=RNG.f();
        if(roll<0.06) this._collect(raidMakeArmor(raidRollArmorTier(this.lootLuck)), c.x, c.y);
        else if(roll<0.10) this._collect(raidMakeHelmet(raidRollArmorTier(this.lootLuck*0.85)), c.x, c.y);
        else if(roll<0.13) this._collect(raidMakeShield(raidRollArmorTier(this.lootLuck), this._rollRarity(this.lootLuck)), c.x, c.y);
        else if(roll<0.88) this._collect(this._rollMaterial(this.lootLuck), c.x, c.y);
        else this._collect(this._rollPartGear("pmc", this.lootLuck), c.x, c.y);
      } else if(RNG.chance(0.16)){
        this._collect(raidRollMed(this.lootLuck), c.x, c.y);
        SFX.pickup();
      } else if(RNG.chance(0.35)){
        this._collect(this._rollAmmo(this.lootLuck), c.x, c.y);
        SFX.pickup();
      } else if(RNG.chance(0.30)){
        // 普通箱现金：金额与概率双双下调
        const gain=RNG.ri(18,45)*(c.tier+1);
        this.creds+=gain;
        this._float(c.x,c.y-30,"+"+gain+" 卢布","#8fe07a");
        SFX.pickup();
      } else {
        const it=this._rollGear("pmc", this.lootLuck);
        this._collect(it, c.x, c.y);
      }
      // GP 币极稀有掉落（上锁军用箱 9%，普通箱 2%）
      // 保险箱等级越高，GP 币概率越高（V 级箱 26%）
      if(!c.locked && RNG.chance(0.025)){
        this._collect(raidRollBoxKey(0), c.x, c.y);   // 普通箱按 0 级算 → 最多只出 I 级钥匙
      }
      if(RNG.chance(c.locked ? (0.06+0.04*(c.lockLv||1)) : 0.02)){
        this.tokens=(this.tokens||0)+1;
        this._float(c.x, c.y-64, "◆ GP 币 +1", "#c07bff");
        SFX.levelup();
      }
      this.search=null;
    }
  },

  /* 背包满时溢出的物品不再凭空消失 —— 落在脚下形成「地面物品堆」，
   * 腾出空间后走回来按 E 就能捡。同类物品就近合并成堆，单堆最多 8 件。 */
  _dropGround(item, x, y){
    const bx=x!==undefined?x:this.player.x, by=y!==undefined?y:this.player.y;
    if(!this.grounds) this.grounds=[];
    let pile=this.grounds.find(c=>!c.searched
      && (c.drops||[]).length<8 && M.dist(c.x,c.y,bx,by)<70);
    if(pile){ pile.drops.push(item); return pile; }
    // 堆数达上限时只并入「仍未搜刮且未满」的堆，绝不写进已搜刮堆
    // （原实现固定取 grounds[0]，若该堆 searched=true 则物品永久丢失）
    const open=this.grounds.filter(c=>!c.searched && (c.drops||[]).length<8);
    if(open.length>=60){
      let best=open[0];
      for(const c of open) if((c.drops||[]).length<(best.drops||[]).length) best=c;
      best.drops.push(item); return best;
    }
    const a=RNG.fr(0,6.2832), r=RNG.fr(36,54);
    pile={ x:M.clamp(bx+Math.cos(a)*r, 40, RAID_MAP_W-40),
           y:M.clamp(by+Math.sin(a)*r, 40, RAID_MAP_H-40),
           tier:0, ground:true, searched:false, drops:[item], cash:0 };
    this.grounds.push(pile);
    return pile;
  },

  // 返回 true 表示成功放入物品栏；false 表示已满（物品已落到地面，等玩家腾出空间再回来捡）
  _invPush(arr, key, item){
    if(arr.length>=RAID_INV_CAP[key]) return false;
    arr.push(item); return true;
  },
  /* 掉一条子弹：口径有 45% 概率跟着玩家手上的枪，级别由箱子等级 / 运气决定 */
  _rollAmmo(luck, cal){
    const pg=this.player && this.player.gun;
    const want=pg ? (pg.cal||ammoCalOfType(pg.type)) : null;
    const c=cal || ((want && RNG.chance(0.45)) ? want : RNG.pick(AMMO_CAL_LIST));
    const l=M.clamp(luck||0, 0, 1);
    const lv=M.clamp(1+Math.floor(RNG.f()*(1.9+l*2.4)), 1, 5);
    const d=ammoDef(c, lv);
    d.n=RAID_AMMO_STACK;
    return d;
  },
  _collect(item, x, y, fromGround){
    this._invDirty=true;   // 物品栏开着时拾取会即时刷新
    const px=x!==undefined?x:this.player.x, py=(y!==undefined?y:this.player.y)-24;
    const spill=(label)=>{
      if(!fromGround) this._dropGround(item, x, y);
      this._float(px, py, fromGround ? label+"已满 · 先腾出空间"
                                     : label+"已满 · 物品掉在脚下", "#ff8a5a");
      return false;
    };
    /* 弹药：按发堆进弹药栏（不占物品格，但总发数有上限） */
    if(item.kind==="ammo"){
      const id=item.id || ammoItemId(item.cal, item.lv);
      const want=item.n||RAID_AMMO_STACK;
      const add=this._ammoAdd(id, want);
      if(add>0){
        const d=ammoDefFromId(id)||item;
        this._float(px, py, "+"+add+" "+d.short, d.color||"#dfe7f0");
        SFX.pickup();
        return true;
      }
      this._float(px, py, "弹药已满（"+RAID_AMMO_CAP+" 发上限）", "#ff8a5a");
      return false;
    }
    // 原材料：直接进入材料栏（带品质颜色）
    if(item.kind==="material"){
      if(this._invPush(this.inv.materials, "materials", item)){
        this._float(px, py, "+"+item.name, item.color||"#dfe7f0");
        SFX.pickup();
        return true;
      }
      return spill("材料栏");
    }
    // 钥匙：独立钥匙串，带使用次数，不占配件位
    if(item.kind==="key"){
      if(!this.inv.keys) this.inv.keys=[];
      if(this._invPush(this.inv.keys, "keys", item)){
        this._float(px, py, "+"+item.name+"（"+RAID_LOCK_NAME[item.lv]+"）", item.color||"#8fe07a");
        SFX.pickup();
        return true;
      }
      return spill("钥匙串");
    }
    // 医疗品：绷带进「绷带数」，其余进医疗包栏
    if(item.kind==="med"){
      if(item.id==="bandage"){ this.bandages+=1; this._float(px,py,"+1 绷带",item.color||"#ff9a9a"); SFX.pickup(); return true; }
      const slot = this.inv.meds.find(m=>m.id===item.id);
      if(slot){ slot.n+=1; this._float(px,py,"+"+item.name, item.color||"#ff9a9a"); SFX.pickup(); return true; }
      if(this.inv.meds.length < RAID_INV_CAP.meds){ this.inv.meds.push({id:item.id, name:item.name, n:1, tier:item.tier, color:item.color}); this._float(px,py,"+"+item.name,item.color||"#ff9a9a"); SFX.pickup(); return true; }
      return spill("医疗栏");
    }
    // 改装模块：现已并入配件，作为 slot:"core" 的配件进配件栏（由下方 part 分支统一处理）
    if(item.kind==="receiver"){
      const arr=this.inv.receivers;
      if(arr.length<RAID_INV_CAP.receivers){ arr.push(item); this._float(px,py,"+"+item.name,item.color||"#8fd0ff"); SFX.pickup(); return true; }
      return spill("底材栏");
    }
    // 武器：空手或没副手 → 直接上手并放入物品栏（这是裸装跑刀能翻身的关键）
    if(item.kind==="weapon" && (!this.player.gun || !this.player.secondary)){
      // 自动上手也要走容量检查，避免极端情况下 inv.weapons 超过 6 把
      if(this.inv.weapons.length>=RAID_INV_CAP.weapons) return spill("武器栏");
      const g=raidGunFromItem(item);
      g.ammoMag=g.mag; g.ammoRes=g.reserve;        // 捡到的枪：满弹上手
      const slot = !this.player.gun ? "主手" : "副手";
      if(!this.player.gun) this.player.gun=g; else this.player.secondary=g;
      this.player.fireCd=Math.max(this.player.fireCd,0.2);
      this.inv.weapons.push(item);                 // 已上手的枪也记入物品栏（统一上限管理）
      this._float(px, py, slot+" "+item.name, raidGunColor(item));
      SFX.pickup();
      return true;
    }
    if(item.kind==="shield"){
      /* v0.21.0：身上没护盾就直接穿上（省一次开物品栏点「拿在手上」），
       * 已经有盾了才进背包 —— 免得捡到个更差的把好的顶掉。 */
      if(this.player && !(this.player.maxShield>0) && this._wearShield(item)){
        this._float(px, py, "已穿戴 "+item.name, shieldColor(item));
        SFX.pickup();
        return true;
      }
      if(!this.inv.shields) this.inv.shields=[];
      if(this._invPush(this.inv.shields, "shields", item)){
        this._float(px, py, "+"+item.name, shieldColor(item)); SFX.pickup(); return true;
      }
      return spill("护盾栏");
    }
    let arr, key, col;
    if(item.kind==="weapon"){ arr=this.inv.weapons; key="weapons"; col=raidGunColor(item); }
    else if(item.kind==="helmet"){ arr=this.inv.helmets; key="helmets"; col=RAID_RARITY_COLOR[item.rarity|0]||"#dfe7f0"; }
    else if(item.kind==="part"){ arr=this.inv.parts; key="parts"; col=(RARITY_BY_ID[item.rarity]||{color:"#cfd8e2"}).color; }
    else { arr=this.inv.armors; key="armors"; col=RAID_RARITY_COLOR[item.rarity|0]||"#dfe7f0"; }
    if(this._invPush(arr, key, item)){
      const star=(item.kind==="armor"||item.kind==="helmet")&&item.rarity?(' '+RAID_RARITY_NAME[item.rarity]):'';
      // 双手都满时捡到的枪进背包，Q 键可随时换到手上
      this._float(px, py, (item.kind==="weapon"?"背包 ":"+")+item.name+star, col);
      SFX.pickup();
      return true;
    }
    return spill("物品栏");
  },

  /* ----------------------------- 撤离 ----------------------------- */
  _extractUpdate(dt, game){
    const p=this.player;
    let zone=null;
    for(const z of this.extracts){
      if(z.closed) continue;
      if(p.x>=z.x&&p.x<=z.x+z.w&&p.y>=z.y&&p.y<=z.y+z.h){ zone=z; break; }
    }
    if(zone){
      // 撤离点被封锁：封锁者存活时无法读条，必须先清除（这是「堵撤离点」的实际效果）
      const blocker=this.ops.find(o=>o.alive && o.blockZone===zone &&
        M.dist(o.x,o.y, zone.x+zone.w/2, zone.y+zone.h/2) < 300);
      if(blocker){
        this.extractT=Math.max(0, this.extractT-dt*2.2);
        this._extractBlockReason="撤离点被封锁 · 清除封锁者";
        return;
      }
      // 付费撤离点：费用随带入装备估值浮动；余额不足时不计时
      const fee=raidExtractFee(zone, this.carryVal||0);
      const purse=this.creds + Math.max(0, (this.stash&&this.stash.creds)||0);
      if(fee>0 && purse<fee){
        this.extractT=Math.max(0, this.extractT-dt*1.6);
        this._extractBlockReason="撤离费 "+fee+" 卢布不足（局内 "+this.creds+" + 仓库 "+Math.max(0,(this.stash&&this.stash.creds)||0)+"）";
      } else {
        this._extractBlockReason=null;
        this.extractT=Math.min(zone.need, this.extractT+dt);
        if(this.extractT>=zone.need){
          if(fee>0 && !this._payExtractFee(fee)){   // V-EX 车费（局内现金优先，仓库兜底）
            this.extractT=Math.max(0, this.extractT-dt*1.6);
            this._extractBlockReason="撤离费 "+fee+" 卢布不足";
            return;
          }
          this._succeed(zone);
        }
      }
    } else {
      this._extractBlockReason=null;
      this.extractT=Math.max(0, this.extractT-dt*1.6);
    }
  },

  /* 付撤离费：优先局内现金，其次仓库余额（钱只在真正撤离成功时才扣，读条被打断不白花） */
  _payExtractFee(fee){
    if(fee<=0) return true;
    if(this.creds>=fee){ this.creds-=fee; return true; }
    const st=Math.max(0,(this.stash&&this.stash.creds)||0);
    if(st>=fee){
      this.stash.creds=st-fee;
      if(typeof RaidStash!=="undefined" && RaidStash.save) RaidStash.save(this.stash);
      return true;
    }
    return false;
  },

  _succeed(zone){
    if(!this.active || this._ended) return;
    this._ended=true;
    this.resetUiState();
    if(this.online && typeof Net!=="undefined") Net.sendExtract(zone?zone.name:"");
    // 联机：自己撤离后世界继续跑（房主还要给队友模拟 AI），镜头交给观战
    this.active=!!this.online;
    this.spectate=!!this.online;
    this._hideTouchLayer();
    // 物品栏（含入场携带的装备）全部写回仓库
    this.stash.creds += this.creds;
    for(const w of this.inv.weapons) this.stash.weapons.push(w);
    for(const a of this.inv.armors) this.stash.armors.push(a);
    for(const h of this.inv.helmets) this.stash.helmets.push(h);
    this.stash.shields=this.stash.shields||[];
    for(const s of (this.inv.shields||[])) this.stash.shields.push(s);
    // 穿戴中的护甲 / 头盔 / 护盾（耐久按撤离时的剩余值保留，不再凭空蒸发）
    if(this.carried.armor) this.stash.armors.push(this.carried.armor);
    if(this.carried.helmet) this.stash.helmets.push(this.carried.helmet);
    if(this.carried.shield) this.stash.shields.push(this.carried.shield);
    for(const pt of this.inv.parts) this.stash.parts.push(pt);
    for(const m of this.inv.materials) this.stash.materials.push(m);   // 原材料随撤离带回仓库
    this.stash.keys=this.stash.keys||[];
    for(const k of (this.inv.keys||[])) this.stash.keys.push(k);        // 钥匙带回仓库
    this.stash.receivers=this.stash.receivers||[];
    for(const r of this.inv.receivers) this.stash.receivers.push(r);
    this.stash.meds=Object.assign({hemo:0,medkit:0,stim:0,surgery:0}, this.meds||{});
    /* v0.19.0：局内捡到的医疗品也要随撤离入库，否则「捡到即消失」 */
    for(const m of (this.inv.meds||[])) this.stash.meds[m.id]=(this.stash.meds[m.id]||0)+(m.n||0);
    this.stash.bandages=this.bandages;
    // 撤离不再保底发 GP 币 —— 只按带出价值与击杀数结算
    // （本局首杀的那 1 枚已由 _onBotDeath 当场发放，没打到人、也没翻到货就是 0 枚）
    let lootVal=0;
    for(const w of this.inv.weapons) lootVal+=w.value||0;
    for(const a of this.inv.armors) lootVal+=a.value||0;
    for(const h of this.inv.helmets) lootVal+=h.value||0;
    for(const s of (this.inv.shields||[])) lootVal+=s.value||0;
    for(const pt of this.inv.parts) lootVal+=(pt.slot==="core"?(pt.value||0):partValue(pt))||0;
    for(const m of this.inv.materials) lootVal+=m.value||0;
    for(const k of (this.inv.keys||[])) lootVal+=(k.value||0)*((k.uses||1)/Math.max(1,k.maxUses||1));
    const tokenGain=M.clamp(Math.floor(lootVal/60000)+Math.floor((this.player.kills||0)/3), 0, 5);
    const tokenTotal=(this.tokens||0)+tokenGain;
    this.stash.tokens=(this.stash.tokens||0)+tokenTotal;
    if(!RaidStash.save(this.stash) && this.game && this.game.toast)
      this.game.toast("仓库写入失败：localStorage 可能已满，请清理后重试");
    this.game.state="raidover";
    UI.raidResult({
      success:true, zone:zone?zone.name:"撤离点", creds:this.creds,
      returned:{ weapons:this.inv.weapons.length,
                 armor:this.inv.armors.length+(this.carried.armor?1:0),
                 helmet:this.inv.helmets.length+(this.carried.helmet?1:0),
                 shields:(this.inv.shields||[]).length+(this.carried.shield?1:0),
                 materials:this.inv.materials.length,
                 keys:(this.inv.keys||[]).length },
      looted:this.inv, kills:this.player.kills, time:480-this.timer,
      insured:this.insured, insuredPaid:this.insuredVal,
      tokens:tokenTotal, tokenLoot:this.tokens||0,
    });
  },

  _fail(reason, killer, gun){
    if(!this.active || this._ended) return;
    this._ended=true;
    this.resetUiState();
    if(this.online && typeof Net!=="undefined") Net.sendDead(killer?killer.name:reason);
    this.active=!!this.online;
    this.spectate=!!this.online;
    this.player.alive=false;
    this._hideTouchLayer();
    if(killer && killer.name) this._feed(killer.name, "你", gun?gun.name:"交火", false, "kill");
    // 阵亡：携带装备与战利品全部丢失（仓库在开局已扣除）
    // 塔科夫式保险：投保的装备有 65% 概率"无人捡走"被退回
    let recovered=[];
    if(this.insured){
      const retBack=[];
      for(const w of this.carried.weapons) if(RNG.chance(0.65)) retBack.push(w);
      if(this.carried.armor && RNG.chance(0.65)) retBack.push(this.carried.armor);
      if(this.carried.helmet && RNG.chance(0.65)) retBack.push(this.carried.helmet);
      if(this.carried.shield && RNG.chance(0.65)) retBack.push(this.carried.shield);
      for(const it of retBack){
        if(it.kind==="weapon") this.stash.weapons.push(it);
        else if(it.kind==="helmet") this.stash.helmets.push(it);
        else if(it.kind==="shield") (this.stash.shields=this.stash.shields||[]).push(it);
        else this.stash.armors.push(it);
        recovered.push(it);
      }
    }
    if(!RaidStash.save(this.stash) && this.game && this.game.toast)
      this.game.toast("仓库写入失败：localStorage 可能已满，请清理后重试");
    this.game.state="raidover";
    UI.raidResult({
      success:false, reason, lost:{
        weapons:this.carried.weapons, armor:this.carried.armor, helmet:this.carried.helmet, shield:this.carried.shield,
        // 开局把 carried.weapons 也压进了 inv.weapons，这里按 uid 去重，避免结算列表重复
        lootW:this.inv.weapons.filter(w=>!(this.carried.weapons||[]).some(c=>c.uid===w.uid)),
        lootA:this.inv.armors.filter(a=>a!==this.carried.armor),
        lootH:(this.inv.helmets||[]).filter(h=>h!==this.carried.helmet),
        lootP:this.inv.parts||[], lootM:this.inv.materials||[],
      }, kills:this.player.kills, time:480-this.timer,
      insured:this.insured, insuredPaid:this.insuredVal, recovered,
    });
  },

  _hideTouchLayer(){
    const tl=document.getElementById("touch-layer");
    if(tl) tl.classList.add("hidden");   // 修复：结算界面出现后触摸按钮仍可点
  },

  /* ----------------------------- 服务器背景交火 ----------------------------- */
  _backgroundFight(){
    // 只让「远离玩家」的 AI 之间发生交火 / 撤离，避免眼前的人凭空消失
    const p=this.player;
    const alive=this.ops.filter(o=>o.alive && !o.isPlayer && !o.remote && M.dist(o.x,o.y,p.x,p.y)>900);
    if(alive.length<=1) return;
    if(RNG.chance(0.35)){
      // 有人带着战利品撤离
      const o=RNG.pick(alive);
      o.alive=false;
      this._feed(o.name, "", "已撤离", false, "extract");
    } else {
      const victim=RNG.pick(alive);
      const others=alive.filter(o=>o!==victim);
      const killer=RNG.pick(others);
      victim.alive=false;
      this._feed(killer.name, victim.name, killer.gun?killer.gun.name:"交火", false, "kill");
      this._dropFromBot(victim, true);   // 远处尸体同样留下它的背包
    }
  },

  /* ----------------------------- 增援（小队 / 撤离点封锁者） ----------------------------- */
  _spawnReinforcement(){
    const isSquad = RNG.chance(0.5);
    const squadId = isSquad ? ("sq"+(this._squadN++)) : null;
    const n = isSquad ? RNG.ri(2,3) : 1;
    /* 约 45% 的小队会去封锁某个开放的撤离点。三条约束（v0.19.2）：
     *   · 付费撤离点永不封锁 —— 它是「花钱买路」的保底出口，堵了就真没路走了
     *   · 同一个点不重复挂封锁者（否则杀一个还有下一个，永远清不完）
     *   · 全图同时存在的封锁者最多 2 个，避免后期所有撤离点全红 */
    let blockZone=null;
    const liveBlockers=this.ops.filter(o=>o.alive && o.blockZone).length;
    if(isSquad && RNG.chance(0.45) && liveBlockers < 2){
      const open=this.extracts.filter(z=>!z.closed && !(z.cost>0) &&
        !this.ops.some(o=>o.alive && o.blockZone===z));
      if(open.length) blockZone=RNG.pick(open);
    }
    // 选一个离玩家足够远的房间进场，避免「凭空刷在脸上」
    const p0=this.player;
    let room=null;
    for(let i=0;i<8;i++){
      const cand=RNG.pick(RAID_ROOMS.filter(r=>!r.extract));
      const cx=cand.x+cand.w/2, cy=cand.y+cand.h/2;
      if(!p0 || M.dist(cx,cy,p0.x,p0.y) > 700){ room=cand; break; }
      if(!room) room=cand;
    }
    const pt=this._openPointInRoom(room, 70+n*24);
    for(let i=0;i<n;i++){
      const p=this._openPointInRoom(room, 70+i*26);
      const smart=RNG.chance(0.6);
      const gid=RNG.pick(["rifle","smg","sniper","rifle","shotgun"]);
      const gun=blGunGen(RNG.ri(12,17),{type:gid});   // 增援全部带装备
      const armorTier=RNG.chance(0.6)?RNG.ri(3,6):0;
      const helmetTier=armorTier?RNG.ri(2,5):0;
      const isBlocker = !!(blockZone && i===0);
      const op=new RaidOperator({
        id:"re"+(this.uidN++)+"-"+(i+1), cls:"pmc", name:(smart?"◆ ":"")+(isBlocker?"封锁者":(squadId?"小队":"游骑兵")),
        x:p.x, y:p.y, angle:RNG.fr(0,6.28),
        speed:RNG.fr(140,162), hp:RNG.ri(95,140),
        color:isBlocker?"#ff7a3c":"#e0b84a",
        gun, armor:armorTier?RAID_ARMORS[armorTier].maxArmor:0, dr:armorTier?RAID_ARMORS[armorTier].dr:0, armorTier,
        helmetArmor:helmetTier?RAID_HELMETS[helmetTier].maxArmor:0, helmetDr:helmetTier?RAID_HELMETS[helmetTier].dr:0, helmetTier,
        shield: (smart && armorTier>0 && armorTier<RAID_ARMOR_TYPE_TIER) ? Math.round(28+armorTier*6) : 0,
        smart, creds:RNG.ri(60,260), lootLimit:3,
        squadId, isLeader:(isSquad&&i===0), blocker:isBlocker,
      });
      if(blockZone) op.blockZone=blockZone;
      this.ops.push(op);
    }
    if(blockZone) this._feed("警告", "一支小队正封锁「"+blockZone.name+"」", "", false, "warn");
    else this._feed("系统", "增援部队已进入战区", "", false, "warn");
  },

  /* ----------------------------- 火箭弹 ----------------------------- */
  _updateRocket(rk, dt){
    const nx=rk.x+Math.cos(rk.ang)*rk.speed*dt, ny=rk.y+Math.sin(rk.ang)*rk.speed*dt;
    const wh=this._rayWall(rk.x,rk.y,nx,ny);
    if(wh){ const t=wh.t||1; this._explodeRocket(rk, rk.x+(nx-rk.x)*t, rk.y+(ny-rk.y)*t); return true; }
    for(const o of this.ops){
      if(o===rk.owner || !o.alive) continue;
      if(M.dist(nx,ny,o.x,o.y) < o.r+10){ this._explodeRocket(rk, nx, ny); return true; }
    }
    rk.x=nx; rk.y=ny;
    rk.trail.push({x:nx,y:ny}); if(rk.trail.length>12) rk.trail.shift();
    rk.life-=dt;
    if(rk.life<=0){ this._explodeRocket(rk, rk.x, rk.y); return true; }
    return false;
  },
  _explodeRocket(rk, x, y){
    const R=rk.splash||120;
    for(const o of this.ops){
      if(!o.alive || o===rk.owner) continue;
      const d=M.dist(x,y,o.x,o.y);
      if(d<=R){ const fall=M.clamp(1-d/R*0.6,0.35,1); this._damage(o, rk.dmg*fall, rk.owner, rk.gun); }
    }
    for(let i=0;i<16;i++){ const a=Math.random()*6.28, s=Math.random()*260+80;
      this.particles.push({x,y,vx:Math.cos(a)*s,vy:Math.sin(a)*s,life:0.5,maxLife:0.5,color:i%2?"#ffd23f":"#ff7a1f",size:3}); }
    this.blasts.push({x,y,r:R*0.45,life:0.34,maxLife:0.34});
    this._float(x, y-30, "爆炸", "#ffb020");
    SFX.boom();
  },

  /* ----------------------------- 视觉工具 ----------------------------- */
  spawnHit(x,y,color){
    for(let i=0;i<6;i++){ const a=Math.random()*6.28, s=Math.random()*120+40;
      this.particles.push({x,y,vx:Math.cos(a)*s,vy:Math.sin(a)*s,life:0.3,maxLife:0.3,color,size:2.6}); }
  },
  // v0.14.10：冰冻命中的冰晶散射（配合 unit() 里的冰霜环 / 结晶）
  _freezeBurst(x,y){
    for(let i=0;i<9;i++){ const a=Math.random()*6.28, s=Math.random()*80+30;
      this.particles.push({x,y,vx:Math.cos(a)*s,vy:Math.sin(a)*s,life:0.55,maxLife:0.55,
        color:i%2?"#bdefff":"#6fd6ff",size:2.4}); }
  },
  _float(x,y,text,color){ this.floats.push({x,y,text,color:color||"#fff",life:0.9,maxLife:0.9,vy:-30,size:13}); },
  _feed(a,v,gun,mine,type){ this.killfeed.unshift({a,v,gun,mine:!!mine,type:type||"kill",t:6}); if(this.killfeed.length>6) this.killfeed.pop(); },

  _screenToWorld(sx,sy,game){
    const z=game.zoom||1;
    return { x:this.camera.x+sx/z, y:this.camera.y+sy/z };
  },

  _updateCamera(game){
    const v=game.view, z=game.zoom||1, p=this.player;
    const vw=v.w/z, vh=v.h/z;
    let fx=p.x, fy=p.y;
    if(this.spectate){
      const m=this.ops.find(o=>o.remote && o.alive) || this.ops.find(o=>o.remote);
      if(m){ fx=m.x; fy=m.y; }
    }
    let tx=fx-vw/2, ty=fy-vh/2;
    tx = RAID_MAP_W<=vw ? (RAID_MAP_W-vw)/2 : M.clamp(tx,0,RAID_MAP_W-vw);
    ty = RAID_MAP_H<=vh ? (RAID_MAP_H-vh)/2 : M.clamp(ty,0,RAID_MAP_H-vh);
    this.camera.x=M.lerp(this.camera.x,tx,0.2);
    this.camera.y=M.lerp(this.camera.y,ty,0.2);
    // v0.14.11：塔科夫模式原本只维护 Raid.camera，game.camera 一直停在 (0,0)，
    // 导致 game.worldToScreen() / 任何按屏幕坐标定位的 UI 在 raid 模式下全部算错。
    game.camera.x=this.camera.x; game.camera.y=this.camera.y;
  },

  _rayWall(x1,y1,x2,y2){
    const dx=x2-x1, dy=y2-y1; const len=Math.hypot(dx,dy);
    if(len<1) return null;
    const steps=Math.ceil(len/13);
    const CS=this.navCS, cols=this.navCols, rows=this.navRows;
    for(let i=1;i<=steps;i++){
      const t=i/steps, px=x1+dx*t, py=y1+dy*t;
      if(!CS){   // 索引未建立时的兜底
        for(const w of this.walls){
          if(w.sight!==false && px>=w.x&&px<=w.x+w.w&&py>=w.y&&py<=w.y+w.h) return {x:px,y:py,t};
        }
        continue;
      }
      const gx=px/CS|0, gy=py/CS|0;
      if(gx<0||gy<0||gx>=cols||gy>=rows) return {x:px,y:py,t};
      const arr=this.losCell[gy*cols+gx];
      if(!arr) continue;
      for(let k=0;k<arr.length;k++){
        const w=arr[k];
        if(px>=w.x&&px<=w.x+w.w&&py>=w.y&&py<=w.y+w.h) return {x:px,y:py,t};
      }
    }
    return null;
  },
  _los(x1,y1,x2,y2){ return !this._rayWall(x1,y1,x2,y2); },
  _pointSeg(px,py,x1,y1,x2,y2){
    const dx=x2-x1, dy=y2-y1; const L2=dx*dx+dy*dy;
    if(L2===0) return Math.hypot(px-x1,py-y1);
    let t=((px-x1)*dx+(py-y1)*dy)/L2; t=M.clamp(t,0,1);
    const cx=x1+t*dx, cy=y1+t*dy;
    return Math.hypot(px-cx,py-cy);
  },

  aliveFoes(){ return this.ops.filter(o=>!o.isPlayer && !o.remote && o.alive).length; },
  lootValue(){
    let v=0; for(const w of this.inv.weapons) v+=w.value; for(const a of this.inv.armors) v+=a.value;
    for(const s of (this.inv.shields||[])) v+=s.value;
    return v;
  },

  /* ================= DOM 物品栏 + 逐件丢弃 ================= */
  _invToggleDom(){
    const el=document.getElementById('inv-layer');
    if(!el) return;
    if(!this.showInv){ el.classList.add('hidden'); el.innerHTML=""; return; }
    el.classList.remove('hidden');
    this._invRender();
  },
  _invRender(){
    const el=document.getElementById('inv-layer');
    if(!el || !this.showInv) return;
    const R=this, p=R.player;
    const bodyOld=el.querySelector('.inv-body');
    const scroll=bodyOld?bodyOld.scrollTop:0;
    const esc=t=>String(t==null?"":t).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
    const money=v=>"₽"+priceTextShort(v||0);
    const rows=[];
    const sec=(t,extra)=>rows.push(`<div class="inv-sec"><span>${t}</span><span>${extra||""}</span></div>`);
    const line=(name,col,meta,drop,equip,use)=>{
      rows.push(`<div class="inv-row">
        <div class="ir-main"><div class="ir-name" style="color:${col||"#dfe7f0"}">${esc(name)}</div>
        <div class="ir-meta">${esc(meta||"")}</div></div>
        ${use?`<button class="inv-take" data-use="${use}">使用</button>`:""}
        ${equip?`<button class="inv-take" data-equip="${equip}">拿在手上</button>`:""}
        ${drop?`<button class="inv-drop" data-drop="${drop}">✕ 丢弃</button>`:""}
      </div>`);
    };

    /* 装备中（不可丢，防止误操作把手上的枪/盔甲扔掉） */
    sec("装备中","撤离成功才带回仓库");
    line("主武器 · "+(p.gun?p.gun.name:"空手"), p.gun?raidGunColor(p.gun):"#8b95a5",
      p.gun?`${p.gun.ammoMag}/${p.gun.mag} 发 · 背包 ${p.gun.ammoRes} · ${p.gun.loaded?(ammoDefFromId(p.gun.loaded)||{}).short||"?" : "未装填"}`:"按 Q 从背包取枪");
    if(p.secondary) line("副武器 · "+p.secondary.name, raidGunColor(p.secondary),
      `${p.secondary.ammoMag}/${p.secondary.mag} 发 · 背包 ${p.secondary.ammoRes} · ${p.secondary.loaded?(ammoDefFromId(p.secondary.loaded)||{}).short||"?" : "未装填"}`);
    if(p.armorTier) line("护甲 · "+RAID_ARMORS[p.armorTier].name, ARMOR_TIER_COLOR[p.armorTier]||"#dfe7f0",
      `T${p.armorTier} · 耐久 ${Math.round(p.armor)}/${Math.round(p.maxArmor)} · 减伤 ${Math.round(p.dr*100)}%${p.armorTier>=RAID_ARMOR_TYPE_TIER?(p.armor>0?(' · 硬质插板（HP ×'+elemMult('corrosive','armor').toFixed(2)+'）'):' · 已击穿（无防护）'):''}`);
    if(p.helmetTier) line("头盔 · "+RAID_HELMETS[p.helmetTier].name, ARMOR_TIER_COLOR[p.helmetTier]||"#dfe7f0",
      `T${p.helmetTier} · 耐久 ${Math.round(p.helmetArmor)}/${Math.round(p.maxHelmetArmor)} · 躯干减伤 ${Math.round(p.helmetDr*HELMET_BODY_SHARE*100)}% / 爆头 ${Math.round(p.helmetDr*100)}%`);
    if(p.maxShield>0) line("护盾 · "+(p.shieldGear?p.shieldGear.name:"护盾模块"), "#4fd6ff",
      `容量 ${Math.round(p.shield)}/${Math.round(p.maxShield)} · 充能 ${p.shieldRate}/s · 延迟 ${p.shieldDelay}s · 破盾无敌 ${(p.shieldInvulnBase||0).toFixed(2)}s`);
    line("卢布", "#8fe07a", "₽ "+priceText(R.creds)+" · 撤离后结算进仓库");
    if((R.tokens||0)>0) line("GP 币", "#c07bff", "◆ "+R.tokens+" · 撤离才落袋");

    /* 弹药栏（v0.20.0）：按口径 × 级别堆叠，总发数有上限 */
    {
      const ids=Object.keys(R.inv.ammo||{}).filter(id=>ammoParseId(id)&&R.inv.ammo[id]>0);
      ids.sort((a,b)=>{
        const A=ammoParseId(a), B=ammoParseId(b);
        return (AMMO_CAL_LIST.indexOf(A.cal)-AMMO_CAL_LIST.indexOf(B.cal)) || (B.lv-A.lv);
      });
      sec("弹药 · "+R._ammoTotal()+"/"+RAID_AMMO_CAP+" 发","换弹时自动扣这里的子弹");
      if(!ids.length){
        rows.push(`<div class="inv-row"><div class="ir-main"><div class="ir-name" style="color:#8b95a5">没有子弹</div>
          <div class="ir-meta">搜箱 / 商店 / 工坊合成都能拿到弹药</div></div></div>`);
      }
      for(const id of ids){
        const d=ammoDefFromId(id), n=R.inv.ammo[id];
        const E=AMMO_TYPES[d.elem]||AMMO_TYPES.none;
        const onGun=(p.gun&&p.gun.loaded===id)||(p.secondary&&p.secondary.loaded===id);
        line(d.name+(onGun?" · 已装填":""), d.color,
          `${d.spec} · T${d.lv} ${(AMMO_GRADE_BY_LV[d.lv]||{}).name||""} · 穿深 ${E.pen} · ${n} 发 · ${money(d.value*n)}`,
          `ammo:${id}`);
      }
    }

    /* 背包战利品（全部可丢，丢在脚下还能捡回来） */
    const capTxt=`武器 ${R.inv.weapons.length}/${RAID_INV_CAP.weapons} · 材料 ${R.inv.materials.length}/${RAID_INV_CAP.materials} · 钥匙 ${(R.inv.keys||[]).length}/${RAID_INV_CAP.keys}`;
    sec("背包 · 战利品","✕ 丢在脚下，之后还能捡回来");
    rows.push(`<div class="inv-sec" style="margin:0 4px 6px;color:#6f8296">${capTxt}</div>`);

    let any=false;
    const bag=R._gunBag?R._gunBag():[];
    for(const w of bag){
      const i=R.inv.weapons.indexOf(w);
      if(i<0) continue;
      any=true;
      const rtg=R._rtGun(w);
      line(w.name, raidGunColor(w),
        `伤害 ${w.dmg} · 弹匣 ${rtg?rtg.ammoMag:0}/${w.mag} · 装填 ${rtg&&rtg.loaded?((ammoDefFromId(rtg.loaded)||{}).short||"?"):"未装填"} · 估值 ${money(w.value)}`,
        `weapons:${i}`, `weapons:${i}`);
    }
    for(let i=0;i<R.inv.armors.length;i++){
      const a=R.inv.armors[i]; any=true;
      line(a.name, RAID_RARITY_COLOR[a.rarity|0]||"#dfe7f0",
        `T${a.tier} · ${RAID_RARITY_NAME[a.rarity|0]||""} · 耐久 ${a.maxArmor} · ${money(a.value)}`, `armors:${i}`);
    }
    for(let i=0;i<R.inv.helmets.length;i++){
      const h=R.inv.helmets[i]; any=true;
      line(h.name, RAID_RARITY_COLOR[h.rarity|0]||"#dfe7f0",
        `T${h.tier} · ${RAID_RARITY_NAME[h.rarity|0]||""} · 耐久 ${h.maxArmor} · ${money(h.value)}`, `helmets:${i}`);
    }
    for(let i=0;i<(R.inv.shields||[]).length;i++){
      const s=R.inv.shields[i]; any=true;
      line(s.name, shieldColor(s),
        `T${s.tier} 护盾 · ${shieldLines(s).slice(0,3).join(" · ")} · ${money(s.value)}`, `shields:${i}`);
    }
    for(let i=0;i<R.inv.parts.length;i++){
      const pt=R.inv.parts[i]; any=true;
      const col=(RARITY_BY_ID[pt.rarity]||{}).color||pt.color||"#dfe7f0";
      line(pt.name, col, `${pt.core?"改装模块 · ":""}${pt.slot||""} · 估值 ${money(pt.value||partValue(pt))}`, `parts:${i}`);
    }
    for(let i=0;i<R.inv.materials.length;i++){
      const m=R.inv.materials[i]; any=true;
      line(m.name, m.color||"#dfe7f0", `T${m.tier} · 估值 ${money(m.value)}`, `materials:${i}`);
    }
    for(let i=0;i<R.inv.receivers.length;i++){
      const r=R.inv.receivers[i]; any=true;
      line(r.name, r.color||"#8fd0ff", `底材 · 估值 ${money(r.value)}`, `receivers:${i}`);
    }
    for(let i=0;i<(R.inv.keys||[]).length;i++){
      const k=R.inv.keys[i]; any=true;
      line(k.name, k.color||"#ffd23f",
        `${RAID_LOCK_NAME[M.clamp(k.lv||1,1,5)]} · 剩 ${k.uses}/${k.maxUses||k.uses} 次 · ${money(k.value)}`, `keys:${i}`);
    }
    for(let i=0;i<R.inv.meds.length;i++){
      const m=R.inv.meds[i]; any=true;
      const md=RAID_MED_BY_ID[m.id]||{};
      line(m.name+(m.n>1?" ×"+m.n:""), m.color||"#ff9a9a",
        `${md.desc||"医疗品"} · 丢弃 1 件`, `meds:${i}`, null, `meds:${i}`);
    }
    if(R.bandages>0){ any=true; line("绷带 ×"+R.bandages, "#ff9a9a", "止血 · 丢弃 1 卷", "bandage:0", null, "bandage:0"); }
    if(!any) rows.push(`<div class="inv-empty">背包是空的 · 去翻箱、摸尸体，撤离前记得清点。</div>`);

    el.innerHTML=`<div class="inv-card">
      <div class="inv-head"><b>物品栏</b><span class="inv-sub">${Input.isTouch?"点背包键关闭":"Tab 关闭"} · 游戏继续运行</span></div>
      <div class="inv-body">${rows.join("")}</div>
      <div class="inv-foot">背包枪点「拿在手上」可立即换枪（旧枪自动回背包）；丢弃会把物品放在脚下（发光小包裹），腾出格子后可以再捡回来；阵亡或超时则全部丢失。</div>
    </div>`;
    const nb=el.querySelector('.inv-body');
    if(nb) nb.scrollTop=scroll;
    el.querySelectorAll('[data-equip]').forEach(btn=>{
      btn.onclick=(e)=>{
        e.preventDefault(); e.stopPropagation();
        const idx=parseInt(String(btn.dataset.equip).split(":")[1],10)||0;
        this._invEquip(idx);
      };
    });
    el.querySelectorAll('[data-drop]').forEach(btn=>{
      btn.onclick=(e)=>{
        e.preventDefault(); e.stopPropagation();
        const [type,idx]=btn.dataset.drop.split(":");
        this._invDrop(type, type==="ammo" ? idx : (parseInt(idx,10)||0));
      };
    });
    el.querySelectorAll('[data-use]').forEach(btn=>{
      btn.onclick=(e)=>{
        e.preventDefault(); e.stopPropagation();
        const [type,idx]=btn.dataset.use.split(":");
        this._invUse(type, parseInt(idx,10)||0);
      };
    });
  },
  /* 物品栏点「使用」：绷带与四种医疗品都走同一条 _medStart 流程 */
  _invUse(type, idx){
    const p=this.player;
    let id=null;
    if(type==="bandage") id="bandage";
    else if(type==="meds"){ const m=this.inv.meds[idx]; if(m) id=m.id; }
    if(!id) return;
    if(this.medT>0){ this._float(p.x,p.y-46,"正在治疗…","#ffb35a"); return; }
    if(!this._medStart(id)){
      this._float(p.x,p.y-46,"没有 "+((RAID_MED_BY_ID[id]||{}).name||"医疗品"),"#ff8a5a");
      return;
    }
    SFX.ui();
    this._invDirty=false;
    this._invRender();
  },
  /* 从物品栏直接把背包枪拿在手上（与 Q 键同逻辑，旧枪自动回背包） */
  _invEquip(idx){
    const it=(this.inv.weapons||[])[idx];
    if(!it) return;
    const g=this._rtGun(it);
    if(!g || g===this.player.gun) { this._invRender(); return; }
    if(this.player.reloadT>0) this.player.reloadT=0;   // 换枪即打断换弹
    this._equipGun(g);
    SFX.ui();
    this._invDirty=false;
    this._invRender();
  },

  _invDrop(type, idx){
    /* 弹药按 id 丢：整条落在地上，之后还能捡回来 */
    if(type==="ammo"){
      const id=String(idx||"");
      const n=this._ammoCount(id);
      if(n<=0) return;
      const d=ammoDefFromId(id);
      this._ammoTake(id, n);
      const it=Object.assign({}, d, { n });
      this._dropGround(it, this.player.x, this.player.y);
      this._float(this.player.x, this.player.y-46, "丢弃 "+n+" 发 "+d.short, "#ff9a8a");
      SFX.ui();
      this._invDirty=false;
      this._invRender();
      return;
    }
    const R=this, p=R.player;
    let it=null;
    const take=(arr)=>{ if(!arr || idx<0 || idx>=arr.length) return null; return arr.splice(idx,1)[0]; };
    if(type==="weapons") it=take(R.inv.weapons);
    else if(type==="armors") it=take(R.inv.armors);
    else if(type==="helmets") it=take(R.inv.helmets);
    else if(type==="shields") it=take(R.inv.shields||[]);
    else if(type==="parts") it=take(R.inv.parts);
    else if(type==="materials") it=take(R.inv.materials);
    else if(type==="receivers") it=take(R.inv.receivers);
    else if(type==="keys") it=take(R.inv.keys||[]);
    else if(type==="meds"){
      const m=R.inv.meds[idx];
      if(!m) return;
      if(m.n>1){ m.n--; it={ kind:"med", id:m.id, name:m.name, n:1, color:m.color, tier:m.tier }; }
      else it=R.inv.meds.splice(idx,1)[0];
    } else if(type==="bandage"){
      if(R.bandages<=0) return;
      R.bandages--;
      it={ kind:"med", id:"bandage", name:"绷带", n:1, color:"#ff9a9a" };
    }
    if(!it) return;
    R._dropGround(it, p.x, p.y);
    R._float(p.x, p.y-46, "丢弃 "+it.name, "#ff9a8a");
    SFX.ui();
    R._invDirty=false;
    this._invRender();
  },

};

/* =========================================================================
 * RenderRaid — 俯视角渲染 + 自绘 HUD（含左上角击杀提示）
 * ========================================================================= */
const RenderRaid = {
  render(ctx, game){
    const R=Raid, v=game.view;
    if(!R.active && game.state!=="raidover"){ /* 结束瞬间仍出一帧 */ }
    ctx.setTransform(v.dpr,0,0,v.dpr,0,0);
    ctx.fillStyle="#070a08"; ctx.fillRect(0,0,v.w,v.h);
    if(!R.player) return;
    const cam=R.camera, z=game.zoom||1;
    if(typeof ViewMode!=="undefined" && ViewMode.is3D() && typeof FPView!=="undefined"){
      /* 维度切换：只替换世界层，暗角 / HUD / DOM 物品栏全部复用同一套 */
      FPView.render(ctx, game, R);
    } else {
      ctx.save(); ctx.scale(z,z); ctx.translate(-cam.x,-cam.y);
      this.scene(ctx, game, cam, z);
      ctx.restore();
    }
    // 冷色雾气暗角——中心透明、边缘泛冷蓝灰，强化荒凉紧张的氛围（绘制于 HUD 之下）
    const vg=ctx.createRadialGradient(v.w/2, v.h/2, Math.min(v.w,v.h)*0.30, v.w/2, v.h/2, Math.max(v.w,v.h)*0.78);
    vg.addColorStop(0,"rgba(0,0,0,0)"); vg.addColorStop(1,"rgba(14,20,32,0.42)");
    ctx.fillStyle=vg; ctx.fillRect(0,0,v.w,v.h);
    ctx.fillStyle="rgba(28,40,58,0.06)"; ctx.fillRect(0,0,v.w,v.h);
    this.hud(ctx, game, v);
  },

  /* 户外掩体绘制：按类型区分轮廓，避免整张图全是“灰色方块” */
  prop(ctx,p){
    const k=p.kind, x=p.x, y=p.y, w=p.w, h=p.h;
    if(k==="bush"||k==="rock"||k==="tree"){
      // 圆形物用椭圆投影，否则地上会出现一个方块状黑斑
      ctx.fillStyle="rgba(0,0,0,0.24)";
      ctx.beginPath(); ctx.ellipse(x+w/2+5, y+h/2+7, w*0.46, h*0.40, 0, 0, 6.2832); ctx.fill();
    } else {
      ctx.fillStyle="rgba(0,0,0,0.30)"; ctx.fillRect(x+4,y+6,w,h);
    }
    if(k==="bush"){
      const cx=x+w/2, cy=y+h/2;
      ctx.fillStyle="rgba(28,46,26,0.95)";
      ctx.beginPath(); ctx.ellipse(cx,cy,w*0.5,h*0.46,0,0,6.2832); ctx.fill();
      ctx.fillStyle=p.fill;
      ctx.beginPath(); ctx.ellipse(cx-w*0.14,cy-h*0.10,w*0.34,h*0.32,0.4,0,6.2832); ctx.fill();
      ctx.beginPath(); ctx.ellipse(cx+w*0.16,cy+h*0.08,w*0.30,h*0.30,-0.3,0,6.2832); ctx.fill();
      ctx.fillStyle="rgba(120,170,110,0.16)";
      ctx.beginPath(); ctx.ellipse(cx-w*0.06,cy-h*0.20,w*0.20,h*0.16,0,0,6.2832); ctx.fill();
      return;
    }
    if(k==="rock"){
      const cx=x+w/2, cy=y+h/2;
      ctx.fillStyle=p.fill;
      ctx.beginPath();
      ctx.moveTo(x+w*0.06,y+h*0.55);
      ctx.lineTo(x+w*0.24,y+h*0.10);
      ctx.lineTo(x+w*0.62,y+h*0.04);
      ctx.lineTo(x+w*0.94,y+h*0.42);
      ctx.lineTo(x+w*0.84,y+h*0.90);
      ctx.lineTo(x+w*0.36,y+h*0.96);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle="rgba(180,190,170,0.12)";
      ctx.beginPath();
      ctx.moveTo(x+w*0.24,y+h*0.10); ctx.lineTo(x+w*0.62,y+h*0.04);
      ctx.lineTo(x+w*0.58,y+h*0.34); ctx.lineTo(x+w*0.22,y+h*0.40);
      ctx.closePath(); ctx.fill();
      return;
    }
    ctx.fillStyle=p.fill; ctx.fillRect(x,y,w,h);
    ctx.strokeStyle=p.edge; ctx.lineWidth=2; ctx.strokeRect(x,y,w,h);
    if(k==="container"){
      ctx.strokeStyle="rgba(0,0,0,0.16)"; ctx.lineWidth=1.5;
      ctx.beginPath();
      if(w>h){ for(let i=x+26;i<x+w-14;i+=26){ ctx.moveTo(i,y+5); ctx.lineTo(i,y+h-5); } }
      else   { for(let i=y+26;i<y+h-14;i+=26){ ctx.moveTo(x+5,i); ctx.lineTo(x+w-5,i); } }
      ctx.stroke();
      // 箱门锁扣
      ctx.fillStyle="rgba(0,0,0,0.35)";
      if(w>h){ ctx.fillRect(x+6,y+h*0.34,5,h*0.32); ctx.fillRect(x+w-11,y+h*0.34,5,h*0.32); }
      else   { ctx.fillRect(x+w*0.34,y+6,w*0.32,5); ctx.fillRect(x+w*0.34,y+h-11,w*0.32,5); }
      ctx.fillStyle="rgba(255,255,255,0.075)"; ctx.fillRect(x+2,y+2,w-4,4);
    } else if(k==="truck"){
      const cab = w>h ? {x:x, y:y+2, w:w*0.30, h:h-4} : {x:x+2, y:y, w:w-4, h:h*0.30};
      ctx.fillStyle="#2b2721"; ctx.fillRect(cab.x,cab.y,cab.w,cab.h);
      ctx.fillStyle="rgba(150,190,210,0.16)";
      if(w>h) ctx.fillRect(cab.x+3,cab.y+3,cab.w-6,cab.h*0.4);
      else    ctx.fillRect(cab.x+3,cab.y+3,cab.w*0.4,cab.h-6);
      ctx.fillStyle="#171512";
      if(w>h){ ctx.fillRect(x+w*0.34,y+h-3,w*0.12,5); ctx.fillRect(x+w*0.76,y+h-3,w*0.12,5); }
      else   { ctx.fillRect(x+w-3,y+h*0.34,5,h*0.12); ctx.fillRect(x+w-3,y+h*0.76,5,h*0.12); }
    } else if(k==="barrier"){
      ctx.save(); ctx.beginPath(); ctx.rect(x+2,y+2,w-4,h-4); ctx.clip();
      ctx.fillStyle="rgba(196,164,58,0.55)";
      const step=26;
      if(w>h){ for(let i=-h;i<w+h;i+=step){ ctx.beginPath(); ctx.moveTo(x+i,y+h); ctx.lineTo(x+i+h,y); ctx.lineTo(x+i+h+12,y); ctx.lineTo(x+i+12,y+h); ctx.closePath(); ctx.fill(); } }
      else   { for(let i=-w;i<h+w;i+=step){ ctx.beginPath(); ctx.moveTo(x,y+i); ctx.lineTo(x+w,y+i-w); ctx.lineTo(x+w,y+i-w+12); ctx.lineTo(x,y+i+12); ctx.closePath(); ctx.fill(); } }
      ctx.restore();
    } else if(k==="crate"){
      ctx.strokeStyle="rgba(0,0,0,0.35)"; ctx.lineWidth=3;
      ctx.beginPath(); ctx.moveTo(x+5,y+5); ctx.lineTo(x+w-5,y+h-5);
      ctx.moveTo(x+w-5,y+5); ctx.lineTo(x+5,y+h-5); ctx.stroke();
    } else if(k==="pipe"){
      ctx.strokeStyle="rgba(0,0,0,0.30)"; ctx.lineWidth=3;
      ctx.beginPath();
      if(w>h){ for(let i=1;i<3;i++){ ctx.moveTo(x+3,y+h*i/3); ctx.lineTo(x+w-3,y+h*i/3); } }
      else   { for(let i=1;i<3;i++){ ctx.moveTo(x+w*i/3,y+3); ctx.lineTo(x+w*i/3,y+h-3); } }
      ctx.stroke();
      ctx.fillStyle="rgba(200,200,190,0.10)"; ctx.fillRect(x+2,y+2,w-4,3);
    } else if(k==="shelf"){
      ctx.strokeStyle="rgba(0,0,0,0.34)"; ctx.lineWidth=2;
      ctx.beginPath();
      if(w>h){ for(let i=1;i<3;i++){ ctx.moveTo(x+4,y+h*i/3); ctx.lineTo(x+w-4,y+h*i/3); } }
      else   { for(let i=1;i<3;i++){ ctx.moveTo(x+w*i/3,y+4); ctx.lineTo(x+w*i/3,y+h-4); } }
      ctx.stroke();
      ctx.fillStyle="rgba(220,200,150,0.10)"; ctx.fillRect(x+3,y+3,w-6,3);
    } else if(k==="table"){
      ctx.fillStyle="rgba(255,255,255,0.06)"; ctx.fillRect(x+4,y+4,w-8,h-8);
      ctx.strokeStyle="rgba(0,0,0,0.28)"; ctx.lineWidth=2; ctx.strokeRect(x+8,y+8,w-16,h-16);
    } else if(k==="machine"){
      ctx.fillStyle="rgba(0,0,0,0.26)"; ctx.fillRect(x+w*0.16,y+h*0.16,w*0.68,h*0.62);
      ctx.fillStyle="rgba(120,220,200,0.14)"; ctx.fillRect(x+w*0.24,y+h*0.24,w*0.24,h*0.20);
      ctx.fillStyle="rgba(230,150,60,0.18)"; ctx.fillRect(x+w*0.16,y+h-10,w*0.68,5);
    } else if(k==="sandbag"){
      ctx.strokeStyle="rgba(0,0,0,0.30)"; ctx.lineWidth=2;
      ctx.beginPath();
      if(w>h){ for(let i=x+22;i<x+w-8;i+=22){ ctx.moveTo(i,y+3); ctx.lineTo(i,y+h-3); } }
      else   { for(let i=y+22;i<y+h-8;i+=22){ ctx.moveTo(x+3,i); ctx.lineTo(x+w-3,i); } }
      ctx.stroke();
    } else if(k==="locker"){
      ctx.strokeStyle="rgba(0,0,0,0.34)"; ctx.lineWidth=2;
      ctx.beginPath();
      if(w<h){ ctx.moveTo(x+4,y+h/2); ctx.lineTo(x+w-4,y+h/2); }
      else   { ctx.moveTo(x+w/2,y+4); ctx.lineTo(x+w/2,y+h-4); }
      ctx.stroke();
      ctx.fillStyle="rgba(180,200,220,0.16)"; ctx.fillRect(x+w*0.34,y+h*0.30,4,4);
    } else if(k==="scrap"){
      ctx.fillStyle="rgba(0,0,0,0.22)";
      for(let i=0;i<4;i++){
        const sx=x+((i*37)%Math.max(2,w-26)), sy=y+((i*53)%Math.max(2,h-20));
        ctx.fillRect(sx, sy, 18+(i%2)*12, 12+(i%2)*8);
      }
    } else if(k==="tree"){
      // 常绿树：树冠由三层同心椭圆叠加，顶端高光，俯视角识别度高
      const cx=x+w/2, cy=y+h/2, r=w/2;
      ctx.fillStyle="rgba(20,34,18,0.96)";
      ctx.beginPath(); ctx.ellipse(cx,cy,r*1.0,r*0.94,0,0,6.2832); ctx.fill();
      ctx.fillStyle=p.fill;
      ctx.beginPath(); ctx.ellipse(cx,cy,r*0.80,r*0.74,0,0,6.2832); ctx.fill();
      ctx.fillStyle="rgba(66,92,46,0.95)";
      ctx.beginPath(); ctx.ellipse(cx-r*0.18,cy-r*0.16,r*0.50,r*0.46,0,0,6.2832); ctx.fill();
      ctx.fillStyle="rgba(96,128,68,0.55)";
      ctx.beginPath(); ctx.ellipse(cx-r*0.22,cy-r*0.22,r*0.24,r*0.20,0,0,6.2832); ctx.fill();
    } else if(k==="railcar"){
      // 货运车厢：深色车体 + 侧板棱线 + 顶部高光
      ctx.fillStyle=p.fill; ctx.fillRect(x,y,w,h);
      ctx.strokeStyle=p.edge||"#15181d"; ctx.lineWidth=2; ctx.strokeRect(x,y,w,h);
      ctx.strokeStyle="rgba(0,0,0,0.35)"; ctx.lineWidth=1.5;
      ctx.beginPath();
      if(w>h){ for(let i=x+26;i<x+w-10;i+=26){ ctx.moveTo(i,y+3); ctx.lineTo(i,y+h-3); } }
      else   { for(let i=y+26;i<y+h-10;i+=26){ ctx.moveTo(x+3,i); ctx.lineTo(x+w-3,i); } }
      ctx.stroke();
      ctx.fillStyle="rgba(180,200,220,0.10)"; ctx.fillRect(x+2,y+2,w-4,4);
    } else {
      ctx.fillStyle="rgba(255,255,255,0.05)"; ctx.fillRect(x+2,y+2,w-4,4);
    }
  },

  /* 单块地表 decal 的绘制（确定性几何，按类型分支；全部为廉价填充/描边） */
  _decal(ctx, d){
    const x=d.x, y=d.y;
    switch(d.t){
      case "oil": {
        ctx.fillStyle="rgba(8,14,10,"+d.a+")";
        ctx.beginPath(); ctx.ellipse(x,y,d.r,d.r*0.72,0,0,6.2832); ctx.fill();
        ctx.fillStyle="rgba(90,110,95,"+(d.a*0.5)+")";
        ctx.beginPath(); ctx.ellipse(x-d.r*0.18,y-d.r*0.14,d.r*0.34,d.r*0.26,0,0,6.2832); ctx.fill();
        break;
      }
      case "stain": {
        ctx.fillStyle="rgba(70,54,38,"+d.a+")";
        ctx.beginPath(); ctx.ellipse(x,y,d.r,d.r*0.78,0.4,0,6.2832); ctx.fill();
        break;
      }
      case "blood": {
        ctx.fillStyle="rgba(120,22,26,"+d.a+")";
        ctx.beginPath(); ctx.ellipse(x,y,d.r,d.r*0.7,0,0,6.2832); ctx.fill();
        ctx.fillStyle="rgba(90,16,20,"+(d.a*0.8)+")";
        ctx.beginPath(); ctx.ellipse(x+d.r*0.4,y+d.r*0.2,d.r*0.4,d.r*0.3,0,0,6.2832); ctx.fill();
        break;
      }
      case "crack": {
        ctx.strokeStyle="rgba(150,160,150,0.13)"; ctx.lineWidth=1.4;
        ctx.beginPath();
        ctx.moveTo(x-Math.cos(d.ang)*d.w/2, y-Math.sin(d.ang)*d.w/2);
        const mx=x+Math.cos(d.ang)*d.w*0.1, my=y+Math.sin(d.ang)*d.w*0.1;
        ctx.lineTo(mx,my); ctx.lineTo(x+Math.cos(d.ang)*d.w/2, y+Math.sin(d.ang)*d.w/2);
        ctx.stroke();
        ctx.beginPath(); ctx.moveTo(mx,my);
        ctx.lineTo(mx+Math.cos(d.ang+1.1)*d.w*0.3, my+Math.sin(d.ang+1.1)*d.w*0.3);
        ctx.stroke();
        break;
      }
      case "line": {
        ctx.save(); ctx.translate(x,y); ctx.rotate(d.ang||0);
        ctx.strokeStyle="rgba(220,210,150,"+(d.a||0.06)+")"; ctx.lineWidth=3;
        ctx.setLineDash([14,12]);
        ctx.beginPath(); ctx.moveTo(-d.w/2,0); ctx.lineTo(d.w/2,0); ctx.stroke();
        ctx.setLineDash([]); ctx.restore();
        break;
      }
      case "grass": {
        // 荒野底色偏暗，草簇要更亮一点才读得出来
        ctx.strokeStyle="rgba(96,140,72,0.62)"; ctx.lineWidth=1.8;
        for(let i=0;i<4;i++){
          const a=(i/4)*6.2832+x*0.013;
          ctx.beginPath(); ctx.moveTo(x,y);
          ctx.quadraticCurveTo(x+Math.cos(a)*d.r*0.5, y+Math.sin(a)*d.r*0.5-d.r*0.3,
                               x+Math.cos(a)*d.r, y+Math.sin(a)*d.r);
          ctx.stroke();
        }
        break;
      }
      case "rocklet": {
        ctx.fillStyle="rgba(78,80,74,0.62)";
        ctx.beginPath(); ctx.ellipse(x,y,d.r,d.r*0.8,0,0,6.2832); ctx.fill();
        ctx.fillStyle="rgba(132,134,124,0.30)";
        ctx.beginPath(); ctx.ellipse(x-d.r*0.2,y-d.r*0.2,d.r*0.4,d.r*0.3,0,0,6.2832); ctx.fill();
        break;
      }
      case "glyph": {
        ctx.save(); ctx.translate(x,y); ctx.rotate(d.ang||0);
        ctx.strokeStyle=d.c; ctx.globalAlpha=d.a; ctx.lineWidth=2.4; ctx.lineCap="round";
        ctx.beginPath();
        ctx.moveTo(-d.r,0); ctx.lineTo(d.r,0);
        ctx.moveTo(0,-d.r); ctx.lineTo(0,d.r);
        ctx.arc(0,0,d.r,0.2,2.6);
        ctx.stroke();
        ctx.globalAlpha=1; ctx.restore();
        break;
      }
    }
  },

  /* 区域明暗：确定性暗斑，叠加在地面/房间之上、道具之下 */
  _drawAmbient(ctx, cam, vw, vh){
    const S=Raid.darkSpots; if(!S||!S.length) return;
    for(const s of S){
      if(s.x>cam.x+vw+s.r||s.x<cam.x-s.r||s.y>cam.y+vh+s.r||s.y<cam.y-s.r) continue;
      const g=ctx.createRadialGradient(s.x,s.y,0,s.x,s.y,s.r);
      g.addColorStop(0,`rgba(2,6,10,${s.a})`);
      g.addColorStop(1,"rgba(2,6,10,0)");
      ctx.fillStyle=g; ctx.beginPath(); ctx.arc(s.x,s.y,s.r,0,6.2832); ctx.fill();
    }
  },

  /* 光照层：探照灯（静态）+ 玩家手电（动态），暖色加色叠加 */
  _lightLayer(ctx, game, cam, vw, vh){
    const R=Raid;
    ctx.save();
    ctx.globalCompositeOperation="lighter";
    if(R.floodlights){
      for(const f of R.floodlights){
        if(f.x>cam.x+vw+f.r||f.x<cam.x-f.r||f.y>cam.y+vh+f.r||f.y<cam.y-f.r) continue;
        const g=ctx.createRadialGradient(f.x,f.y,0,f.x,f.y,f.r);
        g.addColorStop(0,"rgba(255,228,160,0.20)");
        g.addColorStop(0.55,"rgba(255,210,140,0.07)");
        g.addColorStop(1,"rgba(255,210,140,0)");
        ctx.fillStyle=g; ctx.beginPath(); ctx.arc(f.x,f.y,f.r,0,6.2832); ctx.fill();
      }
    }
    const p=R.player;
    if(p){
      const ang=p.angle||0, reach=560, half=0.42;
      const g=ctx.createRadialGradient(p.x,p.y,0,p.x,p.y,reach);
      g.addColorStop(0,"rgba(255,236,182,0.30)");
      g.addColorStop(0.5,"rgba(255,224,160,0.12)");
      g.addColorStop(1,"rgba(255,224,160,0)");
      ctx.fillStyle=g; ctx.beginPath(); ctx.moveTo(p.x,p.y);
      ctx.arc(p.x,p.y,reach, ang-half, ang+half); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  },

  scene(ctx, game, cam, z){
    const R=Raid, v=game.view;
    const vw=v.w/z, vh=v.h/z;

    // 地图底面
    ctx.fillStyle="#0d1114"; ctx.fillRect(0,0,RAID_MAP_W,RAID_MAP_H);

    /* ---- 地表分区（大块弱色差，让荒野有“地貌”而不是一堵墙一样的纯色） ---- */
    const ZS=560;
    const zx0=Math.floor((cam.x-40)/ZS), zx1=Math.floor((cam.x+vw+40)/ZS);
    const zy0=Math.floor((cam.y-40)/ZS), zy1=Math.floor((cam.y+vh+40)/ZS);
    for(let gy=zy0;gy<=zy1;gy++){
      for(let gx=zx0;gx<=zx1;gx++){
        const hv=R._hash2(gx*7+3, gy*11+5);
        ctx.fillStyle = hv<0.32 ? "#14191b" : hv<0.62 ? "#101618" : hv<0.84 ? "#181a1c" : "#0c1012";
        ctx.fillRect(gx*ZS, gy*ZS, ZS, ZS);
      }
    }

    /* ---- 密林地表：树冠之下的暗绿林地底色（按视口裁剪） ---- */
    if(R.forests){
      for(const fz of R.forests){
        if(fz.x>cam.x+vw||fz.x+fz.w<cam.x||fz.y>cam.y+vh||fz.y+fz.h<cam.y) continue;
        ctx.fillStyle="rgba(30,44,26,0.55)"; ctx.fillRect(fz.x,fz.y,fz.w,fz.h);
        ctx.fillStyle="rgba(46,64,36,0.30)"; ctx.fillRect(fz.x+12,fz.y+12,fz.w-24,fz.h-24);
      }
    }

    /* ---- 道路 / 门外铺装 ---- */
    for(const rd of R.roads){
      if(rd.x>cam.x+vw+40||rd.x+rd.w<cam.x-40||rd.y>cam.y+vh+40||rd.y+rd.h<cam.y-40) continue;
      ctx.fillStyle="rgba(52,50,43,0.62)"; ctx.fillRect(rd.x,rd.y,rd.w,rd.h);
      ctx.fillStyle="rgba(96,92,78,0.20)"; ctx.fillRect(rd.x,rd.y,rd.w,2);
      // 中线虚线
      if(rd.w>=rd.h && rd.w>420){
        ctx.strokeStyle="rgba(150,140,100,0.13)"; ctx.lineWidth=3; ctx.setLineDash([26,30]);
        ctx.beginPath(); ctx.moveTo(rd.x,rd.y+rd.h/2); ctx.lineTo(rd.x+rd.w,rd.y+rd.h/2); ctx.stroke();
        ctx.setLineDash([]);
      } else if(rd.h>rd.w && rd.h>420){
        ctx.strokeStyle="rgba(150,140,100,0.13)"; ctx.lineWidth=3; ctx.setLineDash([26,30]);
        ctx.beginPath(); ctx.moveTo(rd.x+rd.w/2,rd.y); ctx.lineTo(rd.x+rd.w/2,rd.y+rd.h); ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    /* ---- 草丛 / 碎石斑块 ---- */
    const PS=134;
    const px0=Math.floor((cam.x-60)/PS), px1=Math.floor((cam.x+vw+60)/PS);
    const py0=Math.floor((cam.y-60)/PS), py1=Math.floor((cam.y+vh+60)/PS);
    for(let gy=py0;gy<=py1;gy++){
      for(let gx=px0;gx<=px1;gx++){
        const hv=R._hash2(gx*5+91, gy*3+37);
        if(hv<0.54) continue;
        const cx=gx*PS+R._hash2(gx,gy*7)*PS;
        const cy=gy*PS+R._hash2(gx*13,gy)*PS;
        ctx.fillStyle = hv>0.88 ? "rgba(86,116,72,0.085)" : (hv>0.70 ? "rgba(62,86,58,0.070)" : "rgba(48,60,44,0.060)");
        ctx.beginPath();
        ctx.ellipse(cx, cy, 14+hv*22, 10+hv*15, hv*3.14, 0, 6.2832);
        ctx.fill();
      }
    }

    // 户外网格（弱化，避免抢视觉）
    ctx.strokeStyle="rgba(120,160,110,0.035)"; ctx.lineWidth=1;
    const gx0=Math.floor(cam.x/160)*160, gx1=cam.x+vw, gy0=Math.floor(cam.y/160)*160, gy1=cam.y+vh;
    for(let x=gx0;x<=gx1;x+=160){ ctx.beginPath();ctx.moveTo(x,cam.y);ctx.lineTo(x,cam.y+vh);ctx.stroke(); }
    for(let y=gy0;y<=gy1;y+=160){ ctx.beginPath();ctx.moveTo(cam.x,y);ctx.lineTo(cam.x+vw,y);ctx.stroke(); }

    /* ---- 泄洪后的库底：淤泥 + 残水洼（只在水放空时出现） ---- */
    if(R.damOpen && R.reservoirRect){
      const rr=R.reservoirRect;
      const rx0=rr.x, ry0=rr.y, rx1=rr.x+rr.w, ry1=rr.y+rr.h;
      if(!(rx0>cam.x+vw||rx1<cam.x||ry0>cam.y+vh||ry1<cam.y)){
        ctx.fillStyle="#35312a"; ctx.fillRect(rx0, ry0, rx1-rx0, ry1-ry0);
        ctx.fillStyle="rgba(72,66,52,0.45)";
        for(let y=ry0+46;y<ry1;y+=72) ctx.fillRect(rx0, y, rx1-rx0, 24);
        // 搁浅的沉箱 / 残骸
        for(let i=0;i<7;i++){
          const bx2=rx0+120+((i*283)%(rx1-rx0-260)), by2=ry0+90+((i*197)%(ry1-ry0-160));
          ctx.fillStyle="rgba(58,46,34,0.92)"; ctx.fillRect(bx2, by2, 52, 34);
          ctx.strokeStyle="rgba(20,16,12,0.8)"; ctx.lineWidth=2; ctx.strokeRect(bx2, by2, 52, 34);
        }
        ctx.fillStyle="rgba(46,86,104,0.55)";
        for(let i=0;i<9;i++){
          const wx=rx0+80+((i*157)%(rx1-rx0-160)), wy=ry1-80-((i*211)%260);
          ctx.beginPath(); ctx.ellipse(wx, wy, 58+((i*37)%46), 20, 0.4, 0, 6.2832); ctx.fill();
        }
      }
    }

    /* ---- 大坝水库（矩形库区，视觉与碰撞一致） ---- */
    if(R.reservoirRect && !R.damOpen){
      const rr=R.reservoirRect;
      if(!(rr.x>cam.x+vw||rr.x+rr.w<cam.x||rr.y>cam.y+vh||rr.y+rr.h<cam.y)){
        ctx.fillStyle="rgba(20,38,50,0.97)"; ctx.fillRect(rr.x, rr.y, rr.w, rr.h);
        ctx.fillStyle="rgba(32,58,74,0.5)"; ctx.fillRect(rr.x, rr.y+26, rr.w, rr.h-26);
        ctx.strokeStyle="rgba(130,190,210,0.22)"; ctx.lineWidth=3;
        ctx.beginPath(); ctx.moveTo(rr.x, rr.y+2); ctx.lineTo(rr.x+rr.w, rr.y+2); ctx.stroke();
        ctx.strokeStyle="rgba(150,200,215,0.10)"; ctx.lineWidth=2;
        for(let i=0;i<26;i++){
          const wy=rr.y+44+((i*67)%(rr.h-64));
          const wx=rr.x+30+((i*233)%(rr.w-200));
          ctx.beginPath(); ctx.moveTo(wx, wy); ctx.lineTo(wx+120+((i*31)%110), wy); ctx.stroke();
        }
      }
    }

    /* ---- 中央河谷：水面（水圆叠加成连续河带）+ 桥面 + 铁路 ---- */
    if(R.waterCircles && R.waterCircles.length){
      const vis=(c)=>!(c.x>cam.x+vw+c.r||c.x<cam.x-c.r||c.y>cam.y+vh+c.r||c.y<cam.y-c.r);
      // 主体水面：先用略小的深蓝铺底，再用更暗的圆覆盖，避免圆边叠加出同心环
      ctx.fillStyle="rgba(20,38,50,0.96)";
      for(const c of R.waterCircles){ if(!vis(c)) continue; ctx.beginPath(); ctx.arc(c.x,c.y,c.r+2,0,6.2832); ctx.fill(); }
      ctx.fillStyle="rgba(30,56,72,0.55)";
      for(const c of R.waterCircles){ if(!vis(c)) continue; ctx.beginPath(); ctx.arc(c.x,c.y,c.r*0.52,0,6.2832); ctx.fill(); }
      // 稀疏波光：只画水平短划，避免同心环视觉噪声
      ctx.strokeStyle="rgba(150,200,215,0.12)"; ctx.lineWidth=1.6;
      for(let i=0;i<R.waterCircles.length;i+=5){
        const c=R.waterCircles[i]; if(!vis(c)) continue;
        const wv=R._hash2(c.x|0,c.y|0);
        ctx.beginPath(); ctx.moveTo(c.x-c.r*0.36, c.y+(wv-0.5)*50); ctx.lineTo(c.x+c.r*0.36, c.y+(wv-0.5)*50); ctx.stroke();
      }
    }
    // 桥面：河道上的安全通道（与碰撞中的桥矩形一致）；大桥有双黄线与更厚的护栏
    if(R.bridges){
      for(const b of R.bridges){
        if(b.x-b.w/2>cam.x+vw||b.x+b.w/2<cam.x-40||b.y-b.h/2>cam.y+vh||b.y+b.h/2<cam.y-40) continue;
        const bw=b.w, bh=b.h, x0=b.x-bw/2, y0=b.y-bh/2;
        ctx.fillStyle=b.big?"#2b3036":"#25282c"; ctx.fillRect(x0,y0,bw,bh);
        ctx.fillStyle="rgba(150,160,170,0.14)"; ctx.fillRect(x0,y0,bw,4);
        // 混凝土桥墩（沿桥面中段）
        ctx.fillStyle="rgba(24,28,32,0.55)";
        for(let px=x0+40; px<x0+bw-30; px+=110) ctx.fillRect(px, y0+bh*0.32, 16, bh*0.36);
        if(b.big){
          // 双黄中线 + 更厚的护栏
          ctx.strokeStyle="rgba(226,196,86,0.55)"; ctx.lineWidth=2; ctx.setLineDash([18,14]);
          ctx.beginPath(); ctx.moveTo(x0+10, b.y); ctx.lineTo(x0+bw-10, b.y); ctx.stroke();
          ctx.setLineDash([]);
          ctx.strokeStyle="rgba(180,192,205,0.6)"; ctx.lineWidth=5;
          ctx.beginPath(); ctx.moveTo(x0,y0+3); ctx.lineTo(x0+bw,y0+3);
          ctx.moveTo(x0,y0+bh-3); ctx.lineTo(x0+bw,y0+bh-3); ctx.stroke();
        }
        ctx.strokeStyle="#0d0f12"; ctx.lineWidth=2; ctx.strokeRect(x0,y0,bw,bh);
        ctx.strokeStyle="rgba(96,106,116,0.85)"; ctx.lineWidth=3;
        ctx.beginPath(); ctx.moveTo(x0,y0); ctx.lineTo(x0+bw,y0);
        ctx.moveTo(x0,y0+bh); ctx.lineTo(x0+bw,y0+bh); ctx.stroke();
      }
    }
    // 铁路：路基 + 枕木 + 双轨（纯视觉，可通行）
    if(R.rails){
      for(const rl of R.rails){
        for(let s=0;s<rl.pts.length-1;s++){
          const [x1,y1]=rl.pts[s], [x2,y2]=rl.pts[s+1];
          if(Math.max(x1,x2)<cam.x-40||Math.min(x1,x2)>cam.x+vw+40||Math.max(y1,y2)<cam.y-40||Math.min(y1,y2)>cam.y+vh+40) continue;
          const ang=Math.atan2(y2-y1,x2-x1), len=Math.hypot(x2-x1,y2-y1);
          ctx.save(); ctx.translate(x1,y1); ctx.rotate(ang);
          ctx.fillStyle="rgba(40,40,38,0.55)"; ctx.fillRect(0,-26,len,52);
          ctx.fillStyle="rgba(58,48,36,0.9)";
          for(let d=0;d<len;d+=30){ ctx.fillRect(d,-22,10,44); }
          ctx.strokeStyle="rgba(150,158,166,0.55)"; ctx.lineWidth=3;
          ctx.beginPath(); ctx.moveTo(0,-14); ctx.lineTo(len,-14); ctx.moveTo(0,14); ctx.lineTo(len,14); ctx.stroke();
          ctx.strokeStyle="rgba(200,210,220,0.18)"; ctx.lineWidth=1;
          ctx.beginPath(); ctx.moveTo(0,-15); ctx.lineTo(len,-15); ctx.moveTo(0,15); ctx.lineTo(len,15); ctx.stroke();
          ctx.restore();
        }
      }
    }

    /* ---- 建筑院子（底座水泥地）：让孤立的房子有占地，视觉上不再是“散落的盒子” ---- */
    for(const yd of R.yards){
      if(yd.x>cam.x+vw+120||yd.x+yd.w<cam.x-120||yd.y>cam.y+vh+120||yd.y+yd.h<cam.y-120) continue;
      ctx.fillStyle=yd.tint; ctx.globalAlpha=0.62; ctx.fillRect(yd.x,yd.y,yd.w,yd.h); ctx.globalAlpha=1;
      // 水泥分块缝
      ctx.strokeStyle="rgba(170,200,180,0.05)"; ctx.lineWidth=1;
      for(let i=yd.x+70;i<yd.x+yd.w;i+=70){ ctx.beginPath(); ctx.moveTo(i,yd.y); ctx.lineTo(i,yd.y+yd.h); ctx.stroke(); }
      for(let i=yd.y+70;i<yd.y+yd.h;i+=70){ ctx.beginPath(); ctx.moveTo(yd.x,i); ctx.lineTo(yd.x+yd.w,i); ctx.stroke(); }
    }

    // 房间地面
    for(const rm of R.roomRects){
      if(rm.x>cam.x+vw+200||rm.x+rm.w<cam.x-200||rm.y>cam.y+vh+200||rm.y+rm.h<cam.y-200) continue;
      ctx.fillStyle=rm.extract?"#25452f":rm.tint;
      ctx.globalAlpha=0.95; ctx.fillRect(rm.x,rm.y,rm.w,rm.h); ctx.globalAlpha=1;
      ctx.fillStyle="rgba(0,0,0,0.16)"; ctx.fillRect(rm.x,rm.y,rm.w,rm.h);
      // 地面砖缝（横竖两层，提升质感）
      ctx.strokeStyle="rgba(170,200,180,0.06)"; ctx.lineWidth=1;
      for(let gx=rm.x+40;gx<rm.x+rm.w;gx+=60){ ctx.beginPath();ctx.moveTo(gx,rm.y);ctx.lineTo(gx,rm.y+rm.h);ctx.stroke(); }
      for(let gy=rm.y+40;gy<rm.y+rm.h;gy+=60){ ctx.beginPath();ctx.moveTo(rm.x,gy);ctx.lineTo(rm.x+rm.w,gy);ctx.stroke(); }
    }

    /* ---- 房间踢脚板：沿房间内侧一圈深色墙裙 + 极淡高光，让室内边界更立体 ---- */
    ctx.strokeStyle="rgba(0,0,0,0.20)"; ctx.lineWidth=7;
    for(const rm of R.roomRects){
      if(rm.x>cam.x+vw+120||rm.x+rm.w<cam.x-120||rm.y>cam.y+vh+120||rm.y+rm.h<cam.y-120) continue;
      ctx.strokeRect(rm.x+4, rm.y+4, rm.w-8, rm.h-8);
    }
    ctx.strokeStyle="rgba(255,255,255,0.05)"; ctx.lineWidth=1.5;
    for(const rm of R.roomRects){
      if(rm.x>cam.x+vw+120||rm.x+rm.w<cam.x-120||rm.y>cam.y+vh+120||rm.y+rm.h<cam.y-120) continue;
      ctx.strokeRect(rm.x+8, rm.y+8, rm.w-16, rm.h-16);
    }

    /* ---- 地表细节 decals（油渍/血迹/裂缝/草簇/碎石/标线/涂鸦）：纯视觉，按视口裁剪 ---- */
    if(R.decals){
      for(const d of R.decals){
        if(d.x>cam.x+vw+44||d.x<cam.x-44||d.y>cam.y+vh+44||d.y<cam.y-44) continue;
        this._decal(ctx, d);
      }
    }

    // 区域明暗（暗斑），落在地面/房间之上、道具之下，制造受光层次
    this._drawAmbient(ctx, cam, vw, vh);

    /* ---- 户外掩体（先画投影再画本体，压实地面） ---- */
    for(const p of R.props){
      if(p.x>cam.x+vw+120||p.x+p.w<cam.x-120||p.y>cam.y+vh+120||p.y+p.h<cam.y-120) continue;
      this.prop(ctx,p);
    }

    // 围墙（房间墙体；掩体已在上面单独绘制）
    for(const w of R.walls){
      if(w.kind!=="wall") continue;
      if(w.x>cam.x+vw+120||w.x+w.w<cam.x-120||w.y>cam.y+vh+120||w.y+w.h<cam.y-120) continue;
      if(w.dam){
        /* 坝体 —— 混凝土色 + 顶部栏板 + 朝水面一侧的水痕 */
        ctx.fillStyle="#4b545c"; ctx.fillRect(w.x,w.y,w.w,w.h);
        ctx.fillStyle="rgba(200,214,224,0.20)"; ctx.fillRect(w.x,w.y,w.w,6);
        ctx.fillStyle="rgba(10,14,17,0.45)"; ctx.fillRect(w.x,w.y+w.h-7,w.w,7);
        ctx.strokeStyle="rgba(120,170,200,0.30)"; ctx.lineWidth=2;
        for(let sx=w.x+26; sx<w.x+w.w-10; sx+=58){
          ctx.beginPath(); ctx.moveTo(sx,w.y+w.h-4); ctx.lineTo(sx,w.y+w.h-4-Math.min(26,w.h*0.4)); ctx.stroke();
        }
        ctx.strokeStyle="#0b0e10"; ctx.lineWidth=2; ctx.strokeRect(w.x,w.y,w.w,w.h);
        continue;
      }
      ctx.fillStyle="#272d31"; ctx.fillRect(w.x,w.y,w.w,w.h);
      ctx.fillStyle="rgba(170,195,205,0.16)"; ctx.fillRect(w.x,w.y,w.w,4);
      ctx.strokeStyle="#0b0e10"; ctx.lineWidth=2; ctx.strokeRect(w.x,w.y,w.w,w.h);
    }

    // 光照层（探照灯 + 玩家手电），暖色加色叠加，强化荒凉紧张氛围
    this._lightLayer(ctx, game, cam, vw, vh);

    // 撤离点（塔科夫式：关闭=灰、付费=金、开放=绿）
    for(const e of R.extracts){
      const pulse=0.5+0.5*Math.sin(M.now()*3);
      if(e.closed){
        ctx.fillStyle="rgba(90,100,105,0.10)"; ctx.fillRect(e.x,e.y,e.w,e.h);
        ctx.strokeStyle="rgba(150,160,165,0.4)"; ctx.lineWidth=2;
        ctx.setLineDash([10,10]); ctx.strokeRect(e.x,e.y,e.w,e.h); ctx.setLineDash([]);
        ctx.fillStyle="rgba(190,200,205,0.75)"; ctx.font="bold 20px system-ui,sans-serif"; ctx.textAlign="center";
        ctx.fillText("✕ "+e.name, e.x+e.w/2, e.y+e.h/2-6);
        ctx.font="12px system-ui,sans-serif"; ctx.fillStyle="rgba(190,200,205,0.5)";
        ctx.fillText("本局未开放", e.x+e.w/2, e.y+e.h/2+18);
        continue;
      }
      const paid=e.cost>0;
      // 被封锁：整片区域转红并标注，玩家一眼能看到哪条撤离路线不通
      const blockedNow=R.ops.some(o=>o.alive && o.blockZone===e &&
        M.dist(o.x,o.y, e.x+e.w/2, e.y+e.h/2) < 300);
      const col=blockedNow?"255,80,70":(paid?"200,180,80":"90,220,140");
      ctx.fillStyle=`rgba(${col},${0.10+pulse*0.10})`; ctx.fillRect(e.x,e.y,e.w,e.h);
      ctx.strokeStyle=`rgba(${col},${0.5+pulse*0.3})`; ctx.lineWidth=3;
      ctx.setLineDash([14,10]); ctx.strokeRect(e.x,e.y,e.w,e.h); ctx.setLineDash([]);
      ctx.fillStyle=blockedNow?"#ff8a80":(paid?"#e8d48a":"#8fe0a8"); ctx.font="bold 20px system-ui,sans-serif"; ctx.textAlign="center";
      ctx.fillText((blockedNow?"⛔ ":"▲ ")+e.name, e.x+e.w/2, e.y+e.h/2-6);
      ctx.font="12px system-ui,sans-serif"; ctx.fillStyle=`rgba(${col},0.8)`;
      ctx.fillText(blockedNow?"被封锁 · 清除封锁者":(paid?`雇车费 ${raidExtractFee(e, R.carryVal||0)} 卢布（按带入装备）· 坚守 ${e.need} 秒`:`坚守 ${e.need} 秒`), e.x+e.w/2, e.y+e.h/2+18);
    }

    // 局内商店摊位（枪店 / 材料店 / 回收超市 / 黑市）
    for(const s of R.shops){
      if(s.x>cam.x+vw+200||s.x<cam.x-200||s.y>cam.y+vh+200||s.y<cam.y-200) continue;
      const pl=0.5+0.5*Math.sin(M.now()*2.2+s.x*0.013);
      const rgb = s.kind==="black" ? "160,110,235" : s.kind==="rec" ? "70,165,215" : s.kind==="mat" ? "120,210,120" : "225,180,80";
      ctx.save(); ctx.translate(s.x, s.y);
      // 地面光圈：远处也能看出「这里有活人做买卖」
      ctx.fillStyle=`rgba(${rgb},0.10)`;
      ctx.beginPath(); ctx.ellipse(0,14,92,60,0,0,6.2832); ctx.fill();
      ctx.strokeStyle=`rgba(${rgb},${0.20+pl*0.16})`; ctx.lineWidth=2; ctx.setLineDash([12,9]);
      ctx.beginPath(); ctx.ellipse(0,14,92,60,0,0,6.2832); ctx.stroke(); ctx.setLineDash([]);
      // 遮阳棚
      ctx.fillStyle=`rgba(${rgb},0.20)`; ctx.fillRect(-60,-48,120,44);
      ctx.strokeStyle=`rgba(${rgb},0.85)`; ctx.lineWidth=2; ctx.strokeRect(-60,-48,120,44);
      ctx.fillStyle=`rgba(${rgb},0.42)`;
      for(let i=0;i<6;i++) ctx.fillRect(-58+i*20,-46,9,42);
      // 支柱 + 柜台
      ctx.fillStyle="#3a4047"; ctx.fillRect(-56,-2,8,48); ctx.fillRect(48,-2,8,48);
      ctx.fillStyle="#262c33"; ctx.strokeStyle="#0b0e10"; ctx.lineWidth=2;
      ctx.fillRect(-46,22,92,28); ctx.strokeRect(-46,22,92,28);
      // 招牌
      ctx.fillStyle="rgba(6,10,14,0.92)"; ctx.fillRect(-58,-76,116,26);
      ctx.strokeStyle=`rgba(${rgb},0.9)`; ctx.lineWidth=2; ctx.strokeRect(-58,-76,116,26);
      ctx.fillStyle=s.color; ctx.textAlign="center"; ctx.font="bold 14px system-ui,sans-serif";
      ctx.fillText(s.name, 0, -58);
      ctx.font="bold 15px system-ui,sans-serif";
      ctx.fillText(s.kind==="gun"?"⌖":s.kind==="mat"?"▤":s.kind==="rec"?"♻":"◆", 0, 14);
      ctx.restore();
    }

    /* 可互动设施（医疗站 / 弹药箱 / 泄洪闸） */
    for(const g of (R.gadgets||[])){
      if(g.x>cam.x+vw+200||g.x<cam.x-200||g.y>cam.y+vh+200||g.y<cam.y-200) continue;
      const dim = g.used && g.kind!=="dam" && g.kind!=="siren";
      const rgb = g.kind==="med" ? "120,220,140" : g.kind==="ammo" ? "225,190,90"
                : g.kind==="siren" ? "235,130,90" : "110,180,235";
      const pl=0.5+0.5*Math.sin(M.now()*2.6+g.x*0.01);
      ctx.save(); ctx.translate(g.x,g.y);
      ctx.globalAlpha=dim?0.42:1;
      ctx.fillStyle=`rgba(${rgb},0.10)`;
      ctx.beginPath(); ctx.ellipse(0,12,54,34,0,0,6.2832); ctx.fill();
      ctx.strokeStyle=`rgba(${rgb},${0.25+pl*0.30})`; ctx.lineWidth=2; ctx.setLineDash([8,7]);
      ctx.beginPath(); ctx.ellipse(0,12,54,34,0,0,6.2832); ctx.stroke(); ctx.setLineDash([]);
      // 箱体
      ctx.fillStyle=g.kind==="med"?"#dfe6e8":g.kind==="ammo"?"#6a5a34":g.kind==="siren"?"#5a3a2e":"#3b4752";
      ctx.strokeStyle="#0b0e10"; ctx.lineWidth=2;
      ctx.fillRect(-20,-26,40,34); ctx.strokeRect(-20,-26,40,34);
      if(g.kind==="med"){
        ctx.fillStyle="#c93b3b"; ctx.fillRect(-4,-20,8,22); ctx.fillRect(-11,-13,22,8);
      } else if(g.kind==="ammo"){
        ctx.fillStyle="#31280f";
        for(let i=0;i<3;i++) ctx.fillRect(-14+i*11,-20,7,22);
      } else if(g.kind==="siren"){
        // 喇叭：梯形 + 声波弧
        ctx.fillStyle="#e8a06a";
        ctx.beginPath(); ctx.moveTo(-12,-18); ctx.lineTo(2,-24); ctx.lineTo(2,-4); ctx.lineTo(-12,-10); ctx.closePath(); ctx.fill();
        ctx.strokeStyle="#e8a06a"; ctx.lineWidth=2;
        for(let r=4;r<=10;r+=4){ ctx.beginPath(); ctx.arc(4,-14,r,-0.9,0.9); ctx.stroke(); }
      } else {
        ctx.strokeStyle= dim?"#6f8290":"#9fd0ef"; ctx.lineWidth=3;
        ctx.beginPath(); ctx.arc(0,-9,10,0,6.2832); ctx.stroke();
        for(let i=0;i<4;i++){ const a=i*1.5708;
          ctx.beginPath(); ctx.moveTo(0,-9); ctx.lineTo(Math.cos(a)*10,-9+Math.sin(a)*10); ctx.stroke(); }
        // 闸门状态灯
        ctx.fillStyle=R.damOpen?"#62c8ff":"#ff8a5a";
        ctx.beginPath(); ctx.arc(0,2,4,0,6.2832); ctx.fill();
      }
      ctx.globalAlpha=1;
      ctx.textAlign="center"; ctx.font="bold 12px system-ui,sans-serif";
      ctx.fillStyle=dim?"rgba(180,190,190,0.6)":`rgb(${rgb})`;
      const cdLeft=g.kind==="siren" ? Math.max(0, Math.ceil(((g.cdUntil||0)-M.now())/1000)) : 0;
      const glabel = g.kind==="dam" ? (R.damOpen?"泄洪闸 · 已开":"泄洪闸 · 已关")
                   : g.kind==="siren" ? (cdLeft>0?g.label+" · "+cdLeft+"s":g.label)
                   : (g.label+(dim?"（已用）":""));
      ctx.fillText(glabel, 0, -36);
      ctx.restore();
    }

    // 房间名
    ctx.textAlign="center"; ctx.font="bold 17px system-ui,sans-serif";    for(const rm of R.roomRects){
      if(rm.extract) continue;
      if(rm.x>cam.x+vw||rm.x+rm.w<cam.x||rm.y>cam.y+vh||rm.y+rm.h<cam.y) continue;
      ctx.fillStyle="rgba(210,222,235,0.30)";
      ctx.font="bold 15px system-ui,sans-serif";
      ctx.fillText(rm.name, rm.x+rm.w/2, rm.y+rm.h-14);
    }

    // 地面物品堆（背包满时溢出落地，腾出空间后可回来捡）
    if(R.grounds){
      for(const g of R.grounds){
        if(g.searched) continue;
        if(g.x>cam.x+vw+60||g.x<cam.x-60||g.y>cam.y+vh+60||g.y<cam.y-60) continue;
        const n=(g.drops||[]).length;
        ctx.save(); ctx.translate(g.x, g.y);
        const pulse=0.5+0.5*Math.sin(M.now()/300);
        // 地面光晕
        ctx.globalAlpha=0.10+0.14*pulse;
        ctx.fillStyle="#ffd98a";
        ctx.beginPath(); ctx.arc(0,0,26,0,6.2832); ctx.fill();
        ctx.globalAlpha=1;
        // 散落的三件小包裹
        ctx.fillStyle="rgba(0,0,0,0.30)";
        ctx.beginPath(); ctx.ellipse(0,6,19,8,0,0,6.2832); ctx.fill();
        const cols=["#7d6a45","#6b5a3c","#8d7851"];
        for(let i=0;i<3;i++){
          const a=i*2.15+0.4, rr=7+i*3;
          const bx=Math.cos(a)*rr-4.5, by=Math.sin(a)*rr*0.6-3.5;
          ctx.fillStyle=cols[i];
          ctx.fillRect(bx,by,10,8);
          ctx.strokeStyle="rgba(232,202,132,0.95)"; ctx.lineWidth=1.2;
          ctx.strokeRect(bx,by,10,8);
        }
        // 上浮的小箭头（提示可拾取）
        ctx.globalAlpha=0.45+0.4*pulse;
        ctx.fillStyle="#ffe08a"; ctx.textAlign="center";
        ctx.font="bold 12px system-ui,sans-serif";
        ctx.fillText("▲", 0, -12);
        ctx.globalAlpha=1;
        ctx.fillStyle="#ffe08a"; ctx.font="bold 11px system-ui,sans-serif";
        ctx.fillText("×"+n, 0, 22);
        ctx.restore();
      }
    }

    // 补给箱
    for(const c of R.containers){
      if(c.x>cam.x+vw+80||c.x<cam.x-80||c.y>cam.y+vh+80||c.y<cam.y-80) continue;
      const s=13;
      if(c.body){
        // 尸体：暗红色
        ctx.save(); ctx.translate(c.x,c.y);
        ctx.fillStyle=c.searched?"#3a2a2a":"#5a3030"; ctx.beginPath(); ctx.ellipse(0,0,s*0.9,s*0.6,0.6,0,6.28); ctx.fill();
        ctx.restore();
        continue;
      }
      ctx.save(); ctx.translate(c.x,c.y); ctx.rotate(0.2);
      // 箱子按类型着色：武器(橙) / 护甲(蓝) / 医疗(绿) / 杂项(棕) / 上锁保险箱(按保险等级 I~V)
      let col;
      const lv=c.locked?M.clamp(c.lockLv||1,1,5):0;
      if(c.searched) col="#3a3a30";
      else if(c.locked) col=raidKeyDef(lv).color;
      else if(c.kind==="weapon") col="#c07a33";
      else if(c.kind==="armor") col="#3d7ba8";
      else if(c.kind==="medical") col="#4a9a55";
      else col="#5f5238";
      ctx.fillStyle=col; ctx.fillRect(-s,-s*0.7,s*2,s*1.4);
      ctx.strokeStyle="#0a0c0d"; ctx.lineWidth=2; ctx.strokeRect(-s,-s*0.7,s*2,s*1.4);
      ctx.fillStyle="rgba(0,0,0,0.28)"; ctx.fillRect(-s,-s*0.7,s*2,s*0.3);
      // 上锁箱：横跨箱体的锁扣 + 等级罗马数字（未搜过才亮）
      if(c.locked && !c.searched){
        ctx.rotate(-0.2);
        ctx.fillStyle="rgba(10,14,18,0.9)";
        ctx.fillRect(-13,-6,26,11);
        ctx.strokeStyle=col; ctx.lineWidth=1.6; ctx.strokeRect(-13,-6,26,11);
        ctx.fillStyle=col; ctx.textAlign="center"; ctx.font="bold 11px system-ui,sans-serif";
        ctx.fillText(RAID_ROMAN[lv]||lv, 0, 4);
        // 锁鼻
        ctx.strokeStyle=col; ctx.lineWidth=2;
        ctx.beginPath(); ctx.arc(0,-11,5,Math.PI,0); ctx.stroke();
      }
      ctx.restore();
    }

    // 玩家搜索高亮
    if(R.search){
      const c=R.search.c;
      const t=M.clamp(R.search.t/Math.max(0.01, R._searchNeed(c)), 0, 1);
      ctx.strokeStyle="rgba(120,220,255,0.9)"; ctx.lineWidth=4;
      ctx.beginPath(); ctx.arc(c.x,c.y,20,-Math.PI/2,-Math.PI/2+t*6.2832); ctx.stroke();
    }

    // PMC
    for(const o of R.ops){
      if(!o.alive) continue;
      if(o.x>cam.x+vw+60||o.x<cam.x-60||o.y>cam.y+vh+60||o.y<cam.y-60) continue;
      this.unit(ctx, o, game);
    }

    // 涉水涟漪（任何踩在河里的单位脚下都有一圈扩散水波）
    for(const o of R.ops){
      if(!o.alive || !o._wet) continue;
      if(o.x>cam.x+vw+60||o.x<cam.x-60||o.y>cam.y+vh+60||o.y<cam.y-60) continue;
      for(let k=0;k<2;k++){
        const t=((M.now()/850)+k*0.5+o.x*0.011)%1;
        ctx.strokeStyle=`rgba(165,225,245,${(0.6*(1-t)).toFixed(3)})`; ctx.lineWidth=2;
        ctx.beginPath(); ctx.ellipse(o.x, o.y+o.r*0.6, 10+t*26, 5+t*11, 0, 0, 6.2832); ctx.stroke();
      }
    }

    // 火箭弹：尾焰 + 弹体
    for(const rk of R.rockets){
      const bx=rk.x-Math.cos(rk.ang)*8, by=rk.y-Math.sin(rk.ang)*8;
      ctx.save(); ctx.lineCap="round";
      ctx.strokeStyle=rgba("#ff9a1f",0.55); ctx.lineWidth=5;
      ctx.beginPath(); ctx.moveTo(bx-Math.cos(rk.ang)*16, by-Math.sin(rk.ang)*16); ctx.lineTo(bx,by); ctx.stroke();
      ctx.strokeStyle=rgba("#ffe08a",0.85); ctx.lineWidth=2;
      ctx.beginPath(); ctx.moveTo(bx-Math.cos(rk.ang)*9, by-Math.sin(rk.ang)*9); ctx.lineTo(bx,by); ctx.stroke();
      ctx.restore();
      ctx.save(); ctx.translate(rk.x,rk.y); ctx.rotate(rk.ang);
      ctx.fillStyle="#c9d1da"; ctx.fillRect(-7,-3,13,6);
      ctx.fillStyle=rk.color||"#ffb020"; ctx.beginPath(); ctx.moveTo(10,0); ctx.lineTo(5,-3.2); ctx.lineTo(5,3.2); ctx.closePath(); ctx.fill();
      ctx.strokeStyle="#0d0a07"; ctx.lineWidth=1; ctx.strokeRect(-7,-3,13,6);
      ctx.restore();
    }
    // 爆炸冲击环
    for(const bl of R.blasts){
      const k=1-bl.life/bl.maxLife;
      ctx.globalAlpha=Math.max(0,1-k);
      ctx.strokeStyle="#ffb020"; ctx.lineWidth=4;
      ctx.beginPath(); ctx.arc(bl.x,bl.y, bl.r + k*bl.r*1.8, 0, 6.2832); ctx.stroke();
      ctx.globalAlpha=1;
    }

    // 弹头渲染：实体弹丸 + 曳光尾迹
    for(const tr of R.tracers){
      const al=M.clamp(tr.life/(tr.maxLife||0.08),0,1);
      if(tr.laser){
        ctx.globalAlpha=al; ctx.lineCap="round";
        ctx.strokeStyle=rgba(tr.color,0.28); ctx.lineWidth=6;
        ctx.beginPath(); ctx.moveTo(tr.x1,tr.y1); ctx.lineTo(tr.x2,tr.y2); ctx.stroke();
        ctx.shadowColor=tr.color; ctx.shadowBlur=9;
        ctx.strokeStyle=tr.color; ctx.lineWidth=2.6;
        ctx.beginPath(); ctx.moveTo(tr.x1,tr.y1); ctx.lineTo(tr.x2,tr.y2); ctx.stroke();
        ctx.shadowBlur=0; ctx.strokeStyle="rgba(255,255,255,0.9)"; ctx.lineWidth=1.1;
        ctx.beginPath(); ctx.moveTo(tr.x1,tr.y1); ctx.lineTo(tr.x2,tr.y2); ctx.stroke();
        ctx.globalAlpha=1;
      } else {
        const bx=tr.bx!==undefined?tr.bx:tr.x1, by=tr.by!==undefined?tr.by:tr.y1;
        const ang=Math.atan2(tr.y2-tr.y1, tr.x2-tr.x1);
        const dist=Math.hypot(tr.x2-tr.x1, tr.y2-tr.y1);
        const tl=Math.min(88, Math.max(26, dist*0.5));
        Render.tracerStreak(ctx, bx, by, bx-Math.cos(ang)*tl, by-Math.sin(ang)*tl, tr.color, 2.4, al);
        ctx.save(); ctx.globalAlpha=al; ctx.translate(bx,by); ctx.rotate(ang);
        Render.bulletShape(ctx, tr.shape||"round", 4.2, tr.color);
        ctx.restore(); ctx.globalAlpha=1;
      }
    }

    // 粒子
    for(const q of R.particles){ ctx.globalAlpha=M.clamp(q.life/q.maxLife,0,1); ctx.fillStyle=q.color; ctx.fillRect(q.x-q.size/2,q.y-q.size/2,q.size,q.size); }
    ctx.globalAlpha=1;

    // 飘字
    ctx.textAlign="center"; ctx.font="bold 13px system-ui,sans-serif";
    for(const f of R.floats){ ctx.globalAlpha=M.clamp(f.life/f.maxLife,0,1); ctx.fillStyle=f.color; ctx.fillText(f.text,f.x,f.y); }
    ctx.globalAlpha=1;

    // 桌面准星
    if(!Input.isTouch){
      const w=R._screenToWorld(Input.mouse.sx,Input.mouse.sy,game);
      ctx.strokeStyle="rgba(255,255,255,0.75)"; ctx.lineWidth=1.5;
      ctx.beginPath(); ctx.arc(w.x,w.y,7,0,6.28); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(w.x-12,w.y); ctx.lineTo(w.x-4,w.y); ctx.moveTo(w.x+4,w.y); ctx.lineTo(w.x+12,w.y); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(w.x,w.y-12); ctx.lineTo(w.x,w.y-4); ctx.moveTo(w.x,w.y+4); ctx.lineTo(w.x,w.y+12); ctx.stroke();
    }
  },

  /* 2D 俯视角的手持武器平面模型（v0.19.3）
   *   以前 2D 只在单位中心画一条「枪线」，看不出手里拿的是什么；这里按枪型画出
   *   枪托 / 机匣 / 弹匣 / 枪管 / 瞄具，画在角色「右手」的位置并随朝向旋转。
   *   空手（跑刀）画战术匕首 —— 跑刀流也能一眼认出来。
   *   局部坐标：+x = 朝向，握把在原点，单位是世界像素，最后按 r/15 缩放。 */
  handWeapon(ctx, o, r){
    const k = r/15, ang = o.angle||0;
    const ca = Math.cos(ang), sa = Math.sin(ang);
    // 右手：身体右前方（屏幕 y 向下时，(-sin, cos) 就是角色自己的右手边）
    ctx.save();
    ctx.translate(o.x + ca*r*0.40 - sa*r*0.90, o.y + sa*r*0.40 + ca*r*0.90);
    ctx.rotate(ang);
    ctx.scale(k, k);
    const dark = "#1d2228", mid = "#333a42", edge = "#0a0d10";
    const g = o.gun;
    if(!g){
      /* 战术匕首 */
      ctx.fillStyle = mid; ctx.strokeStyle = edge; ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(3,-2.4); ctx.lineTo(23,-0.8); ctx.lineTo(25,0); ctx.lineTo(23,0.8); ctx.lineTo(3,2.4);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#93a0ac"; ctx.fillRect(4.5, 0.7, 17, 0.9);     // 刃口
      ctx.fillStyle = dark;  ctx.fillRect(-1.6,-4.4, 3.4, 8.8);       // 护手
      ctx.fillStyle = "#3b3f45"; ctx.fillRect(-8.6,-2.2, 7, 4.4);     // 握柄
      ctx.fillStyle = "#12151a"; ctx.fillRect(-8.6,-2.2, 1.4, 4.4);
      ctx.restore(); return;
    }
    const S = {
      pistol:  { body:9,  bh:5.0, bar:4,  mag:0,  stock:0,  scope:0, mw:2.2 },
      smg:     { body:15, bh:5.2, bar:6,  mag:7,  stock:0,  scope:0, mw:2.0 },
      shotgun: { body:19, bh:5.4, bar:12, mag:0,  stock:6,  scope:0, mw:2.6 },
      rifle:   { body:18, bh:5.4, bar:12, mag:8,  stock:8,  scope:1, mw:2.0 },
      sniper:  { body:20, bh:5.2, bar:17, mag:5,  stock:9,  scope:1, mw:1.7 },
      launcher:{ body:20, bh:7.0, bar:6,  mag:0,  stock:0,  scope:0, mw:3.4 },
    }[g.type] || { body:15, bh:5.2, bar:8, mag:6, stock:5, scope:0, mw:2.0 };
    const acc = raidGunColor(g);
    const el = (g.element && g.element!=="none" && ELEMENTS[g.element]) ? ELEMENTS[g.element].color : null;
    ctx.strokeStyle = edge; ctx.lineWidth = 1;
    // 枪托（在握把之后）
    if(S.stock){
      ctx.fillStyle = dark;
      ctx.beginPath();
      ctx.moveTo(-1, -S.bh*0.45); ctx.lineTo(-1-S.stock, -S.bh*0.62);
      ctx.lineTo(-1-S.stock, S.bh*0.62); ctx.lineTo(-1, S.bh*0.45);
      ctx.closePath(); ctx.fill(); ctx.stroke();
    }
    // 机匣
    ctx.fillStyle = mid;
    ctx.fillRect(-1, -S.bh/2, S.body, S.bh);
    ctx.strokeRect(-1, -S.bh/2, S.body, S.bh);
    // 品质色装饰条（和物品栏、浮字同一个颜色体系）
    ctx.fillStyle = acc; ctx.globalAlpha = 0.85;
    ctx.fillRect(S.body*0.22, -S.bh/2+0.6, S.body*0.5, 1.1);
    ctx.globalAlpha = 1;
    // 弹匣
    if(S.mag){
      ctx.fillStyle = dark;
      ctx.fillRect(S.body*0.30, S.bh/2, 3.2, S.mag);
      ctx.strokeRect(S.body*0.30, S.bh/2, 3.2, S.mag);
    }
    // 枪管
    ctx.fillStyle = "#2a3037";
    ctx.fillRect(S.body-1, -S.mw/2, S.bar+1, S.mw);
    ctx.strokeRect(S.body-1, -S.mw/2, S.bar+1, S.mw);
    if(el){                                   // 元素枪：枪口一圈发光
      ctx.fillStyle = el; ctx.globalAlpha = 0.9;
      ctx.fillRect(S.body+S.bar-1.6, -S.mw/2-0.4, 1.8, S.mw+0.8);
      ctx.globalAlpha = 1;
    }
    // 瞄具
    if(S.scope && (g.parts||[]).some(p=>p.slot==="optic")){
      ctx.fillStyle = "#141a20";
      ctx.fillRect(S.body*0.34, -S.bh/2-2.1, 5.5, 2.1);
      ctx.fillStyle = "#ffd23f";
      ctx.fillRect(S.body*0.34+0.8, -S.bh/2-1.7, 1.1, 1.1);
    }
    ctx.restore();
  },

  unit(ctx, o, game){
    const r=o.r;
    // v0.14.10：血条颜色 = 目标护甲类型（血肉红 / 护盾蓝 / T4+ 装甲黄）
    const at=raidArmorType(o), atCol=ARMOR_TYPE_COLOR[at]||ARMOR_TYPE_COLOR.flesh;
    // 阴影
    ctx.beginPath(); ctx.ellipse(o.x,o.y+r*0.5,r*0.95,r*0.5,0,0,6.2832); ctx.fillStyle="rgba(0,0,0,0.32)"; ctx.fill();
    /* 玩家 / 队友：画真正的手持武器模型（枪型 / 品质色 / 元素枪口 / 瞄具，
     * 空手则是战术匕首）；远处 AI 保留廉价的「枪线」，几十个单位不必每个都描一遍细节。 */
    if(o.isPlayer || o.remote){
      this.handWeapon(ctx, o, r);
    } else {
      // 枪（随枪型长度 / 弹种颜色变化，瞄具配件额外描金点）
      const GUN_LEN={pistol:r+10,smg:r+14,shotgun:r+18,rifle:r+20,sniper:r+30,launcher:r+16};
      const g=o.gun; const gLen=(g&&GUN_LEN[g.type])||(r+14);
      const gCol=(g&&g.element!=="none"&&ELEMENTS[g.element])?ELEMENTS[g.element].color:"#2a2f35";
      const gx=Math.cos(o.angle), gy=Math.sin(o.angle);
      ctx.lineCap="round";
      ctx.strokeStyle="#16191e"; ctx.lineWidth=5.5;
      ctx.beginPath(); ctx.moveTo(o.x,o.y); ctx.lineTo(o.x+gx*gLen, o.y+gy*gLen); ctx.stroke();
      ctx.strokeStyle=gCol; ctx.lineWidth=2.4;
      ctx.beginPath(); ctx.moveTo(o.x,o.y); ctx.lineTo(o.x+gx*gLen, o.y+gy*gLen); ctx.stroke();
      if(g && (g.parts||[]).some(p=>p.slot==="optic")){
        ctx.fillStyle="#ffd23f"; ctx.beginPath(); ctx.arc(o.x+gx*gLen*0.42, o.y+gy*gLen*0.42, 2.2,0,6.28); ctx.fill();
      }
    }
    // 身体
    ctx.beginPath(); ctx.arc(o.x,o.y,r,0,6.2832);
    ctx.fillStyle=o.color; ctx.fill();
    ctx.lineWidth=3; ctx.strokeStyle=(o.isPlayer||o.remote)?"#0a2a33":"#0d0a07"; ctx.stroke();
    // v0.14.10：装甲型单位一圈黄色描边，和黄色血条呼应
    if(at==="armor"){
      ctx.beginPath(); ctx.arc(o.x,o.y,r+2,0,6.2832);
      ctx.strokeStyle="rgba(255,210,63,0.60)"; ctx.lineWidth=2; ctx.stroke();
    }
    // v0.14.10：冰冻呈现 —— 半透明冰霜覆层 + 冰蓝外环 + 六向冰晶
    if(o.freezeT>0){
      const fa=M.clamp(o.freezeT/2.8,0,1);
      ctx.save();
      ctx.globalAlpha=0.22+0.26*fa; ctx.fillStyle="#8fe4ff";
      ctx.beginPath(); ctx.arc(o.x,o.y,r+1,0,6.2832); ctx.fill();
      ctx.globalAlpha=0.55+0.35*fa; ctx.strokeStyle="#bdefff"; ctx.lineWidth=2;
      ctx.beginPath(); ctx.arc(o.x,o.y,r+4,0,6.2832); ctx.stroke();
      ctx.lineWidth=1.4;
      for(let k=0;k<6;k++){
        const a2=k*Math.PI/3+o.freezeT*0.6;
        const cx=o.x+Math.cos(a2)*(r+4), cy=o.y+Math.sin(a2)*(r+4);
        ctx.beginPath();
        ctx.moveTo(cx-Math.cos(a2)*4, cy-Math.sin(a2)*4);
        ctx.lineTo(cx+Math.cos(a2)*4, cy+Math.sin(a2)*4);
        ctx.stroke();
      }
      ctx.restore();
    }
    /* v0.14.11：四种元素持续状态的可视化（不看血条也能知道身上挂了什么） */
    if(o.burnT>0){
      const t=o.burnT;
      ctx.save(); ctx.globalAlpha=0.55;
      ctx.strokeStyle="#ff7a1f"; ctx.lineWidth=2;
      ctx.beginPath(); ctx.arc(o.x,o.y,r+6,0,6.2832); ctx.stroke();
      for(let k=0;k<3;k++){
        const a2=k*2.094+t*2.1;
        const h=6+((t*7+k*3)%9);
        ctx.fillStyle=k%2?"#ffd23f":"#ff5a1f";
        ctx.beginPath(); ctx.arc(o.x+Math.cos(a2)*(r*0.6), o.y+Math.sin(a2)*(r*0.6)-h, 2.4,0,6.28); ctx.fill();
      }
      ctx.restore();
    }
    if(o.corrodeT>0){
      ctx.save(); ctx.globalAlpha=0.7; ctx.strokeStyle="#7bff3a"; ctx.lineWidth=2;
      ctx.setLineDash([3,4]); ctx.lineDashOffset=-o.corrodeT*10;
      ctx.beginPath(); ctx.arc(o.x,o.y,r+8,0,6.2832); ctx.stroke();
      ctx.setLineDash([]); ctx.restore();
    }
    if(o.shockT>0){
      ctx.save(); ctx.globalAlpha=0.8; ctx.strokeStyle="#7be3ff"; ctx.lineWidth=1.6;
      for(let k=0;k<3;k++){
        const a2=k*2.094+o.shockT*3;
        ctx.beginPath();
        ctx.moveTo(o.x+Math.cos(a2)*(r+2),o.y+Math.sin(a2)*(r+2));
        ctx.lineTo(o.x+Math.cos(a2+0.25)*(r+10),o.y+Math.sin(a2+0.25)*(r+10));
        ctx.stroke();
      }
      ctx.restore();
    }
    if(o.radT>0){
      ctx.save(); ctx.globalAlpha=0.45; ctx.strokeStyle="#c8ff32"; ctx.lineWidth=2;
      ctx.beginPath(); ctx.arc(o.x,o.y,r+11-o.radT*5,0,6.2832); ctx.stroke(); ctx.restore();
    }
    if(o.isPlayer||o.remote){
      ctx.beginPath(); ctx.arc(o.x,o.y,r+4,0,6.2832);
      ctx.strokeStyle=o.remote?"rgba(126,224,138,0.9)":"rgba(79,214,255,0.85)"; ctx.lineWidth=2; ctx.stroke();
    }
    if(o.bounty){
      // Boss：金色外环 + 脉冲星标
      ctx.beginPath(); ctx.arc(o.x,o.y,r+6,0,6.2832); ctx.strokeStyle="#ffd23f"; ctx.lineWidth=2.5; ctx.stroke();
      ctx.fillStyle="#ffd23f"; ctx.font="bold 14px system-ui,sans-serif"; ctx.textAlign="center";
      ctx.fillText("★", o.x, o.y-r-20);
    }
    // 朝向眼
    ctx.fillStyle="#fff";
    const ex=Math.cos(o.angle)*r*0.4, ey=Math.sin(o.angle)*r*0.4;
    ctx.beginPath(); ctx.arc(o.x+ex,o.y+ey,r*0.22,0,6.28); ctx.fill();
    // 名字 + 血条（v0.14.10：名字后缀标注护甲类型，血条按类型着色）
    const atTag=(at!=="flesh")?(" ·"+ARMOR_TYPE_NAME[at]):"";
    if(o.remote){
      ctx.font="bold 11px system-ui,sans-serif"; ctx.textAlign="center";
      ctx.fillStyle="#8fe0a0";
      ctx.fillText("◈ "+(o.name||"队友")+atTag, o.x, o.y-r-10);
      if(!o.alive){
        ctx.fillStyle="rgba(255,120,120,0.9)"; ctx.font="bold 10px system-ui,sans-serif";
        ctx.fillText("已阵亡", o.x, o.y-r-22);
      }
    } else if(!o.isPlayer){
      ctx.font="11px system-ui,sans-serif"; ctx.textAlign="center";
      ctx.fillStyle=o.smart?"rgba(255,210,63,0.92)":"rgba(255,190,190,0.85)";
      ctx.fillText(o.name+atTag, o.x, o.y-r-8);
      if(o.state==="loot"){
        ctx.font="bold 9px system-ui,sans-serif"; ctx.fillStyle="#8fe07a";
        ctx.fillText("搜刮中", o.x, o.y-r-(o.bounty?42:24));
      }
    }
    const w=40;
    ctx.fillStyle="rgba(0,0,0,0.55)"; ctx.fillRect(o.x-w/2-1,o.y-r-6,w+2,5);
    // 血肉型保留阵营色；装甲 / 护盾型覆盖为类型色（黄 / 蓝），旁边补一个类型色方块
    // v0.16.0：血条恒为生命色（玩家 / AI 都是红系），只有「装甲型」保留黄色类型色；
    // 蓝色只用于上方那条独立护盾条，避免把血条本身染成「蓝血条」。
    const hpCol=(at==="armor")?atCol:(o.remote?"#7ee08a":"#d8564a");
    ctx.fillStyle=hpCol; ctx.fillRect(o.x-w/2,o.y-r-5.5,w*M.clamp(o.hp/o.maxHP,0,1),4);
    if(at!=="flesh"){ ctx.fillStyle=atCol; ctx.fillRect(o.x+w/2+3, o.y-r-5.5, 4, 4); }
    if(o.maxArmor>0){
      ctx.fillStyle="rgba(120,180,255,0.85)"; ctx.fillRect(o.x-w/2,o.y-r-10.5,w*M.clamp(o.armor/o.maxArmor,0,1),3);
    }
    // v0.16.0：护盾条（青蓝）画在护甲条 / 血条之上，三层防护一眼可读
    if(o.maxShield>0){
      ctx.fillStyle="rgba(0,0,0,0.5)"; ctx.fillRect(o.x-w/2-1,o.y-r-15.5,w+2,5);
      ctx.fillStyle="rgba(79,214,255,0.92)"; ctx.fillRect(o.x-w/2,o.y-r-14.5,w*M.clamp((o.shield||0)/o.maxShield,0,1),3);
    }
    if((o.shieldInvuln||0)>0){
      ctx.strokeStyle="rgba(150,230,255,"+(0.45+0.35*Math.sin(M.now()*14)).toFixed(2)+")";
      ctx.lineWidth=2; ctx.beginPath(); ctx.arc(o.x,o.y,o.r+7,0,6.28); ctx.stroke();
    }
    const tags=[];
    if(o.freezeT>0)  tags.push({t:"迟滞",c:"#bdefff"});
    if(o.burnT>0)    tags.push({t:"引燃",c:"#ff8a3a"});
    if(o.corrodeT>0) tags.push({t:"撕裂",c:"#9bff5a"});
    if(o.shockT>0)   tags.push({t:"失能",c:"#7be3ff"});
    if(tags.length){
      ctx.font="bold 9px system-ui,sans-serif"; ctx.textAlign="center";
      const line=tags.map(x=>x.t).join("·");
      ctx.fillStyle=tags[0].c; ctx.fillText(line, o.x, o.y+r+12);
    }
  },

  /* ----------------------------- HUD ----------------------------- */
  hud(ctx, game, v){
    const R=Raid, p=R.player;
    if(!p) return;
    const mob=!!Input.isTouch;      // 手机端：HUD 让位给右下触屏按钮，避免重叠

    // 受击红晕
    if(R.hitFlash>0){
      ctx.fillStyle=`rgba(200,30,30,${R.hitFlash*0.5})`; ctx.fillRect(0,0,v.w,v.h);
    }

    /* --- 左上角击杀提示 --- */
    ctx.textAlign="left";
    ctx.font=mob?"bold 11px system-ui,sans-serif":"bold 13px system-ui,sans-serif";
    // 手机端信息流从 Boss 行下面开始（原来 y=58 与 Boss 提示直接压在一起），
    // 并按可用宽度截断，避免长句冲出屏幕、盖住右侧战况面板。
    let y=mob?86:18;
    const feedMax=(mob? v.w*0.58 : v.w*0.46)-30;
    const fit=(t)=>{
      if(ctx.measureText(t).width<=feedMax) return t;
      let lo=0, hi=t.length;
      while(lo<hi){ const mid=(lo+hi+1)>>1; if(ctx.measureText(t.slice(0,mid)+"…").width<=feedMax) lo=mid; else hi=mid-1; }
      return t.slice(0,lo)+"…";
    };
    for(const k of R.killfeed){
      const alpha=M.clamp(k.t/6,0,1);
      ctx.globalAlpha=alpha;
      let text;
      if(k.type==="extract") text=`${k.a}  已撤离`;
      else if(k.type==="info") text=`${k.a} · ${k.v}`;
      else if(k.type==="warn") text=`⚠ ${k.v}`;
      else text=`${k.a}  ▸  ${k.v}`;
      text=fit(text);
      const col = k.mine ? "#ffd23f" : (k.type==="warn"?"#ff8a5a":k.type==="info"?"#8fd0ff":"#cfd8e2");
      // 背景条
      let w=ctx.measureText(text).width + (k.type==="kill"? 62:16);
      if(mob) w=Math.min(w, v.w-24);
      ctx.fillStyle="rgba(8,12,16,0.55)";
      ctx.beginPath(); ctx.roundRect? ctx.roundRect(12,y-13,w,20,5) : ctx.rect(12,y-13,w,20); ctx.fill();
      ctx.fillStyle=col;
      ctx.fillText(text, 20, y+2);
      if(k.type==="kill" && k.gun){
        ctx.fillStyle="rgba(150,170,190,0.8)"; ctx.font="11px system-ui,sans-serif";
        ctx.fillText(`[${k.gun}]`, 12+w-58, y+2);
        ctx.font="bold 13px system-ui,sans-serif";
      }
      ctx.globalAlpha=1;
      y+=24;
    }

    // Boss 存活数（顶部居中偏下提示）
    const bountyN=R.ops.filter(o=>o.alive && o.bounty).length;
    if(bountyN>0){
      ctx.textAlign="center"; ctx.font=mob?"bold 11px system-ui,sans-serif":"bold 12px system-ui,sans-serif";
      ctx.fillStyle="#ffd23f";
      // 避免和左侧信息流叠在一起：信息流每行 24px，Boss 行随之下移
      const by=Math.max(mob?62:66, (mob?86:18)+Math.min(4,R.killfeed.length)*24);
      ctx.fillText(`★ Boss ×${bountyN}（击杀保底 3 件稀有+ 战利品）`, v.w/2, by);
    }

    /* --- 顶部计时 --- */
    const mm=Math.floor(R.timer/60), ss=Math.floor(R.timer%60);
    ctx.textAlign="center"; ctx.font=mob?"bold 21px system-ui,sans-serif":"bold 26px system-ui,sans-serif";
    ctx.fillStyle=R.timer<=60?"#ff6a5a":"#e8eef4";
    ctx.fillText(`${mm}:${ss<10?"0":""}${ss}`, v.w/2, mob?26:38);
    ctx.font=mob?"9px system-ui,sans-serif":"11px system-ui,sans-serif";
    ctx.fillStyle="rgba(180,195,210,0.75)";
    ctx.fillText("剩余撤离时间", v.w/2, mob?40:54);

    /* --- 右上角状态 --- */
    const lootN=R.inv.weapons.length+R.inv.armors.length+R.inv.helmets.length+(R.inv.shields||[]).length+R.inv.parts.length;
    const capN=RAID_INV_CAP.weapons+RAID_INV_CAP.armors+RAID_INV_CAP.helmets+RAID_INV_CAP.shields+RAID_INV_CAP.parts;
    const mateN=(R.online && typeof Net!=="undefined") ? Net.peers.size : 0;
    if(mob){
      // 手机：暂停键在右上角，状态文字下移到它下面一行
      ctx.textAlign="right"; ctx.font="bold 12px system-ui,sans-serif";
      ctx.fillStyle="#cfd8e2"; ctx.fillText(`在场 ${R.aliveFoes()+1+mateN}`, v.w-12, 70);
      ctx.fillStyle="#8fe07a"; ctx.fillText(`₽ ${R.creds}`, v.w-12, 86);
      ctx.fillStyle=lootN>=capN?"#ff8a5a":"#c9a13a"; ctx.fillText(`物品栏 ${lootN}/${capN}`, v.w-12, 102);
      if(mateN){
        ctx.font="bold 10px system-ui,sans-serif"; ctx.fillStyle="#7ee08a";
        ctx.fillText(`联机 ${Net.code} · 队友 ${mateN}`, v.w-12, 118);
      }
    } else {
      ctx.textAlign="right"; ctx.font="bold 14px system-ui,sans-serif";
      ctx.fillStyle="#cfd8e2";
      ctx.fillText(`在场 ${R.aliveFoes()+1+mateN} 人`, v.w-20, 30);
      ctx.fillStyle="#8fe07a";
      ctx.fillText(`₽ ${R.creds}`, v.w-20, 50);
      ctx.fillStyle=lootN>=capN?"#ff8a5a":"#c9a13a";
      ctx.fillText(`物品栏 ${lootN}/${capN}`, v.w-20, 70);
      if(mateN){
        ctx.font="bold 11px system-ui,sans-serif"; ctx.fillStyle="#7ee08a";
        ctx.fillText(`联机 ${Net.code} · 队友 ${mateN}`, v.w-20, 90);
      }
    }

    /* --- 底部状态（手机版整体上移 + 收窄，让开右下触屏键） --- */
    const bx=mob?14:24, by=mob?(v.h-214):(v.h-92), bw=mob?Math.min(150,v.w*0.42):220;
    // 生命
    ctx.textAlign="left";
    // v0.16.0：独立蓝色护盾条画在血条「上方」，血条本身保持红色 —— 不是把血条染蓝
    if(p.maxShield>0){
      ctx.fillStyle="rgba(0,0,0,0.5)"; ctx.fillRect(bx,by-18,bw,12);
      ctx.fillStyle=(p.shieldInvuln>0)?"#bdefff":"#4fd6ff";
      ctx.fillRect(bx,by-18,bw*M.clamp((p.shield||0)/p.maxShield,0,1),12);
      ctx.fillStyle="#04141a"; ctx.font="bold 10px system-ui,sans-serif";
      ctx.fillText(`护盾 ${Math.ceil(p.shield)} / ${Math.round(p.maxShield)}${p.shieldInvuln>0?" · 无敌":""}`, bx+8, by-9);
    }
    ctx.font="bold 12px system-ui,sans-serif";
    ctx.fillStyle="rgba(0,0,0,0.5)"; ctx.fillRect(bx,by,bw,16);
    ctx.fillStyle=p.bleed>0?"#ff8a5a":"#d8564a"; ctx.fillRect(bx,by,bw*M.clamp(p.hp/p.maxHP,0,1),16);
    ctx.fillStyle="#04141a"; ctx.fillText(`生命 ${Math.ceil(p.hp)} / ${p.maxHP}`, bx+8, by+12);
    // 护甲
    if(p.maxArmor>0){
      ctx.fillStyle="rgba(0,0,0,0.5)"; ctx.fillRect(bx,by+20,bw,12);
      // v0.16.0：护甲条改琥珀 / 黄色，蓝色只留给上方那条独立护盾条，避免两条蓝条混淆
      ctx.fillStyle=(p.armorTier>=RAID_ARMOR_TYPE_TIER && p.armor>0)?"#ffd23f":"#d8b26a"; ctx.fillRect(bx,by+20,bw*M.clamp(p.armor/p.maxArmor,0,1),12);
      ctx.fillStyle="#04141a"; ctx.fillText(`护甲 ${Math.ceil(p.armor)} · 减伤 ${Math.round(p.dr*100)}%`, bx+8, by+30);
    }
    // 弹药 / 武器（空手时给出引导）
    if(p.gun){
      const magN=p.gun.ammoMag||0, backN=p.gun.ammoRes||0;
      const ad=p.gun.loaded ? ammoDefFromId(p.gun.loaded) : null;
      const dry=magN<=0 && backN<=0;                 // 弹匣空 + 背包空 = 真打不响
      ctx.fillStyle=dry?(Math.sin(M.now()*8)>0?"#ff5a4a":"#ff8a5a"):"#e8eef4";
      ctx.font=mob?"bold 16px system-ui,sans-serif":"bold 18px system-ui,sans-serif";
      ctx.fillText(`${magN} / ${backN}`, bx, by+56);
      ctx.font=mob?"11px system-ui,sans-serif":"12px system-ui,sans-serif";
      ctx.fillStyle=dry?"#ff9a8a":"rgba(180,195,210,0.85)";
      ctx.fillText(p.gun.name+" · "+(ad?ad.short:"未装填")
        +(p.reloadT>0?" · 换弹中…":(dry?" · 没有子弹":(magN<=0?" · 弹匣空（R 换弹）":""))), bx, by+74);
    } else {
      ctx.fillStyle="#ffb35a"; ctx.font=mob?"bold 15px system-ui,sans-serif":"bold 17px system-ui,sans-serif";
      ctx.fillText("空手 · 跑刀", bx, by+56);
      ctx.font=mob?"10px system-ui,sans-serif":"11px system-ui,sans-serif"; ctx.fillStyle="rgba(200,180,150,0.9)";
      ctx.fillText(Input.isTouch?"靠近补给箱点「★」搜索 · 受伤点「+」包扎":"翻箱搜刮捡枪，捡到即自动上手", bx, by+74);
    }

    // 流血 / 绷带状态（塔科夫式医疗）
    if(p.bleed>0){
      ctx.font=mob?"bold 12px system-ui,sans-serif":"bold 13px system-ui,sans-serif";
      ctx.fillStyle=Math.sin(M.now()*8)>0?"#ff5a4a":"#ff8a5a";
      ctx.fillText(`⚠ 流血 x${p.bleed} · 每秒掉血`, bx, by-8);
    }
    /* v0.19.0：只显示「身上真有」的医疗品，0 件不再占位（旧版固定显示「绷带 x0 · 医疗 x0」）。
     * 每件按品级着色，换行绘制；一件都没有时给一句获取提示。 */
    const mdx=mob?bx:(bx+bw+14), mdy=mob?(by+94):(by+14);
    ctx.textAlign="left";
    ctx.font=mob?"bold 12px system-ui,sans-serif":"bold 13px system-ui,sans-serif";
    const owned=R._medOwnedList();
    let medY=mdy;
    if(!owned.length){
      ctx.fillStyle="rgba(205,175,175,0.72)";
      ctx.fillText(Input.isTouch?"无医疗用品 · 搜箱点「★」":"无医疗用品 · 翻箱搜刮", mdx, mdy);
    } else {
      const limit = mob ? (v.w-mdx-14) : Math.min(v.w-mdx-260, 620);
      let cx=mdx;
      for(let i=0;i<owned.length;i++){
        const txt=(i?"· ":"")+owned[i].name+" x"+owned[i].n;
        const tw=ctx.measureText(txt).width;
        if(cx>mdx && cx+tw>mdx+limit){ cx=mdx; medY+=17; }
        ctx.fillStyle=owned[i].color||"#ffb0b0";
        ctx.fillText(txt, cx, medY);
        cx+=tw;
      }
      if(!mob){
        ctx.font="11px system-ui,sans-serif"; ctx.fillStyle="rgba(190,200,210,0.55)";
        ctx.fillText(R.medT>0?"治疗中…（移动会打断）":"H 自动用最合适的一件", mdx, medY+17);
      }
    }
    if(R.stimT>0){
      ctx.font="11px system-ui,sans-serif"; ctx.fillStyle="#8fe07a";
      ctx.fillText(`加速 ${R.stimT.toFixed(0)}s`, mdx, medY+34);
    }
    if(R.medT>0){
      const u=R.medUse||{cast:2.2};
      const t=1-R.medT/(u.cast||2.2);
      const by2=medY+(mob?6:22);
      ctx.fillStyle="rgba(0,0,0,0.5)"; ctx.fillRect(mdx, by2, 90, 9);
      ctx.fillStyle=u.color||"#ffb0b0"; ctx.fillRect(mdx, by2, 90*M.clamp(t,0,1), 9);
      ctx.font="10px system-ui,sans-serif"; ctx.fillStyle="#ffd8d8";
      ctx.fillText((u.name||"治疗"), mdx+98, by2+8);
      medY=by2;
    }

    /* --- 撤离进度 --- */
    let inZone=null;
    for(const z of R.extracts){ if(!z.closed && p.x>=z.x&&p.x<=z.x+z.w&&p.y>=z.y&&p.y<=z.y+z.h){ inZone=z; break; } }
    if(inZone){
      const t=R.extractT/inZone.need;
      const cw=Math.min(300,v.w-36), cx=v.w/2-cw/2, cy=mob?v.h*0.56:(v.h-140);
      const blocked = R._extractBlockReason;
      /* 钱不够和「被封锁」是两回事，颜色与文案都要分开：一个是去清人，一个是去搞钱 */
      const money = !!blocked && blocked.indexOf("撤离费")===0;
      ctx.fillStyle=blocked?(money?"rgba(46,34,6,0.90)":"rgba(52,10,8,0.88)"):"rgba(8,16,12,0.8)"; ctx.fillRect(cx,cy,cw,26);
      ctx.fillStyle=blocked?(money?"#e8c05a":"#ff6a5a"):"#4fe08a"; ctx.fillRect(cx,cy,cw*Math.max(0.02,t),26);
      ctx.textAlign="center"; ctx.font=mob?"bold 12px system-ui,sans-serif":"bold 13px system-ui,sans-serif";
      ctx.fillStyle=blocked?(money?"#ffe9b8":"#ffe0dc"):"#04140c";
      const exLabel = blocked ? ((money?"⛕ ":"⛔ ")+blocked)
        : (mob ? `撤离中 ${(R.extractT).toFixed(1)} / ${inZone.need.toFixed(0)} 秒`
               : `撤离中 · ${inZone.name}  ${(R.extractT).toFixed(1)} / ${inZone.need.toFixed(0)} 秒`);
      ctx.fillText(exLabel, v.w/2, cy+18);
    }

    /* --- 涉水提示 --- */
    if(R.wadeT>0.5 && R.player.alive){
      const safe=Math.max(0, 4.5-R.wadeT);
      const warn=safe<=0;
      const txt=warn ? "⚠ 失温 · 立刻上岸！"
                     : `涉水中 · 流速拖慢 · 再过 ${safe.toFixed(1)} 秒开始失温`;
      ctx.font=mob?"bold 12px system-ui,sans-serif":"bold 13px system-ui,sans-serif";
      const tw=ctx.measureText(txt).width;
      const ty=mob?v.h*0.70:(v.h-196);
      ctx.fillStyle=warn?"rgba(60,12,10,0.86)":"rgba(8,20,28,0.80)";
      ctx.fillRect(v.w/2-tw/2-12, ty-16, tw+24, 24);
      ctx.strokeStyle=warn?"rgba(255,120,100,0.75)":"rgba(120,200,225,0.45)";
      ctx.lineWidth=1.5; ctx.strokeRect(v.w/2-tw/2-12, ty-16, tw+24, 24);
      ctx.textAlign="center"; ctx.fillStyle=warn?"#ff9a8a":"#a8dcef";
      ctx.fillText(txt, v.w/2, ty+1);
    }

    /* --- 搜索提示 --- */
    if(R.search){
      const t=M.clamp(R.search.t/R._searchNeed(R.search.c),0,1), cw=180, cx=v.w/2-cw/2, cy=mob?v.h*0.52:(v.h-176);
      ctx.fillStyle="rgba(8,12,16,0.8)"; ctx.fillRect(cx,cy,cw,14);
      ctx.fillStyle="#8fd0ff"; ctx.fillRect(cx,cy,cw*t,14);
      ctx.textAlign="center"; ctx.font="11px system-ui,sans-serif"; ctx.fillStyle="#dbe8f2";
      ctx.fillText("搜索中…", v.w/2, cy-6);
    } else {
      // 靠近商店优先提示交易，其次才是搜箱
      // 提示文字加暗色底衬，避免与房间名重叠时读不清
      const hintAt=(txt, col, size)=>{
        ctx.font=`bold ${size||13}px system-ui,sans-serif`;
        const tw=ctx.measureText(txt).width;
        const ty=mob?v.h*0.6:(v.h-150)-18;
        ctx.fillStyle="rgba(6,10,14,0.72)";
        ctx.fillRect(v.w/2-tw/2-10, ty-14, tw+20, 21);
        ctx.textAlign="center"; ctx.fillStyle=col;
        ctx.fillText(txt, v.w/2, ty);
      };
      const it=R._interactTarget();
      if(it && it.kind==="shop"){
        const sh=it.ref;
        hintAt(Input.isTouch?"点「★」进入 "+sh.name:"按 E 进入 "+sh.name+" · "+sh.tag, sh.color, 14);
      } else if(it && it.kind==="gadget"){
        const gd=it.ref;
        const cdLeft=gd.kind==="siren" ? Math.max(0, Math.ceil(((gd.cdUntil||0)-M.now())/1000)) : 0;
        const used=cdLeft>0 || (gd.used && gd.kind!=="dam");
        const col = cdLeft>0 ? "#ffb44a"
                  : gd.kind==="med"?"#8fe07a":gd.kind==="ammo"?"#ffd36a"
                  : gd.kind==="siren"?"#ff8a5a":"#8fd0ff";
        hintAt(Input.isTouch
          ? (used?(cdLeft>0?`警报冷却 ${cdLeft} 秒`:"该设施已用完"):`点「★」使用 ${gd.label}`)
          : (used?(cdLeft>0?`警报冷却 ${cdLeft} 秒`:"该设施已用完"):`按 E 使用 ${gd.label}`),
          used&&!cdLeft?"#8a9aac":col, 14);
      } else if(it && it.kind==="container"){
        const c=it.ref;
        if(c.ground){
          const n=(c.drops||[]).length;
          hintAt(Input.isTouch?`点「★」拾取地面物资 ×${n}`:`按 E 拾取地面物资 ×${n}`, "#ffe08a");
        } else if(c.locked && !c.searched){
          const lv=M.clamp(c.lockLv||1,1,5);
          const has=R._hasKeyFor(lv);
          hintAt(has
            ? `保险箱 · ${RAID_LOCK_NAME[lv]} · 按住 E 开锁（消耗 1 次钥匙）`
            : `保险箱 · ${RAID_LOCK_NAME[lv]} · 缺「${raidKeyDef(lv).name}」（商店有售 / 箱内掉落）`,
            has?"#8fe07a":"#ff8a5a");
        } else if(!c.searched){
          hintAt(Input.isTouch?"点「★」搜索补给 · 点「+」包扎":"按 E 搜索补给 · H 包扎", "#ffe08a");
        }
      }
    }

    /* --- 小地图 --- */
    if(CFG.raidMinimap) this.minimap(ctx, v);

    /* --- 触屏瞄准指示 --- */
    if(Input.isTouch && R.aimTgt && R.aimTgt.alive){
      const t=R.aimTgt;
      const sx=(t.x-R.camera.x)*(game.zoom||1), sy=(t.y-R.camera.y)*(game.zoom||1);
      ctx.strokeStyle="rgba(255,90,90,0.8)"; ctx.lineWidth=2;
      ctx.beginPath(); ctx.arc(sx,sy,18,0,6.28); ctx.stroke();
    }

    /* --- 物品栏（Tab 开关）：现为 DOM 面板（#inv-layer），可逐件丢弃 --- */
  },

  /* 物品栏：携带武器 / 护甲 / 头盔 / 绷带 / 战利品 */
  drawInventory(ctx, v){
    const R=Raid, p=R.player;
    const mob=!!Input.isTouch;
    const w=Math.min(560, v.w-40), h=Math.min(mob?500:560, v.h-70);
    const x=(v.w-w)/2, y=(v.h-h)/2-(mob?32:0);

    ctx.fillStyle="rgba(4,7,10,0.86)";
    ctx.beginPath(); ctx.roundRect? ctx.roundRect(x,y,w,h,10) : ctx.rect(x,y,w,h); ctx.fill();
    ctx.strokeStyle="rgba(120,150,180,0.35)"; ctx.lineWidth=1; ctx.stroke();

    ctx.textAlign="left";
    ctx.fillStyle="#e8eef6"; ctx.font="bold 16px system-ui,sans-serif";
    ctx.fillText("物品栏", x+18, y+28);
    ctx.fillStyle="rgba(150,170,190,0.8)"; ctx.font="11px system-ui,sans-serif";
    ctx.fillText(mob?"点背包键关闭 · 撤离成功才带回仓库":"Tab 关闭 · 撤离成功才带回仓库", x+72, y+27);

    let ly=y+56;
    const line=(label,val,col,sub)=>{
      ctx.textAlign="left";
      ctx.fillStyle="rgba(150,170,190,0.85)"; ctx.font="11px system-ui,sans-serif";
      ctx.fillText(label, x+18, ly);
      ctx.fillStyle=col||"#dfe7f0"; ctx.font="13px system-ui,sans-serif";
      ctx.fillText(val, x+86, ly);
      if(sub){ ctx.fillStyle="rgba(140,160,180,0.75)"; ctx.font="10px system-ui,sans-serif";
        ctx.fillText(sub, x+86, ly+13); ly+=13; }
      ly+=21;
      if(ly>y+h-24){ ly=y+56; }
    };

    // 武器
    const icon=(g,gy)=>{
      const spec=gunModelSpec(g);
      const bodyC=(MANUFACTURERS[g.manufacturer]&&MANUFACTURERS[g.manufacturer].color)||"#3a3f47";
      const accC=(g.element!=="none"&&ELEMENTS[g.element])?ELEMENTS[g.element].color:"#aab2bd";
      ctx.save(); ctx.translate(x+w-40, gy-2); ctx.scale(0.62,0.62);
      drawGunCanvas(ctx, spec, 0.8, bodyC, accC); ctx.restore();
    };
    const guns=[p.gun, p.secondary].filter(Boolean);
    if(!guns.length){ line("主武器","（无）","#8b95a5"); }
    guns.forEach((g,i)=>{
      const gy=ly;
      const col=raidGunColor(g);
      const elem=g.element&&g.element!=="none"&&ELEMENTS[g.element]?(" · "+ELEMENTS[g.element].name):"";
      line(i===0?"主武器":"副武器", g.name, col,
        `伤害 ${g.dmg} · 穿甲 ${Math.round((g.armorPen||0)*100)}% · 弹药 ${g.ammoMag}/${g.mag} · 背包 ${g.ammoRes} · ${g.loaded?(ammoDefFromId(g.loaded)||{}).short||"未装填":"未装填"}${elem}`);
      icon(g, gy);
    });
    if(guns.length){
      const bagN=(R._gunBag?R._gunBag():[]).length;   // 多枪 = 手持 + 副手 + 背包
      line("切换", "[Q] 循环 · [1~4] 直选", "#8fd0ff",
        `手持 ${p.gun?p.gun.name:"空手"} · 副手 ${p.secondary?p.secondary.name:"—"} · 背包 ${bagN} 把`);
    }
    // 护甲 / 头盔
    const ar=p.armorTier?RAID_ARMORS[p.armorTier]:null;
    line("护甲", ar?ar.name:"（未穿戴）", ar?(ARMOR_TIER_COLOR[p.armorTier]||"#dfe7f0"):"#8b95a5",
      ar?`T${p.armorTier} · 耐久 ${Math.round(p.armor)}/${Math.round(p.maxArmor)} · 减伤 ${Math.round(p.dr*100)}%${p.armorRegen?(' · 待维修 '+p.armorRegen+'/s'):''}`:"无防护");
    // v0.16.0：护盾装备三数值 + 破盾无敌 / 独特加成
    if(p.maxShield>0){
      const sg=p.shieldGear||null;
      const _ps=(sg&&sg.perks||[]).map(k=>(SHIELD_PERKS[k]?SHIELD_PERKS[k].name:k)).join(" · ")||"无";
      line("护盾", sg?sg.name:"（未装备）", "#4fd6ff",
        `容量 ${Math.round(p.shield)}/${Math.round(p.maxShield)} · 充能 ${p.shieldRate}/s · 延迟 ${p.shieldDelay}s${p.shieldInvuln>0?(' · 无敌 '+p.shieldInvuln.toFixed(1)+'s'):''}`);
      if(sg) line("护盾加成", _ps, "#8fd0ff", "破盾后短暂无敌 · 充能延迟 = 不受伤害多久后开始回盾");
    }
    // 防护类型与弹种终点效应：提示按当前数值表动态生成，不再写死倍率
    const _at=raidArmorType(p);
    const _hints=[];
    for(const k of ["fire","shock","corrosive","cryo","explosive","radiation"]){
      const E=ELEMENTS[k]; if(!E) continue;
      const m=elemMult(k,_at);
      if(m>=1.15) _hints.push(E.short+" ×"+m.toFixed(2));
      else if(m<=0.85) _hints.push(E.short+" ×"+m.toFixed(2));
    }
    line("防护类型", ARMOR_TYPE_NAME[_at]+(_at==="armor"?"（黄色血条）":""), ARMOR_TYPE_COLOR[_at],
      "当前弹种终点效应："+(_hints.length?_hints.join(" · "):"各弹种均在 ×0.85~1.15 之间"));
    // 身上的弹种终点效应状态（拟真命名）
    const _es=[];
    if((p.burnT||0)>0)    _es.push("引燃 "+p.burnT.toFixed(1)+"s");
    if((p.corrodeT||0)>0) _es.push("撕裂 "+p.corrodeT.toFixed(1)+"s");
    if((p.shockT||0)>0)   _es.push("失能 "+p.shockT.toFixed(1)+"s");
    if((p.freezeT||0)>0)  _es.push("迟滞 "+p.freezeT.toFixed(1)+"s");
    if(_es.length) line("弹种状态", _es.join(" · "), "#ff9a5a", "引燃持续掉血 · 撕裂降低防护 · 失能拉长开火间隔");
    const hm=p.helmetTier?RAID_HELMETS[p.helmetTier]:null;
    line("头盔", hm?hm.name:"（未佩戴）", hm?(ARMOR_TIER_COLOR[p.helmetTier]||"#dfe7f0"):"#8b95a5",
      hm?`T${p.helmetTier} · 耐久 ${Math.round(p.helmetArmor)}/${Math.round(p.maxHelmetArmor)} · 躯干减伤 ${Math.round(p.helmetDr*HELMET_BODY_SHARE*100)}% / 爆头 ${Math.round(p.helmetDr*100)}%`:"无减免");
    // 医疗 / 卢布（v0.19.0：只列实际拥有的医疗品，没有就明确写「无」）
    const ownedMed=R._medOwnedList();
    line("医疗", ownedMed.length ? ownedMed.map(m=>`${m.name} ×${m.n}`).join(" · ") : "（无 · 翻箱或到医疗站补给）",
      ownedMed.length?"#ff9a9a":"#8b95a5", "H 键 / 医疗键：流血自动止血，缺血自动回血；物品栏可逐件使用");
    line("卢布", "₽ "+R.creds, "#8fe07a", "撤离后结算进仓库");
    if((R.tokens||0)>0) line("GP 币", "◆ "+R.tokens, "#c07bff", "黑市专用货币 · 撤离才落袋");

    // 物品栏汇总（含容量上限，超出将无法继续拾取）
    const cap = (label, n, capN, col) => {
      ctx.textAlign="left";
      ctx.fillStyle="rgba(150,170,190,0.85)"; ctx.font="11px system-ui,sans-serif";
      ctx.fillText(label, x+18, ly);
      ctx.fillStyle = n>=capN ? "#ff8a5a" : (col||"#dfe7f0"); ctx.font="bold 12px system-ui,sans-serif";
      ctx.fillText(`${n}/${capN}`, x+86, ly); ly+=18;
    };
    cap("背包武器", R.inv.weapons.length, RAID_INV_CAP.weapons);
    cap("护甲",     R.inv.armors.length, RAID_INV_CAP.armors);
    cap("头盔",     R.inv.helmets.length, RAID_INV_CAP.helmets);
    cap("护盾",     (R.inv.shields||[]).length, RAID_INV_CAP.shields, "#4fd6ff");
    cap("配件",     R.inv.parts.length, RAID_INV_CAP.parts, "#c9a13a");
    // 原材料（带品质颜色，撤离带回仓库可高价出售 / 用于合成与组装）
    cap("原材料",   R.inv.materials.length, RAID_INV_CAP.materials, "#ffd76a");
    for(const m of R.inv.materials.slice(0,4)){
      ctx.textAlign="left";
      ctx.fillStyle=m.color||"#dfe7f0"; ctx.font="10px system-ui,sans-serif";
      ctx.fillText(`· ${m.name} · ₽${priceText(m.value)}`, x+86, ly); ly+=13;
      if(ly>y+h-20) break;
    }
    // 改装模块 / 底材（改装模块现已并入配件栏，单独列出便于查看）
    const _cores=R.inv.parts.filter(p=>p.core);
    cap("改装模块",     _cores.length, RAID_INV_CAP.parts, "#8fd0ff");
    cap("底材",     R.inv.receivers.length, RAID_INV_CAP.receivers, "#8fd0ff");
    // 钥匙串：按等级显示剩余开锁次数
    const _keys=R.inv.keys||[];
    cap("钥匙",     _keys.length, RAID_INV_CAP.keys, "#ffd23f");
    for(const k of _keys.slice(0,3)){
      ctx.textAlign="left";
      ctx.fillStyle=k.color||"#dfe7f0"; ctx.font="10px system-ui,sans-serif";
      ctx.fillText(`· ${k.name} [${RAID_LOCK_NAME[k.lv]}] 剩 ${k.uses} 次`, x+86, ly); ly+=13;
      if(ly>y+h-20) break;
    }
    for(const c of _cores.slice(0,2)){
      ctx.textAlign="left";
      ctx.fillStyle=c.color||"#dfe7f0"; ctx.font="10px system-ui,sans-serif";
      ctx.fillText(`· ${c.name}`, x+86, ly); ly+=13;
      if(ly>y+h-20) break;
    }
    // 底部提示
    ctx.textAlign="left";
    ctx.fillStyle="rgba(120,140,160,0.7)"; ctx.font="10px system-ui,sans-serif";
    ctx.fillText("阵亡或超时未撤离将全部丢失", x+18, y+h-20);
  },

  minimap(ctx, v){
    const R=Raid;
    const mob=!!Input.isTouch;
    const mw=mob?104:160, mh=mob?88:134;
    const mx=v.w-mw-(mob?10:20), my=mob?110:(v.h-mh-20);
    ctx.fillStyle="rgba(6,10,14,0.8)"; ctx.fillRect(mx,my,mw,mh);
    ctx.strokeStyle="rgba(120,140,160,0.4)"; ctx.lineWidth=1; ctx.strokeRect(mx,my,mw,mh);
    const sx=mw/RAID_MAP_W, sy=mh/RAID_MAP_H;
    // 密林绿底 + 河流蓝带 + 铁路灰线，让小地图能一眼读出地貌
    if(R.forests){
      ctx.fillStyle="rgba(46,74,40,0.55)";
      for(const fz of R.forests){ ctx.fillRect(mx+fz.x*sx, my+fz.y*sy, Math.max(2,fz.w*sx), Math.max(2,fz.h*sy)); }
    }
    if(R.waterCircles){
      ctx.fillStyle="rgba(56,110,140,0.75)";
      for(let i=0;i<R.waterCircles.length;i+=2){
        const c=R.waterCircles[i];
        ctx.beginPath(); ctx.arc(mx+c.x*sx, my+c.y*sy, Math.max(1.2,c.r*sx), 0, 6.28); ctx.fill();
      }
    }
    if(R.reservoirRect && !R.damOpen){
      const rr=R.reservoirRect;
      ctx.fillStyle="rgba(56,110,140,0.75)";
      ctx.fillRect(mx+rr.x*sx, my+rr.y*sy, Math.max(2,rr.w*sx), Math.max(2,rr.h*sy));
    }
    // 桥梁（浅灰短横条，大桥更亮更粗）—— 小地图上能直接看出过河路线
    if(R.bridges){
      for(const b of R.bridges){
        ctx.fillStyle=b.big?"rgba(230,238,246,0.92)":"rgba(190,200,212,0.75)";
        ctx.fillRect(mx+(b.x-b.w/2)*sx, my+(b.y-b.h/2)*sy,
          Math.max(2,b.w*sx), Math.max(1.6,b.h*sy));
      }
    }
    if(R.rails){
      ctx.strokeStyle="rgba(170,180,190,0.55)"; ctx.lineWidth=1;
      for(const rl of R.rails){
        ctx.beginPath();
        for(let s=0;s<rl.pts.length;s++){ const p=rl.pts[s]; if(s===0) ctx.moveTo(mx+p[0]*sx, my+p[1]*sy); else ctx.lineTo(mx+p[0]*sx, my+p[1]*sy); }
        ctx.stroke();
      }
    }
    // 野外工棚：小地图上也给个淡点，方便判断哪片空地有掩体可绕
    ctx.fillStyle="rgba(120,140,150,0.22)";
    for(const sh of R.sheds){ ctx.fillRect(mx+sh.x*sx, my+sh.y*sy, Math.max(2,sh.w*sx), Math.max(2,sh.h*sy)); }
    for(const rm of R.roomRects){
      if(rm.extract){
        const e=R.extracts.find(z=>z.id===rm.id);
        ctx.fillStyle = (e&&e.closed) ? "rgba(120,130,135,0.55)" : "rgba(90,220,140,0.7)";
      } else ctx.fillStyle="rgba(150,170,190,0.35)";
      ctx.fillRect(mx+rm.x*sx, my+rm.y*sy, Math.max(2,rm.w*sx), Math.max(2,rm.h*sy));
    }
    // 商店（枪=金 / 材料=绿 / 回收=蓝 / 黑市=紫），一眼决定往哪跑
    for(const s of (R.shops||[])){
      ctx.fillStyle = s.kind==="black"?"#c07bff":s.kind==="rec"?"#62c8ff":s.kind==="mat"?"#8fe07a":"#ffb44a";
      const px2=mx+s.x*sx, py2=my+s.y*sy;
      ctx.fillRect(px2-1.6, py2-1.6, 3.2, 3.2);
      ctx.strokeStyle="rgba(0,0,0,0.7)"; ctx.lineWidth=0.8; ctx.strokeRect(px2-1.6, py2-1.6, 3.2, 3.2);
    }
    // 可互动设施（医疗站=绿 / 弹药=黄 / 泄洪闸=蓝）
    for(const g of (R.gadgets||[])){
      ctx.fillStyle = g.kind==="med"?"#8fe07a":g.kind==="ammo"?"#ffd36a":g.kind==="siren"?"#ff8a5a":"#6fb6e8";
      const gx2=mx+g.x*sx, gy2=my+g.y*sy;
      ctx.fillRect(gx2-1.4, gy2-1.4, 2.8, 2.8);
    }
    for(const o of R.ops){
      if(!o.alive) continue;
      if(o.bounty){
        ctx.fillStyle="#ffd23f"; ctx.beginPath(); ctx.arc(mx+o.x*sx, my+o.y*sy, 4, 0, 6.28); ctx.fill();
      } else {
        ctx.fillStyle=o.isPlayer?"#4fd6ff":(o.remote?"#7ee08a":"#ff5a5a");
        ctx.beginPath(); ctx.arc(mx+o.x*sx, my+o.y*sy, (o.isPlayer||o.remote)?3.5:2.2, 0, 6.28); ctx.fill();
      }
    }
  },
};

// 小地图/提示用：视野内最近的可搜索箱（需视线可达）
Raid.nearestContainerVisible = function(){
  const p=this.player;
  const c=this._nearestContainer(p.x, p.y, 78);
  if(!c) return null;
  if(c.damLoot && !this.damOpen) return null;   // 水下保险箱：开闸前不提示
  if(!this._los(p.x,p.y,c.x,c.y)) return null;
  return c;
};

/* =========================================================================
 * UI — 塔科夫模式：仓库/配装、结算
 * ========================================================================= */
UI.raidSetup=function(){
  // 回大厅先结算拍卖行（到期的成交 / 退款 / 流拍退回）
  if(typeof Auction!=="undefined"){ try{ Auction.settle(); }catch(e){} }
  const stash=RaidStash.load();
  const auc = (typeof Auction!=="undefined") ? Auction.counts() : { listings:0, mine:0 };
  if(!UI._raidSel) UI._raidSel={ w:[], a:null, h:null, s:null };
  if(UI._raidIns===undefined) UI._raidIns=false;
  const sel=UI._raidSel;
  if(sel.h===undefined) sel.h=null;
  if(sel.s===undefined) sel.s=null;
  if(!stash.shields) stash.shields=[];
  // 清理已不存在的 uid
  sel.w=sel.w.filter(uid=>stash.weapons.some(w=>w.uid===uid));
  if(sel.a && !stash.armors.some(a=>a.uid===sel.a)) sel.a=null;
  if(sel.h && !(stash.helmets||[]).some(h=>h.uid===sel.h)) sel.h=null;
  if(sel.s && !stash.shields.some(s=>s.uid===sel.s)) sel.s=null;
  if(!sel.w.length && !sel.a && !sel.h && !sel.s) UI._raidIns=false;
  /* 钥匙串改为「可选携带」——v0.20.1 起默认一把不带，点卡片逐把勾选。
   * 带进图的钥匙死了就丢，留在仓库的绝对安全，玩家自己权衡。 */
  /* v0.20.1：钥匙默认一把都不带（丢了就没了）；玩家想冒险再逐把勾选 */
  if(!Array.isArray(UI._raidKeys)) UI._raidKeys=[];
  UI._raidKeys=UI._raidKeys.filter(uid=>(stash.keys||[]).some(k=>k.uid===uid));

  const wcards = stash.weapons.length ? stash.weapons.map(w=>{
    const on=sel.w.includes(w.uid);
    const col=raidGunColor(w);
    const tname=WEAPON_TYPES[w.type]?WEAPON_TYPES[w.type].name:w.cat;
    const elem=w.element&&w.element!=="none"?(ELEMENTS[w.element]?ELEMENTS[w.element].name:""):"";
    return `<div class="raid-item ${on?'sel':''}" data-w="${w.uid}">
      <div class="ri-name" style="color:${col}">${w.name}</div>
      <div class="ri-meta">${tname}${elem?(' · '+elem):''} · 伤害 ${w.dmg} · 弹匣 ${w.mag} · 射速 ${w.rpm} · 配件 ${(w.parts||[]).length}</div>
      ${w.uniqPerk?`<div class="ri-meta" style="color:#ffd23f">✦ ${w.uniqPerk}</div>`:''}
      <div class="ri-val">估值 ₽${priceTextShort(w.value)}${on?' · 已携带':''}</div>
    </div>`;
  }).join('') : `<div class="empty-hint">仓库暂无枪械 · 打一局搜到武器并撤离即可入库</div>`;

  const acards = stash.armors.length ? stash.armors.map(a=>{
    const on=sel.a===a.uid;
    const rar=a.rarity|0;
    const col=RAID_RARITY_COLOR[rar];
    return `<div class="raid-item ${on?'sel':''}" data-a="${a.uid}">
      <div class="ri-name" style="color:${col}">${a.name}<span style="font-size:11px;opacity:.9"> · ${RAID_RARITY_NAME[rar]}</span></div>
      <div class="ri-meta">T${a.tier} · ${RAID_RARITY_NAME[rar]} · 减伤 ${Math.round(a.dr*100)}% · 护甲值 ${a.maxArmor}${a.armorRegen?(' · 待维修 '+a.armorRegen+'/s'):''}</div>
      <div class="ri-meta" style="color:#9fd0ff">词条：${(a.affixes||[]).map(x=>x.nm).join(" · ")||"—"}</div>
      <div class="ri-val">估值 ₽${priceTextShort(a.value)}${on?' · 已穿戴':''}</div>
    </div>`;
  }).join('') : `<div class="empty-hint">没有护甲 · 去军火超市买 T1~T9</div>`;

  const hcards = (stash.helmets||[]).length ? stash.helmets.map(h=>{
    const on=sel.h===h.uid;
    const rar=h.rarity|0;
    const col=RAID_RARITY_COLOR[rar];
    return `<div class="raid-item ${on?'sel':''}" data-h="${h.uid}">
      <div class="ri-name" style="color:${col}">${h.name}<span style="font-size:11px;opacity:.9"> · ${RAID_RARITY_NAME[rar]}</span></div>
      <div class="ri-meta">T${h.tier} · ${RAID_RARITY_NAME[rar]} · 爆头减伤 ${Math.round(h.dr*100)}% · 耐久 ${h.maxArmor}${h.armorRegen?(' · 待维修 '+h.armorRegen+'/s'):''}</div>
      <div class="ri-meta" style="color:#9fd0ff">词条：${(h.affixes||[]).map(x=>x.nm).join(" · ")||"—"}</div>
      <div class="ri-val">估值 ₽${priceTextShort(h.value)}${on?' · 已戴上':''}</div>
    </div>`;
  }).join('') : `<div class="empty-hint">没有头盔 · 头盔可减免爆头伤害</div>`;

  const scards = stash.shields.length ? stash.shields.map(s=>{
    const on=sel.s===s.uid, col=shieldColor(s);
    return `<div class="raid-item ${on?'sel':''}" data-s="${s.uid}">
      <div class="ri-name" style="color:${col}">${s.name}<span style="font-size:11px;opacity:.9"> · ${shieldGrade(qOf(s)).name}</span></div>
      <div class="ri-meta">T${s.tier} · ${(s.parts||[]).length} 个配件 · ${shieldLines(s).slice(0,3).join(" · ")}</div>
      <div class="ri-meta" style="color:#9fd0ff">前后缀：${(s.affixes||[]).map(x=>x.nm).join(" · ")||"—"}${s.uniqPerk?' · <b style="color:#ffd23f">具名</b>':''}</div>
      <div class="ri-val">估值 ₽${priceTextShort(s.value)}${on?' · 已装备':''}</div>
    </div>`;
  }).join('') : `<div class="empty-hint">没有护盾 · 工坊合成 / 融合 / 箱子掉落 / 军火超市购买</div>`;

  const keysAll=stash.keys||[];
  const keySet=new Set(UI._raidKeys);

  /* ---------------- 弹药携带（v0.20.0） ----------------
   * 每个口径一行：默认选「仓库里该口径最高级别」的一种，按钮选带多少发。
   * UI._raidAmmo = { light:{id,n}, mid:{...} } —— 传进 Raid 后由 _prepPlayerAmmo 搬进背包。 */
  if(!UI._raidAmmo || typeof UI._raidAmmo!=="object") UI._raidAmmo={};
  const ammoStock=stash.ammo||{};
  const ammoRows=AMMO_CAL_LIST.map(cal=>{
    const have=[];
    for(let lv=5; lv>=1; lv--){
      const id=ammoItemId(cal, lv), n=ammoStock[id]||0;
      if(n>0) have.push({ id, lv, n });
    }
    const C=AMMO_CALS[cal];
    const sel=UI._raidAmmo[cal];
    const cur=have.find(h=>sel && sel.id===h.id) || have[0] || null;
    if(!cur){
      /* 没有库存：直接给一个「买 60 发 T1」的入口，避免仓库打空后进图才发现没子弹 */
      delete UI._raidAmmo[cal];
      const d0=ammoDef(cal,1);
      const price=raidSuperPrice(d0.value*60, d0.id);
      const can=stash.creds>=price;
      return { cal, html:`<div class="ri" style="cursor:default;">
        <div class="ri-main">
          <div class="ri-name" style="color:#8b95a5">${C.name} · 无库存</div>
          <div class="ri-meta">${C.spec} · 适用 ${C.types.map(t=>WEAPON_TYPES[t]?WEAPON_TYPES[t].name:t).join(" / ")}</div>
        </div>
        <div class="ri-val"><button class="btn ghost small" data-ammobuy="${cal}" ${can?"":"disabled"}
          style="padding:2px 8px;font-size:11px;">买 60 发 · ₽${priceText(price)}</button></div>
      </div>` };
    }
    const cap=Math.min(cur.n, RAID_AMMO_CAP);
    /* v0.20.1：默认一发都不带（进图枪是空的，子弹要自己带或自己找）。
     * 只有玩家点过数量按钮，才按他选的带。 */
    const n=(sel && sel.id===cur.id) ? Math.max(0, Math.min(sel.n|0, cap)) : 0;
    UI._raidAmmo[cal]={ id:cur.id, n, cap };
    const btns=[0, 60, 120, cap].filter((v,i,a)=>a.indexOf(v)===i)
      .map(v=>`<button class="btn ghost small" data-ammo="${cal}:${v}" style="padding:2px 7px;font-size:11px;${v===n?'border-color:#ffd36a;color:#ffd36a;':''}">${v===cap?'全带':v}</button>`).join("");
    return { cal, html:`<div class="ri" style="cursor:default;">
        <div class="ri-main">
          <div class="ri-name" style="color:${C.color}">${C.name} · ${(AMMO_GRADE_BY_LV[cur.lv]||{}).name||"T"+cur.lv}</div>
          <div class="ri-meta">${C.spec} · 适用 ${C.types.map(t=>WEAPON_TYPES[t]?WEAPON_TYPES[t].name:t).join(" / ")} · 库存 ${cur.n} 发</div>
        </div>
        <div class="ri-val" style="display:flex;gap:4px;align-items:center;">${btns}
          <button class="btn ghost small" data-ammobuy="${cal}" style="padding:2px 7px;font-size:11px;">补货 60</button>
        </div>
      </div>` };
  });
  const ammoCards=ammoRows.map(r=>r.html).filter(Boolean).join("")
    || `<div class="empty-hint">仓库没有弹药 · 去工坊合成或在军火超市购买</div>`;
  const ammoCarried=Math.min(RAID_AMMO_CAP,
    Object.keys(UI._raidAmmo).reduce((sum,k)=>sum+(UI._raidAmmo[k].n||0),0));
  const keyCards = keysAll.length ? keysAll.map(k=>{
    const on=keySet.has(k.uid);
    const lv=M.clamp(k.lv||1,1,5);
    return `<div class="raid-item ${on?'sel':''}" data-key="${k.uid}" style="cursor:pointer;">
      <div class="ri-name" style="color:${k.color||raidKeyDef(lv).color}">${k.name}</div>
      <div class="ri-meta">${RAID_LOCK_NAME[lv]} · 可开 ${k.uses}/${k.maxUses||k.uses} 次 · 估值 ₽${priceTextShort(k.value||0)}</div>
      <div class="ri-val" style="color:${on?'#8fe07a':'#8b95a5'}">${on?'✓ 装进钥匙串':'○ 留在仓库'}</div>
    </div>`;
  }).join('') : `<div class="empty-hint">仓库没有钥匙 · 只能开箱掉落，或在材料商店 / 黑市购买（不可合成）</div>`;

  // 配装总价值 = 装备估值 + 带入卢布 + GP 币折算（撤离费 / 保费仍只按装备估值）
  const gearVal=sel.w.reduce((s,uid)=>{
    const w=stash.weapons.find(x=>x.uid===uid); return s+(w?w.value:0);
  },0)+(sel.a?(stash.armors.find(x=>x.uid===sel.a)||{value:0}).value:0)
    +(sel.h?((stash.helmets||[]).find(x=>x.uid===sel.h)||{value:0}).value:0)
    +(sel.s?(stash.shields.find(x=>x.uid===sel.s)||{value:0}).value:0);
  // 入场可携带现金 / GP 币（局内直接消费，阵亡即丢）
  const cashIn=Math.max(0, Math.min(UI._raidCash||0, Math.floor(stash.creds||0)));
  const tokIn=Math.max(0, Math.min(UI._raidTok||0, Math.floor(stash.tokens||0)));
  const tokWorth=raidTokenWorth(tokIn);
  const cashVal=cashIn+tokWorth;
  const carryVal=gearVal+cashVal;
  const insCost=gearVal>0?Math.max(200, Math.round(gearVal*0.35)):0;
  const cRatio=(stash.creds||0)>0?cashIn/stash.creds:0;
  const tRatio=(stash.tokens||0)>0?tokIn/stash.tokens:0;
  const nearR=(a,b)=>Math.abs(a-b)<0.09;
  const canIns=gearVal>0 && stash.creds>=insCost;
  // 顶部出发条：让玩家不必滚到底部才能进场；顺带把本次撤离费区间摊开
  const feeOf=id=>raidExtractFee(RAID_EXTRACT_RULES[id], gearVal);
  const feeMin=feeOf("extP"), feeMax=feeOf("extJ");

  UI._set(`
    <div class="panel raid-setup">
      <h2 class="title-big" style="font-size:34px;">塔科夫模式 · 撤离突袭</h2>
      <div class="subtitle">ESCAPE FROM TARKOV · 硬核撤离射击 · 地图「海关流域」· 工业区 + 北境密林 + 中央河谷 + 铁路枢纽 + 西南监狱/小镇/大坝 · 支持 <b style="color:#7ee08a">2~4 人联机</b></div>
      <details class="tarkov-intro">
        <summary>塔科夫模式 · 玩法说明（点此展开 / 折叠）</summary>
        <div class="tarkov-intro-body" style="color:var(--muted);max-width:680px;">
          与 30 名 <b style="color:#e0b84a">PMC / Scav</b> 加 3 名 <b style="color:#ffd23f">Boss</b>同场。他们和你一样从零起步：各自有<b style="color:#8fe07a">独立背包与卢布</b>，会搜箱、换更好的枪甲；名字带 <b style="color:#ffd23f">◆</b> 的 Raider 会优先抢武器箱、残血自行包扎。中弹会<b style="color:#ff8a5a">流血</b>（随身绷带/搜刮补给可止血）。<br>
          <b style="color:#ffd23f">战利品 9 阶品质</b>：${raidTierLegend()}。箱子<b style="color:#ffd76a">绝大多数是原材料与配件</b>，整枪 / 护甲只是少数——想拿到好枪，要靠<b style="color:#8fd0ff">工坊组装</b>（底材 + 配件 + 材料，名字与品质由它们决定）。任意品质都可能刷出，但<b style="color:#8fd0ff">携带装备总估值</b>会显著抬高高阶物资的权重。<br>
          <b style="color:#ff7a3c">开局 3 分钟后</b>全图开始缓慢刷入<b>带装备的增援</b>：有的<b style="color:#e0b84a">组队推进</b>，有的会<b style="color:#ff7a3c">封锁撤离点</b>（封锁者存活时无法读条撤离）。<b style="color:#8fe07a">付费撤离点永不被封锁</b>，实在被堵死就花钱雇车；全图同时最多 2 处被封锁。<br>
          <b style="color:#ff8a5a">AI 更像真人</b>：视野 <b>1000px</b>、枪声能传 <b>1200px</b>，听见动静会一路摸过来；遇敌会<b>压到 170px</b>、左右游走、<b style="color:#8fd0ff">侧向急闪躲子弹</b>；<b style="color:#ff8a5a">打空弹匣会当场换弹并后撤</b>（备弹打光就翻尸补弹），<b style="color:#8fe07a">残血会自己找机会包扎</b>（Raider 58% / PMC 45% / Scav 38% 开始用药）。开局 <b>8 秒</b>内 AI 不会主动锁定你（<b>一旦开枪立即作废</b>），够你跑到第一个掩体。<b style="color:#c07bff">本局第一次击杀</b>必得 <b>1 枚 ◆ GP 币</b>（撤离才落袋）—— 想攒 GP 币就得真开打，绕开所有人只会两手空空。<br>
          <b style="color:#8fe07a">只有成功撤离</b>，携带装备与战利品才写回仓库；阵亡或超时全部丢失。<br>
          <b style="color:#4fd6ff">护盾装备</b>：血条<b>上方</b>那条独立蓝色条，伤害<b>先扣盾、再扣护甲耐久、最后扣血</b>；
          <b>充能延迟</b>= 不受伤害多少秒后开始回盾，<b>充能速度</b>= 每秒回多少；<b>破盾瞬间有一小段无敌</b>，
          之后按延迟重新起盾。护盾由电池组 / 充能模块 / 延时继电器 / 承载框架 4 个配件组成，
          带前后缀与独特加成，可工坊合成、融合升阶、箱子和 Raider 掉落、军火超市购买。<br>
          <b style="color:#ffb44a">局内商店</b>：全图 <b>9 个摊位</b>（枪械 ×2 / 材料 ×3 / 回收 ×2 / 黑市 ×2），<b style="color:#ffd23f">每局随机刷新位置</b>，散在工业区、北境、河谷、东部铁路与西南监狱/小镇之间，走近按 <b>E</b> 交易（游戏不暂停）。<b>每个摊位各自独立</b>：货架、收购与 GP 币都不互通，同名分店也是自己的库存。回收超市按估值 <b style="color:#62c8ff">120%（±40%）</b> 收你的货，远高于背包直售的 <b style="color:#ff8a5a">${Math.round(RAID_VENDOR_RATE*100)}%</b>；黑市只收 <b style="color:#c07bff">◆ GP 币</b>，出售高稀有度成品枪与高级改装模块。<br>
          <b style="color:#ffd23f">保险箱与钥匙</b>：地图里散布着 <b>I~V 级上锁保险箱</b>（箱体带等级锁扣），等级越高里面的枪械 / 护甲 / 改装模块越好。低阶箱遍地都是，<b style="color:#ff8a5a">IV 级每局通常只有一口</b>（最大房间的军械库），<b style="color:#ff6a5a">V 级军火箱全图随机、约五局一遇</b>，箱内保底 <b>T5 橙装</b>、一次出 4 件。开箱要消耗一次对应等级的<b>钥匙</b>（钥匙能开同级及更低的箱子，有使用次数，用尽报废）。<b style="color:#ff9a3a">钥匙无法合成</b>，只有两条路：<b>开箱掉落</b>（<b style="color:#ffd76a">i 级箱最多掉 i+1 级钥匙</b>，V 级封顶；普通箱只出 I 级）与<b>商店购买</b>（<b>材料商店</b> I~II 卢布、<b>黑市</b> III~V GP 币；Raider 身上也会揣一把）。钥匙带进图才算数，死了就丢——<b style="color:#ffd23f">入场前在配装大厅的「钥匙串」逐把勾选</b>，不想冒险的钥匙留在仓库，绝对安全。<br>
          <b style="color:#8fb0c8">改装模块不可合成</b>：弹种适配组件 / 膛压组件 / 改装模块既不能用材料造，也不能两两升阶，只能从<b>保险箱与 Raider</b>身上掉落，或在<b>枪械商店（低阶 · 卢布）</b>与<b>黑市（高阶 · GP 币）</b>购买。膛压组件决定<b>改装等级</b>（每级主伤害 <b>×${MAYHEM.corePower}</b>，V 级约 ×1.34），弹种适配组件更换枪械适配弹药。<br>
          <b style="color:#8fe07a">可互动设施</b>：<b>监狱 / 小镇 / 大坝</b>里有医疗站（回 45 血并止血）、弹药柜（补满备弹）、警报器（拉响把 AI 引过去，撤离前调虎离山）与<b style="color:#8fd0ff">泄洪闸</b>——闸门一开，水库放空，水底露出 <b style="color:#ffd23f">IV 级 + III 级保险箱</b>各一口，代价是巨响会招来一票人。<br>
          <b style="color:#62c8ff">河流与桥</b>：河道可<b>缓慢涉水</b>通过（速度只剩 45%），泡在水里超过 4.5 秒开始<b style="color:#ff9a8a">失温扣血</b>且越拖越疼——桥面（8 座，含 3 座带双黄线的大桥）完全免减速，赶路还是走桥。<b style="color:#ffd76a">背包满时</b>捡到的多余物资不会消失，会<b>掉在脚下变成发光的小包裹</b>，腾出空间后按 E 还能捡回来；<b style="color:#ff8a5a">Tab 物品栏</b>里每件战利品都有 <b>✕ 丢弃</b> 按钮，丢掉的同样落在脚下，随时能回头捡。<br>
          <b style="color:#ffb44a">子弹是独立物品</b>：4 个口径（9×19 / 5.45×39 / 7.62×54R·12-70 / 40mm）× <b>5 个级别</b>（民用 → 制式 → 军规 → 精工 → 特种，穿深 5→36 递增）。弹匣打空要<b style="color:#ffd36a">按 R 换弹，子弹从背包里扣</b>，背包没子弹就打不响。子弹能<b>合成</b>（工坊「弹药」页，材料越贵弹越高级）、<b>掉落</b>（武器箱首选、清尸必摸）与<b>购买</b>（材料店 T1/T2 卢布、枪械店 T2/T3、黑市 T4/T5 GP 币）。<br>
          <b style="color:#e0b84a">撤离费按带入装备估价浮动</b>：裸装跑刀只收 <b style="color:#8fe07a">0.2 倍</b>（约 ₽70~110，基本白坐）；带得越多折扣越小，带 ₽30 万的重装按原价付、封顶一两千 —— 贵重装备多、护送成本高。<br>
          <b style="color:#8fe07a">带入现金</b>：配装大厅可以把仓库里的<b>卢布 / ◆ GP 币</b>按 25% / 50% / 全部带进图，局内商店与黑市直接花；<b style="color:#ff8a5a">阵亡即丢</b>，撤离成功则连本局所得一起回仓。撤离费先扣局内现金，<b style="color:#ffd36a">不够再从仓库补扣</b>（只在真正撤离成功时扣）。</div>
      </details>
      <div class="raid-balance">仓库卢布：<b>₽ ${stash.creds}</b> · GP 币 <b style="color:#c07bff">◆ ${stash.tokens||0}</b> · 枪械 ${stash.weapons.length} · 护甲 ${stash.armors.length} · 头盔 ${(stash.helmets||[]).length} · 护盾 ${stash.shields.length} · 配件 ${(stash.parts||[]).length} · 改装模块 ${(stash.parts||[]).filter(p=>p.core).length} · 原材料 ${(stash.materials||[]).length} · 底材 ${(stash.receivers||[]).length} · 钥匙 <b style="color:#ffd23f">${(stash.keys||[]).length}</b></div>

      <div class="raid-launch">
        <div class="rl-text">
          <div class="rl-title">${carryVal>0?`${gearVal>0?'已配装':'只带现金'} · 总价值 ₽${priceText(carryVal)}`:'裸装跑刀'}</div>
          <div class="rl-sub">${carryVal>0?`装备 ₽${priceText(gearVal)}${cashVal>0?` + 带入现金 ₽${priceText(cashVal)}（卢布 ₽${priceText(cashIn)}${tokWorth>0?` · GP 币 ◆${tokIn}≈₽${priceText(tokWorth)}`:''}）`:''} · `:''}撤离费按装备估值浮动：雇车撤离约 <b style="color:#ffd36a">₽${priceText(feeMin)} ~ ${priceText(feeMax)}</b> · 免费撤离点需坚守 7~10 秒</div>
        </div>
        <div class="rl-btns">
          <button class="btn ghost" id="btn-raid-online" style="border-color:#7ee08a66;color:#9fe0a8;">联机突袭 · 2~4 人</button>
          <button class="btn" id="btn-raid-start">进入海关流域</button>
        </div>
      </div>

      <div class="raid-carry">
        <div class="rc-row">
          <span class="rc-label">带入卢布</span>
          <span class="rc-val" style="color:#8fe07a">₽ <b>${priceText(cashIn)}</b></span>
          <span class="rc-btns">
            <button class="btn ghost small ${cRatio<=0.02?'on':''}" data-carry="creds:0">不带</button>
            <button class="btn ghost small ${nearR(cRatio,0.25)?'on':''}" data-carry="creds:0.25">25%</button>
            <button class="btn ghost small ${nearR(cRatio,0.5)?'on':''}" data-carry="creds:0.5">50%</button>
            <button class="btn ghost small ${nearR(cRatio,1)?'on':''}" data-carry="creds:1">全带</button>
          </span>
        </div>
        <div class="rc-row">
          <span class="rc-label">带入 GP 币</span>
          <span class="rc-val" style="color:#c07bff">◆ <b>${tokIn}</b>${tokIn>0?`<span style="font-size:11px;color:#8b7ba8"> ≈ ₽${priceText(tokWorth)}</span>`:''}</span>
          <span class="rc-btns">
            <button class="btn ghost small ${tRatio<=0.02?'on':''}" data-carry="tokens:0">不带</button>
            <button class="btn ghost small ${nearR(tRatio,0.5)?'on':''}" data-carry="tokens:0.5">一半</button>
            <button class="btn ghost small ${nearR(tRatio,1)?'on':''}" data-carry="tokens:1">全带</button>
          </span>
        </div>
        <div class="rc-hint">带进图的现金可以在局内商店 / 黑市直接花（黑市只收 GP 币）；<b style="color:#ff8a5a">阵亡即丢失</b>，撤离成功则连本局所得一起带回仓库。<br>
          卢布与 GP 币<b style="color:#8fd0ff">都计入配装总价值</b>（1 枚 ◆ GP 币按 <b>₽${priceText(RAID_TOKEN_RATE)}</b> 折算，仅用于估值显示，不可兑换）；撤离费与保费只按<b>装备</b>估值计算。</div>
      </div>

      <div class="raid-cols" style="grid-template-columns:repeat(auto-fit,minmax(230px,1fr));">
        <div class="raid-col">
          <h4>携带枪械（最多 4 把：手持 1 · 副手 1 · 背包 2）</h4>
          <div class="raid-list">${wcards}</div>
        </div>
        <div class="raid-col">
          <h4>穿戴护甲（T1~T9 · 最多 1 件）</h4>
          <div class="raid-list">${acards}</div>
        </div>
        <div class="raid-col">
          <h4>佩戴头盔（T1~T9 · 最多 1 件）</h4>
          <div class="raid-list">${hcards}</div>
        </div>
        <div class="raid-col">
          <h4>装备护盾（容量 / 充能 / 延迟 · 最多 1 件）</h4>
          <div class="raid-list">${scards}</div>
        </div>
        <div class="raid-col">
          <h4 style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;">
            <span>钥匙串（携带 ${UI._raidKeys.length}/${RAID_INV_CAP.keys}）</span>
            <span style="display:flex;gap:6px;">
              <button class="btn ghost small" data-keyall="1" style="padding:2px 8px;font-size:11px;">全带</button>
              <button class="btn ghost small" data-keyall="0" style="padding:2px 8px;font-size:11px;">全不带</button>
            </span>
          </h4>
          <div class="raid-list">${keyCards}</div>
        </div>
        <div class="raid-col">
          <h4 style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;">
            <span style="color:${ammoCarried>0?'inherit':'#ff9a8a'}">弹药（携带 ${ammoCarried}/${RAID_AMMO_CAP} 发）</span>
            <span style="display:flex;gap:6px;">
              <button class="btn ghost small" data-ammoall="1" style="padding:2px 8px;font-size:11px;">全带</button>
              <button class="btn ghost small" data-ammoall="0" style="padding:2px 8px;font-size:11px;">全不带</button>
            </span>
          </h4>
          <div class="raid-list">${ammoCards}</div>
        </div>
      </div>

      <div class="row" style="margin-top:12px;gap:10px;align-items:center;">
        <button class="btn ${UI._raidIns?'':'ghost'}" id="btn-raid-ins" ${canIns?'':'disabled'}>
          ${UI._raidIns?'✓ 已投保':'投保'}（₽${priceText(insCost)} · 阵亡后 65% 退回）
        </button>
        ${gearVal>0&&!canIns?`<span style="color:var(--muted);font-size:12px;">卢布不足，无法投保</span>`:''}
      </div>

      <div class="row" style="justify-content:space-between;align-items:center;margin-top:16px;flex-wrap:wrap;gap:10px;">
        ${ammoCarried===0?`<div class="raid-tip" style="color:#ff9a8a;width:100%;">未携带弹药：进图后枪是空的，要先搜到 / 买到子弹才能开火（钥匙同样默认不带）</div>`:''}
        <div class="raid-tip">${sel.w.length===0&&!sel.a&&!sel.h&&!sel.s&&cashVal===0?'裸装进场：空手、无甲、无盔、无盾，只带 1 卷绷带 —— 进图翻箱捡枪，捡到即自动上手':`已选 ${sel.w.length} 把枪${sel.a?' + 护甲':''}${sel.h?' + 头盔':''}${sel.s?' + 护盾':''} · 装备 ₽${priceText(gearVal)}${cashVal>0?` + 现金 ₽${priceText(cashVal)}`:''} · 总价值 <b style="color:#ffd36a">₽${priceText(carryVal)}</b> · 局内 Q 循环换枪 / 1~4 直选，多出的枪放背包`}</div>
        <div class="row" style="justify-content:flex-end;">
          <button class="btn ghost" id="btn-raid-shop">军火超市</button>
          <button class="btn ghost" id="btn-raid-forge">枪匠台</button>
          <button class="btn ghost" id="btn-raid-stash">仓库</button>
          <button class="btn ghost" id="btn-raid-auction">拍卖行${auc.mine?` · 挂单 ${auc.mine}`:""}</button>
          <button class="btn ghost" id="btn-raid-back">返回</button>
        </div>
      </div>
    </div>`);

  UI.overlay.querySelectorAll('[data-ammobuy]').forEach(el=>{
    el.onclick=(e)=>{
      e.stopPropagation();
      const cal=el.dataset.ammobuy;
      const d0=ammoDef(cal,1);
      const price=raidSuperPrice(d0.value*60, d0.id);
      if(stash.creds<price){ UI.toast && UI.toast("卢布不足"); return; }
      stash.creds-=price;
      stash.ammo=stash.ammo||{};
      stash.ammo[d0.id]=(stash.ammo[d0.id]||0)+60;
      RaidStash.save(stash); SFX.pickup();
      const cur=UI._raidAmmo[cal];
      UI._raidAmmo[cal]={ id:d0.id, n:Math.min(RAID_AMMO_CAP,(cur&&cur.n)||60) };
      UI.raidSetup();
    };
  });
  UI.overlay.querySelectorAll('[data-ammo]').forEach(el=>{
    el.onclick=(e)=>{
      e.stopPropagation();
      const [cal,v]=el.dataset.ammo.split(":");
      const cur=UI._raidAmmo[cal];
      if(!cur) return;
      cur.n=Math.max(0, Math.min(parseInt(v,10)||0, RAID_AMMO_CAP));
      SFX.ui(); UI.raidSetup();
    };
  });
  UI.overlay.querySelectorAll('[data-ammoall]').forEach(el=>{
    el.onclick=(e)=>{
      e.stopPropagation();
      const all=el.dataset.ammoall==="1";
      for(const cal of AMMO_CAL_LIST){
        const cur=UI._raidAmmo[cal]; if(!cur) continue;
        cur.n = all ? (cur.cap||0) : 0;
      }
      SFX.ui(); UI.raidSetup();
    };
  });
  UI.overlay.querySelectorAll('[data-keyall]').forEach(el=>{
    el.onclick=(e)=>{
      e.stopPropagation();
      const all=(stash.keys||[]).map(k=>k.uid);
      UI._raidKeys = el.dataset.keyall==="1" ? all.slice(0, RAID_INV_CAP.keys) : [];
      SFX.ui(); UI.raidSetup();
    };
  });
  UI.overlay.querySelectorAll('[data-key]').forEach(el=>{
    el.onclick=()=>{
      if(!Array.isArray(UI._raidKeys)) UI._raidKeys=[];
      const uid=el.dataset.key;
      const i=UI._raidKeys.indexOf(uid);
      if(i>=0) UI._raidKeys.splice(i,1);
      else {
        if(UI._raidKeys.length>=RAID_INV_CAP.keys) return;   // 钥匙串满了
        UI._raidKeys.push(uid);
      }
      SFX.ui(); UI.raidSetup();
    };
  });
  UI.overlay.querySelectorAll('[data-w]').forEach(el=>{
    el.onclick=()=>{
      const uid=el.dataset.w;
      const i=sel.w.indexOf(uid);
      if(i>=0) sel.w.splice(i,1);
      else { if(sel.w.length>=4) sel.w.shift(); sel.w.push(uid); }
      SFX.ui(); UI.raidSetup();
    };
  });
  UI.overlay.querySelectorAll('[data-a]').forEach(el=>{
    el.onclick=()=>{ sel.a = sel.a===el.dataset.a?null:el.dataset.a; SFX.ui(); UI.raidSetup(); };
  });
  UI.overlay.querySelectorAll('[data-h]').forEach(el=>{
    el.onclick=()=>{ sel.h = sel.h===el.dataset.h?null:el.dataset.h; SFX.ui(); UI.raidSetup(); };
  });
  UI.overlay.querySelectorAll('[data-s]').forEach(el=>{
    el.onclick=()=>{ sel.s = sel.s===el.dataset.s?null:el.dataset.s; SFX.ui(); UI.raidSetup(); };
  });
  const insBtn=document.getElementById('btn-raid-ins');
  if(insBtn && !insBtn.disabled) insBtn.onclick=()=>{ UI._raidIns=!UI._raidIns; SFX.ui(); UI.raidSetup(); };
  document.getElementById('btn-raid-shop').onclick=()=>{ SFX.ui(); UI.raidShop({from:'lobby'}); };
  document.getElementById('btn-raid-forge').onclick=()=>{ SFX.ui(); UI.raidForge({from:'lobby'}); };
  document.getElementById('btn-raid-stash').onclick=()=>{ SFX.ui(); UI.raidStash({from:'lobby'}); };
  document.getElementById('btn-raid-auction').onclick=()=>{ SFX.ui(); UI.raidAuction({from:'lobby'}); };
  document.getElementById('btn-raid-online').onclick=()=>{ SFX.ui(); UI._onlineKeep=false; UI.raidOnline(); };
  document.getElementById('btn-raid-back').onclick=()=>{ SFX.ui(); UI._raidSel={w:[],a:null,h:null,s:null}; UI._raidIns=false; UI.title(); };
  UI.overlay.querySelectorAll('[data-carry]').forEach(el=>{
    el.onclick=(e)=>{
      e.stopPropagation();
      const [k,fr]=el.dataset.carry.split(":");
      const f=parseFloat(fr)||0;
      if(k==="creds") UI._raidCash=Math.round((stash.creds||0)*f);
      else UI._raidTok=Math.round((stash.tokens||0)*f);
      SFX.ui(); UI.raidSetup();
    };
  });
  document.getElementById('btn-raid-start').onclick=()=>{
    SFX.ui();
    const pickedKeys=Array.isArray(UI._raidKeys)?UI._raidKeys.slice():[];
    const ammoPick={};
    for(const cal of AMMO_CAL_LIST){
      const a=UI._raidAmmo && UI._raidAmmo[cal];
      if(a && a.n>0) ammoPick[cal]={ id:a.id, n:a.n };
    }
    const opts={ weapons:[...sel.w], armor:sel.a, helmet:sel.h, shield:sel.s, insure:UI._raidIns&&gearVal>0, keys:pickedKeys,
                 cash:cashIn, tokens:tokIn, ammo:ammoPick };
    UI._raidSel={w:[],a:null,h:null,s:null}; UI._raidIns=false;
    game.startRaid(opts);
  };
};

UI.raidResult=function(res){
  const colOf=(it)=>{
    if(it.kind==="armor"||it.kind==="helmet") return ARMOR_TIER_COLOR[it.tier]||raidGunColor(it);
    return raidGunColor(it);
  };
  let itemsHtml="";
  if(res.success){
    const list=[];
    for(const w of res.looted.weapons) list.push(`<span style="color:${colOf(w)}">${w.name}</span>`);
    for(const a of res.looted.armors) list.push(`<span style="color:${colOf(a)}">${a.name}</span>`);
    for(const h of (res.looted.helmets||[])) list.push(`<span style="color:${colOf(h)}">${h.name}</span>`);
    for(const s of (res.looted.shields||[])) list.push(`<span style="color:${shieldColor(s)}">${s.name}(护盾)</span>`);
    // 同种原材料合并成一堆（带 ×N），避免结算列表被一串「废金属」刷屏
    const agg=(arr)=>{
      const g=[];
      for(const m of (arr||[])){
        const s=g.find(x=>x.id===m.id);
        if(s) s.n++; else g.push({ id:m.id, m, n:1 });
      }
      return g.map(s=>`<span style="color:${s.m.color||'#dfe7f0'}">${s.m.name}(原材料)${s.n>1?' ×'+s.n:''}</span>`);
    };
    for(const pt of (res.looted.parts||[])) list.push(`<span style="color:${colOf(pt)}">${pt.name}(配件)</span>`);
    for(const h of agg(res.looted.materials)) list.push(h);
    itemsHtml = list.length ? list.join(" · ") : `<span style="color:var(--muted)">空手而归</span>`;
  } else {
    const lost=[];
    for(const w of (res.lost.weapons||[])) lost.push(`<span style="color:${colOf(w)}">${w.name}</span>`);
    if(res.lost.armor) lost.push(`<span style="color:${colOf(res.lost.armor)}">${res.lost.armor.name}</span>`);
    if(res.lost.helmet) lost.push(`<span style="color:${colOf(res.lost.helmet)}">${res.lost.helmet.name}</span>`);
    if(res.lost.shield) lost.push(`<span style="color:${shieldColor(res.lost.shield)}">${res.lost.shield.name}(护盾)</span>`);
    for(const w of (res.lost.lootW||[])) lost.push(`<span style="color:${colOf(w)}">${w.name}(物品栏)</span>`);
    for(const h of (res.lost.lootH||[])) lost.push(`<span style="color:${colOf(h)}">${h.name}(物品栏)</span>`);
    for(const pt of (res.lost.lootP||[])) lost.push(`<span style="color:${colOf(pt)}">${pt.name}(配件)</span>`);
    { const g=[]; for(const m of (res.lost.lootM||[])){
        const s=g.find(x=>x.id===m.id); if(s) s.n++; else g.push({ id:m.id, m, n:1 });
      }
      for(const s of g) lost.push(`<span style="color:${s.m.color||'#dfe7f0'}">${s.m.name}(原材料)${s.n>1?' ×'+s.n:''}</span>`);
    }
    itemsHtml = lost.length ? lost.join(" · ") : `<span style="color:var(--muted)">无装备损失</span>`;
  }
  const recoveredHtml = (res.recovered&&res.recovered.length)
    ? `<div class="raid-result-label" style="color:#8fe07a;">保险理赔 · 无人捡走退回：</div>
       <div class="raid-result-items">${res.recovered.map(it=>`<span style="color:${colOf(it)}">${it.name}</span>`).join(" · ")}</div>` : "";
  const insNote = res.insured ? `<div class="hint">本次已支付保费 ₽${res.insuredPaid}。</div>` : "";
  const mm=Math.floor(res.time/60), ss=Math.floor(res.time%60);
  UI._set(`
    <div class="panel" style="text-align:center;max-width:600px;">
      <h2 class="title-big" style="font-size:40px;color:${res.success?'#8fe07a':'#ff6a5a'};">
        ${res.success?"✓ 撤离成功":"✕ MIA · 行动失败"}</h2>
      <div class="subtitle">${res.success?`从 ${res.zone} 成功撤离`:(res.reason||"阵亡")}</div>
      <div class="raid-result-grid">
        <div><span class="rr-k">存活时长</span><b>${mm}分${ss}秒</b></div>
        <div><span class="rr-k">击杀数</span><b>${res.kills}</b></div>
        ${res.success?`<div><span class="rr-k">带出卢布</span><b style="color:#8fe07a">₽ ${res.creds}</b></div>`:``}
        ${res.success&&res.tokens?`<div><span class="rr-k">GP 币</span><b style="color:#c07bff">◆ ${res.tokens}</b></div>`:``}
        ${res.success&&res.returned.materials?`<div><span class="rr-k">原材料</span><b style="color:#ffd76a">${res.returned.materials}</b></div>`:``}
      </div>
      <div class="raid-result-label">${res.success?"带出并入库：":"丢失："}</div>
      <div class="raid-result-items">${itemsHtml}</div>
      ${recoveredHtml}
      <div class="row" style="justify-content:center;margin-top:18px;">
        <button class="btn" id="btn-raid-again">返回大厅</button>
      </div>
      <div class="hint" style="margin-top:10px;">${res.success?"装备与战利品已写入仓库。":"携带的装备与战利品已丢失——下次可裸装下场或购买保险。"}${insNote}</div>
    </div>`);
  document.getElementById('btn-raid-again').onclick=()=>{
    SFX.ui(); UI._raidSel={w:[],a:null,h:null,s:null}; UI._raidIns=false;
    if(typeof Net!=="undefined" && Net.online) Net.leave(true);   // 联机：结算后退出房间
    game.toTitle();          // 复位模式与画布状态
    UI.raidSetup();          // 直接回配装大厅（超市 / 枪匠台 / 仓库 / 拍卖行都在这里）
  };
};

UI.raidPause=function(confirmQuit){
  /* 放弃是不可逆的（携带装备 + 全部战利品直接蒸发），必须二次确认 ——「返回大厅」和
     「放弃」摆在同一个面板上、又都靠近「继续行动」，一次误触就白打一局。 */
  if(confirmQuit){
    UI._set(`
      <div class="panel" style="text-align:center;max-width:480px;border-color:rgba(255,110,90,0.45);">
        <h2 class="title-big" style="font-size:30px;color:#ff8a5a;">确认放弃这一局？</h2>
        <div class="subtitle">不可撤销</div>
        <p style="color:var(--muted);line-height:1.7;">
          放弃 = 本局判负：<b style="color:#ff8a5a">手上的枪械 / 护甲 / 头盔 / 护盾、带进来的卢布与 GP 币、以及全部战利品会直接丢失</b>。
          ${Raid.insured ? '<br>已投保的装备按 <b style="color:#8fe07a">65%</b> 概率退回仓库。' : ''}
        </p>
        <div class="row" style="justify-content:center;margin-top:16px;">
          <button class="btn" id="btn-quit-cancel">再想想（继续行动）</button>
          <button class="btn ghost" id="btn-quit-ok" style="border-color:#a8342a;color:#ff9a8a;">确认放弃</button>
        </div>
      </div>`);
    document.getElementById('btn-quit-cancel').onclick=()=>{ SFX.ui(); UI.raidPause(); };
    document.getElementById('btn-quit-ok').onclick=()=>{
      SFX.ui();
      // 主动放弃 = 失败（携带装备丢失，已投保的按保险规则处理）
      Raid._fail("主动放弃突袭");
    };
    return;
  }
  UI._set(`
    <div class="panel" style="text-align:center;max-width:460px;">
      <h2 class="title-big" style="font-size:32px;">已暂停</h2>
      <div class="subtitle">塔科夫模式 · 地图「海关流域」（工业区 / 密林 / 河谷 / 铁路 / 监狱 / 小镇 / 大坝）</div>
      <p style="color:var(--muted);">撤离倒计时已停止。继续行动，或放弃突袭返回大厅。</p>
      <div class="row" style="justify-content:center;margin-top:16px;">
        <button class="btn ghost" id="btn-raid-quit">放弃突袭（装备丢失）</button>
        <button class="btn ghost" id="btn-pause-settings">设置 · 2D/3D</button>
        <button class="btn" id="btn-raid-resume">继续行动</button>
      </div>
    </div>`);
  document.getElementById('btn-raid-resume').onclick=()=>{ SFX.ui(); game.resume(); };
  document.getElementById('btn-raid-quit').onclick=()=>{
    SFX.ui();
    UI.raidPause(true);          // 先确认，不直接判负
  };
};

/* =========================================================================
 * 军火超市（Arms Supermarket）
 *   用塔科夫仓库的卢布采购枪械 / 护甲 / 绷带，直接入库到 RaidStash，
 *   可在配装大厅携带下场或投保。撤离成功才会真正带走；阵亡或超时全部丢失。
 * ========================================================================= */
UI.raidShop=function(opts){
  opts=opts||{};
  // 每次打开货架都重新随机（切 tab 时保留当前批次）
  if(!opts.keep){ UI._raidShopGuns=null; UI._raidShopParts=null; UI._raidShopHelmets=null; }
  const stash=RaidStash.load();
  if(UI._raidShopTab===undefined) UI._raidShopTab="weapon";
  const TAB=UI._raidShopTab;
  // 护甲仍按估值着色
  const rarOf=v=> v>=700?2 : v>=400?1 : 0;

  // 军火超市：每次进入刷新一批旧刷宝体系枪械（按枪型铺货）
  if(!UI._raidShopGuns){
    const W=g=>{ const w=blGunGen(12,{type:g, weights:{white:4,green:8,blue:6,purple:2.4,orange:0.7,pearl:0.22,ancient:0.08,rainbow:0.02}}); ensureGunAffixes(w); w.uid=raidUniqueUid("shop-"+g+"-"); w.kind="weapon"; return w; };
    UI._raidShopGuns = RAID_GUN_TYPES.map(W);
  }

  const wCards=UI._raidShopGuns.map(g=>{
    const col=raidGunColor(g);
    const tname=WEAPON_TYPES[g.type]?WEAPON_TYPES[g.type].name:g.cat;
    const elem=g.element&&g.element!=="none"?(ELEMENTS[g.element]?ELEMENTS[g.element].name:""):"";
    const aff=g.affixes.slice(0,2).map(a=>a.mods.map(m=>affixText(m)).join("，")).join("；");
    const price=raidSuperPrice(g.value, g.uid), can=stash.creds>=price;
    return `<div class="shop-item" style="border-left-color:${col}">
      <div class="si-thumb">${gunSvg(g,46)}</div>
      <div class="si-name" style="color:${col}">${g.name}</div>
      <div class="si-meta">${tname}${elem?(' · '+elem):''} · ${g.auto?'全自动':'半自动'}${g.pellets>1?(g.type==="shotgun"?(' · '+g.pellets+' 弹丸'):` · <b style="color:#ffd54a">${g.pellets} 发/次</b>`):''}</div>
      <div class="si-stats">伤害 ${g.dmg} · 弹匣 ${g.mag} · 射速 ${g.rpm}<br>射程 ${g.range} · 穿甲 ${Math.round((g.armorPen||0)*100)}% · 备弹 ${g.reserve}${aff?(' · '+aff):''}</div>
      <div class="si-buy"><span class="si-price ${can?'':'cant'}">₽ ${priceText(price)}</span>
        <button class="btn" data-buy="weapon:${g.uid}" ${can?'':'disabled'}>购买</button></div>
    </div>`;
  }).join('');

  // 9 级护甲（仅售普通品质；稀有度靠掉落 / 融合）
  const aCards=RAID_ARMOR_TIERS.map(t=>{
    const a=RAID_ARMORS[t], price=raidSuperPrice(a.value, "armor"+t), can=stash.creds>=price, col=ARMOR_TIER_COLOR[t];
    const maxRar = Math.min(8, Math.max(0, t-1));
    const grade = t>=8?'重型防弹衣' : (t>=6?'插板背心' : (t>=3?'防弹背心':'软质背心'));
    return `<div class="shop-item" style="border-left-color:${col}">
      <div class="si-name" style="color:${col}">${a.name}</div>
      <div class="si-meta">T${t} ${grade} · ${t>=8?'最高防护级':(t>=6?'高防护级':'制式')} · 掉落可至 <b style="color:${RAID_RARITY_COLOR[maxRar]}">${RAID_RARITY_NAME[maxRar]}</b></div>
      <div class="si-stats">减伤 ${Math.round(a.dr*100)}% · 护甲值 ${a.maxArmor}${t>=6?'<br><b style="color:#ff8a5a">重装：可硬吃整梭步枪弹</b>':''}</div>
      <div class="si-buy"><span class="si-price ${can?'':'cant'}">₽ ${priceText(price)}</span>
        <button class="btn" data-buy="armor:${t}" ${can?'':'disabled'}>购买</button></div>
    </div>`;
  }).join('');

  // 9 级头盔
  const hCards=RAID_ARMOR_TIERS.map(t=>{
    const h=RAID_HELMETS[t], price=raidSuperPrice(h.value, "helmet"+t), can=stash.creds>=price, col=ARMOR_TIER_COLOR[t];
    const maxRar = Math.min(8, Math.max(0, t-1));
    const grade = t>=8?'全罩头盔' : (t>=6?'防弹头盔' : (t>=3?'战术头盔':'软质头套'));
    return `<div class="shop-item" style="border-left-color:${col}">
      <div class="si-name" style="color:${col}">${h.name}</div>
      <div class="si-meta">T${t} ${grade} · ${t>=8?'最高防护级':(t>=6?'高防护级':'制式')} · 掉落可至 <b style="color:${RAID_RARITY_COLOR[maxRar]}">${RAID_RARITY_NAME[maxRar]}</b></div>
      <div class="si-stats">爆头减伤 ${Math.round(h.dr*100)}% · 耐久 ${h.maxArmor}</div>
      <div class="si-buy"><span class="si-price ${can?'':'cant'}">₽ ${priceText(price)}</span>
        <button class="btn" data-buy="helmet:${t}" ${can?'':'disabled'}>购买</button></div>
    </div>`;
  }).join('');

  // 配件货架：每次进店刷新一批（6~8 个）
  if(!UI._raidShopParts){
    const arr=[];
    for(let i=0;i<8;i++){
      const slot=RNG.pick(GUN_SLOTS).id;
      const pool=[{weight:30,k:"green"},{weight:26,k:"blue"},{weight:16,k:"purple"},{weight:8,k:"orange"},{weight:3,k:"pearl"}];
      const rar=pool[RNG.weighted(pool)].k;
      const pt=rollPart(slot, 13, rar);
      arr.push(pt);
    }
    UI._raidShopParts=arr;
  }
  const pCards=UI._raidShopParts.map((pt,i)=>{
    const price=raidSuperPrice(partValue(pt), pt.uid), can=stash.creds>=price, col=(RARITY_BY_ID[pt.rarity]||{color:"#cfd8e2"}).color;
    const slotName=GUN_SLOT_BY_ID[pt.slot]?GUN_SLOT_BY_ID[pt.slot].name:pt.slot;
    return `<div class="shop-item" style="border-left-color:${col}">
      <div class="si-name" style="color:${col}">${pt.name}</div>
      <div class="si-meta">配件 · ${slotName}槽位</div>
      <div class="si-stats">${partText(pt)}</div>
      <div class="si-buy"><span class="si-price ${can?'':'cant'}">₽ ${price}</span>
        <button class="btn" data-buy="part:${i}" ${can?'':'disabled'}>购买</button></div>
    </div>`;
  }).join('');

  // 医疗货架：5 种医疗品（绷带单独计数，其余进医疗包堆叠）
  const medCard = RAID_MEDS.map(m=>{
    const price=raidSuperPrice(m.value, m.id), can=stash.creds>=price;
    const have = m.id==="bandage" ? (stash.bandages||0) : ((stash.meds&&stash.meds[m.id])||0);
    const col=RAID_RARITY_COLOR[m.tier];
    return `<div class="shop-item" style="border-left-color:${col}">
      <div class="si-name" style="color:${col}">${m.name} ×1</div>
      <div class="si-meta">医疗品 · T${m.tier+1} · ${m.desc}</div>
      <div class="si-stats">治疗耗时 ${m.cast}s${m.heal?` · 回血 ${m.heal}`:""}${m.bleed?" · 止血":""} · 当前库存 ${have}</div>
      <div class="si-buy"><span class="si-price ${can?'':'cant'}">₽ ${priceText(price)}</span>
        <button class="btn" data-buy="med:${m.id}" ${can?'':'disabled'}>购买</button></div>
    </div>`;
  }).join('');

  // v0.16.0：护盾货架（每次进店刷新一批，9 个等级各一件普通品质）
  if(!UI._raidShopShields){
    UI._raidShopShields=SHIELD_TIERS.map(t=>raidMakeShield(t,0));
  }
  const sCards=UI._raidShopShields.map(s=>{
    const col=shieldColor(s), price=raidSuperPrice(s.value, s.uid), can=stash.creds>=price;
    return `<div class="shop-item" style="border-left-color:${col}">
      <div class="si-name" style="color:${col}">${s.name}</div>
      <div class="si-meta">T${s.tier} 护盾 · ${(s.parts||[]).length} 个配件 · 前后缀 ${(s.affixes||[]).map(a=>a.nm).join(" · ")}</div>
      <div class="si-stats">${shieldLines(s).join(" · ")}</div>
      <div class="si-buy"><span class="si-price ${can?'':'cant'}">₽ ${priceText(price)}</span>
        <button class="btn" data-buy="shield:${s.uid}" ${can?'':'disabled'}>购买</button></div>
    </div>`;
  }).join('');

  const tabs=[{id:'weapon',name:'枪械',tag:'WEAPONS'},{id:'armor',name:'护甲',tag:'ARMOR'},
    {id:'helmet',name:'头盔',tag:'HELMET'},{id:'shield',name:'护盾',tag:'SHIELD'},
    {id:'part',name:'配件',tag:'PARTS'},{id:'med',name:'医疗',tag:'MEDS'}];
  const backLabel = opts.from==='title' ? '返回主菜单' : '前往配装大厅';

  UI._set(`
    <div class="panel raid-setup">
      <h2 class="title-big" style="font-size:32px;">军火超市</h2>
      <div class="subtitle">ARMS SUPERMARKET · 用卢布采购装备入库，带入下一局突袭</div>
      <div class="shop-bar">
        <div class="shop-desc">这里只卖<b style="color:#ffd23f">成品</b>：枪械 / 护甲 / 头盔 / 护盾 / 配件 / 医疗品，
          护盾按<b style="color:#4fd6ff">容量 / 充能速度 / 充能延迟</b>三数值与配件、前后缀、独特加成区分；<b style="color:#ffd23f">全场统一按「估价 × 2.0（±0.5）」结算</b>——外场买贵，局内摊位便宜得多；<b style="color:#ff9a3a">原材料、底材、改装模块一律不卖</b>——原材料与底材可以在枪匠台「工坊」用材料合成；<b style="color:#ff9a3a">改装模块完全不能合成</b>，只能从保险箱 / Raider 掉落，或在<b style="color:#7fd0ff">局内枪械商店（低阶）与黑市（高阶）</b>购买。<br>
        护甲等级 T1~T9 与品质一一对应；<b style="color:#8fe07a">枪械与配件大多只有 1 条词缀，少数带 2 条以上</b>（护甲 / 头盔固定 1 前缀 + 1 后缀），买之前先看词条。仅撤离成功才会真正带走。<br>
        <span style="color:var(--muted)">品质阶梯（低 → 高）：</span>${raidTierLegend()}</div>
        <div class="shop-gold">仓库卢布 ₽ ${priceTextShort(stash.creds)}</div>
        <button class="btn ghost" id="btn-shop-refresh" ${stash.creds>=500?'':'disabled'}>刷新货架 ₽500</button>
        <button class="btn ghost" id="btn-shop-back">${backLabel}</button>
      </div>
      <div class="shop-tabs">
        ${tabs.map(t=>`<button class="shop-tab ${TAB===t.id?'on':''}" data-tab="${t.id}"><b>${t.name}</b><span class="tab-tag">${t.tag}</span></button>`).join('')}
      </div>
      <div class="shop-list">
        ${TAB==='weapon'?wCards : TAB==='armor'?aCards : TAB==='helmet'?hCards : TAB==='shield'?sCards : TAB==='part'?pCards : medCard}
      </div>
      <div class="hint" style="margin-top:12px;">卢布来自突袭中搜刮与撤离带出（V-EX 雇车等会消耗）。先下场搜刮攒钱，再来超市补强配装与绷带。</div>
    </div>`);

  const refreshBtn=document.getElementById('btn-shop-refresh');
  if(refreshBtn) refreshBtn.onclick=()=>{
    if(stash.creds<500) return;
    stash.creds-=500; RaidStash.save(stash);
    UI._raidShopGuns=null; UI._raidShopParts=null; UI._raidShopHelmets=null; UI._raidShopShields=null;
    SFX.ui(); UI.raidShop(opts);
  };
  UI.overlay.querySelectorAll('[data-tab]').forEach(el=>{
    el.onclick=()=>{ UI._raidShopTab=el.dataset.tab; SFX.ui(); UI.raidShop(Object.assign({}, opts, {keep:true})); };
  });
  UI.overlay.querySelectorAll('[data-buy]').forEach(el=>{
    el.onclick=()=>{
      const parts=el.dataset.buy.split(':'); const type=parts[0]; const key=parts[1];
      /* v0.19.0：局外军火超市统一按 估价 × (2.0 ± 0.5) 结算 */
      if(type==='bandage'){
        const price=raidSuperPrice((RAID_MED_BY_ID.bandage||{}).value||100, "bandage");
        if(stash.creds<price) return;
        stash.creds-=price; stash.bandages=(stash.bandages||0)+1;
      } else if(type==='med'){
        const price=raidSuperPrice((RAID_MED_BY_ID[key]||{}).value||100, key);
        if(stash.creds<price) return;
        stash.creds-=price;
        if(key==='bandage') stash.bandages=(stash.bandages||0)+1;
        else { stash.meds=stash.meds||{}; stash.meds[key]=(stash.meds[key]||0)+1; }
      } else if(type==='weapon'){
        const i=UI._raidShopGuns.findIndex(g=>g.uid===key);
        const src=i>=0?UI._raidShopGuns[i]:null;
        if(!src) return;
        const price=raidSuperPrice(src.value, src.uid);
        if(stash.creds<price) return;
        stash.creds-=price;
        stash.weapons.push(Object.assign({}, src));
        UI._raidShopGuns.splice(i,1);   // 买走即下架，不能反复买同一把
      } else if(type==='armor'){
        const tier=+key, src=RAID_ARMORS[tier];
        if(!src) return;
        const price=raidSuperPrice(src.value, "armor"+tier);
        if(stash.creds<price) return;
        stash.creds-=price;
        stash.armors.push(raidMakeArmor(tier, 0));
      } else if(type==='helmet'){
        const tier=+key, src=RAID_HELMETS[tier];
        if(!src) return;
        const price=raidSuperPrice(src.value, "helmet"+tier);
        if(stash.creds<price) return;
        stash.creds-=price;
        stash.helmets.push(raidMakeHelmet(tier, 0));
      } else if(type==='shield'){
        const i=UI._raidShopShields.findIndex(s=>s.uid===key);
        const src=i>=0?UI._raidShopShields[i]:null;
        if(!src) return;
        const price=raidSuperPrice(src.value, src.uid);
        if(stash.creds<price) return;
        stash.creds-=price;
        (stash.shields=stash.shields||[]).push(Object.assign({}, src));
        UI._raidShopShields.splice(i,1);   // 买走即下架
      } else if(type==='part'){
        const idx=+key, pt=UI._raidShopParts[idx];
        if(!pt) return;
        const price=raidSuperPrice(partValue(pt), pt.uid);
        if(stash.creds<price) return;
        stash.creds-=price;
        const bought=JSON.parse(JSON.stringify(pt));
        bought.uid=raidUniqueUid("pt-");
        stash.parts.push(bought);
        UI._raidShopParts.splice(idx,1);
      }
      // 购买后保留当前货架（keep:true），不再“买一件就免费重掷整个商店”。
      RaidStash.save(stash); SFX.ui(); UI.raidShop(Object.assign({}, opts, {keep:true}));
    };
  });
  document.getElementById('btn-shop-back').onclick=()=>{
    UI._raidShopGuns=null;            // 下次进入刷新一批新枪
    UI._raidShopParts=null;           // 配件货架也刷新
    UI._raidShopShields=null;         // 护盾货架也刷新
    SFX.ui();
    if(opts.from==='title') UI.title(); else UI.raidSetup();
  };
};

/* =========================================================================
 * 枪匠台 · 精密改装（Rakanishu 赫拉迪克方块式改造）
 *   对塔科夫仓库里的旧刷宝体系枪械做「重铸词缀 / 更换弹种 / 升阶改装」，
 *   用仓库卢布支付；改造后数值由生成管线重算，直接覆盖仓库中的那把枪。
 * ========================================================================= */
const FORGE_RARITY_MULT = { white:1, green:1.4, blue:2, purple:3.2, orange:5, pearl:7,
  ancient:10, rainbow:14, mythic:20, primordial:28, celestial:38, singularity:52 };
function forgeCost(op, gun){
  const rm = FORGE_RARITY_MULT[gun.rarity] || 1;
  if(op==="reroll")  return Math.round(260*rm/10)*10;
  if(op==="element") return Math.round(480*rm/10)*10;
  if(op==="mayhem")  return Math.round(700*(gun.mayhem+1)*rm/10)*10;
  if(op==="part")    return Math.round(140*rm/10)*10;
  return 999999;
}

/* ----------------------------- 融合台 ----------------------------- */
// 两件及以上同栏位物品熔成一件：品质、词条、改装等级有概率跃升
function fuseCost(items){
  const v=items.reduce((sum,it)=>sum+(it.value||partValue(it)||0),0);
  // 融合造价大幅下调（原 55% + 300，现 25% + 120），让融合成为可负担的品质跃升手段
  return Math.round(v*0.25/10)*10 + 120;
}
function fuseRaidItems(items){
  if(!items || items.length<2) return null;
  const main=items[0], n=items.length;

  // 改装模块不可融合升阶（只能掉落 / 购买），直接拒绝
  if(main.slot==="core" || main.core) return null;
  const rarIdx = o=>Math.max(0, RARITIES.findIndex(r=>r.id===(o.rarity||"white")));
  const mkUid = pre=>pre+Date.now().toString(36)+Math.floor(Math.random()*999).toString(36);

  // 枪械（主物品为枪）
  if(main.kind==="weapon" || main.dmg!==undefined){
    const ilvl=Math.max(10, ...items.map(i=>i.ilvl||10)) + n*2;
    const maxRar=Math.max(...items.map(rarIdx));
    const boost=1 + (n>=3?1:0) + (n>=4?1:0);
    const targetRar=RARITIES[Math.min(RARITIES.length-1, maxRar+boost)].id;
    const R=RARITY_BY_ID[targetRar];

    // 配件：所有枪的配件 + 散装配件，按槽位去重，品质各升一档
    const bySlot={}, slotRank={};
    for(const it of items){
      const list = it.kind==="part" ? [it] : (it.parts||[]);
      for(const p of list){
        const pi=Math.max(0, RARITIES.findIndex(r=>r.id===p.rarity));
        if(slotRank[p.slot]===undefined || pi>slotRank[p.slot]){
          slotRank[p.slot]=pi;
          const up=RARITIES[Math.min(RARITIES.length-1, pi+1)].id;
          bySlot[p.slot]=Object.assign({}, p, {rarity:up, uid:mkUid("fp")});
        }
      }
    }
    const parts=Object.values(bySlot).slice(0,10);

    // 词缀：从材料里继承，再补掷，保证前后缀与数量
    const pool=[];
    for(const it of items) for(const a of (it.affixes||[])) pool.push(a);
    const want=Math.min(10, 3 + (n-1) + (RNG.chance(0.5)?1:0));
    const affixes=[];
    while(affixes.length<want && pool.length){
      const i=RNG.ri(0,pool.length-1);
      const a=pool.splice(i,1)[0];
      if(a && !affixes.some(x=>x.nm===a.nm)){
        const cp=JSON.parse(JSON.stringify(a));
        cp.mods=(cp.mods||[]).map(m=>({stat:m.stat, value:Math.round(m.value*1.15*10)/10}));
        affixes.push(cp);
      }
    }
    if(affixes.length<3){
      for(const a of rollAffixes(R, ilvl, {element:main.element||"none"})){
        if(affixes.length>=want) break;
        if(!affixes.some(x=>x.nm===a.nm)) affixes.push(a);
      }
    }
    const mayhem=Math.max(0,...items.map(i=>i.mayhem||0)) + (RNG.chance(0.30+n*0.06)?1:0);
    const out=blGunConvert(generateWeapon(ilvl,{
      rarity:targetRar, type:main.type, manufacturer:main.manufacturer,
      element:main.element||"none", ilvl, mayhem, affixes, parts,
    }));
    out.uid=mkUid("fz"); out.kind="weapon";
    // 与组装枪一致地补齐显示字段（保证融合台结果卡与物品栏完全一致）
    const _R=RARITY_BY_ID[targetRar];
    out.qTier=RARITIES.indexOf(_R); out.qName=_R.name; out.qColor=_R.color;
    return out;
  }

  // 护盾：按同栏位护盾的等级 / 品级跃升，配件与前后缀按新表重掷
  if(main.kind==="shield"){
    const same=items.filter(i=>i.kind==="shield");
    const maxTier=Math.max(...same.map(i=>i.tier||1));
    const tier=Math.min(9,maxTier+(n>=3 && RNG.chance(0.35)?1:0));
    const maxR=Math.max(...same.map(i=>qOf(i)));
    const rar=Math.min(8,maxR+1+(n>=3?1:0));
    return raidMakeShield(tier,rar);
  }

  // 护甲 / 头盔
  if(main.kind==="armor" || main.kind==="helmet"){
    const same=items.filter(i=>(i.kind===main.kind)||(main.kind==="armor"&&i.kind===undefined));
    const maxTier=Math.max(...same.map(i=>i.tier||1));
    const tier=Math.min(9, maxTier + (n>=3 && RNG.chance(0.35)?1:0));
    const maxR=Math.max(...same.map(i=>i.rarity|0));
    const rar=Math.min(8, maxR + 1 + (n>=3?1:0));
    return main.kind==="helmet" ? raidMakeHelmet(tier,rar) : raidMakeArmor(tier,rar);
  }

  // 配件
  const slot=main.slot || RNG.pick(GUN_SLOTS).id;
  const ilvl=Math.max(10,...items.map(i=>i.ilvl||10)) + n*2;
  const maxR=Math.max(...items.map(rarIdx));
  const up=RARITIES[Math.min(RARITIES.length-1, maxR+1+(n>=3?1:0))].id;
  const pt=rollPart(slot, ilvl, up);
  pt.uid=mkUid("fp"); pt.kind="part";
  return pt;
}

/* ----------------------------- 枪械组装（底材 + 配件 + 材料） ----------------------------- */
// 组装投料份数：底材再贵也要自己配齐 8 份材料才能开装
const RAID_ASSEMBLE_MATS = 8;
const RAID_TYPE_BOOST = {
  rifle:  { dmg:1.08, rpm:1.04, value:1.06, label:"突击步枪强化 +8% 伤害 / +4% 射速" },
  sniper: { dmg:1.14, range:1.06, value:1.08, label:"狙击强化 +14% 伤害 / +6% 射程" },
};
// 品质由「底材等级 / 配件平均品质 / 材料平均品质」共同决定；枪名由底材与配件决定
function assembleRaidGun(recv, parts, mats){
  const partTier = parts.length
    ? parts.reduce((s,p)=>s+Math.max(0,RARITIES.findIndex(r=>r.id===p.rarity)),0)/parts.length
    : 0;
  const matTier = mats.length ? mats.reduce((s,m)=>s+(m.tier||0),0)/mats.length : 0;
  const qTier = M.clamp(Math.round(recv.tier*0.35 + partTier*0.45 + matTier*0.20), 0, 8);
  const ilvl = 12 + qTier*2 + parts.length*2 + mats.length*2;
  const out = blGunConvert(generateWeapon(ilvl, {
    type: recv.gunType,
    rarity: RAID_TIER_TO_RARITY[qTier] || "white",
    parts: parts.slice(),
  }));
  // 突击步枪 / 狙击枪投料最贵，给一点实打实的回报（伤害为主，狙击补射程）
  const boost = RAID_TYPE_BOOST[recv.gunType];
  if(boost){
    if(boost.dmg)   out.dmg   = Math.round(out.dmg*boost.dmg*10)/10;
    if(boost.rpm)   out.rpm   = Math.round(out.rpm*boost.rpm);
    if(boost.range) out.range = Math.round(out.range*boost.range);
    out.value = Math.round(out.value*(boost.value||1));
    out.typeBoost = boost.label;
  }
  // 组装枪名直接采用 generateWeapon 产出的名字（前缀+型号+后缀），
  // 不再拼「品质·底材·配件」三名词组合。
  out.receiver = recv.short;   // 记录所用底材型号（结算/图鉴用，不在主名称里展示）
  // out.name 已由 generateWeapon / blGunConvert 生成好，保持原样
  out.uid="as"+Date.now().toString(36)+Math.floor(Math.random()*999).toString(36);
  out.kind="weapon";
  ensureGunAffixes(out);
  out.qTier=qTier; out.qName=RAID_TIERS[qTier].name; out.qColor=RAID_TIERS[qTier].color;
  out.assembledFrom={ receiver:recv.id, parts:parts.map(p=>p.uid), mats:mats.map(m=>m.id) };
  return out;
}

function raidMatCount(stash, id){
  return (stash.materials||[]).filter(m=>m.id===id).length;
}
function raidCoreGroups(cores){
  const map={};
  for(const c of (cores||[])){
    const k=c.core+"|"+(c.elem||c.boost||"")+"|"+c.lv;
    if(!map[k]) map[k]={ core:c.core, elem:c.elem||null, lv:c.lv, n:0, sample:c };
    map[k].n++;
  }
  return Object.values(map);
}

UI.raidWorkshop=function(opts){
  opts=opts||{};
  const stash=RaidStash.load();
  stash.receivers=stash.receivers||[];
  stash.materials=stash.materials||[]; stash.parts=stash.parts||[];
  const cores = stash.parts.filter(p=>p.core);   // 改装模块已并入配件池，按 core 字段筛选
  if(!UI._wsRecv || !stash.receivers.some(r=>r.uid===UI._wsRecv)) UI._wsRecv = stash.receivers[0]?stash.receivers[0].uid:null;
  // 配件不再限制 4 件 —— 每个槽位各装一件，最多装满 GUN_SLOTS 全部槽位
  UI._wsParts = (UI._wsParts||[]).filter(uid=>stash.parts.some(p=>p.uid===uid));
  { const seen={};
    UI._wsParts = UI._wsParts.filter(uid=>{
      const pt=stash.parts.find(p=>p.uid===uid); if(!pt) return false;
      if(seen[pt.slot]) return false; seen[pt.slot]=true; return true;
    });
  }
  UI._craft = UI._craft || { id:null, sel:[] };
  // 组装要投 8 份材料，同一种材料可以投多份
  { const keep=[];
    const used={};
    for(const id of (UI._wsMats||[])){
      if(!RAID_MAT_BY_ID[id]) continue;
      used[id]=(used[id]||0)+1;
      if(keep.length>=RAID_ASSEMBLE_MATS) continue;
      if(used[id]>raidMatCount(stash,id)) continue;
      keep.push(id);
    }
    UI._wsMats=keep;
  }

  /* --- 模块一览 --- */
  const groups=raidCoreGroups(cores);
  const coreRows = groups.length ? groups.map(g=>{
    const name=raidCoreName(g.sample||g);
    const col=raidCoreColor(g.sample||g);
    const sub=Array.isArray((g.sample||{}).mods) ? g.sample.mods : [];
    const modTxt=sub.map(m=>`${AFFIX_LABEL[m.stat]||m.stat} +${m.value}`).join(" · ");
    const body = g.core==="chaos"
      ? `改装等级 ${RAID_ROMAN[g.lv]} · 装入后伤害 ×${Math.pow(MAYHEM.corePower,g.lv).toFixed(2)}`
      : (modTxt || "属性增益");
    return `<div class="shop-item" style="border-left-color:${col}">
      <div class="si-name" style="color:${col}">${name} ×${g.n}</div>
      <div class="si-meta">${body}</div>
      <div class="si-stats" style="opacity:.6;font-size:11px">估值 ₽${priceTextShort(raidCoreValue(g.core,g.lv))} · 仅掉落 / 购买</div>
    </div>`;
  }).join('') : `<div class="empty-hint">还没有改装模块 · 只能从<b>保险箱 / Raider</b>身上掉落，或在<b>枪械商店 / 黑市</b>购买</div>`;
  stash.keys=stash.keys||[];

  /* --- 合成表：自选材料，产物品质随材料等级走 --- */
  const matMap={};
  for(const m of stash.materials) matMap[m.id]=(matMap[m.id]||0)+1;
  const actRec = RAID_RECIPES.find(r=>r.id===UI._craft.id) || null;
  const recipeRows = RAID_RECIPES.map(r=>{
    const on = !!actRec && actRec.id===r.id;
    const sel = on ? UI._craft.sel : [];
    const mats = sel.map(id=>RAID_MAT_BY_ID[id]).filter(Boolean);
    const full = sel.length>=r.slots;
    // 投料标签按材料聚合（同一种材料可重复投），点一下减 1 份
    const groups=[];
    for(const id of sel){
      const g=groups.find(x=>x.id===id);
      if(g) g.n++; else groups.push({ id:id, n:1 });
    }
    const slotsHTML = groups.map(g=>{
      const m=RAID_MAT_BY_ID[g.id]||{name:g.id,tier:0};
      return `<span class="mat-slot on" data-unsmat="${g.id}" title="点击移除 1 份" style="border-color:${RAID_RARITY_COLOR[m.tier]};color:${RAID_RARITY_COLOR[m.tier]}">${m.name}${g.n>1?" ×"+g.n:""} ✕</span>`;
    }).join("") || `<span class="mat-slot">＋ 待投料 · 需 ${r.slots} 份</span>`;
    const fillHTML=`<div class="craft-fill"><span>投料 <b style="color:${full?'#7fe08a':'#ffd23f'}">${sel.length}/${r.slots}</b></span>
      <div class="craft-bar"><i style="width:${Math.round(sel.length/r.slots*100)}%;background:${full?'#7fe08a':'#ffd23f'}"></i></div></div>`;
    let qInfo=`<div class="si-stats" style="opacity:.62">产出品质由所选材料决定 · 需要 ${r.slots} 份材料</div>`;
    let fee=raidCraftFee([], r.slots);
    let can=false;
    if(full){
      const rg=raidCraftQRange(mats);
      const c0=RAID_RARITY_COLOR[rg[0]], c1=RAID_RARITY_COLOR[rg[1]];
      qInfo=`<div class="si-stats">产出品质 <b style="color:${c0}">${RAID_TIERS[rg[0]].name}</b>`+
        (rg[1]!==rg[0]?` ~ <b style="color:${c1}">${RAID_TIERS[rg[1]].name}</b>`:"")+
        `<span style="opacity:.6"> · 材料均值 T${raidAvgMatTier(mats).toFixed(1)}</span></div>`;
      fee=raidCraftFee(mats, r.slots);
      can = stash.creds>=fee;
    }
    return `<div class="shop-item noicon ${on?'sel':''}" data-recipe="${r.id}" style="cursor:pointer;border-left-color:${on?'#ffd23f':'#8fd0ff'};${on?'box-shadow:inset 0 0 0 1px rgba(255,210,63,.35);':''}">
      <div class="si-name" style="color:#cfd8e2">${r.name}<span style="font-size:11px;opacity:.7"> · ${r.tag}</span>${on?'<span style="float:right;font-size:10px;color:#ffd23f;font-weight:800">选材中</span>':''}</div>
      <div class="si-meta">${r.desc}</div>
      ${fillHTML}
      <div class="row" style="flex-wrap:wrap;gap:6px;margin:7px 0 4px;">${slotsHTML}</div>
      ${qInfo}
      <div class="si-buy">
        <span class="si-price ${can||!full?'':'cant'}">₽ ${priceTextShort(fee)}</span>
        <button class="btn" data-craft="${r.id}" ${can?'':'disabled'}>合成</button></div>
    </div>`;
  }).join('');

  const craftChips = Object.keys(matMap)
    .sort((a,b)=>(RAID_MAT_BY_ID[a]?RAID_MAT_BY_ID[a].tier:0)-(RAID_MAT_BY_ID[b]?RAID_MAT_BY_ID[b].tier:0))
    .map(id=>{
      const m=RAID_MAT_BY_ID[id]||{name:id,tier:0};
      const used=actRec ? UI._craft.sel.filter(x=>x===id).length : 0;
      const left=matMap[id]-used;
      const dim= left<=0 ? "opacity:.32;pointer-events:none;" : "";
      return `<span class="mat-chip-wrap" style="${dim}">
        <button class="btn ghost mat-chip" data-cmat="${id}" style="border-color:${RAID_RARITY_COLOR[m.tier]};color:${RAID_RARITY_COLOR[m.tier]}">${m.name} <b>×${left}</b></button>
        <button class="chip-max" data-cmatmax="${id}" title="把剩余槽位全部填成这种材料">＋满</button>
      </span>`;
    }).join('') || `<span class="hint">仓库没有原材料 · 先去突袭里搜刮</span>`;

  const craftBar = actRec ? `
    <div class="hint" style="margin:10px 0 6px;color:#ffd23f">正在为「${actRec.name}」选材（${UI._craft.sel.length}/${actRec.slots}）· 点材料每次投 1 份 ·「＋满」一次填满剩余槽位 · 点投料标签减 1 份</div>
    <div class="row" style="flex-wrap:wrap;gap:8px;">${craftChips}</div>` : "";

  /* --- 组装 --- */
  const recvCards = stash.receivers.length ? stash.receivers.map(r=>{
    const on=UI._wsRecv===r.uid;
    return `<div class="shop-item ${on?'sel':''}" data-recv="${r.uid}" style="border-left-color:${r.color};cursor:pointer;${on?('box-shadow:inset 0 0 0 2px '+r.color+';'):''}">
      <div class="si-name" style="color:${r.color}">${r.name}</div>
      <div class="si-meta">底材 T${r.tier} · ${WEAPON_TYPES[r.gunType]?WEAPON_TYPES[r.gunType].name:r.gunType}</div>
      <div class="si-stats">估值 ₽${priceText(r.value)}</div>
    </div>`;
  }).join('') : `<div class="empty-hint">没有底材 · 用原材料合成「机匣」</div>`;

  const partCards = stash.parts.slice(0,60).map(pt=>{
    const on=UI._wsParts.includes(pt.uid);
    const col=(RARITY_BY_ID[pt.rarity]||{color:"#cfd8e2"}).color;
    return `<div class="shop-item ${on?'sel':''}" data-wpart="${pt.uid}" style="border-left-color:${col};cursor:pointer;${on?('box-shadow:inset 0 0 0 2px '+col+';'):''}">
      <div class="si-name" style="color:${col};font-size:12px;">${pt.name}</div>
      <div class="si-meta">${partText(pt)}</div>
    </div>`;
  }).join('') || `<div class="empty-hint">没有配件 · 箱子里到处都是</div>`;

  // 组装用材料：共 8 份，同种可重复投
  const wsel=UI._wsMats||[];
  const wGroups=[];
  for(const id of wsel){
    const g=wGroups.find(x=>x.id===id);
    if(g) g.n++; else wGroups.push({ id:id, n:1 });
  }
  const wPills = wGroups.map(g=>{
    const m=RAID_MAT_BY_ID[g.id]||{name:g.id,tier:0};
    return `<span class="mat-slot on" data-unwmat="${g.id}" title="点击移除 1 份" style="border-color:${RAID_RARITY_COLOR[m.tier]};color:${RAID_RARITY_COLOR[m.tier]}">${m.name}${g.n>1?" ×"+g.n:""} ✕</span>`;
  }).join("") || `<span class="mat-slot">＋ 待投料 · 需 ${RAID_ASSEMBLE_MATS} 份</span>`;

  const matChips = Object.keys(matMap).map(id=>{
    const m=RAID_MAT_BY_ID[id]||{name:id,tier:0};
    const used=wsel.filter(x=>x===id).length;
    const left=matMap[id]-used;
    const dim= left<=0 ? "opacity:.32;pointer-events:none;" : "";
    return `<span class="mat-chip-wrap" style="${dim}">
      <button class="btn ghost mat-chip" data-wmat="${id}" style="border-color:${RAID_RARITY_COLOR[m.tier]};color:${RAID_RARITY_COLOR[m.tier]}">${m.name} <b>×${left}</b></button>
      <button class="chip-max" data-wmatmax="${id}" title="把剩余份数全部填成这种材料">＋满</button>
    </span>`;
  }).join('') || `<span class="hint">仓库没有原材料</span>`;

  // 预估品质
  let preview="";
  const recv=stash.receivers.find(r=>r.uid===UI._wsRecv);
  if(recv){
    const parts=stash.parts.filter(p=>UI._wsParts.includes(p.uid));
    const mats=UI._wsMats.map(id=>({id, tier:(RAID_MAT_BY_ID[id]||{tier:0}).tier}));
    const partTier = parts.length ? parts.reduce((s,p)=>s+Math.max(0,RARITIES.findIndex(r=>r.id===p.rarity)),0)/parts.length : 0;
    const matTier = mats.length ? mats.reduce((s,m)=>s+m.tier,0)/mats.length : 0;
    const qTier = M.clamp(Math.round(recv.tier*0.35 + partTier*0.45 + matTier*0.20), 0, 8);
    const boost=RAID_TYPE_BOOST[recv.gunType];
    preview=`<div class="hint" style="color:${RAID_RARITY_COLOR[qTier]}">预估产物：<b>${RAID_TIERS[qTier].name}</b> · 底材 T${recv.tier} · 配件 ${parts.length} 件 · 材料 ${mats.length}/${RAID_ASSEMBLE_MATS} 份</div>`+
      (boost?`<div class="hint" style="color:#7fe08a;margin-top:4px;">${boost.label}</div>`:"");
  }

  UI._set(`
    <div class="panel raid-setup">
      <h2 class="title-big" style="font-size:32px;">枪匠台 · 工坊</h2>
      <div class="subtitle">WORKSHOP · 模块一览 / 材料合成 / 用机匣与部件组装枪械</div>
      ${forgeTabsHTML()}
      <div class="shop-bar">
        <div class="shop-desc"><b style="color:#7fd0ff">合成表改为自选材料</b>：投什么材料就出什么档的货——全用废金属只能做出普通货，投高阶材料才能出特种以上；材料越混搭，产物品质浮动越大。<b style="color:#ff9a3a">改装模块与钥匙都不再能合成</b>：改装模块只能从保险箱 / Raider 掉落，或在<b style="color:#7fd0ff">枪械商店与黑市</b>购买；钥匙同样只能箱内掉落或商店购买。<b>弹药</b>在「弹药」页单独合成：投 3 份材料出 30 发，产出的级别由材料品质决定（废金属出民用弹，高档材料才出特种弹）。<b>弹种适配组件</b>把武器更换弹种为对应弹种并加弹药效能，<b>膛压组件</b>决定<b style="color:#ff2ce0">改装等级</b>、<b>改装模块</b>提供属性增益——单枚增益已大幅提升，拿到就是质变。组装出的枪，名字与品质由底材、配件与材料共同决定。</div>
        <div class="shop-gold">仓库卢布 ₽ ${priceTextShort(stash.creds)}</div>
        <button class="btn ghost" id="btn-ws-back">${opts.from==='title'?'返回主菜单':'前往配装大厅'}</button>
      </div>

      <h3 style="font-size:18px;margin:14px 0 8px;">① 模块一览 <span style="color:var(--muted);font-size:12px;font-weight:400;">不可合成 · 只能掉落或购买</span></h3>
      <div class="shop-list">${coreRows}</div>
      <div class="hint" style="margin:2px 0 6px;color:var(--muted)">改装模块既不能用材料合成，也不能两两升阶：I~V 级只能从<b>保险箱与 Raider</b>身上掉落，或在<b>枪械商店（低阶）</b>、<b>黑市（高阶）</b>购买。作为补偿，单枚改装模块的属性增益比过去强得多（每级 +95%）。</div>

      <h3 style="font-size:18px;margin:18px 0 8px;">② 合成表 <span style="color:var(--muted);font-size:12px;font-weight:400;">自选材料 · 只产出机匣 / 配件，不出改装模块</span></h3>
      <div class="shop-list">${recipeRows}</div>
      ${craftBar}

      <h3 style="font-size:18px;margin:18px 0 8px;">③ 组装枪械 <span style="color:var(--muted);font-size:12px;font-weight:400;">选 1 个底材 + 每个槽位 1 件配件 + ${RAID_ASSEMBLE_MATS} 份材料</span></h3>
      <div class="shop-list">${recvCards}</div>
      <div class="hint" style="margin:10px 0 6px;">配件（已选 ${UI._wsParts.length} 件 · 同一槽位只装一件，再点即替换）</div>
      <div class="shop-list">${partCards}</div>
      <div class="hint" style="margin:10px 0 6px;">材料（已投 ${UI._wsMats.length}/${RAID_ASSEMBLE_MATS} 份 · 同种材料可重复投）</div>
      <div class="row" style="flex-wrap:wrap;gap:6px;margin-bottom:8px;">${wPills}</div>
      <div class="row" style="flex-wrap:wrap;gap:8px;">${matChips}</div>
      <div style="margin-top:12px;">${preview}</div>
      <div class="row" style="margin-top:10px;">
        <button class="btn ${recv && UI._wsMats.length>=RAID_ASSEMBLE_MATS?'':'btn-disabled'}" id="btn-assemble">组装枪械</button>
        <button class="btn ghost" id="btn-ws-clear">清空选择</button>
      </div>
    </div>`, true);

  const rerender=()=>UI.raidWorkshop(opts);
  UI.overlay.querySelectorAll('[data-ftab]').forEach(el=>{
    el.onclick=()=>{ UI._forgeTab=el.dataset.ftab; SFX.ui(); UI.raidForge(opts); };
  });
  document.getElementById('btn-ws-back').onclick=()=>{
    SFX.ui();
    if(opts.from==='title'){ UI.raidForge && (UI._forgeTab='forge'); game.toTitle(); }
    else UI.raidSetup();
  };
  document.getElementById('btn-ws-clear').onclick=()=>{ UI._wsParts=[]; UI._wsMats=[]; UI._craft={ id:UI._craft.id, sel:[] }; SFX.ui(); rerender(); };

  // 合成：自选材料 → 产出
  UI.overlay.querySelectorAll('[data-recipe]').forEach(el=>{
    el.onclick=(e)=>{
      if(e.target.closest('[data-craft]')||e.target.closest('[data-unsmat]')) return;
      const id=el.dataset.recipe;
      if(UI._craft.id!==id){ UI._craft={ id, sel:[] }; }
      SFX.ui(); rerender();
    };
  });
  // 投料：点标签减 1 份
  UI.overlay.querySelectorAll('[data-unsmat]').forEach(el=>{
    el.onclick=(e)=>{
      e.stopPropagation();
      const id=el.dataset.unsmat;
      const i=UI._craft.sel.lastIndexOf(id);
      if(i>=0){ UI._craft.sel.splice(i,1); SFX.ui(); rerender(); }
    };
  });
  // 投料：点材料每次 +1 份（同一种可以连续投）
  const craftAdd=(id,n)=>{
    const r=RAID_RECIPES.find(x=>x.id===UI._craft.id);
    if(!r){ UI.toast && UI.toast("先点一张配方卡"); return; }
    const room=r.slots-UI._craft.sel.length;
    if(room<=0){ UI.toast && UI.toast("槽位已满，点投料标签可移除"); return; }
    const used=UI._craft.sel.filter(x=>x===id).length;
    const left=raidMatCount(stash,id)-used;
    if(left<=0){ UI.toast && UI.toast("这种材料不够了"); return; }
    const k=Math.min(n||1, room, left);
    for(let i=0;i<k;i++) UI._craft.sel.push(id);
    SFX.ui(); rerender();
  };
  UI.overlay.querySelectorAll('[data-cmat]').forEach(el=>{
    el.onclick=(e)=>{ e.stopPropagation(); craftAdd(el.dataset.cmat, 1); };
  });
  UI.overlay.querySelectorAll('[data-cmatmax]').forEach(el=>{
    el.onclick=(e)=>{ e.stopPropagation(); craftAdd(el.dataset.cmatmax, 99); };
  });
  UI.overlay.querySelectorAll('[data-craft]').forEach(el=>{
    el.onclick=(e)=>{
      e.stopPropagation();
      const r=RAID_RECIPES.find(x=>x.id===el.dataset.craft);
      if(!r) return;
      const sel=(UI._craft.id===r.id)?UI._craft.sel.slice():[];
      if(sel.length<r.slots){ UI.toast && UI.toast("先把材料槽填满"); return; }
      const mats=[];
      for(const id of sel){
        const i=stash.materials.findIndex(m=>m.id===id);
        if(i<0){ UI.toast && UI.toast("材料不足"); return; }
        mats.push(stash.materials.splice(i,1)[0]);
      }
      const fee=raidCraftFee(mats, r.slots);
      if(stash.creds<fee){
        for(const m of mats) stash.materials.push(m);   // 钱不够，材料退回
        UI.toast && UI.toast("卢布不足");
        return;
      }
      stash.creds-=fee;
      const q=raidCraftQTier(mats);
      const out=r.make(mats, q);
      out.craftedTier=q;
      if(r.kind==="core") stash.parts.push(out);
      else if(r.kind==="med"){ stash.meds=stash.meds||{}; stash.meds[out.id]=(stash.meds[out.id]||0)+1; }
      else if(r.kind==="part") stash.parts.push(out);
      else if(r.kind==="armor") stash.armors.push(out);
      else if(r.kind==="helmet") stash.helmets.push(out);
      else if(r.kind==="shield") (stash.shields=stash.shields||[]).push(out);
      else if(r.kind==="receiver") stash.receivers.push(out);
      else if(r.kind==="ammo"){
        stash.ammo=stash.ammo||{};
        stash.ammo[out.id]=(stash.ammo[out.id]||0)+(out.n||RAID_AMMO_STACK);
      }
      UI._craft.sel=[];
      RaidStash.save(stash); SFX.pickup();
      UI.toast && UI.toast(`合成成功 · ${RAID_TIERS[q].name}级${r.name}`);
      rerender();
    };
  });
  // 选择底材 / 配件 / 材料
  UI.overlay.querySelectorAll('[data-recv]').forEach(el=>{
    el.onclick=()=>{ UI._wsRecv=el.dataset.recv; SFX.ui(); rerender(); };
  });
  UI.overlay.querySelectorAll('[data-wpart]').forEach(el=>{
    el.onclick=()=>{
      const uid=el.dataset.wpart;
      const i=UI._wsParts.indexOf(uid);
      if(i>=0){ UI._wsParts.splice(i,1); SFX.ui(); rerender(); return; }
      // 同槽位只装一件：选中新配件时把旧的那件挤掉
      const pt=stash.parts.find(p=>p.uid===uid);
      if(pt) UI._wsParts=UI._wsParts.filter(x=>{
        const o=stash.parts.find(p=>p.uid===x);
        return !o || o.slot!==pt.slot;
      });
      UI._wsParts.push(uid);
      SFX.ui(); rerender();
    };
  });
  // 投料：点材料 +1 份（同种可重复），点已投标签减 1 份
  const wsAdd=(id,n)=>{
    const room=RAID_ASSEMBLE_MATS-UI._wsMats.length;
    if(room<=0){ UI.toast && UI.toast("材料已满 8 份，点标签可移除"); return; }
    const used=UI._wsMats.filter(x=>x===id).length;
    const left=raidMatCount(stash,id)-used;
    if(left<=0){ UI.toast && UI.toast("这种材料不够了"); return; }
    const k=Math.min(n||1, room, left);
    for(let i=0;i<k;i++) UI._wsMats.push(id);
    SFX.ui(); rerender();
  };
  UI.overlay.querySelectorAll('[data-wmat]').forEach(el=>{
    el.onclick=(e)=>{ e.stopPropagation(); wsAdd(el.dataset.wmat, 1); };
  });
  UI.overlay.querySelectorAll('[data-wmatmax]').forEach(el=>{
    el.onclick=(e)=>{ e.stopPropagation(); wsAdd(el.dataset.wmatmax, 99); };
  });
  UI.overlay.querySelectorAll('[data-unwmat]').forEach(el=>{
    el.onclick=(e)=>{
      e.stopPropagation();
      const id=el.dataset.unwmat;
      const i=UI._wsMats.lastIndexOf(id);
      if(i>=0){ UI._wsMats.splice(i,1); SFX.ui(); rerender(); }
    };
  });
  // 组装
  const btn=document.getElementById('btn-assemble');
  if(btn) btn.onclick=()=>{
    const recv=stash.receivers.find(r=>r.uid===UI._wsRecv);
    if(!recv){ UI.toast && UI.toast("请先选择一个底材"); return; }
    if(UI._wsMats.length<RAID_ASSEMBLE_MATS){ UI.toast && UI.toast(`需要投满 ${RAID_ASSEMBLE_MATS} 份材料（当前 ${UI._wsMats.length}）`); return; }
    if(stash.creds<500){ UI.toast && UI.toast("组装需要 ₽500"); return; }
    const parts=stash.parts.filter(p=>UI._wsParts.includes(p.uid));
    const mats=[];
    for(const id of UI._wsMats){
      const i=stash.materials.findIndex(m=>m.id===id);
      if(i>=0) mats.push(stash.materials.splice(i,1)[0]);
    }
    if(mats.length<RAID_ASSEMBLE_MATS){
      for(const m of mats) stash.materials.push(m);   // 材料没凑够，原样退回
      RaidStash.save(stash);
      UI.toast && UI.toast("仓库材料不足"); return;
    }
    const gun=assembleRaidGun(recv, parts, mats);
    stash.creds-=500;
    stash.receivers=stash.receivers.filter(r=>r.uid!==recv.uid);
    stash.parts=stash.parts.filter(p=>!UI._wsParts.includes(p.uid));
    stash.weapons.push(gun);
    UI._wsParts=[]; UI._wsMats=[];
    RaidStash.save(stash); SFX.pickup();
    UI._wsResult=gun;
    UI.raidWorkshop(opts);
  };
};

/* =========================================================================
 * · 局内商店（枪械商店 / 材料商店 / 回收超市 / 黑市）
 *   走进摊位按 E 打开；游戏不暂停（硬核：谈生意也得看后背）。
 *   · 前两家用「局内卢布」（撤离才结算，死了就白花）
 *   · 黑市用「GP 币」——本局首杀必得 1 枚，之后靠上锁箱 / Raider 掉落与撤离结算，专门换高级武器
 *   · 回收超市收购价 1.2 ± 0.4，高于背包直售 0.5：想卖好价就得活着把货带进图
 * ========================================================================= */
UI.raidFieldShop=function(key){
  const R=Raid;
  // 按**摊位 id** 打开，而不是按类型 —— 地图上有两处材料商店 / 回收超市，
  // 旧写法按 kind 取第一个，等于两家共用一个货架（看起来像「四个商店被合并了」）。
  const sh=(R.shops||[]).find(s=>s.id===key) || (R.shops||[]).find(s=>s.kind===key);
  if(!sh || !R.active) return;
  const kind=sh.kind, sid=sh.id;
  const money=R.creds||0, tokens=R.tokens||0;

  const tagLine={ gun:"GUNS", mat:"MATERIALS", rec:"RECYCLE", black:"BLACK MARKET" }[kind];

  const gunCard=(g, payKind, idx, arr)=>{
    const price = payKind==="token" ? (g.tokenPrice||60) : (g.shopPrice||g.value||0);
    const can = payKind==="token" ? tokens>=price : money>=price;
    const col = raidGunColor(g);
    const tname=(WEAPON_TYPES[g.type]&&WEAPON_TYPES[g.type].name)||g.cat||"武器";
    const qn=(RAID_TIERS[g.qTier]&&RAID_TIERS[g.qTier].name)||"";
    return `<div class="si">
      <div class="si-name" style="color:${col}">${g.name}</div>
      <div class="si-stats">${tname}${qn?" · "+qn:""} · 伤害 ${g.dmg} · 弹匣 ${g.mag} · 射速 ${g.rpm}<br>
        配件 ${(g.parts||[]).length} 个 · 估值 ₽${priceTextShort(g.value||0)}</div>
      <div class="si-buy">
        <span class="si-price ${can?"":"cant"}">${payKind==="token"?"◆":"₽"} ${payKind==="token"?price:priceTextShort(price)}</span>
        <button class="btn ghost" data-fbuy="${payKind}:${sid}:${idx}" ${can?"":"disabled"}>购买</button>
      </div>
    </div>`;
  };

  // 弹药卡：一条 30 发，带口径 / 级别 / 单发穿深
  const ammoCard=(a, payKind, idx)=>{
    const price = payKind==="token" ? (a.tokenPrice||0) : (a.shopPrice||0);
    const can = payKind==="token" ? tokens>=price : money>=price;
    const E=AMMO_TYPES[a.elem]||AMMO_TYPES.none;
    const lvName=(AMMO_GRADE_BY_LV[a.lv]||{}).name||("T"+a.lv);
    const owned=R._ammoCount(a.id);
    return `<div class="si">
      <div class="si-name" style="color:${a.color||"#dfe7f0"}">${a.name} <span style="font-size:11px;opacity:.7">×${a.n}</span></div>
      <div class="si-stats">${a.spec} · ${lvName}级 · 单发估值 ₽${a.value?Math.round(a.value/a.n):0} · 穿深 ${E.pen}${owned?" · 背包已有 "+owned:""}</div>
      <div class="si-buy">
        <span class="si-price ${can?"":"cant"}">${payKind==="token"?"◆":"₽"} ${payKind==="token"?price:priceTextShort(price)}</span>
        <button class="btn ghost" data-fbuy="${payKind==="token"?"tokenammo":"cashammo"}:${sid}:${idx}" ${can?"":"disabled"}>购买</button>
      </div>
    </div>`;
  };

  // 钥匙卡：开对应等级的上锁保险箱
  const keyCard=(k, payKind, idx)=>{
    const price = payKind==="token" ? (k.tokenPrice||0) : (k.shopPrice||raidKeyDef(k.lv).shop||0);
    const can = payKind==="token" ? tokens>=price : money>=price;
    return `<div class="si">
      <div class="si-name" style="color:${k.color||"#ffd23f"}">${k.name} <span style="font-size:11px;opacity:.75">[${RAID_LOCK_NAME[k.lv]}]</span></div>
      <div class="si-stats">可开 ${RAID_LOCK_NAME[k.lv]} 及以下的保险箱 · 可用 ${k.uses} 次 · 估值 ₽${priceTextShort(k.value||0)}</div>
      <div class="si-buy">
        <span class="si-price ${can?"":"cant"}">${payKind==="token"?"◆":"₽"} ${payKind==="token"?price:priceTextShort(price)}</span>
        <button class="btn ghost" data-fbuy="key:${sid}:${idx}" ${can?"":"disabled"}>购买</button>
      </div>
    </div>`;
  };

  let body="";
  if(kind==="gun"||kind==="black"){
    const payKind = kind==="black" ? "token" : "cash";
    const arr=sh.stock.guns;
    body = arr.length ? arr.map((g,i)=>gunCard(g,payKind,i)).join("")
      : `<div class="empty-hint">货架已空 · 本局不再补货</div>`;
    if(kind==="black"){
      const parts=sh.stock.parts||[];
      body += parts.length ? `<div class="hint" style="margin:10px 0 6px;grid-column:1/-1;">◆ 高级改装模块（GP 币兑换）</div>` +
        parts.map((c,i)=>{
          const can=tokens>=(c.tokenPrice||10);
          return `<div class="si">
            <div class="si-name" style="color:${c.color||"#c07bff"}">${c.name||raidCoreName(c)}</div>
            <div class="si-stats">等级 ${RAID_ROMAN[c.lv]||c.lv} · ${(c.mods||[]).map(m=>`${AFFIX_LABEL[m.stat]||m.stat} +${m.value}`).join(" · ")||"—"}</div>
            <div class="si-buy"><span class="si-price ${can?"":"cant"}">◆ ${c.tokenPrice||10}</span>
              <button class="btn ghost" data-fbuy="tokenpart:${sid}:${i}" ${can?"":"disabled"}>兑换</button></div>
          </div>`;
        }).join("")
        : "";
      const bkeys=sh.stock.keys||[];
      if(bkeys.length) body += `<div class="hint" style="margin:10px 0 6px;">◆ 高级钥匙（GP 币兑换 · 开同级及以下保险箱）</div>` +
        bkeys.map((k,i)=>keyCard(k,"token",i)).join("");
      const bammo=sh.stock.ammo||[];
      if(bammo.length) body += `<div class="hint" style="margin:10px 0 6px;">◆ 高级弹药 T4 / T5（GP 币兑换 · 一条 30 发）</div>` +
        bammo.map((a,i)=>ammoCard(a,"token",i)).join("");
    } else if(kind==="gun"){
      // 改装模块不可合成 —— 枪械店常备低阶改装模块，卢布直接买
      const parts=sh.stock.parts||[];
      if(parts.length) body += `<div class="hint" style="margin:10px 0 6px;grid-column:1/-1;">◆ 改装模块（卢布购买 · 不可合成）</div>` +
        parts.map((c,i)=>{
          const can=money>=(c.shopPrice||0);
          const mods=(c.mods||[]).map(m=>`${AFFIX_LABEL[m.stat]||m.stat} +${m.value}`).join(" · ");
          return `<div class="si">
            <div class="si-name" style="color:${c.color||"#ffd23f"}">${c.name||raidCoreName(c)}</div>
            <div class="si-stats">等级 ${RAID_ROMAN[c.lv]||c.lv} · ${mods||(c.core==="chaos"?`改装等级 ${RAID_ROMAN[c.lv]||c.lv}`:"属性增益")}</div>
            <div class="si-buy"><span class="si-price ${can?"":"cant"}">₽ ${priceTextShort(c.shopPrice||0)}</span>
              <button class="btn ghost" data-fbuy="cashpart:${sid}:${i}" ${can?"":"disabled"}>购买</button></div>
          </div>`;
        }).join("");
      const gammo=sh.stock.ammo||[];
      if(gammo.length) body += `<div class="hint" style="margin:10px 0 6px;grid-column:1/-1;">◆ 弹药（一条 30 发 · 本店枪型口径）</div>` +
        gammo.map((a,i)=>ammoCard(a,"cash",i)).join("");
    }
  } else if(kind==="mat"){
    body = sh.stock.mats.map((m,i)=>{
      const can=money>=(m.shopPrice||0);
      return `<div class="si">
        <div class="si-name" style="color:${m.color||"#dfe7f0"}">${m.name}</div>
        <div class="si-stats">原材料 · 估值 ₽${priceTextShort(m.value||0)}</div>
        <div class="si-buy"><span class="si-price ${can?"":"cant"}">₽ ${priceTextShort(m.shopPrice||0)}</span>
          <button class="btn ghost" data-fbuy="cashmat:${sid}:${i}" ${can?"":"disabled"}>购买</button></div>
      </div>`;
    }).join("");
    body += sh.stock.parts.map((pt,i)=>{
      const can=money>=(pt.shopPrice||0);
      const col=(RARITY_BY_ID[pt.rarity]||{color:"#cfd8e2"}).color;
      return `<div class="si">
        <div class="si-name" style="color:${col}">${pt.name||(pt.core?"改装模块":pt.slot_name||"配件")}</div>
        <div class="si-stats">配件 · ${(pt.affixes||[]).map(a=>a.nm).join(" · ")||"—"}</div>
        <div class="si-buy"><span class="si-price ${can?"":"cant"}">₽ ${priceTextShort(pt.shopPrice||0)}</span>
          <button class="btn ghost" data-fbuy="cashpart:${sid}:${i}" ${can?"":"disabled"}>购买</button></div>
      </div>`;
    }).join("");
    body += sh.stock.meds.map((md,i)=>{
      const can=money>=md.price;
      const nm=(RAID_MED_BY_ID[md.id]||{}).name||md.id;
      return `<div class="si">
        <div class="si-name" style="color:#ff9a9a">${nm} ×${md.n}</div>
        <div class="si-stats">医疗补给 · 立即生效</div>
        <div class="si-buy"><span class="si-price ${can?"":"cant"}">₽ ${priceTextShort(md.price)}</span>
          <button class="btn ghost" data-fbuy="cashmed:${sid}:${i}" ${can?"":"disabled"}>购买</button></div>
      </div>`;
    }).join("");
    const mammo=sh.stock.ammo||[];
    if(mammo.length) body += `<div class="hint" style="margin:10px 0 6px;grid-column:1/-1;">◆ 弹药（一条 30 发 · T1 民用 / T2 制式）</div>` +
      mammo.map((a,i)=>ammoCard(a,"cash",i)).join("");
    const mkeys=sh.stock.keys||[];
    if(mkeys.length) body += `<div class="hint" style="margin:10px 0 6px;grid-column:1/-1;">◆ 钥匙（开对应等级的上锁保险箱 · 带进图才会生效）</div>` +
      mkeys.map((k,i)=>keyCard(k,"cash",i)).join("");
  } else if(kind==="rec"){
    // 回收超市：把背包里的东西折现（v0.19.0：估价 × 1.2 ± 0.4，按件稳定浮动）
    const rows=[];
    const equipped=new Set();
    if(R.player.gun) equipped.add(R.player.gun.uid);
    if(R.player.secondary) equipped.add(R.player.secondary.uid);
    const add=(key, item, name, col, note, base)=>{
      rows.push({ key, uid:item.uid, name, col, note, base,
        val: raidFieldSellPrice(base, item.uid || name) });
    };
    for(const w of (R.inv.weapons||[])){
      const on=equipped.has(w.uid);
      add("w", w, w.name, raidGunColor(w), on?"手持/副手中 · 需先换下":"枪械", w.value||0);
      if(on) rows[rows.length-1].on=true;
    }
    for(const a of (R.inv.armors||[])) add("a", a, a.name, ARMOR_TIER_COLOR[a.tier]||"#dfe7f0", "护甲", a.value||0);
    for(const h of (R.inv.helmets||[])) add("h", h, h.name, ARMOR_TIER_COLOR[h.tier]||"#dfe7f0", "头盔", h.value||0);
    for(const s of (R.inv.shields||[])) add("s", s, s.name, shieldColor(s), "护盾", s.value||0);
    for(const pt of (R.inv.parts||[])) add("p", pt, pt.name||(pt.core?"改装模块":pt.slot_name||"配件"),
      (RARITY_BY_ID[pt.rarity]||{color:"#cfd8e2"}).color, pt.core?"改装模块":"配件",
      (pt.slot==="core"?pt.value:partValue(pt))||0);
    for(const m of (R.inv.materials||[])) add("m", m, m.name, m.color||"#dfe7f0", "原材料", m.value||0);
    /* v0.20.3：多捡的子弹也能在这里变现（按「单发估值 × 数量」走 1.2× 回收价） */
    for(const id of Object.keys(R.inv.ammo||{})){
      const n=R.inv.ammo[id]; if(!(n>0)) continue;
      const d=ammoDefFromId(id); if(!d) continue;
      const base=d.value*n;
      rows.push({ key:"am", uid:id, name:d.name+" ×"+n, col:d.color,
        note:"弹药 · "+d.spec, base, val:raidAmmoSellPrice(base), n });
    }
    body = rows.length ? rows.map((r,i)=>`
      <div class="si">
        <div class="si-name" style="color:${r.col}">${r.name}</div>
        <div class="si-stats">${r.note} · 估值 ₽${priceTextShort(r.base)} · 回收价 ${(r.val/Math.max(1,r.base)*100).toFixed(0)}%</div>
        <div class="si-buy"><span class="si-price">₽ ${priceTextShort(r.val)}</span>
          <button class="btn ghost" data-fsell="${r.key}:${i}" ${r.on?"disabled":""}>${r.on?"换下后可卖":"回收"}</button></div>
      </div>`).join("") : `<div class="empty-hint">背包是空的 · 先下场搜刮再来</div>`;
    R._sellRows=rows;
  }

  const wallet = kind==="black"
    ? `<div class="shop-gold" style="color:#c07bff">◆ GP 币 ${tokens}</div><div class="shop-gold">局内卢布 ₽ ${priceTextShort(money)}</div>`
    : `<div class="shop-gold">局内卢布 ₽ ${priceTextShort(money)}</div>`;

  UI._set(`
    <style>
      .fieldshop .shop-list{display:grid;grid-template-columns:repeat(auto-fill,minmax(272px,1fr));gap:10px;align-items:stretch;}
      .fieldshop .si{display:flex;flex-direction:column;height:100%;}
      .fieldshop .si-stats{flex:1 1 auto;}
      .fieldshop .si-buy{margin-top:auto;display:flex;align-items:center;justify-content:flex-end;gap:10px;}
    </style>
    <div class="panel raid-setup fieldshop">
      <h2 class="title-big" style="font-size:30px;color:${sh.color}">${sh.name}</h2>
      <div class="subtitle">${tagLine} · 局内交易 · 撤离成功才会把货带回仓库</div>
      <div class="shop-bar">
        <div class="shop-desc">${kind==="rec"
          ? `回收超市按装备估值的 <b style="color:#62c8ff">${Math.round(RAID_FIELD_SELL_RATE*100)}%（±${Math.round(RAID_FIELD_SELL_JITTER*100)}%）</b> 收购（背包直售只有 ${Math.round(RAID_VENDOR_RATE*100)}%）。带进图卖能多赚，但要先活着走到这里。`
          : kind==="black"
            ? `黑市只认 <b style="color:#c07bff">◆ GP 币</b>：<b>本局首杀必得 1 枚</b>，之后靠上锁箱与 Raider 掉落，撤离时再按带出价值结算。这里出售 <b style="color:#ffd23f">高稀有度成品枪</b>、高级改装模块与 <b style="color:#c07bff">III~V 级保险箱钥匙</b>，卢布买不到。`
            : `用<b style="color:#ffd23f">局内卢布</b>交易 —— 卢布要先在局内搜刮到，撤离后才真正落袋。死了，钱和货一起没。`}</div>
        ${wallet}
        <button class="btn ghost" data-fclose="1">离开（继续突袭）</button>
      </div>
      <div class="shop-solo">
        <span class="solo-badge" style="border-color:${sh.color}66;color:${sh.color}">独立摊位</span>
        <span>${sh.name}${kind==="gun"?"只卖成品枪":kind==="mat"?"只卖原材料 / 配件 / 医疗 / I~II 级钥匙":kind==="rec"?"只收货，不卖货":"只收 ◆ GP 币，换高级枪 / 改装模块 / III~V 级钥匙"} · 货架与其他摊位各算各的，不互通。</span>
      </div>
      <div class="shop-list">${body}</div>
      <div class="hint" style="margin-top:12px;">关闭面板后游戏继续 —— 谈生意时背后随时可能来人。</div>
    </div>`);

  UI.overlay.querySelectorAll("[data-fclose]").forEach(el=>el.onclick=()=>{ SFX.ui(); R._closeShop(); });

  UI.overlay.querySelectorAll("[data-fbuy]").forEach(el=>el.onclick=()=>{
    const [pay, k, si]=el.dataset.fbuy.split(":"); const idx=+si;
    const shop=(R.shops||[]).find(s=>s.id===k) || (R.shops||[]).find(s=>s.kind===k); if(!shop) return;
    const capMsg=(t)=>R._float(R.player.x, R.player.y-40, t, "#ff8a5a");
    if(pay==="cash"||pay==="token"){
      const g=shop.stock.guns[idx]; if(!g) return;
      if(R.inv.weapons.length>=RAID_INV_CAP.weapons){ capMsg("背包武器已满"); return; }
      const price = pay==="token" ? (g.tokenPrice||60) : (g.shopPrice||g.value||0);
      if(pay==="token"){ if(R.tokens<price) return; R.tokens-=price; }
      else { if(R.creds<price) return; R.creds-=price; }
      shop.stock.guns.splice(idx,1);
      R.inv.weapons.push(g);
      R._rtGun(g);                       // 建缓存（空枪，弹药要自己装）
      R._float(R.player.x, R.player.y-40, "购入 "+g.name, raidGunColor(g));
      SFX.buy ? SFX.buy() : SFX.ui();
      RaidStash.save(R.stash);
      UI.raidFieldShop(sid);
    } else if(pay==="cashmat"){
      const m=shop.stock.mats[idx]; if(!m) return;
      if(R.inv.materials.length>=RAID_INV_CAP.materials){ capMsg("材料栏已满"); return; }
      if(R.creds<(m.shopPrice||0)) return;
      R.creds-=m.shopPrice;
      R.inv.materials.push(m); shop.stock.mats.splice(idx,1);
      R._float(R.player.x, R.player.y-40, "购入 "+m.name, m.color||"#dfe7f0");
      SFX.ui(); UI.raidFieldShop(sid);
    } else if(pay==="cashpart"){
      const pt=shop.stock.parts[idx]; if(!pt) return;
      if(R.inv.parts.length>=RAID_INV_CAP.parts){ capMsg("配件栏已满"); return; }
      if(R.creds<(pt.shopPrice||0)) return;
      R.creds-=pt.shopPrice;
      R.inv.parts.push(pt); shop.stock.parts.splice(idx,1);
      R._float(R.player.x, R.player.y-40, "购入 "+(pt.name||"配件"), "#c9a13a");
      SFX.ui(); UI.raidFieldShop(sid);
    } else if(pay==="cashmed"){
      const md=shop.stock.meds[idx]; if(!md) return;
      if(R.creds<md.price) return;
      R.creds-=md.price;
      if(md.id==="bandage") R.bandages+=md.n;
      else { R.meds=R.meds||{}; R.meds[md.id]=(R.meds[md.id]||0)+md.n; }
      R._float(R.player.x, R.player.y-40, "购入 "+md.n+" 份补给", "#ff9a9a");
      SFX.ui(); UI.raidFieldShop(sid);
    } else if(pay==="tokenpart"){
      const c=shop.stock.parts[idx]; if(!c) return;
      if(R.inv.parts.length>=RAID_INV_CAP.parts){ capMsg("配件栏已满"); return; }
      if(R.tokens<(c.tokenPrice||10)) return;
      R.tokens-=c.tokenPrice;
      R.inv.parts.push(c); shop.stock.parts.splice(idx,1);
      R._float(R.player.x, R.player.y-40, "兑换 "+(c.name||"改装模块"), c.color||"#c07bff");
      SFX.ui(); UI.raidFieldShop(sid);
    } else if(pay==="cashammo" || pay==="tokenammo"){
      const a=(shop.stock.ammo||[])[idx]; if(!a) return;
      const tok=pay==="tokenammo";
      const price=tok?(a.tokenPrice||0):(a.shopPrice||0);
      if(tok){ if(R.tokens<price) return; } else { if(R.creds<price) return; }
      if(R._ammoTotal()>=RAID_AMMO_CAP){ capMsg("弹药已满（"+RAID_AMMO_CAP+" 发上限）"); return; }
      if(tok) R.tokens-=price; else R.creds-=price;
      const add=R._ammoAdd(a.id, a.n);
      if(add<=0){ capMsg("弹药已满"); return; }
      shop.stock.ammo.splice(idx,1);
      R._float(R.player.x, R.player.y-40, "购入 "+add+" 发 "+a.short, a.color||"#dfe7f0");
      SFX.ui(); UI.raidFieldShop(sid);
    } else if(pay==="key"){
      const ky=(shop.stock.keys||[])[idx]; if(!ky) return;
      if(!R.inv.keys) R.inv.keys=[];
      if(R.inv.keys.length>=RAID_INV_CAP.keys){ capMsg("钥匙串已满"); return; }
      const tok=!!ky.tokenPrice;
      const price=tok?ky.tokenPrice:(ky.shopPrice||raidKeyDef(ky.lv).shop||0);
      if(tok){ if(R.tokens<price) return; R.tokens-=price; }
      else { if(R.creds<price) return; R.creds-=price; }
      R.inv.keys.push(ky); shop.stock.keys.splice(idx,1);
      R._float(R.player.x, R.player.y-40, "购入 "+ky.name, ky.color||"#ffd23f");
      SFX.ui(); UI.raidFieldShop(sid);
    }
  });

  UI.overlay.querySelectorAll("[data-fsell]").forEach(el=>el.onclick=()=>{
    const [key, si]=el.dataset.fsell.split(":"); const idx=+si;
    const rows=R._sellRows||[]; const row=rows[idx]; if(!row) return;
    if(key==="am"){
      const n=R._ammoTake(row.uid, row.n||0);
      if(n<=0) return;
      const d=ammoDefFromId(row.uid);
      const g2=Math.max(1, Math.round(raidAmmoSellPrice(d.value*n)/10)*10);
      R.creds+=g2;
      R._float(R.player.x, R.player.y-40, "卖 "+n+" 发 · +₽"+g2, "#8fe07a");
      SFX.ui(); UI.raidFieldShop(sid);
      return;
    }
    const gain=Math.round(row.val/10)*10;
    const pull=(arr)=>{ const i=arr.findIndex(x=>x.uid===row.uid); if(i>=0) return arr.splice(i,1)[0]; return null; };
    let it=null;
    if(key==="w") it=pull(R.inv.weapons);
    else if(key==="a") it=pull(R.inv.armors);
    else if(key==="h") it=pull(R.inv.helmets);
    else if(key==="s") it=pull(R.inv.shields||[]);
    else if(key==="p") it=pull(R.inv.parts);
    else if(key==="m") it=pull(R.inv.materials);
    if(!it) return;
    R.creds+=gain;
    R._float(R.player.x, R.player.y-40, "+₽"+gain, "#8fe07a");
    SFX.ui(); UI.raidFieldShop(sid);
  });
};

function forgeTabsHTML(){  return `<div class="shop-tabs" style="margin-bottom:14px;">
    <button class="shop-tab ${UI._forgeTab!=='fusion'&&UI._forgeTab!=='workshop'?'on':''}" data-ftab="forge"><b>精密改装</b><span class="tab-tag">GUNSMITH</span></button>
    <button class="shop-tab ${UI._forgeTab==='fusion'?'on':''}" data-ftab="fusion"><b>融合台</b><span class="tab-tag">FUSION</span></button>
    <button class="shop-tab ${UI._forgeTab==='workshop'?'on':''}" data-ftab="workshop"><b>工坊</b><span class="tab-tag">CRAFT</span></button>
  </div>`;
}

UI.raidForge=function(opts){
  opts=opts||{};
  if(UI._forgeTab==="fusion") return UI.raidFusion(opts);
  if(UI._forgeTab==="workshop") return UI.raidWorkshop(opts);
  const stash=RaidStash.load();
  if(!stash.weapons.some(w=>w.uid===UI._forgeSel)) UI._forgeSel = stash.weapons[0]?stash.weapons[0].uid:null;
  const sel = stash.weapons.find(w=>w.uid===UI._forgeSel) || null;

  const cards = stash.weapons.map(w=>{
    const on = w.uid===UI._forgeSel;
    const col=raidGunColor(w);
    const tname=WEAPON_TYPES[w.type]?WEAPON_TYPES[w.type].name:w.cat;
    const elem=w.element&&w.element!=="none"?(AMMO_TYPES[w.element]?AMMO_TYPES[w.element].name:"特种弹"):AMMO_TYPES.none.name;
    return `<div class="shop-item ${on?'sel':''}" data-pick="${w.uid}" style="border-left-color:${col};cursor:pointer;${on?('box-shadow:inset 0 0 0 2px '+col+';'):''}">
      <div class="si-thumb">${gunSvg(w,46)}</div>
      <div class="si-name" style="color:${col}">${w.name}</div>
      <div class="si-meta">${tname} · ${elem}${w.mayhem>0?' · <b class="c-mayhem">改装'+w.mayhem+'级</b>':''}</div>
      <div class="si-stats">伤害 ${w.dmg} · 弹匣 ${w.mag} · 射速 ${w.rpm} · 射程 ${w.range}<br>配件 ${(w.parts||[]).length} 个 · 估值 ₽${priceTextShort(w.value)}</div>
    </div>`;
  }).join('') || `<div class="empty-hint">仓库暂无枪械 · 先去军火超市采购，或突袭搜刮并成功撤离</div>`;

  let opPanel = `<div class="hint">请选择一把枪械进行锻造。</div>`;
  if(sel){
    const cR=forgeCost("reroll",sel);
    const canR=stash.creds>=cR;
    opPanel = `
      <div class="forge-ops" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px;">
        <div class="shop-item" style="border-left-color:#8fb0c8">
          <div class="si-name" style="color:#8fb0c8">重调改装词条</div>
          <div class="si-meta">保留枪型 / 兵工厂 / 适配弹种 / 品级，重掷全部改装词条（只要卢布）</div>
          <div class="si-buy"><span class="si-price ${canR?'':'cant'}">₽ ${cR}</span>
            <button class="btn" data-op="reroll" ${canR?'':'disabled'}>重调</button></div>
        </div>
        <div class="shop-item" style="border-left-color:#9aa4b2">
          <div class="si-name" style="color:#9aa4b2">更换弹种 / 提升改装等级已并入「模块装配」</div>
          <div class="si-meta">把<b>弹种适配组件</b>装进改装槽即可更换适配弹药；把<b>膛压组件</b>装进改装槽，<b style="color:#b08a58">最高等级膛压组件决定枪械改装等级</b>；<b>改装模块</b>提供工艺参数增益。均在下方改装槽操作。</div>
        </div>
      </div>`;
  }

  // —— 部件装配（普通部件槽）+ 模块装配（改装槽，数量随品级 1~8） ——
  let partPanel = "";
  if(sel){
    const allParts = sel.parts||[];
    const normalParts = allParts.filter(p=>!p.core);
    const cores = allParts.filter(p=>p.core);
    const coreCap = raidCoreSlotCount(sel.rarity);
    const rIdx = Math.max(0, RARITIES.findIndex(r=>r.id===sel.rarity));
    const rows = GUN_SLOTS.map(slot=>{
      const cur = normalParts.find(p=>p.slot===slot.id);
      const poolN = (stash.parts||[]).filter(p=>!p.core && p.slot===slot.id).length;
      const col = cur ? ((RARITY_BY_ID[cur.rarity]||{color:"#cfd8e2"}).color) : "#6b7280";
      return `<div class="forge-slot">
        <div class="fs-name">${slot.name}</div>
        <div class="fs-part" style="color:${col}">${cur?cur.name:"（空槽）"}<em>${cur?partText(cur):"装备仓库配件后生效"}</em></div>
        <div class="fs-btns">
          <button class="btn ghost" data-install="${slot.id}" ${poolN>0?'':'disabled'}>换装 ${poolN}</button>
        </div>
      </div>`;
    }).join("");
    const coreRows=[];
    for(let i=0;i<coreCap;i++){
      const c=cores[i];
      if(c){
        coreRows.push(`<div class="forge-slot core">
          <div class="fs-name">改装槽 ${i+1}</div>
          <div class="fs-part" style="color:${c.color||'#8fb0c8'}">${c.name}<em>${partText(c)}</em></div>
          <div class="fs-btns"><button class="btn ghost" data-rmcore="${c.uid}">卸下</button></div>
        </div>`);
      } else {
        coreRows.push(`<div class="forge-slot core empty">
          <div class="fs-name">改装槽 ${i+1}</div>
          <div class="fs-part" style="color:#6b7280">（空）<em>装入改装模块以换弹种 / 提改装等级 / 加参数</em></div>
        </div>`);
      }
    }
    const instUids=new Set(cores.map(c=>c.uid));
    const avail=(stash.parts||[]).filter(p=>p.core && !instUids.has(p.uid));
    const poolHtml = avail.length
      ? `<div class="core-pool">可用改装模块（点一下装入首个空槽）：${avail.map(a=>`<button class="btn ghost core-chip" data-addcore="${a.uid}" style="border-color:${a.color};color:${a.color}">${a.name}</button>`).join('')}</div>`
      : `<div class="hint" style="margin-top:6px;color:var(--muted)">仓库暂无可用改装模块 · 只能从保险箱 / Raider 掉落，或在局内枪械商店、黑市购买</div>`;
    partPanel = `
      <h3 style="font-size:18px;margin:18px 0 8px;">配件装配 <span style="color:var(--muted);font-size:12px;font-weight:400;">共 ${normalParts.length} / ${GUN_SLOTS.length} 槽位 · 配件只能用仓库实物换装</span></h3>
      <div class="forge-partbox">${rows}</div>
      <h3 style="font-size:18px;margin:18px 0 8px;">模块装配 <span style="color:var(--muted);font-size:12px;font-weight:400;">${cores.length} / ${coreCap} 槽 · 由品级决定（${RAID_RARITY_NAME[rIdx]||"民用"}）· 最高级膛压组件 = 枪械改装等级</span></h3>
      <div class="forge-partbox">${coreRows.join('')}</div>
      ${cores.length<coreCap ? poolHtml : `<div class="hint" style="margin-top:6px;color:var(--muted)">改装槽已满（${coreCap} 个）· 卸下后可装入更多</div>`}`;
  }

  const backLabel = opts.from==='title' ? '返回主菜单' : '前往配装大厅';
  UI._set(`
    <div class="panel raid-setup">
      <h2 class="title-big" style="font-size:32px;">枪匠台 · 精密改装</h2>
      <div class="subtitle">GUNSMITH · 用卢布重调改装词条 · 模块（弹种 / 膛压 / 工艺）装进改装槽即可换弹 / 提等级 / 加参数（部件只能实物换装）</div>
      ${forgeTabsHTML()}
      <div class="shop-bar">
        <div class="shop-desc">改造对象是塔科夫仓库中的枪械；改造后伤害、射速、弹匣、估值全部重算。改造不可撤销，谨慎升阶。<b style="color:#ff9a3a">配件槽位不支持重铸</b>——好配件只能从箱子里搜，或自己投料合成。</div>
        <div class="shop-gold">仓库卢布 ₽ ${priceTextShort(stash.creds)}</div>
        <button class="btn ghost" id="btn-forge-back">${backLabel}</button>
      </div>
      <div class="shop-list" style="margin-bottom:14px;">${cards}</div>
      ${opPanel}
      ${partPanel}
    </div>`);

  UI.overlay.querySelectorAll('[data-ftab]').forEach(el=>{
    el.onclick=()=>{ UI._forgeTab=el.dataset.ftab; SFX.ui(); UI.raidForge(opts); };
  });
  UI.overlay.querySelectorAll('[data-pick]').forEach(el=>{
    el.onclick=()=>{ UI._forgeSel=el.dataset.pick; SFX.ui(); UI.raidForge(opts); };
  });
  const applyOp=(op)=>{
    if(op!=="reroll") return;
    const idx=stash.weapons.findIndex(w=>w.uid===UI._forgeSel);
    if(idx<0) return;
    const gun=stash.weapons[idx];
    const cost=forgeCost(op,gun);
    if(stash.creds<cost){ UI.toast && UI.toast("卢布不足"); return; }
    stash.creds-=cost;
    const out=reforgeBlGun(gun,op);
    stash.weapons[idx]=out;
    RaidStash.save(stash); SFX.ui(); UI.raidForge(opts);
  };
  UI.overlay.querySelectorAll('[data-op]').forEach(el=>{
    el.onclick=()=>{ applyOp(el.dataset.op); };
  });
  // 装改装模块：点仓库改装模块 → 装入首个空改装槽（数量受品质限制）
  UI.overlay.querySelectorAll('[data-addcore]').forEach(el=>{
    el.onclick=()=>{
      const uid=el.dataset.addcore;
      const idx=stash.weapons.findIndex(w=>w.uid===UI._forgeSel); if(idx<0) return;
      const gun=stash.weapons[idx];
      const instN=(gun.parts||[]).filter(p=>p.core).length;
      if(instN>=raidCoreSlotCount(gun.rarity)){ UI.toast && UI.toast("改装槽已满"); return; }
      const ci=stash.parts.findIndex(p=>p.uid===uid); if(ci<0) return;
      const core=stash.parts.splice(ci,1)[0];
      const g=installPartOnGun(gun, Object.assign({},core,{slot:"core"+instN}));
      raidReindexCores(g);
      stash.weapons[idx]=g;
      RaidStash.save(stash); SFX.ui(); UI.raidForge(opts);
    };
  });
  // 卸下改装模块：退回仓库并重新计算武器数值（改装等级 / 弹种 / 增益）
  UI.overlay.querySelectorAll('[data-rmcore]').forEach(el=>{
    el.onclick=()=>{
      const uid=el.dataset.rmcore;
      const idx=stash.weapons.findIndex(w=>w.uid===UI._forgeSel); if(idx<0) return;
      const gun=stash.weapons[idx];
      const pi=(gun.parts||[]).findIndex(p=>p.uid===uid); if(pi<0) return;
      const core=gun.parts.splice(pi,1)[0];
      raidReindexCores(gun);
      const g=blGunConvert(generateWeapon(gun.ilvl,{
        rarity:gun.rarity, type:gun.type, manufacturer:gun.manufacturer,
        ilvl:gun.ilvl, affixes:gun.affixes||[], parts:gun.parts }));
      g.uid=gun.uid; g.kind=gun.kind||"weapon";
      core.slot="core";
      stash.parts.push(core);
      stash.weapons[idx]=g;
      RaidStash.save(stash); SFX.ui(); UI.raidForge(opts);
    };
  });
  // 普通配件换装（改装模块不会被选入普通槽）
  UI.overlay.querySelectorAll('[data-install]').forEach(el=>{
    el.onclick=()=>{
      const slot=el.dataset.install;
      const idx=stash.weapons.findIndex(w=>w.uid===UI._forgeSel);
      if(idx<0) return;
      const pi=(stash.parts||[]).findIndex(p=>!p.core && p.slot===slot);
      if(pi<0) return;
      const gun=stash.weapons[idx];
      const part=stash.parts.splice(pi,1)[0];
      const old=(gun.parts||[]).find(p=>p.slot===slot && !p.core);
      if(old) stash.parts.push(old);          // 旧配件退回配件池
      stash.weapons[idx]=installPartOnGun(gun, part);
      RaidStash.save(stash); SFX.ui(); UI.raidForge(opts);
    };
  });
  document.getElementById('btn-forge-back').onclick=()=>{
    SFX.ui();
    if(opts.from==='title') UI.title(); else UI.raidSetup();
  };
};

/* =========================================================================
 * 融合台：两件及以上枪械 / 配件 / 护甲 / 头盔 → 一件更高品质的产物
 *   第一件选中的物品决定产物类型；材料越多，品质与词条跃升越明显。
 * ========================================================================= */
UI.raidFusion=function(opts){
  opts=opts||{};
  const stash=RaidStash.load();
  if(!stash.parts) stash.parts=[];
  if(!stash.helmets) stash.helmets=[];
  if(!UI._fuseSel) UI._fuseSel=[];

  const entries=[];
  const push=(it,tab)=>{ if(it&&it.uid) entries.push({it,tab}); };
  for(const w of stash.weapons) push(w,'weapon');
  for(const a of stash.armors) push(a,'armor');
  for(const h of stash.helmets) push(h,'helmet');
  for(const s of (stash.shields||[])) push(s,'shield');
  // 改装模块不可融合升阶 —— 不进入融合台选材列表
  for(const p of stash.parts) if(!(p.slot==="core"||p.core)) push(p,'part');
  UI._fuseSel=UI._fuseSel.filter(uid=>entries.some(e=>e.it.uid===uid));

  const items=UI._fuseSel.map(uid=>entries.find(e=>e.it.uid===uid).it).filter(Boolean);
  const cost=items.length>=2 ? ((items[0]&&(items[0].slot==="core"||items[0].core)) ? 0 : fuseCost(items)) : 0;
  const can=items.length>=2 && stash.creds>=cost;
  const main=items[0]||null;
  const rarityName=it=>{
    if(typeof it.rarity==="number") return RAID_RARITY_NAME[it.rarity]||"普通";
    const R=RARITY_BY_ID[it.rarity];
    return R?R.name:"普通";
  };
  const kindName=it=>{
    if(it.kind==="weapon"||it.dmg!==undefined) return (WEAPON_TYPES[it.type]&&WEAPON_TYPES[it.type].name)||"枪械";
    if(it.kind==="helmet") return `T${it.tier} 头盔`;
    if(it.kind==="shield") return `T${it.tier} 护盾`;
    if(it.kind==="armor") return `T${it.tier} 护甲`;
    if(it.slot==="core"||it.core) return raidCoreName(it);
    if(it.kind==="receiver") return `底材 · T${it.tier}`;
    return `配件 · ${GUN_SLOT_BY_ID[it.slot]?GUN_SLOT_BY_ID[it.slot].name:(it.slot||"")}`;
  };
  const card=({it},i)=>{
    const on=UI._fuseSel.includes(it.uid);
    const col=raidGunColor(it);
    const isMain=on && UI._fuseSel[0]===it.uid;
    const nAff=(it.affixes||[]).length;
    const stat=it.kind==="weapon"||it.dmg!==undefined
      ? `伤害 ${it.dmg} · 配件 ${(it.parts||[]).length} · 词条 ${nAff}${it.mayhem>0?(' · 改装'+it.mayhem):''}`
      : it.kind==="shield" ? shieldLines(it).slice(0,3).join(" · ")
      : it.kind==="armor" ? `减伤 ${Math.round((it.dr||0)*100)}% · 耐久 ${it.maxArmor}`
      : it.kind==="helmet" ? `爆头减伤 ${Math.round((it.dr||0)*100)}% · 耐久 ${it.maxArmor}`
      : (it.slot==="core"||it.core) ? `${RAID_ROMAN[it.lv]} 阶 · 两件同阶同类型可升阶`
      : partText(it);
    return `<div class="shop-item ${on?'sel':''}" data-fuse="${it.uid}"
      style="border-left-color:${col};cursor:pointer;${on?('box-shadow:inset 0 0 0 2px '+col+';'):''}">
      <div class="si-name" style="color:${col}">${it.name}${isMain?' <em style="color:#ffd23f;font-style:normal;">［主］</em>':''}</div>
      <div class="si-meta">${kindName(it)} · ${rarityName(it)}</div>
      <div class="si-stats">${stat}<br>估值 ₽${priceText(it.value||partValue(it)||0)}</div>
    </div>`;
  };
  const cards=entries.length?entries.map(card).join(''):`<div class="empty-hint">仓库为空 · 先去突袭搜刮或军火超市采购</div>`;

  let preview='<div class="hint">至少选择 2 件物品。第一件决定产物类型（枪 / 甲 / 盔 / 配件）。</div>';
  if(items.length>=2){
    const n=items.length;
    if(main && (main.kind==="weapon"||main.dmg!==undefined)){
      const mr=Math.max(...items.map(it=>Math.max(0,RARITIES.findIndex(r=>r.id===(it.rarity||"white")))));
      const boost=1+(n>=3?1:0)+(n>=4?1:0);
      const tr=RARITIES[Math.min(RARITIES.length-1,mr+boost)];
      preview=`<div class="hint" style="color:#8fd0ff;">
        产物：<b>${tr.name}</b> ${kindName(main)} · 词条约 <b>${Math.min(10,3+n-1)}</b> 条 · 改装 <b>${Math.max(0,...items.map(x=>x.mayhem||0))}~+1</b> · 配件品质各升 1 档</div>`;
    } else if(main && main.kind==="shield"){
      const mt=Math.max(...items.map(x=>x.tier||1));
      const mr=Math.max(...items.map(x=>qOf(x)));
      const pfT=Math.min(9,mt+(n>=3?1:0)), pfR=Math.min(8,mr+1+(n>=3?1:0));
      preview=`<div class="hint" style="color:#8fd0ff;">
        产物：<b>T${pfT} 护盾</b> · 稀有度 <b style="color:${RAID_RARITY_COLOR[pfR]}">${RAID_RARITY_NAME[pfR]}</b> · 四配件与前后缀按新表重掷</div>`;
    } else if(main && (main.kind==="armor"||main.kind==="helmet")){
      const mt=Math.max(...items.map(x=>x.tier||1));
      const mr=Math.max(...items.map(x=>x.rarity|0));
      const pfT=Math.min(9,mt+(n>=3?1:0)), pfR=Math.min(8,mr+1+(n>=3?1:0));
      preview=`<div class="hint" style="color:#8fd0ff;">
        产物：<b>T${pfT} ${main.kind==="helmet"?"头盔":"护甲"}</b> · 稀有度 <b style="color:${RAID_RARITY_COLOR[pfR]}">${RAID_RARITY_NAME[pfR]}</b> · 按新表满耐久生成</div>`;
    } else if(main && (main.slot==="core"||main.core)){
      const same=items.filter(i=>(i.slot==="core"||i.core)&&i.core===main.core&&i.lv===main.lv&&(i.elem||"")===(main.elem||"")&&(i.boost||"")===(main.boost||""));
      const ok=same.length>=2 && main.lv<RAID_CORE_MAX;
      let upName = main.core==="chaos" ? "膛压组件"
        : main.core==="elem" ? ("弹种适配组件·"+(ELEMENTS[main.elem]?ELEMENTS[main.elem].name:""))
        : ("改装模块·"+(BOOST_CORE_TYPES[main.boost]?BOOST_CORE_TYPES[main.boost].name:""));
      preview=`<div class="hint" style="color:${ok?'#8fe07a':'#ff8a5a'}">
        产物：<b>${ok?upName+" ["+RAID_ROMAN[main.lv+1]+"]":"无法升阶（需 2 个同阶同型改装模块，且未满 V 级）"}</b></div>`;
    } else {
      preview=`<div class="hint" style="color:#8fd0ff;">
        产物：<b>高品质配件</b> · 品质提升 1~2 档 · 词条按新品质重掷</div>`;
    }
  }

  const resultCard = UI._fuseResult ? (()=>{ const r=UI._fuseResult;
    if(r.kind==="weapon"||r.dmg!==undefined) return raidWeaponCard(r,{prefix:"融合成功 · "});
    if(r.kind==="shield") return shieldCard(r,{prefix:"融合成功 · ",margin:true});
    const col=raidGunColor(r);
    if(r.kind==="armor"||r.kind==="helmet") return `<div class="shop-item" style="border-left-color:${col};margin:12px 0;">
      <div class="si-name" style="color:${col}">融合成功 · ${r.name}</div>
      <div class="si-meta">${kindName(r)} · ${rarityName(r)}</div>
      <div class="si-stats">${r.kind==="helmet"?`爆头减伤 ${Math.round((r.dr||0)*100)}% · 耐久 ${r.maxArmor}`:`减伤 ${Math.round((r.dr||0)*100)}% · 耐久 ${r.maxArmor}`}</div>
    </div>`;
    return `<div class="shop-item" style="border-left-color:${col};margin:12px 0;">
      <div class="si-name" style="color:${col}">融合成功 · ${r.name}</div>
      <div class="si-meta">${kindName(r)} · ${rarityName(r)}</div>
      <div class="si-stats">${partText(r)}</div>
    </div>`; })() : '';

  UI._set(`
    <div class="panel raid-setup">
      <h2 class="title-big" style="font-size:32px;">枪匠台 · 融合台</h2>
      <div class="subtitle">FUSION · 两件以上装备拆件重组，品级 / 改装词条 / 改装等级有概率跃升</div>
      ${forgeTabsHTML()}
      <div class="shop-bar">
        <div class="shop-desc">选择 2~4 件材料（枪 / 配件 / 护甲 / 头盔可混搭）。第一件为「主物品」，决定产物类型；材料越多，跃升越大。融合会消耗全部材料。</div>
        <div class="shop-gold">仓库卢布 ₽ ${priceText(stash.creds)}</div>
        <button class="btn ghost" id="btn-fuse-back">${opts.from==='title'?'返回主菜单':'前往配装大厅'}</button>
      </div>
      ${preview}
      ${resultCard}
      <div class="shop-list" style="margin:10px 0 14px;">${cards}</div>
      <div class="row" style="justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">
        <div class="raid-tip">已选 <b>${items.length}</b> 件${items.length?` · 主物品：<b style="color:#ffd23f">${main.name}</b>`:''}</div>
        <button class="btn" id="btn-fuse-do" ${can?'':'disabled'}>融合${items.length>=2?`（₽${priceText(cost)}）`:''}</button>
      </div>
    </div>`);

  UI.overlay.querySelectorAll('[data-ftab]').forEach(el=>{
    el.onclick=()=>{ UI._forgeTab=el.dataset.ftab; SFX.ui(); UI.raidForge(opts); };
  });
  UI.overlay.querySelectorAll('[data-fuse]').forEach(el=>{
    el.onclick=()=>{
      const uid=el.dataset.fuse;
      const i=UI._fuseSel.indexOf(uid);
      if(i>=0) UI._fuseSel.splice(i,1);
      else if(UI._fuseSel.length<4) UI._fuseSel.push(uid);
      UI._fuseResult=null; SFX.ui(); UI.raidFusion(opts);
    };
  });
  const doBtn=document.getElementById('btn-fuse-do');
  if(doBtn) doBtn.onclick=()=>{
    if(items.length<2 || stash.creds<cost) return;
    const out=fuseRaidItems(items);
    if(!out) return;
    for(const it of items){
      const arr = (it.kind==="weapon"||it.dmg!==undefined) ? stash.weapons
        : it.kind==="armor" ? stash.armors
        : it.kind==="helmet" ? stash.helmets
        : it.kind==="shield" ? (stash.shields=stash.shields||[])
        : stash.parts;
      const i=arr.findIndex(x=>x.uid===it.uid);
      if(i>=0) arr.splice(i,1);
    }
    if(out.kind==="weapon") stash.weapons.push(out);
    else if(out.kind==="armor") stash.armors.push(out);
    else if(out.kind==="helmet") stash.helmets.push(out);
    else if(out.kind==="shield") (stash.shields=stash.shields||[]).push(out);
    else stash.parts.push(out);   // 改装模块 / 配件统一进配件池
    stash.creds-=cost;
    RaidStash.save(stash);
    UI._fuseSel=[]; UI._fuseResult=out;
    SFX.ui(); UI.raidFusion(opts);
  };
  document.getElementById('btn-fuse-back').onclick=()=>{
    SFX.ui();
    if(opts.from==='title') UI.title(); else UI.raidSetup();
  };
};

/* 轻量浮层提示：overlay 界面（仓库/融合/装配）里也能看到，不依赖游戏内 toast */
UI.toast=function(msg, ms){
  let el=document.getElementById("ui-toast");
  if(!el){
    el=document.createElement("div");
    el.id="ui-toast"; el.className="ui-toast";
    document.body.appendChild(el);
  }
  el.textContent=msg; el.classList.add("on");
  clearTimeout(UI._toastTimer);
  UI._toastTimer=setTimeout(()=>el.classList.remove("on"), ms||1800);
};

/* =========================================================================
 * 仓库管理 · 售卖 / 拆解
 *   · 售卖：按估值 50%（RAID_VENDOR_RATE）换成卢布
 *   · 拆解：枪械拆成配件（配件进配件池，可装到别的枪上 / 在超市卖掉）
 * ========================================================================= */
UI.raidStash=function(opts){
  opts=opts||{};
  const stash=RaidStash.load();
  if(!stash.parts) stash.parts=[];
  if(!stash.helmets) stash.helmets=[];
  const TAB=UI._stashTab||"weapon";

  const wCards = stash.weapons.length ? stash.weapons.map(w=>raidWeaponCard(w,{sell:true})).join('') : `<div class="empty-hint">仓库暂无枪械</div>`;

  const aCards = stash.armors.length ? stash.armors.map(a=>{
    const rar=a.rarity|0, col=RAID_RARITY_COLOR[rar]||ARMOR_TIER_COLOR[a.tier];
    return `<div class="shop-item" style="border-left-color:${col}">
      <div class="si-name" style="color:${col}">${a.name}<span style="font-size:11px;opacity:.9"> · ${RAID_RARITY_NAME[rar]}</span></div>
      <div class="si-meta">T${a.tier||"?"} · ${RAID_RARITY_NAME[rar]} · 躯干${a.armorRegen?(' · 待维修 '+a.armorRegen+'/s'):''}${a.uniqPerk?' · <b style="color:#ffd23f">具名装备</b>':''}</div>
      ${a.uniqPerk?`<div class="uniq-perk">✦ ${a.uniqPerk}</div>`:''}
      <div class="si-stats">减伤 ${Math.round((a.dr||0)*100)}% · 护甲值 ${a.maxArmor} · 估值 ₽${priceTextShort(a.value)}</div>
      <div class="si-buy"><span class="si-price">₽ ${priceTextShort((a.value||0)*RAID_VENDOR_RATE)}</span>
        <button class="btn ghost" data-sell="a:${a.uid}">售卖</button></div>
    </div>`;
  }).join('') : `<div class="empty-hint">仓库暂无护甲</div>`;

  const hCards = stash.helmets.length ? stash.helmets.map(h=>{
    const rar=h.rarity|0, col=RAID_RARITY_COLOR[rar]||ARMOR_TIER_COLOR[h.tier];
    return `<div class="shop-item" style="border-left-color:${col}">
      <div class="si-name" style="color:${col}">${h.name}<span style="font-size:11px;opacity:.9"> · ${RAID_RARITY_NAME[rar]}</span></div>
      <div class="si-meta">T${h.tier||"?"} · ${RAID_RARITY_NAME[rar]} · 头部${h.uniqPerk?' · <b style="color:#ffd23f">具名装备</b>':''}</div>
      ${h.uniqPerk?`<div class="uniq-perk">✦ ${h.uniqPerk}</div>`:''}
      <div class="si-stats">爆头减伤 ${Math.round((h.dr||0)*100)}% · 耐久 ${h.maxArmor} · 估值 ₽${priceTextShort(h.value)}</div>
      <div class="si-buy"><span class="si-price">₽ ${priceTextShort((h.value||0)*RAID_VENDOR_RATE)}</span>
        <button class="btn ghost" data-sell="h:${h.uid}">售卖</button></div>
    </div>`;
  }).join('') : `<div class="empty-hint">仓库暂无头盔</div>`;

  const sCards = (stash.shields||[]).length
    ? stash.shields.map(s=>shieldCard(s,{sell:true})).join('')
    : `<div class="empty-hint">仓库暂无护盾 · 突袭掉落 / 工坊合成 / 融合 / 军火超市购买</div>`;

  const pCards = stash.parts.length ? stash.parts.map((pt,i)=>{
    const col=(RARITY_BY_ID[pt.rarity]||{color:"#cfd8e2"}).color;
    const sn=GUN_SLOT_BY_ID[pt.slot]?GUN_SLOT_BY_ID[pt.slot].name:pt.slot;
    const pv=partValue(pt);
    return `<div class="shop-item" style="border-left-color:${col}">
      <div class="si-name" style="color:${col}">${pt.name}</div>
      <div class="si-meta">配件 · ${sn}槽位 · iLv ${pt.ilvl||1}</div>
      <div class="si-stats">${partText(pt)}</div>
      <div class="si-buy"><span class="si-price">₽ ${priceTextShort(pv*0.6)}</span>
        <button class="btn ghost" data-sell="p:${i}">售卖</button></div>
    </div>`;
  }).join('') : `<div class="empty-hint">配件池为空 · 拆解枪械或去超市配件页采购</div>`;

  // 材料页：同种材料合并成堆（按 id 聚合），显示数量 / 单件估值 / 合计
  const matStacks=[];
  for(const m of (stash.materials||[])){
    let s=matStacks.find(x=>x.id===m.id);
    if(!s){ s={ id:m.id, item:m, n:0 }; matStacks.push(s); }
    s.n++;
  }
  matStacks.sort((a,b)=>(a.item.tier|0)-(b.item.tier|0));
  const mCards = matStacks.length ? matStacks.map(s=>{
    const m=s.item, col=RAID_RARITY_COLOR[m.tier]||"#dfe7f0";
    return `<div class="shop-item" style="border-left-color:${col}">
      <div class="si-name" style="color:${col}">${m.name}<span style="font-size:12px;font-weight:800;opacity:.85"> ×${s.n}</span></div>
      <div class="si-meta">${RAID_TIERS[m.tier]?RAID_TIERS[m.tier].name:"普通"} · T${m.tier} · ${(RAID_MAT_BY_ID[m.id]||{}).tag||"材料"}</div>
      <div class="si-stats">单价 ₽${priceTextShort(m.value)} · 合计 ₽${priceTextShort((m.value||0)*s.n)}</div>
      <div class="si-buy"><span class="si-price">₽ ${priceTextShort(Math.round((m.value||0)*0.6))}</span>
        <button class="btn ghost" data-sell="m:${m.id}">售卖 1 份</button></div>
    </div>`;
  }).join('') : `<div class="empty-hint">仓库暂无原材料 · 去突袭里搜刮，或在结算时带出</div>`;

  const tabs=[{id:'weapon',name:'武器',n:stash.weapons.length},{id:'armor',name:'护甲',n:stash.armors.length},
    {id:'helmet',name:'头盔',n:stash.helmets.length},{id:'shield',name:'护盾',n:(stash.shields||[]).length},
    {id:'part',name:'配件',n:stash.parts.length},
    {id:'mat',name:'材料',n:matStacks.reduce((s,x)=>s+x.n,0)}];
  const body = TAB==='weapon'?wCards : TAB==='armor'?aCards : TAB==='helmet'?hCards : TAB==='shield'?sCards : TAB==='mat'?mCards : pCards;
  const backLabel = opts.from==='title' ? '返回主菜单' : '前往配装大厅';

  UI._set(`
    <div class="panel raid-setup">
      <h2 class="title-big" style="font-size:32px;">仓库</h2>
      <div class="subtitle">STASH · 售卖换卢布 / 拆解换配件</div>
      <div class="shop-bar">
        <div class="shop-desc">背包直售只按估值 <b style="color:#ff8a5a">50%</b> 回收卢布（<b style="color:#62c8ff">带进图卖给回收超市可得 120%（±40%）</b>）；拆解会把枪上的全部配件拆进配件池（枪本身消失），配件可装到别的枪上或在配件页卖掉。</div>
        <div class="shop-gold">仓库卢布 ₽ ${priceTextShort(stash.creds)}</div>
        <button class="btn ghost" id="btn-stash-back">${backLabel}</button>
      </div>
      <div class="shop-tabs">
        ${tabs.map(t=>`<button class="shop-tab ${TAB===t.id?'on':''}" data-stab="${t.id}"><b>${t.name}</b><span class="tab-tag">${t.n}</span></button>`).join('')}
      </div>
      <div class="shop-list">${body}</div>
      <div class="hint" style="margin-top:12px;">提示：拆解高稀有度枪械能得到高品质配件，再装到喜欢的枪上，比直接卖掉更划算。</div>
    </div>`);

  UI.overlay.querySelectorAll('[data-stab]').forEach(el=>{
    el.onclick=()=>{ UI._stashTab=el.dataset.stab; SFX.ui(); UI.raidStash(opts); };
  });

  UI.overlay.querySelectorAll('[data-sell]').forEach(el=>{
    el.onclick=()=>{
      const [kind,key]=el.dataset.sell.split(':');
      if(kind==='w'){
        const i=stash.weapons.findIndex(w=>w.uid===key); if(i<0) return;
        const g=stash.weapons[i];
        stash.creds+=gunSellPrice(g); stash.weapons.splice(i,1);
      } else if(kind==='a'){
        const i=stash.armors.findIndex(a=>a.uid===key); if(i<0) return;
        stash.creds+=Math.round((stash.armors[i].value||0)*RAID_VENDOR_RATE); stash.armors.splice(i,1);
      } else if(kind==='h'){
        const i=stash.helmets.findIndex(h=>h.uid===key); if(i<0) return;
        stash.creds+=Math.round((stash.helmets[i].value||0)*RAID_VENDOR_RATE); stash.helmets.splice(i,1);
      } else if(kind==='s'){
        const i=(stash.shields||[]).findIndex(s=>s.uid===key); if(i<0) return;
        stash.creds+=Math.round((stash.shields[i].value||0)*RAID_VENDOR_RATE); stash.shields.splice(i,1);
      } else if(kind==='m'){
        // 材料按堆售卖：每次卖掉 1 份（同种材料在仓库里是合并显示的一堆）
        const i=(stash.materials||[]).findIndex(m=>m.id===key); if(i<0) return;
        const m=stash.materials[i];
        stash.creds+=Math.round((m.value||0)*RAID_VENDOR_RATE); stash.materials.splice(i,1);
      } else {
        const i=parseInt(key,10); if(isNaN(i)||!stash.parts[i]) return;
        stash.creds+=Math.round(partValue(stash.parts[i])*RAID_VENDOR_RATE); stash.parts.splice(i,1);
      }
      RaidStash.save(stash); SFX.ui(); UI.raidStash(opts);
    };
  });

  UI.overlay.querySelectorAll('[data-salvage]').forEach(el=>{
    el.onclick=()=>{
      const uid=el.dataset.salvage;
      const i=stash.weapons.findIndex(w=>w.uid===uid); if(i<0) return;
      const parts=salvageGun(stash.weapons[i]);
      for(const pt of parts){
        stash.parts.push(Object.assign({}, pt, {
          uid:"pt-"+Date.now()+"-"+Math.floor(Math.random()*1e6)
        }));
      }
      stash.weapons.splice(i,1);
      RaidStash.save(stash); SFX.ui();
      UI.toast && UI.toast(`已拆解 · 配件池 +${parts.length} 件`);
      UI.raidStash(opts);
    };
  });

  document.getElementById('btn-stash-back').onclick=()=>{
    SFX.ui();
    if(opts.from==='title') UI.title(); else UI.raidSetup();
  };
};

/* =========================================================================
 * 联机突袭 · 大厅
 *   创建 / 加入房间 → 等待房主开始 → 用同一 seed 进图
 * ========================================================================= */
UI._onlineNick = (function(){ try{ return localStorage.getItem("raid_nick")||""; }catch(e){ return ""; } })();
UI._onlineMsg  = "";
UI._onlineBusy = false;

UI._onlineStop=function(){
  if(UI._onlineTimer){ clearInterval(UI._onlineTimer); UI._onlineTimer=null; }
};

UI._onlineCarryText=function(){
  const stash=RaidStash.load(), sel=UI._raidSel||{w:[],a:null,h:null};
  const ws=(sel.w||[]).map(uid=>{ const w=stash.weapons.find(x=>x.uid===uid); return w?w.name:null; }).filter(Boolean);
  const a=sel.a?stash.armors.find(x=>x.uid===sel.a):null;
  const h=sel.h?(stash.helmets||[]).find(x=>x.uid===sel.h):null;
  const bits=[];
  bits.push(ws.length?ws.join(" + "):"空手");
  if(a) bits.push(a.name);
  if(h) bits.push(h.name);
  return bits.join(" · ");
};

UI._onlineEnter=function(){
  if(UI._onlineEntering) return;
  if(!Net.code || !Net.peerId) return;
  UI._onlineEntering=true;
  UI._onlineStop();
  const sel=UI._raidSel||{w:[],a:null,h:null};
  const st=RaidStash.load();
  // 联机也必须沿用大厅选择的钥匙/现金/GP 币，不能默认把仓库全部钥匙带进图。
  const pickedKeys=Array.isArray(UI._raidKeys)?UI._raidKeys.slice():(st.keys||[]).map(k=>k.uid);
  const cash=Math.max(0,Math.min(Math.round(UI._raidCash||0),Math.floor(st.creds||0)));
  const tokens=Math.max(0,Math.min(Math.round(UI._raidTok||0),Math.floor(st.tokens||0)));
  const hasGear=!!((sel.w||[]).length||sel.a||sel.h);
  const opts={
    weapons:[...(sel.w||[])], armor:sel.a||null, helmet:sel.h||null,
    insure:!!UI._raidIns&&hasGear, keys:pickedKeys, cash, tokens,
    online:true, seed:Net.seed,
  };
  UI._raidSel={w:[],a:null,h:null,s:null}; UI._raidIns=false;
  try{ game.startRaid(opts); }
  catch(e){
    console.error(e);
    UI._onlineMsg="进入战区失败，装备已退回仓库";
    UI._onlineStop();
    try{ Net.leave(true); }catch(e2){}
    game.toTitle();
    UI.raidSetup();
  }
  setTimeout(()=>{ UI._onlineEntering=false; },1600);
};

UI.raidOnline=function(){
  const inRoom = !!(Net.code && Net.peerId);
  const busy = UI._onlineBusy;
  const p2p = Net.transport==="p2p" || (typeof NetP2P!=="undefined" && !!NetP2P.mode);
  const esc=s=>String(s==null?"":s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const msg = UI._onlineMsg ? `<div class="hint" style="color:#ffb347">${esc(UI._onlineMsg)}</div>` : "";

  let body="";
  if(!inRoom){
    body=`
      <div class="online-grid">
        <div class="online-card">
          <h3>创建房间</h3>
          <p>你是房主：负责模拟 AI，其他人加入你的战区。</p>
          <label class="online-label">呼号</label>
          <input class="online-input" id="online-nick" maxlength="16" placeholder="例如：雪松" value="${esc(UI._onlineNick||"")}">
          <button class="btn" id="online-create" ${busy?'disabled':''}>创建房间</button>
        </div>
        <div class="online-card">
          <h3>加入房间</h3>
          <p>向房主要 4 位房间码，输入后即可进入同一战区。</p>
          <label class="online-label">房间码</label>
          <input class="online-input" id="online-code" maxlength="4" placeholder="ABCD"
                 style="text-transform:uppercase;letter-spacing:4px;font-weight:900;">
          <button class="btn ghost" id="online-join" ${busy?'disabled':''}>加入房间</button>
        </div>
      </div>
      ${msg}`;
  } else {
    const room=Net.room||{peers:[{id:Net.peerId,name:Net.name,host:Net.isHost}]};
    const peers=room.peers||[];
    const rows=peers.map(p=>`
      <div class="online-peer ${p.id===Net.peerId?'me':''}">
        <span class="online-dot" style="background:${p.host?'#ffd23f':'#7ee08a'}"></span>
        <b>${esc(p.name||"PMC")}</b>
        ${p.host?'<span class="online-tag host">房主</span>':''}
        ${p.id===Net.peerId?'<span class="online-tag me">你</span>':''}
      </div>`).join("");
    body=`
      <div class="online-room">
        <div class="online-code-box">
          <div class="online-code-label">房间码</div>
          <div class="online-code" id="online-code-show">${Net.code}</div>
          <button class="btn ghost small" id="online-copy">复制</button>
        </div>
        <div class="online-room-info">
          <div class="online-sec">玩家 ${peers.length}/4</div>
          <div class="online-peers">${rows}</div>
          <div class="online-sec">你的携带</div>
          <div class="online-carry">${esc(UI._onlineCarryText())}</div>
          <div class="online-sec">规则</div>
          <div class="online-rules">同一张地图 / 同一批 AI / 箱子先到先得 · 队友无友伤 · 撤离与战利品各自结算</div>
          <div class="row" style="margin-top:14px;justify-content:flex-start;">
            ${Net.isHost
              ? `<button class="btn" id="online-start" ${busy?'disabled':''}>开始突袭</button>`
              : `<button class="btn ghost" disabled>等待房主开始…</button>`}
            <button class="btn ghost" id="online-leave">离开房间</button>
          </div>
        </div>
      </div>
      ${msg}`;
  }

  UI._set(`
    <div class="panel raid-setup">
      <h2 class="title-big" style="font-size:32px;">联机突袭</h2>
      <div class="subtitle">CO-OP RAID · 2~4 人 · ${p2p?"WebRTC P2P 直连":"房主权威 AI"} · 战利品各自带出</div>
      <div class="shop-bar">
        <div class="shop-desc">和队友进入<b style="color:#7ee08a">同一张地图</b>：地图、箱子、撤离点、增援都一致；<b style="color:#ffd23f">AI 由房主统一模拟</b>，其他人实时同步。箱子<b>先到先得</b>，队友之间<b style="color:#8fe07a">没有友伤</b>，撤离与结算<b>各自独立</b>——你带出的东西只进你自己的仓库。</div>
        <button class="btn ghost" id="online-back">返回配装大厅</button>
      </div>
      ${body}
      <div class="hint" style="margin-top:14px;">联机只影响突袭内：大厅、仓库、拍卖行仍然是<b>各自独立</b>的。${p2p
        ? "当前为 <b style='color:#7ee08a'>GitHub Pages 直连模式</b>：PeerJS 公共信令 + WebRTC，房主离开即结束；双方都在严格 NAT 后可能连不上，可换用官方 server.js 部署。"
        : "掉线后 60 秒内可用同一房间重新加入（需要原 peer 身份）。"}</div>
    </div>`, !!UI._onlineKeep);
  if(!UI._onlineKeep){
    UI._onlineKeep=true;
    const ov=UI.overlay, pan=ov?ov.querySelector('.panel'):null;
    if(ov) ov.scrollTop=0;
    if(pan) pan.scrollTop=0;
  }

  const back=document.getElementById('online-back');
  if(back) back.onclick=async()=>{ SFX.ui(); UI._onlineStop(); UI._onlineKeep=false; if(Net.code) await Net.leave(true); UI.raidSetup(); };

  if(!inRoom){
    const nick=document.getElementById('online-nick');
    const code=document.getElementById('online-code');
    const readNick=()=>{
      const v=(nick.value||"").trim().slice(0,16)||"PMC";
      UI._onlineNick=v; try{ localStorage.setItem("raid_nick", v); }catch(e){}
      return v;
    };
    const create=document.getElementById('online-create');
    if(create) create.onclick=async()=>{
      if(UI._onlineBusy) return;
      UI._onlineBusy=true; UI._onlineMsg="正在创建房间…"; UI.raidOnline();
      const r=await Net.create(readNick());
      UI._onlineBusy=false;
      if(!r.ok){ UI._onlineMsg=r.msg||"创建失败"; UI.raidOnline(); return; }
      UI._onlineMsg=""; UI._onlineStartPoll(); UI.raidOnline();
    };
    const join=document.getElementById('online-join');
    if(join) join.onclick=async()=>{
      if(UI._onlineBusy) return;
      const c=(code.value||"").trim().toUpperCase();
      if(c.length<4){ UI._onlineMsg="房间码是 4 位字母/数字"; UI.raidOnline(); return; }
      UI._onlineBusy=true; UI._onlineMsg="正在加入…"; UI.raidOnline();
      const r=await Net.join(c, readNick());
      UI._onlineBusy=false;
      if(!r.ok){ UI._onlineMsg=r.msg||"加入失败"; UI.raidOnline(); return; }
      UI._onlineMsg=""; UI._onlineStartPoll(); UI.raidOnline();
    };
  } else {
    const copy=document.getElementById('online-copy');
    if(copy) copy.onclick=async()=>{
      SFX.ui();
      try{ await navigator.clipboard.writeText(Net.code); UI._onlineMsg="房间码已复制"; }
      catch(e){ UI._onlineMsg="复制失败，请手动记下："+Net.code; }
      UI.raidOnline();
    };
    const leave=document.getElementById('online-leave');
    if(leave) leave.onclick=async()=>{ SFX.ui(); UI._onlineStop(); await Net.leave(true); UI._onlineMsg="已离开房间"; UI.raidOnline(); };
    const start=document.getElementById('online-start');
    if(start) start.onclick=async()=>{
      if(UI._onlineBusy) return;
      UI._onlineBusy=true; UI._onlineMsg="正在开始…";
      const r=await Net.startRoom();
      UI._onlineBusy=false;
      if(!r.ok){ UI._onlineMsg=r.msg||"开始失败"; UI.raidOnline(); return; }
      UI._onlineMsg=""; UI._onlineEnter();
    };
    UI._onlineStartPoll();
  }
};

UI._onlineStartPoll=function(){
  UI._onlineStop();
  UI._onlineTimer=setInterval(async()=>{
    if(!UI.overlay || UI.overlay.classList.contains('hidden') ||
       !document.getElementById('online-code-show')){
      UI._onlineStop(); return;
    }
    const r=await Net.pollRoom();
    if(!r){ return; }
    if(r.started && Net.code){
      // 房主已经点了开始：所有客户端一起进图
      UI._onlineEnter();
      return;
    }
    // 玩家列表有变化才重绘，避免一直闪
    const sig=(r.room&&r.room.peers?r.room.peers.map(p=>p.id+p.name).join("|"):"")+":"+(r.host?1:0);
    if(sig!==UI._onlineSig){ UI._onlineSig=sig; UI._keepScroll(()=>UI.raidOnline()); }
  },1400);
};
