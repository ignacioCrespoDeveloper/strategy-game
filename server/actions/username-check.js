// =============================================
//  actions/username-check.js — POST /api/auth/username-available
//
//  Body: { username }
//  Returns: { ok: true, available: bool, error?: <why it is unusable> }
//
//  WHY THIS IS A SERVER ENDPOINT.
//  Usernames are not stored in a table with a unique constraint — they live in
//  the Supabase auth user's `user_metadata`, written client-side by
//  `auth.signUp` (js/ui/auth-view.js). Nothing anywhere rejected a second
//  account claiming a name that was already in use, so two players could hold
//  the same one and the map, rankings and battle reports would show two
//  identical lords with no way to tell them apart.
//
//  The client cannot check this for itself: reading other players' rows is
//  exactly what RLS forbids, and the auth user list is service-role only. So
//  the check has to happen here, against the same two sources the rest of the
//  server treats as authoritative:
//
//    1. auth.users — every account that has ever registered, including one
//       that signed up and never played (no `storage` row exists for those,
//       so the storage scan alone would miss them).
//    2. storage/'players' — the game-side record. Belt and braces: it is where
//       a username would live if it were ever changed after registration.
//
//  Names are compared CASE-INSENSITIVELY. "Nacho" and "nacho" are the same
//  name to a human reading a battle report, so they must be the same name here.
//
//  KNOWN LIMIT — this narrows the window, it does not close it. Two people
//  submitting the same brand-new name in the same second can both be told it
//  is free, because signUp still happens client-side against Supabase and
//  there is no unique index to lose the race against. Closing that properly
//  means moving registration itself server-side (admin.createUser) behind a
//  real unique constraint. At this player count the window is not worth that
//  rewrite; if it ever bites, that is the fix.
//
//  UNAUTHENTICATED on purpose: it runs before the account exists. It reveals
//  only whether a name is taken, which the public rankings screen already
//  shows for every active player.
// =============================================

import { createClient } from '@supabase/supabase-js';

// Kept in step with the client-side rules in js/ui/auth-view.js
// (_onRegisterStep1). Duplicated deliberately: the client copy exists to give
// instant feedback, this copy exists because the client's is not enforcement.
const MIN_LEN = 3;
const MAX_LEN = 20;
const PATTERN = /^[a-zA-Z0-9_]+$/;

function _admin() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
  );
}

// The username an account effectively displays under. Mirrors the fallback
// chain in server/action-base.js — a Google sign-in carries no metadata
// username and shows as its email prefix, which is a real, collidable name.
function _effectiveUsername(user) {
  return user?.user_metadata?.username || user?.email?.split('@')[0] || '';
}

// Every name currently in use, lowercased. Paginates auth.users the same way
// reset-db.js does; 50/page is the Supabase default page size.
async function _takenNames(admin) {
  const taken = new Set();

  let page = 1;
  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 50 });
    if (error) throw new Error(`listUsers failed: ${error.message}`);
    if (!data.users.length) break;
    for (const u of data.users) {
      const name = _effectiveUsername(u).trim().toLowerCase();
      if (name) taken.add(name);
    }
    if (data.users.length < 50) break;
    page++;
  }

  // Game-side records. Each row's value is a { [playerId]: player } map.
  const { data: rows, error: rowErr } = await admin
    .from('storage').select('value').eq('key', 'players');
  if (!rowErr) {
    for (const row of rows || []) {
      for (const p of Object.values(row.value || {})) {
        const name = String(p?.username || '').trim().toLowerCase();
        if (name) taken.add(name);
      }
    }
  }

  return taken;
}

export async function handleUsernameCheck(req, res) {
  const raw = String((req.body || {}).username || '').trim();

  if (raw.length < MIN_LEN) {
    return res.json({ ok: true, available: false, error: `Username must be at least ${MIN_LEN} characters.` });
  }
  if (raw.length > MAX_LEN) {
    return res.json({ ok: true, available: false, error: `Username cannot exceed ${MAX_LEN} characters.` });
  }
  if (!PATTERN.test(raw)) {
    return res.json({ ok: true, available: false, error: 'Username: only letters, numbers and underscores.' });
  }

  const taken = await _takenNames(_admin());

  if (taken.has(raw.toLowerCase())) {
    return res.json({ ok: true, available: false, error: 'That username is already taken.' });
  }
  return res.json({ ok: true, available: true });
}
