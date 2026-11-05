/* =========================================================================
 * skills.js — 四类PMC的训练树
 * 技能名与描述改为现实战术训练；内部 id 与 mods 字段保持兼容。
 * 每PMC 6 项可加点训练（3 层 x 2 支），主动战术动作见 CLASSES[].ability
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
    { id:"s_phase", name:"弹药辨识", max:5, per:{elemMul:0.08, accuracyMul:0.02}, desc:(l)=>`弹药效能 +${l*8}%，射击精度 +${l*2}%` },
    { id:"s_ward",  name:"防护整备", max:5, per:{maxShieldAdd:18, shieldRegenMul:0.12}, desc:(l)=>`护甲容量 +${l*18}，整备速度 +${l*12}%` },
    { id:"s_venom", name:"弹道判读", max:3, per:{elemMul:0.12}, desc:(l)=>`弹药效能 +${l*12}%` },
    { id:"s_haste", name:"快速上膛", max:3, per:{fireRateMul:0.06}, desc:(l)=>`理论射速 +${l*6}%` },
    { id:"s_leech", name:"战地急救", max:3, per:{maxHPAdd:8}, desc:(l)=>`生命上限 +${l*8}` },
    { id:"s_cap",   name:"前线指挥", max:1, per:{abilityPower:0.5, dmgMul:0.10}, desc:()=>`战术动作强度 +50%，全伤害 +10%` },
  ],
  soldier: [
    { id:"so_aegis", name:"掩体运用", max:5, per:{maxShieldAdd:22, shieldRegenMul:0.10}, desc:(l)=>`护甲容量 +${l*22}，整备 +${l*10}%` },
    { id:"so_mayhem",name:"压制射击", max:5, per:{dmgMul:0.06}, desc:(l)=>`全伤害 +${l*6}%` },
    { id:"so_regen", name:"体能训练", max:3, per:{maxHPAdd:25}, desc:(l)=>`最大生命 +${l*25}` },
    { id:"so_swift", name:"负重行军", max:3, per:{speedMul:0.05}, desc:(l)=>`移动速度 +${l*5}%` },
    { id:"so_scav",  name:"弹药管理", max:3, per:{magMul:0.15, reloadMul:-0.06}, desc:(l)=>`弹匣 +${l*15}%，换弹 -${l*6}%` },
    { id:"so_cap",   name:"火力掩护", max:1, per:{abilityPower:0.6, fireRateMul:0.08}, desc:()=>`掩护火力更强，射速 +8%` },
  ],
  psycho: [
    { id:"p_frenzy", name:"突入训练", max:5, per:{dmgMul:0.07, meleeMul:0.15}, desc:(l)=>`伤害 +${l*7}%，近身格斗 +${l*15}%` },
    { id:"p_blood",  name:"抗冲击", max:5, per:{maxHPAdd:28}, desc:(l)=>`生命上限 +${l*28}` },
    { id:"p_rage",   name:"连续射击", max:3, per:{fireRateMul:0.08}, desc:(l)=>`射速 +${l*8}%` },
    { id:"p_dash",   name:"短距冲刺", max:3, per:{speedMul:0.06}, desc:(l)=>`移速 +${l*6}%` },
    { id:"p_pain",   name:"痛觉耐受", max:3, per:{maxHPAdd:20}, desc:(l)=>`生命 +${l*20}` },
    { id:"p_cap",    name:"破门手", max:1, per:{abilityPower:0.6, dmgMul:0.12}, desc:()=>`突入更强，伤害 +12%` },
  ],
  gunner: [
    { id:"g_bulk",   name:"重装携行", max:5, per:{maxHPAdd:30, maxShieldAdd:10}, desc:(l)=>`生命 +${l*30}，护甲 +${l*10}` },
    { id:"g_barrage",name:"持续射击", max:5, per:{fireRateMul:0.07}, desc:(l)=>`射速 +${l*7}%` },
    // v0.21.9：accuracyMul 是累加式每点增量，原 1.05 会让满级精度变 1+3.15=4.15 倍，按描述改回 +5%/级
    { id:"g_cal",    name:"归零校准", max:3, per:{critAdd:0.04, accuracyMul:0.05}, desc:(l)=>`要害命中 +${l*4}%，精度 +${l*5}%` },
    { id:"g_mag",    name:"弹链供弹", max:3, per:{magMul:0.20}, desc:(l)=>`弹匣 +${l*20}%` },
    { id:"g_scrap",  name:"战场回收", max:3, per:{lootMul:0.12}, desc:(l)=>`战利品 +${l*12}%` },
    { id:"g_cap",    name:"阵地压制", max:1, per:{abilityPower:0.6, dmgMul:0.10}, desc:()=>`压制更强，伤害 +10%` },
  ],
};

// 计算某PMC当前加点累计 mods
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
