/* =========================================================================
 * endless.js — 无尽模式（Endless）
 *
 * 与战役模式共用战斗系统，但不设区域、不设终点：
 *   · 波次制：清空当前波 → 短暂间歇 → 下一波；
 *   · 每波怪物生命 +28%、伤害 +10%、数量 +1.1、等级随波次抬升；
 *   · 每 5 波刷一个首领，掉落与镒矿同步提高；
 *   · 波次奖励随 wave 线性增长，越往后越撑不住 —— 这就是玩法本身。
 * ========================================================================= */

class EndlessWorld {
  constructor(game, opts={}){
    this.def={ name:"无尽试炼场", boss:false, endless:true };
    this.name="无尽试炼场";
    this.level=Math.max(1, opts.startLevel||1);
    this.bounds={ minX:0, minY:0, maxX:2000, maxY:1500 };
    this.chests=[];
    this.wave=0;
    this.quota=0;              // 本波剩余待刷
    this.spawned=0;
    this.state="intermission"; // intermission | fighting
    this.timer=4.0;
    this.maxConcurrent=ENDLESS.maxConcurrent;
    this.spawnTimer=0;
    this.bossWave=false;
    this.complete=false;
    this.bestWave=opts.bestWave||0;
    this.totalKills=0;
  }

  objective(){
    if(this.state==="intermission") return `第 ${this.wave+1} 波即将到来 · 准备`;
    return `第 ${this.wave} 波 · 剩余 ${this.quota + 0} 只待刷${this.bossWave?" · 首领波":""}`;
  }
  remaining(){ return this.quota; }

  // 波次倍率：只增不减，没有上限
  hpMul(w){ return Math.pow(1+ENDLESS.hpPerWave, Math.max(0,w-1)); }
  dmgMul(w){ return Math.pow(1+ENDLESS.dmgPerWave, Math.max(0,w-1)); }
  waveLevel(w){ return Math.max(this.level, Math.round(1 + (w-1)*0.9)); }

  update(dt, game){
    const pl=game.player; if(!pl) return;

    if(this.state==="intermission"){
      this.timer-=dt;
      if(this.timer<=0) this._startWave(game);
      return;
    }

    // 配额刷怪：同屏上限内分批放
    if(this.quota>0 && game.enemies.length<this.maxConcurrent){
      this.spawnTimer-=dt;
      if(this.spawnTimer<=0){
        const n=Math.min(this.quota, RNG.ri(1,3));
        for(let i=0;i<n;i++){
          const pos=this._spawnPos(game);
          const lvl=this.waveLevel(this.wave);
          const types=["psycho","bandit","skag","marauder","turret","wraith","berserker","shieldbearer","bomber","cryomancer","spitter","broodmother","juggernaut"];
          const t=RNG.pick(types);
          const e=makeEnemy(t, lvl, pos.x, pos.y, 0);
          this._buff(e);
          game.enemies.push(e);
          this.quota--; this.spawned++;
        }
        this.spawnTimer=RNG.fr(0.35,0.8);
      }
    }

    // 首领波：配额放完且场上清空 → 首领
    if(this.bossWave && this.quota===0 && !this._bossSpawned && game.enemies.length<=1){
      const pos=this._spawnPos(game,true);
      const e=makeEnemy("boss", this.waveLevel(this.wave)+1, pos.x, pos.y, 0);
      this._buff(e, true);
      game.enemies.push(e);
      this._bossSpawned=true;
      game.toast("首领降临！");
      game.shake(9);
    }

    // 波次结束判定
    if(this.quota===0 && game.enemies.length===0 && (!this.bossWave || this._bossSpawned)){
      this._endWave(game);
    }
  }

  _buff(e, isBoss){
    const hm=this.hpMul(this.wave)*(isBoss?1:1);
    const dm=this.dmgMul(this.wave);
    e.maxHP=Math.round(e.maxHP*hm); e.hp=e.maxHP;
    e.dmg*=dm;
    e.xp=Math.round(e.xp*(1+this.wave*ENDLESS.xpPerWave));
    e.endlessWave=this.wave;
    if(this.wave>=10 && RNG.chance(0.10+this.wave*0.006)){   // 后期精英化
      const k=1.7;
      e.maxHP=Math.round(e.maxHP*k); e.hp=e.maxHP; e.dmg*=1.25;
      e.radius*=1.18; e.color="#ff6b3d"; e.name="狂暴"+e.name; e.xp=Math.round(e.xp*2);
    }
  }

  _startWave(game){
    this.wave++;
    this.state="fighting";
    this.bossWave = this.wave % ENDLESS.bossEvery === 0;
    this._bossSpawned=false;
    this.quota = Math.round(ENDLESS.countBase + (this.wave-1)*ENDLESS.countPerWave) + (this.bossWave?0:0);
    this.spawned=0;
    this.spawnTimer=0.2;
    this.level=this.waveLevel(this.wave);
    game.toast(this.bossWave ? `第 ${this.wave} 波 · 首领来袭` : `第 ${this.wave} 波`);
    if(this.bossWave) game.shake(6);
    SFX.levelup();
  }

  _endWave(game){
    const pl=game.player;
    this.state="intermission";
    this.timer=3.2;
    const gold=Math.round((60 + this.wave*26) * (1+(pl.stats.goldMul||0)));
    pl.gold+=gold;
    pl.heal(pl.stats.maxHP*0.18);
    pl.healShield(pl.stats.maxShield*0.35);
    game.addFloatText(pl.x, pl.y-40, "波次奖励 +"+gold, "#ffd23f", 14);

    // 每 3 波给一件装备，类型随机
    if(this.wave%3===0){
      const ilvl=Math.max(1, this.wave+Math.floor(this.wave*0.25));
      const it=generateItem(ilvl, { mf:pl.mf, luck:this.bossWave, kind:rollItemKind() });
      pushGear(game, pl.x+RNG.fr(-30,30), pl.y+RNG.fr(-30,30), it);
    }
    if(this.bossWave){
      pl.eridium += ENDLESS.eriPerBoss;
      game.addFloatText(pl.x, pl.y-58, "+"+ENDLESS.eriPerBoss+" 镒矿", "#b061ff", 13);
      game.toast(`第 ${this.wave} 波首领已击破`);
    }
    this.bestWave=Math.max(this.bestWave, this.wave);
    if(this.wave>0 && pl.level<CFG.level.maxLevel){
      pl.addXP(Math.round(pl.xpNeeded()*0.25));
    }
    SFX.pickup();
  }

  _spawnPos(game, far){
    const b=this.bounds, pl=game.player;
    for(let i=0;i<30;i++){
      const x=RNG.fr(b.minX+60,b.maxX-60), y=RNG.fr(b.minY+60,b.maxY-60);
      if(!far || !pl || M.dist(x,y,pl.x,pl.y)>420) return {x,y};
    }
    return {x:b.maxX-80,y:b.maxY-80};
  }
}
