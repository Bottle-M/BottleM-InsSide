// 实例端的WebSocket路由
'use strict';
const status = require('./status-handler');

/**
 * 实例端WebSocket路由
 * @param {Object} recvObj 
 * @param {WebSocket} ws 
 */
module.exports = function (recvObj, ws) {
    let { action, data } = recvObj, // 获得操作和数据
        respObj = {
            action: action // 继续呼应的动作
        }; // 返回的对象
    switch (action) {
        case 'status_sync': // 同步状态码
            respObj['status_code'] = status.getVal('status_code');
            break;
    }
    ws.send(JSON.stringify(respObj)); // 发送响应
}