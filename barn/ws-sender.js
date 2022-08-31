// 储存WebSocket连接的模块
'use strict';
var mainConnection = null;
var dataSending = false; // 是否正在发送数据

/**
 * 储存主WebSocket连接
 * @param {WebSocket} ws WebSocket对象
 */
function set(ws) {
    mainConnection = ws;
}

/**
 * 获得主WebSocket对象
 * @returns {WebSocket} WebSocket对象，获取失败、或者链接已经死亡则返回null
 */
function get() {
    let ws = mainConnection;
    if (ws && ws.connAlive && ws.authorized) {
        return ws;
    }
    return null;
}


/**
 * 通过主WebSocket发送数据，如果未发送成功会伺机重新发送
 * @param {Object} respObj 
 * @note Websocket.send不能连续调用！之前因为这里内存溢出，排查了半天！
 * @note https://github.com/websockets/ws/issues/999#issuecomment-279233272
 */
function send(respObj) {
    let timer = setInterval(() => {
        let ws = get();
        // 在主连接存活且没有正在发送数据的情况下，发送数据
        if (ws && !dataSending) {
            dataSending = true;
            clearInterval(timer);
            ws.send(JSON.stringify(respObj), (err) => {
                dataSending = false; // 数据发送完毕
            });
        }
    }, 500);
}

module.exports = {
    set,
    get,
    send
}