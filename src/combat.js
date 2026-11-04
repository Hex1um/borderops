/* =========================================================================
 * combat.js — 抛射物 / 命中结算 / 元素 DoT 与克制
 * ========================================================================= */

class Projectile {
  constructor(game, o){
    this.x=o.x; this.y=o.y; this.angle=o.angle;
    this.speed=o.speed; this.damage=o.damage;
    this.element=o.element||"none";
    this.radius=o.radius||4;
    this.splash=o.splash||0;
    this.homing=o.homing||false;
    this.life=o.life||1.4;
    this.owner=o.owner||null;
    this.faction=o.owner&&o.owner.faction ? o.owner.faction : (o.faction||"enemy");
    this.color=o.color||"#fff";
    this.isThrown=o.isThrown||false;
    this.weapon=o.weapon||null;
    this.pierce=o.pierce||0;          // 剩余穿透次数
    this.lifesteal=o.lifesteal||0;    // 武器词缀吸血
    this.elemChance=o.elemChance||0;  // 元素爆发几率
    this.shape=o.shape||"round";      // 子弹形状（厂商/元素/枪型决定）
    this.laser=o.laser||false;        // 激光枪：子弹渲染为光束而非色块
    this.hits=[];                     // 已命中目标（穿透用）
    this.dead=false;
    this.trail=[];
  }

  update(dt, game){
    this.prevX=this.x; this.prevY=this.y;   // 供扫掠碰撞使用
    // 追踪弹：朝最近敌对目标微调
    if(this.homing){
      const tgt=this._nearestTarget(game);
      if(tgt){
        const desired=M.angle(this.x,this.y,tgt.x,tgt.y);
        this.angle=M.lerpAngle(this.angle,desired,Math.min(1,dt*4));
      }
    }
    this.x+=Math.cos(this.angle)*this.speed*dt;
    this.y+=Math.sin(this.angle)*this.speed*dt;
    this.life-=dt;
    this.trail.push({x:this.x,y:this.y}); if(this.trail.length>6) this.trail.shift();
    if(this.life<=0) this.dead=true;
    // 出界
    const b=game.bounds;
    if(b && (this.x<b.minX-40||this.x>b.maxX+40||this.y<b.minY-40||this.y>b.maxY+40)) this.dead=true;
  }
  _nearestTarget(game){
    if(this.faction==="player"){
      let best=null,bd=1e9; for(const e of game.enemies){ if(!e.alive)continue; const d=M.dist2(this.x,this.y,e.x,e.y); if(d<bd){bd=d;best=e;} } return best;
    } else {
      return game.player&&game.player.alive?game.player:null;
    }
  }
}

function spawnProjectile(game, o){ const p=new Projectile(game,o); game.projectiles.push(p); return p; }

// 线段-圆相交：解决低帧率下高速子弹"穿透"目标的问题
function segCircleHit(x1,y1,x2,y2,cx,cy,r){
  const dx=x2-x1, dy=y2-y1;
  const len2=dx*dx+dy*dy;
  let t=0;
  if(len2>0) t=((cx-x1)*dx+(cy-y1)*dy)/len2;
  t=t<0?0:(t>1?1:t);
  const px=x1+dx*t, py=y1+dy*t;
  return (px-cx)*(px-cx)+(py-cy)*(py-cy) <= r*r;
}

// 抛射物推进 + 碰撞
function updateProjectiles(dt, game){
  const list=game.projectiles;
  for(let i=list.length-1;i>=0;i--){
    const p=list[i]; p.update(dt,game);
    if(p.dead){ list.splice(i,1); continue; }
    // 碰撞检测（扫掠：用上一帧到当前帧的线段判定）
    const x1=p.prevX!==undefined?p.prevX:p.x, y1=p.prevY!==undefined?p.prevY:p.y;
    if(p.faction==="player"){
      for(const e of game.enemies){
        if(!e.alive) continue;
        if(e.phasing) continue;            // 相位中的幽灵兽不可被命中
        if(p.hits.indexOf(e)>=0) continue;
        if(segCircleHit(x1,y1,p.x,p.y,e.x,e.y,e.radius+p.radius)){
          hitEnemy(e,p,game);
          if(p.splash>0) splashDamage(game,p,e,null);
          // 穿透弹继续飞行，命中列表避免重复结算
          if(p.pierce>0){ p.pierce--; p.hits.push(e); continue; }
          p.dead=true; break;
        }
      }
      // 友方炮塔不算障碍
    } else {
      const pl=game.player;
      if(pl&&pl.alive && segCircleHit(x1,y1,p.x,p.y,pl.x,pl.y,pl.radius+p.radius)){
        pl.takeDamage(p.damage,p.element,"flesh",game,p.owner);
        if(p.splash>0) splashDamage(game,p,null,pl);
        p.dead=true;
      }
    }
    // 友军实体（炮塔）也会被敌方溅射？略
    if(p.dead){ list.splice(i,1); }
  }
}

// 直接命中敌人
function hitEnemy(e, p, game){
  const w = p.weapon;
  const cc = w ? (w.stats.critChance!==undefined?w.stats.critChance:0.15) : 0.15;
  const critMul = w ? (w.stats.crit||1.5) : 1.5;
  let dmg=p.damage;
  let isCrit=false, isBurst=false;
  if(RNG.chance(M.clamp(cc + (p.owner&&p.owner.effCritAdd?p.owner.effCritAdd():0), 0, 0.9))){
    const extra = 1 + ((p.owner&&p.owner.stats&&p.owner.stats.critDmgAdd)||0)/100;
    dmg*=critMul*extra; isCrit=true;
  }
  // 元素爆发（词缀「元素触发」）
  if(p.element!=="none" && p.elemChance>0 && RNG.chance(M.clamp(p.elemChance,0,0.75))){ dmg*=1.5; isBurst=true; }
  e.takeDamage(dmg, p.element, e.armorType, game, p.owner);
  game.spawnHitFx(p.x,p.y, p.element!=="none"?ELEMENTS[p.element].color:"#fff", isCrit||isBurst);
  if(isCrit && game.addFloatText) game.addFloatText(p.x, p.y-14, "暴击", "#ffd23f");
  // 吸血（词缀 + 技能）
  if(p.owner && p.owner.alive){
    let ls = p.lifesteal||0;
    if(p.owner.effLifesteal) ls += p.owner.effLifesteal();
    if(ls>0) p.owner.heal(dmg*ls);
    // 吸盾（命中回盾词缀）：把一部分伤害转为护盾
    const soh = p.weapon && p.weapon.stats ? (p.weapon.stats.shieldOnHit||0) : 0;
    if(soh>0) p.owner.healShield(dmg*soh);
  }
  // 辐射连锁
  if(p.element==="radiation"){
    for(const o of game.enemies){ if(o===e||!o.alive)continue; if(M.dist(p.x,p.y,o.x,o.y)<120){ o.takeDamage(dmg*0.5,"radiation",o.armorType,game,null); } }
  }
  // 冰冻减速
  if(p.element==="cryo"){ e.applyStatus({type:"slow",t:2,amt:0.4}); }
  // 燃烧/腐蚀 DoT
  if(p.element==="fire"||p.element==="corrosive"||p.element==="radiation"){
    const dps=p.damage*0.10*(p.owner&&p.owner.stats?p.owner.stats.statusMul:1);
    e.applyStatus({type:p.element,t:3,dps});
  }
}

// 溅射伤害
function splashDamage(game, p, hitEnemyObj, hitPlayer){
  const r=p.splash;
  const mult = (p.weapon && p.weapon.stats) ? (p.weapon.stats.splashDmgMul||1) : 1;
  if(hitEnemyObj){
    for(const o of game.enemies){ if(o===hitEnemyObj||!o.alive)continue; const d=M.dist(p.x,p.y,o.x,o.y); if(d<r){ o.takeDamage(p.damage*0.6*mult,p.element,o.armorType,game,p.owner); } }
  }
  if(hitPlayer){
    for(const e of game.enemies){ /* 玩家溅射仅影响自身已处理 */ }
  }
  game.spawnExplosion(p.x,p.y,r,p.color);
  SFX.boom(); game.shake(p.isThrown?5:3);
}
