/* 逻辑回归（覆盖 v0.14.10 ~ v0.14.11）：按 index.html 顺序在 vm 中加载脚本，
 * 直接调用 Raid._damage / _tickElementStatus / _fire 等做真实结算，无需浏览器。
 * 文件名沿用首次创建时的版本号，实际断言已包含元素持续效果、护甲击穿回退与机制修复。 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = __dirname;
const SRC = path.join(ROOT, 'src');

// 最小 DOM / BOM stub：只加载定义期不碰 DOM 的模块，main.js 会 new Game() 故跳过
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

const files = ['config', 'util', 'weapons', 'items', 'skills', 'player', 'enemies', 'combat',
  'world', 'endless', 'dust2', 'shop', 'input', 'render', 'ui', 'raid', 'net', 'auction', 'br', 'save'];
let loaded = 0;
for (const f of files) {
  const p = path.join(SRC, f + '.js');
  try {
    vm.runInContext(fs.readFileSync(p, 'utf8'), sandbox, { filename: f + '.js' });
    loaded++;
  } catch (e) {
    console.log(`LOAD FAIL ${f}.js: ${e.message}`);
  }
}
console.log(`loaded ${loaded}/${files.length} modules (main.js intentionally skipped)`);

const G = (expr) => vm.runInContext(expr, sandbox);
const Raid = G('Raid');
const RNG = G('RNG');
const ELEMENTS = G('ELEMENTS');
const AFFIXES = G('AFFIXES');
const elemMult = G('elemMult');
const raidArmorType = G('raidArmorType');
const HELMET_BODY_SHARE = G('HELMET_BODY_SHARE');
RNG.chance = () => false;             // 固定不打爆头，结果可复现
Raid.online = false;
Raid.floats = []; Raid.particles = []; Raid.elapsed = 10;

let pass = 0, fail = 0;
function check(name, got, want, tol = 0.6) {
  const ok = Math.abs(got - want) <= tol;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(52)} got=${(+got).toFixed(2)} want=${(+want).toFixed(2)}`);
  ok ? pass++ : fail++;
}
function mkTarget(o = {}) {
  return Object.assign({
    alive: true, isPlayer: false, remote: false, ghost: false,
    hp: 1e6, maxHP: 1e6, armor: 1e6, maxArmor: 1e6, dr: 0,
    helmetArmor: 1e6, maxHelmetArmor: 1e6, helmetDr: 0,
    helmetTier: 0, armorTier: 0, shield: 0,
    id: 'bot', name: 'bot', x: 0, y: 0, angle: 0,
    lastSeen: null, investigate: null, bleed: 0, freezeT: 0, _elemTipT: -99,
  }, o);
}
function hit(target, dmg, gun) {
  Raid.floats = []; Raid.particles = [];
  Raid._damage(target, dmg, { isPlayer: true, x: 0, y: 0, name: 'Tester' }, gun);
  return 1e6 - target.hp;
}
const phys = { element: 'none', armorPen: 0 };
const gun = (element) => ({ element, armorPen: 0, name: 'test' });

console.log('\n=== 1. 元素克制矩阵（config.js / elemMult） ===');
for (const e of ['fire', 'shock', 'corrosive', 'cryo']) {
  const m = ELEMENTS[e].mult;
  console.log(`  ${ELEMENTS[e].name.padEnd(3)} 血肉 ${m.flesh.toFixed(2)}  护盾 ${m.shield.toFixed(2)}  装甲 ${m.armor.toFixed(2)}  克制=${ELEMENTS[e].strong}`);
}
check('火焰打血肉 = 1.70', elemMult('fire', 'flesh'), 1.70, 0.001);
check('火焰打装甲 = 0.70', elemMult('fire', 'armor'), 0.70, 0.001);
check('电击打护盾 = 2.00', elemMult('shock', 'shield'), 2.00, 0.001);
check('腐蚀打装甲 = 2.00', elemMult('corrosive', 'armor'), 2.00, 0.001);
check('腐蚀打血肉 = 0.70', elemMult('corrosive', 'flesh'), 0.70, 0.001);
check('物理不受克制 = 1', elemMult('none', 'armor'), 1, 0.001);
check('未知元素回退 = 1', elemMult('bogus', 'armor'), 1, 0.001);

console.log('\n=== 2. 目标类型判定（T4 起为装甲） ===');
check('T3 护甲 -> 血肉', raidArmorType({ armorTier: 3 }) === 'flesh' ? 1 : 0, 1, 0.001);
check('T4 护甲 -> 装甲', raidArmorType({ armorTier: 4 }) === 'armor' ? 1 : 0, 1, 0.001);
check('T9 护甲 -> 装甲', raidArmorType({ armorTier: 9 }) === 'armor' ? 1 : 0, 1, 0.001);
check('有护盾 -> 护盾', raidArmorType({ shield: 50, armorTier: 9 }) === 'shield' ? 1 : 0, 1, 0.001);

console.log('\n=== 3. 减伤乘法律 1-(1-p)(1-q)，非爆头 ===');
const p = 0.6, q = 0.5 * HELMET_BODY_SHARE;   // dr=0.6, helmetDr=0.5 -> 躯干 0.2
const mult = (1 - p) * (1 - q);
check('无甲无盔 -> 100', hit(mkTarget(), 100, phys), 100);
check('仅护甲 p=0.60 -> 40', hit(mkTarget({ dr: p }), 100, phys), 40);
check('仅头盔 q=0.20 -> 80（头盔确实减非暴击伤害）', hit(mkTarget({ helmetDr: 0.5 }), 100, phys), 80);
check('同时穿戴 -> 32（乘法律）', hit(mkTarget({ dr: p, helmetDr: 0.5 }), 100, phys), 100 * mult);
console.log(`      对照：旧式加法 1-p-q 会得到 ${(100 * (1 - p - q)).toFixed(1)}，本次实现应为 ${(100 * mult).toFixed(1)}`);
check('总减伤 = 1-(1-p)(1-q)', 1 - mult, 0.68, 0.001);

console.log('\n=== 4. 元素倍率在真实 _damage 中生效 ===');
const armored = () => mkTarget({ armorTier: 6 });       // 装甲型，无护甲耐久以隔离减伤
check('腐蚀打 T6 装甲 = 200', hit(armored(), 100, gun('corrosive')), 200);
check('火焰打 T6 装甲 = 70', hit(armored(), 100, gun('fire')), 70);
check('电击打 T6 装甲 = 70', hit(armored(), 100, gun('shock')), 70);
const fleshy = () => mkTarget({ armorTier: 1 });
check('火焰打血肉 = 170', hit(fleshy(), 100, gun('fire')), 170);
check('腐蚀打血肉 = 70', hit(fleshy(), 100, gun('corrosive')), 70);
check('物理打装甲 = 100', hit(armored(), 100, phys), 100);

console.log('\n=== 5. 冰冻命中：状态 + 粒子 + 减速 ===');
const fz = mkTarget({ armorTier: 1 });
hit(fz, 100, gun('cryo'));
check('冰冻叠加 freezeT', fz.freezeT, 1.4, 0.001);
check('冰晶 9 + 命中火花 6 = 15 粒子', Raid.particles.length, 15, 0.001);
const fz2 = mkTarget({ armorTier: 1, freezeT: 2.0 });
hit(fz2, 100, gun('cryo'));
check('重复命中叠加但封顶 2.8', fz2.freezeT, 2.8, 0.001);
check('减速系数 FREEZE_SLOW', G('FREEZE_SLOW'), 0.45, 0.001);
const fz3 = mkTarget({ armorTier: 1 });
hit(fz3, 100, gun('fire'));
check('非冰冻元素不产生冻结', fz3.freezeT, 0, 0.001);

// 真实 _moveOp：stub 掉地图依赖，只验证冰冻对位移的乘数
Raid._waterKind = () => 0;
Raid._resolve = (x, y) => ({ x, y });
const mover = (freezeT) => {
  const o = mkTarget({ x: 1000, y: 1000, freezeT });
  Raid._moveOp(o, 100, 0);
  return o.x - 1000;
};
check('无冰冻位移 = 100', mover(0), 100);
check('冰冻位移 = 45（减速生效）', mover(1.5), 45);

console.log('\n=== 5b. 爆头路径：头盔全额减伤 ===');
RNG.chance = () => true;   // 强制爆头：d×1.8，q 不打折
const head = hit(mkTarget({ dr: p, helmetDr: 0.5 }), 100, phys);
check('爆头 180 伤害、p=0.6 q=0.5 -> 36', head, 180 * (1 - p) * (1 - 0.5));
RNG.chance = () => false;

console.log('\n=== 6. 词缀池扩充与合法性 ===');
const pre = AFFIXES.prefix, suf = AFFIXES.suffix;
const names = [...pre, ...suf].map(a => a.nm);
const dup = names.filter((n, i) => names.indexOf(n) !== i);
const allowed = new Set([...G('AFFIX_PCT'), ...G('AFFIX_FLAT'), ...G('AFFIX_INT')]);
const badStat = [...pre, ...suf].flatMap(a => a.mods.map(m => m.stat)).filter(s => !allowed.has(s));
const label = G('AFFIX_LABEL');
const noLabel = [...new Set([...pre, ...suf].flatMap(a => a.mods.map(m => m.stat)))].filter(s => !label[s]);
const tradeoff = [...pre, ...suf].filter(a => a.mods.some(m => m.max < 0)).length;
const elemOnly = [...pre, ...suf].filter(a => a.elem || a.elemOnly).length;
const high = [...pre, ...suf].filter(a => a.lvl >= 24).length;
console.log(`  前缀 ${pre.length} 条 / 后缀 ${suf.length} 条 / 合计 ${names.length} 条`);
console.log(`  负面对冲 ${tradeoff} 条 · 元素联动 ${elemOnly} 条 · lvl>=24 后期词条 ${high} 条`);
check('词缀名无重复', dup.length, 0, 0.001);
check('所有 stat 在缩放白名单内', badStat.length, 0, 0.001);
check('所有 stat 有中文标签', noLabel.length, 0, 0.001);
check('扩充后前缀 >= 60', pre.length >= 60 ? 1 : 0, 1, 0.001);
check('扩充后后缀 >= 45', suf.length >= 45 ? 1 : 0, 1, 0.001);

console.log('\n=== 7. 版本号三处同步（防止漏改 ?v= 导致缓存不更新） ===');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const cfgVer = G('CFG.version');
const qs = [...new Set([...html.matchAll(/\?v=([\d.]+)/g)].map(m => m[1]))];
const qCount = (html.match(/\?v=/g) || []).length;
check('package.json == CFG.version', pkg.version === cfgVer ? 1 : 0, 1, 0.001);
check('index.html 缓存串版本唯一', qs.length, 1, 0.001);
check('index.html ?v= == CFG.version', qs[0] === cfgVer ? 1 : 0, 1, 0.001);
console.log(`  version=${cfgVer}, ?v= 共 ${qCount} 处`);

/* ---------------- v0.14.11：元素持续效果 + 护甲打穿回归血肉 ---------------- */
function dmgOn(target, dmg, g, opts) {
  const hp0 = target.hp;
  Raid._damage(target, dmg, { isPlayer: true, x: 0, y: 0, name: 'Tester' }, g, opts);
  return hp0 - target.hp;
}
Raid.tracers = []; Raid.killfeed = [];

console.log('\n=== 8. 改2：T4+ 护甲耐久耗尽后回归血肉型 ===');
check('T6 有耐久 -> 装甲型', raidArmorType({ armorTier: 6, armor: 50 }) === 'armor' ? 1 : 0, 1, 0.001);
check('T6 耐久归零 -> 血肉型', raidArmorType({ armorTier: 6, armor: 0 }) === 'flesh' ? 1 : 0, 1, 0.001);
check('T6 无耐久字段兼容旧档 -> 装甲型', raidArmorType({ armorTier: 6 }) === 'armor' ? 1 : 0, 1, 0.001);
check('护盾优先于装甲', raidArmorType({ armorTier: 9, armor: 100, shield: 1 }) === 'shield' ? 1 : 0, 1, 0.001);
const br = mkTarget({ armorTier: 6, armor: 30, dr: 0, helmetDr: 0 });
Raid.floats = [];
check('击穿前腐蚀 ×2.00', dmgOn(br, 100, gun('corrosive')), 200);
check('腐蚀啃掉护甲耐久至 0', br.armor, 0, 0.001);
check('出现「护甲击穿」提示', Raid.floats.some(f => (f.text || '').includes('护甲击穿')) ? 1 : 0, 1, 0.001);
check('击穿后腐蚀降为 ×0.70', dmgOn(br, 100, gun('corrosive')), 70);

console.log('\n=== 9. 改1a：火焰灼烧 DOT（ELEMENTS.fire.dot=6） ===');
const bu = mkTarget({ armorTier: 1, armor: 1e6, dr: 0 });
check('火焰直伤 170', dmgOn(bu, 100, gun('fire')), 170);
check('灼烧时长 2.0s', bu.burnT, 2.0, 0.001);
check('灼烧 DPS = 克制后伤害 ×6% = 170×0.06', bu.burnDps, 10.2, 0.001);
const bh0 = bu.hp; Raid._tickElementStatus(bu, 1.0);
check('灼烧 1 秒真实掉 10.2 HP', bh0 - bu.hp, 10.2, 0.001);
const ba = mkTarget({ armorTier: 6, armor: 1e6, dr: 0 });
dmgOn(ba, 100, gun('fire'));
check('火焰打装甲的 DOT 也吃 ×0.70 抗性', ba.burnDps, 4.2, 0.001);
check('灼烧剩余 1.0s', bu.burnT, 1.0, 0.001);
dmgOn(bu, 100, gun('fire'));
check('重复命中叠加灼烧', bu.burnT, 3.0, 0.001);
dmgOn(bu, 100, gun('fire')); dmgOn(bu, 100, gun('fire'));
check('灼烧封顶 4.5s', bu.burnT, 4.5, 0.001);
// 收尾那一帧只结算剩余时长，不超发 DOT
const tail = mkTarget({ armorTier: 1, armor: 1e6, burnT: 0.5, burnDps: 10 });
const th0 = tail.hp; Raid._tickElementStatus(tail, 1.0);
check('最后一帧只扣剩余 0.5s 的 5 HP', th0 - tail.hp, 5, 0.001);
// DOT 击杀归属点火者 / 玩家灼烧致死走 _fail
const origDeath = Raid._onBotDeath, origFail = Raid._fail;
let deathKiller = '', failReason = '';
Raid._onBotDeath = (v, k) => { deathKiller = k && k.name || ''; };
Raid._fail = (r) => { failReason = r; };
const bk = mkTarget({ armorTier: 1, armor: 1e6, hp: 180 });
dmgOn(bk, 100, gun('fire'));
Raid._tickElementStatus(bk, 2.0);
check('灼烧致死的击杀归属点火者', deathKiller === 'Tester' ? 1 : 0, 1, 0.001);
const pk = mkTarget({ armorTier: 1, armor: 1e6, hp: 180, isPlayer: true });
dmgOn(pk, 100, gun('fire'));
Raid._tickElementStatus(pk, 2.0);
check('玩家灼烧致死走 _fail', failReason === '灼烧致死' ? 1 : 0, 1, 0.001);
Raid._onBotDeath = origDeath; Raid._fail = origFail;

console.log('\n=== 10. 改1b/c/d：腐蚀破甲 · 电击干扰 · 辐射连锁 ===');
const cd = mkTarget({ armorTier: 6, armor: 1e6, dr: 0.6, helmetDr: 0 });
check('破甲前物理伤害 40', dmgOn(cd, 100, phys), 40);
check('腐蚀破甲期间减伤 ×0.75 → 110', dmgOn(cd, 100, gun('corrosive')), 110);
check('破甲期间物理伤害升到 55', dmgOn(cd, 100, phys), 55);
check('破甲 debuff 计时 3s', cd.corrodeT, 3.0, 0.001);
const sk = mkTarget({ armorTier: 1 });
dmgOn(sk, 100, gun('shock'));
check('电击附加电磁干扰 1.6s', sk.shockT, 1.6, 0.001);
// 真实 _fire：验证干扰把射速压到 SHOCK_FIRE_CD
Raid._rayWall = () => null; Raid._pointSeg = () => 1e9; Raid._noise = () => {};
const mkShooter = (shockT) => ({ isPlayer: false, remote: false, ghost: false,
  fireCd: 0, reloadT: 0, shockT, x: 0, y: 0, angle: 0, _mv: 0,
  gun: { ammoMag: 30, mag: 30, ammoRes: 60, reserve: 60, rpm: 600, dmg: 10,
    spread: 0, range: 100, cat: 'rifle', type: 'rifle', element: 'none' } });
const sh1 = mkShooter(0); Raid.ops = [sh1];
Raid._fire(sh1, 0, {});
check('无干扰 fireCd = 0.10s（600 RPM）', sh1.fireCd, 0.10, 0.001);
const sh2 = mkShooter(1.0); Raid.ops = [sh2];
Raid._fire(sh2, 0, {});
check('干扰期间 fireCd 被压到 0.25s', sh2.fireCd, G('SHOCK_FIRE_CD'), 0.001);
// 辐射连锁：150 半径内 1 个目标吃到 50 伤害，300 外的不吃，且不递归
const ra = mkTarget({ armorTier: 1, x: 0, y: 0, id: 'a' });
const rb = mkTarget({ armorTier: 1, x: 60, y: 0, id: 'b' });
const rc = mkTarget({ armorTier: 1, x: 300, y: 0, id: 'c' });
Raid.ops = [ra, rb, rc]; Raid.tracers = [];
check('辐射直伤不受克制 = 100', dmgOn(ra, 100, gun('radiation')), 100);
check('连锁目标吃到 50% 伤害', 1e6 - rb.hp, 50);
check('范围外目标不受连锁', 1e6 - rc.hp, 0);
check('连锁伤害不再二次触发', Raid.tracers.length, 1, 0.001);
check('辐射标记 radT 生效', ra.radT, 0.7, 0.001);

console.log('\n=== 11. 静态一致性：dot 被真正消费 + 联机字段白名单 ===');
check('至少 3 个元素配置了 dot', Object.values(ELEMENTS).filter(e => e.dot > 0).length >= 3 ? 1 : 0, 1, 0.001);
const raidSrc = fs.readFileSync(path.join(SRC, 'raid.js'), 'utf8');
const netSrc = fs.readFileSync(path.join(SRC, 'net.js'), 'utf8');
const srvSrc = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
check('raid.js 消费 E.dot（不再是死字段）', /E\.dot/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('HUD 显示护甲已击穿', /已击穿/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('net.js 同步 bu/co/zk/sd', ['bu:', 'co:', 'zk:', 'sd:'].every(k => netSrc.includes(k)) ? 1 : 0, 1, 0.001);
check('server.js 白名单含 bu/co/zk/sd', ['bu:num', 'co:num', 'zk:num', 'sd:num'].every(k => srvSrc.includes(k)) ? 1 : 0, 1, 0.001);

console.log('\n=== 12. 实机体检后修复的机制问题 ===');
// (a) 护盾型真实存在：护盾 → 装甲 → 血肉 三层递减
const st = mkTarget({ armorTier: 9, armor: 1e6, shield: 50, dr: 0, helmetDr: 0 });
check('护盾型被识别', raidArmorType(st) === 'shield' ? 1 : 0, 1, 0.001);
check('护盾优先吸收 50 点', dmgOn(st, 100, phys), 50);
check('护盾归零', st.shield, 0, 0.001);
check('破盾后转为装甲型', raidArmorType(st) === 'armor' ? 1 : 0, 1, 0.001);
const st2 = mkTarget({ armorTier: 9, armor: 1e6, shield: 1e6, dr: 0 });
check('电击对护盾 ×2.00 的伤害被护盾吃下', dmgOn(st2, 100, gun('shock')), 1, 0.001);
check('电击额外削盾 120 + 主吸收 200', 1e6 - st2.shield, 320, 0.001);
st.armor = 0;
check('再打穿护甲回到血肉型', raidArmorType(st) === 'flesh' ? 1 : 0, 1, 0.001);
// (b) 打穿即报废，自愈不复活
const ab = mkTarget({ armorTier: 8, armor: 20, maxArmor: 500, dr: 0, armorRegen: 3 });
dmgOn(ab, 100, gun('corrosive'));
check('击穿后标记 armorBroken', ab.armorBroken === true ? 1 : 0, 1, 0.001);
Raid._tickArmorRegen(ab, 2.0);
check('报废护甲不会被自愈复活', ab.armor, 0, 0.001);
const ok = mkTarget({ armorTier: 8, armor: 20, maxArmor: 500, armorRegen: 3 });
Raid._tickArmorRegen(ok, 2.0);
check('未报废护甲正常自愈 +6', ok.armor, 26, 0.001);
// (c) 爆炸 / splash 词缀的普通子弹有范围溅射
const e0 = mkTarget({ armorTier: 1, x: 0, y: 0, id: 'e0' });
const e1 = mkTarget({ armorTier: 1, x: 50, y: 0, id: 'e1' });
const e2 = mkTarget({ armorTier: 1, x: 400, y: 0, id: 'e2' });
Raid.ops = [e0, e1, e2]; Raid.blasts = []; Raid.particles = []; Raid.tracers = [];
Raid._bulletSplash(e0, 100, { isPlayer: true, x: 0, y: 0, name: 'T' },
  { element: 'explosive', armorPen: 0, splash: 120 });
check('爆炸溅伤邻近目标 ≈28', 1e6 - e1.hp, 28, 0.6);
check('范围外目标不吃溅射', 1e6 - e2.hp, 0, 0.001);
check('溅射不二次触发元素效果', Raid.blasts.length, 1, 0.001);
// (d) 医疗包净化元素状态（给玩家反制手段）
const SFX = G('SFX'); const origPickup = SFX.pickup; SFX.pickup = () => {};
Raid.floats = [];
const mp = mkTarget({ isPlayer: true, armorTier: 1, hp: 50, maxHP: 100,
  burnT: 2, burnDps: 5, freezeT: 1, shockT: 1, corrodeT: 2 });
Raid.player = mp; Raid.medUse = { heal: 40, bleed: false, boost: false };
Raid._finishMed();
check('医疗包清除灼烧', mp.burnT, 0, 0.001);
check('医疗包清除冰冻 / 干扰', (mp.freezeT || 0) + (mp.shockT || 0), 0, 0.001);
check('破甲属于装备 debuff，不被净化', mp.corrodeT, 2, 0.001);
check('医疗包照常回血', mp.hp, 90, 0.001);
SFX.pickup = origPickup;
// (e) 静态一致性
check('AI 生成点确实编成护盾兵', /let shieldVal=0/.test(raidSrc) && /RNG\.chance\(0\.22\)/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('T4+ 重甲不被护盾盖掉', /armorTier=Math\.min\(armorTier\|\|2, 3\)/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('raid 相机同步给 game.camera', /game\.camera\.x=this\.camera\.x/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('HUD 画出护盾条', /maxShield>0/.test(raidSrc) ? 1 : 0, 1, 0.001);

console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
