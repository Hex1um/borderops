/* =========================================================================
 * auction.js — 拍卖行（Tarkov Auction House）
 *   · 大厅：别的 PMC / Scav 挂出来的货，可「出价」竞拍，也可「一口价」直接买走
 *   · 出售：把仓库里的装备 / 配件 / 材料 / 改装模块挂上去，等买家上门（比商人回收更赚）
 *   · 我的：自己的挂单（可撤单）+ 成交记录
 *   全部用仓库卢布结算，数据独立存在 localStorage: raid_auction_v1
 * ========================================================================= */

const AUCTION_KEY      = "raid_auction_v1";
const AUCTION_FEE      = 0.03;    // 上架费：按起拍价 3%（最低 ₽50）
const AUCTION_COMM     = 0.05;    // 成交佣金 5%
const AUCTION_MAX      = 10;      // 货架上同时展示的挂单数
const AUCTION_POOL     = 18;      // 每期货池总量（买走一件就露出下一件，池子空了等下一期）
const AUCTION_MAIL_MAX = 40;
const AUCTION_SELL_MS  = 4*60*1000;   // 玩家挂单时长 4 分钟

/* v0.21.3：拍卖行改成「全网同一份货」。
 * 没有后端也能做到：货架完全由**期号**决定 —— 期号 = floor(now / 10 分钟)，
 * 期号 → 32 位种子 → 用 RNG.setSeed 重放生成整期货池。任何设备、任何存档，
 * 只要在同一期打开，看到的就是同一批货、同一口价、同一结束时间。
 * 玩家自己的出价 / 已买走的下架记录是本地状态（不带服务器没法共享），
 * 但「货架上有什么」是全球一致的。 */
const AUCTION_BUCKET_MS = 10*60*1000;
function auctionBucket(ms){ return Math.floor((ms||Date.now())/AUCTION_BUCKET_MS); }
function auctionBucketEnd(b){ return (b+1)*AUCTION_BUCKET_MS; }
function auctionBucketSeed(b){
  // FNV-1a：把期号稳定地摊成 32 位种子（同一个期号在任何设备上算出同一个值）
  const str="borderops-auction-v1:"+b;
  let h=0x811c9dc5;
  for(let i=0;i<str.length;i++){ h^=str.charCodeAt(i); h=Math.imul(h,0x01000193)>>>0; }
  return h>>>0;
}

const AUCTION_SELLERS = ["黑鸦","老K","格里莎","夜莺","铁皮","库兹马","孤狼","白桦",
  "十三号","锈钉","邮差","雪松","雪貂","老兵","浣熊","锯齿","Кот","邮差七号"];

const AUCTION_KIND_MAP = {
  weapon:"weapons", armor:"armors", helmet:"helmets",
  part:"parts", material:"materials",
};
const AUCTION_KIND_NAME = {
  weapon:"枪械", armor:"护甲", helmet:"头盔",
  part:"配件", material:"原材料", core:"改装模块",
};

function auctionUid(p){
  return (p||"au")+Date.now().toString(36)+Math.floor(Math.random()*1e5).toString(36);
}
function auctionRound(v){ return Math.max(0, Math.round(v/10)*10); }

/* 估值：不同种类走各自的定价口径 */
function auctionValue(kind, it){
  if(!it) return 0;
  if(kind==="part") return it.slot==="core" ? (it.value||0) : (partValue(it)||0);
  return it.value||0;
}

/* 统一展示信息（名字 / 颜色 / 副行 / 数值行） */
function auctionItemInfo(kind, it){
  if(kind==="weapon"){
    const w=it, col=raidGunColor(w);
    const tname=WEAPON_TYPES[w.type]?WEAPON_TYPES[w.type].name:(w.cat||w.type||"枪械");
    /* v0.21.6：精简显示不摊词缀；完整显示才把词条列出来 */
    const hide=weaponQualityHidden();
    const aff=hide? "" : (w.affixes||[]).map(a=>a.nm).join("，");
    const qn=raidGunName(w);
    return {
      name:gunNameOf(w), color:col, value:w.value||0,
      meta:`${tname}${qn?"，"+qn:""}，${gunDamageLabel(w)}，弹匣 ${w.mag}，射速 ${w.rpm}，配件 ${(w.parts||[]).length}${w.uniqPerk?"，传奇":""}`,
      stats:(hide? "" : (w.uniqPerk?`✦ ${w.uniqPerk}<br>词条：${aff}`:(aff?`词条：${aff}`:"无词条"))),
      perk:w.uniqPerk||"",
    };
  }
  if(kind==="armor"||kind==="helmet"){
    const rar=it.rarity|0, col=RAID_RARITY_COLOR[rar];
    const isH=kind==="helmet";
    const aff=(it.affixes||[]).map(a=>a.nm).join("，");
    return {
      name:it.name, color:col, value:it.value||0,
      meta:`T${it.tier} ${isH?"头盔":"护甲"}，${RAID_RARITY_NAME[rar]}，${isH?"爆头减伤":"减伤"} ${Math.round((it.dr||0)*100)}%${it.armorRegen?("，待维修 "+it.armorRegen+"/s"):""}${it.uniqPerk?"，传奇":""}`,
      stats:(it.uniqPerk?`✦ ${it.uniqPerk}`:`${isH?"耐久":"护甲值"} ${it.maxArmor}${aff?("，词条："+aff):""}`),
      perk:it.uniqPerk||"",
    };
  }
  if(kind==="part"){
    if(it.slot==="core" || it.core){
      const cname=raidCoreName(it);
      let meta, stats;
      if(it.core==="chaos"){ meta=`改装模块，改装，[${RAID_ROMAN[it.lv]||it.lv}]`; stats="装入枪械改装槽，决定改装等级（1.12^m 指数放大）"; }
      else if(it.core==="elem"){ const E=ELEMENTS[it.elem]||ELEMENTS.fire; meta=`弹种适配组件，${E.name} [${RAID_ROMAN[it.lv]||it.lv}]`; stats="装入枪械改装槽，更换适配弹药并提升弹药效能"; }
      else { const d=BOOST_CORE_TYPES[it.boost]; meta=`改装模块，强化，${d?d.name:"强化"} [${RAID_ROMAN[it.lv]||it.lv}]`; stats="装入枪械改装槽，提供属性增益"; }
      return { name:cname, color:it.color||"#8fd0ff", value:it.value||0, meta, stats };
    }
    /* v0.21.7：配件与枪械同一套显示分层 —— 精简只留槽位名，完整才给词缀名 / 品质 / iLv */
    const col=partColor(it);
    const sn=GUN_SLOT_BY_ID[it.slot]?GUN_SLOT_BY_ID[it.slot].name:it.slot;
    const qn=partQualityName(it);
    return {
      name:partNameOf(it), color:col, value:partValue(it),
      meta:`配件，${sn}槽位${qn?"，"+qn:""}${weaponQualityHidden()?"":`，iLv ${it.ilvl||1}`}`,
      stats:weaponQualityHidden()? "" : partText(it),
    };
  }
  if(kind==="material"){
    const t=it.tier|0;
    const base=RAID_MAT_BY_ID[it.id];
    return {
      name:it.name, color:it.color||RAID_RARITY_COLOR[t], value:it.value||0,
      meta:`原材料，${RAID_RARITY_NAME[t]}，${base?base.tag:"材料"}`,
      stats:`合成 / 组装枪械的消耗品，估值 ₽${priceText(it.value||0)}`,
    };
  }
}

/* 分组签名：把「完全相同的物品」归到同一张卡（材料按 id，其余按 名称+关键属性）。
 * 不含冒号，便于塞进 data-list="kind:sig:mode" 里用 split(':') 解析。 */
function auctionItemKey(kind, it){
  const k=(s)=>String(s).replace(/[:|]/g,"_");
  if(kind==="material") return "mat_"+k(it.id);
  if(kind==="weapon")   return "w_"+k([it.type, Math.round(it.dmg), Math.round(it.rpm), it.rarity, (it.parts||[]).length, it.name].join("_"));
  if(kind==="part")     return it.slot==="core"
    ? "co_"+k([it.core, it.boost||it.elem||"", it.lv].join("_"))
    : "pt_"+k([it.slot, it.name, it.rarity].join("_"));
  if(kind==="armor")    return "a_"+k([it.tier, it.rarity, it.name].join("_"));
  if(kind==="helmet")   return "h_"+k([it.tier, it.rarity, it.name].join("_"));
  return "co_"+k([it.core, it.boost||it.elem||"", it.lv].join("_"));   // core（兜底）
}

/* 出售成功率：报价越高越难卖（0.12 ~ 0.95） */
function auctionSellChance(price, val){
  if(val<=0) return 0;
  return M.clamp(1.75 - (price/val)*1.05, 0.10, 0.95);
}

/* 生成一件拍卖品（大厅挂单的货） */
function auctionRollItem(forceKind){
  if(forceKind==="core") return auctionRollCoreItem();
  const r=RNG.f();
  // 9 阶权重：低阶材料已大幅贬值（T0 仅 ₽20），大厅不再刷满废铁，偏向中高档货
  const tierW=[6,12,20,18,15,11,8,6,4];
  const pickTier=()=>RNG.weighted(tierW.map(w=>({weight:w})));

  if(r<0.22){                                       // 枪械（5% 概率是有名字的传奇枪）
    if(RNG.chance(0.05)){
      const pool=RAID_UNIQUES.filter(u=>u.kind==="weapon" && u.tier<=7);
      if(pool.length){ const it=raidMakeUnique(pool[RNG.ri(0,pool.length-1)]); return { kind:"weapon", item:it }; }
    }
    const type=RNG.pick(RAID_GUN_TYPES);
    const t=pickTier();
    const w=blGunGen(11+t*2, { type, rarity:RAID_TIER_TO_RARITY[t] });
    ensureGunAffixes(w);
    w.uid=auctionUid("auw"); w.kind="weapon";
    w.qTier=t; w.qName=RAID_TIERS[t].name; w.qColor=RAID_TIERS[t].color;
    return { kind:"weapon", item:w };
  }
  if(r<0.34){                                       // 护甲
    const t=RNG.ri(2,7), rar=RNG.ri(0, Math.min(8, t));
    const a=raidMakeArmor(t,rar); a.uid=auctionUid("aua"); a.kind="armor";
    return { kind:"armor", item:a };
  }
  if(r<0.43){                                       // 头盔
    const t=RNG.ri(2,7), rar=RNG.ri(0, Math.min(8, t));
    const h=raidMakeHelmet(t,rar); h.uid=auctionUid("auh"); h.kind="helmet";
    return { kind:"helmet", item:h };
  }
  if(r<0.68){                                       // 配件
    const slot=RNG.pick(GUN_SLOTS).id;
    const ri=RNG.weighted([{weight:26},{weight:24},{weight:20},{weight:14},{weight:8},{weight:5},{weight:3}]);
    const pt=rollPart(slot, RNG.ri(12,22), (RARITIES[ri]||RARITIES[0]).id);
    pt.uid=auctionUid("aup"); pt.kind="part";
    return { kind:"part", item:pt };
  }
  if(r<0.87){                                       // 原材料
    const t=pickTier();
    const pool=RAID_MATERIALS.filter(m=>m.tier===t);
    const base=pool.length?RNG.pick(pool):RAID_MATERIALS[0];
    const mult=1+RAID_RARITY_VAL[t];
    const m={ kind:"material", id:base.id, name:base.name, tier:t, rarity:t,
      value:auctionRound(base.value*mult), color:RAID_RARITY_COLOR[t], uid:auctionUid("aum") };
    return { kind:"material", item:m };
  }
  return auctionRollCoreItem();
}

/* 改装模块货：弹种适配组件 / 膛压组件 / 改装模块（突袭之外唯一的获取渠道，因此单列一个生成器） */
function auctionRollCoreItem(){
  const lv=M.clamp(1+RNG.weighted([{weight:34},{weight:28},{weight:20},{weight:11},{weight:7}]),1,RAID_CORE_MAX);
  let c;
  const t=RNG.chance(0.30);
  if(t){
    if(RNG.chance(0.45)) c=raidMakeChaosCore(lv);
    else c=raidMakeElemCore(RNG.pick(RAID_ELEM_CORE_ELEMS),lv);
  } else {
    c=raidMakeBoostCore(RNG.pick(BOOST_CORE_IDS), lv);
  }
  c.uid=auctionUid("auc");
  return { kind:"part", item:c };
}

/* 把一件货变成一条挂单 */
function auctionMakeListing(endsAt, forceKind){
  const g=auctionRollItem(forceKind);
  const val=auctionValue(g.kind, g.item);
  // 低价货不再被硬性抬到 50：起拍真实反映估值（最低 5 卢布，避免出现 ₽0 挂单）
  const start=Math.max(5, auctionRound(val*RNG.fr(0.42,0.70)));
  const buyout=Math.max(start+10, auctionRound(val*RNG.fr(1.12,1.42)));
  return {
    id:auctionUid("L"),
    kind:g.kind,
    item:g.item,
    seller:RNG.pick(AUCTION_SELLERS),
    start, price:start, buyout,
    bids:RNG.ri(0,6),
    endsAt:endsAt,                       // v0.21.3：整期统一在同一时刻结束
    yourBid:0, outbidAt:0, outbidPrice:0,
  };
}

const Auction = {
  /* ----------------------------- 存取 ----------------------------- */
  /* 本地只存三样：期号 / 确定性的货池 / 可变状态（出价、已买断的下架）
   * 货架本身（d.listings）每次从「期号 + 种子」重放出来，所以是全网一致的。 */
  _read(){
    /* v0.23.1：统一走 Store。只挡「压根不是普通对象」的脏档（数组 / 数字 / 字符串），
       字段级修补仍留在下面 —— 旧版本档缺字段是常态，不该被当成坏档隔离。 */
    let d=Store.getJSON(AUCTION_KEY, null,
      v=>v && typeof v==="object" && !Array.isArray(v));
    if(!d) d={};
    d.mine=Array.isArray(d.mine)?d.mine:[];
    d.mail=Array.isArray(d.mail)?d.mail:[];
    d.state=(d.state && typeof d.state==="object")?d.state:{};
    d.taken=(d.taken && typeof d.taken==="object")?d.taken:{};
    d.pool=Array.isArray(d.pool)?d.pool:[];
    if(d.nextRefresh===undefined) d.nextRefresh=0;
    if(d.bucket===undefined) d.bucket=-1;
    return d;
  },

  load(){
    const d=this._read();
    const b=auctionBucket();
    if(d.bucket!==b){
      // 跨期：先把上一期的出价收尾（拍下 / 退回），再整体换成本期全网同一份货
      this._closeBucket(d);
      d.bucket=b; d.pool=this.buildPool(b); d.state={}; d.taken={};
      this.save(d);
    }
    if(!d.pool.length){ d.pool=this.buildPool(b); d.bucket=b; this.save(d); }
    d.listings=this._materialize(d);
    return d;
  },

  /* 本期货池：期号 → 种子 → 重放生成 AUCTION_POOL 件货。
   * 第 0 位固定是改装模块（弹种 / 膛压组件是突袭之外唯一获取渠道）。 */
  buildPool(bucket){
    const end=auctionBucketEnd(bucket);
    const prev=RNG.rng;
    RNG.setSeed(auctionBucketSeed(bucket));
    const pool=[];
    try{
      for(let i=0;i<AUCTION_POOL;i++){
        const L=auctionMakeListing(end, i===0 ? "core" : null);
        L.id="L"+bucket+"_"+i;      // 稳定 id：同一期在任何设备上都一样
        pool.push(L);
      }
    }finally{ RNG.rng=prev; }       // 别把局内 / 其它系统的随机序列搅乱
    return pool;
  },

  /* 货池 + 本地状态 → 当前货架（去掉已买断的，取前 AUCTION_MAX 件） */
  _materialize(d){
    const out=[];
    for(const L of (d.pool||[])){
      if(d.taken[L.id]) continue;
      out.push(Object.assign({}, L, d.state[L.id]||{}));
      if(out.length>=AUCTION_MAX) break;
    }
    return out;
  },

  /* 跨期收尾：还冻着出价的按「被超越就退钱 / 否则视为拍下」处理。
   * 旧版本（v0.21.2 及以前）存的是自带倒计时的 listings，升级时也在这里退钱。 */
  _closeBucket(d){
    const stash=RaidStash.load();
    let money=false, n=0;
    for(const id of Object.keys(d.state||{})){
      const st=d.state[id];
      if(!st || !(st.yourBid>0)) continue;
      const L=(d.pool||[]).find(x=>x.id===id);
      if(!L){ stash.creds+=st.yourBid; money=true; n++; delete d.state[id]; continue; }
      if(st.outbidAt){
        stash.creds+=st.yourBid; money=true; n++;
        this.note(d,"竞价被超越",`${auctionItemInfo(L.kind,L.item).name} 被人抬到 ₽${priceText(st.outbidPrice||st.yourBid)}，出价已退回。`,"warn");
      } else {
        this.deposit(stash, L.kind, L.item); n++;
        this.note(d,"竞拍成功",`上期以 ₽${priceText(st.yourBid)} 拍下 ${auctionItemInfo(L.kind,L.item).name}，已放入仓库。`,"ok");
      }
      // v0.21.9：处理完即删记录，防止同一出价被重复收尾
      delete d.state[id];
    }
    for(const L of (Array.isArray(d.listings)?d.listings:[])){
      if(L && L.yourBid>0){
        stash.creds+=L.yourBid; money=true; n++;
        this.note(d,"拍卖结束",`${auctionItemInfo(L.kind,L.item).name} 的旧挂单已下架，出价 ₽${priceText(L.yourBid)} 已退回。`,"warn");
      }
    }
    if(money) RaidStash.save(stash);
    return n;
  },

  save(d){
    // 把货架上的可变字段写回 state（价格 / 出价 / 被抬价时间）
    const st=d.state=d.state||{};
    for(const L of (d.listings||[])){
      st[L.id]={ price:L.price, bids:L.bids, yourBid:L.yourBid,
                 outbidAt:L.outbidAt||0, outbidPrice:L.outbidPrice||0 };
    }
    /* 拍卖行是纯本地缓存：写失败不影响成交（成交已即时写进仓库），
       所以不做重试，只在 Store 里限流告警一次。 */
    Store.setJSON(AUCTION_KEY, {
      bucket:d.bucket, pool:d.pool, state:st, taken:d.taken||{},
      mine:d.mine||[], mail:d.mail||[], nextRefresh:d.nextRefresh||0,
    });
  },

  refill(d){
    d.listings=this._materialize(d);
    this.save(d);
  },

  note(d, title, text, cls){
    d.mail.unshift({ id:auctionUid("m"), ts:Date.now(), title, text, cls:cls||"" });
    if(d.mail.length>AUCTION_MAIL_MAX) d.mail.length=AUCTION_MAIL_MAX;
  },

  /* 入库：把拍卖得到的东西塞回仓库 */
  deposit(stash, kind, item){
    const key=AUCTION_KIND_MAP[kind]||"parts";
    const arr=stash[key]=stash[key]||[];
    if(!item.uid) item.uid=auctionUid("it");
    if(kind==="weapon"||kind==="armor"||kind==="helmet"||kind==="part") item.kind=kind;
    arr.push(item);
    return arr.length;
  },

  /* ----------------------------- 结算 ----------------------------- */
  // 返回本次新产生的通知条数（用于提示）
  settle(){
    const d=this.load();
    const now=Date.now();
    const stash=RaidStash.load();
    let changed=false, money=false, n=0;

    // 1) 玩家挂单
    const mineKeep=[];
    for(const L of d.mine){
      if(L.soldAt && now>=L.soldAt){
        const net=auctionRound(L.price*(1-AUCTION_COMM));
        stash.creds+=net; money=true; changed=true; n++;
        this.note(d, "已售出",
          `${L.buyer||"买家"} 以 ₽${priceText(L.price)} 买走 ${L.name}，扣 5% 佣金后入账 ₽${priceText(net)}。`, "ok");
      } else if(now>=L.endsAt){
        this.deposit(stash, L.kind, L.item);
        changed=true; n++;
        this.note(d, "流拍退回", `${L.name} 到期无人接盘，已退回仓库（上架费不退）。`, "warn");
      } else mineKeep.push(L);
    }
    d.mine=mineKeep;

    // 2) 大厅挂单：先处理「被超越」，再处理「到点成交」
    const keep=[];
    for(const L of d.listings){
      if(L.yourBid>0 && L.outbidAt && now>=L.outbidAt && L.outbidAt<=L.endsAt){
        stash.creds+=L.yourBid; money=true; changed=true; n++;
        const nm=auctionItemInfo(L.kind,L.item).name;
        this.note(d, "竞价被超越",
          `${nm} 有人抬到 ₽${priceText(L.outbidPrice)}，你的 ₽${priceText(L.yourBid)} 已退回。`, "warn");
        L.price=Math.max(L.price, L.outbidPrice);
        L.bids++; L.yourBid=0; L.outbidAt=0; L.outbidPrice=0;
      }
      if(now>=L.endsAt){
        if(L.yourBid>0){
          this.deposit(stash, L.kind, L.item);
          this.note(d, "竞拍成功",
            `以 ₽${priceText(L.yourBid)} 拍下 ${auctionItemInfo(L.kind,L.item).name}，已放入仓库。`, "ok");
          n++;
        }
        d.taken[L.id]=1;          // 拍下的货从本地下架，别被货池重新顶回来
        // v0.21.9：同 buyout —— 清掉 state 出价记录，避免跨期二次入账
        L.yourBid=0; delete d.state[L.id];
        changed=true; continue;
      }
      keep.push(L);
    }
    d.listings=keep;

    /* 3) 先写回可变状态，再按本期货池重建货架（跨期换池在 load() 里做）。
     * 顺序不能反：refill 是从 pool+state 重放出来的，先 refill 会把上面刚改的
     * 价格 / yourBid 覆盖掉。 */
    if(money) RaidStash.save(stash);
    this.save(d);
    d.listings=this._materialize(d);
    this.save(d);
    return n;
  },

  /* ----------------------------- 出价 / 一口价 ----------------------------- */
  bid(id){
    const d=this.load();
    const stash=RaidStash.load();
    const L=d.listings.find(x=>x.id===id);
    if(!L) return { ok:false, msg:"这件货已经不在货架上了" };
    const now=Date.now();
    if(now>=L.endsAt) return { ok:false, msg:"拍卖已结束" };
    if(L.yourBid>0) return { ok:false, msg:"你已经是最高出价者" };

    const inc=Math.max(5, auctionRound(L.price*0.06));
    const bid=L.price+inc;
    if(stash.creds<bid) return { ok:false, msg:`卢布不足，本次出价需要 ₽${priceText(bid)}` };

    stash.creds-=bid;
    L.price=bid; L.yourBid=bid; L.bids++;

    // NPC 是否反超：出价越接近一口价，被反超的概率越低
    const margin=L.buyout>0 ? bid/L.buyout : 1;
    const pOut=M.clamp(1.0 - margin*0.7, 0.06, 0.85);
    if(RNG.chance(pOut)){
      const at=now + RNG.fr(12,50)*1000;
      if(at < L.endsAt-3000){
        L.outbidAt=at;
        L.outbidPrice=bid+Math.max(5, auctionRound(bid*0.06));
      }
    }
    RaidStash.save(stash); this.save(d);
    return { ok:true, msg:`出价 ₽${priceText(bid)}，${L.outbidAt?"暂时领先，小心被抬价":"看起来稳了"}` };
  },

  buyout(id){
    const d=this.load();
    const stash=RaidStash.load();
    const i=d.listings.findIndex(x=>x.id===id);
    if(i<0) return { ok:false, msg:"这件货已经不在货架上了" };
    const L=d.listings[i];
    if(Date.now()>=L.endsAt) return { ok:false, msg:"拍卖已结束" };
    if(stash.creds<L.buyout) return { ok:false, msg:`卢布不足，一口价需要 ₽${priceText(L.buyout)}` };

    stash.creds-=L.buyout;
    if(L.yourBid>0) stash.creds+=L.yourBid;          // 退还已冻结的出价
    this.deposit(stash, L.kind, L.item);
    d.taken[L.id]=1;                 // 本地下架：池子里下一件会顶上来（全网看到的仍是同一批）
    // v0.21.9：必须清掉 state 里的出价记录 —— 否则跨期 _closeBucket 会把已成交的单再入账/再退一次款
    L.yourBid=0; delete d.state[L.id];
    this.note(d, "一口价成交", `₽${priceText(L.buyout)} 拿下 ${auctionItemInfo(L.kind,L.item).name}，已放入仓库。`, "ok");
    RaidStash.save(stash);
    this.refill(d); this.save(d);
    return { ok:true, msg:`已买下 ${auctionItemInfo(L.kind,L.item).name}` };
  },

  /* ----------------------------- 玩家挂单 ----------------------------- */
  // mode: "quick"(0.9×估值) | "market"(1.15×) | "high"(1.45×)
  list(kind, idx, mode){
    const d=this.load();
    const stash=RaidStash.load();
    const key=AUCTION_KIND_MAP[kind];
    const arr=stash[key]||[];
    const item=arr[idx];
    if(!item) return { ok:false, msg:"仓库里没有这件东西" };
    if((d.mine||[]).length>=8) return { ok:false, msg:"最多同时挂 8 单，先撤掉几单" };

    const val=auctionValue(kind,item);
    if(val<=0) return { ok:false, msg:"这件东西没人要" };
    const mult = mode==="quick"?0.78 : (mode==="high"?1.22 : 0.98);
    const price=Math.max(1, auctionRound(val*mult));
    const fee=Math.max(5, auctionRound(price*AUCTION_FEE));
    if(stash.creds<fee) return { ok:false, msg:`上架费需要 ₽${priceText(fee)}` };

    const info=auctionItemInfo(kind,item);
    const now=Date.now();
    const chance=auctionSellChance(price, val);
    const endsAt=now+AUCTION_SELL_MS;
    const sold = RNG.chance(chance);

    stash.creds-=fee;
    arr.splice(idx,1);

    d.mine.push({
      id:auctionUid("M"),
      kind, item, name:info.name, color:info.color,
      seller:"你", buyer:RNG.pick(AUCTION_SELLERS),
      price,
      buyout:Math.max(price+100, auctionRound(price*1.25)),
      fee, endsAt,
      soldAt: sold ? now + Math.round(RNG.fr(0.12,0.85)*(endsAt-now)) : 0,
      chance,
    });
    RaidStash.save(stash); this.save(d);
    return { ok:true, msg:`已上架 ₽${priceText(price)}（上架费 ₽${priceText(fee)}）· 约 ${Math.round(chance*100)}% 成交` };
  },

  cancel(id){
    const d=this.load();
    const stash=RaidStash.load();
    const i=d.mine.findIndex(x=>x.id===id);
    if(i<0) return { ok:false, msg:"没有这条挂单" };
    const L=d.mine[i];
    this.deposit(stash, L.kind, L.item);
    d.mine.splice(i,1);
    RaidStash.save(stash); this.save(d);
    return { ok:true, msg:`已撤单，${L.name} 退回仓库（上架费不退）` };
  },

  /* v0.21.3：货架由期号决定，不能「刷新重掷」—— 那会让每个人看到的货都不一样。
   * 这个按钮降级成「同步本期货架」：重新读一次期号，顺手把跨期的出价收尾。 */
  refresh(){
    const d=this.load();
    this.save(d);
    const left=auctionBucketEnd(auctionBucket())-Date.now();
    return { ok:true, msg:`已同步本期货架，本期还剩 ${auctionCdText(left)}` };
  },

  counts(){
    const d=this.load();
    return { listings:d.listings.length, mine:d.mine.length, mail:d.mail.length };
  },
};

/* =========================================================================
 * 拍卖行界面
 * ========================================================================= */
function auctionCdText(ms){
  if(ms<=0) return "已结束";
  const s=Math.ceil(ms/1000), m=Math.floor(s/60), ss=s%60;
  return `${m}:${String(ss).padStart(2,"0")}`;
}

UI.raidAuction=function(opts){
  opts=opts||{};
  Auction.settle();
  const d=Auction.load();
  const stash=RaidStash.load();
  if(!UI._aucTab) UI._aucTab="bid";
  if(!UI._aucSellTab) UI._aucSellTab="weapon";
  const TAB=UI._aucTab;
  if(!UI._aucFilter) UI._aucFilter="all";
  const FILTER=UI._aucFilter;
  const now=Date.now();

  const tabs=[
    { id:"bid",  name:"竞拍大厅", tag:"AUCTIONS" },
    { id:"sell", name:"出售",     tag:"SELL" },
    { id:"mine", name:"我的",     tag:"MY BIDS" },
  ];

  /* ----------------------------- 竞拍大厅 ----------------------------- */
  const isCore=(L)=> L && L.kind==="part" && L.item && L.item.slot==="core";
  // v0.21.9：合并原先逐字重复的 aucMatch2 / aucMatch（仅差一个过滤值来源）
  const aucMatch=(L,f)=> f==="all" ? true
    : f==="core"  ? isCore(L)
    : f==="gear"  ? (L.kind==="weapon"||L.kind==="armor"||L.kind==="helmet")
    :               (L.kind==="part"||L.kind==="material");
  const shownListings=d.listings.filter(L=>aucMatch(L,FILTER));
  const bidCards = shownListings.length ? shownListings.map(L=>{
    const info=auctionItemInfo(L.kind,L.item);
    const inc=Math.max(5, auctionRound(L.price*0.06));
    const nextBid=L.price+inc;
    const lead=L.yourBid>0;
    const cantBid=stash.creds<nextBid || lead;
    const cantBin=stash.creds<L.buyout;
    return `<div class="auc-card" style="border-left-color:${info.color}">
      <div class="auc-head">
        <div class="si-name" style="color:${info.color}">${info.name}</div>
        <span class="auc-cd" data-cd="${L.endsAt}">${auctionCdText(L.endsAt-now)}</span>
      </div>
      <div class="si-meta">${info.meta}</div>
      <div class="si-stats">${info.stats}</div>
      <div class="auc-line">
        <span>卖家 <b>${L.seller}</b>，${L.bids} 次出价</span>
        <span>当前 <b class="auc-money">₽${priceText(L.price)}</b></span>
      </div>
      ${lead?`<div class="auc-tag ok">你已出价 ₽${priceText(L.yourBid)}，领先中</div>`:""}
      <div class="auc-acts">
        <button class="btn small" data-bid="${L.id}" ${cantBid?'disabled style="opacity:.4"':''}>
          ${lead?"领先中":`出价 ₽${priceTextShort(nextBid)}`}</button>
        <button class="btn small ghost" data-bin="${L.id}" ${cantBin?'disabled style="opacity:.4"':''}>
          一口价 ₽${priceTextShort(L.buyout)}</button>
      </div>
    </div>`;
  }).join('') : `<div class="empty-hint">${d.listings.length? "这个分类暂时没货，换个分类看看":"本期货架的货已被抢空，等下一期（10 分钟一轮）刷新"}</div>`;

  /* ----------------------------- 出售 ----------------------------- */
  const sellTabs=["weapon","armor","helmet","part","material","core"];
  const sellList=(()=>{
    const tab=UI._aucSellTab;
    // 改装模块现已并入配件池：出售时按 kind="part" 走，但只列出 slot:"core" 的配件
    const kind = tab==="core" ? "part" : tab;
    const arr = tab==="core" ? stash.parts.filter(p=>p.core) : (stash[AUCTION_KIND_MAP[tab]]||[]);
    if(!arr.length) return `<div class="empty-hint">仓库里没有${AUCTION_KIND_NAME[tab]}可卖，先去突袭搜刮</div>`;
    // 相同物品合并成一张卡（×N），挂单按钮每次售出其中一件
    const groups={};
    arr.forEach(it=>{
      const key=auctionItemKey(kind,it);
      if(!groups[key]) groups[key]={ key, items:[], info:auctionItemInfo(kind,it) };
      groups[key].items.push(it);
    });
    const list=Object.values(groups).slice(0,40);
    return list.map(g=>{
      const info=g.info;
      const n=g.items.length;
      const pQ=Math.max(1,auctionRound(info.value*0.78));
      const pM=Math.max(1,auctionRound(info.value*0.98));
      const pH=Math.max(1,auctionRound(info.value*1.22));
      return `<div class="auc-card" style="border-left-color:${info.color}">
        <div class="auc-head">
          <div class="si-name" style="color:${info.color}">${info.name}${n>1?` <span class="stk">×${n}</span>`:""}</div>
          <span class="auc-val">估值 ₽${priceTextShort(info.value)}${n>1?`，共 ₽${priceTextShort(info.value*n)}`:""}</span>
        </div>
        <div class="si-meta">${info.meta}</div>
        <div class="si-stats">${info.stats}</div>
        <div class="auc-acts three">
          <button class="btn small ghost" data-list="${kind}:${g.key}:quick">速售 ₽${priceTextShort(pQ)}<em>${Math.round(auctionSellChance(pQ,info.value)*100)}%</em></button>
          <button class="btn small ghost" data-list="${kind}:${g.key}:market">市价 ₽${priceTextShort(pM)}<em>${Math.round(auctionSellChance(pM,info.value)*100)}%</em></button>
          <button class="btn small ghost" data-list="${kind}:${g.key}:high">高价 ₽${priceTextShort(pH)}<em>${Math.round(auctionSellChance(pH,info.value)*100)}%</em></button>
        </div>
      </div>`;
    }).join('');
  })();

  const FILTERS=[{id:"all",name:"全部"},{id:"core",name:"改装模块"},{id:"gear",name:"装备"},{id:"mat",name:"配件 / 材料"}];
  const filterBar=`<div class="auc-filter">
    ${FILTERS.map(f=>{
      const n=f.id==="all" ? d.listings.length : d.listings.filter(L=>aucMatch(L,f.id)).length;
      return `<button class="btn small ${FILTER===f.id?'':'ghost'}" data-aucfilter="${f.id}">${f.name} <span class="auc-fcount">${n}</span></button>`;
    }).join("")}
  </div>`;

  /* ----------------------------- 我的 ----------------------------- */
  const mineCards = d.mine.length ? d.mine.map(L=>{
    const left=L.endsAt-now;
    const net=auctionRound(L.price*(1-AUCTION_COMM));
    return `<div class="auc-card" style="border-left-color:${L.color||"#cfd8e2"}">
      <div class="auc-head">
        <div class="si-name" style="color:${L.color||"#cfd8e2"}">${L.name}</div>
        <span class="auc-cd" data-cd="${L.endsAt}">${auctionCdText(left)}</span>
      </div>
      <div class="auc-line">
        <span>挂单价 <b class="auc-money">₽${priceTextShort(L.price)}</b>，佣金 5%</span>
        <span>到手 <b style="color:#8fe07a">₽${priceTextShort(net)}</b></span>
      </div>
      <div class="auc-tag ${L.soldAt?'ok':'warn'}">
        ${L.soldAt?`已有买家接盘，预计 ${auctionCdText(L.soldAt-now)} 后入账`:"等待买家，到期未售出会退回仓库"}
      </div>
      <div class="auc-acts">
        <button class="btn small ghost" data-cancel="${L.id}">撤单</button>
      </div>
    </div>`;
  }).join('') : `<div class="empty-hint">还没有挂单，去「出售」页把战利品挂上去，比商人回收多赚不少</div>`;

  const mailRows = d.mail.length ? d.mail.slice(0,12).map(m=>{
    const t=new Date(m.ts);
    const hh=String(t.getHours()).padStart(2,"0"), mm=String(t.getMinutes()).padStart(2,"0");
    return `<div class="auc-mail ${m.cls||""}">
      <div class="auc-mail-top"><b>${m.title}</b><span>${hh}:${mm}</span></div>
      <div class="auc-mail-body">${m.text}</div>
    </div>`;
  }).join('') : `<div class="empty-hint">暂无成交记录</div>`;

  let body="";
  if(TAB==="bid"){
    body=`${filterBar}<div class="auc-grid">${bidCards}</div>`;
  } else if(TAB==="sell"){
    body=`
      <div class="shop-tabs">
        ${sellTabs.map(k=>{
          const n = k==="core" ? stash.parts.filter(p=>p.core).length : (stash[AUCTION_KIND_MAP[k]]||[]).length;
          return `<button class="shop-tab ${UI._aucSellTab===k?'on':''}" data-aucsell="${k}">
            <b>${AUCTION_KIND_NAME[k]}</b><span class="tab-tag">${n}</span></button>`;
        }).join('')}
      </div>
      <div class="auc-grid">${sellList}</div>`;
  } else {
    body=`
      <h4 class="auc-sec">我的挂单 <span class="meta-cap">${d.mine.length}/8</span></h4>
      <div class="auc-grid">${mineCards}</div>
      <h4 class="auc-sec">成交记录</h4>
      <div class="auc-mail-list">${mailRows}</div>`;
  }

  UI._set(`
    <div class="panel raid-setup">
      <h2 class="title-big" style="font-size:32px;">拍卖行</h2>
      <div class="subtitle">AUCTION HOUSE · <b style="color:#ffd36a">全网同一份货</b> · 每 10 分钟一期 · 卢布结算 · 5% 成交佣金</div>
      <div class="shop-bar">
        <div class="shop-desc"><b style="color:#ffd36a">这一期货架对所有人一样</b>：挂在货上的枪 / 甲 / 配件 / 材料由<b>期号</b>算出，同一期里谁打开都是同一批货、同一个一口价、同一结束时间（<b>本期还剩 <span id="auc-period-left" style="color:#8fe07a">${auctionCdText(auctionBucketEnd(auctionBucket(now))-now)}</span></b>）。<br>
        <b style="color:#ffd23f">竞拍</b>可以低于估值捡漏（但可能被抬价），<b style="color:#ffd23f">一口价</b>直接拿下；自己的战利品挂上去，成交价比商人回收（六折）高得多——挂单<b style="color:#8fe07a"> 4 分钟</b>，到期未售出自动退回仓库，上架费不退。<br>
        <b style="color:#ff9a3a">弹种适配组件 / 膛压组件</b>在这里是除突袭箱子外<b>唯一</b>的获取渠道，每期第 1 件保底就是改装模块；也用「改装模块」分类快速筛出来。</div>
        <div class="shop-gold">仓库卢布 ₽ ${priceTextShort(stash.creds)}</div>
        <button class="btn ghost" id="btn-auc-refresh">同步货架</button>
        <button class="btn ghost" id="btn-auc-back">前往配装大厅</button>
      </div>
      <div class="shop-tabs">
        ${tabs.map(t=>`<button class="shop-tab ${TAB===t.id?'on':''}" data-auctab="${t.id}">
          <b>${t.name}</b><span class="tab-tag">${t.tag}</span></button>`).join('')}
      </div>
      ${body}
      <div class="hint" style="margin-top:12px;">提示：成交与退款是<b>实时结算</b>的——再次打开本页面时，到期的单子会自动入账或退回。出价的钱会先冻结，被抬价后立即退回；跨期时若还有出价冻结，会按「被超越则退回 / 否则视为拍下」自动收尾。</div>
    </div>`);

  const rerender=()=>UI._keepScroll(()=>UI.raidAuction(opts));

  UI.overlay.querySelectorAll('[data-auctab]').forEach(el=>{
    el.onclick=()=>{ UI._aucTab=el.dataset.auctab; SFX.ui(); UI.raidAuction(opts); };
  });
  UI.overlay.querySelectorAll('[data-aucfilter]').forEach(el=>{
    el.onclick=()=>{ UI._aucFilter=el.dataset.aucfilter; SFX.ui(); UI.raidAuction(opts); };
  });
  UI.overlay.querySelectorAll('[data-aucsell]').forEach(el=>{
    el.onclick=()=>{ UI._aucSellTab=el.dataset.aucsell; SFX.ui(); UI.raidAuction(opts); };
  });
  UI.overlay.querySelectorAll('[data-bid]').forEach(el=>{
    el.onclick=()=>{
      const r=Auction.bid(el.dataset.bid);
      game.toast(r.msg); if(r.ok) SFX.ui(); else SFX.hurt();
      rerender();
    };
  });
  UI.overlay.querySelectorAll('[data-bin]').forEach(el=>{
    el.onclick=()=>{
      const r=Auction.buyout(el.dataset.bin);
      game.toast(r.msg); if(r.ok) SFX.pickup(); else SFX.hurt();
      rerender();
    };
  });
  UI.overlay.querySelectorAll('[data-list]').forEach(el=>{
    el.onclick=()=>{
      const p=el.dataset.list.split(':');
      const kind=p[0], sig=p[1], mode=p[2];
      let idx=parseInt(sig,10);
      // 签名模式：按签名在仓库数组里找一件匹配的物品（合并卡片每次售出其中一件）
      if(String(idx)!==sig){
        const arr=RaidStash.load()[AUCTION_KIND_MAP[kind]]||[];
        idx=arr.findIndex(it=>auctionItemKey(kind,it)===sig);
      }
      const r=Auction.list(kind, idx, mode);
      game.toast(r.msg); if(r.ok) SFX.pickup(); else SFX.hurt();
      rerender();
    };
  });
  UI.overlay.querySelectorAll('[data-cancel]').forEach(el=>{
    el.onclick=()=>{
      const r=Auction.cancel(el.dataset.cancel);
      game.toast(r.msg); if(r.ok) SFX.ui(); else SFX.hurt();
      rerender();
    };
  });
  document.getElementById('btn-auc-refresh').onclick=()=>{
    const r=Auction.refresh();
    game.toast(r.msg); if(r.ok) SFX.ui(); else SFX.hurt();
    rerender();
  };
  document.getElementById('btn-auc-back').onclick=()=>{ SFX.ui(); UI.raidSetup(); };

  /* 倒计时：只改文字，避免整页重绘打断滚动 */
  if(UI._aucTimer){ clearInterval(UI._aucTimer); UI._aucTimer=null; }
  UI._aucTimer=setInterval(()=>{
    if(!UI.overlay || UI.overlay.classList.contains('hidden') ||
       UI.overlay.querySelectorAll('[data-auctab]').length===0){
      clearInterval(UI._aucTimer); UI._aucTimer=null; return;
    }
    const t=Date.now();
    // 本期货架剩余时间（整期统一结束，所以单独一行显示）
    const pel=document.getElementById('auc-period-left');
    if(pel) pel.textContent=auctionCdText(auctionBucketEnd(auctionBucket(t))-t);
    let overdue=false;
    UI.overlay.querySelectorAll('[data-cd]').forEach(el=>{
      const left=(+el.dataset.cd)-t;
      el.textContent=auctionCdText(left);
      el.classList.toggle('soon', left<60000);
      if(left<=0) overdue=true;
    });
    if(overdue){
      const n=Auction.settle();
      clearInterval(UI._aucTimer); UI._aucTimer=null;
      if(n) game.toast(`拍卖行结算 ${n} 条新消息`);
      UI._keepScroll(()=>UI.raidAuction(opts));
    }
  },1000);
};
