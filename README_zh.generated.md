# Jable 收藏管理器

一款 Chrome 扩展，用于管理和整理 Jable.tv 网站的视频收藏，提供增强的分类和搜索功能。

## 功能特性

- 导出 Jable.tv 收藏视频到 JSON 文件
- 导出"稍后观看"列表视频
- 按番号排序
- 多维度搜索（按番号、标题、分类、标签）
- 在视频页面显示是否已收藏状态
- 集成外部数据库查询（libredmm.com、javdatabase.com、javlibrary.com）

## 安装步骤

1. 克隆或下载本仓库
2. 打开 Chrome，访问 `chrome://extensions/`
3. 启用右上角的"开发者模式"
4. 点击"加载已解压的扩展程序"
5. 选择本项目文件夹

## 使用方法

1. 访问 Jable.tv 并登录账号
2. 进入收藏页面：`https://jable.tv/my/favourites/videos/`
3. 点击页面右上角的"获取收藏视频数据"按钮
4. 扩展程序会自动翻页获取所有收藏
5. 获取完成后自动下载 `favorite_videos.json` 文件

## 项目结构

```
├── manifest.json      # Chrome 扩展配置文件
├── content.js        # 收藏页面的内容脚本
├── background.js     # 后台 Service Worker
├── popup.html/js     # 扩展弹窗界面
├── options.html/js   # 扩展选项页面
├── style.css         # 弹窗样式
├── images/           # 扩展图标 (16px, 48px, 128px)
├── data.json         # 示例数据文件
└── test.html         # 测试页面
```

## 配置说明

### 主机权限

扩展需要以下网站权限：
- `https://jable.tv/*`

### 内容脚本匹配

内容脚本会在以下页面运行：
- `https://jable.tv/my/favourites/videos/*`

## 开发说明

修改扩展程序：

1. 编辑 `content.js` 修改页面交互逻辑
2. 编辑 `manifest.json` 更新权限或内容脚本匹配规则
3. 编辑 `background.js` 修改后台逻辑
4. 修改后在 `chrome://extensions/` 重新加载扩展

## 开源协议

MIT
