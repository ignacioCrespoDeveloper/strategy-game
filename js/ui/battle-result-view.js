// =============================================
//  battle-result-view.js — BattleResultView
//
//  Renders a BattleReport as a readable result screen.
//  On "Continuar" click: applies gold, XP, unit losses,
//  lord HP, then navigates back to the lord screen.
// =============================================

const BattleResultView = (() => {

  // ── Label helpers ───────────────────────────────────────────────

  const _PHASE_LABELS = {
    passive:   'Pasivo',
    ranged:    'Distancia',
    charge:    'Carga',
    melee:     'Melee',
    morale:    'Moral',
    end_round: 'Fin ronda',
  };

  const _RESULT_LABELS = {
    hit:        'golpe',
    killed:     'modelo muerto',
    eliminated: 'ELIMINADO',
    miss:       'esquivado',
    routed:     'DISPERSADO',
    retreated:  'RETIRADA',
    healed:     'curado',
  };

  const _REASON_LABELS = {
    eliminated: 'eliminación total',
    routed:     'dispersión',
    retreated:  'retirada',
    max_rounds: 'duración máxima',
  };

  function _phase(p)  { return _PHASE_LABELS[p]  || p; }
  function _result(r) { return _RESULT_LABELS[r] || r; }

  // ── Unit helpers ────────────────────────────────────────────────

  function _unitIcon(sourceId, lord) {
    if (lord && sourceId === lord.id) return '👑';
    return UNIT_DEFS[sourceId]?.icon || '⚔';
  }

  function _unitDisplayName(sourceId, lord) {
    if (lord && sourceId === lord.id) return lord.name;
    return UNIT_DEFS[sourceId]?.name || sourceId;
  }

  function _statusBadge(startCount, surv, maxHp) {
    const survCount = surv?.count ?? 0;
    if (survCount === 0)                                    return '<span class="br-badge br-badge--dead">☠ Muerto</span>';
    if (surv?.routed)                                       return '<span class="br-badge br-badge--wounded">🏃 Retirada</span>';
    if (survCount < startCount)                             return '<span class="br-badge br-badge--wounded">🩹 Bajas</span>';
    if (maxHp && surv?.avgHp != null && surv.avgHp < maxHp * 0.85) return '<span class="br-badge br-badge--wounded">🩹 Dañado</span>';
    return '<span class="br-badge br-badge--alive">✓ Vivo</span>';
  }

  // ── HTML builders ───────────────────────────────────────────────

  function _sideHtml(sideData, lord) {
    return sideData.unitsStart.map(s => {
      const surv      = sideData.unitsSurviving.find(u => u.sourceId === s.sourceId);
      const survCount = surv?.count ?? 0;
      const name      = _unitDisplayName(s.sourceId, lord);
      const icon      = _unitIcon(s.sourceId, lord);
      const isLord    = lord && s.sourceId === lord.id;
      const maxHp     = isLord ? null : (UNIT_DEFS[s.sourceId]?.combatStats?.hp ?? null);
      return `
        <div class="br-unit-row">
          <span class="br-unit-icon">${icon}</span>
          <span class="br-unit-name">${name}</span>
          <span class="br-unit-count">${survCount}/${s.count}</span>
          ${_statusBadge(s.count, surv, maxHp)}
        </div>`;
    }).join('');
  }

  function _logHtml(events) {
    return events.map(e => {
      const cls = `br-log-${e.result || 'hit'}`;

      // Morale events (no actor/target)
      if (!e.actorName || !e.targetName) {
        const icon = e.result === 'routed' ? '💥' : '🚶';
        return `<div class="br-log-line ${cls}">[R${e.round} ${_phase(e.phase)}] ${icon} ${_result(e.result)}</div>`;
      }

      // Heal events
      if (e.result === 'healed') {
        return `<div class="br-log-line ${cls}">[R${e.round} ${_phase(e.phase)}] ${e.actorName} ✚ ${-e.damage} curado</div>`;
      }

      const dmgStr    = e.damage > 0 ? ` ⚔ ${e.damage} dmg` : '';
      const traitStr  = e.trait  ? ` (${e.trait})`  : '';
      return `<div class="br-log-line ${cls}">[R${e.round} ${_phase(e.phase)}] ${e.actorName} → ${e.targetName}${dmgStr}${traitStr} — ${_result(e.result)}</div>`;
    }).join('');
  }

  // ── Reward application ──────────────────────────────────────────

  function _applyRewards(report, lord, player) {
    // Gold
    if (report.loot.gold > 0) {
      const p = PlayerService.getById(player.id);
      PlayerService.update(player.id, { coins: (p.coins || 0) + report.loot.gold });
    }

    // Refresh lord from storage, apply XP + level-up
    const freshLord = LordService.getById(lord.id);
    freshLord.xp    = (freshLord.xp || 0) + report.xpEarned;
    const leveled   = LordService.checkLevelUp(freshLord);

    // Lord HP + fallen state
    const lordSurv = report.attacker.unitsSurviving.find(u => u.sourceId === lord.id);
    if (lordSurv) {
      // Lord survived the battle
      freshLord.currentHp      = Math.max(1, Math.round(lordSurv.avgHp));
      freshLord.downtimeUntil  = null;
      freshLord.downtimeReason = null;
    } else {
      // Lord was eliminated — enter Fallen state (1 hour recovery, matching PvP)
      freshLord.currentHp      = 0;
      freshLord.downtimeUntil  = TimeService.now() + 60 * 60 * 1000;
      freshLord.downtimeReason = 'defeated';
      freshLord.actionQueue    = [];
    }

    LordService.save(freshLord);

    // Unit losses + sub-model HP damage (both persist to army stacks)
    const losses    = [];
    const hpUpdates = [];
    report.attacker.unitsStart
      .filter(s => s.sourceId !== lord.id)
      .forEach(s => {
        const surv       = report.attacker.unitsSurviving.find(u => u.sourceId === s.sourceId);
        const modelsLost = s.count - (surv?.count ?? 0);
        if (modelsLost > 0)             losses.push({ unitId: s.sourceId, modelsLost });
        if (surv && surv.count > 0)     hpUpdates.push({ unitId: s.sourceId, currentHp: surv.avgHp });
      });

    ArmyService.applyBattleLosses(lord.id, losses, hpUpdates);

    // Persist battle to history and activity feed
    const meta     = report._meta || {};
    const outcome  = report.winner === 'attacker' ? 'victory' : report.winner === 'draw' ? 'draw' : 'defeat';
    BattleHistoryService.save(lord.id, {
      outcome,
      campName:   meta.campName   || report.defender?.id || 'Enemigo',
      campIcon:   meta.campIcon   || '⚔',
      campLevel:  meta.campLevel  || null,
      terrain:    meta.terrain    || null,
      goldEarned: outcome === 'victory' ? report.loot.gold : 0,
      xpEarned:   report.xpEarned,
      modelsLost: report.attacker.modelsLost,
      rounds:     report.rounds,
      reason:     report.reason,
      report,
    });
    const actIcon  = outcome === 'victory' ? '⚔' : outcome === 'draw' ? '🤝' : '☠';
    const actTitle = outcome === 'victory'
      ? `Victoria: ${meta.campName || report.defender?.id || 'Enemigo'}`
      : outcome === 'draw'
        ? `Empate: ${meta.campName || report.defender?.id || 'Enemigo'}`
        : `Derrota: ${meta.campName || report.defender?.id || 'Enemigo'}`;
    ActivityService.log(player.id, {
      type:     `battle_${outcome}`,
      icon:     actIcon,
      title:    actTitle,
      detail:   `${report.rounds} rondas · bajas: ${report.attacker.modelsLost}${outcome === 'victory' ? ` · +${report.loot.gold}💰` : ''} · +${report.xpEarned}⭐`,
      lordName: lord.name,
    });

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

    root.innerHTML = `
      <div class="br-screen">
        <div class="br-banner ${isVictory ? 'br-banner--victory' : 'br-banner--defeat'}">
          <div class="br-banner-title">${isVictory ? '⚔ VICTORIA' : '☠ DERROTA'}</div>
          <div class="br-banner-reason">${_REASON_LABELS[report.reason] || report.reason}</div>
        </div>

        <div class="br-summary-row">
          <span>Rondas: <strong>${report.rounds}</strong></span>
          <span>Bajas propias: <strong>${report.attacker.modelsLost}</strong></span>
          <span>Moral final: <strong>${report.attacker.moraleEnd}</strong></span>
        </div>

        <div class="br-armies">
          <div class="br-army-col">
            <div class="br-army-header">Tu Ejército</div>
            ${_sideHtml(report.attacker, lord)}
          </div>
          <div class="br-vs-divider">VS</div>
          <div class="br-army-col">
            <div class="br-army-header">Enemigo</div>
            ${_sideHtml(report.defender, null)}
          </div>
        </div>

        <div class="br-loot-row">
          ${isVictory && report.loot.gold > 0
            ? `<span class="br-loot">+${report.loot.gold} 💰 oro</span>`
            : ''}
          <span class="br-xp">+${report.xpEarned} ⭐ XP</span>
        </div>

        <div class="br-log-section">
          <button class="br-log-toggle" id="br-log-toggle">📜 Registro de batalla</button>
          <div class="br-log-body hidden" id="br-log-body">
            ${_logHtml(report.events)}
          </div>
        </div>

        <button class="br-continue-btn" id="br-continue">Continuar →</button>
      </div>
    `;

    document.getElementById('br-log-toggle')?.addEventListener('click', () => {
      document.getElementById('br-log-body')?.classList.toggle('hidden');
    });

    document.getElementById('br-continue')?.addEventListener('click', () => {
      const { leveled, freshLord } = _applyRewards(report, lord, player);
      if (leveled > 0) _toast(`⭐ ¡Subiste de nivel! Ahora nivel ${freshLord.level}.`);
      const refreshedPlayer = PlayerService.getById(player.id);
      EventBus.emit('lord:open', { lord: freshLord, player: refreshedPlayer });
    });
  }

  return { render, applyRewards: _applyRewards };
})();
