const test = require('node:test');
const assert = require('node:assert/strict');
const { OptionsManager } = require('../options.js');

test('open MissAV manager refreshes after a verified favorite change', async () => {
  const manager = Object.create(OptionsManager.prototype);
  manager.activeSite = 'missav';
  manager.missavReloadTimer = null;
  let reloads = 0;
  manager.loadVideos = async () => {
    reloads += 1;
  };

  manager.handleRuntimeMessage({ action: 'missavFavoritesChanged', site: 'missav' });
  await new Promise((resolve) => setTimeout(resolve, 130));
  assert.equal(reloads, 1);
});

test('Jable manager is not interrupted by MissAV changes', async () => {
  const manager = Object.create(OptionsManager.prototype);
  manager.activeSite = 'jable';
  manager.missavReloadTimer = null;
  let reloads = 0;
  manager.loadVideos = async () => {
    reloads += 1;
  };

  manager.handleRuntimeMessage({ action: 'missavFavoritesChanged', site: 'missav' });
  await new Promise((resolve) => setTimeout(resolve, 130));
  assert.equal(reloads, 0);
});
