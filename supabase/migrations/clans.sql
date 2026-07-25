-- clans: alliance/clan groups. One clan per player, max 5 members per clan.
--
-- Run once in the Supabase SQL Editor:
--   supabase/migrations/clans.sql
--
-- Writes are performed server-side via the service role key (bypasses
-- RLS) — membership changes need server validation (name/tag uniqueness,
-- the 5-member cap, one-clan-per-player, leader-only kick/disband), so
-- clients can't be trusted to write directly. Any authenticated user can
-- browse (SELECT) every clan, same as the public rank_score leaderboard —
-- needed so the client can show a joinable clan list and every member's
-- name once you're in one.

create table if not exists public.clans (
  id         text        primary key,
  name       text        not null unique,
  tag        text        not null unique,
  leader_id  uuid        not null references auth.users(id),
  members    jsonb       not null default '[]'::jsonb,  -- [{ playerId, username }], max 5
  created_at timestamptz not null default now()
);

alter table public.clans enable row level security;

create policy "Anyone can read clans"
  on public.clans
  for select
  to authenticated
  using (true);

-- No INSERT/UPDATE/DELETE policy for authenticated users.
-- Only the service role key (server) can write.
