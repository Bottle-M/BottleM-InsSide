// 实例端的WebSocket路由
'use strict';

/**
 * 实例端WebSocket路由
 * @param {Object} recvObj 
 * @param {WebSocket} ws 
 */
module.exports = function (recvObj, ws) {
    let { act, data } = recvObj; // 获得操作和数据
    switch (act) {
        case 'status_sync': // 同步状态码

            break;
    }
}