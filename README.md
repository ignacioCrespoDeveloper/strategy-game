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
- **Lords** — classes (Warrior/Mage/Rogue/Priest...), leveling, talents
  (combat talents actually modify the lord's battle stats/traits; strategic
  talents affect quest speed, XP, command capacity, etc.), stances (idle,
  raiding, ambush...).
- **Cities** — building tiers, production, population/growth status, a
  building-derived garrison (see ROADMAP.md #3 for what's still missing here).
- **Battle Engine** — phased resolution (ranged → melee → morale/rout),
  traits/abilities per unit, a standalone Battle Simulator to theorycraft
  matchups without spending real armies.
- **PvP & PvE** — attacking enemy lords/cities or bandit/monster camps;
  honor points swing based on power destroyed vs. the opponent's strength.
- **Rankings** — 5-tab leaderboard (Overall/Infrastructure/Lords/Militar/
  Honor), computed from a documented point formula.
- **Clans & Wars** — create/apply/leader-approve/kick, a member roster with
  honor + ranking points, and time-boxed clan-vs-clan wars scored by power
  destroyed; allies (same clan) can't attack each other.

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

---

## 🗺️ Roadmap

See **[ROADMAP.md](ROADMAP.md)** for the full plan: lord capture/fallen,
city conquest, garrisons, army balance, talent fixes, quest rebalance, a UI/
asset pass, Google login, a cleanup sprint, and a player wiki — with current-
state notes, concrete steps, and suggested ordering for each.
