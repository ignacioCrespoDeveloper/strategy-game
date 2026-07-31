// =============================================
//  engine-loader.js — Isomorphic engine for Node
//
//  Loads the battle engine and its data dependencies
//  into a shared vm context (simulates browser global
//  scope). All files use `var` at top level so their
//  declarations become properties of the context.
//
//  Load order mirrors index.html script tags.
//  This file is the ONLY place that loads engine code
//  on the server — never require engine files directly.
// =============================================

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import vm from 'vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

function load(relPath) {
  const code = readFileSync(join(ROOT, relPath), 'utf8');
  vm.runInContext(code, _ctx);
}

// Provide Math and console — engine files use them.
// Omit window/document so files that check `typeof window`
// will see it as undefined (same as browser, not Node).
// gi() mirrors js/core/icons.js — data files call it in their icon fields,
// and the markup must match what the client renders (campIcon etc. are
// sent to the client and interpolated into innerHTML there).
const _ctx = vm.createContext({
  Math, console, Date,
  gi: (name, cls) => '<svg class="gi' + (cls ? ' ' + cls : '') + '" viewBox="0 0 512 512" aria-hidden="true"><use href="#gi-' + name + '"/></svg>',
});

// ── Load order: deps before consumers ────────────────────────
load('js/data/tuning.js');           // TUNING + tune() — MUST precede economy-core & discovery-roll
load('js/data/lord-classes.js');     // LORD_BASE_STATS, LORD_CLASSES
load('js/data/lord-portraits.js');   // LORD_PORTRAIT_POOLS, rollLordPortrait (no deps)
load('js/data/stances.js');          // STANCE_DEFS
load('js/data/units.js');            // UNIT_DEFS
load('js/data/buildings.js');        // BUILDING_DEFS
load('js/data/research.js');         // RESEARCH_DEFS, RESEARCH_TIERS (Library books)
load('js/data/blessings.js');        // BLESSING_DEFS, blessingDuration, blessingCost (Temple blessings)
load('js/data/races.js');            // RACES
load('js/domain/world.js');          // TERRAIN_RESOURCE_MODS, TERRAIN_STAT_MODS (WorldService itself is unused here)
load('js/domain/economy-core.js');   // EconomyCore — THE shared economy math (needs BUILDING_DEFS)
load('js/domain/market-core.js');    // MarketCore — THE shared merchant rates/cap (no deps)
load('js/domain/unit-unlock.js');    // UnitUnlockService — THE recruitment gate (needs UNIT_DEFS, EconomyCore)
load('js/data/battle-defs.js');      // TERRAIN_BATTLE_MODS, CAMP_DEFS
load('js/data/discoveries.js');      // DISCOVERY_DEFS
load('js/domain/discovery-roll.js'); // DiscoveryRoll — THE shared quest roll math
load('js/domain/battle-targeting.js');
load('js/domain/battle-morale.js');  // needs TERRAIN_BATTLE_MODS
load('js/domain/battle-traits.js');
load('js/domain/battle-engine.js'); // needs all above; buildContext() drives server-side PvE resolution

export const BattleEngine          = _ctx.BattleEngine;
export const UNIT_DEFS             = _ctx.UNIT_DEFS;
export const UNIT_ROSTER           = _ctx.UNIT_ROSTER;
export const BUILDING_DEFS         = _ctx.BUILDING_DEFS;
export const RESEARCH_DEFS         = _ctx.RESEARCH_DEFS;
export const RESEARCH_TIERS        = _ctx.RESEARCH_TIERS;
export const BLESSING_DEFS         = _ctx.BLESSING_DEFS;
export const BLESSING_MIN_TEMPLE   = _ctx.BLESSING_MIN_TEMPLE;
export const BLESSING_COST_MIX     = _ctx.BLESSING_COST_MIX;
export const blessingMaxHours      = _ctx.blessingMaxHours;
export const blessingDuration      = _ctx.blessingDuration;
export const blessingCost          = _ctx.blessingCost;
export const RACES                 = _ctx.RACES;
export const EconomyCore           = _ctx.EconomyCore;
export const MarketCore            = _ctx.MarketCore;
export const TUNING                = _ctx.TUNING;
export const tune                  = _ctx.tune;
export const UnitUnlockService     = _ctx.UnitUnlockService;
export const TERRAIN_RESOURCE_MODS = _ctx.TERRAIN_RESOURCE_MODS;
export const TERRAIN_STAT_MODS     = _ctx.TERRAIN_STAT_MODS;
export const TERRAIN_BATTLE_MODS   = _ctx.TERRAIN_BATTLE_MODS;
export const BATTLE_WIN_HEAL_PCT   = _ctx.BATTLE_WIN_HEAL_PCT;
export const LORD_BASE_STATS       = _ctx.LORD_BASE_STATS;
export const LORD_CLASSES          = _ctx.LORD_CLASSES;
export const isClassRecruitable    = _ctx.isClassRecruitable;
export const getRecruitableClasses = _ctx.getRecruitableClasses;
export const LORD_MAX_LEVEL        = _ctx.LORD_MAX_LEVEL;
export const lordStatGain          = _ctx.lordStatGain;
export const rollLordPortrait      = _ctx.rollLordPortrait;
export const pickLordPortrait      = _ctx.pickLordPortrait;
export const STANCE_DEFS           = _ctx.STANCE_DEFS;
export const TALENT_POOL           = _ctx.TALENT_POOL;
export const MOUNT_POOL            = _ctx.MOUNT_POOL;
export const MOUNT_SLOTS           = _ctx.MOUNT_SLOTS;
export const getMountForRace       = _ctx.getMountForRace;
export const resolveMountId        = _ctx.resolveMountId;
export const getLordMount          = _ctx.getLordMount;
export const getLordMountEffects   = _ctx.getLordMountEffects;
export const getMountsForRace      = _ctx.getMountsForRace;
export const MOUNT_SELL_REFUND     = _ctx.MOUNT_SELL_REFUND;
export const mountSellValue        = _ctx.mountSellValue;
export const lordRansomCost        = _ctx.lordRansomCost;
export const DISCOVERY_DEFS        = _ctx.DISCOVERY_DEFS;
export const DiscoveryRoll         = _ctx.DiscoveryRoll;
export const CAMP_DEFS             = _ctx.CAMP_DEFS;
export const CAMP_LEVEL_LOOT       = _ctx.CAMP_LEVEL_LOOT;

// ── The engine bundle catchUp() expects ──────────────────────────
// server/tick/catch-up.js takes everything it needs through one `engine`
// argument. This used to be four hand-copied object literals (action-base.js,
// sync.js, actions/instant-action.js, tick/event-dispatcher.js) that all had to
// be edited in lockstep.
//
// THAT IS A SILENT-FAILURE SHAPE: a key missing from one copy does not throw,
// it just reads undefined — a def vanishes or a tuning dial quietly reads 1.0
// on that one code path. Adding `tune` for the quest dials hit exactly this.
// One object, four importers, no drift. Add new engine deps HERE.
export const ENGINE = {
  DISCOVERY_DEFS, CAMP_DEFS, CAMP_LEVEL_LOOT, TALENT_POOL,
  LORD_BASE_STATS, LORD_CLASSES, UNIT_DEFS, BUILDING_DEFS, RACES,
  EconomyCore, MarketCore, tune,
  TERRAIN_RESOURCE_MODS, TERRAIN_STAT_MODS,
  pickLordPortrait, DiscoveryRoll, BattleEngine, BATTLE_WIN_HEAL_PCT,
  // Mounts: catch-up reads them for the army PWR cap AND for the Expedition
  // Rating bonus on scout mounts. getLordMountEffects (not MOUNT_POOL) is the
  // one that matters — it resolves a stored id against the lord's race.
  MOUNT_POOL, getLordMountEffects,
};
