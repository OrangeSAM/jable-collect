function getSiteLabel(site = 'jable') {
  return site === 'missav' ? 'MissAV' : 'Jable';
}

function hasSource(video, source, site = 'jable') {
  if (site === 'missav') {
    return source === 'all' || source === 'favorites';
  }

  if (source === 'favorites') return video.inFavorites || video.pageType === 'favorites';
  if (source === 'watchLater') return video.inWatchLater || video.pageType === 'watchLater';
  return true;
}

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

async function getAllVideosFromDB(site) {
  const response = await sendToBackground('getAllVideos', { site });
  if (!response.success) throw new Error(response.error);
  return response.videos;
}

async function deleteVideoFromDB(url, site) {
  const response = await sendToBackground('deleteVideo', { url, site });
  if (!response.success) throw new Error(response.error);
}

async function clearAllVideosFromDB(site) {
  const response = await sendToBackground('clearAllVideos', { site });
  if (!response.success) throw new Error(response.error);
}

async function importVideosToDB(videos, site) {
  const response = await sendToBackground('saveVideos', {
    videos,
    site,
    pageType: site === 'jable' ? 'favorites' : 'favorites'
  });
  if (!response.success) throw new Error(response.error);
  return response.count;
}

class OptionsManager {
  constructor() {
    this.activeSite = 'jable';
    this.allVideos = [];
    this.filteredVideos = [];
    this.currentPage = 1;
    this.pageSize = 24;
    this.sortField = 'original';
    this.sortOrder = 'asc';
    this.searchKeyword = '';
    this.sourceFilter = 'all';

    this.init();
  }

  async init() {
    this.cacheElements();
    this.bindEvents();
    this.renderSiteState();
    await this.loadVideos();
  }

  cacheElements() {
    this.siteTitleEl = document.getElementById('site-title');
    this.siteSubtitleEl = document.getElementById('site-subtitle');
    this.totalCountEl = document.getElementById('total-count');
    this.totalCountLabelEl = document.getElementById('total-count-label');
    this.displayCountEl = document.getElementById('display-count');
    this.videoListEl = document.getElementById('video-list');
    this.pageInfoEl = document.getElementById('page-info');
    this.prevBtnEl = document.getElementById('prev-btn');
    this.nextBtnEl = document.getElementById('next-btn');
    this.pageSizeEl = document.getElementById('page-size');
    this.searchInputEl = document.getElementById('search-input');
    this.sortSelectEl = document.getElementById('sort-select');
    this.siteTabsEl = document.getElementById('site-tabs');
    this.sourceTabsEl = document.getElementById('source-tabs');
    this.importFileEl = document.getElementById('import-file');
    this.toastEl = document.getElementById('toast');
  }

  async loadVideos() {
    try {
      this.showLoading();
      this.allVideos = await getAllVideosFromDB(this.activeSite);
      this.applyFiltersAndSort();
      this.renderVideoList();
      this.updateStats();
    } catch (error) {
      console.error('加载视频失败:', error);
      this.videoListEl.innerHTML = `
        <div class="empty-state">
          <svg class="empty-state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
          </svg>
          <h3>加载失败</h3>
          <p>${error.message}</p>
        </div>
      `;
    }
  }

  showLoading() {
    this.videoListEl.innerHTML = `
      <div class="loading">
        <div class="spinner"></div>
        <p>加载中...</p>
      </div>
    `;
  }

  renderSiteState() {
    this.siteTitleEl.textContent = getSiteLabel(this.activeSite);
    this.siteSubtitleEl.textContent = this.activeSite === 'missav' ? 'MissAV 收藏管理' : '视频收藏管理';
    this.totalCountLabelEl.textContent = this.activeSite === 'missav' ? '总收藏' : '总收藏';
    this.searchInputEl.placeholder = this.activeSite === 'missav' ? '搜索 MissAV 标题或番号...' : '搜索番号或标题...';
    this.sourceTabsEl.classList.toggle('hidden', this.activeSite === 'missav');

    this.siteTabsEl.querySelectorAll('.site-tab').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.site === this.activeSite);
    });

    this.sourceTabsEl.querySelectorAll('.source-tab').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.source === this.sourceFilter);
    });
  }

  applyFiltersAndSort() {
    let base = [...this.allVideos];

    if (this.activeSite === 'jable' && this.sourceFilter !== 'all') {
      base = base.filter(video => hasSource(video, this.sourceFilter, this.activeSite));
    }

    if (this.searchKeyword) {
      const lower = this.searchKeyword.toLowerCase();
      base = base.filter(video =>
        (video.videoId && video.videoId.toLowerCase().includes(lower)) ||
        (video.detailTitle && video.detailTitle.toLowerCase().includes(lower))
      );
    }

    this.filteredVideos = base;

    this.filteredVideos.sort((a, b) => {
      if (this.sortField === 'original') {
        return (a.order || 0) - (b.order || 0);
      }

      if (this.sortField === 'videoId') {
        const parseId = (id) => {
          const match = (id || '').match(/^([A-Z0-9]+)-?(\d+)$/i);
          return match ? [match[1].toUpperCase(), parseInt(match[2], 10)] : [(id || '').toUpperCase(), 0];
        };

        const [prefixA, numA] = parseId(a.videoId);
        const [prefixB, numB] = parseId(b.videoId);
        const dir = this.sortOrder === 'desc' ? -1 : 1;

        if (prefixA !== prefixB) return prefixA.localeCompare(prefixB) * dir;
        return (numA - numB) * dir;
      }

      return 0;
    });

    this.currentPage = 1;
  }

  getPaginatedVideos() {
    const start = (this.currentPage - 1) * this.pageSize;
    const end = start + this.pageSize;
    return this.filteredVideos.slice(start, end);
  }

  getTotalPages() {
    return Math.ceil(this.filteredVideos.length / this.pageSize) || 1;
  }

  getSourceInfo(video) {
    if (this.activeSite === 'missav') {
      return { label: 'MissAV', className: 'favorites' };
    }

    const inFavorites = hasSource(video, 'favorites', this.activeSite);
    const inWatchLater = hasSource(video, 'watchLater', this.activeSite);

    if (inFavorites && inWatchLater) {
      return { label: '双来源', className: 'both' };
    }

    if (inWatchLater) {
      return { label: '稍后观看', className: 'watch-later' };
    }

    return { label: '收藏', className: 'favorites' };
  }

  getEmptyStateDescription() {
    if (this.activeSite === 'missav') {
      return '请到 MissAV 的 /saved 页面同步数据';
    }

    if (this.sourceFilter === 'watchLater') {
      return '请到 Jable 稍后观看页面获取数据';
    }

    return '请到 Jable 收藏页面获取数据';
  }

  renderVideoList() {
    const videos = this.getPaginatedVideos();

    if (this.filteredVideos.length === 0) {
      this.videoListEl.innerHTML = `
        <div class="empty-state">
          <svg class="empty-state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z"/>
          </svg>
          <h3>暂无收藏</h3>
          <p>${this.getEmptyStateDescription()}</p>
        </div>
      `;
      this.updatePagination();
      return;
    }

    this.videoListEl.innerHTML = videos.map(video => {
      const source = this.getSourceInfo(video);
      return `
        <div class="video-card" data-url="${video.url || video.detailHref}">
          <div class="video-thumb">
            <img src="${video.imgDataSrc || video.imgSrc || ''}" alt="${video.videoId || ''}" loading="lazy">
            ${video.preview ? `<video class="video-preview" src="${video.preview}" muted loop preload="none"></video>` : ''}
          </div>
          <div class="video-content">
            <div class="video-title" title="${video.detailTitle || ''}">${video.detailTitle || '无标题'}</div>
            <div class="video-meta">
              <div class="video-tags">
                <span class="video-id-tag">${video.videoId || '未知'}</span>
                <span class="video-source-badge ${source.className}">${source.label}</span>
              </div>
            </div>
          </div>
        </div>
      `;
    }).join('');

    this.videoListEl.querySelectorAll('.video-card').forEach(card => {
      const preview = card.querySelector('video');
      if (preview) {
        card.addEventListener('mouseenter', () => {
          preview.play().catch(() => {});
        });

        card.addEventListener('mouseleave', () => {
          preview.pause();
          preview.currentTime = 0;
        });
      }

      card.addEventListener('click', () => {
        const url = card.dataset.url;
        if (url) window.open(url, '_blank');
      });
    });

    this.updatePagination();
  }

  updatePagination() {
    const totalPages = this.getTotalPages();
    this.pageInfoEl.textContent = `${this.currentPage} / ${totalPages}`;
    this.prevBtnEl.disabled = this.currentPage <= 1;
    this.nextBtnEl.disabled = this.currentPage >= totalPages;
  }

  updateStats() {
    this.totalCountEl.textContent = this.allVideos.length;
    this.displayCountEl.textContent = this.filteredVideos.length;
  }

  refresh() {
    this.applyFiltersAndSort();
    this.renderVideoList();
    this.updateStats();
  }

  async setSite(site) {
    if (!site || site === this.activeSite) return;
    this.activeSite = site;
    this.sourceFilter = 'all';
    this.searchKeyword = '';
    this.searchInputEl.value = '';
    this.currentPage = 1;
    this.renderSiteState();
    await this.loadVideos();
  }

  setSourceFilter(source) {
    if (this.activeSite === 'missav') return;
    this.sourceFilter = source;
    this.sourceTabsEl.querySelectorAll('.source-tab').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.source === source);
    });
    this.refresh();
  }

  async deleteVideo(url) {
    try {
      await deleteVideoFromDB(url, this.activeSite);
      await this.loadVideos();
      this.showToast('删除成功', 'success');
    } catch (error) {
      console.error('删除失败:', error);
      this.showToast('删除失败', 'error');
    }
  }

  setSort(field, order) {
    this.sortField = field;
    this.sortOrder = order;
    this.refresh();
  }

  setPage(page) {
    const totalPages = this.getTotalPages();
    if (page < 1) page = 1;
    if (page > totalPages) page = totalPages;
    this.currentPage = page;
    this.renderVideoList();
    this.updatePagination();
  }

  setPageSize(size) {
    this.pageSize = parseInt(size, 10);
    this.currentPage = 1;
    this.renderVideoList();
    this.updatePagination();
  }

  setSearch(keyword) {
    this.searchKeyword = keyword;
    this.refresh();
  }

  async exportData() {
    try {
      const videos = this.allVideos;
      const blob = new Blob([JSON.stringify(videos, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${this.activeSite}-favorites-${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
      this.showToast(`已导出 ${videos.length} 条数据`, 'success');
    } catch (error) {
      console.error('导出失败:', error);
      this.showToast('导出失败', 'error');
    }
  }

  async importData() {
    const file = this.importFileEl.files[0];
    if (!file) {
      this.showToast('请选择文件', 'error');
      return;
    }

    try {
      const text = await file.text();
      const videos = JSON.parse(text);

      if (!Array.isArray(videos)) {
        throw new Error('数据格式不正确');
      }

      if (confirm(`将导入 ${videos.length} 条 ${getSiteLabel(this.activeSite)} 数据，确定继续吗？`)) {
        await importVideosToDB(videos, this.activeSite);
        await this.loadVideos();
        this.showToast(`成功导入 ${videos.length} 条数据`, 'success');
      }
    } catch (error) {
      console.error('导入失败:', error);
      this.showToast('导入失败: ' + error.message, 'error');
    } finally {
      this.importFileEl.value = '';
    }
  }

  async clearData() {
    const siteLabel = getSiteLabel(this.activeSite);
    if (!confirm(`确定要清空 ${siteLabel} 的所有收藏数据吗？此操作不可恢复！`)) return;
    if (!confirm(`再次确认：${siteLabel} 数据将被永久删除！`)) return;

    try {
      await clearAllVideosFromDB(this.activeSite);
      await this.loadVideos();
      this.showToast('已清空当前站点数据', 'success');
    } catch (error) {
      console.error('清空失败:', error);
      this.showToast('清空失败', 'error');
    }
  }

  bindEvents() {
    this.siteTabsEl.addEventListener('click', async (event) => {
      const btn = event.target.closest('.site-tab');
      if (!btn) return;
      await this.setSite(btn.dataset.site);
    });

    this.sourceTabsEl.addEventListener('click', (event) => {
      const btn = event.target.closest('.source-tab');
      if (btn) this.setSourceFilter(btn.dataset.source);
    });

    this.searchInputEl.addEventListener('input', (event) => {
      this.setSearch(event.target.value);
    });

    this.sortSelectEl.addEventListener('change', (event) => {
      const [field, order] = event.target.value.split('-');
      this.setSort(field, order);
    });

    this.prevBtnEl.addEventListener('click', () => {
      this.setPage(this.currentPage - 1);
    });

    this.nextBtnEl.addEventListener('click', () => {
      this.setPage(this.currentPage + 1);
    });

    this.pageSizeEl.addEventListener('change', (event) => {
      this.setPageSize(event.target.value);
    });

    document.getElementById('export-data').addEventListener('click', () => {
      this.exportData();
    });

    document.getElementById('import-data').addEventListener('click', () => {
      this.importFileEl.click();
    });

    this.importFileEl.addEventListener('change', () => {
      this.importData();
    });

    document.getElementById('clear-data').addEventListener('click', () => {
      this.clearData();
    });
  }

  showToast(message, type) {
    this.toastEl.textContent = message;
    this.toastEl.className = `toast ${type} show`;
    setTimeout(() => {
      this.toastEl.className = 'toast';
    }, 3000);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new OptionsManager();
});
