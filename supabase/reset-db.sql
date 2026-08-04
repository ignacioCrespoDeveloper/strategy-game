-- =============================================
--  reset-db.sql — Wipes ALL game data (SQL editor version)
--
--  This is the paste-into-the-dashboard twin of ../reset-db.js. Use whichever
--  you prefer; they clear exactly the same tables in exactly the same order.
--    · reset-db.js  → run from a terminal:  node reset-db.js --yes
--    · this file    → Supabase Dashboard → SQL Editor → paste → Run
--  Do NOT paste reset-db.js into the SQL editor — it is JavaScript, and
--  Postgres reports it as `42601: syntax error at or near "//"`.
--
--  !! IRREVERSIBLE — there is no backup and no undo. Every player must
--     register again from scratch. !!
--
--  ── DELETION ORDER IS LOAD-BEARING ────────────────────────────────────
--  Four tables carry foreign keys into auth.users with NO cascade, so
--  auth.users MUST go last or the delete fails outright on the FK:
--      battle_reports.attacker_id / .defender_id → auth.users(id)
--      clans.leader_id                           → auth.users(id)
--      clan_wars.declared_by                     → auth.users(id)
--      storage.player_id / pending_events.player_id
--  And clan_wars must precede clans: clan_wars.clan_a_id/clan_b_id are
--  `on delete cascade`, so clearing clans first would silently take the wars
--  with it and report a misleading 0 rows.
--
--  ── ALWAYS SCHEMA-QUALIFY public.storage ──────────────────────────────
--  Supabase ships a built-in `storage` SCHEMA (for file uploads) alongside
--  this game's `public.storage` TABLE. Unqualified `DELETE FROM storage`
--  depends on search_path to disambiguate. Qualify it and the ambiguity
--  cannot bite.
-- =============================================


-- ── STEP 1 — DRY RUN. Run this alone first. It deletes nothing. ──────────
-- Confirms the blast radius, and that every table below actually exists on
-- this project (the clan/battle tables are migration-gated).

SELECT 'storage'        AS table_name, count(*) AS rows_to_delete FROM public.storage
UNION ALL SELECT 'world_state',    count(*) FROM public.world_state
UNION ALL SELECT 'battle_reports', count(*) FROM public.battle_reports
UNION ALL SELECT 'clan_wars',      count(*) FROM public.clan_wars
UNION ALL SELECT 'clans',          count(*) FROM public.clans
UNION ALL SELECT 'pending_events', count(*) FROM public.pending_events
UNION ALL SELECT 'auth.users',     count(*) FROM auth.users
ORDER BY table_name;


-- ── STEP 2 — THE WIPE. Only run this once Step 1 looks right. ───────────
-- Wrapped in a transaction: if any statement fails (a missing table, an FK
-- you did not expect), the whole thing rolls back and you are left exactly
-- where you started rather than half-reset.

BEGIN;

  DELETE FROM public.battle_reports;   -- FK → auth.users, no cascade
  DELETE FROM public.clan_wars;        -- FK → clans (cascade) + auth.users
  DELETE FROM public.clans;            -- FK → auth.users, no cascade
  DELETE FROM public.pending_events;
  DELETE FROM public.storage;          -- schema-qualified on purpose, see above
  DELETE FROM public.world_state;      -- shared tile map + founded-city registry

  -- Last. auth.identities / sessions / refresh_tokens cascade off this.
  DELETE FROM auth.users;

COMMIT;


-- ── STEP 3 — verify. Every row should read 0. ───────────────────────────

SELECT 'storage'        AS table_name, count(*) AS remaining FROM public.storage
UNION ALL SELECT 'world_state',    count(*) FROM public.world_state
UNION ALL SELECT 'battle_reports', count(*) FROM public.battle_reports
UNION ALL SELECT 'clan_wars',      count(*) FROM public.clan_wars
UNION ALL SELECT 'clans',          count(*) FROM public.clans
UNION ALL SELECT 'pending_events', count(*) FROM public.pending_events
UNION ALL SELECT 'auth.users',     count(*) FROM auth.users
ORDER BY table_name;
