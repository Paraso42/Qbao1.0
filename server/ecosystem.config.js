// PM2 进程配置（参考）— 线上实例以 systemd 运行（模板 server/deploy/qbao-api.service），PM2 仅供自托管场景探索。
// script 按本文件所在目录解析，不依赖任何机器绝对路径（真实部署路径仅存 local/ENV.md，不公开）。
const path = require('path');

module.exports = {
  apps: [{
    name: 'qbao-api',
    script: path.join(__dirname, 'server.js'),
    instances: 1,
    max_memory_restart: '1500M',
    env: { NODE_ENV: 'production' }
  }]
};
