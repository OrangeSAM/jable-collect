const test = require('node:test');
const assert = require('node:assert/strict');
const manifest = require('../manifest.json');

test('MissAV detail hook is injected from the isolated content script', () => {
  const missavDetailEntry = manifest.content_scripts.find((entry) =>
    entry.js?.includes('content-missav-detail.js')
  );
  assert.ok(missavDetailEntry);
  assert.equal(missavDetailEntry.world, undefined);
  assert.equal(
    manifest.content_scripts.some((entry) => entry.js?.includes('content-missav-detail-hook.js')),
    false
  );

  const resources = manifest.web_accessible_resources.flatMap((entry) => entry.resources || []);
  assert.ok(resources.includes('missav-shared.js'));
  assert.ok(resources.includes('content-missav-detail-hook.js'));
});

test('收藏页在业务脚本前加载持久同步状态栏', () => {
  const jableFavorites = manifest.content_scripts.find((entry) =>
    entry.js?.includes('content.js')
  );
  const missavFavorites = manifest.content_scripts.find((entry) =>
    entry.js?.includes('content-missav.js')
  );

  assert.deepEqual(jableFavorites.js.slice(-2), ['sync-status-ui.js', 'content.js']);
  assert.deepEqual(missavFavorites.js.slice(-2), ['sync-status-ui.js', 'content-missav.js']);
});
