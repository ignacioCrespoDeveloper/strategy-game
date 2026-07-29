// =============================================
//  discovery-roll.js — THE shared quest/discovery roll math
//
//  Single source of truth for: which discovery a search turns up, how
//  hard a combat camp is, and what loot a discovery pays out.
//
//  Loaded by the browser (index.html) AND by the server via
//  server/engine-loader.js, exactly like economy-core.js and
//  battle-engine.js. Environment-agnostic: every catalog it needs
//  (DISCOVERY_DEFS, CAMP_DEFS) is passed in as an argument rather than
//  read from a global, so the same file works in both places.
//
//  WHY THIS EXISTS: this math used to be hand-mirrored in
//  js/domain/discovery.js and server/tick/catch-up.js. The copies had
//  already drifted — catch-up.js scaled the UNFLOORED random roll
//  (`(min + rand*(span)) * scalar`) while discovery.js floored it first
//  (`floor(rand) * scalar`), so the two produced different loot for the
//  same inputs. The server copy is authoritative in play, which made the
//  client's preview subtly wrong. Consolidated here on the floor-then-scale
//  form. Do NOT re-inline any of this; add to it here instead.
//
//  NOTE ON RANDOMNESS: these functions call Math.random() directly and are
//  therefore NOT pure. The server is authoritative — client-side calls are
//  for preview/offline only and their results are always superseded.
// =============================================

// `var`, NOT `const` — server/engine-loader.js runs these files through
// vm.runInContext, where only `var` top-level declarations become properties
// of the shared context. A `const` here loads without error but leaves
// _ctx.DiscoveryRoll undefined, silently disabling every quest roll on the
// server. Same reason economy-core.js and battle-engine.js use `var`.
var DiscoveryRoll = (() => {

  // ── Expedition length — the player's bet ──────────────────────
  // Replaces the old search-fatigue ladder, which imposed these same
  // durations as a PENALTY for questing often. Now the player picks one up
  // front: longer means a bigger payout and better odds of something rare,
  // paid for with real risk and real time. `risk` is consumed by the Ambush
  // outcome; the weight multipliers reshape the discovery roll itself.
  const LENGTHS = {
    short:    { id: 'short',    label: 'Short',    secs: 300,  reward: 0.6, legendary: 0.3, nothing: 1.3, risk: 0.3 },
    standard: { id: 'standard', label: 'Standard', secs: 900,  reward: 1.0, legendary: 1.0, nothing: 1.0, risk: 1.0 },
    long:     { id: 'long',     label: 'Long',     secs: 1800, reward: 1.8, legendary: 2.5, nothing: 0.7, risk: 2.0 },
  };
  const DEFAULT_LENGTH = 'standard';
  const lengthOf = id => LENGTHS[id] || LENGTHS[DEFAULT_LENGTH];

  // ── Expedition Rating — what quality of recruit you can attract ─
  // ER = Σ unitPWR × (scout ? SCOUT_ER_MULT : 1). Scouts pay double because
  // finding things is their entire job — the `scout` trait was declared in
  // js/data/traits.js with the hook 'onWorldSearch.increaseSearchRange' and
  // NEVER implemented; this is what finally gives it a function.
  //
  // ER is the FLOOR pushing an expedition bigger; footprint (below) is the
  // ceiling pushing back. Scouts satisfy the floor without raising the
  // ceiling much — 1 PWR of scout buys 2 ER — which is precisely why a
  // scout-heavy force is the answer instead of simply a large one.
  const SCOUT_ER_MULT = 2;

  function expeditionRating(units, unitDefs) {
    if (!units || !unitDefs || typeof EconomyCore === 'undefined') return 0;
    return units.reduce((sum, u) => {
      const def = unitDefs[u.unitId];
      if (!def) return sum;
      const isScout = (def.traits || []).includes('scout');
      return sum + EconomyCore.getUnitPower(def) * (u.count || 0) * (isScout ? SCOUT_ER_MULT : 1);
    }, 0);
  }

  // ONE ER ladder, TWO consequences. `er` is the rating needed; then:
  //   pool     → which recruits can turn up (rollRecruits)
  //   tierOdds → the EXACT probability of each find tier (rollDef stage 2)
  //   nothing  → how often the expedition comes back empty (rollDef stage 1)
  // Ordered strongest-first so erTierFor can return the first match.
  //
  // `tierOdds` IS A PROBABILITY DISTRIBUTION, NOT A WEIGHT MULTIPLIER. Each
  // row sums to 1 and is read directly: a Common force finds tier 1 and
  // nothing else; a Rare force finds tier 3 on 5% of its finds. Publish these
  // numbers freely — they are exactly what the roll does, on every terrain.
  // (They were multipliers until 2026-07-29, which made the real split an
  // emergent product of terrain and baseWeight that nobody could state.)
  //
  // WHY TIERS ARE GATED RATHER THAN MERELY WEIGHTED (Nacho's call, and the
  // measurements back it): tier 3 pays 25–50k resources before scaling. Handed
  // to a level-2 lord that is ~20× their entire economy — it doesn't reward
  // them, it erases the early game. In the other direction a tier-1 find pays
  // 800–1500, which at endgame is rounding error and reads as a wasted
  // expedition. So the tiers phase in AND out: each band unlocks the tier
  // above and sheds the one below, and ER is the only thing that moves you.
  //
  // Thresholds interlock with the army PWR cap (200 + level×80, max 1000, or
  // 1100 with the commanding talent) AND with footprint: reaching Legendary
  // needs ~400 PWR of scouts (ER 800) which stays under the 600-PWR quiet
  // threshold, or ~800 PWR of line troops which does not. That is the whole
  // design in one number — you can buy the good finds and the good recruits
  // with scouts cheaply, or with raw mass expensively and loudly. Mass gets
  // you the same ER band but eats the footprint penalty for it, so scouts
  // remain strictly the better way to buy the same number.
  const RECRUIT_TIERS = [
    { id: 'legendary', label: 'Legendary', er: 800,
      tierOdds: { 1: 0.05, 2: 0.70, 3: 0.25 }, nothing: 0.70,
      pool: ['ogre_warrior', 'ironguts', 'ogre_champion', 'young_dragon'] },
    { id: 'rare',      label: 'Rare',      er: 450,
      tierOdds: { 1: 0.25, 2: 0.70, 3: 0.05 }, nothing: 0.85,
      pool: ['dragon_guard', 'forest_troll', 'ogre_bulls'] },
    { id: 'uncommon',  label: 'Uncommon',  er: 200,
      tierOdds: { 1: 0.25, 2: 0.74, 3: 0.01 }, nothing: 1.00,
      pool: ['goblin_archers', 'goblin_wolf_riders', 'mercenary_spearmen', 'crossbowmen', 'mercenary_crossbows'] },
    { id: 'common',    label: 'Common',    er: 0,
      tierOdds: { 1: 1.00, 2: 0,    3: 0    }, nothing: 1.25,
      pool: ['goblin_rabble', 'goblin_spearmen', 'bandits', 'bandit_archers'] },
  ];

  function erTierFor(er) {
    return RECRUIT_TIERS.find(t => (er || 0) >= t.er) || RECRUIT_TIERS[RECRUIT_TIERS.length - 1];
  }
  // Kept as the name every recruit-facing caller already uses; identical band.
  const recruitTierFor = erTierFor;

  // Which categories carry a loot tier and are therefore reshaped by ER.
  // combat/recruits/nothing/intelligence are excluded: they have their own
  // multipliers (risk, footprint) and no tier to weight by.
  const TIERED_CATEGORIES = new Set(['resource', 'event', 'trade', 'legendary']);
  // Same fallback rollRewards uses, so weighting and payout never disagree.
  const tierOf = def => def?.tier || 2;

  // How many turn up. Cheap rabble arrives in numbers; a dragon arrives alone.
  function _recruitCount(unitDef) {
    if (!unitDef || typeof EconomyCore === 'undefined') return 1;
    const p = EconomyCore.getUnitPower(unitDef);
    if (p >= 100) return 1;
    if (p >= 60)  return 1 + Math.floor(Math.random() * 2); // 1-2
    return 1 + Math.floor(Math.random() * 3);               // 1-3
  }

  // Rolls what an expedition's recruit find actually offers.
  // Returns { tierId, tierLabel, unitId, count, er } or null.
  function rollRecruits(units, unitDefs) {
    const er   = expeditionRating(units, unitDefs);
    const tier = recruitTierFor(er);
    const pool = (tier.pool || []).filter(id => unitDefs?.[id]);
    if (pool.length === 0) return null;
    const unitId = pool[Math.floor(Math.random() * pool.length)];
    return {
      tierId: tier.id, tierLabel: tier.label, unitId,
      count: _recruitCount(unitDefs[unitId]),
      er: Math.round(er),
    };
  }

  // ── Footprint — the ceiling that makes composition matter ─────
  // A big army is loud and slow. It can't sneak, so it blunders into fights
  // and scares off everything quiet. Scouts find things; armies find fights.
  //
  // WHY THIS EXISTS: Expedition Rating is a FLOOR pushing armies bigger, with
  // nothing pushing back — so "bring everything" won by default and the
  // composition decision evaporated exactly when the player had most options.
  // Measured before this landed (long expeditions, real BattleEngine):
  //   L1 naked lord     7% win, 27% lord falls
  //   L5, 10 units     93% win,  2% falls, 0.7 units lost
  //   L10, 20 units   100% win,  2% falls, 0.4 units lost of 20
  // Late-game ambush was a free ~263g bonus for over-stuffing the army.
  //
  // Loudness ramps 0 → 1 across QUIET_PWR → LOUD_PWR, then clamps. Absolute
  // PWR, not a fraction of the lord's cap: the mechanic should stay invisible
  // early (armies are small anyway) and bite late, which is where the problem
  // actually is.
  const QUIET_PWR = 600;   // below this an expedition is a scouting party
  const LOUD_PWR  = 1000;  // at/above this it's an army on the march
  const FOOTPRINT = {
    combat:      1.0,  // combat weight  × (1 + this × loudness)  → up to 2×
    nothing:     0.8,  // nothing weight × (1 + this × loudness)  → up to 1.8×
    reward:      0.35, // payout         × (1 − this × loudness)  → down to 0.65×
    levelBumpAt: 0.6,  // loudness at which ambushes get +1 camp level
  };

  function loudnessOf(armyPower) {
    const p = armyPower || 0;
    return Math.max(0, Math.min(1, (p - QUIET_PWR) / (LOUD_PWR - QUIET_PWR)));
  }

  // ── Tile depletion — the anti-farm limiter ────────────────────
  // Indexed by how many expeditions this tile has already had TODAY. Parking a
  // lord on one tile and re-rolling it strips the area bare; moving on resets
  // the payout. Replaces the old fatigue timers, which punished frequency with
  // waiting instead of rewarding movement. Floor is deliberately non-zero —
  // a picked-clean tile should feel pointless, not be a hard block.
  const DEPLETION = [1.0, 0.85, 0.70, 0.55, 0.40];
  function depletionFor(priorCount) {
    const i = Math.max(0, Math.min(DEPLETION.length - 1, priorCount | 0));
    return DEPLETION[i];
  }

  // Discovery IDs that count as "gold-type" for the treasure_hunter talent's
  // goldDiscoveryBonus. Kept as data next to the roll that consumes it.
  const GOLD_DISC_IDS = new Set([
    'coin_cache', 'lost_treasure', 'buried_vault',
    'merchant_caravan', 'traveling_merchant', 'ancient_relic', 'bog_crystal',
  ]);

  // Which resource each discovery yields (value just needs to be truthy —
  // the actual amount comes from def.tier via TIER_RANGES × lord level).
  const BASE_REWARDS = {
    // Tier 1
    iron_vein:        { stone: 1, xp: 15 },
    cliff_face:       { stone: 1, xp: 15 },
    fertile_fields:   { food: 1,  xp: 15 },
    river_crossing:   { food: 1,  xp: 15 },
    coin_cache:       { gold: 1,  xp: 15 },
    // Tier 2
    timber_cache:     { wood: 1,  xp: 30 },
    abandoned_mine:   { stone: 1, xp: 40 },
    stone_deposit:    { stone: 1, xp: 30 },
    wild_game:        { food: 1,  xp: 20 },
    lost_treasure:    { gold: 1,  xp: 60 },
    // Tier 3
    ancient_forest:   { wood: 1,  xp: 70  },
    deep_ore_shaft:   { stone: 1, xp: 80  },
    marble_quarry:    { stone: 1, xp: 80  },
    bountiful_hunt:   { food: 1,  xp: 60  },
    buried_vault:     { gold: 1,  xp: 100 },
    // Event / trade / legendary
    // ancient_ruins and wandering_sage used to pay XP and NOTHING ELSE, which
    // made the two most common event finds feel like a wasted expedition —
    // ancient_ruins is the single highest-weight event def and its own
    // description promises "Scholars would pay dearly for access". Both now
    // pay coin, as they always read like they should.
    ancient_ruins:       { gold: 1,  xp: 80  },
    abandoned_keep:      { gold: 1,  xp: 50  },
    wandering_sage:      { gold: 1,  xp: 100 },
    merchant_caravan:    { gold: 1,  xp: 20  },
    traveling_merchant:  { gold: 1,  xp: 20  },
    ancient_relic:       { gold: 1,  xp: 160 },
    bog_crystal:         { gold: 1,  xp: 120 },
  };

  // Loot ranges by def.tier: [min, max] for plain resources and for gold.
  //
  // Raised ~2.5× on 2026-07-28, then ~1.75×/2.15×/2.4× again on 2026-07-29.
  // The 07-28 pass fixed finds paying a sixth of what ambushes did; this pass
  // is a deliberate pump of the whole activity plus a widening of the SPREAD
  // between tiers, because tier is no longer a lottery — ER decides it (see
  // RECRUIT_TIERS.find). A flat raise would have pumped the reward without
  // rewarding the decision, so tier 3 climbs hardest and tier 1 least: the
  // gap between a proper scouting force and a rabble IS the pump.
  //
  // Anchor: at L10 on a Long expedition a tier-3 gold find now averages ~2.4k
  // after level and length scaling, against a 510-gold Greatswords and a city
  // that produces ~31 gold/hour. Cities were never the gold source (see
  // raid-guide.html) — lords in the field are, and this is what that costs.
  // Tune HERE; every length/level/depletion/footprint multiplier compounds on
  // top of these numbers.
  // RESOURCES and GOLD are deliberately on DIFFERENT scales — this is the
  // single most important thing to understand before retuning either.
  //   · Resources (food/wood/stone) buy BUILDINGS, whose cost grows ×1.6 per
  //     level forever. Demand is unbounded, and a maxed lumber mill only makes
  //     ~780/hour, so an expedition find has to be in the thousands to matter
  //     at all. Hence 800 → 50,000 across the three tiers.
  //   · Gold buys UNITS and nothing else (units have no resourceCost), and an
  //     army is hard-capped at 200 + level×80 PWR ≈ 5–10k gold to fill. Demand
  //     is therefore BOUNDED, and putting gold on the resource curve would let
  //     one find buy a dozen armies. Gold stays modest on purpose.
  // A find pays one or the other, never both (see BASE_REWARDS), so the two
  // ladders never need to agree — they answer to different sinks.
  //
  // THE BANDS ARE CONTIGUOUS ON PURPOSE — each tier's ceiling is the next
  // tier's floor (res: 800 → 5,000 → 25,000 → 50,000). This is lifted from
  // OGame's expedition variants, whose multipliers run S 10–50, M 52–100,
  // L 102–200: a lucky S is worth an unlucky M, so no roll ever lands in a
  // dead zone between brackets.
  //
  // The previous ladder left a 3.3× hole between T1's 1,500 ceiling and T2's
  // 5,000 floor. That hurt most at Uncommon, where 25% of finds are T1: a
  // quarter of that band's results paid ~1,090 against ~9,300 for the rest, so
  // they read as duds rather than as small wins. Closing the gap means a lucky
  // low-tier roll brushes the tier above instead of feeling like a wasted
  // expedition. Note the spread now WIDENS as tiers get commoner (T1 6.3×,
  // T2 5×, T3 2×), which is also OGame's shape — the frequent outcome is the
  // swingy one, the rare outcome is reliably big.
  //
  // If you retune these, keep them contiguous: min(tier N+1) === max(tier N).
  // Tune HERE; every length/level/depletion/footprint multiplier compounds on
  // top of these numbers.
  const TIER_RANGES = {
    1: { res: [800,   5000],  gold: [200,  500]  },
    2: { res: [5000,  25000], gold: [500,  1400] },
    3: { res: [25000, 50000], gold: [1400, 3600] },
  };

  const RES_TYPES = ['gold', 'food', 'wood', 'stone'];

  // Lord level adds +12% loot per level above 1.
  const LEVEL_SCALAR_PER_LEVEL = 0.12;

  function _randInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  // ── Which discovery does this search turn up? ──────────────────
  //
  // TWO-STAGE ROLL (restructured 2026-07-29). Stage 1 decides WHAT KIND of
  // thing happens — nothing / ambush / recruits / a find — by weight. Stage 2,
  // only if it's a find, decides WHICH TIER from the ER band's odds. Stage 3
  // picks a specific def inside that tier by terrain weight.
  //
  // WHY IT IS SPLIT THIS WAY: tier used to be an EMERGENT property of the
  // single weighted roll — ER multiplied each def's weight, so the tier split
  // was whatever terrain and baseWeight happened to produce, and it drifted
  // with terrain. That made the design intent inexpressible: you could not say
  // "a Common force never finds tier 3" or "a Rare force finds tier 3 5% of
  // the time" and have it be TRUE, only approximately true on plains. Rolling
  // the tier from an explicit distribution makes those statements exact and
  // terrain-independent, which is what lets the guide publish real numbers.
  // It is also how OGame does it: the S/M/L variant is drawn first at fixed
  // 89/10/1 odds, and only then is the payout computed.
  //
  // Terrain still decides WHICH find inside a tier (and can still veto a def
  // entirely with a 0 multiplier) — it just no longer decides how good the
  // tier is. `er` is trailing and optional so a call that omits it lands in
  // the Common band rather than throwing.
  function _defWeight(def, terrainId, goldBonus, len, loud, band) {
    const mults  = def.terrainMultipliers || {};
    const mult   = (terrainId in mults) ? mults[terrainId] : 1.0;
    let   weight = def.baseWeight * mult;
    if (goldBonus && GOLD_DISC_IDS.has(def.id)) weight *= (1 + goldBonus);
    // Expedition length reshapes the tails: a long push is markedly more
    // likely to be jumped and less likely to come back empty. `legendary`
    // still applies to the two legendary-category defs, which now biases
    // WITHIN the tier-3 pool rather than against the whole catalog.
    if (def.category === 'legendary') weight *= len.legendary;
    if (def.category === 'nothing')   weight *= len.nothing * (1 + FOOTPRINT.nothing * loud) * band.nothing;
    if (def.category === 'combat')    weight *= len.risk    * (1 + FOOTPRINT.combat  * loud);
    return weight;
  }

  // Sorts every rollable def into the non-find outcomes and the three tier
  // pools. Entries at weight <= 0 are dropped, which is also what keeps the
  // baseWeight-0 intelligence defs (enemy_city, enemy_lord — written directly
  // by the Scout action) out of random rolls.
  function _buckets(discoveryDefs, terrainId, goldBonus, lengthId, loudness, er) {
    const len  = lengthOf(lengthId);
    const loud = Math.max(0, Math.min(1, loudness || 0));
    const band = erTierFor(er);
    const other = [];
    const byTier = { 1: [], 2: [], 3: [] };

    for (const def of Object.values(discoveryDefs || {})) {
      const weight = _defWeight(def, terrainId, goldBonus, len, loud, band);
      if (!(weight > 0)) continue;
      if (TIERED_CATEGORIES.has(def.category)) byTier[tierOf(def)].push({ def, weight });
      else other.push({ def, weight });
    }

    let findWeight = 0;
    for (const t of [1, 2, 3]) for (const e of byTier[t]) findWeight += e.weight;
    return { other, byTier, band, findWeight };
  }

  // Which tiers this band can actually draw HERE — a band's odds are useless
  // if the terrain holds no def of that tier (no marble quarry in a marsh), so
  // the surviving tiers are renormalised among themselves.
  function _availableTiers(band, byTier) {
    return [1, 2, 3].filter(t => byTier[t].length > 0 && (band.tierOdds[t] || 0) > 0);
  }

  function _pickTier(band, byTier) {
    const avail = _availableTiers(band, byTier);
    if (avail.length === 0) {
      // The band allows no tier that exists on this ground. Rather than report
      // an empty expedition, fall back to the LOWEST tier present — a find the
      // player was not really entitled to is a smaller sin than a dead roll.
      const any = [1, 2, 3].filter(t => byTier[t].length > 0);
      return any.length ? any[0] : null;
    }
    let total = 0;
    avail.forEach(t => total += band.tierOdds[t]);
    let rand = Math.random() * total;
    for (const t of avail) {
      rand -= band.tierOdds[t];
      if (rand <= 0) return t;
    }
    return avail[avail.length - 1];
  }

  function _pickWeighted(entries) {
    let total = 0;
    entries.forEach(e => total += e.weight);
    let rand = Math.random() * total;
    for (const e of entries) {
      rand -= e.weight;
      if (rand <= 0) return e.def;
    }
    return entries[entries.length - 1].def;
  }

  function rollDef(discoveryDefs, terrainId, goldBonus, lengthId, loudness, er) {
    const { other, byTier, band, findWeight } = _buckets(discoveryDefs, terrainId, goldBonus, lengthId, loudness, er);

    let total = findWeight;
    other.forEach(e => total += e.weight);
    if (!(total > 0)) return null;

    // Stage 1 — the find pool competes as a SINGLE bucket against nothing,
    // ambush and recruits, so how often you find anything still depends on
    // terrain and length, but no longer on your ER band's tier odds.
    let rand = Math.random() * total;
    for (const e of other) {
      rand -= e.weight;
      if (rand <= 0) return e.def;
    }

    // Stage 2 + 3 — tier from the band, then the def from within it.
    const tier = _pickTier(band, byTier);
    if (tier == null) return null;
    return _pickWeighted(byTier[tier]);
  }

  // ── Exact outcome probabilities for a given force ─────────────
  // Returns { nothing, combat, recruits, tier1, tier2, tier3, find } as
  // fractions of 1, mirroring rollDef stage for stage — so the guide and the
  // confirm panel can state real odds instead of quoting raw multipliers,
  // which tell a player nothing about how often something actually happens.
  function outcomeOdds(discoveryDefs, terrainId, lengthId, loudness, er) {
    const { other, byTier, band, findWeight } = _buckets(discoveryDefs, terrainId, 0, lengthId, loudness, er);
    const out = { nothing: 0, combat: 0, recruits: 0, tier1: 0, tier2: 0, tier3: 0, find: 0 };

    let total = findWeight;
    other.forEach(e => total += e.weight);
    if (!(total > 0)) return out;

    for (const e of other) {
      const p = e.weight / total;
      const c = e.def.category;
      if      (c === 'nothing')  out.nothing  += p;
      else if (c === 'combat')   out.combat   += p;
      else if (c === 'recruits') out.recruits += p;
    }
    out.find = findWeight / total;

    // Same renormalisation _pickTier uses, so published odds match the roll.
    const avail = _availableTiers(band, byTier);
    if (avail.length > 0) {
      let oddsTotal = 0;
      avail.forEach(t => oddsTotal += band.tierOdds[t]);
      avail.forEach(t => { out['tier' + t] = out.find * (band.tierOdds[t] / oddsTotal); });
    } else {
      const any = [1, 2, 3].filter(t => byTier[t].length > 0);
      if (any.length) out['tier' + any[0]] = out.find;
    }
    return out;
  }

  // ── How hard is the camp? ─────────────────────────────────────
  // Difficulty tracks the army that found it, so a camp is always roughly
  // scaled to the finder, then ±1 for a challenge floor and a stretch goal.
  function rollCampLevel(armyPower) {
    let base;
    if      (armyPower < 100)  base = 1;
    else if (armyPower < 300)  base = 2;
    else if (armyPower < 700)  base = 3;
    else if (armyPower < 1400) base = 4;
    else                       base = 5;

    // A loud column doesn't get jumped by the same three bandits a scouting
    // party does — whatever is out there brings everyone. Without this the
    // extra ambushes footprint causes would be pure free loot for a big army.
    if (loudnessOf(armyPower) >= FOOTPRINT.levelBumpAt) base += 1;

    const roll = Math.floor(Math.random() * 3) - 1; // -1, 0, +1
    return Math.max(1, Math.min(5, base + roll));
  }

  // ── Ambush force scaling ──────────────────────────────────────
  // An ambush must be a REAL fight at any army size, or winning one is just
  // free money. The fixed 5-level camp ladder can't do that: it tops out
  // around 691 PWR while a late army reaches 1500+, so the defender/attacker
  // ratio collapses as you grow. Measured before this landed:
  //
  //   force            armyPWR  campPWR  ratio  win%  gold  lost  NET
  //   scout party (6)      376      294   0.78   90%   325   147  +178
  //   balanced (10)        530      281   0.53  100%   383   106  +277
  //   big line (14)       1086      426   0.39  100%   828   223  +605
  //   everything (20)     1500      445   0.30  100%   915   150  +765
  //
  // Being ambushed was PROFITABLE at every size and best at the top — the
  // exact opposite of a risk. So the ambush now fields a roster scaled to a
  // fraction of the attacker's own power, keeping the ratio (and therefore
  // the casualties) roughly constant however big you get. Loot scales by the
  // same multiplier, so a bigger fight still pays more — it just costs blood
  // in proportion instead of being a walkover.
  // THE REAL PWR RANGE: getArmyPowerCap is 200 + level×80, LORD_MAX_LEVEL is
  // 10 → 1000, or 1100 with the `commanding` talent's +100. Nothing legal
  // exists above that, so the whole curve is tuned across 0–1100 and anything
  // beyond is unreachable rather than merely rare.
  const AMBUSH_RATIO     = 0.9;  // baseline: defenders field ~90% of attacker PWR
  const AMBUSH_RATIO_VAR = 0.25; // ±25% so no two ambushes feel identical
  const AMBUSH_MAX_MULT  = 12;   // sanity clamp on roster inflation

  // Overmatch: past OVERMATCH_PWR the ambush can field MORE than you brought.
  // Below it the ratio stays under 1 and a competent army expects to win; a
  // full-cap host instead gets swarmed by something bigger than itself, which
  // is the point — there has to be a size where marching everywhere stops
  // being safe, or "bring everything" quietly wins again.
  const OVERMATCH_PWR   = 800;   // where defenders start outnumbering you
  const OVERMATCH_MAX   = 1100;  // the true ceiling (L10 + commanding talent)
  const OVERMATCH_RATIO = 1.30;  // ratio at the ceiling → face 130% of your PWR

  function ambushRatioFor(armyPower) {
    const t = Math.max(0, Math.min(1, ((armyPower || 0) - OVERMATCH_PWR) / (OVERMATCH_MAX - OVERMATCH_PWR)));
    return AMBUSH_RATIO + (OVERMATCH_RATIO - AMBUSH_RATIO) * t;
  }

  // Returns { level, type, defenders, powerMult } — powerMult is how far the
  // printed roster was inflated, and the caller scales loot by it.
  function rollAmbushDetails(campDefs, unitDefs, defId, armyPower) {
    const base = rollCampDetails(campDefs, defId, armyPower);
    if (!base) return null;
    base.powerMult = 1;
    if (!unitDefs || !(armyPower > 0)) return base;

    // EconomyCore is THE power formula and is loaded before this file in both
    // environments (index.html and server/engine-loader.js). Re-deriving PWR
    // here would recreate exactly the duplication this module exists to kill.
    if (typeof EconomyCore === 'undefined') return base;
    const rosterPwr = EconomyCore.getArmyPower(base.defenders, unitDefs);
    if (!(rosterPwr > 0)) return base;

    const swing  = 1 + (Math.random() * 2 - 1) * AMBUSH_RATIO_VAR;
    const target = armyPower * ambushRatioFor(armyPower) * swing;
    // Never WEAKER than the printed roster — a small party still faces the
    // camp as written; only oversized armies pull a bigger force onto them.
    const mult = Math.max(1, Math.min(AMBUSH_MAX_MULT, target / rosterPwr));
    if (mult <= 1) return base;

    base.defenders = base.defenders.map(s => ({ ...s, count: Math.max(1, Math.round(s.count * mult)) }));
    base.powerMult = mult;
    return base;
  }

  function rollCampDetails(campDefs, defId, armyPower) {
    const campDef = campDefs?.[defId];
    if (!campDef) return null;

    const [minLevel, maxLevel] = campDef.levelRange;
    const level     = Math.max(minLevel, Math.min(maxLevel, rollCampLevel(armyPower)));
    const defenders = campDef.defenderRosterByLevel?.[level]
      || campDef.defenderRosterByLevel?.[minLevel]
      || [{ unitId: 'bandits', count: 2 }];

    return { level, type: defId, defenders };
  }

  // ── What does it pay out? ─────────────────────────────────────
  // Combat discoveries pay nothing here — BattleEngine resolves their loot.
  // opts: { lengthId, depletion, loudness } — the expedition's payout
  // multiplier, the tile's remaining richness, and how much the army's own
  // noise scared off. All default to neutral so older 2-arg calls are
  // unchanged.
  function rollRewards(def, lordLevel, opts) {
    const rewards = [];
    if (!def || def.category === 'combat') return rewards;

    const level     = Math.max(1, lordLevel || 1);
    const lengthMul = lengthOf(opts?.lengthId).reward;
    const depletion = (opts?.depletion == null) ? 1 : opts.depletion;
    // The quiet finds — a hidden cache, a wary trader — are exactly what a
    // marching army doesn't get shown. This is the lever that actually makes
    // an oversized expedition worse, rather than just busier.
    const loudMul   = 1 - FOOTPRINT.reward * Math.max(0, Math.min(1, opts?.loudness || 0));
    const scalar    = (1 + LEVEL_SCALAR_PER_LEVEL * (level - 1)) * lengthMul * depletion * loudMul;
    const tier      = def.tier || 2;
    const ranges = TIER_RANGES[tier] || TIER_RANGES[2];
    const base   = BASE_REWARDS[def.id];

    if (!base) {
      rewards.push({ type: 'xp', amount: 20 });
      return rewards;
    }

    RES_TYPES.forEach(t => {
      if (!base[t] || base[t] <= 0) return;
      // lost_treasure keeps a hand-tuned gold band; everything else uses tier.
      // It is a tier-2 def that should out-pay its tier — a buried chest of
      // coins and gemstones, so it sits above the tier-2 gold band and below
      // tier 3. Scaled with TIER_RANGES on 2026-07-29 so it keeps that slot.
      const [min, max] = (t === 'gold')
        ? (def.id === 'lost_treasure' ? [800, 2000] : ranges.gold)
        : ranges.res;
      rewards.push({ type: t, amount: Math.floor(_randInt(min, max) * scalar) });
    });
    // XP tracks how long the lord was actually out there, but NOT tile
    // depletion — a picked-clean tile yields no loot, yet the lord still
    // learned the ground. Keeps re-searching a bare tile a viable (if slow)
    // way to level a lord, rather than wasting the trip entirely.
    if (base.xp > 0) rewards.push({ type: 'xp', amount: Math.round(base.xp * lengthMul) });

    return rewards;
  }

  return {
    rollDef, outcomeOdds, rollCampLevel, rollCampDetails, rollAmbushDetails, rollRewards,
    lengthOf, depletionFor, loudnessOf, ambushRatioFor,
    expeditionRating, recruitTierFor, erTierFor, rollRecruits,
    LENGTHS, DEFAULT_LENGTH, DEPLETION, RECRUIT_TIERS, SCOUT_ER_MULT,
    FOOTPRINT, QUIET_PWR, LOUD_PWR, OVERMATCH_PWR, OVERMATCH_MAX,
    GOLD_DISC_IDS, BASE_REWARDS, TIER_RANGES, LEVEL_SCALAR_PER_LEVEL,
  };
})();
