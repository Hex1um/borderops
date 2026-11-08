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

  // 彻底删除本机全部存档：战役进度 + 塔科夫仓库 + 拍卖行（含挂单与成交记录）
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

  /* 存档码：BOPS1-<8 位 FNV-1a 校验和>-<base64url(UTF-8 JSON)>
   * data 里直接存各 key 的原始字符串，不做二次解析，旧档 / 未来字段都能原样带走。 */
  exportCode(){
    try{
      const bag={ app:"borderops", v:2, ver:CFG.version, at:Date.now(), data:{} };
      for(const k of this.exportKeys()){
        const raw=Store.get(k, null);
        if(raw!=null) bag.data[k]=raw;
      }
      // 全新存档无任何数据时不生成空码（否则复制到新浏览器会被「无可导入数据」拒绝）
      if(!Object.keys(bag.data).length) return null;
      const body=_b64enc(JSON.stringify(bag));
      return "BOPS1-"+_b64hash(body)+"-"+body;
    }catch(e){ return null; }
  },
  importCode(code){
    try{
      const s=String(code||"").trim().replace(/\s+/g,"");
      const m=s.match(/^BOPS1-([0-9a-f]{8})-([A-Za-z0-9_-]+)$/i);
      if(!m) return { ok:false, msg:"格式不对：应以 BOPS1- 开头" };
      if(_b64hash(m[2])!==m[1].toLowerCase()) return { ok:false, msg:"校验失败：存档码不完整或已损坏" };
      const bag=JSON.parse(_b64dec(m[2]));
      if(!bag || bag.app!=="borderops" || !bag.data || typeof bag.data!=="object")
        return { ok:false, msg:"不是有效的边境行动存档码" };
      const keys=this.exportKeys(); let n=0;
      for(const k of Object.keys(bag.data)){
        if(keys.indexOf(k)<0) continue;                 // 只写白名单 key，拒绝注入任意 localStorage 键
        /* v0.31.1：校验和只说明「没损坏」，不说明「没恶意」。三个白名单 key
         * （战役存档 / 塔科夫仓库 / 拍卖行）的 JSON 里所有字符串先剥危险字符，
         * 再落盘 —— 顺带挡住「导入后绕过 getJSON 直接 Store.get」的未来代码。 */
        let raw;
        try{ raw=JSON.stringify(cleanSaveStrings(JSON.parse(String(bag.data[k])))); }
        catch(e){ continue; }   // 合法存档必然是 Store.setJSON 写出的 JSON
        if(raw===undefined) continue;
        Store.set(k, raw); n++;
      }
      return n ? { ok:true, msg:"已导入 "+n+" 项存档", count:n }
               : { ok:false, msg:"存档码里没有可导入的数据" };
    }catch(e){ return { ok:false, msg:"解析失败："+(e&&e.message||e) }; }
  },
};
