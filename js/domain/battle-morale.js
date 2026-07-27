// =============================================
//  battle-morale.js — MoraleService
//
//  Tracks side-level morale, applies decrements
//  from losses / terrain / terror, and triggers
//  rout or retreat checks.
//
//  Morale lives on ctx.attacker.morale / ctx.defender.morale.
//  All functions mutate these values in place.
// =============================================

var MoraleService = (() => {

  function _getLordLeadership(side) {
    const lord = side.units.find(u => u.isLord && u.count > 0);
    return lord ? (lord.leadership || 5) : 5;
  }

  // Applied once at battle start — terror / fear / monster hits.
  // The total hit is CAPPED at -25: dread saturates, so stacking a second
  // terror monster doesn't double it. Uncapped, a troll + arachnarok pair
  // (-35) routed monster-less armies before round 1 mattered (balance
  // suite 2026-07-27: orc/swarm hit 92% almost entirely via retreats).
  function applyPreBattle(ctx) {
    const applyHits = (side, enemies) => {
      let hit = 0;
      enemies.forEach(u => {
        if (u.traits.includes('terror'))  hit += 15;
        if (u.traits.includes('fear'))    hit += 8;
        // monster gives extra +5 even if fear is also present
        if (u.traits.includes('monster')) hit += 5;
      });
      // Fearless models are immune to psychology — the side's hit is
      // scaled by the share of models that actually feel the dread.
      // A fully fearless army takes no pre-battle penalty at all.
      const total    = side.units.reduce((s, u) => s + u.count, 0);
      const fearless = side.units.reduce((s, u) => s + (u.traits.includes('fearless') ? u.count : 0), 0);
      const feltBy   = total > 0 ? (total - fearless) / total : 1;
      side.morale -= Math.min(25, hit) * feltBy;
      side.morale = Math.max(0, Math.min(100, side.morale));
    };
    applyHits(ctx.attacker, ctx.defender.units);
    applyHits(ctx.defender, ctx.attacker.units);
  }

  // Called during Morale Phase each round.
  // Returns true if the side is now at 0 morale (auto-rout).
  // lossFraction: share of the side's combat POWER lost this round
  // (computed by battle-engine from _sidePower before/after the round —
  // power-based since 2026-07-27, so a chaff death and a dragon death
  // each dent morale by what they were actually worth to the army).
  function update(side, lossFraction, cavalryChargeHit, terrainId) {
    const terrain    = TERRAIN_BATTLE_MODS[terrainId] || TERRAIN_BATTLE_MODS.plains;

    // Terrain morale modifier (can be positive in forest)
    side.morale += terrain.moraleMod;

    // Soft-capped at -24 so a single round can't nuke morale.
    // Stubborn (and fearless) models hold the line: the casualty penalty
    // is reduced by up to 30%, scaled by their share of the starting
    // force. This is the Dwarf identity — they die in place, they don't
    // run. (Started at 50% — that plus psychology immunity let dwarfs opt
    // out of the morale game entirely and hit 79% overall win rate.)
    // Coward models are the mirror (2026-07-27): panic spreads, so a
    // goblin-heavy horde bleeds morale up to 30% FASTER per casualty.
    // Free chaff mass was carrying orc swarm to 77% — cowardice is the
    // price of dirt-cheap bodies.
    const totalModels  = side.units.reduce((sum, u) => sum + u.startCount, 0);
    const steadfast      = side.units.reduce((sum, u) =>
      sum + ((u.traits.includes('stubborn') || u.traits.includes('fearless')) ? u.startCount : 0), 0);
    const coward         = side.units.reduce((sum, u) =>
      sum + (u.traits.includes('coward') ? u.startCount : 0), 0);
    const steadfastShare = totalModels > 0 ? steadfast / totalModels : 0;
    const cowardShare    = totalModels > 0 ? coward / totalModels : 0;
    const lossPenalty    = Math.min(24, (lossFraction || 0) * 100) * (1 - 0.3 * steadfastShare + 0.3 * cowardShare);
    side.morale -= lossPenalty;

    // Cavalry charge shock
    if (cavalryChargeHit) side.morale -= 5;

    side.morale = Math.max(0, Math.min(100, side.morale));
    return side.morale <= 0;
  }

  // Rolls for retreat when morale < 25.
  // Returns true if the side should retreat.
  function checkRetreat(side) {
    if (side.morale <= 0)   return true;
    if (side.morale >= 25)  return false;

    // mercenary units increase retreat threshold by +20
    const hasMercenaries = side.units.some(u => u.traits.includes('mercenary') && u.count > 0);
    const penalty        = hasMercenaries ? 20 : 0;

    const leadership  = _getLordLeadership(side);
    const threshold   = side.morale + leadership * 3 - penalty;
    return Math.random() * 100 > threshold;
  }

  return { applyPreBattle, update, checkRetreat };
})();
