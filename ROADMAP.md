# Hexfront — Final Roadmap

Ten items, grounded in what's actually in the code today (verified by reading
the relevant files, not assumed). Each entry has: **Current state**, **Plan**,
and **Suggestions**. A recommended priority order is at the bottom.

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

## 4. Review Army Costs & PWR

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

**Suggestions:** Do this as one data-driven pass, not scattered edits — and
do it *after* Garrisons/Conquest land, since those may introduce new unit
needs (garrison-specific units?) worth folding into the same balance pass
rather than redoing it twice.

---

## 5. Lord Talents — Verify (and Fix) Battle Application

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
`lord-screen.js` references or explains it.

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
- The 2 races that *do* declare a portrait path (high_elf, dark_elf) point to
  files that **don't exist** at that path anymore (`assets/lord/` now only
  has per-race subfolders) — likely broken images today.
- 2 of 6 terrain types (hills, desert) have `image: null` in `world.js` —
  color/icon only, no art.
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
1. Fix the two broken `race.portrait` paths (point to real files under the
   new `assets/lord/<race>/` layout, or drop the path and let it fall back
   cleanly).
2. Decide once: either source portrait art for human/dwarf/orc, or embrace
   the icon+gradient card for **all 5 races** for consistency — the second
   option is the fast, low-risk fix if new art isn't coming soon.
3. Add art for hills/desert terrain, or explicitly document that some
   terrains are icon-only by design.
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

1. **Lord Captured vs. Fallen** — contained, no dependencies, adds real
   risk/reward.
2. **Garrisons on cities** — needed before conquest means anything.
3. **Conquest on cities** — builds on #2 for a cohesive "wars have stakes"
   milestone.
4. **Lord talents battle fixes** (`double_strike`/`pyroblast`) — small,
   independent, quick win, slot in anytime.
5. **Army costs & PWR review** — best done once #2/#3 settle any new unit
   needs, so it's one full pass, not two.
6. **Quests refactor** — independent; prioritize the same-tile bugfix early
   since it's a silent, trust-eroding failure.
7. **Google login config** — external, non-blocking, can happen whenever.
8. **Clean up** — after 1–6, so it captures debt from those changes too.
9. **UI/icons/images final pass** — after all new screens (conquest,
   garrisons, capture/fallen) exist, as one consolidated pass.
10. **Wiki** — last, once the ruleset is stable.
