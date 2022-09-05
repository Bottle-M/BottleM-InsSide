// 服务器部署/监控部分
'use strict';
const { ping } = require('minecraft-protocol');
const path = require('path');
const utils = require('./utils');
const configs = require('./configs-recv');
const status = require('./status-handler');
const logger = require('./logger');
const wsSender = require('./ws-sender');

class Server {
    /**
     * 构造Server实例
     * @param {Boolean} maintain 是否是维护模式
     */
    constructor(maintain = false) {
        let allConfigs = configs.getConfigs(),
            {
                remote_dir: dataDir,
                server_scripts: serverScripts,
                server_ending_scripts: endingScripts,
                script_exec_dir: execDir
            } = allConfigs;
        this.configs = allConfigs;
        this.maintain = maintain;
        // 脚本存放的目录
        this.dataDir = dataDir;
        // 脚本执行时的环境变量
        this.execEnv = allConfigs['env'];
        // 脚本执行所在目录
        this.execDir = execDir;
        // 处理部署脚本路径为绝对路径
        this.deployScripts = allConfigs['deploy_scripts'].map(script => path.join(dataDir, script));
        // 处理Minecraft服务器相关脚本为绝对路径
        this.serverScripts = new Object();
        for (let i in serverScripts)
            this.serverScripts[i] = path.join(dataDir, serverScripts[i]);
        // 处理服务关闭后脚本为绝对路径
        this.endingScripts = new Object();
        for (let i in endingScripts)
            this.endingScripts[i] = path.join(dataDir, endingScripts[i]);
        // 检查目录是否存在
        utils.dirCheck(execDir);
    }
    /**
     * 服务器启动入口
     * @note 维护模式下，服务器启动后不会受到监控（不会自动关闭）
     */
    setup() {
        let that = this;
        console.log('Starting to deploy Minecraft Server');
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
        return utils.execScripts(this.deployScripts, this.execEnv, this.execDir)
            .then(res => {
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
                        utils.clearDir(packedServerDir); // 清空目录
                    }
                    resolve();
                });
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
     * Minecraft服务器进程检查
     * @returns {Promise} 进程存在会resolve(true)，否则resolve(false)。执行失败会reject
     */
    processCheck() {
        return utils.execScripts(this.serverScripts['check_process'], this.execEnv, this.execDir)
            .then(stdouts => {
                // 如果脚本执行没有输出任何内容，则表示服务器进程已经消失
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
        let {
            server_idling_timeout: maxIdlingTime, // 服务器最长空闲时间
            player_login_reset_timeout: resetTimeAfterLogin // 玩家离开后重置时间
        } = this.configs,
            that = this;
        let idlingTime = 0; // 服务器空闲时间(ms)
        let counter, playerMonitor, processMonitor, terminationMonitor;

        // 增量备份

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
                counter = setInterval(counterFunc, 1000);
                // 玩家人数监视器（轮询周期10秒）
                playerMonitor = setInterval(() => {
                    ping({
                        host: '127.0.0.1',
                        port: 25565
                    }).then(result => {
                        let playersOnline = result.players['online'],
                            playersMax = result.players['max'];
                        if (playersOnline > 0) { // 有玩家在线
                            clearInterval(counter); // 停止倒计时
                            counter = null;
                            // 如果配置了有玩家登录就重置倒计时
                            if (resetTimeAfterLogin) {
                                idlingTime = 0; // 重置闲置时间
                                status.setVal('idling_time_left', calcTimeLeft(idlingTime)); // 更新服务器剩余闲置时间
                            }
                        } else if (counter === null) {
                            // 没有玩家了，就继续倒计时
                            counter = setInterval(counterFunc, 1000);
                        }
                        // 回传玩家人数
                        wsSender.send({
                            'action': 'players_num',
                            'online': playersOnline,
                            'max': playersMax
                        });
                    }).catch(err => 'nothing');
                }, 10000);
                // 监视Java进程(轮询周期5秒)
                processMonitor = setInterval(() => {
                    that.processCheck().then(exists => {
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

                }, 6000);
            }

            // 接受用户手动关服请求

        }).then(result => {
            // 清理工作
            clearInterval(counter); // 停止计时器
            clearInterval(processMonitor);
            clearInterval(terminationMonitor);
            clearInterval(playerMonitor);
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
            // 如果stop=false，往往代表服务器已经关闭，无需再执行关服脚本
            return Promise.resolve(options);
        }
        let timer;
        return utils.execScripts(this.serverScripts['stop_server'], this.execEnv, this.execDir)
            .then(stdouts => {
                // 更新状态：服务器正准备关闭-关闭Minecraft服务器中
                status.update(2400);
                // 检查Minecraft服务器进程是否结束(轮询周期2s)
                return new Promise((resolve, reject) => {
                    timer = setInterval(() => {
                        that.processCheck().then(exists => {
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
            }).catch(err => {
                return Promise.reject(err);
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
        if (!urgent) {
            // 普通情况下的关服
            // 执行压缩打包脚本
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
                });
        }
    }

    /**
     * 服务器关闭，结束本次流程
     */
    terminate() {
        // 向主控端发送告别指令，主控端将断开连接
        wsSender.goodbye();
    }
}

module.exports = Server;