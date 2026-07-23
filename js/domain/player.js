// =============================================
//  player.js — Registration, login, session
//
//  Uses StorageService for persistence.
//  The API contract (register/login/getSession) stays
//  identical when swapping to a real backend — only the
//  implementation changes, not the callers.
// =============================================

const PlayerService = (() => {
  const PLAYERS_KEY = 'players';   // { [id]: PlayerRecord }
  const SESSION_KEY = 'session';   // { playerId }

  // --- Private -------------------------------------------------

  function _getAll() {
    return StorageService.get(PLAYERS_KEY) || {};
  }

  function _saveAll(players) {
    StorageService.set(PLAYERS_KEY, players);
  }

  // Simple hash for local-only auth. NOT cryptographically secure.
  // Replace with a proper backend hash (bcrypt/argon2) when adding a server.
  function _hash(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) {
      h = (h * 33) ^ str.charCodeAt(i);
    }
    return (h >>> 0).toString(16);
  }

  function _generateId() {
    return 'p_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
  }

  function _setSession(playerId) {
    StorageService.set(SESSION_KEY, { playerId });
  }

  // --- Public --------------------------------------------------

  function register(username, password) {
    const u = (username || '').trim();
    if (u.length < 3) return { ok: false, error: 'Username must be at least 3 characters.' };
    if (!password || password.length < 4) return { ok: false, error: 'Password must be at least 4 characters.' };

    const players = _getAll();
    const taken = Object.values(players).some(p => p.username.toLowerCase() === u.toLowerCase());
    if (taken) return { ok: false, error: 'Username already taken.' };

    const player = {
      id:           _generateId(),
      username:     u,
      passwordHash: _hash(password),
      createdAt:    TimeService.now(),
      lordId:       null,
      coins:        600,
      credits:      0,
      honorPoints:  0,
    };

    players[player.id] = player;
    _saveAll(players);
    _setSession(player.id);

    return { ok: true, player };
  }

  function login(username, password) {
    const u = (username || '').trim();
    const players = _getAll();
    const player = Object.values(players).find(p => p.username.toLowerCase() === u.toLowerCase());

    if (!player) return { ok: false, error: 'Account not found.' };
    if (player.passwordHash !== _hash(password)) return { ok: false, error: 'Incorrect password.' };

    _setSession(player.id);
    return { ok: true, player };
  }

  function logout() {
    StorageService.remove(SESSION_KEY);
  }

  // Returns the full player record for the active session, or null if not logged in.
  function getSession() {
    const session = StorageService.get(SESSION_KEY);
    if (!session) return null;
    return _getAll()[session.playerId] || null;
  }

  // Patch a player record (e.g. after attaching a lord).
  function update(playerId, patch) {
    const players = _getAll();
    if (!players[playerId]) return false;
    players[playerId] = { ...players[playerId], ...patch };
    _saveAll(players);
    return true;
  }

  function getById(playerId) {
    return _getAll()[playerId] || null;
  }

  function spendCoins(playerId, amount) {
    const players = _getAll();
    const p = players[playerId];
    if (!p) return { ok: false, error: 'Player not found.' };
    if ((p.coins || 0) < amount) return { ok: false, error: `Not enough coins. Need ${amount}, have ${p.coins || 0}.` };
    players[playerId].coins = (p.coins || 0) - amount;
    _saveAll(players);
    return { ok: true, remaining: players[playerId].coins };
  }

  function spendCredits(playerId, amount) {
    const players = _getAll();
    const p = players[playerId];
    if (!p) return { ok: false, error: 'Player not found.' };
    if ((p.credits || 0) < amount) return { ok: false, error: `Not enough credits. Need ${amount}💎, have ${p.credits || 0}💎.` };
    players[playerId].credits = (p.credits || 0) - amount;
    _saveAll(players);
    return { ok: true, remaining: players[playerId].credits };
  }

  return { register, login, logout, getSession, update, getById, spendCoins, spendCredits };
})();
