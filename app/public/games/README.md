# Qbao 游戏空间（附属静态站点）

本目录是 Qbao 的附属休闲站点，由 Vite 原样拷入构建产物（`app/dist/games/`），经 nginx 静态托管。
与 Qbao 主站同源共享登录状态（网页端 localStorage 会话 / 桌面端子窗口 preload 桥），
游戏数据按账号隔离保存在服务端 `user_games_stats` 表（见 docs/GAMES.md）。

## 目录

| 目录 | 游戏 | 上游仓库 | 许可 | commit |
| ---- | ---- | -------- | ---- | ------ |
| `2048/` | 2048 | gabrielecirulli/2048 | MIT | 478b6ec |
| `froggy/` | Flexbox Froggy | thomaspark/flexboxfroggy | MIT | 9a6feab |
| `gridgarden/` | Grid Garden | thomaspark/gridgarden | MIT | 0e262f7 |
| `tetris/` | 俄罗斯方块 | jakesgordon/javascript-tetris | MIT | e5c0c42 |
| `werewolf/` | 狼人杀（网页版多人联机） | xiong35/werewolf | MIT | 26a77c0 |
| `marble/` | 弹猪乐（单球弹珠机 · 微信小游戏 Web 移植） | anshang1766/marble-wx-game | 个人授权 | 71f43f9 |
| `common/` | 共享库（jquery / animate.css / qbao-hook.js） | 随 gridgarden 上游提交 | MIT / Apache-2.0 | — |

## 引入与修改纪律

- 每个游戏目录保留上游 `LICENSE` 原文与 `SOURCE.md`（含精确 commit 与本地改动清单）。
- 三类本地改动，全部记录在 SOURCE.md：
  1. 剔除外部依赖：广告脚本（Adsbygoogle）、Google Analytics、Google Fonts、站外推荐图。
  2. 资产路径本地化：`node_modules/…` → `../common/…`；删除指向未引入文件的引用。
  3. 成绩钩子：游戏结束/过关处调用 `window.__qbaoGame.report(...)`（实现见 `common/qbao-hook.js`）。
- 更新上游 = 重新按上述清单引入并更新 SOURCE.md，禁止随手覆盖。

## 隐私与安全

- 单机游戏运行时无任何外部网络请求（全部静态自托管）；无广告、无统计。
- 狼人杀为唯一联机游戏：本目录存放其前端构建产物（指向自身房间服务）；后端服务与源码见仓库 `party/werewolf/`（systemd `qbao-werewolf`，端口 3011，nginx 子路径 `/games/werewolf/`）。
- 弹猪乐（marble/）为唯一带「云端钱包」的游戏：登录账号的弹珠/皮肤/积分兑换走服务端 /api/v1/games/marble/*（服务端权威，防本地篡改/重置刷）；游客回退本地模式。详见 docs/GAMES.md。
- `common/qbao-hook.js` 仅读取登录凭据并上报成绩，不写不删 localStorage。
- 桌面端仅经既有 `qbao:secret-load` IPC 通道读取令牌，不新增密钥面。

> 目录 README 同时面向公开仓库访问者：托管内容均为上游 MIT 许可项目，本处保留署名。
> 弹猪乐例外：其上游仓库暂无 LICENSE 文件，经作者 anshang1766 个人授权引入（详见 `marble/SOURCE.md`）。