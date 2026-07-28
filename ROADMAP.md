# Hexfront — Final Roadmap

Ten items, grounded in what's actually in the code today (verified by reading
the relevant files, not assumed). Each entry has: **Current state**, **Plan**,
and **Suggestions**. A recommended priority order is at the bottom.

> **2026-07-27 mega-update:** items **#4 (Army costs & PWR)** and **#5 (talent
> battle hooks)** are now ✅ DONE, delivered as part of a much larger pass:
> - PWR unified into `EconomyCore` (getUnitPower/getArmyPower — linear stack
>   cost, weighted combat-trait tax); all nine former formula copies deleted.
> - Unit gold pricing is now formula-driven: `gold = PWR × 3.5 × tier premium`
>   (1.0 line / 1.5 cav-elite-flying-merc / 2.0 artillery-monster / 3.0
>   legendary), mercenaries included, with a drift-guard in the economy suite.
> - **29 new TWW3 units** across all five races (full building-chain tiers),
>   art wired for all but two (Halberdiers, Sisters of Slaughter).
> - Battle engine v2: linear stack damage, melee/charge overkill spillover
>   (×0.5/hop), round-3+ breakthrough targeting, power-based (HP-aware)
>   morale, 15 rounds max with a 10% draw band, terror capped −25/side.
> - Nine traits implemented that were flavor-only: heavy_armor, stubborn,
>   fearless, coward, accurate, duelist, anti_infantry, monster (×1.3 dmg),
>   double_strike — each priced in the PWR tax table.
> - Race progression curves tuned per stage (start/mid/endgame) with a
>   3-tournament balance suite (`scripts/test-balance.js`) + live matchup
>   matrices in `army-guide.html`. All endgame guardrails green.
> - See `TESTING.md` and memory for the full methodology.

---

## 1. Lord Captured vs. Lord Fallen

**Current state:** There's only one generic incapacitation mechanic today.
`_applyLordHp` (`server/combat-resolver.js`) sets, on a lord's death:
```js
lord.currentHp      = 0;
lord.downtimeUntil  = Date.now() + 60 * 60 * 1000; // 1 hour, always
lord.downtimeReason = (side === 'defender' && winner === 'attacker') ? 'captured' : 'defeated';
```
`downtimeReason` is **cosmetic only** — `js/ui/lord-screen.js` shows
"⛓ CAPTURED" vs "💀 FALLEN" based on it, but both use the identical 1-hour
timer and the identical revive-for-credits path (`server/actions/lord-revive.js`).
No ransom, no rescue, no permanent death, no other player can intervene.

**Plan:**
- Give "captured" a real mechanical distinction from "fallen":
  - **Captured** (lost while defending) — held by the attacker. Add a
    `capturedByPlayerId` field. The captor can set a ransom; the original
    owner pays it (via credits, as today) OR the captor's clan gets a
    small honor/gold reward if it goes unpaid past a longer timeout.
  - **Fallen** (lost while attacking, or any PvE loss) — a harsher outcome:
    either a meaningfully longer downtime, or a bigger one-time credit cost
    to revive, reflecting "you took the risk and lost" vs. "you were caught
    defending."
- New endpoint(s): a ransom/pay-to-free action (could reuse `lord-revive.js`'s
  shape), and a "captured lords" list somewhere visible (Activity feed entry
  at minimum).

**Suggestions:** Keep v1 narrow — the cheapest version that still creates a
real risk/reward difference is: captured lords cost noticeably more credits
to revive than fallen ones, with no cross-player ransom yet. Add the
captor-side ransom flow as a v2 once the base distinction is live and feels
right. Don't build a full "prisoner exchange" system up front.

---

## 2. Conquest on Cities

**Current state:** Doesn't exist. A city's `ownerId` is set exactly once, at
founding (`server/actions/city-found.js`), and nothing else in the codebase
ever reassigns it. Winning an attack against a city only triggers
`_lootResources` (5% of the owner's resource pool) — the city, its
buildings, and its ownership are untouched. Notably, `rankingStats.conquests`
already exists as a field but is **never incremented anywhere**; a comment in
`ranking-updater.js` confirms conquests were explicitly dropped from scoring.
This is the most architecturally invasive item on this list.

**Plan:**
- A **siege** model, reusing the time-boxed pattern already established for
  raiding stances and clan wars in this codebase: a winning attack against a
  city doesn't flip ownership instantly — it marks the city "under siege"
  (`siegeState: { attackerId, startedAt, endsAt }`). If the owner doesn't
  break the siege (win a defense) before `endsAt`, ownership transfers to the
  attacker on the next tick (mirror `clan-war-updater.js`'s structure).
- Decide what carries over on conquest: buildings likely stay (with maybe a
  population/loyalty penalty), garrison resets, any queued
  construction/recruitment is cancelled or refunded.
- Wire `rankingStats.conquests` back in at the point of transfer, and add
  activity-feed entries for both sides ("Your city is under siege!" /
  "You conquered <city>").

**Suggestions:** Treat this as its own milestone, not a bundled feature —
it touches world_state, per-player city storage, rankings, and notifications
all at once. Build it **after** garrisons (#3), so a siege actually has
something meaningful to break through; otherwise every city falls on the
first hit and the "siege" framing is pointless.

---

## 3. Garrisons on Cities

**Current state:** Garrisons exist but are **derived, not persisted** —
`_getGarrison` (`combat-resolver.js`) computes a fresh roster every single
fight straight from building levels (via each building def's
`garrisonRoster(level)` function in `js/data/buildings.js`), capped at 10
units total. There's no recruit/train action for it and nothing about it is
stored per-city; a code comment confirms this is intentional today
("recomputed fresh... nothing needs to persist here").

**Plan:**
- Keep the building-derived roster as a free baseline (undefended cities
  shouldn't be instant-kills), but add an **optional, recruitable** layer on
  top: a `city.garrisonUnits` field, a recruit-into-garrison action (same
  shape as `recruit.js`), a capacity cap derived from Fortress/Guard Post
  level, and ongoing gold upkeep.
- Update `_getGarrison` to combine the building-derived floor with whatever's
  been recruited.

**Suggestions:** Build this before Conquest (#2) — a siege mechanic is much
more interesting once players can actually invest in defense. Keep the
recruit-into-garrison flow as close as possible to the existing lord-army
recruit flow (same cost/PWR formulas from #4) rather than inventing a
parallel system.

---

## 4. Review Army Costs & PWR — ✅ DONE 2026-07-27 (except two leftovers below)

**Done:** PWR extracted to `EconomyCore` (single source, linear stack cost,
weighted trait taxes); cost-per-PWR curve is now the intentional, documented
`PWR × 3.5 × tier premium` formula (old 30–45× swing eliminated); the balance
suite regression-guards it all. **Still open from this item:**
- Delete `js/domain/recruitment.js`'s dead weight/slot system (→ #9 cleanup).
- **Unit health regeneration** (the "units never heal" known issue) — still
  not designed/built.

<details><summary>Original item (for history)</summary>

## (original) 4. Review Army Costs & PWR

**Current state:** The PWR formula —
`unitPower = attack*3 + defense*2 + floor(hp/10) + speed`, dampened by
`count^0.8` for stacks — is **duplicated in three separate places**
(`combat-resolver.js`, `recruit.js`, and referenced again from `lord.js`),
which is a drift risk on its own regardless of balance. Cost-per-PWR point
today ranges from roughly **1.7–1.9 gold/PWR at tier 1** up to **50–80
gold/PWR for legendary units** — a 30–45x swing that isn't explained by the
formula itself and isn't flagged anywhere as a placeholder (looks
hand-authored, but with no documented rationale for the curve's steepness).
Separately, `js/domain/recruitment.js`'s army-weight/slot-capacity system is
**confirmed dead code** — its own comment says it's "not actually called
anywhere any more"; the real gate live in `recruit.js` is a PWR cap
(`200 + level*80 + talent bonus`).

**Plan:**
1. Extract the PWR formula into one shared module both client and server
   import, instead of three independent copies.
2. Build a single table (spreadsheet or a throwaway script) listing every
   unit's PWR, gold+resource cost, and upkeep side by side, and decide on an
   intentional cost-per-PWR curve across tiers (e.g. "legendary units should
   cost 3–5x more per PWR point than tier 1, not 30–45x") — or explicitly
   keep the steep curve if the intent is "rare units are a luxury gold sink,"
   but write that decision down.
3. Delete the dead weight/slot system in `recruitment.js`.
4. **Add unit health regeneration** (Known Issue #6, reported 2026-07-27):
   unit damage persists between battles but nothing ever heals it — the only
   heal paths are the raiding-stance passive full-heal and disbanding the
   damaged model. Lords regen 2%/min; units regen never. Decide the design
   (passive %/min like lords? only in a friendly city? a healer building or
   upkeep cost?) and implement it in `catch-up.js` alongside lord regen so
   offline healing works too.

**Suggestions:** Do this as one data-driven pass, not scattered edits — and
do it *after* Garrisons/Conquest land, since those may introduce new unit
needs (garrison-specific units?) worth folding into the same balance pass
rather than redoing it twice.

</details>

---

## 5. Lord Talents — ✅ RESOLVED 2026-07-27 (verify pass recommended)

Both missing trait hooks now exist in the battle engine: `double_strike`
(30% second melee attack — also used by Hammerers/White Lions) and
`pyroblast` (round-1 magic splash, suppresses regeneration). All four combat
talents are mechanically live. Remaining: a quick manual pass in the Battle
Simulator to eyeball each talent's effect in a report, then close.

<details><summary>Original item (for history)</summary>

## (original) 5. Lord Talents — Verify (and Fix) Battle Application

**Current state:** Mostly already working. `TALENT_POOL`
(`js/data/lord-classes.js`) has 11 talents — 4 combat (`blademaster`,
`double_strike`, `pyroblast`, `iron_wall`) and 7 strategic. Combat talents
**are** wired into `battle-engine.js`'s `buildContext()`, which reads
`lord.talentId` via `getTalentEffects()` and applies real attack/defense
bonuses and trait additions to the lord's actual `BattleUnit` — this isn't
decorative.

**However:** `blademaster` (`armor_piercing`) and `iron_wall` (`shield_wall`)
push traits that **do** have real implementations in `battle-traits.js`, so
those two work end-to-end. But `double_strike` and `pyroblast` push trait
names that have **zero corresponding hook** in `battle-traits.js` — picking
either of those two talents currently does nothing beyond whatever base stat
bonus they have (and per their design, they have none — the trait *is* the
whole effect). This is a silent no-op for half the combat talent pool.

**Plan:**
- Implement the two missing trait hooks in `battle-traits.js`, following the
  existing pattern used for `armor_piercing`/`shield_wall`:
  - `double_strike` — ~30% chance per melee round to attack twice.
  - `pyroblast` — round-1 ranged phase, splash damage to all enemy units +
    a `burning` status that suppresses regeneration.
- Manually verify all 4 combat talents change battle outcomes using the
  existing Battle Simulator before calling this closed.

**Suggestions:** Small, contained, no dependencies — good candidate to slot
in early or opportunistically alongside any other item.

</details>

---

## 6. Review & Refactor Quests

**Current state:** 35 discovery definitions across 7 categories. Weight
distribution: resource 56%, "nothing found" 15%, combat 13%, event 9%, trade
5%, legendary 2%, intelligence 0% (scout-only, never randomly rolled).
**The variety gap is in event (3 defs) and trade (2 defs), not combat**
(which actually has the most distinct definitions at 10) — worth noting
since "too much combat" was an earlier assumption that the actual data
doesn't support. Separately, the same-tile credit-finish bug from the
Known Issues table is still open — no comment anywhere in `discovery.js` or
`lord-screen.js` references or explains it. A second symptom (folded into
the same known issue): quests completing **without anything happening** —
no reward, discovery, or feedback — possibly the same root cause, but not
yet confirmed to be limited to the same-tile credit-finish path.

**Plan:**
1. Investigate and fix the same-tile credit-finish bug first — it silently
   does nothing, which erodes trust in the whole "finish instantly" feature.
2. Add more **event and trade** variety (the actually-thin categories),
   rather than further trimming combat weight.
3. Sanity-check whether "nothing found" at 15% feels too punishing in
   practice — worth checking real quest logs/player feedback rather than
   guessing.

**Suggestions:** Keep this a data-table + bugfix pass, not a rearchitecture
of `discovery.js` — consistent with this project's audit-first,
vertical-slice philosophy.

---

## 7. Final Review on UI + Icons + Images

**Current state (concrete gaps found):**
- 3 of 5 races (human, dwarf, orc) have **no portrait art at all** —
  `auth-view.js` falls back to an emoji + gradient card.
- ~~The 2 races that declare a portrait path (high_elf, dark_elf) point to
  files that don't exist~~ RESOLVED 2026-07-27: both `race.portrait` paths
  in `races.js` now point to real per-race warrior portraits under
  `assets/lord/<race>/warrior/`.
- ~~Terrain art~~ RESOLVED 2026-07-27: all 5 terrain types now have images
  in `assets/terrain/`. (Hills was removed as a terrain type the same day;
  its tiles became mountain.)
- `assets/units/mercenaries/` has only 1 image for 6–7 mercenary units.
- Lord portrait pools are uneven per race/class (e.g. humans/high_elves
  warrior: 5 portraits each; dwarfs rogue/mage: 1 each).
- Stale leftover: `assets/units/README.txt` references old generic filenames
  that don't match the current per-race asset layout.
- `css/app.css` has a `.placeholder-screen` block explicitly built as an
  "inter-milestone bridge" — worth auditing whether any live screen still
  uses it.
- The Account nav item just shows a "coming soon" toast — not built.

**Plan:**
1. ~~Fix the two broken `race.portrait` paths~~ — done 2026-07-27.
2. Decide once: either source portrait art for human/dwarf/orc, or embrace
   the icon+gradient card for **all 5 races** for consistency — the second
   option is the fast, low-risk fix if new art isn't coming soon.
3. ~~Add art for desert terrain~~ — done 2026-07-27 (`desert.webp`).
4. Even out (or gracefully cycle) lord portrait pools per race+class.
5. Delete the stale `assets/units/README.txt`; check whether
   `assets/buildings/building_icons4.jpg` is still referenced anywhere.

**Suggestions:** Do this **last** among the feature work — Conquest and
Garrisons will each introduce their own new UI needing icons, so one
consolidated visual pass at the end avoids doing it twice.

---

## 8. Session Logins + Google Registration

**Current state:** Further along than expected. Email/password auth is fully
wired (`auth-view.js`). Session persistence is **already on** — the Supabase
client is created with no auth options, so the SDK's defaults
(`persistSession: true`, `autoRefreshToken: true`) already apply; no
"remember me" toggle is needed, it already persists across reloads. Google
OAuth **frontend code is already wired**: both login and register forms have
a "Continue with Google" button, and `_onGoogle()` already calls
`SupabaseService.client.auth.signInWithOAuth({ provider: 'google', ... })`.

**What's actually missing is entirely external configuration, not code:**
1. Create a Google Cloud OAuth 2.0 Client ID (Google Cloud Console), with the
   authorized redirect URI set to the callback URL Supabase shows on its
   Auth → Providers → Google settings page.
2. Paste that client ID/secret into the Supabase dashboard and enable the
   Google provider.
3. Test the existing button end-to-end — confirm a Google-registered new
   user still lands on race selection correctly (the new-player bootstrap
   path should already handle `race: null`, but this needs a real
   end-to-end check once the provider is live).

**Suggestions:** This one is on you (Nacho) to do — creating OAuth
credentials and flipping the Supabase dashboard toggle isn't something I can
do from here, same as the SQL migrations you've been running yourself all
session. Once it's enabled, I can verify the flow end-to-end.

---

## 9. Clean Up and Clean Up

**Current state — concrete targets found during this pass alone:**
- `js/domain/recruitment.js`'s army-weight/slot system — confirmed dead code.
- `assets/units/README.txt` — stale, references an old filename convention.
- `assets/buildings/building_icons4.jpg` — oddly named, possibly unused.
- The PWR formula duplicated 3 times (see #4).
- `server/index.js`'s `/api/debug/lords` — its own comment flags it as an
  **unauthenticated** endpoint leaking every player's lord positions;
  explicitly left in "because removing/gating a standing debug tool is a
  call for whoever relies on it" — this needs an actual decision before any
  wider release (gate it behind auth/an admin check, or remove it).
- The old README.md described a completely different, obsolete prototype
  architecture — already fixed by this rewrite.

**Plan:** A dedicated cleanup pass **after** the feature items above, since
new work will generate its own new cleanup targets:
1. Delete/neutralize confirmed dead code.
2. Consolidate duplicated formulas found along the way.
3. Decide the fate of `/api/debug/lords` — gate or remove.
4. Remove stale asset/doc leftovers.
5. One project-wide grep sweep for `TODO`/`FIXME`/leftover `console.log`
   debug statements as a final pass.

**Suggestions:** Keep this near the end, not first — cleaning mid-flight
while Conquest/Garrisons are still being actively built just creates rework.

---

## 10. Player & Design Wiki

**Plan:** One reference document (or a `docs/wiki/` folder split by topic if
it grows large) covering, at minimum: Cities (buildings, production,
growth/status, founding), Lords (classes, leveling, talents, stances,
capture/fallen once #1 ships), Races (bonuses), Armies & Units (recruitment,
PWR, upkeep), Combat (phases, traits, abilities, the honor formula), PvP &
Raiding, Rankings, Clans & Wars, Quests/Discoveries, and the Battle
Simulator.

**Suggestions:** Write this **last**, once #1–#3 (capture/fallen, garrisons,
conquest) have stabilized — those are exactly the mechanics most likely to
still change shape, and writing the wiki before they land means rewriting it
afterward anyway.

---

## Suggested priority order

Based on the dependencies above (garrisons should exist before conquest has
teeth; cleanup and the wiki should trail the features they document; the
Google login item is pure external config that can happen anytime in
parallel):

1. **Database reset** (`reset-db`) before serious playtesting — existing
   accounts carry pre-overhaul prices, removed buildings and old-economy
   wallets; nothing else can be honestly evaluated until this happens.
2. **Lord Captured vs. Fallen** — contained, no dependencies, adds real
   risk/reward.
3. **Garrisons on cities** — needed before conquest means anything.
4. **Conquest on cities** — builds on #3 for a cohesive "wars have stakes"
   milestone.
5. **Quests refactor** — independent; prioritize the same-tile bugfix early
   since it's a silent, trust-eroding failure.
6. **Unit health regeneration** — the surviving piece of old item #4.
7. **PvE camp difficulty recheck** — camps got effectively stronger under
   linear damage + the monster ×1.3 buff; the level curves were tuned
   pre-overhaul.
8. **Google login config** — external, non-blocking, can happen whenever.
9. **Clean up** — after the above, so it captures their debt too (includes
   dead `recruitment.js`, legacy `checkIncomingAttacks`, `/api/debug/lords`).
10. **UI/icons/images final pass** — after all new screens exist.
11. **Wiki** — last, once the ruleset is stable (the balance rules are now
    stable enough to start drafting the Combat + Units chapters from
    `army-guide.html` and `TESTING.md`).
