# Qbao 游戏空间（v3.40）

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

## 四、联机游戏（狼人杀 · 已上线）

派对桌游「狼人杀」经开源项目 [xiong35/werewolf](https://github.com/xiong35/werewolf)（MIT, commit 26a77c0）
自托管接入，**不依赖任何外部服务**：

- 入口：游戏大厅 `/games/` 卡片 → `/games/werewolf/`（与主站同源，nginx 子路径 `location ^~ /games/werewolf/`）。
- 架构：前端静态由 nginx 直出；房间实时逻辑为独立 Node 服务（Koa + socket.io，systemd 单元
  `qbao-werewolf`，监听 127.0.0.1:3011）：
  - HTTP API：`/games/werewolf/api/*` → nginx 剥前缀 → 3011（建房/加入/行动）；
  - WebSocket：`/games/werewolf/werewolf-ws/*` → 3011 原样透传（含 Upgrade 头）。
- 数据：房间与对局状态只在服务端内存（房间号 6 位，12 小时自动清理，重启即清零），
  **不落库、不接账号体系**——游客亦可玩，不写 `user_games_stats`、不参与积分（桌游按局结算，后续再议）。
- 本地化修改（MIT 允许，记录于 `party/werewolf/README.md`）：同源子路径接线、运行时资源前缀、
  「Day N」→「第N天」等全中文界面、构建链现代化（Vite 5 + Vue 3 官方插件、TS 4.9）。
- 重建/部署手册：`party/werewolf/README.md`（构建、闭包依赖、systemd、nginx 片段均归档在
  `party/werewolf/deploy/`）。

后续联机扩展（预留方向不变）——**房间制异步对战**（复用现有账号体系与 REST，不做 WebSocket，
保持服务器低负载）：
- 数据层：与 `user_games_stats` 同 schema 族新增 `game_rooms(id, owner_id, game_id, state jsonb, rev, created_at)`
  与 `game_moves(room_id, seq, user_id, move jsonb)`；
- 玩法：井字棋 / 五子棋 / 黑白棋短回合制，客户端轮询 `GET /api/v1/games/rooms/:id`；
- 鉴权/限流/隔离全部沿用现有体系；「单行状态 + 追加移动」设计天然支持回放。

## 五、积分对接（v1 已落地：弹珠游戏「弹猪乐」）

弹猪乐（marble，同学自研微信小游戏 Web 移植，个人授权）是首个打通「游戏 ↔ Qbao 积分」的游戏；
其余游戏仍只记录成绩（user_games_stats），不产生积分。

### v1 已落地能力

- 云存档：登录账号的弹珠/钻石余额、皮肤/拖尾/光环归属与装备存 `user_marble_profiles`（迁移 017），**服务端权威**（本地无法篡改/重置刷）；游客自动回退 localStorage 本地模式（成绩照常按账号上报 best/plays）。
- 对局：`POST /api/v1/games/marble/round/start` 扣押珠并由**服务端随机倍率（×2/×3/×5/×10）与亮灯槽位** → 客户端做物理表现 → `round/result` 上报落槽，服务端判定输赢。`user_marble_rounds` 保证单开一局（防双重结算/重放），10 分钟未结算自动退回押珠。
- 单向兑换（经济模型 2026-09 定版）：**积分 → 弹珠 1 积分 = 10 弹珠（不设上限）**；**钻石 → 积分 1 钻 = 2 分（每日最多 50 分，按当日台账 SUM 截断）**，reason `marble_in` / `marble_diamond_out`；弹珠不可兑积分、积分不可购钻石；`GET /points/rules` 与积分页自动展示新规则。
- 防刷边界：弹珠/钻石**获取不设上限**（对局命中即发），故兑换进积分的唯一窗口为「钻石 → 积分」且**每日封顶 50 分**（= 25 钻），从源头上限定每日最大“变现”量；商城购买/装备全部走服务端校验价格与余额；每日免费领取 2 × 50 弹珠防无珠可玩。
- 合规边界（延续 roulette 下架整改）：随机输赢只作用于弹珠/钻石（纯虚拟道具），**积分不参与任何押注/输赢**，只做固定汇率兑换；兑换全程台账留痕、可审计、随学期清零。
- 实现文件：server `routes/marble.routes.js`、`services/marbleService.js`、`schemas/marble.schema.js`、`config/points.js`（MARBLE_* 常量）、迁移 `sql/017_v3.40_marble.sql`；客户端 `app/public/games/marble/`（webwx.js 适配层/云桥 + 上游 game.js 补丁，见 `marble/SOURCE.md` 与 `party/marble-wx-game/web-port/`）；测试 `server/test/marble.routes.test.js`（25 例，假池；全量 228 例）。

### 通用游戏事件（v0 预留，未生效）

### 其余游戏事件（v0 预留，未生效）

- 事件：game.completed（{ gameId, score, level, meta? }）、game.score；前端 app/src/services/pointsBridge.js 仅校验与留痕。
- 未来端点草案：POST /api/v1/points/events，接入现有 pointsService 账本。
- 消费场景清单（P2 立项）：通关/新高分奖励积分、每日首玩、积分购买游戏权益、
  游戏周赛榜（需排行端点）；游戏数据本身不兑换积分。
- 成就联动预留：现有成就体系（AchievementsTab / points claims）可作为游戏成就宿主，
  契约 v1 以 refType=game 扩展 points/claims。

> 长线观察项：user_games_stats 单行 JSONB 体积随游戏数增长，警戒线为单行 >64KB
> （当前 6 款 × 4 字段远低于此，狼人杀为联机桌游不写成绩；弹猪乐另有独立钱包表 user_marble_profiles，不占本表；超限时拆列为游戏独立列）。

## 六、测试与内测规范（环境分离 · 2026-09 起）

> 配合 docs/ENVIRONMENTS.md（L0/L1/L2 概念）与 docs/DEVELOPMENT_FLOW.md（流程纪律）。
> 占位符说明：{BETA_HOST}=内测域名、{DOMAIN}/{ORIGIN_IP}=生产入口；真实值见本机 local/ENV.md。

1. **环境与数据**：游戏相关测试动作（云存档、兑换、对局、领奖、清库实验）一律发生在 L1 内测环境（独立库/API/静态目录）；生产环境只允许金丝雀账号**只读**巡检（health/登录/GET），生产库禁止任何游戏写操作验证。
2. **QA 钩子宿主门禁**：游戏自动测试钩子（现弹猪乐 `?qa=1&token=`）仅在 {BETA_HOST} 与 localhost/127.0.0.1 主机名放行；生产主机名（{DOMAIN}、{ORIGIN_IP}）代码层忽略。门禁纯函数与单测：`app/src/games/qa-gate.js`（qaAllowedByHost）；移植新游戏时把同一逻辑内联进其适配层，注释互指（与 secureStore 两端同步模式一致）。
3. **新游戏接入 QA 检查单**：
   - 本机：`127.0.0.1:8124` 静态调试（访客本地模式 + localhost QA 钩子）；
   - L1：同步到内测目录 → 内测库注册测试号 → 云存档/兑换/对局 E2E（断言写进 qbao_beta）；
   - L2：仅静态检查 + 金丝雀只读巡检；
   - 缓存：生产静态 7 天缓存 → 游戏 js 变更时同步更新入口页引用版本参数 ?v= 并提醒强刷（内测不缓存无此问题）。
4. **冒烟入口**：`scripts/qa/smoke-stage.ps1 -Env beta|prod`，游戏专项断言随接入补齐（弹猪乐 API E2E 为样板）。
5. **迁移与白名单**：游戏数据表/字段走 `server/sql/` 编号迁移（先内测库、验收后生产库）；gameId 白名单更新须同时改 games.schema 与 gamesManifest（CI 断言防漂移）。
6. **授权与来源**：外接游戏的上游/授权/端口配方记录在 SOURCE.md / PORT.md；QA 门禁与内测规范属于移植交付的一部分。