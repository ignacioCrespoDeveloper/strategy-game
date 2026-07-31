// =============================================
//  tuning.js — THE ECONOMY TUNING DIALS
//
//  ★ THIS IS THE FILE TO EDIT WHEN THE GAME FEELS TOO FAST OR TOO SLOW. ★
//
//  Every value is a plain MULTIPLIER on one income or time channel. 1.0 is
//  "as designed"; 2.0 is double; 0.5 is half. Nothing here changes game
//  RULES — only how fast the taps run. Edit, reload, play. No code changes,
//  no server restart beyond the usual one.
//
//  ── THE DIALS ────────────────────────────────────────────────────
//    buildingProduction  Economy from buildings  (the 3 resource buildings)
//    populationGold      Gold from population    (city tax income)
//    raidGold            Gold from raiding
//    raidResources       Resources from raiding
//    questGold           Gold from questing      (expeditions + ambush loot)
//    questResources      Resources from questing (expeditions + ambush loot)
//    travelTime          Travel time             (>1 = SLOWER, <1 = faster)
//
//  ── HOW TO USE IT ────────────────────────────────────────────────
//  Change one dial at a time, then run:
//
//      node scripts/economy-projection.js
//
//  That prints how many days a daily-active player needs to buy everything,
//  and flags anything off target. The design goal is CORE progression
//  complete around day 14–28, with mounts and the apex building tier still
//  out of reach. If a dial pushes those verdicts out of range, you have
//  gone too far — the projection will say so before a player ever feels it.
//
//  ── WORKED EXAMPLES ──────────────────────────────────────────────
//    "resources pile up too fast"      → questResources: 0.5
//    "cities feel pointless vs lords"  → buildingProduction: 2.0
//    "raiding is the only thing worth
//     doing"                           → raidGold: 0.6, raidResources: 0.6
//    "gold is tight, resources aren't" → populationGold: 1.5
//    "the map feels too small"         → travelTime: 2.0
//    "I want a fast test server"       → set everything to 5, travelTime 0.2
//
//  ── WHAT IS *NOT* HERE (on purpose) ──────────────────────────────
//  Costs. Prices live with the things they price — building costs in
//  buildings.js, unit gold in economy-core.js (GOLD_PER_PWR), mounts in
//  lord-classes.js, blessings in blessings.js. Mixing "how much you earn"
//  with "how much things cost" in one file makes both harder to reason
//  about; these dials answer only the first question.
//
//  Loaded before economy-core.js and discovery-roll.js in BOTH index.html
//  and server/engine-loader.js — client and server read the same numbers.
// =============================================

var TUNING = {

  // ── INCOME ──────────────────────────────────────────────────────

  // The 3 resource buildings (Lumber Mill / Stone Quarry / Farm).
  // Applied in EconomyCore.getRates, so it scales the whole production
  // curve at every level and shows correctly in the HUD and city view.
  buildingProduction: 0.5,

  // City tax income (pop × 0.004 × happiness, +8%/marketplace level).
  // Applied in EconomyCore.getGoldRate.
  populationGold: 0.5,

  // The raiding stance. Base rate is 40 + 45×lordLevel gold/hour and
  // 60 + 55×lordLevel of EACH resource/hour, before these multipliers.
  // Applied in EconomyCore.getRaidHourlyRewards.
  raidGold:      1.0,
  raidResources: 1.0,

  // Expeditions ("Search Area") — both the loot from finds AND the loot
  // from the ambushes expeditions run into, since both are payouts of the
  // same activity. Applied in DiscoveryRoll.rollRewards and in the ambush
  // loot block of server/tick/catch-up.js.
  //
  // NOTE these are the biggest levers in the game: expeditions are ~50% of
  // resource income at every stage (run the projection's INCOME MIX to see
  // it). If resources feel out of control, start here.
  //
  // questGold 0.25 → 0.60 on 2026-07-30 (ECONOMY-REBALANCE-PLAN.md Phase 1).
  // At 0.25 an expedition paid 608 gold/hour against parked raiding's 490 — a
  // 1.24x premium for the channel that costs attention, travel AND ambush
  // casualties, while the passive one cost nothing but a locked lord. So the
  // gold half of expeditions had quietly stopped being a reason to play the
  // game actively, and raiding drifted to 53% of all gold income.
  //
  // The two dials stay SEPARATE and deliberately unequal: expeditions already
  // pay ~15x raiding on resources, so questResources stays at 0.5. Only the
  // gold side was underpaying. Do not "tidy" these to the same number.
  questGold:      0.60,
  questResources: 0.5,

  // ── TIME ────────────────────────────────────────────────────────

  // Lord travel between tiles. Base is 20s per tile at speed 5, scaled by
  // the lord's speed. >1 makes the map feel bigger, <1 smaller.
  // Applied in EconomyCore.getTravelTime, which every mover calls.
  //
  // Does NOT change march FOOD cost — that is per tile, not per second, so
  // slowing travel down does not quietly make marching more expensive.
  travelTime: 1.0,
};

// Safe reader. Returns 1.0 for an unknown or non-numeric dial so a typo in
// this file degrades to "as designed" rather than zeroing an income channel
// or dividing by NaN. Negative values are clamped to 0.
function tune(key) {
  if (typeof TUNING === 'undefined' || !TUNING) return 1.0;
  const v = TUNING[key];
  return (typeof v === 'number' && isFinite(v) && v >= 0) ? v : 1.0;
}
