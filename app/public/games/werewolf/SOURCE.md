# SOURCE.md — werewolf（狼人杀）构建产物

- 上游仓库：https://github.com/xiong35/werewolf
- 上游 commit：26a77c0f7e4b7244b2f1d94d357e002ac8ada5a3（2022-05-27，main）
- 许可：MIT（Copyright (c) 2021 xiong35，见本目录 LICENSE）
- 本目录内容：**上游前端源码经本仓库定制构建后的产物**（Vite 5 build），
  源码 fork 与全部本地修改见仓库 `party/werewolf/werewolf-frontend/`。

## 本地定制修改清单（相对上游 26a77c0）

1. 部署接线改同源子路径 `/games/werewolf/`（`shared/constants.ts`）：
   - `SERVER_BASE_URL = GAME_BASE + "/api"`、`WS_PATH = GAME_BASE + "/werewolf-ws"`；
   - 后端 socket.io 监听完整前缀路径（`werewolf-backend/src/index.ts` 改用 `WS_PATH`）；
   - 前端 socket 改为同源 `io({ path: WS_PATH })`。
2. 运行时资源路径：所有模板/脚本中的 `/assets/...`、`/wolf.png` 改为 `GAME_BASE + ...` 前缀
   （9 个 SFC + QR logo）。
3. 全中文界面：对局顶部 `Day N` → `第N天`，秒数后缀 `S` → `秒`；favicon 改相对路径。
4. 构建链现代化（仅构建期）：前端 Vite 1 rc13 → **Vite 5 + @vitejs/plugin-vue 5 + sass 1**；
   后端 TypeScript 4.9（`skipLibCheck` + `esModuleInterop`），依赖钉上游大版本
   （koa@2 / @koa/cors@3 / koa-body@4 / koa-logger@3 / koa-router@10 / socket.io@4）。
5. 二维码加入链接（`CLIENT_BASE_URL`）指向生产站点公网地址。
6. 路由兜底（v2 修复）：路由表末尾追加 `/:pathMatch(.*)*` → 重定向首页。
   原因：直接访问 `/games/werewolf/index.html` 时 Vue Router 无匹配路由导致白屏；
   同时大厅入口统一用尾斜杠 URL `/games/werewolf/`。另修掉 viewport meta
   中 `user-scalable=0;` 的分号解析警告。

## 重建命令（在 party/werewolf 检出后）

```bash
# 前端（产物即本目录内容）
cd party/werewolf/werewolf-frontend && npm install && npm run build
cp -r dist/* ../../../app/public/games/werewolf/   # 或按部署手册执行

# 后端（服务端 dist）
cd party/werewolf/werewolf-backend && npm install && npm run build
```

详细部署手册：`party/werewolf/README.md` 与 `party/werewolf/deploy/`。
