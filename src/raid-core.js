/* =========================================================================
 * raid-core.js — 主控 Raid（对象字面量 · 第 1 段）
 * v0.22.0：由 raid.js 按自然边界物理拆分，逻辑零改写。经典脚本按 index.html 顺序加载，
 * 共享同一全局词法作用域。verify 的 raidSrc 会聚合全部 raid-*.js 做源码断言。
 * ========================================================================= */
const Raid = {
  active:false,
  map:null,
  player:null,
  ops:[],
  containers:[],
  extracts:[],
  walls:[],
  roomRects:[],
  tracers:[],
  killfeed:[],
  floats:[],
  toasts:[],          // v0.21.4：3D 下的屏幕空间拾取提示（世界坐标的 floats 在 3D 里看不见）
  particles:[],
  camera:{x:0,y:0},
  timer:480,
  raidDuration:480,  // v0.22.2：局时唯一来源（结算用时从这里算，不再写死 480）
  indoor:0,          // v0.22.2：室内亮度因子 0..1，跨门口平滑过渡（2D / 3D 共用）
  creds:0,
  inv:{weapons:[],armors:[],helmets:[],shields:[],parts:[]},
  carried:{weapons:[],armor:null,helmet:null},
  stash:null,
  extractT:0,
  bandages:1, medT:0,
  insured:false, insuredVal:0,
  search:null,
  serverT:8,
  hitFlash:0,
  aimTgt:null,
  uidN:0,
  showInv:false,
  _shownWarn:false,
  // 战利品品质随携带装备估值浮动 + 增援系统
  carriedValue:0,
  carryVal:0,          // 带入装备估值（撤离费 / 商店定价基准）
  tokens:0,            // GP 币（局内拾取 + 撤离结算）
  shops:[],            // 局内商店摊位
  shopOpen:null,       // 当前打开的商店（DOM 面板）
  _rtCache:null,       // 枪械运行时缓存（多枪切换时保留各自弹药）
  lootLuck:0,
  elapsed:0,
  reinforceT:0,
  _squadN:0,
  maxOps:48,
  /* v0.23.0：涌潮 / 空投 */
  seed:0,              // 本局种子（涌潮落点由它派生局部 LCG，两端一致）
  surgeIdx:0,          // 已触发的涌潮次数
  airdrops:[],         // 场上空投（渲染 + 小地图）

  /* ----------------------------- 启动 ----------------------------- */
  // 启动失败时把已从仓库扣除的装备/现金/钥匙/医疗品原样退回，避免“局没进去装备没了”。
  start(game, opts={}){
    try{ this._start(game, opts); }
    catch(err){
      console.error("[Raid.start]", err);
      try{ this.abortStart(); }catch(e){ console.error("[Raid.abortStart]", e); }
      throw err;
    }
  },

  abortStart(){
    this.active=false; this.spectate=false; this._ended=true;
    const st=this.stash;
    // 只有开局扣装已经成功落盘时才回滚；如果那次 save 失败，旧存档本来就没变，不能再加一遍。
    if(st && this._stashPersisted){
      const carried=this.carried||{ weapons:[], armor:null, helmet:null };
      for(const w of (carried.weapons||[])) if(w) st.weapons.push(w);
      if(carried.armor) st.armors.push(carried.armor);
      if(carried.helmet) st.helmets.push(carried.helmet);
      if(carried.shield) (st.shields=st.shields||[]).push(carried.shield);
      for(const k of ((this.inv&&this.inv.keys)||[])) (st.keys=st.keys||[]).push(k);
      if(this.cashIn) st.creds=(st.creds||0)+this.cashIn;
      if(this.tokensIn) st.tokens=(st.tokens||0)+this.tokensIn;
      if(this.insured) st.creds=(st.creds||0)+(this.insuredVal||0);
      if(this.medsIn) st.meds=Object.assign({},this.medsIn);
      if(this.bandagesIn!==undefined) st.bandages=this.bandagesIn;
      /* 撤离结算落盘。这是本局最不能静默的一步：写失败等于玩家带出来的战利品
         没进仓库。Store 层本身已不抛错，这里兜的是序列化之外的意外。 */
      try{ RaidStash.save(st); }
      catch(e){ console.error("[Raid] 撤离结算写入仓库失败，战利品可能丢失", e); }
    }
    this.carried={ weapons:[], armor:null, helmet:null, shield:null };
    this.cashIn=0; this.tokensIn=0; this.insured=false; this.insuredVal=0;
    this._stashPersisted=false;
    this.resetUiState();
  },

  // 统一关闭局内所有 DOM 弹层，避免 shopOpen / showInv 跨暂停、跨局残留。
  resetUiState(){
    this.showInv=false;
    this.shopOpen=null;
    this.search=null;
    this.medT=0; this.medUse=null;
    if(typeof document!=="undefined"){
      document.body.classList.remove("inv-open");
      const el=document.getElementById("inv-layer");
      if(el){ el.classList.add("hidden"); el.innerHTML=""; }
    }
  },

  _start(game, opts={}){
    // 联机：所有客户端必须用同一个种子，地图 / 箱子 / 撤离点开放状态才会一致
    this.online=!!opts.online;
    if(this.online && opts.seed) this.seed=opts.seed>>>0;
    else this.seed=(Date.now()^(Math.random()*1e9))>>>0;
    RNG.setSeed(this.seed);
    this.active=true;
    this.game=game;
    this.resetUiState();
    this.carried={ weapons:[], armor:null, helmet:null, shield:null };
    this.medsIn=null; this.bandagesIn=undefined;
    /* v0.38.0（P1）：破盾无敌配额是本局账本，必须每局清零。
       旧版只在首次使用时惰性初始化，而 Raid 实例跨局复用 —— 第二局起
       账本还留着上一局的消耗，高阶护盾的「破盾保命无敌」被静默扣光。 */
    this._ivUsed={};
    this.cashIn=0; this.tokensIn=0; this.insured=false; this.insuredVal=0;
    this._stashPersisted=false;
    this.map={w:RAID_MAP_W,h:RAID_MAP_H};
    this.tracers=[]; this.killfeed=[]; this.floats=[]; this.toasts=[]; this.particles=[]; this.rockets=[]; this.blasts=[];
    this.timer=this.raidDuration; this.indoor=0; this.creds=0; this.extractT=0; this.search=null;
    this.bandages=1; this.medT=0; this.medUse=null; this.stimT=0;
    this.meds={hemo:0,medkit:0,stim:0,surgery:0};
    this.insured=false; this.insuredVal=0;
    this.serverT=8; this.hitFlash=0; this.aimTgt=null; this._shownWarn=false;
    this.inv={weapons:[],armors:[],helmets:[],shields:[],parts:[],materials:[],meds:[],cores:[],receivers:[],keys:[],ammo:{}};
    this.uidN=0;
    this.elapsed=0; this.reinforceT=0; this._squadN=0;
    this.surgeIdx=0; this.airdrops=[];
    this.spawnGrace=8;                        // 开局 8 秒 AI 不主动锁定（玩家先开枪即失效）
    this.spectate=false; this._ended=false;

    this.stash=RaidStash.load();
    this.tokens=0;                            // 本局拾取的 GP 币（撤离才落袋）
    this._firstKillToken=false;               // 本局首杀名额（首个击杀必得 1 枚）
    /* 医疗品/绷带也要从仓库扣除——阵亡后不能“用掉的还在仓库里”，
     * 成功撤离时再把本局剩余量写回。bandages 用显式判断，0 卷不会再被 ||1 变成 1 卷。 */
    this.medsIn = Object.assign({hemo:0,medkit:0,stim:0,surgery:0}, this.stash.meds||{});
    this.bandagesIn = (this.stash.bandages===undefined || this.stash.bandages===null)
      ? 1 : Math.max(0, Math.floor(this.stash.bandages));
    this.meds = Object.assign({}, this.medsIn);
    this.bandages = this.bandagesIn;
    this.stash.meds = { hemo:0, medkit:0, stim:0, surgery:0 };
    this.stash.bandages = 0;
    this._applyLoadout(opts);
    // 仓库钥匙串随入场携带（最多 8 把，死了就丢；撤离成功才带回）
    this.stash.keys=this.stash.keys||[];
    if(Array.isArray(opts.keys)){
      // 只带玩家勾选的钥匙，未选的留在仓库（不会因为死一局被清空）
      const want=new Set(opts.keys), take=[], keep=[];
      for(const k of this.stash.keys){ if(want.has(k.uid)) take.push(k); else keep.push(k); }
      this.inv.keys=take.slice(0, RAID_INV_CAP.keys);
      this.stash.keys=keep.concat(take.slice(RAID_INV_CAP.keys));
    } else {
      this.inv.keys=this.stash.keys.splice(0, RAID_INV_CAP.keys);
    }
    // 塔科夫式保险：为携带装备投保，阵亡后有几率退回
    const baseVal=this.carried.weapons.reduce((s,w)=>s+(w.value||0),0)
      +(this.carried.armor?(this.carried.armor.value||0):0)
      +(this.carried.helmet?(this.carried.helmet.value||0):0)
      +(this.carried.shield?(this.carried.shield.value||0):0);
    this.carryVal=baseVal;   // 撤离费按带入装备估值浮动
    if(opts.insure && baseVal>0){
      const fee=Math.max(200, Math.round(baseVal*0.35));
      // 联机入口不再经过大厅的 canIns 检查，这里必须确认真的付得起，避免“0 元投保”。
      if((this.stash.creds||0) >= fee){
        this.insured=true;
        this.insuredVal=fee;
        this.stash.creds-=fee;
      }
    }
    // 把玩家选择带入的卢布 / GP 币从仓库搬进本局（阵亡即丢，撤离原样带回）
    {
      const cashIn2=Math.max(0, Math.min(Math.round(opts.cash||0), Math.floor(this.stash.creds||0)));
      const tokIn2=Math.max(0, Math.min(Math.round(opts.tokens||0), Math.floor(this.stash.tokens||0)));
      if(cashIn2>0){ this.stash.creds-=cashIn2; this.creds=cashIn2; }
      if(tokIn2>0){ this.stash.tokens=Math.max(0,(this.stash.tokens||0)-tokIn2); this.tokens=tokIn2; }
      this.cashIn=cashIn2; this.tokensIn=tokIn2;
    }
    /* v0.21.2：初始装备包 = 明码标价的商品，不再是「带够现金白送」。
     * 只从**带入局内的卢布现金**里扣（不动仓库余额），钱不够就當作没勾选。 */
    this.supportPaid=0;
    if(opts.support && (this.creds||0) >= RAID_SUPPORT_CASH){
      this.creds -= RAID_SUPPORT_CASH;
      this.supportPaid = RAID_SUPPORT_CASH;
    }
    // 携带的装备已从仓库取出并保存，防刷新复制；记录是否真的落盘，供启动失败回滚判断。
    this._stashPersisted = RaidStash.save(this.stash);
    if(!this._stashPersisted) throw new Error("仓库写入失败（可能是 localStorage 已满）");

    // 只要带了任何一件装备（枪 / 甲 / 盔），就不再按「裸装」处理
    const carriedAny = this.carried.weapons.length>0 || !!this.carried.armor || !!this.carried.helmet || !!this.carried.shield;

    // 携带装备估值 → 战利品品质浮动因子。
    // 带得越值钱，箱子里刷出高等级 / 高稀有度物品的概率越高；裸装进场则大幅下降。
    this.carriedValue=baseVal;
    // 即使带满配高价值装备入场，品质加成也被压到最多 +55%（原为最高 +93%）
    this.lootLuck = (1 - Math.exp(-baseVal/62000)) * 0.55;   // 30k≈0.21, 100k≈0.44, 裸装=0
    // 带了东西就给一个最低运气档（≈估值 ₽7000），不再顶着「裸装」标签刷最低阶箱子
    if(carriedAny) this.lootLuck = Math.max(this.lootLuck, RAID_LUCK_FLOOR);

    // 携带装备越强，AI 入场装备也越强。
    // gearStrength 归一化：0 = 真空手，≈0.5 = 常规配装，≈1.0 = 满配（ilvl45 + T8 甲 + T8 盔）
    let gIlvlSum=0, gn=0;
    for(const w of this.carried.weapons){ if(w.ilvl){ gIlvlSum+=w.ilvl; gn++; } }
    const avgIlvl = gn ? gIlvlSum/gn : 0;
    const aTier = (this.carried.armor && this.carried.armor.tier) || 0;
    const hTier = (this.carried.helmet && this.carried.helmet.tier) || 0;
    let gs = (avgIlvl/45)*0.5 + (aTier/8)*0.3 + (hTier/8)*0.2;
    // 带装备即脱离裸装档：即便只带一把破手枪，AI 也按「常规配装」起步
    if(carriedAny) gs = Math.max(gs, RAID_GEAR_BASE);
    this.gearStrength = M.clamp(gs, 0, 1.6);
    /* v0.32.0（用户要求）：连续三把撤离失败开始补偿 —— 连败 3 把给 1 层，
       之后每多败一把 +1，封顶 6 层。箱子运气 +，敌人血量略降。 */
    this.pity = M.clamp(((this.stash.lossStreak|0)||0) - 2, 0, 6);

    // 出生点不再固定卡车停车场 —— 全图 3×3 分区抽取，避免每局都从左上角开跑
    const spawnRoom=this._pickSpawnRoom();
    this.spawnRoomId=spawnRoom.id;
    // _buildShops 早于 player 创建，先把出生区中心记下来给「起点补给点」用
    this.spawnPoint={ x:spawnRoom.x+spawnRoom.w/2, y:spawnRoom.y+spawnRoom.h/2 };
    this._buildMap();
    this.containers=[]; this._spawnContainers();

    const sp=this._spawnSafePoint(spawnRoom.x+spawnRoom.w/2, spawnRoom.y+spawnRoom.h/2, 24);
    const px=sp.x, py=sp.y;
    const prim=this.carried.weapons[0];
    const sec=this.carried.weapons[1];
    this._rtCache={};                       // 多枪切换共用的运行时缓存
    this.player=new RaidOperator({
      id:"you", name:"你", isPlayer:true, x:px, y:py, angle:-Math.PI/2,
      speed:184, hp:100, color:"#4fd6ff",
      gun: prim?this._rtGun(prim):null,      // 裸装进场：真的空手，靠局内搜刮捡枪
      secondary: sec?this._rtGun(sec):null,
      armor: this.carried.armor?this.carried.armor.maxArmor:0,
      dr: this.carried.armor?this.carried.armor.dr:0,
      armorTier: this.carried.armor?this.carried.armor.tier:0,
      armorRegen: this.carried.armor?(this.carried.armor.armorRegen||0):0,
      helmetArmor: this.carried.helmet?this.carried.helmet.maxArmor:0,
      helmetDr: this.carried.helmet?this.carried.helmet.dr:0,
      helmetTier: this.carried.helmet?this.carried.helmet.tier:0,
      // v0.16.0：护盾装备 → 容量 / 充能速度 / 充能延迟 / 破盾无敌 / 独特加成
      shieldGear: this.carried.shield||null,
      shield: this.carried.shield?this.carried.shield.capacity:0,
      shieldRate: this.carried.shield?this.carried.shield.rate:0,
      shieldDelay: this.carried.shield?this.carried.shield.delay:0,
      shieldInvulnBase: this.carried.shield?this.carried.shield.invuln:0,
      /* v0.25.0：Ti 护盾的破盾无敌有局内次数上限 = 2^T（见 RaidOperator 构造） */
      shieldTier: this.carried.shield?(this.carried.shield.tier||0):0,
      shieldPerks: this.carried.shield?(this.carried.shield.perks||[]).slice():[],
    });

    // v0.20.0：把仓库里的子弹搬进本局并给枪上膛（必须在 player 建好之后）
    this._prepPlayerAmmo(opts);
    this._dropStarterCache(px, py);
    this._dropSupportCache(px, py);
    if(typeof RaidStash!=="undefined" && RaidStash.save) RaidStash.save(this.stash);

    // AI：补满服务器 —— 只有房主（或单机）生成 AI；客户端等房主快照
    this.ops=[this.player];
    // 入场携带的武器也纳入物品栏统一管理（据此计算容量上限）
    for(const it of this.carried.weapons) this.inv.weapons.push(it);
    const hostSim = !this.online || (typeof Net==="undefined") || Net.isHost;
    if(hostSim){
      /* v0.30.0：名称池扩充（各 18 个）—— 同一局里 AI 兵牌很少重名，交火时更好分辨。 */
      const pmcNames=[
        "USEC·猎犬","BEAR·雪松","USEC·游骑兵","BEAR·极地","PMC·审判者","PMC·铁锤",
        "USEC·渡鸦","BEAR·狼獾","USEC·夜枭","BEAR·铁砧","PMC·刀锋","PMC·墙盾",
        "USEC·回声","BEAR·冻土","USEC·灰隼","BEAR·镰刀","PMC·钟摆","PMC·灰狼",
      ];
      const scavNames=[
        "破烂王·瓦夏","赌徒·谢尔盖","醉汉·鲍里斯","老猎人·米沙","暴躁哥·尤拉","捡漏的·科利亚",
        "独眼·格里沙","瘸腿·彼得","耳鸣·伊万","快手·安东","老烟枪·费佳","哑巴·萨沙",
        "扒手·廖沙","铁胃·瓦洛佳","胆小鬼·科斯佳","锅炉工·斯捷潘","守夜人·阿尔乔姆","浪人·季马",
      ];
      const colors=["#e06a4a","#e0b84a","#b06ae0","#4ae0a0","#e04a8a","#7a9be0","#d0d04a","#4ac0d0","#d06a6a"];
      // AI 全图刷 —— 取消"只刷在距玩家>620px 房间"的限制，
      // 改为先构建全图候选生成点池（房间内部点 + 院子/道路室外点），再均匀挑选，
      // 让整张地图（含玩家附近的房间与街道）都散布 AI，而不是只在最远端扎堆。
      const cand=[];
      for(const r of RAID_ROOMS){
        if(r.extract || r.id===spawnRoom.id) continue;
        for(let t=0;t<3;t++){
          const raw=this._openPointInRoom(r, 78);
          const pt=this._spawnSafePoint(raw.x, raw.y, 16);
          if(!this._blockedAt(pt.x,pt.y,15)) cand.push({x:pt.x,y:pt.y});
        }
      }
      // 室外：院子与道路安全点，让荒野、街道也有 AI 巡逻
      for(const yd of this.yards){
        for(let t=0;t<2;t++){
          const x=yd.x+RNG.fr(28,Math.max(29,yd.w-28)), y=yd.y+RNG.fr(28,Math.max(29,yd.h-28));
          const pt=this._spawnSafePoint(x,y,16);
          if(!this._blockedAt(pt.x,pt.y,15) && M.dist(pt.x,pt.y,px,py)>200) cand.push({x:pt.x,y:pt.y});
        }
      }
      for(const rd of this.roads){
        if(rd.w<70||rd.h<70) continue;
        const x=rd.x+RNG.fr(24,Math.max(25,rd.w-24)), y=rd.y+RNG.fr(24,Math.max(25,rd.h-24));
        const pt=this._spawnSafePoint(x,y,16);
        if(!this._blockedAt(pt.x,pt.y,15) && M.dist(pt.x,pt.y,px,py)>200) cand.push({x:pt.x,y:pt.y});
      }
      // Fisher–Yates 打乱，保证每局抽样点不同
      for(let i=cand.length-1;i>0;i--){ const j=RNG.ri(0,i); const tmp=cand[i]; cand[i]=cand[j]; cand[j]=tmp; }
      // 两遍挑选：先要求距玩家 ≥ MIN_DIST（不贴脸），挑不够再放宽到 430，保证全图都能铺满
      const MIN_DIST=620, SEP=118;   // AI 视野提到 1000，出生点最近的 AI 也拉开到 620 以外
      const slots=[];
      const _pick=(minD)=>{
        for(const c of cand){
          if(M.dist(c.x,c.y,px,py)<minD) continue;
          let clash=false;
          for(const s of slots){ if(M.dist(s.x,s.y,c.x,c.y)<SEP){ clash=true; break; } }
          if(clash) continue;
          slots.push(c);
          if(slots.length>=36) break;
        }
      };
      _pick(MIN_DIST);
      if(slots.length<30) _pick(430);

      /* v0.27.0：POI 驻守小队 —— 让「哪里必有人」变成可学习的知识。
         8 个 POI 各驻一支 2~4 人小队（共享 squadId，第一名是队长），
         剩余名额仍是全图散布的游荡者，保留随机性。
         小队抱团逻辑（raid-core2 的 squadId 分支）早就写好了，之前只是刷怪时
         从没填过 squadId，所以所有人都变成了纯游荡。 */
      const guards=[];
      let guardBudget=Math.min(18, 30-12);      // 最多 18 人驻守，至少留 12 名游荡者
      for(const poi of RAID_POI){
        if(!poi.box || guardBudget<=0) continue;
        const n=Math.min(guardBudget, RNG.ri(2,4));
        guardBudget-=n;
        this._squadN=(this._squadN||0)+1;
        const sid="sq"+this._squadN;
        const inset=Math.max(28, Math.min(96, Math.min(poi.box.w,poi.box.h)*0.22));
        for(let k=0;k<n;k++){
          const raw=this._openPointInRoom(poi.box, inset);
          const safe=this._spawnSafePoint(raw.x, raw.y, 18);
          const pt={
            x:M.clamp(safe.x, poi.box.x+18, poi.box.x+poi.box.w-18),
            y:M.clamp(safe.y, poi.box.y+18, poi.box.y+poi.box.h-18),
          };
          guards.push({pt, sid, leader:k===0, poi:poi.id});
        }
      }
      /* 驻守队员先占名额，游荡者只补剩下的 */
      const list=guards.slice();
      const wanderN=Math.max(0, 30-guards.length);
      for(let i=0;i<Math.min(wanderN, slots.length);i++) list.push({pt:slots[i]});
      const total=list.length;
      for(let i=0;i<total;i++){
        const entry=list[i], pt=entry.pt;
        const isPMC=RNG.chance(0.36);
        let gun, hp, speed, armor, dr, armorTier, helmetArmor, helmetDr, helmetTier;
        let smart=false, creds=RNG.ri(20,70), lootLimit=4;
        // 携带装备越强，AI 入场装备也越强
        const gs=this.gearStrength||0;                // 0（裸装）~ 1.0（满配）
        const gIlvl=Math.round(gs*8);                 // 枪械等级 +0 ~ +8
        const gArmor=gs>=0.30?Math.round(gs*gs*7):0;   // 护甲/头盔 tier 抬 0 ~ +7（平方曲线，低强度几乎不抬）
        if(isPMC){
          // v1.0：PMC 也从低配起步，靠搜刮升级；30% 为「Raider」（更聪明、会优先抢好箱）
          smart = RNG.chance(0.45);
          if(smart){
            const gid=RNG.pick(["rifle","smg","sniper","rifle"]);
            gun=blGunGen(RNG.ri(11,15)+gIlvl,{type:gid});
            hp=100; speed=RNG.fr(142,160);
            armorTier=RNG.chance(0.75)?Math.min(8,RNG.ri(3,5)+gArmor):(gs>1.0?Math.min(6,RNG.ri(2,4)+gArmor):0);
            helmetTier=armorTier?Math.min(8,RNG.ri(2,4)+gArmor):0;
            creds=RNG.ri(150,400); lootLimit=5;
          } else {
            const gid=RNG.pick(["pistol","smg","pistol","shotgun"]);
            gun=blGunGen(RNG.ri(6,10)+gIlvl,{type:gid});
            hp=100; speed=RNG.fr(135,152);
            armorTier=RNG.chance(0.40+gs*0.08)?Math.min(7,RNG.ri(1,2)+gArmor):0;
            helmetTier=0;
            lootLimit=3;
          }
          armor=armorTier?RAID_ARMORS[armorTier].maxArmor:0;
          dr=armorTier?RAID_ARMORS[armorTier].dr:0;
          helmetArmor=helmetTier?RAID_HELMETS[helmetTier].maxArmor:0;
          helmetDr=helmetTier?RAID_HELMETS[helmetTier].dr:0;
        } else {
          // Scav：塔科夫拾荒者只拿低阶武器。玩家携带再强也不会抬高他们的枪械等级，
          // 只会让他们更常带枪（0.72 → 0.90），不会变成高穿深 PMC。
          const gid=RNG.pick(["pistol","shotgun","smg","pistol"]);
          gun=RNG.chance(0.72+Math.min(0.18,gs*0.10)) ? raidScavGun(RNG.ri(2,7),{type:gid}) : null;
          hp=RNG.ri(70,95); speed=RNG.fr(115,140);
          armorTier=RNG.chance(0.20+gs*0.08)?Math.min(SCAV_ARMOR_TIER_MAX,RNG.ri(1,2)):0;
          armor=armorTier?RAID_ARMORS[armorTier].maxArmor:0;
          dr=armorTier?RAID_ARMORS[armorTier].dr:0;
          helmetTier=0; helmetArmor=0; helmetDr=0;
          creds=RNG.ri(10,40); lootLimit=2;
        }
        // 携带装备强 → 更多 AI 带装备进场（不再一半人空手巡逻）
        if(!smart && !RNG.chance(0.45+gs*0.18)) lootLimit=0;
        // 满配入场（gearStrength 高）时，强制全员带枪带甲，避免一身神装却全是裸装杂兵；
        // Scav 仍然只拿低阶枪、低阶甲，不参与 PMC 的装备膨胀。
        if(gs>0.72){
          if(!gun){
            const gid=RNG.pick(["pistol","smg","shotgun"]);
            gun=isPMC ? blGunGen(RNG.ri(6,10)+gIlvl,{type:gid}) : raidScavGun(RNG.ri(3,7),{type:gid});
          }
          if(armorTier<2){
            armorTier=isPMC ? 2 : Math.min(SCAV_ARMOR_TIER_MAX,2);
            armor=RAID_ARMORS[armorTier].maxArmor; dr=RAID_ARMORS[armorTier].dr;
          }
          if(isPMC && helmetTier<1){ helmetTier=1; helmetArmor=RAID_HELMETS[helmetTier].maxArmor; helmetDr=RAID_HELMETS[helmetTier].dr; }
        }
        /* v0.14.11：约 1/5 的 PMC 固定编为「护盾兵」——轻甲 + 能量护盾（蓝色血条）。
         * 保证电击 ×2.00 每局都有够多的明确目标，同时把 T4+ 重甲留给黄色装甲条，
         * 避免「护盾优先级盖掉黄条」把用户要的装甲型藏起来。 */
        let shieldVal=0;
        if(isPMC && RNG.chance(0.22)){
          armorTier=Math.min(armorTier||2, 3);
          armor=armorTier?RAID_ARMORS[armorTier].maxArmor:0;
          dr=armorTier?RAID_ARMORS[armorTier].dr:0;
          shieldVal=Math.round(45+armorTier*10+gs*20);
        } else if(smart && armorTier>0 && armorTier<RAID_ARMOR_TYPE_TIER){
          shieldVal=Math.round(30+armorTier*7+gs*18);
        }
        const op=new RaidOperator({
          id:"op"+i, cls:isPMC?"pmc":"scav",
          name:(smart?"★ ":"")+(isPMC?(pmcNames[i%pmcNames.length]):(scavNames[i%scavNames.length])),
          x:pt.x, y:pt.y, angle:RNG.fr(0,6.28),
          speed, hp, color:isPMC?colors[i%4]:colors[4+(i%5)],
          gun, armor, dr, armorTier, helmetArmor, helmetDr, helmetTier,
          shield: shieldVal,
          /* v0.25.0：AI 的护盾同样吃 2^i 次上限 —— 护盾底材等级按护甲等级取（上限 T3），
             否则玩家造出高阶盾、AI 却是无限无敌，规则不一致。
             AI 的 shieldInvulnBase 本来就是 0（破盾不给无敌），所以这里只是把配额
             记账接上，不额外给它们加无敌时间。 */
          shieldTier: shieldVal>0 ? M.clamp(armorTier||1,1,3) : 0,
          smart, creds, lootLimit,
        });
        /* v0.27.0：驻守队员带小队标记与归属 POI；游荡者 entry.sid 为空，行为不变。 */
        if(entry.sid){ op.squadId=entry.sid; op.isLeader=!!entry.leader; op.homePoi=entry.poi; }
        /* v0.39.0：连败补偿 —— 敌人血量最多降 21%（6 层 ×3.5%），不削伤害 */
        if(this.pity){
          op.hp=Math.max(1, Math.round(op.hp*(1-this.pity*0.035)));
          op.maxHP=op.hp;
        }
        /* v0.39.0：把「改变玩家走位」的两种角色编进常规 PMC —— 约 8% 狙击手 / 7% 医疗兵。
         * 只从 PMC 里出（Scav 是拾荒者，不该有战术分工）；驻守队（entry.sid）不替换，
         * 免得整支小队都变成同一个角色。 */
        if(isPMC && !entry.sid && RNG.chance(0.15)){
          const spec=RNG.chance(0.53)?"sniper":"medic", sp=RAID_ARCH[spec];
          op.arch=spec; op.name=op.name+"·"+sp.label; op.r=sp.r; op.speed=sp.speed;
          op.maxHP=Math.round(op.maxHP*sp.hpMul/2.4); op.hp=op.maxHP;
          if(spec==="sniper"){
            const sg=blGunGen(15,{type:"sniper",rarity:"purple"});
            sg.uid=this._uid(); sg.kind="weapon";
            op.gun=sg; sg.ammoMag=sg.mag; sg.ammoRes=sg.reserve;
          }
        }
        /* v0.39.0：精英随机词条 —— 精锐（名字带 ★）有 20% 带 1 条词条 */
        if(op.smart && RNG.chance(0.20)) this._applyEliteAffixes(op, 1);
        this.ops.push(op);
      }

      // Boss：3 名精锐，掉落保底好枪 + 带词条配件，HUD 高亮
      /* v0.27.0：改用原创代号。之前直接沿用了另一部撤离射击作品的三名 Boss 名，
         既不是本作设定，也让「边境行动」的世界观寄生在别人 IP 上。 */
      const bountyNames=["铁锈","屠夫","调度长","煤矿","钟楼","老账房","毒蜂","压路机"];
      const bountyRooms=["factory","village","dock","temple","depot"];
      const bountyOrder=bountyRooms.map(id=>RAID_ROOMS.find(r=>r.id===id)).filter(Boolean)
        .sort((a,b)=>M.dist(b.x+b.w/2,b.y+b.h/2,px,py)-M.dist(a.x+a.w/2,a.y+a.h/2,px,py));
      const bountyFallback=RAID_ROOMS.filter(r=>!r.extract);
      for(let b=0;b<3;b++){
        const rm=(bountyOrder.length ? bountyOrder[b%bountyOrder.length] : null)
          || (bountyFallback.length ? bountyFallback[b%bountyFallback.length] : null)
          || RAID_ROOMS[0];
        if(!rm) continue;
        const rawB=this._openPointInRoom(rm, 80);
        const pt=this._spawnSafePoint(rawB.x, rawB.y, 18);
        const g=blGunGen(RNG.ri(13,17),{type:RNG.pick(["rifle","sniper","smg"]), rarity:"purple"});
        g.uid=this._uid(); g.kind="weapon";
        const at=RNG.pick([7,7,8]), ht=RNG.pick([6,7,7]);
        this.ops.push(new RaidOperator({
          id:"bounty"+b, cls:"pmc", bounty:true,
          name:bountyNames[b],
          x:pt.x, y:pt.y, angle:RNG.fr(0,6.28),
          speed:RNG.fr(140,160), hp:RNG.ri(180,240), color:"#ff5c5c",
          gun:g, armor:RAID_ARMORS[at].maxArmor, dr:RAID_ARMORS[at].dr, armorTier:at,
          helmetArmor:RAID_HELMETS[ht].maxArmor, helmetDr:RAID_HELMETS[ht].dr, helmetTier:ht,
          // Boss 保持 T7/T8 黄色装甲条（腐蚀克制），不叠护盾层
          smart:true, creds:RNG.ri(380,850), lootLimit:7,
        }));
      }

    }

    /* v0.23.0：POI 专属精英怪。只在该 POI 的包围盒内出生，全图其他地方不出现 ——
       这让 8 个 POI 各自有「招牌威胁」，「要不要进这个 POI」才成为真决策。
       数量由 RAID_POI[].elites 决定（合计 10 只），普通 AI 仍是 30 + Boss 3。 */
    for(const poi of RAID_POI){
      const spec=RAID_ARCH[poi.elite];
      if(!spec || !poi.box) continue;
      /* v0.35.0（用户反馈「建筑/设施重叠、要更具特色」）：
         不再把单个巨物放在 POI 合并框中心（rail/factory 是多个不相连建筑群的并集，
         中心会落在建筑之间的空地），改为按**每个房间内部**做非重叠装箱，
         把该 POI 的主题装饰清单（RAID_POI_DECOR）一件件摆进去。
         大件先放、小件后放、多个房间分摊 —— 每个建筑因此都有自己的一套特征物，
         且彼此/与墙体/与战利品箱都不会重叠。仍走 _pushProp，2D/3D/碰撞/视线/光照一致。 */
      const DECOR=(typeof RAID_POI_DECOR!=="undefined") ? RAID_POI_DECOR[poi.id] : null;
      if(DECOR && poi.rooms){
        for(const rid of poi.rooms){
          const rm=RAID_ROOMS.find(r=>r.id===rid);
          if(!rm) continue;
          // placed 按房间独立：不同房间是各自独立的建筑，彼此不该互相挡位
          // （damCtrl 与 damGate 只隔 ~50px，共享 placed 会把隔壁房间的装饰误判成遮挡）
          const placed=[];
          for(const item of DECOR){
            const pos=this._fitDecorInRoom(rm, item, placed, 12);
            if(!pos) continue;
            this._pushProp({ kind:item.kind, w:item.w, h:item.h, fill:item.fill, edge:item.edge, decor:true },
                           pos.x, pos.y);
            placed.push({x:pos.x, y:pos.y, w:item.w, h:item.h});
          }
        }
      }
      const n=poi.elites||1;
      for(let i=0;i<n;i++){
        /* 内缩量按包围盒短边自适应：神庙这种 360×300 的小 POI 用 96 内缩只剩
           168×108 的可用区，_spawnSafePoint 很容易把点推到盒外（成立后就不算「POI 专属」了）。 */
        const inset=Math.max(28, Math.min(96, Math.min(poi.box.w, poi.box.h)*0.22));
        const raw=this._openPointInRoom(poi.box, inset);
        const safe=this._spawnSafePoint(raw.x, raw.y, 22);
        // 兜底夹回包围盒：宁可贴着墙出生，也不让精英怪跑到别的区域去
        const pt={
          x:M.clamp(safe.x, poi.box.x+18, poi.box.x+poi.box.w-18),
          y:M.clamp(safe.y, poi.box.y+18, poi.box.y+poi.box.h-18),
        };
        const gtype = poi.elite==="shieldbearer" ? "shotgun" : "rifle";
        const g=blGunGen(RNG.ri(13,17), {type:gtype, rarity:"purple"});
        g.uid=this._uid(); g.kind="weapon";
        const at=spec.armorTier||0, ht=spec.helmetTier||0;
        const eliteOp=new RaidOperator({
          id:"poi-"+poi.id+"-"+i, cls:"pmc", bounty:false,
          name:"★ "+spec.label, arch:poi.elite,
          x:pt.x, y:pt.y, angle:RNG.fr(0,6.2832), r:spec.r,
          speed:spec.speed, hp:Math.round(100*spec.hpMul), color:spec.color,
          gun:g,
          armor:at?RAID_ARMORS[at].maxArmor:0, dr:at?RAID_ARMORS[at].dr:0, armorTier:at,
          helmetArmor:ht?RAID_HELMETS[ht].maxArmor:0, helmetDr:ht?RAID_HELMETS[ht].dr:0, helmetTier:ht,
          smart:true, creds:RNG.ri(120,320), lootLimit:spec.lootLimit,
        });
        // 出生归属：他会追着玩家跑出包围盒，所以「是哪个 POI 的精英」只能记在出生时
        eliteOp.spawnPoi=poi.id;
        /* v0.39.0：POI 精英必定带词条（一号精英 2 条、其余 1 条）——
         * 「这个 POI 的招牌威胁」因此每局都不完全一样，但强度可控。 */
        this._applyEliteAffixes(eliteOp, i===0?2:1);
        this.ops.push(eliteOp);
      }
    }

    // 摄像机对准玩家
    this._ensureTacticalRoles();   // v0.39.0：每局至少各一名狙击手 / 医疗兵
    this.camera.x=px-game.view.w/(2*(game.zoom||1));
    this.camera.y=py-game.view.h/(2*(game.zoom||1));
    this._updateCamera(game);

    this._feed("系统", "PMC 已进入战区，小心 Scav 出没", "部署", false, "info");
    /* v0.22.2：本局开放的撤离点进图就告知（房主 seed 决定，两端一致），
       不用横穿大图到跟前才知道哪个出口没开。 */
    const openEx=(this.extracts||[]).filter(e=>!e.closed);
    if(openEx.length){
      const names=openEx.slice(0,5).map(e=>e.name).join(" / ");
      this._feed("撤离", "本局开放 "+openEx.length+" 处："+names+(openEx.length>5?" …":""), "部署", false, "info");
    }
    // 让玩家看懂「携带价值 → 战利品品质」的关系
    const lk=this.lootLuck;
    const lkTxt = !carriedAny ? "裸装进场，箱子多为低阶物资" :
                  lk<0.10 ? "轻装进场，战利品以低阶为主" :
                  lk<0.25 ? "轻装进场，战利品品质一般" :
                  lk<0.40 ? "重装进场，战利品略好一点" : "满配进场，战利品小幅提升";
    this._feed("战利品", lkTxt+"（携带估值 ₽"+priceText(this.carriedValue)+"）", "", false, lk>=0.40?"info":"warn");
    if(this.online && typeof Net!=="undefined") Net.attach(this, opts);
  },

  /* 房主掉线后由下一位玩家接管 AI。
   * 客户端原本只拿到 ghost 视觉快照；这里补齐模拟所需字段并把 gun 重建成可开火的运行时枪。 */
  promoteGhostsForHost(){
    if(!this.ops || !this.player) return 0;
    let n=0;
    for(const o of this.ops){
      if(!o || (!o.ghost && !o.isGhost)) continue;
      o.ghost=false; o.isGhost=false; o.isNet=false;
      o.isPlayer=false; o.remote=false;
      o.inv=o.inv||{ weapons:[], armors:[], helmets:[], parts:[], materials:[], meds:[], cores:[], receivers:[] };
      o.creds=o.creds||RNG.ri(20,80);
      o.lootLimit=o.lootLimit||(o.smart?9:4);
      o.lootCount=0; o.lootTarget=null; o.lootT=0; o._lootProg=null; o._lootDetour=null;
      o.aiT=RNG.f()*1.2; o._badT=0; o._badC=null; o._badPtT=0; o._badPt=null;
      o.armorTier=o.armorTier||0; o.helmetTier=o.helmetTier||0;
      // Scav 接管模拟时同样受低阶装备上限约束，不会因为房主迁移变成重甲兵。
      if(o.cls==="scav"){
        o.armorTier=Math.min(o.armorTier,SCAV_ARMOR_TIER_MAX);
        o.helmetTier=Math.min(o.helmetTier,SCAV_HELMET_TIER_MAX);
        o.maxShield=0; o.shield=0;
      }
      o.maxHelmetArmor=o.maxHelmetArmor||o.helmetArmor||0;
      o.helmetArmor=Math.min(o.helmetArmor||0, o.maxHelmetArmor);
      o.maxArmor=o.maxArmor||0; o.armor=Math.min(o.armor||0, o.maxArmor);
      o.armorBroken=o.armorBroken!==undefined?o.armorBroken:(o.maxArmor>0&&o.armor<=0);
      o.maxShield=o.maxShield||o.shield||0; o.shield=Math.min(o.shield||0,o.maxShield);
      o.speed=o.speed||150; o.r=o.r||14;
      o._dodgeT=0; o._dodgeSide=1; o._stuck=0;
      o.roamT=0; o.roamPt=null;
      o.state=o.state||"roam"; o.lastSeen=null; o.investigate=null;
      o.bandages=o.bandages||(o.smart?3:1); o.medT=0;
      o.fireCd=0; o.reloadT=0; o.kills=0; o.bleed=0;
      o.freezeT=0; o.burnT=0; o.burnDps=0; o.burnSrc=null;
      o.corrodeT=0; o.shockT=0; o.radT=0;   // v0.14.11：影子转真人时清掉残留元素状态
      o.squadId=null; o.isLeader=false; o.blockZone=null;
      o.tx=o.x; o.ty=o.y; o.ta=o.angle||0;
      if(o.gun && (!o.gun.mag || !o.gun.dmg)){
        const t=o.gun.type||"pistol";
        const g=o.cls==="scav"
          ? raidScavGun(RNG.ri(2,7), { type:SCAV_GUN_TYPES.includes(t)?t:"pistol" })
          : blGunGen(RNG.ri(8,14), { type:t, element:o.gun.element||"none" });
        g.ammoMag=g.mag; g.ammoRes=g.reserve;
        o.gun=g;
      } else if(o.gun){
        if(o.gun.ammoMag===undefined) o.gun.ammoMag=o.gun.mag;
        if(o.gun.ammoRes===undefined) o.gun.ammoRes=o.gun.reserve;
      }
      n++;
    }
    return n;
  },

  _roomById(id){ return RAID_ROOMS.find(r=>r.id===id); },

  /* 出生房：先按 3×3 分区随机一格，再在格内随机房间；避开撤离点附近，且尽量不连着两局同一个格 */
  _pickSpawnRoom(){
    const CW=RAID_MAP_W/3, CH=RAID_MAP_H/3;
    const cells={};
    for(const rm of RAID_ROOMS){
      if(rm.extract) continue;
      // 出生就贴着撤离点 = 白嫖，留出 450px 缓冲
      let nearExt=false;
      for(const e of RAID_ROOMS){
        if(!e.extract) continue;
        if(M.dist(rm.x+rm.w/2, rm.y+rm.h/2, e.x+e.w/2, e.y+e.h/2) < 450){ nearExt=true; break; }
      }
      if(nearExt) continue;
      const cx=M.clamp(Math.floor((rm.x+rm.w/2)/CW),0,2);
      const cy=M.clamp(Math.floor((rm.y+rm.h/2)/CH),0,2);
      const k=cy*3+cx;
      (cells[k]=cells[k]||[]).push(rm);
    }
    let keys=Object.keys(cells);
    if(!keys.length){
      const pool=RAID_ROOMS.filter(r=>!r.extract);
      return pool.length?RNG.pick(pool):RAID_ROOMS[0];
    }
    let k=RNG.pick(keys);
    if(keys.length>1 && this._lastSpawnCell===k){
      const alt=keys.filter(x=>x!==this._lastSpawnCell);
      if(alt.length) k=RNG.pick(alt);
    }
    this._lastSpawnCell=k;
    return RNG.pick(cells[k]);
  },
  _blockedAt(x,y,r){
    if(this._inWater(x,y)) return true;   // 河流不可驻留：出生点 / AI 目标点均避开水域
    const list=this._nearWalls?this._nearWalls(x,y,r):this.walls;
    for(let i=0;i<list.length;i++){
      const w=list[i];
      /* v0.36.0：六边形岩石按多边形算距离，尖角外不再有「看不见的直边」 */
      if(w.hexPoly){
        if(raidPolyDist(x,y,w.hexPoly) < r) return true;
        continue;
      }
      const nx=M.clamp(x,w.x,w.x+w.w), ny=M.clamp(y,w.y,w.y+w.h);
      if((x-nx)*(x-nx)+(y-ny)*(y-ny) < r*r) return true;
    }
    return false;
  },
  // 出生点可能正好压着家具：螺旋外扩找第一个空地，避免开局就卡在货架里
  /* 巡逻点预处理 —— 手写点位可能压在墙上或水里，统一推到最近的可站位置 */
  _buildPatrolPoints(){
    this.patrolPts=[];
    for(const p of RAID_PATROL){
      const s=this._spawnSafePoint(p[0], p[1], 18);
      this.patrolPts.push([s.x, s.y]);
    }
  },

  _spawnSafePoint(x,y,r){
    r=r||22;
    if(!this._blockedAt(x,y,r)) return {x:x,y:y};
    for(let ring=1;ring<=18;ring++){
      const rr=ring*16;
      for(let i=0;i<20;i++){
        const a=i/20*6.2832;
        const nx=x+Math.cos(a)*rr, ny=y+Math.sin(a)*rr;
        if(nx<r||ny<r||nx>RAID_MAP_W-r||ny>RAID_MAP_H-r) continue;
        if(!this._blockedAt(nx,ny,r)) return {x:nx,y:ny};
      }
    }
    return {x:x,y:y};
  },
  /* v0.35.0：主题装饰落点校验。矩形 (x,y,w,h) 是否已避开墙体 / 门廊走廊。
   * 旧版只对内缩 pad 的 9 个角点 + 长边中线做点采样（_blockedAt 还是 <r² 严格小于），
   * 墙若戳进外层 pad 环带就会漏判，导致 railcar 等贴墙大件与墙相交。
   * 改版：把候选矩形按 pad 外扩成 AABB，与每面墙 / 门廊做严格相交测试
   * （相交 ⟺ 净距 < pad，正好贴边放行），并复用 _nearWalls 空间索引保持构建速度。 */
  _rectClear(x,y,w,h,pad){
    pad=pad||12;
    const RX=x-pad, RY=y-pad, RW=w+2*pad, RH=h+2*pad;
    const cx=x+w*0.5, cy=y+h*0.5, rad=Math.max(w,h)*0.5+pad+30;
    const list=this._nearWalls?this._nearWalls(cx,cy,rad):this.walls;
    for(let i=0;i<list.length;i++){
      const wll=list[i];
      if(RX < wll.x+wll.w && RX+RW > wll.x && RY < wll.y+wll.h && RY+RH > wll.y) return false;
    }
    if(this.doorLanes) for(const L of this.doorLanes){
      if(RX < L.x+L.w && RX+RW > L.x && RY < L.y+L.h && RY+RH > L.y) return false;
    }
    // 水面：采样矩形 5 点，避免装饰压在水里（桥面/河流不布景）
    if(this._inWater(cx,cy) || this._inWater(x+4,y+4) || this._inWater(x+w-4,y+4) ||
       this._inWater(x+4,y+h-4) || this._inWater(x+w-4,y+h-4)) return false;
    return true;
  },
  /* v0.35.0：在单个房间内为一件装饰找不重叠的落点。
   * 候选点网格乱序后逐个试，避开：墙/门廊（_rectClear）、已放装饰、战利品箱。 */
  _fitDecorInRoom(rm, item, placed, pad){
    pad=pad||12;
    const inset=26;
    const x0=rm.x+inset, y0=rm.y+inset;
    const x1=rm.x+rm.w-inset-item.w, y1=rm.y+rm.h-inset-item.h;
    if(x1<x0 || y1<y0) return null;            // 房间装不下这件装饰
    const cands=[];
    for(let gy=y0; gy<=y1; gy+=10) for(let gx=x0; gx<=x1; gx+=10) cands.push([gx,gy]);
    for(let i=cands.length-1;i>0;i--){ const j=RNG.ri(0,i), t=cands[i]; cands[i]=cands[j]; cands[j]=t; }
    for(const c of cands){
      const gx=c[0], gy=c[1];
      if(!this._rectClear(gx,gy,item.w,item.h,pad)) continue;
      let clash=false;
      for(const r of placed){
        if(gx < r.x+r.w+pad && gx+item.w > r.x-pad && gy < r.y+r.h+pad && gy+item.h > r.y-pad){ clash=true; break; }
      }
      if(clash) continue;
      for(const ct of (this.containers||[])){
        if(gx < ct.x+44 && gx+item.w > ct.x-44 && gy < ct.y+44 && gy+item.h > ct.y-44){ clash=true; break; }
      }
      if(clash) continue;
      return {x:gx, y:gy};
    }
    return null;
  },
  _openPointInRoom(rm, inset){
    inset=inset||60;
    // 避开门廊与墙体：箱子不再生成在门洞正中间卡住出入口
    for(let k=0;k<26;k++){
      const x=RNG.fr(rm.x+inset, Math.max(rm.x+inset+1, rm.x+rm.w-inset));
      const y=RNG.fr(rm.y+inset, Math.max(rm.y+inset+1, rm.y+rm.h-inset));
      let bad=false;
      for(const L of this.doorLanes){
        if(x>L.x-6&&x<L.x+L.w+6&&y>L.y-6&&y<L.y+L.h+6){ bad=true; break; }
      }
      if(!bad){
        for(const w of this.walls){
          if(x>w.x-22&&x<w.x+w.w+22&&y>w.y-22&&y<w.y+w.h+22){ bad=true; break; }
        }
      }
      if(!bad) return {x:x,y:y};
    }
    return { x:rm.x+rm.w/2, y:rm.y+rm.h/2 };
  },

  _applyLoadout(opts){
    this.carried={ weapons:[], armor:null, helmet:null, shield:null };
    for(const uid of (opts.weapons||[])){
      const i=this.stash.weapons.findIndex(w=>w.uid===uid);
      if(i>=0){ this.carried.weapons.push(this.stash.weapons.splice(i,1)[0]); }
      if(this.carried.weapons.length>=4) break;   // 手持 1 + 副手 1 + 背包 2
    }
    if(opts.armor){
      const i=this.stash.armors.findIndex(a=>a.uid===opts.armor);
      if(i>=0) this.carried.armor=this.stash.armors.splice(i,1)[0];
    }
    if(opts.helmet){
      const i=this.stash.helmets.findIndex(h=>h.uid===opts.helmet);
      if(i>=0) this.carried.helmet=this.stash.helmets.splice(i,1)[0];
    }
    if(opts.shield){
      this.stash.shields=this.stash.shields||[];
      const i=this.stash.shields.findIndex(s=>s.uid===opts.shield);
      if(i>=0) this.carried.shield=ensureShield(this.stash.shields.splice(i,1)[0]);
    }
  },

  /* ----------------------------- 地图构建 ----------------------------- */
  _hash2(x,y){
    let h=(Math.imul(x|0,374761393)+Math.imul(y|0,668265263))|0;
    h=Math.imul(h^(h>>>13),1274126177);
    return ((h^(h>>>16))>>>0)/4294967296;
  },
  _hitRect(a,b,pad){
    pad=pad||0;
    return a.x-pad<b.x+b.w && a.x+a.w+pad>b.x && a.y-pad<b.y+b.h && a.y+a.h+pad>b.y;
  },
  // 房间某一侧到最近邻房间的净空：决定门开在哪，绝不把门开在隔壁墙上
  _roomGap(rm,dir){
    const mx=rm.x+rm.w/2, my=rm.y+rm.h/2;
    let best=460;
    for(const o of RAID_ROOMS){
      if(o.id===rm.id) continue;
      if(dir==="right"){
        if(my>o.y-6 && my<o.y+o.h+6 && o.x>=rm.x+rm.w) best=Math.min(best,o.x-(rm.x+rm.w));
      } else if(dir==="left"){
        if(my>o.y-6 && my<o.y+o.h+6 && o.x+o.w<=rm.x) best=Math.min(best,rm.x-(o.x+o.w));
      } else if(dir==="bottom"){
        if(mx>o.x-6 && mx<o.x+o.w+6 && o.y>=rm.y+rm.h) best=Math.min(best,o.y-(rm.y+rm.h));
      } else {
        if(mx>o.x-6 && mx<o.x+o.w+6 && o.y+o.h<=rm.y) best=Math.min(best,rm.y-(o.y+o.h));
      }
    }
    return best;
  },

  _buildMap(){
    this.walls=[]; this.props=[]; this.extracts=[]; this.roomRects=[];
    this.roomDecor=[]; this.skybridges=[]; this.railBridges=[];   // v0.31.0 建筑结构 / 连廊 / 铁路桥
    this.doorLanes=[]; this.doorInner=[];     this.roads=[]; this.yards=[]; this.sheds=[]; this._navQ=0;
    this.shops=[];   // 局内商店摊位（枪店 / 材料店 / 回收超市 / 黑市）
    this.gadgets=[]; // 可互动设施（医疗站 / 弹药箱 / 泄洪闸）
    this.grounds=[]; // 背包溢出后落在地上的物品堆（独立数组，不打乱联机用的箱子索引）
    this._pickHold=null;  // v0.24.0：地面装备长按判定状态，跨局必须清空
    // 生态数据（供碰撞 / 渲染 / 小地图共用）
    this.waterCircles=[]; this.bridges=[]; this.forests=[]; this.rails=[]; this.railCars=[];
    const TH=16;
    const addWall=(x,y,w,h)=>{ if(w>0.5&&h>0.5) this.walls.push({x,y,w,h,kind:"wall"}); };

    for(const rm of RAID_ROOMS){
      rm._doors=[];
      /* open（操场 / 广场 / 坝顶这类开放场地）不砌围墙、不开门，
         只作为地面区域参与摆放与刷箱，避免把「院子」做成密不透风的方盒子。 */
      if(rm.open){
        this.roomRects.push(rm);
        if(rm.extract){
          const rule=RAID_EXTRACT_RULES[rm.id]||{ need:7, cost:0, openChance:1 };
          const closed = RNG.f() >= rule.openChance;
          this.extracts.push({ x:rm.x+30, y:rm.y+30, w:rm.w-60, h:rm.h-60,
            name:rm.name, id:rm.id, need:rule.need, cost:rule.cost, feeRate:rule.feeRate||0, closed,
            note:closed?("已关闭，"+rule.note):rule.note });
        }
        continue;
      }
      /* 门：按「外部净空」从大到小挑 2~3 侧开门。
         旧版每间只开 1 扇 92px 的门，且门可能正对隔壁外墙 —— 玩家和 AI 全卡在门口。 */
      const g={ top:this._roomGap(rm,"top"), bottom:this._roomGap(rm,"bottom"),
                left:this._roomGap(rm,"left"), right:this._roomGap(rm,"right") };
      // 优先「对穿」两扇门（前后门），房间结构才完整；两侧都不通时退回单门
      const pairs=[{d:["top","bottom"], s:g.top+g.bottom},{d:["left","right"], s:g.left+g.right}]
        .sort((a,b)=>b.s-a.s);
      const doors={};
      for(const k of pairs[0].d){ if(g[k]>=96) doors[k]=true; }
      if(!Object.keys(doors).length){
        const best=["top","bottom","left","right"].sort((a,b)=>g[b]-g[a])[0];
        doors[best]=true;
      }

      const side=(dir)=>{
        const horiz = dir==="top"||dir==="bottom";
        const from  = horiz ? rm.x : rm.y;
        const to    = horiz ? rm.x+rm.w : rm.y+rm.h;
        const fixed = dir==="top" ? rm.y : dir==="bottom" ? rm.y+rm.h-TH
                    : dir==="left"? rm.x : rm.x+rm.w-TH;
        const len=to-from;
        if(!doors[dir]){
          if(horiz) addWall(from, fixed, len, TH);
          else addWall(fixed, from, TH, len);
          return;
        }
        // 门洞最小 104px：玩家直径 30，留足两人并排 / AI 侧身通过的空间
        const gap=Math.round(Math.min(152, Math.max(104, len*0.44)));
        const mid=(from+to)/2;
        const a2=mid-gap/2, b1=mid+gap/2;
        if(horiz){
          if(a2>from) addWall(from, fixed, a2-from, TH);
          if(to>b1) addWall(b1, fixed, to-b1, TH);
        } else {
          if(a2>from) addWall(fixed, from, TH, a2-from);
          if(to>b1) addWall(fixed, b1, TH, to-b1);
        }
        // 门口走廊：装饰物一律回避，保证「门→户外」永远有一条净空通道
        if(dir==="top")         this.doorLanes.push({x:mid-gap/2-34, y:rm.y-180,       w:gap+68, h:180});
        else if(dir==="bottom") this.doorLanes.push({x:mid-gap/2-34, y:rm.y+rm.h,      w:gap+68, h:180});
        else if(dir==="left")   this.doorLanes.push({x:rm.x-180,      y:mid-gap/2-34,  w:180,    h:gap+68});
        else                    this.doorLanes.push({x:rm.x+rm.w,     y:mid-gap/2-34,  w:180,    h:gap+68});
        rm._doors.push({ dir:dir, mid:mid, gap:gap });
        // 门内禁区：室内家具不得堵在门口
        if(dir==="top")         this.doorInner.push({x:mid-gap/2-20, y:rm.y+TH,          w:gap+40, h:74});
        else if(dir==="bottom") this.doorInner.push({x:mid-gap/2-20, y:rm.y+rm.h-TH-74, w:gap+40, h:74});
        else if(dir==="left")   this.doorInner.push({x:rm.x+TH,       y:mid-gap/2-20,  w:74,     h:gap+40});
        else                    this.doorInner.push({x:rm.x+rm.w-TH-74, y:mid-gap/2-20, w:74,    h:gap+40});
        // 门外铺装（纯视觉）：远处也能一眼看出哪面墙有门
        const roadW=Math.max(72, gap-8);
        if(dir==="top")         this.roads.push({x:mid-roadW/2, y:rm.y-210,     w:roadW, h:210});
        else if(dir==="bottom") this.roads.push({x:mid-roadW/2, y:rm.y+rm.h,    w:roadW, h:210});
        else if(dir==="left")   this.roads.push({x:rm.x-210,    y:mid-roadW/2,  w:210,   h:roadW});
        else                    this.roads.push({x:rm.x+rm.w,   y:mid-roadW/2,  w:210,   h:roadW});
      };

      side("top"); side("bottom"); side("left"); side("right");
      /* v0.31.0：非矩形建筑结构（L 形 / U 形 / 回字中庭 / 十字 / 废墟 / 角楼 / 附楼）。
         只往房间里加「带通道的内墙」，外墙与门洞仍由 side() 全权负责，
         因此 doorLanes / 刷怪 / 商店选点 / AI 寻路全部不受影响。 */
      const st=(typeof raidRoomStructure==="function") ? raidRoomStructure(rm) : null;
      if(st){
        for(const b of (st.walls||[])){
          let blocked=false;
          for(const L of this.doorInner){ if(this._hitRect(b,L,8)){ blocked=true; break; } }
          if(!blocked) addWall(b.x,b.y,b.w,b.h);
        }
        for(const d of (st.deco||[])) this.roomDecor.push(Object.assign({ room:rm.id }, d));
        rm._shape=rm.shape||"rect";
      }
      this.roomRects.push(rm);
      if(rm.extract){
        const rule=RAID_EXTRACT_RULES[rm.id]||{ need:7, cost:0, openChance:1 };
        const closed = RNG.f() >= rule.openChance;   // 铁路隧道每局掷签
        this.extracts.push({ x:rm.x+30, y:rm.y+30, w:rm.w-60, h:rm.h-60,
          name:rm.name, id:rm.id, need:rule.need, cost:rule.cost, feeRate:rule.feeRate||0, closed,
          note:closed?("已关闭，"+rule.note):rule.note });
      }
    }

    /* v0.22.2：每个 3×3 行政区保底 1 个开放撤离点。
     * openChance 最低 0.5，整片区域的出口可能全被掷成关闭 —— 玩家横穿大图
     * 到跟前才发现没路走，这是「跑远路没回报」最刺眼的一种。强制开最靠区中心的那个。 */
    const zoneOf=(e)=>{
      const gx=M.clamp(Math.floor((e.x+e.w/2)/(RAID_MAP_W/3)),0,2);
      const gy=M.clamp(Math.floor((e.y+e.h/2)/(RAID_MAP_H/3)),0,2);
      return gy*3+gx;
    };
    const openZones=new Set();
    for(const e of this.extracts) if(!e.closed) openZones.add(zoneOf(e));
    for(let z=0;z<9;z++){
      if(openZones.has(z)) continue;
      const cand=this.extracts.filter(e=>e.closed && zoneOf(e)===z)
        .sort((a,b)=> (a.cost||0)-(b.cost||0))[0];   // 优先开免费点
      if(!cand) continue;
      cand.closed=false;
      cand.note=(RAID_EXTRACT_RULES[cand.id]||{}).note || cand.note;
      openZones.add(z);
    }

    // 全区主干道（视觉）：东西 / 南北各一条，让大地图有“行政区”结构
    this.roads.push({x:0, y:2680, w:RAID_MAP_W, h:120});
    this.roads.push({x:3380, y:0, w:120, h:RAID_MAP_H});
    this.roads.push({x:0, y:1160, w:RAID_MAP_W, h:84});
    this.roads.push({x:2120, y:0, w:84, h:RAID_MAP_H});
    this.roads.push({x:1200, y:3600, w:RAID_MAP_W-1200, h:96});
    // 新生态区的两条纵向干道（均避开河道，AI 也据此在新区域刷新巡逻）
    this.roads.push({x:7000, y:0, w:96, h:RAID_MAP_H});
    this.roads.push({x:9800, y:0, w:96, h:RAID_MAP_H});

    this._buildWater();    // 河流先建，后续建筑/物件避免长在水面上
    this._buildDam();      // 大坝坝体（墙）+ 溢洪道，早于棚屋/杂物
    this._buildPrisonCell();// 监狱牢房隔断
    this._clipRoads();
    this._buildYards();
    this._buildSkybridges();
    this._buildSheds();
    this._fillProps();
    this._buildScenes();   // 室外场景化（集装箱堆场 / 车辆残骸群 / 铁丝网带 / 杂物堆）
    this._buildTerrain();  // 北境密林 / 中央河谷 / 铁路枢纽（树林·河流·铁路）
    this._buildShops();    // 局内商店（需在水面/建筑/树都就位后选点）
    this._buildGadgets();  // 医疗站 / 弹药箱 / 泄洪闸（新建筑内的可互动设施）
    this._buildNavGrid();
    this._buildPatrolPoints();  // 把落在墙里/水里的巡逻点推开，AI 不再卡住
    this._buildDecals();   // 地表细节（油渍/血迹/裂缝/草簇/停车线/涂鸦），纯视觉、确定性生成
    this._buildFloodlights();   // 探照灯（确定性位置，强化氛围）
    this._buildAmbient();       // 区域明暗分级（暗斑，确定性生成）
  },

  /* -------------------- 屋顶连廊（v0.31.0） --------------------
     《消逝的光芒》式街区层次：相邻楼之间架一条窄的空中通道（纯视觉，不碰撞）。
     只在两栋中心相距 260~760px、且中点不在河面上时生成，最多 14 条，
     避免整张图变成蜘蛛网。 */
  _buildSkybridges(){
    const rooms=RAID_ROOMS.filter(r=>!r.open && !r.extract);
    const out=[];
    for(let i=0;i<rooms.length && out.length<14;i++){
      const a=rooms[i], ax=a.x+a.w/2, ay=a.y+a.h/2;
      let best=null, bd=1e9;
      for(let j=i+1;j<rooms.length;j++){
        const b=rooms[j], bx=b.x+b.w/2, by=b.y+b.h/2;
        const d=Math.hypot(bx-ax,by-ay);
        if(d<260||d>760||d>=bd) continue;
        if(this._inWater((ax+bx)/2,(ay+by)/2)) continue;
        bd=d; best=b;
      }
      if(!best) continue;
      const bx=best.x+best.w/2, by=best.y+best.h/2;
      const horiz=Math.abs(bx-ax)>=Math.abs(by-ay);
      out.push(horiz
        ? { x:Math.min(ax,bx), y:(ay+by)/2-24, w:Math.abs(bx-ax), h:48, horiz:true }
        : { x:(ax+bx)/2-24, y:Math.min(ay,by), w:48, h:Math.abs(by-ay), horiz:false });
    }
    this.skybridges=out;
  },

  /* -------------------- 监狱牢房隔断 --------------------
     主楼中间一道带 96px 中央过道的隔断，把大房间切成上下两排牢房；
     只是多两段墙，AI 寻路与家具摆放都沿用现有逻辑。 */
  _buildPrisonCell(){
    const rm=RAID_ROOMS.find(r=>r.id==="prisonA"); if(!rm) return;
    const y=rm.y+Math.round(rm.h/2)-8;
    const seg=Math.round((rm.w-96)/2);
    this.walls.push({ x:rm.x+16,       y:y, w:seg, h:16, kind:"wall", cell:true });
    this.walls.push({ x:rm.x+rm.w-16-seg, y:y, w:seg, h:16, kind:"wall", cell:true });
    // 牢房门：隔断上的窄口（视觉提示，不阻挡）
    this.doorLanes.push({ x:rm.x+rm.w/2-60, y:y-40, w:120, h:96 });
  },

  /* -------------------- 大坝坝体 --------------------
     横跨水库北缘的两段混凝土坝 + 中间 210px 溢洪闸。闸门由 gadget「泄洪闸」控制，
     开启后水库水圆移除，水底露出高级保险箱。 */
  _buildDam(){
    const Y=8760, H=60;
    this.damOpen=false;
    this.walls.push({ x:2330, y:Y, w:1100, h:H, kind:"wall", dam:true });
    this.walls.push({ x:3640, y:Y, w:840,  h:H, kind:"wall", dam:true });
    this.roads.push({ x:2330, y:Y-72, w:2150, h:66 });   // 坝顶通道铺装
    this.yards.push({ x:3390, y:8820, w:290, h:140, tint:"#20262b" });   // 溢洪道口
  },

  /* -------------------- 生态扩张：河流（先建，供避让） -------------------- */
  // 河流：沿中心线按步长离散成「水圆」；桥梁处额外记录豁免矩形，桥面视作干地。
  // 必须在 _buildSheds / _fillProps / _buildScenes 之前调用，这样建筑与物件不会长在河面上。
  _buildWater(){
    const R=RAID_BIOMES.river, half=R.half, STEP=88, pts=R.pts;
    for(let s=0;s<pts.length-1;s++){
      const [x1,y1]=pts[s], [x2,y2]=pts[s+1];
      const len=Math.hypot(x2-x1,y2-y1), n=Math.max(1,Math.round(len/STEP));
      for(let i=0;i<=n;i++){
        const t=i/n, x=x1+(x2-x1)*t, y=y1+(y2-y1)*t;
        if(x<-half||y<-half||x>RAID_MAP_W+half||y>RAID_MAP_H+half) continue;
        this.waterCircles.push({ x, y, r:half });
      }
    }
    // 桥：轴对齐矩形净空（横向桥面横跨河道，安全通行带与画面对齐）
    // 支持 [x,y] 简写与 {x,y,w,h,big} 完整写法
    for(const b of R.bridges){
      if(Array.isArray(b)) this.bridges.push({ x:b[0], y:b[1], w:half*2.5, h:half*1.1 });
      else this.bridges.push({ x:b.x, y:b.y, w:b.w||half*2.5, h:b.h||half*1.1, big:!!b.big });
    }
    // 河带包围盒（含桥面外扩），用于水判定的快速剔除
    let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9;
    for(const c of this.waterCircles){
      x0=Math.min(x0,c.x-c.r); x1=Math.max(x1,c.x+c.r);
      y0=Math.min(y0,c.y-c.r); y1=Math.max(y1,c.y+c.r);
    }
    for(const b of this.bridges){
      x0=Math.min(x0,b.x-b.w/2); x1=Math.max(x1,b.x+b.w/2);
      y0=Math.min(y0,b.y-b.h/2); y1=Math.max(y1,b.y+b.h/2);
    }
    this._waterBox={ x0:x0-40, y0:y0-40, x1:x1+40, y1:y1+40 };

    /* 大坝水库（西南开发区）。用矩形库区（视觉与碰撞一致，比水圆拼合更干净），
     * 开闸后 damOpen=true，库区不再判定为水，露出库底与两个高级保险箱。 */
    this.reservoirRect={ x:2260, y:8790, w:2290, h:810 };
    this.reservoir=[];
  },

  /* -------------------- 生态扩张：密林 / 铁路 -------------------- */
  _buildTerrain(){
    const B=RAID_BIOMES;
    const TREE={ kind:"tree", w:46, h:46, sight:true, fill:"#2f3a22", edge:"#1c2614" };

    /* ① 密林：在每个林区按网格撒树，避开门/河道/桥/既有建筑，构成可穿行的树林掩体 */
    for(const fz of B.forest){
      this.forests.push({ x:fz.x, y:fz.y, w:fz.w, h:fz.h });
      const SP=140, occ=new Set();
      for(let gy=fz.y+SP/2; gy<fz.y+fz.h; gy+=SP){
        for(let gx=fz.x+SP/2; gx<fz.x+fz.w; gx+=SP){
          const jx=gx+RNG.fr(-30,30), jy=gy+RNG.fr(-30,30);
          if(this._blockedSpawn(jx,jy)) continue;
          if(this._distToRoom(jx,jy)<86) continue;   // 不压建筑院子
          const cx=Math.floor(jx/70), cy=Math.floor(jy/70);
          if(occ.has(cx+","+cy)) continue;
          let near=false;
          for(const p of this.props){ if(Math.abs(p.x+p.w/2-jx)<64 && Math.abs(p.y+p.h/2-jy)<64){ near=true; break; } }
          if(near) continue;
          occ.add(cx+","+cy);
          this._pushProp(TREE, jx-TREE.w/2, jy-TREE.h/2);
        }
      }
    }

    /* ③ 铁路：记录轨道折线（纯视觉，可通行）；货运列车以车厢形式作为硬掩体 */
    this.rails=B.rails;
    /* v0.31.0：轨道不能再直接泡在河里 —— 沿轨道采样出每段过河区间，
       架一座钢桁架铁路桥；桥面同时进 bridges，玩家在桥上按干地处理。 */
    if(typeof raidRailBridgeBoxes==="function"){
      const rb=raidRailBridgeBoxes(this.rails, (x,y)=>this._waterKind(x,y), RAID_BIOMES.river.half);
      for(const b of rb){ this.railBridges.push(b); this.bridges.push(b); }
    }
    const trains = B.trains || (B.train?[B.train]:[]);
    for(const T of trains){
      const CW=64, CH=150, GAP=18, n=T.cars, horiz=(T.dir==="h");
      for(let i=0;i<n;i++){
        const off=(i-(n-1)/2)*(CH+GAP);
        const tx=horiz?T.x+off:T.x, ty=horiz?T.y:T.y+off;
        // 车厢仅在非水域、远离建筑处生成，避免列车卡在桥里
        if(this._blockedSpawn(tx,ty) || this._distToRoom(tx,ty)<120) continue;
        const w=horiz?CH:CW, h=horiz?CW:CH;
        this._pushProp({ kind:"railcar", w:w, h:h, sight:true, fill:"#33383f", edge:"#15181d" }, tx-w/2, ty-h/2);
      }
    }
  },

  /* 水域种类：
   *   0 = 干地 / 桥面     1 = 河流浅水（可缓慢涉水，停留过久失温扣血）
   *   2 = 深水（大坝水库未开闸，不可通行，只能先开泄洪闸）
   * 桥面在此处就短路返回 0，所以踩桥既不会减速也不会扣血。 */
  _waterKind(x,y){
    if(this.reservoirRect && !this.damOpen){
      const rr=this.reservoirRect;
      if(x>=rr.x && x<=rr.x+rr.w && y>=rr.y && y<=rr.y+rr.h) return 2;
    }
    if(!this.waterCircles || !this.waterCircles.length) return 0;
    // 快速剔除：河带只占地图中东部一条窄带，绝大多数坐标一次 AABB 比较就返回，
    // 否则 30 个 AI × 每帧 4 次 × 上千个水圆的开销会明显拖帧。
    const wb=this._waterBox;
    if(wb && (x<wb.x0 || x>wb.x1 || y<wb.y0 || y>wb.y1)) return 0;
    for(const b of this.bridges){
      if(x>b.x-b.w/2 && x<b.x+b.w/2 && y>b.y-b.h/2 && y<b.y+b.h/2) return 0;   // 桥面通行
    }
    for(const c of this.waterCircles){ const dx=x-c.x, dy=y-c.y; if(dx*dx+dy*dy < c.r*c.r) return 1; }
    return 0;
  },

  // 水体内是否「不可站」（深水/浅水）；生成阶段用它避让
  _inWater(x,y){ return this._waterKind(x,y) > 0; },
  _onBridge(x,y){
    for(const b of this.bridges){
      if(x>b.x-b.w/2 && x<b.x+b.w/2 && y>b.y-b.h/2 && y<b.y+b.h/2) return true;
    }
    return false;
  },
  // 生成避让：水面 + 桥面都不长树/箱子/工棚 —— 桥是通行带，别被杂物堵住
  _blockedSpawn(x,y){ return this._waterKind(x,y) > 0 || this._onBridge(x,y); },

  /* -------------------- 室外场景化 --------------------
     把零散物件聚成「据点」：集装箱堆场 / 车辆残骸群 / 铁丝网带 / 杂物堆。
     仅 push 进 props+walls（碰撞/视线沿用现有空间索引），所有候选都用
     _canPlaceSceneBox 做整群避让，确保不堵门、不压房、不重叠既有物件。 */
  _pickProp(kind, pred){
    for(const t of RAID_PROPS){ if(t.kind===kind && (!pred||pred(t))) return t; }
    return null;
  },
  _canPlaceSceneBox(box){
    if(box.x<96||box.y<96||box.x+box.w>RAID_MAP_W-96||box.y+box.h>RAID_MAP_H-96) return false;
    if(this._blockedSpawn(box.x+box.w/2, box.y+box.h/2)) return false;   // 不占河面
    for(const rm of RAID_ROOMS){ if(this._hitRect(box, rm, 56)) return false; }
    for(const L of this.doorLanes){ if(this._hitRect(box, L, 10)) return false; }
    for(const sh of this.sheds){ if(this._hitRect(box, sh, 40)) return false; }
    for(const p of this.props){ if(this._hitRect(box, p, 46)) return false; }
    return true;
  },
  _buildScenes(){
    const placed=[];
    const ok=(box)=>{
      if(!this._canPlaceSceneBox(box)) return false;
      for(const b of placed){ if(this._hitRect(box, b, 120)) return false; }
      return true;
    };
    const CELL=240;

    // ① 集装箱堆场：2 行阵列 + 两端护栏 + 地面铺装
    { let n=0, guard=0;
      while(n<6 && guard<500){ guard++;
        const cols=RNG.ri(3,5), rows=2;
        const W=cols*CELL+40, H=rows*CELL+40;
        const x=RNG.fr(140, RAID_MAP_W-W-140), y=RNG.fr(140, RAID_MAP_H-H-140);
        const box={x,y,w:W,h:H}; if(!ok(box)) continue;
        this.yards.push({x:x-24,y:y-24,w:W+48,h:H+48,tint:"#262a23"});
        const barH=this._pickProp("barrier", t=>t.w>t.h);
        if(barH){ this._pushProp(barH, x-30, y+H/2-19); this._pushProp(barH, x+W+30-206, y+H/2-19); }
        for(let r=0;r<rows;r++) for(let c=0;c<cols;c++){
          const horiz=RNG.chance(0.5);
          const t=this._pickProp("container", t=>horiz?t.w>t.h:t.w<t.h);
          if(!t) continue;
          this._pushProp(t, x+20+c*CELL+(CELL-t.w)/2, y+20+r*CELL+(CELL-t.h)/2);
        }
        placed.push(box); n++;
      }
    }

    // ② 车辆残骸群：中心卡车 + 周围错位残骸
    { let n=0, guard=0;
      while(n<8 && guard<500){ guard++;
        const cx=RNG.fr(320, RAID_MAP_W-320), cy=RNG.fr(320, RAID_MAP_H-320);
        if(this._distToRoom(cx,cy)<340) continue;
        const box={x:cx-190,y:cy-190,w:380,h:380}; if(!ok(box)) continue;
        const truck=this._pickProp("truck", t=>t.w>t.h);
        if(truck) this._pushProp(truck, cx-truck.w/2, cy-truck.h/2);
        const k=RNG.ri(2,4);
        for(let i=0;i<k;i++){
          const a=RNG.fr(0,6.2832), rad=RNG.fr(95,175);
          const t=RNG.chance(0.5)?this._pickProp("truck", t=>t.w>t.h):this._pickProp("scrap");
          if(!t) continue;
          this._pushProp(t, cx+Math.cos(a)*rad-t.w/2, cy+Math.sin(a)*rad-t.h/2);
        }
        placed.push(box); n++;
      }
    }

    // ③ 铁丝网带：一排橙黑护栏（水平或垂直），两端加短柱
    { let n=0, guard=0;
      while(n<10 && guard<500){ guard++;
        const len=RNG.ri(280,560), horiz=RNG.chance(0.5);
        const bar=this._pickProp("barrier", t=>horiz?t.w>t.h:t.w<t.h);
        if(!bar) break;
        const cnt=Math.max(1, Math.floor(len/bar.w));
        const cx=RNG.fr(300, RAID_MAP_W-300), cy=RNG.fr(300, RAID_MAP_H-300);
        let bx,by,bw,bh;
        if(horiz){ bw=cnt*bar.w; bh=bar.h; bx=cx-bw/2; by=cy-bar.h/2; }
        else      { bw=bar.w; bh=cnt*bar.h; bx=cx-bar.w/2; by=cy-bh/2; }
        const box={x:bx-20,y:by-20,w:bw+40,h:bh+40}; if(!ok(box)) continue;
        for(let i=0;i<cnt;i++){
          if(horiz) this._pushProp(bar, bx+i*bar.w, by);
          else       this._pushProp(bar, bx, by+i*bar.h);
        }
        placed.push(box); n++;
      }
    }

    // ④ 杂物堆：中心货箱 + 周围散落 crate/sandbag/rock/scrap（荒野感）
    { let n=0, guard=0;
      while(n<16 && guard<600){ guard++;
        const cx=RNG.fr(280, RAID_MAP_W-280), cy=RNG.fr(280, RAID_MAP_H-280);
        if(this._distToRoom(cx,cy)<260) continue;
        const box={x:cx-130,y:cy-130,w:260,h:260}; if(!ok(box)) continue;
        const crate=this._pickProp("crate");
        if(crate) this._pushProp(crate, cx-crate.w/2, cy-crate.h/2);
        const pool=["crate","sandbag","scrap","rock"];
        const k=RNG.ri(4,7);
        for(let i=0;i<k;i++){
          const a=RNG.fr(0,6.2832), rad=RNG.fr(40,120);
          const t=this._pickProp(pool[RNG.ri(0,pool.length-1)]);
          if(!t) continue;
          this._pushProp(t, cx+Math.cos(a)*rad-t.w/2, cy+Math.sin(a)*rad-t.h/2);
        }
        placed.push(box); n++;
      }
    }
  },

  /* 探照灯：确定性位置——每个撤离点 1 盏 + 主干道交点 + 院子抽样，
     联机同 seed 下地图一致。渲染在 _lightLayer 中以暖色光池叠加。 */
  _buildFloodlights(){
    this.floodlights=[];
    const push=(x,y,r)=>{ if(x>0&&y>0&&x<RAID_MAP_W&&y<RAID_MAP_H) this.floodlights.push({x,y,r}); };
    for(const e of this.extracts) push(e.x+e.w/2, e.y+e.h/2, 380);
    const pts=[[3380,2680],[2120,1160],[3380,1160],[2120,2680],[1200,3600],[3380,3600],[1760,1920]];
    for(const [px,py] of pts) push(px,py,420);
    let yi=0;
    for(const yd of this.yards){ if((yi++)%3===0 && this.floodlights.length<18) push(yd.x+yd.w/2, yd.y+yd.h/2, 240); }
  },

  /* 区域明暗：基于确定性哈希生成暗斑，纯视觉，渲染在地面层之上、
     props 之下，让大地图有「受光/背光」的层次而非一整片均色。 */
  _buildAmbient(){
    this.darkSpots=[];
    const G=440;
    for(let gy=0; gy*G<RAID_MAP_H; gy++){
      for(let gx=0; gx*G<RAID_MAP_W; gx++){
        const hv=this._hash2(gx*3+1, gy*5+2);
        if(hv<0.5) continue;
        const hx=this._hash2(gx*7+3, gy*11+5), hy=this._hash2(gx*13+7, gy*17+3);
        const cx=gx*G+hx*G, cy=gy*G+hy*G, r=180+hv*260;
        this.darkSpots.push({x:cx,y:cy,r, a:0.08+hv*0.16});
      }
    }
  },

  /* 地表细节层：用 _hash2（坐标确定性哈希）生成 decals，不依赖全局 RNG 序列，
     保证联机两端地图完全一致；全部为纯几何绘制，按视口裁剪，几乎零性能开销。 */
  _buildDecals(){
    this.decals=[];
    const D=this.decals;
    const H=(a,b)=>this._hash2(a,b);                 // [0,1)
    const CELL=168;
    const inRoom=(x,y)=>{ for(const rm of RAID_ROOMS){ if(x>rm.x&&x<rm.x+rm.w&&y>rm.y&&y<rm.y+rm.h) return true; } return false; };
    for(let gy=0; gy*CELL<RAID_MAP_H; gy++){
      for(let gx=0; gx*CELL<RAID_MAP_W; gx++){
        const cx=gx*CELL+CELL/2, cy=gy*CELL+CELL/2;
        const d=this._distToRoom(cx,cy);
        const count = d<280 ? 3 : (d<700 ? 2 : (H(gx*2+1,gy*2+1)<0.6?1:0));
        for(let i=0;i<count;i++){
          const h1=H(gx*7+i*3+3, gy*13+i*5+1);
          const h2=H(gx*11+i*3+7, gy*5+i*2+9);
          const h3=H(gx*3+i*5+5, gy*17+i+2);
          const x=cx+(h1-0.5)*CELL*0.82, y=cy+(h2-0.5)*CELL*0.82;
          if(x<40||y<40||x>RAID_MAP_W-40||y>RAID_MAP_H-40) continue;
          if(this._blockedSpawn(x,y)) continue;   // 河面上不撒油渍/草簇
          if(inRoom(x,y) && d>40) { /* 室内仍允许，下面按 d 分支处理 */ }
          let type;
          if(d>820)       type = h3<0.62?"grass":(h3<0.84?"rocklet":"oil");
          else if(d>300)  type = h3<0.34?"rocklet":(h3<0.52?"blood":(h3<0.82?"oil":"stain"));
          else            type = h3<0.5?"oil":(h3<0.78?"stain":"crack");
          const o={t:type, x, y};
          if(type==="oil"){ o.r=14+h3*22; o.a=0.05+h1*0.07; }
          else if(type==="stain"){ o.r=10+h3*18; o.a=0.05+h1*0.06; }
          else if(type==="blood"){ o.r=8+h3*16; o.a=0.08+h1*0.12; }
          else if(type==="crack"){ o.w=30+h3*70; o.ang=h1*6.2832; }
          else if(type==="grass"){ o.r=10+h3*14; }
          else if(type==="rocklet"){ o.r=4+h3*8; }
          D.push(o);
        }
      }
    }
    // 院子/道路停车线与磨损标线
    for(const yd of this.yards){
      const bx=(yd.x|0), by=(yd.y|0);
      const ln=1+Math.floor(H(bx+1,by+1)*3);
      for(let i=0;i<ln;i++){
        const hx=H(bx+i*3+2, by+i*5+3), hy=H(bx+i*7+5, by+i*2+9);
        D.push({t:"line", x:yd.x+20+hx*(yd.w-40), y:yd.y+20+hy*(yd.h-40),
                w:50+hy*70, ang:hx<0.5?1.57:0, a:0.04+hx*0.04});
      }
    }
    for(const rd of this.roads){
      const horiz=rd.w>=rd.h;
      const bx=(rd.x|0), by=(rd.y|0);
      const cnt=Math.max(1, Math.floor((horiz?rd.w:rd.h)/240));
      for(let i=0;i<cnt;i++){
        const hx=H(bx+i*4+1, by+i*6+2), hy=H(bx+i*2+7, by+i*3+5);
        D.push({t:"line", x:rd.x+20+hx*(rd.w-40), y:rd.y+20+hy*(rd.h-40),
                w:40+hy*70, ang:horiz?1.57:0, a:0.05+hx*0.05});
      }
    }
    // 涂鸦符号点缀（确定性）
    for(let i=0;i<44;i++){
      const hx=H(i*9+1,3), hy=H(7,i*5+2);
      const x=120+hx*(RAID_MAP_W-240), y=120+hy*(RAID_MAP_H-240);
      const d=this._distToRoom(x,y);
      if(d<120||d>920) continue;
      D.push({t:"glyph", x, y, r:14+H(i*3+4,9)*18,
              c:["#b84a3a","#caa23a","#4a8ab0","#7a5ab0"][i%4],
              a:0.12+H(i*2+1,5)*0.16, ang:H(i*6+3,1)*6.2832});
    }
  },

  /* 道路穿过建筑时按建筑轮廓裁掉，避免“路从屋里穿过去”的违和感 */
  _clipRoads(){
    const out=[];
    for(const rd of this.roads){
      let segs=[rd];
      for(const rm of RAID_ROOMS){
        const next=[];
        const box={x:rm.x-6,y:rm.y-6,w:rm.w+12,h:rm.h+12};
        for(const sg of segs){
          if(!this._hitRect(sg,box,0)){ next.push(sg); continue; }
          if(sg.y<box.y) next.push({x:sg.x,y:sg.y,w:sg.w,h:box.y-sg.y});
          if(sg.y+sg.h>box.y+box.h) next.push({x:sg.x,y:box.y+box.h,w:sg.w,h:sg.y+sg.h-(box.y+box.h)});
          const y0=Math.max(sg.y,box.y), y1=Math.min(sg.y+sg.h,box.y+box.h);
          if(y1-y0>0.5){
            if(sg.x<box.x) next.push({x:sg.x,y:y0,w:box.x-sg.x,h:y1-y0});
            if(sg.x+sg.w>box.x+box.w) next.push({x:box.x+box.w,y:y0,w:sg.x+sg.w-(box.x+box.w),h:y1-y0});
          }
        }
        segs=next;
      }
      for(const sg of segs){ if(sg.w>2&&sg.h>2) out.push(sg); }
    }
    this.roads=out;
  },

  /* 野外工棚：U 形残墙 + 一个敞口，既是天然掩体，也让空地有小据点 */
  _buildSheds(){
    const TH=14;
    for(let i=0;i<220 && this.sheds.length<32;i++){
      const w=RNG.ri(156,246), h=RNG.ri(132,204);
      const x=RNG.fr(320,RAID_MAP_W-320-w), y=RNG.fr(320,RAID_MAP_H-320-h);
      const box={x:x,y:y,w:w,h:h};
      if(this._distToRoom(x+w/2, y+h/2) < 300) continue;
      if(this._blockedSpawn(x+w/2, y+h/2)) continue;   // 工棚不建在河面上
      let bad=false;
      for(const L of this.doorLanes){ if(this._hitRect(box,L,50)){ bad=true; break; } }
      if(bad) continue;
      for(const p of this.props){ if(this._hitRect(box,p,54)){ bad=true; break; } }
      if(!bad) for(const w of this.walls){ if(this._hitRect(box,w,44)){ bad=true; break; } }   // 不压在坝体/围墙上
      if(bad) continue;
      for(const sh of this.sheds){ if(this._hitRect(box,sh,96)){ bad=true; break; } }
      if(bad) continue;
      const open=RNG.pick(["top","bottom","left","right"]);
      const add=(x2,y2,w2,h2)=>{ if(w2>0&&h2>0) this.walls.push({x:x2,y:y2,w:w2,h:h2,kind:"wall"}); };
      if(open!=="top")    add(x, y, w, TH);
      if(open!=="bottom") add(x, y+h-TH, w, TH);
      if(open!=="left")   add(x, y, TH, h);
      if(open!=="right")  add(x+w-TH, y, TH, h);
      this.sheds.push({ x:x, y:y, w:w, h:h, open:open });
      this.yards.push({ x:x-18, y:y-18, w:w+36, h:h+36, tint:"#2a2d26" });
    }
  },

  /* 建筑“院子”：房间外一圈水泥地，让孤零零的房子有占地感，也压住大片空地 */
  _buildYards(){
    for(const rm of RAID_ROOMS){
      if(rm.open) continue;   // 开放场地本身就是一大片铺装，不再叠水泥院子
      const p=RNG.ri(30,92), px=RNG.ri(18,70), py=RNG.ri(18,70);
      this.yards.push({ x:rm.x-px, y:rm.y-py, w:rm.w+px*2, h:rm.h+py*2,
        tint: rm.extract?"#1f3a2b":"#282b26" });
    }
  },

  /* 到最近建筑外墙的距离（0=贴在房间里侧），用于分区控制掩体密度 */
  _distToRoom(x,y){
    let best=1e9;
    for(const rm of RAID_ROOMS){
      const dx=Math.max(rm.x-x, 0, x-(rm.x+rm.w));
      const dy=Math.max(rm.y-y, 0, y-(rm.y+rm.h));
      const d=Math.hypot(dx,dy);
      if(d<best) best=d;
    }
    return best;
  },

  /* 室内家具：贴墙摆放，避开门内侧通道；贴边放不下时改摆房间中部 */
  _fillIndoor(){
    for(const rm of RAID_ROOMS){
      if(rm.extract || rm.open || rm.id===this.spawnRoomId) continue;
      const n=RNG.ri(3,5)+Math.floor(rm.w*rm.h/62000);   // 大房间不再空荡
      for(let i=0;i<n;i++){
        const t=RAID_INDOOR[RNG.weighted(RAID_INDOOR)];
        if(!t) continue;
        let done=false;
        for(let k=0;k<8 && !done;k++){
          let x,y;
          if(k<5){
            // 贴墙：随便挑一面，沿墙滑一段
            const edge=RNG.pick(["top","bottom","left","right"]);
            if(edge==="top"){ x=rm.x+RNG.fr(28,Math.max(29,rm.w-t.w-28)); y=rm.y+24; }
            else if(edge==="bottom"){ x=rm.x+RNG.fr(28,Math.max(29,rm.w-t.w-28)); y=rm.y+rm.h-t.h-24; }
            else if(edge==="left"){ x=rm.x+24; y=rm.y+RNG.fr(28,Math.max(29,rm.h-t.h-28)); }
            else { x=rm.x+rm.w-t.w-24; y=rm.y+RNG.fr(28,Math.max(29,rm.h-t.h-28)); }
          } else {
            x=rm.x+RNG.fr(40,Math.max(41,rm.w-t.w-40));
            y=rm.y+RNG.fr(40,Math.max(41,rm.h-t.h-40));
          }
          const box={x:x,y:y,w:t.w,h:t.h};
          if(x<rm.x+20||y<rm.y+20||x+t.w>rm.x+rm.w-20||y+t.h>rm.y+rm.h-20) continue;
          let bad=this._blocksLane(rm,box);
          if(!bad) for(const L of this.doorInner){ if(this._hitRect(box,L,4)){ bad=true; break; } }
          if(bad) continue;
          for(const p of this.props){ if(this._hitRect(box,p,24)){ bad=true; break; } }
          if(bad) continue;
          for(const w of this.walls){ if(this._hitRect(box,w,10)){ bad=true; break; } }   // 不压在牢房隔断上
          if(bad) continue;
          this._pushProp(t,x,y); done=true;
        }
      }
    }
  },

  /* 两门对穿的房间，中央要留出一条能直接跑过去的通道，家具不得横在中间 */
  _blocksLane(rm,box){
    const ds=rm._doors||[];
    if(!ds.length) return false;
    if(ds.length===1){
      // 单门房间：门到房间中心也要留一条直通带
      const a=ds[0], half=a.gap/2+14;
      if(a.dir==="top"||a.dir==="bottom"){
        const cy=rm.y+rm.h/2;
        return box.y+box.h>Math.min(a.mid,cy)-half && box.y<Math.max(a.mid,cy)+half;
      }
      const cx=rm.x+rm.w/2;
      return box.x+box.w>Math.min(a.mid,cx)-half && box.x<Math.max(a.mid,cx)+half;
    }
    const a=ds[0], b=ds[1];
    const half=Math.max(a.gap,b.gap)/2+16;
    if(a.dir==="top"&&b.dir==="bottom"){
      const y0=Math.min(a.mid,b.mid)-half, y1=Math.max(a.mid,b.mid)+half;
      return box.y+box.h>y0 && box.y<y1;
    }
    if(a.dir==="left"&&b.dir==="right"){
      const x0=Math.min(a.mid,b.mid)-half, x1=Math.max(a.mid,b.mid)+half;
      return box.x+box.w>x0 && box.x<x1;
    }
    return false;
  },

  /* 户外掩体：按离建筑远近分档密度 + 成簇（堆场/营地），避免"撒芝麻"式的均匀铺满 */
  _fillProps(){
    this._fillIndoor();

    const urban=[], wild=[];
    for(const t of RAID_PROPS){ if(t.wild) wild.push(t); else urban.push(t); }

    // 成簇：先选种子点，再围绕它堆 3~6 件同类物件
    for(let i=0;i<46;i++){
      const sx=RNG.fr(200,RAID_MAP_W-200), sy=RNG.fr(200,RAID_MAP_H-200);
      const d=this._distToRoom(sx,sy);
      if(d<130||d>1250) continue;
      const pool = d<430 ? urban : wild;
      const t0=pool[RNG.weighted(pool)];
      if(!t0) continue;
      const n=RNG.ri(3,6);
      for(let k=0;k<n;k++){
        const a=RNG.fr(0,6.2832), r=RNG.fr(70,240);
        const t=RNG.chance(0.74)?t0:pool[RNG.weighted(pool)];
        if(!t) continue;
        this._addProp(t, sx+Math.cos(a)*r-t.w/2, sy+Math.sin(a)*r-t.h/2);
      }
    }

    const CELL=234;
    const cols=Math.ceil(RAID_MAP_W/CELL), rows=Math.ceil(RAID_MAP_H/CELL);
    for(let gy=0;gy<rows;gy++){
      for(let gx=0;gx<cols;gx++){
        const hv=this._hash2(gx+13, gy+7);
        const cx0=gx*CELL+CELL/2, cy0=gy*CELL+CELL/2;
        const d=this._distToRoom(cx0,cy0);
        // 近建筑：密（堆场/街区）；中距：疏；荒野：很疏且只长灌木石头
        const skip = d<300 ? 0.05 : d<680 ? 0.20 : 0.46;
        if(hv<skip) continue;
        const pool = d<520 ? urban : wild;
        const n = hv>0.84 ? 3 : (hv>0.62 ? 2 : 1);
        for(let i=0;i<n;i++){
          const t=pool[RNG.weighted(pool)];
          if(!t) continue;
          let placed=false;
          for(let k=0;k<4 && !placed;k++){
            const cx=gx*CELL+RNG.fr(26,CELL-26), cy=gy*CELL+RNG.fr(26,CELL-26);
            if(this._addProp(t, cx-t.w/2, cy-t.h/2)) placed=true;
          }
        }
      }
    }

    // 房间外墙边的「废料带」：让建筑与荒野之间有过渡
    for(const rm of RAID_ROOMS){
      if(RNG.chance(0.45)) continue;
      const side=RNG.pick(["top","bottom","left","right"]);
      const t=RAID_PROPS[RNG.weighted(RAID_PROPS)];
      if(!t) continue;
      let x,y;
      if(side==="top"){ x=rm.x+RNG.fr(10,Math.max(11,rm.w-t.w)); y=rm.y-t.h-RNG.fr(26,64); }
      else if(side==="bottom"){ x=rm.x+RNG.fr(10,Math.max(11,rm.w-t.w)); y=rm.y+rm.h+RNG.fr(26,64); }
      else if(side==="left"){ x=rm.x-t.w-RNG.fr(26,64); y=rm.y+RNG.fr(10,Math.max(11,rm.h-t.h)); }
      else { x=rm.x+rm.w+RNG.fr(26,64); y=rm.y+RNG.fr(10,Math.max(11,rm.h-t.h)); }
      this._addProp(t,x,y);
    }
  },

  _canPlaceProp(x,y,t,roomPad){
    const box={x:x,y:y,w:t.w,h:t.h};
    if(x<72||y<72||x+t.w>RAID_MAP_W-72||y+t.h>RAID_MAP_H-72) return false;
    if(this._blockedSpawn(x+t.w/2, y+t.h/2)) return false;   // 物件不长在水面上
    for(const rm of RAID_ROOMS){
      if(this._hitRect(box, rm, roomPad||52)) return false;   // 房间外墙留出通行带
    }
    for(const L of this.doorLanes){
      if(this._hitRect(box, L, 6)) return false;              // 绝不堵门
    }
    for(const sh of this.sheds){
      if(this._hitRect(box, sh, 34)) return false;            // 棚子内外留出通行空间
    }
    for(const p of this.props){
      if(this._hitRect(box, p, 34)) return false;             // 物件间留 34px 缝隙，能侧身穿过
    }
    return true;
  },

  _pushProp(t,x,y){
    /* round 只服务于**光线遮挡**（_rayLight 走椭圆解析求交，见 raid-core3.js）。
     * 移动 / 子弹 / AI 寻路仍然把这个 p 当 AABB 矩形用，形状判定不能扩散到那些地方：
     * 一旦改成圆形，AI 绕障与联机两端的碰撞手感都会跟着变，而收益只是几个空角。
     * v0.25.0：长条形的（长宽比 > 1.7）一律不标 round —— 椭圆的直边会让光锥
     * 沿着一条不存在的弧线收边，与渲染出的矩形对不上。 */
    const p={ x:x, y:y, w:t.w, h:t.h, kind:t.kind, sight:t.sight!==false,
      soft:!t.sight, decor:!!t.decor,
      round:!!RAID_ROUND_KINDS[t.kind] && (typeof raidRoundShape==="function" ? raidRoundShape(t.w,t.h) : true),
      fill:t.fill, edge:t.edge };
    this.props.push(p);
    /* v0.33.1（用户反馈）：scrap 是散落在地上的废料堆（椭圆底 + 几个碎块），
       视觉上就是杂物，不该挡路。只留在 props 供渲染与摆放避让，
       不进 walls —— 移动 / 子弹 / AI 视线 / 手电光锥全部可以穿过。
       对应地，右侧那种六边形岩石（rock）反过来要按六边形挡，见 RAID_COMPOUND_KINDS。 */
    if(t.kind==="scrap") return p;
    /* v0.31.0：复合装饰按三个矩形登记碰撞 —— navCell（光线 / 子弹 / 移动）
       与 losCell（AI 视线）都只认这三个子矩形，缝隙是真正空的。 */
    if(typeof raidCompoundBoxes==="function" && RAID_COMPOUND_KINDS[t.kind]){
      p.compound=RAID_COMPOUND_KINDS[t.kind];
      /* v0.36.0（用户要求）：rock 的画就是六边形，碰撞也按六边形算。
         不再登记三条横带，而是登记**一个** AABB（供 navCell / losCell 索引）
         + 一份绝对坐标多边形；移动、子弹、视线、手电四处都用
         raidPolyDist / raidPointInPoly / raidRayPoly 做解析判定。 */
      if(p.compound==="hex"){
        p.hexPoly = raidHexPolyOf(p);
        this.walls.push({ x:p.x, y:p.y, w:p.w, h:p.h, kind:t.kind,
          sight:p.sight, soft:p.soft, round:false, fill:p.fill, edge:p.edge,
          compoundOf:p, compound:"hex", hexPoly:p.hexPoly });
        return p;
      }
      p.boxes=raidCompoundBoxes(p);
      for(const b of p.boxes){
        this.walls.push({ x:b.x, y:b.y, w:b.w, h:b.h, kind:t.kind,
          sight:p.sight, soft:p.soft, round:false, fill:p.fill, edge:p.edge,
          compoundOf:p, compound:p.compound });
      }
    } else {
      this.walls.push(p);
    }
    return p;
  },

  _addProp(t,x,y){
    if(!this._canPlaceProp(x,y,t)) return false;
    this._pushProp(t,x,y);
    return true;
  },

  /* 碰撞 / 视线空间索引（256px 网格）：物件从 300 涨到上千，逐一遍历会拖慢帧率 */
  /* -------------------- 局内商店（枪店 / 材料店 / 回收超市 / 黑市） -------------------- */
  /* 摊位不再钉死在固定坐标 —— 每局按「区域锚点池」随机落点，数量 6 → 9。
   *   · 同类多摊位各有名字后缀，货架依然完全独立（见 _shopStock / URL 里的 sid）
   *   · 锚点池按地貌分区（工业区 / 北境 / 中央河谷 / 东部铁路 / 西南监狱·小镇 / 南岭），
   *     每局从池里随机抽，再叠 ±420 抖动 → 玩家每局都得重新摸商店位置。 */
  _buildShops(){
    const DEFS=[
      // 枪械商店 ×2：一个靠工业区起点，一个在东部/南岭（重装玩家常去的方向）
      { id:"shopGun",  kind:"gun",  name:"枪械商店",     tag:"GUNS",         color:"#ffb44a",
        anchors:[[2600,2900],[2900,1500],[5250,1600],[6200,1300]] },
      { id:"shopGun2", kind:"gun",  name:"枪械商店 II", tag:"GUNS",        color:"#ffb44a",
        anchors:[[10020,2900],[9300,6400],[11200,4600],[8600,8200]] },
      // 材料商店 ×3：工业区 / 西南南站 / 中央河谷或南岭
      { id:"shopMat",  kind:"mat",  name:"材料商店",     tag:"MATERIALS",    color:"#8fe07a",
        spawnNear:true,   // 起点补给点：固定在出生点 760~1500px 环内随机，保证开局有地方买绷带/钥匙
        anchors:[[3560,2900]] },
      { id:"shopMat2", kind:"mat",  name:"材料商店 II", tag:"MATERIALS",   color:"#8fe07a",
        anchors:[[1500,6180],[1900,7300],[2500,8600],[1200,8000]] },
      { id:"shopMat3", kind:"mat",  name:"材料商店 III", tag:"MATERIALS",   color:"#8fe07a",
        anchors:[[7400,4700],[8600,5400],[6500,6500],[9600,7300]] },
      // 回收超市 ×2：工业区 + 小镇
      { id:"shopRec",  kind:"rec",  name:"回收超市",     tag:"RECYCLE",      color:"#62c8ff",
        anchors:[[7400,2900],[6800,2400],[8200,3600]] },
      { id:"shopRec2", kind:"rec",  name:"回收超市 II", tag:"RECYCLE",     color:"#62c8ff",
        anchors:[[2740,7350],[2200,7900],[3400,7800],[3800,8600]] },
      // 黑市 ×2：东部铁路枢纽 + 北境（高风险区，离撤离点远）
      { id:"shopBlack",  kind:"black", name:"黑市",       tag:"BLACK MARKET", color:"#ffd23f",
        anchors:[[10020,2900],[10800,4200],[9300,2200]] },
      { id:"shopBlack2", kind:"black", name:"黑市 II",  tag:"BLACK MARKET", color:"#ffd23f",
        anchors:[[6900,900],[7400,1800],[8200,5200],[6500,8300]] },
    ];
    const usedAnchors=[];
    for(const d of DEFS){
      let px, py;
      const sp=this.spawnPoint||(this.player?{x:this.player.x,y:this.player.y}:{x:RAID_MAP_W/2,y:RAID_MAP_H/2});
      if(d.spawnNear){
        // 以出生点为圆心，760~1500px 的环内随机找净空（太近会刷脸上）
        let pt=null;
        for(let i=0;i<16 && !pt;i++){
          const a=RNG.fr(0,6.2832), r=RNG.fr(760,1500);
          const cand=this._shopSpot(sp.x+Math.cos(a)*r, sp.y+Math.sin(a)*r);
          if(M.dist(cand.x,cand.y,sp.x,sp.y)>620) pt=cand;
        }
        px=pt?pt.x:sp.x+900; py=pt?pt.y:sp.y;
        usedAnchors.push([px,py]);
      } else {
        // 先挑一个没被同类占用的锚点（避免两家摊位刷在同一个路口）
        let a=d.anchors[0];
        for(let i=0;i<12;i++){
          const cand=RNG.pick(d.anchors);
          if(usedAnchors.every(u=>M.dist(u[0],u[1],cand[0],cand[1])>820)){ a=cand; break; }
          a=cand;
        }
        usedAnchors.push(a);
        px=a[0]+RNG.fr(-420,420); py=a[1]+RNG.fr(-420,420);
      }
      const pt=this._shopSpot(px, py);
      const s=Object.assign({}, d, { x:pt.x, y:pt.y, r:66 });
      delete s.anchors; delete s.spawnNear;
      s.stock=this._shopStock(s.kind);
      /* v0.40.0：回收超市的「收购单」挂在摊位本身上（要随交易递减），不能只留在 stock 里 */
      s.wants=s.stock.wants||null;
      this.shops.push(s);
    }
  },

  /* ------------- 可互动设施（医疗站 / 弹药箱 / 泄洪闸） ------------- */
  _buildGadgets(){
    this.gadgets=[];
    const byId=id=>RAID_ROOMS.find(r=>r.id===id);
    const put=(kind, id, label)=>{
      const rm=byId(id); if(!rm) return;
      const p=this._openPointInRoom(rm, 62);
      this.gadgets.push({ kind:kind, x:p.x, y:p.y, r:22, label:label, used:false, room:id });
    };
    put("med",  "prisonC",  "监狱医务站");
    put("ammo", "prisonB",  "狱警弹药柜");
    put("med",  "townHall", "镇政厅急救箱");
    put("ammo", "townShop", "杂货店弹药箱");
    put("med",  "damCtrl",  "大坝急救站");
    put("ammo", "quarry",   "采石场炸药箱");
    put("med",  "gasSW",    "加油站急救箱");
    // 广场警报器：拉响可把附近 AI 引过来（撤离前调虎离山，也能当诱饵）
    const yard=byId("prisonYard"), sq=byId("townSq");
    if(yard) this.gadgets.push({ kind:"siren", x:yard.x+yard.w/2, y:yard.y+yard.h/2,
      r:24, label:"监狱警报器", used:false, cdUntil:0 });
    if(sq) this.gadgets.push({ kind:"siren", x:sq.x+sq.w*0.34, y:sq.y+sq.h*0.6,
      r:24, label:"小镇广播喇叭", used:false, cdUntil:0 });
    // 泄洪闸：固定卡在坝体缺口，可反复开关
    this.gadgets.push({ kind:"dam", x:3535, y:8780, r:30, label:"泄洪闸", used:false });
  },

  _nearestGadget(x,y,range){
    if(!this.gadgets || !this.gadgets.length) return null;
    let best=null, bd=range*range;
    for(const g of this.gadgets){
      if(g.used && g.kind!=="dam") continue;         // 医疗站 / 弹药箱一次性；闸门与警报可复用
      const d2=M.dist2(x,y,g.x,g.y);
      if(d2<bd){ bd=d2; best=g; }
    }
    return best;
  },

  _useGadget(g){
    const p=this.player;
    if(g.kind==="med"){
      if(p.hp>=p.maxHP && !p.bleed){ this._float(p.x,p.y-52,"生命值已满","#8fd0ff"); return; }
      p.hp=Math.min(p.maxHP, p.hp+45);
      if(p.bleed) p.bleed=0;
      g.used=true;
      this._float(p.x,p.y-56,"+45 生命，已止血","#8fe07a");
      this._feed("设施", g.label+"，完成急救","",false,"info");
      SFX.pickup();
    } else if(g.kind==="ammo"){
      /* v0.20.0：弹药柜直接往背包里塞两条同口径子弹（口径跟手上的枪走） */
      const gun=p.gun;
      const cal=gun ? (gun.cal||ammoCalOfType(gun.type)) : "mid";
      const lv=gun&&gun.loaded ? ((ammoParseId(gun.loaded)||{}).lv||1) : 1;
      const add=this._ammoAdd(ammoItemId(cal, lv), RAID_AMMO_STACK*2);
      g.used=true;
      if(add>0){
        this._float(p.x,p.y-56,"+ "+add+" 发 "+((ammoDefFromId(ammoItemId(cal,lv))||{}).short||"弹药"),"#ffd36a");
        this._feed("设施", g.label+"，补给了 "+add+" 发弹药","",false,"info");
        SFX.reload();
      } else {
        this._float(p.x,p.y-56,"弹药已满","#ff8a5a");
      }
    } else if(g.kind==="siren"){
      const now=M.now();
      if((g.cdUntil||0)>now){
        this._float(g.x,g.y-70,`警报冷却中，还需 ${Math.ceil((g.cdUntil-now)/1000)} 秒`,"#ffb44a");
        return;
      }
      g.cdUntil=now+25000;
      this._noise(g.x, g.y, 2000, this.player);
      for(const o of this.ops){
        if(o.alive && !o.isPlayer && !o.remote && !o.ghost)
          o.investigate={ x:g.x, y:g.y, t:12 };
      }
      this._float(g.x,g.y-70,"警报拉响，附近 AI 正在赶来","#ff8a5a");
      this._feed("设施", g.label+"，已拉响，AI 被引向该区域","",false,"warn");
      SFX.hurt();
    } else if(g.kind==="dam"){
      // 关闸前确认玩家不在库区里，否则会被水困住
      if(this.damOpen){
        const rr=this.reservoirRect;
        const inRes=rr && p.x>=rr.x && p.x<=rr.x+rr.w && p.y>=rr.y && p.y<=rr.y+rr.h;
        if(inRes){ this._float(g.x,g.y-70,"先离开水库再关闸","#ff8a5a"); SFX.hurt(); return; }
      }
      this.damOpen=!this.damOpen;
      if(this.damOpen){
        this._float(g.x, g.y-70, "泄洪闸开启，水库放空中","#8fd0ff");
        this._feed("系统","泄洪闸开启：水库底露出两个高级保险箱（巨响会引来 AI）","事件",false,"info");
        this._noise(g.x, g.y, 2400, this.player);
        SFX.boom();
      } else {
        this._float(g.x, g.y-70, "泄洪闸已关闭","#ffd36a");
        SFX.levelup();
      }
    }
  },

  /* =========================================================================
   * v0.39.0（用户选定的一批）：死亡回放 / 精英词条 / 狙击手 / 医疗兵
   * 全部放在 raid-core.js —— raid-data.js 只剩 1 行余量、raid-core3 只剩 4 行，
   * 而这里还有 200 多行空间。raid-core2 只在既有分支里插 1~2 行调用。
   * ========================================================================= */

  /* 死亡回放：谁、多远、打了几发、累计多少伤害。
   * 数据来自 _damage 里的 hitN / hitDmg 累加与致死那一次的 attacker。
   * 玩家阵亡结算页直接读 Raid.player.deathRecap，所以 _fail 的签名不用改。 */
  _deathRecap(target, attacker, gun){
    const p=this.player||target;
    const a=(attacker && attacker!==target)?attacker:null;
    const label = !a ? ""
      : a.bounty ? "Boss"
      : a.arch ? ((RAID_ARCH[a.arch]||{}).label||"精锐")
      : a.cls==="scav" ? "Scav" : "PMC";
    return {
      name: a ? (a.name||label||"未知目标") : "",
      label,
      dist: a ? Math.round(M.dist(p.x,p.y,a.x,a.y)) : 0,
      hits: target.hitN||0,
      /* 累计伤害按「实际能打掉的血量」封顶：原始累加会把溢出伤害也算进去，
         结算页出现「-100039」这种数字只会让人困惑，读起来也不像塔科夫。 */
      dmg: Math.min(Math.round(target.hitDmg||0), Math.round(target.maxHP||target.hitDmg||0)),
      gun: gun ? gunNameOf(gun) : "",
      elite: a && a.affixNames && a.affixNames.length ? a.affixNames.join(" · ") : "",
    };
  },

  /* 保证每局至少各有一名狙击手与医疗兵。
   * 纯 15% 概率会掷出「整局没有医疗兵」的局（实测就碰上了），而这两种敌人的价值
   * 恰恰在于「每局都必须应对」—— 缺席一次，玩家的应对习惯就学不到。 */
  _ensureTacticalRoles(){
    for(const spec of ["sniper","medic"]){
      if(this.ops.some(o=>o.arch===spec)) continue;
      const cand=this.ops.filter(o=>!o.isPlayer && !o.remote && !o.arch && o.cls==="pmc" && o.alive);
      const op=cand[0];
      if(!op) continue;
      const sp=RAID_ARCH[spec];
      op.arch=spec; op.name=op.name+"·"+sp.label; op.r=sp.r; op.speed=sp.speed;
      op.maxHP=Math.round(op.maxHP*sp.hpMul/2.4); op.hp=op.maxHP;
      if(spec==="sniper"){
        const sg=blGunGen(15,{type:"sniper",rarity:"purple"});
        sg.uid=this._uid(); sg.kind="weapon";
        op.gun=sg; sg.ammoMag=sg.mag; sg.ammoRes=sg.reserve;
      }
    }
  },

  /* 精英随机词条：挑 n 条不重复的，直接改写该单位的属性。
   * 只做「乘区改写」，不新增结算分支 —— 每条都能在现有代码里找到消费点，
   * 词条生效与否一眼可查（v0.38.0 的死字段事故就是栽在「写了没人读」上）。 */
  _applyEliteAffixes(op, n){
    if(!op || op.isPlayer) return op;
    const pool=RAID_ELITE_AFFIX.slice();
    const picked=[];
    const cnt=M.clamp(Math.round(n||1), 0, 2);
    while(picked.length<cnt && pool.length){
      const a=pool.splice(RNG.ri(0,pool.length-1),1)[0];
      a.apply(op); picked.push(a);
    }
    op.affixNames=picked.map(a=>a.name);
    if(picked.length) op.name = op.name+" ["+op.affixNames.join("·")+"]";
    return op;
  },

  /* 狙击手：开火前 0.8s 激光预警，且**锁定**朝向 —— 玩家侧移 / 进掩体就能躲开。
   * 返回 true 表示「本帧的常规开火已被接管」（raid-core2 据此跳过普通 fire 分支）。 */
  _sniperTick(b, tgt, canSee, dt, game){
    if(!b.gun || b.reloadT>0 || b.fireCd>0 || !canSee || !tgt || !tgt.alive){
      b.aimT=0; b.aimAng=null; return true;
    }
    if(b.aimAng===null || b.aimAng===undefined){ b.aimAng=b.angle; b.aimT=0; }
    b.angle=b.aimAng;                                  // 预警期间不再追踪目标
    b.aimT+=dt;
    if(b.aimT>=RAID_SNIPER_AIM){
      b.aimT=0; b.aimAng=null;
      this._fire(b, b.angle, game);
      b.fireCd=RAID_SNIPER_CD;
    }
    return true;
  },

  /* 医疗兵：每 RAID_MEDIC_CD 秒给半径内**同阵营**受伤单位回一次血。
   * 不给自己回 —— 否则「先杀医疗兵」这条对策就不成立了。 */
  _medicTick(b, dt, game){
    b.healCd=(b.healCd===undefined?RAID_MEDIC_CD:b.healCd)-dt;
    if(b.healCd>0) return;
    b.healCd=RAID_MEDIC_CD;
    let n=0;
    for(const o of this.ops){
      if(o===b || !o.alive || o.isPlayer || o.remote || o.ghost) continue;
      if(o.cls!==b.cls) continue;
      if(o.hp>=o.maxHP) continue;
      if(M.dist(b.x,b.y,o.x,o.y)>RAID_MEDIC_R) continue;
      o.hp=Math.min(o.maxHP, o.hp+o.maxHP*RAID_MEDIC_PCT);
      n++;
    }
    if(n){ this._float(b.x,b.y-42,"+治疗 ×"+n, "#7dffb0"); this._noise(b.x,b.y,120,null); }
  },

  /* ---- v0.39.0：契约进度 / 阵亡装备赎回（引擎侧两个 hook 的实现） ---- */

  /* =========================================================================
   * v0.40.1（用户反馈）：「护甲实际上已经穿上了，却还显示在背包里、还能点『穿上护甲』，
   * 而且这个状态下按钮怎么点都没反应」。
   *
   * 引擎侧的穿戴链路（换新甲 / 旧甲回包 / 破损按耐久折算）经实测是对的，问题出在
   * **同一件装备同时挂在 carried 与 inv 两处**时：物品栏会把它渲染两遍，两行同名同款，
   * 点「穿上护甲」等于把它自己再穿一次（视觉零变化），点「丢弃」又会把身上那件
   * 从背包里删掉而身上还在 —— 表现就是「按钮全部无效」。
   *
   * 这里做两件事：
   *   ① 渲染前自愈：凡是已经穿戴中的护甲/头盔/护盾，绝不留在背包列表里（同引用或同 uid 都算）；
   *   ② 背包行补上「耐久 %」，让「同款两件」一眼能区分，不会误以为没换。
   * 只在护甲/头盔/护盾上生效 —— 枪是设计上就同时存在于 inv（_gunBag 靠 uid 过滤）。 */
  _invHealDupes(){
    const inv=this.inv, car=this.carried;
    if(!inv || !car) return 0;
    let n=0;
    const each=[["armors","armor"],["helmets","helmet"],["shields","shield"]];
    for(const [key,slot] of each){
      const worn=car[slot];
      const arr=inv[key];
      if(!worn || !arr || !arr.length) continue;
      const keep=arr.filter(it=>{
        const dup = it===worn || (it && worn && it.uid!==undefined && it.uid===worn.uid);
        if(dup) n++;
        return !dup;
      });
      if(keep.length!==arr.length) inv[key]=keep;
    }
    return n;
  },

  /* 撤离成功那一次，把所有「本局结算类」契约一起推进：件数 / 现金 / 存活时长。   * 合并成一个方法是为了不再往 raid-core3 里加行（那边只剩 1 行余量）。 */
  _extractContractTicks(){
    const n=this.inv.weapons.length+this.inv.armors.length+this.inv.helmets.length
      +(this.inv.shields||[]).length+this.inv.parts.length+this.inv.materials.length
      +(this.inv.keys||[]).length;
    this._contractTick("extract", n);
    this._contractTick("money", Math.round(this.creds||0));
    this._contractTick("time", Math.round((this.raidDuration||0)-(this.timer||0)));
  },

  /* 契约进度。raid-core3 只负责在正确的时机调一行，判定与发奖都在这里 + raid-legends。 */
  _contractTick(kind, n){
    if(!kind || !this.stash) return;
    const r=raidContractProgress(this.stash, kind, n||1);
    if(!r || !r.done) return;
    const g=r.grant||{};
    this._feed("契约", "完成：「"+(g.name||"奖励已发放")+"」"+(g.perk?(" —— "+g.perk):""), "奖励", false, "extract");
    if(this.game && this.game.toast) this.game.toast("契约完成："+(g.name||"奖励已发放"));
    if(typeof RaidStash!=="undefined" && RaidStash.save) RaidStash.save(this.stash);
  },

  /* 阵亡后：把「投保了但没退回来」的装备挂进 24h 赎回池。
   * 没投保 = 全丢（惩罚不变）；投保了 = 65% 免费退回 + 其余可付 300% 赎回来。 */
  _recordBuyback(carried, recovered){
    if(!this.insured || !this.stash) return 0;
    const back=new Set((recovered||[]).map(it=>it && it.uid));
    const pool=[];
    for(const w of (carried && carried.weapons) || []) if(w && !back.has(w.uid)) pool.push(w);
    for(const k of ["armor","helmet","shield"]){ const it=carried && carried[k]; if(it && !back.has(it.uid)) pool.push(it); }
    return raidBuybackAdd(this.stash, pool, Date.now());
  }
};

/* ---- v0.39.0 常量（放在 raid-core.js 尾部：raid-data.js 已无行数余量） ---- */
const RAID_SNIPER_AIM = 0.8;      // 狙击手激光预警时长（秒）：玩家看到线到挨枪之间的反应窗口
const RAID_SNIPER_CD  = 2.6;      // 两枪之间的间隔（含预警），远了不敢站桩，近了打不动
const RAID_MEDIC_CD   = 4.5;      // 医疗兵治疗间隔
const RAID_MEDIC_R    = 340;      // 治疗半径：站在这个圈里的敌人才吃得到
const RAID_MEDIC_PCT  = 0.22;     // 每次回复的最大生命比例
/* 精英随机词条池。每条都只改乘区，消费点分别在：
 * 速度 → 移动（既有）／生命 → 血条（既有）／受伤 → _damage 里的 affixDmgTaken
 * ／精度 → AI 开火抖动 affixJitter／召唤 → 半血呼叫增援（复用 _callReinforce） */
const RAID_ELITE_AFFIX = [
  { id:"swift",    name:"迅猛",   apply:(o)=>{ o.speed=Math.round(o.speed*1.30); } },
  { id:"sturdy",   name:"顽强",   apply:(o)=>{ o.maxHP=Math.round(o.maxHP*1.40); o.hp=o.maxHP; } },
  { id:"hardened", name:"硬化",   apply:(o)=>{ o.affixDmgTaken=0.72; } },
  { id:"marksman", name:"神射",   apply:(o)=>{ o.affixJitter=0.40; } },
  { id:"summoner", name:"召唤者", apply:(o)=>{ o.affixSummon=true; } },
];

/* ---- v0.39.0：两种「改变玩家走位」的精英，挂在既有 RAID_ARCH 表上 ----
 * 为什么用 Object.assign 而不是直接写进 raid-data.js：那张表所在文件只剩 1 行余量。
 * 加载顺序 raid-data → raid-core 保证这里赋值时 RAID_ARCH 已存在；
 * raidAISense() 只在运行时读表，所以晚绑定不会漏。 */
Object.assign(RAID_ARCH, {
  /* 狙击手：视距 1500（远超 PMC 900），但一枪之间有 0.8s 激光预警。
   * 「站在开阔地就会被点名」——正确应对是进掩体 / 断视线，而不是对枪。 */
  sniper: {
    label:"狙击手", short:"狙击手", color:"#ff5a4a",
    sense:{ sight:1500, memory:7.0, react:0.20, hunt:0.55, hear:0.80 },
    hpMul:2.2, speed:62, r:16, armorTier:4, helmetTier:4, frontShield:0,
    lootLimit:4, note:"超视距点名，开火前有激光预警 —— 看到红线就进掩体",
  },
  /* 医疗兵：自己不打输出，给周围同阵营回血 —— 不先处理掉，前排就是打不死的。
   * 刻意做成「后排软目标」：血量高、护甲薄、不主动贴脸。 */
  medic: {
    label:"医疗兵", short:"医疗兵", color:"#7dffb0",
    sense:{ sight:820, memory:5.0, react:0.32, hunt:0.45, hear:1.20 },
    hpMul:3.0, speed:96, r:15, armorTier:2, helmetTier:2, frontShield:0,
    lootLimit:3, note:"给周围敌人回血，优先击杀，否则前排打不动",
  },
});
