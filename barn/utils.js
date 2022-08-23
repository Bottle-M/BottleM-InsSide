// 能用到的工具函数或者属性
'use strict';
const path = require('path');

/**
 * 获得命令行参数解析出的选项(options)内容
 * @returns {Object} 解析出来的命令行选项键值对
 */
function optionsInArgs() {
    let args = process.argv,
        options = {};
    for (let i = 0, len = args.length; i < len; i++) {
        let arg = args[i];
        // 检查参数数组中的选项，如--config -c
        if (arg.startsWith('--') || arg.startsWith('-')) {
            // 去除参数前的短横线
            let key = arg.replace(/^-+?(\w.*)$/, '$1'),
                value = args[i + 1];
            if (value && !value.startsWith('-')) {
                options[key] = value;
                i++; // 如果选项成立，跳过下一个参数
            }
        }
    }
    return options;
}

module.exports = {
    // 考虑到到时候可能要打包成可执行文件，这里用process.cwd()
    // 注意，process.cwd()代表的index.js所在目录，也就是程序执行入口所在目录
    workDir: process.cwd(),
    optionsInArgs
}