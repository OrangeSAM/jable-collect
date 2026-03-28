// ========== Amplitude 统计 ==========
const AMPLITUDE_API_KEY = 'd9a3d2b41c190251a9149f056e2e2353';

async function getDeviceId() {
  const result = await chrome.storage.local.get('amplitude_device_id');
  if (result.amplitude_device_id) return result.amplitude_device_id;
  const id = crypto.randomUUID();
  await chrome.storage.local.set({ amplitude_device_id: id });
  return id;
}

async function trackEvent(eventName, properties = {}) {
  try {
    const deviceId = await getDeviceId();
    await fetch('https://api2.amplitude.com/2/httpapi', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: AMPLITUDE_API_KEY,
        events: [{
          device_id: deviceId,
          event_type: eventName,
          event_properties: properties,
          platform: 'Chrome Extension',
        }]
      })
    });
  } catch (e) {
    // 统计失败不影响主流程
  }
}

// ========== IndexedDB 数据库操作 ==========
const DB_NAME = 'jable_collect';
const DB_VERSION = 3;
const JABLE_STORE_NAME = 'videos';
const MISSAV_STORE_NAME = 'missav_videos';
const DEFAULT_SITE = 'jable';

let db = null;

function normalizeSite(site = DEFAULT_SITE) {
  return site === 'missav' ? 'missav' : DEFAULT_SITE;
}

function getStoreName(site = DEFAULT_SITE) {
  return normalizeSite(site) === 'missav' ? MISSAV_STORE_NAME : JABLE_STORE_NAME;
}

function createJableStore(database) {
  const store = database.createObjectStore(JABLE_STORE_NAME, { keyPath: 'url' });
  store.createIndex('videoId', 'videoId', { unique: false });
  store.createIndex('title', 'title', { unique: false });
  store.createIndex('order', 'order', { unique: false });
  store.createIndex('pageType', 'pageType', { unique: false });
}

function createMissavStore(database) {
  const store = database.createObjectStore(MISSAV_STORE_NAME, { keyPath: 'url' });
  store.createIndex('videoId', 'videoId', { unique: false });
  store.createIndex('detailTitle', 'detailTitle', { unique: false });
  store.createIndex('order', 'order', { unique: false });
}

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

      if (!database.objectStoreNames.contains(JABLE_STORE_NAME)) {
        createJableStore(database);
      }

      if (!database.objectStoreNames.contains(MISSAV_STORE_NAME)) {
        createMissavStore(database);
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

function readAllFromStore(database, storeName) {
  return new Promise((resolve, reject) => {
    const tx = database.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function countFromStore(database, storeName) {
  return new Promise((resolve, reject) => {
    const tx = database.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const request = store.count();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function normalizeJablePageType(pageType = 'favorites') {
  return pageType === 'watchLater' ? 'watchLater' : 'favorites';
}

function getMaxOrder(videos) {
  if (!videos.length) return 0;
  return Math.max(...videos.map(video => video.order || 0));
}

// 批量保存视频
async function saveVideos(videos, pageType = 'favorites', site = DEFAULT_SITE) {
  const normalizedSite = normalizeSite(site);
  const database = await initDB();

  if (normalizedSite === 'missav') {
    return saveMissavVideos(database, videos);
  }

  return saveJableVideos(database, videos, pageType);
}

async function saveJableVideos(database, videos, pageType = 'favorites') {
  const normalizedPageType = normalizeJablePageType(pageType);
  const existing = await readAllFromStore(database, JABLE_STORE_NAME);
  const existingMap = new Map(existing.map(video => [video.url, video]));
  let order = getMaxOrder(existing);

  return new Promise((resolve, reject) => {
    const tx = database.transaction(JABLE_STORE_NAME, 'readwrite');
    const store = tx.objectStore(JABLE_STORE_NAME);

    videos.forEach(video => {
      const nextVideo = {
        ...video,
        site: 'jable'
      };

      nextVideo.videoId = nextVideo.videoId || extractVideoId(nextVideo.detailHref || nextVideo.url, 'jable');

      const prev = existingMap.get(nextVideo.url);
      if (prev) {
        nextVideo.order = prev.order;
        nextVideo.inFavorites = prev.inFavorites;
        nextVideo.inWatchLater = prev.inWatchLater;
      } else {
        order++;
        nextVideo.order = order;
        nextVideo.inFavorites = false;
        nextVideo.inWatchLater = false;
      }

      if (normalizedPageType === 'favorites') {
        nextVideo.inFavorites = true;
      } else {
        nextVideo.inWatchLater = true;
      }

      nextVideo.pageType = normalizedPageType;
      store.put(nextVideo);
    });

    tx.oncomplete = () => resolve(videos.length);
    tx.onerror = () => {
      console.error('[background] 保存 Jable 数据失败:', tx.error);
      reject(tx.error);
    };
  });
}

async function saveMissavVideos(database, videos) {
  const existing = await readAllFromStore(database, MISSAV_STORE_NAME);
  const existingMap = new Map(existing.map(video => [video.url, video]));
  let order = getMaxOrder(existing);

  return new Promise((resolve, reject) => {
    const tx = database.transaction(MISSAV_STORE_NAME, 'readwrite');
    const store = tx.objectStore(MISSAV_STORE_NAME);

    videos.forEach(video => {
      const nextVideo = {
        ...video,
        site: 'missav',
        pageType: 'favorites'
      };

      nextVideo.videoId = nextVideo.videoId || extractVideoId(nextVideo.detailHref || nextVideo.url, 'missav');

      const prev = existingMap.get(nextVideo.url);
      if (prev) {
        nextVideo.order = prev.order;
      } else {
        order++;
        nextVideo.order = order;
      }

      store.put(nextVideo);
    });

    tx.oncomplete = () => resolve(videos.length);
    tx.onerror = () => {
      console.error('[background] 保存 MissAV 数据失败:', tx.error);
      reject(tx.error);
    };
  });
}

// 获取所有视频
async function getAllVideos(site = DEFAULT_SITE) {
  const database = await initDB();
  return readAllFromStore(database, getStoreName(site));
}

// 获取视频数量
async function getVideoCount(site = DEFAULT_SITE) {
  const database = await initDB();
  return countFromStore(database, getStoreName(site));
}

// 获取统计信息
async function getVideoStats(site = DEFAULT_SITE) {
  const normalizedSite = normalizeSite(site);
  const videos = await getAllVideos(normalizedSite);

  if (normalizedSite === 'missav') {
    return {
      totalCount: videos.length,
      favoritesCount: videos.length,
      watchLaterCount: 0,
      bothCount: 0
    };
  }

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
async function deleteVideo(url, site = DEFAULT_SITE) {
  const database = await initDB();
  const storeName = getStoreName(site);

  return new Promise((resolve, reject) => {
    const tx = database.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const request = store.delete(url);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

// 清空所有视频
async function clearAllVideos(site = DEFAULT_SITE) {
  const database = await initDB();
  const storeName = getStoreName(site);

  return new Promise((resolve, reject) => {
    const tx = database.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    const request = store.clear();
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

// 从 URL 提取番号
function extractVideoId(url, site = DEFAULT_SITE) {
  if (!url) return null;

  if (normalizeSite(site) === 'missav') {
    try {
      const pathname = new URL(url, 'https://missav.ws').pathname.replace(/\/+$/, '');
      const segments = pathname.split('/').filter(Boolean);
      return segments.length ? decodeURIComponent(segments[segments.length - 1]).toUpperCase() : null;
    } catch (error) {
      return null;
    }
  }

  const match = url.match(/\/videos\/([^\/]+)\/?$/i);
  return match ? match[1].toUpperCase() : null;
}

// ========== 消息处理 ==========
chrome.runtime.onInstalled.addListener((details) => {
  initDB();
  if (details.reason === 'install') {
    trackEvent('extension_installed');
  } else if (details.reason === 'update') {
    trackEvent('extension_updated', { version: chrome.runtime.getManifest().version });
  }
});

// 监听来自内容脚本或选项页的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  handleMessage(request, sender, sendResponse);
  return true;
});

async function handleMessage(request, sender, sendResponse) {
  try {
    switch (request.action) {
      case 'saveVideos': {
        const count = await saveVideos(request.videos, request.pageType, request.site);
        sendResponse({ success: true, count });
        break;
      }

      case 'getAllVideos': {
        const videos = await getAllVideos(request.site);
        sendResponse({ success: true, videos });
        break;
      }

      case 'getVideoCount': {
        const videoCount = await getVideoCount(request.site);
        sendResponse({ success: true, count: videoCount });
        break;
      }

      case 'getVideoStats': {
        const stats = await getVideoStats(request.site);
        sendResponse({ success: true, stats });
        break;
      }

      case 'deleteVideo': {
        await deleteVideo(request.url, request.site);
        sendResponse({ success: true });
        break;
      }

      case 'clearAllVideos': {
        await clearAllVideos(request.site);
        sendResponse({ success: true });
        break;
      }

      case 'syncFavorites': {
        const normalizedSite = normalizeSite(request.site);
        const syncedCount = await saveVideos(request.videos, request.pageType, normalizedSite);
        const newCount = await getVideoCount(normalizedSite);
        trackEvent('sync_completed', { site: normalizedSite, synced_count: syncedCount, total_count: newCount });
        sendResponse({ success: true, count: syncedCount, totalCount: newCount });
        break;
      }

      case 'trackEvent': {
        trackEvent(request.eventName, request.properties || {});
        sendResponse({ success: true });
        break;
      }

      default:
        sendResponse({ success: false, error: 'Unknown action' });
    }
  } catch (error) {
    sendResponse({ success: false, error: error.message });
  }
}
