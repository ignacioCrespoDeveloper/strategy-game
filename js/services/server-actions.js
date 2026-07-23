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

  // Merge a server-returned lord into localStorage, preserving local XP/level/baseStats
  // when they are ahead. Handles the level-up case where local XP is LOWER than server
  // (it was reset to the remainder after crossing the threshold).
  function _mergeLord(serverLord) {
    const lords    = StorageService.get('lords') || {};
    const local    = lords[serverLord.id];
    const localLvl = local?.level || 1;
    const srvLvl   = serverLord.level || 1;
    const aheadLvl = localLvl > srvLvl; // local has leveled up, server is stale

    lords[serverLord.id] = {
      ...serverLord,
      xp:           aheadLvl ? (local?.xp || 0) : Math.max(serverLord.xp || 0, local?.xp || 0),
      level:        Math.max(srvLvl, localLvl),
      xpToNext:     aheadLvl ? (local?.xpToNext || serverLord.xpToNext) : serverLord.xpToNext,
      talentPoints: Math.max(serverLord.talentPoints || 0, local?.talentPoints || 0),
      baseStats:    aheadLvl ? (local?.baseStats || serverLord.baseStats) : serverLord.baseStats,
    };
    return lords;
  }

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
      StorageService.hydrate({ lords: _mergeLord(result.lord) });
    }
    return result;
  }

  // POST /api/lord/action  (action: 'search_area')
  // Enqueues a search_area action and increments fatigue server-side.
  // On success, hydrates lords from server response.
  async function lordSearch(lordId) {
    const result = await _post('/api/lord/action', { lordId, action: 'search_area' });
    if (result.ok && result.lord) {
      StorageService.hydrate({ lords: _mergeLord(result.lord) });
    }
    return result;
  }

  // POST /api/lord/action  (action: 'scout')
  // Enqueues a scout action server-side (duration scales with effective speed).
  async function lordScout(lordId) {
    const result = await _post('/api/lord/action', { lordId, action: 'scout' });
    if (result.ok && result.lord) {
      StorageService.hydrate({ lords: _mergeLord(result.lord) });
    }
    return result;
  }

  // POST /api/lord/create
  // Creates a new lord server-side (validates globally unique name, deducts cost).
  // Race is read from player.race server-side — do not pass raceId.
  // On success, hydrates lords + player from server response.
  async function createLord(name, classId, cityId, portrait) {
    const result = await _post('/api/lord/create', { name, classId, cityId, portrait });
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
  // Sends clientDowntimeUntil so the server can compute the cost even if
  // savePveResult hadn't committed the fallen state to Supabase yet.
  async function reviveLord(lordId) {
    const lords     = StorageService.get('lords') || {};
    const localLord = lords[lordId];
    const result = await _post('/api/lord/revive', {
      lordId,
      clientDowntimeUntil: localLord?.downtimeUntil ?? null,
    });
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

  // POST /api/lord/pve-result
  // Persists post-battle army + lord state to Supabase right after a PvE fight.
  // Passes fallen fields (downtimeUntil, downtimeReason, actionQueue) so a refresh
  // after a defeat restores the fallen state instead of reviving the lord.
  async function savePveResult(lordId, armyUnits, lordHpAfter, fallen = {}) {
    const result = await _post('/api/lord/pve-result', { lordId, armyUnits, lordHpAfter, ...fallen });
    return result;
  }

  // POST /api/lord/instant-action
  // Spends credits server-side to instantly complete the lord's current action.
  // Returns { ok, lord, player, completedAction } on success.
  async function instantLordAction(lordId) {
    const result = await _post('/api/lord/instant-action', { lordId });
    if (result.ok) {
      const patch = {};
      if (result.lord) {
        patch.lords = _mergeLord(result.lord);
      }
      if (result.player) {
        // Only update credits (decremented server-side). Do NOT overwrite coins —
        // discovery rewards applied by _resolveSearch() live in local coins and
        // would be wiped by the server value which doesn't include them.
        const players  = StorageService.get('players') || {};
        const existing = players[result.player.id];
        if (existing) {
          players[result.player.id] = { ...existing, credits: result.player.credits };
        } else {
          players[result.player.id] = result.player;
        }
        patch.players = players;
      }
      if (Object.keys(patch).length > 0) StorageService.hydrate(patch);
    }
    return result;
  }

  // POST /api/player/set-race
  // Saves the player's chosen race to Supabase.
  // Used by the race-select screen for users who registered without one.
  // On success, hydrates player from server response.
  async function setPlayerRace(raceId) {
    const result = await _post('/api/player/set-race', { raceId });
    if (result.ok && result.player) {
      const players = StorageService.get('players') || {};
      players[result.player.id] = result.player;
      StorageService.hydrate({ players });
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

      // Capture local coins + lord XP before sync — both are applied client-side and
      // saveLordXp() is fire-and-forget, so the server may still lag behind.
      const localPlayers = StorageService.get('players') || {};
      const localCoins   = {};
      Object.entries(localPlayers).forEach(([id, p]) => { localCoins[id] = p.coins; });

      const localLords  = StorageService.get('lords') || {};
      const localLordXp = {};
      Object.entries(localLords).forEach(([id, l]) => {
        localLordXp[id] = { xp: l.xp || 0, level: l.level || 1, xpToNext: l.xpToNext || 100, talentPoints: l.talentPoints || 0, baseStats: l.baseStats || null };
      });

      const res = await fetch('/api/sync', {
        method:  'POST',
        headers: { Authorization: 'Bearer ' + token },
      });
      if (res.ok) {
        const data = await res.json();
        const { state, serverTime } = data;
        if (serverTime) TimeService.setSkew(serverTime - Date.now());
        if (state) {
          StorageService.hydrate(state);
          // Restore coins to max(local, server).
          if (state.players) {
            const players = StorageService.get('players') || {};
            let changed = false;
            Object.entries(players).forEach(([id, p]) => {
              if (localCoins[id] != null && localCoins[id] > p.coins) {
                p.coins = localCoins[id];
                changed = true;
              }
            });
            if (changed) StorageService.set('players', players);
          }
          // Restore lord XP/level/baseStats when local is ahead of server.
          // Level-up resets XP to remainder — compare by level, not raw XP value.
          if (state.lords) {
            const lords = StorageService.get('lords') || {};
            let changed = false;
            Object.entries(lords).forEach(([id, l]) => {
              const local = localLordXp[id];
              if (!local) return;
              const aheadLvl = local.level > (l.level || 1);
              if (aheadLvl) {
                l.xp           = local.xp;
                l.level        = local.level;
                l.xpToNext     = local.xpToNext;
                l.talentPoints = Math.max(l.talentPoints || 0, local.talentPoints);
                if (local.baseStats) l.baseStats = local.baseStats;
                changed = true;
              } else {
                if (local.xp           > (l.xp           || 0)) { l.xp           = local.xp;           changed = true; }
                if (local.talentPoints > (l.talentPoints  || 0)) { l.talentPoints = local.talentPoints; changed = true; }
              }
            });
            if (changed) StorageService.set('lords', lords);
          }
          return { ok: true, state };
        }
      }
    } catch (_) {
      // Non-fatal — local state is still correct for current session
    }
    return { ok: false };
  }

  // POST /api/lord/save-xp
  // Persists XP, level, and talentPoints to Supabase after quest rewards are applied client-side.
  // Fire-and-forget — does not need to hydrate since the local state is already correct.
  async function saveLordXp(lordId, lord) {
    return _post('/api/lord/save-xp', {
      lordId,
      xp:           lord.xp          || 0,
      level:        lord.level        || 1,
      xpToNext:     lord.xpToNext     || 100,
      talentPoints: lord.talentPoints || 0,
      baseStats:    lord.baseStats    || null,
    });
  }

  // POST /api/lord/talents
  // Choose a talent (talentId) and/or spend talent points on a stat (statKey + statPoints).
  // On success, hydrates lords from server response.
  async function spendTalents(lordId, opts = {}) {
    const result = await _post('/api/lord/talents', { lordId, ...opts });
    if (result.ok && result.lord) {
      const lords = StorageService.get('lords') || {};
      lords[result.lord.id] = result.lord;
      StorageService.hydrate({ lords });
    }
    return result;
  }

  // POST /api/lord/mounts
  // Equip (or swap) a mount, unlocked at level 5. Not permanent — can be re-called to swap.
  // Each swap costs gold (MOUNT_POOL[id].cost), so hydrates both lords and players.
  async function spendMount(lordId, mountId) {
    const result = await _post('/api/lord/mounts', { lordId, mountId });
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

  // POST /api/lord/quest-resolve
  // Called when a search_area timer expires (browser open). catchUp in loadAndCatchUp
  // has already rolled the discovery into lord.pendingDiscoveries[]; this endpoint
  // drains them and returns the results to show the quest popup.
  async function questResolve(lordId) {
    const result = await _post('/api/lord/quest-resolve', { lordId });
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

  // POST /api/lord/scout-resolve
  // Called when a scout timer expires (browser open). Returns { outcome:
  // 'intel'|'ambushed'|'none', discoveries?, report?, terrain? } — this
  // endpoint does the actual ambush-check + intel-gathering server-side
  // (cross-player data loadAndCatchUp's single-player load can't see).
  // knownTiers: { [lordId|cityId]: 'vague'|'clear'|'precise' } — same
  // contract as scanTile, lets the server progress tiers instead of
  // re-sending full detail every scout.
  async function scoutResolve(lordId, knownTiers) {
    return _post('/api/lord/scout-resolve', { lordId, knownTiers });
  }

  return { build, recruit, lordMove, lordSearch, lordScout, createLord, foundCity, hireMerc, reviveLord, disbandUnit, syncNow, instantBuild, savePveResult, instantLordAction, setPlayerRace, spendTalents, spendMount, saveLordXp, questResolve, scoutResolve };
})();
