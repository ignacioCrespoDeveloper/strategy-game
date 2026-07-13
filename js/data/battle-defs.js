// =============================================
//  battle-defs.js — Static data for the Battle Engine
//
//  TERRAIN_BATTLE_MODS  — per-terrain combat multipliers
//  CAMP_LEVEL_LOOT      — base gold + XP rewards by level (scaled by rewardMultiplier)
//  CAMP_DEFS            — unified camp catalog: display, mercs, defenders, loot scaling
//
//  To add a new camp type:
//    1. Add a DISCOVERY_DEFS entry in discoveries.js  (category: 'combat')
//    2. Add an entry here in CAMP_DEFS
//    Nothing else changes.
// =============================================

var TERRAIN_BATTLE_MODS = {
  plains:   { chargeMult: 1.2,  defenseMult: 1.0,  moraleMod:   0 },
  forest:   { chargeMult: 0.5,  defenseMult: 1.2,  moraleMod:   5 },
  hills:    { chargeMult: 0.8,  defenseMult: 1.15, moraleMod:   0 },
  marsh:    { chargeMult: 0.3,  defenseMult: 0.9,  moraleMod: -10 },
  mountain: { chargeMult: 0.4,  defenseMult: 1.3,  moraleMod:  -5 },
  desert:   { chargeMult: 1.0,  defenseMult: 0.9,  moraleMod:  -8 },
  coast:    { chargeMult: 0.9,  defenseMult: 1.0,  moraleMod:   0 },
};

// ── Base loot by level — scaled by each camp's rewardMultiplier ──────

var CAMP_LEVEL_LOOT = {
  1: { goldMin: 20,   goldMax: 60,   xpWin: 20,  xpLoss: 5  },
  2: { goldMin: 60,   goldMax: 140,  xpWin: 45,  xpLoss: 12 },
  3: { goldMin: 140,  goldMax: 300,  xpWin: 85,  xpLoss: 25 },
  4: { goldMin: 300,  goldMax: 650,  xpWin: 160, xpLoss: 50 },
  5: { goldMin: 650,  goldMax: 1200, xpWin: 300, xpLoss: 90 },
};

// ── Camp definitions ─────────────────────────────────────────────────
//
// id                    → must match a DISCOVERY_DEFS key (category: 'combat')
// displayName           → shown in camp preview and battle UI
// icon                  → emoji
// morale                → starting morale of the defender side
// rewardMultiplier      → multiplies CAMP_LEVEL_LOOT gold and XP
// levelRange            → [min, max] the army-power roll is clamped to this range
// mercenaryRoster       → unit IDs available for instant hire; null = no recruitment
// defenderRosterByLevel → level → [{ unitId, count }] defender army at that level
//
// levelRange tiers:
//   Tier 1 [1,3]  — bandit_camp, goblin_camp
//   Tier 2 [2,4]  — mercenary_company, wolf_rider_camp
//   Tier 3 [3,5]  — ogre_camp, orc_warcamp
//   Tier 4 [3,5]  — dark_elf_raiders, dwarf_expedition
//   Tier 5 [4,5]  — beast_lair, dragon_cult

var CAMP_DEFS = {

  // ── Tier 1 ───────────────────────────────────────────────────────

  bandit_camp: {
    id:               'bandit_camp',
    displayName:      'Bandit Camp',
    icon:             '🏕',
    morale:           55,
    rewardMultiplier: 1.0,
    levelRange:       [1, 3],
    mercenaryRoster:  ['bandits', 'bandit_archers'],
    defenderRosterByLevel: {
      1: [{ unitId: 'bandits', count: 2 }, { unitId: 'bandit_archers', count: 1 }],
      2: [{ unitId: 'bandits', count: 4 }, { unitId: 'bandit_archers', count: 2 }],
      3: [{ unitId: 'bandits', count: 5 }, { unitId: 'bandit_archers', count: 3 }, { unitId: 'mercenary_spearmen', count: 1 }],
    },
  },

  goblin_camp: {
    id:               'goblin_camp',
    displayName:      'Goblin Camp',
    icon:             '👺',
    morale:           40,
    rewardMultiplier: 0.9,
    levelRange:       [1, 3],
    mercenaryRoster:  ['goblin_spearmen', 'goblin_archers'],
    defenderRosterByLevel: {
      1: [{ unitId: 'goblin_rabble', count: 3 }],
      2: [{ unitId: 'goblin_rabble', count: 5 }, { unitId: 'goblin_archers', count: 2 }],
      3: [{ unitId: 'goblin_rabble', count: 7 }, { unitId: 'goblin_archers', count: 3 }, { unitId: 'goblin_wolf_riders', count: 1 }],
    },
  },

  // ── Tier 2 ───────────────────────────────────────────────────────

  mercenary_company: {
    id:               'mercenary_company',
    displayName:      'Mercenary Company',
    icon:             '⚔',
    morale:           70,
    rewardMultiplier: 1.5,
    levelRange:       [2, 4],
    mercenaryRoster:  ['swordsmen', 'pikemen', 'crossbowmen'],
    defenderRosterByLevel: {
      2: [{ unitId: 'mercenary_spearmen', count: 3 }, { unitId: 'mercenary_crossbows', count: 1 }],
      3: [{ unitId: 'mercenary_spearmen', count: 5 }, { unitId: 'mercenary_crossbows', count: 2 }],
      4: [{ unitId: 'mercenary_spearmen', count: 7 }, { unitId: 'mercenary_crossbows', count: 3 }],
    },
  },

  wolf_rider_camp: {
    id:               'wolf_rider_camp',
    displayName:      'Wolf Rider Camp',
    icon:             '🐺',
    morale:           50,
    rewardMultiplier: 1.4,
    levelRange:       [2, 4],
    mercenaryRoster:  ['goblin_wolf_riders', 'goblin_archers'],
    defenderRosterByLevel: {
      2: [{ unitId: 'goblin_wolf_riders', count: 2 }, { unitId: 'goblin_rabble', count: 3 }],
      3: [{ unitId: 'goblin_wolf_riders', count: 4 }, { unitId: 'goblin_archers', count: 2 }, { unitId: 'goblin_rabble', count: 3 }],
      4: [{ unitId: 'goblin_wolf_riders', count: 6 }, { unitId: 'goblin_archers', count: 3 }, { unitId: 'goblin_rabble', count: 4 }],
    },
  },

  // ── Tier 3 ───────────────────────────────────────────────────────

  ogre_camp: {
    id:               'ogre_camp',
    displayName:      'Ogre Camp',
    icon:             '💀',
    morale:           80,
    rewardMultiplier: 2.0,
    levelRange:       [3, 5],
    mercenaryRoster:  ['ogre_bulls', 'ironguts'],
    defenderRosterByLevel: {
      3: [{ unitId: 'ogre_warrior', count: 2 }, { unitId: 'goblin_rabble', count: 4 }],
      4: [{ unitId: 'ogre_warrior', count: 3 }, { unitId: 'goblin_archers', count: 3 }, { unitId: 'goblin_rabble', count: 3 }],
      5: [{ unitId: 'ogre_warrior', count: 4 }, { unitId: 'ogre_champion', count: 1 }],
    },
  },

  orc_warcamp: {
    id:               'orc_warcamp',
    displayName:      'Orc Warcamp',
    icon:             '🪓',
    morale:           65,
    rewardMultiplier: 2.0,
    levelRange:       [3, 5],
    mercenaryRoster:  ['orc_boyz', 'goblin_archers', 'boar_boyz'],
    defenderRosterByLevel: {
      3: [{ unitId: 'orc_boyz', count: 4 }, { unitId: 'goblin_archers', count: 2 }],
      4: [{ unitId: 'orc_boyz', count: 5 }, { unitId: 'black_orcs', count: 1 }, { unitId: 'goblin_archers', count: 3 }],
      5: [{ unitId: 'orc_boyz', count: 6 }, { unitId: 'black_orcs', count: 2 }, { unitId: 'boar_boyz', count: 1 }, { unitId: 'goblin_archers', count: 3 }],
    },
  },

  // ── Tier 4 ───────────────────────────────────────────────────────

  dark_elf_raiders: {
    id:               'dark_elf_raiders',
    displayName:      'Dark Elf Raiders',
    icon:             '🌑',
    morale:           75,
    rewardMultiplier: 2.5,
    levelRange:       [3, 5],
    mercenaryRoster:  ['dreadspears', 'darkshards', 'dark_riders'],
    defenderRosterByLevel: {
      3: [{ unitId: 'dreadspears', count: 3 }, { unitId: 'darkshards', count: 2 }],
      4: [{ unitId: 'dreadspears', count: 4 }, { unitId: 'darkshards', count: 3 }, { unitId: 'dark_riders', count: 1 }],
      5: [{ unitId: 'dreadspears', count: 5 }, { unitId: 'darkshards', count: 4 }, { unitId: 'dark_riders', count: 2 }, { unitId: 'witch_elves', count: 1 }],
    },
  },

  dwarf_expedition: {
    id:               'dwarf_expedition',
    displayName:      'Dwarf Expedition',
    icon:             '⛏',
    morale:           85,
    rewardMultiplier: 2.5,
    levelRange:       [3, 5],
    mercenaryRoster:  ['dwarf_warriors', 'thunderers'],
    defenderRosterByLevel: {
      3: [{ unitId: 'dwarf_warriors', count: 3 }, { unitId: 'thunderers', count: 2 }],
      4: [{ unitId: 'dwarf_warriors', count: 5 }, { unitId: 'thunderers', count: 3 }, { unitId: 'longbeards', count: 1 }],
      5: [{ unitId: 'dwarf_warriors', count: 6 }, { unitId: 'thunderers', count: 4 }, { unitId: 'longbeards', count: 2 }, { unitId: 'ironbreakers', count: 1 }],
    },
  },

  // ── Tier 5 ───────────────────────────────────────────────────────

  beast_lair: {
    id:               'beast_lair',
    displayName:      'Beast Lair',
    icon:             '🦴',
    morale:           90,
    rewardMultiplier: 3.5,
    levelRange:       [4, 5],
    mercenaryRoster:  null,
    defenderRosterByLevel: {
      4: [{ unitId: 'forest_troll', count: 2 }, { unitId: 'trolls', count: 1 }],
      5: [{ unitId: 'forest_troll', count: 3 }, { unitId: 'trolls', count: 2 }, { unitId: 'arachnarok_spider', count: 1 }],
    },
  },

  dragon_cult: {
    id:               'dragon_cult',
    displayName:      'Dragon Cult',
    icon:             '🐲',
    morale:           95,
    rewardMultiplier: 3.5,
    levelRange:       [4, 5],
    mercenaryRoster:  null,
    defenderRosterByLevel: {
      4: [{ unitId: 'dragon_guard', count: 3 }, { unitId: 'young_dragon', count: 1 }],
      5: [{ unitId: 'dragon_guard', count: 5 }, { unitId: 'young_dragon', count: 2 }],
    },
  },

};
