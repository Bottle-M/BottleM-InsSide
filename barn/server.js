// 服务器部署/监控部分
'use strict';
const configs = require('./barn/configs-recv');
const status = require('./status-handler');
const logger = require('./logger');
const { exec } = require('child_process');

/**
 * 开始部署服务器
 * @returns {Promise}
 */
function deploy() {
    let {
        remote_dir: dataDir, // 数据目录
        deploy_scripts: deployScripts, // 部署脚本
        env: environment, // 环境变量
        script_exec_dir: execDir // 脚本执行所在目录
    } = configs.getConfigs();
    let tasks = []; // 任务队列
    status.set(2202); // 设置状态码为2202，表示正在部署服务器
    return new Promise((resolve, reject) => {
        for (let i = 0, len = deployScripts.length; i < len; i++) {
            let absPath = path.join(dataDir, deployScripts[i]); // 获得脚本的绝对路径
            tasks.push(new Promise((res, rej) => {
                exec(absPath, {
                    cwd: execDir, // 执行脚本的目录
                    env: environment,
                    shell: '/bin/bash', // 指定bash解释器
                    encoding: 'utf-8'
                }, (err, stdout, stderr) => {
                    if (err) {
                        rej(err);
                    } else {
                        console.log(`Exec: ${absPath}`);
                        console.log(`stdout: ${stdout}\nstderr: ${stderr}\n\n`);
                        res();
                    }
                })
            }));
        }
        Promise.all(tasks).then(success => {
            resolve();
        }).catch(e => {
            reject(e);
        });
    });
}

/**
 * 服务器启动入口
 */
function setup() {
    deploy()
        .catch(err => { // 错误处理
            // 通过logger模块提醒主控端，这边发生了错误！
            logger.record(3, err, true);
        })
}

module.exports = {
    setup
}