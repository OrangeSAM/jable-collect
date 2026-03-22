# Jable Collect 技术架构文档

## 概述

Jable Collect 是一个 Chrome 扩展，用于从 Jable.tv 抓取、整理和浏览收藏视频。数据存储采用 **IndexedDB** 实现本地持久化，支持收藏页和"稍后观看"两个来源的数据合并。

---

## 存储架构

### 技术选型

| 方案 | 优点 | 缺点 |
|------|------|------|
| LocalStorage | 简单，无需适配器 | 容量小（~5MB），不支持复杂查询 |
| IndexedDB | 容量大，支持索引和事务 | API 较复杂 |
| JSON 文件导出 | 便携，易于备份 | 无法增量同步，不支持筛选 |

当前采用 **IndexedDB** 作为主存储，JSON 导入/导出作为辅助功能。

### 数据库 schema

```
数据库名: jable_collect
版本: 2
仓库: videos
主键: url (视频详情页 URL)
```

**字段定义：**

| 字段 | 类型 | 说明 |
|------|------|------|
| `url` | string | 主键，视频详情页 URL |
| `videoId` | string | 番号（如 `HEYZO-1234`），从 URL 提取 |
| `detailTitle` | string | 视频标题 |
| `imgSrc` / `imgDataSrc` | string | 视频封面图 |
| `preview` | string | 预览视频 URL（可选） |
| `order` | number | 插入顺序，用于保持原始排序 |
| `addedTime` | number | 添加到数据库的时间戳 |
| `inFavorites` | boolean | 是否来自收藏页 |
| `inWatchLater` | boolean | 是否来自"稍后观看" |
| `pageType` | string | 本次抓取来源（向后兼容字段） |

**索引：**

| 索引名 | 字段 | 用途 |
|--------|------|------|
| `videoId` | `videoId` | 按番号查询 |
| `title` | `title` | 按标题搜索 |
| `order` | `order` | 按插入顺序排序 |
| `pageType` | `pageType` | 按来源类型筛选 |

---

## 核心机制

### 双来源合并

同一视频可能同时出现在"收藏页"和"稍后观看"中。系统通过 `inFavorites` 和 `inWatchLater` 两个布尔标记实现**来源合并**，而非覆盖。

**保存逻辑（`background.js:saveVideos`）：**

```
1. 读取现有记录，构建 url -> record 的 Map
2. 遍历待保存的视频：
   - 如果 url 已存在：
     - 保留原有的 order（维持首次插入的顺序）
     - 合并 inFavorites / inWatchLater 标记
   - 如果 url 不存在：
     - 分配新的 order（递增）
     - 初始化 inFavorites / inWatchLater 为 false
   - 根据本次抓取类型（favorites / watchLater）设置对应标记为 true
3. 写入 IndexedDB
```

**显示逻辑（`options.js:getSourceInfo`）：**

| `inFavorites` | `inWatchLater` | 显示 |
|---------------|----------------|------|
| true | true | **双来源** |
| false | true | 稍后观看 |
| true | false | 收藏 |

### 顺序保持

`order` 字段确保视频按首次抓取顺序排列，不受后续同步影响：

- 新视频：`order = maxExistingOrder + 1`
- 已存在视频：保留原有 `order` 不变

排序时按 `order` 字段升序排列。

---

## 数据流

```
┌─────────────────┐      ┌─────────────────┐      ┌─────────────────┐
│   Jable.tv      │      │  content.js    │      │  background.js  │
│  (用户浏览)      │─────▶│  (页面抓取)      │─────▶│  (IndexedDB)    │
└─────────────────┘      └─────────────────┘      └─────────────────┘
                                                           │
                                                           ▼
                         ┌─────────────────┐      ┌─────────────────┐
                         │  options.html   │◀─────│  存储/读取      │
                         │  (管理界面)      │      │                 │
                         └─────────────────┘      └─────────────────┘
```

### 抓取流程（content.js → background.js）

1. 用户点击"获取收藏视频数据"按钮
2. `content.js` 解析当前页面的视频列表
3. 通过 `chrome.runtime.sendMessage` 发送 `syncFavorites` 消息
4. `background.js` 的 `handleMessage` 接收，调用 `saveVideos()`
5. 数据合并后写入 IndexedDB
6. 自动翻页，重复直到所有页面抓取完成

### 管理流程（options.js ↔ background.js）

1. 选项页加载时调用 `getAllVideosFromDB()`
2. `background.js` 从 IndexedDB 读取所有记录
3. 返回给选项页进行筛选、排序、分页展示
4. 用户可执行：删除、导出、导入、清空操作

---

## 模块职责

| 文件 | 职责 |
|------|------|
| `content.js` | 页面解析、自动翻页、与 background 通信 |
| `background.js` | IndexedDB 操作、消息路由、跨上下文通信 |
| `options.js` | 选项页 UI、筛选/排序/搜索逻辑 |
| `popup.html/js` | 快速操作弹窗 |

---

## 导入/导出

- **导出**：将 IndexedDB 全部数据序列化为 JSON 文件下载
- **导入**：读取 JSON 文件，逐一 `put` 入 IndexedDB（自动触发合并逻辑）

导入时相同 `url` 的记录会合并来源标记，不会覆盖已有数据。

---

## 已知限制

1. 不支持多标签演员/分类筛选（TODO 中）
2. 不支持增量同步（每次全量抓取）
3. 预览视频需要额外请求封面图处的预览视频 URL
