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

  // NOTE: returns a SINGLE merged player object — unlike _mergeLord above,
  // which returns the whole lords MAP. Callers must slot it into the players
  // map by id (players[p.id] = _mergePlayer(p)) before hydrating; assigning
  // it straight to patch.players replaces the entire map with one player and
  // corrupts local state (getSession/getById then return null). Bit the three
  // raid endpoints once — kept symmetric with every other endpoint now.
  //
  // Defense-in-depth for a server-returned player object: honorPoints lives
  // in its own Supabase key (see combat-resolver.js/pve-attack.js), not the
  // 'players' blob these action responses come from, so action-base.js
  // stamps it on server-side before returning. If some future/overlooked
  // endpoint ever forgets that, a raw full-replace here would silently wipe
  // the locally cached honor back to 0 — this falls back to whatever's
  // already cached locally instead of trusting an absent field.
  function _mergePlayer(serverPlayer) {
    const players = StorageService.get('players') || {};
    const local   = players[serverPlayer.id];
    return { ...serverPlayer, honorPoints: serverPlayer.honorPoints ?? local?.honorPoints ?? 0 };
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
        players[result.player.id] = _mergePlayer(result.player);
        patch.players            = players;
      }
      if (Object.keys(patch).length > 0) StorageService.hydrate(patch);
    }
    return result;
  }

  // POST /api/attack/incoming
  // Derived list of enemy attack-marches heading at this player's tiles.
  // Read-only — no local state hydration.
  async function checkIncomingAttacks() {
    return _post('/api/attack/incoming', {});
  }

  // POST /api/research/start — begin researching a Library book.
  // POST /api/research/instant — finish the active research with credits.
  // Both hydrate the player (resources/credits/research state changed).
  async function researchStart(bookId) {
    const result = await _post('/api/research/start', { bookId });
    if (result.ok && result.player) {
      const players             = StorageService.get('players') || {};
      players[result.player.id] = _mergePlayer(result.player);
      StorageService.hydrate({ players });
    }
    return result;
  }

  async function researchInstant() {
    const result = await _post('/api/research/instant', {});
    if (result.ok && result.player) {
      const players             = StorageService.get('players') || {};
      players[result.player.id] = _mergePlayer(result.player);
      StorageService.hydrate({ players });
    }
    return result;
  }

  // POST /api/blessing/consecrate — consecrate a Temple blessing.
  // Pays a gold offering and (re)starts the single active blessing.
  // Hydrates the player (coins + activeBlessing changed).
  async function blessingConsecrate(blessingId) {
    const result = await _post('/api/blessing/consecrate', { blessingId });
    if (result.ok && result.player) {
      const players             = StorageService.get('players') || {};
      players[result.player.id] = _mergePlayer(result.player);
      StorageService.hydrate({ players });
    }
    return result;
  }

  // POST /api/city/demolish
  // Tears down one level of a building (instant, no refund).
  // On success, hydrates city + player from server response.
  async function demolish(cityId, buildingId) {
    const result = await _post('/api/city/demolish', { cityId, buildingId });
    if (result.ok) {
      const patch = {};
      if (result.city) {
        const cities   = StorageService.get('cities') || {};
        cities[cityId] = result.city;
        patch.cities   = cities;
      }
      if (result.player) {
        const players             = StorageService.get('players') || {};
        players[result.player.id] = _mergePlayer(result.player);
        patch.players             = players;
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
        players[result.player.id] = _mergePlayer(result.player);
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
      const patch = { lords: _mergeLord(result.lord) };
      if (result.player) {
        // March food cost was deducted server-side — reflect it right away.
        const players             = StorageService.get('players') || {};
        players[result.player.id] = _mergePlayer(result.player);
        patch.players             = players;
      }
      StorageService.hydrate(patch);
      HUD.refresh();
    }
    return result;
  }

  // POST /api/lord/action  (action: 'search_area')
  // Enqueues an expedition and depletes the tile server-side. `length` is
  // 'short' | 'standard' | 'long' — the player's bet on duration vs payout vs
  // risk (DiscoveryRoll.LENGTHS). Omitted → the server defaults to Standard.
  // On success, hydrates lords from server response.
  async function lordSearch(lordId, length) {
    const result = await _post('/api/lord/action', { lordId, action: 'search_area', length });
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
  // The portrait is rolled server-side too (see actions/lord-create.js).
  // On success, hydrates lords + player from server response.
  async function createLord(name, classId, cityId) {
    const result = await _post('/api/lord/create', { name, classId, cityId });
    if (result.ok) {
      const patch = {};
      if (result.lord) {
        const lords          = StorageService.get('lords') || {};
        lords[result.lord.id] = result.lord;
        patch.lords          = lords;
      }
      if (result.player) {
        const players                     = StorageService.get('players') || {};
        players[result.player.id]         = _mergePlayer(result.player);
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
        players[result.player.id]     = _mergePlayer(result.player);
        patch.players                 = players;
      }
      if (Object.keys(patch).length > 0) StorageService.hydrate(patch);
    }
    return result;
  }

  // hireMerc() lived here — it bought a mercenary from a discovered bandit
  // camp. Camps are retired and mercenaries now JOIN via the expedition
  // Recruits outcome (gated by Expedition Rating, not gold), so the wrapper,
  // the /api/lord/hire-merc endpoint and server/actions/hire-merc.js are all
  // gone. Removed 2026-07-29.

  // POST /api/lord/revive
  // Spends credits and clears lord downtime server-side.
  // Sends clientDowntimeUntil so the server can compute the cost even if
  // a battle hadn't committed the fallen state to Supabase yet.
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
        players[result.player.id] = _mergePlayer(result.player);
        patch.players = players;
      }
      if (Object.keys(patch).length > 0) StorageService.hydrate(patch);
    }
    return result;
  }

  // POST /api/lord/ransom
  // Pays the fixed, level-scaled gold ransom to free the caller's own
  // captured lord immediately. On success, hydrates lord + player.
  async function ransomLord(lordId) {
    const result = await _post('/api/lord/ransom', { lordId });
    if (result.ok) {
      const patch = {};
      if (result.lord) {
        const lords = StorageService.get('lords') || {};
        lords[result.lord.id] = result.lord;
        patch.lords = lords;
      }
      if (result.player) {
        const players = StorageService.get('players') || {};
        players[result.player.id] = _mergePlayer(result.player);
        patch.players = players;
      }
      if (Object.keys(patch).length > 0) StorageService.hydrate(patch);
    }
    return result;
  }

  // POST /api/lord/release
  // Frees a lord the caller holds captive, for free. Nothing of the
  // caller's own state changes — no hydrate patch needed, the caller's
  // Prison list just needs a fresh getPrisonList() call to reflect it.
  async function releaseLord(lordId, ownerId) {
    return _post('/api/lord/release', { lordId, ownerId });
  }

  // POST /api/lord/prison-list
  // Returns every lord currently held captive by the caller.
  async function getPrisonList() {
    return _post('/api/lord/prison-list', {});
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
        players[result.player.id] = _mergePlayer(result.player);
        patch.players             = players;
      }
      if (Object.keys(patch).length > 0) StorageService.hydrate(patch);
    }
    return result;
  }

  // POST /api/city/instant-recruit
  // Spends credits to instantly complete the first item in a city's
  // recruitment queue, server-side. Replaces the old client-only "finish
  // now" (which faked a past finishAt locally — it displayed as complete
  // but reverted on the next refresh since nothing was ever actually
  // applied or persisted server-side).
  async function instantRecruit(cityId) {
    const result = await _post('/api/city/instant-recruit', { cityId });
    if (result.ok) {
      const patch = {};
      if (result.city) {
        const cities   = StorageService.get('cities') || {};
        cities[cityId] = result.city;
        patch.cities   = cities;
      }
      if (result.army) {
        const armies                = StorageService.get('armies') || {};
        armies[result.army.lordId]  = result.army;
        patch.armies                = armies;
      }
      if (result.player) {
        const players             = StorageService.get('players') || {};
        players[result.player.id] = _mergePlayer(result.player);
        patch.players             = players;
      }
      if (Object.keys(patch).length > 0) StorageService.hydrate(patch);
    }
    return result;
  }

  // POST /api/city/cancel-build — cancel a queued construction item (by
  // queueIndex) with a full resource refund. Hydrates city + player.
  async function cancelBuild(cityId, queueIndex) {
    const result = await _post('/api/city/cancel-build', { cityId, queueIndex });
    if (result.ok) {
      const patch = {};
      if (result.city) {
        const cities   = StorageService.get('cities') || {};
        cities[cityId] = result.city;
        patch.cities   = cities;
      }
      if (result.player) {
        const players             = StorageService.get('players') || {};
        players[result.player.id] = _mergePlayer(result.player);
        patch.players             = players;
      }
      if (Object.keys(patch).length > 0) StorageService.hydrate(patch);
    }
    return result;
  }

  // POST /api/city/cancel-recruit — cancel a queued recruitment batch (by
  // queueIndex) with a full gold refund. Hydrates city + player.
  async function cancelRecruit(cityId, queueIndex) {
    const result = await _post('/api/city/cancel-recruit', { cityId, queueIndex });
    if (result.ok) {
      const patch = {};
      if (result.city) {
        const cities   = StorageService.get('cities') || {};
        cities[cityId] = result.city;
        patch.cities   = cities;
      }
      if (result.player) {
        const players             = StorageService.get('players') || {};
        players[result.player.id] = _mergePlayer(result.player);
        patch.players             = players;
      }
      if (Object.keys(patch).length > 0) StorageService.hydrate(patch);
    }
    return result;
  }

  // POST /api/lord/cancel-action — cancel a lord's in-progress action
  // (attack/march/search/scout). No refund. Hydrates the lord.
  async function cancelLordAction(lordId) {
    const result = await _post('/api/lord/cancel-action', { lordId });
    if (result.ok && result.lord) {
      StorageService.hydrate({ lords: _mergeLord(result.lord) });
    }
    return result;
  }

  // pveAttack() lived here — it posted to /api/lord/pve-attack to fight a
  // bandit camp the player had discovered. Both the wrapper and the endpoint
  // are gone: a combat expedition find is now resolved as an ambush the moment
  // it happens (server/tick/catch-up.js), so there is no camp to go and
  // attack. Removed 2026-07-29.

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
          players[result.player.id] = _mergePlayer(result.player);
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
      players[result.player.id] = _mergePlayer(result.player);
      StorageService.hydrate({ players });
    }
    return result;
  }

  // POST /api/army/disband
  // Removes 1 model from the stack server-side.
  // modelIdx: 0 = front (possibly damaged) model, 1+ = healthy models.
  async function disbandUnit(lordId, unitId, modelIdx = 0) {
    const result = await _post('/api/army/disband', { lordId, unitId, modelIdx });
    if (result.ok) {
      const patch = {};
      if (result.army) {
        const armies               = StorageService.get('armies') || {};
        armies[result.army.lordId] = result.army;
        patch.armies               = armies;
      }
      // Player comes back with the HP-proportional gold refund applied
      if (result.player) {
        const players             = StorageService.get('players') || {};
        players[result.player.id] = _mergePlayer(result.player);
        patch.players             = players;
      }
      if (Object.keys(patch).length > 0) StorageService.hydrate(patch);
    }
    return result;
  }

  // POST /api/army/transfer
  // Atomic troop exchange between two of the player's lords standing on the
  // same tile. toB/toA: [{ unitId, count, damaged? }] — damaged asks for the
  // stack's wounded front model to travel too.
  async function transferUnits(lordAId, lordBId, toB, toA) {
    const result = await _post('/api/army/transfer', { lordAId, lordBId, toB, toA });
    if (result.ok && result.armyA && result.armyB) {
      const armies                = StorageService.get('armies') || {};
      armies[result.armyA.lordId] = result.armyA;
      armies[result.armyB.lordId] = result.armyB;
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
        const { state, serverTime, events } = data;
        if (serverTime) TimeService.setSkew(serverTime - Date.now());

        // Surface any events the server drained on this sync — most
        // importantly quest_result (offline-resolved quests). This USED to be
        // ignored here, so a navigation-triggered sync silently consumed the
        // discovery (the server clears pendingDiscoveries when it drains them),
        // and the reward never reached the log or a toast. Populate the quest
        // log now, and stash the events so OverviewScreen._flushSyncEvents can
        // toast them (deduped/capped there). Fixed 2026-07-27.
        if (events?.length) {
          const pid = (typeof PlayerService !== 'undefined') ? PlayerService.getSession()?.id : null;
          if (pid) DiscoveryService.ingestSyncEvents(pid, events);
          if (pid) ActivityService.ingestSyncEvents(pid, events);
          window._pendingSyncEvents = (window._pendingSyncEvents || []).concat(events);
        }

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
  // Equip (or swap) a mount. Unlocks per-tier (lv 5/8/10, see MOUNT_POOL's
  // unlockLevel); not permanent — can be re-called to swap.
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
        players[result.player.id] = _mergePlayer(result.player);
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
        players[result.player.id] = _mergePlayer(result.player);
        patch.players = players;
      }
      if (Object.keys(patch).length > 0) StorageService.hydrate(patch);
    }
    return result;
  }

  // POST /api/lord/scout-resolve
  // Called when a scout timer expires (browser open). Returns { outcome:
  // 'intel'|'pending'|'resolved_elsewhere', report? } — this endpoint does
  // the report-gathering server-side (cross-player data loadAndCatchUp's
  // single-player load can't see).
  // 'resolved_elsewhere' means the background dispatcher beat us to it.
  //
  // The client sends NOTHING but the lord id — no claim about what it already
  // knows — and the response only drives the toast. The report itself always
  // arrives via /api/sync, which is what makes scouting untamperable.
  async function scoutResolve(lordId) {
    return _post('/api/lord/scout-resolve', { lordId });
  }

  // POST /api/lord/raid-start — durationSecs must be one of
  // STANCE_DEFS.raiding.durations (server re-validates regardless).
  async function raidStart(lordId, durationSecs) {
    const result = await _post('/api/lord/raid-start', { lordId, durationSecs });
    if (result.ok) {
      const patch = {};
      if (result.lord)   patch.lords   = _mergeLord(result.lord);
      if (result.player) {
        const players             = StorageService.get('players') || {};
        players[result.player.id] = _mergePlayer(result.player);
        patch.players             = players;
      }
      if (Object.keys(patch).length > 0) StorageService.hydrate(patch);
    }
    return result;
  }

  // POST /api/lord/raid-cancel — free, forfeits everything accrued so far.
  async function raidCancel(lordId) {
    const result = await _post('/api/lord/raid-cancel', { lordId });
    if (result.ok) {
      const patch = {};
      if (result.lord)   patch.lords   = _mergeLord(result.lord);
      if (result.player) {
        const players             = StorageService.get('players') || {};
        players[result.player.id] = _mergePlayer(result.player);
        patch.players             = players;
      }
      if (Object.keys(patch).length > 0) StorageService.hydrate(patch);
    }
    return result;
  }

  // POST /api/lord/raid-instant — spends credits to pay out the full raid
  // immediately (same cost formula as instantLordAction).
  async function raidInstant(lordId) {
    const result = await _post('/api/lord/raid-instant', { lordId });
    if (result.ok) {
      const patch = {};
      if (result.lord)   patch.lords   = _mergeLord(result.lord);
      if (result.player) {
        const players             = StorageService.get('players') || {};
        players[result.player.id] = _mergePlayer(result.player);
        patch.players             = players;
      }
      if (result.army) {
        const armies = StorageService.get('armies') || {};
        armies[result.army.lordId] = result.army;
        patch.armies = armies;
      }
      if (Object.keys(patch).length > 0) StorageService.hydrate(patch);
    }
    return result;
  }

  // POST /api/clan/create — { name, tag }
  async function clanCreate(name, tag) {
    const result = await _post('/api/clan/create', { name, tag });
    if (result.ok && result.player) {
      const players = StorageService.get('players') || {};
      players[result.player.id] = _mergePlayer(result.player);
      StorageService.hydrate({ players });
    }
    return result;
  }

  // POST /api/clan/apply — { clanId } — adds caller to the clan's pending list
  async function clanApply(clanId) {
    return _post('/api/clan/apply', { clanId });
  }

  // POST /api/clan/accept — { targetPlayerId } — leader-only
  async function clanAccept(targetPlayerId) {
    return _post('/api/clan/accept', { targetPlayerId });
  }

  // POST /api/clan/reject — { targetPlayerId } — leader-only
  async function clanReject(targetPlayerId) {
    return _post('/api/clan/reject', { targetPlayerId });
  }

  // POST /api/clan/leave
  async function clanLeave() {
    const result = await _post('/api/clan/leave', {});
    if (result.ok && result.player) {
      const players = StorageService.get('players') || {};
      players[result.player.id] = _mergePlayer(result.player);
      StorageService.hydrate({ players });
    }
    return result;
  }

  // POST /api/clan/kick — { targetPlayerId } — leader-only
  async function clanKick(targetPlayerId) {
    return _post('/api/clan/kick', { targetPlayerId });
  }

  // POST /api/clan/list — every clan, for browsing + finding your own roster
  async function clanList() {
    return _post('/api/clan/list', {});
  }

  // POST /api/clan/war-declare — { targetClanId, durationSecs } — leader-only
  async function clanWarDeclare(targetClanId, durationSecs) {
    return _post('/api/clan/war-declare', { targetClanId, durationSecs });
  }

  return { build, demolish, checkIncomingAttacks, researchStart, researchInstant, blessingConsecrate, recruit, lordMove, lordSearch, lordScout, createLord, foundCity, reviveLord, ransomLord, releaseLord, getPrisonList, disbandUnit, transferUnits, syncNow, instantBuild, instantRecruit, cancelBuild, cancelRecruit, cancelLordAction, instantLordAction, setPlayerRace, spendTalents, spendMount, saveLordXp, questResolve, scoutResolve, raidStart, raidCancel, raidInstant, clanCreate, clanApply, clanAccept, clanReject, clanLeave, clanKick, clanList, clanWarDeclare };
})();
