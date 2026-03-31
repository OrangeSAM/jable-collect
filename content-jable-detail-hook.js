(() => {
  const MESSAGE_SOURCE = 'jable-collect';
  const MESSAGE_TYPE = 'jable-detail-action';
  const COMMAND_MESSAGE_TYPE = 'jable-detail-command';
  const COMMAND_RESULT_MESSAGE_TYPE = 'jable-detail-command-result';
  const FAVORITE_ACTIONS = new Set(['add_to_favourites', 'delete_from_favourites']);
  const recentEvents = new Map();
  const nativeFetch = window.fetch;
  const nativeXHROpen = XMLHttpRequest.prototype.open;
  const nativeXHRSend = XMLHttpRequest.prototype.send;
  const xhrRequests = new WeakMap();
  const currentPath = normalizePathname(window.location.pathname);

  function normalizePathname(pathname = '') {
    const trimmed = String(pathname).replace(/\/+$/, '');
    return trimmed ? `${trimmed}/` : '/';
  }

  function toURL(input) {
    try {
      if (!input) return null;
      if (input instanceof URL) return input;
      if (typeof input === 'string') return new URL(input, window.location.href);
      if (typeof Request !== 'undefined' && input instanceof Request) {
        return new URL(input.url, window.location.href);
      }
      if (typeof input.url === 'string') {
        return new URL(input.url, window.location.href);
      }
      return null;
    } catch (error) {
      return null;
    }
  }

  function appendBodyParams(params, body) {
    if (!body) return;

    if (body instanceof URLSearchParams) {
      for (const [key, value] of body.entries()) {
        params.append(key, value);
      }
      return;
    }

    if (typeof FormData !== 'undefined' && body instanceof FormData) {
      for (const [key, value] of body.entries()) {
        if (typeof value === 'string') {
          params.append(key, value);
        }
      }
      return;
    }

    if (typeof body === 'string') {
      const bodyParams = new URLSearchParams(body);
      for (const [key, value] of bodyParams.entries()) {
        params.append(key, value);
      }
    }
  }

  function buildSearchParams(url, body) {
    const params = new URLSearchParams(url.search);
    appendBodyParams(params, body);
    return params;
  }

  function getSingleRequestVideoId(params) {
    const ids = [];
    const directId = params.get('video_id');
    if (directId) ids.push(directId);

    params.getAll('video_ids[]').forEach((id) => {
      if (id) ids.push(id);
    });

    const uniqueIds = [...new Set(ids)];
    return uniqueIds.length === 1 ? uniqueIds[0] : null;
  }

  function parseFavoriteRequest(input, body) {
    const url = toURL(input);
    if (!url || url.origin !== window.location.origin) {
      return null;
    }

    const pathname = normalizePathname(url.pathname);
    if (pathname !== currentPath || !pathname.startsWith('/videos/')) {
      return null;
    }

    const params = buildSearchParams(url, body);
    if (params.get('mode') !== 'async' || params.get('format') !== 'json' || params.get('playlist_id') !== '0') {
      return null;
    }

    const action = params.get('action');
    if (!FAVORITE_ACTIONS.has(action)) {
      return null;
    }

    const favType = params.get('fav_type');
    if (favType !== '0' && favType !== '1') {
      return null;
    }

    const requestVideoId = getSingleRequestVideoId(params);
    if (!requestVideoId) {
      return null;
    }

    return {
      action,
      favType,
      requestVideoId,
      pathname
    };
  }

  function shouldSkipEvent(signature) {
    const now = Date.now();
    const lastTime = recentEvents.get(signature);
    recentEvents.set(signature, now);

    for (const [key, value] of recentEvents.entries()) {
      if (now - value > 1500) {
        recentEvents.delete(key);
      }
    }

    return Boolean(lastTime && now - lastTime < 300);
  }

  function emitAction(meta, payload) {
    if (!payload || payload.status === 'failure') {
      return;
    }

    const signature = `${meta.action}:${meta.favType}:${meta.requestVideoId}:${meta.pathname}`;
    if (shouldSkipEvent(signature)) {
      return;
    }

    window.postMessage({
      source: MESSAGE_SOURCE,
      type: MESSAGE_TYPE,
      detail: meta
    }, window.location.origin);
  }

  window.fetch = function wrappedFetch(input, init) {
    const meta = parseFavoriteRequest(input, init?.body);
    const requestPromise = nativeFetch.apply(this, arguments);

    if (!meta || !requestPromise || typeof requestPromise.then !== 'function') {
      return requestPromise;
    }

    return requestPromise.then(async (response) => {
      if (!response?.ok) {
        return response;
      }

      try {
        const payload = await response.clone().json();
        emitAction(meta, payload);
      } catch (error) {
      }

      return response;
    });
  };

  XMLHttpRequest.prototype.open = function wrappedOpen(method, url) {
    xhrRequests.set(this, { method, url });
    return nativeXHROpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function wrappedSend(body) {
    const request = xhrRequests.get(this);
    const meta = request ? parseFavoriteRequest(request.url, body) : null;

    if (meta) {
      this.addEventListener('load', () => {
        if (this.status < 200 || this.status >= 300) {
          return;
        }

        try {
          const payload = this.responseType === 'json'
            ? this.response
            : JSON.parse(this.responseText || 'null');
          emitAction(meta, payload);
        } catch (error) {
        }
      }, { once: true });
    }

    return nativeXHRSend.apply(this, arguments);
  };

  window.addEventListener('message', async (event) => {
    if (event.source !== window) return;

    const data = event.data;
    if (!data || data.source !== MESSAGE_SOURCE || data.type !== COMMAND_MESSAGE_TYPE) {
      return;
    }

    const detail = data.detail || {};
    if (detail.action !== 'delete_from_favourites') {
      return;
    }

    const favType = detail.favType;
    const videoId = String(detail.videoId || '').trim();
    const requestVideoKey = String(detail.requestVideoKey || '').trim();
    if ((favType !== '0' && favType !== '1') || !videoId) {
      window.postMessage({
        source: MESSAGE_SOURCE,
        type: COMMAND_RESULT_MESSAGE_TYPE,
        detail: {
          requestId: detail.requestId,
          success: false,
          error: '缺少 videoId 或 favType'
        }
      }, window.location.origin);
      return;
    }

    try {
      const params = new URLSearchParams();
      params.set('mode', 'async');
      params.set('format', 'json');
      params.set('playlist_id', '0');
      params.set('action', 'delete_from_favourites');
      params.set('fav_type', favType);
      params.set('video_id', videoId);
      params.append('video_ids[]', videoId);

      const response = await nativeFetch(window.location.origin + currentPath + '?' + params.toString(), {
        method: 'GET',
        credentials: 'same-origin'
      });

      if (!response.ok) {
        throw new Error(`请求失败 (${response.status})`);
      }

      let payload = null;
      try {
        payload = await response.clone().json();
      } catch (error) {
      }

      if (!payload || payload.status === 'failure') {
        throw new Error(payload?.msg || payload?.message || 'Jable 删除失败');
      }

      emitAction({
        action: 'delete_from_favourites',
        favType,
        requestVideoId: requestVideoKey || videoId,
        pathname: currentPath
      }, payload);

      window.postMessage({
        source: MESSAGE_SOURCE,
        type: COMMAND_RESULT_MESSAGE_TYPE,
        detail: {
          requestId: detail.requestId,
          success: true
        }
      }, window.location.origin);
    } catch (error) {
      window.postMessage({
        source: MESSAGE_SOURCE,
        type: COMMAND_RESULT_MESSAGE_TYPE,
        detail: {
          requestId: detail.requestId,
          success: false,
          error: error?.message || 'Jable 删除失败'
        }
      }, window.location.origin);
    }
  });
})();
