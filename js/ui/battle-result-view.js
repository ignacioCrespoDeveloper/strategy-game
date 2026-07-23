// =============================================
//  battle-result-view.js — BattleResultView
//
//  Renders a BattleReport as a readable result screen.
//  On "Continue" click: applies gold, XP, unit losses,
//  lord HP, then navigates back to the lord screen.
// =============================================

const BattleResultView = (() => {

  // ── Label helpers ───────────────────────────────────────────────

  const _PHASE_LABELS = {
    passive:   'Passive',
    ranged:    '🏹 Ranged',
    charge:    '⚡ Charge',
    melee:     '⚔ Melee',
    morale:    '💭 Morale',
    end_round: 'Round End',
  };

  const _RESULT_LABELS = {
    hit:        'hit',
    killed:     'model killed',
    eliminated: 'ELIMINATED',
    miss:       'missed',
    routed:     'ROUTED',
    retreated:  'RETREATED',
    healed:     'healed',
  };

  const _REASON_LABELS = {
    eliminated: 'Total Elimination',
    routed:     'Morale Rout',
    retreated:  'Tactical Retreat',
    max_rounds: 'Max Duration',
  };

  const _RES_ICONS = { wood: '🪵', stone: '⛏', iron: '⚒', food: '🌾' };

  // ── Unit helpers ────────────────────────────────────────────────

  function _unitDisplayName(unit) {
    // unit from unitsStart: { sourceId, name, count }
    if (unit.name) return unit.name;
    return UNIT_DEFS[unit.sourceId]?.name || unit.sourceId;
  }

  function _unitImage(sourceId) {
    return UNIT_DEFS[sourceId]?.image || null;
  }

  function _unitIcon(sourceId) {
    return UNIT_DEFS[sourceId]?.icon || '⚔';
  }

  function _hpColor(pct) {
    if (pct >= 0.6) return '#4a9a4a';
    if (pct >= 0.3) return '#c8933a';
    return '#c05050';
  }

  // Mirrors lord-screen/map-view/battle-simulator's tier styling (same CSS classes).
  function _cardTierClass(category) {
    if (category === 'mercenary') return 'la-unit-card--merc';
    if (category === 'elite' || category === 'cavalry') return 'la-unit-card--elite';
    if (category === 'monster') return 'la-unit-card--monster';
    if (category === 'legendary') return 'la-unit-card--legendary';
    return '';
  }

  // ── Unit card ────────────────────────────────────────────────────

  // One compact card per starting model — same visual language as the
  // battle simulator's lineup cards (portrait + top HP strip + hover tooltip).
  function _unitCardHtml(s, sideData) {
    const surv         = sideData.unitsSurviving.find(u => u.sourceId === s.sourceId);
    const survCount    = surv?.count ?? 0;
    const isRoutedType = !!surv?.routed && survCount > 0;
    const def   = UNIT_DEFS[s.sourceId];
    const maxHp = def?.combatStats?.hp ?? null;
    const avgHp = surv?.avgHp ?? 0;
    const hpPct = (maxHp && avgHp) ? Math.min(1, avgHp / maxHp) : 0;

    const img  = _unitImage(s.sourceId);
    const icon = _unitIcon(s.sourceId);
    const name = _unitDisplayName(s);
    const tier = _cardTierClass(def?.category);

    return Array.from({ length: s.count }, (_, idx) => {
      const isAlive      = idx < survCount;
      const hpPctDisplay = isAlive ? Math.round(hpPct * 100) : 0;
      const portrait = img
        ? `<img src="${img}" class="la-uc-img" alt="${name}" loading="lazy">`
        : `<div class="la-uc-img la-uc-img--fallback">${icon}</div>`;
      const stateBadge = !isAlive
        ? `<div class="bsim-dmg-badge">☠</div>`
        : isRoutedType ? `<div class="bsim-dmg-badge">🏃</div>` : '';
      const statusWord = !isAlive ? 'Dead' : isRoutedType ? 'Routed' : (hpPct < 0.85 ? 'Wounded' : 'Alive');
      const statusColor = !isAlive ? '#e07070' : isRoutedType ? '#c8933a' : 'var(--text-secondary)';

      return `
        <div class="la-uc-wrap">
          <div class="la-unit-card${tier ? ' ' + tier : ''}${!isAlive ? ' bsim-card--dead' : ''}">
            <div class="la-uc-top">
              <div class="la-uc-hpbar"><div class="la-uc-hpfill" style="width:${hpPctDisplay}%;background:${_hpColor(isAlive ? hpPct : 0)}"></div></div>
            </div>
            ${portrait}
            ${stateBadge}
          </div>
          <div class="la-uc-tooltip">
            <div class="la-tt-name">${name}</div>
            <div class="la-tt-stats">
              <span>❤ ${isAlive ? Math.round(avgHp) : 0}${maxHp ? `/${maxHp}` : ''}</span>
              <span>⚔ ${def?.combatStats?.attack ?? '—'}</span>
              <span>🛡 ${def?.combatStats?.defense ?? '—'}</span>
            </div>
            <div class="la-tt-row" style="color:${statusColor}">${statusWord}</div>
          </div>
        </div>`;
    }).join('');
  }

  function _sideHtml(sideData) {
    return sideData.unitsStart.map(s => _unitCardHtml(s, sideData)).join('');
  }

  // ── Round-by-round timeline ──────────────────────────────────────

  function _timelineHtml(events) {
    if (!events || events.length === 0) return '<div class="br-no-events">No events recorded.</div>';

    // Group events by round
    const byRound = {};
    events.forEach(e => {
      if (!byRound[e.round]) byRound[e.round] = [];
      byRound[e.round].push(e);
    });

    return Object.entries(byRound).map(([round, evts]) => {
      const roundEventsHtml = evts.map(e => {
        const isEliminated = e.result === 'eliminated';
        const isKilled     = e.result === 'killed';
        const isRouted     = e.result === 'routed' || e.result === 'retreated';
        const isHeal       = e.result === 'healed';
        const isMiss       = e.result === 'miss';

        let cls = 'br-tl-event';
        if (isEliminated || isRouted) cls += ' br-tl-event--major';
        if (isKilled)                 cls += ' br-tl-event--kill';
        if (isMiss)                   cls += ' br-tl-event--miss';
        if (isHeal)                   cls += ' br-tl-event--heal';

        const phase = _PHASE_LABELS[e.phase] || e.phase;

        if (!e.actorName && !e.targetName) {
          return `<div class="${cls} br-tl-event--morale">
            <span class="br-tl-phase">${phase}</span>
            <span class="br-tl-desc">💥 ${e.result === 'routed' ? 'Routed' : 'Retreat'}</span>
          </div>`;
        }
        if (isHeal) {
          return `<div class="${cls}">
            <span class="br-tl-phase">${phase}</span>
            <span class="br-tl-actor">${e.actorName}</span>
            <span class="br-tl-arrow">✚</span>
            <span class="br-tl-heal">+${-e.damage} healed</span>
          </div>`;
        }

        const dmgStr   = e.damage > 0 ? `<span class="br-tl-dmg">⚔${e.damage}</span>` : '';
        const traitStr = e.trait ? `<span class="br-tl-trait">[${e.trait}]</span>` : '';
        const killStr  = isKilled ? '<span class="br-tl-kill-tag">💀</span>'
                       : isEliminated ? '<span class="br-tl-elim-tag">☠ ELIM</span>'
                       : isRouted ? '<span class="br-tl-rout-tag">💥 ROUT</span>'
                       : '';

        return `<div class="${cls}">
          <span class="br-tl-phase">${phase}</span>
          <span class="br-tl-actor">${e.actorName}</span>
          <span class="br-tl-arrow">→</span>
          <span class="br-tl-target">${e.targetName}</span>
          ${dmgStr}${traitStr}${killStr}
        </div>`;
      }).join('');

      // Round summary: total damage dealt, kills
      const totalDmg = evts.filter(e => e.damage > 0 && e.result !== 'healed').reduce((s, e) => s + e.damage, 0);
      const kills    = evts.filter(e => e.result === 'killed' || e.result === 'eliminated').length;
      const summaryParts = [];
      if (totalDmg > 0) summaryParts.push(`${totalDmg} dmg total`);
      if (kills > 0)    summaryParts.push(`${kills} model${kills > 1 ? 's' : ''} killed`);

      return `
        <div class="br-tl-round">
          <div class="br-tl-round-header">
            <span class="br-tl-round-label">ROUND ${round}</span>
            ${summaryParts.length ? `<span class="br-tl-round-summary">${summaryParts.join(' · ')}</span>` : ''}
          </div>
          <div class="br-tl-events">${roundEventsHtml}</div>
        </div>`;
    }).join('');
  }

  // ── Reward application ──────────────────────────────────────────

  function _applyRewards(report, lord, player) {
    if (report.loot.gold > 0) {
      const p = PlayerService.getById(player.id);
      PlayerService.update(player.id, { coins: (p.coins || 0) + report.loot.gold });
    }

    const lootedResEntries = Object.entries(report.loot.resource || {});
    if (lootedResEntries.length > 0) {
      const city = (lord.x != null && CityService.getPlayerCities(player.id).find(c => c.x === lord.x && c.y === lord.y))
        || CityService.getPlayerCities(player.id)[0] || null;
      if (city) {
        city.resources = city.resources || {};
        lootedResEntries.forEach(([type, amount]) => {
          city.resources[type] = (city.resources[type] || 0) + amount;
        });
        CityService.save(city);
      }
    }

    const freshLord = LordService.getById(lord.id);
    freshLord.xp    = (freshLord.xp || 0) + report.xpEarned;
    const leveled   = LordService.checkLevelUp(freshLord);

    const lordSurv = report.attacker.unitsSurviving.find(u => u.sourceId === lord.id);
    if (lordSurv) {
      freshLord.currentHp      = Math.max(1, Math.round(lordSurv.avgHp));
      freshLord.downtimeUntil  = null;
      freshLord.downtimeReason = null;
    } else {
      freshLord.currentHp      = 0;
      freshLord.downtimeUntil  = TimeService.now() + 60 * 60 * 1000;
      freshLord.downtimeReason = 'defeated';
      freshLord.actionQueue    = [];
    }

    LordService.save(freshLord);

    const losses    = [];
    const hpUpdates = [];
    report.attacker.unitsStart
      .filter(s => s.sourceId !== lord.id)
      .forEach(s => {
        const surv       = report.attacker.unitsSurviving.find(u => u.sourceId === s.sourceId);
        const modelsLost = s.count - (surv?.count ?? 0);
        if (modelsLost > 0)         losses.push({ unitId: s.sourceId, modelsLost });
        if (surv && surv.count > 0) hpUpdates.push({ unitId: s.sourceId, currentHp: surv.avgHp });
      });

    ArmyService.applyBattleLosses(lord.id, losses, hpUpdates);

    const meta      = report._meta || {};
    const outcome   = report.winner === 'attacker' ? 'victory' : report.winner === 'draw' ? 'draw' : 'defeat';
    const resourceLoot = outcome === 'victory' ? report.loot.resource : null;
    BattleHistoryService.save(lord.id, {
      outcome,
      campName:   meta.campName   || report.defender?.id || 'Enemy',
      campIcon:   meta.campIcon   || '⚔',
      campLevel:  meta.campLevel  || null,
      terrain:    meta.terrain    || null,
      goldEarned: outcome === 'victory' ? report.loot.gold : 0,
      resourceLoot,
      xpEarned:   report.xpEarned,
      modelsLost: report.attacker.modelsLost,
      rounds:     report.rounds,
      reason:     report.reason,
      report,
    });

    const actIcon  = outcome === 'victory' ? '⚔' : outcome === 'draw' ? '🤝' : '☠';
    const actTitle = outcome === 'victory'
      ? `Victory: ${meta.campName || report.defender?.id || 'Enemy'}`
      : outcome === 'draw'
        ? `Draw: ${meta.campName || report.defender?.id || 'Enemy'}`
        : `Defeat: ${meta.campName || report.defender?.id || 'Enemy'}`;
    const resLabel = Object.entries(resourceLoot || {}).map(([t, amt]) => ` · +${amt} ${_RES_ICONS[t] || ''}`).join('');
    ActivityService.log(player.id, {
      type:     `battle_${outcome}`,
      icon:     actIcon,
      title:    actTitle,
      detail:   `${report.rounds} rounds · losses: ${report.attacker.modelsLost}${outcome === 'victory' ? ` · +${report.loot.gold}💰${resLabel}` : ''} · +${report.xpEarned}⭐`,
      lordName: lord.name,
    });

    // Honor points — PvE camps only (no _meta.pvpAttacker flag)
    if (!report._meta?.pvpAttacker) {
      if (report.winner === 'attacker') {
        RankingService.addHonor(player.id, 5);
      }
    }

    HUD.refresh();
    return { leveled, freshLord };
  }

  function _toast(msg) {
    const c = document.getElementById('toast-container');
    if (!c) return;
    const t = document.createElement('div');
    t.className   = 'toast';
    t.textContent = msg;
    c.appendChild(t);
    setTimeout(() => t.remove(), 3000);
  }

  // ── Public render ───────────────────────────────────────────────

  function render(root, { report, lord, player }) {
    const isVictory = report.winner === 'attacker';
    const isDraw    = report.winner === 'draw';
    const meta      = report._meta || {};
    const enemyName = meta.campName || 'Enemy';

    const bannerCls   = isVictory ? 'br-banner--victory' : isDraw ? 'br-banner--draw' : 'br-banner--defeat';
    const bannerLabel = isVictory ? '⚔ VICTORY' : isDraw ? '🤝 DRAW' : '☠ DEFEAT';

    const lootHtml = (isVictory || isDraw) ? `
      <div class="br-loot-row">
        ${report.loot.gold > 0 ? `<span class="br-loot-chip br-loot-gold">+${report.loot.gold} 💰</span>` : ''}
        ${Object.entries(report.loot.resource || {}).map(([type, amount]) =>
          `<span class="br-loot-chip">${_RES_ICONS[type] || ''} +${amount}</span>`).join('')}
        <span class="br-loot-chip br-loot-xp">+${report.xpEarned} ⭐ XP</span>
      </div>` : `
      <div class="br-loot-row">
        <span class="br-loot-chip br-loot-xp">+${report.xpEarned} ⭐ XP</span>
      </div>`;

    root.innerHTML = `
      <div class="br-screen">

        <div class="br-banner ${bannerCls}">
          <div class="br-banner-title">${bannerLabel}</div>
          <div class="br-banner-reason">${_REASON_LABELS[report.reason] || report.reason}</div>
        </div>

        <div class="br-summary-row">
          <span>Rounds: <strong>${report.rounds}</strong></span>
          <span>Own Losses: <strong>${report.attacker.modelsLost}</strong></span>
          <span>Enemy Losses: <strong>${report.defender.modelsLost}</strong></span>
          <span>Final Morale: <strong>${report.attacker.moraleEnd}</strong></span>
        </div>

        <div class="br-armies">
          <div class="br-army-col">
            <div class="br-army-header">
              <span class="br-army-label">⚔ Your Army</span>
              <span class="br-army-lord">${lord.name}</span>
            </div>
            <div class="la-unit-cards">${_sideHtml(report.attacker)}</div>
          </div>
          <div class="br-vs-divider">VS</div>
          <div class="br-army-col">
            <div class="br-army-header">
              <span class="br-army-label">💀 Enemy</span>
              <span class="br-army-lord">${enemyName}</span>
            </div>
            <div class="la-unit-cards">${_sideHtml(report.defender)}</div>
          </div>
        </div>

        ${lootHtml}

        <div class="br-timeline-section">
          <button class="br-log-toggle" id="br-log-toggle">📜 Detailed Round-by-Round Report</button>
          <div class="br-timeline-body hidden" id="br-log-body">
            ${_timelineHtml(report.events)}
          </div>
        </div>

        <button class="br-continue-btn" id="br-continue">Continue →</button>
      </div>
    `;

    document.getElementById('br-log-toggle')?.addEventListener('click', () => {
      document.getElementById('br-log-body')?.classList.toggle('hidden');
    });

    document.getElementById('br-continue')?.addEventListener('click', () => {
      const { leveled, freshLord } = _applyRewards(report, lord, player);
      if (leveled > 0) _toast(`⭐ Level up! Now level ${freshLord.level}.`);
      const refreshedPlayer = PlayerService.getById(player.id);
      EventBus.emit('lord:open', { lord: freshLord, player: refreshedPlayer });
    });
  }

  // ── Inline embed (used in lord-screen battles tab) ─────────────

  function _inlineReportHtml(report, attackerLord) {
    if (!report) return '<em>Report unavailable</em>';

    const meta      = report._meta || {};
    const enemyName = meta.campName || report.defender?.id || 'Enemy';

    const atkPortrait = attackerLord
      ? pickLordPortrait(attackerLord.race, attackerLord.classId, attackerLord.id) || null
      : null;

    function sideCardsHtml(sideData, isDefender) {
      return sideData.unitsStart.flatMap(s => {
        const rawId = isDefender ? s.sourceId.replace(/^d\d+_/, '') : s.sourceId;
        const surv         = sideData.unitsSurviving.find(u => u.sourceId === s.sourceId);
        const survCount    = surv?.count ?? 0;
        const isRoutedType = !!surv?.routed && survCount > 0;
        const maxHp = UNIT_DEFS[rawId]?.combatStats?.hp ?? null;
        const avgHp = surv?.avgHp ?? 0;
        const hpPct = (maxHp && avgHp) ? Math.min(1, avgHp / maxHp) : 0;

        const isLord = !UNIT_DEFS[rawId];
        let img = null;
        if (!isLord) {
          img = UNIT_DEFS[rawId]?.image || null;
        } else if (!isDefender && atkPortrait) {
          img = atkPortrait;
        }
        const icon = isLord ? '⚔' : (UNIT_DEFS[rawId]?.icon || '⚔');
        const name = s.name || (UNIT_DEFS[rawId]?.name) || rawId;
        const tier = isLord ? '' : _cardTierClass(UNIT_DEFS[rawId]?.category);

        return Array.from({ length: s.count }, (_, idx) => {
          const isAlive      = idx < survCount;
          const hpPctDisplay = isAlive ? Math.round(hpPct * 100) : 0;
          const portrait = img
            ? `<img src="${img}" class="la-uc-img" alt="${name}" loading="lazy">`
            : `<div class="la-uc-img la-uc-img--fallback">${icon}</div>`;
          const stateBadge = !isAlive
            ? `<div class="bsim-dmg-badge">☠</div>`
            : isRoutedType ? `<div class="bsim-dmg-badge">🏃</div>` : '';
          const statusWord = !isAlive ? 'Dead' : isRoutedType ? 'Routed' : (hpPct < 0.85 ? 'Wounded' : 'Alive');
          const statusColor = !isAlive ? '#e07070' : isRoutedType ? '#c8933a' : 'var(--text-secondary)';

          return `
            <div class="la-uc-wrap">
              <div class="la-unit-card${tier ? ' ' + tier : ''}${!isAlive ? ' bsim-card--dead' : ''}">
                <div class="la-uc-top">
                  <div class="la-uc-hpbar"><div class="la-uc-hpfill" style="width:${hpPctDisplay}%;background:${_hpColor(isAlive ? hpPct : 0)}"></div></div>
                </div>
                ${portrait}
                ${stateBadge}
              </div>
              <div class="la-uc-tooltip">
                <div class="la-tt-name">${name}</div>
                <div class="la-tt-stats">
                  <span>❤ ${isAlive ? Math.round(avgHp) : 0}${maxHp ? `/${maxHp}` : ''}</span>
                  ${!isLord ? `<span>⚔ ${UNIT_DEFS[rawId]?.combatStats?.attack ?? '—'}</span><span>🛡 ${UNIT_DEFS[rawId]?.combatStats?.defense ?? '—'}</span>` : ''}
                </div>
                <div class="la-tt-row" style="color:${statusColor}">${statusWord}</div>
              </div>
            </div>`;
        });
      }).join('');
    }

    const lordName = attackerLord?.name || 'Your Lord';

    return `
      <div class="br-inline-report">
        <div class="br-armies">
          <div class="br-army-col">
            <div class="br-army-header">
              <span class="br-army-label">⚔ Your Army</span>
              <span class="br-army-lord">${lordName}</span>
            </div>
            <div class="la-unit-cards">${sideCardsHtml(report.attacker, false)}</div>
          </div>
          <div class="br-vs-divider">VS</div>
          <div class="br-army-col">
            <div class="br-army-header">
              <span class="br-army-label">💀 Enemy</span>
              <span class="br-army-lord">${enemyName}</span>
            </div>
            <div class="la-unit-cards">${sideCardsHtml(report.defender, true)}</div>
          </div>
        </div>
        <div class="br-inline-timeline">
          <div class="br-tl-section-label">📜 Round-by-Round Report</div>
          ${_timelineHtml(report.events)}
        </div>
      </div>`;
  }

  return { render, applyRewards: _applyRewards, inlineReportHtml: _inlineReportHtml };
})();
