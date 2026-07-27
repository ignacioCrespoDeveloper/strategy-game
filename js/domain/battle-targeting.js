// =============================================
//  battle-targeting.js — TargetingService
//
//  Decides which enemy unit each attacker hits.
//  Rules: formation (frontline before backline),
//  flanker/flying bypass, weighted random from
//  weakest candidates, bodyguard/guardian intercept.
// =============================================

var TargetingService = (() => {

  function _alive(unit) { return unit.count > 0 && !unit.isRouting; }

  // Returns a BattleUnit to attack, or null if no valid targets.
  // round: current battle round — formation protection is absolute early,
  // then leaks (see breakthrough below).
  function select(attacker, enemySide, round) {
    const pool = enemySide.units.filter(_alive);
    if (pool.length === 0) return null;

    // Flying / flanker ignore formation — can target anyone
    const ignoresFormation = attacker.traits.includes('flying') || attacker.traits.includes('flanker');

    let eligible;
    if (ignoresFormation) {
      eligible = pool;
    } else {
      // Frontline = units with 'frontline' trait OR infantry role
      const frontline = pool.filter(u => u.traits.includes('frontline') || u.role === 'infantry');
      // Breakthrough (2026-07-27): from round 3 the melee has fully
      // joined and a battle line can no longer perfectly screen the rear
      // — 30% of attacks slip past it. Without this, artillery parked
      // behind a tough infantry wall was untouchable for the entire
      // fight and the "dwarf castle" build hit ~88% win rate.
      const breakthrough = (round || 1) >= 3 && Math.random() < 0.3;
      if (frontline.length > 0 && !breakthrough) {
        eligible = frontline;
      } else {
        // All frontline gone (or the line was bypassed) — everyone is exposed
        eligible = pool;
      }
    }

    // Weighted random from up to 3 weakest candidates.
    // Weights [3,2,1] = weakest is 3× more likely, not guaranteed.
    const sorted     = [...eligible].sort((a, b) => a.currentHp - b.currentHp);
    const candidates = sorted.slice(0, Math.min(3, sorted.length));
    const weights    = [3, 2, 1].slice(0, candidates.length);
    const totalW     = weights.reduce((s, w) => s + w, 0);

    let rand   = Math.random() * totalW;
    let target = candidates[candidates.length - 1];
    for (let i = 0; i < candidates.length; i++) {
      rand -= weights[i];
      if (rand <= 0) { target = candidates[i]; break; }
    }

    // Bodyguard / guardian intercept check.
    // Any alive ally of the target with the matching trait can redirect the
    // hit. 45% since 2026-07-27 (was 60%) — at 60%, a guardian tank parked
    // in front of massed artillery made the backline nearly untouchable
    // and guardian-rich armies dominated the balance suite.
    const sideAlive = enemySide.units.filter(u => _alive(u) && u !== target);
    for (const ally of sideAlive) {
      if (ally.traits.includes('guardian') && target.role === 'ranged') {
        if (Math.random() < 0.45) return ally;
      }
      if (ally.traits.includes('bodyguard') && (target.isLord || target.role === 'ranged' || target.traits.includes('backline'))) {
        if (Math.random() < 0.45) return ally;
      }
    }

    return target;
  }

  return { select };
})();
