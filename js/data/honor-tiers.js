// =============================================
//  honor-tiers.js — Honor point tier crests
//
//  Player honor escalates through 3 tiers per side (good/evil) as
//  |honorPoints| crosses a threshold. Below the lowest threshold
//  (100), no crest shows at all — see getHonorTier().
//
//  Each tier's SVG is inline markup (viewBox 0 0 100 100, hardcoded
//  hex colors) meant to be inserted directly into the DOM via
//  innerHTML so it renders as a real vector icon, not text/emoji.
//  Wrap it in `<svg viewBox="0 0 100 100" class="honor-crest">...`
//  when using it — see js/ui/hud.js and js/ui/ranking-screen.js.
// =============================================

var HONOR_TIERS = {
  good: [
    {
      min:  100,
      name: 'Blessed',
      svg: `
        <circle cx="50" cy="50" r="47" fill="#1c1408" stroke="#c8933a" stroke-width="3"/>
        <path d="M44 24 L56 24 L56 42 L66 42 L66 56 L56 56 L56 80 L44 80 L44 56 L34 56 L34 42 L44 42 Z" fill="#f0b84a"/>
      `,
    },
    {
      min:  500,
      name: 'Radiant',
      svg: `
        <circle cx="50" cy="50" r="47" fill="#1c1408" stroke="#c8933a" stroke-width="4"/>
        <path d="M50 16 L52 26 L48 26 Z M50 74 L52 84 L48 84 Z M16 50 L26 48 L26 52 Z M84 50 L74 48 L74 52 Z
                  M27 27 L33 35 L29 37 Z M73 27 L71 37 L67 35 Z M27 73 L33 65 L29 63 Z M73 73 L71 65 L67 63 Z" fill="#f0b84a" opacity="0.85"/>
        <path d="M44 24 L56 24 L56 42 L72 42 L72 56 L56 56 L56 80 L44 80 L44 56 L28 56 L28 42 L44 42 Z" fill="#f0b84a"/>
        <circle cx="50" cy="49" r="3.6" fill="#ffe9a8"/>
      `,
    },
    {
      min:  1000,
      name: 'Exalted',
      svg: `
        <circle cx="50" cy="50" r="47" fill="#1c1408" stroke="#c8933a" stroke-width="5"/>
        <circle cx="50" cy="50" r="41" fill="none" stroke="#f0b84a" stroke-width="1.5"/>
        <circle cx="50" cy="50" r="23" fill="none" stroke="#ffe9a8" stroke-width="1.2" opacity="0.7"/>
        <path d="M50 16 L52 26 L48 26 Z M50 74 L52 84 L48 84 Z M16 50 L26 48 L26 52 Z M84 50 L74 48 L74 52 Z
                  M27 27 L33 35 L29 37 Z M73 27 L71 37 L67 35 Z M27 73 L33 65 L29 63 Z M73 73 L71 65 L67 63 Z" fill="#f0b84a" opacity="0.85"/>
        <path d="M28 50 C12 44 6 30 10 16 C20 20 28 28 30 40 Z" fill="#c8933a"/>
        <path d="M72 50 C88 44 94 30 90 16 C80 20 72 28 70 40 Z" fill="#c8933a"/>
        <path d="M44 24 L56 24 L56 42 L72 42 L72 56 L56 56 L56 80 L44 80 L44 56 L28 56 L28 42 L44 42 Z" fill="#f0b84a"/>
        <circle cx="50" cy="49" r="3.6" fill="#ffe9a8"/>
        <path d="M15 30 L17 34 L21 36 L17 38 L15 42 L13 38 L9 36 L13 34 Z" fill="#ffe9a8"/>
        <path d="M85 30 L87 34 L91 36 L87 38 L85 42 L83 38 L79 36 L83 34 Z" fill="#ffe9a8"/>
      `,
    },
  ],

  evil: [
    {
      min:  100,
      name: 'Marked',
      svg: `
        <circle cx="50" cy="50" r="47" fill="#1a0806" stroke="#c0503f" stroke-width="3"/>
        <path d="M26 40 C20 28 26 16 34 14 C30 24 32 32 36 38 Z" fill="#c0503f"/>
        <path d="M74 40 C80 28 74 16 66 14 C70 24 68 32 64 38 Z" fill="#c0503f"/>
        <path d="M50 26 C34 26 26 38 26 50 C26 60 31 66 34 70 L34 76 C34 79 37 81 40 81 L60 81 C63 81 66 79 66 76 L66 70 C69 66 74 60 74 50 C74 38 66 26 50 26 Z" fill="#e07a5f"/>
        <circle cx="41" cy="50" r="6" fill="#1a0806"/>
        <circle cx="59" cy="50" r="6" fill="#1a0806"/>
        <path d="M50 56 L45 66 L55 66 Z" fill="#1a0806"/>
        <path d="M40 74 L40 81 M46 75 L46 81 M54 75 L54 81 M60 74 L60 81" stroke="#1a0806" stroke-width="2.5" stroke-linecap="round"/>
      `,
    },
    {
      min:  500,
      name: 'Bloodied',
      svg: `
        <circle cx="50" cy="50" r="47" fill="#1a0806" stroke="#c0503f" stroke-width="4"/>
        <path d="M26 40 C20 28 26 16 34 14 C30 24 32 32 36 38 Z" fill="#c0503f"/>
        <path d="M74 40 C80 28 74 16 66 14 C70 24 68 32 64 38 Z" fill="#c0503f"/>
        <path d="M28 16 C26 10 30 6 28 2 C34 6 34 12 30 16 Z" fill="#ffe9a8"/>
        <path d="M72 16 C74 10 70 6 72 2 C66 6 66 12 70 16 Z" fill="#ffe9a8"/>
        <path d="M50 26 C34 26 26 38 26 50 C26 60 31 66 34 70 L34 76 C34 79 37 81 40 81 L60 81 C63 81 66 79 66 76 L66 70 C69 66 74 60 74 50 C74 38 66 26 50 26 Z" fill="#e07a5f"/>
        <circle cx="41" cy="50" r="6" fill="#1a0806"/>
        <circle cx="59" cy="50" r="6" fill="#1a0806"/>
        <path d="M50 56 L45 66 L55 66 Z" fill="#1a0806"/>
        <path d="M40 74 L40 81 M46 75 L46 81 M54 75 L54 81 M60 74 L60 81" stroke="#1a0806" stroke-width="2.5" stroke-linecap="round"/>
      `,
    },
    {
      min:  1000,
      name: 'Infernal',
      svg: `
        <circle cx="50" cy="50" r="47" fill="#1a0806" stroke="#c0503f" stroke-width="5"/>
        <circle cx="50" cy="50" r="41" fill="none" stroke="#e07a5f" stroke-width="1.5"/>
        <path d="M26 50 C10 44 4 30 8 16 C18 20 26 28 28 40 Z" fill="#c0503f"/>
        <path d="M74 50 C90 44 96 30 92 16 C82 20 74 28 72 40 Z" fill="#c0503f"/>
        <path d="M24 42 C12 24 18 4 32 -1 C25 15 29 28 36 39 Z" fill="#c0503f"/>
        <path d="M76 42 C88 24 82 4 68 -1 C75 15 71 28 64 39 Z" fill="#c0503f"/>
        <path d="M29 47 C22 40 21 30 28 27 C27 34 28 41 32 47 Z" fill="#e07a5f"/>
        <path d="M71 47 C78 40 79 30 72 27 C73 34 72 41 68 47 Z" fill="#e07a5f"/>
        <path d="M28 16 C26 10 30 6 28 2 C34 6 34 12 30 16 Z" fill="#ffe9a8"/>
        <path d="M72 16 C74 10 70 6 72 2 C66 6 66 12 70 16 Z" fill="#ffe9a8"/>
        <path d="M50 26 C34 26 26 38 26 50 C26 60 31 66 34 70 L34 76 C34 79 37 81 40 81 L60 81 C63 81 66 79 66 76 L66 70 C69 66 74 60 74 50 C74 38 66 26 50 26 Z" fill="#e07a5f"/>
        <circle cx="41" cy="50" r="6" fill="#1a0806"/>
        <circle cx="59" cy="50" r="6" fill="#1a0806"/>
        <circle cx="41" cy="50" r="2.4" fill="#ffe9a8"/>
        <circle cx="59" cy="50" r="2.4" fill="#ffe9a8"/>
        <path d="M50 56 L45 66 L55 66 Z" fill="#1a0806"/>
        <path d="M40 74 L40 81 M46 75 L46 81 M54 75 L54 81 M60 74 L60 81" stroke="#1a0806" stroke-width="2.5" stroke-linecap="round"/>
        <circle cx="14" cy="70" r="2" fill="#ffe9a8"/>
        <circle cx="86" cy="70" r="2" fill="#ffe9a8"/>
        <circle cx="18" cy="82" r="1.3" fill="#e07a5f"/>
        <circle cx="82" cy="82" r="1.3" fill="#e07a5f"/>
      `,
    },
  ],
};

// Returns { min, name, svg, side } for the highest tier the given honor
// points value's magnitude clears, or null if it's below the first
// threshold (or exactly 0).
function getHonorTier(honorPoints) {
  const n = honorPoints || 0;
  if (n === 0) return null;
  const side  = n > 0 ? 'good' : 'evil';
  const mag   = Math.abs(n);
  const tiers = HONOR_TIERS[side];
  let result = null;
  for (const t of tiers) {
    if (mag >= t.min) result = t;
  }
  return result ? { ...result, side } : null;
}

// Wraps a tier's inner markup in a sized <svg> ready for innerHTML insertion.
function honorCrestHtml(tier, extraClass) {
  if (!tier) return '';
  return `<svg viewBox="0 0 100 100" class="honor-crest${extraClass ? ' ' + extraClass : ''}">${tier.svg}</svg>`;
}
