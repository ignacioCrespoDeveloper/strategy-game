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
const _ctx = vm.createContext({ Math, console, Date });

// ── Load order: deps before consumers ────────────────────────
load('js/data/lord-classes.js');     // LORD_BASE_STATS, LORD_CLASSES
load('js/data/stances.js');          // STANCE_DEFS
load('js/data/units.js');            // UNIT_DEFS
load('js/data/buildings.js');        // BUILDING_DEFS
load('js/data/races.js');            // RACES
load('js/data/battle-defs.js');      // TERRAIN_BATTLE_MODS, CAMP_DEFS
load('js/domain/battle-targeting.js');
load('js/domain/battle-morale.js');  // needs TERRAIN_BATTLE_MODS
load('js/domain/battle-traits.js');
load('js/domain/battle-engine.js'); // needs all above; buildContext() not used server-side

export const BattleEngine        = _ctx.BattleEngine;
export const UNIT_DEFS           = _ctx.UNIT_DEFS;
export const BUILDING_DEFS       = _ctx.BUILDING_DEFS;
export const RACES               = _ctx.RACES;
export const TERRAIN_BATTLE_MODS = _ctx.TERRAIN_BATTLE_MODS;
export const LORD_BASE_STATS     = _ctx.LORD_BASE_STATS;
export const LORD_CLASSES        = _ctx.LORD_CLASSES;
export const STANCE_DEFS         = _ctx.STANCE_DEFS;
