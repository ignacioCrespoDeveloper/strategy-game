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
  let _player       = null;
  let _lord         = null;
  let _root         = null;
  let _tab          = 'library';
  let _selectedBook = null;
  let _tickTimer    = null;

  const TABS = [
    { id: 'library', label: 'Library', icon: () => gi('book-pile') },
    { id: 'temple',  label: 'Temple',  icon: () => gi('church') },
  ];

  const RES_ICON = {
    wood:  () => gi('wood-pile'),
    stone: () => gi('war-pick'),
    food:  () => gi('wheat'),
  };

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
          <span class="bld3-tile-icon">${def.icon}</span>
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
          <div class="bld3-detail-icon">${def.icon}</div>
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
    const playerRes = _player?.resources || {};
    return Object.entries(cost)
      .filter(([, v]) => v > 0)
      .map(([res, v]) => {
        const has = Math.floor(playerRes[res] || 0) >= v;
        return `<span class="${has ? 'bld2-res' : 'bld2-res bld2-res--short'}">${RES_ICON[res] ? RES_ICON[res]() : res} ${v.toLocaleString()}</span>`;
      })
      .join('');
  }

  // ── Temple tab (placeholder) ──────────────────────────────────

  function _templeHtml() {
    return `
      <div class="rs-empty">
        <div class="rs-empty-icon">${gi('church')}</div>
        <div class="rs-empty-title">Temple Blessings</div>
        <div class="rs-empty-sub">Coming soon — devotions and timed blessings granted by your Temples.</div>
      </div>
    `;
  }

  // ── Events ────────────────────────────────────────────────────

  function _bindEvents() {
    document.querySelectorAll('.bld2-tab[data-rs-tab]').forEach(btn => {
      btn.addEventListener('click', () => {
        _tab          = btn.dataset.rsTab;
        _selectedBook = null;
        _rerender();
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
  }

  // ── Live countdown ────────────────────────────────────────────

  function _startCountdown() {
    _stopCountdown();
    if ((_player?.researchQueue || []).length === 0) return;

    _tickTimer = setInterval(() => {
      const active = (_player?.researchQueue || [])[0];
      if (!active) { _stopCountdown(); return; }
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
      const formatted = TimeService.formatDuration(secs);
      const el1 = document.getElementById('rs-cd');
      const el2 = document.getElementById('rs-cd-tile');
      if (el1) el1.textContent = formatted;
      if (el2) el2.textContent = formatted;
    }, 1000);
  }

  function _stopCountdown() {
    if (_tickTimer) { clearInterval(_tickTimer); _tickTimer = null; }
  }

  function _toast(msg) { ToastService.show(msg); }

  return { render, stop };
})();
