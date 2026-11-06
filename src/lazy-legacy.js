/* =========================================================================
 * lazy-legacy.js — 旧模式按需懒加载（v0.22.0）
 *
 * CFG.onlyRaid=true（线上默认）时，战役 / 无尽 / 沙二 / 大逃杀的入口被隐藏，
 * 这 4 个脚本完全不请求；只有把 CFG.onlyRaid 改为 false 复活旧模式时才加载。
 *
 * 用解析期 document.write 同步注入：既保持与拆分前一致的加载顺序，又不需要
 * 内联 <script>（同源 server.js 的 CSP 不放行 unsafe-inline）。
 * check_version.js 会额外校验这份懒加载清单里的文件存在与版本号来源。
 * ========================================================================= */
(function(){
  var LAZY = ['world','endless','dust2','br'];
  var onlyRaid = (typeof CFG === "undefined") || CFG.onlyRaid !== false;
  if(onlyRaid){
    /* 旧模式不可达：给可能被 typeof 之外直接引用的全局符号留最小占位，
     * 避免极端路径下抛 ReferenceError（不含任何逻辑，体积可忽略）。 */
    if(typeof globalThis.ZONES === "undefined")         globalThis.ZONES = [];
    if(typeof globalThis.Dust2 === "undefined")         globalThis.Dust2 = { active:false };
    if(typeof globalThis.BR === "undefined")            globalThis.BR = { active:false };
    if(typeof globalThis.EndlessWorld === "undefined")  globalThis.EndlessWorld = function(){};
    return;
  }
  var ver = (typeof CFG !== "undefined" && CFG.version) || "0.22.1";
  for(var i=0;i<LAZY.length;i++)
    document.write('<script src="src/' + LAZY[i] + '.js?v=' + ver + '"><\/script>');
})();
