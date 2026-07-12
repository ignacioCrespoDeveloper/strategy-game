// =============================================
//  visibility.js — Lord visibility scoring
//
//  Visibility is a 0–100 score computed on demand.
//  It is NOT stored — always derived from live state.
//
//  Consumer contract (future systems read these):
//    getVisibilityScore(lord)  → number 0-100
//    getVisibilityLabel(score) → { label, color }
//    canBeAttacked(lord)       → bool
//    getArmyTier(unitCount)    → { label, score, min, max }
// =============================================

const VisibilityService = (() => {

  // Army size brackets — add tiers here as design evolves.
  // 'score' is the BASE visibility before multipliers.
  const ARMY_TIERS = [
    { min: 0,  max: 0,  label: 'No Army',  score: 0  },
    { min: 1,  max: 3,  label: 'Tiny',     score: 20 },
    { min: 4,  max: 6,  label: 'Small',    score: 40 },
    { min: 7,  max: 9,  label: 'Medium',   score: 65 },
    { min: 10, max: 10, label: 'Large',    score: 90 },
  ];

  // Class-specific visibility multipliers.
  // Only Rogue has one for now; extend here when new classes are added.
  const CLASS_VISIBILITY_MULT = {
    rogue: 0.35,
  };

  function getArmyTier(unitCount) {
    return ARMY_TIERS.find(t => unitCount >= t.min && unitCount <= t.max)
      || ARMY_TIERS[0];
  }

  function getVisibilityScore(lord) {
    const unitCount  = ArmyService.totalUnits(lord.id);
    const tier       = getArmyTier(unitCount);
    let   score      = tier.score;

    // Apply stance multiplier
    const stanceDef  = STANCE_DEFS[lord.stance?.id || 'idle'];
    if (stanceDef?.visibilityMult != null) score *= stanceDef.visibilityMult;

    // Apply class multiplier
    const classMult  = CLASS_VISIBILITY_MULT[lord.classId];
    if (classMult != null) score *= classMult;

    return Math.round(Math.min(100, Math.max(0, score)));
  }

  // Human-readable label + color for the score.
  function getVisibilityLabel(score) {
    if (score === 0)  return { label: 'Undetectable', color: '#444455' };
    if (score <= 10)  return { label: 'Ghost',        color: '#6644aa' };
    if (score <= 30)  return { label: 'Hidden',       color: '#3a6a4a' };
    if (score <= 55)  return { label: 'Spotted',      color: '#7a7a30' };
    if (score <= 75)  return { label: 'Visible',      color: '#aa6020' };
    return              { label: 'Exposed',            color: '#aa3030' };
  }

  // A lord with 0 visibility score cannot be targeted by future combat.
  function canBeAttacked(lord) {
    return getVisibilityScore(lord) > 0;
  }

  return { getVisibilityScore, getVisibilityLabel, getArmyTier, canBeAttacked };
})();
