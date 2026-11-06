/* =========================================================================
 * sanitize.js — 联机数据净化内核（零依赖 · 同构）
 *
 * 同时服务三处，规则只有一份：
 *   1) server.js（HTTP 轮询路径）   通过 require("./src/sanitize.js") 引入
 *   2) src/net.js（GitHub Pages 上的 WebRTC P2P 路径）  通过全局 Sanitize 调用
 *   3) verify.cjs（逻辑回归单测）              通过 require 直接调用纯函数
 *
 * v0.22.0：补两处纵深防御
 *   - corpse 事件的掉落数组不再「任意对象直通背包」：逐项按 schema 裁剪，
 *     白名单 kind、剔除原型污染键、数值封顶、字符串剥 HTML、限制深度/键数/项数。
 *   - text() 除了控制字符，额外剥离 HTML 危险字符，避免网络字符串日后被插入 DOM 触发 XSS。
 *
 * UMD：Node 走 module.exports；浏览器经典脚本挂到全局 Sanitize。
 * ========================================================================= */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.Sanitize = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var MAX_EVENT_DATA = 32 * 1024;

  /* 允许客户端发出的事件类型（join/leave/host/start 是服务端保留字，客户端不可伪造） */
  var CLIENT_EVENT_TYPES = ["hitai", "hitpeer", "dmg", "loot", "shot", "corpse", "extract", "dead", "chat"];

  /* corpse 掉落物允许进入背包的 kind —— 与 raid.js::_collect 的分流一致。
   * 不在此集合的对象整项丢弃，杜绝伪造 item 类型。 */
  var DROP_KINDS = [
    "weapon", "gun", "armor", "helmet", "shield", "part", "med",
    "ammo", "material", "mat", "key", "receiver", "rec", "core", "booster", "relic",
  ];

  /* 原型污染 / 特殊键（任何层级都剔除） */
  var DANGER_KEYS = ["__proto__", "prototype", "constructor", "__defineGetter__", "__defineSetter__"];

  /* 战斗/经济数值的硬上限，防「dmg:99999」这类注入装备。
   * 上限按合法掉落物实测峰值 × 数倍余量设定（probe_drops.js）：
   *   damage 峰值 ~6830（iLv60 孤品枪）、value 峰值 ~1651 万（T9 护盾）、speed 峰值 ~2819。
   * 只收紧最易被拿来刷装备的字段，其余 number 走通用 NUM_MIN/MAX，避免误削正常词条。 */
  var NUM_CAPS = {
    dmg: 50000, damage: 50000, power: 50000,
    value: 100000000, price: 100000000, worth: 100000000, cost: 100000000,
    tier: 12, ilvl: 500, lv: 20, at: 9,
    n: 200000, mag: 500, magSize: 500, reserve: 200000, ammoMag: 500, ammoRes: 200000,
    dr: 100000, maxArmor: 1000000, armor: 1000000, hp: 1000000, maxHelmetArmor: 1000000,
  };
  var NUM_MIN = -1000000, NUM_MAX = 1000000000;
  /* 合法武器对象实测：深度 7 / 键 24 / 数组 10 / 字符串 32 —— 阈值留足余量，
   * 否则会把 affixes 等嵌套词条裁成 null，等于削掉联机掉落的装备属性。 */
  var MAX_DROPS = 6, MAX_KEYS = 64, MAX_DEPTH = 8, MAX_ARRAY = 64, MAX_STR = 240;

  /* 控制字符 + HTML 危险字符 → 空格。
   * 保留可读性（不改成空串把词粘一起），同时让 <img onerror=...> 之类不再可执行。 */
  function stripHtml(v) {
    return String(v == null ? "" : v)
      .replace(/[\u0000-\u001f\u007f]/g, " ")
      .replace(/[<>&"'`]/g, " ");
  }

  /* 文本裁剪：控制字符 / HTML 字符剥离 + 限长（server.js 的 text 委托到这里） */
  function text(v, max) {
    return stripHtml(v).slice(0, max == null ? MAX_STR : max);
  }

  /* 数值裁剪：非有限值返回 null */
  function num(v, min, max) {
    var n = Number(v);
    if (!isFinite(n)) return null;
    n = Math.max(min, Math.min(max, n));
    return n;
  }

  function isPlainObject(o) {
    return !!o && typeof o === "object" && !Array.isArray(o);
  }

  /* 递归把任意值裁剪成「安全值」。深度/键数/数组长度全部受限，防止巨型对象撑爆内存。 */
  function cleanValue(v, key, depth) {
    if (v === null || v === undefined) return null;
    var t = typeof v;
    if (t === "number") {
      if (!isFinite(v)) return null;
      var cap = NUM_CAPS[key];
      var hi = cap == null ? NUM_MAX : cap;
      /* 对称封顶：合法词条存在负值（实测 -13.3 的后坐力 / 负面词缀），
       * 早期把下限写死 0 会把它们钳成 0，等于削掉联机装备属性。 */
      var lo = cap == null ? NUM_MIN : -cap;
      return Math.max(lo, Math.min(hi, v));
    }
    if (t === "string") return stripHtml(v).slice(0, MAX_STR);
    if (t === "boolean") return v;
    if (depth >= MAX_DEPTH) return null;
    if (Array.isArray(v)) {
      var out = [];
      for (var i = 0; i < Math.min(v.length, MAX_ARRAY); i++) out.push(cleanValue(v[i], "", depth + 1));
      return out;
    }
    if (t === "object") {
      var obj = {};
      var keys = Object.keys(v), n = 0;
      for (var j = 0; j < keys.length && n < MAX_KEYS; j++) {
        var k = keys[j];
        if (DANGER_KEYS.indexOf(k) >= 0) continue;
        obj[k] = cleanValue(v[k], k, depth + 1);
        n++;
      }
      return obj;
    }
    return null;   // function / symbol / bigint 一律丢弃
  }

  /* 单个 corpse 掉落物：kind 白名单 + 逐字段安全裁剪。
   * 返回 null 表示整项丢弃（非对象 / 非法 kind / 缺 kind）。 */
  function corpseDrop(o) {
    if (!isPlainObject(o)) return null;
    var kind = typeof o.kind === "string" ? stripHtml(o.kind).slice(0, 24) : "";
    if (DROP_KINDS.indexOf(kind) < 0) return null;
    var out = cleanValue(o, "", 0);
    out.kind = kind;
    return out;
  }

  /* corpse 事件掉落数组：最多 6 项，逐项校验，非法项静默丢弃 */
  function corpseDrops(arr) {
    if (!Array.isArray(arr)) return [];
    var out = [];
    for (var i = 0; i < Math.min(arr.length, MAX_DROPS); i++) {
      var d = corpseDrop(arr[i]);
      if (d) out.push(d);
    }
    return out;
  }

  return {
    MAX_EVENT_DATA: MAX_EVENT_DATA,
    CLIENT_EVENT_TYPES: CLIENT_EVENT_TYPES,
    DROP_KINDS: DROP_KINDS,
    NUM_CAPS: NUM_CAPS,
    stripHtml: stripHtml,
    text: text,
    num: num,
    corpseDrop: corpseDrop,
    corpseDrops: corpseDrops,
    cleanValue: cleanValue,
  };
});
