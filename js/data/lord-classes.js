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

// `recruitable: false` HIDES a class from the recruit modal and makes the
// server reject it — it does NOT delete the class. Existing lords of that
// class keep working exactly as before: every read site is
// `LORD_CLASSES[lord.classId]`, which still resolves, so their modifiers,
// passive, icon, colour and portraits are all untouched. Only the "can I
// make a NEW one" door closes.
//
// That distinction is the whole point. Removing the entries instead would
// orphan any lord already carrying the id — `cls?.modifiers` would read
// undefined and the lord would silently lose its class stat bonuses, and the
// classId is persisted in Supabase so there is no taking it back.
//
// Absent `recruitable` means true; only opt-OUT is written, so adding a class
// needs no new field. Read through isClassRecruitable/getRecruitableClasses,
// never by testing the flag inline, so client and server agree by construction.
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
      // "Higher chance of valuable discoveries" was removed from this text
      // 2026-07-30: it was backed by discoveryWeightBonus, which no code has
      // ever read. Find QUALITY is decided by Expedition Rating (army
      // composition), not by the lord — see discovery-roll.js RECRUIT_TIERS.
      // searchDurationMult IS live (server/actions/lord-action.js).
      description: 'Search Area takes half the time.',
      effects: {
        searchDurationMult: 0.5,
      },
    },
  },

  // HIDDEN FROM RECRUITMENT (Nacho, 2026-07-30) — see `recruitable` note above
  // LORD_CLASSES. Faithkeeper is unimplemented ("Future: healing, diplomacy"),
  // so a Priest is a Warrior with a worse stat line and a promise.
  priest: {
    id:          'priest',
    recruitable: false,
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

  // HIDDEN FROM RECRUITMENT (Nacho, 2026-07-30) — same reason as the Priest:
  // Dark Presence is unimplemented, so the class is a stat spread with no
  // identity of its own yet.
  dark_lord: {
    id:          'dark_lord',
    recruitable: false,
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

// Can a NEW lord be created as this class? Unknown ids are not recruitable —
// this doubles as the existence check, so the server needs one call, not two.
function isClassRecruitable(classId) {
  if (!classId || !Object.prototype.hasOwnProperty.call(LORD_CLASSES, classId)) return false;
  return LORD_CLASSES[classId].recruitable !== false;
}

// The classes the recruit modal offers. Order follows LORD_CLASSES.
function getRecruitableClasses() {
  return Object.values(LORD_CLASSES).filter(c => c.recruitable !== false);
}

// =============================================
//  TALENT_POOL — Cross-class talents unlocked at level 5.
//
//  Lords choose exactly one talent, permanently.
//  Combat talents add traits/stats to the lord's BattleUnit.
//  Strategic talents apply passive effects via getTalentEffects().
//
//  EVERY KEY BELOW HAS A LIVE CONSUMER, and the authoritative one is the
//  SERVER path — the client copies exist only to preview the same number.
//  A talent is chosen ONCE and PERMANENTLY, so a key with no consumer is not
//  merely incomplete, it is a trap the player can never undo. Audited
//  2026-07-30, which retired two talents for exactly that reason:
//    · commander (commandCapacityBonus) — described "+2 unit slots", a system
//      retired when army size became PWR-bounded. Zero consumers, ever since
//      lord.js's callerless getCommandCapacity was deleted.
//    · scholar (xpMultiplier) — described "all XP from quests, battles and
//      actions +20%", but only ever multiplied the flat 8 XP an expedition
//      pays for showing up: not find XP, not ambush XP, not battle XP. Worth
//      about +1.6 XP on a Long expedition against the ~4,950 XP a lord needs
//      to reach level 10, i.e. ~1 expedition saved out of ~52.
//  DO NOT re-add a talent whose effect key has no reader. Wire the effect
//  first, then ship the talent.
//
//  effects keys used by the engine:
//    searchDurationMult    — multiplier on quest duration (server/actions/lord-action.js; preview in lord.js)
//    goldDiscoveryBonus    — extra weight on gold-type discoveries (server/tick/catch-up.js → DiscoveryRoll.rollDef)
//    armyPowerCapBonus     — extra PWR cap (server/actions/recruit.js + army-transfer.js + catch-up.js; preview in lord.js)
//    recruitTimeMult       — multiplier on unit training duration (server/actions/recruit.js)
//    attackerMoraleBonus   — own-side morale at battle start (battle-engine.js PvE, combat-resolver.js PvP)
//    defenderMoraleMalus   — enemy morale at battle start (battle-engine.js PvE, combat-resolver.js PvP)
//    battleUnitTraits      — traits injected into the lord BattleUnit (battle-engine.js PvE, combat-resolver.js PvP)
//    battleUnitAttackBonus — flat attack added to lord BattleUnit (battle-engine.js PvE, combat-resolver.js PvP)
//    battleUnitDefenseBonus— flat defense added to lord BattleUnit (battle-engine.js PvE, combat-resolver.js PvP)
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

  // `commander` lived here until 2026-07-30 — removed, see the audit note in
  // this block's header. If a "large armies" strategic talent is wanted again,
  // it needs an effect that is NOT +armyPowerCapBonus: strategist already owns
  // that key, and duplicating it would make one of the two strictly dominant.

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

  // `scholar` lived here until 2026-07-30 — removed, see the audit note in this
  // block's header. Bringing an XP talent back means multiplying the xp entries
  // rollRewards returns AND the ambush/PvP xpEarned, not just the flat
  // per-expedition XP, or it will under-deliver by ~50× all over again.

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
//  RACE POOLS (design call 2026-07-30, Nacho). Mounts used to be one
//  shared pool of six with a single cosmetic race variant (Dark Elf
//  Black Dragon). They are now FIVE EXCLUSIVE POOLS OF FOUR — a lord can
//  only ever equip a mount belonging to its own race, enforced in
//  server/actions/lord-mounts.js and filtered in the Mount tab. A player
//  therefore never sees another race's mounts, which is why icons and
//  effect shapes are deliberately reused across races: no two of them are
//  ever on screen together.
//
//  THE LADDER — four mounts per race across the old three level gates,
//  so the existing 5/8/10 pacing and price anchors are untouched:
//
//    slot    lv  cost   budget   what it is
//    ────────────────────────────────────────────────────────────────
//    scout    5   60k   3 pts + quest_bonus +15%    the ranging beast
//    field    5   60k   4 pts                       the plain warmount
//    war      8  150k   7 pts + raid_bonus  +35%    the mid-tier beast
//    apex    10  350k   10 pts + both + cap +200    the capstone
//
//  `scout` and `field` are SIDEGRADES: same level, same price, and the
//  scout trades exactly one stat point for its economic bonus. That is the
//  whole choice at level 5 — a lord who quests wants the scout, a lord who
//  fights wants the field mount — and it is a shape decision, not a power
//  decision. Across slots power genuinely climbs, which is what the level
//  gate is paying for.
//
//  WHY EVERY SLOT BUT `field` CARRIES AN INCOME KEY (2026-07-30): the
//  projection's PAYBACK table prices each mount in days-to-repay, and a
//  purchase that can never repay is a trap rather than a decision. `field`
//  is the deliberate exception — it is priced against COMBAT value, which
//  that model does not price, so it reports as STATS rather than as a
//  failure. Not everything must be an ROI play; the rule is that anything
//  CLAIMING to be economic has to survive the arithmetic.
//
//  EFFECT KEYS. Most are flat stat pads added straight onto the lord's
//  effective stats (LordService.getEffectiveStats), using the same keys
//  as LORD_BASE_STATS. Four are not, and are read through helpers instead:
//
//    expeditionRatingMult → multiplies Expedition Rating, which gates
//        find quality AND recruit quality (DiscoveryRoll.RECRUIT_TIERS).
//        ⚠ Bands are GATES, not a curve, so this is worth nothing unless it
//        CROSSES one — and it is dead at endgame (see MOUNT_SCOUT_ER_MULT).
//        It survives as a mid-game kicker; `quest_bonus` is the scout's
//        real product because it scales instead of saturating.
//    quest_bonus  → % extra gold + resources from expedition finds.
//    raid_bonus   → % extra gold + resources from the raiding stance.
//        Both were BLESSING-ONLY keys until the reprice. They are summed
//        with the blessing's in server/tick/catch-up.js (and in the raid
//        preview in js/ui/lord-screen.js) — a mount declaring one without
//        that wiring would be silently inert.
//    armyPowerCapBonus → raises the lord's army PWR cap (200 + lv×80).
//        ALREADY an established key: the talent pool has used it for
//        months and all four cap functions read it. +200 on a level-10
//        lord is 1000 → 1200, i.e. +20% army.
//
//  Still no traits, no abilities and no battle hooks — the 2026-07-29
//  call that mounts stay legible holds. Both new keys are economy//
//  progression dials read outside the battle engine.
//
//  race        → owning race id; a mount is equippable by that race ONLY.
//  slot        → rung on the ladder above. Drives resolveMountId's
//                migration of pre-race-pool mounts, so every mount MUST
//                carry one and every race MUST have all four.
//  unlockLevel → minimum lord level; enforced server-side in
//                server/actions/lord-mounts.js, shown as a locked card
//                in the Mount tab so the whole ladder is visible early.
//  cost        → gold per equip, charged again on every swap, never
//                refunded. Kept explicit per mount (data stays data)
//                even though it is a function of `slot`.
//  image       → mount artwork, shown instead of `icon` when the file
//                loads. Only five mounts have art (the pre-race pool
//                pieces, re-pointed at the race that inherited them);
//                the other fifteen have no `image` at all and render
//                their sprite glyph, exactly as the Griffon has done
//                since 2026-07-29. That is the intended state until art
//                arrives, not a broken path — _mountVisual already
//                falls back. Filenames follow the art, not the mount id
//                (boar.webp, bear.webp), so keep these paths literal.
// =============================================

var MOUNT_MIN_LEVEL = 5;

// Prices are unchanged from the pre-race-pool ladder except that the two
// level-5 mounts are now the SAME price. They were 300k/350k, which quietly
// made the sidegrade pair a power ranking; at equal cost the pick is what it
// is supposed to be — questing or fighting.
//
// REPRICED ~5x DOWN on 2026-07-30 (ECONOMY-REBALANCE-PLAN.md Phase 2a, Nacho's
// call). The old 300k/300k/800k/1.5M ladder was set against an assumed ~124k
// gold/day this file used to state as fact, and it made an apex mount cost
// 1.32x every lord AND every city in the game combined — for +200 army cap,
// against a new lord's +1000 plus an income stream. Mounts are a mid-game
// ACCESSORY, not the endgame gold sink: a terminal purchase cannot hold an
// endgame no matter what it costs (that job belongs to blessings, the only
// recurring sink).
//
// Never restate an income figure here. There is exactly one source —
// `node scripts/economy-projection.js` — and it prints the live curve plus a
// PAYBACK verdict per mount. Each slot is now sized for that table:
//
//   scout  60k   quest_bonus  +15%   ~37 days to repay
//   field  60k   stats only          STATS — priced against combat, not income
//   war   150k   raid_bonus   +35%   ~37 days
//   apex  350k   both + cap  +200    ~52 days (also carries the best stats)
//
// See ECONOMY-AUDIT.md §B for the measurements that motivated this.
// ⚠ EVERY MOUNT'S OWN `cost` MUST EQUAL ITS SLOT'S COST HERE. The catalog keeps
// explicit per-mount numbers (data stays data), so these 21 literals can drift;
// test-economy.js asserts they agree.
var MOUNT_SLOTS = {
  scout: { id: 'scout', label: 'Outrider', unlockLevel: 5,  cost: 60000  },
  field: { id: 'field', label: 'Warmount', unlockLevel: 5,  cost: 60000  },
  war:   { id: 'war',   label: 'Warbeast', unlockLevel: 8,  cost: 150000 },
  apex:  { id: 'apex',  label: 'Apex',     unlockLevel: 10, cost: 350000 },
};

// How much a scout mount multiplies Expedition Rating by. One dial, five
// mounts — the races differ in stat shape, never in how good their outrider
// is at finding things.
//
// ⚠ MEASURED DEAD AT ENDGAME (2026-07-30). ER bands are gates, not a curve, so
// a multiplier is worth exactly nothing unless it CROSSES one. A L10 lord with
// a filled army sits around ER 1450 against a Legendary threshold of 800, so
// x1.15 moves legendary -> legendary and buys zero. The projection's PAYBACK
// section prints the band on both sides so this stays visible. The bonus only
// pays in the mid-game window where you are near a boundary — which is exactly
// when a 300,000 gold mount is unaffordable. Fixing this is Phase 2a: either
// the multiplier gets big enough to cross a band from the tier below, or the
// scout slot trades it for an effect that scales.
var MOUNT_SCOUT_ER_MULT = 1.15;

// Flat army PWR cap granted by every apex mount. Same reasoning: the apex
// pick is a stat-shape choice, so the headline bonus is identical across races.
var MOUNT_APEX_POWER_CAP = 200;

// Fraction of a mount's price returned when it is SOLD back
// (server/actions/lord-mount-sell.js, POST /api/lord/mount-sell).
//
// Lives here, not in the endpoint, so the Sell button can show the exact gold
// it will pay without hand-mirroring the maths — the same rule economy-core.js
// and discovery-roll.js exist to enforce. Client and server both call
// mountSellValue(); neither computes `cost * fraction` on its own.
//
// Deliberately the same 0.6 as DISBAND_REFUND_MAX in army-disband.js, for the
// reason that constant was cut from 0.9 on 2026-07-30: at a high refund the
// sink stops being a sink. Mounts are THE endgame gold sink (see the pricing
// note above MOUNT_POOL), so churning them has to cost something real.
//
// At 0.6 a same-slot swap nets 120k of a 300k mount and 600k of a 1.5M one —
// enough that changing your mind is a real decision, cheap enough that it is
// not a punishment. Raising this toward 1.0 makes mount choice free and
// removes the reason the ladder is a goal at all.
var MOUNT_SELL_REFUND = 0.6;

// Gold returned for selling `mount`. Floored, so the refund can never round
// up above the intended fraction.
function mountSellValue(mount) {
  return Math.floor((mount?.cost || 0) * MOUNT_SELL_REFUND);
}

// PRICES REBUILT 2026-07-30 — mounts are now THE endgame gold sink.
// They were 400–2,800, i.e. pocket change: the whole ladder for every lord cost
// less than a day of one lord's raid income, so gold had nothing to buy once
// lords/cities/armies were paid for and the late economy flattened out. A mount
// is a permanent, visible, per-lord capstone with no cap of its own, which makes
// it the right home for late gold.
//
// Re-priced 2026-07-30 (Nacho): the tier-3 pair was 4M/5M and read as too
// expensive in play. Both dropped to a flat 1.5M, and tier 2 came down with
// them — at 1.5M/1.7M the level-8 mounts would have cost the SAME OR MORE than
// a level-10 Dragon, inverting the ladder.
//
// Anchored on ~124k gold/day (the live tunings in js/data/tuning.js, measured
// with scripts/economy-projection.js — re-check after changing any dial):
//   Lv5  warhorse 300k / boar 350k    ~2.5-3 days  <- entry mount, a real goal
//   Lv8  chariot  700k / bear 800k    ~6-6.5 days
//   Lv10 griffon  1.5M / dragon 1.5M  ~12 days
//
// NOTE the tier-3 pair is now the SAME price on purpose: at the top of the
// ladder the choice is Griffon (attack/speed) vs Dragon (attack/defence), not
// "can I afford the better one". If you want the Dragon to read as the apex
// again, give it a premium — but keep it above the tier-2 pair.
//
// One per tier is ~2.5M per lord; kitting three main lords is ~7.5M, roughly
// two months of income. Still a long tail, just no longer a year.
//
// Note lord-mounts.js charges full price on every swap to a DIFFERENT mount and
// never refunds, so at these prices the Griffon-or-Dragon pick is effectively
// permanent. Keep the confirm dialog honest about that.
var MOUNT_POOL = {
  // ═══ ORCS ════════════════════════════════════════════
  orc_wolf: {
    id:          'orc_wolf',
    name:        'Wolf',
    race:        'orc',
    slot:        'scout',
    icon:        gi('wolf-head'),
    color:       '#8a8f7a',
    description: 'A lean warg run down and beaten into service. Ranges miles ahead of the mob and comes back knowing where the food is.',
    unlockLevel: 5,
    cost:        60000,
    effects: {
      attack: 1,
      speed:  2,
      expeditionRatingMult: 1.15,
      quest_bonus:          0.15,
    },
  },

  // Was the Dire Wolf until 2026-07-29, renamed to match the art that landed
  // for this slot; kept its id again in the 2026-07-30 race split because it is
  // persisted on lords in Supabase and it was already the orc-flavoured mount.
  // Renaming it would orphan every equipped War Boar in the game.
  dire_wolf: {
    id:          'dire_wolf',
    name:        'War Boar',
    race:        'orc',
    slot:        'field',
    icon:        gi('boar-tusks'),
    image:       'assets/mounts/boar.webp',
    color:       '#6e8494',
    description: 'A tusked boar in riveted plate, bred to charge and never turn. Slower to start than a horse, impossible to stop once it is running.',
    unlockLevel: 5,
    cost:        60000,
    effects: {
      attack: 3,
      speed:  1,
    },
  },

  orc_spider: {
    id:          'orc_spider',
    name:        'Giant Spider',
    race:        'orc',
    slot:        'war',
    icon:        gi('hanging-spider'),
    color:       '#6a7a4a',
    description: 'A forest spider the size of a cart, ridden by goblins mad enough to try. Walks up cliffs and over walls as if they were flat ground.',
    unlockLevel: 8,
    cost:        150000,
    effects: {
      raid_bonus: 0.35,
      attack:  3,
      defense: 2,
      speed:   2,
    },
  },

  orc_manticore: {
    id:          'orc_manticore',
    name:        'Manticore',
    race:        'orc',
    slot:        'apex',
    icon:        gi('hydra'),
    color:       '#a03c30',
    description: 'A starving manticore kept just hungry enough to obey. The mob follows it because nothing that walks behind it dares to run.',
    unlockLevel: 10,
    cost:        350000,
    effects: {
      attack:  5,
      defense: 2,
      speed:   3,
      armyPowerCapBonus: 200,
      quest_bonus:       0.25,
      raid_bonus:        0.35,
    },
  },

  // ═══ DWARFS ══════════════════════════════════════════
  dwarf_ram: {
    id:          'dwarf_ram',
    name:        'Battle Ram',
    race:        'dwarf',
    slot:        'scout',
    icon:        gi('deer'),
    color:       '#9a8460',
    description: 'A great horned ram off the high crags, surefooted where no horse would stand. Finds the pass the maps forgot.',
    unlockLevel: 5,
    cost:        60000,
    effects: {
      defense: 1,
      speed:   2,
      expeditionRatingMult: 1.15,
      quest_bonus:          0.15,
    },
  },

  // Replaced the old shared `war_bear` (which sat at level 8). New id on
  // purpose: the bear moved DOWN a rung in the race split, so reusing the id
  // would have silently demoted every dwarf already holding one. `war_bear`
  // is retired into LEGACY_MOUNT_SLOTS and migrates to the Steam Tank instead,
  // which is the mount that actually kept its level and price.
  dwarf_bear: {
    id:          'dwarf_bear',
    name:        'War Bear',
    race:        'dwarf',
    slot:        'field',
    icon:        gi('bison'),
    image:       'assets/mounts/bear.webp',
    color:       '#8a6a4a',
    description: 'A mountain bear broken to the saddle and armoured at the shoulders. Absorbs a charge and answers it.',
    unlockLevel: 5,
    cost:        60000,
    effects: {
      attack:  2,
      defense: 2,
    },
  },

  dwarf_steam_tank: {
    id:          'dwarf_steam_tank',
    name:        'Steam Tank',
    race:        'dwarf',
    slot:        'war',
    icon:        gi('gears'),
    color:       '#7f8a92',
    description: 'Boilerplate, rivets and a furnace that never goes out. It does not charge so much as arrive, slowly, through whatever is in the way.',
    unlockLevel: 8,
    cost:        150000,
    effects: {
      raid_bonus: 0.35,
      attack:  3,
      defense: 4,
    },
  },

  dwarf_golem: {
    id:          'dwarf_golem',
    name:        'Stone Golem',
    race:        'dwarf',
    slot:        'apex',
    icon:        gi('moai'),
    color:       '#8c8c86',
    description: 'A rune-cut colossus woken from the deep holds. It has stood through three sieges and remembers none of them.',
    unlockLevel: 10,
    cost:        350000,
    effects: {
      attack:  4,
      defense: 6,
      armyPowerCapBonus: 200,
      quest_bonus:       0.25,
      raid_bonus:        0.35,
    },
  },

  // ═══ HUMANS ══════════════════════════════════════════
  human_lion: {
    id:          'human_lion',
    name:        'War Lion',
    race:        'human',
    slot:        'scout',
    icon:        gi('claw-slashes'),
    color:       '#c9a24a',
    description: 'A hunting lion from the royal menagerie, loosed ahead of the column. Drives everything living out of the brush and into the open.',
    unlockLevel: 5,
    cost:        60000,
    effects: {
      attack: 2,
      speed:  1,
      expeditionRatingMult: 1.15,
      quest_bonus:          0.15,
    },
  },

  // Kept its id, stats, level AND price through the race split — the Warhorse
  // was always the balanced human mount, so human lords holding one see no
  // change at all. Every other legacy id migrates; this one simply is the
  // human field mount now.
  warhorse: {
    id:          'warhorse',
    name:        'Warhorse',
    race:        'human',
    slot:        'field',
    icon:        gi('horse-head'),
    image:       'assets/mounts/warhorse.png',
    color:       '#c8933a',
    description: 'A sturdy battle-trained warhorse. Balanced power and mobility for any lord.',
    unlockLevel: 5,
    cost:        60000,
    effects: {
      attack: 2,
      speed:  2,
    },
  },

  human_pegasus: {
    id:          'human_pegasus',
    name:        'Pegasus',
    race:        'human',
    slot:        'war',
    icon:        gi('liberty-wing'),
    color:       '#b8c4d8',
    description: 'A white winged courser out of the mountain herds. Crosses in an hour what an army crosses in a day.',
    unlockLevel: 8,
    cost:        150000,
    effects: {
      raid_bonus: 0.35,
      attack:  3,
      defense: 1,
      speed:   3,
    },
  },

  // Kept its id, stats, level and price through the race split, same as the
  // Warhorse. Still the one mount with no art — glyph fallback is intended.
  griffon: {
    id:          'griffon',
    name:        'Griffon',
    race:        'human',
    slot:        'apex',
    icon:        gi('eagle-emblem'),
    // No `image` on purpose — griffon art hasn't been drawn yet, so the
    // card falls back to the sprite glyph. Add the path when it lands.
    color:       '#30a0b0',
    description: 'A majestic aerial predator, striking from above with deadly talons.',
    unlockLevel: 10,
    cost:        350000,
    effects: {
      attack:  4,
      defense: 2,
      speed:   4,
      armyPowerCapBonus: 200,
      quest_bonus:       0.25,
      raid_bonus:        0.35,
    },
  },

  // ═══ HIGH ELVES ══════════════════════════════════════
  he_steed: {
    id:          'he_steed',
    name:        'Elven Steed',
    race:        'high_elf',
    slot:        'scout',
    icon:        gi('horse-head'),
    color:       '#d8d2bc',
    description: 'An Ellyrian courser that has never worn a bit. Covers ground so quietly that the scouts arrive before the rumour of them.',
    unlockLevel: 5,
    cost:        60000,
    effects: {
      speed: 3,
      expeditionRatingMult: 1.15,
      quest_bonus:          0.15,
    },
  },

  he_white_lion: {
    id:          'he_white_lion',
    name:        'White Lion',
    race:        'high_elf',
    slot:        'field',
    icon:        gi('claw-slashes'),
    color:       '#e2e6ea',
    description: 'A great pale hunting cat of Chrace, bound to a rider who killed one of its kind to earn the right.',
    unlockLevel: 5,
    cost:        60000,
    effects: {
      attack: 3,
      speed:  1,
    },
  },

  he_great_eagle: {
    id:          'he_great_eagle',
    name:        'Great Eagle',
    race:        'high_elf',
    slot:        'war',
    icon:        gi('eagle-emblem'),
    color:       '#9fb6c8',
    description: 'A speaking eagle of the Annulii peaks. It carries an ally, never a master, and only for as long as the cause holds.',
    unlockLevel: 8,
    cost:        150000,
    effects: {
      raid_bonus: 0.35,
      attack:  2,
      defense: 1,
      speed:   4,
    },
  },

  // Kept its id, stats, level and price. It was the shared apex dragon and is
  // now the High Elf one; Dark Elf lords who held it migrate to the Black
  // Dragon below, which used to be a cosmetic raceVariant of this entry.
  dragon: {
    id:          'dragon',
    name:        'Dragon',
    race:        'high_elf',
    slot:        'apex',
    icon:        gi('dragon-head'),
    image:       'assets/mounts/dragon.webp',
    color:       '#c04030',
    description: 'An ancient wyrm that suffers a rider only because it chooses to. Armies break at the sight of it.',
    unlockLevel: 10,
    cost:        350000,
    effects: {
      attack:  5,
      defense: 4,
      speed:   1,
      armyPowerCapBonus: 200,
      quest_bonus:       0.25,
      raid_bonus:        0.35,
    },
  },

  // ═══ DARK ELVES ══════════════════════════════════════
  // The Cold One, not the Dark Steed, carries the Expedition Rating bonus —
  // Nacho's explicit call. Cold One knights ARE the Dark Elf raiding arm, so
  // the slower reptile is the one that goes out looking for things and the
  // steed is the plain warmount. This is the one race where the scout slot
  // isn't the fastest animal in the pool.
  de_cold_one: {
    id:          'de_cold_one',
    name:        'Cold One',
    race:        'dark_elf',
    slot:        'scout',
    icon:        gi('lizardman'),
    image:       'assets/mounts/coldone.webp',
    color:       '#6f7f6a',
    description: 'A blind saurian that hunts by scent and cannot be startled. Its riders numb their legs to endure it and count the loss as worthwhile.',
    unlockLevel: 5,
    cost:        60000,
    effects: {
      attack:  1,
      defense: 1,
      speed:   1,
      expeditionRatingMult: 1.15,
      quest_bonus:          0.15,
    },
  },

  de_dark_steed: {
    id:          'de_dark_steed',
    name:        'Dark Steed',
    race:        'dark_elf',
    slot:        'field',
    icon:        gi('horse-head'),
    color:       '#7a6a8a',
    description: 'A black Naggarothi courser fed on things horses do not eat. Fast, vicious, and entirely willing to bite the enemy itself.',
    unlockLevel: 5,
    cost:        60000,
    effects: {
      attack: 2,
      speed:  2,
    },
  },

  de_dark_pegasus: {
    id:          'de_dark_pegasus',
    name:        'Dark Pegasus',
    race:        'dark_elf',
    slot:        'war',
    icon:        gi('liberty-wing'),
    color:       '#8a5fa8',
    description: 'A winged nightmare with a hide like wet slate. It stoops out of cloud cover and is gone before the line has turned.',
    unlockLevel: 8,
    cost:        150000,
    effects: {
      raid_bonus: 0.35,
      attack: 4,
      speed:  3,
    },
  },

  // Was a cosmetic raceVariant of `dragon` until the 2026-07-30 race split.
  // It is a real mount now with its own id, which is what lets it differ in
  // stats from the High Elf Dragon rather than only in name and art.
  de_black_dragon: {
    id:          'de_black_dragon',
    name:        'Black Dragon',
    race:        'dark_elf',
    slot:        'apex',
    icon:        gi('dragon-spiral'),
    image:       'assets/mounts/blackdragon.webp',
    color:       '#8030a0',
    description: 'A Black Dragon dragged from the caves beneath Naggaroth and broken to the saddle. It hates its rider only slightly less than everything else.',
    unlockLevel: 10,
    cost:        350000,
    effects: {
      attack:  5,
      defense: 3,
      speed:   2,
      armyPowerCapBonus: 200,
      quest_bonus:       0.25,
      raid_bonus:        0.35,
    },
  },
};

// Mount ids that existed before the 2026-07-30 race split and are no longer in
// MOUNT_POOL, mapped to the slot they occupied. resolveMountId uses this to
// hand a lord the equivalent mount of its OWN race, free of charge, so nobody
// loses the 300k–1.5M they already paid.
//
// Only ids that are truly gone belong here. `warhorse`, `dire_wolf`, `griffon`
// and `dragon` all survived into a race pool and resolve through MOUNT_POOL
// itself — a lord of the WRONG race holding one still migrates correctly,
// because resolveMountId reads `.slot` off the pool entry first.
var LEGACY_MOUNT_SLOTS = {
  war_chariot: 'war',   // no race in the new pools rides a chariot
  war_bear:    'war',   // the bear moved down to `field` as dwarf_bear
};

// ── Mount resolution ─────────────────────────────────────────
// `_mountHas` is own-property-only everywhere below on purpose: a plain
// lookup of `mountId: 'constructor'` returns Object.prototype's member,
// which is truthy and would sail past every guard in this file.
function _mountHas(obj, key) {
  return !!obj && Object.prototype.hasOwnProperty.call(obj, key);
}

// THE migration point for the 2026-07-30 race split. Maps whatever is stored
// on `lord.mountId` onto a mount that lord's race can actually ride:
//
//   · already the right race            → returned unchanged
//   · another race's mount, or a retired id → the SAME SLOT of the lord's race
//   · unknown/garbage, or no race given  → null (reads as "no mount")
//
// Doing this at read time rather than as a Supabase migration means there is
// no backfill to run and no window where the two disagree — a Dwarf holding a
// `war_chariot` is riding a Steam Tank the next time anything asks, and it
// cost them nothing. Slots are equal-priced within a level, so a migrated
// lord always lands on a mount worth what they originally paid.
//
// Pure and side-effect free: nothing here writes lord.mountId. The stored id
// is only rewritten when the player equips something (lord-mounts.js), so a
// lord that somehow changes race resolves correctly rather than staying stuck.
function resolveMountId(mountId, raceId) {
  if (!mountId) return null;
  const known = _mountHas(MOUNT_POOL, mountId) ? MOUNT_POOL[mountId] : null;
  if (!raceId) return known ? mountId : null;
  if (known && known.race === raceId) return mountId;

  const slot = known ? known.slot
             : _mountHas(LEGACY_MOUNT_SLOTS, mountId) ? LEGACY_MOUNT_SLOTS[mountId]
             : null;
  if (!slot) return null;

  const match = Object.values(MOUNT_POOL).find(m => m.race === raceId && m.slot === slot);
  return match ? match.id : null;
}

// Resolves a mount def for display. Same signature the pre-race-pool code
// used, so every existing call site still reads correctly — it just resolves
// through race pools now instead of applying a cosmetic variant.
function getMountForRace(mountId, raceId) {
  const id = resolveMountId(mountId, raceId);
  return id ? MOUNT_POOL[id] : null;
}

// The mount a lord is actually riding, or null. Prefer this over reading
// MOUNT_POOL[lord.mountId] directly — that skips the race migration and will
// read `undefined` effects for any lord still holding a pre-split id.
function getLordMount(lord) {
  return lord ? getMountForRace(lord.mountId, lord.race) : null;
}

function getLordMountEffects(lord) {
  return getLordMount(lord)?.effects || {};
}

// The four mounts of one race, ordered up the ladder. Feeds the Mount tab —
// a player only ever sees their own race's pool.
function getMountsForRace(raceId) {
  const order = ['scout', 'field', 'war', 'apex'];
  return Object.values(MOUNT_POOL)
    .filter(m => m.race === raceId)
    .sort((a, b) => order.indexOf(a.slot) - order.indexOf(b.slot));
}

// =============================================
//  Lord capture — fixed, non-negotiable gold ransom to free a captured lord.
//  Scales with level so a high-level lord costs meaningfully more to free
//  than a fresh one. Used both client-side (price display before paying) and
//  server-side (server/actions/lord-ransom.js validates/charges this exact
//  number) — loaded server-side via server/engine-loader.js.
// =============================================
// QUADRATIC since 2026-07-30 (ECONOMY-REBALANCE-PLAN.md Phase 2b). The old
// 300 + 150×level paid out 1,800 gold to free a level-10 lord — about fifteen
// MINUTES of endgame gold income, against the ~40,000 that lord's army and the
// mount it is wearing represent. Capture had no economic teeth at all.
//
// Quadratic because a high-level lord is a far bigger investment than a linear
// term admits (XP to L10 is ~4,950, plus talents, plus a mount), while a fresh
// lord should stay trivially cheap to bail out:
//   L1 700 · L3 3,900 · L5 10,300 · L8 25,900 · L10 40,300
// At the endgame curve L10 is ~6 hours of gold income. The gold is a TRANSFER
// to the captor (server/actions/lord-ransom.js), not a sink, so this doubles as
// the payout that makes taking prisoners worth doing.
function lordRansomCost(level) {
  const lvl = Math.max(1, level || 1);
  return 300 + 400 * lvl * lvl;
}
