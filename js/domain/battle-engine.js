// =============================================
//  battle-engine.js — BattleEngine
//
//  Public API:
//    BattleEngine.buildContext({ lord, army, encounter, terrain })
//      → BattleContext  (pure object, no storage)
//
//    BattleEngine.resolve(ctx)
//      → BattleReport
//
//  Battle is fully auto-resolved (no player input mid-battle).
//  Phases per round: Passive → Ranged → Charge (r1 only) → Melee → Morale → End-of-Round
//  Max 10 rounds. Winner by elimination, rout, retreat, or model count at round 10.
//
//  Engine never persists anything — caller owns storage and navigation.
// =============================================

var BattleEngine = (() => {

  // ── Helpers ─────────────────────────────────────────────────────

  function _rand(min, max) { return min + Math.random() * (max - min); }

  function _unitRole(def) {
    if (def.category === 'ranged')   return 'ranged';
    if (def.category === 'cavalry')  return 'cavalry';
    if (def.category === 'monster' || def.category === 'legendary') return 'monster';
    if ((def.traits || []).includes('ranged')) return 'ranged';
    return 'infantry';
  }

  function _alive(unit) { return unit.count > 0 && !unit.isRouting; }
  function _sideAlive(side) { return side.units.some(_alive); }

  // ── BattleUnit factory ──────────────────────────────────────────

  function _makeUnit(id, sourceId, def, count, extras) {
    return {
      id, sourceId,
      name:       def.name || sourceId,
      role:       extras?.role || _unitRole(def),
      traits:     [...(def.traits || [])],
      abilities:  [...(def.abilities || [])],
      maxHp:      def.combatStats?.hp     ?? def.health   ?? 100,
      currentHp:  extras?.currentHp       ?? (def.combatStats?.hp ?? def.health ?? 100),
      attack:     def.combatStats?.attack ?? def.attack   ?? 5,
      defense:    def.combatStats?.defense ?? def.defense ?? 5,
      speed:      def.combatStats?.speed  ?? def.speed    ?? 5,
      leadership: extras?.leadership ?? 0,
      magic:      extras?.magic      ?? 0,
      count,
      startCount: count,
      isLord:     extras?.isLord ?? false,
      isRouting:  false,
      _frenzBonus: 0,
      _burning:   false,
    };
  }

  // ── Context builder ─────────────────────────────────────────────

  function buildContext({ lord, army, encounter, terrain }) {
    const stats = LordService.getEffectiveStats(lord);

    // Lord as a combat unit — backline role, protected by infantry
    const lordUnit = _makeUnit('bu_lord', lord.id, {
      name:   lord.name,
      traits: ['backline'],
      abilities: [],
      combatStats: {
        attack:  stats.attack,
        defense: stats.defense,
        hp:      stats.health,
        speed:   stats.speed,
      },
    }, 1, {
      role:       'lord',
      isLord:     true,
      leadership: stats.leadership,
      magic:      stats.magic || 0,
      currentHp:  lord.currentHp ?? stats.health,
    });

    const armyUnits = (army?.units || [])
      .map((stack, i) => {
        const def = UNIT_DEFS[stack.unitId];
        if (!def) return null;
        return _makeUnit('bu_' + i, stack.unitId, def, stack.count, { currentHp: stack.currentHp });
      })
      .filter(Boolean);

    // Apply combat talent traits/bonuses to the lord's battle unit
    const talentEffects = (typeof LordService !== 'undefined')
      ? LordService.getTalentEffects(lord)
      : ((typeof TALENT_POOL !== 'undefined' && lord.talentId) ? (TALENT_POOL[lord.talentId]?.effects || {}) : {});

    if (talentEffects.battleUnitAttackBonus)  lordUnit.attack  += talentEffects.battleUnitAttackBonus;
    if (talentEffects.battleUnitDefenseBonus) lordUnit.defense += talentEffects.battleUnitDefenseBonus;
    if (talentEffects.battleUnitTraits) {
      for (const t of talentEffects.battleUnitTraits) {
        if (!lordUnit.traits.includes(t)) lordUnit.traits.push(t);
      }
    }

    const leaderMoraleBonus = stats.leadership * 1.5;
    const attackerMorale    = Math.min(100, 75 + leaderMoraleBonus + (talentEffects.attackerMoraleBonus || 0));

    const defenderUnits = encounter.defenders
      .map((d, i) => {
        const def = UNIT_DEFS[d.unitId];
        if (!def) return null;
        return _makeUnit('db_' + i, d.unitId, def, d.count);
      })
      .filter(Boolean);

    const defenderMorale = Math.max(0, (encounter.startingMorale || 50) - (talentEffects.defenderMoraleMalus || 0));

    return {
      terrain,
      encounter,
      attacker: { id: 'player',          units: [lordUnit, ...armyUnits], morale: attackerMorale },
      defender: { id: encounter.name,    units: defenderUnits,            morale: defenderMorale },
    };
  }

  // ── Damage calculation ─────────────────────────────────────────

  function _computeDamage(attacker, target, phase, terrainMods) {
    let baseDmg   = attacker.attack * _rand(0.85, 1.15);
    let reduction = target.defense * 0.4;

    // armor_piercing nearly bypasses defense
    if (attacker.traits.includes('armor_piercing')) reduction *= 0.20;

    let finalDmg = Math.max(1, baseDmg - reduction);

    // charge phase: flat multiplier then terrain
    if (phase === 'charge' && attacker.traits.includes('charge')) {
      finalDmg *= 2.0 * terrainMods.chargeMult;
    }

    // anti_large: bonus vs large enemies
    if (attacker.traits.includes('anti_large') && target.traits.includes('large')) {
      finalDmg *= 1.4;
    }

    // bloodlust: bonus vs wounded targets
    if (attacker.traits.includes('bloodlust') && target.currentHp < target.maxHp * 0.5) {
      finalDmg *= 1.3;
    }

    // fragile: defender takes extra damage
    if (target.traits.includes('fragile')) finalDmg *= 1.25;

    // fire_attack: mark target as burning (suppresses regen next end-of-round)
    if (attacker.traits.includes('fire_attack')) target._burning = true;

    return Math.max(1, Math.ceil(finalDmg));
  }

  // Applies damage to a unit stack with model-death overflow.
  // Returns { modelsKilled, dodged }.
  function _applyDamage(target, damage, round, phase, attacker, activeTrait, events) {
    // dodge: 20% miss chance
    if (target.traits.includes('dodge') && Math.random() < 0.2) {
      events.push({
        round, phase,
        actorId: attacker.id, actorName: attacker.name,
        targetId: target.id,  targetName: target.name,
        trait: 'dodge', ability: null,
        damage: 0, hpBefore: target.currentHp, hpAfter: target.currentHp,
        result: 'miss',
      });
      return { modelsKilled: 0, dodged: true };
    }

    // shield_wall: -20% damage when target is frontline infantry in melee
    if (phase === 'melee' && target.traits.includes('shield_wall') && target.role === 'infantry') {
      damage = Math.max(1, Math.ceil(damage * 0.8));
    }

    let modelsKilled = 0;
    let remaining    = damage;

    while (remaining > 0 && target.count > 0) {
      const hpBefore    = target.currentHp;
      target.currentHp -= remaining;

      if (target.currentHp <= 0) {
        remaining        = -target.currentHp; // overflow carries to next model
        target.count--;
        modelsKilled++;
        const result = target.count === 0 ? 'eliminated' : 'killed';
        events.push({
          round, phase,
          actorId: attacker.id, actorName: attacker.name,
          targetId: target.id,  targetName: target.name,
          trait: activeTrait, ability: null,
          damage, hpBefore, hpAfter: 0,
          result,
        });
        if (target.count > 0) {
          target.currentHp = target.maxHp; // next model starts fresh
        } else {
          remaining = 0;
        }
      } else {
        events.push({
          round, phase,
          actorId: attacker.id, actorName: attacker.name,
          targetId: target.id,  targetName: target.name,
          trait: activeTrait, ability: null,
          damage, hpBefore, hpAfter: target.currentHp,
          result: 'hit',
        });
        remaining = 0;
      }
    }

    return { modelsKilled, dodged: false };
  }

  // Picks the active trait label to surface in the event log.
  function _activeTrait(attacker, phase) {
    if (phase === 'charge' && attacker.traits.includes('charge'))          return 'charge';
    if (attacker.traits.includes('armor_piercing'))                         return 'armor_piercing';
    if (attacker.traits.includes('fire_attack'))                            return 'fire_attack';
    if (attacker.traits.includes('bloodlust'))                              return 'bloodlust';
    if (attacker.traits.includes('anti_large'))                             return 'anti_large';
    return null;
  }

  // Executes a single unit's attack against the enemy side.
  // Returns { modelsKilled, chargeHit }.
  function _executeAttack(attacker, enemySide, phase, terrainMods, round, events) {
    const target = TargetingService.select(attacker, enemySide);
    if (!target) return { modelsKilled: 0, chargeHit: false };

    const damage = _computeDamage(attacker, target, phase, terrainMods);
    const trait  = _activeTrait(attacker, phase);
    const result = _applyDamage(target, damage, round, phase, attacker, trait, events);

    const chargeHit = phase === 'charge' && !result.dodged && attacker.traits.includes('charge');
    return { modelsKilled: result.modelsKilled, chargeHit };
  }

  // Sort a unit list by speed descending (fast units act first within phase).
  function _bySpeed(units) {
    return [...units].sort((a, b) => b.speed - a.speed);
  }

  // ── Main resolve loop ───────────────────────────────────────────

  function resolve(ctx) {
    const events      = [];
    const terrainMods = TERRAIN_BATTLE_MODS[ctx.terrain] || TERRAIN_BATTLE_MODS.plains;
    let   winner      = null;
    let   reason      = 'max_rounds';
    let   rounds      = 0;

    // Pre-battle: terror / fear / monster morale penalties
    MoraleService.applyPreBattle(ctx);

    for (let round = 1; round <= 10; round++) {
      rounds = round;

      let atkLosses      = 0;
      let defLosses      = 0;
      let chargeHitAtk   = false;
      let chargeHitDef   = false;

      // 1. Passive Phase
      TraitProcessor.applyPassive(ctx, round, events);

      // 2. Ranged Phase
      const atkRanged = _bySpeed(ctx.attacker.units.filter(u => _alive(u) && u.traits.includes('ranged')));
      const defRanged = _bySpeed(ctx.defender.units.filter(u => _alive(u) && u.traits.includes('ranged')));

      // Pyroblast: round 1 only — lord with pyroblast trait fires a splash hitting ALL defenders
      if (round === 1) {
        const pyroblaster = ctx.attacker.units.find(u => _alive(u) && u.isLord && u.traits.includes('pyroblast'));
        if (pyroblaster) {
          ctx.defender.units.filter(_alive).forEach(target => {
            const splash = Math.max(1, Math.ceil((pyroblaster.magic || pyroblaster.attack) * 0.7));
            const hpBefore = target.currentHp;
            target.currentHp = Math.max(0, target.currentHp - splash);
            target._burning  = true;
            if (target.currentHp <= 0 && target.count > 0) { target.count--; target.currentHp = target.maxHp; }
            events.push({
              round, phase: 'ranged',
              actorId: pyroblaster.id, actorName: pyroblaster.name,
              targetId: target.id, targetName: target.name,
              trait: 'pyroblast', ability: null,
              damage: splash, hpBefore, hpAfter: target.currentHp,
              result: 'hit',
            });
            if (target.count > 0) defLosses += 0; // models may die from HP drain
          });
          // Count models wiped out by pyroblast splash
          ctx.defender.units.forEach(u => {
            if (u._burning && u.count === 0) defLosses++;
          });
        }
      }

      for (const unit of atkRanged) {
        if (!_sideAlive(ctx.defender)) break;
        const r = _executeAttack(unit, ctx.defender, 'ranged', terrainMods, round, events);
        defLosses += r.modelsKilled;
      }
      for (const unit of defRanged) {
        if (!_sideAlive(ctx.attacker)) break;
        const r = _executeAttack(unit, ctx.attacker, 'ranged', terrainMods, round, events);
        atkLosses += r.modelsKilled;
      }

      if (!_sideAlive(ctx.defender)) { winner = 'attacker'; reason = 'eliminated'; break; }
      if (!_sideAlive(ctx.attacker)) { winner = 'defender'; reason = 'eliminated'; break; }

      // 3. Charge Phase (round 1 only — cavalry with 'charge' trait)
      if (round === 1) {
        const atkCharge = _bySpeed(ctx.attacker.units.filter(u => _alive(u) && u.traits.includes('charge') && u.role === 'cavalry'));
        const defCharge = _bySpeed(ctx.defender.units.filter(u => _alive(u) && u.traits.includes('charge') && u.role === 'cavalry'));

        for (const unit of atkCharge) {
          if (!_sideAlive(ctx.defender)) break;
          const r = _executeAttack(unit, ctx.defender, 'charge', terrainMods, round, events);
          defLosses += r.modelsKilled;
          if (r.chargeHit) chargeHitDef = true;
        }
        for (const unit of defCharge) {
          if (!_sideAlive(ctx.attacker)) break;
          const r = _executeAttack(unit, ctx.attacker, 'charge', terrainMods, round, events);
          atkLosses += r.modelsKilled;
          if (r.chargeHit) chargeHitAtk = true;
        }

        if (!_sideAlive(ctx.defender)) { winner = 'attacker'; reason = 'eliminated'; break; }
        if (!_sideAlive(ctx.attacker)) { winner = 'defender'; reason = 'eliminated'; break; }
      }

      // 4. Melee Phase (all non-routed units)
      const atkMelee = _bySpeed(ctx.attacker.units.filter(_alive));
      const defMelee = _bySpeed(ctx.defender.units.filter(_alive));

      for (const unit of atkMelee) {
        if (!_sideAlive(ctx.defender)) break;
        const r = _executeAttack(unit, ctx.defender, 'melee', terrainMods, round, events);
        defLosses += r.modelsKilled;
        // double_strike: 30% chance to attack a second time in melee
        if (unit.traits.includes('double_strike') && Math.random() < 0.30 && _sideAlive(ctx.defender)) {
          const r2 = _executeAttack(unit, ctx.defender, 'melee', terrainMods, round, events);
          defLosses += r2.modelsKilled;
        }
      }
      for (const unit of defMelee) {
        if (!_sideAlive(ctx.attacker)) break;
        const r = _executeAttack(unit, ctx.attacker, 'melee', terrainMods, round, events);
        atkLosses += r.modelsKilled;
        if (unit.traits.includes('double_strike') && Math.random() < 0.30 && _sideAlive(ctx.attacker)) {
          const r2 = _executeAttack(unit, ctx.attacker, 'melee', terrainMods, round, events);
          atkLosses += r2.modelsKilled;
        }
      }

      if (!_sideAlive(ctx.defender)) { winner = 'attacker'; reason = 'eliminated'; break; }
      if (!_sideAlive(ctx.attacker)) { winner = 'defender'; reason = 'eliminated'; break; }

      // 5. Morale Phase
      const atkRouted = MoraleService.update(ctx.attacker, atkLosses, chargeHitAtk, ctx.terrain);
      const defRouted = MoraleService.update(ctx.defender, defLosses, chargeHitDef, ctx.terrain);

      if (atkRouted || MoraleService.checkRetreat(ctx.attacker)) {
        ctx.attacker.units.forEach(u => { u.isRouting = true; });
        winner = 'defender';
        reason = atkRouted ? 'routed' : 'retreated';
        events.push({ round, phase: 'morale', actorId: null, actorName: 'Attacker', targetId: null, targetName: null, trait: null, ability: null, damage: 0, hpBefore: 0, hpAfter: 0, result: reason });
        break;
      }
      if (defRouted || MoraleService.checkRetreat(ctx.defender)) {
        ctx.defender.units.forEach(u => { u.isRouting = true; });
        winner = 'attacker';
        reason = defRouted ? 'routed' : 'retreated';
        events.push({ round, phase: 'morale', actorId: null, actorName: 'Defender', targetId: null, targetName: null, trait: null, ability: null, damage: 0, hpBefore: 0, hpAfter: 0, result: reason });
        break;
      }

      // 6. End-of-Round traits (regen heal, frenzy increment)
      TraitProcessor.applyEndOfRound(ctx, round, events);

      if (!_sideAlive(ctx.defender)) { winner = 'attacker'; reason = 'eliminated'; break; }
      if (!_sideAlive(ctx.attacker)) { winner = 'defender'; reason = 'eliminated'; break; }
    }

    // Max rounds: compare surviving model counts
    if (!winner) {
      const atkAlive = ctx.attacker.units.filter(_alive).reduce((s, u) => s + u.count, 0);
      const defAlive = ctx.defender.units.filter(_alive).reduce((s, u) => s + u.count, 0);
      if (atkAlive > defAlive)      { winner = 'attacker'; }
      else if (defAlive > atkAlive) { winner = 'defender'; }
      else                          { winner = 'draw'; }
    }

    return _buildReport(ctx, winner, reason, rounds, events);
  }

  // ── Report builder ──────────────────────────────────────────────

  function _sideReport(side) {
    // Include routed units in surviving if they still have models — only deaths reduce count.
    // The `routed` flag on each entry lets the UI show them differently.
    const surviving = side.units
      .filter(u => u.count > 0)
      .map(u => ({ sourceId: u.sourceId, count: u.count, avgHp: u.currentHp, routed: u.isRouting }));

    // modelsLost = only actual deaths (count decremented by overflow damage)
    const modelsLost = side.units.reduce((sum, u) => sum + (u.startCount - u.count), 0);

    return {
      unitsStart:     side.units.map(u => ({ sourceId: u.sourceId, count: u.startCount })),
      unitsSurviving: surviving,
      modelsLost:     Math.max(0, modelsLost),
      moraleEnd:      Math.round(Math.max(0, side.morale)),
      routed:         side.units.some(u => u.isRouting),
    };
  }

  function _buildReport(ctx, winner, reason, rounds, events) {
    // ctx.encounter is absent when called from the battle simulator (no PvE encounter)
    const enc = ctx.encounter || null;
    let lootGold = 0;
    let xpEarned = 0;
    if (enc) {
      if (winner === 'attacker') {
        lootGold = Math.floor((enc.loot?.goldMin ?? 0) + Math.random() * ((enc.loot?.goldMax ?? 0) - (enc.loot?.goldMin ?? 0)));
        xpEarned = enc.xpReward?.win ?? 0;
      } else {
        xpEarned = enc.xpReward?.loss ?? 0;
      }
    }

    return {
      winner,
      reason,
      rounds,
      attacker:  _sideReport(ctx.attacker),
      defender:  _sideReport(ctx.defender),
      xpEarned,
      loot:      { gold: lootGold },
      events,
    };
  }

  return { buildContext, resolve };
})();
