// 储存WebSocket连接的模块
'use strict';
const unsentObjs = []; // 记录未成功发送出去的数据
var unsentChecker = null; // 未发送数据轮询Timer
var webSocketStore = null;

/**
 * 轮询没有成功发送出去的数据，尝试发送
 */
function sendUnsent() {
    for (let i = 0, len = unsentObjs.length; i < len; i++) {
        let obj = unsentObjs[i];
        if (originalSend(obj)) { // 尝试发送数据
            unsentObjs.splice(i, 1); // 如果发送成功，则从未发送数据列表中移除
            i--;
        }
    }
    if (unsentObjs.length === 0) { // 所有未发送数据都成功发送了，则停止轮询
        clearInterval(unsentChecker);
    }
}

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
function originalSend(respObj) {
    let ws = get();
    if (ws) {
        ws.send(JSON.stringify(respObj));
        return true;
    }
    return false;
}

/**
 * 通过主WebSocket发送数据，如果未发送成功会伺机重新发送
 * @param {Object} respObj 
 */
function send(respObj) {
    if (!originalSend(respObj)) {
        console.log('New unsent data was temporarily saved.');
        unsentObjs.push(respObj); // 如果发送失败，则将数据添加到未发送数据列表中
        clearInterval(unsentChecker);
        unsentChecker = setInterval(sendUnsent, 4000); // 开启轮询，看什么时候能发送成功
    }
}

module.exports = {
    set,
    get,
    send
}