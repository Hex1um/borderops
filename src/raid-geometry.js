/* =========================================================================
 * raid-geometry.js — 复合装饰形状 / 建筑结构 / 铁路跨河桥（v0.31.0）
 *
 * 这里只产「几何」，不碰游戏状态。所有函数被 raid-core.js（建图）、
 * raid-render.js / fpview.js（绘制）共用，保证「看到的形状」与「挡住的形状」
 * 是同一份数据 —— 这正是三矩形需求的落点。
 * ========================================================================= */

/* ---------------------------------------------------------------------------
 * 一、复合装饰：按三个矩形算碰撞箱与「光线碰撞箱」
 * ---------------------------------------------------------------------------
 * 旧版 _pushProp 把整块 AABB 塞进 walls，于是：
 *   · 移动碰撞：整条隔离栏都是实心的，视觉上明明有缝却钻不过去；
 *   · _rayWall（AI 视线）/ _rayLight（手电光锥）：整块矩形投出一片方形阴影。
 * 现在这类装饰在 walls 里注册 **3 个子矩形**，navCell / losCell 自然只按
 * 这三块索引，缝隙里人能过、子弹能穿、光能透。props 里仍留整体 AABB
 * 供渲染与摆放避让使用（_canPlaceProp 不希望别的物件贴到缝里）。
 */
const RAID_COMPOUND_KINDS = {
  barrier: "triple",   sandbag: "triple",   shelf: "triple",
  pipe: "triple",      archway: "arch",
  /* v0.32.0（用户反馈）：rock 的**画面是六边形**，碰撞却走 AABB + 椭圆光线，
     走位与光斑都对不上边。改成三条横带近似六边形：navCell（移动 / 子弹）、
     losCell（AI 视线）、_rayLight（手电）都会按这三条带子判定。 */
  rock: "hex",
};

/* 返回 3 个绝对坐标矩形；shape=arch 是「两柱 + 顶梁」的门廊（中间真空洞），
 * shape=triple 是沿长轴三等分且留缝的长条掩体。 */
function raidCompoundBoxes(p){
  const x=p.x, y=p.y, w=p.w, h=p.h, shape=p.compound||RAID_COMPOUND_KINDS[p.kind];
  if(!shape) return [{x,y,w,h}];
  const horiz = w>=h;
  if(shape==="arch"){
    const pw=Math.max(14, Math.min(horiz?w*0.18:w*0.30, 44));
    const bh=Math.max(12, Math.min(horiz?h*0.30:h*0.18, 38));
    if(horiz) return [
      {x:x,       y:y,       w:pw,       h:h},
      {x:x+w-pw,  y:y,       w:pw,       h:h},
      {x:x+pw,    y:y,       w:w-2*pw,   h:bh},
    ];
    return [
      {x:x,       y:y,       w:w,        h:bh},
      {x:x,       y:y+h-pw,  w:w,        h:pw},
      {x:x,       y:y+bh,    w:Math.max(12,w*0.26), h:h-bh-pw},
    ];
  }
  if(shape==="hex"){
    /* v0.32.0：六边形用三条横带近似 —— 上窄、中全宽、下略窄，
       顶点大致对齐 raid-render 里 rock 的六边形绘制（0.24/0.62 顶边、0.94/0.84 底边）。
       玩家绕石头、子弹打石头、手电被石头挡住，都按这三条带子算。 */
    const t=Math.max(6, h*0.24);
    const midH=Math.max(2, h-2*t*0.88);
    return [
      { x:x+w*0.22, y:y,        w:w*0.66, h:t },
      { x:x,        y:y+t*0.88, w:w,      h:midH },
      { x:x+w*0.10, y:y+h-t,    w:w*0.80, h:t },
    ];
  }
  /* triple：缝宽取长轴的 18%（上限 56px），够 30px 的角色侧身穿过 */
  const gap=Math.min(56, (horiz?w:h)*0.18);
  const seg=( (horiz?w:h) - gap*2 )/3;
  if(seg<10) return [{x,y,w,h}];
  return horiz
    ? [0,1,2].map(i=>({ x:x+i*(seg+gap), y:y, w:seg, h:h }))
    : [0,1,2].map(i=>({ x:x, y:y+i*(seg+gap), w:w, h:seg }));
}

/* ---------------------------------------------------------------------------
 * 二、建筑结构：房间不再是「四堵墙围一个空盒子」
 * ---------------------------------------------------------------------------
 * 参考《消逝的光芒》的街区读法：楼体有翼楼 / 内院 / 断墙 / 连廊，
 * 从俯视图就能看出「哪里能穿、哪里是死角」。
 * 这里只**往房间里加内墙**，外墙与门洞仍由 _buildMap 原逻辑生成：
 *   · 不改变 roomRects / 门口走廊 / 刷怪 / 商店选点，风险最低；
 *   · 每段内墙都留 >=110px 通道，AI 寻路不会被封死；
 *   · deco 是纯视觉矩形（屋面 / 内院 / 瓦砾），不进碰撞索引。
 */
const RAID_ROOM_SHAPES = {
  /* L 形：切掉右上角做半开放装卸区，一道折角内墙 */
  L: (rm)=>{
    const T=16, ax=rm.x+rm.w*0.62, ay=rm.y+rm.h*0.55;
    return {
      walls:[
        {x:ax, y:rm.y+T, w:T, h:ay-rm.y-T-58},
        {x:ax, y:ay, w:rm.x+rm.w-ax-T, h:T},
      ],
      deco:[{x:ax+T, y:rm.y+T, w:rm.x+rm.w-ax-T*2, h:ay-rm.y-T*2, t:"yard"}],
    };
  },
  /* U 形：三面内墙围出朝下的内院，中间留门 */
  U: (rm)=>{
    const T=16, ix=rm.x+rm.w*0.24, iy=rm.y+rm.h*0.26, iw=rm.w*0.52, ih=rm.h*0.48;
    const gap=120;
    return {
      walls:[
        {x:ix, y:iy, w:iw, h:T},
        {x:ix, y:iy, w:T, h:ih},
        {x:ix+iw-T, y:iy, w:T, h:ih},
        {x:ix, y:iy+ih-T, w:(iw-gap)/2, h:T},
        {x:ix+(iw+gap)/2, y:iy+ih-T, w:(iw-gap)/2, h:T},
      ],
      deco:[{x:ix+T, y:iy+T, w:iw-T*2, h:ih-T*2, t:"courtyard"}],
    };
  },
  /* 回字：完整中庭，四面各留一处缺口 */
  courtyard: (rm)=>{
    const T=16, ix=rm.x+rm.w*0.22, iy=rm.y+rm.h*0.24, iw=rm.w*0.56, ih=rm.h*0.52, gap=112;
    const side=(x,y,w,h,horiz)=>{
      if(horiz) return [{x:x,y:y,w:(w-gap)/2,h:h},{x:x+(w+gap)/2,y:y,w:(w-gap)/2,h:h}];
      return [{x:x,y:y,w:w,h:(h-gap)/2},{x:x,y:y+(h+gap)/2,w:w,h:(h-gap)/2}];
    };
    return {
      walls:[ ...side(ix,iy,iw,T,true), ...side(ix,iy+ih-T,iw,T,true),
              ...side(ix,iy,T,ih,false), ...side(ix+iw-T,iy,T,ih,false) ],
      deco:[{x:ix+T,y:iy+T,w:iw-T*2,h:ih-T*2,t:"courtyard"}],
    };
  },
  /* 十字：两条带中央通道的隔断，把大厂房切成四间 */
  cross: (rm)=>{
    const T=16, cx=rm.x+rm.w/2, cy=rm.y+rm.h/2, gap=124;
    return {
      walls:[
        {x:cx-T/2, y:rm.y+T, w:T, h:(rm.h-gap)/2-T},
        {x:cx-T/2, y:cy+gap/2, w:T, h:(rm.h-gap)/2-T},
        {x:rm.x+T, y:cy-T/2, w:(rm.w-gap)/2-T, h:T},
        {x:cx+gap/2, y:cy-T/2, w:(rm.w-gap)/2-T, h:T},
      ],
      deco:[],
    };
  },
  /* 废墟：几段不闭合的断墙 + 瓦砾地面，视觉上「塌了一半」 */
  ruin: (rm)=>{
    const T=16;
    return {
      walls:[
        {x:rm.x+rm.w*0.30, y:rm.y+rm.h*0.18, w:T, h:rm.h*0.30},
        {x:rm.x+rm.w*0.30, y:rm.y+rm.h*0.18, w:rm.w*0.26, h:T},
        {x:rm.x+rm.w*0.62, y:rm.y+rm.h*0.58, w:rm.w*0.22, h:T},
        {x:rm.x+rm.w*0.62, y:rm.y+rm.h*0.58, w:T, h:rm.h*0.24},
      ],
      deco:[{x:rm.x+rm.w*0.18,y:rm.y+rm.h*0.62,w:rm.w*0.30,h:rm.h*0.20,t:"rubble"}],
    };
  },
  /* 塔楼：角上的小方楼 + 与主楼之间的一条连廊（纯视觉） */
  tower: (rm)=>{
    const T=16, tw=Math.min(120,rm.w*0.30), th=Math.min(120,rm.h*0.42);
    const tx=rm.x+rm.w-tw-T, ty=rm.y+T;
    return {
      walls:[
        {x:tx, y:ty, w:tw, h:T}, {x:tx, y:ty+th-T, w:tw, h:T},
        {x:tx, y:ty, w:T, h:th}, {x:tx+tw-T, y:ty, w:T, h:th},
      ],
      deco:[{x:rm.x+rm.w*0.18, y:rm.y+rm.h*0.72, w:rm.w*0.56, h:44, t:"walkway"}],
    };
  },
  /* 附楼：主楼一侧再接一栋，中间是带门洞的隔墙 */
  annex: (rm)=>{
    const T=16, ax=rm.x+rm.w*0.66, gap=116;
    return {
      walls:[
        {x:ax, y:rm.y+T, w:T, h:(rm.h-gap)/2-T},
        {x:ax, y:rm.y+rm.h/2+gap/2, w:T, h:(rm.h-gap)/2-T},
      ],
      deco:[{x:ax+T, y:rm.y+T, w:rm.w-ax-T*2, h:rm.h-T*2, t:"annex"}],
    };
  },
};
function raidRoomStructure(rm){
  const fn=RAID_ROOM_SHAPES[rm && rm.shape];
  return fn ? fn(rm) : null;
}

/* ---------------------------------------------------------------------------
 * 三、铁路跨河：轨道不能「泡在河里」
 * ---------------------------------------------------------------------------
 * 沿每条轨道按 40px 采样，找出连续落在河面（且没有被既有公路桥覆盖）的
 * 区间，为这段生成一座铁路桥桥面。桥面同时进 this.bridges —— _waterKind
 * 会把它当干地，玩家在桥上不涉水；渲染层再画成钢桁架桥而不是水下路基。
 */
function raidRailBridgeBoxes(rails, waterKind, half){
  const out=[];
  for(const rl of (rails||[])){
    for(let s=0;s<rl.pts.length-1;s++){
      const [x1,y1]=rl.pts[s], [x2,y2]=rl.pts[s+1];
      const len=Math.hypot(x2-x1,y2-y1), n=Math.max(1,Math.ceil(len/40));
      let a=null;
      for(let i=0;i<=n;i++){
        const t=i/n, x=x1+(x2-x1)*t, y=y1+(y2-y1)*t;
        const wet=waterKind(x,y)===1;
        if(wet && a===null) a=t;
        if((!wet || i===n) && a!==null){
          const b=t, sx=x1+(x2-x1)*a, sy=y1+(y2-y1)*a;
          const ex=x1+(x2-x1)*b, ey=y1+(y2-y1)*b;
          const cx=(sx+ex)/2, cy=(sy+ey)/2;
          const horizontal=Math.abs(x2-x1)>=Math.abs(y2-y1);
          out.push({ x:cx, y:cy,
            w:horizontal ? Math.abs(ex-sx)+160 : 104,
            h:horizontal ? 104 : Math.abs(ey-sy)+160,
            rail:true, big:false });
          a=null;
        }
      }
    }
  }
  return out;
}

/* ---------------------------------------------------------------------------
 * 四、各 POI 的主题装饰（v0.35.0）
 * ---------------------------------------------------------------------------
 * 用户要求「每个建筑各具自己独特的特点和装饰」，且之前把单个大招牌放在 POI
 * 合并框正中央 —— 而 rail / factory 这类 POI 是多个不相连建筑群的并集，几何
 * 中心落在建筑之间的空地甚至马路上；再加上安全半径只按短边算，大件必然戳进墙里，
 * 于是出现「建筑重叠 / 设施重叠」的观感。
 *
 * 改法：不再用「合并框中心 + 一个巨物」，而是给每个 POI 一套**主题装饰清单**
 * （RAID_POI_DECOR），建图时由 raid-core 按**每个房间内部**做非重叠装箱摆放：
 *   - 只在房间包围盒内、且避开墙体 / 门廊 / 已放装饰 / 战利品箱的位置落点
 *   - 大件先放、小件后放，多个房间分摊，因此每个建筑都有自己的一套特征物
 * 仍然走既有 _pushProp 管线，2D / 3D / 碰撞 / 视线 / 光照六处自动一致。
 *
 * 放在 geometry 而不是 raid-data：raid-data 已经贴着 2000 行拆分上限。
 */
const RAID_POI_DECOR = {
  /* 尺寸策略（v0.35.0）：房间内部大多已被墙体/家具切碎，超大件塞不进缝隙，
     且随机种子不同会导致大件时而放下、时而放不下（方差大）。因此：
     - 签名主件控制在「能进房间空档」的尺寸（宽 ≤172、高 ≤90）
     - 额外配 1–2 件小件（≤64）兜底：哪怕最窄的房间（大坝闸室 200x170、
       东码头集装箱堆场）也能稳定拿到 ≥2 件不重叠的主题装饰
     - 配合 raid-core 的「按房间非重叠装箱 + 候选步长 10」保证不重叠且稳定出件 */
  /* 大坝：水力枢纽 —— 泄洪管段 + 涡轮机房 + 备件箱 */
  dam: [
    { kind:"pipe",    w:104, h:36,  fill:"#3a4049", edge:"#14181d" },
    { kind:"machine", w:64,  h:64,  fill:"#2f3a36", edge:"#14181d" },
    { kind:"crate",   w:52,  h:52,  fill:"#5a4d36", edge:"#14181d" },
    { kind:"pipe",    w:76,  h:30,  fill:"#3a4049", edge:"#14181d" },
    { kind:"crate",   w:44,  h:44,  fill:"#5a4d36", edge:"#14181d" },
    { kind:"pipe",    w:64,  h:28,  fill:"#3a4049", edge:"#14181d" },
    { kind:"crate",   w:40,  h:40,  fill:"#5a4d36", edge:"#14181d" },
    { kind:"crate",   w:36,  h:36,  fill:"#5a4d36", edge:"#14181d" },
  ],
  /* 监狱：收容区 —— 隔离栏 + 囚室储物柜 + 讯问台 */
  prison: [
    { kind:"barrier", w:180, h:30,  fill:"#b6362f", edge:"#14181d" },
    { kind:"locker",  w:44,  h:82,  fill:"#3c4a52", edge:"#14181d" },
    { kind:"barrier", w:150, h:28,  fill:"#b6362f", edge:"#14181d" },
    { kind:"table",   w:100, h:54,  fill:"#4a3f33", edge:"#14181d" },
  ],
  /* 小镇：市集 —— 货摊货架 + 长椅 + 行道树 + 木箱 */
  town: [
    { kind:"shelf",   w:170, h:50,  fill:"#5a4a32", edge:"#14181d" },
    { kind:"table",   w:92,  h:50,  fill:"#4a3f33", edge:"#14181d" },
    { kind:"tree",    w:62,  h:62,  fill:"#2f4a2a", edge:"#14181d" },
    { kind:"crate",   w:52,  h:52,  fill:"#5a4d36", edge:"#14181d" },
    { kind:"shelf",   w:140, h:46,  fill:"#5a4a32", edge:"#14181d" },
  ],
  /* 铁路调度场：编组 —— 货车 + 信号机械 + 集装箱 + 木箱 */
  rail: [
    { kind:"railcar", w:172, h:62,  fill:"#33383f", edge:"#14181d" },
    { kind:"machine", w:76,  h:76,  fill:"#2f3a36", edge:"#14181d" },
    { kind:"container", w:100, h:84, fill:"#3a4a44", edge:"#14181d" },
    { kind:"crate",   w:52,  h:52,  fill:"#5a4d36", edge:"#14181d" },
  ],
  /* 采石场：爆破区 —— 崩落巨岩 + 碎石堆 + 钻机 + 小岩 */
  quarry: [
    { kind:"scrap",   w:104, h:78,  fill:"#4a4a44", edge:"#14181d" },
    { kind:"machine", w:76,  h:76,  fill:"#2f3a36", edge:"#14181d" },
    { kind:"rock",    w:84,  h:78,  fill:"#5a5e5a", edge:"#14181d" },
    { kind:"rock",    w:60,  h:56,  fill:"#5a5e5a", edge:"#14181d" },
  ],
  /* 机械工厂：车间 —— 机床 + 零件架 + 工作台 + 木箱 + 小机床 */
  factory: [
    { kind:"machine", w:90,  h:90,  fill:"#2f3a36", edge:"#14181d" },
    { kind:"shelf",   w:170, h:50,  fill:"#5a4a32", edge:"#14181d" },
    { kind:"table",   w:100, h:56,  fill:"#4a3f33", edge:"#14181d" },
    { kind:"crate",   w:52,  h:52,  fill:"#5a4d36", edge:"#14181d" },
    { kind:"machine", w:64,  h:64,  fill:"#2f3a36", edge:"#14181d" },
  ],
  /* 东码头：集装箱码头 —— 围栏 + 木箱（大件堆场里只塞得进小件） */
  dock: [
    { kind:"crate",    w:52,  h:52,  fill:"#5a4d36", edge:"#14181d" },
    { kind:"barrier",  w:120, h:26,  fill:"#8a7a4a", edge:"#14181d" },
    { kind:"crate",    w:44,  h:44,  fill:"#5a4d36", edge:"#14181d" },
    { kind:"sandbag",  w:60,  h:40,  fill:"#6a6048", edge:"#14181d" },
  ],
  /* 古神庙：遗迹 —— 断柱（rock）+ 倒下的门梁（barrier）+ 祭品箱 + 小岩 */
  temple: [
    { kind:"barrier", w:170, h:32,  fill:"#8a7a4a", edge:"#14181d" },
    { kind:"crate",   w:56,  h:56,  fill:"#6a5a3a", edge:"#14181d" },
    { kind:"rock",    w:78,  h:74,  fill:"#6a6452", edge:"#14181d" },
    { kind:"rock",    w:60,  h:56,  fill:"#6a6452", edge:"#14181d" },
  ],
};
