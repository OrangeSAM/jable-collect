# Jable Collect

**Chrome extension for managing Jable.tv + MissAV favorites** — one-click sync, local storage, powerful search.

> Free and open source. All data is stored locally in your browser. Nothing is sent to any server.

---

## Features

- **One-click sync** — Automatically paginates through Jable.tv favorites/watch-later lists and MissAV `/saved` pages
- **Local IndexedDB storage** — Data persists in your browser even after closing; no cloud required
- **Dual-site support** — Jable and MissAV data are stored in separate isolated stores
- **Smart deduplication** — Videos appearing in both \"Favorites\" and \"Watch Later\" are merged, not duplicated
- **Search by content ID** — Quickly find videos by ID (e.g. `CAWD-958`) or title keywords
- **Flexible sorting** — Original order / ID A→Z / ID Z→A
- **Source filtering** — View All / Favorites only / Watch Later only
- **Export / Import** — Back up and restore your collection as JSON
- **Popup dashboard** — Click the extension icon to see stats and trigger sync instantly

---



## Installation

This extension is not yet on the Chrome Web Store. Install manually:

1. **Download the source**
   - click [*link*](https://github.com/OrangeSAM/jable-collect/releases/tag/v1.0.0) **jable-collect-v1.0.0**，unzip to local


2. **Load the extension**
   - Open Chrome and go to `chrome://extensions/`
   - Enable **Developer mode** (toggle in the top right)
   - Click **Load unpacked**
   - Select the extracted project folder

3. **Done** — the extension icon appears in your toolbar ✓

## Screenshots

![alt text](images/jable-collect-popup.png)
![alt text](images/jable-collect.png)

---

---

## Usage

### Sync Jable.tv Favorites

1. Log in to your Jable.tv account
2. Navigate to your favorites: `https://jable.tv/my/favourites/`
3. Click the extension icon → **「Sync current page」**
4. The extension auto-paginates through all pages and shows a result when done

### Sync MissAV Favorites

1. Log in to your MissAV account
2. Navigate to your saved page: `https://missav.ws/saved`
3. Same as above — click **「Sync current page」**

### Browse Your Collection

- Click the extension icon → **「Open manager」**
- Search, sort, filter by source, delete entries, or export/import data

---

## Project Structure

```
├── manifest.json          # Extension config (Manifest V3)
├── background.js          # Service worker — IndexedDB read/write
├── content.js             # Jable.tv content script
├── content-missav.js      # MissAV content script
├── popup.html / popup.js  # Quick-action popup
└── options.html / options.js  # Full collection manager UI
```

---

## FAQ

**Q: The sync button is greyed out?**
A: Sync can only be triggered on supported pages: Jable.tv favorites/watch-later or MissAV `/saved`. Navigate to one of those first.

**Q: Is my data sent anywhere?**
A: No. All data lives in your browser's local IndexedDB. Nothing leaves your machine.

**Q: Does it work on Edge / Brave / Firefox?**
A: Built on Manifest V3, so it works on Chromium-based browsers (Chrome, Edge, Brave). Firefox has not been tested.

---

## License

MIT — free to use, modify, and distribute.

---

## Contributing & Feedback

Issues and PRs are welcome. If you find it useful, a ⭐ Star goes a long way!
