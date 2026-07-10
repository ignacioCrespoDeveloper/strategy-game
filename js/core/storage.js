// =============================================
//  storage.js — Persistence abstraction
//
//  All reads/writes go through this service.
//  To replace localStorage with a real backend:
//    1. Implement the same interface backed by fetch/async.
//    2. Make get/set return Promises.
//    3. Update callers to await them.
//  No other files need to change.
// =============================================

const StorageService = (() => {
  const PREFIX = 'realms_';

  function _key(k) {
    return PREFIX + k;
  }

  function get(key) {
    try {
      const raw = localStorage.getItem(_key(key));
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function set(key, value) {
    try {
      localStorage.setItem(_key(key), JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  }

  function remove(key) {
    localStorage.removeItem(_key(key));
  }

  // Wipes all keys belonging to this app (useful for dev reset).
  function clearAll() {
    Object.keys(localStorage)
      .filter(k => k.startsWith(PREFIX))
      .forEach(k => localStorage.removeItem(k));
  }

  return { get, set, remove, clearAll };
})();
