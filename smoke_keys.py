"""v0.13.8 钥匙 / 上锁保险箱冒烟测试
覆盖：5 级保险箱分布、钥匙门槛（没钥匙开不了 / 有钥匙能开且扣次数）、
      保险箱掉落品质随等级提升、商店售卖钥匙、钥匙不可合成（v0.14.5）、无控制台报错。
"""
from playwright.sync_api import sync_playwright
import json

URL = "http://localhost:8132/index.html?nocache=1"

JS = r"""
() => {
  const out={steps:[], ok:true, err:null};
  const R=Raid;
  // ① 多局地图：保险箱等级分布
  const dist={}, lockedCounts=[];
  for(let k=0;k<14;k++){
    RNG.setSeed(4200+k*911);
    R._buildMap(); R.containers=[]; R._spawnContainers();
    const lk=R.containers.filter(c=>c.locked);
    lockedCounts.push(lk.length);
    for(const c of lk) dist[c.lockLv]=(dist[c.lockLv]||0)+1;
  }
  out.lockDist=dist;
  out.lockedCounts=lockedCounts;
  out.allFiveLevels = !!dist[1]&&!!dist[2]&&!!dist[3]&&!!dist[4]&&!!dist[5];

  // ② 钥匙门槛：清空钥匙 → 不能开；给一把 II 级 → 能开 I/II 级箱
  R.inv.keys=[];
  R.lootLuck=0.2;
  // v0.14.2：V 级改为 20% 随机、可能整局没有 —— 找不到时临时放一个同级的箱子
  const mk=(lv)=>{
    for(let s=0;s<16;s++){
      RNG.setSeed(7000+lv+s*97); R._buildMap(); R.containers=[]; R._spawnContainers();
      const c=R.containers.find(x=>x.locked && x.lockLv===lv && !x.damLoot);
      if(c) return c;
    }
    const c={ x:R.player.x+70, y:R.player.y, tier:2, locked:true, lockLv:lv,
              kind:"weapon", searched:false, drop:null };
    R.containers.push(c); return c;
  };
  const c1=mk(1), c3=mk(3);
  out.hasKeyBefore = R._hasKeyFor(1);
  out.key2 = (R.inv.keys.push(raidMakeKey(2)), R.inv.keys[0]);
  out.canOpenLv1 = R._hasKeyFor(1);
  out.canOpenLv3 = R._hasKeyFor(3);     // II 级钥匙开不了 III 级箱
  out.bestKeyFor5 = R._bestKeyFor(5);

  // ③ 开箱：扣钥匙次数 + 出货
  const before = R.inv.keys[0].uses;
  R.player.x=c1.x; R.player.y=c1.y;
  R.search={ c:c1, t:0 };
  let guard=0;
  while(R.search && guard<400){ R._searchUpdate(1/60); guard++; }
  out.searchDone = !R.search && c1.searched;
  out.keyUsesBefore=before; out.keyUsesAfter=(R.inv.keys[0]||{}).uses;
  out.gotAfterOpen = { weapons:R.inv.weapons.length, armors:R.inv.armors.length,
    helmets:R.inv.helmets.length, parts:R.inv.parts.length, mats:R.inv.materials.length,
    keys:R.inv.keys.length, creds:R.creds };

  // ④ 保险箱掉落品质：I 级 vs V 级（各 300 次，看平均档位）
  const tierOf=(it)=> it.kind==="weapon" ? (it.qTier||0)
    : it.kind==="material" ? (it.tier||0)
    : it.kind==="armor" || it.kind==="helmet" ? (it.tier||0)
    : it.kind==="part" ? (RARITIES.findIndex(r=>r.id===it.rarity)) : 0;
  const avg=(lv)=>{
    let s=0,n=0;
    for(let i=0;i<300;i++){ const it=R._rollVaultLoot(lv); s+=tierOf(it); n++; }
    return s/n;
  };
  R.lootLuck=0.2;
  out.avgTier = { lv1:+avg(1).toFixed(2), lv3:+avg(3).toFixed(2), lv5:+avg(5).toFixed(2) };
  out.betterWithLevel = out.avgTier.lv5 > out.avgTier.lv3 && out.avgTier.lv3 > out.avgTier.lv1;

  // ⑤ 商店钥匙库存
  const sMat=R.shops.find(s=>s.kind==="mat"), sBlack=R.shops.find(s=>s.kind==="black");
  out.matKeys=(sMat.stock.keys||[]).map(k=>({lv:k.lv,price:k.shopPrice,uses:k.uses}));
  out.blackKeys=(sBlack.stock.keys||[]).map(k=>({lv:k.lv,token:k.tokenPrice}));

  // ⑦ 交互门槛：站在 III 级箱前、只有 I 级钥匙 → 不能开始搜索
  R.inv.keys=[raidMakeKey(1)];
  R.search=null; R.shopOpen=null;
  R.player.x=c3.x; R.player.y=c3.y+18;
  const act={switch:false,slot:0,reload:false,med:false,interact:true,ability:false};
  R._playerControl(1/60, game, act);
  out.blockedByKey = (R.search===null || R.search.c!==c3);
  // 换成 III 级钥匙 → 可以开始
  R.inv.keys=[raidMakeKey(3)];
  R._playerControl(1/60, game, act);
  out.openedWithKey = !!(R.search && R.search.c===c3);
  R.search=null;

  // ⑧ 分档校验：钥匙等级上限 / 名称
  out.keyDefs=RAID_KEYS.map(k=>({lv:k.lv,name:k.name,uses:k.uses,shop:k.shop,token:k.token}));
  out.keyCraftExists=(typeof RAID_KEY_CRAFT!=="undefined");   // v0.14.5：钥匙合成表已移除
  out.boxKeyOk=(()=>{ let bad=0; for(const c of R.containers.filter(x=>x.locked)){
      const cap=Math.min(5,(c.lockLv||1)+1);
      for(let i=0;i<40;i++){ if(raidRollBoxKey(c.lockLv||1).lv>cap) bad++; }
    } return bad===0; })();

  return out;
}
"""

JS2 = r"""
() => {
  const out={};
  const st=RaidStash.load();
  st.creds=900000; st.keys=[]; st.materials=[];
  for(let i=0;i<12;i++){
    const m=raidMakeMaterial(0.9);
    m.tier=8; m.value=50000;
    st.materials.push(m);
  }
  RaidStash.save(st);
  UI.raidWorkshop({from:'title'});
  out.keysynthBtns=document.querySelectorAll('[data-keysynth]').length;
  out.coresynthBtns=document.querySelectorAll('[data-coresynth]').length;
  out.coreupBtns=document.querySelectorAll('[data-coreup]').length;
  out.buyOnlyHint=document.body.innerText.indexOf('不可合成')>=0;
  const st2=RaidStash.load();
  out.keysAfter=(st2.keys||[]).length;
  out.matsLeft=(st2.materials||[]).length;
  out.credsLeft=st2.creds;
  return out;
}
"""

with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": 1280, "height": 800})
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(URL, wait_until="load")
    pg.wait_for_timeout(1400)
    pg.click('[data-mode="raid"]')
    pg.wait_for_timeout(500)
    pg.click('#btn-raid-start')
    pg.wait_for_timeout(2400)
    res = pg.evaluate(JS)
    print(json.dumps(res, ensure_ascii=False, indent=1))
    print("PAGE ERRORS:", errs[:3] if errs else "none")

    # 工坊钥匙合成（独立页面，走 UI 真实点击）
    pg2 = b.new_page(viewport={"width": 1280, "height": 900})
    errs2 = []
    pg2.on("pageerror", lambda e: errs2.append(str(e)))
    pg2.goto(URL, wait_until="load")
    pg2.wait_for_timeout(1400)
    res2 = pg2.evaluate(JS2)
    print("WORKSHOP CRAFT:", json.dumps(res2, ensure_ascii=False))
    print("WORKSHOP ERRORS:", errs2[:3] if errs2 else "none")
    b.close()
