# Hexfront — Roadmap

Rewritten **2026-07-29** after a full audit of the previous ten-item roadmap
against the code. Most of the old list has shipped; the active list below is
what Nacho triaged from the audit's findings. Anything not listed under
"Active" is either done, explicitly deferred, or parked — nothing was lost,
it's all accounted for in the sections below.

---

## Active work list (triaged 2026-07-29)

### 1. Remove the Ambush stance — ✅ DONE 2026-07-29

The stance was client-only and never observable server-side (no
`raid-start`-style endpoint ever wrote it), so it sold the player a no-op —
and the scout-interception mechanic that read it could never fire. Removed
end-to-end this session:

- `js/data/stances.js` — the `ambush` def deleted; idle + raiding remain.
- `server/combat-resolver.js` — `resolveScout()` no longer intercepts
  anyone: scouting is always safe, the only outcome is `'intel'`. The
  `skipAttackerStanceGate` option (its only consumer) removed too.
- Client scout UI/copy updated everywhere ("risks an ambush" warnings gone);
  the `'ambushed'` outcome branch removed from `lord-screen.js`.
- `TESTING.md` known-gap section rewritten as a history note; the test
  suite's permanent skip removed.

**Ambush lives on solely as the PvE expedition outcome**
(`server/tick/catch-up.js`'s `_resolveAmbush`) — that is the one and only
ambush concept in the game now.

### 2. Flavor-only traits — ⏳ IN PROGRESS (parallel session, 2026-07-29)

**Scope decision (Nacho, 2026-07-29):** the trait list only. The five unit
`abilities` are **parked for the future** — see the Parked section.

**Current state:** these unit traits render in tooltips/tech tree but have
zero engine effect: `splash_damage`, `poison`, `siege`, `fast`,
`veteran` — plus every `abilities`
entry (`web_trap`, `venom_bite`, `fire_breath`, `dragon_breath`,
`sky_dive`). (`scout` came off this list 2026-07-28: it counts double toward
Expedition Rating. Four came off 2026-07-29 in the balance band pass:
`berserk` +35% melee (Slayers), `aggressive` +20% melee (Orc Boyz),
`impact` charge ×1.8 (orc boars), `discipline` full-weight morale steadying
(the Empire identity trait).) Players reasonably expect them to do
something.

**Plan:** the proven 2026-07-27 pattern, one pass:
1. Design each trait's effect WITH Nacho (per-trait calls, like the nine
   traits done in the battle-engine v2 pass) — or explicitly decide to
   delete it from the unit defs instead of implementing.
2. Implement in `js/domain/battle-traits.js` following the existing hooks.
3. Price every implemented trait into `EconomyCore`'s PWR tax table — which
   moves unit PWR and therefore gold cost, so this IS a balance change.
4. Re-run the balance suite (`scripts/test-balance.js`) and the economy
   drift-guard; re-generate `army-guide.html`.

(The five `abilities` were originally bundled here; Nacho parked them
2026-07-29 — signature moves deserve a bigger design than a flat stat hook.)

### 3. Mounts — ✅ RACE POOLS SHIPPED 2026-07-30

**Design call (Nacho, 2026-07-30):** mounts are now **five exclusive pools of
four** — one per race — replacing the single shared pool of six. A lord may
only equip a mount of its own race, gated server-side in `lord-mounts.js`.

| Slot | Lv | Cost | Budget | Orc | Dwarf | Human | High Elf | Dark Elf |
|---|---|---|---|---|---|---|---|---|
| scout | 5 | 300k | 3 pts + **+15% ER** | Wolf | Battle Ram | War Lion | Elven Steed | Cold One |
| field | 5 | 300k | 4 pts | War Boar | War Bear | Warhorse | White Lion | Dark Steed |
| war | 8 | 800k | 7 pts | Giant Spider | Steam Tank | Pegasus | Great Eagle | Dark Pegasus |
| apex | 10 | 1.5M | 10 pts + **+200 PWR cap** | Manticore | Stone Golem | Griffon | Dragon | Black Dragon |

`scout` and `field` are **sidegrades**: same level, same price, and the scout
trades exactly one stat point for its Expedition Rating bonus. That is the
level-5 choice — quest or fight. Power climbs only across slots, which is
what the level gate pays for.

**The two non-stat effect keys**, both read through helpers rather than
summed as stats, and both shown as gold chips on the card:
- `expeditionRatingMult` (1.15) multiplies **Expedition Rating**, which gates
  find quality *and* recruit quality. 20 goblin rabble is ER 400; with a
  scout mount it is 460, which crosses the 450 **Rare** band. Sized to move
  you a band, not to be rounding error.
- `armyPowerCapBonus` (200) raises the army PWR cap. Already an established
  key — the talent pool has used it for months — and it **stacks** with the
  talent. All **four** cap copies read it (`lord.js`, `recruit.js`,
  `catch-up.js`, `army-transfer.js`); army-transfer was the easy one to miss
  and would have made a legally-recruited army unable to be split and
  reassembled.

Still **flat pads — no traits, no abilities, no battle hooks**; the
2026-07-29 legibility call holds. Both new keys are economy/progression
dials read outside the battle engine.

**Selling — `POST /api/lord/mount-sell` (2026-07-30).** Equipping still charges
the new mount's full price, but a mount can now be **sold back for 60%**
(`MOUNT_SELL_REFUND`), leaving the lord unmounted. Before this, a 1.5M apex
pick was effectively permanent — buy the wrong one and you were simply stuck.

| Slot | Cost | Sells for | Net cost of a same-slot swap |
|---|---|---|---|
| scout / field | 300k | 180k | 120k |
| war | 800k | 480k | 320k |
| apex | 1.5M | 900k | 600k |

60% is deliberately the same number as `DISBAND_REFUND_MAX` in
`army-disband.js`, which was cut 0.9 → 0.6 the same day for the same reason:
at a high refund the sink stops being a sink. Churn always loses money, so
buy/sell cycling can never mint gold.

`MOUNT_SELL_REFUND` + `mountSellValue()` live in `js/data/lord-classes.js`,
**not** in the endpoint — the Sell button prints the exact gold it will pay,
and neither side re-derives `cost × fraction`. The equipped card's button was
a dead "Equipped" label; it is now the Sell control (muted gold, warning red
on hover) behind a `confirm()` naming the mount and the amount. Equipped cards
carry `data-sell-mount` rather than `data-mount-id` so the equip handler can
never fire on them.

**Migration — no backfill, nobody loses gold.** `resolveMountId(mountId,
raceId)` maps a stored id onto a mount the lord can actually ride, at read
time: right race → unchanged; another race's mount or a retired id → the
**same slot** of the lord's own race. Since slots are equal-priced within a
level, a migrated lord always lands on a mount worth what they paid. Four old
ids survived into a pool outright (`warhorse`, `dire_wolf`, `griffon`,
`dragon` — the last two keeping stats, level and price exactly); only
`war_chariot` and `war_bear` are retired, both to `LEGACY_MOUNT_SLOTS`.
`lord-mounts.js` compares the **resolved** id before charging, so a migrated
lord is never billed again for the mount it is visibly already on.

**Prior design (2026-07-29), superseded above:** three tiers of two shared
mounts, at 300k/350k · 700k/800k · 1.5M/1.5M. The level-5 pair is now equal-
priced — the old 300k/350k split quietly made a sidegrade pair into a power
ranking.

**Shipped:** `unlockLevel` per mount in `MOUNT_POOL`; per-mount gating
server-side in `lord-mounts.js` (replacing the flat "level 5" check); the
Mount tab now shows the **whole ladder including locked tiers** (stats
visible, greyed, "🔒 Level N" instead of Equip) so there's something to
level toward. `MOUNT_MIN_LEVEL` replaced the hardcoded 5s. The old Armored
Boar became the War Bear in the same lv-8 sturdy slot — a lord still holding
the retired id sees an empty mount slot and re-picks free (every read site
degrades unknown ids to "no mount", verified).

**Lord-screen UI pass (2026-07-29, same day):**
- The Mount card **moved out of the left rail** into the Overview tab,
  taking the slot the retired Stance section used to hold. The left rail is
  now identity + stats only.
- **The Stance section is gone.** Raiding was the only stance left, so its
  block (progress, earnings, Cancel / Finish Now) merged into **Status** —
  the one place that already answered "what is this lord doing".
- The Mount tab shows **the lord's full four-mount race ladder, always**
  (six shared mounts before the 2026-07-30 race split). There is no picker
  mode any more — the grid used to be hidden behind a click, so opening the
  tab with a mount on showed only that mount. Below level 5 all four render,
  locked.
- **Dark Elves ride a Black Dragon** — was flavour only, via a `raceVariants`
  field. **Superseded 2026-07-30:** `raceVariants` is gone and the Black
  Dragon is a real mount (`de_black_dragon`) with its own id and its own stat
  spread, which is what lets it differ from the High Elf Dragon by more than
  name and art. `getMountForRace()` kept its signature and now resolves
  through race pools, so every call site still reads correctly.

**Card redesign (2026-07-29):** a mount card **is** a building card. The tile
is literally `.bld3-tile` (`city-view.js`'s grid) — same 200px tracks, same
150px art strip with the bottom fade, same name + value row — and the three
mount states reuse the building states outright: locked → `--locked`,
equipped → `--selected`, can't afford → `--cant`. Only the foot (stat chips
+ equip button, on the `.bld2-btn--*` colour grammar) is mount-specific.
Restyling buildings now restyles mounts for free.

The **Overview card renders the same tile in the same `.lm-mount-grid`**, so
it comes out the exact width of a ladder card (223 × 264 px measured, both
tabs) instead of the old bespoke quarter-width variant. `.lm-container`'s
padding is pinned to `.lov-tab`'s for that reason — change one, change both.
The wide "Equipped" strip above the ladder is **gone**: the equipped mount is
already the gold-bordered card in the grid and the Overview carries the
read-out, so it was a third copy of the same object.

**Art — 5 of 20 (Nacho, 2026-07-29).** All in `assets/mounts/`; filenames
follow the art, not the mount id, so the `image` strings are literal. The
race split kept every existing piece by pointing it at the race that
inherited that mount:

| File | Mount | Race |
|---|---|---|
| `warhorse.png` | Warhorse (field) | Human |
| `boar.webp` | War Boar (field) | Orc |
| `bear.webp` | War Bear (field) | Dwarf |
| `dragon.webp` | Dragon (apex) | High Elf |
| `blackdragon.webp` | Black Dragon (apex) | Dark Elf |

`chariot.webp` is now **orphaned** — the War Chariot has no race and was
retired; the file is still on disk and nothing references it.

**The other 15 mounts have no `image` and render their sprite glyph** — the
agreed ship state (Nacho, 2026-07-30), the same path the Griffon has taken
since 2026-07-29. `_mountVisual()` already falls back, so dropping a `.webp`
in and adding one `image:` line is the whole job when art lands; no code
change. Icons are deliberately reused across races (both lions share
`claw-slashes`, three races share `horse-head`) — pools are race-exclusive,
so no two of them are ever on screen together.

The orc field mount was **renamed Dire Wolf → War Boar** on 2026-07-29 to
match its art. The stored id stays `dire_wolf` (persisted on lords in
Supabase, same rule as the elf race ids) and survived the race split for the
same reason.

`warhorse.png` is still ~700 KB; converting it to `.webp` like the rest would
cut ~80% with no visible loss, worth doing before this goes public.

### 4. Account screen + Sessions — ✅ SCREEN SHIPPED 2026-07-29

**Scope decision (Nacho, 2026-07-29):** info + password change only. No
delete-account (would need a real server cleanup endpoint), no Google-link
status (provider not enabled yet); logout already lives in the nav.

**Shipped:** `js/ui/account-view.js`, routed as `'account'`, nav item wired
(the "coming soon" toast is gone). Identity panel (race crest, username,
email, member-since from the Supabase auth user) + change-password form
(current-password verified via `signInWithPassword`, then
`auth.updateUser` — all Supabase-native, no game-server endpoint). Passed a
fresh-pass design review against DESIGN.md.

**Still open on this item — external config (Nacho):** create the Google
Cloud OAuth client ID, paste into Supabase Auth → Providers → Google,
enable; then the existing button gets verified end-to-end (new Google user
must land on race selection). Sessions already persist (SDK defaults).

---

## Explicitly deferred (decided 2026-07-29)

- **Draw-flow verification** — battles draw more often post-overhaul and the
  downstream flows (honor, loot, capture, report wording) were never
  re-verified for `winner: 'draw'`. Nacho's call: draws are acceptable
  as-is; revisit only if odd outcomes surface in play.
- **Race `population_growth` bonus** — still a dead key (Orc +25% and Dark
  Elf +15% labels overclaim). Deliberately logged rather than fixed; belongs
  inside a future balance pass with the suite re-run, not a UI fix.

---

## Parked (not scheduled, say the word to reactivate)

- **Unit `abilities` implementation** (`web_trap`, `venom_bite`,
  `fire_breath`, `dragon_breath`, `sky_dive`) — parked by Nacho 2026-07-29,
  split out of the trait pass; per-unit signature moves that deserve their
  own splashy design session (and PWR taxes) when picked up.

- **Garrisons on cities (recruitable layer)** — garrison is still derived
  fresh from building levels each fight (`_getGarrison`); no persisted
  `city.garrisonUnits`, no recruit-into-garrison action. The troop-exchange
  panel + `army-transfer-core.js` stack math are ready to be reused for it.
- **Conquest on cities** — never built (`ownerId` is still written exactly
  once, at founding; no `siegeState` anywhere). Depends on garrisons landing
  first to be worth anything.
- **Cleanup pass** — updated target list: legacy `checkIncomingAttacks`
  (unrouted dead code in `combat-resolver.js`), the `/api/debug/lords`
  unauthenticated endpoint (gate or remove — becomes a real blocker the
  moment strangers can register), any camp-era leftovers the expedition
  rework orphaned server-side, `assets/units/README.txt`,
  `assets/buildings/building_icons4.jpg`, plus a TODO/console.log sweep.
- **Player & design wiki** — write last, once the active list stabilizes
  the ruleset. `army-guide.html`, `quest-guide.html`, `raid-guide.html` and
  `TESTING.md` are already half the source material.
- **UI/icons/images final pass** — the remaining items from the old #7:
  race portrait decision (source art vs. embrace icon-cards for all 5),
  uneven lord-portrait pools (no priest art for any race), mercenary unit
  art, `.placeholder-screen` audit.

**Standing pre-playtest blocker:** existing accounts are stale
(pre-overhaul prices/buildings/wallets) — a database reset (`reset-db`) is
required before any honest playtesting (README known issue #3).

---

## Shipped since the old roadmap was written (2026-07-27 → 2026-07-29)

For the record — all verified in code during the 2026-07-29 audit:

- **Lord Captured vs. Fallen** (old #1) — full version incl. cross-player
  ransom: `lord-ransom.js`, `lord-release.js`, `lord-prison-list.js`,
  covered by the integration suite's capture/ransom/release tests.
- **Army costs & PWR** (old #4) — done earlier, and its last leftover,
  **unit healing**, shipped 2026-07-28: 15% battle-win heal + 1%/min idle
  garrison regen in `catch-up.js`, disband refund cap.
- **Talent battle hooks** (old #5) — done 2026-07-27.
- **Quests → Expeditions** (old #6, redesigned then shipped 2026-07-28/29) —
  shared `discovery-roll.js` roll math, expedition lengths, per-tile
  depletion, army footprint/loudness with overmatch, combat finds resolved
  as immediate ambushes (bandit camps retired, client camp UI deleted
  2026-07-29), ER-gated recruits with formula prices, reward retuning, PvE
  honor removed, 150 story vignettes (`story-quests.js`).
  **Reward pump + ER-gated find quality, 2026-07-29:** Expedition Rating now
  drives *both* halves of the roll — the same band that gates recruits also
  weights which discovery *tier* turns up and how often you come back empty
  (`RECRUIT_TIERS[].find` / `.nothing`). Find tier used to be pure lottery
  (a flat T1 41% / T2 32% / T3 4% at every army size); it now spreads
  T3 0.9% → 12.3% from Common to Legendary. `TIER_RANGES` raised
  ~1.75×/2.15×/2.4× by tier, and the two legendary defs finally carry
  `tier: 3` instead of silently paying tier-2 loot.
- **Ambush stance removed** (active item 1 above) — 2026-07-29.
- Unplanned extras: same-tile **troop exchange** (2026-07-28), **temple
  blessings** (5 gods, 2026-07-28), build/recruit/attack **cancel buttons**
  (2026-07-28).
- **The recruitment gate — `/api/city/recruit` was never enforcing anything**
  (2026-07-29). `handleRecruit` checked only gold, the Army Power cap and the
  legendary lord-12 rule; it never consulted `UNIT_ROSTER`. Three exploits,
  all reproduced before the fix: a dwarf lord could train Witch Elves; Black
  Guard trained in a Barracks-1 city; and `city_guard`/`militia_archer`/
  `garrison_soldier` are `goldCost: 0` **and** `recruitTime: 0`, so a crafted
  POST filled an entire PWR cap for free at one second per batch. The
  building gate players saw in the UI was pure client-side decoration.
  New `js/domain/unit-unlock.js` — `UnitUnlockService.check` — is now THE
  gate, run by the recruit UI filter, the Tech Tree status, and the server,
  so the client can no longer offer what the server would reject. Guarded by
  Test 5b in `scripts/test-battle-movement.js` and a `Recruitment gate`
  section in `scripts/test-economy.js`.

Still open from that era, tracked in README known issues: the same-tile
quest credit-finish bug (#1), the intermittent post-PvP navigation bug (#2),
and the flavor-only traits list (#6 — now active item 2 above).
