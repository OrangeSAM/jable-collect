(() => {
  const Shared = globalThis.MissavShared;
  if (!Shared || !Shared.isMissavDetailUrl(window.location.href)) return;

  const SOURCE = 'jable-collect-missav';
  const EVENT_TYPE = 'missav-verified-state';
  const STATUS_TYPE = 'missav-sync-status';
  const COMMAND_TYPE = 'missav-detail-command';
  const COMMAND_RESULT_TYPE = 'missav-detail-command-result';
  const latestGenerations = new Map();
  const appliedGenerations = new Map();
  const pendingWebsiteActions = new Map();

  function injectHookScripts() {
    const root = document.documentElement;
    if (!root) {
      document.addEventListener('DOMContentLoaded', injectHookScripts, { once: true });
      return;
    }
    if (root.dataset.jableCollectMissavDetailHookInjected === 'true') return;

    root.dataset.jableCollectMissavDetailHookInjected = 'true';
    const sharedScript = document.createElement('script');
    sharedScript.src = chrome.runtime.getURL('missav-shared.js');
    sharedScript.onload = () => {
      sharedScript.remove();
      const hookScript = document.createElement('script');
      hookScript.src = chrome.runtime.getURL('content-missav-detail-hook.js');
      hookScript.onload = () => hookScript.remove();
      root.appendChild(hookScript);
    };
    root.appendChild(sharedScript);
  }

  injectHookScripts();

  function showActionToast(message, type = 'info') {
    document.getElementById('jable-collect-missav-toast')?.remove();

    const toast = document.createElement('div');
    toast.id = 'jable-collect-missav-toast';
    toast.textContent = message;
    const accent = type === 'success' ? '#22c55e' : type === 'error' ? '#ef4444' : '#e8a84c';
    toast.style.cssText = `
      position: fixed;
      top: 24px;
      right: 24px;
      z-index: 2147483647;
      max-width: 360px;
      padding: 12px 16px;
      background: rgba(20, 20, 24, 0.96);
      color: #f0ece4;
      border: 1px solid #2a2a30;
      border-left: 3px solid ${accent};
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

    if (!document.body) return;
    document.body.appendChild(toast);
    requestAnimationFrame(() => {
      toast.style.opacity = '1';
      toast.style.transform = 'translateY(0)';
    });
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(-8px)';
      setTimeout(() => toast.remove(), 180);
    }, type === 'error' ? 5000 : 3000);
  }

  function sendToBackground(action, data = {}) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ action, ...data }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else if (!response?.success) {
          reject(new Error(response?.error || '扩展后台操作失败'));
        } else {
          resolve(response);
        }
      });
    });
  }

  function getMetadata() {
    const canonical = document.querySelector('link[rel="canonical"]')?.href || window.location.href;
    const normalizedUrl = Shared.normalizeMissavUrl(canonical, window.location.href)
      || Shared.normalizeMissavUrl(window.location.href);
    const videoId = Shared.extractMissavVideoId(normalizedUrl);
    const title = document.querySelector('h1')?.textContent?.trim()
      || document.querySelector('meta[property="og:title"]')?.content?.trim()
      || document.title?.trim()
      || videoId
      || '';
    const image = document.querySelector('meta[property="og:image"]')?.content
      || document.querySelector('main img[data-src], main img[src]')?.dataset?.src
      || document.querySelector('main img[data-src], main img[src]')?.src
      || '';
    const preview = document.querySelector('video source[src]')?.src
      || document.querySelector('video[src]')?.src
      || '';

    return {
      url: normalizedUrl,
      detailHref: normalizedUrl,
      videoId,
      title,
      detailTitle: title,
      imgSrc: image,
      imgDataSrc: image,
      preview,
      site: 'missav',
      from: 'missav',
      pageType: 'favorites'
    };
  }

  function isCurrentIdentityValid() {
    const metadata = getMetadata();
    return Boolean(metadata.url);
  }

  async function applyVerifiedState(detail) {
    if (!detail || !Shared.isVerifiedMissavState(detail.state) || !isCurrentIdentityValid()) {
      return { applied: false };
    }

    const generation = Number(detail.generation || 0);
    const latest = latestGenerations.get(detail.itemId) || 0;
    if (!detail.itemId || generation < latest) return { applied: false };
    latestGenerations.set(detail.itemId, generation);

    const applied = appliedGenerations.get(detail.itemId) || 0;
    if (generation <= applied) return { applied: false };

    const response = await sendToBackground('applyMissavVerifiedState', {
      state: detail.state,
      itemId: detail.itemId,
      generation,
      video: getMetadata()
    });
    appliedGenerations.set(detail.itemId, generation);
    return { applied: true, response };
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== SOURCE) return;

    if (data.type === STATUS_TYPE) {
      const detail = data.detail;
      if (!detail?.itemId) return;
      if (detail.state === 'pending') {
        pendingWebsiteActions.set(detail.itemId, Boolean(detail.desiredSaved));
        showActionToast(detail.desiredSaved ? '正在确认 MissAV 收藏…' : '正在确认 MissAV 取消收藏…');
      } else if (detail.state === 'error') {
        pendingWebsiteActions.delete(detail.itemId);
        showActionToast(detail.error || 'MissAV 官网操作失败，扩展未修改', 'error');
      }
      return;
    }

    if (data.type !== EVENT_TYPE) return;
    const detail = data.detail;
    const desiredSaved = pendingWebsiteActions.get(detail?.itemId);

    if (!Shared.isVerifiedMissavState(detail?.state)) {
      if (detail?.itemId && pendingWebsiteActions.has(detail.itemId)) {
        pendingWebsiteActions.delete(detail.itemId);
        showActionToast(detail.error || '无法确认 MissAV 登录或收藏状态，扩展未修改', 'error');
      }
      return;
    }

    applyVerifiedState(detail).then((result) => {
      if (!result.applied || !pendingWebsiteActions.has(detail.itemId)) return;
      pendingWebsiteActions.delete(detail.itemId);
      const isSaved = detail.state === 'authenticated_saved';
      if (isSaved !== desiredSaved) {
        showActionToast('MissAV 官网状态与本次操作不一致，扩展已按官网状态更新', 'error');
        return;
      }
      showActionToast(isSaved ? '已同步到扩展：收藏' : '已从扩展移除：收藏', 'success');
    }).catch((error) => {
      pendingWebsiteActions.delete(detail?.itemId);
      showActionToast(`官网操作成功，但同步到扩展失败：${error.message}`, 'error');
      console.error('[missav-detail] 本地状态同步失败:', error);
    });
  });

  chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    if (request.action !== 'setMissavFavoriteOnWebsite') return false;

    const currentVideo = getMetadata();
    const requestedUrl = Shared.normalizeMissavUrl(request.url, window.location.href);
    const requestedVideoId = String(request.videoId || '').toUpperCase();
    const urlMatches = requestedUrl && currentVideo.url === requestedUrl;
    const idMatches = requestedVideoId && currentVideo.videoId === requestedVideoId;
    if (!currentVideo.url || (!urlMatches && !idMatches)) {
      sendResponse({ success: false, error: '当前 MissAV 详情页与目标影片不匹配' });
      return false;
    }

    const requestId = `${Date.now()}:${crypto.randomUUID()}`;
    const timeout = setTimeout(() => {
      window.removeEventListener('message', handleResult);
      sendResponse({ success: false, error: 'MissAV 官网操作超时' });
    }, 20000);

    async function handleResult(event) {
      if (event.source !== window) return;
      const data = event.data;
      if (!data || data.source !== SOURCE || data.type !== COMMAND_RESULT_TYPE) return;
      if (data.detail?.requestId !== requestId) return;

      window.removeEventListener('message', handleResult);
      clearTimeout(timeout);
      if (!data.detail.success) {
        sendResponse({ success: false, error: data.detail.error || 'MissAV 官网操作失败' });
        return;
      }

      try {
        await applyVerifiedState(data.detail);
        sendResponse({ success: true, state: data.detail.state });
      } catch (error) {
        sendResponse({
          success: false,
          remoteChanged: true,
          error: `官网已变化，本地待修复：${error.message}`
        });
      }
    }

    window.addEventListener('message', handleResult);
    window.postMessage({
      source: SOURCE,
      type: COMMAND_TYPE,
      detail: {
        requestId,
        desiredSaved: Boolean(request.desiredSaved)
      }
    }, window.location.origin);

    return true;
  });
})();
