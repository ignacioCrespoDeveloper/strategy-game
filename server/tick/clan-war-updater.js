// =============================================
//  tick/clan-war-updater.js
//
//  Runs every minute on the server (plus once on boot).
//  Finds every 'active' clan_wars row whose ends_at has passed, marks it
//  'ended', and sets winner_clan_id to whichever side has the higher
//  score_a/score_b (or null on an exact tie). Mirrors ranking-updater.js's
//  periodic-tick pattern — this is the only place a war's status actually
//  changes once declared; nothing else derives "did this war end" on the fly.
// =============================================

import { createClient } from '@supabase/supabase-js';

function _admin() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
  );
}

export async function runClanWarUpdate() {
  const admin = _admin();

  const { data: wars, error } = await admin
    .from('clan_wars').select('id, clan_a_id, clan_b_id, score_a, score_b, ends_at')
    .eq('status', 'active');

  if (error) {
    console.error('[clan-war-updater] load error:', error.message);
    return;
  }

  const now = Date.now();
  const toEnd = (wars || []).filter(w => new Date(w.ends_at).getTime() <= now);
  if (toEnd.length === 0) return;

  for (const war of toEnd) {
    const scoreA = Number(war.score_a) || 0;
    const scoreB = Number(war.score_b) || 0;
    const winnerClanId = scoreA === scoreB ? null : (scoreA > scoreB ? war.clan_a_id : war.clan_b_id);

    const { error: updateErr } = await admin
      .from('clan_wars')
      .update({ status: 'ended', winner_clan_id: winnerClanId })
      .eq('id', war.id);
    if (updateErr) {
      console.warn(`[clan-war-updater] failed to end war ${war.id}:`, updateErr.message);
    }
  }

  console.log(`[clan-war-updater] ended ${toEnd.length} war(s)`);
}
