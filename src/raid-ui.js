/* =========================================================================
 * raid-ui.js — 联机大厅 / 配装 / 结算 / 商店 UI 补丁（第 1 段）
 * v0.22.0：由 raid.js 按自然边界物理拆分，逻辑零改写。经典脚本按 index.html 顺序加载，
 * 共享同一全局词法作用域。verify 的 raidSrc 会聚合全部 raid-*.js 做源码断言。
 * ========================================================================= */
UI.raidSetup=function(){
  // 回大厅先结算拍卖行（到期的成交 / 退款 / 流拍退回）
  /* 拍卖结算失败不该挡住进大厅（否则玩家卡在加载页），
     但它涉及钱和物品的退回，必须留痕而不是静默吞掉。 */
  if(typeof Auction!=="undefined"){
    try{ Auction.settle(); }
    catch(e){ console.warn("[Auction] 进大厅结算失败，到期挂单可能未及时收尾", e); }
  }
  const stash=RaidStash.load();
  const auc = (typeof Auction!=="undefined") ? Auction.counts() : { listings:0, mine:0 };
  if(!UI._raidSel) UI._raidSel={ w:[], a:null, h:null, s:null };
  if(UI._raidIns===undefined) UI._raidIns=false;
  // v0.21.3：初始装备包改成**默认不勾选**（要花 ₽512 买，别默认从玩家现金里扣钱）
  if(UI._raidSupport===undefined) UI._raidSupport=false;
  const sel=UI._raidSel;
  if(sel.h===undefined) sel.h=null;
  if(sel.s===undefined) sel.s=null;
  if(!stash.shields) stash.shields=[];
  // 清理已不存在的 uid
  sel.w=sel.w.filter(uid=>stash.weapons.some(w=>w.uid===uid));
  if(sel.a && !stash.armors.some(a=>a.uid===sel.a)) sel.a=null;
  if(sel.h && !(stash.helmets||[]).some(h=>h.uid===sel.h)) sel.h=null;
  if(sel.s && !stash.shields.some(s=>s.uid===sel.s)) sel.s=null;
  if(!sel.w.length && !sel.a && !sel.h && !sel.s) UI._raidIns=false;
  /* 钥匙串改为「可选携带」——v0.20.1 起默认一把不带，点卡片逐把勾选。
   * 带进图的钥匙死了就丢，留在仓库的绝对安全，玩家自己权衡。 */
  /* v0.20.1：钥匙默认一把都不带（丢了就没了）；玩家想冒险再逐把勾选 */
  if(!Array.isArray(UI._raidKeys)) UI._raidKeys=[];
  UI._raidKeys=UI._raidKeys.filter(uid=>(stash.keys||[]).some(k=>k.uid===uid));

  /* v0.25.0：开局配装列表按估值从高到低排。
   * 仓库里动辄几十把枪，原来按入库顺序排，越贵的越可能被压在列表底部 ——
   * 玩家要翻很久才能找到「这局想带的那件」。排序只改展示顺序，不改 _raidSel（按 uid 存）。 */
  const byValue=arr=>(arr||[]).slice().sort((a,b)=>(b.value||0)-(a.value||0));

  const wcards = stash.weapons.length ? byValue(stash.weapons).map(w=>{
    const on=sel.w.includes(w.uid);
    const col=raidGunColor(w);
    const tname=WEAPON_TYPES[w.type]?WEAPON_TYPES[w.type].name:w.cat;
    const elem=w.element&&w.element!=="none"?(ELEMENTS[w.element]?ELEMENTS[w.element].name:""):"";
    return `<div class="raid-item ${on?'sel':''}" data-w="${w.uid}">
      <div class="ri-name" style="color:${col}">${gunNameOf(w)}</div>
      <div class="ri-meta">${tname}${elem?('，'+elem):''}，${gunDamageLabel(w)}，弹匣 ${w.mag}，射速 ${w.rpm}，配件 ${(w.parts||[]).length}</div>
      ${w.uniqPerk?`<div class="ri-meta" style="color:#ffd23f">✦ ${w.uniqPerk}</div>`:''}
      <div class="ri-val">估值 ₽${priceTextShort(w.value)}${on?'，已携带':''}</div>
    </div>`;
  }).join('') : `<div class="empty-hint">仓库暂无枪械，打一局搜到武器并撤离即可入库</div>`;

  const acards = stash.armors.length ? byValue(stash.armors).map(a=>{
    const on=sel.a===a.uid;
    const rar=a.rarity|0;
    const col=RAID_RARITY_COLOR[rar];
    return `<div class="raid-item ${on?'sel':''}" data-a="${a.uid}">
      <div class="ri-name" style="color:${col}">${a.name}<span style="font-size:11px;opacity:.9">，${RAID_RARITY_NAME[rar]}</span></div>
      <div class="ri-meta">T${a.tier}，${RAID_RARITY_NAME[rar]}，减伤 ${Math.round(a.dr*100)}%，护甲值 ${a.maxArmor}${a.armorRegen?('，待维修 '+a.armorRegen+'/s'):''}</div>
      <div class="ri-meta" style="color:#9fd0ff">词条：${(a.affixes||[]).map(x=>x.nm).join("，")||"—"}</div>
      <div class="ri-val">估值 ₽${priceTextShort(a.value)}${on?'，已穿戴':''}</div>
    </div>`;
  }).join('') : `<div class="empty-hint">没有护甲，去军火超市买 T1~T9</div>`;

  const hcards = (stash.helmets||[]).length ? byValue(stash.helmets).map(h=>{
    const on=sel.h===h.uid;
    const rar=h.rarity|0;
    const col=RAID_RARITY_COLOR[rar];
    return `<div class="raid-item ${on?'sel':''}" data-h="${h.uid}">
      <div class="ri-name" style="color:${col}">${h.name}<span style="font-size:11px;opacity:.9">，${RAID_RARITY_NAME[rar]}</span></div>
      <div class="ri-meta">T${h.tier}，${RAID_RARITY_NAME[rar]}，爆头减伤 ${Math.round(h.dr*100)}%，耐久 ${h.maxArmor}${h.armorRegen?('，待维修 '+h.armorRegen+'/s'):''}</div>
      <div class="ri-meta" style="color:#9fd0ff">词条：${(h.affixes||[]).map(x=>x.nm).join("，")||"—"}</div>
      <div class="ri-val">估值 ₽${priceTextShort(h.value)}${on?'，已戴上':''}</div>
    </div>`;
  }).join('') : `<div class="empty-hint">没有头盔，头盔可减免爆头伤害</div>`;

  const scards = stash.shields.length ? byValue(stash.shields).map(s=>{
    const on=sel.s===s.uid, col=shieldColor(s);
    return `<div class="raid-item ${on?'sel':''}" data-s="${s.uid}">
      <div class="ri-name" style="color:${col}">${s.name}<span style="font-size:11px;opacity:.9">，${shieldGrade(qOf(s)).name}</span></div>
      <div class="ri-meta">T${s.tier}，${(s.parts||[]).length} 个配件，${shieldLines(s).slice(0,3).join("，")}</div>
      <div class="ri-meta" style="color:#9fd0ff">前后缀：${(s.affixes||[]).map(x=>x.nm).join("，")||"—"}${s.uniqPerk?'，<b style="color:#ffd23f">具名</b>':''}</div>
      <div class="ri-val">估值 ₽${priceTextShort(s.value)}${on?'，已装备':''}</div>
    </div>`;
  }).join('') : `<div class="empty-hint">没有护盾，工坊合成 / 融合 / 箱子掉落 / 军火超市购买</div>`;

  const keysAll=stash.keys||[];
  const keySet=new Set(UI._raidKeys);

  /* ---------------- 弹药携带（v0.20.0） ----------------
   * 每个口径一行：默认选「仓库里该口径最高级别」的一种，按钮选带多少发。
   * UI._raidAmmo = { light:{id,n}, mid:{...} } —— 传进 Raid 后由 _prepPlayerAmmo 搬进背包。 */
  if(!UI._raidAmmo || typeof UI._raidAmmo!=="object") UI._raidAmmo={};
  const ammoStock=stash.ammo||{};
  const ammoRows=AMMO_CAL_LIST.map(cal=>{
    const have=[];
    for(let lv=5; lv>=1; lv--){
      const id=ammoItemId(cal, lv), n=ammoStock[id]||0;
      if(n>0) have.push({ id, lv, n });
    }
    const C=AMMO_CALS[cal];
    const sel=UI._raidAmmo[cal];
    const cur=have.find(h=>sel && sel.id===h.id) || have[0] || null;
    if(!cur){
      /* v0.21.3：这里不再放「买 60 发」的购买入口 —— 买子弹统一去军火超市的「子弹」页 */
      delete UI._raidAmmo[cal];
      return { cal, html:`<div class="ri" style="cursor:default;">
        <div class="ri-main">
          <div class="ri-name" style="color:#8b95a5">${C.name}，无库存</div>
          <div class="ri-meta">${C.spec}，适用 ${C.types.map(t=>WEAPON_TYPES[t]?WEAPON_TYPES[t].name:t).join(" / ")}</div>
        </div>
        <div class="ri-val" style="color:#8b95a5;font-size:11px;">去「军火超市，子弹」购买，或在工坊「弹药」页合成</div>
      </div>` };
    }
    const cap=Math.min(cur.n, RAID_AMMO_CAP);
    /* v0.32.0（用户反馈「仓库弹药带不进去」）：默认改成**带 3 条（90 发）**。
       v0.20.1 原本默认 0 发，理由是「弹药要自己负责」，但结果是玩家拖都没拖就空枪进图、
       以为功能坏了。现在默认够打一两轮遭遇战，不够打完一局 —— 仍然要自己负责搜刮。
       玩家拖过滑动条后以他选的数量为准（sel 存在就不覆盖）。 */
    const n=(sel && sel.id===cur.id) ? Math.max(0, Math.min(sel.n|0, cap))
                                    : Math.min(cap, RAID_AMMO_STACK*3);
    UI._raidAmmo[cal]={ id:cur.id, n, cap };
    /* v0.21.3：携带数量改成滑动条（和带入现金一致）—— 0 ~ 该口径库存，步长 30 发。
     * 购买入口全部撤掉，买子弹去军火超市的「子弹」页 / 工坊合成。 */
    const step=Math.max(1, Math.min(RAID_AMMO_STACK, Math.floor(cap/4)||1));
    return { cal, html:`<div class="ri" style="cursor:default;flex-wrap:wrap;gap:8px;">
        <div class="ri-main" style="flex:1 1 240px;">
          <div class="ri-name" style="color:${C.color}">${C.name}，${(AMMO_GRADE_BY_LV[cur.lv]||{}).name||"T"+cur.lv}</div>
          <div class="ri-meta">${C.spec}，适用 ${C.types.map(t=>WEAPON_TYPES[t]?WEAPON_TYPES[t].name:t).join(" / ")}，库存 ${cur.n} 发</div>
        </div>
        <div class="ri-val" style="display:flex;gap:8px;align-items:center;flex:0 0 auto;">
          <input id="rc-ammo-${cal}" type="range" min="0" max="${cap}" step="${step}" value="${n}"
            style="width:170px;vertical-align:middle;">
          <b id="rc-ammo-val-${cal}" style="min-width:78px;text-align:right;color:#ffd36a;font-variant-numeric:tabular-nums;">${n} / ${cap}</b>
        </div>
      </div>` };
  });
  const ammoCards=ammoRows.map(r=>r.html).filter(Boolean).join("")
    || `<div class="empty-hint">仓库没有弹药，去工坊合成或在军火超市购买</div>`;
  const ammoCarried=Math.min(RAID_AMMO_CAP,
    Object.keys(UI._raidAmmo).reduce((sum,k)=>sum+(UI._raidAmmo[k].n||0),0));
  const keyCards = keysAll.length ? keysAll.map(k=>{
    const on=keySet.has(k.uid);
    const lv=M.clamp(k.lv||1,1,5);
    return `<div class="raid-item ${on?'sel':''}" data-key="${k.uid}" style="cursor:pointer;">
      <div class="ri-name" style="color:${k.color||raidKeyDef(lv).color}">${k.name}</div>
      <div class="ri-meta">${RAID_LOCK_NAME[lv]}，可开 ${k.uses}/${k.maxUses||k.uses} 次，估值 ₽${priceTextShort(k.value||0)}</div>
      <div class="ri-val" style="color:${on?'#8fe07a':'#8b95a5'}">${on?'✓ 装进钥匙串':'○ 留在仓库'}</div>
    </div>`;
  }).join('') : `<div class="empty-hint">仓库没有钥匙，开箱掉落 / 材料商店 / 黑市购买，或在工坊用 16 份原材料合成</div>`;

  // 配装总价值 = 装备估值 + 带入卢布 + GP 币折算（撤离费 / 保费仍只按装备估值）
  const gearVal=sel.w.reduce((s,uid)=>{
    const w=stash.weapons.find(x=>x.uid===uid); return s+(w?w.value:0);
  },0)+(sel.a?(stash.armors.find(x=>x.uid===sel.a)||{value:0}).value:0)
    +(sel.h?((stash.helmets||[]).find(x=>x.uid===sel.h)||{value:0}).value:0)
    +(sel.s?(stash.shields.find(x=>x.uid===sel.s)||{value:0}).value:0);
  // 入场可携带现金 / GP 币（局内直接消费，阵亡即丢）
  const maxCash=Math.max(0, Math.floor(stash.creds||0));
  const maxTok=Math.max(0, Math.floor(stash.tokens||0));
  const cashIn=Math.max(0, Math.min(UI._raidCash||0, maxCash));
  const tokIn=Math.max(0, Math.min(UI._raidTok||0, maxTok));
  // 初始装备包（v0.21.2）：明码 ₽512，用带入的卢布现金买，钱不够就买不了
  const canSup=cashIn>=RAID_SUPPORT_CASH;
  const supOn=UI._raidSupport===true && canSup;
  // 滑动条步长：卢布按 1%（至少 1），GP 币按 1 枚
  const credStep=Math.max(1, Math.round(maxCash/100));
  const tokWorth=raidTokenWorth(tokIn);
  const cashVal=cashIn+tokWorth;
  const carryVal=gearVal+cashVal;
  const insCost=gearVal>0?Math.max(200, Math.round(gearVal*0.35)):0;
  const canIns=gearVal>0 && stash.creds>=insCost;
  // 顶部出发条：让玩家不必滚到底部才能进场；顺带把本次撤离费区间摊开
  const feeOf=id=>raidExtractFee(RAID_EXTRACT_RULES[id], gearVal);
  const feeMin=feeOf("extP"), feeMax=feeOf("extJ");

  /* v0.39.0（用户选定）：战地契约 + 阵亡装备限时赎回。
   * 两者都只读 stash 上的可选字段，旧档没有就是「没有契约 / 没有待赎回」。 */
  const _now=Date.now();
  const cActive=(typeof raidContractActive==="function")?raidContractActive(stash, _now):null;
  const cOffers=(!cActive && typeof raidContractOffers==="function")?raidContractOffers(_now):[];
  const contractHtml = cActive
    ? `<div class="raid-item sel" style="cursor:default;">
         <div class="ri-name" style="color:#8fd0ff">${cActive.name}：${cActive.title}</div>
         <div class="ri-meta">${cActive.desc}</div>
         <div class="ri-val" style="color:#8fe07a">进度 ${cActive.progress||0} / ${cActive.need}
           <button class="btn ghost small" data-cx="1" style="margin-left:8px;">放弃</button></div>
       </div>`
    : (cOffers.length ? cOffers.map(o=>`<div class="raid-item" style="cursor:default;">
         <div class="ri-name" style="color:#ffd23f">${o.name}：${o.title}</div>
         <div class="ri-meta">${o.desc}，奖励：具名装备（集齐后折 ₽120,000）</div>
         <div class="ri-val"><button class="btn ghost small" data-cc="${o.id}">接取</button></div>
       </div>`).join('') : `<div class="empty-hint">今天没有可接的契约</div>`);

  const bbList=(typeof raidBuybackList==="function")?raidBuybackList(stash, _now):[];
  const buybackHtml = bbList.length
    ? bbList.map((b,i)=>{
        const it=b.item, left=Math.max(0, Math.ceil((b.at+RAID_CONTRACT_HOURS*3600000-_now)/3600000));
        const col=it.kind==="shield"?shieldColor(it):(it.kind==="armor"||it.kind==="helmet")?(RAID_RARITY_COLOR[it.rarity|0]||"#dfe7f0"):raidGunColor(it);
        return `<div class="raid-item" style="cursor:default;">
          <div class="ri-name" style="color:${col}">${it.name}</div>
          <div class="ri-meta">阵亡装备，剩余 <b style="color:#ff9a8a">${left} 小时</b></div>
          <div class="ri-val"><button class="btn ghost small" data-bb="${i}" ${(stash.creds||0)<b.price?'disabled':''}>
            赎回 ₽${priceText(b.price)}</button></div>
        </div>`;
      }).join('')
    : `<div class="empty-hint">没有待赎回装备（投保后阵亡、且没被退回的那部分会出现在这里，24 小时内可赎）</div>`;

  UI._set(`
    <div class="panel raid-setup">
      <h2 class="title-big" style="font-size:34px;">塔科夫模式 · 撤离突袭</h2>
      <div class="subtitle">ESCAPE FROM TARKOV · 硬核撤离射击 · 地图「海关流域」· 工业区 + 北境密林 + 中央河谷 + 铁路枢纽 + 西南监狱/小镇/大坝，支持 <b style="color:#7ee08a">2~4 人联机</b></div>
      <details class="tarkov-intro">
        <summary>塔科夫模式 · 玩法说明（点此展开 / 折叠）</summary>
        <div class="tarkov-intro-body" style="color:var(--muted);max-width:680px;">
          开局与 <b style="color:#e0b84a">30 名 PMC / Scav</b>、<b style="color:#ffd23f">3 名 Boss</b>，以及 8 个核心地点的 <b style="color:#8fe07a">10 名精英</b>同场（共 43 名）。他们和你一样从零起步：各自有<b style="color:#8fe07a">独立背包与卢布</b>，会搜箱、换更好的枪甲；名字带 <b style="color:#ffd23f">★</b> 的 Raider 会优先抢武器箱、残血自行包扎。中弹会<b style="color:#ff8a5a">流血</b>（随身绷带/搜刮补给可止血）。<br>
          ${weaponQualityHidden()
            ? `<b style="color:#ffd23f">当前是精简显示</b>：枪名只显示型号，<b>品质 / 前后缀 / 厂商都隐藏</b>（数值照常生效）。想看成色就去 <b style="color:#8fd0ff">设置 → 显示 → 完整</b>。箱子仍以原材料与配件为主，想拿到好枪要靠<b style="color:#8fd0ff">工坊组装</b>（底材 + 配件 + 材料）。<b style="color:#8fd0ff">携带装备总估值</b>会影响高阶物资权重。<br>`
            : `<b style="color:#ffd23f">战利品 9 阶品质</b>：${raidTierLegend()}。箱子<b style="color:#ffd76a">绝大多数是原材料与配件</b>，整枪 / 护甲只是少数——想拿到好枪，要靠<b style="color:#8fd0ff">工坊组装</b>（底材 + 配件 + 材料，名字与品质由它们决定）。任意品质都可能刷出，但<b style="color:#8fd0ff">携带装备总估值</b>会显著抬高高阶物资的权重。<br>`}
          <b style="color:#ff7a3c">开局 3 分钟后</b>全图开始缓慢刷入<b>带装备的增援</b>：有的<b style="color:#e0b84a">组队推进</b>，有的会<b style="color:#ff7a3c">封锁撤离点</b>（封锁者存活时无法读条撤离）。<b style="color:#8fe07a">付费撤离点永不被封锁</b>，实在被堵死就花钱雇车；全图同时最多 2 处被封锁。<br>
          <b style="color:#ff8a5a">AI 更像真人</b>：视距<b>分级</b>（Scav <b>520</b> / PMC <b>900</b> / Boss <b>1250</b>），枪声基础 <b>1200px</b> 再按听距分级缩放，听见动静会一路摸过来；遇敌会<b>压到 170px</b>、左右游走、<b style="color:#8fd0ff">侧向急闪躲子弹</b>；<b style="color:#ff8a5a">打空弹匣会当场换弹并后撤</b>（备弹打光就翻尸补弹），<b style="color:#8fe07a">残血会自己找机会包扎</b>（Raider 58% / PMC 45% / Scav 38% 开始用药）。开局 <b>8 秒</b>内 AI 不会主动锁定你（<b>一旦开枪立即作废</b>），够你跑到第一个掩体。<b style="color:#ffd23f">本局第一次击杀</b>必得 <b>1 枚 ◈ GP 币</b>（撤离才落袋）—— 想攒 GP 币就得真开打，绕开所有人只会两手空空。<br>
          <b style="color:#8fe07a">只有成功撤离</b>，携带装备与战利品才写回仓库；阵亡或超时全部丢失。<br>
          <b style="color:#4fd6ff">护盾装备</b>：血条<b>上方</b>那条独立蓝色条，伤害<b>先扣盾、再扣护甲耐久、最后扣血</b>；
          <b>充能延迟</b>= 不受伤害多少秒后开始回盾，<b>充能速度</b>= 每秒回多少；<b>破盾瞬间有一小段无敌</b>，
          之后按延迟重新起盾。护盾由电池组 / 充能模块 / 延时继电器 / 承载框架 4 个配件组成，
          带前后缀与独特加成，可工坊合成、融合升阶、箱子和 Raider 掉落、军火超市购买。<br>
          <b style="color:#ffb44a">局内商店</b>：全图 <b>9 个摊位</b>（枪械 ×2 / 材料 ×3 / 回收 ×2 / 黑市 ×2），<b style="color:#ffd23f">每局随机刷新位置</b>，散在工业区、北境、河谷、东部铁路与西南监狱/小镇之间，走近按 <b>E</b> 交易（游戏不暂停）。<b>每个摊位各自独立</b>：货架、收购与 GP 币都不互通，同名分店也是自己的库存。回收超市按估值 <b style="color:#62c8ff">120%（±40%）</b> 收你的货，远高于背包直售的 <b style="color:#ff8a5a">${Math.round(RAID_VENDOR_RATE*100)}%</b>；黑市只收 <b style="color:#ffd23f">◈ GP 币</b>，出售高品阶成品枪与高级改装模块。<br>
          <b style="color:#ffd23f">保险箱与钥匙</b>：地图里散布着 <b>I~V 级上锁保险箱</b>（箱体带等级锁扣），等级越高里面的枪械 / 护甲 / 改装模块越好。低阶箱遍地都是，<b style="color:#ff8a5a">IV 级每局通常只有一口</b>（最大房间的军械库），<b style="color:#ff6a5a">V 级军火箱全图随机、约五局一遇</b>，箱内保底 <b>T5 特种装</b>、一次出 4 件。开箱要消耗一次对应等级的<b>钥匙</b>（钥匙能开同级及更低的箱子，有使用次数，用尽报废）。钥匙还能在<b style="color:#8fd0ff">工坊合成表</b>用 <b style="color:#ffd76a">16 份原材料</b>做一把（投料品质决定 I~V 级，越好的料出越高级的钥匙）；另外两条路是<b>开箱掉落</b>（<b style="color:#ffd76a">i 级箱最多掉 i+1 级钥匙</b>，V 级封顶；普通箱只出 I 级）与<b>商店购买</b>（<b>材料商店</b> I~II 卢布、<b>黑市</b> III~V GP 币；Raider 身上也会揣一把）。钥匙带进图才算数，死了就丢——<b style="color:#ffd23f">入场前在配装大厅的「钥匙串」逐把勾选</b>，不想冒险的钥匙留在仓库，绝对安全。<br>
          <b style="color:#8fb0c8">改装模块不可合成</b>：弹种适配组件 / 膛压组件 / 改装模块既不能用材料造，也不能两两升阶，只能从<b>保险箱与 Raider</b>身上掉落，或在<b>枪械商店（低阶，卢布）</b>与<b>黑市（高阶，GP 币）</b>购买。膛压组件决定<b>改装等级</b>（每级主伤害 <b>×${MAYHEM.corePower}</b>，V 级约 ×1.34），弹种适配组件更换枪械适配弹药。<br>
          <b style="color:#8fe07a">可互动设施</b>：<b>监狱 / 小镇 / 大坝</b>里有医疗站（回 45 血并止血）、弹药柜（补满备弹）、警报器（拉响把 AI 引过去，撤离前调虎离山）与<b style="color:#8fd0ff">泄洪闸</b>——闸门一开，水库放空，水底露出 <b style="color:#ffd23f">IV 级 + III 级保险箱</b>各一口，代价是巨响会招来一票人。<br>
          <b style="color:#62c8ff">河流与桥</b>：河道可<b>缓慢涉水</b>通过（速度只剩 45%），泡在水里超过 4.5 秒开始<b style="color:#ff9a8a">失温扣血</b>且越拖越疼——桥面（8 座，含 3 座带双黄线的大桥）完全免减速，赶路还是走桥。<b style="color:#ffd76a">背包满时</b>捡到的多余物资不会消失，会<b>掉在脚下变成发光的小包裹</b>，腾出空间后按 E 还能捡回来；<b style="color:#ff8a5a">Tab 物品栏</b>里每件战利品都有 <b>✕ 丢弃</b> 按钮，丢掉的同样落在脚下，随时能回头捡。<br>
          <b style="color:#ffb44a">子弹是独立物品</b>：4 个口径（9×19 / 5.45×39 / 7.62×54R·12-70 / 40mm）× <b>5 个级别</b>（民用 → 制式 → 军规 → 精工 → 特种，穿深 5→36 递增）。弹匣打空要<b style="color:#ffd36a">按 R 换弹，子弹从背包里扣</b>，背包没子弹就打不响。子弹能<b>合成</b>（工坊「弹药」页，材料越贵弹越高级）、<b>掉落</b>（武器箱首选、清尸必摸）与<b>购买</b>（材料店 T1/T2 卢布、枪械店 T2/T3、黑市 T4/T5 GP 币）。<br>
          <b style="color:#e0b84a">撤离费按带入装备估价浮动</b>：裸装跑刀只收 <b style="color:#8fe07a">0.2 倍</b>（约 ₽70~110，基本白坐）；带得越多折扣越小，带 ₽30 万的重装按原价付、封顶一两千 —— 贵重装备多、护送成本高。<br>
          <b style="color:#8fe07a">带入现金</b>：配装大厅可以把仓库里的<b>卢布 / ◈ GP 币</b>按 25% / 50% / 全部带进图，局内商店与黑市直接花；<b style="color:#ff8a5a">阵亡即丢</b>，撤离成功则连本局所得一起回仓。撤离费先扣局内现金，<b style="color:#ffd36a">不够再从仓库补扣</b>（只在真正撤离成功时扣）。</div>
      </details>
      <div class="raid-balance">仓库卢布：<b>₽ ${stash.creds}</b>，GP 币 <b style="color:#ffd23f">◈ ${stash.tokens||0}</b>，枪械 ${stash.weapons.length}，护甲 ${stash.armors.length}，头盔 ${(stash.helmets||[]).length}，护盾 ${stash.shields.length}，配件 ${(stash.parts||[]).length}，改装模块 ${(stash.parts||[]).filter(p=>p.core).length}，原材料 ${(stash.materials||[]).length}，底材 ${(stash.receivers||[]).length}，钥匙 <b style="color:#ffd23f">${(stash.keys||[]).length}</b></div>

      <!-- v0.32.0（用户要求）：五个入口按钮从页面底部移到上方，随时可点 -->
      <div class="row" style="justify-content:flex-end;gap:8px;margin:10px 0 2px;">
        <button class="btn ghost" id="btn-raid-shop">军火超市</button>
        <button class="btn ghost" id="btn-raid-forge">枪匠台</button>
        <button class="btn ghost" id="btn-raid-stash">仓库</button>
        <button class="btn ghost" id="btn-raid-auction">拍卖行${auc.mine?`，挂单 ${auc.mine}`:""}</button>
        <button class="btn ghost" id="btn-raid-back">返回</button>
      </div>

      <div class="raid-launch">
        <div class="rl-text">
          <div class="rl-title">${carryVal>0?`${gearVal>0?'已配装':'只带现金'}，总价值 ₽${priceText(carryVal)}`:'裸装跑刀'}</div>
          <div class="rl-sub">${carryVal>0?`装备 ₽${priceText(gearVal)}${cashVal>0?` + 带入现金 ₽${priceText(cashVal)}（卢布 ₽${priceText(cashIn)}${tokWorth>0?`，GP 币 ◈${tokIn}≈₽${priceText(tokWorth)}`:''}）`:''}，`:''}撤离费按装备估值浮动：雇车撤离约 <b style="color:#ffd36a">₽${priceText(feeMin)} ~ ${priceText(feeMax)}</b>，免费撤离点需坚守 6~10 秒</div>
        </div>
        <div class="rl-btns">
          <button class="btn ghost" id="btn-raid-online" style="border-color:#7ee08a66;color:#9fe0a8;">联机突袭，2~4 人</button>
          <button class="btn" id="btn-raid-start">进入海关流域</button>
        </div>
      </div>

      <div class="raid-carry">
        <div class="rc-row">
          <span class="rc-label">带入卢布</span>
          <span class="rc-val" style="color:#8fe07a">₽ <b id="rc-creds-val">${priceText(cashIn)}</b><span style="font-size:11px;color:#6f8b78"> / ${priceText(maxCash)}</span></span>
          <span class="rc-btns">
            <input id="rc-creds" type="range" min="0" max="${maxCash}" step="${credStep}" value="${cashIn}"
              style="width:190px;vertical-align:middle;" ${maxCash>0?"":"disabled"}>
          </span>
        </div>
        <div class="rc-row">
          <span class="rc-label">带入 GP 币</span>
          <span class="rc-val" style="color:#ffd23f">◈ <b id="rc-tok-val">${tokIn}</b>${tokIn>0?`<span style="font-size:11px;color:#c9a961"> ≈ ₽${priceText(tokWorth)}</span>`:''}<span style="font-size:11px;color:#6f6f8b"> / ${maxTok}</span></span>
          <span class="rc-btns">
            <input id="rc-tokens" type="range" min="0" max="${maxTok}" step="1" value="${tokIn}"
              style="width:190px;vertical-align:middle;" ${maxTok>0?"":"disabled"}>
          </span>
        </div>
        <div class="rc-row">
          <span class="rc-label">初始装备包</span>
          <span class="rc-val" style="color:${canSup?'#8fd0ff':'#6f7f8b'}">₽ ${RAID_SUPPORT_CASH}${canSup?'':' <span style="font-size:11px;color:#8b95a5">· 带入卢布不足</span>'}</span>
          <span class="rc-btns">
            <label style="display:inline-flex;align-items:center;gap:6px;font-size:12px;color:${canSup?'#cfe8f5':'#7c8894'};cursor:${canSup?'pointer':'default'};">
              <input id="rc-support" type="checkbox" ${supOn?'checked':''} ${canSup?'':'disabled'}> 出生点投放
            </label>
          </span>
        </div>
        <div class="rc-hint">带进图的现金可以在局内商店 / 黑市直接花（黑市只收 GP 币）；<b style="color:#ff8a5a">阵亡即丢失</b>，撤离成功则连本局所得一起带回仓库。<br>
          卢布与 GP 币<b style="color:#8fd0ff">都计入配装总价值</b>（1 枚 ◈ GP 币按 <b>₽${priceText(RAID_TOKEN_RATE)}</b> 折算，仅用于估值显示，不可兑换）；撤离费与保费只按<b>装备</b>估值计算。<br>
          <b style="color:#8fd0ff">初始装备包</b>：勾选后进场即从带入的卢布现金里扣 <b>₽${RAID_SUPPORT_CASH}</b>，出生点投放
          <b>2 把白装枪（大概率是手枪）+ 对应口径 T1 民用弹 + T1 护甲 / 头盔 + 绷带与止血针</b>，
          <b style="color:#ff8a5a">不含护盾</b>（走过去按 E 搜；钱不够买不了）。</div>
      </div>

      <div class="raid-cols" style="grid-template-columns:repeat(auto-fit,minmax(230px,1fr));">
        <div class="raid-col">
          <h4>携带枪械（最多 4 把：手持 1，副手 1，背包 2）</h4>
          <div class="raid-list">${wcards}</div>
        </div>
        <div class="raid-col">
          <h4>穿戴护甲（T1~T9，最多 1 件）</h4>
          <div class="raid-list">${acards}</div>
        </div>
        <div class="raid-col">
          <h4>佩戴头盔（T1~T9，最多 1 件）</h4>
          <div class="raid-list">${hcards}</div>
        </div>
        <div class="raid-col">
          <h4>装备护盾（容量 / 充能 / 延迟，最多 1 件）</h4>
          <div class="raid-list">${scards}</div>
        </div>
        <div class="raid-col">
          <h4 style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;">
            <span>钥匙串（携带 ${UI._raidKeys.length}/${RAID_INV_CAP.keys}）</span>
            <span style="display:flex;gap:6px;">
              <button class="btn ghost small" data-keyall="1" style="padding:2px 8px;font-size:11px;">全带</button>
              <button class="btn ghost small" data-keyall="0" style="padding:2px 8px;font-size:11px;">全不带</button>
            </span>
          </h4>
          <div class="raid-list">${keyCards}</div>
        </div>
        <div class="raid-col">
          <h4 style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;">
            <span style="color:${ammoCarried>0?'inherit':'#ff9a8a'}">弹药（携带 ${ammoCarried}/${RAID_AMMO_CAP} 发）</span>
            <span style="display:flex;gap:6px;">
              <button class="btn ghost small" data-ammoall="1" style="padding:2px 8px;font-size:11px;">全带</button>
              <button class="btn ghost small" data-ammoall="0" style="padding:2px 8px;font-size:11px;">全不带</button>
            </span>
          </h4>
          <div class="raid-list">${ammoCards}</div>
        </div>
      </div>

      <div class="row" style="margin-top:12px;gap:10px;align-items:center;">
        <button class="btn ${UI._raidIns?'':'ghost'}" id="btn-raid-ins" ${canIns?'':'disabled'}>
          ${UI._raidIns?'✓ 已投保':'投保'}（₽${priceText(insCost)}，阵亡后 65% 退回）
        </button>
        ${gearVal>0&&!canIns?`<span style="color:var(--muted);font-size:12px;">卢布不足，无法投保</span>`:''}
      </div>

      <!-- v0.39.0：战地契约（局外接、局内推进、完成给具名装备）+ 阵亡装备限时赎回 -->
      <div class="row" style="margin-top:12px;gap:14px;align-items:flex-start;flex-wrap:wrap;">
        <div style="flex:1 1 340px;min-width:290px;">
          <div class="raid-result-label" style="margin:0 0 6px;">战地契约</div>
          <div class="raid-list">${contractHtml}</div>
        </div>
        <div style="flex:1 1 340px;min-width:290px;">
          <div class="raid-result-label" style="margin:0 0 6px;">阵亡装备赎回（24 小时内，300% 赎回）</div>
          <div class="raid-list">${buybackHtml}</div>
        </div>
      </div>

      <div class="row" style="justify-content:space-between;align-items:center;margin-top:16px;flex-wrap:wrap;gap:10px;">
        ${ammoCarried===0?`<div class="raid-tip" style="color:#ff9a8a;width:100%;">未携带弹药：进图后枪是空的，要先搜到 / 买到子弹才能开火（钥匙同样默认不带）</div>`:''}
        <div class="raid-tip">${sel.w.length===0&&!sel.a&&!sel.h&&!sel.s&&cashVal===0?'裸装进场：空手、无甲、无盔、无盾，只带 1 卷绷带 —— 进图翻箱捡枪，捡到即自动上手':`已选 ${sel.w.length} 把枪${sel.a?' + 护甲':''}${sel.h?' + 头盔':''}${sel.s?' + 护盾':''}，装备 ₽${priceText(gearVal)}${cashVal>0?` + 现金 ₽${priceText(cashVal)}`:''}，总价值 <b style="color:#ffd36a">₽${priceText(carryVal)}</b>，局内 Q 循环换枪 / 1~4 直选，多出的枪放背包`}</div>
      </div>
    </div>`);

  for(const cal of AMMO_CAL_LIST){
    const el=document.getElementById("rc-ammo-"+cal);
    if(!el) continue;
    const cur=UI._raidAmmo[cal];
    if(!cur) continue;
    el.oninput=()=>{
      const v=Math.max(0, Math.min(parseInt(el.value,10)||0, cur.cap||0));
      cur.n=v;
      const b=document.getElementById("rc-ammo-val-"+cal);
      if(b) b.textContent=v+" / "+(cur.cap||0);
    };
    // 松手才重渲染整页（和现金 / GP 币滑动条一致）
    el.onchange=()=>{
      const v=Math.max(0, Math.min(parseInt(el.value,10)||0, cur.cap||0));
      cur.n=v; SFX.ui(); UI.raidSetup();
    };
  }
  UI.overlay.querySelectorAll('[data-ammoall]').forEach(el=>{
    el.onclick=(e)=>{
      e.stopPropagation();
      const all=el.dataset.ammoall==="1";
      for(const cal of AMMO_CAL_LIST){
        const cur=UI._raidAmmo[cal]; if(!cur) continue;
        cur.n = all ? (cur.cap||0) : 0;
      }
      SFX.ui(); UI.raidSetup();
    };
  });
  UI.overlay.querySelectorAll('[data-keyall]').forEach(el=>{
    el.onclick=(e)=>{
      e.stopPropagation();
      const all=(stash.keys||[]).map(k=>k.uid);
      UI._raidKeys = el.dataset.keyall==="1" ? all.slice(0, RAID_INV_CAP.keys) : [];
      SFX.ui(); UI.raidSetup();
    };
  });
  UI.overlay.querySelectorAll('[data-key]').forEach(el=>{
    el.onclick=()=>{
      if(!Array.isArray(UI._raidKeys)) UI._raidKeys=[];
      const uid=el.dataset.key;
      const i=UI._raidKeys.indexOf(uid);
      if(i>=0) UI._raidKeys.splice(i,1);
      else {
        if(UI._raidKeys.length>=RAID_INV_CAP.keys) return;   // 钥匙串满了
        UI._raidKeys.push(uid);
      }
      SFX.ui(); UI.raidSetup();
    };
  });
  UI.overlay.querySelectorAll('[data-w]').forEach(el=>{
    el.onclick=()=>{
      const uid=el.dataset.w;
      const i=sel.w.indexOf(uid);
      if(i>=0) sel.w.splice(i,1);
      else { if(sel.w.length>=4) sel.w.shift(); sel.w.push(uid); }
      SFX.ui(); UI.raidSetup();
    };
  });
  UI.overlay.querySelectorAll('[data-a]').forEach(el=>{
    el.onclick=()=>{ sel.a = sel.a===el.dataset.a?null:el.dataset.a; SFX.ui(); UI.raidSetup(); };
  });
  UI.overlay.querySelectorAll('[data-h]').forEach(el=>{
    el.onclick=()=>{ sel.h = sel.h===el.dataset.h?null:el.dataset.h; SFX.ui(); UI.raidSetup(); };
  });
  UI.overlay.querySelectorAll('[data-s]').forEach(el=>{
    el.onclick=()=>{ sel.s = sel.s===el.dataset.s?null:el.dataset.s; SFX.ui(); UI.raidSetup(); };
  });
  const insBtn=document.getElementById('btn-raid-ins');
  if(insBtn && !insBtn.disabled) insBtn.onclick=()=>{ UI._raidIns=!UI._raidIns; SFX.ui(); UI.raidSetup(); };
  /* v0.39.0：契约接取 / 放弃 / 赎回 —— 全部落盘后重开大厅，避免「界面说成功但仓库没变」 */
  UI.overlay.querySelectorAll('[data-cc]').forEach(el=>{
    el.onclick=(e)=>{
      e.stopPropagation();
      const off=raidContractOffers(Date.now()).find(o=>o.id===el.dataset.cc);
      if(off && raidContractAccept(stash, off, Date.now())){ RaidStash.save(stash); SFX.ui(); UI.raidSetup(); }
    };
  });
  UI.overlay.querySelectorAll('[data-cx]').forEach(el=>{
    el.onclick=(e)=>{ e.stopPropagation(); raidContractAbandon(stash); RaidStash.save(stash); SFX.ui(); UI.raidSetup(); };
  });
  UI.overlay.querySelectorAll('[data-bb]').forEach(el=>{
    el.onclick=(e)=>{
      e.stopPropagation();
      const r=raidBuybackBuy(stash, parseInt(el.dataset.bb,10)||0, Date.now());
      if(r && r.ok){ RaidStash.save(stash); SFX.levelup(); UI.raidSetup(); }
      else { SFX.hurt(); if(r && r.msg) console.warn("[赎回]", r.msg); }
    };
  });
  document.getElementById('btn-raid-shop').onclick=()=>{ SFX.ui(); UI.raidShop({from:'lobby'}); };
  document.getElementById('btn-raid-forge').onclick=()=>{ SFX.ui(); UI.raidForge({from:'lobby'}); };
  document.getElementById('btn-raid-stash').onclick=()=>{ SFX.ui(); UI.raidStash({from:'lobby'}); };
  document.getElementById('btn-raid-auction').onclick=()=>{ SFX.ui(); UI.raidAuction({from:'lobby'}); };
  document.getElementById('btn-raid-online').onclick=()=>{ SFX.ui(); UI._onlineKeep=false; UI.raidOnline(); };
  document.getElementById('btn-raid-back').onclick=()=>{ SFX.ui(); UI._raidSel={w:[],a:null,h:null,s:null}; UI._raidIns=false; UI.title(); };
  const rcC=document.getElementById("rc-creds");
  if(rcC){
    const clamp=v=>Math.max(0, Math.min(maxCash, parseInt(v,10)||0));
    rcC.oninput=()=>{
      UI._raidCash=clamp(rcC.value);
      const b=document.getElementById("rc-creds-val");
      if(b) b.textContent=priceText(UI._raidCash);
    };
    rcC.onchange=()=>{ UI._raidCash=clamp(rcC.value); SFX.ui(); UI.raidSetup(); };
  }
  const rcT=document.getElementById("rc-tokens");
  if(rcT){
    const clamp=v=>Math.max(0, Math.min(maxTok, parseInt(v,10)||0));
    rcT.oninput=()=>{
      UI._raidTok=clamp(rcT.value);
      const b=document.getElementById("rc-tok-val");
      if(b) b.textContent=String(UI._raidTok);
    };
    rcT.onchange=()=>{ UI._raidTok=clamp(rcT.value); SFX.ui(); UI.raidSetup(); };
  }
  const rcS=document.getElementById("rc-support");
  if(rcS && !rcS.disabled) rcS.onchange=()=>{ UI._raidSupport=!!rcS.checked; SFX.ui(); UI.raidSetup(); };
  UI.overlay.querySelectorAll('[data-carry]').forEach(el=>{
    el.onclick=(e)=>{
      e.stopPropagation();
      const [k,fr]=el.dataset.carry.split(":");
      const f=parseFloat(fr)||0;
      if(k==="creds") UI._raidCash=Math.round((stash.creds||0)*f);
      else UI._raidTok=Math.round((stash.tokens||0)*f);
      SFX.ui(); UI.raidSetup();
    };
  });
  document.getElementById('btn-raid-start').onclick=()=>{
    SFX.ui();
    const pickedKeys=Array.isArray(UI._raidKeys)?UI._raidKeys.slice():[];
    const ammoPick={};
    for(const cal of AMMO_CAL_LIST){
      const a=UI._raidAmmo && UI._raidAmmo[cal];
      if(a && a.n>0) ammoPick[cal]={ id:a.id, n:a.n };
    }
    const opts={ weapons:[...sel.w], armor:sel.a, helmet:sel.h, shield:sel.s, insure:UI._raidIns&&gearVal>0, keys:pickedKeys,
                 cash:cashIn, tokens:tokIn, ammo:ammoPick, support:supOn };
    UI._raidSel={w:[],a:null,h:null,s:null}; UI._raidIns=false;
    game.startRaid(opts);
  };
};

UI.raidResult=function(res){
  const colOf=(it)=>{
    /* v0.25.0：护甲 / 头盔改用 9 阶品质色 —— 与仓库 / 商店 / 配装一致。
       旧代码取 ARMOR_TIER_COLOR（按防护等级的色表），同一件装备在结算页
       和仓库里是两种颜色，玩家会以为结算页显示的是别的物品。 */
    if(it.kind==="armor"||it.kind==="helmet"){
      const r=it.rarity;
      return (typeof r==="number" && RAID_RARITY_COLOR[r]) ? RAID_RARITY_COLOR[r]
        : (ARMOR_TIER_COLOR[it.tier]||raidGunColor(it));
    }
    return raidGunColor(it);
  };
  let itemsHtml="";
  if(res.success){
    const list=[];
    for(const w of res.looted.weapons) list.push(`<span style="color:${colOf(w)}">${gunNameOf(w)}</span>`);
    for(const a of res.looted.armors) list.push(`<span style="color:${colOf(a)}">${a.name}</span>`);
    for(const h of (res.looted.helmets||[])) list.push(`<span style="color:${colOf(h)}">${h.name}</span>`);
    for(const s of (res.looted.shields||[])) list.push(`<span style="color:${shieldColor(s)}">${s.name}(护盾)</span>`);
    // 同种原材料合并成一堆（带 ×N），避免结算列表被一串「废金属」刷屏
    const agg=(arr)=>{
      const g=[];
      for(const m of (arr||[])){
        const s=g.find(x=>x.id===m.id);
        if(s) s.n++; else g.push({ id:m.id, m, n:1 });
      }
      return g.map(s=>`<span style="color:${s.m.color||'#dfe7f0'}">${s.m.name}(原材料)${s.n>1?' ×'+s.n:''}</span>`);
    };
    for(const pt of (res.looted.parts||[])) list.push(`<span style="color:${colOf(pt)}">${partNameOf(pt)}(配件)</span>`);
    for(const h of agg(res.looted.materials)) list.push(h);
    itemsHtml = list.length ? list.join("，") : `<span style="color:var(--muted)">空手而归</span>`;
  } else {
    const lost=[];
    for(const w of (res.lost.weapons||[])) lost.push(`<span style="color:${colOf(w)}">${gunNameOf(w)}</span>`);
    if(res.lost.armor) lost.push(`<span style="color:${colOf(res.lost.armor)}">${res.lost.armor.name}</span>`);
    if(res.lost.helmet) lost.push(`<span style="color:${colOf(res.lost.helmet)}">${res.lost.helmet.name}</span>`);
    if(res.lost.shield) lost.push(`<span style="color:${shieldColor(res.lost.shield)}">${res.lost.shield.name}(护盾)</span>`);
    for(const w of (res.lost.lootW||[])) lost.push(`<span style="color:${colOf(w)}">${gunNameOf(w)}(物品栏)</span>`);
    for(const h of (res.lost.lootH||[])) lost.push(`<span style="color:${colOf(h)}">${h.name}(物品栏)</span>`);
    /* v0.38.1：背包里的护甲 / 护盾阵亡后根本没进「丢失」清单 —— lootA 由 _fail 生产却无人读取，
       背包护盾连数据都没带上（只列了身上那件）。两处一起补，避免玩家以为没丢东西。 */
    for(const a of (res.lost.lootA||[])) lost.push(`<span style="color:${colOf(a)}">${a.name}(物品栏)</span>`);
    for(const s of (res.lost.lootS||[])) lost.push(`<span style="color:${shieldColor(s)}">${s.name}(物品栏护盾)</span>`);
    for(const pt of (res.lost.lootP||[])) lost.push(`<span style="color:${colOf(pt)}">${partNameOf(pt)}(配件)</span>`);
    { const g=[]; for(const m of (res.lost.lootM||[])){
        const s=g.find(x=>x.id===m.id); if(s) s.n++; else g.push({ id:m.id, m, n:1 });
      }
      for(const s of g) lost.push(`<span style="color:${s.m.color||'#dfe7f0'}">${s.m.name}(原材料)${s.n>1?' ×'+s.n:''}</span>`);
    }
    itemsHtml = lost.length ? lost.join("，") : `<span style="color:var(--muted)">无装备损失</span>`;
  }
  const recoveredHtml = (res.recovered&&res.recovered.length)
    ? `<div class="raid-result-label" style="color:#8fe07a;">保险理赔，无人捡走退回：</div>
       <div class="raid-result-items">${res.recovered.map(it=>`<span style="color:${colOf(it)}">${it.name}</span>`).join("，")}</div>` : "";
  /* v0.39.0（用户要求）：死亡回放 —— 塔科夫式死因信息，是玩家自我改进的燃料，
     也是挫败感的泄压阀。数据由 Raid._deathRecap 在致死那一次写好，这里只负责展示。 */
  const _rc=(!res.success && typeof Raid!=="undefined" && Raid.player) ? Raid.player.deathRecap : null;
  const recapHtml = _rc ? `<div class="raid-result-label">死因：</div>
      <div class="raid-result-items" style="color:#ffb0a8;">被 <b>${_rc.label?(_rc.label+"「"):"「"}${_rc.name}」</b>${_rc.dist?("在 "+_rc.dist+"m 外"):"贴身"}击杀${_rc.gun?("（"+_rc.gun+"）"):""}，期间受击 <b>${_rc.hits}</b> 次、累计 <b>-${_rc.dmg}</b>${_rc.elite?("<br>对手词条："+_rc.elite):""}</div>` : "";
  const insNote = res.insured ? `<div class="hint">本次已支付保费 ₽${res.insuredPaid}。</div>` : "";
  const mm=Math.floor(res.time/60), ss=Math.floor(res.time%60);
  UI._set(`
    <div class="panel" style="text-align:center;max-width:600px;">
      <h2 class="title-big" style="font-size:40px;color:${res.success?'#8fe07a':'#ff6a5a'};">
        ${res.success?"✓ 撤离成功":"✕ MIA，行动失败"}</h2>
      <div class="subtitle">${res.success?`从 ${res.zone} 成功撤离`:(res.reason||"阵亡")}</div>
      <div class="raid-result-grid">
        <div><span class="rr-k">存活时长</span><b>${mm}分${ss}秒</b></div>
        <div><span class="rr-k">击杀数</span><b>${res.kills}</b></div>
        ${res.success?`<div><span class="rr-k">带出卢布</span><b style="color:#8fe07a">₽ ${res.creds}</b></div>`:``}
        ${res.success&&res.tokens?`<div><span class="rr-k">GP 币</span><b style="color:#ffd23f">◈ ${res.tokens}</b></div>`:``}
        ${res.success&&res.returned.materials?`<div><span class="rr-k">原材料</span><b style="color:#ffd76a">${res.returned.materials}</b></div>`:``}
      </div>
      <div class="raid-result-label">${res.success?"带出并入库：":"丢失："}</div>
      <div class="raid-result-items">${itemsHtml}</div>
      ${recapHtml}
      ${recoveredHtml}
      <div class="row" style="justify-content:center;margin-top:18px;">
        <button class="btn" id="btn-raid-again">返回大厅</button>
      </div>
      <div class="hint" style="margin-top:10px;">${res.success?"装备与战利品已写入仓库。":"携带的装备与战利品已丢失——下次可裸装下场或购买保险。"}${insNote}</div>
    </div>`);
  document.getElementById('btn-raid-again').onclick=()=>{
    SFX.ui(); UI._raidSel={w:[],a:null,h:null,s:null}; UI._raidIns=false;
    if(typeof Net!=="undefined" && Net.online) Net.leave(true);   // 联机：结算后退出房间
    game.toTitle();          // 复位模式与画布状态
    UI.raidSetup();          // 直接回配装大厅（超市 / 枪匠台 / 仓库 / 拍卖行都在这里）
  };
};

UI.raidPause=function(confirmQuit){
  /* 放弃是不可逆的（携带装备 + 全部战利品直接蒸发），必须二次确认 ——「返回大厅」和
     「放弃」摆在同一个面板上、又都靠近「继续行动」，一次误触就白打一局。 */
  if(confirmQuit){
    UI._set(`
      <div class="panel" style="text-align:center;max-width:480px;border-color:rgba(255,110,90,0.45);">
        <h2 class="title-big" style="font-size:30px;color:#ff8a5a;">确认放弃这一局？</h2>
        <div class="subtitle">不可撤销</div>
        <p style="color:var(--muted);line-height:1.7;">
          放弃 = 本局判负：<b style="color:#ff8a5a">手上的枪械 / 护甲 / 头盔 / 护盾、带进来的卢布与 GP 币、以及全部战利品会直接丢失</b>。
          ${Raid.insured ? '<br>已投保的装备按 <b style="color:#8fe07a">65%</b> 概率退回仓库。' : ''}
        </p>
        <div class="row" style="justify-content:center;margin-top:16px;">
          <button class="btn" id="btn-quit-cancel">再想想（继续行动）</button>
          <button class="btn ghost" id="btn-quit-ok" style="border-color:#a8342a;color:#ff9a8a;">确认放弃</button>
        </div>
      </div>`);
    document.getElementById('btn-quit-cancel').onclick=()=>{ SFX.ui(); UI.raidPause(); };
    document.getElementById('btn-quit-ok').onclick=()=>{
      SFX.ui();
      // 主动放弃 = 失败（携带装备丢失，已投保的按保险规则处理）
      Raid._fail("主动放弃突袭");
    };
    return;
  }
  UI._set(`
    <div class="panel" style="text-align:center;max-width:460px;">
      <h2 class="title-big" style="font-size:32px;">已暂停</h2>
      <div class="subtitle">塔科夫模式 · 地图「海关流域」（工业区 / 密林 / 河谷 / 铁路 / 监狱 / 小镇 / 大坝）</div>
      <p style="color:var(--muted);">撤离倒计时已停止。继续行动，或放弃突袭返回大厅。</p>
      <div class="row" style="justify-content:center;margin-top:16px;">
        <button class="btn ghost" id="btn-raid-quit">放弃突袭（装备丢失）</button>
        <button class="btn ghost" id="btn-pause-settings">设置</button>
        <button class="btn" id="btn-raid-resume">继续行动</button>
      </div>
    </div>`);
  document.getElementById('btn-raid-resume').onclick=()=>{ SFX.ui(); game.resume(); };
  document.getElementById('btn-raid-quit').onclick=()=>{
    SFX.ui();
    UI.raidPause(true);          // 先确认，不直接判负
  };
};

/* =========================================================================
 * 军火超市（Arms Supermarket）
 *   用塔科夫仓库的卢布采购枪械 / 护甲 / 绷带，直接入库到 RaidStash，
 *   可在配装大厅携带下场或投保。撤离成功才会真正带走；阵亡或超时全部丢失。
 * ========================================================================= */
/* ==================== v0.28.0：军火超市每日特价 ====================
 * 每个分支（枪 / 护甲 / 护盾 / 配件 / 弹药，医疗品除外）一件高品质特价。
 * 确定性生成：同一小时内所有人看到同一件（种子 = 分支+时间桶+已买次数）；
 * 买走 seq+1 立即换下一件，没人买则 1 小时后时间桶变化自然刷新。
 * 关键：生成前后把 RNG 的闭包换回去，绝不打乱游戏内随机序列 ——
 *       联机两端靠同种子推进，序列一旦错位就会分叉。
 */
UI._raidDealCache=null;
UI._raidDailyDeal=function(branch){
  const bucket=raidDealBucket();
  const st=RaidStash.load();
  const rec=(st.dailyDeals && st.dailyDeals[branch]) || null;
  const seq=(rec && rec.hour===bucket) ? (rec.seq|0) : 0;
  const key=branch+"|"+bucket+"|"+seq;
  const cache=UI._raidDealCache;
  if(cache && cache.key===key) return cache.deal;

  const saved=RNG.rng;
  let item=null, name="", meta="", stats="";
  try{
    RNG.setSeed(raidDealSeed(branch, bucket, seq));
    if(branch==="weapon"){
      const type=RNG.pick(["rifle","sniper","smg","shotgun"]);
      const qt=5+RNG.ri(0,2);                 // 特种 / 试验 / 原型
      const g=blGunGen(20,{type, rarity:RAID_TIER_TO_RARITY[qt]});
      ensureGunAffixes(g);
      g.uid=raidUniqueUid("deal-weapon-"); g.kind="weapon";
      g.qTier=qt; g.qName=RAID_TIERS[qt].name; g.qColor=RAID_TIERS[qt].color;
      item=g; name=gunNameOf(g);
      meta=(WEAPON_TYPES[type]?WEAPON_TYPES[type].name:type)+"，"+RAID_TIERS[qt].name;
      stats=`${gunDamageLabel(g)}，弹匣 ${g.mag}，射速 ${g.rpm}，穿甲 ${Math.round((g.armorPen||0)*100)}%`;
    } else if(branch==="armor"){
      const t=RNG.ri(6,9), r=4+RNG.ri(0,2);
      const a=raidMakeArmor(t,r); item=a; name=a.name;
      meta="护甲，T"+t+"，"+RAID_RARITY_NAME[r];
      stats=`减伤 ${Math.round(a.dr*100)}%，护甲值 ${a.maxArmor}`;
    } else if(branch==="shield"){
      const t=RNG.ri(5,9), r=4+RNG.ri(0,2);
      const s=raidMakeShield(t,r); item=s; name=s.name;
      meta="护盾，T"+t+"，"+RAID_RARITY_NAME[r];
      stats=`容量 ${s.capacity}，充能 ${s.rate}/s，延迟 ${s.delay}s`;
    } else if(branch==="part"){
      const slot=RNG.pick(GUN_SLOTS).id;
      const pt=rollPart(slot, 18, RAID_TIER_TO_RARITY[5+RNG.ri(0,2)]);
      item=pt; name=partNameOf(pt)||"配件";
      meta="配件，"+(GUN_SLOT_BY_ID[slot]?GUN_SLOT_BY_ID[slot].name:slot)+(partQualityName(pt)?"，"+partQualityName(pt):"");
      stats=partText(pt)||"";
    } else if(branch==="ammo"){
      const cal=RNG.pick(AMMO_CAL_LIST), lv=4+RNG.ri(0,1);
      const d=ammoDef(cal, lv); item=d;
      name=d.name+" ×"+RAID_AMMO_STACK;
      meta=AMMO_CALS[cal].spec+"，T"+lv;
      stats="一条 "+RAID_AMMO_STACK+" 发，单发估值 ₽"+Math.round(d.value);
    }
  } finally {
    RNG.rng=saved;              // 换回原闭包 —— 游戏内随机序列零影响
  }
  if(!item) return null;

  const baseVal = (branch==="ammo")
    ? (item.value||0)*RAID_AMMO_STACK
    : (item.value || (typeof partValue==="function" ? partValue(item) : 0) || 1000);
  /* 特价定价：估值 ×1.35（常规军火超市是 ×2.0±0.5）—— 明显便宜，但不至于白送 */
  const price = Math.max(1, Math.round(baseVal*1.35));

  const deal={ branch, item, name, meta, stats, price, bucket, seq };
  UI._raidDealCache={ key, deal };
  return deal;
};

UI.raidShop=function(opts){
  opts=opts||{};
  // 每次打开货架都重新随机（切 tab 时保留当前批次）
  if(!opts.keep){ UI._raidShopGuns=null; UI._raidShopParts=null; UI._raidShopHelmets=null; }
  const stash=RaidStash.load();
  if(UI._raidShopTab===undefined) UI._raidShopTab="weapon";
  // v0.21.3：旧版本可能存过 'helmet'（已并入「护甲，头盔」栏）→ 落回枪械
  if(["weapon","armor","shield","part","ammo","med"].indexOf(UI._raidShopTab)<0) UI._raidShopTab="weapon";
  const TAB=UI._raidShopTab;
  // 护甲仍按估值着色
  const rarOf=v=> v>=700?2 : v>=400?1 : 0;

  // 军火超市：每次进入刷新一批旧刷宝体系枪械（按枪型铺货）
  if(!UI._raidShopGuns){
    const W=g=>{ const w=blGunGen(12,{type:g, weights:{white:4,green:8,blue:6,purple:2.4,orange:0.7,pearl:0.22,ancient:0.08,rainbow:0.02}}); ensureGunAffixes(w); w.uid=raidUniqueUid("shop-"+g+"-"); w.kind="weapon"; return w; };
    UI._raidShopGuns = RAID_GUN_TYPES.map(W);
  }

  /* v0.28.0：每日特价卡（每个分支一张，医疗品除外） */
  const dealCard=(branch)=>{
    const d=UI._raidDailyDeal(branch);
    if(!d) return "";
    const can=stash.creds>=d.price;
    const leftMin=Math.max(1, Math.ceil((raidDealBucketEnd(d.bucket)-Date.now())/60000));
    return `<div class="shop-item" style="border-left-color:#ffd23f;background:rgba(255,210,63,.06);">
      <div class="si-name" style="color:#ffd23f">◈ 每日特价 · ${d.name}</div>
      <div class="si-meta">${d.meta}，<b style="color:#ffd23f">全服同一件，先到先得</b></div>
      <div class="si-stats">${d.stats}<br><span style="color:#8fd0ff">${leftMin} 分钟后刷新，买走立即换下一件</span></div>
      <div class="si-buy"><span class="si-price ${can?'':'cant'}">₽ ${priceText(d.price)}</span>
        <button class="btn" data-buy="deal:${branch}" ${can?'':'disabled'}>抢购</button></div>
    </div>`;
  };

  const wCards=UI._raidShopGuns.map(g=>{
    const col=raidGunColor(g);
    const tname=WEAPON_TYPES[g.type]?WEAPON_TYPES[g.type].name:g.cat;
    const elem=g.element&&g.element!=="none"?(ELEMENTS[g.element]?ELEMENTS[g.element].name:""):"";
    /* 精简显示：不列词缀；完整显示才把前两条词缀摊开 */
    const aff=weaponQualityHidden()? "" : g.affixes.slice(0,2).map(a=>a.mods.map(m=>affixText(m)).join("，")).join("；");
    const price=raidSuperPrice(g.value, g.uid), can=stash.creds>=price;
    return `<div class="shop-item" style="border-left-color:${col}">
      <div class="si-thumb">${gunSvg(g,46)}</div>
      <div class="si-name" style="color:${col}">${gunNameOf(g)}</div>
      <div class="si-meta">${tname}${elem?('，'+elem):''}，${g.auto?'全自动':'半自动'}${g.pellets>1?(g.type==="shotgun"?('，'+g.pellets+' 弹片'):`，<b style="color:#ffd54a">${g.pellets} 发/次</b>`):''}</div>
      <div class="si-stats">${gunDamageLabel(g)}，弹匣 ${g.mag}，射速 ${g.rpm}<br>射程 ${g.range}，穿甲 ${Math.round((g.armorPen||0)*100)}%，备弹 ${g.reserve}${aff?('，'+aff):''}</div>
      <div class="si-buy"><span class="si-price ${can?'':'cant'}">₽ ${priceText(price)}</span>
        <button class="btn" data-buy="weapon:${g.uid}" ${can?'':'disabled'}>购买</button></div>
    </div>`;
  }).join('');

  // v0.21.3：护甲与头盔合并成一栏，用整行小标题分区
  const gridHead=t=>`<div style="grid-column:1/-1;font-size:13px;font-weight:800;color:#cfd8e2;margin:12px 0 2px;padding-left:8px;border-left:3px solid #8fd0ff;">${t}</div>`;
  /* v0.28.0（用户要求）：左边栏与 T 徽标改用 **T1~T9 的颜色阶梯**。
   * v0.25.0 曾把左边栏统一成「民用」品质色，结果是九张护甲卡全一片棕，
   * 完全看不出 T5 和 T8 的区别。现在 ARMOR_TIER_COLOR 直接对齐 9 阶品质皮
   * （T1 民用棕 → T9 定型青），左边栏与徽标同色，阶梯一眼可见。 */
  const armorHead=gridHead("护甲 T1~T9，减伤 / 护甲值");
  const helmetHead=gridHead("头盔 T1~T9，爆头减伤 / 耐久");
  const tierBadge=(t,col)=>`<span style="display:inline-block;font-size:11px;font-weight:800;padding:0 5px;border-radius:3px;`+
    `border:1px solid ${col};color:${col};margin-right:6px;">T${t}</span>`;
  const shopQualNote=`本店仅售 <b style="color:${RAID_RARITY_COLOR[0]}">${RAID_RARITY_NAME[0]}</b> 底材，更高品质靠掉落 / 融合 / 工坊`;

  // 9 级护甲（仅售普通品质；稀有度靠掉落 / 融合）
  const aCards=RAID_ARMOR_TIERS.map(t=>{
    const a=RAID_ARMORS[t], price=raidSuperPrice(a.value, "armor"+t), can=stash.creds>=price;
    const col=ARMOR_TIER_COLOR[t], tcol=col;   // v0.28.0：T1~T9 颜色阶梯
    const grade = t>=8?'重型防弹衣' : (t>=6?'插板背心' : (t>=3?'防弹背心':'软质背心'));
    return `<div class="shop-item" style="border-left-color:${col}">
      <div class="si-name" style="color:${col}">${tierBadge(t,tcol)}${a.name.replace(/^T\d+\s*/,"")}</div>
      <div class="si-meta">${grade}，${t>=8?'最高防护级':(t>=6?'高防护级':'制式')}，${shopQualNote}</div>
      <div class="si-stats">减伤 ${Math.round(a.dr*100)}%，护甲值 ${a.maxArmor}${t>=6?'<br><b style="color:#ff8a5a">重装：可硬吃整梭步枪弹</b>':''}</div>
      <div class="si-buy"><span class="si-price ${can?'':'cant'}">₽ ${priceText(price)}</span>
        <button class="btn" data-buy="armor:${t}" ${can?'':'disabled'}>购买</button></div>
    </div>`;
  }).join('');

  // 9 级头盔
  const hCards=RAID_ARMOR_TIERS.map(t=>{
    const h=RAID_HELMETS[t], price=raidSuperPrice(h.value, "helmet"+t), can=stash.creds>=price;
    const col=ARMOR_TIER_COLOR[t], tcol=col;   // v0.28.0：T1~T9 颜色阶梯
    const grade = t>=8?'全罩头盔' : (t>=6?'防弹头盔' : (t>=3?'战术头盔':'软质头套'));
    return `<div class="shop-item" style="border-left-color:${col}">
      <div class="si-name" style="color:${col}">${tierBadge(t,tcol)}${h.name.replace(/^T\d+\s*/,"")}</div>
      <div class="si-meta">${grade}，${t>=8?'最高防护级':(t>=6?'高防护级':'制式')}，${shopQualNote}</div>
      <div class="si-stats">爆头减伤 ${Math.round(h.dr*100)}%，耐久 ${h.maxArmor}</div>
      <div class="si-buy"><span class="si-price ${can?'':'cant'}">₽ ${priceText(price)}</span>
        <button class="btn" data-buy="helmet:${t}" ${can?'':'disabled'}>购买</button></div>
    </div>`;
  }).join('');

  // 配件货架：每次进店刷新一批（6~8 个）
  if(!UI._raidShopParts){
    const arr=[];
    for(let i=0;i<8;i++){
      const slot=RNG.pick(GUN_SLOTS).id;
      const pool=[{weight:30,k:"green"},{weight:26,k:"blue"},{weight:16,k:"purple"},{weight:8,k:"orange"},{weight:3,k:"pearl"}];
      const rar=pool[RNG.weighted(pool)].k;
      const pt=rollPart(slot, 13, rar);
      arr.push(pt);
    }
    UI._raidShopParts=arr;
  }
  const pCards=UI._raidShopParts.map((pt,i)=>{
    const price=raidSuperPrice(partValue(pt), pt.uid), can=stash.creds>=price, col=partColor(pt);
    const slotName=GUN_SLOT_BY_ID[pt.slot]?GUN_SLOT_BY_ID[pt.slot].name:pt.slot;
    const qn=partQualityName(pt);
    /* 效果行（partText）两种模式都留着 —— 那是属性不是词缀名，和枪的伤害 / 弹匣一个层级；
     * 精简模式只是不显示品质名与词缀名，不然同槽位的几张卡会长得一模一样。 */
    const statLine=partText(pt);
    return `<div class="shop-item" style="border-left-color:${col}">
      <div class="si-name" style="color:${col}">${partNameOf(pt)}</div>
      <div class="si-meta">配件，${slotName}槽位${qn?"，"+qn:""}</div>
      ${statLine?`<div class="si-stats">${statLine}</div>`:""}
      <div class="si-buy"><span class="si-price ${can?'':'cant'}">₽ ${price}</span>
        <button class="btn" data-buy="part:${i}" ${can?'':'disabled'}>购买</button></div>
    </div>`;
  }).join('');

  /* v0.21.3：子弹货架 —— 4 个弹族 × 5 个级别，按 30 发一条卖。
   * 配装页只负责「带多少」，买子弹统一在这里（局内摊位仍然更便宜）。 */
  const ammoCards = AMMO_CAL_LIST.map(cal=>{
    const C=AMMO_CALS[cal];
    return AMMO_GRADES.slice().reverse().map(g=>{
      const d=ammoDef(cal,g.lv), id=d.id;
      const have=(stash.ammo&&stash.ammo[id])||0;
      const price=raidSuperPrice(d.value*RAID_AMMO_STACK, id);
      const can=stash.creds>=price;
      const E=ELEMENTS[g.elem]||null;
      return `<div class="shop-item" style="border-left-color:${C.color}">
        <div class="si-name" style="color:${C.color}">${C.short}，${g.name} ×${RAID_AMMO_STACK}</div>
        <div class="si-meta">${C.spec}，适用 ${C.types.map(t=>WEAPON_TYPES[t]?WEAPON_TYPES[t].name:t).join(" / ")}</div>
        <div class="si-stats">威力 ×${g.power.toFixed(2)}，弹种 <b style="color:${E?E.color:"#cfd8e2"}">${E?E.name:"无"}</b>，当前库存 ${have} 发</div>
        <div class="si-buy"><span class="si-price ${can?'':'cant'}">₽ ${priceText(price)}</span>
          <button class="btn" data-buy="ammo:${cal}_${g.lv}" ${can?'':'disabled'}>购买</button></div>
      </div>`;
    }).join("");
  }).join('');

  // 医疗货架：5 种医疗品（绷带单独计数，其余进医疗包堆叠）
  const medCard = RAID_MEDS.map(m=>{
    const price=raidSuperPrice(m.value, m.id), can=stash.creds>=price;
    const have = m.id==="bandage" ? (stash.bandages||0) : ((stash.meds&&stash.meds[m.id])||0);
    const col=RAID_RARITY_COLOR[m.tier];
    return `<div class="shop-item" style="border-left-color:${col}">
      <div class="si-name" style="color:${col}">${m.name} ×1</div>
      <div class="si-meta">医疗品，T${m.tier+1}，${m.desc}</div>
      <div class="si-stats">治疗耗时 ${m.cast}s${m.heal?`，回血 ${m.heal}`:""}${m.bleed?"，止血":""}，当前库存 ${have}</div>
      <div class="si-buy"><span class="si-price ${can?'':'cant'}">₽ ${priceText(price)}</span>
        <button class="btn" data-buy="med:${m.id}" ${can?'':'disabled'}>购买</button></div>
    </div>`;
  }).join('');

  // v0.16.0：护盾货架（每次进店刷新一批，9 个等级各一件普通品质）
  if(!UI._raidShopShields){
    UI._raidShopShields=SHIELD_TIERS.map(t=>raidMakeShield(t,0));
  }
  const sCards=UI._raidShopShields.map(s=>{
    const col=shieldColor(s), price=raidSuperPrice(s.value, s.uid), can=stash.creds>=price;
    return `<div class="shop-item" style="border-left-color:${col}">
      <div class="si-name" style="color:${col}">${s.name}</div>
      <div class="si-meta">T${s.tier} 护盾，${(s.parts||[]).length} 个配件，前后缀 ${(s.affixes||[]).map(a=>a.nm).join("，")}</div>
      <div class="si-stats">${shieldLines(s).join("，")}</div>
      <div class="si-buy"><span class="si-price ${can?'':'cant'}">₽ ${priceText(price)}</span>
        <button class="btn" data-buy="shield:${s.uid}" ${can?'':'disabled'}>购买</button></div>
    </div>`;
  }).join('');

  // v0.21.3：护甲 / 头盔合并成一栏「护甲，头盔」，另加「子弹」栏
  const tabs=[{id:'weapon',name:'枪械',tag:'WEAPONS'},{id:'armor',name:'护甲，头盔',tag:'ARMOR + HELMET'},
    {id:'shield',name:'护盾',tag:'SHIELD'},{id:'part',name:'配件',tag:'PARTS'},
    {id:'ammo',name:'子弹',tag:'AMMO'},{id:'med',name:'医疗',tag:'MEDS'}];
  const backLabel = opts.from==='title' ? '返回主菜单' : '前往配装大厅';

  UI._set(`
    <div class="panel raid-setup">
      <h2 class="title-big" style="font-size:32px;">军火超市</h2>
      <div class="subtitle">ARMS SUPERMARKET · 用卢布采购装备入库，带入下一局突袭</div>
      <div class="shop-bar">
        <div class="shop-desc">这里只卖<b style="color:#ffd23f">成品</b>：枪械 / 护甲与头盔（同栏分区）/ 护盾 / 配件 / <b style="color:#ffd36a">子弹</b> / 医疗品，
          护盾按<b style="color:#4fd6ff">容量 / 充能速度 / 充能延迟</b>三数值与配件、前后缀、独特加成区分；<b style="color:#ffd23f">全场统一按「估价 × 2.0（±0.5）」结算</b>——外场买贵，局内摊位便宜得多；<b style="color:#ff9a3a">原材料、底材、改装模块一律不卖</b>——原材料与底材可以在枪匠台「工坊」用材料合成；<b style="color:#ff9a3a">改装模块完全不能合成</b>，只能从保险箱 / Raider 掉落，或在<b style="color:#7fd0ff">局内枪械商店（低阶）与黑市（高阶）</b>购买。<br>
        护甲等级 T1~T9；品质另按稀有度预算掷出，只受等级封顶（上限 = 等级 - 1），二者并非一一对应。<b style="color:#8fe07a">枪械与配件大多只有 1 条词缀，少数带 2 条以上</b>（护甲 / 头盔固定 1 前缀 + 1 后缀），买之前先看词条。仅撤离成功才会真正带走。<br>
        <b style="color:#ffd36a">子弹</b>按 <b>30 发</b> 一条卖，4 个弹族 × 5 个级别（民用 → 特种，威力与弹种不同）；配装大厅里只决定「带多少发」，买子弹统一来这里，局内摊位更便宜。<br>
        <span style="color:var(--muted)">${weaponQualityHidden()?"显示密度：":"品质阶梯（低 → 高）："}</span>${raidTierLegend()}</div>
        <div class="shop-gold">仓库卢布 ₽ ${priceTextShort(stash.creds)}</div>
        <button class="btn ghost" id="btn-shop-refresh" ${stash.creds>=500?'':'disabled'}>刷新货架 ₽500</button>
        <button class="btn ghost" id="btn-shop-back">${backLabel}</button>
      </div>
      <div class="shop-tabs">
        ${tabs.map(t=>`<button class="shop-tab ${TAB===t.id?'on':''}" data-tab="${t.id}"><b>${t.name}</b><span class="tab-tag">${t.tag}</span></button>`).join('')}
      </div>
      <div class="shop-list">
        ${TAB==='weapon'? (dealCard('weapon')+wCards)
          : TAB==='armor'? (dealCard('armor')+armorHead+aCards+helmetHead+hCards)
          : TAB==='shield'? (dealCard('shield')+sCards)
          : TAB==='part'? (dealCard('part')+pCards)
          : TAB==='ammo'? (dealCard('ammo')+ammoCards)
          : medCard}
      </div>
      <div class="hint" style="margin-top:12px;">卢布来自突袭中搜刮与撤离带出（V-EX 雇车等会消耗）。先下场搜刮攒钱，再来超市补强配装与绷带。</div>
    </div>`);

  const refreshBtn=document.getElementById('btn-shop-refresh');
  if(refreshBtn) refreshBtn.onclick=()=>{
    if(stash.creds<500) return;
    stash.creds-=500; RaidStash.save(stash);
    UI._raidShopGuns=null; UI._raidShopParts=null; UI._raidShopHelmets=null; UI._raidShopShields=null;
    SFX.ui(); UI.raidShop(opts);
  };
  UI.overlay.querySelectorAll('[data-tab]').forEach(el=>{
    el.onclick=()=>{ UI._raidShopTab=el.dataset.tab; SFX.ui(); UI.raidShop(Object.assign({}, opts, {keep:true})); };
  });
  UI.overlay.querySelectorAll('[data-buy]').forEach(el=>{
    el.onclick=()=>{
      const parts=el.dataset.buy.split(':'); const type=parts[0]; const key=parts[1];
      /* v0.19.0：局外军火超市统一按 估价 × (2.0 ± 0.5) 结算 */
      if(type==='deal'){
        /* v0.28.0：每日特价 —— 先到先得，买走立即换下一件（seq+1） */
        const d=UI._raidDailyDeal(key);
        if(!d) return;
        if(stash.creds<d.price) return;
        stash.creds-=d.price;
        if(key==='weapon') stash.weapons.push(d.item);
        else if(key==='armor') stash.armors.push(d.item);
        else if(key==='shield') (stash.shields=stash.shields||[]).push(d.item);
        else if(key==='part') (stash.parts=stash.parts||[]).push(d.item);
        else if(key==='ammo'){
          stash.ammo=stash.ammo||{};
          stash.ammo[d.item.id]=(stash.ammo[d.item.id]||0)+RAID_AMMO_STACK;
        }
        const bucket=raidDealBucket();
        stash.dailyDeals=stash.dailyDeals||{};
        const rec=stash.dailyDeals[key];
        stash.dailyDeals[key]={ hour:bucket, seq:(rec&&rec.hour===bucket?(rec.seq|0):0)+1 };
        UI._raidDealCache=null;                  // 强制下一次重新生成
      } else if(type==='bandage'){
        const price=raidSuperPrice((RAID_MED_BY_ID.bandage||{}).value||100, "bandage");
        if(stash.creds<price) return;
        stash.creds-=price; stash.bandages=(stash.bandages||0)+1;
      } else if(type==='med'){
        const price=raidSuperPrice((RAID_MED_BY_ID[key]||{}).value||100, key);
        if(stash.creds<price) return;
        stash.creds-=price;
        if(key==='bandage') stash.bandages=(stash.bandages||0)+1;
        else { stash.meds=stash.meds||{}; stash.meds[key]=(stash.meds[key]||0)+1; }
      } else if(type==='weapon'){
        const i=UI._raidShopGuns.findIndex(g=>g.uid===key);
        const src=i>=0?UI._raidShopGuns[i]:null;
        if(!src) return;
        const price=raidSuperPrice(src.value, src.uid);
        if(stash.creds<price) return;
        stash.creds-=price;
        stash.weapons.push(Object.assign({}, src));
        UI._raidShopGuns.splice(i,1);   // 买走即下架，不能反复买同一把
      } else if(type==='armor'){
        const tier=+key, src=RAID_ARMORS[tier];
        if(!src) return;
        const price=raidSuperPrice(src.value, "armor"+tier);
        if(stash.creds<price) return;
        stash.creds-=price;
        stash.armors.push(raidMakeArmor(tier, 0));
      } else if(type==='helmet'){
        const tier=+key, src=RAID_HELMETS[tier];
        if(!src) return;
        const price=raidSuperPrice(src.value, "helmet"+tier);
        if(stash.creds<price) return;
        stash.creds-=price;
        stash.helmets.push(raidMakeHelmet(tier, 0));
      } else if(type==='shield'){
        const i=UI._raidShopShields.findIndex(s=>s.uid===key);
        const src=i>=0?UI._raidShopShields[i]:null;
        if(!src) return;
        const price=raidSuperPrice(src.value, src.uid);
        if(stash.creds<price) return;
        stash.creds-=price;
        (stash.shields=stash.shields||[]).push(Object.assign({}, src));
        UI._raidShopShields.splice(i,1);   // 买走即下架
      } else if(type==='ammo'){
        // v0.21.3：子弹按 30 发一条卖（key = "light_1" 这种 cal_lv）
        const m=/^([a-z]+)_(\d)$/.exec(key||"");
        const cal=m?m[1]:null, lv=m?+m[2]:0;
        if(!cal || !AMMO_CALS[cal]) return;
        const d=ammoDef(cal, lv), id=d.id;
        const price=raidSuperPrice(d.value*RAID_AMMO_STACK, id);
        if(stash.creds<price) return;
        stash.creds-=price;
        stash.ammo=stash.ammo||{};
        stash.ammo[id]=(stash.ammo[id]||0)+RAID_AMMO_STACK;
      } else if(type==='part'){
        const idx=+key, pt=UI._raidShopParts[idx];
        if(!pt) return;
        const price=raidSuperPrice(partValue(pt), pt.uid);
        if(stash.creds<price) return;
        stash.creds-=price;
        const bought=JSON.parse(JSON.stringify(pt));
        bought.uid=raidUniqueUid("pt-");
        stash.parts.push(bought);
        UI._raidShopParts.splice(idx,1);
      }
      // 购买后保留当前货架（keep:true），不再“买一件就免费重掷整个商店”。
      RaidStash.save(stash); SFX.ui(); UI.raidShop(Object.assign({}, opts, {keep:true}));
    };
  });
  document.getElementById('btn-shop-back').onclick=()=>{
    UI._raidShopGuns=null;            // 下次进入刷新一批新枪
    UI._raidShopParts=null;           // 配件货架也刷新
    UI._raidShopShields=null;         // 护盾货架也刷新
    SFX.ui();
    if(opts.from==='title') UI.title(); else UI.raidSetup();
  };
};

/* =========================================================================
 * 枪匠台，精密改装（Rakanishu 赫拉迪克方块式改造）
 *   对塔科夫仓库里的旧刷宝体系枪械做「重铸词缀 / 更换弹种 / 升阶改装」，
 *   用仓库卢布支付；改造后数值由生成管线重算，直接覆盖仓库中的那把枪。
 * ========================================================================= */
const FORGE_RARITY_MULT = { white:1, green:1.4, blue:2, purple:3.2, orange:5, pearl:7,
  ancient:10, rainbow:14, mythic:20, primordial:28, celestial:38, singularity:52 };
function forgeCost(op, gun){
  const rm = FORGE_RARITY_MULT[gun.rarity] || 1;
  if(op==="reroll")  return Math.round(260*rm/10)*10;
  if(op==="element") return Math.round(480*rm/10)*10;
  if(op==="mayhem")  return Math.round(700*(gun.mayhem+1)*rm/10)*10;
  if(op==="part")    return Math.round(140*rm/10)*10;
  return 999999;
}

/* ----------------------------- 融合台 ----------------------------- */
/* v0.25.0：融合「升阶」改成概率制（需求：「融合模式升阶概率调低」）。
 * 旧规则是投 2 件必 +1 阶、投 3 件再 +1 阶 —— 等于「融合 = 免费提品质」，
 * 玩家把仓库里的垃圾两两丢进去就能稳定换出高品质，整条品质曲线被抹平。
 * 现在的期望：
 *   2 件 → 38%，3 件 → 52%，4 件 → 66%，5 件 → 80%（封顶 80%）
 *   4 件以上另有 18% 概率再多升 1 阶
 * 失败**不是白干**：产物仍按投料里的最高品质生成（达不到预期但不会比最好的那件差），
 * 只是不再额外跳档。成功率由件数决定，可预期、可算，不是纯运气。 */
function raidFuseUpChance(n){
  return M.clamp(0.38 + 0.14*((n|0)-2), 0.38, 0.80);
}
function raidFuseRollUp(n){
  return RNG.chance(raidFuseUpChance(n)) ? 1 : 0;
}
function raidFuseRollSecond(n){
  return (n>=4 && RNG.chance(0.18)) ? 1 : 0;
}
// 两件及以上同栏位物品熔成一件：品质、词条、改装等级有概率跃升
function fuseCost(items){
  const v=items.reduce((sum,it)=>sum+(it.value||partValue(it)||0),0);
  // 融合造价大幅下调（原 55% + 300，现 25% + 120），让融合成为可负担的品质跃升手段
  return Math.round(v*0.25/10)*10 + 120;
}
function fuseRaidItems(items){
  if(!items || items.length<2) return null;
  const main=items[0], n=items.length;

  // 改装模块不可融合升阶（只能掉落 / 购买），直接拒绝
  if(main.slot==="core" || main.core) return null;
  const rarIdx = o=>Math.max(0, RARITIES.findIndex(r=>r.id===(o.rarity||"white")));
  const mkUid = pre=>pre+Date.now().toString(36)+Math.floor(Math.random()*999).toString(36);

  // 枪械（主物品为枪）
  if(main.kind==="weapon" || main.dmg!==undefined){
    const ilvl=Math.max(10, ...items.map(i=>i.ilvl||10)) + n*2;
    const maxRar=Math.max(...items.map(rarIdx));
    const boost=raidFuseRollUp(n)+raidFuseRollSecond(n);
    const targetRar=RARITIES[Math.min(RARITIES.length-1, maxRar+boost)].id;
    const R=RARITY_BY_ID[targetRar];

    // 配件：所有枪的配件 + 散装配件，按槽位去重，品质各升一档
    const bySlot={}, slotRank={};
    for(const it of items){
      const list = it.kind==="part" ? [it] : (it.parts||[]);
      for(const p of list){
        const pi=Math.max(0, RARITIES.findIndex(r=>r.id===p.rarity));
        if(slotRank[p.slot]===undefined || pi>slotRank[p.slot]){
          slotRank[p.slot]=pi;
          const up=RARITIES[Math.min(RARITIES.length-1, pi+1)].id;
          bySlot[p.slot]=Object.assign({}, p, {rarity:up, uid:mkUid("fp")});
        }
      }
    }
    const parts=Object.values(bySlot).slice(0,10);

    // 词缀：从材料里继承，再补掷，保证前后缀与数量
    const pool=[];
    for(const it of items) for(const a of (it.affixes||[])) pool.push(a);
    const want=Math.min(10, 3 + (n-1) + (RNG.chance(0.5)?1:0));
    const affixes=[];
    while(affixes.length<want && pool.length){
      const i=RNG.ri(0,pool.length-1);
      const a=pool.splice(i,1)[0];
      if(a && !affixes.some(x=>x.nm===a.nm)){
        const cp=JSON.parse(JSON.stringify(a));
        cp.mods=(cp.mods||[]).map(m=>({stat:m.stat, value:Math.round(m.value*1.15*10)/10}));
        affixes.push(cp);
      }
    }
    if(affixes.length<3){
      for(const a of rollAffixes(R, ilvl, {element:main.element||"none"})){
        if(affixes.length>=want) break;
        if(!affixes.some(x=>x.nm===a.nm)) affixes.push(a);
      }
    }
    const mayhem=Math.max(0,...items.map(i=>i.mayhem||0)) + (RNG.chance(0.30+n*0.06)?1:0);
    const out=blGunConvert(generateWeapon(ilvl,{
      rarity:targetRar, type:main.type, manufacturer:main.manufacturer,
      element:main.element||"none", ilvl, mayhem, affixes, parts,
    }));
    out.uid=mkUid("fz"); out.kind="weapon";
    // 与组装枪一致地补齐显示字段（保证融合台结果卡与物品栏完全一致）
    const _R=RARITY_BY_ID[targetRar];
    out.qTier=RARITIES.indexOf(_R); out.qName=_R.name; out.qColor=_R.color;
    return out;
  }

  // 护盾：按同栏位护盾的等级 / 品级跃升，配件与前后缀按新表重掷
  if(main.kind==="shield"){
    const same=items.filter(i=>i.kind==="shield");
    const maxTier=Math.max(...same.map(i=>i.tier||1));
    /* v0.25.0：底材升阶与品质升阶都改成概率（见 raidFuseUpChance） */
    const tier=Math.min(9,maxTier+raidFuseRollUp(n));
    const maxR=Math.max(...same.map(i=>qOf(i)));
    const rar=Math.min(8,maxR+raidFuseRollUp(n)+raidFuseRollSecond(n));
    return raidMakeShield(tier,rar);
  }

  // 护甲 / 头盔
  if(main.kind==="armor" || main.kind==="helmet"){
    const same=items.filter(i=>(i.kind===main.kind)||(main.kind==="armor"&&i.kind===undefined));
    const maxTier=Math.max(...same.map(i=>i.tier||1));
    const tier=Math.min(9, maxTier + raidFuseRollUp(n));
    const maxR=Math.max(...same.map(i=>i.rarity|0));
    const rar=Math.min(8, maxR + raidFuseRollUp(n) + raidFuseRollSecond(n));
    return main.kind==="helmet" ? raidMakeHelmet(tier,rar) : raidMakeArmor(tier,rar);
  }

  // 配件
  const slot=main.slot || RNG.pick(GUN_SLOTS).id;
  const ilvl=Math.max(10,...items.map(i=>i.ilvl||10)) + n*2;
  const maxR=Math.max(...items.map(rarIdx));
  /* v0.25.0：配件融合同样按概率升品质 */
  const up=RARITIES[Math.min(RARITIES.length-1, maxR+raidFuseRollUp(n)+raidFuseRollSecond(n))].id;
  const pt=rollPart(slot, ilvl, up);
  pt.uid=mkUid("fp"); pt.kind="part";
  return pt;
}

/* ----------------------------- 枪械组装（底材 + 配件 + 材料） ----------------------------- */
// 组装投料份数：底材再贵也要自己配齐 8 份材料才能开装
const RAID_ASSEMBLE_MATS = 8;
const RAID_TYPE_BOOST = {
  rifle:  { dmg:1.08, rpm:1.04, value:1.06, label:"突击步枪强化 +8% 伤害 / +4% 射速" },
  sniper: { dmg:1.14, range:1.06, value:1.08, label:"狙击强化 +14% 伤害 / +6% 射程" },
};
// 品质由「底材等级 / 配件平均品质 / 材料平均品质」共同决定；枪名由底材与配件决定
function assembleRaidGun(recv, parts, mats){
  const partTier = parts.length
    ? parts.reduce((s,p)=>s+Math.max(0,RARITIES.findIndex(r=>r.id===p.rarity)),0)/parts.length
    : 0;
  const matTier = mats.length ? mats.reduce((s,m)=>s+(m.tier||0),0)/mats.length : 0;
  const qTier = M.clamp(Math.round(recv.tier*0.35 + partTier*0.45 + matTier*0.20), 0, 8);
  const ilvl = 12 + qTier*2 + parts.length*2 + mats.length*2;
  const out = blGunConvert(generateWeapon(ilvl, {
    type: recv.gunType,
    rarity: RAID_TIER_TO_RARITY[qTier] || "white",
    parts: parts.slice(),
  }));
  // 突击步枪 / 狙击枪投料最贵，给一点实打实的回报（伤害为主，狙击补射程）
  const boost = RAID_TYPE_BOOST[recv.gunType];
  if(boost){
    if(boost.dmg)   out.dmg   = Math.round(out.dmg*boost.dmg*10)/10;
    if(boost.rpm)   out.rpm   = Math.round(out.rpm*boost.rpm);
    if(boost.range) out.range = Math.round(out.range*boost.range);
    out.value = Math.round(out.value*(boost.value||1));
    out.typeBoost = boost.label;
  }
  // 组装枪名直接采用 generateWeapon 产出的名字（前缀+型号+后缀），
  // 不再拼「品质·底材·配件」三名词组合。
  out.receiver = recv.short;   // 记录所用底材型号（结算/图鉴用，不在主名称里展示）
  // out.name 已由 generateWeapon / blGunConvert 生成好，保持原样
  out.uid="as"+Date.now().toString(36)+Math.floor(Math.random()*999).toString(36);
  out.kind="weapon";
  ensureGunAffixes(out);
  out.qTier=qTier; out.qName=RAID_TIERS[qTier].name; out.qColor=RAID_TIERS[qTier].color;
  out.assembledFrom={ receiver:recv.id, parts:parts.map(p=>p.uid), mats:mats.map(m=>m.id) };
  return out;
}

function raidMatCount(stash, id){
  return (stash.materials||[]).filter(m=>m.id===id).length;
}
function raidCoreGroups(cores){
  const map={};
  for(const c of (cores||[])){
    const k=c.core+"|"+(c.elem||c.boost||"")+"|"+c.lv;
    if(!map[k]) map[k]={ core:c.core, elem:c.elem||null, lv:c.lv, n:0, sample:c };
    map[k].n++;
  }
  return Object.values(map);
}

UI.raidWorkshop=function(opts){
  opts=opts||{};
  const stash=RaidStash.load();
  stash.receivers=stash.receivers||[];
  stash.materials=stash.materials||[]; stash.parts=stash.parts||[];
  if(!UI._wsRecv || !stash.receivers.some(r=>r.uid===UI._wsRecv)) UI._wsRecv = stash.receivers[0]?stash.receivers[0].uid:null;
  // 配件不再限制 4 件 —— 每个槽位各装一件，最多装满 GUN_SLOTS 全部槽位
  UI._wsParts = (UI._wsParts||[]).filter(uid=>stash.parts.some(p=>p.uid===uid));
  { const seen={};
    UI._wsParts = UI._wsParts.filter(uid=>{
      const pt=stash.parts.find(p=>p.uid===uid); if(!pt) return false;
      if(seen[pt.slot]) return false; seen[pt.slot]=true; return true;
    });
  }
  UI._craft = UI._craft || { id:null, sel:[] };
  // 组装要投 8 份材料，同一种材料可以投多份
  { const keep=[];
    const used={};
    for(const id of (UI._wsMats||[])){
      if(!RAID_MAT_BY_ID[id]) continue;
      used[id]=(used[id]||0)+1;
      if(keep.length>=RAID_ASSEMBLE_MATS) continue;
      if(used[id]>raidMatCount(stash,id)) continue;
      keep.push(id);
    }
    UI._wsMats=keep;
  }

  /* --- 模块一览（v0.21.3 移除整块：改装模块已并入配件池，配装页 / 改装页都能直接看到，
         工坊里再列一遍只是重复说明，还占掉合成表的位置） --- */
  stash.keys=stash.keys||[];

  /* --- 合成表：自选材料，产物品质随材料等级走 --- */
  const matMap={};
  for(const m of stash.materials) matMap[m.id]=(matMap[m.id]||0)+1;
  const actRec = RAID_RECIPES.find(r=>r.id===UI._craft.id) || null;
  const recipeRows = RAID_RECIPES.map(r=>{
    const on = !!actRec && actRec.id===r.id;
    const sel = on ? UI._craft.sel : [];
    const mats = sel.map(id=>RAID_MAT_BY_ID[id]).filter(Boolean);
    const full = sel.length>=r.slots;
    // 投料标签按材料聚合（同一种材料可重复投），点一下减 1 份
    const groups=[];
    for(const id of sel){
      const g=groups.find(x=>x.id===id);
      if(g) g.n++; else groups.push({ id:id, n:1 });
    }
    const slotsHTML = groups.map(g=>{
      const m=RAID_MAT_BY_ID[g.id]||{name:g.id,tier:0};
      return `<span class="mat-slot on" data-unsmat="${g.id}" title="点击移除 1 份" style="border-color:${RAID_RARITY_COLOR[m.tier]};color:${RAID_RARITY_COLOR[m.tier]}">${m.name}${g.n>1?" ×"+g.n:""} ✕</span>`;
    }).join("") || `<span class="mat-slot">＋ 待投料，需 ${r.slots} 份</span>`;
    const fillHTML=`<div class="craft-fill"><span>投料 <b style="color:${full?'#7fe08a':'#ffd23f'}">${sel.length}/${r.slots}</b></span>
      <div class="craft-bar"><i style="width:${Math.round(sel.length/r.slots*100)}%;background:${full?'#7fe08a':'#ffd23f'}"></i></div></div>`;
    let qInfo=weaponQualityHidden()
      ? `<div class="si-stats" style="opacity:.62">精简显示：不标产出品质，需要 ${r.slots} 份材料</div>`
      : `<div class="si-stats" style="opacity:.62">产出品质由所选材料决定，需要 ${r.slots} 份材料</div>`;
    let fee=raidCraftFee([], r.slots);
    let can=false;
    if(full){
      const rg=raidCraftQRange(mats);
      const c0=RAID_RARITY_COLOR[rg[0]], c1=RAID_RARITY_COLOR[rg[1]];
      qInfo=weaponQualityHidden()
        ? `<div class="si-stats">产出：<b style="color:#cfcabb">已按材料算出</b><span style="opacity:.6">，材料均值 T${raidAvgMatTier(mats).toFixed(1)}，完整显示可见品质</span></div>`
        : `<div class="si-stats">产出品质 <b style="color:${c0}">${RAID_TIERS[rg[0]].name}</b>`+
          (rg[1]!==rg[0]?` ~ <b style="color:${c1}">${RAID_TIERS[rg[1]].name}</b>`:"")+
          `<span style="opacity:.6">，材料均值 T${raidAvgMatTier(mats).toFixed(1)}</span></div>`;
      fee=raidCraftFee(mats, r.slots);
      can = stash.creds>=fee;
    }
    return `<div class="shop-item noicon ${on?'sel':''}" data-recipe="${r.id}" style="cursor:pointer;border-left-color:${on?'#ffd23f':'#8fd0ff'};${on?'box-shadow:inset 0 0 0 1px rgba(255,210,63,.35);':''}">
      <div class="si-name" style="color:#cfd8e2">${r.name}<span style="font-size:11px;opacity:.7">，${r.tag}</span>${on?'<span style="float:right;font-size:10px;color:#ffd23f;font-weight:800">选材中</span>':''}</div>
      <div class="si-meta">${r.desc}</div>
      ${fillHTML}
      <div class="row" style="flex-wrap:wrap;gap:6px;margin:7px 0 4px;">${slotsHTML}</div>
      ${qInfo}
      <div class="si-buy">
        <span class="si-price ${can||!full?'':'cant'}">₽ ${priceTextShort(fee)}</span>
        <button class="btn" data-craft="${r.id}" ${can?'':'disabled'}>合成</button></div>
    </div>`;
  }).join('');

  const craftChips = Object.keys(matMap)
    .sort((a,b)=>(RAID_MAT_BY_ID[a]?RAID_MAT_BY_ID[a].tier:0)-(RAID_MAT_BY_ID[b]?RAID_MAT_BY_ID[b].tier:0))
    .map(id=>{
      const m=RAID_MAT_BY_ID[id]||{name:id,tier:0};
      const used=actRec ? UI._craft.sel.filter(x=>x===id).length : 0;
      const left=matMap[id]-used;
      const dim= left<=0 ? "opacity:.32;pointer-events:none;" : "";
      return `<span class="mat-chip-wrap" style="${dim}">
        <button class="btn ghost mat-chip" data-cmat="${id}" style="border-color:${RAID_RARITY_COLOR[m.tier]};color:${RAID_RARITY_COLOR[m.tier]}">${m.name} <b>×${left}</b></button>
        <button class="chip-max" data-cmatmax="${id}" title="把剩余槽位全部填成这种材料">＋满</button>
      </span>`;
    }).join('') || `<span class="hint">仓库没有原材料，先去突袭里搜刮</span>`;

  const craftBar = actRec ? `
    <div class="hint" style="margin:10px 0 6px;color:#ffd23f">正在为「${actRec.name}」选材（${UI._craft.sel.length}/${actRec.slots}）· 点材料每次投 1 份 ·「＋满」一次填满剩余槽位，点投料标签减 1 份</div>
    <div class="row" style="flex-wrap:wrap;gap:8px;">${craftChips}</div>` : "";

  /* --- 组装 --- */
  const recvCards = stash.receivers.length ? stash.receivers.map(r=>{
    const on=UI._wsRecv===r.uid;
    return `<div class="shop-item ${on?'sel':''}" data-recv="${r.uid}" style="border-left-color:${r.color};cursor:pointer;${on?('box-shadow:inset 0 0 0 2px '+r.color+';'):''}">
      <div class="si-name" style="color:${r.color}">${r.name}</div>
      <div class="si-meta">底材 T${r.tier}，${WEAPON_TYPES[r.gunType]?WEAPON_TYPES[r.gunType].name:r.gunType}</div>
      <div class="si-stats">估值 ₽${priceText(r.value)}</div>
    </div>`;
  }).join('') : `<div class="empty-hint">没有底材，用原材料合成「机匣」</div>`;

  const partCards = stash.parts.slice(0,60).map(pt=>{
    const on=UI._wsParts.includes(pt.uid);
    const col=partColor(pt);
    const qn=partQualityName(pt);
    return `<div class="shop-item ${on?'sel':''}" data-wpart="${pt.uid}" style="border-left-color:${col};cursor:pointer;${on?('box-shadow:inset 0 0 0 2px '+col+';'):''}">
      <div class="si-name" style="color:${col};font-size:12px;">${partNameOf(pt)}${qn?`<span style="opacity:.75;font-size:11px;">，${qn}</span>`:""}</div>
      <div class="si-meta">${partText(pt)}</div>
    </div>`;
  }).join('') || `<div class="empty-hint">没有配件，箱子里到处都是</div>`;

  // 组装用材料：共 8 份，同种可重复投
  const wsel=UI._wsMats||[];
  const wGroups=[];
  for(const id of wsel){
    const g=wGroups.find(x=>x.id===id);
    if(g) g.n++; else wGroups.push({ id:id, n:1 });
  }
  const wPills = wGroups.map(g=>{
    const m=RAID_MAT_BY_ID[g.id]||{name:g.id,tier:0};
    return `<span class="mat-slot on" data-unwmat="${g.id}" title="点击移除 1 份" style="border-color:${RAID_RARITY_COLOR[m.tier]};color:${RAID_RARITY_COLOR[m.tier]}">${m.name}${g.n>1?" ×"+g.n:""} ✕</span>`;
  }).join("") || `<span class="mat-slot">＋ 待投料，需 ${RAID_ASSEMBLE_MATS} 份</span>`;

  const matChips = Object.keys(matMap).map(id=>{
    const m=RAID_MAT_BY_ID[id]||{name:id,tier:0};
    const used=wsel.filter(x=>x===id).length;
    const left=matMap[id]-used;
    const dim= left<=0 ? "opacity:.32;pointer-events:none;" : "";
    return `<span class="mat-chip-wrap" style="${dim}">
      <button class="btn ghost mat-chip" data-wmat="${id}" style="border-color:${RAID_RARITY_COLOR[m.tier]};color:${RAID_RARITY_COLOR[m.tier]}">${m.name} <b>×${left}</b></button>
      <button class="chip-max" data-wmatmax="${id}" title="把剩余份数全部填成这种材料">＋满</button>
    </span>`;
  }).join('') || `<span class="hint">仓库没有原材料</span>`;

  // 预估品质
  let preview="";
  const recv=stash.receivers.find(r=>r.uid===UI._wsRecv);
  if(recv){
    const parts=stash.parts.filter(p=>UI._wsParts.includes(p.uid));
    const mats=UI._wsMats.map(id=>({id, tier:(RAID_MAT_BY_ID[id]||{tier:0}).tier}));
    const partTier = parts.length ? parts.reduce((s,p)=>s+Math.max(0,RARITIES.findIndex(r=>r.id===p.rarity)),0)/parts.length : 0;
    const matTier = mats.length ? mats.reduce((s,m)=>s+m.tier,0)/mats.length : 0;
    const qTier = M.clamp(Math.round(recv.tier*0.35 + partTier*0.45 + matTier*0.20), 0, 8);
    const boost=RAID_TYPE_BOOST[recv.gunType];
    preview=(weaponQualityHidden()
      ? `<div class="hint" style="color:#cfcabb">预估产物：<b>已按材料算出</b>，底材 T${recv.tier}，配件 ${parts.length} 件，材料 ${mats.length}/${RAID_ASSEMBLE_MATS} 份</div>`
      : `<div class="hint" style="color:${RAID_RARITY_COLOR[qTier]}">预估产物：<b>${RAID_TIERS[qTier].name}</b>，底材 T${recv.tier}，配件 ${parts.length} 件，材料 ${mats.length}/${RAID_ASSEMBLE_MATS} 份</div>`)+
      (boost?`<div class="hint" style="color:#7fe08a;margin-top:4px;">${boost.label}</div>`:"");
  }

  UI._set(`
    <div class="panel raid-setup">
      <h2 class="title-big" style="font-size:32px;">枪匠台 · 工坊</h2>
      <div class="subtitle">WORKSHOP · 材料合成 / 用机匣与部件组装枪械</div>
      ${forgeTabsHTML()}
      <div class="shop-bar">
        <div class="shop-desc"><b style="color:#7fd0ff">合成表改为自选材料</b>：投什么材料就出什么档的货——全用废金属只能做出普通货，投高阶材料才能出特种以上；材料越混搭，产物品质浮动越大。<b style="color:#ff9a3a">改装模块仍然不能合成</b>：只能从保险箱 / Raider 掉落，或在<b style="color:#7fd0ff">枪械商店与黑市</b>购买。钥匙可以在这里合成：<b style="color:#ffd76a">16 份原材料</b>做一把，级别由投料品质决定（I~V）。<b>弹药</b>在「弹药」页单独合成：轻弹 1 份 / 中弹 2 份 / 重弹 4 份 / 榴弹 8 份材料，每次出 30 发，产出的级别由材料品质决定（废金属出民用弹，高档材料才出特种弹）。<b>弹种适配组件</b>把武器更换弹种为对应弹种并加弹药效能，<b>膛压组件</b>决定<b style="color:#ff2ce0">改装等级</b>、<b>改装模块</b>提供属性增益——单枚增益已大幅提升，拿到就是质变。组装出的枪，名字与品质由底材、配件与材料共同决定${weaponQualityHidden()?"（当前精简显示，品质与前后缀不显示）":""}。</div>
        <div class="shop-gold">仓库卢布 ₽ ${priceTextShort(stash.creds)}</div>
        <button class="btn ghost" id="btn-ws-back">${opts.from==='title'?'返回主菜单':'前往配装大厅'}</button>
      </div>

      <h3 style="font-size:18px;margin:18px 0 8px;">① 合成表 <span style="color:var(--muted);font-size:12px;font-weight:400;">自选材料，只产出机匣 / 配件，不出改装模块</span></h3>
      <div class="shop-list">${recipeRows}</div>
      ${craftBar}

      <h3 style="font-size:18px;margin:18px 0 8px;">② 组装枪械 <span style="color:var(--muted);font-size:12px;font-weight:400;">选 1 个底材 + 每个槽位 1 件配件 + ${RAID_ASSEMBLE_MATS} 份材料</span></h3>
      <div class="shop-list">${recvCards}</div>
      <div class="hint" style="margin:10px 0 6px;">配件（已选 ${UI._wsParts.length} 件，同一槽位只装一件，再点即替换）</div>
      <div class="shop-list">${partCards}</div>
      <div class="hint" style="margin:10px 0 6px;">材料（已投 ${UI._wsMats.length}/${RAID_ASSEMBLE_MATS} 份，同种材料可重复投）</div>
      <div class="row" style="flex-wrap:wrap;gap:6px;margin-bottom:8px;">${wPills}</div>
      <div class="row" style="flex-wrap:wrap;gap:8px;">${matChips}</div>
      <div style="margin-top:12px;">${preview}</div>
      <div class="row" style="margin-top:10px;">
        <button class="btn ${recv && UI._wsMats.length>=RAID_ASSEMBLE_MATS?'':'btn-disabled'}" id="btn-assemble">组装枪械</button>
        <button class="btn ghost" id="btn-ws-clear">清空选择</button>
      </div>
    </div>`, true);

  const rerender=()=>UI.raidWorkshop(opts);
  UI.overlay.querySelectorAll('[data-ftab]').forEach(el=>{
    el.onclick=()=>{ UI._forgeTab=el.dataset.ftab; SFX.ui(); UI.raidForge(opts); };
  });
  document.getElementById('btn-ws-back').onclick=()=>{
    SFX.ui();
    if(opts.from==='title'){ UI.raidForge && (UI._forgeTab='forge'); game.toTitle(); }
    else UI.raidSetup();
  };
  document.getElementById('btn-ws-clear').onclick=()=>{ UI._wsParts=[]; UI._wsMats=[]; UI._craft={ id:UI._craft.id, sel:[] }; SFX.ui(); rerender(); };

  // 合成：自选材料 → 产出
  UI.overlay.querySelectorAll('[data-recipe]').forEach(el=>{
    el.onclick=(e)=>{
      if(e.target.closest('[data-craft]')||e.target.closest('[data-unsmat]')) return;
      const id=el.dataset.recipe;
      if(UI._craft.id!==id){ UI._craft={ id, sel:[] }; }
      SFX.ui(); rerender();
    };
  });
  // 投料：点标签减 1 份
  UI.overlay.querySelectorAll('[data-unsmat]').forEach(el=>{
    el.onclick=(e)=>{
      e.stopPropagation();
      const id=el.dataset.unsmat;
      const i=UI._craft.sel.lastIndexOf(id);
      if(i>=0){ UI._craft.sel.splice(i,1); SFX.ui(); rerender(); }
    };
  });
  // 投料：点材料每次 +1 份（同一种可以连续投）
  const craftAdd=(id,n)=>{
    const r=RAID_RECIPES.find(x=>x.id===UI._craft.id);
    if(!r){ UI.toast && UI.toast("先点一张配方卡"); return; }
    const room=r.slots-UI._craft.sel.length;
    if(room<=0){ UI.toast && UI.toast("槽位已满，点投料标签可移除"); return; }
    const used=UI._craft.sel.filter(x=>x===id).length;
    const left=raidMatCount(stash,id)-used;
    if(left<=0){ UI.toast && UI.toast("这种材料不够了"); return; }
    const k=Math.min(n||1, room, left);
    for(let i=0;i<k;i++) UI._craft.sel.push(id);
    SFX.ui(); rerender();
  };
  UI.overlay.querySelectorAll('[data-cmat]').forEach(el=>{
    el.onclick=(e)=>{ e.stopPropagation(); craftAdd(el.dataset.cmat, 1); };
  });
  UI.overlay.querySelectorAll('[data-cmatmax]').forEach(el=>{
    el.onclick=(e)=>{ e.stopPropagation(); craftAdd(el.dataset.cmatmax, 99); };
  });
  UI.overlay.querySelectorAll('[data-craft]').forEach(el=>{
    el.onclick=(e)=>{
      e.stopPropagation();
      const r=RAID_RECIPES.find(x=>x.id===el.dataset.craft);
      if(!r) return;
      const sel=(UI._craft.id===r.id)?UI._craft.sel.slice():[];
      if(sel.length<r.slots){ UI.toast && UI.toast("先把材料槽填满"); return; }
      const mats=[];
      for(const id of sel){
        const i=stash.materials.findIndex(m=>m.id===id);
        if(i<0){ UI.toast && UI.toast("材料不足"); return; }
        mats.push(stash.materials.splice(i,1)[0]);
      }
      const fee=raidCraftFee(mats, r.slots);
      if(stash.creds<fee){
        for(const m of mats) stash.materials.push(m);   // 钱不够，材料退回
        UI.toast && UI.toast("卢布不足");
        return;
      }
      stash.creds-=fee;
      const q=raidCraftQTier(mats);
      const out=r.make(mats, q);
      out.craftedTier=q;
      if(r.kind==="core") stash.parts.push(out);
      else if(r.kind==="med"){ stash.meds=stash.meds||{}; stash.meds[out.id]=(stash.meds[out.id]||0)+1; }
      else if(r.kind==="part") stash.parts.push(out);
      else if(r.kind==="armor") stash.armors.push(out);
      else if(r.kind==="helmet") stash.helmets.push(out);
      else if(r.kind==="shield") (stash.shields=stash.shields||[]).push(out);
      else if(r.kind==="receiver") stash.receivers.push(out);
      else if(r.kind==="ammo"){
        stash.ammo=stash.ammo||{};
        stash.ammo[out.id]=(stash.ammo[out.id]||0)+(out.n||RAID_AMMO_STACK);
      }
      else if(r.kind==="key"){
        stash.keys=stash.keys||[];
        stash.keys.push(out);
      }
      UI._craft.sel=[];
      RaidStash.save(stash); SFX.pickup();
      UI.toast && UI.toast(`合成成功，${weaponQualityHidden()?"":RAID_TIERS[q].name+"级"}${r.name}`);
      rerender();
    };
  });
  // 选择底材 / 配件 / 材料
  UI.overlay.querySelectorAll('[data-recv]').forEach(el=>{
    el.onclick=()=>{ UI._wsRecv=el.dataset.recv; SFX.ui(); rerender(); };
  });
  UI.overlay.querySelectorAll('[data-wpart]').forEach(el=>{
    el.onclick=()=>{
      const uid=el.dataset.wpart;
      const i=UI._wsParts.indexOf(uid);
      if(i>=0){ UI._wsParts.splice(i,1); SFX.ui(); rerender(); return; }
      // 同槽位只装一件：选中新配件时把旧的那件挤掉
      const pt=stash.parts.find(p=>p.uid===uid);
      if(pt) UI._wsParts=UI._wsParts.filter(x=>{
        const o=stash.parts.find(p=>p.uid===x);
        return !o || o.slot!==pt.slot;
      });
      UI._wsParts.push(uid);
      SFX.ui(); rerender();
    };
  });
  // 投料：点材料 +1 份（同种可重复），点已投标签减 1 份
  const wsAdd=(id,n)=>{
    const room=RAID_ASSEMBLE_MATS-UI._wsMats.length;
    if(room<=0){ UI.toast && UI.toast("材料已满 8 份，点标签可移除"); return; }
    const used=UI._wsMats.filter(x=>x===id).length;
    const left=raidMatCount(stash,id)-used;
    if(left<=0){ UI.toast && UI.toast("这种材料不够了"); return; }
    const k=Math.min(n||1, room, left);
    for(let i=0;i<k;i++) UI._wsMats.push(id);
    SFX.ui(); rerender();
  };
  UI.overlay.querySelectorAll('[data-wmat]').forEach(el=>{
    el.onclick=(e)=>{ e.stopPropagation(); wsAdd(el.dataset.wmat, 1); };
  });
  UI.overlay.querySelectorAll('[data-wmatmax]').forEach(el=>{
    el.onclick=(e)=>{ e.stopPropagation(); wsAdd(el.dataset.wmatmax, 99); };
  });
  UI.overlay.querySelectorAll('[data-unwmat]').forEach(el=>{
    el.onclick=(e)=>{
      e.stopPropagation();
      const id=el.dataset.unwmat;
      const i=UI._wsMats.lastIndexOf(id);
      if(i>=0){ UI._wsMats.splice(i,1); SFX.ui(); rerender(); }
    };
  });
  // 组装
  const btn=document.getElementById('btn-assemble');
  if(btn) btn.onclick=()=>{
    const recv=stash.receivers.find(r=>r.uid===UI._wsRecv);
    if(!recv){ UI.toast && UI.toast("请先选择一个底材"); return; }
    if(UI._wsMats.length<RAID_ASSEMBLE_MATS){ UI.toast && UI.toast(`需要投满 ${RAID_ASSEMBLE_MATS} 份材料（当前 ${UI._wsMats.length}）`); return; }
    if(stash.creds<500){ UI.toast && UI.toast("组装需要 ₽500"); return; }
    const parts=stash.parts.filter(p=>UI._wsParts.includes(p.uid));
    const mats=[];
    for(const id of UI._wsMats){
      const i=stash.materials.findIndex(m=>m.id===id);
      if(i>=0) mats.push(stash.materials.splice(i,1)[0]);
    }
    if(mats.length<RAID_ASSEMBLE_MATS){
      for(const m of mats) stash.materials.push(m);   // 材料没凑够，原样退回
      RaidStash.save(stash);
      UI.toast && UI.toast("仓库材料不足"); return;
    }
    const gun=assembleRaidGun(recv, parts, mats);
    stash.creds-=500;
    stash.receivers=stash.receivers.filter(r=>r.uid!==recv.uid);
    stash.parts=stash.parts.filter(p=>!UI._wsParts.includes(p.uid));
    stash.weapons.push(gun);
    UI._wsParts=[]; UI._wsMats=[];
    RaidStash.save(stash); SFX.pickup();
    UI._wsResult=gun;
    UI.raidWorkshop(opts);
  };
};
