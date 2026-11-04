/* =========================================================================
 * enemies.js — 敌人类型 / AI / BOSS / 友方掩护火力
 *
 * 数值骨架参考刷宝游戏的幂曲线：
 *   baseHP  = 10 + 5.5 * lvl^1.30
 *   baseDMG = 2  + 0.75 * lvl^1.10
 * 再由类型倍率（hpMul / dmgMul）拉开差异，等级同步保证后期不空转。
 * ========================================================================= */

const ENEMY_DEFS = {
  psycho:   { name:"持刀突入者",   radius:16, hpMul:1.6,  dmgMul:1.00, speed:155, armor:"flesh",  color:"#d23b3b", xpMul:1.0, behavior:"melee",   melee:{range:30,cd:0.8} },
  bandit:   { name:"武装分子",   radius:16, hpMul:2.0,  dmgMul:0.85, speed:95,  armor:"flesh",  color:"#9a7245", xpMul:1.2, behavior:"ranged",  ranged:{range:360,cd:1.4,bs:380} },
  marauder: { name:"拾荒者", radius:18, hpMul:3.2,  dmgMul:1.15, speed:82,  armor:"shield", color:"#6f8a5a", xpMul:1.8, behavior:"ranged",  ranged:{range:400,cd:1.05,bs:470} },
  skag:     { name:"军犬", radius:18, hpMul:2.4,  dmgMul:1.20, speed:175, armor:"flesh",  color:"#e07b1f", xpMul:1.6, behavior:"charger", melee:{range:30,cd:0.7} },
  turret:   { name:"固定火力点",   radius:16, hpMul:2.2,  dmgMul:0.95, speed:0,   armor:"shield", color:"#9aa0a6", xpMul:1.3, behavior:"turret",  ranged:{range:380,cd:0.85,bs:430} },
  badass:   { name:"精英 PMC",   radius:24, hpMul:8.0,  dmgMul:1.55, speed:72,  armor:"armor",  color:"#b0413a", xpMul:1.0, behavior:"ranged",  ranged:{range:430,cd:0.7,bs:520} },
  boss:     { name:"封锁区指挥官",radius:42, hpMul:65.0, dmgMul:1.90, speed:62,  armor:"armor",  color:"#c0392b", xpMul:1.0, behavior:"boss" },
  /* ---- 以下为「不同属性」的差异化怪物（参考 Rakanishu 的多属性设计）---- */
  wraith:     { name:"潜行侦察兵",   radius:14, hpMul:1.9,  dmgMul:1.05, speed:188, armor:"flesh",  color:"#9be7ff", xpMul:1.4, behavior:"wraith",   melee:{range:26,cd:0.6} },
  berserker:  { name:"突入手",   radius:19, hpMul:2.6,  dmgMul:1.10, speed:120, armor:"flesh",  color:"#ff7a3d", xpMul:1.5, behavior:"berserker",melee:{range:30,cd:0.65} },
  shieldbearer:{name:"防盾手",     radius:20, hpMul:3.6,  dmgMul:0.95, speed:78,  armor:"armor",  color:"#8a93a6", xpMul:1.7, behavior:"shieldbearer", ranged:{range:420,cd:1.0,bs:480}, shieldFront:true },
  bomber:     { name:"爆破手",   radius:14, hpMul:1.4,  dmgMul:0.6,  speed:200, armor:"flesh",  color:"#ffd24a", xpMul:1.1, behavior:"bomber",   melee:{range:24,cd:0.5} },
  cryomancer: { name:"震撼弹射手",   radius:17, hpMul:1.7,  dmgMul:0.9,  speed:120, armor:"flesh",  color:"#6fd6ff", xpMul:1.4, behavior:"cryomancer",ranged:{range:380,cd:1.3,bs:430}, elemResist:{cryo:0.2} },
  spitter:    { name:"燃烧瓶射手",   radius:18, hpMul:2.3,  dmgMul:1.0,  speed:95,  armor:"flesh",  color:"#7bff3a", xpMul:1.5, behavior:"spitter",  ranged:{range:400,cd:1.5,bs:400}, elemResist:{corrosive:0.3} },
  broodmother:{ name:"增援呼叫员",     radius:26, hpMul:6.5,  dmgMul:0.9,  speed:64,  armor:"shield", color:"#b06bd0", xpMul:2.2, behavior:"broodmother" },
  juggernaut: { name:"重装甲兵",     radius:28, hpMul:9.0,  dmgMul:1.25, speed:70,  armor:"armor",  color:"#7a5230", xpMul:2.0, behavior:"juggernaut",ranged:{range:460,cd:1.2,bs:520} },
};

const MONSTER_BASE = {
  hp(lvl){ return 8 + 4.2*Math.pow(lvl,1.30); },
  dmg(lvl){ return 2 + 0.75*Math.pow(lvl,1.10); },
  xp(lvl){ return 6 + 5*Math.pow(lvl,1.20); },
};

class Enemy {
  constructor(type, level, x, y, mayhem){
    const d=ENEMY_DEFS[type] || ENEMY_DEFS.psycho;
    this.type=type; this.def=d; this.name=d.name;
    this.x=x; this.y=y; this.vx=0; this.vy=0; this.angle=0;
    this.radius=d.radius;
    this.level=level;
    this.mayhem=mayhem||0;
    this.isBoss = type==="boss";
    this.isMini = type==="badass";
    // 改装：生命 ×1.5^n、伤害 ×1.2^n，经验同步补偿
    const hpM = this.mayhem>0 ? Math.pow(MAYHEM.hpMul, this.mayhem) : 1;
    const dmM = this.mayhem>0 ? Math.pow(MAYHEM.dmgMul, this.mayhem) : 1;
    this.maxHP=Math.max(1, Math.round(MONSTER_BASE.hp(level) * d.hpMul * hpM));
    this.hp=this.maxHP;
    this.dmg=MONSTER_BASE.dmg(level) * d.dmgMul * dmM;
    this.speed=d.speed; this.armorType=d.armor;
    this.color=d.color;
    this.xp=Math.round(MONSTER_BASE.xp(level) * (this.isBoss?12:this.isMini?3.5:1) * (d.xpMul||1) * (1+this.mayhem*MAYHEM.xpAdd));
    this.behavior=d.behavior; this.faction="enemy";
    this.alive=true;
    this.statuses=[]; this.fireCd=RNG.fr(0.3,1.2); this.attackCd=0;
    this.phaselocked=0; this.flash=0; this.slowT=0; this.slowAmt=0;
    this.bossTimer=2.5; this.summonTimer=6; this.phase=1; this.chargeCd=0;
    this.wanderA=RNG.fr(0,6.28);
    // 差异化属性状态
    this.phaseT=RNG.fr(2.5,4.5); this.phasing=false;   // 敌方单位标记
    this.enraged=false;                                      // 突入兽
    this.summonCd=RNG.fr(4,7);                              // 增援呼叫计时
    this.elemResist=d.elemResist||null;                    // 弹种抗性
    this.shieldFront=!!d.shieldFront;                       // 盾卫正面减伤
    // v0.13.5：AI 行为优化 —— 个体差异横移方向 + 周期性换向，避免全体同向漂移
    this.strafeDir = RNG.chance(0.5)?1:-1;
    this.strafeFlip = RNG.fr(2.0,4.5);
  }

  applyStatus(s){
    const ex=this.statuses.find(x=>x.type===s.type);
    if(ex){ ex.t=Math.max(ex.t,s.t); if(s.dps)ex.dps=Math.max(ex.dps,s.dps); if(s.amt!==undefined)ex.amt=Math.max(ex.amt,s.amt); }
    else this.statuses.push({...s});
  }

  takeDamage(dmg, element, armorType, game, attacker){
    if(this.phasing) return;                                  // 标记中：完全无敌
    const ammo=AMMO_TYPES[element]||AMMO_TYPES.none;
    const mult=(ammo.mult&&ammo.mult[armorType||"flesh"])||1;   // v0.15.0：未知弹种/护甲类型不再产生 NaN 伤害
    if(this.elemResist && this.elemResist[element]!==undefined) mult*=this.elemResist[element];  // 弹种抗性
    // 盾卫：正面（朝向玩家一侧）承受伤害大幅降低
    if(this.shieldFront && attacker){
      const toAtk=M.angle(this.x,this.y,attacker.x,attacker.y);   // 攻击者所处方向
      if(Math.abs(M.normAngle(toAtk-this.angle))<1.3) mult*=0.28;  // 与面朝方向一致 → 正面
    }
    const actual=dmg*mult;
    this.hp-=actual; this.flash=0.12;
    if(game.addFloatText) game.addFloatText(this.x,this.y-this.radius-6,"-"+Math.round(actual), (AMMO_TYPES[element]||AMMO_TYPES.none).color);
    if(this.hp<=0){ this.alive=false; }
  }

  update(dt, game){
    if(this.flash>0) this.flash-=dt;
    // 状态结算
    let slow=1;
    for(let i=this.statuses.length-1;i>=0;i--){
      const s=this.statuses[i]; s.t-=dt;
      if(s.type==="slow"){ slow=Math.min(slow,1-s.amt); this.slowT=1; this.slowAmt=s.amt; }
      else if(s.dps){ this.hp-=s.dps*dt; if(this.hp<=0)this.alive=false; }
      if(s.t<=0) this.statuses.splice(i,1);
    }
    if(this.slowT>0){ this.slowT-=dt; if(this.slowT<=0) this.slowAmt=0; }

    if(this.phaselocked>0){ this.phaselocked-=dt; return; } // 标记锁：冻结

    const pl=game.player; if(!pl||!pl.alive) return;
    const d=M.dist(this.x,this.y,pl.x,pl.y);
    this.angle=M.angle(this.x,this.y,pl.x,pl.y);
    const sp=this.speed*slow;

    if(this.behavior==="melee"){
      this._moveToward(pl.x,pl.y,sp,dt,game);
      if(d<this.radius+pl.radius+this.def.melee.range){ this.attackCd-=dt; if(this.attackCd<=0){ pl.takeDamage(this.dmg,"none","flesh",game,this); this.attackCd=this.def.melee.cd; } }
    } else if(this.behavior==="charger"){
      this._moveToward(pl.x,pl.y,sp*1.1,dt,game);
      if(d<this.radius+pl.radius+this.def.melee.range){ this.attackCd-=dt; if(this.attackCd<=0){ pl.takeDamage(this.dmg*1.1,"none","flesh",game,this); this.attackCd=this.def.melee.cd; } }
    } else if(this.behavior==="ranged" || this.behavior==="turret"){
      const r=this.def.ranged;
      if(this.behavior==="turret"){ /* 不动 */ }
      else {
        const ideal=r.range*0.7;
        if(d>ideal+30) this._moveToward(pl.x,pl.y,sp,dt,game);
        else if(d<ideal-30) this._moveAway(pl.x,pl.y,sp,dt,game);
        else this._strafe(pl.x,pl.y,sp*0.6,dt);
      }
      this.fireCd-=dt;
      if(d<r.range && this.fireCd<=0){
        const lead=this._lead(pl,r.bs);
        spawnProjectile(game,{x:this.x+Math.cos(this.angle)*this.radius,y:this.y+Math.sin(this.angle)*this.radius,angle:lead,speed:r.bs,damage:this.dmg*0.8,element:"none",radius:5,faction:"enemy",color:"#ffcf5a",owner:this,life:2.2});
        this.fireCd=r.cd;
      }
    } else if(this.behavior==="boss"){
      this._boss(dt,game,pl,d,sp);
    } else if(this.behavior==="wraith"){
      // 周期性标记：标记中无敌且半透明，专治贴脸集火
      this.phaseT-=dt;
      if(this.phaseT<=0){ this.phasing=!this.phasing; this.phaseT=this.phasing?1.2:RNG.fr(3,5); }
      this._moveToward(pl.x,pl.y,sp*1.15,dt,game);
      if(d<this.radius+pl.radius+this.def.melee.range){
        this.attackCd-=dt;
        if(this.attackCd<=0){ pl.takeDamage(this.dmg*(this.phasing?0.4:1.0),"none","flesh",game,this); this.attackCd=this.def.melee.cd; }
      }
    } else if(this.behavior==="berserker"){
      if(!this.enraged && this.hp<this.maxHP*0.4){ this.enraged=true; }      // 残血突入
      const em=this.enraged?1.5:1, ed=this.enraged?1.4:1;
      this._moveToward(pl.x,pl.y,sp*em,dt,game);
      if(d<this.radius+pl.radius+this.def.melee.range){
        this.attackCd-=dt;
        if(this.attackCd<=0){ pl.takeDamage(this.dmg*ed,"none","flesh",game,this); this.attackCd=this.def.melee.cd; }
      }
    } else if(this.behavior==="shieldbearer"){
      const r=this.def.ranged;
      if(d>r.range*0.7+30) this._moveToward(pl.x,pl.y,sp,dt,game);
      else if(d<r.range*0.7-30) this._moveAway(pl.x,pl.y,sp,dt,game);
      else this._strafe(pl.x,pl.y,sp*0.6,dt);
      this.fireCd-=dt;
      if(d<r.range && this.fireCd<=0){
        const lead=this._lead(pl,r.bs);
        spawnProjectile(game,{x:this.x+Math.cos(this.angle)*this.radius,y:this.y+Math.sin(this.angle)*this.radius,angle:lead,speed:r.bs,damage:this.dmg*0.8,element:"none",radius:5,faction:"enemy",color:"#cfd6e0",owner:this,life:2.2});
        this.fireCd=r.cd;
      }
    } else if(this.behavior==="bomber"){
      this._moveToward(pl.x,pl.y,sp,dt,game);
      if(d<this.radius+pl.radius+6){ this._detonate(game); this.alive=false; }
    } else if(this.behavior==="cryomancer"){
      const r=this.def.ranged;
      if(d>r.range*0.7) this._moveToward(pl.x,pl.y,sp,dt,game);
      else if(d<r.range*0.5) this._moveAway(pl.x,pl.y,sp,dt,game);
      else this._strafe(pl.x,pl.y,sp*0.7,dt);
      this.fireCd-=dt;
      if(d<r.range && this.fireCd<=0){
        const lead=this._lead(pl,r.bs);
        spawnProjectile(game,{x:this.x+Math.cos(this.angle)*this.radius,y:this.y+Math.sin(this.angle)*this.radius,angle:lead,speed:r.bs,damage:this.dmg*0.7,element:"cryo",radius:5,faction:"enemy",color:"#6fd6ff",owner:this,life:2.2});
        this.fireCd=r.cd;
      }
    } else if(this.behavior==="spitter"){
      const r=this.def.ranged;
      if(d>r.range*0.7) this._moveToward(pl.x,pl.y,sp,dt,game);
      else if(d<r.range*0.5) this._moveAway(pl.x,pl.y,sp,dt,game);
      else this._strafe(pl.x,pl.y,sp*0.7,dt);
      this.fireCd-=dt;
      if(d<r.range && this.fireCd<=0){
        const lead=this._lead(pl,r.bs);
        spawnProjectile(game,{x:this.x+Math.cos(this.angle)*this.radius,y:this.y+Math.sin(this.angle)*this.radius,angle:lead,speed:r.bs,damage:this.dmg*0.7,element:"corrosive",radius:6,faction:"enemy",color:"#7bff3a",owner:this,life:2.4});
        this.fireCd=r.cd;
      }
    } else if(this.behavior==="broodmother"){
      if(d>180) this._moveToward(pl.x,pl.y,sp,dt,game); else this._strafe(pl.x,pl.y,sp*0.8,dt);
      this.summonCd-=dt;
      if(this.summonCd<=0 && game.enemies.length<20){
        this.summonCd=RNG.fr(5,8);
        for(let i=0;i<2;i++){ const a=RNG.fr(0,6.28); game.enemies.push(makeEnemy("skag",this.level,this.x+Math.cos(a)*70,this.y+Math.sin(a)*70,this.mayhem)); }
        if(game.toast) game.toast("敌方呼叫了增援！");
      }
      this.fireCd-=dt;
      if(d<420 && this.fireCd<=0){
        spawnProjectile(game,{x:this.x,y:this.y,angle:M.angle(this.x,this.y,pl.x,pl.y),speed:380,damage:this.dmg*0.6,element:"corrosive",radius:7,faction:"enemy",color:"#b06bd0",owner:this,life:2.2});
        this.fireCd=1.6;
      }
    } else if(this.behavior==="juggernaut"){
      if(d>150) this._moveToward(pl.x,pl.y,sp,dt,game); else this._strafe(pl.x,pl.y,sp*0.5,dt);
      this.fireCd-=dt;
      if(d<this.def.ranged.range && this.fireCd<=0){
        const lead=this._lead(pl,this.def.ranged.bs);
        spawnProjectile(game,{x:this.x+Math.cos(this.angle)*this.radius,y:this.y+Math.sin(this.angle)*this.radius,angle:lead,speed:this.def.ranged.bs,damage:this.dmg*0.8,element:"none",radius:7,faction:"enemy",color:"#ffb020",owner:this,life:2.4});
        this.fireCd=this.def.ranged.cd;
      }
      if(d<this.radius+pl.radius+4){ const a=M.angle(this.x,this.y,pl.x,pl.y); pl.x+=Math.cos(a)*6; pl.y+=Math.sin(a)*6; }  // 接触击退
    }

    // v0.13.5：横移周期性换向 —— 避免所有敌人朝同一侧漂移，观感更像各自判断
    this.strafeFlip-=dt;
    if(this.strafeFlip<=0){ this.strafeDir*=-1; this.strafeFlip=RNG.fr(2.0,4.5); }

    // v0.13.5：分离力 —— 防止敌群叠在一起、己方子弹互相遮挡，提升战斗可读性
    let sx=0, sy=0;
    for(const o of game.enemies){
      if(o===this || !o.alive) continue;
      const od=M.dist(this.x,this.y,o.x,o.y);
      const min=this.radius+o.radius+3;
      if(od>0.01 && od<min){ const a=Math.atan2(this.y-o.y,this.x-o.x); const f=(min-od)/min; sx+=Math.cos(a)*f; sy+=Math.sin(a)*f; }
    }
    if(sx||sy){
      const m=Math.hypot(sx,sy)||1;
      const push=Math.min(1,m)*sp*dt*1.4;
      const nx=this.x+(sx/m)*push, ny=this.y+(sy/m)*push;
      if(!(game.walls && this._inWall(nx,ny,game))){ this.x=nx; this.y=ny; this._clamp(game); }
    }

    // 不与玩家重叠：贴脸会把子弹"顶"到身后，导致打空
    const pd=M.dist(this.x,this.y,pl.x,pl.y), minD=this.radius+pl.radius+2;
    if(pd<minD && pd>0.01){
      const a=Math.atan2(this.y-pl.y, this.x-pl.x);
      this.x=pl.x+Math.cos(a)*minD; this.y=pl.y+Math.sin(a)*minD;
      this._clamp(game);
    }
  }

  // 墙体避让：检测点是否落在任一墙体矩形内（仅 raid/br 等设置了 game.walls 的模式生效）
  _inWall(x,y,game){
    const W=game.walls; if(!W||!W.length) return false;
    const r=this.radius*0.8;
    for(const w of W){ if(x+r>w.x && x-r<w.x+w.w && y+r>w.y && y-r<w.y+w.h) return true; }
    return false;
  }
  // 带墙体滑动的一步移动：被墙挡住时尝试沿单轴滑动，避免直接卡死或穿墙
  _step(vx,vy,dt,game){
    const nx=this.x+vx*dt, ny=this.y+vy*dt;
    if(game.walls && game.walls.length){
      if(this._inWall(nx,ny,game)){
        if(!this._inWall(nx,this.y,game)) this.x=nx;
        else if(!this._inWall(this.x,ny,game)) this.y=ny;
      } else { this.x=nx; this.y=ny; }
    } else { this.x=nx; this.y=ny; }
    this._clamp(game);
  }
  _moveToward(tx,ty,sp,dt,game){ const a=M.angle(this.x,this.y,tx,ty); this._step(Math.cos(a)*sp, Math.sin(a)*sp, dt, game); }
  _moveAway(tx,ty,sp,dt,game){ const a=M.angle(tx,ty,this.x,this.y); this._step(Math.cos(a)*sp, Math.sin(a)*sp, dt, game); }
  _strafe(tx,ty,sp,dt){ const a=M.angle(this.x,this.y,tx,ty)+Math.PI/2*this.strafeDir; this._step(Math.cos(a)*sp, Math.sin(a)*sp, dt); }
  _clamp(game){ if(game.bounds){ this.x=M.clamp(this.x,game.bounds.minX,game.bounds.maxX); this.y=M.clamp(this.y,game.bounds.minY,game.bounds.maxY); } }
  _lead(pl,bs){ const dx=pl.x-this.x, dy=pl.y-this.y; const t=M.dist(this.x,this.y,pl.x,pl.y)/bs; const px=pl.x+(pl.vx||0)*t, py=pl.y+(pl.vy||0)*t; return M.angle(this.x,this.y,px,py); }
  _detonate(game){
    const R=130;
    game.spawnExplosion(this.x,this.y,R,"#ffd24a");
    game.shake(6); if(SFX&&SFX.boom) SFX.boom();
    const pl=game.player;
    if(pl&&pl.alive&&M.dist(this.x,this.y,pl.x,pl.y)<R) pl.takeDamage(this.dmg*3.0,"fire","flesh",game,this);
  }

  _boss(dt,game,pl,d,sp){
    // 缓慢靠近
    if(d>160) this._moveToward(pl.x,pl.y,sp,dt,game); else this._strafe(pl.x,pl.y,sp*0.8,dt);
    const hpPct=this.hp/this.maxHP;
    this.phase = hpPct>0.66?1:(hpPct>0.33?2:3);
    // 径向弹幕
    this.bossTimer-=dt;
    if(this.bossTimer<=0){
      const n=this.phase===1?10:(this.phase===2?14:18);
      for(let i=0;i<n;i++){ const a=(i/n)*Math.PI*2; spawnProjectile(game,{x:this.x,y:this.y,angle:a,speed:300,damage:this.dmg*0.7,element:this.phase===2?"fire":"none",radius:6,faction:"enemy",color:this.phase===2?"#ff5a1f":"#ffcf5a",owner:this,life:2.6}); }
      this.bossTimer = this.phase===1?2.6:2.0;
      SFX.boom();
    }
    // 召唤增援
    this.summonTimer-=dt;
    if(this.summonTimer<=0 && game.enemies.length<18){
      const cnt=this.phase===1?1:2;
      for(let i=0;i<cnt;i++){ const a=RNG.fr(0,6.28); const ex=this.x+Math.cos(a)*80, ey=this.y+Math.sin(a)*80; game.enemies.push(new Enemy(RNG.chance(0.5)?"psycho":"bandit",this.level,ex,ey)); }
      this.summonTimer=this.phase===1?9:6;
    }
  }
}

function makeEnemy(type, level, x, y, mayhem){ return new Enemy(type, level, x, y, mayhem); }

/* ----------------------------- 友方掩护火力 ----------------------------- */
class Turret {
  constructor(x,y,owner){
    this.x=x; this.y=y; this.radius=14; this.faction="player";
    this.maxHP=140; this.hp=140; this.color="#4aa3ff"; this.owner=owner;
    this.fireCd=0.4; this.life=9+ (owner&&owner.stats?owner.stats.abilityPower*4:0); this.dead=false;
    this.angle=0;
  }
  update(dt,game){
    this.life-=dt; if(this.life<=0){ this.dead=true; return; }
    if(game.bounds){ this.x=M.clamp(this.x,game.bounds.minX,game.bounds.maxX); this.y=M.clamp(this.y,game.bounds.minY,game.bounds.maxY); }
    let best=null,bd=1e9;
    for(const e of game.enemies){ if(!e.alive)continue; const d=M.dist2(this.x,this.y,e.x,e.y); if(d<bd){bd=d;best=e;} }
    if(!best) return;
    this.angle=M.angle(this.x,this.y,best.x,best.y);
    this.fireCd-=dt;
    if(this.fireCd<=0 && bd<480*480){
      const dmg=14*(this.owner&&this.owner.stats?1+this.owner.stats.abilityPower:1);
      spawnProjectile(game,{x:this.x+Math.cos(this.angle)*this.radius,y:this.y+Math.sin(this.angle)*this.radius,angle:this.angle,speed:560,damage:dmg,element:"none",radius:4,faction:"player",color:"#9be7ff",owner:this,life:1.6});
      this.fireCd=0.16;
    }
  }
}
function spawnTurret(game,x,y,owner){ game.allies.push(new Turret(x,y,owner)); }
