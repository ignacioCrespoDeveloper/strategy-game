// =============================================
//  lord-portraits.js — Portrait image pools per race + class
//
//  Add new images by adding paths to the arrays below.
//  pickLordPortrait() is called at lord creation to assign
//  a random portrait that stays with the lord permanently.
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

function pickLordPortrait(raceId, classId, lordId) {
  const pool = LORD_PORTRAIT_POOLS[raceId]?.[classId];
  if (!pool || pool.length === 0) return null;
  if (lordId) {
    const hash = String(lordId).split('').reduce((a, c) => a + c.charCodeAt(0), 0);
    return pool[hash % pool.length];
  }
  return pool[Math.floor(Math.random() * pool.length)];
}
