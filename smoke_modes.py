import json, os, sys
from playwright.sync_api import sync_playwright

# 每个模式的真实进入流程（与 UI 一致）
FLOW = {
    "campaign": [(".class-card", "#btn-start")],
    "endless":  [(".class-card", "#btn-start")],
    "dust2":    [("#btn-dust-start",)],
    "raid":     [("#btn-raid-start",)],
    "br":       [("#btn-br-start",)],
}
URL = os.environ.get("BORDER_URL", "http://localhost:8132/index.html?nocache=1")
results = {}

with sync_playwright() as p:
    channel = os.environ.get("BORDER_CHANNEL", "")
    browser = p.chromium.launch(channel=channel) if channel else p.chromium.launch()
    # 先探测当前构建是否只开放塔科夫模式
    probe = browser.new_context(viewport={"width":1280,"height":800}).new_page()
    probe.goto(URL, wait_until="load")
    probe.wait_for_function("() => typeof CFG !== 'undefined'", timeout=8000)
    only_raid = probe.evaluate("() => CFG.onlyRaid !== false")
    probe.close()
    modes = ["raid"] if only_raid else list(FLOW.keys())

    for mode in modes:
        errors = []
        ctx = browser.new_context(viewport={"width":1280,"height":800})
        page = ctx.new_page()
        page.on("console", lambda m: errors.append("CONSOLE: " + m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: errors.append("PAGEERROR: " + str(e)))
        rec = {"mode": mode, "state": None, "ok": False, "partsError": False, "errorCount": 0, "errors": []}
        try:
            page.goto(URL, wait_until="load")
            page.wait_for_timeout(1200)
            if only_raid:
                # 只开放塔科夫时：确认其他模式入口确实被隐藏
                hidden = page.evaluate("""() => ({
                    cards: document.querySelectorAll('.mode-card').length,
                    more: !!document.getElementById('btn-more-modes'),
                    cont: !!document.getElementById('btn-continue'),
                })""")
                rec["hidden"] = hidden
                if hidden["cards"] or hidden["more"] or hidden["cont"]:
                    rec["ok"] = False
                    rec["errors"].append("other mode entrances are still visible: " + json.dumps(hidden))
                    results[mode] = rec
                    ctx.close()
                    continue
            elif mode != "raid":
                page.click("#btn-more-modes")   # 其他模式默认折叠
                page.wait_for_timeout(250)
            page.click(f'[data-mode="{mode}"]')
            page.wait_for_timeout(700)
            for sel in FLOW[mode]:
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
            # 成功：离开了 title，且非 parts 错误；onlyRaid 还要通过上面的入口隐藏检查
            rec["ok"] = bool(st) and st.get("state") not in (None,"title") and not rec["partsError"]
        except Exception as e:
            rec["exception"] = str(e)[:200]
            rec["errors"] = errors[:5]
        results[mode] = rec
        ctx.close()
    browser.close()

print("=== MODE REGRESSION (%s) ===" % ("RAID ONLY" if only_raid else "ALL 5"))
allok = True
for m, r in results.items():
    ok = r["ok"]
    allok = allok and ok
    print(f"[{m}] ok={ok} state={r.get('state')} partsErr={r.get('partsError')} errs={r.get('errorCount')} hidden={r.get('hidden')}")
    for e in r.get("errors", [])[:3]:
        print("   ", e[:150])
print("ALL OK:", allok)
sys.exit(0 if allok else 1)
