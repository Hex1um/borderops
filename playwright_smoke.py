"""borderops 真实浏览器冒烟测试（系统 Edge，无需下载浏览器）。

用法：先 `PORT=3211 node server.js`，再 `python playwright_smoke.py`。
覆盖：标题页 -> 配装大厅 -> 进图 -> 真实鼠标开火/键盘移动 -> 五种元素状态 -> 护甲击穿回退 -> 控制台异常。
产物：testshots/*.png 截图 + test-report.json 结构化报告。
"""
import json
import os
import time
import sys

from playwright.sync_api import sync_playwright

BASE = os.environ.get("BO_BASE", "http://127.0.0.1:3211/")
EDGE = os.environ.get("BO_EDGE", r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe")
ROOT = os.path.dirname(os.path.abspath(__file__))
SHOTS = os.path.join(ROOT, "testshots")
os.makedirs(SHOTS, exist_ok=True)

report = {"base": BASE, "checks": [], "console_errors": [], "page_errors": [], "snapshots": {}, "notes": []}


def check(name, cond, detail=""):
    ok = bool(cond)
    report["checks"].append({"name": name, "ok": ok, "detail": str(detail)})
    print(("  PASS  " if ok else "  FAIL  ") + name + "  " + str(detail), flush=True)
    return ok


def shot(page, name):
    p = os.path.join(SHOTS, name + ".png")
    try:
        page.screenshot(path=p)
        return p
    except Exception as e:
        report["notes"].append("screenshot %s failed: %s" % (name, e))
        return ""


with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path=EDGE, headless=True,
                                 args=["--no-sandbox", "--disable-dev-shm-usage"])
    ctx = browser.new_context(viewport={"width": 1360, "height": 820}, device_scale_factor=1)
    page = ctx.new_page()
    page.on("console", lambda m: report["console_errors"].append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: report["page_errors"].append(str(e)))

    print("\n=== A. 载入 / 标题页 ===", flush=True)
    page.goto(BASE, wait_until="load", timeout=40000)
    page.wait_for_function("typeof game !== 'undefined' && game.state === 'title'", timeout=20000)
    init = page.evaluate("""() => ({
        version: CFG.version, onlyRaid: CFG.onlyRaid, mode: game.mode, state: game.state,
        scripts: document.querySelectorAll('script[src]').length,
        title: document.title,
        hero: !!document.querySelector('[data-mode="raid"]')
    })""")
    report["snapshots"]["title"] = init
    check("21 个脚本全部加载", init["scripts"] >= 21, "%d 个" % init["scripts"])
    check("window.game 就绪且处于标题页", init["state"] == "title", init["title"])
    check("标题页有塔科夫入口", init["hero"], "data-mode=raid")
    shot(page, "01-title")

    print("\n=== B. 配装大厅 -> 真实点击进入战区 ===", flush=True)
    page.locator('[data-mode="raid"]').click()
    page.wait_for_selector("#btn-raid-start", timeout=15000)
    lobby = page.evaluate("""() => ({
        startBtn: !!document.getElementById('btn-raid-start'),
        weapons: (RaidStash.load().weapons || []).length,
        armors: (RaidStash.load().armors || []).length,
        keys: (RaidStash.load().keys || []).length
    })""")
    report["snapshots"]["lobby"] = lobby
    check("配装大厅渲染完成", lobby["startBtn"], "仓库枪 %d / 甲 %d / 钥匙 %d" %
          (lobby["weapons"], lobby["armors"], lobby["keys"]))
    shot(page, "02-lobby")
    page.locator("#btn-raid-start").click()
    page.wait_for_function("typeof Raid !== 'undefined' && Raid.active === true && game.mode === 'raid'",
                           timeout=20000)
    page.wait_for_timeout(500)

    raid = page.evaluate("""() => {
        const p = Raid.player;
        const types = {};
        for (const o of Raid.ops) {
            if (o.isPlayer || o.remote) continue;
            const t = raidArmorType(o); types[t] = (types[t] || 0) + 1;
        }
        return {
            state: game.state, mode: game.mode, elapsed: Raid.elapsed, timer: Raid.timer,
            ops: Raid.ops.length, types: types,
            extracts: Raid.extracts.length, containers: Raid.containers.length,
            walls: Raid.walls.length, map: [RAID_MAP_W, RAID_MAP_H],
            player: { hp: p.hp, maxHP: p.maxHP, armor: p.armor, armorTier: p.armorTier,
                      gun: p.gun ? p.gun.name : null, element: p.gun ? p.gun.element : null,
                      ammo: p.gun ? p.gun.ammoMag : null, x: Math.round(p.x), y: Math.round(p.y) },
            shieldUsers: Raid.ops.filter(o => (o.shield || 0) > 0).length,
            camSync: Math.abs(game.camera.x - Raid.camera.x) < 1 && Math.abs(game.camera.y - Raid.camera.y) < 1,
            dotElements: Object.values(ELEMENTS).filter(e => e.dot > 0).map(e => e.id)
        };
    }""")
    report["snapshots"]["raid"] = raid
    check("成功进入塔科夫战区", raid["state"] == "playing" and raid["mode"] == "raid",
          "ops=%d 计时=%ss" % (raid["ops"], raid["timer"]))
    check("地图 / 撤离点 / 容器生成", raid["extracts"] > 0 and raid["containers"] > 0 and raid["walls"] > 0,
          "撤离点 %d · 容器 %d · 墙 %d · 地图 %s" %
          (raid["extracts"], raid["containers"], raid["walls"], raid["map"]))
    check("T4+ 装甲型单位存在（黄色血条有意义）", (raid["types"].get("armor") or 0) > 0,
          "类型分布 " + json.dumps(raid["types"], ensure_ascii=False))
    check("护盾型单位存在（蓝血条 / 电击 ×2.00 有目标）",
          (raid["types"].get("shield") or 0) > 0 and raid["shieldUsers"] > 0,
          "带盾单位 %d" % raid["shieldUsers"])
    check("raid 相机已同步给 game.camera", raid["camSync"], "worldToScreen 可用")
    check("dot 元素在配置里已被消费", len(raid["dotElements"]) >= 3, raid["dotElements"])
    shot(page, "03-raid")

    print("\n=== C. 真实输入：鼠标开火 + WASD 移动，跑 3 秒 ===", flush=True)
    # 先保证手上有枪（默认配装大厅不勾选任何枪，真空手进图测不了开火）
    page.evaluate("""() => {
        if (!Raid.player.gun) {
            const g = blGunGen(15, {type:'rifle'});
            g.ammoMag = g.mag; g.ammoRes = g.reserve; g.uid = 'smoke_rifle';
            Raid.player.gun = g;
        }
    }""")
    before = page.evaluate("""() => ({
        hp: Raid.player.hp, x: Raid.player.x, y: Raid.player.y,
        ammo: Raid.player.gun ? Raid.player.gun.ammoMag : null,
        elapsed: Raid.elapsed, ops: Raid.ops.length,
        aliveAI: Raid.ops.filter(o => !o.isPlayer && o.alive).length
    })""")
    page.mouse.move(900, 300)
    page.mouse.down()
    page.keyboard.down("KeyD")
    page.wait_for_timeout(1600)
    page.keyboard.up("KeyD")
    page.keyboard.down("KeyW")
    page.wait_for_timeout(1400)
    page.keyboard.up("KeyW")
    page.mouse.up()
    after = page.evaluate("""() => ({
        hp: Raid.player.hp, x: Raid.player.x, y: Raid.player.y,
        ammo: Raid.player.gun ? Raid.player.gun.ammoMag : null,
        elapsed: Raid.elapsed, ops: Raid.ops.length,
        aliveAI: Raid.ops.filter(o => !o.isPlayer && o.alive).length,
        tracers: Raid.tracers.length, particles: Raid.particles.length, floats: Raid.floats.length
    })""")
    report["snapshots"]["play"] = {"before": before, "after": after}
    check("主循环持续推进（elapsed 增长）", after["elapsed"] > before["elapsed"] + 1.0,
          "%.2f -> %.2f" % (before["elapsed"], after["elapsed"]))
    check("WASD 移动生效", abs(after["x"] - before["x"]) + abs(after["y"] - before["y"]) > 20,
          "位移 %.0f,%.0f" % (after["x"] - before["x"], after["y"] - before["y"]))
    if before["ammo"] is not None:
        check("鼠标按住能开火（弹匣消耗）", after["ammo"] < before["ammo"] or after["ammo"] == 0,
              "弹药 %s -> %s" % (before["ammo"], after["ammo"]))
    check("3 秒实机无 JS 异常", len(report["page_errors"]) == 0,
          ("pageerror: " + "; ".join(report["page_errors"][:2])) if report["page_errors"] else "0")
    shot(page, "04-play")

    print("\n=== D. 逐元素实机验证（冻结 AI 更新以保证可复现） ===", flush=True)
    setup = """(elem) => {
        // 保存原实现，测试结束后还原；冻结 AI 行为，只保留伤害/状态管线
        if (!window.__origBotsUpdate) window.__origBotsUpdate = Raid._botsUpdate;
        if (!window.__origRayWall) window.__origRayWall = Raid._rayWall;
        Raid._botsUpdate = () => {};
        Raid._rayWall = () => null;               // 隔离地形遮挡，保证射线一定打到目标
        const p = Raid.player;
        const g = blGunGen(24, {type:'rifle', element:elem});
        // 固定数值，避免随机词缀/射速让断言不稳定（只测机制，不测掉落随机性）
        g.dmg = 100; g.rpm = 600; g.spread = 0; g.range = 800; g.pellets = 1; g.splash = 0;
        g.ammoMag = 9999; g.ammoRes = 9999; g.uid = 'smoke_' + elem;
        p.gun = g; p.fireCd = 0; p.reloadT = 0;
        // 记录整个 burst 的飘字（普通 floats 只有 0.9s 寿命，会被刷掉）
        if (!window.__origFloat) window.__origFloat = Raid._float;
        window.__smokeFloatLog = [];
        Raid._float = function(x,y,t,c){ window.__smokeFloatLog.push(String(t)); return window.__origFloat.call(this,x,y,t,c); };
        const bots = Raid.ops.filter(o => !o.isPlayer && !o.remote && o.alive);
        // 其余 AI 全部挪远，避免挡在弹道上抢命中
        for (let i = 3; i < bots.length; i++) { bots[i].x = p.x + 4000; bots[i].y = p.y + 4000; }
        const b = bots[0];
        b.x = p.x + 150; b.y = p.y;
        b.hp = 100000; b.maxHP = 100000;
        b.armorTier = 6; b.armor = 60; b.maxArmor = 60; b.dr = 0;
        b.helmetArmor = 0; b.helmetDr = 0; b.shield = 0; b.maxShield = 0; b.armorBroken = false;
        b.freezeT = 0; b.burnT = 0; b.burnDps = 0; b.corrodeT = 0; b.shockT = 0; b.radT = 0;
        b.speed = 0; b._elemTipT = -99; b._armorTipT = -99;
        // 第二、三个目标放在辐射连锁半径内（但不在弹道上）
        for (let j = 1; j <= 2; j++) {
            const q = bots[j];
            if (!q) continue;
            q.x = p.x + 210 + (j - 1) * 20; q.y = p.y + (j === 1 ? 60 : -60);
            q.hp = 100000; q.maxHP = 100000; q.armor = 0; q.dr = 0; q.helmetDr = 0; q.helmetArmor = 0;
            q.shield = 0; q.maxShield = 0;
            q.burnT = 0; q.burnDps = 0; q.corrodeT = 0; q.shockT = 0; q.freezeT = 0; q.radT = 0;
            q.alive = true;
        }
        window.__smokeBot = b.id;
        window.__smokeNear = bots[1] ? bots[1].id : null;
        window.__smokeGun = { dmg: g.dmg, rpm: g.rpm, range: g.range, element: g.element, name: g.name };
        // raid 模式必须用 Raid.camera 换算屏幕坐标（_screenToWorld 的逆运算）
        const z = game.zoom || 1;
        const s = { x: (b.x - Raid.camera.x) * z, y: (b.y - Raid.camera.y) * z };
        return { botId: b.id, screen: [s.x, s.y], gun: window.__smokeGun };
    }"""
    probe = """() => {
        const b = Raid.ops.find(o => o.id === window.__smokeBot);
        const n = window.__smokeNear ? Raid.ops.find(o => o.id === window.__smokeNear) : null;
        return {
            hp: b.hp, armor: b.armor, type: raidArmorType(b),
            burnT: +(b.burnT||0).toFixed(2), burnDps: +(b.burnDps||0).toFixed(2),
            corrodeT: +(b.corrodeT||0).toFixed(2), shockT: +(b.shockT||0).toFixed(2),
            freezeT: +(b.freezeT||0).toFixed(2), radT: +(b.radT||0).toFixed(2),
            nearHp: n ? n.hp : null,
            ammo: Raid.player.gun ? Raid.player.gun.ammoMag : null,
            angle: +Raid.player.angle.toFixed(2),
            floats: (window.__smokeFloatLog || []).slice(-12),
            sawBreak: (window.__smokeFloatLog || []).some(t => t.indexOf('护甲击穿') >= 0)
        };
    }"""

    def fire_burst(elem, ms=700):
        info = page.evaluate(setup, elem)
        page.mouse.move(info["screen"][0], info["screen"][1])
        page.mouse.down()
        page.wait_for_timeout(ms)
        page.mouse.up()
        return info, page.evaluate(probe)

    # 火焰：灼烧 DOT 应在停火后继续掉血
    gi, s1 = fire_burst("fire", 600)
    hpA = s1["hp"]
    page.wait_for_timeout(900)
    s1b = page.evaluate(probe)
    check("火焰：命中挂上灼烧", s1["burnT"] > 0 and s1["burnDps"] > 0,
          "burnT=%s burnDps=%s" % (s1["burnT"], s1["burnDps"]))
    check("火焰：停火后 DOT 继续掉血", s1b["hp"] < hpA, "HP %.0f -> %.0f" % (hpA, s1b["hp"]))
    report["snapshots"]["fire"] = {"gun": gi["gun"], "hit": s1, "afterDot": s1b}

    # 腐蚀：60 点护甲被啃穿，类型从 armor 回退 flesh
    gi, s2 = fire_burst("corrosive", 900)
    check("腐蚀：啃掉护甲耐久", s2["armor"] < 60, "armor 60 -> %s" % s2["armor"])
    check("改2：护甲打穿后实机类型变回血肉", s2["type"] == "flesh",
          "type=%s, armor=%s" % (s2["type"], s2["armor"]))
    check("腐蚀：挂上破甲 debuff", s2["corrodeT"] > 0, "corrodeT=%s" % s2["corrodeT"])
    check("实机出现「护甲击穿」提示", s2["sawBreak"], s2["floats"][-3:])
    report["snapshots"]["corrosive"] = {"gun": gi["gun"], "hit": s2}

    # 冰冻：freezeT + 视觉粒子
    gi, s3 = fire_burst("cryo", 600)
    check("冰冻：实机叠加冻结", s3["freezeT"] > 0, "freezeT=%s" % s3["freezeT"])
    report["snapshots"]["cryo"] = {"gun": gi["gun"], "hit": s3}

    # 电击：干扰状态
    gi, s4 = fire_burst("shock", 600)
    check("电击：实机挂上电磁干扰", s4["shockT"] > 0, "shockT=%s" % s4["shockT"])
    report["snapshots"]["shock"] = {"gun": gi["gun"], "hit": s4}

    # 辐射：连锁到附近目标
    gi, s5 = fire_burst("radiation", 700)
    check("辐射：附近目标吃到连锁伤害", s5["nearHp"] is not None and s5["nearHp"] < 100000,
          "nearHp=%s" % s5["nearHp"])
    check("辐射：命中挂上辐射标记", s5["radT"] > 0, "radT=%s" % s5["radT"])
    report["snapshots"]["radiation"] = {"gun": gi["gun"], "hit": s5}

    # 爆炸：普通子弹也要有范围溅射（原来只有火箭筒有）
    gi, s6 = fire_burst("explosive", 700)
    check("爆炸：普通子弹产生范围溅射", s6["nearHp"] is not None and s6["nearHp"] < 100000,
          "nearHp=%s" % s6["nearHp"])
    report["snapshots"]["explosive"] = {"gun": gi["gun"], "hit": s6}
    shot(page, "05-elements")

    print("\n=== E. 帧稳定性 / 错误汇总 ===", flush=True)
    page.evaluate("""() => {
        Raid._botsUpdate = window.__origBotsUpdate;
        Raid._rayWall = window.__origRayWall;
        if (window.__origFloat) Raid._float = window.__origFloat;
    }""")
    page.wait_for_timeout(800)
    final = page.evaluate("""() => ({
        state: game.state, elapsed: Raid.elapsed, hp: Raid.player.hp,
        ops: Raid.ops.length, aliveAI: Raid.ops.filter(o => !o.isPlayer && o.alive).length,
        floats: Raid.floats.length, particles: Raid.particles.length
    })""")
    report["snapshots"]["final"] = final
    check("全程无未捕获异常", len(report["page_errors"]) == 0,
          "; ".join(report["page_errors"][:3]) if report["page_errors"] else "0")
    check("全程无 console.error", len(report["console_errors"]) == 0,
          "; ".join(report["console_errors"][:3]) if report["console_errors"] else "0")
    check("游戏仍处于 playing", final["state"] == "playing", json.dumps(final, ensure_ascii=False))

    browser.close()

passed = sum(1 for c in report["checks"] if c["ok"])
failed = len(report["checks"]) - passed
report["summary"] = {"passed": passed, "failed": failed}
with open(os.path.join(ROOT, "test-report.json"), "w", encoding="utf-8") as f:
    json.dump(report, f, ensure_ascii=False, indent=2)
print("\n=== RESULT: %d passed, %d failed ===" % (passed, failed), flush=True)
print("截图目录: " + SHOTS, flush=True)
sys.exit(1 if failed else 0)
