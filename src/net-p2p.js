/* =========================================================================
 * net-p2p.js — GitHub Pages / 纯静态托管联机（WebRTC P2P）
 *
 * 设计：
 *   · server.js 可用时继续走 HTTP 轮询（net.js 原逻辑），完全不影响官方部署。
 *   · 检测不到 /api/ping（GitHub Pages、纯静态、file://）时自动切到 P2P。
 *   · 房主仍是权威端：本地模拟 AI，通过 PeerJS DataConnection 向客户端广播快照。
 *   · 客户端把自身状态 / 事件发给房主，房主校验并转发给其他客户端。
 *   · 房间码仍是 4 位；PeerJS 侧使用 borderops-v1-<房间码> 作为房间 ID。
 *   · 依赖 vendor/peerjs.min.js（按需动态加载，单机模式不会下载）。
 *
 * 限制：
 *   · 公共 PeerJS 信令 + STUN 只做尽力而为；双方都在严格 NAT / 对称 NAT 后可能连不上。
 *   · 房主离开房间即结束（P2P 不做房主迁移，避免把 AI 权威状态交给不确定的节点）。
 * ========================================================================= */
const NetP2P = {
  mode:null,               // "host" | "client"
  peer:null,
  conn:null,               // client -> host
  host:new Map(),          // host: peerId -> { id, name, secret, state, last, conn }
  selfId:"",
  hostId:"",
  code:"",
  seed:0,
  started:false,
  room:null,
  ring:[],
  seq:0,
  lastSync:0,
  _serverOK:null,
  _libPromise:null,
  _joinResolve:null,
  _joinReject:null,
  _joinTimer:null,

  /* ----------------------------- 基础工具 ----------------------------- */
  _now(){ return Date.now(); },
  _rand(n){
    let s="";
    const A="abcdefghijkmnpqrstuvwxyz23456789";
    for(let i=0;i<n;i++) s+=A[Math.floor(Math.random()*A.length)];
    return s;
  },
  _code(){
    const A="ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let s="";
    for(let i=0;i<4;i++) s+=A[Math.floor(Math.random()*A.length)];
    return s;
  },
  _cleanName(v){
    return String(v==null?"":v).replace(/[\u0000-\u001f\u007f<>&"']/g,"").trim().slice(0,16)||"PMC";
  },
  _peerId(){ return "p"+this._rand(10); },
  _secret(){ return this._rand(24); },
  _seed(){ return Math.floor(Math.random()*0x7fffffff); },

  // 只用一次探测：有 server.js 就继续 HTTP，没有就 P2P。缓存结果避免每次点按钮都打一次。
  async serverAvailable(){
    if(this._serverOK!==null) return this._serverOK;
    try{
      // GitHub Pages / file:// 一定没有 Node 后端，直接走 P2P，避免浏览器控制台刷一条 /api/ping 404。
      const q=(typeof location!=="undefined" && location.search) ? new URLSearchParams(location.search) : null;
      const host=(typeof location!=="undefined" && location.hostname) ? location.hostname : "";
      if((q && q.get("p2p")==="1") || /\.github\.io$/i.test(host) ||
         (typeof location!=="undefined" && location.protocol==="file:")){
        this._serverOK=false;
        return false;
      }
      const ctl=new AbortController();
      const to=setTimeout(()=>ctl.abort(),2500);
      const r=await fetch("/api/ping",{method:"GET",cache:"no-store",signal:ctl.signal});
      clearTimeout(to);
      if(!r.ok){ this._serverOK=false; return false; }
      const j=await r.json();
      this._serverOK=!!(j && j.ok);
    }catch(e){ this._serverOK=false; }
    return this._serverOK;
  },

  loadLib(){
    if(typeof window!=="undefined" && window.Peer) return Promise.resolve(window.Peer);
    if(this._libPromise) return this._libPromise;
    this._libPromise=new Promise((resolve,reject)=>{
      if(typeof document==="undefined") return reject(new Error("没有浏览器环境"));
      const s=document.createElement("script");
      const v=(typeof CFG!=="undefined" && CFG.version) ? CFG.version : "0";
      s.src="vendor/peerjs.min.js?v="+v;
      s.async=true;
      s.onload=()=>{ if(window.Peer) resolve(window.Peer); else reject(new Error("PeerJS 未挂载")); };
      s.onerror=()=>reject(new Error("PeerJS 加载失败（vendor/peerjs.min.js）"));
      document.head.appendChild(s);
    });
    return this._libPromise;
  },

  _peerOpts(){
    return {
      debug:0,
      config:{
        iceServers:[
          { urls:"stun:stun.l.google.com:19302" },
          { urls:"stun:stun1.l.google.com:19302" },
          { urls:"stun:stun.cloudflare.com:3478" },
        ],
      },
    };
  },

  _newPeer(id){
    return new Promise((resolve,reject)=>{
      let p;
      try{ p = id ? new window.Peer(id, this._peerOpts()) : new window.Peer(this._peerOpts()); }
      catch(e){ reject(e); return; }
      let done=false;
      const to=setTimeout(()=>{
        if(done) return; done=true;
        try{ p.destroy(); }catch(e){ /* 对端可能已断开：清理 / 发送失败不影响本端状态 */ }
        reject(new Error("PeerJS 连接超时"));
      }, 12000);
      p.on("open", ()=>{ if(done) return; done=true; clearTimeout(to); resolve(p); });
      p.on("error", err=>{
        if(done) return; done=true; clearTimeout(to);
        try{ p.destroy(); }catch(e){ /* 对端可能已断开：清理 / 发送失败不影响本端状态 */ }
        reject(err);
      });
    });
  },

  _send(conn, obj){
    try{ if(conn && conn.open){ conn.send(obj); return true; } }catch(e){ /* 对端可能已断开：清理 / 发送失败不影响本端状态 */ }
    return false;
  },
  _broadcast(obj){
    for(const p of this.host.values()) this._send(p.conn, obj);
  },

  _publicRoom(){
    return {
      code:this.code, seed:this.seed, hostId:this.hostId, started:this.started,
      peers:[...this.host.values()].map(p=>({
        id:p.id, name:p.name, host:p.id===this.hostId, state:p.state||null,
      })),
    };
  },

  _bindNet(){
    Net.transport="p2p";
    Net.code=this.code;
    Net.peerId=this.selfId;
    Net.secret=Net.secret||this._secret();
    Net.isHost=this.mode==="host";
    Net.seed=this.seed;
    Net.started=this.started;
    Net.room=this.room;
    Net.peers.clear();
    Net.cursor=0;
    Net.fails=0;
    Net.err="";
  },

  _pushEvent(from, type, data){
    this.seq++;
    this.ring.push({ seq:this.seq, from, type, data:data||null });
    while(this.ring.length>600) this.ring.shift();
  },
  _eventsSince(cursor, excludeId){
    return this.ring.filter(e=>e.seq>cursor && e.from!==excludeId).slice(0,80);
  },

  /* ----------------------------- 房主 ----------------------------- */
  async create(name){
    try{
      await this.loadLib();
      this.name=this._cleanName(name);
      let lastErr=null;
      for(let attempt=0;attempt<6;attempt++){
        const code=this._code();
        try{
          const peer=await this._newPeer("borderops-v1-"+code);
          this.peer=peer;
          this.mode="host";
          this.code=code;
          this.selfId=this._peerId();
          this.hostId=this.selfId;
          this.seed=this._seed();
          this.started=false;
          this.room=null;
          this.ring=[]; this.seq=0;
          this.host.clear();
          this.host.set(this.selfId,{ id:this.selfId, name:this.name, secret:this._secret(), state:null, last:this._now(), conn:null });
          this.room=this._publicRoom();
          peer.on("connection", conn=>this._hostAccept(conn));
          peer.on("error", err=>{
            if(err && err.type==="unavailable-id") return;
            if(Net.online) Net._toast("联机连接异常：" + (err && err.type || "network"));
          });
          peer.on("disconnected", ()=>{ try{ peer.reconnect(); }catch(e){ /* 对端可能已断开：清理 / 发送失败不影响本端状态 */ } });
          Net.secret=this.host.get(this.selfId).secret;
          this._bindNet();
          Net.name=this.name;
          return { ok:true, code };
        }catch(e){
          lastErr=e;
          if(e && (e.type==="unavailable-id" || /ID is taken/i.test(String(e.message||"")))) continue;
          throw e;
        }
      }
      throw lastErr || new Error("房间码分配失败");
    }catch(e){
      this._cleanup();
      const m=String(e && (e.type||e.message) || e);
      return { ok:false, msg:"P2P 创建失败：" + (m==="unavailable-id"?"房间码已被占用，请重试":m) };
    }
  },

  _hostAccept(conn){
    let authed=false;
    const guard=setTimeout(()=>{ if(!authed){ try{conn.close();}catch(e){ /* 对端可能已断开：清理 / 发送失败不影响本端状态 */ } } }, 12000);
    conn.on("open", ()=>{ /* 等待 hello */ });
    conn.on("data", msg=>{
      if(msg && msg.t==="hello") authed=true;
      this._hostData(conn,msg);
    });
    const drop=()=>{ clearTimeout(guard); this._hostDrop(conn); };
    conn.on("close", drop);
    conn.on("error", drop);
  },

  _hostData(conn, msg){
    if(!msg || typeof msg!=="object") return;
    switch(msg.t){
      case "hello": this._hostHello(conn,msg); break;
      case "sync":  if(conn._p2pId) this._hostSync(conn,msg); break;
      case "poll":  if(conn._p2pId) this._send(conn,{ t:"room", room:this._publicRoom(), seed:this.seed, started:this.started }); break;
      case "bye":   try{ conn.close(); }catch(e){ /* 对端可能已断开：清理 / 发送失败不影响本端状态 */ } this._hostDrop(conn); break;
    }
  },

  _hostHello(conn, msg){
    if(conn._p2pId) return;
    if(this.started){
      this._send(conn,{t:"error",msg:"这一局已经开始了"});
      setTimeout(()=>{ try{conn.close();}catch(e){ /* 对端可能已断开：清理 / 发送失败不影响本端状态 */ } },50);
      return;
    }
    if(this.host.size>=4){
      this._send(conn,{t:"error",msg:"房间已满（最多 4 人）"});
      setTimeout(()=>{ try{conn.close();}catch(e){ /* 对端可能已断开：清理 / 发送失败不影响本端状态 */ } },50);
      return;
    }
    let id=String(msg.peerId||"");
    if(!/^p[a-z0-9]{6,24}$/.test(id) || this.host.has(id)) id=this._peerId();
    const name=this._cleanName(msg.name);
    const p={ id, name, secret:this._secret(), state:null, last:this._now(), conn };
    this.host.set(id,p);
    conn._p2pId=id;
    conn._cursor=0;
    this._send(conn,{ t:"welcome", code:this.code, peerId:id, secret:p.secret, seed:this.seed, host:false, room:this._publicRoom() });
    this._pushEvent(id,"join",{ id, name });
    this.room=this._publicRoom();
    Net.room=this.room;
    this._broadcast({ t:"room", room:this.room, seed:this.seed, started:this.started });
  },

  _hostDrop(conn){
    const id=conn && conn._p2pId;
    if(!id) return;
    conn._p2pId=null;
    const p=this.host.get(id);
    if(!p) return;
    this.host.delete(id);
    this._pushEvent(id,"leave",{ id, name:p.name });
    this.room=this._publicRoom();
    Net.room=this.room;
    this._broadcast({ t:"room", room:this.room, seed:this.seed, started:this.started });
  },

  _hostSync(conn, msg){
    const p=this.host.get(conn._p2pId);
    if(!p) return;
    p.last=this._now();
    p.state=msg.state || null;
    if(Array.isArray(msg.events)){
      // v0.22.0：白名单与 server.js / src/sanitize.js 共用同一份规则
      const allow=new Set((typeof Sanitize!=="undefined" && Sanitize.CLIENT_EVENT_TYPES)
        || ["hitai","hitpeer","dmg","loot","shot","corpse","extract","dead","chat"]);
      for(const ev of msg.events.slice(0,40)){
        if(!ev || !allow.has(ev.type)) continue;
        let data=ev.data||null;
        // corpse 掉落数组逐项按 schema 裁剪，防止伪造 item 直通 _collect
        if(ev.type==="corpse" && data && typeof Sanitize!=="undefined")
          data=Object.assign({}, data, { d:Sanitize.corpseDrops(data.d) });
        // 先让房主本地结算（命中 AI / PvP 校验），再进入事件环转发给其他客户端。
        /* 单条事件处理失败不能中断整条消息的转发（否则一条畸形事件会拖垮整帧同步），
           但必须留痕：两端状态就是从这里开始分叉的，排查要知道是哪一类事件。
           用 warnOnce 是因为它可能每条消息都触发，不能刷屏。 */
        try{ Net._handle({ from:p.id, type:ev.type, data }); }
        catch(e){ warnOnce("p2p:host.handle."+ev.type, e); }
        this._pushEvent(p.id, ev.type, data);
      }
    }
    this.room=this._publicRoom();
    Net.room=this.room;
    if(Net.raid && typeof Net._applyPeers==="function") Net._applyPeers(this.room.peers);
    const events=this._eventsSince(conn._cursor||0, p.id);
    if(events.length) conn._cursor=events[events.length-1].seq;
    this._send(conn,{
      t:"snap", room:this.room, ai:Net._aiPayload(), seed:this.seed,
      started:this.started, events,
    });
  },

  sync(force){
    const t=(typeof performance!=="undefined" && performance.now) ? performance.now() : Date.now();
    if(this.mode==="client"){
      if(!this.conn || !this.conn.open) return;
      if(!force && t-this.lastSync<Net.syncMs) return;
      this.lastSync=t;
      const state=Net._statePayload();
      const pending=Net._outbox||[];
      Net._outbox=[];
      // v0.21.9：发送失败要把事件放回队列（与 HTTP 路径对齐），否则含 extract/dead 的这一批直接蒸发
      if(!this._send(this.conn,{ t:"sync", state, events:pending, cursor:Net.cursor }))
        Net._requeue ? Net._requeue(pending) : (Net._outbox=(pending.concat(Net._outbox||[])).slice(0,40));
      return;
    }
    if(this.mode!=="host" || !this.peer) return;
    if(!force && t-this.lastSync<Net.syncMs) return;
    this.lastSync=t;

    // 房主自己的状态与事件
    const self=this.host.get(this.selfId);
    if(self && Net.raid && Net.raid.player) self.state=Net._statePayload();
    const pending=Net._outbox||[];
    Net._outbox=[];
    for(const ev of pending) this._pushEvent(this.selfId, ev.type, ev.data||null);

    this.room=this._publicRoom();
    Net.room=this.room;
    if(Net.raid && typeof Net._applyPeers==="function") Net._applyPeers(this.room.peers);
    const ai=Net._aiPayload();
    for(const p of this.host.values()){
      if(!p.conn || !p.conn.open) continue;
      const events=this._eventsSince(p.conn._cursor||0, p.id);
      if(events.length) p.conn._cursor=events[events.length-1].seq;
      this._send(p.conn,{
        t:"snap", room:this.room, ai, seed:this.seed, started:this.started, events,
      });
    }
  },

  async startRoom(){
    if(this.mode!=="host") return { ok:false, msg:"只有房主能开始" };
    this.started=true;
    Net.started=true;
    this.room=this._publicRoom();
    Net.room=this.room;
    this._broadcast({ t:"start", seed:this.seed, at:this._now() });
    this._broadcast({ t:"room", room:this.room, seed:this.seed, started:true });
    return { ok:true, seed:this.seed };
  },

  /* ----------------------------- 客户端 ----------------------------- */
  async join(code, name){
    code=String(code||"").toUpperCase().trim();
    if(!/^[A-Z0-9]{4}$/.test(code)) return { ok:false, msg:"房间码是 4 位字母/数字" };
    try{
      await this.loadLib();
      this.name=this._cleanName(name);
      const peer=await this._newPeer("");
      this.peer=peer;
      this.mode="client";
      this.code=code;
      this.selfId=this._peerId();
      this.hostId="borderops-v1-"+code;
      this.seed=0;
      this.started=false;
      this.room=null;
      this.conn=peer.connect(this.hostId,{ reliable:true, serialization:"json" });

      const welcome=await new Promise((resolve,reject)=>{
        this._joinResolve=resolve;
        this._joinReject=reject;
        this._joinTimer=setTimeout(()=>{ reject(new Error("找不到房间或房主未响应")); }, 12000);
        peer.on("error", err=>{
          if(err && err.type==="peer-unavailable") reject(new Error("房间不存在或已关闭"));
          else if(Net.online) Net._toast("联机连接异常：" + (err && err.type || "network"));
        });
        this.conn.on("open", ()=>{ this._send(this.conn,{ t:"hello", name:this.name, peerId:this.selfId }); });
        this.conn.on("data", msg=>this._clientData(msg));
        this.conn.on("close", ()=>{
          if(!Net.online) return;
          Net._toast("与房主断开连接");
          this.leave(true);
        });
      }).catch(e=>{ throw e; });
      clearTimeout(this._joinTimer);
      this._joinTimer=null;
      this._joinResolve=null;
      this._joinReject=null;
      if(!welcome || !welcome.peerId) throw new Error("房主没有返回房间信息");
      this.selfId=welcome.peerId;
      this.seed=welcome.seed;
      this.started=!!(welcome.room && welcome.room.started);
      this.room=welcome.room;
      this.hostId=(welcome.room && welcome.room.hostId) || this.hostId;
      this._bindNet();
      Net.name=this.name;
      Net.secret=welcome.secret||"";
      Net.room=this.room;
      Net.started=this.started;
      if(this.room && this.room.peers) Net._applyPeers(this.room.peers);
      return { ok:true, code };
    }catch(e){
      this._cleanup();
      return { ok:false, msg:String(e && e.message || e) };
    }
  },

  _clientData(msg){
    if(!msg || typeof msg!=="object") return;
    if(msg.t==="welcome"){
      if(this._joinTimer){ clearTimeout(this._joinTimer); this._joinTimer=null; }
      if(this._joinResolve){ const r=this._joinResolve; this._joinResolve=null; this._joinReject=null; r(msg); }
      return;
    }
    if(msg.t==="error"){
      if(this._joinReject){ const r=this._joinReject; this._joinReject=null; this._joinResolve=null; r(new Error(msg.msg||"加入失败")); }
      else Net._toast(msg.msg||"联机错误");
      return;
    }
    if(msg.t==="closed"){
      Net._toast("房主已解散房间");
      this.leave(true);
      return;
    }
    if(msg.t==="start"){
      this.started=true; Net.started=true;
      if(typeof msg.seed==="number") Net.seed=msg.seed;
      return;
    }
    if(msg.t==="room" || msg.t==="snap"){
      if(msg.room){
        this.room=msg.room;
        Net.room=msg.room;
        Net.started=!!msg.room.started;
        if(typeof msg.seed==="number") Net.seed=msg.seed;
        if(Net.raid && typeof Net._applyPeers==="function") Net._applyPeers(msg.room.peers);
      }
      if(msg.ai && Net.raid && typeof Net._applyAI==="function") Net._applyAI(msg.ai);
      if(Array.isArray(msg.events)){
        for(const ev of msg.events){
          if(!ev || (ev.seq||0)<=Net.cursor) continue;
          /* 客户端逐条重放房主事件：单条失败只跳过这一条，但要留痕 */
          try{ Net._handle(ev); }
          catch(e){ warnOnce("p2p:client.handle."+(ev&&ev.type), e); }
          Net.cursor=Math.max(Net.cursor,ev.seq||0);
        }
      }
      return;
    }
  },

  pollRoom(){
    if(this.mode==="host"){
      this.room=this._publicRoom();
      Net.room=this.room;
      return { ok:true, room:this.room, started:this.started, host:true, seed:this.seed };
    }
    if(this.mode==="client"){
      if(!this.conn || !this.conn.open) return null;
      this._send(this.conn,{t:"poll"});
      return { ok:true, room:this.room, started:this.started, host:false, seed:this.seed };
    }
    return null;
  },

  /* ----------------------------- 退出 / 清理 ----------------------------- */
  _resetLocal(){
    this.peer=null; this.conn=null;
    this.host.clear();
    this.ring=[]; this.seq=0;
    this.room=null;
    this.mode=null;
    this.code=""; this.hostId=""; this.seed=0; this.started=false;
    this.lastSync=0;
  },

  _cleanup(){
    if(this._joinTimer){ clearTimeout(this._joinTimer); this._joinTimer=null; }
    this._joinResolve=null; this._joinReject=null;
    const peer=this.peer, conn=this.conn;
    const conns=[...this.host.values()].map(p=>p.conn).filter(Boolean);
    try{ if(conn) conn.close(); }catch(e){ /* 对端可能已断开：清理 / 发送失败不影响本端状态 */ }
    for(const c of conns){ try{ c.close(); }catch(e){ /* 对端可能已断开：清理 / 发送失败不影响本端状态 */ } }
    try{ if(peer) peer.destroy(); }catch(e){ /* 对端可能已断开：清理 / 发送失败不影响本端状态 */ }
    this._resetLocal();
  },

  async leave(quiet){
    const was=Net.online;
    Net.online=false;
    if(this.mode==="host"){
      // 先广播 closed，再延迟销毁旧 peer；本地引用立刻清空，避免新房间被旧定时器误杀。
      this._broadcast({t:"closed"});
      const peer=this.peer;
      const conns=[...this.host.values()].map(p=>p.conn).filter(Boolean);
      this._resetLocal();
      setTimeout(()=>{
        for(const c of conns){ try{ c.close(); }catch(e){ /* 对端可能已断开：清理 / 发送失败不影响本端状态 */ } }
        try{ if(peer) peer.destroy(); }catch(e){ /* 对端可能已断开：清理 / 发送失败不影响本端状态 */ }
      },150);
    } else {
      if(this.conn && this.conn.open) this._send(this.conn,{t:"bye"});
      this._cleanup();
    }
    Net.online=false; Net.raid=null;
    Net.code=""; Net.peerId=""; Net.secret=""; Net.isHost=false; Net.seed=0;
    Net.room=null; Net.peers.clear(); Net.started=false; Net.cursor=0;
    Net.transport="http";
    if(was && !quiet) Net._toast("已离开联机房间");
  },
};

/* ----------------------------- 挂到 Net ----------------------------- */
// 保存 HTTP 原实现；只有探测到没有 server.js 时才切 P2P。
const _httpCreate = Net.create.bind(Net);
const _httpJoin = Net.join.bind(Net);
const _httpStart = Net.startRoom.bind(Net);
const _httpLeave = Net.leave.bind(Net);
const _httpPoll = Net.pollRoom.bind(Net);

Net.create = async function(name){
  if(await NetP2P.serverAvailable()) return _httpCreate(name);
  return NetP2P.create(name);
};
Net.join = async function(code,name){
  if(await NetP2P.serverAvailable()) return _httpJoin(code,name);
  return NetP2P.join(code,name);
};
Net.startRoom = async function(){
  if(Net.transport==="p2p") return NetP2P.startRoom();
  return _httpStart();
};
Net.leave = async function(quiet){
  if(Net.transport==="p2p") return NetP2P.leave(quiet);
  return _httpLeave(quiet);
};
Net.pollRoom = async function(){
  if(Net.transport==="p2p") return NetP2P.pollRoom();
  return _httpPoll();
};
