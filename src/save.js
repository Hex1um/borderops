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
  has(){ try{ return !!localStorage.getItem(this.KEY); }catch(e){ return false; } },

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
        weapons:p.weapons.map(w=>({name:w.name,type:w.type,manufacturer:w.manufacturer,element:w.element,rarity:w.rarity,
          ilvl:w.ilvl,affixes:w.affixes,power:w.power,mayhem:w.mayhem||0,magSize:w.magSizeBase,mag:w.mag,stats:w.stats,parts:w.parts})),
        ...this._packGear(p),
      };
      localStorage.setItem(this.KEY, JSON.stringify(data));
      return true;
    }catch(e){ console.warn("save failed",e); return false; }
  },

  load(){
    try{
      const raw=localStorage.getItem(this.KEY); if(!raw) return null;
      const d=JSON.parse(raw);
      if(d.weapons) d.weapons=d.weapons.map(s=>{ const w=new Weapon(s); w.mag=s.mag; return w; });
      return d;
    }catch(e){ console.warn("load failed",e); return null; }
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
      localStorage.setItem(this.KEY, JSON.stringify(data));
      return true;
    }catch(e){ console.warn("meta save failed",e); return false; }
  },

  clear(){ try{ localStorage.removeItem(this.KEY); }catch(e){} },

  // 彻底删除本机全部存档：战役进度 + 塔科夫仓库 + 拍卖行（含挂单与成交记录）
  clearAll(){
    for(const k of this.exportKeys()){ try{ localStorage.removeItem(k); }catch(e){} }
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
        const raw=localStorage.getItem(k);
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
        localStorage.setItem(k, String(bag.data[k])); n++;
      }
      return n ? { ok:true, msg:"已导入 "+n+" 项存档", count:n }
               : { ok:false, msg:"存档码里没有可导入的数据" };
    }catch(e){ return { ok:false, msg:"解析失败："+(e&&e.message||e) }; }
  },
};
