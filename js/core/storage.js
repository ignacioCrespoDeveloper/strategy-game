// =============================================
//  storage.js — Persistence abstraction
//
//  localStorage is the synchronous in-memory cache.
//  Every set() call debounces and syncs to Supabase in background.
//  On login / page-load, Supabase data hydrates localStorage.
//
//  Two tables in Supabase:
//    storage     → per-player key/value  (RLS: own rows only)
//    world_state → shared world map      (RLS: all authenticated players)
// =============================================

const StorageService = (() => {
  const PREFIX = 'realms_';

  // Only the shared world tile map is stored globally
  const WORLD_KEYS = new Set(['world']);

  // Keys managed by auth flow — never synced to DB
  const NO_SYNC = new Set(['session']);

  // Keys whose authoritative copy lives on the server.
  // Client writes these to localStorage for in-session reads,
  // but never pushes them to Supabase — only server endpoints write them.
  const SERVER_KEYS = new Set(['players', 'lords', 'cities', 'armies']);

  let _pending   = new Map(); // key → value awaiting flush
  let _syncTimer = null;

  function _key(k) { return PREFIX + k; }
  function _db()   { return SupabaseService.client; }

  // ── Core storage (synchronous — reads from local cache) ───────

  function get(key) {
    try {
      const raw = localStorage.getItem(_key(key));
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }

  function set(key, value) {
    try {
      localStorage.setItem(_key(key), JSON.stringify(value));
      if (!NO_SYNC.has(key) && !SERVER_KEYS.has(key)) _queueSync(key, value);
      return true;
    } catch { return false; }
  }

  function remove(key) {
    localStorage.removeItem(_key(key));
    if (!NO_SYNC.has(key)) _deleteRemote(key);
  }

  function clearAll() {
    Object.keys(localStorage)
      .filter(k => k.startsWith(PREFIX))
      .forEach(k => localStorage.removeItem(k));
  }

  // ── Hydration (Supabase → localStorage, no sync triggered) ────

  function hydrate(serverData) {
    Object.entries(serverData || {}).forEach(([key, value]) => {
      try {
        localStorage.setItem(_key(key), JSON.stringify(value));
      } catch {}
    });
  }

  // ── Sync engine ───────────────────────────────────────────────

  function _queueSync(key, value) {
    _pending.set(key, value);
    if (_syncTimer) clearTimeout(_syncTimer);
    _syncTimer = setTimeout(_flushSync, 500);
  }

  async function _flushSync() {
    if (_pending.size === 0) return;

    const { data: { session } } = await _db().auth.getSession();
    if (!session) return;

    const writes = [..._pending.entries()];
    _pending.clear();

    const worldWrites  = writes.filter(([k]) =>  WORLD_KEYS.has(k));
    const playerWrites = writes.filter(([k]) => !WORLD_KEYS.has(k));

    const ops = [];

    if (worldWrites.length > 0) {
      ops.push(
        _db().from('world_state').upsert(
          worldWrites.map(([key, value]) => ({ key, value, updated_at: new Date().toISOString() }))
        )
      );
    }

    if (playerWrites.length > 0) {
      ops.push(
        _db().from('storage').upsert(
          playerWrites.map(([key, value]) => ({ player_id: session.user.id, key, value }))
        )
      );
    }

    const results = await Promise.all(ops);
    results.forEach(({ error }) => {
      if (error) console.warn('[StorageService] sync error:', error.message);
    });
  }

  async function _deleteRemote(key) {
    const { data: { session } } = await _db().auth.getSession();
    if (!session) return;

    if (WORLD_KEYS.has(key)) {
      _db().from('world_state').delete().eq('key', key).then(() => {});
    } else {
      _db().from('storage').delete()
        .eq('player_id', session.user.id).eq('key', key).then(() => {});
    }
  }

  return { get, set, remove, clearAll, hydrate };
})();
