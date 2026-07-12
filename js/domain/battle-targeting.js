// =============================================
//  battle-targeting.js — TargetingService
//
//  Decides which enemy unit each attacker hits.
//  Rules: formation (frontline before backline),
//  flanker/flying bypass, weighted random from
//  weakest candidates, bodyguard/guardian intercept.
// =============================================

const TargetingService = (() => {

  function _alive(unit) { return unit.count > 0 && !unit.isRouting; }

  // Returns a BattleUnit to attack, or null if no valid targets.
  function select(attacker, enemySide) {
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
      if (frontline.length > 0) {
        eligible = frontline;
      } else {
        // All frontline gone — backline and everyone else is now exposed
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
    // Any alive ally of the target with the matching trait can redirect the hit.
    const sideAlive = enemySide.units.filter(u => _alive(u) && u !== target);
    for (const ally of sideAlive) {
      if (ally.traits.includes('guardian') && target.role === 'ranged') {
        if (Math.random() < 0.6) return ally;
      }
      if (ally.traits.includes('bodyguard') && (target.isLord || target.role === 'ranged' || target.traits.includes('backline'))) {
        if (Math.random() < 0.6) return ally;
      }
    }

    return target;
  }

  return { select };
})();
