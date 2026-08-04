// =============================================
//  actions/lord-talents.js — POST /api/lord/talents
//
//  Body: { lordId, talentId?, statKey?, statPoints? }
//
//  Two operations (can be combined in one call):
//    talentId             → claim ONE talent slot (levels 5/10/15/20)
//    statKey + statPoints → spend talent points on a stat
// =============================================

import { loadAndCatchUp, saveState } from '../action-base.js';
import {
  LORD_BASE_STATS, TALENT_POOL, lordStatGain,
  getLordTalentIds, lordTalentSlots, nextTalentLevel, MAX_TALENTS,
} from '../engine-loader.js';

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
  // ONE SLOT PER 5 LEVELS since 2026-08-03 (levels 5/10/15/20, four in total).
  // This is the authoritative gate — the Talents tab renders the same rule, but
  // the number of slots a lord has earned is decided here.
  if (talentId != null) {
    // getLordTalentIds, not lord.talentIds, on purpose. It migrates a lord that
    // still carries only the old scalar `talentId`, AND it drops ids that are no
    // longer in TALENT_POOL — which is what hands a slot back to a lord holding
    // a retired pick (commander/scholar, dropped 2026-07-30 for having no live
    // effect). Without that, the Talents tab would offer the grid and every
    // Choose button would answer "no slots left" forever, with nothing to show
    // for the pick.
    const held  = getLordTalentIds(lord);
    const slots = lordTalentSlots(lord.level);

    if (slots <= 0) {
      return res.status(400).json({ ok: false, error: `Talent selection unlocks at level ${nextTalentLevel(lord.level)}.` });
    }
    if (held.length >= slots) {
      const next = nextTalentLevel(lord.level);
      return res.status(400).json({
        ok: false,
        error: next
          ? `No talent slot available — the next one unlocks at level ${next}.`
          : `All ${MAX_TALENTS} talents are chosen — talents are permanent.`,
      });
    }
    if (!TALENT_POOL?.[talentId])    return res.status(400).json({ ok: false, error: 'Unknown talent.' });
    if (held.includes(talentId))     return res.status(400).json({ ok: false, error: 'That talent is already chosen.' });

    lord.talentIds = [...held, talentId];
    // Keep the legacy scalar in sync rather than deleting it: it is persisted on
    // every lord row in Supabase and a tab left open across the deploy still
    // reads it. talentIds is what everything authoritative reads.
    lord.talentId  = lord.talentIds[0];
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
    // Not `+ pts`: each stat has its own per-point gain (lordStatGain), because
    // health is on a ~100-based scale and everything else on a 5–20 one, so a
    // flat +1 made health a wasted point. Health moves +15 per point.
    lord.baseStats        = lord.baseStats || { ...LORD_BASE_STATS };
    lord.baseStats[statKey] = (lord.baseStats[statKey] ?? LORD_BASE_STATS[statKey]) + lordStatGain(statKey, pts);
    lord.talentPoints      = (lord.talentPoints || 0) - pts;
  }

  lords[lordId] = lord;
  await saveState(admin, playerId, rawPlayers, { player, lords, cities, armies });

  return res.json({ ok: true, lord });
}
