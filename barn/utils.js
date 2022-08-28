// 能用到的工具函数或者属性
'use strict';
const { writeFileSync, rmSync, statSync, mkdirSync } = require('fs');
const path = require('path');
const workDir = process.cwd();
const lockFilePath = path.join(workDir, 'deploy.lock');

/**
 * (同步)检查目录是否存在，不存在就创建
 * @param {String} dirPath 目录绝对路径
 */
function dirCheck(dirPath) {
    try {
        statSync(dirPath);
    } catch (e) {
        mkdirSync(dirPath, {
            recursive: true // 支持深层目录
        });
    }
}

/**
 * 锁定/解除锁定部署
 * @param {Boolean} operate 是否锁定
 */
function lockDeploy(operate) {
    if (operate) {
        writeFileSync(lockFilePath, Date.now().toString(), {
            encoding: 'utf8'
        });
    } else {
        rmSync(lockFilePath);
    }
}

/**
 * 查询Minecraft是否已经部署
 * @returns {Boolean} 是否已经部署 
 */
function deployed() {
    try {
        statSync(lockFilePath);
        return true;
    } catch (e) {
        return false;
    }
}

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
    workDir,
    optionsInArgs,
    lockDeploy,
    deployed,
    dirCheck
}