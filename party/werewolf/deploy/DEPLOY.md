# 部署手册（生产）

> 占位符：{DOMAIN}/{ORIGIN_IP}/{PROD_ROOT} 的真实值仅存本地 local/ENV.md，公开仓库不展示；执行前先替换。

实机记录：2026-09-07 首次部署（源站 {ORIGIN_IP}）；同日公网域名接入
https://{DOMAIN}（Cloudflare 边缘 → 香港 Caddy 中继 → 大陆源站），
前端按运行时同源重建（CLIENT_BASE_URL 不再硬编码公网地址）。

## 步骤

1. 前端 `vite build`（base=/games/werewolf/，CLIENT_BASE_URL=公网地址）→ tar -C dist .
2. 后端 `tsc -p werewolf-backend`（rootDir 推断为仓库根，保持 dist/werewolf-backend 与 dist/werewolf-frontend 结构）→ tar -C werewolf-backend/dist .
3. 运行时闭包：从安装环境提取 koa 栈传递依赖（纯 JS）→ 与后端 dist 一起解到 {PROD_ROOT}/party/werewolf/。
4. systemd 单元 + nginx 三段 location（本目录两文件），nginx -t 通过后 reload。
5. 前端产物解到 {PROD_ROOT}/app/games/werewolf/（nginx 静态直出）。

## 历史坑（勿重蹈）

- tar 打包必须用 `-C <dir> .`（成员以 ./ 开头），远端直接解包；裸路径 + --strip-components 会毁目录结构。
- nginx API 前缀 location 必须写成 `^~ /games/werewolf/api/`（带尾斜杠），否则剩余路径多一个 / 变成 `//room/create`，koa 返回空 200。
- eol：远端执行本地脚本前先 `tr -d '\r'`。
- 构建期注意：@types/node 用 18/20（新版 FFI 类型需新 TS）；koa-body 最新 v6 依赖 zod（TS5.5 语法），钉 @koa/cors@3 等上游大版本。
