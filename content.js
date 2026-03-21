// 先获取总共有多少页，页数需要作为接口的参数
let totalPage = 0;
function getTotalPage() {
  const allPageLinks = document.querySelectorAll('a.page-link[data-parameters*="from_my_fav_videos"]');
  const lastPageLink = Array.from(allPageLinks).find(link => link.textContent.includes('最後'));

  if (lastPageLink) {
    const dataParameters = lastPageLink.getAttribute('data-parameters');
    console.log('data-parameters:', dataParameters);

    let match = dataParameters.match(/from_my_fav_videos:(\d+)/);
    if (match) {
      totalPage = parseInt(match[1]);
      console.log('提取到的数字:', totalPage);
    }
  }
}

// jable 影片收藏
let favVideoData = [];
function getJableFavVideo(page) {
  return fetch("https://jable.tv/my/favourites/videos/?mode=async&function=get_block&block_id=list_videos_my_favourite_videos&fav_type=0&playlist_id=0&sort_by=&from_my_fav_videos=" + page + "&_=" + Date.now(), {
    "headers": {
      "accept": "*/*",
      "accept-language": "zh-CN,zh;q=0.9,zh-TW;q=0.8",
      "cache-control": "no-cache",
      "pragma": "no-cache",
      "priority": "u=1, i",
      "sec-ch-ua": "\"Google Chrome\";v=\"141\", \"Not?A_Brand\";v=\"8\", \"Chromium\";v=\"141\"",
      "sec-ch-ua-arch": "\"x86\"",
      "sec-ch-ua-bitness": "\"64\"",
      "sec-ch-ua-full-version": "\"141.0.7390.123\"",
      "sec-ch-ua-full-version-list": "\"Google Chrome\";v=\"141.0.7390.123\", \"Not?A_Brand\";v=\"8.0.0.0\", \"Chromium\";v=\"141.0.7390.123\"",
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-model": "\"\"",
      "sec-ch-ua-platform": "\"Windows\"",
      "sec-ch-ua-platform-version": "\"19.0.0\"",
      "sec-fetch-dest": "empty",
      "sec-fetch-mode": "cors",
      "sec-fetch-site": "same-origin",
      "x-requested-with": "XMLHttpRequest"
    },
    "referrer": "https://jable.tv/my/favourites/videos/",
    "body": null,
    "method": "GET",
    "mode": "cors",
    "credentials": "include"
  })
    .then(response => {
      return response.text();
    })
    .then(html => {
      const data = parseJableDomData(html);
      favVideoData.push(...data);
      console.log(`第${page}页收藏数据获取完成，共${data.length}条`);
    })
    .catch(error => {
      console.error('Main fetch failed:', error);
    });
}

// jable 稍后观看
let laterData = [];
function getJableWatchLater(page) {
  return fetch("https://jable.tv/my/favourites/videos-watch-later/?mode=async&function=get_block&block_id=list_videos_my_favourite_videos&fav_type=1&playlist_id=0&sort_by=&from_my_fav_videos=26&page=" + page + "&_=" + Date.now(), {
    "headers": {
      "accept": "*/*",
      "accept-language": "zh-CN,zh;q=0.9",
      "x-requested-with": "XMLHttpRequest"
    },
    "method": "GET",
    "credentials": "include"
  })
    .then(response => {
      return response.text();
    })
    .then(html => {
      const data = parseJableDomData(html);
      laterData.push(...data);
      console.log(`第${page}页稍后观看数据获取完成，共${data.length}条`);
    })
    .catch(error => {
      console.error('Main fetch failed:', error);
    });
}

// 解析 DOM 数据
function parseJableDomData(html) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const videoImgBoxes = doc.querySelectorAll('.video-img-box');
  const data = [];
  videoImgBoxes.forEach(box => {
    const img = box.querySelector('img');
    const detail = box.querySelector('.detail');
    const video = {
      imgSrc: img.src,
      imgDataSrc: img.dataset.src,
      preview: img.dataset.preview,
      detailTitle: detail.querySelector('.title').textContent,
      detailHref: detail.querySelector('.title a').href,
      url: detail.querySelector('.title a').href,
      from: 'jable'
    };
    video.videoId = extractVideoId(video.detailHref);
    data.push(video);
  });
  return data;
}

// 从 URL 提取番号
function extractVideoId(url) {
  const match = url.match(/\/videos\/([^\/]+)\/?$/i);
  return match ? match[1].toUpperCase() : null;
}

// ========== 与 background.js 通信 ==========

// 发送消息到 background.js
function sendToBackground(action, data = {}) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ action, ...data }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(response);
      }
    });
  });
}

// 保存视频到 IndexedDB（通过 background.js）
async function saveVideosToDB(videos) {
  const response = await sendToBackground('syncFavorites', { videos });
  if (!response.success) {
    throw new Error(response.error);
  }
  return response.count;
}

// 开始执行
console.log('已初始化收藏插件');
getTotalPage();
console.log(`总共有${totalPage}页收藏数据`);

// 创建按钮
function createFetchButton() {
  const button = document.createElement('button');
  button.textContent = '获取收藏视频数据';
  button.id = 'fetch-fav-videos-btn';

  button.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    z-index: 9999;
    padding: 10px 15px;
    background-color: #007bff;
    color: white;
    border: none;
    border-radius: 5px;
    cursor: pointer;
    font-size: 14px;
    box-shadow: 0 2px 5px rgba(0,0,0,0.2);
  `;

  button.addEventListener('mouseenter', () => {
    button.style.backgroundColor = '#0056b3';
  });

  button.addEventListener('mouseleave', () => {
    button.style.backgroundColor = '#007bff';
  });

  button.addEventListener('click', handleFetchClick);
  document.body.appendChild(button);

  return button;
}

// 处理按钮点击
async function handleFetchClick() {
  const button = document.getElementById('fetch-fav-videos-btn');

  button.disabled = true;
  button.textContent = '获取中...';
  button.style.backgroundColor = '#6c757d';

  try {
    await fetchAllFavoriteVideos();

    button.textContent = '获取完成 ✓';
    button.style.backgroundColor = '#28a745';

    setTimeout(() => {
      button.disabled = false;
      button.textContent = '获取收藏视频数据';
      button.style.backgroundColor = '#007bff';
    }, 3000);

  } catch (error) {
    console.error('获取失败:', error);

    button.textContent = '获取失败 ✗';
    button.style.backgroundColor = '#dc3545';

    setTimeout(() => {
      button.disabled = false;
      button.textContent = '获取收藏视频数据';
      button.style.backgroundColor = '#007bff';
    }, 3000);
  }
}

// 主要的获取数据函数
async function fetchAllFavoriteVideos() {
  const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  try {
    favVideoData = []; // 清空旧数据

    // 分页获取数据
    for (let i = 1; i <= totalPage; i++) {
      console.log(`📥 正在获取第 ${i}/${totalPage} 页数据...`);

      const button = document.getElementById('fetch-fav-videos-btn');
      button.textContent = `获取中... (${i}/${totalPage})`;

      await getJableFavVideo(i);
      console.log(`✅ 第 ${i} 页数据获取成功`);

      if (i < totalPage) {
        console.log(`⏳ 等待 1 秒后继续...`);
        await delay(1000);
      }
    }

    // 通过 background.js 保存到 IndexedDB
    await saveVideosToDB(favVideoData);

    console.log(`🎉 所有数据获取完成！共 ${favVideoData.length} 条已保存到数据库`);
    showNotification(`已保存 ${favVideoData.length} 条收藏到本地数据库`);

  } catch (error) {
    console.error('获取收藏视频失败:', error);
    throw error;
  }
}

// 显示通知
function showNotification(message) {
  const notification = document.createElement('div');
  notification.textContent = message;
  notification.style.cssText = `
    position: fixed;
    top: 80px;
    right: 20px;
    z-index: 10000;
    padding: 15px 20px;
    background-color: #28a745;
    color: white;
    border-radius: 5px;
    box-shadow: 0 2px 10px rgba(0,0,0,0.2);
    font-size: 14px;
  `;
  document.body.appendChild(notification);

  setTimeout(() => {
    notification.remove();
  }, 3000);
}

// 页面加载完成后创建按钮
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', createFetchButton);
} else {
  createFetchButton();
}
