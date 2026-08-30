(function initMissavShared(root) {
  const ALLOWED_HOSTS = new Set(['missav.ws', 'missav.ai', 'missav.live']);
  const DETAIL_VIDEO_ID_PATTERN = /^((?:[a-z0-9]+(?:[-_][a-z0-9]+)*[-_][a-z0-9]*\d)|(?:[a-z]+\d+))(?:-[a-z]+(?:-[a-z]+)*)?$/i;

  function isAllowedMissavHost(hostname) {
    return ALLOWED_HOSTS.has(String(hostname || '').toLowerCase());
  }

  function normalizeMissavUrl(input, base = 'https://missav.ws') {
    if (!input) return null;

    try {
      const url = new URL(input, base);
      if (url.protocol !== 'https:' || !isAllowedMissavHost(url.hostname)) {
        return null;
      }

      const pathname = url.pathname.replace(/\/{2,}/g, '/').replace(/\/+$/, '') || '/';
      return `${url.origin}${pathname}`;
    } catch (error) {
      return null;
    }
  }

  function extractMissavVideoId(input, base) {
    const normalizedUrl = normalizeMissavUrl(input, base);
    if (!normalizedUrl) return null;

    try {
      const segments = new URL(normalizedUrl).pathname.split('/').filter(Boolean);
      const candidate = decodeURIComponent(segments[segments.length - 1] || '');
      const match = candidate.match(DETAIL_VIDEO_ID_PATTERN);
      const videoId = match?.[1] || '';
      if (!videoId || (!/[a-z]/i.test(videoId) && !/[-_]/.test(videoId))) return null;
      return videoId.toUpperCase();
    } catch (error) {
      return null;
    }
  }

  function isMissavDetailUrl(input, base) {
    return Boolean(extractMissavVideoId(input, base));
  }

  function parseMissavEndpoints(text) {
    const source = String(text || '').replace(/\\\//g, '/');
    const matches = [...source.matchAll(/(?:https:\/\/[^\s'"`]+)?(\/api\/items\/([a-z0-9_-]+)\/(view|save))/gi)];
    const byItem = new Map();

    matches.forEach((match) => {
      const [, path, itemId, kind] = match;
      if (!byItem.has(itemId)) {
        byItem.set(itemId, { itemId, viewPath: null, savePath: null });
      }
      const entry = byItem.get(itemId);
      if (kind.toLowerCase() === 'view') entry.viewPath = path;
      if (kind.toLowerCase() === 'save') entry.savePath = path;
    });

    const complete = [...byItem.values()].filter((entry) => entry.viewPath && entry.savePath);
    return complete.length === 1 ? complete[0] : null;
  }

  function parseMissavViewState(payload) {
    if (!payload || typeof payload !== 'object') return 'unknown';
    if (!payload.user || typeof payload.saved !== 'boolean') return 'unknown';
    return payload.saved ? 'authenticated_saved' : 'authenticated_unsaved';
  }

  function isVerifiedMissavState(state) {
    return state === 'authenticated_saved' || state === 'authenticated_unsaved';
  }

  function sameStringSet(left, right) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return false;
    }
    const rightSet = new Set(right);
    return rightSet.size === right.length && left.every((value) => rightSet.has(value));
  }

  function parseMissavPaginationState(currentValue, parentText) {
    const currentPage = Number.parseInt(String(currentValue || ''), 10);
    const totalMatch = String(parentText || '').match(/\/\s*(\d+)/);
    const totalPage = totalMatch ? Number.parseInt(totalMatch[1], 10) : null;
    if (!Number.isInteger(currentPage) || currentPage < 1 || !Number.isInteger(totalPage) || totalPage < currentPage) {
      return null;
    }
    return { currentPage, totalPage };
  }

  function getFrontOrderStart(existingOrders, newCount) {
    const count = Number.parseInt(newCount, 10);
    if (!Number.isInteger(count) || count < 1) return null;

    const orders = Array.from(existingOrders || []).filter(Number.isFinite);
    if (!orders.length) return 1;
    return Math.min(...orders) - count;
  }

  const api = {
    ALLOWED_HOSTS,
    DETAIL_VIDEO_ID_PATTERN,
    isAllowedMissavHost,
    normalizeMissavUrl,
    extractMissavVideoId,
    isMissavDetailUrl,
    parseMissavEndpoints,
    parseMissavViewState,
    isVerifiedMissavState,
    sameStringSet,
    parseMissavPaginationState,
    getFrontOrderStart
  };

  root.MissavShared = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
