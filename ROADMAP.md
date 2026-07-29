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

### 3. Mounts — ✅ LADDER SHIPPED 2026-07-29 (art pending, from Nacho)

**Design call (Nacho, 2026-07-29):** three tiers, two mounts each, and
mounts stay **flat stat pads — no special abilities**.

| Tier | Mounts | Stat budget | Cost |
|---|---|---|---|
| Lv 5 | Warhorse · Dire Wolf | 4 points | 400 / 450 |
| Lv 8 | War Chariot · War Bear | 7 points | 1100 / 1200 |
| Lv 10 | Griffon · Dragon | 10 points | 2400 / 2800 |

Within a tier the two are **sidegrades on one budget** — one leans fast, one
leans sturdy — so the pick is a shape choice; power climbs only across
tiers, which is what the level gate pays for.

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
- Locked mounts in the Mount tab now follow the **building-tile grammar**
  (`city-view.js`): greyed + hatched art, a padlock "Locked" button, and a
  "Requires lord level N" reason line.
- **Dark Elves ride a Black Dragon** — flavour only, via a `raceVariants`
  field + `getMountForRace()`. Variants may override name/icon/image/colour/
  description ONLY; effects, cost, unlockLevel and the stored `dragon` id
  always come from the base mount, so flavour can never become balance.

**Art — paths are pre-wired**, so a file just has to land at the right name
and it appears (no code change; a missing file quietly falls back to the
icon glyph). All in `assets/mounts/`:

| File | Mount | Status |
|---|---|---|
| `warhorse.png` | Warhorse (lv 5) | ✅ supplied |
| `dragon_dark_elf.png` | Black Dragon — Dark Elves only | ✅ supplied |
| `dire_wolf.png` | Dire Wolf (lv 5) | pending |
| `war_chariot.png` | War Chariot (lv 8) | pending — placeholder glyph |
| `war_bear.png` | War Bear (lv 8) | pending — placeholder glyph |
| `griffon.png` | Griffon (lv 10) | pending |
| `dragon.png` | Dragon (lv 10) | pending |

Chariot and Bear are on the nearest glyphs the sprite had
(`mounted-knight`, `bison`), so they want art most. `.png` is wired because
that's what the first two arrived as — change the `image` strings if you
switch format. They're ~700 KB each; converting to `.webp` would cut roughly
80% off with no visible loss, worth doing before this goes public.

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
- **Ambush stance removed** (active item 1 above) — 2026-07-29.
- Unplanned extras: same-tile **troop exchange** (2026-07-28), **temple
  blessings** (5 gods, 2026-07-28), build/recruit/attack **cancel buttons**
  (2026-07-28).

Still open from that era, tracked in README known issues: the same-tile
quest credit-finish bug (#1), the intermittent post-PvP navigation bug (#2),
and the flavor-only traits list (#6 — now active item 2 above).
