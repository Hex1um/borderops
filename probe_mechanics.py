"""只读机制体检：进图后统计元素 / 护盾 / 溅射 / 护甲自愈等字段的真实分布。"""
import json
import os
from playwright.sync_api import sync_playwright

BASE = os.environ.get("BO_BASE", "http://127.0.0.1:3211/")
EDGE = os.environ.get("BO_EDGE", r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe")
ROOT = os.path.dirname(os.path.abspath(__file__))

JS = """() => {
  const ops = Raid.ops.filter(o => !o.isPlayer && !o.remote);
  const tally = (f) => ops.reduce((a,o)=>{ const k=f(o); a[k]=(a[k]||0)+1; return a; },{});
  const gunElem = tally(o => o.gun ? (o.gun.element||'none') : 'no-gun');
  const withSplash = ops.filter(o => o.gun && (o.gun.splash||0)>0).length;
  const withShield = ops.filter(o => (o.shield||0)>0).length;
  const t4 = ops.filter(o => (o.armorTier||0)>=4);
  const t4regen = t4.filter(o => (o.armorRegen||0)>0).length;
  const regenVals = [...new Set(ops.map(o=>o.armorRegen||0))].sort((a,b)=>a-b);
  const stashRegen = (RaidStash.load().armors||[]).map(a=>({tier:a.tier, regen:a.armorRegen||0, maxArmor:a.maxArmor}));
  return {
    ops: ops.length,
    typeDist: tally(o => raidArmorType(o)),
    gunElementDist: gunElem,
    gunsWithSplash: withSplash,
    opsWithShield: withShield,
    t4Plus: t4.length, t4WithRegen: t4regen, regenValues: regenVals,
    stashArmors: stashRegen,
    rarityRegen: (typeof RAID_RARITY_REGEN!=='undefined') ? RAID_RARITY_REGEN : null,
    elementConfig: Object.keys(ELEMENTS).map(k=>({id:k,dot:ELEMENTS[k].dot,strong:ELEMENTS[k].strong})),
    medItems: (typeof RAID_MEDS!=='undefined') ? Object.keys(RAID_MEDS) : null
  };
}"""

with sync_playwright() as pw:
    b = pw.chromium.launch(executable_path=EDGE, headless=True, args=["--no-sandbox"])
    p = b.new_page(viewport={"width": 1280, "height": 800})
    p.goto(BASE, wait_until="load", timeout=40000)
    p.wait_for_function("typeof game !== 'undefined' && game.state==='title'", timeout=20000)
    p.locator('[data-mode="raid"]').click()
    p.wait_for_selector("#btn-raid-start")
    p.locator("#btn-raid-start").click()
    p.wait_for_function("typeof Raid!=='undefined' && Raid.active===true", timeout=20000)
    p.wait_for_timeout(400)
    data = p.evaluate(JS)
    b.close()

print(json.dumps(data, ensure_ascii=False, indent=2))
with open(os.path.join(ROOT, "mechanics-probe.json"), "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, indent=2)
