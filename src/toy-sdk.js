/* =========================================================================
 * toy-sdk.js — B 站 Toy 宿主能力适配层（v0.37.0）
 *
 * 背景：Toy 的 SDK 文档要登录才能看，但宿主注入的 `toy-host.js` 是公开的，
 * 里面能读出真实能力清单：
 *   bridge 方法：toy.setPlayerState / toy.getPlayerState / toy.onPlayerChange /
 *               toy.getUserProfile / toy.setContainerMode / toy.getContainerState …
 *   模块协议：  { kind:"storage",       op:"get"|"set" }   ← 个人云存储
 *               { kind:"sharedStorage", op:"get"|"set" }   ← 全站共用 KV
 *               { kind:"rank",          op:"submit"|"list"|"my" }
 *   预览页（/toy/preview/…）**只读**：storage/sharedStorage 只允许 get，
 *               rank 只允许 list/my —— 所以所有写操作都必须容忍被拒。
 *
 * 因此这里不硬编码某一个 API 形状，而是**按候选顺序探测**：
 *   ① 若宿主暴露 window.toy 且带 storage.set/get → 用高级 API
 *   ② 退到 window.toy.setPlayerState / getPlayerState（云存档本命）
 *   ③ 退到 window.toyHost / BiliJsBridge 的 {kind,op} 协议
 *   ④ 都没有 → 只用 localStorage（本地存档照常玩）
 * 任何一步抛错/超时都只是「降级」，绝不影响游戏本体。
 * ========================================================================= */
const ToySdk = (function(){
  const T0 = (typeof performance!=="undefined" && performance.now) ? performance.now() : Date.now();
  const META = (typeof window!=="undefined" && window.__TOY_META__) || null;
  const toyId = (META && META.toy_id) || null;
  const inToy = !!toyId;
  const IS_PREVIEW = (typeof location!=="undefined" && /^\/toy\/preview(?:\/|$)/.test(location.pathname||""));
  const SAVE_KEY = "borderops_stash";

  const state = {
    probed:false, write:false, read:false, surface:"none", lastErr:"",
    cloudAt:0, cloudOk:0, cloudFail:0,
  };

  function timeout(p, ms){
    return new Promise((res, rej)=>{
      let done=false;
      const t=setTimeout(()=>{ if(!done){ done=true; rej(new Error("timeout")); } }, ms||2500);
      Promise.resolve(p).then(v=>{ if(!done){ done=true; clearTimeout(t); res(v); } },
        e=>{ if(!done){ done=true; clearTimeout(t); rej(e); } });
    });
  }

  /* 找出一个「能读」和「能写」的云存储通道 —— 只探一次，结果缓存 */
  function probe(){
    if(state.probed) return state;
    state.probed = true;
    if(!inToy){ state.surface="none"; return state; }
    const W = (typeof window!=="undefined") ? window : {};
    if(W.toy && W.toy.storage && typeof W.toy.storage.get==="function"){
      state.surface="toy.storage"; state.read=true;
      state.write = !IS_PREVIEW && typeof W.toy.storage.set==="function";
      return state;
    }
    if(W.toy && typeof W.toy.getPlayerState==="function"){
      state.surface="toy.playerState"; state.read=true;
      state.write = !IS_PREVIEW && typeof W.toy.setPlayerState==="function";
      return state;
    }
    if(W.toyHost || W.BiliJsBridge){
      state.surface = W.toyHost ? "toyHost" : "BiliJsBridge";
      state.read = true; state.write = !IS_PREVIEW;
      return state;
    }
    state.surface="none";
    return state;
  }

  /* 统一调用：把 (type, name, payload) 映射到上面几种形状 */
  async function call(type, name, payload){
    probe();
    const W = (typeof window!=="undefined") ? window : {};
    const args = Object.assign({ key:name }, payload||{});
    // ① 高级 API：window.toy[type][name](key, value)
    if(W.toy && W.toy[type] && typeof W.toy[type][name]==="function"){
      const r = await timeout(W.toy[type][name](name, args.value), 2500);
      return { ok:true, data:r };
    }
    // ② 云存档本命：getPlayerState / setPlayerState
    if(type==="storage" && name==="get" && typeof W.toy.getPlayerState==="function")
      return { ok:true, data: await timeout(W.toy.getPlayerState(), 2500) };
    if(type==="storage" && name==="set" && typeof W.toy.setPlayerState==="function")
      return { ok:true, data: await timeout(W.toy.setPlayerState({ key:name, value:args.value }), 4000) };
    // ③ 宿主桥：{kind, op, …}
    const host = W.toyHost || (W.BiliJsBridge && (W.BiliJsBridge.call || W.BiliJsBridge.invoke));
    const fn = (typeof host==="function") ? host : (host && host.call);
    if(typeof fn==="function"){
      const r = await timeout(fn.call(W.toyHost||W.BiliJsBridge,
        Object.assign({ kind:type, op:name }, args)), 4000);
      return { ok:true, data:r };
    }
    throw new Error("no cloud api");
  }

  /* ------------------------------ 云存档 ------------------------------ */
  let pending=null, timer=0;
  function debounceSave(json){
    if(!inToy) return;
    clearTimeout(timer);
    timer = setTimeout(()=>flush(json), 2200);
  }
  async function flush(json){
    pending = json;
    probe();
    if(!state.read || !state.write) return false;
    try{
      await call("storage","set",{ value:json });
      pending=null; state.cloudAt=Date.now(); state.cloudOk++;
      return true;
    }catch(e){
      state.cloudFail++; state.lastErr=String(e && e.message || e);
      return false;
    }
  }
  async function loadCloud(){
    probe();
    if(!state.read) return null;
    try{
      const r = await call("storage","get");
      const raw = (r && r.data && (r.data.value || r.data.data || r.data)) || null;
      return (typeof raw==="string") ? raw : (raw ? JSON.stringify(raw) : null);
    }catch(e){
      state.lastErr=String(e && e.message || e); return null;
    }
  }

  /* --------------------- 云房间（仅登记与大厅，不做实时同步） ---------------------
   * 为什么不做实时同步：Toy 云 KV 对单个 Toy 限流约 50 QPS，且是所有玩家共用的。
   * 4 人 × 15Hz 快照 + 事件回执 = 60+ QPS，必然被限流；所以云 KV 只用来
   * 「登记房间存在 / 广播开始信号 / 显示在线人数」，真正的逐帧状态仍走 P2P。
   * 一件做不到的事就明说，比做个半残的同步器好。 */
  const room = {
    available(){ probe(); return !!(inToy && state.read && state.write); },
    key(code){ return "room_" + String(code||"").toUpperCase().slice(0,4); },
    async put(code, obj){
      if(!this.available()) return false;
      try{
        await call("sharedStorage","set",{ key:this.key(code), value:JSON.stringify(Object.assign({},obj,{t:Date.now()})) });
        return true;
      }catch(e){ state.lastErr=String(e && e.message || e); return false; }
    },
    async get(code){
      if(!this.available()) return null;
      try{
        const r=await call("sharedStorage","get",{ key:this.key(code) });
        const raw=(r && r.data && (r.data.value || r.data.data || r.data)) || null;
        return raw ? (typeof raw==="string" ? JSON.parse(raw) : raw) : null;
      }catch(e){ state.lastErr=String(e && e.message || e); return null; }
    },
  };

  /* ------------------------------ 排行榜 ------------------------------
   * 从公开的 toy-host.js 读到：{kind:"rank", op:"submit"|"list"|"my"}，
   * 且**预览页只允许 list / my**（submit 会被平台拒绝）。
   * FAQ 里的三条硬约束，这里直接内建：
   *   · 单个 Toy 共 5 个榜位 → 本项目只用 0=卢布、1=GP 币，留 3 个备用；
   *   · 有最大数值限制且跨平台按 Float32 适配 → 上报前 clamp 到 2^24-1（16,777,215），
   *     这是 Float32 能精确表示整数的上限，超过就可能被截断成错的值；
   *   · 接口约 50 QPS → 上报去抖 1.2s，列表 8s 内复用缓存。 */
  const RANK_MAX = 16777215;
  const rank = {
    RUB:0, GP:1,          // 榜位编号（0 起）
    _cache:new Map(),
    available(){ probe(); return !!(inToy && state.read); },
    canSubmit(){ return this.available() && state.write && !IS_PREVIEW; },
    clamp(v){
      const n=Math.floor(Number(v)||0);
      return Math.max(0, Math.min(RANK_MAX, isFinite(n)?n:0));
    },
    async _call(op, payload){
      probe();
      const W=(typeof window!=="undefined")?window:{};
      const body=Object.assign({ board:payload.board, score:payload.score, limit:payload.limit,
                                 offset:payload.offset, value:payload.score }, payload);
      // ① 高级 API：window.toy.rank.submit / list / my
      if(W.toy && W.toy.rank && typeof W.toy.rank[op]==="function")
        return await timeout(W.toy.rank[op](body), 4000);
      // ② 宿主桥：{kind:"rank", op}
      const host=W.toyHost || (W.BiliJsBridge && (W.BiliJsBridge.call || W.BiliJsBridge.invoke));
      const fn=(typeof host==="function")?host:(host && host.call);
      if(typeof fn==="function")
        return await timeout(fn.call(W.toyHost||W.BiliJsBridge, Object.assign({kind:"rank", op:op}, body)), 5000);
      throw new Error("no rank api");
    },
    async submit(board, score){
      if(!this.canSubmit()) return false;
      try{
        await this._call("submit", { board:board, score:this.clamp(score) });
        this._cache.delete(board);
        return true;
      }catch(e){ state.lastErr=String(e && e.message || e); return false; }
    },
    async list(board, limit){
      if(!this.available()) return null;
      const key="l"+board;
      const hit=this._cache.get(key);
      const now=Date.now();
      if(hit && now-hit.t<8000) return hit.v;
      try{
        const r=await this._call("list", { board:board, limit:limit||20, offset:0 });
        const v=normalizeRanks(r);
        this._cache.set(key, { t:now, v:v });
        return v;
      }catch(e){ state.lastErr=String(e && e.message || e); return null; }
    },
    async my(board){
      if(!this.available()) return null;
      try{
        const r=await this._call("my", { board:board });
        const v=normalizeRanks(r);
        return (v && v.length) ? v[0] : null;
      }catch(e){ state.lastErr=String(e && e.message || e); return null; }
    },
  };

  /* 把平台返回的任意形状归一成 [{rank,name,value,self}]。
     不同版本返回 data/list/items/list 都可能，字段名也不统一 —— 与其猜，
     不如把「可能是排行榜的数组」找出来再统一映射；找不到就返回 null。 */
  function normalizeRanks(raw){
    if(!raw) return null;
    let arr=null;
    const dig=(o,depth)=>{
      if(arr || !o || depth>3) return;
      if(Array.isArray(o)){
        if(o.length && o.some(x=>x && (x.score!==undefined || x.value!==undefined))) arr=o;
        return;
      }
      if(typeof o!=="object") return;
      for(const k of ["data","list","items","ranks","result"]){
        if(o[k]!==undefined) dig(o[k], depth+1);
        if(arr) return;
      }
    };
    dig(raw, 0);
    if(!arr) return null;
    return arr.map((x,i)=>({
      rank: Number(x.rank || x.rank_no || x.position || (i+1)),
      name: String(x.nickname || x.name || x.uname || x.nick || ("玩家 "+(i+1))).slice(0, 24),
      value: Number(x.score !== undefined ? x.score : x.value) || 0,
      self: !!(x.is_self || x.self || x.isSelf),
    }));
  }

  return {
    toyId, inToy, isPreview: IS_PREVIEW,
    probe, rank, RANK_MAX,
    status(){ probe(); return Object.assign({}, state, { toyId, inToy, isPreview:IS_PREVIEW }); },
    save(json){ debounceSave(json); return flush(json); },
    flush, loadCloud,
    room,
    /* 给控制台/UI 用的一句话诊断 */
    describe(){
      const s=this.status();
      if(!s.inToy) return "本地存档（不在 B 站 Toy 环境）";
      if(s.surface==="none") return "本地存档（宿主未暴露云 API）";
      if(s.isPreview) return "本地存档（预览页只读，云写入被平台禁用）";
      return "云存档 + 本地缓存（" + s.surface + "）";
    },
  };
})();
