# 弹猪乐 Web 移植手册（可复现）

上游：https://github.com/anshang1766/marble-wx-game（微信小游戏；本目录为只读镜像 HEAD 71f43f9，无 LICENSE，个人授权引入 Qbao）。

## 移植步骤（上游新版本/重装时）

1. 备份并复制上游入口文件到 Web 产物目录：
   ```
   copy game.js matter.js -> app/public/games/marble/
   ```
   （webwx.js / index.html 非上游文件，保留不动；matter.js 通常不变）
2. 跑补丁（按顺序，每个都必须输出 ok；出现 MISS/AMBIG 即上游改动过对应段落，需人工适配）：
   ```
   node patch-marble-game-v2.cjs     # 12 处外科补丁（matter/云桥/saved/seed/randomize/押珠扣除/结算/showFree/商城/余额行/积分区/启动等待）
   node fix-marble-balance2.cjs      # 修复商城余额行（若 v2 输出 line:balance ok 则本步可跳过）
   node wrap-marble.cjs              # 全文件 IIFE 包装（规避 window.top 冲突）
   ```
3. 校验：
   ```
   node --check app/public/games/marble/game.js app/public/games/marble/webwx.js
   ```
4. 冒烟：本地静态托管后打开 `/games/marble/index.html?qa=1`，页面标题依次出现 QA|bet5→confirm→charge→launched 且无 ERR| 前缀；
   服务端 vitest 全量（server/test/marble.routes.test.js 22 例）通过后方可发布。

## 路径说明

- 补丁脚本内置绝对路径 `D:/Qbao/...`；仓库换目录时修改各脚本顶部 `const path`。
- 云存档契约（端点/字段）见仓库 docs/GAMES.md §五——改契约时必须同步本目录 webwx.js 与 server 侧。
