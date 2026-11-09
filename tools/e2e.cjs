/* =========================================================================
 * e2e.cjs — 一条命令跑真实浏览器冒烟（v0.36.3）
 *
 *   npm run test:e2e
 *
 * 干三件事：
 *   1. 用随机空闲端口起 `node server.js`（不占用常用 3000，避免和本地开发冲突）；
 *   2. 轮询 /api/ping 等它就绪（最多 20s，起不来直接报错退出，不装死）；
 *   3. 把 BO_BASE / BO_REPORT / BO_SHOTS 传给 playwright_smoke.py，跑完收尸。
 *
 * 为什么要有这个包装：
 *   CI 与本地都需要「起服务 → 等就绪 → 跑 → 关」这套顺序，写在 Python 里会让
 *   脚本同时管进程和断言两件事；放在 Node 里则复用 server.js 的同一套启动参数。
 * ========================================================================= */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const net = require('net');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'dist', 'e2e');
fs.mkdirSync(OUT, { recursive: true });

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const p = srv.address().port;
      srv.close(() => resolve(p));
    });
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function waitReady(base, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(base + 'api/ping', { cache: 'no-store' });
      if (r.ok) {
        const j = await r.json().catch(() => null);
        if (j && j.ok) return true;
      }
    } catch (e) { /* 还没起来，继续等 */ }
    await sleep(400);
  }
  return false;
}

(async () => {
  const port = Number(process.env.BO_PORT || 0) || await freePort();
  const base = `http://127.0.0.1:${port}/`;

  console.log(`[e2e] 启动 server.js（端口 ${port}）`);
  const server = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    cwd: ROOT, env: Object.assign({}, process.env, { PORT: String(port) }), stdio: 'ignore',
  });
  let serverExited = false;
  server.on('exit', () => { serverExited = true; });

  const cleanup = () => {
    if (!serverExited) {
      try { server.kill(); } catch (e) { /* 已退出 */ }
    }
  };
  process.on('exit', cleanup);
  process.on('SIGINT', () => { cleanup(); process.exit(130); });

  const ready = await waitReady(base, 20000);
  if (!ready) {
    console.error('[e2e] server.js 在 20s 内没有 /api/ping 响应，放弃');
    cleanup();
    process.exit(1);
  }
  console.log(`[e2e] 就绪：${base}`);

  const py = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
  const args = [path.join(ROOT, 'playwright_smoke.py')];
  const env = Object.assign({}, process.env, {
    BO_BASE: base,
    BO_REPORT: path.join(OUT, 'test-report.json'),
    BO_SHOTS: path.join(OUT, 'shots'),
  });

  console.log('[e2e] 跑 playwright_smoke.py（产物写 dist/e2e/）');
  const child = spawn(py, args, { cwd: ROOT, env, stdio: 'inherit' });
  const code = await new Promise(resolve => child.on('exit', c => resolve(c === null ? 1 : c)));

  cleanup();
  console.log(`\n[e2e] 结束，退出码 ${code}`);
  console.log(`[e2e] 报告：${path.relative(ROOT, path.join(OUT, 'test-report.json'))}`);
  console.log(`[e2e] 截图：${path.relative(ROOT, path.join(OUT, 'shots'))}`);
  process.exit(code);
})().catch(e => {
  console.error('[e2e] 运行器自身出错：', e);
  process.exit(1);
});
