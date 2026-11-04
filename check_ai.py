import time, json
from playwright.sync_api import sync_playwright

URL = "http://localhost:8132/"
errs = []

def main():
    with sync_playwright() as p:
        b = p.chromium.launch(args=["--no-sandbox"])
        pg = b.new_page(viewport={"width":1400,"height":900})
        pg.on("pageerror", lambda e: errs.append("PAGE:"+str(e)))
        pg.on("console", lambda m: errs.append("CON:"+m.text) if m.type=="error" else None)
        pg.goto(URL, wait_until="load")
        pg.wait_for_function("() => window.game && typeof Raid!=='undefined'", timeout=15000)
        time.sleep(0.5)
        pg.evaluate("() => game.startRaid({})")
        time.sleep(1.6)

        info = pg.evaluate("""() => ({
            state:game.state, walls:Raid.walls.length, props:Raid.props.length,
            decals:(Raid.decals||[]).length, containers:Raid.containers.length,
            ops:Raid.ops.length
        })""")
        print("INFO:", json.dumps(info))

        # AI 全图分布统计（3x3 区域 + 距玩家最近距离）
        dist = pg.evaluate("""() => {
            const W=Raid.ops.filter(o=>o.id!=='you');
            const p=Raid.player;
            const CW=RAID_MAP_W/3, CH=RAID_MAP_H/3;
            const cells={}; let minD=1e9, sumD=0, n=0, bounty=0;
            for(const o of W){
                if(o.bounty){ bounty++; continue; }
                const cx=Math.min(2,Math.floor(o.x/CW)), cy=Math.min(2,Math.floor(o.y/CH));
                const k=cy*3+cx; cells[k]=(cells[k]||0)+1;
                const d=Math.hypot(o.x-p.x,o.y-p.y); sumD+=d; n++;
                if(d<minD) minD=d;
            }
            return {totalAI:W.length, normal:n, bounty, cells, minDist:Math.round(minD),
                    avgDist:Math.round(sumD/(n||1)), px:Math.round(p.x), py:Math.round(p.y)};
        }""")
        print("AIDIST:", json.dumps(dist, ensure_ascii=False))

        # 多局稳定性：连续 5 局，统计每局 normal AI 数、最近距离、覆盖的 3x3 区域数
        print("STABILITY (5 runs):")
        for run in range(5):
            pg.evaluate("() => { if(game.state!=='raid') game.startRaid({}); else Raid.restart && Raid.restart(); }")
            # 直接重开更稳妥：退回菜单再进
            pg.evaluate("() => { if(game.state==='raid'){ game.toMenu&&game.toMenu(); } }")
            time.sleep(0.4)
            pg.evaluate("() => game.startRaid({})")
            time.sleep(1.2)
            r = pg.evaluate("""() => {
                const W=Raid.ops.filter(o=>o.id!=='you' && !o.bounty);
                const p=Raid.player; const cells={}; let minD=1e9;
                for(const o of W){ const cx=Math.min(2,Math.floor(o.x/2334)), cy=Math.min(2,Math.floor(o.y/1867));
                    cells[cy*3+cx]=(cells[cy*3+cx]||0)+1;
                    const d=Math.hypot(o.x-p.x,o.y-p.y); if(d<minD)minD=d; }
                return {n:W.length, cells:Object.keys(cells).length, minD:Math.round(minD)};
            }""")
            print(f"  run{run+1}: normalAI={r['n']} coveredCells={r['cells']}/9 minDist={r['minD']}")

        # 截图看美化（传送到不同区）
        def shot(x,y,name):
            pg.evaluate("([x,y]) => { Raid.player.x=x; Raid.player.y=y; Raid.camera.x=x-700; Raid.camera.y=y-450; }",[x,y])
            time.sleep(0.6); pg.screenshot(path=f"/workspace/shots/ai_{name}.png")
        # 回到初始出生点附近截图
        shot(dist['px'], dist['py'], "spawn")
        shot(3500, 2800, "mid")
        shot(5500, 1200, "east")
        shot(1500, 4800, "south")

        fps = pg.evaluate("""() => new Promise(res=>{ let n=0,t0=performance.now(),mx=0,last=t0;
            const tick=()=>{const now=performance.now();const dt=now-last;last=now;if(dt>mx)mx=dt;n++;
                if(now-t0<1500)requestAnimationFrame(tick);else res({fps:Math.round(n/((now-t0)/1000)),maxFrame:Math.round(mx)});};
            requestAnimationFrame(tick);})""")
        print("PERF:", json.dumps(fps))
        b.close()
    print("ERRORS:", len(errs))
    for e in errs[:8]: print("  ", e)

main()
