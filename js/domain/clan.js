// =============================================
//  clan.js — ClanService
//
//  Thin shared lookup on top of ServerActions.clanList(), used anywhere
//  that just needs "which clan is player X in" (Rankings tags, Map tags +
//  ally highlighting) without pulling in clan-screen.js's full apply/accept/
//  war UI. Cached briefly (same "pending sentinel, re-render on resolve"
//  shape as map-view.js's own _honorCache) since several screens may ask
//  for the same map within a few seconds of each other.
// =============================================

const ClanService = (() => {
  let _map     = null; // playerId -> { clanId, tag, name }
  let _wars    = [];   // active clan_wars rows ({ clanAId, clanBId, ... }), cached alongside _map
  let _fetchedAt = 0;
  const _TTL = 30000;

  async function getPlayerClanMap(force = false) {
    if (!force && _map && (Date.now() - _fetchedAt) < _TTL) return _map;

    const result = await ServerActions.clanList();
    const map = {};
    if (result.ok) {
      (result.clans || []).forEach(c => {
        (c.members || []).forEach(m => {
          map[m.playerId] = { clanId: c.id, tag: c.tag, name: c.name };
        });
      });
      _wars = (result.wars || []).filter(w => w.status === 'active');
    }
    _map       = map;
    _fetchedAt = Date.now();
    return map;
  }

  // Synchronous read of whatever's currently cached (possibly stale/empty)
  // — for render paths that can't await, mirroring how _honorCache is read
  // synchronously in map-view.js while a background fetch is in flight.
  function peek(playerId) {
    return _map ? (_map[playerId] || null) : null;
  }

  // Whether these two clans have an ACTIVE war between them. Same sync-read
  // caveat as peek(): reflects the last getPlayerClanMap() fetch. Returns
  // false if either side is clanless.
  function isAtWar(clanIdA, clanIdB) {
    if (!clanIdA || !clanIdB || clanIdA === clanIdB) return false;
    return _wars.some(w =>
      (w.clanAId === clanIdA && w.clanBId === clanIdB) ||
      (w.clanAId === clanIdB && w.clanBId === clanIdA));
  }

  return { getPlayerClanMap, peek, isAtWar };
})();
