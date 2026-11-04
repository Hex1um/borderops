/* =========================================================================
 * world.js — 区域 / 刷怪 / 战利品掉落 / 宝箱 / 任务目标
 *
 * 刷怪节奏参考刷宝游戏的「配额 + 阶段闸门」：
 *   配额内 → 普通怪；配额清空 → 精英 → BOSS；
 *   怪物等级与玩家同步（player.level-1），避免后期空转。
 * 掉落走完整判定链：ilvl → 件数 → 品质权重 → 词缀（见 weapons.js）。
 * ========================================================================= */

// 区域主题 → 配色与装饰风格（render.js 的 ZONE_PALETTES 与之对应）
const ZONES = [
  { name:"潘多拉·荒漠", theme:"desert",  w:1500, h:1100, level:1,  counts:{psycho:9,bandit:7,skag:5},                              concurrent:7,  chests:2,
    story:"沙尘漫过锈红的废土。强盗的探照灯在远处晃动——你的第一处猎场。" },
  { name:"避难所外围", theme:"ruins",   w:1600, h:1200, level:3,  counts:{psycho:6,bandit:8,marauder:6,turret:2,wraith:3},        concurrent:8,  chests:2,
    story:"古文明的残垣断壁里藏着军火。幽灵兽在石柱间若隐若现。" },
  { name:"强盗营地",   theme:"camp",     w:1700, h:1250, level:5,  counts:{bandit:8,marauder:8,skag:5,badass:1,turret:3,berserker:3}, concurrent:9,  chests:3,
    story:"营地中央的狂暴兽被铁链锁着，闻到血味便开始低吼。" },
  { name:"寒霜裂谷",   theme:"ice",      w:1700, h:1300, level:7,  counts:{cryomancer:6,spitter:4,shieldbearer:4,skag:4},           concurrent:8,  chests:3,
    story:"冰晶在岩壁上疯长。冰霜师指尖凝出蓝色的霜刃。" },
  { name:"腐蚀沼泽",   theme:"swamp",    w:1750, h:1300, level:9,  counts:{spitter:7,skag:6,bomber:5,bandit:5},                     concurrent:9,  chests:3,
    story:"绿稠的毒雾贴着水面漂。自爆虫在泥里蠕动，遇热便炸。" },
  { name:"熔岩深坑",   theme:"volcano",  w:1800, h:1350, level:11, counts:{bomber:6,juggernaut:3,marauder:7,turret:3},              concurrent:9,  chests:3,
    story:"脚下的地壳在呼吸。重装碾过熔岩，毫发无伤。" },
  { name:"远古遗迹",   theme:"tech",     w:1800, h:1400, level:13, counts:{shieldbearer:5,wraith:5,broodmother:2,marauder:6},        concurrent:9,  chests:4,
    story:"机械与符文交错。巢母在穹顶下孵化着成群的幼体。" },
  { name:"虚空回廊",   theme:"void",     w:1850, h:1400, level:15, counts:{cryomancer:5,berserker:5,juggernaut:3,wraith:4},         concurrent:10, chests:4,
    story:"紫色的虚空在低语。这里的怪物体表流动着不属于物质的光。" },
  { name:"巢穴深渊",   theme:"hive",     w:1850, h:1450, level:17, counts:{broodmother:3,spitter:6,wraith:5,skag:6},               concurrent:10, chests:4,
    story:"无数复眼在黑暗中睁开。巢母就在最深处，等待献祭。" },
  { name:"秘藏神殿",   theme:"sanctum",  w:1900, h:1450, level:20, counts:{psycho:8,bandit:8,marauder:6,badass:2,berserker:4,wraith:4}, concurrent:9, chests:5, boss:true,
    story:"传说中的秘藏守卫端坐于黄金王座。夺下它，潘多拉便是你的。" },
];

class Zone {
  constructor(def, game){
    this.def=def; this.name=def.name; this.level=def.level;
    this.theme=def.theme||"desert";
    this.story=def.story||"";
    this.index=ZONES.indexOf(def);
    this.bounds={minX:0,minY:0,maxX:def.w,maxY:def.h};
    this.spawnQueue=[];
    for(const t in def.counts){ for(let i=0;i<def.counts[t];i++) this.spawnQueue.push(t); }
    // 洗牌
    for(let i=this.spawnQueue.length-1;i>0;i--){ const j=Math.floor(RNG.f()*(i+1)); [this.spawnQueue[i],this.spawnQueue[j]]=[this.spawnQueue[j],this.spawnQueue[i]]; }
    this.total=this.spawnQueue.length;
    this.maxConcurrent=def.concurrent||9;
    this.spawnTimer=0.8;
    this.bossSpawned=false; this.complete=false;
    this.chests=[]; this._placeChests(def.chests||2, game);
  }
  _placeChests(n, game){
    for(let i=0;i<n;i++){
      const x=RNG.fr(this.bounds.minX+200,this.bounds.maxX-200);
      const y=RNG.fr(this.bounds.minY+200,this.bounds.maxY-200);
      this.chests.push({x,y,opened:false,tier:RNG.chance(0.35)?"epic":"rare",count:RNG.ri(2,3)});
    }
  }
  objective(){
    if(this.def.boss) return `目标：清剿 ${this.total} 名敌人并击败秘藏守卫`;
    return `目标：清剿 ${this.total} 名敌人`;
  }
  remaining(){ return this.spawnQueue.length + (this.def.boss && !this.bossSpawned ? 1 : 0); }

  /* 怪物有效等级：区域内等级与玩家同步；混乱开启后再额外拔高 */
  spawnLevel(pl, boss=false){
    const base = Math.max(this.level, pl ? (boss ? pl.level : pl.level-1) : this.level);
    if(!pl || !pl.mayhem) return base;
    const mhLv = pl.level + Math.floor(pl.mayhem*MAYHEM.lvlStep) + MAYHEM.lvlBase;
    return Math.max(base, mhLv);
  }

  update(dt, game){
    if(this.complete) return;
    const pl=game.player;

    // 刷怪：快节奏小批量
    if(this.spawnQueue.length>0 && game.enemies.length<this.maxConcurrent){
      this.spawnTimer-=dt;
      if(this.spawnTimer<=0){
        const n=RNG.ri(1,2);
        for(let i=0;i<n && this.spawnQueue.length>0;i++){
          const t=this.spawnQueue.pop();
          const p=this._edgeSpawn(game);
          game.enemies.push(makeEnemy(t, this.spawnLevel(pl), p.x, p.y, pl?pl.mayhem:0));
        }
        this.spawnTimer=RNG.fr(0.55,1.15);
      }
    }

    // 阶段闸门：配额清空 -> BOSS
    if(this.def.boss && !this.bossSpawned && this.spawnQueue.length===0 && game.enemies.length===0){
      const p=this._edgeSpawn(game,true);
      game.enemies.push(makeEnemy("boss", this.spawnLevel(pl,true), p.x,p.y, pl?pl.mayhem:0));
      this.bossSpawned=true;
      game.toast("秘藏守卫降临！");
      game.shake(8);
    }

    // 宝箱
    for(const c of this.chests){
      if(!c.opened && pl && M.dist(pl.x,pl.y,c.x,c.y)<64){
        c.opened=true;
        const ilvl = Math.max(this.level, pl.level) + 1 + (pl.mayhem||0);
        for(let i=0;i<c.count;i++){
          const gm = rollGearMayhem(pl.mayhem||0);
          const it=generateItem(ilvl+gm, { mf:pl.mf, luck:c.tier==="epic", mayhem:gm, kind:rollItemKind() });
          pushGear(game, c.x+RNG.fr(-26,26), c.y+RNG.fr(-26,26), it);
        }
        game.loot.push(new Loot(c.x,c.y,"health"));
        game.loot.push(new Loot(c.x+12,c.y,"ammo"));
        if(RNG.chance(0.4)) game.loot.push(new Loot(c.x-12,c.y+16,"shieldcell"));
        if(pl.eridium!==undefined){ pl.eridium+=ERIDIUM.chest; game.addFloatText(c.x,c.y-40,"+"+ERIDIUM.chest+" 镒矿","#b061ff",11); }
        const gold=Math.round((40+this.level*22)*RNG.fr(0.8,1.6)*(pl.mayhemLootMul?pl.mayhemLootMul():1));
        pl.gold+=gold;
        game.addFloatText(c.x,c.y-24,"+"+gold+" 金","#ffd23f",13);
        game.spawnHitFx(c.x,c.y,"#ffd23f");
        SFX.pickup();
      }
    }

    // 完成判定
    const cleared = this.spawnQueue.length===0 && game.enemies.length===0;
    if(cleared && (!this.def.boss || this.bossSpawned)){ this.complete=true; game.onZoneComplete(this); }
  }

  _edgeSpawn(game, far=false){
    const b=this.bounds, pl=game.player;
    for(let tries=0;tries<20;tries++){
      const side=Math.floor(RNG.f()*4);
      let x,y;
      if(side===0){x=RNG.fr(b.minX+40,b.maxX-40);y=b.minY+40;}
      else if(side===1){x=RNG.fr(b.minX+40,b.maxX-40);y=b.maxY-40;}
      else if(side===2){x=b.minX+40;y=RNG.fr(b.minY+40,b.maxY-40);}
      else {x=b.maxX-40;y=RNG.fr(b.minY+40,b.maxY-40);}
      if(!far || !pl || M.dist(x,y,pl.x,pl.y)>300) return {x,y};
    }
    return {x:b.maxX-60,y:b.maxY-60};
  }
}

/* ----------------------------- 战利品 ----------------------------- */
class Loot {
  constructor(x,y,kind,item){
    this.x=x; this.y=y; this.kind=kind; this.item=item||null;
    // 兼容旧字段
    this.weapon = kind==="weapon" ? item : null;
    this.bob=Math.random()*6.28; this.picked=false;
    this.color = (kind==="weapon"||kind==="shielditem"||kind==="relic")
      ? (RARITY_BY_ID[item.rarity]||RARITIES[0]).color
      : kind==="health"?"#5bd66a" : kind==="ammo"?"#ffd23f" : kind==="shieldcell"?"#3fa9f5":"#fff";
  }
  get isGear(){ return this.kind==="weapon"||this.kind==="shielditem"||this.kind==="relic"; }
  label(){
    if(this.kind==="weapon") return this.item.name;
    if(this.kind==="shielditem") return this.item.name;
    if(this.kind==="relic") return this.item.name;
    return this.kind==="health" ? "医疗包" : this.kind==="ammo" ? "弹药" : "护盾电池";
  }
  pickup(game){
    const pl=game.player;
    if(this.isGear){
      const ok=pl.addItem(this.item);
      if(ok){
        game.toast("获得 "+this.item.name);
        game.addFloatText(this.x,this.y-20,(RARITY_BY_ID[this.item.rarity]||RARITIES[0]).name,"#ffd23f",13);
      } else {
        // 背包已满：自动分解成金币 + 镒矿，避免白捡
        const gold=Math.max(10, Math.floor(itemPrice(this.item)*0.25));
        const eri=itemSellEridium(this.item);
        pl.gold+=gold; pl.eridium+=eri;
        game.toast(`背包已满 · 分解 +${gold} 金${eri?` +${eri} 镒矿`:""}`);
        game.addFloatText(this.x,this.y-20,"+"+gold,"#ffd23f",12);
      }
      SFX.pickup();
    }
    else if(this.kind==="health"){ pl.heal(35); game.toast("+35 生命"); SFX.pickup(); }
    else if(this.kind==="ammo"){ for(const k in AMMO_MAX) pl.ammo[k]=Math.min(AMMO_MAX[k], pl.ammo[k]+Math.round(AMMO_MAX[k]*0.3)); game.toast("补充弹药"); SFX.pickup(); }
    else if(this.kind==="shieldcell"){
      // 护盾电池：只能补一部分，且会重置充能延迟，不能当成无限回盾
      const add=Math.round(pl.stats.maxShield*0.45);
      pl.healShield(add); pl.shieldTimer=pl.stats.shieldDelay;
      game.toast(`护盾电池 +${add}`); SFX.pickup();
    }
    this.picked=true;
  }
}

/* ----------------------------- 掉落链 ----------------------------- */
function lootKindOf(it){ return it.kind==="shield" ? "shielditem" : it.kind==="relic" ? "relic" : "weapon"; }
function pushGear(game,x,y,it){
  game.loot.push(new Loot(x, y, lootKindOf(it), it));
}

function dropLoot(game, e){
  const pl=game.player, zd=game.world;
  if(!pl||!zd) return;

  const mh = pl.mayhem||0;                                   // 当前混乱等级
  const lootMul = pl.mayhemLootMul ? pl.mayhemLootMul() : 1;  // 金币 / 掉落数量加成
  // 物品等级：区域与怪物取高，首领/精英加成，混乱再整体抬高
  const ilvl = Math.max(zd.level, e.level) + (e.isBoss?4:e.isMini?2:0) + RNG.ri(0,2) + mh;

  /* ---- 镒矿：精英 / 首领 / 小概率精英怪 ---- */
  let eri=0;
  if(e.isBoss) eri=ERIDIUM.boss;
  else if(e.isMini) eri=ERIDIUM.mini;
  else if(RNG.chance(ERIDIUM.eliteChance)) eri=ERIDIUM.eliteAmount;
  if(eri>0 && pl.eridium!==undefined){
    pl.eridium+=eri;
    game.addFloatText(e.x+18, e.y-36, "+"+eri+" 镒矿", "#b061ff", 12);
  }

  // 金币：直接入账，不落地
  const base = DROP.goldBase + zd.level*DROP.goldPerLv + RNG.ri(0, zd.level*DROP.goldSpread);
  const gold = Math.round(base * (e.isBoss?DROP.goldBoss:e.isMini?DROP.goldMini:1) * (1+(pl.stats.goldMul||0)) * lootMul);
  pl.gold += gold;
  game.addFloatText(e.x, e.y-26, "+"+gold, "#ffd23f", 11);

  // 消耗品
  if(RNG.chance(DROP.potion*lootMul)) game.loot.push(new Loot(e.x+RNG.fr(-14,14),e.y+RNG.fr(-14,14),"health"));
  if(RNG.chance(DROP.ammo*lootMul))   game.loot.push(new Loot(e.x+RNG.fr(-14,14),e.y+RNG.fr(-14,14),"ammo"));
  if(RNG.chance(0.045*lootMul))       game.loot.push(new Loot(e.x+RNG.fr(-14,14),e.y+RNG.fr(-14,14),"shieldcell"));

  // 装备：件数 -> 类型（武器/护盾/圣物）-> 品质 -> 混乱等级 -> 词缀
  const chance = (DROP.itemChanceBase + (e.isBoss?DROP.bossBonus:e.isMini?DROP.miniBonus:0) + zd.level*DROP.itemChancePerLv) * lootMul
               + (pl.stats.dropBonus||0);
  const n = e.isBoss ? RNG.ri(DROP.bossCount[0],DROP.bossCount[1])
          : e.isMini ? RNG.ri(DROP.miniCount[0],DROP.miniCount[1])
          : (RNG.chance(M.clamp(chance,0,0.95)) ? 1 : 0);

  for(let i=0;i<n;i++){
    const gm = rollGearMayhem(mh);
    const kind = rollItemKind();
    const it = generateItem(ilvl+gm, { mf:pl.mf, luck:e.isBoss, mayhem:gm, kind });
    pushGear(game, e.x+RNG.fr(-18,18), e.y+RNG.fr(-18,18), it);
  }

  // BOSS 保底：传奇武器 + 护盾 + 圣物
  if(e.isBoss){
    const gm = rollGearMayhem(mh);
    const legend = generateWeapon(ilvl+gm+2, { rarity:"orange", mayhem:gm });
    pushGear(game, e.x-24, e.y, legend);

    const gm2 = rollGearMayhem(mh);
    const extra = generateWeapon(ilvl+gm2+2, { mf:pl.mf+80, luck:true, mayhem:gm2 });
    pushGear(game, e.x+24, e.y, extra);

    pushGear(game, e.x, e.y+26, generateShield(ilvl+2, { mf:pl.mf+60, luck:true }));
    if(RNG.chance(0.7)) pushGear(game, e.x+40, e.y+26, generateRelic(ilvl+2, { mf:pl.mf+60, luck:true }));

    game.loot.push(new Loot(e.x-40,e.y+26,"shieldcell"));
    game.addFloatText(e.x, e.y-50, "传奇掉落！", "#ff8a1e", 16);
  }
}
