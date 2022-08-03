// 配置接收者
'use strict';
const jsons = require('./json-scaffold');
const utils = require('./utils');
const path = require('path');
// 实例端临时配置的文件名（如果这一项改了，Backend的源码也要改）
const insTempConfigName = 'ins_side_configs.tmp.json';
// 临时用的默认配置
const defaultConfigs = {
    'ws_port': 9527,
    'ws_ping_timeout': 30000,
    'remote_dir': '/root/',
    'secret_key': null
}
// 配置储存在内存中
var currentConfigs = {};

/**
 * 从临时配置文件中读取配置
 */
function readTmpConfigs() {
    let absPath = path.join(utils.workDir, insTempConfigName),
        parentPath = path.join(utils.workDir, '..', insTempConfigName);
    // 如果index.js所在目录下没有配置文件，就向上找一层
    currentConfigs = jsons.scRead(absPath) || jsons.scRead(parentPath);
    if (!currentConfigs) { // 还是找不到，就用默认配置
        currentConfigs = defaultConfigs;
        console.error(`[ERROR] Failed to read Config File, using DEFAULT`);
    }
}

readTmpConfigs(); // 启动时就先读取一次

module.exports = {
    /**
     * 获得实例端当前的配置
     * @param {String} key 配置项的键
     * @returns {Object} 键对应的配置内容/整个配置对象
     */
    getConfigs: (key = '') => (key ? currentConfigs[key] : currentConfigs)
}