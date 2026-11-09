/* =========================================================================
 * bump_version.cjs — 一条命令升版，消除「三处手工同步」的失误（v0.36.3）
 *
 * 用法：node tools/bump_version.cjs 0.36.3
 *       npm run bump -- 0.36.3
 *
 * 它做的事（顺序与 check_version.js 的校验项一一对应）：
 *   1. package.json 的 version
 *   2. src/config.js 的 CFG.version
 *   3. index.html 里全部 ?v= 缓存串
 *   4. WIKI.md 顶部的「当前版本 **vX.Y.Z**」
 *   5. README.md 里的版本字样（若出现）
 * 然后立刻跑一遍 check_version.js 自证；不通过就以非零码退出。
 *
 * 刻意**不做**的事：
 *   · 不写 CHANGELOG（那是人写的说明，不该自动生成废话）
 *   · 不改 README 里的断言条数（verify 实际条数以 verify 输出为准，
 *     需要时手工同步；check_version 会一致性校验）
 * ========================================================================= */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const NEXT = String(process.argv[2] || '').trim().replace(/^v/, '');

if (!/^\d+\.\d+\.\d+$/.test(NEXT)) {
  console.error('用法：node tools/bump_version.cjs <x.y.z>   （例：0.36.3）');
  process.exit(2);
}

const pkgPath = path.join(ROOT, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const PREV = pkg.version;
if (PREV === NEXT) {
  console.log('版本未变化：' + PREV);
  process.exit(0);
}
if (NEXT.localeCompare(PREV, undefined, { numeric: true }) <= 0) {
  console.error(`拒绝降版：${PREV} → ${NEXT}（要降版请手工处理，并说明原因）`);
  process.exit(2);
}

const touched = [];
function edit(rel, fn) {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) return;
  const before = fs.readFileSync(p, 'utf8');
  const after = fn(before);
  if (after !== before) { fs.writeFileSync(p, after); touched.push(rel); }
}

/* 1. package.json —— 走 JSON 解析，避免正则改坏其它字段 */
pkg.version = NEXT;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
touched.push('package.json');

/* 2. CFG.version */
edit('src/config.js', s => {
  const re = /(version:\s*")(\d+\.\d+\.\d+)(")/;
  if (!re.test(s)) throw new Error('src/config.js 里找不到 version: "x.y.z"');
  return s.replace(re, `$1${NEXT}$3`);
});

/* 3. index.html 的全部 ?v= 缓存串 */
edit('index.html', s => s.split('?v=' + PREV).join('?v=' + NEXT));

/* 4. WIKI 顶部版本 */
edit('WIKI.md', s => s.replace(new RegExp('\\*\\*v' + PREV.replace(/\./g, '\\.') + '\\*\\*'), `**v${NEXT}**`));

/* 5. README 里若显式写了当前版本号（可选） */
edit('README.md', s => s.split('?v=' + PREV).join('?v=' + NEXT));

console.log(`版本 ${PREV} → ${NEXT}`);
console.log('  已改：' + touched.join('、'));

/* 自证：直接复用门禁，不同步就当场失败 */
try {
  const out = execFileSync(process.execPath, [path.join(ROOT, 'check_version.js')], { encoding: 'utf8' });
  const lines = out.trim().split('\n');
  const bad = lines.filter(l => l.startsWith('  ✗'));
  if (bad.length) {
    console.error('\n版本门禁未通过：');
    bad.forEach(l => console.error(l));
    process.exit(1);
  }
  console.log('  check_version：全部通过');
} catch (e) {
  console.error('\ncheck_version 执行失败：' + (e.stdout || e.message));
  process.exit(1);
}

console.log('\n下一步：');
console.log('  1) 在 CHANGELOG.md 顶部补一节（人写的说明，别自动生成）');
console.log('  2) node verify.cjs && npx eslint src/');
console.log('  3) git commit && git push origin main');
