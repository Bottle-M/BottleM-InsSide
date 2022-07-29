// 能用到的工具函数或者属性
'use strict';
const path = require('path');

module.exports = {
    // 考虑到到时候可能要打包成可执行文件，这里用execDir
    // 注意，execDir代表的是index.js所在目录，也就是程序执行入口所在目录
    execDir: path.dirname(process.execPath)
}