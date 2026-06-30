// =============================================
//  combat.js — auto-resolve battle engine
// =============================================
// Army = all units on one hex.
// Battle = triggered when two armies occupy the same hex.
// Three internal phases: ranged volley → cavalry charge → melee rounds.
// No map positioning — everything is instant calculation.

const Combat = (() => {

  // Role-vs-role advantage multiplier [attacker role][defender role]
  // Triangle: ranged → pikemen → cavalry → ranged
  const COMBAT_MATRIX = {
    //              inf    pike   ranged  cav    siege
    infantry: { infantry:1.00, pikemen:0.85, ranged:1.60, cavalry:0.75, siege:1.40 },
    pikemen:  { infantry:1.00, pikemen:0.90, ranged:0.70, cavalry:2.20, siege:1.20 },
    ranged:   { infantry:0.90, pikemen:1.80, ranged:0.90, cavalry:0.40, siege:1.10 },
    cavalry:  { infantry:1.20, pikemen:0.35, ranged:2.20, cavalry:0.90, siege:0.70 },
    siege:    { infantry:0.50, pikemen:0.50, ranged:0.70, cavalry:0.35, siege:1.00 },
  };

  // Terrain reduces damage taken by the defending side
  const TERRAIN_DEF_MULT = { plains:1.0, forest:1.15, mountain:1.30, desert:0.92, water:1.0 };

  // Damage formula — melee uses DEF, ranged uses ARM
  function _dmg(attUnit, attDef, defUnit, defDef, phaseMult) {
    const attRole  = attDef.role || 'infantry';
    const defRole  = defDef.role || 'infantry';

    // Unit-specific bonusVs overrides COMBAT_MATRIX when present
    let roleBonus = (COMBAT_MATRIX[attRole] || {})[defRole] || 1.0;
    if (attDef.bonusVs && attDef.bonusVs[defRole] !== undefined) {
      roleBonus = attDef.bonusVs[defRole];
    }

    const isRanged = (attDef.rng || 0) > 0;
    const defStat  = isRanged ? (defDef.arm || 0) : (defDef.def || 0);
    const effDef   = Math.max(0, defStat - (attDef.ap || 0));
    const raw      = attUnit.atk * roleBonus * phaseMult * (100 / (100 + effDef));
    return Math.max(1, Math.round(raw));
  }

  function _removeKilled(arr) {
    for (let i = arr.length - 1; i >= 0; i--) {
      if (arr[i].hp <= 0) arr.splice(i, 1);
    }
  }

  // Prefer weakest target (finish off wounded units)
  function _pickTarget(pool) {
    return pool.reduce((min, u) => u.hp < min.hp ? u : min, pool[0]);
  }

  function resolveBattle(attackers, defenders, terrain, options = {}) {
    const terrainMult = TERRAIN_DEF_MULT[terrain] || 1.0;
    const atkMult     = options.attackerAtkMult || 1.0;
    const log = [];

    // Clone units — inject level-scaled def/arm into _def so _dmg uses veteran stats
    const _scaledDef = u => {
      const base = UNIT_TYPES[u.type];
      if (!u.level || u.level <= 1 || typeof UNIT_LEVEL_BONUSES === 'undefined') return base;
      const b = UNIT_LEVEL_BONUSES[(u.level - 1)] || UNIT_LEVEL_BONUSES[0];
      return { ...base, arm: Math.round((base.arm || 0) * b.arm) };
    };
    const att = attackers.map(u => ({
      ...u,
      atk: atkMult !== 1 ? Math.round(u.atk * atkMult) : u.atk,
      _def: _scaledDef(u),
    }));
    const def = defenders.map(u => ({ ...u, _def: _scaledDef(u) }));

    // ── Phase 1: Ranged volleys (2 rounds) ─────────────
    // Ranged units fire twice before melee; no retaliation from non-ranged units
    const hasRanged = att.some(u => (u._def.rng || 0) > 0) || def.some(u => (u._def.rng || 0) > 0);
    if (hasRanged) {
      for (let volley = 0; volley < 2; volley++) {
        if (!att.some(u => u.hp > 0) || !def.some(u => u.hp > 0)) break;
        const attShooters = att.filter(u => (u._def.rng || 0) > 0 && u.hp > 0);
        const defShooters = def.filter(u => (u._def.rng || 0) > 0 && u.hp > 0);
        if (!attShooters.length && !defShooters.length) break;

        attShooters.forEach(s => {
          const pool = def.filter(u => u.hp > 0 && !(u._def.rng > 0));
          const tgt  = pool.length ? _pickTarget(pool) : _pickTarget(def.filter(u => u.hp > 0));
          if (!tgt) return;
          const dmg = Math.round(_dmg(s, s._def, tgt, tgt._def, 0.80) / terrainMult);
          tgt.hp = Math.max(0, tgt.hp - dmg);
          log.push(`🏹 ${s._def.name} → ${tgt._def.name}: -${dmg} HP`);
        });
        defShooters.forEach(s => {
          const pool = att.filter(u => u.hp > 0 && !(u._def.rng > 0));
          const tgt  = pool.length ? _pickTarget(pool) : _pickTarget(att.filter(u => u.hp > 0));
          if (!tgt) return;
          const dmg = Math.round(_dmg(s, s._def, tgt, tgt._def, 0.80) * terrainMult);
          tgt.hp = Math.max(0, tgt.hp - dmg);
        });
        _removeKilled(att);
        _removeKilled(def);
      }
      log.push('— Fase distancia finalizada —');
    }

    // ── Phase 2: Cavalry charge ─────────────────────────
    // Each cavalry unit delivers one powerful strike with charge bonus
    const attCav = att.filter(u => u._def.role === 'cavalry' && u.hp > 0);
    const defCav = def.filter(u => u._def.role === 'cavalry' && u.hp > 0);

    attCav.forEach(cav => {
      const chargeMult = 1 + (cav._def.charge || 0);
      const pool = def.filter(u => u.hp > 0 && u._def.role !== 'cavalry');
      const tgt  = pool.length ? _pickTarget(pool) : def.find(u => u.hp > 0);
      if (!tgt) return;
      const dmg = Math.round(_dmg(cav, cav._def, tgt, tgt._def, chargeMult) / terrainMult);
      tgt.hp = Math.max(0, tgt.hp - dmg);
      log.push(`⚡ ${cav._def.name} CARGA → ${tgt._def.name}: -${dmg} HP`);
    });
    defCav.forEach(cav => {
      const chargeMult = 1 + (cav._def.charge || 0);
      const pool = att.filter(u => u.hp > 0 && u._def.role !== 'cavalry');
      const tgt  = pool.length ? _pickTarget(pool) : att.find(u => u.hp > 0);
      if (!tgt) return;
      const dmg = Math.round(_dmg(cav, cav._def, tgt, tgt._def, chargeMult) * terrainMult);
      tgt.hp = Math.max(0, tgt.hp - dmg);
    });

    _removeKilled(att);
    _removeKilled(def);
    if (attCav.length || defCav.length) log.push('— Fase carga finalizada —');

    // ── Phase 3: Melee rounds (up to 8) ────────────────
    for (let round = 0; round < 8; round++) {
      const aliveAtt = att.filter(u => u.hp > 0);
      const aliveDef = def.filter(u => u.hp > 0);
      if (!aliveAtt.length || !aliveDef.length) break;

      // Accumulate damage simultaneously so order doesn't matter
      const defDmgMap = new Map();
      const attDmgMap = new Map();

      aliveAtt.forEach(a => {
        const tgt = _pickTarget(aliveDef);
        const dmg = Math.round(_dmg(a, a._def, tgt, tgt._def, 1.0) / terrainMult);
        defDmgMap.set(tgt, (defDmgMap.get(tgt) || 0) + dmg);
      });
      aliveDef.forEach(d => {
        const tgt = _pickTarget(aliveAtt);
        const dmg = Math.round(_dmg(d, d._def, tgt, tgt._def, 1.0) * terrainMult);
        attDmgMap.set(tgt, (attDmgMap.get(tgt) || 0) + dmg);
      });

      defDmgMap.forEach((dmg, u) => { u.hp = Math.max(0, u.hp - dmg); });
      attDmgMap.forEach((dmg, u) => { u.hp = Math.max(0, u.hp - dmg); });

      _removeKilled(att);
      _removeKilled(def);
    }

    const attWins = def.length === 0;
    const defWins = att.length === 0;
    // Ties go to attacker
    const winner = defWins && !attWins ? 'defender' : 'attacker';

    return {
      winner,
      survivingAtt: att.map(u => ({ id: u.id, hp: u.hp })),
      survivingDef: def.map(u => ({ id: u.id, hp: u.hp })),
      log,
    };
  }

  return { resolveBattle };
})();
