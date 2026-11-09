/* =========================================================================
 * build_toy.cjs — 打包 B 站 Toy 上传用的 zip（v0.36.2）
 *
 * 平台规格（《Toy 开发者 FAQ》）：
 *   · 压缩包**根目录必须有 index.html**，否则页面无法加载；
 *   · 包体上限 50MB（更大需申请）；入口 index.html 单独限 1MB；
 *   · 只发布白名单后缀的文件 —— 可执行文件 / 后端脚本会被过滤。
 *
 * v0.36.2+：脚本**自己写 zip**（Node 原生 zlib，零依赖），不再依赖
 * PowerShell 的通配符 —— 因为「把外层文件夹一起压进去」正是
 * 「上传后打不开」的头号原因。现在根目录结构由代码保证，且会在打包后自检。
 *
 * 用法：node tools/build_toy.cjs
 *   → dist/toy/                      可直接检查目录结构
 *   → dist/borderops-toy-<ver>.zip   可直接上传
 * ========================================================================= */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'dist', 'toy');
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const ZIP = path.join(ROOT, 'dist', `borderops-toy-v${VERSION}.zip`);

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

/* ------------------------------------------------------------------ zip 写入
 * 最小可用 ZIP 实现：deflate 压缩 + UTF-8 文件名（flag bit 11）。
 * 固定时间戳，保证同样的输入产出同样的字节，便于核对。 */
const CRC_TBL = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TBL[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function dosTime(d) {
  return ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xFFFF;
}
function dosDate(d) {
  return (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xFFFF;
}

function makeZip(files, dest) {
  const stamp = new Date(2026, 10, 9, 15, 30, 0);
  const t = dosTime(stamp), d = dosDate(stamp);
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const f of files) {
    const nameBuf = Buffer.from(f, 'utf8');
    const raw = fs.readFileSync(path.join(OUT, f));
    const comp = zlib.deflateRawSync(raw, { level: 9 });
    const useDeflate = comp.length < raw.length;
    const body = useDeflate ? comp : raw;
    const method = useDeflate ? 8 : 0;
    const crc = crc32(raw);

    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);            // version needed
    lh.writeUInt16LE(0x0800, 6);        // UTF-8 文件名
    lh.writeUInt16LE(method, 8);
    lh.writeUInt16LE(t, 10);
    lh.writeUInt16LE(d, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(body.length, 18);
    lh.writeUInt32LE(raw.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    lh.writeUInt16LE(0, 28);
    locals.push(lh, nameBuf, body);

    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);            // version made by
    ch.writeUInt16LE(20, 6);            // version needed
    ch.writeUInt16LE(0x0800, 8);
    ch.writeUInt16LE(method, 10);
    ch.writeUInt16LE(t, 12);
    ch.writeUInt16LE(d, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(body.length, 20);
    ch.writeUInt32LE(raw.length, 24);
    ch.writeUInt16LE(nameBuf.length, 28);
    ch.writeUInt16LE(0, 30);            // extra
    ch.writeUInt16LE(0, 32);            // comment
    ch.writeUInt16LE(0, 34);            // disk
    ch.writeUInt16LE(0, 36);            // internal attr
    ch.writeUInt32LE(0, 38);            // external attr
    ch.writeUInt32LE(offset, 42);       // local header offset
    centrals.push(ch, nameBuf);

    offset += lh.length + nameBuf.length + body.length;
  }

  const centralBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, Buffer.concat([...locals, centralBuf, eocd]));
}

makeZip(added, ZIP);

/* ------------------------------------------------------------------ 打包后自检
 * 直接解析产出的 zip，确认「根目录就有 index.html」且没有外层包裹目录。 */
function verifyZip(zipPath) {
  const buf = fs.readFileSync(zipPath);
  const names = [];
  let i = 0;
  while (i + 4 <= buf.length && buf.readUInt32LE(i) === 0x04034b50) {
    const method = buf.readUInt16LE(i + 8);
    const csize = buf.readUInt32LE(i + 18);
    const nlen = buf.readUInt16LE(i + 26);
    const elen = buf.readUInt16LE(i + 28);
    names.push(buf.slice(i + 30, i + 30 + nlen).toString('utf8'));
    i += 30 + nlen + elen + csize;
    if (method !== 8 && method !== 0) break;
  }
  return names;
}
const names = verifyZip(ZIP);
const rootHtml = names.includes('index.html');
const nestedHtml = names.some(n => /^[^/]+\/index\.html$/.test(n));
if (!rootHtml || nestedHtml) {
  console.error('zip 结构不对：根目录 index.html=' + rootHtml + '，疑似多套一层=' + nestedHtml);
  process.exit(1);
}

console.log('Toy 打包完成');
console.log('  文件数        ' + added.length);
console.log('  解压总大小    ' + (total / 1024).toFixed(1) + ' KB');
console.log('  index.html    ' + (htmlSize / 1024).toFixed(1) + ' KB（平台上限 1024 KB）');
console.log('  入口引用缺失  ' + (missing.length ? missing.join(', ') : '无'));
console.log('  懒加载缺失    ' + (lazyMissing.length ? lazyMissing.join(', ') : '无'));
console.log('  根目录        index.html 在包根 ✅（无外层包裹目录）');
console.log('  zip           ' + path.relative(ROOT, ZIP) + '  '
  + (fs.statSync(ZIP).size / 1024).toFixed(1) + ' KB');
console.log('  顶层条目      ' + [...new Set(names.map(n => n.split('/')[0]))].join(', '));
if (missing.length || lazyMissing.length) process.exit(1);
if (htmlSize > 1024 * 1024) { console.error('index.html 超过 1MB 上限'); process.exit(1); }

