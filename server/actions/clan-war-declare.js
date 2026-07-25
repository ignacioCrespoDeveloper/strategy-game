// =============================================
//  actions/clan-war-declare.js — POST /api/clan/war-declare
//
//  Body: { targetClanId, durationSecs }
//
//  Leader-only: declares a time-boxed war on another clan. Score accrues
//  from "power destroyed" in PvP battles between the two clans' members
//  during the war window (see combat-resolver.js's _resolveCore) — no
//  attack-permission changes, this is purely a scored, time-limited
//  rivalry. server/tick/clan-war-updater.js ends it and picks a winner
//  once ends_at passes (same periodic-tick pattern as ranking-updater.js).
// =============================================

import { loadAndCatchUp } from '../action-base.js';

const WAR_DURATIONS = [86400, 259200, 604800]; // 1d / 3d / 7d

function _generateWarId() {
  return 'war_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
}

export async function handleClanWarDeclare(req, res) {
  const { targetClanId, durationSecs } = req.body || {};
  if (!targetClanId || !durationSecs) {
    return res.status(400).json({ ok: false, error: 'Missing targetClanId or durationSecs' });
  }
  if (!WAR_DURATIONS.includes(durationSecs)) {
    return res.status(400).json({ ok: false, error: 'Invalid war duration.' });
  }

  const ctx = await loadAndCatchUp(req, res);
  if (!ctx) return;

  const { admin, playerId, player } = ctx;

  if (!player.clanId) {
    return res.status(400).json({ ok: false, error: 'You are not in a clan.' });
  }
  if (targetClanId === player.clanId) {
    return res.status(400).json({ ok: false, error: 'You cannot declare war on your own clan.' });
  }

  const { data: myClan, error: myClanErr } = await admin.from('clans').select('*').eq('id', player.clanId).maybeSingle();
  if (myClanErr) return res.status(500).json({ ok: false, error: 'Failed to load your clan' });
  if (!myClan)   return res.status(404).json({ ok: false, error: 'Your clan no longer exists' });
  if (myClan.leader_id !== playerId) {
    return res.status(403).json({ ok: false, error: 'Only the clan leader can declare war.' });
  }

  const { data: targetClan, error: targetErr } = await admin.from('clans').select('id, name').eq('id', targetClanId).maybeSingle();
  if (targetErr) return res.status(500).json({ ok: false, error: 'Failed to load target clan' });
  if (!targetClan) return res.status(404).json({ ok: false, error: 'Target clan not found' });

  // Fetch active wars and check in JS rather than building a filter string
  // (same reasoning as clan-create.js's uniqueness check) — the active-war
  // list is small enough that this is cheap either way.
  const { data: activeWars, error: warErr } = await admin
    .from('clan_wars').select('id, clan_a_id, clan_b_id').eq('status', 'active');
  if (warErr) return res.status(500).json({ ok: false, error: 'Failed to check existing wars' });
  const already = (activeWars || []).some(w =>
    (w.clan_a_id === myClan.id && w.clan_b_id === targetClanId) ||
    (w.clan_a_id === targetClanId && w.clan_b_id === myClan.id));
  if (already) {
    return res.status(400).json({ ok: false, error: `Already at war with ${targetClan.name}.` });
  }

  const now = Date.now();
  const war = {
    id: _generateWarId(),
    clan_a_id: myClan.id,
    clan_b_id: targetClanId,
    declared_by: playerId,
    started_at: new Date(now).toISOString(),
    ends_at: new Date(now + durationSecs * 1000).toISOString(),
    score_a: 0,
    score_b: 0,
    status: 'active',
  };

  const { error: insertErr } = await admin.from('clan_wars').insert(war);
  if (insertErr) return res.status(500).json({ ok: false, error: 'Failed to declare war: ' + insertErr.message });

  return res.json({ ok: true, war });
}
