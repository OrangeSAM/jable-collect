// ========== 与 background.js 通信 ==========

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

async function getAllVideosFromDB() {
  const response = await sendToBackground('getAllVideos');
  if (!response.success) throw new Error(response.error);
  return response.videos;
}

async function deleteVideoFromDB(url) {
  const response = await sendToBackground('deleteVideo', { url });
  if (!response.success) throw new Error(response.error);
}

async function clearAllVideosFromDB() {
  const response = await sendToBackground('clearAllVideos');
  if (!response.success) throw new Error(response.error);
}

async function importVideosToDB(videos) {
  const response = await sendToBackground('saveVideos', { videos });
  if (!response.success) throw new Error(response.error);
  return response.count;
}

// ========== 页面逻辑 ==========

class OptionsManager {
  constructor() {
    this.allVideos = [];
    this.filteredVideos = [];
    this.currentPage = 1;
    this.pageSize = 50;
    this.sortField = 'addedTime';
    this.sortOrder = 'desc';
    this.searchKeyword = '';

    this.init();
  }

  async init() {
    this.bindEvents();
    await this.loadVideos();
  }

  async loadVideos() {
    try {
      this.allVideos = await getAllVideosFromDB();
      this.applyFiltersAndSort();
      this.renderVideoList();
      this.updateStats();
    } catch (error) {
      console.error('加载视频失败:', error);
      document.getElementById('video-list').innerHTML = `
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

  applyFiltersAndSort() {
    // 1. 过滤
    if (this.searchKeyword) {
      const lower = this.searchKeyword.toLowerCase();
      this.filteredVideos = this.allVideos.filter(v =>
        (v.videoId && v.videoId.toLowerCase().includes(lower)) ||
        (v.detailTitle && v.detailTitle.toLowerCase().includes(lower))
      );
    } else {
      this.filteredVideos = [...this.allVideos];
    }

    // 2. 排序
    this.filteredVideos.sort((a, b) => {
      let valA, valB;

      if (this.sortField === 'addedTime') {
        valA = a.addedTime || 0;
        valB = b.addedTime || 0;
      } else if (this.sortField === 'videoId') {
        valA = (a.videoId || '').toLowerCase();
        valB = (b.videoId || '').toLowerCase();
        const parseId = (id) => {
          const match = id.match(/^([A-Z]+)-?(\d+)$/i);
          return match ? [match[1].toUpperCase(), parseInt(match[2], 10)] : [id.toUpperCase(), 0];
        };
        const [prefixA, numA] = parseId(valA);
        const [prefixB, numB] = parseId(valB);
        if (prefixA !== prefixB) return prefixA.localeCompare(prefixB);
        return numA - numB;
      }

      if (this.sortOrder === 'desc') {
        return valB > valA ? 1 : valB < valA ? -1 : 0;
      } else {
        return valA > valB ? 1 : valA < valB ? -1 : 0;
      }
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

  formatTime(timestamp) {
    if (!timestamp) return '未知';
    const date = new Date(timestamp);
    return date.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  renderVideoList() {
    const container = document.getElementById('video-list');
    const videos = this.getPaginatedVideos();

    if (this.filteredVideos.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <svg class="empty-state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z"/>
          </svg>
          <h3>暂无收藏</h3>
          <p>请到 Jable 收藏页面获取数据</p>
        </div>
      `;
      this.updatePagination();
      return;
    }

    container.innerHTML = videos.map(video => `
      <div class="video-item">
        <div class="video-thumb">
          <img src="${video.imgDataSrc || video.imgSrc}" alt="${video.videoId || ''}" loading="lazy">
        </div>
        <div class="video-info">
          <div class="video-id">${video.videoId || '未知番号'}</div>
          <div class="video-title" title="${video.detailTitle || ''}">${video.detailTitle || '无标题'}</div>
          <div class="video-time">添加于 ${this.formatTime(video.addedTime)}</div>
        </div>
        <div class="video-actions">
          <button class="btn btn-danger" data-url="${video.url || video.detailHref}">删除</button>
        </div>
      </div>
    `).join('');

    container.querySelectorAll('.btn-danger').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const url = e.target.dataset.url;
        if (confirm('确定要删除这条收藏吗？')) {
          await this.deleteVideo(url);
        }
      });
    });

    this.updatePagination();
  }

  updatePagination() {
    const totalPages = this.getTotalPages();
    document.getElementById('page-info').textContent = `${this.currentPage} / ${totalPages}`;
    document.getElementById('prev-btn').disabled = this.currentPage <= 1;
    document.getElementById('next-btn').disabled = this.currentPage >= totalPages;
  }

  updateStats() {
    document.getElementById('total-count').textContent = this.allVideos.length;
    document.getElementById('display-count').textContent = this.filteredVideos.length;
  }

  async deleteVideo(url) {
    try {
      await deleteVideoFromDB(url);
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
    this.applyFiltersAndSort();
    this.renderVideoList();
    this.updateStats();
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
    this.applyFiltersAndSort();
    this.renderVideoList();
    this.updateStats();
  }

  async exportData() {
    try {
      const videos = await getAllVideosFromDB();
      const blob = new Blob([JSON.stringify(videos, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `jable-favorites-${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
      this.showToast(`已导出 ${videos.length} 条数据`, 'success');
    } catch (error) {
      console.error('导出失败:', error);
      this.showToast('导出失败', 'error');
    }
  }

  async importData() {
    const file = document.getElementById('import-file').files[0];
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

      if (confirm(`将导入 ${videos.length} 条数据，确定继续吗？`)) {
        await importVideosToDB(videos);
        await this.loadVideos();
        this.showToast(`成功导入 ${videos.length} 条数据`, 'success');
      }
    } catch (error) {
      console.error('导入失败:', error);
      this.showToast('导入失败: ' + error.message, 'error');
    }
  }

  async clearData() {
    if (!confirm('确定要清空所有收藏数据吗？此操作不可恢复！')) return;
    if (!confirm('再次确认：所有数据将被永久删除！')) return;

    try {
      await clearAllVideosFromDB();
      await this.loadVideos();
      this.showToast('已清空所有数据', 'success');
    } catch (error) {
      console.error('清空失败:', error);
      this.showToast('清空失败', 'error');
    }
  }

  bindEvents() {
    document.getElementById('search-input').addEventListener('input', (e) => {
      this.setSearch(e.target.value);
    });

    document.getElementById('sort-select').addEventListener('change', (e) => {
      const [field, order] = e.target.value.split('-');
      this.setSort(field, order);
    });

    document.getElementById('prev-btn').addEventListener('click', () => {
      this.setPage(this.currentPage - 1);
    });

    document.getElementById('next-btn').addEventListener('click', () => {
      this.setPage(this.currentPage + 1);
    });

    document.getElementById('page-size').addEventListener('change', (e) => {
      this.setPageSize(e.target.value);
    });

    document.getElementById('export-data').addEventListener('click', () => {
      this.exportData();
    });

    document.getElementById('import-data').addEventListener('click', () => {
      document.getElementById('import-file').click();
    });

    document.getElementById('import-file').addEventListener('change', () => {
      this.importData();
    });

    document.getElementById('clear-data').addEventListener('click', () => {
      this.clearData();
    });
  }

  showToast(message, type) {
    const el = document.getElementById('toast');
    el.textContent = message;
    el.className = `toast ${type} show`;
    setTimeout(() => {
      el.className = 'toast';
    }, 3000);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new OptionsManager();
});
