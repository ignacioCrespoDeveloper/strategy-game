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

  // Effective lord stats: base + class modifiers + mount bonuses. Self-contained
  // (doesn't call LordService) so buildContext() works identically whether
  // BattleEngine runs in the browser or in the server's isolated VM context
  // (engine-loader.js) — LordService is a client-only singleton (depends on
  // StorageService/ArmyService/etc.) that is never loaded server-side, so
  // calling it there throws a ReferenceError. This mirrors LordService.
  // getEffectiveStats() (js/domain/lord.js) and _effectiveStats()
  // (server/combat-resolver.js) — a third independent copy, same pattern
  // already used elsewhere in this codebase for engine-shared formulas.
  function _lordEffectiveStats(lord) {
    const base  = lord.baseStats || { ...LORD_BASE_STATS };
    const cls   = LORD_CLASSES[lord.classId];
    const mods  = cls?.modifiers || {};
    const mount = (typeof MOUNT_POOL !== 'undefined' && lord.mountId) ? (MOUNT_POOL[lord.mountId]?.effects || {}) : {};
    const result = {};
    for (const key of Object.keys(LORD_BASE_STATS)) {
      result[key] = (base[key] ?? LORD_BASE_STATS[key]) + (mods[key] || 0) + (mount[key] || 0);
    }
    return result;
  }

  function buildContext({ lord, army, encounter, terrain }) {
    const stats = _lordEffectiveStats(lord);

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

  // A stack's whole living count fights as one combined attack per phase per
  // round (never per-model), so its damage must scale with how many models
  // are still alive in it — otherwise a stack of 1 and a stack of 20 hit
  // identically hard. Dampened (count^0.8, not linear) so a single round
  // isn't a guaranteed full wipe once stacks get large. Lords and 1-model
  // stacks are unaffected (count=1 → multiplier=1).
  function _stackDamageMult(count) {
    return Math.pow(Math.max(1, count), 0.8);
  }

  // Max-rounds tiebreak uses this — remaining combat POWER per side, dampened
  // per stack with the same exponent as the army-power "PWR" score used for
  // recruiting (js/ui/lord-screen.js _armyPower, etc.). Comparing raw
  // surviving model count instead would let a swarm of nearly-irrelevant
  // survivors out-"win" a barely-touched elite force just by having more
  // bodies left standing, regardless of how little fight is actually left in them.
  function _sidePower(units) {
    return units.filter(_alive).reduce((sum, u) => {
      return sum + (u.attack * 3 + u.defense * 2 + Math.floor(u.maxHp / 10) + u.speed) * Math.pow(u.count, 0.8);
    }, 0);
  }

  // Returns { damage, heavyArmor }. heavyArmor flags hits where the target's
  // defense swallowed most of the raw damage — surfaced in the report so a
  // suspiciously low number reads as "that target is heavily armored" rather
  // than looking like a broken engine. Armor-piercing attackers bypass most
  // of that reduction, so they rarely (correctly) trigger this flag.
  function _computeDamage(attacker, target, phase, terrainMods) {
    let baseDmg   = attacker.attack * _stackDamageMult(attacker.count) * _rand(0.85, 1.15);
    let reduction = target.defense * 0.4;

    // armor_piercing nearly bypasses defense
    if (attacker.traits.includes('armor_piercing')) reduction *= 0.20;

    const heavyArmor = reduction >= baseDmg * 0.55;

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

    return { damage: Math.max(1, Math.ceil(finalDmg)), heavyArmor };
  }

  // Applies damage to a unit stack with model-death overflow.
  // actorSide: 'attacker' | 'defender' — which side the acting unit belongs to,
  // so the report renderer can label events as "yours" vs "theirs" without
  // guessing from id prefixes.
  // Returns { modelsKilled, dodged }.
  function _applyDamage(target, damage, round, phase, attacker, activeTrait, events, actorSide, heavyArmor) {
    const targetSide = actorSide === 'attacker' ? 'defender' : 'attacker';
    // dodge: 20% miss chance
    if (target.traits.includes('dodge') && Math.random() < 0.2) {
      events.push({
        round, phase,
        actorId: attacker.id, actorName: attacker.name, actorSide, actorCount: attacker.count,
        targetId: target.id,  targetName: target.name,  targetSide,
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
          actorId: attacker.id, actorName: attacker.name, actorSide, actorCount: attacker.count,
          targetId: target.id,  targetName: target.name,  targetSide, heavyArmor,
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
          actorId: attacker.id, actorName: attacker.name, actorSide, actorCount: attacker.count,
          targetId: target.id,  targetName: target.name,  targetSide, heavyArmor,
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
  // actorSide: 'attacker' | 'defender' — which side `attacker` belongs to.
  // Returns { modelsKilled, chargeHit }.
  function _executeAttack(attacker, enemySide, phase, terrainMods, round, events, actorSide) {
    const target = TargetingService.select(attacker, enemySide);
    if (!target) return { modelsKilled: 0, chargeHit: false };

    const { damage, heavyArmor } = _computeDamage(attacker, target, phase, terrainMods);
    const trait  = _activeTrait(attacker, phase);
    const result = _applyDamage(target, damage, round, phase, attacker, trait, events, actorSide, heavyArmor);

    const chargeHit = phase === 'charge' && !result.dodged && attacker.traits.includes('charge');
    return { modelsKilled: result.modelsKilled, chargeHit };
  }

  // Sort a unit list by speed descending (fast units act first within phase).
  function _bySpeed(units) {
    return [...units].sort((a, b) => b.speed - a.speed);
  }

  // Pyroblast: round 1 only — a lord with the pyroblast trait fires a splash
  // hitting ALL units on the opposing side, using the caster's magic stat
  // (not attack — this is a magic attack) and suppressing their regeneration.
  // Works for whichever side has the caster (attacker OR defender), since a
  // defending mage lord is just as capable of casting it as an attacking one.
  function _applyPyroblast(casterUnits, targetSide, casterSideName, targetSideName, round, events) {
    const caster = casterUnits.find(u => _alive(u) && u.isLord && u.traits.includes('pyroblast'));
    if (!caster) return 0;

    targetSide.units.filter(_alive).forEach(target => {
      const splash    = Math.max(1, Math.ceil((caster.magic || caster.attack) * 0.7));
      const hpBefore  = target.currentHp;
      target.currentHp = Math.max(0, target.currentHp - splash);
      target._burning  = true;
      if (target.currentHp <= 0 && target.count > 0) { target.count--; target.currentHp = target.maxHp; }
      events.push({
        round, phase: 'ranged',
        actorId: caster.id, actorName: caster.name, actorSide: casterSideName,
        targetId: target.id, targetName: target.name, targetSide: targetSideName,
        trait: 'pyroblast', ability: null,
        damage: splash, hpBefore, hpAfter: target.currentHp,
        result: 'hit',
      });
    });

    // Count models wiped out by the splash
    let kills = 0;
    targetSide.units.forEach(u => { if (u._burning && u.count === 0) kills++; });
    return kills;
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

      // Pyroblast: round 1 only — checked on both sides, since a defending
      // mage lord can cast it just as well as an attacking one.
      if (round === 1) {
        defLosses += _applyPyroblast(ctx.attacker.units, ctx.defender, 'attacker', 'defender', round, events);
        atkLosses += _applyPyroblast(ctx.defender.units, ctx.attacker, 'defender', 'attacker', round, events);
      }

      for (const unit of atkRanged) {
        if (!_sideAlive(ctx.defender)) break;
        const r = _executeAttack(unit, ctx.defender, 'ranged', terrainMods, round, events, 'attacker');
        defLosses += r.modelsKilled;
      }
      for (const unit of defRanged) {
        if (!_sideAlive(ctx.attacker)) break;
        const r = _executeAttack(unit, ctx.attacker, 'ranged', terrainMods, round, events, 'defender');
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
          const r = _executeAttack(unit, ctx.defender, 'charge', terrainMods, round, events, 'attacker');
          defLosses += r.modelsKilled;
          if (r.chargeHit) chargeHitDef = true;
        }
        for (const unit of defCharge) {
          if (!_sideAlive(ctx.attacker)) break;
          const r = _executeAttack(unit, ctx.attacker, 'charge', terrainMods, round, events, 'defender');
          atkLosses += r.modelsKilled;
          if (r.chargeHit) chargeHitAtk = true;
        }

        if (!_sideAlive(ctx.defender)) { winner = 'attacker'; reason = 'eliminated'; break; }
        if (!_sideAlive(ctx.attacker)) { winner = 'defender'; reason = 'eliminated'; break; }
      }

      // 4. Melee Phase (all non-routed, non-ranged units — ranged units already
      // acted this round in the Ranged phase; without this exclusion they'd
      // get two attacks per round while melee-only units only get one)
      const atkMelee = _bySpeed(ctx.attacker.units.filter(u => _alive(u) && !u.traits.includes('ranged')));
      const defMelee = _bySpeed(ctx.defender.units.filter(u => _alive(u) && !u.traits.includes('ranged')));

      for (const unit of atkMelee) {
        if (!_sideAlive(ctx.defender)) break;
        const r = _executeAttack(unit, ctx.defender, 'melee', terrainMods, round, events, 'attacker');
        defLosses += r.modelsKilled;
        // double_strike: 30% chance to attack a second time in melee
        if (unit.traits.includes('double_strike') && Math.random() < 0.30 && _sideAlive(ctx.defender)) {
          const r2 = _executeAttack(unit, ctx.defender, 'melee', terrainMods, round, events, 'attacker');
          defLosses += r2.modelsKilled;
        }
      }
      for (const unit of defMelee) {
        if (!_sideAlive(ctx.attacker)) break;
        const r = _executeAttack(unit, ctx.attacker, 'melee', terrainMods, round, events, 'defender');
        atkLosses += r.modelsKilled;
        if (unit.traits.includes('double_strike') && Math.random() < 0.30 && _sideAlive(ctx.attacker)) {
          const r2 = _executeAttack(unit, ctx.attacker, 'melee', terrainMods, round, events, 'defender');
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
        events.push({ round, phase: 'morale', actorId: null, actorName: 'Attacker', actorSide: 'attacker', targetId: null, targetName: null, trait: null, ability: null, damage: 0, hpBefore: 0, hpAfter: 0, result: reason });
        break;
      }
      if (defRouted || MoraleService.checkRetreat(ctx.defender)) {
        ctx.defender.units.forEach(u => { u.isRouting = true; });
        winner = 'attacker';
        reason = defRouted ? 'routed' : 'retreated';
        events.push({ round, phase: 'morale', actorId: null, actorName: 'Defender', actorSide: 'defender', targetId: null, targetName: null, trait: null, ability: null, damage: 0, hpBefore: 0, hpAfter: 0, result: reason });
        break;
      }

      // 6. End-of-Round traits (regen heal, frenzy increment)
      TraitProcessor.applyEndOfRound(ctx, round, events);

      if (!_sideAlive(ctx.defender)) { winner = 'attacker'; reason = 'eliminated'; break; }
      if (!_sideAlive(ctx.attacker)) { winner = 'defender'; reason = 'eliminated'; break; }
    }

    // Max rounds: compare remaining combat power (dampened per stack), not
    // raw surviving model count — see _sidePower above.
    if (!winner) {
      const atkPower = _sidePower(ctx.attacker.units);
      const defPower = _sidePower(ctx.defender.units);
      if (atkPower > defPower)      { winner = 'attacker'; }
      else if (defPower > atkPower) { winner = 'defender'; }
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
      .map(u => ({ sourceId: u.sourceId, name: u.name, count: u.count, avgHp: u.currentHp, routed: u.isRouting }));

    // modelsLost = only actual deaths (count decremented by overflow damage)
    const modelsLost = side.units.reduce((sum, u) => sum + (u.startCount - u.count), 0);

    return {
      // maxHp is included here (not just derived from UNIT_DEFS in the UI) because lord
      // units aren't in UNIT_DEFS at all — without this their HP bar always renders at 0%.
      unitsStart:     side.units.map(u => ({ sourceId: u.sourceId, name: u.name, count: u.startCount, maxHp: u.maxHp, isLord: u.isLord })),
      unitsSurviving: surviving,
      modelsLost:     Math.max(0, modelsLost),
      moraleEnd:      Math.round(Math.max(0, side.morale)),
      routed:         side.units.some(u => u.isRouting),
    };
  }

  const _LOOT_RES_TYPES = ['food', 'wood', 'stone', 'iron'];

  function _buildReport(ctx, winner, reason, rounds, events) {
    // ctx.encounter is absent when called from the battle simulator (no PvE encounter)
    const enc = ctx.encounter || null;
    let lootGold = 0;
    let lootResource = null; // { [resType]: amount } — a single random resource, camps hold plundered goods.
    // Same shape as the PvP city-loot object (server/combat-resolver.js _lootResources),
    // just sparse to one key, so both feed the same display code client-side.
    let xpEarned = 0;
    if (enc) {
      if (winner === 'attacker') {
        lootGold = Math.floor((enc.loot?.goldMin ?? 0) + Math.random() * ((enc.loot?.goldMax ?? 0) - (enc.loot?.goldMin ?? 0)));
        if (enc.loot?.resMax > 0) {
          const amount = Math.floor((enc.loot.resMin ?? 0) + Math.random() * (enc.loot.resMax - (enc.loot.resMin ?? 0)));
          if (amount > 0) lootResource = { [_LOOT_RES_TYPES[Math.floor(Math.random() * _LOOT_RES_TYPES.length)]]: amount };
        }
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
      loot:      { gold: lootGold, resource: lootResource },
      events,
    };
  }

  return { buildContext, resolve };
})();
