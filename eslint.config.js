/* =========================================================================
 * eslint.config.js — ESLint 9 flat config（v0.26.1）
 *
 * 这个仓库是 30 个经典脚本共享全局词法作用域（零构建、按 index.html 顺序加载）。
 * 对 ESLint 来说每个文件是独立作用域，跨文件引用的全局符号会被 no-undef 当成
 * 未定义 —— 所以这里在配置加载时扫描 src/*.js 的顶层声明，自动生成一份
 * 「项目全局白名单」。拼错的全局名不在白名单里，照样报错，no-undef 的价值保住了；
 * 新增顶层全局符号也不用手工维护配置。
 *
 * no-unused-vars 故意关掉：顶层声明本来就是给别的文件用的，在本文件里必然
 * 「未使用」，开它只会得到 ~100% 误报。等哪天拆成模块再打开。
 * ========================================================================= */
"use strict";
const fs = require("fs");
const path = require("path");

const SRC = path.join(__dirname, "src");
const globals = {};

// 浏览器 / 宿主内置（经典脚本，非 ESM）
for (const g of [
  "window", "document", "console", "navigator", "location", "performance",
  "requestAnimationFrame", "cancelAnimationFrame", "setTimeout", "clearTimeout",
  "setInterval", "clearInterval", "localStorage", "sessionStorage", "globalThis",
  "Image", "Audio", "WebSocket", "Event", "CustomEvent", "MouseEvent",
  "KeyboardEvent", "PointerEvent", "HTMLElement", "DOMParser", "Blob", "URL",
  "fetch", "TextEncoder", "TextDecoder", "crypto",
  "Math", "JSON", "Set", "Map", "WeakMap", "WeakSet", "Promise", "Symbol",
  "Proxy", "Reflect", "Array", "Object", "String", "Number", "Boolean", "Date",
  "RegExp", "Error", "TypeError", "RangeError", "parseInt", "parseFloat",
  "isNaN", "isFinite", "NaN", "Infinity", "undefined", "Intl", "BigInt",
  "Uint8Array", "Float32Array", "ArrayBuffer", "DataView", "Function",
  "structuredClone", "queueMicrotask", "AbortController", "ResizeObserver",
  "URLSearchParams", "MutationObserver", "IntersectionObserver", "matchMedia",
  "FileReader", "FormData", "Blob", "URL", "CompressionStream", "DecompressionStream", "Response", "Request", "Headers",
  "module", "require", "exports", "process", "Buffer", "__dirname",
]) globals[g] = "readonly";

// 项目顶层声明：const / let / var / function / class（行首即顶层）。
// 一行里常有逗号连续声明（const A=1, B=2;），B/C 也要收进白名单。
for (const f of fs.readdirSync(SRC).filter(n => n.endsWith(".js"))) {
  const src = fs.readFileSync(path.join(SRC, f), "utf8");
  const first = /^(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/gm;
  let m;
  while ((m = first.exec(src))) globals[m[1]] = "readonly";
  // 同一行里的后续声明：逐行扫，把每个 ", NAME =" 都收进来
  for (const line of src.split("\n")) {
    if (!/^(?:const|let|var)\s/.test(line)) continue;
    const rr = /,\s*([A-Za-z_$][\w$]*)\s*=/g;
    let r;
    while ((r = rr.exec(line))) globals[r[1]] = "readonly";
  }
}
// 通过 globalThis / window / UMD root 挂载、没有顶层声明的符号
for (const g of ["ZONES", "Dust2", "BR", "EndlessWorld", "Sanitize"]) globals[g] = "readonly";

module.exports = [
  {
    files: ["src/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
      globals,
    },
    rules: {
      "no-undef": "error",
      "no-implied-eval": "error",
      "no-undef-init": "error",
      "no-dupe-args": "error",
      "no-dupe-keys": "error",
      "no-unreachable": "error",
      "no-self-assign": "error",
      "no-constant-condition": ["error", { checkLoops: false }],
      // 共享全局架构下顶层声明必然「本文件未使用」，开它只会全是误报
      "no-unused-vars": "off",
    },
  },
  {
    ignores: ["node_modules/**", "vendor/**", "testshots/**", "shots/**"],
  },
];
