# Qbao 游戏空间（v3.38）

游戏门户是 Qbao 的**附属静态站点**（形态与下载站 `/dl` 一致）：独立网页 `/games/`，
与主站同源共享登录状态，按账号保存并隔离游戏数据，为未来联机预留数据层与契约。

## 一、入口与形态

- 入口：侧边栏「个人主页」行右侧的游戏按钮（同步状态指示在顶栏 `tb-pill`，侧栏不再重复）。
- 打开方式：
  - 网页：新标签页同源打开 `/games/index.html`（`window.open('...','_blank','noopener')`）；
  - 桌面：经 `qbao:open-games` IPC 打开独立子窗口（webPreferences 与主窗口一致，含 preload）。
- 打开新标签/子窗口保证主窗口存活：**AI 出题任务不被打断**（任务由服务端
  `aiTaskWorker` 执行，浏览器侧轮询在后台标签被节流只会减慢进度刷新，回前台即恢复）。

## 二、等待引导（不干扰原则）

- 信号源：`aiTaskQueue` 存在 pending/running 任务（与侧栏 AI 行徽标同源）。
- 表现：游戏按钮**纯样式高亮**（脉冲光晕 + 角标 + 悬停文案），无弹窗、无焦点抢断、无页面跳转。
- 扩展点：未来可并入聊天流式生成、导入进行中等等待状态（同为「可切出网页」场景）。

## 三、数据契约

成绩保存在服务端 `user_games_stats`（迁移 014）：`user_id` 主键 + `data` JSONB，**按账号强隔离**。

| 端点 | 说明 |
| ---- | ---- |
| `GET /api/v1/games` | 当前用户全部游戏数据 `{ data: { [gameId]: { best, level, plays, lastAt } } }` |
| `POST /api/v1/games` | 上报/合并单游戏成绩：`{ gameId, score?, level?, plays? }` |

合并规则（服务端权威，防篡改）：
- `best` / `level` 只升不降（取最大值）；
- `plays` 每次成功上报至少 +1（上限 100000，仅统计不参与权益）；
- 写入采用 **data CAS（读-改-写 + ≤3 次重试）** 防并发覆盖，409 兜底；
- gameId 白名单与 `app/src/services/gamesManifest.js` 联动（CI 断言防漂移）。

前端上报实现：`app/public/games/common/qbao-hook.js`（游戏页调用
`window.__qbaoGame.report(...)`，3 秒合并窗口后 POST）。钩子仅**读取**凭据
（网页：同源 localStorage `qbao_token` 混淆值，只读不写；桌面：既有 `qbao:secret-load` IPC）。

## 四、联机路线图（预留，未实现）

首版为纯单机。联机第二期选型已定方向——**房间制异步对战**（复用现有账号体系与 REST，
不做 WebSocket，保持服务器低负载）：
- 数据层：与 `user_games_stats` 同 schema 族新增 `game_rooms(id, owner_id, game_id, state jsonb, rev, created_at)`
  与 `game_moves(room_id, seq, user_id, move jsonb)`；
- 玩法：井字棋 / 五子棋 / 黑白棋短回合制，客户端轮询 `GET /api/v1/games/rooms/:id`；
- 鉴权/限流/隔离全部沿用现有体系；「单行状态 + 追加移动」设计天然支持回放。

## 五、积分对接（v0 契约，未生效）

积分✗游戏对接口已预留（前端 `app/src/services/pointsBridge.js`，v0 仅校验与留痕，**不产生积分变动**）：

- 事件：`game.completed`（`{ gameId, score, level, meta? }`）、`game.score`；
- 未来端点草案：`POST /api/v1/points/events`，接入现有 `pointsService` 积分账本，
  防刷：同游戏频率限制 + 日上限 + 服务端合理性校验（best 单调、plays 上限已有）；
- 消费场景清单（P2 立项）：通关/新高分奖励积分、每日首玩、积分购买游戏权益、
  游戏周赛榜（需排行端点）；游戏数据本身不兑换积分。
- **成就联动预留**：现有成就体系（AchievementsTab / points claims）可作为游戏成就宿主，
  契约 v1 以 `refType='game'` 扩展 `points/claims`。

> 长线观察项：`user_games_stats` 单行 JSONB 体积随游戏数增长，警戒线为单行 >64KB
> （当前 4 款游戏 × 4 字段远低于此；超限时拆列为游戏独立列）。
