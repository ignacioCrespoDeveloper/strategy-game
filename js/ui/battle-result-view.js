// =============================================
//  battle-result-view.js — BattleResultView
//
//  Renders a BattleReport's round-by-round inline log, embedded in the
//  Lord Screen's Battles tab. Both PvE and PvP resolve entirely server-
//  side now — this file only formats an already-resolved report.
// =============================================

const BattleResultView = (() => {

  // ── Label helpers ───────────────────────────────────────────────

  const _PHASE_LABELS = {
    passive:   'Passive',
    ranged:    gi('high-shot') + ' Ranged',
    charge:    gi('power-lightning') + ' Charge',
    melee:     gi('crossed-swords') + ' Melee',
    morale:    gi('psychic-waves') + ' Morale',
    end_round: 'Round End',
  };

  const _REASON_LABELS = {
    eliminated: 'Total Elimination',
    routed:     'Morale Rout',
    retreated:  'Tactical Retreat',
    max_rounds: 'Max Duration',
  };

  // Compact "Victory/Defeat → cause" tag, framed from the viewer's side —
  // for PvE the viewer is always the attacker; for PvP they may be either,
  // so this always resolves relative to viewerIsDefenderSide rather than
  // assuming report.winner === 'attacker' means "I won".
  function _outcomeTag(report, viewerIsDefenderSide) {
    const { reason, winner } = report;
    if (winner === 'draw') return { cls: 'br-outcome--draw', label: 'Draw → Fought to a Standstill' };

    const viewerWon = winner === (viewerIsDefenderSide ? 'defender' : 'attacker');
    const result     = viewerWon ? 'Victory' : 'Defeat';
    const cls        = viewerWon ? 'br-outcome--win' : 'br-outcome--loss';

    let cause;
    switch (reason) {
      case 'eliminated': cause = viewerWon ? 'Enemy Wiped Out'        : 'Your Army Wiped Out'; break;
      case 'routed':      cause = viewerWon ? 'Enemy Morale Collapsed' : 'Your Morale Collapsed'; break;
      case 'retreated':   cause = viewerWon ? 'Enemy Retreated'        : 'You Retreated'; break;
      case 'max_rounds':  cause = viewerWon ? 'Stronger Force Remaining' : 'Weaker Force Remaining'; break;
      default:            cause = _REASON_LABELS[reason] || reason;
    }
    return { cls, label: `${result} → ${cause}` };
  }

  // Both sides' final morale, side by side — lets the outcome tag above be
  // verified at a glance instead of taken on faith.
  function _moraleCompareHtml(report, viewerIsDefenderSide) {
    const mine  = viewerIsDefenderSide ? report.defender : report.attacker;
    const theirs = viewerIsDefenderSide ? report.attacker : report.defender;
    return `
      <div class="br-morale-compare">
        <span>Your Morale: <strong>${mine.moraleEnd}</strong></span>
        <span>Enemy Morale: <strong>${theirs.moraleEnd}</strong></span>
      </div>`;
  }

  // ── Unit helpers ────────────────────────────────────────────────

  function _hpColor(pct) {
    if (pct >= 0.6) return '#4a9a4a';
    if (pct >= 0.3) return '#c8933a';
    return '#c05050';
  }

  // ── Round-by-round timeline ──────────────────────────────────────

  // viewerIsDefenderSide: true when the person looking at this log fought as
  // the report's `defender` side (PvP: a defending player opening their own
  // Battles tab). Events carry raw actorSide/targetSide ('attacker'/'defender'
  // per the *report's* fixed roles) — this flips them so "mine" always means
  // "the side the viewer actually fought on", regardless of who physically
  // initiated the attack.
  // opts: side-label overrides so neutral contexts (the battle simulator, which
  // has no "you") can relabel the mine/enemy tags as ATTACKER/DEFENDER while
  // reusing the exact same timeline rendering.
  function _timelineHtml(events, viewerIsDefenderSide, opts = {}) {
    if (!events || events.length === 0) return '<div class="br-no-events">No events recorded.</div>';

    const mineLabel  = opts.mineLabel  || 'YOU';
    const enemyLabel = opts.enemyLabel || 'ENEMY';
    const mineArmy   = opts.mineArmy   || 'Your army ';
    const enemyArmy  = opts.enemyArmy  || 'Enemy army ';
    // Optional per-unit icon: (event, 'actor'|'target') => html. Lets callers
    // (the battle simulator) prefix each unit name with a category-tinted glyph
    // without this component needing to know how to resolve a unit's category.
    const _icon = (e, role) => (typeof opts.iconFor === 'function' ? opts.iconFor(e, role) : '');

    const _isMine  = side => side ? ((side === 'attacker') !== !!viewerIsDefenderSide) : null;
    const _sideCls = mine => mine === null ? '' : mine ? ' br-tl-side--mine' : ' br-tl-side--enemy';
    const _sideTag = mine => mine === null ? '' : `<span class="br-tl-side-tag${mine ? ' br-tl-side-tag--mine' : ' br-tl-side-tag--enemy'}">${mine ? mineLabel : enemyLabel}</span>`;

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

        const phase      = _PHASE_LABELS[e.phase] || e.phase;
        const actorMine  = _isMine(e.actorSide);
        const targetMine = _isMine(e.targetSide);
        const actorCls   = _sideCls(actorMine);
        const targetCls  = _sideCls(targetMine);

        // Army-wide morale events (rout/retreat) carry no target — the engine
        // stamps a side name ('Attacker'/'Defender') as actorName, so key off
        // the missing target rather than a missing actor.
        if (!e.targetName) {
          const whoseArmy = actorMine === null ? '' : actorMine ? mineArmy : enemyArmy;
          return `<div class="${cls} br-tl-event--morale${actorCls}">
            <span class="br-tl-phase">${phase}</span>
            <span class="br-tl-desc">${gi('cannon')} ${whoseArmy}${e.result === 'routed' ? 'Routed' : 'Retreat'}</span>
          </div>`;
        }
        const actorCountStr = e.actorCount > 1 ? ` <span class="br-tl-count">×${e.actorCount}</span>` : '';

        if (isHeal) {
          return `<div class="${cls}">
            <span class="br-tl-phase">${phase}</span>
            ${_sideTag(actorMine)}
            <span class="br-tl-actor${actorCls}">${_icon(e, 'actor')}${e.actorName}</span>${actorCountStr}
            <span class="br-tl-arrow">${gi('health-normal')}</span>
            <span class="br-tl-heal">+${-e.damage} healed</span>
          </div>`;
        }

        const dmgStr   = e.damage > 0 ? `<span class="br-tl-dmg">${gi('crossed-swords')}${e.damage}</span>` : '';
        const traitStr = e.trait ? `<span class="br-tl-trait">[${e.trait}]</span>` : '';
        const armorStr = e.heavyArmor ? '<span class="br-tl-trait" title="Target\'s armor absorbed most of this hit">[heavy armor]</span>' : '';
        const killStr  = isKilled ? '<span class="br-tl-kill-tag">' + gi('death-skull') + ' KILL</span>'
                       : isEliminated ? '<span class="br-tl-elim-tag">' + gi('skull-crossed-bones') + ' ELIM</span>'
                       : isRouted ? '<span class="br-tl-rout-tag">' + gi('cannon') + ' ROUT</span>'
                       : '';

        return `<div class="${cls}">
          <span class="br-tl-phase">${phase}</span>
          ${_sideTag(actorMine)}
          <span class="br-tl-actor${actorCls}">${_icon(e, 'actor')}${e.actorName}</span>${actorCountStr}
          <span class="br-tl-arrow">→</span>
          ${_sideTag(targetMine)}
          <span class="br-tl-target${targetCls}">${_icon(e, 'target')}${e.targetName}</span>
          ${dmgStr}${traitStr}${armorStr}${killStr}
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

  // ── Inline embed (used in lord-screen battles tab) ─────────────

  // viewerLord: the lord whose Battles tab is currently open. report.attacker/
  // report.defender are FIXED by who physically attacked — they are NOT "me"
  // and "the enemy". A defending player opening their own battle log needs to
  // see their own army under "Your Army", even though they're report.defender.
  // opponentName: precomputed per-viewer label (BattleHistoryService record's
  // campName — the server already computed this correctly from each side's
  // perspective), used instead of guessing from the report itself.
  function _inlineReportHtml(report, viewerLord, opponentName) {
    if (!report) return '<em>Report unavailable</em>';

    const meta = report._meta || {};

    const viewerIsDefenderSide = !!viewerLord
      && (report.defender?.unitsStart || []).some(u => u.sourceId === viewerLord.id);

    const atkPortrait = viewerLord
      ? viewerLord.portrait || pickLordPortrait(viewerLord.race, viewerLord.classId, viewerLord.id) || null
      : null;

    // fullSide: report.attacker or report.defender (the whole side's unitsStart/
    // unitsSurviving — a participant group is a filtered slice of one of these,
    // not a separate array). matchesSourceId: which of that side's units belong
    // to this particular participant. stripPrefix: true for anything pulled
    // from report.defender, since only that side's sourceIds carry the
    // d{idx}_/garrison_ multi-participant prefix (see combat-resolver.js
    // _buildMultiContext) — attacker sourceIds are always bare unitIds.
    // lordPortrait: this participant's own lord portrait (viewer's own via
    // atkPortrait, or an enemy lord's via pickLordPortrait(meta race/classId)
    // — see groups construction below), or null for garrison (no lord).
    function participantCardsHtml(fullSide, matchesSourceId, stripPrefix, lordPortrait) {
      return fullSide.unitsStart.filter(s => matchesSourceId(s.sourceId)).flatMap(s => {
        const rawId = stripPrefix ? s.sourceId.replace(/^(d\d+|garrison)_/, '') : s.sourceId;
        const surv         = fullSide.unitsSurviving.find(u => u.sourceId === s.sourceId);
        const survCount    = surv?.count ?? 0;
        const isRoutedType = !!surv?.routed && survCount > 0;
        // Prefer maxHp baked into the report — lords aren't in UNIT_DEFS at all,
        // so falling back to it alone left their HP bar permanently at 0%.
        const maxHp = s.maxHp ?? UNIT_DEFS[rawId]?.combatStats?.hp ?? null;
        const avgHp = surv?.avgHp ?? 0;
        const hpPct = (maxHp && avgHp) ? Math.min(1, avgHp / maxHp) : 0;

        const isLord = !!s.isLord || !UNIT_DEFS[rawId];
        let img = null;
        if (!isLord) {
          img = UNIT_DEFS[rawId]?.image || null;
        } else if (lordPortrait) {
          img = lordPortrait;
        }
        const icon = isLord ? gi('crossed-swords') : (UNIT_DEFS[rawId]?.icon || gi('crossed-swords'));
        const name = s.name || (UNIT_DEFS[rawId]?.name) || rawId;
        const tier = isLord ? '' : unitTierClass(UNIT_DEFS[rawId]);

        return Array.from({ length: s.count }, (_, idx) => {
          const isAlive      = idx < survCount;
          const hpPctDisplay = isAlive ? Math.round(hpPct * 100) : 0;
          const portrait = img
            ? `<img src="${img}" class="la-uc-img" alt="${name}" loading="lazy">`
            : `<div class="la-uc-img la-uc-img--fallback">${icon}</div>`;
          const stateBadge = !isAlive
            ? `<div class="bsim-dmg-badge">${gi('skull-crossed-bones')}</div>`
            : isRoutedType ? `<div class="bsim-dmg-badge">${gi('run')}</div>` : '';
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
                  <span>${gi('hearts')} ${isAlive ? Math.round(avgHp) : 0}${maxHp ? `/${maxHp}` : ''}</span>
                  ${!isLord ? `<span>${gi('crossed-swords')} ${UNIT_DEFS[rawId]?.combatStats?.attack ?? '—'}</span><span>${gi('round-shield')} ${UNIT_DEFS[rawId]?.combatStats?.defense ?? '—'}</span>` : ''}
                </div>
                <div class="la-tt-row" style="color:${statusColor}">${statusWord}</div>
              </div>
            </div>`;
        });
      }).join('');
    }

    // One card group per real participant: the attacker (always exactly one —
    // there's no allied co-attack mechanic today), then each defending lord,
    // then the city garrison if present. Falls back to today's flattened
    // single-column-per-side shape when report._meta.defenderGroups is
    // missing — true for PvE reports (which stamp their own _meta.campName
    // instead) and for any battle history saved before this per-participant
    // metadata existed.
    // A participant's own portrait: the viewer's own lord always uses their
    // already-computed atkPortrait (their own local record — no need to
    // round-trip through meta); anyone else's lord uses the portrait the
    // server stamps onto _meta, which is that lord's own stored face, and
    // falls back to the deterministic race/classId hash for lords created
    // before portraits were persisted. Old reports without that metadata
    // simply get no portrait (icon fallback), same as before this fix.
    function lordPortraitFor(isMine, metaEntry) {
      if (isMine) return atkPortrait;
      if (!metaEntry?.race) return null;
      return metaEntry.portrait || pickLordPortrait(metaEntry.race, metaEntry.classId, metaEntry.lordId) || null;
    }

    const attackerIsMine = !viewerIsDefenderSide;
    const attackerLordName = attackerIsMine
      ? (viewerLord?.name || 'Your Lord')
      : (opponentName || meta.attacker?.lordName || 'Enemy Lord');
    const groups = [{
      isMine: attackerIsMine,
      isGarrison: false,
      lordLabel: attackerLordName,
      cardsHtml: participantCardsHtml(report.attacker, () => true, false, lordPortraitFor(attackerIsMine, meta.attacker)),
    }];

    if (meta.garrison || meta.defenderGroups) {
      if (meta.garrison) {
        groups.push({
          isMine: false,
          isGarrison: true,
          lordLabel: meta.garrison.cityName,
          cardsHtml: participantCardsHtml(report.defender, id => id.startsWith('garrison_'), true, null),
        });
      }
      (meta.defenderGroups || []).forEach((g, idx) => {
        const isMine = viewerIsDefenderSide && !!viewerLord && g.lordId === viewerLord.id;
        groups.push({
          isMine,
          isGarrison: false,
          lordLabel: g.lordName,
          cardsHtml: participantCardsHtml(
            report.defender,
            id => id === g.lordId || id.startsWith(`d${idx}_`),
            true, lordPortraitFor(isMine, g),
          ),
        });
      });
    } else {
      // Fallback: one flattened defender column, exactly like before this change.
      const isMine = viewerIsDefenderSide;
      groups.push({
        isMine,
        isGarrison: false,
        lordLabel: isMine ? (viewerLord?.name || 'Your Lord') : (opponentName || meta.campName || 'Enemy'),
        cardsHtml: participantCardsHtml(report.defender, () => true, true, lordPortraitFor(isMine, null)),
      });
    }

    function participantColHtml(g) {
      const colCls = g.isGarrison ? 'br-army-col--garrison' : (g.isMine ? 'br-army-col--mine' : 'br-army-col--enemy');
      const badge  = g.isGarrison ? gi('guarded-tower') + ' Garrison' : (g.isMine ? gi('crossed-swords') + ' Your Army' : gi('death-skull') + ' Enemy');
      return `
        <div class="br-army-col ${colCls}">
          <div class="br-army-header">
            <span class="br-army-label">${badge}</span>
            <span class="br-army-lord">${g.lordLabel}</span>
          </div>
          <div class="la-unit-cards">${g.cardsHtml}</div>
        </div>`;
    }

    const outcomeTag = _outcomeTag(report, viewerIsDefenderSide);

    // groups[0] is always the attacker (see construction above — pushed
    // first, exactly one entry, no allied-attacker mechanic exists). Laid
    // out as attacker-on-the-left vs. a vertical stack of every defender
    // participant on the right, rather than one flat wrapping row.
    const [attackerGroup, ...defenderGroups] = groups;

    return `
      <div class="br-inline-report">
        <div class="br-outcome-row">
          <span class="br-outcome-tag ${outcomeTag.cls}">${outcomeTag.label}</span>
          ${_moraleCompareHtml(report, viewerIsDefenderSide)}
        </div>
        <div class="br-armies">
          <div class="br-armies-attacker">${participantColHtml(attackerGroup)}</div>
          <div class="br-armies-defenders">${defenderGroups.map(participantColHtml).join('')}</div>
        </div>
        <div class="br-inline-timeline">
          <div class="br-tl-section-label">${gi('scroll-unfurled')} Round-by-Round Report</div>
          ${_timelineHtml(report.events, viewerIsDefenderSide)}
        </div>
      </div>`;
  }

  return { inlineReportHtml: _inlineReportHtml, timelineHtml: _timelineHtml };
})();
