// =============================================
//  activity.js — Per-player activity feed
//
//  Stores a chronological feed of notable events per player.
//  Shown on the Overview screen as a notification panel.
//
//  Storage key: 'activity_feed'
//  Shape: { [playerId]: ActivityEntry[] }
//
//  ActivityEntry:
//    id        → unique string
//    type      → 'battle_victory' | 'battle_defeat' | 'discovery'
//                | 'lord_moved' | 'action_complete'
//    icon      → emoji
//    title     → short headline
//    detail    → one-line supporting info
//    lordName  → name of the lord who triggered the event
//    at        → timestamp ms
// =============================================

const ActivityService = (() => {
  const KEY     = 'activity_feed';
  const MAX_PER = 50;

  function _getAll()      { return StorageService.get(KEY) || {}; }
  function _saveAll(data) { StorageService.set(KEY, data); }

  function log(playerId, entry) {
    const all = _getAll();
    if (!all[playerId]) all[playerId] = [];
    const id = 'act_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5);
    all[playerId].unshift({ id, at: TimeService.now(), ...entry });
    if (all[playerId].length > MAX_PER) all[playerId] = all[playerId].slice(0, MAX_PER);
    _saveAll(all);
    EventBus.emit('activity:added', { playerId });
  }

  function get(playerId) {
    return _getAll()[playerId] || [];
  }

  const META_KEY = 'activity_meta';

  function markSeen(playerId) {
    const meta = StorageService.get(META_KEY) || {};
    meta[playerId] = TimeService.now();
    StorageService.set(META_KEY, meta);
  }

  function getUnseenCount(playerId) {
    const meta  = StorageService.get(META_KEY) || {};
    const since = meta[playerId] || 0;
    return get(playerId).filter(e => e.at > since).length;
  }

  return { log, get, markSeen, getUnseenCount };
})();
