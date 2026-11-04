/* =========================================================================
 * shop.js — 商店：马库斯军火 / 黑市 / 赌枪机
 *
 * 与掉落解耦的两套品质权重：掉落偏惊喜，商店偏可买。
 * 库存懒生成（首次进店才 roll），刷新付费，赌枪机走完整体质随机。
 * 黑市只收「镒矿」——一种只能从精英/首领/分解高品质装备获得的货币，
 * 与金币完全隔离，否则黑市就退化成「钱多就毕业」。
 * ========================================================================= */

const Shop = {
  state:{},          // { marcus:{items:[{item,price,sold}]}, black:{...} }

  reset(){ this.state={}; },

  currencyOf(id){ return (SHOPS[id] && SHOPS[id].currency) || "gold"; },
  curIcon(id){ return this.currencyOf(id)==="eridium" ? "◆" : "◈"; },
  curName(id){ return this.currencyOf(id)==="eridium" ? "镒矿" : "金币"; },
  balance(id, game){
    return this.currencyOf(id)==="eridium" ? game.player.eridium : game.player.gold;
  },

  stock(id, game){
    if(!this.state[id]) this._fill(id, game);
    return this.state[id];
  },

  _fill(id, game){
    const def = SHOPS[id];
    const items=[];
    for(let i=0;i<def.slots;i++) items.push(this._roll(def, game));
    // 黑市额外出售护盾与圣物——它们是装备体系里最稀缺的两格
    if(id==="black"){
      items.push(this._rollGear(def, game, "shield"));
      items.push(this._rollGear(def, game, "relic"));
    }
    this.state[id] = { items };
    return this.state[id];
  },

  _roll(def, game){
    const pl = game.player;
    const base = Math.max(game.world ? game.world.level : 1, pl.level);
    const ilvl = base + (def.ilvlBonus||0);
    const q = rollQuality(ilvl, { mf: pl.mf, weights: def.weights });
    // 商店与掉落共用同一套混乱分布：仅稀有及以上带混乱标记
    const m = ["blue","purple","orange","pearl","ancient","rainbow"].includes(q)
      ? rollGearMayhem(pl.mayhem||0) : 0;
    const w = generateWeapon(ilvl+m, { rarity:q, mayhem:m });
    const basePrice = weaponPrice(w)*(def.priceMul||1);
    const price = this.currencyOf(def.id)==="eridium"
      ? this._toEridium(basePrice)
      : Math.round(basePrice/10)*10;
    return { item:w, price, sold:false };
  },

  _rollGear(def, game, kind){
    const pl = game.player;
    const base = Math.max(game.world ? game.world.level : 1, pl.level);
    const ilvl = base + (def.ilvlBonus||0);
    const q = rollQuality(ilvl, { mf: pl.mf, weights: def.weights });
    const it = kind==="shield" ? generateShield(ilvl, { rarity:q }) : generateRelic(ilvl, { rarity:q });
    const price = this._toEridium(itemPrice(it)*(def.priceMul||1));
    return { item:it, price, sold:false };
  },

  // 金币价 -> 镒矿价的兑换曲线（约 240 金 = 1 镒矿，另加基础税）
  _toEridium(goldPrice){ return Math.max(3, Math.round(goldPrice/240 + 2)); },

  refreshCost(id, game){
    const def = SHOPS[id];
    if(this.currencyOf(id)==="eridium") return Math.max(2, Math.round(2 + game.player.level*0.35));
    return def.refreshBase + def.refreshLv*(game.player.level-1);
  },

  refresh(id, game){
    const cost = this.refreshCost(id, game);
    const pl = game.player;
    const useEri = this.currencyOf(id)==="eridium";
    const cur = useEri ? pl.eridium : pl.gold;
    if(cur < cost) return { ok:false, msg:(useEri?"镒矿":"金币")+"不足（需要 "+cost+"）" };
    if(useEri) pl.eridium-=cost; else pl.gold-=cost;
    this._fill(id, game);
    return { ok:true, msg:"货架已刷新" };
  },

  buy(id, idx, game){
    const st = this.stock(id, game);
    const it = st.items[idx];
    const pl = game.player;
    if(!it || it.sold) return { ok:false, msg:"这件已经卖掉了" };
    const cur = this.currencyOf(id);
    const item = it.item;
    if(item.kind==="weapon" && pl.weapons.length>=24) return { ok:false, msg:"武器库已满（24）" };
    if(item.kind==="shield" && pl.shields.length>=12) return { ok:false, msg:"护盾仓已满（12）" };
    if(item.kind==="relic"  && pl.relics.length>=12)  return { ok:false, msg:"圣物匣已满（12）" };
    const bal = cur==="eridium" ? pl.eridium : pl.gold;
    if(bal < it.price) return { ok:false, msg:(cur==="eridium"?"镒矿":"金币")+"不足" };
    pl.buyItem(item, it.price, cur);
    it.sold = true;
    return { ok:true, msg:"购入 "+item.name };
  },

  gambleCost(game){ return SHOPS.gamble.basePrice + SHOPS.gamble.lvPrice*(game.player.level-1); },

  gamble(game){
    const pl = game.player;
    const cost = this.gambleCost(game);
    if(pl.weapons.length>=24) return { ok:false, msg:"武器库已满（24）" };
    if(pl.gold < cost) return { ok:false, msg:"金币不足（需要 "+cost+"）" };
    pl.gold -= cost;
    const base = Math.max(game.world ? game.world.level : 1, pl.level);
    const gm = rollGearMayhem(pl.mayhem||0);
    const w = generateWeapon(base+3+gm, { mf: pl.mf, luck:true, mayhem:gm });
    pl.buyWeapon(w, 0);
    return { ok:true, weapon:w, msg:"开出："+w.name };
  },
};
