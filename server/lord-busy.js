// =============================================
//  lord-busy.js — the one "this lord is occupied" test
//
//  A lord that is incapacitated, mid-action (questing, scouting,
//  marching, attacking) or sitting in a stance that restricts actions
//  cannot reorganise its forces: no recruiting, no dismissing, no troop
//  exchange, no mount swaps. An army is assembled BEFORE the lord sets
//  out, not topped up halfway through the march — otherwise a lord could
//  march on a city and buy the troops it needs while already in transit.
//
//  Returns a player-facing reason string, or null when the lord is free.
//
//  Client twin: _lordBusyReason() in js/ui/lord-screen.js, which greys out
//  the Army and Mount tabs. This copy is the authoritative one — the client
//  only hides what these endpoints would refuse anyway.
// =============================================

import { STANCE_DEFS } from './engine-loader.js';

// Reads back as "<Lord> is …". move_lord with intent 'attack' is handled
// separately below, since "marching" undersells an inbound attack.
const _ACTIVITY = {
  search_area: 'away on an expedition',
  scout:       'scouting',
  move_lord:   'marching',
};

export function lordBusyReason(lord, now = Date.now()) {
  if (!lord) return null;
  const name = lord.name || 'That lord';

  if (lord.downtimeUntil && now < lord.downtimeUntil) {
    return `${name} is incapacitated`;
  }

  const item = (lord.actionQueue || [])[0];
  if (item) {
    const what = item.intent === 'attack'
      ? 'marching to attack'
      : (_ACTIVITY[item.actionId] || 'busy with an order');
    return `${name} is ${what}`;
  }

  const stance = lord.stance;
  if (stance?.id && stance.id !== 'idle' && stance.finishAt && now < stance.finishAt
      && STANCE_DEFS[stance.id]?.restrictions?.includes('action')) {
    return `${name} is ${(STANCE_DEFS[stance.id].name || stance.id).toLowerCase()}`;
  }

  return null;
}
