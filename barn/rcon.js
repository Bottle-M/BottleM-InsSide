// rcon连接部分
'use strict';
const rconClient = require('rcon');
const { EventEmitter } = require('ws');
const logger = require('./logger');
const rconEvents = new EventEmitter();
const COOL_DOWN = 10000; // RCON信息发送的最长冷却时间(ms)
var mainConnection = null; // rcon主连接
var sendingCommand = false; // 是否正在发送指令

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
            sendingCommand = false; // 有回应，标记指令发送完成
            rconEvents.emit('dispatched'); // 发送指令已经被处理
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
 * @returns {Promise} 如果发送成功会resolve
 */
function send(cmd) {
    return new Promise((resolve) => {
        let timer = setInterval(() => {
            if (mainConnection && !sendingCommand) {
                sendingCommand = true; // 标记正在发送指令，防并发
                mainConnection.send(cmd);
                clearInterval(timer);
                let coolDownTimer = setTimeout(() => {
                    // 如果没有response，在coolDown时间后自动标记指令发送完成
                    sendingCommand = false;
                    resolve();
                }, COOL_DOWN);
                rconEvents.once('dispatched', () => {
                    clearInterval(coolDownTimer);
                    resolve();
                });
            }
        }, 200);
    });
}

module.exports = {
    make,
    send
}