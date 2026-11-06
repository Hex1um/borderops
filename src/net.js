/* =========================================================================
 * net.js — 塔科夫联机（Co-op）客户端
 *   · 与 server.js 的 /api/* 通信，HTTP 轮询 150ms 一次（无需 WebSocket）
 *   · 房主（第一个进房的人）权威模拟 AI，并每 150ms 上传快照
 *   · 其他客户端只渲染 AI 影子，命中通过事件回传给房主结算
 *   · 玩家之间无友伤；物资、撤离、结算各自独立
 * ========================================================================= */
const Net = {
  online:false,
  transport:"http",        // "http" = server.js 轮询；"p2p" = GitHub Pages WebRTC 直连
  code:"",
  peerId:"",
  secret:"",              // 服务端下发的 peer 密钥，只存本地，不再暴露在 room 列表
  isHost:false,
  name:"",
  seed:0,
  started:false,
  room:null,
  peers:new Map(),        // peerId -> {id,name,host,state,op}
  cursor:0,
  lastSync:0,
  inflight:false,
  err:"",
  fails:0,
  raid:null,
  syncMs:150,
  _lastAI:0,
  _hostNotified:false,
  _toast:(m)=>{ if(typeof game!=="undefined" && game.toast) game.toast(m); },

  /* ----------------------------- 房间 ----------------------------- */
  // 平台用 sharecode 做访问控制：同源 fetch 必须带上它，否则会被拦成「链接不完整」
  _sc(){
    try{
      const q=new URLSearchParams(location.search).get("sharecode");
      if(q){ sessionStorage.setItem("raid_sc", q); return q; }
      return sessionStorage.getItem("raid_sc") || "";
    }catch(e){ return ""; }
  },
  _api(path){
    const sc=this._sc();
    return path + (sc ? (path.includes("?")?"&":"?")+"sharecode="+encodeURIComponent(sc) : "");
  },

  async _post(url, body){
    const ctl=new AbortController();
    const to=setTimeout(()=>ctl.abort(), 6000);
    try{
      const r=await fetch(this._api(url), { method:"POST", headers:{"content-type":"application/json"},
        body:JSON.stringify(body||{}), signal:ctl.signal, cache:"no-store" });
      return await r.json();
    }finally{ clearTimeout(to); }
  },

  async create(name){
    this.name=(name||"PMC").slice(0,16);
    try{
      const r=await this._post("/api/create", { name:this.name });
      if(!r.ok) return { ok:false, msg:r.msg||"创建失败" };
      this.code=r.code; this.peerId=r.peerId; this.secret=r.secret||""; this.seed=r.seed; this.isHost=true;
      this.room=r.room; this.started=false; this.cursor=0; this.peers.clear(); this._hostNotified=false;
      this.fails=0; this.err="";
      return { ok:true, code:r.code };
    }catch(e){ return { ok:false, msg:"连不上服务器（检查网络后重试）" }; }
  },

  async join(code, name){
    this.name=(name||"PMC").slice(0,16);
    try{
      const r=await this._post("/api/join", { code:(code||"").toUpperCase(), name:this.name });
      if(!r.ok) return { ok:false, msg:r.msg||"加入失败" };
      this.code=r.code; this.peerId=r.peerId; this.secret=r.secret||""; this.seed=r.seed; this.isHost=!!r.host;
      this.room=r.room; this.started=!!(r.room&&r.room.started); this.cursor=0;
      this.peers.clear(); this.fails=0; this.err=""; this._hostNotified=false;
      return { ok:true, code:r.code };
    }catch(e){ return { ok:false, msg:"连不上服务器（检查网络后重试）" }; }
  },

  async startRoom(){
    if(!this.isHost) return { ok:false, msg:"只有房主能开始" };
    const r=await this._post("/api/start", { code:this.code, peerId:this.peerId, secret:this.secret });
    if(r.ok){ this.started=true; this.seed=r.seed; }
    return r;
  },

  async leave(quiet){
    const wasOnline=this.online;
    this.online=false; this.raid=null;
    if(this.code && this.peerId){
      /* 通知服务端「我走了」：失败不影响本端清理（本地状态下面照样重置），
         最坏结果是房间里留一个待超时的幽灵成员，所以只记一次日志。 */
      try{ await this._post("/api/leave", { code:this.code, peerId:this.peerId, secret:this.secret }); }
      catch(e){ warnOnce("net:leave", e); }
    }
    this.code=""; this.peerId=""; this.secret=""; this.isHost=false; this.seed=0;
    this.room=null; this.peers.clear(); this.started=false; this.cursor=0; this._hostNotified=false;
    if(wasOnline && !quiet) this._toast("已离开联机房间");
  },

  /* ----------------------------- 进图 ----------------------------- */
  attach(raid, opts){
    this.online=true;
    this.raid=raid;
    this.started=true;
    if(opts && opts.seed) this.seed=opts.seed;
    this.peers.clear();
    this._lastAI=0;
    this.lastSync=0;
    this._hostNotified=false;
    raid.netTeammates=[];       // remote op 列表（引用 peers 里的 op）
    // 先拉一次，尽快拿到队友与 AI
    this.sync(true);
  },

  /* ----------------------------- 同步 ----------------------------- */
  // 玩家状态快照（HTTP 轮询与 P2P 直连共用）
  _statePayload(){
    const R=this.raid, p=R && R.player;
    if(!p) return null;
    return {
      name:this.name,
      x:Math.round(p.x), y:Math.round(p.y),
      a:+(p.angle||0).toFixed(2),
      hp:Math.round(p.hp), mhp:Math.round(p.maxHP||100),
      alive:!!p.alive,
      gun:p.gun?{ t:p.gun.type||"", e:p.gun.element||"none", n:p.gun.name||"" }:null,
      maxArmor:Math.round(p.maxArmor||0), armor:Math.round(p.armor||0),
      kills:R.kills||0,
      at:Math.round(p.armorTier||0),   // v0.14.10：护甲类型同步
      ext:!!R._extractedFlag,
    };
  },
  // 房主 AI 快照（每 150ms 全量，压缩字段名）
  _aiPayload(){
    const R=this.raid;
    if(!this.isHost || !R || !R.ops) return null;
    const arr=[];
    for(const o of R.ops){
      if(o.isPlayer || o.remote) continue;
      arr.push({ i:o.id, n:o.name, x:Math.round(o.x), y:Math.round(o.y),
        a:+(o.angle||0).toFixed(2), hp:Math.round(o.hp), mhp:Math.round(o.maxHP||100),
        al:o.alive?1:0, c:o.cls, s:o.smart?1:0, b:o.bounty?1:0,
        g:o.gun?o.gun.type:"", e:o.gun?(o.gun.element||"none"):"none",
        ar:Math.round(o.armor||0), mar:Math.round(o.maxArmor||0),
        t:Math.round(o.armorTier||0),   // v0.14.10：AI 护甲类型同步
        f:+(o.freezeT||0).toFixed(1),  // v0.14.10：冰冻状态同步（非房主只渲染，不自行递减）
        // v0.14.11：元素持续状态 / 护盾值同步，客户端只渲染不自行结算
        bu:+(o.burnT||0).toFixed(1), co:+(o.corrodeT||0).toFixed(1),
        zk:+(o.shockT||0).toFixed(1), rd:+(o.radT||0).toFixed(1),
        sd:Math.round(o.shield||0), sm:Math.round(o.maxShield||0),
        iv:+(o.shieldInvuln||0).toFixed(2),
        st:o.state||"" });
    }
    return arr;
  },
  async sync(force){
    // GitHub Pages 等静态托管：server.js 不存在，切到 WebRTC P2P 直连。
    if(this.transport==="p2p" && typeof NetP2P!=="undefined") return NetP2P.sync(force);
    if(!this.online || !this.raid) return;
    if(this.inflight) return;
    const t=performance.now();
    if(!force && t-this.lastSync < this.syncMs) return;
    this.lastSync=t; this.inflight=true;

    const R=this.raid;
    const state=this._statePayload();
    const pending=this._outbox||[];
    const body={ code:this.code, peerId:this.peerId, secret:this.secret, name:this.name, state,
      cursor:this.cursor, events:pending };
    this._outbox=[];

    const ai=this._aiPayload();
    if(ai) body.ai=ai;

    let r=null;
    try{ r=await this._post("/api/sync", body); }
    catch(e){
      this.inflight=false; this.fails++;
      // 请求失败才把这一批事件放回队列；成功后再丢弃，避免网络抖动导致 extract/dead 丢失。
      this._requeue(pending);
      if(this.fails===3) this._toast("联机同步中断，正在重试…");
      return;
    }
    this.inflight=false;
    if(!r || !r.ok){
      this._requeue(pending);
      this.fails++;
      if(r && r.auth===false){ this.online=false; this._toast("联机身份已失效，请重新加入房间"); return; }
      if(this.fails>10){ this._toast("房间已断开"); this.online=false; }
      return;
    }
    this.fails=0;
    // v0.21.9：删除恒假的 seed 同步（!this.raid 在此恒为 false，整行是死代码）
    this.room=r.room;
    this.cursor=r.cursor||this.cursor;

    // 每次以服务端返回的 host 为准；房主转移时接管 ghost AI。
    const wasHost=this.isHost;
    if(typeof r.host==="boolean") this.isHost=r.host;
    if(this.isHost && !wasHost) this._becomeHost();
    else if(!this.isHost) this._hostNotified=false;

    this._applyPeers(r.room ? r.room.peers : []);
    if(!this.isHost && Array.isArray(r.ai)) this._applyAI(r.ai);
    if(Array.isArray(r.events)) for(const ev of r.events) this._handle(ev);
  },

  // 房主掉线后，服务端会把 host 转给下一个 peer。这里把只读 ghost 提升为可模拟 AI，
  // 避免“新主机 isHost=true 但全图 AI 永久冻结”。
  _becomeHost(){
    const R=this.raid;
    if(!R || typeof R.promoteGhostsForHost!=="function") return;
    if(this._hostNotified) return;
    try{
      const n=R.promoteGhostsForHost();
      if(n>0){ this._hostNotified=true; this._toast("房主已离开 · 你已接管 AI 模拟"); }
    }catch(e){ console.warn("promote ghosts failed", e); }
  },

  /* 房间页轻量轮询：只取房间信息，不进图 */
  async pollRoom(){
    if(!this.code || !this.peerId) return null;
    try{
      const r=await this._post("/api/sync", {
        code:this.code, peerId:this.peerId, secret:this.secret, name:this.name,
        state:null, events:[], cursor:this.cursor,
      });
      if(!r || !r.ok) return null;
      this.room=r.room; this.cursor=r.cursor||this.cursor;
      this.started=!!r.started; this.isHost=!!r.host;
      if(typeof r.seed==="number") this.seed=r.seed;
      return r;
    }catch(e){ return null; }
  },

  tick(dt){
    if(!this.online || !this.raid) return;
    // 远端玩家位置插值
    const k=Math.min(1, dt*12);
    for(const pr of this.peers.values()){
      const op=pr.op;
      if(!op) continue;
      op.x += (op.tx-op.x)*k;
      op.y += (op.ty-op.y)*k;
      op.angle = M.lerpAngle(op.angle, op.ta, k*1.4);
    }
    this.sync(false);
  },

  /* ----------------------------- 队友 ----------------------------- */
  _applyPeers(list){
    if(!this.raid || !Array.isArray(list)) return;
    const seen=new Set();
    for(const p of list){
      if(!p || p.id===this.peerId){ if(p) seen.add(p.id); continue; }
      seen.add(p.id);
      let pr=this.peers.get(p.id);
      if(!pr){
        const op=this._makeRemoteOp(p);
        pr={ id:p.id, name:p.name, host:!!p.host, op, state:null };
        this.peers.set(p.id, pr);
        this.raid.ops.push(op);
      }
      pr.name=p.name; pr.host=!!p.host;
      const s=p.state;
      if(s && pr.op){
        pr.op.tx=s.x; pr.op.ty=s.y; pr.op.ta=s.a;
        if(!pr.init){ pr.op.x=s.x; pr.op.y=s.y; pr.op.angle=s.a; pr.init=true; }
        pr.op.hp=s.hp; pr.op.maxHP=s.mhp||100;
        pr.op.alive=!!s.alive;
        pr.op.maxArmor=s.maxArmor||0; pr.op.armor=s.armor||0;
        pr.op.armorTier=s.at||0;
        pr.op.kills=s.kills||0;
        pr.op.ext=!!s.ext;   // v0.21.9：接收端原先漏读 ext，队友撤离状态同步是死链路
        pr.op.gun=s.gun?{ type:s.gun.t, element:s.gun.e, name:s.gun.n, parts:[] }:null;
        pr.op.name=p.name;
      }
    }
    // 掉线的人：把 op 从 ops 移除
    for(const [id,pr] of [...this.peers]){
      if(seen.has(id)) continue;
      const i=this.raid.ops.indexOf(pr.op);
      if(i>=0) this.raid.ops.splice(i,1);
      this.peers.delete(id);
    }
  },

  _makeRemoteOp(p){
    const colors=["#4fd6ff","#7ee08a","#ffd23f","#c08aff"];
    const c=colors[(p.name||"").length % colors.length];
    return {
      id:"net_"+p.id, peerId:p.id, name:p.name, isPlayer:false, remote:true, teammate:true,
      cls:"pmc", x:0, y:0, tx:0, ty:0, angle:0, ta:0, init:false,
      hp:100, maxHP:100, alive:true, armor:0, maxArmor:0, armorTier:0,
      dr:0, helmetArmor:0, helmetDr:0, speed:0, r:14,
      color:c, gun:null, inv:{weapons:[],armors:[],parts:[],materials:[],cores:[],meds:[]},
      kills:0, fireCd:0, reloadT:0, state:"", bandages:0, medT:0,
      isNet:true,
    };
  },

  /* ----------------------------- AI 影子 ----------------------------- */
  _applyAI(arr){
    const R=this.raid;
    if(!R) return;
    const have=new Map();
    for(const o of R.ops){ if(!o.isPlayer && !o.remote) have.set(o.id,o); }
    for(const b of arr){
      let op=have.get(b.i);
      if(!op){
        op={
          id:b.i, name:b.n||"PMC", cls:b.c||"pmc", smart:!!b.s, bounty:!!b.b,
          isPlayer:false, ghost:true, x:b.x, y:b.y, tx:b.x, ty:b.y,
          angle:b.a||0, ta:b.a||0, hp:b.hp, maxHP:b.mhp||100, alive:!!b.al,
          armor:b.ar||0, maxArmor:b.mar||0,           armorTier:b.t||0,
          freezeT:b.f||0,
          burnT:b.bu||0, corrodeT:b.co||0, shockT:b.zk||0, radT:b.rd||0,
          shield:b.sd||0, maxShield:b.sm||b.sd||0,
          shieldInvuln:b.iv||0, shieldRate:0, shieldDelay:0,
          shieldPerks:[], shieldAbsorbMul:1, shieldInvulnBase:0, shieldTimer:0,
          dr:0, helmetArmor:0, helmetDr:0,
          speed:0, r:b.b?16:13.5, color:b.b?"#ff5c5c":(b.c==="scav"?"#d08a4a":"#e06a4a"),
          gun:b.g?{ type:b.g, element:b.e||"none", parts:[] }:null,
          inv:{weapons:[],armors:[],parts:[],materials:[],cores:[],meds:[]},
          state:b.st||"", fireCd:0, reloadT:0, bandages:0, medT:0, kills:0,
          isGhost:true,
        };
        R.ops.push(op);
      }
      op.tx=b.x; op.ty=b.y; op.ta=b.a||0;
      if(op._noInit){ op.x=b.x; op.y=b.y; op.angle=b.a||0; op._noInit=false; }
      op.hp=b.hp; op.maxHP=b.mhp||100; op.alive=!!b.al;
      op.armor=b.ar||0; op.maxArmor=b.mar||0;
      op.armorTier=b.t||0;
      op.freezeT=b.f||0;   // 以房主快照为准，避免非房主侧重复递减
      op.burnT=b.bu||0; op.corrodeT=b.co||0; op.shockT=b.zk||0; op.radT=b.rd||0;
      op.shield=b.sd||0; op.maxShield=Math.max(op.maxShield||0,b.sm||0,op.shield);
      op.shieldInvuln=b.iv||0;
      op.name=b.n||op.name;
      op.state=b.st||op.state;
      op.gun=b.g?{ type:b.g, element:b.e||"none", parts:[] }:null;
      op.smart=!!b.s; op.bounty=!!b.b;
    }
    // 快照里没有的（房主端删了/死了清场）→ 移除
    const ids=new Set(arr.map(b=>b.i));
    for(const [id,op] of have){ if(!ids.has(id)){ const i=R.ops.indexOf(op); if(i>=0) R.ops.splice(i,1); } }
    // 影子插值
    const k=0.28;
    for(const op of R.ops){
      if(!op.ghost) continue;
      op.x += (op.tx-op.x)*k; op.y += (op.ty-op.y)*k;
      op.angle = M.lerpAngle(op.angle, op.ta, k);
    }
  },

  /* ----------------------------- 事件 ----------------------------- */
  // v0.21.9：终局事件（extract/dead/corpse）一律保底入队；超限时从最旧的普通事件开始丢，不丢终局事件
  _isTerm(type){ return type==="extract"||type==="dead"||type==="corpse"; },
  _requeue(pending){
    const all=(pending||[]).concat(this._outbox||[]);
    if(all.length<=40){ this._outbox=all; return; }
    const kept=[]; let toDrop=all.length-40;
    for(const e of all){
      if(!this._isTerm(e.type) && toDrop>0){ toDrop--; continue; }
      kept.push(e);
    }
    this._outbox=kept;
  },
  sendEvent(type, data){
    if(!this.online) return;
    this._outbox=this._outbox||[];
    const term=this._isTerm(type);
    if(this._outbox.length<40) this._outbox.push({ type, data:data||null });
    else if(term){
      // 队满也不能丢终局事件：丢掉最旧的普通事件腾位
      const i=this._outbox.findIndex(e=>!this._isTerm(e.type));
      if(i>=0) this._outbox.splice(i,1);
      this._outbox.push({ type, data:data||null });
    }
    // 撤离 / 阵亡这类「终局事件」之后不再有 tick，必须立刻冲一次
    if(term){
      if(this._flushT) clearTimeout(this._flushT);
      this._flushT=setTimeout(()=>{ this._flushT=null; this.sync(true); }, 30);
    }
  },
  sendHitAI(id, dmg, gunName){
    this.sendEvent("hitai", { id, dmg:Math.round(dmg), g:gunName||"", by:this.name });
  },
  // 客户端不能直接给另一个客户端扣血：先发给房主，由房主校验距离/LOS 后再发 dmg。
  sendHitPeer(toPeerId, dmg, gunName){
    this.sendEvent("hitpeer", { to:toPeerId, dmg:Math.round(dmg), g:gunName||"" });
  },
  sendDamage(toPeerId, dmg, by){
    if(!this.online) return;
    if(!this.isHost) return this.sendHitPeer(toPeerId, dmg, by);
    this.sendEvent("dmg", { to:toPeerId, dmg:Math.round(dmg), by:by||this.name });
  },
  maybeSendShot(sh, angle){
    if(!this.online || !this.isHost || !sh) return;
    const t=performance.now();
    if(sh._netShotAt && t-sh._netShotAt < 130) return;
    sh._netShotAt=t;
    this.sendEvent("shot", {
      id:sh.id, x:Math.round(sh.x), y:Math.round(sh.y),
      a:+(angle||0).toFixed(3), g:sh.gun?sh.gun.type:"",
      e:sh.gun?(sh.gun.element||"none"):"none",
    });
  },
  sendCorpse(x, y, name, drops){
    if(!this.isHost) return;
    this.sendEvent("corpse", { x:Math.round(x), y:Math.round(y), n:name||"PMC", d:drops||[] });
  },
  sendLoot(index, name){
    this.sendEvent("loot", { i:index, by:this.name, n:name||"" });
  },
  sendExtract(zone){
    this.sendEvent("extract", { by:this.name, z:zone||"" });
  },
  sendDead(by){
    this.sendEvent("dead", { by:this.name, k:by||"" });
  },
  sendChat(text){
    this.sendEvent("chat", { by:this.name, t:String(text||"").slice(0,80) });
  },

  _handle(ev){
    const R=this.raid; if(!R) return;
    const d=ev.data||{};
    switch(ev.type){
      case "join":
        this._toast(`${d.name||"玩家"} 加入了房间`);
        break;
      case "leave":
        this._toast(`${d.name||"玩家"} 离开了房间`);
        break;
      case "host":
        {
          const was=this.isHost;
          this.isHost=(d.id===this.peerId);
          if(this.isHost && !was) this._becomeHost();
          else if(!this.isHost) this._hostNotified=false;
        }
        break;
      case "loot": {
        const c=R.containers[d.i];
        if(c && !c.searched){ c.searched=true; c.drop=null; c.drops=null; c.cash=0; }
        break;
      }
      case "hitai": {
        if(!this.isHost) break;
        const bot=R.ops.find(o=>o.id===d.id && !o.ghost);
        if(!bot || !bot.alive) break;
        const dmg=M.clamp(Math.round(Number(d.dmg)||1),1,2000);
        R._damage(bot, dmg, { isPlayer:true, netKiller:true, name:d.by||"队友", kills:R.kills||0, gun:null }, null);
        break;
      }
      case "hitpeer": {
        // 只有房主处理玩家 PvP 命中；校验距离 + 视线，再转发权威 dmg。
        if(!this.isHost) break;
        const R2=this.raid; if(!R2 || !R2.player) break;
        const shooter = ev.from===this.peerId ? R2.player : R2.ops.find(o=>o.remote && o.peerId===ev.from);
        const target  = d.to===this.peerId ? R2.player : R2.ops.find(o=>o.remote && o.peerId===d.to);
        if(!shooter || !target || shooter===target || !target.alive) break;
        if(M.dist(shooter.x,shooter.y,target.x,target.y) > 1400) break;
        if(!R2._los(shooter.x,shooter.y,target.x,target.y)) break;
        const dmg=M.clamp(Math.round(Number(d.dmg)||1),1,500);
        if(d.to===this.peerId) R2._damage(target, dmg, shooter, shooter.gun||null);
        else this.sendDamage(d.to, dmg, shooter.name||"队友");
        break;
      }
      case "dmg": {
        if(d.to!==this.peerId) break;
        // 只接受房主结算的伤害；普通客户端不能直接指定别人的血量。
        if(this.room && this.room.hostId && ev.from!==this.room.hostId) break;
        const p=R.player;
        if(p && p.alive){
          R._damage(p, M.clamp(Math.round(Number(d.dmg)||1),1,500), null, null);
          R._float(p.x,p.y-40, `-${d.dmg}（${d.by||"敌人"}）`, "#ff6a6a");
        }
        break;
      }
      case "dead": {
        R._feed(d.by||"队友", "阵亡", "交火", false, "kill");
        break;
      }
      case "extract": {
        R._feed(d.by||"队友", "撤离成功", d.z||"撤离点", false, "kill");
        break;
      }
      case "shot": {
        if(this.room && this.room.hostId && ev.from!==this.room.hostId) break;
        const R2=this.raid; if(!R2) break;
        const op=R2.ops.find(o=>o.id===d.id);
        const col=(d.e&&d.e!=="none"&&ELEMENTS[d.e])?ELEMENTS[d.e].color:"#ff9a5a";
        const len=d.g==="sniper"?430:(d.g==="shotgun"?190:300);
        R2.tracers.push({ x1:d.x, y1:d.y,
          x2:d.x+Math.cos(d.a||0)*len, y2:d.y+Math.sin(d.a||0)*len,
          bx:d.x, by:d.y, life:0.08, maxLife:0.08, laser:false, shape:"round", color:col });
        break;
      }
      case "corpse": {
        if(this.room && this.room.hostId && ev.from!==this.room.hostId) break;
        if(!Array.isArray(d.d)) break;
        /* v0.22.0：联机尸体掉落逐项按 schema 裁剪（HTTP 轮询 / WebRTC P2P 两条链路共用）。
         * 之前 d.d.slice(0,6) 会让任意对象直通 _collect，可伪造超高 dmg / 原型污染键。 */
        const S=(typeof Sanitize!=="undefined")?Sanitize:null;
        const drops=S?S.corpseDrops(d.d):d.d.slice(0,6);
        const nx=S?S.num(d.x,0,20000):d.x, ny=S?S.num(d.y,0,20000):d.y;
        R.containers.push({ x:nx==null?d.x:nx, y:ny==null?d.y:ny, tier:2, searched:false, body:true,
          drops, cash:0, botName:(S?S.text(d.n,24):null)||"PMC" });
        break;
      }
      case "chat": {
        /* 无线电文本同样走净化，避免网络字符串日后被插入 DOM 触发 XSS */
        const S=(typeof Sanitize!=="undefined")?Sanitize:null;
        R._feed(S?(S.text(d.by,24)||"队友"):(d.by||"队友"),
                S?S.text(d.t,80):(d.t||""), "无线电", false, "chat");
        break;
      }
      case "start": break;
    }
  },
};
