# 代码审查报告

> 生成时间：2026-03-30

## 总结

| 分类 | 问题数 | 建议 |
|------|--------|------|
| 逻辑冗余/bug | 3 | 高优先修复 |
| 架构改进 | 2 | 中优先改进 |
| 风格一致性 | 3 | 低优先处理 |

---

## 高优先级

### 1. `syncFavorites` 和 `saveVideos` 消息处理重复（`background.js`）

`syncFavorites` 的逻辑完全可以用 `saveVideos` 替代，两者都调用 `saveVideos()`，区别只是前者多了一次 `trackEvent`。content.js 发送 `syncFavorites`，但 `saveVideos` action 已存在且功能相同，建议统一为单一入口。

### 2. `importVideosToDB` 中的冗余三元表达式（`options.js:47`）

```js
// 当前代码
pageType: site === 'jable' ? 'favorites' : 'favorites'

// 建议修改为
pageType: 'favorites'
```

两个分支结果完全一样，属于无效代码。

### 3. `content.js` 中的全局可变状态

`totalPage`、`favVideoData`、`laterData` 是模块级可变变量，当页面上下文变化或多次触发时容易出现状态残留。`fetchAllFavoriteVideos` 里用 `dataArray.length = 0` 手动清空是绕过这个问题的补丁，建议改用局部变量。

---

## 中优先级

### 4. `showNotification` 在两个 content script 中各实现一遍

`content.js:353` 和 `content-missav.js:291` 各有一份几乎相同的函数，但样式不同：
- `content.js`：绿色背景（`#28a745`）
- `content-missav.js`：暗色玻璃风格（`rgba(17, 24, 39, 0.95)`）

MV3 content script 无法共享模块，建议至少统一视觉风格，保持用户体验一致。

### 5. `content.js` 的 fetch headers 硬编码了版本信息（第 44–67 行）

`sec-ch-ua-full-version: "141.0.7390.123"` 等字段写死了具体版本号，实际请求时浏览器会自动携带正确的值，这些头完全不需要手动设置，保留反而会造成版本不一致。建议移除所有 `sec-ch-ua-*` 相关 headers。

### 6. `normalizeJablePageType` 函数没有意义（`background.js:116`）

```js
function normalizeJablePageType(pageType = 'favorites') {
  return pageType === 'watchLater' ? 'watchLater' : 'favorites';
}
```

这个函数的唯一作用是把非 `'watchLater'` 的值归一化到 `'favorites'`，逻辑本身没问题，但可以直接内联为一行条件表达式，不必单独封装为函数。

---

## 低优先级（代码风格）

### 7. `popup.js` 中 `renderPageContext` 存在多处重复分支

多个 `if/else if` 分支重复设置 `syncNoteEl.textContent`，逻辑可以用数据映射表（对象或 Map）驱动，减少重复代码。

### 8. `options.js:47` 的冗余 `pageType`

已在第 2 条高优先级问题中说明。

### 9. 两个 content script 的通知样式不一致

用户在 Jable 和 MissAV 两个站点看到的同步通知外观不同，建议统一为暗色玻璃风格（与 options/popup 页面整体设计语言一致）。

---

## 最值得优先修复的两处

1. **删掉 `content.js` 中的硬编码 UA headers**（第 44–67 行）——有实际功能隐患。
2. **修复 `options.js:47` 的冗余三元表达式**——一行改动，消除无效代码。
