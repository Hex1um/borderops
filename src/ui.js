/* =========================================================================
 * ui.js — 覆盖层界面
 * 标题/模式选择 / 选角 / 技能树 / 武器库 / 商店 / 购买菜单 / 暂停 / 结算
 * ========================================================================= */

const UI = {
  game:null,
  overlay:null,
  _mode:"raid",            // 当前选择的模式（主模式为塔科夫）
  _moreModes:false,        // 标题页「其他模式」折叠面板是否展开
  _buyTimer:null,

  init(game){ this.game=game; this.overlay=document.getElementById('overlay'); },
  hide(){
    this.overlay.classList.add('hidden');
    this.overlay.innerHTML='';
    if(this._buyTimer){ clearInterval(this._buyTimer); this._buyTimer=null; }
    if(this._aucTimer){ clearInterval(this._aucTimer); this._aucTimer=null; }
  },
  show(){
    this.overlay.classList.remove('hidden');
    const hud=document.getElementById('hud'); if(hud) hud.classList.add('hidden');
    const tl=document.getElementById('touch-layer'); if(tl) tl.classList.add('hidden');
  },
  /* 滚动位置快照 —— 记录 overlay 内**所有**可滚动容器（面板本身、
   * 武器/护甲/仓库/商店列表……），重绘后按「选择器 + 同类序号」原位恢复。
   * 之前只存了 panel 的 scrollTop，选枪时列表自己弹回顶部，正是漏了 .raid-list。 */
  _snapScroll(){
    const ov=this.overlay;
    if(!ov || ov.classList.contains('hidden')) return null;
    const out=[];
    const nodes=ov.querySelectorAll('.panel,.panel *');
    for(let i=0;i<nodes.length;i++){
      const el=nodes[i];
      if(!el.scrollTop && !el.scrollLeft) continue;
      if(el.scrollHeight<=el.clientHeight+2 && el.scrollWidth<=el.clientWidth+2) continue;
      const cls=[...el.classList].join(".");
      const sel=el.tagName.toLowerCase()+(cls?"."+cls:"");
      let idx=0;
      try{
        const list=ov.querySelectorAll(sel);
        for(let k=0;k<list.length;k++){ if(list[k]===el){ idx=k; break; } }
      }catch(e){ continue; }
      out.push({ sel, idx, t:el.scrollTop, l:el.scrollLeft });
    }
    return out;
  },
  _restoreScroll(mem){
    if(!mem || !mem.length) return;
    for(const m of mem){
      try{
        const el=this.overlay.querySelectorAll(m.sel)[m.idx];
        if(!el) continue;
        if(m.t) el.scrollTop=m.t;
        if(m.l) el.scrollLeft=m.l;
      }catch(e){}
    }
  },
  _pageKey(){
    const h=this.overlay?this.overlay.querySelector('.panel h2'):null;
    return h?(h.textContent||"").trim():"";
  },
  _set(html, keep){
    /* keep=true 或「同一页重绘」都保留滚动：同页靠 panel 标题判定，
     * 换页（配装大厅 → 超市）则从头开始，符合直觉。 */
    const before=this._pageKey();
    const mem=this._snapScroll();
    this.overlay.innerHTML=html; this.show();
    const after=this._pageKey();
    if(keep || (before && before===after)){
      this._restoreScroll(mem);
    } else {
      // 换页：浏览器会沿用旧 scrollTop（高度相近时），显式拉回顶部
      this.overlay.scrollTop=0;
      const pan=this.overlay.querySelector('.panel');
      if(pan) pan.scrollTop=0;
    }
  },

  /* 重绘时保留滚动位置：卖东西后不要弹回顶部 */
  _keepScroll(fn){
    const mem=this._snapScroll();
    fn();
    this._restoreScroll(mem);
  },

  /* ---------------- 标题 ---------------- */
  title(){
    const hasSave = Save.has();
    const armed = !!this._wipeArm;
    const more = !!this._moreModes;
    const onlyRaid = CFG.onlyRaid !== false;
    this._set(`
      <div class="panel" style="text-align:center;">
        <h1 class="title-big">边境行动</h1>
        <div class="subtitle">BORDER OPS · WEB · v${CFG.version} · 撤离突袭 · 词缀枪械 · 黑市经济</div>

        <div class="mode-hero" data-mode="raid" role="button" tabindex="0" aria-label="进入塔科夫模式">
          <div class="hero-top">
            <span class="hero-kicker"><span class="kick-full">主模式 · MAIN MODE</span><span class="kick-short">主模式</span></span>
            <span class="hero-live"><span class="live-full">2~4 人联机</span><span class="live-short">联机</span></span>
          </div>
          <h2>塔科夫模式</h2>
          <div class="hero-tag">ESCAPE FROM TARKOV · 硬核撤离射击</div>
          <p>PMC 与 Scav 同场，流血、包扎、条件撤离点与装备保险——<b>只有活着撤离，装备才会入库</b>。
            配装大厅内含军火超市 / 枪匠台 / 仓库 / 拍卖行，进图后还有枪械店、材料店、回收超市与黑市。</p>
          <div class="hero-chips">
            <span>13000×9600 大地图</span>
            <span>密林 · 河谷 · 铁路枢纽</span>
            <span>五级钥匙金库</span>
            <span>GP 币</span>
          </div>
          <div class="hero-cta">进入配装大厅 <span class="hero-arrow">→</span></div>
        </div>

        <div class="title-actions">
          ${onlyRaid?'':`<button class="btn ghost small" id="btn-more-modes" aria-expanded="${more?"true":"false"}" aria-controls="more-modes">
            ${more?'▴ <span class="mm-full">收起其他模式</span><span class="mm-short">收起</span>'
                   :'▾ <span class="mm-full">其他模式 · 战役 / 无尽 / 沙二 / 大逃杀</span><span class="mm-short">其他模式</span>'}
          </button>`}
          ${!onlyRaid&&hasSave?`<button class="btn ghost small" id="btn-continue">继续战役存档</button>`:''}
          <button class="btn ghost small" id="btn-export">导出存档码</button>
          <button class="btn ghost small" id="btn-import">导入存档码</button>
          <button class="btn ghost small btn-del" id="btn-wipe">删除存档</button>
        </div>

        ${armed?`<div class="wipe-box">
          确认删除本机全部存档？<br>
          ${onlyRaid?'':'战役进度 · '}塔科夫仓库（枪械/护甲/材料/改装模块）· 拍卖行挂单与成交记录，全部清空且<b>不可恢复</b>。
          <div class="row">
            <button class="btn small danger" id="btn-wipe-yes">确认删除</button>
            <button class="btn small ghost" id="btn-wipe-no">取消</button>
          </div>
        </div>`:''}

        ${this._exportCode?`<div class="wipe-box save-box" id="save-export-box">
          <div style="margin-bottom:6px;">存档码已生成（含战役进度 / 塔科夫仓库 / 拍卖行）。复制后妥善保存，换域名或清缓存后用「导入存档码」恢复：</div>
          <textarea id="export-code" readonly rows="4" spellcheck="false">${this._exportCode}</textarea>
          <div class="row">
            <button class="btn small" id="btn-export-copy">复制</button>
            <button class="btn small ghost" id="btn-export-close">关闭</button>
          </div>
        </div>`:''}
        ${this._importArm?`<div class="wipe-box save-box" id="save-import-box">
          <div style="margin-bottom:6px;">粘贴存档码。导入会<b>覆盖</b>本机同名存档，建议先导出备份：</div>
          <textarea id="import-code" rows="4" spellcheck="false" placeholder="BOPS1-..."></textarea>
          ${this._importMsg?`<div style="margin-top:6px;color:var(--accent);">${String(this._importMsg).replace(/[&<>"']/g,'')}</div>`:''}
          <div class="row">
            <button class="btn small danger" id="btn-import-go">确认导入</button>
            <button class="btn small ghost" id="btn-import-cancel">取消</button>
          </div>
        </div>`:''}

        ${onlyRaid?'':`<div class="mode-more ${more?"":"hidden"}" id="more-modes">
          <div class="mode-grid">
            <div class="mode-card" data-mode="campaign" role="button" tabindex="0">
              <div class="mode-ico">▮</div>
              <h3>战役模式</h3>
              <div class="mode-tag">CAMPAIGN</div>
              <p>十片区域推进，击败军械库守卫解锁<b style="color:#ff5ce0">改装</b>与<b style="color:var(--accent)">重新部署</b>。</p>
            </div>
            <div class="mode-card" data-mode="endless" role="button" tabindex="0">
              <div class="mode-ico">∞</div>
              <h3>无尽模式</h3>
              <div class="mode-tag">ENDLESS</div>
              <p>无限波次，怪物只增不减，每 5 波一个首领。看你能撑到第几波。</p>
            </div>
            <div class="mode-card" data-mode="dust2" role="button" tabindex="0">
              <div class="mode-ico">✦</div>
              <h3>沙二模式</h3>
              <div class="mode-tag">DUST II · 5V5</div>
              <p>CS2 竞技规则：爆破、经济、五列购买菜单。可选原版枪械或旧刷宝体系枪械。</p>
            </div>
            <div class="mode-card" data-mode="br" role="button" tabindex="0">
              <div class="mode-ico">◈</div>
              <h3>大逃杀</h3>
              <div class="mode-tag">BATTLE ROYALE · 绝地岛</div>
              <p>PUBG 式缩圈生存：空降绝地岛，搜枪搜甲，安全区不断收缩，活到最后一人吃鸡。</p>
            </div>
          </div>
        </div>`}

        <div class="hint">
          ${onlyRaid?'':`<span class="hint-desk">
            桌面：<span class="kbd">W A S D</span> 移动 · <span class="kbd">鼠标</span> 瞄准 · <span class="kbd">左键</span> 开火 ·
            <span class="kbd">R</span> 换弹 · <span class="kbd">空格</span> 技能 · <span class="kbd">F</span> 近战 ·
            <span class="kbd">Q</span> 切枪 · <span class="kbd">K</span> 技能树 · <span class="kbd">Tab</span> 装备 · <span class="kbd">Esc</span> 暂停<br>
            沙二：<span class="kbd">B</span> 购买 · <span class="kbd">E</span> 下包/拆包 · <span class="kbd">G</span> 手雷 ·
            大逃杀：<span class="kbd">E</span> 用医疗 · 活到最后吃鸡<br>
          </span>`}
          塔科夫模式：<span class="kbd">WASD</span> 移动 · <span class="kbd">左键</span> 开火 · <span class="kbd">E</span> 搜索 ·
          <span class="kbd">H</span> 绷带止血 · <span class="kbd">Q</span> 换枪 · <span class="kbd">Tab</span> 物品栏 · 站上撤离点坚守数秒<br>
          移动端：左半屏拖动 · 右下扳机开火 · <span class="kbd">AUTO</span> 自动开火
        </div>
      </div>`);
    this.overlay.querySelectorAll('.mode-card,.mode-hero').forEach(el=>{
      const go=()=>{ SFX.ui(); this.pickMode(el.dataset.mode); };
      el.onclick=go;
      el.onkeydown=e=>{
        if(e.key==="Enter"||e.key===" "){ e.preventDefault(); go(); }
      };
    });

    // 其他模式折叠面板：记住状态，重绘（删除存档确认等）后仍然保持展开
    const moreBtn=document.getElementById('btn-more-modes');
    if(moreBtn) moreBtn.onclick=()=>{
      SFX.ui(); this._moreModes=!this._moreModes; this.title();
    };

    // v0.21.9：按钮只在 !onlyRaid&&hasSave 时渲染，这里必须判空，否则旧档会抛 TypeError 中断初始化
    const contBtn=document.getElementById('btn-continue');
    if(contBtn) contBtn.onclick=()=>{ SFX.ui(); this.game.continueRun(); };

    // 删除存档：两段式确认（避免误触），6 秒不操作自动收回
    const wipe=document.getElementById('btn-wipe');
    if(wipe) wipe.onclick=()=>{
      SFX.ui(); this._wipeArm=true; this.title();
      clearTimeout(this._wipeT);
      this._wipeT=setTimeout(()=>{ this._wipeArm=false; if(this.game.state==="title") this.title(); },6000);
    };
    const wipeNo=document.getElementById('btn-wipe-no');
    if(wipeNo) wipeNo.onclick=()=>{ SFX.ui(); this._wipeArm=false; clearTimeout(this._wipeT); this.title(); };
    // 确认框在窄屏可能落在视口外，弹出自定滚过去
    if(armed){
      const wb=this.overlay.querySelector('.wipe-box');
      if(wb) wb.scrollIntoView({block:"center",behavior:"smooth"});
    }
    const wipeYes=document.getElementById('btn-wipe-yes');
    if(wipeYes) wipeYes.onclick=()=>{
      SFX.levelup();
      Save.clearAll();
      this._wipeArm=false; clearTimeout(this._wipeT);
      UI._raidSel={w:[],a:null,h:null}; UI._raidIns=false;
      UI._aucTab="bid"; UI._aucSellTab="weapon";
      this.game.toTitle();
      this.game.toast("存档已删除，进度已重置");
    };

    // v0.22.0：存档码导出 / 导入（解绑域名，换浏览器 / 清缓存可自保）
    const exBtn=document.getElementById('btn-export');
    if(exBtn) exBtn.onclick=()=>{
      SFX.ui();
      const code=Save.exportCode();
      if(!code){ this.game.toast("暂无存档可导出（先进入一次游戏）"); return; }
      this._exportCode=code; this._importArm=false; this._importMsg=""; this.title();
      const t=document.getElementById('export-code');
      if(t){ t.focus(); t.select(); }
      const box=document.getElementById('save-export-box');
      if(box) box.scrollIntoView({block:"center",behavior:"smooth"});
    };
    const exClose=document.getElementById('btn-export-close');
    if(exClose) exClose.onclick=()=>{ SFX.ui(); this._exportCode=null; this.title(); };
    const exCopy=document.getElementById('btn-export-copy');
    if(exCopy) exCopy.onclick=()=>{
      SFX.ui();
      const t=document.getElementById('export-code');
      const done=()=>this.game.toast("存档码已复制");
      if(!t) return;
      t.select();
      if(navigator.clipboard && navigator.clipboard.writeText)
        navigator.clipboard.writeText(this._exportCode||t.value).then(done,()=>{ try{document.execCommand('copy');}catch(e){} done(); });
      else { try{document.execCommand('copy');}catch(e){} done(); }
    };
    const imBtn=document.getElementById('btn-import');
    if(imBtn) imBtn.onclick=()=>{
      SFX.ui(); this._importArm=true; this._importMsg=""; this._exportCode=null; this.title();
      const box=document.getElementById('save-import-box');
      if(box) box.scrollIntoView({block:"center",behavior:"smooth"});
    };
    const imCancel=document.getElementById('btn-import-cancel');
    if(imCancel) imCancel.onclick=()=>{ SFX.ui(); this._importArm=false; this._importMsg=""; this.title(); };
    const imGo=document.getElementById('btn-import-go');
    if(imGo) imGo.onclick=()=>{
      SFX.ui();
      const t=document.getElementById('import-code');
      const r=Save.importCode(t?t.value:"");
      if(r.ok){
        this._importArm=false; this._importMsg="";
        this.title();
        this.game.toast(r.msg);
      } else {
        this._importMsg=r.msg; this.title();
      }
    };
  },

  pickMode(mode){
    // 默认只开放塔科夫模式；其他模式代码保留，但入口隐藏且禁止绕过。
    if(CFG.onlyRaid !== false && mode!=="raid") mode="raid";
    this._mode=mode;
    if(mode==="dust2") this.dustSetup();
    else if(mode==="raid") this.raidSetup();
    else if(mode==="br") this.brSetup();
    else this.charSelect();
  },

  /* ---------------- 选角 ---------------- */
  charSelect(){
    const mode=this._mode;
    const cards=Object.values(CLASSES).map(c=>`
      <div class="class-card" data-id="${c.id}">
        <div class="tag">${c.tag}</div>
        <h3 style="color:${c.color}">${c.name}</h3>
        <div class="tag">主动：${c.ability.name}</div>
        <p>${c.desc}</p>
      </div>`).join('');
    this._set(`
      <div class="panel">
        <h2 class="title-big" style="font-size:34px;">选择你的 PMC</h2>
        <div class="subtitle">${mode==="endless"?"ENDLESS TRIAL · 无尽试炼":"CHOOSE YOUR VAULT HUNTER"}</div>
        <div class="grid-class">${cards}</div>
        <div class="row" style="margin-top:16px;justify-content:flex-end;">
          <button class="btn ghost small" id="btn-back">返回</button>
          <button class="btn" id="btn-start" disabled style="opacity:.5;">${mode==="endless"?"进入试炼场":"进入海关流域"}</button>
        </div>
      </div>`);
    let sel=null;
    this.overlay.querySelectorAll('.class-card').forEach(el=>{
      el.onclick=()=>{
        this.overlay.querySelectorAll('.class-card').forEach(x=>x.classList.remove('sel'));
        el.classList.add('sel'); sel=el.dataset.id; SFX.ui();
        const b=document.getElementById('btn-start'); b.disabled=false; b.style.opacity=1;
      };
    });
    document.getElementById('btn-back').onclick=()=>{ SFX.ui(); this.title(); };
    document.getElementById('btn-start').onclick=()=>{
      if(!sel) return; SFX.ui();
      if(this._mode==="endless") this.game.startEndless(sel);
      else this.game.startRun(sel);
    };
  },

  /* ---------------- 沙二模式设置 ---------------- */
  dustSetup(){
    this._set(`
      <div class="panel" style="text-align:center;max-width:760px;">
        <h2 class="title-big" style="font-size:36px;">沙二 · 5V5</h2>
        <div class="subtitle">DUST II · COMPETITIVE · MR12</div>
        <p style="color:var(--muted);max-width:600px;margin:0 auto 14px;">
          CS2 竞技规则：先拿 13 分获胜，半场换边。手枪局 $800 起手，
          击杀有奖励、连败有补偿，冻结时间打开购买菜单。</p>

        <div class="dust-opt">
          <h4>枪械卡池</h4>
          <div class="opt-row">
            <div class="opt-card on" data-gun="cs2">
              <b>CS2 原版枪械</b>
              <span>AK-47 / M4A4 / AWP …… 真实伤害、护甲穿透与射速</span>
            </div>
            <div class="opt-card" data-gun="bl">
              <b>旧刷宝体系枪械</b>
              <span>${weaponQualityHidden()?"程序化生成的词缀枪（精简显示：只留型号）":"程序化生成的词缀枪，品质越高越离谱"}</span>
            </div>
          </div>
        </div>

        <div class="dust-opt">
          <h4>初始阵营</h4>
          <div class="opt-row">
            <div class="opt-card on" data-side="ct">
              <b>CT · 防守方</b>
              <span>守点、拆包，默认 USP-S</span>
            </div>
            <div class="opt-card" data-side="t">
              <b>T · 进攻方</b>
              <span>下包、抢点，默认 Glock-18</span>
            </div>
          </div>
        </div>

        <div class="row" style="justify-content:center;margin-top:18px;">
          <button class="btn ghost" id="btn-back">返回</button>
          <button class="btn" id="btn-dust-start">开始比赛</button>
        </div>
      </div>`);

    let gunSet="cs2", side="ct";
    this.overlay.querySelectorAll('[data-gun]').forEach(el=>{
      el.onclick=()=>{
        this.overlay.querySelectorAll('[data-gun]').forEach(x=>x.classList.remove('on'));
        el.classList.add('on'); gunSet=el.dataset.gun; SFX.ui();
      };
    });
    this.overlay.querySelectorAll('[data-side]').forEach(el=>{
      el.onclick=()=>{
        this.overlay.querySelectorAll('[data-side]').forEach(x=>x.classList.remove('on'));
        el.classList.add('on'); side=el.dataset.side; SFX.ui();
      };
    });
    document.getElementById('btn-back').onclick=()=>{ SFX.ui(); this.title(); };
    document.getElementById('btn-dust-start').onclick=()=>{
      SFX.ui(); this.game.startDust2({ gunSet, side });
    };
  },

  /* ---------------- 区域剧情卡 ---------------- */
  story(z){
    const idx=(z.index||0)+1, total=z.total||(typeof ZONES!=="undefined"?ZONES.length:4);
    this._set(`
      <div class="panel story-panel" style="max-width:640px;text-align:left;">
        <div class="story-tag">区域 ${idx} / ${total} · 推荐等级 ${z.level}</div>
        <h2 class="title-big" style="font-size:36px;margin:6px 0 12px;">${z.name}</h2>
        <p class="story-text">${z.story}</p>
        <div class="row" style="margin-top:20px;justify-content:flex-end;">
          <button class="btn" id="btn-story-go">踏入区域</button>
        </div>
      </div>`);
    document.getElementById('btn-story-go').onclick=()=>{ SFX.ui(); this.game.beginAfterStory(); };
  },

  /* ---------------- 技能树 ---------------- */
  skillTree(){
    const p=this.game.player; const list=SKILLS[p.classId];
    const nodes=list.map(sk=>{
      const lvl=p.skills[sk.id]||0;
      return `<div class="skill-node ${lvl>0?'act':''}">
        <div class="pts">${lvl}</div>
        <h4>${sk.name}</h4>
        <div class="desc">${sk.desc(lvl)}</div>
        <button class="btn small" data-id="${sk.id}" ${p.skillPoints<=0?'disabled style="opacity:.4;"':''}>+1</button>
      </div>`;
    }).join('');
    this._set(`
      <div class="panel">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <h2 class="title-big" style="font-size:30px;">${CLASSES[p.classId].name} · 技能树</h2>
          <div style="color:var(--green);font-weight:800;">可用技能点：${p.skillPoints}</div>
        </div>
        <div class="subtitle">主动技能：${p.abilityName}（冷却 ${p.abilityBaseCD}s）</div>
        <div class="skill-grid">${nodes}</div>
        <div class="row" style="margin-top:14px;justify-content:flex-end;">
          <button class="btn" id="btn-close">返回战斗</button>
        </div>
      </div>`);
    this.overlay.querySelectorAll('.skill-node button').forEach(b=>{
      b.onclick=()=>{ if(p.addSkill(b.dataset.id)){ SFX.ui(); this.skillTree(); } };
    });
    document.getElementById('btn-close').onclick=()=>{ SFX.ui(); this.hide(); this.game.resume(); };
  },

  /* ---------------- 装备库 ---------------- */
  inventory(){
    const p=this.game.player;

    const weaponItems=p.weapons.map((w,i)=>{
      const sell=Math.max(10, Math.floor(weaponPrice(w)*0.25));
      const eri=itemSellEridium({rarity:weaponRarityId(w)});
      const qid=weaponRarityId(w), qnm=weaponRarityName(w);
      return `<div class="inv-item loot-${qid} ${i===p.wi?'sel':''}" data-i="${i}">
        <div class="iname c-${qid}">${gunNameOf(w)}</div>
        <div class="si-meta">${qnm?qnm+" · ":""}Lv.${w.ilvl} · ${CFG.display!=="full"?"":`${MANUFACTURERS[w.manufacturer].name} · `}${w.elemName}${w.mayhem>0?` · <b class="c-mayhem">改装${w.mayhem}</b>`:''}</div>
        <div class="istat">${w.statLines().join(' · ')}</div>
        ${this._affixHtml(w)}
        <div class="si-buy">
          <button class="btn small ghost" data-sell="${i}">卖出 <span class="cur-gp">◈</span>${sell}${eri?` <span class="cur-eri">◆</span>${eri}`:''}</button>
          <span class="si-price">${i===p.wi?'装备中':''}</span>
        </div>
      </div>`;
    }).join('');

    const shieldItems=p.shields.length ? p.shields.map((s,i)=>{
      const eff=shieldEffectText(s);
      return `<div class="inv-item loot-${s.rarity} ${i===p.shieldIdx?'sel':''}" data-shield="${i}">
        <div class="iname c-${s.rarity}">${s.name}${i===p.shieldIdx?' · 装备中':''}</div>
        <div class="si-meta">${(RARITY_BY_ID[s.rarity]||RARITIES[0]).name} · Lv.${s.ilvl} · 护甲</div>
        <div class="istat">${plateShieldLines(s).join(' · ')}</div>
        ${eff?`<div class="affix-row"><span class="affix power" style="color:${eff.color}">${eff.name}${eff.extra}</span></div>`:''}
        <div class="si-buy">
          <button class="btn small ghost" data-ssell="${i}">卖出 <span class="cur-gp">◈</span>${itemSellGold(s)}${itemSellEridium(s)?` <span class="cur-eri">◆</span>${itemSellEridium(s)}`:''}</button>
          <span class="si-price">${i===p.shieldIdx?'已装备':'点击装备'}</span>
        </div>
      </div>`;
    }).join('') : `<div class="empty-hint">没有护甲 · 护甲只能靠掉落或在黑市用美元购买</div>`;

    const relicItems=p.relics.length ? p.relics.map((r,i)=>`
      <div class="inv-item loot-${r.rarity} ${i===p.relicIdx?'sel':''}" data-relic="${i}">
        <div class="iname c-${r.rarity}">${r.name}${i===p.relicIdx?' · 装备中':''}</div>
        <div class="si-meta">${(RARITY_BY_ID[r.rarity]||RARITIES[0]).name} · Lv.${r.ilvl} · 随身装备</div>
        <div class="istat">${relicLines(r).join(' · ')}</div>
        <div class="si-buy">
          <button class="btn small ghost" data-rsell="${i}">卖出 <span class="cur-gp">◈</span>${itemSellGold(r)}${itemSellEridium(r)?` <span class="cur-eri">◆</span>${itemSellEridium(r)}`:''}</button>
          <span class="si-price">${i===p.relicIdx?'已装备':'点击装备'}</span>
        </div>
      </div>`).join('') : `<div class="empty-hint">没有随身装备 · 随身装备提供纯被动词条，一个槽位</div>`;

    const sh=p.shieldItem;
    const ammo=Object.keys(p.ammo).map(k=>`${k}: ${p.ammo[k]}`).join(' · ');
    this._set(`
      <div class="panel">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
          <h2 class="title-big" style="font-size:30px;margin:0;">装备库</h2>
          <div class="shop-gold"><span class="cur-gp">◈</span> ${p.gold.toLocaleString()}　<span class="cur-eri">◆ ${p.eridium.toLocaleString()}</span>　<span style="font-size:12px;color:var(--muted);">搜集效率 +${p.mf}</span></div>
        </div>
        <div class="subtitle">护甲：${sh?`${sh.name}（延迟 ${sh.delay.toFixed(1)}s · ${sh.rate.toFixed(1)}/s）`:"无"}</div>

        <div class="inv-sec">
          <h4>武器 <span class="meta-cap">${p.weapons.length}/24</span></h4>
          <div class="inv-list">${weaponItems}</div>
        </div>

        <div class="inv-sec">
          <h4>护甲 <span class="meta-cap">${p.shields.length}/12 · 受击后需等充能延迟才会恢复</span></h4>
          <div class="inv-list">${shieldItems}</div>
        </div>

        <div class="inv-sec">
          <h4>随身装备 <span class="meta-cap">${p.relics.length}/12</span></h4>
          <div class="inv-list">${relicItems}</div>
        </div>

        <div class="istat" style="margin-top:12px;color:var(--muted);">弹药：${ammo}</div>
        <div class="row" style="margin-top:14px;justify-content:flex-end;">
          <button class="btn" id="btn-close">返回战斗</button>
        </div>
      </div>`);

    const rerender=()=>this._keepScroll(()=>this.inventory());

    this.overlay.querySelectorAll('.inv-item[data-i]').forEach(el=>{
      el.onclick=()=>{ p.equip(parseInt(el.dataset.i)); SFX.ui(); rerender(); };
    });
    this.overlay.querySelectorAll('[data-shield]').forEach(el=>{
      el.onclick=(e)=>{
        if(e.target.closest('button')) return;
        p.equipShield(parseInt(el.dataset.shield)); SFX.ui(); rerender();
      };
    });
    this.overlay.querySelectorAll('[data-relic]').forEach(el=>{
      el.onclick=(e)=>{
        if(e.target.closest('button')) return;
        p.equipRelic(parseInt(el.dataset.relic)); SFX.ui(); rerender();
      };
    });
    this.overlay.querySelectorAll('[data-sell]').forEach(b=>{
      b.onclick=(e)=>{
        e.stopPropagation();
        const i=parseInt(b.dataset.sell);
        if(p.weapons.length<=1) return;
        const r=p.sellWeapon(i);
        SFX.pickup();
        this.game.toast(`卖出 +${r.gold} 金${r.eri?` +${r.eri} 美元`:""}`);
        rerender();
      };
    });
    this.overlay.querySelectorAll('[data-ssell]').forEach(b=>{
      b.onclick=(e)=>{
        e.stopPropagation();
        const r=p.sellShield(parseInt(b.dataset.ssell));
        SFX.pickup();
        this.game.toast(`卖出 +${r.gold} 金${r.eri?` +${r.eri} 美元`:""}`);
        rerender();
      };
    });
    this.overlay.querySelectorAll('[data-rsell]').forEach(b=>{
      b.onclick=(e)=>{
        e.stopPropagation();
        const r=p.sellRelic(parseInt(b.dataset.rsell));
        SFX.pickup();
        this.game.toast(`卖出 +${r.gold} 金${r.eri?` +${r.eri} 美元`:""}`);
        rerender();
      };
    });
    document.getElementById('btn-close').onclick=()=>{ SFX.ui(); this.hide(); this.game.resume(); };
  },

  _affixHtml(w){
    /* v0.21.6：精简模式不显示前后缀 */
    if(typeof weaponQualityHidden==="function" && weaponQualityHidden()) return "";
    const lines=w.affixLines ? w.affixLines() : [];
    if(!lines.length) return `<div class="affix-row"><span class="affix">无词缀</span></div>`;
    return `<div class="affix-row">${lines.map(a=>
      `<span class="affix ${a.kind}">${a.nm} ${a.txt}</span>`).join('')}</div>`;
  },

  /* ---------------- 商店 ---------------- */
  shop(id){
    id = id || "marcus";
    const g=this.game, p=g.player, def=SHOPS[id];
    const cur=Shop.currencyOf(id);
    const icon=Shop.curIconHtml(cur);

    let tabs="";
    for(const key of ["marcus","black","gamble"]){
      const d=SHOPS[key];
      tabs += `<button class="shop-tab ${key===id?'on':''}" data-shop="${key}">
        <b>${d.icon} ${d.name}</b><span class="tab-tag">${d.currency==="eridium"?"美元结算":d.tag}</span></button>`;
    }

    let body="";
    if(id==="gamble"){
      const cost=Shop.gambleCost(g);
      body=`<div class="gamble-box">
        <div class="slot">?</div>
        <div style="color:var(--muted);font-size:13px;max-width:420px;line-height:1.6;">${def.desc}<br>
          ${weaponQualityHidden()?"精简显示下不标品质，切到「完整」可查看；":"特供 / 珍藏 / 孤品 三档神兵只有这台机器能出，" }物品等级 = 你的等级 +3。</div>
        <button class="btn" id="btn-gamble" ${Shop.balance("gamble",g)<cost?'disabled style="opacity:.4"':''}>投币 ${Shop.curIconHtml("gamble")}${cost.toLocaleString()}</button>
        <div class="gamble-result" id="gamble-result"></div>
      </div>`;
    } else {
      const st=Shop.stock(id,g);
      const balance=cur==="eridium"?p.eridium:p.gold;
      const rCost=Shop.refreshCost(id,g);
      const canRefresh=balance>=rCost;
      body=`
        <div class="shop-bar">
          <span class="shop-desc">${def.desc}</span>
          <span class="shop-gold">${icon} ${balance.toLocaleString()}</span>
          <button class="btn small ghost" id="btn-refresh" ${canRefresh?'':'disabled style="opacity:.4"'}>刷新 ${icon}${rCost.toLocaleString()}</button>
        </div>
        <div class="shop-list">${st.items.map((it,i)=>this._shopItem(it,i,balance,cur)).join('')}</div>`;
    }

    this._set(`
      <div class="panel">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
          <h2 class="title-big" style="font-size:30px;margin:0;">军火市场</h2>
          <div class="shop-gold"><span class="cur-gp">◈</span> ${p.gold.toLocaleString()}　<span class="cur-eri">◆ ${p.eridium.toLocaleString()}</span></div>
        </div>
        <div class="subtitle">MARKET · 金币买军火，美元才能进黑市</div>
        <div class="shop-tabs">${tabs}</div>
        ${body}
        <div class="row" style="margin-top:16px;justify-content:flex-end;">
          <button class="btn ghost" id="btn-back-pause">返回</button>
        </div>
      </div>`);

    this.overlay.querySelectorAll('[data-shop]').forEach(el=>{
      el.onclick=()=>{ SFX.ui(); this.shop(el.dataset.shop); };
    });
    this.overlay.querySelectorAll('[data-buy]').forEach(b=>{
      b.onclick=()=>{
        const r=Shop.buy(id, parseInt(b.dataset.buy), g);
        this.game.toast(r.msg);
        if(r.ok) SFX.pickup(); else SFX.hurt();
        this._keepScroll(()=>this.shop(id));
      };
    });
    const rf=document.getElementById('btn-refresh');
    if(rf) rf.onclick=()=>{
      const r=Shop.refresh(id,g);
      this.game.toast(r.msg);
      if(r.ok) SFX.pickup();
      this.shop(id);
    };
    const gb=document.getElementById('btn-gamble');
    if(gb) gb.onclick=()=>{
      const r=Shop.gamble(g);
      this.game.toast(r.msg);
      if(r.ok){
        const w=r.weapon;
        const el=document.getElementById('gamble-result');
        if(el) el.innerHTML=`<span class="c-${weaponRarityId(w)}">${w.name}</span>`;
        SFX.levelup(); this.game.shake(4);
      } else SFX.hurt();
      const goldEl=this.overlay.querySelector('.shop-gold');
      if(goldEl) goldEl.innerHTML=Shop.curIconHtml("gamble")+" "+Shop.balance("gamble",g).toLocaleString();
      const cost=Shop.gambleCost(g);
      if(gb){ gb.innerHTML=`投币 ${Shop.curIconHtml("gamble")}${cost.toLocaleString()}`; gb.disabled=Shop.balance("gamble",g)<cost; gb.style.opacity=Shop.balance("gamble",g)<cost?0.4:1; }
    };
    document.getElementById('btn-back-pause').onclick=()=>{
      SFX.ui();
      if(this.game.state==="zoneclear") this.zoneClear(this.game.world, false);
      else this.pause();
    };
  },

  _shopItem(it, i, gold, cur){
    const it0=it.item;
    const w=it0;
    const icon=Shop.curIconHtml(cur);
    const cant = gold < it.price;
    const isGear = w.kind==="shield" || w.kind==="relic";
    let meta, stats, affix;
    if(w.kind==="shield"){
      meta=`${(RARITY_BY_ID[w.rarity]||RARITIES[0]).name} · Lv.${w.ilvl} · 护甲装备`;
      stats=plateShieldLines(w).slice(0,3).join(' · ');
      const eff=shieldEffectText(w);
      affix = eff?`<span class="affix power" style="color:${eff.color}">${eff.name}${eff.extra}</span>`:'<span class="affix">无特效</span>';
    } else if(w.kind==="relic"){
      meta=`${(RARITY_BY_ID[w.rarity]||RARITIES[0]).name} · Lv.${w.ilvl} · 随身装备`;
      stats=relicLines(w).join(' · ');
      affix='<span class="affix suffix">纯被动加成</span>';
    } else {
      meta=`${weaponRarityName(w)?weaponRarityName(w)+" · ":""}Lv.${w.ilvl} · ${CFG.display!=="full"?"":`${MANUFACTURERS[w.manufacturer].name} · `}${w.elemName}${w.mayhem>0?` · <b class="c-mayhem">改装${w.mayhem}</b>`:''}`;
      stats=`${w.stats.damage.toFixed(1)} 伤害 · ${w.stats.fireRate.toFixed(1)}/s · ${w.magSizeBase} 弹匣 · ${(w.stats.accuracy*100|0)}% 精准`;
      affix = (typeof weaponQualityHidden==="function" && !weaponQualityHidden())
        ? (w.affixLines().map(a=>`<span class="affix ${a.kind}">${a.nm} ${a.txt}</span>`).join('')||'<span class="affix">无词缀</span>')
        : '';
    }
    return `<div class="shop-item loot-${weaponRarityId(w)} ${it.sold?'sold':''}">
      <div class="si-name c-${weaponRarityId(w)}">${w.name}</div>
      <div class="si-meta">${meta}</div>
      <div class="si-stats">${stats}</div>
      <div class="affix-row">${affix}</div>
      <div class="si-buy">
        <span class="si-price ${cant?'cant':''}">${icon} ${it.price.toLocaleString()}</span>
        <button class="btn small" data-buy="${i}" ${it.sold||cant?'disabled style="opacity:.4"':''}>${it.sold?'已售出':'购买'}</button>
      </div>
    </div>`;
  },

  /* ---------------- 改装 / 重新部署 ---------------- */
  meta(from){
    this._metaFrom = from || "pause";
    const g=this.game, p=g.player;
    const cap=p.maxMayhem();
    const unlocked=p.mayhemUnlocked;
    const gain=p.soulsGain();

    const mhBlock = unlocked ? `
      <div class="meta-row" style="justify-content:center;gap:20px;">
        <button class="btn small" data-mh="-1" ${p.mayhem<=0?'disabled style="opacity:.35"':''}>−</button>
        <div class="meta-big">改装 ${p.mayhem}<span class="meta-cap"> / 上限 ${cap}</span></div>
        <button class="btn small" data-mh="1" ${p.mayhem>=cap?'disabled style="opacity:.35"':''}>＋</button>
      </div>
      <div class="meta-num">
        怪物生命 <b>×${p.mayhemHpMul().toFixed(2)}</b> · 伤害 <b>×${p.mayhemDmgMul().toFixed(2)}</b> ·
        经验 <b>+${Math.round((p.mayhemXpMul()-1)*100)}%</b> · 金币与掉落 <b>+${Math.round((p.mayhemLootMul()-1)*100)}%</b>
      </div>
      <div class="meta-num">
        掉落物品等级 <b>+${p.mayhem}</b>，每件装备再按 <b>w(m)=m≥n?1:2^(n-1-m)</b> 抽取改装等级 m，
        数值倍率最高 <b>×${Math.pow(MAYHEM.gearPower,p.mayhem).toFixed(2)}</b>。
      </div>`
      : `<div class="meta-num">击败军械库守卫后解锁改装等级：怪物更强，掉落物品等级更高、词缀更猛。</div>`;

    const permRows = PERM_UPGRADES.map(u=>{
      const lv=p.perm[u.id]||0, cost=p.permCost(u.id);
      return `<div class="perm-row">
        <div>
          <b>${u.name}</b> <span class="meta-cap">Lv.${lv}</span>
          <div class="meta-num">当前 +${lv*u.per}${u.unit} · 下一级 <span style="color:var(--accent)">${cost} 功勋</span></div>
        </div>
        <button class="btn small" data-perm="${u.id}" ${p.souls<cost?'disabled style="opacity:.35"':''}>+1</button>
      </div>`;
    }).join('');

    const capCost=p.mayhemCapCost();

    this._set(`
      <div class="panel">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
          <h2 class="title-big" style="font-size:30px;margin:0;">改装与重新部署</h2>
          <div class="shop-gold">功勋 ${p.souls.toLocaleString()}　<span style="font-size:12px;color:var(--muted);">重新部署 ${p.rebirths} 次</span></div>
        </div>
        <div class="subtitle">MAYHEM &amp; REBIRTH · 用强度换收益，用等级换永久</div>

        <div class="meta-sec">
          <h4>改装等级（改装）</h4>
          ${mhBlock}
          <div class="meta-row" style="margin-top:8px;">
            <div class="meta-num">上限 ${cap} = 基础 ${MAYHEM.capBase} + 重新部署 ${p.rebirths} + 购买 ${p.mayhemCapBonus*MAYHEM.capBuyStep}</div>
            <button class="btn small ghost" id="btn-cap" ${!unlocked||p.souls<capCost?'disabled style="opacity:.35"':''}>
              上限 +${MAYHEM.capBuyStep}（${capCost} 功勋）</button>
          </div>
        </div>

        <div class="meta-sec">
          <h4>重新部署（Rebirth）</h4>
          <div class="meta-row">
            <div>
              <div class="meta-num">等级 <b>Lv.${p.level}</b> · 装备评分 <b>${p.gearScore().toLocaleString()}</b> · 改装 <b>${p.mayhem}</b></div>
              <div class="meta-num">本次重新部署可得 <b style="color:var(--accent);font-size:15px;">${gain} 功勋</b></div>
              <div class="meta-num" style="margin-top:4px;">
                重置：等级 / 技能 / 武器库与护甲随身装备 / 金币。
                保留：功勋 / 美元 / 永久升级 / 改装解锁与上限 / 重新部署次数。
              </div>
            </div>
            <button class="btn small" id="btn-rebirth" ${p.canRebirth()?'':'disabled style="opacity:.35"'}>重新部署</button>
          </div>
        </div>

        <div class="meta-sec">
          <h4>永久升级 · 跨重新部署保留</h4>
          <div class="perm-list">${permRows}</div>
        </div>

        <div class="row" style="margin-top:16px;justify-content:flex-end;">
          <button class="btn" id="btn-back-meta">返回</button>
        </div>
      </div>`);

    this.overlay.querySelectorAll('[data-mh]').forEach(b=>{
      b.onclick=()=>{
        const r=p.setMayhem(p.mayhem + parseInt(b.dataset.mh));
        this.game.toast(r.msg); SFX.ui(); this.meta();
      };
    });
    this.overlay.querySelectorAll('[data-perm]').forEach(b=>{
      b.onclick=()=>{
        const r=p.buyPerm(b.dataset.perm);
        this.game.toast(r.msg);
        if(r.ok) SFX.levelup(); else SFX.hurt();
        this.meta();
      };
    });
    const capBtn=document.getElementById('btn-cap');
    if(capBtn) capBtn.onclick=()=>{
      const r=p.buyMayhemCap();
      this.game.toast(r.msg);
      if(r.ok) SFX.levelup(); else SFX.hurt();
      this.meta();
    };
    document.getElementById('btn-rebirth').onclick=()=>{
      if(!p.canRebirth()) return;
      if(!window.confirm(`确定重新部署？\n\n将重置等级、技能、武器库与金币。\n可获得 ${p.soulsGain()} 功勋。`)) return;
      SFX.levelup();
      const r=this.game.doRebirth();
      if(r.ok){ this.game.toast(r.msg); }
    };
    document.getElementById('btn-back-meta').onclick=()=>{
      SFX.ui();
      if(this._metaFrom==="victory") this.victory(); else this.pause();
    };
  },

  /* ---------------- 暂停 ---------------- */
  pause(){
    const p=this.game.player;
    const endless=this.game.mode==="endless";
    this._set(`
      <div class="panel" style="text-align:center;max-width:480px;">
        <h2 class="title-big" style="font-size:36px;">暂停</h2>
        <div class="subtitle">${endless?`ENDLESS · 第 ${this.game.world?this.game.world.wave:1} 波`:"PAUSED"}</div>
        <div class="row" style="justify-content:center;margin-bottom:12px;">
          <span class="shop-gold"><span class="cur-gp">◈</span> ${p.gold.toLocaleString()}</span>
          <span class="cur-eri">◆ ${p.eridium.toLocaleString()}</span>
          <span style="color:var(--muted);font-size:13px;">Lv.${p.level} · 搜集效率 +${p.mf}${p.mayhem>0?` · 改装${p.mayhem}`:''}${p.souls>0?` · 功勋 ${p.souls}`:''}</span>
        </div>
        <div class="row" style="flex-direction:column;gap:10px;align-items:stretch;">
          <button class="btn" id="btn-resume">继续</button>
          <button class="btn ghost" id="btn-meta">改装与重新部署${p.mayhem>0?` · 改装${p.mayhem}`:''}</button>
          <button class="btn ghost" id="btn-shop">军火市场</button>
          <button class="btn ghost" id="btn-skill">技能树 (K)</button>
          <button class="btn ghost" id="btn-inv">装备库 (Tab)</button>
          <button class="btn ghost" id="btn-quit">保存并退出到标题</button>
        </div>
      </div>`);
    document.getElementById('btn-resume').onclick=()=>{ SFX.ui(); this.hide(); this.game.resume(); };
    document.getElementById('btn-meta').onclick=()=>{ SFX.ui(); this.meta(); };
    document.getElementById('btn-shop').onclick=()=>{ SFX.ui(); this.shop("marcus"); };
    document.getElementById('btn-skill').onclick=()=>{ SFX.ui(); this.skillTree(); };
    document.getElementById('btn-inv').onclick=()=>{ SFX.ui(); this.inventory(); };
    document.getElementById('btn-quit').onclick=()=>{
      SFX.ui();
      if(this.game.mode==="endless") Save.saveMeta(this.game); else Save.save(this.game);
      this.game.toTitle();
    };
  },

  /* ---------------- 沙二暂停 ---------------- */
  dustPause(){
    const g=this.game;
    const p=Dust2.player;
    const canBuy=Dust2.canBuy();
    this._set(`
      <div class="panel" style="text-align:center;max-width:520px;">
        <h2 class="title-big" style="font-size:34px;">比赛暂停</h2>
        <div class="subtitle">DE_DUST2 · ${Dust2.playerSide()==="t"?"T":"CT"} · 第 ${Dust2.round} 回合</div>
        <div class="dust-score" style="justify-content:center;margin:12px 0;">
          <span class="sc-a">${Dust2.score.A}</span><span class="sc-sep">:</span><span class="sc-b">${Dust2.score.B}</span>
        </div>
        <div class="row" style="justify-content:center;margin-bottom:12px;">
          <span class="shop-gold">$ ${p.money.toLocaleString()}</span>
          <span style="color:var(--muted);font-size:13px;">击杀 ${p.kills} · 死亡 ${p.deaths}</span>
        </div>
        <div class="row" style="flex-direction:column;gap:10px;align-items:stretch;">
          <button class="btn" id="btn-resume">继续</button>
          <button class="btn ghost" id="btn-buy" ${canBuy?"":'disabled style="opacity:.35"'}>购买菜单 (B)${canBuy?"":" · 仅冻结时间"}</button>
          <button class="btn ghost" id="btn-quit">退出比赛</button>
        </div>
      </div>`);
    document.getElementById('btn-resume').onclick=()=>{ SFX.ui(); this.hide(); g.resume(); };
    const bb=document.getElementById('btn-buy');
    if(bb) bb.onclick=()=>{ SFX.ui(); g.openBuy(); };
    document.getElementById('btn-quit').onclick=()=>{ SFX.ui(); g.toTitle(); };
  },

  /* ---------------- 沙二购买菜单（CS2 风格） ---------------- */
  buyMenu(){
    const D=Dust2, p=D.player;
    const tabs = D.gunSet==="bl" ? CS2.buyTabsBL : CS2.buyTabs;
    const money=p.money;
    const cols=tabs.map(t=>{
      const list=D.buyList(t.id);
      const cards=list.map(it=>{
        const blGearOwned = (it.item && it.kind==="shield" && p.shieldItem===it.item) ||
                            (it.item && it.kind==="relic" && p.relicItem===it.item);
        const owned = blGearOwned ||
                      (p.gun&&p.gun.id===it.id) ||
                      (it.id==="kevlar"&&p.armor>=100&&!p.helmet) ||
                      (it.id==="kevlarhelm"&&p.armor>=100&&p.helmet) ||
                      (it.id==="kit"&&p.kit) ||
                      (CS2.nades[it.id] && p.nades.includes(it.id));
        const cant = money<it.price;
        return `<button class="buy-card ${owned?"owned":""} ${cant&&!owned?"cant":""}" data-buyid="${it.id}" ${it.desc?`title="${it.desc}"`:""} ${cant&&!owned?"":""}>
          <span class="bc-img">${this._gunIcon(it)}</span>
          <span class="bc-name" ${it.color?`style="color:${it.color}"`:""}>${it.name}</span>
          ${it.desc?`<span class="bc-desc" style="font-size:10px;opacity:.75;line-height:1.25;">${it.desc}</span>`:""}
          <span class="bc-price">${owned?"已持有":"$"+it.price}</span>
        </button>`;
      }).join('');
      return `<div class="buy-col">
        <div class="buy-col-head">${t.name}<span>${t.en}</span></div>
        <div class="buy-col-body">${cards}</div>
      </div>`;
    }).join('');

    this._set(`
      <div class="buy-wrap">
        <div class="buy-top">
          <div class="buy-time">购买时间剩余 <b id="buy-clock">0:${String(Math.max(0,Math.ceil(D.timer))).padStart(2,"0")}</b></div>
          <div class="buy-money">$ ${money.toLocaleString()}</div>
        </div>
        <div class="buy-scroll"><div class="buy-grid">${cols}</div></div>
        <div class="buy-hint">← 左右滑动查看全部 ${tabs.length} 列 →</div>
        <div class="buy-bottom">
          <div class="buy-loadout">
            <span class="bl-title">当前装备</span>
            <span>${p.gun?p.gun.name:"—"}</span>
            <span>${p.pistol?p.pistol.name:"—"}</span>
            <span>${p.armor>0?(p.helmet?"全甲":"半甲"):"无甲"}</span>
            <span>${p.kit?"拆弹器":""}</span>
            <span>${p.nades.length?"手雷 ×"+p.nades.length:""}</span>
          </div>
          <button class="btn small ghost" id="btn-buy-close">关闭 (Esc)</button>
        </div>
      </div>`);

    this.overlay.querySelectorAll('[data-buyid]').forEach(b=>{
      b.onclick=()=>{
        const r=D.buy(b.dataset.buyid);
        this.game.toast(r.msg);
        if(r.ok) SFX.pickup(); else SFX.hurt();
        this._keepScroll(()=>this.buyMenu());
      };
    });
    document.getElementById('btn-buy-close').onclick=()=>{ SFX.ui(); this.game.closeBuy(); };

    if(this._buyTimer) clearInterval(this._buyTimer);
    this._buyTimer=setInterval(()=>{
      const el=document.getElementById('buy-clock');
      if(!el){ clearInterval(this._buyTimer); this._buyTimer=null; return; }
      const t=Math.max(0, D.timer);
      el.textContent="0:"+String(Math.ceil(t)).padStart(2,"0");
      if(t<=0){ clearInterval(this._buyTimer); this._buyTimer=null; }
    },250);
  },

  _gunIcon(it){
    const P={
      pistol:'<path d="M9 7h29v7H26l-5 9h-7l4-9H9z"/>',
      smg:'<path d="M5 9h9V6h19l3 3h15v5H39l-2 7h-8l2-7H21l-1 9h-7l2-9H5z"/>',
      rifle:'<path d="M2 9h15l3-3h21l3 3h12v5H43l-2 8h-8l2-8H23l-3 5h-7l2-5H2z"/>',
      sniper:'<path d="M2 11h15l2-2h21v4H40v4H25l-3 8h-8l3-8H2z"/><rect x="18" y="3" width="16" height="4"/>',
      shotgun:'<path d="M4 9h18v5h-6l-2 8H6l2-8H4z"/><rect x="22" y="9" width="30" height="4"/>',
      nade:'<circle cx="26" cy="15" r="7"/><rect x="23" y="3" width="6" height="4"/>',
      vest:'<path d="M17 4h11l3 4v14H15V8z"/><path d="M30 4h7l4 6v8h-6z"/>',
      kit:'<path d="M13 8h27v13H13z"/><rect x="21" y="4" width="9" height="4"/>',
    };
    let key=it.cat;
    if(it.cat==="gear") key = it.id==="kit" ? "kit" : "vest";
    const d=P[key]||P.rifle;
    const col=it.color||"rgba(185,215,240,0.92)";
    return `<svg viewBox="0 0 56 22" width="52" height="20" fill="${col}" aria-hidden="true">${d}</svg>`;
  },

  /* ---------------- 沙二结算 ---------------- */
  dustResult(r){
    const win=r.win;
    this._set(`
      <div class="panel" style="text-align:center;max-width:640px;">
        <h2 class="title-big" style="font-size:42px;color:${win?"var(--accent)":"var(--hp)"};">${win?"比赛胜利":"比赛失败"}</h2>
        <div class="subtitle">${r.gunSet==="bl"?"BORDERLANDS ARSENAL":"CS2 ARSENAL"} · ${r.rounds} 回合</div>
        <div class="dust-score" style="justify-content:center;margin:18px 0;">
          <span class="sc-a">${r.score.A}</span><span class="sc-sep">:</span><span class="sc-b">${r.score.B}</span>
        </div>
        <p style="color:var(--muted);">你的队伍 ${win?"拿下了比赛":"惜败"}。沙二模式不写入战役存档。</p>
        <div class="row" style="justify-content:center;">
          <button class="btn" id="btn-dust-again">再来一场</button>
          <button class="btn ghost" id="btn-title">返回标题</button>
        </div>
      </div>`);
    document.getElementById('btn-dust-again').onclick=()=>{ SFX.ui(); this.dustSetup(); };
    document.getElementById('btn-title').onclick=()=>{ SFX.ui(); this.game.toTitle(); };
  },

  /* ---------------- 区域通关 ---------------- */
  zoneClear(zone, isLast){
    const p=this.game.player;
    const last = this.game.zoneIndex+1>=ZONES.length;
    this._set(`
      <div class="panel" style="text-align:center;">
        <h2 class="title-big" style="font-size:34px;">区域肃清！</h2>
        <div class="subtitle">${zone.name} 已清除</div>
        <p style="color:var(--muted);">等级 Lv.${p.level} · 技能点 ${p.skillPoints} · 金币 <b class="cur-gp">◈${p.gold.toLocaleString()}</b> · 美元 <b style="color:#b061ff">◆${p.eridium}</b></p>
        <p style="color:var(--muted);font-size:13px;">${last?'前方就是军械库':'下一片区域等级更高，先去军火市场补一补？'}</p>
        <div class="row" style="justify-content:center;">
          <button class="btn ghost" id="btn-shop-zone">军火市场</button>
          <button class="btn" id="btn-next">${last?'查看结局':'前往下一片区域'}</button>
        </div>
      </div>`);
    document.getElementById('btn-shop-zone').onclick=()=>{ SFX.ui(); this.shop('marcus'); };
    document.getElementById('btn-next').onclick=()=>{ SFX.ui(); this.hide(); this.game.nextZone(); };
  },

  /* ---------------- 失败 ---------------- */
  gameOver(){
    const p=this.game.player;
    const endless=this.game.mode==="endless";
    const wave=endless&&this.game.world?this.game.world.wave:0;
    this._set(`
      <div class="panel" style="text-align:center;">
        <h2 class="title-big" style="font-size:40px;color:var(--hp);">你倒下了</h2>
        <div class="subtitle">${endless?`ENDLESS · 第 ${wave} 波`:"GAME OVER"}</div>
        ${endless
          ? `<p style="color:var(--muted);">${CLASSES[p.classId].name} · 撑到第 <b style="color:var(--accent);font-size:22px;">${wave}</b> 波 · Lv.${p.level}</p>`
          : `<p style="color:var(--muted);">${CLASSES[p.classId].name} · 到达 Lv.${p.level} · ${this.game.zoneIndex+1}/${ZONES.length} 区域</p>`}
        <p style="color:var(--muted);font-size:13px;">功勋、美元、永久升级与改装上限已保留</p>
        <div class="row" style="justify-content:center;">
          <button class="btn" id="btn-retry">再来一次</button>
          <button class="btn ghost" id="btn-title">返回标题</button>
        </div>
      </div>`);
    document.getElementById('btn-retry').onclick=()=>{
      SFX.ui(); this.hide();
      if(endless) this.game.startEndless(p.classId, Save.loadMeta());
      else this.game.continueRun();
    };
    document.getElementById('btn-title').onclick=()=>{ SFX.ui(); this.game.toTitle(); };
  },

  /* ---------------- 通关 ---------------- */
  victory(){
    const p=this.game.player;
    const cap=p.maxMayhem();
    const canUp = p.mayhem < cap;
    const next = canUp ? p.mayhem+1 : p.mayhem;
    this._set(`
      <div class="panel" style="text-align:center;">
        <h2 class="title-big" style="font-size:40px;color:var(--orange);">军械库已开启</h2>
        <div class="subtitle">VICTORY · 改装等级已解锁</div>
        <p style="color:var(--muted);">${CLASSES[p.classId].name} · Lv.${p.level} · 击杀军械库守卫</p>
        <div class="meta-sec" style="text-align:left;">
          <h4>接下来的路</h4>
          <div class="meta-num">
            改装 <b>${p.mayhem}</b> / 上限 <b>${cap}</b>：改装越高，怪物生命与掉落物品等级同步暴涨，
            掉落的装备还会自带「改装等级」词缀加成。
          </div>
          <div class="meta-num">
            上限提升途径：每次<b>重新部署</b> +1，或用<b>功勋</b>购买（每次 +5）。
          </div>
          ${canUp ? '' : `<div class="meta-num" style="color:#ff5ce0;margin-top:4px;">
            <b>改装上限已满。</b>去「改装与重新部署」里重新部署，或用功勋购买上限，才能继续往上爬。</div>`}
        </div>
        <div class="row" style="justify-content:center;flex-wrap:wrap;">
          <button class="btn" id="btn-cycle">${canUp?`进入改装 ${next} 轮回`:`重打改装 ${p.mayhem}`}</button>
          <button class="btn ghost" id="btn-meta-v">改装与重新部署</button>
          <button class="btn ghost" id="btn-title">返回标题</button>
        </div>
      </div>`);
    document.getElementById('btn-cycle').onclick=()=>{ SFX.ui(); this.game.startCycle(); };
    document.getElementById('btn-meta-v').onclick=()=>{ SFX.ui(); this.meta("victory"); };
    document.getElementById('btn-title').onclick=()=>{ SFX.ui(); Save.save(this.game); this.game.toTitle(); };
  },
};
