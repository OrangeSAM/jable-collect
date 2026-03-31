# 代码审查报告 2026-03-31

## 高优先级 Bug

### 1. 同步不会清理"本地已删、远端仍在"的记录

- 位置：`content.js:323`, `background.js:210`
- 原因：同步是 merge 语义，不是对账语义。本地删除的记录下次同步会被重新写回。
- 影响：用户觉得"删了又回来"。
- 建议：明确同步语义——增量并集 or 以远端为准对账。

### 2. 远程删除成功后 Options 页连续两次渲染

- 位置：`options.js:427-438`
- 原因：`loadVideos()` 本身触发渲染，`finally` 又调 `renderVideoList()`。
- 影响：删除按钮状态闪烁。
- 建议：成功后只保留一次渲染路径。

### 3. Popup 域名判断过于严格

- 位置：`popup.js:70`, `popup.js:106`
- 原因：硬编码 `jable.tv` / `missav.ws`，不兼容子域名/镜像域名。
- 影响：站点换域名后功能失效。
- 建议：域名白名单可配置。

### 4. `parseJableDomData()` 无空值保护（最值得优先修）

- 位置：`content.js:109-130`
- 原因：直接假定 `.video-img-box` 内 `img`、`.detail .title a` 一定存在。某个卡片结构异常时会抛错。
- 影响：一个异常卡片可能导致整页解析中断。
- 建议：对每个节点做空值检查，跳过异常卡片。

### 5. MissAV 保存未做 URL 归一化

- 位置：`background.js:284`
- 原因：MissAV 以 `url` 为 key 但未归一化（尾 `/`、query、编码差异）。
- 影响：同一视频可能因 URL 形式不同被存为两条。
- 建议：增加 `normalizeMissavUrl()`。

## 中优先级 Bug / 设计风险

### 6. `getTotalPage()` 分页识别有误判风险

- 位置：`content.js:3`, `content-missav.js:18`
- 原因：靠页面分页链接猜总页数，fallback 取最大数字比较脆。
- 影响：少抓页或多请求空页。

### 7. 远程删除依赖 DOM 推断 numeric `video_id`

- 位置：`content-jable-detail.js:450`
- 原因：从 `data-video-id`、hidden input、资源 URL 多路径推断，站点改版即失效。
- 影响：Options 页的官网删除功能可能突然不能用。

### 8. `trackEvent()` 完全吞错

- 位置：`background.js:12`
- 原因：Amplitude 请求失败后空 catch。
- 影响：埋点失效时无法排查。

## 性能问题

### 1. `saveJableVideos()` 每次全表 `getAll()` — 最大瓶颈

- 位置：`background.js:212`
- 原因：先把整个 store 读出来构造 existingMap，数据量大时越来越慢。
- 建议：按 URL 批量查已有记录，或分离 max/min order 查询。

### 2. `getVideoStats()` 全量读取再遍历统计

- 位置：`background.js:413`
- 原因：popup 打开/状态变更都触发全表扫描。
- 建议：中期用 IndexedDB index/count 分别统计或缓存。

### 3. Options 页搜索/排序/分页全量前端处理

- 位置：`options.js:152-198`
- 原因：全量加载 → filter → sort → innerHTML 重建。
- 建议：搜索加 debounce；数据量大时下沉到 IndexedDB 查询层。

### 4. 同步串行 + 固定 3 秒等待

- 位置：`content.js:324`, `content-missav.js:271`
- 原因：每页固定 sleep 3s，页数多时极慢。
- 建议：缩短等待或改为可配置间隔。

### 5. 视频卡片事件绑定未用委托

- 位置：`options.js:348-375`
- 原因：每次渲染给每个 card/button 单独绑 listener。
- 建议：事件委托绑在 `videoListEl` 上。

## 根本设计问题

- **表结构**：`videoId` 定义不明确（番号 vs 网站 numeric id），字段重复（`url` / `detailHref`、`imgSrc` / `imgDataSrc`）。
- **DOM 依赖**：解析和远程删除强依赖页面结构，抗站点改版能力不足。
- **同步语义**：merge vs 对账未明确，导致删除行为和用户预期不一致。
