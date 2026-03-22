# Jable Collect Manager

A Chrome extension for managing and organizing video collections from Jable.tv with enhanced classification and search capabilities.

## Features

- Export Jable.tv favorite videos to JSON
- Export "Watch Later" videos
- Sort videos by content ID (番號)
- Multi-dimensional search (by content ID, title, category, tags)
- Display favorite status on video pages
- Integration with external databases (libredmm.com, javdatabase.com, javlibrary.com)

## Installation

1. Clone or download this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" (top right toggle)
4. Click "Load unpacked"
5. Select the project folder

## Usage

1. Navigate to Jable.tv and log in to your account
2. Go to your favorites page: `https://jable.tv/my/favourites/videos/`
3. Click the "获取收藏视频数据" button in the top-right corner
4. The extension will automatically paginate through all favorites
5. Data will be exported to `favorite_videos.json` when complete

## Project Structure

```
├── manifest.json      # Chrome extension configuration
├── content.js        # Content script for favorites page
├── background.js     # Service worker for background tasks
├── popup.html/js     # Extension popup UI
├── options.html/js   # Extension options page
├── style.css         # Popup styles
├── images/           # Extension icons (16px, 48px, 128px)
├── data.json         # Sample data file
└── test.html         # Test page
```

## Configuration

### Host Permissions

The extension requires permission to access:
- `https://jable.tv/*`

### Content Script Matching

Content scripts run on:
- `https://jable.tv/my/favourites/videos/*`

## Development

To modify this extension:

1. Edit `content.js` for page interaction logic
2. Edit `manifest.json` to update permissions or content script matches
3. Edit `background.js` for service worker logic
4. Reload the extension in `chrome://extensions/` after changes

## Architecture

See [ARCHITECTURE.md](./ARCHITECTURE.md) for detailed technical documentation including storage implementation, data flow, and dual-source merge mechanism.

## License

MIT
