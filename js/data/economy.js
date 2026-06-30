// =============================================
//  data/economy.js — Production chain stubs
//
//  Production chains define how raw resources become finished goods.
//  Each stage requires a building and transforms an input resource into
//  an output resource over time.
//
//  Architecture only — no gameplay implemented yet.
//  Future hooks: building requirements, city assignments, market pricing.
// =============================================

const PRODUCTION_CHAINS = {

  // ── Food Production ──────────────────────────────────────────────────

  bread: {
    id:           'bread',
    name:         'Bread Production',
    category:     'food',
    finalProduct: 'bread',
    stages: [
      {
        id:       'farming',
        label:    'Farming',
        building: 'farm',
        input:    null,
        output:   'wheat',
        turnsPerUnit: 1,
      },
      {
        id:       'milling',
        label:    'Milling',
        building: 'mill',
        input:    'wheat',
        output:   'flour',
        turnsPerUnit: 1,
      },
      {
        id:       'baking',
        label:    'Baking',
        building: 'bakery',
        input:    'flour',
        output:   'bread',
        turnsPerUnit: 1,
      },
    ],
    // Future: population growth modifier, city happiness modifier
  },

  // ── Weapons Production ───────────────────────────────────────────────

  weapons: {
    id:           'weapons',
    name:         'Weapons Production',
    category:     'military',
    finalProduct: 'weapons',
    stages: [
      {
        id:       'mining',
        label:    'Mining',
        building: 'mine',
        input:    null,
        output:   'iron_ore',
        turnsPerUnit: 1,
      },
      {
        id:       'smelting',
        label:    'Smelting',
        building: 'smelter',
        input:    'iron_ore',
        output:   'iron_ingot',
        turnsPerUnit: 1,
      },
      {
        id:       'forging',
        label:    'Forging',
        building: 'forge',
        input:    'iron_ingot',
        output:   'weapons',
        turnsPerUnit: 2,
      },
    ],
    // Future: unit recruitment cost modifier, unit stat modifier
  },

  // ── Timber Production ────────────────────────────────────────────────

  timber: {
    id:           'timber',
    name:         'Timber Production',
    category:     'construction',
    finalProduct: 'planks',
    stages: [
      {
        id:       'logging',
        label:    'Logging',
        building: 'lumber_camp',
        input:    null,
        output:   'logs',
        turnsPerUnit: 1,
      },
      {
        id:       'sawing',
        label:    'Sawing',
        building: 'sawmill',
        input:    'logs',
        output:   'planks',
        turnsPerUnit: 1,
      },
    ],
    // Future: construction time modifier, ship building prerequisite
  },

  // ── Mercenary Supply ─────────────────────────────────────────────────

  mercenaries: {
    id:           'mercenaries',
    name:         'Mercenary Supply',
    category:     'military',
    finalProduct: 'mercenary_contract',
    stages: [
      {
        id:       'gold_reserve',
        label:    'Gold Reserve',
        building: 'treasury',
        input:    'gold',
        output:   'mercenary_contract',
        turnsPerUnit: 1,
      },
    ],
    // Note: Merchant League has affinity for this chain
    // Future: cost modifier for merchant_league kingdom
  },
};

// ── Raw resource registry ─────────────────────────────────────────────
// All intermediate and final goods produced by chains above.
// This registry allows the economy system to track availability
// and price without hardcoding per-system references.

const GOODS = {
  wheat:             { name: 'Wheat',           category: 'food',         raw: true  },
  flour:             { name: 'Flour',           category: 'food',         raw: false },
  bread:             { name: 'Bread',           category: 'food',         raw: false },
  iron_ore:          { name: 'Iron Ore',        category: 'metal',        raw: true  },
  iron_ingot:        { name: 'Iron Ingots',     category: 'metal',        raw: false },
  weapons:           { name: 'Weapons',         category: 'military',     raw: false },
  logs:              { name: 'Logs',            category: 'construction', raw: true  },
  planks:            { name: 'Planks',          category: 'construction', raw: false },
  mercenary_contract:{ name: 'Merc. Contract',  category: 'military',     raw: false },
};
