/* =========================================================================
 * check_version.js — 版本一致性门禁（Node 原生，零依赖）
 * 校验三处手工维护的版本号：package.json / src/config.js 的 CFG.version /
 * index.html 里所有 ?v= 缓存串，并确认每个 <script src> 都带缓存串。
 * 用法：npm run check     失败时以退出码 1 结束，可直接放进 CI。
 * ========================================================================= */
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const read = f => fs.readFileSync(path.join(ROOT, f), "utf8");
let failed = false;
const fail = msg => { console.error("  ✗ " + msg); failed = true; };
const ok = msg => console.log("  ✓ " + msg);

const pkg = JSON.parse(read("package.json"));
const version = pkg.version;
console.log("BORDER OPS 版本一致性检查 (目标 " + version + ")");

// 1) package.json 版本格式
if (!/^\d+\.\d+\.\d+$/.test(version)) fail("package.json 的 version 不是 x.y.z：" + version);
else ok("package.json version = " + version);

// 2) src/config.js 的 CFG.version
const cfg = read("src/config.js");
const m = cfg.match(/version\s*:\s*"([^"]+)"/);
if (!m) fail("src/config.js 找不到 version 字段");
else if (m[1] !== version) fail(`src/config.js CFG.version = ${m[1]}，应为 ${version}`);
else ok("src/config.js CFG.version = " + version);

// 3) index.html 的所有 ?v= 缓存串
const html = read("index.html");
const tags = [...html.matchAll(/\?v=([0-9.]+)/g)].map(x => x[1]);
if (!tags.length) fail("index.html 里没有任何 ?v= 缓存串");
else {
  const bad = tags.filter(v => v !== version);
  if (bad.length) fail(`index.html 有 ${bad.length} 个 ?v= 与版本不一致：${[...new Set(bad)].join(", ")}`);
  else ok(`index.html ${tags.length} 处 ?v= 全部为 ${version}`);
}

// 4) 每个脚本标签都带缓存串（漏带会导致玩家拿到旧代码）
const scripts = [...html.matchAll(/<script\s+src="([^"]+)"/g)].map(x => x[1]);
const noCache = scripts.filter(s => !s.includes("?v="));
if (noCache.length) fail("以下脚本缺少 ?v= 缓存串：" + noCache.join(", "));
else ok(`${scripts.length} 个 <script src> 均带缓存串`);

// 5) 脚本文件确实存在
const missing = scripts.filter(s => !fs.existsSync(path.join(ROOT, s.split("?")[0])));
if (missing.length) fail("以下脚本文件不存在：" + missing.join(", "));
else ok("全部脚本文件存在");

// 6) v0.22.0：懒加载脚本不出现在 <script src> 里，单独校验清单
//    （防止删掉文件后 onlyRaid=false 的旧模式恢复路径静默 404）
if (!html.includes("src/lazy-legacy.js")) fail("index.html 未引用 src/lazy-legacy.js");
else {
  const lazySrc = read("src/lazy-legacy.js");
  const lm = lazySrc.match(/var\s+LAZY\s*=\s*\[([^\]]+)\]/);
  const lazyNames = lm ? [...lm[1].matchAll(/['"]([^'"]+)['"]/g)].map(x => x[1]) : [];
  if (!lazyNames.length) fail("lazy-legacy.js 找不到 LAZY 清单");
  else {
    const gone = lazyNames.filter(n => !fs.existsSync(path.join(ROOT, "src", n + ".js")));
    if (gone.length) fail("懒加载脚本文件不存在：" + gone.join(", "));
    else ok(`懒加载清单 ${lazyNames.length} 个脚本均存在（${lazyNames.join(", ")}）`);
  }
  if (!/CFG\.version/.test(lazySrc)) fail("lazy-legacy.js 未用 CFG.version 拼接缓存串（会拿到旧代码）");
  else ok("懒加载脚本使用 CFG.version 动态拼接 ?v=");
}

/* ---- v0.26.1：文档版本引用也纳入门禁 ----
 * 之前 WIKI 顶部长期停在 v0.19.0、README 还写着「CI 因缺 workflow scope 尚未推送」，
 * 而 CI 其实早已成功运行。版本一致性不能只管代码三处，文档同样会漂。 */
// 7) WIKI 顶部「当前版本」
const wiki = read("WIKI.md");
const wikiVer = wiki.match(/当前版本\s*\*\*v([0-9.]+)\*\*/);
if (!wikiVer) fail("WIKI.md 找不到「当前版本 **vX.Y.Z**」标记");
else if (wikiVer[1] !== version) fail(`WIKI.md 当前版本 = v${wikiVer[1]}，应为 v${version}`);
else ok("WIKI.md 当前版本 = v" + version);

// 8) CHANGELOG 最新一节的版本（后面的历史节保留当时真实数字，不许改）
const changelog = read("CHANGELOG.md");
const chVer = changelog.match(/^## v([0-9.]+)\s/m);
if (!chVer) fail("CHANGELOG.md 找不到 ## vX.Y.Z 条目");
else if (chVer[1] !== version) fail(`CHANGELOG.md 最新节 = v${chVer[1]}，应为 v${version}`);
else ok("CHANGELOG.md 最新节 = v" + version);

// 9) README 里描述 verify.cjs 的多处断言数必须一致（一处更新另一处漏掉是常见漂移）
//    只看提到 verify 的行，别把 playwright_smoke.py 的「42 项断言」也算进来。
const readme = read("README.md");
const nums = readme.split("\n")
  .filter(l => /verify\.cjs|npm run verify/.test(l))
  .flatMap(l => [...l.matchAll(/(\d+)\s*(?:条|项)断言/g)].map(x => +x[1]));
if (nums.length < 2) fail("README.md 找不到两处断言数");
else if (new Set(nums).size !== 1) fail(`README.md 断言数不一致：${nums.join(" / ")}`);
else ok(`README.md ${nums.length} 处断言数一致（${nums[0]}）`);

// 10) 文案护栏：CI 早已启用，不许再出现「尚未推送 / 未启用」的旧说法
// 只拦明确的过时表述；「本机凭据缺 workflow scope」属于现状说明，不能误判
if (/CI[^\n]*(尚未推送到远端|未启用|需按 CHANGELOG)/.test(readme))
  fail("README.md 仍有「CI 未启用」的过时说明");
else ok("README.md 无过时 CI 说明");

// 11) LICENSE 存在（有真实合作者，许可缺失会造成归属模糊）
if (!fs.existsSync(path.join(ROOT, "LICENSE"))) fail("缺少 LICENSE 文件");
else ok("LICENSE 存在");

/* 12) README 的「目录结构」表不能指向不存在的文件（v0.36.3）
 * 之前 README 写「raid 拆成 7 片 / 单片 ≤1621 行」，实际早就是 9 片 1999 行 —— 文档漂移没人发现。
 * 这里做**存在性**校验（不判行数，行数由 verify 的护栏管）：
 * 表格里每一个 `反引号路径`，只要看起来像路径（含 / 或以常见扩展名结尾）就必须真的存在；
 * 带通配符 / 形如 `src/raid-*.js` 「一片指代多文件」的写法自动跳过。
 * 另外给一条软校验：README 里声明的 raid 分片数量必须与实际文件数一致。 */
{
  const sec = readme.split("## 目录结构")[1] || "";
  const table = sec.split(/\n##\s/)[0];
  /* 运行期产物目录是 gitignore 的（testshots/ 截图、dist/ 打包），
     文档里提它们是合理的，所以放行这几个前缀。 */
  const RUNTIME_ONLY = ["testshots/", "dist/", "node_modules/", "shots/"];
  const paths = [...table.matchAll(/`([^`\n]+)`/g)].map(x => x[1].trim())
    .filter(p => /^[\w./-]+$/.test(p) && !p.includes("*"))
    .filter(p => p.includes("/") || /\.(js|json|html|css|svg|md|yml|py|cjs)$/.test(p))
    .filter(p => !RUNTIME_ONLY.some(r => p.startsWith(r)));
  const missing = paths.filter(p => !fs.existsSync(path.join(ROOT, p)));
  if (missing.length) fail(`README 目录结构表指向不存在的路径：${missing.join("、")}`);
  else ok(`README 目录结构表 ${paths.length} 条路径均存在`);

  const claim = readme.match(/拆成\s*(\d+)\s*片/);
  const real = fs.readdirSync(path.join(ROOT, "src")).filter(f => /^raid-.*\.js$/.test(f)).length;
  if (claim && +claim[1] !== real) fail(`README 写「拆成 ${claim[1]} 片」，实际 src 下有 ${real} 个 raid-*.js`);
  else if (claim) ok(`README 分片数与实际一致（${real} 片）`);
}

if (failed) { console.error("\n检查未通过。请同步 package.json / CFG.version / index.html 的 ?v= 与文档版本引用。"); process.exit(1); }
console.log("\n全部通过。");
