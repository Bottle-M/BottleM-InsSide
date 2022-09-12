// 状态码处理部分
'use strict';
const { statSync, writeFileSync } = require('fs');
const jsons = require('./json-scaffold');
const path = require('path');
const utils = require('./utils');
const wsSender = require('./ws-sender');
// 状态记录文件的路径
const STATUS_FILE_PATH = path.join(utils.workingDir, 'ins_status.json');

// 默认状态配置
const defaultStatus = {
    status_code: 2201, // 实例端状态代号从2201开始
    idling_time_left: -1, // Minecraft服务器还能闲置多久（单位：秒）
};

try {
    statSync(STATUS_FILE_PATH);
} catch (e) {
    // 如果状态文件不存在，则创建一个新的
    writeFileSync(STATUS_FILE_PATH, JSON.stringify(defaultStatus));
}

/**
 * （同步）设置Status文件的值
 * @param {String|Array} keys 设置的键（可以是键组成的数组）
 * @param {String|Array} values 设置的内容（可以是内容组成的数组）
 * @returns {Boolean} 是否成功
 */
function setVal(keys, values) {
    return jsons.scSet(STATUS_FILE_PATH, keys, values);
}

/**
 * （同步）设置状态码
 * @param {Number} code 状态代号
 * @returns {Boolean} 是否成功
 */
function update(code) {
    // 顺带和主控端进行状态码同步.
    wsSender.send({
        'action': 'status_sync',
        'status_code': code
    });
    return jsons.scSet(STATUS_FILE_PATH, 'status_code', Number(code));
}

/**
 * （同步）获得Status文件的值
 * @param {String} key 要获得的值对应的键
 * @returns 返回key对应的值或整个状态文件对象，获取错误会返回null
 */
function getVal(key = '') {
    let status = jsons.scRead(STATUS_FILE_PATH);
    if (status) {
        return key ? status[key] : status;
    } else {
        return null;
    }
}

module.exports = {
    update,
    getVal,
    setVal
}