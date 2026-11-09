/* =========================================================================
 * save.js — localStorage 存档（在线/离线隔离于本机，不涉及服务器）
 * v0.22.0：新增存档码导出 / 导入，把存档与域名解绑，换浏览器或清缓存时可自保。
 * ========================================================================= */

/* 纯 JS base64（URL 安全、去尾部 =）——不依赖 btoa/atob，Node 回归单测同样可跑 */
const _B64C = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function _b64hash(s){
  let h=0x811c9dc5;
  for(let i=0;i<s.length;i++){ h^=s.charCodeAt(i); h=Math.imul(h,0x01000193)>>>0; }
  return (h>>>0).toString(16).padStart(8,"0");
}
function _b64enc(str){
  let s;
  if(typeof TextEncoder!=="undefined") s=Array.from(new TextEncoder().encode(str));
  else { const u=unescape(encodeURIComponent(str)); s=[]; for(let i=0;i<u.length;i++) s.push(u.charCodeAt(i)); }
  let out="";
  for(let i=0;i<s.length;i+=3){
    const a=s[i], b=i+1<s.length?s[i+1]:0, c=i+2<s.length?s[i+2]:0;
    const n=(a<<16)|(b<<8)|c;
    out+=_B64C[(n>>18)&63]+_B64C[(n>>12)&63]
       +(i+1<s.length?_B64C[(n>>6)&63]:"=")+(i+2<s.length?_B64C[n&63]:"=");
  }
  return out.replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
}
function _b64dec(s){
  s=String(s).replace(/-/g,"+").replace(/_/g,"/");
  while(s.length%4) s+="=";
  let bin="";
  for(let i=0;i<s.length;i+=4){
    const c0=_B64C.indexOf(s[i]), c1=_B64C.indexOf(s[i+1]), c2=_B64C.indexOf(s[i+2]), c3=_B64C.indexOf(s[i+3]);
    const n=((c0<0?0:c0)<<18)|((c1<0?0:c1)<<12)|((c2<0?0:c2)<<6)|(c3<0?0:c3);
    bin+=String.fromCharCode((n>>16)&255);
    if(s[i+2]!=="=") bin+=String.fromCharCode((n>>8)&255);
    if(s[i+3]!=="=") bin+=String.fromCharCode(n&255);
  }
  if(typeof TextDecoder!=="undefined"){
    const bytes=new Uint8Array(bin.length);
    for(let i=0;i<bin.length;i++) bytes[i]=bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }
  return decodeURIComponent(escape(bin));
}

/* ===== v0.32.0：存档码压缩 =====
 * 旧版把 JSON 明文直接 base64 —— 实测一个正常存档就有 48,826 字符，
 * 过一次聊天工具必然被截断，而校验和「差一个字符就判不完整」，
 * 于是玩家看到的就是「校验失败：存档码已不完整或损坏」。
 * 现在用浏览器原生 CompressionStream('deflate') 先压一遍再 base64，
 * 前缀从 BOPS1 升到 BOPS2；**BOPS1 旧码仍能导入**（向后兼容）。
 * 不支持 CompressionStream 的浏览器自动回退成 BOPS1 明文码。 */
function _bytesB64(bytes){
  let out="";
  for(let i=0;i<bytes.length;i+=3){
    const a=bytes[i], b=i+1<bytes.length?bytes[i+1]:0, c=i+2<bytes.length?bytes[i+2]:0;
    const n=(a<<16)|(b<<8)|c;
    out+=_B64C[(n>>18)&63]+_B64C[(n>>12)&63]
       +(i+1<bytes.length?_B64C[(n>>6)&63]:"=")+(i+2<bytes.length?_B64C[n&63]:"=");
  }
  return out.replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
}
function _b64ToBytes(s){
  s=String(s).replace(/-/g,"+").replace(/_/g,"/");
  while(s.length%4) s+="=";
  const out=[];
  for(let i=0;i<s.length;i+=4){
    const c0=_B64C.indexOf(s[i]), c1=_B64C.indexOf(s[i+1]), c2=_B64C.indexOf(s[i+2]), c3=_B64C.indexOf(s[i+3]);
    const n=((c0<0?0:c0)<<18)|((c1<0?0:c1)<<12)|((c2<0?0:c2)<<6)|(c3<0?0:c3);
    out.push((n>>16)&255);
    if(s[i+2]!=="=") out.push((n>>8)&255);
    if(s[i+3]!=="=") out.push(n&255);
  }
  return new Uint8Array(out);
}
async function _packBody(json){
  if(typeof CompressionStream==="undefined" || typeof Response==="undefined")
    return { prefix:"BOPS1", body:_b64enc(json) };
  try{
    const cs=new CompressionStream("deflate");
    const w=cs.writable.getWriter();
    w.write(new TextEncoder().encode(json)); w.close();
    const buf=await new Response(cs.readable).arrayBuffer();
    return { prefix:"BOPS2", body:_bytesB64(new Uint8Array(buf)) };
  }catch(e){
    return { prefix:"BOPS1", body:_b64enc(json) };
  }
}
async function _unpackBody(prefix, body){
  if(prefix==="BOPS1") return _b64dec(body);
  if(typeof DecompressionStream==="undefined")
    throw new Error("此浏览器不支持解压存档码，请换用新版浏览器或导入存档文件");
  const ds=new DecompressionStream("deflate");
  const w=ds.writable.getWriter();
  w.write(_b64ToBytes(body)); w.close();
  const buf=await new Response(ds.readable).arrayBuffer();
  return new TextDecoder().decode(new Uint8Array(buf));
}

const Save = {
  KEY:"borderlands_web_save_v1",

  /* 数值字段归一表：字段名 → 非法值（null / 字符串乱码 / NaN）时的兜底。
   * 为什么要专门做：NaN 在 JS 里会**传染** —— 经验值成 NaN 之后，等级、
   * 技能点、结算奖金一路全变 NaN，玩家看到的是满屏 NaN 且无法自行恢复。
   * 跨版本读档和历史手改档都可能产生这种值，所以在入口一次性收口。 */
  NUM_FIELDS: {
    level:1, xp:0, skillPoints:0, gold:0, eridium:0, souls:0, rebirths:0,
    mayhem:0, mayhemUnlocked:0, mayhemCapBonus:0, zoneIndex:0, bestWave:0,
    hp:100, shield:0,
  },

  has(){ return Store.has(this.KEY); },

  _packGear(p){
    return {
      shields:(p.shields||[]).map(s=>({ ...s })),
      relics:(p.relics||[]).map(r=>({ ...r })),
      shieldIdx:p.shieldIdx, relicIdx:p.relicIdx,
    };
  },

  save(game){
    try{
      const p=game.player;
      const data={
        v:CFG.version,
        mode:game.mode==="endless"?"endless":"campaign",
        classId:p.classId, name:p.name, level:p.level, xp:p.xp, skillPoints:p.skillPoints,
        skills:{...p.skills}, ammo:{...p.ammo}, wi:p.wi, hp:Math.round(p.hp), shield:Math.round(p.shield),
        gold:p.gold, eridium:p.eridium||0,
        /* 改装 / 重新部署 */
        souls:p.souls, rebirths:p.rebirths, perm:{...p.perm},
        mayhem:p.mayhem, mayhemUnlocked:p.mayhemUnlocked, mayhemCapBonus:p.mayhemCapBonus,
        zoneIndex:game.state==="victory" ? 0 : game.zoneIndex,
        bestWave: game.world && game.world.bestWave ? game.world.bestWave : 0,
        weapons:(p.weapons||[]).map(w=>({name:w.name,type:w.type,manufacturer:w.manufacturer,element:w.element,rarity:w.rarity,
          ilvl:w.ilvl,affixes:w.affixes,power:w.power,mayhem:w.mayhem||0,magSize:w.magSizeBase,mag:w.mag,stats:w.stats,parts:w.parts})),
        ...this._packGear(p),
      };
      return Store.setJSON(this.KEY, data);
    }catch(e){ console.warn("[Save] 存档写入失败", e); return false; }
  },

  /* 读档后的逐字段修复。
   * 原则：**能救就救，救不动的字段才回默认值**，绝不因为一个字段异常丢掉整档。
   * 返回同一个对象（原地修补），方便调用方继续用。 */
  _repair(d){
    if(!d || typeof d !== "object" || Array.isArray(d)) return null;

    // 1) 数值字段：先尝试转数字，转不出有限值才回落到默认
    for(const k in this.NUM_FIELDS){
      if(!(k in d)) continue;
      const n = (typeof d[k] === "number") ? d[k] : Number(d[k]);
      d[k] = Number.isFinite(n) ? n : this.NUM_FIELDS[k];
    }

    // 2) 容器字段：类型不对才重置（不存在就保持 undefined，交给业务层走默认）
    for(const k of ["perm", "skills", "ammo"]){
      const v = d[k];
      if(v !== undefined && (!v || typeof v !== "object" || Array.isArray(v))) d[k] = {};
    }
    for(const k of ["shields", "relics"]){
      if(d[k] !== undefined && !Array.isArray(d[k])) d[k] = [];
    }

    // 3) 武器：单条构造失败只跳过那一条，其余照常带进游戏
    if(Array.isArray(d.weapons)){
      const list = [];
      for(const s of d.weapons){
        if(!s || typeof s !== "object") continue;
        try{
          const w = new Weapon(s);
          w.mag = s.mag;
          list.push(w);
        }catch(e){
          console.warn("[Save] 跳过一条损坏的武器数据", s && s.name, e);
        }
      }
      d.weapons = list;
    } else if(d.weapons !== undefined){
      console.warn("[Save] weapons 字段不是数组，已重置为空");
      d.weapons = [];
    }

    return d;
  },

  load(){
    /* 只挡「压根不是对象」的脏档；其余异常都交给 _repair 逐字段救。
       解析失败 / 形状非法时 Store 会把原始串隔离到 borderlands_web_save_v1.__bad。 */
    const d = Store.getJSON(this.KEY, null,
      v => v && typeof v === "object" && !Array.isArray(v));
    if(!d) return null;
    return this._repair(d);
  },

  // 只取跨局进度（功勋 / 美元 / 永久升级 / 改装）——死亡重开与无尽模式复用
  loadMeta(){
    const d=this.load(); if(!d) return null;
    return {
      classId:d.classId, name:d.name, souls:d.souls, rebirths:d.rebirths,
      perm:d.perm, mayhem:d.mayhem, mayhemUnlocked:d.mayhemUnlocked,
      mayhemCapBonus:d.mayhemCapBonus, eridium:d.eridium||0, bestWave:d.bestWave||0,
      level:d.level, xp:d.xp, skillPoints:d.skillPoints, skills:d.skills, ammo:d.ammo,
      gold:d.gold, weapons:d.weapons, shields:d.shields, relics:d.relics,
      shieldIdx:d.shieldIdx, relicIdx:d.relicIdx,
    };
  },

  // 死亡时只保底保留「跨局进度」：功勋 / 美元 / 永久升级 / 改装解锁
  saveMeta(game){
    try{
      const p=game.player;
      const data={
        v:CFG.version, metaOnly:true,
        classId:p.classId, name:p.name,
        souls:p.souls, rebirths:p.rebirths, perm:{...p.perm},
        eridium:p.eridium||0,
        mayhemUnlocked:p.mayhemUnlocked, mayhemCapBonus:p.mayhemCapBonus, mayhem:p.mayhem,
        bestWave: game.world && game.world.bestWave ? game.world.bestWave : 0,
      };
      return Store.setJSON(this.KEY, data);
    }catch(e){ console.warn("[Save] 跨局进度写入失败", e); return false; }
  },

  clear(){ Store.remove(this.KEY); },

  // 彻底删除本机全部存档：战役进度 + 撤离区仓库 + 拍卖行（含挂单与成交记录）
  clearAll(){
    /* 逐键删，单键失败不影响其余；同时清掉坏档隔离副本，避免残留占配额 */
    for(const k of this.exportKeys()) Store.remove(k);
    Store.dropQuarantine();
    return true;
  },

  /* 导出 / 导入 / 清档共用同一份键白名单，避免三处漂移 */
  exportKeys(){
    const keys=[this.KEY, "raid_stash_v2", "raid_auction_v1"];
    if(typeof RaidStash!=="undefined" && RaidStash.KEY && keys.indexOf(RaidStash.KEY)<0) keys.push(RaidStash.KEY);
    if(typeof AUCTION_KEY!=="undefined" && keys.indexOf(AUCTION_KEY)<0) keys.push(AUCTION_KEY);
    return keys;
  },

  /* 存档码：BOPS2-<8 位 FNV-1a 校验和>-<base64url(deflate(JSON))>
   * v0.32.0 起压缩；BOPS1（明文）旧码仍可导入。
   * data 里直接存各 key 的原始字符串，不做二次解析，旧档 / 未来字段都能原样带走。 */
  /* 返回值可能是字符串（BOPS1 同步）或 Promise<string>（BOPS2 压缩）。
     调用方统一 `await` 即可 —— await 一个非 Promise 值是无害的。 */
  exportCode(){
    try{
      const bag={ app:"borderops", v:2, ver:CFG.version, at:Date.now(), data:{} };
      for(const k of this.exportKeys()){
        const raw=Store.get(k, null);
        if(raw!=null) bag.data[k]=raw;
      }
      // 全新存档无任何数据时不生成空码（否则复制到新浏览器会被「无可导入数据」拒绝）
      if(!Object.keys(bag.data).length) return null;
      const json=JSON.stringify(bag);
      if(typeof CompressionStream==="undefined" || typeof Response==="undefined"){
        const body=_b64enc(json);
        return "BOPS1-"+_b64hash(body)+"-"+body;
      }
      return _packBody(json).then(p=>p.prefix+"-"+_b64hash(p.body)+"-"+p.body);
    }catch(e){ return null; }
  },
  /* 导出成可直接存盘的文本（与存档码同构，方便「下载文件」入口） */
  async exportFileText(){
    const code=await this.exportCode();
    if(!code) return null;
    return "BORDER OPS 存档备份\n"+
      "版本 "+CFG.version+"，导出时间 "+new Date().toISOString()+"\n"+
      "导入方法：大厅 →「导入存档码」→ 把下面整段粘贴进去，或直接用「导入存档文件」。\n\n"+
      code+"\n";
  },
  /* 落盘（BOPS1 / BOPS2 共用）。抽出来是为了让「同步旧码」与「异步新码」两条路
     走同一套白名单 + 净化逻辑，不会有一边漏掉 v0.31.1 的 XSS 防线。 */
  _applyBag(bag){
    if(!bag || bag.app!=="borderops" || !bag.data || typeof bag.data!=="object")
      return { ok:false, msg:"不是有效的边境行动存档码" };
    const keys=this.exportKeys(); let n=0;
    for(const k of Object.keys(bag.data)){
      if(keys.indexOf(k)<0) continue;                 // 只写白名单 key，拒绝注入任意 localStorage 键
      /* v0.31.1：校验和只说明「没损坏」，不说明「没恶意」。三个白名单 key
       * （战役存档 / 撤离区仓库 / 拍卖行）的 JSON 里所有字符串先剥危险字符，
       * 再落盘 —— 顺带挡住「导入后绕过 getJSON 直接 Store.get」的未来代码。 */
      let raw;
      try{ raw=JSON.stringify(cleanSaveStrings(JSON.parse(String(bag.data[k])))); }
      catch(e){ continue; }   // 合法存档必然是 Store.setJSON 写出的 JSON
      if(raw===undefined) continue;
      Store.set(k, raw); n++;
    }
    return n ? { ok:true, msg:"已导入 "+n+" 项存档", count:n }
             : { ok:false, msg:"存档码里没有可导入的数据" };
  },
  /* 同样双形态：BOPS1（明文）同步返回结果对象，BOPS2（压缩）返回 Promise。
     调用方统一 await 即可。 */
  importCode(code){
    let m, s;
    try{
      /* v0.32.0：允许整段粘贴 —— 存档文件里带说明文字，从文本中抽出码即可。 */
      /* 先剥掉所有空白再提取 —— 否则换行会把码切断，正则只匹配到半截。 */
      const clean=String(code||"").replace(/\s+/g,"");
      const hit=clean.match(/(BOPS[12]-[0-9a-f]{8}-[A-Za-z0-9_-]+)/i);
      s=hit ? hit[1] : "";
      m=s.match(/^(BOPS[12])-([0-9a-f]{8})-([A-Za-z0-9_-]+)$/i);
    }catch(e){ m=null; }
    if(!m) return { ok:false, msg:"格式不对：没找到 BOPS1- / BOPS2- 开头的存档码" };
    if(_b64hash(m[3])!==m[2].toLowerCase())
      return { ok:false, msg:"校验失败：存档码不完整或已损坏（收到 "+s.length+" 字符，可能是复制时被截断了；"
        +"建议改用「下载存档文件」备份，或确认完整复制到最后一个字符）" };
    const prefix=m[1].toUpperCase();
    if(prefix==="BOPS1"){
      try{ return this._applyBag(JSON.parse(_b64dec(m[3]))); }
      catch(e){ return { ok:false, msg:"解析失败："+(e&&e.message||e) }; }
    }
    return _unpackBody(prefix, m[3])
      .then(json=>this._applyBag(JSON.parse(json)))
      .catch(e=>({ ok:false, msg:"解析失败："+(e&&e.message||e) }));
  },
};
