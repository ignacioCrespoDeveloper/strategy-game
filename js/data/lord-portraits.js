// =============================================
//  lord-portraits.js — Portrait image pools per race + class
//
//  Add new images by adding paths to the arrays below.
//
//  Two entry points, and the difference matters:
//    rollLordPortrait(race, class)        — a TRUE random roll. Called
//        ONCE, server-side, at lord creation. The result is persisted on
//        lord.portrait and is that lord's face forever.
//    pickLordPortrait(race, class, lordId) — a deterministic hash of the
//        lord id. FALLBACK ONLY, for lords whose stored portrait isn't
//        available: pre-existing lords created before portraits were
//        persisted, and enemy lords in payloads that omit it. Every
//        client computes the same answer, so a given lord looks the same
//        to everyone — but the answer SHIFTS if a pool's length changes,
//        which is exactly why the stored roll is the source of truth.
//
//  Render sites must therefore read `lord.portrait || pickLordPortrait(…)`,
//  never the other way round.
//
//  Folder convention: assets/lord/{race_folder}/{class}/
//  Race folder mapping:
//    human    → humans
//    orc      → orcs
//    high_elf → high_elves
//    dark_elf → dark_elves
//    dwarf    → dwarfs
// =============================================

var LORD_PORTRAIT_POOLS = {
  human: {
    warrior: [
      'assets/lord/humans/warrior/warrior1.jpg',
      'assets/lord/humans/warrior/warrior2.jpg',
      'assets/lord/humans/warrior/warrior3.jpg',
      'assets/lord/humans/warrior/warrior4.jpg',
      'assets/lord/humans/warrior/warrior5.jpg',
    ],
    mage: [
      'assets/lord/humans/mage/mage1.jpg',
      'assets/lord/humans/mage/mage2.jpg',
      'assets/lord/humans/mage/mage3.jpg',
    ],
    dark_lord: [
      'assets/lord/darklords/darklord1.jpg',
      'assets/lord/darklords/darklord2.jpg',
      'assets/lord/darklords/darklord3.jpg',
      'assets/lord/darklords/darklord4.png',
    ],
  },
  orc: {
    warrior: [
      'assets/lord/orcs/warrior/warrior1.jpg',
      'assets/lord/orcs/warrior/warrior2.jpg',
      'assets/lord/orcs/warrior/warrior3.jpg',
      'assets/lord/orcs/warrior/warrior4.jpg',
      'assets/lord/orcs/warrior/warrior5.jpg',
    ],
    mage: [
      'assets/lord/orcs/mage/mage1.jpg',
      'assets/lord/orcs/mage/mage2.jpg',
    ],
    dark_lord: [
      'assets/lord/darklords/darklord1.jpg',
      'assets/lord/darklords/darklord2.jpg',
      'assets/lord/darklords/darklord3.jpg',
      'assets/lord/darklords/darklord4.png',
    ],
  },
  high_elf: {
    warrior: [
      'assets/lord/high_elves/warrior/warrior1.jpg',
      'assets/lord/high_elves/warrior/warrior2.jpg',
      'assets/lord/high_elves/warrior/warrior3.jpg',
      'assets/lord/high_elves/warrior/warrior4.jpg',
      'assets/lord/high_elves/warrior/warrior5.jpg',
    ],
    dark_lord: [
      'assets/lord/darklords/darklord1.jpg',
      'assets/lord/darklords/darklord2.jpg',
      'assets/lord/darklords/darklord3.jpg',
      'assets/lord/darklords/darklord4.png',
    ],
  },
  dark_elf: {
    warrior: [
      'assets/lord/dark_elves/warrior/warrior1.jpg',
      'assets/lord/dark_elves/warrior/warrior2.jpg',
      'assets/lord/dark_elves/warrior/warrior3.jpg',
      'assets/lord/dark_elves/warrior/warrior4.jpg',
    ],
    mage: [
      'assets/lord/dark_elves/mage/mage1.jpg',
      'assets/lord/dark_elves/mage/mage2.jpg',
      'assets/lord/dark_elves/mage/mage3.jpg',
      'assets/lord/dark_elves/mage/mage4.webp',
    ],
    rogue: [
      'assets/lord/dark_elves/rogue/rogue1.jpg',
      'assets/lord/dark_elves/rogue/rogue2.jpg',
      'assets/lord/dark_elves/rogue/rogue3.jpg',
    ],
    dark_lord: [
      'assets/lord/darklords/darklord1.jpg',
      'assets/lord/darklords/darklord2.jpg',
      'assets/lord/darklords/darklord3.jpg',
      'assets/lord/darklords/darklord4.png',
    ],
  },
  dwarf: {
    warrior: [
      'assets/lord/dwarfs/warrior/warrior1.jpg',
      'assets/lord/dwarfs/warrior/warrior2.jpg',
      'assets/lord/dwarfs/warrior/warrior3.jpg',
      'assets/lord/dwarfs/warrior/warrior4.jpg',
    ],
    mage: [
      'assets/lord/dwarfs/mage/mage1.jpg',
    ],
    rogue: [
      'assets/lord/dwarfs/rogue/rogue1.jpg',
    ],
    dark_lord: [
      'assets/lord/dwarfs/darklord/darklord1.jpg',
    ],
  },
};

// Classes with no dedicated art borrow another class's pool for the same
// race, closest-fit first, so a portrait always renders. No race has priest
// art at all; no race but dark_elf/dwarf has rogue art.
var LORD_PORTRAIT_CLASS_FALLBACK = {
  priest: ['mage', 'warrior'],
  rogue:  ['warrior', 'mage'],
  mage:   ['warrior'],
  warrior: ['mage'],
  dark_lord: ['warrior'],
};

function lordPortraitPool(raceId, classId) {
  const racePool = LORD_PORTRAIT_POOLS[raceId];
  if (!racePool) return null;
  const chain = [classId].concat(LORD_PORTRAIT_CLASS_FALLBACK[classId] || []);
  for (const key of chain) {
    const pool = racePool[key];
    if (pool && pool.length) return pool;
  }
  const any = Object.values(racePool).find(p => p && p.length);
  return any || null;
}

// TRUE random — creation only. See the header note.
function rollLordPortrait(raceId, classId) {
  const pool = lordPortraitPool(raceId, classId);
  if (!pool) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

// Deterministic fallback for lords with no stored portrait. See header note.
function pickLordPortrait(raceId, classId, lordId) {
  const pool = lordPortraitPool(raceId, classId);
  if (!pool) return null;
  if (!lordId) return pool[Math.floor(Math.random() * pool.length)];
  const hash = String(lordId).split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  return pool[hash % pool.length];
}
