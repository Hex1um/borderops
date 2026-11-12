/* =========================================================================
 * raid-ai.js — 塔科夫 AI 的「感知 / 转向 / 目标选举」
 * v0.41.0：从 raid-core2.js 拆出（该文件已顶到 2000 行上限），并做专项优化：
 *
 *  ① 目标选举由「每帧重新比大小」改成「黏性续锁」。
 *     旧版把候选逐帧打分重排，注意锥 / 视线在边缘（光锥边、掩体拐角）会真假翻转，
 *     于是 tgt 在玩家与附近 AI 之间来回切 —— 实测 10 秒内 133 次，光锥跟着左右甩，
 *     这就是玩家反复反馈的「视角跳动」。现在只要当前目标还活且「最近确实感知过」，
 *     就直接续锁，不再参与竞争。
 *  ② 转向由一阶 lerp 改成二阶（角速度加速 / 减速）。旧版起步即最大角速度、到点急停，
 *     看着像机械摇臂；现在约 0.12s 加速到位、临到目标角收住，光锥扫过去有轻重。
 *  ③ 目标位置快照统一在帧初做一次。旧版在每个 AI 的 engage 分支里写 tgt._px，
 *     多个 AI 共用同一目标时，第一个把值更新掉、后面的全算出速度 0，预判点各算各的。
 * ========================================================================= */

/* 帧初快照：所有单位上一帧的位置。engage 分支的弹道预判靠它算目标速度。
 * 必须在任何 AI 转向之前跑完（否则同一目标会被第一个处理它的 AI 覆盖）。 */
function raidAiSnapshot(R){
  const snap=(o)=>{ if(!o || !o.alive) return; o._px=o.x; o._py=o.y; };
  snap(R.player);
  const ops=R.ops;
  for(let i=0;i<ops.length;i++) snap(ops[i]);
}

/* 目标选举。
 * 返回 { tgt, locked }：locked 表示「正在打我的人」（优先级最高、不吃黏性）。
 *
 * 判定层级（越靠前越硬）：
 *   1. 受击锁定 —— 3 秒内打过我的单位，直接抢目标（玩家必须先自保，AI 也是）。
 *   2. 续锁 —— 上一帧目标还活着，且「最近感知过」（感知保持窗 / 最后已知点 / 此刻注意锥成立），
 *      只要有视线就继续用它。注意这里**不要求注意锥逐帧成立**，因为光锥边缘的翻转正是抖动之源。
 *   3. 新候选 —— 按 score = 距离 + 阵营优先级 + 黏性比较，玩家 720px 内额外 -2000。
 *   4. 都没有 —— 保留旧目标（还活着就用），否则退回玩家（后续 aware 判定会拦住「隔墙追人」）。
 */
function raidAiPickTarget(R, b, sense){
  const prev=(b._tgt && b._tgt!==b && b._tgt.alive) ? b._tgt : null;
  const sight=sense.sight;

  const hostile=(o)=>{
    if(!o || o===b || !o.alive || o.ghost) return false;
    if(o.isPlayer || o.remote) return true;                              // 玩家永远是敌人
    if(b.bounty || o.bounty) return true;                                // Boss 敌对所有
    if(b.cls==="scav" && o.cls==="scav") return false;                   // 流浪 Scav 之间友好
    if(o.squadId && o.squadId===b.squadId) return false;                 // 同小队不互打
    return true;
  };

  let lock=null, lockD=Infinity;      // 受击锁定
  let best=null, bestScore=Infinity;  // 普通候选

  const see=(o)=>{
    if(!hostile(o)) return;
    const dd=M.dist(b.x,b.y,o.x,o.y);
    if(dd>sight) return;
    if(raidHitLocked(b,o)){ if(dd<lockD){ lockD=dd; lock=o; } return; }
    const sticky=(o===prev);
    /* 续锁的「已知」三条来源：感知保持窗、未过期的最后已知点、此刻注意锥。
       任一条成立就允许不重新过注意锥 —— 但视线（_los）依然必须通，不许隔墙锁人。 */
    const known = sticky && ((b._seenHold||0)>0 || !!b.lastSeen || R._aiNotice(b,o.x,o.y));
    if(!known && !R._aiNotice(b,o.x,o.y)) return;
    if(!R._los(b.x,b.y,o.x,o.y)) return;
    const pri=(o.isPlayer||o.remote) ? (dd<720 ? -2000 : 0) : 0;
    /* 黏性 260px：与「距离」同一量纲。近处 AI 想抢走目标，得比当前目标近 260px 以上，
       而且还得这一帧恰好通过注意锥 —— 概率低到不会逐帧来回切。 */
    const score=dd+pri+(sticky?-260:0);
    if(score<bestScore){ bestScore=score; best=o; }
  };

  const ops=R.ops;
  for(let i=0;i<ops.length;i++) see(ops[i]);
  if(R.player && ops.indexOf(R.player)<0) see(R.player);

  if(lock) return { tgt:lock, locked:true };
  if(best) return { tgt:best, locked:false };
  if(prev) return { tgt:prev, locked:false };
  return { tgt:R.player, locked:false };
}

Object.assign(Raid, {
  /* 按 dt 归一化的平滑转向（v0.41.0 起为二阶）。
   *  - perFrameRate：60fps 下每帧向目标靠拢的比例（换算成帧率无关形式）
   *  - maxTurn：角速度上限（rad/s），防止目标乱动时光锥被甩出去
   *  - 内部维护 b._angVel：角速度有加速 / 减速，起步与收尾都不是硬的 */
  _face(b, targetAngle, perFrameRate, dt, maxTurn){
    const cur=b.angle||0;
    const d=M.normAngle(targetAngle-cur);
    const cap=maxTurn||6.0;
    const ad=Math.abs(d);
    if(ad<0.006 && Math.abs(b._angVel||0)<0.06){ b.angle=M.normAngle(cur); b._angVel=0; return; }
    const t=1-Math.pow(1-M.clamp(perFrameRate||0.14, 0.001, 0.99), Math.max(0.0001, dt*60));
    /* 期望角速度：本帧该转的角度 / dt，再被 maxTurn 夹住 */
    let want=M.clamp(d*Math.min(1,t)/Math.max(0.0001,dt), -cap, cap);
    /* 二阶：角速度按角加速度逼近期望值（cap×9 ≈ 0.11s 到顶），临到目标角再收住 */
    const acc=cap*9, v0=b._angVel||0;
    let v=v0+M.clamp(want-v0, -acc*dt, acc*dt);
    /* 收尾钳制：剩余角度不够时把速度压到「刚好走完」。这里必须再和 cap 取 min ——
       否则 dt 很小时 (ad/dt) 会远大于上限（实测能到 45 rad/s 的等效角速度）。 */
    if(Math.abs(v)*dt>ad) v=(v>0?1:-1)*Math.min(cap, (ad/Math.max(0.0001,dt))*0.9);
    b._angVel=v;
    b.angle=M.normAngle(cur+v*dt);
  },

  /* AI 感知判定 —— **用视线（_rayWall，灌木不挡）**，不再用手电光路（_rayLight，灌木挡光）。
   * 手电仍然决定「能看多远 / 多宽」（reach + aiHalf），但一丛灌木不该让 AI 完全看不见 2 米外的人。
   * 近距离（<near）放宽到 360°：贴脸时不该因为目标在侧面就把人当空气。 */
  _aiAware(b, x, y){
    if(!b) return false;
    const reach=(typeof raidAiBeamReach==="function") ? raidAiBeamReach(b) : 560;
    const dx=x-b.x, dy=y-b.y, d=Math.hypot(dx,dy);
    if(d>reach || d<1) return false;
    if(d>110){
      const off=Math.abs(M.normAngle(Math.atan2(dy,dx)-(b.angle||0)));
      if(off>RAID_LIT.aiHalf) return false;
    }
    return this._los(b.x,b.y,x,y);
  },

  /* 外围「注意锥」—— 只用来**转身对焦**，不用来开火。
   * _aiAware 只认光锥（0.55rad）内的目标，光锥外的人根本进不了候选，AI 也就不会转身；
   * 这里给一个更宽的锥（近距离几乎全向、远处仍要求目标在手电附近），
   * 命中后 AI 会朝目标转身；真正开火仍由 _aiAware（窄锥）决定。 */
  _aiNotice(b, x, y){
    if(!b) return false;
    const reach=(typeof raidAiBeamReach==="function") ? raidAiBeamReach(b) : 560;
    const dx=x-b.x, dy=y-b.y, d=Math.hypot(dx,dy);
    if(d>reach || d<1) return false;
    /* 320px 内注意角从 0.55 线性放宽到 1.30（≈74°）；再远就纯看光锥。 */
    const extra=M.clamp((320-d)/320, 0, 1)*0.75;
    if(Math.abs(M.normAngle(Math.atan2(dy,dx)-(b.angle||0))) > RAID_LIT.aiHalf+extra) return false;
    return this._los(b.x,b.y,x,y);
  },
});
