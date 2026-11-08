/* =========================================================================
 * store.js — 本地存储统一入口（全项目访问 localStorage 的唯一合法通道）
 * =========================================================================
 *
 * 为什么需要这一层
 * ----------------
 * v0.23.0 之前，战场仓库 / 拍卖行 / 视角设置 / 昵称 四处各自手写
 * `localStorage.getItem → JSON.parse → 判形状 → catch(e){}`，带来三个问题：
 *
 *   1. **重复**：同一套兜底逻辑抄了 4 遍，改一处漏三处；
 *   2. **静默**：`catch(e){}` 把「档坏了」和「浏览器不给存」混为一谈，线上出问题
 *      没有任何痕迹，玩家只表现为「东西没了」；
 *   3. **脆弱**：部分浏览器在 iframe / 隐私模式下**访问 localStorage 属性本身**
 *      就抛 SecurityError，连 try 都来不及 —— 必须把取引用这一步也包起来。
 *
 * 本层只做四件事，不掺业务：
 *   - 探测可用性，不可用时自动降级到内存（本局仍可玩，只是刷新后丢）；
 *   - 读 / 写 / 删 / 列 key，全部永不抛错，失败以返回值表达；
 *   - JSON 读写带**形状校验**，坏数据隔离到 `<key>.__bad` 而不是直接丢弃；
 *   - 诊断日志**按 key 限流**，避免坏档在渲染循环里刷爆控制台。
 *
 * 约定
 * ----
 *   - 这是零构建经典脚本，`Store` 是全局常量，加载顺序必须在 util.js 之后、
 *     所有用到存储的模块之前（见 index.html）。
 *   - **不要在业务代码里直接写 `localStorage.xxx`**，也不要再手写 JSON.parse 兜底。
 *   - 校验器（validate）只判「结构是否可用」，不修数据。要修数据请在调用方做，
 *     并让修完的结果能通过校验 —— 这样坏档与「旧版本档」能被区分开。
 * ======================================================================= */

const Store = (function () {
  /* 内存降级表：localStorage 完全不可用、或写入超配额时作为兜底。
   * 只在「拿不到 localStorage」或「写失败」时使用，正常路径不碰它。 */
  const MEM = new Map();

  /* 已告警过的 tag，用于日志限流。按 key 而非按消息去重，
   * 避免同一个坏档在每帧渲染里反复打印。 */
  const warned = new Set();

  /* 隔离副本的键后缀。故意不含在 Save.exportKeys() 白名单里，
   * 所以导出存档码时不会把坏数据一起带走。 */
  const BAD_SUFFIX = ".__bad";

  /* 本会话内已隔离的键。不依赖 localStorage 的枚举能力 ——
   * 规范上 localStorage 的键可以枚举，但部分实现（包括测试用的 mock）
   * 只提供 getItem / setItem / removeItem，扫不出键列表。 */
  const quarantined = new Set();
  const BAD_MAX = 64 * 1024;   // 隔离副本最多保留 64KB，防止坏档再次撑爆配额

  /* 可用性探测：只判断「setItem 是否抛错」，**不比对读回值**。
   * 因为 Node 回归测试里的 localStorage 是可选空实现（setItem 不落地、
   * getItem 恒返回 null），比对读回值会把它误判成不可用。 */
  let available = false;
  try {
    const probe = "__borderops_probe__";
    localStorage.setItem(probe, "1");
    localStorage.removeItem(probe);
    available = true;
  } catch (e) {
    available = false;
  }

  /* 取 localStorage 引用本身也要 try —— iframe 沙箱里访问该属性会抛 SecurityError。
   * 每次都重新取，不做缓存：测试会在运行时替换 sandbox.localStorage。 */
  function _ls() {
    try {
      if (typeof localStorage === "undefined" || !localStorage) return null;
      return localStorage;
    } catch (e) {
      return null;
    }
  }

  /* 本层自己也保留一份去重表（info() 要汇报），但实际输出复用 util.js 的
   * 全局 warnOnce —— 避免两套限流器各记各的，同一件事打两遍。 */
  function _warnOnce(tag, err) {
    if (warned.has(tag)) return;
    warned.add(tag);
    if (typeof warnOnce === "function") {
      warnOnce("Store:" + tag, err);
      return;
    }
    try {
      const msg = err && err.message ? err.message : err;
      console.warn("[Store] " + tag + (msg ? " — " + msg : ""));
    } catch (e) { /* 控制台被禁用时也不能因此中断游戏 */ }
  }

  function _default(def) {
    /* 支持传函数：默认值是对象时避免多个调用方共享同一个引用 */
    return (typeof def === "function") ? def() : def;
  }

  return {
    /* 探测结果：false 表示存储不可用，所有读写都走内存降级 */
    get available() { return available; },
    BAD_SUFFIX: BAD_SUFFIX,

    /* ------------------------------------------------------------------
     * 原始字符串读写
     * ---------------------------------------------------------------- */

    /** 读字符串。不存在或读取失败时返回 def（不抛错）。 */
    get(key, def) {
      def = (def === undefined) ? "" : def;
      const k = String(key);
      if (available) {
        const ls = _ls();
        if (ls) {
          try {
            const v = ls.getItem(k);
            if (v !== null && v !== undefined) return v;
          } catch (e) { _warnOnce("read:" + k, e); }
        }
      }
      /* 写失败时数据会落到 MEM，这里补一次，保证本局内读得到自己刚写的值 */
      if (MEM.has(k)) return MEM.get(k);
      return _default(def);
    },

    /** 写字符串。返回 true 表示已落到 localStorage；false 表示只进了内存。 */
    set(key, value) {
      const k = String(key);
      const v = String(value);
      if (available) {
        const ls = _ls();
        if (ls) {
          try {
            ls.setItem(k, v);
            return true;
          } catch (e) {
            /* 常见原因：QuotaExceededError（档太大）、Safari 隐私模式。
             * 不抛给调用方，降级到内存并只告警一次。 */
            _warnOnce("write:" + k, e);
          }
        }
      }
      MEM.set(k, v);
      return false;
    },

    /** 删除一个键。返回是否真的删掉了（内存降级时也能删）。 */
    remove(key) {
      const k = String(key);
      MEM.delete(k);
      if (!available) return true;
      const ls = _ls();
      if (!ls) return false;
      try {
        ls.removeItem(k);
        return true;
      } catch (e) {
        _warnOnce("remove:" + k, e);
        return false;
      }
    },

    /** 键是否存在（注意空字符串也算存在）。 */
    has(key) {
      return this.get(key, null) !== null;
    },

    /* ------------------------------------------------------------------
     * JSON 读写（带形状校验与坏数据隔离）
     * ---------------------------------------------------------------- */

    /**
     * 读并解析 JSON。
     * @param {string}   key      存储键
     * @param {*}        def      缺失 / 解析失败 / 形状非法时的返回值（可传函数）
     * @param {Function} validate 可选。收到解析结果，返回 true 表示结构可用。
     *                           在**调用 load 的那一刻**就挡住「是合法 JSON 但不是我们要的结构」，
     *                           例如把 `[]`、`"abc"`、`123` 这类历史脏数据判为坏档。
     */
    getJSON(key, def, validate) {
      const k = String(key);
      const raw = this.get(k, null);
      if (raw === null || raw === undefined) return _default(def);

      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch (e) {
        _warnOnce("parse:" + k, e);
        this._quarantine(k, raw);
        return _default(def);
      }

      if (typeof validate === "function") {
        let good = false;
        try { good = !!validate(parsed); } catch (e) {
          _warnOnce("validate:" + k, e);
          good = false;
        }
        if (!good) {
          _warnOnce("shape:" + k);
          this._quarantine(k, raw);
          return _default(def);
        }
      }
      /* v0.31.1：本项目所有 localStorage 读取都走这一个出口，因此在这里统一
       * 净化是最短路径 —— Save / RaidStash / 拍卖行 / 未来新增的 key 全覆盖。
       * 原地进行（返回同一个对象引用），调用方的 _repair / 迁移逻辑不受影响。 */
      return typeof cleanSaveStrings==="function" ? cleanSaveStrings(parsed) : parsed;
    },

    /** 序列化并写入。循环引用 / 含 undefined 之外不可序列化值时返回 false，不抛错。 */
    setJSON(key, value) {
      const k = String(key);
      let s;
      try {
        s = JSON.stringify(value);
      } catch (e) {
        _warnOnce("stringify:" + k, e);
        return false;
      }
      if (s === undefined) {
        _warnOnce("undefined:" + k);
        return false;
      }
      return this.set(k, s);
    },

    /* ------------------------------------------------------------------
     * 坏数据隔离
     * ---------------------------------------------------------------- */

    /**
     * 把无法解析 / 形状非法的原始串留一份到 `<key>.__bad`。
     * 只在第一次隔离时写入，避免坏档反复覆盖。
     * 这么做是为了「玩家的档出问题时，我们还能拿到原始内容去救」——
     * 直接覆盖或删除等于把现场销毁了。
     */
    _quarantine(key, raw) {
      const k = String(key);
      const bk = k + BAD_SUFFIX;
      try {
        if (this.get(bk, null) !== null) return;
        this.set(bk, String(raw).slice(0, BAD_MAX));
        quarantined.add(bk);
      } catch (e) { /* 隔离失败也不能影响主流程 */ }
    },

    /** 列出所有 .__bad 隔离副本的键（诊断 / 设置页面用）。
     *  合并两个来源：本会话的隔离记录 + localStorage 能枚举到的键。 */
    quarantineKeys() {
      const seen = new Set(quarantined);
      if (available) {
        const ls = _ls();
        if (ls) {
          try {
            if (typeof ls.length === "number" && typeof ls.key === "function") {
              const n = ls.length >>> 0;
              for (let i = 0; i < n; i++) {
                const k = ls.key(i);
                if (k) seen.add(k);
              }
            }
          } catch (e) { _warnOnce("keys", e); }
        }
      }
      const out = [];
      for (const k of seen) {
        if (k.length > BAD_SUFFIX.length && k.slice(-BAD_SUFFIX.length) === BAD_SUFFIX) out.push(k);
      }
      return out;
    },

    /** 清掉全部隔离副本（玩家主动「清除损坏数据」时调用）。 */
    dropQuarantine() {
      for (const k of this.quarantineKeys()) this.remove(k);
      quarantined.clear();
      return true;
    },

    /** 诊断快照：可用性 + 已告警项 + 隔离副本数量。 */
    info() {
      return {
        available: available,
        warned: Array.from(warned),
        quarantined: this.quarantineKeys().length,
        memKeys: MEM.size,
      };
    },

    /* 仅测试用：重置内存降级表与告警去重（Node 回归里隔离用例用） */
    _resetForTest() {
      MEM.clear();
      warned.clear();
      quarantined.clear();
    },
  };
})();
