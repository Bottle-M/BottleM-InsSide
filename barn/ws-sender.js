// 储存WebSocket连接的模块
'use strict';
const discardTimeout = 60000; // 消息最多遗留多久，超过这个时间的消息会放弃发送，单位毫秒
const pollInterval = 500; // 未发送消息的轮询间隔
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
 * 流程走完，向主控端说再见
 */
function goodbye() {
    let ws = get();
    if (ws) {
        ws.close(1001, 'Goodbye');
    }
}

/**
 * 通过主WebSocket发送数据，如果未发送成功会伺机重新发送
 * @param {Object} respObj 待发送数据对象
 * @param {Boolean} urgent 是否重要(重要的数据必须发送，会一直轮询)
 * @returns {Promise} 发送成功resolve，不会reject
 * @note Websocket.send不能短时间内连续调用！之前因为这里内存溢出，排查了半天！
 * @note https://github.com/websockets/ws/issues/999#issuecomment-279233272
 */
function send(respObj, urgent = false) {
    return new Promise((resolve, reject) => {
        let waitedFor = 0, // 已经等待了多久
            timer = setInterval(() => {
                let ws = get();
                // 在主连接存活且没有正在发送数据的情况下，发送数据
                if (ws && !dataSending) {
                    dataSending = true;
                    clearInterval(timer);
                    ws.send(JSON.stringify(respObj), (err) => {
                        dataSending = false; // 数据发送完毕
                        if (err) {
                            console.error(`Error while sending data through WebSocket: ${err}`);
                            return;
                        }
                        resolve();
                    });
                }
                waitedFor += pollInterval;
                // 非紧急消息，等待了一段时间消息还没发出去，就抛弃
                if (!urgent && waitedFor >= discardTimeout) {
                    clearInterval(timer);
                    console.error(`Error while sending data through WebSocket: ${err}`); // 消息发送失败
                }
            }, pollInterval);
    });
}

module.exports = {
    set,
    get,
    send,
    goodbye
}