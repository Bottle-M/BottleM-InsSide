// 配置接收者
'use strict';
const jsons = require('./json-scaffold');
const utils = require('./utils');
const path = require('path');
// 实例端临时配置的文件名（如果这一项改了，Backend的源码也要改）
const insTempConfigName = 'ins_side_configs.tmp.json';
// 获得命令行选项
const cmdOptions = utils.optionsInArgs();
// 从命令行参数获得配置文件路径，默认/root/baseData
const configPath = cmdOptions['data'] || cmdOptions['d'] || '/root/baseData';
// 配置储存在内存中
var currentConfigs = {};

/**
 * 从临时配置文件中读取配置
 */
function readTmpConfigs() {
    let absPath = path.join(configPath, insTempConfigName);
    // 如果index.js所在目录下没有配置文件，就向上找一层
    currentConfigs = jsons.scRead(absPath);
    if (!currentConfigs) { // 找不到配置，退出进程
        console.error(`[ERROR] Failed to read Config File!`);
        process.exit(1); // 直接退出
    }
}

readTmpConfigs(); // 启动时就先读取一次

module.exports = {
    refreshConfigs: readTmpConfigs,
    /**
     * 获得实例端当前的配置
     * @param {String} key 配置项的键
     * @returns {Object} 键对应的配置内容/整个配置对象
     */
    getConfigs: (key = '') => (key ? currentConfigs[key] : currentConfigs)
}