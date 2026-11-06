/* =========================================================================
 * raid-core3.js — 主控 Raid（方法续接 · 第 3 段）
 * v0.22.0：由 raid.js 按自然边界物理拆分，逻辑零改写。经典脚本按 index.html 顺序加载，
 * 共享同一全局词法作用域。verify 的 raidSrc 会聚合全部 raid-*.js 做源码断言。
 * ========================================================================= */
Object.assign(Raid, {

  _botTakeItem(b, it){
    if(!it) return;
    // Scav 的装备上限：即使翻到高阶箱，也不会换掉手里的低阶枪 / 甲。
    if(b.cls==="scav"){
      if(it.kind==="weapon"){
        const ri=RARITIES.findIndex(r=>r.id===it.rarity);
        if(!SCAV_GUN_TYPES.includes(it.type) || (it.ilvl||0)>SCAV_GUN_ILVL_MAX || ri>2) return;
      }
      if(it.kind==="armor" && (it.tier||0)>SCAV_ARMOR_TIER_MAX) return;
      if(it.kind==="helmet" && (it.tier||0)>SCAV_HELMET_TIER_MAX) return;
      if(it.kind==="shield") return;
    }
    if(it.kind==="weapon"){
      if(!b.gun){
        b.gun=Object.assign({}, it); b.gun.ammoMag=b.gun.mag; b.gun.ammoRes=b.gun.reserve;
        return;
      }
      if((it.value||0) > (b.gun.value||0)*1.02 || (it.dmg||0) > (b.gun.dmg||0)*1.15){
        if((b.gun.value||0) > 0 && b.inv.weapons.length<2) b.inv.weapons.push(b.gun);
        b.gun=Object.assign({}, it); b.gun.ammoMag=b.gun.mag; b.gun.ammoRes=b.gun.reserve;
      } else if(b.inv.weapons.length<2) b.inv.weapons.push(it);
      return;
    }
    if(it.kind==="armor"){
      if(!b.armorTier || it.dr>b.dr+0.02){
        if(b.armorTier && b.inv.armors.length<2)
          b.inv.armors.push({uid:"aiar"+Math.floor(Math.random()*1e9).toString(36),kind:"armor",tier:b.armorTier,
            name:RAID_ARMORS[b.armorTier].name,rarity:0,dr:b.dr,maxArmor:b.maxArmor,value:RAID_ARMORS[b.armorTier].value});
        b.armorTier=it.tier; b.dr=it.dr; b.maxArmor=it.maxArmor; b.armor=it.maxArmor;
        b.armorBroken=false;   // v0.14.11：换上新甲后重新允许纳米自愈 / 恢复装甲型
      } else if(b.inv.armors.length<2) b.inv.armors.push(it);
      return;
    }
    if(it.kind==="helmet"){
      if(!b.helmetTier || it.dr>b.helmetDr+0.02){
        b.helmetTier=it.tier; b.helmetDr=it.dr; b.maxHelmetArmor=it.maxArmor; b.helmetArmor=it.maxArmor;
      } else if(b.inv.helmets.length<1) b.inv.helmets.push(it);
      return;
    }
    if(it.kind==="part" && b.inv.parts.length<4){ b.inv.parts.push(it); return; }
    if(it.kind==="med"){ b.bandages=(b.bandages||0)+1; return; }
  },

  /* 枪声扩散：范围内的 AI 记下声源位置，冲过去查看 */
  _noise(x, y, r, src){
    for(const b of this.ops){
      if(b===src || !b.alive || b.isPlayer || b.remote || b.ghost) continue;
      if(b.state==="engage" || b.state==="heal") continue;
      if(!b.gun) continue;            // 空手的 AI 忙着找枪，听到枪声也不去送
      if(this.online && !Net.isHost) continue;
      if(M.dist(b.x,b.y,x,y) > r*raidAISense(b).hear) continue;   // 枪声听距按索敌等级缩放
      // 已经有更近的线索就不覆盖
      if(b.investigate && b.investigate.t>2.5) continue;
      b.investigate={ x:x+RNG.fr(-80,80), y:y+RNG.fr(-80,80), t:RNG.fr(7,12) };   // 听到动静后追得更久
    }
  },

  _nearestFoe(o, range){
    let best=null, bd=range*range;
    for(const e of this.ops){
      if(e===o||!e.alive) continue;
      const dd=M.dist2(o.x,o.y,e.x,e.y);
      if(dd<bd && this._los(o.x,o.y,e.x,e.y)){ bd=dd; best=e; }
    }
    return best;
  },

  _nearestContainer(x,y,range){
    let best=null, bd=range*range;
    for(const c of this.containers){
      if(c.searched) continue;
      const dd=M.dist2(x,y,c.x,c.y);
      if(dd<bd){ bd=dd; best=c; }
    }
    // 地面物品堆同样可以按 E 拾取
    for(const c of (this.grounds||[])){
      if(c.searched) continue;
      const dd=M.dist2(x,y,c.x,c.y);
      if(dd<bd){ bd=dd; best=c; }
    }
    return best;
  },

  /* v0.14.11：子弹命中的小范围溅射（爆炸元素 / splash 词缀）。
   * 主目标已在 _fire 里吃过全额直伤，这里只打周围最多 3 个目标，不再触发元素效果。 */
  _bulletSplash(hit, dmg, sh, gun){
    const R=M.clamp(gun.splash||90,60,180);
    let n=0;
    for(const o of this.ops){
      if(n>=3) break;
      if(!o.alive || o===hit || o===sh || o.remote || o.ghost) continue;
      const dd=M.dist(hit.x,hit.y,o.x,o.y);
      if(dd>R) continue;
      const fall=M.clamp(1-dd/R*0.5,0.5,1);
      this._damage(o, dmg*0.35*fall, sh, {element:"none",armorPen:gun.armorPen}, {chain:true, blast:true});
      n++;
    }
    if(n>0){
      for(let i=0;i<6;i++){ const a=Math.random()*6.28, s=Math.random()*90+20;
        this.particles.push({x:hit.x,y:hit.y,vx:Math.cos(a)*s,vy:Math.sin(a)*s,
          life:0.35,maxLife:0.35,color:i%2?"#ffd23f":"#ff7a1f",size:2.6}); }
      this.blasts.push({x:hit.x,y:hit.y,r:R*0.35,life:0.22,maxLife:0.22});
    }
  },

  /* ----------------------------- 射击 / 伤害 ----------------------------- */
  _fire(sh, angle, game){
    if(sh.fireCd>0 || sh.reloadT>0) return;
    if(!sh.gun) return;
    if(sh.gun.ammoMag<=0){ this._startReload(sh); return; }
    sh.gun.ammoMag--;
    sh.fireCd = 60/Math.max(40, sh.gun.rpm);
    /* v0.21.2：开火动画状态 —— 2D 手持模型与 3D 视图模型共用
     *   muzzleT：枪口火光剩余时间（很短，打一枪闪一下）
     *   kick   ：后坐冲量（0→约 2，按 dt*11 衰减），驱动枪身后退 + 上跳 + 抖动 */
    sh.muzzleT = 0.075;
    sh.kick = Math.min(2.2, (sh.kick||0) + 1);
    // v0.14.11：电磁干扰期间射速被强制压到最低 SHOCK_FIRE_CD 间隔（电击的持续效果）
    if(sh.shockT>0) sh.fireCd=Math.max(sh.fireCd, SHOCK_FIRE_CD);
    // 枪声传得远：附近待机的 AI 会摸过来（全局节流，避免每发子弹都算一遍）
    this._nzT=(this._nzT||0)+1;
    if(this._nzT%3===0 && !sh.ghost && (sh.isPlayer || !sh.remote))
      this._noise(sh.x, sh.y, sh.isPlayer?1200:820, sh);   // 枪声传得更远，更多 AI 会摸过来
    if(sh.isPlayer){ this.spawnGrace=0; SFX.shoot(); }   // 先开枪就先暴露
    // 联机：房主把 AI 开火广播给客户端（只画弹道，不重复结算伤害）
    if(this.online && typeof Net!=="undefined" && Net.isHost && !sh.isPlayer && !sh.ghost && !sh.remote)
      Net.maybeSendShot(sh, angle);

    // 火箭筒：发射慢速火箭弹（命中/撞墙后范围爆炸），不走射线
    if(sh.gun.cat==="launcher"){
      this.rockets.push({ x:sh.x, y:sh.y, ang:angle, speed:240, dmg:sh.gun.dmg,
        splash:Math.max(96, sh.gun.splash||120), owner:sh, gun:sh.gun, life:3.4,
        color:sh.gun.color||"#ffb020", trail:[] });
      return;
    }

    const pellets = sh.gun.pellets || 1;
    /* 非霰弹枪的「双发的 / 蜂群的」是稀有词条，不是「8 颗霰弹」：
     * 总伤害只提升 30%，平均分摊到每颗弹丸（2 发 0.65×、3 发 0.433×），
     * 换来的收益是更多命中判定 / 特殊弹触发机会，而不是直接 1.8 倍 DPS。 */
    const pelletMul = pellets<=1 ? 1
      : ((sh.gun.type==="shotgun"||sh.gun.cat==="shotgun") ? 0.9 : (1.30/pellets));
    const mv = sh._mv||0;
    const moveMul = moveSpreadMul(sh.gun.cat, mv);
    const baseSpread = sh.gun.spread * (sh.isPlayer?1.0:2.0) * 2.3;   // AI 命中率上调（6.24x → 4.6x）
    for(let k=0;k<pellets;k++){
      let spread = baseSpread * moveMul;
      if(mv>0.05 && !isSMG(sh.gun.cat)) spread = Math.min(spread, Math.max(baseSpread*1.35, moveSpreadCap(sh.gun.cat)));
      const a = angle + (Math.random()-0.5)*spread*2;
      const range = sh.gun.range;
      const ex = sh.x+Math.cos(a)*range, ey = sh.y+Math.sin(a)*range;
      const wh = this._rayWall(sh.x, sh.y, ex, ey);
      let cut = wh ? wh.t : 1;
      const bx = sh.x + (ex-sh.x)*cut, by = sh.y + (ey-sh.y)*cut;

      let hit=null, hitDist=Infinity;
      for(const o of this.ops){
        if(o===sh || !o.alive) continue;
        const dd=this._pointSeg(o.x,o.y, sh.x,sh.y, bx,by);
        if(dd < o.r+2){ const d2=M.dist(sh.x,sh.y,o.x,o.y); if(d2<hitDist){ hitDist=d2; hit=o; } }
        else if(dd < 200 && !o.isPlayer && !o.remote && !o.ghost){
          // 子弹从身边飞过 → 侧向急闪（朝自己所在的一侧躲开弹道）
          const cross=(o.x-sh.x)*Math.sin(a)-(o.y-sh.y)*Math.cos(a);
          o._dodgeT=Math.max(o._dodgeT||0, o.smart?0.55:0.38);
          o._dodgeSide=cross>=0?1:-1;
        }
      }
      let hx=bx, hy=by;
      if(hit){
        hx=hit.x; hy=hit.y;
        const falloff = M.clamp(1 - hitDist/range*0.45, 0.55, 1);
        const dmg = sh.gun.dmg * falloff * pelletMul;
        if(this.online && hit.ghost && typeof Net!=="undefined" && !Net.isHost){
          // 影子 AI：本地只放命中特效，血量由房主权威结算
          Net.sendHitAI(hit.id, dmg, sh.gun && gunNameOf(sh.gun));
          this._float(hit.x, hit.y-24, "-"+Math.round(dmg), "#ffd36a");
          this.spawnHit(hit.x, hit.y, "#ff9a5a");
        } else if(hit.remote){
          // 玩家间 PvP 开启 —— 打中远程玩家照常结算，伤害经 Net.sendDamage 转发给对方本地扣血
          this.spawnHit(hit.x, hit.y, "#7fd0ff");
          this._float(hit.x, hit.y-24, "-"+Math.round(dmg), "#ff8a5a");
          this._damage(hit, dmg, sh, sh.gun);
        } else {
          this._damage(hit, dmg, sh, sh.gun);
          /* v0.14.11：爆炸元素 / splash 词缀的普通子弹也要有范围溅射。
           * 之前只有火箭筒走 _explodeRocket，普通爆炸枪只是 ×1.20 平伤，
           * 元素描述「范围溅射」和 splash 系词缀在突袭里全是死的。 */
          if(sh.gun.cat!=="launcher" && (sh.gun.element==="explosive" || (sh.gun.splash||0)>0))
            this._bulletSplash(hit, dmg, sh, sh.gun);
        }
      }
      this.tracers.push({ x1:sh.x, y1:sh.y, x2:hx, y2:hy, bx:sh.x, by:sh.y, life:0.08, maxLife:0.08,
        laser: !!sh.gun.laser, shape: sh.gun.projShape||"round",
        color: sh.gun.color || (sh.isPlayer?"#ffe08a":"#ff7a5a") });
    }
  },

  /* opts.chain = 由辐射连锁触发的二次伤害，不再继续连锁，避免无限递归 */
  _damage(target, dmg, attacker, gun, opts){
    opts=opts||{};
    if(!target.alive) return;
    /* v0.16.0：破盾无敌期间完全免伤（飘字节流，连发不刷屏） */
    if((target.shieldInvuln||0)>0){
      if(this.elapsed-(target._ivTipT||-99)>0.35){
        target._ivTipT=this.elapsed;
        this._float(target.x,target.y-52,"无敌","#7be3ff");
      }
      return;
    }
    /* AI 互殴伤害折减：全图 AI 会自己打起来，但一轮交火不该两分钟清场。
     * （玩家打 AI 不受影响，AI 打玩家也不受影响） */
    if(attacker && !attacker.isPlayer && !attacker.remote
       && !target.isPlayer && !target.remote && target.id!=="you") dmg *= 0.45;   // v0.14.6：AI 互殴折减加深，避免 AI 自己清场
    // 远端玩家：伤害由对方本地结算（只有他知道自己的护甲/血量），这里只转发。
    // v0.14.10：元素克制 / 冰冻只在「本地结算侧」生效，避免联机两端重复计算。
    if(target.remote && this.online && typeof Net!=="undefined"){
      Net.sendDamage(target.peerId||String(target.id||"").replace(/^net_/,""), dmg, attacker&&attacker.name);
      return;
    }
    let d=dmg;
    /* v0.23.0：防盾手正面挡弹。
       命中方向落在目标正面 ±58° 内就吃 72% 减伤；绕到背后打完全免疫，爆炸（opts.blast）无视盾面。
       判定用「目标→攻击者」与「目标朝向」的夹角，所以侧面 90° 已经是满伤 ——
       玩家不需要精确绕背，只要别正对着他站桩对枪。 */
    { const _ar = target.arch ? RAID_ARCH[target.arch] : null;
      if(_ar && _ar.frontShield>0 && attacker && !opts.blast){
        const toA=Math.atan2(attacker.y-target.y, attacker.x-target.x);
        const rel=Math.abs(M.normAngle(toA-(target.angle||0)));
        if(rel < Math.PI*0.32){
          d *= (1-_ar.frontShield);
          if((this.elapsed-(target._shieldTipT||-99))>0.9){
            target._shieldTipT=this.elapsed;
            this._float(target.x,target.y-56,"盾面挡下","#8a93a6");
          }
        }
      }
    }
    const _armorAtHit=target.armor||0;   // v0.14.11：用于判定「护甲是否在本次命中被打穿」

    /* ---------------- v0.14.10 元素克制 ---------------- */
    const elem=(gun && gun.element && ELEMENTS[gun.element]) ? gun.element : "none";
    const at=raidArmorType(target);
    const eMul=elemMult(elem, at);
    /* v0.20.0：子弹级别带来的整体威力（T1 1.00 → T5 1.30），叠在终点效应倍率之外 */
    const pow=(gun && gun.power) ? gun.power : 1;
    d*=eMul*pow;
    const E=elem!=="none"?ELEMENTS[elem]:null;
    const dmgCol=E?E.color:(target.isPlayer?"#ff6a6a":"#ffd36a");

    /* ---------------- v0.14.11 元素持续效果 ----------------
     * 之前 ELEMENTS.dot 只是摆设（火焰/腐蚀 6、辐射 5），元素之间除了倍率没有任何玩法差异：
     *   火焰   → 叠加灼烧 DOT（每秒按本次命中原始伤害结算，最长 4.5s，约 +27% 总伤）
     *   腐蚀   → 立刻啃护甲耐久 + 3s 破甲（期间护甲减伤 ×0.75），打穿后回归血肉型
     *   电击   → 1.6s 电磁干扰（强制拉长开火间隔 / 打断瞄准），另额外削护盾
     *   辐射   → 命中后向附近单位连锁，连锁伤害不再二次触发连锁
     * 状态只在权威结算侧写入；远端玩家 / 影子 AI 走上面的转发分支，不会重复结算。 */
    if(d>0 && E){
      /* dotK 随子弹级别递减：高级弹靠穿深，不靠烧灼 */
      const dotK=((E.dot||0)/6)*((gun && gun.dotK!==undefined) ? gun.dotK : 1);
      if(elem==="fire" && dotK>0){
        const fresh=(target.burnT||0)<=0;
        target.burnT=Math.min(BURN_CAP,(target.burnT||0)+BURN_ADD*dotK);
        // 用克制后伤害 d 结算 DOT，避免「火焰对装甲 ×0.70、但灼烧照全额跳」绕过抗性
        target.burnDps=Math.max(target.burnDps||0, d*BURN_DPS_RATE*dotK);
        target.burnSrc=attacker||null;
        if(fresh) this._float(target.x,target.y-58,"引燃 "+target.burnT.toFixed(1)+"s","#ff8a3a");
      } else if(elem==="corrosive" && dotK>0){
        const before=target.armor||0;
        const bite=Math.min(before, d*CORRODE_BITE*dotK);
        if(bite>0) target.armor=before-bite;
        target.corrodeT=Math.max(target.corrodeT||0, CORRODE_TIME);
        if(bite>0 && (this.elapsed-(target._armorTipT||-99))>0.8){
          target._armorTipT=this.elapsed;
          this._float(target.x,target.y-58,"撕裂破甲 -"+Math.round(bite),"#9bff5a");
        }
      } else if(elem==="radiation"){
        target.radT=Math.max(target.radT||0,0.7);
      } else if(elem==="shock"){
        const fresh=(target.shockT||0)<=0;
        target.shockT=Math.max(target.shockT||0,SHOCK_TIME);
        if(target.shield>0) target.shield=Math.max(0,target.shield-d*0.6);   // 电击额外击穿护盾
        if(fresh && !target.isPlayer) this._float(target.x,target.y-58,"电磁干扰","#7be3ff");
      }
    }
    // 玩家命中时按目标节流给一句克制 / 抗性反馈，连发不刷屏
    if(attacker && attacker.isPlayer && elem!=="none" && Math.abs(eMul-1)>0.05
       && this.elapsed-(target._elemTipT||0)>0.55){
      target._elemTipT=this.elapsed;
      const tip=(eMul>1?"克制 ×":"抗性 ×")+eMul.toFixed(2);
      this._float(target.x, target.y-40, (E?E.name:"")+" "+tip, eMul>1?(E?E.color:"#ffd23f"):"#9aa4b2");
    }
    // 冰冻命中：叠加冻结时间并撒冰晶（视觉在 unit() 里绘制）
    if(elem==="cryo" && d>0){
      target.freezeT=Math.min(2.8, (target.freezeT||0)+1.4);
      this._freezeBurst(target.x, target.y);
    }

    /* ---------------- v0.14.10 护甲 / 头盔：乘法律叠加 ---------------- */
    // 护甲穿透：高穿甲武器能显著削弱高级护甲的减伤（T8 也不是无敌）
    const pen = (gun && gun.armorPen!==undefined) ? gun.armorPen : 0.10;
    const penMul = 1 - pen*0.90;
    // 头部命中（15%）：伤害 ×1.8，头盔对爆头全额生效
    const headshot=RNG.chance(0.15);
    if(headshot) d*=1.8;
    // 能量护盾优先于护甲吸收（护盾型 → 蓝色血条，被电击克制）。护盾破了才轮到护甲 / 头盔。
    const hadShield=(target.shield||0)>0;
    if(hadShield){
      const mul=target.shieldAbsorbMul||1;
      const sAbs=Math.min(target.shield*mul,d);
      target.shield=Math.max(0,target.shield-sAbs/mul); d-=sAbs;
      if(sAbs>0 && target.isPlayer) this._float(target.x,target.y-52,"护盾 -"+Math.round(sAbs),"#7be3ff");
      if(target.shield<=0){
        const iv=target.shieldInvulnBase||0;
        target.shieldInvuln=Math.max(target.shieldInvuln||0,iv);
        this._float(target.x,target.y-70,iv>0?`护盾破裂 · 无敌 ${iv.toFixed(2)}s`:"护盾破裂","#4fd6ff");
        if(target.isPlayer && iv>0) this._feed("防护",`护盾破裂 · ${iv.toFixed(2)}s 无敌`,"",false,"info");
        if((target.shieldPerks||[]).includes("surge")) this._shieldSurge(target);
      }
    }
    // 任何一次受击都把「多久没挨打」重新计时 —— 这就是充能延迟的定义
    if(target.maxShield>0) target.shieldTimer=target.shieldDelay||0;
    // p = 护甲减伤，q = 头盔减伤；总减伤 = 1-(1-p)(1-q)，不再线性相加成 1-p-q。
    // 头盔对非爆头按 HELMET_BODY_SHARE 计入，因此也能「减少一定的非暴击伤害」。
    // v0.14.11：腐蚀破甲期间护甲减伤打七五折，让「溶解装甲」有实感。
    const corrodeMul=(target.corrodeT||0)>0?CORRODE_DR:1;
    const p=M.clamp((target.dr||0)*penMul*corrodeMul, 0, 0.92);
    const q=M.clamp((target.helmetDr||0)*penMul*(headshot?1:HELMET_BODY_SHARE), 0, 0.92);
    const totalDr=1-(1-p)*(1-q);
    const absorbWant=d*totalDr;                          // 两件装备合计应吸收的伤害
    const armorWant=Math.max(0, d*p);                   // 护甲先吸收
    const helmWant=Math.max(0, absorbWant-armorWant);   // 头盔吸收护甲没挡下的那部分里的份额
    let armorAbs=0, helmAbs=0;
    if(armorWant>0 && target.armor>0){
      armorAbs=Math.min(target.armor, armorWant);
      const plateMul=(hadShield && (target.shieldPerks||[]).includes("plate"))?0.65:1;
      target.armor-=armorAbs*plateMul;
    }
    if(helmWant>0 && target.helmetArmor>0){
      helmAbs=Math.min(target.helmetArmor, helmWant);
      target.helmetArmor-=helmAbs;
    }
    d-=armorAbs+helmAbs;
    if(headshot && helmAbs>0 && target.isPlayer)
      this._float(target.x, target.y-52, "头盔 -"+Math.round(helmAbs), "#8fd0ff");
    /* v0.14.11 改2：T4+ 护甲耐久归零 → 不再是装甲型（黄条转红、腐蚀克制失效）。
     * 一次性提示，避免连发刷屏；HUD 的防护类型行会同步变成「无防护」。 */
    if(_armorAtHit>0 && (target.armor||0)<=0 && (target.armorTier||0)>=RAID_ARMOR_TYPE_TIER){
      target.armorBroken=true;   // 报废后不再纳米自愈，类型稳定停留在血肉
      this._float(target.x,target.y-72,"护甲击穿 · 转为无防护","#ffd23f");
      if(target.isPlayer) this._feed("防护", "护甲耐久耗尽 · 已转为无防护", "", false, "warn");
    }
    const absorbedAll=hadShield && d<=0;
    d=absorbedAll?0:Math.max(1,Math.round(d));
    if(d<=0){
      // 伤害被护盾完全吸收：不扣血、不触发流血，但跳弹连锁仍按原命中结算
      if(elem==="radiation" && !opts.chain && dmg>0) this._chainRadiation(target,dmg,attacker,gun);
      return;
    }
    target.hp-=d;

    if(target.isPlayer){
      this.hitFlash=Math.min(0.35, this.hitFlash+0.18);
      SFX.hurt();
      this._float(target.x, target.y-24, "-"+Math.round(d), "#ff6a6a");
      // 塔科夫式流血：被击中有几率开始流血（最多叠 3 层）
      if(dmg>0 && RNG.chance(0.30) && target.bleed<3){
        target.bleed++;
        this._float(target.x, target.y-40, "⚠ 流血 x"+target.bleed+"（H/医疗键 包扎）", "#ff8a5a");
      }
      if(target.hp<=0){
        target.hp=0; target.alive=false;
        this._fail("阵亡", attacker, gun);
      }
    } else {
      /* 被击中立刻锁定攻击者（转身 + 摸过去还击）。
       * 玩家 / 远端玩家打它、或 AI 互殴都生效；友善关系由索敌逻辑决定，这里只负责「注意到」攻击者 */
      if(attacker && attacker!==target && !attacker.ghost){
        target.lastSeen={ x:attacker.x, y:attacker.y, t:raidAISense(target).memory };
        target.investigate={ x:attacker.x, y:attacker.y, t:Math.max((target.investigate&&target.investigate.t)||0, 6.5) };
      }
      this._float(target.x, target.y-24, "-"+Math.round(d), dmgCol);
      this.spawnHit(target.x, target.y, dmgCol);
      if(target.hp<=0){
        target.hp=0; target.alive=false;
        this._onBotDeath(target, attacker);
      }
    }
    // 辐射连锁：命中后向周围 RAD_MAX 个单位传导 RAD_FACTOR 倍伤害，二次命中不再连锁。
    if(elem==="radiation" && !opts.chain && dmg>0) this._chainRadiation(target,dmg,attacker,gun);
  },

  /* v0.14.11：辐射连锁 —— 不打自己 / 攻击者 / 远端玩家（远端由对方本地结算），
   * 只挑最近的活单位，附一道绿色链路特效，伤害不再带元素倍率二次放大。 */
  _chainRadiation(origin, dmg, attacker, gun){
    const near=[];
    for(const o of this.ops){
      if(!o.alive || o===origin || o===attacker || o.remote || o.ghost) continue;
      const dd=M.dist(origin.x,origin.y,o.x,o.y);
      if(dd<=RAD_RADIUS) near.push({o,dd});
    }
    near.sort((a,b)=>a.dd-b.dd);
    for(const {o} of near.slice(0,RAD_MAX)){
      this.tracers.push({ x1:origin.x, y1:origin.y, x2:o.x, y2:o.y, bx:origin.x, by:origin.y,
        life:0.18, maxLife:0.18, laser:false, shape:"round", color:"#c8ff32" });
      this.spawnHit(o.x,o.y,"#c8ff32");
      this._damage(o, dmg*RAD_FACTOR, attacker, {element:"none", armorPen:gun&&gun.armorPen, dmg:0}, {chain:true});
    }
    if(near.length && attacker && attacker.isPlayer)
      this._float(origin.x,origin.y-58,"辐射连锁 ×"+Math.min(near.length,RAD_MAX),"#c8ff32");
  },

  /* v0.14.11：每帧结算元素持续状态。灼烧按真实秒数扣血（无视护甲），击杀归属点火者；
   * 影子 AI / 远端玩家不在这里扣血，避免联机双份伤害。返回 true 表示玩家阵亡、调用方应退出本帧。 */
  /* v0.14.11：护甲打穿后标记报废，纳米自愈不再把它救回来，
   * 否则 T4+ 血条会在「装甲黄 → 血肉红」之间每帧反复横跳。 */
  _tickArmorRegen(o, dt){
    if(o.alive && o.armorRegen>0 && !o.armorBroken && o.armor<o.maxArmor)
      o.armor=Math.min(o.maxArmor, o.armor+o.armorRegen*dt);
  },

  /* v0.16.0：护盾回充 —— 每次受击把 shieldTimer 重置为「充能延迟」，
   * 计时归零后才按「充能速度」回充，破盾后也能从 0 重新起盾。
   * 「静止增益」在不动时把速度翻倍；远端玩家 / 影子 AI 只读快照，不自行结算。 */
  _tickShield(o, dt){
    if(!o.alive || !(o.maxShield>0)) return;
    if(o.shieldInvuln>0) o.shieldInvuln=Math.max(0,o.shieldInvuln-dt);
    const _wait=o.shieldTimer||0;
    if(_wait>0){
      o.shieldTimer=Math.max(0,_wait-dt);
      if(o.shieldTimer>0) return;
      // 延迟在本帧内走完：把剩余 dt 交给回充，避免掉帧 / 切后台时白等一整帧
      dt=Math.max(0,dt-_wait);
      if(dt<=0) return;
    }
    if(o.remote || o.ghost || o.isGhost || !o.shieldRate) return;
    if((o.shield||0)>=o.maxShield) return;
    const still=(o.moveX||0)===0 && (o.moveY||0)===0;
    const k=(still && (o.shieldPerks||[]).includes("still")) ? 2 : 1;
    o.shield=Math.min(o.maxShield,(o.shield||0)+o.shieldRate*k*dt);
  },

  /* 破盾冲击：迟滞周围目标（独特加成 surge） */
  _shieldSurge(origin){
    let n=0;
    for(const o of this.ops){
      if(!o.alive || o===origin || o.remote || o.ghost) continue;
      if(M.dist(origin.x,origin.y,o.x,o.y)<=140){
        o.freezeT=Math.max(o.freezeT||0,1.0);
        this.spawnHit(o.x,o.y,"#4fd6ff"); n++;
      }
    }
    if(n) this._float(origin.x,origin.y-58,"破盾冲击 ×"+n,"#c07bff");
  },

  _tickElementStatus(o, dt){
    const burnLeft=o.burnT||0;               // 先记住剩余时长，收尾那一帧只结算实际剩余部分
    if(o.burnT>0)   o.burnT=Math.max(0,o.burnT-dt);
    if(o.corrodeT>0)o.corrodeT=Math.max(0,o.corrodeT-dt);
    if(o.shockT>0)  o.shockT=Math.max(0,o.shockT-dt);
    if(o.radT>0)    o.radT=Math.max(0,o.radT-dt);
    if(burnLeft>0 && o.burnDps>0 && !o.remote && !o.ghost){
      o.hp-=o.burnDps*Math.min(dt,burnLeft);
      if(o.maxShield>0) o.shieldTimer=o.shieldDelay||0;   // 持续掉血同样算「正在受伤害」
      if(o.isPlayer) this.hitFlash=Math.min(0.18,(this.hitFlash||0)+dt*0.15);
      if(o.hp<=0){
        o.hp=0; o.alive=false; o.burnT=0; o.burnDps=0;
        if(o.isPlayer){ this._fail("引燃致死", o.burnSrc, null); return true; }
        this._onBotDeath(o, o.burnSrc);
      }
    }
    if(o.burnT<=0){ o.burnDps=0; o.burnSrc=null; }
    return false;
  },

  _onBotDeath(victim, killer){
    if(killer && killer.isPlayer){
      killer.kills++;
      if((killer.shieldPerks||[]).includes("siphon") && killer.maxShield>0){
        killer.shield=Math.min(killer.maxShield,(killer.shield||0)+killer.maxShield*0.18);
        this._float(killer.x,killer.y-58,"击杀回充","#8fe07a");
      }
      /* GP 币改为「本局首杀必得」——
       * 原来撤离时无条件发 1 枚，等于打不打架都有进账；现在只有开张见血才给，
       * 且整局只算一次，鼓励玩家真的去交火而不是绕开所有人。 */
      if(!killer.netKiller && !this._firstKillToken){
        this._firstKillToken=true;
        this.tokens=(this.tokens||0)+1;
        this._float(victim.x, victim.y-72, "◈ 首杀 · GP 币 +1", "#ffd23f");
        this._feed("黑市", "首杀确认 · GP 币 +1（撤离才落袋）", "奖励", false, "info");
      }
      this._feed(killer.netKiller?(killer.name||"队友"):"你", victim.name, killer.gun?gunNameOf(killer.gun):"徒手", !killer.netKiller, "kill");
      const drops=this._dropFromBot(victim);
      // 联机：队友击杀的 AI，把尸体同步给所有人（否则队友看不到战利品）
      if(killer.netKiller && this.online && typeof Net!=="undefined" && Net.isHost && drops && drops.length){
        /* 尸体同步失败不阻断本地结算（本地已按同样掉落生成过一遍），
           但联机时两端会看到不同的尸体 —— 留痕便于对账。 */
        try{ Net.sendCorpse(victim.x, victim.y, victim.name, drops.slice(0,6)); }
        catch(e){ warnOnce("raid:sendCorpse", e); }
      }
      if(!killer.netKiller) SFX.hit();
    } else if(killer){
      this._feed(killer.name, victim.name, killer.gun?gunNameOf(killer.gun):"徒手", false, "kill");
      this._dropFromBot(victim, true);
    } else {
      this._feed("未知", victim.name, "交火", false, "kill");
    }
  },

  _dropFromBot(bot, silent){
    // v1.0：AI 身上带的是它自己搜刮来的东西——枪 / 甲 / 头盔 / 背包里的备用枪与配件
    const drops=[];
    const mkUid=p=>p+Math.floor(Math.random()*1e9).toString(36);
    if(bot.gun){
      const g=Object.assign({}, bot.gun);
      g.kind="weapon"; g.uid=mkUid("bg");
      drops.push(g);
    }
    if(bot.armorTier) drops.push(raidMakeArmor(bot.armorTier, 0));
    if(bot.helmetTier) drops.push(raidMakeHelmet(bot.helmetTier, 0));
    if(bot.maxShield>0 && RNG.chance(bot.smart?0.5:0.2))
      drops.push(raidMakeShield(M.clamp(bot.armorTier||1,1,9), M.clamp((bot.armorTier||1)-1,0,8)));
    for(const w of (bot.inv.weapons||[]).slice(0,1)){
      const g=Object.assign({},w); g.kind="weapon"; g.uid=mkUid("bw"); drops.push(g);
    }
    for(const a of (bot.inv.armors||[]).slice(0,1)) drops.push(a);
    // v0.21.9：第一件配件与改装模块可能是同一对象（parts[0] 本身带 core），去重避免尸体掉落复制物品
    const firstPart=(bot.inv.parts||[])[0]||null;
    if(firstPart) drops.push(firstPart);
    const corePart=(bot.inv.parts||[]).find(q=>q.core && q!==firstPart);
    if(corePart) drops.push(corePart);
    /* 弹药：按它自己那把枪的口径掉一批（级别跟枪的品级走，Scav 只会民用/制式） */
    {
      const gcal=bot.gun?(bot.gun.cal||ammoCalOfType(bot.gun.type)):null;
      if(gcal && RNG.chance(0.78)){
        const lv=bot.bounty?RNG.ri(4,5)
          : bot.smart?RNG.ri(2,4)
          : RNG.ri(1,2);
        drops.push(ammoDef(gcal, lv));
      }
    }
    // PMC 身上（尤其 Raider）可能揣着保险箱钥匙
    if(RNG.chance(bot.smart?0.20:0.07)){
      const KLV=[{weight:52,lv:1},{weight:26,lv:2},{weight:14,lv:3},{weight:6,lv:4},{weight:2,lv:5}];
      drops.push(raidMakeKey(KLV[RNG.weighted(KLV)].lv));
    }
    // Boss：保底 3 件「高品阶」战利品（材料 / 配件 / 装备）
    if(bot.bounty) for(const it of raidBountyLoot()) drops.push(it);
    const cash=Math.max(0, Math.round((bot.creds||0)*0.3));
    if(drops.length || cash>0){
      this.containers.push({ x:bot.x, y:bot.y, tier:2, searched:false,
        drops, cash, body:true, botName:bot.name });
    }
    return drops;
  },

  /* ----------------------------- 搜索补给 ----------------------------- */
  // 搜索耗时：保险箱按等级加长（V 级要撬 3.3 秒），普通箱 1.1 秒，地面物品堆几乎瞬拾
  _searchNeed(c){ return c && c.ground ? 0.3 : (c && c.airdrop) ? 1.5 : ((c && c.locked) ? (1.6 + M.clamp(c.lockLv||1,1,5)*0.35) : 1.1); },
  _searchUpdate(dt){
    if(!this.search) return;
    const { c }=this.search;
    if(c.searched){ this.search=null; return; }
    if(M.dist(this.player.x,this.player.y,c.x,c.y)>86){ this.search=null; return; }
    this.search.t+=dt;
    const need = this._searchNeed(c);
    if(this.search.t>=need){
      /* v0.22.2：箱子按所在行政区的静态危险度加权掉落。
         raidLuckAt 只读坐标（纯函数，不碰 RNG / AI / 计时），联机两端 seed 重放结果一致。 */
      const luck=raidLuckAt(this, c.x, c.y);
      /* 地面物品堆 —— 逐件尝试装包；装不下的留在原地，这里绝不新生成堆（否则会无限增殖） */
      if(c.ground){
        const rest=[];
        for(const d of (c.drops||[])){ if(!this._collect(d, c.x, c.y, true)) rest.push(d); }
        c.drops=rest;
        if(rest.length){
          c.searched=false;
          this._float(c.x, c.y-38, `背包已满 · 还有 ${rest.length} 件留在地上`, "#ff8a5a");
          SFX.ui();
        } else {
          c.searched=true;
          SFX.pickup();
        }
        this.search=null;
        return;
      }
      c.searched=true;
      // 开锁：消耗一次钥匙耐久
      if(c.locked){
        const k=this._useKey(c.lockLv||1);
        if(k) this._float(c.x, c.y-30, k.name+" 开锁", k.color||"#8fe07a");
      }
      if(this.online && typeof Net!=="undefined"){
        Net.sendLoot(this.containers.indexOf(c), c.kind||"");
      }
      if(c.drops && c.drops.length){
        for(const d of c.drops) this._collect(d, c.x, c.y);
        if(c.cash){
          this.creds+=c.cash;
          this._float(c.x, c.y-46, "+₽"+c.cash+"（搜尸）", "#8fe07a");
        }
      } else if(c.drop){
        this._collect(c.drop, c.x, c.y);
        if(c.cash){ this.creds+=c.cash; this._float(c.x, c.y-46, "+₽"+c.cash, "#8fe07a"); }
      } else if(c.airdrop){
        /* v0.23.0：空投箱 —— 按 V 级军火箱品质出 3 件 + 一笔现金。
           品质仍走 raidLuckAt，所以「末段涌潮的空投」比「中段涌潮的空投」更好，
           这条曲线和时间品质曲线是同一根，不另设参数。 */
        for(let i=0;i<3;i++){
          const vit=this._rollVaultLoot(5, c.x, c.y);
          this._collect(vit, c.x, c.y);
          if(vit && vit.kind==="weapon") this._giveGunAmmo(vit, c.x, c.y);
        }
        const gain=RNG.ri(120,260);
        this.creds+=gain;
        this._float(c.x, c.y-46, "空投 +₽"+gain, "#ffd23f");
        SFX.pickup();
      } else if(c.locked){
        // 上锁保险箱：按 lockLv 决定件数与品质（等级越高装备越好），并稳定出卢布
        const lv=M.clamp(c.lockLv||1,1,5);
        const n=1+(lv>=3?1:0)+(lv>=5?2:0);   // V 级军火箱 4 件
        for(let i=0;i<n;i++){
          const vit=this._rollVaultLoot(lv, c.x, c.y);
          this._collect(vit, c.x, c.y);
          if(vit && vit.kind==="weapon") this._giveGunAmmo(vit, c.x, c.y);   // 箱里的枪带一点弹药
        }
        const gain=RNG.ri(45,120)*lv;
        this.creds+=gain;
        this._float(c.x, c.y-46, "+"+gain+" 卢布", "#8fe07a");
        // 箱内可能藏着钥匙 —— 等级上限 = 本箱等级 +1（V 级封顶），越高越罕见
        if(RNG.chance(0.34)) this._collect(raidRollBoxKey(lv), c.x, c.y);
        if(RNG.chance(0.55)) this._collect(this._rollAmmo(0.35+lv*0.16), c.x, c.y);
      } else if(c.kind==="weapon"){
        // 武器箱也以原材料为主，整枪极少
        const wr=RNG.f();
        if(wr<0.05){
          const git=this._rollGunLoot("pmc", luck);
          this._collect(git, c.x, c.y);
          this._giveGunAmmo(git, c.x, c.y);        // 箱里的枪自带匹配口径弹药
        }
        else if(wr<0.23) this._collect(this._rollPartGear("pmc", luck), c.x, c.y);
        else if(wr<0.52) this._collect(this._rollAmmo(luck), c.x, c.y);   // 武器箱是找子弹的首选
        else this._collect(this._rollMaterial(luck), c.x, c.y);
      } else if(c.kind==="medical"){
        if(RNG.chance(0.72)){
          const n=RNG.ri(1,2);
          for(let i=0;i<n;i++) this._collect(raidRollMed(luck), c.x, c.y);
          SFX.pickup();
        }
        else if(RNG.chance(0.45)) this._collect(this._rollMaterial(luck), c.x, c.y);
        else { const g=RNG.ri(25,65); this.creds+=g; this._float(c.x,c.y-30,"+"+g+" 卢布","#8fe07a"); }
      } else if(c.kind==="armor"){
        const roll=RNG.f();
        if(roll<0.06) this._collect(raidMakeArmor(raidRollArmorTier(luck)), c.x, c.y);
        else if(roll<0.10) this._collect(raidMakeHelmet(raidRollArmorTier(luck*0.85)), c.x, c.y);
        else if(roll<0.13) this._collect(raidMakeShield(raidRollArmorTier(luck), this._rollRarity(luck)), c.x, c.y);
        else if(roll<0.88) this._collect(this._rollMaterial(luck), c.x, c.y);
        else this._collect(this._rollPartGear("pmc", luck), c.x, c.y);
      } else if(RNG.chance(0.16)){
        this._collect(raidRollMed(luck), c.x, c.y);
        SFX.pickup();
      } else if(RNG.chance(0.35)){
        this._collect(this._rollAmmo(luck), c.x, c.y);
        SFX.pickup();
      } else if(RNG.chance(0.30)){
        // 普通箱现金：金额与概率双双下调
        const gain=RNG.ri(18,45)*(c.tier+1);
        this.creds+=gain;
        this._float(c.x,c.y-30,"+"+gain+" 卢布","#8fe07a");
        SFX.pickup();
      } else {
        const it=this._rollGear("pmc", luck);
        this._collect(it, c.x, c.y);
        if(it && it.kind==="weapon") this._giveGunAmmo(it, c.x, c.y);
      }
      // GP 币极稀有掉落（上锁军用箱 9%，普通箱 2%）
      // 保险箱等级越高，GP 币概率越高（V 级箱 26%）
      if(!c.locked && RNG.chance(0.025)){
        this._collect(raidRollBoxKey(0), c.x, c.y);   // 普通箱按 0 级算 → 最多只出 I 级钥匙
      }
      if(RNG.chance(c.locked ? (0.06+0.04*(c.lockLv||1)) : 0.02)){
        this.tokens=(this.tokens||0)+1;
        this._float(c.x, c.y-64, "◈ GP 币 +1", "#ffd23f");
        SFX.levelup();
      }
      this.search=null;
    }
  },

  /* 背包满时溢出的物品不再凭空消失 —— 落在脚下形成「地面物品堆」，
   * 腾出空间后走回来按 E 就能捡。同类物品就近合并成堆，单堆最多 8 件。
   * v0.24.0：mark==="spill" 表示「背包塞不下才掉的」，与玩家主动丢弃 /
   * 初始补给区分开 —— 面板右上角会标出来，玩家才知道这几件是自己的。 */
  _dropGround(item, x, y, mark){
    const bx=x!==undefined?x:this.player.x, by=y!==undefined?y:this.player.y;
    if(!this.grounds) this.grounds=[];
    let pile=this.grounds.find(c=>!c.searched
      && (c.drops||[]).length<8 && M.dist(c.x,c.y,bx,by)<70);
    if(pile){ pile.drops.push(item); if(mark==="spill") pile.spill=true; return pile; }
    // 堆数达上限时只并入「仍未搜刮且未满」的堆，绝不写进已搜刮堆
    // （原实现固定取 grounds[0]，若该堆 searched=true 则物品永久丢失）
    const open=this.grounds.filter(c=>!c.searched && (c.drops||[]).length<8);
    if(open.length>=60){
      let best=open[0];
      for(const c of open) if((c.drops||[]).length<(best.drops||[]).length) best=c;
      best.drops.push(item); if(mark==="spill") best.spill=true; return best;
    }
    const a=RNG.fr(0,6.2832), r=RNG.fr(36,54);
    pile={ x:M.clamp(bx+Math.cos(a)*r, 40, RAID_MAP_W-40),
           y:M.clamp(by+Math.sin(a)*r, 40, RAID_MAP_H-40),
           tier:0, ground:true, searched:false, drops:[item], cash:0 };
    if(mark==="spill") pile.spill=true;
    this.grounds.push(pile);
    return pile;
  },

  // 返回 true 表示成功放入物品栏；false 表示已满（物品已落到地面，等玩家腾出空间再回来捡）
  _invPush(arr, key, item){
    if(arr.length>=RAID_INV_CAP[key]) return false;
    arr.push(item); return true;
  },
  /* 掉一条子弹：口径有 45% 概率跟着玩家手上的枪，级别由箱子等级 / 运气决定 */
  _rollAmmo(luck, cal){
    const pg=this.player && this.player.gun;
    const want=pg ? (pg.cal||ammoCalOfType(pg.type)) : null;
    const c=cal || ((want && RNG.chance(0.45)) ? want : RNG.pick(AMMO_CAL_LIST));
    const l=M.clamp(luck||0, 0, 1);
    const lv=M.clamp(1+Math.floor(RNG.f()*(1.9+l*2.4)), 1, 5);
    const d=ammoDef(c, lv);
    d.n=RAID_AMMO_STACK;
    return d;
  },
  /* v0.21.6：箱子里的枪自带一点匹配口径的弹药，不用再满地图找子弹。
   * 只给「一匣 + 半条」的量（30 发），不破坏「子弹要自己攒」的节奏。 */
  _giveGunAmmo(gun, x, y){
    if(!gun || gun.kind!=="weapon") return null;
    const type = gun.type || gun.cat || "rifle";
    const cal  = gun.cal || ammoCalOfType(type);
    const lv   = M.clamp(1 + Math.floor(((gun.ilvl||10)-6)/8), 1, 4);   // 与枪的等级挂钩，最高 T4
    const it = { kind:"ammo", id:ammoItemId(cal, lv), n:30 };
    this._collect(it, x, y);
    return it;
  },

  /* ==================== v0.24.0：地面装备「长按替换」 ====================
   * 短按走 _collect（整堆进背包）；长按只取**这一件**直接装上 / 换上，
   * 被换下的旧装备回背包，背包满了就落脚下（带 spill 标记）。
   * 选取顺序与 _groundGunPanel 一致：武器 → 护盾 → 护甲 → 头盔。 */

  _groundEquipItem(c){
    const drops=(c && c.drops)||[];
    for(const k of ["weapon","shield","armor","helmet"]){
      const it=drops.find(d=>d && d.kind===k);
      if(it) return it;
    }
    return null;
  },

  /* 局内穿上护甲 / 头盔。此前局内只有「进背包」，没有穿戴链路 ——
     防具只有带入的 carried.armor / carried.helmet 才会真的生效。 */
  _wearGear(kind, it){
    const p=this.player;
    if(!p || !it || (kind!=="armor" && kind!=="helmet")) return false;
    if(!this.carried) this.carried={weapons:[],armor:null,helmet:null,shield:null};
    const old=this.carried[kind];
    if(old && old!==it){
      const key=kind==="armor"?"armors":"helmets";
      const arr=(this.inv[key]=this.inv[key]||[]);
      if(arr.length<RAID_INV_CAP[key]) arr.push(old);
      else this._dropGround(old, p.x, p.y, "spill");
    }
    this.carried[kind]=it;
    const cap=it.maxArmor||0;
    if(kind==="armor"){
      p.armorTier=it.tier||0; p.dr=it.dr||0;
      p.maxArmor=cap; p.armor=cap; p.armorRegen=it.armorRegen||0;
      p.armorBroken=cap<=0;
    } else {
      p.helmetTier=it.tier||0; p.helmetDr=it.dr||0;
      p.maxHelmetArmor=cap; p.helmetArmor=cap;
    }
    return true;
  },

  /* 把一件地上装备直接装到身上。枪走 _equipGun(forceMain)，护盾走 _wearShield，
     护甲/头盔走 _wearGear；旧装备的回收由各自链路负责。 */
  _swapEquip(item){
    const p=this.player;
    if(!p || !item) return false;
    const kind=item.kind;
    if(kind==="weapon"){
      if((this.inv.weapons||[]).indexOf(item)<0){
        if(this.inv.weapons.length>=RAID_INV_CAP.weapons){
          this._pick(p.x,p.y-34,"武器栏已满 · 先腾出空间","#ff8a5a"); return false;
        }
        this.inv.weapons.push(item);       // _stowGun / _gunBag 依赖物品栏里有这条
      }
      const g=this._rtGun(item);
      if(!g) return false;
      g.ammoMag=g.mag; g.ammoRes=Math.max(0,g.ammoRes|0);
      this._equipGun(g, true);            // 长按 = 明确换到主手
      return true;
    }
    if(kind==="shield") return !!this._wearShield(item);
    if(kind==="armor"||kind==="helmet") return !!this._wearGear(kind, item);
    return false;
  },

  _equipFromGround(c, item){
    const drops=(c && c.drops)||[];
    const i=drops.indexOf(item);
    if(i<0 || !this.player) return false;
    if(!this._swapEquip(item)) return false;
    drops.splice(i,1);
    if(!drops.length) c.searched=true;
    this._invDirty=true;
    const nm = item.kind==="weapon" ? gunNameOf(item) : (item.name||"装备");
    const col = item.kind==="shield" ? shieldColor(item)
              : item.kind==="weapon" ? raidGunColor(item) : "#8fe07a";
    this._pick(this.player.x, this.player.y-34, "已装备 "+nm, col);
    SFX.pickup();
    return true;
  },

  _collect(item, x, y, fromGround){
    this._invDirty=true;   // 物品栏开着时拾取会即时刷新
    const px=x!==undefined?x:this.player.x, py=(y!==undefined?y:this.player.y)-24;
    const spill=(label)=>{
      if(!fromGround) this._dropGround(item, x, y, "spill");
      this._pick(px, py, fromGround ? label+"已满 · 先腾出空间"
                                     : label+"已满 · 物品掉在脚下", "#ff8a5a");
      return false;
    };
    /* 弹药：按发堆进弹药栏（不占物品格，但总发数有上限） */
    if(item.kind==="ammo"){
      const id=item.id || ammoItemId(item.cal, item.lv);
      const want=item.n||RAID_AMMO_STACK;
      const add=this._ammoAdd(id, want);
      if(add>0){
        const d=ammoDefFromId(id)||item;
        this._pick(px, py, "+"+add+" "+d.short, d.color||"#dfe7f0");
        SFX.pickup();
        return true;
      }
      this._pick(px, py, "弹药已满（"+RAID_AMMO_CAP+" 发上限）", "#ff8a5a");
      return false;
    }
    // 原材料：直接进入材料栏（带品质颜色）
    if(item.kind==="material"){
      if(this._invPush(this.inv.materials, "materials", item)){
        this._pick(px, py, "+"+item.name, item.color||"#dfe7f0");
        SFX.pickup();
        return true;
      }
      return spill("材料栏");
    }
    // 钥匙：独立钥匙串，带使用次数，不占配件位
    if(item.kind==="key"){
      if(!this.inv.keys) this.inv.keys=[];
      if(this._invPush(this.inv.keys, "keys", item)){
        this._pick(px, py, "+"+item.name+"（"+RAID_LOCK_NAME[item.lv]+"）", item.color||"#8fe07a");
        SFX.pickup();
        return true;
      }
      return spill("钥匙串");
    }
    // 医疗品：绷带进「绷带数」，其余进医疗包栏
    if(item.kind==="med"){
      if(item.id==="bandage"){ this.bandages+=1; this._pick(px,py,"+1 绷带",item.color||"#ff9a9a"); SFX.pickup(); return true; }
      const slot = this.inv.meds.find(m=>m.id===item.id);
      if(slot){ slot.n+=1; this._pick(px,py,"+"+item.name, item.color||"#ff9a9a"); SFX.pickup(); return true; }
      if(this.inv.meds.length < RAID_INV_CAP.meds){ this.inv.meds.push({id:item.id, name:item.name, n:1, tier:item.tier, color:item.color}); this._pick(px,py,"+"+item.name,item.color||"#ff9a9a"); SFX.pickup(); return true; }
      return spill("医疗栏");
    }
    // 改装模块：现已并入配件，作为 slot:"core" 的配件进配件栏（由下方 part 分支统一处理）
    if(item.kind==="receiver"){
      const arr=this.inv.receivers;
      if(arr.length<RAID_INV_CAP.receivers){ arr.push(item); this._pick(px,py,"+"+item.name,item.color||"#8fd0ff"); SFX.pickup(); return true; }
      return spill("底材栏");
    }
    // 武器：空手或没副手 → 直接上手并放入物品栏（这是裸装跑刀能翻身的关键）
    if(item.kind==="weapon" && (!this.player.gun || !this.player.secondary)){
      // 自动上手也要走容量检查，避免极端情况下 inv.weapons 超过 6 把
      if(this.inv.weapons.length>=RAID_INV_CAP.weapons) return spill("武器栏");
      /* v0.21.6：必须走 _rtGun 的运行时缓存 —— 以前这里用 raidGunFromItem 另建了一个副本，
       * 于是「已经在手上的枪」在物品栏里被 _gunBag() 认不出来，背包里会平白多出一把同名枪。 */
      this.inv.weapons.push(item);                 // 先入栏（_rtGun 需要 uid）
      const g=this._rtGun(item);
      g.ammoMag=g.mag; g.ammoRes=Math.max(0, g.ammoRes|0);   // 捡到的枪：满弹匣上手，备弹从背包算
      const slot = !this.player.gun ? "主手" : "副手";
      if(!this.player.gun) this.player.gun=g; else this.player.secondary=g;
      this.player.fireCd=Math.max(this.player.fireCd,0.2);
      this._pick(px, py, slot+" "+gunNameOf(item), raidGunColor(item));
      SFX.pickup();
      return true;
    }
    if(item.kind==="shield"){
      /* v0.21.0：身上没护盾就直接穿上（省一次开物品栏点「拿在手上」），
       * 已经有盾了才进背包 —— 免得捡到个更差的把好的顶掉。 */
      if(this.player && !(this.player.maxShield>0) && this._wearShield(item)){
        this._pick(px, py, "已穿戴 "+item.name, shieldColor(item));
        SFX.pickup();
        return true;
      }
      if(!this.inv.shields) this.inv.shields=[];
      if(this._invPush(this.inv.shields, "shields", item)){
        this._pick(px, py, "+"+item.name, shieldColor(item)); SFX.pickup(); return true;
      }
      return spill("护盾栏");
    }
    let arr, key, col;
    if(item.kind==="weapon"){ arr=this.inv.weapons; key="weapons"; col=raidGunColor(item); }
    else if(item.kind==="helmet"){ arr=this.inv.helmets; key="helmets"; col=RAID_RARITY_COLOR[item.rarity|0]||"#dfe7f0"; }
    else if(item.kind==="part"){ arr=this.inv.parts; key="parts"; col=(RARITY_BY_ID[item.rarity]||{color:"#cfd8e2"}).color; }
    else { arr=this.inv.armors; key="armors"; col=RAID_RARITY_COLOR[item.rarity|0]||"#dfe7f0"; }
    if(this._invPush(arr, key, item)){
      const star=(item.kind==="armor"||item.kind==="helmet")&&item.rarity?(' '+RAID_RARITY_NAME[item.rarity]):'';
      // 双手都满时捡到的枪进背包，Q 键可随时换到手上
      this._pick(px, py, (item.kind==="weapon"?"背包 "+gunNameOf(item):"+"+item.name)+star, col);
      SFX.pickup();
      return true;
    }
    return spill("物品栏");
  },

  /* ----------------------------- 撤离 ----------------------------- */
  _extractUpdate(dt, game){
    const p=this.player;
    let zone=null;
    for(const z of this.extracts){
      if(z.closed) continue;
      if(p.x>=z.x&&p.x<=z.x+z.w&&p.y>=z.y&&p.y<=z.y+z.h){ zone=z; break; }
    }
    if(zone){
      // 撤离点被封锁：封锁者存活时无法读条，必须先清除（这是「堵撤离点」的实际效果）
      const blocker=this.ops.find(o=>o.alive && o.blockZone===zone &&
        M.dist(o.x,o.y, zone.x+zone.w/2, zone.y+zone.h/2) < 300);
      if(blocker){
        this.extractT=Math.max(0, this.extractT-dt*2.2);
        this._extractBlockReason="撤离点被封锁 · 清除封锁者";
        return;
      }
      // 付费撤离点：费用随带入装备估值浮动；余额不足时不计时
      const fee=raidExtractFee(zone, this.carryVal||0);
      const purse=this.creds + Math.max(0, (this.stash&&this.stash.creds)||0);
      if(fee>0 && purse<fee){
        this.extractT=Math.max(0, this.extractT-dt*1.6);
        this._extractBlockReason="撤离费 "+fee+" 卢布不足（局内 "+this.creds+" + 仓库 "+Math.max(0,(this.stash&&this.stash.creds)||0)+"）";
      } else {
        this._extractBlockReason=null;
        this.extractT=Math.min(zone.need, this.extractT+dt);
        if(this.extractT>=zone.need){
          if(fee>0 && !this._payExtractFee(fee)){   // V-EX 车费（局内现金优先，仓库兜底）
            this.extractT=Math.max(0, this.extractT-dt*1.6);
            this._extractBlockReason="撤离费 "+fee+" 卢布不足";
            return;
          }
          this._succeed(zone);
        }
      }
    } else {
      this._extractBlockReason=null;
      this.extractT=Math.max(0, this.extractT-dt*1.6);
    }
  },

  /* 付撤离费：优先局内现金，其次仓库余额（钱只在真正撤离成功时才扣，读条被打断不白花）。
   * v0.21.9：改为组合扣款 —— 旧逻辑要求单一资金源足额，局内+仓库合计够但都单独不够时
   * 读条能走满却永远付不出去（extractT 回退循环卡死），与「仓库兜底」的设计相悖。 */
  _payExtractFee(fee){
    if(fee<=0) return true;
    const st=Math.max(0,(this.stash&&this.stash.creds)||0);
    if(this.creds+st<fee) return false;
    const fromPurse=Math.min(this.creds,fee); this.creds-=fromPurse;
    const rest=fee-fromPurse;
    if(rest>0){
      this.stash.creds=st-rest;
      if(typeof RaidStash!=="undefined" && RaidStash.save) RaidStash.save(this.stash);
    }
    return true;
  },

  _succeed(zone){
    if(!this.active || this._ended) return;
    this._ended=true;
    this.resetUiState();
    // v0.21.9：补上撤离标记 —— net.js 快照里 ext 字段原先引用从未赋值的 _extractedFlag，同步链路是死的
    this._extractedFlag=true;
    if(this.online && typeof Net!=="undefined") Net.sendExtract(zone?zone.name:"");
    // 联机：自己撤离后世界继续跑（房主还要给队友模拟 AI），镜头交给观战
    this.active=!!this.online;
    this.spectate=!!this.online;
    this._hideTouchLayer();
    // 物品栏（含入场携带的装备）全部写回仓库
    this.stash.creds += this.creds;
    for(const w of this.inv.weapons) this.stash.weapons.push(w);
    for(const a of this.inv.armors) this.stash.armors.push(a);
    for(const h of this.inv.helmets) this.stash.helmets.push(h);
    this.stash.shields=this.stash.shields||[];
    for(const s of (this.inv.shields||[])) this.stash.shields.push(s);
    // 穿戴中的护甲 / 头盔 / 护盾（耐久按撤离时的剩余值保留，不再凭空蒸发）
    if(this.carried.armor) this.stash.armors.push(this.carried.armor);
    if(this.carried.helmet) this.stash.helmets.push(this.carried.helmet);
    if(this.carried.shield) this.stash.shields.push(this.carried.shield);
    for(const pt of this.inv.parts) this.stash.parts.push(pt);
    for(const m of this.inv.materials) this.stash.materials.push(m);   // 原材料随撤离带回仓库
    this.stash.keys=this.stash.keys||[];
    for(const k of (this.inv.keys||[])) this.stash.keys.push(k);        // 钥匙带回仓库
    this.stash.receivers=this.stash.receivers||[];
    for(const r of this.inv.receivers) this.stash.receivers.push(r);
    this.stash.meds=Object.assign({hemo:0,medkit:0,stim:0,surgery:0}, this.meds||{});
    /* v0.19.0：局内捡到的医疗品也要随撤离入库，否则「捡到即消失」 */
    for(const m of (this.inv.meds||[])) this.stash.meds[m.id]=(this.stash.meds[m.id]||0)+(m.n||0);
    this.stash.bandages=this.bandages;
    // 撤离不再保底发 GP 币 —— 只按带出价值与击杀数结算
    // （本局首杀的那 1 枚已由 _onBotDeath 当场发放，没打到人、也没翻到货就是 0 枚）
    let lootVal=0;
    for(const w of this.inv.weapons) lootVal+=w.value||0;
    for(const a of this.inv.armors) lootVal+=a.value||0;
    for(const h of this.inv.helmets) lootVal+=h.value||0;
    for(const s of (this.inv.shields||[])) lootVal+=s.value||0;
    for(const pt of this.inv.parts) lootVal+=(pt.slot==="core"?(pt.value||0):partValue(pt))||0;
    for(const m of this.inv.materials) lootVal+=m.value||0;
    for(const k of (this.inv.keys||[])) lootVal+=(k.value||0)*((k.uses||1)/Math.max(1,k.maxUses||1));
    const tokenGain=M.clamp(Math.floor(lootVal/60000)+Math.floor((this.player.kills||0)/3), 0, 5);
    const tokenTotal=(this.tokens||0)+tokenGain;
    this.stash.tokens=(this.stash.tokens||0)+tokenTotal;
    if(!RaidStash.save(this.stash) && this.game && this.game.toast)
      this.game.toast("仓库写入失败：localStorage 可能已满，请清理后重试");
    this.game.state="raidover";
    UI.raidResult({
      success:true, zone:zone?zone.name:"撤离点", creds:this.creds,
      returned:{ weapons:this.inv.weapons.length,
                 armor:this.inv.armors.length+(this.carried.armor?1:0),
                 helmet:this.inv.helmets.length+(this.carried.helmet?1:0),
                 shields:(this.inv.shields||[]).length+(this.carried.shield?1:0),
                 materials:this.inv.materials.length,
                 keys:(this.inv.keys||[]).length },
      looted:this.inv, kills:this.player.kills, time:this.raidDuration-this.timer,
      insured:this.insured, insuredPaid:this.insuredVal,
      tokens:tokenTotal, tokenLoot:this.tokens||0,
    });
  },

  _fail(reason, killer, gun){
    if(!this.active || this._ended) return;
    this._ended=true;
    this.resetUiState();
    if(this.online && typeof Net!=="undefined") Net.sendDead(killer?killer.name:reason);
    this.active=!!this.online;
    this.spectate=!!this.online;
    this.player.alive=false;
    this._hideTouchLayer();
    if(killer && killer.name) this._feed(killer.name, "你", gun?gunNameOf(gun):"交火", false, "kill");
    // 阵亡：携带装备与战利品全部丢失（仓库在开局已扣除）
    // 塔科夫式保险：投保的装备有 65% 概率"无人捡走"被退回
    let recovered=[];
    if(this.insured){
      const retBack=[];
      for(const w of this.carried.weapons) if(RNG.chance(0.65)) retBack.push(w);
      if(this.carried.armor && RNG.chance(0.65)) retBack.push(this.carried.armor);
      if(this.carried.helmet && RNG.chance(0.65)) retBack.push(this.carried.helmet);
      if(this.carried.shield && RNG.chance(0.65)) retBack.push(this.carried.shield);
      for(const it of retBack){
        if(it.kind==="weapon") this.stash.weapons.push(it);
        else if(it.kind==="helmet") this.stash.helmets.push(it);
        else if(it.kind==="shield") (this.stash.shields=this.stash.shields||[]).push(it);
        else this.stash.armors.push(it);
        recovered.push(it);
      }
    }
    if(!RaidStash.save(this.stash) && this.game && this.game.toast)
      this.game.toast("仓库写入失败：localStorage 可能已满，请清理后重试");
    this.game.state="raidover";
    UI.raidResult({
      success:false, reason, lost:{
        weapons:this.carried.weapons, armor:this.carried.armor, helmet:this.carried.helmet, shield:this.carried.shield,
        // 开局把 carried.weapons 也压进了 inv.weapons，这里按 uid 去重，避免结算列表重复
        lootW:this.inv.weapons.filter(w=>!(this.carried.weapons||[]).some(c=>c.uid===w.uid)),
        lootA:this.inv.armors.filter(a=>a!==this.carried.armor),
        lootH:(this.inv.helmets||[]).filter(h=>h!==this.carried.helmet),
        lootP:this.inv.parts||[], lootM:this.inv.materials||[],
      }, kills:this.player.kills, time:this.raidDuration-this.timer,
      insured:this.insured, insuredPaid:this.insuredVal, recovered,
    });
  },

  _hideTouchLayer(){
    const tl=document.getElementById("touch-layer");
    if(tl) tl.classList.add("hidden");   // 修复：结算界面出现后触摸按钮仍可点
  },

  /* ----------------------------- 服务器背景交火 ----------------------------- */
  _backgroundFight(){
    // 只让「远离玩家」的 AI 之间发生交火 / 撤离，避免眼前的人凭空消失
    const p=this.player;
    const alive=this.ops.filter(o=>o.alive && !o.isPlayer && !o.remote && M.dist(o.x,o.y,p.x,p.y)>900);
    if(alive.length<=1) return;
    if(RNG.chance(0.35)){
      // 有人带着战利品撤离
      const o=RNG.pick(alive);
      o.alive=false;
      this._feed(o.name, "", "已撤离", false, "extract");
    } else {
      const victim=RNG.pick(alive);
      const others=alive.filter(o=>o!==victim);
      const killer=RNG.pick(others);
      victim.alive=false;
      this._feed(killer.name, victim.name, killer.gun?gunNameOf(killer.gun):"交火", false, "kill");
      this._dropFromBot(victim, true);   // 远处尸体同样留下它的背包
    }
  },

  /* ----------------------------- 增援（小队 / 撤离点封锁者） ----------------------------- */
  _spawnReinforcement(){
    const isSquad = RNG.chance(0.5);
    const squadId = isSquad ? ("sq"+(this._squadN++)) : null;
    const n = isSquad ? RNG.ri(2,3) : 1;
    /* 约 45% 的小队会去封锁某个开放的撤离点。三条约束（v0.19.2）：
     *   · 付费撤离点永不封锁 —— 它是「花钱买路」的保底出口，堵了就真没路走了
     *   · 同一个点不重复挂封锁者（否则杀一个还有下一个，永远清不完）
     *   · 全图同时存在的封锁者最多 2 个，避免后期所有撤离点全红 */
    let blockZone=null;
    const liveBlockers=this.ops.filter(o=>o.alive && o.blockZone).length;
    if(isSquad && RNG.chance(0.45) && liveBlockers < 2){
      const open=this.extracts.filter(z=>!z.closed && !(z.cost>0) &&
        !this.ops.some(o=>o.alive && o.blockZone===z));
      if(open.length) blockZone=RNG.pick(open);
    }
    // 选一个离玩家足够远的房间进场，避免「凭空刷在脸上」
    const p0=this.player;
    let room=null;
    for(let i=0;i<8;i++){
      const cand=RNG.pick(RAID_ROOMS.filter(r=>!r.extract));
      const cx=cand.x+cand.w/2, cy=cand.y+cand.h/2;
      if(!p0 || M.dist(cx,cy,p0.x,p0.y) > 700){ room=cand; break; }
      if(!room) room=cand;
    }
    const pt=this._openPointInRoom(room, 70+n*24);
    for(let i=0;i<n;i++){
      const p=this._openPointInRoom(room, 70+i*26);
      const smart=RNG.chance(0.6);
      const gid=RNG.pick(["rifle","smg","sniper","rifle","shotgun"]);
      const gun=blGunGen(RNG.ri(12,17),{type:gid});   // 增援全部带装备
      const armorTier=RNG.chance(0.6)?RNG.ri(3,6):0;
      const helmetTier=armorTier?RNG.ri(2,5):0;
      const isBlocker = !!(blockZone && i===0);
      const op=new RaidOperator({
        id:"re"+(this.uidN++)+"-"+(i+1), cls:"pmc", name:(smart?"★ ":"")+(isBlocker?"封锁者":(squadId?"小队":"游骑兵")),
        x:p.x, y:p.y, angle:RNG.fr(0,6.28),
        speed:RNG.fr(140,162), hp:RNG.ri(95,140),
        color:isBlocker?"#ff7a3c":"#e0b84a",
        gun, armor:armorTier?RAID_ARMORS[armorTier].maxArmor:0, dr:armorTier?RAID_ARMORS[armorTier].dr:0, armorTier,
        helmetArmor:helmetTier?RAID_HELMETS[helmetTier].maxArmor:0, helmetDr:helmetTier?RAID_HELMETS[helmetTier].dr:0, helmetTier,
        shield: (smart && armorTier>0 && armorTier<RAID_ARMOR_TYPE_TIER) ? Math.round(28+armorTier*6) : 0,
        smart, creds:RNG.ri(60,260), lootLimit:3,
        squadId, isLeader:(isSquad&&i===0), blocker:isBlocker,
      });
      if(blockZone) op.blockZone=blockZone;
      this.ops.push(op);
    }
    if(blockZone) this._feed("警告", "一支小队正封锁「"+blockZone.name+"」", "", false, "warn");
    else this._feed("系统", "增援部队已进入战区", "", false, "warn");
  },

  /* ==================== v0.23.0：精英怪 ==================== */

  /* 增援呼叫员（broodmother）当场叫一支 2 人小队。
   * 与 _spawnReinforcement 的区别：那个是「全图随机刷一队」，这个是「就地叫」——
   * 小队出现在呼叫员身边两个身位内，玩家必须在被包围前先解决掉呼叫员。 */
  _callReinforce(b){
    const sid = b.squadId || ("call"+(b.id||"x"));
    for(let i=0;i<2;i++){
      const a=RNG.fr(0,6.2832), rad=90+i*48;
      const pt=this._spawnSafePoint(b.x+Math.cos(a)*rad, b.y+Math.sin(a)*rad, 16);
      const gun=blGunGen(RNG.ri(11,15), {type:RNG.pick(["rifle","smg","shotgun"])});
      const op=new RaidOperator({
        id:"cal"+(this.uidN++)+"-"+i, cls:"scav", name:"增援 · 小队",
        x:pt.x, y:pt.y, angle:RNG.fr(0,6.2832),
        speed:RNG.fr(120,142), hp:RNG.ri(70,95), color:"#d0a0e0",
        gun, smart:false, creds:RNG.ri(20,60), lootLimit:1, squadId:sid,
      });
      this.ops.push(op);
    }
    this._feed("警告", (b.name||"呼叫员")+" 呼叫了增援小队", "", false, "warn");
    this._toast("敌人呼叫增援", "#ff8a5a");
  },

  /* ==================== v0.23.0：中后期涌潮（留场动力 C） ====================
   * 时间品质曲线只解决了「晚开箱更值钱」，玩家感知不到「现在图里发生了什么」。
   * 涌潮补上：中段 210s / 末段 330s 各落一批空投，广播坐标、小地图可见、AI 也会去抢。
   *
   * 关键约束：容器表两端必须一致（Net.sendLoot 用 containers.indexOf 定位），
   * 所以这里既不能用全局 RNG（两端状态不同），也不能用 _openPointInRoom（内部吃 RNG）。
   * 落点因此取自 seed 派生的局部 LCG + POI 手工指定的开阔锚点。 */
  _surge(n){
    if(!this.airdrops) this.airdrops=[];
    const rnd=raidSurgeRand(((this.seed||0)>>>0) + ((n*2654435761)>>>0));
    const count=1+(rnd()<0.45?1:0);
    /* 优先排除已经落过空投的 POI —— 两次涌潮都掉在同一个地方，等于白白浪费一次机会。
       used 集合只依赖 airdrops，而 airdrops 是两端同序 append 的，所以不影响确定性。 */
    const used=new Set((this.airdrops||[]).map(a=>a.poi));
    let pool=RAID_POI.filter(p=>!used.has(p.id));
    if(!pool.length) pool=RAID_POI.slice();
    const picked=[];
    for(let i=0;i<count && pool.length;i++){
      const k=Math.floor(rnd()*pool.length)%pool.length;
      picked.push(pool.splice(k,1)[0]);
    }
    for(const poi of picked){
      const x=M.clamp(poi.drop[0]+(rnd()-0.5)*120, 80, RAID_MAP_W-80);
      const y=M.clamp(poi.drop[1]+(rnd()-0.5)*120, 80, RAID_MAP_H-80);
      this.containers.push({ x, y, tier:2, kind:"weapon", airdrop:true,
        searched:false, drop:null, poi:poi.id });
      this.airdrops.push({ x, y, name:poi.name, poi:poi.id, life:150 });
      this._feed("空投", "补给空投落点 · "+poi.name+"（"+Math.round(x)+" / "+Math.round(y)+"）", "", false, "info");
    }
    if(picked.length) this._toast("补给空投已落地 · 小地图可见", "#ffd23f");
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
      if(d<=R){ const fall=M.clamp(1-d/R*0.6,0.35,1); this._damage(o, rk.dmg*fall, rk.owner, rk.gun, {blast:true}); }
    }
    for(let i=0;i<16;i++){ const a=Math.random()*6.28, s=Math.random()*260+80;
      this.particles.push({x,y,vx:Math.cos(a)*s,vy:Math.sin(a)*s,life:0.5,maxLife:0.5,color:i%2?"#ffd23f":"#ff7a1f",size:3}); }
    this.blasts.push({x,y,r:R*0.45,life:0.34,maxLife:0.34});
    this._float(x, y-30, "爆炸", "#ffb020");
    SFX.boom();
  },

  /* ----------------------------- 视觉工具 ----------------------------- */
  spawnHit(x,y,color){
    for(let i=0;i<6;i++){ const a=Math.random()*6.28, s=Math.random()*120+40;
      this.particles.push({x,y,vx:Math.cos(a)*s,vy:Math.sin(a)*s,life:0.3,maxLife:0.3,color,size:2.6}); }
  },
  // v0.14.10：冰冻命中的冰晶散射（配合 unit() 里的冰霜环 / 结晶）
  _freezeBurst(x,y){
    for(let i=0;i<9;i++){ const a=Math.random()*6.28, s=Math.random()*80+30;
      this.particles.push({x,y,vx:Math.cos(a)*s,vy:Math.sin(a)*s,life:0.55,maxLife:0.55,
        color:i%2?"#bdefff":"#6fd6ff",size:2.4}); }
  },
  _float(x,y,text,color){ this.floats.push({x,y,text,color:color||"#fff",life:0.9,maxLife:0.9,vy:-30,size:13}); },
  /* v0.21.4：3D 拾取提示
   * 2D 的 _float 是画在**世界坐标系**里的（scene() 内 ctx 已 translate 到相机），
   * 第一人称渲染器不铺那层世界变换，所以「+ 5.45×39 PS」这类浮动文字在 3D 下完全看不见。
   * 拾取 / 丢弃 / 治疗这类即时反馈改成额外推一条屏幕空间提示条，由 hud() 在 3D 时绘制。 */
  _toast(text, color){
    if(!text) return;
    if(typeof ViewMode==="undefined" || !ViewMode.is3D()) return;
    this.toasts=this.toasts||[];
    this.toasts.push({ text:String(text), color:color||"#dfe7f0", life:3.0, maxLife:3.0 });
    if(this.toasts.length>6) this.toasts.splice(0, this.toasts.length-6);
  },
  /* 双通道：2D 走世界浮动文字，3D 走屏幕提示条（_toast 内部会自己判断维度） */
  _pick(x,y,text,color){ this._float(x,y,text,color); this._toast(text,color); },
  _feed(a,v,gun,mine,type){ this.killfeed.unshift({a,v,gun,mine:!!mine,type:type||"kill",t:6}); if(this.killfeed.length>6) this.killfeed.pop(); },

  _screenToWorld(sx,sy,game){
    const z=game.zoom||1;
    return { x:this.camera.x+sx/z, y:this.camera.y+sy/z };
  },

  _updateCamera(game){
    const v=game.view, z=game.zoom||1, p=this.player;
    const vw=v.w/z, vh=v.h/z;
    let fx=p.x, fy=p.y;
    if(this.spectate){
      const m=this.ops.find(o=>o.remote && o.alive) || this.ops.find(o=>o.remote);
      if(m){ fx=m.x; fy=m.y; }
    }
    let tx=fx-vw/2, ty=fy-vh/2;
    tx = RAID_MAP_W<=vw ? (RAID_MAP_W-vw)/2 : M.clamp(tx,0,RAID_MAP_W-vw);
    ty = RAID_MAP_H<=vh ? (RAID_MAP_H-vh)/2 : M.clamp(ty,0,RAID_MAP_H-vh);
    this.camera.x=M.lerp(this.camera.x,tx,0.2);
    this.camera.y=M.lerp(this.camera.y,ty,0.2);
    // v0.14.11：塔科夫模式原本只维护 Raid.camera，game.camera 一直停在 (0,0)，
    // 导致 game.worldToScreen() / 任何按屏幕坐标定位的 UI 在 raid 模式下全部算错。
    game.camera.x=this.camera.x; game.camera.y=this.camera.y;
  },

  _rayWall(x1,y1,x2,y2){
    const dx=x2-x1, dy=y2-y1; const len=Math.hypot(dx,dy);
    if(len<1) return null;
    const steps=Math.ceil(len/13);
    /* v0.24.0：圆形装饰按椭圆内判定，不再用 AABB —— 树的四个空角不该挡视线。
       与 _rayLight 的 round 分支同源（共用 w.round 标记）；13px 采样结构保留，
       这里只换形状判定，不改算法、不动移动 / 子弹碰撞，联机手感不变。 */
    const hit=(w,px,py)=>{
      if(w.round){
        const a=(w.w||0)*0.5, b=(w.h||0)*0.5;
        if(a<1e-6||b<1e-6) return false;
        const ux=(px-(w.x+a))/a, uy=(py-(w.y+b))/b;
        return ux*ux+uy*uy<=1;
      }
      return px>=w.x&&px<=w.x+w.w&&py>=w.y&&py<=w.y+w.h;
    };
    const CS=this.navCS, cols=this.navCols, rows=this.navRows;
    for(let i=1;i<=steps;i++){
      const t=i/steps, px=x1+dx*t, py=y1+dy*t;
      if(!CS){   // 索引未建立时的兜底
        for(const w of this.walls){
          if(w.sight!==false && hit(w,px,py)) return {x:px,y:py,t};
        }
        continue;
      }
      const gx=px/CS|0, gy=py/CS|0;
      if(gx<0||gy<0||gx>=cols||gy>=rows) return {x:px,y:py,t};
      const arr=this.losCell[gy*cols+gx];
      if(!arr) continue;
      for(let k=0;k<arr.length;k++){
        const w=arr[k];
        if(hit(w,px,py)) return {x:px,y:py,t};
      }
    }
    return null;
  },
  _los(x1,y1,x2,y2){ return !this._rayWall(x1,y1,x2,y2); },

  /* v0.22.3：手电专用射线。
     和 _rayWall 的三点不同：
       1) 走 navCell（**全部**碰撞体），所以灌木 / 岩石 / 废料堆也挡光 —— 视线可以穿过
          灌木（sight:false），但手电的光不该穿过去。
       2) 逐格 DDA + 精确 slab 求交，返回精确距离而不是 13px 采样的近似值。采样误差
          是「光照边缘毛刺 / 锯齿」的来源：40 条射线各自差十几像素，拼出来的轮廓就是花边。
       3) v0.24.0 起两者都认 `w.round`，但做法不同：_rayWall 是 13px 采样 + 椭圆内判定
          （够 AI 视线用），这里必须是**椭圆解析求交**拿到精确距离 —— 96 条射线要连成
          一条连续光锥边界，采样误差会让轮廓变成花边；矩形 slab 则让落点全贴着 AABB
          直边，拼出来就是玩家看到的「手电是个笔直三角形」。
     代价：格宽 256，560px 的光程只穿 2~3 格，比原来的 43 次采样更省。 */
  _rayLight(x1,y1,dx,dy,maxLen){
    const CS=this.navCS, cols=this.navCols, rows=this.navRows, idx=this.navCell;
    if(!CS || !idx) return maxLen;
    const len=Math.hypot(dx,dy);
    if(len<1e-6) return maxLen;
    const ux=dx/len, uy=dy/len;
    let gx=Math.floor(x1/CS), gy=Math.floor(y1/CS);
    if(gx<0||gy<0||gx>=cols||gy>=rows) return maxLen;
    const stepX=ux>0?1:-1, stepY=uy>0?1:-1;
    const adx=Math.abs(ux)<1e-9, ady=Math.abs(uy)<1e-9;
    const tdx=adx?Infinity:CS/Math.abs(ux);
    const tdy=ady?Infinity:CS/Math.abs(uy);
    let tmx=adx?Infinity:((ux>0?(gx+1)*CS:gx*CS)-x1)/ux;
    let tmy=ady?Infinity:((uy>0?(gy+1)*CS:gy*CS)-y1)/uy;
    let best=maxLen;
    for(let guard=0; guard<80; guard++){
      const arr=idx[gy*cols+gx];
      if(arr){
        for(let i=0;i<arr.length;i++){
          const w=arr[i];
          /* 圆形装饰：椭圆解析求交。
           * 把射线 P(t)=(x1+t·ux, y1+t·uy) 代入 ((x-ex)/a)²+((y-ey)/b)²=1，
           * 得到 A·t²+B·t+C=0。ux/uy 已单位化，除以半轴只改变方向系数，
           * t 依然是真实距离，可直接和 best 比较。
           * 取近根；近根 ≤0 说明起点就在椭圆里（玩家站在灌木中），按原矩形
           * 语义不掐光 —— 否则一进灌木手电会整片熄灭。 */
          if(w.round){
            const ax=(w.w||0)*0.5, by=(w.h||0)*0.5;
            if(ax<1e-6 || by<1e-6) continue;
            const ox=(x1-(w.x+ax))/ax, oy=(y1-(w.y+by))/by;
            const dx=ux/ax, dy=uy/by;
            const A=dx*dx+dy*dy;
            if(A<1e-12) continue;
            const B=2*(ox*dx+oy*dy), C=ox*ox+oy*oy-1;
            const disc=B*B-4*A*C;
            if(disc<0) continue;                 // 射线擦不到这个椭圆
            const tHit=(-B-Math.sqrt(disc))/(2*A);
            if(tHit>0.5 && tHit<best) best=tHit;
            continue;
          }
          let tmin=0, tmax=best;
          if(adx){ if(x1<w.x||x1>w.x+w.w) continue; }
          else {
            let a=(w.x-x1)/ux, b=(w.x+w.w-x1)/ux;
            if(a>b){ const t=a; a=b; b=t; }
            if(a>tmin) tmin=a;
            if(b<tmax) tmax=b;
            if(tmin>tmax) continue;
          }
          if(ady){ if(y1<w.y||y1>w.y+w.h) continue; }
          else {
            let a=(w.y-y1)/uy, b=(w.y+w.h-y1)/uy;
            if(a>b){ const t=a; a=b; b=t; }
            if(a>tmin) tmin=a;
            if(b<tmax) tmax=b;
            if(tmin>tmax) continue;
          }
          // tmin=0 说明发射点就在这个碰撞体里（站在灌木/墙里），不能因此把光全掐掉
          if(tmin>0.5 && tmin<best) best=tmin;
        }
      }
      if(tmx<tmy){ if(tmx>best) break; gx+=stepX; tmx+=tdx; }
      else { if(tmy>best) break; gy+=stepY; tmy+=tdy; }
      if(gx<0||gy<0||gx>=cols||gy>=rows) break;
    }
    return best;
  },

  _pointSeg(px,py,x1,y1,x2,y2){
    const dx=x2-x1, dy=y2-y1; const L2=dx*dx+dy*dy;
    if(L2===0) return Math.hypot(px-x1,py-y1);
    let t=((px-x1)*dx+(py-y1)*dy)/L2; t=M.clamp(t,0,1);
    const cx=x1+t*dx, cy=y1+t*dy;
    return Math.hypot(px-cx,py-cy);
  },

  aliveFoes(){ return this.ops.filter(o=>!o.isPlayer && !o.remote && o.alive).length; },
  lootValue(){
    let v=0; for(const w of this.inv.weapons) v+=w.value; for(const a of this.inv.armors) v+=a.value;
    for(const s of (this.inv.shields||[])) v+=s.value;
    return v;
  },

  /* ================= DOM 物品栏 + 逐件丢弃 ================= */
  _invToggleDom(){
    const el=document.getElementById('inv-layer');
    if(!el) return;
    if(!this.showInv){ el.classList.add('hidden'); el.innerHTML=""; return; }
    el.classList.remove('hidden');
    this._invRender();
  },
  _invRender(){
    const el=document.getElementById('inv-layer');
    if(!el || !this.showInv) return;
    const R=this, p=R.player;
    const bodyOld=el.querySelector('.inv-body');
    const scroll=bodyOld?bodyOld.scrollTop:0;
    const esc=t=>String(t==null?"":t).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
    const money=v=>"₽"+priceTextShort(v||0);
    const rows=[];
    const sec=(t,extra)=>rows.push(`<div class="inv-sec"><span>${t}</span><span>${extra||""}</span></div>`);
    /* drop / equip / use / stow / salvage 都是可选按钮位（stow、salvage 为 v0.21.6 新增） */
    const line=(name,col,meta,drop,equip,use,stow,salvage)=>{
      rows.push(`<div class="inv-row">
        <div class="ir-main"><div class="ir-name" style="color:${col||"#dfe7f0"}">${esc(name)}</div>
        <div class="ir-meta">${esc(meta||"")}</div></div>
        ${use?`<button class="inv-take" data-use="${use}">使用</button>`:""}
        ${equip?`<button class="inv-take" data-equip="${equip}">拿在手上</button>`:""}
        ${stow?`<button class="inv-take" data-stow="${stow}">放回背包</button>`:""}
        ${salvage?`<button class="inv-take" data-salvage="${salvage}">拆解</button>`:""}
        ${drop?`<button class="inv-drop" data-drop="${drop}">✕ 丢弃</button>`:""}
      </div>`);
    };

    /* 装备中（不可丢，防止误操作把手上的枪/盔甲扔掉） */
    sec("装备中","撤离成功才带回仓库");
    line("主武器 · "+(p.gun?gunNameOf(p.gun):
      "空手（跑刀 +"+Math.round((RAID_BAREHAND_SPEED-1)*100)+"% 移速）"), p.gun?raidGunColor(p.gun):"#8b95a5",
      p.gun?`${p.gun.ammoMag}/${p.gun.mag} 发 · 背包 ${p.gun.ammoRes} · ${p.gun.loaded?(ammoDefFromId(p.gun.loaded)||{}).short||"?" : "未装填"}`
           :"按 Q 从背包取枪", null, null, null, p.gun?"main":null);
    if(p.secondary) line("副武器 · "+gunNameOf(p.secondary), raidGunColor(p.secondary),
      `${p.secondary.ammoMag}/${p.secondary.mag} 发 · 背包 ${p.secondary.ammoRes} · ${p.secondary.loaded?(ammoDefFromId(p.secondary.loaded)||{}).short||"?" : "未装填"}`,
      null, null, null, "secondary");
    if(p.armorTier) line("护甲 · "+RAID_ARMORS[p.armorTier].name, ARMOR_TIER_COLOR[p.armorTier]||"#dfe7f0",
      `T${p.armorTier} · 耐久 ${Math.round(p.armor)}/${Math.round(p.maxArmor)} · 减伤 ${Math.round(p.dr*100)}%${p.armorTier>=RAID_ARMOR_TYPE_TIER?(p.armor>0?(' · 硬质插板（HP ×'+elemMult('corrosive','armor').toFixed(2)+'）'):' · 已击穿（无防护）'):''}`);
    if(p.helmetTier) line("头盔 · "+RAID_HELMETS[p.helmetTier].name, ARMOR_TIER_COLOR[p.helmetTier]||"#dfe7f0",
      `T${p.helmetTier} · 耐久 ${Math.round(p.helmetArmor)}/${Math.round(p.maxHelmetArmor)} · 躯干减伤 ${Math.round(p.helmetDr*HELMET_BODY_SHARE*100)}% / 爆头 ${Math.round(p.helmetDr*100)}%`);
    if(p.maxShield>0) line("护盾 · "+(p.shieldGear?p.shieldGear.name:"护盾模块"), "#4fd6ff",
      `容量 ${Math.round(p.shield)}/${Math.round(p.maxShield)} · 充能 ${p.shieldRate}/s · 延迟 ${p.shieldDelay}s · 破盾无敌 ${(p.shieldInvulnBase||0).toFixed(2)}s`);
    /* v0.24.0：负重反馈。减速是隐性的，玩家必须能在物品栏里看到「为什么跑不动」。 */
    const load=raidLoadOf(R);
    line("背包负重", load>0.6?"#ff8a5a":"#8fd0ff",
      Math.round(load*100)+"% · 移速 ×"+raidSpeedMul(R).toFixed(2)+
      " · 满载 -"+Math.round(RAID_LOAD_PENALTY*100)+"%");
    line("卢布", "#8fe07a", "₽ "+priceText(R.creds)+" · 撤离后结算进仓库");
    if((R.tokens||0)>0) line("GP 币", "#ffd23f", "◈ "+R.tokens+" · 撤离才落袋");

    /* 弹药栏（v0.20.0）：按口径 × 级别堆叠，总发数有上限 */
    {
      const ids=Object.keys(R.inv.ammo||{}).filter(id=>ammoParseId(id)&&R.inv.ammo[id]>0);
      ids.sort((a,b)=>{
        const A=ammoParseId(a), B=ammoParseId(b);
        return (AMMO_CAL_LIST.indexOf(A.cal)-AMMO_CAL_LIST.indexOf(B.cal)) || (B.lv-A.lv);
      });
      sec("弹药 · "+R._ammoTotal()+"/"+RAID_AMMO_CAP+" 发","换弹时自动扣这里的子弹");
      if(!ids.length){
        rows.push(`<div class="inv-row"><div class="ir-main"><div class="ir-name" style="color:#8b95a5">没有子弹</div>
          <div class="ir-meta">搜箱 / 商店 / 工坊合成都能拿到弹药</div></div></div>`);
      }
      for(const id of ids){
        const d=ammoDefFromId(id), n=R.inv.ammo[id];
        const E=AMMO_TYPES[d.elem]||AMMO_TYPES.none;
        const onGun=(p.gun&&p.gun.loaded===id)||(p.secondary&&p.secondary.loaded===id);
        line(d.name+(onGun?" · 已装填":""), d.color,
          `${d.spec} · T${d.lv} ${(AMMO_GRADE_BY_LV[d.lv]||{}).name||""} · 穿深 ${E.pen} · ${n} 发 · ${money(d.value*n)}`,
          `ammo:${id}`);
      }
    }

    /* 背包战利品（全部可丢，丢在脚下还能捡回来） */
    const capTxt=`武器 ${R.inv.weapons.length}/${RAID_INV_CAP.weapons} · 材料 ${R.inv.materials.length}/${RAID_INV_CAP.materials} · 钥匙 ${(R.inv.keys||[]).length}/${RAID_INV_CAP.keys}`;
    sec("背包 · 战利品","✕ 丢在脚下，之后还能捡回来");
    rows.push(`<div class="inv-sec" style="margin:0 4px 6px;color:#6f8296">${capTxt}</div>`);

    let any=false;
    const bag=R._gunBag?R._gunBag():[];
    for(const w of bag){
      const i=R.inv.weapons.indexOf(w);
      if(i<0) continue;
      any=true;
      const rtg=R._rtGun(w);
      line(gunNameOf(w), raidGunColor(w),
        `伤害 ${w.dmg} · 弹匣 ${rtg?rtg.ammoMag:0}/${w.mag} · 装填 ${rtg&&rtg.loaded?((ammoDefFromId(rtg.loaded)||{}).short||"?"):"未装填"} · 估值 ${money(w.value)}`,
        `weapons:${i}`, `weapons:${i}`);
    }
    for(let i=0;i<R.inv.armors.length;i++){
      const a=R.inv.armors[i]; any=true;
      line(a.name, RAID_RARITY_COLOR[a.rarity|0]||"#dfe7f0",
        `T${a.tier} · ${RAID_RARITY_NAME[a.rarity|0]||""} · 耐久 ${a.maxArmor} · ${money(a.value)}`, `armors:${i}`);
    }
    for(let i=0;i<R.inv.helmets.length;i++){
      const h=R.inv.helmets[i]; any=true;
      line(h.name, RAID_RARITY_COLOR[h.rarity|0]||"#dfe7f0",
        `T${h.tier} · ${RAID_RARITY_NAME[h.rarity|0]||""} · 耐久 ${h.maxArmor} · ${money(h.value)}`, `helmets:${i}`);
    }
    for(let i=0;i<(R.inv.shields||[]).length;i++){
      const s=R.inv.shields[i]; any=true;
      line(s.name, shieldColor(s),
        `T${s.tier} 护盾 · ${shieldLines(s).slice(0,3).join(" · ")} · ${money(s.value)}`, `shields:${i}`);
    }
    for(let i=0;i<R.inv.parts.length;i++){
      const pt=R.inv.parts[i]; any=true;
      /* v0.21.7：与枪械同一套显示分层 —— 精简只留槽位名，完整才给词缀名 / 品质 / iLv。
       * 效果行（partText）两种模式都保留：那是「属性」不是「词缀名」，和枪的伤害 / 弹匣一样必须可见，
       * 否则两件「下挂」在精简模式下完全分不清。行宽只有一行，所以这里不再塞拆解产出（按钮上已有）。 */
      const col=partColor(pt);
      const qn=partQualityName(pt);
      const slotName=pt.core?"改装模块":((GUN_SLOT_BY_ID[pt.slot]||{}).name||pt.slot||"配件");
      const sv = raidSalvageYield(pt);
      const eff = partText(pt) || slotName;
      const meta = `${eff} · ${slotName}${qn?" · "+qn:""}${weaponQualityHidden()?"":` · iLv ${pt.ilvl||1}`} · 估值 ${money(pt.value||partValue(pt))}`;
      line(partNameOf(pt), col, meta, `parts:${i}`, null, null, null, sv?`parts:${i}`:null);
    }
    for(let i=0;i<R.inv.materials.length;i++){
      const m=R.inv.materials[i]; any=true;
      line(m.name, m.color||"#dfe7f0", `T${m.tier} · 估值 ${money(m.value)}`, `materials:${i}`);
    }
    for(let i=0;i<R.inv.receivers.length;i++){
      const r=R.inv.receivers[i]; any=true;
      line(r.name, r.color||"#8fd0ff", `底材 · 估值 ${money(r.value)}`, `receivers:${i}`);
    }
    for(let i=0;i<(R.inv.keys||[]).length;i++){
      const k=R.inv.keys[i]; any=true;
      line(k.name, k.color||"#ffd23f",
        `${RAID_LOCK_NAME[M.clamp(k.lv||1,1,5)]} · 剩 ${k.uses}/${k.maxUses||k.uses} 次 · ${money(k.value)}`, `keys:${i}`);
    }
    for(let i=0;i<R.inv.meds.length;i++){
      const m=R.inv.meds[i]; any=true;
      const md=RAID_MED_BY_ID[m.id]||{};
      line(m.name+(m.n>1?" ×"+m.n:""), m.color||"#ff9a9a",
        `${md.desc||"医疗品"} · 丢弃 1 件`, `meds:${i}`, null, `meds:${i}`);
    }
    if(R.bandages>0){ any=true; line("绷带 ×"+R.bandages, "#ff9a9a", "止血 · 丢弃 1 卷", "bandage:0", null, "bandage:0"); }
    if(!any) rows.push(`<div class="inv-empty">背包是空的 · 去翻箱、摸尸体，撤离前记得清点。</div>`);

    el.innerHTML=`<div class="inv-card">
      <div class="inv-head"><b>物品栏</b><span class="inv-sub">${Input.isTouch?"点背包键关闭":"Tab 关闭"} · 游戏继续运行</span></div>
      <div class="inv-body">${rows.join("")}</div>
      <div class="inv-foot">背包枪点「拿在手上」可立即换枪（旧枪自动回背包）；丢弃会把物品放在脚下（发光小包裹），腾出格子后可以再捡回来；阵亡或超时则全部丢失。</div>
    </div>`;
    const nb=el.querySelector('.inv-body');
    if(nb) nb.scrollTop=scroll;
    el.querySelectorAll('[data-equip]').forEach(btn=>{
      btn.onclick=(e)=>{
        e.preventDefault(); e.stopPropagation();
        const idx=parseInt(String(btn.dataset.equip).split(":")[1],10)||0;
        this._invEquip(idx);
      };
    });
    el.querySelectorAll('[data-drop]').forEach(btn=>{
      btn.onclick=(e)=>{
        e.preventDefault(); e.stopPropagation();
        const [type,idx]=btn.dataset.drop.split(":");
        this._invDrop(type, type==="ammo" ? idx : (parseInt(idx,10)||0));
      };
    });
    el.querySelectorAll('[data-use]').forEach(btn=>{
      btn.onclick=(e)=>{
        e.preventDefault(); e.stopPropagation();
        const [type,idx]=btn.dataset.use.split(":");
        this._invUse(type, parseInt(idx,10)||0);
      };
    });
    /* v0.21.6：放回背包（主手 / 副手） */
    el.querySelectorAll('[data-stow]').forEach(btn=>{
      btn.onclick=(e)=>{
        e.preventDefault(); e.stopPropagation();
        if(this._stowGun(btn.dataset.stow)){ this._invDirty=false; this._invRender(); }
      };
    });
    /* v0.21.6：配件拆解 → 原材料 */
    el.querySelectorAll('[data-salvage]').forEach(btn=>{
      btn.onclick=(e)=>{
        e.preventDefault(); e.stopPropagation();
        const idx=parseInt(String(btn.dataset.salvage).split(":")[1],10)||0;
        if(this._salvagePart(idx)){ this._invDirty=false; this._invRender(); }
      };
    });
  },

  /* 在当前战局里拆配件：配件离开配件栏，产出材料直接进材料栏（材料栏满就不给拆）。
   * 仓库里的配件走 UI.raidStash 的同一套 raidSalvageYield 折算。 */
  _salvagePart(idx){
    const p=this.player, pt=(this.inv.parts||[])[idx];
    if(!p || !pt) return false;
    const y=raidSalvageYield(pt);
    if(!y || !y.length){
      this._pick(p.x, p.y-34, "改装模块不能拆解", "#ff8a5a");
      return false;
    }
    if((this.inv.materials||[]).length + y.length > RAID_INV_CAP.materials){
      this._pick(p.x, p.y-34, "材料栏空间不足 · 先腾出格子", "#ff8a5a");
      return false;
    }
    this.inv.parts.splice(idx,1);
    const names=[];
    for(const g of y){
      const base=RAID_MAT_BY_ID[g.id];
      if(!base) continue;
      for(let i=0;i<g.n;i++)
        this.inv.materials.push({ id:base.id, name:base.name, tier:base.tier, value:base.value, tag:base.tag, color:RAID_RARITY_COLOR[base.tier] });
      names.push(base.name+"×"+g.n);
    }
    this._invDirty=true;
    this._pick(p.x, p.y-34, "拆解 "+partNameOf(pt)+" → "+names.join(" + "), "#8fe07a");
    SFX.pickup();
    return true;
  },
  /* 物品栏点「使用」：绷带与四种医疗品都走同一条 _medStart 流程 */
  _invUse(type, idx){
    const p=this.player;
    let id=null;
    if(type==="bandage") id="bandage";
    else if(type==="meds"){ const m=this.inv.meds[idx]; if(m) id=m.id; }
    if(!id) return;
    if(this.medT>0){ this._float(p.x,p.y-46,"正在治疗…","#ffb35a"); return; }
    if(!this._medStart(id)){
      this._float(p.x,p.y-46,"没有 "+((RAID_MED_BY_ID[id]||{}).name||"医疗品"),"#ff8a5a");
      return;
    }
    SFX.ui();
    this._invDirty=false;
    this._invRender();
  },
  /* 从物品栏直接把背包枪拿在手上（与 Q 键同逻辑，旧枪自动回背包） */
  _invEquip(idx){
    const it=(this.inv.weapons||[])[idx];
    if(!it) return;
    const g=this._rtGun(it);
    if(!g || g===this.player.gun) { this._invRender(); return; }
    if(this.player.reloadT>0) this.player.reloadT=0;   // 换枪即打断换弹
    this._equipGun(g);
    SFX.ui();
    this._invDirty=false;
    this._invRender();
  },

  _invDrop(type, idx){
    /* 弹药按 id 丢：整条落在地上，之后还能捡回来 */
    if(type==="ammo"){
      const id=String(idx||"");
      const n=this._ammoCount(id);
      if(n<=0) return;
      const d=ammoDefFromId(id);
      this._ammoTake(id, n);
      const it=Object.assign({}, d, { n });
      this._dropGround(it, this.player.x, this.player.y);
      this._float(this.player.x, this.player.y-46, "丢弃 "+n+" 发 "+d.short, "#ff9a8a");
      SFX.ui();
      this._invDirty=false;
      this._invRender();
      return;
    }
    const R=this, p=R.player;
    let it=null;
    const take=(arr)=>{ if(!arr || idx<0 || idx>=arr.length) return null; return arr.splice(idx,1)[0]; };
    if(type==="weapons") it=take(R.inv.weapons);
    else if(type==="armors") it=take(R.inv.armors);
    else if(type==="helmets") it=take(R.inv.helmets);
    else if(type==="shields") it=take(R.inv.shields||[]);
    else if(type==="parts") it=take(R.inv.parts);
    else if(type==="materials") it=take(R.inv.materials);
    else if(type==="receivers") it=take(R.inv.receivers);
    else if(type==="keys") it=take(R.inv.keys||[]);
    else if(type==="meds"){
      const m=R.inv.meds[idx];
      if(!m) return;
      if(m.n>1){ m.n--; it={ kind:"med", id:m.id, name:m.name, n:1, color:m.color, tier:m.tier }; }
      else it=R.inv.meds.splice(idx,1)[0];
    } else if(type==="bandage"){
      if(R.bandages<=0) return;
      R.bandages--;
      it={ kind:"med", id:"bandage", name:"绷带", n:1, color:"#ff9a9a" };
    }
    if(!it) return;
    R._dropGround(it, p.x, p.y);
    R._pick(p.x, p.y-46, "丢弃 "+it.name, "#ff9a8a");
    SFX.ui();
    R._invDirty=false;
    this._invRender();
  },

});
