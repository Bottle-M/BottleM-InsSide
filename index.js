'use strict';
const configs = require('./basic/configs-recv');
const { WebSocketServer } = require('ws');
const wsServer = new WebSocketServer({
    port: configs.getConfigs('ws_port')
})