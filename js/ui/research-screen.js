// =============================================
//  research-screen.js — Research (Library books + Temple blessings)
//
//  Nav entry "Research" with two tabs:
//    Library → the book research lines (RESEARCH_DEFS), rendered with
//              the SAME card grammar as the city building grid
//              (bld3-tile / bld3-detail classes) — tile grid, detail
//              panel drops down below on click.
//    Temple  → placeholder (blessings are designed but not built yet).
//
//  Research state is empire-wide (player.research / player.researchQueue);
//  actions go through ServerActions.researchStart / researchInstant.
// =============================================

const ResearchScreen = (() => {
  let _player          = null;
  let _lord            = null;
  let _root            = null;
  let _tab             = 'library';
  let _selectedBook    = null;
  let _selectedBlessing = null;
  let _tickTimer       = null;

  const TABS = [
    { id: 'library', label: 'Library', icon: () => gi('book-pile') },
    { id: 'temple',  label: 'Temple',  icon: () => gi('church') },
  ];

  const RES_ICON = {
    gold:  () => gi('two-coins'),
    wood:  () => gi('wood-pile'),
    stone: () => gi('war-pick'),
    food:  () => gi('wheat'),
  };

  // Current balance for a cost key — gold reads from player.coins, all
  // other keys are stockpiled resources. Keeps _costChips/_canAfford able
  // to price both research (resources) and blessings (gold) uniformly.
  function _balanceOf(key) {
    if (key === 'gold') return Math.floor(_player?.coins || 0);
    return Math.floor((_player?.resources || {})[key] || 0);
  }

  // ── Entry point ───────────────────────────────────────────────

  function render(root, { player, lord }) {
    _stopCountdown();
    _root   = root;
    _player = PlayerService.getById(player.id);
    _lord   = lord ? LordService.getById(lord.id) : null;
    root.innerHTML = _shell();
    _bindEvents();
    _startCountdown();
  }

  function stop() { _stopCountdown(); }

  function _rerender() {
    if (!_root) return;
    _root.innerHTML = _shell();
    _bindEvents();
  }

  // ── State helpers ─────────────────────────────────────────────

  function _maxLibraryLevel() {
    return CityService.getPlayerCities(_player.id)
      .reduce((max, c) => Math.max(max, c.buildings?.library || 0), 0);
  }

  function _maxTempleLevel() {
    return CityService.getPlayerCities(_player.id)
      .reduce((max, c) => Math.max(max, c.buildings?.temple || 0), 0);
  }

  // The player's active blessing, or null if none / already lapsed.
  function _activeBlessing() {
    const b = _player?.activeBlessing;
    if (!b || !b.id) return null;
    if (b.finishAt && TimeService.now() >= b.finishAt) return null;
    return b;
  }

  function _bookState(def) {
    const libLevel = _maxLibraryLevel();
    const level    = (_player?.research || {})[def.id] || 0;
    const active   = (_player?.researchQueue || [])[0] || null;
    const reqLib   = RESEARCH_TIERS[def.tier] || 1;

    const locked   = libLevel < reqLib;
    const atMax    = level >= def.maxLevel;
    const isActive = active?.bookId === def.id;
    const busy     = !!active;
    const target   = level + 1;

    const playerRes  = _player?.resources || {};
    const cost       = (!atMax && !locked) ? def.cost(target) : {};
    const affordable = !atMax && !locked && Object.entries(cost)
      .every(([res, amt]) => amt <= 0 || Math.floor(playerRes[res] || 0) >= amt);

    return { level, target, reqLib, locked, atMax, isActive, busy, active, cost, affordable };
  }

  function _bonusLabel(def, level) {
    if (level <= 0) return '—';
    const LABELS = {
      food_production:    v => `+${Math.round(v * 100)}% food production`,
      wood_production:    v => `+${Math.round(v * 100)}% wood production`,
      stone_production:   v => `+${Math.round(v * 100)}% stone production`,
      construction_speed: v => `−${Math.round(-v * 100)}% construction time`,
      march_food_cost:    v => `−${Math.round(-v * 100)}% march food cost`,
      recruit_speed:      v => `−${Math.round(-v * 100)}% recruit time`,
    };
    return Object.entries(def.bonuses(level))
      .map(([k, v]) => (LABELS[k] ? LABELS[k](v) : `${k}: ${v}`))
      .join(' · ');
  }

  // ── Shell ─────────────────────────────────────────────────────

  function _shell() {
    return `
      <div class="rs-screen">
        <div class="bld2-tabs">
          ${TABS.map(t => `
            <button class="bld2-tab ${_tab === t.id ? 'bld2-tab--active' : ''}" data-rs-tab="${t.id}">
              <span>${t.icon()}</span><span>${t.label}</span>
            </button>
          `).join('')}
        </div>
        <div class="rs-body" id="rs-body">
          ${_tab === 'library' ? _libraryHtml() : _templeHtml()}
        </div>
      </div>
    `;
  }

  // ── Library tab ───────────────────────────────────────────────

  function _libraryHtml() {
    const libLevel = _maxLibraryLevel();
    const active   = (_player?.researchQueue || [])[0] || null;

    if (libLevel === 0) {
      return `
        <div class="rs-empty">
          <div class="rs-empty-icon">${gi('book-pile')}</div>
          <div class="rs-empty-title">No Library yet</div>
          <div class="rs-empty-sub">Build a Library in one of your cities to unlock book research.</div>
        </div>`;
    }

    const books   = Object.values(RESEARCH_DEFS);
    const selDef  = _selectedBook ? RESEARCH_DEFS[_selectedBook] : null;

    return `
      <div class="rs-status">
        <span>${gi('book-pile')} Highest Library: <b>Lv ${libLevel}</b></span>
        <span class="rs-status-sep">·</span>
        <span>${active
          ? `Researching <b>${RESEARCH_DEFS[active.bookId]?.name || active.bookId}</b> → Lv ${active.targetLevel}`
          : 'No research in progress — one book at a time, empire-wide'}</span>
      </div>
      <div class="bld3-grid">${books.map(def => _bookTileHtml(def)).join('')}</div>
      ${selDef ? _bookDetailHtml(selDef) : ''}
    `;
  }

  function _bookTileHtml(def) {
    const s = _bookState(def);
    const cant = !s.locked && !s.atMax && !s.busy && !s.affordable;

    const classes = [
      'bld3-tile',
      _selectedBook === def.id ? 'bld3-tile--selected' : '',
      s.locked   ? 'bld3-tile--locked'  : '',
      s.atMax    ? 'bld3-tile--maxed'   : '',
      s.isActive ? 'bld3-tile--inqueue' : '',
      cant       ? 'bld3-tile--cant'    : '',
    ].filter(Boolean).join(' ');

    const activeEta = s.isActive ? Math.max(0, Math.round((s.active.finishAt - TimeService.now()) / 1000)) : 0;
    const busyOverlay = s.isActive ? `
      <span class="bld3-tile-busy">
        <span class="bld3-tile-busy-icon">${gi('book-pile')}</span>
        <span class="bld3-tile-busy-label">Researching → Lv ${s.active.targetLevel}</span>
        <span class="bld3-tile-busy-cd" id="rs-cd-tile">${TimeService.formatDuration(activeEta)}</span>
      </span>` : '';

    return `
      <button class="${classes}" data-book="${def.id}" title="${def.name}" aria-label="${def.name}, level ${s.level}">
        <span class="bld3-tile-art">
          ${def.image
            ? `<img class="bld3-tile-img" src="${def.image}" alt="" loading="lazy" />`
            : `<span class="bld3-tile-icon">${def.icon}</span>`}
          <span class="bld3-tile-art-fade"></span>
          ${busyOverlay}
        </span>
        <span class="bld3-tile-info">
          <span class="bld3-tile-name">${def.name}</span>
          <span class="bld3-tile-level">${s.atMax ? 'MAX' : `Lv ${s.level}`}</span>
        </span>
      </button>
    `;
  }

  function _bookDetailHtml(def) {
    const s = _bookState(def);

    // Action button state — same grammar as the building detail panel
    let btnLabel, btnClass, btnDisabled;
    if (s.atMax) {
      btnLabel = 'Max Level'; btnClass = 'bld2-btn--maxed'; btnDisabled = true;
    } else if (s.locked) {
      btnLabel = `${gi('padlock')} Locked`; btnClass = 'bld2-btn--locked'; btnDisabled = true;
    } else if (s.busy && !s.isActive) {
      btnLabel = 'Researching…'; btnClass = 'bld2-btn--busy'; btnDisabled = true;
    } else if (s.isActive) {
      btnLabel = ''; btnClass = ''; btnDisabled = true;
    } else if (!s.affordable) {
      btnLabel = 'Need Resources'; btnClass = 'bld2-btn--cant'; btnDisabled = true;
    } else {
      btnLabel = `${gi('book-pile')} Research`; btnClass = 'bld2-btn--ready'; btnDisabled = false;
    }

    const activeEta = s.isActive ? Math.max(0, Math.round((s.active.finishAt - TimeService.now()) / 1000)) : 0;

    return `
      <div class="bld3-detail">
        <div class="bld3-detail-head">
          <span class="bld3-detail-name">${def.name}</span>
          <span class="bld3-detail-level">${s.atMax ? 'Max Level' : `Level ${s.level} / ${def.maxLevel}`}</span>
          <button class="bld3-detail-close" id="rs-close" aria-label="Close details">✕</button>
        </div>
        <div class="bld3-detail-body">
          ${def.image
            ? `<img class="bld3-detail-img" src="${def.image}" alt="${def.name}" />`
            : `<div class="bld3-detail-icon">${def.icon}</div>`}
          <div class="bld3-detail-info">
            <div class="bld3-detail-desc">${def.description}</div>

            <div class="bld2-prod-row">
              ${s.level > 0 ? `<span class="bld2-prod-cur">${_bonusLabel(def, s.level)}</span>` : ''}
              ${s.level > 0 && !s.atMax ? `<span class="bld2-prod-sep">→</span>` : ''}
              ${!s.atMax ? `<span class="bld2-prod-next">Lv ${s.target}: ${_bonusLabel(def, s.target)}</span>` : ''}
            </div>

            ${s.locked ? `
              <div class="bld2-reasons">
                <div class="bld2-reason">${gi('padlock')} Requires a Library at level ${s.reqLib} (yours is ${_maxLibraryLevel()})</div>
              </div>
            ` : (!s.atMax && !s.isActive) ? `
              <div class="bld3-detail-req-title">Required to research level ${s.target}:</div>
              <div class="bld2-cost-row">
                ${_costChips(s.cost)}
                <span class="bld2-duration">${gi('stopwatch')} ${TimeService.formatDuration(def.researchTime(s.target))}</span>
              </div>
            ` : ''}
          </div>
          <div class="bld3-detail-actions">
            ${s.isActive ? `
              <span class="rsch-active">
                <span class="rsch-cd" id="rs-cd">${TimeService.formatDuration(activeEta)}</span>
                <button class="rsch-instant-btn" id="rs-instant" title="Finish instantly with credits">⚡ ${Math.max(1, Math.ceil(activeEta / 60))}${gi('cut-diamond')}</button>
              </span>
            ` : `
              <button class="bld2-btn ${btnClass}" data-research="${def.id}" ${btnDisabled ? 'disabled' : ''}>${btnLabel}</button>
              ${!s.atMax && !s.locked && !s.busy ? `<div class="bld2-next-hint">→ Lv ${s.target}</div>` : ''}
            `}
          </div>
        </div>
      </div>
    `;
  }

  function _costChips(cost) {
    return Object.entries(cost)
      .filter(([, v]) => v > 0)
      .map(([res, v]) => {
        const has = _balanceOf(res) >= v;
        return `<span class="${has ? 'bld2-res' : 'bld2-res bld2-res--short'}">${RES_ICON[res] ? RES_ICON[res]() : res} ${v.toLocaleString()}</span>`;
      })
      .join('');
  }

  // ── Temple tab (blessings) ────────────────────────────────────

  function _templeHtml() {
    const templeLevel = _maxTempleLevel();

    if (templeLevel < BLESSING_MIN_TEMPLE) {
      return `
        <div class="rs-empty">
          <div class="rs-empty-icon">${gi('church')}</div>
          <div class="rs-empty-title">No Temple yet</div>
          <div class="rs-empty-sub">Build a Temple in one of your cities to receive the gods' blessings.</div>
        </div>`;
    }

    const active   = _activeBlessing();
    const activeDef = active ? BLESSING_DEFS[active.id] : null;
    const eta      = active ? Math.max(0, Math.round((active.finishAt - TimeService.now()) / 1000)) : 0;
    const dur      = TimeService.formatDuration(blessingDuration(templeLevel));

    const blessings = Object.values(BLESSING_DEFS);
    const selDef    = _selectedBlessing ? BLESSING_DEFS[_selectedBlessing] : null;

    return `
      <div class="rs-status">
        <span>${gi('church')} Highest Temple: <b>Lv ${templeLevel}</b></span>
        <span class="rs-status-sep">·</span>
        <span>${active
          ? `Blessed by the <b>${activeDef?.name || active.id}</b> — lapses in <b id="rs-bless-cd">${TimeService.formatDuration(eta)}</b>`
          : `No blessing consecrated — one active at a time (${dur} per rite)`}</span>
      </div>
      <div class="bld3-grid">${blessings.map(def => _blessingTileHtml(def, active, templeLevel)).join('')}</div>
      ${selDef ? _blessingDetailHtml(selDef, active, templeLevel) : ''}
    `;
  }

  function _blessingTileHtml(def, active, templeLevel) {
    const isActive = active?.id === def.id;
    const classes  = [
      'bld3-tile',
      _selectedBlessing === def.id ? 'bld3-tile--selected' : '',
      isActive ? 'bld3-tile--inqueue' : '',
    ].filter(Boolean).join(' ');

    const eta = isActive ? Math.max(0, Math.round((active.finishAt - TimeService.now()) / 1000)) : 0;
    const busyOverlay = isActive ? `
      <span class="bld3-tile-busy">
        <span class="bld3-tile-busy-icon">${gi('church')}</span>
        <span class="bld3-tile-busy-label">Blessing active</span>
        <span class="bld3-tile-busy-cd" id="rs-bless-cd-tile">${TimeService.formatDuration(eta)}</span>
      </span>` : '';

    return `
      <button class="${classes}" data-blessing="${def.id}" title="${def.name}" aria-label="${def.name}">
        <span class="bld3-tile-art">
          ${def.image
            ? `<img class="bld3-tile-img" src="${def.image}" alt="" loading="lazy" />`
            : `<span class="bld3-tile-icon">${def.icon}</span>`}
          <span class="bld3-tile-art-fade"></span>
          ${busyOverlay}
        </span>
        <span class="bld3-tile-info">
          <span class="bld3-tile-name">${def.name}</span>
          <span class="bld3-tile-level">${isActive ? 'Active' : 'Blessing'}</span>
        </span>
      </button>
    `;
  }

  function _blessingDetailHtml(def, active, templeLevel) {
    const isActive   = active?.id === def.id;
    const offering   = { gold: blessingCost(templeLevel) };
    const affordable = _canAfford(offering);
    const eta        = isActive ? Math.max(0, Math.round((active.finishAt - TimeService.now()) / 1000)) : 0;
    const durLabel   = TimeService.formatDuration(blessingDuration(templeLevel));

    // Consecrate button state — same grammar as the Library detail panel.
    let btnLabel, btnClass, btnDisabled;
    if (!affordable) {
      btnLabel = 'Need Offering'; btnClass = 'bld2-btn--cant'; btnDisabled = true;
    } else if (isActive) {
      btnLabel = `${gi('church')} Renew`; btnClass = 'bld2-btn--ready'; btnDisabled = false;
    } else {
      btnLabel = `${gi('church')} Consecrate`; btnClass = 'bld2-btn--ready'; btnDisabled = false;
    }

    return `
      <div class="bld3-detail">
        <div class="bld3-detail-head">
          <span class="bld3-detail-name">${def.name}</span>
          <span class="bld3-detail-level">${isActive ? `Active — lapses in ${TimeService.formatDuration(eta)}` : 'Blessing'}</span>
          <button class="bld3-detail-close" id="rs-bless-close" aria-label="Close details">✕</button>
        </div>
        <div class="bld3-detail-body">
          ${def.image
            ? `<img class="bld3-detail-img" src="${def.image}" alt="${def.name}" />`
            : `<div class="bld3-detail-icon">${def.icon}</div>`}
          <div class="bld3-detail-info">
            <div class="bld3-detail-desc">${def.description}</div>

            <div class="bld2-prod-row">
              <span class="bld2-prod-cur">${def.summary}</span>
            </div>

            <div class="bld3-detail-req-title">${isActive ? 'Renew this rite for:' : 'Consecrate this rite for:'}</div>
            <div class="bld2-cost-row">
              ${_costChips(offering)}
              <span class="bld2-duration">${gi('stopwatch')} ${durLabel}</span>
            </div>
            ${active && !isActive ? `
              <div class="bld2-next-hint">Replaces the active ${gi('church')} ${BLESSING_DEFS[active.id]?.name || active.id}.</div>
            ` : ''}
          </div>
          <div class="bld3-detail-actions">
            <button class="bld2-btn ${btnClass}" data-consecrate="${def.id}" ${btnDisabled ? 'disabled' : ''}>${btnLabel}</button>
          </div>
        </div>
      </div>
    `;
  }

  function _canAfford(cost) {
    return Object.entries(cost).every(([res, amt]) => amt <= 0 || _balanceOf(res) >= amt);
  }

  // ── Events ────────────────────────────────────────────────────

  function _bindEvents() {
    document.querySelectorAll('.bld2-tab[data-rs-tab]').forEach(btn => {
      btn.addEventListener('click', () => {
        _tab             = btn.dataset.rsTab;
        _selectedBook    = null;
        _selectedBlessing = null;
        _rerender();
        _startCountdown();
      });
    });

    document.querySelectorAll('.bld3-tile[data-book]').forEach(tile => {
      tile.addEventListener('click', () => {
        const id = tile.dataset.book;
        _selectedBook = _selectedBook === id ? null : id;
        _rerender();
        if (_selectedBook) {
          document.querySelector('.bld3-detail')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      });
    });

    document.getElementById('rs-close')?.addEventListener('click', () => {
      _selectedBook = null;
      _rerender();
    });

    document.querySelectorAll('.bld2-btn[data-research]:not([disabled])').forEach(btn => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        const result = await ServerActions.researchStart(btn.dataset.research);
        if (!result.ok) { btn.disabled = false; _toast(result.error || 'Server error'); return; }
        _player = PlayerService.getById(_player.id);
        _rerender();
        _startCountdown();
        EventBus.emit('resources:changed');
        HUD.refresh();
      });
    });

    document.getElementById('rs-instant')?.addEventListener('click', async () => {
      const result = await ServerActions.researchInstant();
      if (!result.ok) { _toast(result.error || 'Server error'); return; }
      _player = PlayerService.getById(_player.id);
      _rerender();
      HUD.refresh();
      _toast('✓ Research completed instantly!');
    });

    // ── Temple tab: blessings ──────────────────────────────────
    document.querySelectorAll('.bld3-tile[data-blessing]').forEach(tile => {
      tile.addEventListener('click', () => {
        const id = tile.dataset.blessing;
        _selectedBlessing = _selectedBlessing === id ? null : id;
        _rerender();
        if (_selectedBlessing) {
          document.querySelector('.bld3-detail')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      });
    });

    document.getElementById('rs-bless-close')?.addEventListener('click', () => {
      _selectedBlessing = null;
      _rerender();
    });

    document.querySelectorAll('.bld2-btn[data-consecrate]:not([disabled])').forEach(btn => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        const result = await ServerActions.blessingConsecrate(btn.dataset.consecrate);
        if (!result.ok) { btn.disabled = false; _toast(result.error || 'Server error'); return; }
        _player = PlayerService.getById(_player.id);
        const def = BLESSING_DEFS[btn.dataset.consecrate];
        _rerender();
        _startCountdown();
        EventBus.emit('resources:changed');
        HUD.refresh();
        _toast(`${def?.name || 'Blessing'} consecrated!`);
      });
    });
  }

  // ── Live countdown ────────────────────────────────────────────

  function _startCountdown() {
    _stopCountdown();
    const hasResearch = (_player?.researchQueue || []).length > 0;
    const hasBlessing = !!_activeBlessing();
    if (!hasResearch && !hasBlessing) return;

    _tickTimer = setInterval(() => {
      let live = false;

      // Library research countdown
      const active = (_player?.researchQueue || [])[0];
      if (active) {
        const secs = Math.round((active.finishAt - TimeService.now()) / 1000);
        if (secs <= 0) {
          _stopCountdown();
          ServerActions.syncNow().then(() => {
            _player = PlayerService.getById(_player.id);
            _toast('✓ Research completed!');
            _rerender();
          });
          return;
        }
        const f = TimeService.formatDuration(secs);
        const el1 = document.getElementById('rs-cd');
        const el2 = document.getElementById('rs-cd-tile');
        if (el1) el1.textContent = f;
        if (el2) el2.textContent = f;
        live = true;
      }

      // Temple blessing countdown
      const bless = _activeBlessing();
      if (bless) {
        const secs = Math.round((bless.finishAt - TimeService.now()) / 1000);
        if (secs <= 0) {
          _stopCountdown();
          ServerActions.syncNow().then(() => {
            _player = PlayerService.getById(_player.id);
            _toast('The blessing has lapsed.');
            _rerender();
          });
          return;
        }
        const f = TimeService.formatDuration(secs);
        const elb = document.getElementById('rs-bless-cd');
        const elt = document.getElementById('rs-bless-cd-tile');
        if (elb) elb.textContent = f;
        if (elt) elt.textContent = f;
        live = true;
      }

      if (!live) _stopCountdown();
    }, 1000);
  }

  function _stopCountdown() {
    if (_tickTimer) { clearInterval(_tickTimer); _tickTimer = null; }
  }

  function _toast(msg) { ToastService.show(msg); }

  return { render, stop };
})();
