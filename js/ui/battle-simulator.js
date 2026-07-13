// =============================================
//  battle-simulator.js — Standalone battle simulator
//
//  No lords, no gold limits. Build two armies
//  (up to 10 unit-type stacks per side, 1-5 models
//  each), pick a terrain, and run the battle engine.
//
//  Accessible from the sidebar nav. Mobile-first UI.
// =============================================

const BattleSimulator = (() => {

  let _root    = null;
  let _player  = null;
  let _lord    = null;

  // ── Mutable state ──────────────────────────────────────────────
  let _atkRace   = '';
  let _defRace   = '';
  let _atkCounts = {};   // { unitId: count }  (0 = not in army)
  let _defCounts = {};
  let _terrain   = 'plains';
  let _report    = null;
  let _logOpen   = false;

  const MAX_STACKS = 10;  // max distinct unit types per side
  const MAX_MODELS = 5;   // max models per unit type

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
    _root    = root;
    _player  = player;
    _lord    = lord;
    _report  = null;
    _logOpen = false;
    _rerender();
  }

  // ── Unit helpers ───────────────────────────────────────────────

  function _raceUnits(raceId) {
    const roster = UNIT_ROSTER[raceId];
    if (!roster) return [];
    const seen = new Set();
    const out  = [];
    Object.values(roster).forEach(levelMap => {
      Object.values(levelMap).flat().forEach(uid => {
        if (!seen.has(uid) && UNIT_DEFS[uid]) { seen.add(uid); out.push(uid); }
      });
    });
    return out;
  }

  function _unitRole(def) {
    if (def.category === 'ranged')   return 'ranged';
    if (def.category === 'cavalry')  return 'cavalry';
    if (def.category === 'monster' || def.category === 'legendary') return 'monster';
    if ((def.traits || []).includes('ranged')) return 'ranged';
    return 'infantry';
  }

  function _makeBattleUnit(unitId, count, prefix, idx) {
    const def = UNIT_DEFS[unitId];
    return {
      id:          `${prefix}_${idx}`,
      sourceId:    unitId,
      name:        def.name,
      role:        _unitRole(def),
      traits:      [...(def.traits    || [])],
      abilities:   [...(def.abilities || [])],
      maxHp:       def.combatStats?.hp      ?? 100,
      currentHp:   def.combatStats?.hp      ?? 100,
      attack:      def.combatStats?.attack  ?? 5,
      defense:     def.combatStats?.defense ?? 5,
      speed:       def.combatStats?.speed   ?? 5,
      leadership:  0,
      count,
      startCount:  count,
      isLord:      false,
      isRouting:   false,
      _frenzBonus: 0,
      _burning:    false,
    };
  }

  function _totalStacks(counts) {
    return Object.values(counts).filter(c => c > 0).length;
  }

  // ── Simulate ───────────────────────────────────────────────────

  function _simulate() {
    const atkEntries = Object.entries(_atkCounts).filter(([, c]) => c > 0);
    const defEntries = Object.entries(_defCounts).filter(([, c]) => c > 0);

    if (atkEntries.length === 0 || defEntries.length === 0) {
      _toast('Both sides need at least one unit.');
      return;
    }

    const atkUnits = atkEntries.map(([uid, cnt], i) => _makeBattleUnit(uid, cnt, 'a', i));
    const defUnits = defEntries.map(([uid, cnt], i) => _makeBattleUnit(uid, cnt, 'd', i));

    const ctx = {
      terrain:  _terrain,
      attacker: { id: 'attacker', units: atkUnits, morale: 75 },
      defender: { id: 'defender', units: defUnits, morale: 75 },
    };

    _report  = BattleEngine.resolve(ctx);
    _logOpen = false;
    _root.innerHTML = _resultHtml();
    _bindResult();
  }

  // ── HTML: setup ────────────────────────────────────────────────

  function _armyPanel(side, raceId, counts) {
    const stacks = _totalStacks(counts);

    const raceOptions = Object.values(RACES)
      .map(r => `<option value="${r.id}" ${raceId === r.id ? 'selected' : ''}>${r.icon} ${r.name}</option>`)
      .join('');

    const units = raceId ? _raceUnits(raceId) : [];

    const unitRows = units.map(uid => {
      const def    = UNIT_DEFS[uid];
      const cnt    = counts[uid] || 0;
      const canAdd = cnt < MAX_MODELS && (cnt > 0 || stacks < MAX_STACKS);
      const traitBadges = (def.traits || []).slice(0, 3)
        .map(t => `<span class="bsim-trait">${t.replace(/_/g, ' ')}</span>`).join('');
      return `
        <div class="bsim-unit-row${cnt > 0 ? ' bsim-unit-row--selected' : ''}">
          <span class="bsim-unit-icon">${def.icon || '⚔'}</span>
          <div class="bsim-unit-info">
            <span class="bsim-unit-name">${def.name}</span>
            <span class="bsim-unit-stats">⚔${def.combatStats?.attack ?? '?'} 🛡${def.combatStats?.defense ?? '?'} ❤${def.combatStats?.hp ?? '?'} 💨${def.combatStats?.speed ?? '?'}</span>
            ${traitBadges ? `<div class="bsim-traits">${traitBadges}</div>` : ''}
          </div>
          <div class="bsim-unit-ctrl">
            <button class="bsim-cnt-btn" data-side="${side}" data-unit="${uid}" data-delta="-1"${cnt === 0 ? ' disabled' : ''}>−</button>
            <span class="bsim-cnt-val${cnt > 0 ? ' bsim-cnt-val--active' : ''}">${cnt}</span>
            <button class="bsim-cnt-btn" data-side="${side}" data-unit="${uid}" data-delta="1"${!canAdd ? ' disabled' : ''}>+</button>
          </div>
        </div>`;
    }).join('');

    const rosterChips = Object.entries(counts)
      .filter(([, c]) => c > 0)
      .map(([uid, c]) => {
        const def = UNIT_DEFS[uid];
        return `<span class="bsim-chip">${def?.icon || '⚔'} ${def?.name} ×${c}</span>`;
      }).join('');

    const panelTitle = side === 'atk' ? '⚔ Attacker' : '🛡 Defender';

    return `
      <div class="bsim-panel">
        <div class="bsim-panel-hd">
          <span class="bsim-panel-title">${panelTitle}</span>
          ${stacks > 0 ? `<span class="bsim-stack-badge">${stacks}/${MAX_STACKS}</span>` : ''}
        </div>

        <select class="bsim-race-sel" data-side="${side}">
          <option value="">— Select Race —</option>
          ${raceOptions}
        </select>

        ${!raceId
          ? `<div class="bsim-placeholder">Select a race to see its units</div>`
          : units.length === 0
          ? `<div class="bsim-placeholder">No units defined for this race.</div>`
          : `<div class="bsim-unit-list">${unitRows}</div>`
        }

        ${rosterChips ? `
          <div class="bsim-roster">
            <div class="bsim-roster-chips">${rosterChips}</div>
            <button class="bsim-clear-btn" data-side="${side}">✕ Clear</button>
          </div>` : ''}
      </div>`;
  }

  function _setupHtml() {
    const terrainBtns = TERRAINS.map(t => `
      <button class="bsim-terrain-btn${_terrain === t.id ? ' bsim-terrain-btn--on' : ''}" data-terrain="${t.id}">
        <span class="bsim-terrain-icon">${t.icon}</span>
        <span class="bsim-terrain-label">${t.label}</span>
      </button>`).join('');

    const atkCount = _totalStacks(_atkCounts);
    const defCount = _totalStacks(_defCounts);
    const canSim   = atkCount > 0 && defCount > 0;

    return `
      <div class="bsim-screen">
        <div class="bsim-header">
          <button class="bsim-back" id="bsim-back">←</button>
          <span class="bsim-header-title">⚔ Battle Simulator</span>
        </div>

        <div class="bsim-body">
          ${_armyPanel('atk', _atkRace, _atkCounts)}

          <div class="bsim-terrain-section">
            <div class="bsim-section-label">🗺 Terrain</div>
            <div class="bsim-terrain-row">${terrainBtns}</div>
          </div>

          ${_armyPanel('def', _defRace, _defCounts)}
        </div>

        <div class="bsim-footer">
          <button class="bsim-sim-btn${canSim ? '' : ' bsim-sim-btn--disabled'}" id="bsim-simulate">
            ⚔ Simulate Battle
          </button>
        </div>
      </div>`;
  }

  // ── HTML: result ───────────────────────────────────────────────

  function _resultHtml() {
    const r = _report;

    const WINNER = {
      attacker: { label: '⚔ Attacker Wins!', cls: 'bsim-win--atk' },
      defender: { label: '🛡 Defender Wins!', cls: 'bsim-win--def' },
      draw:     { label: '⚖ Draw',            cls: 'bsim-win--draw' },
    };
    const REASONS = {
      eliminated: 'Enemy wiped out',
      routed:     'Enemy routed',
      retreated:  'Enemy retreated',
      max_rounds: '10 rounds elapsed',
    };

    const { label: winLabel, cls: winCls } = WINNER[r.winner] || WINNER.draw;

    function sideRows(sideData) {
      return sideData.unitsStart.map(s => {
        const def  = UNIT_DEFS[s.sourceId];
        const surv = sideData.unitsSurviving.find(u => u.sourceId === s.sourceId);
        const sc   = surv?.count ?? 0;
        const badge = sc === 0
          ? `<span class="bsim-badge bsim-badge--dead">☠ Dead</span>`
          : sc < s.count
          ? `<span class="bsim-badge bsim-badge--loss">🩹 Losses</span>`
          : `<span class="bsim-badge bsim-badge--ok">✓ Alive</span>`;
        return `
          <div class="bsim-res-row">
            <span class="bsim-res-icon">${def?.icon || '⚔'}</span>
            <span class="bsim-res-name">${def?.name || s.sourceId}</span>
            <span class="bsim-res-count">${sc}/${s.count}</span>
            ${badge}
          </div>`;
      }).join('');
    }

    const PHASE = { passive:'Passive', ranged:'Ranged', charge:'Charge', melee:'Melee', morale:'Morale', end_round:'EoR' };
    const RESULT = { hit:'hit', killed:'model killed', eliminated:'ELIMINATED', miss:'miss', routed:'ROUTED', retreated:'RETREAT', healed:'healed' };

    const logRows = r.events.map(e => {
      const ph = PHASE[e.phase] || e.phase;
      const rs = RESULT[e.result] || e.result;
      const tr = e.trait ? ` [${e.trait.replace(/_/g,' ')}]` : '';
      if (e.result === 'healed') {
        return `<div class="bsim-log-row bsim-log--heal">[R${e.round} ${ph}] ${e.actorName} regenerates — ${rs}</div>`;
      }
      if (e.damage === 0) {
        return `<div class="bsim-log-row bsim-log--morale">[R${e.round} ${ph}] ${e.actorName || ''} — ${rs}</div>`;
      }
      return `<div class="bsim-log-row">[R${e.round} ${ph}] ${e.actorName} → ${e.targetName}${tr} ⚔${e.damage} — <em>${rs}</em></div>`;
    }).join('');

    const atkLost = r.attacker.modelsLost;
    const defLost = r.defender.modelsLost;

    return `
      <div class="bsim-screen">
        <div class="bsim-header">
          <button class="bsim-back" id="bsim-back-result">←</button>
          <span class="bsim-header-title">Battle Result</span>
        </div>

        <div class="bsim-body bsim-body--result">
          <div class="bsim-result-banner ${winCls}">
            <div class="bsim-result-winner">${winLabel}</div>
            <div class="bsim-result-reason">${REASONS[r.reason] || r.reason} · ${r.rounds} round${r.rounds !== 1 ? 's' : ''}</div>
          </div>

          <div class="bsim-result-sides">
            <div class="bsim-res-side">
              <div class="bsim-res-side-title">⚔ Attacker</div>
              <div class="bsim-res-meta">Morale: ${r.attacker.moraleEnd} · Lost: ${atkLost}</div>
              ${sideRows(r.attacker)}
            </div>
            <div class="bsim-res-divider"></div>
            <div class="bsim-res-side">
              <div class="bsim-res-side-title">🛡 Defender</div>
              <div class="bsim-res-meta">Morale: ${r.defender.moraleEnd} · Lost: ${defLost}</div>
              ${sideRows(r.defender)}
            </div>
          </div>

          <button class="bsim-log-toggle" id="bsim-log-toggle">
            ${_logOpen ? '▲ Hide Battle Log' : '▼ Show Battle Log'} (${r.events.length} events)
          </button>
          ${_logOpen ? `<div class="bsim-log">${logRows}</div>` : ''}
        </div>

        <div class="bsim-footer bsim-footer--result">
          <button class="bsim-again-btn" id="bsim-again">⟳ Try Again</button>
          <button class="bsim-sim-btn" id="bsim-resim">⚔ Re-run Same</button>
        </div>
      </div>`;
  }

  // ── Events ─────────────────────────────────────────────────────

  function _rerender() {
    _root.innerHTML = _setupHtml();
    _bindSetup();
  }

  function _bindSetup() {
    document.getElementById('bsim-back')?.addEventListener('click', () => {
      App.navigate('overview', { player: _player, lord: _lord });
    });

    document.getElementById('bsim-simulate')?.addEventListener('click', _simulate);

    document.querySelectorAll('.bsim-race-sel').forEach(sel => {
      sel.addEventListener('change', e => {
        const side = e.target.dataset.side;
        if (side === 'atk') { _atkRace = e.target.value; _atkCounts = {}; }
        else                { _defRace = e.target.value; _defCounts = {}; }
        _rerender();
      });
    });

    document.querySelectorAll('.bsim-cnt-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        const btn    = e.currentTarget;
        const side   = btn.dataset.side;
        const uid    = btn.dataset.unit;
        const delta  = parseInt(btn.dataset.delta, 10);
        const counts = side === 'atk' ? _atkCounts : _defCounts;
        const cur    = counts[uid] || 0;
        const stacks = _totalStacks(counts);

        if (delta > 0 && cur === 0 && stacks >= MAX_STACKS) {
          _toast(`Max ${MAX_STACKS} unit types per side.`);
          return;
        }

        const next = Math.max(0, Math.min(MAX_MODELS, cur + delta));
        if (next === 0) delete counts[uid];
        else counts[uid] = next;

        _rerender();
      });
    });

    document.querySelectorAll('.bsim-terrain-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        _terrain = e.currentTarget.dataset.terrain;
        _rerender();
      });
    });

    document.querySelectorAll('.bsim-clear-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        const side = e.currentTarget.dataset.side;
        if (side === 'atk') _atkCounts = {};
        else _defCounts = {};
        _rerender();
      });
    });
  }

  function _bindResult() {
    document.getElementById('bsim-back-result')?.addEventListener('click', () => _rerender());
    document.getElementById('bsim-again')?.addEventListener('click', () => _rerender());

    document.getElementById('bsim-resim')?.addEventListener('click', () => {
      _simulate();
    });

    document.getElementById('bsim-log-toggle')?.addEventListener('click', () => {
      _logOpen = !_logOpen;
      _root.innerHTML = _resultHtml();
      _bindResult();
    });
  }

  function _toast(msg) {
    const c = document.getElementById('toast-container');
    if (!c) return;
    const el = document.createElement('div');
    el.className   = 'toast';
    el.textContent = msg;
    c.appendChild(el);
    setTimeout(() => el.remove(), 3000);
  }

  return { render };
})();
