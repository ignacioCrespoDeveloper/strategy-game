-- battle_reports: PvP combat history table.
--
-- NOTE: This table was created manually in the Supabase project during Phase 1
-- testing. This file documents the canonical schema for reproducibility.
--
-- Run once in the Supabase SQL Editor if starting from scratch:
--   supabase/migrations/battle_reports.sql
--
-- Writes are performed server-side via the service role key (bypasses RLS).
-- Authenticated clients can only SELECT battles they participated in.

create table if not exists public.battle_reports (
  id               uuid        primary key default gen_random_uuid(),
  attacker_id      uuid        not null references auth.users(id),
  defender_id      uuid        not null references auth.users(id),
  attacker_lord_id text        not null,
  defender_lord_id text        not null,   -- primary defender lord id (first found on tile)
  tile_x           int         not null,
  tile_y           int         not null,
  terrain          text        not null,
  winner           text        not null,   -- 'attacker' | 'defender' | 'draw'
  reason           text        not null,   -- 'eliminated' | 'routed' | 'retreated' | 'max_rounds'
  rounds           int         not null,
  report_json      jsonb       not null,   -- full BattleReport including events log
  created_at       timestamptz not null default now()
);

alter table public.battle_reports enable row level security;

-- Participants (attacker or defender) can read battles they were part of.
create policy "Participants can read their battles"
  on public.battle_reports
  for select
  using (
    attacker_id = auth.uid()
    or defender_id = auth.uid()
  );

-- No INSERT/UPDATE/DELETE policy for authenticated users.
-- Only the service role key (server) can write — this is enforced by the
-- absence of an INSERT policy, not by an explicit deny.
