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

// Raiding stance hourly reward rate — scales with lord level. Landed
// between passive city income (~7-65 gold/hr) and the effective rate of
// actively-played search quests (well above that), since raiding requires
// zero further input once started but locks the lord and risks losing
// everything accrued to any passing army.
function _raidHourlyRewards(lord) {
  const lvl  = lord.level || 1;
  const gold = Math.round(25 + lvl * 5);
  const res  = Math.round(15 + lvl * 3);
  return { gold, food: res, wood: res, stone: res };
}

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

// Apply pending level-ups after an XP gain. Mirrors lord.js checkLevelUp().
function _checkLevelUp(lord, engine) {
  const cls     = engine?.LORD_CLASSES?.[lord.classId];
  const clsKeys = new Set(Object.keys(cls?.modifiers || {}));
  while ((lord.xp || 0) >= (lord.xpToNext || _xpToNextLevel(lord.level || 1))) {
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
}

// Army combat power from the armies map — same PWR the recruit cap uses
// (EconomyCore.getArmyPower: linear per-model cost + combat-trait tax), so
// camp difficulty scales with the number the player actually sees.
function _armyPower(armies, lordId, engine) {
  const army = armies?.[lordId];
  if (!army?.units || !engine?.EconomyCore) return 0;
  return engine.EconomyCore.getArmyPower(army.units, engine.UNIT_DEFS);
}

// Weighted random roll over DISCOVERY_DEFS. Mirrors DiscoveryService._roll().
const _GOLD_DISC_IDS = new Set(['coin_cache','lost_treasure','buried_vault','merchant_caravan','traveling_merchant','ancient_relic','bog_crystal']);
function _rollDef(DISCOVERY_DEFS, terrainId, goldBonus) {
  const entries = Object.values(DISCOVERY_DEFS).map(def => {
    const mults  = def.terrainMultipliers || {};
    const mult   = (terrainId in mults) ? mults[terrainId] : 1.0;
    let   weight = def.baseWeight * mult;
    if (goldBonus && _GOLD_DISC_IDS.has(def.id)) weight *= (1 + goldBonus);
    return { def, weight };
  }).filter(e => e.weight > 0);
  let total = 0;
  entries.forEach(e => total += e.weight);
  let rand = Math.random() * total;
  for (const e of entries) { rand -= e.weight; if (rand <= 0) return e.def; }
  return entries[entries.length - 1].def;
}

// Camp difficulty roll. Mirrors DiscoveryService._rollCampLevel/_rollCampDetails().
function _rollCampDetails(CAMP_DEFS, defId, armyPower) {
  const campDef = CAMP_DEFS?.[defId];
  if (!campDef) return null;
  const [minL, maxL] = campDef.levelRange;
  const base  = armyPower < 100 ? 1 : armyPower < 300 ? 2 : armyPower < 700 ? 3 : armyPower < 1400 ? 4 : 5;
  const level = Math.max(minL, Math.min(maxL, base + Math.floor(Math.random() * 3) - 1));
  const defenders = campDef.defenderRosterByLevel?.[level] || campDef.defenderRosterByLevel?.[minL] || [{ unitId: 'bandits', count: 2 }];
  return { level, type: defId, defenders };
}

// Loot roll for non-combat discoveries. Mirrors DiscoveryService._rollRewards().
const _DISC_BASE_REWARDS = {
  iron_vein: { stone: 1, xp: 15 }, cliff_face: { stone: 1, xp: 15 },
  fertile_fields: { food: 1, xp: 15 }, river_crossing: { food: 1, xp: 15 },
  coin_cache: { gold: 1, xp: 15 }, timber_cache: { wood: 1, xp: 30 },
  abandoned_mine: { stone: 1, xp: 40 }, stone_deposit: { stone: 1, xp: 30 },
  wild_game: { food: 1, xp: 20 }, lost_treasure: { gold: 1, xp: 60 },
  ancient_forest: { wood: 1, xp: 70 }, deep_ore_shaft: { stone: 1, xp: 80 },
  marble_quarry: { stone: 1, xp: 80 }, bountiful_hunt: { food: 1, xp: 60 },
  buried_vault: { gold: 1, xp: 100 }, ancient_ruins: { xp: 80 },
  abandoned_keep: { gold: 1, xp: 50 }, wandering_sage: { xp: 100 },
  merchant_caravan: { gold: 1, xp: 20 }, traveling_merchant: { gold: 1, xp: 20 },
  ancient_relic: { gold: 1, xp: 160 }, bog_crystal: { gold: 1, xp: 120 },
};
const _DISC_TIER_RANGES = {
  1: { res: [20, 60],   gold: [30, 80]   },
  2: { res: [40, 120],  gold: [50, 150]  },
  3: { res: [100, 250], gold: [150, 400] },
};
function _rollDiscRewards(def, lordLevel) {
  if (def.category === 'combat') return [];
  const level  = Math.max(1, lordLevel || 1);
  const scalar = 1 + 0.12 * (level - 1);
  const tier   = def.tier || 2;
  const ranges = _DISC_TIER_RANGES[tier] || _DISC_TIER_RANGES[2];
  const base   = _DISC_BASE_REWARDS[def.id];
  const rewards = [];
  if (base) {
    ['gold','food','wood','stone'].forEach(t => {
      if (!base[t]) return;
      const [min, max] = t === 'gold'
        ? (def.id === 'lost_treasure' ? [80, 200] : ranges.gold)
        : ranges.res;
      rewards.push({ type: t, amount: Math.floor((min + Math.random() * (max - min + 1)) * scalar) });
    });
    if (base.xp > 0) rewards.push({ type: 'xp', amount: base.xp });
  } else {
    rewards.push({ type: 'xp', amount: 20 });
  }
  return rewards;
}

// Full search_area resolution. Returns a pending discovery object to be stored on the lord
// and drained by the client (online) or the sync endpoint (offline).
const _SEARCH_AREA_XP = 8; // mirrors LORD_ACTIONS.search_area.xpReward in lord.js
function _resolveSearchArea(lord, armies, nowMs, engine) {
  if (lord.x == null || lord.y == null) return null;
  const { DISCOVERY_DEFS, CAMP_DEFS, TALENT_POOL, UNIT_DEFS } = engine;

  const terrainId     = _getTerrain(lord.x, lord.y);
  const talentEffects = (TALENT_POOL && lord.talentId) ? (TALENT_POOL[lord.talentId]?.effects || {}) : {};
  const def           = _rollDef(DISCOVERY_DEFS, terrainId, talentEffects.goldDiscoveryBonus || 0);

  if (def.category === 'nothing') {
    return { defId: def.id, category: 'nothing', record: null, rewards: [] };
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

  if (def.category === 'combat') {
    const ap = _armyPower(armies, lord.id, engine);
    record.campDetails = _rollCampDetails(CAMP_DEFS, def.id, ap);
    return { defId: def.id, category: def.category, record, rewards: [] };
  }

  const rewards = _rollDiscRewards(def, lord.level);
  return { defId: def.id, category: def.category, record, rewards };
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

    // 1a. Clear expired downtime
    if (lord.downtimeUntil && nowMs >= lord.downtimeUntil) {
      lord.downtimeUntil  = null;
      lord.downtimeReason = null;
      lord.currentHp      = 1;
      lord.hpRegenAt      = nowMs;
      events.push({ type: 'lord_recovered', lordId: lord.id, lordName: lord.name || '' });
      changed = true;
    }

    if (lord.downtimeUntil && nowMs < lord.downtimeUntil) continue;

    // 1b. HP regeneration — 2% of maxHp per minute
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

    // 1c. Action queue
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
        lord.xp = (lord.xp || 0) + Math.round(_SEARCH_AREA_XP * xpMult);

        const pending = _resolveSearchArea(lord, armies, nowMs, engine);
        if (pending) {
          // Apply gold / resource rewards to player immediately.
          for (const r of (pending.rewards || [])) {
            if      (r.type === 'gold') player.coins = Math.floor((player.coins || 0) + r.amount);
            else if (r.type === 'xp')  lord.xp = (lord.xp || 0) + r.amount;
            else if (['food','wood','stone'].includes(r.type)) {
              player.resources = player.resources || {};
              player.resources[r.type] = Math.floor((player.resources[r.type] || 0) + r.amount);
            }
          }
          _checkLevelUp(lord, engine);
          lord.pendingDiscoveries = lord.pendingDiscoveries || [];
          lord.pendingDiscoveries.push(pending);
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

    // 1d. Raiding stance — passive heal while active, full payout + heal on
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
        const rates = _raidHourlyRewards(lord);
        // God of Destruction blessing: heavier plunder from every raid.
        const raidMult   = 1 + (blessingFx.raid_bonus || 0);
        const goldEarned = Math.floor(rates.gold * hours * raidMult);
        player.coins      = Math.floor((player.coins || 0) + goldEarned);
        player.resources  = player.resources || { food: 0, wood: 0, stone: 0 };
        ['food', 'wood', 'stone'].forEach(r => {
          player.resources[r] = Math.floor((player.resources[r] || 0) + rates[r] * hours * raidMult);
        });
        lord.currentHp = maxHp;
        lord.hpRegenAt = nowMs;
        healUnits();
        lord.stance = { id: 'idle', startedAt: null, finishAt: null };
        events.push({ type: 'raid_complete', lordId: lord.id, lordName: lord.name || '', goldEarned });
        changed = true;
      } else {
        if (lord.currentHp !== maxHp) { lord.currentHp = maxHp; lord.hpRegenAt = nowMs; changed = true; }
        healUnits();
      }
    }

    // 1e. Garrison unit regen — while the lord is idle (no queued action, not
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
