# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

A solo player who controls a persistent "Lord" character inside a shared, server-authoritative multiplayer world. Play happens in short, async check-ins rather than one continuous sitting: send a Lord to explore a tile or complete a quest, then return later to collect the result. Within a session the player explores tiles, fights bandit camps, attacks or is attacked by other players' Lords (PvP), recruits armies, and founds/develops cities.

## Product Purpose

Hexfront is a grand-strategy game where politics, economy, and warfare are meant to carry equal weight — not a combat-only hex wargame. Progress persists on the server (Supabase) between sessions, and the world keeps advancing (server ticks, other players' actions) whether or not the player is currently online.

## Positioning

A fantasy grand-strategy game built around a roster of distinct playable races — Human, Dwarf, Orc, High Elf, and Dark Elf confirmed so far, each with different economic/growth bonuses (e.g. Dwarves build faster and mine more stone/iron; Orcs out-breed everyone; Dark Elves out-produce iron and grow population fast) — set in a persistent, server-authoritative multiplayer world rather than a single local session. Race choice is meant to bend a player's economic/growth curve, not just reskin combat stats.

Goblins currently exist in the codebase (units, quests, discoveries) as world/enemy content, not as a selectable player race — **undecided**: confirm whether Goblin should become a playable race alongside the others.

## Operating Context

- Client: vanilla HTML/CSS/JS, no framework, no build step, canvas-based hex map renderer.
- Server: Express/Node backend (`server/`), Supabase for persistence and as the authority for players, lords, cities, and armies.
- Core loop is async: quests/marches/attacks are enqueued client-side and resolve via server ticks or dedicated resolve endpoints (e.g. `/api/pvp/resolve`), not instantly in the browser.
- Credits system lets a player pay to instant-finish an in-progress Lord action or recruitment.
- Rankings are point-based across buildings, Lord level, quests, PvP wins, and conquests, shown in sub-tabs (Overall / Cities / Lords / PvP / Quests).

## Capabilities and Constraints

- Multiplayer, server-authoritative: Express + Supabase backend, vanilla JS client with no build tooling.
- Confirmed playable races: Human, Dwarf, Orc, High Elf, Dark Elf — each defined by flat production/growth bonuses (`js/data/races.js`), not combat stats.
- Goblin: present in world content (enemies, quests) — not confirmed as a playable race (see Positioning).
- Core systems live: tile exploration/quests, bandit-camp combat, PvP attack-move + resolve, city founding/development, unit recruitment, credits (pay-to-finish), rankings.

## Product Principles

1. Politics and economy must matter as much as warfare — no feature should reduce the game to combat-only optimization.
2. Race identity comes from economic/growth bonuses, not power creep — a race should change how a player builds and grows, not just how hard their army hits.
3. The world is persistent and asynchronous — design for "check in, act, come back later," not for a player sitting through a full session in one sitting.
4. New content should extend the existing race/economy framework (flat bonus keys read by domain services) rather than introducing parallel systems.
