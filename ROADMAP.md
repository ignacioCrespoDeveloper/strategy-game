# Hexfront — Roadmap

Rewritten **2026-08-03**. The previous version (2026-07-29) tracked a four-item
list that has since either shipped or been overtaken. This rewrite consolidates
**three separate backlogs that were drifting apart** into one ordered plan:

1. the old roadmap's active/parked items,
2. `README.md`'s Known Issues table,
3. the open phases of `ECONOMY-REBALANCE-PLAN.md` (Phases 0–2 done, 3–4 open),
4. and Nacho's own list of bugs and changes, brought 2026-08-03.

Nothing was dropped. Anything not in the batch plan below is in **Deferred**,
**Parked** or **Shipped** at the end of this file.

---

## The plan — six batches

Each batch is independently shippable and leaves the game playable, per the
vertical-slice rule. The order is not preference, it is dependency: every batch
below would have to be redone if the one above it landed afterwards.

### Tanda 0 — Asset cache busting ✅ SHIPPED 2026-08-03

`index.html` loaded 71 `<script>` tags plus the stylesheet with no version on
any of them, so there was no way to tell from the outside which build a given
browser was running. A screenshot of a stale price and a real pricing bug
looked identical — which is exactly how the mount-price report stalled.

- **`server/asset-version.js`** — build id = newest mtime across `js/` + `css/`
  plus the file count, base 36, memoised 1 s. Derived from source, never
  hand-bumped, so it cannot drift from disk.
- **`server/index.js`** — `/` and `/index.html` are served by hand with
  `Cache-Control: no-store`, every local `src`/`href` stamped `?v=<build>`.
  `express.static` gives anything arriving *with* a `?v=` a one-year immutable
  cache and everything else `no-cache`.
- **`index.html`** carries `<meta name="hexfront-build" content="dev">`, filled
  in at serve time; **`js/ui/app.js`** logs the build on boot.

⚠ **Never add a `?v=` query string by hand.** The server owns them.

*Note on the diagnosis:* `express.static` was already sending `max-age=0` with
an ETag, so ordinary browser caching probably was **not** the cause of the
mount-price report — a tab left open across the 2026-07-30 reprice is the
likelier explanation. The lasting value here is the build id, not the cache
headers: "which build is that client on" is now answerable in one second.

### Tanda 1 — Honest time ✅ SHIPPED 2026-08-03

**What landed:**

1. **Back-stamping.** `_resolveSearchArea` and `_resolveAmbush` now take the
   expedition's own `finishAt` instead of the current tick, and everything they
   write dates the event: the battle report's filing time, the army rest clock,
   the hour of downtime a fallen lord serves (it used to start on login, so a
   lord beaten three days ago was still "recovering"), and the discovery
   record. `pending.at` rides to the client on `quest_result`, and both client
   stores — `DiscoveryService.addLog` and `ActivityService.log` — accept it
   instead of unconditionally stamping the wall clock. `lord_action_done` and
   the raid and scout events carry theirs too.
2. **Wall-clock times.** `TimeService.formatClock` / `endsAtClock` (same day →
   `18:42`, later → `18:42 Aug 6`), wired into the move preview, the attack
   confirm, the expedition / scout / raid confirms, the Active Movements rows,
   the city build queue, the incoming-attack banner and the offline toasts.
3. **The alert is global.** The `/api/attack/incoming` scan moved from
   overview-screen into `HUD`, sharing the activity-feed poll's timer (every
   20s) and rendering `#hud-threat-bar` on every authenticated screen. Overview
   dropped its own poll and now mirrors HUD's list via `threats:changed`.

**Two extras found on the way, both fixed:**

- **The attack ETA was a lie on short marches.** `attack-confirm-view` called
  `getTravelTime` without the 60s attack floor the server applies, so an
  adjacent-tile strike by a fast lord advertised ~10s and queued at 60. The
  floor is now `EconomyCore.ATTACK_MIN_SECS`, read by the preview, the client
  mover and the server.
- **Credit-finishing a march skipped the arrival check.**
  `/api/lord/instant-action` dequeued moves by hand instead of running
  `catchUp`, so `pendingArrivalCheck` was never set — paying credits was a way
  to walk onto a raider without being intercepted.

**NOT fixed: README Known Issue #1's quest half.** The credit-finish-on-the-
same-tile failure is still unreproduced; nothing in the code read as the cause.
Honest timestamps should make the next repro legible.

**Original scope follows.**

Nacho's item 1 asked for a server-authoritative timestamp refactor. **The audit
found the refactor is already done** — `lord-action.js` stamps `startedAt` and
`finishAt` in epoch ms on every queue item, and construction, recruitment,
research and blessings all do the same. The client already only paints
countdowns. So this batch is three targeted fixes rather than an architecture
change:

1. **Back-stamp results with the time they actually happened.** `catch-up.js`
   files completions under *login* time, not completion time: the
   `lord_action_done` event carries no timestamp at all, and `_resolveAmbush`
   stamps `at: nowMs` even though the comment directly above it says the field
   must be the moment the fight happened. That is the "quest says *just now*
   when it finished three days ago" bug.
2. **Absolute arrival clock times, OGame style.** `toLocaleTimeString` appears
   in **zero** files today — every timer in the game is a relative countdown
   via `TimeService.formatDuration`. Each countdown gains the wall-clock time
   it lands at, next to the remaining time.
3. **Make the incoming-attack alert global.** `/api/attack/incoming` already
   derives threats from the attackers' `actionQueue`, so it is correctly
   launch-time, not resolve-time. The gap is that only `overview-screen.js`
   polls it, every 30 s — a defender sitting on the map, in a city or on a lord
   screen is told nothing. The poll moves into the HUD.

Folded in: **README Known Issue #1** (credit-finish on the same tile does
nothing). `TESTING.md` already documents the root cause as a gotcha —
`/api/lord/instant-action` skips `catchUp`'s `pendingArrivalCheck` /
`pendingDiscoveries` set-up for plain moves.

**Gate:** close the browser mid-expedition, return two days later, and have the
report file under its real time. `test-battle-movement.js` green.

### Tanda 2 — Constants ✅ SHIPPED 2026-08-03

**Mount price — no bug in the code.** Every path was traced: `MOUNT_SLOTS` and
all 20 per-mount `cost` values agree at 60k/60k/150k/350k (pinned by
`test-economy.js`); the Mount tab, the Overview card, the Sell confirm, the
equip endpoint and the sell endpoint all read `MOUNT_POOL` through
`resolveMountId`, so there is no second price anywhere in the game. The report
was a client running an older build than the server.

Rather than close it as "cannot reproduce", the whole bug *class* is now
detectable: **every `/api/*` response carries `X-Hexfront-Build`**, and
`ServerActions._post` compares it with the build stamped into the page,
warning once per session when they diverge. It **warns rather than blocks** —
the server is authoritative, so a stale client can only ever display a wrong
price, never charge one, and a hard gate would log the player out on every
save during development.

**Travel time `1.0 → 5.0`.** At 1.0 the entire 20×10 world was **6m20s wide**
at base speed and 3m31s on an apex mount. There was no strategic geography:
every target was equally close, and the 60s attack floor — not distance —
decided how long most strikes took. At 5.0 a three-tile march takes 5 minutes
(a real warning window, which is what Tanda 1's global alert exists to use) and
crossing the map takes half an hour.

**This was free.** `economy-projection.js --dial travelTime=8` produces income
identical to 1.0 to the last digit, because travel only reaches the income
model as a one-tile hop between expeditions (~17s against a 900s search). It is
a feel and PvP-reachability dial, not an income one, which is why it could move
5× without re-opening the pacing already approved.

**March food cost — the 500/tile cap removed.** The ceiling was reached at
exactly **10 models**, so every army from ten models to a full endgame host
paid an identical bill: 40 models and 10 models both cost 2,500 food to march
five tiles. The per-model supply cost the formula appears to charge stopped
existing precisely where armies start getting big. Now uncapped — 40 models
over 5 tiles goes 2,500 → 9,250. Pinned by a regression guard in
`test-economy.js` so no ceiling can come back unnoticed.

This pushes the same direction as Tanda 3's armour fix; watch them together.

**Tooling: `economy-projection.js --dial key=value`** (repeatable). Rule 7 of
`ECONOMY-REBALANCE-PLAN.md` says a dial change is verified by running the
projection — but that required *editing the shipped file* to find out, so the
answer to "what would ×5 do" could only be had by half-committing to it. Every
override is echoed with a `SIMULATION ONLY` banner so an override run can never
be mistaken for the shipped curve.

### Tanda 3 — Combat ✅ ENGINE WORK SHIPPED 2026-08-03 (traits still open)

**Three defects, one root cause, found by measurement rather than reading.**

The controlled experiment that drove all of it: one deep stack of N versus N
stacks of 1 **of the identical unit** — same models, same stats, same PWR, so
any deviation from a 50% win rate is the engine's arithmetic alone.

| state | deep stack wins |
|---|---|
| before any fix | **100%** |
| after per-model armour | 13% |
| after unbiased rounding | 24% |
| after body-bounded lossless carry | **30%** |

**1. Armour was subtracted per STACK, not per model** — damage scaled with the
attacker's model count, `defense × 0.4` did not. Fixed: each model's swing is
reduced individually.

**2. `Math.ceil` on damage was paid once per ATTACK** — a spread force makes far
more attacks than one deep stack of the same models, worth a measured **+4.9%
damage over a fight**. Now `Math.round`, unbiased in expectation.

**3. THE ROOT CAUSE — a stack absorbed losslessly but dealt wastefully.**
`_applyDamage` cascades an overflow from model to model inside a stack with
nothing lost, so ABSORBING scales with depth. Dealing did not: one attack, one
target, and half of every overshoot evaporated at the ×0.5 spill friction.
Measured 132 damage per enemy model removed against a spread force's 115, on a
95-HP model. Fixed by making contact carry **lossless** and bounding the chain
by the attacker's **model count** instead of a flat 8 hops — a unit can chain
through as many enemies as it has bodies, which is the rule the absorb side
always followed. That bound is what makes full carry safe: the old cliff was a
*one-model* monster cleaving eight stacks, and it now gets one follow-through.

**`ARMOR_REDUCTION` re-swept 0.4 → 0.20.** The old value was calibrated for
per-stack subtraction; charged per model it crushes cheap low-attack chaff whose
whole swing is smaller than the reduction (orc start fell to 11.6% at 0.4). The
full sweep is recorded in the constant's comment.

**Verified: `test-balance.js` 18/18**, every race band inside 38–62% at every
stage. The two outliers that survived the first two fixes — orc/swarm 76.1%
against a 74% ceiling and orc/blocks at 20.7% — **resolved themselves** when
defect 3 landed (73.7% and 30.3%), because they were the same root cause seen
from the archetype side. `army-guide.html` regenerated.

**Tried and reverted, recorded in comments so they are not retried blind:**
`CONTACT_FRICTION` 0.85 with a flat hop cap (moved nothing — the bound, not the
friction, was what mattered), and the `coward` morale tax 0.2 → 0.3 (orc/swarm
barely moved while orc start fell out of its band; a side-wide morale tax hits
both ends of an intra-race spread at once).

**Still open: the flavor-only traits** (`splash_damage`, `poison`, `siege`,
`fast`, `veteran`). Each needs a design call with Nacho plus a PWR tax.

**Original scope follows.**

### Tanda 3 — Combat (original plan)

**Two arithmetic bugs found, proven and fixed.**

1. **Armour was subtracted per STACK, not per model.** Damage scaled with the
   attacker's model count; the target's `defense × 0.4` did not. Twenty models
   in one stack ate the reduction once; the same twenty split across twenty
   stacks ate it twenty times, for identical units at identical PWR. Measured
   before the fix on identical synthetic units: **one deep stack of 20 beat
   twenty stacks of 1 one hundred percent of the time.** Now each model's swing
   is reduced individually.
2. **`Math.ceil` on damage was paid once per ATTACK**, and a spread force makes
   many more attacks than one deep stack of the same models — a free +0.5 per
   stack per phase, measured at **+4.9% damage over a fight**. Now `Math.round`,
   which is unbiased in expectation.

**`ARMOR_REDUCTION` re-swept to 0.20.** The old 0.4 was calibrated for per-stack
subtraction; charged per model it is punishing, and it lands hardest on cheap
low-attack chaff whose entire swing is smaller than the reduction. At 0.4 the
balance suite went to 4 failures (orc start 11.6%, dark elf start 84.5%). The
full sweep is recorded in the constant's comment. **Result: 17/18, every race
band back inside 38–62% at every stage.**

**Two things tried and reverted, both recorded in comments so they are not
retried blind:**
- `CONTACT_FRICTION` 0.5 → 0.85 (to reduce a deep stack's overkill waste):
  moved the shape result almost not at all, and near-full carry is a known
  cliff — one monster attack chain-deleting whole stacks.
- `coward` morale tax 0.2 → 0.3 (to price chaff that now hits harder):
  orc/swarm barely moved while orc START fell out of its band. The orc issue is
  a spread *inside* one race; a side-wide morale tax hits both ends at once.

**OPEN — the decision this batch surfaced.** A third asymmetry remains and it is
**structural, not arithmetic**: a stack makes ONE attack against ONE target, so
a deep stack overshoots and wastes the excess, while a spread force does not.
Measured: 132 damage per enemy model removed versus 115, on a 95-HP model —
39% waste against 21%. Fixing it properly means letting a stack's attack be
**distributed across targets** instead of concentrated, which is a redesign of
`_executeAttack` affecting every battle and every existing calibration.

Note the extreme case (ten 1-model stacks of the same unit) is **not reachable
in play** — recruiting merges same-unit stacks — so this is a distortion in how
much the engine rewards variety, not a live exploit.

Also open: **orc/swarm at 76.1% against a 74% ceiling** — the last balance
failure, and unit-level orc work rather than a coefficient.

**Still not started in this batch:** the flavor-only traits (`splash_damage`,
`poison`, `siege`, `fast`, `veteran`). They need per-trait design decisions with
Nacho and a PWR tax each, and stacking them onto an engine whose shape question
is still open would mean calibrating twice.

**Original scope follows.**

### Tanda 3 — CLOSED 2026-08-03; everything left is parked

All three remaining items were parked by Nacho on 2026-08-03. Tanda 3 is done as
a batch; these come back as their own work when reactivated.

- **Frontage (troops per round) — PARKED.** Nacho's proposal, prototyped and
  swept. It works: at width 4 the unit-type correlation dies completely
  (−0.008) and the *well-composed* archetype tops the table. But it is a
  rebalance, not a patch — 14 suite failures at that width, because the race
  bands were tuned for an uncapped line. The mechanic has no useful middle
  setting: at 8–12 it is nearly free and changes nothing (correlation
  unmoved at 0.45–0.47); at 4–6 it bites and needs all five races retuned.
  Estimated two to three sessions. Shipped OFF (`FRONTAGE = 0`); the full sweep
  is recorded in the constant's comment so it never needs re-measuring. **The
  `_runAttacks` refactor it required stays regardless** — six near-identical
  copies of the phase loop are now one.
- **Flavor-only traits — PARKED** (`splash_damage`, `poison`, `siege`, `fast`,
  `veteran`). Each needs a design call plus a PWR tax, which moves unit gold
  cost, so it is a balance change and not a feature.
- **Counter matrix — PARKED.** No counter system exists beyond `anti_large` /
  `anti_infantry`, so "counters aren't penalised" is literal: there is nothing
  to penalise. Wants doing together with the traits above, since `siege`,
  `fast` and `veteran` are the obvious counter keys.

**Left measured and open:** shape neutrality sits at ~25% against a 50% target
(it was 100% before this batch). The frontage decision above is the lever for
the rest of it.

### Tanda 3 — reference (superseded plan)

**Defect 4 — target selections scaled with STACKS, not models.** Found by
asking why the guide's recommended human army fields one of every cavalry type.

`_executeAttack` ran once per stack per phase and made ONE
`TargetingService.select` call, so the number of independent tactical decisions
an army got was its stack count. Measured on the two dark elf armies: identical
damage thrown (603 vs 613) but **12.7 attacks per round against 6.3**. That
compounds — more picks finish off more enemy *stacks* per round, killing a
stack removes a whole attacker rather than a model, and the side with few
stacks loses a bigger share of its own output with each one.

Across the twenty tournament armies, all built to the same PWR cap, **unit-type
count correlated 0.694 with win rate**. Nothing else came close: total HP 0.373,
model count 0.132, total attack 0.041, army PWR −0.038. It was never about what
you brought, only how many piles you split it into — and PWR charges nothing
for being a separate pile.

**Fixed:** a stack now splits into up to `MAX_ATTACK_GROUPS` (6) groups, each
selecting its own target and swinging with its share of the models. Total damage
is unchanged — this moves decisions, not power. Groups are bounded by living
enemy stacks (no point picking a sixth target against three) and by model count
(a lone monster still gets one). The cap exists for the battle report, which is
persisted to Supabase; measured at 126 events / 37 KB per battle.

**Result: unit-type correlation 0.694 → 0.467**, shape neutrality 11% → 24%,
and the attacker/defender bias that used to depend on army shape is gone
(deep-vs-deep and flat-vs-flat mirrors both sit at ~51–53%, they were 57% and
32%). `test-balance.js` **18/18**, and the worst archetype floor rose from
orc/blocks 30.3% to human/balanced 31.5%.

**Shape neutrality is measured every run** (`test-balance.js`, "Shape
neutrality") — one stack of N versus N stacks of 1 of the identical unit, sides
alternated. **Reported, not gated**: target 50%, measured 24%, and a band wide
enough to pass that would no longer catch anything. Gate it when the target is
reachable.

⚠ **A `shield_wall` lead was chased and turned out to be a reporting artifact of
this very check** — worth recording so nobody re-chases it. Draws were excluded
from the win-rate denominator without being shown, and the tanky shield_wall
mirrors grind almost every fight to the round cap: Dwarf Warriors decided 13 of
200 fights, Spearmen 17 of 200. Their "0%" was noise over a handful of samples,
not a trait interaction. The check now prints `decided/reps` per row, flags rows
under 20% decided, and weights the average by decided fights. Swordsmen — also
shield_wall, but 171/200 decided — sits at 19.9%, right alongside the
non-shield_wall Halberdiers at 24.1%.

**The army guide no longer claims to rank optimal armies.** "Top 5 army
compositions" became "Best of the four archetypes", with a note explaining that
`buildArmy` is a round-robin greedy filler — it walks its preference list adding
ONE of each unit that fits and loops, so it produces one of every cavalry type
rather than three of the best, and never evaluates concentrating the budget.
That is why the recommended human army fields a Demigryph, a Reiksguard and an
Empire Knight: nobody compared them, the filler queued them.

**Counter matrix.** There is no counter system beyond the two `anti_large` /
`anti_infantry` traits, so "counters aren't being penalised" is literal — there
is nothing to penalise. **Nacho's call 2026-08-03: investigate later.**

**Flavor-only traits** — `splash_damage`, `poison`, `siege`, `fast`, `veteran`.
`siege`, `fast` and `veteran` are the obvious counter keys, and `splash_damage`
interacts directly with the spill chain the engine work just rebuilt, so these
two items want doing together. Each trait needs a design call plus a PWR tax,
which moves unit gold cost — so this is a balance change, not a feature.

**The mass bonuses were NOT recalibrated** (the original plan's step 2). The
charge wedge (+0.05/rider, cap +0.2) and shield_wall ranks (−2%/model, cap
−30%) exist to give deep stacks a reason to exist, and the suite came back
18/18 with them untouched. Revisit only if depth over-performs in play.

### Tanda 4 — Economy Phases 3 and 4 ⏳ PART SHIPPED 2026-08-03

**⚠ The plan was written against a system that no longer exists.** Nacho
replaced the population-growth model with the **status ladder** in a parallel
session on 2026-08-03 (`getCityStatus` / `STATUS_POP_RATE` in
`economy-core.js`), and that dissolved most of ECONOMY-AUDIT §F on its own:
growth no longer saturates, six weighted stats drive it, and the top tier needs
five of six rows at Excellent. Re-measured before implementing:

| loadout | pop | status | cost |
|---|---|---|---|
| the audit's "enough" set (TH5/farm4/aqueduct3/temple2) | 25k | **Prosperous** | 89k |
| same, at 100k pop | 100k | Growing | 89k |
| no Courthouse / Tavern | 100k | Growing | 461k |
| + Tavern 8 | 100k | Growing | 510k |
| **+ Tavern 8 + Courthouse 8** | 100k | **Growing — identical** | 609k |
| + Tavern/Courthouse/Temple 8 | 100k | Prosperous | 668k |

**Tavern now has a real job** (culture 74→98, happiness 94→100 — both scored).
**Courthouse still does not.** Its only status contribution is corruption, and
corruption bases at 0, clamps at 0, and is normalised as `100 − value`, so
anything under 30 reads Excellent. Even Marketplace 10 (+60 gross) lands at 12
after Temple and the religion cross-stat pull it down. Courthouse 8 takes it
12 → 0 and changes nothing: **98,513 resources for an identical city.** That is
the surviving piece of §F, and "corruption gets a real bite" is still the fix
for it — but it needs re-deriving against the ladder, not the old brackets.

**Tier pressure was NOT implemented** and should be re-derived rather than
built as written: its stated purpose was to stop civic buildings mattering at
~5,000 resources, and the ladder already does that.

**SHIPPED in this batch:**

- **City tier is a ratchet** (Nacho's call). Tier and slots derive from
  `peakPopulation`, never current population, and **`degradeExcessBuildings` is
  deleted** — it used to run in the server tick and destroy buildings at random
  whenever a shrinking city fell a tier. Absent field falls back to live
  population, so existing cities keep their tier and start ratcheting; nothing
  to migrate.
- **Producers rebased** (Phase 3b): farm cost base 300 → 60, quarry factor
  1.6 → 1.5. The 12× payback spread is now ~2.4× — at L20: mill 24d, quarry
  35d, farm 58d (was 24 / 118 / 288).
- **Research curve flattened** (Phase 3a): `1.8 → 1.35`. Cost per 1% of effect
  at L10 went 248k → **19k** for Engineering Tomes and 1.01M → **76k** for
  Cartography.
- **Two tier-2 books added** — Husbandry Records (`food_production`) and Drill
  Yards (`recruit_speed`). Before this, reaching Library 4 unlocked nothing:
  both existing books were tier 1, so the Library gated only itself. Both keys
  were checked for a live consumer first, and `gold_income_bonus` — the plan's
  third candidate — was **rejected** because `getGoldRate` never reads it. A
  new `test-economy.js` check now enforces that rule for every book.
- **Fortress base ÷10** and **Dragon Lair factor 2.0 → 1.7** (Phase 4).

**Cartography was NOT converted, and the decision that called for it is void.**
Decision 4 rested on march food being "structurally bounded — capped at
500/tile". Tanda 2 removed that cap, so the benefit now rides an army that
grows. The projection's own classifier was still hardcoded to `false` for
`march_food_cost` and has been flipped. **Result: 0 payback failures — the
first clean run.** The other half of the decision was resting on a
`travel_speed` research key that has no consumer anywhere.

**Also shipped, after the three open items were triaged with Nacho:**

- **Corruption skims city gold** — `getGoldRate` takes a `corruption` argument
  and cuts the take by up to half at corruption 100
  (`CORRUPTION_GOLD_SKIM_MAX = 0.5`). That gives the Courthouse the job it never
  had, prices the Marketplace's `+6 corruption/level` against its `+8% gold`,
  and makes "a big market town needs a courthouse or it leaks" a real decision.
  Omitting the argument is a no-op, so no caller silently loses income. Two new
  `test-economy.js` checks pin the curve and assert a Courthouse measurably
  restores what a Marketplace leaks.

- **`build.js` now runs `BuildingUnlockService`** — THE gate for client and
  server, the same arrangement `unit-unlock.js` has for recruiting. It was
  browser-only: the endpoint checked `maxLevel`, `requires`, the landmark rule
  and cost, and nothing else, so a crafted POST could **raise a Dragon Lair as
  a dwarf, drop a tier-5 building into a tier-1 city, and build past `maxSlots`
  without limit.** All three reproduced, then blocked. The service was made
  environment-agnostic (reads `EconomyCore` directly instead of the client-only
  `CityStatsService`) and its `const` declaration became `var` — a top-level
  `const` is invisible to the server's VM context, which is why it exported
  nothing on the first attempt. Its hardcoded `TIER_POPS` array also stopped at
  tier 5 and now reads `SLOT_TABLE`.

- **`fortress` removed from the projection's apex list.** At 320k it is an
  order of magnitude below the Imperial Palace (4.8M), so counting it as apex
  made the milestone measure the cheapest thing in the list.

### Tanda 4b — Population growth follow-up ✅ SHIPPED 2026-08-03

Three defects found by auditing the status ladder in play. All three came from
the same place: the famine term.

- **A new city was born shrinking.** Founded with a Town Hall and nothing else,
  it produced 0 food/h, so `NO_FOOD_POP_PENALTY` fired on its first tick and it
  opened at **−42 pop/h under a badge that read "Stable"**. Two fixes, because
  the bug had two causes:
  - **Famine now reads the EMPIRE larder, not one city's farms**
    (`EconomyCore.isCityFed`). Resources are a shared pool, so a farmless city
    in a stocked realm is fed by its neighbours — the old check starved it
    while the player watched 500k food sit in the bank. A city with a farm is
    unaffected, so no developed city changed.
  - **The founding loadout is `{ town_hall: 1, farm: 1 }`** so a new city also
    stands on its own. Farm 1 lifts the opening stats (happiness 50→54,
    unemployment 15→10) to a comfortable Stable. Duplicated in three places —
    `city-found.js`, `js/domain/city.js`, `economy-projection.js`.
  - Result: **every terrain opens Stable at +83/h (+1,992/day).** Marsh still
    opens with a Warning hygiene row (−15 terrain) and so cannot reach
    Prosperous until it has an Aqueduct — that is the cost of the tile, kept.

- **Population could stand perfectly still**, which the design forbids: a
  Growing city (125) minus the penalty (125) was **exactly 0**, and the UI had
  a whole third wording for it ("Population stagnant", `pop-stable`,
  `ov-cc-grow--stable`, an all-flat trend column). Worse in the other
  direction, a starving **Prosperous city still grew at +42/h**. Famine is now
  clamped to `min(STARVATION_POP_RATE, tier − penalty)`, so it is always a
  decline and a bad status still starves faster (Unrest −167, Critical −292).
  `getPopGrowthRate` can no longer return 0 and the three "stagnant" UI paths
  are deleted. `test-economy.js` sweeps the full status × larder matrix.

- **Three of the four screens that print the badge lied about a famine.** Only
  city view disclosed it; the home city card and the map info panel labelled a
  starving city "Stable" with no hint. All four now call one function,
  `CityStatsService.getGrowthReport`, which owns the rate, the arrow and the
  badge — and a famine **replaces** the badge (new `Famine` state, its own
  violet `.cvl-famine`, deliberately not a ladder colour) instead of sitting
  beside it. `getCityStatus`'s UI wrapper and `getStatusGrowthEffect` were
  superseded and deleted.

**NOT touched, and needing Nacho's call:** the per-day targets
(Stable 2,000 / Growing 3,000 / Prosperous 4,000) and the pop-pressure slopes
(`−1 hygiene / 2,000 pop`, `+1 unemployment / 5,000`). Those are his numbers
from the same day and the ladder measures correctly against them — at 100k pop
the pressure alone is −49 hygiene, which is what makes Prosperous a thing you
re-buy with Aqueduct levels as you grow. If "improve growth" means moving those
figures rather than fixing the famine, it is a one-line retune.

**Still open:**
- **`Apex building Lv1` reads day 30 against a 35–45 window** — and the Fortress
  was *not* the cause: removing it barely moved the number, because the
  milestone sums L1 of **every** reachable apex building. The real cause is the
  producer rebase making CORE cheaper (18.7M → 16.7M, resources met day 26
  instead of 28), which pulls the whole tail forward. The plan predicted exactly
  this and named the compensation — raise the CORE basket from producers L15 to
  L18 — but its own gate (**CORE must stay day 21–28**) is met at 26, and the
  apex row is explicitly non-gating. Left as-is deliberately.
- **Tier pressure** — superseded by the status ladder; re-derive before building.

### Tanda 4 — original plan

Already designed and decided in `ECONOMY-REBALANCE-PLAN.md` (Part 4, locked by
Nacho 2026-07-30). This batch is execution, not design.

- **Phase 3a — research.** Cartography converts to travel speed + march food
  (keeping the id and the surveying fiction); Engineering Tomes' cost curve
  flattens ×1.8 → ×1.35; add 2–3 books on growing bases.
- **Phase 3b — producers.** Farm cost base 300 → 60, quarry factor 1.6 → 1.5.
  Closes a 12× payback spread down to ~2.5×.
- **Phase 4 — tier pressure**: city stats degrade per city tier, so civic
  buildings scale with the city instead of stopping at ~5,000 resources of
  investment. **This is Nacho's "population should lower stats".**
- **Phase 4 — corruption gets a real bite**: a direct % penalty on city gold
  income. Gives the Courthouse a job and the Marketplace's `+6 corruption/level`
  a downside. **This, with tier pressure, is Nacho's "buildings with no use"** —
  the Courthouse and Tavern are dead today because nothing consumes corruption
  and nothing pressures happiness. They get a job rather than get deleted.
- **Phase 4 — Fortress cliff** (L1 costs 3.2M behind prereqs costing ~8,900, a
  ~360× jump) and **Dragon Lair ×2.0 → ×1.7**.

⚠ `degradeExcessBuildings` is the sharp edge: a tier-pressure spiral that drops
a city's tier while `usedSlots > maxSlots` destroys buildings at random. Verify
the spiral cannot reach it, or soften the function.

**Gate:** no building in the catalog has zero economic effect at its useful max.
`run-all-tests.js` fully green.

### Tanda 5 — New content · ⏸ PARKED to the next release (Nacho, 2026-08-03)

Parked as a block, alongside frontage, the flavor traits and the counter
matrix. Nothing below is started; the ordering and reasoning stand for whoever
picks it up.

1. **Map expansion + colonisation cost — one problem, not two.** The map is
   20 × 10 = **200 tiles total**, shared by every player, with `MAX_CITIES` and
   `MAX_LORDS` both at 7. The founding curve itself is fine (8k → 256k on a
   clean ×2 ladder; the audit found it coherent and paying back in ~30 days) —
   what is missing is *room*. More regions, plus an OGame-astrophysics-style
   research gate that raises the city ceiling alongside the gold cost. This
   **unblocks conquest**: losing a city stops being a game-over once a player
   holds ground in more than one place.
2. **Garrisons → sieges → conquest** (the long-parked trilogy). Garrisons
   first — the troop-exchange panel and `army-transfer-core.js` stack maths are
   already built to be reused for it. Only worth doing once Tanda 3's resolver
   is solid, or it gets designed twice.
3. **Joint attacks.** Joint *defence* already works — `combat-resolver.js`
   gathers every enemy lord on the target tile, across players, plus the city
   garrison, and they fight as one side. Joint attack is the missing half, and
   it fits naturally with sieges (several lords pressing one city).
4. **Global magic for mages and priests** — last, as agreed. Temples and
   blessings are already the economic scaffolding; this is the tactical layer
   on top, and it needs the combat resolver settled first.

---

## Decisions locked (Nacho, 2026-08-03)

1. **Movement times** — leave as they are for now; the target is an
   OGame-like feel, to be picked later.
2. **Counter matrix** — investigate after the armour fix, not before.
3. **Database reset happens at the END**, once the batches have landed — not
   before. (README Known Issue #3: existing accounts hold pre-overhaul prices,
   wallets and rosters, so playtest numbers are not trustworthy until then.)

---

## Explicitly deferred

- **Draw-flow verification** — battles draw more often post-overhaul and the
  downstream flows (honor, loot, capture, report wording) were never
  re-verified for `winner: 'draw'`. Nacho's call 2026-07-29: acceptable as-is,
  revisit only if odd outcomes surface in play. (README #4.)
- **Race `population_growth` bonus** — still a dead key; the Orc +25% and Dark
  Elf +15% labels overclaim. Belongs inside a balance pass with the suite
  re-run, not a UI patch. (README #5.)
- **`expeditionRatingMult` is dead at endgame** — ER bands are gates, not a
  curve, and a filled L10 army sits around ER 1450 against a Legendary
  threshold of 800, so ×1.15 crosses nothing. It survives as a mid-game
  kicker; `quest_bonus` is the scout mount's real product. Found during the
  Phase 2 reprice; unscheduled.

---

## Parked (say the word to reactivate)

- **Unit `abilities`** (`web_trap`, `venom_bite`, `fire_breath`,
  `dragon_breath`, `sky_dive`) — parked by Nacho 2026-07-29 out of the trait
  pass. Per-unit signature moves deserving their own design session and PWR
  taxes, not a flat stat hook.
- **Cleanup pass** — legacy `checkIncomingAttacks` in `combat-resolver.js`
  (unrouted dead code, superseded by `scanIncomingAttacks`); the
  **unauthenticated `/api/debug/lords` endpoint** (a real blocker the moment
  strangers can register); `assets/units/README.txt`;
  `assets/buildings/building_icons4.jpg`; the orphaned `chariot.webp`;
  `warhorse.png` still ~700 KB and worth a `.webp` convert; a TODO/console.log
  sweep.
- **Player & design wiki** — write last, once the ruleset stabilises.
  `army-guide.html`, `quest-guide.html`, `raid-guide.html` and `TESTING.md` are
  already half the source material.
- **UI / icons / art final pass** — 15 of the 20 mounts have no art and render
  their sprite glyph (the agreed ship state, not a bug — dropping in a `.webp`
  and one `image:` line is the whole job); race portrait decision; no priest
  art for any race; mercenary unit art; `.placeholder-screen` audit.
- **Google OAuth** — external config only, no code: create the Google Cloud
  client ID, paste it into Supabase Auth → Providers → Google, enable, then
  verify a new Google user lands on race selection. The button already exists.

---

## Audit findings worth not re-deriving (2026-08-03)

Verified against the code while consolidating this plan. Recorded because each
one *shrank* or *redirected* a batch:

- **Timestamps are already server-authoritative.** The refactor Nacho asked for
  is done; only the back-stamping of results is wrong. See Tanda 1.
- **The defender alert already fires at launch time.** It is screen-scoped, not
  mistimed. See Tanda 1.
- **Joint defence already works.** Only joint attack is missing. See Tanda 5.
- **Stacking beats variety because of armour maths**, not targeting. See
  Tanda 3.
- **No absolute clock time exists anywhere in the client** — every timer is
  relative. See Tanda 1.
- **`_stackDamageMult` is deliberately linear** (since 2026-07-27) and so is
  PWR pricing, which was supposed to make army *shape* cost-neutral. The armour
  bug is what defeats that intent.

---

## Shipped

**2026-08-03:** asset cache busting + build id (Tanda 0 above).

**2026-07-30:** mount **race pools** — five exclusive pools of four
(scout/field/war/apex), race-gated server-side, with read-time migration via
`resolveMountId` so nobody loses gold; mount **selling** at 60%
(`MOUNT_SELL_REFUND`, matching `DISBAND_REFUND_MAX`); **economy Phases 0–2** —
`questGold` 0.25 → 0.60, the mount ladder repriced ~5× down to 60k/60k/150k/350k
with real economic effects (`quest_bonus`, `raid_bonus`), blessings repriced per
currency, L10 ransom 1,800 → 40,300. PAYBACK failures went 22 → 1. See
`ECONOMY-AUDIT.md` and `ECONOMY-REBALANCE-PLAN.md` for the measurements.

**2026-07-29:** Ambush stance **removed** end-to-end (it was client-only and
never observable server-side; ambush now exists only as the PvE expedition
outcome in `catch-up.js`'s `_resolveAmbush`); the **Account screen**
(`js/ui/account-view.js` — identity + Supabase-native password change); the
**recruitment gate** — `/api/city/recruit` was enforcing nothing, and three
live exploits were reproduced before `js/domain/unit-unlock.js` became THE gate
for client *and* server; expedition **reward pump + ER-gated find quality**;
race balance bands (every race 40–60% at every stage).

**2026-07-27 → 28:** lord capture / fallen / ransom / release; army costs and
PWR on a formula with a drift guard; talent battle hooks; quests reworked into
**Expeditions**; unit healing; same-tile **troop exchange**; **temple
blessings**; build/recruit/attack **cancel buttons**.
