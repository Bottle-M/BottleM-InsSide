// rcon连接部分
'use strict';
const rconClient = require('rcon');
const logger = require('./logger');
var mainConnection = null; // rcon主连接

/**
 * 创建rcon主连接
 * @param {Number} port 本地连接端口
 * @param {String} password 本地连接密码
 * @returns {Promise} 如果连接发生错误会resolve
 */
function make(port, password) {
    // 创建RCON连接实例
    let conn = new rconClient('127.0.0.1', port, password);
    return new Promise((resolve) => {
        conn.on('auth', () => {
            console.log('New RCON connection established.');
            mainConnection = conn; // 记录连接实例
        }).on('response', (data) => {
            logger.record(1, `RCON response: ${data}`);
        }).on('error', (err) => {
            logger.record(2, `RCON Connection Error:${err}`);
            mainConnection = null; // 清空连接实例
            resolve(err);
        }).on('end', () => {
            console.log('RCON Connection closed, reconnecting...');
            mainConnection = null; // 清空连接实例
            // 两秒后重连
            setTimeout(() => {
                resolve(make(port, password));
            }, 2000);
        });
        conn.connect();
    });
}

/**
 * 通过RCON向Minecraft服务器控制台发送命令
 * @param {String} cmd 命令内容
 */
function send(cmd) {
    let timer = setInterval(() => {
        if (mainConnection) {
            mainConnection.send(cmd);
            clearInterval(timer);
        }
    }, 200);
}

module.exports = {
    make,
    send
}