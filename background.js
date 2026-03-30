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
    inFavorites: Boolean(video.inFavorites || video.pageType === 'favorites'),
    inWatchLater: Boolean(video.inWatchLater || video.pageType === 'watchLater')
  };
}

function resolveJablePageType(inFavorites, inWatchLater, fallback = 'favorites') {
  if (inFavorites && !inWatchLater) return 'favorites';
  if (inWatchLater && !inFavorites) return 'watchLater';
  return normalizeJablePageType(fallback);
}

function prepareJableVideo(video = {}) {
  const url = normalizeJableUrl(video.url || video.detailHref);
  const detailHref = normalizeJableUrl(video.detailHref || video.url) || url;
  const videoId = pickPreferredValue(video.videoId, extractVideoId(detailHref || url, 'jable'));

  return {
    ...video,
    site: 'jable',
    from: video.from || 'jable',
    url,
    detailHref,
    videoId: videoId || null
  };
}

function getMaxOrder(videos) {
  if (!videos.length) return 0;
  return Math.max(...videos.map(video => video.order || 0));
}

function getMinOrder(videos) {
  if (!videos.length) return 0;
  return Math.min(...videos.map(video => video.order || 0));
}

function clearTransientVideoFields(video = {}) {
  const nextVideo = { ...video };
  delete nextVideo._insertAtFront;
  delete nextVideo._originalUrl;
  return nextVideo;
}

function shouldInsertAtFront(pageType = 'favorites', video = {}) {
  return normalizeJablePageType(pageType) === 'favorites' && video?._insertAtFront === true;
}

function getNextJableOrder(existingVideos, pageType, prev, incoming) {
  if (prev) return prev.order;
  if (shouldInsertAtFront(pageType, incoming)) {
    return getMinOrder(existingVideos) - 1;
  }
  return getMaxOrder(existingVideos) + 1;
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
    if (!prepared.url) return;
    existingMap.set(prepared.url, {
      ...video,
      ...prepared,
      _originalUrl: video.url
    });
  });

  return new Promise((resolve, reject) => {
    const tx = database.transaction(JABLE_STORE_NAME, 'readwrite');
    const store = tx.objectStore(JABLE_STORE_NAME);
    let savedCount = 0;

    videos.forEach((rawVideo) => {
      const incoming = prepareJableVideo(rawVideo);
      if (rawVideo?._insertAtFront) {
        incoming._insertAtFront = true;
      }
      if (!incoming.url) return;

      const prev = existingMap.get(incoming.url) || null;
      const prevPrepared = prev ? prepareJableVideo(prev) : null;
      const prevFlags = getJableSourceFlags(prev || {});
      const merged = {
        ...(prev || {}),
        ...incoming,
        site: 'jable',
        from: incoming.from || prevPrepared?.from || prev?.from || 'jable',
        url: incoming.url,
        detailHref: incoming.detailHref || prevPrepared?.detailHref || incoming.url,
        detailTitle: pickPreferredValue(incoming.detailTitle, prev?.detailTitle) || '',
        imgSrc: pickPreferredValue(incoming.imgSrc, prev?.imgSrc) || '',
        imgDataSrc: pickPreferredValue(incoming.imgDataSrc, prev?.imgDataSrc) || '',
        preview: pickPreferredValue(incoming.preview, prev?.preview) || '',
        videoId: pickPreferredValue(incoming.videoId, prevPrepared?.videoId || prev?.videoId) || extractVideoId(incoming.url, 'jable')
      };

      merged.order = getNextJableOrder(existing, normalizedPageType, prev, incoming);
      merged.inFavorites = prevFlags.inFavorites || incoming.inFavorites === true;
      merged.inWatchLater = prevFlags.inWatchLater || incoming.inWatchLater === true;

      if (normalizedPageType === 'favorites') {
        merged.inFavorites = true;
      } else {
        merged.inWatchLater = true;
      }

      merged.pageType = resolveJablePageType(merged.inFavorites, merged.inWatchLater, normalizedPageType);

      const previousKey = prev?._originalUrl || prev?.url;
      if (previousKey && previousKey !== merged.url) {
        store.delete(previousKey);
      }

      store.put(clearTransientVideoFields(merged));
      existingMap.set(merged.url, clearTransientVideoFields(merged));
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

  if (normalizedSite !== 'jable' || normalizeJablePageType(pageType) !== 'favorites') {
    return saveVideos([video], pageType, normalizedSite);
  }

  const existingVideos = await getAllVideos(normalizedSite);
  const normalizedUrl = normalizeJableUrl(video?.url || video?.detailHref);
  const exists = normalizedUrl
    ? existingVideos.some((existingVideo) => normalizeJableUrl(existingVideo.url) === normalizedUrl)
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

  const prevPrepared = prepareJableVideo(prev);
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

    const previousKey = prev._originalUrl || prev.url;

    if (shouldDelete) {
      store.delete(previousKey);
    } else {
      const nextVideo = {
        ...prev,
        ...prevPrepared,
        url: normalizedUrl || prevPrepared.url || prev.url,
        detailHref: normalizeJableUrl(prev.detailHref || prev.url) || normalizedUrl || prev.url,
        videoId: prev.videoId || prevPrepared.videoId || extractVideoId(normalizedUrl || prev.url, 'jable'),
        inFavorites: nextFlags.inFavorites,
        inWatchLater: nextFlags.inWatchLater,
        pageType: resolveJablePageType(nextFlags.inFavorites, nextFlags.inWatchLater, prev.pageType)
      };

      if (previousKey !== nextVideo.url) {
        store.delete(previousKey);
      }

      delete nextVideo._originalUrl;
      store.put(nextVideo);
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
