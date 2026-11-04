/* =========================================================================
 * main.js — 游戏主循环 / 状态机 / 系统方法（相机、粒子、飘字、震屏、HUD）
 * ========================================================================= */

class Game {
  constructor(){
    document.title = CFG.name + " · " + CFG.en;
    this.canvas=document.getElementById('game');
    this.ctx=this.canvas.getContext('2d');
    this.view={w:0,h:0,dpr:1};
    this.camera={x:0,y:0};
    this.shakeAmt=0; this.shakeT=0;
    this.state="title";
    this.mode="campaign";          // campaign | endless | dust2
    this.player=null; this.world=null; this.bounds=null;
    this.enemies=[]; this.projectiles=[]; this.allies=[]; this.loot=[]; this.particles=[]; this.floats=[];
    this.zoneIndex=0;
    this.toastEl=document.getElementById('toast');
    this.hud=document.getElementById('hud');
    this._toastTimer=null;
    this.last=performance.now();
    this.resize();
    window.addEventListener('resize',()=>this.resize());
    Input.init(this);
    UI.init(this);
    UI.title();
    this._loop=this._loop.bind(this);
    requestAnimationFrame(this._loop);
  }

  resize(){
    const dpr=Math.min(window.devicePixelRatio||1,2);
    const w=window.innerWidth, h=window.innerHeight;
    this.canvas.width=Math.round(w*dpr); this.canvas.height=Math.round(h*dpr);
    this.canvas.style.width=w+'px'; this.canvas.style.height=h+'px';
    this.view={w,h,dpr};
    // 相机缩放：桌面视野更大时放大，让角色更聚焦；移动端保持接近 1:1
    const diag=Math.hypot(w,h);
    this.zoom=M.clamp(diag/920, 1.0, 1.4);
    if(this.mode==="dust2") this.zoom=0.8;   // 沙二固定拉远镜头
    if(this.mode==="raid") this.zoom=0.92;   // 塔科夫模式略拉远，便于观察
    if(this.mode==="br")   this.zoom=0.82;   // 大逃杀略拉远，便于观察缩圈
  }

  worldToScreen(wx,wy){
    const z=this.zoom||1;
    return {x:(wx-this.camera.x)*z, y:(wy-this.camera.y)*z};
  }

  /* ----------------------------- 运行控制 ----------------------------- */
  startRun(classId, saveData){
    this.mode="campaign";
    RNG.setSeed((Date.now()^(Math.random()*1e9))>>>0);
    this.enemies=[]; this.projectiles=[]; this.allies=[]; this.loot=[]; this.particles=[]; this.floats=[];
    this.zoneIndex = (saveData && saveData.zoneIndex) || 0;
    const p=new Player(classId, 0,0, saveData?saveData.name:null);
    p.faction="player";
    if(saveData){
      if(saveData.metaOnly){
        // 死亡后只恢复跨局进度：功勋 / 永久升级 / 改装解锁
        p.souls=saveData.souls||0; p.rebirths=saveData.rebirths||0;
        p.perm=Object.assign({hp:0,dmg:0,mf:0,gf:0,soul:0,drop:0}, saveData.perm||{});
        p.mayhemUnlocked=!!saveData.mayhemUnlocked;
        p.mayhemCapBonus=saveData.mayhemCapBonus||0;
        p.mayhem=Math.min(saveData.mayhem||0, p.maxMayhem());
        p.eridium=saveData.eridium||0;
        p.computeStats();
        p.hp=p.stats.maxHP; p.shield=p.stats.maxShield;
      } else {
        p.level=saveData.level; p.xp=saveData.xp; p.skillPoints=saveData.skillPoints;
        p.skills=saveData.skills; p.ammo=saveData.ammo; p.weapons=saveData.weapons; p.wi=saveData.wi;
        p.gold=saveData.gold||0;
        p.eridium=saveData.eridium||0;
        if(saveData.shields) p.shields=saveData.shields;
        if(saveData.relics) p.relics=saveData.relics;
        p.shieldIdx=saveData.shieldIdx!==undefined?saveData.shieldIdx:(p.shields.length?0:-1);
        p.relicIdx=saveData.relicIdx!==undefined?saveData.relicIdx:(p.relics.length?0:-1);
        p.souls=saveData.souls||0; p.rebirths=saveData.rebirths||0;
        p.perm=Object.assign({hp:0,dmg:0,mf:0,gf:0,soul:0,drop:0}, saveData.perm||{});
        p.mayhemUnlocked=!!saveData.mayhemUnlocked;
        p.mayhemCapBonus=saveData.mayhemCapBonus||0;
        p.mayhem=saveData.mayhem||0;
        p.computeStats(); p.hp=saveData.hp; p.shield=saveData.shield;
      }
    }
    Shop.reset();
    this.player=p;
    this._enterZone(this.zoneIndex, true);
    this.state="playing"; UI.hide(); this._showHUD();
    if(!this._maybeStory()) this.toast(this.world.objective());
  }

  /* 进入区域时展示剧情卡（战役模式） */
  _maybeStory(){
    if(this.mode==="campaign" && this._story && this._story.story){
      this.state="story";
      this.hud.classList.add("hidden");
      const tl=document.getElementById('touch-layer'); if(tl) tl.classList.add("hidden");
      UI.story(this._story);
      return true;
    }
    return false;
  }
  beginAfterStory(){
    this.state="playing"; UI.hide(); this._showHUD();
    this.toast(this.world.objective());
  }

  /* ----------------------------- 无尽模式 ----------------------------- */
  startEndless(classId, saveData){
    this.mode="endless";
    RNG.setSeed((Date.now()^(Math.random()*1e9))>>>0);
    this.enemies=[]; this.projectiles=[]; this.allies=[]; this.loot=[]; this.particles=[]; this.floats=[];
    const p=new Player(classId, 0,0, saveData?saveData.name:null);
    p.faction="player";
    if(saveData){
      p.level=saveData.level||1; p.xp=saveData.xp||0; p.skillPoints=saveData.skillPoints||1;
      p.skills=saveData.skills||{}; p.ammo=saveData.ammo||startAmmo();
      p.gold=saveData.gold||300; p.eridium=saveData.eridium||0;
      p.souls=saveData.souls||0; p.rebirths=saveData.rebirths||0;
      p.perm=Object.assign({hp:0,dmg:0,mf:0,gf:0,soul:0,drop:0}, saveData.perm||{});
      p.mayhemUnlocked=!!saveData.mayhemUnlocked;
      p.mayhemCapBonus=saveData.mayhemCapBonus||0;
      p.mayhem=saveData.mayhem||0;
      if(saveData.weapons) p.weapons=saveData.weapons;
      if(saveData.shields) p.shields=saveData.shields;
      if(saveData.relics) p.relics=saveData.relics;
      p.shieldIdx=saveData.shieldIdx!==undefined?saveData.shieldIdx:(p.shields.length?0:-1);
      p.relicIdx=saveData.relicIdx!==undefined?saveData.relicIdx:(p.relics.length?0:-1);
      p.computeStats(); p.hp=p.stats.maxHP; p.shield=p.stats.maxShield;
    }
    Shop.reset();
    this.player=p;
    this.zoneIndex=0;
    this.world=new EndlessWorld(this, { bestWave:saveData?saveData.bestWave:0 });
    this.bounds=this.world.bounds;
    const b=this.bounds;
    p.x=(b.minX+b.maxX)/2; p.y=(b.minY+b.maxY)/2; p.bounds=b;
    this.enemies=[]; this.projectiles=[]; this.allies=[]; this.loot=[]; this.particles=[]; this.floats=[];
    Input.aimTarget=null;
    const z=this.zoom||1;
    this.camera.x=p.x-(this.view.w/z)/2; this.camera.y=p.y-(this.view.h/z)/2;
    this.state="playing"; this.mode="endless";
    UI.hide(); this._showHUD();
    this.toast("无尽试炼 · 第 1 波即将开始");
  }

  /* ----------------------------- 沙二模式 ----------------------------- */
  startDust2(opts){
    RNG.setSeed((Date.now()^(Math.random()*1e9))>>>0);
    this.enemies=[]; this.projectiles=[]; this.allies=[]; this.loot=[]; this.particles=[]; this.floats=[];
    this.mode="dust2";
    document.body.classList.add("mode-dust");
    this.hud.classList.add("hidden");
    Dust2.start(this, opts);
    this.state="playing";
    UI.hide();
    this._showDustHUD();
  }

  /* ----------------------------- 塔科夫模式（撤离突袭） ----------------------------- */
  startRaid(opts){
    RNG.setSeed((Date.now()^(Math.random()*1e9))>>>0);
    this.enemies=[]; this.projectiles=[]; this.allies=[]; this.loot=[]; this.particles=[]; this.floats=[];
    this.mode="raid";
    this.zoom=0.92;
    document.body.classList.add("mode-raid");
    this.hud.classList.add("hidden");
    try{
      Raid.start(this, opts||{});
    }catch(e){
      // Raid.start 内部已把装备/现金/钥匙/医疗品退回仓库；这里只负责把界面恢复。
      console.error("[startRaid]", e);
      document.body.classList.remove("mode-raid");
      const tl=document.getElementById("touch-layer"); if(tl) tl.classList.add("hidden");
      if(typeof Net!=="undefined" && Net.online) Net.leave(true);
      this.state="title";
      UI.raidSetup();
      this.toast("进入战区失败，装备已退回仓库");
      return;
    }
    this.state="playing";
    UI.hide();
    this._showDustHUD();
  }

  /* ----------------------------- 大逃杀模式 ----------------------------- */
  startBR(opts){
    RNG.setSeed((Date.now()^(Math.random()*1e9))>>>0);
    this.enemies=[]; this.projectiles=[]; this.allies=[]; this.loot=[]; this.particles=[]; this.floats=[];
    this.mode="br";
    this.zoom=0.82;
    document.body.classList.add("mode-br");
    this.hud.classList.add("hidden");
    BR.start(this, opts||{});
    this.state="playing";
    UI.hide();
    this._showDustHUD();
  }

  _showDustHUD(){
    this.hud.classList.add("hidden");
    const tl=document.getElementById("touch-layer");
    if(tl){ if(Input.isTouch) tl.classList.remove("hidden"); else tl.classList.add("hidden"); }
  }

  openBuy(){
    if(this.mode!=="dust2") return;
    if(!Dust2.canBuy()){ this.toast("购买时间已结束"); return; }
    this.state="dustbuy";
    Input.resetStick();
    document.getElementById("touch-layer")?.classList.add("hidden");
    UI.buyMenu();
  }
  closeBuy(){
    if(this.mode!=="dust2") return;
    this.state="playing"; UI.hide(); this._showDustHUD();
  }

  continueRun(){
    const d=Save.load();
    if(d) this.startRun(d.classId, d); else this.toTitle();
  }

  _enterZone(idx, first){
    this.zoneIndex=idx;
    this.world=new Zone(ZONES[idx], this);
    this.bounds=this.world.bounds;
    Shop.reset();   // 换区重置货架
    const cx=(this.bounds.minX+this.bounds.maxX)/2, cy=(this.bounds.minY+this.bounds.maxY)/2;
    this.player.x=cx; this.player.y=cy; this.player.bounds=this.bounds;
    this.enemies=[]; this.projectiles=[]; this.allies=[]; this.loot=[]; this.particles=[]; this.floats=[];
    Input.aimTarget=null;   // 清掉跨区域的旧锁定对象
    const z=this.zoom||1;
    this.camera.x=cx-(this.view.w/z)/2; this.camera.y=cy-(this.view.h/z)/2;
    if(!first && this.player){ this.player.heal(this.player.stats.maxHP*0.4); for(const k in AMMO_MAX) this.player.ammo[k]=Math.min(AMMO_MAX[k], this.player.ammo[k]+Math.round(AMMO_MAX[k]*0.25)); }
    this._story={ name:this.world.name, story:this.world.story||"", level:this.world.level, index:idx, total:ZONES.length };
  }

  nextZone(){
    if(this.zoneIndex+1>=ZONES.length){
      this.player.mayhemUnlocked=true;
      this.state="victory"; Save.save(this); UI.victory(); return;
    }
    this._enterZone(this.zoneIndex+1,false);
    this.state="playing"; UI.hide(); this._showHUD();
    if(!this._maybeStory()) this.toast(this.world.objective());
  }

  _showHUD(){
    this.hud.classList.remove('hidden');
    if(Input.isTouch){
      const tl=document.getElementById('touch-layer');
      if(tl) tl.classList.remove('hidden');
    }
  }

  onZoneComplete(zone){
    Save.save(this);
    if(zone.def.boss){
      // 通关：解锁改装等级，进入可无限轮回的「改装周目」
      this.player.mayhemUnlocked=true;
      this.state="victory"; UI.victory(); Save.save(this); return;
    }
    this.player.heal(this.player.stats.maxHP*0.5);
    this.state="zoneclear"; UI.zoneClear(zone,false);
  }

  /* 进入下一轮改装周目：区域回到起点，怪物变强、掉落变好 */
  startCycle(){
    const p=this.player;
    p.mayhemUnlocked=true;
    const cap=p.maxMayhem();
    p.mayhem=M.clamp(p.mayhem+1, 0, cap);
    this.zoneIndex=0;
    this._enterZone(0,true);
    p.hp=p.stats.maxHP; p.shield=p.stats.maxShield;
    for(const k in AMMO_MAX) p.ammo[k]=AMMO_MAX[k];
    this.state="playing"; UI.hide(); this._showHUD();
    this.toast(`改装 ${p.mayhem} · 怪物生命 ×${p.mayhemHpMul().toFixed(1)} · 掉落 ilvl +${p.mayhem}`);
    Save.save(this);
  }

  /* 重新部署：重置进度，回到第一区，保留功勋与永久升级 */
  doRebirth(){
    const p=this.player;
    const r=p.rebirth();
    if(!r.ok){ this.toast(r.msg); return r; }
    this.zoneIndex=0;
    this._enterZone(0,true);
    p.hp=p.stats.maxHP; p.shield=p.stats.maxShield;
    this.state="playing"; UI.hide(); this._showHUD();
    this.toast(r.msg);
    Save.save(this);
    return r;
  }

  pause(){
    if(this.state==="playing"){
      this.state="paused"; Input.resetStick();
      // 塔科夫商店/物品栏是自绘 DOM 弹层；暂停面板会替换它们，必须同步清掉逻辑状态，
      // 否则 shopOpen 残留会让 E 键永久失效。
      if(this.mode==="raid" && typeof Raid!=="undefined" && Raid.resetUiState) Raid.resetUiState();
      this.hud.classList.add("hidden");
      const tl=document.getElementById('touch-layer'); if(tl) tl.classList.add("hidden");
      if(this.mode==="dust2") UI.dustPause();
      else if(this.mode==="raid") UI.raidPause();
      else if(this.mode==="br") UI.brPause();
      else UI.pause();
    }
  }
  resume(){
    if(this.state==="paused"||this.state==="skill"||this.state==="inv"||this.state==="dustbuy"){
      if(this.mode==="raid" && typeof Raid!=="undefined" && Raid.resetUiState) Raid.resetUiState();
      this.state="playing"; Input.resetStick(); UI.hide();
      if(this.mode==="dust2"||this.mode==="raid"||this.mode==="br") this._showDustHUD(); else this._showHUD();
    }
  }
  openSkill(){ if(this.state==="playing"){ this.state="skill"; UI.skillTree(); } }
  openInv(){ if(this.state==="playing"){ this.state="inv"; UI.inventory(); } }
  toTitle(){
    this.state="title"; this.player=null; this.world=null; this.mode="campaign";
    Dust2.active=false;
    if(typeof Raid!=="undefined") Raid.active=false;
    if(typeof BR!=="undefined") BR.active=false;
    document.body.classList.remove("mode-dust");
    document.body.classList.remove("mode-raid");
    document.body.classList.remove("mode-br");
    document.body.classList.remove("inv-open");
    if(typeof Raid!=="undefined" && Raid.resetUiState) Raid.resetUiState();
    if(typeof BR!=="undefined") BR.showInv=false;
    const invLayer=document.getElementById("inv-layer");
    if(invLayer){ invLayer.classList.add("hidden"); invLayer.innerHTML=""; }
    this.hud.classList.add("hidden");
    const tl=document.getElementById("touch-layer"); if(tl) tl.classList.add("hidden");
    UI.title();
  }

  /* ----------------------------- 主循环 ----------------------------- */
  _loop(t){
    let dt=(t-this.last)/1000; this.last=t;
    if(dt>0.05) dt=0.05;
    // 联机结算后（阵亡 / 撤离）仍要继续跑：房主要给队友模拟 AI，自己转观战
    if(this.state==="playing" || (this.mode==="raid" && typeof Raid!=="undefined" && Raid.active)) this.update(dt);
    else {
      const a=Input.consume();
      if(this.state==="paused"&&a.pause) this.resume();
      else if(this.state==="dustbuy"&&a.pause) this.closeBuy();
    }
    Render.render(this);
    this.updateHUD();
    requestAnimationFrame(this._loop);
  }

  update(dt){
    // 沙二模式完全走自己的循环；比赛结束后 Dust2.active=false，此时直接停摆，
    // 绝不能掉回战役逻辑（那里的 player 是 Duelist，没有 update 方法）
    if(this.mode==="dust2"){
      if(Dust2.active) Dust2.update(this,dt);
      return;
    }
    if(this.mode==="raid"){
      if(Raid.active) Raid.update(this,dt);
      return;
    }
    if(this.mode==="br"){
      if(BR.active) BR.update(this,dt);
      return;
    }
    const p=this.player;
    const a=Input.consume();
    if(a.pause){ this.pause(); return; }
    if(a.skill){ this.openSkill(); return; }
    if(a.inv){ this.openInv(); return; }
    Input.sample(this);
    if(a.reload) p.activeWeapon.startReload(p);
    if(a.ability) p.ability(this);
    if(a.switch) p.switchWeapon();
    if(a.melee) p.melee(this);

    // 弹匣打空自动换弹（移动端减负；桌面同样适用，R 仍可手动）
    const aw=p.activeWeapon;
    if(aw && aw.mag<=0 && !aw.reloading && (p.ammo[aw.stats.ammoType]||0)>0) aw.startReload(p);

    p.update(dt,this);
    if(Input._firing) p.fire(this, p.angle);

    // 敌人更新，同时记录速度（供自动瞄准做提前量预测）
    for(const e of this.enemies){
      if(!e.alive) continue;
      const ox=e.x, oy=e.y;
      e.update(dt,this);
      e.vx=(e.x-ox)/dt; e.vy=(e.y-oy)/dt;
    }
    for(const al of this.allies) al.update(dt,this);
    updateProjectiles(dt,this);

    // 敌人死亡结算
    for(let i=this.enemies.length-1;i>=0;i--){
      const e=this.enemies[i];
      if(!e.alive){
        p.addXP(e.xp||0);                       // 击杀经验
        dropLoot(this,e);
        this.spawnHitFx(e.x,e.y,e.color);
        this.spawnExplosion(e.x,e.y, e.type==="boss"?90:e.radius*1.4, e.type==="boss"?"#ffd23f":e.color);
        this.enemies.splice(i,1);
      }
    }
    for(let i=this.allies.length-1;i>=0;i--) if(this.allies[i].dead) this.allies.splice(i,1);

    this.world.update(dt,this);

    // 战利品：靠近磁吸 + 自动拾取
    for(let i=this.loot.length-1;i>=0;i--){
      const l=this.loot[i];
      const d=M.dist(p.x,p.y,l.x,l.y);
      if(d<300 && d>CFG.player.pickupRange){
        const a=M.angle(l.x,l.y,p.x,p.y);
        const sp=140 + (300-d)*2.6;
        l.x+=Math.cos(a)*sp*dt; l.y+=Math.sin(a)*sp*dt;
      }
      if(d < CFG.player.pickupRange){ l.pickup(this); this.loot.splice(i,1); }
    }

    this._updateParticles(dt); this._updateFloats(dt);
    if(this.shakeT>0) this.shakeT-=dt;
    this._updateCamera();

    if(p._leveledUp){ SFX.levelup(); this.toast("升级！ Lv."+p.level); p.heal(p.stats.maxHP*0.3); p._leveledUp=false; }
    if(!p.alive){ this.state="gameover"; Save.saveMeta(this); UI.gameOver(); }
  }

  _updateCamera(){
    const p=this.player, v=this.view, b=this.bounds;
    const z=this.zoom||1, vw=v.w/z, vh=v.h/z;
    let tx=p.x-vw/2, ty=p.y-vh/2;
    if(b){
      const bw=b.maxX-b.minX, bh=b.maxY-b.minY;
      tx = bw<=vw ? (b.minX+b.maxX)/2 - vw/2 : M.clamp(tx,b.minX,b.maxX-vw);
      ty = bh<=vh ? (b.minY+b.maxY)/2 - vh/2 : M.clamp(ty,b.minY,b.maxY-vh);
    }
    this.camera.x=M.lerp(this.camera.x,tx,0.12); this.camera.y=M.lerp(this.camera.y,ty,0.12);
  }

  _updateParticles(dt){
    for(let i=this.particles.length-1;i>=0;i--){
      const pt=this.particles[i]; pt.x+=pt.vx*dt; pt.y+=pt.vy*dt; pt.vx*=0.92; pt.vy*=0.92; pt.life-=dt;
      if(pt.life<=0) this.particles.splice(i,1);
    }
  }
  _updateFloats(dt){
    for(let i=this.floats.length-1;i>=0;i--){
      const f=this.floats[i]; f.y+=f.vy*dt; f.life-=dt;
      if(f.life<=0) this.floats.splice(i,1);
    }
  }

  /* ----------------------------- 系统方法 ----------------------------- */
  addFloatText(x,y,text,color,size){
    this.floats.push({x,y,text,color:color||"#fff",life:0.9,maxLife:0.9,vy:-32,size:size||14});
  }
  spawnHitFx(x,y,color,crit){
    const n=crit?8:4;
    for(let i=0;i<n;i++){ const a=Math.random()*6.28, s=Math.random()*120+40;
      this.particles.push({x,y,vx:Math.cos(a)*s,vy:Math.sin(a)*s,life:0.3,maxLife:0.3,color:color||"#fff",size:crit?4:2.5}); }
  }
  spawnExplosion(x,y,r,color){
    this.particles.push({x,y,vx:0,vy:0,life:0.3,maxLife:0.3,color:color||"#ffb020",size:r,ring:true});
    for(let i=0;i<14;i++){ const a=Math.random()*6.28, s=Math.random()*200+60;
      this.particles.push({x,y,vx:Math.cos(a)*s,vy:Math.sin(a)*s,life:0.4,maxLife:0.4,color:color||"#ffb020",size:3}); }
  }
  shake(amt){ this.shakeAmt=amt; this.shakeT=0.18; }
  toast(msg){
    if(!this.toastEl) return;
    this.toastEl.textContent=msg; this.toastEl.classList.remove('hidden');
    clearTimeout(this._toastTimer);
    this._toastTimer=setTimeout(()=>this.toastEl.classList.add('hidden'),1800);
  }

  /* ----------------------------- HUD ----------------------------- */
  updateHUD(){
    if(this.mode==="dust2"||this.mode==="raid"||this.mode==="br") return;      // 沙二/塔科夫/大逃杀自带 canvas HUD
    if(this.state==="title"||!this.player) return;
    const p=this.player, w=p.activeWeapon;
    const hpF=document.getElementById('hp-fill'), hpT=document.getElementById('hp-text');
    const shF=document.getElementById('shield-fill'), shT=document.getElementById('shield-text');
    const xpF=document.getElementById('xp-fill'), lvT=document.getElementById('lvl-text');
    const amT=document.getElementById('ammo-text'), wn=document.getElementById('weapon-name'), zn=document.getElementById('zone-name');
    hpF.style.width=M.clamp(p.hp/p.stats.maxHP,0,1)*100+'%';
    hpT.textContent=`${Math.ceil(p.hp)}/${p.stats.maxHP}`;
    shF.style.width=(p.stats.maxShield>0?M.clamp(p.shield/p.stats.maxShield,0,1)*100:0)+'%';
    shT.textContent=`${Math.ceil(p.shield)}/${p.stats.maxShield}`;
    xpF.style.width=M.clamp(p.xp/p.xpNeeded(),0,1)*100+'%';
    lvT.textContent='Lv.'+p.level;
    if(w){
      const reserve=p.ammo[w.stats.ammoType]||0;
      amT.innerHTML=`${w.mag} <span class="reserve">/ ${reserve}</span>`;
      wn.textContent=w.name; wn.style.color=w.rarityColor;
    }
    zn.innerHTML=(this.world?this.world.name:'') + (p.mayhem>0?`<span class="mh-badge">改装 ${p.mayhem}</span>`:'');
    const gd=document.getElementById('gold-text');
    if(gd) gd.textContent=p.gold.toLocaleString();

    // 移动端技能按钮冷却反馈
    const abBtn=document.getElementById('touch-ability');
    if(abBtn){ abBtn.classList.toggle('cooling', p.abilityCD>0); }
    const rlBtn=document.getElementById('touch-reload');
    if(rlBtn){ const need=w && w.mag<w.getMagSize(p); rlBtn.classList.toggle('dim', !need); }
  }
}

// 启动
const game = new Game();
window.game = game;
