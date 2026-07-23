---
name: Hexfront
description: Dark imperial grand-strategy UI — gold-leaf accents on obsidian surfaces, Cinzel serif ceremony
colors:
  bg-deep: "#080c18"
  bg-base: "#0d1224"
  bg-surface: "#111827"
  bg-raised: "#1a2540"
  bg-overlay: "rgba(8, 12, 24, 0.92)"
  border-muted: "#1e2d4a"
  border-base: "#2a3d60"
  border-accent: "#8a6a2a"
  border-gold: "#c8933a"
  text-primary: "#e8d8a8"
  text-secondary: "#8a9ab8"
  text-muted: "#7a8ab0"
  gold: "#c8933a"
  gold-light: "#f0b84a"
  gold-dark: "#8a6020"
  danger: "#b83a2a"
  success: "#3a8a3a"
  danger-alert: "#9a1a1a"
  danger-deep: "#7a0000"
typography:
  display:
    fontFamily: "Cinzel, Georgia, serif"
    fontWeight: 600
    letterSpacing: "0.05em"
  body:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif"
  data:
    fontFamily: "'Courier New', monospace"
rounded:
  sm: "4px"
  md: "8px"
  lg: "14px"
  pill: "999px"
components:
  button-primary:
    backgroundColor: "linear-gradient(180deg, #d4993e 0%, #b87e2a 100%)"
    textColor: "#1a0e04"
    rounded: "{rounded.md}"
    padding: "0.5rem 1.25rem"
  button-secondary:
    backgroundColor: "{colors.bg-raised}"
    textColor: "{colors.text-secondary}"
    rounded: "{rounded.md}"
    padding: "0.5rem 1rem"
  button-danger:
    backgroundColor: "linear-gradient(180deg, #c0392b 0%, #96281b 100%)"
    textColor: "#ffffff"
    rounded: "{rounded.md}"
    padding: "0.5rem 1.25rem"
---

# Design System: Hexfront

## Overview

**Creative North Star: "The Midnight Throne"**

Hexfront's UI reads as a regal, severe seat of power: near-black obsidian surfaces hold everything at rest, and gold is the only source of warmth — spent deliberately on borders, selection states, and ceremonial headings rather than spread across the interface. The system is tactile and reactive: cards lift and gain a gold halo the instant they're hovered or selected, rewarding interaction with immediate, glowing feedback rather than staying inert until clicked. Cinzel's carved serif letterforms carry every heading and label at wide tracking, giving even small UI text an inscribed, ceremonial weight; body copy drops to plain system-ui for legibility in dense stat grids and lists.

This is explicitly not the bright, rounded, cartoon-saturated look of mobile strategy games (Clash of Clans-style). There is no candy-coating: borders are thin and precise, shadows are heavy and dark, and the only pop of color against the navy-black field is the gold accent (plus sparing red/green for danger/success).

**Key Characteristics:**
- Obsidian-black surfaces (`--bg-deep` / `--bg-base` / `--bg-surface`) stepped by elevation, never a light background
- Gold (`--gold` / `--border-gold`) is rationed: borders, selected states, hover glows, headings — not fills
- Cinzel serif for all display/label text at uppercase-leaning letter-spacing; system-ui for body/data
- Cards lift 6–10px and gain a gold-glow ring on hover/selection — the primary feedback language
- Heavy, dark drop shadows at rest (`rgba(0,0,0,0.4–0.8)`); glow shadows only appear as a response to state

## Colors

A near-monochrome obsidian field with a single rationed gold accent; danger/success reds and greens are used only for state, never decoration.

### Primary
- **Antique Gold** (`#c8933a`): the system's one accent — borders, focus rings, selected-state glows, display-font headings, ranking/gold-currency numerals.
- **Gold Light** (`#f0b84a`): hover/active variant of Antique Gold and gradient highlight on primary buttons.
- **Gold Dark** (`#8a6020`): shadow-side of gold gradients and glow rings on deep selection states.

### Neutral
- **Void** (`#080c18`, `--bg-deep`): the deepest background layer — behind modals, inputs, the map canvas edge.
- **Obsidian** (`#0d1224`, `--bg-base`): the base page background.
- **Slate Panel** (`#111827`, `--bg-surface`): the standard panel/card surface — one step lighter than base.
- **Raised Slate** (`#1a2540`, `--bg-raised`): raised elements sitting on top of a panel (nested cards, steps, race-preview boxes).
- **Overlay Black** (`rgba(8,12,24,0.92)`, `--bg-overlay`): modal backdrops and the lord-card's translucent field over the map.
- **Muted Steel** (`#8a9ab8`, `--text-secondary`) / **Faded Steel** (`#7a8ab0`, `--text-muted`): secondary and tertiary text, always cool-toned against the warm gold. `--text-muted` was raised from an original `#4a5a78` (~2.7:1 contrast, failed WCAG AA) to `#7a8ab0` (~5:1) since it carries functionally necessary hint/label copy, not just decoration.
- **Parchment Gold** (`#e8d8a8`, `--text-primary`): primary body text — a warm off-white, never pure white.

### Identity / Stat Colors (extension, outside the core token set)
Per-stat and per-class identity colors — health (green), attack (red), defense (blue), magic (purple), speed (teal), and visibility-tier colors (`#444455` "Undetectable" through `#aa3030` "Exposed") — are a legitimate data-viz convention (`js/data/lord-classes.js`, `js/domain/visibility.js`), not decorative chrome, and are exempt from the One Accent Rule since they encode distinct game concepts a player must tell apart at a glance. They are **not** part of the core token set above; new stat/identity colors should reuse an existing hue from this set rather than introducing another near-duplicate green/red/blue.

### Named Rules
**The One Accent Rule.** Gold is the only warm color permitted in the neutral chrome. If a new element needs emphasis, reach for gold before introducing a new hue — a second accent color dilutes the "only source of warmth" reading. This rule governs UI chrome; it does not apply to Identity/Stat Colors above.

## Typography

**Display Font:** Cinzel (with Georgia, serif fallback)
**Body Font:** system-ui (with -apple-system, 'Segoe UI', sans-serif fallback)
**Data/Countdown Font:** 'Courier New', monospace — reserved for ticking countdown timers and coordinate readouts (e.g. lord-down revive countdown, activity-feed march ETAs), where fixed-width digits stop the text jittering as it counts down. Not used for any other UI text.

**Character:** Cinzel's carved capitals give headings, labels, and card titles an inscribed, ceremonial authority even at small sizes; system-ui keeps dense data (stats, resource counts, form inputs) plainly legible without competing for attention.

### Hierarchy
- **Display** (Cinzel, 600, 1.8–2.5rem): hero/empty-state icons and headline moments (auth screen, lord-card title).
- **Title** (Cinzel, 600, 0.9–1.1rem, tracked 0.05–0.1em): section and modal titles, card names, onboarding step labels — almost always uppercase-leaning via letter-spacing rather than `text-transform`.
- **Label** (Cinzel or plain, 0.72–0.82rem, tracked ~0.1em, uppercase): form labels, step numerals, small UI chrome.
- **Body** (system-ui, 0.78–0.9rem): descriptions, form input text, list/card body copy.

### Named Rules
**The Carved Label Rule.** Any text acting as a label, title, or button caption gets Cinzel and letter-spacing, even at 0.72rem — it's what makes small UI chrome read as part of the same system as the hero headings.

## Layout

Panels and cards are the primary spatial unit — the interface is composed of stacked or gridded cards over a dark field, not free-floating text. Grids favor 2-column card layouts (`.lord-card-body`, `.race-grid`) on wider surfaces and horizontal scroll-snap tracks for selection carousels (`.rsp-track`). Spacing is comfortable rather than dense: card padding runs 1–2.5rem, with 0.75–1.5rem gaps between stacked elements.

## Elevation & Depth

Hybrid: flat obsidian tiers at rest (Void → Obsidian → Slate Panel → Raised Slate) plus heavy, dark ambient shadows under floating/modal surfaces, and a distinct **gold glow** vocabulary reserved for hover/selection/focus. Depth at rest comes from background-tier stepping and 1px borders, not shadow; shadow is spent on things that float above the page (modals, the lord-card) or need to visibly react (selected race card, focused input).

### Shadow Vocabulary
- **Ambient float** (`0 32px 80px rgba(0,0,0,0.6–0.7)`): modals and the lord-card — heavy, soft, and dark, signaling "this sits above everything else."
- **Card rest** (`0 2px 8–16px rgba(0,0,0,0.4–0.5)`): standard panels/cards at rest, a subtle lift off the page.
- **Gold selection glow** (`0 16px 56px rgba(200,147,58,0.32)` + `0 0 0 1px var(--gold-dark)`): a selected card (e.g. chosen race) — the strongest state signal in the system.
- **Gold focus ring** (`0 0 0 3px rgba(200,147,58,0.12)`): focused form inputs — quiet by comparison to selection glow, intentionally so.

### Named Rules
**The Flat-Until-It-Matters Rule.** Surfaces are flat and shadowless at rest; shadow (and especially gold glow) is reserved for hover, focus, and selection — it's the system's primary way of saying "this is interactive" or "this is chosen."

## Shapes

Corners are consistently rounded but never soft-cartoon: `--radius-sm` (4px) for small chips/steps, `--radius-md` (8px) for buttons/inputs/most cards, `--radius-lg` (14px) for modals and hero cards. Pills (`border-radius: 999px`) appear only for small circular/capsule elements (step numerals, badges). Borders are thin (1–2px) and do the structural work that shadow doesn't — nearly every card and input has a visible 1–2px border in `--border-base`, `--border-accent`, or `--border-gold` depending on state.

## Components

Buttons, cards, and inputs share one grammar: dark fill, thin gold-or-steel border, `--radius-md` corners, and a gold reaction on hover/focus.

### Buttons
- **Shape:** 8px radius (`--radius-md`) across all variants.
- **Primary:** gold gradient fill (`linear-gradient(180deg, #d4993e, #b87e2a)`), near-black text (`#1a0e04`), 600 weight, 0.05em tracking — the only button variant with a colored fill.
- **Secondary:** `--bg-raised` fill, `--border-base` border, `--text-secondary` text — steel-toned, recedes next to Primary.
- **Danger:** red gradient (`#c0392b` → `#96281b`), white text, 700 weight — reserved for destructive/attack actions.
- **Hover / Focus:** Primary and Danger brighten via `filter: brightness(1.1–1.15)`; Secondary shifts border to gold and text to primary. Disabled states drop to 0.5 opacity with `cursor: not-allowed`.

### Cards
- **Corner style:** 8–14px radius depending on prominence (small cards 8px, hero/modal cards 14px).
- **Background:** `--bg-surface` or `--bg-raised` depending on nesting depth.
- **Shadow strategy:** flat at rest; see Elevation & Depth for the hover/selection glow.
- **Border:** 1–2px, `--border-base` at rest, shifting to `--border-accent` or `--gold` on hover/selection.
- **Signature interaction:** selectable cards (race picker, etc.) lift 6–10px via `transform: translateY()` and gain the gold selection glow — this lift-and-glow is the system's most distinctive motion signature.

### Inputs / Fields
- **Style:** `--bg-deep` fill (darker than its surrounding card), 1px `--border-base` border, 8px radius, `--text-primary` text.
- **Focus:** border shifts to gold plus a soft `0 0 0 3px rgba(200,147,58,0.12)` glow ring — quieter than the card selection glow.
- **Label:** uppercase-tracked, `--text-muted`, 0.72rem, always above the field (`.form-label`).
- **Error:** `--text-danger` text beneath the field, reserved height to avoid layout shift.

## Do's and Don'ts

### Do:
- **Do** keep gold as the single accent color; route new emphasis needs through gold (or its light/dark variants) before adding a new hue.
- **Do** use Cinzel with letter-spacing for anything acting as a title or label, even at small sizes (0.72rem+).
- **Do** reserve shadow and glow for state changes (hover/focus/selection) rather than applying it to static surfaces.
- **Do** step backgrounds through the Void → Obsidian → Slate Panel → Raised Slate tiers to convey nesting instead of adding shadow.

### Don't:
- **Don't** introduce bright, saturated, or cartoon-style color fills — this is not a Clash-of-Clans-style mobile strategy look.
- **Don't** add a second accent hue alongside gold; danger-red and success-green are state-only, never decorative.
- **Don't** use heavy shadow at rest — flat panels are the default; shadow signals "floating" (modals) or "reacting" (hover/selection), not "default card."
- **Don't** round corners past 14px (`--radius-lg`) except true pill/circle elements (badges, step numerals); this system stops short of soft, toy-like rounding.
