(() => {
  const Shared = window.MissavShared;
  if (!Shared || !Shared.isMissavDetailUrl(window.location.href) || window.__jableCollectMissavHookInstalled) return;
  window.__jableCollectMissavHookInstalled = true;

  const SOURCE = 'jable-collect-missav';
  const EVENT_TYPE = 'missav-verified-state';
  const STATUS_TYPE = 'missav-sync-status';
  const COMMAND_TYPE = 'missav-detail-command';
  const COMMAND_RESULT_TYPE = 'missav-detail-command-result';
  const nativeFetch = window.fetch;
  const nativeXHROpen = XMLHttpRequest.prototype.open;
  const nativeXHRSend = XMLHttpRequest.prototype.send;
  const xhrMeta = new WeakMap();
  const generations = new Map();
  const verificationTimers = new Map();

  function post(type, detail) {
    window.postMessage({ source: SOURCE, type, detail }, window.location.origin);
  }

  function postRequestStatus(state, meta, error = '') {
    if (!meta?.itemId) return;
    post(STATUS_TYPE, {
      state,
      itemId: meta.itemId,
      desiredSaved: meta.method === 'POST',
      error
    });
  }

  function nextGeneration(itemId) {
    const generation = (generations.get(itemId) || 0) + 1;
    generations.set(itemId, generation);
    return generation;
  }

  function getEndpointConfig() {
    const parts = [];
    document.querySelectorAll('[x-data], [x-init]').forEach((element) => {
      const xData = element.getAttribute('x-data');
      const xInit = element.getAttribute('x-init');
      if (xData) parts.push(xData);
      if (xInit) parts.push(xInit);
    });
    return Shared.parseMissavEndpoints(parts.join('\n'));
  }

  async function waitForPageApi(timeoutMs = 10000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const endpoints = getEndpointConfig();
      if (endpoints && window.axios) return endpoints;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error('MissAV 页面接口尚未就绪');
  }

  async function verifyState(endpoints, generation, requestId = null) {
    try {
      const response = await window.axios.get(window.location.origin + endpoints.viewPath);
      if (generations.get(endpoints.itemId) !== generation) return null;

      const state = Shared.parseMissavViewState(response?.data);
      post(EVENT_TYPE, {
        itemId: endpoints.itemId,
        generation,
        requestId,
        state
      });
      return state;
    } catch (error) {
      if (generations.get(endpoints.itemId) === generation) {
        post(EVENT_TYPE, {
          itemId: endpoints.itemId,
          generation,
          requestId,
          state: 'unknown',
          error: error?.message || 'MissAV 状态确认失败'
        });
      }
      return 'unknown';
    }
  }

  function scheduleVerification(itemId) {
    const generation = nextGeneration(itemId);
    clearTimeout(verificationTimers.get(itemId));
    verificationTimers.set(itemId, setTimeout(async () => {
      verificationTimers.delete(itemId);
      try {
        const endpoints = await waitForPageApi();
        if (endpoints.itemId !== itemId || generations.get(itemId) !== generation) return;
        await verifyState(endpoints, generation);
      } catch (error) {
        if (generations.get(itemId) === generation) {
          post(EVENT_TYPE, { itemId, generation, state: 'unknown', error: error.message });
        }
      }
    }, 150));
  }

  function parseSaveRequest(input, method) {
    try {
      const url = new URL(typeof input === 'string' ? input : input?.url, window.location.href);
      const normalizedMethod = String(method || input?.method || 'GET').toUpperCase();
      if (url.origin !== window.location.origin || (normalizedMethod !== 'POST' && normalizedMethod !== 'DELETE')) {
        return null;
      }
      const match = url.pathname.match(/^\/api\/items\/([a-z0-9_-]+)\/save$/i);
      return match ? { itemId: match[1], method: normalizedMethod } : null;
    } catch (error) {
      return null;
    }
  }

  window.fetch = function wrappedFetch(input, init) {
    const meta = parseSaveRequest(input, init?.method);
    const promise = nativeFetch.apply(this, arguments);
    if (!meta || !promise?.then) return promise;

    postRequestStatus('pending', meta);

    return promise.then(
      (response) => {
        if (response?.ok) {
          scheduleVerification(meta.itemId);
        } else {
          postRequestStatus('error', meta, `MissAV 官网请求失败（HTTP ${response?.status || '未知'}）`);
        }
        return response;
      },
      (error) => {
        postRequestStatus('error', meta, error?.message || 'MissAV 官网请求失败');
        throw error;
      }
    );
  };

  XMLHttpRequest.prototype.open = function wrappedOpen(method, url) {
    xhrMeta.set(this, parseSaveRequest(url, method));
    return nativeXHROpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function wrappedSend() {
    const meta = xhrMeta.get(this);
    if (meta) {
      postRequestStatus('pending', meta);
      this.addEventListener('load', () => {
        if (this.status >= 200 && this.status < 300) {
          scheduleVerification(meta.itemId);
        } else {
          postRequestStatus('error', meta, `MissAV 官网请求失败（HTTP ${this.status || '未知'}）`);
        }
      }, { once: true });
      this.addEventListener('error', () => {
        postRequestStatus('error', meta, 'MissAV 官网网络请求失败');
      }, { once: true });
      this.addEventListener('timeout', () => {
        postRequestStatus('error', meta, 'MissAV 官网请求超时');
      }, { once: true });
    }
    return nativeXHRSend.apply(this, arguments);
  };

  window.addEventListener('message', async (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== SOURCE || data.type !== COMMAND_TYPE) return;

    const requestId = String(data.detail?.requestId || '');
    const desiredSaved = data.detail?.desiredSaved;
    if (!requestId || typeof desiredSaved !== 'boolean') return;

    try {
      const endpoints = await waitForPageApi();
      let generation = nextGeneration(endpoints.itemId);
      let state = await verifyState(endpoints, generation, requestId);
      if (!Shared.isVerifiedMissavState(state)) {
        throw new Error('无法确认 MissAV 登录状态');
      }

      const alreadyDesired = desiredSaved
        ? state === 'authenticated_saved'
        : state === 'authenticated_unsaved';

      if (!alreadyDesired) {
        if (desiredSaved) {
          await window.axios.post(window.location.origin + endpoints.savePath);
        } else {
          await window.axios.delete(window.location.origin + endpoints.savePath);
        }
        generation = nextGeneration(endpoints.itemId);
        state = await verifyState(endpoints, generation, requestId);
      }

      const confirmed = desiredSaved
        ? state === 'authenticated_saved'
        : state === 'authenticated_unsaved';
      if (!confirmed) throw new Error('MissAV 官网状态复查不一致');

      post(COMMAND_RESULT_TYPE, {
        requestId,
        success: true,
        itemId: endpoints.itemId,
        generation,
        state
      });
    } catch (error) {
      post(COMMAND_RESULT_TYPE, {
        requestId,
        success: false,
        error: error?.message || 'MissAV 官网操作失败'
      });
    }
  });
})();
