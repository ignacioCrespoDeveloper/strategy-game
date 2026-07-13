// =============================================
//  battle-simulator.js — Battle Simulator
//  3-step: Attacker → Defender → Battle
// =============================================

const BattleSimulator = (() => {

  // ── State ──────────────────────────────────────────────────────
  let _step      = 'attacker';
  let _atkRace   = '';
  let _defRace   = '';
  let _atkCounts = {};
  let _defCounts = {};
  let _terrain   = 'plains';
  let _report    = null;   // BattleReport + _atkDmg + _defDmg
  let _logOpen   = false;
  let _root      = null;
  let _player    = null;
  let _lord      = null;

  const MAX_UNITS    = 10;
  const MAX_PER_TYPE = 5;

  const TERRAINS = [
    { id: 'plains',   label: 'Plains',   icon: '🌾' },
    { id: 'forest',   label: 'Forest',   icon: '🌲' },
    { id: 'hills',    label: 'Hills',    icon: '⛰' },
    { id: 'marsh',    label: 'Marsh',    icon: '🌿' },
    { id: 'mountain', label: 'Mountain', icon: '🏔' },
    { id: 'desert',   label: 'Desert',   icon: '🏜' },
  ];

  // ── Entry point ────────────────────────────────────────────────
  function render(root, { player, lord }) {
    _root = root; _player = player; _lord = lord;
    _rerender();
  }

  // ── Helpers ────────────────────────────────────────────────────
  function _raceUnits(raceId) {
    const roster = UNIT_ROSTER[raceId];
    if (!roster) return [];
    const seen = new Set(), out = [];
    Object.values(roster).forEach(lm =>
      Object.values(lm).flat().forEach(uid => {
        if (!seen.has(uid) && UNIT_DEFS[uid]) { seen.add(uid); out.push(uid); }
      })
    );
    return out;
  }

  function _unitRole(def) {
    if (def.category === 'ranged')   return 'ranged';
    if (def.category === 'cavalry')  return 'cavalry';
    if (def.category === 'monster' || def.category === 'legendary') return 'monster';
    if ((def.traits || []).includes('ranged')) return 'ranged';
    return 'infantry';
  }

  function _totalModels(counts) {
    return Object.values(counts).reduce((s, c) => s + c, 0);
  }

  function _tierClass(category) {
    if (category === 'mercenary') return 'la-unit-card--merc';
    if (category === 'elite' || category === 'cavalry') return 'la-unit-card--elite';
    if (category === 'monster')   return 'la-unit-card--monster';
    if (category === 'legendary') return 'la-unit-card--legendary';
    return '';
  }

  function _makeBattleUnit(unitId, count, prefix, idx) {
    const def = UNIT_DEFS[unitId];
    return {
      id: `${prefix}_${idx}`, sourceId: unitId,
      name: def.name, role: _unitRole(def),
      traits: [...(def.traits || [])], abilities: [...(def.abilities || [])],
      maxHp: def.combatStats?.hp ?? 100, currentHp: def.combatStats?.hp ?? 100,
      attack: def.combatStats?.attack ?? 5, defense: def.combatStats?.defense ?? 5,
      speed: def.combatStats?.speed ?? 5, leadership: 0,
      count, startCount: count,
      isLord: false, isRouting: false, _frenzBonus: 0, _burning: false,
    };
  }

  // ── Card builders ──────────────────────────────────────────────

  // Full-health card — used in steps 1/2 and in the pre-battle lineup.
  function _simUnitCard(def) {
    const tier = _tierClass(def.category);
    const s    = def.combatStats || {};
    const portrait = def.image
      ? `<img src="${def.image}" class="la-uc-img" alt="${def.name}" loading="lazy">`
      : `<div class="la-uc-img la-uc-img--fallback">${def.icon}</div>`;

    const traitsHtml = (def.traits || []).map(tid => {
      const t = typeof TRAIT_DEFS !== 'undefined' ? TRAIT_DEFS[tid] : null;
      return t ? `<div class="la-tt-row la-tt-row--trait"><b>${t.name}</b> — ${t.description}</div>` : '';
    }).join('');

    return `
      <div class="la-uc-wrap">
        <div class="la-unit-card${tier ? ' ' + tier : ''}">
          <div class="la-uc-top">
            <div class="la-uc-hpbar"><div class="la-uc-hpfill" style="width:100%;background:#4caf50"></div></div>
          </div>
          ${portrait}
        </div>
        <div class="la-uc-tooltip">
          <div class="la-tt-name">${def.name}</div>
          <div class="la-tt-stats">
            <span>⚔ ${s.attack}</span><span>🛡 ${s.defense}</span>
            <span>❤ ${s.hp}</span><span>💨 ${s.speed}</span>
          </div>
          ${traitsHtml ? `<div class="la-tt-section">${traitsHtml}</div>` : ''}
        </div>
      </div>`;
  }

  // Post-battle card — shows actual remaining HP and total damage dealt.
  // `dmg` is the total damage this unit TYPE dealt; shown on every card of that type.
  function _postBattleCard(def, isAlive, hpCur, hpMax, dmg) {
    const tier     = _tierClass(def.category);
    const hpPct    = isAlive ? Math.min(100, Math.max(0, Math.round((hpCur / hpMax) * 100))) : 0;
    const hpColor  = hpPct > 60 ? '#4caf50' : hpPct > 30 ? '#ff9800' : '#f44336';
    const portrait = def.image
      ? `<img src="${def.image}" class="la-uc-img" alt="${def.name}" loading="lazy">`
      : `<div class="la-uc-img la-uc-img--fallback">${def.icon}</div>`;

    const dmgBadge = dmg > 0
      ? `<div class="bsim-dmg-badge">⚔ ${dmg}</div>`
      : '';

    return `
      <div class="la-uc-wrap">
        <div class="la-unit-card${tier ? ' ' + tier : ''}${isAlive ? '' : ' bsim-card--dead'}">
          <div class="la-uc-top">
            <div class="la-uc-hpbar">
              <div class="la-uc-hpfill" style="width:${hpPct}%;background:${hpColor}"></div>
            </div>
          </div>
          ${portrait}
          ${dmgBadge}
        </div>
        <div class="la-uc-tooltip">
          <div class="la-tt-name">${def.name}${!isAlive ? ' ☠' : ''}</div>
          <div class="la-tt-stats">
            <span>❤ ${isAlive ? Math.round(hpCur) : 0}/${hpMax}</span>
            <span>⚔ ${def.combatStats?.attack}</span>
            <span>🛡 ${def.combatStats?.defense}</span>
          </div>
          ${dmg > 0 ? `<div class="la-tt-row" style="color:#e07050">Total dmg dealt: ${dmg}</div>` : ''}
        </div>
      </div>`;
  }

  // Renders one full-health card per model
  function _armyCards(counts) {
    return Object.entries(counts)
      .filter(([, c]) => c > 0)
      .flatMap(([uid, cnt]) => {
        const def = UNIT_DEFS[uid];
        return def ? Array.from({ length: cnt }, () => _simUnitCard(def)) : [];
      }).join('');
  }

  // Renders post-battle cards for one side.
  // sideData = report.attacker or report.defender
  // dmgMap   = { sourceId: totalDmgDealt }
  function _postBattleCards(sideData, dmgMap) {
    return sideData.unitsStart.flatMap(s => {
      const def    = UNIT_DEFS[s.sourceId];
      if (!def) return [];
      const surv   = sideData.unitsSurviving.find(u => u.sourceId === s.sourceId);
      const survCnt = surv?.count ?? 0;
      const avgHp  = surv?.avgHp  ?? def.combatStats?.hp ?? 100;
      const maxHp  = def.combatStats?.hp ?? 100;
      const dmg    = dmgMap[s.sourceId] || 0;

      return Array.from({ length: s.count }, (_, idx) => {
        const isAlive = idx < survCnt;
        return _postBattleCard(def, isAlive, isAlive ? avgHp : 0, maxHp, dmg);
      });
    }).join('');
  }

  // ── Army panel (steps 1 / 2) ───────────────────────────────────
  function _armyPanel(counts) {
    const total = _totalModels(counts);
    if (!total) {
      return `
        <div class="bsim-army-panel bsim-army-panel--empty">
          No units selected — use the catalog above
        </div>`;
    }
    return `
      <div class="bsim-army-panel">
        <div class="bsim-army-label">Your Army — ${total} / ${MAX_UNITS} units</div>
        <div class="la-unit-cards bsim-army-cards">${_armyCards(counts)}</div>
      </div>`;
  }

  // ── Progress bar ───────────────────────────────────────────────
  function _progressBar() {
    const steps  = [
      { id: 'attacker', label: '⚔ Attacker' },
      { id: 'defender', label: '🛡 Defender' },
      { id: 'battle',   label: '⚔ Battle'   },
    ];
    const ai = steps.findIndex(s => s.id === _step);
    return `
      <div class="bsim-progress">
        ${steps.map((s, i) => {
          const done = i < ai, active = i === ai;
          const cls  = active ? 'bsim-step--active' : done ? 'bsim-step--done' : 'bsim-step--pending';
          return `
            ${i > 0 ? `<div class="bsim-step-line${done ? ' bsim-step-line--done' : ''}"></div>` : ''}
            <div class="bsim-step ${cls}">
              <div class="bsim-step-dot">${done ? '✓' : i + 1}</div>
              <div class="bsim-step-lbl">${s.label}</div>
            </div>`;
        }).join('')}
      </div>`;
  }

  // ── Catalog card (with +/- controls) ──────────────────────────
  function _catalogCard(uid, counts) {
    const def    = UNIT_DEFS[uid];
    const s      = def.combatStats || {};
    const cnt    = counts[uid] || 0;
    const total  = _totalModels(counts);
    const canAdd = cnt < MAX_PER_TYPE && total < MAX_UNITS;

    const portrait = def.image
      ? `<img class="tt-uc-img" src="${def.image}" alt="${def.name}" loading="lazy">`
      : `<span class="tt-uc-icon">${def.icon}</span>`;

    const traitLabels = (def.traits || []).map(t => {
      const td = typeof TRAIT_DEFS !== 'undefined' ? TRAIT_DEFS[t] : null;
      return td ? td.name : t.replace(/_/g, ' ');
    });

    return `
      <div class="tt-unit-card bsim-selectable${cnt > 0 ? ' bsim-selectable--on' : ''}" data-uid="${uid}">
        <div class="tt-uc-portrait">
          ${portrait}
          ${cnt > 0 ? `<span class="bsim-count-badge">${cnt}</span>` : ''}
        </div>
        <div class="tt-uc-body">
          <div class="tt-uc-top"><span class="tt-unit-name">${def.name}</span></div>
          <div class="tt-unit-stats">
            <span class="tt-stat">⚔ ${s.attack ?? '—'}</span>
            <span class="tt-stat">🛡 ${s.defense ?? '—'}</span>
            <span class="tt-stat">❤ ${s.hp ?? '—'}</span>
            <span class="tt-stat">💨 ${s.speed ?? '—'}</span>
          </div>
          ${traitLabels.length ? `<div class="tt-traits">${traitLabels.slice(0, 4).map(t => `<span class="tt-trait">${t}</span>`).join('')}</div>` : ''}
        </div>
        <div class="bsim-card-ctrl">
          <button class="bsim-ctrl-btn bsim-ctrl-minus" data-uid="${uid}"${cnt === 0 ? ' disabled' : ''}>−</button>
          <span class="bsim-ctrl-cnt${cnt > 0 ? ' bsim-ctrl-cnt--on' : ''}">${cnt}</span>
          <button class="bsim-ctrl-btn bsim-ctrl-plus" data-uid="${uid}"${!canAdd ? ' disabled' : ''}>+</button>
        </div>
      </div>`;
  }

  // ── Builder step (1 or 2) ──────────────────────────────────────
  function _builderHtml() {
    const isAtk  = _step === 'attacker';
    const counts = isAtk ? _atkCounts : _defCounts;
    const race   = isAtk ? _atkRace   : _defRace;
    const total  = _totalModels(counts);

    const raceBar = `
      <div class="tt-race-bar bsim-race-bar">
        ${Object.values(RACES).map(r => `
          <button class="tt-race-btn${race === r.id ? ' tt-race-btn--active' : ''}" data-bsim-race="${r.id}">
            <span class="tt-race-icon">${r.icon}</span>
            <span class="tt-race-label">${r.name}</span>
          </button>`).join('')}
      </div>`;

    let bodyHtml = race
      ? (() => {
          const units = _raceUnits(race);
          return units.length
            ? `<div class="tt-unit-grid bsim-unit-grid">${units.map(uid => _catalogCard(uid, counts)).join('')}</div>`
            : `<div class="bsim-pick-race">No units defined for this race.</div>`;
        })()
      : `<div class="bsim-pick-race">← Select a race to browse its units</div>`;

    return `
      <div class="bsim-screen">
        <div class="bsim-header">
          <button class="bsim-back" id="bsim-back">←</button>
          <span class="bsim-title">${isAtk ? '⚔ Attacker Army' : '🛡 Defender Army'}</span>
          ${_progressBar()}
        </div>
        ${raceBar}
        <div class="bsim-body">${bodyHtml}</div>
        ${_armyPanel(counts)}
        <div class="bsim-footer">
          <div class="bsim-footer-info">${total}/${MAX_UNITS} units · max ${MAX_PER_TYPE} per type</div>
          <button class="bsim-next-btn${total > 0 ? '' : ' bsim-next-btn--off'}" id="bsim-next">
            ${isAtk ? 'Next: Defender →' : 'Next: Battle →'}
          </button>
        </div>
      </div>`;
  }

  // ── Battle step ────────────────────────────────────────────────
  function _battleHtml() {
    const atkRaceInfo = RACES[_atkRace] || {};
    const defRaceInfo = RACES[_defRace] || {};
    const terrainOpts = TERRAINS.map(t =>
      `<option value="${t.id}" ${_terrain === t.id ? 'selected' : ''}>${t.icon} ${t.label}</option>`
    ).join('');

    // Cards: pre-battle (full HP) or post-battle (actual HP + dmg badges)
    const atkCardHtml = _report
      ? _postBattleCards(_report.attacker, _report._atkDmg)
      : _armyCards(_atkCounts);
    const defCardHtml = _report
      ? _postBattleCards(_report.defender, _report._defDmg)
      : _armyCards(_defCounts);

    return `
      <div class="bsim-screen">
        <div class="bsim-header">
          <button class="bsim-back" id="bsim-back">←</button>
          <span class="bsim-title">⚔ Battle${_report ? ' — Results' : ' Preview'}</span>
          ${_progressBar()}
        </div>

        <div class="bsim-body bsim-body--battle">
          <div class="bsim-lineup">

            <div class="bsim-lineup-side bsim-lineup-atk">
              <div class="bsim-lineup-label">
                <span class="bsim-lineup-race">${atkRaceInfo.icon || ''} ${atkRaceInfo.name || ''}</span>
                ⚔ Attacker
              </div>
              <div class="la-unit-cards bsim-lineup-cards">${atkCardHtml}</div>
            </div>

            <div class="bsim-lineup-centre">
              <div class="bsim-vs">VS</div>
              <div class="bsim-terrain-block">
                <label class="bsim-terrain-label" for="bsim-terrain">🗺 Terrain</label>
                <select class="bsim-terrain-sel" id="bsim-terrain">${terrainOpts}</select>
              </div>
              <button class="bsim-sim-btn" id="bsim-simulate">
                ${_report ? '⟳ Re-run' : '⚔ Simulate'}
              </button>
            </div>

            <div class="bsim-lineup-side bsim-lineup-def">
              <div class="bsim-lineup-label">
                🛡 Defender
                <span class="bsim-lineup-race">${defRaceInfo.icon || ''} ${defRaceInfo.name || ''}</span>
              </div>
              <div class="la-unit-cards bsim-lineup-cards">${defCardHtml}</div>
            </div>

          </div>

          ${_report ? _reportHtml() : ''}
        </div>
      </div>`;
  }

  // ── Battle report (banner + log) ───────────────────────────────
  function _reportHtml() {
    const r = _report;
    const WINNER = {
      attacker: { label: '⚔ Attacker Wins!', cls: 'bsim-win--atk'  },
      defender: { label: '🛡 Defender Wins!', cls: 'bsim-win--def'  },
      draw:     { label: '⚖ Draw',            cls: 'bsim-win--draw' },
    };
    const REASONS = {
      eliminated: 'Enemy wiped out', routed: 'Enemy routed',
      retreated: 'Enemy retreated',  max_rounds: '10 rounds elapsed',
    };
    const { label: winLabel, cls: winCls } = WINNER[r.winner] || WINNER.draw;

    const PHASE  = { passive:'Passive', ranged:'Ranged', charge:'Charge', melee:'Melee', morale:'Morale', end_round:'EoR' };
    const RESULT = { hit:'hit', killed:'killed', eliminated:'ELIMINATED', miss:'miss', routed:'ROUTED', retreated:'RETREAT', healed:'healed' };

    const logRows = r.events.map(e => {
      const ph = PHASE[e.phase] || e.phase;
      const rs = RESULT[e.result] || e.result;
      const tr = e.trait ? ` [${e.trait.replace(/_/g,' ')}]` : '';
      if (e.result === 'healed') return `<div class="bsim-lrow bsim-lrow--heal">[R${e.round} ${ph}] ${e.actorName} — healed</div>`;
      if (e.damage === 0)        return `<div class="bsim-lrow bsim-lrow--morale">[R${e.round} ${ph}] ${e.actorName || ''} — ${rs}</div>`;
      return `<div class="bsim-lrow">[R${e.round} ${ph}] ${e.actorName} → ${e.targetName}${tr} ⚔${e.damage} — <em>${rs}</em></div>`;
    }).join('');

    return `
      <div class="bsim-report">
        <div class="bsim-report-banner ${winCls}">
          <div class="bsim-report-winner">${winLabel}</div>
          <div class="bsim-report-reason">${REASONS[r.reason] || r.reason} · ${r.rounds} round${r.rounds !== 1 ? 's' : ''} · Atk morale: ${Math.round(r.attacker.moraleEnd)} · Def morale: ${Math.round(r.defender.moraleEnd)}</div>
        </div>

        <button class="bsim-log-btn" id="bsim-log-btn">
          ${_logOpen ? '▲ Hide Battle Log' : '▼ Show Battle Log'} (${r.events.length} events)
        </button>
        ${_logOpen ? `<div class="bsim-log">${logRows}</div>` : ''}
      </div>`;
  }

  // ── Simulate ───────────────────────────────────────────────────
  function _simulate() {
    const atkEntries = Object.entries(_atkCounts).filter(([, c]) => c > 0);
    const defEntries = Object.entries(_defCounts).filter(([, c]) => c > 0);
    if (!atkEntries.length || !defEntries.length) {
      _toast('Both sides need at least one unit.');
      return;
    }

    // Build units and keep id→sourceId maps for damage attribution
    const atkUnits = atkEntries.map(([uid, cnt], i) => _makeBattleUnit(uid, cnt, 'a', i));
    const defUnits = defEntries.map(([uid, cnt], i) => _makeBattleUnit(uid, cnt, 'd', i));
    const atkMap   = {};  atkEntries.forEach(([uid], i) => { atkMap[`a_${i}`] = uid; });
    const defMap   = {};  defEntries.forEach(([uid], i) => { defMap[`d_${i}`] = uid; });

    _report = BattleEngine.resolve({
      terrain:  _terrain,
      attacker: { id: 'attacker', units: atkUnits, morale: 75 },
      defender: { id: 'defender', units: defUnits, morale: 75 },
    });

    // Compute total damage dealt per source unit id
    const atkDmg = {}, defDmg = {};
    _report.events.forEach(e => {
      if (!e.damage || e.damage <= 0) return;
      if (atkMap[e.actorId]) {
        const uid = atkMap[e.actorId];
        atkDmg[uid] = (atkDmg[uid] || 0) + e.damage;
      } else if (defMap[e.actorId]) {
        const uid = defMap[e.actorId];
        defDmg[uid] = (defDmg[uid] || 0) + e.damage;
      }
    });

    _report._atkDmg = atkDmg;
    _report._defDmg = defDmg;

    _logOpen = false;
    _rerender();
  }

  // ── Render / bind ──────────────────────────────────────────────
  function _rerender() {
    _root.innerHTML = _step === 'battle' ? _battleHtml() : _builderHtml();
    _bind();
  }

  function _bind() {
    document.getElementById('bsim-back')?.addEventListener('click', () => {
      if      (_step === 'attacker') App.navigate('overview', { player: _player, lord: _lord });
      else if (_step === 'defender') { _step = 'attacker'; _rerender(); }
      else                           { _step = 'defender'; _report = null; _rerender(); }
    });

    document.getElementById('bsim-next')?.addEventListener('click', () => {
      const counts = _step === 'attacker' ? _atkCounts : _defCounts;
      if (_totalModels(counts) === 0) { _toast('Add at least one unit first.'); return; }
      _step   = _step === 'attacker' ? 'defender' : 'battle';
      _report = null;
      _rerender();
    });

    // Race switch — keeps counts (cross-race armies are fine in the simulator)
    document.querySelectorAll('[data-bsim-race]').forEach(btn => {
      btn.addEventListener('click', e => {
        if (_step === 'attacker') _atkRace = e.currentTarget.dataset.bsimRace;
        else                      _defRace = e.currentTarget.dataset.bsimRace;
        _rerender();
      });
    });

    document.querySelectorAll('.bsim-ctrl-plus').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const uid    = e.currentTarget.dataset.uid;
        const counts = _step === 'attacker' ? _atkCounts : _defCounts;
        const cur    = counts[uid] || 0;
        if (_totalModels(counts) >= MAX_UNITS) { _toast(`Max ${MAX_UNITS} total units per side.`); return; }
        if (cur >= MAX_PER_TYPE)               { _toast(`Max ${MAX_PER_TYPE} of the same unit.`); return; }
        counts[uid] = cur + 1;
        _rerender();
      });
    });

    document.querySelectorAll('.bsim-ctrl-minus').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const uid    = e.currentTarget.dataset.uid;
        const counts = _step === 'attacker' ? _atkCounts : _defCounts;
        const cur    = counts[uid] || 0;
        if (cur <= 1) delete counts[uid];
        else          counts[uid] = cur - 1;
        _rerender();
      });
    });

    if (_step === 'battle') {
      document.getElementById('bsim-terrain')?.addEventListener('change', e => {
        _terrain = e.target.value;
      });
      document.getElementById('bsim-simulate')?.addEventListener('click', _simulate);
      document.getElementById('bsim-log-btn')?.addEventListener('click', () => {
        _logOpen = !_logOpen;
        _rerender();
      });
    }
  }

  function _toast(msg) {
    const c = document.getElementById('toast-container');
    if (!c) return;
    const el = document.createElement('div');
    el.className = 'toast'; el.textContent = msg;
    c.appendChild(el);
    setTimeout(() => el.remove(), 3000);
  }

  return { render };
})();
