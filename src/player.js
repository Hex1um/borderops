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
    this.statusEffects=[];
    this.moveX=0; this.moveY=0;
    this.meleeCd=0;
    this.gold=300;                     // 起始金币（通用货币）
    this.eridium=0;                    // 镒矿（黑市专用货币，不与金币互换）
    this.ammo=startAmmo();
    this.weapons=[]; this.wi=0;
    this.weapons.push(generateWeapon(1,{type:"pistol",rarity:"green"}));
    this.weapons.push(generateWeapon(1,{type:"smg",rarity:"green"}));
    /* ---- 护盾 / 圣物（装备槽） ---- */
    this.shields=[]; this.shieldIdx=-1;
    this.relics=[];  this.relicIdx=-1;
    this.shields.push(generateShield(1,{rarity:"white"}));
    this.shieldIdx=0;
    this._shieldBrokenFx=0;
    this._leveledUp=false;
    this.iframe=0;                     // 受击无敌帧（防被围殴瞬秒）
    /* ---- 混乱 / 转生 ---- */
    this.souls=0;                      // 灵魂（转生货币，跨转生保留）
    this.rebirths=0;                   // 累计转生次数
    this.perm={ hp:0, dmg:0, mf:0, gf:0, soul:0, drop:0 };  // 永久升级等级
    this.mayhem=0;                     // 当前混乱等级
    this.mayhemUnlocked=false;         // 通关后解锁
    this.mayhemCapBonus=0;             // 灵魂购买的额外上限次数
    this.computeStats();
    this.hp=this.stats.maxHP; this.shield=this.stats.maxShield;
    this.bounds=null;
  }

  get activeWeapon(){ return this.weapons[this.wi]; }
  get mf(){ return this.stats.mf; }     // 魔法寻找（影响高品质权重）
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
    // 等级成长：生命每级 +6%、护盾每级 +5%，否则高混乱下永远是 90 血必死
    const lvHp = 1 + (this.level-1)*0.06;
    const lvSh = 1 + (this.level-1)*0.05;

    /* ---- 护盾 / 圣物 ---- */
    const sh = this.shieldItem, rl = this.relicItem;
    const rm = relicModMap(rl);
    const shieldCap = sh ? sh.capacity : 0;
    // 护盾不再是「职业白送、脱战自动满」：职业只提供薄薄一层缓冲，主体来自装备
    const maxShield = Math.round(((C.shield*0.32 + shieldCap) * lvSh) * (1+(rm.shieldPct||0)/100));
    const shieldDelay = Math.max(0.8, (sh ? sh.delay : CFG.player.shieldDelay) - (rm.shieldDelay||0));
    const shieldRate  = sh ? sh.rate : CFG.player.shieldRegen*0.35;

    this.stats={
      maxHP: Math.round((C.hp + m.maxHPAdd)*m.maxHPMul*lvHp*(1+pHp/100)),
      maxShield,
      shieldDelay,
      shieldRate,
      speed: C.speed * (1+(rm.moveSpeed||0)/100),
      damageMul: C.dmgMul * m.dmgMul * (1+pDmg/100) * (1+(rm.dmgPct||0)/100),
      elemMul: C.elemMul * m.elemMul * (1+(rm.elemPct||0)/100),
      fireRateMul: m.fireRateMul * (1+(rm.fireRatePct||0)/100),
      critAdd: m.critAdd + (rm.critChance||0)/100,
      critDmgAdd: (rm.critDmg||0),
      magMul: m.magMul * (1+(rm.magPct||0)/100),
      reloadMul: m.reloadMul / (1+(rm.reloadPct||0)/100),
      lifesteal: m.lifesteal + (rm.lifesteal||0)/100,
      lootMul: m.lootMul,
      mf: Math.round((m.lootMul-1)*120 + pMf + (rm.mfFlat||0)),   // 掉落加成 + 转生寻宝 + 圣物
      goldMul: (m.lootMul-1)*0.8 + pGf/100 + (rm.goldPct||0)/100,
      dropBonus: pDrop/100,
      abilityPower: m.abilityPower,
      abilityCDMul: m.abilityCDMul * (1-Math.min(0.4,(rm.abilityCD||0)/100)),
      xpMul: m.xpMul * (1+(rm.xpPct||0)/100),
      meleeMul: m.meleeMul,
      statusMul: m.statusMul,
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
    // 圣物/护盾：满盾增幅
    const sh=this.shieldItem;
    if(sh && sh.effect==="amp" && this.stats.maxShield>0 && this.shield>=this.stats.maxShield-0.01){
      mul*=1+(sh.effectVal||0)/100;
    }
    return mul;
  }
  effElemMul(){ return this.stats.elemMul; }
  effFireRateMul(){ return this.stats.fireRateMul * (this.abilityActive>0&&this.abilityType==="overload"?1.8:1); }
  effAccuracyMul(){ return this.stats.accuracyMul; }
  effReloadMul(){ return this.stats.reloadMul; }
  effCritAdd(){ return this.stats.critAdd; }
  effSpeed(){ return this.stats.speed * (this.abilityActive>0&&this.abilityType==="bloodlust"?1.28:1); }
  effLifesteal(){ return this.stats.lifesteal + (this.abilityActive>0&&this.abilityType==="bloodlust"?0.06:0); }
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

  /* ----------------------------- 混乱等级 ----------------------------- */
  mayhemHpMul(){ return this.mayhem>0 ? Math.pow(MAYHEM.hpMul, this.mayhem) : 1; }
  mayhemDmgMul(){ return this.mayhem>0 ? Math.pow(MAYHEM.dmgMul, this.mayhem) : 1; }
  mayhemXpMul(){ return 1 + this.mayhem*MAYHEM.xpAdd; }
  mayhemLootMul(){ return 1 + this.mayhem*MAYHEM.lootAdd; }
  // 可开启的混乱上限：解锁后 1 起步，每次转生 +1，灵魂购买每次 +5
  maxMayhem(){
    if(!this.mayhemUnlocked) return 0;
    return M.clamp(MAYHEM.capBase + this.rebirths*MAYHEM.capPerRebirth
      + this.mayhemCapBonus*MAYHEM.capBuyStep, 1, 120);
  }
  setMayhem(n){
    const cap=this.maxMayhem();
    if(cap<=0) return { ok:false, msg:"击败秘藏守卫后才能开启混乱" };
    this.mayhem=M.clamp(Math.round(n), 0, cap);
    this.computeStats();
    return { ok:true, msg:`混乱等级 ${this.mayhem}` };
  }
  mayhemCapCost(){ return MAYHEM.capBuyBase + this.mayhemCapBonus*MAYHEM.capBuyPer; }
  buyMayhemCap(){
    if(!this.mayhemUnlocked) return { ok:false, msg:"尚未解锁混乱等级" };
    const cost=this.mayhemCapCost();
    if(this.souls<cost) return { ok:false, msg:`灵魂不足（需要 ${cost}）` };
    this.souls-=cost; this.mayhemCapBonus++;
    return { ok:true, msg:`混乱上限提升至 ${this.maxMayhem()}` };
  }

  /* ----------------------------- 转生 ----------------------------- */
  gearScore(){
    let s=0;
    for(const w of this.weapons) s+=weaponPrice(w);
    for(const sh of this.shields) s+=itemPrice(sh);
    for(const r of this.relics) s+=itemPrice(r);
    return s;
  }
  // 本次转生可得灵魂：等级 + 装备评分 + 混乱，整体 ×0.5
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
   * 转生：等级 / 经验 / 技能 / 武器库 / 金币全部重置，
   * 只保留一把「传承武器」（价值最高的那把），灵魂、永久升级、混乱上限保留。
   */
  rebirth(){
    if(!this.canRebirth()) return { ok:false, msg:`至少 Lv.${PRESTIGE.minLevel} 才能转生` };
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
    this.statusEffects=[];
    this.iframe=0;
    this.mayhem=0;                       // 混乱等级归零（解锁与上限保留）
    this.computeStats();
    if(keep) keep.mag=keep.getMagSize(this);
    this.hp=this.stats.maxHP; this.shield=this.stats.maxShield;
    return { ok:true, msg:`转生完成 · +${gain} 灵魂`, gain };
  }
  buyPerm(id){
    const u=PERM_UPGRADES.find(x=>x.id===id);
    if(!u) return { ok:false, msg:"无效的升级" };
    const cost=this.permCost(id);
    if(this.souls<cost) return { ok:false, msg:`灵魂不足（需要 ${cost}）` };
    this.souls-=cost; this.perm[id]=(this.perm[id]||0)+1;
    this.computeStats();
    return { ok:true, msg:`${u.name} → ${this.perm[id]} 级` };
  }

  /* ----------------------------- 装备 / 商店 ----------------------------- */
  addWeapon(w){
    if(this.weapons.length>=24){ return false; }   // 背包上限
    w.mag=w.getMagSize(this);
    this.weapons.push(w);
    return true;
  }
  equip(i){ if(i>=0&&i<this.weapons.length){ this.wi=i; const w=this.weapons[i]; if(w.mag>w.getMagSize(this)) w.mag=w.getMagSize(this); } }
  switchWeapon(){ if(this.weapons.length>1){ this.wi=(this.wi+1)%this.weapons.length; } }

  /* ---- 护盾 / 圣物 ---- */
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
    this.shield=this.stats.maxShield*ratio;            // 换盾按比例保留当前护盾
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
  // 通用拾取：武器 / 护盾 / 圣物
  addItem(it){
    if(!it) return false;
    if(it.kind==="shield") return this.addShield(it);
    if(it.kind==="relic")  return this.addRelic(it);
    return this.addWeapon(it);
  }

  // 卖出：回收 25% 价值（高品质额外给镒矿）
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
    // 状态效果（减速等）
    let slow=1;
    for(let i=this.statusEffects.length-1;i>=0;i--){
      const s=this.statusEffects[i]; s.t-=dt;
      if(s.type==="slow") slow=Math.min(slow,1-s.amt);
      if(s.t<=0) this.statusEffects.splice(i,1);
    }
    const sp=this.effSpeed()*slow*this.effMoveMul();
    this.x += (this.moveX*sp + this.recoil.x)*dt;
    this.y += (this.moveY*sp + this.recoil.y)*dt;
    if(this.bounds){ this.x=M.clamp(this.x,this.bounds.minX,this.bounds.maxX); this.y=M.clamp(this.y,this.bounds.minY,this.bounds.maxY); }

    const w=this.activeWeapon;
    if(w){ w.cd=Math.max(0,w.cd-dt); w.updateReload(dt,this); }

    this.shieldTimer-=dt;
    // 护盾只能按「充能延迟 + 充能速度」恢复，不能随时补满
    if(this.shieldTimer<=0 && this.shield<this.stats.maxShield){
      this.shield=Math.min(this.stats.maxShield, this.shield+this.stats.shieldRate*dt);
    }
    this.shieldCharging = this.shieldTimer<=0 && this.shield<this.stats.maxShield-0.01;
    if(this.abilityCD>0) this.abilityCD-=dt;
    if(this.iframe>0) this.iframe-=dt;
    if(this.abilityActive>0){ this.abilityActive-=dt; if(this.abilityActive<=0) this.abilityType==="phaselock"; }
    this.meleeCd=Math.max(0,this.meleeCd-dt);
  }

  applyRecoil(angle, amt){ const k=this.effRecoilMul(); this.recoil.x -= Math.cos(angle)*amt*k; this.recoil.y -= Math.sin(angle)*amt*k; }

  /* ----------------------------- 伤害 / 治疗 ----------------------------- */
  takeDamage(amount, element, armorType, game, attacker){
    if(this.iframe>0) return;          // 无敌帧：多只怪同时贴身时不会被一帧打死
    this.iframe=0.4;
    const mult = ELEMENTS[element] ? ELEMENTS[element].mult[armorType||"flesh"] : 1;
    let dmg=amount*mult;
    // 任何伤害都会重置充能计时——护盾不能边打边回
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
    // 护盾吸收提示：0.45 秒内只弹一次，避免连击时糊成一堆字
    if(this.shield>0 && amount>0 && game && game.addFloatText){
      const now=performance.now()/1000;
      if(!this._shieldTipT || now-this._shieldTipT>0.45){
        this._shieldTipT=now;
        game.addFloatText(this.x+10,this.y-30,"护盾吸收","#7fd0ff");
      }
    }
  }

  /* 护盾破碎特效 */
  _onShieldBreak(game, attacker){
    const sh=this.shieldItem; if(!sh||!sh.effect) return;
    const ev=sh.effectVal||0;
    if(sh.effect==="nova" && game){
      const R=150;
      for(const e of game.enemies){
        if(!e.alive) continue;
        const d=M.dist(this.x,this.y,e.x,e.y);
        if(d<R) e.takeDamage(ev*ELEMENTS.shock.mult[e.armorType||"flesh"],"shock",e.armorType,game,this);
      }
      game.spawnExplosion(this.x,this.y,R,"#ffb020");
      game.shake(5);
      game.addFloatText(this.x,this.y-30,"破裂冲击","#ffb020",14);
    } else if(sh.effect==="vamp"){
      this.heal(ev);
      game && game.addFloatText && game.addFloatText(this.x,this.y-30,"+"+Math.round(ev),"#5bd66a");
    } else if(sh.effect==="reboot"){
      // 破碎后立刻进入「加速充能」：延迟 ×(1 - val%)
      this.shieldTimer = Math.max(0.35, this.stats.shieldDelay*(1-ev/100));
    } else if(sh.effect==="thorns" && attacker && attacker.takeDamage){
      const back=(attacker.dmg||20)*0.4*ev/100;
      attacker.takeDamage(back,"none",attacker.armorType||"flesh",game,this);
      game && game.spawnHitFx && game.spawnHitFx(attacker.x,attacker.y,"#7bff3a");
    }
    if(game && game.addFloatText) game.addFloatText(this.x,this.y-40,"护盾破碎","#7fd0ff",12);
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
      if(best){ best.phaselocked=2.2+power*1.5; best.phaseLockedBy=this; game.addFloatText(best.x,best.y-30,"相位锁","#b061ff"); game.spawnHitFx(best.x,best.y,"#b061ff"); }
      else { game.toast("范围内无目标"); return false; }
    } else if(this.abilityType==="turret"){
      spawnTurret(game,this.x,this.y,this);
      game.toast("部署炮塔");
    } else if(this.abilityType==="bloodlust"){
      this.abilityActive=5+power*3; game.toast("狂暴！"); game.shake(4);
    } else if(this.abilityType==="overload"){
      this.abilityActive=5+power*3; game.toast("火力过载！"); game.shake(4);
    }
    this.abilityCD=this.abilityBaseCD*(1-Math.min(0.4,power*0.2));
    SFX.levelup();
    return true;
  }
}
