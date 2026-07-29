// =============================================
//  discovery.js — Discovery domain service
//
//  Owns: weighted roll, per-player storage, expiry.
//  Does NOT own: UI, action timing, XP rewards.
//
//  Storage key: 'discoveries'
//  Shape: { [playerId]: DiscoveryRecord[] }
//
//  DiscoveryRecord:
//    id           → unique string
//    definitionId → key in DISCOVERY_DEFS
//    tileX, tileY → map coordinates of the search
//    terrain      → terrain id at time of search
//    lordId       → which lord performed the search
//    discoveredAt → timestamp ms
//    expiresAt    → timestamp ms | null (null = never expires)
//
//  To support future discovery types (enemies, cities, artifacts):
//    Add a field to DiscoveryRecord and a new definitionId.
//    Add the definition to DISCOVERY_DEFS.
//    Nothing else needs to change.
// =============================================

const DiscoveryService = (() => {
  const KEY         = 'discoveries';
  const FATIGUE_KEY = 'search_fatigue';

  function _getAll()       { return StorageService.get(KEY) || {}; }
  function _saveAll(data)  { StorageService.set(KEY, data); }
  function _forPlayer(pid) { return _getAll()[pid] || []; }

  // ── Tile depletion (storage key is still 'search_fatigue') ────
  // Keyed by TILE ("x,y"), not by lord — it used to hold per-lord daily counts
  // driving a punishing duration ladder. Resets at midnight (UTC date key).
  // Legacy lord-keyed rows read as unknown tiles (count 0) and age out on the
  // next rollover, so no migration is needed.
  function _todayKey()  { return new Date().toISOString().slice(0, 10); }
  function _getFatigue(){ return StorageService.get(FATIGUE_KEY) || {}; }

  // Expedition duration is now the player's CHOICE, not a fatigue penalty —
  // see DiscoveryRoll.LENGTHS. This is display-only; lord-action.js is
  // authoritative and applies the same class/talent multiplier server-side.
  function getSearchDuration(lengthId) {
    return DiscoveryRoll.lengthOf(lengthId).secs;
  }

  // How many expeditions this TILE has already had today, and what fraction of
  // full value it still pays. Mirrors lord-action.js's _tileSearchCount /
  // depletionFor — the server remains authoritative; this is for showing the
  // player what a tile is still worth before they commit to it.
  function getTileSearchCount(x, y) {
    if (x == null || y == null) return 0;
    const f = _getFatigue()[`${x},${y}`];
    return (f && f.date === _todayKey()) ? f.count : 0;
  }

  function getTileDepletion(x, y) {
    return DiscoveryRoll.depletionFor(getTileSearchCount(x, y));
  }

  function incrementTileSearch(x, y) {
    if (x == null || y == null) return;
    const f     = _getFatigue();
    const today = _todayKey();
    const key   = `${x},${y}`;
    const curr  = f[key];
    f[key] = (curr && curr.date === today)
      ? { count: curr.count + 1, date: today }
      : { count: 1, date: today };
    StorageService.set(FATIGUE_KEY, f);
  }

  // ── Weighted random roll ──────────────────────────────────────
  // The roll, camp-difficulty and loot math all live in
  // js/domain/discovery-roll.js (DiscoveryRoll) — THE single source of truth,
  // shared verbatim with the server via server/engine-loader.js. These used to
  // be a hand-maintained copy here mirrored by a second copy in
  // server/tick/catch-up.js, and the two had already drifted apart on loot
  // rounding. Do not re-inline them.

  // ── Public API ────────────────────────────────────────────────
  //
  // NOTE ON WHAT'S GONE (2026-07-29, expedition rework):
  // This module used to own a client-side search() that rolled a discovery and
  // stored a RECORD — most importantly a combat "camp" the player could later
  // attack from the map, or hire mercenaries from. All of that is retired:
  //   · the roll is server-authoritative (server/tick/catch-up.js)
  //   · combat finds resolve IMMEDIATELY as an ambush, so no camp is ever
  //     written; there is nothing left to attack or negotiate with
  //   · mercenaries now arrive via the Recruits outcome instead of being
  //     bought from a camp
  // Removed with it: search(), claim(), negotiate() (already dead — nothing
  // ever called it) and the spawnBanditCamp() debug helper.
  //
  // getActive/expireOld/formatExpiry are KEPT deliberately: players still have
  // legacy camp records saved in Supabase from before the change, and these
  // drain them safely as they expire (24-48h). Once a database reset has
  // happened they can go too.

  // Returns all non-expired records for a player, newest first.
  function getActive(playerId) {
    const now = TimeService.now();
    return _forPlayer(playerId)
      .filter(r => r.expiresAt === null || r.expiresAt > now)
      .sort((a, b) => b.discoveredAt - a.discoveredAt);
  }

  // Purge expired records. Call when opening lord screen.
  function expireOld(playerId) {
    const now = TimeService.now();
    const all = _getAll();
    if (!all[playerId]) return;
    all[playerId] = all[playerId].filter(r => r.expiresAt === null || r.expiresAt > now);
    _saveAll(all);
  }

  // Human-readable time remaining for a record.
  function formatExpiry(record) {
    if (!record.expiresAt) return 'Permanent';
    const ms = Math.max(0, record.expiresAt - TimeService.now());
    if (ms === 0)       return 'Expired';
    const s = Math.floor(ms / 1000);
    if (s < 3600)       return `${Math.floor(s / 60)}m`;
    if (s < 86400)      return `${Math.floor(s / 3600)}h`;
    return `${Math.floor(s / 86400)}d`;
  }

  // ── Search log ────────────────────────────────────────────────
  // Persistent per-player log of every search result, dismissible by the player.
  const LOG_KEY = 'discovery_log';
  function _getLog()        { return StorageService.get(LOG_KEY) || {}; }
  function _saveLog(data)   { StorageService.set(LOG_KEY, data); }

  function addLog(playerId, entry) {
    const all = _getLog();
    if (!all[playerId]) all[playerId] = [];
    const id  = 'log_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5);
    all[playerId].unshift({ id, ...entry, loggedAt: TimeService.now() });
    if (all[playerId].length > 100) all[playerId] = all[playerId].slice(0, 100);
    _saveLog(all);
  }

  // Ingest quest_result events from an /api/sync response — quests that
  // resolved server-side while the browser was idle/closed (the dispatcher
  // already applied the gold/XP; these events carry the discovery so the
  // client can log it + notify). Populates the per-player quest log and
  // registers combat-camp records into the active discovery list.
  //
  // MUST be called from EVERY sync path (App.init login AND ServerActions'
  // syncNow) because the server CLEARS pendingDiscoveries the moment it
  // drains them into the response — whichever sync fires first is the only
  // one that ever sees them. syncNow used to ignore the events array
  // entirely, so any navigation-triggered sync silently ate the result and
  // the reward never surfaced (no log, no toast) — fixed 2026-07-27.
  //
  // Idempotent per discovery: each pendingDiscovery appears in exactly one
  // sync response, and combat records dedupe by id, so double-calls are safe.
  // Populates the per-lord quest log AND drops a "discovery" entry into the
  // Activity feed (NO toast — quests surface only in the Activity tab, by
  // design), mirroring the on-screen resolve path in lord-screen.js.
  function ingestSyncEvents(playerId, events) {
    if (!playerId || !events?.length) return 0;
    const DEFS = (typeof DISCOVERY_DEFS !== 'undefined') ? DISCOVERY_DEFS : {};
    let count = 0;
    for (const evt of events) {
      if (evt.type !== 'quest_result') continue;
      // An ambush already happened server-side — there is no camp record to
      // register and nothing to attack. It logs like any other resolved find.
      const isAmbush = !!evt.ambush;
      const isCombat = !isAmbush && evt.category === 'combat' && evt.record;

      if (isCombat) {
        const all = _getAll();
        if (!all[playerId]) all[playerId] = [];
        if (!all[playerId].some(r => r.id === evt.record.id)) all[playerId].push(evt.record);
        _saveAll(all);
      }

      // An ambush fought while the browser was closed must still land in the
      // lord's Battles tab — the quest card below promises "Full battle report
      // in the Battles tab" either way. This path used to drop evt.ambush.report
      // on the floor entirely, so an offline-resolved ambush produced a log
      // card pointing at a report that was never saved. Same helper the live
      // path uses, so both produce identical rows. (Fixed 2026-07-29.)
      if (isAmbush && evt.ambush.report && evt.lordId && typeof BattleHistoryService !== 'undefined') {
        BattleHistoryService.saveAmbush(evt.lordId, {
          report:    evt.ambush.report,
          campName:  evt.ambush.campName,
          campLevel: evt.ambush.campLevel,
          at:        evt.ambush.at,
        });
      }

      // Carry the SAME outcome markers the online path writes (see
      // lord-screen.js's _applyAmbushResult / _applyRecruitsResult), so a
      // quest resolved while the browser was closed renders identically to
      // one watched live instead of degrading to a generic "Found" card.
      addLog(playerId, {
        definitionId: evt.defId,
        tileX:    evt.record?.tileX   ?? null,
        tileY:    evt.record?.tileY   ?? null,
        terrain:  evt.record?.terrain ?? 'plains',
        rewards:  evt.rewards || [],
        recordId: isCombat ? evt.record.id : undefined,
        outcome:  isAmbush ? 'ambush' : evt.recruits ? 'recruits' : undefined,
        ambush:   isAmbush ? { won: evt.ambush.won, lordFell: evt.ambush.lordFell, campName: evt.ambush.campName } : undefined,
        recruits: evt.recruits || undefined,
        lordId:   evt.lordId   || undefined,
        lordName: evt.lordName || undefined,
      });

      // Activity-tab entry — the only notification quests produce.
      const def       = DEFS[evt.defId] || null;
      const name      = def?.name || 'A discovery';
      const rewardStr = (evt.rewards || []).filter(r => r.type !== 'xp')
        .map(r => `+${r.amount} ${r.type}`).join(', ');
      // XP is normally left out of the summary — it's the least interesting
      // line when there is loot to report. But an expedition that found
      // NOTHING still earns it, and suppressing it there left the entry with
      // no detail at all, reading as a wasted trip.
      const xpAmount = (evt.rewards || []).find(r => r.type === 'xp')?.amount || 0;
      const xpStr    = xpAmount > 0 ? `+${xpAmount} XP for the expedition` : null;
      if (typeof ActivityService !== 'undefined') {
        ActivityService.log(playerId, {
          type:  'discovery',
          icon:  def?.icon || '🔍',
          title: isAmbush ? `Ambushed at ${evt.ambush.campName || name} — ${evt.ambush.won ? 'victory' : 'defeat'}`
               : evt.recruits ? (evt.recruits.joined > 0
                   ? `${evt.recruits.count}× ${evt.recruits.unitName} joined your army`
                   : `${evt.recruits.count}× ${evt.recruits.unitName} refused to join`)
               : isCombat ? `${name} discovered`
               : evt.category === 'nothing' ? `${evt.lordName || 'Your lord'}'s search found nothing`
               : `${name} claimed`,
          detail: isAmbush ? (evt.ambush.lordFell ? 'Your lord fell and is recovering'
                            : evt.ambush.won      ? (rewardStr || 'No spoils')
                            :                       'Your army was driven off')
                : evt.recruits ? (evt.recruits.lost > 0
                    ? `${evt.recruits.joined} joined · ${evt.recruits.lost} turned away — army at ${evt.recruits.armyPwr}/${evt.recruits.cap} PWR`
                    : `${evt.recruits.tierLabel} tier · army at ${evt.recruits.armyPwr}/${evt.recruits.cap} PWR`)
                : isCombat ? `Hostile camp at (${evt.record.tileX}, ${evt.record.tileY}) — attack from the map`
                : rewardStr || xpStr || null,
          // lordId drives the Activity screen's "View quest" button — without
          // it the entry can only fall back to matching on lordName.
          lordId:   evt.lordId   || null,
          lordName: evt.lordName || '',
        });
      }
      count++;
    }
    return count;
  }

  function getLog(playerId) {
    return (_getLog()[playerId] || []);
  }

  function dismissLog(playerId, logId) {
    const all = _getLog();
    if (!all[playerId]) return;
    all[playerId] = all[playerId].filter(e => e.id !== logId);
    _saveLog(all);
  }

  // Clears only THIS lord's entries from the player's log — the log itself
  // is stored per-player (see file header), shared across all of a
  // player's lords, so a blind wipe would also erase other lords' history.
  function clearLog(playerId, lordId) {
    const all = _getLog();
    if (!all[playerId]) return;
    all[playerId] = all[playerId].filter(e => e.lordId !== lordId);
    _saveLog(all);
  }

  // Per-lord "seen since" timestamps, keyed { [playerId]: { [lordId]: ts } } —
  // each lord's Quests tab has its own log and its own unseen badge, so a
  // single per-player timestamp would mark lord B's entries seen just from
  // opening lord A's tab. _seenMap tolerates the old per-player-only shape
  // (a bare number) from before this was split per lord, treating it as
  // "nothing seen yet" rather than throwing on the type mismatch.
  const META_KEY = 'disc_log_meta';
  function _seenMap(meta, playerId) {
    const v = meta[playerId];
    return (v && typeof v === 'object') ? v : {};
  }
  function markLogSeen(playerId, lordId) {
    const meta = StorageService.get(META_KEY) || {};
    meta[playerId] = { ..._seenMap(meta, playerId), [lordId]: TimeService.now() };
    StorageService.set(META_KEY, meta);
  }

  function getUnseenCount(playerId, lordId) {
    const meta  = StorageService.get(META_KEY) || {};
    const since = _seenMap(meta, playerId)[lordId] || 0;
    return getLog(playerId).filter(e => e.lordId === lordId && e.loggedAt > since).length;
  }

  return {
    getActive, expireOld, formatExpiry,
    addLog, ingestSyncEvents, getLog, dismissLog, clearLog, markLogSeen, getUnseenCount,
    getSearchDuration, getTileSearchCount, getTileDepletion, incrementTileSearch,
  };
})();
