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

  return {
    toyId, inToy, isPreview: IS_PREVIEW,
    probe,
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
