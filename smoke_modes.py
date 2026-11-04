import json
from playwright.sync_api import sync_playwright

# 每个模式的真实进入流程（与 UI 一致）
FLOW = {
    "campaign": [(".class-card", "#btn-start")],
    "endless":  [(".class-card", "#btn-start")],
    "dust2":    [("#btn-dust-start",)],
    "raid":     [("#btn-raid-start",)],
    "br":       [("#btn-br-start",)],
}
results = {}

with sync_playwright() as p:
    browser = p.chromium.launch()
    for mode, steps in FLOW.items():
        errors = []
        ctx = browser.new_context(viewport={"width":1280,"height":800})
        page = ctx.new_page()
        page.on("console", lambda m: errors.append("CONSOLE: " + m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: errors.append("PAGEERROR: " + str(e)))
        rec = {"mode": mode, "state": None, "ok": False, "partsError": False, "errorCount": 0, "errors": []}
        try:
            page.goto("http://localhost:8132/index.html?nocache=1", wait_until="load")
            page.wait_for_timeout(1200)
            if mode != "raid":
                page.click("#btn-more-modes")   # 其他模式默认折叠
                page.wait_for_timeout(250)
            page.click(f'[data-mode="{mode}"]')
            page.wait_for_timeout(700)
            for sel in steps:
                if isinstance(sel, tuple):
                    for s in sel:
                        page.wait_for_selector(s, timeout=4000)
                        page.click(s)
                        page.wait_for_timeout(500)
                else:
                    page.wait_for_selector(sel, timeout=4000)
                    page.click(sel)
                    page.wait_for_timeout(500)
            page.wait_for_timeout(1800)  # 让游戏跑几帧
            st = page.evaluate("() => (typeof game!=='undefined'&&game)?{state:game.state,mode:game.mode,hasPlayer:!!game.player}:null")
            rec["state"] = st
            rec["partsError"] = any("parts is not defined" in e for e in errors)
            rec["errorCount"] = len(errors)
            rec["errors"] = errors[:5]
            # 成功：离开了 title，且非 parts 错误
            rec["ok"] = bool(st) and st.get("state") not in (None,"title") and not rec["partsError"]
        except Exception as e:
            rec["exception"] = str(e)[:200]
            rec["errors"] = errors[:5]
        results[mode] = rec
        ctx.close()
    browser.close()

print("=== 5-MODE REGRESSION ===")
allok = True
for m, r in results.items():
    ok = r["ok"]
    allok = allok and ok
    print(f"[{m}] ok={ok} state={r.get('state')} partsErr={r.get('partsError')} errs={r.get('errorCount')}")
    for e in r.get("errors", [])[:3]:
        print("   ", e[:150])
print("ALL OK:", allok)
import sys
sys.exit(0 if allok else 1)
