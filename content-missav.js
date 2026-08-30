const MISSAV_SITE = 'missav';
const PAGE_TYPE = 'favorites';
const BUTTON_ID = 'fetch-missav-favorites-btn';
const PAGE_DELAY_MS = 350;
const MAX_RETRIES = 3;
const Shared = globalThis.MissavShared;

function normalizePathname(pathname = window.location.pathname) {
  return pathname.replace(/\/{2,}/g, '/').replace(/\/+$/, '') || '/saved';
}

function getCurrentSavedUrl(page = 1) {
  const url = new URL(window.location.href);
  url.searchParams.set('page', String(page));
  return url.toString();
}

function extractPageNumber(url, savedPath) {
  try {
    const parsed = new URL(url, window.location.origin);
    if (normalizePathname(parsed.pathname) !== savedPath) return null;
    const page = Number.parseInt(parsed.searchParams.get('page') || '', 10);
    return Number.isInteger(page) && page > 0 ? page : null;
  } catch (error) {
    return null;
  }
}

function parseVideoCard(card) {
  const titleLink = card.querySelector('.my-2.text-sm.text-nord4.truncate a') || card.querySelector('a[href]');
  const img = card.querySelector('img[data-src], img[src]');
  const preview = card.querySelector('video.preview[data-src], video.preview[src]');
  const duration = card.querySelector('span.absolute.bottom-1.right-1, span[class*="bottom-1"][class*="right-1"]');
  const detailHref = Shared.normalizeMissavUrl(titleLink?.getAttribute('href'), window.location.origin);
  const videoId = Shared.extractMissavVideoId(detailHref);
  if (!detailHref) return null;

  const title = (titleLink?.textContent || img?.alt || '').trim();
  return {
    url: detailHref,
    detailHref,
    detailTitle: title,
    title,
    imgSrc: img?.dataset?.src || img?.src || '',
    imgDataSrc: img?.dataset?.src || img?.src || '',
    preview: preview?.dataset?.src || preview?.src || '',
    duration: duration?.textContent?.trim() || '',
    from: MISSAV_SITE,
    site: MISSAV_SITE,
    pageType: PAGE_TYPE,
    videoId
  };
}

function hasAuthenticatedMarker(doc) {
  return Boolean(doc.querySelector('a[href*="logout"], form[action*="logout"], [data-user-menu], [class*="user-menu"]'));
}

function hasExplicitEmptyState(doc) {
  const candidates = doc.querySelectorAll('[class*="empty"], main p, main h2, main h3');
  return Array.from(candidates).some((element) => {
    const text = element.textContent?.trim().toLowerCase() || '';
    return /暂无收藏|尚未收藏|沒有收藏|没有收藏|no saved|no favorites|nothing saved/.test(text);
  });
}

function extractDisplayedTotal(doc) {
  const text = Array.from(doc.querySelectorAll('[data-total], [class*="saved-count"], [class*="favorite-count"]'))
    .map((element) => element.textContent || element.getAttribute('data-total') || '')
    .join(' ');
  const patterns = [
    /(?:总收藏|收藏总数)\s*[:：]?\s*(\d+)\s*(?:部|条|個|个)?/i,
    /(?:saved|favorites?)\s*[:：]?\s*(\d+)/i
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return Number.parseInt(match[1], 10);
  }
  return null;
}

function parsePaginationControls(doc, expectedPage) {
  const controls = Array.from(doc.querySelectorAll('input[name="page"]'))
    .map((input) => Shared.parseMissavPaginationState(input.value, input.parentElement?.textContent))
    .filter(Boolean);

  if (!controls.length) return null;
  if (controls.some((control) => control.currentPage !== expectedPage)) {
    throw new Error(`第 ${expectedPage} 页的分页控件状态不一致`);
  }
  const totals = new Set(controls.map((control) => control.totalPage));
  if (totals.size !== 1) throw new Error(`第 ${expectedPage} 页出现多个总页数`);
  return controls[0];
}

function parseMissavSavedPage(html, responseUrl, expectedPage) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const savedPath = normalizePathname();
  const finalUrl = new URL(responseUrl, window.location.origin);
  if (finalUrl.origin !== window.location.origin || normalizePathname(finalUrl.pathname) !== savedPath) {
    throw new Error(`第 ${expectedPage} 页跳转到非收藏页，可能需要重新登录`);
  }

  const cards = Array.from(doc.querySelectorAll('.thumbnail.group'));
  const videos = cards.map(parseVideoCard);
  if (videos.some((video) => !video)) {
    throw new Error(`第 ${expectedPage} 页有 ${cards.length - videos.filter(Boolean).length} 个卡片解析失败`);
  }

  const pageNumbers = Array.from(doc.querySelectorAll('a[href]'))
    .map((anchor) => extractPageNumber(anchor.getAttribute('href'), savedPath))
    .filter(Boolean);
  const pagination = parsePaginationControls(doc, expectedPage);
  const explicitEmpty = hasExplicitEmptyState(doc);
  const authenticated = cards.length > 0 || hasAuthenticatedMarker(doc);
  if (!authenticated) throw new Error(`第 ${expectedPage} 页无法确认登录状态`);
  if (cards.length === 0 && !explicitEmpty) {
    throw new Error(`第 ${expectedPage} 页没有卡片，也没有识别到官网空状态`);
  }

  return {
    videos,
    candidateCount: cards.length,
    pageNumbers,
    pagination,
    explicitEmpty,
    displayedTotal: extractDisplayedTotal(doc)
  };
}

async function fetchSavedPage(page, attempt = 1) {
  let response;
  try {
    response = await fetch(getCurrentSavedUrl(page), {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store'
    });
  } catch (error) {
    if (attempt < MAX_RETRIES) {
      await new Promise((resolve) => setTimeout(resolve, 800 * (2 ** (attempt - 1))));
      return fetchSavedPage(page, attempt + 1);
    }
    throw new Error(`请求第 ${page} 页失败：${error.message || '网络连接中断'}`, { cause: error });
  }

  if ((response.status === 429 || response.status >= 500) && attempt < MAX_RETRIES) {
    await new Promise((resolve) => setTimeout(resolve, 800 * (2 ** (attempt - 1))));
    return fetchSavedPage(page, attempt + 1);
  }
  if (!response.ok) throw new Error(`请求第 ${page} 页失败：${response.status}`);

  let html;
  try {
    html = await response.text();
  } catch (error) {
    if (attempt < MAX_RETRIES) {
      await new Promise((resolve) => setTimeout(resolve, 800 * (2 ** (attempt - 1))));
      return fetchSavedPage(page, attempt + 1);
    }
    throw new Error(`请求第 ${page} 页失败：${error.message || '响应读取中断'}`, { cause: error });
  }
  return parseMissavSavedPage(html, response.url, page);
}

function validateSnapshot(snapshot) {
  const { pages, totalPage } = snapshot;
  if (!pages.length || pages.length !== totalPage) throw new Error('MissAV 分页快照不完整');

  const firstCapacity = pages[0].candidateCount;
  const seenUrls = new Set();
  pages.forEach((page, index) => {
    const isLastPage = index === pages.length - 1;
    if (!isLastPage && page.candidateCount !== firstCapacity) {
      throw new Error(`第 ${index + 1} 页卡片数与稳定页容量不一致`);
    }
    if (isLastPage && page.candidateCount > firstCapacity) throw new Error('末页卡片数超过稳定页容量');
    page.videos.forEach((video) => {
      const normalizedUrl = Shared.normalizeMissavUrl(video.url);
      if (!normalizedUrl || seenUrls.has(normalizedUrl)) throw new Error(`分页中出现重复影片：${normalizedUrl || '未知链接'}`);
      seenUrls.add(normalizedUrl);
    });
  });

  const displayedTotals = pages.map((page) => page.displayedTotal).filter(Number.isInteger);
  if (displayedTotals.length && displayedTotals.some((total) => total !== seenUrls.size)) {
    throw new Error('官网显示的收藏总数与解析结果不一致');
  }

  snapshot.videos = pages.flatMap((page) => page.videos);
  snapshot.videoUrls = snapshot.videos.map((video) => Shared.normalizeMissavUrl(video.url)).sort();
  snapshot.videoIds = snapshot.videos.map((video) => video.videoId).filter(Boolean).sort();
  snapshot.pageCounts = pages.map((page) => page.candidateCount);
  return snapshot;
}

async function collectSnapshot(round, updateProgress) {
  const firstPage = await fetchSavedPage(1);
  const totalPage = firstPage.pagination?.totalPage
    || (firstPage.pageNumbers.length ? Math.max(...firstPage.pageNumbers) : 1);
  if (!Number.isInteger(totalPage) || totalPage < 1) throw new Error('无法识别 MissAV 总页数');

  const pages = [firstPage];
  updateProgress(round, 1, totalPage);
  for (let page = 2; page <= totalPage; page++) {
    await new Promise((resolve) => setTimeout(resolve, PAGE_DELAY_MS));
    const parsedPage = await fetchSavedPage(page);
    const declaredTotal = parsedPage.pagination?.totalPage
      || (parsedPage.pageNumbers.length ? Math.max(...parsedPage.pageNumbers) : totalPage);
    if (declaredTotal !== totalPage) throw new Error(`第 ${page} 页报告的总页数发生变化`);
    pages.push(parsedPage);
    updateProgress(round, page, totalPage);
  }
  return validateSnapshot({ round, totalPage, pages });
}

function snapshotsMatch(first, second) {
  return first.totalPage === second.totalPage
    && first.pageCounts.length === second.pageCounts.length
    && first.pageCounts.every((count, index) => count === second.pageCounts[index])
    && Shared.sameStringSet(first.videoUrls, second.videoUrls);
}

function sendToBackground(action, data = {}) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ action, ...data }, (response) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else if (!response?.success) reject(new Error(response?.error || '后台同步失败'));
      else resolve(response);
    });
  });
}

function setSyncStatus(status) {
  try {
    if (typeof chrome === 'undefined' || !chrome.storage?.local?.set) {
      console.warn('[missav] 无法写入同步状态：storage API 不可用');
      return;
    }
    const pending = chrome.storage.local.set({
      lastSyncStatus: { ...status, site: MISSAV_SITE, pageType: PAGE_TYPE, updatedAt: Date.now() }
    });
    if (pending && typeof pending.catch === 'function') {
      pending.catch((error) => console.warn('[missav] 写入同步状态失败:', error));
    }
  } catch (error) {
    console.warn('[missav] 写入同步状态失败:', error);
  }
}

function createFetchButton() {
  if (document.getElementById(BUTTON_ID)) return document.getElementById(BUTTON_ID);
  const button = document.createElement('button');
  button.id = BUTTON_ID;
  button.textContent = '📥 安全同步 MissAV 收藏';
  button.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:10px 18px;background:linear-gradient(135deg,#f59e0b 0%,#d97706 100%);color:#111827;border:none;border-radius:999px;cursor:pointer;font-size:13px;font-weight:600;box-shadow:0 6px 18px rgba(217,119,6,.28);';
  button.addEventListener('click', () => handleFetchClick());

  const container = document.createElement('div');
  container.style.cssText = 'display:flex;justify-content:flex-end;margin:16px 0 20px;';
  container.appendChild(button);
  const target = document.querySelector('nav + div.max-w-7xl') || document.querySelector('main .max-w-7xl') || document.querySelector('main') || document.body;
  if (target === document.body) {
    container.style.cssText += 'position:fixed;top:84px;right:24px;z-index:9999;margin:0;';
    document.body.appendChild(container);
  } else {
    target.insertBefore(container, target.firstChild);
  }
  return button;
}

async function fetchAllFavorites() {
  const button = document.getElementById(BUTTON_ID);
  const updateProgress = (round, page, total) => {
    if (button) button.textContent = `校验 ${round}/2 · ${page}/${total}`;
  };

  const first = await collectSnapshot(1, updateProgress);
  await new Promise((resolve) => setTimeout(resolve, PAGE_DELAY_MS));
  const second = await collectSnapshot(2, updateProgress);

  if (snapshotsMatch(first, second)) {
    const response = await sendToBackground('replaceMissavFavorites', { videos: second.videos });
    return { count: response.count, mode: 'replaced' };
  }

  const response = await sendToBackground('syncFavorites', {
    videos: second.videos,
    pageType: PAGE_TYPE,
    site: MISSAV_SITE
  });
  return { count: response.count, mode: 'upsert-only' };
}

function confirmFullSync() {
  return confirm('MissAV 官网将作为唯一准则。只有两轮完整校验一致时，插件才会删除官网已不存在的本地收藏。继续同步吗？');
}

async function handleFetchClick(confirmed = false) {
  const button = document.getElementById(BUTTON_ID);
  if (!button || button.disabled) return;
  if (!confirmed && !confirmFullSync()) return;
  button.disabled = true;
  button.textContent = '⏳ 准备校验...';
  setSyncStatus({ state: 'running', message: '正在执行 MissAV 双轮安全同步' });

  try {
    const result = await fetchAllFavorites();
    const message = result.mode === 'replaced'
      ? `同步完成，本地已与官网 ${result.count} 条收藏一致`
      : `检测到抓取期间收藏变化，已更新 ${result.count} 条，但没有删除本地旧记录`;
    setSyncStatus({ state: 'success', count: result.count, mode: result.mode, message });
    button.textContent = result.mode === 'replaced' ? '✅ 同步完成' : '⚠️ 已安全更新，未删除';
    showNotification(message);
  } catch (error) {
    console.error('[missav] 安全同步失败:', error);
    setSyncStatus({ state: 'error', message: error.message || '同步 MissAV 收藏失败' });
    button.textContent = '❌ 同步失败，旧数据已保留';
    showNotification(error.message || '同步失败，旧数据已保留');
  }

  setTimeout(() => {
    button.disabled = false;
    button.textContent = '📥 安全同步 MissAV 收藏';
  }, 3000);
}

function showNotification(message) {
  const notification = document.createElement('div');
  notification.textContent = message;
  notification.style.cssText = 'position:fixed;top:24px;right:24px;z-index:10000;max-width:360px;padding:14px 18px;background:rgba(17,24,39,.96);color:#f9fafb;border:1px solid rgba(245,158,11,.35);border-radius:12px;box-shadow:0 12px 28px rgba(0,0,0,.28);font-size:13px;line-height:1.5;';
  document.body.appendChild(notification);
  setTimeout(() => notification.remove(), 4500);
}

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request.action !== 'triggerSyncFromPopup') return false;
  const button = document.getElementById(BUTTON_ID);
  if (!button) {
    sendResponse({ success: false, error: '同步按钮未初始化' });
    return false;
  }
  if (button.disabled) {
    sendResponse({ success: false, error: '当前已有同步任务正在运行' });
    return false;
  }
  if (!confirmFullSync()) {
    sendResponse({ success: false, error: '用户取消了同步' });
    return false;
  }
  handleFetchClick(true);
  sendResponse({ success: true });
  return false;
});

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', createFetchButton, { once: true });
} else {
  createFetchButton();
}
