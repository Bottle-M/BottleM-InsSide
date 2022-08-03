'use strict';
const configs = require('./basic/configs-recv');
const { WebSocketServer } = require('ws');
const wsPort = configs.getConfigs('ws_port');
// 创建WebSocket服务器
const wsServer = new WebSocketServer({
    port: wsPort
});
// WebSocket心跳处理
const wsBeat = () => {
    if (this.authorized) // 前提：连接已经通过认证
        this.connAlive = true; // 标记连接正常
}
// 记录通过验证的客户端连接，只允许存在一个验证通过的连接
var authedConn = null;

wsServer.on('connection', (ws) => {
    ws.connAlive = true; // 新连接默认都是正常的
    // 还没有验证通过的连接
    if (!authedConn) {
        ws.on('message', (message) => {
            let parsed = JSON.parse(message),
                secret = configs.getConfigs('secret_key');
            // 每条通信都必须要经过密匙验证
            if (!secret || parsed['key'] !== secret) {
                this.authorized = false; // 认证不通过
                return this.close(1000, 'Nanomachine, son.'); // 关闭连接
            }
            this.authorized = true; // 通过认证
            authedConn = this; // 记录认证连接
            console.log(`Received message => ${message}`);
        }).on('close', () => {
            console.log('Connection closed');
        }).on('pong', wsBeat); // 接受心跳（pong是为响应ping而自动发送的）
    } else { // 已经有验证通过的连接了，直接关闭
        ws.connAlive = false; // 连接非存活
        ws.close(1000, 'Valid connection already exists');
    }
});

const beatInterval = setInterval(() => {
    if (!authedConn.connAlive) // 如果验证通过的连接已经死了
        authedConn = null; // 重置为null
    wsServer.clients.forEach((ws) => {
        if (!ws.connAlive) { // 连接非存活
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

console.log(`WebSocket server started on port ${wsPort}`);