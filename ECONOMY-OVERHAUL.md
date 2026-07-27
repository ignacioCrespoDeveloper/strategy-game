# Economy & City UI Overhaul — Audit + Plan (OGame model)

Audit date: 2026-07-26. Every claim below was verified against the code (refs as `file:line`).

> **STATUS (2026-07-26): Slices 0, 1 and 2 are IMPLEMENTED.**
> - Single source of truth: `js/domain/economy-core.js` (EconomyCore), loaded by the
>   browser AND by `server/engine-loader.js`; `server/tick/catch-up.js` no longer has
>   its own formula copies. The drifted Deno fn `supabase/functions/sync/` is deleted.
> - Iron is gone everywhere. **Water is a CITY STAT, not OGame energy** (Nacho's
>   feedback, same day): base 40, Aqueduct +10/level, terrain mods, population drain.
>   **There is NO production-efficiency mechanic** (also removed on Nacho's feedback):
>   production = building output × race bonus × terrain multiplier, full stop. Water
>   still matters indirectly — as a low stat it counts toward the warning penalty on
>   population growth. OGame curves still govern the 4 resource buildings' output/
>   costs/build times.
> - City UI: Overview · Resources · Infrastructure · Military tabs, thumbnail grid +
>   detail panel (Improve / Tear down via new `POST /api/city/demolish`), water bar.
> - **2026-07-26 evening review:** gold rate cut pop×0.013 → pop×**0.004**; **food is
>   the deuterium**: marching between tiles costs `distance × min(500, 50 + 45·models)` food,
>   paid at enqueue (`EconomyCore.getMarchFoodCost`, enforced in lord-action.js,
>   shown in the map move panel + attack confirm). Same-tile actions stay free.
> - Verified by `node scripts/test-economy.js` (incl. client==server parity).
> - ⚠ Existing DB state still holds old cities (iron mines/blacksmith levels are simply
>   ignored; they still occupy slots) — run `node reset-db.js` before serious playtesting.
> - Slice 3 (balance pass: pop growth & gold vs the new food curve, art) remains open.

## 0. Target design (agreed direction)

OGame mapping:

| OGame | Hexfront | Status today |
|---|---|---|
| Metal / Metal Mine | **Wood / Lumber Mill** | exists (`lumber_mill`) |
| Crystal / Crystal Mine | **Stone / Stone Quarry** | exists (`stone_quarry`) |
| Deuterium / Synthesizer | **Food / Farm** | exists (`farm`) |
| Energy / Solar Plant | **Water / Aqueduct** | `aqueduct` exists but is a pure hygiene building — no production, no energy mechanic exists anywhere |
| (no analog) | **Gold** (`player.coins`) | exists — tax income (`pop × 0.013 × happiness`), upkeep sink |
| Dark Matter | **Credits** (`player.credits`) | exists — instant-finish + revive; granted 9999 at bootstrap, no top-up flow |
| Storage buildings | none for now (per Nacho) | none exist anyway |

City UI target (OGame-style): tabs **Overview (as-is) · Resources · Infrastructure · Military** — each building tab is a **thumbnail grid with level badges** at the bottom and a **detail panel above the grid** on click (image, level, production duration, "required to improve to Lv N+1" cost chips, Improve button, Tear down).

Deliberate deviation from OGame: resources stay in the **empire-wide pool** (`player.resources`), not per-city. Going per-city is a separate, much bigger project (loot, build costs, transport) — out of scope.

---

## 1. Audit — current state

### 1.1 Resource model
- Stockpile: `player.resources = { food, wood, stone, iron }` — empire-wide, no caps, no enum; the shape is hardcoded in ~10 places (`js/domain/production.js:18`, `server/tick/catch-up.js:643`, `js/ui/hud.js:247`, …).
- Currencies: `player.coins` (gold), `player.credits` (premium), `player.honorPoints`.
- Supabase is schemaless (`storage(player_id, key, value jsonb)`) — **no DB migration needed for any resource change**; only bootstrap/starter-kit code.
- No energy-like mechanic, no food upkeep (armies eat gold), no storage caps. `freePopulation` limiter is inert (only checked in dead client code, never in `server/actions/recruit.js`).

### 1.2 Production engine — **triplicated, with real drift**
The same formulas live in three hand-copied places:
1. `js/data/buildings.js` (+ `js/domain/production.js`, `city-stats.js`) — client source of truth.
2. `server/tick/catch-up.js:46-131` — `_BUILDING_PRODUCTION`, `_BUILDING_EFFECTS`, `_RACE_BONUSES`, `_UNIT_UPKEEP` hardcoded copies.
3. `supabase/functions/sync/index.ts` — a third copy, **badly drifted** (gold `pop×0.10` vs `0.013`; totally different pop-growth formula). **The client never calls this edge function** (it only hits Node `/api/sync`, `server-actions.js:442`) → it's dead legacy.

Confirmed drift bugs:
- Terrain multipliers applied on client (`production.js:40-44`) but **not** in server catch-up → online vs offline production differs.
- Starter kits differ: client `city.js:78` / `player.js:59` vs server `city-found.js:71` / `sync.js:76-79` (600 vs 5000 coins, 0 vs 9999 credits).
- Ghost buildings `granary`, `sewers`, `warehouse` in server tables — don't exist in `buildings.js`.
- `dragon_lair` is in server `_LANDMARK_IDS` but has no `isLandmark` flag → landmark one-per-city rule enforced inconsistently online vs offline.
- PvE resource loot writes to `city.resources` (`pve-attack.js:144-149`), a vestigial field nothing reads → **loot is silently lost**.
- Dead client spend paths: `construction.js` enqueue (self-documented), `recruitment.js` recruit/freePopulation spend.

### 1.3 Buildings
All 11 planned buildings already exist: farm, lumber_mill, stone_quarry, iron_mine, blacksmith, aqueduct, town_hall, library, courthouse, temple, tavern, marketplace — plus 18 military, 6 landmarks. Categories today: `infrastructure | economy | military | landmarks`; "economy" mixes producers with civic buildings, so a re-tag is needed for the Resources/Infrastructure split.

Iron removal ripples (verified):
- ~30 unit `resourceCost` entries use iron (`js/data/units.js`).
- `barracks.requires = { town_hall: 3, blacksmith: 5 }` (`buildings.js:305`).
- `grand_forge` landmark requires `iron_mine: 3` and produces iron (`buildings.js:781,794`); `slave_market` produces iron.
- Loot/discovery/starter-kit code references iron throughout.

Costs/build times: `_scale(base, factor, level)`, all `maxLevel: Infinity`, build queue is serial (max 5) with **no speed modifiers** (no robotics-factory analog yet).

### 1.4 City UI (`js/ui/city-view.js`, 780 lines)
- Tabs defined in one array `BLD_TABS` (`city-view.js:20-26`): overview/infrastructure/economy/military/landmarks. Full innerHTML re-render per action; 1s countdown patches only the queue timer.
- Building card `_cardHtml` (`:475-600`) is a full-width row; all upgrade math (cost, afford, duration, lock reasons, button state) computed inline — must be extracted and shared with the new detail panel.
- Closest existing pattern to the OGame thumbnail grid: tech-tree's `.tt-bld-grid` / `.tt-bld-card` (`tech-tree-screen.js`, `app.css:398+`).
- **Tear down does not exist** — needs a new server action.
- Building defs are **emoji-only**; everything in `assets/buildings/*.png` is orphaned and mostly doesn't match building ids (art pass stays bundled with roadmap item #7).
- Left sidebar duplicates Overview-tab content (pop/status/defenses/effects) — keep for now, dedupe opportunistically.

---

## 2. Plan — vertical slices

### Slice 0 — Unify the economy engine (prereq, no gameplay change)
The overhaul is unshippable while formulas live in 3 copies.
1. Make `server/tick/catch-up.js` consume the real defs via `server/engine-loader.js` (as `build.js` already does for cost/buildTime): delete `_BUILDING_PRODUCTION`, `_BUILDING_EFFECTS`, `_RACE_BONUSES` hardcoded tables; call shared production/stat functions.
2. Delete `supabase/functions/sync/index.ts` (dead, drifted) — or archive it.
3. Fix drift bugs: terrain mods in catch-up, unify starter kits (server values win), remove ghost buildings, fix `dragon_lair` landmark flag, redirect PvE loot to `player.resources`, remove vestigial `city.resources` + dead spend paths in `construction.js`/`recruitment.js`.
4. Verification: a `scripts/test-economy.js` (same style as `scripts/test-battle-movement.js`) asserting client rates == server catch-up rates for a fixture city.

### Slice 1 — Resource model swap (iron out, water in)
1. Remove `iron` from the resource set everywhere (defs, starter kits, HUD, loot tables, discovery rewards, `corruption_scandal` event untouched — wood/stone only).
2. Re-denominate costs: unit/building iron → stone 1:1 (adjust later in balance pass); `barracks.requires` → `{ town_hall: 3 }`; retire `iron_mine` + `blacksmith` defs; `grand_forge` → produces/requires stone.
3. Re-tag categories: `resources` = farm, lumber_mill, stone_quarry, aqueduct; `infrastructure` = town_hall, library, courthouse, temple, tavern, marketplace; military/landmarks unchanged.
4. Aqueduct becomes the energy plant: produces **water** (derived, not stockpiled). Mines consume water; per-city production factor = `min(1, waterProduced / waterConsumed)` (OGame rule). OGame-true curves: production `30·L·1.1^L` (wood) / `20·L·1.1^L` (stone) / `10·L·1.1^L` (food), water output `20·L·1.1^L`, consumption `10·L·1.1^L` per mine (food farm `20·L·1.1^L`); costs ×1.5–1.6 per level. Water balance shown in HUD + city view.
5. DB: schemaless, so no migration — run `reset-db.js` (pre-launch).
6. Rebalance checkpoints: pop growth uses `rates.food>0` nudge — verify against new curves; gold rate untouched.

### Slice 2 — OGame city UI
1. `BLD_TABS` → Overview · Resources · Infrastructure · Military · Landmarks (landmarks kept as 5th tab pending decision).
2. Thumbnail grid (reuse `.tt-bld-grid` pattern, Midnight-Throne styling): icon tile + gold level badge; locked = dimmed veil; in-queue = highlight.
3. Detail panel above grid (new `_selectedBuilding` state, same delegation pattern as `_selectedStat`): name, level, image/emoji, production now→next, duration, cost chips, effects, Improve button (existing `ServerActions.build` flow), Tear down.
4. New server action `server/actions/demolish.js`: level −1, instant, no refund (v1); wire client + button confirm.
5. Extract `_cardHtml`'s upgrade math into a shared helper used by grid tile + detail panel. Keep queue banner as-is.

### Slice 3 — Balance + polish pass
Recalibrate pop growth / gold vs new curves (memory: previous calibration was ×1130 / ×0.013), empty states for empty tabs, and fold building art into roadmap item #7's consolidated visual pass.

---

## 3. Decisions (locked by Nacho, 2026-07-26)

1. **Iron** — removed entirely; every iron cost splits ~50/50 into wood/stone.
2. **Iron Mine + Blacksmith** — both retired; `barracks.requires` becomes `{ town_hall: 3 }`.
3. **Formulas** — true OGame curves for the 4 resource buildings (production 30/20/10·L·1.1^L, water 20·L·1.1^L, costs ×1.5–1.6/level). Pop growth/gold recalibrated in the balance slice.
4. **Tabs** — strict 4-tab layout: Overview · Resources · Infrastructure · Military; landmark cards render inside Infrastructure (keeping their special banner). Courthouse stays in Infrastructure.
5. Water is per-city (like OGame energy per planet) → shown in the city view, not the global HUD. HUD shows gold · food · wood · stone · credits.
