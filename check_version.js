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

if (failed) { console.error("\n检查未通过。请同步 package.json / CFG.version / index.html 的 ?v=。"); process.exit(1); }
console.log("\n全部通过。");
