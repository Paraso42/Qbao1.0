# party/werewolf — 狼人杀（xiong35/werewolf 开源 fork）

Qbao 游戏大厅的网页版多人狼人杀。上游 [xiong35/werewolf](https://github.com/xiong35/werewolf)（MIT），
本 fork 基于上游 commit `26a77c0`（2022-05-27），生产已部署，全部本地修改见各目录内注释与
`app/public/games/werewolf/SOURCE.md`。

## 目录

| 路径 | 内容 |
| ---- | ---- |
| `werewolf-backend/` | 后端源码（Koa + socket.io，TypeScript） |
| `werewolf-frontend/` | 前端源码（Vue 3 SFC；构建产物在 `app/public/games/werewolf/`） |
| `deploy/` | 生产部署资产：systemd 单元、nginx 片段、部署手册 |
| `LICENSE` | 上游 MIT 许可原文 |

## 架构（生产）

- 入口 `/games/werewolf/`（nginx 静态 + 子路径 SPA 回退）
- HTTP API `/games/werewolf/api/*` → nginx 剥前缀 → `127.0.0.1:3011`
- WebSocket `/games/werewolf/werewolf-ws/*` → `127.0.0.1:3011` 原样透传
- systemd 单元 `qbao-werewolf`（User=root，WorkingDirectory={PROD_ROOT}/party/werewolf，{PROD_ROOT} 真实值见 local/ENV.md）
- 数据仅存服务端内存：房间 6 位号、12 小时自动清理、重启清零；不落库、不接账号、不写成绩。

## 本地修改清单（相对上游 commit）

见 `app/public/games/werewolf/SOURCE.md`（同一份清单）：
1. 同源子路径接线（shared/constants.ts + 后端 io path + 前端 socket 同源）
2. 运行时资源前缀 `GAME_BASE`（9 个 SFC + QR logo）
3. 全中文界面（第N天/秒等）
4. 构建链现代化：Vite 5 + @vitejs/plugin-vue 5 + sass 1；TS 4.9 + esModuleInterop + skipLibCheck；
   依赖钉上游大版本（koa@2、@koa/cors@3、koa-body@4、koa-logger@3、koa-router@10、socket.io@4）
5. `CLIENT_BASE_URL` 运行时同源（二维码加入链接随部署域名自动正确）

## 本地重建

```bash
# 后端
cd werewolf-backend && npm install && npm run build   # 产物 werewolf-backend/dist/（tsc）
# 前端
cd werewolf-frontend && npm install && npm run build  # 产物 werewolf-frontend/dist/
```

> 说明：开发环境依赖经由 ChatECNU Work 的 dependency_install 安装（npm 直装被沙箱重定向），
> node_modules 与 dist 不入库。生产运行依赖为「运行时闭包」（koa 栈传递依赖，纯 JS）打包部署。

## 部署（生产：https://{DOMAIN}（Cloudflare 边缘 → 香港 Caddy），回源大陆 {ORIGIN_IP}）

1. `deploy/qbao-werewolf.service` → `/etc/systemd/system/`，`systemctl daemon-reload && systemctl enable --now qbao-werewolf`
2. 后端：`werewolf-backend/dist`（含 `werewolf-frontend/shared` 编译副本）→ `{PROD_ROOT}/party/werewolf/dist`
3. 运行时闭包 `node_modules` → `{PROD_ROOT}/party/werewolf/node_modules`
4. 前端 `werewolf-frontend/dist` → `{PROD_ROOT}/app/games/werewolf/`
5. nginx：`deploy/nginx-werewolf-locations.conf` 三段插入 `sites-available/qbao`，`nginx -t && systemctl reload nginx`
6. 验证：静态页 200、`POST /games/werewolf/api/room/create` 返回房间号、WS 握手返回 sid。

详见 `deploy/DEPLOY.md` 与 docs/GAMES.md 第四节。
