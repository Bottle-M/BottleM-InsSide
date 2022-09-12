// 日志记录模块
'use strict';
const wsSender = require('./ws-sender');

/**
 * 记录日志
 * @param {Number} level 消息等级
 * @param {String} msg 消息内容
 * @param {Boolean} error 是否发生了错误(默认false)
 * @note 1:普通提示 2:警告 3:错误
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
    if (level === 1) {
        wsSender.send(newLog); // 发送日志
    } else {
        // 警告或者错误必须要发到主控端
        wsSender.send(newLog, true);
    }
    console.log(msg); // 输出到控制台
}

module.exports = {
    record
}