// 服务器部署/监控部分
'use strict';
const {
    promises: fs,
    writeFileSync,
    copyFileSync,
    statSync
} = require('fs');
const { ping } = require('minecraft-protocol');
const path = require('path');
const utils = require('./utils');
const jsons = require('./json-scaffold');
const configs = require('./configs-recv');
const status = require('./status-handler');
const logger = require('./logger');
const rcon = require('./rcon');
const wsSender = require('./ws-sender');

class ServerBase {
    /**
     * Minecraft服务器部署基类
     * @note 构造器主要用于初始化配置
     */
    constructor() {
        let allConfigs = configs.getConfigs(),
            {
                data_dir: dataDir,
                deploy_scripts: deployScripts,
                launch_script: launchScript,
                server_scripts: serverScripts,
                server_ending_scripts: endingScripts,
                script_exec_dir: execDir,
                rcon: rconConfigs,
                under_maintenance: underMaintenance, // 维护模式
                restore_before_launch: restoreBeforeLaunch, // 部署前恢复增量备份
                backup_records,
                env
            } = allConfigs;
        this.configs = allConfigs;
        // 取到之前的备份记录，如果没有就是null
        this.previouBackupRecs = backup_records;
        this.underMaintenance = underMaintenance;
        this.restoreBeforeLaunch = restoreBeforeLaunch;
        this.rconConfigs = rconConfigs;
        // 脚本存放的目录
        this.dataDir = dataDir;
        // 脚本执行时的环境变量
        this.execEnv = env;
        // 脚本执行所在目录
        this.execDir = execDir;
        // 处理部署脚本路径为绝对路径
        this.deployScripts = deployScripts.map(script => path.join(dataDir, script));
        // 处理Minecraft服务器启动脚本路径为绝对路径
        this.launchScript = path.join(dataDir, launchScript);
        // 处理Minecraft服务器相关脚本为绝对路径
        this.serverScripts = new Object();
        for (let i in serverScripts)
            this.serverScripts[i] = path.join(dataDir, serverScripts[i]);
        // 处理服务关闭后脚本为绝对路径
        this.endingScripts = new Object();
        for (let i in endingScripts)
            this.endingScripts[i] = path.join(dataDir, endingScripts[i]);
    }
}

class IncBackup extends ServerBase {
    /**
     * 构造增量备份实例
     */
    constructor() {
        super();
        // 读取增量备份相关配置
        let {
            enable,
            dest_dir,
            scripts,
            src_dirs
        } = this.configs['incremental_backup'];
        let backupDestDir = path.join(dest_dir, './backup'), // 备份用目录
            restoreDestDir = path.join(dest_dir, './restore'); // 恢复用目录
        // 记录增量备份文件的文件的路径
        this.backupRecordsFilePath = path.join(dest_dir, './backup-records.json');
        // 环境变量新增BACKUP_DEST_DIR和RESTORE_DEST_DIR
        this.execEnv['BACKUP_DEST_DIR'] = backupDestDir;
        this.execEnv['RESTORE_DEST_DIR'] = restoreDestDir;
        this.enable = enable;
        this.destDir = dest_dir;
        // 将脚本路径转换为绝对路径
        this.backupScripts = new Object();
        for (let i in scripts)
            this.backupScripts[i] = path.join(this.dataDir, scripts[i]);
        this.srcDirs = src_dirs;
        this.backupDestDir = backupDestDir;
        this.restoreDestDir = restoreDestDir;
        // 标记仍未初始化
        this.initialized = false;
        // 检查目录是否存在，不存在则创建
        utils.dirCheck(dest_dir);
        utils.dirCheck(backupDestDir);
        utils.dirCheck(restoreDestDir);
    }
    /**
     * （异步）初始化（扫描所有srcDirs中的文件，记录最初的mtime）
     * @returns {Promise}
     */
    init() {
        console.log('Initializing incremental backup...');
        let that = this;
        // 未开启增量备份功能或者已经初始化过了
        if (!this.enable || this.initialized)
            return Promise.resolve();
        return new Promise((resolve, reject) => {
            // 遍历待备份的目录
            for (let i = 0, len = that.srcDirs.length; i < len; i++) {
                let dirPath = that.srcDirs[i],
                    backupKey = utils.dirKey(dirPath), // 备份标识
                    // 备份标识名
                    backupDir = path.join(that.backupDestDir, backupKey),
                    mTimeFile = path.join(that.destDir, `${backupKey}.json`);// 记录修改日期的文件
                // 检查备份目录是否存在，不存在则创建
                utils.dirCheck(backupDir);
                // 扫描目标目录，记录所有文件的mtime
                let mTimeObj = utils.scanDirMTime(dirPath);
                if (!mTimeObj) {
                    reject(`Failed to scan directory ${dirPath}`);
                    return;
                }
                // 写入修改日期记录文件
                writeFileSync(mTimeFile, JSON.stringify(mTimeObj));
            }
            // 初始化完成
            that.initialized = true;
            console.log('Incremental backup initialized.');
            resolve();
        });
    }
    /**
     * （异步）执行单次增量备份
     * @returns {Promise}
     * @note 前提：已经初始化过
     */
    make() {
        // 未开启增量备份功能或者未初始化
        if (!this.enable || !this.initialized)
            return Promise.resolve();
        console.log('Making incremental backup...');
        let that = this;
        return new Promise((resolve, reject) => {
            // 遍历待备份的目录
            for (let i = 0, len = that.srcDirs.length; i < len; i++) {
                let srcDirPath = that.srcDirs[i],
                    backupKey = utils.dirKey(srcDirPath), // 备份标识
                    // 备份标识名
                    backupDir = path.join(that.backupDestDir, backupKey),
                    mTimeFile = path.join(that.destDir, `${backupKey}.json`), // 记录修改日期的文件
                    copyMapPath = path.join(backupDir, 'copyMap.json'); // 记录复制文件和源文件的路径对应关系
                console.log(`[Backup]Scanning directory: ${srcDirPath}`);
                // 扫描目标目录，查看有哪些文件更新了
                let prevObj = jsons.scRead(mTimeFile) || {}, // 读取上次备份时的mtime记录
                    diffObj = utils.scanDirMTime(srcDirPath, prevObj); // 扫描目标目录，查看有哪些文件更新了
                // 扫描失败
                if (!diffObj) {
                    reject(`Failed to scan directory ${srcDirPath}`);
                    return;
                }
                try {
                    let destDirCache = '', // 目标目录缓存，免得多次dirCheck
                        copyMap = []; // 记录复制文件和源文件的路径对应关系
                    // 复制更新的文件到备份目录
                    console.log(`[Backup]Copying files...`);
                    for (let key in diffObj) {
                        let filePath = diffObj[key][1],
                            // 获得文件相对于srcDirPath的路径
                            relativeFilePath = path.relative(srcDirPath, filePath),
                            // 复制到的目标路径
                            destPath = path.join(backupDir, relativeFilePath),
                            // 待复制文件的目标目录
                            destDir = path.dirname(destPath);
                        // 如果最近检查过目标目录，则不再检查
                        if (destDirCache !== destDir) {
                            // 检查目标目录是否存在，不存在则创建
                            utils.dirCheck(destDir);
                            destDirCache = destDir;
                        }
                        // 复制文件
                        copyFileSync(filePath, destPath);
                        // 记录复制文件和源文件的路径对应关系
                        // [文件相对于srcDirPath的路径, 文件源绝对路径]
                        copyMap.push([relativeFilePath, filePath]);
                        // 更新修改日期记录对象
                        prevObj[key] = diffObj[key];
                    }
                    // 将变更的修改日期写入修改日期记录文件
                    writeFileSync(mTimeFile, JSON.stringify(prevObj));
                    // 写入copyMap
                    writeFileSync(copyMapPath, JSON.stringify(copyMap));
                } catch (e) {
                    reject(`Error occured while copying files: ${e}`);
                    return;
                }
                console.log(`[Backup]Successfully made backup for: ${srcDirPath}`);
            }
            // 写入新的增量备份信息
            let backupName = `bk-${Date.now()}`, // 备份名
                backupObj = {
                    action: 'backup_sync',
                    name: backupName,
                    time: Date.now()
                };
            // 回传给主控端
            wsSender.send(backupObj, true); // urgent=true，必须要发到主控端
            // 在本地记录备份信息
            that.recordBackup(backupObj);
            // 初始化完成
            that.initialized = true;
            resolve(backupName);
        }).then(backupName => {
            // 打包并上传本次增量备份
            return utils.execScripts(that.backupScripts['backup'], Object.assign({
                // 特别环境变量BACKUP_NAME，用于指定备份文件名
                'BACKUP_NAME': backupName
            }, that.execEnv), that.execDir);
        }).then(stdouts => {
            // 单次备份结束，清除增量备份目录
            return utils.clearDir(that.backupDestDir);
        })
    }
    /**
     * （同步）将备份文件信息对象写入backupRecords
     * @param {Object} backupObj 
     */
    recordBackup(backupObj) {
        let backupRecords = jsons.scRead(this.backupRecordsFilePath) || [];
        backupRecords.push(backupObj);
        writeFileSync(this.backupRecordsFilePath, JSON.stringify(backupRecords));
    }
    /**
     * （同步）读取在Minecraft服务器运行过程中创建的增量备份记录
     * @returns {Array|null} 备份记录组成的数组，失败则返回null
     * @note 实质上就是读backupRecords文件
     */
    getRecords() {
        return jsons.scRead(this.backupRecordsFilePath);
    }
    /**
     * （异步）抛弃实例端和主控端的增量备份记录（这说明用不上这些备份了）
     * @param {Array} records 要删除的增量备份记录
     * @returns {Promise}
     * @note 仅在实例端启动时/正常结束流程时调用
     * @note Minecraft服务器运行时的增量备份是不允许丢弃的
     */
    discardRecords(records) {
        // 未开启增量备份功能或者未初始化或者没有备份记录
        if (!this.enable || !this.initialized || !records)
            return Promise.resolve();
        logger.record(1, 'Discarding unneeded incremental backups...');
        let that = this;
        // 删除实例端的增量备份记录
        // 通知主控端也删除增量备份记录
        return wsSender.send({
            action: 'revoke_backup' // 抛弃增量备份记录
            // urgent=true,必须要发到主控端
        }, true).then(res => {
            // 通过脚本移除云储存中的增量备份
            let backupNameList = ''; // 备份文件名列表（不包括文件后缀名）
            if (records && records.length > 0) {
                // 拼接成Bash脚本能识别的列表
                backupNameList = records.map(rec => rec.name).join(' ');
            }
            return utils.execScripts(that.backupScripts['discard'], Object.assign({
                // 特别环境变量BACKUP_NAME_LIST，用于指定备份文件名列表
                'BACKUP_NAME_LIST': backupNameList
            }, that.execEnv), that.execDir);
        });
    }
    /**
     * （同步）根据目录中的copyMap来恢复备份，和restore结合使用
     * @param {String} dirPath 待恢复的备份的目录
     * @returns {Boolean} 是否恢复成功
     */
    restoreByMap(dirPath) {
        console.log(`[Restore]Copying Dir: ${dirPath}`);
        // 找到copyMap文件
        let copyMapFile = path.join(dirPath, 'copyMap.json'),
            that = this;
        try {
            statSync(copyMapFile); // 检查copyMap是否存在
            let copyMap = jsons.scRead(copyMapFile);
            if (copyMap) {
                // copyMap存在，开始恢复
                let srcDirCache = null; // 源文件路径缓存
                copyMap.forEach(item => {
                    let [relativeFilePath, srcPath] = item, // [相对于备份/恢复目录的路径, 文件原本所在的绝对路径]
                        absFilePath = path.join(dirPath, relativeFilePath), // 目前文件在恢复目录中的绝对路径s
                        srcDir = path.dirname(srcPath); // 文件原本所在的目录
                    // 防止重复检查
                    if (srcDirCache !== srcDir) {
                        utils.dirCheck(srcDir); // 检查目录是否存在，不存在则创建
                        srcDirCache = srcDir;
                    }
                    // 恢复文件
                    copyFileSync(absFilePath, srcPath);
                });
            } else {
                throw new Error(`${dirPath}->copyMap is empty`);
            }
        } catch (e) {
            console.warn(`Error while restoring dir ${dirPath}: ${e}`);
            return false
        }
        console.log(`[Restore]Successfully copied dir: ${dirPath}`);
        return true;
    }
    /**
     * （异步）恢复单次增量备份
     * @param {String} backupName 备份文件名（不含扩展名）
     * @returns {Promise}
     */
    restore(backupName) {
        let that = this;
        // 未开启增量备份功能或者未初始化
        if (!this.enable || !this.initialized)
            return Promise.resolve();
        logger.record(1, `[Restore]Restoring backup: ${backupName}`);
        return utils.execScripts(this.backupScripts['restore'], Object.assign({
            // 特别环境变量BACKUP_NAME，用于指定备份文件名
            'BACKUP_NAME': backupName
        }, that.execEnv), this.execDir)
            .then(res => {
                // 读取解压出来的
                return fs.readdir(that.restoreDestDir, {
                    withFileTypes: true, // 返回dirent对象
                    encoding: 'utf8'
                });
            }).then(files => {
                return new Promise((resolve, reject) => {
                    for (let i = 0, len = files.length; i < len; i++) {
                        let dirent = files[i];
                        if (dirent.isDirectory()) { // 如果是目录，就可以进行备份恢复了
                            let currentDir = path.join(that.restoreDestDir, dirent.name);
                            if (!that.restoreByMap(currentDir))
                                return reject(`Failed to restore dir: ${currentDir}`);
                            logger.record(1, `Successfully restored dir ${dirent.name}`);
                        }
                    }
                    logger.record(1, `[Restore]Successfully restored backup: ${backupName}`);
                    // 删除解压出来的备份文件，善始善终
                    resolve(utils.clearDir(that.restoreDestDir));
                });
            });
    }
    /**
     * 恢复增量备份记录中的所有备份
     * @returns {Promise}
     * @note 恢复顺序是时间戳升序
     */
    restoreAll(records) {
        // 将备份按时间戳升序排序
        records.sort((a, b) => a.time - b.time);
        let that = this,
            tasker = (doing = 0) => {
                if (doing >= records.length)
                    return Promise.resolve();
                else
                    return that.restore(records[doing].name)
                        .then(res => tasker(doing + 1));
            };
        return tasker();
    }
}

class Server extends ServerBase {
    /**
     * 构造Server实例
     */
    constructor() {
        super();
        // 是否开启增量备份
        let { enable: backupEnabled } = this.configs['incremental_backup'];
        this.backupEnabled = backupEnabled;
        this.maintain = this.underMaintenance;
        // 创建增量备份的实例
        this.backuper = new IncBackup();
        // 检查目录是否存在
        utils.dirCheck(this.execDir);
    }
    /**
     * 服务器启动入口
     * @note 维护模式下，服务器启动后不会受到监控（不会自动关闭）
     */
    setup() {
        let that = this;
        console.log('Starting to deploy Minecraft Server');
        // 回传给主控端目前的部署配置（用于DEBUG）
        logger.record(1, `[Configs]Under maintenance:${this.maintain}`);
        logger.record(1, `[Configs]Restore incremental backups before launch:${this.restoreBeforeLaunch}`);
        utils.showMemUsage();
        this.deploy()
            .then(resume => that.waiter(resume)) // 等待Minecraft服务器启动
            .then(res => that.monitor()) // 部署成功后由monitor监视Minecraft服务器
            .then(options => that.stopServer(options)) // 执行Minecraft服务器关闭脚本
            .then(options => that.packAndUpload(options)) // 执行Minecraft服务器打包上传脚本
            .then(res => that.terminate()) // 流程执行结束，告别主控端
            .catch(err => { // 错误处理
                // 通过logger模块提醒主控端，这边发生了错误！
                console.log(`Error occured: ${err}`);
                logger.record(3, err, true);
            });
    }
    /**
     * 开始部署服务器
     * @returns {Promise}
     */
    deploy() {
        if (utils.deployed()) {
            // 如果已经部署了，先查询服务器是否正常启动
            // 这种情况一般是实例端意外重启，需要恢复服务器的状态
            console.log('Resuming...');
            return Promise.resolve(true); // 直接进入下一个流程
        }
        // 如果尚未部署Minecraft服务器，则开始
        let {
            packed_server_dir: packedServerDir, // 压缩包目录
            check_packed_server_size: checkPackedSize, // 是否检查压缩包大小
            mc_server_dir
        } = this.configs,
            that = this;
        logger.record(1, 'Start to execute deploy scripts for Minecraft Server...'); // 记录日志
        status.update(2202); // 设置状态码为2202，表示正在部署服务器
        utils.lockDeploy(true); // 锁定部署，防止重复部署
        // 检查目录是否存在
        utils.dirCheck(packedServerDir);
        utils.dirCheck(mc_server_dir);
        // 执行脚本
        return utils.execScripts(this.deployScripts, this.execEnv, this.execDir).then(res => {
            // 这个时候文件全部解压了，初始化增量备份
            return that.backuper.init();
        }).then(res => {
            // 检查是否需要先恢复增量备份
            // 先保证previouBackupRecs不为null
            if (that.previouBackupRecs) {
                if (that.restoreBeforeLaunch === 'discard') {
                    // 如果是丢弃增量备份
                    logger.record(1, 'Discarding previous incremental backups');
                    return that.backuper.discardRecords(that.previouBackupRecs);
                } else if (that.restoreBeforeLaunch) {
                    logger.record(1, 'Restoring previous incremental backups');
                    // 恢复增量备份
                    return that.backuper.restoreAll(that.previouBackupRecs)
                        // 恢复后删除增量备份记录
                        .then(res => that.backuper.discardRecords(that.previouBackupRecs))
                }
            }
            return Promise.resolve(); // 跳过
        }).then(res => {
            // 压缩包大小记录部分
            return new Promise((resolve, reject) => {
                // check_packed_server_size>0，说明要检查
                // 另外，如果是维护模式，则不检查压缩包大小
                if (!that.maintain && checkPackedSize > 0) {
                    // 计算服务器启动目录
                    let dirSize = utils.calcDirSize(packedServerDir);
                    // 如果扫描出来发现是空目录
                    if (dirSize === 0) {
                        // 错误：扫描不到压缩包
                        reject('Packed server directory is empty!');
                        return;
                    }
                    // 将扫描出来的压缩包大小写入状态文件
                    status.setVal('previous_packed_size', dirSize);
                }
                // 就算是维护模式，也要清除packedServerDir目录
                utils.clearDir(packedServerDir) // 清空目录
                    .catch(err => {
                        logger.record(2, `Failed to clear packed server directory: ${err}`);
                    });
                resolve();
            });
        }).then(res => {
            // 启动Minecraft服务器
            return utils.execScripts(that.launchScript, that.execEnv, that.execDir);
        }).then(res => {
            utils.showMemUsage();
            return Promise.resolve(false);
        });
    }
    /**
     * 等待服务器启动
     * @param {Boolean} resume 是否是恢复模式
     * @returns {Promise}
     * @note 实例端重启后如果有部署锁，会以resume=true的方式进入这个函数，如果服务器未启动，会重新尝试启动
     */
    waiter(resume = false) {
        // Minecraft服务器启动超时时间
        let launchTimeout = this.configs['mc_server_launch_timeout'],
            that = this;
        status.update(2203); // 设置状态码为2203，表示正在等待Minecraft服务器启动
        return new Promise((resolve, reject) => {
            // 等待Minecraft服务器启动，轮询间隔为10s
            const interval = 6000;
            let spend = 0, // 花费的时间
                timer = setInterval(() => {
                    spend += interval;
                    console.log('Pinging Minecraft Server');
                    ping({
                        host: '127.0.0.1',
                        port: 25565
                    }).then(result => { // ping到服务器，表示服务器已经启动
                        clearInterval(timer); // 停止轮询
                        resolve(); // 进入下一个流程
                    }).catch(err => {
                        // 这里clearInterval必须分开写，err只是代表本次ping失败，还要继续ping下去
                        if (spend >= launchTimeout) { // 超时
                            clearInterval(timer); // 停止轮询
                            reject('Minecraft Server launch timeout!');
                        } else if (resume) {
                            clearInterval(timer); // 停止轮询
                            utils.lockDeploy(false); // 解锁部署
                            resolve(that.deploy()); // 尝试重新部署服务器
                        }
                    });
                }, interval);
        })
    }
    /**
     * 执行serverScripts脚本进行检查
     * @param {String} script serverScripts中的脚本路径对应的键
     * @returns {Promise} 如果脚本什么都没有返回会resolve(false)，否则resolve(true)。执行失败会reject
     */
    scriptCheck(scriptKey = '') {
        let scriptPath = this.serverScripts[scriptKey];
        return utils.execScripts(scriptPath, this.execEnv, this.execDir, false)
            .then(stdouts => {
                // 如果脚本执行没有输出任何内容，则resolve false
                if (/^\s*$/.test(stdouts[0])) {
                    return Promise.resolve(false);
                }
                return Promise.resolve(true);
            }).catch(err => {
                let errMsg = `Error occured during the execution of script "${scriptPath}": ${err} `;
                return Promise.reject(errMsg);
            });
    }
    /**
     * Minecraft服务器运行监视部分
     * @returns {Promise}
     */
    monitor() {
        console.log('Server Successfully Deployed!');
        status.update(2300); // 设置状态码为2300，表示服务器成功部署
        // 开启RCON连接
        rcon.make(this.rconConfigs['port'], this.rconConfigs['password']);
        let {
            server_idling_timeout: maxIdlingTime, // 服务器最长空闲时间
            player_login_reset_timeout: resetTimeAfterLogin // 玩家离开后重置时间
        } = this.configs;
        let {
            interval: backupInterval // 多长时间进行一次增量备份
        } = this.configs['incremental_backup'],
            that = this;
        let idlingTime = 0, // 服务器空闲时间(ms)
            timeToBackup = 0; // 增量备份相关计时器(ms)
        let idlingCounter = null,
            playerMonitor,
            processMonitor,
            terminationMonitor,
            idlingTimeSyncer,
            backupTimer;
        return new Promise((resolve, reject) => {
            if (!that.maintain) { // 维护模式下不监视服务器
                let calcTimeLeft = (time) => { // 计算剩余时间
                    return Math.floor((maxIdlingTime - time) / 1000);
                },
                    counterFunc = () => { // 闲置时间计时器
                        idlingTime += 1000;
                        if (idlingTime >= maxIdlingTime) {
                            status.setVal('idling_time_left', -1); // 更新服务器剩余闲置时间
                            // 进入接下来的关服流程
                            resolve({
                                reason: 'Minecraft Server idle for too long.',
                                stop: true,
                                urgent: false
                            });
                        } else {
                            status.setVal('idling_time_left', calcTimeLeft(idlingTime)); // 更新服务器剩余闲置时间
                        }
                    };
                // 服务器空闲时间计时器，闲置时间过长就关服
                idlingCounter = setInterval(counterFunc, 1000);
                // 将服务器剩余闲置时间同步到主控端
                idlingTimeSyncer = setInterval(() => {
                    wsSender.send({
                        'action': 'idling_time_left',
                        'time': calcTimeLeft(idlingTime)
                    });
                }, 5000);
                // 监视Java进程(轮询周期5秒)
                processMonitor = setInterval(() => {
                    that.scriptCheck('check_process').then(exists => {
                        // 服务器进程不存在，进入关服流程
                        if (!exists) {
                            resolve({
                                reason: 'The server was closed (process went away)',
                                stop: false,
                                urgent: false
                            });
                        }
                    }).catch(err => {
                        console.warn(err);
                        logger.record(2, err);
                    });
                }, 5000);
                // 检查竞价实例是否被回收(轮询周期6秒)
                terminationMonitor = setInterval(() => {
                    that.scriptCheck('check_termination').then(safe => {
                        if (!safe) {
                            // 实例即将被回收，紧急进入关服流程
                            resolve({
                                reason: 'The Instance WILL BE TERMINATED!',
                                stop: true,
                                urgent: true // 紧急情况
                            });
                        }
                    }).catch(err => {
                        console.warn(err);
                        logger.record(2, err);
                    });
                }, 6000);
                // 有玩家上线，暂停闲置时间计时器
                utils.serverEvents.on('playerexists', () => {
                    clearInterval(idlingCounter); // 停止倒计时
                    idlingCounter = null;
                    // 如果配置了有玩家登录就重置倒计时
                    if (resetTimeAfterLogin) {
                        idlingTime = 0; // 重置闲置时间
                        status.setVal('idling_time_left', calcTimeLeft(idlingTime)); // 更新服务器剩余闲置时间
                    }
                })
                // 无玩家在线，启动闲置时间计时器
                utils.serverEvents.on('noplayer', () => {
                    // 没有玩家了，就继续倒计时
                    idlingCounter = setInterval(counterFunc, 1000);
                });
            }
            // 如果开启了增量备份
            if (that.backupEnabled) {
                // 每一秒倒计时一次
                backupTimer = setInterval(() => {
                    timeToBackup += 1000;
                    if (timeToBackup >= backupInterval) {
                        timeToBackup = 0;
                        // 开始一次增量备份
                        rcon.send('save-all') // 先保存服务器数据
                            .then(res => that.backuper.make())
                            .then(res => {
                                logger.record(1, 'Successfully made an incremental backup.');
                            }).catch(err => {
                                logger.record(2, `Failed to make an incremental backup:${err}`);
                            })
                    }
                }, 1000);
            }
            // 接受用户关闭服务器请求
            utils.serverEvents.once('stop', () => {
                resolve({
                    reason: 'The server was closed by operator.',
                    stop: true,
                    urgent: false
                });
            });
            // 接受用户杀死服务器请求
            utils.serverEvents.once('kill', () => {
                resolve({
                    reason: 'The server was killed by operator.',
                    stop: false, // 实际上就是不管服务器进程了，直接开始打包
                    urgent: false
                });
            });
            // 玩家人数监视器（轮询周期10秒）
            playerMonitor = setInterval(() => {
                ping({
                    host: '127.0.0.1',
                    port: 25565
                }).then(result => {
                    let playersOnline = result.players['online'],
                        playersMax = result.players['max'];
                    if (idlingCounter !== null && playersOnline > 0) {
                        // 有玩家在线，且闲置时间计时器还在
                        utils.serverEvents.emit('playerexists');
                    } else if (idlingCounter === null) {
                        // 无玩家在线，且还没有闲置计时器
                        utils.serverEvents.emit('noplayer');
                    }
                    // 回传玩家人数
                    wsSender.send({
                        'action': 'players_num',
                        'online': playersOnline,
                        'max': playersMax
                    });
                }).catch(err => 'nothing');
            }, 10000);
        }).then(result => {
            // 清理工作
            clearInterval(idlingCounter); // 停止计时器
            clearInterval(processMonitor);
            clearInterval(terminationMonitor);
            clearInterval(playerMonitor);
            clearInterval(idlingTimeSyncer);
            clearInterval(backupTimer);
            return Promise.resolve(result); // result:{reason,stop,urgent}
        })
    }

    /**
     * 关闭Minecraft服务器
     * @param {Object} options 由monitor()传入的对象，包括reason,stop,urgent
     * @returns {Promise}
     */
    stopServer(options) {
        let { stop } = options, // 是否需要执行关服脚本
            that = this;
        if (!stop) {
            // 如果stop=false，往往代表服务器已经关闭（或者被Kill），无需再执行关服脚本
            return Promise.resolve(options);
        }
        let timer;
        // 更新状态：服务器正准备关闭-关闭Minecraft服务器中
        status.update(2400);
        // 通过rcon关闭服务器
        rcon.send('stop');
        // 检查Minecraft服务器进程是否结束(轮询周期2s)
        return new Promise((resolve, reject) => {
            timer = setInterval(() => {
                that.scriptCheck('check_process').then(exists => {
                    if (!exists) {
                        // 服务器已经关闭，进入下一流程
                        clearInterval(timer);
                        resolve(options);
                    }
                }).catch(err => {
                    console.warn(err);
                    logger.record(2, err);
                });
            }, 2000);
        });
    }

    /**
     * Minecraft服务器关闭，压缩打包并上传
     * @param {Object} options 由monitor()传入的对象，包括reason,stop,urgent
     * @returns {Promise}
     * @note reason - Minecraft服务器关闭原因
     * @note urgent - 是否紧急，紧急情况一般是竞价实例被回收
     * @note 紧急情况下会立刻进行一次增量备份并上传，普通情况会压缩整个Minecraft服务器目录并上传
     */
    packAndUpload(options) {
        let {
            packed_server_dir: packedServerDir, // 压缩包目录
            check_packed_server_size: checkPackedSize// 检查压缩包大小百分比
        } = this.configs;
        let { reason, urgent } = options,
            that = this;
        status.update(2401); // 更新状态：服务器正准备关闭-打包中
        logger.record(1, `Server closing: ${reason}`); // 报告给主控端
        // 如果没有开启备份，无法进入紧急模式
        if (!urgent || !this.backupEnabled) {
            // 普通情况下的关服
            // 执行压缩打包脚本
            logger.record(1, `Normally packing up the server...`);
            return utils.execScripts(this.endingScripts['pack'], this.execEnv, this.execDir)
                .then(stdouts => {
                    return new Promise((resolve, reject) => {
                        // 非维护模式，且配置了check_packed_server_size
                        if (!that.maintain && checkPackedSize > 0) {
                            // 计算当前压缩包目录的大小
                            let packDirSize = utils.calcDirSize(packedServerDir),
                                // 获得部署时的压缩包目录大小
                                previousPackSize = status.getVal('previous_packed_size');
                            if (packDirSize < previousPackSize * (0.01 * checkPackedSize)) {
                                // 压缩包目录的大小小于部署时大小的checkPackedSize%，这个时候肯定出现了问题，终止打包
                                reject('There\'s something wrong with the compressed packs of Minecraft Server, please check it.');
                                return;
                            }
                        }
                        resolve();
                    });
                }).then(res => {
                    status.update(2402); // 更新状态：服务器正准备关闭-上传中
                    // 压缩包没有问题，开始上传
                    return utils.execScripts(that.endingScripts['upload'], that.execEnv, that.execDir);
                }).then(res => {
                    // 清理增量备份记录，因为此时整个服务器端全部上传到了云储存，增量备份没用了
                    let backupRecords = that.backuper.getRecords();
                    if (backupRecords) {
                        // 只有在有增量备份记录的情况下才清理
                        return that.backuper.discardRecords(backupRecords);
                    } else {
                        return Promise.resolve();
                    }
                });
        } else {
            // 紧急情况下，进行增量备份并上传
            logger.record(1, `Urgently uploading the server...`);
            return that.backuper.make();
        }
    }

    /**
     * 服务器关闭，结束本次流程
     */
    terminate() {
        status.update(2500); // 更新状态：实例端中止
        // 向主控端发送告别指令，主控端将断开连接
        wsSender.goodbye();
    }
}

module.exports = Server;