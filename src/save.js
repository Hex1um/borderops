/* =========================================================================
 * save.js — localStorage 存档（在线/离线隔离于本机，不涉及服务器）
 * ========================================================================= */

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
        /* 混乱 / 转生 */
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

  // 只取跨局进度（灵魂 / 镒矿 / 永久升级 / 混乱）——死亡重开与无尽模式复用
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

  // 死亡时只保底保留「跨局进度」：灵魂 / 镒矿 / 永久升级 / 混乱解锁
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
    const keys=[this.KEY, "raid_stash_v2", "raid_auction_v1"];
    if(typeof RaidStash!=="undefined" && RaidStash.KEY) keys.push(RaidStash.KEY);
    if(typeof AUCTION_KEY!=="undefined") keys.push(AUCTION_KEY);
    for(const k of keys){ try{ localStorage.removeItem(k); }catch(e){} }
    return true;
  },
};
