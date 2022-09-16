'use strict';
const { WebSocketServer } = require('ws');
const { refreshConfigs } = require('./barn/configs-recv');
const configs = require('./barn/configs-recv');
const router = require('./barn/router');
const WS_PORT = configs.getConfigs('ws_port');
const Deployment = require('./barn/server');
// 创建WebSocket服务器
const wsServer = new WebSocketServer({
    port: WS_PORT,
    clientTracking: true
});
// WebSocket心跳处理
const wsBeat = function () {
    console.log('pong');
    if (this.authorized)// 前提：连接已经通过认证
        this.connAlive = true; // 标记连接正常
}
// 记录通过验证的客户端连接，只允许存在一个验证通过的连接
var authedConn = null;

wsServer.on('connection', (ws) => {
    ws.connAlive = true; // 新连接默认都是正常的
    // 还没有验证通过的连接
    if (!authedConn) {
        refreshConfigs(); // 重读配置
        ws.on('message', (message) => {
            let parsed,
                secret = configs.getConfigs('secret_key');
            try { // 防止因为JSON.parse出错导致程序崩溃
                parsed = JSON.parse(message);
            } catch (e) {
                parsed = {};
            }
            // 每条通信都必须要经过密匙验证
            if (!secret || parsed['key'] !== secret) {
                return ws.close(1000, 'Nanoconnection, son.'); // 关闭连接
            }
            ws.authorized = true; // 通过认证
            authedConn = ws; // 记录认证连接
            router(parsed, ws); // 路由
        }).on('close', () => {
            if (ws.authorized) { // 关闭的连接是通过验证的
                ws.connAlive = false; // 标记连接已经死亡
                authedConn = null; // 清除认证连接
                console.log('Main connection destroyed');
            }
            console.log('Connection closed');
        }).on('pong', wsBeat.bind(ws)); // 接受心跳（pong是为响应ping而自动发送的）
    } else { // 已经有验证通过的连接了，直接关闭
        ws.connAlive = false; // 连接非存活
        ws.close(1000, 'Valid connection already exists');
    }
});

const beatInterval = setInterval(() => {
    if (authedConn && !authedConn.connAlive) // 如果验证通过的连接已经死了
        authedConn = null; // 重置为null
    wsServer.clients.forEach((ws) => { // 检测死亡连接
        if (!ws.connAlive) { // 连接非存活
            console.log('Cleared one dead connection.');
            return ws.terminate(); // 强制终止连接
        }
        ws.connAlive = false; // 标记连接非存活
        ws.ping(); // 发送心跳包
    });
}, configs.getConfigs('ws_ping_timeout'));

// ws服务关闭时清理
wsServer.on('close', () => {
    clearInterval(beatInterval);
});

// 创建Minecraft部署实例
const serverDeploy = new Deployment();

// 开始部署Minecraft服务器
serverDeploy.setup();

console.log(`WebSocket server started on port ${WS_PORT}`);
console.log('Starting to deploy Minecraft Server');