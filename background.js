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
  }
}

const DB_NAME = 'jable_collect';
const DB_VERSION = 5;
const JABLE_STORE_NAME = 'jable_videos';
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
  const store = database.createObjectStore(JABLE_STORE_NAME, { keyPath: 'videoId' });
  store.createIndex('url', 'url', { unique: true });
  store.createIndex('inFavorites', 'inFavorites', { unique: false });
  store.createIndex('inWatchLater', 'inWatchLater', { unique: false });
  store.createIndex('favOrder', 'favOrder', { unique: false });
  store.createIndex('watchLaterOrder', 'watchLaterOrder', { unique: false });
  store.createIndex('coverImg', 'coverImg', { unique: false });
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

      // 删除旧 videos store（v3 及以前），不迁移数据
      if (database.objectStoreNames.contains('videos')) {
        database.deleteObjectStore('videos');
      }

      if (!database.objectStoreNames.contains(JABLE_STORE_NAME)) {
        createJableStore(database);
      } else {
        const tx = event.target.transaction;
        const store = tx.objectStore(JABLE_STORE_NAME);
        // v4 → v5: 为已有 store 补建 coverImg index
        if (!store.indexNames.contains('coverImg')) {
          store.createIndex('coverImg', 'coverImg', { unique: false });
        }
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

function normalizeJableUrl(url) {
  if (!url) return null;

  try {
    const parsed = new URL(url, 'https://jable.tv');
    const pathname = parsed.pathname.replace(/\/+$/, '');
    const normalizedPath = pathname || '/';
    return normalizedPath === '/' ? `${parsed.origin}/` : `${parsed.origin}${normalizedPath}/`;
  } catch (error) {
    return null;
  }
}

function isFilledValue(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim() !== '';
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function pickPreferredValue(nextValue, prevValue) {
  return isFilledValue(nextValue) ? nextValue : prevValue;
}

function getJableSourceFlags(video = {}) {
  return {
    inFavorites: Boolean(video.inFavorites),
    inWatchLater: Boolean(video.inWatchLater)
  };
}

function prepareJableVideo(video = {}) {
  const url = normalizeJableUrl(video.url || video.detailHref);
  const videoId = pickPreferredValue(video.videoId, extractVideoId(url, 'jable'));

  return {
    ...video,
    url,
    videoId: videoId || null
  };
}

function getMaxOrder(videos, field = 'order') {
  if (!videos.length) return 0;
  return Math.max(...videos.map(video => video[field] || 0));
}

function getMinOrder(videos, field = 'order') {
  if (!videos.length) return 0;
  return Math.min(...videos.map(video => video[field] || 0));
}

function clearTransientVideoFields(video = {}) {
  const nextVideo = { ...video };
  delete nextVideo._insertAtFront;
  delete nextVideo._originalUrl;
  return nextVideo;
}

function shouldInsertAtFront(video = {}) {
  return video?._insertAtFront === true;
}

function getNextJableFavOrder(existingVideos, prev, incoming) {
  if (prev?.favOrder != null) return prev.favOrder;
  if (shouldInsertAtFront(incoming)) {
    return getMinOrder(existingVideos, 'favOrder') - 1;
  }
  return getMaxOrder(existingVideos, 'favOrder') + 1;
}

function getNextJableWatchLaterOrder(existingVideos, prev, incoming) {
  if (prev?.watchLaterOrder != null) return prev.watchLaterOrder;
  if (shouldInsertAtFront(incoming)) {
    return getMinOrder(existingVideos, 'watchLaterOrder') - 1;
  }
  return getMaxOrder(existingVideos, 'watchLaterOrder') + 1;
}

async function saveVideos(videos, pageType = 'favorites', site = DEFAULT_SITE) {
  const normalizedSite = normalizeSite(site);
  const database = await initDB();

  if (normalizedSite === 'missav') {
    return saveMissavVideos(database, videos.map(clearTransientVideoFields));
  }

  return saveJableVideos(database, videos, pageType);
}

async function saveJableVideos(database, videos, pageType = 'favorites') {
  const normalizedPageType = normalizeJablePageType(pageType);
  const existing = await readAllFromStore(database, JABLE_STORE_NAME);
  const existingMap = new Map();

  existing.forEach((video) => {
    const prepared = prepareJableVideo(video);
    if (!prepared.videoId) return;
    existingMap.set(prepared.videoId, { ...video, ...prepared });
  });

  // Use running counters so each new video gets a unique order value
  let nextFavOrder = getMaxOrder(existing, 'favOrder') + 1;
  let nextWatchLaterOrder = getMaxOrder(existing, 'watchLaterOrder') + 1;
  let minFavOrder = getMinOrder(existing, 'favOrder') - 1;
  let minWatchLaterOrder = getMinOrder(existing, 'watchLaterOrder') - 1;

  return new Promise((resolve, reject) => {
    const tx = database.transaction(JABLE_STORE_NAME, 'readwrite');
    const store = tx.objectStore(JABLE_STORE_NAME);
    let savedCount = 0;

    videos.forEach((rawVideo, index) => {
      const incoming = prepareJableVideo(rawVideo);
      if (rawVideo?._insertAtFront) incoming._insertAtFront = true;
      if (!incoming.videoId) return;

      const prev = existingMap.get(incoming.videoId) || null;
      const prevFlags = getJableSourceFlags(prev || {});

      const merged = {
        ...(prev || {}),
        ...incoming,
        url: incoming.url || prev?.url,
        title: pickPreferredValue(incoming.title, prev?.title) || '',
        imgSrc: pickPreferredValue(incoming.imgSrc, prev?.imgSrc) || '',
        preview: pickPreferredValue(incoming.preview, prev?.preview) || '',
        coverImg: pickPreferredValue(incoming.coverImg, prev?.coverImg) || '',
        numericId: pickPreferredValue(incoming.numericId, prev?.numericId) || null,
        addedAt: prev?.addedAt || Date.now(),
        inFavorites: prevFlags.inFavorites || incoming.inFavorites === true,
        inWatchLater: prevFlags.inWatchLater || incoming.inWatchLater === true,
      };

      if (normalizedPageType === 'favorites') {
        merged.inFavorites = true;
        if (prev?.favOrder != null) {
          merged.favOrder = prev.favOrder;
        } else if (shouldInsertAtFront(incoming)) {
          merged.favOrder = minFavOrder--;
        } else {
          merged.favOrder = nextFavOrder++;
        }
      } else {
        merged.inWatchLater = true;
        if (prev?.watchLaterOrder != null) {
          merged.watchLaterOrder = prev.watchLaterOrder;
        } else if (shouldInsertAtFront(incoming)) {
          merged.watchLaterOrder = minWatchLaterOrder--;
        } else {
          merged.watchLaterOrder = nextWatchLaterOrder++;
        }
      }

      store.put(clearTransientVideoFields(merged));
      existingMap.set(merged.videoId, clearTransientVideoFields(merged));
      savedCount++;
    });

    tx.oncomplete = () => resolve(savedCount);
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

async function saveVideoSource(video, pageType = 'favorites', site = DEFAULT_SITE) {
  const normalizedSite = normalizeSite(site);

  if (normalizedSite !== 'jable') {
    return saveVideos([video], pageType, normalizedSite);
  }

  const prepared = prepareJableVideo(video);
  const existingVideos = await getAllVideos(normalizedSite);
  const exists = prepared.videoId
    ? existingVideos.some((v) => v.videoId === prepared.videoId)
    : false;

  const nextVideo = exists ? video : { ...video, _insertAtFront: true };
  return saveVideos([nextVideo], pageType, normalizedSite);
}

async function removeVideoSource(url, pageType = 'favorites', site = DEFAULT_SITE) {
  const normalizedSite = normalizeSite(site);

  if (normalizedSite === 'missav') {
    await deleteVideo(url, normalizedSite);
    return { removed: true, deleted: true };
  }

  const database = await initDB();
  const normalizedPageType = normalizeJablePageType(pageType);
  const normalizedUrl = normalizeJableUrl(url);
  const existing = await readAllFromStore(database, JABLE_STORE_NAME);
  const prev = existing.find((video) => normalizeJableUrl(video.url) === normalizedUrl);

  if (!prev) {
    return { removed: false, deleted: false };
  }

  const nextFlags = getJableSourceFlags(prev);

  if (normalizedPageType === 'favorites') {
    nextFlags.inFavorites = false;
  } else {
    nextFlags.inWatchLater = false;
  }

  const shouldDelete = !nextFlags.inFavorites && !nextFlags.inWatchLater;

  return new Promise((resolve, reject) => {
    const tx = database.transaction(JABLE_STORE_NAME, 'readwrite');
    const store = tx.objectStore(JABLE_STORE_NAME);

    if (shouldDelete) {
      store.delete(prev.videoId);
    } else {
      store.put({
        ...prev,
        inFavorites: nextFlags.inFavorites,
        inWatchLater: nextFlags.inWatchLater,
      });
    }

    tx.oncomplete = () => resolve({ removed: true, deleted: shouldDelete });
    tx.onerror = () => {
      console.error('[background] 移除 Jable 来源失败:', tx.error);
      reject(tx.error);
    };
  });
}

async function getAllVideos(site = DEFAULT_SITE) {
  const database = await initDB();
  return readAllFromStore(database, getStoreName(site));
}

async function getVideoCount(site = DEFAULT_SITE) {
  const database = await initDB();
  return countFromStore(database, getStoreName(site));
}

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
    if (video.inFavorites) favoritesCount++;
    if (video.inWatchLater) watchLaterCount++;
    if (video.inFavorites && video.inWatchLater) bothCount++;
  });

  return {
    totalCount: videos.length,
    favoritesCount,
    watchLaterCount,
    bothCount
  };
}

// 注意：此函数仅被 MissAV 使用，Jable 的单条删除通过 removeVideoSource / removeJableVideoSourceRemotely 路径处理。
// MissAV store（missav_videos）的 keyPath 是 url，所以这里用 url 作为主键。
// Jable store（jable_videos）的 keyPath 是 videoId，不能用此函数删除，需通过 removeVideoSource 的 store.delete(prev.videoId) 实现。
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

  try {
    const pathname = new URL(url, 'https://jable.tv').pathname.replace(/\/+$/, '');
    const match = pathname.match(/\/videos\/([^\/]+)$/i);
    return match ? decodeURIComponent(match[1]).toUpperCase() : null;
  } catch (error) {
    const match = String(url).match(/\/videos\/([^\/?#]+)\/?/i);
    return match ? decodeURIComponent(match[1]).toUpperCase() : null;
  }
}

function queryTabs(queryOptions) {
  return new Promise((resolve, reject) => {
    chrome.tabs.query(queryOptions, (tabs) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(tabs || []);
    });
  });
}

function createTab(createProperties) {
  return new Promise((resolve, reject) => {
    chrome.tabs.create(createProperties, (tab) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(tab);
    });
  });
}

function sendMessageToTab(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(response);
    });
  });
}

function waitForTabComplete(tabId, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(handleUpdated);
      reject(new Error('打开 Jable 详情页超时'));
    }, timeoutMs);

    function finish(result) {
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(handleUpdated);
      resolve(result);
    }

    function handleUpdated(updatedTabId, changeInfo, tab) {
      if (updatedTabId !== tabId) {
        return;
      }
      if (changeInfo.status === 'complete') {
        finish(tab);
      }
    }

    chrome.tabs.onUpdated.addListener(handleUpdated);
    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError) {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(handleUpdated);
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (tab?.status === 'complete') {
        finish(tab);
      }
    });
  });
}

function isJableDetailTab(tab, normalizedUrl) {
  if (!tab?.id || !tab.url) {
    return false;
  }
  return normalizeJableUrl(tab.url) === normalizedUrl;
}

async function findOrCreateJableDetailTab(normalizedUrl) {
  const existingTabs = await queryTabs({ url: 'https://jable.tv/videos/*' });
  const matchedTab = existingTabs.find((tab) => isJableDetailTab(tab, normalizedUrl));
  if (matchedTab) {
    return { tab: matchedTab, created: false };
  }

  const createdTab = await createTab({ url: normalizedUrl, active: false });
  if (!createdTab?.id) {
    throw new Error('无法打开 Jable 详情页');
  }

  await waitForTabComplete(createdTab.id);
  return { tab: createdTab, created: true };
}

async function removeJableVideoSourceRemotely(url, pageType = 'favorites', site = DEFAULT_SITE) {
  const normalizedSite = normalizeSite(site);
  if (normalizedSite !== 'jable') {
    throw new Error('仅支持 Jable 官网删除');
  }

  const normalizedUrl = normalizeJableUrl(url);
  if (!normalizedUrl) {
    throw new Error('无效的 Jable 视频链接');
  }

  const normalizedPageType = normalizeJablePageType(pageType);
  // fav_type=0 → 收藏，fav_type=1 → 稍后观看
  const favType = normalizedPageType === 'watchLater' ? '1' : '0';

  const { tab, created } = await findOrCreateJableDetailTab(normalizedUrl);
  if (!tab?.id) {
    throw new Error('找不到 Jable 详情页标签页');
  }

  try {
    const response = await sendMessageToTab(tab.id, {
      action: 'removeVideoSourceFromWebsite',
      url: normalizedUrl,
      favType,
      pageType: normalizedPageType,
      site: 'jable'
    });

    if (!response?.success) {
      throw new Error(response?.error || 'Jable 官网删除失败');
    }
  } finally {
    if (created) {
      chrome.tabs.remove(tab.id);
    }
  }

  return {
    completed: true,
    pageType: normalizedPageType,
    url: normalizedUrl
  };
}

chrome.runtime.onInstalled.addListener((details) => {
  initDB();
  if (details.reason === 'install') {
    trackEvent('extension_installed');
  } else if (details.reason === 'update') {
    trackEvent('extension_updated', { version: chrome.runtime.getManifest().version });
  }
});

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

      case 'saveVideoSource': {
        const count = await saveVideoSource(request.video, request.pageType, request.site);
        sendResponse({ success: true, count });
        break;
      }

      case 'removeVideoSource': {
        const result = await removeVideoSource(request.url, request.pageType, request.site);
        sendResponse({ success: true, ...result });
        break;
      }

      case 'removeJableVideoSourceRemotely': {
        const result = await removeJableVideoSourceRemotely(request.url, request.pageType, request.site);
        sendResponse({ success: true, ...result });
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
