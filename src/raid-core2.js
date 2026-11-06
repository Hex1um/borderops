/* =========================================================================
 * raid-core2.js — 主控 Raid（方法续接 · 第 2 段）
 * v0.22.0：由 raid.js 按自然边界物理拆分，逻辑零改写。经典脚本按 index.html 顺序加载，
 * 共享同一全局词法作用域。verify 的 raidSrc 会聚合全部 raid-*.js 做源码断言。
 * ========================================================================= */
Object.assign(Raid, {
  // 沿主干道找净空：不压墙 / 不入水 / 不挨建筑 / 不撞树，找不到就绕圈扩大搜索
  _shopSpot(x,y){
    // 直接扫 this.walls，不用 _nearWalls 索引（索引在 _buildNavGrid 后才可靠）
    const hitWall=(px,py,r)=>{
      for(const w of this.walls){
        const nx=Math.max(w.x,Math.min(px,w.x+w.w)), ny=Math.max(w.y,Math.min(py,w.y+w.h));
        if((px-nx)*(px-nx)+(py-ny)*(py-ny) < r*r) return true;
      }
      return false;
    };
    const ok=(px,py)=>{
      if(px<220||py<220||px>RAID_MAP_W-220||py>RAID_MAP_H-220) return false;
      if(this._blockedSpawn(px,py)) return false;
      if(hitWall(px,py,72)) return false;
      if(this._distToRoom && this._distToRoom(px,py)<170) return false;
      for(const pr of this.props){ if(pr.kind==="tree" && M.dist(px,py,pr.x+pr.w/2,pr.y+pr.h/2)<130) return false; }
      for(const sh of this.sheds){ if(px>sh.x-90&&px<sh.x+sh.w+90&&py>sh.y-90&&py<sh.y+sh.h+90) return false; }
      for(const s of this.shops){ if(M.dist(px,py,s.x,s.y)<460) return false; }   // 摊位之间别挤在一起（9 家店仍要留出跑图空间）
      return true;
    };
    if(ok(x,y)) return {x,y};
    for(let i=0;i<120;i++){
      const a=i/120*6.2832, rr=130+i*11;
      const px=x+Math.cos(a)*rr, py=y+Math.sin(a)*rr;
      if(ok(px,py)) return {x:px,y:py};
    }
    // 兜底：全图粗网格扫描，取离目标最近的有效点（保证摊位一定可达、不卡墙里）
    let best=null, bd=1e9;
    for(let gx=420; gx<RAID_MAP_W-420; gx+=300){
      for(let gy=420; gy<RAID_MAP_H-420; gy+=300){
        if(!ok(gx,gy)) continue;
        const d=M.dist(gx,gy,x,y);
        if(d<bd){ bd=d; best={x:gx,y:gy}; }
      }
    }
    return best||{x,y};
  },
  _shopGun(rarTier, type){
    const cfgId=RAID_TIER_TO_RARITY[rarTier]||"white";
    const hi=rarTier>=4?(rarTier-3)*3:0;
    const ilvl=rarTier*3 + hi + 12 + RNG.ri(0,4);
    const w=blGunGen(ilvl,{ type:type||RNG.pick(RAID_GUN_TYPES), rarity:cfgId });
    ensureGunAffixes(w);
    w.uid=this._uid(); w.kind="weapon";
    w.qTier=rarTier; w.qName=RAID_TIERS[rarTier].name; w.qColor=RAID_TIERS[rarTier].color;
    return w;
  },
  _shopStock(kind){
    const out={ guns:[], parts:[], mats:[], meds:[], keys:[], ammo:[] };
    /* 一条子弹（30 发）：价格按「单发估值 × 30」走局内 0.8× 折扣 */
    const pack=(cal, lv, payKind)=>{
      const d=ammoDef(cal, lv);
      const it={ id:d.id, cal:d.cal, lv:d.lv, n:RAID_AMMO_STACK, name:d.name, short:d.short,
        spec:d.spec, color:d.color, value:d.value*RAID_AMMO_STACK, elem:d.elem };
      if(payKind==="token") it.tokenPrice=Math.max(3, Math.round(d.value*RAID_AMMO_STACK/380));
      else it.shopPrice=raidShopPrice(it.value, d.id);
      return it;
    };
    if(kind==="gun"){
      const tiers=[1,2,3,4];
      if(RNG.chance(0.35)) tiers.push(5);
      for(const t of tiers){
        const g=this._shopGun(t);
        g.shopPrice=raidShopPrice(g.value||1000, g.uid);
        out.guns.push(g);
      }
      // 改装模块不可合成 —— 枪械店常备一枚低阶改装模块（卢布可买）
      {
        const c=raidMakeBoostCore(RNG.pick(BOOST_CORE_IDS), 2+RNG.ri(0,1));
        c.shopPrice=raidShopPrice(raidCoreValue("boost", c.lv), c.uid);
        out.parts.push(c);
      }
      /* v0.20.0：枪械店兼卖弹药 —— 按本店在售枪型的口径，T2 / T3 各一条 */
      {
        const cals=[];
        for(const g of out.guns){
          const cal=g.cal||ammoCalOfType(g.type);
          if(cals.indexOf(cal)<0) cals.push(cal);
        }
        if(!cals.length) cals.push("mid");
        for(const cal of cals){ out.ammo.push(pack(cal, 2, "cash"), pack(cal, 3, "cash")); }
      }
    } else if(kind==="mat"){
      for(let i=0;i<6;i++){
        const m=raidMakeMaterial(0.35);
        // 按材料 id 定价：同一种材料在同一个摊位上价格一致，不会出现「三块破布三个价」
        m.shopPrice=raidShopPrice(m.value||40, m.id||m.uid);
        out.mats.push(m);
      }
      for(let i=0;i<3;i++){
        const pt=this._rollPartGear("pmc", 0.35);
        pt.shopPrice=raidShopPrice(partValue(pt), pt.uid);
        out.parts.push(pt);
      }
      /* v0.19.0：局内医疗品也按 0.8× 估价定价，并且五种全上架（旧版只有绷带/急救包/手术包/强心针） */
      out.meds=["bandage","hemo","medkit","stim","surgery"].map(id=>({
        id, n:1, price:raidShopPrice((RAID_MED_BY_ID[id]||{}).value||100, id),
      }));
      /* v0.20.0：材料店是弹药的主要补给点 —— 全口径 T1 民用、T2 制式 */
      for(const cal of AMMO_CAL_LIST){ out.ammo.push(pack(cal, 1, "cash"), pack(cal, 2, "cash")); }
      // 钥匙：材料商店只卖低阶 I~II，卢布结算
      out.keys=[raidMakeKey(1), raidMakeKey(2)];
      for(const k of out.keys) k.shopPrice=raidShopPrice(raidKeyDef(k.lv).value, "key"+k.lv);
    } else if(kind==="black"){
      const tokenPrice={ 6:26, 7:48, 8:86 };
      for(const t of [6,7,8]){
        const g=this._shopGun(t);
        g.tokenPrice=tokenPrice[t]||60;
        out.guns.push(g);
      }
      /* v0.20.0：黑市卖高级弹（T4 / T5），GP 币结算 —— 高级弹只能从这里或 V 级箱稳定拿到 */
      for(const cal of ["light","mid","heavy"]){ out.ammo.push(pack(cal, 4, "token"), pack(cal, 5, "token")); }
      if(!out.ammo.length) out.ammo.push(pack("mid", 4, "token"));
      // 改装模块不可合成，黑市是唯一能稳定买到高阶改装模块的地方
      {
        const c1=raidMakeBoostCore(RNG.pick(BOOST_CORE_IDS), 4+RNG.ri(0,1));
        c1.tokenPrice=c1.lv>=5?18:10;
        out.parts.push(c1);
        const c2=RNG.chance(0.5)
          ? raidMakeElemCore(RNG.pick(RAID_ELEM_CORE_ELEMS), 3+RNG.ri(0,1))
          : raidMakeChaosCore(3+RNG.ri(0,1));
        c2.tokenPrice = c2.core==="chaos" ? (c2.lv>=4?24:12) : (c2.lv>=4?14:8);
        out.parts.push(c2);
      }
      // 钥匙：黑市卖高阶 III~V，只收 GP 币
      out.keys=[raidMakeKey(3), raidMakeKey(4), raidMakeKey(5)];
      for(const k of out.keys) k.tokenPrice=raidKeyDef(k.lv).token;
    }
    return out;
  },

  _buildNavGrid(){
    const CS=256;
    const cols=Math.ceil(RAID_MAP_W/CS), rows=Math.ceil(RAID_MAP_H/CS);
    this.navCS=CS; this.navCols=cols; this.navRows=rows;
    this.navCell=new Array(cols*rows); this.losCell=new Array(cols*rows);
    const put=(arr,w)=>{
      const x0=Math.max(0,Math.floor(w.x/CS)), x1=Math.min(cols-1,Math.floor((w.x+w.w)/CS));
      const y0=Math.max(0,Math.floor(w.y/CS)), y1=Math.min(rows-1,Math.floor((w.y+w.h)/CS));
      for(let gy=y0;gy<=y1;gy++) for(let gx=x0;gx<=x1;gx++){
        const i=gy*cols+gx;
        (arr[i]||(arr[i]=[])).push(w);
      }
    };
    for(const w of this.walls){
      put(this.navCell,w);
      if(w.sight!==false) put(this.losCell,w);
    }
  },

  _nearWalls(x,y,r){
    const CS=this.navCS, cols=this.navCols, rows=this.navRows;
    if(!CS) return this.walls;
    const x0=Math.max(0,Math.floor((x-r)/CS)), x1=Math.min(cols-1,Math.floor((x+r)/CS));
    const y0=Math.max(0,Math.floor((y-r)/CS)), y1=Math.min(rows-1,Math.floor((y+r)/CS));
    const q=++this._navQ; const out=[];
    for(let gy=y0;gy<=y1;gy++) for(let gx=x0;gx<=x1;gx++){
      const a=this.navCell[gy*cols+gx]; if(!a) continue;
      for(let i=0;i<a.length;i++){
        const w=a[i]; if(w._q===q) continue;
        w._q=q; out.push(w);
      }
    }
    return out;
  },

  _spawnContainers(){
    // 箱子类型：weapon 武器箱 / medical 医疗箱 / armor 护甲箱 / random 杂项箱
    const randKind=()=>{ const a=[
      {weight:30, v:"weapon"}, {weight:24, v:"armor"},
      {weight:18, v:"medical"}, {weight:28, v:"random"} ]; return a[RNG.weighted(a)].v; };
    // 房间内箱子：密度随地图扩大（每间 2 起、每 9 万像素 +1）
    for(const rm of RAID_ROOMS){
      if(rm.extract) continue;
      const area=rm.w*rm.h;
      const n=2+Math.floor(area/90000);
      for(let i=0;i<n;i++){
        const p=this._openPointInRoom(rm, 66);
        this.containers.push({ x:p.x, y:p.y, tier:RNG.weighted([{weight:52},{weight:34},{weight:14}]),
          kind:randKind(), searched:false, drop:null });
      }
    }
    // 房间外的散落补给（地图空旷处，绕开房间矩形与户外掩体）
    let guard=0, added=0;
    while(added<88 && guard<2400){
      guard++;
      const x=RNG.fr(80, RAID_MAP_W-80), y=RNG.fr(80, RAID_MAP_H-80);
      if(this._blockedSpawn(x,y)) continue;   // 河面上不生箱子
      let inside=false;
      for(const rm of RAID_ROOMS){
        if(x>rm.x-44 && x<rm.x+rm.w+44 && y>rm.y-44 && y<rm.y+rm.h+44){ inside=true; break; }
      }
      if(inside) continue;
      for(const p of this.props){
        if(x>p.x-26 && x<p.x+p.w+26 && y>p.y-26 && y<p.y+p.h+26){ inside=true; break; }
      }
      if(inside) continue;
      this.containers.push({ x, y, tier:RNG.weighted([{weight:44},{weight:34},{weight:22}]),
        kind:"random", searched:false, drop:null, field:true });
      added++;
    }
    // 野外工棚内的补给（每个棚 1 个，玩家有理由往偏僻处跑）
    for(const sh of this.sheds){
      const p=this._openPointInRoom(sh, 46);
      this.containers.push({ x:p.x, y:p.y, tier:RNG.weighted([{weight:38},{weight:36},{weight:26}]),
        kind:randKind(), searched:false, drop:null });
    }
    // 上锁保险箱：分 5 档保险等级（lockLv），必须用对应等级钥匙打开
    //   V 级（军火箱）改为「全图随机、每局 20% 概率一口」，不再固定藏在大坝库底。
    //   其余 13 口：I 约六成、II 两成半、III 零星，IV 只保底一口（最大房间的军械库）。
    const rooms=RAID_ROOMS.filter(r=>!r.extract);
    const bigRooms=rooms.slice().sort((a,b)=>b.w*b.h-a.w*a.h);
    const LOCK_W=[{weight:64,lv:1},{weight:26,lv:2},{weight:8,lv:3},{weight:2,lv:4}];
    const VAULT_LV=[4];
    // 落箱位置：避开普通补给箱 / 设施，否则按 E 会先摸到旁边的木箱
    const spotIn=(rm, pad)=>{
      let p=this._openPointInRoom(rm, pad);
      for(let t=0;t<10;t++){
        const clash=this.containers.some(c=>M.dist(c.x,c.y,p.x,p.y)<92)
          || (this.gadgets||[]).some(g=>M.dist(g.x,g.y,p.x,p.y)<110);
        if(!clash) break;
        p=this._openPointInRoom(rm, pad);
      }
      return p;
    };
    for(let i=0;i<13;i++){
      const vault=i<VAULT_LV.length;
      const rm=vault?bigRooms[i%bigRooms.length]:RNG.pick(rooms);
      const p=spotIn(rm, vault?100:82);
      const lv=vault?VAULT_LV[i]:LOCK_W[RNG.weighted(LOCK_W)].lv;
      this.containers.push({ x:p.x, y:p.y, tier:2, locked:true, lockLv:lv,
        kind:"weapon", searched:false, drop:null });
    }
    // V 级军火箱：期望 0.2 口/局，随机落在中大型房间（含大坝控制室、监狱等），
    //   箱内是打穿整局的目标 —— 保底 T5 装备、4 件战利品、更高整枪/改装模块权重。
    if(RNG.chance(0.20)){
      const cand=rooms.filter(r=>r.w*r.h>=260*200);
      const rm=cand.length?RNG.pick(cand):RNG.pick(rooms);
      const p=spotIn(rm, 104);
      this.containers.push({ x:p.x, y:p.y, tier:2, locked:true, lockLv:5,
        kind:"weapon", searched:false, drop:null });
    }
    // 水库底的高级保险箱 —— 先开泄洪闸放水，才能走进去拿
    this.containers.push({ x:3250, y:9200, tier:2, locked:true, lockLv:4, kind:"weapon",
      searched:false, drop:null, damLoot:true });
    this.containers.push({ x:3720, y:9250, tier:2, locked:true, lockLv:3, kind:"weapon",
      searched:false, drop:null, damLoot:true });
  },

  _uid(){ return "g"+(this.uidN++)+"-"+Math.floor(Math.random()*9999); },

  _rollRarity(luck){
    // 9 阶品质：走硬预算——精选及以上总量锁在 5% 左右，特种及以上约 1%
    return raidBudgetTier(luck);
  },

  // 通用战利品骰点：箱子以「原材料 + 配件」为主，整枪 / 护甲大幅降低
  // 无论带什么装备，任意品质都可能出现——携带估值只改变权重，不封顶。
  _rollGear(cls, luck){
    luck=luck||0;
    // 命名具名装备：独立骰点（裸装约 0.08%，满配约 0.3%）—— 特种总量仍受 1% 预算约束
    if(RNG.chance(0.0005 + luck*0.0014))                                // 命名特种更稀有
      return RNG.chance(0.35) ? raidRollShieldUnique(luck) : raidRollUnique(luck);
    const r=RNG.f();
    if(r < 0.78) return this._rollMaterial(cls==="scav"?0:luck);   // 78% 原材料
    if(r < 0.905) return this._rollPartGear(cls, luck);            // 12.5% 配件
    if(r < 0.917) return this._rollGunLoot(cls, luck);             // 1.2% 整枪
    if(r < 0.932){                                                 // 1.5% 护甲
      let tier=raidRollArmorTier(cls==="scav"?0:luck);
      if(cls==="scav") tier=Math.min(tier,SCAV_ARMOR_TIER_MAX);
      return raidMakeArmor(tier);
    }
    if(r < 0.942){                                                 // 1.0% 头盔
      let tier=raidRollArmorTier(cls==="scav"?0:(luck*0.85));
      if(cls==="scav") tier=Math.min(tier,SCAV_HELMET_TIER_MAX);
      return raidMakeHelmet(tier);
    }
    if(r < 0.952){                                                 // 1.0% 护盾
      let tier=raidRollArmorTier(cls==="scav"?0:luck);
      if(cls==="scav") tier=Math.min(tier,SCAV_ARMOR_TIER_MAX);
      return raidMakeShield(tier, this._rollRarity(cls==="scav"?0:luck));
    }
    return raidRollCore(luck);                                     // 5.8% 改装模块（唯一稳定来源）
  },

  // 散装配件：品质随运气浮动（越高档词缀越好）；floorTier 为品质保底（V 级军火箱用）
  _rollPartGear(cls, luck, floorTier){
    const slot=RNG.pick(GUN_SLOTS).id;
    const lt=raidBudgetTier(cls==="scav"?0:luck);
    let idx=M.clamp(lt, 0, RARITIES.length-1);
    if(floorTier) idx=Math.max(idx, Math.min(floorTier, RARITIES.length-1));
    const pt=rollPart(slot, cls==="scav"?8:14, RARITIES[idx].id);
    pt.kind="part";
    return pt;
  },

  // 枪械战利品：按塔科夫品质档位生成，高品阶枪更强，并打上 qTier/qName/qColor 供显示
  // floorTier：品质保底（上锁保险箱按 lockLv 抬高下限，等级越高必出越好的枪）
  _rollGunLoot(cls, luck, floorTier){
    luck=luck||0;
    // Scav 的枪永远封顶在低阶池：不掉具名枪、不出高品级、不用步枪/狙击枪。
    if(cls==="scav"){
      const rarity=Math.min(2, this._rollRarity(0));
      const cfgId=RAID_TIER_TO_RARITY[rarity]||"white";
      let w=raidScavGun(3 + rarity*2 + RNG.ri(0,2), {
        type:RNG.pick(SCAV_GUN_TYPES), rarity:cfgId,
      });
      ensureGunAffixes(w);
      w.uid=this._uid(); w.kind="weapon";
      w.qTier=rarity; w.qName=RAID_TIERS[rarity].name; w.qColor=RAID_TIERS[rarity].color;
      return w;
    }
    let rarity=this._rollRarity(luck);
    if(floorTier) rarity=Math.max(rarity, floorTier);
    const id=RNG.pick(RAID_GUN_TYPES);
    const hi = rarity>=4 ? (rarity-3)*3 : 0;        // 高品阶枪额外抬升等级 → 更强
    const ilvl=rarity*3 + hi + 9 + RNG.ri(0,3);
    const cfgId=RAID_TIER_TO_RARITY[rarity]||"white";
    let w=blGunGen(ilvl,{type:id, rarity:cfgId});
    ensureGunAffixes(w);   // 任何品质都要有前后缀
    w.uid=this._uid(); w.kind="weapon";
    w.qTier=rarity; w.qName=RAID_TIERS[rarity].name; w.qColor=RAID_TIERS[rarity].color;
    // 特种及以上有几率直接出「有名字」的传奇枪
    if(rarity>=5 && RNG.chance(0.10 + luck*0.08)){
      const uq=raidRollUnique(luck, u=>u.kind==="weapon");
      if(uq){ uq.uid=this._uid(); return uq; }
    }
    return w;
  },

  _rollMaterial(luck){ return raidMakeMaterial(luck); },

  /* ------------------------- 钥匙 / 上锁保险箱 ------------------------- */
  _keysInInv(){ return (this.inv && this.inv.keys) || []; },
  // 能不能开 lockLv 级箱子：优先用「刚好够级、剩余次数最少」的钥匙，把高级钥匙留给更硬的箱子
  _bestKeyFor(lv){
    const need=M.clamp(Math.round(lv||1),1,5);
    let best=null;
    for(const k of this._keysInInv()){
      if((k.lv||1) < need) continue;
      if(!best || k.lv<best.lv || (k.lv===best.lv && (k.uses||0)<(best.uses||0))) best=k;
    }
    return best;
  },
  _hasKeyFor(lv){ return !!this._bestKeyFor(lv); },
  // 消耗一次钥匙耐久；用尽即从物品栏移除（钥匙报废）
  _useKey(lv){
    const k=this._bestKeyFor(lv);
    if(!k) return null;
    k.uses=(k.uses||1)-1;
    if(k.uses<=0){
      const i=this.inv.keys.indexOf(k);
      if(i>=0) this.inv.keys.splice(i,1);
      if(this.player) this._float(this.player.x, this.player.y-56, k.name+" 用尽 · 报废", "#ff8a5a");
    }
    return k;
  },
  // 保险箱战利品：等级越高 → 运气加成 + 品质保底 + 件数更多
  _rollVaultLoot(lv){
    const L=M.clamp(Math.round(lv||1),1,5);
    const luck=this.lootLuck + L*0.10;
    // 装备品质保底（T0~T5）：V 级军火箱直接 T5 起步，基本只出特种档以上
    const floorT=[0,0,1,2,3,5][L];
    const r=RNG.f();
    // V 级：整枪 / 改装模块权重显著上调，材料让路（开一次就够本）
    if(L>=5){
      if(r<0.46) return this._rollGunLoot("pmc", luck+0.10, floorT);
      if(r<0.60) return raidMakeArmor(M.clamp(raidRollArmorTier(luck+0.08), 1+floorT, 9));
      if(r<0.72) return raidMakeHelmet(M.clamp(raidRollArmorTier(luck+0.06), 1+floorT, 9));
      if(r<0.92) return raidRollCore(luck+0.20);
      return this._rollPartGear("pmc", luck+0.06, floorT);
    }
    if(r<0.34) return this._rollGunLoot("pmc", luck, floorT);
    if(r<0.48) return raidMakeArmor(M.clamp(raidRollArmorTier(luck), 1+floorT, 9));
    if(r<0.60) return raidMakeHelmet(M.clamp(raidRollArmorTier(luck*0.9), 1+floorT, 9));
    if(r<0.76) return raidRollCore(luck);
    if(r<0.90) return this._rollPartGear("pmc", luck);
    return this._rollMaterial(luck);
  },

  /* ----------------------------- 更新 ----------------------------- */
  update(game, dt){
    if(!this.active) return;
    const act=Input.consume();
    if(act.pause){ this.shopOpen=null; game.pause(); return; }
    if(act.inv){
      this.showInv=!this.showInv; SFX.ui();
      document.body.classList.toggle('inv-open', this.showInv);   // 只收起其它触屏键，保留背包键可点
      this._invToggleDom();
    }
    // 面板开着时，拾取/丢弃后自动刷新（节流，避免每帧重建 DOM）
    if(this.showInv && this._invDirty){
      this._invT=(this._invT||0)-dt;
      if(this._invT<=0){ this._invDirty=false; this._invT=0.30; this._invRender(); }
    }

    const p=this.player;
    if(this.hitFlash>0) this.hitFlash-=dt;
    if(this.stimT>0) this.stimT=Math.max(0,this.stimT-dt);

    // 护甲耐久不自动回复（打穿即报废）；护盾按充能延迟 / 充能速度自主回充
    for(const o of this.ops){ this._tickArmorRegen(o, dt); this._tickShield(o, dt); }

    // 冷却与换弹（v0.14.10：冰冻状态在这里统一递减，玩家与 AI 一致）
    for(const o of this.ops){
      if(!o.alive) continue;
      if(o.freezeT>0) o.freezeT=Math.max(0, o.freezeT-dt);
      // v0.14.11：元素持续状态统一结算；玩家被引燃致死时 _fail 已收尾，直接退出本帧
      if(this._tickElementStatus(o,dt)) return;
      o.fireCd=Math.max(0,o.fireCd-dt);
      o.muzzleT=Math.max(0,(o.muzzleT||0)-dt);
      o.kick=Math.max(0,(o.kick||0)-dt*11);
      if(o.reloadT>0){
        o.reloadT-=dt;
        if(o.reloadT<=0) this._finishReload(o);
      }
    }

    // 绷带使用（塔科夫式：边走边撕会被打断）
    const p0=this.player;
    if(this.medT>0){
      if(Math.hypot(p0.moveX,p0.moveY)>0.2){
        this.medT=0; this.medUse=null;
        this._float(p0.x,p0.y-30,"移动打断治疗","#ff8a5a");
      } else {
        this.medT-=dt;
        if(this.medT<=0) this._finishMed();
      }
    }

    // 流血：每层每秒 -1 HP
    if(p0.alive && p0.bleed>0){
      p0.hp-=1.0*p0.bleed*dt;
      if(p0.hp<=0){ p0.hp=0; p0.alive=false; this._fail("失血过多"); return; }
    }

    if(!this.spectate){
      this._playerControl(dt, game, act);
      if(!this.active) return;
    }
    if(this.online && typeof Net!=="undefined") Net.tick(dt);
    this._botsUpdate(dt, game);
    if(!this.active) return;
    if(!this.spectate){
      this._searchUpdate(dt);
      this._extractUpdate(dt, game);
      if(!this.active) return;
    }

    // 计时
    this.timer-=dt;
    if(this.timer<=60 && !this._shownWarn){ this._shownWarn=true; this._feed("系统","撤离窗口将在 60 秒后关闭","警告",false,"warn"); }
    if(this.timer<=0){ this.timer=0; this._fail("超时未撤离"); return; }

    // 世界模拟只由房主（或单机）负责；客户端只接收快照
    const hostSim = !this.online || (typeof Net!=="undefined" && Net.isHost);
    if(hostSim){
      // 服务器背景交火（模拟其他玩家互相击杀 / 撤离）
      this.serverT-=dt;
      if(this.serverT<=0){ this.serverT=RNG.fr(26,42); this._backgroundFight(); }

      // 增援：开局 3 分钟后，全图缓慢刷出带装备的 AI（含小队 / 撤离点封锁者）
      this.elapsed+=dt;
      if(this.elapsed>=180){
        this.reinforceT-=dt;
        const aliveCount=this.ops.filter(o=>!o.isPlayer&&!o.remote&&!o.ghost&&o.alive).length;
        if(this.reinforceT<=0 && aliveCount<this.maxOps){
          this._spawnReinforcement();
          this.reinforceT=RNG.fr(20,32);   // 缓慢刷新间隔
        }
      }
    }

    this._updateCamera(game);

    // 粒子/飘字
    for(let i=this.tracers.length-1;i>=0;i--){
      const tr=this.tracers[i]; tr.life-=dt;
      if(tr.life<=0){ this.tracers.splice(i,1); continue; }
      // 普通子弹：色块沿弹道飞行（激光弹道直接画整条光束，无需位移）
      if(!tr.laser){ const f=1-M.clamp(tr.life/(tr.maxLife||0.08),0,1); tr.bx=tr.x1+(tr.x2-tr.x1)*f; tr.by=tr.y1+(tr.y2-tr.y1)*f; }
    }
    // 火箭弹：慢速飞行 + 命中/撞墙/超时爆炸
    for(let i=this.rockets.length-1;i>=0;i--){ if(this._updateRocket(this.rockets[i],dt)) this.rockets.splice(i,1); }
    for(let i=this.blasts.length-1;i>=0;i--){ const b=this.blasts[i]; b.life-=dt; if(b.life<=0) this.blasts.splice(i,1); }
    for(let i=this.floats.length-1;i>=0;i--){ const f=this.floats[i]; f.y+=f.vy*dt; f.life-=dt; if(f.life<=0) this.floats.splice(i,1); }
    // v0.21.4：3D 拾取提示条老化（只在 3D 推送，2D 仍看世界坐标的 floats）
    for(let i=this.toasts.length-1;i>=0;i--){ const t=this.toasts[i]; t.life-=dt; if(t.life<=0) this.toasts.splice(i,1); }
    for(let i=this.particles.length-1;i>=0;i--){ const q=this.particles[i]; q.x+=q.vx*dt; q.y+=q.vy*dt; q.vx*=0.9; q.vy*=0.9; q.life-=dt; if(q.life<=0) this.particles.splice(i,1); }
    // 击杀提示老化
    for(let i=this.killfeed.length-1;i>=0;i--){ this.killfeed[i].t-=dt; if(this.killfeed[i].t<=0) this.killfeed.splice(i,1); }
  },

  /* ----------------------------- 医疗系统 ----------------------------- */
  /* v0.19.0：医疗品统一走「仓库带入的计数 + 局内捡到的背包物品」两条来源。
   * 旧版只认 this.meds，导致局内翻箱捡到的止血针 / 强心针 / 手术包进得了背包却永远用不了，
   * 只剩绷带（独立计数）和急救包（多半是带入的）能用。现在两者合并计数、合并扣除。 */
  _medCount(id){
    if(id==="bandage") return Math.max(0, this.bandages|0);
    let n=Math.max(0, (this.meds && this.meds[id])|0);
    for(const m of (this.inv.meds||[])) if(m.id===id) n += Math.max(0, m.n|0);
    return n;
  },
  _medTake(id){
    if(id==="bandage"){ if(this.bandages>0){ this.bandages--; return true; } return false; }
    if((this.meds[id]|0) > 0){ this.meds[id]--; return true; }
    for(let i=0;i<this.inv.meds.length;i++){
      const m=this.inv.meds[i];
      if(m.id!==id || !(m.n>0)) continue;
      m.n--;
      if(m.n<=0) this.inv.meds.splice(i,1);
      this._invDirty=false;
      return true;
    }
    return false;
  },
  _medStart(id){
    const p=this.player, m=RAID_MED_BY_ID[id];
    if(!p || !m) return false;
    if(this.medT>0) return false;                 // 正在治疗，不打断
    if(!this._medTake(id)) return false;
    this.medUse={ id, name:m.name, heal:m.heal, bleed:m.bleed, cast:m.cast, boost:!!m.boost, color:RAID_RARITY_COLOR[m.tier] };
    this.medT=m.cast;
    this._pick(p.x,p.y-34,"使用 "+m.name, RAID_RARITY_COLOR[m.tier]);
    return true;
  },
  // 指定使用某一种医疗品（HUD / 物品栏点「使用」都走这里）
  _useMed(id){ return this._medStart(id); },
  // 自动选择：流血→先止血；血量低→大回血；否则用最便宜可用的
  _useBestMed(){
    const p=this.player;
    const has=(id)=> this._medCount(id)>0;
    const pick=(id)=> this._medStart(id);
    if(p.bleed>0){
      if(has("bandage")) return pick("bandage");
      if(has("hemo"))    return pick("hemo");
      if(has("surgery")) return pick("surgery");
    }
    if(p.hp < p.maxHP*0.45 && has("surgery")) return pick("surgery");
    if(p.hp < p.maxHP*0.80 && has("medkit"))  return pick("medkit");
    if(has("hemo"))   return pick("hemo");
    if(has("medkit")) return pick("medkit");
    if(has("stim"))   return pick("stim");
    if(has("surgery"))return pick("surgery");
    if(has("bandage"))return pick("bandage");
    this._pick(p.x,p.y-34,"没有医疗用品","#ff8a5a");
    return false;
  },
  /* HUD 用：按固定顺序返回「实际拥有」的医疗品，0 件不出现 */
  _medOwnedList(){
    const out=[];
    for(const m of RAID_MEDS){
      const n=this._medCount(m.id);
      if(n>0) out.push({ id:m.id, name:m.name, n, color:RAID_RARITY_COLOR[m.tier] });
    }
    return out;
  },
  _finishMed(){
    const p=this.player, u=this.medUse;
    if(!u){ this.medT=0; return; }
    if(u.bleed && p.bleed>0) p.bleed=0;
    if(u.heal>0) p.hp=Math.min(p.maxHP, p.hp+u.heal);
    if(u.boost) this.stimT=8;
    /* v0.14.11：治疗类物资顺带「净化」身上的元素状态。
     * 之前玩家被 AI 的曳光 / 亚音速 / 钢芯弹命中后毫无反制手段，只能干等计时结束；
     * 现在消耗一份医疗包可以止燃 / 恢复平衡 / 解除失能（破甲是装备 debuff，不在此列）。 */
    let cleansed="";
    if(u.heal>0 && ((p.burnT||0)>0 || (p.freezeT||0)>0 || (p.shockT||0)>0)){
      p.burnT=0; p.burnDps=0; p.burnSrc=null; p.freezeT=0; p.shockT=0;
      cleansed=" · 清除弹种状态";
    }
    this._float(p.x,p.y-30, (u.bleed?"已止血":"") + (u.heal>0?(" +"+u.heal+" HP"):"") + (u.boost?" · 加速":"") + cleansed, "#8fe07a");
    SFX.pickup();
    this.medUse=null; this.medT=0;
  },

  /* -------------------- 多枪：手持 / 副手 / 背包 -------------------- */
  // 每把枪的运行时对象按 uid 缓存：切回来时弹药状态连续，也不会出现「换手满弹」
  _rtGun(it){
    if(!it) return null;
    this._rtCache=this._rtCache||{};
    if(!it.uid) it.uid="rt"+Math.floor(Math.random()*1e9).toString(36);
    const key=it.uid;
    let g=this._rtCache[key];
    if(!g){
      g=raidGunFromItem(it);
      g.cal=ammoCalOfType(g.type);          // 口径跟枪型走
      g.ammoMag=0; g.ammoRes=0;             // 子弹在背包里，装填见 _prepPlayerAmmo / _startReload
      this._rtCache[key]=g;
    }
    return g;
  },
  // 背包里的枪 = 物品栏中「既不在手上、也不在副手位」的那些
  _gunBag(){
    const p=this.player; if(!p) return [];
    return (this.inv.weapons||[]).filter(it=>{ const g=this._rtGun(it); return g!==p.gun && g!==p.secondary; });
  },
  _gunList(){
    const p=this.player; if(!p) return [];
    return [p.gun, p.secondary, ...this._gunBag()].filter(Boolean);
  },

  /* -------------------- 局内商店交互 -------------------- */
  _nearestShop(x,y,range){
    let best=null, bd=range||120;
    for(const s of (this.shops||[])){
      const d=M.dist(x,y,s.x,s.y);
      if(d<bd){ bd=d; best=s; }
    }
    return best;
  },
  _openShop(sh){
    if(!sh) return;
    if(this.showInv){ this.showInv=false; document.body.classList.remove('inv-open'); this._invToggleDom(); }
    this.shopOpen=sh.id;
    SFX.ui();
    UI.raidFieldShop(sh.id);
  },
  _closeShop(){
    this.shopOpen=null;
    UI.hide();
    // UI.show() 会藏起 HUD / 触屏按钮，关商店后必须还回来，
    // 否则「退出商店所有按钮都消失」（手机上摇杆与★/+ 键全没了）。
    // 注意塔科夫/沙二/大逃杀用的是 _showDustHUD（DOM 血条隐藏、只留触屏层），
    // 不能一律调 _showHUD，否则会多出一套战役 HUD。
    if(typeof game!=="undefined" && game){
      const fn=(game.mode==="raid"||game.mode==="dust2"||game.mode==="br") ? game._showDustHUD : game._showHUD;
      if(fn) fn.call(game);
    }
    // 商店开着时摇杆被藏起来，关店后把残留方向清掉，免得一关店人就自己往前跑
    if(typeof Input!=="undefined" && Input.resetStick) Input.resetStick();
  },
  // 把手上的枪与目标枪交换；被换下的枪自动留在物品栏（= 放进背包）
  _equipGun(g){
    const p=this.player;
    if(!g || g===p.gun) return;
    const old=p.gun;
    if(g===p.secondary){ p.secondary=old||null; p.gun=g; }
    else { p.gun=g; }   // 背包枪：手上的旧枪条目仍在 inv.weapons 里，等于收回背包
    p.reloadT=0; p.fireCd=Math.max(p.fireCd,0.25);
    this._pick(p.x, p.y-34, "手持 "+gunNameOf(g), raidGunColor(g));
  },
  /* v0.21.6：把手上的枪放回背包（物品栏里每把枪都有「放回背包」按钮）。
   * 空手会拿到 +20% 移速（RAID_BAREHAND_SPEED），跑刀 / 谈判 / 翻箱时很有用。
   * which = "main" | "secondary"。枪本身一直在 inv.weapons 里，这里只是解绑手部引用，
   * 所以放回之后 Q / 1~4 随时能再拿起来。 */
  _stowGun(which){
    const p=this.player; if(!p) return false;
    const sec = which==="secondary";
    const g = sec ? p.secondary : p.gun;
    if(!g){ this._pick(p.x, p.y-34, sec?"副手没有枪":"手上没有枪", "#ff8a5a"); return false; }
    /* 安全校验：物品栏里必须真有这把枪的条目，否则一放回就等于凭空消失了 */
    const tracked=(this.inv.weapons||[]).some(it=>this._rtGun(it)===g);
    if(!tracked){ this._pick(p.x, p.y-34, "这把枪不在物品栏里 · 无法放回", "#ff8a5a"); return false; }
    if(sec) p.secondary=null; else p.gun=null;
    p.reloadT=0; p.fireCd=Math.max(p.fireCd,0.25);
    this._invDirty=true;
    this._pick(p.x, p.y-34, sec?"副手收进背包":"收进背包 · 空手（+20% 移速）", "#8fd0ff");
    SFX.ui();
    return true;
  },

  // Q / 切枪：优先从背包取下一把；背包空则与副手互换；只剩一把则收枪入包（空手跑更快）
  _cycleGun(){
    const p=this.player; if(!p) return;
    const bag=this._gunBag();
    if(bag.length){ this._equipGun(this._rtGun(bag[0])); return; }
    if(p.gun && p.secondary){
      const t=p.gun; p.gun=p.secondary; p.secondary=t;
      p.reloadT=0; p.fireCd=Math.max(p.fireCd,0.25);
      this._pick(p.x, p.y-34, "手持 "+gunNameOf(p.gun), raidGunColor(p.gun));
    } else if(p.gun){
      // 只有一把 → 收进背包，空手移动（跑刀 / 谈判时腾出手）
      this._stowGun("main");
    } else if(p.secondary){
      p.gun=p.secondary; p.secondary=null; p.reloadT=0; p.fireCd=Math.max(p.fireCd,0.25);
      this._pick(p.x, p.y-34, "手持 "+gunNameOf(p.gun), raidGunColor(p.gun));
    }
  },

  /* ----------------------------- 玩家控制 ----------------------------- */
  _playerControl(dt, game, act){
    const p=this.player;
    let mx=0,my=0;
    if(Input.isTouch){
      if(Input.stick.active){ mx=Input.stick.dx; my=Input.stick.dy; }
    } else {
      if(Input.keys['KeyW']||Input.keys['ArrowUp']) my-=1;
      if(Input.keys['KeyS']||Input.keys['ArrowDown']) my+=1;
      if(Input.keys['KeyA']||Input.keys['ArrowLeft']) mx-=1;
      if(Input.keys['KeyD']||Input.keys['ArrowRight']) mx+=1;
    }
    let ml=Math.hypot(mx,my); if(ml>1){ mx/=ml; my/=ml; ml=1; }
    /* 3D：WASD 从世界方向转为「相对视角」的前后左右 */
    if(typeof ViewMode!=="undefined" && ViewMode.is3D()){
      const mv=ViewMode.rotateMove(mx,my); mx=mv.x; my=mv.y;
    }
    p.moveX=mx; p.moveY=my;

    // 换枪（弹药状态跟随枪支，不再瞬间满弹）
    // 手上 1 把 + 副手 1 把 + 背包 N 把，Q 循环取背包里的下一把
    if(act.switch) this._cycleGun();
    if(act.slot>0){
      const list=this._gunList();
      if(list[act.slot-1]) this._equipGun(list[act.slot-1]);
    }

    // 瞄准 / 开火
    let fire=false;
    if(Input.isTouch){
      const tgt=p.gun?this._nearestFoe(p, p.gun.range):null;
      this.aimTgt=tgt;
      if(tgt){
        p.angle=M.lerpAngle(p.angle, M.angle(p.x,p.y,tgt.x,tgt.y), 0.42);
        fire=Input.fireHeld || Input.autoFire;
      } else {
        if(ml>0.12) p.angle=M.lerpAngle(p.angle, Math.atan2(my,mx), 0.25);
        fire=Input.fireHeld;
      }
    } else {
      const w=this._screenToWorld(Input.mouse.sx, Input.mouse.sy, game);
      p.angle=Math.atan2(w.y-p.y, w.x-p.x);
      fire=Input.mouse.down;
    }
    /* 3D：视角朝向即开火方向，覆盖 2D 下由鼠标世界坐标反算的角度 */
    if(typeof ViewMode!=="undefined" && ViewMode.is3D()) p.angle=ViewMode.yaw;

    // 移动（强心针：8 秒内 +25% 移速；空手跑刀：+20% 移速）
    const sp=p.speed*(p.reloadT>0?0.7:1)*(this.stimT>0?1.25:1)*(p.gun?1:RAID_BAREHAND_SPEED);
    this._moveOp(p, mx*sp*dt, my*sp*dt);
    p.vx=mx*sp; p.vy=my*sp;

    /* 涉水失温 —— 河流可以慢慢趟过去（4.5 秒安全期覆盖整条河宽），
     * 但泡在水里不动超过安全期就开始掉血，越泡掉得越快，逼玩家别把河当掩体。 */
    if(this._waterKind(p.x,p.y)===1){
      this.wadeT=(this.wadeT||0)+dt;
      if(this.wadeT>4.5){
        this.wadeDmgT=(this.wadeDmgT||0)+dt;
        if(this.wadeDmgT>=0.5){
          this.wadeDmgT-=0.5;
          this._wadeHurt(M.clamp(3+Math.floor((this.wadeT-4.5)/1.5), 3, 12));
        }
      }
    } else { this.wadeT=0; this.wadeDmgT=0; }

    // 换弹 / 射击（空手时跳过）
    if(p.gun){
      if(act.reload) this._startReload(p);
      if(p.gun.ammoMag<=0 && p.reloadT<=0) this._startReload(p);
      if(fire && p.fireCd<=0 && p.reloadT<=0){
        if(p.gun.ammoMag>0) this._fire(p, p.angle, game);
        else this._startReload(p);
      }
    }

    // 医疗（桌面 H / 移动端医疗键）：自动挑最合适的一件——流血先止血，血量低先回血
    let bandaging=false;
    if(act.med && this.medT<=0 && this._useBestMed()){ SFX.ui(); bandaging=true; }

    // 搜索补给（手机端「★」搜索键 / 桌面 E；「+」键只负责医疗，两键互不干扰）
    if((act.interact || act.ability) && !bandaging && !this.search && !this.shopOpen){
      const it=this._interactTarget();
      if(it && it.kind==="shop"){ this._openShop(it.ref); }
      else if(it && it.kind==="gadget"){ this._useGadget(it.ref); }
      else if(it && it.kind==="container"){
        const c=it.ref;
        if(!c.searched){
          if(c.locked && !this._hasKeyFor(c.lockLv)){
            const lv=M.clamp(c.lockLv||1,1,5);
            this._float(p.x, p.y-52, `需要「${RAID_LOCK_NAME[lv]}钥匙」才能开这个保险箱`, "#ff8a5a");
            SFX.ui();
          } else { this.search={ c, t:0 }; SFX.ui(); }
        }
      }
    }
  },

  /* 按 E 时到底该操作什么 —— 商铺 / 设施 / 箱子按「贴脸程度」决胜。
   * 商铺不再无条件抢优先级（站在保险箱前、商铺在 110px 外时也要能开箱），
   *   改成各自用「距离 ÷ 触发半径」归一化比较，越贴脸越优先。 */
  _interactTarget(){
    const p=this.player;
    const sh=this._nearestShop(p.x, p.y, 118);
    const gd=this._nearestGadget(p.x, p.y, 96);
    let c=this._nearestContainer(p.x, p.y, 78);
    if(c && c.damLoot && !this.damOpen) c=null;   // 水下保险箱：开闸前不可交互
    const cands=[];
    if(sh) cands.push({ kind:"shop", ref:sh, s:M.dist(p.x,p.y,sh.x,sh.y)/118 });
    if(gd) cands.push({ kind:"gadget", ref:gd, s:M.dist(p.x,p.y,gd.x,gd.y)/96 });
    if(c) cands.push({ kind:"container", ref:c, s:M.dist(p.x,p.y,c.x,c.y)/78 });
    if(!cands.length) return null;
    cands.sort((a,b)=>a.s-b.s);
    return { kind:cands[0].kind, ref:cands[0].ref };
  },

  /* 涉水失温伤害 —— 直接扣血（泡水不是被子弹打，护甲不吸收） */
  _wadeHurt(d){
    const p=this.player;
    if(!p.alive || this._ended) return;
    p.hp-=d;
    this.hitFlash=Math.min(0.30, this.hitFlash+0.06);
    this._float(p.x, p.y-26, "-"+d+" 失温", "#7fc8e8");
    if(p.hp<=0){ p.hp=0; p.alive=false; this._fail("失温溺亡", null, null); }
  },

  /* ----------------------------- 弹药（v0.20.0） -----------------------------
   * 子弹是背包里的独立物品：inv.ammo = { "ammo_mid_3": 120, ... }
   * 枪上只存「装填的是哪一种」（loaded）与弹匣内发数（ammoMag）。 */
  _ammoTotal(){
    const a=(this.inv && this.inv.ammo)||{}; let n=0;
    for(const k in a) n+=a[k]||0;
    return n;
  },
  _ammoCount(id){ return (this.inv && this.inv.ammo && this.inv.ammo[id])||0; },
  _ammoAdd(id, n){
    if(!id || !(n>0) || !ammoParseId(id)) return 0;
    this.inv.ammo=this.inv.ammo||{};
    const room=Math.max(0, RAID_AMMO_CAP-this._ammoTotal());
    const add=Math.min(n, room);
    if(add<=0) return 0;
    this.inv.ammo[id]=(this.inv.ammo[id]||0)+add;
    this._invDirty=true;
    return add;
  },
  _ammoTake(id, n){
    if(!id || !(n>0)) return 0;
    const have=this._ammoCount(id);
    const take=Math.min(have, n);
    if(take<=0) return 0;
    const left=have-take;
    if(left>0) this.inv.ammo[id]=left; else delete this.inv.ammo[id];
    this._invDirty=true;
    return take;
  },
  /* 按口径列出背包里的子弹，高级在前（换弹时优先用好的） */
  _ammoListByCal(cal){
    const out=[];
    for(let lv=5; lv>=1; lv--){
      const id=ammoItemId(cal, lv), n=this._ammoCount(id);
      if(n>0) out.push({ id, lv, n, def:ammoDef(cal, lv) });
    }
    return out;
  },
  _bestAmmoFor(gun){
    if(!gun) return null;
    if(gun.loaded && this._ammoCount(gun.loaded)>0) return gun.loaded;
    const cal=gun.cal||ammoCalOfType(gun.type);
    const list=this._ammoListByCal(cal);
    return list.length ? list[0].id : null;
  },
  /* 装填：同时改写 element / power / dotK —— 战斗结算只认这三个字段 */
  _loadAmmo(gun, id){
    const d=ammoDefFromId(id);
    if(!gun || !d) return false;
    gun.loaded=d.id; gun.cal=d.cal;
    gun.element=d.elem; gun.power=d.power; gun.dotK=d.dotK;
    return true;
  },
  _syncAmmo(o){
    if(!o || !o.gun) return 0;
    if(!o.isPlayer) return o.gun.ammoRes||0;
    o.gun.ammoRes=this._ammoCount(o.gun.loaded);
    return o.gun.ammoRes;
  },
  _noAmmoWarn(gun){
    const now=M.now();
    if((this._noAmmoT||0) > now-1.6) return;
    this._noAmmoT=now;
    const d=gun&&gun.loaded ? ammoDefFromId(gun.loaded) : null;
    this._float(this.player.x, this.player.y-40,
      d ? (d.name+" 打空了 · 去搜刮或买弹药") : "没有子弹 · 去搜刮或买弹药", "#ff8a5a");
  },

  /* 把一件护盾装备穿到玩家身上（含独特加成解析） */
  _wearShield(it){
    const p=this.player;
    if(!p || !it) return false;
    const s=ensureShield(it);
    // v0.21.9：自动穿戴的护盾必须记入 carried，否则撤离入库 / 阵亡保险只看 carried.shield，它会凭空消失
    if(this.carried){
      if(this.carried.shield && this.carried.shield!==s)
        (this.inv.shields=this.inv.shields||[]).push(this.carried.shield);
      this.carried.shield=s;
    }
    p.shieldGear=s;
    p.maxShield=s.capacity||0;
    p.shield=p.maxShield;
    p.shieldRate=s.rate||0;
    p.shieldDelay=s.delay||0;
    p.shieldInvulnBase=s.invuln||0;
    p.shieldPerks=(s.perks||[]).slice();
    p.shieldTimer=0; p.shieldInvuln=0;
    p.shieldAbsorbMul=p.shieldPerks.indexOf("emitter")>=0 ? 1.08 : 1;
    return true;
  },

  /* 出生点旁的起始补给：**只在手上这把枪一发子弹都没有时**才投放，
   * 免得「默认零携带」把裸装玩家直接锁死成走不动的靶子。
   * 不是白送进背包 —— 要走到旁边按 E 搜（0.3 秒），带弹进场的玩家不会看到它。 */
  _dropStarterCache(x, y){
    const p=this.player;
    if(!p) return;
    const gun=p.gun||p.secondary;
    const cal=gun ? (gun.cal||ammoCalOfType(gun.type))
                  : (this.carried.weapons[0] ? ammoCalOfType(this.carried.weapons[0].type) : "mid");
    if(this._ammoListByCal(cal).length) return;      // 已经有这个口径的子弹 → 不投放
    if(!this.grounds) this.grounds=[];
    const spot=this._spawnSafePoint(x+92, y+64, 18);
    const ammo=ammoDef(cal, 1);
    ammo.n=RAID_AMMO_STACK*2;                        // 两条民用弹（60 发）
    this.grounds.push({ x:spot.x, y:spot.y, tier:0, ground:true, searched:false,
      drops:[ammo, raidMakeMed("bandage")], cash:0, starter:true });
    this._starterCache=true;
  },

  /* 支付 ₽512 购买的「初始装备包」（v0.21.2）：
   * 旧版是「带够 ₽200 现金进场就白送」，等于带钱反而更强 —— 现在改成明码标价：
   * 配装大厅勾选「初始装备包」，进场时从**带入的卢布现金**里扣 ₽512，出生点投放
   * 2 把白枪 + 每条一把 T2 制式弹 + T1 护盾 / 护甲 / 头盔 + 绷带与止血针各一。
   * 和起始补给一样，要走到旁边按 E 搜（0.3 秒）才进包。 */
  _dropSupportCache(x, y){
    if(!this.supportPaid) return;
    if(!this.grounds) this.grounds=[];
    const spot=this._spawnSafePoint(x-92, y+64, 18);
    const drops=[];
    const cals=[];
    for(let i=0;i<2;i++){
      const g=blGunGen(8, { type: i ? "smg" : "rifle", rarity:"white" });
      g.kind="weapon"; g.uid=this._uid();
      drops.push(g);
      const cal=ammoCalOfType(g.type);
      if(cals.indexOf(cal)<0){
        cals.push(cal);
        const a=ammoDef(cal, 2);          // T2 制式
        a.n=RAID_AMMO_STACK;
        drops.push(a);
      }
    }
    drops.push(raidMakeShield(1, 0));      // T1 民用护盾
    drops.push(raidMakeArmor(1, 0));       // T1 护甲
    drops.push(raidMakeHelmet(1, 0));      // T1 头盔
    for(const id of ["bandage","hemo"]){
      const m=raidMakeMed(id);
      if(m) drops.push(m);
    }
    this.grounds.push({ x:spot.x, y:spot.y, tier:0, ground:true, searched:false,
      drops, cash:0, support:true });
    this._supportDropped=true;
    this._feed("装备包", "已支付 ₽"+this.supportPaid+" · 出生点已投放初始装备包", "", false, "info");
  },

  /* 进场装填：按配装大厅的选择把子弹搬进本局，给手上的枪上膛 */
  _prepPlayerAmmo(opts){
    this.inv.ammo=this.inv.ammo||{};
    const st=this.stash||{}, stAmmo=st.ammo||(st.ammo={});
    const want=(opts && opts.ammo)||null;
    const take=(id, n)=>{
      const have=Math.max(0, stAmmo[id]||0);
      const room=Math.max(0, RAID_AMMO_CAP-this._ammoTotal());
      const k=Math.min(have, room, Math.max(0, Math.round(n)||0));
      if(k<=0) return 0;
      if(have-k>0) stAmmo[id]=have-k; else delete stAmmo[id];
      this.inv.ammo[id]=(this.inv.ammo[id]||0)+k;
      return k;
    };
    if(want){
      for(const cal of Object.keys(want)){
        const w=want[cal];
        if(!w || !w.id) continue;
        take(w.id, w.n===undefined ? 9999 : w.n);
      }
    }
    /* v0.20.1：没指定（opts.ammo 缺省 / 为空）= 一发都不带。
     * 之前「没指定就全带」会让玩家默认背满 720 发，与「弹药要自己负责」的设计相反。 */
    const p=this.player;
    if(!p) return;
    for(const gun of [p.gun, p.secondary]){
      if(!gun) continue;
      gun.cal=ammoCalOfType(gun.type);
      const wantId=want && want[gun.cal] && want[gun.cal].id;
      let id=(wantId && this._ammoCount(wantId)>0) ? wantId : this._bestAmmoFor(gun);
      if(!id){ gun.ammoMag=0; gun.ammoRes=0; continue; }
      this._loadAmmo(gun, id);
      gun.ammoMag=this._ammoTake(id, gun.mag);
      gun.ammoRes=this._ammoCount(id);
    }
  },

  _startReload(o){
    if(!o.gun) return;
    if(o.reloadT>0 || o.gun.ammoMag>=o.gun.mag) return;
    if(o.isPlayer){
      this._syncAmmo(o);
      if(o.gun.ammoRes<=0){
        /* 当前那档打光了：自动换用背包里同口径还没打光的子弹（高级优先） */
        const alt=this._bestAmmoFor(o.gun);
        if(alt && alt!==o.gun.loaded){
          this._loadAmmo(o.gun, alt);
          this._syncAmmo(o);
          if(o.gun.ammoRes>0) this._float(o.x, o.y-40, "换用 "+ammoDefFromId(alt).short, "#ffd36a");
        }
      }
      if(o.gun.ammoRes<=0){ this._noAmmoWarn(o.gun); return; }
    } else if(o.gun.ammoRes<=0) return;
    o.reloadT = Math.max(0.9, 2.4 - o.gun.mag*0.02);
    SFX.reload();
  },

  /* 换弹读条结束：玩家从背包扣子弹，AI 直接补满（AI 没有物品栏） */
  _finishReload(o){
    if(!o || !o.gun) return;
    const g=o.gun;
    const need=Math.max(0, g.mag-g.ammoMag);
    if(!o.isPlayer){
      if(g.ammoRes < g.mag) g.ammoRes = g.mag;
      const take=Math.min(need, g.ammoRes);
      g.ammoMag+=take; g.ammoRes-=take;
      return;
    }
    const id=g.loaded;
    const take=id ? this._ammoTake(id, need) : 0;
    g.ammoMag+=take;
    g.ammoRes=id ? this._ammoCount(id) : 0;
    if(take<=0) this._noAmmoWarn(g);
  },

  _moveOp(o, dx, dy){
    const px=o.x, py=o.y;
    /* 河流不再整条封死 —— 浅水可涉水通过，但速度只剩 45%；
     * 深水（大坝水库未开闸）依旧硬阻挡，踩桥面（kind=0）不受影响。 */
    const wetHere=this._waterKind(o.x,o.y)===1;
    const wetNext=this._waterKind(o.x+dx,o.y+dy)===1;
    if(wetHere || wetNext){ dx*=0.45; dy*=0.45; }
    // v0.14.10：冰冻减速与涉水减速叠乘（玩家 / AI 共用此入口）
    if(o.freezeT>0){ dx*=FREEZE_SLOW; dy*=FREEZE_SLOW; }
    let nx=o.x+dx, ny=o.y+dy;
    // 分轴滑行：先 X 后 Y，贴墙时仍能滑动
    let r=this._resolve(nx, o.y, o.r); nx=r.x;
    r=this._resolve(nx, ny, o.r); nx=r.x; ny=r.y;
    o.x=M.clamp(nx, o.r, RAID_MAP_W-o.r);
    o.y=M.clamp(ny, o.r, RAID_MAP_H-o.r);
    // 深水阻挡：落深水则沿岸边滑行（仅保留未落深水的单轴位移）
    if(this._waterKind(o.x,o.y)===2){
      if(this._waterKind(px, o.y)!==2) o.x=px;
      else if(this._waterKind(o.x, py)!==2) o.y=py;
      else { o.x=px; o.y=py; }
    }
    o._wet = this._waterKind(o.x,o.y)===1;
    // 移动幅度（0..1）：180px/s÷60 ≈ 3px/帧
    o._mv = Math.min(1, Math.hypot(o.x-px, o.y-py)/3.0);
  },

  _resolve(x, y, r){
    const list=this._nearWalls ? this._nearWalls(x, y, r+6) : this.walls;
    for(let i=0;i<list.length;i++){
      const w=list[i];
      const nx=M.clamp(x, w.x, w.x+w.w), ny=M.clamp(y, w.y, w.y+w.h);
      const dx=x-nx, dy=y-ny; const d2=dx*dx+dy*dy;
      if(d2<r*r){
        const d=Math.sqrt(d2)||0.0001, push=r-d;
        x+=(dx/d)*push; y+=(dy/d)*push;
      }
    }
    return {x,y};
  },

  /* ----------------------------- AI PMC ----------------------------- */
  _botsUpdate(dt, game){
    // 联机非房主：AI 完全由房主模拟，这里只渲染影子
    if(this.online && typeof Net!=="undefined" && !Net.isHost) return;
    if(this.spawnGrace>0) this.spawnGrace=Math.max(0,this.spawnGrace-dt);   // 整帧只递减一次
    let p=this.player;
    for(const b of this.ops){
      if(b.isPlayer||b.remote||b.ghost||!b.alive) continue;
      const sense=raidAISense(b);
      // 联机房主：AI 会在「自己 + 所有远端玩家」里挑最近的可见目标
      // AI 之间也会交火 —— 把「其他敌对 AI」也纳入候选目标（同小队不互打、流浪 Scav 之间友好）
      // v0.21.9：基线不再预设玩家原始距离 —— 否则被墙挡住的近处玩家会屏蔽更远但可见的敌对目标
      let tgt=null, d=Infinity;
      const _consider=(o)=>{
        if(o===b || !o.alive || o.ghost) return;
        let enemy;
        if(o.isPlayer || o.remote) enemy=true;                              // 玩家永远是敌人
        else if(b.bounty || o.bounty) enemy=true;                           // Boss 敌对所有
        else if(b.cls==="scav" && o.cls==="scav") enemy=false;             // 流浪 Scav 之间友好
        else if(o.squadId && o.squadId===b.squadId && b.squadId) enemy=false; // 同小队不互打
        else enemy=true;
        if(!enemy) return;
        const dd=M.dist(b.x,b.y,o.x,o.y);
        // 视距按 Scav / PMC / Boss 分级；玩家在近身范围内仍强行抢目标
        const sight = sense.sight;
        const pri = (o.isPlayer||o.remote) ? (dd<720 ? -2000 : 0) : 0;   // 玩家近身时强行抢目标
        if((dd+pri)<d && dd<sight && this._los(b.x,b.y,o.x,o.y)){ d=dd; tgt=o; }
      };
      _consider(p);
      if(this.online){ for(const o of this.ops){ if(o.isPlayer||o.remote) _consider(o); } }
      for(const o of this.ops){ if(!o.isPlayer && !o.remote) _consider(o); }
      if(!tgt || !tgt.alive) tgt=p;
      /* 索敌分级：Scav 视距短、反应慢、忘得快；PMC 更警觉；Boss 几乎即时锁定。
       * _detectT 累积「持续看见」的时间，视线中断会快速衰减；已警觉的 AI 重新发现目标时不再重复反应延迟。 */
      const grace = this.spawnGrace>0 && (tgt.isPlayer || tgt.remote);
      const seenNow = tgt.alive && d<sense.sight && !grace && this._los(b.x,b.y,tgt.x,tgt.y);
      b._detectT = seenNow ? (b._detectT||0)+dt : Math.max(0,(b._detectT||0)-dt*1.5);
      const canSee = seenNow && (b._detectT>=sense.react || !!b.lastSeen);
      if(canSee) b.lastSeen={ x:tgt.x, y:tgt.y, t:sense.memory };   // 记住最后位置，丢失视线也不马上忘

      /* 所有 AI 都会用医疗品 —— 血量低于阈值且暂时脱离火线时自行包扎 */
      if(b.medT>0){
        b.medT-=dt;
        if(b.medT<=0 && b.bandages>0){
          b.bandages--; b.hp=Math.min(b.maxHP, b.hp + Math.max(40, b.maxHP*0.42));
          if(b.smart) this._float(b.x, b.y-30, "包扎 +"+Math.round(Math.max(40,b.maxHP*0.42)), "#8fe07a");
        }
        b.state="heal";
        const a=M.angle(tgt.x,tgt.y,b.x,b.y);
        this._moveOp(b, Math.cos(a)*b.speed*0.5*dt, Math.sin(a)*b.speed*0.5*dt);
        continue;
      }
      {
        const lowHP = b.smart ? 0.58 : (b.cls==="pmc" ? 0.45 : 0.38);
        const safe = !canSee || d>560;
        if(b.hp < b.maxHP*lowHP && b.bandages>0 && safe && b._dodgeT<=0){
          b.medT = b.smart ? 1.3 : 2.0; b.state="heal"; continue;
        }
      }

      /* 有枪 + 看见玩家 → 交战 */
      if(canSee && b.gun){
        b.state="engage"; b.lootTarget=null; b.lootT=0;
        b.angle=M.lerpAngle(b.angle, M.angle(b.x,b.y,tgt.x,tgt.y), b.smart?0.26:0.19);
        let mx=0,my=0;
        // 压得更狠（170 才开始保持距离，60 以内才后退）
        if(d>170){ mx=Math.cos(b.angle); my=Math.sin(b.angle); }
        else if(d<60){ mx=-Math.cos(b.angle); my=-Math.sin(b.angle); }
        // 换弹时不再「端着空枪往前冲」——拉开距离等装填完
        if(b.reloadT>0 && d<620){ mx=-Math.cos(b.angle); my=-Math.sin(b.angle); b.state="reload"; }
        // 交战时左右游走，不再站桩对射（玩家更难被「固定靶」式预瞄）
        b._strafeT=(b._strafeT||0)-dt;
        if(b._strafeT<=0){ b._strafeT=RNG.fr(0.7,1.7); b._strafe=RNG.chance(0.5)?1:-1; }
        const inRange = d <= Math.min(560, (b.gun.range||700)*0.82);
        if(inRange){
          const sw=(b.smart?0.72:0.52)*b._strafe;
          mx+=-Math.sin(b.angle)*sw; my+=Math.cos(b.angle)*sw;
        }
        // 子弹擦身而过就侧向急闪（Raider 闪得更快更远），这就是「会躲子弹」
        if(b._dodgeT>0){
          b._dodgeT-=dt;
          const ds=(b._dodgeSide||1)*(b.smart?1.65:1.15);
          mx+=-Math.sin(b.angle)*ds; my+=Math.cos(b.angle)*ds;
        }
        const ml=Math.hypot(mx,my); if(ml>1){ mx/=ml; my/=ml; }
        const ex=b.x, ey=b.y;
        this._moveOp(b, mx*b.speed*dt, my*b.speed*dt);
        if((mx||my) && Math.hypot(b.x-ex,b.y-ey) < b.speed*dt*0.45){
          b._fleeT=(b._fleeT||0)+dt;
          if(b._fleeT>0.5){ b._fleeA=RNG.fr(0,6.2832); b._fleeT=0; }
          const a2=(b._fleeA!==undefined)?b._fleeA:b.angle+(b._fleeSide||(b._fleeSide=1))*1.3;
          this._moveOp(b, Math.cos(a2)*b.speed*dt, Math.sin(a2)*b.speed*dt);
        } else if(mx||my){ b._fleeT=0; b._fleeA=undefined; }
        if(b.fireCd<=0 && b.reloadT<=0){
          if(b.gun.ammoMag>0){
            // 枪法更准、开火间隔更短（jitter 0.026→0.018 / 0.072→0.050，CD 0.04→0.02 / 0.14→0.085）
            const jitter = b.smart ? 0.008 : (b.cls==="scav" ? 0.050 : 0.018);
            const cd = b.smart ? 0 : (b.cls==="scav" ? 0.085 : 0.02);
            this._fire(b, b.angle+M.normAngle(Math.random()-0.5)*jitter, game);
            // 修复：额外射击间隔必须放在 _fire 之后 —— _fire 开头会因 fireCd>0 直接 return，
            // 旧顺序导致所有非 Raider 一枪都打不出来（表现为「看见人却不开枪」）。
            if(cd>0) b.fireCd=Math.max(b.fireCd, cd);
          } else {
            // AI 会就地摸弹 —— 备弹打完自动补两个弹匣（否则永远开不了枪）
            if(b.gun.ammoRes<=0) b.gun.ammoRes=b.gun.mag*2;
            this._startReload(b);
          }
        }
        b._stuck=0;
        continue;
      }

      /* 空手 / 无枪：看见玩家就逃，边逃边找枪 */
      if(tgt.alive && d<340){
        b.state="flee";
        const a=M.angle(tgt.x,tgt.y,b.x,b.y);
        b.angle=M.lerpAngle(b.angle, a, 0.14);
        const fx=b.x, fy=b.y;
        this._moveOp(b, Math.cos(a)*b.speed*1.05*dt, Math.sin(a)*b.speed*1.05*dt);
        // 贴墙逃不掉时先沿墙侧移，再不行就换一个随机方向挣扎一会儿
        if(Math.hypot(b.x-fx,b.y-fy) < b.speed*dt*0.5){
          b._fleeT=(b._fleeT||0)+dt;
          if(b._fleeT>0.4){ b._fleeA=RNG.fr(0,6.2832); b._fleeT=0; }
          const a2=(b._fleeA!==undefined)?b._fleeA:a+(b._fleeSide||(b._fleeSide=1))*1.35;
          this._moveOp(b, Math.cos(a2)*b.speed*dt, Math.sin(a2)*b.speed*dt);
        } else { b._fleeT=0; b._fleeA=undefined; }
        continue;
      }

      /* 空手 / 没有枪：第一要务是搞到一把枪 —— 满图找武器箱，不再跟着玩家跑 */
      if(!b.gun && this._botLootUpdate(b, dt, true)) continue;

      /* 撤离点封锁者：无敌人时驻守目标撤离点，玩家靠近即交火（见上方 canSee 分支） */
      if(b.blockZone){
        const cx=b.blockZone.x+b.blockZone.w/2, cy=b.blockZone.y+b.blockZone.h/2;
        const dz=M.dist(b.x,b.y,cx,cy);
        if(dz>64){
          const a=M.angle(b.x,b.y,cx,cy);
          b.angle=M.lerpAngle(b.angle,a,0.12);
          this._moveOp(b, Math.cos(a)*b.speed*0.9*dt, Math.sin(a)*b.speed*0.9*dt);
          b.state="move"; continue;
        }
        b.state="guard";
        b.roamT-=dt;
        if(b.roamT<=0){ b.angle=RNG.fr(0,6.28); b.roamT=RNG.fr(1.5,3); }
        continue;
      }

      /* 小队抱团：非队长朝队友集结点靠拢，避免散开（交战 / 驻守优先级更高，已先行处理） */
      if(b.squadId && !b.isLeader){
        const mates=this.ops.filter(o=>o!==b && o.alive && o.squadId===b.squadId);
        if(mates.length){
          const ax=mates.reduce((s,o)=>s+o.x,0)/mates.length;
          const ay=mates.reduce((s,o)=>s+o.y,0)/mates.length;
          const ad=M.dist(b.x,b.y,ax,ay);
          if(ad>150){
            const a=M.angle(b.x,b.y,ax,ay);
            b.angle=M.lerpAngle(b.angle,a,0.10);
            this._moveOp(b, Math.cos(a)*b.speed*0.85*dt, Math.sin(a)*b.speed*0.85*dt);
            b.state="move"; continue;
          }
        }
      }

      /* 丢失视线后仍会朝最后位置追一段 */
      if(b.lastSeen && b.gun){
        b.lastSeen.t-=dt;
        if(b.lastSeen.t<=0) b.lastSeen=null;
        else {
          const dl=M.dist(b.x,b.y,b.lastSeen.x,b.lastSeen.y);
          if(dl>70){
            const a=M.angle(b.x,b.y,b.lastSeen.x,b.lastSeen.y);
            b.angle=M.lerpAngle(b.angle,a,0.14);
            const ox=b.x, oy=b.y;
            this._moveOp(b, Math.cos(a)*b.speed*dt, Math.sin(a)*b.speed*dt);
            // 目标在墙后就放弃，避免顶着掩体原地抽搐
            if(Math.hypot(b.x-ox,b.y-oy) < b.speed*dt*0.35){ b.lastSeen=null; }
            else { b.state="chase"; continue; }
          }
          b.lastSeen=null;
        }
      }

      /* 听到枪声：朝声源方向摸过去 */
      if(b.investigate){
        b.investigate.t-=dt;
        const iv=b.investigate;
        if(iv.t<=0){ b.investigate=null; }
        else {
          const di=M.dist(b.x,b.y,iv.x,iv.y);
          if(di>64){
            const a=M.angle(b.x,b.y,iv.x,iv.y);
            b.angle=M.lerpAngle(b.angle,a,0.13);
            const ox=b.x, oy=b.y;
            this._moveOp(b, Math.cos(a)*b.speed*dt, Math.sin(a)*b.speed*dt);
            if(Math.hypot(b.x-ox,b.y-oy) < b.speed*dt*0.35){ b.investigate=null; }
            else { b.state="hunt"; continue; }
          } else b.investigate=null;
        }
      }

      /* 独立搜刮：走向附近的未搜索容器，停留开箱 */
      if(this._botLootUpdate(b, dt)) continue;

      /* 巡逻 */
      b.state="roam";
      b.roamT-=dt;
      if(!b.roamPt || b.roamT<=0 || M.dist(b.x,b.y,b.roamPt.x,b.roamPt.y)<40){
        // PMC / Raider 有较大概率直接朝玩家所在区域游走，而不是在固定巡逻点之间晃
        // 只有手里有枪的 AI 才会主动压向玩家；空手的先去找装备
        // 主动搜寻概率按索敌等级：Scav 0.30 / PMC 0.70 / Boss 0.95
        const huntP = sense.hunt;
        const hunts = b.gun && tgt.alive && RNG.chance(huntP);
        const pt = hunts
          ? [tgt.x+RNG.fr(-560,560), tgt.y+RNG.fr(-560,560)]
          : RNG.pick((this.patrolPts&&this.patrolPts.length)?this.patrolPts:RAID_PATROL);
        b.roamPt={x:M.clamp(pt[0]+RNG.fr(-40,40),60,RAID_MAP_W-60),
                  y:M.clamp(pt[1]+RNG.fr(-40,40),60,RAID_MAP_H-60)};
        b.roamT=RNG.fr(3,7);   // 巡逻换点更勤
      }
      if(b.roamPt){
        const a=M.angle(b.x,b.y,b.roamPt.x,b.roamPt.y);
        b.angle=M.lerpAngle(b.angle, a, 0.08);
        const ox=b.x, oy=b.y;
        this._moveOp(b, Math.cos(a)*b.speed*0.8*dt, Math.sin(a)*b.speed*0.8*dt);
        if(Math.hypot(b.x-ox,b.y-oy) < b.speed*0.8*dt*0.25){
          b._stuck+=dt;
          if(b._stuck>0.5){ b.roamPt=null; b.roamT=0; b._stuck=0; }
        } else b._stuck=0;
      }
    }
  },

  /* AI 搜刮：返回 true 表示本帧正在前往 / 开箱（不再巡逻） */
  _botLootUpdate(b, dt, needGun){
    const gunless = needGun || !b.gun;
    // 空手的 AI 不算「搜刮额度」：它们会一直找枪，直到弄到一把为止
    if(!gunless && b.lootCount>=b.lootLimit) return false;
    if(b._badT>0){ b._badT-=dt; if(b._badT<=0) b._badC=null; }
    if(b._badPtT>0){ b._badPtT-=dt; if(b._badPtT<=0) b._badPt=null; }
    if(b.lootTarget && b.lootTarget.searched){ b.lootTarget=null; b.lootT=0; b._lootProg=null; }
    b.aiT-=dt;
    if(!b.lootTarget && b.aiT<=0){
      b.aiT = gunless ? 0.8 : (b.smart ? 1.6 : 3.2);
      b.lootTarget = this._nearestLootContainer(b, gunless);
      b.lootT = 0; b._lootProg=null; b._lootDetour=null;
    }
    const c=b.lootTarget;
    if(!c) return false;
    const dd=M.dist(b.x,b.y,c.x,c.y);
    if(dd>54){
      const a=M.angle(b.x,b.y,c.x,c.y);
      b.angle=M.lerpAngle(b.angle,a,0.14);
      // 卡住绕行：撞墙时先侧移一段，还是走不通才放弃这个箱子
      if(b._lootDetour && b._lootDetour.t>0){
        b._lootDetour.t-=dt;
        const a2=a+b._lootDetour.side*1.45;
        this._moveOp(b, Math.cos(a2)*b.speed*0.95*dt, Math.sin(a2)*b.speed*0.95*dt);
        b.state="loot";
        return true;
      }
      const ox=b.x, oy=b.y;
      this._moveOp(b, Math.cos(a)*b.speed*0.95*dt, Math.sin(a)*b.speed*0.95*dt);
      // 进度判定：1.2 秒内没靠近目标 24px，就先绕行 0.9 秒，再不行拉黑 8 秒
      if(!b._lootProg) b._lootProg={ d0:dd, t:0 };
      b._lootProg.t += dt;
      if(b._lootProg.t>=1.2){
        if(dd > b._lootProg.d0-24){
          if(!b._lootDetour){
            b._lootDetour={ side: RNG.chance(0.5)?1:-1, t:0.9 };
            b._lootProg=null;
          } else {
            b._badC=c; b._badT=8; b.lootTarget=null; b.lootT=0; b.aiT=0.4;
            b._lootProg=null; b._lootDetour=null;
            b._badPt={ x:b.x, y:b.y }; b._badPtT=14;   // 这一片都绕不进去，先别在这附近找
            b.state="loot";
            return false;
          }
        } else b._lootProg={ d0:dd, t:0 };
      }
      b.state="loot";
      return true;
    }
    b._lootProg=null; b._lootDetour=null;
    b.state="loot";
    b.lootT += dt*(b.smart?1.2:0.6);
    const need = c.locked?2.2:1.25;
    if(b.lootT>=need){
      c.searched=true;
      this._botLoot(b, c, b.smart?0.35:0.10);   // AI 按自身水平掷品质，Raider 搜到更好的货
      b.lootTarget=null; b.lootT=0; b.lootCount++;
    }
    return true;
  },

  _nearestLootContainer(b, needGun){
    const rawCap = needGun ? 2600 : (b.smart?820:470);
    const usable=(c)=>{
      if(c.searched || c.body || c.ground || c===b._badC) return false;
      if(this.search && this.search.c===c) return false;
      // AI 没有高级钥匙，只能撬 I~II 级保险箱，把高阶金库留给玩家
      if(c.locked && M.clamp(c.lockLv||1,1,5)>2) return false;
      if(b._badPtT>0 && b._badPt && M.dist2(c.x,c.y,b._badPt.x,b._badPt.y) < 350*350) return false;
      return true;
    };
    const score=(c)=>{
      let eff=M.dist2(b.x,b.y,c.x,c.y);
      if(needGun){
        // 找枪优先级：武器箱 ≫ 上锁军用箱 > 护甲箱 > 其他
        if(c.kind==="weapon") eff*=0.10;
        else if(c.locked) eff*=0.42;
        else if(c.kind==="armor") eff*=0.55;
      } else if(b.smart && (c.kind==="weapon"||c.kind==="armor")) eff*=0.55;
      return eff;
    };
    // 三档退让：① 半径内视线可达 ② 半径内任意 ③ 全图任意
    for(const pass of [0,1,2]){
      if(pass===2 && !needGun) break;
      const cap = pass===2 ? 1e9 : rawCap;
      let best=null, bestEff=Infinity;
      for(const c of this.containers){
        if(!usable(c)) continue;
        const raw=M.dist(b.x,b.y,c.x,c.y);
        if(raw>cap) continue;
        if(pass===0 && !this._los(b.x,b.y,c.x,c.y)) continue;
        const eff=score(c);
        if(eff<bestEff){ bestEff=eff; best=c; }
      }
      if(best) return best;
    }
    return null;
  },

  _botLoot(b, c, luck){
    luck=luck||0;
    let got=null;
    if(c.kind==="weapon"){
      // 空手的 AI 翻武器箱更容易翻到枪（否则永远在找枪的路上）
      const pGun = b.gun ? 0.25 : 0.72;
      // Scav 翻到的仍是低阶枪，不会因为摸到武器箱就掏出高品级步枪。
      if(RNG.chance(pGun)) got=this._rollGunLoot(b.cls==="scav"?"scav":"pmc", b.cls==="scav"?0:luck);
      else got=this._rollMaterial(luck);
    } else if(c.kind==="armor"){
      if(RNG.chance(0.22)) got=RNG.chance(0.6)?raidMakeArmor(raidRollArmorTier(luck)):raidMakeHelmet(raidRollArmorTier(luck*0.85));
      else if(RNG.chance(0.70)) got=this._rollMaterial(luck);
    } else if(c.kind==="medical"){
      b.bandages=(b.bandages||0)+1;
      b.creds+=RNG.ri(6,30);
      if(RNG.chance(0.38)) got=this._rollMaterial(luck);
    } else if(c.locked){
      const lv=M.clamp(c.lockLv||1,1,5);
      if(RNG.chance(0.80)) got=this._rollVaultLoot(lv);   // 保险箱：按等级掷装备
      b.creds+=RNG.ri(25,80)*lv;
    } else {
      // 杂项箱：原材料为主，配件其次，现金只是零头
      if(RNG.chance(0.62)) got=this._rollMaterial(luck);
      else if(RNG.chance(0.55)) got=this._rollPartGear();
      else b.creds+=RNG.ri(15,55);
    }
    if(got) this._botTakeItem(b, got);
    // 搜到钱
    if(!got && RNG.chance(0.35)) b.creds+=RNG.ri(8,30);
  }
});
