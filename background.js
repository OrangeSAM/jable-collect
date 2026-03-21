// ========== IndexedDB 数据库操作 ==========
const DB_NAME = 'jable_collect';
const DB_VERSION = 1;
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

      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const store = database.createObjectStore(STORE_NAME, { keyPath: 'url' });
        store.createIndex('videoId', 'videoId', { unique: false });
        store.createIndex('title', 'title', { unique: false });
        store.createIndex('addedTime', 'addedTime', { unique: false });
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

// 保存单条视频
async function saveVideo(video) {
  await initDB();

  video.videoId = video.videoId || extractVideoId(video.detailHref || video.url);
  video.addedTime = video.addedTime || Date.now();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.put(video);
    request.onsuccess = () => resolve(video);
    request.onerror = () => reject(request.error);
  });
}

// 批量保存视频
async function saveVideos(videos) {
  await initDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);

    videos.forEach(video => {
      video.videoId = video.videoId || extractVideoId(video.detailHref || video.url);
      // 不设置 addedTime，保持 Jable 原始顺序
      store.put(video);
    });

    tx.oncomplete = () => resolve(videos.length);
    tx.onerror = () => reject(tx.error);
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
  console.log('收藏分类管理器已安装');
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
        await saveVideos(request.videos);
        const newCount = await getVideoCount();
        sendResponse({ success: true, count: newCount });
        break;

      default:
        sendResponse({ success: false, error: 'Unknown action' });
    }
  } catch (error) {
    console.error('Background script error:', error);
    sendResponse({ success: false, error: error.message });
  }
}
