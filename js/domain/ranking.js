// =============================================
//  ranking.js — RankingService
//
//  Computes a player's total score from:
//    🏰 Building pts  — 10 points per building level across all cities
//    🏙 City tier pts — 100/500/1500/3000 per city at town_hall tier 1-4
//    👑 Lord pts      — total XP ever earned ÷ 3 (continuous, not per-level;
//                       a level-1 lord with 0 xp is worth 0)
//    🔍 Quest pts     — tier 1 = 9pts, tier 2+ = 18pts, legendary = 27pts
//    🛡 Army pts (Militar) — raw PWR of every lord's army (see battle-
//                       engine's power formula) counts directly as points.
//                       This is the ONLY source of Militar points — PvP wins
//                       and conquests no longer award ranking points at all
//                       (honor is the reward for PvP now, see
//                       combat-resolver.js's power-destroyed formula).
//                       City garrisons will count toward this too once
//                       garrison composition is tracked (not yet built).
//
//  Leaderboard is stored in Supabase under key 'rank_score'
//  so other players' scores are visible to everyone. A rolling ~1h-old
//  snapshot is kept under 'rank_score_1h' so the Rankings screen can show
//  "moved up/down N places in the last hour" per tab.
//
//  IMPORTANT: server/tick/ranking-updater.js has its OWN copy of this exact
//  formula (it can't import browser code) and runs unconditionally every 5
//  minutes for every player, regardless of who's actively playing — that
//  is what keeps a player's row from going stale for everyone ELSE viewing
//  the leaderboard. saveScore() below is just "push MY fresh score right
//  now" for whoever currently has the Rankings screen open. If you change
//  the formula here, change it there too — a divergence between the two is
//  exactly what causes two players to see different numbers for the same
//  account (one fresher from a live visit, one from the periodic sync).
// =============================================

const RankingService = (() => {

  const RANK_KEY   = 'rank_score';
  const HOURLY_KEY = 'rank_score_1h';
  const _HOUR_MS   = 60 * 60 * 1000;

  // ── Public: compute a score object for the given player ────────

  function _cityTierBonus(city) {
    const th = city.buildings?.town_hall || 0;
    if (th >= 16) return 3000;
    if (th >= 11) return 1500;
    if (th >= 6)  return 500;
    return 100;
  }

  // Mirrors js/ui/lord-screen.js's _unitPower/_armyPower — kept independent
  // (not imported) since this file has no build step; must stay in sync.
  function _unitPower(def) {
    if (!def) return 0;
    const s = def.combatStats || {};
    return (s.attack || 0) * 3 + (s.defense || 0) * 2 + Math.floor((s.hp || 0) / 10) + (s.speed || 0);
  }

  function _armyPowerFor(lordId) {
    const army = ArmyService.get(lordId);
    return Math.round(army.units.reduce((sum, u) => sum + _unitPower(UNIT_DEFS[u.unitId]) * Math.pow(u.count, 0.8), 0));
  }

  // Total XP a lord has ever earned, level-ups included — not just their
  // current level. js/domain/lord.js's tickActions sets xpToNext at level N
  // to 50×(2N+1); telescoping that sum gives "XP needed to REACH level N"
  // = 50×(N²−1). Adding the lord's in-progress xp gives a single continuously
  // increasing number driven purely by play, so a fresh level-1 lord with 0
  // xp is worth exactly 0 points instead of a flat per-level freebie.
  function _lordTotalXp(l) {
    const level = l.level || 1;
    return 50 * (level * level - 1) + (l.xp || 0);
  }

  function computeScore(player) {
    const cities = CityService.getPlayerCities(player.id);

    // Building pts — 10 pts per building level across all cities
    const buildingPts = cities.reduce((sum, city) => {
      return sum + Object.values(city.buildings || {}).reduce((s, lvl) => s + (lvl || 0), 0) * 10;
    }, 0);

    // City tier bonus — rewards reaching town_hall milestones
    // Tier 1 (th 1-5): +100 · Tier 2 (th 6-10): +500 · Tier 3 (th 11-15): +1500 · Tier 4 (th 16+): +3000
    const tierPts = cities.reduce((sum, city) => sum + _cityTierBonus(city), 0);

    const allLords = LordService.getAll().filter(l => l.playerId === player.id);

    // Lord pts — total XP ever earned ÷ 3 (e.g. a level-5 lord fresh off
    // their last level-up has earned 1200 XP → 400 pts). Continuous with
    // in-level progress, not just a step function on level.
    const lordPts = allLords.reduce((sum, l) => sum + Math.round(_lordTotalXp(l) / 3), 0);

    // Army pts — raw PWR of every lord's army counts directly as points,
    // so losing troops in a battle immediately costs ranking points too.
    const armyPts = allLords.reduce((sum, l) => sum + _armyPowerFor(l.id), 0);

    // Quest discoveries — tier 1 = 9pts, tier 2 = 18pts, legendary = 27pts
    const questPts = DiscoveryService.getLog(player.id)
      .filter(e => {
        const def = DISCOVERY_DEFS[e.definitionId];
        return def && def.category !== 'nothing' && def.category !== 'intelligence' && def.category !== 'combat';
      })
      .reduce((sum, e) => {
        const def  = DISCOVERY_DEFS[e.definitionId];
        const tier = def?.tier || 1;
        const pts  = def?.category === 'legendary' ? 27 : tier >= 2 ? 18 : 9;
        return sum + pts;
      }, 0);

    const total = buildingPts + tierPts + lordPts + armyPts + questPts;

    // Primary lord — highest-level lord for display
    const topLord  = [...allLords].sort((a, b) => (b.level || 1) - (a.level || 1))[0] || null;
    const lordMeta = topLord
      ? { name: topLord.name, classId: topLord.classId, level: topLord.level || 1 }
      : null;

    return {
      total,
      breakdown: { buildingPts, tierPts, lordPts, armyPts, questPts },
      lordMeta,
    };
  }

  // ── Supabase: push own score, fetch all ───────────────────────

  async function saveScore(player, scoreObj) {
    try {
      const client = SupabaseService.client;
      const newValue = {
        username:     player.username,
        score:        scoreObj.total,
        breakdown:    scoreObj.breakdown,
        lordMeta:     scoreObj.lordMeta,
        honorPoints:  player.honorPoints || 0,
        updatedAt:    Date.now(),
      };

      // Roll the PRE-update rank_score into the hourly snapshot, but only
      // once it's gone stale (>1h old) — never on every save, or the
      // snapshot would always just read "now" and every rank delta on the
      // Rankings screen would show 0. This gives every tab a rough "where
      // did this player stand ~1h ago" baseline to diff the current sort
      // against (see ranking-screen.js's rank-delta badges).
      const { data: rows } = await client
        .from('storage')
        .select('key, value')
        .eq('player_id', player.id)
        .in('key', [RANK_KEY, HOURLY_KEY]);
      const existing = rows?.find(r => r.key === RANK_KEY)?.value   || null;
      const snap     = rows?.find(r => r.key === HOURLY_KEY)?.value || null;
      const snapAge  = snap ? Date.now() - (snap.updatedAt || 0) : Infinity;

      const writes = [{ player_id: player.id, key: RANK_KEY, value: newValue }];
      if (snapAge > _HOUR_MS) {
        writes.push({ player_id: player.id, key: HOURLY_KEY, value: existing || newValue });
      }

      await client.from('storage').upsert(writes, { onConflict: 'player_id,key' });
    } catch (e) {
      console.warn('RankingService: failed to save score', e);
    }
  }

  async function fetchLeaderboard() {
    try {
      // All three reads are independent — firing them together instead of
      // one-after-another cuts this from 3 sequential round-trips down to
      // however long the slowest one takes (this was the main cause of the
      // Rankings screen feeling slow to load).
      const [{ data, error }, { data: honorRows }, { data: snapRows }] = await Promise.all([
        SupabaseService.client.from('storage').select('player_id, value').eq('key', RANK_KEY),
        // honorPoints inside the rank_score row is a snapshot — only written
        // when THAT player's own client last called saveScore(). The real,
        // always-current value lives in the separate honor_points key, updated
        // immediately server-side on every battle regardless of whether that
        // player is online. Without this second fetch, anyone who hasn't
        // logged in/navigated since their honor last changed shows a stale
        // number to everyone else viewing the leaderboard — override it here
        // so honor is never denormalized-stale for other viewers.
        SupabaseService.client.from('storage').select('player_id, value').eq('key', 'honor_points'),
        // ~1-hour-old snapshot per player (rolled forward by saveScore(), see
        // above) — attached so the Rankings screen can show "moved up/down N"
        // badges per tab. Same public-read requirement as honor_points/rank_score.
        SupabaseService.client.from('storage').select('player_id, value').eq('key', HOURLY_KEY),
      ]);
      if (error || !data) return [];

      const honorByPlayer = {};
      (honorRows || []).forEach(row => { honorByPlayer[row.player_id] = row.value ?? 0; });

      const snapByPlayer = {};
      (snapRows || []).forEach(row => { snapByPlayer[row.player_id] = row.value ?? null; });

      return data
        .map(row => ({
          playerId: row.player_id,
          ...row.value,
          honorPoints: honorByPlayer[row.player_id] ?? row.value?.honorPoints ?? 0,
          snapshot:    snapByPlayer[row.player_id] ?? null,
        }))
        .sort((a, b) => b.score - a.score);
    } catch (e) {
      console.warn('RankingService: failed to fetch leaderboard', e);
      return [];
    }
  }

  function getPlayerRank(playerId, leaderboard) {
    const idx = leaderboard.findIndex(e => e.playerId === playerId);
    return idx === -1 ? null : idx + 1;
  }

  return { computeScore, saveScore, fetchLeaderboard, getPlayerRank };
})();
