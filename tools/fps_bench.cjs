#!/usr/bin/env node
/* =========================================================================
 * tools/fps_bench.cjs — FPS 基准探针（v0.22.0，零 npm 依赖）
 *
 * 起一个本地静态服务 + headless Chromium，进 raid 后分别在 2D / 3D 各采
 * BENCH_FRAMES 帧 requestAnimationFrame 间隔，输出 p50/p95/平均 fps 到
 * fps-baseline.json。给渲染层重构一个可复现的性能基线。
 *
 *   npm run bench:fps
 *   CHROME=/path/to/chrome BENCH_FRAMES=120 node tools/fps_bench.cjs
 *
 * 需要本机有 Chrome/Chromium；CI 不跑这一步（只做语法检查）。
 * ========================================================================= */
"use strict";
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.BENCH_PORT || 8134);
const CDP_PORT = Number(process.env.BENCH_CDP_PORT || 9334);
const FRAMES = Math.max(30, Number(process.env.BENCH_FRAMES || 120));
const OUT = path.join(ROOT, 'fps-baseline.json');
const sleep = ms => new Promise(r => setTimeout(r, ms));

function findChrome() {
  const c = [];
  if (process.env.CHROME) c.push(process.env.CHROME);
  const pw = path.join(os.homedir(), 'AppData', 'Local', 'ms-playwright');
  if (fs.existsSync(pw)) for (const d of fs.readdirSync(pw)) {
    c.push(path.join(pw, d, 'chrome-win64', 'chrome.exe'));
    c.push(path.join(pw, d, 'chrome-linux', 'chrome'));
  }
  c.push('C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
  return c.find(p => p && fs.existsSync(p)) || null;
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png',
};
function serve() {
  return http.createServer((req, res) => {
    const u = decodeURIComponent(String(req.url || '/').split('?')[0]);
    const rel = u === '/' ? 'index.html' : u.replace(/^\//, '');
    const f = path.resolve(ROOT, rel);
    if (!f.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
    fs.readFile(f, (err, buf) => {
      if (err) { res.writeHead(404); res.end('404'); return; }
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(f)] || 'application/octet-stream',
        'Cache-Control': 'no-store, no-cache, must-revalidate', 'Pragma': 'no-cache',
      });
      res.end(buf);
    });
  });
}

/* 浏览器内探针：进 raid → 2D 采样 → 切 3D → 再采样。返回纯数据对象。 */
const PROBE = `(async function(){
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const N=${FRAMES};
  const sample=async(label)=>{
    const d=[]; let last=performance.now();
    await new Promise(res=>{
      let n=0;
      const tick=()=>{ const t=performance.now(); d.push(t-last); last=t;
        if(++n<N) requestAnimationFrame(tick); else res(); };
      requestAnimationFrame(tick);
    });
    d.sort((a,b)=>a-b);
    const mean=d.reduce((a,b)=>a+b,0)/d.length;
    return { label, frames:d.length,
      medianMs:+d[Math.floor(d.length/2)].toFixed(2),
      p95Ms:+d[Math.floor(d.length*0.95)].toFixed(2),
      meanMs:+mean.toFixed(2), fps:+(1000/mean).toFixed(1) };
  };
  try{
    if(typeof CFG==="undefined") return { error:"CFG 未加载" };
    const hero=document.querySelector('.mode-hero'); if(hero) hero.click();
    await sleep(600);
    const start=document.getElementById('btn-raid-start'); if(start){ start.click(); await sleep(2200); }
    const out={ version:CFG.version,
      mode:typeof ViewMode!=="undefined"?ViewMode.mode:"n/a",
      active:typeof Raid!=="undefined" && !!Raid.active, samples:[] };
    out.samples.push(await sample('2d'));
    if(typeof ViewMode!=="undefined" && typeof ViewMode.set==="function"){
      ViewMode.set('3d'); await sleep(500);
      out.samples.push(await sample('3d')); out.mode3d=ViewMode.mode;
    }
    return out;
  }catch(e){ return { error:String(e) }; }
})()`;

async function main() {
  const chrome = findChrome();
  if (!chrome) { console.error('未找到 Chrome/Chromium，请设置 CHROME 环境变量'); process.exit(2); }
  const server = serve();
  await new Promise(r => server.listen(PORT, '127.0.0.1', r));
  const proc = spawn(chrome, [
    '--headless=new', `--remote-debugging-port=${CDP_PORT}`,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--hide-scrollbars',
    '--no-proxy-server', '--proxy-bypass-list=<-loopback>', '--window-size=1440,900',
    '--user-data-dir=' + path.join(os.tmpdir(), 'bops-bench-' + Date.now()), 'about:blank',
  ], { stdio: 'ignore' });
  const cleanup = () => { try { proc.kill(); } catch (e) {} try { server.close(); } catch (e) {} };
  try {
    let wsUrl = null;
    for (let i = 0; i < 80 && !wsUrl; i++) {
      try { const r = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`); wsUrl = (await r.json()).webSocketDebuggerUrl; }
      catch (e) { await sleep(250); }
    }
    if (!wsUrl) throw new Error('CDP 未就绪');
    const ws = new WebSocket(wsUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    let idc = 0; const pending = new Map(); let sid = null; const errors = [];
    ws.onmessage = ev => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
      if (m.method === 'Runtime.exceptionThrown')
        errors.push(String(m.params.exceptionDetails.text || '').slice(0, 200));
    };
    const send = (method, params = {}, useSession = true) => {
      const id = ++idc, p = { id, method, params };
      if (useSession && sid) p.sessionId = sid;
      ws.send(JSON.stringify(p));
      return new Promise(r => pending.set(id, r));
    };
    const t = await send('Target.getTargets', {}, false);
    const page = t.result.targetInfos.find(x => x.type === 'page');
    const att = await send('Target.attachToTarget', { targetId: page.targetId, flatten: true }, false);
    sid = att.result.sessionId;
    await send('Runtime.enable'); await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/index.html` });
    let ready = false;
    for (let i = 0; i < 60 && !ready; i++) {
      await sleep(250);
      const r = await send('Runtime.evaluate', {
        expression: 'typeof CFG!=="undefined" && typeof Raid!=="undefined"', returnByValue: true,
      });
      ready = !!(r.result && r.result.result && r.result.result.value);
    }
    if (!ready) throw new Error('页面脚本未加载完成');
    const r = await send('Runtime.evaluate', { expression: PROBE, awaitPromise: true, returnByValue: true, userGesture: true });
    const data = (r.result && r.result.result && r.result.result.value) || { error: 'no result' };
    const report = {
      at: new Date().toISOString(), version: data.version || null, frames: FRAMES,
      chrome, errors: errors.slice(0, 10), result: data,
    };
    fs.writeFileSync(OUT, JSON.stringify(report, null, 2), 'utf8');
    console.log(JSON.stringify(report, null, 2));
    ws.close();
    if (data.error) process.exitCode = 1;
  } finally { cleanup(); }
}
main().catch(e => { console.error('基准失败:', e.message); process.exitCode = 1; });
