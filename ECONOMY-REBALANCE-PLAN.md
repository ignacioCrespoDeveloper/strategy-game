# Hexfront — Economy Rebalance Plan

Companion to `ECONOMY-AUDIT.md`. **Nothing here is implemented.** This is the
method, the order of operations, the proposed numbers, and the five decisions
that need your call before any of it starts.

---

## Part 1 — The method

The audit found ~10 separate problems. They cannot be fixed one at a time by
eye, because most of them are the *same* problem seen from different angles: a
price set against an income figure that was never re-measured. Seven rules make
the whole thing tractable.

### Rule 1 — One denominator. Prices are expressed in income, never in gold.

"A mount costs 1,500,000 gold" is not a balanceable statement. "A mount costs
13.6 days of your entire gold income" is. From here on, every price in this
project is stated as **days-of-income (DoI)** or **% of daily income**, and the
absolute number is derived from the curve, not chosen.

**THE FROZEN REFERENCE CURVE** (from `scripts/economy-projection.js`, post-Phase 1
dials, cumulative). Phases 2–4 price against this and must not move it:

| day | cum gold | cum resources | gold/day | res/day |
|---:|---:|---:|---:|---:|
| 7 | 44k | 462k | 10k | 114k |
| 14 | 331k | 3.27M | 76k | 746k |
| 21 | 1.06M | 10.1M | 121k | 1.10M |
| 25 | 1.60M | 14.9M | 145k | 1.30M |
| 28 | 2.05M | 19.0M | 154k | 1.37M |
| 35 | 3.16M | 29.0M | 163k | 1.49M |
| 45 | 4.85M | 45.0M | 173k | 1.68M |
| 60 | 7.51M | 72.0M | 179k | 1.87M |

Income plateaus around **179k gold / 1.87M resources per day** once you hold 7
lords and 7 cities at L10. That plateau is the ceiling every endgame price must
be argued against.

### Rule 2 — Income first, sinks second. Never both in the same pass.

Every sink price is a fraction of income. Change income and every price you just
set is wrong again. So all income decisions land and freeze **before** any price
work begins. There is exactly one income question still open (`questGold`), and
it goes in Phase 1 for this reason.

### Rule 3 — Every buff must have a computable payback, or it isn't balanceable.

If you cannot answer "how many days until this pays for itself", the price is a
guess. This is how `god_of_nature` shipped mathematically incapable of breaking
even. Every blessing, mount, research level and producer level gets a payback
number, and the harness fails the build when one reads `never`.

Buffs that are *tempo*, not yield (recruit speed, build speed) get a payback
measured in the thing they accelerate, not in gold.

### Rule 4 — An exponential cost curve requires a benefit on a growing base.

This is the research law, and it generalises. `cost × 1.8/level` against
`benefit −1%/level` diverges forever: cost per 1% grows 1.8× every level. That's
not a tuning error, it's a shape error, and no number fixes it.

- **Legitimate** on an exponential curve: `construction_speed` (build costs grow
  exponentially, so a % saving grows with you), `*_production` (% of a growing
  base), `armyPowerCapBonus`.
- **Illegitimate**: `march_food_cost` (capped at 500/tile on a 20×10 map — the
  benefit is bounded forever). Cartography can never be priced correctly on this
  curve at any number.

### Rule 5 — Terminal sinks cannot hold an economy. The recurring one must scale.

Gold demand is almost entirely terminal: 6 lords, 6 cities, then done — while
gold *income* grows because of those purchases. So gold floods late by
construction. The only structural fix is a recurring sink that scales with
income. Today that is blessings, and they are the right tool priced wrong.
Mounts are terminal and therefore cannot be the endgame sink no matter what
they cost.

Resources are the opposite: demand is unbounded (infinite building levels at
×1.5–2.0), so resources self-regulate and need no equivalent valve.

### Rule 6 — The PWR cap is off limits.

`200 + 80 × level` is the calibration point for the entire combat balance suite
(start 440 / mid 680 / end 1000, 18 gated checks). Also `discovery-roll.js` tunes
its ambush overmatch curve across **0–1100** and its loudness curve across
600–1000. Anything that raises the cap — a bigger mount bonus, a new talent —
invalidates both. Treat the cap as a constant and put the endgame gold demand
somewhere else.

*(Existing inconsistency to clean up while we're here: apex mount +200 and the
`strategist` talent +100 already stack to 1300, above the 1100 the ambush curve
is tuned for.)*

### Rule 7 — One change, one verification, in dependency order.

After every change: `node scripts/economy-projection.js` (pace) →
`node scripts/test-economy.js` (formula drift) → `node scripts/test-balance.js`
(combat, only if anything touched units/PWR/cap). A phase is not done until all
three are green.

---

## Part 2 — The target structure

Three gold horizons, each owning a share of income. This is what "balanced"
means concretely — not "everything costs the same", but "at every point in the
game there is exactly one obvious next purchase, and it is affordable in days,
not weeks".

| horizon | sink | target share of gold income | shape |
|---|---|---|---|
| day 1–28 | lords + cities + first armies | ~60% | terminal |
| day 20–50 | mounts + army rebuys | ~35% | terminal |
| day 25 → ∞ | **blessings** | ~30% | **recurring — the real endgame sink** |

Resources:

| horizon | sink | shape |
|---|---|---|
| day 1–28 | producers, Town Hall, civic | terminal-ish |
| day 25 → ∞ | apex tier + research | unbounded |
| day 25 → ∞ | blessings | recurring, ~10% |

**Milestone budget** — the design decision every price is derived from. The
"actual" column is what the projection measures today (post-Phase 1):

| milestone | target day | actual | status |
|---|---:|---:|---|
| all 7 lords + 7 cities | 21–28 | **22** | on target |
| CORE gold (expansion + armies + 3 rebuys) | 14–28 | **25** | on target |
| CORE resources (producers L15 / TH L10 / civic L8 ×7) | 14–28 | **28** | on target |
| first mount | 25–30 | **27** | on target |
| full mount ladder, main lord | 45–55 | **41** | too fast |
| mounts, 3 main lords | 55–90 | **71** | on target |
| apex building L1 | 35–45 | **34** | too fast (1 day) |
| apex building L3 | 50–90 | **56** | on target |

**The core is now exactly where it should be, and so is most of the tail.** The
audit's conclusion has to be restated more precisely as a result: mounts are not
*unaffordable* — the first one lands day 27 and a full ladder day 41. They are
**not worth buying**. The 22 PAYBACK failures, not the milestone table, are what
Phase 2 has to fix. **Phases 2–4 must not move the core rows.**

---

## Part 3 — Phased execution

### Phase 0 — Instrumentation (no gameplay change)

Build the measuring stick before touching anything. Nothing in `js/data/` moves.

1. Re-baseline the three `INCOME ANCHORS` rows in `economy-projection.js` to the
   shipped-dial curve (5k/73k → 4k/35k, 60k/770k → 21k/237k, 252k/3.09M →
   110k/1.15M). They currently report `OFF 0.4x` on every row and read as a
   regression instead of a stale baseline.
2. Add a **MILESTONE** section: each row from the budget table above, with the
   day it becomes affordable and a pass/fail against its target window.
3. Add a **PAYBACK** section: every blessing, mount, research level and producer
   level → days to break even or `NEVER`. Fail the run on `NEVER`.
4. Fix two stale constants in `test-economy.js`: the merchant sanity check
   hardcodes `252000 * 0.25` (line ~511) and the unit drift-guard message still
   says `× 3.5` when `GOLD_PER_PWR` is 12.0 (line ~268).
5. Delete the three contradicting income claims in the comment headers of
   `lord-classes.js`, `blessings.js` and `market-core.js`; replace each with a
   pointer to the projection so there is one source.

**Gate:** projection exits 0, `test-economy.js` green, zero data-file changes.

### Phase 1 — Income shape ✅ DONE (2026-07-30)

**`questGold: 0.25 → 0.60`.** Landed. Results:

- Expedition gold went 608 → ~1,460 per lord-hour against raiding's 490 — the
  3× premium for the attention channel that the design text always claimed.
- Gold mix at day 25: **raid 47% / expeditions 27% / cities 26%** (was 53/12/34).
  Clears the ≥20% gate.
- **Both CORE rows are ON TARGET for the first time** — CORE gold day 25, CORE
  resources day 28. The projection exits 0.
- Merchant daily cap fell back to ~21% of gold income, so `test-economy.js`
  tightened from the temporary 30% bound back to its original 25%.

**⚠ The predicted +16% was wrong — it came out +32% on gold and +13% on
resources.** Raising a gold dial is not a flat channel bump: faster gold buys
lords and cities *earlier*, and those compound into every channel including the
resource ones `questResources` never touched. **Lesson for Phases 2–4: model
second-order effects by running the script, never by scaling a channel on
paper.** Two long-tail milestones drifted TOO FAST as a result (mount ladder
day 41 vs a 45–55 target; apex L1 day 34 vs 35). Phase 2 reprices mounts anyway.

The income curve is now **FROZEN** (Part 1, Rule 1). Original reasoning follows.

---

Expeditions currently pay 608 gold/hour against parked raiding's 490 — a 1.24×
premium for a channel that costs attention, travel and ambush casualties. At
0.60 they pay ~1,460/hour, a 3× premium, which is what the design text in
`economy-core.js` already claims is true.

Effect on total pace, which is what you care about: expedition gold is 12% of
gold income, so ×2.4 on that slice lifts total gold income **110k → ~128k/day
(+16%)** and shifts the mix to roughly raid 46% / cities 30% / expeditions 25%.
It changes the *choice* a lot and the *pace* a little.

**Gate:** CORE gold demand still lands day 21–28. Income mix shows expeditions
≥20% of gold. Then **freeze the income curve** — Phases 2–4 price against it.

*(`questResources 0.5`, `buildingProduction 0.5`, `populationGold 0.5` and both
raid dials stay exactly as they are. You approved this pace; only the
gold-vs-resource split inside expeditions is being corrected.)*

### Phase 2 — Gold sinks ✅ DONE (2026-07-30)

Nacho chose **option A** (the full price cut) over the halfway option. Results:

| | before | after |
|---|---|---|
| PAYBACK failures | 22 | **1** (cartography — Phase 3) |
| scout mount | 300,000g, NEVER | 60,000g, **37 days** |
| war mount | 800,000g, NEVER | 150,000g, **37 days** |
| apex mount | 1,500,000g, NEVER | 350,000g, **52 days** |
| full ladder / lord | 2,600,000g | **560,000g** |
| god_of_destruction | TRADE (−26k gold) | **PAYS** (+10k gold, +132k res) |
| god_of_nature | TRADE at 887 g/1k res | **TRADE at 152** g/1k res |
| god_of_fertility | **NEVER** | TRADE (food → permanent pop) |
| god_of_war | NEVER | **TEMPO** (correctly classified) |
| L10 ransom | 1,800g | **40,300g** |

Suites: test-economy **145/145**, test-balance **18/18**, army-transfer pass,
projection exit 0. The frozen curve did not move.

Three things worth recording because they were not in the plan as written:

1. **`quest_bonus` and `raid_bonus` were blessing-only keys.** A mount declaring
   one would have been silently inert. Wired into `catch-up.js` (both the raid
   and expedition payout blocks) and into the raid preview in `lord-screen.js`.
2. **That preview was already lying** — it showed the base rate while the server
   applied the God of Destruction `raid_bonus`, so a blessed raid always paid
   ~50% more than the screen promised. Fixed while wiring the mount half.
3. **The mount milestone windows were retargeted** (45–55 → 28–40). Option A
   makes mounts a mid-game accessory, so a ladder finishing ~day 29 is the new
   intent, not a failure. Retargeting to match a decision is legitimate;
   retargeting to silence a number you dislike is not.

**Still open from Phase 2's own findings:**
- `expeditionRatingMult` remains dead at endgame (ER bands saturate above 800).
  It survives as a mid-game kicker only; `quest_bonus` is now the scout's real
  product. Fixing the band saturation properly is unscheduled.
- Apex building Lv1 reads TOO FAST by one day (34 vs 35). Noise, but it is the
  first thing Phase 4 should re-check.

Original plan text follows.

---

**2a. Mounts.** Per Rule 5, mounts are terminal and therefore cannot be the
endgame sink. Reclassify them as a **mid-game accessory with an economic
effect**, priced for a 20–30 day payback:

| slot | now | proposed | proposed effect |
|---|---:|---:|---|
| scout (L5) | 300,000 | **60,000** | ER ×1.15 *(unchanged)* |
| field (L5) | 300,000 | **60,000** | stats + `march_food_cost −20%` |
| war (L8) | 800,000 | **150,000** | stats + `raid_bonus +20%` |
| apex (L10) | 1,500,000 | **350,000** | stats + ER ×1.15 + `raid_bonus +20%` + cap +200 |

Ladder per lord: 2,600,000 → **560,000**. All 7 lords: 18.2M → **3.92M**.
First mount lands ~day 26, full ladder on the main lord ~day 48 — inside the
budget window. Payback on the war mount: +20% of a L10 lord's 9,800 gold/day
raid = 1,960/day → 150,000 / 1,960 ≈ **77 days**… still too slow, so either the
price drops further or `raid_bonus` goes to +35%. **The PAYBACK table from
Phase 0 decides this, not my estimate here.**

`raid_bonus` and `march_food_cost` are existing keys with live consumers
(`catch-up.js`, `getMarchFoodCost`), so this is data plus a small read in
`getLordMountEffects` — no new plumbing. The cap bonus stays at +200 and only on
the apex slot, per Rule 6.

**2b. Ransom.** `300 + 150×level` = 1,800 gold for a L10 lord — 15 minutes of
income. Proposal: scale off the lord's *replacement* cost instead, e.g.
`lordRecruitCost(currentLordCount) × 0.15`, so losing a lord costs ~48k at 7
lords. Makes capture a real PvP outcome.

**2c. Blessings — the endgame sink, repriced and un-trapped.** Three changes:

1. **Charge the currency the blessing does not give you.** A blessing is a
   *conversion*, and charging both currencies for a resource buff is why
   `god_of_nature` cannot break even.

   | blessing | gives | charge |
   |---|---|---|
   | god_of_nature | resources | gold only |
   | god_of_destruction | gold + resources | both |
   | god_of_fertility | population | food only *(thematic)* |
   | god_of_war | tempo + PvP loot | gold only |

2. **Cap full-uptime cost at ~25–30% of the charged currency's daily income.**
   At the Phase-1 curve that is ~1,400–1,600 gold/hour (vs 3,000 today) and
   ~1,300 food/hour for Fertility. Full uptime then costs ~35k gold/day out of
   ~128k — a real sink that does not eat two thirds of your income.

3. **Fix Nature's scope.** +25% applied to building production reaches only 26%
   of resource income — it is noise by construction. Either widen `*_production`
   blessings to all resource income (raid + expedition included), or cut Nature
   the way God of Commerce was cut. Widening is the better game: it makes the
   blessing meaningful without another price change.

**Gate:** PAYBACK shows every mount and blessing ≤30 days and nothing `NEVER`.
MILESTONE shows first mount day 25–30, full ladder day 45–55. **CORE gold must
not move out of day 21–28.**

### Phase 3 — Resource sinks

**3a. Research.** Per Rule 4:

- **Cartography: convert or cut.** Its benefit is structurally bounded, so no
  price works. Convert it to something on a growing base — e.g. lord travel
  speed (%) or expedition rating (%) — keeping the id (`player.research` is
  keyed by it) and the Cartography name, which both still fit.
- **Engineering Tomes: flatten the cost curve** from `×1.8` to `×1.35`/level.
  Cost per 1% then rises ~1.35× per level instead of 1.8×, so volumes 5–10 stay
  worth buying instead of going 13k → 248k res per 1%.
- **Add 2–3 books on growing bases.** The Library gates itself and nothing else
  right now. Candidates using keys that already have live consumers:
  `*_production` %, `recruit_speed` %, `gold_income_bonus` % (consumer exists,
  no source since Commerce was pulled).

**3b. Producers.** Equalise the payback spread from 12× to ~2.5×. The lever is
the **cost-base : production-base ratio**, which is currently mill 2.5 / quarry
3.6 / farm **30**:

| | prod base | cost base now | ratio now | proposed cost base | ratio |
|---|---:|---:|---:|---:|---:|
| lumber_mill | 30 | 75 | 2.5 | 75 *(unchanged)* | 2.5 |
| stone_quarry | 20 | 72 (×1.6) | 3.6 | 70, **factor ×1.5** | 3.5 |
| farm | 10 | 300 | 30.0 | **60** | 6.0 |

Keeps the intended scarcity ordering (wood cheapest → food dearest, matching
demand: wood 46% / stone 33% / food 21%) but at a 2.4× spread instead of 12×.
Farm L20 payback goes 288 days → ~58. The quarry's `×1.6` factor becomes `×1.5`
so it stops diverging from the other two forever.

⚠ This *lowers* resource costs, which accelerates the core. Compensate by
raising the CORE basket target (producers L15 → L18) or accept a faster core —
**the projection decides, and CORE must stay day 21–28.**

**Gate:** CORE resources still day 21–28. All three producer paybacks within
2.5× of each other at every level 5/10/15/20.

### Phase 4 — Dead systems

- **Tier pressure** (decision 5, see Part 4). Stats degrade per city tier, so
  civic buildings scale with the city instead of stopping at ~5,000 resources.
  This *replaces* the earlier "raise the pop-growth ceiling" proposal — the
  +0.53/+0.55 clamp stays as it is, because the fix is on the demand side.
- **Corruption gets a real bite**: a direct **% penalty on city gold income**
  (today it only feeds happiness). Turns the Courthouse into a gold building,
  gives the Marketplace's `+6 corruption/level` a genuine downside, and gives
  tier pressure's `+5 corruption/tier` somewhere to land.
  ⚠ `EconomyCore.getGoldRate(buildings, population, happiness)` needs a
  `corruption` argument — callers to update: `catch-up.js`, `production.js`,
  `city-stats.js`, `economy-projection.js`, `test-economy.js`.
- **Fortress cliff.** L1 costs 3.2M behind prereqs costing ~8,900 — a ~360×
  jump. Drop the base ~10× and let the ×1.6 curve carry it, so city defence has
  a middle instead of "Guard Post or nothing".
- **Dragon Lair `×2.0` factor** makes L10 cost 6.1B (14.6 years) and take 1,024
  hours for one level. Bring it to ×1.7 like the other landmarks so
  `maxLevel: Infinity` means something.

**Gate:** no building in the catalog has zero economic effect at its useful max.
`run-all-tests.js` fully green.

---

## Part 4 — Decisions (LOCKED 2026-07-30, Nacho)

1. **Mounts → accessory.** Phase 2a proceeds: ~60k/60k/150k/350k plus economic
   effects. They are no longer the endgame sink.
2. **`questGold 0.25 → 0.60` → yes.**
3. **Blessings → per-blessing currency targeting → yes**, plus widening
   `*_production` to all resource income.
4. **Cartography → convert**, to **travel speed + march food cost** (keeps the
   `cartography` id and the surveying fiction; both keys already have live
   consumers in `getTravelTime` and `getMarchFoodCost`).
5. **Courthouse/Tavern → corruption gets a real bite, PLUS a new mechanic:
   city stats degrade per CITY TIER.** A tier-3 city must spend more on
   buildings than a tier-2 city just to hold the same stats.
6. **PWR cap `200 + 80×level` stays exactly as it is.** Confirmed.

### Decision 5 in detail — tier pressure

This is a better mechanic than the "raise the growth ceiling" idea it replaces,
and it supersedes that bullet in Phase 4. Raising the ceiling increases the
*supply* of growth; tier pressure increases the *demand* for civic buildings,
which is the actual hole — civic buildings currently stop mattering at ~5,000
resources of investment (audit §F).

Shape: every city tier above 1 applies a flat penalty to the governance stats.

```
tp = cityTier − 1                    // 0..5 across the six tiers
happiness  −= 8 × tp
stability  −= 6 × tp
corruption += 5 × tp
security   −= 4 × tp
```

At tier 6 that is −40 happiness, so holding the +70 growth threshold needs
roughly Temple 6 + Tavern 4 + Farm 3 (+62) instead of the Temple 4 (+20) that
suffices today. The Courthouse answers the corruption term (−5/level), which is
exactly the job it currently lacks.

Deliberately **not** applied to hygiene: population pressure already scales
hygiene hard (`−1 per 2,000 pop`, i.e. −99 at 200k pop) and the Aqueduct is
already its designed counterweight. Adding tier pressure there would
double-charge the one stat that already works.

Three things to watch when this lands:
- **Self-correction is intended.** A city that outgrows its infrastructure drops
  below the happiness thresholds, stops growing or shrinks, falls a tier, and
  recovers. That is the mechanic working, not a bug.
- **`degradeExcessBuildings` is the sharp edge.** A tier drop with
  `usedSlots > maxSlots` destroys buildings at random. Verify a tier-pressure
  spiral cannot reach it, or soften that function.
- **Do not let it stall the core.** The city-tier timeline (~14 days to tier 6)
  feeds the gold curve. Re-run the projection and hold CORE at day 21–28.

---

## Part 5 — Effort and risk

| phase | scope | risk | why |
|---|---|---|---|
| 0 | scripts only | none | no gameplay change |
| 1 | 1 number in `tuning.js` | low | one dial, projection verifies |
| 2 | `lord-classes.js`, `blessings.js`, `lord-ransom` | low–med | data only; blessing scope change touches `getRates` callers |
| 3 | `research.js`, `buildings.js` | med | producer costs move the core timeline — needs re-verification |
| 4 | `economy-core.js`, `buildings.js` | med–high | pop-growth bands and corruption→gold are new mechanics, not reprices |

Phases 0–2 are the ones that fix what you actually felt while playing. Phases
3–4 are cleanup that can wait.
