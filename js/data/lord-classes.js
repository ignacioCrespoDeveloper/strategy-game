// =============================================
//  lord-classes.js — Lord class definitions
//
//  Every lord starts from LORD_BASE_STATS.
//  The chosen class applies permanent modifiers.
//
//  To add a new class: append an entry to LORD_CLASSES.
//  Nothing else changes.
// =============================================

var LORD_BASE_STATS = {
  health:     100,
  attack:     5,
  defense:    5,
  leadership: 5,
  magic:      5,
  speed:      5,
};

// Hard level cap. XP still accrues from battles and quests, it simply stops
// converting into levels here. Enforced in all three level-up implementations:
// js/domain/lord.js checkLevelUp (client), server/combat-resolver.js
// _checkLevelUp, and server/tick/catch-up.js _checkLevelUp — that last one
// keeps its own copy on purpose (it's a dependency-free module, same reason it
// carries its own _xpToNextLevel).
var LORD_MAX_LEVEL = 10;

// How much one spent talent point moves a stat. Health lives on a ~100-based
// scale while every other stat sits between 5 and 20, so a flat +1 to health
// was worth almost nothing next to +1 attack — a point had to be worth ~15
// health to be a real choice against the alternatives.
var LORD_STAT_POINT_GAIN = { health: 15 };

function lordStatGain(statKey, points) {
  return (LORD_STAT_POINT_GAIN[statKey] || 1) * points;
}

// Soft display maximums for progress bars — not hard caps.
// health raised 200 → 300 alongside LORD_STAT_POINT_GAIN: a level-10 lord who
// banked every point into health now lands around 250, which would have sat
// pegged at the end of the old bar with no visible progress for the last third.
var LORD_STAT_MAX = {
  health:     300,
  attack:     20,
  defense:    20,
  leadership: 20,
  magic:      20,
  speed:      20,
};

// Icon, colour and label for each stat — consumed by all UI components.
var LORD_STAT_META = {
  health:     { label: 'Health',     icon: gi('hearts'),  color: '#4aaa4a' },
  attack:     { label: 'Attack',     icon: gi('crossed-swords'),  color: '#c05040' },
  defense:    { label: 'Defense',    icon: gi('round-shield'),  color: '#4070d0' },
  leadership: { label: 'Leadership', icon: gi('crown'),  color: '#c8933a' },
  magic:      { label: 'Magic',      icon: gi('magic-swirl'),  color: '#9040c0' },
  speed:      { label: 'Speed',      icon: gi('wingfoot'),  color: '#30a0b0' },
};

var LORD_CLASSES = {
  warrior: {
    id:          'warrior',
    name:        'Warrior',
    icon:        gi('crossed-swords'),
    color:       '#c05040',
    description: 'Masters of direct combat. Warriors lead from the front and inspire allies through sheer force of arms.',
    modifiers:   { attack: 2, defense: 2 },
    passive: {
      id:          'commander',
      name:        'Commander',
      icon:        gi('round-shield'),
      description: 'Born to lead armies into battle. Future: grants +2 Attack to every unit under your command.',
    },
  },

  rogue: {
    id:          'rogue',
    name:        'Rogue',
    icon:        gi('plain-dagger'),
    color:       '#20b060',
    description: 'Swift and elusive. Rogues excel at exploration and strike before the enemy knows they are there.',
    modifiers:   { speed: 3, attack: 1 },
    passive: {
      id:          'explorer',
      name:        'Explorer',
      icon:        gi('magnifying-glass'),
      description: 'Search Area takes half the time. Higher chance of valuable discoveries.',
      effects: {
        searchDurationMult:   0.5,
        discoveryWeightBonus: 0.3,
      },
    },
  },

  priest: {
    id:          'priest',
    name:        'Priest',
    icon:        gi('crucifix'),
    color:       '#d0b040',
    description: 'Spiritual leaders who bolster the faith of the people. Priests keep cities loyal and prosperous.',
    modifiers:   { leadership: 3, defense: 1 },
    passive: {
      id:          'faithkeeper',
      name:        'Faithkeeper',
      icon:        gi('sun'),
      description: 'Improves city Happiness while the lord is present. Future: healing, diplomacy and religious authority.',
    },
  },

  mage: {
    id:          'mage',
    name:        'Mage',
    icon:        gi('crystal-ball'),
    color:       '#8040c0',
    description: 'Scholars of the arcane. Mages wield devastating magic and push the boundaries of knowledge.',
    modifiers:   { magic: 4, leadership: 1 },
    passive: {
      id:          'arcane_scholar',
      name:        'Arcane Scholar',
      icon:        gi('book-pile'),
      description: 'Deep mastery of magical arts. Future: magic damage, research acceleration, magic resistance.',
    },
  },

  dark_lord: {
    id:          'dark_lord',
    name:        'Dark Lord',
    icon:        gi('death-skull'),
    color:       '#8030a0',
    description: 'Warlords who thrive on conquest and fear. Their dark power grows with every victory.',
    modifiers:   { attack: 2, magic: 2 },
    passive: {
      id:          'dark_presence',
      name:        'Dark Presence',
      icon:        gi('flame'),
      description: 'Spreads corruption and terror. Future: dark magic bonuses, enhanced rewards from aggressive actions.',
    },
  },
};

// =============================================
//  TALENT_POOL — Cross-class talents unlocked at level 5.
//
//  Lords choose exactly one talent, permanently.
//  Combat talents add traits/stats to the lord's BattleUnit.
//  Strategic talents apply passive effects via getTalentEffects().
//
//  effects keys used by the engine:
//    searchDurationMult    — multiplier on search action duration (lord.js)
//    goldDiscoveryBonus    — extra weight on gold-type discoveries (discovery.js)
//    commandCapacityBonus  — extra unit model slots (lord.js)
//    armyPowerCapBonus     — extra CP cap (lord.js)
//    attackerMoraleBonus   — own-side morale boost at battle start (battle-engine.js)
//    defenderMoraleMalus   — enemy morale penalty at battle start (battle-engine.js)
//    xpMultiplier          — multiplier on all XP earned (lord.js, lord-screen.js, battle-result-view.js)
//    recruitTimeMult       — multiplier on unit training duration (server/actions/recruit.js)
//    battleUnitTraits      — array of traits injected into the lord BattleUnit (battle-engine.js)
//    battleUnitAttackBonus — flat attack added to lord BattleUnit (battle-engine.js)
//    battleUnitDefenseBonus— flat defense added to lord BattleUnit (battle-engine.js)
// =============================================

var TALENT_POOL = {

  // ── Combat talents ────────────────────────────────────────────

  blademaster: {
    id:          'blademaster',
    name:        'Blademaster',
    icon:        gi('crossed-swords'),
    color:       '#c05040',
    category:    'combat',
    description: 'Your lord fights with deadly precision in battle. +4 Attack and armor-piercing strikes — enemy armor provides minimal protection.',
    hint:        'Best for Warriors',
    effects: {
      battleUnitAttackBonus: 4,
      battleUnitTraits:      ['armor_piercing'],
    },
  },

  double_strike: {
    id:          'double_strike',
    name:        'Double Strike',
    icon:        gi('plain-dagger'),
    color:       '#20b060',
    category:    'combat',
    description: 'Your lord strikes with blinding speed. 30% chance to attack twice per melee round.',
    hint:        'Best for Rogues & Dark Lords',
    effects: {
      battleUnitTraits: ['double_strike'],
    },
  },

  pyroblast: {
    id:          'pyroblast',
    name:        'Pyroblast',
    icon:        gi('flame'),
    color:       '#9040c0',
    category:    'combat',
    description: 'In the opening round your lord unleashes a torrent of arcane fire, scorching all enemies simultaneously and suppressing their regeneration.',
    hint:        'Best for Mages',
    effects: {
      battleUnitTraits: ['pyroblast'],
    },
  },

  iron_wall: {
    id:          'iron_wall',
    name:        'Iron Wall',
    icon:        gi('round-shield'),
    color:       '#4070d0',
    category:    'combat',
    description: 'Your lord becomes an immovable bastion. +4 Defense and the Shield Wall ability — incoming melee damage reduced while frontline units stand.',
    hint:        'Best for Warriors & Priests',
    effects: {
      battleUnitDefenseBonus: 4,
      battleUnitTraits:       ['shield_wall'],
    },
  },

  // ── Strategic talents ─────────────────────────────────────────

  pathfinder: {
    id:          'pathfinder',
    name:        'Pathfinder',
    icon:        gi('magnifying-glass'),
    color:       '#30a0b0',
    category:    'strategic',
    description: 'Your lord navigates the wilderness with unmatched instinct. Quest duration reduced by 25%.',
    hint:        'Best for Rogues & explorers',
    effects: {
      searchDurationMult: 0.75,
    },
  },

  treasure_hunter: {
    id:          'treasure_hunter',
    name:        'Treasure Hunter',
    icon:        gi('two-coins'),
    color:       '#c8933a',
    category:    'strategic',
    description: 'Your lord has a nose for coin. Gold-type discoveries (coin caches, lost treasures, buried vaults) appear 40% more frequently.',
    hint:        'Best for any gold-focused build',
    effects: {
      goldDiscoveryBonus: 0.4,
    },
  },

  commander: {
    id:          'commander',
    name:        'Commander',
    icon:        gi('crown'),
    color:       '#c8933a',
    category:    'strategic',
    description: 'Your lord inspires loyalty and discipline. Army capacity increased by +2 unit slots.',
    hint:        'Best for large-army builds',
    effects: {
      commandCapacityBonus: 2,
    },
  },

  strategist: {
    id:          'strategist',
    name:        'Strategist',
    icon:        gi('treasure-map'),
    color:       '#4070d0',
    category:    'strategic',
    description: 'Your lord commands with iron authority. Army Combat Power cap increased by +100 CP.',
    hint:        'Best for elite heavy armies',
    effects: {
      armyPowerCapBonus: 100,
    },
  },

  inspiring: {
    id:          'inspiring',
    name:        'Inspiring',
    icon:        gi('sun'),
    color:       '#d0b040',
    category:    'strategic',
    description: 'Your lord\'s presence lifts the spirits of every soldier. Allied morale starts 10 points higher at the start of every battle.',
    hint:        'Best for Priests & support lords',
    effects: {
      attackerMoraleBonus: 10,
    },
  },

  fearsome: {
    id:          'fearsome',
    name:        'Fearsome',
    icon:        gi('death-skull'),
    color:       '#8030a0',
    category:    'strategic',
    description: 'Your lord\'s reputation precedes them. Enemy forces enter battle with 10 less morale.',
    hint:        'Best for Dark Lords & aggressors',
    effects: {
      defenderMoraleMalus: 10,
    },
  },

  scholar: {
    id:          'scholar',
    name:        'Scholar',
    icon:        gi('book-pile'),
    color:       '#9040c0',
    category:    'strategic',
    description: 'Your lord reflects deeply on every experience. All XP earned from quests, battles, and actions increased by 20%.',
    hint:        'Best for fast leveling',
    effects: {
      xpMultiplier: 1.2,
    },
  },

  drillmaster: {
    id:          'drillmaster',
    name:        'Drillmaster',
    icon:        gi('anvil'),
    color:       '#c05040',
    category:    'strategic',
    description: 'Your lord runs relentless training regimens. Unit recruitment time reduced by 30%.',
    hint:        'Best for rapid army expansion',
    effects: {
      recruitTimeMult: 0.7,
    },
  },
};

// =============================================
//  MOUNT_POOL — A lord may equip exactly one mount at a time, freely
//  swappable (unlike talents, not permanent). Each swap costs `cost`
//  gold, deducted server-side.
//
//  THE LADDER (design call 2026-07-29). Mounts arrive in three tiers
//  instead of all at once, so there is something new to reach for across
//  the whole second half of the level curve:
//
//    Lv 5   Warhorse    · Dire Wolf     — 4 stat points,  ~400g
//    Lv 8   War Chariot · War Bear      — 7 stat points, ~1150g
//    Lv 10  Griffon     · Dragon        — 10 stat points, ~2600g
//
//  Within a tier the two mounts are SIDEGRADES on the same budget — one
//  leans fast, one leans sturdy — so the pick is a shape choice, not a
//  power choice. Across tiers power genuinely climbs, which is what the
//  level gate is paying for.
//
//  Mounts are deliberately flat stat pads: no traits, no abilities, no
//  battle hooks (Nacho, 2026-07-29). `effects` keys are added straight
//  onto the lord's effective stats (LordService.getEffectiveStats) and
//  are the same keys as LORD_BASE_STATS (health, attack, defense,
//  leadership, magic, speed).
//
//  unlockLevel → minimum lord level; enforced server-side in
//                server/actions/lord-mounts.js, shown as a locked card
//                in the Mount tab so the whole ladder is visible early.
//  image       → mount artwork, shown instead of `icon` when the file
//                loads. The paths below are PRE-WIRED to
//                assets/mounts/<id>.png — drop the files in and they
//                appear with no code change; until then _mountVisual()'s
//                onerror quietly falls back to the icon glyph. Several
//                icons are only the nearest glyph the sprite had
//                (chariot, bear) and are placeholders until art lands.
// =============================================

var MOUNT_MIN_LEVEL = 5;

var MOUNT_POOL = {
  // ── Tier 1 · level 5 ─────────────────────────────────
  warhorse: {
    id:          'warhorse',
    name:        'Warhorse',
    icon:        gi('horse-head'),
    image:       'assets/mounts/warhorse.png',
    color:       '#c8933a',
    description: 'A sturdy battle-trained warhorse. Balanced power and mobility for any lord.',
    unlockLevel: 5,
    cost:        400,
    effects: {
      attack: 2,
      speed:  2,
    },
  },

  dire_wolf: {
    id:          'dire_wolf',
    name:        'Dire Wolf',
    icon:        gi('wolf-head'),
    image:       'assets/mounts/dire_wolf.png',
    color:       '#4070d0',
    description: 'A massive wolf bred for speed and the hunt. Outruns any pursuer.',
    unlockLevel: 5,
    cost:        450,
    effects: {
      attack: 1,
      speed:  3,
    },
  },

  // ── Tier 2 · level 8 ─────────────────────────────────
  war_chariot: {
    id:          'war_chariot',
    name:        'War Chariot',
    icon:        gi('mounted-knight'),
    image:       'assets/mounts/war_chariot.png',
    color:       '#c06a30',
    description: 'A scythed war-chariot drawn by a matched team. Builds terrifying momentum on open ground.',
    unlockLevel: 8,
    cost:        1100,
    effects: {
      attack:  3,
      defense: 1,
      speed:   3,
    },
  },

  // Replaced the old Armored Boar (same level-8 sturdy slot). A lord still
  // holding the retired `armored_boar` id simply shows an empty mount slot
  // and re-picks for free — every read site is `MOUNT_POOL[id]?.effects || {}`,
  // so an unknown id degrades to "no mount" rather than throwing.
  war_bear: {
    id:          'war_bear',
    name:        'War Bear',
    icon:        gi('bison'),
    image:       'assets/mounts/war_bear.png',
    color:       '#8a6a4a',
    description: 'A mountain bear broken to the saddle and armoured at the shoulders. Absorbs a charge and answers it.',
    unlockLevel: 8,
    cost:        1200,
    effects: {
      attack:  3,
      defense: 4,
    },
  },

  // ── Tier 3 · level 10 ────────────────────────────────
  griffon: {
    id:          'griffon',
    name:        'Griffon',
    icon:        gi('eagle-emblem'),
    image:       'assets/mounts/griffon.png',
    color:       '#30a0b0',
    description: 'A majestic aerial predator, striking from above with deadly talons.',
    unlockLevel: 10,
    cost:        2400,
    effects: {
      attack:  4,
      defense: 2,
      speed:   4,
    },
  },

  dragon: {
    id:          'dragon',
    name:        'Dragon',
    icon:        gi('dragon-head'),
    image:       'assets/mounts/dragon.png',
    color:       '#c04030',
    description: 'An ancient wyrm that suffers a rider only because it chooses to. Armies break at the sight of it.',
    unlockLevel: 10,
    cost:        2800,
    effects: {
      attack:  5,
      defense: 4,
      speed:   1,
    },
    // Flavour only (see getMountForRace): the Dark Elves ride a Black Dragon
    // out of Naggaroth instead of the common wyrm. Same stats, same cost,
    // same `dragon` id in storage — only the presentation changes.
    raceVariants: {
      dark_elf: {
        name:        'Black Dragon',
        icon:        gi('dragon-spiral'),
        image:       'assets/mounts/dragon_dark_elf.png',
        color:       '#8030a0',
        description: 'A Black Dragon dragged from the caves beneath Naggaroth and broken to the saddle. It hates its rider only slightly less than everything else.',
      },
    },
  },
};

// Resolves a mount for display, applying any race flavour variant.
//
// Variants may ONLY override presentation (name, icon, image, color,
// description) — `effects`, `cost` and `unlockLevel` always come from the
// base mount, so adding flavour can never become a balance change. The
// stored `lord.mountId` is always the base id ('dragon'), never a
// per-race id, so nothing in save data or the server gate has to know
// variants exist.
function getMountForRace(mountId, raceId) {
  const has = (o, k) => o && Object.prototype.hasOwnProperty.call(o, k);
  if (!has(MOUNT_POOL, mountId)) return null;   // own-property only: 'constructor' is not a mount
  const base    = MOUNT_POOL[mountId];
  const variant = raceId && has(base.raceVariants, raceId) ? base.raceVariants[raceId] : null;
  if (!variant) return base;

  // Copy ONLY presentation keys off the variant. Spreading it wholesale would
  // let a future variant redefine effects/cost/unlockLevel and silently turn
  // flavour into a balance change — the one thing the comment above promises
  // can't happen.
  const out = { ...base };
  for (const key of ['name', 'icon', 'image', 'color', 'description']) {
    if (has(variant, key)) out[key] = variant[key];
  }
  return out;
}

// =============================================
//  Lord capture — fixed, non-negotiable gold ransom to free a captured lord.
//  Scales with level so a high-level lord costs meaningfully more to free
//  than a fresh one. Used both client-side (price display before paying) and
//  server-side (server/actions/lord-ransom.js validates/charges this exact
//  number) — loaded server-side via server/engine-loader.js.
// =============================================
function lordRansomCost(level) {
  return 300 + (level || 1) * 150;
}
