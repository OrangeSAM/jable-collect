const test = require('node:test');
const assert = require('node:assert/strict');
const Shared = require('../missav-shared.js');

test('normalizes supported MissAV URLs without query or hash', () => {
  assert.equal(
    Shared.normalizeMissavUrl('https://missav.ai/cn/hmdnv-727/?from=saved#player'),
    'https://missav.ai/cn/hmdnv-727'
  );
  assert.equal(Shared.normalizeMissavUrl('https://example.com/hmdnv-727'), null);
  assert.equal(Shared.normalizeMissavUrl('http://missav.ws/hmdnv-727'), null);
});

test('extracts only detail-page style video IDs', () => {
  assert.equal(Shared.extractMissavVideoId('https://missav.ws/hmdnv-727'), 'HMDNV-727');
  assert.equal(Shared.extractMissavVideoId('https://missav.live/cn/hmdnv-727'), 'HMDNV-727');
  assert.equal(Shared.extractMissavVideoId('https://missav.ws/dm26/mpg017'), 'MPG017');
  assert.equal(Shared.extractMissavVideoId('https://missav.ws/dm31/md0195'), 'MD0195');
  assert.equal(Shared.extractMissavVideoId('https://missav.ws/mfk0033'), 'MFK0033');
  assert.equal(
    Shared.extractMissavVideoId('https://missav.ws/pacopacomama-070426_100'),
    'PACOPACOMAMA-070426_100'
  );
  assert.equal(
    Shared.extractMissavVideoId('https://missav.ws/cn/siro-5720-uncensored-leak'),
    'SIRO-5720'
  );
  assert.equal(Shared.isMissavDetailUrl('https://missav.ws/cn/siro-5720-uncensored-leak'), true);
  assert.equal(Shared.extractMissavVideoId('https://missav.ws/cn/saved'), null);
  assert.equal(Shared.extractMissavVideoId('https://missav.ws/api/actresses/1016525'), null);
});

test('parses one complete opaque item endpoint pair', () => {
  const source = `
    axios.get('https://missav.ws/api/items/ftonxxck/view')
    window.axios[method]('https://missav.ws/api/items/ftonxxck/save')
  `;
  assert.deepEqual(Shared.parseMissavEndpoints(source), {
    itemId: 'ftonxxck',
    viewPath: '/api/items/ftonxxck/view',
    savePath: '/api/items/ftonxxck/save'
  });
});

test('fails closed for incomplete or ambiguous endpoint data', () => {
  assert.equal(Shared.parseMissavEndpoints('/api/items/one/save'), null);
  assert.equal(Shared.parseMissavEndpoints(`
    /api/items/one/view /api/items/one/save
    /api/items/two/view /api/items/two/save
  `), null);
});

test('view state is authenticated three-state, not saved boolean alone', () => {
  assert.equal(Shared.parseMissavViewState({ user: { id: 1 }, saved: true }), 'authenticated_saved');
  assert.equal(Shared.parseMissavViewState({ user: { id: 1 }, saved: false }), 'authenticated_unsaved');
  assert.equal(Shared.parseMissavViewState({ user: null, saved: false }), 'unknown');
  assert.equal(Shared.parseMissavViewState({ user: { id: 1 }, saved: 'false' }), 'unknown');
});

test('set comparison is order independent and rejects duplicates', () => {
  assert.equal(Shared.sameStringSet(['A', 'B'], ['B', 'A']), true);
  assert.equal(Shared.sameStringSet(['A', 'A'], ['A', 'A']), false);
  assert.equal(Shared.sameStringSet(['A'], ['A', 'B']), false);
});

test('parses MissAV text-input pagination controls', () => {
  assert.deepEqual(Shared.parseMissavPaginationState('2', '/ 146'), { currentPage: 2, totalPage: 146 });
  assert.equal(Shared.parseMissavPaginationState('147', '/ 146'), null);
  assert.equal(Shared.parseMissavPaginationState('1', '下一页'), null);
});

test('reserves front order slots for newly saved MissAV videos', () => {
  assert.equal(Shared.getFrontOrderStart([1, 2, 3], 1), 0);
  assert.equal(Shared.getFrontOrderStart([1, 2, 3], 2), -1);
  assert.deepEqual(
    [Shared.getFrontOrderStart([1, 2, 3], 2), Shared.getFrontOrderStart([1, 2, 3], 2) + 1],
    [-1, 0]
  );
  assert.equal(Shared.getFrontOrderStart([], 2), 1);
  assert.equal(Shared.getFrontOrderStart([1, 2, 3], 0), null);
});
