// // 弹出窗口的JavaScript代码
// document.addEventListener('DOMContentLoaded', function() {
//   console.log('Popup DOM loaded');
// });

// document.addEventListener('DOMContentLoaded', function() {
//   const responsesDiv = document.getElementById('responses');
//   const refreshBtn = document.getElementById('refresh');
//   const clearBtn = document.getElementById('clear');
  
//   function loadResponses() {
//     chrome.runtime.sendMessage({type: 'GET_INTERCEPTED_DATA'}, (data) => {
//       responsesDiv.innerHTML = '';
      
//       if (data && data.length > 0) {
//         data.reverse().forEach(item => {
//           const div = document.createElement('div');
//           div.className = 'response-item';
          
//           let displayData = item.data;
//           try {
//             // 尝试格式化JSON
//             const parsed = JSON.parse(item.data);
//             displayData = JSON.stringify(parsed, null, 2);
//           } catch (e) {
//             // 如果不是JSON，保持原样
//           }
          
//           div.innerHTML = `
//             <div class="url">${item.url}</div>
//             <div class="status">状态: ${item.status} ${item.statusText}</div>
//             <div class="timestamp">时间: ${new Date(item.timestamp).toLocaleString()}</div>
//             <div class="data">${displayData}</div>
//           `;
          
//           responsesDiv.appendChild(div);
//         });
//       } else {
//         responsesDiv.innerHTML = '<p>暂无拦截到的API响应</p>';
//       }
//     });
//   }
  
//   refreshBtn.addEventListener('click', loadResponses);
//   clearBtn.addEventListener('click', function() {
//     chrome.runtime.sendMessage({type: 'CLEAR_DATA'});
//     responsesDiv.innerHTML = '<p>数据已清空</p>';
//   });
  
//   // 初始加载
//   loadResponses();
// });