/* =========================================================================
 * skills.js — 四职业技能树
 * 每职业 6 个可加点技能（3 层 x 2 支），加点为每点 per 修正累加
 * 主动技能见 CLASSES[].ability，其强度由 capstone 技能提升
 * ========================================================================= */

// 每点修正结构（与 Player.computeStats 解析一致）
function emptyMods(){
  return {
    dmgMul:1, fireRateMul:1, maxHPAdd:0, maxHPMul:1, maxShieldAdd:0, shieldRegenMul:1,
    speedMul:1, critAdd:0, elemMul:1, magMul:1, reloadMul:1, lifesteal:0,
    lootMul:1, abilityPower:0, abilityCDMul:1, xpMul:1, meleeMul:1, statusMul:1, accuracyMul:1,
  };
}

const SKILLS = {
  siren: [
    { id:"s_phase", name:"相位强化", max:5, per:{elemMul:0.08, statusMul:0.10}, desc:(l)=>`元素伤害 +${l*8}%，状态时长 +${l*10}%` },
    { id:"s_ward",  name:"守护力场", max:5, per:{maxShieldAdd:18, shieldRegenMul:0.12}, desc:(l)=>`最大护盾 +${l*18}，回盾速度 +${l*12}%` },
    { id:"s_venom", name:"剧毒涌动", max:3, per:{elemMul:0.12}, desc:(l)=>`元素伤害 +${l*12}%` },
    { id:"s_haste", name:"急速咏唱", max:3, per:{fireRateMul:0.06}, desc:(l)=>`射速 +${l*6}%` },
    { id:"s_leech", name:"汲取", max:3, per:{lifesteal:0.02}, desc:(l)=>`击杀回血 +${l*2}%` },
    { id:"s_cap",   name:"相位主宰", max:1, per:{abilityPower:0.5, dmgMul:0.10}, desc:()=>`主动技能强度 +50%，全伤害 +10%` },
  ],
  soldier: [
    { id:"so_aegis", name:"神盾", max:5, per:{maxShieldAdd:22, shieldRegenMul:0.10}, desc:(l)=>`最大护盾 +${l*22}，回盾 +${l*10}%` },
    { id:"so_mayhem",name:"杀戮令", max:5, per:{dmgMul:0.06}, desc:(l)=>`全伤害 +${l*6}%` },
    { id:"so_regen", name:"战场医疗", max:3, per:{maxHPAdd:25}, desc:(l)=>`最大生命 +${l*25}` },
    { id:"so_swift", name:"急行军", max:3, per:{speedMul:0.05}, desc:(l)=>`移动速度 +${l*5}%` },
    { id:"so_scav",  name:"补给兵", max:3, per:{magMul:0.15, reloadMul:-0.06}, desc:(l)=>`弹匣 +${l*15}%，换弹 -${l*6}%` },
    { id:"so_cap",   name:"压制火力", max:1, per:{abilityPower:0.6, fireRateMul:0.08}, desc:()=>`炮塔更强，射速 +8%` },
  ],
  psycho: [
    { id:"p_frenzy", name:"嗜血", max:5, per:{dmgMul:0.07, meleeMul:0.15}, desc:(l)=>`伤害 +${l*7}%，近战 +${l*15}%` },
    { id:"p_blood",  name:"浴血", max:5, per:{maxHPAdd:28, lifesteal:0.015}, desc:(l)=>`生命 +${l*28}，吸血 +${l*1.5}%` },
    { id:"p_rage",   name:"狂怒", max:3, per:{fireRateMul:0.08}, desc:(l)=>`射速 +${l*8}%` },
    { id:"p_dash",   name:"猛冲", max:3, per:{speedMul:0.06}, desc:(l)=>`移速 +${l*6}%` },
    { id:"p_pain",   name:"痛觉钝化", max:3, per:{maxHPAdd:20}, desc:(l)=>`生命 +${l*20}` },
    { id:"p_cap",    name:"疯王", max:1, per:{abilityPower:0.6, dmgMul:0.12}, desc:()=>`狂暴更猛，伤害 +12%` },
  ],
  gunner: [
    { id:"g_bulk",   name:"铁壁", max:5, per:{maxHPAdd:30, maxShieldAdd:10}, desc:(l)=>`生命 +${l*30}，护盾 +${l*10}` },
    { id:"g_barrage",name:"弹幕", max:5, per:{fireRateMul:0.07}, desc:(l)=>`射速 +${l*7}%` },
    { id:"g_cal",    name:"校准", max:3, per:{critAdd:0.04, accuracyMul:1.05}, desc:(l)=>`暴击 +${l*4}%，精准 +${l*5}%` },
    { id:"g_mag",    name:"弹药链", max:3, per:{magMul:0.20}, desc:(l)=>`弹匣 +${l*20}%` },
    { id:"g_scrap",  name:"废品利用", max:3, per:{lootMul:0.12}, desc:(l)=>`掉落 +${l*12}%` },
    { id:"g_cap",    name:"过载核心", max:1, per:{abilityPower:0.6, dmgMul:0.10}, desc:()=>`过载更强，伤害 +10%` },
  ],
};

// 计算某职业当前加点累计 mods
function computeSkillMods(classId, skillsMap){
  const mods = emptyMods();
  const list = SKILLS[classId]||[];
  for(const sk of list){
    const lvl = skillsMap[sk.id]||0;
    if(lvl<=0) continue;
    for(const k in sk.per){
      mods[k] += sk.per[k]*lvl;
    }
  }
  return mods;
}
