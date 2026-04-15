function sendToBackground(action, data = {}) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ action, ...data }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(response);
      }
    });
  });
}

async function getVideoStats(site = 'jable') {
  const response = await sendToBackground('getVideoStats', { site });
  if (!response.success) throw new Error(response.error);
  return response.stats;
}

function getActiveTab() {
  return new Promise((resolve, reject) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(tabs[0] || null);
    });
  });
}

function sendMessageToTab(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(response);
      }
    });
  });
}

function formatSyncTime(timestamp) {
  if (!timestamp) return '未知时间';
  return new Date(timestamp).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function normalizePathname(pathname = '') {
  return pathname.replace(/\/+$/, '') || '/';
}

function getSiteLabel(site = 'jable') {
  return site === 'missav' ? 'MissAV' : 'Jable';
}

function getSourceLabel(pageType = 'favorites') {
  return pageType === 'watchLater' ? '稍后观看' : '收藏';
}

function getPageContext(url = '') {
  try {
    const parsedUrl = new URL(url);
    const pathname = normalizePathname(parsedUrl.pathname);

    if (parsedUrl.hostname === 'jable.tv') {
      if (pathname.startsWith('/my/favourites/videos-watch-later')) {
        return {
          supported: true,
          site: 'jable',
          type: 'watchLater',
          pageType: 'watchLater',
          title: '已检测到：稍后观看页',
          description: '可以直接同步当前稍后观看数据到本地数据库。',
          buttonText: '同步稍后观看'
        };
      }

      if (pathname.startsWith('/my/favourites/videos')) {
        return {
          supported: true,
          site: 'jable',
          type: 'favorites',
          pageType: 'favorites',
          title: '已检测到：收藏页',
          description: '可以直接同步当前收藏数据到本地数据库。',
          buttonText: '同步收藏'
        };
      }

      return {
        supported: false,
        site: 'jable',
        type: 'unsupported-jable',
        pageType: null,
        title: '当前不在可同步页面',
        description: '请前往 Jable 收藏页或稍后观看页，再从这里发起同步。',
        buttonText: '同步当前页面'
      };
    }

    if (parsedUrl.hostname === 'missav.ws' || parsedUrl.hostname === 'missav.ai' || parsedUrl.hostname === 'missav.live') {
      const segments = pathname.split('/').filter(Boolean);
      const isSavedPage = segments[segments.length - 1] === 'saved';

      if (isSavedPage) {
        return {
          supported: true,
          site: 'missav',
          type: 'missav-favorites',
          pageType: 'favorites',
          title: '已检测到：MissAV 收藏页',
          description: '可以直接同步当前 MissAV 收藏到本地数据库。',
          buttonText: '同步 MissAV 收藏'
        };
      }

      return {
        supported: false,
        site: 'missav',
        type: 'unsupported-missav',
        pageType: null,
        title: '当前不在 MissAV 收藏页',
        description: '请前往 MissAV 的 /saved 页面，再从这里发起同步。',
        buttonText: '同步当前页面'
      };
    }
  } catch (error) {
    return {
      supported: false,
      site: null,
      type: 'outside-supported-sites',
      pageType: null,
      title: '当前标签页不是支持站点',
      description: '请先打开 Jable 或 MissAV 的目标页面。',
      buttonText: '同步当前页面'
    };
  }

  return {
    supported: false,
    site: null,
    type: 'outside-supported-sites',
    pageType: null,
    title: '当前标签页不是支持站点',
    description: '请先打开 Jable 或 MissAV 的目标页面。',
    buttonText: '同步当前页面'
  };
}

class PopupManager {
  constructor() {
    this.activeTab = null;
    this.pageContext = getPageContext('');
    this.lastSyncStatus = null;
    this.isSyncing = false;
    this.init();
  }

  async init() {
    this.cacheElements();
    this.bindEvents();
    await this.detectActiveTab();
    await this.loadLastSyncStatus();
    await this.loadStats();
  }

  cacheElements() {
    this.totalCountEl = document.getElementById('total-count');
    this.bothCountEl = document.getElementById('both-count');
    this.favoritesCountEl = document.getElementById('favorites-count');
    this.watchLaterCountEl = document.getElementById('watch-later-count');
    this.totalLabelEl = document.getElementById('total-label');
    this.bothLabelEl = document.getElementById('both-label');
    this.favoritesLabelEl = document.getElementById('favorites-label');
    this.watchLaterLabelEl = document.getElementById('watch-later-label');
    this.statsSiteEl = document.getElementById('stats-site');
    this.pageTitleEl = document.getElementById('page-title');
    this.pageDescriptionEl = document.getElementById('page-description');
    this.syncNoteEl = document.getElementById('sync-note');
    this.syncButtonEl = document.getElementById('sync-button');
    this.openOptionsEl = document.getElementById('open-options');
    this.syncStatusEl = document.getElementById('sync-status');
    this.statusDotEl = document.getElementById('status-dot');
  }

  bindEvents() {
    this.syncButtonEl.addEventListener('click', () => this.handleSync());
    this.openOptionsEl.addEventListener('click', () => chrome.runtime.openOptionsPage());
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === 'local' && changes.lastSyncStatus) {
        this.lastSyncStatus = changes.lastSyncStatus.newValue || null;
        this.renderLastSyncStatus(this.lastSyncStatus);
        this.loadStats();
      }
    });
  }

  getDisplaySite() {
    return this.pageContext?.site || this.lastSyncStatus?.site || 'jable';
  }

  renderStats(stats, site) {
    this.statsSiteEl.textContent = `当前统计：${getSiteLabel(site)}`;
    this.totalLabelEl.textContent = site === 'missav' ? '总收藏' : '总视频';
    this.bothLabelEl.textContent = '双来源';
    this.favoritesLabelEl.textContent = '收藏';
    this.watchLaterLabelEl.textContent = '稍后观看';

    this.totalCountEl.textContent = stats.totalCount;
    this.bothCountEl.textContent = stats.bothCount;
    this.favoritesCountEl.textContent = stats.favoritesCount;
    this.watchLaterCountEl.textContent = stats.watchLaterCount;
  }

  async loadStats() {
    const site = this.getDisplaySite();

    try {
      const stats = await getVideoStats(site);
      this.renderStats(stats, site);
    } catch (error) {
      this.statsSiteEl.textContent = `当前统计：${getSiteLabel(site)}`;
      this.totalCountEl.textContent = '-';
      this.bothCountEl.textContent = '-';
      this.favoritesCountEl.textContent = '-';
      this.watchLaterCountEl.textContent = '-';
    }
  }

  async detectActiveTab() {
    try {
      this.activeTab = await getActiveTab();
      const url = this.activeTab?.url || '';
      this.pageContext = getPageContext(url);
      this.renderPageContext();
    } catch (error) {
      this.pageContext = getPageContext('');
      this.renderPageContext();
    }
  }

  renderPageContext() {
    this.pageTitleEl.textContent = this.pageContext.title;
    this.pageDescriptionEl.textContent = this.pageContext.description;
    this.syncButtonEl.textContent = this.pageContext.buttonText;
    this.syncButtonEl.disabled = !this.pageContext.supported || this.isSyncing;

    if (this.pageContext.supported && this.pageContext.site === 'missav') {
      this.syncNoteEl.textContent = '同步会调用当前 MissAV /saved 页面里的抓取逻辑，并把结果写入 MissAV 独立数据表。';
    } else if (this.pageContext.supported) {
      this.syncNoteEl.textContent = '同步会调用当前页面已有的抓取逻辑，并把结果写入本地数据库。';
    } else if (this.pageContext.type === 'unsupported-jable') {
      this.syncNoteEl.textContent = '可同步页面仅限 /my/favourites/videos 和 /my/favourites/videos-watch-later。';
    } else if (this.pageContext.type === 'unsupported-missav') {
      this.syncNoteEl.textContent = '可同步页面仅限 MissAV 的 /saved 页面。';
    } else {
      this.syncNoteEl.textContent = '先切到 Jable 或 MissAV 的目标页面，再打开 popup 即可一键同步。';
    }
  }

  async loadLastSyncStatus() {
    try {
      const { lastSyncStatus } = await chrome.storage.local.get('lastSyncStatus');
      this.lastSyncStatus = lastSyncStatus || null;
      this.renderLastSyncStatus(this.lastSyncStatus);
    } catch (error) {
      this.syncStatusEl.className = 'empty';
      this.syncStatusEl.textContent = '读取同步状态失败';
      this.statusDotEl.className = 'status-dot error';
    }
  }

  renderLastSyncStatus(status) {
    this.statusDotEl.className = 'status-dot';

    if (!status) {
      this.syncStatusEl.className = 'empty';
      this.syncStatusEl.textContent = '还没有同步记录';
      return;
    }

    if (status.state) {
      this.statusDotEl.classList.add(status.state);
    }

    const siteLabel = getSiteLabel(status.site);
    const sourceLabel = getSourceLabel(status.pageType);
    const targetLabel = status.site === 'missav' ? `${siteLabel}${sourceLabel}` : sourceLabel;
    const mainText = (() => {
      if (status.state === 'running') return `正在同步${targetLabel}`;
      if (status.state === 'success') return status.message || `成功同步 ${status.count || 0} 条${targetLabel}`;
      if (status.state === 'error') return status.message || `${targetLabel}同步失败`;
      return status.message || '状态未知';
    })();

    this.syncStatusEl.className = 'status-row';
    this.syncStatusEl.innerHTML = `
      <div class="status-main">${mainText}</div>
      <div class="status-meta">站点：${siteLabel}</div>
      <div class="status-meta">来源：${sourceLabel}</div>
      <div class="status-meta">更新时间：${formatSyncTime(status.updatedAt)}</div>
    `;
  }

  async handleSync() {
    if (!this.pageContext?.supported || !this.activeTab?.id || this.isSyncing) return;

    this.isSyncing = true;
    this.renderPageContext();
    this.syncButtonEl.textContent = '正在唤起同步…';

    try {
      const response = await sendMessageToTab(this.activeTab.id, { action: 'triggerSyncFromPopup' });
      if (response && response.success === false) {
        throw new Error(response.error || '触发同步失败');
      }
      this.syncButtonEl.textContent = '同步已开始';
      setTimeout(() => {
        this.isSyncing = false;
        this.renderPageContext();
      }, 800);
    } catch (error) {
      this.isSyncing = false;
      this.renderPageContext();
      this.syncStatusEl.className = 'status-row';
      this.syncStatusEl.innerHTML = `
        <div class="status-main">无法触发同步</div>
        <div class="status-meta">${error.message}</div>
      `;
      this.statusDotEl.className = 'status-dot error';
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new PopupManager();
});
