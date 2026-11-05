#!/usr/bin/env node
'use strict';
/* =========================================================================
 * server.js — 边境行动 · 联机房服务器
 *   · 同一个端口既托管静态站点，也提供 /api/* 房间接口
 *   · 不依赖任何 npm 包（原生 http / crypto / zlib），发布时无需 install
 *   · 同步模型：HTTP 轮询。房主上传 AI 快照，服务端只做中继；
 *     但 peer 身份、事件类型、数值范围与静态资源都由服务端先校验。
 *
 * v0.14.8 安全热修：
 *   - 每个 peer 一个独立 secret，peerId 公开但无法被冒充
 *   - /api/* 只允许 POST（ping 例外），带速率限制与房间上限
 *   - 客户端事件白名单 + 数值裁剪；corpse/shot/dmg 只能由房主发出
 *   - 静态资源白名单，不再暴露 server.js / *.py / package.json
 *   - gzip / brotli、ETag、404、URI 异常处理与基础安全响应头
 * ========================================================================= */

const http = require('http');
const fs   = require('fs');
const path = require('path');
const os   = require('os');
const zlib = require('zlib');
const crypto = require('crypto');

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';

const MIME = {
  '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8', '.json':'application/json; charset=utf-8',
  '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.svg':'image/svg+xml',
  '.ico':'image/x-icon', '.woff2':'font/woff2', '.woff':'font/woff', '.mp3':'audio/mpeg',
  '.webp':'image/webp', '.txt':'text/plain; charset=utf-8',
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options':'nosniff',
  'Referrer-Policy':'no-referrer',
  // 不设置 X-Frame-Options / frame-ancestors：官方部署可能被 WorkBuddy 平台以 iframe 嵌入。
  'Permissions-Policy':'geolocation=(), microphone=(), camera=()',
  'Content-Security-Policy':[
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "media-src 'self' data:",
    // GitHub Pages / 纯静态托管时联机会切到 WebRTC P2P；server.js 同源部署仍走 /api/*。
    "connect-src 'self' wss://0.peerjs.com https://0.peerjs.com",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; '),
};

// 同源部署时留空；如需跨域，用 CORS_ORIGIN=https://example.com 显式放行。
const CORS_ORIGIN = String(process.env.CORS_ORIGIN || '').trim();

/* ----------------------------- 房间 ----------------------------- */
const ROOMS = new Map();          // code -> room
const PEER_TIMEOUT = 20000;       // 20s 没 sync 视为掉线
const ROOM_TTL     = 5*60*1000;   // 空房 5 分钟后回收
const EVENT_KEEP   = 600;         // 每个房间保留的事件条数
const MAX_PEERS    = 4;
const MAX_ROOMS    = Math.max(1, Number(process.env.MAX_ROOMS || 300));
const MAX_BODY     = 256 * 1024;
const MAX_AI       = 80;
const MAX_EVENT_DATA = 32 * 1024;

const RL = new Map();             // 简单内存速率限制：key -> {n, reset}
const COMPRESS_CACHE = new Map(); // 静态压缩缓存：file|mtime|size|enc -> Buffer

function now(){ return Date.now(); }

// v0.21.9：X-Forwarded-For 直连时完全由客户端控制，无条件信任会让限速键可被任意伪造绕过。
// 只有明确部署在反向代理后面（TRUST_PROXY=1）才采信 XFF。
const TRUST_PROXY = process.env.TRUST_PROXY === '1';

function clientIp(req){
  const xff = TRUST_PROXY && req.headers && req.headers['x-forwarded-for'];
  if(xff) return String(xff).split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

function rate(key, limit, windowMs){
  const t = now();
  let b = RL.get(key);
  if(!b || t >= b.reset){ b = { n:0, reset:t+windowMs }; RL.set(key, b); }
  b.n++;
  return b.n <= limit;
}

function newCode(){
  const ALPH = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for(let attempt=0; attempt<500; attempt++){
    let c='';
    for(let i=0;i<4;i++) c += ALPH[crypto.randomInt(ALPH.length)];
    if(!ROOMS.has(c)) return c;
  }
  return 'R'+crypto.randomInt(1000,9999);
}

function newId(){ return 'p'+crypto.randomBytes(5).toString('hex'); }
function newSecret(){ return crypto.randomBytes(24).toString('hex'); }

function cleanName(v){
  return String(v==null?'':v)
    .replace(/[\u0000-\u001f\u007f<>&"']/g,'')
    .trim()
    .slice(0,16) || '玩家';
}

function makePeer(name){
  return { id:newId(), name:cleanName(name), secret:newSecret(), state:null, last:now() };
}

function makeRoom(code, seed){
  return {
    code, seed: seed || crypto.randomInt(0, 0x7fffffff),
    hostId:null, started:false, startAt:0,
    peers:new Map(),          // peerId -> {id,name,secret,state,last}
    gone:new Map(),           // 掉线 peer 的短期重连凭证（不暴露给客户端）
    ai:[],                    // 房主上传的（已裁剪）AI 快照
    events:[], seq:0, eventBytes:0,   // 事件环形列表（附带字节上限）
    created:now(), touched:now(),
  };
}

function roomPublic(r){
  return {
    code:r.code, seed:r.seed, hostId:r.hostId, started:r.started,
    peers:[...r.peers.values()].map(p=>({
      id:p.id, name:p.name, host:p.id===r.hostId,
      state:p.state || null,
    })),
  };
}

const MAX_ROOM_EVENT_BYTES = 1024 * 1024;   // 单房间事件内存上限；防止大快照/刷事件把进程撑爆

function pushEvent(r, from, type, data){
  r.seq++;
  const ev={ seq:r.seq, from, type, data:data||null, t:now(), bytes:0 };
  ev.bytes=JSON.stringify(ev).length;
  r.events.push(ev);
  r.eventBytes=(r.eventBytes||0)+ev.bytes;
  while(r.events.length>EVENT_KEEP || (r.eventBytes>MAX_ROOM_EVENT_BYTES && r.events.length>1)){
    const old=r.events.shift();
    r.eventBytes-=old.bytes||0;
  }
}

function authPeer(room, body){
  if(!room) return null;
  const pid = String(body.peerId || '');
  const secret = String(body.secret || '');
  const peer = room.peers.get(pid);
  if(!peer || !secret || peer.secret !== secret) return null;
  return peer;
}

function gc(){
  const t=now();
  for(const [code,r] of ROOMS){
    for(const [id,p] of r.peers){
      if(t-p.last>PEER_TIMEOUT){
        r.peers.delete(id);
        // 保留 60 秒重连凭证：必须同时出示同一个 secret 才能恢复，不能像旧版那样凭空加人。
        r.gone.set(id, { name:p.name, secret:p.secret, expires:t+60000 });
        if(r.gone.size>16){ const first=r.gone.keys().next().value; r.gone.delete(first); }
        pushEvent(r, id, 'leave', { id, name:p.name });
        if(r.hostId===id){
          const rest=[...r.peers.keys()];
          r.hostId=rest[0]||null;
          if(r.hostId) pushEvent(r, id, 'host', { id:r.hostId });
        }
      }
    }
    for(const [id,g] of r.gone){ if(t>g.expires) r.gone.delete(id); }
    if(!r.peers.size && !r.gone.size && t-r.touched>ROOM_TTL) ROOMS.delete(code);
  }
}
setInterval(gc, 5000).unref?.();
setInterval(()=>{
  const t=now();
  for(const [k,b] of RL){ if(t>b.reset+60000) RL.delete(k); }
  if(COMPRESS_CACHE.size>120) COMPRESS_CACHE.clear();
}, 60000).unref?.();

/* ----------------------------- 数据裁剪 ----------------------------- */
function text(v, max){
  return String(v==null?'':v)
    .replace(/[\u0000-\u001f\u007f]/g,' ')
    .slice(0, max);
}
function num(v, min, max){
  const n=Number(v);
  if(!Number.isFinite(n)) return null;
  return Math.max(min, Math.min(max, n));
}

function sanitizeState(s){
  if(!s || typeof s!=='object' || Array.isArray(s)) return null;
  return {
    name:text(s.name,16),
    x:num(s.x,0,20000)||0, y:num(s.y,0,20000)||0,
    a:num(s.a,-7,7)||0,
    hp:num(s.hp,0,100000)||0, mhp:num(s.mhp,1,100000)||100,
    alive:!!s.alive,
    gun:(s.gun && typeof s.gun==='object') ? {
      t:text(s.gun.t,32), e:text(s.gun.e,16), n:text(s.gun.n,40),
    } : null,
    maxArmor:num(s.maxArmor,0,100000)||0,
    armor:num(s.armor,0,100000)||0,
    kills:num(s.kills,0,100000)||0,
    // v0.14.10：护甲等级决定目标类型（T4+ 装甲型 / 黄色血条），同步给其他客户端
    at:num(s.at,0,9)||0,
    ext:!!s.ext,
  };
}

function sanitizeAI(o){
  if(!o || typeof o!=='object' || Array.isArray(o)) return null;
  const i=text(o.i,40);
  if(!i) return null;
  return {
    i, n:text(o.n,24),
    x:num(o.x,0,20000)||0, y:num(o.y,0,20000)||0, a:num(o.a,-7,7)||0,
    hp:num(o.hp,0,100000)||0, mhp:num(o.mhp,1,100000)||100, al:o.al?1:0,
    c:text(o.c,12), s:o.s?1:0, b:o.b?1:0,
    g:text(o.g,32), e:text(o.e,16),
    ar:num(o.ar,0,100000)||0, mar:num(o.mar,0,100000)||0,
    t:num(o.t,0,9)||0,      // v0.14.10：AI 护甲等级
    f:num(o.f,0,3)||0,      // v0.14.10：AI 冰冻剩余时间
    bu:num(o.bu,0,5)||0, co:num(o.co,0,4)||0,   // v0.14.11：灼烧 / 破甲
    zk:num(o.zk,0,2)||0, rd:num(o.rd,0,1)||0,   // v0.14.11：电磁干扰 / 辐射标记
    sd:num(o.sd,0,100000)||0,                   // v0.14.11：护盾剩余
    sm:num(o.sm,0,100000)||0,                   // v0.16.0：护盾容量上限
    iv:num(o.iv,0,3)||0,                        // v0.16.0：破盾无敌剩余
    st:text(o.st,16),
  };
}

// 允许客户端发出的类型；join/leave/host/start 是服务端保留事件，客户端一律不能伪造。
const CLIENT_EVENT_TYPES = new Set(['hitai','hitpeer','dmg','loot','shot','corpse','extract','dead','chat']);

function sanitizeEvent(room, peer, ev){
  if(!ev || typeof ev!=='object') return null;
  const type=String(ev.type||'');
  if(!CLIENT_EVENT_TYPES.has(type)) return null;
  const d=(ev.data && typeof ev.data==='object' && !Array.isArray(ev.data)) ? ev.data : {};
  const isHost=peer.id===room.hostId;
  let data=null;

  switch(type){
    case 'hitai': {
      // 客户端命中房主模拟的 AI：只做数值裁剪，并尽量校验 AI id 存在。
      const id=text(d.id,40);
      if(!id) return null;
      if(room.ai.length && !room.ai.some(o=>o && String(o.i)===id)) return null;
      data={ id, dmg:num(d.dmg,1,2000)||1, g:text(d.g,40), by:peer.name };
      break;
    }
    case 'hitpeer': {
      // 玩家 PvP：客户端只发“命中意图”，由房主校验距离/LOS 后再发 dmg。
      if(isHost) return null;
      const to=text(d.to,40);
      if(!to || to===peer.id || !room.peers.has(to)) return null;
      data={ to, dmg:num(d.dmg,1,500)||1, g:text(d.g,40) };
      break;
    }
    case 'dmg': {
      // 只有房主能对远端玩家结算伤害。
      if(!isHost) return null;
      const to=text(d.to,40);
      if(!to || to===peer.id || !room.peers.has(to)) return null;
      data={ to, dmg:num(d.dmg,1,500)||1, by:text(d.by,16)||peer.name };
      break;
    }
    case 'loot': {
      const i=num(d.i,0,99999);
      if(i===null) return null;
      data={ i:Math.floor(i), by:peer.name, n:text(d.n,40) };
      break;
    }
    case 'shot': {
      if(!isHost) return null;
      const x=num(d.x,0,20000), y=num(d.y,0,20000);
      if(x===null || y===null) return null;
      data={ id:text(d.id,40), x, y, a:num(d.a,-7,7)||0, g:text(d.g,32), e:text(d.e,16) };
      break;
    }
    case 'corpse': {
      if(!isHost) return null;
      const x=num(d.x,0,20000), y=num(d.y,0,20000);
      if(x===null || y===null) return null;
      data={ x, y, n:text(d.n,24), d:Array.isArray(d.d)?d.d.slice(0,6):[] };
      break;
    }
    case 'extract': data={ by:peer.name, z:text(d.z,40) }; break;
    case 'dead':    data={ by:peer.name, k:text(d.k,40) }; break;
    case 'chat':    data={ by:peer.name, t:text(d.t,80) }; break;
  }

  if(data && JSON.stringify(data).length > MAX_EVENT_DATA) return null;
  return { type, data };
}

/* ----------------------------- HTTP 工具 ----------------------------- */
function corsHeaders(req){
  if(!CORS_ORIGIN) return {};
  const origin=req.headers && req.headers.origin;
  if(!origin) return {};
  if(CORS_ORIGIN!=='*' && origin!==CORS_ORIGIN) return {};
  return {
    'Access-Control-Allow-Origin':CORS_ORIGIN,
    'Access-Control-Allow-Methods':'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers':'content-type',
    'Access-Control-Max-Age':'600',
    'Vary':'Origin',
  };
}

function pickEncoding(req){
  const ae=String((req.headers && req.headers['accept-encoding']) || '');
  if(/\bbr\b/.test(ae)) return 'br';
  if(/\bgzip\b/.test(ae)) return 'gzip';
  return '';
}

function compress(buf, enc){
  // Brotli 默认 quality=11 对 400KB 的 raid.js 太慢（首屏会卡几秒），这里用 5；
  // 体积仍然明显优于 gzip，且只压缩一次后进缓存。
  if(enc==='br') return zlib.brotliCompressSync(buf, { params:{ [zlib.constants.BROTLI_PARAM_QUALITY]:5 } });
  if(enc==='gzip') return zlib.gzipSync(buf, { level:6 });
  return buf;
}

function sendBuffer(req, res, code, headers, body){
  res.writeHead(code, headers);
  if(req.method==='HEAD') res.end();
  else res.end(body);
}

function json(req, res, obj, code=200){
  let body=Buffer.from(JSON.stringify(obj));
  const headers={
    ...SECURITY_HEADERS,
    ...corsHeaders(req),
    'Content-Type':'application/json; charset=utf-8',
    'Cache-Control':'no-store',
  };
  const enc=pickEncoding(req);
  if(body.length>1024 && enc){
    body=compress(body, enc);
    headers['Content-Encoding']=enc;
    headers['Vary']='Accept-Encoding';
  }
  headers['Content-Length']=body.length;
  sendBuffer(req,res,code,headers,body);
}

function sendText(req, res, code, textBody){
  const body=Buffer.from(String(textBody));
  sendBuffer(req,res,code,{
    ...SECURITY_HEADERS,
    'Content-Type':'text/plain; charset=utf-8',
    'Cache-Control':'no-store',
    'Content-Length':body.length,
  },body);
}

function readBody(req, limit=MAX_BODY){
  return new Promise(resolve=>{
    let size=0, chunks=[], done=false;
    const finish=(v)=>{ if(done) return; done=true; resolve(v); };
    req.on('data', d=>{
      if(done) return;
      size+=d.length;
      if(size>limit){
        finish({ ok:false, error:413, msg:'payload too large' });
        req.resume(); // 排空请求体，让客户端能收到 413
        return;
      }
      chunks.push(d);
    });
    req.on('end', ()=>{
      if(done) return;
      if(!chunks.length) return finish({ ok:true, value:{} });
      try{
        const v=JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if(!v || typeof v!=='object' || Array.isArray(v)) return finish({ ok:false, error:400, msg:'bad json' });
        finish({ ok:true, value:v });
      }catch(e){ finish({ ok:false, error:400, msg:'bad json' }); }
    });
    req.on('error', ()=>finish({ ok:false, error:400, msg:'bad request' }));
    req.on('aborted', ()=>finish({ ok:false, error:400, msg:'aborted' }));
  });
}

/* ----------------------------- 静态资源 ----------------------------- */
// 只允许运行游戏真正需要的文件；server.js / *.py / package.json / 点文件一律 404。
const STATIC_ALLOW = /^\/(?:index\.html|styles\.css|favicon\.svg|src\/[A-Za-z0-9_.-]+\.js|vendor\/[A-Za-z0-9_.-]+\.js)$/;

function serveStatic(req, res, rawUrl){
  if(req.method!=='GET' && req.method!=='HEAD'){
    return sendText(req,res,405,'method not allowed');
  }
  let p;
  try{ p=decodeURIComponent(String(rawUrl||'/').split('?')[0]||'/'); }
  catch(e){ return sendText(req,res,400,'bad request'); }
  if(p==='' || p==='/') p='/index.html';
  if(!STATIC_ALLOW.test(p)) return sendText(req,res,404,'not found');

  const file=path.join(ROOT, p.replace(/^\/+/,''));
  const rel=path.relative(ROOT,file);
  if(rel.startsWith('..') || path.isAbsolute(rel)) return sendText(req,res,404,'not found');

  fs.stat(file, (err, st)=>{
    if(err || !st.isFile()) return sendText(req,res,404,'not found');
    const ext=path.extname(file).toLowerCase();
    const etag='"'+st.size.toString(16)+'-'+Math.floor(st.mtimeMs).toString(16)+'"';
    const isHtml=ext==='.html';
    const versioned=/[?&]v=/.test(String(rawUrl));
    const cache=isHtml ? 'no-cache' : (versioned ? 'public, max-age=31536000, immutable' : 'public, max-age=3600');
    const baseHeaders={
      ...SECURITY_HEADERS,
      'Content-Type':MIME[ext]||'application/octet-stream',
      'Cache-Control':cache,
      'ETag':etag,
    };

    if(req.headers && req.headers['if-none-match']===etag){
      return sendBuffer(req,res,304,baseHeaders,Buffer.alloc(0));
    }

    const enc=pickEncoding(req);
    const key=file+'|'+st.mtimeMs+'|'+st.size+'|'+enc;
    let body=COMPRESS_CACHE.get(key);
    if(!body){
      try{ body=fs.readFileSync(file); }
      catch(e){ return sendText(req,res,404,'not found'); }
      if(enc) body=compress(body, enc);
      COMPRESS_CACHE.set(key, body);
    }
    const headers={ ...baseHeaders, 'Content-Length':body.length };
    if(enc){ headers['Content-Encoding']=enc; headers['Vary']='Accept-Encoding'; }
    sendBuffer(req,res,200,headers,body);
  });
}

/* ----------------------------- 接口 ----------------------------- */
async function handleApi(req, res, urlPath){
  if(req.method==='OPTIONS'){
    const h=corsHeaders(req);
    if(!Object.keys(h).length) return sendText(req,res,405,'method not allowed');
    res.writeHead(204,h);
    return res.end();
  }

  if(urlPath==='/api/ping' && req.method==='GET'){
    if(!rate(clientIp(req)+':ping',120,60000))
      return json(req,res,{ok:false,msg:'too many requests'},429);
    return json(req,res,{ok:true,t:now(),rooms:ROOMS.size,up:Math.round(process.uptime())});
  }

  if(req.method!=='POST')
    return json(req,res,{ok:false,msg:'method not allowed'},405);

  const ip=clientIp(req);
  if(!rate(ip+':api',6000,60000))
    return json(req,res,{ok:false,msg:'too many requests'},429);

  const rb=await readBody(req);
  if(!rb.ok) return json(req,res,{ok:false,msg:rb.msg},rb.error);
  const body=rb.value;

  if(urlPath==='/api/ping'){
    if(!rate(ip+':ping',120,60000))
      return json(req,res,{ok:false,msg:'too many requests'},429);
    return json(req,res,{ok:true,t:now(),rooms:ROOMS.size,up:Math.round(process.uptime())});
  }

  if(urlPath==='/api/create'){
    if(!rate(ip+':create',10,60000))
      return json(req,res,{ok:false,msg:'创建房间过于频繁，请稍后再试'},429);
    gc();
    if(ROOMS.size>=MAX_ROOMS)
      return json(req,res,{ok:false,msg:'服务器房间已满，请稍后再试'},503);
    const code=newCode();
    const room=makeRoom(code);
    const peer=makePeer(body.name);
    room.hostId=peer.id;
    room.peers.set(peer.id, peer);
    room.touched=now();
    ROOMS.set(code, room);
    return json(req,res,{ok:true,code,peerId:peer.id,secret:peer.secret,seed:room.seed,host:true,room:roomPublic(room)});
  }

  if(urlPath==='/api/join'){
    if(!rate(ip+':join',60,60000))
      return json(req,res,{ok:false,msg:'加入过于频繁，请稍后再试'},429);
    const code=String(body.code||'').toUpperCase().trim();
    if(!/^[A-Z0-9]{4,8}$/.test(code))
      return json(req,res,{ok:false,msg:'房间码格式不正确'},400);
    const room=ROOMS.get(code);
    if(!room) return json(req,res,{ok:false,msg:'房间不存在或已解散'},404);
    if(room.started) return json(req,res,{ok:false,msg:'这一局已经开始了'},409);
    if(room.peers.size>=MAX_PEERS) return json(req,res,{ok:false,msg:'房间已满（最多 4 人）'},409);
    const peer=makePeer(body.name);
    room.peers.set(peer.id, peer);
    room.touched=now();
    pushEvent(room, peer.id, 'join', { id:peer.id, name:peer.name });
    return json(req,res,{ok:true,code,peerId:peer.id,secret:peer.secret,seed:room.seed,host:room.hostId===peer.id,room:roomPublic(room)});
  }

  if(urlPath==='/api/sync'){
    if(!rate(ip+':sync',240,1000))
      return json(req,res,{ok:false,msg:'同步过于频繁'},429);
    const code=String(body.code||'').toUpperCase().trim();
    const room=ROOMS.get(code);
    if(!room) return json(req,res,{ok:false,msg:'房间已解散'},404);
    let peer=authPeer(room, body);
    if(!peer){
      // 掉线超时后允许用同一 peerId + 原 secret 在 60 秒内恢复；
      // 没有 secret 的人永远不能“自动挂载”进别人的房间。
      const pid=String(body.peerId||'');
      const secret=String(body.secret||'');
      const g=room.gone.get(pid);
      if(g && secret && g.secret===secret && now()<=g.expires && room.peers.size<MAX_PEERS){
        peer={ id:pid, name:g.name, secret:g.secret, state:null, last:now() };
        room.peers.set(pid, peer);
        room.gone.delete(pid);
        if(!room.hostId) room.hostId=pid;
        pushEvent(room, pid, 'join', { id:pid, name:peer.name });
      } else {
        return json(req,res,{ok:false,auth:false,msg:'联机身份已失效'},403);
      }
    }

    peer.last=now();
    if(body.state) peer.state=sanitizeState(body.state);
    if(Array.isArray(body.ai) && peer.id===room.hostId){
      room.ai=body.ai.slice(0,MAX_AI).map(sanitizeAI).filter(Boolean).slice(0,MAX_AI);
    }
    if(Array.isArray(body.events)){
      for(const ev of body.events.slice(0,40)){
        const s=sanitizeEvent(room, peer, ev);
        if(s) pushEvent(room, peer.id, s.type, s.data);
      }
    }
    const n=Number(body.cursor);
    const cursor=Number.isFinite(n)?Math.max(0,Math.floor(n)):0;
    const events=room.events
      .filter(e=>e.seq>cursor && e.from!==peer.id)
      .slice(0,80);
    // 只推进到“实际发出”的最后一条；剩余事件下次继续取，避免 cursor 跳号丢事件。
    const nextCursor=events.length ? events[events.length-1].seq : cursor;
    room.touched=now();
    return json(req,res,{
      ok:true, host:room.hostId===peer.id, seed:room.seed, started:room.started,
      startAt:room.startAt, room:roomPublic(room), ai:room.ai,
      events, cursor:nextCursor,
    });
  }

  if(urlPath==='/api/start'){
    if(!rate(ip+':start',20,60000))
      return json(req,res,{ok:false,msg:'操作过于频繁'},429);
    const code=String(body.code||'').toUpperCase().trim();
    const room=ROOMS.get(code);
    if(!room) return json(req,res,{ok:false,msg:'房间已解散'},404);
    const peer=authPeer(room, body);
    if(!peer) return json(req,res,{ok:false,auth:false,msg:'联机身份已失效'},403);
    if(room.hostId!==peer.id) return json(req,res,{ok:false,msg:'只有房主能开始'},403);
    if(!room.started){
      room.started=true; room.startAt=now();
      pushEvent(room, peer.id, 'start', { seed:room.seed, at:room.startAt });
    }
    room.touched=now();
    return json(req,res,{ok:true,seed:room.seed,startAt:room.startAt});
  }

  if(urlPath==='/api/leave'){
    if(!rate(ip+':leave',60,60000))
      return json(req,res,{ok:false,msg:'操作过于频繁'},429);
    const code=String(body.code||'').toUpperCase().trim();
    const room=ROOMS.get(code);
    if(!room) return json(req,res,{ok:true});
    const peer=authPeer(room, body);
    if(!peer) return json(req,res,{ok:false,auth:false,msg:'联机身份已失效'},403);
    room.peers.delete(peer.id);
    room.gone.delete(peer.id);
    pushEvent(room, peer.id, 'leave', { id:peer.id, name:peer.name });
    if(room.hostId===peer.id){
      const rest=[...room.peers.keys()];
      room.hostId=rest[0]||null;
      if(room.hostId) pushEvent(room, peer.id, 'host', { id:room.hostId });
    }
    room.touched=now();
    return json(req,res,{ok:true});
  }

  return json(req,res,{ok:false,msg:'unknown api'},404);
}

/* ----------------------------- 启动 ----------------------------- */
const server = http.createServer((req, res)=>{
  try{
    const urlPath=String(req.url||'/').split('?')[0];
    if(urlPath.startsWith('/api/')){
      handleApi(req, res, urlPath).catch(err=>{
        console.error('[api]', err && err.stack || err);
        try{ json(req,res,{ok:false,msg:'server error'},500); }catch(e){}
      });
      return;
    }
    if(req.method!=='GET' && req.method!=='HEAD') return sendText(req,res,405,'method not allowed');
    serveStatic(req, res, req.url);
  }catch(err){
    console.error('[http]', err && err.stack || err);
    try{ sendText(req,res,500,'server error'); }catch(e){}
  }
});

server.on('clientError', (err, socket)=>{
  try{ socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'); }catch(e){}
});

server.listen(PORT, HOST, ()=>{
  console.log(`[border-ops] serving ${ROOT} on http://${HOST}:${PORT}`);
  console.log(`[border-ops] host=${os.hostname()} node=${process.version}`);
});

process.on('uncaughtException', e=>console.error('[uncaught]', e && e.stack || e));
process.on('unhandledRejection', e=>console.error('[reject]', e && e.stack || e));
