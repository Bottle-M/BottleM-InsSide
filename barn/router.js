// 实例端的WebSocket路由
'use strict';
const status = require('./status-handler');
const rcon = require('./rcon');

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
        case 'status_sync': { // 同步状态码
            let statusCode = status.getVal('status_code');
            respObj['status_code'] = statusCode;
            if (statusCode === 2500) {
                // 状态码为2500，说明实例端已经停止运行，直接say goodbye
                ws.close(1001, 'Goodbye');
            }
        }
            break;
        case 'command': { // 向Minecraft服务器发送命令
            let { command } = data;
            rcon.send(command); // 通过RCON发送命令
        }
            break;
    }
    ws.send(JSON.stringify(respObj)); // 发送响应
}