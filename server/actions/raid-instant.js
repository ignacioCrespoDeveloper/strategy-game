// =============================================
//  actions/raid-instant.js — POST /api/lord/raid-instant
//
//  Body: { lordId }
//
//  Spends credits to instantly finish an active Raiding stance — pays out
//  the FULL chosen duration's rewards. Cost = ceil(secsLeft / 60), min 1
//  credit — same formula as instant-action.js/instant-build.js/
//  instant-recruit.js.
//
//  Backdates finishAt and re-runs catchUp so the exact same
//  natural-completion payout+heal code in server/tick/catch-up.js fires,
//  rather than duplicating the reward formula here (mirrors how
//  instant-action.js handles search_area/scout completions).
// =============================================

import { loadAndCatchUp, saveState } from '../action-base.js';
import { catchUp }                    from '../tick/catch-up.js';
import { DISCOVERY_DEFS, CAMP_DEFS, TALENT_POOL, LORD_BASE_STATS, LORD_CLASSES, UNIT_DEFS, BUILDING_DEFS, RACES, EconomyCore, TERRAIN_RESOURCE_MODS, TERRAIN_STAT_MODS, pickLordPortrait, DiscoveryRoll, BattleEngine, CAMP_LEVEL_LOOT, BATTLE_WIN_HEAL_PCT } from '../engine-loader.js';

const _ENGINE = { DISCOVERY_DEFS, CAMP_DEFS, TALENT_POOL, LORD_BASE_STATS, LORD_CLASSES, UNIT_DEFS, BUILDING_DEFS, RACES, EconomyCore, TERRAIN_RESOURCE_MODS, TERRAIN_STAT_MODS, pickLordPortrait, DiscoveryRoll, BattleEngine, CAMP_LEVEL_LOOT, BATTLE_WIN_HEAL_PCT };

export async function handleRaidInstant(req, res) {
  const { lordId } = req.body || {};
  if (!lordId) return res.status(400).json({ ok: false, error: 'Missing lordId' });

  const ctx = await loadAndCatchUp(req, res);
  if (!ctx) return;

  const { admin, playerId, rawPlayers, player, lords, cities, armies } = ctx;

  const lord = lords[lordId];
  if (!lord)                      return res.status(404).json({ ok: false, error: 'Lord not found' });
  if (lord.playerId !== playerId) return res.status(403).json({ ok: false, error: 'Not your lord' });

  if (lord.stance?.id !== 'raiding') {
    return res.status(400).json({ ok: false, error: 'Lord is not currently raiding' });
  }

  const now      = Date.now();
  const secsLeft = Math.max(0, Math.ceil((lord.stance.finishAt - now) / 1000));
  const cost     = Math.max(1, Math.ceil(secsLeft / 60));

  if ((player.credits || 0) < cost) {
    return res.status(400).json({ ok: false, error: `Need ${cost} credits (have ${player.credits || 0})` });
  }

  player.credits = (player.credits || 0) - cost;

  // catch-up.js computes the payout as (finishAt - startedAt) hours — so
  // simply moving finishAt into the past would also shrink that gap and
  // pay out almost nothing instead of the full chosen duration. Shift BOTH
  // timestamps back by the same amount instead, preserving the original
  // duration while making finishAt <= now trigger natural completion.
  const durationMs = lord.stance.finishAt - lord.stance.startedAt;
  lord.stance   = { ...lord.stance, startedAt: now - durationMs - 1, finishAt: now - 1 };
  lords[lordId] = lord;
  const cu = catchUp({ player, lords, cities, armies }, now, _ENGINE);

  await saveState(admin, playerId, rawPlayers, {
    player: cu.player, lords: cu.lords, cities: cu.cities, armies: cu.armies,
  });

  const raidEvent = cu.events.find(e => e.type === 'raid_complete' && e.lordId === lordId);

  // The payout report catchUp stashed on the lord is deliberately LEFT in
  // place — the next /api/sync drains it into the Activity feed, so an
  // instant-finished raid gets the same feed entry a natural one does. This
  // response only powers the immediate toast.
  return res.json({
    ok: true, lord: cu.lords[lordId], player: cu.player, army: cu.armies[lordId],
    goldEarned: raidEvent?.goldEarned || 0,
    resources:  raidEvent?.resources  || null,
  });
}
