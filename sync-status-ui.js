(function initSyncStatusUI(root) {
  const STATE_LABELS = {
    idle: '准备同步',
    running: '同步进行中',
    success: '同步完成',
    error: '同步未完成'
  };

  function formatSyncTime(timestamp) {
    if (!timestamp) return '';
    return new Date(timestamp).toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  function getSyncStatusView(status, context) {
    const matches = status?.site === context.site && status?.pageType === context.pageType;
    if (!matches) {
      return {
        state: 'idle',
        title: STATE_LABELS.idle,
        message: `首次使用前，请先确认已登录 ${context.siteLabel}。同步数据只保存在当前浏览器。`,
        meta: '完成同步后，结果会一直保留在这里。'
      };
    }

    const state = STATE_LABELS[status.state] ? status.state : 'idle';
    const time = formatSyncTime(status.completedAt || status.updatedAt);
    const progress = status.progress;
    const progressText = progress?.total
      ? `${progress.round ? `第 ${progress.round}/2 轮 · ` : ''}${progress.page}/${progress.total} 页`
      : '';

    if (state === 'running') {
      return {
        state,
        title: STATE_LABELS.running,
        message: status.message || `正在同步 ${context.sourceLabel}`,
        meta: progressText || '可以切换到其他标签页，完成结果会保留。'
      };
    }

    if (state === 'success') {
      return {
        state,
        title: STATE_LABELS.success,
        message: status.message || `已同步 ${status.count || 0} 条${context.sourceLabel}`,
        meta: time ? `完成于 ${time}` : '同步结果已保存'
      };
    }

    if (state === 'error') {
      return {
        state,
        title: STATE_LABELS.error,
        message: status.message || `${context.sourceLabel}同步失败`,
        meta: `${time ? `${time} · ` : ''}原有本地数据已保留，可以稍后重试。`
      };
    }

    return {
      state: 'idle',
      title: STATE_LABELS.idle,
      message: status.message || `可以开始同步 ${context.sourceLabel}`,
      meta: time ? `最近更新于 ${time}` : ''
    };
  }

  function createPanel({ site, pageType, siteLabel, sourceLabel, container }) {
    const context = { site, pageType, siteLabel, sourceLabel };
    const panel = document.createElement('section');
    panel.id = `jable-collect-sync-status-${site}-${pageType}`;
    panel.setAttribute('role', 'status');
    panel.setAttribute('aria-live', 'polite');
    panel.style.cssText = `
      width: min(420px, calc(100vw - 32px));
      box-sizing: border-box;
      margin-top: 10px;
      padding: 12px 14px;
      border: 1px solid rgba(148, 163, 184, 0.28);
      border-left: 3px solid #94a3b8;
      border-radius: 12px;
      background: rgba(15, 18, 24, 0.94);
      color: #f8fafc;
      box-shadow: 0 10px 28px rgba(0, 0, 0, 0.24);
      font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      text-align: left;
    `;

    const heading = document.createElement('div');
    heading.style.cssText = 'display:flex;align-items:center;gap:8px;font-size:13px;font-weight:700;line-height:1.3;';
    const dot = document.createElement('span');
    dot.style.cssText = 'width:8px;height:8px;border-radius:999px;background:#94a3b8;box-shadow:0 0 0 4px rgba(148,163,184,.12);flex:0 0 auto;';
    const title = document.createElement('span');
    heading.append(dot, title);

    const message = document.createElement('div');
    message.style.cssText = 'margin-top:7px;font-size:13px;line-height:1.5;color:#e2e8f0;';
    const meta = document.createElement('div');
    meta.style.cssText = 'margin-top:5px;font-size:11px;line-height:1.45;color:#94a3b8;';
    panel.append(heading, message, meta);
    container.appendChild(panel);

    const render = (status) => {
      const view = getSyncStatusView(status, context);
      const colors = {
        idle: ['#94a3b8', 'rgba(148,163,184,.12)'],
        running: ['#f59e0b', 'rgba(245,158,11,.14)'],
        success: ['#22c55e', 'rgba(34,197,94,.14)'],
        error: ['#ef4444', 'rgba(239,68,68,.14)']
      };
      const [accent, glow] = colors[view.state] || colors.idle;
      panel.style.borderLeftColor = accent;
      dot.style.background = accent;
      dot.style.boxShadow = `0 0 0 4px ${glow}`;
      title.textContent = view.title;
      message.textContent = view.message;
      meta.textContent = view.meta;
    };

    const listener = (changes, areaName) => {
      if (areaName === 'local' && changes.lastSyncStatus) {
        render(changes.lastSyncStatus.newValue || null);
      }
    };

    if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
      chrome.storage.onChanged.addListener(listener);
      chrome.storage.local.get('lastSyncStatus').then(({ lastSyncStatus }) => {
        render(lastSyncStatus || null);
      }).catch(() => render(null));
    } else {
      render(null);
    }

    return { render, element: panel };
  }

  const api = { createPanel, formatSyncTime, getSyncStatusView };
  root.SyncStatusUI = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
