#!/usr/bin/env node
'use strict';
/* =========================================================================
 * server.js — 边境行动 · 联机房服务器
 *   · 同一个端口既托管静态站点，也提供 /api/* 房间接口
 *   · 不依赖任何 npm 包（原生 http），发布时无需 install
 *   · 同步模型：HTTP 轮询（120ms 一次）。房主上传 AI 快照，服务端只做中继，
 *     这样即便反代不支持 WebSocket 也能稳定联机。
 * ========================================================================= */

const http = require('http');
const fs   = require('fs');
const path = require('path');
const os   = require('os');

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 3000);
const HOST = '0.0.0.0';

const MIME = {
  '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8', '.json':'application/json; charset=utf-8',
  '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.svg':'image/svg+xml',
  '.ico':'image/x-icon', '.woff2':'font/woff2', '.woff':'font/woff', '.mp3':'audio/mpeg',
  '.webp':'image/webp', '.txt':'text/plain; charset=utf-8',
};

/* ----------------------------- 房间 ----------------------------- */
const ROOMS = new Map();          // code -> room
const PEER_TIMEOUT = 20000;       // 20s 没 sync 视为掉线
const ROOM_TTL     = 5*60*1000;   // 空房 5 分钟后回收
const EVENT_KEEP   = 600;         // 每个房间保留的事件条数
const MAX_PEERS    = 4;

function now(){ return Date.now(); }

function newCode(){
  const ALPH = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for(let attempt=0; attempt<500; attempt++){
    let c='';
    for(let i=0;i<4;i++) c+=ALPH[Math.floor(Math.random()*ALPH.length)];
    if(!ROOMS.has(c)) return c;
  }
  return 'R'+Math.floor(Math.random()*9000+1000);
}
function newId(){ return 'p'+Math.random().toString(36).slice(2,9); }

function makeRoom(code, seed){
  return {
    code, seed: seed || ((Math.random()*0x7fffffff)>>>0),
    hostId:null, started:false, startAt:0,
    peers:new Map(),          // peerId -> {id,name,state,last}
    ai:[],                    // 房主上传的 AI 快照
    events:[], seq:0,         // 事件环形列表
    created:now(), touched:now(),
  };
}

function roomPublic(r){
  return {
    code:r.code, seed:r.seed, hostId:r.hostId, started:r.started,
    peers:[...r.peers.values()].map(p=>({
      id:p.id, name:p.name, host:p.id===r.hostId,
      state:p.state||null,
    })),
  };
}

function pushEvent(r, from, type, data){
  r.seq++;
  r.events.push({ seq:r.seq, from, type, data:data||null, t:now() });
  if(r.events.length>EVENT_KEEP) r.events.splice(0, r.events.length-EVENT_KEEP);
}

function gc(){
  const t=now();
  for(const [code,r] of ROOMS){
    for(const [id,p] of r.peers){
      if(t-p.last>PEER_TIMEOUT){
        r.peers.delete(id);
        pushEvent(r, id, 'leave', { id, name:p.name });
        if(r.hostId===id){
          const rest=[...r.peers.keys()];
          r.hostId=rest[0]||null;
          if(r.hostId) pushEvent(r, id, 'host', { id:r.hostId });
        }
      }
    }
    if(!r.peers.size && t-r.touched>ROOM_TTL) ROOMS.delete(code);
  }
}
setInterval(gc, 5000).unref?.();

/* ----------------------------- HTTP 工具 ----------------------------- */
function json(res, obj, code=200){
  const body=JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type':'application/json; charset=utf-8',
    'Cache-Control':'no-store',
    'Access-Control-Allow-Origin':'*',
    'Access-Control-Allow-Headers':'content-type',
  });
  res.end(body);
}

function readBody(req, limit=256*1024){
  return new Promise((resolve)=>{
    let size=0, chunks=[];
    req.on('data', d=>{ size+=d.length; if(size>limit){ req.destroy(); } else chunks.push(d); });
    req.on('end', ()=>{
      if(!chunks.length) return resolve({});
      try{ resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch(e){ resolve({}); }
    });
    req.on('error', ()=>resolve({}));
  });
}

function serveStatic(req, res, urlPath){
  let p = decodeURIComponent(urlPath.split('?')[0]);
  if(p==='/' || p==='') p='/index.html';
  const file = path.join(ROOT, path.normalize(p).replace(/^(\.\.[/\\])+/, ''));
  if(!file.startsWith(ROOT)){ res.writeHead(403); return res.end('forbidden'); }
  fs.stat(file, (err, st)=>{
    if(err || !st.isFile()){
      // 单页应用回退
      const idx=path.join(ROOT,'index.html');
      return fs.readFile(idx, (e2,buf)=>{
        if(e2){ res.writeHead(404); res.end('not found'); return; }
        res.writeHead(200, {'Content-Type':MIME['.html'], 'Cache-Control':'no-cache'});
        res.end(buf);
      });
    }
    const ext=path.extname(file).toLowerCase();
    res.writeHead(200, {
      'Content-Type':MIME[ext]||'application/octet-stream',
      'Cache-Control': ext==='.html' ? 'no-cache' : 'public, max-age=60',
      'Content-Length': st.size,
    });
    fs.createReadStream(file).pipe(res);
  });
}

/* ----------------------------- 接口 ----------------------------- */
async function handleApi(req, res, urlPath){
  const body = req.method==='POST' ? await readBody(req) : {};

  if(urlPath==='/api/ping'){
    return json(res, { ok:true, t:now(), rooms:ROOMS.size, up:Math.round(process.uptime()) });
  }

  if(urlPath==='/api/create'){
    gc();
    const code=newCode();
    const room=makeRoom(code);
    const pid=newId();
    const name=String(body.name||'玩家').slice(0,16);
    room.hostId=pid;
    room.peers.set(pid, { id:pid, name, state:null, last:now() });
    room.touched=now();
    ROOMS.set(code, room);
    return json(res, { ok:true, code, peerId:pid, seed:room.seed, host:true, room:roomPublic(room) });
  }

  if(urlPath==='/api/join'){
    gc();
    const code=String(body.code||'').toUpperCase().trim();
    const room=ROOMS.get(code);
    if(!room) return json(res, { ok:false, msg:'房间不存在或已解散' }, 404);
    if(room.started) return json(res, { ok:false, msg:'这一局已经开始了' }, 409);
    if(room.peers.size>=MAX_PEERS) return json(res, { ok:false, msg:'房间已满（最多 4 人）' }, 409);
    const pid=newId();
    const name=String(body.name||'玩家').slice(0,16);
    room.peers.set(pid, { id:pid, name, state:null, last:now() });
    room.touched=now();
    pushEvent(room, pid, 'join', { id:pid, name });
    return json(res, { ok:true, code, peerId:pid, seed:room.seed, host:room.hostId===pid, room:roomPublic(room) });
  }

  if(urlPath==='/api/sync'){
    const code=String(body.code||'').toUpperCase().trim();
    const room=ROOMS.get(code);
    if(!room) return json(res, { ok:false, msg:'房间已解散' }, 404);
    const pid=String(body.peerId||'');
    let peer=room.peers.get(pid);
    if(!peer){
      // 掉线超时被剔除：允许用同一 id 重新挂上（短时重连）
      peer={ id:pid, name:String(body.name||'玩家').slice(0,16), state:null, last:now() };
      room.peers.set(pid, peer);
      if(!room.hostId) room.hostId=pid;
    }
    peer.last=now();
    if(body.state) peer.state=body.state;
    if(Array.isArray(body.ai) && pid===room.hostId) room.ai=body.ai;
    if(Array.isArray(body.events)){
      for(const ev of body.events.slice(0,40)){
        if(ev && ev.type) pushEvent(room, pid, String(ev.type), ev.data||null);
      }
    }
    const cursor=Number(body.cursor||0);
    const events=room.events.filter(e=>e.seq>cursor && e.from!==pid).slice(0,80);
    room.touched=now();
    return json(res, {
      ok:true, host:room.hostId===pid, seed:room.seed, started:room.started,
      startAt:room.startAt, room:roomPublic(room), ai:room.ai,
      events, cursor:room.seq,
    });
  }

  if(urlPath==='/api/start'){
    const code=String(body.code||'').toUpperCase().trim();
    const room=ROOMS.get(code);
    if(!room) return json(res, { ok:false, msg:'房间已解散' }, 404);
    if(room.hostId!==body.peerId) return json(res, { ok:false, msg:'只有房主能开始' }, 403);
    room.started=true; room.startAt=now(); room.touched=now();
    pushEvent(room, room.hostId, 'start', { seed:room.seed, at:room.startAt });
    return json(res, { ok:true, seed:room.seed, startAt:room.startAt });
  }

  if(urlPath==='/api/leave'){
    const code=String(body.code||'').toUpperCase().trim();
    const room=ROOMS.get(code);
    if(room){
      const pid=String(body.peerId||'');
      const p=room.peers.get(pid);
      if(p){
        room.peers.delete(pid);
        pushEvent(room, pid, 'leave', { id:pid, name:p.name });
        if(room.hostId===pid){
          const rest=[...room.peers.keys()];
          room.hostId=rest[0]||null;
          if(room.hostId) pushEvent(room, pid, 'host', { id:room.hostId });
        }
      }
      room.touched=now();
    }
    return json(res, { ok:true });
  }

  return json(res, { ok:false, msg:'unknown api' }, 404);
}

/* ----------------------------- 启动 ----------------------------- */
const server = http.createServer((req, res)=>{
  const urlPath = req.url.split('?')[0];
  if(urlPath.startsWith('/api/')){
    handleApi(req, res, urlPath).catch(err=>{
      console.error('[api]', err && err.message);
      try{ json(res, { ok:false, msg:'server error' }, 500); }catch(e){}
    });
    return;
  }
  if(req.method!=='GET' && req.method!=='HEAD'){ res.writeHead(405); return res.end('method not allowed'); }
  serveStatic(req, res, req.url);
});

server.listen(PORT, HOST, ()=>{
  console.log(`[border-ops] serving ${ROOT} on http://${HOST}:${PORT}`);
  console.log(`[border-ops] host=${os.hostname()} node=${process.version}`);
});

process.on('uncaughtException', e=>console.error('[uncaught]', e));
process.on('unhandledRejection', e=>console.error('[reject]', e));
