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

async function getVideoStats() {
  const response = await sendToBackground('getVideoStats');
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

function getPageContext(url = '') {
  if (url.startsWith('https://jable.tv/my/favourites/videos-watch-later')) {
    return {
      supported: true,
      type: 'watchLater',
      title: '已检测到：稍后观看页',
      description: '可以直接同步当前稍后观看数据到本地数据库。',
      buttonText: '同步稍后观看'
    };
  }

  if (url.startsWith('https://jable.tv/my/favourites/videos')) {
    return {
      supported: true,
      type: 'favorites',
      title: '已检测到：收藏页',
      description: '可以直接同步当前收藏数据到本地数据库。',
      buttonText: '同步收藏'
    };
  }

  if (url.startsWith('https://jable.tv/')) {
    return {
      supported: false,
      type: 'unsupported-jable',
      title: '当前不在可同步页面',
      description: '请前往 Jable 收藏页或稍后观看页，再从这里发起同步。',
      buttonText: '同步当前页面'
    };
  }

  return {
    supported: false,
    type: 'outside-jable',
    title: '当前标签页不是 Jable',
    description: '请先打开 Jable，再进入收藏页或稍后观看页。',
    buttonText: '同步当前页面'
  };
}

class PopupManager {
  constructor() {
    this.activeTab = null;
    this.pageContext = null;
    this.isSyncing = false;
    this.init();
  }

  async init() {
    this.cacheElements();
    this.bindEvents();
    await Promise.all([
      this.loadStats(),
      this.detectActiveTab(),
      this.loadLastSyncStatus()
    ]);
  }

  cacheElements() {
    this.totalCountEl = document.getElementById('total-count');
    this.bothCountEl = document.getElementById('both-count');
    this.favoritesCountEl = document.getElementById('favorites-count');
    this.watchLaterCountEl = document.getElementById('watch-later-count');
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
        const status = changes.lastSyncStatus.newValue || null;
        this.renderLastSyncStatus(status);
        if (status?.state === 'success') {
          this.loadStats();
        }
      }
    });
  }

  async loadStats() {
    try {
      const stats = await getVideoStats();
      this.totalCountEl.textContent = stats.totalCount;
      this.bothCountEl.textContent = stats.bothCount;
      this.favoritesCountEl.textContent = stats.favoritesCount;
      this.watchLaterCountEl.textContent = stats.watchLaterCount;
    } catch (error) {
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

    if (this.pageContext.supported) {
      this.syncNoteEl.textContent = '同步会调用当前页面已有的抓取逻辑，并把结果写入本地数据库。';
    } else if (this.pageContext.type === 'unsupported-jable') {
      this.syncNoteEl.textContent = '可同步页面仅限 /my/favourites/videos 和 /my/favourites/videos-watch-later。';
    } else {
      this.syncNoteEl.textContent = '先切到目标页面，再打开 popup 即可一键同步。';
    }
  }

  async loadLastSyncStatus() {
    try {
      const { lastSyncStatus } = await chrome.storage.local.get('lastSyncStatus');
      this.renderLastSyncStatus(lastSyncStatus || null);
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

    const sourceLabel = status.pageType === 'watchLater' ? '稍后观看' : '收藏';
    const mainText = (() => {
      if (status.state === 'running') return `正在同步${sourceLabel}`;
      if (status.state === 'success') return status.message || `成功同步 ${status.count || 0} 条${sourceLabel}`;
      if (status.state === 'error') return status.message || `${sourceLabel}同步失败`;
      return status.message || '状态未知';
    })();

    this.syncStatusEl.className = 'status-row';
    this.syncStatusEl.innerHTML = `
      <div class="status-main">${mainText}</div>
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
      await sendMessageToTab(this.activeTab.id, { action: 'triggerSyncFromPopup' });
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
