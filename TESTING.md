# Hexfront — Battle / Movement Integration Testing

This covers the multi-account movement + combat loop: moving, direct attacks,
multi-defender battles (city garrison + several defending lords), lord
capture/ransom/release, questing, scouting, and raiding (including a raid
interrupted by an arriving enemy).

## Economy engine tests (fast, no server needed)

```bash
node scripts/test-economy.js
```

Verifies the OGame-style economy (post-overhaul, see ECONOMY-OVERHAUL.md):
building categories, OGame production/cost curves, the water (energy)
factor, complete iron removal, and — most importantly — that server
offline catch-up (`server/tick/catch-up.js`) produces the SAME numbers as
the shared `EconomyCore` the client uses. Runs in ~1s, purely in-process
(loads the real defs via `server/engine-loader.js`). Run it after touching
`js/data/buildings.js`, `js/domain/economy-core.js`, or `catch-up.js`.

## Race & strategy balance simulation (fast, no server needed)

```bash
node scripts/test-balance.js
```

Builds an army for every race × strategy archetype (swarm / elite /
balanced-combined-arms / blocks-regiments) under the same gold budget and
PWR cap, at THREE progression stages (start / midgame / endgame), then runs
a full round-robin through the REAL battle engine (96 fights per pair per
direction — below ~40 reps the engine's randomness swings a combo's win
rate by ±5 points, more than the effects being tuned). Thresholds it
enforces (regression guards; race band per Nacho's 2026-07-29 rule):

- every race's pooled win rate within **38–62%** at EVERY stage
  (design target 40–60; the extra ±2 absorbs sampling noise)
- no endgame race+strategy combo above **74%** or below **25%**

Run it after touching `js/data/units.js` combat stats/traits,
`EconomyCore.getUnitPower`'s trait tax table, or anything in
`js/domain/battle-*.js`. Two hard-won tuning notes: (1) in a PWR-capped
matchup, flat stat changes mostly self-neutralize (the unit gets cheaper or
pricier in step) — the real levers are the trait tax weights and genuine
engine mispricings; (2) the pre-battle terror/fear morale hit is capped at
−25 per side in `battle-morale.js` — uncapped, double-terror armies routed
everyone before round 1.

The script has a `DEFERRED_RACES` escape hatch: a race listed there
reports an out-of-band result as a ⏭ skip instead of a failure. It is
currently EMPTY (the Dark Elves review landed 2026-07-27 — root cause was
speed being over-weighted in the PWR formula, fixed to ×0.5 in
`EconomyCore.getUnitPower`). Only add a race with an explicit design
decision to defer it.

## Army transfer core tests (fast, no server needed)

```bash
node scripts/test-army-transfer.js
```

Unit-tests the stack math behind `POST /api/army/transfer` (the same-tile
troop exchange between two of a player's lords). `server/army-transfer-core.js`
is deliberately import-free so these run with plain node in <1s: partial
moves take fresh models first, the wounded front model only travels when
asked for (or the whole stack moves), merging two wounded stacks keeps the
lower HP (no damage-washing), and duplicate move rows can't overdraw a
stack in aggregate. Run it after touching `army-transfer-core.js` or
`server/actions/army-transfer.js`.

## Running it

```bash
npm start                              # dev server must be running (separate terminal)
node scripts/test-battle-movement.js
```

The script creates **5 real, disposable Supabase accounts** (Alice, Bob,
Carol, Dave, Eve), drives them through the actual `/api/*` endpoints the
real client uses (plain HTTP, no browser), asserts on the results, prints a
pass/fail/skip summary, then **deletes every account, its game data, and its
map tiles again** — nothing is left behind in the Supabase project. It reads
`server/.env` for credentials, same file the dev server itself uses.

A full run takes **~3 minutes** — two of the scenarios wait out a real
travel timer on purpose (see "What's real vs. instant-finished" below)
rather than only exercising the credits-based shortcuts.

## What's covered

| # | Scenario | Accounts | How it's triggered |
|---|---|---|---|
| 1 | Movement | Eve | Plain move, real travel wait, verified via `/api/sync` + a direct storage read |
| 2 | Direct attack | Alice → Bob's city | The *real* flow: `move` with `intent:'attack'` (min 60s), real wait, drained via `/api/sync` — not the `/api/pvp/resolve` shortcut, since this is what an actual player experiences |
| 3 | Multi-defender battle | Dave → Bob + Carol (co-defending) + Bob's city garrison | `/api/pvp/resolve` (instant) — asserts `report._meta.defenderGroups` has both lords and `report._meta.garrison` is set |
| 4 | Lord capture → ransom / release | Whoever Dave eliminates in #3 | `/api/lord/ransom` (owner pays) and `/api/lord/release` (captor frees for free) — **RNG-dependent**, see below |
| 5 | Quest (Search Area) | Eve | `search_area` → `/api/lord/instant-action` → `/api/lord/quest-resolve` |
| 6 | Scout | Dave scouts Bob's tile | `scout` → `/api/lord/instant-action` → `/api/lord/scout-resolve` |
| 7 | Raiding | Dave on a neutral tile | `/api/lord/raid-start` → `/api/lord/raid-instant` (full-duration payout, no real wait) |
| 8 | Raid interrupted by an arriving enemy | Eve arrives on Dave's raid tile | A **distance-0 move** (Eve "moves" to the tile she's already on) — this is the one legitimate way to force `pendingArrivalCheck` without a real wait, since `/api/lord/instant-action` explicitly bypasses that check (see gotcha below) |

### Why each scenario is built the way it is (gotchas found while writing this)

- **Army-less lords don't exist for combat, defender AND arriver side.**
  Both Test 3 (defenders) and Test 8 (the arriving lord) needed at least one
  hired mercenary before the fight/interrupt would trigger at all — a
  lord with zero army is invisible/unattackable *and* incapable of
  triggering an arrival-check fight. This is a real, working design rule
  (`combat-resolver.js`), not a bug — the script hit it twice while being
  written, which is exactly the kind of thing worth writing down here.
- **`/api/lord/instant-action` (the credits-based instant-finish) skips
  `catchUp`'s `pendingArrivalCheck`/`pendingDiscoveries` set-up for plain
  moves.** It's the right tool for *repositioning* a lord fast (used
  throughout for setup), but the wrong tool whenever the move itself needs
  to trigger something on arrival (raid interception). Test 8 works around
  this with a distance-0 move, which resolves for free on the very next
  `catchUp` call while still going through the real code path.
- **The background dispatcher (5s `setInterval` in `server/index.js`) can
  race an explicit `/api/sync` call.** Test 2 originally asserted on
  `/api/sync`'s `events` array, which came back empty on one run because the
  dispatcher had already resolved the fight moments earlier. Fixed to assert
  on the durable `pendingPvpAttack === null` state instead of the
  ephemeral "events since last call" array.
- **Stance alone can't prove a raid-interrupt fight happened.** Both "no
  fight was triggered" and "Dave won the fight" leave `stance.id ===
  'raiding'`. Test 8 instead checks for the `pvp_result` activity-feed entry
  `_resolveCore` unconditionally writes for both sides — present regardless
  of who wins, absent if no fight ran at all.

### RNG-dependent outcomes (Test 4)

Whether Bob and/or Carol actually get *captured* (vs. merely defeated, or
surviving) depends on real battle math — Dave is stacked with 5 mercenaries
to favor a win, but a capture specifically requires that defender's own
lord unit to be fully eliminated, not just the battle lost. The script
checks the outcome and gracefully skips the ransom/release assertions with
a clear reason when no capture happened, rather than failing the whole run
over combat variance. Re-running enough times will eventually hit a
capture; if you want this deterministic, the ransom/release *endpoints*
themselves (`server/actions/lord-ransom.js`/`lord-release.js`) can be
called directly against a lord you've manually confirmed is captured
(e.g. via the admin/service-role Supabase client already set up in the
script) instead of depending on live combat RNG.

## History note: the Ambush stance (found broken 2026-07-25, removed 2026-07-29)

This suite originally documented a known gap: the Ambush stance could never
be observed server-side by anyone. Entering it only mutated `localStorage`
(`js/core/storage.js`'s `SERVER_KEYS` skips syncing `'lords'` writes), no
`raid-start`-style endpoint existed to write it server-side, and
`resolveScout()` — the only consumer — read the Supabase `lords` row that
never carried it. The stance was a silent no-op sold to the player.

The design call (2026-07-29) was to **remove the stance entirely** rather
than build the missing endpoint: ambushes now exist only as the PvE
expedition outcome (`server/tick/catch-up.js`'s `_resolveAmbush`), which
Test 5's quest path exercises. `resolveScout()` no longer intercepts anyone —
scouting is always safe and always returns intel.

## Known gap: `/api/army/transfer` has no integration test yet (2026-07-28)

The same-tile troop exchange (`server/actions/army-transfer.js`) ships with
unit tests only for its math core: `server/army-transfer-core.js` is
deliberately import-free so damaged-model/merge edge cases can be tested with
plain node (no server, no Supabase). The endpoint's *validation* layer (same
tile, not downed/busy/stanced, PWR cap incl. training queues, legendary level
gate) is untested end-to-end. A natural scenario for this suite: give one
account two lords on one tile, transfer a stack, assert both `armies` rows via
`readStorage()`, then assert a transfer to a lord one tile away is refused.

## Extending this suite

The script is intentionally one flat `main()` with clearly labeled
`section(...)` blocks per scenario — add a new scenario by copying the
shape of an existing one (setup → action → `readStorage()` or response-based
assertion → `assert(...)`). `readStorage(playerId, key)` is a service-role
read of any account's own storage rows and is the most reliable way to
assert on a DIFFERENT account's state than the one that made the API call
(no `/api/*` route exposes another player's full lord/army data by design).
