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
    // getLordMountEffects (lord-classes.js) rather than a raw MOUNT_POOL
    // lookup: mounts became race-exclusive on 2026-07-30, so a stored id has
    // to be resolved against lord.race before its effects mean anything.
    const mount = (typeof getLordMountEffects !== 'undefined') ? getLordMountEffects(lord) : {};
    const result = {};
    for (const key of Object.keys(LORD_BASE_STATS)) {
      result[key] = (base[key] ?? LORD_BASE_STATS[key]) + (mods[key] || 0) + (mount[key] || 0);
    }
    return result;
  }

  // veterancy (optional): unitId => pct — training-building buff applied to
  // the player's army units (+pct attack/defense). See EconomyCore.getVeterancyPct.
  function buildContext({ lord, army, encounter, terrain, veterancy }) {
    const stats = _lordEffectiveStats(lord);
    const vetFn = veterancy || (() => 0);

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
        const unit = _makeUnit('bu_' + i, stack.unitId, def, stack.count, { currentHp: stack.currentHp });
        const pct  = vetFn(stack.unitId) || 0;
        if (pct) {
          unit.attack  = Math.round(unit.attack  * (1 + pct));
          unit.defense = Math.round(unit.defense * (1 + pct));
        }
        return unit;
      })
      .filter(Boolean);

    // Apply combat talent traits/bonuses to the lord's battle unit — merged
    // across every talent the lord holds (up to four since 2026-08-03).
    const talentEffects = (typeof LordService !== 'undefined')
      ? LordService.getTalentEffects(lord)
      : ((typeof lordTalentEffects !== 'undefined') ? lordTalentEffects(lord) : {});

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
  // identically hard. LINEAR since 2026-07-27: this used to be count^0.8,
  // which was fine while the PWR recruit cap was also dampened — but once
  // the cap went linear, the mismatch made ten 1-stacks deal ~37% more
  // damage than one 10-stack of the same unit at identical PWR price, and
  // "hire exactly one of everything" became the dominant meta (balance
  // suite: 86.7% top combo, 7.3% bottom). Linear damage + linear pricing
  // makes army SHAPE cost-neutral; composition is about roles and traits.
  function _stackDamageMult(count) {
    return Math.max(1, count);
  }

  // Remaining combat POWER per side — drives round-by-round morale loss
  // and the max-rounds tiebreak. Scaled linearly per stack like the
  // army-power "PWR" score used for recruiting (EconomyCore.getArmyPower),
  // and HP-AWARE: the active model counts at its currentHp fraction, so a
  // wounded dragon reads as partially lost power. Without that, a big
  // single model counted at full strength until the instant it died and
  // then cliffed the side's morale by its entire value in one round —
  // dragon-heavy armies routed off a single death.
  // Speed at ×0.5 — the SAME weighting as EconomyCore.getUnitPower. At
  // full weight, slow rosters bought more tiebreak-power per PWR-cap
  // point by construction, so any fight that reached max rounds went to
  // the slowest army automatically (early-game dwarfs won long grinds
  // 99.9% off this alone).
  function _sidePower(units) {
    return units.filter(_alive).reduce((sum, u) => {
      const perModel = u.attack * 3 + u.defense * 2 + Math.floor(u.maxHp / 10) + u.speed * 0.5;
      const hpFrac   = u.maxHp > 0 ? Math.max(0, Math.min(1, u.currentHp / u.maxHp)) : 1;
      return sum + perModel * (u.count - 1 + hpFrac);
    }, 0);
  }

  // Returns { damage, heavyArmor }. heavyArmor flags hits where the target's
  // defense swallowed most of the raw damage — surfaced in the report so a
  // suspiciously low number reads as "that target is heavily armored" rather
  // than looking like a broken engine. Armor-piercing attackers bypass most
  // of that reduction, so they rarely (correctly) trigger this flag.
  // How much of the target's defense stat is subtracted from an incoming swing.
  // PER MODEL — see the note below.
  // Swept against test-balance.js on 2026-08-03 after the per-model change.
  // The old 0.4 was calibrated for PER-STACK subtraction, where a deep stack
  // paid it once; per model it is punishing, and it lands hardest on cheap
  // low-attack chaff whose whole swing is smaller than the reduction:
  //
  //   k     race bands out of 38-62%          worst archetype
  //   0.40  orc start 11.6, dark elf 84.5     orc/blocks 20.3
  //   0.30  orc start 21.2, dark elf 75.7     orc/blocks 23.4
  //   0.25  orc start 29.8, dark elf 68.2     orc/blocks 23.5
  //   0.20  ALL PASS (orc 39.0, dark elf 60.4) orc/swarm 76.8
  //   0.15  ALL PASS (orc 50.9, dark elf 52.6) orc/swarm 81.4
  //
  // 0.20 is the value where every race band comes back inside its window with
  // the least disturbance to the rest of the curve. Lower than that and cheap
  // mass starts running away with it (orc/swarm climbing past its ceiling),
  // which is the same swarm problem the `coward` morale tax exists to price.
  const ARMOR_REDUCTION = 0.20;

  function _computeDamage(attacker, target, phase, terrainMods, modelsOverride) {
    // ARMOR IS SUBTRACTED PER MODEL, NOT PER STACK (fixed 2026-08-03).
    //
    // This used to read:
    //     baseDmg   = attack × count × rand
    //     reduction = defense × 0.4
    //     finalDmg  = max(1, baseDmg − reduction)
    //
    // Damage scaled with the stack's model count but the armour subtraction did
    // not, so a target's defense was amortised across however many models the
    // attacker happened to have in one stack. Twenty models in ONE stack ate the
    // reduction once; the same twenty models split across twenty stacks ate it
    // twenty times, for the same PWR and the same units. Measured before the
    // fix: one deep stack of 20 beat twenty stacks of 1 of the IDENTICAL unit
    // 100% of the time. That is not a preference for concentration, it is an
    // arithmetic error, and it silently defeated the whole point of the
    // 2026-07-27 linear-damage pass — whose stated goal was that army SHAPE be
    // cost-neutral so composition could be about roles and traits.
    //
    // Now each model's swing is reduced individually and the stack's output is
    // the sum, which is what "twenty soldiers each hitting an armoured target"
    // has always meant. Consequences that are intended, not side effects:
    //   • armour is meaningfully stronger against many weak hits (a 3-attack
    //     model can no longer meaningfully hurt a 20-defense target, and the
    //     max(1, …) floor means it contributes 1 rather than nothing);
    //   • total damage from deep stacks drops (~20% at median stats), so
    //     battles run longer. The round cap and morale absorb this;
    //   • armor_piercing gets MORE valuable, since the reduction it cuts is now
    //     paid per model.
    // `modelsOverride` is how many of the stack's models are swinging in THIS
    // attack. _executeAttack splits a stack into groups that each pick their
    // own target (see MAX_ATTACK_GROUPS), so it passes the group's share here.
    // Absent → the whole stack, which is what every other caller means.
    const models  = _stackDamageMult(modelsOverride ?? attacker.count);
    let perModel  = attacker.attack * _rand(0.85, 1.15);
    let reduction = target.defense * ARMOR_REDUCTION;

    // armor_piercing nearly bypasses defense
    if (attacker.traits.includes('armor_piercing')) reduction *= 0.20;

    // Now a per-MODEL judgement, which is what the flag always meant to report:
    // "this target's armour is eating most of each blow". Comparing against the
    // whole stack's output made it fire less and less often the deeper the
    // stack got, regardless of how armoured the target actually was.
    const heavyArmor = reduction >= perModel * 0.55;

    let finalDmg = Math.max(1, perModel - reduction) * models;

    // charge phase: flat multiplier then terrain. ×1.4 since 2026-07-27 —
    // the old ×2.0 was tuned when stack damage was dampened (count^0.8);
    // with linear stack damage a 2-model knight charge became the hardest
    // single hit in the game and cavalry-rich rosters ran the table (the
    // suite's top three combos were all cavalry-heavy at ×1.5 too).
    // impact (2026-07-29): the charge lands like a rockslide — ×1.8
    // instead. Orc-exclusive via the boar lines (Boar Boyz, Savage Orc
    // Boars): start-game autopsy showed orc boars surviving lost fights
    // untouched while under-killing.
    // WEDGE (2026-07-29 mass pass): +0.05 per living rider beyond the
    // first, capped +0.2 — six knights hitting as one formation strike
    // harder per lance than a lone rider. One of the two deliberate
    // mass-scaling bonuses that give deep stacks a reason to exist
    // (see shield_wall ranks in _applyDamage).
    if (phase === 'charge' && attacker.traits.includes('charge')) {
      const wedge = Math.min(0.2, 0.05 * Math.max(0, attacker.count - 1));
      finalDmg *= ((attacker.traits.includes('impact') ? 1.8 : 1.4) + wedge) * terrainMods.chargeMult;
    }

    // anti_large: bonus vs large enemies
    if (attacker.traits.includes('anti_large') && target.traits.includes('large')) {
      finalDmg *= 1.4;
    }

    // anti_infantry: bonus vs massed ranks (2026-07-27 — Irondrakes'
    // drakefire; the line-melter mirror of anti_large)
    if (attacker.traits.includes('anti_infantry') && target.role === 'infantry') {
      finalDmg *= 1.4;
    }

    // accurate: every arrow placed with elven precision — +40% damage in
    // the ranged phase (2026-07-27; was flavor-only while the High Elves'
    // "quality" identity starved for bodies in a morale-driven engine.
    // ×1.2 lifted their start but left midgame at 21%; ×1.3→×1.4 on
    // 2026-07-29 to lift their early/mid curve — the trait is
    // High-Elves-exclusive, so it can safely carry more of their identity)
    if (phase === 'ranged' && attacker.traits.includes('accurate')) {
      finalDmg *= 1.4;
    }

    // aggressive: always spoiling for a scrap — +20% melee damage
    // (2026-07-29). Orc-exclusive via the Boyz line (Orc Boyz, Big 'Uns):
    // the green-tide melee identity, sized below berserk's +35%.
    if (phase === 'melee' && attacker.traits.includes('aggressive')) {
      finalDmg *= 1.2;
    }

    // berserk: an oath-sworn death-seeker swings without a thought for his
    // own skin — +30% MELEE damage (2026-07-29). Dwarf-exclusive via the
    // Slayer Lodge (Slayers, Giant Slayers), which unlocks mid-game: this
    // is the dwarf-dense lever that lifts their collapsed midgame without
    // touching the quarreller-wall start package.
    if (phase === 'melee' && attacker.traits.includes('berserk')) {
      finalDmg *= 1.35;
    }

    // stubborn: an unyielding formation is harder to kill, not just harder
    // to rout (2026-07-27 — the dwarf line's survivability identity).
    // MELEE/CHARGE ONLY: a locked shield line stops blades and cavalry,
    // not crossbow bolts — applied to ranged fire too, the early-game
    // warrior wall had no counter at all (dwarf start win rate hit 91%).
    if (target.traits.includes('stubborn') && (phase === 'melee' || phase === 'charge')) {
      finalDmg *= 0.88;
    }

    // monster: a single model the size of a barn hits like one (2026-07-27).
    // Without this a 255-PWR dragon swung once per round for less than the
    // same PWR of crossbowmen — monster armies were strictly bad buys.
    if (attacker.traits.includes('monster')) finalDmg *= 1.3;

    // heavy_armor: plate turns aside a quarter of any hit. Armor_piercing
    // HALVES that protection rather than ignoring it (2026-07-27 v2 —
    // full bypass meant the AP-saturated rosters simply deleted the
    // armor identity, and dwarfs lost every cross-race matchup).
    // Monsters hit hard → armor resists → AP cuts through, partially.
    if (target.traits.includes('heavy_armor')) {
      finalDmg *= attacker.traits.includes('armor_piercing') ? 0.875 : 0.75;
    }

    // bloodlust: bonus vs wounded targets
    if (attacker.traits.includes('bloodlust') && target.currentHp < target.maxHp * 0.5) {
      finalDmg *= 1.3;
    }

    // fragile: defender takes extra damage
    if (target.traits.includes('fragile')) finalDmg *= 1.25;

    // fire_attack: mark target as burning (suppresses regen next end-of-round)
    if (attacker.traits.includes('fire_attack')) target._burning = true;

    // ROUND, don't CEIL (2026-08-03). Rounding happens once per ATTACK, and a
    // side made of many shallow stacks makes many more attacks than one deep
    // stack of the same models — so `ceil` handed it a free +0.5 damage per
    // stack per phase. Measured on identical synthetic units: ten 1-model
    // stacks threw 4.9% more damage per fight than one 10-model stack purely
    // from this rounding, before any tactical difference.
    //
    // `round` is unbiased in expectation (the fractional part is ~uniform
    // thanks to the ×0.85–1.15 roll), so damage no longer depends on how the
    // same models happen to be grouped. The max(1, …) floor stays: an attack
    // that connects always does something.
    return { damage: Math.max(1, Math.round(finalDmg)), heavyArmor };
  }

  // Applies damage to a unit stack with model-death overflow.
  // actorSide: 'attacker' | 'defender' — which side the acting unit belongs to,
  // so the report renderer can label events as "yours" vs "theirs" without
  // guessing from id prefixes.
  // Returns { modelsKilled, dodged }.
  function _applyDamage(target, damage, round, phase, attacker, activeTrait, events, actorSide, heavyArmor) {
    const targetSide = actorSide === 'attacker' ? 'defender' : 'attacker';
    // duelist: a blade-master parries — 25% chance to turn aside a MELEE
    // hit (2026-07-27; ranged fire can't be parried). Swordmasters' trait.
    if (phase === 'melee' && target.traits.includes('duelist') && Math.random() < 0.25) {
      events.push({
        round, phase,
        actorId: attacker.id, actorName: attacker.name, actorSide, actorCount: attacker.count,
        targetId: target.id,  targetName: target.name,  targetSide,
        trait: 'duelist', ability: null,
        damage: 0, hpBefore: target.currentHp, hpAfter: target.currentHp,
        result: 'miss',
      });
      return { modelsKilled: 0, dodged: true };
    }

    // dodge: 30% miss chance (raised from 20% on 2026-07-27 — dodge units
    // are the dancers of the roster and were dying before they mattered)
    if (target.traits.includes('dodge') && Math.random() < 0.3) {
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

    // shield_wall: -20% damage when target is frontline infantry in melee.
    // RANKS (2026-07-29 mass pass): −2% more per living model beyond the
    // first, capped −30% — a wall is only a wall with ranks behind it.
    // The second of the two deliberate mass-scaling bonuses (see the
    // charge wedge in _computeDamage) that give deep stacks a reason to
    // exist alongside one-of-each variety.
    // Does NOT stack with heavy_armor — the plate already turned the blow
    // aside (heavy_armor now always applies at least partially, see
    // _computeDamage), so the shields add nothing on top. Stacked, an
    // Ironbreaker wall took ×0.75×0.8 from everything and hit 90% win
    // rate (2026-07-27).
    if (phase === 'melee' && target.traits.includes('shield_wall') && target.role === 'infantry' && !target.traits.includes('heavy_armor')) {
      const ranks = Math.min(0.30, 0.20 + 0.02 * Math.max(0, target.count - 1));
      damage = Math.max(1, Math.ceil(damage * (1 - ranks)));
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

    // Whatever damage is left after the stack died spills to the caller —
    // _executeAttack carries it into the next target stack.
    return { modelsKilled, dodged: false, overkill: target.count === 0 ? remaining : 0 };
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
  //
  // A STACK SPLITS INTO GROUPS, AND EACH GROUP PICKS ITS OWN TARGET
  // (2026-08-03). This is the fix for the last and largest shape defect.
  //
  // WHAT WAS WRONG. `_executeAttack` runs once per stack per phase and made ONE
  // TargetingService.select call. So the number of independent TACTICAL
  // DECISIONS an army got scaled with its number of STACKS, not its number of
  // models. Eleven stacks made eleven target picks; five stacks made five, at
  // identical total damage — measured on the two dark elf armies: 603 vs 613
  // damage thrown, 12.7 vs 6.3 attacks per round.
  //
  // That compounds. More picks finish off more enemy STACKS per round, and
  // killing a stack removes a whole attacker rather than a model — while the
  // side with few stacks loses a bigger share of its own output with each one.
  // Across the twenty tournament armies, all built to the same PWR cap, the
  // number of unit types correlated 0.694 with win rate. Nothing else came
  // close: total HP 0.373, model count 0.132, total attack 0.041, army PWR
  // −0.038. It was never about what you brought, only about how many piles you
  // split it into — and PWR charges nothing for being a separate pile.
  //
  // THE FIX. The stack is divided into up to MAX_ATTACK_GROUPS groups; each
  // group selects its own target and swings with its own share of the models.
  // Total damage is unchanged (the shares sum to the stack), so this moves
  // decisions, not power. Groups are also bounded by the number of living
  // enemy stacks — picking a sixth target when the enemy has three is wasted
  // work — and by the model count, so a lone monster still gets exactly one.
  //
  // The cap exists for the battle REPORT, which is persisted to Supabase: a
  // 40-model regiment writing 40 events per phase per round would balloon it.
  // Six captures nearly all of the effect (armies rarely field more than six
  // stacks a side) at a bounded cost.
  //
  // SPILLOVER (2026-07-27): if a group wipes its target stack, the leftover
  // carries into the next target, and so on. Contact carry is lossless and
  // bounded by the group's own bodies; ranged stays ×0.3 over a single hop,
  // which is what stopped massed artillery cleaving three stacks a round from
  // behind a wall (the 80%+ "castle" builds). Target-specific bonuses
  // (anti_large, bloodlust, fragile) are baked into the group's damage roll and
  // spill as-is — the sword doesn't get lighter mid-swing.
  const MAX_ATTACK_GROUPS = 6;

  // Overkill carry. CONTACT is lossless and bounded by the group's own bodies:
  // a stack absorbs damage losslessly (the cascade in _applyDamage), so it
  // should deal it that way too, and "as many enemies as you have bodies" is
  // the bound that keeps full carry from becoming the old cliff where one
  // 1-model monster cleaved eight stacks. RANGED stays lossy and single-hop —
  // see the note above _executeAttack.
  const CONTACT_FRICTION = 1.0;
  const RANGED_FRICTION  = 0.3;

  function _executeAttack(attacker, enemySide, phase, terrainMods, round, events, actorSide, engagedModels) {
    const liveEnemyStacks = enemySide.units.filter(_alive).length;
    if (liveEnemyStacks === 0) return { modelsKilled: 0, chargeHit: false };

    // How many of this stack's models actually reach the enemy this phase.
    // Defaults to all of them; the frontage budget (see _runAttacks) passes a
    // smaller number when the line is already full.
    const engaged = Math.max(0, Math.min(attacker.count, engagedModels ?? attacker.count));
    if (engaged === 0) return { modelsKilled: 0, chargeHit: false };

    const groups = Math.max(1, Math.min(engaged, liveEnemyStacks, MAX_ATTACK_GROUPS));
    const trait  = _activeTrait(attacker, phase);

    let modelsKilled = 0;
    let chargeHit    = false;

    for (let g = 0; g < groups; g++) {
      // Even split; the remainder goes to the first groups so the shares
      // always sum back to attacker.count and no damage is created or lost.
      const share = Math.floor(engaged / groups) + (g < engaged % groups ? 1 : 0);
      if (share <= 0) continue;

      const target = TargetingService.select(attacker, enemySide, round);
      if (!target) break;

      const { damage, heavyArmor } = _computeDamage(attacker, target, phase, terrainMods, share);
      const result = _applyDamage(target, damage, round, phase, attacker, trait, events, actorSide, heavyArmor);
      modelsKilled += result.modelsKilled;
      if (phase === 'charge' && !result.dodged && attacker.traits.includes('charge')) chargeHit = true;

      const friction = (phase === 'melee' || phase === 'charge') ? CONTACT_FRICTION
                     : phase === 'ranged' ? RANGED_FRICTION
                     : 0;
      const maxHops  = phase === 'ranged' ? 1 : share;
      let spill = Math.floor((result.overkill || 0) * friction);
      for (let hops = 0; spill > 0 && hops < maxHops; hops++) {
        const next = TargetingService.select(attacker, enemySide, round);
        if (!next) break;
        const spillResult = _applyDamage(next, spill, round, phase, attacker, trait, events, actorSide, heavyArmor);
        modelsKilled += spillResult.modelsKilled;
        spill         = Math.floor((spillResult.overkill || 0) * friction);
      }
    }

    return { modelsKilled, chargeHit };
  }

  // Sort a unit list by speed descending (fast units act first within phase).
  function _bySpeed(units) {
    return [...units].sort((a, b) => b.speed - a.speed);
  }

  // ── Frontage ──────────────────────────────────────────────────
  //
  // A battle line is only so wide. FRONTAGE is the number of MODELS a side can
  // bring into contact in one phase; anything beyond it is standing behind the
  // fighting, not in it. Set to 0 to disable the cap entirely.
  //
  // WHY MODELS AND NOT STACKS. The whole shape problem this engine has been
  // fighting is that packaging changed outcomes: eleven stacks of one model got
  // eleven independent attacks while five stacks of two got five, at identical
  // damage. A budget counted in MODELS is neutral by construction — both of
  // those armies put the same number of bodies into the line, whatever boxes
  // they arrived in — where a budget counted in stacks would just re-create the
  // same bias pointing the other way.
  //
  // It also gives the game a real strategic rule it did not have: past the
  // frontage, extra bodies stop adding damage, so a wide cheap horde converts
  // into reserves rather than output and army building becomes about quality
  // per model instead of quantity.
  //
  // Order of engagement is speed-sorted, the same order units already strike
  // in, so the quickest into contact are the ones that fight.
  //
  // ── SWEPT 2026-08-03, SHIPPED OFF, PENDING A DESIGN CALL ──
  //
  // The proposal: cap troops per round so that fielding many unit types becomes
  // counterproductive. It works — and the tighter it is, the more completely it
  // works — but it is a rebalance, not a patch. Measured against the whole
  // balance suite, `types-corr` being how strongly the number of unit types
  // predicts winning (0 = packaging no longer matters at all):
  //
  //   width   shape neutrality   types-corr    suite failures
  //   ──────────────────────────────────────────────────────────
  //   off      25.0-27.6%        0.462-0.486    0   (5-run noise band)
  //    12         26.4%             0.470       0
  //    10         27.5%             0.448       0
  //     8         35.1%             0.457       2
  //     6         34.6%             0.331       7
  //     4         26.6%            -0.008      14
  //
  // At width 4 the variety advantage is DEAD — composition stops caring how
  // many piles you split into, which is exactly the goal. The cost is that the
  // race bands, tuned for an uncapped line, come apart: fourteen checks fail
  // and dark_elf/balanced tops the table at 81.7%. Width 8 buys a real shape
  // improvement for two failures without moving the correlation at all.
  //
  // So the open question is not whether the mechanic works, but whether a full
  // race retune is worth buying with it. Left at 0 — the verified-green state —
  // until that call is made. The _runAttacks refactor it required stays either
  // way: it replaced six near-identical copies of the phase loop with one.
  const FRONTAGE = 0;

  // Runs one phase for one side, respecting the frontage budget.
  // Returns { modelsKilled, chargeHit }.
  function _runAttacks(units, enemySide, phase, terrainMods, round, events, actorSide) {
    let budget       = FRONTAGE > 0 ? FRONTAGE : Infinity;
    let modelsKilled = 0;
    let chargeHit    = false;

    for (const unit of units) {
      if (budget <= 0) break;
      if (!_sideAlive(enemySide)) break;

      const engaged = Math.min(unit.count, budget);
      budget -= engaged;

      const r = _executeAttack(unit, enemySide, phase, terrainMods, round, events, actorSide, engaged);
      modelsKilled += r.modelsKilled;
      if (r.chargeHit) chargeHit = true;

      // double_strike: 30% chance to attack a second time in melee. The second
      // swing is the same models going again, so it does NOT spend more of the
      // frontage — the unit is already in the line.
      if (phase === 'melee' && unit.traits.includes('double_strike')
          && Math.random() < 0.30 && _sideAlive(enemySide)) {
        const r2 = _executeAttack(unit, enemySide, phase, terrainMods, round, events, actorSide, engaged);
        modelsKilled += r2.modelsKilled;
      }
    }
    return { modelsKilled, chargeHit };
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

    // 15 rounds (was 10, raised 2026-07-27): early-game armies are low
    // damage vs deep HP pools, so most starter fights never finished and
    // fell to the max-rounds tiebreak — which is deterministic for a
    // given pair of armies, so grindy matchups resolved 100/0 on a
    // static stat comparison instead of actual fighting.
    for (let round = 1; round <= 15; round++) {
      rounds = round;

      let atkLosses      = 0;
      let defLosses      = 0;
      let chargeHitAtk   = false;
      let chargeHitDef   = false;

      // Morale measures the fraction of combat POWER lost this round, not
      // the fraction of heads (2026-07-27). Head-counting made every big
      // single-model unit a morale liability — a 2-dragon army lost 11%
      // morale per chaff death and crumbled, while cheap-swarm armies were
      // morale-tanks for free. Power lost is what the army actually FELT.
      const atkPowerStart = _sidePower(ctx.attacker.units);
      const defPowerStart = _sidePower(ctx.defender.units);

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

      defLosses += _runAttacks(atkRanged, ctx.defender, 'ranged', terrainMods, round, events, 'attacker').modelsKilled;
      atkLosses += _runAttacks(defRanged, ctx.attacker, 'ranged', terrainMods, round, events, 'defender').modelsKilled;

      if (!_sideAlive(ctx.defender)) { winner = 'attacker'; reason = 'eliminated'; break; }
      if (!_sideAlive(ctx.attacker)) { winner = 'defender'; reason = 'eliminated'; break; }

      // 3. Charge Phase (round 1 only — cavalry with 'charge' trait)
      if (round === 1) {
        const atkCharge = _bySpeed(ctx.attacker.units.filter(u => _alive(u) && u.traits.includes('charge') && u.role === 'cavalry'));
        const defCharge = _bySpeed(ctx.defender.units.filter(u => _alive(u) && u.traits.includes('charge') && u.role === 'cavalry'));

        const atkChargeRes = _runAttacks(atkCharge, ctx.defender, 'charge', terrainMods, round, events, 'attacker');
        defLosses += atkChargeRes.modelsKilled;
        if (atkChargeRes.chargeHit) chargeHitDef = true;

        const defChargeRes = _runAttacks(defCharge, ctx.attacker, 'charge', terrainMods, round, events, 'defender');
        atkLosses += defChargeRes.modelsKilled;
        if (defChargeRes.chargeHit) chargeHitAtk = true;

        if (!_sideAlive(ctx.defender)) { winner = 'attacker'; reason = 'eliminated'; break; }
        if (!_sideAlive(ctx.attacker)) { winner = 'defender'; reason = 'eliminated'; break; }
      }

      // 4. Melee Phase (all non-routed, non-ranged units — ranged units already
      // acted this round in the Ranged phase; without this exclusion they'd
      // get two attacks per round while melee-only units only get one)
      const atkMelee = _bySpeed(ctx.attacker.units.filter(u => _alive(u) && !u.traits.includes('ranged')));
      const defMelee = _bySpeed(ctx.defender.units.filter(u => _alive(u) && !u.traits.includes('ranged')));

      defLosses += _runAttacks(atkMelee, ctx.defender, 'melee', terrainMods, round, events, 'attacker').modelsKilled;
      atkLosses += _runAttacks(defMelee, ctx.attacker, 'melee', terrainMods, round, events, 'defender').modelsKilled;

      if (!_sideAlive(ctx.defender)) { winner = 'attacker'; reason = 'eliminated'; break; }
      if (!_sideAlive(ctx.attacker)) { winner = 'defender'; reason = 'eliminated'; break; }

      // 5. Morale Phase — driven by the share of combat power each side
      // lost this round (see atkPowerStart above).
      const atkLossFrac = atkPowerStart > 0 ? Math.max(0, (atkPowerStart - _sidePower(ctx.attacker.units)) / atkPowerStart) : 0;
      const defLossFrac = defPowerStart > 0 ? Math.max(0, (defPowerStart - _sidePower(ctx.defender.units)) / defPowerStart) : 0;
      const atkRouted = MoraleService.update(ctx.attacker, atkLossFrac, chargeHitAtk, ctx.terrain);
      const defRouted = MoraleService.update(ctx.defender, defLossFrac, chargeHitDef, ctx.terrain);

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
      // Within 10% of each other = an honest stalemate, not a win. The
      // exact-equality check almost never fired, so any grind that hit
      // max rounds went 100% to whichever army had the marginally higher
      // static power — same two armies, same "winner", every time.
      const margin = Math.max(atkPower, defPower) * 0.10;
      if (atkPower > defPower + margin)      { winner = 'attacker'; }
      else if (defPower > atkPower + margin) { winner = 'defender'; }
      else                                   { winner = 'draw'; }
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

  // Camp loot pays ONE random resource, and which one follows the same
  // 3 : 2 : 1 wood/stone/food ratio the expedition find table uses — see
  // DiscoveryRoll.RES_RATIO, which is loaded before this file in both the
  // browser (index.html) and server/engine-loader.js. Ambush spoils ARE
  // expedition income, so an even three-way split here would have quietly
  // dragged the game's overall resource mix back toward flat on the ~13% of
  // expeditions that end in a fight.
  //
  // Weighted by TYPE rather than by amount, unlike rollRewards: the loot band
  // (CAMP_LEVEL_LOOT resMin/resMax) is the same whichever resource is drawn,
  // so the two formulations are equivalent and this way needs no second
  // multiplier to keep in sync. The literal is a fallback for the standalone
  // battle simulator, which loads the engine without the quest data.
  const _LOOT_RES_RATIO = { wood: 3, stone: 2, food: 1 };

  function _pickLootRes() {
    const ratio = (typeof DiscoveryRoll !== 'undefined' && DiscoveryRoll.RES_RATIO) || _LOOT_RES_RATIO;
    const types = Object.keys(ratio);
    let total = 0;
    types.forEach(t => total += ratio[t]);
    let rand = Math.random() * total;
    for (const t of types) {
      rand -= ratio[t];
      if (rand <= 0) return t;
    }
    return types[types.length - 1];
  }

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
          if (amount > 0) lootResource = { [_pickLootRes()]: amount };
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
