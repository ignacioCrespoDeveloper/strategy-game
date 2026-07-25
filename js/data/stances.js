// =============================================
//  stances.js — Lord stance definitions
//
//  A stance is an active state chosen by the player.
//  It modifies visibility, restricts actions,
//  and will be read by future combat / AI systems.
//
//  Rules:
//  - Every lord always has exactly one stance (default: idle).
//  - Entering a timed stance queues a finishAt timestamp.
//  - When the timer expires, lord reverts to idle automatically.
//  - The 'restrictions' array is the contract future systems use
//    to gate actions — no duplicate checks scattered in UI.
// =============================================

var STANCE_DEFS = {
  idle: {
    id:              'idle',
    name:            'Idle',
    icon:            '⏳',
    description:     'No active stance. Lord is available for all orders.',
    durations:       null,           // no timer — permanent until changed
    restrictions:    [],             // nothing blocked
    visibilityMult:  1.0,
    futureModifiers: {},
  },

  ambush: {
    id:              'ambush',
    name:            'Ambush',
    icon:            '🎯',
    description:     'Lord lies in wait, concealed. Dramatically reduces visibility. Cannot move, recruit, explore or perform any other action while active.',
    durations:       [3600, 7200, 14400], // 1h / 2h / 4h in seconds
    restrictions:    ['move', 'recruit', 'explore', 'action'],
    visibilityMult:  0.1,            // 90 % visibility reduction
    futureModifiers: {
      firstStrike:   true,           // placeholder — combat system will read this
    },
  },

  // 'raiding' is the economic stance: the lord parks on a neutral/wild tile
  // (no city present) and passively generates gold + resources + full HP
  // regen for the chosen duration — but any OTHER player's lord (with an
  // army) that arrives on that exact tile triggers an automatic fight (see
  // combat-resolver.js's resolveArrivalCheck). Losing that fight forfeits
  // the stance and everything accrued; winning it just continues the raid
  // uninterrupted. Server-authoritative end-to-end (see
  // server/actions/raid-start.js / raid-cancel.js / raid-instant.js) —
  // unlike ambush above, this one has real economic value so it can't be a
  // client-only stance change.
  raiding: {
    id:              'raiding',
    name:            'Raiding',
    icon:            '🏴',
    description:     'Lord pillages a wild tile for gold, resources, and full HP regen over time. Locked for the duration — any other lord with an army that arrives here triggers an automatic fight. Losing forfeits the stance and everything earned so far.',
    durations:       [3600, 14400, 28800, 86400], // 1h / 4h / 8h / 24h
    restrictions:    ['move', 'recruit', 'explore', 'action'],
    visibilityMult:  1.0,
    futureModifiers: {},
  },
};
