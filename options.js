// 设置页面逻辑
class OptionsManager {
constructor() {
  this.defaultSettings = {
    autoSync: true,
    showPanel: true,
    syncInterval: 30,
    panelPosition: 'right',
    theme: 'light',
    debugMode: false,
    customSelectors: '.video-item\n.thumb-item\n[class*="video"]'
  };
  
  this.init();
}

async init() {
  await this.loadSettings();
  this.bindEvents();
  await this.updateDataPreview();
}

async loadSettings() {
  try {
    const result = await chrome.storage.sync.get('settings');
    const settings = { ...this.defaultSettings, ...result.settings };
    
    // 应用设置到界面
    document.getElementById('auto-sync').checked = settings.autoSync;
    document.getElementById('show-panel').checked = settings.showPanel;
    document.getElementById('sync-interval').value = settings.syncInterval;
    document.getElementById('panel-position').value = settings.panelPosition;
    document.getElementById('theme').value = settings.theme;
    document.getElementById('debug-mode').checked = settings.debugMode;
    document.getElementById('custom-selectors').value = settings.customSelectors;
    
  } catch (error) {
    console.error('加载设置失败:', error);
    this.showMessage('加载设置失败', 'error');
  }
}

async saveSettings() {
  try {
    const settings = {
      autoSync: document.getElementById('auto-sync').checked,
      showPanel: document.getElementById('show-panel').checked,
      syncInterval: parseInt(document.getElementById('sync-interval').value),
      panelPosition: document.getElementById('panel-position').value,
      theme: document.getElementById('theme').value,
      debugMode: document.getElementById('debug-mode').checked,
      customSelectors: document.getElementById('custom-selectors').value
    };
    
    await chrome.storage.sync.set({ settings });
    this.showMessage('设置保存成功', 'success');
    
    // 通知内容脚本设置已更新
    this.notifyContentScript();
    
  } catch (error) {
    console.error('保存设置失败:', error);
    this.showMessage('保存设置失败', 'error');
  }
}

async resetSettings() {
  if (confirm('确定要重置所有设置为默认值吗？')) {
    try {
      await chrome.storage.sync.set({ settings: this.defaultSettings });
      await this.loadSettings();
      this.showMessage('设置已重置为默认值', 'success');
    } catch (error) {
      console.error('重置设置失败:', error);
      this.showMessage('重置设置失败', 'error');
    }
  }
}

async exportData() {
  try {
    const result = await chrome.storage.local.get(['categories', 'favorites']);
    const data = {
      categories: result.categories || {},
      favorites: result.favorites || [],
      exportTime: new Date().toISOString(),
      version: '1.0'
    };
    
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: 'application/json'
    });
    
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `favorites-backup-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    this.showMessage('数据导出成功', 'success');
  } catch (error) {
    console.error('导出数据失败:', error);
    this.showMessage('导出数据失败', 'error');
  }
}

async importData() {
  const fileInput = document.getElementById('import-file');
  const file = fileInput.files[0];
  
  if (!file) {
    this.showMessage('请选择要导入的文件', 'error');
    return;
  }
  
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    
    // 验证数据格式
    if (!data.categories || !data.favorites) {
      throw new Error('数据格式不正确');
    }
    
    if (confirm('导入数据将覆盖现有数据，确定继续吗？')) {
      await chrome.storage.local.set({
        categories: data.categories,
        favorites: data.favorites
      });
      
      await this.updateDataPreview();
      this.showMessage('数据导入成功', 'success');
    }
  } catch (error) {
    console.error('导入数据失败:', error);
    this.showMessage('导入数据失败: ' + error.message, 'error');
  }
}

async clearData() {
  if (confirm('确定要清空所有收藏和分类数据吗？此操作不可恢复！')) {
    if (confirm('再次确认：这将删除所有数据！')) {
      try {
        await chrome.storage.local.clear();
        await this.updateDataPreview();
        this.showMessage('所有数据已清空', 'success');
      } catch (error) {
        console.error('清空数据失败:', error);
        this.showMessage('清空数据失败', 'error');
      }
    }
  }
}

async updateDataPreview() {
  try {
    const result = await chrome.storage.local.get(['categories', 'favorites']);
    const preview = {
      categories: Object.keys(result.categories || {}).length,
      favorites: (result.favorites || []).length,
      lastUpdate: new Date().toLocaleString()
    };
    
    document.getElementById('data-preview').textContent = 
      JSON.stringify(preview, null, 2);
  } catch (error) {
    document.getElementById('data-preview').textContent = 
      '加载数据预览失败: ' + error.message;
  }
}

bindEvents() {
  document.getElementById('save-settings').addEventListener('click', () => {
    this.saveSettings();
  });
  
  document.getElementById('reset-settings').addEventListener('click', () => {
    this.resetSettings();
  });
  
  document.getElementById('export-data').addEventListener('click', () => {
    this.exportData();
  });
  
  document.getElementById('import-data').addEventListener('click', () => {
    this.importData();
  });
  
  document.getElementById('clear-data').addEventListener('click', () => {
    this.clearData();
  });
  
  document.getElementById('import-file').addEventListener('change', () => {
    const file = document.getElementById('import-file').files[0];
    if (file) {
      document.getElementById('import-data').textContent = `导入 ${file.name}`;
    }
  });
}

showMessage(message, type) {
  const messageEl = document.getElementById('status-message');
  messageEl.textContent = message;
  messageEl.className = `status-message status-${type}`;
  messageEl.style.display = 'block';
  
  setTimeout(() => {
    messageEl.style.display = 'none';
  }, 3000);
}

async notifyContentScript() {
  try {
    const tabs = await chrome.tabs.query({
      url: 'https://jable.tv/my/favourites/videos/*'
    });
    
    tabs.forEach(tab => {
      chrome.tabs.sendMessage(tab.id, {
        type: 'SETTINGS_UPDATED'
      }).catch(() => {
        // 忽略错误，可能页面还没加载内容脚本
      });
    });
  } catch (error) {
    console.error('通知内容脚本失败:', error);
  }
}
}

// 初始化设置管理器
document.addEventListener('DOMContentLoaded', () => {
new OptionsManager();
});