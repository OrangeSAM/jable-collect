# Jable Collect 技术架构文档

> 更新时间：2026-03-30

## 概述

Jable Collect 是一个 Chrome MV3 扩展，支持从 Jable.tv 和 MissAV.ws 抓取、整理和浏览收藏视频。数据存储采用 **IndexedDB** 实现本地持久化，支持收藏页和"稍后观看"两个来源的数据合并。

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

---

## 整体模块调用关系

```
┌─────────────────────────────────────────────────────────────┐
│                        用户浏览器                             │
│                                                             │
│  ┌───────────────┐        ┌───────────────────────────────┐ │
│  │  popup.html   │        │       目标网站页面              │ │
│  │  popup.js     │        │  content.js    (jable.tv)     │ │
│  │  PopupManager │        │  content-missav.js (missav.ws)│ │
│  └──────┬────────┘        └──────────────┬────────────────┘ │
│         │ chrome.tabs.sendMessage        │                  │
│         │◄──────────────────────────────►│                  │
│         │       chrome.runtime.sendMessage                  │
│         ├────────────────────────────────────────────────►  │
│         │                                │                  │
│  ┌──────▼────────────────────────────────▼──────────────┐   │
│  │                   background.js                      │   │
│  │  - 消息路由（onMessage handler）                       │   │
│  │  - IndexedDB 读写（saveVideos / getAllVideos 等）      │   │
│  │  - Amplitude 统计事件上报                              │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐   │
│  │           options.html / options.js                  │   │
│  │           OptionsManager（数据管理页）                 │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

---

## 核心调用流程

### 流程一：用户从 Popup 触发同步

```
用户点击扩展图标
  └── PopupManager.init()
        ├── getActiveTab()             // 获取当前标签页
        ├── sendToBackground('getVideoStats')  // 查询数据库统计数字
        └── renderPageContext(url)     // 根据 URL 判断页面类型
              ├── jable.tv/my/favourites/videos-watch-later → 稍后观看
              ├── jable.tv/my/favourites/videos            → 收藏
              ├── missav.ws/*/saved                        → MissAV 收藏
              └── 其他 → 显示「不在可同步页面」提示

用户点击「同步」按钮
  └── PopupManager.handleSync()
        └── chrome.tabs.sendMessage(tabId, { action: 'triggerSyncFromPopup', pageType })
                  │
                  ▼
            content.js / content-missav.js
            chrome.runtime.onMessage 监听
                  └── fetchAllFavoriteVideos(pageType)
```

### 流程二：Jable content.js 抓取数据

```
fetchAllFavoriteVideos(pageType)
  ├── getTotalPage()                  // 解析 DOM 获取总页数
  │     ├── 优先：data-parameters 属性中的页码
  │     ├── 次选：href ?page=N 参数
  │     └── fallback：页码链接最大数字
  │
  └── 循环 page = 1 → totalPage
        ├── favorites   → getJableFavVideo(page)
        │     └── fetch('/my/favourites/videos/?mode=async&...')
        │           → parseJableDomData(html)  // 解析 .col-6 卡片
        └── watchLater → getJableLaterVideo(page)
              └── fetch('/my/favourites/videos-watch-later/?page=N')
                    → parseJableDomData(html)

  每条视频结构:
  { url, videoId, title, coverUrl, previewUrl, order, pageType }

  全部页面完成后:
  └── chrome.runtime.sendMessage({ action: 'syncFavorites', videos, pageType, site: 'jable' })
```

### 流程三：MissAV content-missav.js 抓取数据

```
fetchAllMissavFavorites()
  ├── getTotalPage()                  // 解析 <a href> 中 ?page=N，取最大值
  └── 循环 page = 1 → totalPage
        └── fetch(getCurrentSavedUrl(page))  // 当前路径 + ?page=N
              → parseMissavDomData(html)     // 解析 .thumbnail.group 卡片

  全部页面完成后:
  └── chrome.runtime.sendMessage({ action: 'syncFavorites', videos, pageType: 'favorites', site: 'missav' })
```

### 流程四：background.js 消息路由

| action | 调用函数 | 说明 |
|--------|----------|------|
| `getVideoStats` | `getVideoStats(site)` | 返回总数、收藏数、稍后观看数、最后同步时间 |
| `getAllVideos` | `getAllVideos(site)` | 返回该站点全部视频 |
| `saveVideos` | `saveVideos(videos, pageType, site)` | 批量写入/更新 IndexedDB |
| `syncFavorites` | `saveVideos(...)` + `trackEvent(...)` | content script 专用，额外上报统计 |
| `deleteVideo` | `deleteVideo(url, site)` | 删除单条记录 |
| `clearAllVideos` | `clearAllVideos(site)` | 清空整个 store |
| `trackEvent` | `trackEvent(eventName, props)` | 上报 Amplitude 事件 |

**saveVideos 合并逻辑：**
```
1. 读取现有记录，构建 url → record 的 Map
2. 遍历待保存视频：
   - url 已存在 → 保留原 order，合并 inFavorites / inWatchLater 标记
   - url 不存在 → 分配新 order（递增），初始化标记为 false
   - 根据本次 pageType 将对应标记置为 true
3. 批量 put 写入 IndexedDB
```

### 流程五：Options 页数据管理

```
DOMContentLoaded
  └── new OptionsManager()
        └── init()
              ├── loadVideos()    // sendToBackground('getAllVideos') 取全量
              ├── refresh()       // filter → sort → renderVideoList()
              └── bindEvents()    // 绑定所有 UI 交互

用户操作:
  搜索框输入  → setSearch()   → refresh()
  来源切换    → setSource()   → refresh()
  排序切换    → setSort()     → refresh()
  分页切换    → setPage()     → renderVideoList() + updatePagination()
  每页条数    → setPageSize() → renderVideoList() + updatePagination()
  删除视频    → sendToBackground('deleteVideo')    → loadVideos()
  导出数据    → JSON.stringify → Blob 下载
  导入数据    → sendToBackground('saveVideos')     → loadVideos()
  清空数据    → sendToBackground('clearAllVideos') → loadVideos()
```

---

## 数据库结构（IndexedDB）

数据库名：`jable_collect`，版本：3

### Jable store（`videos`）

| 字段 | 类型 | 说明 |
|------|------|------|
| `url` | string (keyPath) | 视频页 URL，唯一主键 |
| `videoId` | string | 番号，如 `IPX-123` |
| `title` | string | 视频标题 |
| `coverUrl` | string | 封面图地址 |
| `previewUrl` | string | 预览动图地址 |
| `order` | number | 原始排序号 |
| `pageType` | string | `favorites` 或 `watchLater` |
| `inFavorites` | boolean | 是否在收藏列表 |
| `inWatchLater` | boolean | 是否在稍后观看列表 |
| `syncedAt` | number | 最后同步时间戳 |

### MissAV store（`missav_videos`）

| 字段 | 类型 | 说明 |
|------|------|------|
| `url` | string (keyPath) | 视频页 URL，唯一主键 |
| `videoId` | string | 番号 |
| `title` | string | 视频标题 |
| `detailTitle` | string | 详情页标题（更完整） |
| `coverUrl` | string | 封面图地址 |
| `previewUrl` | string | 预览动图地址 |
| `order` | number | 原始排序号 |
| `pageType` | string | 固定为 `favorites` |
| `syncedAt` | number | 最后同步时间戳 |

---

## 统计事件（Amplitude）

| 事件名 | 触发时机 | 主要属性 |
|--------|----------|----------|
| `sync_completed` | background 处理 syncFavorites 后 | `site`, `synced_count`, `total_count` |
| `data_exported` | options 页导出 | `site`, `count` |
| `data_imported` | options 页导入 | `site`, `count` |

设备 ID 首次使用时通过 `crypto.randomUUID()` 生成，持久化存储在 `chrome.storage.local`。

---

## 消息通信总览

```
popup.js
  ├── chrome.runtime.sendMessage → background.js  (getVideoStats)
  └── chrome.tabs.sendMessage    → content script (triggerSyncFromPopup)

content.js / content-missav.js
  └── chrome.runtime.sendMessage → background.js  (syncFavorites)

options.js
  └── chrome.runtime.sendMessage → background.js  (getAllVideos / saveVideos /
                                                    deleteVideo / clearAllVideos /
                                                    trackEvent)
```
