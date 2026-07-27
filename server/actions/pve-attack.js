// =============================================
//  actions/pve-attack.js — POST /api/lord/pve-attack
//
//  Server-authoritative PvE combat resolution (bandit camps, quest combat
//  encounters). Replaces the old flow where the client ran
//  BattleEngine.resolve() itself and self-reported the outcome to
//  /api/lord/pve-result, which trusted that report completely — a modified
//  client could fabricate a costless win with max loot.
//
//  The encounter itself (camp level + defender roster) is already
//  server-rolled and trustworthy — see server/tick/catch-up.js's
//  search_area resolution, which stores it on the discovery record at
//  search time. This endpoint re-derives the same encounter from that
//  stored record and runs the fight itself, so nothing about the outcome
//  is client-supplied.
//
//  Body: { lordId, recordId }
//  Returns: { ok, report, leveled, lord, army, player, honorPoints, honorDelta }
// =============================================

import { loadAndCatchUp, saveState } from '../action-base.js';
import { BattleEngine, DISCOVERY_DEFS, CAMP_DEFS, CAMP_LEVEL_LOOT, EconomyCore } from '../engine-loader.js';
import { _checkLevelUp, _effectiveStats } from '../combat-resolver.js';

// PvE only ever grants a flat honor gain on a win. PvP honor instead swings
// up or down for both sides based on the relative power gap (see
// combat-resolver.js) — never flat, never guaranteed positive.
const _PVE_WIN_HONOR = 5;

export async function handlePveAttack(req, res) {
  const { lordId, recordId } = req.body || {};
  if (!lordId || !recordId) {
    return res.status(400).json({ ok: false, error: 'Missing lordId or recordId' });
  }

  const ctx = await loadAndCatchUp(req, res, ['discoveries', 'honor_points']);
  if (!ctx) return;
  const { admin, playerId, rawPlayers, player, lords, cities, armies, extras } = ctx;

  const lord = lords[lordId];
  if (!lord)                      return res.status(404).json({ ok: false, error: 'Lord not found' });
  if (lord.playerId !== playerId) return res.status(403).json({ ok: false, error: 'Not your lord' });
  if (lord.downtimeUntil && Date.now() < lord.downtimeUntil) {
    return res.status(400).json({ ok: false, error: 'Lord is incapacitated' });
  }
  if ((lord.actionQueue || []).length > 0) {
    return res.status(400).json({ ok: false, error: 'Lord is busy with another action' });
  }

  const discoveriesAll = extras.discoveries || {};
  const records        = discoveriesAll[playerId] || [];
  const idx             = records.findIndex(r => r.id === recordId);
  if (idx === -1) return res.status(404).json({ ok: false, error: 'Discovery not found or already claimed' });

  const record = records[idx];
  if (record.expiresAt !== null && record.expiresAt !== undefined && Date.now() > record.expiresAt) {
    return res.status(400).json({ ok: false, error: 'Discovery has expired' });
  }
  if (record.lordId !== lordId) {
    return res.status(403).json({ ok: false, error: 'Discovery was not found by this lord' });
  }

  const def = DISCOVERY_DEFS[record.definitionId];
  if (!def || def.category !== 'combat') {
    return res.status(400).json({ ok: false, error: 'Not a combat discovery' });
  }

  // Rebuild the exact encounter the client would have shown — sourced from
  // the server-rolled campDetails already on the record, not from the client.
  const cd       = record.campDetails;
  const campDef  = CAMP_DEFS[cd?.type] || CAMP_DEFS[def.id] || {};
  const baseLoot = CAMP_LEVEL_LOOT[cd?.level] || CAMP_LEVEL_LOOT[1];
  const mult     = campDef.rewardMultiplier || 1.0;
  const encounter = {
    name:           `${campDef.displayName || 'Bandit Camp'}${cd ? ` (Level ${cd.level})` : ''}`,
    startingMorale: campDef.morale || 55,
    loot: {
      goldMin: Math.round(baseLoot.goldMin * mult), goldMax: Math.round(baseLoot.goldMax * mult),
      resMin:  Math.round((baseLoot.resMin || 0) * mult), resMax: Math.round((baseLoot.resMax || 0) * mult),
    },
    xpReward:  { win: Math.round(baseLoot.xpWin * mult), loss: Math.round(baseLoot.xpLoss * mult) },
    defenders: cd?.defenders || [{ unitId: 'bandits', count: 2 }, { unitId: 'bandit_archers', count: 1 }],
  };

  const army = armies[lordId] || { lordId, units: [] };
  // Veterancy: the attacker's units fight with their training-building buff
  // (summed across all their cities). Camp defenders have no buildings.
  const cityBuildingsList = Object.values(cities || {})
    .filter(c => c?.playerId === playerId)
    .map(c => c.buildings)
    .filter(Boolean);
  const battleCtx = BattleEngine.buildContext({
    lord, army, encounter, terrain: record.terrain,
    veterancy: unitId => EconomyCore.getVeterancyPct(lord.race, unitId, cityBuildingsList),
  });
  const report = BattleEngine.resolve(battleCtx);
  report._meta = {
    campName:  encounter.name,
    campIcon:  campDef.icon  || '⚔',
    campLevel: cd?.level     || 1,
    terrain:   record.terrain,
  };

  // Apply losses to the lord's army (non-lord stacks only — lord HP handled below).
  const updatedArmy = { lordId, units: army.units.map(u => ({ ...u })) };
  report.attacker.unitsStart
    .filter(s => s.sourceId !== lordId)
    .forEach(s => {
      const surv  = report.attacker.unitsSurviving.find(u => u.sourceId === s.sourceId);
      const stack = updatedArmy.units.find(u => u.unitId === s.sourceId);
      if (!stack) return;
      stack.count = surv?.count ?? 0;
      if (surv && stack.count > 0) stack.currentHp = Math.round(surv.avgHp);
    });
  updatedArmy.units = updatedArmy.units.filter(u => u.count > 0);
  armies[lordId] = updatedArmy;

  // Apply lord HP / downtime from the battle outcome.
  const lordSurv = report.attacker.unitsSurviving.find(u => u.sourceId === lordId);
  if (lordSurv) {
    lord.currentHp      = Math.max(1, Math.round(lordSurv.avgHp));
    lord.downtimeUntil  = null;
    lord.downtimeReason = null;
  } else {
    lord.currentHp      = 0;
    lord.downtimeUntil  = Date.now() + 60 * 60 * 1000;
    lord.downtimeReason = 'defeated';
    lord.actionQueue    = [];
  }

  // XP + level-up (full-heal on level-up, matching client behavior, but only
  // if the lord actually survived — don't silently revive a fallen lord).
  lord.xp = (lord.xp || 0) + (report.xpEarned || 0);
  const leveled = _checkLevelUp(lord);
  if (leveled > 0 && !lord.downtimeUntil) {
    lord.currentHp = _effectiveStats(lord).health;
  }
  lords[lordId] = lord;

  // Gold + resource loot — attacker-only, victory-only.
  let goldEarned    = 0;
  let resourceLoot  = null;
  if (report.winner === 'attacker') {
    goldEarned = report.loot?.gold || 0;
    if (goldEarned > 0) player.coins = (player.coins || 0) + goldEarned;

    // Resource loot goes straight into the empire-wide pool — it used to be
    // written to the vestigial per-city stockpile (city.resources), which
    // nothing reads any more, silently losing the loot.
    resourceLoot = report.loot?.resource || null;
    if (resourceLoot && Object.keys(resourceLoot).length > 0) {
      player.resources = player.resources || { food: 0, wood: 0, stone: 0 };
      Object.entries(resourceLoot).forEach(([type, amt]) => {
        if (type in player.resources) player.resources[type] = (player.resources[type] || 0) + amt;
      });
    }
  }

  // Honor: the only way to gain it — a PvE (bandit camp) victory.
  const honorCurrent = extras.honor_points ?? 0;
  const honorDelta    = report.winner === 'attacker' ? _PVE_WIN_HONOR : 0;
  const honorNew      = honorCurrent + honorDelta;
  // Stamp onto the returned player object itself — the client's hydration
  // path (_mergePlayer) reads player.honorPoints, not the top-level
  // honorPoints/honorDelta fields below, so without this the client would
  // keep showing the PRE-battle honor total until its next unrelated action.
  player.honorPoints = honorNew;

  // Discovery record: only cleared on a win — camp survives a loss/draw.
  if (report.winner === 'attacker') {
    records.splice(idx, 1);
    discoveriesAll[playerId] = records;
  }

  const saveError = await saveState(admin, playerId, rawPlayers, { player, lords, cities, armies });
  if (saveError) {
    return res.status(500).json({ ok: false, error: 'Failed to save battle result' });
  }

  const extraWrites = [
    { player_id: playerId, key: 'discoveries', value: discoveriesAll },
  ];
  if (honorDelta !== 0) {
    extraWrites.push({ player_id: playerId, key: 'honor_points', value: honorNew });
  }
  const { error: extraErr } = await admin.from('storage').upsert(extraWrites, { onConflict: 'player_id,key' });
  if (extraErr) console.warn('[pve-attack] extra write warning:', extraErr.message);

  return res.json({
    ok:      true,
    report,
    leveled,
    lord,
    army:        armies[lordId],
    player,
    honorPoints: honorNew,
    honorDelta,
    discoveries: records, // this player's updated discovery list (record removed if won)
  });
}
