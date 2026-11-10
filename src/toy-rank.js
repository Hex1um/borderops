/* =========================================================================
 * toy-rank.js — B 站 Toy 排行榜（v0.37.1）
 *
 * 两个榜（平台给单个 Toy 5 个榜位，先用 0 和 1）：
 *   · 0 = 仓库卢布（RaidStash.creds）
 *   · 1 = GP 币（RaidStash.tokens）
 *
 * 设计约束来自官方 FAQ：
 *   · 排行榜有最大数值、跨平台按 Float32 适配 → 上报前 clamp 到 2^24-1（见 ToySdk.rank.clamp）；
 *   · 单 Toy 约 50 QPS → 只在**撤离成功**时上报一次，列表 8s 内走缓存；
 *   · 预览页只读 → 预览态不显示「上报」，只允许看榜。
 *   · 昵称不许玩家自建 → 只用平台返回的昵称，读不到就显示「我」。
 *
 * 不在 Toy 环境（本地 / GitHub Pages）时：按钮不出现，功能完全静默，
 * 不影响任何既有玩法。
 * ========================================================================= */
const ToyRank = {
  BOARDS: [
    { id: 0, name: "仓库卢布", color: "#ffd23f", unit: "₽" },
    { id: 1, name: "GP 币",    color: "#8fd0ff", unit: "◈" },
  ],
  _panel: null,
  _board: 0,
  _busy: false,

  available(){
    try{ return !!(typeof ToySdk!=="undefined" && ToySdk.inToy && ToySdk.rank && ToySdk.rank.available()); }
    catch(e){ return false; }
  },

  /* 当前仓库数值（撤离结算后才变，所以上报点就放在撤离成功处） */
  values(){
    let st=null;
    try{ st = (typeof RaidStash!=="undefined" && RaidStash.load) ? RaidStash.load() : null; }catch(e){ st=null; }
    return {
      rub: Math.max(0, Math.floor((st && st.creds) || 0)),
      gp:  Math.max(0, Math.floor((st && st.tokens) || 0)),
    };
  },

  /* 上报两个榜；任何失败都静默（排行榜是附加玩法，不能影响撤离/存档） */
  submit(){
    if(!this.available()) return false;
    if(!ToySdk.rank.canSubmit()) return false;
    const v=this.values();
    try{
      ToySdk.rank.submit(0, v.rub);
      ToySdk.rank.submit(1, v.gp);
    }catch(e){ return false; }
    return true;
  },

  fmt(n){
    const x=Math.max(0, Math.floor(Number(n)||0));
    if(x>=1e8) return (x/1e8).toFixed(2)+" 亿";
    if(x>=1e4) return (x/1e4).toFixed(1)+" 万";
    return String(x);
  },

  /* ------------------------------- 面板 ------------------------------- */
  toggle(){
    if(this._panel){ this.close(); return; }
    this.open(this._board);
  },

  open(board){
    if(!this.available()){
      if(typeof SFX!=="undefined" && SFX.ui) SFX.ui();
      this._toast("排行榜仅在 B 站 App 内可用");
      return;
    }
    this._board = (board===1)?1:0;
    if(!this._panel) this._build();
    this._panel.style.display="flex";
    this._render();
  },

  close(){
    if(this._panel) this._panel.style.display="none";
  },

  _toast(msg){
    try{
      if(typeof game!=="undefined" && game && game.toast){ game.toast(msg); return; }
    }catch(e){ /* 忽略 */ }
    console.log("[ToyRank] "+msg);
  },

  _build(){
    const el=document.createElement("div");
    el.id="toy-rank-panel";
    el.style.cssText=[
      "position:fixed","inset:0","z-index:99990","display:none",
      "align-items:center","justify-content:center",
      "background:rgba(4,7,10,.72)","backdrop-filter:blur(3px)",
      "font-family:system-ui,'Microsoft YaHei',sans-serif",
    ].join(";");
    el.innerHTML=''+
      '<div style="width:min(560px,92vw);max-height:82vh;display:flex;flex-direction:column;'+
        'background:linear-gradient(180deg,#0e151c,#0a1016);border:1px solid #24313d;'+
        'border-radius:14px;box-shadow:0 24px 60px rgba(0,0,0,.6);overflow:hidden;">'+
        '<div style="display:flex;align-items:center;gap:10px;padding:14px 16px;border-bottom:1px solid #1b2733;">'+
          '<div style="font-size:16px;font-weight:700;color:#e9f1f8;letter-spacing:1px;">排行榜</div>'+
          '<div id="toy-rank-tabs" style="display:flex;gap:6px;margin-left:8px;"></div>'+
          '<button id="toy-rank-close" style="margin-left:auto;background:none;border:0;color:#7f93a6;'+
            'font-size:20px;cursor:pointer;line-height:1;">×</button>'+
        '</div>'+
        '<div id="toy-rank-list" style="padding:10px 12px;overflow:auto;flex:1;color:#cfdbe6;font-size:13px;"></div>'+
        '<div id="toy-rank-foot" style="padding:10px 16px;border-top:1px solid #1b2733;'+
          'display:flex;align-items:center;gap:10px;font-size:12px;color:#8ba0b3;"></div>'+
      '</div>';
    document.body.appendChild(el);
    el.addEventListener("click", e=>{ if(e.target===el) this.close(); });
    el.querySelector("#toy-rank-close").addEventListener("click", ()=>this.close());
    this._panel=el;
  },

  _render(){
    const p=this._panel; if(!p) return;
    const tabs=p.querySelector("#toy-rank-tabs");
    tabs.innerHTML=this.BOARDS.map(b=>{
      const on=b.id===this._board;
      return '<button data-board="'+b.id+'" style="cursor:pointer;border-radius:8px;padding:4px 10px;'+
        'font-size:12px;border:1px solid '+(on?b.color+"88":"#24313d")+';'+
        'background:'+(on?b.color+"22":"transparent")+';color:'+(on?b.color:"#8ba0b3")+';">'+b.name+'</button>';
    }).join("");
    tabs.querySelectorAll("button").forEach(btn=>{
      btn.addEventListener("click", ()=>{
        this._board=Number(btn.getAttribute("data-board")); this._render();
      });
    });

    const list=p.querySelector("#toy-rank-list");
    const foot=p.querySelector("#toy-rank-foot");
    const board=this.BOARDS[this._board];
    list.innerHTML='<div style="padding:22px 0;text-align:center;color:#6f8496;">加载中…</div>';
    foot.innerHTML="";

    ToySdk.rank.list(board.id, 20).then(rows=>{
      if(!rows || !rows.length){
        list.innerHTML='<div style="padding:26px 0;text-align:center;color:#6f8496;">'+
          '这个榜还没有数据 —— 撤离成功一次就会上榜</div>';
      } else {
        list.innerHTML=rows.map(r=>{
          const top=r.rank<=3;
          const medal=top?["#ffd23f","#cfd8e3","#c98a4b"][r.rank-1]:"#5d7286";
          return '<div style="display:flex;align-items:center;gap:10px;padding:7px 8px;border-radius:8px;'+
            (r.self?"background:#ffd23f14;":"")+'">'+
            '<div style="width:28px;text-align:right;color:'+medal+';font-weight:700;font-variant-numeric:tabular-nums;">'+r.rank+'</div>'+
            '<div style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:'+(r.self?"#ffe9a8":"#cfdbe6")+';">'+
              this._esc(r.name)+'</div>'+
            '<div style="font-variant-numeric:tabular-nums;color:'+board.color+';">'+
              board.unit+' '+this.fmt(r.value)+'</div>'+
          '</div>';
        }).join("");
      }
      const mine=this.values();
      const localVal=(board.id===0?mine.rub:mine.gp);
      return ToySdk.rank.my(board.id).then(my=>{
        foot.innerHTML='<span>我的仓库：<b style="color:'+board.color+'">'+board.unit+' '+this.fmt(localVal)+'</b></span>'+
          (my ? '<span>榜上第 <b style="color:#e9f1f8">'+my.rank+'</b> 名</span>' : '<span>还没上榜</span>')+
          '<span style="margin-left:auto;color:#5d7286;">撤离成功自动更新</span>';
      });
    }).catch(()=>{
      list.innerHTML='<div style="padding:26px 0;text-align:center;color:#e08b6a;">榜单读取失败，稍后再试</div>';
    });
  },

  _esc(s){
    return String(s==null?"":s).replace(/[&<>"']/g, c=>({
      "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;",
    })[c]);
  },

  /* 入口按钮：只在 Toy 环境出现；放右上角，不挤占既有 HUD */
  installButton(){
    if(!this.available() || document.getElementById("toy-rank-btn")) return;
    const b=document.createElement("button");
    b.id="toy-rank-btn";
    b.textContent="🏆 排行榜";
    b.style.cssText=[
      "position:fixed","top:10px","right:12px","z-index:9990",
      "padding:6px 12px","border-radius:999px","cursor:pointer",
      "background:rgba(14,21,28,.86)","color:#ffd23f",
      "border:1px solid #ffd23f55","font-size:12px","font-weight:600",
      "font-family:system-ui,'Microsoft YaHei',sans-serif",
      "box-shadow:0 6px 18px rgba(0,0,0,.35)",
    ].join(";");
    b.addEventListener("click", ()=>{ if(typeof SFX!=="undefined" && SFX.ui) SFX.ui(); this.toggle(); });
    document.body.appendChild(b);
  },
};

/* 启动时挂按钮（SDK 能力探测是同步的；若宿主晚到，可在 3s 后再试一次） */
if(typeof window!=="undefined" && window.addEventListener){
  const boot=()=>{ try{ ToyRank.installButton(); }catch(e){ /* 静默 */ } };
  if(document.readyState==="loading") window.addEventListener("DOMContentLoaded", ()=>{ boot(); setTimeout(boot,3000); });
  else { boot(); setTimeout(boot,3000); }
}
