const test = require('node:test');
const assert = require('node:assert/strict');
const { getSyncStatusView } = require('../sync-status-ui.js');

const context = {
  site: 'missav',
  pageType: 'favorites',
  siteLabel: 'MissAV',
  sourceLabel: '收藏'
};

test('未同步时给出登录与本地存储提示', () => {
  const view = getSyncStatusView(null, context);
  assert.equal(view.state, 'idle');
  assert.match(view.message, /已登录 MissAV/);
  assert.match(view.message, /当前浏览器/);
});

test('同步进行中保留双轮分页进度', () => {
  const view = getSyncStatusView({
    site: 'missav',
    pageType: 'favorites',
    state: 'running',
    progress: { round: 2, page: 17, total: 43 }
  }, context);
  assert.equal(view.state, 'running');
  assert.equal(view.meta, '第 2/2 轮 · 17/43 页');
});

test('同步完成后显示持久结果和时间', () => {
  const view = getSyncStatusView({
    site: 'missav',
    pageType: 'favorites',
    state: 'success',
    count: 120,
    message: '同步完成，本地已与官网 120 条收藏一致',
    completedAt: Date.UTC(2026, 7, 30, 4, 0)
  }, context);
  assert.equal(view.state, 'success');
  assert.match(view.message, /120/);
  assert.match(view.meta, /完成于/);
});

test('同步失败时明确旧数据未被删除', () => {
  const view = getSyncStatusView({
    site: 'missav',
    pageType: 'favorites',
    state: 'error',
    message: '第 29 页网络连接中断',
    completedAt: Date.UTC(2026, 7, 30, 4, 0)
  }, context);
  assert.equal(view.state, 'error');
  assert.match(view.meta, /原有本地数据已保留/);
  assert.match(view.meta, /可以稍后重试/);
});
