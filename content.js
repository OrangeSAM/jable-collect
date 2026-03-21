// 先获取总共有多少页，页数需要作为接口的参数
let totalPage = 0;
function getTotalPage() {
  const allPageLinks = document.querySelectorAll('a.page-link[data-parameters*="from_my_fav_videos"]');
  const lastPageLink = Array.from(allPageLinks).find(link => link.textContent.includes('最後'));


  if (lastPageLink) {
    const dataParameters = lastPageLink.getAttribute('data-parameters');
    console.log('data-parameters:', dataParameters); // "fav_type:0;playlist_id:0;sort_by:;from_my_fav_videos:144"

    // 提取144
    let match = dataParameters.match(/from_my_fav_videos:(\d+)/);
    if (match) {
      totalPage = parseInt(match[1]);
      console.log('提取到的数字:', totalPage);
    }
  }
}


// jable 影片收藏
let favVideoData = [] // 影片收藏数据
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
      const data = parseJabDomData(html);
      favVideoData.push(...data);
      console.log(`第${page}页收藏数据获取完成，共${data.length}条`);
    })
    .catch(error => {
      console.error('Main fetch failed:', error);
    });
}

// jable 稍后观看
let laterData = [] // 稍后观看数据
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


// 实现一个函数，获取dom结构中的数据信息，其中video-img-box 可能会渲染多个，
// 需要获取的数据包括：img src data-src,detail title, a href
function parseJableDomData(html) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const videoImgBoxes = doc.querySelectorAll('.video-img-box');
  const data = [];
  videoImgBoxes.forEach(box => {
    const img = box.querySelector('img');
    const detail = box.querySelector('.detail');
    data.push({
      imgSrc: img.src,
      imgDataSrc: img.dataset.src,
      preview: img.dataset.preview,
      detailTitle: detail.querySelector('.title').textContent,
      detailHref: detail.querySelector('.title a').href,
      from: 'jable'
    });
  });
  return data;
}

// 开始执行
console.log('已初始化收藏插件');
getTotalPage();
console.log(`总共有${totalPage}页收藏数据`);
// // 稍后观看数据分页获取
// (async () => {
//   const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

//   for (let i = 1; i <= 5 ; i++) {
//     await getJableFavVideo(i);
//     await delay(5000);
//   }
// })();

// 创建按钮的函数
function createFetchButton() {
  // 创建按钮元素
  const button = document.createElement('button');
  button.textContent = '获取收藏视频数据';
  button.id = 'fetch-fav-videos-btn';

  // 设置按钮样式
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

  // 悬停效果
  button.addEventListener('mouseenter', () => {
    button.style.backgroundColor = '#0056b3';
  });

  button.addEventListener('mouseleave', () => {
    button.style.backgroundColor = '#007bff';
  });

  // 点击事件
  button.addEventListener('click', handleFetchClick);

  // 添加到页面
  document.body.appendChild(button);

  return button;
}

// 处理按钮点击的函数
async function handleFetchClick() {
  const button = document.getElementById('fetch-fav-videos-btn');

  // 禁用按钮，防止重复点击
  button.disabled = true;
  button.textContent = '获取中...';
  button.style.backgroundColor = '#6c757d';

  try {
    await fetchAllFavoriteVideos();

    // 成功后更新按钮状态
    button.textContent = '获取完成 ✓';
    button.style.backgroundColor = '#28a745';

    // 3秒后恢复按钮
    setTimeout(() => {
      button.disabled = false;
      button.textContent = '获取收藏视频数据';
      button.style.backgroundColor = '#007bff';
    }, 3000);

  } catch (error) {
    console.error('获取失败:', error);

    // 失败后更新按钮状态
    button.textContent = '获取失败 ✗';
    button.style.backgroundColor = '#dc3545';

    // 3秒后恢复按钮
    setTimeout(() => {
      button.disabled = false;
      button.textContent = '获取收藏视频数据';
      button.style.backgroundColor = '#007bff';
    }, 3000);
  }
}

function exportToJSON(data, filename = 'favorite_videos.json') {
  try {
    // 将数据转换为JSON字符串
    const jsonString = JSON.stringify(data, null, 2);
    
    // 创建Blob对象
    const blob = new Blob([jsonString], { type: 'application/json' });
    
    // 创建下载链接
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    
    // 触发下载
    document.body.appendChild(link);
    link.click();
    
    // 清理
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    
    console.log(`✅ 数据已导出到 ${filename}`);
    return true;
    
  } catch (error) {
    console.error('导出JSON失败:', error);
    return false;
  }
}

// 主要的获取数据函数
async function fetchAllFavoriteVideos() {
  const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  try {
    // 分页获取数据
    for (let i = 1; i <= totalPage; i++) {
      console.log(`📥 正在获取第 ${i}/${totalPage} 页数据...`);

      // 更新按钮文本显示进度
      const button = document.getElementById('fetch-fav-videos-btn');
      button.textContent = `获取中... (${i}/${totalPage})`;

      await getJableFavVideo(i);
      console.log(`✅ 第 ${i} 页数据获取成功`);

      // 最后一页不需要延迟
      if (i < totalPage) {
        console.log(`⏳ 等待 5 秒后继续...`);
        await delay(5000);
      }
    }

    // 导出数据到JSON文件
    exportToJSON(favVideoData);

    console.log('🎉 所有数据获取完成！', favVideoData.length, '条数据', favVideoData);

  } catch (error) {
    console.error('获取收藏视频失败:', error);
    throw error; // 重新抛出错误，让handleFetchClick处理
  }
}

// 页面加载完成后创建按钮
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', createFetchButton);
} else {
  createFetchButton();
}
