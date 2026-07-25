-- =============================================
--  RLS fix: honor_points (and rank_score_1h) must be
--  publicly readable (same visibility as rank_score),
--  and honor_points is no longer client-writable now
--  that it's 100% server-computed.
--
--  Root cause of the "other players show 0/stale honor
--  on the Rankings screen until THEY personally visit
--  Rankings" bug: 'rank_score' rows are readable by all
--  authenticated users (a public-leaderboard policy exists
--  for it already), but 'honor_points' rows were never
--  granted that same public-read policy — the base
--  "storage_read_own" policy from rls-server-keys.sql only
--  lets a client read its OWN honor_points row. So
--  fetchLeaderboard()'s honor overlay silently got zero
--  rows for every other player and fell back to each
--  player's stale rank_score.honorPoints snapshot, which
--  only refreshes when THAT player's own client calls
--  saveScore() (i.e. visits Rankings themselves).
--
--  Run this in the Supabase SQL editor:
--  Dashboard → SQL Editor → paste → Run
-- =============================================

-- Step 1: Let every authenticated user read every player's honor_points row
-- (Postgres OR's multiple permissive SELECT policies together, so this is
-- additive and does not disturb the existing storage_read_own policy).
-- Also covers 'rank_score_1h' — a rolling ~1h-old snapshot of rank_score
-- used to show "moved up/down N places in the last hour" badges on the
-- Rankings screen; it needs the exact same public-read treatment.
DROP POLICY IF EXISTS "storage_read_public_honor" ON storage;
CREATE POLICY "storage_read_public_honor" ON storage
  FOR SELECT
  TO authenticated
  USING (key IN ('honor_points', 'rank_score_1h'));

-- Step 2: honor_points is now written ONLY by the server (service role) —
-- server/combat-resolver.js (PvP) and server/actions/pve-attack.js (PvE).
-- The client-side write path (RankingService.addHonor) has been removed
-- from the codebase, so block direct client writes the same way
-- 'players'/'lords'/'cities'/'armies' are already blocked, closing off what
-- was previously a way for a client to set their own honor to any value
-- by writing to Supabase directly instead of playing a battle.
DROP POLICY IF EXISTS "storage_write_nonsensitive"  ON storage;
CREATE POLICY "storage_write_nonsensitive" ON storage
  FOR INSERT
  TO authenticated
  WITH CHECK (
    player_id = auth.uid()
    AND key NOT IN ('players', 'lords', 'cities', 'armies', 'honor_points')
  );

DROP POLICY IF EXISTS "storage_update_nonsensitive" ON storage;
CREATE POLICY "storage_update_nonsensitive" ON storage
  FOR UPDATE
  TO authenticated
  USING (
    player_id = auth.uid()
    AND key NOT IN ('players', 'lords', 'cities', 'armies', 'honor_points')
  )
  WITH CHECK (
    player_id = auth.uid()
    AND key NOT IN ('players', 'lords', 'cities', 'armies', 'honor_points')
  );

-- Verify: this query should show 'honor_points' in the read policy's USING
-- clause, and absent from the write policies' allowed keys.
-- SELECT policyname, cmd, qual, with_check FROM pg_policies WHERE tablename = 'storage';
