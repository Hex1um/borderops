/* =========================================================================
 * build_toy.cjs — 打包 B 站 Toy 上传用的 zip（v0.36.2）
 *
 * 平台规格（《Toy 开发者 FAQ》）：
 *   · 压缩包根目录**必须**有 index.html，否则页面无法加载；
 *   · 包体上限 50MB（更大需申请）；入口 index.html 单独限 1MB；
 *   · 只发布白名单后缀的文件 —— 可执行文件 / 后端脚本会被过滤。
 *
 * 所以这里只挑「纯静态运行时」需要的文件：入口 + 样式 + 全部 src 脚本
 * （含 4 个懒加载脚本）+ vendor（PeerJS）。开发期文件（server.js /
 * verify.cjs / 测试脚本 / 文档 / .git）一律不进包。
 *
 * 用法：node tools/build_toy.cjs
 *   → 生成 dist/toy/（可直接检查）+ 打印 zip 命令
 * ========================================================================= */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'dist', 'toy');

/* 纯静态运行时白名单 */
const FIXED = ['index.html', 'styles.css', 'favicon.svg'];
const DIRS = [
  { from: 'src', to: 'src', filter: n => n.endsWith('.js') },
  { from: 'vendor', to: 'vendor', filter: n => /peerjs\.(min\.js|LICENSE)$/.test(n) },
];

function rmrf(p) { if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true }); }

rmrf(OUT);
fs.mkdirSync(OUT, { recursive: true });

const added = [];
for (const f of FIXED) {
  const src = path.join(ROOT, f);
  if (!fs.existsSync(src)) { console.error('缺少文件：' + f); process.exit(1); }
  fs.copyFileSync(src, path.join(OUT, f));
  added.push(f);
}
for (const d of DIRS) {
  const from = path.join(ROOT, d.from);
  if (!fs.existsSync(from)) continue;
  const to = path.join(OUT, d.to);
  fs.mkdirSync(to, { recursive: true });
  for (const n of fs.readdirSync(from)) {
    if (!d.filter(n)) continue;
    fs.copyFileSync(path.join(from, n), path.join(to, n));
    added.push(d.to + '/' + n);
  }
}

/* 自检：index.html 引用的每一个本地脚本都必须真的在包里（懒加载脚本除外，单独列） */
const html = fs.readFileSync(path.join(OUT, 'index.html'), 'utf8');
const refs = [...html.matchAll(/(?:src|href)="([^"?]+)/g)].map(m => m[1])
  .filter(u => !/^(https?:)?\/\//.test(u));
const missing = refs.filter(u => !fs.existsSync(path.join(OUT, u)));
const LAZY = ['src/world.js', 'src/endless.js', 'src/dust2.js', 'src/br.js'];
const lazyMissing = LAZY.filter(u => !fs.existsSync(path.join(OUT, u)));

/* 体积 */
let total = 0;
const walk = p => {
  for (const n of fs.readdirSync(p)) {
    const f = path.join(p, n);
    const st = fs.statSync(f);
    if (st.isDirectory()) walk(f); else total += st.size;
  }
};
walk(OUT);

const htmlSize = fs.statSync(path.join(OUT, 'index.html')).size;
console.log('Toy 打包清单');
console.log('  文件数        ' + added.length);
console.log('  解压总大小    ' + (total / 1024).toFixed(1) + ' KB');
console.log('  index.html    ' + (htmlSize / 1024).toFixed(1) + ' KB（平台上限 1024 KB）');
console.log('  入口引用缺失  ' + (missing.length ? missing.join(', ') : '无'));
console.log('  懒加载缺失    ' + (lazyMissing.length ? lazyMissing.join(', ') : '无'));
if (missing.length || lazyMissing.length) process.exit(1);
if (htmlSize > 1024 * 1024) { console.error('index.html 超过 1MB 上限'); process.exit(1); }
console.log('\n下一步（PowerShell）：');
console.log('  Compress-Archive -Path "' + OUT + '\\*" -DestinationPath "'
  + path.join(ROOT, 'dist', 'borderops-toy.zip') + '" -Force');
