/* =========================================================================
 * econ_probe.cjs — 经济 / 数值体检探针（零 npm 依赖，Node 原生 vm）
 *
 * 与 verify.cjs 的差别：verify 断言「数值契约没被改坏」，本探针回答
 * 「这组数值跑起来到底是什么结果」—— 套利区间、撤离费曲线、稀有度预算、
 * 单趟净利，全部直接调用游戏里的真实函数，不 mock、不复制公式。
 *
 * 用法：node tools/econ_probe.cjs [--out <path.json>]
 * ========================================================================= */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');

const anyObj = new Proxy(function () {}, {
  get(t, k) {
    if (k === 'length') return 0;
    if (k === Symbol.iterator) return function* () {};
    if (k === 'style' || k === 'classList' || k === 'dataset') return anyObj;
    if (k === 'then') return undefined;
    return anyObj;
  },
  set() { return true; },
  apply() { return anyObj; },
  construct() { return anyObj; },
});
const sandbox = {
  console, Math, JSON, Date, Number, String, Array, Object, Set, Map, Infinity, NaN,
  parseInt, parseFloat, isNaN, isFinite, encodeURIComponent, decodeURIComponent,
  URLSearchParams, TextEncoder, TextDecoder,
  crypto: require('crypto').webcrypto,
  performance: { now: () => Date.now() },
  setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
  requestAnimationFrame: () => 0, cancelAnimationFrame: () => {},
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  location: { search: '', href: 'http://localhost/' },
  navigator: { userAgent: 'node', maxTouchPoints: 0 },
  document: anyObj,
  fetch: () => Promise.reject(new Error('no network')),
  AbortController: function () { this.signal = {}; this.abort = () => {}; },
  addEventListener: () => {}, removeEventListener: () => {},
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

const files = ['sanitize', 'config', 'util', 'store', 'weapons', 'items', 'shields', 'skills',
  'player', 'enemies', 'combat', 'world', 'endless', 'dust2', 'shop', 'input', 'render', 'ui',
  'viewmode', 'fpview', 'raid-data', 'raid-legends', 'raid-geometry', 'raid-core', 'raid-core2',
  'raid-core3', 'raid-render', 'raid-ui', 'raid-ui2', 'net', 'net-p2p', 'auction', 'br', 'save'];
let loaded = 0;
for (const f of files) {
  const p = path.join(SRC, f + '.js');
  if (!fs.existsSync(p)) continue;
  try { vm.runInContext(fs.readFileSync(p, 'utf8'), sandbox, { filename: f + '.js' }); loaded++; }
  catch (e) { console.error('LOAD FAIL ' + f + '.js: ' + e.message); }
}
const G = expr => vm.runInContext(expr, sandbox);

const result = G(`JSON.stringify((()=>{
  const out = { generatedAt: new Date().toISOString(), modules: ${loaded} };

  /* ---------- 1. 数据源快照 ---------- */
  out.constants = {
    mapW: RAID_MAP_W, mapH: RAID_MAP_H,
    raidDurationSec: 480,
    rooms: RAID_ROOMS.length,
    extracts: RAID_ROOMS.filter(r=>r.extract).length,
    poi: RAID_POI.length,
    surgeAt: RAID_SURGE_AT.slice(),
    ammoCap: RAID_AMMO_CAP, ammoStack: RAID_AMMO_STACK,
    barehandSpeed: RAID_BAREHAND_SPEED,
    rates: { vendor: RAID_VENDOR_RATE, fieldSell: RAID_FIELD_SELL_RATE,
             fieldJitter: RAID_FIELD_SELL_JITTER, shop: RAID_SHOP_RATE,
             shopJitter: RAID_SHOP_JITTER, super: RAID_SUPER_RATE,
             superJitter: RAID_SUPER_JITTER, ammoSell: 0.55 },
    budget: JSON.parse(JSON.stringify(RAID_BUDGET)),
    tierW: RAID_TIER_W.slice(), matTierW: RAID_MAT_TIER_W.slice(),
    partTierW: RAID_PART_TIER_W.slice(),
    armorT1: RAID_ARMORS[1], armorT9: RAID_ARMORS[9],
    aiSense: JSON.parse(JSON.stringify(RAID_AI_SENSE)),
    grades: AMMO_GRADES.map(g=>({lv:g.lv,power:g.power,value:g.value})),
    ammoTypeMult: { corrosive: AMMO_TYPES.corrosive.mult, shock: AMMO_TYPES.shock.mult },
  };

  /* ---------- 2. 四档价格 + 套利区间（对真实函数采样） ---------- */
  const vals=[10,30,50,120,300,420,980,2600,7200,19000,48000,128000,340000];
  const keys=[]; for(let i=0;i<64;i++) keys.push('probe_item_'+i);
  let lo=null, hi=null, sum=0, n=0, neg=0;
  const byValue={};
  for(const v of vals){
    let vLo=null, vHi=null, vSum=0;
    for(const k of keys){
      const buy=raidShopPrice(v,k), sell=raidFieldSellPrice(v,k);
      if(!buy) continue;
      const m=(sell-buy)/buy;
      sum+=m; n++; if(m<0) neg++;
      if(!lo||m<lo.margin) lo={value:v,key:k,buy,sell,margin:m};
      if(!hi||m>hi.margin) hi={value:v,key:k,buy,sell,margin:m};
      if(!vLo||m<vLo.margin) vLo={buy,sell,margin:m};
      if(!vHi||m>vHi.margin) vHi={buy,sell,margin:m};
      vSum+=m;
    }
    byValue[v]={ min:vLo.margin, max:vHi.margin, avg:vSum/keys.length };
  }
  /* 买价 key 与卖价 key 不同源的情形：材料/药品买用 m.id 或固定 id，
     回收用 item.uid||name，FNV 哈希不同 → 两个浮动独立，才可能出现亏损。 */
  let iLo=null, iHi=null, iSum=0, iNeg=0, iN=0;
  for(const v of vals){
    for(let i=0;i<64;i++){
      const buy=raidShopPrice(v,'buy_'+i), sell=raidFieldSellPrice(v,'sell_'+i);
      if(!buy) continue;
      const m=(sell-buy)/buy;
      iSum+=m; iN++; if(m<0) iNeg++;
      if(!iLo||m<iLo.margin) iLo={value:v,buy,sell,margin:m};
      if(!iHi||m>iHi.margin) iHi={value:v,buy,sell,margin:m};
    }
  }
  out.arbitrage = {
    theoreticalBase: RAID_FIELD_SELL_RATE/RAID_SHOP_RATE-1,   // 0.5 = 50%
    theoreticalBest: (RAID_FIELD_SELL_RATE+RAID_FIELD_SELL_JITTER)/(RAID_SHOP_RATE-RAID_SHOP_JITTER)-1,
    theoreticalWorst: (RAID_FIELD_SELL_RATE-RAID_FIELD_SELL_JITTER)/(RAID_SHOP_RATE+RAID_SHOP_JITTER)-1,
    sampledAvg: sum/n, sampledMin: lo, sampledMax: hi, negativeRate: neg/n, byValue,
    independentKey:{ avg:iSum/iN, min:iLo, max:iHi, negativeRate:iNeg/iN },
    note:'枪/配件买用 uid、回收也用 uid → 同一 key，两个浮动同向，套利恒正；'
       + '材料/药品买用 id、回收用 uid||name → key 不同源，浮动独立，可能亏损。',
  };
  /* 弹药回收：买 0.8× / 卖 0.55×，应为负 */
  const ammo=[];
  for(const v of [60,150,390,1140,3150]){
    const buy=raidShopPrice(v,'ammo_mid_1'), sell=raidAmmoSellPrice(v);
    ammo.push({value:v,buy,sell,margin:(sell-buy)/buy});
  }
  out.arbitrage.ammo=ammo;
  /* 四档价格对照（同一件 v=7200 的货） */
  const k='econ_probe_demo';
  out.priceLadder = {
    value:7200,
    fieldBuy: raidShopPrice(7200,k),
    fieldSell: raidFieldSellPrice(7200,k),
    bagSell: raidBagSellPrice(7200),
    superBuy: raidSuperPrice(7200,k),
  };

  /* ---------- 3. 撤离费曲线（真实函数） ---------- */
  const paid=Object.keys(RAID_EXTRACT_RULES)
    .filter(id=>RAID_EXTRACT_RULES[id].cost>0)
    .map(id=>({id, ...RAID_EXTRACT_RULES[id]}));
  const carry=[0,7000,30000,90000,300000,680000];
  out.extractFee = {
    zones: paid.map(z=>({id:z.id,cost:z.cost,feeRate:z.feeRate,cap:Math.round(z.cost*1.4/10)*10})),
    curve: carry.map(v=>({carryVal:v, mult:raidExtractFeeMult(v),
      fees: paid.map(z=>({id:z.id, fee:raidExtractFee(z,v)}))})),
  };

  /* ---------- 4. 稀有度预算实测（10 万次，固定种子） ---------- */
  RNG.setSeed(20261108);
  const N=100000, tierCount=new Array(9).fill(0);
  for(let i=0;i<N;i++){
    const t=raidBudgetTier(0);
    if(t>=0&&t<9) tierCount[t]++;
  }
  /* 口径：raidBudgetTier 先判特种段(r<pL)再判精选段(r<pR)，
     所以「精选及以上」= pR=3.2%（含特种），「精选段本体 T3/T4」= pR-pL=2.65%。 */
  const rareBand=(tierCount[3]+tierCount[4])/N*100;
  const rarePlus=tierCount.slice(3).reduce((a,b)=>a+b,0)/N*100;
  const legendPlus=tierCount.slice(5).reduce((a,b)=>a+b,0)/N*100;
  out.rarityBudget={ samples:N, per100:tierCount.map(c=>+(c/N*100).toFixed(3)),
    rareBandPct:+rareBand.toFixed(3), rarePlusPct:+rarePlus.toFixed(3),
    legendPlusPct:+legendPlus.toFixed(3),
    target:{rarePlus:RAID_BUDGET.lv0*100, rareBand:(RAID_BUDGET.lv0-RAID_BUDGET.lg0)*100,
            legendPlus:RAID_BUDGET.lg0*100} };
  /* 运气偏移（满 luck=1） */
  RNG.setSeed(20261108);
  let capRare=0, capLegend=0;
  for(let i=0;i<N;i++){ const t=raidBudgetTier(1); if(t>=3&&t<=4) capRare++; if(t>=5) capLegend++; }
  out.rarityBudget.luckCap={ rarePlusPct:+(capRare/N*100).toFixed(3),
    legendPlusPct:+(capLegend/N*100).toFixed(3) };

  /* ---------- 5. 时间品质曲线 / 局时 ---------- */
  out.timeLuck=[0,60,120,160,240,320,400,480].map(t=>({sec:t,luck:raidTimeLuck(t,480)}));

  /* ---------- 6. 黑市赌博机「孤品」真实概率 ---------- */
  const w=SHOPS.gamble.weights, tot=Object.values(w).reduce((a,b)=>a+b,0);
  out.gamble={ totalWeight:tot, singularityWeight:w.singularity,
    singularityPct:+(w.singularity/tot*100).toFixed(5),
    oneIn:Math.round(tot/w.singularity),
    note:'权重 0.0018 不等于概率 0.18%（1/556）；概率要除以总权重。' };

  /* ---------- 7. 单趟套利净利（按典型库存规模） ---------- */
  /* 每摊位库存买完即 splice，一趟能带走的件数受背包格与负重约束。
     这里取保守的「一趟 12 件材料 / 配件」估算，逐件用真实买价卖价算。 */
  const lootVals=[30,50,80,120,180,260,420,680,980,1500,2600,4200];
  let gross=0, cost=0;
  for(let i=0;i<lootVals.length;i++){
    const k='trip_'+i, v=lootVals[i];
    const b=raidShopPrice(v,k), s=raidFieldSellPrice(v,k);
    cost+=b; gross+=s;
  }
  out.oneTrip={ items:lootVals.length, cost, revenue:gross, net:gross-cost,
    margin:(gross-cost)/cost,
    feeAtNaked: raidExtractFee(paid[0],0),
    feeAtMid: raidExtractFee(paid[0],90000),
    note:'撤离费按「带入装备估值」计，套利货是带出物，不抬撤离费；约束只剩库存/负重/撤离风险。' };

  return out;
})())`);

const data = JSON.parse(result);
const outIdx = process.argv.indexOf('--out');
const outPath = outIdx > 0 ? path.resolve(process.argv[outIdx + 1]) : null;
if (outPath) fs.writeFileSync(outPath, JSON.stringify(data, null, 2), 'utf8');

/* ------------------------------- 控制台摘要 ------------------------------- */
const pct = x => (x * 100).toFixed(1) + '%';
const money = x => '₽' + Number(x).toLocaleString('en-US');
const a = data.arbitrage;
console.log('\n=== BORDER OPS 经济 / 数值体检 ===');
console.log('模块加载 ' + data.modules + '/34 · 局时 ' + data.constants.raidDurationSec + 's · 地图 '
  + data.constants.mapW + '×' + data.constants.mapH);
console.log('房间 ' + data.constants.rooms + ' · 撤离点 ' + data.constants.extracts
  + ' · 核心 POI ' + data.constants.poi + ' · 空投波次 ' + data.constants.surgeAt.join('/') + 's');
console.log('\n--- 套利（局内买 0.8±0.1 → 回收超市卖 1.2±0.4）---');
console.log('理论：基础 ' + pct(a.theoreticalBase) + ' / 最优 ' + pct(a.theoreticalBest)
  + ' / 最差 ' + pct(a.theoreticalWorst));
console.log('同源 key（枪/配件）：均值 ' + pct(a.sampledAvg) + ' / 最差 ' + pct(a.sampledMin.margin)
  + ' / 最优 ' + pct(a.sampledMax.margin) + ' / 亏损样本 ' + pct(a.negativeRate));
console.log('异源 key（材料/药品）：均值 ' + pct(a.independentKey.avg) + ' / 最差 '
  + pct(a.independentKey.min.margin) + ' / 最优 ' + pct(a.independentKey.max.margin)
  + ' / 亏损样本 ' + pct(a.independentKey.negativeRate));
console.log('弹药回收（买 0.8 / 卖 0.55）首样：' + pct(a.ammo[0].margin)
  + ' → ' + (a.ammo.every(x => x.margin < 0) ? '全档为负，倒卖已堵死' : '存在正收益，需复查'));
console.log('\n--- 价格四档（同一件 ' + money(data.priceLadder.value) + '）---');
console.log('局内买 ' + money(data.priceLadder.fieldBuy) + ' · 回收卖 ' + money(data.priceLadder.fieldSell)
  + ' · 背包直售 ' + money(data.priceLadder.bagSell) + ' · 局外超市 ' + money(data.priceLadder.superBuy));
console.log('\n--- 撤离费曲线 ---');
for (const c of data.extractFee.curve) {
  console.log('带入 ' + money(c.carryVal).padEnd(12) + ' 折扣 ' + c.mult.toFixed(3)
    + '  ' + c.fees.map(f => f.id + '=' + money(f.fee)).join('  '));
}
console.log('\n--- 稀有度预算（10 万次）---');
const rb = data.rarityBudget;
console.log('每 100 件：' + rb.per100.join(' / '));
console.log('精选+ ' + rb.rarePlusPct + '%（目标 ' + rb.target.rarePlus + '%）· 其中精选段本体 '
  + rb.rareBandPct + '%（目标 ' + rb.target.rareBand.toFixed(3) + '%）· 特种+ '
  + rb.legendPlusPct + '%（目标 ' + rb.target.legendPlus.toFixed(3) + '%）');
console.log('满运气上限：精选+ ' + rb.luckCap.rarePlusPct + '% · 特种+ ' + rb.luckCap.legendPlusPct + '%');
console.log('\n--- 黑市赌博机孤品 ---');
console.log('权重 ' + data.gamble.singularityWeight + ' / 总权重 ' + data.gamble.totalWeight.toFixed(4)
  + ' → 真实概率 ' + data.gamble.singularityPct + '% ≈ 1/' + data.gamble.oneIn);
console.log('\n--- 单趟套利（12 件，保守）---');
console.log('成本 ' + money(data.oneTrip.cost) + ' → 回收 ' + money(data.oneTrip.revenue)
  + ' · 净 ' + money(data.oneTrip.net) + '（' + pct(data.oneTrip.margin) + '）');
console.log('\n时间品质曲线：' + data.timeLuck.map(x => x.sec + 's=' + x.luck.toFixed(3)).join('  '));
if (outPath) console.log('\nJSON: ' + outPath);
console.log('');
