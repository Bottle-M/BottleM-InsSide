'use strict';
const configs = require('./basic/configs-recv');
const { WebSocketServer } = require('ws');
// 记录连接的客户端，仅允许一条连接存在
const wsConns = [];
// 创建WebSocket服务器
const wsServer = new WebSocketServer({
    port: configs.getConfigs('ws_port')
});

wsServer.on('connection', (ws) => {
    if (wsConns.length > 0) {
        // 只允许同时存在一个连接
        wsConns.forEach((conn) => {
            conn.close(1000, 'Another connection exists');
        })
        wsConns.length = 0; // 清空数组
    }
    wsConns.push(ws); // 将连接存入数组
    ws.send('HELLO');
    ws.on('message', (message) => {
        console.log(`Received message => ${message}`);
    }).on('close', () => {
        console.log('Connection closed');
    });
});