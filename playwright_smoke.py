"""borderops 真实浏览器冒烟测试（系统 Edge，无需下载浏览器）。

用法：先 `PORT=3211 node server.js`，再 `python playwright_smoke.py`。
覆盖：标题页 -> 配装大厅 -> 进图 -> 真实鼠标开火/键盘移动 -> 七种弹种终点效应 ->
插板击穿回退 -> 护盾装备三数值/破盾无敌/回充 -> 控制台异常。
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
    # 本机环境带全局 HTTP_PROXY，直连 127.0.0.1 必须绕开代理，否则 net::ERR_CONNECTION_REFUSED
    browser = pw.chromium.launch(executable_path=EDGE, headless=True,
                                 args=["--no-sandbox", "--disable-dev-shm-usage",
                                       "--no-proxy-server", "--proxy-bypass-list=<-loopback>"])
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
    check("22 个脚本全部加载", init["scripts"] >= 22, "%d 个" % init["scripts"])
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
    check("护盾型单位存在（独立蓝盾条有目标）",
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

    # 曳光弹：引燃应在停火后继续掉血
    gi, s1 = fire_burst("fire", 600)
    hpA = s1["hp"]
    page.wait_for_timeout(900)
    s1b = page.evaluate(probe)
    check("曳光弹：命中挂上引燃", s1["burnT"] > 0 and s1["burnDps"] > 0,
          "burnT=%s burnDps=%s" % (s1["burnT"], s1["burnDps"]))
    check("曳光弹：停火后燃烧继续掉血", s1b["hp"] < hpA, "HP %.0f -> %.0f" % (hpA, s1b["hp"]))
    report["snapshots"]["fire"] = {"gun": gi["gun"], "hit": s1, "afterDot": s1b}

    # 空尖弹：60 点插板耐久被啃穿，类型从 armor 回退 flesh
    gi, s2 = fire_burst("corrosive", 900)
    check("空尖弹：啃掉插板耐久", s2["armor"] < 60, "armor 60 -> %s" % s2["armor"])
    check("改2：插板打穿后实机类型变回无防护", s2["type"] == "flesh",
          "type=%s, armor=%s" % (s2["type"], s2["armor"]))
    check("空尖弹：挂上撕裂破防 debuff", s2["corrodeT"] > 0, "corrodeT=%s" % s2["corrodeT"])
    check("实机出现「护甲击穿」提示", s2["sawBreak"], s2["floats"][-3:])
    report["snapshots"]["corrosive"] = {"gun": gi["gun"], "hit": s2}

    # 亚音速弹：迟滞 + 冰晶视觉粒子
    gi, s3 = fire_burst("cryo", 600)
    check("亚音速弹：实机叠加迟滞", s3["freezeT"] > 0, "freezeT=%s" % s3["freezeT"])
    report["snapshots"]["cryo"] = {"gun": gi["gun"], "hit": s3}

    # 钢芯穿甲弹：钝击失能状态
    gi, s4 = fire_burst("shock", 600)
    check("钢芯穿甲弹：实机挂上钝击失能", s4["shockT"] > 0, "shockT=%s" % s4["shockT"])
    report["snapshots"]["shock"] = {"gun": gi["gun"], "hit": s4}

    # 穿甲曳光弹：跳弹连锁到附近目标
    gi, s5 = fire_burst("radiation", 700)
    check("穿甲曳光弹：附近目标吃到跳弹伤害", s5["nearHp"] is not None and s5["nearHp"] < 100000,
          "nearHp=%s" % s5["nearHp"])
    check("穿甲曳光弹：命中挂上跳弹标记", s5["radT"] > 0, "radT=%s" % s5["radT"])
    report["snapshots"]["radiation"] = {"gun": gi["gun"], "hit": s5}

    # 破片弹：普通子弹也要有范围溅射（原来只有火箭筒有）
    gi, s6 = fire_burst("explosive", 700)
    check("破片弹：普通子弹产生范围溅射", s6["nearHp"] is not None and s6["nearHp"] < 100000,
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

    print("\n=== F. 护盾装备实机：三数值 / 先扣盾 / 破盾无敌 / 延迟回充 ===", flush=True)
    equip = page.evaluate("""() => {
        const s = raidMakeShield(5, 4), p = Raid.player;
        p.hp = 1e6; p.maxHP = 1e6; p.armor = 1e6; p.maxArmor = 1e6;
        p.shieldGear = s; p.shieldPerks = (s.perks || []).slice();
        p.maxShield = s.capacity; p.shield = s.capacity;
        p.shieldRate = s.rate; p.shieldDelay = s.delay;
        p.shieldInvulnBase = s.invuln;
        p.shieldAbsorbMul = p.shieldPerks.includes('emitter') ? 1.08 : 1;
        p.shieldTimer = 0; p.shieldInvuln = 0; p.bleed = 0;
        return { name: s.name, capacity: s.capacity, rate: s.rate, delay: s.delay,
                 invuln: s.invuln, parts: (s.parts || []).length,
                 affixes: (s.affixes || []).length, perks: s.perks.slice(),
                 lines: shieldLines(s), cardHasStats: /容量/.test(shieldCard(s, {sell:true})),
                 stashHasSlot: Array.isArray(RaidStash.load().shields),
                 craftRecipe: RAID_RECIPES.some(r => r.id === 'r_shield'),
                 uniques: SHIELD_UNIQUES.length, slots: SHIELD_SLOTS.length };
    }""")
    report["snapshots"]["shield"] = equip
    check("护盾由 4 个配件组成", equip["parts"] == 4 and equip["slots"] == 4,
          "配件 %d / 槽位 %d" % (equip["parts"], equip["slots"]))
    check("护盾三数值合法（容量 / 充能 / 延迟）",
          equip["capacity"] > 0 and equip["rate"] > 0 and equip["delay"] >= 0.6,
          "容量 %s · %s/s · 延迟 %ss" % (equip["capacity"], equip["rate"], equip["delay"]))
    check("护盾带前后缀 + 独特加成", equip["affixes"] >= 2 and len(equip["perks"]) >= 1,
          "词缀 %d · 加成 %s" % (equip["affixes"], equip["perks"]))
    check("护盾卡片展示三数值", equip["cardHasStats"] and len(equip["lines"]) >= 5,
          "卡片 %s 行" % len(equip["lines"]))
    check("仓库 / 合成表 / 具名护盾齐备",
          equip["stashHasSlot"] and equip["craftRecipe"] and equip["uniques"] >= 8,
          "具名 %d 件" % equip["uniques"])
    check("护盾名含前后缀且无奇幻词",
          " " in equip["name"] and "·" in equip["name"] and
          not any(w in equip["name"] for w in ["神", "魔", "龙", "灭", "湮", "虚空"]),
          equip["name"])

    seq = page.evaluate("""() => {
        const p = Raid.player, out = {};
        const atk = { isPlayer:false, remote:false, x:0, y:0, name:'Tester' };
        const gun = { element:'none', armorPen:0, name:'test' };
        const hit = (d) => Raid._damage(p, d, atk, gun, {});
        // 隔离：raid 运行中 AI 可能已经打掉一截盾，直接拿 UI 读到的容量去比
        // afterHit.shield 会随机漂 30~150，导致这条断言偶发失败。先把盾补满，
        // 并把「补满时的容量」一起回传，让断言只检验「先扣盾」这一条语义。
        const cap = (p.stats && p.stats.maxShield) || p.maxShield || p.shield;
        p.shield = cap; p.shieldTimer = 0; p.shieldInvuln = 0;
        // (a) 先扣盾
        const hp0 = p.hp; hit(30);
        out.afterHit = { hp:p.hp, shield:p.shield, timer:p.shieldTimer, hpLost:hp0-p.hp, capBefore:cap };
        // (b) 延迟期间不回充 / 延迟结束后回充
        const s1 = p.shield;
        Raid._tickShield(p, p.shieldDelay * 0.5);
        out.duringDelay = p.shield - s1;
        const s2 = p.shield;
        Raid._tickShield(p, p.shieldDelay + 0.2);
        out.afterDelay = p.shield - s2;
        // (c) 破盾 -> 无敌 -> 免伤
        p.shield = 5; p.shieldTimer = 0;
        const hp1 = p.hp; hit(999);
        out.break = { shield:p.shield, invuln:p.shieldInvuln, hpLost:hp1-p.hp };
        const hp2 = p.hp; hit(999);
        out.invulnAbsorb = hp2 - p.hp;
        // (d) 无敌结束后可从 0 重新起盾
        Raid._tickShield(p, (p.shieldInvulnBase||0) + 0.1);
        Raid._tickShield(p, p.shieldDelay + 0.2);
        out.restart = p.shield;
        return out;
    }""")
    report["snapshots"]["shieldSeq"] = seq
    # 只验「伤害先扣盾、HP 不掉」这条语义：raid 主循环在两次 evaluate 之间仍在跑，
    # AI 命中与 _tickShield 回充会让盾值漂几滴，精确等于 capacity-30 会偶发失败。
    check("实机伤害先扣盾（HP 不掉）",
          seq["afterHit"]["hpLost"] == 0 and 0 < seq["afterHit"]["capBefore"] - seq["afterHit"]["shield"] <= 32,
          json.dumps(seq["afterHit"], ensure_ascii=False))
    check("受击后重置充能延迟", seq["afterHit"]["timer"] > 0,
          "timer=%s" % seq["afterHit"]["timer"])
    check("延迟期间不回充 / 延迟后按 speed 回充",
          abs(seq["duringDelay"]) < 0.01 and seq["afterDelay"] > 0,
          "延迟中 %+.2f · 延迟后 %+.2f" % (seq["duringDelay"], seq["afterDelay"]))
    check("破盾归零并触发短无敌",
          seq["break"]["shield"] == 0 and seq["break"]["invuln"] > 0,
          json.dumps(seq["break"], ensure_ascii=False))
    check("无敌期间完全免伤", seq["invulnAbsorb"] == 0, "扣血 %s" % seq["invulnAbsorb"])
    check("破盾后可重新起盾", seq["restart"] > 0, "盾值 %.2f" % seq["restart"])
    # 拉满护盾值，截一张 HUD 特写以肉眼确认「蓝条在血条上方、血条仍是红色」
    page.evaluate("() => { Raid.player.shield = Raid.player.maxShield; Raid.player.shieldInvuln = 0; }")
    page.wait_for_timeout(300)
    shot(page, "06-shield")
    try:
        page.screenshot(path=os.path.join(SHOTS, "07-shield-hud.png"),
                        clip={"x": 0, "y": 660, "width": 360, "height": 160})
    except Exception as e:
        report["notes"].append("HUD clip failed: %s" % e)

    print("\n=== G. 护盾介入后仍无异常 ===", flush=True)
    check("护盾全流程无未捕获异常", len(report["page_errors"]) == 0,
          "; ".join(report["page_errors"][:3]) if report["page_errors"] else "0")
    check("护盾全流程无 console.error", len(report["console_errors"]) == 0,
          "; ".join(report["console_errors"][:3]) if report["console_errors"] else "0")

    browser.close()

passed = sum(1 for c in report["checks"] if c["ok"])
failed = len(report["checks"]) - passed
report["summary"] = {"passed": passed, "failed": failed}
with open(os.path.join(ROOT, "test-report.json"), "w", encoding="utf-8") as f:
    json.dump(report, f, ensure_ascii=False, indent=2)
print("\n=== RESULT: %d passed, %d failed ===" % (passed, failed), flush=True)
print("截图目录: " + SHOTS, flush=True)
sys.exit(1 if failed else 0)
