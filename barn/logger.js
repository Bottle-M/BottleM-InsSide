// 日志记录模块
'use strict';
const wsSender = require('./ws-sender');
const unsentLogs = []; // 未发送出去的日志列表
var unsentChecker = null; // 未发送日志检查timer

/**
 * 检查并发送未发送的日志
 */
function sendUnsentLogs() {
    for (let i = 0, len = unsentLogs.length; i < len; i++) {
        let logItem = unsentLogs[i];
        if (wsSender.send(logItem)) { // 尝试发送日志
            unsentLogs.splice(i, 1); // 如果发送成功，则从未发送日志列表中移除
        }
    }
    if (unsentLogs.length === 0) { // 所有日志都发送成功了，则停止轮询
        clearInterval(unsentChecker);
    }
}

/**
 * 记录日志
 * @param {Number} level 消息等级
 * @param {String} msg 消息内容
 * @param {Boolean} error 是否发生了错误(默认false)
 * @note 1:普通提示 2:警告 3:错误
 * @note 记录日志的时候如果WebSocket连接断开，会暂时缓存日志，等待WebSocket重新连接后再发送
 */
function record(level, msg, error = false) {
    let time = new Date().getTime(), // 获得当前时间戳
        newLog = {
            'action': 'log_sync', // 同步日志
            'level': level,
            'msg': msg,
            'time': time, // 同步时间
            'error': error // 是否发生错误
        };
    if (!wsSender.send(newLog)) { // 发送日志
        unsentLogs.push(newLog); // 如果发送失败，则暂时缓存日志
        unsentChecker = setInterval(sendUnsentLogs, 4000); // 开始轮询是否能发送日志，直到所有残留日志被成功发送出去
    }
}

module.exports = {
    record
}