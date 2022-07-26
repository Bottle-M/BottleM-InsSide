// 能用到的工具函数或者属性
'use strict';
const {
    readdirSync,
    writeFileSync,
    rmSync,
    statSync,
    mkdirSync,
    promises: fs
} = require('fs');
const readLine = require('readline');
const { exec } = require('child_process');
const { EventEmitter } = require('events');
const path = require('path');
/** Server模块相关的事件*/
const serverEvents = new EventEmitter();
const WORKING_DIR = process.cwd();
// 部署锁定文件路径
const LOCK_FILE_PATH = path.join(WORKING_DIR, 'deploy.lock');
// Minecraft日志读取字节数记录文件
const MC_LOG_BYTES_FILE_PATH = path.join(WORKING_DIR, '.mc_log_read_bytes');

/**
 * （异步）比对出Minecraft日志中更新的部分并返回
 * @param {String} mcLogPath Minecraft日志(latest.log)的绝对路径
 * @returns {Promise} resolve一个对象{logStr(日志字符串),logReread(是否重读了)}，reject读取失败
 * @note 因为Minecraft服务器日志是追加写入的，每次从开服到关服的日志写在一个日志文件中.
 */
function logDiff(mcLogPath) {
    const MAX_READ_BYTES = 3 * 1024 * 1024; // 最多读取3MB的日志
    return fs.readFile(MC_LOG_BYTES_FILE_PATH, {
        encoding: 'utf8' // 不指定这个的话，返回的是buffer
    }).then(record => record.split(' ').map(Number))
        .catch(err => [0, 0]) // 文件不存在就从0开始读取
        .then(record => {
            // 获得上次读到的字节数和上次的文件大小
            let [lastReadBytes, lastFileSize] = record;
            return fs.open(mcLogPath, 'r')
                .then(fileHandle => {
                    return fileHandle.stat() // 获得文件信息
                        .then(stat => Promise.resolve({
                            currentFileSize: stat.size,
                            fileHandle
                        }));
                }).then(resObj => {
                    const { currentFileSize, fileHandle } = resObj;
                    let logReread = false, // 是否重读文件
                        allocSize = currentFileSize; // 分配给buffer的大小
                    // 如果文件大小变小了，说明日志肯定被修改了，从头开始读取
                    if (currentFileSize < lastFileSize) {
                        lastReadBytes = 0;
                        logReread = true;
                    }
                    // 如果需要读取的日志部分大小已经超过了规定
                    if (currentFileSize - lastReadBytes > MAX_READ_BYTES) {
                        // 把文件读取起始位置移到最后5MB的位置
                        lastReadBytes = currentFileSize - MAX_READ_BYTES;
                        allocSize = MAX_READ_BYTES;
                    }
                    return fileHandle.read({
                        buffer: Buffer.alloc(allocSize),
                        position: lastReadBytes // 从上次读的地方继续往下读
                    }).then(resObj => {
                        // 将这些信息一同resolve
                        resObj['lastReadBytes'] = lastReadBytes;
                        resObj['currentFileSize'] = currentFileSize;
                        resObj['logReread'] = logReread;
                        fileHandle.close();
                        return Promise.resolve(resObj);
                    })
                });
        }).then(resObj => {
            const {
                buffer,
                bytesRead,
                lastReadBytes,
                currentFileSize,
                logReread
            } = resObj;
            // 注意这里必须要把三个参数都传到位，不然会把buffer剩余的空值都读到字符串中
            const logStr = buffer.toString('utf8', 0, bytesRead); // 转为字符串
            const currentReadBytes = lastReadBytes + bytesRead; // 计算当前读到的字节数
            // 将这次读取的字节数和文件大小写入文件
            return fs.writeFile(MC_LOG_BYTES_FILE_PATH, `${currentReadBytes} ${currentFileSize}`)
                .then(res => Promise.resolve({
                    logStr,
                    logReread
                })); // 最后将日志字符串和是否重读文件resolve出去
        })
}

/**
 * 执行一组bash脚本
 * @param {String|Array} scripts bash脚本的**绝对路径**或bash脚本的绝对路径组成的数组
 * @param {Object} env 环境变量对象
 * @param {String} cwd bash脚本执行所在工作目录
 * @param {Boolean} showInfo 是否显示执行信息
 * @returns {Promise} resolve标准输出stdout组成的数组，元素顺序和传入的脚本顺序一致
 * @note 会自动从配置中读取环境变量
 */
function execScripts(scripts, env, cwd, showInfo = true) {
    if (!Array.isArray(scripts)) scripts = [scripts];
    let tasks = [], // 任务队列
        resultStdouts = [], // 执行结果的标准输出
        runTasks = (index = 0) => { // 逐个执行bash脚本任务
            return tasks[index]().then(stdout => {
                resultStdouts.push(stdout); // 记录标准输出
                if (index < tasks.length - 1) {
                    return runTasks(index + 1);
                } else {
                    return Promise.resolve(resultStdouts);
                }
            });
        };
    // 新增一个毫秒时间戳环境变量TIMESTAMP
    env['TIMESTAMP'] = Date.now();
    for (let i = 0, len = scripts.length; i < len; i++) {
        let absPath = scripts[i]; // 获得脚本的绝对路径
        tasks.push(() => new Promise((res, rej) => {
            if (showInfo)
                console.log(`Executing: ${absPath}`);
            exec(absPath, {
                cwd: cwd, // 执行脚本的目录
                env: env,
                shell: '/bin/bash', // 指定bash解释器
                encoding: 'utf-8'
            }, (err, stdout, stderr) => {
                if (err) {
                    rej(err + '\nINS_STDOUT:' + stdout + '\nINS_STDERR:' + stderr + '\n-----------\n'); // 错误留给上层处理
                } else {
                    if (showInfo)
                        console.log(`\nINS_STDOUT: ${stdout}\nINS_STDERR: ${stderr}\n------------------\n`);
                    res(stdout);
                }
            })
        }));
    }
    return runTasks();
}

/**
 * （异步）清除目录中所有内容
 * @param {String} dirPath 目录路径
 * @returns {Promise} resolve清除成功，reject清除失败
 */
function clearDir(dirPath) {
    return fs.readdir(dirPath).then(files => {
        return new Promise((resolve, reject) => {
            try {
                for (let i = 0, len = files.length; i < len; i++) {
                    rmSync(path.join(dirPath, files[i]), {
                        recursive: true // 支持深层目录
                    })
                }
            } catch (e) {
                reject(e);
            }
            resolve();
        });
    });
}

/**
 * 根据目录生成一个Key
 * @param {String} dirPath 目录绝对路径
 */
function dirKey(dirPath) {
    return dirPath.split(/[/\\]/).filter(x => !(/^\s*$/.test(x))).join('-');
}

/**
 * （同步）计算目录的总大小
 * @param {String} dirPath 目录路径
 * @returns {Number} 目录大小(In Bytes)
 * @note 非递归算法
 */
function calcDirSize(dirPath) {
    let scanStack = [dirPath]; // 扫描栈
    let totalSize = 0; // 目录总大小(In Bytes)
    try {
        while (scanStack.length > 0) { // 在栈没有清空前不停循环
            let filePath = scanStack.pop(), // 弹出栈顶元素
                fileStat = statSync(filePath); // 获取文件信息
            if (fileStat.isDirectory()) {
                // 如果是目录，则进行扫描，将子文件/目录压入栈中
                let dirFiles = readdirSync(filePath);
                for (let i = 0, len = dirFiles.length; i < len; i++) {
                    scanStack.push(path.join(filePath, dirFiles[i]));
                }
            } else {
                // 如果是文件，则直接累加大小
                totalSize += fileStat.size;
            }
        }
    } catch (e) {
        console.log(`Error occured while scanning ${dirPath}: ${e}`);
        return 0;
    }
    return totalSize;
}

/**
 * （同步）扫描/对比目录中每个文件的修改时间
 * @param {String} dirPath 扫描的目录路径
 * @param {Object} compareObj 旧的修改时间信息对象（用于对比）
 * @returns {Object} 一个包含文件修改时间信息的对象，失败了会返回null
 * @note 当compareObj不传入时，就是扫描所有文件的修改时间并返回对象。
 * @note 当传入compareObj时，会对比找出修改时间变化的文件(或新建的文件)，并返回对象。
 * @note 每一个文件对应的值是数组 [修改时间,文件路径]
 * @note 注：对比结果是不包括删除了的文件的，用于增量备份
 */
function scanDirMTime(dirPath, compareObj = null) {
    let outputObj = new Object(); // 结果对象
    let scanStack = [dirPath]; // 扫描栈
    try {
        while (scanStack.length > 0) { // 在栈没有清空前不停循环
            let filePath = scanStack.pop(), // 弹出栈顶元素
                fileStat = statSync(filePath); // 获取文件信息
            if (fileStat.isDirectory()) {
                // 如果是目录，则进行扫描，将子文件/目录压入栈中
                let dirFiles = readdirSync(filePath);
                for (let i = 0, len = dirFiles.length; i < len; i++) {
                    scanStack.push(path.join(filePath, dirFiles[i]));
                }
            } else {
                // 是文件
                let key = dirKey(filePath),
                    mTime = fileStat.mtime.getTime();
                // 没有要对照的对象(全部扫描)，或寻找有修改过的文件
                if (!(compareObj && compareObj[key] && compareObj[key][0] === mTime))
                    outputObj[key] = [
                        mTime,
                        filePath
                    ]; // [修改时间, 文件路径]
            }
        }
    } catch (e) {
        console.log(`Error occured while scanning ${dirPath}: ${e}`);
        return null;
    }
    return outputObj;
}

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
        writeFileSync(LOCK_FILE_PATH, Date.now().toString(), {
            encoding: 'utf8'
        });
    } else {
        rmSync(LOCK_FILE_PATH);
    }
}

/**
 * 查询Minecraft是否已经部署
 * @returns {Boolean} 是否已经部署 
 */
function deployed() {
    try {
        statSync(LOCK_FILE_PATH);
    } catch (e) {
        return false;
    }
    return true;
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
    workingDir: WORKING_DIR,
    logDiff,
    optionsInArgs,
    lockDeploy,
    deployed,
    dirCheck,
    calcDirSize,
    scanDirMTime,
    execScripts,
    clearDir,
    dirKey,
    serverEvents
}