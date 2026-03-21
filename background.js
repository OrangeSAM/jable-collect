// 后台脚本
chrome.runtime.onInstalled.addListener(() => {
  console.log('收藏分类管理器已安装');
});

// 监听来自内容脚本的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'SYNC_FAVORITES') {
    // 处理收藏数据同步
    handleFavoriteSync(request.data);
  }

  return true; // 保持消息通道开放
});

async function handleFavoriteSync(data) {
  try {
    // 可以在这里添加云端同步逻辑
    console.log('同步收藏数据:', data);
  } catch (error) {
    console.error('同步失败:', error);
  }
}