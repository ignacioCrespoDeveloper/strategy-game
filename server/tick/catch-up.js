// =============================================
//  catch-up.js — Offline progression engine
//
//  Pure ES module. Zero imports. All game data and economy
//  math arrive via the `engine` parameter (built from
//  engine-loader.js by every caller) — the economy formulas
//  themselves live in js/domain/economy-core.js and are
//  NEVER duplicated here.
//
//  Takes a player's state snapshot + current timestamp,
//  returns the updated state with all time-based
//  progressions applied as if the player had been
//  online the whole time.
//
//  Covered systems:
//    ✓ Lord downtime expiry (post-battle recovery)
//    ✓ Lord HP regeneration (2%/min up to maxHp)
//    ✓ Lord action queue completions (move + search)
//    ✓ Building construction completions
//    ✓ Unit recruitment completions (adds to army)
//    ✓ Resource production (food/wood/stone × race × terrain)
//    ✓ Population growth
//    ✓ Gold income + upkeep deduction
// =============================================

// ── Lord constants ────────────────────────────────────────────

const _LORD_BASE_HP = 100;

const _LORD_CLASS_HP_MOD = {
  warrior: 0, rogue: 0, priest: 0, mage: 0, dark_lord: 0,
};

// ── Lord helper ───────────────────────────────────────────────

function _maxHp(lord) {
  const baseHp   = (lord.baseStats?.health) ?? _LORD_BASE_HP;
  const classMod = _LORD_CLASS_HP_MOD[lord.classId] ?? 0;
  return baseHp + classMod;
}

// Garrison regen: fraction of a unit's max HP recovered per minute while its
// lord rests idle on one of the player's own city tiles. Tunable.
const _GARRISON_REGEN_PER_MIN = 0.01;

// The raiding stance's hourly rate lives in EconomyCore.getRaidHourlyRewards
// — the same function the in-game preview and the published raid guide call,
// so all three can never drift apart again. It used to be a private copy here.

// ── Server-side quest resolution helpers ──────────────────────
// Used when engine data is passed into catchUp().
// Mirrors client-side logic in discovery.js / lord.js — kept here
// so search_area rewards are applied even when the browser is closed.

// Deterministic terrain — mirrors WorldService.getTerrain(). No storage needed.
function _getTerrain(x, y) {
  const h = (((x * 1664525 + 1013904223) ^ (y * 214013 + 2531011)) >>> 0);
  const keys = ['forest','forest','plains','plains','plains','mountain','mountain','marsh','mountain','desert'];
  return keys[h % keys.length];
}

// XP threshold for the next level. Mirrors lord.js xpToNext formula.
function _xpToNextLevel(level) { return 50 * (2 * level + 1); }

// Hard level cap — local copy of LORD_MAX_LEVEL from js/data/lord-classes.js.
// This module is deliberately dependency-free (same reason _xpToNextLevel is
// duplicated above rather than imported), so the constant is inlined. If the
// canonical value changes, change it here too.
const _LORD_MAX_LEVEL = 10;

// Apply pending level-ups after an XP gain. Mirrors lord.js checkLevelUp().
function _checkLevelUp(lord, engine) {
  const cls     = engine?.LORD_CLASSES?.[lord.classId];
  const clsKeys = new Set(Object.keys(cls?.modifiers || {}));
  while ((lord.level || 1) < _LORD_MAX_LEVEL &&
         (lord.xp || 0) >= (lord.xpToNext || _xpToNextLevel(lord.level || 1))) {
    lord.xp           = Math.max(0, (lord.xp || 0) - (lord.xpToNext || _xpToNextLevel(lord.level || 1)));
    lord.level        = (lord.level || 1) + 1;
    lord.xpToNext     = _xpToNextLevel(lord.level);
    lord.talentPoints = (lord.talentPoints || 0) + 1;
    const baseStats   = engine?.LORD_BASE_STATS;
    if (baseStats && lord.baseStats) {
      for (const key of Object.keys(baseStats)) {
        lord.baseStats[key] = (lord.baseStats[key] ?? baseStats[key]) + (clsKeys.has(key) ? 2 : 1);
      }
    }
  }
  // Clamp banked XP at the cap so the bar reads full, not overflowing.
  if ((lord.level || 1) >= _LORD_MAX_LEVEL) {
    lord.xp = Math.min(lord.xp || 0, lord.xpToNext || 0);
  }
}

// Army combat power from the armies map — same PWR the recruit cap uses
// (EconomyCore.getArmyPower: linear per-model cost + combat-trait tax), so
// camp difficulty scales with the number the player actually sees.
function _armyPower(armies, lordId, engine) {
  const army = armies?.[lordId];
  if (!army?.units || !engine?.EconomyCore) return 0;
  return engine.EconomyCore.getArmyPower(army.units, engine.UNIT_DEFS);
}

// The discovery roll, camp-difficulty roll and loot tables used to be
// hand-mirrored here from js/domain/discovery.js. They now live in ONE place —
// js/domain/discovery-roll.js (DiscoveryRoll) — and arrive via `engine`, the
// same way every other piece of game data and math reaches this module.
//
// The two old copies had already drifted: this one scaled the UNFLOORED random
// roll while the client floored it first, so the same discovery paid different
// loot depending on which side computed it. DiscoveryRoll settles that on the
// floor-then-scale form. Do not re-inline any of it here.

// Full search_area resolution. Returns a pending discovery object to be stored on the lord
// and drained by the client (online) or the sync endpoint (offline).
const _SEARCH_AREA_XP = 8; // mirrors LORD_ACTIONS.search_area.xpReward in lord.js

// Folds the flat expedition XP into a rewards array as a SINGLE xp entry.
// Two separate xp entries would render as two chips on the same card, which
// reads like a bug; the player only cares about the total.
function _mergeXpReward(rewards, extraXp) {
  const out = (rewards || []).map(r => ({ ...r }));
  if (!(extraXp > 0)) return out;
  const existing = out.find(r => r.type === 'xp');
  if (existing) existing.amount += extraXp;
  else out.push({ type: 'xp', amount: extraXp });
  return out;
}
// ── Ambush ────────────────────────────────────────────────────
// A combat find is resolved AS A BATTLE, right now, instead of being parked
// on the map as a camp to attack later. Same encounter data (CAMP_DEFS +
// CAMP_LEVEL_LOOT) and the same BattleEngine the old bandit-camp attack used
// — see the retired flow in server/actions/pve-attack.js — just fired at
// quest resolution.
//
// Win  → camp loot + XP, and the survivors get the standard victory patch-up.
// Lose → real casualties; if the lord itself falls it takes the normal
//        'defeated' hour of downtime. PvE can never CAPTURE a lord; capture
//        only exists in the PvP path (combat-resolver.js).
//
// Deliberately awards NO honor. Honor is a purely PvP metric now, which is
// what ranking-updater.js and ranking-screen.js already claimed it was.
function _resolveAmbush(lord, armies, cities, def, terrainId, nowMs, engine) {
  const { CAMP_DEFS, CAMP_LEVEL_LOOT, UNIT_DEFS, EconomyCore, BattleEngine, DiscoveryRoll, BATTLE_WIN_HEAL_PCT } = engine;
  if (!BattleEngine || !CAMP_LEVEL_LOOT) return null;

  const ap      = _armyPower(armies, lord.id, engine);
  // Ambush force scales to the army it jumped — see rollAmbushDetails. A
  // fixed camp ladder made ambushes trivial (and pure profit) for big armies.
  const details = DiscoveryRoll.rollAmbushDetails(CAMP_DEFS, UNIT_DEFS, def.id, ap);
  if (!details) return null;

  const campDef  = CAMP_DEFS[def.id] || {};
  const baseLoot = CAMP_LEVEL_LOOT[details.level] || CAMP_LEVEL_LOOT[1];
  // Loot rises with the same multiplier the roster did: a bigger fight is
  // worth more, but it now costs blood in proportion rather than being free.
  const mult     = (campDef.rewardMultiplier || 1.0) * (details.powerMult || 1);
  // Ambush loot answers to the SAME quest dials as expedition finds
  // (js/data/tuning.js) — an ambush is a payout of the expedition that walked
  // into it, so tuning "questing" down must not leave this channel untouched.
  const qGold = (typeof engine?.tune === 'function') ? engine.tune('questGold')      : 1.0;
  const qRes  = (typeof engine?.tune === 'function') ? engine.tune('questResources') : 1.0;
  const encounter = {
    name:           `${campDef.displayName || def.name}${details ? ` (Level ${details.level})` : ''}`,
    startingMorale: campDef.morale || 55,
    loot: {
      goldMin: Math.round(baseLoot.goldMin * mult * qGold), goldMax: Math.round(baseLoot.goldMax * mult * qGold),
      resMin:  Math.round((baseLoot.resMin || 0) * mult * qRes), resMax: Math.round((baseLoot.resMax || 0) * mult * qRes),
    },
    xpReward:  { win: Math.round(baseLoot.xpWin * mult), loss: Math.round(baseLoot.xpLoss * mult) },
    defenders: details.defenders,
  };

  const army = armies[lord.id] || { lordId: lord.id, units: [] };
  // Veterancy from the player's training buildings, exactly as the old
  // camp attack applied it. Camp defenders have no buildings.
  const cityBuildings = Object.values(cities || {})
    .filter(c => c?.playerId === lord.playerId)
    .map(c => c.buildings)
    .filter(Boolean);

  const report = BattleEngine.resolve(BattleEngine.buildContext({
    lord, army, encounter, terrain: terrainId,
    veterancy: unitId => EconomyCore.getVeterancyPct(lord.race, unitId, cityBuildings),
  }));
  report._meta = {
    campName:  encounter.name,
    campIcon:  campDef.icon || '',
    campLevel: details.level,
    terrain:   terrainId,
    ambush:    true,
  };

  const won = report.winner === 'attacker';

  // Army casualties (lord's own stack is handled separately below).
  const updated = { lordId: lord.id, units: (army.units || []).map(u => ({ ...u })) };
  report.attacker.unitsStart.filter(s => s.sourceId !== lord.id).forEach(s => {
    const surv  = report.attacker.unitsSurviving.find(u => u.sourceId === s.sourceId);
    const stack = updated.units.find(u => u.unitId === s.sourceId);
    if (!stack) return;
    stack.count = surv?.count ?? 0;
    if (surv && stack.count > 0) stack.currentHp = Math.round(surv.avgHp);
  });
  updated.units = updated.units.filter(u => u.count > 0);

  if (won) {
    updated.units.forEach(stack => {
      const uMax = UNIT_DEFS?.[stack.unitId]?.combatStats?.hp;
      if (!uMax) return;
      const cur = stack.currentHp ?? uMax;
      if (cur < uMax) stack.currentHp = Math.min(uMax, Math.round(cur + uMax * (BATTLE_WIN_HEAL_PCT || 0)));
    });
  }
  updated.regenAt  = nowMs;
  armies[lord.id]  = updated;

  // Lord HP / downtime straight from the battle outcome.
  const lordSurv = report.attacker.unitsSurviving.find(u => u.sourceId === lord.id);
  if (lordSurv) {
    lord.currentHp      = Math.max(1, Math.round(lordSurv.avgHp));
    lord.downtimeUntil  = null;
    lord.downtimeReason = null;
    if (won) {
      const lMax = _maxHp(lord);
      if (lord.currentHp < lMax) lord.currentHp = Math.min(lMax, Math.round(lord.currentHp + lMax * (BATTLE_WIN_HEAL_PCT || 0)));
    }
  } else {
    lord.currentHp      = 0;
    lord.downtimeUntil  = nowMs + 60 * 60 * 1000;
    lord.downtimeReason = 'defeated';
    // No need to clear actionQueue: the caller already shifted this item off,
    // and it reassigns lord.actionQueue from its own local `queue` after the
    // loop — anything set here would just be overwritten.
  }

  // Rewards are RETURNED, never applied here — the search_area caller applies
  // every pending.rewards entry to player/lord itself, exactly as it does for
  // non-combat finds. Crediting gold here as well would pay the loot twice.
  const rewards = [];
  if (report.xpEarned > 0) rewards.push({ type: 'xp', amount: report.xpEarned });
  if (won) {
    const gold = report.loot?.gold || 0;
    if (gold > 0) rewards.push({ type: 'gold', amount: gold });
    Object.entries(report.loot?.resource || {}).forEach(([t, amt]) => {
      if (amt > 0) rewards.push({ type: t, amount: amt });
    });
  }

  return {
    defId:    def.id,
    category: 'combat',
    record:   null,          // no map camp any more — the fight already happened
    rewards,
    // `at` is the moment the fight actually happened, NOT when the client
    // finds out. An expedition that resolved three hours ago while the browser
    // was closed must file in the Battles tab under its real time, and it
    // doubles as the de-dupe key for BattleHistoryService.saveAmbush.
    ambush:   { won, report, campLevel: details.level, campName: encounter.name, lordFell: !lordSurv, at: nowMs },
  };
}

// ── Recruits ──────────────────────────────────────────────────
// Fighters who join the army outright. Which tier turns up is gated by the
// expedition's Expedition Rating, so a scout-heavy column attracts far better
// company than a big dumb one — see DiscoveryRoll.rollRecruits.
//
// OVER-CAP RECRUITS ARE LOST, deliberately. If the army has no PWR headroom
// the newcomers walk away, and the report says so with the exact numbers. That
// is the whole reason to leave room before questing, and it also stops
// expeditions being a way around the army cap. Mirrors the recruit gate in
// server/actions/recruit.js — the cap is 200 + level×80 (+ talent bonus).
function _armyPowerCap(lord, engine) {
  const bonus = engine?.TALENT_POOL?.[lord.talentId]?.effects?.armyPowerCapBonus || 0;
  return 200 + (lord.level || 1) * 80 + bonus;
}

function _resolveRecruits(lord, armies, engine) {
  const { UNIT_DEFS, EconomyCore, DiscoveryRoll } = engine;
  if (!UNIT_DEFS || !EconomyCore || !DiscoveryRoll) return null;

  const army  = armies[lord.id] || { lordId: lord.id, units: [] };
  const offer = DiscoveryRoll.rollRecruits(army.units, UNIT_DEFS);
  if (!offer) return null;

  const def = UNIT_DEFS[offer.unitId];
  if (!def) return null;

  const cap      = _armyPowerCap(lord, engine);
  const current  = EconomyCore.getArmyPower(army.units, UNIT_DEFS);
  const unitPwr  = EconomyCore.getUnitPower(def);
  const headroom = cap - current;

  // Take as many as fit; the rest are turned away.
  const fit = Math.max(0, Math.min(offer.count, Math.floor(headroom / unitPwr)));

  if (fit > 0) {
    const units = (army.units || []).map(u => ({ ...u }));
    const stack = units.find(u => u.unitId === offer.unitId);
    if (stack) stack.count += fit;
    else units.push({ unitId: offer.unitId, count: fit });
    armies[lord.id] = { ...army, lordId: lord.id, units };
  }

  return {
    ...offer,
    joined:   fit,
    lost:     offer.count - fit,
    unitName: def.name,
    unitPwr:  Math.round(unitPwr),
    armyPwr:  Math.round(current),
    cap,
    headroom: Math.round(headroom),
    goldValue: (def.goldCost || 0) * fit,
  };
}

// `action` is the completed queue item — lord-action.js stamps the chosen
// expedition length and the tile's depletion multiplier onto it at enqueue
// time, so resolution needs no access to the search_fatigue storage key.
// Absent on items queued before expedition lengths existed → Standard, 1.0.
function _resolveSearchArea(lord, armies, cities, nowMs, engine, action) {
  if (lord.x == null || lord.y == null) return null;
  const { DISCOVERY_DEFS, CAMP_DEFS, TALENT_POOL, UNIT_DEFS, DiscoveryRoll } = engine;
  if (!DiscoveryRoll) return null; // engine built without the roll module — nothing to resolve

  const lengthId  = action?.length;
  const depletion = action?.depletion;

  const terrainId     = _getTerrain(lord.x, lord.y);
  const talentEffects = (TALENT_POOL && lord.talentId) ? (TALENT_POOL[lord.talentId]?.effects || {}) : {};

  // Footprint: how loud this expedition is. A big army gets jumped more, comes
  // back empty more, and is shown less — see DiscoveryRoll's FOOTPRINT block.
  const armyPower = _armyPower(armies, lord.id, engine);
  const loudness  = DiscoveryRoll.loudnessOf(armyPower);

  // Expedition Rating: the SAME rating that gates which recruits will join now
  // also decides the quality of what gets found — see RECRUIT_TIERS.find. A
  // scout-heavy column is shown the good ground; a rabble is shown a ditch.
  const er = DiscoveryRoll.expeditionRating((armies[lord.id] || {}).units, UNIT_DEFS);

  const def = DiscoveryRoll.rollDef(DISCOVERY_DEFS, terrainId, talentEffects.goldDiscoveryBonus || 0, lengthId, loudness, er);
  if (!def) return null;

  if (def.category === 'nothing') {
    return { defId: def.id, category: 'nothing', record: null, rewards: [], lengthId, depletion, loudness };
  }

  const record = {
    id:           'disc_' + nowMs + '_' + Math.floor(Math.random() * 100000),
    definitionId: def.id,
    tileX:        lord.x,
    tileY:        lord.y,
    terrain:      terrainId,
    lordId:       lord.id,
    discoveredAt: nowMs,
    expiresAt:    def.baseDuration > 0 ? nowMs + def.baseDuration * 1000 : null,
  };

  // Recruits: the units ARE the reward, so no loot roll — rollRewards has no
  // BASE_REWARDS entry for these defs and would return nothing anyway.
  if (def.category === 'recruits') {
    const recruits = _resolveRecruits(lord, armies, engine);
    if (recruits) {
      return { defId: def.id, category: 'recruits', record: null, rewards: [], recruits, lengthId, depletion, loudness };
    }
    return { defId: def.id, category: 'nothing', record: null, rewards: [], lengthId, depletion, loudness };
  }

  // Combat = ambush, fought immediately. If the engine was built without a
  // BattleEngine (never in production, but catchUp is called with partial
  // engines in tests) the fight can't be resolved — report an empty expedition
  // rather than writing a camp record. Camps are retired and nothing in the
  // game can act on one, so leaving an orphan behind would be worse than a
  // quiet miss.
  if (def.category === 'combat') {
    const ambush = _resolveAmbush(lord, armies, cities, def, terrainId, nowMs, engine);
    if (ambush) return { ...ambush, lengthId, depletion, loudness };
    return { defId: 'nothing_found', category: 'nothing', record: null, rewards: [], lengthId, depletion, loudness };
  }

  const rewards = DiscoveryRoll.rollRewards(def, lord.level, { lengthId, depletion, loudness });
  return { defId: def.id, category: def.category, record, rewards, lengthId, depletion, loudness };
}

// ── Main entry point ──────────────────────────────────────────

/**
 * Apply all time-based game progressions accumulated
 * since each entity's last-updated timestamp.
 *
 * @param {{ lords, cities, armies, player }} state
 * @param {number} nowMs    Server timestamp in milliseconds
 * @param {object} [engine] Optional engine data for server-side quest resolution.
 *   When provided, completed search_area actions apply XP + roll a discovery and
 *   store the result in lord.pendingDiscoveries[] for the client to drain.
 *   Shape: { DISCOVERY_DEFS, CAMP_DEFS, TALENT_POOL, LORD_BASE_STATS, LORD_CLASSES, UNIT_DEFS }
 * @returns {{ lords, cities, armies, player, events, changed }}
 */
export function catchUp(state, nowMs, engine = null) {
  // Deep-copy — never mutate the caller's objects
  const lords  = JSON.parse(JSON.stringify(state.lords  || {}));
  const cities = JSON.parse(JSON.stringify(state.cities || {}));
  const armies = JSON.parse(JSON.stringify(state.armies || {}));
  const player = JSON.parse(JSON.stringify(state.player || {}));
  const events = [];
  let   changed = false;

  // Active Temple blessing effects (empire-wide, single slot). Resolved once
  // and reused by the raid, gold, production and population sections below.
  // getBlessingEffects respects finishAt with nowMs, so an expired blessing
  // yields {} even before the tidy-up clear in the economy section. The
  // engine-less combat-resolver path (no EconomyCore) simply gets no buff.
  const blessingFx = engine?.EconomyCore
    ? engine.EconomyCore.getBlessingEffects(player.activeBlessing, nowMs)
    : {};

  // ── 1. Lord ticks ───────────────────────────────────────────

  for (const lord of Object.values(lords)) {
    if (!lord?.id) continue;

    // 1a. Portrait backfill — lords created before the portrait roll was
    // persisted have none, and every view falls back to the deterministic
    // id hash for them. Freeze that exact face onto the lord so it stops
    // depending on the art pools, whose lengths shift as images are added.
    if (!lord.portrait && engine?.pickLordPortrait) {
      const backfilled = engine.pickLordPortrait(lord.race, lord.classId, lord.id);
      if (backfilled) { lord.portrait = backfilled; changed = true; }
    }

    // 1b. Clear expired downtime
    if (lord.downtimeUntil && nowMs >= lord.downtimeUntil) {
      lord.downtimeUntil  = null;
      lord.downtimeReason = null;
      lord.currentHp      = 1;
      lord.hpRegenAt      = nowMs;
      events.push({ type: 'lord_recovered', lordId: lord.id, lordName: lord.name || '' });
      changed = true;
    }

    if (lord.downtimeUntil && nowMs < lord.downtimeUntil) continue;

    // 1c. HP regeneration — 2% of maxHp per minute
    const maxHp = _maxHp(lord);
    const curHp = lord.currentHp ?? maxHp;
    if (curHp < maxHp) {
      const from        = lord.hpRegenAt || nowMs;
      const elapsedMins = (nowMs - from) / 60_000;
      if (elapsedMins > 0) {
        lord.currentHp = Math.min(maxHp, Math.round(curHp + maxHp * 0.02 * elapsedMins));
        lord.hpRegenAt = nowMs;
        changed = true;
      }
    }

    // 1d. Action queue
    const queue = lord.actionQueue || [];
    let queueChanged = false;
    while (queue.length > 0 && nowMs >= queue[0].finishAt) {
      const done = queue.shift();
      queueChanged = changed = true;
      if (done.destX != null) { lord.x = done.destX; lord.y = done.destY; }

      // Reset the garrison-regen clock to this action's completion time — rest
      // only starts counting once the lord finishes what it was doing (a march,
      // search or scout). See the garrison-regen block below (1e).
      if (armies[lord.id]) armies[lord.id].regenAt = done.finishAt;

      // search_area: resolve XP + discovery server-side when engine data is available.
      // This ensures rewards are applied even when the browser was closed during the quest.
      if (done.actionId === 'search_area' && engine) {
        const talentEffects = (engine.TALENT_POOL && lord.talentId)
          ? (engine.TALENT_POOL[lord.talentId]?.effects || {}) : {};
        const xpMult = talentEffects.xpMultiplier || 1;
        // The flat "you ran an expedition" XP scales with how long it ran, so a
        // Long push is worth its 30 minutes even when it finds nothing.
        const lenMul = engine.DiscoveryRoll ? engine.DiscoveryRoll.lengthOf(done.length).reward : 1;
        const baseXp = Math.round(_SEARCH_AREA_XP * xpMult * lenMul);

        const pending = _resolveSearchArea(lord, armies, cities, nowMs, engine, done);
        if (pending) {
          // Fold the flat expedition XP INTO the reported rewards instead of
          // crediting it off to the side. It used to be applied straight to
          // lord.xp above, so an expedition that found nothing reported an
          // empty rewards array and the player was never told they had earned
          // anything at all — the commonest outcome in the game looked like a
          // total waste of the lord's time. Merged into the existing xp entry
          // rather than pushed as a second one, so the card shows ONE xp chip.
          // Note this is now the ONLY place the base XP is credited: it lands
          // via the apply loop below, so it must not also be added directly.
          pending.rewards = _mergeXpReward(pending.rewards, baseXp);

          // Apply gold / resource rewards to player immediately.
          // God of Destruction blessing: a heavier haul from every expedition.
          // Applied to material loot only — XP is the lord's own effort and is
          // deliberately left alone, same as the raid path leaves XP untouched.
          const questMult = 1 + (blessingFx.quest_bonus || 0);
          for (const r of (pending.rewards || [])) {
            if      (r.type === 'gold') player.coins = Math.floor((player.coins || 0) + r.amount * questMult);
            else if (r.type === 'xp')  lord.xp = (lord.xp || 0) + r.amount;
            else if (['food','wood','stone'].includes(r.type)) {
              player.resources = player.resources || {};
              player.resources[r.type] = Math.floor((player.resources[r.type] || 0) + r.amount * questMult);
            }
          }
          _checkLevelUp(lord, engine);
          lord.pendingDiscoveries = lord.pendingDiscoveries || [];
          lord.pendingDiscoveries.push(pending);
        } else {
          // No discovery to report (lord off-map, or an engine built without
          // DiscoveryRoll). The lord still spent the time, so it still earns
          // the base XP — there is just nothing to show it on.
          lord.xp = (lord.xp || 0) + baseXp;
          _checkLevelUp(lord, engine);
        }
      }

      // attack-intent move: flag for deferred PvP resolution.
      // The battle fires once the updated position is saved to Supabase (sync or check-incoming).
      if (done.intent === 'attack' && done.destX != null) {
        lord.pendingPvpAttack = { tileX: done.destX, tileY: done.destY };
      }

      // scout: flag for deferred resolution. This module has zero imports and
      // only ever sees this one player's own state slice, so it can't check
      // other players' lords/stances or gather cross-player intel itself —
      // same reason attack-intent moves above only set a flag instead of
      // resolving inline. server/combat-resolver.js's resolveScout() does the
      // actual ambush-check + intel-gathering once drained (by the dispatcher
      // for offline players, or POST /api/lord/scout-resolve for online ones).
      if (done.actionId === 'scout') {
        lord.pendingScoutResolve = { tileX: lord.x, tileY: lord.y };
      }

      // Plain (non-attack) arrival: flag for a deferred "is a raiding lord
      // sitting here" check — same zero-cross-player-visibility reason as
      // above. Skipped for attack-intent moves, which already resolve via
      // pendingPvpAttack; setting both would resolve the same arrival twice.
      // server/combat-resolver.js's resolveArrivalCheck() does the actual
      // cross-player scan once drained (event-dispatcher for offline movers,
      // sync.js for online ones).
      if (done.actionId === 'move_lord' && done.destX != null && done.intent !== 'attack') {
        lord.pendingArrivalCheck = { tileX: done.destX, tileY: done.destY };
      }

      events.push({
        type: 'lord_action_done', lordId: lord.id, lordName: lord.name || '',
        actionId: done.actionId || 'move_lord',
        destX: done.destX ?? null, destY: done.destY ?? null, intent: done.intent ?? null,
      });
    }
    if (queueChanged) lord.actionQueue = queue;

    // 1e. Raiding stance — passive heal while active, full payout + heal on
    // natural completion (reaching finishAt without ever losing a fight).
    // Forfeiture on loss is handled entirely in combat-resolver.js's
    // _resolveCore (clears lord.stance the moment the raider loses) — by the
    // time control ever reaches here for a given tick, either the stance is
    // still legitimately active or it's already been cleared, so there's
    // nothing extra to reconcile on the loss path.
    if (lord.stance?.id === 'raiding') {
      const maxHp = _maxHp(lord);
      const army  = armies[lord.id];
      const healUnits = () => {
        if (!army || !engine?.UNIT_DEFS) return;
        army.units.forEach(u => {
          const unitMaxHp = engine.UNIT_DEFS[u.unitId]?.combatStats?.hp;
          if (unitMaxHp && u.currentHp !== unitMaxHp) { u.currentHp = unitMaxHp; changed = true; }
        });
      };

      if (nowMs >= lord.stance.finishAt) {
        const hours = Math.max(0, (lord.stance.finishAt - lord.stance.startedAt) / 3_600_000);
        const rates = engine.EconomyCore.getRaidHourlyRewards(lord.level);
        // God of Destruction blessing: heavier plunder from every raid.
        const raidMult   = 1 + (blessingFx.raid_bonus || 0);
        const goldEarned = Math.floor(rates.gold * hours * raidMult);
        player.coins      = Math.floor((player.coins || 0) + goldEarned);
        player.resources  = player.resources || { food: 0, wood: 0, stone: 0 };
        const resEarned = {};
        ['food', 'wood', 'stone'].forEach(r => {
          // Floor the GAIN (not the sum) so the number reported to the player
          // is exactly the number that was added — stored resources are always
          // integers, so this is arithmetically identical to the old form.
          resEarned[r] = Math.floor(rates[r] * hours * raidMult);
          player.resources[r] = (player.resources[r] || 0) + resEarned[r];
        });

        // Raid payout report — built BEFORE the stance is reset, since it
        // reads startedAt/finishAt.
        //
        // Stashed on the lord (not just pushed onto `events`) because catchUp
        // runs from four places — sync.js, the dispatcher, action-base's
        // loadAndCatchUp, and raid-instant.js — and only sync.js ever forwards
        // its events array to the client. Every other caller still SAVES the
        // completed state, so a raid that finished while the browser was
        // closed would pay out silently and the notification would be lost.
        // Persisting it here mirrors how pendingDiscoveries carries offline
        // quest results; sync.js drains it into a raid_complete event exactly
        // once (deduped by id against the inline event below).
        const raidReport = {
          id:           `raid_${lord.id}_${lord.stance.finishAt}`,
          lordId:       lord.id,
          lordName:     lord.name || '',
          goldEarned,
          resources:    resEarned,
          durationSecs: Math.round((lord.stance.finishAt - lord.stance.startedAt) / 1000),
          at:           lord.stance.finishAt,
        };
        lord.pendingRaidReports = [...(lord.pendingRaidReports || []), raidReport];

        lord.currentHp = maxHp;
        lord.hpRegenAt = nowMs;
        healUnits();
        lord.stance = { id: 'idle', startedAt: null, finishAt: null };
        events.push({ type: 'raid_complete', ...raidReport });
        changed = true;
      } else {
        if (lord.currentHp !== maxHp) { lord.currentHp = maxHp; lord.hpRegenAt = nowMs; changed = true; }
        healUnits();
      }
    }

    // 1f. Garrison unit regen — while the lord is idle (no queued action, not
    // in a stance) and standing on one of THIS player's own city tiles, its
    // army's units recover HP over time. Positioning matters: bring a bloodied
    // army home to heal. The rest clock (army.regenAt) is reset on arrival
    // (action completion above) and on battle damage (combat-resolver.js /
    // pve-attack.js), so this only ever counts genuine rest-in-city time.
    const gArmy  = armies[lord.id];
    const isIdle = (lord.actionQueue || []).length === 0
      && (!lord.stance || lord.stance.id === 'idle' || !lord.stance.finishAt || nowMs >= lord.stance.finishAt);
    const onOwnCity = lord.x != null && lord.y != null
      && Object.values(cities).some(c => c?.playerId === player.id && c.x === lord.x && c.y === lord.y);
    if (isIdle && onOwnCity && gArmy?.units?.length && engine?.UNIT_DEFS) {
      const damaged = gArmy.units.some(u => {
        const m = engine.UNIT_DEFS[u.unitId]?.combatStats?.hp;
        return m && (u.currentHp ?? m) < m;
      });
      if (damaged) {
        if (gArmy.regenAt == null) {
          // First eligible tick with damage (armies that predate this feature,
          // or were just damaged) have no rest clock yet — start it now so the
          // next tick can accrue heal. Can't retro-heal without a baseline.
          gArmy.regenAt = nowMs;
          changed = true;
        } else {
          const mins = (nowMs - gArmy.regenAt) / 60_000;
          if (mins > 0) {
            let healed = false;
            gArmy.units.forEach(u => {
              const uMax = engine.UNIT_DEFS[u.unitId]?.combatStats?.hp;
              if (!uMax) return;
              const cur = u.currentHp ?? uMax;
              if (cur >= uMax) return;
              const next = Math.min(uMax, Math.round(cur + uMax * _GARRISON_REGEN_PER_MIN * mins));
              if (next > cur) { u.currentHp = next; healed = true; }
            });
            if (healed) { gArmy.regenAt = nowMs; changed = true; }
          }
        }
      }
    }
  }

  // ── 2. City queue ticks ─────────────────────────────────────

  for (const city of Object.values(cities)) {
    if (!city?.id) continue;

    // 2a. Construction queue
    const doneBuildings = [];
    city.constructionQueue = (city.constructionQueue || []).filter(item => {
      if (nowMs < item.finishAt) return true;
      city.buildings = city.buildings || {};
      city.buildings[item.buildingId] = item.targetLevel;
      if (engine?.BUILDING_DEFS?.[item.buildingId]?.isLandmark) city.landmark = item.buildingId;
      doneBuildings.push(item.buildingId);
      return false;
    });
    if (doneBuildings.length > 0) {
      changed = true;
      doneBuildings.forEach(bid => events.push({
        type: 'building_completed', cityId: city.id, cityName: city.name || '', buildingId: bid,
      }));
    }

    // 2b. Recruitment queue
    const doneRecruits = [];
    city.recruitmentQueue = (city.recruitmentQueue || []).filter(item => {
      if (nowMs < item.finishAt) return true;
      if (item.lordId) {
        if (!armies[item.lordId]) armies[item.lordId] = { lordId: item.lordId, units: [] };
        const army     = armies[item.lordId];
        const existing = army.units.find(u => u.unitId === item.unitId);
        if (existing) existing.count += item.count;
        else army.units.push({ unitId: item.unitId, count: item.count });
      }
      doneRecruits.push({ unitId: item.unitId, count: item.count, lordId: item.lordId });
      return false;
    });
    if (doneRecruits.length > 0) {
      changed = true;
      doneRecruits.forEach(r => events.push({
        type: 'recruitment_completed', cityId: city.id, cityName: city.name || '',
        unitId: r.unitId, count: r.count, lordId: r.lordId,
      }));
    }
  }

  // ── 3. Resource production, population & economy ─────────────

  // One-time migration: seed rankingStats for existing players
  if (!player.rankingStats) {
    player.rankingStats = { pvpWins: 0, conquests: 0 };
    changed = true;
  }

  // Seed / migrate the empire resource pool
  if (!player.resources) {
    player.resources = { food: 0, wood: 0, stone: 0 };
    changed = true;
  }
  if ('iron' in player.resources) {
    delete player.resources.iron; // legacy resource, removed in the OGame overhaul
    changed = true;
  }

  // Library research completion (empire-level, single slot). Level is
  // stored on the queue item so no defs are needed to complete it.
  if (Array.isArray(player.researchQueue) && player.researchQueue.length > 0) {
    player.researchQueue = player.researchQueue.filter(item => {
      if (nowMs < item.finishAt) return true;
      player.research = player.research || {};
      player.research[item.bookId] = item.targetLevel;
      events.push({ type: 'research_completed', bookId: item.bookId, level: item.targetLevel });
      changed = true;
      return false;
    });
  }

  // Temple blessing expiry (empire-wide, single slot). The buff is already
  // self-enforcing — blessingFx above ignores an expired blessing — but clear
  // the lapsed record here so state stays tidy and the client can toast it.
  if (player.activeBlessing && player.activeBlessing.finishAt && nowMs >= player.activeBlessing.finishAt) {
    events.push({ type: 'blessing_lapsed', blessingId: player.activeBlessing.id });
    player.activeBlessing = null;
    changed = true;
  }

  // Economy (production/population/gold) requires the shared EconomyCore
  // from engine-loader.js. Every normal caller passes it; the one deliberate
  // exception is combat-resolver's offline-attacker position update, which
  // passes no engine and only needs queues/positions — for that path the
  // whole economy section is skipped WITHOUT advancing lastResourceUpdate,
  // so no production is lost (the next real sync applies it).
  const eco = engine?.EconomyCore;

  const mainLord    = lords[player.lordId];
  const raceId      = mainLord?.race || null;
  const raceBonuses = engine?.RACES?.[raceId]?.bonuses || {};

  // Race, Library-research and God-of-Nature-blessing production bonuses all
  // share the same flat keys — combine them once, then feed the merged
  // object to getRates.
  const researchFx  = eco ? eco.getResearchEffects(player.research) : {};
  const prodBonuses = {};
  for (const r of ['food', 'wood', 'stone']) {
    prodBonuses[r + '_production'] = (raceBonuses[r + '_production'] || 0)
      + (researchFx[r + '_production'] || 0)
      + (blessingFx[r + '_production'] || 0);
  }

  let totalGoldEarned = 0;

  const MAX_ELAPSED_H = 720; // cap at 30 days to avoid runaway catch-up

  for (const city of Object.values(cities)) {
    if (!eco) break; // engine-less call — skip economy, see comment above
    if (!city?.id) continue;

    const lastUpdate = city.lastResourceUpdate;
    if (!lastUpdate || lastUpdate >= nowMs) continue;

    const elapsedH = Math.min((nowMs - lastUpdate) / 3_600_000, MAX_ELAPSED_H);
    if (elapsedH <= 0) continue;

    // Terrain context — deterministic from coordinates, same as WorldService
    const terrainKey  = (city.x != null && city.y != null) ? _getTerrain(city.x, city.y) : null;
    const terrainMods = engine?.TERRAIN_RESOURCE_MODS?.[terrainKey] || {};

    // Extra stat effects: active (non-expired) event modifiers + terrain stat mods
    const extraEffects = [
      ...(city.activeModifiers || []).filter(m => !m.expiresAt || nowMs < m.expiresAt),
      ...(engine?.TERRAIN_STAT_MODS?.[terrainKey] || []),
    ];

    const stats = eco.getStats(city.buildings || {}, city.population || 1000, extraEffects);

    // Resource production (race + research + terrain) → empire-wide pool
    const rates = eco.getRates(city.buildings || {}, prodBonuses, terrainMods);
    for (const [res, perHour] of Object.entries(rates)) {
      if (perHour > 0) player.resources[res] = (player.resources[res] || 0) + perHour * elapsedH;
    }

    // Gold income (accumulated, applied to player after all cities)
    totalGoldEarned += eco.getGoldRate(city.buildings || {}, city.population, stats.happiness) * elapsedH;

    // Population growth. God of Fertility blessing boosts positive growth
    // only — a blessing must never deepen a decline.
    let popRate = eco.getPopGrowthRate(stats, rates.food);
    if (popRate > 0 && blessingFx.pop_growth_bonus) {
      popRate = Math.round(popRate * (1 + blessingFx.pop_growth_bonus));
    }
    if (popRate !== 0) {
      city.population = Math.max(1, Math.round((city.population || 1000) + popRate * elapsedH));
    }
    eco.degradeExcessBuildings(city);

    // freePopulation: +5/day ≈ 0.2083/h, cap 20
    city.freePopulation = Math.min(20, (city.freePopulation ?? 3) + (5 / 24) * elapsedH);

    city.lastResourceUpdate   = nowMs;
    city.lastPopulationUpdate = nowMs;
    changed = true;
  }

  // Gold income — upkeep was removed entirely (2026-07-27 review): armies
  // are constrained by the PWR cap, not by maintenance costs. God of Commerce
  // blessing scales the whole empire's take (same multiplier the client's
  // ProductionService.getGoldRate applies for display).
  if (eco && totalGoldEarned > 0) {
    totalGoldEarned *= (1 + (blessingFx.gold_income_bonus || 0));
    player.coins = Math.floor((player.coins || 0) + totalGoldEarned);
    changed = true;
  }
  if ('lastUpkeepAt' in player) { delete player.lastUpkeepAt; changed = true; } // legacy field

  return { lords, cities, armies, player, events, changed };
}
