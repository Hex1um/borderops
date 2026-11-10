/* =========================================================================
 * player.js — 玩家：属性 / 升级 / 技能加点 / 装备 / 主动技能
 * ========================================================================= */

const AMMO_MAX = { pistol:120, smg:300, shotgun:90, rifle:240, sniper:60, launcher:30 };
function startAmmo(){
  const a={}; for(const k in AMMO_MAX) a[k]=Math.round(AMMO_MAX[k]*0.6); return a;
}

class Player {
  constructor(classId, x, y, name){
    const C=CLASSES[classId];
    this.classId=classId; this.name=name||C.name;
    this.x=x; this.y=y; this.vx=0; this.vy=0; this.angle=0; this.facing=1;
    this.radius=CFG.player.radius;
    this.level=1; this.xp=0; this.skillPoints=1;
    this.skills={};
    this.alive=true;
    this.shieldTimer=0; this.recoil={x:0,y:0};
    this.abilityType=C.ability.type;
    this.abilityBaseCD=C.ability.cd;
    this.abilityName=C.ability.name;
    this.abilityCD=0; this.abilityActive=0;
    this.moveX=0; this.moveY=0;
    this.meleeCd=0;
    this.gold=300;                     // 起始金币（通用货币）
    this.eridium=0;                    // 美元（黑市专用货币，不与金币互换）
    this.ammo=startAmmo();
    this.weapons=[]; this.wi=0;
    this.weapons.push(generateWeapon(1,{type:"pistol",rarity:"green"}));
    this.weapons.push(generateWeapon(1,{type:"smg",rarity:"green"}));
    /* ---- 护甲 / 随身装备（装备槽） ---- */
    this.shields=[]; this.shieldIdx=-1;
    this.relics=[];  this.relicIdx=-1;
    this.shields.push(generateShield(1,{rarity:"white"}));
    this.shieldIdx=0;
    this._shieldBrokenFx=0;
    this._leveledUp=false;
    this.iframe=0;                     // 受击无敌帧（防被围殴瞬秒）
    /* ---- 改装 / 重新部署 ---- */
    this.souls=0;                      // 功勋（重新部署货币，跨重新部署保留）
    this.rebirths=0;                   // 累计重新部署次数
    this.perm={ hp:0, dmg:0, mf:0, gf:0, soul:0, drop:0 };  // 永久升级等级
    this.mayhem=0;                     // 当前改装等级
    this.mayhemUnlocked=false;         // 通关后解锁
    this.mayhemCapBonus=0;             // 功勋购买的额外上限次数
    this.computeStats();
    this.hp=this.stats.maxHP; this.shield=this.stats.maxShield;
    this.bounds=null;
  }

  get activeWeapon(){ return this.weapons[this.wi]; }
  get mf(){ return this.stats.mf; }     // 搜集效率（影响高品质权重）
  get shieldItem(){ return this.shields[this.shieldIdx] || null; }
  get relicItem(){ return this.relics[this.relicIdx] || null; }

  /* ----------------------------- 属性计算 ----------------------------- */
  permVal(id){
    const u=PERM_UPGRADES.find(x=>x.id===id);
    return u ? (this.perm[id]||0)*u.per : 0;
  }
  permCost(id){
    const u=PERM_UPGRADES.find(x=>x.id===id);
    if(!u) return Infinity;
    return Math.round(u.base * Math.pow(u.grow, this.perm[id]||0));
  }
  computeStats(){
    const C=CLASSES[this.classId];
    const m=computeSkillMods(this.classId,this.skills);
    const pHp=this.permVal("hp"), pDmg=this.permVal("dmg"), pMf=this.permVal("mf"),
          pGf=this.permVal("gf"), pDrop=this.permVal("drop");
    // 等级成长：生命每级 +6%、护甲每级 +5%，否则高改装下永远是 90 血必死
    const lvHp = 1 + (this.level-1)*0.06;
    const lvSh = 1 + (this.level-1)*0.05;

    /* ---- 护甲 / 随身装备 ---- */
    const sh = this.shieldItem, rl = this.relicItem;
    const rm = relicModMap(rl);
    const shieldCap = sh ? sh.capacity : 0;
    // 护甲不再是「职业白送、脱战自动满」：职业只提供薄薄一层缓冲，主体来自装备
    /* v0.38.0（P1）：技能树里 3 个节点给了 maxShieldAdd（护甲容量 +18/+22/+10），
       但这里从来没加过 —— 加点完全无效。补进底材再乘等级/词条。 */
    const maxShield = Math.round(((C.shield*0.32 + shieldCap + m.maxShieldAdd) * lvSh) * (1+(rm.shieldPct||0)/100));
    const shieldDelay = Math.max(0.8, (sh ? sh.delay : CFG.player.shieldDelay) - (rm.shieldDelay||0));
    const shieldRate  = sh ? sh.rate : CFG.player.shieldRegen*0.35;

    this.stats={
      maxHP: Math.round((C.hp + m.maxHPAdd)*m.maxHPMul*lvHp*(1+pHp/100)),
      maxShield,
      shieldDelay,
      shieldRate,
      /* v0.38.0（P1）：负重行军 / 短距冲刺给的是 speedMul（+5%/级、+6%/级），
         旧版只算随身装备的 moveSpeed，加点不生效。 */
      speed: C.speed * m.speedMul * (1+(rm.moveSpeed||0)/100),
      damageMul: C.dmgMul * m.dmgMul * (1+pDmg/100) * (1+(rm.dmgPct||0)/100),
      elemMul: C.elemMul * m.elemMul * (1+(rm.elemPct||0)/100),
      fireRateMul: m.fireRateMul * (1+(rm.fireRatePct||0)/100),
      critAdd: m.critAdd + (rm.critChance||0)/100,
      critDmgAdd: (rm.critDmg||0),
      magMul: m.magMul * (1+(rm.magPct||0)/100),
      reloadMul: m.reloadMul / (1+(rm.reloadPct||0)/100),
      lootMul: m.lootMul,
      mf: Math.round((m.lootMul-1)*120 + pMf + (rm.mfFlat||0)),   // 掉落加成 + 重新部署寻宝 + 随身装备
      goldMul: (m.lootMul-1)*0.8 + pGf/100 + (rm.goldPct||0)/100,
      dropBonus: pDrop/100,
      abilityPower: m.abilityPower,
      abilityCDMul: m.abilityCDMul * (1-Math.min(0.4,(rm.abilityCD||0)/100)),
      xpMul: m.xpMul * (1+(rm.xpPct||0)/100),
      meleeMul: m.meleeMul,
      accuracyMul: m.accuracyMul,
      shieldRegen: shieldRate,
    };
    if(this.hp>this.stats.maxHP) this.hp=this.stats.maxHP;
    if(this.shield>this.stats.maxShield) this.shield=this.stats.maxShield;
    const w=this.activeWeapon; if(w && w.mag>w.getMagSize(this)) w.mag=w.getMagSize(this);
  }
  // 主动技能期间的实时加成
  effDamageMul(){
    let mul=this.stats.damageMul;
    if(this.abilityActive>0&&this.abilityType==="bloodlust") mul*=1.6;
    if(this.abilityActive>0&&this.abilityType==="overload") mul*=1.3;
    // 随身装备 / 防弹插板：贴合剪裁（完整贴合时防护与稳定更好）
    const sh=this.shieldItem;
    if(sh && sh.effect==="amp" && this.stats.maxShield>0 && this.shield>=this.stats.maxShield-0.01){
      mul*=1+(sh.effectVal||0)/100;
    }
    return mul;
  }
  effFireRateMul(){ return this.stats.fireRateMul * (this.abilityActive>0&&this.abilityType==="overload"?1.8:1); }
  effAccuracyMul(){ return this.stats.accuracyMul; }
  effReloadMul(){ return this.stats.reloadMul; }
  effCritAdd(){ return this.stats.critAdd; }
  effSpeed(){ return this.stats.speed * (this.abilityActive>0&&this.abilityType==="bloodlust"?1.28:1); }
  // 持枪移速加成（枪身/枪托词缀「移动速度」）
  effMoveMul(){ const w=this.activeWeapon; return w&&w.stats&&w.stats.moveMul ? w.stats.moveMul : 1; }
  // 后坐力减免（握把/枪口/扳机词缀「后坐力」）
  effRecoilMul(){ const w=this.activeWeapon; return w&&w.stats&&w.stats.recoil ? (1 - w.stats.recoil/100) : 1; }

  /* ----------------------------- 升级 ----------------------------- */
  // 成长曲线：55*lv^1.5 + 45*lv，前期线性化的早期补偿让升级更快
  xpNeeded(){
    const lv=this.level;
    const base=55*Math.pow(lv,1.5)+45*lv;
    const early = lv<15 ? 0.18+0.06*(lv-1) : 1;
    return Math.round(base*early);
  }
  addXP(n){
    n*=this.stats.xpMul; this.xp+=n;
    let need=this.xpNeeded();
    while(this.xp>=need){          // 等级无上限
      this.xp-=need; this.level++; this.skillPoints+=CFG.level.skillPointsPerLevel;
      this.computeStats(); this.hp=this.stats.maxHP; this.shield=this.stats.maxShield;
      this._leveledUp=true; need=this.xpNeeded();
    }
  }
  addSkill(id){
    if(this.skillPoints<=0) return false;
    const list=SKILLS[this.classId]||[]; const sk=list.find(s=>s.id===id);
    if(!sk) return false;          // 技能等级不设上限：只要有点就能继续加
    this.skills[id]=(this.skills[id]||0)+1; this.skillPoints--; this.computeStats(); return true;
  }

  /* ----------------------------- 改装等级 ----------------------------- */
  mayhemHpMul(){ return this.mayhem>0 ? Math.pow(MAYHEM.hpMul, this.mayhem) : 1; }
  mayhemDmgMul(){ return this.mayhem>0 ? Math.pow(MAYHEM.dmgMul, this.mayhem) : 1; }
  mayhemXpMul(){ return 1 + this.mayhem*MAYHEM.xpAdd; }
  mayhemLootMul(){ return 1 + this.mayhem*MAYHEM.lootAdd; }
  // 可开启的改装上限：解锁后 1 起步，每次重新部署 +1，功勋购买每次 +5
  maxMayhem(){
    if(!this.mayhemUnlocked) return 0;
    return M.clamp(MAYHEM.capBase + this.rebirths*MAYHEM.capPerRebirth
      + this.mayhemCapBonus*MAYHEM.capBuyStep, 1, 120);
  }
  setMayhem(n){
    const cap=this.maxMayhem();
    if(cap<=0) return { ok:false, msg:"击败军械库守卫后才能开启改装" };
    this.mayhem=M.clamp(Math.round(n), 0, cap);
    this.computeStats();
    return { ok:true, msg:`改装等级 ${this.mayhem}` };
  }
  mayhemCapCost(){ return MAYHEM.capBuyBase + this.mayhemCapBonus*MAYHEM.capBuyPer; }
  buyMayhemCap(){
    if(!this.mayhemUnlocked) return { ok:false, msg:"尚未解锁改装等级" };
    const cost=this.mayhemCapCost();
    if(this.souls<cost) return { ok:false, msg:`功勋不足（需要 ${cost}）` };
    this.souls-=cost; this.mayhemCapBonus++;
    return { ok:true, msg:`改装上限提升至 ${this.maxMayhem()}` };
  }

  /* ----------------------------- 重新部署 ----------------------------- */
  gearScore(){
    let s=0;
    for(const w of this.weapons) s+=weaponPrice(w);
    for(const sh of this.shields) s+=itemPrice(sh);
    for(const r of this.relics) s+=itemPrice(r);
    return s;
  }
  // 本次重新部署可得功勋：等级 + 装备评分 + 改装，整体 ×0.5
  soulsGain(){
    const lvlPart=Math.max(0, this.level-1);
    const gearPart=Math.floor(this.gearScore()/PRESTIGE.gearDiv);
    const mhPart=this.mayhem*PRESTIGE.mayhemSoul;
    const base=lvlPart + gearPart + mhPart;
    const mul=1 + (this.perm.soul||0)*0.1;
    return Math.max(1, Math.round(base*PRESTIGE.base*mul));
  }
  canRebirth(){ return this.level>=PRESTIGE.minLevel; }
  /*
   * 重新部署：等级 / 经验 / 技能 / 武器库 / 金币全部重置，
   * 只保留一把「传承武器」（价值最高的那把），功勋、永久升级、改装上限保留。
   */
  rebirth(){
    if(!this.canRebirth()) return { ok:false, msg:`至少 Lv.${PRESTIGE.minLevel} 才能重新部署` };
    const gain=this.soulsGain();
    const keep=this.weapons.slice().sort((a,b)=>weaponPrice(b)-weaponPrice(a))[0];
    this.souls += gain;
    this.rebirths += 1;

    this.level=1; this.xp=0; this.skillPoints=1; this.skills={};
    this.weapons = keep ? [keep] : [generateWeapon(1,{type:"pistol",rarity:"green"})];
    this.shields = [generateShield(1,{rarity:"white"})]; this.shieldIdx=0;
    this.relics = []; this.relicIdx=-1;
    this.wi=0;    this.gold=PRESTIGE.keepGold;
    this.ammo=startAmmo();
    this.iframe=0;
    this.mayhem=0;                       // 改装等级归零（解锁与上限保留）
    this.computeStats();
    if(keep) keep.mag=keep.getMagSize(this);
    this.hp=this.stats.maxHP; this.shield=this.stats.maxShield;
    return { ok:true, msg:`重新部署完成，+${gain} 功勋`, gain };
  }
  buyPerm(id){
    const u=PERM_UPGRADES.find(x=>x.id===id);
    if(!u) return { ok:false, msg:"无效的升级" };
    const cost=this.permCost(id);
    if(this.souls<cost) return { ok:false, msg:`功勋不足（需要 ${cost}）` };
    this.souls-=cost; this.perm[id]=(this.perm[id]||0)+1;
    this.computeStats();
    return { ok:true, msg:`${u.name} → ${this.perm[id]} 级` };
  }

  /* ----------------------------- 装备 / 商店 ----------------------------- */
  addWeapon(w){
    if(this.weapons.length>=24){ return false; }   // 背包上限
    /* v0.38.0（P2）：捡到的枪不再白送满弹匣。旧版任何来源的枪一进背包就
       mag = 满容量，等于「换枪免费补弹」，配合掉落的枪可无限续弹。
       现在只给半匣（购买走 buyItem，会显式补满，属于花钱买的）。 */
    if(w.mag===undefined || w.mag===null) w.mag=Math.max(1, Math.round(w.getMagSize(this)*0.5));
    this.weapons.push(w);
    return true;
  }
  equip(i){ if(i>=0&&i<this.weapons.length){ this.wi=i; const w=this.weapons[i]; if(w.mag>w.getMagSize(this)) w.mag=w.getMagSize(this); } }
  switchWeapon(){ if(this.weapons.length>1){ this.wi=(this.wi+1)%this.weapons.length; } }

  /* ---- 护甲 / 随身装备 ---- */
  addShield(s){
    if(this.shields.length>=12) return false;
    this.shields.push(s);
    if(this.shieldIdx<0){ this.shieldIdx=this.shields.length-1; this.computeStats(); }
    return true;
  }
  equipShield(i){
    if(i<0||i>=this.shields.length) return;
    const ratio=this.stats.maxShield>0?this.shield/this.stats.maxShield:0;
    this.shieldIdx=i; this.computeStats();
    this.shield=this.stats.maxShield*ratio;            // 换盾按比例保留当前护甲
  }
  sellShield(i){
    if(i<0||i>=this.shields.length) return 0;
    const s=this.shields[i];
    const gold=itemSellGold(s), eri=itemSellEridium(s);
    this.gold+=gold; this.eridium+=eri;
    this.shields.splice(i,1);
    if(this.shieldIdx>=this.shields.length) this.shieldIdx=this.shields.length-1;
    else if(this.shieldIdx>i) this.shieldIdx--;
    this.computeStats();
    if(this.shield>this.stats.maxShield) this.shield=this.stats.maxShield;
    return { gold, eri };
  }
  addRelic(r){
    if(this.relics.length>=12) return false;
    this.relics.push(r);
    if(this.relicIdx<0){ this.relicIdx=this.relics.length-1; this.computeStats(); }
    return true;
  }
  equipRelic(i){
    if(i<0||i>=this.relics.length) return;
    this.relicIdx=i; this.computeStats();
  }
  sellRelic(i){
    if(i<0||i>=this.relics.length) return 0;
    const r=this.relics[i];
    const gold=itemSellGold(r), eri=itemSellEridium(r);
    this.gold+=gold; this.eridium+=eri;
    this.relics.splice(i,1);
    if(this.relicIdx>=this.relics.length) this.relicIdx=this.relics.length-1;
    else if(this.relicIdx>i) this.relicIdx--;
    this.computeStats();
    return { gold, eri };
  }
  // 通用拾取：武器 / 护甲 / 随身装备
  addItem(it){
    if(!it) return false;
    if(it.kind==="shield") return this.addShield(it);
    if(it.kind==="relic")  return this.addRelic(it);
    return this.addWeapon(it);
  }

  // 卖出：回收 25% 价值（高品质额外给美元）
  sellWeapon(i){
    if(this.weapons.length<=1 || i<0 || i>=this.weapons.length) return 0;
    const w=this.weapons[i];
    const gold=Math.max(10, Math.floor(weaponPrice(w)*0.25));
    const eri=itemSellEridium({rarity:w.rarity});
    this.gold+=gold; this.eridium+=eri;
    this.weapons.splice(i,1);
    if(this.wi>=this.weapons.length) this.wi=this.weapons.length-1;
    else if(this.wi>i) this.wi--;
    return { gold, eri };
  }
  buyWeapon(w, price){
    if(this.gold<price) return false;
    if(this.weapons.length>=24) return false;
    this.gold-=price;
    w.mag=w.getMagSize(this);
    this.weapons.push(w);
    return true;
  }

  /* 通用购买：currency = "gold" | "eridium"（黑市专用） */
  buyItem(it, price, currency){
    const useEri = currency==="eridium";
    const cur = useEri ? this.eridium : this.gold;
    if(cur<price) return false;
    const cap = it.kind==="shield" ? 12 : it.kind==="relic" ? 12 : 24;
    const len = it.kind==="shield" ? this.shields.length : it.kind==="relic" ? this.relics.length : this.weapons.length;
    if(len>=cap) return false;
    if(useEri) this.eridium-=price; else this.gold-=price;
    if(it.kind==="weapon") it.mag=it.getMagSize(this);
    this.addItem(it);
    return true;
  }

  /* ----------------------------- 每帧更新 ----------------------------- */
  update(dt, game){
    this.recoil.x*=0.85; this.recoil.y*=0.85;
    const sp=this.effSpeed()*this.effMoveMul();
    this.x += (this.moveX*sp + this.recoil.x)*dt;
    this.y += (this.moveY*sp + this.recoil.y)*dt;
    if(this.bounds){ this.x=M.clamp(this.x,this.bounds.minX,this.bounds.maxX); this.y=M.clamp(this.y,this.bounds.minY,this.bounds.maxY); }

    const w=this.activeWeapon;
    if(w){ w.cd=Math.max(0,w.cd-dt); w.updateReload(dt,this); }

    this.shieldTimer-=dt;
    // 护甲只能按「充能延迟 + 充能速度」恢复，不能随时补满
    if(this.shieldTimer<=0 && this.shield<this.stats.maxShield){
      this.shield=Math.min(this.stats.maxShield, this.shield+this.stats.shieldRate*dt);
    }
    this.shieldCharging = this.shieldTimer<=0 && this.shield<this.stats.maxShield-0.01;
    if(this.abilityCD>0) this.abilityCD-=dt;
    if(this.iframe>0) this.iframe-=dt;
    // v0.21.9：原句 abilityType==="phaselock" 是只比较不执行的死语句；所有技能效果都以 abilityActive>0 作门控，倒计时归零即自然失效
    if(this.abilityActive>0) this.abilityActive-=dt;
    this.meleeCd=Math.max(0,this.meleeCd-dt);
  }

  applyRecoil(angle, amt){ const k=this.effRecoilMul(); this.recoil.x -= Math.cos(angle)*amt*k; this.recoil.y -= Math.sin(angle)*amt*k; }

  /* ----------------------------- 伤害 / 治疗 ----------------------------- */
  takeDamage(amount, element, armorType, game, attacker){
    if(this.iframe>0) return;          // 无敌帧：多只怪同时贴身时不会被一帧打死
    this.iframe=0.4;
    const ammo = AMMO_TYPES[element] || AMMO_TYPES.none;
    const mult = (ammo.mult && ammo.mult[armorType||"flesh"]) || 1;   // 弹种对软目标 / 护甲的终点效应
    let dmg=amount*mult;
    // 任何伤害都会重置整备计时——插板不能边打边自动复原
    this.shieldTimer=this.stats.shieldDelay;
    let broke=false;
    if(this.shield>0){
      const ab=Math.min(this.shield,dmg); this.shield-=ab; dmg-=ab;
      if(this.shield<=0){ this.shield=0; broke=true; }
    }
    if(dmg>0){ this.hp-=dmg; }
    if(broke) this._onShieldBreak(game, attacker);
    if(this.hp<=0){ this.hp=0; this.alive=false; }
    SFX.hurt(); if(game&&game.shake) game.shake(6);
    if(game&&game.addFloatText) game.addFloatText(this.x,this.y-22,"-"+Math.round(amount),"#ff5555");
    // 护甲吸收提示：0.45 秒内只弹一次，避免连击时糊成一堆字
    if(this.shield>0 && amount>0 && game && game.addFloatText){
      const now=performance.now()/1000;
      if(!this._shieldTipT || now-this._shieldTipT>0.45){
        this._shieldTipT=now;
        game.addFloatText(this.x+10,this.y-30,"插板吸收","#9fb0bd");
      }
    }
  }

  /* 插板失效：移除冲击波 / 反伤 / 生命虹吸，只保留「快拆扣具」的整备加速 */
  _onShieldBreak(game, attacker){
    const sh=this.shieldItem;
    const ev=(sh&&sh.effectVal)||0;
    if(sh && sh.effect==="reboot"){
      this.shieldTimer = Math.max(0.35, this.stats.shieldDelay*(1-ev/100));
    }
    if(game && game.addFloatText) game.addFloatText(this.x,this.y-40,"插板失效","#9fb0bd",12);
  }
  heal(n){ this.hp=Math.min(this.stats.maxHP,this.hp+n); }
  healShield(n){ this.shield=Math.min(this.stats.maxShield,this.shield+n); }

  /* ----------------------------- 开火 / 近战 ----------------------------- */
  fire(game, angle){
    const w=this.activeWeapon; if(!w) return;
    // 枪口贴近身体，避免敌人贴脸时子弹生成在它身后
    const mx=this.x+Math.cos(angle)*(this.radius*0.9);
    const my=this.y+Math.sin(angle)*(this.radius*0.9);
    w.fire(game, mx,my,angle,this);
  }
  melee(game){
    if(this.meleeCd>0) return; this.meleeCd=0.42;
    const reach=this.radius+34, dmg=22*this.stats.meleeMul*this.effDamageMul();
    for(const e of game.enemies){
      if(!e.alive) continue;
      const d=M.dist(this.x,this.y,e.x,e.y);
      if(d<reach+e.radius){
        const a=M.angle(this.x,this.y,e.x,e.y);
        if(Math.abs(M.normAngle(a-this.angle))<0.9){
          e.takeDamage(dmg,"none","flesh",game,this);
          // 击退
          e.x+=Math.cos(a)*14; e.y+=Math.sin(a)*14;
          game.spawnHitFx(e.x,e.y,"#fff");
        }
      }
    }
  }

  /* ----------------------------- 主动技能 ----------------------------- */
  ability(game){
    if(this.abilityCD>0) return false;
    const power=this.stats.abilityPower;
    if(this.abilityType==="phaselock"){
      let best=null,bd=1e9;
      for(const e of game.enemies){ if(!e.alive)continue; const d=M.dist(this.x,this.y,e.x,e.y); if(d<420&&d<bd){bd=d;best=e;} }
      if(best){ best.phaselocked=2.2+power*1.5; best.phaseLockedBy=this; game.addFloatText(best.x,best.y-30,"标记锁","#b061ff"); game.spawnHitFx(best.x,best.y,"#b061ff"); }
      else { game.toast("范围内无目标"); return false; }
    } else if(this.abilityType==="turret"){
      spawnTurret(game,this.x,this.y,this);
      game.toast("部署掩护火力");
    } else if(this.abilityType==="bloodlust"){
      this.abilityActive=5+power*3; game.toast("突入！"); game.shake(4);
    } else if(this.abilityType==="overload"){
      this.abilityActive=5+power*3; game.toast("火力压制！"); game.shake(4);
    }
    /* v0.38.0（P1）：技能/装备给的 abilityCDMul 原先只写进 stats 没人读，
       现在真正参与冷却：基础 CD × 系数 × 威力缩减（威力项最多再减 40%）。 */
    this.abilityCD=this.abilityBaseCD*(this.stats&&this.stats.abilityCDMul||1)*(1-Math.min(0.4,power*0.2));
    SFX.levelup();
    return true;
  }
}
