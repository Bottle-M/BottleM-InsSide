// 服务器部署/监控部分
'use strict';
const { ping } = require('minecraft-protocol');
const path = require('path');
const utils = require('./utils');
const configs = require('./configs-recv');
const status = require('./status-handler');
const logger = require('./logger');

/**
 * 开始部署服务器
 * @param {Boolean} maintain 是否是维护模式
 * @returns {Promise}
 */
function deploy(maintain = false) {
    if (utils.deployed()) {
        // 如果已经部署了，先查询服务器是否正常启动
        // 这种情况一般是实例端意外重启，需要恢复服务器的状态
        console.log('Resuming...');
        return Promise.resolve(true); // 直接进入下一个流程
    }
    // 如果尚未部署Minecraft服务器，则开始
    let {
        remote_dir: dataDir, // 数据目录
        deploy_scripts: deployScripts, // 部署脚本
        env: environment, // 环境变量
        script_exec_dir: execDir, // 脚本执行所在目录
        packed_server_dir: packedServerDir, // 压缩包目录
        check_packed_server_size: checkPackedSize, // 是否检查压缩包大小
        mc_server_dir
    } = configs.getConfigs();
    logger.record(1, 'Start to execute deploy scripts for Minecraft Server...'); // 记录日志
    status.update(2202); // 设置状态码为2202，表示正在部署服务器
    utils.lockDeploy(true); // 锁定部署，防止重复部署
    // 检查目录是否存在
    utils.dirCheck(execDir);
    utils.dirCheck(packedServerDir);
    utils.dirCheck(mc_server_dir);
    // 把每个脚本都转换成绝对路径
    deployScripts = deployScripts.map(script => path.join(dataDir, script));
    // 执行脚本
    return utils.execScripts(deployScripts, environment, execDir)
        .then(res => {
            // 压缩包大小记录部分
            return new Promise((resolve, reject) => {
                // check_packed_server_size>0，说明要检查
                // 另外，如果是维护模式，则不检查压缩包大小
                if (!maintain && checkPackedSize > 0) {
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
 * @param {Boolean} maintain 是否是维护模式
 * @returns {Promise}
 * @note 实例端重启后如果有部署锁，会以resume=true的方式进入这个函数，如果服务器未启动，会重新尝试启动
 */
function waiter(resume = false, maintain = false) {
    // Minecraft服务器启动超时时间
    let launchTimeout = configs.getConfigs('mc_server_launch_timeout');
    status.update(2203); // 设置状态码为2203，表示等待Minecraft服务器启动
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
                        resolve(deploy(maintain)); // 尝试重新部署服务器
                    }
                });
            }, interval);
    })
}

/**
 * 服务器监视器
 * @param {Boolean} maintain 是否是维护模式
 * @returns {Promise}
 */
function monitor(maintain = false) {
    console.log('Server Successfully Deployed!');
    status.update(2300); // 设置状态码为2300，表示服务器成功部署
    let {
        server_idling_timeout: maxIdlingTime, // 服务器最长空闲时间
        player_leaver_reset_timeout: resetTimeAfterLeave // 玩家离开后重置时间
    } = configs.getConfigs();
    let idlingTime = 0; // 服务器空闲时间(ms)
    return new Promise((resolve, reject) => {
        if (!maintain) { // 维护模式下不监视服务器
            // 服务器空闲时间计时器，闲置时间过长就关服
            let counter = setInterval(() => {
                let timeLeft = Math.floor((maxIdlingTime - idlingTime) / 1000);
                idlingTime += 1000;
                if (idlingTime >= maxIdlingTime) {
                    status.setVal('idling_time_left', -1); // 更新服务器剩余闲置时间
                    clearInterval(counter); // 停止计时器
                    // 进入接下来的关服流程
                    resolve('Minecraft Server idle for too long.');
                } else {
                    status.setVal('idling_time_left', timeLeft); // 更新服务器剩余闲置时间
                }
            }, 1000);
            // 
        }
        // 接受用户手动关服请求
    });
}

/**
 * 服务器启动入口
 * @param {Boolean} maintain 是否是维护模式
 * @note 维护模式下，服务器启动后不会受到监控（不会自动关闭）
 */
function setup(maintain = false) {
    utils.showMemUsage();
    deploy(maintain)
        .then(resume => waiter(resume, maintain)) // 等待Minecraft服务器启动
        .then(res => monitor(maintain)) // 部署成功后由monitor监视Minecraft服务器
        .catch(err => { // 错误处理
            // 通过logger模块提醒主控端，这边发生了错误！
            console.log(`Error occured: ${err}`);
            logger.record(3, err, true);
        })
}

module.exports = {
    setup
}