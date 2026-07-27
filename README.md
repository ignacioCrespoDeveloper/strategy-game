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
| **PvE combat** | Attack a scouted bandit/monster camp from the map panel |
| **PvP combat** | Move a lord onto an enemy tile — combat resolves server-side |
| **Quests** | Lord → Search Area, wait out the timer (or finish instantly with credits) |
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
│   ├── data/                 # Static defs: races, units, buildings, discoveries,
│   │                         #   lord classes + talents, honor tiers, stances, traits...
│   ├── domain/                # Client-side game logic: lord, city, army, battle-engine,
│   │                         #   discovery, ranking, clan, visibility, intelligence...
│   ├── services/              # server-actions.js — thin wrappers around every /api/* call
│   └── ui/                    # One file per screen: map-view, city-view, lord-screen,
│                             #   overview-screen, ranking-screen, clan-screen, hud, nav...
│
├── server/
│   ├── index.js               # Express app — route table for every authoritative action
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
  cap (200 + 80×lord level). PWR = stats + a weighted tax for every combat
  trait, linear per model. No upkeep of any kind. Veterancy: +2% atk/def per
  training-building level summed across all cities.
- **Units** — 5 races × ~13-unit TWW3-style rosters gated by building levels
  (Barracks/Archery/Stables chains up to Monster Pit and Dragon Lair), each
  race with a distinct progression curve (dwarfs peak early, orcs mid,
  high elves late) and race-exclusive combat traits (stubborn, dodge,
  accurate, duelist...).
- **Lords** — classes (Warrior/Mage/Rogue/Priest...), leveling, talents
  (all four combat talents mechanically live), stances (idle, raiding,
  ambush — see Known Issue #5 on ambush).
- **Cities** — building tiers, production, population/growth status, a
  building-derived garrison (see ROADMAP.md #3 for what's still missing here).
- **Battle Engine** — phased resolution (ranged → charge → melee → morale)
  over up to 15 rounds; ~20 implemented traits; overkill spillover in
  contact phases; frontline screening with round-3+ breakthrough;
  power-based morale with terror/fear capped per side; near-tie grinds end
  in an honest draw. A standalone Battle Simulator theorycrafts matchups.
- **PvP & PvE** — attacking enemy lords/cities or bandit/monster camps;
  honor points swing based on power destroyed vs. the opponent's strength.
- **Rankings** — 5-tab leaderboard (Overall/Infrastructure/Lords/Militar/
  Honor), computed from a documented point formula.
- **Clans & Wars** — create/apply/leader-approve/kick, a member roster with
  honor + ranking points, and time-boxed clan-vs-clan wars scored by power
  destroyed; allies (same clan) can't attack each other.

### Tests & live dashboards
```bash
node scripts/run-all-tests.js        # all three suites → test-results.json
node scripts/test-economy.js         # 57 checks, in-process, ~1s
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
| 1 | Quests | Finishing a quest with credits **on the same tile** the lord is already on does nothing; moving to a different tile first works. Root cause not yet found. | **Open** — see ROADMAP.md #6 |
| 2 | Assets | Only 2 of 5 races declare a portrait path, and neither of those two files actually exists at the declared path — all 5 races likely render as emoji+gradient cards today. | **Open** — see ROADMAP.md #7 |
| 3 | Cleanup | `js/domain/recruitment.js`'s army-weight/slot-capacity system is dead code (superseded by the PWR-cap gate in `recruit.js`) but still present in the file. | **Open** — see ROADMAP.md #9 |
| 4 | Navigation | Intermittent, not yet reproduced on demand: after receiving a PvP attack notification while defending, the app redirects to Overview and every subsequent navigation click shows a loading state (`_goto`'s `⚔ SYNCING…` screen in `js/ui/app.js`) then bounces back to Overview instead of reaching the clicked screen — effectively stuck on the home screen. Reported once (2026-07-25) by a defender who was actively being tested against for the new lord-capture feature; not confirmed whether it's specific to a captured-lord state or a pre-existing bug in the HUD's cross-screen PvP-alert polling (`js/ui/hud.js`'s `_pollActivityFeed`/`pvp:alert` → `js/ui/overview-screen.js`'s `_onPvpAlert`) reacting while another screen is mounted. No browser console error was captured before the repro window closed. **Next time it happens:** open DevTools → Console immediately and capture any red error/stack trace — that's the fastest way to pin down whether it's a thrown exception in a specific screen's render (e.g. the new captured-lord branches in `overview-screen.js`/`lord-screen.js`/`map-view.js`) or a `_currentStop`/EventBus subscription leak letting Overview's `pvp:alert` listener stay attached (and re-render over whatever screen is currently showing) after navigating away from it. | **Open, not reproduced on demand** |
| 5 | Stances | Ambush stance can never actually be observed server-side by anyone. Entering it (`LordService.enterStance`, `js/domain/lord.js`) only mutates `localStorage` — `js/core/storage.js`'s `SERVER_KEYS` set includes `'lords'`, so that write is explicitly skipped from the Supabase sync queue and never reaches the server. `resolveScout()` (`server/combat-resolver.js`), the only code that checks for an ambushing lord, reads the Supabase `lords` row — which never has the ambush stance on it. Unlike raiding (`server/actions/raid-start.js`), there is no server endpoint to enter ambush at all. Found 2026-07-25 while writing `TESTING.md`'s integration test. | **Open** — needs a real `/api/lord/ambush-start`-style endpoint; see `TESTING.md` |
| 6 | Armies | **Units have no health regeneration.** Unit damage persists between battles (`combat-resolver.js` writes surviving stacks' `currentHp` back to the stored army after every fight) but nothing ever heals them: the only heal paths in the codebase are the raiding-stance passive full-heal (`server/tick/catch-up.js` §1d) and disbanding the damaged front model (`army-disband.js`). Lords regen 2% of maxHp per minute (`catch-up.js` §1b); units never regen at all. A wounded army stays wounded forever unless it raids. Reported 2026-07-27. | **Open** — see ROADMAP.md #4 |
| 7 | Quests | Reported 2026-07-27: **quests got completed without anything happening** — no reward, discovery, or feedback on completion. Possibly the same root cause as issue #1 (same-tile credit-finish), but this report suggests it may not be limited to the credit-finish path. Needs repro details next time it happens: timer-finish vs credit-finish, and whether the lord was on the same tile as the quest. | **Open** — see ROADMAP.md #6 |
| 8 | Data | **Existing accounts are stale after the 2026-07-27 economy/roster overhaul**: they hold pre-formula gold prices, units that changed stats/traits, levels in buildings that no longer exist, and pre-overhaul wallets. A database reset (`reset-db`) is required before any honest playtesting. | **Open — blocks playtesting** |
| 9 | Economy | `EconomyCore.getPopGrowthRate` has an **unreachable branch**: `else if (hygiene < 25) −0.10; else if (hygiene < 10) −0.25` — the `< 10` case can never fire because `< 25` catches it first. Cities with catastrophic hygiene are under-penalized (−0.10 instead of −0.25). One-line fix: swap the order of the two branches. | **Open** — trivial fix |
| 10 | PvE | Bandit/monster camps got **effectively stronger** on 2026-07-27: linear stack damage and the monster ×1.3 multiplier apply to camp defenders too, but camp level curves (`_rollCampDetails`, `CAMP_DEFS` rosters) were tuned before the overhaul. Camp difficulty needs a playtest pass. | **Open** |
| 11 | Combat/UI | Battles can now legitimately end in a **draw** (max-rounds within a 10% power margin) and this will happen more often than before. `_resolveCore`/battle-report UI handle `winner: 'draw'` from before, but the flows (honor, loot, capture, report wording) haven't been re-verified since draws became common. | **Open — verify** |
| 12 | Assets | Units still missing art (icon fallback): **Halberdiers** (human), **Sisters of Slaughter** (dark elf), plus the garrison NPCs (city_guard, militia_archer, garrison_soldier) and most mercenaries. | **Open** |
| 13 | Cleanup | Legacy `checkIncomingAttacks` in `server/combat-resolver.js` is unrouted dead code (superseded by `scanIncomingAttacks`); `/api/debug/lords` is still an unauthenticated debug endpoint; `armyWeight` is a near-dead field (only gates lord level ≥12 for weight-12 units). | **Open** — see ROADMAP.md #9 |
| 14 | Design debt | Several unit traits shown in tooltips/tech tree are still **flavor-only** (no engine effect): `impact`, `splash_damage`, `poison`, `siege`, `scout`, `fast`, `veteran`, `discipline`, `berserk`, `aggressive`, `bloodlust`-adjacent ability entries (`web_trap`, `venom_bite`, `fire_breath`, `dragon_breath`, `sky_dive`). Players may reasonably expect them to do something. Either implement (the 2026-07-27 pattern: implement + tax) or hide from UI. | **Open** |
| 15 | Balance (accepted) | Two deliberate stage-balance outliers, ruled as racial identity on 2026-07-27: **dwarfs dominate the early game** (~74% overall at lord ~3) and **orcs dominate the midgame** (~71%). Revisit only if playtesting says they feel unfair in practice. | **By design — monitor** |

---

## 🗺️ Roadmap

See **[ROADMAP.md](ROADMAP.md)** for the full plan: lord capture/fallen,
city conquest, garrisons, army balance, talent fixes, quest rebalance, a UI/
asset pass, Google login, a cleanup sprint, and a player wiki — with current-
state notes, concrete steps, and suggested ordering for each.
