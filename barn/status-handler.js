// 状态码处理部分
'use strict';
const { statSync, writeFileSync } = require('fs');
const jsons = require('./json-scaffold');
const path = require('path');
const utils = require('./utils');
const wsSender = require('./ws-sender');
// 状态记录文件的路径
const statusFilePath = path.join(utils.workDir, 'ins_status.json');

// 默认状态配置
const defaultStatus = {
    status_code: 2201 // 实例端状态代号从2201开始
};

try {
    statSync(statusFilePath);
} catch (e) {
    // 如果状态文件不存在，则创建一个新的
    writeFileSync(statusFilePath, JSON.stringify(defaultStatus));
}

/**
 * （异步）设置状态码
 * @param {Number} code 状态代号
 * @returns {Promise}
 */
function set(code) {
    // 顺带和主控端进行状态码同步.
    wsSender.send({
        'action': 'status_sync',
        'status_code': code
    });
    return jsons.ascSet(statusFilePath, 'status_code', Number(code));
}

/**
 * （同步）获得状态信息
 * @param {String} key 要获得的值对应的键
 * @returns 返回key对应的值或整个状态文件对象，获取错误会返回null
 */
function get(key = '') {
    let status = jsons.scRead(statusFilePath);
    if (status) {
        return key ? status[key] : status;
    } else {
        return null;
    }
}

module.exports = {
    set,
    get
}