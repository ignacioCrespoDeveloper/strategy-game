// =============================================
//  actions/lord-talents.js — POST /api/lord/talents
//
//  Body: { lordId, talentId?, statKey?, statPoints? }
//
//  Two operations (can be combined in one call):
//    talentId             → choose a talent (level 5+, permanent, one-time)
//    statKey + statPoints → spend talent points on a stat
// =============================================

import { loadAndCatchUp, saveState } from '../action-base.js';
import { LORD_BASE_STATS, TALENT_POOL } from '../engine-loader.js';

export async function handleLordTalents(req, res) {
  const { lordId, talentId, statKey, statPoints } = req.body || {};
  if (!lordId) {
    return res.status(400).json({ ok: false, error: 'Missing lordId' });
  }

  const ctx = await loadAndCatchUp(req, res);
  if (!ctx) return;

  const { admin, playerId, rawPlayers, player, lords, cities, armies } = ctx;

  const lord = lords[lordId];
  if (!lord)                         return res.status(404).json({ ok: false, error: 'Lord not found' });
  if (lord.playerId !== playerId)    return res.status(403).json({ ok: false, error: 'Not your lord' });

  // ── Talent choice ─────────────────────────────────────────────
  if (talentId != null) {
    if ((lord.level || 1) < 5)       return res.status(400).json({ ok: false, error: 'Talent selection unlocks at level 5.' });
    if (lord.talentId != null)       return res.status(400).json({ ok: false, error: 'Talent already chosen — permanent.' });
    if (!TALENT_POOL?.[talentId])    return res.status(400).json({ ok: false, error: 'Unknown talent.' });
    lord.talentId = talentId;
  }

  // ── Stat allocation ───────────────────────────────────────────
  if (statKey != null && statPoints != null) {
    const pts = Number(statPoints);
    if (!Number.isInteger(pts) || pts < 1) {
      return res.status(400).json({ ok: false, error: 'statPoints must be a positive integer.' });
    }
    if (!(statKey in LORD_BASE_STATS)) {
      return res.status(400).json({ ok: false, error: `Unknown stat: ${statKey}` });
    }
    if ((lord.talentPoints || 0) < pts) {
      return res.status(400).json({ ok: false, error: `Not enough talent points (have ${lord.talentPoints || 0}, need ${pts}).` });
    }
    lord.baseStats        = lord.baseStats || { ...LORD_BASE_STATS };
    lord.baseStats[statKey] = (lord.baseStats[statKey] ?? LORD_BASE_STATS[statKey]) + pts;
    lord.talentPoints      = (lord.talentPoints || 0) - pts;
  }

  lords[lordId] = lord;
  await saveState(admin, playerId, rawPlayers, { player, lords, cities, armies });

  return res.json({ ok: true, lord });
}
