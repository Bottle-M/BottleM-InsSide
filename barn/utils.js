// 能用到的工具函数或者属性
'use strict';
const path = require('path');

module.exports = {
    // 考虑到到时候可能要打包成可执行文件，这里用process.cwd()
    // 注意，process.cwd()代表的index.js所在目录，也就是程序执行入口所在目录
    workDir: process.cwd()
}