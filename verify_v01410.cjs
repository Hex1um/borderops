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
  'world', 'endless', 'dust2', 'shop', 'input', 'render', 'ui', 'raid', 'net', 'net-p2p', 'auction', 'br', 'save'];
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
check('枪型池无旧型号残留', /"P226"|"USP \.45"|"P-07"|"UMP \.45"|"SPAS-12"|"M24"|"FN SCAR-L"/.test(cfgSrc) ? 1 : 0, 0, 0.001);
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

console.log('\n=== 21. 暂时隐藏厂商名 ===');
const CFGv = G('CFG');
const MANU = G('MANUFACTURERS');
const stripM = G('stripManufacturer');
const WeaponC = G('Weapon');
const manNames = Object.values(MANU).map(m => m.name);
check('CFG.showManufacturer = false', CFGv.showManufacturer === false ? 1 : 0, 1, 0.001);
let manInName = 0;
for (let i = 0; i < 200; i++) {
  const g = G('blGunGen')(1 + (i % 40), { type: ['pistol','smg','shotgun','rifle','sniper','launcher'][i%6], rarity: ['white','green','blue','purple','orange'][i%5] });
  if (manNames.some(n => g.name.startsWith(n))) manInName++;
}
check('新生成枪名不含厂商前缀', manInName, 0, 0.001);
check('旧存档枪名可剥离厂商前缀', stripM('图拉兵工厂 AK-74N 5.45×39 战术型') === 'AK-74N 5.45×39 战术型' ? 1 : 0, 1, 0.001);
check('无前缀名称保持原样', stripM('AK-74N 5.45×39 战术型') === 'AK-74N 5.45×39 战术型' ? 1 : 0, 1, 0.001);
const oldW = new WeaponC({ name:'图拉兵工厂步枪', type:'rifle', rarity:'white', ilvl:1, magSize:30, stats:{ damage:10, fireRate:5, accuracy:0.9, mag:30, reload:2, speed:800, pellets:1, splash:0, crit:1.5, critChance:0.15, auto:true, charge:false, spread:0.05, ammoType:'rifle', pierce:0, homing:false, lifesteal:0, elemChance:0, recoil:0, moveMul:1, rangeMul:1, splashDmgMul:1, shieldOnHit:0, ammoEff:0 } });
check('Weapon 构造器剥离旧厂商前缀', oldW.name === '步枪' ? 1 : 0, 1, 0.001);
check('UI 厂商名已条件显示', /CFG\.showManufacturer===false/.test(uiSrc) ? 1 : 0, 1, 0.001);
check('仓库旧枪名加载时剥离', /stripManufacturer/.test(raidSrc) && /showManufacturer/.test(raidSrc) ? 1 : 0, 1, 0.001);

console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
