// =============================================
//  activity-screen.js — Recent activity feed page
// =============================================

const ActivityScreen = (() => {
  let _player = null;

  function _timeAgo(ms) {
    const secs = Math.floor(ms / 1000);
    if (secs < 60)          return 'just now';
    const mins = Math.floor(secs / 60);
    if (mins < 60)          return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24)         return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  }

  function _isBattleEntry(e) {
    return e.type === 'pvp_result' || (e.type || '').startsWith('battle_');
  }

  function _html() {
    const feed = ActivityService.get(_player.id);

    const TYPE_CSS = {
      battle_victory: 'af-victory',
      battle_defeat:  'af-defeat',
      battle_draw:    'af-draw',
      discovery:      'af-discovery',
      scout_result:   'af-discovery',
      lord_moved:     'af-move',
      action_complete:'af-action',
    };

    const content = feed.length === 0
      ? `<div class="act-empty">
           <div class="act-empty-icon">📋</div>
           <div class="act-empty-text">No recent activity</div>
           <div class="act-empty-sub">Explore the map, fight battles, and manage your cities to see activity here.</div>
         </div>`
      : feed.slice(0, 60).map(e => {
          const css  = TYPE_CSS[e.type] || '';
          const date = _timeAgo(TimeService.now() - e.at);
          const reportLordId = e.lordId
            || LordService.getByPlayer(_player.id).find(l => l.name === e.lordName)?.id
            || null;
          const reportBtn = _isBattleEntry(e) && reportLordId
            ? `<button class="af-report-btn" data-lord-id="${reportLordId}" title="View battle report">📋 Report</button>`
            : '';
          return `
            <div class="af-entry ${css}" data-entry-id="${e.id}">
              <span class="af-icon">${e.icon}</span>
              <div class="af-body">
                <span class="af-title">${e.title}</span>
                ${e.detail ? `<span class="af-detail">${e.detail}</span>` : ''}
                ${reportBtn}
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
          <h1 class="act-title">📋 Recent Activity</h1>
          ${feed.length > 0 ? `<span class="act-count">${feed.length} event${feed.length !== 1 ? 's' : ''}</span>` : ''}
          ${feed.length > 0 ? `<button class="act-clear-btn" id="act-clear-all">Clear all</button>` : ''}
        </div>
        <div class="act-list af-list">${content}</div>
      </div>
    `;
  }

  function _bindEvents(root) {
    root.querySelectorAll('.af-report-btn[data-lord-id]').forEach(btn => {
      btn.addEventListener('click', () => {
        const lord = LordService.getById(btn.dataset.lordId);
        if (lord) App.navigate('lord-screen', { lord, player: _player, openTab: 'battles' });
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
