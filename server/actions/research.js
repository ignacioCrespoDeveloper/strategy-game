// =============================================
//  actions/research.js — Library research (books)
//
//  POST /api/research/start   { bookId }
//  POST /api/research/instant {}            (credits, finishes active research)
//
//  Research is EMPIRE-WIDE and single-slot (one book at a time),
//  gated by the player's highest Library level across all cities.
//  State lives on the player record:
//    player.research      = { bookId: level }
//    player.researchQueue = [{ bookId, targetLevel, startedAt, finishAt }]
//  Completion happens in server/tick/catch-up.js (research queue section).
// =============================================

import { loadAndCatchUp, saveState }        from '../action-base.js';
import { RESEARCH_DEFS, RESEARCH_TIERS }    from '../engine-loader.js';

function _maxLibraryLevel(cities, playerId) {
  return Object.values(cities)
    .filter(c => c?.playerId === playerId)
    .reduce((max, c) => Math.max(max, c.buildings?.library || 0), 0);
}

export async function handleResearchStart(req, res) {
  const { bookId } = req.body || {};
  if (!bookId) return res.status(400).json({ ok: false, error: 'Missing bookId' });

  const ctx = await loadAndCatchUp(req, res);
  if (!ctx) return;
  const { admin, playerId, rawPlayers, player, lords, cities, armies } = ctx;

  const def = RESEARCH_DEFS[bookId];
  if (!def) return res.status(400).json({ ok: false, error: 'Unknown book' });

  if ((player.researchQueue || []).length > 0) {
    return res.status(400).json({ ok: false, error: 'A research is already in progress.' });
  }

  const libLevel = _maxLibraryLevel(cities, playerId);
  const required = RESEARCH_TIERS[def.tier] || 1;
  if (libLevel < required) {
    return res.status(400).json({ ok: false, error: `Requires a Library at level ${required} (yours is ${libLevel}).` });
  }

  const currentLevel = (player.research || {})[bookId] || 0;
  if (currentLevel >= def.maxLevel) {
    return res.status(400).json({ ok: false, error: `${def.name} is already at max level.` });
  }
  const targetLevel = currentLevel + 1;

  const cost = def.cost(targetLevel);
  player.resources = player.resources || { wood: 0, stone: 0, food: 0 };
  for (const [rKey, amt] of Object.entries(cost)) {
    if (amt > 0 && Math.floor(player.resources[rKey] || 0) < amt) {
      return res.status(400).json({ ok: false, error: `Not enough ${rKey} (need ${amt}, have ${Math.floor(player.resources[rKey] || 0)})` });
    }
  }
  for (const [rKey, amt] of Object.entries(cost)) {
    if (amt > 0) player.resources[rKey] = (player.resources[rKey] || 0) - amt;
  }

  const now  = Date.now();
  const secs = def.researchTime(targetLevel);
  player.researchQueue = [{ bookId, targetLevel, startedAt: now, finishAt: now + secs * 1000 }];

  await saveState(admin, playerId, rawPlayers, { player, lords, cities, armies });

  const { error: evtErr } = await admin.from('pending_events').insert({
    player_id: playerId,
    type:      'research',
    fire_at:   player.researchQueue[0].finishAt,
    payload:   { bookId, targetLevel },
  });
  if (evtErr) console.warn('[research] pending_events insert failed:', evtErr.message);

  return res.json({ ok: true, player });
}

export async function handleResearchInstant(req, res) {
  const ctx = await loadAndCatchUp(req, res);
  if (!ctx) return;
  const { admin, playerId, rawPlayers, player, lords, cities, armies } = ctx;

  const item = (player.researchQueue || [])[0];
  if (!item) return res.status(400).json({ ok: false, error: 'No research in progress.' });

  const secsLeft = Math.max(0, Math.ceil((item.finishAt - Date.now()) / 1000));
  const cost     = Math.max(1, Math.ceil(secsLeft / 60));
  if ((player.credits || 0) < cost) {
    return res.status(400).json({ ok: false, error: `Not enough credits. Need ${cost}, have ${player.credits || 0}.` });
  }

  player.credits       = (player.credits || 0) - cost;
  player.research      = player.research || {};
  player.research[item.bookId] = item.targetLevel;
  player.researchQueue = [];

  await saveState(admin, playerId, rawPlayers, { player, lords, cities, armies });

  return res.json({ ok: true, player, creditsSpent: cost });
}
