const JABLE_SITE = 'jable';
const DETAIL_ACTION_MESSAGE_SOURCE = 'jable-collect';
const DETAIL_ACTION_MESSAGE_TYPE = 'jable-detail-action';
const DETAIL_COMMAND_MESSAGE_TYPE = 'jable-detail-command';
const DETAIL_COMMAND_RESULT_MESSAGE_TYPE = 'jable-detail-command-result';
const ACTION_SYNC_TIMEOUT_MS = 15000;

let actionQueue = Promise.resolve();
let lastMessageKey = '';
let lastMessageAt = 0;
const pendingCommandWaiters = new Map();

function normalizeJableUrl(url = window.location.href) {
  if (!url) return null;

  try {
    const parsed = new URL(url, window.location.origin);
    const pathname = parsed.pathname.replace(/\/+$/, '');
    const normalizedPath = pathname || '/';
    return normalizedPath === '/' ? `${parsed.origin}/` : `${parsed.origin}${normalizedPath}/`;
  } catch (error) {
    return null;
  }
}

function trimText(value = '') {
  return typeof value === 'string' ? value.trim() : '';
}

function firstFilled(values) {
  return values.find(value => trimText(value) !== '') || '';
}

function normalizeTitle(title = '') {
  return trimText(title).replace(/\s*[-|｜]\s*Jable(?:\.TV)?\s*$/i, '');
}

function getMetaContent(selector) {
  return trimText(document.querySelector(selector)?.content || '');
}

function getText(selector) {
  return trimText(document.querySelector(selector)?.textContent || '');
}

function getAttribute(selector, attribute) {
  return trimText(document.querySelector(selector)?.getAttribute(attribute) || '');
}

function getProperty(selector, property) {
  const element = document.querySelector(selector);
  if (!element) return '';
  const value = element[property];
  return typeof value === 'string' ? value.trim() : '';
}

function extractVideoId(url) {
  if (!url) return null;

  try {
    const pathname = new URL(url, window.location.origin).pathname.replace(/\/+$/, '');
    const match = pathname.match(/\/videos\/([^\/]+)$/i);
    return match ? decodeURIComponent(match[1]).toUpperCase() : null;
  } catch (error) {
    return null;
  }
}

function extractNumericId(value = '') {
  const text = trimText(String(value || ''));
  return /^\d+$/.test(text) ? text : '';
}

function extractNumericVideoIdFromAssetUrl(url = '') {
  if (!url) return '';

  try {
    const pathname = new URL(url, window.location.origin).pathname;
    const previewMatch = pathname.match(/\/(\d+)\/preview\.jpg(?:$|[?#])/i);
    if (previewMatch) {
      return previewMatch[1];
    }

    const videoMatch = pathname.match(/\/(\d+)\/\1_preview\.mp4(?:$|[?#])/i);
    if (videoMatch) {
      return videoMatch[1];
    }
  } catch (error) {
  }

  return '';
}

function getCanonicalDetailUrl() {
  const canonicalHref = getAttribute('link[rel="canonical"]', 'href');
  return normalizeJableUrl(canonicalHref || window.location.href);
}

function deriveCoverImgFromPreview(previewUrl) {
  if (!previewUrl) return '';
  return previewUrl.replace(/\/(\d+)\/\1_preview\.mp4/i, '/$1/preview.jpg');
}

function derivePreviewFromImage(imageUrl) {
  if (!imageUrl) return '';

  try {
    const parsed = new URL(imageUrl, window.location.origin);
    const match = parsed.pathname.match(/^(.*\/)(\d+)\/preview\.jpg$/i);
    if (!match) return '';

    const baseDir = match[1];
    const videoNumericId = match[2];
    parsed.pathname = `${baseDir}${videoNumericId}/${videoNumericId}_preview.mp4`;
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
  } catch (error) {
    return '';
  }
}

function isLikelyVideoPreviewUrl(url = '') {
  return /^https?:\/\//i.test(url) && /_preview\.mp4(?:$|[?#])/i.test(url);
}

function isLikelyCoverImageUrl(url = '') {
  return /^https?:\/\//i.test(url) && /\/preview\.jpg(?:$|[?#])/i.test(url);
}

function pickBestImageDataSrc(...candidates) {
  return candidates.find(isLikelyCoverImageUrl) || firstFilled(candidates);
}

function pickBestPreview(...candidates) {
  return candidates.find(isLikelyVideoPreviewUrl) || '';
}

function stripBlobUrl(url = '') {
  return url.startsWith('blob:') ? '' : url;
}

function normalizeAbsoluteUrl(url = '') {
  if (!url) return '';

  try {
    return new URL(url, window.location.origin).toString();
  } catch (error) {
    return '';
  }
}

function getFirstMatchingAsset(selectors, getter) {
  for (const selector of selectors) {
    const elements = document.querySelectorAll(selector);
    for (const element of elements) {
      const value = trimText(getter(element));
      if (value) return value;
    }
  }
  return '';
}

function getCoverImageFromDom() {
  return getFirstMatchingAsset(
    [
      '.video-img-box img[data-src]',
      '.video-img-box img[src]',
      '.container img[data-src]',
      '.container img[src]',
      'img[data-src]',
      'img[src]'
    ],
    (element) => element.dataset?.src || element.getAttribute('src') || ''
  );
}

function getPosterImageFromVideo() {
  return getFirstMatchingAsset(
    ['video[poster]'],
    (element) => element.getAttribute('poster') || ''
  );
}

function getInlinePreviewUrl() {
  return stripBlobUrl(firstFilled([
    getProperty('video source[src]', 'src'),
    getProperty('video[src]', 'src'),
    getMetaContent('meta[property="og:video"]'),
    getMetaContent('meta[property="og:video:url"]')
  ]));
}

function getResolvedPreviewUrl(imageUrl) {
  return pickBestPreview(
    normalizeAbsoluteUrl(getInlinePreviewUrl()),
    derivePreviewFromImage(imageUrl)
  );
}

function getResolvedImageUrl() {
  const ogImage = normalizeAbsoluteUrl(firstFilled([
    getMetaContent('meta[property="og:image"]'),
    getMetaContent('meta[name="twitter:image"]')
  ]));
  const domCover = normalizeAbsoluteUrl(getCoverImageFromDom());
  const posterImage = normalizeAbsoluteUrl(getPosterImageFromVideo());

  return {
    imgSrc: firstFilled([ogImage, domCover, posterImage]),
    imgDataSrc: pickBestImageDataSrc(domCover, posterImage, ogImage)
  };
}

function getResolvedPreviewAndImages() {
  const { imgSrc, imgDataSrc } = getResolvedImageUrl();
  const previewBaseImage = imgSrc || imgDataSrc;

  return {
    imgSrc,
    imgDataSrc: imgDataSrc || imgSrc,
    preview: getResolvedPreviewUrl(previewBaseImage)
  };
}

function getNumericVideoId() {
  const { imgSrc, imgDataSrc, preview } = getResolvedPreviewAndImages();
  return firstFilled([
    extractNumericId(document.querySelector('button[data-video-id]')?.getAttribute('data-video-id')),
    extractNumericId(document.querySelector('[data-video-id]')?.getAttribute('data-video-id')),
    extractNumericId(document.querySelector('button[data-id]')?.getAttribute('data-id')),
    extractNumericId(document.querySelector('[data-id]')?.getAttribute('data-id')),
    extractNumericId(document.querySelector('input[name="video_id"]')?.value),
    extractNumericId(document.querySelector('input[name="video_ids[]"]')?.value),
    extractNumericVideoIdFromAssetUrl(imgSrc),
    extractNumericVideoIdFromAssetUrl(imgDataSrc),
    extractNumericVideoIdFromAssetUrl(preview),
  ]) || null;
}

function getCurrentVideoMetadata() {
  const url = getCanonicalDetailUrl();
  const { imgSrc, preview } = getResolvedPreviewAndImages();
  const title = firstFilled([
    normalizeTitle(getMetaContent('meta[property="og:title"]')),
    normalizeTitle(getMetaContent('meta[name="twitter:title"]')),
    normalizeTitle(getText('h1')),
    normalizeTitle(getText('h4')),
    normalizeTitle(document.title)
  ]);

  return {
    url,
    videoId: extractVideoId(url),
    numericId: getNumericVideoId(),
    title,
    imgSrc,
    preview,
    coverImg: deriveCoverImgFromPreview(preview),
  };
}

function showActionToast(message) {
  const existing = document.getElementById('jable-collect-detail-toast');
  if (existing) {
    existing.remove();
  }

  const toast = document.createElement('div');
  toast.id = 'jable-collect-detail-toast';
  toast.textContent = message;
  toast.style.cssText = `
    position: fixed;
    top: 24px;
    right: 24px;
    z-index: 2147483647;
    max-width: 320px;
    padding: 12px 16px;
    background: rgba(20, 20, 24, 0.96);
    color: #f0ece4;
    border: 1px solid #2a2a30;
    border-left: 3px solid #e8a84c;
    border-radius: 12px;
    box-shadow: 0 12px 28px rgba(0, 0, 0, 0.28), 0 0 0 1px rgba(232, 168, 76, 0.08);
    font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    font-size: 13px;
    line-height: 1.5;
    letter-spacing: 0.2px;
    opacity: 0;
    transform: translateY(-8px);
    transition: opacity 0.18s ease, transform 0.18s ease;
  `;

  document.body.appendChild(toast);

  requestAnimationFrame(() => {
    toast.style.opacity = '1';
    toast.style.transform = 'translateY(0)';
  });

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(-8px)';
    setTimeout(() => toast.remove(), 180);
  }, 3000);
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

function getPageTypeFromFavType(favType) {
  return favType === '1' ? 'watchLater' : 'favorites';
}

function isDuplicateMessage(detail) {
  const key = `${detail.action}:${detail.favType}:${detail.requestVideoId}:${detail.pathname}`;
  const now = Date.now();

  if (key === lastMessageKey && now - lastMessageAt < 400) {
    return true;
  }

  lastMessageKey = key;
  lastMessageAt = now;
  return false;
}

async function syncVideoSource(detail) {
  const pageType = getPageTypeFromFavType(detail.favType);

  if (detail.action === 'add_to_favourites') {
    const video = getCurrentVideoMetadata();
    if (!video.url) return;

    const response = await sendToBackground('saveVideoSource', {
      video,
      pageType,
      site: JABLE_SITE
    });

    if (!response?.success) {
      throw new Error(response?.error || '保存详情页来源失败');
    }

    showActionToast(pageType === 'watchLater' ? '已同步到本地：稍后观看' : '已同步到本地：收藏');
    return;
  }

  if (detail.action === 'delete_from_favourites') {
    const currentUrl = getCanonicalDetailUrl();
    if (!currentUrl) return;

    const response = await sendToBackground('removeVideoSource', {
      url: currentUrl,
      pageType,
      site: JABLE_SITE
    });

    if (!response?.success) {
      throw new Error(response?.error || '移除详情页来源失败');
    }

    showActionToast(pageType === 'watchLater' ? '已从本地移除：稍后观看' : '已从本地移除：收藏');
  }
}

function injectHookScript() {
  const root = document.documentElement;
  if (!root) {
    document.addEventListener('DOMContentLoaded', injectHookScript, { once: true });
    return;
  }

  if (root.dataset.jableCollectDetailHookInjected === 'true') {
    return;
  }

  root.dataset.jableCollectDetailHookInjected = 'true';

  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('content-jable-detail-hook.js');
  script.async = false;
  script.onload = () => script.remove();
  script.onerror = () => script.remove();
  root.appendChild(script);
}

window.addEventListener('message', (event) => {
  if (event.source !== window) return;

  const data = event.data;
  if (!data || data.source !== DETAIL_ACTION_MESSAGE_SOURCE || data.type !== DETAIL_ACTION_MESSAGE_TYPE) {
    return;
  }

  const detail = data.detail || {};
  if (!detail.action || !detail.favType) {
    return;
  }

  if (isDuplicateMessage(detail)) {
    return;
  }

  actionQueue = actionQueue
    .catch(() => {})
    .then(async () => {
      await syncVideoSource(detail);

      if (detail.action === 'delete_from_favourites' && detail.requestVideoId) {
        const commandKey = `delete_from_favourites:${detail.favType}:${detail.requestVideoId.toUpperCase()}`;
        const waiter = pendingCommandWaiters.get(commandKey);
        if (waiter) {
          pendingCommandWaiters.delete(commandKey);
          clearTimeout(waiter.timer);
          waiter.resolve();
        }
      }
    })
    .catch((error) => {
      if (detail.action === 'delete_from_favourites' && detail.requestVideoId) {
        const commandKey = `delete_from_favourites:${detail.favType}:${detail.requestVideoId.toUpperCase()}`;
        const waiter = pendingCommandWaiters.get(commandKey);
        if (waiter) {
          pendingCommandWaiters.delete(commandKey);
          clearTimeout(waiter.timer);
          waiter.reject(error);
        }
      }

      console.error('[jable-detail] 详情页动作同步失败:', error);
    });
});

injectHookScript();

// Listen for commands from background (e.g. triggered from Options page)
chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request.action !== 'removeVideoSourceFromWebsite') return false;

  const { url, favType } = request;
  if (!url || !favType) {
    sendResponse({ success: false, error: '缺少 url 或 favType' });
    return false;
  }

  const currentUrl = getCanonicalDetailUrl();
  const normalizedRequestUrl = normalizeJableUrl(url);
  if (!currentUrl || !normalizedRequestUrl || currentUrl !== normalizedRequestUrl) {
    sendResponse({ success: false, error: '当前详情页与目标视频不匹配' });
    return false;
  }

  if (favType !== '0' && favType !== '1') {
    sendResponse({ success: false, error: '无效的 favType' });
    return false;
  }

  const currentVideo = getCurrentVideoMetadata();
  const numericVideoId = currentVideo.numericId;
  if (!numericVideoId) {
    sendResponse({ success: false, error: '当前页面缺少 video_id，无法执行官网删除' });
    return false;
  }

  const requestVideoKey = currentVideo.videoId || normalizedRequestUrl;

  // Register a one-shot waiter: after the hook fires and the local sync finishes,
  // we resolve the command so Options reloads the already-updated local state.
  const commandKey = `delete_from_favourites:${favType}:${requestVideoKey.toUpperCase()}`;

  const promise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingCommandWaiters.delete(commandKey);
      reject(new Error('远程删除超时，Jable 未响应'));
    }, ACTION_SYNC_TIMEOUT_MS);

    pendingCommandWaiters.set(commandKey, { resolve, reject, timer });
  });

  const requestId = `${Date.now()}:${Math.random().toString(36).slice(2)}`;

  function handleCommandResult(event) {
    if (event.source !== window) return;

    const data = event.data;
    if (!data || data.source !== DETAIL_ACTION_MESSAGE_SOURCE || data.type !== DETAIL_COMMAND_RESULT_MESSAGE_TYPE) {
      return;
    }

    const detail = data.detail || {};
    if (detail.requestId !== requestId) {
      return;
    }

    window.removeEventListener('message', handleCommandResult);

    if (!detail.success) {
      const waiter = pendingCommandWaiters.get(commandKey);
      if (waiter) {
        pendingCommandWaiters.delete(commandKey);
        clearTimeout(waiter.timer);
        waiter.reject(new Error(detail.error || 'Jable 删除失败'));
      }
    }
  }

  window.addEventListener('message', handleCommandResult);
  window.postMessage({
    source: DETAIL_ACTION_MESSAGE_SOURCE,
    type: DETAIL_COMMAND_MESSAGE_TYPE,
    detail: {
      requestId,
      action: 'delete_from_favourites',
      favType,
      videoId: numericVideoId,
      requestVideoKey
    }
  }, window.location.origin);

  promise
    .then(() => sendResponse({ success: true }))
    .catch((err) => sendResponse({ success: false, error: err.message }));

  return true; // keep channel open for async response
});

