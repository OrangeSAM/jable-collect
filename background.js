// ========== IndexedDB 数据库操作 ==========
const DB_NAME = 'jable_collect';
const DB_VERSION = 2;
const STORE_NAME = 'videos';

let db = null;

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      db = request.result;
      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      const database = event.target.result;

      // 只在 store 不存在时创建
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const store = database.createObjectStore(STORE_NAME, { keyPath: 'url' });
        store.createIndex('videoId', 'videoId', { unique: false });
        store.createIndex('title', 'title', { unique: false });
        store.createIndex('order', 'order', { unique: false });
        store.createIndex('pageType', 'pageType', { unique: false });
      }
    };
  });
}

async function initDB() {
  if (!db) {
    await openDB();
  }
  return db;
}

// 批量保存视频
async function saveVideos(videos, pageType = 'favorites') {
  // 确保 db 已初始化
  const database = await initDB();

  // 读取现有记录，用于合并来源标记并获取最大 order
  const existing = await new Promise((resolve, reject) => {
    const tx = database.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  const existingMap = new Map(existing.map(v => [v.url, v]));
  const maxOrder = existing.length > 0 ? Math.max(...existing.map(v => v.order || 0)) : 0;
  let order = maxOrder;

  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);

    videos.forEach(video => {
      video.videoId = video.videoId || extractVideoId(video.detailHref || video.url);

      const prev = existingMap.get(video.url);
      if (prev) {
        // 已存在：保留原有 order，合并来源标记
        video.order = prev.order;
        video.inFavorites = prev.inFavorites;
        video.inWatchLater = prev.inWatchLater;
      } else {
        // 新记录：分配新 order
        order++;
        video.order = order;
        video.inFavorites = false;
        video.inWatchLater = false;
      }

      // 根据本次抓取类型打标
      if (pageType === 'favorites') {
        video.inFavorites = true;
      } else if (pageType === 'watchLater') {
        video.inWatchLater = true;
      }

      // 保留 pageType 字段（指本次抓取来源，向后兼容）
      video.pageType = pageType;

      store.put(video);
    });

    tx.oncomplete = () => resolve(videos.length);
    tx.onerror = () => {
      console.error('[background] 保存失败:', tx.error);
      reject(tx.error);
    };
  });
}

// 获取所有视频
async function getAllVideos() {
  await initDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// 获取视频数量
async function getVideoCount() {
  await initDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.count();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// 获取统计信息
async function getVideoStats() {
  const videos = await getAllVideos();

  let favoritesCount = 0;
  let watchLaterCount = 0;
  let bothCount = 0;

  videos.forEach(video => {
    const inFavorites = video.inFavorites || video.pageType === 'favorites';
    const inWatchLater = video.inWatchLater || video.pageType === 'watchLater';

    if (inFavorites) favoritesCount++;
    if (inWatchLater) watchLaterCount++;
    if (inFavorites && inWatchLater) bothCount++;
  });

  return {
    totalCount: videos.length,
    favoritesCount,
    watchLaterCount,
    bothCount
  };
}

// 删除视频
async function deleteVideo(url) {
  await initDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.delete(url);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

// 清空所有视频
async function clearAllVideos() {
  await initDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.clear();
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

// 从 URL 提取番号
function extractVideoId(url) {
  const match = url.match(/\/videos\/([^\/]+)\/?$/i);
  return match ? match[1].toUpperCase() : null;
}

// ========== 消息处理 ==========
chrome.runtime.onInstalled.addListener(() => {
  initDB();
});

// 监听来自内容脚本或选项页的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  handleMessage(request, sender, sendResponse);
  return true; // 保持消息通道开放
});

async function handleMessage(request, sender, sendResponse) {
  try {
    switch (request.action) {
      case 'saveVideos':
        const count = await saveVideos(request.videos);
        sendResponse({ success: true, count });
        break;

      case 'getAllVideos':
        const videos = await getAllVideos();
        sendResponse({ success: true, videos });
        break;

      case 'getVideoCount':
        const videoCount = await getVideoCount();
        sendResponse({ success: true, count: videoCount });
        break;

      case 'getVideoStats':
        const stats = await getVideoStats();
        sendResponse({ success: true, stats });
        break;

      case 'deleteVideo':
        await deleteVideo(request.url);
        sendResponse({ success: true });
        break;

      case 'clearAllVideos':
        await clearAllVideos();
        sendResponse({ success: true });
        break;

      case 'syncFavorites':
        // 处理来自 content.js 的同步请求
        const syncedCount = await saveVideos(request.videos, request.pageType);
        const newCount = await getVideoCount();
        sendResponse({ success: true, count: syncedCount, totalCount: newCount });
        break;

      default:
        sendResponse({ success: false, error: 'Unknown action' });
    }
  } catch (error) {
    sendResponse({ success: false, error: error.message });
  }
}
