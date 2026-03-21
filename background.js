// ========== IndexedDB 数据库操作 ==========
const DB_NAME = 'jable_collect';
const DB_VERSION = 2;
const STORE_NAME = 'videos';

let db = null;
let orderCounter = 0; // 用于追踪原始顺序

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
  console.log('[background] saveVideos 被调用，videos数量:', videos.length, 'pageType:', pageType);
  console.log('[background] db 状态:', db ? '已初始化' : '未初始化');

  // 确保 db 已初始化
  const database = await initDB();
  console.log('[background] initDB 完成，db:', database ? 'OK' : 'null');

  // 读取现有记录，用于合并来源标记并获取最大 order
  const existing = await new Promise((resolve, reject) => {
    const tx = database.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.getAll();
    request.onsuccess = () => {
      console.log('[background] 获取到现有数据:', request.result.length, '条');
      resolve(request.result);
    };
    request.onerror = () => reject(request.error);
  });

  const existingMap = new Map(existing.map(v => [v.url, v]));
  const maxOrder = existing.length > 0 ? Math.max(...existing.map(v => v.order || 0)) : 0;
  console.log('[background] 当前最大 order:', maxOrder);

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
        video.inFavorites = prev.inFavorites || false;
        video.inWatchLater = prev.inWatchLater || false;
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

      console.log('[background] 保存:', video.videoId, 'order:', video.order,
        'inFavorites:', video.inFavorites, 'inWatchLater:', video.inWatchLater);
      store.put(video);
    });

    tx.oncomplete = () => {
      console.log('[background] 事务完成');
      const verifyTx = database.transaction(STORE_NAME, 'readonly');
      const countReq = verifyTx.objectStore(STORE_NAME).count();
      countReq.onsuccess = () => {
        console.log('[background] 验证: 数据库中现在有', countReq.result, '条');
      };
      resolve(videos.length);
    };
    tx.onerror = () => {
      console.error('[background] 保存失败:', tx.error);
      reject(tx.error);
    };
  });
}

// 获取所有视频
async function getAllVideos() {
  await initDB();
  console.log('[background] getAllVideos 被调用');

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.getAll();
    request.onsuccess = () => {
      console.log('[background] getAllVideos 返回数量:', request.result.length);
      if (request.result.length > 0) {
        console.log('[background] 前3条数据:', request.result.slice(0, 3).map(v => ({ url: v.url, order: v.order, videoId: v.videoId })));
      }
      resolve(request.result);
    };
    request.onerror = () => {
      console.error('[background] getAllVideos 失败:', request.error);
      reject(request.error);
    };
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
  console.log('[background] 收到消息:', request.action, '数据量:', request.videos?.length || request.pageType);
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
        await saveVideos(request.videos, request.pageType);
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
