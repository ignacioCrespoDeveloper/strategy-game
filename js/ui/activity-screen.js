// =============================================
//  activity-screen.js — Recent activity feed page
// =============================================

const ActivityScreen = (() => {
  let _player = null;

  function render(root, { player }) {
    _player = PlayerService.getById(player.id);
    ActivityService.markSeen(_player.id);
    Nav.refreshBadge();
    root.innerHTML = _html();
  }

  function _timeAgo(ms) {
    const secs = Math.floor(ms / 1000);
    if (secs < 60)          return 'just now';
    const mins = Math.floor(secs / 60);
    if (mins < 60)          return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24)         return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  }

  function _html() {
    const feed = ActivityService.get(_player.id);

    const TYPE_CSS = {
      battle_victory: 'af-victory',
      battle_defeat:  'af-defeat',
      battle_draw:    'af-draw',
      discovery:      'af-discovery',
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
          return `
            <div class="af-entry ${css}">
              <span class="af-icon">${e.icon}</span>
              <div class="af-body">
                <span class="af-title">${e.title}</span>
                ${e.detail ? `<span class="af-detail">${e.detail}</span>` : ''}
              </div>
              <div class="af-meta">
                ${e.lordName ? `<span class="af-lord">${e.lordName}</span>` : ''}
                <span class="af-time">${date}</span>
              </div>
            </div>`;
        }).join('');

    return `
      <div class="act-screen">
        <div class="act-header">
          <h1 class="act-title">📋 Recent Activity</h1>
          ${feed.length > 0 ? `<span class="act-count">${feed.length} event${feed.length !== 1 ? 's' : ''}</span>` : ''}
        </div>
        <div class="act-list af-list">${content}</div>
      </div>
    `;
  }

  return { render };
})();
