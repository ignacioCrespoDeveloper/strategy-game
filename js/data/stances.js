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

  raid: {
    id:              'raid',
    name:            'Raid',
    icon:            '⚔',
    description:     'Lord holds position aggressively. Cannot move, recruit, explore or perform other actions while active.',
    durations:       [3600, 7200, 14400], // 1h / 2h / 4h
    restrictions:    ['move', 'recruit', 'explore', 'action'],
    visibilityMult:  1.4,            // slightly more visible (aggressive posture)
    futureModifiers: {
      raidDamage:    true,           // placeholder — combat system will read this
    },
  },
};
