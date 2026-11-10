/* =========================================================================
 * raid-ui2.js — 融合台 / 工坊 / 仓库 / 联机大厅 UI 补丁（第 2 段）
 * v0.22.0：由 raid.js 按自然边界物理拆分，逻辑零改写。经典脚本按 index.html 顺序加载，
 * 共享同一全局词法作用域。verify 的 raidSrc 会聚合全部 raid-*.js 做源码断言。
 * ========================================================================= */

/* =========================================================================
 *，局内商店（枪械商店 / 材料商店 / 回收超市 / 黑市）
 *   走进摊位按 E 打开；游戏不暂停（硬核：谈生意也得看后背）。
 *  ，前两家用「局内卢布」（撤离才结算，死了就白花）
 *  ，黑市用「GP 币」——本局首杀必得 1 枚，之后靠上锁箱 / Raider 掉落与撤离结算，专门换高级武器
 *  ，回收超市收购价 1.2 ± 0.4，高于背包直售 0.5：想卖好价就得活着把货带进图
 * ========================================================================= */
/* v0.35.1（用户反馈 #9）：局内每个摊位都加「每日特价」—— 与军火超市同一套确定性逻辑：
   小时桶 + 摊位类型 + 已买次数 → FNV 种子 → RNG 重放；买走 seq+1 换下一件。
   生成前后恢复 RNG 原闭包，绝不打乱游戏内随机序列（联机两端靠同种子推进）。
   枪 / 材料 / 回收 = 卢布；黑市 = GP 币。各摊位只出自己卖的东西。 */
UI._fieldDealCache={};
UI._fieldDailyDeal=function(kind){
  const bucket=raidDealBucket();
  const st=RaidStash.load();
  const rec=(st.fieldDeals && st.fieldDeals[kind])||null;
  const seq=(rec && rec.hour===bucket)?(rec.seq|0):0;
  const key=kind+"|"+bucket+"|"+seq;
  const cache=UI._fieldDealCache;
  if(cache && cache.key===key) return cache.deal;
  const saved=RNG.rng;
  let deal=null;
  try{
    RNG.setSeed(raidDealSeed("field-"+kind, bucket, seq));
    if(kind==="gun"){
      const type=RNG.pick(["rifle","sniper","smg","shotgun"]);
      const qt=4+RNG.ri(0,1);                       // 精工 / 特种（保证局内买得起）
      const g=blGunGen(20,{type, rarity:RAID_TIER_TO_RARITY[qt]});
      ensureGunAffixes(g); g.uid=raidUniqueUid("fdeal-gun-"); g.kind="weapon";
      g.qTier=qt; g.qName=RAID_TIERS[qt].name; g.qColor=RAID_TIERS[qt].color;
      deal={ kind, pay:"cash", bucket:"weapons", item:g, col:raidGunColor(g),
        name:gunNameOf(g), seq,
        meta:(WEAPON_TYPES[type]?WEAPON_TYPES[type].name:type)+"，"+RAID_TIERS[qt].name,
        stats:`${gunDamageLabel(g)}，弹匣 ${g.mag}，穿甲 ${Math.round((g.armorPen||0)*100)}%`,
        price:Math.max(1,Math.round(raidShopPrice(g.value||1000, g.uid)*0.7)) };
    } else if(kind==="mat"||kind==="rec"){
      // 当日特供给高档材料（T4+），别拿脏布条糊弄
      const pool=RAID_MATERIALS.filter(x=>x.tier>=4);
      const pickPool=pool.length?pool:RAID_MATERIALS;
      const m=Object.assign({}, pickPool[RNG.ri(0,pickPool.length-1)]);
      const n=2;
      deal={ kind, pay:"cash", bucket:"materials", item:m, n,
        col:m.color||"#dfe7f0", name:m.name+" ×"+n, seq,
        meta:"原材料，T"+(m.tier||0), stats:"当日特供原材料，带出仓库可再合成",
        price:Math.max(1,Math.round(raidShopPrice((m.value||10)*n, m.id)*0.7)) };
    } else {                                         // black
      const t=8;                                     // 定型（旧编号 T8 = 第 9 阶）
      const k=RNG.ri(0,2);
      let it,bucket2,col;
      if(k===0){ it=raidMakeArmor(t,t);  bucket2="armors";  col=ARMOR_TIER_COLOR[t]||"#ffd23f"; }
      else if(k===1){ it=raidMakeHelmet(t,t); bucket2="helmets"; col=ARMOR_TIER_COLOR[t]||"#ffd23f"; }
      else { it=raidMakeShield(t,t); bucket2="shields"; col="#4fd6ff"; }
      it.qTier=t; it.qName=RAID_TIERS[t].name; it.qColor=RAID_TIERS[t].color;
      const TOKEN_PRICE={ 5:45, 6:85, 7:160, 8:300 };   // 与黑市正价档一致，特价再打 8 折
      deal={ kind, pay:"token", bucket:bucket2, item:it, col, seq,
        name:it.name,
        meta:(it.kind==="shield"?"护盾":it.kind==="helmet"?"头盔":"护甲")+"，T"+t+" "+RAID_TIERS[t].name,
        stats:(it.kind==="shield"?`容量 ${it.capacity||0}，充能 ${it.rate||0}/s`
                                :`耐久 ${it.maxArmor||0}，减伤 ${Math.round((it.dr||0)*100)}%`),
        price:Math.max(8,Math.round((TOKEN_PRICE[t]||60)*0.8)) };
    }
  } finally { RNG.rng=saved; }
  if(deal) UI._fieldDealCache={ key, deal };
  return deal;
};

UI.raidFieldShop=function(key){
  const R=Raid;
  // 按**摊位 id** 打开，而不是按类型 —— 地图上有两处材料商店 / 回收超市，
  // 旧写法按 kind 取第一个，等于两家共用一个货架（看起来像「四个商店被合并了」）。
  const sh=(R.shops||[]).find(s=>s.id===key) || (R.shops||[]).find(s=>s.kind===key);
  if(!sh || !R.active) return;
  const kind=sh.kind, sid=sh.id;
  const money=R.creds||0, tokens=R.tokens||0;

  const tagLine={ gun:"GUNS", mat:"MATERIALS", rec:"RECYCLE", black:"BLACK MARKET" }[kind];

  const gunCard=(g, payKind, idx, arr)=>{
    const price = payKind==="token" ? (g.tokenPrice||60) : (g.shopPrice||g.value||0);
    const can = payKind==="token" ? tokens>=price : money>=price;
    const col = raidGunColor(g);
    const tname=(WEAPON_TYPES[g.type]&&WEAPON_TYPES[g.type].name)||g.cat||"武器";
    const qn=weaponQualityHidden() ? "" : ((RAID_TIERS[g.qTier]&&RAID_TIERS[g.qTier].name)||"");
    return `<div class="si">
      <div class="si-name" style="color:${col}">${gunNameOf(g)}</div>
      <div class="si-stats">${tname}${qn?"，"+qn:""}，${gunDamageLabel(g)}，弹匣 ${g.mag}，射速 ${g.rpm}<br>
        配件 ${(g.parts||[]).length} 个，估值 ₽${priceTextShort(g.value||0)}</div>
      <div class="si-buy">
        <span class="si-price ${can?"":"cant"}">${payKind==="token"?"◈":"₽"} ${payKind==="token"?price:priceTextShort(price)}</span>
        <button class="btn ghost" data-fbuy="${payKind}:${sid}:${idx}" ${can?"":"disabled"}>购买</button>
      </div>
    </div>`;
  };

  // 弹药卡：一条 30 发，带口径 / 级别 / 单发穿深
  const ammoCard=(a, payKind, idx)=>{
    const price = payKind==="token" ? (a.tokenPrice||0) : (a.shopPrice||0);
    const can = payKind==="token" ? tokens>=price : money>=price;
    const E=AMMO_TYPES[a.elem]||AMMO_TYPES.none;
    const lvName=(AMMO_GRADE_BY_LV[a.lv]||{}).name||("T"+a.lv);
    const owned=R._ammoCount(a.id);
    return `<div class="si">
      <div class="si-name" style="color:${a.color||"#dfe7f0"}">${a.name} <span style="font-size:11px;opacity:.7">×${a.n}</span></div>
      <div class="si-stats">${a.spec}，${lvName}级，单发估值 ₽${a.value?Math.round(a.value/a.n):0}，穿深 ${E.pen}${owned?"，背包已有 "+owned:""}</div>
      <div class="si-buy">
        <span class="si-price ${can?"":"cant"}">${payKind==="token"?"◈":"₽"} ${payKind==="token"?price:priceTextShort(price)}</span>
        <button class="btn ghost" data-fbuy="${payKind==="token"?"tokenammo":"cashammo"}:${sid}:${idx}" ${can?"":"disabled"}>购买</button>
      </div>
    </div>`;
  };

  // 钥匙卡：开对应等级的上锁保险箱
  const keyCard=(k, payKind, idx)=>{
    const price = payKind==="token" ? (k.tokenPrice||0) : (k.shopPrice||raidKeyDef(k.lv).shop||0);
    const can = payKind==="token" ? tokens>=price : money>=price;
    return `<div class="si">
      <div class="si-name" style="color:${k.color||"#ffd23f"}">${k.name} <span style="font-size:11px;opacity:.75">[${RAID_LOCK_NAME[k.lv]}]</span></div>
      <div class="si-stats">可开 ${RAID_LOCK_NAME[k.lv]} 及以下的保险箱，可用 ${k.uses} 次，估值 ₽${priceTextShort(k.value||0)}</div>
      <div class="si-buy">
        <span class="si-price ${can?"":"cant"}">${payKind==="token"?"◈":"₽"} ${payKind==="token"?price:priceTextShort(price)}</span>
        <button class="btn ghost" data-fbuy="key:${sid}:${idx}" ${can?"":"disabled"}>购买</button>
      </div>
    </div>`;
  };

  /* v0.26.0：黑市高品阶防护装备（护盾 / 护甲 / 头盔），与枪同为 5~8 档 */
  const gearCard=(g, payKind, idx)=>{
    const price = payKind==="token" ? (g.tokenPrice||0) : (g.shopPrice||0);
    const can = payKind==="token" ? tokens>=price : money>=price;
    const kindName = g.kind==="shield" ? "护盾" : g.kind==="helmet" ? "头盔" : "护甲";
    const qn = (RAID_TIERS[g.qTier]&&RAID_TIERS[g.qTier].name)||("T"+g.tier);
    const stat = g.kind==="shield"
      ? `容量 ${g.capacity||0}，充能 ${g.rate||0}/s，延迟 ${g.delay||0}s`
      : `耐久 ${g.maxArmor||0}，减伤 ${Math.round((g.dr||0)*100)}%，T${g.tier}`;
    const col = g.qColor || (g.kind==="shield"?"#4fd6ff":"#ffd23f");
    return `<div class="si">
      <div class="si-name" style="color:${col}">${g.name} <span style="font-size:11px;opacity:.7">[${kindName}，${qn}]</span></div>
      <div class="si-stats">${stat}，估值 ₽${priceTextShort(g.value||0)}</div>
      <div class="si-buy">
        <span class="si-price ${can?"":"cant"}">${payKind==="token"?"◈":"₽"} ${payKind==="token"?price:priceTextShort(price)}</span>
        <button class="btn ghost" data-fbuy="${payKind==="token"?"tokengear":"cashgear"}:${sid}:${idx}" ${can?"":"disabled"}>兑换</button>
      </div>
    </div>`;
  };

  let body="";
  if(kind==="gun"||kind==="black"){
    const payKind = kind==="black" ? "token" : "cash";
    const arr=sh.stock.guns;
    body = arr.length ? arr.map((g,i)=>gunCard(g,payKind,i)).join("")
      : `<div class="empty-hint">货架已空，本局不再补货</div>`;
    if(kind==="black"){
      const parts=sh.stock.parts||[];
      body += parts.length ? `<div class="hint" style="margin:10px 0 6px;grid-column:1/-1;">◈ 高级改装模块（GP 币兑换）</div>` +
        parts.map((c,i)=>{
          const can=tokens>=(c.tokenPrice||10);
          return `<div class="si">
            <div class="si-name" style="color:${c.color||"#c07bff"}">${c.name||raidCoreName(c)}</div>
            <div class="si-stats">等级 ${RAID_ROMAN[c.lv]||c.lv}，${(c.mods||[]).map(m=>`${AFFIX_LABEL[m.stat]||m.stat} +${m.value}`).join("，")||"—"}</div>
            <div class="si-buy"><span class="si-price ${can?"":"cant"}">◈ ${c.tokenPrice||10}</span>
              <button class="btn ghost" data-fbuy="tokenpart:${sid}:${i}" ${can?"":"disabled"}>兑换</button></div>
          </div>`;
        }).join("")
        : "";
      const gears=sh.stock.gears||[];
      if(gears.length) body += `<div class="hint" style="margin:10px 0 6px;grid-column:1/-1;">◈ 高品阶防护装备，5~8 档（GP 币兑换）</div>` +
        gears.map((g,i)=>gearCard(g,"token",i)).join("");
      const bkeys=sh.stock.keys||[];
      if(bkeys.length) body += `<div class="hint" style="margin:10px 0 6px;">◈ 高级钥匙（GP 币兑换，开同级及以下保险箱）</div>` +
        bkeys.map((k,i)=>keyCard(k,"token",i)).join("");
      const bammo=sh.stock.ammo||[];
      if(bammo.length) body += `<div class="hint" style="margin:10px 0 6px;">◈ 高级弹药 T4 / T5（GP 币兑换，一条 30 发）</div>` +
        bammo.map((a,i)=>ammoCard(a,"token",i)).join("");
    } else if(kind==="gun"){
      // 改装模块不可合成 —— 枪械店常备低阶改装模块，卢布直接买
      const parts=sh.stock.parts||[];
      if(parts.length) body += `<div class="hint" style="margin:10px 0 6px;grid-column:1/-1;">▸ 改装模块（卢布购买，不可合成）</div>` +
        parts.map((c,i)=>{
          const can=money>=(c.shopPrice||0);
          const mods=(c.mods||[]).map(m=>`${AFFIX_LABEL[m.stat]||m.stat} +${m.value}`).join("，");
          return `<div class="si">
            <div class="si-name" style="color:${c.color||"#ffd23f"}">${c.name||raidCoreName(c)}</div>
            <div class="si-stats">等级 ${RAID_ROMAN[c.lv]||c.lv}，${mods||(c.core==="chaos"?`改装等级 ${RAID_ROMAN[c.lv]||c.lv}`:"属性增益")}</div>
            <div class="si-buy"><span class="si-price ${can?"":"cant"}">₽ ${priceTextShort(c.shopPrice||0)}</span>
              <button class="btn ghost" data-fbuy="cashpart:${sid}:${i}" ${can?"":"disabled"}>购买</button></div>
          </div>`;
        }).join("");
      const gammo=sh.stock.ammo||[];
      if(gammo.length) body += `<div class="hint" style="margin:10px 0 6px;grid-column:1/-1;">▸ 弹药（一条 30 发，本店枪型口径）</div>` +
        gammo.map((a,i)=>ammoCard(a,"cash",i)).join("");
    }
  } else if(kind==="mat"){
    body = sh.stock.mats.map((m,i)=>{
      const can=money>=(m.shopPrice||0);
      return `<div class="si">
        <div class="si-name" style="color:${m.color||"#dfe7f0"}">${m.name}</div>
        <div class="si-stats">原材料，估值 ₽${priceTextShort(m.value||0)}</div>
        <div class="si-buy"><span class="si-price ${can?"":"cant"}">₽ ${priceTextShort(m.shopPrice||0)}</span>
          <button class="btn ghost" data-fbuy="cashmat:${sid}:${i}" ${can?"":"disabled"}>购买</button></div>
      </div>`;
    }).join("");
    body += sh.stock.parts.map((pt,i)=>{
      const can=money>=(pt.shopPrice||0);
      const col=partColor(pt);
      return `<div class="si">
        <div class="si-name" style="color:${col}">${partNameOf(pt)||(pt.core?"改装模块":pt.slot_name||"配件")}</div>
        <div class="si-stats">配件${partQualityName(pt)?"，"+partQualityName(pt):""}${weaponQualityHidden()?"":"，"+((pt.affixes||[]).map(a=>a.nm).join("，")||"—")}</div>
        <div class="si-buy"><span class="si-price ${can?"":"cant"}">₽ ${priceTextShort(pt.shopPrice||0)}</span>
          <button class="btn ghost" data-fbuy="cashpart:${sid}:${i}" ${can?"":"disabled"}>购买</button></div>
      </div>`;
    }).join("");
    body += sh.stock.meds.map((md,i)=>{
      const can=money>=md.price;
      const nm=(RAID_MED_BY_ID[md.id]||{}).name||md.id;
      return `<div class="si">
        <div class="si-name" style="color:#ff9a9a">${nm} ×${md.n}</div>
        <div class="si-stats">医疗补给，立即生效</div>
        <div class="si-buy"><span class="si-price ${can?"":"cant"}">₽ ${priceTextShort(md.price)}</span>
          <button class="btn ghost" data-fbuy="cashmed:${sid}:${i}" ${can?"":"disabled"}>购买</button></div>
      </div>`;
    }).join("");
    const mammo=sh.stock.ammo||[];
    if(mammo.length) body += `<div class="hint" style="margin:10px 0 6px;grid-column:1/-1;">▸ 弹药（一条 30 发，T1 民用 / T2 制式）</div>` +
      mammo.map((a,i)=>ammoCard(a,"cash",i)).join("");
    const mkeys=sh.stock.keys||[];
    if(mkeys.length) body += `<div class="hint" style="margin:10px 0 6px;grid-column:1/-1;">▸ 钥匙（开对应等级的上锁保险箱，带进图才会生效）</div>` +
      mkeys.map((k,i)=>keyCard(k,"cash",i)).join("");
  } else if(kind==="rec"){
    /* v0.40.0（用户要求）：回收超市改成「收购单」——
       只收指定品类（2~3 类），价格是估价的 2~3 倍，每类有件数上限；
       不在收购单上的东西**根本不出现在面板里**（不再是自由选择）。
       弹药单独走固定的 0.55× 折现（低于买价，构不成套利），不占收购单名额。 */
    const rows=[];
    const equipped=new Set();
    if(R.player.gun) equipped.add(R.player.gun.uid);
    if(R.player.secondary) equipped.add(R.player.secondary.uid);
    const wants=sh.wants||[];
    const wantOf=cat=>raidRecWant(sh, cat);
    const price=(base, mul)=>Math.max(1, raidEconRound((base||0)*mul));
    const add=(cat, key, item, name, col, note, base)=>{
      const w=wantOf(cat);
      if(!w || w.left<=0) return;                       // 不在收购单 / 已收满 → 不出现
      rows.push({ cat, key, uid:item.uid, id:item.id, name, col, note, base,
        mul:w.mul, val:price(base, w.mul) });
    };
    for(const w of (R.inv.weapons||[])){
      const on=equipped.has(w.uid);
      add("weapon", "w", w, gunNameOf(w), raidGunColor(w), on?"手持/副手中，需先换下":"枪械", w.value||0);
      if(on && rows.length) rows[rows.length-1].on=true;
    }
    /* v0.25.0：局内回收超市的护甲 / 头盔也改用 9 阶品质色（与仓库卡片一致） */
    const armorCol=(it)=>{
      const r=it.rarity;
      return (typeof r==="number" && RAID_RARITY_COLOR[r]) ? RAID_RARITY_COLOR[r]
        : (ARMOR_TIER_COLOR[it.tier]||"#dfe7f0");
    };
    for(const a of (R.inv.armors||[])) add("gear", "a", a, a.name, armorCol(a), "护甲", a.value||0);
    for(const h of (R.inv.helmets||[])) add("gear", "h", h, h.name, armorCol(h), "头盔", h.value||0);
    for(const s of (R.inv.shields||[])) add("gear", "s", s, s.name, shieldColor(s), "护盾", s.value||0);
    for(const pt of (R.inv.parts||[])) add("part", "p", pt, partNameOf(pt)||(pt.core?"改装模块":pt.slot_name||"配件"),
      (RARITY_BY_ID[pt.rarity]||{color:"#cfd8e2"}).color, pt.core?"改装模块":"配件",
      (pt.slot==="core"?pt.value:partValue(pt))||0);
    for(const m of (R.inv.materials||[])) add("material", "m", m, m.name, m.color||"#dfe7f0", "原材料", m.value||0);
    for(const md of (R.inv.meds||[])){
      const def=RAID_MED_BY_ID[md.id]||{};
      add("med", "md", md, md.name+(md.n>1?" ×"+md.n:""), md.color||"#ff9a9a", def.desc||"医疗品",
        (def.value||100)*(md.n||1));
    }
    for(const k of (R.inv.keys||[])){
      add("key", "k", k, k.name, k.color||"#ffd23f", "钥匙，剩 "+(k.uses||1)+" 次",
        (typeof raidKeyValue==="function") ? raidKeyValue(k) : (k.value||0));
    }
    /* 弹药：固定 0.55×，不进收购单（买了再卖必亏，所以不需要限量） */
    const ammoRows=[];
    for(const id of Object.keys(R.inv.ammo||{})){
      const n=R.inv.ammo[id]; if(!(n>0)) continue;
      const d=ammoDefFromId(id); if(!d) continue;
      const base=d.value*n;
      ammoRows.push({ key:"am", uid:id, name:d.name+" ×"+n, col:d.color,
        note:"弹药，"+d.spec, base, val:raidAmmoSellPrice(base), n });
    }
    const wantsHtml = wants.map(w=>{
      const full=w.left<=0;
      return `<span class="solo-badge" style="margin-right:8px;border-color:${full?"#5a6472":"#62c8ff"}66;color:${full?"#7a8494":"#62c8ff"}">
        ${w.label} ×${w.mul.toFixed(1)} · ${full?"已收满":("还剩 "+w.left+" / "+w.total+" 件")}</span>`;
    }).join("");
    const sellRow=(r,i)=>`
      <div class="si">
        <div class="si-name" style="color:${r.col}">${r.name}</div>
        <div class="si-stats">${r.note}，估值 ₽${priceTextShort(r.base)}，本店 ×${r.mul.toFixed(1)} 收购</div>
        <div class="si-buy"><span class="si-price">₽ ${priceTextShort(r.val)}</span>
          <button class="btn ghost" data-fsell="${r.key}:${i}" ${r.on?"disabled":""}>${r.on?"换下后可卖":"回收"}</button></div>
      </div>`;
    body = `<div class="hint" style="grid-column:1/-1;margin:0 0 8px;">▸ 今日收购单（只收以下几类，限量收满即停）</div>
      <div style="grid-column:1/-1;margin-bottom:10px;">${wantsHtml||`<span style="color:#7a8494">今日没有收购单</span>`}</div>`
      + (rows.length ? rows.map(sellRow).join("")
         : `<div class="empty-hint" style="grid-column:1/-1;">背包里没有收购单上的品类。本店只收：${wants.map(w=>w.label).join(" / ")||"（无）"}</div>`)
      + (ammoRows.length
         ? `<div class="hint" style="grid-column:1/-1;margin:12px 0 6px;">▸ 弹药回收（固定 ${Math.round(raidAmmoSellPrice(100)/100*100)}%，不占收购单名额）</div>`
           + ammoRows.map((r,i)=>`
             <div class="si">
               <div class="si-name" style="color:${r.col}">${r.name}</div>
               <div class="si-stats">${r.note}，估值 ₽${priceTextShort(r.base)}</div>
               <div class="si-buy"><span class="si-price">₽ ${priceTextShort(r.val)}</span>
                 <button class="btn ghost" data-fsell="am:${i}">回收</button></div>
             </div>`).join("")
         : "");
    R._sellRows=rows;
    R._sellAmmo=ammoRows;
  }

  /* v0.35.1（#9）：每个摊位顶部一张「每日特价」卡（与军火超市同一套确定性逻辑）
   * v0.40.0（用户要求）：回收超市不挂特价商品 —— 它只按收购单收货。 */
  if(kind!=="rec"){
    const fdeal=UI._fieldDailyDeal(kind);
    if(fdeal){
      const leftMin=Math.max(1, Math.ceil((raidDealBucketEnd(raidDealBucket())-Date.now())/60000));
      const can=(fdeal.pay==="token") ? (tokens>=fdeal.price) : (money>=fdeal.price);
      body = `<div class="si" style="grid-column:1/-1;border-left:3px solid #ffd23f;background:rgba(255,210,63,.06);">
        <div class="si-name" style="color:#ffd23f">◈ 每日特价 · ${fdeal.name}</div>
        <div class="si-stats">${fdeal.meta}，${fdeal.stats}<br><span style="color:#8fd0ff">全服同一件，${leftMin} 分钟后刷新，买走立即换下一件</span></div>
        <div class="si-buy"><span class="si-price ${can?"":"cant"}">${fdeal.pay==="token"?"◈":"₽"} ${fdeal.pay==="token"?fdeal.price:priceTextShort(fdeal.price)}</span>
          <button class="btn" data-fdeal="${sid}" ${can?"":"disabled"}>抢购</button></div>
      </div>` + body;
    }
  }

  /* v0.29.0：抽奖机 —— 每种摊位都有一台。
   *   黑市（black）用 GP 币结算，其余（枪械 / 材料 / 回收）用局内卢布结算。
   *   概率与成本见 raid-data.js 的 RAID_GACHA / Raid._gachaRoll。 */
  const gk = kind==="black" ? "token" : "cash";
  const gacha = RAID_GACHA[gk];
  const gachaBal = gk==="token" ? tokens : money;
  const gachaCan = gachaBal >= gacha.cost;
  body += `<div class="gacha-box" style="grid-column:1/-1;border:1px solid ${sh.color}55;border-radius:10px;padding:12px 14px;margin-top:4px;background:linear-gradient(180deg,rgba(255,210,63,.06),transparent);">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;">
        <div>
          <div style="font-weight:800;font-size:15px;color:${sh.color};">抽奖机，LUCKY DRAW</div>
          <div style="font-size:12px;color:var(--muted);margin-top:3px;line-height:1.5;">
            <b style="color:#ff5c8a">极小概率</b>抽得 <b style="color:#ffd23f">${gk==="token"?"T10~T12 的枪械、装备和配件":"T9 及以下的枪械、装备和配件"}</b>；通常出 T5~T9 防护装备与高阶枪械，七成是普通原材料。每抽 <b>${gacha.costTxt}</b>（${gacha.label}），理性消费。
          </div>
        </div>
        <button class="btn" data-gacha="1" ${gachaCan?"":"disabled"}>投入 ${gacha.costTxt} 抽一次</button>
      </div>
    </div>`;

  const wallet = kind==="black"
    ? `<div class="shop-gold" style="color:#ffd23f">◈ GP 币 ${tokens}</div><div class="shop-gold">局内卢布 ₽ ${priceTextShort(money)}</div>`
    : `<div class="shop-gold">局内卢布 ₽ ${priceTextShort(money)}</div>`;

  UI._set(`
    <style>
      .fieldshop .shop-list{display:grid;grid-template-columns:repeat(auto-fill,minmax(272px,1fr));gap:10px;align-items:stretch;}
      .fieldshop .si{display:flex;flex-direction:column;height:100%;}
      .fieldshop .si-stats{flex:1 1 auto;}
      .fieldshop .si-buy{margin-top:auto;display:flex;align-items:center;justify-content:flex-end;gap:10px;}
    </style>
    <div class="panel raid-setup fieldshop">
      <h2 class="title-big" style="font-size:30px;color:${sh.color}">${sh.name}</h2>
      <div class="subtitle">${tagLine} · 局内交易，撤离成功才会把货带回仓库</div>
      <div class="shop-bar">
        <div class="shop-desc">${kind==="rec"
          ? `回收超市只收<b style="color:#62c8ff">今日收购单</b>上的品类（2~3 类），价格是估价的 <b style="color:#62c8ff">2~3 倍</b>，每类限量、收满即停；不在单上的东西本店不收。弹药单独按固定 55% 折现。`
          : kind==="black"
            ? `黑市只认 <b style="color:#ffd23f">◈ GP 币</b>：<b>本局首杀必得 1 枚</b>，之后靠上锁箱与 Raider 掉落，撤离时再按带出价值结算。这里出售 <b style="color:#ffd23f">高品阶成品枪</b>、高级改装模块与 <b style="color:#ffd23f">III~V 级保险箱钥匙</b>，卢布买不到。`
            : `用<b style="color:#ffd23f">局内卢布</b>交易 —— 卢布要先在局内搜刮到，撤离后才真正落袋。死了，钱和货一起没。`}</div>
        ${wallet}
        <button class="btn ghost" data-fclose="1">离开（继续突袭）</button>
      </div>
      <div class="shop-solo">
        <span class="solo-badge" style="border-color:${sh.color}66;color:${sh.color}">独立摊位</span>
        <span>${sh.name}${kind==="gun"?"只卖成品枪":kind==="mat"?"只卖原材料 / 配件 / 医疗 / I~II 级钥匙":kind==="rec"?"只收货，不卖货":"只收 ◈ GP 币，换高级枪 / 改装模块 / III~V 级钥匙"}，货架与其他摊位各算各的，不互通。</span>
      </div>
      <div class="shop-list">${body}</div>
      <div class="hint" style="margin-top:12px;">关闭面板后游戏继续 —— 谈生意时背后随时可能来人。</div>
    </div>`);

  UI.overlay.querySelectorAll("[data-fclose]").forEach(el=>el.onclick=()=>{ SFX.ui(); R._closeShop(); });

  UI.overlay.querySelectorAll("[data-fbuy]").forEach(el=>el.onclick=()=>{
    const [pay, k, si]=el.dataset.fbuy.split(":"); const idx=+si;
    const shop=(R.shops||[]).find(s=>s.id===k) || (R.shops||[]).find(s=>s.kind===k); if(!shop) return;
    const capMsg=(t)=>R._float(R.player.x, R.player.y-40, t, "#ff8a5a");
    if(pay==="cash"||pay==="token"){
      const g=shop.stock.guns[idx]; if(!g) return;
      if(R.inv.weapons.length>=RAID_INV_CAP.weapons){ capMsg("背包武器已满"); return; }
      const price = pay==="token" ? (g.tokenPrice||60) : (g.shopPrice||g.value||0);
      if(pay==="token"){ if(R.tokens<price) return; R.tokens-=price; }
      else { if(R.creds<price) return; R.creds-=price; }
      shop.stock.guns.splice(idx,1);
      R.inv.weapons.push(g);
      R._rtGun(g);                       // 建缓存（空枪，弹药要自己装）
      R._float(R.player.x, R.player.y-40, "购入 "+g.name, raidGunColor(g));
      SFX.buy ? SFX.buy() : SFX.ui();
      RaidStash.save(R.stash);
      UI.raidFieldShop(sid);
    } else if(pay==="cashmat"){
      const m=shop.stock.mats[idx]; if(!m) return;
      if(R.inv.materials.length>=RAID_INV_CAP.materials){ capMsg("材料栏已满"); return; }
      if(R.creds<(m.shopPrice||0)) return;
      R.creds-=m.shopPrice;
      R.inv.materials.push(m); shop.stock.mats.splice(idx,1);
      R._float(R.player.x, R.player.y-40, "购入 "+m.name, m.color||"#dfe7f0");
      SFX.ui(); UI.raidFieldShop(sid);
    } else if(pay==="cashpart"){
      const pt=shop.stock.parts[idx]; if(!pt) return;
      if(R.inv.parts.length>=RAID_INV_CAP.parts){ capMsg("配件栏已满"); return; }
      if(R.creds<(pt.shopPrice||0)) return;
      R.creds-=pt.shopPrice;
      R.inv.parts.push(pt); shop.stock.parts.splice(idx,1);
      R._float(R.player.x, R.player.y-40, "购入 "+(partNameOf(pt)||"配件"), "#c9a13a");
      SFX.ui(); UI.raidFieldShop(sid);
    } else if(pay==="cashmed"){
      const md=shop.stock.meds[idx]; if(!md) return;
      if(R.creds<md.price) return;
      R.creds-=md.price;
      if(md.id==="bandage") R.bandages+=md.n;
      else { R.meds=R.meds||{}; R.meds[md.id]=(R.meds[md.id]||0)+md.n; }
      R._float(R.player.x, R.player.y-40, "购入 "+md.n+" 份补给", "#ff9a9a");
      SFX.ui(); UI.raidFieldShop(sid);
    } else if(pay==="tokenpart"){
      const c=shop.stock.parts[idx]; if(!c) return;
      if(R.inv.parts.length>=RAID_INV_CAP.parts){ capMsg("配件栏已满"); return; }
      if(R.tokens<(c.tokenPrice||10)) return;
      R.tokens-=c.tokenPrice;
      R.inv.parts.push(c); shop.stock.parts.splice(idx,1);
      R._float(R.player.x, R.player.y-40, "兑换 "+(c.name||"改装模块"), c.color||"#c07bff");
      SFX.ui(); UI.raidFieldShop(sid);
    } else if(pay==="tokengear" || pay==="cashgear"){
      const g=(shop.stock.gears||[])[idx]; if(!g) return;
      const key = g.kind==="shield" ? "shields" : g.kind==="helmet" ? "helmets" : "armors";
      const arr=R.inv[key]=R.inv[key]||[];
      if(arr.length>=RAID_INV_CAP[key]){ capMsg("背包"+(g.kind==="shield"?"护盾":g.kind==="helmet"?"头盔":"护甲")+"栏已满"); return; }
      const tok=pay==="tokengear";
      const price=tok?(g.tokenPrice||10):(g.shopPrice||0);
      if(tok){ if(R.tokens<price) return; R.tokens-=price; }
      else { if(R.creds<price) return; R.creds-=price; }
      shop.stock.gears.splice(idx,1);
      arr.push(g);
      R._invDirty=true;
      R._float(R.player.x, R.player.y-40, "兑换 "+g.name, g.qColor||"#ffd23f");
      SFX.ui(); UI.raidFieldShop(sid);
    } else if(pay==="cashammo" || pay==="tokenammo"){
      const a=(shop.stock.ammo||[])[idx]; if(!a) return;
      const tok=pay==="tokenammo";
      const price=tok?(a.tokenPrice||0):(a.shopPrice||0);
      if(tok){ if(R.tokens<price) return; } else { if(R.creds<price) return; }
      if(R._ammoTotal()>=RAID_AMMO_CAP){ capMsg("弹药已满（"+RAID_AMMO_CAP+" 发上限）"); return; }
      if(tok) R.tokens-=price; else R.creds-=price;
      const add=R._ammoAdd(a.id, a.n);
      if(add<=0){ capMsg("弹药已满"); return; }
      shop.stock.ammo.splice(idx,1);
      R._float(R.player.x, R.player.y-40, "购入 "+add+" 发 "+a.short, a.color||"#dfe7f0");
      SFX.ui(); UI.raidFieldShop(sid);
    } else if(pay==="key"){
      const ky=(shop.stock.keys||[])[idx]; if(!ky) return;
      if(!R.inv.keys) R.inv.keys=[];
      if(R.inv.keys.length>=RAID_INV_CAP.keys){ capMsg("钥匙串已满"); return; }
      const tok=!!ky.tokenPrice;
      const price=tok?ky.tokenPrice:(ky.shopPrice||raidKeyDef(ky.lv).shop||0);
      if(tok){ if(R.tokens<price) return; R.tokens-=price; }
      else { if(R.creds<price) return; R.creds-=price; }
      R.inv.keys.push(ky); shop.stock.keys.splice(idx,1);
      R._float(R.player.x, R.player.y-40, "购入 "+ky.name, ky.color||"#ffd23f");
      SFX.ui(); UI.raidFieldShop(sid);
    }
  });

  /* v0.29.0：抽奖机 —— 扣费 → 投骰 → 发奖（背包满则按估值折现卢布，绝不吞钱） */
  UI.overlay.querySelectorAll("[data-gacha]").forEach(el=>el.onclick=()=>{
    const gk2 = kind==="black" ? "token" : "cash";
    const cfg = RAID_GACHA[gk2];
    if(gk2==="token"){
      if(R.tokens < cfg.cost){ R._float(R.player.x, R.player.y-40, "GP 币不足", "#ff8a5a"); return; }
    } else {
      if(R.creds < cfg.cost){ R._float(R.player.x, R.player.y-40, "卢布不足", "#ff8a5a"); return; }
    }
    if(typeof R._gachaRoll!=="function") return;
    if(gk2==="token") R.tokens -= cfg.cost; else R.creds -= cfg.cost;

    const res = R._gachaRoll(gk2==="token");
    const it = res.item, bucket = res.bucket;
    const arr = R.inv[bucket] = R.inv[bucket] || [];
    const cap = RAID_INV_CAP[bucket] || 1;
    const col = it.color || it.qColor || "#ffd23f";
    let msg;
    if(arr.length >= cap){
      const salvage = Math.max(1, Math.round((it.value||0) * 0.5));
      R.creds += salvage;
      msg = "背包已满，折现 +₽" + salvage;
    } else {
      arr.push(it);
      msg = "抽中 " + (it.name || gunNameOf(it) || "物品");
    }
    R._invDirty = true;
    R._float(R.player.x, R.player.y-40, msg, col);
    if(SFX.pickup) SFX.pickup(); else SFX.ui();
    UI.raidFieldShop(sid);
  });

  UI.overlay.querySelectorAll("[data-fsell]").forEach(el=>el.onclick=()=>{
    const [key, si]=el.dataset.fsell.split(":"); const idx=+si;
    /* v0.40.0：弹药走单独的固定折现表（不占收购单名额） */
    if(key==="am"){
      const row=(R._sellAmmo||[])[idx]; if(!row) return;
      const n=R._ammoTake(row.uid, row.n||0);
      if(n<=0) return;
      const d=ammoDefFromId(row.uid);
      const g2=Math.max(1, Math.round(raidAmmoSellPrice(d.value*n)/10)*10);
      R.creds+=g2;
      R._float(R.player.x, R.player.y-40, "卖 "+n+" 发，+₽"+g2, "#8fe07a");
      SFX.ui(); UI.raidFieldShop(sid);
      return;
    }
    const rows=R._sellRows||[]; const row=rows[idx]; if(!row) return;
    /* 收购单收口：品类必须在单上、且还没收满（界面已挡住，这里再挡一次防联机/连点） */
    const want=raidRecWant(sh, row.cat);
    if(!want || want.left<=0){
      R._float(R.player.x, R.player.y-40, "本店不收这件（或已收满）", "#ff8a5a");
      return;
    }
    const gain=Math.round(row.val/10)*10;
    const pull=(arr)=>{ const i=arr.findIndex(x=>x.uid===row.uid); if(i>=0) return arr.splice(i,1)[0]; return null; };
    let it=null;
    if(key==="w") it=pull(R.inv.weapons);
    else if(key==="a") it=pull(R.inv.armors);
    else if(key==="h") it=pull(R.inv.helmets);
    else if(key==="s") it=pull(R.inv.shields||[]);
    else if(key==="p") it=pull(R.inv.parts);
    else if(key==="k") it=pull(R.inv.keys||[]);
    else if(key==="md"){
      const arr=R.inv.meds||[]; const i=arr.findIndex(x=>x.id===row.id);
      if(i>=0){
        it=arr[i];
        if((it.n|0)>1) it.n=(it.n|0)-1; else arr.splice(i,1);
        it=Object.assign({}, it);                      // 只卖 1 件，不整堆搬走
      }
    }
    else if(key==="m"){
      // v0.21.9：材料无 uid，按 id 匹配，否则永远删掉材料栏第一件（卖错货 + 可刷钱）
      const arr=R.inv.materials||[];
      const i=arr.findIndex(x=>x.id===row.id);
      if(i>=0) it=arr.splice(i,1)[0];
    }
    if(!it) return;
    want.left--;                                        // 收满即停
    R.creds+=gain;
    R._float(R.player.x, R.player.y-40, "+₽"+gain, "#8fe07a");
    SFX.ui(); UI.raidFieldShop(sid);
  });

  /* v0.35.1（#9）：抢购每日特价（买走 seq+1 → 下一件，与其他摊位逻辑一致） */
  UI.overlay.querySelectorAll("[data-fdeal]").forEach(el=>el.onclick=()=>{
    const d=UI._fieldDailyDeal(kind); if(!d) return;
    const arr=R.inv[d.bucket]=R.inv[d.bucket]||[];
    const cap=RAID_INV_CAP[d.bucket]||1;
    const need=(d.n||1);
    if(arr.length+need>cap){ R._float(R.player.x,R.player.y-40,"背包已满，无法抢购","#ff8a5a"); return; }
    if(d.pay==="token"){ if(R.tokens<d.price) return; R.tokens-=d.price; }
    else { if(R.creds<d.price) return; R.creds-=d.price; }
    if(d.bucket==="materials"){ for(let i=0;i<need;i++) arr.push(Object.assign({},d.item,{n:1})); }
    else arr.push(d.item);
    const st=RaidStash.load(); st.fieldDeals=st.fieldDeals||{};
    st.fieldDeals[kind]={ hour:raidDealBucket(), seq:(d.seq|0)+1 };
    RaidStash.save(st);
    UI._fieldDealCache=null;
    R._invDirty=true;
    R._float(R.player.x,R.player.y-40,"抢购 "+d.name, d.col||"#ffd23f");
    SFX.buy?SFX.buy():SFX.ui();
    UI.raidFieldShop(sid);
  });
};

function forgeTabsHTML(){  return `<div class="shop-tabs" style="margin-bottom:14px;">
    <button class="shop-tab ${UI._forgeTab!=='fusion'&&UI._forgeTab!=='workshop'?'on':''}" data-ftab="forge"><b>精密改装</b><span class="tab-tag">GUNSMITH</span></button>
    <button class="shop-tab ${UI._forgeTab==='fusion'?'on':''}" data-ftab="fusion"><b>融合台</b><span class="tab-tag">FUSION</span></button>
    <button class="shop-tab ${UI._forgeTab==='workshop'?'on':''}" data-ftab="workshop"><b>工坊</b><span class="tab-tag">CRAFT</span></button>
  </div>`;
}

UI.raidForge=function(opts){
  opts=opts||{};
  if(UI._forgeTab==="fusion") return UI.raidFusion(opts);
  if(UI._forgeTab==="workshop") return UI.raidWorkshop(opts);
  const stash=RaidStash.load();
  if(!stash.weapons.some(w=>w.uid===UI._forgeSel)) UI._forgeSel = stash.weapons[0]?stash.weapons[0].uid:null;
  const sel = stash.weapons.find(w=>w.uid===UI._forgeSel) || null;

  // v0.35.1（用户反馈 #11）：枪匠台装备列表按估值降序，贵的好枪排前面
  const cards = stash.weapons.slice().sort((a,b)=>(b.value||0)-(a.value||0)).map(w=>{
    const on = w.uid===UI._forgeSel;
    const col=raidGunColor(w);
    const tname=WEAPON_TYPES[w.type]?WEAPON_TYPES[w.type].name:w.cat;
    const elem=w.element&&w.element!=="none"?(AMMO_TYPES[w.element]?AMMO_TYPES[w.element].name:"特种弹"):AMMO_TYPES.none.name;
    return `<div class="shop-item ${on?'sel':''}" data-pick="${w.uid}" style="border-left-color:${col};cursor:pointer;${on?('box-shadow:inset 0 0 0 2px '+col+';'):''}">
      <div class="si-thumb">${gunSvg(w,46)}</div>
      <div class="si-name" style="color:${col}">${gunNameOf(w)}</div>
      <div class="si-meta">${tname}，${elem}${w.mayhem>0?'，<b class="c-mayhem">改装'+w.mayhem+'级</b>':''}</div>
      <div class="si-stats">${gunDamageLabel(w)}，弹匣 ${w.mag}，射速 ${w.rpm}，射程 ${w.range}<br>配件 ${(w.parts||[]).length} 个，估值 ₽${priceTextShort(w.value)}</div>
    </div>`;
  }).join('') || `<div class="empty-hint">仓库暂无枪械，先去军火超市采购，或突袭搜刮并成功撤离</div>`;

  let opPanel = `<div class="hint">请选择一把枪械进行锻造。</div>`;
  if(sel){
    const cR=forgeCost("reroll",sel);
    const canR=stash.creds>=cR;
    opPanel = `
      <div class="forge-ops" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px;">
        <div class="shop-item" style="border-left-color:#8fb0c8">
          <div class="si-name" style="color:#8fb0c8">重调改装词条</div>
          <div class="si-meta">保留枪型 / 兵工厂 / 适配弹种 / 品级，重掷全部改装词条（只要卢布）</div>
          <div class="si-buy"><span class="si-price ${canR?'':'cant'}">₽ ${cR}</span>
            <button class="btn" data-op="reroll" ${canR?'':'disabled'}>重调</button></div>
        </div>
        <div class="shop-item" style="border-left-color:#9aa4b2">
          <div class="si-name" style="color:#9aa4b2">更换弹种 / 提升改装等级已并入「模块装配」</div>
          <div class="si-meta">把<b>弹种适配组件</b>装进改装槽即可更换适配弹药；把<b>膛压组件</b>装进改装槽，<b style="color:#b08a58">最高等级膛压组件决定枪械改装等级</b>；<b>改装模块</b>提供工艺参数增益。均在下方改装槽操作。</div>
        </div>
      </div>`;
  }

  // —— 部件装配（普通部件槽）+ 模块装配（改装槽，数量随品级 1~8） ——
  let partPanel = "";
  if(sel){
    const allParts = sel.parts||[];
    const normalParts = allParts.filter(p=>!p.core);
    const cores = allParts.filter(p=>p.core);
    const coreCap = raidCoreSlotCount(sel.rarity);
    const rIdx = Math.max(0, RARITIES.findIndex(r=>r.id===sel.rarity));
    const rows = GUN_SLOTS.map(slot=>{
      const cur = normalParts.find(p=>p.slot===slot.id);
      const poolN = (stash.parts||[]).filter(p=>!p.core && p.slot===slot.id).length;
      const col = cur ? ((RARITY_BY_ID[cur.rarity]||{color:"#cfd8e2"}).color) : "#6b7280";
      return `<div class="forge-slot">
        <div class="fs-name">${slot.name}</div>
        <div class="fs-part" style="color:${col}">${cur?cur.name:"（空槽）"}<em>${cur?partText(cur):"装备仓库配件后生效"}</em></div>
        <div class="fs-btns">
          <button class="btn ghost" data-install="${slot.id}" ${poolN>0?'':'disabled'}>换装 ${poolN}</button>
        </div>
      </div>`;
    }).join("");
    const coreRows=[];
    for(let i=0;i<coreCap;i++){
      const c=cores[i];
      if(c){
        coreRows.push(`<div class="forge-slot core">
          <div class="fs-name">改装槽 ${i+1}</div>
          <div class="fs-part" style="color:${c.color||'#8fb0c8'}">${c.name}<em>${partText(c)}</em></div>
          <div class="fs-btns"><button class="btn ghost" data-rmcore="${c.uid}">卸下</button></div>
        </div>`);
      } else {
        coreRows.push(`<div class="forge-slot core empty">
          <div class="fs-name">改装槽 ${i+1}</div>
          <div class="fs-part" style="color:#6b7280">（空）<em>装入改装模块以换弹种 / 提改装等级 / 加参数</em></div>
        </div>`);
      }
    }
    const instUids=new Set(cores.map(c=>c.uid));
    const avail=(stash.parts||[]).filter(p=>p.core && !instUids.has(p.uid));
    const poolHtml = avail.length
      ? `<div class="core-pool">可用改装模块（点一下装入首个空槽）：${avail.map(a=>`<button class="btn ghost core-chip" data-addcore="${a.uid}" style="border-color:${a.color};color:${a.color}">${a.name}</button>`).join('')}</div>`
      : `<div class="hint" style="margin-top:6px;color:var(--muted)">仓库暂无可用改装模块，只能从保险箱 / Raider 掉落，或在局内枪械商店、黑市购买</div>`;
    partPanel = `
      <h3 style="font-size:18px;margin:18px 0 8px;">配件装配 <span style="color:var(--muted);font-size:12px;font-weight:400;">共 ${normalParts.length} / ${GUN_SLOTS.length} 槽位，配件只能用仓库实物换装</span></h3>
      <div class="forge-partbox">${rows}</div>
      <h3 style="font-size:18px;margin:18px 0 8px;">模块装配 <span style="color:var(--muted);font-size:12px;font-weight:400;">${cores.length} / ${coreCap} 槽，由品级决定（${RAID_RARITY_NAME[rIdx]||"民用"}）· 最高级膛压组件 = 枪械改装等级</span></h3>
      <div class="forge-partbox">${coreRows.join('')}</div>
      ${cores.length<coreCap ? poolHtml : `<div class="hint" style="margin-top:6px;color:var(--muted)">改装槽已满（${coreCap} 个）· 卸下后可装入更多</div>`}`;
  }

  const backLabel = opts.from==='title' ? '返回主菜单' : '前往配装大厅';
  UI._set(`
    <div class="panel raid-setup">
      <h2 class="title-big" style="font-size:32px;">枪匠台 · 精密改装</h2>
      <div class="subtitle">GUNSMITH · 用卢布重调改装词条，模块（弹种 / 膛压 / 工艺）装进改装槽即可换弹 / 提等级 / 加参数（部件只能实物换装）</div>
      ${forgeTabsHTML()}
      <div class="shop-bar">
        <div class="shop-desc">改造对象是塔科夫仓库中的枪械；改造后伤害、射速、弹匣、估值全部重算。改造不可撤销，谨慎升阶。<b style="color:#ff9a3a">配件槽位不支持重铸</b>——好配件只能从箱子里搜，或自己投料合成。</div>
        <div class="shop-gold">仓库卢布 ₽ ${priceTextShort(stash.creds)}</div>
        <button class="btn ghost" id="btn-forge-back">${backLabel}</button>
      </div>
      <div class="shop-list" style="margin-bottom:14px;">${cards}</div>
      ${opPanel}
      ${partPanel}
    </div>`);

  UI.overlay.querySelectorAll('[data-ftab]').forEach(el=>{
    el.onclick=()=>{ UI._forgeTab=el.dataset.ftab; SFX.ui(); UI.raidForge(opts); };
  });
  UI.overlay.querySelectorAll('[data-pick]').forEach(el=>{
    el.onclick=()=>{ UI._forgeSel=el.dataset.pick; SFX.ui(); UI.raidForge(opts); };
  });
  const applyOp=(op)=>{
    if(op!=="reroll") return;
    const idx=stash.weapons.findIndex(w=>w.uid===UI._forgeSel);
    if(idx<0) return;
    const gun=stash.weapons[idx];
    const cost=forgeCost(op,gun);
    if(stash.creds<cost){ UI.toast && UI.toast("卢布不足"); return; }
    stash.creds-=cost;
    const out=reforgeBlGun(gun,op);
    stash.weapons[idx]=out;
    RaidStash.save(stash); SFX.ui(); UI.raidForge(opts);
  };
  UI.overlay.querySelectorAll('[data-op]').forEach(el=>{
    el.onclick=()=>{ applyOp(el.dataset.op); };
  });
  // 装改装模块：点仓库改装模块 → 装入首个空改装槽（数量受品质限制）
  UI.overlay.querySelectorAll('[data-addcore]').forEach(el=>{
    el.onclick=()=>{
      const uid=el.dataset.addcore;
      const idx=stash.weapons.findIndex(w=>w.uid===UI._forgeSel); if(idx<0) return;
      const gun=stash.weapons[idx];
      const instN=(gun.parts||[]).filter(p=>p.core).length;
      if(instN>=raidCoreSlotCount(gun.rarity)){ UI.toast && UI.toast("改装槽已满"); return; }
      const ci=stash.parts.findIndex(p=>p.uid===uid); if(ci<0) return;
      const core=stash.parts.splice(ci,1)[0];
      const g=installPartOnGun(gun, Object.assign({},core,{slot:"core"+instN}));
      raidReindexCores(g);
      stash.weapons[idx]=g;
      RaidStash.save(stash); SFX.ui(); UI.raidForge(opts);
    };
  });
  // 卸下改装模块：退回仓库并重新计算武器数值（改装等级 / 弹种 / 增益）
  UI.overlay.querySelectorAll('[data-rmcore]').forEach(el=>{
    el.onclick=()=>{
      const uid=el.dataset.rmcore;
      const idx=stash.weapons.findIndex(w=>w.uid===UI._forgeSel); if(idx<0) return;
      const gun=stash.weapons[idx];
      const pi=(gun.parts||[]).findIndex(p=>p.uid===uid); if(pi<0) return;
      const core=gun.parts.splice(pi,1)[0];
      raidReindexCores(gun);
      const g=blGunConvert(generateWeapon(gun.ilvl,{
        rarity:gun.rarity, type:gun.type, manufacturer:gun.manufacturer,
        ilvl:gun.ilvl, affixes:gun.affixes||[], parts:gun.parts }));
      g.uid=gun.uid; g.kind=gun.kind||"weapon";
      core.slot="core";
      stash.parts.push(core);
      stash.weapons[idx]=g;
      RaidStash.save(stash); SFX.ui(); UI.raidForge(opts);
    };
  });
  // 普通配件换装（改装模块不会被选入普通槽）
  UI.overlay.querySelectorAll('[data-install]').forEach(el=>{
    el.onclick=()=>{
      const slot=el.dataset.install;
      const idx=stash.weapons.findIndex(w=>w.uid===UI._forgeSel);
      if(idx<0) return;
      const pi=(stash.parts||[]).findIndex(p=>!p.core && p.slot===slot);
      if(pi<0) return;
      const gun=stash.weapons[idx];
      const part=stash.parts.splice(pi,1)[0];
      const old=(gun.parts||[]).find(p=>p.slot===slot && !p.core);
      if(old) stash.parts.push(old);          // 旧配件退回配件池
      stash.weapons[idx]=installPartOnGun(gun, part);
      RaidStash.save(stash); SFX.ui(); UI.raidForge(opts);
    };
  });
  document.getElementById('btn-forge-back').onclick=()=>{
    SFX.ui();
    if(opts.from==='title') UI.title(); else UI.raidSetup();
  };
};

/* =========================================================================
 * 融合台：两件及以上枪械 / 配件 / 护甲 / 头盔 → 一件更高品质的产物
 *   第一件选中的物品决定产物类型；材料越多，品质与词条跃升越明显。
 * ========================================================================= */
UI.raidFusion=function(opts){
  opts=opts||{};
  const stash=RaidStash.load();
  if(!stash.parts) stash.parts=[];
  if(!stash.helmets) stash.helmets=[];
  if(!UI._fuseSel) UI._fuseSel=[];

  const entries=[];
  const push=(it,tab)=>{ if(it&&it.uid) entries.push({it,tab}); };
  for(const w of stash.weapons) push(w,'weapon');
  for(const a of stash.armors) push(a,'armor');
  for(const h of stash.helmets) push(h,'helmet');
  for(const s of (stash.shields||[])) push(s,'shield');
  // 改装模块不可融合升阶 —— 不进入融合台选材列表
  for(const p of stash.parts) if(!(p.slot==="core"||p.core)) push(p,'part');
  UI._fuseSel=UI._fuseSel.filter(uid=>entries.some(e=>e.it.uid===uid));

  const items=UI._fuseSel.map(uid=>entries.find(e=>e.it.uid===uid).it).filter(Boolean);
  const cost=items.length>=2 ? ((items[0]&&(items[0].slot==="core"||items[0].core)) ? 0 : fuseCost(items)) : 0;
  const can=items.length>=2 && stash.creds>=cost;
  const main=items[0]||null;
  const rarityName=it=>{
    if(typeof it.rarity==="number") return RAID_RARITY_NAME[it.rarity]||"普通";
    const R=RARITY_BY_ID[it.rarity];
    return R?R.name:"普通";
  };
  const kindName=it=>{
    if(it.kind==="weapon"||it.dmg!==undefined) return (WEAPON_TYPES[it.type]&&WEAPON_TYPES[it.type].name)||"枪械";
    if(it.kind==="helmet") return `T${it.tier} 头盔`;
    if(it.kind==="shield") return `T${it.tier} 护盾`;
    if(it.kind==="armor") return `T${it.tier} 护甲`;
    if(it.slot==="core"||it.core) return raidCoreName(it);
    if(it.kind==="receiver") return `底材，T${it.tier}`;
    return `配件，${GUN_SLOT_BY_ID[it.slot]?GUN_SLOT_BY_ID[it.slot].name:(it.slot||"")}`;
  };
  const card=({it},i)=>{
    const on=UI._fuseSel.includes(it.uid);
    const col=raidGunColor(it);
    const isMain=on && UI._fuseSel[0]===it.uid;
    const nAff=(it.affixes||[]).length;
    const stat=it.kind==="weapon"||it.dmg!==undefined
      ? `${gunDamageLabel(it)}，配件 ${(it.parts||[]).length}，词条 ${nAff}${it.mayhem>0?('，改装'+it.mayhem):''}`
      : it.kind==="shield" ? shieldLines(it).slice(0,3).join("，")
      : it.kind==="armor" ? `减伤 ${Math.round((it.dr||0)*100)}%，耐久 ${it.maxArmor}`
      : it.kind==="helmet" ? `爆头减伤 ${Math.round((it.dr||0)*100)}%，耐久 ${it.maxArmor}`
      : (it.slot==="core"||it.core) ? `${RAID_ROMAN[it.lv]} 阶，两件同阶同类型可升阶`
      : partText(it);
    return `<div class="shop-item ${on?'sel':''}" data-fuse="${it.uid}"
      style="border-left-color:${col};cursor:pointer;${on?('box-shadow:inset 0 0 0 2px '+col+';'):''}">
      <div class="si-name" style="color:${col}">${gunNameOf(it)}${isMain?' <em style="color:#ffd23f;font-style:normal;">［主］</em>':''}</div>
      <div class="si-meta">${kindName(it)}，${rarityName(it)}</div>
      <div class="si-stats">${stat}<br>估值 ₽${priceText(it.value||partValue(it)||0)}</div>
    </div>`;
  };
  const cards=entries.length?entries.map(card).join(''):`<div class="empty-hint">仓库为空，先去突袭搜刮或军火超市采购</div>`;

  let preview='<div class="hint">至少选择 2 件物品。第一件决定产物类型（枪 / 甲 / 盔 / 配件）。</div>';
  if(items.length>=2){
    const n=items.length;
    /* v0.25.0：预览改成「保底 ~ 上限 + 成功率」。
       旧预览直接把「必定升 1~2 阶」印在屏幕上，改成概率制后那样就是骗人；
       现在的口径：保底 = 投料里的最高品质，上限 = 全成功时的品质，中间给成功率。 */
    const upChance=raidFuseUpChance(n);
    const pct=Math.round(upChance*100);
    if(main && (main.kind==="weapon"||main.dmg!==undefined)){
      const mr=Math.max(...items.map(it=>Math.max(0,RARITIES.findIndex(r=>r.id===(it.rarity||"white")))));
      const tr=RARITIES[Math.min(RARITIES.length-1,mr+2)];
      preview=`<div class="hint" style="color:#8fd0ff;">
        产物：<b style="color:${RARITIES[mr].color}">${RARITIES[mr].name}</b> ~ <b style="color:${tr.color}">${tr.name}</b> ${kindName(main)}
       ，升阶成功率 <b>${pct}%</b>（4 件以上另有 18% 再升 1 阶）
       ，词条约 <b>${Math.min(10,3+n-1)}</b> 条，改装 <b>${Math.max(0,...items.map(x=>x.mayhem||0))}~+1</b>，配件品质各升 1 档</div>`;
    } else if(main && main.kind==="shield"){
      const mt=Math.max(...items.map(x=>x.tier||1));
      const mr=Math.max(...items.map(x=>qOf(x)));
      const pfT=Math.min(9,mt+1), pfR=Math.min(8,mr+2);
      preview=`<div class="hint" style="color:#8fd0ff;">
        产物：<b>T${mt}~T${pfT} 护盾</b>，品阶 <b style="color:${RAID_RARITY_COLOR[mr]}">${RAID_RARITY_NAME[mr]}</b> ~ <b style="color:${RAID_RARITY_COLOR[pfR]}">${RAID_RARITY_NAME[pfR]}</b>
       ，升阶成功率 <b>${pct}%</b>，四配件与前后缀按新表重掷</div>`;
    } else if(main && (main.kind==="armor"||main.kind==="helmet")){
      const mt=Math.max(...items.map(x=>x.tier||1));
      const mr=Math.max(...items.map(x=>x.rarity|0));
      const pfT=Math.min(9,mt+1), pfR=Math.min(8,mr+2);
      preview=`<div class="hint" style="color:#8fd0ff;">
        产物：<b>T${mt}~T${pfT} ${main.kind==="helmet"?"头盔":"护甲"}</b>，品阶 <b style="color:${RAID_RARITY_COLOR[mr]}">${RAID_RARITY_NAME[mr]}</b> ~ <b style="color:${RAID_RARITY_COLOR[pfR]}">${RAID_RARITY_NAME[pfR]}</b>
       ，升阶成功率 <b>${pct}%</b>，按新表满耐久生成</div>`;
    } else if(main && (main.slot==="core"||main.core)){
      const same=items.filter(i=>(i.slot==="core"||i.core)&&i.core===main.core&&i.lv===main.lv&&(i.elem||"")===(main.elem||"")&&(i.boost||"")===(main.boost||""));
      const ok=same.length>=2 && main.lv<RAID_CORE_MAX;
      let upName = main.core==="chaos" ? "膛压组件"
        : main.core==="elem" ? ("弹种适配组件·"+(ELEMENTS[main.elem]?ELEMENTS[main.elem].name:""))
        : ("改装模块·"+(BOOST_CORE_TYPES[main.boost]?BOOST_CORE_TYPES[main.boost].name:""));
      preview=`<div class="hint" style="color:${ok?'#8fe07a':'#ff8a5a'}">
        产物：<b>${ok?upName+" ["+RAID_ROMAN[main.lv+1]+"]":"无法升阶（需 2 个同阶同型改装模块，且未满 V 级）"}</b></div>`;
    } else {
      preview=`<div class="hint" style="color:#8fd0ff;">
        产物：<b>高品质配件</b>，品质提升概率 <b>${pct}%</b>（4 件以上有 18% 再升 1 档），词条按新品质重掷</div>`;
    }
  }

  const resultCard = UI._fuseResult ? (()=>{ const r=UI._fuseResult;
    if(r.kind==="weapon"||r.dmg!==undefined) return raidWeaponCard(r,{prefix:"融合成功，"});
    if(r.kind==="shield") return shieldCard(r,{prefix:"融合成功，",margin:true});
    const col=raidGunColor(r);
    if(r.kind==="armor"||r.kind==="helmet") return `<div class="shop-item" style="border-left-color:${col};margin:12px 0;">
      <div class="si-name" style="color:${col}">融合成功，${r.name}</div>
      <div class="si-meta">${kindName(r)}，${rarityName(r)}</div>
      <div class="si-stats">${r.kind==="helmet"?`爆头减伤 ${Math.round((r.dr||0)*100)}%，耐久 ${r.maxArmor}`:`减伤 ${Math.round((r.dr||0)*100)}%，耐久 ${r.maxArmor}`}</div>
    </div>`;
    return `<div class="shop-item" style="border-left-color:${col};margin:12px 0;">
      <div class="si-name" style="color:${col}">融合成功，${r.name}</div>
      <div class="si-meta">${kindName(r)}，${rarityName(r)}</div>
      <div class="si-stats">${partText(r)}</div>
    </div>`; })() : '';

  UI._set(`
    <div class="panel raid-setup">
      <h2 class="title-big" style="font-size:32px;">枪匠台 · 融合台</h2>
      <div class="subtitle">FUSION · 两件以上装备拆件重组，品级 / 改装词条 / 改装等级有概率跃升</div>
      ${forgeTabsHTML()}
      <div class="shop-bar">
        <div class="shop-desc">选择 2~4 件材料（枪 / 配件 / 护甲 / 头盔可混搭）。第一件为「主物品」，决定产物类型；材料越多，跃升越大。融合会消耗全部材料。</div>
        <div class="shop-gold">仓库卢布 ₽ ${priceText(stash.creds)}</div>
        <button class="btn ghost" id="btn-fuse-back">${opts.from==='title'?'返回主菜单':'前往配装大厅'}</button>
      </div>
      ${preview}
      ${resultCard}
      <div class="shop-list" style="margin:10px 0 14px;">${cards}</div>
      <div class="row" style="justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">
        <div class="raid-tip">已选 <b>${items.length}</b> 件${items.length?`，主物品：<b style="color:#ffd23f">${main.name}</b>`:''}</div>
        <button class="btn" id="btn-fuse-do" ${can?'':'disabled'}>融合${items.length>=2?`（₽${priceText(cost)}）`:''}</button>
      </div>
    </div>`);

  UI.overlay.querySelectorAll('[data-ftab]').forEach(el=>{
    el.onclick=()=>{ UI._forgeTab=el.dataset.ftab; SFX.ui(); UI.raidForge(opts); };
  });
  UI.overlay.querySelectorAll('[data-fuse]').forEach(el=>{
    el.onclick=()=>{
      const uid=el.dataset.fuse;
      const i=UI._fuseSel.indexOf(uid);
      if(i>=0) UI._fuseSel.splice(i,1);
      else if(UI._fuseSel.length<4) UI._fuseSel.push(uid);
      UI._fuseResult=null; SFX.ui(); UI.raidFusion(opts);
    };
  });
  const doBtn=document.getElementById('btn-fuse-do');
  if(doBtn) doBtn.onclick=()=>{
    if(items.length<2 || stash.creds<cost) return;
    const out=fuseRaidItems(items);
    if(!out) return;
    for(const it of items){
      const arr = (it.kind==="weapon"||it.dmg!==undefined) ? stash.weapons
        : it.kind==="armor" ? stash.armors
        : it.kind==="helmet" ? stash.helmets
        : it.kind==="shield" ? (stash.shields=stash.shields||[])
        : stash.parts;
      const i=arr.findIndex(x=>x.uid===it.uid);
      if(i>=0) arr.splice(i,1);
    }
    if(out.kind==="weapon") stash.weapons.push(out);
    else if(out.kind==="armor") stash.armors.push(out);
    else if(out.kind==="helmet") stash.helmets.push(out);
    else if(out.kind==="shield") (stash.shields=stash.shields||[]).push(out);
    else stash.parts.push(out);   // 改装模块 / 配件统一进配件池
    stash.creds-=cost;
    RaidStash.save(stash);
    UI._fuseSel=[]; UI._fuseResult=out;
    SFX.ui(); UI.raidFusion(opts);
  };
  document.getElementById('btn-fuse-back').onclick=()=>{
    SFX.ui();
    if(opts.from==='title') UI.title(); else UI.raidSetup();
  };
};

/* 轻量浮层提示：overlay 界面（仓库/融合/装配）里也能看到，不依赖游戏内 toast */
UI.toast=function(msg, ms){
  let el=document.getElementById("ui-toast");
  if(!el){
    el=document.createElement("div");
    el.id="ui-toast"; el.className="ui-toast";
    document.body.appendChild(el);
  }
  el.textContent=msg; el.classList.add("on");
  clearTimeout(UI._toastTimer);
  UI._toastTimer=setTimeout(()=>el.classList.remove("on"), ms||1800);
};

/* =========================================================================
 * 仓库管理，售卖 / 拆解
 *  ，售卖：按估值 50%（RAID_VENDOR_RATE）换成卢布
 *  ，拆解：枪械拆成配件（配件进配件池，可装到别的枪上 / 在超市卖掉）
 * ========================================================================= */
/* 共享的武器卡片渲染：物品栏与融合台结果卡用同一套，保证显示完全一致
 * opts.prefix  前缀文案（如「融合成功 · 」）
 * opts.sell    是否带售卖/拆解按钮（物品栏 true，融合结果卡 false）
 * opts.margin  是否带纵向外边距（融合结果卡 true） */
function raidWeaponCard(w, opts){
  opts=opts||{};
  const col=raidGunColor(w);
  const tname=WEAPON_TYPES[w.type]?WEAPON_TYPES[w.type].name:(w.cat||w.type||"枪械");
  const parts=(w.parts||[]);
  const sellP=gunSellPrice(w);
  const head=(opts.prefix||"")+gunNameOf(w);
  /* v0.36.0（用户要求「枪械改装后在仓库里面要显示改装后的配件」）：
     旧版只列前 4 件，多出来的配件在仓库里完全看不见，玩家没法确认
     「我在枪匠台装的那枚模块到底上没上」。现在全部列出，并把改装模块单独计数。 */
  const coreN=parts.filter(p=>p&&p.core).length;
  const modTag=(w.mayhem||0)>0?`，<b style="color:#b08a58">改装 ${w.mayhem} 级</b>`:"";
  return `<div class="shop-item" style="border-left-color:${col}${opts.margin?';margin:12px 0':''}">
    <div class="si-name" style="color:${col}">${head}</div>
    <div class="si-meta">${tname}，${parts.length} 个配件${coreN?`（含 ${coreN} 个改装模块）`:""}${modTag}${w.uniqPerk?'，<b style="color:#ffd23f">具名装备</b>':''}${w.pellets>1?`，<b style="color:#ffd54a">${w.pellets} ${w.type==="shotgun"?"弹片":"发/次"}</b>`:''}</div>
    ${w.uniqPerk?`<div class="uniq-perk">✦ ${w.uniqPerk}</div>`:''}
    <div class="si-stats">${gunDamageLabel(w)}，弹匣 ${w.mag}，射速 ${w.rpm}，${w.accuracy!==undefined?`精度 ${Math.round(w.accuracy*100)}%，`:""}${w.reload!==undefined?`换弹 ${w.reload}s，`:""}估值 ₽${priceTextShort(w.value)}
      ${parts.length?`<br><span class="part-row">${parts.map(partChip).join("")}</span>`:''}</div>
    ${opts.sell?`<div class="si-buy"><span class="si-price">₽ ${priceTextShort(sellP)}</span>
        <button class="btn ghost" data-sell="w:${w.uid}">售卖</button>
        <button class="btn ghost" data-salvage="${w.uid}">拆解</button></div>`:''}
  </div>`;
}



UI.raidStash=function(opts){
  opts=opts||{};
  const stash=RaidStash.load();
  if(!stash.parts) stash.parts=[];
  if(!stash.helmets) stash.helmets=[];
  const TAB=UI._stashTab||"weapon";

  /* v0.29.0：仓库装备一律按价值降序 —— 和配装大厅一致，贵的排前面，不用翻到底找。
     武器 / 护甲 / 头盔 / 护盾的售卖按钮按 uid 回指，安全；配件按原始下标回指（见 pCards）。 */
  const byValue=(arr)=>(arr||[]).slice().sort((a,b)=>(b.value||0)-(a.value||0));

  const wCards = stash.weapons.length ? byValue(stash.weapons).map(w=>raidWeaponCard(w,{sell:true})).join('') : `<div class="empty-hint">仓库暂无枪械</div>`;

  const aCards = stash.armors.length ? byValue(stash.armors).map(a=>{
    const rar=a.rarity|0;
    const dPct=Math.round(raidDurOf(a)*100), rc=raidRepairCost(a);
    /* v0.32.0：耐久越低颜色越暗（色相不变），修满即复原 */
    const col=raidDurTint(RAID_RARITY_COLOR[rar]||ARMOR_TIER_COLOR[a.tier], a.dur);
    return `<div class="shop-item" style="border-left-color:${col}">
      <div class="si-name" style="color:${col}">${a.name}<span style="font-size:11px;opacity:.9">，${RAID_RARITY_NAME[rar]}</span></div>
      <div class="si-meta">T${a.tier||"?"}，${RAID_RARITY_NAME[rar]}，耐久 <b style="color:${dPct<60?'#ff8a5a':'#8fe07a'}">${dPct}%</b>${a.armorRegen?('，待维修 '+a.armorRegen+'/s'):''}${a.uniqPerk?'，<b style="color:#ffd23f">具名装备</b>':''}</div>
      ${a.uniqPerk?`<div class="uniq-perk">✦ ${a.uniqPerk}</div>`:''}
      <div class="si-stats">减伤 ${Math.round((a.dr||0)*100)}%，护甲值 ${Math.round((a.maxArmor||0)*raidDurOf(a))}/${a.maxArmor}，估值 ₽${priceTextShort(a.value)}</div>
      <div class="si-buy"><span class="si-price">₽ ${priceTextShort((a.value||0)*RAID_VENDOR_RATE)}</span>
        ${dPct<100?`<button class="btn ghost" data-repair="a:${a.uid}">修理 ₽${priceTextShort(rc)}</button>`:""}
        <button class="btn ghost" data-sell="a:${a.uid}">售卖</button></div>
    </div>`;
  }).join('') : `<div class="empty-hint">仓库暂无护甲</div>`;

  const hCards = stash.helmets.length ? byValue(stash.helmets).map(h=>{
    const rar=h.rarity|0;
    const dPct=Math.round(raidDurOf(h)*100), rc=raidRepairCost(h);
    const col=raidDurTint(RAID_RARITY_COLOR[rar]||ARMOR_TIER_COLOR[h.tier], h.dur);
    return `<div class="shop-item" style="border-left-color:${col}">
      <div class="si-name" style="color:${col}">${h.name}<span style="font-size:11px;opacity:.9">，${RAID_RARITY_NAME[rar]}</span></div>
      <div class="si-meta">T${h.tier||"?"}，${RAID_RARITY_NAME[rar]}，耐久 <b style="color:${dPct<60?'#ff8a5a':'#8fe07a'}">${dPct}%</b>${h.uniqPerk?'，<b style="color:#ffd23f">具名装备</b>':''}</div>
      ${h.uniqPerk?`<div class="uniq-perk">✦ ${h.uniqPerk}</div>`:''}
      <div class="si-stats">爆头减伤 ${Math.round((h.dr||0)*100)}%，耐久 ${Math.round((h.maxArmor||0)*raidDurOf(h))}/${h.maxArmor}，估值 ₽${priceTextShort(h.value)}</div>
      <div class="si-buy"><span class="si-price">₽ ${priceTextShort((h.value||0)*RAID_VENDOR_RATE)}</span>
        ${dPct<100?`<button class="btn ghost" data-repair="h:${h.uid}">修理 ₽${priceTextShort(rc)}</button>`:""}
        <button class="btn ghost" data-sell="h:${h.uid}">售卖</button></div>
    </div>`;
  }).join('') : `<div class="empty-hint">仓库暂无头盔</div>`;

  const sCards = (stash.shields||[]).length
    ? byValue(stash.shields).map(s=>shieldCard(s,{sell:true})).join('')
    : `<div class="empty-hint">仓库暂无护盾，突袭掉落 / 工坊合成 / 融合 / 军火超市购买</div>`;

  /* v0.29.0：配件按价值降序。注意售卖 / 拆解按钮用的是**原始下标** i，
     所以先包成 [{pt,i}] 再排序，避免「排序后点售卖卖掉别的配件」。 */
  const pCards = stash.parts.length ? stash.parts
    .map((pt,i)=>({ pt, i }))
    .sort((x,y)=>partValue(y.pt)-partValue(x.pt))
    .map(({ pt, i })=>{
    const col=partColor(pt);
    const sn=GUN_SLOT_BY_ID[pt.slot]?GUN_SLOT_BY_ID[pt.slot].name:pt.slot;
    const qn=partQualityName(pt);
    const pv=partValue(pt);
    /* v0.21.6：配件可拆成原材料（先拆料，再拿料开工） */
    const sv=raidSalvageYield(pt);
    const svTxt=sv?`<div class="si-stats" style="color:#8fe07a;opacity:.85">拆解可得 ${sv.map(x=>`${(RAID_MAT_BY_ID[x.id]||{}).name||x.id}×${x.n}`).join(" + ")}</div>`
                  :`<div class="si-stats" style="opacity:.55">改装模块，不可拆解</div>`;
    return `<div class="shop-item" style="border-left-color:${col}">
      <div class="si-name" style="color:${col}">${partNameOf(pt)}${qn?`<span style="font-size:11px;opacity:.85">，${qn}</span>`:""}</div>
      <div class="si-meta">配件，${sn}槽位${weaponQualityHidden()?"":`，iLv ${pt.ilvl||1}`}</div>
      ${weaponQualityHidden()?"":`<div class="si-stats">${partText(pt)}</div>`}
      ${svTxt}
      <div class="si-buy"><span class="si-price">₽ ${priceTextShort(pv*0.6)}</span>
        <button class="btn ghost" data-sell="p:${i}">售卖</button>
        ${sv?`<button class="btn ghost" data-partsalvage="${i}">拆解</button>`:""}</div>
    </div>`;
  }).join('') : `<div class="empty-hint">配件池为空，拆解枪械或去超市配件页采购</div>`;

  // 材料页：同种材料合并成堆（按 id 聚合），显示数量 / 单件估值 / 合计
  const matStacks=[];
  for(const m of (stash.materials||[])){
    let s=matStacks.find(x=>x.id===m.id);
    if(!s){ s={ id:m.id, item:m, n:0 }; matStacks.push(s); }
    s.n++;
  }
  // v0.29.0：材料按「这一堆的合计价值」降序（贵的堆排前面，不再按 tier 升序）
  matStacks.sort((a,b)=>((b.item.value||0)*b.n)-((a.item.value||0)*a.n));
  const mCards = matStacks.length ? matStacks.map(s=>{
    const m=s.item, col=RAID_RARITY_COLOR[m.tier]||"#dfe7f0";
    return `<div class="shop-item" style="border-left-color:${col}">
      <div class="si-name" style="color:${col}">${m.name}<span style="font-size:12px;font-weight:800;opacity:.85"> ×${s.n}</span></div>
      <div class="si-meta">${RAID_TIERS[m.tier]?RAID_TIERS[m.tier].name:"普通"}，T${m.tier}，${(RAID_MAT_BY_ID[m.id]||{}).tag||"材料"}</div>
      <div class="si-stats">单价 ₽${priceTextShort(m.value)}，合计 ₽${priceTextShort((m.value||0)*s.n)}</div>
      <div class="si-buy"><span class="si-price">₽ ${priceTextShort(Math.round((m.value||0)*0.6))}</span>
        <button class="btn ghost" data-sell="m:${m.id}">售卖 1 份</button></div>
    </div>`;
  }).join('') : `<div class="empty-hint">仓库暂无原材料，去突袭里搜刮，或在结算时带出</div>`;

  const tabs=[{id:'weapon',name:'武器',n:stash.weapons.length},{id:'armor',name:'护甲',n:stash.armors.length},
    {id:'helmet',name:'头盔',n:stash.helmets.length},{id:'shield',name:'护盾',n:(stash.shields||[]).length},
    {id:'part',name:'配件',n:stash.parts.length},
    {id:'mat',name:'材料',n:matStacks.reduce((s,x)=>s+x.n,0)}];
  const body = TAB==='weapon'?wCards : TAB==='armor'?aCards : TAB==='helmet'?hCards : TAB==='shield'?sCards : TAB==='mat'?mCards : pCards;
  const backLabel = opts.from==='title' ? '返回主菜单' : '前往配装大厅';

  UI._set(`
    <div class="panel raid-setup">
      <h2 class="title-big" style="font-size:32px;">仓库</h2>
      <div class="subtitle">STASH · 售卖换卢布 / 拆解换配件</div>
      <div class="shop-bar">
        <div class="shop-desc">背包直售只按估值 <b style="color:#ff8a5a">50%</b> 回收卢布（<b style="color:#62c8ff">带进图卖给回收超市，收购单上的品类可得 2~3 倍</b>）；拆解会把枪上的全部配件拆进配件池（枪本身消失），配件可装到别的枪上或在配件页卖掉。</div>
        <div class="shop-gold">仓库卢布 ₽ ${priceTextShort(stash.creds)}</div>
        <button class="btn ghost" id="btn-stash-back">${backLabel}</button>
      </div>
      <div class="shop-tabs">
        ${tabs.map(t=>`<button class="shop-tab ${TAB===t.id?'on':''}" data-stab="${t.id}"><b>${t.name}</b><span class="tab-tag">${t.n}</span></button>`).join('')}
      </div>
      <div class="shop-list">${body}</div>
      <div class="hint" style="margin-top:12px;">提示：拆解高品阶枪械能得到高品质配件，再装到喜欢的枪上，比直接卖掉更划算。</div>
    </div>`);

  UI.overlay.querySelectorAll('[data-stab]').forEach(el=>{
    el.onclick=()=>{ UI._stashTab=el.dataset.stab; SFX.ui(); UI.raidStash(opts); };
  });

  UI.overlay.querySelectorAll('[data-partsalvage]').forEach(el=>{
    el.onclick=()=>{
      const st=RaidStash.load();
      const i=parseInt(el.dataset.partsalvage,10)||0;
      const pt=(st.parts||[])[i];
      if(!pt) return;
      const y=raidSalvageYield(pt);
      if(!y || !y.length){ UI.toast && UI.toast("改装模块不能拆解"); return; }
      st.parts.splice(i,1);
      st.materials=st.materials||[];
      const names=[];
      for(const g of y){
        const base=RAID_MAT_BY_ID[g.id];
        if(!base) continue;
        for(let k=0;k<g.n;k++)
          st.materials.push({ id:base.id, name:base.name, tier:base.tier, value:base.value, tag:base.tag });
        names.push(base.name+"×"+g.n);
      }
      RaidStash.save(st); SFX.pickup();
      UI.toast && UI.toast(`已拆解 ${partNameOf(pt)}，获得 ${names.join(" + ")}`);
      UI.raidStash(opts);
    };
  });
  /* v0.32.0：装备修理 —— 花卢布把 dur 修回 1，颜色与护甲值一起复原 */
  UI.overlay.querySelectorAll('[data-repair]').forEach(el=>{
    el.onclick=()=>{
      const [kind,key]=el.dataset.repair.split(':');
      const list = kind==='a'?stash.armors : kind==='h'?stash.helmets : (stash.shields||[]);
      const it=(list||[]).find(x=>x.uid===key); if(!it) return;
      const cost=raidRepairCost(it);
      if(cost<=0) return;
      if((stash.creds||0)<cost){ SFX.ui(); if(UI.game) UI.game.toast("卢布不足：修理需要 ₽"+priceText(cost)); return; }
      stash.creds-=cost; it.dur=1;
      RaidStash.save(stash); SFX.ui();
      if(UI.game) UI.game.toast("已修理，"+it.name);
      UI.raidStash({from:opts.from});
    };
  });
  UI.overlay.querySelectorAll('[data-sell]').forEach(el=>{
    el.onclick=()=>{
      const [kind,key]=el.dataset.sell.split(':');
      if(kind==='w'){
        const i=stash.weapons.findIndex(w=>w.uid===key); if(i<0) return;
        const g=stash.weapons[i];
        stash.creds+=gunSellPrice(g); stash.weapons.splice(i,1);
      } else if(kind==='a'){
        const i=stash.armors.findIndex(a=>a.uid===key); if(i<0) return;
        stash.creds+=Math.round((stash.armors[i].value||0)*RAID_VENDOR_RATE); stash.armors.splice(i,1);
      } else if(kind==='h'){
        const i=stash.helmets.findIndex(h=>h.uid===key); if(i<0) return;
        stash.creds+=Math.round((stash.helmets[i].value||0)*RAID_VENDOR_RATE); stash.helmets.splice(i,1);
      } else if(kind==='s'){
        const i=(stash.shields||[]).findIndex(s=>s.uid===key); if(i<0) return;
        stash.creds+=Math.round((stash.shields[i].value||0)*RAID_VENDOR_RATE); stash.shields.splice(i,1);
      } else if(kind==='m'){
        // 材料按堆售卖：每次卖掉 1 份（同种材料在仓库里是合并显示的一堆）
        const i=(stash.materials||[]).findIndex(m=>m.id===key); if(i<0) return;
        const m=stash.materials[i];
        stash.creds+=Math.round((m.value||0)*RAID_VENDOR_RATE); stash.materials.splice(i,1);
      } else {
        const i=parseInt(key,10); if(isNaN(i)||!stash.parts[i]) return;
        stash.creds+=Math.round(partValue(stash.parts[i])*RAID_VENDOR_RATE); stash.parts.splice(i,1);
      }
      RaidStash.save(stash); SFX.ui(); UI.raidStash(opts);
    };
  });

  UI.overlay.querySelectorAll('[data-salvage]').forEach(el=>{
    el.onclick=()=>{
      const uid=el.dataset.salvage;
      const i=stash.weapons.findIndex(w=>w.uid===uid); if(i<0) return;
      const parts=salvageGun(stash.weapons[i]);
      for(const pt of parts){
        stash.parts.push(Object.assign({}, pt, {
          uid:"pt-"+Date.now()+"-"+Math.floor(Math.random()*1e6)
        }));
      }
      stash.weapons.splice(i,1);
      RaidStash.save(stash); SFX.ui();
      UI.toast && UI.toast(`已拆解，配件池 +${parts.length} 件`);
      UI.raidStash(opts);
    };
  });

  document.getElementById('btn-stash-back').onclick=()=>{
    SFX.ui();
    if(opts.from==='title') UI.title(); else UI.raidSetup();
  };
};

/* =========================================================================
 * 联机突袭，大厅
 *   创建 / 加入房间 → 等待房主开始 → 用同一 seed 进图
 * ========================================================================= */
/* 昵称是纯本地偏好：读不到就留空（界面会自动回落到 PMC），不必告警 */
UI._onlineNick = Store.get("raid_nick", "");
UI._onlineMsg  = "";
UI._onlineBusy = false;

UI._onlineStop=function(){
  if(UI._onlineTimer){ clearInterval(UI._onlineTimer); UI._onlineTimer=null; }
};

UI._onlineCarryText=function(){
  const stash=RaidStash.load(), sel=UI._raidSel||{w:[],a:null,h:null};
  const ws=(sel.w||[]).map(uid=>{ const w=stash.weapons.find(x=>x.uid===uid); return w?w.name:null; }).filter(Boolean);
  const a=sel.a?stash.armors.find(x=>x.uid===sel.a):null;
  const h=sel.h?(stash.helmets||[]).find(x=>x.uid===sel.h):null;
  const bits=[];
  bits.push(ws.length?ws.join(" + "):"空手");
  if(a) bits.push(a.name);
  if(h) bits.push(h.name);
  return bits.join("，");
};

UI._onlineEnter=function(){
  if(UI._onlineEntering) return;
  if(!Net.code || !Net.peerId) return;
  UI._onlineEntering=true;
  UI._onlineStop();
  const sel=UI._raidSel||{w:[],a:null,h:null,s:null};
  const st=RaidStash.load();
  // 联机也必须沿用大厅选择的钥匙/现金/GP 币，不能默认把仓库全部钥匙带进图。
  const pickedKeys=Array.isArray(UI._raidKeys)?UI._raidKeys.slice():(st.keys||[]).map(k=>k.uid);
  const cash=Math.max(0,Math.min(Math.round(UI._raidCash||0),Math.floor(st.creds||0)));
  const tokens=Math.max(0,Math.min(Math.round(UI._raidTok||0),Math.floor(st.tokens||0)));
  // v0.21.9：与单机出发保持一致 —— 护盾 / 弹药 / 初始装备包原先漏传，联机进图全丢；
  // hasGear 也补上护盾，只带盾进场时保险不再被静默置否。
  const ammoPick={};
  for(const cal of AMMO_CAL_LIST){
    const a=UI._raidAmmo && UI._raidAmmo[cal];
    if(a && a.n>0) ammoPick[cal]={ id:a.id, n:a.n };
  }
  const supOn=UI._raidSupport===true && cash>=RAID_SUPPORT_CASH;
  const hasGear=!!((sel.w||[]).length||sel.a||sel.h||sel.s);
  const opts={
    weapons:[...(sel.w||[])], armor:sel.a||null, helmet:sel.h||null, shield:sel.s||null,
    insure:!!UI._raidIns&&hasGear, keys:pickedKeys, cash, tokens,
    ammo:ammoPick, support:supOn,
    online:true, seed:Net.seed,
  };
  UI._raidSel={w:[],a:null,h:null,s:null}; UI._raidIns=false;
  try{ game.startRaid(opts); }
  catch(e){
    console.error(e);
    UI._onlineMsg="进入战区失败，装备已退回仓库";
    UI._onlineStop();
    try{ Net.leave(true); }catch(e2){ warnOnce("ui:leave", e2); }
    game.toTitle();
    UI.raidSetup();
  }
  setTimeout(()=>{ UI._onlineEntering=false; },1600);
};

UI.raidOnline=function(){
  const inRoom = !!(Net.code && Net.peerId);
  const busy = UI._onlineBusy;
  const p2p = Net.transport==="p2p" || (typeof NetP2P!=="undefined" && !!NetP2P.mode);
  const esc=s=>String(s==null?"":s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const msg = UI._onlineMsg ? `<div class="hint" style="color:#ffb347">${esc(UI._onlineMsg)}</div>` : "";

  let body="";
  if(!inRoom){
    body=`
      <div class="online-grid">
        <div class="online-card">
          <h3>创建房间</h3>
          <p>你是房主：负责模拟 AI，其他人加入你的战区。</p>
          <label class="online-label">呼号</label>
          <input class="online-input" id="online-nick" maxlength="16" placeholder="例如：雪松" value="${esc(UI._onlineNick||"")}">
          <button class="btn" id="online-create" ${busy?'disabled':''}>创建房间</button>
        </div>
        <div class="online-card">
          <h3>加入房间</h3>
          <p>向房主要 4 位房间码，输入后即可进入同一战区。</p>
          <label class="online-label">房间码</label>
          <input class="online-input" id="online-code" maxlength="4" placeholder="ABCD"
                 style="text-transform:uppercase;letter-spacing:4px;font-weight:900;">
          <button class="btn ghost" id="online-join" ${busy?'disabled':''}>加入房间</button>
        </div>
      </div>
      ${msg}`;
  } else {
    const room=Net.room||{peers:[{id:Net.peerId,name:Net.name,host:Net.isHost}]};
    const peers=room.peers||[];
    const rows=peers.map(p=>`
      <div class="online-peer ${p.id===Net.peerId?'me':''}">
        <span class="online-dot" style="background:${p.host?'#ffd23f':'#7ee08a'}"></span>
        <b>${esc(p.name||"PMC")}</b>
        ${p.host?'<span class="online-tag host">房主</span>':''}
        ${p.id===Net.peerId?'<span class="online-tag me">你</span>':''}
      </div>`).join("");
    body=`
      <div class="online-room">
        <div class="online-code-box">
          <div class="online-code-label">房间码</div>
          <div class="online-code" id="online-code-show">${Net.code}</div>
          <button class="btn ghost small" id="online-copy">复制</button>
        </div>
        <div class="online-room-info">
          <div class="online-sec">玩家 ${peers.length}/4</div>
          <div class="online-peers">${rows}</div>
          <div class="online-sec">你的携带</div>
          <div class="online-carry">${esc(UI._onlineCarryText())}</div>
          <div class="online-sec">规则</div>
          <div class="online-rules">同一张地图 / 同一批 AI / 箱子先到先得，队友无友伤，撤离与战利品各自结算</div>
          <div class="row" style="margin-top:14px;justify-content:flex-start;">
            ${Net.isHost
              ? `<button class="btn" id="online-start" ${busy?'disabled':''}>开始突袭</button>`
              : `<button class="btn ghost" disabled>等待房主开始…</button>`}
            <button class="btn ghost" id="online-leave">离开房间</button>
          </div>
        </div>
      </div>
      ${msg}`;
  }

  UI._set(`
    <div class="panel raid-setup">
      <h2 class="title-big" style="font-size:32px;">联机突袭</h2>
      <div class="subtitle">CO-OP RAID · 2~4 人，${p2p?"WebRTC P2P 直连":"房主权威 AI"}，战利品各自带出</div>
      <div class="shop-bar">
        <div class="shop-desc">和队友进入<b style="color:#7ee08a">同一张地图</b>：地图、箱子、撤离点、增援都一致；<b style="color:#ffd23f">AI 由房主统一模拟</b>，其他人实时同步。箱子<b>先到先得</b>，队友之间<b style="color:#8fe07a">没有友伤</b>，撤离与结算<b>各自独立</b>——你带出的东西只进你自己的仓库。</div>
        <button class="btn ghost" id="online-back">返回配装大厅</button>
      </div>
      ${body}
      <div class="hint" style="margin-top:14px;">联机只影响突袭内：大厅、仓库、拍卖行仍然是<b>各自独立</b>的。${p2p
        ? "当前为 <b style='color:#7ee08a'>GitHub Pages 直连模式</b>：PeerJS 公共信令 + WebRTC，房主离开即结束；双方都在严格 NAT 后可能连不上，可换用官方 server.js 部署。"
        : "掉线后 60 秒内可用同一房间重新加入（需要原 peer 身份）。"}</div>
    </div>`, !!UI._onlineKeep);
  if(!UI._onlineKeep){
    UI._onlineKeep=true;
    const ov=UI.overlay, pan=ov?ov.querySelector('.panel'):null;
    if(ov) ov.scrollTop=0;
    if(pan) pan.scrollTop=0;
  }

  const back=document.getElementById('online-back');
  if(back) back.onclick=async()=>{ SFX.ui(); UI._onlineStop(); UI._onlineKeep=false; if(Net.code) await Net.leave(true); UI.raidSetup(); };

  if(!inRoom){
    const nick=document.getElementById('online-nick');
    const code=document.getElementById('online-code');
    const readNick=()=>{
      const v=(nick.value||"").trim().slice(0,16)||"PMC";
      UI._onlineNick=v; Store.set("raid_nick", v);
      return v;
    };
    const create=document.getElementById('online-create');
    if(create) create.onclick=async()=>{
      if(UI._onlineBusy) return;
      UI._onlineBusy=true; UI._onlineMsg="正在创建房间…"; UI.raidOnline();
      const r=await Net.create(readNick());
      UI._onlineBusy=false;
      if(!r.ok){ UI._onlineMsg=r.msg||"创建失败"; UI.raidOnline(); return; }
      UI._onlineMsg=""; UI._onlineStartPoll(); UI.raidOnline();
    };
    const join=document.getElementById('online-join');
    if(join) join.onclick=async()=>{
      if(UI._onlineBusy) return;
      const c=(code.value||"").trim().toUpperCase();
      if(c.length<4){ UI._onlineMsg="房间码是 4 位字母/数字"; UI.raidOnline(); return; }
      UI._onlineBusy=true; UI._onlineMsg="正在加入…"; UI.raidOnline();
      const r=await Net.join(c, readNick());
      UI._onlineBusy=false;
      if(!r.ok){ UI._onlineMsg=r.msg||"加入失败"; UI.raidOnline(); return; }
      UI._onlineMsg=""; UI._onlineStartPoll(); UI.raidOnline();
    };
  } else {
    const copy=document.getElementById('online-copy');
    if(copy) copy.onclick=async()=>{
      SFX.ui();
      try{ await navigator.clipboard.writeText(Net.code); UI._onlineMsg="房间码已复制"; }
      catch(e){ UI._onlineMsg="复制失败，请手动记下："+Net.code; }
      UI.raidOnline();
    };
    const leave=document.getElementById('online-leave');
    if(leave) leave.onclick=async()=>{ SFX.ui(); UI._onlineStop(); await Net.leave(true); UI._onlineMsg="已离开房间"; UI.raidOnline(); };
    const start=document.getElementById('online-start');
    if(start) start.onclick=async()=>{
      if(UI._onlineBusy) return;
      UI._onlineBusy=true; UI._onlineMsg="正在开始…";
      const r=await Net.startRoom();
      UI._onlineBusy=false;
      if(!r.ok){ UI._onlineMsg=r.msg||"开始失败"; UI.raidOnline(); return; }
      UI._onlineMsg=""; UI._onlineEnter();
    };
    UI._onlineStartPoll();
  }
};

UI._onlineStartPoll=function(){
  UI._onlineStop();
  UI._onlineTimer=setInterval(async()=>{
    if(!UI.overlay || UI.overlay.classList.contains('hidden') ||
       !document.getElementById('online-code-show')){
      UI._onlineStop(); return;
    }
    const r=await Net.pollRoom();
    if(!r){ return; }
    if(r.started && Net.code){
      // 房主已经点了开始：所有客户端一起进图
      UI._onlineEnter();
      return;
    }
    // 玩家列表有变化才重绘，避免一直闪
    const sig=(r.room&&r.room.peers?r.room.peers.map(p=>p.id+p.name).join("|"):"")+":"+(r.host?1:0);
    if(sig!==UI._onlineSig){ UI._onlineSig=sig; UI._keepScroll(()=>UI.raidOnline()); }
  },1400);
};


/* v0.36.0：地面装备对比面板（从 raid-render 迁入，保持分片行数上限）*/
Object.assign(RenderRaid, {
  _groundGunPanel(ctx, R, c, v, hintY){
    const drops=(c && c.drops)||[];
    const GEAR=["weapon","shield","armor","helmet"];
    // 武器优先（玩家最常换的就是枪），其次护盾 / 护甲 / 头盔
    let g=null;
    for(const k of GEAR){ g=drops.find(d=>d && d.kind===k); if(g) break; }
    if(!g) return;
    const kind=g.kind, p=R.player||{}, carried=R.carried||{};
    /* 当前装备：枪看主手，护盾看身上模块，护甲/头盔看 carried（带入的那件）。
       裸装进场时 carried 为空但玩家仍可能被 AI 掉落/设施临时上了甲，用 tier 兜底。 */
    const cur = kind==="weapon" ? (p.gun||null)
      : kind==="shield" ? (p.shieldGear||null)
      : kind==="armor"  ? (carried.armor || (p.armorTier?{maxArmor:p.maxArmor,dr:p.dr,tier:p.armorTier,value:0}:null))
      : (carried.helmet || (p.helmetTier?{maxArmor:p.maxHelmetArmor,dr:p.helmetDr,tier:p.helmetTier,value:0}:null));
    /* 数值格式化：估值动辄七位数，直接拼数字既撑破面板也没法一眼比大小 */
    const fmt=(n,big)=>{
      n=Math.round(n||0);
      if(!big) return String(n);
      if(n>=1000000) return "₽"+(n/1000000).toFixed(2)+"M";
      if(n>=10000) return "₽"+(n/1000).toFixed(1)+"k";
      return "₽"+n;
    };
    const rows = kind==="weapon" ? [
      { k:"伤害", a:Math.round(g.dmg||0), b:cur?Math.round(cur.dmg||0):0 },
      { k:"弹匣", a:Math.round(g.mag||0), b:cur?Math.round(cur.mag||0):0 },
      { k:"射速", a:Math.round(g.rpm||0), b:cur?Math.round(cur.rpm||0):0 },
      { k:"估值", a:Math.round(g.value||0), b:cur?Math.round(cur.value||0):0, big:true },
    ] : kind==="shield" ? [
      { k:"容量", a:Math.round(g.capacity||0), b:cur?Math.round(cur.capacity||0):0 },
      { k:"充能/s", a:Math.round(g.rate||0), b:cur?Math.round(cur.rate||0):0 },
      { k:"延迟s", a:Math.round(g.delay||0), b:cur?Math.round(cur.delay||0):0 },
      { k:"估值", a:Math.round(g.value||0), b:cur?Math.round(cur.value||0):0, big:true },
    ] : [
      { k:"耐久", a:Math.round(g.maxArmor||0), b:cur?Math.round(cur.maxArmor||0):0 },
      { k:"减伤%", a:Math.round((g.dr||0)*100), b:cur?Math.round((cur.dr||0)*100):0 },
      { k:"品阶", a:Math.round(g.tier||0), b:cur?Math.round(cur.tier||0):0 },
      { k:"估值", a:Math.round(g.value||0), b:cur?Math.round(cur.value||0):0, big:true },
    ];
    const title = kind==="weapon" ? (gunNameOf(g)||"地上枪械")
      : kind==="shield" ? (g.name||"地上护盾")
      : kind==="armor" ? (g.name||"地上护甲") : (g.name||"地上头盔");
    const tint = kind==="weapon" ? raidGunColor(g)
      : kind==="shield" ? shieldColor(g)
      : (RAID_RARITY_COLOR[g.rarity|0]||"#dfe7f0");
    const W=276, H=34+rows.length*20+10;
    const x=Math.max(8, Math.min(v.w-W-8, v.w/2+28));
    const y=Math.max(8, Math.min(v.h-H-8, hintY-H-16));
    ctx.save();
    ctx.fillStyle="rgba(8,12,16,0.90)"; ctx.fillRect(x,y,W,H);
    ctx.strokeStyle="rgba(120,150,180,0.45)"; ctx.lineWidth=1; ctx.strokeRect(x+0.5,y+0.5,W-1,H-1);
    ctx.textAlign="left";
    ctx.font="bold 12px system-ui,sans-serif";
    ctx.fillStyle=tint;
    ctx.fillText(String(title).slice(0,18), x+10, y+18);
    /* 溢出标记：让玩家知道「这几件是我背包塞不下才留在这的」 */
    if(c.spill){
      ctx.textAlign="right"; ctx.fillStyle="#ff8a5a";
      ctx.font="10px system-ui,sans-serif"; ctx.fillText("背包溢出", x+W-10, y+18);
      ctx.textAlign="left";
    }
    ctx.font="10px system-ui,sans-serif"; ctx.fillStyle="rgba(180,195,210,0.75)";
    ctx.fillText(cur
      ? (kind==="weapon"?"左：地上 / 右：手持":"左：地上 / 右：已穿戴")
      : (kind==="weapon"?"手持为空，直接拾取":"当前未装备，可直接穿戴"), x+10, y+32);
    ctx.font="11px system-ui,sans-serif";
    for(let i=0;i<rows.length;i++){
      const r=rows[i], ry=y+50+i*20;
      // 身上没同类装备时不做对比，免得每一行都亮成「提升」
      const better=!!cur && r.a>r.b, worse=!!cur && r.a<r.b;
      ctx.fillStyle="rgba(200,212,224,0.85)"; ctx.fillText(r.k, x+10, ry);
      ctx.fillStyle=better?"#8fe07a":worse?"#ff8a5a":"#dfe7f0";
      ctx.textAlign="right"; ctx.fillText(fmt(r.a,r.big)+(better?" ▲":worse?" ▼":""), x+168, ry);
      ctx.fillStyle="rgba(170,185,200,0.70)"; ctx.fillText(cur?fmt(r.b,r.big):"—", x+W-10, ry);
      ctx.textAlign="left";
    }
    ctx.restore();
  },
});
