// =============================================
//  action-confirm-view.js — Lord action confirmation
//
//  One confirmation screen for every non-attack lord action: Quest, Scout,
//  Raid. Mirrors attack-confirm-view.js (same .ac-* shell, same
//  header/body/footer contract, same Cancel/Confirm footer) so the player
//  learns the pattern once.
//
//  Why a screen and not an inline panel: each of these commits a lord for
//  minutes-to-hours and two of them can cost real assets. The player should
//  see duration, what's at stake, and what they stand to gain BEFORE
//  committing — exactly the contract the attack order already honours.
//
//  Routed as 'action-confirm' from js/ui/app.js.
//  Entered from the Location card's buttons in lord-screen.js.
// =============================================

const ActionConfirmView = (() => {

  let _player = null;
  let _lord   = null;
  let _action = 'quest';

  // Per-action chrome. `verb` is the footer button label.
  const _META = {
    quest: { title: 'Send on Quest', verb: 'Confirm Quest', icon: () => gi('magnifying-glass') },
    scout: { title: 'Scout Tile',    verb: 'Confirm Scout', icon: () => gi('spy') },
    raid:  { title: 'Raid Tile',     verb: 'Start Raiding', icon: () => STANCE_DEFS.raiding.icon },
  };

  // ── Shared pieces ─────────────────────────────────────────────

  function _lordCardHtml() {
    const race  = RACES[_lord.race] || {};
    const cls   = LORD_CLASSES[_lord.classId];
    const src   = _lord.portrait || pickLordPortrait(_lord.race, _lord.classId, _lord.id) || race.portrait;
    const pic   = src
      ? `<img src="${src}" class="ac-atk-portrait-img" alt="${_lord.name}" onerror="this.style.display='none'">`
      : `<div class="ac-atk-portrait-icon">${race.icon || gi('crossed-swords')}</div>`;
    const army  = ArmyService.get(_lord.id);
    const power = EconomyCore.getArmyPower(army.units, UNIT_DEFS);

    return `
      <div class="ac-atk-card">
        <div class="ac-atk-top">
          <div class="ac-atk-portrait">${pic}</div>
          <div class="ac-atk-info">
            <div class="ac-atk-name">${_lord.name}</div>
            <div class="ac-atk-meta">${race.name || ''} · ${cls ? `${cls.icon} ${cls.name}` : ''} · Lv ${_lord.level || 1}</div>
            <div class="ac-atk-pos">${gi('position-marker')} (${_lord.x}, ${_lord.y})</div>
          </div>
        </div>
      </div>
      <div class="ac-army-label">Your army — ${Math.round(power)} PWR</div>
      ${_armyHtml(army)}`;
  }

  function _armyHtml(army) {
    if (!army || army.units.length === 0) {
      return `<div class="ac-empty-army">This lord has no army</div>`;
    }
    return `<div class="ac-army-cards">${army.units.map(s => {
      const def = UNIT_DEFS[s.unitId];
      if (!def) return '';
      const tierClass = unitTierClass(def);
      const portrait = def.image
        ? `<img src="${def.image}" class="ac-unit-portrait" alt="${def.name}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
        : '';
      const fallback = `<div class="ac-unit-icon-fallback" style="${def.image ? 'display:none' : ''}">${def.icon}</div>`;
      return `
        <div class="ac-unit-slot">
          <div class="ac-unit-portrait-wrap${tierClass ? ` ${tierClass}` : ''}">
            ${portrait}${fallback}${giUnitType(def.category)}
          </div>
          <div class="ac-unit-name">${def.name}</div>
          <div class="ac-unit-count-label">×${s.count}</div>
        </div>`;
    }).filter(Boolean).join('')}</div>`;
  }

  function _tileCardHtml() {
    const terrain   = WorldService.getTerrain(_lord.x, _lord.y);
    const tileDiscs = DiscoveryService.getActive(_player.id)
      .filter(r => r.tileX === _lord.x && r.tileY === _lord.y);
    return `
      <div class="ac-enemy-card">
        <div class="ac-enemy-top">
          <div class="ac-enemy-portrait"><div class="ac-enemy-portrait-icon">${terrain.icon}</div></div>
          <div class="ac-enemy-info">
            <div class="ac-enemy-name">${terrain.name}</div>
            <div class="ac-enemy-meta">${gi('position-marker')} (${_lord.x}, ${_lord.y})</div>
            <div class="ac-enemy-stance">${tileDiscs.length > 0
              ? `${gi('magnifying-glass')} ${tileDiscs.length} pending quest${tileDiscs.length > 1 ? 's' : ''} here`
              : `${gi('magnifying-glass')} No pending quests here`}</div>
          </div>
        </div>
        <div class="acf-hint">${terrain.searchHint}</div>
      </div>`;
  }

  function _rowsHtml(rows) {
    return `<div class="acf-rows">${rows.map(r => `
      <div class="acf-row${r.warn ? ' acf-row--warn' : ''}">
        <span class="acf-row-label">${r.label}</span>
        <span class="acf-row-value">${r.value}</span>
      </div>`).join('')}</div>`;
  }

  // The wall-clock time an order of `secs` finishes at. Every Duration row is
  // paired with one of these: "how long" and "when" are different questions,
  // and a player deciding whether to commit a lord for 30 minutes is really
  // asking the second one. `verb` names what happens at that hour ("Returns",
  // "Reports", "Ends") rather than repeating "Finishes" three times.
  function _endsRow(secs, verb) {
    return { label: `${gi('hourglass')} ${verb}`, value: TimeService.endsAtClock(secs) };
  }

  // ── Quest ─────────────────────────────────────────────────────
  // The only action with a parameter to choose, so the length picker lives
  // here and every number below reacts to it.

  // Highest find tier this force can be offered at all — used only to phrase
  // the "you are capped at tier N" note honestly.
  function _bestTierFor(odds) {
    return odds.tier3 > 0 ? 3 : odds.tier2 > 0 ? 2 : 1;
  }

  function _questPanelHtml(lengthId) {
    const L    = DiscoveryRoll.lengthOf(lengthId);
    const secs = LordService.getActionDuration(_lord, 'search_area', L.id);

    const picker = Object.values(DiscoveryRoll.LENGTHS).map(o => {
      const s = LordService.getActionDuration(_lord, 'search_area', o.id);
      return `<button class="lov-len-btn${o.id === L.id ? ' lov-len-btn--active' : ''}" data-length="${o.id}">
                <span class="lov-len-name">${o.label}</span>
                <span class="lov-len-time">${TimeService.formatDuration(s)}</span>
                <span class="lov-len-mult">×${o.reward}</span>
              </button>`;
    }).join('');

    const searched  = DiscoveryService.getTileSearchCount(_lord.x, _lord.y);
    const depletion = DiscoveryService.getTileDepletion(_lord.x, _lord.y);

    // Footprint — the army you send is itself a choice. Shown here because a
    // player can still change it (leave troops behind) right up until Confirm.
    const army      = ArmyService.get(_lord.id);
    const armyPower = Math.round(EconomyCore.getArmyPower(army.units, UNIT_DEFS));
    const loudness  = DiscoveryRoll.loudnessOf(armyPower);
    const F         = DiscoveryRoll.FOOTPRINT;
    const noise     = loudness <= 0    ? 'Quiet'
                    : loudness < 0.34  ? 'Noticeable'
                    : loudness < 0.67  ? 'Loud'
                    :                    'Unmissable';

    // Expedition Rating band — needed BEFORE the rows because it now reshapes
    // the discovery roll itself (find quality and the odds of coming back
    // empty), not just which recruits will join. See RECRUIT_TIERS in
    // discovery-roll.js. Leaving it below would have made the "chance of
    // nothing" figure below silently wrong.
    // Mount ER bonus included — the server applies it when the expedition
    // resolves (catch-up.js), so leaving it out here would understate the
    // band and make the odds table below disagree with the actual result.
    const er   = Math.round(DiscoveryRoll.expeditionRating(army.units, UNIT_DEFS, LordService.getMountExpeditionErMult(_lord)));
    const tier = DiscoveryRoll.erTierFor(er);
    const next = [...DiscoveryRoll.RECRUIT_TIERS].reverse().find(t => t.er > er);

    // Real odds, not multipliers. `outcomeOdds` runs the same two-stage maths
    // rollDef does, so these percentages are what actually happens on this
    // tile with this force — "18% of finds come back tier 3" is a number a
    // player can act on; "rare finds ×2.60" is not.
    const terrainId = _lord.x != null ? WorldService.getTerrain(_lord.x, _lord.y).id : 'plains';
    const odds      = DiscoveryRoll.outcomeOdds(DISCOVERY_DEFS, terrainId, L.id, loudness, er);
    const pctOfFind = key => odds.find > 0 ? (100 * odds[key] / odds.find) : 0;
    const fmtOdds   = v => v <= 0 ? 'never' : v >= 10 ? `${v.toFixed(0)}%` : `${v.toFixed(1)}%`;

    const rows = [
      { label: `${gi('stopwatch')} Duration`,        value: TimeService.formatDuration(secs) },
      _endsRow(secs, 'Returns'),
      { label: `${gi('two-coins')} Reward`,          value: `×${(L.reward * (1 - F.reward * loudness)).toFixed(2)}` },
      { label: `${gi('fog')} Chance of nothing`,     value: `${Math.round(odds.nothing * 100)}%`, warn: loudness > 0 || tier.nothing > 1 },
      { label: `${gi('hazard-sign')} Ambush risk`,   value: `×${(L.risk * (1 + F.combat * loudness)).toFixed(2)}`, warn: loudness > 0 },
      {
        label: `${gi('crossed-swords')} Footprint`,
        value: `${noise} — ${armyPower} PWR`,
        warn: loudness > 0,
      },
      {
        // What an ambush would actually field against this army. Past
        // OVERMATCH_PWR it exceeds 100% — the single most important number
        // on this screen for a player about to march everything out.
        label: `${gi('death-skull')} If ambushed`,
        value: `~${Math.round(DiscoveryRoll.ambushRatioFor(armyPower) * 100)}% of your PWR`,
        warn: DiscoveryRoll.ambushRatioFor(armyPower) >= 1,
      },
      {
        label: `${gi('wheat')} Tile yield`,
        value: searched > 0
          ? `${Math.round(depletion * 100)}% — searched ${searched}× today`
          : '100% — untouched today',
        warn: depletion <= 0.55,
      },
    ];

    // Expedition Rating — what quality of FIND and of recruit this force can
    // attract, and whether there's room to actually keep a recruit. All three
    // matter: recruits that don't fit under the army cap are lost outright.
    const cap      = LordService.getArmyPowerCap(_lord);
    const headroom = Math.round(cap - armyPower);
    const heaviest = (tier.pool || []).reduce((m, id) => {
      const d = UNIT_DEFS[id];
      return d && EconomyCore.getUnitPower(d) > (m ? EconomyCore.getUnitPower(m) : 0) ? d : m;
    }, null);
    const heaviestPwr = heaviest ? Math.round(EconomyCore.getUnitPower(heaviest)) : 0;
    const cantHold    = heaviest && headroom < heaviestPwr;

    rows.push(
      {
        label: `${gi('spy')} Expedition Rating`,
        value: next ? `${er} — ${tier.label} (${next.er} for ${next.label})` : `${er} — ${tier.label}`,
      },
      {
        // The half of ER that used to be invisible: the same band that gates
        // recruits also decides which tiers of find this force is offered at
        // all. Shown as a share of FINDS, which is the question a player is
        // actually asking — "when I find something, how good will it be".
        label: `${gi('two-coins')} Find quality`,
        value: `T1 ${fmtOdds(pctOfFind('tier1'))} · T2 ${fmtOdds(pctOfFind('tier2'))} · T3 ${fmtOdds(pctOfFind('tier3'))}`,
        warn: pctOfFind('tier3') <= 0,
      },
      {
        label: `${gi('crossed-swords')} Room to recruit`,
        value: `${headroom} PWR free${heaviest ? ` · ${heaviest.name} needs ${heaviestPwr}` : ''}`,
        warn: cantHold,
      },
    );

    return `
      <div class="acf-panel-title">Expedition length</div>
      <div class="lov-len-picker" role="group" aria-label="Expedition length">${picker}</div>
      ${_rowsHtml(rows)}
      ${DiscoveryRoll.ambushRatioFor(armyPower) >= 1
        ? `<div class="acf-warn">${gi('death-skull')} A host this size draws everything down on it — an ambush here would outnumber you. Expeditions at full strength lose badly and lose expensively. Send half your army, not all of it.</div>`
        : loudness > 0
        ? `<div class="acf-warn">${gi('hazard-sign')} A column this size can't sneak. It gets jumped more often, comes back empty more often, and the quiet finds stay hidden. Leave troops at home — or bring scouts, which carry far less weight for what they find.</div>`
        : `<div class="acf-note">${gi('spy')} Small enough to move unseen — full value from every find.</div>`}
      ${pctOfFind('tier3') <= 0
        ? `<div class="acf-note">${gi('spy')} ${tier.label} rating — this force will only ever be shown tier ${_bestTierFor(odds)} ground. The richer sites are not merely rarer for it, they are closed to it.${next ? ` ${next.er - er} more Expedition Rating reaches ${next.label} and opens the next tier — and scouts count double toward it.` : ''}</div>`
        : ''}
      ${cantHold
        ? `<div class="acf-warn">${gi('hazard-sign')} Only ${headroom} PWR free — a ${heaviest.name} needs ${heaviestPwr} and would be turned away. Recruits that don't fit are lost, not queued. Disband or leave someone behind to make room.</div>`
        : ''}
      ${depletion <= 0.55
        ? `<div class="acf-warn">${gi('hazard-sign')} This ground is picked over. Move to a fresh tile to restore full value — XP is unaffected.</div>`
        : ''}`;
  }

  // ── Scout ─────────────────────────────────────────────────────

  function _scoutPanelHtml() {
    const secs = LordService.getActionDuration(_lord, 'scout');
    const rows = [
      { label: `${gi('stopwatch')} Duration`, value: TimeService.formatDuration(secs) },
      _endsRow(secs, 'Reports'),
      { label: `${gi('spy')} Gathers`,        value: 'Enemy city + lord intel on this tile' },
    ];
    return `
      <div class="acf-panel-title">Scouting report</div>
      ${_rowsHtml(rows)}
      <div class="acf-note">${gi('spy')} Scouting is safe — a scout is never intercepted.</div>`;
  }

  // ── Raid ──────────────────────────────────────────────────────

  function _raidPanelHtml(secs) {
    const def   = STANCE_DEFS.raiding;
    const hours = secs / 3600;
    const rates = (typeof LordScreen !== 'undefined' && LordScreen.raidHourlyPreview)
      ? LordScreen.raidHourlyPreview(_lord)
      : null;

    const picker = def.durations.map(s => `
      <button class="lov-len-btn${s === secs ? ' lov-len-btn--active' : ''}" data-raid-secs="${s}">
        <span class="lov-len-name">${TimeService.formatDuration(s)}</span>
      </button>`).join('');

    const rows = [
      { label: `${gi('stopwatch')} Duration`, value: TimeService.formatDuration(secs) },
      _endsRow(secs, 'Ends'),
    ];
    if (rates) {
      rows.push({ label: `${gi('two-coins')} Expected gold`, value: `~${Math.floor(rates.gold * hours).toLocaleString()}` });
      rows.push({ label: `${gi('wheat')} Each resource`,     value: `~${Math.floor(rates.food * hours).toLocaleString()}` });
    }
    rows.push({ label: `${gi('hazard-sign')} Risk`, value: 'Enemy arrivals force a battle', warn: true });

    return `
      <div class="acf-panel-title">Raid duration</div>
      <div class="lov-len-picker" role="group" aria-label="Raid duration">${picker}</div>
      ${_rowsHtml(rows)}
      <div class="acf-warn">${gi('hazard-sign')} Rewards are paid only when the raid ends. Any enemy lord with an army arriving here triggers an automatic fight — losing forfeits the raid and everything earned so far.</div>
      <div class="acf-note">${def.description}</div>`;
  }

  // ── Render ────────────────────────────────────────────────────

  // returnTo: 'lord-screen' (default) or 'map' — where Cancel and a completed
  // action send the player back to. The map's tile panel opens this screen
  // too, and dumping someone on the lord screen after they cancelled from the
  // map would lose their place on the board.
  function render(root, { player, lord, action, returnTo }) {
    _player = player;
    _lord   = lord;
    _action = _META[action] ? action : 'quest';

    // Local, screen-scoped parameter state. Deliberately not shared with
    // lord-screen: the choice only means anything on this screen, and it
    // resets each time so a stale pick can't be confirmed by accident.
    let questLength = DiscoveryRoll.DEFAULT_LENGTH;
    let raidSecs    = STANCE_DEFS.raiding.durations[0];

    const meta = _META[_action];

    const _back = () => (returnTo === 'map')
      ? App.navigate('map', { player: PlayerService.getById(player.id), lord: LordService.getById(lord.id) })
      : App.navigate('lord-screen', {
          player: PlayerService.getById(player.id),
          lord:   LordService.getById(lord.id),
        });

    function _paint() {
      const panel = _action === 'quest' ? _questPanelHtml(questLength)
                  : _action === 'scout' ? _scoutPanelHtml()
                  :                       _raidPanelHtml(raidSecs);

      root.innerHTML = `
        <div class="ac-screen">
          <div class="ac-header">
            <button class="ac-back-btn" id="acf-back">← Cancel</button>
            <h2 class="ac-title">${meta.icon()} ${meta.title}</h2>
          </div>

          <div class="ac-body">
            <div class="ac-columns">
              <div class="ac-col ac-col--atk">
                <div class="ac-col-label">${gi('crossed-swords')} YOUR LORD</div>
                ${_lordCardHtml()}
              </div>
              <div class="ac-col ac-col--enemy">
                <div class="ac-col-label">${gi('position-marker')} THIS TILE</div>
                ${_tileCardHtml()}
                <div class="acf-panel">${panel}</div>
              </div>
            </div>
          </div>

          <div class="ac-footer">
            <span class="acf-err" id="acf-err"></span>
            <button class="ac-cancel-btn" id="acf-cancel">Cancel</button>
            <button class="ac-confirm-btn" id="acf-confirm">${meta.icon()} ${meta.verb}</button>
          </div>
        </div>`;

      document.getElementById('acf-back')  ?.addEventListener('click', _back);
      document.getElementById('acf-cancel')?.addEventListener('click', _back);

      document.querySelectorAll('.lov-len-btn[data-length]').forEach(b => {
        b.addEventListener('click', () => { questLength = b.dataset.length; _paint(); });
      });
      document.querySelectorAll('.lov-len-btn[data-raid-secs]').forEach(b => {
        b.addEventListener('click', () => { raidSecs = Number(b.dataset.raidSecs); _paint(); });
      });

      document.getElementById('acf-confirm')?.addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        btn.disabled    = true;
        btn.textContent = 'Sending…';

        const result = _action === 'quest' ? await ServerActions.lordSearch(lord.id, questLength)
                     : _action === 'scout' ? await ServerActions.lordScout(lord.id)
                     :                       await ServerActions.raidStart(lord.id, raidSecs);

        if (!result.ok) {
          btn.disabled  = false;
          btn.innerHTML = `${meta.icon()} ${meta.verb}`;
          const err = document.getElementById('acf-err');
          if (err) err.textContent = result.error || 'Server error';
          return;
        }
        _back();
      });
    }

    _paint();
  }

  return { render };
})();
