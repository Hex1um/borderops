/* =========================================================================
 * combat.js — 抛射物 / 命中结算 / 弹种终点效应
 * 移除弹种增益、持续伤害、减速、连锁引爆、急救效率与吸盾；
 *   伤害差异只来自 AMMO_TYPES 的穿透等级与软目标/护甲终点效应系数。
 * ========================================================================= */

class Projectile {
  constructor(game, o){
    this.x=o.x; this.y=o.y; this.angle=o.angle;
    this.speed=o.speed; this.damage=o.damage;
    this.element=o.element||"none";   // 兼容旧字段名，实际是弹种 id
    this.radius=o.radius||4;
    this.splash=o.splash||0;          // 仅榴弹战斗部有破片半径
    this.homing=false;                // 直线弹道，字段保留兼容快照
    this.life=o.life||1.4;
    this.owner=o.owner||null;
    this.faction=o.owner&&o.owner.faction ? o.owner.faction : (o.faction||"enemy");
    this.color=o.color||"#fff";
    this.isThrown=o.isThrown||false;
    this.weapon=o.weapon||null;
    this.pierce=o.pierce||0;          // 剩余穿透次数（钢芯弹 / 大口径）
    this.shape=o.shape||"round";      // 弹头形状（枪型 / 弹种 / 兵工厂决定）
    this.laser=false;                 // 无能量光束
    this.hits=[];                     // 已命中目标（穿透用）
    this.dead=false;
    this.trail=[];
  }

  update(dt, game){
    this.prevX=this.x; this.prevY=this.y;   // 供扫掠碰撞使用
    // 弹道为发射瞬间的直线（受散布影响），不做飞行中修正
    this.x+=Math.cos(this.angle)*this.speed*dt;
    this.y+=Math.sin(this.angle)*this.speed*dt;
    this.life-=dt;
    this.trail.push({x:this.x,y:this.y}); if(this.trail.length>6) this.trail.shift();
    if(this.life<=0) this.dead=true;
    // 出界
    const b=game.bounds;
    if(b && (this.x<b.minX-40||this.x>b.maxX+40||this.y<b.minY-40||this.y>b.maxY+40)) this.dead=true;
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
        if(e.phasing) continue;
        if(p.hits.indexOf(e)>=0) continue;
        if(segCircleHit(x1,y1,p.x,p.y,e.x,e.y,e.radius+p.radius)){
          hitEnemy(e,p,game);
          if(p.splash>0) splashDamage(game,p,e,null);
          // 钢芯弹继续飞行，命中列表避免重复结算
          if(p.pierce>0){ p.pierce--; p.hits.push(e); continue; }
          p.dead=true; break;
        }
      }
    } else {
      const pl=game.player;
      if(pl&&pl.alive && segCircleHit(x1,y1,p.x,p.y,pl.x,pl.y,pl.radius+p.radius)){
        pl.takeDamage(p.damage,p.element,"flesh",game,p.owner);
        if(p.splash>0) splashDamage(game,p,null);
        p.dead=true;
      }
    }
    if(p.dead){ list.splice(i,1); }
  }
}

// 直接命中敌人：只结算「要害命中 × 终点效应」，无状态异常与自我恢复
function hitEnemy(e, p, game){
  const w = p.weapon;
  const cc = w ? (w.stats.critChance!==undefined?w.stats.critChance:0.15) : 0.15;
  const critMul = w ? (w.stats.crit||1.5) : 1.5;
  let dmg=p.damage;
  let isCrit=false;
  if(RNG.chance(M.clamp(cc + (p.owner&&p.owner.effCritAdd?p.owner.effCritAdd():0), 0, 0.9))){
    const extra = 1 + ((p.owner&&p.owner.stats&&p.owner.stats.critDmgAdd)||0)/100;
    dmg*=critMul*extra; isCrit=true;
  }
  // 弹种对软目标 / 护甲的终点效应由 takeDamage 内部按 AMMO_TYPES.mult 结算
  e.takeDamage(dmg, p.element, e.armorType, game, p.owner);
  const ammo = AMMO_TYPES[p.element] || AMMO_TYPES.none;
  game.spawnHitFx(p.x,p.y, ammo.color, isCrit);
  if(isCrit && game.addFloatText) game.addFloatText(p.x, p.y-14, "要害", "#d8c48a");
}

// 破片伤害（仅榴弹战斗部）
// v0.21.9：删掉从未被读取的 hitPlayer 形参 —— 敌方榴弹只有直击伤害、溅射只波及直击目标以外的敌人（设计如此）；
// 若日后要让敌方破片也伤玩家，在这里补玩家半径判定即可。
function splashDamage(game, p, hitEnemyObj){
  const r=p.splash;
  const mult = (p.weapon && p.weapon.stats) ? (p.weapon.stats.splashDmgMul||1) : 1;
  if(hitEnemyObj){
    for(const o of game.enemies){ if(o===hitEnemyObj||!o.alive)continue; const d=M.dist(p.x,p.y,o.x,o.y); if(d<r){ o.takeDamage(p.damage*0.6*mult,p.element,o.armorType,game,p.owner); } }
  }
  game.spawnExplosion(p.x,p.y,r,p.color);
  SFX.boom(); game.shake(p.isThrown?5:3);
}
