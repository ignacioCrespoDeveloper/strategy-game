// =============================================
//  data/politics.js — Internal political factions
//
//  Every kingdom has internal power groups with competing interests.
//  These groups are not the player-facing factions (kingdoms) — they are
//  the internal constituencies that any ruler must balance.
//
//  Architecture only — no gameplay implemented yet.
//  Future hooks: power level per group, loyalty, demands, events.
// =============================================

const POLITICAL_GROUPS = {

  nobility: {
    id:          'nobility',
    name:        'Nobility',
    icon:        '⚜',
    description: 'The landed aristocracy. They hold the largest estates, command the best cavalry, and expect their ancient privileges to be respected. They support a strong, centralized crown only when the crown is useful to them.',
    interests:   ['land_rights', 'military_autonomy', 'succession_rights', 'tax_exemptions'],
    // How this group reacts to player actions — no gameplay yet
    attitudes: {
      war_declaration:   +10,   // positive: loves war, means prestige and loot
      trade_treaty:       -5,   // slight negative: merchants gain status relative to them
      tax_increase:      -15,   // strongly negative
      military_expansion:+15,
    },
  },

  merchants: {
    id:          'merchants',
    name:        'Merchants',
    icon:        '💰',
    description: 'The commercial class. They want stable roads, reliable law enforcement, low import tariffs, and rulers who understand that economic growth requires predictability. They are increasingly powerful and the nobility increasingly resents them for it.',
    interests:   ['trade_routes', 'low_tariffs', 'stable_currency', 'market_access', 'contract_law'],
    attitudes: {
      trade_treaty:       +20,
      war_declaration:    -10,   // war disrupts trade
      road_construction:  +15,
      tax_increase:       -10,
    },
  },

  church: {
    id:          'church',
    name:        'Church',
    icon:        '✝',
    description: 'The religious institution that provides moral legitimacy to secular rulers and expects considerable deference in return. Powerful in matters of succession, public order, and — in their view — everything else.',
    interests:   ['religious_law', 'tithe_collection', 'crusades', 'heresy_prosecution', 'influence_over_education'],
    attitudes: {
      pious_leader:       +20,
      vampiric_blood:     -40,   // existential threat
      trade_treaty:         0,   // neutral
      military_campaign:  +10,   // if framed as holy
    },
  },

  army: {
    id:          'army',
    name:        'Army',
    icon:        '⚔',
    description: 'The professional fighting force that enforces all other power. They want to be paid, equipped, and used — in that order. An idle, underpaid army is the most common cause of political instability in the known world.',
    interests:   ['regular_pay', 'equipment_quality', 'campaign_opportunities', 'prestige', 'clear_command_chain'],
    attitudes: {
      war_declaration:    +15,
      military_expansion: +20,
      pay_delay:          -20,   // severe negative
      trade_treaty:        -5,
    },
  },

  peasants: {
    id:          'peasants',
    name:        'Peasants',
    icon:        '🌾',
    description: 'The common people who work the land, pay the bulk of taxes, and form the base of the entire economic and military pyramid. They are patient until they are not. When they stop being patient, they are very, very difficult to stop.',
    interests:   ['food_security', 'low_taxation', 'peace', 'protection_from_raids', 'fair_law'],
    attitudes: {
      famine:             -30,   // severe negative
      peace_year:         +10,
      tax_increase:       -15,
      protection_raid:    +10,
    },
  },
};
