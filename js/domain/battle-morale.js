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
  function applyPreBattle(ctx) {
    const applyHits = (side, enemies) => {
      enemies.forEach(u => {
        if (u.traits.includes('terror'))  side.morale -= 15;
        if (u.traits.includes('fear'))    side.morale -= 8;
        // monster gives extra -5 even if fear is also present
        if (u.traits.includes('monster')) side.morale -= 5;
      });
      side.morale = Math.max(0, Math.min(100, side.morale));
    };
    applyHits(ctx.attacker, ctx.defender.units);
    applyHits(ctx.defender, ctx.attacker.units);
  }

  // Called during Morale Phase each round.
  // Returns true if the side is now at 0 morale (auto-rout).
  function update(side, modelsLostThisRound, cavalryChargeHit, terrainId) {
    const terrain    = TERRAIN_BATTLE_MODS[terrainId] || TERRAIN_BATTLE_MODS.plains;

    // Terrain morale modifier (can be positive in forest)
    side.morale += terrain.moraleMod;

    // Models lost — soft cap at -24 per round
    const lossPenalty = Math.min(24, modelsLostThisRound * 8);
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
