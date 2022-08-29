// 服务器部署/监控部分
'use strict';
const { ping } = require('minecraft-protocol');
const path = require('path');
const utils = require('./utils');
const configs = require('./configs-recv');
const status = require('./status-handler');
const logger = require('./logger');
const { exec } = require('child_process');

/**
 * 开始部署服务器
 * @returns {Promise}
 */
function deploy() {
    if (utils.deployed()) {
        // 如果已经部署了，先查询服务器是否正常启动
        // 这种情况一般是实例端意外重启，需要恢复服务器的状态
        return ping({
            host: '127.0.0.1',
            port: 25565
        }).then(result => {
            return Promise.resolve(); // 直接进入下一个流程
        }).catch(err => {
            // 服务器未启动，需要重新部署
            utils.lockDeploy(false); // 解除部署锁
            return deploy();
        });
    }
    // 如果尚未部署Minecraft服务器，则开始
    let {
        remote_dir: dataDir, // 数据目录
        deploy_scripts: deployScripts, // 部署脚本
        env: environment, // 环境变量
        script_exec_dir: execDir, // 脚本执行所在目录
        mc_server_launch_timeout: launchTimeout, // Minecraft服务器启动超时时间
        packed_server_dir,
        mc_server_dir,
    } = configs.getConfigs();
    let tasks = []; // 任务队列
    logger.record(1, 'Start to execute deploy scripts for Minecraft Server...'); // 记录日志
    status.set(2202); // 设置状态码为2202，表示正在部署服务器
    utils.lockDeploy(true); // 锁定部署，防止重复部署
    // 检查目录是否存在
    utils.dirCheck(execDir);
    utils.dirCheck(packed_server_dir);
    utils.dirCheck(mc_server_dir);
    return new Promise((resolve, reject) => {
        for (let i = 0, len = deployScripts.length; i < len; i++) {
            let absPath = path.join(dataDir, deployScripts[i]); // 获得脚本的绝对路径
            tasks.push(() => new Promise((res, rej) => {
                console.log(`Executing: ${absPath}`);
                exec(absPath, {
                    cwd: execDir, // 执行脚本的目录
                    env: environment,
                    shell: '/bin/bash', // 指定bash解释器
                    encoding: 'utf-8'
                }, (err, stdout, stderr) => {
                    if (err) {
                        rej(err + '\nSTDOUT:' + stdout + '\nSTDERR:' + stderr); // 错误留给上层处理
                    } else {
                        console.log(`stdout: ${stdout}\nstderr: ${stderr}\n\n`);
                        res();
                    }
                })
            })
            );
        }
        // 逐个完成任务
        let finishTask = (index) => {
            return tasks[index]().then(res => {
                if (index < tasks.length - 1) {
                    finishTask(index + 1);
                } else {
                    return Promise.resolve();
                }
            })
        };
        finishTask(0).then(success => {
            resolve();
        }).catch(e => {
            reject(e);
        });
    }).then(res => {
        return new Promise((resolve, reject) => {
            // 等待Minecraft服务器启动，轮询间隔为10s
            const interval = 10000;
            let spend = 0, // 花费的时间
                timer = setInterval(() => {
                    spend += interval;
                    ping({
                        host: '127.0.0.1',
                        port: 25565
                    }).then(result => { // ping到服务器，表示服务器已经启动
                        clearInterval(timer); // 停止轮询
                        resolve(); // 进入下一个流程
                    }).catch(err => {
                        if (spend >= launchTimeout) { // 超时
                            clearInterval(timer); // 停止轮询
                            reject('Minecraft Server launch timeout!');
                        }
                    });
                }, interval);
        })
    });
}

/**
 * 服务器监视器
 * @param {Boolean} maintain 是否是维护模式
 * @returns {Promise}
 */
function monitor(maintain = false) {
    status.set(2300); // 设置状态码为2300，表示服务器成功部署
    let {
        server_idling_timeout: maxIdlingTime, // 服务器最长空闲时间
        player_leaver_reset_timeout: resetTimeAfterLeave // 玩家离开后重置时间
    } = configs.getConfigs();
    let idlingTime = 0; // 服务器空闲时间(ms)
    return new Promise((resolve, reject) => {
        // 服务器空闲时间计时器
        let counter = setInterval(() => {
            idlingTime += 1000;
            if (idlingTime >= maxIdlingTime) {
                clearInterval(counter); // 停止计时器
                // 进入接下来的关服流程
                resolve('Minecraft Server idle for too long.');
            }
        }, 1000);
    });
}

/**
 * 服务器启动入口
 * @param {Boolean} maintain 是否是维护模式
 * @note 维护模式下，服务器启动后不会受到监控（不会自动关闭）
 */
function setup(maintain = false) {
    deploy()
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