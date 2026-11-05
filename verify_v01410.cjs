/* =========================================================================
 * verify_v01410.cjs — 逻辑回归（v0.14.10 ~ v0.16.0）
 * 按 index.html 顺序在 vm 中加载 22 个模块，直接调用 Raid._damage /
 * _tickElementStatus / _tickShield / _fire 等做真实结算，无需浏览器。
 * v0.16.0 起元素倍率改为「从 AMMO_TYPES 表动态取期望值」，不再写死旧数值；
 * 新增护盾装备的三数值 / 配件 / 前后缀 / 破盾无敌 / 独特加成 / 经济链路断言。
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

// 顺序必须与 index.html 一致（main.js 会 new Game() 故跳过）
const files = ['config', 'util', 'weapons', 'items', 'shields', 'skills', 'player', 'enemies', 'combat',
  'world', 'endless', 'dust2', 'shop', 'input', 'render', 'ui', 'viewmode', 'fpview',
  'raid', 'net', 'net-p2p', 'auction', 'br', 'save'];
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
const raidSrc = fs.readFileSync(path.join(SRC, 'raid.js'), 'utf8');
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
check('9 阶底材', Object.keys(SB).length, 9, 0.001);
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
  if (!/^(PM|PB|MP-443 Grach|GSh-18|TT|MP-133|TOZ-106|M870|MP-153|KS-23M|PP-91 Kedr|PP-9 Klin|PP-19-01 Vityaz|MP5)( · (PS|T|RIP))?$/.test(g.name)) badName++;
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
const nameFiles = ['config', 'raid', 'ui', 'shop', 'player', 'world', 'endless', 'save', 'skills', 'items', 'shields', 'br'];
const allNameSrc = nameFiles.map(f => fs.readFileSync(path.join(SRC, f + '.js'), 'utf8')).join('\n') + cfgSrc;
const deltaHits = ['干员', '悬赏', '黑市代币', '配给券', '三角洲', '曼德尔', '烽火地带', '哈夫克'].filter(w => allNameSrc.includes(w));
check('源码中无三角洲术语', deltaHits.length, 0, 0.001);
check('Boss 使用塔科夫名称', /Reshala/.test(raidSrc) && /Killa/.test(raidSrc) && /Shturman/.test(raidSrc) ? 1 : 0, 1, 0.001);
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
  return { base0, cap:z.cost*1.4,
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
check('撤离费封顶 1.4 倍', feeTbl.rows.every(r => r.fee <= feeTbl.cap + 1) ? 1 : 0, 1, 0.001);
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
check('文案：同场 AI 数量与实际一致', /与 30 名 <b style="color:#e0b84a">PMC \/ Scav<\/b> 加 3 名/.test(raidSrc) ? 1 : 0, 1, 0.001);

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
check('大厅弹药默认 0 发', /: 0;\s*\n\s*UI\._raidAmmo\[cal\]=/.test(raidSrc) ? 1 : 0, 1, 0.001);

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
check('回收超市可以卖弹药', /key==="am"/.test(raidSrc) && /弹药 · "\+d\.spec/.test(raidSrc) ? 1 : 0, 1, 0.001);

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
check('装备包弹药是 T2', support.ammoLv.length > 0 && support.ammoLv.every(l=>l===2) ? 1 : 0, 1, 0.001);
check('装备包含护盾 / 护甲 / 头盔', (support.kinds.shield===1 && support.kinds.armor===1 && support.kinds.helmet===1) ? 1 : 0, 1, 0.001);
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
check('军火超市护甲与头盔合并成一栏', /id:'armor',name:'护甲 · 头盔'/.test(raidSrc) ? 1 : 0, 1, 0.001);
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

check('跑刀移速加成 = +20%', G('RAID_BAREHAND_SPEED'), 1.20, 0.001);
check('移速计算乘上空手加成', /\*\(p\.gun\?1:RAID_BAREHAND_SPEED\)/.test(raidSrc) ? 1 : 0, 1, 0.001);

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
check('枪管拆金属 / 瞄具拆电子', /steel|alloy|scrap/.test(salvage.barrel[0].id) && /copper|circuit|coil/.test(salvage.optic[0].id) ? 1 : 0, 1, 0.001);
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
const tierNames9 = JSON.parse(G(`JSON.stringify(RAID_TIERS.map(t=>[t.name,t.color]))`));
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

console.log('\n=== 30. 完整模式显示前后缀 + T10 改名「特供」 + 最高三档仅黑市赌博机产出 ===');
// 完整模式：显示分层关闭（显示前后缀 / 品质）
const prevD = G('CFG.display'); G('CFG.display="full"');
check('完整模式 weaponQualityHidden=false', G('weaponQualityHidden()')?0:1, 1, 0.001);
check('第10档品质改名 特供', G('RARITIES.find(r=>r.id==="primordial").name==="特供"')?1:0, 1, 0.001);
// 完整模式：枪名应含前后缀
const preOk = G('(function(){ const w=generateWeapon(40,{rarity:"primordial"}); const a=w.affixes.find(x=>x.kind==="prefix")||w.affixes[0]; return a? gunNameOf(w).indexOf(a.nm)>=0 : false; })()');
check('完整模式枪名含前后缀', preOk?1:0, 1, 0.001);
// 精简模式：隐藏前后缀与品质
G('CFG.display="compact"');
check('精简模式 weaponQualityHidden=true', G('weaponQualityHidden()')?1:0, 1, 0.001);
const preOkC = G('(function(){ const w=generateWeapon(40,{rarity:"primordial"}); const a=w.affixes.find(x=>x.kind==="prefix")||w.affixes[0]; return a? gunNameOf(w).indexOf(a.nm)>=0 : true; })()');
check('精简模式枪名不含前后缀', preOkC?0:1, 1, 0.001);
G('CFG.display="'+prevD+'"');

// 最高三档（特供/珍藏/孤品）默认权重归零
check('默认权重 特供=0', G('RARITIES.find(r=>r.id==="primordial").weight'), 0, 0.001);
check('默认权重 珍藏=0', G('RARITIES.find(r=>r.id==="celestial").weight'), 0, 0.001);
check('默认权重 孤品=0', G('RARITIES.find(r=>r.id==="singularity").weight'), 0, 0.001);
check('黑市权重不再含特供', ("primordial" in G('SHOPS.black.weights'))?0:1, 1, 0.001);
check('赌博机改为金币(gold)结算', G('(SHOPS.gamble.currency||"gold")==="gold"')?1:0, 1, 0.001);
check('赌博机权重含 特供', G('(SHOPS.gamble.weights.primordial||0)>0')?1:0, 1, 0.001);
check('赌博机权重含 珍藏', G('(SHOPS.gamble.weights.celestial||0)>0')?1:0, 1, 0.001);
check('赌博机权重含 孤品', G('(SHOPS.gamble.weights.singularity||0)>0')?1:0, 1, 0.001);
// rollQuality 默认表（无权重参数）绝不出最高三档
check('rollQuality 默认不出特供', G('(function(){ for(let i=0;i<500;i++){ if(rollQuality(60,{})==="primordial") return false; } return true; })()')?1:0, 1, 0.001);
check('rollQuality 默认不出孤品', G('(function(){ for(let i=0;i<500;i++){ if(rollQuality(60,{})==="singularity") return false; } return true; })()')?1:0, 1, 0.001);

console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
