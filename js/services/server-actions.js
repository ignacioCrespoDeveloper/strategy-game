// =============================================
//  server-actions.js — Client-side async wrappers
//  for the authoritative server action endpoints.
//
//  Each method:
//    1. Gets the current Supabase session token
//    2. POSTs to the server endpoint
//    3. On success: calls StorageService.hydrate()
//       with the updated state returned by the server
//    4. Returns { ok, error? } so callers can show errors
// =============================================

const ServerActions = (() => {

  async function _token() {
    const { data: { session } } = await SupabaseService.client.auth.getSession();
    return session?.access_token || null;
  }

  async function _post(path, body) {
    const token = await _token();
    if (!token) return { ok: false, error: 'Not logged in' };

    const res = await fetch(path, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': 'Bearer ' + token,
      },
      body: JSON.stringify(body),
    });

    const json = await res.json().catch(() => ({ ok: false, error: 'Invalid server response' }));
    return { status: res.status, ...json };
  }

  // POST /api/city/build
  // Enqueues a building construction.
  // On success, hydrates city from server response.
  async function build(cityId, buildingId) {
    const result = await _post('/api/city/build', { cityId, buildingId });
    if (result.ok) {
      const patch = {};
      if (result.city) {
        const cities   = StorageService.get('cities') || {};
        cities[cityId] = result.city;
        patch.cities   = cities;
      }
      if (result.player) {
        const players            = StorageService.get('players') || {};
        players[result.player.id] = result.player;
        patch.players            = players;
      }
      if (Object.keys(patch).length > 0) StorageService.hydrate(patch);
    }
    return result;
  }

  // POST /api/city/recruit
  // Enqueues a unit training batch.
  // On success, hydrates city + player from server response.
  async function recruit(lordId, cityId, unitId, count = 1) {
    const result = await _post('/api/city/recruit', { lordId, cityId, unitId, count });
    if (result.ok) {
      const patch = {};
      if (result.city) {
        const cities   = StorageService.get('cities') || {};
        cities[cityId] = result.city;
        patch.cities   = cities;
      }
      if (result.player) {
        const players        = StorageService.get('players') || {};
        players[result.player.id] = result.player;
        patch.players        = players;
      }
      if (Object.keys(patch).length > 0) StorageService.hydrate(patch);
    }
    return result;
  }

  // POST /api/lord/action  (action: 'move')
  // Enqueues a lord movement action.
  // On success, hydrates lords from server response.
  async function lordMove(lordId, destX, destY, opts = {}) {
    const result = await _post('/api/lord/action', {
      lordId,
      action: 'move',
      destX,
      destY,
      intent: opts.intent || null,
    });
    if (result.ok && result.lord) {
      const lords        = StorageService.get('lords') || {};
      lords[result.lord.id] = result.lord;
      StorageService.hydrate({ lords });
    }
    return result;
  }

  // POST /api/lord/action  (action: 'search_area')
  // Enqueues a search_area action and increments fatigue server-side.
  // On success, hydrates lords from server response.
  async function lordSearch(lordId) {
    const result = await _post('/api/lord/action', { lordId, action: 'search_area' });
    if (result.ok && result.lord) {
      const lords        = StorageService.get('lords') || {};
      lords[result.lord.id] = result.lord;
      StorageService.hydrate({ lords });
    }
    return result;
  }

  // POST /api/lord/create
  // Creates a new lord server-side (validates globally unique name, deducts cost).
  // On success, hydrates lords + player from server response.
  async function createLord(name, raceId, classId, cityId) {
    const result = await _post('/api/lord/create', { name, raceId, classId, cityId });
    if (result.ok) {
      const patch = {};
      if (result.lord) {
        const lords          = StorageService.get('lords') || {};
        lords[result.lord.id] = result.lord;
        patch.lords          = lords;
      }
      if (result.player) {
        const players                     = StorageService.get('players') || {};
        players[result.player.id]         = result.player;
        patch.players                     = players;
      }
      if (Object.keys(patch).length > 0) StorageService.hydrate(patch);
    }
    return result;
  }

  // POST /api/city/found
  // Founds a new city server-side (validates tile, deducts cost).
  // On success, hydrates cities + lords + player from server response.
  async function foundCity(name, x, y) {
    const result = await _post('/api/city/found', { name, x, y });
    if (result.ok) {
      const patch = {};
      if (result.city) {
        const cities           = StorageService.get('cities') || {};
        cities[result.city.id] = result.city;
        patch.cities           = cities;
      }
      if (result.player) {
        const players                 = StorageService.get('players') || {};
        players[result.player.id]     = result.player;
        patch.players                 = players;
      }
      if (Object.keys(patch).length > 0) StorageService.hydrate(patch);
    }
    return result;
  }

  // POST /api/lord/hire-merc
  // Instantly hires a mercenary unit server-side.
  // On success, hydrates army + player from server response.
  async function hireMerc(lordId, unitId) {
    const result = await _post('/api/lord/hire-merc', { lordId, unitId });
    if (result.ok) {
      const patch = {};
      if (result.army) {
        const armies           = StorageService.get('armies') || {};
        armies[result.army.lordId] = result.army;
        patch.armies           = armies;
      }
      if (result.player) {
        const players             = StorageService.get('players') || {};
        players[result.player.id] = result.player;
        patch.players             = players;
      }
      if (Object.keys(patch).length > 0) StorageService.hydrate(patch);
    }
    return result;
  }

  // POST /api/lord/revive
  // Spends credits and clears lord downtime server-side.
  async function reviveLord(lordId) {
    const result = await _post('/api/lord/revive', { lordId });
    if (result.ok) {
      const patch = {};
      if (result.lord) {
        const lords = StorageService.get('lords') || {};
        lords[result.lord.id] = result.lord;
        patch.lords = lords;
      }
      if (result.player) {
        const players = StorageService.get('players') || {};
        players[result.player.id] = result.player;
        patch.players = players;
      }
      if (Object.keys(patch).length > 0) StorageService.hydrate(patch);
    }
    return result;
  }

  // POST /api/city/instant-build
  // Spends credits to instantly complete the first queue item server-side.
  // On success, hydrates city + player from server response.
  async function instantBuild(cityId) {
    const result = await _post('/api/city/instant-build', { cityId });
    if (result.ok) {
      const patch = {};
      if (result.city) {
        const cities   = StorageService.get('cities') || {};
        cities[cityId] = result.city;
        patch.cities   = cities;
      }
      if (result.player) {
        const players             = StorageService.get('players') || {};
        players[result.player.id] = result.player;
        patch.players             = players;
      }
      if (Object.keys(patch).length > 0) StorageService.hydrate(patch);
    }
    return result;
  }

  // POST /api/army/disband
  // Removes 1 model from the stack server-side.
  // modelIdx: 0 = front (possibly damaged) model, 1+ = healthy models.
  async function disbandUnit(lordId, unitId, modelIdx = 0) {
    const result = await _post('/api/army/disband', { lordId, unitId, modelIdx });
    if (result.ok && result.army) {
      const armies = StorageService.get('armies') || {};
      armies[result.army.lordId] = result.army;
      StorageService.hydrate({ armies });
    }
    return result;
  }

  // Calls /api/sync and hydrates localStorage with the fresh server state.
  // Used by countdown timers when a queue item completes, so the server
  // writes the completion to Supabase immediately (instead of waiting for next login).
  async function syncNow() {
    try {
      const token = await _token();
      if (!token) return;
      const res = await fetch('/api/sync', {
        method:  'POST',
        headers: { Authorization: 'Bearer ' + token },
      });
      if (res.ok) {
        const { state } = await res.json();
        if (state) StorageService.hydrate(state);
      }
    } catch (_) {
      // Non-fatal — local state is still correct for current session
    }
  }

  return { build, recruit, lordMove, lordSearch, createLord, foundCity, hireMerc, reviveLord, disbandUnit, syncNow, instantBuild };
})();
