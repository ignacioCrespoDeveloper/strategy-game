# Hexfront — Economy Audit (2026-07-30)

Scope requested: resource production, gold, city population, raid/quest income,
blessing prices and buffs, mount costs, city/lord expansion costs, unit costs,
research and building costs. **Audit only — nothing changed.**

Every number below is read from the live defs via `server/engine-loader.js`, not
estimated. Reproduce with `node scripts/economy-projection.js --days 40`.

**Reference income** (the projection's day-25 endgame: 7 lords / 7 cities /
L10 lords / the shipped `js/data/tuning.js` dials):

| | per day |
|---|---|
| gold | **110,000** |
| resources (F+W+S) | **1,150,000** |
| gold mix | raid 53% · cities 34% · expeditions 12% |
| resource mix | expeditions 55% · cities 26% · raid 19% |

---

## What already checks out

Worth stating plainly, because most of the system is coherent:

- **Unit pricing is exact.** All 12 human units match `getUnitGoldCost` to the
  gold — zero drift between the formula and the data. The tier premium reads
  cleanly: 12.0 g/PWR infantry/ranged, 18.0 cavalry/elite, 24.0 artillery/monster.
- **Expansion curve.** Lords 10k→320k and cities 8k→256k on a clean ×2 ladder.
  Lord 7 pays back in 27 days on raid gold alone; city 7 in 30 days. Total
  expansion demand 1,134,000 gold. Coherent.
- **Core progression pacing.** Gold demand met day 28, resource demand day 29,
  against a 14–28 target. Essentially on target — this matches your read that
  the pace feels right.
- **The merchant.** 30,000 gold/day cap at Marketplace 10 ≈ 27% of gold income,
  requiring 600,000 wood/day (52% of resource income) to fill. Correctly sized
  as a dump valve rather than an income channel.
- **Population pacing.** ~14 days from founding to city tier 6 at the growth
  ceiling. Reasonable.
- **Single-source refactors hold.** Raid rate, travel time, PWR and build time
  each have exactly one definition; the earlier hand-copied duplicates are gone.

---

## A. ROOT CAUSE — prices are anchored to income the game no longer produces

**This explains roughly half of everything below. Fix it first.**

Every price set on 2026-07-30 was anchored against income measured with the
tuning dials at 1.0. The shipped dials are not 1.0:

```
buildingProduction  0.5      questGold       0.25
populationGold      0.5      questResources  0.5
```

So real income is **~40% of what the prices assume**. Three different anchor
claims are written into the codebase, and all three disagree with each other
*and* with reality:

| Claim in code | Says gold/day | Says res/day | Reality |
|---|---|---|---|
| `lord-classes.js` mount pricing note | 124,000 | — | 110,000 |
| `blessings.js` reprice note | 190,000 | 2,100,000 | 110,000 / 1,150,000 |
| `market-core.js` rate note | 250,000 | 3,100,000 | 110,000 / 1,150,000 |

`scripts/economy-projection.js` already detects this and reports `OFF 0.4x` on
every income anchor — but the anchors are labelled "BASELINE, measured
immediately after Change B+C landed", so the warning reads as a regression when
it is actually the dials doing their job.

**You said you like the pace. That makes the dials ground truth and the prices
wrong, not the reverse.** Two coherent options, and they are mutually exclusive:

1. **Keep the dials, reprice the sinks** — divide gold prices by ~2.3 and
   resource prices by ~2.0. Preserves the feel you tested.
2. **Raise the dials back toward 1.0 and slow something else** (travel time,
   build time) to hold the pace. Bigger blast radius.

Either way, re-baseline the three anchor rows in `economy-projection.js` to what
the shipped dials actually produce, or the script will keep crying wolf.

---

## B. Mounts — the one you already spotted, quantified

| item | gold | +PWR cap | +gold/day | payback |
|---|---|---|---|---|
| lord 7 | 320,000 | **1,000** | 11,760 | 27 days |
| city 7 | 256,000 | 0 | 8,640 | 30 days |
| scout mount | 300,000 | 0 | 0 | never |
| field mount | 300,000 | 0 | 0 | never |
| war mount | 800,000 | 0 | 0 | never |
| apex mount | 1,500,000 | 200 | 0 | never |

- An **apex mount costs 1.32× every lord and every city in the game combined**
  (1,500,000 vs 1,134,000).
- Per point of army cap: griffon **7,500 gold/PWR** vs lord 7 at **320
  gold/PWR** — the lord is 23× more efficient *and* comes with an income stream.
- The `strategist` talent grants +100 PWR cap for **zero gold**. The 1,500,000
  gold mount grants +200.
- Full ladder per lord (scout→war→apex) = 2,600,000 gold = **24 days of gross
  gold income with zero other spending.** For 3 lords, 71 days.

**Second, separate problem: mounts are priced by slot, not by effect.**

| mount | cost | effect | economic value |
|---|---|---|---|
| human_lion (scout) | 300,000 | +2 atk, +1 spd, **ER ×1.15** | real — see below |
| warhorse (field) | 300,000 | +2 atk, +2 spd | none |
| human_pegasus (war) | 800,000 | +3 atk, +1 def, +3 spd | none |
| griffon (apex) | 1,500,000 | +4 atk, +2 def, +4 spd, +200 cap | +200 cap |

The scout mount's ER ×1.15 is the only mount effect that touches income: it
lifts a lord at ER 700 to 805, crossing the 800 Legendary threshold, which
raises find value from 10,162 to 15,530 resources — **+53% expedition
resources**. It is also the cheapest mount, tied with the one that does nothing.

**Lever:** price mounts as a *stat* purchase in the 30k–120k band (comparable to
a talent point or a partial army), and let expansion stay the 320k-and-up
decision. Or keep them expensive and give them income effects that justify it.
Do not do both.

---

## C. Blessings — 3 of the 4 cannot pay for themselves

Cost at full uptime: **72,000 gold/day (65% of all gold income) + 144,000
res/day (13% of resource income).** At the projection's assumed 50% uptime,
still 33% of gold income.

| blessing | gain/day | net gold | net res |
|---|---|---|---|
| god_of_destruction | +33,110g +299,000res | **−38,890** | **+155,000** |
| god_of_nature | +74,750 res | −72,000 | **−69,250** |
| god_of_fertility | +1,452 g/day (permanent) | −70,548 | −144,000 |
| god_of_war | 0 (outside PvP conquest) | −72,000 | −144,000 |

- **god_of_nature is mathematically incapable of breaking even.** It boosts only
  building production — 26% of resource income — by 25%. That is +74,750 res
  against a cost of 144,000 res. It loses money before you count the gold.
- **god_of_fertility** pays 1,452 gold/day permanently per day of uptime, for
  72,000 gold + 144,000 res. ~50-day payback on the gold alone, ~100+ with
  resources. Note `pop_growth_bonus` is applied *after* the clamp in
  `catch-up.js:830`, so it does work — it is just priced far above its yield.
- **god_of_destruction** is the only positive blessing, and it converts gold
  into resources at roughly 39,000 gold → 155,000 resources per day. The
  merchant does the opposite trade at 20 wood : 1 gold. Together those two
  define an exchange rate the design never intended.

**The 2026-07-30 reprice achieved the opposite of its stated goal.** Its note
says the resource cost exists because "gold alone could never absorb" the
surplus. In practice the blessing drains **65% of gold and 13% of resources** —
it is a gold sink with a resource garnish, aimed at the wrong pool. This is
finding A applied to one price: it was set against 190,000 gold/day.

---

## D. Expedition gold has collapsed to raid parity

Per lord-hour at L10, Legendary band:

| channel | gold/hour | resources/hour |
|---|---|---|
| raiding (passive, zero attention, zero risk) | 490 | 1,830 |
| expeditions (attention + travel + ambush casualties) | 608 | 27,950 |
| ratio | **1.24×** | **15.3×** |

`economy-core.js` states the design as: *"Expeditions still pay several times
more per hour, which is the point: you are paid for attention and casualties,
not for parking a lord."* That is true for resources and false for gold.

`questGold: 0.25` (the harshest dial in the file) has turned expeditions into a
resource-only channel. They supply 55% of resources but only 12% of gold, while
raiding — which costs nothing but a locked lord — supplies 53% of gold.

Compounding it, the rationale in `discovery-roll.js` for keeping expedition gold
low is now stale: *"Gold buys UNITS and nothing else... demand is therefore
BOUNDED."* Since 2026-07-30 gold also buys 1,134,000 of expansion and up to
18,200,000 of mounts. Gold demand is no longer bounded, but expedition gold is
still priced as if it were.

---

## E. Research — both books are dominated at every level

Cost grows ×1.8/level against a **linear** benefit, so cost per 1% of effect
grows 1.8× every level:

| | L1 | L5 | L10 |
|---|---|---|---|
| engineering_tomes (res per 1% build speed) | 2,500 | 13,122 | **247,949** |
| cartography (res per 1% march food) | 5,100 | 53,536 | **1,011,631** |

- **Cartography can never pay back.** L10 costs 2,269,788 resources cumulative
  for −10% march food. A full army marching 5 tiles burns 2,500 food; the book
  saves 250. You would need ~9,000 five-tile marches to break even. Even at L1
  it needs ~200 marches.
- **Engineering Tomes are strictly dominated by Town Hall levels.** Town Hall
  L10→L11 costs 887k and takes the divisor ÷11→÷12 (−8.3% build time), *plus*
  gates city tier, *plus* four stat effects. Engineering Tomes L10→L11 costs
  890k for −2% and nothing else. The Town Hall is 4× better per resource on the
  shared axis and does three other jobs.

With only two books in the catalog and both dominated, the Library currently has
no reason to exist beyond gating itself.

---

## F. Civic buildings stop mattering at ~5,000 resources of investment

Population growth is `pct × 1130`, and `pct` tops out at **+0.53**:

```
happiness >= 70  -> +0.30
hygiene   >= 60  -> +0.15
food rate  > 0   -> +0.08
                    ----
                    +0.53   (clamp is +0.55 — never reached)
```

So **599 pop/hour is the ceiling for every city in the game**, and it is reached
with roughly **Farm 4 + Aqueduct 3 + Temple 2 ≈ 5,000 resources**. Verified:
that loadout gives happiness 82 / hygiene 64 at pop 25,000 → 599 pop/h, the same
rate as the fully-built 100,000-pop city in the probe.

Consequences:
- The **Aqueduct earns its keep** — pop pressure is `−1 hygiene per 2,000 pop`,
  so it must keep scaling. Correct design.
- **Courthouse and Tavern have no economic function** once happiness ≥ 70.
  Courthouse L10 costs 226,656 and Tavern 113,325 for effects that only matter
  below the threshold you already cleared for 5k.
- **Temple and Marketplace survive on secondary jobs only** — Temple level =
  blessing hours cap, Marketplace = the merchant's daily cap. Their stat effects
  are dead weight.

The projection's CORE resource basket puts civic buildings at L8 across 7
cities. A large share of the 18.7M "core demand" is therefore spent on effects
that do nothing.

---

## G. The three producers have a 12× payback spread

Cost of level N ÷ extra production per hour, at the shipped 0.5 dial:

| | L5 | L10 | L15 | L20 |
|---|---|---|---|---|
| lumber_mill | 0.5 d | 1.6 d | 6.1 d | **24 d** |
| stone_quarry | 0.8 d | 4.2 d | 21.7 d | **118 d** |
| farm | 5.5 d | 19.5 d | 73.2 d | **288 d** |

Two independent causes, both in `buildings.js`:
- The quarry uses cost factor **1.6** where the mill and farm use **1.5**, so it
  compounds worse forever.
- The farm's cost base is **300** (225 wood + 75 stone) against the mill's **75**
  — 4× the price — for a production base of **10** against the mill's **30**.
  That is **12× worse per unit of output** before any curve applies.

The farm is also the least-needed resource: blended supply vs. building demand
runs food 1.29× (surplus), stone 1.20× (surplus), **wood 0.73× (bottleneck)** —
because raiding pays all three equally and expeditions skew stone-heavy
(food 30% / wood 26% / stone 45% by weight), which dilutes the mill's advantage.

So the most expensive producer feeds the most over-supplied resource, and the
cheapest feeds the bottleneck. That is survivable — cheapest-first play
self-corrects toward wood — but the farm is effectively a dead building past
about L8, kept alive only by the `food rate > 0` flag in pop growth.

---

## H. The apex tier is a cliff, not a long tail

| building | L1 cost | L3 cum | L10 cum | L10 build time |
|---|---|---|---|---|
| fortress | 3,200,000 | ~11.3M | 581M | 19.8 h |
| imperial_palace | 4,800,000 | ~29M | 2.14B | 396 h |
| dragon_lair | 6,000,000 | ~42M | **6.14B** | **1,024 h** |

- **Fortress L1 = 3,200,000 resources, gated behind Guard Post 3 + Barracks 2 —
  which cost ~8,900 resources combined. A ~360× jump across a prereq.** The
  practical effect is that city defence is either dirt cheap (Guard Post, 108k
  to L10, scaling garrison) or unreachable. There is no middle.
- **dragon_lair uses factor 2.0**, so its practical ceiling is L2–L3 forever and
  the `maxLevel: Infinity` intent does not hold. L10 is 14.6 *years* of endgame
  income and a single level takes 43 days to build.

L1–L3 of the apex tier is a defensible long tail (25–36 days of full resource
income). Everything above it is decoration.

---

## I. Units are correctly priced but the curve is too flat at the top

The PWR cap grows **3.6×** across the game (280 at L1 → 1,000 at L10). Income
grows **27×** (4,000 → 110,000 gold/day).

| lord level | cap | cheapest fill | dearest fill | as % of that day's gold income |
|---|---|---|---|---|
| L1 (day ~3) | 280 | 3,348 | 6,723 | **84% of a day** |
| L10 (day ~25) | 1,000 | 11,958 | 24,012 | **11% of a day** |

Early, an army is a real commitment. At endgame you can rebuy **six full
armies per day**, so battle losses stop registering — which is the same problem
the 3.5→12.0 `GOLD_PER_PWR` change was made to fix, just relocated to the top of
the curve. Because the cap is hard, you cannot fix this by raising gold prices
alone without making the early game unplayable; the cap itself has to scale, or
gold needs a sink that grows with income.

---

## J. Lord capture has no economic teeth

`lordRansomCost = 300 + 150 × level` → **1,800 gold to free a level-10 lord.**
That is 15 minutes of endgame gold income for losing your lord in a PvP fight.
Compare: the mount that lord is wearing costs 1,500,000.

---

## Priority order (my recommendation)

1. **A — re-anchor.** Everything else is measured against the wrong baseline
   until this is settled. Decide: keep dials + reprice sinks, or raise dials.
   Then re-baseline the three anchor rows in `economy-projection.js`.
2. **B — mounts.** Biggest single distortion, and you already feel it. Cheapest
   fix: drop the ladder to 30k/30k/80k/150k (÷10) and it lands between "a talent
   point" and "a new lord", which is where a cosmetic-plus-stats item belongs.
3. **C — blessings.** Reprice against real gold income and make god_of_nature
   and god_of_fertility capable of breaking even, or cut them the way
   god_of_commerce was cut.
4. **D — expedition gold.** Raise `questGold` toward 0.6–0.8 so expeditions beat
   parked raiding on the axis they cost you attention for.
5. **E/F — dead systems.** Both Library books and the Courthouse/Tavern line
   currently have no payoff. Either give them one or remove them; per the
   vertical-slice rule, a building that changes no number the player sees is
   scaffolding.
6. **G/H/I/J** — real but slower-burning.

Items 1–4 are all price changes in data files. None of them require touching
game rules.
