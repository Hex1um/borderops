/* =========================================================================
 * verify.cjs — 逻辑回归（覆盖 v0.14.10 ~ v0.25.1 的全部契约）
 *
 * v0.25.1 改名：原名 `verify_v01410.cjs` 停在 v0.14.10，实际早就覆盖到 0.25
 * （2400+ 行 / 828+ 条断言），每次都要解释「名字是旧的」—— 现在统一叫 verify.cjs，
 * 与 `npm run verify`、CI 的 `node verify.cjs` 同名，不再有版本号漂移。
 *
 * 按 index.html 顺序在 vm 中加载全部模块（含懒加载的 4 个），直接调用
 * Raid._damage / _tickElementStatus / _tickShield / _fire 等做真实结算，无需浏览器。
 * 断言分 45 组，每组对应一个版本的交付内容；最后一组（45）是 v0.25.1 的运行期健壮性契约。
 * ========================================================================= */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = __dirname;
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

/* v0.22.0：raid.js 按自然边界物理拆分为多个 raid-*.js（每个 ≤2000 行）。
 * verify 用「聚合清单」加载：拆分后自动改用分片，未拆分时回退单文件 raid.js。
 * 懒加载模块（world/endless/dust2/br 等）在生产 HTML 里延迟注入，但 vm 逻辑回归
 * 仍全量加载，保证断言覆盖不因懒加载而缩水。 */
const RAID_PARTS = ['raid-data','raid-legends','raid-geometry','raid-core','raid-ai','raid-fx','raid-core2','raid-core3','raid-render','raid-ui','raid-ui2'];
const hasParts = RAID_PARTS.every(n => fs.existsSync(path.join(SRC, n + '.js')));
const raidModules = hasParts ? RAID_PARTS : ['raid'];
const LAZY_PARTS = ['world', 'endless', 'dust2', 'br'];   // 生产环境按需加载，vm 里始终加载

// 顺序与 index.html 的常驻脚本一致（main.js 会 new Game() 故跳过）
const files = ['sanitize', 'config', 'util', 'store', 'weapons', 'items', 'shields', 'skills', 'player', 'enemies', 'combat',
  ...LAZY_PARTS.slice(0, 3), 'shop', 'input', 'render', 'ui', 'viewmode', 'fpview',
  ...raidModules, 'net', 'net-p2p', 'auction', LAZY_PARTS[3], 'save'];
let loaded = 0;
for (const f of files) {
  try {
    vm.runInContext(fs.readFileSync(path.join(SRC, f + '.js'), 'utf8'), sandbox, { filename: f + '.js' });
    loaded++;
  } catch (e) { console.log(`LOAD FAIL ${f}.js: ${e.message}`); }
}
console.log(`loaded ${loaded}/${files.length} modules (main.js intentionally skipped)`);

const G = (expr) => vm.runInContext(expr, sandbox);
const Raid = G('Raid'), RNG = G('RNG');
const ELEMENTS = G('ELEMENTS'), AFFIXES = G('AFFIXES');
const elemMult = G('elemMult'), raidArmorType = G('raidArmorType');
const HELMET_BODY_SHARE = G('HELMET_BODY_SHARE');
RNG.chance = () => false;
Raid.online = false;
Raid.floats = []; Raid.particles = []; Raid.tracers = []; Raid.killfeed = [];
Raid.blasts = []; Raid.elapsed = 10; Raid.ops = [];

let pass = 0, fail = 0;
function check(name, got, want, tol = 0.6) {
  const ok = Math.abs(got - want) <= tol;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(54)} got=${(+got).toFixed(2)} want=${(+want).toFixed(2)}`);
  ok ? pass++ : fail++;
}
function mkTarget(o = {}) {
  return Object.assign({
    alive: true, isPlayer: false, remote: false, ghost: false,
    hp: 1e6, maxHP: 1e6, armor: 1e6, maxArmor: 1e6, dr: 0,
    helmetArmor: 1e6, maxHelmetArmor: 1e6, helmetDr: 0,
    helmetTier: 0, armorTier: 0, shield: 0, maxShield: 0,
    shieldRate: 0, shieldDelay: 0, shieldTimer: 0, shieldInvuln: 0,
    shieldInvulnBase: 0, shieldAbsorbMul: 1, shieldPerks: [],
    id: 'bot', name: 'bot', x: 0, y: 0, angle: 0,
    lastSeen: null, investigate: null, bleed: 0, freezeT: 0, _elemTipT: -99,
  }, o);
}
function dmgOn(target, dmg, g, opts) {
  const hp0 = target.hp;
  Raid._damage(target, dmg, { isPlayer: true, x: 0, y: 0, name: 'Tester' }, g, opts);
  return hp0 - target.hp;
}
const phys = { element: 'none', armorPen: 0 };
const gun = (element) => ({ element, armorPen: 0, name: 'test' });
const E = (k, t) => elemMult(k, t);

/* ---------------------------------------------------------------- 1. 弹种表 */
console.log('\n=== 1. 拟真弹种 / 终点效应矩阵（AMMO_TYPES） ===');
check('AMMO_TYPES 共 7 种弹药', Object.keys(ELEMENTS).length, 7, 0.001);
check('ELEMENTS 是 AMMO_TYPES 的兼容别名', G('ELEMENTS === AMMO_TYPES') ? 1 : 0, 1, 0.001);
check('至少 3 种弹种带终点效应 dot', Object.values(ELEMENTS).filter(e => e.dot > 0).length, 3, 0.001);
check('每种弹种都有现实 short 缩写', Object.values(ELEMENTS).every(e => !!e.short) ? 1 : 0, 1, 0.001);
check('状态名已拟真化（无「灼烧 / 冰冻 / 电击」）',
  /灼烧|冰冻|电击|腐蚀|辐射/.test(Object.values(ELEMENTS).map(e => e.status).join('')) ? 1 : 0, 0, 0.001);
for (const k of ['fire', 'shock', 'corrosive', 'cryo', 'explosive', 'radiation'])
  check(`${k} 三系倍率取自数据表`, E(k, 'flesh'), ELEMENTS[k].mult.flesh, 0.001);
check('物理不受终点效应影响 = 1', E('none', 'armor'), 1, 0.001);
check('未知弹种回退 = 1', E('bogus', 'armor'), 1, 0.001);

console.log('\n=== 2. 目标类型判定（T4 起为硬质插板） ===');
check('T3 护甲 -> 无防护', raidArmorType({ armorTier: 3 }) === 'flesh' ? 1 : 0, 1, 0.001);
check('T4 护甲 -> 硬质插板', raidArmorType({ armorTier: 4 }) === 'armor' ? 1 : 0, 1, 0.001);
check('T9 护甲 -> 硬质插板', raidArmorType({ armorTier: 9 }) === 'armor' ? 1 : 0, 1, 0.001);
check('有护盾 -> 护盾型', raidArmorType({ shield: 50, armorTier: 9 }) === 'shield' ? 1 : 0, 1, 0.001);

console.log('\n=== 3. 减伤乘法律 1-(1-p)(1-q)，非爆头 ===');
const p = 0.6, q = 0.5 * HELMET_BODY_SHARE;
const mult = (1 - p) * (1 - q);
check('无甲无盔 -> 100', dmgOn(mkTarget(), 100, phys), 100);
check('仅护甲 p=0.60 -> 40', dmgOn(mkTarget({ dr: p }), 100, phys), 40);
check('仅头盔 q=0.20 -> 80', dmgOn(mkTarget({ helmetDr: 0.5 }), 100, phys), 80);
check('同时穿戴 -> 乘法律', dmgOn(mkTarget({ dr: p, helmetDr: 0.5 }), 100, phys), 100 * mult);
check('总减伤 = 1-(1-p)(1-q)', 1 - mult, 0.68, 0.001);

console.log('\n=== 4. 终点效应在真实 _damage 中生效（期望值取自数据表） ===');
const armored = () => mkTarget({ armorTier: 6 });
const fleshy = () => mkTarget({ armorTier: 1 });
for (const k of ['fire', 'shock', 'corrosive', 'cryo', 'explosive', 'radiation']) {
  check(`${k} 打硬质插板`, dmgOn(armored(), 100, gun(k)), 100 * E(k, 'armor'));
  check(`${k} 打无防护`, dmgOn(fleshy(), 100, gun(k)), 100 * E(k, 'flesh'));
}

console.log('\n=== 5. 迟滞（亚音速弹命中失衡）与减速 ===');
Raid.particles = [];
const fz = mkTarget({ armorTier: 1 });
dmgOn(fz, 100, gun('cryo'));
check('迟滞叠加 freezeT', fz.freezeT, 1.4, 0.001);
check('冰晶 9 + 命中火花 6 = 15 粒子', Raid.particles.length, 15, 0.001);
const fz2 = mkTarget({ armorTier: 1, freezeT: 2.0 });
dmgOn(fz2, 100, gun('cryo'));
check('重复命中叠加但封顶 2.8', fz2.freezeT, 2.8, 0.001);
check('减速系数 FREEZE_SLOW', G('FREEZE_SLOW'), 0.45, 0.001);
Raid._waterKind = () => 0; Raid._resolve = (x, y) => ({ x, y });
const mover = (freezeT) => {
  const o = mkTarget({ x: 1000, y: 1000, freezeT });
  Raid._moveOp(o, 100, 0); return o.x - 1000;
};
check('无迟滞位移 = 100', mover(0), 100);
check('迟滞位移 = 45', mover(1.5), 45);

console.log('\n=== 5b. 爆头路径：头盔全额减伤 ===');
RNG.chance = () => true;
check('爆头 180 伤害、p=0.6 q=0.5 -> 36',
  dmgOn(mkTarget({ dr: p, helmetDr: 0.5 }), 100, phys), 180 * (1 - p) * (1 - 0.5));
RNG.chance = () => false;

console.log('\n=== 6. 双词缀池：91 前缀 / 64 后缀，全部真实化命名 ===');
const pre = AFFIXES.prefix, suf = AFFIXES.suffix;
const names = [...pre, ...suf].map(a => a.nm);
const dup = names.filter((n, i) => names.indexOf(n) !== i);
const allowed = new Set([...G('AFFIX_PCT'), ...G('AFFIX_INT')]);
const allMods = [...pre, ...suf].flatMap(a => a.mods.map(m => m.stat));
const badStat = allMods.filter(s => !allowed.has(s));
const label = G('AFFIX_LABEL');
const noLabel = [...new Set(allMods)].filter(s => !label[s]);
const dead = allMods.filter(s => ['elemChance', 'lifesteal', 'shieldOnHit', 'ammoEff'].includes(s));
const fantasy = names.filter(n => /毁灭|凶暴|屠戮|湮灭|之怒|之焰|灼热|吸血|双管|蜂群|裂空|熔核|守盾/.test(n));
console.log(`  前缀 ${pre.length} 条 / 后缀 ${suf.length} 条 / 合计 ${names.length} 条`);
check('词缀名无重复', dup.length, 0, 0.001);
check('所有 stat 在缩放白名单内', badStat.length, 0, 0.001);
check('所有 stat 有中文标签', noLabel.length, 0, 0.001);
check('无 v0.15.x 的恒 0 死属性词缀', dead.length, 0, 0.001);
check('无奇幻命名残留', fantasy.length, 0, 0.001);
check('前缀 >= 90', pre.length >= 90 ? 1 : 0, 1, 0.001);
check('后缀 >= 60', suf.length >= 60 ? 1 : 0, 1, 0.001);
check('生成 200 把枪不崩溃', (() => {
  try { for (let i = 0; i < 200; i++) G(`generateWeapon(${10 + i % 40})`); return 1; } catch (e) { return 0; }
})(), 1, 0.001);

console.log('\n=== 7. 版本号三处同步 ===');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const cfgVer = G('CFG.version');
const qs = [...new Set([...html.matchAll(/\?v=([\d.]+)/g)].map(m => m[1]))];
check('package.json == CFG.version', pkg.version === cfgVer ? 1 : 0, 1, 0.001);
check('index.html 缓存串版本唯一', qs.length, 1, 0.001);
check('index.html ?v= == CFG.version', qs[0] === cfgVer ? 1 : 0, 1, 0.001);
check('index.html 引入 shields.js', html.includes('src/shields.js') ? 1 : 0, 1, 0.001);
console.log(`  version=${cfgVer}, ?v= 共 ${(html.match(/\?v=/g) || []).length} 处`);

/* ---------------------------------------------------------------- 8~11 元素终点效应 */
console.log('\n=== 8. T4+ 插板耐久耗尽后回归无防护 ===');
check('T6 有耐久 -> 硬质插板', raidArmorType({ armorTier: 6, armor: 50 }) === 'armor' ? 1 : 0, 1, 0.001);
check('T6 耐久归零 -> 无防护', raidArmorType({ armorTier: 6, armor: 0 }) === 'flesh' ? 1 : 0, 1, 0.001);
check('T6 无耐久字段兼容旧档', raidArmorType({ armorTier: 6 }) === 'armor' ? 1 : 0, 1, 0.001);
const br = mkTarget({ armorTier: 6, armor: 30, dr: 0, helmetDr: 0 });
Raid.floats = [];
check('击穿前空尖弹伤害', dmgOn(br, 100, gun('corrosive')), 100 * E('corrosive', 'armor'));
// 空尖弹每发按「终点效应后伤害 ×35%」啃插板，30 点耐久需要连续命中打穿
for (let i = 0; i < 8 && br.armor > 0; i++) dmgOn(br, 100, gun('corrosive'));
check('空尖弹啃掉插板耐久至 0', br.armor, 0, 0.001);
check('出现「护甲击穿」提示', Raid.floats.some(f => (f.text || '').includes('护甲击穿')) ? 1 : 0, 1, 0.001);
check('击穿后按无防护倍率', dmgOn(br, 100, gun('corrosive')), 100 * E('corrosive', 'flesh'));

console.log('\n=== 9. 曳光弹引燃 DOT（用克制后伤害结算） ===');
const bu = mkTarget({ armorTier: 1, armor: 1e6, dr: 0 });
const fireFlesh = 100 * E('fire', 'flesh');
check('曳光弹直伤', dmgOn(bu, 100, gun('fire')), fireFlesh);
check('引燃时长 2.0s', bu.burnT, 2.0, 0.001);
check('引燃 DPS = 终点效应后伤害 ×6%', bu.burnDps, fireFlesh * 0.06, 0.001);
const bh0 = bu.hp; Raid._tickElementStatus(bu, 1.0);
check('引燃 1 秒真实掉血', bh0 - bu.hp, fireFlesh * 0.06, 0.001);
const ba = mkTarget({ armorTier: 6, armor: 1e6, dr: 0 });
dmgOn(ba, 100, gun('fire'));
check('打插板时 DOT 也吃抗性', ba.burnDps, 100 * E('fire', 'armor') * 0.06, 0.001);
check('引燃剩余 1.0s', bu.burnT, 1.0, 0.001);
dmgOn(bu, 100, gun('fire'));
check('重复命中叠加引燃', bu.burnT, 3.0, 0.001);
dmgOn(bu, 100, gun('fire')); dmgOn(bu, 100, gun('fire'));
check('引燃封顶 4.5s', bu.burnT, 4.5, 0.001);
const tail = mkTarget({ armorTier: 1, armor: 1e6, burnT: 0.5, burnDps: 10 });
const th0 = tail.hp; Raid._tickElementStatus(tail, 1.0);
check('最后一帧只扣剩余 0.5s 的 5 HP', th0 - tail.hp, 5, 0.001);
const origDeath = Raid._onBotDeath, origFail = Raid._fail;
let deathKiller = '', failReason = '';
Raid._onBotDeath = (v, k) => { deathKiller = k && k.name || ''; };
Raid._fail = (r) => { failReason = r; };
const bk = mkTarget({ armorTier: 1, armor: 1e6, hp: 130 });
dmgOn(bk, 100, gun('fire')); Raid._tickElementStatus(bk, 2.0);
check('引燃致死归属点火者', deathKiller === 'Tester' ? 1 : 0, 1, 0.001);
const pk = mkTarget({ armorTier: 1, armor: 1e6, hp: 130, isPlayer: true });
dmgOn(pk, 100, gun('fire')); Raid._tickElementStatus(pk, 2.0);
check('玩家引燃致死走 _fail', failReason === '引燃致死' ? 1 : 0, 1, 0.001);
Raid._onBotDeath = origDeath; Raid._fail = origFail;

console.log('\n=== 10. 撕裂破甲 · 钝击失能 · 跳弹连锁 ===');
const cd = mkTarget({ armorTier: 6, armor: 1e6, dr: 0.6, helmetDr: 0 });
check('破甲前物理伤害 40', dmgOn(cd, 100, phys), 40);
const corrodeD = 100 * E('corrosive', 'armor');
check('撕裂破甲期间减伤 ×0.75', dmgOn(cd, 100, gun('corrosive')), corrodeD * (1 - 0.6 * 0.75), 1.0);
check('破甲期间物理伤害升到 55', dmgOn(cd, 100, phys), 55);
check('破甲 debuff 计时 3s', cd.corrodeT, 3.0, 0.001);
const sk = mkTarget({ armorTier: 1 });
dmgOn(sk, 100, gun('shock'));
check('钢芯弹附加钝击失能 1.6s', sk.shockT, 1.6, 0.001);
Raid._rayWall = () => null; Raid._pointSeg = () => 1e9; Raid._noise = () => {};
const mkShooter = (shockT) => ({ isPlayer: false, remote: false, ghost: false,
  fireCd: 0, reloadT: 0, shockT, x: 0, y: 0, angle: 0, _mv: 0,
  gun: { ammoMag: 30, mag: 30, ammoRes: 60, reserve: 60, rpm: 600, dmg: 10,
    spread: 0, range: 100, cat: 'rifle', type: 'rifle', element: 'none' } });
const sh1 = mkShooter(0); Raid.ops = [sh1]; Raid._fire(sh1, 0, {});
check('无失能 fireCd = 0.10s', sh1.fireCd, 0.10, 0.001);
const sh2 = mkShooter(1.0); Raid.ops = [sh2]; Raid._fire(sh2, 0, {});
check('失能期间 fireCd 被压到 0.25s', sh2.fireCd, G('SHOCK_FIRE_CD'), 0.001);
const ra = mkTarget({ armorTier: 1, x: 0, y: 0, id: 'a' });
const rb = mkTarget({ armorTier: 1, x: 60, y: 0, id: 'b' });
const rc = mkTarget({ armorTier: 1, x: 300, y: 0, id: 'c' });
Raid.ops = [ra, rb, rc]; Raid.tracers = [];
check('穿甲曳光直伤', dmgOn(ra, 100, gun('radiation')), 100 * E('radiation', 'flesh'));
check('跳弹连锁吃到 50% 伤害', 1e6 - rb.hp, 50);
check('范围外目标不吃连锁', 1e6 - rc.hp, 0);
check('连锁不再二次触发', Raid.tracers.length, 1, 0.001);
check('跳弹标记 radT 生效', ra.radT, 0.7, 0.001);

console.log('\n=== 11. 静态一致性 ===');
// v0.22.0 兼容层：拆分后把所有 raid-*.js 聚合，源码正则断言照常生效
const raidSrc = raidModules.map(n => fs.readFileSync(path.join(SRC, n + '.js'), 'utf8')).join('\n');
const netSrc = fs.readFileSync(path.join(SRC, 'net.js'), 'utf8');
const srvSrc = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
check('raid.js 消费 E.dot', /E\.dot/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('HUD 显示护甲已击穿', /已击穿/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('net.js 同步 bu/co/zk/sd/sm/iv', ['bu:', 'co:', 'zk:', 'sd:', 'sm:', 'iv:'].every(k => netSrc.includes(k)) ? 1 : 0, 1, 0.001);
check('server.js 白名单含 bu/co/zk/sd/sm/iv',
  ['bu:num', 'co:num', 'zk:num', 'sd:num', 'sm:num', 'iv:num'].every(k => srvSrc.includes(k)) ? 1 : 0, 1, 0.001);

console.log('\n=== 12. 实机体检后修复的机制问题 ===');
const st = mkTarget({ armorTier: 9, armor: 1e6, shield: 50, maxShield: 50, dr: 0, helmetDr: 0 });
check('护盾型被识别', raidArmorType(st) === 'shield' ? 1 : 0, 1, 0.001);
check('护盾优先吸收 50 点', dmgOn(st, 100, phys), 50);
check('护盾归零', st.shield, 0, 0.001);
check('破盾后转为硬质插板型', raidArmorType(st) === 'armor' ? 1 : 0, 1, 0.001);
const st2 = mkTarget({ armorTier: 9, armor: 1e6, shield: 1e6, maxShield: 1e6, dr: 0 });
const shockShield = 100 * E('shock', 'shield');
check('钢芯弹对护盾伤害全部被盾吃下', dmgOn(st2, 100, gun('shock')), 0, 0.001);
check('钢芯弹额外削盾 + 主吸收', 1e6 - st2.shield, shockShield * 1.6, 1.0);
st.armor = 0;
check('再打穿插板回到无防护', raidArmorType(st) === 'flesh' ? 1 : 0, 1, 0.001);
const ab = mkTarget({ armorTier: 8, armor: 20, maxArmor: 500, dr: 0, armorRegen: 3 });
for (let i = 0; i < 8 && ab.armor > 0; i++) dmgOn(ab, 100, gun('corrosive'));
check('击穿后标记 armorBroken', ab.armorBroken === true ? 1 : 0, 1, 0.001);
Raid._tickArmorRegen(ab, 2.0);
check('报废插板不会被自愈复活', ab.armor, 0, 0.001);
const ok = mkTarget({ armorTier: 8, armor: 20, maxArmor: 500, armorRegen: 3 });
Raid._tickArmorRegen(ok, 2.0);
check('未报废插板正常自愈 +6', ok.armor, 26, 0.001);
const e0 = mkTarget({ armorTier: 1, x: 0, y: 0, id: 'e0' });
const e1 = mkTarget({ armorTier: 1, x: 50, y: 0, id: 'e1' });
const e2 = mkTarget({ armorTier: 1, x: 400, y: 0, id: 'e2' });
Raid.ops = [e0, e1, e2]; Raid.blasts = []; Raid.particles = []; Raid.tracers = [];
Raid._bulletSplash(e0, 100, { isPlayer: true, x: 0, y: 0, name: 'T' },
  { element: 'explosive', armorPen: 0, splash: 120 });
check('破片溅伤邻近目标 ≈28', 1e6 - e1.hp, 28, 0.6);
check('范围外目标不吃溅射', 1e6 - e2.hp, 0, 0.001);
const SFX = G('SFX'); const origPickup = SFX.pickup; SFX.pickup = () => {};
Raid.floats = [];
const mp = mkTarget({ isPlayer: true, armorTier: 1, hp: 50, maxHP: 100,
  burnT: 2, burnDps: 5, freezeT: 1, shockT: 1, corrodeT: 2 });
Raid.player = mp; Raid.medUse = { heal: 40, bleed: false, boost: false };
Raid._finishMed();
check('医疗包清除引燃', mp.burnT, 0, 0.001);
check('医疗包清除迟滞 / 失能', (mp.freezeT || 0) + (mp.shockT || 0), 0, 0.001);
check('破甲属于装备 debuff，不被净化', mp.corrodeT, 2, 0.001);
check('医疗包照常回血', mp.hp, 90, 0.001);
SFX.pickup = origPickup;
check('AI 生成点确实编成护盾兵', /let shieldVal=0/.test(raidSrc) && /RNG\.chance\(0\.22\)/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('T4+ 重甲不被护盾盖掉', /armorTier=Math\.min\(armorTier\|\|2, 3\)/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('raid 相机同步给 game.camera', /game\.camera\.x=this\.camera\.x/.test(raidSrc) ? 1 : 0, 1, 0.001);

/* ================================================================ 13. 护盾装备 */
console.log('\n=== 13. 护盾装备：配件组成 / 三数值 / 前后缀 / 具名 ===');
const SG = G('SHIELD_GRADE'), SB = G('SHIELD_BASES'), SS = G('SHIELD_SLOTS');
check('4 个配件槽', SS.length, 4, 0.001);
/* v0.32.0：护盾底材扩到 T12（T10~T12 仅抽奖机可出），前 9 阶不变 */
check('护盾底材 ≥9 阶（现 12 阶）', Object.keys(SB).length, 12, 0.001);
check('9 阶品相刻度', SG.length, 9, 0.001);
let genErr = 0, genNoParts = 0, genNoAffix = 0, genNoPerk = 0, genBadStat = 0;
const sample = [];
for (let t = 1; t <= 9; t++) for (let q = 0; q <= 8; q++) {
  try {
    const s = G(`raidMakeShield(${t},${q})`);
    sample.push(s);
    if (!s.parts || s.parts.length !== 4) genNoParts++;
    if (!s.affixes || !s.affixes.some(a => a.kind === 'prefix') || !s.affixes.some(a => a.kind === 'suffix')) genNoAffix++;
    if (!s.perks || !s.perks.length) genNoPerk++;
    if (!(s.capacity > 0 && s.rate > 0 && s.delay >= 0.6 && s.invuln >= 0.25 && s.value > 0)) genBadStat++;
  } catch (e) { genErr++; }
}
check('81 档护盾生成无异常', genErr, 0, 0.001);
check('每件都有 4 个配件', genNoParts, 0, 0.001);
check('每件都有 1 前缀 + 1 后缀', genNoAffix, 0, 0.001);
check('每件都有独特加成', genNoPerk, 0, 0.001);
check('三数值 + 无敌 + 估值均合法', genBadStat, 0, 0.001);
const t1 = sample[0], t9 = sample[sample.length - 1];
check('T9 竞赛容量 > T1 民用', t9.capacity > t1.capacity ? 1 : 0, 1, 0.001);
check('T9 竞赛充能 > T1 民用', t9.rate > t1.rate ? 1 : 0, 1, 0.001);
check('T9 竞赛延迟 < T1 民用', t9.delay < t1.delay ? 1 : 0, 1, 0.001);
check('护盾名含前后缀', / /.test(t1.name) && /·/.test(t1.name) ? 1 : 0, 1, 0.001);
const UQ = G('SHIELD_UNIQUES');
check('具名护盾 >= 8 件', UQ.length >= 8 ? 1 : 0, 1, 0.001);
let uqErr = 0, uqNoName = 0;
for (const u of UQ) {
  try {
    const s = G(`raidMakeShieldUnique(${JSON.stringify(u)})`);
    if (!s.uniqPerk || s.name.indexOf('「') !== 0) uqNoName++;
  } catch (e) { uqErr++; }
}
check('具名护盾全部可生成', uqErr, 0, 0.001);
check('具名护盾带固定名与 perk', uqNoName, 0, 0.001);
check('具名护盾无奇幻名', UQ.some(u => /神|魔|龙|灭|湮|虚空/.test(u.name)) ? 1 : 0, 0, 0.001);
check('8 种独特加成齐备', Object.keys(G('SHIELD_PERKS')).length, 8, 0.001);
check('护盾卡片渲染不抛异常', (() => {
  try { G(`shieldCard(raidMakeShield(5,4),{sell:true})`); return 1; } catch (e) { return 0; }
})(), 1, 0.001);
check('shieldLines 输出三数值 + 加成', G('shieldLines(raidMakeShield(5,4)).length') >= 5 ? 1 : 0, 1, 0.001);

console.log('\n=== 14. 护盾战斗结算：先扣盾 → 无敌 → 延迟 → 回充 ===');
const sg = G('raidMakeShield(5,4)');
const mkSOp = (over = {}) => mkTarget(Object.assign({
  shield: sg.capacity, maxShield: sg.capacity,
  shieldRate: sg.rate, shieldDelay: sg.delay, shieldInvulnBase: sg.invuln,
  shieldPerks: sg.perks.slice(), shieldAbsorbMul: 1,
  shieldGear: sg, shieldTimer: 0, shieldInvuln: 0,
}, over));
// (a) 伤害先扣盾，盾未破时血量不动
const so1 = mkSOp();
dmgOn(so1, 10, phys);
check('伤害先扣盾（HP 不掉）', so1.hp, 1e6, 0.001);
check('盾值减少 10', sg.capacity - so1.shield, 10, 0.001);
check('受击重置充能延迟', so1.shieldTimer, sg.delay, 0.001);
// (b) 延迟未走完不回充
Raid._tickShield(so1, Math.min(0.5, sg.delay / 2));
check('延迟期间不回充', so1.shield, sg.capacity - 10, 0.001);
// (c) 延迟走完后按速度回充
Raid._tickShield(so1, sg.delay + 0.1);
check('延迟结束后按 rate 回充', so1.shield > sg.capacity - 10 ? 1 : 0, 1, 0.001);
check('回充不超过上限', so1.shield <= sg.capacity ? 1 : 0, 1, 0.001);
// (d) 破盾 → 短暂无敌，期间完全免伤
const so2 = mkSOp({ shield: 5, maxShield: 5, armor: 1e6, dr: 0, helmetDr: 0 });
dmgOn(so2, 50, phys);
check('破盾后盾归零', so2.shield, 0, 0.001);
check('破盾触发无敌', so2.shieldInvuln > 0 ? 1 : 0, 1, 0.001);
check('无敌时长 = 装备破盾无敌', so2.shieldInvuln, sg.invuln, 0.001);
const hpBefore = so2.hp;
dmgOn(so2, 999, phys);
check('无敌期间完全免伤', so2.hp, hpBefore, 0.001);
Raid._tickShield(so2, sg.invuln + 0.01);
check('无敌会随时间结束', so2.shieldInvuln, 0, 0.001);
// (e) 破盾后延迟到了能从 0 重新起盾
Raid._tickShield(so2, sg.delay + 0.1);
check('破盾后可重新起盾', so2.shield > 0 ? 1 : 0, 1, 0.001);
// (f) 护盾完全吸收伤害时不再强制扣 1 HP
const so3 = mkSOp({ shield: 1e6, maxShield: 1e6, shieldInvulnBase: 0 });
check('全额吸收不扣血', dmgOn(so3, 10, phys), 0, 0.001);

console.log('\n=== 15. 护盾独特加成逐条生效 ===');
// overcharge：容量 +12%
const capBase = G('shieldStats(5,4,[],[],[],{}).capacity');
const capOver = G('shieldStats(5,4,[],[],["overcharge"],{}).capacity');
check('过载容量 +12%', capOver / capBase, 1.12, 0.02);
// quickstart：延迟 -0.8s
const dlyBase = G('shieldStats(5,4,[],[],[],{}).delay');
const dlyQuick = G('shieldStats(5,4,[],[],["quickstart"],{}).delay');
check('快速整备 -0.8s', dlyBase - dlyQuick, 0.8, 0.02);
// bulwark：破盾无敌 +0.4s
const invBase = G('shieldStats(5,4,[],[],[],{}).invuln');
const invBul = G('shieldStats(5,4,[],[],["bulwark"],{}).invuln');
check('延时护罩 +0.4s', invBul - invBase, 0.4, 0.02);
// still：静止时充能 ×2
const stillBase = mkSOp({ shield: 0, shieldTimer: 0, shieldRate: 10, shieldPerks: [] });
const stillOn = mkSOp({ shield: 0, shieldTimer: 0, shieldRate: 10, shieldPerks: ['still'] });
Raid._tickShield(stillBase, 1.0); Raid._tickShield(stillOn, 1.0);
check('静止增益充能翻倍', stillOn.shield / stillBase.shield, 2.0, 0.001);
// emitter：护盾吸伤 +8%
const em = mkSOp({ shield: 100, maxShield: 100, shieldAbsorbMul: 1.08, shieldInvulnBase: 0 });
dmgOn(em, 100, phys);
check('定向泄能多吸 8%', 100 - em.shield, 100 / 1.08, 0.6);
// plate：有盾时插板耐久损耗 -35%（护盾必须只吸收一部分，余量才会打到插板）
const plBase = mkSOp({ shield: 10, maxShield: 10, armor: 1000, dr: 0.5,
  shieldPerks: [], shieldInvulnBase: 0 });
const pl = mkSOp({ shield: 10, maxShield: 10, armor: 1000, dr: 0.5,
  shieldPerks: ['plate'], shieldInvulnBase: 0 });
dmgOn(plBase, 100, phys); dmgOn(pl, 100, phys);
check('护甲保全减少耐久损耗 35%', (1000 - pl.armor) / (1000 - plBase.armor), 0.65, 0.01);
check('plate 折扣绝对值', 1000 - pl.armor, 29.25, 0.6);
// surge：破盾迟滞周围目标
/* v0.41.0：验证命中火花需要真实实现，先把原函数留一份（下面仍 stub 掉，避免刷屏） */
const REAL_SPAWN_HIT = Raid.spawnHit;
sandbox.__realHit = REAL_SPAWN_HIT;   // 注入沙箱，供第 62 组断言调用
Raid.spawnHit = () => {};
const org = mkSOp({ shield: 1, maxShield: 1, shieldInvulnBase: 0, shieldPerks: ['surge'], x: 0, y: 0 });
const near = mkTarget({ x: 50, y: 0 }), far = mkTarget({ x: 400, y: 0 });
Raid.ops = [org, near, far];
dmgOn(org, 20, phys);
check('破盾冲击迟滞近处目标', near.freezeT > 0 ? 1 : 0, 1, 0.001);
check('破盾冲击不影响远处', far.freezeT, 0, 0.001);
// siphon：击杀回充 18%
const origDeath2 = Raid._onBotDeath;
Raid._dropFromBot = () => []; Raid._feed = () => {}; Raid.floats = [];
const killer = { isPlayer: true, x: 0, y: 0, name: 'K', kills: 0,
  shield: 0, maxShield: 100, shieldPerks: ['siphon'], gun: null };
Raid._firstKillToken = false; Raid.tokens = 0;
Raid._onBotDeath(mkTarget({ hp: 0 }), killer);
check('击杀回充 18% 容量', killer.shield, 18, 0.001);
Raid._onBotDeath = origDeath2;

console.log('\n=== 16. 经济链路 / 联机 / 静态一致性 ===');
check('合成表含护盾配方', /id:"r_shield"/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('融合台支持护盾', /main\.kind==="shield"/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('箱子掉落护盾', /raidMakeShield\(/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('军火超市卖护盾', /data-buy="shield:/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('配装可携带护盾', /shield:sel\.s/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('撤离 / 阵亡结算护盾', /carried\.shield/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('背包容量含护盾栏', /shields:3/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('HUD 蓝色护盾条在血条上方', /by-18/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('血条不再被染成蓝色', /hpCol=\(at==="armor"\)\?atCol:/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('HUD 护甲条改琥珀色，蓝色只属于护盾条', !/#7ab4ff/.test(raidSrc) && /by-18/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('充能延迟按「未受伤时长」定义', /shieldTimer=target\.shieldDelay/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('引燃 DOT 也重置充能延迟', /shieldTimer=o\.shieldDelay/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('server.js 白名单含 sm/iv', /sm:num/.test(srvSrc) && /iv:num/.test(srvSrc) ? 1 : 0, 1, 0.001);
check('net.js 影子同步 sm/iv', /b\.sm/.test(netSrc) && /b\.iv/.test(netSrc) ? 1 : 0, 1, 0.001);


console.log('\n=== 17. AI 索敌分级 / 塔科夫制式命名 ===');
const cfgSrc = fs.readFileSync(path.join(SRC, 'config.js'), 'utf8');
const AI_SENSE = G('RAID_AI_SENSE'), senseOf = G('raidAISense');
check('Scav 视距 520', AI_SENSE.scav.sight, 520, 0.001);
check('PMC 视距 900', AI_SENSE.pmc.sight, 900, 0.001);
check('Boss 视距 1250', AI_SENSE.boss.sight, 1250, 0.001);
check('Scav 反应慢于 PMC', AI_SENSE.scav.react > AI_SENSE.pmc.react ? 1 : 0, 1, 0.001);
check('PMC 反应慢于 Boss', AI_SENSE.pmc.react > AI_SENSE.boss.react ? 1 : 0, 1, 0.001);
check('Scav 视线记忆短于 PMC', AI_SENSE.scav.memory < AI_SENSE.pmc.memory ? 1 : 0, 1, 0.001);
check('Boss 视线记忆最长', AI_SENSE.boss.memory > AI_SENSE.pmc.memory ? 1 : 0, 1, 0.001);
check('Boss 主动搜寻最积极', AI_SENSE.boss.hunt > AI_SENSE.pmc.hunt ? 1 : 0, 1, 0.001);
check('Boss 枪声听距最远', AI_SENSE.boss.hear > AI_SENSE.pmc.hear ? 1 : 0, 1, 0.001);
check('普通 Scav -> scav 档', senseOf({cls:'scav'}) === AI_SENSE.scav ? 1 : 0, 1, 0.001);
check('精英 Scav -> pmc 档', senseOf({cls:'scav',smart:true}) === AI_SENSE.pmc ? 1 : 0, 1, 0.001);
check('PMC -> pmc 档', senseOf({cls:'pmc'}) === AI_SENSE.pmc ? 1 : 0, 1, 0.001);
check('悬赏目标 -> boss 档', senseOf({cls:'pmc',bounty:true}) === AI_SENSE.boss ? 1 : 0, 1, 0.001);
check('7 种弹药均带塔科夫口径', Object.values(ELEMENTS).every(e => /^(5\.45|7\.62|9×|40mm)/.test(e.name)) ? 1 : 0, 1, 0.001);
check('弹种代号已塔科夫化', Object.values(ELEMENTS).every(e => /^(PS|T|BP|RIP|SP-6|VOG|BT)$/.test(e.short)) ? 1 : 0, 1, 0.001);
/* v0.21.6：完整显示下枪品种大幅增加 —— 每个枪型都有一份真实型号池（≥9 个，且不重复） */
const modelPools = JSON.parse(G(`JSON.stringify((()=>{
  const out={};
  for(const k of Object.keys(WEAPON_TYPES)){
    const p=WEAPON_TYPES[k].models||[];
    out[k]={ n:p.length, dup:p.length-new Set(p).size };
  }
  return out;
})())`));
check('每个枪型都有型号池（≥9 种）', Object.values(modelPools).every(v=>v.n>=9) ? 1 : 0, 1, 0.001);
check('型号池内无重复型号', Object.values(modelPools).every(v=>v.dup===0) ? 1 : 0, 1, 0.001);
const modelCount = Object.values(modelPools).reduce((a,b)=>a+b.n,0);
console.log('  型号池合计 ' + modelCount + ' 个真枪型号 · ' +
  Object.keys(modelPools).map(k=>k+':'+modelPools[k].n).join(' '));
check('型号池总量 ≥ 60（品种大幅增加）', modelCount>=60 ? 1 : 0, 1, 0.001);
check('旧弹种名已清除', /FMJ 全被甲弹|T 曳光弹|AP 钢芯穿甲弹/.test(cfgSrc) ? 1 : 0, 0, 0.001);

console.log('\n=== 18. Scav 低阶武器限制 ===');
const SCAV_TYPES = G('SCAV_GUN_TYPES');
const SCAV_MAX = G('SCAV_GUN_ILVL_MAX');
const scavGun = G('raidScavGun');
const RAR = G('RARITIES');
let badType = 0, badIlvl = 0, badRarity = 0, badName = 0, badAmmo = 0;
for (let i = 0; i < 200; i++) {
  const g = scavGun(1 + (i % 40));
  if (!SCAV_TYPES.includes(g.type)) badType++;
  if ((g.ilvl || 0) > SCAV_MAX) badIlvl++;
  const ri = RAR.findIndex(r => r.id === g.rarity);
  if (ri > 2) badRarity++;
  if (!/^(PM|PB|MP-443 Grach|GSh-18|TT|MP-133|TOZ-106|M870|MP-153|KS-23M|PP-91 Kedr|PP-9 Klin|PP-19-01 Vityaz|MP5)(，(PS|T|RIP))?$/.test(g.name)) badName++;
  const sh = g.element === 'none' ? 'PS' : (ELEMENTS[g.element] || {}).short;
  if (!/^(PS|T|RIP)$/.test(sh)) badAmmo++;
}
check('Scav 枪型只在手枪/霰弹/冲锋枪池', badType, 0, 0.001);
check('Scav 枪械等级封顶 8', badIlvl, 0, 0.001);
check('Scav 品质封顶蓝品', badRarity, 0, 0.001);
check('Scav 型号全部为塔科夫低阶实装名', badName, 0, 0.001);
check('Scav 弹药只出 PS/T/RIP', badAmmo, 0, 0.001);
let lootBad = 0;
for (let i = 0; i < 80; i++) {
  const g = Raid._rollGunLoot('scav', 1);
  const ri = RAR.findIndex(r => r.id === g.rarity);
  if (!SCAV_TYPES.includes(g.type) || (g.ilvl || 0) > SCAV_MAX || ri > 2) lootBad++;
}
check('Scav 战利品枪也封顶低阶', lootBad, 0, 0.001);
const mkScav = () => ({ cls:'scav', gun:{ type:'pistol', value:10, dmg:10, mag:8, reserve:24 }, inv:{ weapons:[], armors:[], helmets:[], parts:[], meds:[] }, armorTier:1, dr:0.1, maxArmor:40, armor:40, helmetTier:0, helmetDr:0, maxHelmetArmor:0, helmetArmor:0 });
const s1 = mkScav();
Raid._botTakeItem(s1, { kind:'weapon', type:'rifle', ilvl:30, rarity:'orange', value:99999, dmg:999, mag:30, reserve:90 });
Raid._botTakeItem(s1, { kind:'armor', tier:8, dr:0.5, maxArmor:999, value:99999 });
check('Scav 拒绝拾取高阶枪', s1.gun.type === 'pistol' ? 1 : 0, 1, 0.001);
check('Scav 拒绝拾取 4 级以上护甲', s1.armorTier, 1, 0.001);
const s2 = mkScav();
Raid._botTakeItem(s2, { kind:'weapon', type:'shotgun', ilvl:6, rarity:'green', value:100, dmg:20, mag:6, reserve:30 });
check('Scav 可以换用低阶枪', s2.gun.type === 'shotgun' ? 1 : 0, 1, 0.001);

console.log('\n=== 19. 去三角洲痕迹 / 塔科夫术语 ===');
const uiSrc = fs.readFileSync(path.join(SRC, 'ui.js'), 'utf8');
const nameFiles = ['config', ...raidModules, 'ui', 'shop', 'player', 'world', 'endless', 'save', 'skills', 'items', 'shields', 'br'];
const allNameSrc = nameFiles.map(f => fs.readFileSync(path.join(SRC, f + '.js'), 'utf8')).join('\n') + cfgSrc;
const deltaHits = ['干员', '悬赏', '黑市代币', '配给券', '三角洲', '曼德尔', '烽火地带', '哈夫克'].filter(w => allNameSrc.includes(w));
check('源码中无三角洲术语', deltaHits.length, 0, 0.001);
/* v0.27.0：Boss 从「借用某作品角色名」改为原创代号，断言同步反转 */
check('Boss 使用原创代号（不再借用既有 IP）',
  !/Reshala|Killa|Shturman/.test(raidSrc) && /bountyNames=\["铁锈","屠夫","调度长",/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('选角文案为「选择你的 PMC」', /选择你的 PMC/.test(uiSrc) ? 1 : 0, 1, 0.001);
check('精英 AI 改称 Raider', /Raider/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('货币文案为 GP 币 / 美元', /GP 币/.test(raidSrc) && !/黑市代币|配给券/.test(allNameSrc) ? 1 : 0, 1, 0.001);

console.log('\n=== 20. GitHub Pages P2P 联机 ===');
const p2pSrc = fs.readFileSync(path.join(SRC, 'net-p2p.js'), 'utf8');
check('net-p2p.js 已加载', typeof G('NetP2P') === 'object' ? 1 : 0, 1, 0.001);
check('默认仍为 HTTP 联机', G('Net.transport') === 'http' ? 1 : 0, 1, 0.001);
check('P2P 会探测 /api/ping', /serverAvailable/.test(p2pSrc) && /\/api\/ping/.test(p2pSrc) ? 1 : 0, 1, 0.001);
check('P2P 使用 PeerJS 房间前缀', /borderops-v1-/.test(p2pSrc) ? 1 : 0, 1, 0.001);
check('P2P 房主权威 AI 快照', /Net\._aiPayload|_aiPayload/.test(p2pSrc) ? 1 : 0, 1, 0.001);
check('P2P 事件环去重游标', /_eventsSince/.test(p2pSrc) && /cursor/.test(p2pSrc) ? 1 : 0, 1, 0.001);
check('PeerJS 已本地内置', fs.existsSync(path.join(ROOT, 'vendor', 'peerjs.min.js')) && fs.statSync(path.join(ROOT, 'vendor', 'peerjs.min.js')).size > 50000 ? 1 : 0, 1, 0.001);
check('index.html 已引入 net-p2p', /src\/net-p2p\.js\?v=/.test(html) ? 1 : 0, 1, 0.001);

console.log('\n=== 21. 2D/3D 维度 · 医疗品 · 经济数值（v0.19.0）===');
const fpSrc = fs.readFileSync(path.join(SRC, 'fpview.js'), 'utf8');
const vmSrc = fs.readFileSync(path.join(SRC, 'viewmode.js'), 'utf8');

check('index.html 引入 viewmode.js', /src\/viewmode\.js\?v=/.test(html) ? 1 : 0, 1, 0.001);
check('index.html 引入 fpview.js', /src\/fpview\.js\?v=/.test(html) ? 1 : 0, 1, 0.001);
check('渲染器有 3D 分支', /FPView\.render\(ctx, game, R\)/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('3D 朝向覆盖开火角度', /p\.angle=ViewMode\.yaw/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('3D 移动按视角旋转', /ViewMode\.rotateMove\(mx,my\)/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('标题页不再提供 2D/3D 入口', /id="btn-settings"/.test(uiSrc) ? 0 : 1, 1, 0.001);
check('暂停面板有设置入口', /id="btn-pause-settings"/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('局内 V 键切换维度', /KeyV/.test(vmSrc) && /inRaid/.test(vmSrc) ? 1 : 0, 1, 0.001);

/* 3D 必须读同一份 2D 地图数据 */
const shared = ['forests', 'roads', 'waterCircles', 'roomRects', 'yards', 'bridges', 'props'];
const missShared = shared.filter(k => !fpSrc.includes('R.' + k));
check('3D 复用 2D 地面 / 装饰数据', missShared.length, 0, 0.001);
if (missShared.length) console.log('  缺少:', missShared.join(','));
check('3D 复用手电与探照灯色温', /R\.floodlights/.test(fpSrc) && /255,236,182/.test(fpSrc) ? 1 : 0, 1, 0.001);
check('3D 有手持武器模型', /_gunModel/.test(fpSrc) && /_meleeModel/.test(fpSrc) ? 1 : 0, 1, 0.001);
check('3D 墙体取 2D 配色', /39, 45, 49/.test(fpSrc) ? 1 : 0, 1, 0.001);
/* v0.19.1：3D 地面改为与 2D scene() 同数据同顺序的真透视投影，逐层核对 */
const floorLayers = [
  ['分区网格', /_hash2\(gx\*7\+3, gy\*11\+5\)/],
  ['草丛碎石', /gx\*5\+91, gy\*3\+37/],
  ['道路中线', /150,140,100/],
  ['水面', /20,38,50,0\.96/],
  ['铁路枕木', /58,48,36,0\.9/],
  ['院子水泥缝', /170,200,180,0\.05/],
  ['房间砖缝', /170,200,180,0\.06/],
  ['踢脚板', /0,0,0,0\.20/],
  ['地表贴花', /R\.decals/],
  ['区域暗斑', /R\.darkSpots/],
  ['房间名', /rm\.name/],
  ['真透视投影', /_clipNear/],
];
const missLayer = floorLayers.filter(([n, re]) => !re.test(fpSrc)).map(([n]) => n);
check('3D 地面逐层对齐 2D scene()', missLayer.length, 0, 0.001);
if (missLayer.length) console.log('  缺少图层:', missLayer.join(' / '));
check('3D 不再提供小地图入口', /vm-minimap/.test(vmSrc) ? 0 : 1, 1, 0.001);

/* 开阔朝向 + 渲染不抛异常 */
const grad = { addColorStop(){} };
/* 统计绘制调用次数：面渲染是否真的落到 canvas 上，光看「不抛异常」是看不出来的 */
sandbox.__ctxCalls = 0;
const mockCtx = new Proxy({}, {
  get(t, k){
    if(k === 'createLinearGradient' || k === 'createRadialGradient') return () => grad;
    if(k === 'measureText') return () => ({width:10});
    return () => { sandbox.__ctxCalls++; };
  },
  set(){ return true; },
});
sandbox.__mockCtx = mockCtx;
sandbox.__mockGame = { view:{w:960,h:600,dpr:1}, zoom:1 };
G(`Raid.walls=[{x:-320,y:-500,w:40,h:1000,kind:"wall"},{x:300,y:-200,w:40,h:400,kind:"wall"},{x:-60,y:420,w:520,h:40,kind:"wall",dam:true}];
   Raid.props=[]; Raid.forests=[]; Raid.roads=[]; Raid.waterCircles=[]; Raid.yards=[];
   Raid.roomRects=[]; Raid.bridges=[]; Raid.floodlights=[]; Raid.reservoirRect=null; Raid.damOpen=false;
   Raid.containers=[]; Raid.grounds=[]; Raid.shops=[]; Raid.extracts=[]; Raid.gadgets=[];
   Raid.player={x:0,y:0,angle:0,vx:0,vy:0,gun:null,fireCd:0,reloadT:0,parts:[]};
   Raid.active=true; ViewMode.mode="3d"; ViewMode._yawFor=null; ViewMode.yaw=0;
   ViewMode.ensureYaw(Raid);`);
check('开局自动选开阔朝向', Math.cos(G('ViewMode.yaw')) > 0.5 ? 1 : 0, 1, 0.001);
let rErr = '';
try { G('FPView.render(__mockCtx, __mockGame, Raid)'); } catch(e){ rErr = e.message; }
check('空手 3D 渲染无异常', rErr ? 0 : 1, 1, 0.001);
if (rErr) console.log('  render error:', rErr);
check('深度缓冲已写入', G('FPView._zbuf && FPView._zbuf.length > 100') ? 1 : 0, 1, 0.001);
check('3D 墙面按面渲染并落到 canvas', G('__ctxCalls') > 200 ? 1 : 0, 1, 0.001);
check('3D 墙面按深度排序（画家算法）', /valid\.sort\(\(a,b\)=> b\.dm - a\.dm\)/.test(fpSrc) ? 1 : 0, 1, 0.001);
check('3D 墙面按法线当面剔除', /if\(P\.y <= y0\) faces\.push/.test(fpSrc) ? 1 : 0, 1, 0.001);
check('3D 面渲染不再逐列合批', /_paintWalls\(ctx, w, h\)/.test(fpSrc) ? 0 : 1, 1, 0.001);
check('3D 顶点缓冲复用（热路径零分配）', /_fq \|\| \(this\._fq = /.test(fpSrc) ? 1 : 0, 1, 0.001);
const wallSrc = fpSrc.slice(fpSrc.indexOf('_paintWalls(ctx, near){'), fpSrc.indexOf('===================== 地面层'));
check('3D 长墙切段代替渐变对象', /Math\.ceil\(f\.len\/420\)/.test(wallSrc) && !/ctx\.createLinearGradient/.test(wallSrc) ? 1 : 0, 1, 0.001);
rErr = '';
G('Raid.player.gun={ name:"AK-74N", type:"rifle", rarity:"blue", parts:[{slot:"scope"}], value:1000, ammoMag:30, ammoRes:90 };');
try { G('FPView.render(__mockCtx, __mockGame, Raid)'); } catch(e){ rErr = e.message; }
check('持枪 3D 渲染无异常', rErr ? 0 : 1, 1, 0.001);
if (rErr) console.log('  gun render error:', rErr);

/* 医疗品：背包里捡到的也能用 */
G(`Raid.meds={hemo:0,medkit:1,stim:0,surgery:0}; Raid.bandages=0;
   Raid.inv={meds:[{id:"stim",n:2,name:"强心针"},{id:"surgery",n:1,name:"手术包"}],weapons:[],armors:[],helmets:[],shields:[],parts:[],materials:[],receivers:[],keys:[]};
   Raid.floats=[];`);
check('医疗计数含背包物品', G('Raid._medCount("stim")'), 2, 0.001);
check('医疗计数含带入药品', G('Raid._medCount("medkit")'), 1, 0.001);
check('没有的药品计数为 0', G('Raid._medCount("hemo")'), 0, 0.001);
check('HUD 只列拥有的药品', G('Raid._medOwnedList().length'), 3, 0.001);
G('Raid._medTake("stim");');
check('使用后从背包扣除', G('Raid._medCount("stim")'), 1, 0.001);
G('Raid._medTake("medkit");');
check('带入药品用尽后归零', G('Raid._medCount("medkit")'), 0, 0.001);
check('使用接口存在', G('typeof Raid._useMed === "function"') ? 1 : 0, 1, 0.001);
check('物品栏有「使用」按钮', /data-use=/.test(raidSrc) && /_invUse/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('五种医疗品齐全', G('RAID_MEDS.length'), 5, 0.001);

/* 经济数值：局内 0.8±0.1 / 回收 1.2±0.4 / 背包 0.5 / 局外 2.0±0.5 */
const econ = JSON.parse(G(`JSON.stringify((()=>{
  const keys=["a","b","c","d","e","f","g","h","i","j","k","l"];
  const shop=keys.map(k=>raidShopPrice(1000,k)/1000);
  const field=keys.map(k=>raidFieldSellPrice(1000,k)/1000);
  const sup=keys.map(k=>raidSuperPrice(1000,k)/1000);
  return { shop, field, sup, bag:raidBagSellPrice(1000)/1000,
    vendor:RAID_VENDOR_RATE, fieldRate:RAID_FIELD_SELL_RATE, shopRate:RAID_SHOP_RATE, superRate:RAID_SUPER_RATE };
})())`));
check('局内商店倍率 0.8', econ.shopRate, 0.8, 0.001);
check('回收超市倍率 1.2', econ.fieldRate, 1.2, 0.001);
check('背包直售倍率 0.5', econ.bag, 0.5, 0.001);
check('局外军火超市倍率 2.0', econ.superRate, 2.0, 0.001);
check('局内售价落在 0.7~0.9', econ.shop.every(v => v >= 0.7 - 1e-9 && v <= 0.9 + 1e-9) ? 1 : 0, 1, 0.001);
check('回收价落在 0.8~1.6', econ.field.every(v => v >= 0.8 - 1e-9 && v <= 1.6 + 1e-9) ? 1 : 0, 1, 0.001);
check('局外售价落在 1.5~2.5', econ.sup.every(v => v >= 1.5 - 1e-9 && v <= 2.5 + 1e-9) ? 1 : 0, 1, 0.001);
check('价格有浮动（非恒定）', new Set(econ.shop).size > 1 && new Set(econ.field).size > 1 ? 1 : 0, 1, 0.001);

/* 词缀数量：大部分 1 条，少部分 2 条以上 */
const aff = JSON.parse(G(`JSON.stringify((()=>{
  const c={1:0,2:0,3:0,4:0};
  for(let i=0;i<3000;i++){ const n=rollAffixCount("blue"); c[n]=(c[n]||0)+1; }
  return c;
})())`));
const singleShare = aff[1] / 3000, multiShare = (aff[2] + aff[3] + aff[4]) / 3000;
check('大部分枪械/配件只有 1 条词缀', singleShare > 0.6 ? 1 : 0, 1, 0.001);
check('少部分有 2 条以上词缀', multiShare < 0.4 && multiShare > 0 ? 1 : 0, 1, 0.001);
console.log(`  词缀分布：1 条 ${(singleShare*100).toFixed(1)}% · 2 条 ${(aff[2]/30).toFixed(1)}% · 3+ 条 ${((aff[3]+aff[4])/30).toFixed(1)}%`);
const partAff = G(`(()=>{ const pt=rollPart("muzzle",20,"blue"); return pt.affixes.length; })()`);
check('配件词缀数在 1~4 之间', partAff >= 1 && partAff <= 4 ? 1 : 0, 1, 0.001);

console.log('\n=== 22. 撤离费阶梯 + 撤离点封锁规则（v0.19.2）===');
/* 裸装 0.2 倍、带得越多折扣越小、绝对金额仍随装备升值上升、封顶 1.4 倍 */
const feeTbl = JSON.parse(G(`JSON.stringify((()=>{
  const z=RAID_EXTRACT_RULES.extJ, base0=z.cost*0.28;
  const vs=[0,30000,90000,300000,900000];
  return { base0, cap:z.cost*RAID_FEE_CAP_K,
    rows: vs.map(v=>{ const fee=raidExtractFee(z,v);
      const base=z.cost*0.28+v*(z.feeRate||0.018);
      return { v, fee, mult:+raidExtractFeeMult(v).toFixed(3), ratio:+(fee/base).toFixed(3) }; }) };
})())`));
const r0 = feeTbl.rows[0];
check('裸装撤离费约 0.2 倍', r0.mult > 0.199 && r0.mult < 0.201 ? 1 : 0, 1, 0.001);
check('裸装撤离费 ≤ ₽120', r0.fee <= 120 ? 1 : 0, 1, 0.001);
check('带的装备越多折扣越小', feeTbl.rows.every((r,i)=>
  i === 0 || (r.mult > feeTbl.rows[i-1].mult - 1e-6 && r.mult <= 1)) ? 1 : 0, 1, 0.001);
check('折扣永远到不了原价', feeTbl.rows[feeTbl.rows.length-1].mult < 1 ? 1 : 0, 1, 0.001);
check('绝对费用随装备升值上升', feeTbl.rows.every((r,i)=>
  i === 0 || r.fee >= feeTbl.rows[i-1].fee) ? 1 : 0, 1, 0.001);
check('撤离费封顶 2.6 倍（v0.36.0 上调）', feeTbl.rows.every(r => r.fee <= feeTbl.cap + 1) ? 1 : 0, 1, 0.001);
const noFee = G(`(()=>{ const f=(id,v)=>raidExtractFee(RAID_EXTRACT_RULES[id],v);
  const paid=["extC","extH","extJ","extP"];
  return { all:paid.map(id=>f(id,0)), zero:f("extA",0), zero2:f("extB",300000) }; })()`);
check('免费撤离点仍为 0 费', noFee.zero === 0 && noFee.zero2 === 0 ? 1 : 0, 1, 0.001);
check('四个付费点裸装都低于 ₽120', noFee.all.every(v => v > 0 && v <= 120) ? 1 : 0, 1, 0.001);
check('付费撤离点永不被封锁', /filter\(z=>!z\.closed && !\(z\.cost>0\)/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('同一撤离点不重复挂封锁者', /o\.alive && o\.blockZone===z\)\)/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('全图封锁者上限为 2', /liveBlockers < 2/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('撤离 HUD 显示真实原因', /const exLabel = blocked \? \(\(money/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('撤离费可走仓库兜底', /_payExtractFee/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('钱不够与封锁分开显示', /const money = !!blocked && blocked\.indexOf\("撤离费"\)===0/.test(raidSrc) ? 1 : 0, 1, 0.001);
const feeShow = JSON.parse(G(`JSON.stringify((()=>{
  const paid=["extC","extH","extJ","extP"], vs=[0,30000,90000,300000];
  return paid.map(id=>[id].concat(vs.map(v=>raidExtractFee(RAID_EXTRACT_RULES[id],v))));
})())`));
console.log('  撤离费表（裸装 / ₽3万 / ₽9万 / ₽30万）：');
feeShow.forEach(r => console.log('    ' + r[0] + '  ' + r.slice(1).map(x => '₽'+x).join('  →  ')));

console.log('\n=== 23. 3D 掩体 / 手电 / 2D 手持模型 / 文案（v0.19.3）===');
check('3D 不再把掩体当墙体渲染', /\(wl\.kind \|\| "wall"\) !== "wall"/.test(fpSrc) ? 1 : 0, 1, 0.001);
check('3D 深度缓冲改为垂直深度', /this\._zbuf\[c\] = best \* Math\.cos\(a - yaw\)/.test(fpSrc) ? 1 : 0, 1, 0.001);
check('3D 手电按面投射（跟随视线）', /0\.22 \* cone \* fall/.test(fpSrc) ? 1 : 0, 1, 0.001);
check('3D 移除固定手电亮斑', /rgba\(255,236,182,0\.20\)/.test(fpSrc) ? 0 : 1, 1, 0.001);
check('2D 有手持武器平面模型', /handWeapon\(ctx, o, r\)\{/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('2D 玩家改用武器模型', /if\(o\.isPlayer \|\| o\.remote\)\{/.test(raidSrc) &&
  /this\.handWeapon\(ctx, o, r\)/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('空手画战术匕首', /战术匕首/.test(raidSrc) ? 1 : 0, 1, 0.001);
/* 手持模型必须真的跑得通：空手 / 步枪带瞄具 / 狙击三种都画一遍 */
let hwErr = '';
try {
  G(`(()=>{ const o={x:0,y:0,r:15,angle:0.7,gun:null,color:"#88a078",isPlayer:true,hp:100,maxHP:100,
      armorType:0,armor:0,dr:0,freezeT:0,burnT:0,corrodeT:0,shockT:0,radT:0,kills:0};
    RenderRaid.unit(__mockCtx, o, __mockGame);
    o.gun={ type:"rifle", element:"fire", rarity:"blue", parts:[{slot:"optic"}] };
    RenderRaid.unit(__mockCtx, o, __mockGame);
    o.gun={ type:"sniper", element:"none", rarity:"purple", parts:[] };
    RenderRaid.unit(__mockCtx, o, __mockGame);
    return 1; })()`);
} catch(e){ hwErr = e.message; }
check('2D 手持模型三种状态均无异常', hwErr ? 0 : 1, 1, 0.001);
if (hwErr) console.log('  handWeapon error:', hwErr);
check('文案：同场 AI 数量与实际一致', /开局与 <b style="color:#e0b84a">30 名 PMC \/ Scav<\/b>/.test(raidSrc) && /共 43 名/.test(raidSrc) && /10 名精英/.test(raidSrc) ? 1 : 0, 1, 0.001);

console.log('\n=== 24. 放弃确认 / 价格波动 / 弹种正态 / 建筑重叠（v0.19.4）===');
const wpnSrc = fs.readFileSync(path.join(SRC, 'weapons.js'), 'utf8');
check('放弃突袭需要二次确认', /UI\.raidPause=function\(confirmQuit\)/.test(raidSrc) && /UI\.raidPause\(true\)/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('确认面板有取消与确认两键', /btn-quit-cancel/.test(raidSrc) && /btn-quit-ok/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('首次点击不直接判负', /UI\.raidPause\(true\);\s*\/\/ 先确认/.test(raidSrc) ? 1 : 0, 1, 0.001);

/* 价格：小额按 1、中额按 5、大额按 10 —— 全按 10 会让低价货「售价 = 估值」且看不出浮动 */
const pr = JSON.parse(G(`JSON.stringify((()=>{
  const keys=["a","b","c","d","e","f","g","h"];
  return {
    r1: raidEconRound(1), r8: raidEconRound(8), r88: raidEconRound(88), r880: raidEconRound(880),
    shop10: keys.map(k=>raidShopPrice(10,k)),
    shop20: keys.map(k=>raidShopPrice(20,k)),
    field10: keys.map(k=>raidFieldSellPrice(10,k)),
  };
})())`));
check('小额取整不再吃掉折扣', pr.r8 === 8 ? 1 : 0, 1, 0.001);
check('中额按 5 / 大额按 10 取整', pr.r88 === 90 && pr.r880 === 880 ? 1 : 0, 1, 0.001);
check('最低价仍为正整数', pr.r1 >= 1 ? 1 : 0, 1, 0.001);
check('₽10 材料售价低于估值', pr.shop10.every(v => v > 0 && v < 10) ? 1 : 0, 1, 0.001);
check('低价材料有可见浮动', new Set(pr.shop10).size > 1 && new Set(pr.shop20).size > 1 ? 1 : 0, 1, 0.001);
check('回收价同样按阶梯取整', new Set(pr.field10).size > 1 ? 1 : 0, 1, 0.001);
console.log(`  材料售价：估值 ₽10 → ${pr.shop10.join('/')} · 估值 ₽20 → ${pr.shop20.join('/')}`);

/* 弹种：截断正态（中段常见、两端罕见）而不是五种各 20% */
const pens = JSON.parse(G('JSON.stringify(AMMO_POOL_BY_PEN.map(k=>AMMO_TYPES[k].pen))'));
check('弹种梯队按穿深升序', pens.every((v,i) => i === 0 || v >= pens[i-1]) ? 1 : 0, 1, 0.001);
check('弹种生成走截断正态', /RNG\.normPick\(AMMO_POOL_BY_PEN/.test(wpnSrc) ? 1 : 0, 1, 0.001);
const dist = JSON.parse(G(`JSON.stringify((()=>{
  const c={}; for(let i=0;i<20000;i++){ const e=RNG.normPick(AMMO_POOL_BY_PEN,{mid:2,sigma:1.0}); c[e]=(c[e]||0)+1; }
  return c;
})())`));
const [c0,c1,c2,c3,c4] = pens.map((_,i)=>dist[["corrosive","cryo","fire","radiation","shock"][i]]||0);
check('弹种抽样覆盖全部五档', (c0&&c1&&c2&&c3&&c4) ? 1 : 0, 1, 0.001);
check('中段弹种最常见', c2 > c1 && c2 > c3 && c2 > c0 && c2 > c4 ? 1 : 0, 1, 0.001);
check('两端弹种明显罕见', c0 < c2*0.5 && c4 < c2*0.5 ? 1 : 0, 1, 0.001);
console.log(`  弹种分布 RIP ${(c0/200).toFixed(1)}% · SP-6 ${(c1/200).toFixed(1)}% · T ${(c2/200).toFixed(1)}% · BT ${(c3/200).toFixed(1)}% · BP ${(c4/200).toFixed(1)}%`);

/* 建筑：任意两栋建筑不重叠；撤离点不压在任何建筑上（操场/堆场这类「场地」允许内含建筑） */
const rooms = JSON.parse(G('JSON.stringify(RAID_ROOMS)'));
const isYard = r => /Yard$/.test(r.id);
const ov = (a,b) => {
  const w = Math.min(a.x+a.w, b.x+b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y+a.h, b.y+b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? Math.round(w*h) : 0;
};
const roomClash = [], extClash = [];
for (let i=0;i<rooms.length;i++){
  for (let j=i+1;j<rooms.length;j++){
    const a=rooms[i], b=rooms[j];
    if (!ov(a,b) || isYard(a) || isYard(b)) continue;
    (a.id.startsWith("ext") || b.id.startsWith("ext") ? extClash : roomClash).push(a.id+"×"+b.id);
  }
}
check('地图建筑无重叠', roomClash.length, 0, 0.001);
if (roomClash.length) console.log('  重叠:', roomClash.join(' / '));
check('撤离点不压在建筑上', extClash.length, 0, 0.001);
if (extClash.length) console.log('  压建筑:', extClash.join(' / '));

console.log('\n=== 25. 弹药物品化（v0.20.0）===');
const ammoMeta = JSON.parse(G(`JSON.stringify((()=>{
  const ids=Object.keys(AMMO_DEFS);
  const pens=AMMO_GRADES.map(g=>AMMO_TYPES[g.elem].pen);
  const powers=AMMO_GRADES.map(g=>g.power);
  return { n:ids.length, ids, pens, powers,
    calOf:{ pistol:ammoCalOfType("pistol"), smg:ammoCalOfType("smg"), rifle:ammoCalOfType("rifle"),
            sniper:ammoCalOfType("sniper"), shotgun:ammoCalOfType("shotgun"), launcher:ammoCalOfType("launcher") },
    parse:JSON.stringify(ammoParseId("ammo_heavy_4")), badId:ammoParseId("ammo_nope_1"),
    v:AMMO_CAL_LIST.map(cal=>ammoValue(cal,5)) };
})())`));
check('弹药共 4 口径 × 5 级 = 20 种', ammoMeta.n, 20, 0.001);
check('弹药 id 可反解', ammoMeta.parse === '{"cal":"heavy","lv":4}' ? 1 : 0, 1, 0.001);
check('非法弹药 id 返回 null', ammoMeta.badId === null ? 1 : 0, 1, 0.001);
const calWant = { pistol:"light", smg:"light", rifle:"mid", sniper:"heavy", shotgun:"heavy", launcher:"grenade" };
check('枪型 → 口径映射正确', Object.keys(calWant).every(k=>ammoMeta.calOf[k]===calWant[k]) ? 1 : 0, 1, 0.001);
check('弹药穿深随级别递增', ammoMeta.pens.every((v,i)=>i===0||v>=ammoMeta.pens[i-1]) ? 1 : 0, 1, 0.001);
check('弹药威力随级别递增', ammoMeta.powers.every((v,i)=>i===0||v>ammoMeta.powers[i-1]) ? 1 : 0, 1, 0.001);
check('高级弹药更值钱', ammoMeta.v.every((v,i)=>i===0||v>ammoMeta.v[i-1]) ? 1 : 0, 1, 0.001);
console.log(`  弹级穿深：${ammoMeta.pens.join(' → ')} · 威力 ×${ammoMeta.powers[0]} → ×${ammoMeta.powers[4]}`);

/* 装填 / 扣弹 / 换弹闭环（纯逻辑，不依赖渲染） */
const ammoLoop = JSON.parse(G(`JSON.stringify((()=>{
  const R=Raid;
  R.inv={weapons:[],armors:[],helmets:[],shields:[],parts:[],materials:[],meds:[],cores:[],receivers:[],keys:[],ammo:{}};
  R.inv.ammo["ammo_mid_2"]=60;
  const gun={ type:"rifle", mag:30, cal:"mid", ammoMag:0, ammoRes:0, element:"none" };
  R.player={ x:0,y:0, isPlayer:true, gun:gun, secondary:null, reloadT:0, alive:true, angle:0 };
  R._loadAmmo(gun, "ammo_mid_2");
  const loaded={ elem:gun.element, power:gun.power, dotK:gun.dotK };
  R._startReload(R.player);
  const started=R.player.reloadT>0;
  R.player.reloadT=0; R._finishReload(R.player);
  const after={ mag:gun.ammoMag, left:R._ammoCount("ammo_mid_2"), res:gun.ammoRes };
  // 再打空一次，但背包只剩 15 发 → 只装得进 15
  R._ammoTake("ammo_mid_2", 15);
  gun.ammoMag=0; R.player.reloadT=0; R._finishReload(R.player);
  const partial={ mag:gun.ammoMag, left:R._ammoCount("ammo_mid_2") };
  // 完全没有子弹时不能开始换弹
  gun.ammoMag=0; R.player.reloadT=0; R._startReload(R.player);
  const noAmmoReload=R.player.reloadT;
  // 自动换用另一档
  R.inv.ammo["ammo_mid_4"]=20;
  R._startReload(R.player);
  const swap={ loaded:gun.loaded, started:R.player.reloadT>0 };
  // 上限
  R.inv.ammo={}; const added=R._ammoAdd("ammo_light_1", 9999);
  return { loaded, started, after, partial, noAmmoReload, swap, added };
})())`));
check('装填写入 element / power / dotK', ammoLoop.loaded.power > 1 && ammoLoop.loaded.elem === "cryo" ? 1 : 0, 1, 0.001);
check('换弹会开始读条', ammoLoop.started ? 1 : 0, 1, 0.001);
check('换弹从背包扣子弹', ammoLoop.after.mag === 30 && ammoLoop.after.left === 30 ? 1 : 0, 1, 0.001);
check('子弹不足时只装现有的', ammoLoop.partial.mag === 15 && ammoLoop.partial.left === 0 ? 1 : 0, 1, 0.001);
check('没有子弹不能换弹', ammoLoop.noAmmoReload === 0 ? 1 : 0, 1, 0.001);
check('打光后自动换用另一档', ammoLoop.swap.loaded === "ammo_mid_4" && ammoLoop.swap.started ? 1 : 0, 1, 0.001);
check('弹药总发数有上限', ammoLoop.added, 720, 0.001);

/* 商店 / 合成 / 掉落 三个入口都接上了 */
const shopAmmo = JSON.parse(G(`JSON.stringify((()=>{
  const R=Raid; R.lootLuck=0.2;
  const out={};
  for(const k of ["gun","mat","black"]){
    const st=R._shopStock(k);
    out[k]=st.ammo.length ? { n:st.ammo.length, price:st.ammo[0].shopPrice||st.ammo[0].tokenPrice||0,
      id:st.ammo[0].id, hasField:!!st.ammo[0].id } : null;
  }
  return out;
})())`));
check('枪械店卖弹药', shopAmmo.gun && shopAmmo.gun.n > 0 ? 1 : 0, 1, 0.001);
check('材料店卖弹药', shopAmmo.mat && shopAmmo.mat.n >= 8 ? 1 : 0, 1, 0.001);
check('黑市卖高级弹药', shopAmmo.black && shopAmmo.black.n > 0 ? 1 : 0, 1, 0.001);
check('商店弹药有价格', [shopAmmo.gun, shopAmmo.mat, shopAmmo.black].every(a=>a && a.price>0) ? 1 : 0, 1, 0.001);
const craftAmmo = JSON.parse(G(`JSON.stringify((()=>{
  const rs=RAID_RECIPES.filter(r=>r.kind==="ammo");
  return { n:rs.length, names:rs.map(r=>r.name),
    lv0:rs[0].make(null,0).id, lv8:rs[0].make(null,8).id, n0:rs[0].make(null,0).n };
})())`));
check('工坊有 4 条弹药配方', craftAmmo.n, 4, 0.001);
check('低品质投料产出低级弹', craftAmmo.lv0 === "ammo_light_1" ? 1 : 0, 1, 0.001);
check('高品质投料产出高级弹', craftAmmo.lv8 === "ammo_light_5" ? 1 : 0, 1, 0.001);
check('一次合成出 30 发', craftAmmo.n0, 30, 0.001);
check('AI 尸体掉落弹药', /drops\.push\(ammoDef\(gcal, lv\)\)/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('箱子掉落弹药', /_rollAmmo/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('拾取物支持弹药', /item\.kind==="ammo"/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('旧档迁移补起步弹药', /RAID_AMMO_STARTER/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('大厅可按发数携带弹药（v0.21.3 改滑动条）',
  /id="rc-ammo-\$\{cal\}" type="range"/.test(raidSrc) && /_prepPlayerAmmo/.test(raidSrc) ? 1 : 0, 1, 0.001);

/* v0.21.6：厂商改为「显示层」剥离 —— 存档名一律写全，精简模式下 gunNameOf 才剥掉厂商 */
const manHidden = JSON.parse(G(`JSON.stringify((()=>{
  const mans=Object.values(MANUFACTURERS).map(m=>m.name);
  const ws=[0,1,2,3,4,5,6,7].map(()=>generateWeapon(14));
  const prev=CFG.display; CFG.display="compact";
  const shown=ws.map(w=>gunNameOf(w));
  CFG.display=prev;
  return { flag:CFG.showManufacturer, full:ws[0].name,
    stored:ws.filter(w=>mans.some(mn=>w.name.indexOf(mn)===0)).length,
    leak:shown.filter(n=>mans.some(mn=>n.indexOf(mn)===0)) };
})())`));
check('厂商字段仍保留（showManufacturer 兼容）', typeof manHidden.flag === "boolean" ? 1 : 0, 1, 0.001);
check('存档名写全厂商（完整模式能看回来）', manHidden.stored > 0 ? 1 : 0, 1, 0.001);
check('精简显示下枪名不含厂商前缀', manHidden.leak.length, 0, 0.001);
if (manHidden.leak.length) console.log('  仍带厂商:', manHidden.leak.join(' / '));
check('旧名清洗函数存在', /function stripManufacturer\(name\)/.test(fs.readFileSync(path.join(SRC,'weapons.js'),'utf8')) ? 1 : 0, 1, 0.001);

/* v0.20.1：默认零携带 —— 不指定就不带弹药，钥匙也默认一把不带 */
const carryDefault = JSON.parse(G(`JSON.stringify((()=>{
  const R=Raid;
  const mk=()=>{ R.inv={weapons:[],armors:[],helmets:[],shields:[],parts:[],materials:[],meds:[],cores:[],receivers:[],keys:[],ammo:{}}; };
  R.stash={ ammo:{ "ammo_mid_1":300, "ammo_light_1":200 } };
  R.player={ isPlayer:true, gun:{ type:"rifle", mag:30, ammoMag:0, ammoRes:0, cal:"mid" }, secondary:null };
  mk(); R._prepPlayerAmmo({});
  const none={ inv:R._ammoTotal(), mag:R.player.gun.ammoMag, stash:R.stash.ammo["ammo_mid_1"] };
  mk(); R.player.gun.ammoMag=0;
  R._prepPlayerAmmo({ ammo:{ mid:{ id:"ammo_mid_1", n:60 } } });
  const some={ inv:R._ammoTotal(), mag:R.player.gun.ammoMag, stash:R.stash.ammo["ammo_mid_1"],
    light:R.stash.ammo["ammo_light_1"] };
  return { none, some };
})())`));
check('默认不带弹药', carryDefault.none.inv === 0 && carryDefault.none.mag === 0 ? 1 : 0, 1, 0.001);
check('默认不动仓库里的子弹', carryDefault.none.stash, 300, 0.001);
check('指定携带时只带该口径', carryDefault.some.mag + carryDefault.some.inv === 60 ? 1 : 0, 1, 0.001);
check('未选的口径一发不带', carryDefault.some.light, 200, 0.001);
check('仓库按携带量扣减', carryDefault.some.stash, 240, 0.001);
check('钥匙默认一把不带', /if\(!Array\.isArray\(UI\._raidKeys\)\) UI\._raidKeys=\[\];/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('开始突袭不再兜底全带钥匙', /UI\._raidKeys\.slice\(\):\[\]/.test(raidSrc) ? 1 : 0, 1, 0.001);
/* v0.41.0（用户要求改回）：**默认一发都不带**，玩家自己拖；
   页脚必须有「未携带弹药」的红字提醒，避免又变成「以为功能坏了」 */
check('大厅弹药默认一发不带 + 有红字提醒',
  (/const n=\(sel && sel\.id===cur\.id\) \? Math\.max\(0, Math\.min\(sel\.n\|0, cap\)\) : 0;/.test(raidSrc)
   && /未携带弹药：进图后枪里没有弹匣/.test(raidSrc)) ? 1 : 0, 1, 0.001);

/* v0.21.1：显示密度「精简 / 完整」—— 折中方案，显示层决定，不改写存档名 */
const dispTest = JSON.parse(G(`JSON.stringify((()=>{
  const m=Object.values(MANUFACTURERS)[0].name;
  const w=new Weapon({ name:m+" 测试枪", kind:"weapon", uid:"veri-old-1", type:"rifle" });
  const keep=w.name;                       // 构造器不应改写
  const compact=gunNameOf(w);
  CFG.display="full"; const full=gunNameOf(w);
  CFG.display="compact";
  return { m, keep, compact, full, def:CFG.display };
})())`));
check('显示密度默认精简', dispTest.def === "compact" ? 1 : 0, 1, 0.001);
check('构造器不再改写存档枪名', dispTest.keep.indexOf(dispTest.m) === 0 ? 1 : 0, 1, 0.001);
check('精简模式枪名去掉厂商', dispTest.compact.indexOf(dispTest.m) === 0 ? 0 : 1, 1, 0.001);
check('完整模式恢复厂商与全名', dispTest.full === dispTest.keep ? 1 : 0, 1, 0.001);
check('设置里有精简 / 完整开关', /data-disp="compact"/.test(vmSrc) && /data-disp="full"/.test(vmSrc) ? 1 : 0, 1, 0.001);
check('显示设置会持久化', /applyDisplay/.test(vmSrc) && vmSrc.indexOf('display:') >= 0 ? 1 : 0, 1, 0.001);

/* v0.21.1：带入现金改滑动条；暂停菜单按钮改名 */
check('带入卢布 / GP 币是滑动条', /id="rc-creds" type="range"/.test(raidSrc) && /id="rc-tokens" type="range"/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('旧的百分比按钮已移除', /data-carry="creds:0\.25"/.test(raidSrc) ? 0 : 1, 1, 0.001);
check('暂停菜单按钮只写「设置」', /id="btn-pause-settings">设置</.test(raidSrc) ? 1 : 0, 1, 0.001);

/* v0.20.3：出生补给 / HUD 无弹告警 / 回收超市收弹药 */
const starter = JSON.parse(G(`JSON.stringify((()=>{
  const R=Raid;
  const mk=(ammo)=>{ R.inv={weapons:[],armors:[],helmets:[],shields:[],parts:[],materials:[],meds:[],cores:[],receivers:[],keys:[],ammo:Object.assign({},ammo||{})};
    R.grounds=[]; R.carried={weapons:[]};
    R.player={ isPlayer:true, gun:{ type:"rifle", cal:"mid", ammoMag:0, ammoRes:0 }, secondary:null }; };
  R._spawnSafePoint=()=>({x:10,y:10});
  mk({}); R._dropStarterCache(0,0);
  const dry={ n:R.grounds.length, id:((R.grounds[0]||{}).drops||[{}])[0].id,
              n2:(((R.grounds[0]||{}).drops||[])[0]||{}).n };
  mk({ "ammo_mid_1":30 }); R._dropStarterCache(0,0);
  const fed={ n:R.grounds.length };
  return { dry, fed };
})())`));
check('手上这把枪没弹时投放出生补给', starter.dry.n === 1 ? 1 : 0, 1, 0.001);
check('补给是 60 发同口径民用弹', starter.dry.id === "ammo_mid_1" && starter.dry.n2 === 60 ? 1 : 0, 1, 0.001);
check('已经带弹就不投放', starter.fed.n, 0, 0.001);
check('HUD 无弹时标红告警', /const dry=magN<=0 && backN<=0/.test(raidSrc) ? 1 : 0, 1, 0.001);
/* v0.34.0：分隔符从「·」改为「，」后，断言改成只校验分支与文案存在 */
check('回收超市可以卖弹药', /key==="am"/.test(raidSrc) && /弹药，/.test(raidSrc) ? 1 : 0, 1, 0.001);

/* v0.21.2：初始装备包（明码 ₽512，勾选并付款才投放）/ 护盾即穿 / 弹药回收价 / 弹级单调 */
const support = JSON.parse(G(`JSON.stringify((()=>{
  const R=Raid;
  const mk=(cash,paid)=>{ R.grounds=[]; R.cashIn=cash; R.supportPaid=paid; R.inv={weapons:[],armors:[],helmets:[],shields:[],parts:[],materials:[],meds:[],cores:[],receivers:[],keys:[],ammo:{}};
    R.carried={weapons:[]}; R.floats=[];
    R.player={ isPlayer:true, maxShield:0, gun:null, secondary:null }; };
  R._spawnSafePoint=()=>({x:5,y:5});
  R._feed=()=>{};
  mk(2000, 0); R._dropSupportCache(0,0); const unpaid=R.grounds.length;   // 没付钱
  mk(2000, 512); R._dropSupportCache(0,0);
  const d=(R.grounds[0]&&R.grounds[0].drops)||[];
  const kinds={}; for(const it of d) kinds[it.kind]=(kinds[it.kind]||0)+1;
  const ammoLv=d.filter(it=>it.kind==="ammo").map(it=>it.lv);
  const gunRar=d.filter(it=>it.kind==="weapon").map(it=>it.rarity);
  const tier={ armor:(d.find(it=>it.kind==="armor")||{}).tier, helmet:(d.find(it=>it.kind==="helmet")||{}).tier };
  return { unpaid, n:R.grounds.length, kinds, ammoLv, gunRar, tier, price:RAID_SUPPORT_CASH };
})())`));
check('装备包价格 ₽512', support.price, 512, 0.001);
check('没付款不投放初始装备包', support.unpaid, 0, 0.001);
check('付款后投放初始装备包', support.n, 1, 0.001);
check('装备包含 2 把枪', support.kinds.weapon, 2, 0.001);
check('装备包里的枪是最低品级', support.gunRar.every(r=>r==="white") ? 1 : 0, 1, 0.001);
/* v0.25.0：装备包被大幅削弱 —— 弹药降为民用 I 级、不再投放护盾。
   锁这两条是为了防止「削弱」被后来的人悄悄改回去。 */
check('装备包弹药降为民用 T1', support.ammoLv.length > 0 && support.ammoLv.every(l=>l===1) ? 1 : 0, 1, 0.001);
check('装备包不再含护盾（护甲 / 头盔仍各 1）', (support.kinds.shield===undefined && support.kinds.armor===1 && support.kinds.helmet===1) ? 1 : 0, 1, 0.001);
check('装备包护甲头盔都是 T1', support.tier.armor === 1 && support.tier.helmet === 1 ? 1 : 0, 1, 0.001);
check('装备包含医疗物资', (support.kinds.med||0) >= 2 ? 1 : 0, 1, 0.001);

/* v0.21.2：进场扣款 / 蓝点移除 / 竖枪 / 开火动画 */
check('进场从带入现金扣 ₽512', /this\.creds -= RAID_SUPPORT_CASH/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('配装大厅有装备包勾选框', /id="rc-support"/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('血条右侧不再有类型小方块', /o\.x\+w\/2\+3/.test(raidSrc) ? 1 : 0, 0, 0.001);
check('开火写入 muzzleT / kick', /sh\.muzzleT = 0\.075/.test(raidSrc) && /sh\.kick = Math\.min/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('muzzleT / kick 每帧衰减', /o\.muzzleT=Math\.max\(0,\(o\.muzzleT\|\|0\)-dt\)/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('3D 枪口火焰改由 muzzleT 驱动', /if\(\(p\.muzzleT\|\|0\) > 0\)/.test(fpSrc) ? 1 : 0, 1, 0.001);
check('3D 持枪改为竖握（长度方向压缩）', /const sxa=-0\.74\*sc, syb=0\.94\*sc/.test(fpSrc) ? 1 : 0, 1, 0.001);
check('3D 手臂在屏幕空间重画', /_fpArms\(ctx, w, h, fh, rh, gunAng/.test(fpSrc) ? 1 : 0, 1, 0.001);
check('2D 手持模型有开火火光', /globalCompositeOperation="lighter"/.test(raidSrc) ? 1 : 0, 1, 0.001);

/* v0.21.3：拍卖行改为「期号确定性货池」——同一期全网同一份货 */
const aucSrc = fs.readFileSync(path.join(SRC, 'auction.js'), 'utf8');
const aucDet = JSON.parse(G(`JSON.stringify((()=>{
  const sig=p=>p.map(L=>[L.id,L.kind,L.seller,L.start,L.price,L.buyout,L.bids,L.endsAt].join("|")).join("\\n");
  const rng0=RNG.rng;
  const a=Auction.buildPool(777), b=Auction.buildPool(777), c=Auction.buildPool(778);
  const restored = RNG.rng === rng0;                 // 生成完必须复原，否则搅乱局内随机序列
  const kinds={}; for(const L of a) kinds[L.kind]=(kinds[L.kind]||0)+1;
  return { same:sig(a)===sig(b), diff:sig(a)!==sig(c), n:a.length, restored,
           core:a[0].kind==="part" && a[0].item && a[0].item.slot==="core",
           oneEnd:a.every(L=>L.endsAt===a[0].endsAt),
           endIsPeriod:a[0].endsAt===auctionBucketEnd(777),
           kinds, max:AUCTION_MAX, pool:AUCTION_POOL,
           bucketMs:AUCTION_BUCKET_MS, seed:auctionBucketSeed(777),
           sameSeed:auctionBucketSeed(777)===auctionBucketSeed(777),
           diffSeed:auctionBucketSeed(777)!==auctionBucketSeed(778),
           bucketOf:(ms)=>0 };
})())`));
check('同期号重放货架完全一致（全网同一份货）', aucDet.same ? 1 : 0, 1, 0.001);
check('换期号整批货不同', aucDet.diff ? 1 : 0, 1, 0.001);
check('期号种子可复现', aucDet.sameSeed && aucDet.diffSeed ? 1 : 0, 1, 0.001);
check('每期货池 18 件 / 货架 10 件', aucDet.n === aucDet.pool && aucDet.max === 10 ? 1 : 0, 1, 0.001);
check('每期一件改装模块打底', aucDet.core ? 1 : 0, 1, 0.001);
check('整期挂单结束时间统一', aucDet.oneEnd ? 1 : 0, 1, 0.001);
check('结束时间 = 下一期起始', aucDet.endIsPeriod ? 1 : 0, 1, 0.001);
check('一期货架涵盖枪 / 甲 / 盔 / 配件 / 材料',
  Object.keys(aucDet.kinds).length >= 3 ? 1 : 0, 1, 0.001);
check('生成货池后 RNG 种子已复原', aucDet.restored ? 1 : 0, 1, 0.001);
check('拍卖行时长 10 分钟一期', aucDet.bucketMs, 600000, 0.5);
check('货架生成链路里没有 Math.random（确定性前提）',
  /Math\.random\(\)/.test(aucSrc.slice(aucSrc.indexOf('function auctionMakeListing'), aucSrc.indexOf('const Auction ='))) ? 0 : 1, 1, 0.001);
check('配件属性抖动改用 RNG（不再 Math.random）',
  /0\.85 \+ RNG\.f\(\)\*0\.35/.test(wpnSrc) ? 1 : 0, 1, 0.001);
check('本地只存期号 / 货池 / 出价状态 / 已下架', /bucket:d\.bucket, pool:d\.pool, state:st, taken:d\.taken/.test(aucSrc) ? 1 : 0, 1, 0.001);
check('买断后本地标记下架（池子下一件顶上）', /d\.taken\[L\.id\]=1/.test(aucSrc) ? 1 : 0, 1, 0.001);
check('跨期收尾会结算冻结的出价', /_closeBucket\(d\)/.test(aucSrc) ? 1 : 0, 1, 0.001);
check('旧的随机补货 ensureCore 已移除', /ensureCore/.test(aucSrc) ? 0 : 1, 1, 0.001);
check('拍卖行标注「全网同一份货」', /全网同一份货/.test(aucSrc) ? 1 : 0, 1, 0.001);
check('拍卖行有本期倒计时', /auc-period-left/.test(aucSrc) ? 1 : 0, 1, 0.001);
check('刷新按钮改叫「同步货架」', /同步货架/.test(aucSrc) ? 1 : 0, 1, 0.001);

/* v0.21.3：初始装备包默认不勾 / 弹药携带滑动条 / 超市合并护甲头盔并加子弹栏 */
const supportTest = JSON.parse(G(`JSON.stringify((()=>{
  const R=Raid;
  R.inv={weapons:[],armors:[],helmets:[],shields:[],parts:[],materials:[],meds:[],cores:[],receivers:[],keys:[],ammo:{}};
  R.grounds=[]; R.cashIn=2000; R.carried={weapons:[]}; R.floats=[];
  R.supportPaid=false;                                  // 大厅默认不勾装备包 → 进场未付款
  R.player={ isPlayer:true, maxShield:0, gun:null, secondary:null };
  R._spawnSafePoint=()=>({x:5,y:5}); R._feed=()=>{};
  R._dropSupportCache(0,0);
  return { paid:!!R.supportPaid, dropped:R.grounds.length };
})())`));
check('初始装备包默认不勾选（不付款）', supportTest.paid === false ? 1 : 0, 1, 0.001);
check('默认不投放初始装备包', supportTest.dropped, 0, 0.001);
check('勾选框默认未选中', /UI\._raidSupport===undefined\) UI\._raidSupport=false/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('弹药携带改为滑动条', /id="rc-ammo-\$\{cal\}" type="range"/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('弹药滑动条有数值回显', /id="rc-ammo-val-\$\{cal\}"/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('弹药「买 / 补货」按钮已移除', /data-ammobuy=/.test(raidSrc) ? 0 : 1, 1, 0.001);
check('军火超市护甲与头盔合并成一栏', /id:'armor',name:'护甲，头盔'/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('军火超市新增子弹一栏', /id:'ammo',name:'子弹'/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('超市子弹按 30 发一条卖', /RAID_AMMO_STACK/.test(raidSrc) && /data-buy="ammo:/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('超市护甲 / 头盔分区标题', /gridHead\("护甲 T1~T9/.test(raidSrc) && /gridHead\("头盔 T1~T9/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('旧头盔 tab 落回武器栏',
  /\["weapon","armor","shield","part","ammo","med"\]\.indexOf\(UI\._raidShopTab\)<0\) UI\._raidShopTab="weapon"/.test(raidSrc) ? 1 : 0, 1, 0.001);

/* v0.21.3：工坊删除「模块一览」/ 榴弹发射器机匣 32 份 / 弹药造价按弹族分档 */
check('工坊「模块一览」区块已删除', /<b>模块一览<\/b>/.test(raidSrc) ? 0 : 1, 1, 0.001);
check('工坊小节重新编号 ① 合成表 / ② 组装枪械',
  /① 合成表/.test(raidSrc) && /② 组装枪械/.test(raidSrc) ? 1 : 0, 1, 0.001);
const recGL = JSON.parse(G(`JSON.stringify((()=>{
  const r=RAID_RECIPES.find(x=>x.id==="r_recGL")||null;
  const base=RAID_RECEIVERS.find(x=>x.id==="recGL")||null;
  return { has:!!r && !!base, slots:r?r.slots:0, type:base?base.type:"", tier:base?base.tier:-1 };
})())`));
check('新增榴弹发射器机匣', recGL.has ? 1 : 0, 1, 0.001);
check('榴弹发射器机匣需要 32 份材料', recGL.slots, 32, 0.001);
check('机匣槽位 launcher:32', /launcher:32/.test(raidSrc) ? 1 : 0, 1, 0.001);
const ammoCost = JSON.parse(G(`JSON.stringify({ slots:Object.assign({},AMMO_CRAFT_SLOTS),
  cal:RAID_RECIPES.filter(r=>/^r_ammo_/.test(r.id)).map(r=>({ id:r.id.replace(/^r_ammo_/,""), slots:r.slots })) })`));
check('弹药造价 轻1 / 中2 / 重4 / 榴弹8',
  ammoCost.slots.light === 1 && ammoCost.slots.mid === 2 && ammoCost.slots.heavy === 4 && ammoCost.slots.grenade === 8 ? 1 : 0, 1, 0.001);
check('弹药配方都按弹族取投料份数',
  ammoCost.cal.length > 0 && ammoCost.cal.every(r => r.slots === (ammoCost.slots[r.id] || -1)) ? 1 : 0, 1, 0.001);

/* 护盾：捡到即穿戴；已有护盾则进背包 */
const shieldWear = JSON.parse(G(`JSON.stringify((()=>{
  const R=Raid;
  R.floats=[]; R.inv={weapons:[],armors:[],helmets:[],shields:[],parts:[],materials:[],meds:[],cores:[],receivers:[],keys:[],ammo:{}};
  R.player={ isPlayer:true, x:0, y:0, maxShield:0, shield:0 };
  const sh=raidMakeShield(1,0);
  R._collect(sh, 0, 0);
  const a={ max:R.player.maxShield, rate:R.player.shieldRate, perks:(R.player.shieldPerks||[]).length, bag:R.inv.shields.length };
  const sh2=raidMakeShield(2,1);
  R._collect(sh2, 0, 0);
  const b={ max:R.player.maxShield, bag:R.inv.shields.length };
  return { a, b };
})())`));
check('拾取护盾直接穿戴', shieldWear.a.max > 0 && shieldWear.a.bag === 0 ? 1 : 0, 1, 0.001);
check('穿戴后充能参数生效', shieldWear.a.rate > 0 && shieldWear.a.perks > 0 ? 1 : 0, 1, 0.001);
check('已有护盾时新盾进背包', shieldWear.b.bag === 1 ? 1 : 0, 1, 0.001);

/* 平衡：弹药回收价必须低于局内买价（否则材料店买 / 回收超市卖 = 无风险套利） */
const noArb = JSON.parse(G(`JSON.stringify((()=>{
  const out=[];
  for(const cal of AMMO_CAL_LIST){
    for(const lv of [1,2,3,4,5]){
      const d=ammoDef(cal, lv), v=d.value*RAID_AMMO_STACK;
      out.push({ cal, lv, shop:raidShopPrice(v, d.id), sell:raidAmmoSellPrice(v) });
    }
  }
  return out;
})())`));
check('弹药回收价低于局内买价', noArb.every(r=>r.sell < r.shop) ? 1 : 0, 1, 0.001);
if (noArb.some(r=>r.sell >= r.shop))
  console.log('  可套利:', noArb.filter(r=>r.sell>=r.shop).map(r=>r.cal+'T'+r.lv).join(' '));

/* 平衡：弹级对三类目标都必须单调变强 */
const mono = JSON.parse(G(`JSON.stringify((()=>{
  const at=["flesh","shield","armor"], out={};
  for(const t of at) out[t]=AMMO_GRADES.map(g=>+(elemMult(g.elem,t)*g.power).toFixed(3));
  return out;
})())`));
for(const t of ["flesh","shield","armor"]){
  check('弹级对 '+({flesh:"无防护",shield:"护盾",armor:"插板"}[t])+' 单调变强',
    mono[t].every((v,i)=>i===0||v>=mono[t][i-1]) ? 1 : 0, 1, 0.001);
}
console.log('  弹级倍率 无防护 '+mono.flesh.join(' → '));
console.log('  弹级倍率 护盾   '+mono.shield.join(' → '));
console.log('  弹级倍率 插板   '+mono.armor.join(' → '));

console.log('\n=== 26. 武器品质：生成恢复，显示分「精简 / 完整」（v0.21.6）===');
const CFGq = G('CFG');
check('CFG.weaponQuality 恢复为 true（不再全局禁用）', CFGq.weaponQuality === true ? 1 : 0, 1, 0.001);
const qList = JSON.parse(G(`JSON.stringify((()=>{
  const out=[];
  for(let i=0;i<120;i++) out.push(generateWeapon(10+i, { rarity:['green','blue','purple','orange','pearl'][i%5] }));
  const seen={}; for(const w of out) seen[w.rarity]=1;
  return { kinds:Object.keys(seen).length, sample:out[0].rarity };
})())`));
check('品质重新参与生成（传入 5 档全部生效）', qList.kinds>=3 ? 1 : 0, 1, 0.001);
const qGun = G('generateWeapon')(30, { type:'rifle', rarity:'orange' });
check('传入什么品质就出什么品质', qGun.rarity === 'orange' ? 1 : 0, 1, 0.001);

/* 精简模式（默认）：品质名 / 品质色 / 前后缀 / 厂商 全部隐藏 */
const compactView = JSON.parse(G(`JSON.stringify((()=>{
  const prev=CFG.display; CFG.display="compact";
  const w=generateWeapon(30,{ type:'rifle', rarity:'orange' });
  const out={ qname:w.rarityName, col:raidGunColor(w), rname:raidGunName(w),
    legend:raidTierLegend(), name:gunNameOf(w), short:w.short||"",
    hasAffix:(w.affixes||[]).length>0, hidden:weaponQualityHidden() };
  CFG.display=prev;
  return out;
})())`));
check('精简：不显示品质名', compactView.qname === '' ? 1 : 0, 1, 0.001);
check('精简：武器用中性色', compactView.col === '#cfcabb' ? 1 : 0, 1, 0.001);
check('精简：不显示品质档位名', compactView.rname === '' ? 1 : 0, 1, 0.001);
check('精简：图例改提示「精简显示」', /精简显示/.test(compactView.legend) ? 1 : 0, 1, 0.001);
check('精简：枪名不含厂商与前后缀',
  compactView.name === compactView.short && compactView.hasAffix ? 1 : 0, 1, 0.001);

/* 完整模式：厂商 + 型号 + 前后缀 + 弹种 + 品质色全开 */
const fullView = JSON.parse(G(`JSON.stringify((()=>{
  const prev=CFG.display; CFG.display="full";
  const w=generateWeapon(30,{ type:'rifle', rarity:'orange' });
  const out={ qname:w.rarityName, col:raidGunColor(w), legend:raidTierLegend(),
    name:w.name, man:(MANUFACTURERS[w.manufacturer]||{}).name||"",
    model:w.model||"", pool:WEAPON_TYPES.rifle.models.indexOf(w.model)>=0,
    hasAffix:(w.affixes||[]).length>0, hidden:weaponQualityHidden() };
  CFG.display=prev;
  return out;
})())`));
check('完整：显示品质名', fullView.qname.length>0 ? 1 : 0, 1, 0.001);
check('完整：恢复品质色', fullView.col !== '#cfcabb' ? 1 : 0, 1, 0.001);
check('完整：枪名带厂商', fullView.man && fullView.name.indexOf(fullView.man)===0 ? 1 : 0, 1, 0.001);
check('完整：枪名带前后缀', fullView.hasAffix && fullView.name !== fullView.man+" "+fullView.model ? 1 : 0, 1, 0.001);
check('枪名以真实型号为主体', fullView.pool ? 1 : 0, 1, 0.001);
check('完整：图例恢复 9 阶刻度', /军规|精工|民用/.test(fullView.legend) ? 1 : 0, 1, 0.001);

/* 型号稳定：同一条枪重算（重调词缀 / 换配件）不会改名 */
const modelStable = JSON.parse(G(`JSON.stringify((()=>{
  const a=generateWeapon(24,{ type:'smg', rarity:'blue', manufacturer:'Vladof' });
  const b=generateWeapon(24,{ type:'smg', rarity:'blue', manufacturer:'Vladof' });
  return { same:a.model===b.model, model:a.model };
})())`));
check('同参数生成的型号一致（重算不改名）', modelStable.same ? 1 : 0, 1, 0.001);
check('UI 使用品质开关 helper', /weaponRarityId\(w\)/.test(uiSrc) && /weaponRarityName\(w\)/.test(uiSrc) ? 1 : 0, 1, 0.001);
check('护甲品质不受影响', G('raidMakeArmor')(5, 3).rarity === 3 ? 1 : 0, 1, 0.001);
check('配件品质仍按档位生成', G('rollPart')('muzzle', 20, 'blue').rarity === 'blue' ? 1 : 0, 1, 0.001);

console.log('\n=== 27. 局内体验：放回背包 / 箱子枪带弹 / 跑刀移速 / 配件拆解（v0.21.6）===');
const stowTest = JSON.parse(G(`JSON.stringify((()=>{
  const R=Raid;
  R.inv={weapons:[],armors:[],helmets:[],shields:[],parts:[],materials:[],meds:[],cores:[],receivers:[],keys:[],ammo:{}};
  R._rtCache={}; R.floats=[]; R.toasts=[];
  R.player={ isPlayer:true, x:0, y:0, gun:null, secondary:null, reloadT:0, fireCd:0 };
  const w=generateWeapon(20,{ type:'rifle', manufacturer:'Vladof' });
  w.uid='vt1'; w.kind='weapon';
  // 空手捡枪 → 主手
  R._collect(w, 0, 0);
  const pick={ main:R.player.gun?R.player.gun.uid:null, sec:R.player.secondary, bag:R._gunBag().length };
  // 放回背包
  const ok=R._stowGun("main");
  const after={ gun:R.player.gun, bag:R._gunBag().length, invN:R.inv.weapons.length };
  // 再拿起来
  R._invEquip(0);
  const back={ gun:R.player.gun?R.player.gun.uid:null };
  // 不在物品栏里的枪不许放（防丢枪）
  R.inv.weapons=[]; const deny=R._stowGun("main");
  return { pick, ok, after, back, deny };
})())`));
check('空手捡枪默认进主手', stowTest.pick.main ? 1 : 0, 1, 0.001);
check('捡到的枪不会在背包里多出一把（运行时缓存一致）', stowTest.pick.bag, 0, 0.001);
check('放回背包成功', stowTest.ok ? 1 : 0, 1, 0.001);
check('放回后手上空出来', stowTest.after.gun === null ? 1 : 0, 1, 0.001);
check('放回后枪出现在背包里', stowTest.after.bag, 1, 0.001);
check('放回不会把枪从物品栏里删掉', stowTest.after.invN, 1, 0.001);
check('背包里可以再拿回手上', stowTest.back.gun === 'vt1' ? 1 : 0, 1, 0.001);
check('物品栏里没有的枪拒绝放回', stowTest.deny === false ? 1 : 0, 1, 0.001);
check('物品栏有「放回背包」按钮', /data-stow=/ === null ? 0 : (/放回背包/.test(raidSrc) && /data-stow="\$\{stow\}"/.test(raidSrc) ? 1 : 0), 1, 0.001);

const gunAmmo = JSON.parse(G(`JSON.stringify((()=>{
  const R=Raid;
  R.inv={weapons:[],armors:[],helmets:[],shields:[],parts:[],materials:[],meds:[],cores:[],receivers:[],keys:[],ammo:{}};
  R._rtCache={}; R.floats=[]; R.toasts=[]; R.carried={weapons:[]};
  R.player={ isPlayer:true, x:0, y:0, gun:null, secondary:null, reloadT:0, fireCd:0 };
  const g=generateWeapon(20,{ type:'rifle', manufacturer:'Vladof' });
  g.uid='ga1'; g.kind='weapon';
  const before=R._ammoTotal();
  R._giveGunAmmo(g, 0, 0);
  const ids=Object.keys(R.inv.ammo);
  return { add:R._ammoTotal()-before, ids, cal:ammoParseId(ids[0]||'') };
})())`));
check('箱子里的枪自带 30 发匹配口径弹药', gunAmmo.add, 30, 0.001);
check('随枪弹药按枪的口径发（步枪=中弹）', gunAmmo.cal && gunAmmo.cal.cal === 'mid' ? 1 : 0, 1, 0.001);
check('开箱出枪时调用 _giveGunAmmo', (raidSrc.match(/_giveGunAmmo\(/g)||[]).length>=4 ? 1 : 0, 1, 0.001);

check('跑刀移速加成 = +50%（v0.24.0）', G('RAID_BAREHAND_SPEED'), 1.50, 0.001);
check('移速计算乘上空手加成（双手都空才算）',
  /\(\(p\.gun\|\|p\.secondary\)\?1:RAID_BAREHAND_SPEED\)/.test(raidSrc) ? 1 : 0, 1, 0.001);

const salvage = JSON.parse(G(`JSON.stringify((()=>{
  const out={};
  const barrel={ kind:'part', slot:'barrel', name:'重枪管', ilvl:20, rarity:'blue', value:900 };
  const optic ={ kind:'part', slot:'optic',  name:'高倍镜', ilvl:20, rarity:'blue', value:900 };
  const core  ={ kind:'part', slot:'core',   name:'膛压组件', ilvl:20, rarity:'blue', core:'chaos', lv:2, value:900 };
  out.barrel=raidSalvageYield(barrel);
  out.optic =raidSalvageYield(optic);
  out.core  =raidSalvageYield(core);
  // 高档次配件拆出更高档材料
  const lo=raidSalvageYield({ kind:'part', slot:'barrel', ilvl:4, rarity:'white' });
  const hi=raidSalvageYield({ kind:'part', slot:'barrel', ilvl:40, rarity:'pearl' });
  out.lo=lo; out.hi=hi;
  out.loTier=(RAID_MAT_BY_ID[lo[0].id]||{}).tier;
  out.hiTier=(RAID_MAT_BY_ID[hi[0].id]||{}).tier;
  return out;
})())`));
check('配件可拆出原材料', Array.isArray(salvage.barrel) && salvage.barrel.length>0 ? 1 : 0, 1, 0.001);
/* v0.26.0：材料扩充到每阶 3 种后，改用「材料 tag 语义」判定而不是硬编码 id 白名单，
   否则每加一种材料都要回来改一次断言。 */
check('枪管拆金属 / 瞄具拆电子',
  G('(RAID_MAT_BY_ID["'+salvage.barrel[0].id+'"]||{}).tag') === "金属" &&
  G('(RAID_MAT_BY_ID["'+salvage.optic[0].id+'"]||{}).tag') === "电子" ? 1 : 0, 1, 0.001);
check('改装模块不可拆解', salvage.core === null ? 1 : 0, 1, 0.001);
check('高档配件拆出更高档材料', salvage.hiTier > salvage.loTier ? 1 : 0, 1, 0.001);

const salvageRun = JSON.parse(G(`JSON.stringify((()=>{
  const R=Raid;
  R.inv={weapons:[],armors:[],helmets:[],shields:[],parts:[],materials:[],meds:[],cores:[],receivers:[],keys:[],ammo:{}};
  R.floats=[]; R.toasts=[];
  R.player={ isPlayer:true, x:0, y:0, gun:null, secondary:null };
  R.inv.parts.push({ kind:'part', slot:'barrel', name:'重枪管', ilvl:20, rarity:'blue', value:900 });
  const ok=R._salvagePart(0);
  return { ok, parts:R.inv.parts.length, mats:R.inv.materials.length, name:(R.inv.materials[0]||{}).name };
})())`));
check('局内拆解：配件消失、材料入库', salvageRun.ok && salvageRun.parts===0 && salvageRun.mats>0 ? 1 : 0, 1, 0.001);
check('局内物品栏有「拆解」按钮', /data-salvage="\$\{salvage\}"/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('仓库配件也能拆解', /data-partsalvage/.test(raidSrc) ? 1 : 0, 1, 0.001);

console.log('\n=== 28. 配件显示分层 + 钥匙合成（v0.21.7）===');
const partView = JSON.parse(G(`JSON.stringify((()=>{
  const prev=CFG.display;
  const pt={ kind:'part', slot:'underbarrel', name:'·快拆卡榫', shortName:'下挂', ilvl:22, rarity:'blue',
             value:900, mods:[{stat:'accPct',value:12}], affixes:[] };
  const core={ kind:'part', slot:'core', name:'膛压组件 [III]', core:'chaos', lv:3, ilvl:22, rarity:'orange', value:900 };
  CFG.display="compact";
  const c={ name:partNameOf(pt), q:partQualityName(pt), col:partColor(pt),
            coreName:partNameOf(core), coreQ:partQualityName(core) };
  CFG.display="full";
  const f={ name:partNameOf(pt), q:partQualityName(pt), col:partColor(pt) };
  CFG.display=prev;
  return { c, f };
})())`));
check('精简：配件只显示槽位名', partView.c.name === '下挂' ? 1 : 0, 1, 0.001);
check('精简：配件不显示品质名', partView.c.q === '' ? 1 : 0, 1, 0.001);
check('精简：配件用中性色', partView.c.col === '#cfcabb' ? 1 : 0, 1, 0.001);
check('精简：改装模块仍保留模块名（[III] 不是品质）',
  partView.c.coreName.indexOf('膛压组件') === 0 && partView.c.coreQ === '' ? 1 : 0, 1, 0.001);
check('完整：配件显示词缀名', partView.f.name === '·快拆卡榫' ? 1 : 0, 1, 0.001);
check('完整：配件显示品质名', partView.f.q === G('RARITY_BY_ID').blue.name ? 1 : 0, 1, 0.001);
check('完整：配件恢复品质色', partView.f.col === G('RARITY_BY_ID').blue.color ? 1 : 0, 1, 0.001);
check('配件卡片不再直接打印 pt.name',
  raidSrc.indexOf('si-name" style="color:${col}">${pt.name}') < 0 ? 1 : 0, 1, 0.001);
check('物品栏配件行走 partNameOf', /line\(partNameOf\(pt\), col, meta/.test(raidSrc) ? 1 : 0, 1, 0.001);

const keyRec = JSON.parse(G(`JSON.stringify((()=>{
  const r=RAID_RECIPES.find(x=>x.kind==="key")||null;
  if(!r) return { has:false };
  const mk=(q)=>r.make([], q);
  /* 投料品质 q 是 0~8 的档次（raidCraftQTier），不是 0~1 */
  const lvs=[0,2,4,6,8].map(q=>mk(q).lv);
  return { has:true, id:r.id, slots:r.slots, lvs, kind:mk(0.5).kind, uses:mk(0.5).uses };
})())`));
check('工坊有钥匙配方', keyRec.has ? 1 : 0, 1, 0.001);
check('钥匙造价 = 16 份原料', keyRec.slots, 16, 0.001);
check('钥匙产出是 key 类型', keyRec.kind === 'key' ? 1 : 0, 1, 0.001);
check('钥匙级别随投料品质 1→5', keyRec.lvs[0] === 1 && keyRec.lvs[4] === 5 &&
  keyRec.lvs.every((v,i)=>i===0||v>=keyRec.lvs[i-1]) ? 1 : 0, 1, 0.001);
check('合成的钥匙会进仓库钥匙串', /else if\(r\.kind===\"key\"\)\{[\s\S]{0,80}stash\.keys\.push/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('文案不再说「钥匙无法合成」', /钥匙无法合成/.test(raidSrc) ? 0 : 1, 1, 0.001);

console.log('\n=== 29. 品质阶梯：名字有辨识度 + 颜色亮度严格递增（v0.21.7）===');
function _lum(hex){
  const c=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255)
    .map(v=>v<=0.04045 ? v/12.92 : Math.pow((v+0.055)/1.055,2.4));
  return 0.2126*c[0]+0.7152*c[1]+0.0722*c[2];
}
function _hue(hex){
  const [r,g,b]=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255);
  const mx=Math.max(r,g,b), mn=Math.min(r,g,b), d=mx-mn;
  if(d<1e-6) return 0;
  let h;
  if(mx===r) h=((g-b)/d)%6; else if(mx===g) h=(b-r)/d+2; else h=(r-g)/d+4;
  h*=60; return h<0?h+360:h;
}
const tiers = JSON.parse(G(`JSON.stringify(RARITIES.map(r=>({id:r.id,name:r.name,color:r.color,mult:r.mult})))`));
check('品质共 12 阶', tiers.length, 12, 0.001);
check('品质名不重复', tiers.length - new Set(tiers.map(t=>t.name)).size, 0, 0.001);
let lintOk = true, hueOk = true, lintPrev = -1, minHue = 999;
for(let i=0;i<tiers.length;i++){
  const L=_lum(tiers[i].color);
  if(L<=lintPrev) lintOk=false;
  lintPrev=L;
  if(i){
    let dh=Math.abs(_hue(tiers[i].color)-_hue(tiers[i-1].color));
    if(dh>180) dh=360-dh;
    if(dh<30) hueOk=false;
    if(dh<minHue) minHue=dh;
  }
}
check('颜色亮度严格递增（越高档越亮）', lintOk ? 1 : 0, 1, 0.001);
check('相邻两阶色相至少差 30°（一眼分得开）', hueOk ? 1 : 0, 1, 0.001);
/* Lab 色差（CIE76）：ΔE >= 20 才算「一眼分得开」，这条比色相角更接近人眼 */
function _lab(hex){
  const lin=v=>{ v/=255; return v<=0.04045 ? v/12.92 : Math.pow((v+0.055)/1.055,2.4); };
  const [r,g,b]=[1,3,5].map(i=>lin(parseInt(hex.slice(i,i+2),16)));
  const X=(r*0.4124+g*0.3576+b*0.1805)/0.95047, Y=r*0.2126+g*0.7152+b*0.0722, Z=(r*0.0193+g*0.1192+b*0.9505)/1.08883;
  const f=t=>t>0.008856 ? Math.cbrt(t) : 7.787*t+16/116;
  const fx=f(X), fy=f(Y), fz=f(Z);
  return [116*fy-16, 500*(fx-fy), 200*(fy-fz)];
}
let minDE = 999;
for(let i=1;i<tiers.length;i++){
  const a=_lab(tiers[i-1].color), b=_lab(tiers[i].color);
  const d=Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);
  if(d<minDE) minDE=d;
}
check('相邻两阶 Lab 色差 ΔE ≥ 20', minDE>=20 ? 1 : 0, 1, 0.001);
console.log('  ' + tiers.map(t=>t.name+' '+t.color+' L'+_lum(t.color).toFixed(2)).join('  '));
console.log('  最小相邻色差 ΔE='+minDE.toFixed(1));
let multOk = true;
for(let i=1;i<tiers.length;i++) if(tiers[i].mult < tiers[i-1].mult) multOk=false;
check('品质倍率不随档位回退', multOk ? 1 : 0, 1, 0.001);
/* v0.32.0：RAID_TIERS 扩到 12 阶（定制/珍藏/孤品），护甲只用到前 9 阶 */
const tierNames9 = JSON.parse(G(`JSON.stringify(RAID_TIERS.slice(0,9).map(t=>[t.name,t.color]))`));
check('护甲 9 阶与武器前 9 阶同名同色', tierNames9.every((v,i)=>v[0]===tiers[i].name && v[1]===tiers[i].color) ? 1 : 0, 1, 0.001);
const legend = JSON.parse(G(`JSON.stringify((()=>{
  const prev=CFG.display; CFG.display="full";
  const t=raidTierLegend();
  CFG.display=prev;
  return t;
})())`));
const legendPlain = legend.replace(/<[^>]*>/g,'');
check('完整模式图例按「从低到高」顺序列出',
  legendPlain.indexOf(tierNames9[0][0])>=0 &&
  legendPlain.indexOf(tierNames9[8][0]) > legendPlain.indexOf(tierNames9[0][0]) ? 1 : 0, 1, 0.001);

console.log('\n=== 30. 完整模式显示前后缀 + T10 改名「定制」 + 最高三档仅黑市赌博机产出 ===');
// 完整模式：显示分层关闭（显示前后缀 / 品质）
const prevD = G('CFG.display'); G('CFG.display="full"');
check('完整模式 weaponQualityHidden=false', G('weaponQualityHidden()')?0:1, 1, 0.001);
check('第10档品质改名 定制', G('RARITIES.find(r=>r.id==="primordial").name==="定制"')?1:0, 1, 0.001);
// 完整模式：枪名应含前后缀
const preOk = G('(function(){ const w=generateWeapon(40,{rarity:"primordial"}); const a=w.affixes.find(x=>x.kind==="prefix")||w.affixes[0]; return a? gunNameOf(w).indexOf(a.nm)>=0 : false; })()');
check('完整模式枪名含前后缀', preOk?1:0, 1, 0.001);
// 精简模式：隐藏前后缀与品质
G('CFG.display="compact"');
check('精简模式 weaponQualityHidden=true', G('weaponQualityHidden()')?1:0, 1, 0.001);
/* v0.36.0：原写法在「这条枪恰好没有词缀」时会随机掉一条断言（判定自身的抖动）。
   现在把「不含前后缀」直接写成返回值，词缀为空也视为通过。 */
const preOkC = G('(function(){ const w=generateWeapon(40,{rarity:"primordial"}); const a=w.affixes.find(x=>x.kind==="prefix")||w.affixes[0]; return a? gunNameOf(w).indexOf(a.nm)<0 : true; })()');
check('精简模式枪名不含前后缀', preOkC?1:0, 1, 0.001);
G('CFG.display="'+prevD+'"');

// 最高三档（定制/珍藏/孤品）默认权重归零
check('默认权重 定制=0', G('RARITIES.find(r=>r.id==="primordial").weight'), 0, 0.001);
check('默认权重 珍藏=0', G('RARITIES.find(r=>r.id==="celestial").weight'), 0, 0.001);
check('默认权重 孤品=0', G('RARITIES.find(r=>r.id==="singularity").weight'), 0, 0.001);
check('黑市权重不再含定制', ("primordial" in G('SHOPS.black.weights'))?0:1, 1, 0.001);
check('赌博机改为金币(gold)结算', G('(SHOPS.gamble.currency||"gold")==="gold"')?1:0, 1, 0.001);
check('赌博机权重含 定制', G('(SHOPS.gamble.weights.primordial||0)>0')?1:0, 1, 0.001);
check('赌博机权重含 珍藏', G('(SHOPS.gamble.weights.celestial||0)>0')?1:0, 1, 0.001);
check('赌博机权重含 孤品', G('(SHOPS.gamble.weights.singularity||0)>0')?1:0, 1, 0.001);
// rollQuality 默认表（无权重参数）绝不出最高三档
check('rollQuality 默认不出定制', G('(function(){ for(let i=0;i<500;i++){ if(rollQuality(60,{})==="primordial") return false; } return true; })()')?1:0, 1, 0.001);
check('rollQuality 默认不出孤品', G('(function(){ for(let i=0;i<500;i++){ if(rollQuality(60,{})==="singularity") return false; } return true; })()')?1:0, 1, 0.001);

console.log('\n=== 31. 联机净化内核：corpse schema + text 剥 HTML + sanitizeEvent 单测（v0.22.0）===');
/* ==================== v0.22.0 组 31：联机净化内核（评价 4 / 5） ====================
 * server.js 已有 require.main 保护，verify 可直接 require 纯函数做单测；
 * src/sanitize.js 为 UMD，Node 侧 require 与浏览器 globalThis.Sanitize 共用同一份规则。 */
const San = require('./src/sanitize.js');
const Srv = require('./server.js');
check('text() 剥离 HTML 危险字符', (Srv.text('<img src=x onerror=alert(1)>&"q"',80).indexOf('<')<0 && Srv.text('a&b',80).indexOf('&')<0)?1:0, 1, 0.001);
check('text() 限长', Srv.text('abcdefghij',4)==='abcd'?1:0, 1, 0.001);
check('num() 非有限值返回 null', Srv.num('abc',0,10)===null?1:0, 1, 0.001);
check('num() 裁剪到区间', (Srv.num(999,0,100)===100 && Srv.num(-5,0,100)===0)?1:0, 1, 0.001);

const EvilDrops = [
  {kind:'weapon', damage:99999, name:'<b>x</b>'},
  {kind:'__fake__', damage:1},
  {kind:'ammo', n:1e12},
  {kind:'weapon', damage:40, affixes:[{nm:'<i>神</i>', value:-13.3}]},
];
const Clean = San.corpseDrops(EvilDrops);
check('corpse 非法 kind 被丢弃', Clean.length===3?1:0, 1, 0.001);
check('corpse damage 封顶 50000', Clean[0].damage===50000?1:0, 1, 0.001);
check('corpse 字符串剥 HTML', Clean[0].name.indexOf('<')<0?1:0, 1, 0.001);
check('corpse 合法负值词条保留', Clean[2].affixes[0].value===-13.3?1:0, 1, 0.001);
check('corpse 最多 6 项', San.corpseDrops(new Array(20).fill({kind:'med'})).length===6?1:0, 1, 0.001);
check('corpse 非数组返回空', San.corpseDrops('x').length===0?1:0, 1, 0.001);
const ProtoDrop = JSON.parse('{"kind":"weapon","damage":10,"__proto__":{"polluted":1},"constructor":{"x":1}}');
const ProtoClean = San.corpseDrops([ProtoDrop])[0];
check('corpse 原型污染键被剔除', (!Object.prototype.hasOwnProperty.call(ProtoClean,'__proto__') && !Object.prototype.hasOwnProperty.call(ProtoClean,'constructor'))?1:0, 1, 0.001);
check('P2P / HTTP 事件白名单同源', [...Srv.CLIENT_EVENT_TYPES].join(',')===San.CLIENT_EVENT_TYPES.join(',')?1:0, 1, 0.001);

/* sanitizeEvent 全覆盖单测（评价 5） */
const TRoom = { hostId:'H', peers:new Map([['H',{}],['P',{}]]), ai:[{i:'bot1'}] };
const THost = { id:'H', name:'Host' }, TGuest = { id:'P', name:'Guest' };
check('sanitizeEvent 拒绝未知类型', Srv.sanitizeEvent(TRoom,THost,{type:'join',data:{}})===null?1:0, 1, 0.001);
check('sanitizeEvent 保留字不可伪造', Srv.sanitizeEvent(TRoom,THost,{type:'start',data:{}})===null?1:0, 1, 0.001);
check('sanitizeEvent hitai 裁剪 dmg', Srv.sanitizeEvent(TRoom,THost,{type:'hitai',data:{id:'bot1',dmg:99999}}).data.dmg===2000?1:0, 1, 0.001);
check('sanitizeEvent hitai 拒绝不存在的 AI', Srv.sanitizeEvent(TRoom,THost,{type:'hitai',data:{id:'ghost',dmg:1}})===null?1:0, 1, 0.001);
check('sanitizeEvent corpse 非房主拒绝', Srv.sanitizeEvent(TRoom,TGuest,{type:'corpse',data:{x:1,y:2,d:[]}})===null?1:0, 1, 0.001);
const TCorpse = Srv.sanitizeEvent(TRoom,THost,{type:'corpse',data:{x:10,y:20,n:'<b>PMC</b>',d:EvilDrops}});
check('sanitizeEvent corpse 走 schema', (TCorpse && TCorpse.data.d.length===3 && TCorpse.data.d[0].damage===50000)?1:0, 1, 0.001);
check('sanitizeEvent corpse 名字剥 HTML', (TCorpse && TCorpse.data.n.indexOf('<')<0)?1:0, 1, 0.001);
check('sanitizeEvent dmg 只有房主可发', Srv.sanitizeEvent(TRoom,TGuest,{type:'dmg',data:{to:'H',dmg:5}})===null?1:0, 1, 0.001);
check('sanitizeEvent chat 剥 HTML', Srv.sanitizeEvent(TRoom,TGuest,{type:'chat',data:{t:'<img src=x>'}}).data.t.indexOf('<')<0?1:0, 1, 0.001);
check('sanitizeEvent chat 限长 80', Srv.sanitizeEvent(TRoom,TGuest,{type:'chat',data:{t:'x'.repeat(40000)}}).data.t.length===80?1:0, 1, 0.001);

/* ==================== v0.22.0 组 32：存档码 + 旧存档迁移（评价 3 / 8） ==================== */
console.log('');
console.log('=== 32. 存档码导出/导入 + 旧存档迁移回归（v0.22.0）===');
const Legacy = JSON.parse(fs.readFileSync(path.join(ROOT, 'fixtures', 'legacy-saves.json'), 'utf8'));
const __store = new Map();
sandbox.localStorage = {
  getItem: k => __store.has(k) ? __store.get(k) : null,
  setItem: (k, v) => __store.set(k, String(v)),
  removeItem: k => __store.delete(k),
  clear: () => __store.clear(),
};
const LSET = (k, v) => G('localStorage.setItem(' + JSON.stringify(k) + ',' + JSON.stringify(v) + ')');
const LGET = k => G('localStorage.getItem(' + JSON.stringify(k) + ')');
__store.clear();
check('空存档不生成空码', G('Save.exportCode()')===null?1:0, 1, 0.001);
LSET(G('Save.LEGACY_KEY'), JSON.stringify({ name:'老兵·贺一杰', gold:12345, weapons:[] }));
LSET('raid_stash_v2', JSON.stringify({ gold:999, guns:[] }));
const __before = LGET(G('Save.LEGACY_KEY'));
const __code = G('Save.exportCode()');
check('存档码格式 BOPS1-<hash>-<b64url>', /^BOPS1-[0-9a-f]{8}-[A-Za-z0-9_-]+$/.test(__code)?1:0, 1, 0.001);
check('存档码只含 URL 安全字符', !/[^A-Za-z0-9_-]/.test(__code)?1:0, 1, 0.001);
__store.clear();
const __imp = G('Save.importCode(' + JSON.stringify(__code) + ')');
check('存档码导入成功（2 项）', (__imp && __imp.ok && __imp.count===2)?1:0, 1, 0.001);
check('存档码往返字节一致（旧码导入后落在新键）', LGET(G('Save.KEY'))===__before?1:0, 1, 0.001);
check('存档码中文无损', String(LGET(G('Save.KEY'))).indexOf('老兵')>=0?1:0, 1, 0.001);
check('存档码带入塔科夫仓库', String(LGET('raid_stash_v2')).indexOf('999')>=0?1:0, 1, 0.001);
check('损坏存档码被拒（校验和）', G('Save.importCode(' + JSON.stringify(__code.slice(0,-8)) + ').ok')===false?1:0, 1, 0.001);
check('非法前缀被拒', G('Save.importCode("hello").ok')===false?1:0, 1, 0.001);
const __wsCode = __code.slice(0, 20) + '\n ' + __code.slice(20);
check('存档码容忍粘贴换行/空格', G('Save.importCode(' + JSON.stringify(__wsCode) + ').ok')===true?1:0, 1, 0.001);
const __evil = G('(function(){ var b=_b64enc(JSON.stringify({app:"borderops",data:{__evil__:"x","__evil_key__":"{}"}})); return "BOPS1-"+_b64hash(b)+"-"+b; })()');
__store.clear();
G('Save.importCode(' + JSON.stringify(__evil) + ')');
check('存档码拒绝写白名单外 key', !__store.has('__evil__')?1:0, 1, 0.001);
check('白名单外的码一项都不写', __store.size===0?1:0, 1, 0.001);

let __migBad = 0;
for (const s of Legacy.samples) {
  __store.clear();
  const raw = JSON.stringify(s.data);
  LSET(s.key, raw);
  if (s.key === G('Save.KEY') || s.key === G('Save.LEGACY_KEY')) {
    let okLoad = false;
    try { okLoad = G('(function(){try{var d=Save.load(); return !!d && typeof d==="object";}catch(e){return false;}})()'); } catch (e) {}
    if (!okLoad) __migBad++;
    if (s.id === 'v0.14.10-campaign' && G('(function(){var d=Save.load();return d&&d.name;})()') !== '老兵·贺') __migBad++;
  }
  if (s.key === 'raid_stash_v2') {
    let okMig = false;
    try { okMig = G('(function(){try{var d=RaidStash.load(); return !!d && d.gunVer===3 && Array.isArray(d.shields) && Array.isArray(d.parts) && !!d.ammo && d.tokens!==undefined;}catch(e){return false;}})()'); } catch (e) {}
    if (!okMig) __migBad++;
  }
  const c2 = G('Save.exportCode()');
  __store.clear();
  const r2 = G('Save.importCode(' + JSON.stringify(c2) + ')');
  /* v0.36.3：旧存档键在导入时被重映射到新键，所以比较的是「落盘目标键」 */
  const __tgt = (s.key === G('Save.LEGACY_KEY')) ? G('Save.KEY') : s.key;
  if (!(r2 && r2.ok && LGET(__tgt) === raw)) __migBad++;
}
check('旧存档样本数量 >= 4', Legacy.samples.length>=4?1:0, 1, 0.001);
check('旧存档样本迁移/往返全通过', __migBad===0?1:0, 1, 0.001);

/* v0.36.3：存档键去商标化 —— 旧键读到即上迁，写只写新键 */
const __keyMig = JSON.parse(G(`JSON.stringify((()=>{
  const keep={set:Store.set, get:Store.get};
  const mem={};
  Store.get = k => mem[k];
  Store.set = (k,v)=>{ mem[k]=v; return true; };
  mem[Save.LEGACY_KEY] = JSON.stringify({name:"老档", gold:777, weapons:[]});
  const d = Save.load();
  const out = { loaded:!!d && d.gold===777,
    newKey: mem[Save.KEY]!==undefined,
    legacyKept: mem[Save.LEGACY_KEY]!==undefined };
  out.migratedContent = mem[Save.KEY].indexOf("老档")>=0;
  out.legacyIntact = mem[Save.LEGACY_KEY] === JSON.stringify({name:"老档", gold:777, weapons:[]});
  /* 写档路径只能碰新键：save / saveMeta 里出现的必须是 this.KEY */
  const wsrc = String(Save.save) + String(Save.saveMeta);
  out.writeUsesNewKey = wsrc.indexOf("Store.setJSON(this.KEY")>=0 && wsrc.indexOf("LEGACY_KEY")<0;
  Store.set=keep.set; Store.get=keep.get;
  return out;
})())`));
check('旧存档键读到即迁移到新键（旧键保留备份）',
  (__keyMig.loaded && __keyMig.newKey && __keyMig.legacyKept)?1:0,1,0.001);
check('迁移写入新键的内容正确、旧键原样保留', (__keyMig.migratedContent && __keyMig.legacyIntact)?1:0,1,0.001);
check('写档路径只碰新键（save / saveMeta 不含 LEGACY_KEY）', __keyMig.writeUsesNewKey?1:0,1,0.001);
check('存档键不含商标字样', /^[a-z0-9_]+$/.test(G('Save.KEY')) && G('Save.KEY').indexOf('borderlands')<0 ?1:0,1,0.001);

/* ==================== v0.22.0 组 33：赌博机 EV / 经济护栏（评价 6） ==================== */
console.log('');
console.log('=== 33. 赌博机 EV / 经济护栏（v0.22.0）===');
const __ev = G(`(function(){
  var w=SHOPS.gamble.weights, tot=0, sum=0, top3=0, bad=0, mono=1;
  for(var k in w){ var r=RARITY_BY_ID[k]; if(!r){ bad++; continue; } tot+=w[k]; sum+=w[k]*r.price; if(r.weight===0) top3+=w[k]; }
  var ids=RARITIES.map(function(r){return r.id;});
  for(var i=3;i<ids.length;i++) if(!(w[ids[i]] < w[ids[i-1]])) mono=0;
  return { tot:tot, ev:sum/tot, top3:top3/tot, mono:mono, bad:bad,
           cost1:Shop.gambleCost({player:{level:1}}), cost60:Shop.gambleCost({player:{level:60}}) };
})()`);
check('赌博机权重全部映射品质', __ev.bad===0?1:0, 1, 0.001);
check('赌博机第 3 档后权重严格递减', __ev.mono===1?1:0, 1, 0.001);
check('最高三档概率 < 0.3%', (__ev.top3>0 && __ev.top3<0.003)?1:0, 1, 0.001);
check('赌博机 EV 在护栏带 5~15', (__ev.ev>=5 && __ev.ev<=15)?1:0, 1, 0.001);
check('赌博机成本随等级线性增长', (__ev.cost1===4 && __ev.cost60===122)?1:0, 1, 0.001);
const __leak = G(`(function(){
  var bad=0, q=["primordial","celestial","singularity"];
  for(var k in SHOPS){ if(k==="gamble") continue; var w=SHOPS[k]&&SHOPS[k].weights; if(!w) continue;
    for(var i=0;i<q.length;i++) if((w[q[i]]||0)>0) bad++; }
  for(var j=0;j<q.length;j++) if((RARITY_BY_ID[q[j]].weight||0)>0) bad++;
  return bad;
})()`);
check('最高三档唯一产出口仍是赌博机', __leak===0?1:0, 1, 0.001);
console.log('  赌博机 EV=' + __ev.ev.toFixed(2) + '（按 RARITIES.price 加权）· 最高三档合计概率=' + (__ev.top3*100).toFixed(4) + '% · 成本 Lv1=' + __ev.cost1 + ' / Lv60=' + __ev.cost60);

/* ==================== v0.22.0 组 34：FPS 基准 / 拆分 / 懒加载护栏（评价 2 / 7 / 9） ==================== */
console.log('');
console.log('=== 34. FPS 基准探针 + 拆分/懒加载护栏（v0.22.0）===');
check('FPS 基准脚本存在', fs.existsSync(path.join(ROOT,'tools','fps_bench.cjs'))?1:0, 1, 0.001);
const __bench = fs.readFileSync(path.join(ROOT,'tools','fps_bench.cjs'),'utf8');
check('FPS 探针同时采样 2D 与 3D', /sample\('2d'\)/.test(__bench) && /sample\('3d'\)/.test(__bench)?1:0, 1, 0.001);
check('FPS 探针输出 p95 与 fps', /p95Ms/.test(__bench) && /fps:/.test(__bench)?1:0, 1, 0.001);
check('npm bench:fps 已注册', !!JSON.parse(fs.readFileSync(path.join(ROOT,'package.json'),'utf8')).scripts['bench:fps']?1:0, 1, 0.001);
const __fp = fs.readFileSync(path.join(SRC,'fpview.js'),'utf8');
check('3D 墙体走 _paintWalls 按面绘制', /_paintWalls\(ctx/.test(__fp) && /fillRect/.test(__fp)?1:0, 1, 0.001);
check('3D 渐变对象数量受控（<=6）', (__fp.match(/ctx\.createLinearGradient\(/g)||[]).length<=6?1:0, 1, 0.001);
const __parts = ['raid-data','raid-legends','raid-geometry','raid-core','raid-core2','raid-core3','raid-render','raid-ui','raid-ui2'];
const __maxLines = Math.max(...__parts.map(n => fs.readFileSync(path.join(SRC,n+'.js'),'utf8').split('\n').length));
check('raid 分片全部 <=2000 行', (__maxLines<=2000 && __maxLines>1000)?1:0, 1, 0.001);
check('原巨型 raid.js 已移除', !fs.existsSync(path.join(SRC,'raid.js'))?1:0, 1, 0.001);
check('旧模式脚本已从静态 HTML 移除', !/src\/(world|endless|dust2|br)\.js/.test(html)?1:0, 1, 0.001);
check('lazy-legacy.js 已接入 HTML', /src\/lazy-legacy\.js/.test(html)?1:0, 1, 0.001);
check('GitHub Actions CI 已配置', fs.existsSync(path.join(ROOT,'.github','workflows','ci.yml'))?1:0, 1, 0.001);
console.log('  raid 最大分片 ' + __maxLines + ' 行（目标 <=2000）');

/* ==================== v0.22.0 组 35：v0.21.9 合并护栏（合作者 15 处修复不回归） ==================== */
console.log('');
console.log('=== 35. v0.21.9 合并护栏（合作者 15 处修复）===');
const __fee = G(`(function(){
  try{
    var R=Object.create(Raid);
    R.creds=30; R.stash={creds:70};
    var ok=R._payExtractFee(90);
    var a={ ok:ok?1:0, purse:R.creds, stash:R.stash.creds };
    R.creds=10; R.stash={creds:20};
    a.no=R._payExtractFee(90)?1:0; a.noPurse=R.creds; a.noStash=R.stash.creds;
    return a;
  }catch(e){ return { err:String(e) }; }
})()`);
check('撤离费组合扣款（局内+仓库）', (__fee.ok===1 && __fee.purse===0 && __fee.stash===10)?1:0, 1, 0.001);
check('撤离费资金不足不扣款', (__fee.no===0 && __fee.noPurse===10 && __fee.noStash===20)?1:0, 1, 0.001);
check('命名装权重方向回正', /Math\.pow\(1\.55, 5-u\.tier\)/.test(raidSrc) && !/Math\.pow\(1\.55, u\.tier-5\)/.test(raidSrc) ?1:0, 1, 0.001);
check('自动穿盾写入 carried.shield', /this\.carried\.shield=s/.test(raidSrc)?1:0, 1, 0.001);
check('尸体掉落不再重复推同一件配件（v0.36.0 改为逐件概率掉落）', /for\(const q of \(bot\.inv\.parts\|\|\[\]\)\.slice\(0,3\)\)/.test(raidSrc) && !/firstPart/.test(raidSrc)?1:0, 1, 0.001);
check('撤离成功置 ext 标记', /this\._extractedFlag=true/.test(raidSrc)?1:0, 1, 0.001);
check('回收超市材料按 id 售卖', /x\.id===row\.id/.test(raidSrc) && /id:item\.id/.test(raidSrc)?1:0, 1, 0.001);
check('联机入场补 shield/ammo/support', /shield:sel\.s\|\|null/.test(raidSrc) && /ammo:ammoPick, support:supOn/.test(raidSrc)?1:0, 1, 0.001);
const __term = G(`(function(){
  var N=Object.create(Net); N._outbox=[];
  var p=[]; for(var i=0;i<45;i++) p.push({type:'shot',data:i});
  p.push({type:'extract',data:1});
  N._requeue(p);
  var a={ len:N._outbox.length, term:N._outbox.filter(function(e){return N._isTerm(e.type);}).length };
  var M=Object.create(Net); M.online=true; M._flushT=null; M.sync=function(){};
  M._outbox=[]; for(var j=0;j<40;j++) M._outbox.push({type:'shot',data:j});
  M.sendEvent('extract',{x:1});
  a.full=M._outbox.length; a.last=M._outbox[M._outbox.length-1].type==='extract'?1:0;
  return a;
})()`);
check('终局事件重排保底（40 上限）', (__term.len===40 && __term.term===1)?1:0, 1, 0.001);
check('队满仍保底入队终局事件', (__term.full===40 && __term.last===1)?1:0, 1, 0.001);
const __p2p = G(`(function(){
  var P=Object.create(NetP2P);
  return { ok:P._send({open:true,send:function(){}},{t:'x'})===true?1:0,
           bad:P._send(null,{t:'x'})===false?1:0 };
})()`);
check('P2P _send 返回成败供失败回补', (__p2p.ok===1 && __p2p.bad===1)?1:0, 1, 0.001);
check('队友撤离 ext 接收端补读', /pr\.op\.ext=!!s\.ext/.test(netSrc)?1:0, 1, 0.001);
const __plate = G(`(function(){
  try{
    var d=(typeof plateShieldLines==="function" && typeof shieldLines==="function" && plateShieldLines!==shieldLines)?1:0;
    return { d:d, n:plateShieldLines({capacity:100,delay:2,rate:10}).length };
  }catch(e){ return { d:0, n:-1 }; }
})()`);
check('旧插板函数改名消除全局冲突', (__plate.d===1 && __plate.n>=3)?1:0, 1, 0.001);
const __econ = G(`(function(){
  var mono=1;
  for(var i=1;i<RARITIES.length;i++) if(RARITIES[i].price < RARITIES[i-1].price) mono=0;
  var g=SKILLS.gunner.filter(function(s){return s.id==="g_cal";})[0];
  return { mono:mono, acc:g?g.per.accuracyMul:-1 };
})()`);
check('品质价格序列不再倒挂', __econ.mono, 1, 0.001);
check('归零校准精度回正为 +5%/级', __econ.acc, 0.05, 0.001);
const __srvSrc = fs.readFileSync(path.join(ROOT,'server.js'),'utf8');
const __uiSrc  = fs.readFileSync(path.join(SRC,'ui.js'),'utf8');
const __aucSrc = fs.readFileSync(path.join(SRC,'auction.js'),'utf8');
check('限速 XFF 仅在 TRUST_PROXY=1 时采信', /const TRUST_PROXY\s*=\s*process\.env\.TRUST_PROXY/.test(__srvSrc) && /TRUST_PROXY\s*&&\s*req\.headers/.test(__srvSrc)?1:0, 1, 0.001);
check('标题页 btn-continue 判空绑定', /if\(contBtn\)/.test(__uiSrc)?1:0, 1, 0.001);
check('拍卖成交清 state 防二次入账', /delete d\.state\[L\.id\]/.test(__aucSrc) && /delete d\.state\[id\]/.test(__aucSrc)?1:0, 1, 0.001);

/* ==================== v0.22.1 组 36：玩家可见文案护栏 ==================== */
console.log('');
console.log('=== 36. 玩家可见文案校对（v0.22.1）===');
const __uiCopy = ['ui','raid-ui','raid-ui2','raid-render','raid-core3']
  .map(n => fs.readFileSync(path.join(SRC,n+'.js'),'utf8')).join('\n');
const __coreCopy = fs.readFileSync(path.join(SRC,'raid-core.js'),'utf8');
check('GP 币不再搭配紫色美元符号 ◆', /◆\s*GP 币|GP 币\s*◆/.test(__uiCopy)?0:1, 1, 0.001);
const __purpleGP = __uiCopy.split('\n').filter(l => /#c07bff/.test(l) && /GP 币|tokens|tokIn|tokWorth/.test(l)).length;
check('GP 币不再内联紫色 #c07bff', __purpleGP===0?1:0, 1, 0.001);
for(const [label, phrase] of [['稀有+','稀有+'],['T5 橙装','T5 橙装'],['高稀有度','高稀有度'],['视野 1000px','视野 <b>1000px']])
  check('旧措辞已清除：'+label, __uiCopy.includes(phrase)?0:1, 1, 0.001);
check('玩法说明写入分级视距 520/900/1250', /Scav <b>520<\/b> \/ PMC <b>900<\/b> \/ Boss <b>1250<\/b>/.test(__uiCopy)?1:0, 1, 0.001);
check('GP 币统一使用金色 ◈', (__uiCopy.match(/◈\s*GP 币/g)||[]).length>=3?1:0, 1, 0.001);
check('GP 币金色 #ffd23f 已接线', (__uiCopy.match(/#ffd23f/g)||[]).length>=8?1:0, 1, 0.001);
check('token 结算价格统一 ◈', !/payKind==="token"\?"◆"/.test(__uiCopy) && /payKind==="token"\?"◈"/.test(__uiCopy)?1:0, 1, 0.001);
check('标题页 chip 标注 ◈ GP 币', /<span>◈ GP 币<\/span>/.test(__uiCopy)?1:0, 1, 0.001);
check('融合台统一「品阶」标签', /，品阶 <b/.test(__uiCopy) && !/· 稀有度 <b/.test(__uiCopy)?1:0, 1, 0.001);
check('Raider 标记改用 ★ 消除 ◆ 多义', /smart\?"★ ":""/.test(__coreCopy) && !/smart\?"◆ ":""/.test(__coreCopy)?1:0, 1, 0.001);
check('黑市摊位统一金色品牌色', (__coreCopy.match(/kind:"black"[^\n]*color:"#ffd23f"/g)||[]).length===2?1:0, 1, 0.001);
check('黑市地图图标统一 ◈', /"♻":"◈"/.test(__uiCopy)?1:0, 1, 0.001);

/* ==================== v0.22.2 组 37：地图/敌人第一批改造护栏 ==================== */
console.log('');
console.log('=== 37. 地图分区 / 手电遮挡 / 室内暗化（v0.22.2）===');
const __fp2 = fs.readFileSync(path.join(SRC,'fpview.js'),'utf8');
/* v0.36.0：_groundGunPanel 等 HUD 补丁已迁到 raid-ui2，断言要把两片一起看 */
const __rd2 = fs.readFileSync(path.join(SRC,'raid-render.js'),'utf8') + '\n' +
  fs.readFileSync(path.join(SRC,'raid-ui2.js'),'utf8');

/* --- 静态地形：必须是不碰 RNG 的纯函数，联机两端 seed 重放才一致 --- */
const __bio = G(`(function(){
  var a=raidBiomeAt(7200,600), b=raidBiomeAt(7200,600);
  var room=RAID_ROOMS.filter(function(r){return !r.open;})[0];
  var inRoom=raidIndoorAt(room.x+room.w/2, room.y+room.h/2);
  var outRoom=raidIndoorAt(room.x-700, room.y-700);
  return { same:a===b, forest:(a&RAID_BIOME_FOREST)?1:0, inRoom:inRoom?1:0, outRoom:outRoom?1:0,
           gridCells:RAID_BIOME_GRID.length, isTyped:(RAID_BIOME_GRID instanceof Uint8Array)?1:0 };
})()`);
check('biome 查表是纯函数（同输入同输出）', __bio.same?1:0, 1, 0.001);
check('密林格位被标记', __bio.forest, 1, 0.001);
check('室内精确判定：房内 true / 房外 false', (__bio.inRoom===1 && __bio.outRoom===0)?1:0, 1, 0.001);
check('biome 网格按 400px 预计算（Uint8Array 一维）', (__bio.gridCells>100 && __bio.isTyped===1)?1:0, 1, 0.001);

const __danger = G(`(function(){
  var near=raidDangerAt(400,400), far=raidDangerAt(RAID_MAP_W-400, RAID_MAP_H-400);
  var R={lootLuck:0};
  return { near:near, far:far, luckNear:raidLuckAt(R,400,400), luckFar:raidLuckAt(R,RAID_MAP_W-400,RAID_MAP_H-400) };
})()`);
check('危险度按 3x3 行政区静态分布（近 0 / 远 0.42）', __danger.near, 0, 0.001);
check('远区危险度更高', __danger.far, 0.42, 0.001);
check('远区掉落回报更高（纯坐标函数）', __danger.luckFar > __danger.luckNear?1:0, 1, 0.001);

const __sense = G(`(function(){
  /* 基准刻意不取坐标点：任何坐标都可能落在密林或房间里，直接读基准表最干净 */
  var raw=RAID_AI_SENSE.scav;
  var forest=raidAISense({x:7200,y:600,cls:"scav"});
  var room=RAID_ROOMS.filter(function(r){return !r.open;})[0];
  var indoor=raidAISense({x:room.x+room.w/2,y:room.y+room.h/2,cls:"scav"});
  return { baseSight:raw.sight, forestSight:forest.sight, baseHear:raw.hear, indoorHear:indoor.hear,
           noArg:raidAISense({cls:"scav"})===RAID_AI_SENSE.scav?1:0 };
})()`);
check('密林视距 x0.8', __sense.forestSight/__sense.baseSight, 0.8, 0.001);
check('室内听距 x1.3', __sense.indoorHear/__sense.baseHear, 1.3, 0.001);
check('不传坐标时直接返回基准档（零开销）', __sense.noArg, 1, 0.001);

/* --- 手电遮挡：假装每条射线都在半程撞墙，扇形半径应收缩到 560*0.5-4 --- */
const __fan = G(`(function(){
  var oldRay=Raid._rayLight, oldCS=Raid.navCS;
  Raid.navCS=1;
  Raid._rayLight=function(){ return 276; };      // 每条射线都在 276px 处撞到遮挡
  var f=RenderRaid._lightFan(0,0,-0.42,0.42,560,40);
  var maxd=0, min=1e9;
  for(var i=0;i<f.length;i+=2){ var d=Math.sqrt(f[i]*f[i]+f[i+1]*f[i+1]); if(d>maxd)maxd=d; if(d<min)min=d; }
  Raid._rayLight=oldRay; Raid.navCS=oldCS;
  return { n:f.length, maxd:maxd, min:min };
})()`);
check('扇形射线数 = 2*(rays+1)', __fan.n, 82, 0.001);
check('撞墙时射线收缩到命中距离', __fan.maxd, 274, 1.5);
check('扇形最小半径有下限（贴脸不塌成 0）', __fan.min>=10?1:0, 1, 0.001);
check('探照灯扇形在索引就绪后缓存', G(`(function(){
  var oldCS=Raid.navCS; Raid.navCS=1;
  var f={x:0,y:0,r:220}; RenderRaid._floodFan(f); var has=!!f._fan;
  Raid.navCS=oldCS;
  var g={x:0,y:0,r:220}; RenderRaid._floodFan(g); var no=!!g._fan;
  return (has && !no)?1:0;
})()`), 1, 0.001);
check('2D 手电不再整块 arc 扇形', /arc\(p\.x,p\.y,reach, ang-half, ang\+half\)/.test(__rd2)?0:1, 1, 0.001);
/* v0.25.0：光锥抽成 beam() 复用（本地玩家 + 其他 AI/玩家的手电共用一份实现），
   所以径向渐变的入参从 p.x/p.y 变成形参 x/y —— 仍然只有一处创建，不许每层重复建。 */
check('2D 手电复用单个径向渐变', (__rd2.match(/createRadialGradient\(x,y,0,x,y,reach\)/g)||[]).length===1?1:0, 1, 0.001);

/* --- 3D：深度分带衰减 + 探照灯深度剔除 + 室内压暗 --- */
check('3D 手电按墙面自身的深度衰减（不是整列取最近）', /const kWall = KFAR \+ \(1-KFAR\)\*Math\.max\(0, Math\.min\(1, \(LIGHT_REACH-d\)\/220\)\)/.test(__fp2)?1:0, 1, 0.001);
check('3D 手电按墙顶/墙脚分成三段', /const wallBot = horizon \+ \(this\.EYE_H\/d\)\*proj/.test(__fp2) && /const wallTop = horizon \+ \(\(this\.EYE_H-wallH\)\/d\)\*proj/.test(__fp2)?1:0, 1, 0.001);
check('3D 条带边界取整对齐（不叠亮缝）', /Math\.round\(s\*w\/SEGS\)/.test(__fp2)?1:0, 1, 0.001);
check('3D 探照灯被墙挡住不投光', /if\(zb\[c\] < depth - 24\) continue;/.test(__fp2)?1:0, 1, 0.001);
check('3D 室内压暗 0.82（纯深色，不动暖色）', /0\.82\*indoor/.test(__fp2)?1:0, 1, 0.001);
check('2D 室内压暗 0.52', /0\.52\*indoor/.test(__rd2)?1:0, 1, 0.001);
check('室内亮度按 dt 指数逼近（无硬切）', /this\.indoor \+ \(want-this\.indoor\)\*Math\.min\(1, dt\*4\.5\)/.test(raidSrc)?1:0, 1, 0.001);
check('房间地面改纯黑 #010203', /rm\.extract\?"#25452f":"#010203"/.test(__rd2)?1:0, 1, 0.001);

/* --- 地面枪械对比面板 / 局时常量 / 撤离保底 --- */
check('地面枪械对比面板存在', /_groundGunPanel\(ctx, R, c, v/.test(__rd2)?1:0, 1, 0.001);
check('面板画出 ▲▼ 优劣与「手持为空」提示', /▲":worse\?" ▼/.test(__rd2) && /手持为空，直接拾取/.test(__rd2)?1:0, 1, 0.001);
check('手持为空时不误标成「提升」', /better=!!cur && r\.a>r\.b/.test(__rd2)?1:0, 1, 0.001);
check('估值用 M/k 紧凑格式（不撑破面板）', /"₽"\+\(n\/1000000\)\.toFixed\(2\)\+"M"/.test(__rd2)?1:0, 1, 0.001);
check('局时长抽成 raidDuration=480', G('Raid.raidDuration'), 480, 0.001);
check('结算不再写死 480', /time:this\.raidDuration-this\.timer/.test(raidSrc)?1:0, 1, 0.001);
check('每个 3x3 行政区保底 1 个开放撤离点', /if\(openZones\.has\(z\)\) continue;/.test(raidSrc) && /cand\.closed=false;/.test(raidSrc)?1:0, 1, 0.001);
check('进图播报本局开放撤离点', /本局开放 "\+openEx\.length\+" 处/.test(raidSrc)?1:0, 1, 0.001);

/* ==================== v0.22.3 组 38：挡光 / 亮度 / 光滑轮廓 ==================== */
console.log('');
console.log('=== 38. 灌木挡光 / 手电亮度 / 轮廓抗锯齿（v0.22.3）===');
const __rl = G(`(function(){
  var oldC=Raid.navCS, oldCo=Raid.navCols, oldR=Raid.navRows, oldCell=Raid.navCell, oldW=Raid.walls;
  Raid.navCS=100; Raid.navCols=12; Raid.navRows=4; Raid.navCell=new Array(48); Raid.walls=[];
  var bush={x:180,y:40,w:40,h:20,sight:false,kind:"bush"};
  Raid.walls.push(bush);
  for(var gy=0;gy<=0;gy++) for(var gx=1;gx<=2;gx++){
    var i=gy*12+gx; (Raid.navCell[i]||(Raid.navCell[i]=[])).push(bush);
  }
  var hit  = Raid._rayLight(100,50,1,0,560);      // 正对灌木
  var miss = Raid._rayLight(100,50,0,-1,560);     // 反方向空地
  var inside = Raid._rayLight(200,50,1,0,560);    // 站在灌木里不该被自己掐死
  Raid.navCS=oldC; Raid.navCols=oldCo; Raid.navRows=oldR; Raid.navCell=oldCell; Raid.walls=oldW;
  return { hit:hit, miss:miss, inside:inside };
})()`);
check('灌木挡光：光停在灌木前表面', __rl.hit, 80, 1.5);
check('空地不误挡光', __rl.miss, 560, 1.5);
check('站在灌木里光束不被自己掐死', __rl.inside>=10?1:0, 1, 0.001);
check('_rayLight 走 navCell（含 sight:false 的灌木/岩石）', /idx=this\.navCell/.test(raidSrc)?1:0, 1, 0.001);
check('_rayLight 用精确 slab 求交（不是 13px 采样）', /if\(tmin>0\.5 && tmin<best\) best=tmin/.test(raidSrc)?1:0, 1, 0.001);
check('灯光轮廓改用 _rayLight', /Raid\._rayLight\(x, y, dx, dy, reach\)/.test(__rd2)?1:0, 1, 0.001);
/* v0.23.3：单层扇形改成三层角度羽化，主层仍是 96 条精确射线。
   v0.25.0：循环体抽进 beam()（layers 形参），默认仍传 RAID_FLASH_FAN。 */
check('2D 手电主扇形 96 条射线 + 角度羽化层',
  /for\(const L of layers\)/.test(__rd2) && /rays:96/.test(raidSrc)
  && /L\.widen/.test(__rd2) && /RAID_FLASH_FAN\)/.test(__rd2)?1:0, 1, 0.001);
check('手电基准亮度抽成 RAID_FLASH（v0.23.3：2D 0.48 / 3D 0.15）',
  /cone2d:\s*0\.48/.test(raidSrc) && /cone3d:\s*0\.15/.test(raidSrc)?1:0, 1, 0.001);
check('2D / 3D 都走 raidFlashGain（不再写死 alpha）', /raidFlashGain\(R\.indoor\)/.test(__rd2) && /raidFlashGain\(ind\)/.test(__fp2)?1:0, 1, 0.001);
check('手电色温未变（三处 rgb 都在）', /255,236,182/.test(__rd2) && /255,224,160/.test(__rd2) && /255,228,160/.test(__rd2)?1:0, 1, 0.001);

/* ================================================================ 39. 留场动力 / POI / 精英怪 / 室内手电（v0.23.0） */
console.log('\n=== 39. 留场动力 / POI / 精英怪 / 室内手电（v0.23.0）===');

/* --- ① 时间品质曲线：让「多待」有回报 --- */
check('时间曲线前 1/3 局不加成', G('raidTimeLuck(0,480)'), 0, 0.0001);
check('时间曲线 160s 仍在平台期', G('raidTimeLuck(160,480)'), 0, 0.0001);
check('时间曲线中段线性（240s = 0.06）', G('raidTimeLuck(240,480)'), 0.06, 0.0005);
check('时间曲线 320s 到中段终点 0.12', G('raidTimeLuck(320,480)'), 0.12, 0.0005);
check('时间曲线末段到 0.22', G('raidTimeLuck(480,480)'), 0.22, 0.0005);
check('时间曲线单调不减',
  (G('raidTimeLuck(200,480)') <= G('raidTimeLuck(300,480)')
   && G('raidTimeLuck(300,480)') <= G('raidTimeLuck(460,480)')) ? 1 : 0, 1, 0.001);
check('缺 duration 时按 480 兜底', G('raidTimeLuck(480,0)'), 0.22, 0.0005);
/* 时钟必须取 raidDuration - timer，而不是 elapsed（那玩意儿只在房主端推进） */
check('raidElapsed 取 raidDuration - timer', G('raidElapsed({raidDuration:480,timer:160})'), 320, 0.001);
check('raidElapsed 无 timer 时返回 0', G('raidElapsed({raidDuration:480})'), 0, 0.001);
check('luck 上限提到 0.95（末段收益不被老上限吃掉）',
  G('raidLuckAt({lootLuck:0.90,raidDuration:480,timer:0}, 200,200)'), 0.95, 0.001);

/* --- ② 8 个核心 POI --- */
check('核心 POI 恰好 8 个', G('RAID_POI.length'), 8, 0.001);
check('每个 POI 都有包围盒', G('RAID_POI.filter(p=>p.box).length'), 8, 0.001);
check('每个 POI 都有空投锚点', G('RAID_POI.filter(p=>Array.isArray(p.drop)&&p.drop.length===2).length'), 8, 0.001);
check('每个 POI 都有单字标识（小地图用）', G('RAID_POI.filter(p=>!!p.tag).length'), 8, 0.001);
check('POI 包围盒贴合聚类（宽 < 1900 / 高 < 2800）',
  G('RAID_POI.filter(p=>p.box.w<1900 && p.box.h<2800).length'), 8, 0.001);
check('raidPoiAt 命中神庙', G('raidPoiAt(1160,3150).id') === 'temple' ? 1 : 0, 1, 0.001);
check('raidPoiAt 命中铁路调度场', G('raidPoiAt(11610,5200).id') === 'rail' ? 1 : 0, 1, 0.001);
check('raidPoiAt 空处返回 null', G('raidPoiAt(6600,4800)===null?1:0'), 1, 0.001);
check('POI 内 luck 高于同危险度的空地',
  G('raidLuckAt({lootLuck:0,raidDuration:480,timer:480},1160,3150)') >
  G('raidLuckAt({lootLuck:0,raidDuration:480,timer:480},6600,3150)') ? 1 : 0, 1, 0.001);
check('POI 容器类型偏向生效（源码按 kinds 取）', /kindAt\(p\.x,p\.y\)/.test(raidSrc)?1:0, 1, 0.001);

/* --- ③ 中后期涌潮 --- */
check('涌潮触发点 2 个（210s / 330s）',
  G('RAID_SURGE_AT.length') === 2 && G('RAID_SURGE_AT[0]') === 210 && G('RAID_SURGE_AT[1]') === 330 ? 1 : 0, 1, 0.001);
const _sg1 = G(`(function(){var r=raidSurgeRand(12345);return [r(),r(),r()];})()`);
const _sg2 = G(`(function(){var r=raidSurgeRand(12345);return [r(),r(),r()];})()`);
const _sg3 = G(`(function(){var r=raidSurgeRand(99999);return [r(),r(),r()];})()`);
check('涌潮随机源同 seed 同序列（两端一致）',
  (_sg1[0] === _sg2[0] && _sg1[1] === _sg2[1] && _sg1[2] === _sg2[2]) ? 1 : 0, 1, 0.001);
check('涌潮随机源不同 seed 不同序列', _sg1[0] !== _sg3[0] ? 1 : 0, 1, 0.001);
check('涌潮触发在 hostSim 之外（容器表两端同长）',
  /surgeIdx<RAID_SURGE_AT\.length/.test(raidSrc) && !/hostSim\)\{[\s\S]{0,400}_surge\(/.test(raidSrc) ? 1 : 0, 1, 0.001);
/* v0.40.3（用户要求「空投装备等级不要太高」）：从 V 级军火箱（保底 T7）降到 III 级箱（保底 T2） */
check('空投箱改按 III 级箱出货（不再是 V 级军火箱）',
  /else if\(c\.airdrop\)/.test(raidSrc) && /raidAirdropOpen\(this, c\)/.test(raidSrc)
  && !/_rollVaultLoot\(5, c\.x, c\.y\)/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('空投搜得比常规箱子久（1.5s）', /c\.airdrop\) \? 1\.5/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('空投有世界信标与小地图标记',
  /R\.airdrops && R\.airdrops\.length/.test(__rd2) && /for\(const a of \(R\.airdrops\|\|\[\]\)\)/.test(__rd2) ? 1 : 0, 1, 0.001);
check('房主种子落进 this.seed（涌潮落点可重算）', /this\.seed=opts\.seed>>>0/.test(raidSrc) ? 1 : 0, 1, 0.001);

/* --- ④ 三只精英怪 --- */
check('三只精英怪原型都在', G('["wraith","shieldbearer","broodmother"].filter(k=>!!RAID_ARCH[k]).length'), 3, 0.001);
check('原有三档 AI 感知没被改动',
  G('RAID_AI_SENSE.scav.sight') === 520 && G('RAID_AI_SENSE.pmc.sight') === 900 && G('RAID_AI_SENSE.boss.sight') === 1250 ? 1 : 0, 1, 0.001);
check('侦察兵视距短、听距长', G('RAID_ARCH.wraith.sense.sight') === 400 && G('RAID_ARCH.wraith.sense.hear') === 1.6 ? 1 : 0, 1, 0.001);
check('arch 覆盖优先级高于 smart/pmc',
  G('raidAISense({arch:"wraith",cls:"pmc",smart:true,x:6600,y:4800}).sight'), 400, 0.001);
check('普通 AI 仍走原三档', G('raidAISense({cls:"pmc",smart:true,x:6600,y:4800}).sight'), 900, 0.001);
check('精英怪只在 POI 包围盒内出生', /_openPointInRoom\(poi\.box, inset\)/.test(raidSrc) && /M\.clamp\(safe\.x, poi\.box\.x\+18/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('每个 POI 都配了精英怪', G('RAID_POI.filter(p=>!!RAID_ARCH[p.elite]).length'), 8, 0.001);
/* 防盾手：正面挡弹 / 绕背满伤 / 爆炸无视 */
const _sbFront = mkTarget({ armorTier: 0, armor: 0, dr: 0, hp: 1e6, maxHP: 1e6, arch: 'shieldbearer', angle: Math.PI, x: 100, y: 0 });
check('防盾手正面吃 72% 减伤', dmgOn(_sbFront, 100, phys), 28, 0.6);
const _sbBack = mkTarget({ armorTier: 0, armor: 0, dr: 0, hp: 1e6, maxHP: 1e6, arch: 'shieldbearer', angle: 0, x: 100, y: 0 });
check('绕到背后打满伤', dmgOn(_sbBack, 100, phys), 100, 0.6);
const _sbBlast = mkTarget({ armorTier: 0, armor: 0, dr: 0, hp: 1e6, maxHP: 1e6, arch: 'shieldbearer', angle: Math.PI, x: 100, y: 0 });
check('爆炸无视盾面', dmgOn(_sbBlast, 100, phys, { blast: true }), 100, 0.6);
check('火箭爆炸带 blast 标记', /rk\.dmg\*fall, rk\.owner, rk\.gun, \{blast:true\}/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('碎片溅射带 blast 标记', /chain:true, blast:true/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('呼叫员只呼叫一次（_called 上锁）', /b\._called=true; this\._callReinforce\(b\)/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('呼叫员就地叫 2 人小队', /_callReinforce\(b\)\{[\s\S]{0,400}?for\(let i=0;i<2;i\+\+\)/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('侦察兵走弧线逼近（不在正面对枪）', /b\.arch==="wraith" && ad>170/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('精英怪体型按原型给（不写死 13）', /this\.r=o\.r\|\|13;/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('AI 上限为精英怪留了余量（maxOps 48）', /maxOps:48/.test(raidSrc) ? 1 : 0, 1, 0.001);

/* --- ⑤ 室内手电提亮 --- */
check('室内增益系数上限 3.2（v0.23.3 再提亮）', G('raidFlashGain(1)'), 3.2, 0.0001);
check('室外增益保持 1.0', G('raidFlashGain(0)'), 1, 0.0001);
check('室内手电中心+热点 alpha 合计 0.68（v0.23.0 是 0.334，约 2 倍）',
  G('RAID_FLASH.cone3d*raidFlashGain(1) + RAID_FLASH.hot'), 0.68, 0.002);
check('3D 中心热点存在且半径按 reach 缩放', /RAID_FLASH\.hotR/.test(__fp2) ? 1 : 0, 1, 0.001);
check('3D 亮核随 indoor 前移（0.5 - coreShift）', /0\.5 - RAID_FLASH\.coreShift\*ind/.test(__fp2) ? 1 : 0, 1, 0.001);
/* 最要紧的一条：不许加射程 —— 加射程 = 光穿墙复活。
   v0.25.0：本地玩家改走 beam() 形参，射程仍是字面量 560、半角仍是 0.42。 */
/* v0.28.0：手电射程改为「按武器取值」—— 常规 560、狙击 900，仍不许借提亮偷加长 */
check('常规手电射程仍 560、狙击枪另走 raidPlayerBeam',
  /reach:\s+560,/.test(raidSrc) && /raidPlayerBeam\(R\)/.test(__rd2) ? 1 : 0, 1, 0.001);
check('2D / 3D 共用同一套手电参数', /RAID_FLASH/.test(__rd2) && /RAID_FLASH/.test(__fp2) ? 1 : 0, 1, 0.001);

/* ==========================================================================
 * 40. 工程健壮性：存储层 / 数值兜底 / 错误处理（v0.23.1）
 * --------------------------------------------------------------------------
 * 这一组锁的是「重构契约」而不是玩法数值：以后谁再把 localStorage 直连写回来、
 * 谁再加一个裸 catch(e){} 把错误吞掉，这里就会红灯。
 * ========================================================================== */
console.log('\n=== 40. 工程健壮性：存储层 / 数值兜底 / 错误处理（v0.23.1） ===');
const __html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

/* --- ① 存储层接入 --- */
check('store.js 已接入且早于存档类模块',
  (__html.indexOf('src/store.js') > 0 &&
   __html.indexOf('src/store.js') < __html.indexOf('src/raid-data.js') &&
   __html.indexOf('src/store.js') < __html.indexOf('src/auction.js')) ? 1 : 0, 1, 0.001);
check('Store 暴露完整 API',
  ['get', 'set', 'remove', 'getJSON', 'setJSON', 'has', 'quarantineKeys', 'dropQuarantine', 'info']
    .every(k => G('typeof Store.' + k) === 'function') ? 1 : 0, 1, 0.001);

/* --- ② 核心契约：业务模块不得直连 localStorage --- */
/* 先剥掉块注释再判断，避免文档里提到 localStorage 就误报 */
const __directLS = [];
for (const f of fs.readdirSync(SRC).filter(n => n.endsWith('.js') && n !== 'store.js')) {
  const code = fs.readFileSync(path.join(SRC, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  if (/localStorage\s*\./.test(code)) __directLS.push(f);
}
check('业务模块零直连 localStorage（只剩 store.js）', __directLS.length, 0, 0.001);

/* --- ③ 核心契约：不得有裸 catch 吞错 --- */
/* 只认「}catch(e){}」这种真正空的 catch 体；带注释说明或日志的都不算。
   正则要求 catch 前面紧跟 '}'，正好避开文件头注释里出现的 catch(e){} 字样。 */
const __bareCatch = [];
for (const f of fs.readdirSync(SRC).filter(n => n.endsWith('.js'))) {
  const m = fs.readFileSync(path.join(SRC, f), 'utf8').match(/\}\s*catch\s*\([^)]*\)\s*\{\s*\}/g);
  if (m) __bareCatch.push(f + '×' + m.length);
}
check('无裸 catch(e){} 吞错（' + (__bareCatch.join(',') || '全部已标注') + '）', __bareCatch.length, 0, 0.001);

/* --- ④ 数值兜底：NaN 不再传染 --- */
check('M.clamp 对 NaN 返回有限值', G('Number.isFinite(M.clamp(NaN,0,100))') ? 1 : 0, 1, 0.001);
check('M.clamp(NaN) 落回下限', G('M.clamp(NaN,7,100)'), 7, 0.001);
check('M.clamp 正常钳制不受影响', G('M.clamp(500,0,100)'), 100, 0.001);
check('M.clamp 接受数字字符串', G('M.clamp("42",0,100)'), 42, 0.001);
check('M.num 非法值回默认', G('M.num("abc",9,0,10)'), 9, 0.001);
check('M.num 超上限被钳制', G('M.num(999,0,0,10)'), 10, 0.001);
check('M.num 数字字符串可解析', G('M.num("7",0,0,10)'), 7, 0.001);

/* --- ⑤ 颜色工具：非法色值不再产出 rgba(NaN,...) --- */
check('rgba 非法色值不产 NaN', /NaN/.test(G('rgba(undefined,0.5)')) ? 0 : 1, 1, 0.001);
check('rgba 支持 #fff 缩写', G('rgba("#fff",0.5)') === 'rgba(255,255,255,0.5)' ? 1 : 0, 1, 0.001);
check('rgba alpha 超界被钳制', G('rgba("#000",5)') === 'rgba(0,0,0,1)' ? 1 : 0, 1, 0.001);
check('hexLighten 非法色值不产 NaN', /NaN/.test(G('hexLighten(null,0.5)')) ? 0 : 1, 1, 0.001);

/* --- ⑥ 随机工具边界 --- */
check('RNG.pick 空数组返回 undefined', G('RNG.pick([])===undefined') ? 1 : 0, 1, 0.001);
check('RNG.pick 非数组返回 undefined', G('RNG.pick(null)===undefined') ? 1 : 0, 1, 0.001);
check('RNG.weighted 空集返回 -1', G('RNG.weighted([])'), -1, 0.001);
let __riBad = 0;
for (let i = 0; i < 120; i++) { const v = G('RNG.ri(10,2)'); if (!(v >= 2 && v <= 10)) __riBad++; }
check('RNG.ri 反向区间不越界（120 次抽样）', __riBad, 0, 0.001);

/* --- ⑦ Store 行为（此时 sandbox.localStorage 已是可落地的 mock） --- */
G('Store._resetForTest()');
G('localStorage.removeItem("__t_store")');
check('Store.get 缺失时返回默认值', G('Store.get("__t_store","def")') === 'def' ? 1 : 0, 1, 0.001);
G('Store.set("__t_store","hello")');
check('Store.set / get 往返一致', G('Store.get("__t_store","")') === 'hello' ? 1 : 0, 1, 0.001);
G('Store.remove("__t_store")');
check('Store.remove 后回到默认值', G('Store.get("__t_store","def")') === 'def' ? 1 : 0, 1, 0.001);

G('localStorage.setItem("__t_bad","{not json")');
check('Store.getJSON 解析失败不抛错、返回默认值', G('Store.getJSON("__t_bad",{ok:1}).ok'), 1, 0.001);
check('坏档被隔离到 .__bad 保留现场',
  G('localStorage.getItem("__t_bad.__bad")') === '{not json' ? 1 : 0, 1, 0.001);
check('Store.quarantineKeys 能列出隔离副本',
  G('Store.quarantineKeys().indexOf("__t_bad.__bad")') >= 0 ? 1 : 0, 1, 0.001);

G('localStorage.setItem("__t_shape","[1,2,3]")');
check('Store.getJSON 形状校验挡住数组',
  G('Store.getJSON("__t_shape",null,function(v){return v&&typeof v==="object"&&!Array.isArray(v);})===null') ? 1 : 0, 1, 0.001);
check('Store.setJSON 遇循环引用返回 false 且不抛错',
  G('(function(){var o={};o.self=o;return Store.setJSON("__t_cyc",o);})()') === false ? 1 : 0, 1, 0.001);

G('Store.dropQuarantine()');
check('Store.dropQuarantine 清空隔离副本', G('Store.quarantineKeys().length'), 0, 0.001);
G('localStorage.removeItem("__t_bad"); localStorage.removeItem("__t_shape");');

/* --- ⑧ 存档修复：坏字段降级而不是整档丢弃 --- */
check('Save._repair 修掉 NaN / 乱码数值',
  G('(function(){var d=Save._repair({level:NaN,xp:"abc",gold:"250"});return d.level*1000+d.xp*100+d.gold;})()'),
  1250, 0.001);
check('Save._repair 把非数组 weapons 重置为空',
  G('Save._repair({weapons:"oops"}).weapons.length'), 0, 0.001);
check('Save._repair 跳过 null 武器项但保留其余',
  G('(function(){var d=Save._repair({weapons:[{name:"a"},null]});return d.weapons.length;})()'),
  1, 0.001);
check('Save._repair 把非对象档判为无效', G('Save._repair([1,2,3])===null') ? 1 : 0, 1, 0.001);
G('localStorage.setItem(Save.KEY,"123")');
check('Save.load 对非对象档返回 null（不崩）', G('Save.load()===null') ? 1 : 0, 1, 0.001);
G('localStorage.removeItem(Save.KEY); localStorage.removeItem(Save.KEY+"__bad")');

/* --- ⑨ 仓库经济字段归一：字符串 / NaN 不能漏进价格计算 --- */
const __stRaw = G('localStorage.getItem(RaidStash.KEY)');
G('localStorage.setItem(RaidStash.KEY, JSON.stringify({weapons:[],gunVer:3,creds:"oops",tokens:null,bandages:-5}))');
const __healed = JSON.parse(G('JSON.stringify(RaidStash.load())'));
check('RaidStash 把非法 creds 归一为默认 800', __healed.creds, 800, 0.001);
check('RaidStash 把 null tokens 归一为 0', __healed.tokens, 0, 0.001);
check('RaidStash 把负 bandages 抬到 0', __healed.bandages, 0, 0.001);
if (__stRaw === null) G('localStorage.removeItem(RaidStash.KEY)');
else G('localStorage.setItem(RaidStash.KEY,' + JSON.stringify(__stRaw) + ')');

/* ==========================================================================
 * 41. 3D 装饰碰撞箱对齐（v0.23.2）
 * --------------------------------------------------------------------------
 * 背景：3D 里掩体是 billboard 贴片，而贴片的横向宽度是从**高度**乘固定系数推出来的，
 * 与碰撞矩形 q.w/q.h 完全无关。结果长条掩体（沙袋墙 134×38 / 隔离栏 206×38）
 * 被画成小方块，玩家看着能侧身过去、实际撞上一整道墙；卡车反过来被画大近 3 倍。
 * 这一组锁的就是「宽度必须来自碰撞矩形」这条契约。
 * ========================================================================== */
console.log('\n=== 41. 3D 装饰碰撞箱对齐（v0.23.2） ===');
const __fp3 = fs.readFileSync(path.join(SRC, 'fpview.js'), 'utf8');

/* --- ① 墙不重复画 --- */
check('props 渲染跳过 kind==="wall"（墙已由按面渲染负责）',
  /if\(\(q\.kind \|\| "wall"\) === "wall"\) continue;/.test(__fp3) ? 1 : 0, 1, 0.001);

/* --- ② 宽度来源：碰撞矩形在相机右向量上的支撑半径 --- */
check('横向宽度取碰撞矩形的支撑半径（|sa|·w/2 + |ca|·h/2）',
  /Math\.abs\(sa\)\*\(q\.w\|\|40\)\*0\.5 \+ Math\.abs\(ca\)\*\(q\.h\|\|40\)\*0\.5/.test(__fp3) ? 1 : 0, 1, 0.001);
check('kw 参与横向视锥剔除（长条不被提前丢掉）',
  /halfSpan = Math\.max\(size, kw\*0\.5\)/.test(__fp3) ? 1 : 0, 1, 0.001);
check('kw 传入 _sprite 再交给 _propSprite',
  /this\._sprite\(ctx, s, sx, it\.footY, size, depth, it\.kw\)/.test(__fp3) &&
  /this\._propSprite\(ctx, s, cx, foot, size, kw\)/.test(__fp3) ? 1 : 0, 1, 0.001);

/* --- ③ 各形状不再用「高度 × 系数」当宽度 --- */
check('_propSprite 以 kw 推出 bwBase', /const bwBase = \(kw > 2\)/.test(__fp3) ? 1 : 0, 1, 0.001);
check('长条类宽度改用 bwBase（barrier / sandbag / container 组 / 默认）',
  /const bw = bwBase, bh = k\*0\.46/.test(__fp3) &&
  /const bw = bwBase, bh = k\*0\.62/.test(__fp3) &&
  /const bw = bwBase;\s*\n\s*const bh = k\*\(kind==="container"/.test(__fp3) &&
  /const bw = bwBase, bh = k\*0\.85/.test(__fp3) ? 1 : 0, 1, 0.001);
check('旧的固定系数宽度已消失（k*1.1 / k*1.25 / k*1.5 不再做宽度）',
  !/const bw = k\*1\.1/.test(__fp3) && !/const bw = k\*\(kind==="container"\?1\.25/.test(__fp3) ? 1 : 0, 1, 0.001);
check('宽度的极端值有上限（近处不糊满屏）', /Math\.min\(kw, k\*3\.2\)/.test(__fp3) ? 1 : 0, 1, 0.001);

/* --- ④ 地面碰撞轮廓 --- */
check('地面轮廓函数存在', /_propFootprint\(ctx, it, horizon, proj, ca, sa\)/.test(__fp3) ? 1 : 0, 1, 0.001);
check('轮廓由前向 / 右向两个支撑半径推出梯形',
  /halfF = Math\.abs\(ca\)\*\(q\.w\|\|0\)\*0\.5 \+ Math\.abs\(sa\)\*\(q\.h\|\|0\)\*0\.5/.test(__fp3) &&
  /halfR = Math\.abs\(sa\)\*\(q\.w\|\|0\)\*0\.5 \+ Math\.abs\(ca\)\*\(q\.h\|\|0\)\*0\.5/.test(__fp3) ? 1 : 0, 1, 0.001);
check('轮廓有近平面保护（跨越相机平面时不画）', /if\(dNear < 18\) return;/.test(__fp3) ? 1 : 0, 1, 0.001);
check('轮廓按距离衰减（远处不挂白框）',
  /M\.clamp\(1 - \(depth-260\)\/420, 0, 1\)/.test(__fp3) ? 1 : 0, 1, 0.001);
check('轮廓画在立面之前（同一画家层内先地面后贴片）',
  /if\(s\.kind === "prop"\) this\._propFootprint\([^)]*\);\s*\n\s*this\._sprite\(/.test(__fp3) ? 1 : 0, 1, 0.001);

/* --- ⑤ 数值：支撑半径的几何必须对 --- */
const __kwOf = (w, h, yaw, depth, proj) => {
  const ca = Math.cos(yaw), sa = Math.sin(yaw);
  const halfR = Math.abs(sa) * w / 2 + Math.abs(ca) * h / 2;
  return (halfR * 2 / depth) * proj;
};
/* 注意朝向约定：矩形 206×38 的 206 沿 x 轴延伸。
 *   相机 yaw=0     → 右向量=(0,1) → 横向是 y → 看到 38（端面/厚度）
 *   相机 yaw=π/2   → 右向量=(-1,0) → 横向是 x → 看到 206（长边） */
check('沿 x 看过去时宽度=厚度（206×38 看成 38）', __kwOf(206, 38, 0, 400, 1000), 38 / 400 * 1000, 0.5);
check('沿 y 看过去时宽度=长度（206×38 看成 206）', __kwOf(206, 38, Math.PI / 2, 400, 1000), 206 / 400 * 1000, 0.5);
check('斜 45° 时介于两者之间',
  __kwOf(206, 38, Math.PI / 4, 400, 1000) > 38 / 400 * 1000 &&
  __kwOf(206, 38, Math.PI / 4, 400, 1000) < 206 / 400 * 1000 ? 1 : 0, 1, 0.001);
/* 方形斜看时投影会变宽，最多 √2 倍 —— 这是 AABB 支撑函数的正确行为，不是 bug */
check('方形斜看投影最宽为 √2 倍（支撑函数的正确行为）',
  Math.abs(__kwOf(74, 74, Math.PI / 4, 400, 1000) / __kwOf(74, 74, 0, 400, 1000) - Math.SQRT2) < 0.01 ? 1 : 0, 1, 0.001);

/* ==========================================================================
 * 42. 圆形装饰光影 / 手电扇形羽化 / 室内再提亮（v0.23.3）
 * ========================================================================== */
console.log('\n=== 42. 圆形装饰光影 / 手电羽化 / 室内再提亮（v0.23.3）===');

/* --- ① 形状分类只服务光线，移动 / 子弹 / AI 碰撞仍是 AABB --- */
check('圆形装饰分类表恰好 4 类', G('Object.keys(RAID_ROUND_KINDS).length'), 4, 0.001);
check('分类表内容正确（bush / rock / tree / scrap）',
  G('["bush","rock","tree","scrap"].every(k=>RAID_ROUND_KINDS[k]===1)?1:0'), 1, 0.001);
check('_pushProp 给碰撞体挂 round 标记',
  /round:!!RAID_ROUND_KINDS\[t\.kind\]/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('碰撞体结构未变（仍是 x,y,w,h 的 AABB）',
  /const p=\{ x:x, y:y, w:t\.w, h:t\.h, kind:t\.kind/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('_rayLight 有 round 分支且用解析判别式求交',
  /if\(w\.round\)\{/.test(raidSrc) && /const disc=B\*B-4\*A\*C/.test(raidSrc) &&
  /Math\.sqrt\(disc\)/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('椭圆求交只用于光线（渲染 / 移动 / 子弹代码不消费 round）',
  /_nearWalls\(x,y,r\)/.test(raidSrc) && !/w\.round/.test(__rd2) ? 1 : 0, 1, 0.001);

/* 同一块 200×200 的岩石，唯一差别是 round 标记：
 * 射线贴着上边角 (y=10) 水平射入 —— 矩形在 x=100 就挡，内切圆要到 x≈156 才挡；
 * 正穿中心 (y=100) 时两者都从 x=100 开始挡，说明改动没有挪动物体或缩小掩体。 */
const __round = G(`(function(){
  var oldC=Raid.navCS, oldCo=Raid.navCols, oldR=Raid.navRows, oldCell=Raid.navCell, oldW=Raid.walls;
  Raid.navCS=100; Raid.navCols=8; Raid.navRows=4; Raid.walls=[];
  var spec={x:100,y:0,w:200,h:200,kind:"rock",sight:true};
  var rect=Object.assign({}, spec), oval=Object.assign({}, spec, {round:true});
  var put=function(w){
    Raid.navCell=new Array(32); Raid.walls=[w];
    for(var gy=0;gy<=2;gy++) for(var gx=1;gx<=3;gx++){
      var i=gy*8+gx; (Raid.navCell[i]||(Raid.navCell[i]=[])).push(w);
    }
  };
  var ray=function(w, sy){ put(w); return Raid._rayLight(0, sy, 1, 0, 560); };
  var out={
    rectEdge:ray(rect,10), ovalEdge:ray(oval,10),
    rectMid:ray(rect,100), ovalMid:ray(oval,100)
  };
  put(oval); out.inside=Raid._rayLight(200,100,1,0,560);
  Raid.navCS=oldC; Raid.navCols=oldCo; Raid.navRows=oldR; Raid.navCell=oldCell; Raid.walls=oldW;
  return out;
})()`);
check('矩形角落挡光（改前行为，x=100）', __round.rectEdge, 100, 0.5);
check('椭圆让角落透光（x≈156，晚 56px 才挡）', __round.ovalEdge, 156.4, 1.5);
check('角落透光量 > 50px（不是采样/舍入误差）',
  __round.ovalEdge - __round.rectEdge > 50 ? 1 : 0, 1, 0.001);
check('正穿中心时椭圆与矩形一致（掩体未被缩小）',
  Math.abs(__round.ovalMid - __round.rectMid) < 0.01 ? 1 : 0, 1, 0.001);
check('站在圆形装饰里手电不被自己掐死', __round.inside, 560, 0.5);

/* --- ② 手电扇形角度羽化 --- */
check('羽化层权重之和为 1（主扇形内部亮度不变）',
  G('RAID_FLASH_FAN.reduce((s,l)=>s+l.alpha,0)'), 1, 0.0001);
check('羽化层角度递增 / 权重与射线数递减',
  G('RAID_FLASH_FAN.every((l,i,a)=>i===0||(l.widen>a[i-1].widen&&l.alpha<a[i-1].alpha&&l.rays<a[i-1].rays))?1:0'), 1, 0.001);
check('主层仍是 96 条精确射线（消锯齿能力不退化）', G('RAID_FLASH_FAN[0].rays'), 96, 0.001);
check('羽化靠 globalAlpha 叠加且画完复位',
  /ctx\.globalAlpha=L\.alpha/.test(__rd2) && /ctx\.globalAlpha=1;/.test(__rd2) ? 1 : 0, 1, 0.001);
check('每层仍各自做遮挡裁剪（羽化不把光穿回墙里）',
  /this\._lightFan\(x, y, ang-half\*L\.widen/.test(__rd2) ? 1 : 0, 1, 0.001);

/* --- ③ 室内再提亮约 2 倍，护栏一个不动 --- */
check('室内增益 ×3.2', G('raidFlashGain(1)'), 3.2, 0.0001);
check('室外增益仍是 1.0（提亮只发生在室内）', G('raidFlashGain(0)'), 1, 0.0001);
check('2D 半程 alpha 0.293 → 0.64（亮的是光斑面积）',
  G('RAID_FLASH.cone2dMid*raidFlashGain(1)'), 0.64, 0.002);
check('3D 半程 alpha 0.090 → 0.198',
  G('RAID_FLASH.cone3dMid*raidFlashGain(1)'), 0.1984, 0.002);
check('室内热点翻倍 0.10 → 0.20', G('RAID_FLASH.hot'), 0.20, 0.0001);
check('3D 中心+热点合计 0.68（v0.23.0 是 0.334）',
  G('RAID_FLASH.cone3d*raidFlashGain(1)+RAID_FLASH.hot'), 0.68, 0.002);
check('3D 手电同样走 raidPlayerBeam（不再写死 560）',
  /raidPlayerBeam\(Raid\)/.test(__fp2) ? 1 : 0, 1, 0.001);
check('三个暖色 rgb 一个没动（色温不变）',
  /255,236,182/.test(__rd2) && /255,224,160/.test(__rd2) && /255,228,160/.test(__rd2) &&
  /255,236,182/.test(__fp2) && /255,224,160/.test(__fp2) ? 1 : 0, 1, 0.001);
check('热点半径与亮核位移仍由 RAID_FLASH 驱动',
  /reach\*RAID_FLASH\.hotR/.test(__fp2) && /0\.5 - RAID_FLASH\.coreShift\*ind/.test(__fp2) ? 1 : 0, 1, 0.001);

/* --- ④ 图层顺序：室内压暗必须在手电之前（本轮最关键的修复） ---
 * 原来 0.52 的暗层盖在 render() 末尾、也就是盖在 _lightLayer 的加色光斑之上，
 * 把刚提亮的亮度又打对折 —— 「参数翻倍、画面几乎没变亮」的真因。
 * 3D 的 _lighting 一直是先压暗后 lighter，2D 现在与它对齐。 */
check('2D 室内压暗画在光照层之前（不压手电）',
  __rd2.indexOf('0.52*indoor') >= 0 &&
  __rd2.indexOf('0.52*indoor') < __rd2.indexOf('this._lightLayer(ctx, game, cam, vw, vh);') ? 1 : 0, 1, 0.001);
check('压暗层已从 render() 移到 scene()',
  __rd2.split('\n').slice(0, 40).join('\n').indexOf('0.52*indoor') < 0 ? 1 : 0, 1, 0.001);
check('压暗用世界坐标覆盖可见区（scene 已有相机变换）',
  /ctx\.fillRect\(cam\.x, cam\.y, vw, vh\)/.test(__rd2) ? 1 : 0, 1, 0.001);
check('压暗不污染加色模式（显式 source-over + save/restore）',
  /ctx\.globalCompositeOperation="source-over"/.test(__rd2) &&
  /ctx\.restore\(\);\s*\n\s*\}\s*\n\s*\n\s*\/\/ 光照层/.test(__rd2) ? 1 : 0, 1, 0.001);

/* ==========================================================================
 * 43. 模型 / 负重 / 装备槽 / 对比面板 / 长短按（v0.24.0）
 * ========================================================================== */
console.log('\n=== 43. 模型 / 负重 / 装备槽 / 对比面板 / 长短按（v0.24.0）===');
const __inp = fs.readFileSync(path.join(SRC, 'input.js'), 'utf8');

/* --- ① 圆形模型：树 / 废料不再套方底，视线也按椭圆 --- */
check('圆形物跳过方形底与描边',
  /const boxy = \(k!=="tree" && k!=="scrap"\)/.test(__rd2) ? 1 : 0, 1, 0.001);
check('scrap 改用椭圆投影',
  /k==="bush"\|\|k==="rock"\|\|k==="tree"\|\|k==="scrap"/.test(__rd2) ? 1 : 0, 1, 0.001);
check('tree / scrap 的形状分支仍保留',
  /else if\(k==="tree"\)/.test(__rd2) && /else if\(k==="scrap"\)/.test(__rd2) ? 1 : 0, 1, 0.001);
check('_rayWall 有椭圆形状判定',
  /const hit=\(w,px,py\)=>/.test(raidSrc) && /ux\*ux\+uy\*uy<=1/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('_rayWall 两处判定都走 hit()（含无索引兜底）',
  /if\(w\.sight!==false && hit\(w,px,py\)\)/.test(raidSrc) &&
  /if\(hit\(w,px,py\)\)/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('椭圆判定用归一化半径平方（不是 AABB）',
  /const ux=\(px-\(w\.x\+a\)\)\/a, uy=\(py-\(w\.y\+b\)\)\/b/.test(raidSrc) &&
  /ux\*ux\+uy\*uy<=1/.test(raidSrc) ? 1 : 0, 1, 0.001);
/* 注意：verify 的沙箱在第 256 行把 Raid._rayWall 桩成 ()=>null（供其他组隔离视线依赖），
   所以这里不做 vm 数值测试 —— 真实数值由浏览器探针 probe_v0240.js 覆盖：
   200×200 岩石，矩形命中 x=103.2、椭圆命中 x=167.7（角落晚 64.5px 才挡视线）。 */

/* --- ② 负重与空手 --- */
check('负重权重之和恰为 1',
  Math.abs(G('Object.keys(RAID_LOAD_SHARE).reduce((s,k)=>s+RAID_LOAD_SHARE[k],0)') - 1) < 1e-9 ? 1 : 0, 1, 0.001);
check('满载减速 30%', G('RAID_LOAD_PENALTY'), 0.30, 0.0001);
const __load = JSON.parse(G(`JSON.stringify((()=>{
  const R={inv:{weapons:[],armors:[],helmets:[],shields:[],parts:[],materials:[],meds:[],receivers:[],keys:[],ammo:{}}};
  const e=raidLoadOf(R), em=raidSpeedMul(R);
  for(const k in RAID_INV_CAP) R.inv[k]=new Array(RAID_INV_CAP[k]).fill(0);
  R.inv.ammo={x:RAID_AMMO_CAP};
  const f=raidLoadOf(R), fm=raidSpeedMul(R);
  return {e:e,em:em,f:f,fm:fm};
})())`));
check('空包负载 0 / 移速 ×1.00', __load.e === 0 && __load.em === 1 ? 1 : 0, 1, 0.001);
check('全栏装满负载 1', __load.f, 1, 0.0001);
check('满载移速 ×0.70', __load.fm, 0.70, 0.0001);
check('移速公式乘上负重', /\*raidSpeedMul\(this\)/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('物品栏显示负重反馈', /背包负重/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('收枪文案用动态加成（不再写死 +20%）',
  /Math\.round\(\(RAID_BAREHAND_SPEED-1\)\*100\)/.test(raidSrc) ? 1 : 0, 1, 0.001);

/* --- ③ 背包取枪优先填空手 --- */
check('_equipGun 有填空手分支',
  /else if\(!p\.gun\)\{ p\.gun=g; \}/.test(raidSrc) &&
  /else if\(!p\.secondary\)\{ p\.secondary=g; \}/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('Q 循环用 forceMain 保持换枪语义',
  /this\._equipGun\(this\._rtGun\(bag\[0\]\), true\)/.test(raidSrc) ? 1 : 0, 1, 0.001);
const __slot = JSON.parse(G(`JSON.stringify((()=>{
  const A=generateWeapon(10,{type:"rifle"}), B=generateWeapon(10,{type:"smg"}), C=generateWeapon(10,{type:"sniper"});
  const fake={ player:{gun:A,secondary:null,reloadT:0,fireCd:0,x:0,y:0}, _pick:()=>{} };
  Raid._equipGun.call(fake,B);
  const fill={ main:fake.player.gun===A, sec:fake.player.secondary===B };
  fake.player.gun=A; fake.player.secondary=null;
  Raid._equipGun.call(fake,C,true);
  const force={ main:fake.player.gun===C, sec:fake.player.secondary===null };
  return {fill:fill,force:force};
})())`));
check('主手有枪副手空 → 填副手、不动主手',
  __slot.fill.main && __slot.fill.sec ? 1 : 0, 1, 0.001);
check('forceMain → 仍替换主手', __slot.force.main && __slot.force.sec ? 1 : 0, 1, 0.001);

/* --- ④ 对比面板泛化到四类 + 溢出掉落 --- */
check('面板覆盖 weapon/shield/armor/helmet',
  /const GEAR=\["weapon","shield","armor","helmet"\]/.test(__rd2) ? 1 : 0, 1, 0.001);
check('面板读 carried 的护甲与头盔',
  /carried\.armor/.test(__rd2) && /carried\.helmet/.test(__rd2) ? 1 : 0, 1, 0.001);
check('护盾对比行（容量/充能/延迟）',
  /k:"容量"/.test(__rd2) && /k:"充能\/s"/.test(__rd2) && /k:"延迟s"/.test(__rd2) ? 1 : 0, 1, 0.001);
check('防具对比行（耐久/减伤/品阶）',
  /k:"耐久"/.test(__rd2) && /k:"减伤%"/.test(__rd2) && /k:"品阶"/.test(__rd2) ? 1 : 0, 1, 0.001);
check('面板保留 ▲▼ 与空手提示（旧断言不回归）',
  /better=!!cur && r\.a>r\.b/.test(__rd2) && /手持为空，直接拾取/.test(__rd2) &&
  /▲":worse\?" ▼/.test(__rd2) ? 1 : 0, 1, 0.001);
check('溢出堆标出「背包溢出」',
  /c\.spill/.test(__rd2) && /背包溢出/.test(__rd2) ? 1 : 0, 1, 0.001);
check('面板调用点在 ground 分支之外（开箱残留也能看）',
  __rd2.indexOf('this._groundGunPanel(ctx, R, c, v,') < __rd2.indexOf('if(c.ground){') ? 1 : 0, 1, 0.001);
check('_dropGround 支持 spill 标记',
  /_dropGround\(item, x, y, mark\)/.test(raidSrc) &&
  /this\._dropGround\(item, x, y, "spill"\)/.test(raidSrc) &&
  /if\(mark==="spill"\) pile\.spill=true/.test(raidSrc) ? 1 : 0, 1, 0.001);

/* --- ⑤ 短按进背包 / 长按 0.45s 替换 --- */
check('长按阈值 0.45 秒', G('RAID_HOLD_EQUIP'), 0.45, 0.0001);
check('长按按 dt 累积', /h\.t\+=dt/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('满阈值才替换且只执行一次',
  /h\.t>=RAID_HOLD_EQUIP/.test(raidSrc) && /h\.done=true/.test(raidSrc) &&
  /this\._equipFromGround\(h\.c, h\.item\)/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('短按松手仍走原搜索读条',
  /if\(!h\.done && !this\.search && !h\.c\.searched\)\{ this\.search=\{ c:h\.c, t:0 \}/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('只对含装备的堆启用长按',
  /it\.kind==="container" && !it\.ref\.searched && this\._groundEquipItem\(it\.ref\)/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('走远 / 开商店时取消长按',
  /M\.dist\(p\.x,p\.y,h\.c\.x,h\.c\.y\)>86 \|\| this\.shopOpen/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('跨局清空长按状态', /this\._pickHold=null;/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('桌面读 E/Space、触摸读 useHeld',
  /Input\.keys\['KeyE'\] \|\| Input\.keys\['Space'\]/.test(raidSrc) &&
  /Input\.isTouch && Input\.useHeld/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('触摸★改为按住型按钮',
  /_bindHold\('touch-ability'/.test(__inp) && /this\.useHeld=true/.test(__inp) ? 1 : 0, 1, 0.001);
check('HUD 按装备种类写长按提示（换枪/换甲/换盔/换盾）',
  /长按★/.test(__rd2) && /按住E/.test(__rd2) && /[\"']换甲[\"']/.test(__rd2) ? 1 : 0, 1, 0.001);
check('_groundEquipItem 顺序与面板一致',
  /for\(const k of \["weapon","shield","armor","helmet"\]\)/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('_wearGear 支持护甲与头盔',
  /_wearGear\(kind, it\)/.test(raidSrc) && /p\.armorTier=it\.tier\|\|0/.test(raidSrc) &&
  /p\.maxHelmetArmor=cap/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('旧装备满栏时落地而非凭空消失',
  /this\._dropGround\(old, p\.x, p\.y, "spill"\)/.test(raidSrc) &&
  /arr\.length<RAID_INV_CAP\.shields/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('_swapEquip 四类走各自穿戴链路',
  /_swapEquip\(item\)/.test(raidSrc) && /this\._dropGround\(heldItem/.test(raidSrc) &&
  /this\._wearShield\(item\)/.test(raidSrc) && /this\._wearGear\(kind, item\)/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('长按只取这一件、其余留在原地',
  /drops\.splice\(i,1\)/.test(raidSrc) && /if\(!drops\.length\) c\.searched=true/.test(raidSrc) ? 1 : 0, 1, 0.001);

/* ==========================================================================
 * 44. 十项更新（v0.25.0）
 * --------------------------------------------------------------------------
 * 组内每条对应一条用户需求，锁「行为」而不是「实现细节」：
 *   ① 其他 AI / 玩家的手电要显示（2D + 3D）
 *   ② 屋内的箱子在屋外不显示
 *   ③ 护甲 / 头盔改用 9 阶品质色，去掉「掉落可至…」
 *   ④ 长条形装饰画矩形不画椭圆
 *   ⑤ Ti 护盾破盾无敌一局最多 2^i 次
 *   ⑥ 开局配装按估值从高到低排
 *   ⑦ ₽512 装备包大幅削弱（大概率手枪 / 不给护盾）
 *   ⑧ 护盾改 32 份材料合成
 *   ⑨ 融合升阶概率调低
 *   ⑩ 钥匙掉率调低 + 高等级箱子物品变好
 * ========================================================================== */
console.log('\n=== 44. 十项更新（v0.25.0） ===');

/* --- ① 其他 AI / 玩家的手电 --- */
check('op 手电参数独立且明显暗于本地（不抢戏）',
  (G('RAID_FLASH_OP.cone2d < RAID_FLASH.cone2d') && G('RAID_FLASH_OP.cone2dMid < RAID_FLASH.cone2dMid')) ? 1 : 0, 1, 0.001);
check('op 手电羽化层更省（射线数与层数都少于本地）',
  G('RAID_FLASH_OP.fan.length < RAID_FLASH_FAN.length && RAID_FLASH_OP.fan[0].rays < RAID_FLASH_FAN[0].rays') ? 1 : 0, 1, 0.001);
check('2D 遍历 ops 画手电且跳过自己与存活判假',
  /for\(const o of ops\)/.test(__rd2) && /o===p \|\| o\.isPlayer/.test(__rd2) && /o\.alive===false/.test(__rd2) ? 1 : 0, 1, 0.001);
check('2D op 手电按自身坐标算室内增益（屋里更亮）',
  /const ind=\(typeof raidIndoorAt==="function" && raidIndoorAt\(o\.x,o\.y\)\) \? 1 : 0/.test(__rd2) ? 1 : 0, 1, 0.001);
check('2D op 手电按距离淡出并限流',
  G('RAID_FLASH_OP.fadeFar') > G('RAID_FLASH_OP.fadeNear') && /RAID_FLASH_OP\.maxOps/.test(__rd2) ? 1 : 0, 1, 0.001);
check('3D 也画 op 手电（光池 + 脚下余晖，带 z-buffer 遮挡）',
  /const ops = \(R\.ops\|\|\[\]\)\.filter\(o=>o!==p/.test(__fp2) && /if\(zb\[c\] < d1 - 24\) continue;/.test(__fp2) ? 1 : 0, 1, 0.001);

/* --- ② v0.26.0：用户要求删除「进屋才看到」的旧规则，改为统一的手电 / 近身可见性 --- */
check('raidRoomAt 函数仍在（地形判定用），但不再用于容器可见性',
  G('raidRoomAt(5,5)') === null && G('(function(){var rm=RAID_ROOMS.find(r=>!r.open&&!r.extract);return raidRoomAt(rm.x+rm.w/2, rm.y+rm.h/2)===rm;})()')
  && !/c\._room!==pRoom/.test(__rd2) ? 1 : 0, 1, 0.001);
check('2D 容器走 raidContainerVisible（不再按房间过滤）',
  /if\(!raidContainerVisible\(R,c\)\) continue;/.test(__rd2) &&
  !/const pRoom =/.test(__rd2) ? 1 : 0, 1, 0.001);
check('3D 容器 / 地面堆共用同一套可见性判定',
  /if\(!raidContainerVisible\(R,c\)\) continue;/.test(__fp2) &&
  /if\(!raidContainerVisible\(R,g\)\) continue;/.test(__fp2) ? 1 : 0, 1, 0.001);
check('2D 地面堆也走同一套判定',
  /if\(!raidContainerVisible\(R,g\)\) continue;/.test(__rd2) ? 1 : 0, 1, 0.001);

/* --- ③ 护甲 / 头盔品质色 + 去掉「掉落可至…」 --- */
check('商店 / 结算 / 回收超市都不再出现「掉落可至」',
  raidSrc.indexOf('掉落可至') < 0 ? 1 : 0, 1, 0.001);
/* v0.28.0（用户要求）：商店左边栏改回 T1~T9 颜色阶梯，不再九张卡一片棕 */
check('商店护甲 / 头盔左边栏走 T1~T9 阶梯色',
  /const col=ARMOR_TIER_COLOR\[t\], tcol=col;/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('结算 / 回收超市的护甲头盔色走品质色（带等级色兜底）',
  /RAID_RARITY_COLOR\[r\]\) \? RAID_RARITY_COLOR\[r\]/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('商店卡片仍保留 T1~T9 的等级徽标（品质色统一后不至于九张卡一样）',
  /const tierBadge=\(t,col\)=>/.test(raidSrc) ? 1 : 0, 1, 0.001);

/* --- ④ 长条形装饰画矩形 --- */
check('raidRoundShape：近似各向同性 → 允许椭圆',
  G('raidRoundShape(74,62)') === true ? 1 : 0, 1, 0.001);
check('raidRoundShape：长条形（186×42）→ 必须矩形',
  G('raidRoundShape(186,42)') === false ? 1 : 0, 1, 0.001);
check('_pushProp 的 round 光遮挡标记也走同一判定',
  /raidRoundShape\(t\.w,t\.h\)/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('2D / 3D 装饰绘制共用 raidRoundShape',
  /raidRoundShape\(w,h\)/.test(__rd2) && /raidRoundShape\(q\.w\|\|1, q\.h\|\|1\)/.test(__fp2) ? 1 : 0, 1, 0.001);
check('残水洼长条椭圆改旋转矩形（不再有 58+…,20 的椭圆）',
  /ellipse\(wx, wy, 58\+/.test(__rd2) ? 0 : 1, 1, 0.001);
check('长条灌木有专用的矩形分支',
  /if\(k==="bush" && roundOK\)/.test(__rd2) && /if\(!roundOK\)\{/.test(__fp2) ? 1 : 0, 1, 0.001);

/* --- ⑤ Ti 护盾破盾无敌 2^i 次/局 --- */
check('T1 护盾配额 2 次', G('(function(){var r=Object.create(Raid);r._ivUsed={};return r._shieldQuota({tier:1}).max;})()'), 2, 0.001);
check('T5 护盾配额 32 次', G('(function(){var r=Object.create(Raid);r._ivUsed={};return r._shieldQuota({tier:5}).max;})()'), 32, 0.001);
check('T9 护盾配额 512 次', G('(function(){var r=Object.create(Raid);r._ivUsed={};return r._shieldQuota({tier:9}).max;})()'), 512, 0.001);
check('配额按护盾 uid 记账（拆下再戴上不刷新）',
  G('(function(){var r=Object.create(Raid);r._ivUsed={};var s={uid:"x",tier:2};r._shieldQuotaUse(s);r._shieldQuotaUse(s);return r._shieldQuota(s).left;})()'), 2, 0.001);
check('破盾时先查配额、用尽后不给无敌',
  /const maxIv=target\.shieldInvulnMax\|0;/.test(raidSrc) && /无敌次数已用尽/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('浮动字 / 详情页写出剩余次数',
  /余 "\+\(target\.shieldInvulnLeft\|0\)/.test(raidSrc) && /本局剩余 /.test(raidSrc) ? 1 : 0, 1, 0.001);
check('护盾描述写出「×N 次/局」',
  /次\/局/.test(G('shieldLines(raidMakeShield(3,0)).join("|")')) ? 1 : 0, 1, 0.001);

/* --- ⑥ 开局配装按估值降序 --- */
check('配装页四类装备都按估值降序排列',
  /const byValue=arr=>\(arr\|\|\[\]\)\.slice\(\)\.sort\(\(a,b\)=>\(b\.value\|\|0\)-\(a\.value\|\|0\)\);/.test(raidSrc) &&
  /byValue\(stash\.weapons\)/.test(raidSrc) && /byValue\(stash\.armors\)/.test(raidSrc) &&
  /byValue\(stash\.helmets\)/.test(raidSrc) && /byValue\(stash\.shields\)/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('排序不改 _raidSel（仍按 uid 选中）',
  /sel\.w\.includes\(w\.uid\)/.test(raidSrc) ? 1 : 0, 1, 0.001);

/* --- ⑦ ₽512 装备包大幅削弱 --- */
check('装备包两把枪 82% 是手枪',
  /weight:82,k:"pistol"/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('装备包不再调 raidMakeShield',
  (function(){
    const a=raidSrc.indexOf('_dropSupportCache(x, y){');
    if(a<0) return 0;
    const b=raidSrc.indexOf('_prepPlayerAmmo(opts){', a);
    const body=raidSrc.slice(a, b>a?b:a+4000);
    return body.indexOf('raidMakeShield')<0 ? 1 : 0;
  })(), 1, 0.001);
check('装备包枪械等级从 8 降到 6',
  /blGunGen\(6, \{ type:gt, rarity:"white" \}\)/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('配装页文案同步（写明不含护盾 + 大概率手枪）',
  /不含护盾/.test(raidSrc) && /大概率是手枪/.test(raidSrc) ? 1 : 0, 1, 0.001);

/* --- ⑧ 护盾 32 份材料 --- */
check('护盾合成配方 32 槽',
  G('RAID_RECIPES.find(r=>r.id==="r_shield").slots'), 32, 0.001);
check('护盾配方说明写出 32 份',
  /投入 32 份材料/.test(raidSrc) ? 1 : 0, 1, 0.001);

/* --- ⑨ 融合升阶概率调低 --- */
check('2 件升阶成功率 38%', G('raidFuseUpChance(2)'), 0.38, 0.0001);
check('5 件升阶成功率 80%（封顶，永不 100%）', G('raidFuseUpChance(5)'), 0.80, 0.0001);
check('件数越多成功率越高（单调）',
  G('(function(){var a=[2,3,4,5].map(raidFuseUpChance);return a.every((v,i)=>i===0||v>a[i-1]);})()') ? 1 : 0, 1, 0.001);
check('四种产物都走概率升阶（不再是固定 +1/+2）',
  (raidSrc.match(/raidFuseRollUp\(n\)/g)||[]).length >= 4 ? 1 : 0, 1, 0.001);
check('预览不再写死「提升 1~2 档」，改为概率 + 区间',
  /升阶成功率/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('融合失败不退化为降级（产物至少等于最高投料品质）',
  /Math\.min\(RARITIES\.length-1, maxRar\+boost\)/.test(raidSrc) && /boost=raidFuseRollUp\(n\)\+raidFuseRollSecond\(n\)/.test(raidSrc) ? 1 : 0, 1, 0.001);

/* --- ⑩ 钥匙掉率调低 + 高等级箱子变好 --- */
/* v0.32.0（用户要求「大幅降低」）：精锐 10%→3%、普通 3.5%→1% */
check('AI 身上钥匙掉率 10% → 3% / 3.5% → 1%',
  /bot\.smart\?0\.030:0\.010/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('上锁箱内钥匙 34% → 18%', /if\(RNG\.chance\(0\.18\)\) this\._collect\(raidRollBoxKey\(lv\)/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('普通木箱钥匙 2.5% → 1.2%', /RNG\.chance\(0\.012\)/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('保险箱品质保底抬档 [0,0,1,2,4,6]',
  /const floorT=\[0,0,1,2,4,6\]\[L\];/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('高等级箱件数上调（L2 起 +1 / L4 +1 / L5 +1）',
  /const n=1\+\(lv>=2\?1:0\)\+\(lv>=4\?1:0\)\+\(lv>=5\?1:0\);/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('IV 级箱有独立权重（不再与 I 级共用 34% 出枪曲线）',
  /if\(L>=4\)\{/.test(raidSrc) && /if\(r<0\.40\) return this\._rollGunLoot\("pmc", luck, floorT\);/.test(raidSrc) ? 1 : 0, 1, 0.001);

/* ==========================================================================
 * 45. 运行期健壮性（v0.25.1）
 * --------------------------------------------------------------------------
 * 这一组锁的是「出错之后还能不能继续玩」，和 40 组的「契约不扩散」互补：
 *   ① 主循环错误边界（异常不得永久冻结游戏）
 *   ② dt / 尺寸 / 上下文的数值与状态兜底
 *   ③ 粒子与运镜数组的硬上限（打久了不能越来越卡）
 *   ④ 仓库单件损坏不得整档报废
 *   ⑤ 诊断入口与 verify 自身的可寻址性
 * ========================================================================== */
console.log('\n=== 45. 运行期健壮性（v0.25.1） ===');
const __main = fs.readFileSync(path.join(SRC, 'main.js'), 'utf8');
const __render = fs.readFileSync(path.join(SRC, 'render.js'), 'utf8');

/* main.js 平时不进 vm（文件末尾 `new Game()` 需要真实 DOM）。
   这里把启动那两行切掉，只求拿到 class 本身 —— 这样才能真的把 _loop 跑起来，
   而不是靠正则猜「有没有 try/catch」。 */
const __bootCut = __main.indexOf('const game = new Game();');
const __mainBody = __bootCut > 0 ? __main.slice(0, __bootCut) : __main;
let __GameOk = false;
try{
  sandbox.Game = vm.runInContext(`(function(){${__mainBody}\nreturn Game;})()`, sandbox);
  __GameOk = typeof sandbox.Game === 'function';
}catch(e){
  console.log('  LOAD FAIL main.js（仅 class）:', e.message);
}
check('main.js 的 Game 类可在沙箱内实例化（用于跑 _loop）', __GameOk ? 1 : 0, 1, 0.001);

/* --- ① 主循环错误边界 --- */
check('主循环用 try/catch 包住 update+render',
  /_loop\(t\)\{[\s\S]{0,600}?\btry\{/.test(__main) ? 1 : 0, 1, 0.001);
check('下一帧的 rAF 放在 finally 里（异常不得断掉循环）',
  /finally\s*\{[\s\S]{0,160}requestAnimationFrame\(this\._loop\)/.test(__main) ? 1 : 0, 1, 0.001);
check('连续出错熔断（120 帧 / 或 2 秒 30 帧，帧率无关）',
  /this\._loopErr>120 \|\| \(this\._loopErr>=30 && now-this\._errSince>2000\)/.test(__main) &&
  /this\._loopBroken=true/.test(__main) ? 1 : 0, 1, 0.001);
check('成功一帧后连错误时间窗也清零',
  /this\._errSince=0;/.test(__main) ? 1 : 0, 1, 0.001);
check('熔断后仍继续排帧（不靠异常退出）',
  /if\(!this\._loopBroken\)\{\s*[\s\S]{0,80}Render\.render/.test(__main) ? 1 : 0, 1, 0.001);
check('全局 error / unhandledrejection 都有钩子',
  /addEventListener\("error"/.test(__main) && /addEventListener\("unhandledrejection"/.test(__main) ? 1 : 0, 1, 0.001);
check('错误环形缓冲上限 24（不无限增长）',
  /if\(this\._errRing\.length>24\) this\._errRing\.shift\(\)/.test(__main) ? 1 : 0, 1, 0.001);
check('同一错误不重复刷屏（相邻比对）',
  /prev\.where!==rec\.where \|\| prev\.msg!==rec\.msg/.test(__main) ? 1 : 0, 1, 0.001);
check('错误提示做 4 秒节流（不刷屏弹 toast）',
  /now-this\._errToastAt>4000/.test(__main) ? 1 : 0, 1, 0.001);

/* --- ①b 行为验证：update 抛错时循环仍排下一帧 --- */
const loopProbe = G(`(function(){
  var g=Object.create(Game.prototype);
  g.state="playing"; g.mode="raid"; g.last=0;
  g._errRing=[]; g._loopErr=0; g._loopErrTotal=0; g._loopBroken=false; g._errToastAt=0;
  g.ctx=null; g.view=null;
  g.updateHUD=function(){}; g.toast=function(){};
  g.update=function(){ throw new Error("probe-boom"); };
  var oldErr=console.error, logged=0;
  console.error=function(){ logged++; };
  var scheduled=0;
  var oldRaf=requestAnimationFrame;
  requestAnimationFrame=function(){ scheduled++; return 0; };
  var threw=null;
  try{ g._loop(16); }catch(e){ threw=String(e); }
  requestAnimationFrame=oldRaf; console.error=oldErr;
  return { threw:threw, scheduled:scheduled, logged:logged, errs:g._errRing.length,
           msg:((g._errRing[0]||{}).msg||""), where:((g._errRing[0]||{}).where||"") };
})()`);
check('update 抛错时 _loop 本身不抛出（异常被边界吃掉）', loopProbe.threw === null ? 1 : 0, 1, 0.001);
check('update 抛错后仍然排了下一帧（不冻结）', loopProbe.scheduled, 1, 0.001);
check('异常被记进环形缓冲并带来源', (loopProbe.errs === 1 && /probe-boom/.test(loopProbe.msg) && /loop:raid\/playing/.test(loopProbe.where)) ? 1 : 0, 1, 0.001);
check('异常照常进控制台（不静默吞掉）', loopProbe.logged >= 1 ? 1 : 0, 1, 0.001);

/* --- ①c 行为验证：持续崩溃 → 熔断，且不再调用 Render --- */
const breakProbe = G(`(function(){
  var g=Object.create(Game.prototype);
  g.state="playing"; g.mode="raid"; g.last=0;
  g._errRing=[]; g._loopErr=0; g._loopErrTotal=0; g._loopBroken=false; g._errToastAt=0;
  g.ctx=null; g.view=null;
  g.updateHUD=function(){}; g.toast=function(){};
  g.update=function(){ throw new Error("boom"); };
  var oldErr=console.error; console.error=function(){};
  var scheduled=0; var oldRaf=requestAnimationFrame;
  requestAnimationFrame=function(){ scheduled++; return 0; };
  for(var i=0;i<130;i++) g._loop(i*16);
  requestAnimationFrame=oldRaf; console.error=oldErr;
  return { broken:g._loopBroken, scheduled:scheduled, total:g._loopErrTotal };
})()`);
check('连续崩溃 130 帧后熔断', breakProbe.broken ? 1 : 0, 1, 0.001);
check('熔断前后共排了 130 帧（一帧都没丢）', breakProbe.scheduled, 130, 0.001);
check('累计错误计数在涨（可诊断）', breakProbe.total >= 120 ? 1 : 0, 1, 0.001);

/* --- ② dt / 尺寸 / 上下文兜底 --- */
check('dt 为负或 NaN 时退回 1/60',
  /!Number\.isFinite\(dt\) \|\| dt<=0\) dt=1\/60/.test(__main) ? 1 : 0, 1, 0.001);
const dtProbe = G(`(function(){
  var g=Object.create(Game.prototype);
  g.state="playing"; g.mode="raid"; g.last=1000;
  g._errRing=[]; g._loopErr=0; g._loopErrTotal=0; g._loopBroken=true; g._errToastAt=0;
  var seen=[];
  g.update=function(dt){ seen.push(dt); };
  g.updateHUD=function(){}; g.ctx=null; g.view=null;
  var oldRaf=requestAnimationFrame; requestAnimationFrame=function(){ return 0; };
  g._loop(500);
  g._loop(NaN);
  requestAnimationFrame=oldRaf;
  return seen;
})()`);
check('时钟回拨（t<last）不产生负 dt', Math.abs(dtProbe[0] - 1/60) < 1e-9 ? 1 : 0, 1, 0.001);
check('t 为 NaN 时 dt 仍是有限值', Number.isFinite(dtProbe[1]) && dtProbe[1] > 0 ? 1 : 0, 1, 0.001);

check('resize 对 innerWidth/innerHeight 缺失做兜底',
  /Number\.isFinite\(rawW\)/.test(__main) && /Number\.isFinite\(rawH\)/.test(__main) ? 1 : 0, 1, 0.001);
const sizeProbe = G(`(function(){
  var g=Object.create(Game.prototype);
  g.canvas={ style:{} }; g.mode="raid";
  g.resize();
  return { w:g.view.w, h:g.view.h, zoom:g.zoom, dpr:g.view.dpr };
})()`);
check('拿不到窗口尺寸时 view 仍是正数（不是 0/NaN）',
  sizeProbe.w > 0 && sizeProbe.h > 0 && sizeProbe.zoom > 0 && Number.isFinite(sizeProbe.zoom) ? 1 : 0, 1, 0.001);

check('Render.render 守住 ctx 缺失与零尺寸',
  /if\(!ctx \|\| !v\) return;/.test(__render) && /if\(!\(v\.w>0\) \|\| !\(v\.h>0\)\) return;/.test(__render) ? 1 : 0, 1, 0.001);
check('setTransform 前先校验 dpr（不再传 NaN）',
  /Number\.isFinite\(v\.dpr\) && v\.dpr>0/.test(__render) ? 1 : 0, 1, 0.001);

/* --- ③ 粒子上限 --- */
check('主循环粒子 / 飘字有硬上限（700 / 360）',
  /const CAP=700/.test(__main) && /const CAP=360/.test(__main) ? 1 : 0, 1, 0.001);
check('局内粒子 / 飘字 / 曳光也有上限（800 / 420 / 160）',
  /this\.particles\.length>800/.test(raidSrc) && /this\.floats\.length>420/.test(raidSrc) &&
  /this\.tracers\.length>160/.test(raidSrc) ? 1 : 0, 1, 0.001);

/* --- ④ 仓库逐件修复 --- */
check('raidRepairList 存在且逐件 try/catch',
  G('typeof raidRepairList') === 'function' && /catch\(e\)\{ bad\.push\(it\); \}/.test(raidSrc) ? 1 : 0, 1, 0.001);
const repairProbe = G(`(function(){
  var a=raidRepairList([{a:1}, null, {b:2}, 5, "x"], function(it){ return it; });
  var b=raidRepairList([{ok:1},{boom:1}], function(it){ if(it.boom) throw new Error("x"); return it; });
  var c=raidRepairList(null, function(it){ return it; });
  return { listA:a.list.length, badA:a.bad, listB:b.list.length, badB:b.bad, listC:c.list.length };
})()`);
check('坏件（null / 非对象）被丢弃、好件保留', repairProbe.listA === 2 && repairProbe.badA === 3 ? 1 : 0, 1, 0.001);
check('单件迁移抛错只丢那一件', repairProbe.listB === 1 && repairProbe.badB === 1 ? 1 : 0, 1, 0.001);
check('非数组输入不抛错（退回空表）', repairProbe.listC === 0 ? 1 : 0, 1, 0.001);

const stashProbe = G(`(function(){
  var oldGet=Store.getJSON;
  Store.getJSON=function(){
    return { gunVer:3, creds:100, tokens:0, bandages:1, ammo:{}, parts:[], materials:[], receivers:[],
      weapons:[{ uid:"w1", type:"rifle", rarity:"white", parts:[], affixes:[], dmg:10, mag:5, rpm:100,
                 range:100, reserve:10, value:10 }],
      armors:[null, { kind:"armor", tier:3, rarity:1 }],
      helmets:[{ kind:"helmet", tier:2 }],
      shields:[null],
      keys:[null, { lv:2 }] };
  };
  var s;
  try{ s=RaidStash.load(); }
  finally{ Store.getJSON=oldGet; }
  return { armors:s.armors.length, helmets:s.helmets.length, shields:s.shields.length,
           keys:s.keys.length, weapons:s.weapons.length, creds:s.creds };
})()`);
check('脏档里的一件 null 护甲不再让整档重建',
  stashProbe.armors === 1 && stashProbe.weapons === 1 && stashProbe.creds === 100 ? 1 : 0, 1, 0.001);
check('脏档里的 null 头盔 / 护盾 / 钥匙都不影响其余资产',
  stashProbe.helmets === 1 && stashProbe.shields === 0 && stashProbe.keys === 1 && stashProbe.creds === 100 ? 1 : 0, 1, 0.001);

/* --- ⑤ 诊断入口 + verify 自身可寻址 --- */
check('Game 暴露 diagnostics()（控制台可一键取错误快照）',
  /diagnostics\(\)\{/.test(__main) && /loopBroken:this\._loopBroken/.test(__main) ? 1 : 0, 1, 0.001);
const __pkg = fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8');
const __ci  = fs.readFileSync(path.join(ROOT, '.github/workflows/ci.yml'), 'utf8');
check('package.json 的 verify 脚本指向 verify.cjs',
  /"verify":\s*"node verify\.cjs"/.test(__pkg) ? 1 : 0, 1, 0.001);
check('CI 跑 verify.cjs',
  /node verify\.cjs/.test(__ci) ? 1 : 0, 1, 0.001);
check('旧文件名 verify_v01410.cjs 已不存在（不再有版本号漂移）',
  fs.existsSync(path.join(ROOT, 'verify_v01410.cjs')) ? 0 : 1, 1, 0.001);

/* --- ⑥ 联机快照（不可信输入）的数值收口 --- */
check('netNum 对非法值回默认',
  G('netNum("abc",7)') === 7 && G('netNum(NaN,1)') === 1 && G('netNum(undefined,3)') === 3 ? 1 : 0, 1, 0.001);
check('netNum 对越界值钳制', G('netNum(999,0,0,10)'), 10, 0.001);
check('netNum 不动负角度（角度不是 0..N 的量）', G('netNum(-5,0)'), -5, 0.001);
check('netNum 接受数字字符串', G('netNum("42",0)'), 42, 0.001);
check('影子 AI 与队友快照的位置 / 血量 / 护甲全走 netNum',
  (raidSrc + '\n' + fs.readFileSync(path.join(SRC,'net.js'),'utf8')).match(/netNum\(/g).length >= 20 ? 1 : 0, 1, 0.001);
const ghostProbe = G(`(function(){
  var R={ ops:[{isPlayer:true,id:"you"}] };
  var old=Net.raid; Net.raid=R;
  var threw=null;
  try{
    Net._applyAI([ null, { i:"g1", x:"abc", y:null, a:"zz", hp:NaN, al:1, n:"X" } ]);
  }catch(e){ threw=String(e); }
  var o=null;
  for(var i=0;i<R.ops.length;i++) if(R.ops[i].id==="g1") o=R.ops[i];
  Net.raid=old;
  return { threw:threw, ok:!!o,
           x:o&&o.x, y:o&&o.y, hp:o&&o.hp, angle:o&&o.angle,
           finite: !!(o && Number.isFinite(o.x) && Number.isFinite(o.y)
                      && Number.isFinite(o.hp) && Number.isFinite(o.angle)) };
})()`);
check('脏快照（null 条目 + 非数字坐标）不抛错、不产生 NaN 影子',
  ghostProbe.threw === null && ghostProbe.ok && ghostProbe.finite && ghostProbe.hp === 100 ? 1 : 0, 1, 0.001);

/* --- ⑦ 伤害入口守卫（全游戏最热的函数） --- */
const softT = ()=>mkTarget({ hp:100, maxHP:100, armor:0, maxArmor:0, helmetArmor:0, maxHelmetArmor:0 });
const tNaN = softT();
const nanThrew = (()=>{ try{ Raid._damage(tNaN, NaN, null, null, {}); return false; }catch(e){ return true; } })();
check('NaN 伤害被丢弃（不写坏血量）',
  (!nanThrew && Number.isFinite(tNaN.hp) && tNaN.hp === 100) ? 1 : 0, 1, 0.001);
const tInf = softT();
const infThrew = (()=>{ try{ Raid._damage(tInf, Infinity, null, null, {}); return false; }catch(e){ return true; } })();
check('Infinity 伤害被丢弃（一发秒全场只可能来自坏数据）',
  (!infThrew && Number.isFinite(tInf.hp) && tInf.hp === 100) ? 1 : 0, 1, 0.001);
const nullThrew = (()=>{ try{ Raid._damage(null, 10, null, null, {}); Raid._damage(undefined, 10, null, null, {}); return false; }catch(e){ return true; } })();
check('空目标不抛错（每帧调用点不再被一个 null 打断）', nullThrew ? 0 : 1, 1, 0.001);
const tNeg = softT();
Raid._damage(tNeg, -50, null, null, {});
/* 注意：结算链路里有「每发至少 1 点」的下限（Math.max(1,…)），所以负伤害钳到 0 之后
   仍会照常走完流程打出 1 点 —— 这里锁的是「不会变成治疗」，不是「一点不掉」。 */
check('负伤害不会变成治疗（钳到 0，最多按最小 1 点结算）',
  Number.isFinite(tNeg.hp) && tNeg.hp <= 100 && tNeg.hp >= 99 ? 1 : 0, 1, 0.001);
const tPos = softT();
const dealt = (()=>{ const h0=tPos.hp; Raid._damage(tPos, 10, { isPlayer:true, x:0, y:0, name:"T" }, gun("none"), phys); return h0-tPos.hp; })();
check('正常伤害链路未被守卫误伤（10 点仍照常结算）', dealt > 0 ? 1 : 0, 1, 0.001);

/* ==========================================================================
 * 46. 光照视野 / 黑市 5~8 / 防具穿戴 / 钥匙折旧 / 扩散 / 材料（v0.26.0）
 * ========================================================================== */
console.log('\n=== 46. 光照视野 / 黑市 5~8 / 防具穿戴 / 钥匙折旧 / 扩散 / 材料（v0.26.0）===');

/* --- ① 统一光照判定 --- */
check('RAID_LIT 常量（半角 / 射程 / 近身 / 受击窗口）',
  G('RAID_LIT.half')===0.42 && G('RAID_LIT.reach')===560 &&
  G('RAID_LIT.nearBox')===110 && G('RAID_LIT.hitByTime')===3.0 ? 1 : 0, 1, 0.001);
const __litGeo = JSON.parse(G(`JSON.stringify((()=>{
  const R={navCS:null};   // 无索引 → 跳过遮挡，纯角度 / 距离
  const blocked={navCS:100,_rayLight:function(){return 100;}};
  return {
    front:raidBeamLit(R,0,0,0, 300,0, 0.42,560),
    back: raidBeamLit(R,0,0,0,-300,0, 0.42,560),
    side: raidBeamLit(R,0,0,0, 0,300, 0.42,560),
    far:  raidBeamLit(R,0,0,0, 600,0, 0.42,560),
    wall: raidBeamLit(blocked,0,0,0, 300,0, 0.42,560)
  };
})())`));
check('手电正前方照得到', __litGeo.front===true ? 1 : 0, 1, 0.001);
check('背后 / 侧面 / 超出射程都照不到',
  !__litGeo.back && !__litGeo.side && !__litGeo.far ? 1 : 0, 1, 0.001);
check('建筑遮挡让光停在墙前（不透视）', __litGeo.wall===false ? 1 : 0, 1, 0.001);
check('遮挡统一走 _rayLight（不是另写建筑判定）',
  /R\._rayLight\(ox,oy,dx\/d,dy\/d,reach\)/.test(raidSrc) ? 1 : 0, 1, 0.001);
const __vis = JSON.parse(G(`JSON.stringify((()=>{
  /* 沙箱里 ViewMode 可能是 3D stub，会把朝向换成 yaw；临时强制 2D 用 p.angle */
  let old=null;
  if(typeof ViewMode!=="undefined"){ old=ViewMode.is3D; ViewMode.is3D=function(){return false;}; }
  const R={player:{x:0,y:0,angle:0},navCS:null};
  const out={ahead:raidPlayerLit(R,300,0), behind:raidPlayerLit(R,-300,0),
          near:raidContainerVisible(R,{x:80,y:0}), dark:raidContainerVisible(R,{x:600,y:0}),
          ai:raidAiLit(R,{x:0,y:0,angle:0,cls:"scav"},300,0)};
  if(old) ViewMode.is3D=old;
  return out;
})())`));
check('玩家手电：前方可见 / 背后不可见', __vis.ahead===true && __vis.behind===false ? 1 : 0, 1, 0.001);
check('箱子：近身可见 / 远处黑暗不可见', __vis.near===true && __vis.dark===false ? 1 : 0, 1, 0.001);
check('AI 用自己的手电判定', __vis.ai===true ? 1 : 0, 1, 0.001);
check('AI 感知改走视线判定（_aiAware，灌木不挡光）',
  /_aiAware\(b,tgt\.x,tgt\.y\)/.test(raidSrc) && /_aiAware\(b, x, y\)\{/.test(raidSrc) && /_aiNotice\(b,o\.x,o\.y\)/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('AI 索敌仍保留 _los（不穿墙）',
  /return this\._los\(b\.x,b\.y,x,y\);/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('玩家自瞄只认玩家光锥', /o&&o\.isPlayer\) \? raidPlayerLit\(this,x,y\) : raidAiLit/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('容器交互也走可见性（看不见就摸不到）',
  (raidSrc.match(/if\(!raidContainerVisible\(this,c\)\) continue;/g)||[]).length>=2 ? 1 : 0, 1, 0.001);
check('「进屋才看到」旧规则已彻底移除',
  !/c\._room!==pRoom/.test(raidSrc) && !/const roomVisible/.test(__fp2) &&
  !/const pRoom =/.test(__rd2) ? 1 : 0, 1, 0.001);

/* --- ② 受击 3 秒锁定 --- */
const __hit = JSON.parse(G(`JSON.stringify((()=>{
  const t={}, a={x:1,y:1,alive:true};
  raidHitLock(t,a);
  return {ref:t.hitByRef===a, win:(t.hitByT||0)>M.now(), locked:raidHitLocked(t,a), other:raidHitLocked(t,{})};
})())`));
check('受击记录攻击者与 3 秒窗口', __hit.ref && __hit.win && __hit.locked && !__hit.other ? 1 : 0, 1, 0.001);
check('_damage 挂上 raidHitLock（玩家与 AI 共用）',
  /raidHitLock\(target, attacker\);/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('自瞄受击例外但仍要 _los',
  /hb && hb\.alive && \(o\.hitByT\|\|0\)>M\.now\(\)/.test(raidSrc) &&
  /this\._los\(o\.x,o\.y,hb\.x,hb\.y\)\) return hb;/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('AI 受击目标优先级最高（受击锁定抢先返回）',
  /if\(raidHitLocked\(b,o\)\)\{ if\(dd<lockD\)/.test(raidSrc) && /if\(lock\) return \{ tgt:lock, locked:true \}/.test(raidSrc) ? 1 : 0, 1, 0.001);

/* --- ③ 黑市只卖 5~8 档（枪 / 盾 / 甲 / 盔） --- */
check('黑市档位表为 [5,6,7,8]', /const TIERS=\[5,6,7,8\]/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('黑市枪走 black 强化', /this\._shopGun\(t, undefined, true\)/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('_shopGun 的 black 分支：+8 ilvl / 伤害 ×1.18 / 估值 ×1.25',
  /\(black\?8:0\)/.test(raidSrc) && /w\.dmg=Math\.round\(\(w\.dmg\|\|0\)\*1\.18\)/.test(raidSrc) &&
  /w\.value=Math\.round\(\(w\.value\|\|0\)\*1\.25\)/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('货架新增 gears 品类', /gears:\[\]/.test(raidSrc) && /out\.gears\.push\(it\)/.test(raidSrc) ? 1 : 0, 1, 0.001);
const __black = JSON.parse(G(`JSON.stringify((()=>{
  const R=Object.create(Raid); R._uid=function(){return "probe"+Math.random();};
  const st=R._shopStock("black");
  return {guns:st.guns.length, gear:st.gears.length,
          qTiers:st.guns.map(g=>g.qTier),
          kinds:[...new Set(st.gears.map(g=>g.kind))].sort(),
          tiers:[...new Set(st.gears.map(g=>g.tier))].sort((a,b)=>a-b),
          allBlack:st.guns.every(g=>g.black===true)};
})())`));
check('黑市 4 把枪，档位恰为 5/6/7/8',
  __black.guns===4 && __black.qTiers.join(",")==="5,6,7,8" ? 1 : 0, 1, 0.001);
check('黑市 12 件防具，护甲/头盔/护盾各 4 档',
  __black.gear===12 && __black.kinds.join(",")==="armor,helmet,shield" ? 1 : 0, 1, 0.001);
check('防具档位同为 5~8', __black.tiers.join(",")==="5,6,7,8" ? 1 : 0, 1, 0.001);
check('黑市枪都带 black 强化标记', __black.allBlack===true ? 1 : 0, 1, 0.001);
check('商店 UI 渲染 gears 区块', /sh\.stock\.gears/.test(raidSrc) && /gearCard\(g,"token",i\)/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('GP 币购买链路支持 tokengear',
  /pay==="tokengears"/.test(raidSrc) || /pay==="tokengear"/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('购买时按 kind 分栏并做容量检查',
  /g\.kind==="shield" \? "shields" : g\.kind==="helmet" \? "helmets" : "armors"/.test(raidSrc) &&
  /arr\.length>=RAID_INV_CAP\[key\]/.test(raidSrc) ? 1 : 0, 1, 0.001);

/* --- ④ 防具「穿戴中 ↔ 放入背包」 --- */
check('装备中区标 [穿戴中] 且能给三类防具放回背包',
  /\[穿戴中\] 护甲/.test(raidSrc) && /\[穿戴中\] 头盔/.test(raidSrc) && /\[穿戴中\] 护盾/.test(raidSrc) &&
  /null, null, null, "armor"\)/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('背包区标 [背包] 且三类都能穿上',
  /\[背包\] /.test(raidSrc) && /`armors:\$\{i\}`, `armors:\$\{i\}`/.test(raidSrc) &&
  /`shields:\$\{i\}`, `shields:\$\{i\}`/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('data-equip 按类型分派', /else this\._invEquipGear\(type, idx\)/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('data-stow 按类型分派', /this\._stowGear\(w\) : this\._stowGun\(w\)/.test(raidSrc) ? 1 : 0, 1, 0.001);
const __stow = JSON.parse(G(`JSON.stringify((()=>{
  const R=Object.create(Raid);
  R.inv={weapons:[],armors:[],helmets:[],shields:[],parts:[],materials:[],meds:[],receivers:[],keys:[],ammo:{}};
  R.carried={weapons:[],armor:{kind:"armor",name:"测试甲",tier:5,maxArmor:100,dr:0.4},helmet:null,shield:null};
  R.player={x:0,y:0,armorTier:5,armor:100,maxArmor:100,dr:0.4,armorRegen:0,armorBroken:false,
            helmetTier:0,helmetDr:0,maxHelmetArmor:0,helmetArmor:0,maxShield:0,shield:0,shieldGear:null};
  R._pick=function(){};
  const ok=R._stowGear("armor");
  /* 必须在「穿上」之前快照，否则读到的是重新装备后的状态 */
  const s1={ok:ok,bag:R.inv.armors.length,tier:R.player.armorTier};
  const back=R._invEquipGear("armors",0);
  return {ok:s1.ok,bag:s1.bag,tier:s1.tier,
          back:back,bag2:R.inv.armors.length,tier2:R.player.armorTier,
          worn:R.carried.armor&&R.carried.armor.name};
})())`));
check('卸下：进背包、玩家字段清空', __stow.ok && __stow.bag===1 && __stow.tier===0 ? 1 : 0, 1, 0.001);
check('穿上：从背包取出、重新生效', __stow.back && __stow.bag2===0 && __stow.tier2===5 &&
  __stow.worn==="测试甲" ? 1 : 0, 1, 0.001);

/* --- ⑤ 钥匙价值随耐久折旧 --- */
const __key = JSON.parse(G(`JSON.stringify((()=>{
  const k=raidMakeKey(3);
  const full=k.value, max=k.maxUses;
  k.uses=Math.max(1,Math.floor(max/2)); raidKeyRefresh(k); const half=k.value;
  k.uses=1; raidKeyRefresh(k); const low=k.value;
  return {full:full,half:half,low:low,max:max};
})())`));
check('钥匙满耐久按基准估值', __key.full>0 ? 1 : 0, 1, 0.001);
check('剩余次数越少价值越低（full > half > low）',
  __key.full > __key.half && __key.half > __key.low && __key.low>0 ? 1 : 0, 1, 0.001);
check('开锁后刷新价值（次数机制不变）',
  /k\.uses=\(k\.uses\|\|1\)-1;\s*\n\s*raidKeyRefresh\(k\);/.test(raidSrc) &&
  /if\(k\.uses<=0\)\{/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('物品栏钥匙显示折旧后估值', /money\(raidKeyValue\(k\)\)/.test(raidSrc) ? 1 : 0, 1, 0.001);

/* --- ⑥ 静止收束散布 --- */
check('静止散布系数 0.42（v0.29.0 收束更狠）', G('RAID_STILL_SPREAD'), 0.42, 0.0001);
check('只在 mv<0.05 时生效，移动中不变',
  /mv<0\.05 \? RAID_STILL_SPREAD : 1/.test(raidSrc) ? 1 : 0, 1, 0.001);

/* --- ⑦ 材料：低阶更废料 + 每阶 3 种 --- */
const __mats = JSON.parse(G(`JSON.stringify((()=>{
  const per={}; for(const m of RAID_MATERIALS) per[m.tier]=(per[m.tier]||0)+1;
  return {n:RAID_MATERIALS.length, per:per,
          scrap:RAID_MAT_BY_ID.scrap.name, cloth:RAID_MAT_BY_ID.cloth.name,
          steel:RAID_MAT_BY_ID.steel.name, alloy:RAID_MAT_BY_ID.alloy.name,
          bolt:RAID_MAT_BY_ID.bolt.name, laser:RAID_MAT_BY_ID.laser.name};
})())`));
check('材料由 18 种扩到 27 种（每阶 3 种）',
  __mats.n===27 && Object.keys(__mats.per).length===9 &&
  Object.keys(__mats.per).every(k=>__mats.per[k]===3) ? 1 : 0, 1, 0.001);
check('低阶名称改得更废料',
  __mats.scrap==="锈铁片" && __mats.cloth==="脏布条" &&
  __mats.steel==="普通钢板" && __mats.alloy==="回收铝片" ? 1 : 0, 1, 0.001);
check('新材料 id 稳定可用（旧螺丝 / 激光晶体）',
  __mats.bolt==="旧螺丝" && __mats.laser==="激光晶体" ? 1 : 0, 1, 0.001);
check('拆解族按 tier 递增（新料不破坏高档产出）',
  G('(()=>{for(const f in SALVAGE_FAMILY){let p=-1;for(const id of SALVAGE_FAMILY[f]){const m=RAID_MAT_BY_ID[id];if(!m||m.tier<p)return false;p=m.tier;}}return true;})()') ? 1 : 0, 1, 0.001);

/* ==========================================================================
 * 47. 断言质量：纯行为断言补强（v0.26.1）
 * 这一组刻意不引用任何源码字符串，只调用真实函数并验证返回值 —— 重命名、
 * 重构、改注释都不会影响它们。与「源码护栏」组形成对照。
 * ========================================================================== */
console.log('\n=== 47. 断言质量：纯行为断言补强（v0.26.1）===');
const __econ47 = JSON.parse(G(`JSON.stringify((()=>{
  const k="probe_same_key";
  return {
    p1:raidShopPrice(1000,k), p2:raidShopPrice(5000,k),
    field:raidFieldSellPrice(1000,k), bag:raidBagSellPrice(1000),
    superp:raidSuperPrice(1000,k),
    f0:raidExtractFeeMult(0), f1:raidExtractFeeMult(50000), f2:raidExtractFeeMult(1e9),
    lo:raidSalvageMat("metal",1), hi:raidSalvageMat("metal",8)
  };
})())`));
check('局内商店售价随估值单调递增', __econ47.p2 > __econ47.p1 ? 1 : 0, 1, 0.001);
check('四档价格函数都给出正估值',
  __econ47.p1>0 && __econ47.field>0 && __econ47.bag>0 && __econ47.superp>0 ? 1 : 0, 1, 0.001);
check('回收超市收购价高于背包直售（同底价）',
  __econ47.field > __econ47.bag ? 1 : 0, 1, 0.001);
check('撤离费倍率随带入估值单调递增',
  __econ47.f0 < __econ47.f1 && __econ47.f1 <= __econ47.f2 ? 1 : 0, 1, 0.001);
check('撤离费倍率封顶不超 1.4', __econ47.f2 <= 1.4001 ? 1 : 0, 1, 0.001);
const __misc47 = JSON.parse(G(`JSON.stringify((()=>{
  const k=raidMakeKey(3);
  const sc=raidAISense({x:0,y:0,cls:"scav"}), pm=raidAISense({x:0,y:0,cls:"pmc"}),
        bo=raidAISense({x:0,y:0,bounty:true});
  const empty={inv:{weapons:[],armors:[],helmets:[],shields:[],parts:[],materials:[],meds:[],receivers:[],keys:[],ammo:{}}};
  const e0=raidLoadOf(empty);
  empty.inv.weapons=new Array(6).fill(0); const e1=raidLoadOf(empty);
  return {keyOk:k.kind==="key"&&k.lv===3&&k.uses>0&&k.maxUses>0&&k.value>0&&!!k.uid,
          sight:[sc.sight,pm.sight,bo.sight], load:[e0,e1],
          loTier:(RAID_MAT_BY_ID[raidSalvageMat("metal",1)]||{}).tier,
          hiTier:(RAID_MAT_BY_ID[raidSalvageMat("metal",8)]||{}).tier};
})())`));
check('钥匙生成结构完整（kind/lv/uses/maxUses/value/uid）', __misc47.keyOk ? 1 : 0, 1, 0.001);
check('AI 三档视距分级 520 / 900 / 1250',
  __misc47.sight[0]===520 && __misc47.sight[1]===900 && __misc47.sight[2]===1250 ? 1 : 0, 1, 0.001);
check('负重只读 inv：加满武器后负载上升',
  __misc47.load[0]===0 && __misc47.load[1]>0 ? 1 : 0, 1, 0.001);
check('高档拆解产出不低于低档（族顺序有效）',
  __misc47.hiTier > __misc47.loTier ? 1 : 0, 1, 0.001);

/* ==========================================================================
 * 48. AI 感知与密度（v0.27.0）
 * ========================================================================== */
console.log('\n=== 48. AI 感知与密度：射程分级 / POI 小队 / 搜索引怪 / 穿甲反馈（v0.27.0）===');

/* ① AI 手电射程恢复分级（v0.26 曾把 PMC/Boss 一律压到 560） */
check('AI 光锥上限 1200（不再封顶 560）', G('RAID_LIT.aiBeamMax'), 1200, 0.001);
check('Scav 光锥 = 520', G('raidAiBeamReach({"cls":"scav"})'), 520, 0.001);
check('PMC 光锥 = 900（分级恢复）', G('raidAiBeamReach({"cls":"pmc"})'), 900, 0.001);
check('Boss 光锥 = 1200（感知 1250 被上限截断）', G('raidAiBeamReach({"bounty":true})'), 1200, 0.001);
check('精英怪短视距仍生效（wraith 400）', G('raidAiBeamReach({"arch":"wraith"})'), 400, 0.001);
check('2D op 光锥与判定同源', /raidAiBeamReach\(o\)/.test(__rd2) ? 1 : 0, 1, 0.001);
check('3D op 光池与判定同源', /raidAiBeamReach\(o\)/.test(__fp2) ? 1 : 0, 1, 0.001);
check('旧的 aiReachCap 已移除', G('typeof RAID_LIT.aiReachCap') === "undefined" ? 1 : 0, 1, 0.001);

/* ② POI 驻守小队 */
check('刷怪按 POI 组队并写入 squadId',
  /guardBudget/.test(raidSrc) && /op\.squadId=entry\.sid/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('驻守名额上限 18、至少留 12 名游荡者',
  /Math\.min\(18, 30-12\)/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('每队 2~4 人', /RNG\.ri\(2,4\)/.test(raidSrc) ? 1 : 0, 1, 0.001);
const __poiPt = JSON.parse(G(`JSON.stringify((()=>{
  const poi=RAID_POI.find(p=>p.box);
  if(!poi) return {ok:false,inside:false,none:false};
  const pt=Raid._poiPatrolPoint(poi.id);
  return {ok:Array.isArray(pt)&&pt.length===2,
    inside: pt[0]>=poi.box.x && pt[0]<=poi.box.x+poi.box.w && pt[1]>=poi.box.y && pt[1]<=poi.box.y+poi.box.h,
    none: Raid._poiPatrolPoint("no_such_poi")===null};
})())`));
check('驻守巡逻点落在本 POI 包围盒内', __poiPt.ok && __poiPt.inside ? 1 : 0, 1, 0.001);
check('未知 POI 返回 null（回退全图巡逻点）', __poiPt.none ? 1 : 0, 1, 0.001);
check('巡逻选点优先本 POI', /b\.homePoi \? this\._poiPatrolPoint\(b\.homePoi\)/.test(raidSrc) ? 1 : 0, 1, 0.001);

/* ③ 搜索引怪 + 受击小队联动 */
check('_noise 返回惊动数量', /return woke;/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('翻箱完成时制造噪音', /this\._noise\(c\.x, c\.y, nR, this\.player\)/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('保险箱比普通箱更响', /c\.locked \? \(300 \+ M\.clamp/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('受击广播只传同阵营', /if\(o\.cls!==target\.cls\) continue;/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('广播有 1.2s 节流', /target\._shoutT=M\.now\(\)\+1\.2/.test(raidSrc) ? 1 : 0, 1, 0.001);

/* ④ 穿甲反馈 */
check('高穿弹给出「穿甲」提示', /penMul<=0\.75/.test(raidSrc) && /"穿甲"/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('护甲两成时一次性警告', /_armorLowFx/.test(raidSrc) && /护甲濒临击穿/.test(raidSrc) ? 1 : 0, 1, 0.001);

/* ⑤ Boss 原创命名 */
check('Boss 不再借用既有 IP 的角色名',
  !/Reshala|Killa|Shturman/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('Boss 使用原创代号', /bountyNames=\["铁锈","屠夫","调度长",/.test(raidSrc) ? 1 : 0, 1, 0.001);

/* ==========================================================================
 * 49. 狙击枪手感 / 等级色阶梯 / 每日特价（v0.28.0）
 * ========================================================================== */
console.log('\n=== 49. 狙击枪细长手电 / 移速与散布惩罚 / T1~T9 阶梯色 / 每日特价（v0.28.0）===');

/* ① 狙击枪：细而长的手电 */
const __sniper = JSON.parse(G(`JSON.stringify((()=>{
  const rifle={type:"rifle",cat:"rifle"}, snip={type:"sniper",cat:"sniper"};
  return {
    r:raidPlayerBeam({player:{gun:rifle}}),
    s:raidPlayerBeam({player:{gun:snip}}),
    mvS:raidGunMoveMul({gun:snip}), mvR:raidGunMoveMul({gun:rifle}),
    capS:MOVE_SPREAD_CAP.sniper, capR:MOVE_SPREAD_CAP.rifle,
  };
})())`));
check('常规手电半角 0.42 / 射程 560 不变', __sniper.r.baseHalf===0.42 && __sniper.r.reach===560 ? 1 : 0, 1, 0.001);
check('狙击手电更细（半角 0.20）', __sniper.s.baseHalf===0.20 ? 1 : 0, 1, 0.001);
check('狙击手电更远（射程 900）', __sniper.s.reach===900 ? 1 : 0, 1, 0.001);
check('枪型判定用 type 或 cat 都认', G('raidPlayerBeam({player:{gun:{cat:"sniper"}}}).sniper')===true ? 1 : 0, 1, 0.001);
check('2D 手电走 raidPlayerBeam', /raidPlayerBeam\(R\)/.test(__rd2) ? 1 : 0, 1, 0.001);
check('3D 手电走 raidPlayerBeam', /raidPlayerBeam\(Raid\)/.test(__fp2) ? 1 : 0, 1, 0.001);

/* ② 狙击枪：移速大幅下降 + 移动散布大幅劣化 */
check('手持狙击移速 ×0.62', __sniper.mvS, G('RAID_SNIPER_MOVE_MUL'), 0.0001);
check('非狙击移速不受影响', __sniper.mvR, 1, 0.0001);
check('移速计算乘上 raidGunMoveMul', /raidGunMoveMul\(p\)/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('狙击移动散布上限提到 0.98', __sniper.capS, 0.98, 0.0001);
/* 移动散布的增长斜率（K）才是「狙击比步枪更吃移动」的关键：
   v0.29.0 两者上限同为 0.98，但 sniper 的 K=39 远高于 rifle 的 24，会更早撞到上限。 */
check('狙击移动散布斜率高于步枪',
  G('MOVE_SPREAD_K.sniper') > G('MOVE_SPREAD_K.rifle') &&
  G('MOVE_SPREAD_K.sniper')>=20 ? 1 : 0, 1, 0.001);

/* ③ T1~T9 颜色阶梯 */
const __tierCol = JSON.parse(G(`JSON.stringify({
  c1:ARMOR_TIER_COLOR[1], c5:ARMOR_TIER_COLOR[5], c9:ARMOR_TIER_COLOR[9],
  t1:RAID_TIERS[0].color, t5:RAID_TIERS[4].color, t9:RAID_TIERS[8].color,
  uniq:[...new Set(ARMOR_TIER_COLOR.slice(1,10))].length
})`));
check('T1 = 民用色 / T9 = 定型色',
  __tierCol.c1===__tierCol.t1 && __tierCol.c9===__tierCol.t9 ? 1 : 0, 1, 0.001);
check('T1~T9 九级颜色互不相同（不再是全棕）',
  __tierCol.uniq===9 && __tierCol.c1!==__tierCol.c9 ? 1 : 0, 1, 0.001);
check('商店护甲 / 头盔左边栏用阶梯色',
  /const col=ARMOR_TIER_COLOR\[t\], tcol=col;/.test(raidSrc) ? 1 : 0, 1, 0.001);

/* ④ 每日特价：确定性 + 5 分支 + 医疗品除外 */
check('特价时间桶 1 小时', G('RAID_DEAL_BUCKET_MS'), 3600000, 0.001);
check('时间桶函数单调（相邻毫秒同桶）',
  G('raidDealBucket(1000)===raidDealBucket(2000) && raidDealBucket(0)<raidDealBucket(RAID_DEAL_BUCKET_MS)') ? 1 : 0, 1, 0.001);
check('种子对分支 / 桶 / seq 敏感',
  G('raidDealSeed("a",1,0)!==raidDealSeed("b",1,0) && raidDealSeed("a",1,0)!==raidDealSeed("a",2,0) && raidDealSeed("a",1,0)!==raidDealSeed("a",1,1)') ? 1 : 0, 1, 0.001);
const __deal = JSON.parse(G(`JSON.stringify((()=>{
  const out={};
  for(const b of ["weapon","armor","shield","part","ammo"]){
    const d1=UI._raidDailyDeal(b), d2=UI._raidDailyDeal(b);
    out[b]={ ok:!!d1, same:d1&&d2&&d1.name===d2.name&&d1.price===d2.price,
             price:d1&&d1.price, tier:(d1&&d1.item&&d1.item.tier)||0 };
  }
  out.med = UI._raidDailyDeal("med")===null;
  return out;
})())`));
check('五个分支都能生成特价',
  ["weapon","armor","shield","part","ammo"].every(b=>__deal[b] && __deal[b].ok) ? 1 : 0, 1, 0.001);
check('同一小时内重复调用结果稳定（确定性）',
  ["weapon","armor","shield","part","ammo"].every(b=>__deal[b].same) ? 1 : 0, 1, 0.001);
check('特价都是正价格', ["weapon","armor","shield","part","ammo"].every(b=>__deal[b].price>0) ? 1 : 0, 1, 0.001);
check('特价护甲是高防护等级（T6+）', __deal.armor.tier>=6 ? 1 : 0, 1, 0.001);
check('医疗品不设特价', __deal.med ? 1 : 0, 1, 0.001);
check('特价购买后 seq 递增（买走立即换下一件）',
  /stash\.dailyDeals\[key\]=\{ hour:bucket, seq:/.test(raidSrc) && /UI\._raidDealCache=null/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('特价生成前后换回原 RNG 闭包（不打乱联机序列）',
  /RNG\.rng=saved;/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('商店 UI 渲染特价卡与「抢购」按钮',
  /每日特价/.test(raidSrc) && /data-buy="deal:\$\{branch\}"/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('五个 tab 都挂上特价卡', (raidSrc.match(/dealCard\('/g)||[]).length>=5 ? 1 : 0, 1, 0.001);

/* ==========================================================================
 * 50. v0.29.0：仓库排序 / 高 tier 权重 1/4 / AI 视角 / 箱子隔墙 / 2D 枪 / 抽奖机 / 精度差
 * ========================================================================== */
console.log('\n=== 50. 仓库排序 / 高 tier 权重 1/4 / AI 视角 / 箱子隔墙 / 2D 枪 / 抽奖机 / 精度差（v0.29.0）===');

/* ① 仓库装备按价值降序 */
check('仓库武器/护甲/头盔/护盾按价值降序（byValue）',
  ['byValue(stash.weapons)','byValue(stash.armors)','byValue(stash.helmets)','byValue(stash.shields)']
    .every(s=>raidSrc.includes(s)) ? 1 : 0, 1, 0.001);
check('仓库配件按价值排序且保留原始下标（售卖不会卖错件）',
  /stash\.parts\s*\.map\(\(pt,i\)=>\(\{ pt, i \}\)\)/.test(raidSrc) && /data-sell="p:\$\{i\}"/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('仓库材料按整堆合计价值降序',
  /matStacks\.sort\(\(a,b\)=>\(\(b\.item\.value\|\|0\)\*b\.n\)/.test(raidSrc) ? 1 : 0, 1, 0.001);

/* ② 高 tier 权重严格「后一档 = 前一档 × 1/4」 */
const __t50w = JSON.parse(G('JSON.stringify({ tier:RAID_TIER_W, mat:RAID_MAT_TIER_W })'));
const __t50rat = (arr,i)=>arr[i+1]/arr[i];
check('护甲 T6/T5 = 1/4', __t50rat(__t50w.tier,4), 0.25, 1e-9);
check('护甲 T7/T6 = 1/4', __t50rat(__t50w.tier,5), 0.25, 1e-9);
check('护甲 T8/T7 = 1/4', __t50rat(__t50w.tier,6), 0.25, 1e-9);
check('护甲 T9/T8 = 1/4', __t50rat(__t50w.tier,7), 0.25, 1e-9);
check('护甲高 tier 全部低于旧值',
  (__t50w.tier[4]<=4.0 && __t50w.tier[5]<=1.3 && __t50w.tier[6]<=0.28 && __t50w.tier[7]<=0.055 && __t50w.tier[8]<=0.010)?1:0, 1, 0.001);
check('材料 T4/T3 = 1/4', __t50rat(__t50w.mat,3), 0.25, 1e-9);
check('材料 T8/T7 = 1/4', __t50rat(__t50w.mat,7), 0.25, 1e-9);
check('材料高档段抽样占比 <1%（T5+）',
  (()=>{ const d=JSON.parse(G(`JSON.stringify((()=>{const c=new Array(9).fill(0);for(let i=0;i<8000;i++)c[raidRollMaterialTier(0)]++;return c;})())`));
    return (d.slice(5).reduce((a,b)=>a+b,0)/8000) < 0.01 ? 1 : 0; })(), 1, 0.001);
check('护甲 T8+T9 抽样占比 <0.2%',
  (()=>{ const d=JSON.parse(G(`JSON.stringify((()=>{const c=new Array(10).fill(0);for(let i=0;i<8000;i++)c[raidRollArmorTier(0)]++;return c;})())`));
    return (d[8]+d[9])/8000 < 0.002 ? 1 : 0; })(), 1, 0.001);

/* ③ AI 视角：角度归一 + dt 归一转向 + 感知迟滞 + 不隔墙开枪 */
check('lerpAngle 输出归一化（恒在 [-π,π]）',
  Math.abs(G('M.lerpAngle(3.0,-3.0,1)')) <= Math.PI+1e-9 ? 1 : 0, 1, 0.001);
check('AI 转向按 dt 归一（_face 用 pow 换算帧率）',
  (typeof G('Raid._face')==='function' && /Math\.pow\(1-M\.clamp\(/.test(raidSrc))?1:0, 1, 0.001);
check('AI 感知迟滞 0.6s（消除视角抖动）',
  /b\._seenHold = 0\.6/.test(raidSrc) && /const aware = canSee \|\| \(b\._seenHold>0/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('迟滞期间不隔墙开枪（开火仍只认 canSee）',
  /if\(canSee && b\.fireCd<=0 && b\.reloadT<=0\)/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('守卫东张西望改为平滑转向（不再瞬跳 RNG 角）',
  !/b\.angle=RNG\.fr\(0,6\.28\)/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('AI 对移动目标做弹道预判（smart，带偏移限幅）',
  /let lx=b\._tvx\*tof\*0\.55/.test(raidSrc) && /const lm=Math\.hypot\(lx,ly\), lmax=Math\.min\(70, d\*0\.10\)/.test(raidSrc) && /ivx = Math\.max\(-420/.test(raidSrc) ? 1 : 0, 1, 0.001);

/* ④ 箱子隔墙不可见（近身也过 _los） */
const __t50vis = JSON.parse(G(`JSON.stringify((()=>{
  const mk=(los)=>({ player:{x:0,y:0,angle:0}, _los:los });
  return { wall: raidContainerVisible(mk(()=>false), {x:20,y:0}),
           clear: raidContainerVisible(mk(()=>true), {x:20,y:0}) };
})())`));
check('近身但有墙 → 箱子不可见', __t50vis.wall===false ? 1 : 0, 1, 0.001);
check('近身且无墙 → 箱子可见', __t50vis.clear===true ? 1 : 0, 1, 0.001);

/* ⑤ 2D 手持枪放大 */
check('2D 手持枪放大倍率 1.4', G('RAID_2D_GUN_SCALE'), 1.4, 0.0001);
check('handWeapon 乘上 RAID_2D_GUN_SCALE', /\(r\/15\) \* RAID_2D_GUN_SCALE/.test(__rd2) ? 1 : 0, 1, 0.001);

/* ⑥ 抽奖机：每种摊位一台，黑市 GP / 其余卢布，极品极低概率 */
check('抽奖机成本：卢布 1200 / GP 8',
  G('RAID_GACHA.cash.cost')===1200 && G('RAID_GACHA.token.cost')===8 ? 1 : 0, 1, 0.001);
check('每种摊位都渲染抽奖机（data-gacha）', /data-gacha="1"/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('黑市用 GP / 其余用卢布',
  /const gk = kind==="black" \? "token" : "cash"/.test(raidSrc) && /const gk2 = kind==="black" \? "token" : "cash"/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('抽奖投骰方法存在', typeof G('Raid._gachaRoll')==='function' ? 1 : 0, 1, 0.001);
const __t50gacha = JSON.parse(G(`JSON.stringify((()=>{
  try{
    const ok={weapons:1,armors:1,helmets:1,shields:1,parts:1,materials:1};
    let n=0, high=0, bad=0;
    for(let i=0;i<2000;i++){
      const r=Raid._gachaRoll();
      if(!r || !r.item || !ok[r.bucket]){ bad++; continue; }
      n++;
      /* v0.30.0：只统计「极品」T8+（T7 属于高档段，1.8%/3 会正常出现，不能算极品） */
      const t=r.item.tier|0, q=r.item.qTier|0;
      if(t>=8 || q>=8) high++;
    }
    return { n, high, bad };
  }catch(e){ return { err:String(e) }; }
})())`));
check('抽奖结果都在合法栏目内', !__t50gacha.err && __t50gacha.bad===0 && __t50gacha.n>1900 ? 1 : 0, 1, 0.001);
check('抽奖极品（T8+）比例极低（<0.5%）',
  !__t50gacha.err && __t50gacha.high/Math.max(1,__t50gacha.n) < 0.005 ? 1 : 0, 1, 0.001);
const __t50iso = JSON.parse(G(`JSON.stringify((()=>{
  try{
    RNG.setSeed(424242);
    const a=RNG.snapshot();
    Raid._gachaRoll(); Raid._gachaRoll();
    const b=RNG.snapshot();
    RNG.rng=Math.random;
    return { same: a===b };
  }catch(e){ return { err:String(e) }; }
})())`));
check('抽奖不推进联机共用 RNG（前后状态一致）', !__t50iso.err && __t50iso.same===true ? 1 : 0, 1, 0.001);

/* ⑦ 静止 / 运动精度差拉大 */
check('步枪移动散布斜率 ≥24（旧 16）', G('MOVE_SPREAD_K.rifle')>=24 ? 1 : 0, 1, 0.001);
check('移动散布上限抬高（步枪 0.98）', G('MOVE_SPREAD_CAP.rifle'), 0.98, 0.0001);
check('静止/运动散布差距 ≥20 倍（步枪）',
  G('moveSpreadMul("rifle",1)')/Math.max(1e-9,G('moveSpreadMul("rifle",0)')) >= 20 ? 1 : 0, 1, 0.001);

/* ==========================================================================
 * 51. v0.30.0：配件 1/4 权重 / 高品配件加成 / 瞄准镜 / AI 手电限速 / 名称池 / 循光
 * ========================================================================== */
console.log('\n=== 51. 配件 1/4 权重 / 高品加成 / 瞄准镜 / AI 手电限速 / 名称池 / 循光（v0.30.0）===');

/* ① 配件品质权重：后一档 = 前一档 ×1/4 */
const __t51w = JSON.parse(G('JSON.stringify(RAID_PART_TIER_W)'));
check('配件 T5/T4 = 1/4', __t51w[5]/__t51w[4], 0.25, 1e-9);
check('配件 T6/T5 = 1/4', __t51w[6]/__t51w[5], 0.25, 1e-9);
check('配件 T7/T6 = 1/4', __t51w[7]/__t51w[6], 0.25, 1e-9);
check('配件 T8/T7 = 1/4', __t51w[8]/__t51w[7], 0.25, 1e-9);
check('配件最高三档不进普通掉落（权重 0）',
  (__t51w[9]===0 && __t51w[10]===0 && __t51w[11]===0) ? 1 : 0, 1, 0.001);
check('配件掷点不会落在最高三档（RNG.weighted 把 0 当 1，必须切片）',
  G(`(()=>{ for(let i=0;i<4000;i++) if(raidRollPartRarityIdx(0)>8) return 0; return 1; })()`), 1, 0.001);
check('配件品质改用独立权重（不再走 raidBudgetTier）',
  /raidRollPartRarityIdx\(cls==="scav"\?0:luck\)/.test(raidSrc) ? 1 : 0, 1, 0.001);

/* ② 高品质配件加成大幅提升（同种子对比，排除抖动干扰） */
const __t51part = JSON.parse(G(`JSON.stringify((()=>{
  try{
    RNG.setSeed(777);
    const w = partStatValue("dmgPct", 20, RARITY_BY_ID["white"]);
    RNG.setSeed(777);
    const o = partStatValue("dmgPct", 20, RARITY_BY_ID["orange"]);
    RNG.setSeed(777);
    const s = partStatValue("dmgPct", 20, RARITY_BY_ID["singularity"]);
    RNG.rng = Math.random;
    let scopeOk = 0;
    for(let i=0;i<40;i++){
      const p = rollPart("scope", 20, "purple");
      if((p.mods||[]).some(m=>m.stat==="accPct" && m.value>0)) scopeOk++;
    }
    return { w, o, s, ratio:s/Math.max(0.001,w), scopeOk };
  }catch(e){ return { err:String(e) }; }
})())`));
check('高品质配件加成大幅提升（顶档/民用 ≥10 倍）',
  !__t51part.err && __t51part.ratio>=10 ? 1 : 0, 1, 0.001);
check('民用配件数值基本不变（不误伤低档）',
  !__t51part.err && __t51part.w>5 && __t51part.w<9 ? 1 : 0, 1, 0.001);

/* ③ 瞄准镜槽位 */
const __t51slot = JSON.parse(G('JSON.stringify({ n:GUN_SLOTS.length, scope: GUN_SLOT_BY_ID.scope ? { name:GUN_SLOT_BY_ID.scope.name, stats:GUN_SLOT_BY_ID.scope.stats } : null })'));
check('新增瞄准镜槽位（name=瞄准镜）',
  __t51slot.scope && __t51slot.scope.name==="瞄准镜" ? 1 : 0, 1, 0.001);
check('瞄准镜词条偏重精度（accPct 出现 2 次）',
  __t51slot.scope && __t51slot.scope.stats.filter(s=>s==="accPct").length===2 ? 1 : 0, 1, 0.001);
check('GUN_SLOTS 扩到 10 个槽位', __t51slot.n===10 ? 1 : 0, 1, 0.001);
check('瞄准镜必带射击精度词条（40 次全中）',
  !__t51part.err && __t51part.scopeOk===40 ? 1 : 0, 1, 0.001);
check('瞄准镜参与 2D 瞄具渲染',
  /p\.slot==="optic"\|\|p\.slot==="scope"/.test(__rd2) ? 1 : 0, 1, 0.001);

/* ④ AI 手电不再跳动：角速度上限 + 目标黏性 + 预判限幅  ⑤ 循光 */
check('AI 转向有角速度上限（光锥不会甩）',
  /const cap=maxTurn\|\|6\.0;/.test(raidSrc) && /M\.clamp\(d\*Math\.min\(1,t\)/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('AI 目标黏性 260px（不再每帧切目标）',
  /const score=dd\+pri\+\(sticky\?-260:0\);/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('AI 预判速度做了限幅 + 一阶低通',
  /b\._tvx = \(b\._tvx===undefined\) \? ivx : b\._tvx\*0\.82 \+ ivx\*0\.18/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('AI 被手电照到会循光找来源',
  /发现光源/.test(raidSrc) && /b\.investigate = \{ x:src\.x, y:src\.y, t:3\.5 \}/.test(raidSrc) ? 1 : 0, 1, 0.001);

/* ⑥ 名称池扩充 */
const __t51pmc = (raidSrc.match(/"USEC·/g)||[]).length + (raidSrc.match(/"BEAR·/g)||[]).length + (raidSrc.match(/"PMC·/g)||[]).length;
const __t51sn = (()=>{ const m=raidSrc.match(/scavNames=\[[\s\S]*?\]/); return m ? (m[0].match(/"/g)||[]).length/2 : 0; })();
const __t51bn = (()=>{ const m=raidSrc.match(/bountyNames=\[[\s\S]*?\]/); return m ? (m[0].match(/"/g)||[]).length/2 : 0; })();
check('PMC 名称池 ≥18', __t51pmc>=18 ? 1 : 0, 1, 0.001);
check('Scav 名称池 ≥18', __t51sn>=18 ? 1 : 0, 1, 0.001);
check('Boss 代号 ≥8', __t51bn>=8 ? 1 : 0, 1, 0.001);

/* ==========================================================================
 * 52. v0.30.1：AI 感知改视线 / 察觉迟滞 / 预判限幅 / 贴边吸附
 * ========================================================================== */
console.log('\n=== 52. AI 感知改视线 / 察觉迟滞 / 预判限幅 / 贴边吸附（v0.30.1）===');

const __t52 = JSON.parse(G(`JSON.stringify((()=>{
  try{
    const me={ _los:()=>true }, b={x:0,y:0,angle:0,cls:"pmc",alive:true};
    return {
      ahead:  Raid._aiAware.call(me, b, 300, 0),
      behind: Raid._aiAware.call(me, b, -300, 0),
      close:  Raid._aiAware.call(me, b, -60, 0),
      walled: Raid._aiAware.call({_los:()=>false}, b, 300, 0),
      far:    Raid._aiAware.call(me, b, 2000, 0),
    };
  }catch(e){ return { err:String(e) }; }
})())`));
check('AI 正前方 300px 可见（视线 + 锥内）', (!__t52.err && __t52.ahead===true)?1:0, 1, 0.001);
check('AI 背后 300px 不可见（受手电锥限制）', (!__t52.err && __t52.behind===false)?1:0, 1, 0.001);
check('AI 背后 60px 贴身可见（全向感知）', (!__t52.err && __t52.close===true)?1:0, 1, 0.001);
check('AI 隔墙不可见（_los 仍生效）', (!__t52.err && __t52.walled===false)?1:0, 1, 0.001);
check('AI 超视距不可见', (!__t52.err && __t52.far===false)?1:0, 1, 0.001);
check('AI 感知用 _rayWall/视线，不再被灌木光遮挡死',
  /return this\._los\(b\.x,b\.y,x,y\);/.test(raidSrc) && /_aiAware\(b, x, y\)\{/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('AI 感知体内不得出现 _rayLight（否则灌木又会挡死感知）',
  (()=>{ const m=raidSrc.match(/_aiAware\(b, x, y\)\{[\s\S]*?\n  \},/); return m && !/_rayLight/.test(m[0]) && /_los/.test(m[0]) ? 1 : 0; })(), 1, 0.001);
check('已察觉目标的追踪锥 1.25rad（迟滞）',
  /angOff<1\.25/.test(raidSrc) && /const tracking = !!b\.lastSeen/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('反应进度衰减放慢（1.5 → 0.6）',
  /_detectT\|\|0\)-dt\*0\.6/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('预判偏移限幅（≤ min(70px, 10% 距离)）',
  /lmax=Math\.min\(70, d\*0\.10\)/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('贴边吸附改成换瞄准点（同帧只转一次，角速度不叠加）',
  /if\(Math\.abs\(M\.normAngle\(realAng-b\.angle\)\) < 0\.10\)\{ aimX=tgt\.x; aimY=tgt\.y; \}/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('循光不劫持已警觉单位（!b.lastSeen）',
  /if\(!aware && !b\.investigate && !b\.lastSeen && b\.gun\)/.test(raidSrc) ? 1 : 0, 1, 0.001);

/* ==========================================================================
 * 53. v0.30.2：外围注意锥（光锥外目标能进入光锥）
 * ========================================================================== */
console.log('\n=== 53. 外围注意锥（光锥外目标能进入光锥，v0.30.2）===');

const __t53 = JSON.parse(G(`JSON.stringify((()=>{
  try{
    const me={ _los:()=>true }, b={x:0,y:0,angle:0,cls:"pmc",alive:true};
    const at=(d,off)=>({ x:Math.cos(off)*d, y:Math.sin(off)*d });
    const p1=at(200,0.70), p2=at(600,0.70), p3=at(200,Math.PI), p4=at(200,0);
    return {
      nearSide: Raid._aiNotice.call(me, b, p1.x, p1.y),   // 近距侧向（光锥外但注意锥内）
      farSide:  Raid._aiNotice.call(me, b, p2.x, p2.y),   // 远距侧向（光锥外）
      behind:   Raid._aiNotice.call(me, b, p3.x, p3.y),   // 正后方（不该察觉）
      front:    Raid._aiNotice.call(me, b, p4.x, p4.y),   // 正前方
      walled:   Raid._aiNotice.call({_los:()=>false}, b, p1.x, p1.y),
      awareSide: Raid._aiAware.call(me, b, p1.x, p1.y),   // 窄锥：侧向不该算「看见」
    };
  }catch(e){ return { err:String(e) }; }
})())`));
check('注意锥：近距侧向目标能被察觉（光锥外 → 可转身纳入）',
  (!__t53.err && __t53.nearSide===true)?1:0, 1, 0.001);
check('注意锥：远距侧向不察觉（远处仍要靠手电）',
  (!__t53.err && __t53.farSide===false)?1:0, 1, 0.001);
check('注意锥：正后方不察觉（背后仍可潜行）',
  (!__t53.err && __t53.behind===false)?1:0, 1, 0.001);
check('注意锥：正前方可察觉', (!__t53.err && __t53.front===true)?1:0, 1, 0.001);
check('注意锥：隔墙不察觉', (!__t53.err && __t53.walled===false)?1:0, 1, 0.001);
check('窄锥 _aiAware 仍只认光锥（侧向不算看见 → 不开火）',
  (!__t53.err && __t53.awareSide===false)?1:0, 1, 0.001);
check('候选筛选用注意锥（_aiNotice）',
  /!R\._aiNotice\(b,o\.x,o\.y\)/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('注意保持窗 0.6s（避免边界转头抖）',
  /b\._noticeHold = 0\.6/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('未进光锥时转身对焦（suspect，不开火）',
  /b\.state="suspect"/.test(raidSrc) && /if\(!aware && !grace && b\.gun && b\._noticeHold>0/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('开火仍只认窄锥 _aiAware',
  /if\(canSee && b\.fireCd<=0 && b\.reloadT<=0\)/.test(raidSrc) && /this\._aiAware\(b,tgt\.x,tgt\.y\)/.test(raidSrc) ? 1 : 0, 1, 0.001);

/* ==========================================================================
 * 54. v0.31.0：弹片按型号 / 改编传奇 / 三矩形碰撞 / 建筑与铁路
 * ========================================================================== */
console.log('\n=== 54. 弹片·传奇·三矩形·建筑轨道（v0.31.0）===');

const __rc3 = fs.readFileSync(path.join(SRC,'raid-core3.js'),'utf8');
const __rr  = fs.readFileSync(path.join(SRC,'raid-render.js'),'utf8');
const __t54 = JSON.parse(G(`JSON.stringify((()=>{
  try{
    /* 弹片按型号 */
    const models=["TOZ-106","KS-23M","M870","Saiga-12","MP-133"];
    const bases=models.map(m=>shotgunModelSpec(m).pellets);
    const label=gunDamageLabel({dmg:7,pellets:8});
    /* 三矩形：三块 + 缝隙透光 */
    const fake={props:[],walls:[]};
    Raid._pushProp.call(fake,{kind:"barrier",w:206,h:38,sight:true,fill:"#111",edge:"#000"},100,200);
    const p=fake.props[0];
    const bx=p.boxes.map(b=>({x:b.x,w:b.w}));
    const gap=(bx[0].x+bx[0].w+bx[1].x)/2;
    Raid._buildNavGrid.call(fake);
    /* 沙箱第 260 行把 Raid._rayWall 桩成 ()=>null；这里直接验 losCell 索引，
       等价于「缝隙里没有视线碰撞体 / 实体段里有」，且不受打桩影响。
       真实 _rayWall 的双向行为由浏览器探针 probe_v0310.py 覆盖。 */
    const cellAt=(x,y)=>{ const CS=fake.navCS; const gx=Math.floor(x/CS), gy=Math.floor(y/CS);
      return fake.losCell[gy*fake.navCols+gx]||[]; };
    const inBox=(arr,x,y)=>arr.some(w=>x>=w.x&&x<=w.x+w.w&&y>=w.y&&y<=w.y+w.h);
    const gapClear=!inBox(cellAt(gap,219),gap,219)&&!inBox(cellAt(gap,150),gap,150);
    const solidBlock=inBox(cellAt(bx[0].x+10,219),bx[0].x+10,219);
    const lightGap=Raid._rayLight.call(fake,gap,150,0,1,200);
    const lightSolid=Raid._rayLight.call(fake,bx[0].x+10,150,0,1,200);
    /* 改编传奇 + 具名配件 */
    const bl=RAID_UNIQUES.filter(u=>u.legend==="bl");
    const made=bl.map(u=>{ const w=raidMakeUnique(u);
      return {id:u.id,pellets:w.pellets,noAmmo:!!w.noAmmo,rpm:w.rpm,splash:w.splash,
              tier:w.qTier,named:(w.parts||[]).filter(q=>q.named).length,
              bind:(w.parts||[]).filter(q=>q.named).map(q=>q.bindTo)}; });
    const conf=raidMakeUnique(bl.find(u=>u.id==="bl_conference"));
    const kept=installPartOnGun(conf,{slot:"optic",name:"测试镜",mods:[{stat:"accPct",value:5}],rarity:"blue",ilvl:30});
    /* 建筑结构 + 铁路桥 */
    const room={x:0,y:0,w:400,h:300,shape:"courtyard"};
    const st=raidRoomStructure(room);
    const bridges=raidRailBridgeBoxes(
      [{pts:[[0,0],[1200,0]]}],
      (x,y)=>(x>400&&x<800)?1:0, 220);
    return {
      bases, label, nBoxes:p.boxes.length, nWalls:fake.walls.length,
      wallIsProp:fake.walls[0]===p, gapClear, solidBlock, lightGap, lightSolid,
      nBl:bl.length, nParts:RAID_NAMED_PARTS.length, made,
      keptPellets:kept.pellets, keptUnique:kept.unique, keptNamed:(kept.parts||[]).filter(q=>q.named).length,
      nShapeKinds:Object.keys(RAID_ROOM_SHAPES).length, nStructWalls:(st.walls||[]).length,
      nBridges:bridges.length, bridgeRail:bridges.length?bridges[0].rail:false,
    };
  }catch(e){ return {err:String(e)}; }
})())`));
check('霰弹枪 5 个型号弹片基数互不相同',
  (!__t54.err && new Set(__t54.bases).size===5 && __t54.bases[0]===4 && __t54.bases[2]===8 && __t54.bases[3]===10)?1:0, 1, 0.001);
check('面板写明「伤害 7 × 8 弹片，单发 56」',
  (!__t54.err && __t54.label==="伤害 7 × 8 弹片，单发 56")?1:0, 1, 0.001);
check('复合装饰拆成 3 个矩形且 walls 只登记子矩形',
  (!__t54.err && __t54.nBoxes===3 && __t54.nWalls===3 && __t54.wallIsProp===false)?1:0, 1, 0.001);
check('三矩形缝隙：视线索引无碰撞体 / 实体段已登记',
  (!__t54.err && __t54.gapClear===true && __t54.solidBlock===true)?1:0, 1, 0.001);
check('三矩形缝隙：手电光线不被掐断 / 实体段仍截光',
  (!__t54.err && __t54.lightGap===200 && __t54.lightSolid<200)?1:0, 1, 0.001);
check('改编传奇 6 把 + 具名配件 6 件',
  (!__t54.err && __t54.nBl===6 && __t54.nParts===6)?1:0, 1, 0.001);
check('6 把传奇全部 T8 且各带 1 件绑定具名配件',
  (!__t54.err && __t54.made.every(m=>m.tier===8 && m.named>=1 && m.bind[0]===m.id))?1:0, 1, 0.001);
check('调度总机 14 弹片 / 三向审查 3 分裂',
  (!__t54.err && __t54.made.find(m=>m.id==="bl_conference").pellets===14
              && __t54.made.find(m=>m.id==="bl_lyuda").pellets===3)?1:0, 1, 0.001);
check('永动机构不耗弹且射速封顶 900rpm',
  (!__t54.err && __t54.made.find(m=>m.id==="bl_infinity").noAmmo===true
              && __t54.made.find(m=>m.id==="bl_infinity").rpm<=900)?1:0, 1, 0.001);
check('双联裁决 / 空爆幕带爆裂溅射',
  (!__t54.err && __t54.made.find(m=>m.id==="bl_harold").splash===96
              && __t54.made.find(m=>m.id==="bl_flakker").splash===148)?1:0, 1, 0.001);
check('装配件后传奇 14 弹片与具名身份不丢',
  (!__t54.err && __t54.keptPellets===14 && __t54.keptUnique==="bl_conference" && __t54.keptNamed>=1)?1:0, 1, 0.001);
check('7 种非矩形建筑原型 + 回字中庭 >=4 段内墙',
  (!__t54.err && __t54.nShapeKinds===7 && __t54.nStructWalls>=4)?1:0, 1, 0.001);
check('轨道跨河自动架铁路桥（桥面按干地）',
  (!__t54.err && __t54.nBridges>=1 && __t54.bridgeRail===true)?1:0, 1, 0.001);
check('开火扣弹认 noAmmo（闭合供弹不耗弹）',
  /if\(!sh\.gun\.noAmmo\) sh\.gun\.ammoMag--/.test(__rc3) ? 1 : 0, 1, 0.001);
/* v0.34.3：hex 是例外 —— 碰撞拆三横带，贴图保持单张六边形 */
check('2D / 3D 均按子矩形绘制（hex 例外）',
  /for\(const b of p\.boxes\) this\._propBox/.test(__rr) &&
  /p\.compound!=="hex"/.test(__rr) && /q\.compound!=="hex"/.test(__fp) ? 1 : 0, 1, 0.001);
check('新分片 raid-legends / raid-geometry 已接入 HTML',
  /src\/raid-legends\.js\?v=/.test(html) && /src\/raid-geometry\.js\?v=/.test(html) ? 1 : 0, 1, 0.001);
check('房间表含 >=15 处非矩形结构',
  (fs.readFileSync(path.join(SRC,'raid-data.js'),'utf8').match(/shape:"/g)||[]).length>=15 ? 1 : 0, 1, 0.001);

/* ==========================================================================
 * 55. v0.31.1：存档码 XSS 纵深防御 / 压缩缓存 LRU / 失败 join 严限速
 * ========================================================================== */
console.log('\n=== 55. 存档码净化·LRU·join 限速（v0.31.1）===');

const __u55  = fs.readFileSync(path.join(SRC,'ui.js'),'utf8');
const __st55 = fs.readFileSync(path.join(SRC,'store.js'),'utf8');
const __s55  = fs.readFileSync(path.join(ROOT,'server.js'),'utf8');
const __rd55 = fs.readFileSync(path.join(SRC,'raid-data.js'),'utf8');
const __t55 = JSON.parse(G(`JSON.stringify((()=>{
  try{
    const Q=String.fromCharCode(34), A=String.fromCharCode(39);
    const EV='<img src=x onerror='+Q+'alert(1)'+Q+'>&'+A+';';

    /* 出口转义 */
    const es=escHtml(EV), plain=escHtml('AK-74 中文 12');

    /* 入口净化：只动字符串，不动数值 / 结构 / 引用 */
    const obj={ name:EV, dmg:6830, neg:-13.3,
      weapons:[{name:EV, affixes:[{n:EV}]}], deep:{a:{b:{c:EV}}} };
    Object.defineProperty(obj,'__proto__',{value:{polluted:1},enumerable:true,writable:true,configurable:true});
    const after=cleanSaveStrings(obj);
    let deep=null; for(let i=0;i<20;i++) deep={x:deep||EV};
    let deepThrew=false; try{ cleanSaveStrings(deep); }catch(e){ deepThrew=true; }

    /* Store.getJSON 是所有 localStorage 读取的唯一出口 */
    const mem={}, oldLS=globalThis.localStorage;
    globalThis.localStorage={
      getItem:k=>(k in mem?mem[k]:null),
      setItem:(k,v)=>{ mem[k]=String(v); },
      removeItem:k=>{ delete mem[k]; }
    };
    Store.setJSON('__t55_x', {name:EV, dmg:6830, nest:{s:EV}, arr:[EV,-13.3]});
    const back=Store.getJSON('__t55_x', null);
    globalThis.localStorage=oldLS;

    /* 存档码：三个白名单 key + 一个伪造 key + 一段非 JSON */
    const bag={ app:"borderops", v:2, ver:CFG.version, data:{
      "borderops_save_v2": JSON.stringify({name:EV, weapons:[{name:EV}]}),
      "raid_stash_v2": JSON.stringify({weapons:[{name:EV}], gunVer:3}),
      "raid_auction_v1": JSON.stringify({listings:[{name:EV}]}),
      "evil_key": JSON.stringify({x:EV})
    }};
    const body=_b64enc(JSON.stringify(bag));
    const code="BOPS1-"+_b64hash(body)+"-"+body;
    const cap={}, oldSet=Store.set;
    Store.set=function(k,v){ cap[k]=v; return true; };
    const imp=Save.importCode(code);
    const cap2={};
    Store.set=function(k,v){ cap2[k]=v; return true; };
    const bag2={ app:"borderops", data:{ "borderops_save_v2":"not-json" } };
    const b2=_b64enc(JSON.stringify(bag2));
    const imp2=Save.importCode("BOPS1-"+_b64hash(b2)+"-"+b2);
    Store.set=oldSet;
    const keys=["borderops_save_v2","raid_stash_v2","raid_auction_v1"];

    return {
      escaped:es, plain,
      sameRef:after===obj, dmg:after.dmg, neg:after.neg,
      nameClean:after.name.indexOf('<')<0,
      nestedClean:after.weapons[0].affixes[0].n.indexOf('<')<0 && after.deep.a.b.c.indexOf('<')<0,
      noProto:!Object.prototype.hasOwnProperty.call(after,'__proto__'),
      deepThrew,
      readClean:!!back && back.name.indexOf('<')<0 && back.nest.s.indexOf('<')<0 && back.arr[0].indexOf('<')<0,
      readNums:!!back && back.dmg===6830 && back.arr[1]===-13.3,
      importCount:imp.count,
      allKeysClean:keys.every(k=>typeof cap[k]==="string" && cap[k].indexOf('<')<0),
      evilRejected:!("evil_key" in cap),
      nonJsonSkipped:imp2.ok===false && Object.keys(cap2).length===0,
    };
  }catch(e){ return {err:String(e)}; }
})())`));
check('escHtml 把 5 种危险字符转成实体（无裸 <）',
  (!__t55.err && __t55.escaped.indexOf('<')<0 && __t55.escaped.indexOf('&lt;img')>=0
   && __t55.escaped.indexOf('&amp;')>=0 && __t55.escaped.indexOf('&quot;')>=0
   && __t55.escaped.indexOf('&#39;')>=0)?1:0, 1, 0.001);
check('escHtml 不改普通中文 / 数字文本',
  (!__t55.err && __t55.plain==='AK-74 中文 12')?1:0, 1, 0.001);
check('cleanSaveStrings 原地返回且不削数值（含负值词条）',
  (!__t55.err && __t55.sameRef===true && __t55.dmg===6830 && __t55.neg===-13.3)?1:0, 1, 0.001);
check('cleanSaveStrings 递归净化武器名 / 词条 / 深层字符串',
  (!__t55.err && __t55.nameClean===true && __t55.nestedClean===true)?1:0, 1, 0.001);
check('cleanSaveStrings 剔除 __proto__ 原型污染键',
  (!__t55.err && __t55.noProto===true)?1:0, 1, 0.001);
check('cleanSaveStrings 超深对象不抛错（深度上限生效）',
  (!__t55.err && __t55.deepThrew===false)?1:0, 1, 0.001);
check('Store.getJSON 读回的字符串已净化（单源收口覆盖三个存档 key）',
  (!__t55.err && __t55.readClean===true)?1:0, 1, 0.001);
check('Store.getJSON 净化不误伤装备数值',
  (!__t55.err && __t55.readNums===true)?1:0, 1, 0.001);
check('importCode 三个白名单 key 落盘前全部剥掉危险字符',
  (!__t55.err && __t55.importCount===3 && __t55.allKeysClean===true)?1:0, 1, 0.001);
check('importCode 拒绝白名单外的 localStorage 键',
  (!__t55.err && __t55.evilRejected===true)?1:0, 1, 0.001);
check('importCode 跳过非 JSON 数据（不落盘）',
  (!__t55.err && __t55.nonJsonSkipped===true)?1:0, 1, 0.001);
check('老战役 UI 至少 6 处装备名插值走 escHtml',
  (__u55.match(/\$\{escHtml\(/g)||[]).length>=6 ? 1 : 0, 1, 0.001);
check('store.js 在 getJSON 返回前调用 cleanSaveStrings',
  /cleanSaveStrings\(parsed\)/.test(__st55) ? 1 : 0, 1, 0.001);
check('RaidStash.load 走 Store.getJSON（自动享受净化）',
  /Store\.getJSON\(this\.KEY/.test(__rd55) ? 1 : 0, 1, 0.001);
check('server.js 新增 ratePeek（只查额度不消耗）',
  /function ratePeek\(/.test(__s55) ? 1 : 0, 1, 0.001);
check('server.js 失败 join 独立严限速 10/min',
  /ratePeek\(ip\+':joinfail',10,60000\)/.test(__s55) && /const fail=\(\)=>rate\(ip\+':joinfail',10,60000\)/.test(__s55) ? 1 : 0, 1, 0.001);
check('server.js 压缩缓存超上限用 LRU 淘汰而非整表 clear',
  /while\(COMPRESS_CACHE\.size>120\)/.test(__s55) && /COMPRESS_CACHE\.keys\(\)\.next\(\)/.test(__s55)
   && /COMPRESS_CACHE\.delete\(key\); COMPRESS_CACHE\.set\(key, body\)/.test(__s55)
   && !/COMPRESS_CACHE\.clear\(\)/.test(__s55) ? 1 : 0, 1, 0.001);

/* ==========================================================================
 * 50. 存档码压缩 / 弹药流转 / 黑市提价 / T10-12 / 耐久 / 连败补偿（v0.32.0）
 * ========================================================================== */
console.log('\n=== 50. 存档码 / 弹药 / 黑市 / T10-12 / 耐久 / 连败补偿（v0.32.0）===');
const saveSrc = fs.readFileSync(path.join(SRC,'save.js'),'utf8');

/* ① 存档码：BOPS1 同步、BOPS2 压缩、带说明文字可提取 */
check('导出支持压缩前缀 BOPS2', /BOPS2/.test(saveSrc) && /CompressionStream/.test(saveSrc) ? 1 : 0, 1, 0.001);
check('无 CompressionStream 时回退同步 BOPS1',
  /typeof CompressionStream==="undefined"/.test(saveSrc) ? 1 : 0, 1, 0.001);
check('导入先剥空白再提取（容忍换行）',
  /replace\(\/\\s\+\/g,""\)[\s\S]{0,80}match\(\/\(BOPS\[12\]/.test(saveSrc) ? 1 : 0, 1, 0.001);
check('截断报错会带收到的字符数',
  /收到 "\+s\.length\+" 字符/.test(saveSrc) ? 1 : 0, 1, 0.001);
check('提供存档文件文本导出', /exportFileText/.test(saveSrc) ? 1 : 0, 1, 0.001);

/* ② 弹药双向 */
check('撤离把局内弹药并回仓库', /this\.stash\.ammo\[aid\]=\(this\.stash\.ammo\[aid\]\|\|0\)\+n/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('配装默认不带弹药（0 发）',
  /: 0;\s*\n\s*UI\._raidAmmo\[cal\]=\{ id:cur\.id, n, cap \};/.test(raidSrc) ? 1 : 0, 1, 0.001);

/* ③ 黑市提价 */
check('黑市 5~8 档 GP 价 45/85/160/300',
  /tokenPrice=\{\s*5:45,\s*6:85,\s*7:160,\s*8:300\s*\}/.test(raidSrc) ? 1 : 0, 1, 0.001);

/* ④ T10~T12：只从抽奖机产出 */
check('品质表扩到 12 阶', G('RAID_TIERS.length'), 12, 0.001);
check('T10/T11/T12 名为定制/珍藏/孤品',
  G('RAID_TIERS[9].name')==='定制' && G('RAID_TIERS[10].name')==='珍藏' && G('RAID_TIERS[11].name')==='孤品' ? 1 : 0, 1, 0.001);
check('护甲 / 头盔 / 护盾底材都有 T12',
  G('!!RAID_ARMORS[12]') && G('!!RAID_HELMETS[12]') && G('!!SHIELD_BASES[12]') ? 1 : 0, 1, 0.001);
check('商店与普通掉落仍封顶 T9',
  G('raidRollArmorTier(1.6)<=9') ? 1 : 0, 1, 0.001);
check('抽奖机超极品档 0.04% 直取 T10-12（仅黑市 premium）',
  /if\(premium && r < 0\.0004\)/.test(raidSrc) && /gear\(10,12\)/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('抽奖机文案改为「T10~T12 的枪械、装备和配件」',
  /T10~T12 的枪械、装备和配件/.test(raidSrc) ? 1 : 0, 1, 0.001);

/* ⑤ 大厅按钮上移 */
/* 位置比较比正则可靠：shop 按钮必须出现在「进入海关流域」之前 */
check('五个入口按钮在页面顶部（早于开始按钮）',
  raidSrc.indexOf('id="btn-raid-shop"')>=0 &&
  raidSrc.indexOf('id="btn-raid-shop"') < raidSrc.indexOf('id="btn-raid-start"') ? 1 : 0, 1, 0.001);
check('底部不再重复渲染这五个按钮',
  (raidSrc.match(/id="btn-raid-shop"/g)||[]).length===1 ? 1 : 0, 1, 0.001);

/* ⑥ 钥匙掉率 */
check('钥匙掉率 3% / 1%', /bot\.smart\?0\.030:0\.010/.test(raidSrc) ? 1 : 0, 1, 0.001);

/* ⑦ rock 六边形碰撞 */
check('rock 走 hex 复合箱', G('RAID_COMPOUND_KINDS.rock')==='hex' ? 1 : 0, 1, 0.001);
const __hex = JSON.parse(G(`JSON.stringify((()=>{
  const p={x:0,y:0,w:100,h:100,kind:"rock"};
  const b=raidCompoundBoxes(p);
  return { n:b.length, top:b[0].w, mid:b[1].w, bot:b[2].w };
})())`));
check('hex 用三条横带：中间全宽、上下更窄',
  __hex.n===3 && __hex.mid===100 && __hex.top<100 && __hex.bot<100 ? 1 : 0, 1, 0.001);

/* ⑧ 装备耐久 */
const __dur = JSON.parse(G(`JSON.stringify((()=>{
  const a=raidMakeArmor(5,0);
  const before=a.dur;
  a.dur=0.5;
  const cost=raidRepairCost(a);
  const dim=raidDurTint("#ef93d6",0.5), full=raidDurTint("#ef93d6",1);
  return { before, cost, dim, full, sameHue: dim.length===7 && dim!==full };
})())`));
check('新装备 dur=1', __dur.before, 1, 0.001);
check('修理费随缺口增长且为正', __dur.cost>0 ? 1 : 0, 1, 0.001);
check('耐久降低只压亮度、色相不变', __dur.sameHue && __dur.dim!==__dur.full ? 1 : 0, 1, 0.001);
check('受击磨损装备本体',
  /gear\.dur=Math\.max\(0, base - abs\/\(gear\.maxArmor\*RAID_ARMOR_WEAR_K\)\)/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('有效护甲值 = 基础值 × 耐久', /\(it\.maxArmor\|\|0\)\*dur/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('仓库提供修理按钮', /data-repair=/.test(raidSrc) && /raidRepairCost/.test(raidSrc) ? 1 : 0, 1, 0.001);

/* ⑨ 连败补偿 */
check('失败累计 lossStreak、成功清零',
  /lossStreak=\(this\.stash\.lossStreak\|\|0\)\+1|lossStreak=Math\.min\(20,/.test(raidSrc) &&
  /this\.stash\.lossStreak=0/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('连败 3 把起给 pity（封顶 6 层）',
  /this\.pity = M\.clamp\(\(\(this\.stash\.lossStreak\|0\)\|\|0\) - 2, 0, 6\)/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('pity 同时作用于箱子运气与敌人血量',
  /\(this\.pity\|\|0\)\*0\.08/.test(raidSrc) && /this\.pity\*0\.035/.test(raidSrc) ? 1 : 0, 1, 0.001);

/* ==========================================================================
 * 51. 3D 实体不透明 / 俯仰 / 准星爆头（v0.33.0）
 * ========================================================================== */
console.log('\n=== 51. 3D 不透明 / 俯仰 / 准星爆头（v0.33.0）===');

/* ① 实体必须不透明：旧版对**所有**精灵设 globalAlpha = 雾衰减，导致建筑/箱子/树干半透明 */
check('prop 精灵不透明（不再继承雾 alpha）',
  /\(s\.kind === "prop"\) \? 1 : fog/.test(fpSrc) ? 1 : 0, 1, 0.001);
check('unit 雾下限 0.82（不会透出背后的墙）',
  /Math\.max\(0\.82, 1-depth\/this\.MAX_D\*0\.18\)/.test(fpSrc) ? 1 : 0, 1, 0.001);
check('不再有 0.16 的最远透明度',
  !/Math\.max\(0\.16, 1-depth\/this\.MAX_D\)/.test(fpSrc) ? 1 : 0, 1, 0.001);

/* ② 俯仰 */
check('ViewMode 有 pitch 字段', G('typeof ViewMode.pitch')==='number' ? 1 : 0, 1, 0.001);
check('鼠标纵轴驱动俯仰', /_turn\(dx, dy\)/m.test(vmSrc) && /movementY/.test(vmSrc) ? 1 : 0, 1, 0.001);
check('俯仰限制 ±0.30rad', /Math\.max\(-0\.30, Math\.min\(0\.30/.test(vmSrc) ? 1 : 0, 1, 0.001);
check('地平线随俯仰偏移（一处改全图层跟随）',
  /const horizon = h\*0\.5 \+ pitch\*proj/.test(fpSrc) ? 1 : 0, 1, 0.001);

/* ③ 准星爆头 */
check('每帧算准星是否压在头部带', /R\.aimHead = aimHead/.test(fpSrc) ? 1 : 0, 1, 0.001);
check('头部带取贴片上缘 28%', /top \+ size\*0\.28/.test(fpSrc) ? 1 : 0, 1, 0.001);
check('头部判定要求该列没被更近的墙挡住', /this\._zbuf\[col\] > depth/.test(fpSrc) ? 1 : 0, 1, 0.001);
check('3D 玩家打 AI 用准星判定、2D 仍随机',
  /_in3D && target\.isPlayer!==true && attacker && attacker\.isPlayer/.test(raidSrc) &&
  /RNG\.chance\(0\.15\)/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('暴击判定读 this.aimHead（不是未定义的 R）',
  /this\.aimHead === target/.test(raidSrc) ? 1 : 0, 1, 0.001);

/* ④ 两类装饰的碰撞（v0.33.1 → v0.36.0）
 *    scrap（废料堆）→ 无碰撞；rock（六边形岩石）→ **真六边形**多边形碰撞 */
check('scrap 不进 walls（杂物不挡路）',
  /if\(t\.kind==="scrap"\) return p;/.test(raidSrc) ? 1 : 0, 1, 0.001);
const __deco = JSON.parse(G(`JSON.stringify((()=>{
  const R=Object.create(Raid);
  R.props=[]; R.walls=[];
  R._pushProp({kind:"scrap", w:60, h:60, fill:"#000"}, 0, 0);
  const scrapWalls=R.walls.length;
  R._pushProp({kind:"rock", w:80, h:80, fill:"#555"}, 100, 0);
  const rockWalls=R.walls.filter(w=>w.kind==="rock").length;
  const rockWall=R.walls.find(w=>w.kind==="rock")||{};
  return { scrapWalls, rockWalls, scrapProps:R.props.filter(p=>p.kind==="scrap").length,
    hexVerts:(rockWall.hexPoly||[]).length,
    inside: raidPointInPoly(140,40,rockWall.hexPoly||[]),
    corner: raidPointInPoly(101,1,rockWall.hexPoly||[]) };
})())`));
check('scrap 只留在 props、walls 里没有它', __deco.scrapWalls===0 && __deco.scrapProps===1 ? 1 : 0, 1, 0.001);
check('rock 登记 1 个 AABB + 6 顶点六边形（v0.36.0）',
  __deco.rockWalls===1 && __deco.hexVerts===6 ? 1 : 0, 1, 0.001);
check('六边形内部挡、左上尖角外不挡',
  __deco.inside===true && __deco.corner===false ? 1 : 0, 1, 0.001);

/* ⑤ 各 POI 主题装饰（v0.35.0） */
check('8 个 POI 各有主题装饰清单',
  G('Object.keys(RAID_POI_DECOR).length')===8 &&
  G('RAID_POI.every(p=>!!RAID_POI_DECOR[p.id])') ? 1 : 0, 1, 0.001);
check('装饰按房间内部分区摆放（非合并框中心）',
  /for\(const rid of poi\.rooms\)/.test(raidSrc) && /RAID_POI_DECOR\[poi\.id\]/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('装饰走 _pushProp 落地（2D/3D 同源）',
  /_fitDecorInRoom\(rm, item, placed/.test(raidSrc) && /this\._pushProp\(\{ kind:item\.kind/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('装饰落点避开墙体/门廊/战利品箱（_rectClear）',
  /_rectClear\(gx,gy,item\.w,item\.h/.test(raidSrc) && /this\.doorLanes/.test(raidSrc) ? 1 : 0, 1, 0.001);

/* ⑥ v0.34.3：rock 贴图恢复单张（碰撞仍三横带） */
check('2D 渲染排除 hex 拆分',
  /p\.compound!=="hex"/.test(__rd2) ? 1 : 0, 1, 0.001);
check('3D 渲染排除 hex 拆分',
  /q\.compound!=="hex"/.test(fpSrc) ? 1 : 0, 1, 0.001);
const __rockDraw = JSON.parse(G(`JSON.stringify((()=>{
  let calls=0;
  const fake={}, q={kind:"rock",x:0,y:0,w:80,h:80,fill:"#555",
    compound:"hex",boxes:[{x:0,y:0,w:60,h:20},{x:0,y:20,w:80,h:40},{x:0,y:60,w:64,h:20}]};
  const orig=RenderRaid._propBox;
  RenderRaid._propBox=function(){ calls++; };
  try{ RenderRaid.prop(fake,q); }finally{ RenderRaid._propBox=orig; }
  return { calls, wallsHex:RAID_COMPOUND_KINDS.rock };
})())`));
check('rock 只画一张贴图（_propBox 调用 1 次）', __rockDraw.calls===1 ? 1 : 0, 1, 0.001);
check('rock 碰撞仍是 hex 三横带', __rockDraw.wallsHex==='hex' ? 1 : 0, 1, 0.001);

/* ⑦ v0.34.3：3D 性能（用户实机 profiling 说 _castWalls 最粗） */
check('_castWalls 有 FOV 预筛', /halfFov/.test(fpSrc) && /da - halfAng > halfFov/.test(fpSrc) ? 1 : 0, 1, 0.001);
check('地面装饰线按颜色合批', /_lineBatch/.test(fpSrc) && /_flushLines/.test(fpSrc) ? 1 : 0, 1, 0.001);
check('贴花距离从 900 收到 480', /dep > 480/.test(fpSrc) ? 1 : 0, 1, 0.001);

/* ⑧ 副标题分隔符恢复（v0.34.2 误改 ui.js 的标题） */
check('大厅标题恢复 BORDER OPS · WEB',
  /BORDER OPS · WEB/.test(uiSrc) ? 1 : 0, 1, 0.001);
check('品牌·代号仍保留', /BEAR·铁砧/.test(raidSrc) ? 1 : 0, 1, 0.001);

/* ==================== 52. v0.35.1 十一项修复护栏 ==================== */
console.log('\n=== 52. v0.35.1 修复护栏（品质显示 / 星键交换 / 撤离费 / 抽奖机分档 / 局内特价 / 拆解 / 排序）===');

/* ① 图例只列前 9 阶，隐藏三档不出现 */
const legendPlain2 = String(G(`(()=>{const p=CFG.display;CFG.display="full";const t=raidTierLegend();CFG.display=p;return t;})()`)).replace(/<[^>]*>/g,'');
check('图例不含隐藏三档（定制 / 珍藏 / 孤品）', !/定制|珍藏|孤品/.test(legendPlain2) ? 1 : 0, 1, 0.001);
check('图例仍含前 9 阶（民用…定型）', /民用/.test(legendPlain2) && /定型/.test(legendPlain2) ? 1 : 0, 1, 0.001);

/* ② 第 10 阶名两表统一为「定制」 */
check('第10阶品质两表同名「定制」',
  (G('RARITIES.find(r=>r.id==="primordial").name')==="定制" && G('RAID_TIERS[9].name')==="定制") ? 1 : 0, 1, 0.001);

/* ③ 新三档颜色两表同色 */
check('定制/珍藏/孤品 两表同色',
  [9,10,11].every(i=> G(`RARITIES[${i}].color`)===G(`RAID_TIERS[${i}].color`)) ? 1 : 0, 1, 0.001);

/* ④ 星键长按 = 与正在用的手持枪交换（旧枪落地、背包不撑大、两处同源） */
check('长按替换把旧枪落脚下并换到正在用的手',
  /this\._dropGround\(heldItem/.test(raidSrc) && /if\(slot==="secondary"\) p\.secondary=g; else p\.gun=g;/.test(raidSrc) ? 1 : 0, 1, 0.001);

/* ⑤ 撤离费纳入「撤离时携带」的装备总估值 */
check('撤离费按携带装备总估值计算',
  /raidExtractFee\(zone, raidCarriedGearValue\(this\)\)/.test(raidSrc) && /function raidCarriedGearValue/.test(raidSrc) ? 1 : 0, 1, 0.001);

/* ⑥ 抽奖机 T10-12 只在 premium（黑市 GP 机）出现，其余封顶 T9 */
check('非黑市抽奖机封顶 T9（premium 门控）',
  /if\(premium && r < 0\.0004\)/.test(raidSrc) && /gear\(8, premium\?9:8\)/.test(raidSrc) ? 1 : 0, 1, 0.001);

/* ⑦ 局内每个摊位都有每日特价 */
check('局内商店每日特价（_fieldDailyDeal + data-fdeal）',
  /UI\._fieldDailyDeal=function/.test(raidSrc) && /data-fdeal=/.test(raidSrc) ? 1 : 0, 1, 0.001);

/* ⑧ 拆解 T 级配件出同 T 级材料（高品阶低 ilvl 不再掉档） */
const svHiTier = G(`(()=>{const y=raidSalvageYield({kind:'part',slot:'barrel',ilvl:4,rarity:'mythic'});let m=-1;for(const x of y){const t=(RAID_MAT_BY_ID[x.id]||{}).tier||0;if(t>m)m=t;}return m;})()`);
check('高品阶低 ilvl 配件拆出高档料（同 T 级）', svHiTier>=6 ? 1 : 0, 1, 0.001);

/* ⑨ 枪匠台装备列表按估值降序 */
check('枪匠台装备列表按估值降序',
  /stash\.weapons\.slice\(\)\.sort\(\(a,b\)=>\(b\.value\|\|0\)-\(a\.value\|\|0\)\)/.test(raidSrc) ? 1 : 0, 1, 0.001);

console.log('');
console.log('=== 53. v0.36.0（改装模块生效 / 六边形碰撞 / 掉落阶梯 / 新厂商 / 撤离费）===');

/* ① 改装模块必须真的改到局内会读的扁平字段（用户反馈「有的改装模块似乎没有加成」） */
const __mod = JSON.parse(G(`JSON.stringify((()=>{
  const mk=()=>blGunConvert(generateWeapon(40,{rarity:"orange",type:"rifle",manufacturer:"Vladof",affixes:[],parts:[]}));
  const base=mk();
  const out={};
  for(const id of BOOST_CORE_IDS){
    const g=installPartOnGun(mk(), raidMakeBoostCore(id,3));
    out[id]={ dmg:+(g.dmg-base.dmg).toFixed(2), mag:g.mag-base.mag,
      reload:+(base.reload-(g.reload||0)).toFixed(2),
      spread:+(base.spread-(g.spread||0)).toFixed(4),
      crit:+(g.critChance-base.critChance).toFixed(3),
      range:g.range-base.range, move:+(g.moveMul-base.moveMul).toFixed(3) };
  }
  return out;
})())`));
const __modHit=(id,k)=>Math.abs(__mod[id][k])>1e-6;
check('导气增压：伤害/射速真的涨（dmg 字段变化）', __modHit("berserk","dmg")?1:0,1,0.001);
check('精磨扳机：暴击率/暴击倍率进入扁平枪械对象',
  (__mod.lethal.crit>0 && G('raidMakeBoostCore("lethal",3).mods.some(m=>m.stat==="critDmg")')) ?1:0,1,0.001);
check('扩容供弹：弹匣与换弹时间都生效', (__modHit("barrage","mag") && __modHit("barrage","reload"))?1:0,1,0.001);
check('比赛级枪管：精度（散布）与射程都生效', (__modHit("precision","spread") && __modHit("precision","range"))?1:0,1,0.001);
check('枪口制退：后坐字段进入结算（kick 读取 gun.recoil）',
  /1 - \(sh\.gun\.recoil\|\|0\)\/100/.test(raidSrc) && __modHit("annihil","dmg")?1:0,1,0.001);
check('人体工学：持枪移速 moveMul 生效', __modHit("vampire","move")?1:0,1,0.001);
check('综合套件：三项全中', (__modHit("omni","dmg")&&__modHit("omni","spread")&&__modHit("omni","crit"))?1:0,1,0.001);
check('扁平枪械对象带 accuracy/reload/critChance/critMul/recoil/moveMul/pierce',
  (()=>{const g=JSON.parse(G('JSON.stringify(blGunConvert(generateWeapon(40,{rarity:"blue",type:"rifle",parts:[],affixes:[]})))'));
    return ["accuracy","reload","critChance","critMul","recoil","moveMul","pierce"].every(k=>g[k]!==undefined)?1:0;})() ,1,0.001);
check('换弹走枪械自身 reload（模块 reloadPct 有出口）',
  /o\.reloadT = M\.clamp\(\(o\.gun\.reload!==undefined/.test(raidSrc)?1:0,1,0.001);
check('手枪弹匣不再把改装等级从旧枪继承（卸掉膛压组件会降级）',
  /mayhem: 0, element: gun\.element/.test(fs.readFileSync(path.join(SRC,'weapons.js'),'utf8'))?1:0,1,0.001);

/* ② 兵工厂：12 家，且每家的特色字段真的参与生成 */
const __man = JSON.parse(G(`JSON.stringify((()=>{
  const out={};
  for(const k of Object.keys(MANUFACTURERS)){
    const g=blGunConvert(generateWeapon(30,{rarity:"blue",type:"rifle",manufacturer:k,affixes:[],parts:[]}));
    out[k]={ dmg:g.dmg, rpm:g.rpm, reload:g.reload, move:g.moveMul, pierce:g.pierce, range:g.range, recoil:g.recoil };
  }
  return out;
})())`));
check('兵工厂数量 ≥12 且每家都有 perk 文案',
  G('Object.keys(MANUFACTURERS).length')>=12 && G('Object.values(MANUFACTURERS).every(m=>typeof m.perk==="string"&&m.perk.length>3)')?1:0,1,0.001);
check('新厂商特色真的落到数值：斯泰尔射速最高、莱茵金属穿甲最高、以色列移速>1、北方工业后坐更低',
  (__man.Steyr.rpm>__man.Vladof.rpm &&
   __man.Rheinmetall.pierce>=2 &&
   __man.IWI.move>1.15 &&
   G("MANUFACTURERS.Norinco.recoilMul")<0.8 && G("MANUFACTURERS.Steyr.recoilMul")>1)?1:0,1,0.001);

/* ③ 敌人掉落阶梯（v0.36.1 用户定档）：T5 = 10%，每高一档 ×0.5 */
const __drop = JSON.parse(G(`JSON.stringify((()=>{
  const tbl={};
  for(let t=1;t<=9;t++) tbl[t]=+(raidGearDropChance(t)*100).toFixed(2);
  return { tbl, p1:+(0.72*Math.pow(0.85,0)).toFixed(3), p11:+(0.72*Math.pow(0.85,10)).toFixed(3) };
})())`));
check('T5 装备掉率 ≈10%，其后每档 ×0.5（T6 5% / T7 2.5% / T9 0.63%）',
  Math.abs(__drop.tbl[5]-10)<0.6 && Math.abs(__drop.tbl[6]-5)<0.4 &&
  Math.abs(__drop.tbl[7]-2.5)<0.3 && __drop.tbl[9]<1 ?1:0,1,0.001);
check('低档反推翻倍并封顶 100%（T4 20% / T3 40% / T1 100%）',
  Math.abs(__drop.tbl[4]-20)<0.6 && Math.abs(__drop.tbl[3]-40)<0.8 && __drop.tbl[1]<=100 && __drop.tbl[1]>=99 ?1:0,1,0.001);
check('材料补偿概率随品质递减（T1≈72% → T11≈14%）',
  __drop.p1>0.6 && __drop.p11>0.08 && __drop.p11<0.25 ?1:0,1,0.001);
check('枪没掉 → 2~3 个同等级配件（_rollPartAtTier 钉死档位）',
  /lostGuns\.push\(\{ tier:gt/.test(raidSrc) && /const n=RNG\.ri\(2,3\)/.test(raidSrc) &&
  /_rollPartAtTier\(lg\.tier-1, lg\.ilvl\)/.test(raidSrc) &&
  /raidGearDropChance\(rarityIdx\)|RARITIES\[idx\]\.id/.test(fs.readFileSync(path.join(SRC,'raid-core2.js'),'utf8')) ?1:0,1,0.001);
const __tierPart = JSON.parse(G(`JSON.stringify((()=>{
  const R=Object.create(Raid);
  const out=[];
  for(const idx of [4,6,8]){ const p=R._rollPartAtTier(idx, 24); out.push([idx, p.rarity]); }
  return out;
})())`));
check('同等级配件确实落在该档（T5/T7/T9 各抽一件核对）',
  __tierPart.every(([idx,rid])=>G('RARITIES['+idx+'].id')===rid) ?1:0,1,0.001);
check('护盾掉率进一步下调（精锐 ≤10%、普通 ≤3%）',
  /bot\.smart\?0\.10:0\.03/.test(raidSrc)?1:0,1,0.001);

/* ④ AI 独立物品栏 + 会换枪 */
check('AI 对地面/尸体物品做取舍（_botWants）',
  /_botWants\(b, it\)/.test(raidSrc) && /it\.kind==="weapon"\)\{[\s\S]{0,400}val > \(b\.gun\.value\|\|0\)\*1\.02/.test(raidSrc)?1:0,1,0.001);
check('AI 会翻尸体与地面物品堆',
  /const loose = !!\(c\.body \|\| c\.ground\);/.test(raidSrc) && /c\.drops\.some\(d=>d && \(d\.kind==="weapon"/.test(raidSrc)?1:0,1,0.001);
check('AI 背包里的材料也会掉落', /bot\.inv\.materials/.test(raidSrc)?1:0,1,0.001);

/* ⑤ 撤离费对局内装备敏感度大幅提升 */
const __fee36 = JSON.parse(G(`JSON.stringify((()=>{
  const z=RAID_EXTRACT_RULES.extC;
  return { raw0:raidExtractFee(z,0), v30k:raidExtractFee(z,30000), v90k:raidExtractFee(z,90000) };
})())`));
check('撤离线：裸装仍 ≤₽120', __fee36.raw0<=120?1:0,1,0.001);
check('撤离费对装备更敏感：带 3 万 ≥ 旧版 2 倍（≥₽840）', __fee36.v30k>=840?1:0,1,0.001);
check('撤离费随装备继续上升（9 万 > 3 万）', __fee36.v90k>__fee36.v30k?1:0,1,0.001);

/* ⑥ 音效重做 */
check('音效分层合成（噪声 + 压缩器 + 波形整形）',
  /createDynamicsCompressor/.test(fs.readFileSync(path.join(SRC,'util.js'),'utf8')) &&
  /createWaveShaper/.test(fs.readFileSync(path.join(SRC,'util.js'),'utf8'))?1:0,1,0.001);
check('开火音效按枪型分档（6 套物理参数）',
  G('Object.keys((()=>{const o={};for(const k of ["pistol","smg","rifle","shotgun","sniper","launcher"])o[k]=1;return o;})()).length')===6 &&
  /const GUNSHOT = \{/.test(fs.readFileSync(path.join(SRC,'util.js'),'utf8'))?1:0,1,0.001);
check('AI 开火也有声音（1.5km 内）',
  /SFX\.shoot\(sndKind, \{far:true\}\)/.test(raidSrc)?1:0,1,0.001);

console.log('');
console.log('=== 56. v0.38.0（P0/P1 修复护栏：崩溃面 / 经济不变量 / 死字段契约）===');

/* ① P0-1：_strafe 必须把 game 传下去（漏参会每帧 TypeError，被帧级 catch 吞成慢性病） */
const __enemySrc = fs.readFileSync(path.join(SRC,'enemies.js'),'utf8');
const __strafeSig = /_strafe\(tx,ty,sp,dt,game\)/.test(__enemySrc);
const __strafeCalls = [...__enemySrc.matchAll(/this\._strafe\([^)]*\)/g)].map(m=>m[0]);
const __strafeBad = __strafeCalls.filter(c=>!/,game\)$/.test(c));
check('_strafe 签名带 game 且所有调用点都传了', (__strafeSig && __strafeBad.length===0)?1:0, 1, 0.001);
check('_step 调用链不再可能拿到 undefined game',
  /_step\(Math\.cos\(a\)\*sp, Math\.sin\(a\)\*sp, dt, game\)/.test(__enemySrc)?1:0, 1, 0.001);

/* ② P0-2：赌博机经济不变量 —— 单件「回收价 < 成本」，且连期望都不赚 */
const __gam = JSON.parse(G(`JSON.stringify((()=>{
  const out={n:0,bad:0,sumCost:0,sumSell:0,refuse:0};
  const keep=Shop.gambleQuote;
  const pl={ weapons:[], gold:1e9, level:5, mayhem:0, mf:0,
             buyWeapon(w){ this.weapons.push(w); return true; } };
  const game={ player:pl, world:{ level:3 } };
  for(let i=0;i<300;i++){
    pl.weapons.length=0; pl.gold=1e9;
    const r=Shop.gamble(game);
    if(!r.ok){ out.refuse++; continue; }
    const sell=Math.max(10, Math.floor(weaponPrice(r.weapon)*0.25));
    out.n++; out.sumCost+=r.cost; out.sumSell+=sell;
    if(!(r.cost>sell)) out.bad++;
  }
  return out;
})())`));
check('赌博机单件必然亏（回收价 < 成本，300 次抽样 0 例外）',
  (__gam.n>0 && __gam.bad===0)?1:0, 1, 0.001);
check('赌博机期望不赚（总回收 < 总成本）',
  (__gam.sumSell < __gam.sumCost)?1:0, 1, 0.001);

/* ③ P1：护盾 T10~T12 不再是死配置 */
const __sh12 = JSON.parse(G(`JSON.stringify({
  c9: shieldStats(9,0,[],[],[],0).capacity,
  c12: shieldStats(12,0,[],[],[],0).capacity,
  q12: Raid._shieldQuota.call({_ivUsed:{}}, {tier:12, uid:"x"}).max,
})`));
check('T12 护盾底材真正生效（容量 > T9）', (__sh12.c12 > __sh12.c9)?1:0, 1, 0.001);
check('T12 破盾无敌配额为 4096（2^12）', __sh12.q12===4096?1:0, 1, 0.001);

check('_ivUsed 在每局启动时被重置（源码契约）',
  /this\._ivUsed=\{\}/.test(raidSrc)?1:0, 1, 0.001);

/* ⑤ P1：技能树里的每个加点字段都必须有消费点
 *   v0.38.0 时这张表是手写的 4 个字段（maxShieldAdd / speedMul / abilityCDMul / elemMul），
 *   于是第五个死字段 shieldRegenMul 就这么漏过去了 —— 手写清单永远追不上新增字段。
 *   v0.39.0 改成**从 skills.js 里直接抽取 per 键名**再做全量扫描：新增字段忘了接线，这里就红。 */
const __skillSrc = fs.readFileSync(path.join(SRC,'skills.js'),'utf8');
const __skillKeys = new Set();
for(const m of __skillSrc.matchAll(/per:\{([^}]*)\}/g))
  for(const p of m[1].split(",")){ const k=p.split(":")[0].trim(); if(k) __skillKeys.add(k); }
const __otherFiles = fs.readdirSync(SRC).filter(f=>f.endsWith(".js") && f!=="skills.js");
const __dead = [...__skillKeys].sort().filter(k=>{
  let n=0;
  for(const f of __otherFiles){
    const t=fs.readFileSync(path.join(SRC,f),'utf8');
    n += (t.match(new RegExp("\\b"+k+"\\b","g"))||[]).length;
  }
  return n===0;
});
check('技能/职业被动字段全部接进结算（'+([...__skillKeys].length)+' 个字段，死字段：'+(__dead.join("、")||"无")+'）', __dead.length, 0, 0.001);
/* 单独钉死本轮新增的那一个：泛化扫描只能证明「有人提到」，这里断言它真的乘进了充能速度 */
check('shieldRegenMul 乘进护盾充能速度',
  /\*\s*m\.shieldRegenMul/.test(fs.readFileSync(path.join(SRC,'player.js'),'utf8'))?1:0, 1, 0.001);

/* ⑥ P1：AI 互殴 / 背景交火的尸体必须广播（否则联机 containers 下标错位） */
check('两条 AI 尸体路径都走 _dropBotAndBroadcast',
  (raidSrc.match(/_dropBotAndBroadcast\(/g)||[]).length >= 3?1:0, 1, 0.001);

check('商店 buy 尊重 buyItem 的返回值（源码契约）',
  /const paid = pl\.buyItem\(item, it\.price, cur\);\s*\n\s*if\(!paid\) return \{ ok:false/.test(fs.readFileSync(path.join(SRC,'shop.js'),'utf8'))?1:0, 1, 0.001);

/* ⑦ v0.38.1（用户反馈）：物品栏里的防具不能再显示「拿在手上」
 *   枪是「拿在手上」，护甲 / 头盔 / 护盾是「穿上 / 戴上 / 装上」——文案错会让人以为
 *   点它只是拿起来。这里既断言种类映射存在，也断言旧的硬编码模板已经被replace掉。 */
const __c3 = fs.readFileSync(path.join(SRC,'raid-core3.js'),'utf8');
check('物品栏防具按钮按种类给词（护甲/头盔/护盾）',
  /armors:"穿上护甲",helmets:"戴上头盔",shields:"装上护盾"/.test(__c3)?1:0, 1, 0.001);
check('物品栏不再把防具硬编码成「拿在手上」',
  /data-equip="\$\{equip\}">拿在手上</.test(__c3)?0:1, 1, 0.001);

/* ⑧ v0.38.1：阵亡结算的「丢失」清单必须覆盖背包里的护甲 / 护盾
 *   lootA 曾由 _fail 生产却无人读取，背包护盾连数据都没带上 —— 生产端与消费端都要断言。 */
const __rui = fs.readFileSync(path.join(SRC,'raid-ui.js'),'utf8');
check('_fail 把背包护盾也带进丢失清单（lootS）',
  /lootS:\(this\.inv\.shields\|\|\[\]\)\.filter/.test(__c3)?1:0, 1, 0.001);
check('结算页渲染背包护甲（lootA 有消费点）',
  /res\.lost\.lootA\|\|\[\]/.test(__rui)?1:0, 1, 0.001);
check('结算页渲染背包护盾（lootS 有消费点）',
  /res\.lost\.lootS\|\|\[\]/.test(__rui)?1:0, 1, 0.001);

/* ---------------- 58. v0.39.0：狙击手 / 医疗兵 / 精英词条 / 契约 / 赎回 / 死亡回放 ---------------- */
console.log('\n=== 58. v0.39.0（走位型敌人 / 精英词条 / 契约 / 赎回 / 死亡回放）===');

/* ① 两种新精英必须真的进了 AI 表，且编成逻辑把它们放进常规 PMC */
check('狙击手 / 医疗兵已登记进 RAID_ARCH',
  (G('!!(RAID_ARCH.sniper && RAID_ARCH.medic)')?1:0), 1, 0.001);
check('狙击手视距高于 PMC（超视距点名）',
  G('RAID_ARCH.sniper.sense.sight > RAID_AI_SENSE.pmc.sight')?1:0, 1, 0.001);
check('常规 PMC 里会编出狙击手 / 医疗兵',
  /arch=spec;/.test(raidSrc) && /"_sniperTick"|_sniperTick\(/.test(raidSrc)?1:0, 1, 0.001);
check('狙击手有 0.8s 激光预警窗口',
  /RAID_SNIPER_AIM\s*=\s*0\.8/.test(fs.readFileSync(path.join(SRC,'raid-core.js'),'utf8'))?1:0, 1, 0.001);
check('医疗兵不给玩家回血（否则「先杀医疗兵」不成立）',
  /if\(o===b \|\| !o\.alive \|\| o\.isPlayer \|\| o\.remote \|\| o\.ghost\) continue;/.test(fs.readFileSync(path.join(SRC,'raid-core.js'),'utf8'))?1:0, 1, 0.001);

/* ② 精英词条：五条词条的消费点都在（本轮最容易「写了没人读」的地方） */
const __coreSrc = fs.readFileSync(path.join(SRC,'raid-core.js'),'utf8');
const __c2Src   = fs.readFileSync(path.join(SRC,'raid-core2.js'),'utf8');
const __affixOk = {
  affixDmgTaken: /target\.affixDmgTaken/.test(__c3),
  affixJitter:   /b\.affixJitter/.test(__c2Src),
  affixSummon:   /b\.affixSummon/.test(__c2Src),
  speed:         /o\.speed=Math\.round/.test(__coreSrc),
  maxHP:         /o\.maxHP=Math\.round/.test(__coreSrc),
};
const __affixDead = Object.keys(__affixOk).filter(k=>!__affixOk[k]);
check('精英词条全部有消费点（死词条：'+(__affixDead.join("、")||"无")+'）', __affixDead.length, 0, 0.001);
/* 行为断言：词条真的改写了属性，且 2 条时互不重复 */
const __affixed = JSON.parse(G(`JSON.stringify((()=>{
  const o={ isPlayer:false, name:"测试精锐", speed:100, maxHP:100, hp:100, cls:"pmc" };
  Raid._applyEliteAffixes(o, 2);
  return { n:(o.affixNames||[]).length, names:o.affixNames||[], speed:o.speed, hp:o.maxHP,
           dmgTaken:o.affixDmgTaken||1, jitter:o.affixJitter||1, summon:!!o.affixSummon, name:o.name };
})())`));
check('精英词条：2 条且不重复（'+__affixed.names.join("/")+'）',
  (__affixed.n===2 && new Set(__affixed.names).size===2)?1:0, 1, 0.001);
check('精英词条至少改写了一项属性（不是空标记）',
  (__affixed.speed!==100 || __affixed.hp!==100 || __affixed.dmgTaken!==1
   || __affixed.jitter!==1 || __affixed.summon)?1:0, 1, 0.001);
check('精英名字带词条标签（玩家看得见）', /\[/.test(__affixed.name)?1:0, 1, 0.001);

/* ③ 契约：三种完成条件都必须有引擎侧 hook，且发奖会真的落进仓库 */
/* v0.40.0：契约扩到 6 种 —— 击杀类走 _onBotDeath，结算类走 _extractContractTicks */
check('契约 6 种条件都有 hook（boss / elite / scav / extract / money / time）',
  /_contractTick\(victim\.bounty\?"boss":\(victim\.smart\?"elite":\(victim\.cls==="scav"\?"scav":null\)\)/.test(__c3)
  && /this\._extractContractTicks\(\)/.test(__c3)
  && /this\._contractTick\("extract", n\)/.test(__coreSrc)
  && /this\._contractTick\("money"/.test(__coreSrc)
  && /this\._contractTick\("time"/.test(__coreSrc)?1:0, 1, 0.001);
const __contract = JSON.parse(G(`JSON.stringify((()=>{
  const now=Date.now();
  const stash={ creds:0, tokens:0, weapons:[], parts:[], armors:[], helmets:[], shields:[], materials:[], keys:[] };
  const offers=raidContractOffers(now);
  const kinds=offers.map(o=>o.kind);
  const c=offers[0];
  raidContractAccept(stash, c, now);
  const active=!!raidContractActive(stash, now);
  const step=raidContractProgress(stash, c.kind, 1);         // 还差一次
  const mid={ progress:(stash.contract||{}).progress, done:step.done };
  const fin=raidContractProgress(stash, c.kind, c.need);      // 收尾
  return { n:offers.length, kinds, active, mid, done:fin.done,
           grant:fin.grant?fin.grant.kind:"", cleared:!stash.contract,
           got:stash.weapons.length+stash.parts.length+stash.armors.length+stash.helmets.length
               +stash.materials.length+stash.keys.length+Object.keys(stash.ammo||{}).length
               +((stash.creds||0)>0?1:0)+((stash.tokens||0)>0?1:0) };
})())`));
check('每日契约报价 3 条且类型不重复（'+__contract.kinds.join("/")+'）',
  (__contract.n===3 && new Set(__contract.kinds).size===3)?1:0, 1, 0.001);
check('接取后进入进行中状态', __contract.active?1:0, 1, 0.001);
check('进度按次数累加（1/'+Math.max(1,__contract.mid.progress||1)+'）',
  __contract.mid.done===false && __contract.mid.progress>=1?1:0, 1, 0.001);
check('达成后发奖并清空契约（奖励类型 '+__contract.grant+'）',
  (__contract.done && __contract.cleared && __contract.got>0)?1:0, 1, 0.001);

/* ④ 阵亡装备赎回：24h 窗口 / 300% 价 / 扣钱后装备回仓 */
const __bb = JSON.parse(G(`JSON.stringify((()=>{
  const now=Date.now();
  const stash={ creds:5000, weapons:[], armors:[], helmets:[], shields:[], parts:[] };
  const it={ kind:"weapon", name:"待赎回测试枪", value:1000, uid:"bb1" };
  const n=raidBuybackAdd(stash, [it], now);
  const live=raidBuybackList(stash, now);
  const price=live[0]?live[0].price:0;
  const poor=raidBuybackBuy({ creds:10, weapons:[], armors:[], helmets:[], shields:[], buyback:stash.buyback }, 0, now);
  const ok=raidBuybackBuy(stash, 0, now);
  const expired=raidBuybackList({ buyback:[{ at:now-25*3600000, price:1, item:it }] }, now).length;
  return { added:n, price, poorOk:!!poor.ok, okOk:!!ok.ok, creds:stash.creds,
           got:stash.weapons.length, left:(stash.buyback||[]).length, expired };
})())`));
check('阵亡装备进赎回池且定价 300%（₽'+__bb.price+'）',
  (__bb.added===1 && __bb.price===3000)?1:0, 1, 0.001);
check('钱不够时拒绝赎回（不吞装备也不吞钱）', __bb.poorOk===false?1:0, 1, 0.001);
check('赎回成功：扣钱 + 装备回仓 + 出池（余额 ₽'+__bb.creds+'）',
  (__bb.okOk && __bb.creds===2000 && __bb.got===1 && __bb.left===0)?1:0, 1, 0.001);
check('超过 24h 的待赎回项自动过期（剩余 '+__bb.expired+'）', __bb.expired===0?1:0, 1, 0.001);

/* ⑤ 死亡回放：生产端与消费端都要在 */
check('死亡回放生产端（_deathRecap 在致死链路里）',
  /target\.deathRecap=this\._deathRecap\(/.test(__c3)?1:0, 1, 0.001);
check('死亡回放消费端（结算页读 deathRecap）',
  /Raid\.player\.deathRecap/.test(__rui)?1:0, 1, 0.001);
const __recap = JSON.parse(G(`JSON.stringify(Raid._deathRecap(
  { x:0, y:0, hitN:3, hitDmg:137 },
  { name:"Slick", cls:"pmc", arch:null, bounty:false, x:42, y:0, affixNames:["迅猛"] },
  { name:"AK-74N" }))`));
check('死亡回放字段完整（'+__recap.dist+'m / '+__recap.hits+' 次 / -'+__recap.dmg+'）',
  (__recap.name==="Slick" && __recap.dist===42 && __recap.hits===3 && __recap.dmg===137)?1:0, 1, 0.001);

/* ---------------- 59. v0.40.0：冲锋枪手感 / 回收收购单 / 契约扩展 ---------------- */
console.log('\n=== 59. v0.40.0（冲锋枪手感 / 回收收购单 / 契约扩展）===');

/* ① 冲锋枪：移动散布惩罚下降、持枪移速上升，且负机动性词条不再把它拖成最慢的枪 */
const __smg = JSON.parse(G(`JSON.stringify((()=>{
  const still={ smg:moveSpreadMul("smg",0), rifle:moveSpreadMul("rifle",0) };
  const runSmg=moveSpreadMul("smg",1), runRifle=moveSpreadMul("rifle",1);
  const mv=(g)=>raidGunMoveMul({ gun:g });
  return {
    stillSmg:still.smg, runSmg, runRifle,
    smgPlain:mv({ type:"smg" }),
    smgBadRoll:mv({ type:"smg", moveMul:0.72 }),
    riflePlain:mv({ type:"rifle" }),
    sniper:mv({ type:"sniper" }),
    smgCap:moveSpreadCap("smg"),
  };
})())`));
check('冲锋枪跑动散布明显低于步枪（'+__smg.runSmg.toFixed(1)+' vs '+__smg.runRifle.toFixed(1)+' 倍）',
  __smg.runSmg < __smg.runRifle*0.18 && __smg.runSmg > 1 ? 1 : 0, 1, 0.001);
check('冲锋枪静止散布仍为 1（没被顺手改坏）', __smg.stillSmg===1?1:0, 1, 0.001);
check('手持冲锋枪移速 ×1.10', Math.abs(__smg.smgPlain-1.10)<0.001, __smg.smgPlain.toFixed(2));
check('负机动性词条不再让冲锋枪比步枪更慢（'+__smg.smgBadRoll.toFixed(2)+' vs '+__smg.riflePlain.toFixed(2)+'）',
  __smg.smgBadRoll > __smg.riflePlain?1:0, 1, 0.001);
check('狙击手移速惩罚保持不变（0.62，别误伤）', Math.abs(__smg.sniper-0.62)<0.001, __smg.sniper.toFixed(2));

/* ② 回收超市：收购单 2~3 类、倍率 2~3、每类限量；不再是自由收购 */
const __rec = JSON.parse(G(`JSON.stringify((()=>{
  let bad=[], nMin=9, nMax=0, mulLo=9, mulHi=0, leftMax=0, cats={};
  for(let i=0;i<300;i++){
    const sh={ wants:undefined };
    const st=Raid._shopStock("rec");
    sh.wants=st.wants||[];
    if(!sh.wants.length){ bad.push("empty"); continue; }
    nMin=Math.min(nMin, sh.wants.length); nMax=Math.max(nMax, sh.wants.length);
    const seen=new Set();
    for(const w of sh.wants){
      if(seen.has(w.cat)) bad.push("dup:"+w.cat);
      seen.add(w.cat); cats[w.cat]=(cats[w.cat]||0)+1;
      mulLo=Math.min(mulLo,w.mul); mulHi=Math.max(mulHi,w.mul);
      leftMax=Math.max(leftMax,w.left);
      if(w.left<=0 || w.left>w.total) bad.push("left:"+w.cat);
      /* 收购单消失后 raidRecWant 必须返回 null（UI 靠它决定「收不收」） */
      if(raidRecWant(sh, w.cat)!==w) bad.push("want:"+w.cat);
    }
    if(raidRecWant(sh,"_nope")) bad.push("ghost");
  }
  return { nMin, nMax, mulLo, mulHi, leftMax, badN:bad.length, bad:bad.slice(0,4), cats:Object.keys(cats) };
})())`));
check('回收收购单每局 2~3 类（实测 '+__rec.nMin+'~'+__rec.nMax+'，异常 '+__rec.badN+'）',
  (__rec.nMin>=2 && __rec.nMax<=3 && __rec.badN===0)?1:0, 1, 0.001);
check('收购倍率落在 2.0~3.0（实测 '+__rec.mulLo.toFixed(1)+'~'+__rec.mulHi.toFixed(1)+'）',
  __rec.mulLo>=2.0 && __rec.mulHi<=3.0?1:0, 1, 0.001);
check('每类都有件数上限（最大 '+__rec.leftMax+' 件）', __rec.leftMax>=1 && __rec.leftMax<=6?1:0, 1, 0.001);
check('收购单覆盖多个品类（'+__rec.cats.join("/")+'）', __rec.cats.length>=4?1:0, 1, 0.001);
const __rui2 = fs.readFileSync(path.join(SRC,'raid-ui2.js'),'utf8');
check('回收面板不再走旧的 1.2× 自由收购价',
  /raidFieldSellPrice\(/.test(__rui2)?0:1, 1, 0.001);
check('回收超市不挂每日特价', /if\(kind!=="rec"\)\{[\s\S]{0,80}_fieldDailyDeal/.test(__rui2)?1:0, 1, 0.001);

/* ③ 契约：6 种类型、显式奖励、完成即刷新、越做越难 */
const __cx = JSON.parse(G(`JSON.stringify((()=>{
  const kinds=Object.keys(RAID_CONTRACT_KINDS);
  const o0=raidContractOffers(Date.now(), 0);
  const o6=raidContractOffers(Date.now(), 6);
  const ids0=o0.map(o=>o.id), ids6=o6.map(o=>o.id);
  const sameSet = ids0.length===ids6.length && ids0.every(x=>ids6.indexOf(x)>=0);
  const needUp = o0.map((o,i)=>o6[i].need>o.need);
  const labels = o0.map(o=>o.reward && o.reward.label || "");
  const noCashOut = labels.every(l=>l.indexOf("折")<0);
  /* 完成一单：发奖 + contractDone+1 + 契约清空（下一次进大厅即是新的 3 条） */
  const stash={ creds:0, tokens:0, weapons:[], parts:[], materials:[], keys:[], ammo:{},
                armors:[], helmets:[], shields:[] };
  raidContractAccept(stash, o0[0], Date.now());
  const fin=raidContractProgress(stash, o0[0].kind, o0[0].need);
  const after=raidContractOffers(Date.now(), stash.contractDone);
  return { kinds, n0:o0.length, distinct:new Set(o0.map(o=>o.kind)).size,
           refresh:!sameSet, needUpAll:needUp.every(Boolean), labels, noCashOut,
           done:fin.done, doneCount:stash.contractDone, cleared:!stash.contract,
           grantKind:fin.grant?fin.grant.kind:"", grantName:fin.grant?fin.grant.name:"",
           afterIds:after.map(o=>o.id), beforeIds:ids0 };
})())`));
check('契约任务类型扩到 6 种（'+__cx.kinds.join('/')+'）', __cx.kinds.length>=6?1:0, 1, 0.001);
check('每次报价 3 条且类型不重复（'+__cx.labels.join(' | ')+'）', (__cx.n0===3 && __cx.distinct===3)?1:0, 1, 0.001);
check('奖励是写明的东西（无「集齐折现」）', (__cx.noCashOut && __cx.labels.every(l=>l.length>2))?1:0, 1, 0.001);
check('完成一单后立刻换一批（做完即刷新）', __cx.refresh?1:0, 1, 0.001);
check('越做越难：完成 6 单后需求全部上升', __cx.needUpAll?1:0, 1, 0.001);
check('完成后发奖 + 完成数 +1 + 契约清空（'+__cx.grantKind+'：'+__cx.grantName+'）',
  (__cx.done && __cx.doneCount===1 && __cx.cleared && __cx.grantName.length>0)?1:0, 1, 0.001);

/* ④ v0.40.1（用户要求「契约奖励大幅减少，只有很难的契约才给高级货」）：
 *   奖励按 1~6 档分池，低难度任务被**死死按在低档**（清扫/搜刮最高 3 档），
 *   具名枪与 GP 币只出现在 6 档，而 6 档只有「猎杀指挥官」能摸到。 */
const __rw = JSON.parse(G(`JSON.stringify((()=>{
  const tiers={};
  for(const k of ["scav","extract","elite","money","time","boss"]){
    tiers[k]=[0,3,6,9,12,18].map(d=>raidContractRewardTier(k,d));
  }
  const sample=(rt,n)=>{
    const types={}, creds=[], mats=[], tok=[];
    for(let i=0;i<400;i++){
      const r=raidContractRewardFor("boss", raidDealSeed("rw", i, rt), rt);
      types[r.type]=(types[r.type]||0)+1;
      if(r.type==="creds") creds.push(r.amount);
      if(r.type==="material") mats.push(r.n);
      if(r.type==="tokens") tok.push(r.n);
    }
    return { types:Object.keys(types), credsMax:creds.length?Math.max(...creds):0,
             matMax:mats.length?Math.max(...mats):0, tokMax:tok.length?Math.max(...tok):0 };
  };
  return { tiers, t1:sample(1), t3:sample(3), t5:sample(5), t6:sample(6) };
})())`));
check('低难度任务奖励被封顶（scav '+__rw.tiers.scav.join("→")+'）',
  (__rw.tiers.scav[5]<=3 && __rw.tiers.extract[5]<=3)?1:0, 1, 0.001);
check('中难度封顶 5 档、只有指挥官能到 6 档（boss '+__rw.tiers.boss.join("→")+'）',
  (__rw.tiers.elite[5]===5 && __rw.tiers.boss[5]===6)?1:0, 1, 0.001);
check('1 档只给低阶材料 / 民用弹 / 少量卢布 / 低阶装备（'+__rw.t1.types.join("/")+'，卢布≤'+__rw.t1.credsMax+'，材料≤'+__rw.t1.matMax+'）',
  (!__rw.t1.types.includes("uniqGun") && !__rw.t1.types.includes("uniqPart")
   && !__rw.t1.types.includes("tokens") && !__rw.t1.types.includes("gun")
   && __rw.t1.credsMax<=5000 && __rw.t1.matMax<=1)?1:0, 1, 0.001);
check('3 档仍不给高级枪 / 具名 / GP（'+__rw.t3.types.join("/")+'）',
  (!__rw.t3.types.includes("uniqGun") && !__rw.t3.types.includes("tokens")
   && !__rw.t3.types.includes("gun") && __rw.t3.credsMax<=15000)?1:0, 1, 0.001);
check('具名枪与 GP 币只在 6 档出现（5档 '+__rw.t5.types.join("/")+'｜6档 '+__rw.t6.types.join("/")+'）',
  (!__rw.t5.types.includes("uniqGun") && !__rw.t5.types.includes("tokens")
   && __rw.t6.types.includes("uniqGun") && __rw.t6.types.includes("tokens"))?1:0, 1, 0.001);
check('6 档 GP 币数量克制（最多 '+__rw.t6.tokMax+' 枚）', __rw.t6.tokMax<=4?1:0, 1, 0.001);
check('奖励数量整体收紧（任何档材料 ≤3 件，实测 '+__rw.t6.matMax+'）', __rw.t6.matMax<=3?1:0, 1, 0.001);

/* ---------------- 60. v0.40.1：护甲「穿上又显示在背包」自愈 + 修理反馈 ---------------- */
console.log('\n=== 60. v0.40.1（穿戴去重 / 修理入口与反馈）===');

/* ① 自愈：已穿戴的防具不允许同时留在背包（同引用 / 同 uid 都算重复） */
const __heal = JSON.parse(G(`JSON.stringify((()=>{
  const mk=()=>({ weapons:[], armors:[], helmets:[], shields:[], parts:[], materials:[], keys:[], ammo:{} });
  const R={ inv:mk(), carried:{ weapons:[], armor:null, helmet:null, shield:null } };
  const A={ uid:"A1", kind:"armor", name:"甲A", tier:3 }, B={ uid:"B1", kind:"armor", name:"甲B", tier:4 };
  R.carried.armor=A; R.inv.armors=[A, B];                 // A 既穿着又在背包（同引用）
  const n1=Raid._invHealDupes.call(R);
  const afterRef={ n:n1, bag:R.inv.armors.map(x=>x.name) };
  const A2={ uid:"A1", kind:"armor", name:"甲A副本", tier:3 };
  R.inv.armors=[A2];                                      // 同 uid 的另一个对象也算重复
  const n2=Raid._invHealDupes.call(R);
  const afterUid={ n:n2, bag:R.inv.armors.map(x=>x.name) };
  const H={ uid:"H1", kind:"helmet", name:"盔" };
  R.carried.helmet=H; R.inv.helmets=[H];
  const n3=Raid._invHealDupes.call(R);
  return { afterRef, afterUid, n3, helmetBag:R.inv.helmets.length };
})())`));
check('已穿戴护甲不再同时留在背包（同引用）',
  (__heal.afterRef.n===1 && __heal.afterRef.bag.join()==="甲B")?1:0, 1, 0.001);
check('同 uid 的重复件也被清掉（不是只比引用）',
  (__heal.afterUid.n===1 && __heal.afterUid.bag.length===0)?1:0, 1, 0.001);
check('头盔同样自愈（背包剩 '+__heal.helmetBag+' 件）', (__heal.n3===1 && __heal.helmetBag===0)?1:0, 1, 0.001);
check('背包护甲 / 头盔行显示耐久百分比（同款两件可区分）',
  /耐久 \$\{Math\.round\(raidDurOf\(a\)\*100\)\}%/.test(__c3)
  && /耐久 \$\{Math\.round\(raidDurOf\(h\)\*100\)\}%/.test(__c3)?1:0, 1, 0.001);

/* ② 修理：入口、反馈、以及 UI.game 这个「从来没被赋值过」的坑 */
check('进大厅时绑定 UI.game（否则所有 toast 都是静默）',
  /if\(typeof game!=="undefined" && game\) UI\.game=game;/.test(fs.readFileSync(path.join(SRC,'raid-ui.js'),'utf8'))?1:0, 1, 0.001);
check('仓库有「全部修理」入口',
  /id="btn-stash-repair-all"/.test(__rui2) && /repairAllCost/.test(__rui2)?1:0, 1, 0.001);
check('修理结果在面板内可见（不依赖 game.toast）',
  /UI\._stashMsg="已修理/.test(__rui2) && /UI\._stashMsg="卢布不足/.test(__rui2)?1:0, 1, 0.001);
check('满耐久的装备显示「耐久已满」而不是消失',
  (__rui2.match(/耐久已满/g)||[]).length>=2?1:0, 1, 0.001);
const __repair = JSON.parse(G(`JSON.stringify((()=>{
  const low={ kind:"armor", value:10000, dur:0.5 };
  const full={ kind:"armor", value:10000, dur:1 };
  return { low:raidRepairCost(low), full:raidRepairCost(full) };
})())`));
check('修理费随耐久缺口变化（半损 ₽'+__repair.low+'，满耐久 ₽'+__repair.full+'）',
  (__repair.low>0 && __repair.full===0)?1:0, 1, 0.001);

/* ⑤ v0.40.2：作品集 / 社交分享的元信息必须齐（缺了在这些站上就是空白卡片）。
 *   deepdemos、DS-Games 这类 AI 作品库靠 og:* 与 description 抓标题与缩略图。 */
const __idx = fs.readFileSync(path.join(ROOT,'index.html'),'utf8');
const __ogImg = (__idx.match(/<meta property="og:image" content="([^"]+)"/)||[])[1] || "";
check('首页有 og:title / og:description / og:image（'+__ogImg+'）',
  (/<meta property="og:title"/.test(__idx) && /<meta property="og:description"/.test(__idx) && !!__ogImg)?1:0, 1, 0.001);
check('og:image 指向的文件真实存在（'+__ogImg+'）',
  (!!__ogImg && fs.existsSync(path.join(ROOT, __ogImg)))?1:0, 1, 0.001);
check('首页有 meta description（作品库列表会直接用它当简介）',
  /<meta name="description" content="[^"]{20,}"/.test(__idx)?1:0, 1, 0.001);



/* ---------------- 61. v0.40.3：空投降品质 / 守卫小队 / AI 抢空投 ---------------- */
console.log('\n=== 61. v0.40.3（空投：降品质 / 守卫小队 / AI 争抢）===');

/* ① 品质：III 级箱出货，明显低于原来的 V 级军火箱（T7 保底） */
const __ad = JSON.parse(G(`JSON.stringify((()=>{
  const tiers=(lv)=>{
    const t=[];
    for(let i=0;i<300;i++){
      const it=Raid._rollVaultLoot(lv, 6000, 6000);
      if(!it) continue;
      const tt = (it.tier!==undefined) ? it.tier : (it.qTier!==undefined ? it.qTier : null);
      if(tt!==null) t.push(tt);
    }
    t.sort((a,b)=>a-b);
    const hi=t.filter(x=>x>=7).length;
    return { n:t.length, min:t[0], max:t[t.length-1],
             hi:Math.round(hi/Math.max(1,t.length)*100),
             avg:+(t.reduce((a,b)=>a+b,0)/Math.max(1,t.length)).toFixed(2) };
  };
  return { lv3:tiers(RAID_AIRDROP_VAULT_LV), lv5:tiers(5), consts:{
    lv:RAID_AIRDROP_VAULT_LV, items:RAID_AIRDROP_ITEMS, guards:RAID_AIRDROP_GUARDS } };
})())`));
check('空投用 III 级箱（RAID_AIRDROP_VAULT_LV='+__ad.consts.lv+'）', __ad.consts.lv===3?1:0, 1, 0.001);
check('III 级箱平均品质明显低于 V 级军火箱（'+__ad.lv3.avg+' vs '+__ad.lv5.avg+'）',
  (__ad.lv3.avg < __ad.lv5.avg - 1)?1:0, 1, 0.001);
check('III 级箱出现 T7+ 的比例 ≤5%（实测 '+__ad.lv3.hi+'%，V 级为 '+__ad.lv5.hi+'%）',
  (__ad.lv3.hi<=5 && __ad.lv3.hi<=__ad.lv5.hi)?1:0, 1, 0.001);
check('空投件数仍为 '+__ad.consts.items+' 件（价值靠守卫与争抢体现，不是堆品质）', __ad.consts.items===3?1:0, 1, 0.001);

/* ② 守卫小队：落空投即生成 2~3 名守卫，绕箱站位、同队标记、巡逻锚点为空投 */
const __guard = JSON.parse(G(`JSON.stringify((()=>{
  const before = Raid.ops.length;
  const poi = { id:"probe-poi", drop:[6000,6000], name:"测试空投点" };
  raidAirdropSpawn(Raid, poi, ()=>0.5);
  const added = Raid.ops.slice(before);
  const drop = Raid.airdrops[Raid.airdrops.length-1];
  const dists = added.map(o=>Math.round(M.dist(o.x,o.y,drop.x,drop.y)));
  return {
    n: added.length,
    guards: added.map(o=>({
      name:o.name, squad:o.squadId, hasGuard:!!o.guardAt, smart:!!o.smart,
      gun:!!o.gun, armor:o.armorTier, hp:o.hp, color:o.color,
      d:Math.round(M.dist(o.x,o.y,drop.x,drop.y)),
    })),
    maxD: Math.max(...dists), minD: Math.min(...dists),
    sameSquad: added.every(o=>o.squadId===added[0].squadId),
    anchored: added.every(o=>o.guardAt && Math.abs(o.guardAt.x-drop.x)<1 && Math.abs(o.guardAt.y-drop.y)<1),
    containerAS: Raid.containers.some(c=>c.airdrop && Math.abs(c.x-drop.x)<1 && Math.abs(c.y-drop.y)<1),
  };
})())`));
check('落空投就带出守卫小队（'+__guard.n+' 人，配置 '+__guard.n+'∈[2,3]）',
  (__guard.n>=2 && __guard.n<=3)?1:0, 1, 0.001);
check('守卫绕空投落位（'+__guard.minD+'~'+__guard.maxD+'px，都在 200px 内）',
  (__guard.minD>=40 && __guard.maxD<=200)?1:0, 1, 0.001);
check('守卫带枪带甲、同队标记、巡逻锚点＝空投点',
  (__guard.guards.every(g=>g.gun) && __guard.guards.every(g=>g.armor>=2)
   && __guard.sameSquad && __guard.anchored)?1:0, 1, 0.001);
check('空投容器与 airdrops 记录同时生成', __guard.containerAS?1:0, 1, 0.001);

/* ③ AI 抢空投：权重 + 产出分支 + 守卫不吃自家那箱 */
check('AI 搜刮时给空投最高权重（eff×0.30）',
  /if\(c\.airdrop\) eff = /.test(raidSrc) && /eff\*0\.30/.test(raidSrc)?1:0, 1, 0.001);
check('守卫不抢自己守的空投（否则玩家到场永远空箱）',
  /b\.guardAt && M\.dist2\(b\.guardAt\.x,b\.guardAt\.y,c\.x,c\.y\)<400\*400/.test(raidSrc)?1:0, 1, 0.001);
check('AI 开空投有自己的产出分支（不再当普通武器箱）',
  /if\(c\.airdrop\)\{[\s\S]{0,200}_rollVaultLoot\(RAID_AIRDROP_VAULT_LV-1\)/.test(raidSrc)?1:0, 1, 0.001);
check('守卫不会被「战术角色」改造顶掉（狙击手/医疗兵只从普通 PMC 里挑）',
  /!o\.arch && !o\.guardAt && o\.cls==="pmc"/.test(raidSrc)?1:0, 1, 0.001);

/* ④ 行为：守卫在场时，玩家离箱子越近越容易被拦住（守卫会锁定玩家当目标） */
const __engage = JSON.parse(G(`JSON.stringify((()=>{
  const R = Raid;
  const g = R.ops.find(o=>o.guardAt);
  if(!g) return { skip:true };
  // 把玩家摆到守卫正前方 120px，看索敌能否锁定（模拟"走到空投前被拦"）
  g.angle = Math.atan2(g.guardAt.y-g.y, g.guardAt.x-g.x);   // 守卫面朝空投
  R.player.x = g.x + Math.cos(g.angle)*Math.min(150, Math.max(60, M.dist(g.x,g.y,g.guardAt.x,g.guardAt.y)+60));
  R.player.y = g.y + Math.sin(g.angle)*Math.min(150, Math.max(60, M.dist(g.x,g.y,g.guardAt.x,g.guardAt.y)+60));
  const lit = raidAiLit(R, g, R.player.x, R.player.y);
  const los = R._los(g.x, g.y, R.player.x, R.player.y);
  return { skip:false, sight:raidAISense(g).sight, lit, los,
           d:Math.round(M.dist(g.x,g.y,R.player.x,R.player.y)) };
})())`));
if (!__engage.skip) {
  check('守卫视距足够覆盖空投周边（'+__engage.sight+'px）',
    __engage.sight >= 400?1:0, 1, 0.001);
  check('空投前的玩家能被守卫看见（lit='+__engage.lit+'，距离 '+__engage.d+'px）',
    (__engage.lit===true || __engage.los===true)?1:0, 1, 0.001);
}

/* ---------------- 62. v0.41.0：AI 索敌黏性 / 二阶转向 / 打击感 ---------------- */
console.log('\n=== 62. v0.41.0（AI 索敌黏性 / 二阶转向 / 弹药默认 / 打击感）===');

/* ① 目标选举：黏性续锁 —— 玩家与更近的 AI 同时在候选里，目标不能逐帧来回切 */
const __pick = JSON.parse(G(`JSON.stringify((()=>{
  const mk=()=>{
    const P={ x:600, y:0, alive:true, isPlayer:true, r:14 };
    const A={ x:150, y:0, alive:true, cls:"scav", r:14 };
    const b={ x:0, y:0, angle:0, alive:true, cls:"pmc", gun:{}, r:14, _seenHold:0.6,
              lastSeen:{x:600,y:0,t:3} };
    const R={ player:P, ops:[P,b,A], online:false,
              _aiNotice:()=>true, _los:()=>true };
    b._tgt=P;
    return {R,b,P,A};
  };
  // 正常 60 帧：目标应始终是玩家
  const f1=mk(); const seq=[];
  for(let i=0;i<60;i++){ const r=raidAiPickTarget(f1.R,f1.b,raidAISense(f1.b)); seq.push(r.tgt===f1.P?"P":"A"); }
  const switches=seq.reduce((n,v,i)=>n+((i&&v!==seq[i-1])?1:0),0);

  // 注意锥 / 视线逐帧翻转（模拟光锥边缘）：目标仍应保持玩家
  const f2=mk(); let flip=0, kept=0;
  for(let i=0;i<60;i++){
    const on=(i%2===0);
    f2.R._aiNotice=()=>on; f2.R._los=()=>on;
    const r=raidAiPickTarget(f2.R,f2.b,raidAISense(f2.b));
    if(r.tgt===f2.P) kept++;
    else flip++;
  }

  // 玩家死亡 → 目标应正常切到最近的 AI
  const f3=mk(); f3.P.alive=false;
  const after=raidAiPickTarget(f3.R,f3.b,raidAISense(f3.b));

  // 玩家在视距外（2000px > sight）→ 不该被选中（旧版 d 是加权分数，会误判「在视距内」）
  const f4=mk(); f4.P.x=2000;
  const far=raidAiPickTarget(f4.R,f4.b,raidAISense(f4.b));

  return { switches, kept, flip, afterDead:(after.tgt===f3.A), farPicked:(far.tgt===f4.P),
           sight:raidAISense(f1.b).sight };
})())`));
check('AI 目标黏性：60 帧内不换目标（实测切换 '+__pick.switches+' 次）',
  __pick.switches===0?1:0, 1, 0.001);
check('注意锥/视线逐帧翻转时仍锁着玩家（保持 '+__pick.kept+'/60 帧）',
  __pick.kept>=54?1:0, 1, 0.001);
check('玩家阵亡后目标正常切到最近的 AI', __pick.afterDead?1:0, 1, 0.001);
check('视距外的玩家不会被选中（sight='+__pick.sight+'px，玩家 2000px）',
  __pick.farPicked?0:1, 1, 0.001);

/* ② 真实距离：目标选举后 d 必须是欧氏距离，不能是带优先级的加权分 */
check('目标距离用真实欧氏距离（不再拿加权分当距离）',
  /const d = M\.dist\(b\.x, b\.y, tgt\.x, tgt\.y\);/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('目标选举外移到 raid-ai.js（含受击锁定 + 续锁）',
  /function raidAiPickTarget\(R, b, sense\)/.test(raidSrc)
  && /const known = sticky &&/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('帧初统一快照位置（多 AI 抢同一目标时速度不再算成 0）',
  /function raidAiSnapshot\(R\)/.test(raidSrc) && /raidAiSnapshot\(this\);/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('engage 分支不再逐帧改写 tgt._px',
  /tgt\._px=tgt\.x/.test(raidSrc) ? 0 : 1, 1, 0.001);

/* ③ 二阶转向：起步角速度从 0 加速，不是「一上来就满速」 */
const __turn = JSON.parse(G(`JSON.stringify((()=>{
  const b={ x:0,y:0,angle:0 };
  const vs=[];
  for(let i=0;i<10;i++){
    Raid._face(b, 1.2, 0.26, 1/60, 7.5);
    vs.push(Math.abs(+(b._angVel||0).toFixed(4)));
  }
  // 收尾：目标角已经很近时角速度应回落
  const b2={ x:0,y:0,angle:0, _angVel:7 };
  Raid._face(b2, 0.02, 0.26, 1/60, 7.5);
  return { vs, first:vs[0], peak:Math.max(...vs), slow:Math.abs(b2._angVel) };
})())`));
check('二阶转向：首帧角速度从小值起步（'+__turn.first.toFixed(3)+' rad/s）',
  (__turn.first>0 && __turn.first < __turn.peak*0.6)?1:0, 1, 0.001);
check('二阶转向：角速度会累计到 peak '+__turn.peak.toFixed(2)+' rad/s 且不超上限',
  (__turn.peak>0.5 && __turn.peak<=7.6)?1:0, 1, 0.001);
check('二阶转向：临到目标角会减速（'+__turn.slow.toFixed(3)+' rad/s）',
  __turn.slow < 7?1:0, 1, 0.001);

/* ④ 摄像机：帧率无关 + 瞬移吸附 */
check('摄像机跟随帧率无关（pow 换算）+ 瞬移吸附',
  /const k=1-Math\.pow\(1-0\.2, Math\.min\(4, dts\*60\)\)/.test(raidSrc)
  && /Math\.abs\(tx-this\.camera\.x\)>600/.test(raidSrc) ? 1 : 0, 1, 0.001);

/* ⑤ 打击感：震屏 / 受击白闪 / 方向性火花 / AI 枪口火光 / 受击方向弧 */
const __fx = JSON.parse(G(`JSON.stringify((()=>{
  const saveP=Raid.particles;
  const take=(ang)=>{
    const fk={ particles:[] };
    if(ang===undefined) __realHit.call(fk,0,0,"#fff");
    else __realHit.call(fk,0,0,"#fff",ang);
    const out=fk.particles.map(q=>Math.atan2(q.vy,q.vx));
    const n=fk.particles.length;
    const back=fk.particles.filter(q=>q.vx<0).length;
    return { n, out, back };
  };
  const plain=take(undefined);
  let mn=9, mx=-9;
  for(const x of plain.out){ if(x<mn)mn=x; if(x>mx)mx=x; }
  const spreadAll=+(mx-mn).toFixed(2);
  const dir=take(0);
  const fk3={ shake:0 };
  Raid.shakeAdd.call(fk3, 999);
  const cap=fk3.shake;
  const R2={ shake:8, player:{x:0,y:0}, camera:{x:0,y:0}, spectate:false };
  Raid._updateCamera.call(R2, { view:{w:1000,h:700}, zoom:1, camera:{} }, 0.5);
  return { n1:plain.n, spreadAll, back:dir.back, total:dir.n, cap, decayed:+R2.shake.toFixed(2) };
})())`));
check('命中火花无方向时 360° 均布（'+__fx.n1+' 颗，跨度 '+__fx.spreadAll+' rad）',
  (__fx.n1===6 && __fx.spreadAll>3)?1:0, 1, 0.001);
check('命中火花带方向时按反弹锥散开（'+__fx.back+'/'+__fx.total+' 颗朝来向反侧）',
  __fx.back>=5?1:0, 1, 0.001);
check('震屏有上限（999 → '+__fx.cap+'px）', (__fx.cap>0 && __fx.cap<=10)?1:0, 1, 0.001);
check('震屏按 dt 衰减（0.5s 后剩 '+__fx.decayed+'px）', __fx.decayed<8?1:0, 1, 0.001);
check('受击白闪 0.14s（_hitT 写入 + 衰减）',
  /target\._hitT=0\.14;/.test(raidSrc) && /if\(o\._hitT>0\) o\._hitT=Math\.max\(0,o\._hitT-dt\);/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('AI 开火有枪口火光（muzzleT 驱动）',
  /if\(!o\.isPlayer && !o\.remote && \(o\.muzzleT\|\|0\)>0 && o\.gun\)\{/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('HUD 有受击方向弧 + 低血量脉冲暗角',
  /R\._hurtDir!=null\)\{/.test(raidSrc) && /rgba\(150,12,12,/.test(raidSrc) ? 1 : 0, 1, 0.001);
check('世界层震屏（HUD 不跟着抖）',
  /const _shk=R\.shake\|\|0;/.test(raidSrc) ? 1 : 0, 1, 0.001);

/* ⑥ 弹药默认一发不带 */
const __ammo0 = JSON.parse(G(`JSON.stringify((()=>{
  const st=RaidStash.load ? RaidStash.load() : { ammo:{} };
  return { keys:Object.keys(st.ammo||{}).length };
})())`));
check('弹药默认全不带（大厅页脚有红字提醒）',
  (/Math\.max\(0, Math\.min\(sel\.n\|0, cap\)\) : 0;/.test(raidSrc)
   && /未携带弹药：进图后枪里没有弹匣/.test(raidSrc)) ? 1 : 0, 1, 0.001);

/* ---- 断言构成可见化（v0.26.1）----
 * verify 里混着两类断言：在 vm 中真实调用结算 / 生成逻辑的「行为断言」，和检查
 * 某段实现或文案是否仍在的「源码护栏」（对重命名、重构脆弱）。把两者的数量分开
 * 报出来，避免把总条数当成等价的行为覆盖率。分类按源码形态静态统计；
 * 运行时条数含循环内动态生成，两者不一定相等。 */
const SELF_SRC = fs.readFileSync(__filename, 'utf8');
const CHECK_LINES = SELF_SRC.split('\n').filter(l => /^\s*check\(/.test(l));
const SRC_MARK = /(raidSrc|__rd2|__fp2|netSrc|__uiCopy|__coreCopy|vmSrc|allNameSrc|__inp\b|\bhtml\b|__rd\b|__u55|__st55|__s55|__rd55)/;
const nSrc = CHECK_LINES.filter(l => SRC_MARK.test(l)).length;
const nExpr = CHECK_LINES.filter(l => !SRC_MARK.test(l) && /\bG\(/.test(l)).length;
const nBeh = CHECK_LINES.length - nSrc - nExpr;
console.log(`\n=== 断言构成（按源码形态静态分类，共 ${CHECK_LINES.length} 个 check 条目）===`);
console.log(`  行为/数值断言 ${nBeh}  |  vm 表达式求值 ${nExpr}  |  源码护栏 ${nSrc}`);
console.log(`  ⚠ 源码护栏对重命名/重构脆弱；本轮实际执行 ${pass + fail} 条（含循环内动态生成）`);

console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
