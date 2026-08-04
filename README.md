# ⚔️ Hexfront — Age of Lords

A browser-based, persistent multiplayer strategy game: hex world map, per-lord
armies, city building, a full battle engine, PvP/PvE combat, rankings, and
clans/wars. Vanilla HTML/CSS/JS on the client (no framework, no build step),
backed by a Node/Express server and Supabase (Postgres + Auth) for
authoritative, always-on game state.

> This README covers the current architecture. For what's planned next, see
> **[ROADMAP.md](ROADMAP.md)**.

---

## 🚀 Quick start

```bash
npm install
cp server/.env.example server/.env   # fill in your Supabase project's URL + keys
npm start                            # node server/index.js
```

Then visit `http://localhost:3000`. `npm run dev` runs the same server with
`--watch` for auto-restart on file changes.

You'll need a [Supabase](https://supabase.com) project with:
- Auth enabled (email/password is on by default; Google sign-in needs the
  provider configured in the Supabase dashboard — see ROADMAP.md item 8)
- The SQL in `supabase/migrations/` and `supabase/rls-*.sql` applied, in
  order, via the Supabase SQL Editor

## 🎮 How to play

Register (or sign in), pick a race, then:

| Action | How |
|---|---|
| **Create a lord** | Lords screen → Create Lord (choose a class) |
| **Found a city** | Move a lord to an empty tile → Found City |
| **Build / upgrade** | Enter a city → Build panel |
| **Recruit units** | Requires the matching building (Barracks, Stable, etc.) |
| **Move / attack** | Map screen → select a lord → click a destination tile |
| **PvE combat** | Ambushes — a combat expedition find is fought on the spot, server-side |
| **PvP combat** | Move a lord onto an enemy tile — combat resolves server-side |
| **Expeditions** | Lord → Send on Quest → pick Short/Standard/Long, confirm, wait it out (or finish instantly with credits) |
| **Clans** | Clan screen → create/apply/accept, declare wars on rival clans |
| **Battle Simulator** | Theorycraft any matchup without spending real armies |

Game state is authoritative on the server — every meaningful action (build,
recruit, move, attack, recruit into a clan, etc.) is validated and applied via
a `POST /api/...` endpoint backed by the Supabase service-role key, not the
client. The client is a view over that state plus optimistic UI.

---

## 📁 Project structure

```
strategy-game/
├── index.html              # Entry point — loads every script in dependency order
├── css/app.css              # All styles (single stylesheet)
├── assets/                  # Lord portraits, unit art, terrain, building icons
│
├── js/
│   ├── core/                 # config, supabase client, storage, events, time, a11y, toast
│   ├── data/                 # Static defs: races, units, buildings, discoveries, items,
│   │                         #   lord classes + talents, honor tiers, stances, traits...
│   ├── domain/                # Client-side game logic: lord, city, army, battle-engine,
│   │                         #   discovery, ranking, clan, visibility, intelligence...
│   ├── services/              # server-actions.js — thin wrappers around every /api/* call
│   └── ui/                    # One file per screen: map-view, city-view, lord-screen,
│                             #   overview-screen, ranking-screen, clan-screen, hud, nav...
│
├── server/
│   ├── index.js               # Express app — route table for every authoritative action
│   ├── asset-version.js        # Build id (newest mtime in js/ + css/); index.html is
│   │                          #   served stamped so every asset URL carries ?v=<build>.
│   │                          #   Never add version query strings by hand.
│   ├── action-base.js          # Shared load/catch-up/save helpers used by every action
│   ├── combat-resolver.js      # The PvP/PvE battle resolution core (_resolveCore)
│   ├── sync.js                 # POST /api/sync — offline catch-up on login
│   ├── engine-loader.js        # Loads the shared battle engine + data defs for server use
│   ├── actions/                # One file per authoritative action (build, recruit, lord-*,
│   │                          #   city-*, clan-*, raid-*, quest-resolve...) — 30 files
│   └── tick/                   # Background loops: ranking-updater, clan-war-updater,
│                              #   event-dispatcher, catch-up
│
└── supabase/
    ├── migrations/              # SQL migrations (clans, clan_wars, battle_reports...)
    └── rls-*.sql                # Row-level security policies for public/shared tables
```

Almost all persistent state lives in a single generic `storage` table
(`player_id`, `key`, `value`), keyed per-player (lords, cities, armies,
players, honor_points, activity_feed...). **Clans** are the one exception —
the first entity genuinely shared across multiple players at once — so they
get their own dedicated `clans` / `clan_wars` tables instead.

### Core mechanics today
- **Economy (OGame model)** — wood/stone/food production on OGame curves,
  gold from population, water/hygiene as the energy analogue, march food
  cost per tile (the deuterium role), Library research books, Town Hall as
  the nanite-style build accelerator. One formula source for everything:
  `js/domain/economy-core.js` (EconomyCore), loaded by browser AND server.
- **Armies & PWR** — units cost ONLY gold, priced by formula
  (`gold = PWR × 3.5 × tier premium`); the sole army constraint is the PWR
  cap (200 + 80×lord level, **frozen at level 10** = 1000). PWR = stats + a weighted tax for every combat
  trait, linear per model. No upkeep of any kind. Veterancy: +2% atk/def per
  training-building level summed across all cities.
- **Units** — 5 races × ~13-unit TWW3-style rosters gated by building levels
  (Barracks/Archery/Stables chains up to Monster Pit and Dragon Lair), each
  race with a distinct progression curve (every race within 40–60% at
  every stage since 2026-07-29) and race-exclusive combat traits
  (stubborn/berserk for dwarfs, accurate/duelist for High Elves, dodge for
  Dark Elves, discipline for the Empire, aggressive/impact for orcs).
- **Lords** — classes (Warrior/Mage/Rogue/Priest...), leveling to **20**, and
  **four talents** picked one at a time at levels 5/10/15/20 (all four combat
  talents mechanically live), stances (idle, raiding). Levels 1–10 are the
  power curve (army PWR cap, raid rate, expedition loot, all frozen at 10);
  levels 11–20 buy the lord's own stats and the last two talent slots.
- **Cities** — building tiers, production, population/growth status, a
  building-derived garrison (see ROADMAP.md #3 for what's still missing here).
- **Battle Engine** — phased resolution (ranged → charge → melee → morale)
  over up to 15 rounds; ~24 implemented traits; overkill spillover (×0.5
  per hop in contact phases, ×0.3 single-hop for ranged); mass-scaling
  formation bonuses (shield_wall ranks, charge wedge) so deep regiments
  compete with one-of-each variety; frontline screening with round-3+
  breakthrough; power-based morale with terror/fear capped per side;
  near-tie grinds end in an honest draw. A standalone Battle Simulator
  theorycrafts matchups.
- **PvP & PvE** — attacking enemy lords/cities, and expedition ambushes
  resolved where they happen; honor points swing based on power destroyed vs.
  the opponent's strength, and are a PvP-only reward (PvE grants none).
- **Rankings** — 5-tab leaderboard (Overall/Infrastructure/Lords/Militar/
  Honor), computed from a documented point formula.
- **Clans & Wars** — create/apply/leader-approve/kick, a member roster with
  honor + ranking points, and time-boxed clan-vs-clan wars scored by power
  destroyed; allies (same clan) can't attack each other.

### Tuning the economy

**`js/data/tuning.js` is the file to edit when the game feels too fast or too
slow.** Seven plain multipliers — one per income or time channel — all shipping
at `1.0`:

| Dial | Channel |
|---|---|
| `buildingProduction` | Economy from buildings (the 3 resource buildings) |
| `populationGold` | Gold from population (city tax) |
| `raidGold` / `raidResources` | Gold / resources from raiding |
| `questGold` / `questResources` | Gold / resources from questing (finds **and** ambush loot) |
| `travelTime` | Lord travel time (>1 = slower) |

Change one, then run `node scripts/economy-projection.js` — it prints the dials
first, then how many days a daily-active player needs to buy everything, and
flags anything off target. Costs are deliberately *not* in this file; they live
with the things they price.

### Tests & live dashboards
```bash
node scripts/run-all-tests.js        # all three suites → test-results.json
node scripts/test-economy.js         # 134 checks, in-process, ~1s
node scripts/economy-projection.js   # pacing model — days-to-buy-everything
node scripts/test-balance.js         # staged balance sim (start/mid/end), ~20s
node scripts/test-battle-movement.js # live 5-account integration, ~3 min
node scripts/generate-army-guide.js  # rebuild army-guide.html from the sim
```
With the dev server running: **test-status.html** (live suite dashboard) and
**army-guide.html** (race matchup matrices per game stage + top army
compositions) are served at the server root. See `TESTING.md` for details.

---

## 🐛 Known issues

| # | Area | Description | Status |
|---|---|---|---|
| 1 | Quests | **Two related quest failures, treat as one investigation.** (a) Finishing a quest with credits **on the same tile** the lord is already on does nothing; moving to a different tile first works. (b) Quests occasionally **complete with no reward, discovery, or feedback at all**. Likely the same root cause, but (b) may not be limited to the credit-finish path. Needs repro details next time: timer- vs credit-finish, and whether the lord was on the quest's tile. **Still unreproduced as of 2026-08-03** — but the neighbouring defect in the same endpoint was found and fixed that day (`/api/lord/instant-action` skipped `catchUp` for plain moves, so a credit-finished march never set `pendingArrivalCheck`), and quest results now carry their real completion time, so a fresh repro will read honestly in the Activity feed instead of claiming everything happened at login. | **Open — needs a repro** |
| 2 | Navigation | Intermittent, not yet reproduced on demand: after receiving a PvP attack notification while defending, the app redirects to Overview and every subsequent navigation click shows a loading state (`_goto`'s `⚔ SYNCING…` screen in `js/ui/app.js`) then bounces back to Overview instead of reaching the clicked screen — effectively stuck on the home screen. Reported once (2026-07-25) by a defender being tested against for the lord-capture feature; not confirmed whether it's specific to a captured-lord state or a pre-existing bug in the HUD's cross-screen PvP-alert polling (`js/ui/hud.js` `_pollActivityFeed`/`pvp:alert` → `overview-screen.js` `_onPvpAlert`) reacting while another screen is mounted. **Next time it happens:** open DevTools → Console immediately and capture any red error/stack trace — that pins down whether it's a thrown exception in a screen's render or an EventBus subscription leak keeping Overview's `pvp:alert` listener attached after navigating away. | **Open, not reproduced on demand** |
| 3 | Data | **Existing accounts are stale after the 2026-07-27 economy/roster overhaul**: they hold pre-formula gold prices, units that changed stats/traits, levels in buildings that no longer exist, and pre-overhaul wallets. A database reset (`reset-db`) is required before any honest playtesting. | **Open — blocks playtesting** |
| 4 | Combat/UI | Battles can now legitimately end in a **draw** (max-rounds within a 10% power margin) and this happens more often than before. `_resolveCore`/battle-report UI handle `winner: 'draw'` from before, but the downstream flows (honor, loot, capture, report wording) haven't been re-verified since draws became common. | **Deferred** — design call 2026-07-29: draws are acceptable as-is; re-verify only if odd draw outcomes surface in play |
| 5 | Cleanup | Legacy `checkIncomingAttacks` in `server/combat-resolver.js` is unrouted dead code (superseded by `scanIncomingAttacks`); `/api/debug/lords` is still an unauthenticated debug endpoint. (`armyWeight` fully removed 2026-07-27 — the legendary lord-level gate now keys off `category === 'legendary'`.) | **Open** — see ROADMAP.md #9 |
| 7 | PvP loot | ✅ **FIXED 2026-08-03.** The sack is now sized against the defender's *projected* pool — `_projectedResources` runs the real `catchUp` on a throwaway copy (it deep-copies its input, so no clock is advanced and nothing is mutated) and `_lootQuote` takes its 5% of that. The deduction still comes off the stored pool, which is what keeps it safe: advancing the victim's clocks would require persisting their `cities`, which this resolver does not write, and missing that would credit the same production twice on their next sync. A long-idle victim's stored balance can therefore go briefly negative, and that is correct — their own catch-up still credits production from their untouched `lastResourceUpdate`, landing them at exactly (true pool − loot). The scout preview was given the same projection so it cannot promise less than the attack delivers. Measured effect: active player 1.0× (unchanged), 7-city empire idle 3d **2.6×**, idle 7d **4.8×**, idle 14d with a thin snapshot **29.9×**. Original report follows. **Sacking an inactive player loots almost nothing, and the emptier their inbox the poorer the prize.** `_resolveCore` loads every defender's `players` row **raw from Supabase** (`combat-resolver.js:1034`) and never runs `catchUp` on it, while `_lootQuote` takes 5% of `defenderPlayer.resources` as stored. A player's resources are only written when *they* act — their own sync, one of their own actions, or the event dispatcher draining a pending event of theirs — so an idle player's stored pool is frozen at whatever it was when they last played. Loot therefore scales with **how recently the victim logged in**, not with what they own: a defender three days idle is sitting on ~3.9M of uncredited production at endgame rates, and the sack takes 5% of the frozen number instead. Reported from live play 2026-08-03. Fix direction: `catchUp` the city owner before quoting the loot — the resolver already loads that player's `lords`, `cities` and `armies` in the same batched query, so the inputs are all there; the risk to handle is double-crediting if the victim syncs concurrently. | **Fixed 2026-08-03** |
| 6 | Design debt | Several unit traits shown in tooltips/tech tree are still **flavor-only** (no engine effect): `splash_damage`, `poison`, `siege`, `fast`, `veteran`, and the `abilities` entries (`web_trap`, `venom_bite`, `fire_breath`, `dragon_breath`, `sky_dive`). (`scout` came off this list 2026-07-28 — it now counts double toward Expedition Rating; `berserk`, `aggressive`, `impact`, and `discipline` came off 2026-07-29 in the balance band pass.) Players may reasonably expect them to do something. Either implement (the 2026-07-27 pattern: implement + PWR tax) or hide from the UI. | **Open** — adopted onto the roadmap 2026-07-29, see ROADMAP.md |

> **Recently resolved** (2026-07-27): unit gold/PWR pricing formula + drift-guard;
> `double_strike`/`pyroblast` talent hooks; the dead weight/slot system in
> `recruitment.js`; broken race-selection portrait paths (`races.js`); the
> unreachable catastrophic-hygiene branch in `getPopGrowthRate`; unit art for
> the full recruitable roster (all 5 races complete; only garrison NPCs and
> most mercenaries still use icon fallbacks). Stage balance after the
> 2026-07-29 band passes: **every race sits within 40–60% at every stage**
> (gated by the suite at 38–62); the peaks that remain — High Elves at
> start (~57), orcs at mid (~57) — are racial identity inside the band,
> not bugs.

> **Recently resolved** (2026-07-28/29): unit healing shipped (15% battle-win
> heal + 1%/min idle garrison regen in `catch-up.js`); quests reworked into
> OGame-style **Expeditions** (shared `discovery-roll.js` roll math, lengths,
> tile depletion, army footprint, immediate ambushes, ER-gated recruits **and
> ER-gated find quality** with a ~2× reward pump on top — bandit camps
> retired); the `scout` trait implemented via Expedition Rating;
> the non-functional **Ambush stance removed from the game** (ambush lives on
> only as the expedition outcome — scouting can no longer be intercepted).

---

## 🗺️ Roadmap

See **[ROADMAP.md](ROADMAP.md)** for the full plan: lord capture/fallen,
city conquest, garrisons, army balance, talent fixes, quest rebalance, a UI/
asset pass, Google login, a cleanup sprint, and a player wiki — with current-
state notes, concrete steps, and suggested ordering for each.
