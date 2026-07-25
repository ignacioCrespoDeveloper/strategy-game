-- clans_v2: adds join-request approval + clan-vs-clan wars on top of the
-- original clans.sql (already applied). Safe to run again — every
-- statement is idempotent (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS).
--
-- Run once in the Supabase SQL Editor.

-- 1. Applications now go through leader approval instead of auto-joining —
--    'pending' holds applicants who haven't been accepted/rejected yet.
alter table public.clans
  add column if not exists pending jsonb not null default '[]'::jsonb; -- [{ playerId, username, appliedAt }]

-- 2. Clan-vs-clan wars — a time-boxed score race. Score accrues from
--    "power destroyed" in PvP battles between the two clans' members
--    (mirrors the existing honor-points power-destroyed formula, see
--    server/combat-resolver.js), for both city and lord fights. Whoever has
--    the higher score when ends_at passes wins (server/tick/clan-war-updater.js
--    checks this on the same kind of periodic tick as ranking-updater.js).
create table if not exists public.clan_wars (
  id             text        primary key,
  clan_a_id      text        not null references public.clans(id) on delete cascade,
  clan_b_id      text        not null references public.clans(id) on delete cascade,
  declared_by    uuid        not null references auth.users(id),
  started_at     timestamptz not null default now(),
  ends_at        timestamptz not null,
  score_a        numeric     not null default 0,
  score_b        numeric     not null default 0,
  status         text        not null default 'active', -- 'active' | 'ended'
  winner_clan_id text,
  created_at     timestamptz not null default now()
);

alter table public.clan_wars enable row level security;

drop policy if exists "Anyone can read clan wars" on public.clan_wars;
create policy "Anyone can read clan wars"
  on public.clan_wars
  for select
  to authenticated
  using (true);

-- No INSERT/UPDATE/DELETE policy for authenticated users on either table —
-- only the service role key (server) can write.
