/* =========================================================================
 * raid-fx.js — 打击感 / 反馈类视觉工具（Raid 的方法）
 * v0.41.0：从 raid-core3.js 拆出（该文件顶到 2000 行上限），并把命中火花升级为
 *   方向性反弹锥。这里只放「产生粒子 / 飘字 / 提示 / 震屏」的入口，真正的绘制在
 *   raid-render.js 的 scene()/unit() 里 —— 逻辑与表现分开放，改数值不碰渲染。
 * ========================================================================= */
Object.assign(Raid, {
  /* 命中火花。
   * ang = 子弹飞来的方向（rad）。传了就按「反弹锥」散开 —— 主轴是来向的反向 ±0.9rad，
   * 命中点一眼能看出弹从哪边打来；不传则保持 360° 均布（元素 DOT / 辐射连锁这类无方向的） */
  spawnHit(x,y,color,ang){
    for(let i=0;i<6;i++){
      const a=(ang===undefined) ? Math.random()*6.28 : ang+Math.PI+(Math.random()-0.5)*1.8;
      const s=Math.random()*120+40;
      this.particles.push({x,y,vx:Math.cos(a)*s,vy:Math.sin(a)*s,life:0.3,maxLife:0.3,color,size:2.6});
    }
  },

  // 冰冻命中的冰晶散射（配合 unit() 里的冰霜环 / 结晶）
  _freezeBurst(x,y){
    for(let i=0;i<9;i++){ const a=Math.random()*6.28, s=Math.random()*80+30;
      this.particles.push({x,y,vx:Math.cos(a)*s,vy:Math.sin(a)*s,life:0.55,maxLife:0.55,
        color:i%2?"#bdefff":"#6fd6ff",size:2.4}); }
  },

  _float(x,y,text,color){ this.floats.push({x,y,text,color:color||"#fff",life:0.9,maxLife:0.9,vy:-30,size:13}); },

  /* 3D 拾取提示：2D 的 _float 画在世界坐标系（scene() 里已 translate 到相机），
     第一人称渲染器不铺那层变换，所以「+ 5.45×39 PS」这类文字在 3D 下看不见。
     拾取 / 丢弃 / 治疗改成额外推一条屏幕空间提示条，由 hud() 在 3D 时绘制。 */
  _toast(text, color){
    if(!text) return;
    if(typeof ViewMode==="undefined" || !ViewMode.is3D()) return;
    this.toasts=this.toasts||[];
    this.toasts.push({ text:String(text), color:color||"#dfe7f0", life:3.0, maxLife:3.0 });
    if(this.toasts.length>6) this.toasts.splice(0, this.toasts.length-6);
  },

  /* 双通道：2D 走世界浮动文字，3D 走屏幕提示条（_toast 内部自己判断维度） */
  _pick(x,y,text,color){ this._float(x,y,text,color); this._toast(text,color); },

  _feed(a,v,gun,mine,type){
    this.killfeed.unshift({a,v,gun,mine:!!mine,type:type||"kill",t:6});
    if(this.killfeed.length>6) this.killfeed.pop();
  },

  _screenToWorld(sx,sy,game){
    const z=game.zoom||1;
    return { x:this.camera.x+sx/z, y:this.camera.y+sy/z };
  },

  /* 震屏：只作用在世界层（raid-render 的 scene 变换），HUD / 暗角不动。
     有病治病式地夹住上限 —— 连发时每发都调一次 max()，不会累加成一团乱晃。 */
  shakeAdd(px){
    const v=Number(px);
    if(!Number.isFinite(v) || v<=0) return;
    this.shake=Math.max(this.shake||0, Math.min(10, v));
  },
});
