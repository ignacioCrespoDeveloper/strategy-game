// =============================================
//  tech-tree-screen.js — Buildings & Units reference
// =============================================

const TechTreeScreen = (() => {
  let _tab    = 'buildings'; // 'buildings' | 'units'
  let _race   = null;        // selected race id
  let _lord   = null;
  let _player = null;

  const BLD_CATEGORIES = [
    { id: 'resources',      label: 'Resources',      icon: gi('wheat') },
    { id: 'infrastructure', label: 'Infrastructure', icon: gi('capitol') },
    { id: 'military',       label: 'Military',       icon: gi('crossed-swords') },
    { id: 'landmarks',      label: 'Landmarks',      icon: gi('obelisk') },
  ];

  function render(root, { player, lord }) {
    _lord   = lord   || null;
    _player = player || null;
    // Default race to lord's race on first load
    if (!_race) _race = _lord?.race || Object.keys(RACES)[0];
    root.innerHTML = _shell();
    _bindEvents(root);
  }

  // ── Shell ─────────────────────────────────────────────────────

  function _shell() {
    return `
      <div class="tt-screen">
        <div class="tt-header">
          <h1 class="tt-title">${gi('book-pile')} Tech Tree</h1>
          <div class="tt-tabs">
            <button class="tt-tab ${_tab === 'buildings' ? 'tt-tab--active' : ''}" data-tt-tab="buildings">${gi('hammer-nails')} Buildings</button>
            <button class="tt-tab ${_tab === 'units'     ? 'tt-tab--active' : ''}" data-tt-tab="units">${gi('crossed-swords')} Units</button>
          </div>
        </div>
        <div class="tt-race-bar">
          ${[...Object.values(RACES), { id: 'bandits', name: 'Bandits', icon: gi('skull-crossed-bones') }].map(r => `
            <button class="tt-race-btn ${_race === r.id ? 'tt-race-btn--active' : ''}" data-tt-race="${r.id}" title="${r.name}">
              <span class="tt-race-icon">${r.icon}</span>
              <span class="tt-race-label">${r.name}</span>
            </button>
          `).join('')}
        </div>
        <div class="tt-body">
          ${_tab === 'buildings'
            ? (_race === 'bandits' ? '' : _buildingsHtml())
            : _unitsHtml()}
        </div>
      </div>
    `;
  }

  // ── Buildings ─────────────────────────────────────────────────

  function _buildingsHtml() {
    return BLD_CATEGORIES.map(cat => {
      const defs = Object.values(BUILDING_DEFS)
        .filter(d => d.category === cat.id)
        .filter(d => _buildingMatchesRace(d, _race));
      if (!defs.length) return '';
      return `
        <section class="tt-section">
          <div class="tt-section-title">${cat.icon} ${cat.label}</div>
          <div class="tt-bld-grid">
            ${defs.map(_bldCard).join('')}
          </div>
        </section>
      `;
    }).join('');
  }

  // A building is shown for a race if:
  //   - it has no race unlock requirement, OR
  //   - one of its race requirements includes the selected race
  function _buildingMatchesRace(def, raceId) {
    const raceReqs = (def.unlockRequires || []).filter(r => r.type === 'race');
    if (!raceReqs.length) return true; // universal building
    return raceReqs.some(r => {
      const allowed = r.ids || [r.id];
      return allowed.includes(raceId);
    });
  }

  // Returns 'built' | 'available' | 'locked'
  function _bldStatus(def) {
    if (!_player) return 'locked';
    const cities = CityService.getPlayerCities(_player.id);
    if (cities.some(c => (c.buildings[def.id] || 0) > 0)) return 'built';
    if (cities.some(c => {
      const { locked } = BuildingUnlockService.check(c, _lord, def);
      return !locked;
    })) return 'available';
    return 'locked';
  }

  // Returns 'available' | 'locked'
  // Only unlocked when viewing your own race AND you have the required building
  function _unitStatus(bldId, minLevel) {
    if (!_player || !bldId) return 'locked';
    if (_race !== 'bandits' && _lord?.race !== _race) return 'locked';
    const cities = CityService.getPlayerCities(_player.id);
    if (cities.some(c => (c.buildings[bldId] || 0) >= minLevel)) return 'available';
    return 'locked';
  }

  function _bldCard(def) {
    const reqs   = [];
    const status = _bldStatus(def);

    Object.entries(def.requires || {}).forEach(([id, lvl]) => {
      const name = BUILDING_DEFS[id]?.name || id;
      reqs.push(`${name} Lv ${lvl}`);
    });

    (def.unlockRequires || []).forEach(req => {
      if (req.type === 'population')         reqs.push(`Pop ${req.min.toLocaleString()}+`);
      else if (req.type === 'tech')          reqs.push(`Tech: ${req.label || req.id}`);
      else if (req.type === 'landmark_none') reqs.push('No existing landmark');
      else if (req.type === 'city_tier')     reqs.push(`City Tier ${req.minTier}+`);
      // skip race reqs — already filtered
    });

    const effects = def.effects ? def.effects(1) : [];
    const effectsHtml = effects.length
      ? effects.map(e => {
          const sign  = e.value >= 0 ? '+' : '';
          const color = e.value >= 0 ? '#5cdd5c' : '#e05050';
          return `<span class="tt-effect" style="color:${color}">${sign}${e.value} ${e.stat}</span>`;
        }).join('')
      : '';

    const lockedClass = status === 'locked'    ? ' tt-card--locked' : '';
    const builtBadge  = status === 'built'     ? '<span class="tt-card-built">✓</span>' : '';

    // Same art-banner card grammar as the city view's building grid:
    // artwork with a bottom fade on top (emoji fallback), info below.
    return `
      <div class="tt-bld-card${lockedClass}">
        ${builtBadge}
        <div class="tt-bld-art">
          ${def.image
            ? `<img class="tt-bld-art-img" src="${def.image}" alt="" loading="lazy" />`
            : `<span class="tt-bld-art-icon">${def.icon}</span>`}
          <span class="tt-bld-art-fade"></span>
        </div>
        <div class="tt-bld-body">
          <div class="tt-bld-name">${def.name}</div>
          <div class="tt-bld-desc">${def.description || ''}</div>
          ${reqs.length ? `
            <div class="tt-reqs">
              ${reqs.map(r => `<span class="tt-req">${gi('padlock')} ${r}</span>`).join('')}
            </div>` : ''}
          ${effectsHtml ? `<div class="tt-effects">${effectsHtml}</div>` : ''}
        </div>
      </div>
    `;
  }

  // ── Units ─────────────────────────────────────────────────────

  // Bandits pseudo-race: grouped by the camp that actually fields each unit —
  // every entry in CAMP_DEFS (bandit_camp through dragon_cult) except the
  // camps whose rosters are just that race's own units (orc_warcamp,
  // dark_elf_raiders, dwarf_expedition) — those are already shown under
  // their respective race tabs, so listing them again here would just be a
  // duplicate. Includes both units you can hire on the spot (mercenaryRoster)
  // and ones that only ever show up as camp defenders (defenderRosterByLevel),
  // so this is the full roster you can run into at any true hostile/monster
  // camp, not a generic "race-less mercenary" grab-bag.
  const _BANDIT_TAB_EXCLUDED_CAMPS = new Set(['orc_warcamp', 'dark_elf_raiders', 'dwarf_expedition']);

  function _campUnitIds(campDef) {
    const ids = new Set(campDef.mercenaryRoster || []);
    Object.values(campDef.defenderRosterByLevel || {}).forEach(entries => {
      entries.forEach(e => ids.add(e.unitId));
    });
    return [...ids];
  }

  function _unitsHtml() {
    if (_race === 'bandits') {
      const sections = Object.values(CAMP_DEFS)
        .filter(campDef => !_BANDIT_TAB_EXCLUDED_CAMPS.has(campDef.id))
        .map(campDef => {
          const units = _campUnitIds(campDef).map(uid => UNIT_DEFS[uid]).filter(Boolean);
          if (!units.length) return '';
          return `
            <section class="tt-section">
              <div class="tt-section-title">${campDef.icon} ${campDef.displayName}</div>
              <div class="tt-unit-grid">
                ${units.map(u => _unitCard(u, null, null, 'available')).join('')}
              </div>
            </section>
          `;
        }).join('');
      return sections || `<div class="tt-empty">No mercenary units defined yet.</div>`;
    }

    const raceRoster = UNIT_ROSTER[_race] || {};
    const sections   = [];

    // Group by building
    const byBuilding = {};
    Object.entries(raceRoster).forEach(([bldId, lvlMap]) => {
      Object.entries(lvlMap).forEach(([lvl, ids]) => {
        ids.forEach(id => {
          if (!byBuilding[bldId]) byBuilding[bldId] = [];
          byBuilding[bldId].push({ id, minLevel: Number(lvl) });
        });
      });
    });

    if (Object.keys(byBuilding).length === 0) {
      return `<div class="tt-empty">No units defined for this race yet.</div>`;
    }

    Object.entries(byBuilding).forEach(([bldId, entries]) => {
      const bldDef = BUILDING_DEFS[bldId];
      const cards  = entries.map(({ id, minLevel }) => {
        const unit   = UNIT_DEFS[id];
        const status = _unitStatus(bldId, minLevel);
        return unit ? _unitCard(unit, bldDef?.name || bldId, minLevel, status) : '';
      }).join('');
      sections.push(`
        <section class="tt-section">
          <div class="tt-section-title">
            ${bldDef?.icon || gi('hammer-nails')} ${bldDef?.name || bldId}
          </div>
          <div class="tt-unit-grid">${cards}</div>
        </section>
      `);
    });

    return sections.join('');
  }

  // `opts` lets other screens (lord-screen recruitment) reuse this exact
  // card while layering their own context on top:
  //   stats          — {attack, defense, ...} overrides (e.g. veterancy-adjusted)
  //   costHtml       — replaces the default gold-cost span (e.g. gold + train time)
  //   nameSuffixHtml — appended after the unit name (e.g. veterancy badge)
  //   bodyExtraHtml  — appended after traits (e.g. ability/tag badges)
  //   actionHtml     — action strip at the bottom of the body (e.g. Recruit button)
  //   extraClass     — additional class(es) on the card root
  function _unitCard(unit, buildingName, minLevel, status, opts = {}) {
    const s = { ...(unit.combatStats || {}), ...(opts.stats || {}) };
    const traitLabels = (unit.traits || []).map(t => {
      const def = typeof TRAIT_DEFS !== 'undefined' ? TRAIT_DEFS[t] : null;
      return def ? def.name : t.replace(/_/g, ' ');
    });

    const lockedClass = (status === 'locked' ? ' tt-card--locked' : '')
      + (opts.extraClass ? ` ${opts.extraClass}` : '');
    const raceInfo    = unit.race ? RACES[unit.race] : null;
    const raceBadge   = raceInfo
      ? `<span class="tt-unit-race">${raceInfo.icon} ${raceInfo.name}</span>`
      : `<span class="tt-unit-race tt-unit-race--merc">${gi('skull-crossed-bones')} Mercenary</span>`;

    const portrait = unit.image
      ? `<img class="tt-uc-img" src="${unit.image}" alt="${unit.name}" loading="lazy" />`
      : `<span class="tt-uc-icon">${unit.icon}</span>`;

    // goldCost 0 marks camp-defender-only units (e.g. mercenary_spearmen) —
    // they're never actually hired for free, so show that plainly instead
    // of a misleading "💰 0".
    const costHtml = opts.costHtml !== undefined ? opts.costHtml : (unit.goldCost > 0
      ? `<span class="tt-unit-cost">${gi('two-coins')} ${unit.goldCost}</span>`
      : `<span class="tt-unit-cost tt-unit-cost--none" title="Only encountered as a camp defender — not directly recruitable">${gi('campfire')} Camp Only</span>`);

    return `
      <div class="tt-unit-card${lockedClass}">
        <div class="tt-uc-portrait">${portrait}${giUnitType(unit.category)}</div>
        <div class="tt-uc-body">
          <div class="tt-uc-top">
            <span class="tt-unit-name">${unit.name}${opts.nameSuffixHtml || ''}</span>
            ${costHtml}
          </div>
          ${raceBadge}
          <div class="tt-unit-stats">
            <span class="tt-stat" title="Attack">${gi('crossed-swords')} ${s.attack ?? '—'}</span>
            <span class="tt-stat" title="Defense">${gi('round-shield')} ${s.defense ?? '—'}</span>
            <span class="tt-stat" title="HP">${gi('hearts')} ${s.hp ?? '—'}</span>
            <span class="tt-stat" title="Speed">${gi('wingfoot')} ${s.speed ?? '—'}</span>
            <span class="tt-stat tt-stat--pwr" title="Army Power cost per model — combat traits are priced in">${gi('rank-3')} ${Math.round(EconomyCore.getUnitPower(unit))} PWR</span>
          </div>
          ${traitLabels.length ? `
            <div class="tt-traits">
              ${traitLabels.map(t => `<span class="tt-trait">${t}</span>`).join('')}
            </div>` : ''}
          ${opts.bodyExtraHtml || ''}
          ${buildingName ? `<div class="tt-unit-req">${gi('hammer-nails')} ${buildingName} Lv ${minLevel}+</div>` : ''}
          ${opts.actionHtml ? `<div class="tt-uc-action">${opts.actionHtml}</div>` : ''}
        </div>
      </div>
    `;
  }

  // ── Events ────────────────────────────────────────────────────

  function _bindEvents(root) {
    root.querySelectorAll('.tt-tab[data-tt-tab]').forEach(btn => {
      btn.addEventListener('click', () => {
        _tab = btn.dataset.ttTab;
        root.innerHTML = _shell();
        _bindEvents(root);
      });
    });

    root.querySelectorAll('.tt-race-btn[data-tt-race]').forEach(btn => {
      btn.addEventListener('click', () => {
        _race = btn.dataset.ttRace;
        root.innerHTML = _shell();
        _bindEvents(root);
      });
    });
  }

  // Public card builder so other screens (lord-screen recruitment) render
  // the exact same unit card. See _unitCard for the supported opts.
  function unitCardHtml(unit, opts = {}) {
    return _unitCard(unit, opts.buildingName ?? null, opts.minLevel ?? null, opts.status ?? 'available', opts);
  }

  return { render, unitCardHtml };
})();
