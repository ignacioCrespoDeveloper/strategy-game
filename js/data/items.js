// =============================================
//  items.js — City items catalog ("what you bring home")
//
//  Items are the OGame item model: an expedition finds a thing, the thing
//  sits in your backpack until you decide where it belongs, and applying it
//  to a CITY raises that city's production for a fixed number of hours.
//
//  This REPLACED js/domain/events.js (deleted 2026-08-04). City events fired
//  from exactly one place — city-view.js, in the browser, on render — so they
//  were never server-authoritative and a player who never opened a city never
//  had one. Items are the opposite of that in every way that matters: the
//  server rolls them, the server applies them, and the player chooses.
//
//  Design rules (keep them — they are what stop this becoming a second
//  economy):
//    · An item is a FIXED number and a FIXED duration. No rarities, no
//      player-chosen length, no cost to activate. One item, one promise.
//      (Nacho's call, 2026-08-04.) A bigger effect is a DIFFERENT item, which
//      is why the catalog runs three per resource — see the tier ladder below.
//    · Items are PER CITY. Race, Library research and Temple blessings are
//      the empire-wide production levers; this is the only per-city one, and
//      that is the whole point — it is a placement decision, not a purchase.
//    · Items only touch RESOURCE PRODUCTION (wood/stone/food). Stats, tempo
//      and population deliberately stay out of the first cut. The effect keys
//      are the same `<res>_production` grammar race/research/blessings use, so
//      widening the scope later is a data change plus one clamp review.
//    · NO SLOT LIMIT (Nacho's call, 2026-08-04) — a city may hold as many
//      active items as you can feed it, and two of the same item stack as two
//      independent entries with their own expiries. The ceiling is
//      EconomyCore.PRODUCTION_BONUS_MAX (+300%), which clamps the SUM of race
//      + research + blessing + items. Reaching it takes ~10 concurrent items
//      on one city; it is a backstop, not a balance dial.
//
//  State:
//    player.items      = { [itemId]: count }   — the backpack (empire-wide)
//    city.activeItems  = [{ itemId, startedAt, expiresAt }]
//
//  Read at runtime via EconomyCore.getCityItemEffects(city, now[, since]),
//  which is what both the client display (js/domain/production.js) and the
//  authoritative production tick (server/tick/catch-up.js) call.
//
//  `var`, NOT `const` — server/engine-loader.js runs this file through
//  vm.runInContext, where only `var` top-level declarations become properties
//  of the shared context. Same rule as BLESSING_DEFS and DISCOVERY_DEFS.
// =============================================

// ── The tier ladder ───────────────────────────────────────────
//
// tier is the ONLY thing that decides what drops: an item find of tier N rolls
// a random item of tier N (DiscoveryRoll.rollItem), and the find's own tier is
// already gated by Expedition Rating (RECRUIT_TIERS.tierOdds). So the ladder
// below is what a Common / Uncommon / Legendary force is shown, and it phases
// in and out exactly like resource loot does.
//
// WHY THESE NUMBERS. An item is worth `bonus × duration × the city's rate`, so
// it must be measured against what an expedition of the same tier pays in flat
// resources (TIER_RANGES: 800–5,000 / 5,000–25,000 / 25,000–50,000). Against a
// mature city (base L10 output ≈ 1,078 wood/h) the ladder pays:
//   tier 1  +20% × 24h ≈  5,200   (T1 band tops at 5,000)
//   tier 2  +35% × 48h ≈ 18,100   (T2 band is 5,000–25,000)
//   tier 3  +60% × 72h ≈ 46,600   (T3 band is 25,000–50,000)
// — i.e. an item is worth about a good find of its own tier, which is the
// point: it must never be a consolation prize, and it must never be so much
// better than coin that the resource finds read as duds.
//
// The trade the player makes is that an item pays SLOWLY and only where they
// put it, so a small city gets far less out of one than a big one. That is
// deliberate: it makes "which city" a real question instead of a formality.
var ITEM_DEFS = {

  // ── Tier 1 — food / wood / stone, 24h ───────────────────────
  cattle: {
    id:            'cattle',
    name:          'Cattle',
    icon:          gi('bison'),
    tier:          1,
    durationHours: 24,
    effects:       { food_production: 0.20 },
    summary:       '+20% food production for 24h',
    description:   'A driven herd, lowing and dusty, bought from a drover with more mouths than pasture. Turned loose on city fields they fatten fast.',
  },

  logging_camp: {
    id:            'logging_camp',
    name:          'Logging Camp',
    icon:          gi('pine-tree'),
    tier:          1,
    durationHours: 24,
    effects:       { wood_production: 0.20 },
    summary:       '+20% wood production for 24h',
    description:   'Axes, saws and a crew who know the cut. They will work a season for board and a share, and the woodpiles show it.',
  },

  quarry_gang: {
    id:            'quarry_gang',
    name:          'Quarry Gang',
    icon:          gi('war-pick'),
    tier:          1,
    durationHours: 24,
    effects:       { stone_production: 0.20 },
    summary:       '+20% stone production for 24h',
    description:   'Hard men with harder hammers, paid by the block. Nobody asks where they worked last.',
  },

  // ── Tier 2 — food / wood / stone, 48h ───────────────────────
  wild_herds: {
    id:            'wild_herds',
    name:          'Wild Herds',
    icon:          gi('deer'),
    tier:          2,
    durationHours: 48,
    effects:       { food_production: 0.35 },
    summary:       '+35% food production for 48h',
    description:   'Your scouts mapped the migration routes. For as long as the herds run, the hunting parties come back heavy.',
  },

  timber_charter: {
    id:            'timber_charter',
    name:          'Timber Charter',
    icon:          gi('wood-pile'),
    tier:          2,
    durationHours: 48,
    effects:       { wood_production: 0.35 },
    summary:       '+35% wood production for 48h',
    description:   'A sealed writ granting felling rights over a stand of old forest. The seal is genuine. The lord who sealed it is not answering letters.',
  },

  masons_guild: {
    id:            'masons_guild',
    name:          "Masons' Guild",
    icon:          gi('stone-block'),
    tier:          2,
    durationHours: 48,
    effects:       { stone_production: 0.35 },
    summary:       '+35% stone production for 48h',
    description:   'A guild charter and the masters who come with it. They cut faster, waste less, and teach while they work.',
  },

  // ── Tier 3 — food / wood / stone, 72h ───────────────────────
  golden_harvest: {
    id:            'golden_harvest',
    name:          'Golden Harvest',
    icon:          gi('sun'),
    tier:          3,
    durationHours: 72,
    effects:       { food_production: 0.60 },
    summary:       '+60% food production for 72h',
    description:   'Seed grain from a valley the frost forgot. It comes up gold, three ears to a stalk, and the granaries cannot hold it all.',
  },

  ironwood_grove: {
    id:            'ironwood_grove',
    name:          'Ironwood Grove',
    icon:          gi('holy-oak'),
    tier:          3,
    durationHours: 72,
    effects:       { wood_production: 0.60 },
    summary:       '+60% wood production for 72h',
    description:   'Deeds to a grove of ironwood — timber that turns a blade and takes a century to grow. Felling it is a crime somewhere. Not here.',
  },

  marble_vein: {
    id:            'marble_vein',
    name:          'Marble Vein',
    icon:          gi('crystal-growth'),
    tier:          3,
    durationHours: 72,
    effects:       { stone_production: 0.60 },
    summary:       '+60% stone production for 72h',
    description:   'A white seam running clean through the hillside, close enough to the surface to work with picks. Your masons wept when they saw it.',
  },

  horn_of_plenty: {
    id:            'horn_of_plenty',
    name:          'Horn of Plenty',
    icon:          gi('amphora'),
    tier:          3,
    durationHours: 72,
    effects:       { wood_production: 0.25, stone_production: 0.25, food_production: 0.25 },
    summary:       '+25% wood, stone AND food production for 72h',
    description:   'A drinking horn of no metal anyone can name, cold to the touch and never quite empty. What it pours depends on what the city lacks.',
  },
};

// Every item of a given tier — the drop pool DiscoveryRoll.rollItem draws from.
// Kept here rather than in the roll so the catalog stays the single place a new
// item has to be declared.
function itemsOfTier(tier) {
  return Object.values(ITEM_DEFS).filter(d => (d.tier || 1) === tier);
}

// How long an application lasts, in ms. One helper so the endpoint, the tests
// and any future preview can never disagree on the unit.
function itemDurationMs(itemId) {
  const def = ITEM_DEFS[itemId];
  return def ? Math.max(1, Math.floor(def.durationHours || 1)) * 3600 * 1000 : 0;
}

// The effect in one chip's worth of text: "+20% food", "+25% all resources".
// Derived from def.effects, NEVER from def.summary — a label built from prose
// can promise a number the engine does not apply. Both the city view and the
// quest log render through this, so they cannot drift.
function itemBonusLabel(def) {
  const fx   = (def && def.effects) || {};
  const keys = Object.keys(fx);
  if (keys.length === 0) return '';
  const pct = v => `+${Math.round(v * 100)}%`;
  // All three resources at the same rate reads as one promise, not three.
  if (keys.length === 3 && new Set(Object.values(fx)).size === 1) {
    return `${pct(fx[keys[0]])} all resources`;
  }
  return keys.map(k => `${pct(fx[k])} ${k.replace('_production', '')}`).join(' · ');
}
