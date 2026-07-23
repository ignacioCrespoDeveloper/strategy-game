---
target: Hexfront whole-app broad pass
total_score: 21
max_score: 40
na_heuristics: 
p0_count: 1
p1_count: 3
timestamp: 2026-07-23T11-17-14Z
slug: hexfront-whole-app-broad-pass
---
Method: dual-agent (A: ad56e34285b55e6e2 · B: adc42a04a186aa182)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Attack resolution hides behind a hardcoded 6s `setTimeout` instead of real server-tied pending state |
| 2 | Match System / Real World | 2 | Core Lord loop mixes Spanish and English mid-screen (`map-view.js` move panel, `lord-screen.js` stance picker) |
| 3 | User Control and Freedom | 2 | Recruit modal has no Escape-to-close; no way to recall a queued attack |
| 4 | Consistency and Standards | 2 | Product is "REALMS / Age of Lords" at login, "⚔ HEXFRONT" in the sidebar one screen later |
| 5 | Error Prevention | 3 | Dismissing a unit is one irreversible click, no confirmation |
| 6 | Recognition Rather Than Recall | 2 | Unit stats/traits only surface in a hover-only tooltip, nothing for keyboard/touch |
| 7 | Flexibility and Efficiency | 1 | Zero keyboard shortcuts beyond 2 login-form Enter handlers; every recruit/dismiss action is one-at-a-time |
| 8 | Aesthetic and Minimalist Design | 3 | One-accent-gold discipline is real, but the Overview dashboard renders every section expanded by default |
| 9 | Error Recovery | 2 | `_friendlyError()` is a good model but ~15+ call sites fall back to bare `result.error \|\| 'Server error'` |
| 10 | Help and Documentation | 1 | No glossary for CP caps, intel tiers, stances, talents, mounts — a few scattered tooltips is the entire help surface |
| **Total** | | **21/40** | **Acceptable — significant improvements needed before users are happy** |

## Audit Health Score

| # | Dimension | Score | Key Finding |
|---|-----------|-------|-------------|
| 1 | Accessibility | 1/4 | Zero `aria-*`/`role=`/`tabindex`/`<label>` anywhere in `js/`; 1 div-as-button HUD control with no keyboard path |
| 2 | Performance | 3/4 | Sound overall (canvas map, most images lazy), but 13 `transition: width` rules force layout thrash |
| 3 | Theming | 2/4 | 1255 `var(--...)` usages vs. 988 raw hex/rgba literals — tokens followed only ~56% of the time |
| 4 | Responsive Design | 2/4 | Only 2 `@media` rules in 10,898 lines of CSS; fixed 200px nav sidebar; viewport disables pinch-zoom |
| 5 | Implementation Integrity | 2/4 | Detector's 27 warnings + 1006 advisories corroborated manually; a documented token (`--radius-pill`) was never wired up |
| **Total** | | **10/20** | **Acceptable — significant work needed** |

## Design Specificity Verdict

**Not generic — but internally inconsistent with itself.** Hexfront is clearly authored, not reskinned: per-race gradient themes in `auth-view.js`, portrait selection keyed by race+class+lordId, terrain-specific card art, in-character copy ("Choose Your Race — shapes your dynasty forever"). DESIGN.md's "one accent rule" is genuinely followed in the markup, not just documented.

What undercuts it: the product doesn't agree with itself on its own name (**"REALMS / Age of Lords"** at login vs. **"⚔ HEXFRONT"** in the sidebar one click later) — reads as leftover naming from an earlier iteration. The detector's static scan corroborates a second kind of drift underneath the visible identity: color tokens are only followed ~56% of the time (988 raw literals vs. 1255 tokenized), and 62% of `border-radius` declarations fall outside the documented 4/8/14/999px scale, including direct violations of DESIGN.md's own "don't round past 14px" rule. The visible identity is authored; the implementation under it has drifted from its own spec.

## Overall Impression

The core game loop (async check-ins, countdown-driven actions, fog-of-war intel tiers) is genuinely well-built and product-specific — this doesn't feel like a template. The biggest problem isn't taste, it's **completion**: accessibility was never invested in at all (zero ARIA, zero labels, zero keyboard path for the card-driven interaction pattern the entire app is built on), and the visual system that was just documented in DESIGN.md is only followed about half the time in practice. The single biggest opportunity is closing the gap between "what DESIGN.md says" and "what `app.css` actually does" — most of the systemic issues below are drift, not bad decisions.

## What's Working

1. **The visual system is genuinely disciplined where it's followed.** Gold-as-only-accent and Cinzel-for-labels both show up consistently across auth, lord, city, and map screens — rarer than it sounds; most codebases drift further from their own design doc than this one has.
2. **Async-action feedback matches the product's actual design intent.** Every timed action (construction, recruitment, quest, movement, revive) gets a labeled progress bar with a live countdown, matching PRODUCT.md's "check in, act, come back later" framing.
3. **Fog-of-war intel tiering on the map is a real mechanical solution, not a generic pattern** — vague/clear/precise badges plus a separate presence-only vs. scouted marker communicate a genuine distinction legibly.
4. **Semantic HTML is mostly sound where it exists**: 102 real `<button>` elements vs. only 2 div-as-button exceptions, and all 26 `<img>` tags carry meaningful `alt` text.

## Priority Issues

**[P0] Every card-based interaction is keyboard- and screen-reader-inaccessible**
- **What**: Zero `aria-*`, `role=`, or `tabindex` attributes anywhere in `js/ui/`. Race cards, city cards, lord cards, and building cards are bare `<div>`s activated only by `addEventListener('click', ...)`. Confirmed concretely at `js/ui/hud.js:130,162` (`#hud-lord-btn`) and `js/ui/lord-screen.js:632`.
- **Why it matters**: A keyboard-only or screen-reader user cannot pick a race, found a city, open a Lord, or manage an army — this blocks the primary interaction pattern the whole app is built on, not a rough edge.
- **Fix**: Convert clickable-card `<div>`s to real `<button>`/`role="button"` + `tabindex="0"` + Enter/Space keydown handlers. Add `aria-live="polite"` to the toast container and `aria-modal`/`role="dialog"` to overlay panels.
- **Suggested command**: `/impeccable harden`

**[P1] Form inputs carry no `<label>` or `aria-label` — placeholder-only labeling**
- **What**: All three auth inputs (`js/ui/auth-view.js:43,44,62-64`) rely on `placeholder="Email"`/`"Password"` alone.
- **Why it matters**: Placeholder text isn't reliably exposed as an accessible name and disappears on focus — screen-reader and cognitive-disability users lose the field's identity.
- **Fix**: Add visually-hidden `<label>` or `aria-label` to each input.
- **Suggested command**: `/impeccable harden`

**[P1] The core Lord loop mixes Spanish and English mid-screen**
- **What**: `map-view.js`'s move-Lord panel is entirely Spanish ("Selecciona destino," "Confirmar Movimiento," "✕ Cancelar") while the found-city modal one section over is English. `lord-screen.js`'s stance picker ("Postura," "Selecciona una postura primero") sits under English section titles.
- **Why it matters**: This is active mixing within one logical flow, not a missing-translation gap — every player will read it as broken, and it fails both "Match System/Real World" and "Consistency" at once.
- **Fix**: Pick English (matches every other screen) and sweep `lord-screen.js`/`map-view.js`'s Spanish strings.
- **Suggested command**: `/impeccable clarify`

**[P1] `--text-muted` fails WCAG AA contrast and carries functionally important copy**
- **What**: `#4a5a78` against `--bg-base`/`--bg-surface` computes to ~2.7:1, well under the 4.5:1 AA minimum. Used for form labels and hint text across nearly every screen (not just decoration).
- **Why it matters**: Low-vision users cannot reliably read labels and hints that are functionally necessary, not cosmetic.
- **Fix**: Raise `--text-muted` toward `--text-secondary`'s luminance (~6.5:1, passing), or reserve `--text-muted` strictly for truly non-essential text.
- **Suggested command**: `/impeccable colorize`

**[P2] No keyboard shortcuts or bulk actions anywhere, despite an async-check-in product**
- **What**: Recruiting, dismissing, and upgrading are strictly one-at-a-time mouse clicks; the only keyboard bindings in the whole `js/ui` tree are 2 Enter-to-submit login handlers.
- **Why it matters**: PRODUCT.md frames the loop as short repeated check-ins — exactly where a returning power user wants speed most.
- **Fix**: Add "dismiss all"/bulk-recruit affordances; wire keyboard access once the P0 above is fixed.
- **Suggested command**: `/impeccable optimize`

**[P2] Destructive unit-dismiss action has no confirmation**
- **What**: `.la-uc-remove` fires `disbandUnit(...)` on a single click, unlike the found-city/recruit flows which do confirm.
- **Why it matters**: Losing a trained unit permanently on a misclick is disproportionately punishing relative to how cheap the click is.
- **Fix**: Add an inline "click again to confirm" or lightweight confirm step.
- **Suggested command**: `/impeccable harden`

**[P2] Radius scale broken in ~62% of raw declarations, including direct DESIGN.md rule violations**
- **What**: 111 off-scale `border-radius` values (`20px`/`10px`/`3px`/`2px`) vs. 118 tokenized ones; several at `20px` directly violate DESIGN.md's "don't round past 14px" rule. The documented `rounded.pill: 999px` token was never implemented — badges hard-code `20px` instead.
- **Fix**: Add `--radius-pill: 999px` to `:root`; replace off-scale literals with the documented scale.
- **Suggested command**: `/impeccable polish`

**[P2] Semantic danger/success color tokens duplicate internally**
- **What**: `--danger: #b83a2a` vs. `--text-danger: #d04a3a`; `--success: #3a8a3a` vs. `--text-success: #4a9a4a` — two reds and two greens for the same meaning, inside the token system itself.
- **Fix**: Consolidate to one pair per semantic color, or explicitly document why a "text" variant differs.
- **Suggested command**: `/impeccable document` then `/impeccable polish`

**[P2] 13 `transition: width` rules cause layout thrash**
- **What**: Likely progress/health bars animating `width` directly (`css/app.css:1630` and 12 more sites).
- **Fix**: Replace with `transform: scaleX()` on a fixed-width wrapper.
- **Suggested command**: `/impeccable optimize`

**[P2] Only 2 responsive breakpoints across 10,898 lines of CSS; fixed 200px nav sidebar**
- **What**: Both existing `@media` rules are 600px-only and touch a handful of selectors; `#nav-sidebar` is hard-coded `width: 200px` with no narrow-viewport override.
- **Fix**: Add a tablet breakpoint (~900px); make the sidebar width responsive or overlay-based below 480px.
- **Suggested command**: `/impeccable adapt`

**[P2] Viewport meta disables pinch-to-zoom; buttons likely under 44px touch target**
- **What**: `index.html:5` sets `maximum-scale=1.0`; primary/secondary/danger buttons compute to roughly 30-36px tall (unconfirmed without a live render).
- **Fix**: Remove `maximum-scale=1.0`; verify button height in-browser and raise to 44px if confirmed short.
- **Suggested command**: `/impeccable adapt`

## Persona Red Flags

**Alex (Power User)** — managing an army across several Lords between check-ins:
- No keyboard shortcuts anywhere for Search/Scout/Move/Recruit/Dismiss.
- Recruiting/dismissing is strictly one-unit-per-click; no bulk operations.
- After queuing an attack, a hardcoded 6s client-side wait blocks refresh with no way to skip it except paying credits for the unrelated instant-finish feature.
- The recruit modal requires filling 4 fields every time, including a race field that's locked and can't actually change — no smart default despite race being fixed per account.

**Jordan (First-Timer)** — signing up, choosing a race, founding a first city:
- Sees "REALMS / Age of Lords" at login, then "⚔ HEXFRONT" in the sidebar one screen later, with no explanation.
- Hits unexplained jargon immediately after onboarding: CP caps, intel tiers, "Postura" — Talents/Mount tabs show a badge signaling "something's here" with no explainer.
- Built-in onboarding covers exactly 2 steps (found a city, recruit a Lord); quests, scouting, stances, and PvP get no guided walkthrough at all.
- Mid-flow, labels flip to Spanish with no warning — will read as broken, not intentional.

**Sam (Accessibility-Dependent User)** — navigating the map and managing a city via keyboard/screen reader:
- Zero `aria-*`/`role=`/`tabindex` anywhere — every card-click interaction (race pick, city entry, Lord entry, building selection) is unreachable without a mouse.
- Unit stats/traits/abilities live exclusively in a hover-only tooltip — no focus-triggered equivalent exists, so a keyboard user can never see combat stats at all.
- `--text-muted` at ~2.7:1 fails AA for hint/label text used across nearly every screen.
- The world map is a raw `<canvas>` with no text/DOM equivalent for tiles, lords, or cities — a screen-reader user gets nothing from the map itself.

## Minor Observations

- "Account" nav link only fires a "coming soon" toast — either hide it or mark it visibly unavailable.
- The HUD hamburger (`☰`) is icon-only with just a `title` attribute, no visible label.
- `result.error || 'Server error'` is repeated as the error fallback in 15+ places — a shared, more actionable default string would help.
- `activity-screen.js` and `overview-screen.js` maintain duplicated activity-feed rendering logic — a consistency risk if one is updated and not the other.
- 9 "side-tab" left-border-accent cards exist, 2 using raw Material colors (`#4caf50`/`#f44336`) instead of `--success`/`--danger` tokens — a recognizable generated-UI pattern worth reconsidering against DESIGN.md's flat/borders-not-shadow language.
- A decorative tiled-grid background exists on the login screen (`css/app.css:783`) — thematically plausible for a map game, but currently generic rather than tied to the actual hex-grid styling.
- An undocumented third typeface (`Courier New`) appears in 4 small labels; DESIGN.md only lists Cinzel + system-ui.
- 14 of 26 `<img>` tags (several on the map screen) lack `loading="lazy"`.
- Only 10 real heading tags (`<h1>`-`<h6>`) across 7 files for 15 major screens — thin landmark structure for screen-reader navigation.
- No `prefers-reduced-motion` guard on the 7 existing `@keyframes` pulses (low severity — none are large-scale motion).
- Per-stat/per-class identity colors (health/attack/defense/magic/speed, visibility tiers) are a legitimate convention but undocumented in DESIGN.md, which has already produced 5+ near-duplicate greens with no canonical reference.

## Questions to Consider

- If Hexfront is meant to be played in short async check-ins, why does every check-in — recruiting, dismissing, picking a stance — require its own multi-field form or one-at-a-time click, with no bulk or "repeat last" path for a returning player?
- The visual design commits hard to one disciplined identity (gold-on-obsidian, Cinzel labels) — so why does the product's own name shift between screens, and why does the core Lord loop drop into Spanish while everything around it stays in English?
- If a screen-reader or keyboard-only player opened this today, could they found a city, pick a race, or manage an army at all?
