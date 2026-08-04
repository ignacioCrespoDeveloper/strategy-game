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
//                | 'lord_moved' | 'action_complete' | 'raid_complete'
//                | 'scout_result'
//    icon      → emoji
//    title     → short headline
//    detail    → one-line supporting info
//    lordId    → id of the lord who triggered the event (drives the
//                "jump to this lord" button on the Activity screen)
//    lordName  → name of that lord
//    dedupeKey → optional stable key; a second log() with the same key is
//                a no-op (used by sync-event ingest, which can legitimately
//                see the same server event twice)
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
    if (entry.dedupeKey && all[playerId].some(e => e.dedupeKey === entry.dedupeKey)) return;
    const id = 'act_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5);
    all[playerId].unshift({ id, at: TimeService.now(), ...entry });
    if (all[playerId].length > MAX_PER) all[playerId] = all[playerId].slice(0, MAX_PER);
    _saveAll(all);
    EventBus.emit('activity:added', { playerId });
  }

  function get(playerId) {
    return _getAll()[playerId] || [];
  }

  function remove(playerId, entryId) {
    const all = _getAll();
    if (!all[playerId]) return;
    all[playerId] = all[playerId].filter(e => e.id !== entryId);
    _saveAll(all);
  }

  function clear(playerId) {
    const all = _getAll();
    all[playerId] = [];
    _saveAll(all);
  }

  // Turn /api/sync events into feed entries. Called from BOTH sync paths
  // (App.init's login sync and ServerActions.syncNow) alongside
  // DiscoveryService.ingestSyncEvents — whichever fires first is the only one
  // that sees a given event, since the server clears the pending report the
  // moment it drains it.
  //
  // Handles two event types, both of which are the ONLY report their action
  // ever produces once it resolves off-screen:
  //   raid_complete — a Raiding stance that reached its finish time and paid
  //                   out (server/tick/catch-up.js). The payout is already
  //                   applied to player state by then; this is purely the
  //                   notification.
  //   scout_result  — a scout the server resolved (combat-resolver.js's
  //                   resolveScout). The event CARRIES the whole report, and
  //                   the feed entry is where it comes to rest: there is no
  //                   separate intel store, so the entry itself is the intel.
  //                   Re-scout to refresh it; dismiss it and it's gone.
  // dedupeKey makes a double-ingest harmless in both cases.
  const _RES_ICON = { gold: 'two-coins', wood: 'wood-pile', stone: 'war-pick', food: 'wheat' };

  // ── Scout report ──────────────────────────────────────────────
  //
  // One-line summary for the collapsed feed row. The full report (garrison,
  // armies, plunder) is kept on the entry as `scoutReport` and rendered by
  // activity-screen.js when the row is expanded.
  function scoutSummary(report) {
    if (!report) return '';
    const parts = [];
    if (report.city) {
      const c = report.city;
      parts.push(`${c.name}${c.ownerUsername ? ` (${c.ownerUsername})` : ''} — garrison ${c.garrisonCount}`);
    }
    (report.lords || []).forEach(l => {
      parts.push(`${l.lordName || 'Lord'} Lv${l.lordLevel} — ${l.armyCount} troops`);
    });
    const where = report.tileX != null ? `(${report.tileX}, ${report.tileY})` : '';
    if (!parts.length) return `${where} · nothing on this tile`;
    return `${where} · ${parts.join(' · ')}`;
  }

  function scoutIsEmpty(report) {
    return !report || (!report.city && !(report.lords || []).length);
  }

  function ingestSyncEvents(playerId, events) {
    if (!playerId || !events?.length) return 0;
    let count = 0;
    for (const evt of events) {
      if (evt.type === 'raid_complete') {
        const gold  = evt.goldEarned || 0;
        const res   = evt.resources  || {};
        const parts = [`+${gold}${gi(_RES_ICON.gold)}`];
        ['wood', 'stone', 'food'].forEach(r => {
          if (res[r] > 0) parts.push(`+${res[r]}${gi(_RES_ICON[r])}`);
        });
        const dur = evt.durationSecs
          ? ` · ${TimeService.formatDuration(evt.durationSecs)} raid`
          : '';
        log(playerId, {
          type:      'raid_complete',
          icon:      gi('black-flag'),
          title:     `${evt.lordName || 'Your lord'} finished raiding`,
          detail:    `Plunder: ${parts.join(' · ')}${dur}`,
          lordId:    evt.lordId   || null,
          lordName:  evt.lordName || '',
          dedupeKey: evt.id || `raid_${evt.lordId}_${evt.at || ''}`,
          // The raid's own finish time (catch-up.js stamps it off
          // stance.finishAt), not this sync's. log() spreads the entry over its
          // `at: now` default, so passing it here is what files a raid that
          // paid out overnight under the hour it actually ended.
          ...(evt.at ? { at: evt.at } : {}),
        });
        count++;
      } else if (evt.type === 'scout_result') {
        // The report travels whole and is stored whole. `scoutReport` is what
        // the expanded row renders, and what the attack screen reads back when
        // you go to act on it — this entry IS the intel, there is no pool.
        const report = { tileX: evt.tileX, tileY: evt.tileY, city: evt.city || null, lords: evt.lords || [] };
        log(playerId, {
          type:        'scout_result',
          icon:        gi('spy'),
          title:       scoutIsEmpty(report) ? 'Scout found nothing' : 'Scout report',
          detail:      scoutSummary(report),
          scoutReport: report,
          tileX:       evt.tileX,
          tileY:       evt.tileY,
          lordId:      evt.lordId   || null,
          lordName:    evt.lordName || '',
          dedupeKey:   evt.id || `scout_${evt.lordId}_${evt.at || ''}`,
          // When the scout reported in, not when we collected it — same reason
          // as the raid branch above. latestScoutReport() surfaces this as the
          // intel's age on the attack-confirm screen, so a stale report must
          // not be able to read as fresh.
          ...(evt.at ? { at: evt.at } : {}),
        });
        count++;
      }
    }
    return count;
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

  // Most recent scout report for a tile, or null if it was never scouted (or
  // the entry has since been dismissed / aged past the 50-entry cap). The feed
  // is the only store, so "do I know what's on that tile?" is answered here —
  // used by the attack-confirm screen to show what you're walking into.
  function latestScoutReport(playerId, tileX, tileY) {
    const hit = get(playerId).find(e =>
      e.type === 'scout_result' && e.scoutReport && e.tileX === tileX && e.tileY === tileY);
    return hit ? { ...hit.scoutReport, at: hit.at } : null;
  }

  return {
    log, get, remove, clear, markSeen, getUnseenCount, ingestSyncEvents,
    scoutSummary, scoutIsEmpty, latestScoutReport,
  };
})();
