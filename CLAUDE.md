# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

Jable Collect 是一个 Chrome 扩展（Manifest V3），用于从 jable.tv 抓取、整理和浏览收藏视频。数据存储采用 **IndexedDB** 实现本地持久化，支持收藏页和"稍后观看"两个来源的数据合并。

## 开发命令

此为 Chrome 扩展项目，无构建命令。直接：
1. 打开 Chrome → `chrome://extensions/`
2. 开启「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择项目目录

## 架构概览

### 数据流

```
Jable.tv → content.js → background.js → IndexedDB
                                     ↓
options.html ← background.js (读取)
```

### 核心模块

| 文件 | 职责 |
|------|------|
| `content.js` | 页面解析（AJAX 分页抓取）、自动翻页、与 background 通信 |
| `background.js` | IndexedDB 操作、消息路由（service worker） |
| `options.js` + `options.html` | 管理界面：筛选/排序/搜索/导入导出 |
| `popup.html` + `popup.js` | 快速操作弹窗（统计/同步入口） |

### IndexedDB Schema

- **数据库**: `jable_collect` (版本 2)
- **仓库**: `videos`
- **主键**: `url`
- **关键索引**: `videoId`、`order`、`pageType`

### 关键字段

| 字段 | 说明 |
|------|------|
| `url` | 主键，视频详情页 URL |
| `videoId` | 番号，从 URL 提取（如 `HEYZO-1234`） |
| `order` | 插入顺序，保持原始排序 |
| `inFavorites` | 是否来自收藏页 |
| `inWatchLater` | 是否来自稍后观看 |

### 双来源合并逻辑

同一视频可能同时出现在收藏页和稍后观看。系统通过 `inFavorites`/`inWatchLater` 两个布尔标记合并：
- 已存在视频：保留原有 `order`，合并来源标记
- 新视频：分配新 `order = max + 1`

### 消息类型（background.js）

| action | 来源 | 用途 |
|--------|------|------|
| `syncFavorites` | content.js | 保存抓取的收藏数据 |
| `getAllVideos` | options.js | 获取所有视频 |
| `deleteVideo` | options.js | 删除单条记录 |
| `clearAllVideos` | options.js | 清空数据库 |

## 已知限制

- 不支持增量同步（每次全量抓取）
- 预览视频需要额外请求
- content.js 仅注入在 `https://jable.tv/my/favourites/*`
