const JABLE_SITE = 'jable';
const DETAIL_ACTION_MESSAGE_SOURCE = 'jable-collect';
const DETAIL_ACTION_MESSAGE_TYPE = 'jable-detail-action';

let actionQueue = Promise.resolve();
let lastMessageKey = '';
let lastMessageAt = 0;

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

function getCanonicalDetailUrl() {
  const canonicalHref = getAttribute('link[rel="canonical"]', 'href');
  return normalizeJableUrl(canonicalHref || window.location.href);
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

function getCurrentVideoMetadata() {
  const url = getCanonicalDetailUrl();
  const { imgSrc, imgDataSrc, preview } = getResolvedPreviewAndImages();
  const detailTitle = firstFilled([
    normalizeTitle(getMetaContent('meta[property="og:title"]')),
    normalizeTitle(getMetaContent('meta[name="twitter:title"]')),
    normalizeTitle(getText('h1')),
    normalizeTitle(getText('h4')),
    normalizeTitle(document.title)
  ]);

  return {
    url,
    detailHref: url,
    detailTitle,
    videoId: extractVideoId(url),
    imgSrc,
    imgDataSrc: imgDataSrc || imgSrc,
    preview,
    from: JABLE_SITE,
    site: JABLE_SITE
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
    .then(() => syncVideoSource(detail))
    .catch((error) => {
      console.error('[jable-detail] 详情页动作同步失败:', error);
    });
});

injectHookScript();
