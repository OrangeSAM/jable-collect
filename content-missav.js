const MISSAV_SITE = 'missav';
const PAGE_TYPE = 'favorites';
const BUTTON_ID = 'fetch-missav-favorites-btn';

let totalPage = 1;
let missavVideos = [];

function normalizePathname(pathname = window.location.pathname) {
  return pathname.replace(/\/+$/, '') || '/saved';
}

function getCurrentSavedUrl(page = 1) {
  const url = new URL(window.location.href);
  url.searchParams.set('page', String(page));
  return url.toString();
}

function getTotalPage() {
  const currentPath = normalizePathname();
  const pageNumbers = Array.from(document.querySelectorAll('a[href]')).map(anchor => {
    try {
      const url = new URL(anchor.href, window.location.origin);
      if (normalizePathname(url.pathname) !== currentPath) return null;
      const page = parseInt(url.searchParams.get('page') || '', 10);
      return Number.isNaN(page) ? null : page;
    } catch (error) {
      return null;
    }
  }).filter(Boolean);

  if (pageNumbers.length) {
    totalPage = Math.max(...pageNumbers);
    console.log('[missav] 提取到的总页数:', totalPage);
    return;
  }

  totalPage = 1;
  console.log('[missav] 无法识别分页，默认 totalPage = 1');
}

function extractVideoId(url) {
  if (!url) return null;

  try {
    const pathname = new URL(url, window.location.origin).pathname.replace(/\/+$/, '');
    const segments = pathname.split('/').filter(Boolean);
    return segments.length ? decodeURIComponent(segments[segments.length - 1]).toUpperCase() : null;
  } catch (error) {
    return null;
  }
}

function parseMissavDomData(html) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const cards = doc.querySelectorAll('.thumbnail.group');
  const videos = [];

  cards.forEach(card => {
    const titleLink = card.querySelector('.my-2.text-sm.text-nord4.truncate a');
    const coverLink = titleLink || card.querySelector('a[href]');
    const img = card.querySelector('img[data-src], img[src]');
    const preview = card.querySelector('video.preview[data-src], video.preview[src]');
    const duration = card.querySelector('span.absolute.bottom-1.right-1, span[class*="bottom-1"][class*="right-1"]');

    const detailHref = titleLink?.href || coverLink?.href || null;
    if (!detailHref) return;

    videos.push({
      url: detailHref,
      detailHref,
      detailTitle: (titleLink?.textContent || img?.alt || '').trim(),
      imgSrc: img?.src || img?.dataset?.src || '',
      imgDataSrc: img?.dataset?.src || img?.src || '',
      preview: preview?.dataset?.src || preview?.src || '',
      duration: duration?.textContent?.trim() || '',
      from: MISSAV_SITE,
      site: MISSAV_SITE,
      pageType: PAGE_TYPE,
      videoId: extractVideoId(detailHref)
    });
  });

  return videos;
}

async function getMissavFavorites(page) {
  const url = getCurrentSavedUrl(page);
  const response = await fetch(url, {
    method: 'GET',
    credentials: 'include'
  });

  if (!response.ok) {
    throw new Error(`请求第 ${page} 页失败：${response.status}`);
  }

  const html = await response.text();
  const data = parseMissavDomData(html);
  missavVideos.push(...data);
  console.log(`[missav] 第 ${page} 页收藏数据获取完成，共 ${data.length} 条`);
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

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action !== 'triggerSyncFromPopup') return;

  const button = document.getElementById(BUTTON_ID);
  if (!button) {
    sendResponse({ success: false, error: '同步按钮未初始化' });
    return;
  }

  if (button.disabled) {
    sendResponse({ success: false, error: '当前已有同步任务正在运行' });
    return;
  }

  handleFetchClick();
  sendResponse({ success: true });
});

async function saveVideosToDB(videos) {
  const response = await sendToBackground('syncFavorites', {
    videos,
    pageType: PAGE_TYPE,
    site: MISSAV_SITE
  });

  if (!response.success) {
    throw new Error(response.error);
  }

  return response.count;
}

function setSyncStatus(status) {
  chrome.storage.local.set({
    lastSyncStatus: {
      ...status,
      site: MISSAV_SITE,
      pageType: PAGE_TYPE,
      updatedAt: Date.now()
    }
  });
}

function createFetchButton() {
  if (document.getElementById(BUTTON_ID)) {
    return document.getElementById(BUTTON_ID);
  }

  const button = document.createElement('button');
  button.id = BUTTON_ID;
  button.textContent = '📥 获取 MissAV 收藏';
  button.style.cssText = `
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 10px 18px;
    background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
    color: #111827;
    border: none;
    border-radius: 999px;
    cursor: pointer;
    font-size: 13px;
    font-weight: 600;
    transition: all 0.25s ease;
    box-shadow: 0 6px 18px rgba(217, 119, 6, 0.28);
  `;

  button.addEventListener('mouseenter', () => {
    if (button.disabled) return;
    button.style.transform = 'translateY(-1px)';
    button.style.boxShadow = '0 10px 22px rgba(217, 119, 6, 0.35)';
    button.style.filter = 'brightness(1.04)';
  });

  button.addEventListener('mouseleave', () => {
    button.style.transform = 'translateY(0)';
    button.style.boxShadow = '0 6px 18px rgba(217, 119, 6, 0.28)';
    button.style.filter = 'brightness(1)';
  });

  button.addEventListener('click', handleFetchClick);

  const container = document.createElement('div');
  container.style.cssText = 'display:flex; justify-content:flex-end; margin: 16px 0 20px;';
  container.appendChild(button);

  const target = document.querySelector('nav + div.max-w-7xl')
    || document.querySelector('main .max-w-7xl')
    || document.querySelector('main')
    || document.body;

  if (target === document.body) {
    container.style.cssText += ' position: fixed; top: 84px; right: 24px; z-index: 9999; margin: 0;';
    document.body.appendChild(container);
  } else {
    target.insertBefore(container, target.firstChild);
  }

  return button;
}

async function handleFetchClick() {
  const button = document.getElementById(BUTTON_ID);
  if (!button) return;

  button.disabled = true;
  button.textContent = '⏳ 获取中...';
  button.style.background = 'linear-gradient(135deg, #6b7280 0%, #4b5563 100%)';
  button.style.boxShadow = 'none';

  setSyncStatus({
    state: 'running',
    message: '正在同步 MissAV 收藏'
  });

  try {
    const savedCount = await fetchAllFavorites();

    setSyncStatus({
      state: 'success',
      count: savedCount,
      message: `成功同步 ${savedCount} 条 MissAV 收藏`
    });

    button.textContent = '✅ 获取完成';
    button.style.background = 'linear-gradient(135deg, #22c55e 0%, #15803d 100%)';
    button.style.boxShadow = '0 6px 18px rgba(21, 128, 61, 0.28)';
  } catch (error) {
    console.error('[missav] 获取失败:', error);

    setSyncStatus({
      state: 'error',
      message: error.message || '同步 MissAV 收藏失败'
    });

    button.textContent = '❌ 获取失败';
    button.style.background = 'linear-gradient(135deg, #ef4444 0%, #b91c1c 100%)';
    button.style.boxShadow = '0 6px 18px rgba(185, 28, 28, 0.25)';
  }

  setTimeout(() => {
    button.disabled = false;
    button.textContent = '📥 获取 MissAV 收藏';
    button.style.background = 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)';
    button.style.boxShadow = '0 6px 18px rgba(217, 119, 6, 0.28)';
  }, 3000);
}

async function fetchAllFavorites() {
  const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  missavVideos.length = 0;
  getTotalPage();

  for (let page = 1; page <= totalPage; page++) {
    const button = document.getElementById(BUTTON_ID);
    if (button) {
      button.textContent = `获取中... (${page}/${totalPage})`;
    }

    console.log(`[missav] 正在获取第 ${page}/${totalPage} 页收藏数据...`);
    await getMissavFavorites(page);

    if (page < totalPage) {
      await delay(3000);
    }
  }

  const savedCount = await saveVideosToDB(missavVideos);
  console.log(`[missav] 所有收藏数据获取完成，共 ${savedCount} 条已保存到数据库`);
  showNotification(savedCount > 0 ? `已保存 ${savedCount} 条 MissAV 收藏到本地数据库` : '同步完成，当前没有可保存的 MissAV 收藏');
  return savedCount;
}

function showNotification(message) {
  const notification = document.createElement('div');
  notification.textContent = message;
  notification.style.cssText = `
    position: fixed;
    top: 24px;
    right: 24px;
    z-index: 10000;
    max-width: 320px;
    padding: 14px 18px;
    background: rgba(17, 24, 39, 0.95);
    color: #f9fafb;
    border: 1px solid rgba(245, 158, 11, 0.35);
    border-radius: 12px;
    box-shadow: 0 12px 28px rgba(0, 0, 0, 0.28);
    font-size: 13px;
    line-height: 1.5;
  `;

  document.body.appendChild(notification);

  setTimeout(() => {
    notification.remove();
  }, 3000);
}

console.log('[missav] 已初始化收藏插件');
getTotalPage();
console.log(`[missav] 总共有 ${totalPage} 页收藏数据`);

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', createFetchButton);
} else {
  createFetchButton();
}
