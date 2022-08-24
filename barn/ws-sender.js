// 储存WebSocket连接的模块
'use strict';
var webSocketStore = null;

/**
 * 储存主WebSocket连接
 * @param {WebSocket} ws WebSocket对象
 */
function set(ws) {
    webSocketStore = ws;
}

/**
 * 获得主WebSocket对象
 * @returns {WebSocket} WebSocket对象，获取失败、或者链接已经死亡则返回null
 */
function get() {
    let ws = webSocketStore;
    if (ws && ws.connAlive) {
        return ws;
    }
    return null;
}

/**
 * 通过主WebSocket发送数据
 * @param {Object} respObj 
 * @returns {Boolean} 是否成功发送
 */
function send(respObj) {
    let ws = get();
    if (ws) {
        ws.send(JSON.stringify(respObj));
        return true;
    }
    return false;
}

module.exports = {
    set,
    get,
    send
}