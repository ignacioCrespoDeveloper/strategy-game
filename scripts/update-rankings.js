// =============================================================
//  update-rankings.js
//
//  STEP 1 — Run this SQL in Supabase Dashboard → SQL Editor:
//
//    -- Allow all authenticated users to read rank_score rows
//    CREATE POLICY "rank_score_public_read"
//    ON storage FOR SELECT
//    TO authenticated
//    USING (key = 'rank_score');
//
//    (If you already have a policy that covers SELECT for own rows,
//     you may need to drop it first and recreate it as two separate
//     policies: one for own-row read/write, one for rank_score read.)
//
//  STEP 2 — Paste this entire file into the browser console while
//           logged into the game as yourself (admin).
//           Replace YOUR_SERVICE_ROLE_KEY below (Supabase Dashboard
//           → Settings → API → service_role secret).
//
//  The script:
//    1. Fetches ALL players' storage data via the service role key
//       (bypasses RLS so we can read everyone's cities/lords/armies)
//    2. Computes each player's score directly from raw data
//    3. Upserts a rank_score row for every player found
// =============================================================

(async () => {

  // ── CONFIG ─────────────────────────────────────────────────────
  // Paste your Supabase service role key here (never commit this!)
  const SERVICE_KEY = 'PASTE_YOUR_SERVICE_ROLE_KEY_HERE';

  // ── Init admin client (bypasses RLS) ──────────────────────────
  const SUPABASE_URL = SupabaseService.client.supabaseUrl;
  const admin = supabase.createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false },
  });

  console.log('🏆 Hexfront ranking updater — fetching all storage data…');

  // ── Fetch all relevant keys for every player ───────────────────
  const KEYS = ['players', 'cities', 'lords', 'armies', 'discovery_log'];

  const { data: rows, error: fetchErr } = await admin
    .from('storage')
    .select('player_id, key, value')
    .in('key', KEYS);

  if (fetchErr || !rows) {
    console.error('❌ Failed to fetch storage:', fetchErr?.message);
    return;
  }

  console.log(`Fetched ${rows.length} storage rows.`);

  // ── Group rows by player ───────────────────────────────────────
  const byPlayer = {};
  rows.forEach(({ player_id, key, value }) => {
    if (!byPlayer[player_id]) byPlayer[player_id] = {};
    byPlayer[player_id][key] = value;
  });

  console.log(`Found ${Object.keys(byPlayer).length} players.`);

  // ── Pure score computation (no StorageService dependency) ──────

  function _buildingScore(city) {
    let score = 0;
    Object.entries(city.buildings || {}).forEach(([bid, level]) => {
      const def = BUILDING_DEFS[bid];
      if (!def || level <= 0) return;
      for (let l = 1; l <= level; l++) {
        const c = def.cost(l);
        score += ((c.wood || 0) + (c.stone || 0) + (c.iron || 0) + (c.food || 0)) * 2;
      }
    });
    return Math.round(score);
  }

  function computeScore(playerId, data) {
    const player = (data.players || {})[playerId];
    if (!player) return null;

    // 🏰 City score — tier bonus + building investment
    const cities = Object.values(data.cities || {}).filter(c => c.playerId === playerId);
    let cityPts = 0;
    cities.forEach(city => {
      cityPts += (city.tier || 1) * 800;
      cityPts += _buildingScore(city);
    });

    // 👑 Lord score — level × 500 + XP
    const lord    = player.lordId ? (data.lords || {})[player.lordId] : null;
    const lordPts = lord ? (lord.level || 1) * 500 + (lord.xp || 0) : 0;

    // ⚔ Army score — gold value of recruited units
    const army    = player.lordId ? (data.armies || {})[player.lordId] : null;
    const armyPts = (army?.units || []).reduce((s, u) => {
      return s + (UNIT_DEFS[u.unitId]?.goldCost || 0) * u.count;
    }, 0);

    // 🔍 Discovery score — log entries × 75
    const discLog  = (data.discovery_log || {})[playerId] || [];
    const discPts  = discLog.length * 75;

    const total = cityPts + lordPts + armyPts + discPts;

    return {
      total,
      breakdown:  { cities: cityPts, lord: lordPts, army: armyPts, discoveries: discPts },
      meta: {
        cityCount:  cities.length,
        lordLevel:  lord?.level || 0,
        lordXp:     lord?.xp    || 0,
        armyUnits:  (army?.units || []).reduce((s, u) => s + u.count, 0),
        discCount:  discLog.length,
      },
    };
  }

  // ── Compute + collect upserts ──────────────────────────────────
  const upserts = [];

  for (const [playerId, data] of Object.entries(byPlayer)) {
    const player = (data.players || {})[playerId];
    if (!player) {
      console.warn(`  ⚠ No player record for ${playerId} — skipping`);
      continue;
    }

    const score = computeScore(playerId, data);
    if (!score) continue;

    upserts.push({
      player_id: playerId,
      key:       'rank_score',
      value: {
        username:   player.username || 'Unknown',
        score:      score.total,
        breakdown:  score.breakdown,
        meta:       score.meta,
        updatedAt:  Date.now(),
      },
    });

    console.log(
      `  ${(player.username || 'Unknown').padEnd(20)} ` +
      `${score.total.toLocaleString().padStart(8)} pts  ` +
      `(🏰${score.breakdown.cities.toLocaleString()} ` +
      `👑${score.breakdown.lord.toLocaleString()} ` +
      `⚔${score.breakdown.army.toLocaleString()} ` +
      `🔍${score.breakdown.discoveries.toLocaleString()})`
    );
  }

  if (!upserts.length) {
    console.warn('No scores computed — no players found with valid data.');
    return;
  }

  // ── Upsert all rank_score rows ─────────────────────────────────
  const { error: upsertErr } = await admin
    .from('storage')
    .upsert(upserts, { onConflict: 'player_id,key' });

  if (upsertErr) {
    console.error('❌ Upsert failed:', upsertErr.message);
  } else {
    console.log(`\n✅ Done — updated ${upserts.length} players' rank scores.`);
    console.log('Reload the Rankings page to see the full leaderboard.');
  }

})();
