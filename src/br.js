/* =========================================================================
 * br.js — 大逃杀模式（BATTLE ROYALE · 绝地岛）
 *
 * 参考《PUBG》玩法：
 *   · 所有玩家空降同一张绝地岛地图（本页用 1 名玩家 + 49 名 AI PMC模拟满员服务器）
 *   · 开局空手跳伞，落地后搜刮地面武器 / 护甲 / 医疗包
 *   · 安全区（白圈）会不断缩小，圈外持续掉血，逼迫所有人向中心交火
 *   · 只有活到最后一人才能吃鸡；阵亡即淘汰，结算显示最终排名
 *   · 左上角实时击杀提示（Kill Feed）
 *
 * 依赖：util.js(M/RNG/rgba/SFX)、input.js(Input)；渲染走 RenderBR。
 * ========================================================================= */

/* ----------------------------- 地图 ----------------------------- */
const BR_MAP_W = 3200, BR_MAP_H = 3200;
const BR_WATER = 230;                 // 四周海水厚度
const BR_IN  = BR_WATER, BR_OUT = BR_MAP_W - BR_WATER;

// 资源点（城镇），每处生成若干建筑与物资
const BR_POIS = [
  { name:"军事基地", x:820,  y:820  },
  { name:"学校",     x:1600, y:560  },
  { name:"废墟镇",   x:2420, y:760  },
  { name:"医院",     x:560,  y:1620 },
  { name:"教堂",     x:1180, y:1120 },
  { name:"仓库",     x:2080, y:1620 },
  { name:"监狱",     x:2700, y:1620 },
  { name:"渔村",     x:760,  y:2420 },
  { name:"电站",     x:2460, y:2460 },
  { name:"公寓区",   x:1600, y:2680 },
];
// 森林带（作为掩体 + 视觉）
const BR_FORESTS = [
  [1400,1500,360],[2300,1100,300],[1000,2100,300],[1900,2200,320],
  [500,1100,240],[2700,800,240],[1600,1150,220],[1300,2600,260],
];

/* ----------------------------- 枪械 / 护甲 / 医疗 ----------------------------- */
// 吃鸡模式已全面改用「旧刷宝体系」程序化枪械（blGunGen / blGunConvert），
// 此处只保留 AI / 地面掉落所用的枪型池（含火箭筒作为空投级武器）
const BR_GUN_TYPES = ["pistol","smg","shotgun","rifle","sniper","launcher"];
// 高级甲曲线大幅抬升，T7/T8 为「空投级」重装
const BR_ARMORS = {
  vest1: { name:"一级甲", dr:0.10, maxArmor:30,  value:180 },
  vest2: { name:"二级甲", dr:0.17, maxArmor:50,  value:420 },
  vest3: { name:"三级甲", dr:0.26, maxArmor:85,  value:980 },
  vest4: { name:"四级甲", dr:0.36, maxArmor:140, value:2600 },
  vest5: { name:"五级甲", dr:0.47, maxArmor:215, value:7200 },
  vest6: { name:"六级甲", dr:0.58, maxArmor:320, value:19000 },
  vest7: { name:"七级甲", dr:0.68, maxArmor:450, value:48000 },
  vest8: { name:"八级甲", dr:0.76, maxArmor:620, value:128000 },
};
const BR_HELMETS = {
  helm1: { name:"一级盔", dr:0.08, maxArmor:10, value:130 },
  helm2: { name:"二级盔", dr:0.15, maxArmor:20, value:320 },
  helm3: { name:"三级盔", dr:0.23, maxArmor:36, value:760 },
  helm4: { name:"四级盔", dr:0.32, maxArmor:58, value:1900 },
  helm5: { name:"五级盔", dr:0.43, maxArmor:92, value:5200 },
  helm6: { name:"六级盔", dr:0.54, maxArmor:145, value:13000 },
  helm7: { name:"七级盔", dr:0.65, maxArmor:220, value:33000 },
  helm8: { name:"八级盔", dr:0.74, maxArmor:320, value:88000 },
};
const BR_MED = { small:{ name:"绷带", heal:35, value:40 }, big:{ name:"医疗包", heal:75, value:110 } };

function brGunFromItem(it){ return Object.assign({}, it); }

/* ----------------------------- PMC ----------------------------- */
class BROperator {
  constructor(o){
    this.id=o.id; this.name=o.name; this.isPlayer=!!o.isPlayer;
    this.x=o.x; this.y=o.y; this.angle=o.angle!==undefined?o.angle:0;
    this.r=13; this.speed=o.speed||168; this.color=o.color||"#e06a4a";
    this.hp=o.hp||100; this.maxHP=this.hp;
    this.armor=o.armor||0; this.maxArmor=this.armor; this.dr=o.dr||0;
    this.armorTier=o.armorTier||0;
    this.helmetArmor=o.helmetArmor||0; this.maxHelmetArmor=this.helmetArmor;
    this.helmetDr=o.helmetDr||0; this.helmetTier=o.helmetTier||0;
    this.gun=o.gun; this.secondary=o.secondary||null;
    this.mag=this.gun.mag; this.reserve=this.gun.reserve;
    this.fireCd=0; this.reloadT=0; this.alive=true;
    this.moveX=0; this.moveY=0; this.vx=0; this.vy=0;
    this.roamT=0; this.roamPt={x:o.x,y:o.y};
    this.target=null; this.scanT=Math.random()*0.3;
    this.kills=0; this.heal=0; this.healT=0;
  }
  activeGun(){ return this.gun; }
}

/* ----------------------------- 主控 ----------------------------- */
const BR = {
  active:false,
  map:null,
  player:null,
  ops:[],
  loot:[],
  walls:[],
  trees:[],
  buildings:[],
  tracers:[],
  killfeed:[],
  floats:[],
  particles:[],
  camera:{x:0,y:0},
  pregame:3,
  zone:null, next:null, shrinkFrom:null,
  zoneState:"wait", zoneTimer:20, zoneDPS:1.5, zonePhase:1,
  _shrinkDur:15, _waitDur:20,
  hits:0, placement:0, total:50,
  outOfZone:false,
  hitFlash:0,
  aimTgt:null,
  uidN:0,
  showInv:false,
  _shownWarn:false,

  /* ----------------------------- 启动 ----------------------------- */
  start(game, opts={}){
    RNG.setSeed((Date.now()^(Math.random()*1e9))>>>0);
    this.active=true; this.game=game;
    this.map={w:BR_MAP_W,h:BR_MAP_H};
    this.tracers=[]; this.killfeed=[]; this.floats=[]; this.particles=[]; this.rockets=[]; this.blasts=[];
    this.hitFlash=0; this.aimTgt=null; this.outOfZone=false; this._shownWarn=false;
    this.hits=0; this.uidN=0;
    this.total = opts.lobby || 50;

    this._buildMap();
    this.loot=[]; this._spawnLoot();

    // 出生点：均匀散布在岛内
    const spawns=this._spawnPoints(this.total);

    // 玩家：第 0 个出生点
    const p0=spawns[0];
    this.player=new BROperator({
      id:"you", name:"你", isPlayer:true, x:p0.x, y:p0.y, angle:Math.random()*6.28,
      speed:180, hp:100, color:"#4fd6ff", gun:blGunGen(6,{type:"pistol",rarity:"green"}),
    });

    // AI PMC：补满服务器
    this.ops=[this.player];
    const names=["Vortex","Nova","Ghost","Razor","Echo","Titan","Blaze","Frost","Onyx","Saber",
      "Viper","Hawk","Wolf","Cobra","Lynx","Drift","Ember","Quill","Slate","Pyre",
      "Rune","Crow","Moth","Talon","Wisp","Brick","Fang","Surge","Volt","Ash",
      "Kite","Mire","Dusk","Pike","Cinder","Thorn","Vale","Bolt","Reed","Crest"];
    const colors=["#e06a4a","#e0b84a","#b06ae0","#4ae0a0","#e04a8a","#7a9be0","#d0d04a","#4ac0d0","#d06a6a","#9be04a"];
    for(let i=1;i<this.total;i++){
      const sp=spawns[i];
      const gid=RNG.pick(["smg","rifle","rifle","shotgun","sniper","pistol","launcher"]);
      this.ops.push(new BROperator({
        id:"op"+i, name:names[(i-1)%names.length]+(i>names.length?("·"+(Math.floor(i/names.length)+1)):""),
        x:sp.x, y:sp.y, angle:Math.random()*6.28, speed:RNG.fr(156,176), hp:100,
        color:colors[(i-1)%colors.length], gun:blGunGen(RNG.ri(6,12),{type:gid}),
      }));
    }

    // 初始安全区：覆盖全岛（出生点散布在整张地图，必须全部落在安全区内，否则落地即被圈外伤害秒杀）
    const cx=BR_MAP_W/2, cy=BR_MAP_H/2;
    const islandR=Math.hypot(BR_MAP_W/2-BR_IN, BR_MAP_H/2-BR_IN)+80;
    this.zone={ x:cx, y:cy, r:islandR };
    this.next=this._pickNext(this.zone);
    this.shrinkFrom=null;
    this.zoneState="wait"; this.zoneTimer=this._waitDur=20; this.zoneDPS=1.5; this.zonePhase=1;
    this._shrinkDur=15;
    this.graceT=8;   // 出生保护期（秒）—— 落地数秒内圈外不掉血，给新手熟悉操作的时间

    this.pregame=3;
    this.placement=this.total;

    this.camera.x=p0.x-game.view.w/(2*(game.zoom||1));
    this.camera.y=p0.y-game.view.h/(2*(game.zoom||1));
    this._updateCamera(game);

    this._feed("系统", this.total+" 名玩家已空降绝地岛", "准备", false, "info");
  },

  _spawnPoints(n){
    // 在岛内生成尽量分散的点（泊松式：随机拒绝过近）
    const pts=[]; const minD=Math.min(360, Math.sqrt((BR_OUT-BR_IN)**2*0.6/n));
    let guard=0;
    while(pts.length<n && guard<n*40){
      guard++;
      const x=RNG.fr(BR_IN+40, BR_OUT-40), y=RNG.fr(BR_IN+40, BR_OUT-40);
      let ok=true;
      for(const p of pts){ if(M.dist2(x,y,p.x,p.y) < minD*minD){ ok=false; break; } }
      if(ok) pts.push({x,y});
    }
    while(pts.length<n) pts.push({x:RNG.fr(BR_IN+40,BR_OUT-40), y:RNG.fr(BR_IN+40,BR_OUT-40)});
    return pts;
  },

  /* ----------------------------- 地图构建 ----------------------------- */
  _buildMap(){
    this.walls=[]; this.trees=[]; this.buildings=[];
    const TH=16;
    const addSeg=(x,y,w,h)=>{ if(w>0&&h>0) this.walls.push({x,y,w,h}); };
    const side=(h, fixed, from, to, door)=>{
      const gap=78;
      if(!door){ if(h) addSeg(from,fixed,to-from,TH); else addSeg(fixed,from,TH,to-from); return; }
      const mid=(from+to)/2, a1=from, a2=mid-gap/2, b1=mid+gap/2, b2=to;
      if(h){ if(a2>a1) addSeg(a1,fixed,a2-a1,TH); if(b2>b1) addSeg(b1,fixed,b2-b1,TH); }
      else { if(a2>a1) addSeg(fixed,a1,TH,a2-a1); if(b2>b1) addSeg(fixed,b1,TH,b2-b1); }
    };

    for(const poi of BR_POIS){
      const n=RNG.ri(4,6);
      for(let i=0;i<n;i++){
        const w=RNG.ri(120,210), h=RNG.ri(110,190);
        const x=poi.x + (RNG.fr(-1,1))*260 - w/2;
        const y=poi.y + (RNG.fr(-1,1))*260 - h/2;
        const rx=Math.max(BR_IN+30,x), ry=Math.max(BR_IN+30,y);
        const rw=Math.min(BR_OUT-rx-30,w), rh=Math.min(BR_OUT-ry-30,h);
        if(rw<70||rh<70) continue;
        const dx=rx+rw/2-(BR_MAP_W/2), dy=ry+rh/2-(BR_MAP_H/2);
        let door = Math.abs(dx)>=Math.abs(dy) ? (dx>0?"right":"left") : (dy>0?"bottom":"top");
        side(true, ry, rx, rx+rw, door==="top");
        side(true, ry+rh-TH, rx, rx+rw, door==="bottom");
        side(false,rx, ry, ry+rh, door==="left");
        side(false,rx+rw-TH, ry, ry+rh, door==="right");
        this.buildings.push({x:rx,y:ry,w:rw,h:rh,name:poi.name});
      }
    }
    // 森林：圆形树障（掩体 + 视觉）
    for(const f of BR_FORESTS){
      const cnt=Math.floor(f[2]/26);
      for(let i=0;i<cnt;i++){
        const a=Math.random()*6.28, rr=Math.random()*f[2]*0.9;
        const tx=f[0]+Math.cos(a)*rr, ty=f[1]+Math.sin(a)*rr;
        if(tx<BR_IN+20||tx>BR_OUT-20||ty<BR_IN+20||ty>BR_OUT-20) continue;
        this.trees.push({x:tx,y:ty,r:14+Math.random()*6, sway:Math.random()*6.28});
      }
    }
  },

  _spawnLoot(){
    // 资源点内物资
    for(const b of this.buildings){
      const n=RNG.ri(2,4);
      for(let i=0;i<n;i++){
        const x=b.x+RNG.fr(20,b.w-20), y=b.y+RNG.fr(20,b.h-20);
        this.loot.push(this._rollLoot(x,y));
      }
    }
    // 散布物资
    for(let i=0;i<46;i++){
      const x=RNG.fr(BR_IN+40,BR_OUT-40), y=RNG.fr(BR_IN+40,BR_OUT-40);
      this.loot.push(this._rollLoot(x,y));
    }
  },

  _uid(){ return "g"+(this.uidN++)+"-"+Math.floor(Math.random()*9999); },

  _rollLoot(x,y){
    const roll=RNG.f();
    if(roll<0.50){           // 武器（旧刷宝体系程序化枪械）
      const id=RNG.pick(BR_GUN_TYPES);
      const w=blGunGen(RNG.ri(5,13),{type:id});
      w.uid=this._uid(); w.kind="weapon"; w.x=x; w.y=y;
      return w;
    } else if(roll<0.68){    // 护甲（1~8 级）
      const t=RNG.ri(1,8), b=BR_ARMORS["vest"+t];
      return { uid:this._uid(), kind:"armor", x, y, id:"vest"+t, tier:t, name:b.name,
        rarity:Math.min(4,Math.floor((t-1)/2)), dr:b.dr,
        maxArmor:Math.round(b.maxArmor), value:b.value };
    } else if(roll<0.80){    // 头盔（1~8 级）
      const t=RNG.ri(1,8), b=BR_HELMETS["helm"+t];
      return { uid:this._uid(), kind:"helmet", x, y, id:"helm"+t, tier:t, name:b.name,
        rarity:Math.min(4,Math.floor((t-1)/2)), dr:b.dr,
        maxArmor:Math.round(b.maxArmor), value:b.value };
    } else {                 // 医疗
      const id=RNG.chance(0.42)?"big":"small"; const b=BR_MED[id];
      return { uid:this._uid(), kind:"med", x, y, id, name:b.name, heal:b.heal, value:b.value };
    }
  },

  /* ----------------------------- 更新 ----------------------------- */
  update(game, dt){
    if(!this.active) return;
    const act=Input.consume();
    if(act.pause){ game.pause(); return; }
    if(act.inv){
      this.showInv=!this.showInv; SFX.ui();
      document.body.classList.toggle('inv-open', this.showInv);   // 只收起其它触屏键，保留背包键可点
    }

    const p=this.player;
    if(this.hitFlash>0) this.hitFlash-=dt;

    // 冷却与换弹
    for(const o of this.ops){
      if(!o.alive) continue;
      o.fireCd=Math.max(0,o.fireCd-dt);
      if(o.reloadT>0){ o.reloadT-=dt; if(o.reloadT<=0){ const need=o.gun.mag-o.mag, take=Math.min(need,o.reserve); o.mag+=take; o.reserve-=take; } }
    }

    // 跳伞准备阶段
    if(this.pregame>0){
      this.pregame-=dt;
      this._updateCamera(game);
      for(let i=this.floats.length-1;i>=0;i--){ const f=this.floats[i]; f.y+=f.vy*dt; f.life-=dt; if(f.life<=0) this.floats.splice(i,1); }
      return;
    }

    this._playerControl(dt, game, act);
    if(!this.active) return;
    this._botsUpdate(dt, game);
    if(!this.active) return;
    this._pickup(dt);
    this._zoneUpdate(dt);
    if(!this.active) return;

    // 胜负判定
    if(this.player.alive && this.aliveFoes()===0){ this._win(); return; }

    this._updateCamera(game);

    // 粒子/飘字/曳光/提示老化
    for(let i=this.tracers.length-1;i>=0;i--){
      const tr=this.tracers[i]; tr.life-=dt;
      if(tr.life<=0){ this.tracers.splice(i,1); continue; }
      if(!tr.laser){ const f=1-M.clamp(tr.life/(tr.maxLife||0.08),0,1); tr.bx=tr.x1+(tr.x2-tr.x1)*f; tr.by=tr.y1+(tr.y2-tr.y1)*f; }
    }
    // 火箭弹：慢速飞行 + 命中/撞墙/超时爆炸
    for(let i=this.rockets.length-1;i>=0;i--){ if(this._updateRocket(this.rockets[i],dt)) this.rockets.splice(i,1); }
    for(let i=this.blasts.length-1;i>=0;i--){ const b=this.blasts[i]; b.life-=dt; if(b.life<=0) this.blasts.splice(i,1); }
    for(let i=this.floats.length-1;i>=0;i--){ const f=this.floats[i]; f.y+=f.vy*dt; f.life-=dt; if(f.life<=0) this.floats.splice(i,1); }
    for(let i=this.particles.length-1;i>=0;i--){ const q=this.particles[i]; q.x+=q.vx*dt; q.y+=q.vy*dt; q.vx*=0.9; q.vy*=0.9; q.life-=dt; if(q.life<=0) this.particles.splice(i,1); }
    for(let i=this.killfeed.length-1;i>=0;i--){ this.killfeed[i].t-=dt; if(this.killfeed[i].t<=0) this.killfeed.splice(i,1); }
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
    let ml=Math.hypot(mx,my); if(ml>1){ mx/=ml; my/=ml; }

    if(act.switch && p.secondary){ const t=p.gun; p.gun=p.secondary; p.secondary=t; p.mag=p.gun.mag; p.reserve=p.gun.reserve; p.reloadT=0; p.fireCd=Math.max(p.fireCd,0.25); SFX.ui(); }

    let fire=false;
    if(Input.isTouch){
      const tgt=this._nearestFoe(p, p.gun.range);
      this.aimTgt=tgt;
      if(tgt){ p.angle=M.lerpAngle(p.angle, M.angle(p.x,p.y,tgt.x,tgt.y), 0.42); fire=Input.fireHeld||Input.autoFire; }
      else { if(ml>0.12) p.angle=M.lerpAngle(p.angle, Math.atan2(my,mx), 0.25); fire=Input.fireHeld; }
    } else {
      const w=this._screenToWorld(Input.mouse.sx, Input.mouse.sy, game);
      p.angle=Math.atan2(w.y-p.y, w.x-p.x);
      fire=Input.mouse.down;
    }

    const sp=p.speed*(p.reloadT>0?0.7:1);
    this._moveOp(p, mx*sp*dt, my*sp*dt);
    p.vx=mx*sp; p.vy=my*sp;

    if(act.reload) this._startReload(p);
    if(p.mag<=0 && p.reloadT<=0) this._startReload(p);

    if(fire && p.fireCd<=0 && p.reloadT<=0){ if(p.mag>0) this._fire(p, p.angle, game); else this._startReload(p); }

    // 使用医疗 / 拾取
    if(act.med || act.interact){ this._useMed(p); }

    // 圈外提示（出生保护期内不显示红屏，避免误导）
    this.outOfZone = this.graceT<=0 && M.dist(p.x,p.y,this.zone.x,this.zone.y) > this.zone.r;
  },

  _useMed(o){
    if(o.heal<=0 || o.healT>0 || o.hp>=o.maxHP){ return; }
    o.healT=0.4;
    const amt=Math.min(40, o.heal, o.maxHP-o.hp);
    o.hp+=amt; o.heal-=amt;
    if(o.isPlayer){ this._float(o.x,o.y-26,"+"+Math.round(amt),"#7dff9a"); SFX.pickup(); }
  },

  _startReload(o){
    if(o.reloadT>0 || o.mag>=o.gun.mag || o.reserve<=0) return;
    o.reloadT=Math.max(0.9, 2.4-o.gun.mag*0.012);
    if(o.isPlayer) SFX.reload();
  },

  _moveOp(o, dx, dy){
    const px=o.x, py=o.y;
    let nx=o.x+dx, ny=o.y+dy;
    let r=this._resolve(nx, o.y, o.r); nx=r.x;
    r=this._resolve(nx, ny, o.r); nx=r.x; ny=r.y;
    // 树障
    for(const t of this.trees){
      const cx=M.clamp(nx,t.x,t.x+t.r), cy=M.clamp(ny,t.y,t.y+t.r);
      const ddx=nx-cx, ddy=ny-cy, d2=ddx*ddx+ddy*ddy;
      if(d2<o.r*o.r){ const d=Math.sqrt(d2)||0.0001, push=o.r-d; nx+=(ddx/d)*push; ny+=(ddy/d)*push; }
    }
    // 海水边界
    nx=M.clamp(nx, BR_IN+o.r, BR_OUT-o.r);
    ny=M.clamp(ny, BR_IN+o.r, BR_OUT-o.r);
    o.x=nx; o.y=ny;
    // 移动幅度（0..1）：180px/s÷60 ≈ 3px/帧
    o._mv = Math.min(1, Math.hypot(o.x-px, o.y-py)/3.0);
  },

  _resolve(x, y, r){
    for(const w of this.walls){
      const nx=M.clamp(x, w.x, w.x+w.w), ny=M.clamp(y, w.y, w.y+w.h);
      const dx=x-nx, dy=y-ny, d2=dx*dx+dy*dy;
      if(d2<r*r){ const d=Math.sqrt(d2)||0.0001, push=r-d; x+=(dx/d)*push; y+=(dy/d)*push; }
    }
    return {x,y};
  },

  /* ----------------------------- AI PMC ----------------------------- */
  _botsUpdate(dt, game){
    for(const b of this.ops){
      if(b.isPlayer||!b.alive) continue;
      if(b.healT>0){ b.healT-=dt; }
      this._tickHeal(b, dt);

      b.scanT-=dt;
      if(b.scanT<=0){ b.scanT=0.3+RNG.f()*0.25; b.target=this._findTarget(b); }

      const inZone = M.dist(b.x,b.y,this.zone.x,this.zone.y) <= this.zone.r;
      let mx=0,my=0;

      if(b.target && b.target.alive){
        const t=b.target, d=M.dist(b.x,b.y,t.x,t.y);
        b.angle=M.lerpAngle(b.angle, M.angle(b.x,b.y,t.x,t.y), 0.18);
        if(d>300){ mx=Math.cos(b.angle); my=Math.sin(b.angle); }
        else if(d<150){ mx=-Math.cos(b.angle); my=-Math.sin(b.angle); }
        if(b.fireCd<=0 && b.reloadT<=0 && this._los(b.x,b.y,t.x,t.y)){
          if(b.mag>0) this._fire(b, b.angle+(RNG.f()-0.5)*0.05, game);
          else this._startReload(b);
        }
      } else {
        let gx, gy;
        if(!inZone){ gx=this.zone.x; gy=this.zone.y; }
        else {
          if(!b.roamPt || b.roamT<=0 || M.dist(b.x,b.y,b.roamPt.x,b.roamPt.y)<70){
            const lp=this._nearestLoot(b.x,b.y,1000);
            if(lp){ b.roamPt={x:lp.x,y:lp.y}; }
            else { const rp=this._randPointInZone(); b.roamPt=rp; }
            b.roamT=RNG.fr(3,7);
          }
          gx=b.roamPt.x; gy=b.roamPt.y;
        }
        const a=M.angle(b.x,b.y,gx,gy);
        b.angle=M.lerpAngle(b.angle,a,0.06);
        mx=Math.cos(a); my=Math.sin(a);
      }
      this._moveOp(b, mx*b.speed*dt, my*b.speed*dt);
    }
  },

  _tickHeal(o, dt){
    if(o.hp < o.maxHP*0.55 && o.heal>0){
      const amt=Math.min(45*dt, o.heal, o.maxHP-o.hp);
      o.hp+=amt; o.heal-=amt;
    }
  },

  _findTarget(b){
    let best=null, bd=720*720;
    for(const e of this.ops){
      if(e===b||!e.alive) continue;
      const dd=M.dist2(b.x,b.y,e.x,e.y);
      if(dd<bd && this._los(b.x,b.y,e.x,e.y)){ bd=dd; best=e; }
    }
    return best;
  },

  _nearestFoe(o, range, playerOnly){
    let best=null, bd=range*range;
    for(const e of this.ops){
      if(e===o||!e.alive) continue;
      if(playerOnly && !e.isPlayer) continue;
      const dd=M.dist2(o.x,o.y,e.x,e.y);
      if(dd<bd && this._los(o.x,o.y,e.x,e.y)){ bd=dd; best=e; }
    }
    return best;
  },

  _nearestLoot(x,y,range){
    let best=null, bd=range*range;
    for(const l of this.loot){
      const dd=M.dist2(x,y,l.x,l.y);
      if(dd<bd){ bd=dd; best=l; }
    }
    return best;
  },

  _randPointInZone(){
    const a=Math.random()*6.28, rr=Math.random()*this.zone.r*0.9;
    return { x:M.clamp(this.zone.x+Math.cos(a)*rr, BR_IN+20, BR_OUT-20),
             y:M.clamp(this.zone.y+Math.sin(a)*rr, BR_IN+20, BR_OUT-20) };
  },

  /* ----------------------------- 拾取 ----------------------------- */
  _pickup(dt){
    for(let i=this.loot.length-1;i>=0;i--){
      const l=this.loot[i];
      // 找最近的可拾取PMC
      let taker=null, td=34*34;
      for(const o of this.ops){
        if(!o.alive) continue;
        const dd=M.dist2(o.x,o.y,l.x,l.y);
        if(dd<td){ td=dd; taker=o; }
      }
      if(!taker) continue;
      this.loot.splice(i,1);
      this._giveLoot(taker, l);
    }
  },

  _giveLoot(o, l){
    if(l.kind==="weapon"){
      if(!o.gun || o.gun.dmg < l.dmg){ if(o.secondary) {} o.secondary=o.gun; o.gun=brGunFromItem(l); o.mag=o.gun.mag; o.reserve=o.gun.reserve; }
      else if(!o.secondary || o.secondary.dmg < l.dmg){ o.secondary=brGunFromItem(l); }
      else return;
      if(o.isPlayer){ this._float(o.x,o.y-26,"拾取 "+l.name, gunRarColor(l.rarity)); SFX.pickup(); }
    } else if(l.kind==="armor"){
      if(l.dr>=o.dr){
        o.dr=l.dr; o.maxArmor=l.maxArmor; o.armor=o.maxArmor; o.armorTier=l.tier||0;
        if(o.isPlayer){ this._float(o.x,o.y-26,"穿上 "+l.name,"#7ab4ff"); SFX.pickup(); }
      }
    } else if(l.kind==="helmet"){
      if(l.dr>=o.helmetDr){
        o.helmetDr=l.dr; o.maxHelmetArmor=l.maxArmor; o.helmetArmor=o.maxHelmetArmor; o.helmetTier=l.tier||0;
        if(o.isPlayer){ this._float(o.x,o.y-26,"戴上 "+l.name,"#8fd0ff"); SFX.pickup(); }
      }
    } else if(l.kind==="med"){
      o.heal=Math.min(150, o.heal+l.heal);
      if(o.isPlayer){ this._float(o.x,o.y-26,"+"+l.heal+" 医疗","#7dff9a"); SFX.pickup(); }
    }
  },

  /* ----------------------------- 射击 / 伤害 ----------------------------- */
  _fire(sh, angle, game){
    if(sh.fireCd>0 || sh.reloadT>0) return;
    if(sh.mag<=0){ this._startReload(sh); return; }
    sh.mag--;
    sh.fireCd=60/Math.max(40, sh.gun.rpm);
    if(sh.isPlayer) SFX.shoot();
    // 火箭筒：发射慢速火箭弹（命中/撞墙后范围爆炸），不走射线
    if(sh.gun.cat==="launcher"){
      this.rockets.push({ x:sh.x, y:sh.y, ang:angle, speed:240, dmg:sh.gun.dmg,
        splash:Math.max(96, sh.gun.splash||120), owner:sh, gun:sh.gun, life:3.4,
        color:sh.gun.color||"#ffb020", trail:[] });
      return;
    }
    const pellets=sh.gun.pellets||1;
    // 与塔科夫模式一致：非霰弹枪的多发是稀有词条，总伤害只 +30%
    const pelletMul = pellets<=1 ? 1
      : ((sh.gun.type==="shotgun"||sh.gun.cat==="shotgun") ? 0.9 : (1.30/pellets));
    const mv=sh._mv||0;
    const moveMul=moveSpreadMul(sh.gun.cat, mv);
    const baseSpread=sh.gun.spread*(sh.isPlayer?1.0:2.8)*2.4;
    for(let k=0;k<pellets;k++){
      let spread=baseSpread*moveMul;
      if(mv>0.05 && !isSMG(sh.gun.cat)) spread=Math.min(spread, Math.max(baseSpread*1.35, moveSpreadCap(sh.gun.cat)));
      const a=angle+(Math.random()-0.5)*spread*2;
      const range=sh.gun.range;
      const ex=sh.x+Math.cos(a)*range, ey=sh.y+Math.sin(a)*range;
      const wh=this._rayWall(sh.x,sh.y,ex,ey);
      let cut=wh?wh.t:1;
      const bx=sh.x+(ex-sh.x)*cut, by=sh.y+(ey-sh.y)*cut;
      let hit=null, hitDist=Infinity;
      for(const o of this.ops){
        if(o===sh||!o.alive) continue;
        const dd=this._pointSeg(o.x,o.y, sh.x,sh.y, bx,by);
        if(dd<o.r+2){ const d2=M.dist(sh.x,sh.y,o.x,o.y); if(d2<hitDist){ hitDist=d2; hit=o; } }
      }
      let hx=bx, hy=by;
      if(hit){ hx=hit.x; hy=hit.y; const falloff=M.clamp(1-hitDist/range*0.45,0.55,1); const dmg=sh.gun.dmg*falloff*pelletMul; this._damage(hit, dmg, sh, sh.gun); }
      this.tracers.push({ x1:sh.x, y1:sh.y, x2:hx, y2:hy, bx:sh.x, by:sh.y, life:0.08, maxLife:0.08,
        laser: !!sh.gun.laser, shape: sh.gun.projShape||"round",
        color: sh.gun.color || (sh.isPlayer?"#ffe08a":"#ff7a5a") });
    }
  },

  _damage(target, dmg, attacker, gun, zone){
    if(!target.alive) return;
    let d=dmg;
    if(zone){
      target.hp-=d;
    } else {
      const pen = (gun && gun.armorPen!==undefined) ? gun.armorPen : 0.10;
      const penMul = 1 - pen*0.90;
      if(RNG.chance(0.15)){                       // 爆头
        d*=1.8;
        if(target.helmetArmor>0 && target.helmetDr>0){
          const ha=Math.min(target.helmetArmor, d*Math.max(0.03, target.helmetDr*penMul));
          target.helmetArmor-=ha; d-=ha;
        }
      }
      if(target.armor>0){ const abs=Math.min(target.armor, d*Math.max(0.03, target.dr*penMul)); target.armor-=abs; d-=abs; }
      d=Math.max(1, Math.round(d));
      target.hp-=d;
    }
    if(target.isPlayer){
      this.hitFlash=Math.min(0.35, this.hitFlash+0.18);
      if(!zone) SFX.hurt();
      this._float(target.x, target.y-24, "-"+Math.round(d), "#ff6a6a");
      if(target.hp<=0){ target.hp=0; target.alive=false; this._onPlayerDeath(zone); }
    } else {
      if(!zone) this._float(target.x, target.y-24, "-"+Math.round(d), "#ffd36a");
      if(target.hp<=0){ target.hp=0; target.alive=false; this._onBotDeath(target, attacker, zone); }
    }
  },

  _onBotDeath(victim, killer, zone){
    if(zone){ this._feed("系统", victim.name, "缩圈淘汰", false, "zone"); return; }
    if(killer && killer.isPlayer){
      killer.kills++;
      this.hits++;
      this._feed("你", victim.name, killer.gun.name, true, "kill");
      this.spawnHit(victim.x, victim.y, "#ff9a5a");
      SFX.hit();
    } else if(killer){
      this._feed(killer.name, victim.name, killer.gun.name, false, "kill");
      this.spawnHit(victim.x, victim.y, "#ff9a5a");
    } else {
      this._feed("未知", victim.name, "交火", false, "kill");
    }
  },

  _onPlayerDeath(zone){
    if(!this.active) return;
    this.active=false;
    if(zone) this._feed("系统","你","缩圈淘汰",false,"zone");
    this.placement = this.aliveFoes() + 1;   // 存活对手数 + 自己 = 最终名次
    this.game.state="brover";
    UI.brResult({ win:false, reason: zone?"被缩圈淘汰":"阵亡", placement:this.placement, total:this.total, kills:this.player.kills });
  },

  _win(){
    if(!this.active) return;
    this.active=false;
    this.placement=1;
    this.game.state="brover";
    UI.brResult({ win:true, placement:1, total:this.total, kills:this.player.kills });
  },

  /* ----------------------------- 安全区 ----------------------------- */
  _pickNext(cur){
    const f=0.58;
    const nr=Math.max(70, cur.r*f);
    const maxOff=Math.max(0, cur.r-nr);
    const ang=RNG.f()*6.2832, off=RNG.f()*maxOff*0.85;
    return { x:cur.x+Math.cos(ang)*off, y:cur.y+Math.sin(ang)*off, r:nr };
  },

  _zoneUpdate(dt){
    if(this.graceT>0){ this.graceT-=dt; if(this.graceT<0) this.graceT=0; }
    if(this.zoneState==="wait"){
      this.zoneTimer-=dt;
      if(this.zoneTimer<=0){ this.zoneState="shrink"; this.zoneTimer=this._shrinkDur; this.shrinkFrom={...this.zone}; }
    } else if(this.zoneState==="shrink"){
      const t=1-this.zoneTimer/this._shrinkDur;
      this.zone.x=M.lerp(this.shrinkFrom.x,this.next.x,t);
      this.zone.y=M.lerp(this.shrinkFrom.y,this.next.y,t);
      this.zone.r=M.lerp(this.shrinkFrom.r,this.next.r,t);
      this.zoneTimer-=dt;
      if(this.zoneTimer<=0){
        this.zone={...this.next}; this.zonePhase++;
        this.zoneDPS=1.5+this.zonePhase*1.2;
        if(this.zone.r<=75){ this.zoneState="done"; }
        else {
          this.next=this._pickNext(this.zone);
          this._shrinkDur=Math.max(8,15-this.zonePhase);
          this._waitDur=Math.max(8,20-this.zonePhase*1.5);
          this.zoneState="wait"; this.zoneTimer=this._waitDur;
        }
      }
    }
    // 圈外掉血（出生保护期内不结算，避免落地即被秒杀）
    for(const o of this.ops){
      if(!o.alive) continue;
      if(this.graceT>0) continue;
      if(M.dist(o.x,o.y,this.zone.x,this.zone.y) > this.zone.r){
        this._damage(o, this.zoneDPS*dt, null, null, true);
        if(!this.active) return;
      }
    }
  },

  /* ----------------------------- 视觉工具 ----------------------------- */
  spawnHit(x,y,color){
    for(let i=0;i<6;i++){ const a=Math.random()*6.28, s=Math.random()*120+40;
      this.particles.push({x,y,vx:Math.cos(a)*s,vy:Math.sin(a)*s,life:0.3,maxLife:0.3,color,size:2.6}); }
  },
  /* ----------------------------- 火箭弹 ----------------------------- */
  _updateRocket(rk, dt){
    const nx=rk.x+Math.cos(rk.ang)*rk.speed*dt, ny=rk.y+Math.sin(rk.ang)*rk.speed*dt;
    const wh=this._rayWall(rk.x,rk.y,nx,ny);
    if(wh){ const t=wh.t||1; this._explodeRocket(rk, rk.x+(nx-rk.x)*t, rk.y+(ny-rk.y)*t); return true; }
    for(const o of this.ops){
      if(o===rk.owner || !o.alive) continue;
      if(M.dist(nx,ny,o.x,o.y) < o.r+10){ this._explodeRocket(rk, nx, ny); return true; }
    }
    rk.x=nx; rk.y=ny;
    rk.trail.push({x:nx,y:ny}); if(rk.trail.length>12) rk.trail.shift();
    rk.life-=dt;
    if(rk.life<=0){ this._explodeRocket(rk, rk.x, rk.y); return true; }
    return false;
  },
  _explodeRocket(rk, x, y){
    const R=rk.splash||120;
    for(const o of this.ops){
      if(!o.alive || o===rk.owner) continue;
      const d=M.dist(x,y,o.x,o.y);
      if(d<=R){ const fall=M.clamp(1-d/R*0.6,0.35,1); this._damage(o, rk.dmg*fall, rk.owner, rk.gun); }
    }
    for(let i=0;i<16;i++){ const a=Math.random()*6.28, s=Math.random()*260+80;
      this.particles.push({x,y,vx:Math.cos(a)*s,vy:Math.sin(a)*s,life:0.5,maxLife:0.5,color:i%2?"#ffd23f":"#ff7a1f",size:3}); }
    this.blasts.push({x,y,r:R*0.45,life:0.34,maxLife:0.34});
    this._float(x, y-30, "爆炸", "#ffb020");
    SFX.boom();
  },

  _float(x,y,text,color){ this.floats.push({x,y,text,color:color||"#fff",life:0.9,maxLife:0.9,vy:-30,size:13}); },
  _feed(a,v,gun,mine,type){ this.killfeed.unshift({a,v,gun,mine:!!mine,type:type||"kill",t:6}); if(this.killfeed.length>6) this.killfeed.pop(); },

  _screenToWorld(sx,sy,game){
    const z=game.zoom||1;
    return { x:this.camera.x+sx/z, y:this.camera.y+sy/z };
  },

  _updateCamera(game){
    const v=game.view, z=game.zoom||1, p=this.player;
    const vw=v.w/z, vh=v.h/z;
    let tx=p.x-vw/2, ty=p.y-vh/2;
    tx = BR_MAP_W<=vw ? (BR_MAP_W-vw)/2 : M.clamp(tx,0,BR_MAP_W-vw);
    ty = BR_MAP_H<=vh ? (BR_MAP_H-vh)/2 : M.clamp(ty,0,BR_MAP_H-vh);
    this.camera.x=M.lerp(this.camera.x,tx,0.2);
    this.camera.y=M.lerp(this.camera.y,ty,0.2);
  },

  _rayWall(x1,y1,x2,y2){
    const dx=x2-x1, dy=y2-y1; const len=Math.hypot(dx,dy);
    if(len<1) return null;
    const steps=Math.ceil(len/12);
    for(let i=1;i<=steps;i++){
      const t=i/steps, px=x1+dx*t, py=y1+dy*t;
      for(const w of this.walls){ if(px>=w.x&&px<=w.x+w.w&&py>=w.y&&py<=w.y+w.h) return {x:px,y:py,t}; }
    }
    return null;
  },
  _los(x1,y1,x2,y2){
    // 宽相：仅检测与线段 AABB 相交的墙
    const minx=Math.min(x1,x2), maxx=Math.max(x1,x2), miny=Math.min(y1,y2), maxy=Math.max(y1,y2);
    for(const w of this.walls){
      if(w.x>maxx||w.x+w.w<minx||w.y>maxy||w.y+w.h<miny) continue;
      if(this._segRect(x1,y1,x2,y2,w)) return false;
    }
    return true;
  },
  _segRect(x1,y1,x2,y2,w){
    // 线段是否与矩形相交（含端点在内）
    if(x1>=w.x&&x1<=w.x+w.w&&y1>=w.y&&y1<=w.y+w.h) return true;
    if(x2>=w.x&&x2<=w.x+w.w&&y2>=w.y&&y2<=w.y+w.h) return true;
    const edges=[[w.x,w.y,w.x+w.w,w.y],[w.x+w.w,w.y,w.x+w.w,w.y+w.h],[w.x+w.w,w.y+w.h,w.x,w.y+w.h],[w.x,w.y+w.h,w.x,w.y]];
    for(const e of edges){ if(this._segSeg(x1,y1,x2,y2,e[0],e[1],e[2],e[3])) return true; }
    return false;
  },
  _segSeg(a,b,c,d,p,q,r,s){
    const d1=(r-p)*(b-q)-(s-q)*(a-p);
    const d2=(r-p)*(d-q)-(s-q)*(c-p);
    const d3=(c-a)*(q-b)-(d-b)*(p-a);
    const d4=(c-a)*(s-b)-(d-b)*(r-a);
    return ((d1>0)!==(d2>0)) && ((d3>0)!==(d4>0));
  },
  _pointSeg(px,py,x1,y1,x2,y2){
    const dx=x2-x1, dy=y2-y1; const L2=dx*dx+dy*dy;
    if(L2===0) return Math.hypot(px-x1,py-y1);
    let t=((px-x1)*dx+(py-y1)*dy)/L2; t=M.clamp(t,0,1);
    const cx=x1+t*dx, cy=y1+t*dy;
    return Math.hypot(px-cx,py-cy);
  },

  aliveFoes(){ return this.ops.filter(o=>!o.isPlayer && o.alive).length; },
};

/* =========================================================================
 * RenderBR — 俯视角渲染 + 自绘 HUD（含左上角击杀提示 / 安全区）
 * ========================================================================= */
const RenderBR = {
  render(ctx, game){
    const R=BR, v=game.view;
    ctx.setTransform(v.dpr,0,0,v.dpr,0,0);
    ctx.fillStyle="#070a08"; ctx.fillRect(0,0,v.w,v.h);
    if(!R.player) return;
    const cam=R.camera, z=game.zoom||1;
    ctx.save(); ctx.scale(z,z); ctx.translate(-cam.x,-cam.y);
    this.scene(ctx, game, cam, z);
    ctx.restore();
    this.hud(ctx, game, v);
  },

  scene(ctx, game, cam, z){
    const R=BR, v=game.view;
    const vw=v.w/z, vh=v.h/z;

    // 海面
    ctx.fillStyle="#0c2233"; ctx.fillRect(0,0,BR_MAP_W,BR_MAP_H);
    // 岛屿地面
    const g=ctx.createLinearGradient(0,0,BR_MAP_W,BR_MAP_H);
    g.addColorStop(0,"#2e3a26"); g.addColorStop(0.5,"#36432c"); g.addColorStop(1,"#2a3522");
    ctx.fillStyle=g; ctx.fillRect(BR_IN,BR_IN,BR_OUT-BR_IN,BR_OUT-BR_IN);
    // 户外网格
    ctx.strokeStyle="rgba(150,180,120,0.05)"; ctx.lineWidth=1;
    const x0=Math.max(0,Math.floor(cam.x/80)*80), y0=Math.max(0,Math.floor(cam.y/80)*80);
    for(let x=x0;x<cam.x+vw+80;x+=80){ ctx.beginPath();ctx.moveTo(x,cam.y);ctx.lineTo(x,cam.y+vh);ctx.stroke(); }
    for(let y=y0;y<cam.y+vh+80;y+=80){ ctx.beginPath();ctx.moveTo(cam.x,y);ctx.lineTo(cam.x+vw,y);ctx.stroke(); }

    // 建筑地面 + 墙体
    for(const b of R.buildings){
      if(b.x>cam.x+vw+120||b.x+b.w<cam.x-120||b.y>cam.y+vh+120||b.y+b.h<cam.y-120) continue;
      ctx.fillStyle="rgba(70,78,86,0.35)"; ctx.fillRect(b.x,b.y,b.w,b.h);
      ctx.strokeStyle="rgba(170,180,190,0.05)"; ctx.lineWidth=1;
      for(let gx=b.x+30;gx<b.x+b.w;gx+=46){ ctx.beginPath();ctx.moveTo(gx,b.y);ctx.lineTo(gx,b.y+b.h);ctx.stroke(); }
    }
    for(const w of R.walls){
      if(w.x>cam.x+vw+60||w.x+w.w<cam.x-60||w.y>cam.y+vh+60||w.y+w.h<cam.y-60) continue;
      ctx.fillStyle="#23282d"; ctx.fillRect(w.x,w.y,w.w,w.h);
      ctx.fillStyle="rgba(160,175,185,0.12)"; ctx.fillRect(w.x,w.y,w.w,3);
      ctx.strokeStyle="#0a0c0d"; ctx.lineWidth=2; ctx.strokeRect(w.x,w.y,w.w,w.h);
    }

    // 森林
    for(const t of R.trees){
      if(t.x>cam.x+vw+40||t.x<cam.x-40||t.y>cam.y+vh+40||t.y<cam.y-40) continue;
      const sway=Math.sin(M.now()*1.5+t.sway)*1.5;
      ctx.fillStyle="rgba(20,40,24,0.5)"; ctx.beginPath(); ctx.ellipse(t.x,t.y+t.r*0.4,t.r*0.9,t.r*0.4,0,0,6.28); ctx.fill();
      ctx.fillStyle="#2f6b34"; ctx.beginPath(); ctx.arc(t.x+sway,t.y,t.r,0,6.28); ctx.fill();
      ctx.fillStyle="#3c8541"; ctx.beginPath(); ctx.arc(t.x-sway*0.6,t.y-t.r*0.3,t.r*0.6,0,6.28); ctx.fill();
    }

    // 资源点名
    ctx.textAlign="center"; ctx.font="bold 16px system-ui,sans-serif"; ctx.fillStyle="rgba(220,225,210,0.30)";
    for(const b of R.buildings){ if(b.x>cam.x+vw||b.x+b.w<cam.x||b.y>cam.y+vh||b.y+b.h<cam.y) continue; ctx.fillText(b.name, b.x+b.w/2, b.y+b.h/2); }

    // 地面物资
    for(const l of R.loot){
      if(l.x>cam.x+vw+40||l.x<cam.x-40||l.y>cam.y+vh+40||l.y<cam.y-40) continue;
      const s=11;
      ctx.save(); ctx.translate(l.x,l.y);
      let col = l.kind==="weapon" ? gunRarColor(l.rarity) : (l.kind==="armor" ? "#7ab4ff" : "#7dff9a");
      ctx.fillStyle=col; ctx.fillRect(-s*0.7,-s*0.5,s*1.4,s);
      ctx.strokeStyle="#0a0c0d"; ctx.lineWidth=2; ctx.strokeRect(-s*0.7,-s*0.5,s*1.4,s);
      ctx.fillStyle="rgba(0,0,0,0.3)"; ctx.fillRect(-s*0.7,-s*0.5,s*1.4,s*0.3);
      ctx.restore();
    }

    // 安全区（圈外红雾 + 蓝圈 + 白圈目标）
    this._drawZone(ctx, R);

    // PMC
    for(const o of R.ops){
      if(!o.alive) continue;
      if(o.x>cam.x+vw+60||o.x<cam.x-60||o.y>cam.y+vh+60||o.y<cam.y-60) continue;
      this.unit(ctx, o, game);
    }

    // 火箭弹：尾焰 + 弹体
    for(const rk of R.rockets){
      const bx=rk.x-Math.cos(rk.ang)*8, by=rk.y-Math.sin(rk.ang)*8;
      ctx.save(); ctx.lineCap="round";
      ctx.strokeStyle=rgba("#ff9a1f",0.55); ctx.lineWidth=5;
      ctx.beginPath(); ctx.moveTo(bx-Math.cos(rk.ang)*16, by-Math.sin(rk.ang)*16); ctx.lineTo(bx,by); ctx.stroke();
      ctx.strokeStyle=rgba("#ffe08a",0.85); ctx.lineWidth=2;
      ctx.beginPath(); ctx.moveTo(bx-Math.cos(rk.ang)*9, by-Math.sin(rk.ang)*9); ctx.lineTo(bx,by); ctx.stroke();
      ctx.restore();
      ctx.save(); ctx.translate(rk.x,rk.y); ctx.rotate(rk.ang);
      ctx.fillStyle="#c9d1da"; ctx.fillRect(-7,-3,13,6);
      ctx.fillStyle=rk.color||"#ffb020"; ctx.beginPath(); ctx.moveTo(10,0); ctx.lineTo(5,-3.2); ctx.lineTo(5,3.2); ctx.closePath(); ctx.fill();
      ctx.strokeStyle="#0d0a07"; ctx.lineWidth=1; ctx.strokeRect(-7,-3,13,6);
      ctx.restore();
    }
    // 爆炸冲击环
    for(const bl of R.blasts){
      const k=1-bl.life/bl.maxLife;
      ctx.globalAlpha=Math.max(0,1-k);
      ctx.strokeStyle="#ffb020"; ctx.lineWidth=4;
      ctx.beginPath(); ctx.arc(bl.x,bl.y, bl.r + k*bl.r*1.8, 0, 6.2832); ctx.stroke();
      ctx.globalAlpha=1;
    }

    // 弹头渲染：实体弹丸 + 曳光尾迹
    for(const tr of R.tracers){
      const al=M.clamp(tr.life/(tr.maxLife||0.08),0,1);
      if(tr.laser){
        ctx.globalAlpha=al; ctx.lineCap="round";
        ctx.strokeStyle=rgba(tr.color,0.28); ctx.lineWidth=6;
        ctx.beginPath(); ctx.moveTo(tr.x1,tr.y1); ctx.lineTo(tr.x2,tr.y2); ctx.stroke();
        ctx.shadowColor=tr.color; ctx.shadowBlur=9;
        ctx.strokeStyle=tr.color; ctx.lineWidth=2.6;
        ctx.beginPath(); ctx.moveTo(tr.x1,tr.y1); ctx.lineTo(tr.x2,tr.y2); ctx.stroke();
        ctx.shadowBlur=0; ctx.strokeStyle="rgba(255,255,255,0.9)"; ctx.lineWidth=1.1;
        ctx.beginPath(); ctx.moveTo(tr.x1,tr.y1); ctx.lineTo(tr.x2,tr.y2); ctx.stroke();
        ctx.globalAlpha=1;
      } else {
        const bx=tr.bx!==undefined?tr.bx:tr.x1, by=tr.by!==undefined?tr.by:tr.y1;
        const ang=Math.atan2(tr.y2-tr.y1, tr.x2-tr.x1);
        const dist=Math.hypot(tr.x2-tr.x1, tr.y2-tr.y1);
        const tl=Math.min(88, Math.max(26, dist*0.5));
        Render.tracerStreak(ctx, bx, by, bx-Math.cos(ang)*tl, by-Math.sin(ang)*tl, tr.color, 2.4, al);
        ctx.save(); ctx.globalAlpha=al; ctx.translate(bx,by); ctx.rotate(ang);
        Render.bulletShape(ctx, tr.shape||"round", 4.2, tr.color);
        ctx.restore(); ctx.globalAlpha=1;
      }
    }

    // 粒子
    for(const q of R.particles){ ctx.globalAlpha=M.clamp(q.life/q.maxLife,0,1); ctx.fillStyle=q.color; ctx.fillRect(q.x-q.size/2,q.y-q.size/2,q.size,q.size); }
    ctx.globalAlpha=1;

    // 飘字
    ctx.textAlign="center"; ctx.font="bold 13px system-ui,sans-serif";
    for(const f of R.floats){ ctx.globalAlpha=M.clamp(f.life/f.maxLife,0,1); ctx.fillStyle=f.color; ctx.fillText(f.text,f.x,f.y); }
    ctx.globalAlpha=1;

    // 桌面准星
    if(!Input.isTouch){
      const w=R._screenToWorld(Input.mouse.sx,Input.mouse.sy,game);
      ctx.strokeStyle="rgba(255,255,255,0.75)"; ctx.lineWidth=1.5;
      ctx.beginPath(); ctx.arc(w.x,w.y,7,0,6.28); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(w.x-12,w.y); ctx.lineTo(w.x-4,w.y); ctx.moveTo(w.x+4,w.y); ctx.lineTo(w.x+12,w.y); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(w.x,w.y-12); ctx.lineTo(w.x,w.y-4); ctx.moveTo(w.x,w.y+4); ctx.lineTo(w.x,w.y+12); ctx.stroke();
    }

    // 跳伞准备提示
    if(R.pregame>0){
      ctx.textAlign="center"; ctx.fillStyle="rgba(0,0,0,0.45)"; ctx.fillRect(0,0,BR_MAP_W,BR_MAP_H);
      ctx.fillStyle="#fff"; ctx.font="bold 64px system-ui,sans-serif";
      ctx.fillText("跳 伞 ！", BR_MAP_W/2, BR_MAP_H/2-10);
      ctx.font="20px system-ui,sans-serif"; ctx.fillStyle="rgba(220,230,240,0.9)";
      ctx.fillText("空降到绝地岛，"+Math.ceil(R.pregame)+" 秒后开战", BR_MAP_W/2, BR_MAP_H/2+40);
    }
  },

  _drawZone(ctx, R){
    const z=R.zone;
    // 圈外红雾（挖洞）
    ctx.save();
    ctx.beginPath();
    ctx.rect(0,0,BR_MAP_W,BR_MAP_H);
    ctx.arc(z.x,z.y,z.r,0,6.2832,true);
    ctx.fillStyle="rgba(170,40,40,0.16)"; ctx.fill("evenodd");
    ctx.restore();
    // 蓝圈
    ctx.strokeStyle="rgba(90,200,255,0.9)"; ctx.lineWidth=4;
    ctx.beginPath(); ctx.arc(z.x,z.y,z.r,0,6.2832); ctx.stroke();
    // 目标白圈（收缩中显示）
    if(R.zoneState==="shrink" && R.next){
      ctx.strokeStyle="rgba(255,255,255,0.65)"; ctx.lineWidth=2; ctx.setLineDash([12,10]);
      ctx.beginPath(); ctx.arc(R.next.x,R.next.y,R.next.r,0,6.2832); ctx.stroke(); ctx.setLineDash([]);
    }
  },

  unit(ctx, o, game){
    const r=o.r;
    ctx.beginPath(); ctx.ellipse(o.x,o.y+r*0.5,r*0.95,r*0.5,0,0,6.2832); ctx.fillStyle="rgba(0,0,0,0.32)"; ctx.fill();
    // 枪（随枪型长度 / 弹种颜色变化）
    const GUN_LEN={pistol:r+10,smg:r+14,shotgun:r+18,rifle:r+20,sniper:r+30,launcher:r+16};
    const g=o.gun; const gLen=(g&&GUN_LEN[g.type])||(r+14);
    const gCol=(g&&g.element!=="none"&&ELEMENTS[g.element])?ELEMENTS[g.element].color:"#2a2f35";
    const gx=Math.cos(o.angle), gy=Math.sin(o.angle);
    ctx.lineCap="round";
    ctx.strokeStyle="#16191e"; ctx.lineWidth=5.5;
    ctx.beginPath(); ctx.moveTo(o.x,o.y); ctx.lineTo(o.x+gx*gLen, o.y+gy*gLen); ctx.stroke();
    ctx.strokeStyle=gCol; ctx.lineWidth=2.4;
    ctx.beginPath(); ctx.moveTo(o.x,o.y); ctx.lineTo(o.x+gx*gLen, o.y+gy*gLen); ctx.stroke();
    ctx.beginPath(); ctx.arc(o.x,o.y,r,0,6.2832); ctx.fillStyle=o.color; ctx.fill();
    ctx.lineWidth=3; ctx.strokeStyle=o.isPlayer?"#0a2a33":"#0d0a07"; ctx.stroke();
    if(o.isPlayer){ ctx.beginPath(); ctx.arc(o.x,o.y,r+4,0,6.2832); ctx.strokeStyle="rgba(79,214,255,0.85)"; ctx.lineWidth=2; ctx.stroke(); }
    ctx.fillStyle="#fff";
    const ex=Math.cos(o.angle)*r*0.4, ey=Math.sin(o.angle)*r*0.4;
    ctx.beginPath(); ctx.arc(o.x+ex,o.y+ey,r*0.22,0,6.28); ctx.fill();
    if(!o.isPlayer){
      ctx.font="11px system-ui,sans-serif"; ctx.textAlign="center"; ctx.fillStyle="rgba(255,190,190,0.85)";
      ctx.fillText(o.name, o.x, o.y-r-8);
      if(o.heal>0){ ctx.fillStyle="#7dff9a"; ctx.font="10px system-ui,sans-serif"; ctx.fillText("⚕"+Math.round(o.heal), o.x, o.y-r-20); }
    }
    const w=40;
    ctx.fillStyle="rgba(0,0,0,0.55)"; ctx.fillRect(o.x-w/2-1,o.y-r-6,w+2,5);
    ctx.fillStyle=o.isPlayer?"#4fd6ff":"#e23b3b"; ctx.fillRect(o.x-w/2,o.y-r-5.5,w*M.clamp(o.hp/o.maxHP,0,1),4);
    if(o.maxArmor>0){ ctx.fillStyle="rgba(120,180,255,0.85)"; ctx.fillRect(o.x-w/2,o.y-r-10.5,w*M.clamp(o.armor/o.maxArmor,0,1),3); }
  },

  /* ----------------------------- HUD ----------------------------- */
  hud(ctx, game, v){
    const R=BR, p=R.player;
    if(!p) return;
    const mob=!!Input.isTouch;      // 手机端：HUD 让位给右下触屏按钮
    if(R.hitFlash>0){ ctx.fillStyle=`rgba(200,30,30,${R.hitFlash*0.5})`; ctx.fillRect(0,0,v.w,v.h); }
    if(R.outOfZone && p.alive){ ctx.fillStyle="rgba(170,40,40,0.10)"; ctx.fillRect(0,0,v.w,v.h); }

    /* --- 左上角击杀提示 --- */
    ctx.textAlign="left"; ctx.font=mob?"bold 11px system-ui,sans-serif":"bold 13px system-ui,sans-serif";
    let y=mob?58:18;
    for(const k of R.killfeed){
      const alpha=M.clamp(k.t/6,0,1); ctx.globalAlpha=alpha;
      let text;
      if(k.type==="zone") text=`${k.a}，${k.v}`;
      else if(k.type==="info") text=`${k.a}，${k.v}`;
      else text=`${k.a}  ▸  ${k.v}`;
      const col = k.mine ? "#ffd23f" : (k.type==="zone"?"#ff8a5a":k.type==="info"?"#8fd0ff":"#cfd8e2");
      let w=ctx.measureText(text).width + (k.type==="kill"?62:16);
      if(mob) w=Math.min(w, v.w-120);
      ctx.fillStyle="rgba(8,12,16,0.55)";
      ctx.beginPath(); ctx.roundRect? ctx.roundRect(12,y-13,w,20,5) : ctx.rect(12,y-13,w,20); ctx.fill();
      ctx.fillStyle=col; ctx.fillText(text, 20, y+2);
      if(k.type==="kill" && k.gun){ ctx.fillStyle="rgba(150,170,190,0.8)"; ctx.font="11px system-ui,sans-serif"; ctx.fillText(`[${k.gun}]`, 12+w-58, y+2); ctx.font="bold 13px system-ui,sans-serif"; }
      ctx.globalAlpha=1; y+=24;
    }

    /* --- 顶部存活数 + 阶段 --- */
    ctx.textAlign="center"; ctx.font=mob?"bold 18px system-ui,sans-serif":"bold 22px system-ui,sans-serif";
    ctx.fillStyle="#e8eef4";
    ctx.fillText(`存活 ${R.aliveFoes()+ (p.alive?1:0)} / ${R.total}`, v.w/2, mob?26:36);
    ctx.font=mob?"9px system-ui,sans-serif":"11px system-ui,sans-serif"; ctx.fillStyle="rgba(180,195,210,0.75)";
    const zs = R.graceT>0 ? ("出生保护 "+Math.ceil(R.graceT)+"s")
            : (R.zoneState==="shrink" ? "安全区收缩中" : (R.zoneState==="done" ? "决赛圈" : "安全区等待 "+Math.ceil(R.zoneTimer)+"s"));
    ctx.fillText(zs, v.w/2, mob?40:54);

    /* --- 右上角状态 --- */
    if(mob){
      ctx.textAlign="right"; ctx.font="bold 12px system-ui,sans-serif"; ctx.fillStyle="#ffd23f";
      ctx.fillText(`击杀 ${p.kills}`, v.w-12, 70);
      ctx.fillStyle="#7dff9a"; ctx.fillText(`医疗 ${Math.round(p.heal)}`, v.w-12, 86);
    } else {
      ctx.textAlign="right"; ctx.font="bold 14px system-ui,sans-serif"; ctx.fillStyle="#ffd23f";
      ctx.fillText(`击杀 ${p.kills}`, v.w-20, 30);
      ctx.fillStyle="#7dff9a"; ctx.fillText(`医疗 ${Math.round(p.heal)}`, v.w-20, 50);
    }

    /* --- 底部状态（手机版上移收窄，让开触屏键） --- */
    const bx=mob?14:24, by=mob?(v.h-214):(v.h-92), bw=mob?Math.min(150,v.w*0.42):220;
    ctx.textAlign="left"; ctx.font="bold 12px system-ui,sans-serif";
    ctx.fillStyle="rgba(0,0,0,0.5)"; ctx.fillRect(bx,by,bw,16);
    ctx.fillStyle="#4fd6ff"; ctx.fillRect(bx,by,bw*M.clamp(p.hp/p.maxHP,0,1),16);
    ctx.fillStyle="#04141a"; ctx.fillText(`生命 ${Math.ceil(p.hp)} / ${p.maxHP}`, bx+8, by+12);
    if(p.maxArmor>0){
      ctx.fillStyle="rgba(0,0,0,0.5)"; ctx.fillRect(bx,by+20,bw,12);
      ctx.fillStyle="#7ab4ff"; ctx.fillRect(bx,by+20,bw*M.clamp(p.armor/p.maxArmor,0,1),12);
      ctx.fillStyle="#04141a"; ctx.fillText(`护甲 ${Math.ceil(p.armor)}`, bx+8, by+30);
    }
    ctx.fillStyle="#e8eef4"; ctx.font=mob?"bold 16px system-ui,sans-serif":"bold 18px system-ui,sans-serif";
    ctx.fillText(`${p.mag} / ${p.reserve}`, bx, by+56);
    ctx.font=mob?"11px system-ui,sans-serif":"12px system-ui,sans-serif"; ctx.fillStyle="rgba(180,195,210,0.85)";
    ctx.fillText(p.gun.name + (p.reloadT>0?"，换弹中…":(p.secondary?"，Q 切枪":"")), bx, by+74);

    /* --- 圈外警告 --- */
    if(R.outOfZone && p.alive){
      ctx.textAlign="center"; ctx.font="bold 18px system-ui,sans-serif"; ctx.fillStyle="#ff6a5a";
      ctx.fillText("⚠ 你在安全区外，持续掉血", v.w/2, mob?v.h*0.55:(v.h-150));
    }

    /* --- 小地图 --- */
    this.minimap(ctx, v);

    /* --- 物品栏（Tab 开关） --- */
    if(R.showInv) this.drawInventory(ctx, v);
  },

  /* 物品栏：武器 / 护甲 / 头盔 / 医疗 */
  drawInventory(ctx, v){
    const R=BR, p=R.player;
    const mob=!!Input.isTouch;
    const w=Math.min(520, v.w-40), h=Math.min(mob?360:390, v.h-80);
    const x=(v.w-w)/2, y=(v.h-h)/2-(mob?32:0);
    ctx.fillStyle="rgba(4,7,10,0.86)";
    ctx.beginPath(); ctx.roundRect? ctx.roundRect(x,y,w,h,10) : ctx.rect(x,y,w,h); ctx.fill();
    ctx.strokeStyle="rgba(120,150,180,0.35)"; ctx.lineWidth=1; ctx.stroke();

    ctx.textAlign="left";
    ctx.fillStyle="#e8eef6"; ctx.font="bold 16px system-ui,sans-serif";
    ctx.fillText("物品栏", x+18, y+28);
    ctx.fillStyle="rgba(150,170,190,0.8)"; ctx.font="11px system-ui,sans-serif";
    ctx.fillText(mob?"点背包键关闭，靠近自动拾取":"Tab 关闭，Q 切换主副武器", x+72, y+27);

    let ly=y+58;
    const line=(label,val,col,sub)=>{
      ctx.fillStyle="rgba(150,170,190,0.85)"; ctx.font="11px system-ui,sans-serif";
      ctx.fillText(label, x+18, ly);
      ctx.fillStyle=col||"#dfe7f0"; ctx.font="13px system-ui,sans-serif";
      ctx.fillText(val, x+86, ly);
      if(sub){ ctx.fillStyle="rgba(140,160,180,0.75)"; ctx.font="10px system-ui,sans-serif"; ctx.fillText(sub, x+86, ly+13); ly+=13; }
      ly+=22;
    };

    const guns=[p.gun,(p.secondary||null)].filter(Boolean);
    const icon=(g,gy)=>{
      const spec=gunModelSpec(g);
      const bodyC=(MANUFACTURERS[g.manufacturer]&&MANUFACTURERS[g.manufacturer].color)||"#3a3f47";
      const accC=(g.element!=="none"&&ELEMENTS[g.element])?ELEMENTS[g.element].color:"#aab2bd";
      ctx.save(); ctx.translate(x+w-40, gy-2); ctx.scale(0.62,0.62);
      drawGunCanvas(ctx, spec, 0.8, bodyC, accC); ctx.restore();
    };
    guns.forEach((g,i)=>{
      const gy=ly;
      const col=gunRarColor(g.rarity);
      const elem=g.element&&g.element!=="none"&&ELEMENTS[g.element]?("，"+ELEMENTS[g.element].name):"";
      line(i===0?"主武器":"副武器", g.name, col,
        `伤害 ${g.dmg}，弹匣 ${i===0?p.mag:"-"}，备弹 ${i===0?p.reserve:"-"}${elem}`);
      icon(g, gy);
    });
    const arName = p.armorTier ? BR_ARMORS["vest"+p.armorTier] : null;
    line("护甲", arName?arName.name:"（无护甲）", arName?"#7ab4ff":"#8b95a5",
      arName?`${p.armorTier} 级，耐久 ${Math.ceil(p.armor)}/${Math.round(p.maxArmor)}，减伤 ${Math.round(p.dr*100)}%`:"");
    const hmName = p.helmetTier ? BR_HELMETS["helm"+p.helmetTier] : null;
    line("头盔", hmName?hmName.name:"（无头盔）", hmName?"#8fd0ff":"#8b95a5",
      hmName?`${p.helmetTier} 级，耐久 ${Math.ceil(p.helmetArmor)}/${Math.round(p.maxHelmetArmor)}，爆头减伤 ${Math.round(p.helmetDr*100)}%`:"");
    line("医疗", "⚕ "+Math.round(p.heal), "#7dff9a", "E 键 / 医疗键使用");
    const aliveN=(BR.ops||[]).filter(o=>o.alive).length;
    line("战绩", `${p.kills} 杀，剩余 ${aliveN} 人`, "#ffd23f");
  },

  minimap(ctx, v){
    const R=BR;
    const mob=!!Input.isTouch;
    const mw=mob?100:160, mh=mob?100:160;
    const mx=v.w-mw-(mob?10:20), my=mob?110:(v.h-mh-20);
    ctx.fillStyle="rgba(6,10,14,0.8)"; ctx.fillRect(mx,my,mw,mh);
    ctx.strokeStyle="rgba(120,140,160,0.4)"; ctx.lineWidth=1; ctx.strokeRect(mx,my,mw,mh);
    const sx=mw/BR_MAP_W, sy=mh/BR_MAP_H;
    // 安全区
    const z=R.zone, zx=mx+z.x*sx, zy=my+z.y*sy, zr=z.r*sx;
    ctx.strokeStyle="rgba(90,200,255,0.9)"; ctx.lineWidth=2; ctx.beginPath(); ctx.arc(zx,zy,zr,0,6.2832); ctx.stroke();
    if(R.next){ ctx.strokeStyle="rgba(255,255,255,0.5)"; ctx.lineWidth=1; ctx.beginPath(); ctx.arc(mx+R.next.x*sx,my+R.next.y*sy,R.next.r*sx,0,6.2832); ctx.stroke(); }
    // 资源点
    ctx.fillStyle="rgba(150,170,190,0.4)";
    for(const b of R.buildings){ ctx.fillRect(mx+b.x*sx,my+b.y*sy,Math.max(1,b.w*sx),Math.max(1,b.h*sy)); }
    // PMC
    for(const o of R.ops){
      if(!o.alive) continue;
      ctx.fillStyle=o.isPlayer?"#4fd6ff":"#ff5a5a";
      ctx.beginPath(); ctx.arc(mx+o.x*sx, my+o.y*sy, o.isPlayer?3.5:2.2, 0, 6.28); ctx.fill();
    }
  },
};

/* =========================================================================
 * UI — 大逃杀：准备界面、结算、暂停
 * ========================================================================= */
UI.brSetup=function(){
  const total=50;
  if(UI._brLobby===undefined) UI._brLobby=total;
  const lobby=UI._brLobby;
  UI._set(`
    <div class="panel raid-setup">
      <h2 class="title-big" style="font-size:34px;">大逃杀，绝地岛</h2>
      <div class="subtitle">BATTLE ROYALE，最后一人存活</div>
      <p style="color:var(--muted);max-width:680px;margin:0 0 14px;">
        你与另外 <b style="color:#ffd23f">${lobby-1}</b> 名玩家空降同一张绝地岛。落地搜刮武器护甲，
        在安全区（白圈）收缩中活到最后——<b style="color:#8fe07a">吃鸡</b>即胜利，阵亡即淘汰。</p>

      <div class="raid-cols">
        <div class="raid-col">
          <h4>大厅人数（含你）</h4>
          <div class="row" style="flex-wrap:wrap;gap:8px;">
            ${[20,30,50,60,80].map(n=>`<button class="btn small ${n===lobby?'':'ghost'}" data-lobby="${n}">${n}</button>`).join('')}
          </div>
          <p class="raid-tip" style="margin-top:10px;">人越少节奏越快；50 人以上更接近真实满员局（纯前端模拟，所有对手均为 AI 补位）。</p>
        </div>
        <div class="raid-col">
          <h4>玩法要点</h4>
          <div class="empty-hint" style="line-height:1.9;">
           ，空手跳伞，地面拾取枪械 / 护甲 / 医疗<br>
           ，蓝圈为当前安全区，白圈为下一处<br>
           ，圈外持续掉血，越早进圈越安全<br>
           ，左上角实时播报全图淘汰<br>
           ，仅剩你一人 → 吃鸡（第 1 名）
          </div>
        </div>
      </div>

      <div class="row" style="justify-content:space-between;align-items:center;margin-top:16px;flex-wrap:wrap;gap:10px;">
        <div class="raid-tip">操作：<span class="kbd">WASD</span> 移动，<span class="kbd">鼠标</span> 瞄准，<span class="kbd">左键</span> 开火，<span class="kbd">Q</span> 切枪，<span class="kbd">R</span> 换弹，<span class="kbd">E</span> 用医疗</div>
        <div class="row">
          <button class="btn ghost" id="btn-br-back">返回</button>
          <button class="btn" id="btn-br-start">开始跳伞</button>
        </div>
      </div>
    </div>`);
  UI.overlay.querySelectorAll('[data-lobby]').forEach(el=>{
    el.onclick=()=>{ UI._brLobby=parseInt(el.dataset.lobby); SFX.ui(); UI.brSetup(); };
  });
  document.getElementById('btn-br-back').onclick=()=>{ SFX.ui(); UI.title(); };
  document.getElementById('btn-br-start').onclick=()=>{ SFX.ui(); game.startBR({ lobby:UI._brLobby }); };
};

UI.brResult=function(res){
  const win=res.win;
  const medal = win ? "🏆 大吉大利，今晚吃鸡！" : `第 ${res.placement} 名 / ${res.total}`;
  UI._set(`
    <div class="panel" style="text-align:center;max-width:620px;">
      <h2 class="title-big" style="font-size:38px;color:${win?"#8fe07a":"#ff6a5a"};">${win?"胜利":"淘汰"}</h2>
      <div class="subtitle" style="font-size:18px;">${medal}</div>
      <div class="raid-result-grid">
        <div><span class="rr-k">最终排名</span><b style="color:${win?"#8fe07a":"#ffd23f"}">${res.placement} / ${res.total}</b></div>
        <div><span class="rr-k">击杀数</span><b>${res.kills}</b></div>
      </div>
      <div class="hint" style="margin-top:14px;">${win?"你是绝地岛上最后的幸存者。":"下次早点进圈、多搜点好枪——阵亡不保留任何物资，下一局重新空降。"}</div>
      <div class="row" style="justify-content:center;margin-top:18px;">
        <button class="btn ghost" id="btn-br-title">返回大厅</button>
        <button class="btn" id="btn-br-again">再来一局</button>
      </div>
    </div>`);
  document.getElementById('btn-br-again').onclick=()=>{ SFX.ui(); game.startBR({ lobby:UI._brLobby||50 }); };
  document.getElementById('btn-br-title').onclick=()=>{ SFX.ui(); game.toTitle(); };
};

UI.brPause=function(){
  UI._set(`
    <div class="panel" style="text-align:center;max-width:460px;">
      <h2 class="title-big" style="font-size:32px;">已暂停</h2>
      <div class="subtitle">大逃杀，绝地岛</div>
      <p style="color:var(--muted);">安全区收缩已暂停。继续作战，或退出返回大厅。</p>
      <div class="row" style="justify-content:center;margin-top:16px;">
        <button class="btn ghost" id="btn-br-quit">退出对局</button>
        <button class="btn" id="btn-br-resume">继续</button>
      </div>
    </div>`);
  document.getElementById('btn-br-resume').onclick=()=>{ SFX.ui(); game.resume(); };
  document.getElementById('btn-br-quit').onclick=()=>{ SFX.ui(); BR.active=false; game.toTitle(); };
};
