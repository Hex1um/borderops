/* =========================================================================
 * dust2.js — 沙二模式（de_dust2 · 5v5 爆破）
 *
 * 规则参考 CS2 竞技模式：
 *   · MR12：先到 13 分获胜，第 12 回合结束换边；
 *   · 手枪局 $800 起步，击杀奖励 / 连败补偿 / 胜利奖金按真实数值；
 *   · 冻结时间可购买，人数全灭 / C4 爆炸 / 拆包 / 时间耗尽判定胜负；
 *   · 阵亡不掉钱，存活者保留枪械与护甲。
 * 战斗方案：俯视角实时交火 + 视线判定 + 命中判定 + 护甲穿透，
 * 与战役模式共用同一套输入（鼠标瞄准 / 单摇杆自动锁敌）。
 * 武器两种卡池：CS2 原版数值表 或 旧刷宝体系程序化枪械。
 * ========================================================================= */

const DUST_TILE = 40;
const DUST_COLS = 54;
const DUST_ROWS = 56;

/*
 * 网格值：
 *   0 = 岩体/高墙（挡人挡视线）
 *   1 = 地面（可走）
 *   2 = A 点高架平台（可走，可越过低箱观察/射击）
 *   3 = 坡道/楼梯（连接地面与平台）
 *   4 = 低矮箱体（挡人、挡低处视线；站上高架可以越过它打）
 */
const DUST_GROUND=1, DUST_PLAT=2, DUST_RAMP=3, DUST_LOW=4;

/*
 * 贴合真实 de_dust2 雷达图的布局（北上南下）：
 *   左上 B 点 + B 洞两层，右上 A 点（含高架平台双层），
 *   中路贯穿上下、中路双门，CT 出生在上中，T 出生在左下，
 *   右侧长 A 从下路一路通到 A 点，警家横廊连接 B/CT/A。
 */
const DUST_ROOMS = [
  // ---- B 区（左上）----
  [3,5,12,9],     // B 点
  [14,7,3,3],     // B 点出口
  [17,6,11,4],    // 警家横廊（B ↔ CT）
  [20,9,4,8],     // 警家竖廊（下接中路上段）
  // ---- CT 出生（上中）----
  [24,3,10,6],    // CT 出生点
  [27,8,4,9],     // CT → 中路上段
  // ---- A 区（右上）----
  [38,4,13,11],   // A 点（含高架平台与下层）
  [34,6,5,4],     // A 点 ↔ 警家
  [31,12,6,4],    // A 小道
  [37,13,1,3],    // A 小道 → 坡道的连接格（修补 x37 断头墙）
  [29,15,4,4],    // catwalk 顶（接中路）
  [23,14,7,3],    // 警家竖廊 → catwalk 桥（修复 CT 侧进不了 A 的断头路）
  // ---- 中路 ----
  [26,17,5,26],   // 中路（CT 侧接入）
  [26,39,5,7],    // 下中路：连接中路底部与 T 出生，T 可走中路
  // ---- T 出生（左下）----
  [8,45,20,8],    // T 出生点
  [28,44,13,4],   // 外部东段（T 出生 → 长A 门厅）
  [40,43,6,4],    // 长A 门厅
  // ---- 长A（右侧）----
  [44,14,6,32],   // 长 A
  // ---- B 洞（左侧）----
  [4,14,6,5],     // 上洞口（连 B）
  [8,18,6,12],    // 上 B 洞
  [7,29,7,17],    // 下 B 洞
];

// A 点双层结构：高架平台 + 两条上坡道（长A坡道 / A小阶梯）
const DUST_PLATFORM = [38,4,13,9];
const DUST_RAMPS = [
  [36,13,4,3],    // A 小道楼梯（上平台）
  [44,13,4,3],    // 长 A 坡道（上平台）
  [38,6,3,4],     // CT 警家通道 → A 平台入口坡道（修复 CT 直接进 A 被平台侧壁挡住）
];

// 低矮掩体 / 箱子：挡人挡低处视线，站在 A 点高架可以越过它们
const DUST_BLOCKS = [
  [28,21,1,1],   // 中门
  [27,24,1,2],   // 中路白箱
  [29,31,1,2],   // 中路下段箱
  [42,7,2,2],    // A 平台箱
  [46,10,2,2],   // A 平台大箱
  [40,13,2,1],   // A 下层箱（坡道旁）
  [5,7,2,2],     // B 点箱
  [10,10,2,2],   // B 点大箱
  [46,26,2,2],   // 长 A 箱
  [9,24,2,2],    // 上 B 洞箱
  [12,49,2,2],   // T 出生箱
  [25,5,2,2],    // CT 出生箱
  [36,44,2,1],   // 外部箱
];

const DUST_SITE_RECT = {
  A: { x0:38, y0:4,  x1:50, y1:14 },
  B: { x0:3,  y0:5,  x1:14, y1:13 },
};
const T_SPAWN_PTS  = [[11,47],[14,48],[17,47],[13,51],[20,50]];
const CT_SPAWN_PTS = [[28,5],[30,5],[32,5],[29,7],[31,7]];

const DUST_BOT_NAMES = ["Astra","Boris","Cipher","Dexter","Echo","Fable","Ghost","Havoc","Iris","Jinx","Kilo","Lynx"];

/* ----------------------------- 地图 ----------------------------- */
class DustMap {
  constructor(){
    this.grid=[];
    for(let y=0;y<DUST_ROWS;y++) this.grid.push(new Array(DUST_COLS).fill(0));
    for(const [x,y,w,h] of DUST_ROOMS){
      for(let j=y;j<y+h;j++) for(let i=x;i<x+w;i++){
        if(this.grid[j] && this.grid[j][i]!==undefined) this.grid[j][i]=DUST_GROUND;
      }
    }
    // A 点双层：高架平台 + 坡道
    {
      const [px,py,pw,ph]=DUST_PLATFORM;
      for(let j=py;j<py+ph;j++) for(let i=px;i<px+pw;i++){
        if(this.grid[j] && this.grid[j][i]===DUST_GROUND) this.grid[j][i]=DUST_PLAT;
      }
      for(const [rx,ry,rw,rh] of DUST_RAMPS){
        for(let j=ry;j<ry+rh;j++) for(let i=rx;i<rx+rw;i++){
          if(this.grid[j] && this.grid[j][i]!==0) this.grid[j][i]=DUST_RAMP;
        }
      }
    }
    // 低矮箱体
    this.crates=[];
    for(const [bx,by,bw,bh] of DUST_BLOCKS){
      for(let j=by;j<by+bh;j++) for(let i=bx;i<bx+bw;i++){
        if(this.grid[j] && this.grid[j][i]!==undefined) this.grid[j][i]=DUST_LOW;
      }
      this.crates.push({ x:bx*DUST_TILE, y:by*DUST_TILE, w:bw*DUST_TILE, h:bh*DUST_TILE });
    }
    this.w=DUST_COLS*DUST_TILE; this.h=DUST_ROWS*DUST_TILE;
    this.bounds={minX:0,minY:0,maxX:this.w,maxY:this.h};
    this.sites={};
    for(const k in DUST_SITE_RECT){
      const r=DUST_SITE_RECT[k];
      this.sites[k]={ x0:r.x0*DUST_TILE, y0:r.y0*DUST_TILE, x1:(r.x1+1)*DUST_TILE, y1:(r.y1+1)*DUST_TILE };
    }
    this._decor=null;
  }
  tileAt(px,py){ return { x:Math.floor(px/DUST_TILE), y:Math.floor(py/DUST_TILE) }; }
  isWalkTile(x,y){ const v=this.grid[y]&&this.grid[y][x]; return v===DUST_GROUND||v===DUST_PLAT||v===DUST_RAMP; }
  // 0=地面 1=高架 0.5=坡道（两边都能接）
  levelOfTile(x,y){
    const v=this.grid[y]&&this.grid[y][x];
    if(v===DUST_PLAT) return 1;
    if(v===DUST_RAMP) return 0.5;
    return 0;
  }
  levelAt(px,py){ const t=this.tileAt(px,py); return this.levelOfTile(t.x,t.y); }
  isWalk(px,py){ const t=this.tileAt(px,py); return this.isWalkTile(t.x,t.y); }
  // 层级通行规则：同层互通，坡道与两侧互通；地面↔平台必须经过坡道
  canTraverse(ax,ay,bx,by){
    if(!this.isWalkTile(ax,ay)||!this.isWalkTile(bx,by)) return false;
    const la=this.levelOfTile(ax,ay), lb=this.levelOfTile(bx,by);
    return la===lb || la===0.5 || lb===0.5;
  }
  // 半径采样的可走判定：防止卡在墙角 + 层级边界
  canStand(px,py,r){
    const c=this.tileAt(px,py);
    const o=r*0.75;
    const pts=[[px-o,py-o],[px+o,py-o],[px-o,py+o],[px+o,py+o]];
    for(const [qx,qy] of pts){
      const t=this.tileAt(qx,qy);
      if(!this.canTraverse(c.x,c.y,t.x,t.y)) return false;
    }
    return true;
  }
  tileCenter(x,y){ return { x:x*DUST_TILE+DUST_TILE/2, y:y*DUST_TILE+DUST_TILE/2 }; }
  inSite(px,py,site){
    const s=this.sites[site]; if(!s) return false;
    return px>=s.x0&&px<=s.x1&&py>=s.y0&&py<=s.y1;
  }
  whichSite(px,py){
    for(const k in this.sites) if(this.inSite(px,py,k)) return k;
    return null;
  }
  los(x1,y1,x2,y2){
    const a=this.tileAt(x1,y1), b=this.tileAt(x2,y2);
    const la=this.levelOfTile(a.x,a.y), lb=this.levelOfTile(b.x,b.y);
    const high = la>=0.5 || lb>=0.5;   // 任一端在高架/坡道上：可以越过低箱
    const d=Math.hypot(x2-x1,y2-y1);
    const steps=Math.max(2, Math.ceil(d/22));
    for(let i=1;i<steps;i++){
      const t=i/steps;
      const tx=Math.floor((x1+(x2-x1)*t)/DUST_TILE), ty=Math.floor((y1+(y2-y1)*t)/DUST_TILE);
      const v=this.grid[ty]&&this.grid[ty][tx];
      if(v===0) return false;
      if(v===DUST_LOW && !high) return false;
    }
    return true;
  }
  // BFS 寻路，返回世界坐标路点
  findPath(sx,sy,tx,ty){
    let s=this.tileAt(sx,sy), t=this.tileAt(tx,ty);
    if(!this.isWalkTile(s.x,s.y)) s=this._nearestWalk(s.x,s.y);
    if(!this.isWalkTile(t.x,t.y)) t=this._nearestWalk(t.x,t.y);
    if(!s||!t) return [];
    const key=(x,y)=>y*DUST_COLS+x;
    const prev=new Int32Array(DUST_COLS*DUST_ROWS).fill(-1);
    const seen=new Uint8Array(DUST_COLS*DUST_ROWS);
    const q=[key(s.x,s.y)]; seen[key(s.x,s.y)]=1;
    const goal=key(t.x,t.y);
    let found=false;
    for(let head=0; head<q.length; head++){
      const cur=q[head];
      if(cur===goal){ found=true; break; }
      const cx=cur%DUST_COLS, cy=(cur-cx)/DUST_COLS;
      const nb=[[1,0],[-1,0],[0,1],[0,-1]];
      for(const [dx,dy] of nb){
        const nx=cx+dx, ny=cy+dy;
        if(!this.canTraverse(cx,cy,nx,ny)) continue;
        const kk=key(nx,ny); if(seen[kk]) continue;
        seen[kk]=1; prev[kk]=cur; q.push(kk);
      }
    }
    if(!found) return [];
    const out=[]; let cur=goal;
    while(cur!==-1 && cur!==key(s.x,s.y)){ out.push(cur); cur=prev[cur]; }
    out.reverse();
    // 合并共线，减少路点
    const pts=out.map(k=>{ const x=k%DUST_COLS, y=(k-x)/DUST_COLS; return this.tileCenter(x,y); });
    const simp=[];
    for(let i=0;i<pts.length;i++){
      if(i>0&&i<pts.length-1){
        const a=pts[i-1], b=pts[i], c=pts[i+1];
        const cross=(b.x-a.x)*(c.y-b.y)-(b.y-a.y)*(c.x-b.x);
        if(Math.abs(cross)<1) continue;
      }
      simp.push(pts[i]);
    }
    return simp;
  }
  _nearestWalk(x,y){
    for(let r=1;r<=6;r++){
      for(let dy=-r;dy<=r;dy++) for(let dx=-r;dx<=r;dx++){
        if(this.isWalkTile(x+dx,y+dy)) return {x:x+dx,y:y+dy};
      }
    }
    return null;
  }
  randomPointInSite(site){
    const s=this.sites[site]; if(!s) return {x:this.w/2,y:this.h/2};
    for(let i=0;i<40;i++){
      const x=RNG.fr(s.x0+30,s.x1-30), y=RNG.fr(s.y0+30,s.y1-30);
      if(this.canStand(x,y,14)) return {x,y};
    }
    return { x:(s.x0+s.x1)/2, y:(s.y0+s.y1)/2 };
  }
}

/* ----------------------------- 选手 ----------------------------- */
class Duelist {
  constructor(o){
    this.id=o.id; this.name=o.name; this.team=o.team; this.side=o.side;
    this.isPlayer=!!o.isPlayer;
    this.x=o.x; this.y=o.y; this.vx=0; this.vy=0; this.angle=o.side==="t"?-Math.PI/2:Math.PI/2;
    this.radius=13; this.faction="duelist";
    this.hp=100; this.maxHP=100; this.armor=0; this.helmet=false; this.kit=false;
    this.alive=true;
    this.money=CS2.startMoney;
    this.gun=null; this.pistol=this.defaultPistol();
    this.mag=0; this.reserve=0; this.reloading=false; this.reloadT=0;
    this.fireCd=0; this.spray=0; this.idle=0;
    this.nades=[];
    this.skill=o.skill||0.6;
    this.react=0; this.target=null; this.path=null; this.pathIdx=0; this.pathT=0;
    this.blind=0; this.deadT=0;
    this.alert=0;        // 受击后短暂「警觉」：可 omnidirectional 感知，模拟听到枪声/脚步
    this.kills=0; this.deaths=0;
    // 旧刷宝体系模式：护甲池 + 随身装备词条
    this.maxShield=0; this.shield=0; this.shieldDelay=3; this.shieldRate=0; this.shieldTimer=0;
    this.shieldItem=null; this.relicItem=null; this.relicMods={};
    this.objective=null; this.holdPoint=null;
    this.moveX=0; this.moveY=0;
    this.plantT=0; this.defuseT=0;
    this.hasBomb=false;
    this.flash=0;
  }
  defaultPistol(){
    const g = this.side==="t" ? CS2.weapons.glock : CS2.weapons.usp;
    return { ...g };
  }
  activeGun(){
    if(this.gun && this.mag>0) return this.gun;
    if(this.gun && this.reserve<=0) return this.pistol;
    return this.gun || this.pistol;
  }
  giveGun(g){
    this.gun={ ...g };
    this.mag=Math.min(g.mag, 999);
    this.reserve=g.mag*5;
    this.reloading=false; this.reloadT=0;
  }
  switchWeapon(){
    if(!this.gun) return;
    this.gun._mag=this.mag; this.gun._res=this.reserve;
    const t=this.gun; this.gun=this.pistol; this.pistol=t;
    this.mag = this.gun._mag!==undefined ? this.gun._mag : this.gun.mag;
    this.reserve = this.gun._res!==undefined ? this.gun._res : this.gun.mag*5;
    this.reloading=false; this.reloadT=0; this.fireCd=Math.max(this.fireCd,0.25);
  }
  startReload(){
    const g=this.activeGun(); if(!g||this.reloading) return;
    if(this.mag>=g.mag || this.reserve<=0) return;
    this.reloading=true; this.reloadT=g.reload; this.spray=0;
  }
  finishReload(){
    const g=this.activeGun(); if(!g) return;
    const need=g.mag-this.mag, take=Math.min(need,this.reserve);
    this.mag+=take; this.reserve-=take; this.reloading=false; this.reloadT=0;
  }
}

/* ----------------------------- 沙二主控 ----------------------------- */
const Dust2 = {
  active:false,
  map:null,
  gunSet:"cs2",
  teams:null,
  player:null,
  playerTeam:"A",
  round:1,
  state:"freeze",
  timer:0,
  score:{A:0,B:0},
  lossStreak:{A:0,B:0},
  bomb:null,
  buyTab:"gear",
  tracers:[], smokes:[], fires:[], nades:[], rockets:[], killfeed:[], hitmarks:[],
  drops:[],
  roundMsg:null, roundMsgT:0,
  spectate:null,
  blShop:[],
  lastResult:null,
  shakeT:0,

  /* ----------------------------- 启动 ----------------------------- */
  start(game, opts={}){
    this.active=true;
    this.gunSet = opts.gunSet==="bl" ? "bl" : "cs2";
    this.map=new DustMap();
    this.round=1;
    this.score={A:0,B:0};
    this.lossStreak={A:0,B:0};
    this.state="freeze"; this.timer=CS2.freezeTime;
    this.tracers=[]; this.smokes=[]; this.fires=[]; this.nades=[]; this.rockets=[]; this.killfeed=[]; this.hitmarks=[];
    this.drops=[];
    this.roundMsg=null; this.roundMsgT=0;
    this.blShop=[]; this.blGear=[];
    this._playerKillsThisRound=0;   // 本回合玩家击杀数
    this._playerKillsLastRound=0;   // 上回合玩家击杀数（影响下回合商店品质）
    this.lastResult=null;
    this._shownResult=false;
    this.halftimeDone=false;
    this.playerFlashed=0;

    const firstSide = opts.side==="t" ? "t" : "ct";
    this.teams={
      A:{ id:"A", name:"你的队伍", side:firstSide, score:0, bots:[] },
      B:{ id:"B", name:"敌方队伍", side:firstSide==="t"?"ct":"t", score:0, bots:[] },
    };
    this.playerTeam="A";

    const tPts=T_SPAWN_PTS, ctPts=CT_SPAWN_PTS;
    let nameIdx=0;
    for(const tid of ["A","B"]){
      const tm=this.teams[tid];
      for(let i=0;i<5;i++){
        const pt=(tm.side==="t"?tPts:ctPts)[i];
        const isPlayer = tid==="A" && i===0;
        const d=new Duelist({
          id:tid+i, team:tid, side:tm.side, isPlayer,
          name:isPlayer?"你":DUST_BOT_NAMES[(nameIdx++)%DUST_BOT_NAMES.length],
          x:pt[0]*DUST_TILE+20, y:pt[1]*DUST_TILE+20,
          skill:isPlayer?1:(0.52+Math.random()*0.24),
        });
        tm.bots.push(d);
        if(isPlayer) this.player=d;
      }
    }
    this.game=game;
    game.mode="dust2";
    game.bounds=this.map.bounds;
    game.zoom=0.8;   // 拉远镜头：可视范围更大，能看到视线远端
    game.world={ name:"de_dust2", level:1, bounds:this.map.bounds, chests:[], update(){}, objective(){return "";} };
    game.player=this.player;
    this.beginRound(game, true);
    // 相机
    game.camera.x=this.player.x-game.view.w/(game.zoom||1)/2;
    game.camera.y=this.player.y-game.view.h/(game.zoom||1)/2;
  },

  playerSide(){ return this.teams.A.side; },

  /* 队伍中所有存活成员 */
  aliveOf(teamId){
    return this.teams[teamId].bots.filter(b=>b.alive);
  },
  foesOf(side){
    const out=[];
    for(const tid in this.teams){
      if(this.teams[tid].side===side) continue;
      for(const b of this.teams[tid].bots) if(b.alive) out.push(b);
    }
    return out;
  },
  matesOf(side){
    const out=[];
    for(const tid in this.teams){
      if(this.teams[tid].side!==side) continue;
      for(const b of this.teams[tid].bots) if(b.alive) out.push(b);
    }
    return out;
  },

  /* ----------------------------- 回合 ----------------------------- */
  beginRound(game, first){
    const tPts=T_SPAWN_PTS, ctPts=CT_SPAWN_PTS;
    this.state="freeze"; this.timer=CS2.freezeTime;
    this._playerKillsThisRound=0;   // 新回合清零；下回合品质由 _playerKillsLastRound 决定
    this.tracers=[]; this.smokes=[]; this.fires=[]; this.nades=[]; this.rockets=[]; this.hitmarks=[];
    this.drops=[];
    this.roundMsg=null; this.roundMsgT=0;
    this.bomb={ carrier:null, planted:false, x:0,y:0, timer:0, site:null, defusing:null, defuseT:0, planting:null, plantT:0, dropped:false };

    this._plantSpots={};
    for(const tid in this.teams){
      const tm=this.teams[tid];
      const pts=tm.side==="t"?tPts:ctPts;
      tm.bots.forEach((b,i)=>{
        b.side=tm.side;
        b.alive=true; b.hp=100;
        b.x=pts[i%pts.length][0]*DUST_TILE+20+RNG.fr(-8,8);
        b.y=pts[i%pts.length][1]*DUST_TILE+20+RNG.fr(-8,8);
        if(!this.map.canStand(b.x,b.y,14)){          // 出生点被掩体占住时兜底
          for(let tries=0;tries<40;tries++){
            const nx=pts[i%pts.length][0]*DUST_TILE+20+RNG.fr(-56,56);
            const ny=pts[i%pts.length][1]*DUST_TILE+20+RNG.fr(-56,56);
            if(this.map.canStand(nx,ny,14)){ b.x=nx; b.y=ny; break; }
          }
        }
        b.vx=0; b.vy=0; b.target=null; b.path=null; b.pathIdx=0; b.pathT=0;
        b.plantT=0; b.defuseT=0; b.reloading=false; b.reloadT=0; b.fireCd=0; b.spray=0; b.blind=0;
        b.hasBomb=false; b.idle=0; b.holdPoint=null; b.siteTarget=null; b._escortSpot=null;
        b._stuckN=0; b._stk=0; b._sx=undefined; b._sy=undefined;
        b.angle = b.side==="t" ? -Math.PI/2 : Math.PI/2;
        if(b.gun){ b.gun._mag=undefined; b.gun._res=undefined; }
        // 上回合阵亡：枪、甲、钳、雷、护甲、随身装备全部丢失（CS2 规则）
        if(b.deadLastRound){
          b.gun=null; b.armor=0; b.helmet=false; b.kit=false; b.nades=[];
          b.maxShield=0; b.shield=0; b.shieldItem=null; b.relicItem=null; b.relicMods={};
          b.deadLastRound=false;
        }
        b.pistol=b.defaultPistol();
        if(!b.gun){ b.mag=b.pistol.mag; b.reserve=b.pistol.mag*5; }
        else { b.mag=b.gun.mag; b.reserve=b.gun.mag*5; }
      });
    }

    // T 随机一人带包
    const tTeam=Object.values(this.teams).find(t=>t.side==="t");
    if(tTeam){
      const alive=tTeam.bots.filter(b=>b.alive);
      const carrier=alive[Math.floor(RNG.f()*alive.length)];
      if(carrier){ carrier.hasBomb=true; this.bomb.carrier=carrier; }
    }

    if(this.gunSet==="bl") this.rollBlShop();

    this.botBuyAll(game);
    game.player=this.player;
    this.syncGameEntities(game);
    this.clearFog=0;
  },

  nextRound(game){
    this.round++;
    // 换边
    if(this.round===CS2.halftime+1 && !this.halftimeDone){
      this.halftimeDone=true;
      for(const tid in this.teams){
        const tm=this.teams[tid];
        tm.side = tm.side==="t" ? "ct" : "t";
        for(const b of tm.bots){
          b.gun=null; b.armor=0; b.helmet=false; b.kit=false; b.nades=[];
          b.maxShield=0; b.shield=0; b.shieldItem=null; b.relicItem=null; b.relicMods={};
          b.money=CS2.startMoney;
        }
        this.lossStreak[tid]=0;
      }
      this.roundMsg={ title:"换边", sub:"半场结束，攻守互换，经济重置", color:"#ffd23f" };
      this.roundMsgT=4;
      SFX.levelup();
    }
    this.beginRound(game);
  },

  endRound(winnerSide, reason, game){
    if(this.state==="roundend"||this.state==="matchend") return;
    // 锁定本回合玩家击杀数，供下回合商店品质提升使用
    this._playerKillsLastRound=this._playerKillsThisRound||0;
    this.state="roundend"; this.timer=4.5;
    const winTeam=Object.values(this.teams).find(t=>t.side===winnerSide);
    const loseTeam=Object.values(this.teams).find(t=>t.side!==winnerSide);
    if(!winTeam||!loseTeam) return;

    const reward = reason==="explode" ? CS2.winExplode : reason==="defuse" ? CS2.winDefuse : CS2.winElim;
    for(const b of winTeam.bots) b.money=Math.min(CS2.maxMoney, b.money+reward);
    const streak=this.lossStreak[loseTeam.id]||0;
    const bonus=CS2.lossBonus[Math.min(streak, CS2.lossBonus.length-1)];
    for(const b of loseTeam.bots) b.money=Math.min(CS2.maxMoney, b.money+bonus);
    this.lossStreak[loseTeam.id]=Math.min(streak+1, CS2.lossBonus.length-1);
    this.lossStreak[winTeam.id]=0;

    // 安放 / 拆除奖励
    if(this.bomb.planter) this.bomb.planter.money=Math.min(CS2.maxMoney,this.bomb.planter.money+CS2.plantReward);
    if(this.bomb.defuser) this.bomb.defuser.money=Math.min(CS2.maxMoney,this.bomb.defuser.money+CS2.defuseReward);

    this.score[winTeam.id]=(this.score[winTeam.id]||0)+1;
    winTeam.score=this.score[winTeam.id];
    this.lastResult={ winner:winnerSide, winTeam:winTeam.id, reason };
    const label = reason==="explode" ? "炸弹爆炸" : reason==="defuse" ? "拆包成功" : reason==="time" ? "时间耗尽" : "全歼对手";
    this.roundMsg={ title:`${winnerSide==="t"?"T":"CT"} 获胜`, sub:`${label}，${winTeam.id==="A"?"你的队伍":"敌方队伍"}拿下一分`, color:winnerSide==="t"?"#ffb020":"#5ea9ff" };
    this.roundMsgT=4.5;
    SFX.levelup();
    if(this.player.alive===false) this.spectate=null;

    // 比分结束
    if(this.score.A>=CS2.roundsToWin || this.score.B>=CS2.roundsToWin){
      this.state="matchend"; this.timer=0.1;
    }
  },

  /* ----------------------------- 每帧 ----------------------------- */
  update(game, dt){
    if(!this.active) return;
    this.syncGameEntities(game);

    // 状态机
    if(this.state==="freeze"){
      this.timer-=dt;
      this.playerControl(game, dt, true);
      if(this.timer<=0){ this.state="live"; this.timer=CS2.roundTime; }
    } else if(this.state==="live"){
      this.timer-=dt;
      this.playerControl(game, dt, false);
      this.botsUpdate(game, dt);
      this.bombUpdate(game, dt);
      this.nadesUpdate(game, dt);
      this.rocketsUpdate(game, dt);
      this.checkRoundEnd(game);
      if(this.state==="live" && this.timer<=0){
        this.timer=0;
        // 包已安放：时间到不结束回合，继续等爆炸 / 拆包
        if(!this.bomb.planted) this.endRound("ct", "time", game);
      }
    } else if(this.state==="roundend"){
      this.timer-=dt;
      this.botsIdle(game, dt);
      if(this.timer<=0){
        if(this.score.A>=CS2.roundsToWin||this.score.B>=CS2.roundsToWin){
          this.state="matchend";
          this.finishMatch(game);
        } else {
          this.nextRound(game);
        }
      }
    } else if(this.state==="matchend"){
      if(!this._shownResult) this.finishMatch(game);
    }

    if(this.roundMsgT>0) this.roundMsgT-=dt;
    this.updateFx(dt);
    for(const u of this.allDuelists()) if(u.alive) this.shieldTick(u, dt);
    this.pickupPass();
    this.updateCamera(game);
    // 玩家阵亡后观战
    if(!this.player.alive){
      const mates=this.aliveOf("A");
      if(mates.length) this.spectate=mates[0];
    } else this.spectate=null;
  },

  finishMatch(game){
    this._shownResult=true;
    this.state="matchend";
    this.active=false;
    game.state="menu";          // 主循环停摆，避免继续跑回合逻辑
    UI.dustResult({
      score:this.score,
      win: this.score.A>this.score.B,
      gunSet:this.gunSet,
      rounds:this.round,
    });
  },

  syncGameEntities(game){
    // 自动瞄准 / 小地图依赖这两个数组
    game.enemies=this.foesOf(this.player?this.player.side:this.teams.A.side);
    game.allies=this.matesOf(this.player?this.player.side:this.teams.A.side).filter(b=>b!==this.player);
    if(this.player) game.player=this.player;
  },

  updateFx(dt){
    for(let i=this.tracers.length-1;i>=0;i--){
      const tr=this.tracers[i]; tr.t-=dt;
      if(tr.t<=0){ this.tracers.splice(i,1); continue; }
      if(!tr.laser){ const f=1-M.clamp(tr.t/(tr.t0||0.07),0,1); tr.bx=tr.x1+(tr.x2-tr.x1)*f; tr.by=tr.y1+(tr.y2-tr.y1)*f; }
    }
    for(let i=this.hitmarks.length-1;i>=0;i--){ this.hitmarks[i].t-=dt; if(this.hitmarks[i].t<=0) this.hitmarks.splice(i,1); }
    for(let i=this.smokes.length-1;i>=0;i--){ this.smokes[i].t-=dt; if(this.smokes[i].t<=0) this.smokes.splice(i,1); }
    for(let i=this.fires.length-1;i>=0;i--){
      const f=this.fires[i]; f.t-=dt;
      if(f.t<=0){ this.fires.splice(i,1); continue; }
      for(const d of this.allDuelists()){
        if(!d.alive) continue;
        if(M.dist(d.x,d.y,f.x,f.y)<f.r) this.applyDamage(d, 18*dt, 0.5, false, null, true);
      }
    }
    if(this.shakeT>0) this.shakeT-=dt;
    if(this.playerFlashed>0) this.playerFlashed-=dt*1.6;
    for(const k of this.killfeed) k.t-=dt;
  },

  allDuelists(){
    const out=[];
    for(const tid in this.teams) for(const b of this.teams[tid].bots) out.push(b);
    return out;
  },

  /* 护甲充能：受击后等待延迟，再按速率回充（旧刷宝体系模式） */
  shieldTick(u, dt){
    if(u.maxShield<=0) return;
    if(u.shieldTimer>0){ u.shieldTimer-=dt; return; }
    if(u.shield<u.maxShield) u.shield=Math.min(u.maxShield, u.shield+u.shieldRate*dt);
  },

  gunTier(cat){
    return ({ sniper:5, rifle:4, smg:3, shotgun:2, pistol:1 })[cat] || 0;
  },

  /* 拾取掉落在地上的枪械 / 装备（任何存活者均可拾取，含敌方） */
  pickupPass(){
    if(!this.drops.length) return;
    for(let i=this.drops.length-1;i>=0;i--){
      const d=this.drops[i];
      d.t+=1/60;
      let taken=false;
      for(const u of this.allDuelists()){
        if(!u.alive) continue;
        if(M.dist(u.x,u.y,d.x,d.y) > 30) continue;
        // 主武器：仅当当前没有主武器，或掉落枪械明显更好时拾取
        if(d.gun && (!u.gun || this.gunTier(d.gun.cat)>this.gunTier(u.gun.cat))){
          u.giveGun(d.gun); taken=true;
        }
        // 护甲 / 头盔
        if(d.armor>0 && d.armor>=u.armor){
          u.armor=Math.max(u.armor, d.armor);
          if(d.helmet) u.helmet=true;
          taken=true;
        } else if(d.helmet && !u.helmet && u.armor>0){
          u.helmet=true; taken=true;
        }
        // 拆弹器
        if(d.kit && !u.kit){ u.kit=true; taken=true; }
        // 手雷（仅玩家收纳）
        if(d.nades && d.nades.length && u.isPlayer){
          u.nades=u.nades.concat(d.nades); taken=true;
        }
        if(taken) break;
      }
      if(taken) this.drops.splice(i,1);
    }
  },

  updateCamera(game){
    let target=this.player.alive?this.player:this.spectate;
    if(!target) target=this.player;
    if(!target) return;
    const v=game.view, z=game.zoom||1;
    let tx=target.x-v.w/z/2, ty=target.y-v.h/z/2;
    const b=this.map.bounds;
    tx=M.clamp(tx, b.minX, Math.max(b.minX, b.maxX-v.w/z));
    ty=M.clamp(ty, b.minY, Math.max(b.minY, b.maxY-v.h/z));
    game.camera.x=M.lerp(game.camera.x, tx, 0.16);
    game.camera.y=M.lerp(game.camera.y, ty, 0.16);
  },

  /* ----------------------------- 玩家操作 ----------------------------- */
  playerControl(game, dt, freeze){
    const p=this.player;
    if(!p) return;
    Input.sample(game);
    // 冻结期：禁止移动（可以转动视角、开购买菜单）
    const spd = 250 * (1 + (p.relicMods.moveSpeed||0)/100);
    if(freeze){ p.vx=0; p.vy=0; }
    else { p.vx=p.moveX*spd; p.vy=p.moveY*spd; }

    // 瞄准辅助（鼠标）：把 3.5° 内最近敌人吸附过来，提升手感
    if(!Input.isTouch && Input.mouse && Input.mouse.seen){
      let best=null, bd=0.06;
      for(const f of this.foesOf(p.side)){
        if(!f.alive) continue;
        if(!this.canSee(p,f)) continue;
        const a=M.angle(p.x,p.y,f.x,f.y);
        const diff=Math.abs(M.normAngle(a-p.angle));
        if(diff<bd){ bd=diff; best=f; }
      }
      if(best) p.angle=M.lerpAngle(p.angle, M.angle(p.x,p.y,best.x,best.y), 0.35);
    }

    const a=Input.consume();
    if(a.buy){ game.openBuy(); return; }
    if(a.pause){ game.pause(); return; }
    if(a.reload) p.startReload();
    if(a.switch) p.switchWeapon();
    if(a.nade && !freeze) this.throwNade(p);
    const holding = Input.isTouch ? Input.useHeld : !!(Input.keys && Input.keys['KeyE']);
    if(!freeze && holding) this.playerInteract(game, dt);
    else { p.plantT=0; p.defuseT=0; }

    if(p.reloading){ p.reloadT-=dt; if(p.reloadT<=0) p.finishReload(); }
    p.fireCd=Math.max(0,p.fireCd-dt);
    p.spray=Math.max(0, p.spray-dt*2.4);
    if(p.blind>0) p.blind-=dt;

    // 移动（分轴判定，避免卡墙）
    if(!freeze) this.moveEntity(p, p.vx*dt, p.vy*dt);

    if(!freeze && Input._firing && p.alive && p.blind<=0.15){
      this.tryFire(p, p.angle, game);
    }
    // 空弹匣自动换弹
    const g=p.activeGun();
    if(g && p.mag<=0 && !p.reloading && p.reserve>0) p.startReload();
  },

  playerInteract(game, dt){
    const p=this.player;
    const site=this.map.whichSite(p.x,p.y);
    // 下包
    if(p.side==="t" && p.hasBomb && site && !this.bomb.planted){
      p.plantT+=dt;
      if(p.plantT>=CS2.plantTime){ this.plantBomb(p, site, game); p.plantT=0; }
    }
    // 拆包
    else if(p.side==="ct" && this.bomb.planted && M.dist(p.x,p.y,this.bomb.x,this.bomb.y)<70){
      p.defuseT+=dt;
      const need=p.kit?CS2.defuseKitTime:CS2.defuseTime;
      if(p.defuseT>=need){ this.defuseBomb(p, game); p.defuseT=0; }
    }
  },

  /* ----------------------------- 交火 ----------------------------- */
  tryFire(shooter, aimAngle, game){
    const g=shooter.activeGun();
    if(!g) return;
    if(shooter.reloading || shooter.fireCd>0) return;
    if(shooter.mag<=0){ shooter.startReload(); return; }
    shooter.fireCd=60/Math.max(20, g.rpm*(1+(shooter.relicMods&&shooter.relicMods.fireRatePct||0)/100));
    shooter.mag--;
    shooter.spray=Math.min(4, shooter.spray+0.55);
    const baseDmg = g.dmg * (CS2.dmgMul||1) * (1+(shooter.relicMods&&shooter.relicMods.dmgPct||0)/100);

    // 火箭筒：发射慢速火箭弹（命中/撞墙后范围爆炸），不走射线
    if(g.rocket){
      const mx=shooter.x+Math.cos(aimAngle)*16, my=shooter.y+Math.sin(aimAngle)*16;
      this.rockets.push({ x:mx, y:my, ang:aimAngle, speed:230, dmg:baseDmg,
        splash:Math.max(92, g.splash||120), owner:shooter, side:shooter.side, gun:g, life:3.4,
        color:g.elemColor||"#ffb020", trail:[] });
      SFX.shoot();
      return;
    }

    const foes=this.foesOf(shooter.side);
    // 距离越远越不准：近距离交火致命，远距离对枪靠点射
    let nearD=900;
    for(const f of foes){
      if(!f.alive) continue;
      const d=M.dist(shooter.x,shooter.y,f.x,f.y);
      if(d<nearD && this.canSee(shooter,f)) nearD=d;
    }
    const distPenalty=1+Math.max(0,(nearD-220)/560);
    // 移动射击：位移越大扩散越夸张，且按枪种分档（冲锋枪保持原样，不吃新增惩罚）
    const mv=shooter._mv||0;
    const moveMul=moveSpreadMul(g.cat, mv);
    const baseSpread=g.spread*(1+shooter.spray*0.75)*(1+(1-(shooter.skill||1))*1.1)*distPenalty*2.0;
    let spread=baseSpread*moveMul;
    if(mv>0.05 && !isSMG(g.cat)) spread=Math.min(spread, Math.max(baseSpread*1.35, moveSpreadCap(g.cat)));
    const pellets=g.pellets||1;
    const muzzle={ x:shooter.x+Math.cos(aimAngle)*16, y:shooter.y+Math.sin(aimAngle)*16 };

    for(let i=0;i<pellets;i++){
      const ang=aimAngle+RNG.gauss()*spread;
      // 找射线命中的最近目标
      let hit=null, hitD=1e9;
      for(const f of foes){
        if(!f.alive) continue;
        const d=M.dist(muzzle.x,muzzle.y,f.x,f.y);
        if(d>1500||d>hitD) continue;
        const exact=M.angle(muzzle.x,muzzle.y,f.x,f.y);
        const tol=Math.atan2(f.radius*1.35, Math.max(30,d))+0.012;
        if(Math.abs(M.normAngle(ang-exact))>tol) continue;
        if(!this.canSeeXY(muzzle.x,muzzle.y,f.x,f.y)) continue;
        hit=f; hitD=d;
      }
      if(hit){
        const head=RNG.chance(0.16);
        this.applyDamage(hit, baseDmg, g.ap, head, shooter, false, g);
        this.hitmarks.push({x:hit.x,y:hit.y,t:0.25,head});
        if(g.splash) this.splashDmg(game, hit.x, hit.y, g.splash, baseDmg*0.65, shooter, hit);
      }
      let len=Math.min(hitD===1e9?1100:hitD, 1100);
      // 未命中：弹道截在墙面上，别画出「穿墙子弹」的观感
      if(hitD===1e9){
        const ca=Math.cos(ang), sa=Math.sin(ang);
        for(let d=18; d<len; d+=11){
          if(!this.map.isWalk(muzzle.x+ca*d, muzzle.y+sa*d)){ len=d; break; }
        }
      }
      // 子弹颜色随弹种属性（旧刷宝体系模式）：火焰橙红 / 电击青蓝 / 腐蚀荧光绿…
      const tcol = (g.element && g.element!=="none" && ELEMENTS[g.element])
        ? ELEMENTS[g.element].color
        : (shooter.side==="t" ? "#ffcf5a" : "#9bd8ff");
      this.tracers.push({ x1:muzzle.x, y1:muzzle.y, x2:muzzle.x+Math.cos(ang)*len, y2:muzzle.y+Math.sin(ang)*len,
        bx:muzzle.x, by:muzzle.y, t:0.07, t0:0.07, laser: !!g.laser, shape: g.projShape||"round", color:tcol });
    }
    SFX.shoot();
  },

  splashDmg(game, x, y, r, dmg, attacker, exclude){
    for(const d of this.allDuelists()){
      if(!d.alive||d===exclude) continue;
      if(M.dist(x,y,d.x,d.y)<r) this.applyDamage(d, dmg, 0.6, false, attacker, false, {splash:0});
    }
    this.fires.push({x,y,r:r*0.6,t:0.2,flash:true});
  },

  applyDamage(target, dmg, ap, head, attacker, dot, gun){
    if(!target.alive) return;
    let d=dmg;
    if(head) d *= target.helmet ? 1.55 : 2.35;
    // 护甲池优先吸收（旧刷宝体系模式）
    if(target.maxShield>0 && target.shield>0 && !dot){
      const absorb=Math.min(target.shield, d);
      target.shield-=absorb; d-=absorb;
      target.shieldTimer=target.shieldDelay;
      // 护甲特效：破裂冲击
      if(target.shield<=0 && target.shieldItem && target.shieldItem.effect==="nova"){
        for(const f of this.foesOf(target.side)){
          if(!f.alive) continue;
          if(M.dist(target.x,target.y,f.x,f.y)<150) this.applyDamage(f, target.shieldItem.effectVal, 0.7, false, target, false, {splash:0});
        }
        this.fires.push({x:target.x,y:target.y,r:150,t:0.3,flash:true});
      }
    }
    let hpDmg=d;
    if(target.armor>0 && !dot && d>0){
      hpDmg=d*ap;
      target.armor=Math.max(0, target.armor - d*(1-ap)*0.62);
    }
    target.hp-=hpDmg;
    // 随身装备急救效率
    if(attacker && attacker!==target && attacker.relicMods && attacker.relicMods.lifesteal && !dot){
      attacker.hp=Math.min(attacker.maxHP, attacker.hp + hpDmg*attacker.relicMods.lifesteal/100);
    }
    target.flash=0.12;
    if(target.isPlayer) this.shakeT=0.15;
    if(target.alert!==undefined) target.alert=1.6;   // 受击警觉：短暂全向感知，模拟听到枪声/脚步
    if(target.hp<=0 && target.alive){
      target.hp=0; target.alive=false; target.deadT=0;
      this.onDeath(target, attacker, gun);
    }
  },

  onDeath(victim, attacker, gun){
    victim.deaths++;
    victim.deadLastRound=true;
    victim.hasBomb=false;
    victim.shield=0; victim.shieldTimer=0;
    // 死亡掉落：枪械与装备落在地上，存活队友/玩家可拾取
    this.drops.push({
      x:victim.x, y:victim.y, side:victim.side, t:0,
      gun: victim.gun ? { ...victim.gun, _mag:undefined, _res:undefined } : null,
      pistol: { ...victim.pistol },
      armor: victim.armor, helmet: victim.helmet, kit: victim.kit,
      nades: victim.nades ? victim.nades.slice() : [],
    });
    if(this.bomb.carrier===victim){
      this.bomb.carrier=null;
      if(!this.bomb.planted){ this.bomb.dropped=true; this.bomb.x=victim.x; this.bomb.y=victim.y; }
    }
    if(attacker && attacker!==victim){
      attacker.kills++;
      if(attacker===this.player) this._playerKillsThisRound++;   // 记录玩家本回合击杀，用于下回合商店品质
      // 击杀奖励：CS2 按武器口径；旧刷宝体系模式固定 500，鼓励交火刷钱买随身装备/护甲
      const reward = this.gunSet==="bl" ? 500 : (gun && gun.kill ? gun.kill : 300);
      attacker.money=Math.min(CS2.maxMoney, attacker.money+reward);
      this.killfeed.unshift({ killer:attacker.name, victim:victim.name, gun:gun?gun.name:"", t:5, head:false, money:reward });
      if(this.killfeed.length>5) this.killfeed.pop();
    } else {
      this.killfeed.unshift({ killer:"", victim:victim.name, gun:"", t:5, self:true });
      if(this.killfeed.length>5) this.killfeed.pop();
    }
    // 拾取掉落的 C4
    if(this.bomb.dropped && !this.bomb.planted){
      for(const d of this.matesOf(victim.side)){
        if(d.alive && M.dist(d.x,d.y,this.bomb.x,this.bomb.y)<40){
          this.bomb.carrier=d; this.bomb.dropped=false; d.hasBomb=true; break;
        }
      }
    }
    SFX.hurt();
  },

  canSee(a,b){
    if(!this.map.los(a.x,a.y,b.x,b.y)) return false;
    // 烟雾遮挡
    for(const s of this.smokes){
      if(s.t<=0) continue;
      const d=this.pointSegDist(s.x,s.y,a.x,a.y,b.x,b.y);
      if(d < s.r*0.85) return false;
    }
    return true;
  },
  canSeeXY(x1,y1,x2,y2){
    if(!this.map.los(x1,y1,x2,y2)) return false;
    for(const s of this.smokes){
      if(s.t<=0) continue;
      if(this.pointSegDist(s.x,s.y,x1,y1,x2,y2) < s.r*0.85) return false;
    }
    return true;
  },
  pointSegDist(px,py,x1,y1,x2,y2){
    const dx=x2-x1, dy=y2-y1; const l2=dx*dx+dy*dy;
    let t=l2>0?((px-x1)*dx+(py-y1)*dy)/l2:0;
    t=Math.max(0,Math.min(1,t));
    return Math.hypot(px-(x1+dx*t), py-(y1+dy*t));
  },

  /* ----------------------------- 移动 ----------------------------- */
  moveEntity(e, dx, dy){
    const r=e.radius*0.9, px=e.x, py=e.y;
    if(this.map.canStand(e.x+dx, e.y, r)) e.x+=dx;
    else if(this.map.canStand(e.x+dx, e.y+Math.sign(dy||1)*1, r)) e.x+=dx*0.4;
    if(this.map.canStand(e.x, e.y+dy, r)) e.y+=dy;
    else if(this.map.canStand(e.x+Math.sign(dx||1)*1, e.y+dy, r)) e.y+=dy*0.4;
    e.x=M.clamp(e.x, 20, this.map.w-20);
    e.y=M.clamp(e.y, 20, this.map.h-20);
    // 移动幅度（0..1），用于开火扩散：实际位移 ≈ 250px/s÷60 ≈ 4.2px/帧
    e._mv = Math.min(1, Math.hypot(e.x-px, e.y-py)/4.2);
  },

  /* ----------------------------- AI ----------------------------- */
  botsUpdate(game, dt){
    for(const d of this.allDuelists()){
      if(!d.alive) continue;
      if(d.isPlayer) continue;
      this.botThink(d, dt, game);
    }
  },
  botsIdle(game, dt){
    // 回合结束后停止射击，仅做轻微动作
  },

  botThink(b, dt, game){
    b.fireCd=Math.max(0,b.fireCd-dt);
    b.spray=Math.max(0,b.spray-dt*2.2);
    if(b.reloading){ b.reloadT-=dt; if(b.reloadT<=0) b.finishReload(); }
    if(b.blind>0) b.blind-=dt;
    if(b.alert>0) b.alert-=dt;

    // 找可见敌人：受「视距 + 朝向视野锥」双重约束，背后/侧后的敌人看不见
    let target=null, td=1e9;
    const gun=b.activeGun();
    const maxR = (gun && gun.cat==="sniper") ? 720 : 560;      // 电脑视距远小于玩家直觉，避免全图感知
    for(const f of this.foesOf(b.side)){
      if(!f.alive) continue;
      const d=M.dist(b.x,b.y,f.x,f.y);
      if(d>maxR||d>td) continue;
      if(!this.canSee(b,f)) continue;
      // 朝向视野锥：半角 60°，看不到背后；很近(<150)或刚被惊动(alert)时全向感知
      const toAng=M.angle(b.x,b.y,f.x,f.y);
      const off=Math.abs(M.normAngle(toAng-b.angle));
      const cone = (b.alert>0 || d<150) ? Math.PI : 1.05;
      if(off>cone) continue;
      td=d; target=f;
    }

    if(target){
      if(b.target!==target) b.react=0.16+Math.random()*0.28;
      b.target=target;
      b.react-=dt;
      const aim=M.angle(b.x,b.y,target.x,target.y);
      const turn = b.blind>0 ? 2.2 : 9;
      b.angle=M.lerpAngle(b.angle, aim, Math.min(1,dt*turn));
      // 走位：保持交火距离 + 侧向拉扯
      const want = b.activeGun() && b.activeGun().cat==="sniper" ? 620 : 300;
      let mx=0,my=0;
      if(td>want+80){ mx=Math.cos(M.angle(b.x,b.y,target.x,target.y)); my=Math.sin(M.angle(b.x,b.y,target.x,target.y)); }
      else if(td<want-110){ mx=-Math.cos(M.angle(b.x,b.y,target.x,target.y)); my=-Math.sin(M.angle(b.x,b.y,target.x,target.y)); }
      else { mx=Math.cos(aim+Math.PI/2)*(b.id.charCodeAt(b.id.length-1)%2?1:-1)*0.8; my=Math.sin(aim+Math.PI/2)*(b.id.charCodeAt(b.id.length-1)%2?1:-1)*0.8; }
      this.moveEntity(b, mx*215*dt, my*215*dt);
      // 开火
      const g=b.activeGun();
      if(g && b.mag<=0) b.startReload();
      if(b.react<=0 && b.blind<=0.2 && Math.abs(M.normAngle(b.angle-aim))<0.16 && b.mag>0){
        this.tryFire(b, b.angle+RNG.gauss()*g.spread*0.4, game);
      }
      // 顺手丢雷
      if(b.nades.length && RNG.chance(dt*0.35) && td>220 && td<620) this.throwNade(b, target);
      return;
    }
    b.target=null;
    this.botObjective(b, dt, game);
  },

  botObjective(b, dt, game){
    const bomb=this.bomb;
    let goal=null;

    if(b.side==="t"){
      if(bomb.planted){
        // 守包
        if(!b.holdPoint || b.holdPoint.site!==bomb.site){
          b.holdPoint={ ...this.map.randomPointInSite(bomb.site), site:bomb.site };
        }
        goal=b.holdPoint;
      } else if(bomb.dropped && !bomb.carrier){
        // 包掉地上了：全员先去捡
        goal={ x:bomb.x, y:bomb.y };
        if(M.dist(b.x,b.y,bomb.x,bomb.y)<40){ b.hasBomb=true; bomb.carrier=b; bomb.dropped=false; }
      } else if(b.hasBomb){
        const site=this.map.whichSite(b.x,b.y);
        if(site){
          // 站到点里就开始下包
          b.plantT+=dt;
          b.angle+=RNG.fr(-0.4,0.4)*dt;
          if(b.plantT>=CS2.plantTime){ this.plantBomb(b, site, game); b.plantT=0; }
          return;
        }
        // 带包的人长时间挪不动：把包丢地上让队友来捡，避免全队陪葬
        if((b._stuckN||0)>=6){
          b.hasBomb=false; b._stuckN=0;
          bomb.carrier=null; bomb.dropped=true; bomb.x=b.x; bomb.y=b.y;
          this.roundMsg={ title:"C4 掉落", sub:"携带者受阻，队友快去捡包", color:"#ffb020" };
          this.roundMsgT=2.5;
          return;
        }
        goal=this.sitePlantSpot(b.siteTarget||"A");
      } else {
        // 掩护带包的人，各自去同一点的不同位置
        const st=b.siteTarget||"A";
        if(!b._escortSpot || b._escortSpot.site!==st){
          b._escortSpot={ ...this.map.randomPointInSite(st), site:st };
        }
        goal=b._escortSpot;
      }
    } else {
      if(bomb.planted){
        goal={ x:bomb.x, y:bomb.y };
        if(M.dist(b.x,b.y,bomb.x,bomb.y)<62){
          b.defuseT+=dt;
          b.angle=M.angle(b.x,b.y,bomb.x,bomb.y);
          const need=b.kit?CS2.defuseKitTime:CS2.defuseTime;
          if(b.defuseT>=need){ this.defuseBomb(b, game); b.defuseT=0; }
          return;
        }
      } else {
        if(!b.siteTarget){
          const alive=this.aliveOf(b.team);
          const idx=alive.indexOf(b);
          b.siteTarget = idx%2===0 ? "A" : "B";
        }
        if(!b.holdPoint || b.holdPoint.site!==b.siteTarget){
          b.holdPoint={ ...this.map.randomPointInSite(b.siteTarget), site:b.siteTarget };
        }
        goal=b.holdPoint;
      }
    }

    if(!goal) return;
    this.navigate(b, goal, dt, game);
  },

  teamRally(b){
    // 无包 T：跟包或分批去点
    const bomb=this.bomb;
    if(bomb.carrier && bomb.carrier!==b && bomb.carrier.alive){
      const c=bomb.carrier;
      return { x:c.x+RNG.fr(-70,70), y:c.y+RNG.fr(-70,70) };
    }
    if(!b.siteTarget) b.siteTarget=RNG.chance(0.5)?"A":"B";
    return this.sitePlantSpot(b.siteTarget);
  },

  sitePlantSpot(site){
    if(!this._plantSpots) this._plantSpots={};
    if(!this._plantSpots[site]) this._plantSpots[site]=this.map.randomPointInSite(site);
    return this._plantSpots[site];
  },

  navigate(b, goal, dt, game){
    /* 防卡死：1.1 秒内位移过小且还有路要走 → 清路 + 随机侧移脱困 */
    b._stk=(b._stk||0)+dt;
    if(b._stk>=1.1){
      const mv=Math.hypot(b.x-(b._sx===undefined?b.x:b._sx), b.y-(b._sy===undefined?b.y:b._sy));
      if(mv<26 && b.path && b.pathIdx<b.path.length){
        b.path=null; b.pathT=0;
        b._stuckN=(b._stuckN||0)+1;
        const ja=RNG.fr(0,Math.PI*2);
        this.moveEntity(b, Math.cos(ja)*120, Math.sin(ja)*120);
      } else b._stuckN=0;
      b._sx=b.x; b._sy=b.y; b._stk=0;
    }

    b.pathT-=dt;
    const needPath = !b.path || b.pathT<=0 || M.dist(b.x,b.y,goal.x,goal.y)<50 ||
                     (b._goal && M.dist(b._goal.x,b._goal.y,goal.x,goal.y)>90);
    if(needPath){
      b.path=this.map.findPath(b.x,b.y,goal.x,goal.y);
      b.pathIdx=0; b.pathT=0.85; b._goal={x:goal.x,y:goal.y};
    }
    if(b.path && b.path.length){
      while(b.pathIdx<b.path.length && M.dist(b.x,b.y,b.path[b.pathIdx].x,b.path[b.pathIdx].y)<24) b.pathIdx++;
      if(b.pathIdx<b.path.length){
        const wp=b.path[b.pathIdx];
        const a=M.angle(b.x,b.y,wp.x,wp.y);
        b.angle=M.lerpAngle(b.angle, a, Math.min(1,dt*7));
        this.moveEntity(b, Math.cos(a)*225*dt, Math.sin(a)*225*dt);
        return;
      }
    }
    // 到点：原地小幅游走 + 面朝可疑方向
    b.idle+=dt;
    if(b.idle>1.4){
      b.idle=0;
      b.angle += RNG.fr(-0.7,0.7);
    }
  },

  /* ----------------------------- 炸弹 ----------------------------- */
  plantBomb(who, site, game){
    const b=this.bomb;
    b.planted=true; b.site=site; b.x=who.x; b.y=who.y; b.timer=CS2.bombTime;
    b.planter=who; b.carrier=null; who.hasBomb=false;
    this.roundMsg={ title:"炸弹已安放", sub:`C4 在 ${site} 点，40 秒`, color:"#ff6b3d" };
    this.roundMsgT=2.2;
    game.toast(`C4 已安放在 ${site} 点`);
    game.shake(6); SFX.boom();
  },

  defuseBomb(who, game){
    const b=this.bomb;
    if(!b.planted) return;
    b.planted=false; b.defuser=who;
    this.endRound(who.side, "defuse", game);
    game.toast("拆包成功");
  },

  bombUpdate(game, dt){
    const b=this.bomb;
    if(b.planted){
      b.timer-=dt;
      if(b.timer<=0){
        this.endRound(this.teams.A.side==="t"?"t":"ct", "explode", game);
        game.shake(14);
        this.fires.push({x:b.x,y:b.y,r:260,t:1.4,flash:true});
      }
      // 拆包被打断
      for(const d of this.allDuelists()){
        if(!d.alive||d.defuseT<=0) continue;
        if(M.dist(d.x,d.y,b.x,b.y)>80) d.defuseT=0;
      }
    } else if(b.dropped && b.carrier===null){
      // T 靠近自动拾取
      for(const d of this.matesOf("t")){
        if(!d.alive) continue;
        if(M.dist(d.x,d.y,b.x,b.y)<36){ d.hasBomb=true; b.carrier=d; b.dropped=false; break; }
      }
    }
  },

  checkRoundEnd(game){
    const tAlive=this.matesOf("t").length;
    const ctAlive=this.matesOf("ct").length;
    if(tAlive===0 && !this.bomb.planted) return this.endRound("ct","elim",game);
    if(ctAlive===0) return this.endRound("t","elim",game);
    if(tAlive===0 && this.bomb.planted){
      // T 全灭但包已安放：等爆炸或拆包
    }
  },

  /* ----------------------------- 手雷 ----------------------------- */
  throwNade(who, forcedTarget){
    if(!who.nades.length) return;
    const type=who.nades.shift();
    let tx,ty;
    if(forcedTarget){ tx=forcedTarget.x; ty=forcedTarget.y; }
    else { tx=who.x+Math.cos(who.angle)*380; ty=who.y+Math.sin(who.angle)*380; }
    this.nades.push({ x:who.x, y:who.y, sx:who.x, sy:who.y, tx, ty, t:0, dur:0.75, type, owner:who, side:who.side });
    SFX.ui();
  },

  nadesUpdate(game, dt){
    for(let i=this.nades.length-1;i>=0;i--){
      const n=this.nades[i];
      n.t+=dt;
      const k=Math.min(1,n.t/n.dur);
      n.x=M.lerp(n.sx,n.tx,k); n.y=M.lerp(n.sy,n.ty,k);
      if(k>=1){ this.detonate(n, game); this.nades.splice(i,1); }
    }
  },

  detonate(n, game){
    const cfg = CS2.nades[n.type] || CS2.nades.he;
    if(n.type==="he"){
      for(const d of this.allDuelists()){
        if(!d.alive) continue;
        const dist=M.dist(n.x,n.y,d.x,d.y);
        if(dist<cfg.radius && this.canSeeXY(n.x,n.y,d.x,d.y)){
          const dmg=cfg.dmg*(1-dist/cfg.radius*0.6);
          this.applyDamage(d, dmg, 0.55, false, n.owner, false, {splash:0});
        }
      }
      this.fires.push({x:n.x,y:n.y,r:cfg.radius,t:0.35,flash:true});
    } else if(n.type==="molly"){
      this.fires.push({x:n.x,y:n.y,r:cfg.radius,t:7});
    } else if(n.type==="smoke"){
      this.smokes.push({x:n.x,y:n.y,r:135,t:14});
    } else if(n.type==="flash"){
      for(const d of this.allDuelists()){
        if(!d.alive) continue;
        const dist=M.dist(n.x,n.y,d.x,d.y);
        if(dist<430 && this.canSeeXY(n.x,n.y,d.x,d.y)){
          d.blind=Math.max(d.blind, 2.2*(1-dist/500));
          if(d.isPlayer) this.playerFlashed=1.0;
        }
      }
    }
    SFX.boom();
  },

  /* ----------------------------- 火箭弹 ----------------------------- */
  rocketsUpdate(game, dt){
    for(let i=this.rockets.length-1;i>=0;i--){
      const rk=this.rockets[i];
      const nx=rk.x+Math.cos(rk.ang)*rk.speed*dt, ny=rk.y+Math.sin(rk.ang)*rk.speed*dt;
      // 撞墙爆炸
      if(!this.map.isWalk(nx,ny)){ this.explodeRocket(rk,game,rk.x,rk.y); this.rockets.splice(i,1); continue; }
      // 命中决斗者爆炸
      let hit=false;
      for(const d of this.allDuelists()){
        if(!d.alive || d===rk.owner) continue;
        if(M.dist(nx,ny,d.x,d.y) < 18){ this.explodeRocket(rk,game,nx,ny); hit=true; break; }
      }
      if(hit){ this.rockets.splice(i,1); continue; }
      rk.x=nx; rk.y=ny;
      rk.trail.push({x:nx,y:ny}); if(rk.trail.length>10) rk.trail.shift();
      rk.life-=dt;
      if(rk.life<=0){ this.explodeRocket(rk,game,rk.x,rk.y); this.rockets.splice(i,1); }
    }
  },
  explodeRocket(rk, game, x, y){
    const R=rk.splash||120;
    this.splashDmg(game, x, y, R, rk.dmg, rk.owner, rk.owner);
    SFX.boom();
    game.shake && game.shake(6);
  },

  /* ----------------------------- 购买 ----------------------------- */
  // 旧刷宝体系商店品质等级：回合越多越高；上回合玩家有击杀额外加成
  blQualityLevel(){
    const round = this.round || 1;
    const roundBonus = (round-1) * 0.9;                                   // 每过一回合 +0.9
    const killBonus = Math.min(this._playerKillsLastRound||0, 8) * 1.1;    // 上回合击杀，最多 +8 杀
    return M.clamp(2 + roundBonus + killBonus, 2, 16);
  },
  // 随品质等级上移的稀有度权重：ql 越高，权重越偏向高端（指数放大）
  blWeights(ql){
    const ids=["white","green","blue","purple","orange","pearl","ancient","rainbow"];
    const boost=Math.max(0,(ql-2))*0.10;                                  // 每等级提升高端权重
    const t={};
    for(let i=0;i<ids.length;i++) t[ids[i]]=Math.pow(0.5, i) * Math.exp(boost*i);
    return t;
  },
  rollBlShop(){
    const ql=this.blQualityLevel();
    const weights=this.blWeights(ql);
    // 每个武器位按类型配额生成，保证五列都有货（跟 CS2 一样不会空列）
    const want={ pistol:3, smg:4, rifle:5 };
    const list=[], ids=new Set();
    for(const cat in want){
      let got=0, tries=0;
      while(got<want[cat] && tries<120){
        tries++;
        const ilvl=RNG.ri(Math.floor(ql*0.55), Math.round(ql));
        const w=generateWeapon(ilvl, { luck:true, weights });
        const s=blToSpec(w);
        if(s.cat!==cat) continue;
        if(ids.has(s.id)) continue;
        ids.add(s.id); list.push(s); got++;
      }
    }
    // 按价格排序，便宜的在上面（和 CS2 一致）
    this.blShop=list.sort((a,c)=>a.price-c.price);
    // 随身装备 / 护甲货架：每回合刷新，护甲×2 + 随身装备×2；品质随 ql 提升
    const gear=[];
    for(let i=0;i<2;i++){
      const s=generateShield(Math.round(ql), { weights });
      gear.push({ id:"blg_s"+i, kind:"shield", item:s, cat:"gear", name:s.name,
        price:Math.max(500, Math.round(itemPrice(s)/50)*50*0.6),
        color:RARITY_BY_ID[s.rarity]?RARITY_BY_ID[s.rarity].color:"#4ad6ff",
        desc:`容量 ${s.capacity}，延迟 ${s.delay}s，回充 ${s.rate}/s` });
    }
    for(let i=0;i<2;i++){
      const r=generateRelic(Math.round(ql), { weights });
      gear.push({ id:"blg_r"+i, kind:"relic", item:r, cat:"gear", name:r.name,
        price:Math.max(800, Math.round(itemPrice(r)/50)*50*0.7),
        color:RARITY_BY_ID[r.rarity]?RARITY_BY_ID[r.rarity].color:"#b061ff",
        desc:relicLines(r).join("，") });
    }
    this.blGear=gear;
  },

  buyList(tab){
    // CS2 原版五列：中档 = 微冲 + 霰弹，步枪 = 步枪 + 狙击
    const catOk=(cat)=>{
      if(tab==="rifle") return cat==="rifle" || cat==="sniper";
      if(tab==="smg")   return cat==="smg"   || cat==="shotgun";
      return cat===tab;
    };
    if(tab==="gear") return Object.values(CS2.gear).filter(g=>!g.side||g.side===this.playerSide());
    if(tab==="blgear") return this.blGear||[];
    if(tab==="nade") return Object.values(CS2.nades);
    if(this.gunSet==="bl"){
      return this.blShop.filter(s=>catOk(s.cat)).sort((a,c)=>a.price-c.price);
    }
    const out=[];
    for(const id in CS2.weapons){
      const w=CS2.weapons[id];
      if(!catOk(w.cat)) continue;
      if(w.side && w.side!==this.playerSide()) continue;
      out.push(w);
    }
    return out.sort((a,c)=>a.price-c.price);
  },

  canBuy(){
    return this.state==="freeze" && this.timer>0;
  },

  buy(id){
    const p=this.player;
    if(!this.canBuy()) return { ok:false, msg:"购买时间已结束" };
    // 旧刷宝体系：护甲 / 随身装备
    const blg=(this.blGear||[]).find(g=>g.id===id);
    if(blg){
      if(p.money<blg.price) return { ok:false, msg:"资金不足" };
      if(blg.kind==="shield"){
        if(p.shieldItem && p.shieldItem===blg.item) return { ok:false, msg:"已持有" };
        p.shieldItem=blg.item;
        p.maxShield=blg.item.capacity;
        p.shieldDelay=blg.item.delay;
        p.shieldRate=blg.item.rate;
        p.shield=blg.item.capacity;
      } else {
        if(p.relicItem && p.relicItem===blg.item) return { ok:false, msg:"已持有" };
        p.relicItem=blg.item;
        p.relicMods=relicModMap(blg.item);
      }
      p.money-=blg.price;
      return { ok:true, msg:"已购买 "+blg.name };
    }
    // 装备
    if(CS2.gear[id]){
      const g=CS2.gear[id];
      if(g.side && g.side!==p.side) return { ok:false, msg:"本阵营无法购买" };
      if(p.money<g.price) return { ok:false, msg:"资金不足" };
      if(g.id==="kit"){ if(p.kit) return { ok:false, msg:"已持有拆弹器" }; p.kit=true; }
      else {
        if(p.armor>=100 && (!g.helmet||p.helmet)) return { ok:false, msg:"已持有" };
        p.armor=100; if(g.helmet) p.helmet=true;
      }
      p.money-=g.price;
      return { ok:true, msg:"已购买 "+g.name };
    }
    if(CS2.nades[id]){
      const g=CS2.nades[id];
      if(p.money<g.price) return { ok:false, msg:"资金不足" };
      if(p.nades.length>=4) return { ok:false, msg:"手雷已满（4）" };
      p.nades.push(id); p.money-=g.price;
      return { ok:true, msg:"已购买 "+g.name };
    }
    const spec = this.gunSet==="bl" ? this.blShop.find(s=>s.id===id) : CS2.weapons[id];
    if(!spec) return { ok:false, msg:"没有这件武器" };
    if(spec.side && spec.side!==p.side) return { ok:false, msg:"本阵营无法购买" };
    if(p.money<spec.price) return { ok:false, msg:"资金不足" };
    if(p.gun && p.gun.id===spec.id) return { ok:false, msg:"已持有" };
    p.money-=spec.price;
    p.giveGun(spec);
    return { ok:true, msg:"已购买 "+spec.name };
  },

  botBuyAll(game){
    for(const tid in this.teams){
      const tm=this.teams[tid];
      for(const b of tm.bots){
        if(b.isPlayer) continue;
        this.botBuy(b);
      }
    }
  },

  botBuy(b){
    // 预算分配：优先 步枪+全甲 → 微冲+甲 → 手枪+甲 → 存钱
    const pool = this.gunSet==="bl"
      ? this.blShop.filter(s=>s.side===undefined||s.side===b.side)
      : Object.values(CS2.weapons).filter(w=>!w.side||w.side===b.side);
    const m=b.money;
    const rifle=pool.filter(w=>w.cat==="rifle").sort((a,c)=>c.price-a.price);
    const smg=pool.filter(w=>w.cat==="smg").sort((a,c)=>c.price-a.price);
    const pistol=pool.filter(w=>w.cat==="pistol").sort((a,c)=>c.price-a.price);
    const sniper=pool.filter(w=>w.cat==="sniper").sort((a,c)=>c.price-a.price);
    const wantAwp = b.id.endsWith("3") && m>5200 && sniper.length;
    let bought=false;
    if(wantAwp && sniper.length && m>=sniper[0].price+1000){
      b.money-=sniper[0].price; b.giveGun(sniper[0]); bought=true;
      if(b.money>=1000){ b.money-=1000; b.armor=100; b.helmet=true; }
    } else if(rifle.length && m>=rifle[0].price+1000){
      const pick=rifle[0];
      b.money-=pick.price; b.giveGun(pick); bought=true;
      if(b.money>=1000){ b.money-=1000; b.armor=100; b.helmet=true; }
      else if(b.money>=650){ b.money-=650; b.armor=100; }
    } else if(smg.length && m>=smg[0].price+650){
      const pick=smg[Math.min(1,smg.length-1)];
      b.money-=pick.price; b.giveGun(pick); bought=true;
      if(b.money>=650){ b.money-=650; b.armor=100; }
    } else if(pistol.length && m>=pistol[pistol.length-1].price+650){
      const pick=pistol[pistol.length-1];
      b.money-=pick.price; b.giveGun(pick); bought=true;
      if(b.money>=650){ b.money-=650; b.armor=100; }
    } else if(m>=650){
      b.money-=650; b.armor=100;
    }
    // 手雷
    if(b.money>=300 && b.nades.length<2){ b.money-=300; b.nades.push("he"); }
    if(b.side==="ct" && !b.kit && b.money>=400 && RNG.chance(0.5)){ b.money-=400; b.kit=true; }
  },
};

/* 旧刷宝体系枪械 -> 沙二可用的枪械规格 */
const BL_CAT_MAP = { pistol:"pistol", smg:"smg", shotgun:"smg", rifle:"rifle", sniper:"rifle", launcher:"rifle" };
const BL_DMG = { pistol:30, smg:26, shotgun:15, rifle:33, sniper:92, launcher:78 };
const BL_PRICE = { pistol:500, smg:1350, shotgun:1150, rifle:2650, sniper:3100, launcher:2950 };
const BL_RARITY_MUL = { white:1, green:1.05, blue:1.12, purple:1.2, orange:1.32, pearl:1.36, ancient:1.44, rainbow:1.55 };
const BL_RARITY_PRICE = { white:0.8, green:0.9, blue:1, purple:1.12, orange:1.35, pearl:1.4, ancient:1.6, rainbow:1.8 };

function blToSpec(w){
  const cat=BL_CAT_MAP[w.type] || "rifle";
  const rarMul=BL_RARITY_MUL[w.rarity]||1;
  const priceMul=BL_RARITY_PRICE[w.rarity]||1;
  const scale=0.85+Math.min(0.45, w.stats.damage/180);
  const dmg=Math.round(BL_DMG[w.type]*rarMul*scale);
  // 散布按品类放大（冲锋枪最飘），整体比原版更宽
  const catSpread = cat==="smg"?2.2 : cat==="shotgun"?1.5 : cat==="pistol"?1.5 : cat==="sniper"?1.2 : 1.7;
  const spread = Math.max(0.02, ((1-w.stats.accuracy)*0.5+0.04) * catSpread);
  return {
    id:"bl_"+Math.random().toString(36).slice(2,8),
    name:w.name, cat, bl:true, rarity:w.rarity,
    laser: !!w.laser,
    rocket: w.type==="launcher",
    projShape: w.projShape||"round",
    element: w.element||"none",
    elemColor: (w.element && w.element!=="none" && ELEMENTS[w.element]) ? ELEMENTS[w.element].color : null,
    price:Math.round(BL_PRICE[w.type]*priceMul/50)*50,
    dmg:Math.max(14, Math.min(120, Math.round(dmg*(CS2.dmgMul||1)))),
    ap: w.type==="sniper"?0.92:0.76,
    rpm: Math.max(30, Math.round(w.stats.fireRate*60)),
    spread,
    mag: w.magSizeBase,
    reload: w.stats.reload,
    kill: cat==="smg"?600:300,
    auto: !!w.stats.auto,
    pellets: w.stats.pellets>1?w.stats.pellets:undefined,
    splash: w.stats.splash||0,
    color: RARITY_BY_ID[w.rarity] ? RARITY_BY_ID[w.rarity].color : "#e9e4dc",
  };
}
