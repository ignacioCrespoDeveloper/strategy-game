// =============================================
//  battle-traits.js — TraitProcessor
//
//  Handles passive and end-of-round trait effects.
//  Per-attack trait hooks (armor_piercing, bloodlust,
//  shield_wall, etc.) are applied inline in battle-engine.js
//  since they need to modify the damage formula mid-calculation.
//
//  applyPassive    — called at the START of each round (no-op in V1)
//  applyEndOfRound — called at the END of each round (regen, frenzy)
// =============================================

var TraitProcessor = (() => {

  function applyPassive(ctx, round, events) {
    // Reserved for future passive effects that fire at round start.
    // Frenzy and regeneration are applied at end-of-round below.
  }

  function applyEndOfRound(ctx, round, events) {
    const allUnits = [...ctx.attacker.units, ...ctx.defender.units];

    allUnits.forEach(u => {
      if (u.count === 0) return;

      // Frenzy: +1 attack per completed round, max +4 bonus total
      if (u.traits.includes('frenzy')) {
        const bonus = u._frenzBonus || 0;
        if (bonus < 4) {
          u._frenzBonus = bonus + 1;
          u.attack += 1;
        }
      }

      // Regeneration: restore 15% of maxHp at end of round.
      // Suppressed if the unit was set on fire this round (_burning flag).
      if (u.traits.includes('regeneration') && !u._burning) {
        const heal    = Math.floor(u.maxHp * 0.15);
        const before  = u.currentHp;
        u.currentHp   = Math.min(u.maxHp, u.currentHp + heal);
        if (u.currentHp > before) {
          events.push({
            round, phase: 'end_round',
            actorId: u.id, actorName: u.name,
            targetId: u.id, targetName: u.name,
            trait: 'regeneration', ability: null,
            damage: -(u.currentHp - before),
            hpBefore: before, hpAfter: u.currentHp,
            result: 'healed',
          });
        }
      }

      // Clear burn flag — fire_attack only suppresses regen for one round
      u._burning = false;
    });
  }

  return { applyPassive, applyEndOfRound };
})();
