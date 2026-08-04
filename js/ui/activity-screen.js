// =============================================
//  activity-screen.js — Recent activity feed page
// =============================================

const ActivityScreen = (() => {
  let _player = null;
  const _expanded = new Set(); // entry ids whose scout report is open

  // ── Scout report panel ────────────────────────────────────────
  //
  // The feed entry is the only place a scout's findings are stored, so this
  // is the full dossier, not a teaser: garrison roster, every lord's army,
  // and what taking the city would actually pay out.
  //
  // …as far as the scout got. Since 2026-08-03 the server tiers the report by
  // the Spymaster's Ledger gap between scout and target (SCOUT_INTEL_TIERS in
  // server/combat-resolver.js), so any of `garrison`, `garrisonCount`,
  // `garrisonPower`, `plunder`, `units`, `armyCount`, `armyPower` may arrive
  // as null. Each MUST render as an explicit "we could not get closer" line,
  // never as 0 or an empty roster — a zero here reads as "undefended", and a
  // player who attacks a city on that reading loses an army to a UI bug.

  function _unitLineHtml(u) {
    const def = (typeof UNIT_DEFS !== 'undefined') ? UNIT_DEFS[u.unitId] : null;
    return `
      <div class="sr-unit">
        <span class="sr-unit-name">${def?.name || u.unitId}</span>
        <span class="sr-unit-count">×${u.count}</span>
      </div>`;
  }

  function _plunderHtml(p) {
    if (!p) return '';
    const chip = (icon, val) => val > 0 ? `<span class="sr-loot">${gi(icon)} ${val.toLocaleString()}</span>` : '';
    const chips = [
      chip('two-coins', p.gold),  chip('wood-pile', p.wood),
      chip('war-pick',  p.stone), chip('wheat',     p.food),
    ].filter(Boolean).join('');
    return chips
      ? `<div class="sr-loot-row"><span class="sr-sub">If you win</span>${chips}</div>`
      : `<div class="sr-loot-row"><span class="sr-sub">If you win</span><span class="sr-empty">nothing worth taking</span></div>`;
  }

  // The line a blocked rung prints instead of a number. Says WHY, and names
  // the book — an unexplained blank is indistinguishable from a broken report.
  function _blockedHtml(what) {
    return `<div class="sr-sub sr-sub--blocked">${gi('spy')} ${what} — your spies could not get close enough. Research Spymaster's Ledger to read further.</div>`;
  }

  // A rung is present when the server sent a value; `null` means it was gated.
  const _has = v => v != null;

  function _scoutReportHtml(r) {
    if (!r) return '';

    // Strength line: head count and PWR are separate rungs, so a scout can
    // legitimately know how many without knowing how good.
    function _cityStrengthHtml(c) {
      if (!_has(c.garrisonCount)) return _blockedHtml('Garrison strength');
      const pwr = _has(c.garrisonPower) ? ` · ${c.garrisonPower} PWR` : '';
      return `<div class="sr-sub">Garrison — ${c.garrisonCount} troops${pwr}</div>`;
    }

    function _cityRosterHtml(c) {
      if (!_has(c.garrison)) return _blockedHtml('Garrison composition');
      return `<div class="sr-units">
          ${c.garrison.map(_unitLineHtml).join('') || '<div class="sr-empty">Undefended</div>'}
        </div>`;
    }

    const cityHtml = r.city ? `
      <div class="sr-block">
        <div class="sr-head">
          <span class="sr-title">${gi('guarded-tower')} ${r.city.name}</span>
          <span class="sr-sub">${r.city.ownerUsername || 'Unknown owner'} · pop ${(r.city.population || 0).toLocaleString()}</span>
        </div>
        ${_cityStrengthHtml(r.city)}
        ${_cityRosterHtml(r.city)}
        ${_has(r.city.plunder) ? _plunderHtml(r.city.plunder) : _blockedHtml('Plunder estimate')}
      </div>` : '';

    const lordsHtml = (r.lords || []).map(l => {
      const cls = (typeof LORD_CLASSES !== 'undefined') ? LORD_CLASSES[l.lordClass] : null;
      const race = (typeof RACES !== 'undefined') ? RACES[l.lordRace] : null;
      // Stance is never gated — it is the one thing a scout sees with their
      // eyes — so it hangs off the strength line when there is one and stands
      // alone when there is not.
      const stance = l.stanceName ? ` · ${l.stanceName}` : '';
      const armyHtml = _has(l.armyCount)
        ? `<div class="sr-sub">Army — ${l.armyCount} troops${_has(l.armyPower) ? ` · ${l.armyPower} PWR` : ''}${stance}</div>`
        : `${stance ? `<div class="sr-sub">${l.stanceName}</div>` : ''}${_blockedHtml('Army strength')}`;
      return `
        <div class="sr-block">
          <div class="sr-head">
            <span class="sr-title">${gi('crossed-swords')} ${l.lordName || 'Enemy lord'}</span>
            <span class="sr-sub">${l.playerUsername || 'Unknown'} · ${race?.name || ''} ${cls?.name || ''} · Lv ${l.lordLevel}</span>
          </div>
          ${armyHtml}
          ${_has(l.units)
            ? `<div class="sr-units">${l.units.map(_unitLineHtml).join('')}</div>`
            : _blockedHtml('Army composition')}
        </div>`;
    }).join('');

    if (!cityHtml && !lordsHtml) {
      return `<div class="sr-panel"><div class="sr-empty">Nothing on this tile when the scout arrived.</div></div>`;
    }
    return `<div class="sr-panel">${cityHtml}${lordsHtml}</div>`;
  }

  function _timeAgo(ms) {
    const secs = Math.floor(ms / 1000);
    if (secs < 60)          return 'just now';
    const mins = Math.floor(secs / 60);
    if (mins < 60)          return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24)         return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  }

  // Which lord screen (and tab) an entry jumps to, or null for entries that
  // aren't tied to a lord's own records. Quest and raid entries route the same
  // way battle entries always have — straight to the lord that earned them,
  // landing on the tab where the full detail lives.
  function _routeFor(e) {
    if (e.type === 'pvp_result' || (e.type || '').startsWith('battle_')) {
      return { tab: 'battles',   label: 'Report',     icon: gi('scroll-quill'),      title: 'View battle report' };
    }
    // scout_result is handled separately — its dossier expands in place.
    if (e.type === 'discovery') {
      return { tab: 'discovery', label: 'View quest', icon: gi('magnifying-glass'),  title: "Open this lord's Quests tab" };
    }
    if (e.type === 'raid_complete') {
      return { tab: 'overview',  label: 'View lord',  icon: gi('black-flag'),        title: 'Open the raiding lord' };
    }
    return null;
  }

  function _html() {
    const feed = ActivityService.get(_player.id);

    const TYPE_CSS = {
      battle_victory: 'af-victory',
      battle_defeat:  'af-defeat',
      battle_draw:    'af-draw',
      lord_captured:  'af-defeat',
      lord_fallen:    'af-defeat',
      discovery:      'af-discovery',
      scout_result:   'af-discovery',
      lord_moved:     'af-move',
      action_complete:'af-action',
      raid_complete:  'af-raid',
    };

    const content = feed.length === 0
      ? `<div class="act-empty">
           <div class="act-empty-icon">${gi('scroll-quill')}</div>
           <div class="act-empty-text">No recent activity</div>
           <div class="act-empty-sub">Explore the map, fight battles, and manage your cities to see activity here.</div>
         </div>`
      : feed.slice(0, 60).map(e => {
          const css  = TYPE_CSS[e.type] || '';
          const date = _timeAgo(TimeService.now() - e.at);
          // Entries logged before lordId was recorded fall back to a name
          // match, so old feed items still route.
          const route  = _routeFor(e);
          const lordId = e.lordId
            || LordService.getByPlayer(_player.id).find(l => l.name === e.lordName)?.id
            || null;
          // Scout entries carry their whole dossier — expand in place rather
          // than routing off to a lord tab that no longer holds any of it.
          const isScout = e.type === 'scout_result' && e.scoutReport;
          const open    = _expanded.has(e.id);
          const reportBtn = isScout
            ? `<button class="af-report-btn" data-toggle-report="${e.id}">${gi('spy')} ${open ? 'Hide report' : 'View report'}</button>`
            : route && lordId
              ? `<button class="af-report-btn" data-lord-id="${lordId}" data-open-tab="${route.tab}" title="${route.title}">${route.icon} ${route.label}</button>`
              : '';
          return `
            <div class="af-entry ${css}" data-entry-id="${e.id}">
              <span class="af-icon">${e.icon}</span>
              <div class="af-body">
                <span class="af-title">${e.title}</span>
                ${e.detail ? `<span class="af-detail">${e.detail}</span>` : ''}
                ${reportBtn}
                ${isScout && open ? _scoutReportHtml(e.scoutReport) : ''}
              </div>
              <div class="af-meta">
                ${e.lordName ? `<span class="af-lord">${e.lordName}</span>` : ''}
                <span class="af-time">${date}</span>
              </div>
              <button class="af-dismiss" data-entry-id="${e.id}" title="Delete">✕</button>
            </div>`;
        }).join('');

    return `
      <div class="act-screen">
        <div class="act-header">
          <h1 class="act-title">${gi('scroll-quill')} Recent Activity</h1>
          ${feed.length > 0 ? `<span class="act-count">${feed.length} event${feed.length !== 1 ? 's' : ''}</span>` : ''}
          ${feed.length > 0 ? `<button class="act-clear-btn" id="act-clear-all">Clear all</button>` : ''}
        </div>
        <div class="act-list af-list">${content}</div>
      </div>
    `;
  }

  function _bindEvents(root) {
    root.querySelectorAll('.af-report-btn[data-toggle-report]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.toggleReport;
        if (_expanded.has(id)) _expanded.delete(id); else _expanded.add(id);
        root.innerHTML = _html();
        _bindEvents(root);
      });
    });

    root.querySelectorAll('.af-report-btn[data-lord-id]').forEach(btn => {
      btn.addEventListener('click', () => {
        const lord = LordService.getById(btn.dataset.lordId);
        if (!lord) { ToastService.show('That lord is no longer available.'); return; }
        App.navigate('lord-screen', { lord, player: _player, openTab: btn.dataset.openTab || 'battles' });
      });
    });

    root.querySelectorAll('.af-dismiss[data-entry-id]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        ActivityService.remove(_player.id, btn.dataset.entryId);
        Nav.refreshBadge();
        root.innerHTML = _html();
        _bindEvents(root);
      });
    });

    root.querySelector('#act-clear-all')?.addEventListener('click', () => {
      ActivityService.clear(_player.id);
      Nav.refreshBadge();
      root.innerHTML = _html();
      _bindEvents(root);
    });
  }

  function render(root, { player }) {
    _player = PlayerService.getById(player.id);
    ActivityService.markSeen(_player.id);
    Nav.refreshBadge();
    root.innerHTML = _html();
    _bindEvents(root);
  }

  return { render };
})();
