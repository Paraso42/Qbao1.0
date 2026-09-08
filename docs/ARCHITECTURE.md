# Qbao 系统架构（总览与事实源）

> **文档定位**：本文是「当前架构」的管理型总览——从公网 HTTPS 链路、双环境（内测/生产）部署，到代码分层、安全边界与工程工具链，
> 回答三个问题：系统现在长什么样、一次改动会碰到哪几层、该去哪篇文档查细节。
>
> 配套文档：环境说明书（非专业视角）[ENVIRONMENTS.md](ENVIRONMENTS.md) · 部署操作 [DEPLOY.md](DEPLOY.md) ·
> 流程与红线 [DEVELOPMENT_FLOW.md](DEVELOPMENT_FLOW.md) · 发布分发 [PUBLISHING.md](PUBLISHING.md) · 游戏空间 [GAMES.md](GAMES.md) ·
> 隐私与信息分离 [DEVELOPMENT.md](DEVELOPMENT.md)。
>
> **隐私铁律**：本文面向 GitHub 公开，一律使用占位符 —— {DOMAIN} 生产域名、{BETA_HOST} 内测域名、{ORIGIN_IP} 源站 IP、
> {HK_IP} 边缘网关 IP、{PROD_ROOT} / {BETA_ROOT} 源站两侧部署根、{BACKUP_DIR} 备份目录。
> 真实值只存在于 gitignored 的 `local/ENV.md`（对照表）与 `local/stage.env.ps1`（部署参数），详见 docs/DEVELOPMENT.md §1。

## 1. 架构总览

一句话：**一套代码、三种形态（网页 / 桌面 / 手机壳）、两层在线环境（L1 内测 / L2 生产）、一条 HTTPS 链路（CDN → 境外网关 → 大陆源站）；源站内两个相互隔离的实例共享一台服务器与同一个 PostgreSQL 集群。**

```
                          ┌──────────── 用户侧：三种形态共用同一份前端 ────────────┐
                          │ 浏览器网页 │ 手机壳 App（Capacitor）│ 桌面 Electron  │
                          └──────┬──────────────────────────────┬──────────────┘
                      https://{DOMAIN}                  https://{BETA_HOST}
                                 │                            │
                        Cloudflare（DNS + 代理）         DNS 仅解析（直连）
                                 │ HTTPS（Full strict）      │ HTTPS
                                 ▼                            ▼
        ┌─────────────────────────────────────────────────────────────────────┐
        │ 边缘网关 {HK_IP} · Caddy（TLS 终结 / 自动证书 / gzip / 反向代理）      │
        │   生产块：回源 Host → {ORIGIN_IP}                                    │
        │   内测块：回源 Host → {ORIGIN_IP} + 注入 X-Qbao-Route: beta           │
        └──────────────────────────────────────────┬──────────────────────────┘
                                                   │ http://{ORIGIN_IP} 回源（Host=源站 IP）
                                                   ▼
        ┌─────────────────────────────────────────────────────────────────────┐
        │ 大陆源站 {ORIGIN_IP} · nginx（listen 80 + 9178）单一 server 块         │
        │   conf.d map（$http_x_qbao_route|$remote_addr，网关出口白名单）        │
        │   默认 / 生产 → root {PROD_ROOT}/app · 静态缓存 7 天                  │
        │   “beta + 白名单网关 IP” → root {BETA_ROOT}/app · 不缓存              │
        │   /api /uploads /avatars /dl → Node :3000（生产）或 :3100（内测）      │
        │   /games/werewolf/* → Node :3011（房间服务，内存态，两环境共享）        │
        └──────────────┬───────────────────────────────────┬──────────────────┘
                   静态直出（SPA / 游戏门户）         API 反向代理
                                        ┌───────────┴────────────┐
                                  qbao-api :3000         qbao-api-beta :3100
                                        │                      │
                              PostgreSQL（同一集群，127.0.0.1）
                                        │                      │
                                  库 qbao（生产账本）      库 qbao_beta（内测账本）
```

改动流动方向固定为从左到右：**L0 本机 → L1 内测 → L2 生产**（概念与入口见 docs/ENVIRONMENTS.md；顺序纪律见 docs/DEVELOPMENT_FLOW.md §7）。

## 2. 公网链路与 HTTPS（部署架构）

### 2.1 为什么是这条链路（背景与约束）

1. **公网产品需要域名 + HTTPS**：域名作为稳定入口（DNS 托管于 Cloudflare），TLS 是浏览器的硬性前提。
2. **大陆机房的 ICP 拦截（2026-09-08 实测）**：大陆源站会拦截公网请求中「未单列备案」的 Host 头（返回 403 Non-compliance ICP Filing）。
   因此源站**不能按域名区分服务**——内测子域名直接以域名回源会被拦。
3. **结论（定版方案）**：生产与内测统一经境外边缘网关 {HK_IP} 进入。网关终结 TLS，并把**回源 Host 一律改写为源站 IP**（源站自见的形态，天然放行）；
   内测与生产的区分从「域名」转移到自定义请求头 `X-Qbao-Route: beta`，由源站 nginx 配合**网关出口 IP 白名单**裁决。
   白名单之外的来源即使携带该头也一律按生产处理 → 内测入口不可伪造。
4. **两个兜底入口**：主域名另套 Cloudflare 代理（CDN + 边缘证书）；`http://{ORIGIN_IP}` IP 直连保留（同一账本，无域名兜底/旧版兼容）。

### 2.2 各层职责

| 层 | 载体 | 职责 | 关键点 |
|---|---|---|---|
| DNS / CDN | Cloudflare | 域名解析；{DOMAIN} 走代理（缓存加速、边缘 TLS）；{BETA_HOST} 仅 DNS | 控制台操作需 VPN（见 local/ENV.md） |
| 边缘网关 | {HK_IP} · Caddy | TLS 终结、自动证书、gzip、回源转发 | 回源 Host → {ORIGIN_IP}；beta 块注入 `X-Qbao-Route: beta` |
| 源站入口 | {ORIGIN_IP} · nginx | 静态直出、API/上传/下载反代、双环境路由、缓存头 | 单一 server 块（server_name _）+ conf.d map（机制见 2.4） |
| 业务 API | Node · :3000 / :3100 | REST API（Express） | systemd：`qbao-api` / `qbao-api-beta` |
| 房间服务 | Node · :3011 | 狼人杀实时（Koa + socket.io，房间在内存） | systemd：`qbao-werewolf`；重启即清零、不落库 |
| 数据库 | PostgreSQL（localhost） | 两本独立账本 qbao / qbao_beta | 见 §3.3 |
| 静态与分发 | 各环境 app/ 根 + downloads/ 储藏室 | SPA / 游戏门户 / 安装包与清单 | 缓存策略差异见 2.5 |

### 2.3 证书与加密模型

- 用户 ↔ Cloudflare：CF 边缘证书（生产域名，Full strict 要求源站证书有效）；用户 ↔ 网关：Caddy 自动签发的证书（{BETA_HOST} 为 DNS 直连，走标准 ACME 校验）。
- 网关 ↔ 源站：HTTP 回源。可信模型 = **nginx 只信任网关出口 IP（白名单）+ 源站 443 不对外暴露**；Node API 与 PostgreSQL 只监听 127.0.0.1。
- `http://{ORIGIN_IP}` 直连入口无 TLS（兜底性质），同一源站同一账本。

### 2.4 环境识别与请求路由（nginx 实际机制）

`/etc/nginx/conf.d/qbao-env.conf`（双环境分流 map；占位符示意的等价形式）：

```nginx
# 信任条件：请求头 X-Qbao-Route: beta 且来源为网关出口 IP（白名单）
# 其余一切请求（IP 直连 / 无头 / 伪造头）都落生产
map "$http_x_qbao_route|$remote_addr" $env_root {
    default             {PROD_ROOT}/app;
    "beta|{HK_IP}"      {BETA_ROOT}/app;
}
map "$http_x_qbao_route|$remote_addr" $env_cache {
    default             "public, max-age=604800";
    "beta|{HK_IP}"      "no-cache, no-store, must-revalidate";
}
map "$http_x_qbao_route|$remote_addr" $env_expires {
    default             7d;
    "beta|{HK_IP}"      -1;
}
```

站点块要点（`/etc/nginx/sites-enabled/qbao`）：`listen 80` + `listen 9178 default_server`、`server_name _`、`root $env_root;`；
`/api/`、`/uploads/`、`/avatars/`、`/dl` 以 `if ($env_root = {BETA_ROOT}/app) { proxy_pass 127.0.0.1:3100; }` 选路，默认回退 `127.0.0.1:3000`；
狼人杀路径 `^~ /games/werewolf/`（含 ws Upgrade 透传）→ `127.0.0.1:3011`；
静态资源正则 location 设置 `expires $env_expires; add_header Cache-Control $env_cache;`。

> 设计效果：**一个 server 块同时服务两条公网链路与 IP 直连**；生产请求不携带路由头（或来自非白名单 IP）→ 默认生产；
> 只有「网关白名单来源 + beta 头」进入内测实例。新增环境时只需扩展 map 与白名单，无需复制 server 块。
> 旧方案（按 Host 分多个 server 块）因 ICP 拦截不可行，已废弃；若从备份恢复旧分块配置会导致内测域名被拦，注意区分。

### 2.5 缓存纪律（与改版可见性强相关）

| 环境 | 静态缓存 | 改版生效方式 |
|---|---|---|
| 生产 {DOMAIN} / {ORIGIN_IP} | `expires 7d` + `public, max-age=604800`；CF 边缘另有缓存 | 引用 js/css 必须带版本参数 `?v=`（否则老浏览器拿旧文件）；必要时 CF 控制台 Purge Cache |
| 内测 {BETA_HOST} | `no-cache, no-store` | 部署刷新即见 |
| 动态接口 / 下载文件 | 不缓存（下载经 Node，支持 Range/206） | — |

## 3. 运行实体拓扑（源站视角）

### 3.1 进程与端口

| 服务 | 端口 | systemd 单元 | 工作目录（占位） | 说明 |
|---|---|---|---|---|
| nginx | 80（公网）、9178（内网保留） | nginx | — | 配置：sites-enabled/qbao + conf.d/qbao-env.conf |
| qbao-api（生产） | 127.0.0.1:3000 | qbao-api.service | {PROD_ROOT}/server | 读本目录 .env → 库 qbao |
| qbao-api-beta（内测） | 127.0.0.1:3100 | qbao-api-beta.service | {BETA_ROOT}/server | .env 含 AUTO_ADMIN=1、AI Key 留空 → 库 qbao_beta |
| qbao-werewolf | 127.0.0.1:3011 | qbao-werewolf.service | — | 房间内存态；前台静态各环境直出、房间服务共享 |
| PostgreSQL | 127.0.0.1:5432 | postgresql | — | 不对外 |

### 3.2 目录布局

每个在线环境都是一套独立的「仓库布局目录」（部署侧**非 git 检出**，由脚本同步 tar 产物）：

```
{PROD_ROOT}/            # 生产（真实路径见 local/ENV.md）
  app/                  # nginx 静态根：index.html + 资源 + games/（7 天缓存）
  server/               # API 代码 + .env + sql 迁移（systemd 工作目录）
  downloads/            # 分发储藏室：manifest.json(+.bak) stable/ beta/
  uploads/              # 上传统一目录：pool/ chat/ issues/ avatars/
  scripts/  docs/ …     # 工具与文档（同步）
{BETA_ROOT}/            # 内测：同样布局（app 不缓存、server 端口/库/密钥独立）
```

> 目录更新用「整目录换名 + 滚动备份」：部署时 `mv dir dir.bak_<时间戳> && mkdir && 解包`，备份保留 5 份（scripts/stage.ps1 参数）。

### 3.3 数据库

- 同一 PostgreSQL 集群内的两本账：`qbao`（生产，禁止测试写入）、`qbao_beta`（内测，可随时重建）。
- Schema 演进：`server/sql/NNN_*.sql` 编号迁移（幂等），`schema_migrations` 表**每库独立记账**，`node scripts/run_migration.js` 按目录 .env 执行；顺序固定 **L1 先、L2 后**。
- `qbao_beta` 的初始化方式是**对生产库做 schema-only 克隆**（pg_dump --schema-only + 拷贝 schema_migrations），
  而非执行仓库 `init.sql`——线上生产库经多年迁移后与 init.sql 基线存在漂移，克隆保证与生产 schema 逐字一致（重建步骤见 docs/DEPLOY.md §4B）。
- 备份：每日 pg_dump → {BACKUP_DIR}，uploads 同步备份；恢复流程见 docs/DEPLOY.md §7/§8.5。

### 3.4 资源预算与降载预案

- 源站为小内存单机：nginx + 2 个 API 实例 + 房间服务 + PostgreSQL 常驻。内测实例不开 AI 任务（AI Key 留空即不消费额度；服务端预留 `SKIP_AI_WORKER=1` 开关）。
- 最坏回退：内测仅保留静态目录（页面/UI 可测），API 暂共享生产实例——放弃「先于生产测新代码」能力，恢复即移除（docs/DEPLOY.md §4B.5）。

## 4. 环境隔离与安全边界

### 4.1 隔离矩阵

| 维度 | L1 内测 | L2 生产 |
|---|---|---|
| 入口 | https://{BETA_HOST} | https://{DOMAIN}、http://{ORIGIN_IP}（同账本） |
| API 进程 / 端口 | qbao-api-beta :3100 | qbao-api :3000 |
| 数据库 | qbao_beta（schema 与生产一致） | qbao（禁测试写入） |
| 静态目录 | {BETA_ROOT}/app（不缓存） | {PROD_ROOT}/app（静态 7 天） |
| 下载/上传 | 各自 downloads/ 与 uploads/（nginx 按 env 路由） | 同上（生产） |
| 账号体系 | 开放注册；**AUTO_ADMIN=1 注册即管理员** | 管理员仅后台授予（bootstrap_admin / ADMIN_USERNAMES） |
| 测试动作 | 注册/对局/兑换/领奖/清库全部允许 | 仅金丝雀账号只读巡检 |
| 部署目标 | scripts/stage.ps1 -Env beta | scripts/stage.ps1 -Env prod |

### 4.2 账号、角色与防互害模型（v2 权限体系）

- 基础：JWT（30 天）+ bcrypt；`requireAuth` / `requireAdmin` 中间件；全局与登录限流。
- **管理员来源只有两个**，环境天然隔离：
  1. 生产：后台脚本 `bootstrap_admin.js`（或首次引导 `ADMIN_USERNAMES` 环境变量）——只能由服务器操作者执行；
  2. 内测：`.env` 开启 `AUTO_ADMIN=1` → 注册即 admin（便于内测管理功能）。**生产严禁开启 AUTO_ADMIN。**
- **防互害（管理员之间，服务端强制 403 + 客户端界面同步收敛）**：

| 操作 | 对其他 admin | 对自己 |
|---|---|---|
| 封禁（PATCH ban） | 403 | — |
| 改角色（PUT role） | 403（角色变更仅后台脚本） | 允许自降为 user |
| 重置密码（PUT password） | 403 | 允许 |
| 其他资料修改 | 允许（非敏感字段） | 允许 |

- **跨环境数据互导不携带账号属性**：两环境间互导只能走「本地备份 JSON」（设置 → 数据），其内容为学习业务数据，
  恢复仅写入业务状态（PUT /data state_json，服务端剥离 AI 相关键），**从不触碰 users 表**——封禁状态与管理员角色
  属于账号属性，任何备份都无法携带 → 内测备份不可能用于解除生产封禁或获得生产管理员。
- **QA 钩子宿主门禁**：游戏自动化钩子（`?qa=1&token=`）仅 localhost 与 {BETA_HOST} 放行；
  门禁纯函数 `app/src/games/qa-gate.js`（qaAllowedByHost），移植游戏时同一逻辑内联进其适配层，两端必须同步修改（见 docs/GAMES.md §六）。

### 4.3 数据与凭据安全

- 上传：类型白名单 + 魔数嗅探 + 附件下载头；/uploads、/avatars 一律反代到 API（不经静态直出）。
- `.env` 权限 600；JWT_SECRET 强随机且 ≥32 字符（启动强校验）；PG 仅 localhost。
- AI Key 由用户自管，经请求头 `x-ai-api-key` 透传，服务端不落库；桌面端凭据以 DPAPI（safeStorage）加密。
- 已知安全债：API 进程以 root 运行（历史单机惯例），改进方向见 §9（降权为专用低权用户）。

## 5. 应用架构（代码分层）

### 5.1 形态与产物（同源同构）

- 前端为 **Vue 3 + Vite + Pinia** 工程，`vite-plugin-singlefile` 构建 → `app/dist/index.html`（内嵌全部 JS/CSS，约 550KB）。
- 同一份产物三种用法：nginx 托管（网页）；Electron 桌面以 file:// 内嵌（免部署，preload 注入 `window.__QBAO_RUNTIME__` 提供 apiBase/updateChannel）；
  手机壳工程 mobile/（Capacitor）加载线上 URL（正式包 com.qbao.app / 内测包 com.qbao.beta，可共存安装）。
- API 基址运行时解析（`core/env.js`）：网页形态同源 `/api/v1`；桌面形态用注入的 apiBase；壳应用打包时固定服务器 URL。
- 附属静态站：`app/public/games/` 游戏门户、下载落地页 `/dl`（服务端动态渲染）；随构建拷入 dist 与各环境 app/。

### 5.2 前端分层

| 层 | 内容 |
|---|---|
| views/ + components/features/* | 视图与业务组件（答题/看板/聊天/反馈/用户中心/设置/下载中心/题库等） |
| stores/ | Pinia store（数据/答题/会话/同步/UI/积分/用户等） |
| services/ | 纯逻辑：subjectStats 统计引擎（单一权威源）、sync 同步引擎、chatVirtual、importExport、persistence、secureStore、API 封装族、desktopRelease |
| core/ | 启动引导 boot.js（跨标签守卫）、运行时环境 env.js |
| games/ | QA 门禁 qa-gate.js、游戏清单 gamesManifest.js |

数据底座：`persistence.js`（localStorage 骨架 + IndexedDB 大字段分流 + 配额自愈）、`stateDb.js`（IDB 行键按账号分区）、
`sync.js`（rev 乐观锁：空推跳过、409 实体级并集合并重推、keepalive 补推）。账号隔离：登录门禁 + 属主钉扎 + 跨标签守卫（E2E 验证零串账）。

### 5.3 后端分层（server/）

- Express 4 + pg 连接池；路由全部 asyncHandler + zod 校验；限流中间件。
- 路由模块（17 个，v2 后缀为现行版）：auth、users.v2、data、backup.v2、points、ai、aiTasks、quiz、chat.v2、files.v2、issues.v2、
  notices.v2、share.v2、apps（手机分发）、desktop（桌面分发/落地页）、games（成绩）、marble（弹猪乐对局与钱包）。
- 领域服务：pointsService（积分台账）、marbleService（对局/兑换）、aiTaskWorker（任务队列 SKIP LOCKED）、desktopManifest/apps（清单校验）等。
- AI 代理层：providers/ 统一工厂（openaiCompatible 覆盖 ecnu/deepseek/openai + gemini 适配器），能力目录 catalog.js；成功才计费。
- 数据：核心业务状态整包存 user_data.state_json JSONB（rev 乐观锁）；会话/聊天/反馈/文件/分享/工单各有表。

### 5.4 数据模型要点

`users`（账号/角色）、`user_data`（业务状态 JSONB）、`backups`、`shared_banks`、`ai_request_log`、`answer_sessions`、
`user_files`、`issues/issue_messages`、`points_ledger`（积分台账）、`user_games_stats`（游戏成绩）、
`user_marble_profiles`（弹珠钱包）、`user_marble_rounds`（单开一局防重放）、`desktop_download_stats` 等；
建表基线 `server/init.sql` + 版本化迁移 `server/sql/NNN_*.sql`（schema_migrations 追踪，见 §3.3 与 docs/DEVELOPMENT.md §7）。

### 5.5 经济模型（2026-09 定版，防赌博红线）

- **积分 → 弹珠 1:10，不设上限**（单向）；弹珠/钻石获取不设上限（对局命中即发）；
- **钻石 → 积分 1 钻 = 2 分，每日最多 50 分**（按当日台账 SUM 截断）——唯一“变现”窗口有日封顶；
- 随机输赢只作用于纯虚拟道具，积分永不参与押注/输赢；兑换全程台账留痕、可审计、随学期清零。
- 详细规则与实现文件见 docs/GAMES.md §五；路由/服务/常量：marble.routes.js / marbleService.js / config/points.js。

## 6. 分发与更新架构（自托管，manifest-first）

| 端 | 正式（stable） | 内测/测试（beta） |
|---|---|---|
| 网页 | https://{DOMAIN} | https://{BETA_HOST}（独立实例） |
| 手机壳 | com.qbao.app · 1.0.x | com.qbao.beta（同签名共存安装，应用名带「内测」） |
| 桌面 | Qbao-Setup-X.Y.Z.exe · latest.yml | X.Y.Z-beta.N · beta 渠道 latest.yml |

- 唯一事实源：`downloads/manifest.json`（每次发布前滚动 .bak）；服务端只读，写经发布工具。
- 桌面端点：`/api/v1/desktop/{manifest,latest,download,update/<channel>/latest.yml,stats}`；手机：`/api/v1/apps/{manifest,download,stats}`；
  落地页 `/dl` 与网页「设置 → 下载中心」展示正式区 + 「内测版（可选）」区块（自选，非强制）。
- 渠道纪律：stable 拒绝 prerelease 版本号；测试版永不进 stable；required（强制更新）仅 stable 且须显式 promote；
  恶性 bug 用 retract 熔断 + 旧版自取（docs/PUBLISHING.md）。
- 校验双份存在：客户端入库工具 scripts/installer-lib.js 与服务端 desktopManifest.js 各自校验（改动须同步）；
  手机清单 channel=beta 亦有两端校验（server apps 路由只读序列化）。
- 工具：publish-installer.js（桌面 add/promote/retract/verify/ls）、publish-mobile.js（手机 add --channel stable|beta）、
  build-beta-apk.ps1（内测壳构建）、electron-builder 本地 beta 打包（不改任何跟踪文件）。

## 7. 部署与配置管理（工程工具链）

### 7.1 配置分层

| 配置 | 位置 | 进 Git |
|---|---|---|
| 模板/默认值 | server/.env.example、scripts/stage.env.example.ps1、mobile/capacitor.config.ts 环境覆盖 | ✅ |
| 服务器实例 .env | 各环境 server/.env（每实例独立 PORT/PGDATABASE/JWT_SECRET/CORS/AUTO_ADMIN…） | ❌（仅服务器） |
| 真实环境对照表 | local/ENV.md | ❌ |
| 部署参数（SSH/密钥/远端目录/服务名） | local/stage.env.ps1 | ❌ |
| 服务器配置（nginx/Caddy/systemd） | 各服务器 /etc/… | ❌ |

### 7.2 工具链

| 工具 | 作用 |
|---|---|
| scripts/stage.ps1（-Env beta|prod，-Mode all|server|app|migrate|restart） | 双环境同步部署：本地打包 → scp → 远端换目录解包（滚动备份）→ 迁移 → 重启 |
| scripts/qa/smoke-stage.ps1（-Env beta|prod，-Marble，-DryRun） | L1 可写 E2E 冒烟（断言只写 qbao_beta）；L2 只读金丝雀巡检 |
| node scripts/run_migration.js | 按目录 .env 应用未执行迁移（幂等，每库独立记账） |
| node scripts/bootstrap_admin.js | 生产管理员后台授予（唯一途径之一） |
| 发布工具（§6） | manifest-first 入库与渠道纪律 |
| CI（.github/workflows/ci.yml） | gitleaks 全历史扫描 · npm audit · 构建冒烟 · Vitest · ESLint |

### 7.3 服务器配置档案（改网络/入口必读）

- 源站 nginx：`/etc/nginx/conf.d/qbao-env.conf`（map）+ `/etc/nginx/sites-enabled/qbao`（合并 server 块）；校验 `nginx -t && systemctl reload nginx`；改动前备份。
- 边缘网关：`/etc/caddy/Caddyfile`（{DOMAIN} 与 {BETA_HOST} 两个块）；`systemctl reload caddy`。
- systemd：qbao-api / qbao-api-beta / qbao-werewolf（模板 server/deploy/qbao-api.service）。
- 任何真实值变化（IP/域名/路径/服务名）必须同步更新 local/ENV.md；新增回源来源时同步扩展 nginx 白名单。

## 8. 变更影响检查单（给未来开发）

| 改动类型 | 触碰的层 | 必读 | 必做（要点） |
|---|---|---|---|
| 前端页面/游戏静态 | app/ → 各环境静态根 | GAMES §六 | `npm run build`；stage -Mode app 双环境；js/css 引用带 `?v=`；冒烟 |
| 后端 API / 服务 | server/ → 两实例 | DEVELOPMENT_FLOW §⑥ | 单测；stage -Mode server+restart 双环境；smoke-stage |
| 数据库 | server/sql + 两库 | DEVELOPMENT.md §7 | 新增编号幂等迁移；**先 L1 后 L2**（各自记账） |
| 新游戏接入 | public/games + 后端 + 门禁 | GAMES §六 | QA 门禁双端同步；先 L1 E2E；迁移先行 |
| 分发新包/改渠道 | downloads + 两 manifest 校验 | PUBLISHING | channel 纪律；双端校验同步；公网逐字节验证 |
| 网络/证书/域名 | CF 控制台 + Caddy + nginx | DEPLOY §1/4B、ENVIRONMENTS | 白名单 map 同步；配置先备份；CF 操作需 VPN；更新 local/ENV.md |
| 权限/安全规则 | users 路由 + 客户端 + 用例 | DEVELOPMENT_FLOW §5 | 服务端与客户端双端改（界面收敛）；补守卫用例 |
| 新增真实值 | 文档/脚本 | DEVELOPMENT.md §1 | 只进 local/*（占位符纪律，push 前敏感扫描） |

硬性红线（与 DEVELOPMENT_FLOW §7 一致）：push/tag/Release 只在用户验收后；生产库禁测试写入；迁移 L1 先 L2 后；
QA 钩子仅内测域名与 localhost；真实地址/凭据永不进跟踪文件。

## 9. 技术债与整改登记（延续 REVIEW-2026-08 T 体系；删除线 = 已整改）

### P0 — 安全与正确性

1. CORS ~~反射任意 Origin~~ **（已白名单）**；2. 上传 ~~缺 MIME 白名单~~ **（已完成：扩展名+魔数+附件头+去静态映射）**；
3. 全量同步冲突 ~~last-write-wins~~ **（rev 乐观锁 + 409 实体级合并）**；遗留：按字段时间戳精确裁决、按实体拆表、全量 PUT 放大；
4. ~~路由手工 try/catch~~ **（ApiError + asyncHandler + 全局兜底，auth/data/quiz 已迁移）**；其余路由仍手工，逐步迁移；
5. ~~直接信任入参~~ **（zod：src/lib/validate.js + src/schemas/，auth/data/quiz 已接入）**；其余路由待接入；
6. ~~上传目录不一致~~ **（收敛到各环境 uploads/，prepare_dirs.sh 初始化属主）**。

### P1 — 可维护性

7. ~~chat.js 90KB 拆分~~ **（v3.27 完成：components/features/chat 组件族 + stores/chat.js）**；
8. ~~单文件 DOM~~ **（v3.27 完成：组件化）**；9. ~~ES Modules 迁移~~ **（v3.27 完成：Vue3+Vite+Pinia）**；
10. 后端分层 routes→services→repositories（SQL 集中），进行中；
11. ~~后端 supertest 骨架~~ **（已 233 例）**；前端纯逻辑测试已补（250 例）；12. 配置集中到 src/config.js（进行中）。

### P2 — 工程化与正式软件化

13. 渐进 TypeScript（后端先行，JSDoc 过渡）；14. 容器化（Docker Compose）；15. CI/CD（CI 已有 lint/test/build，自动部署待做）；
16. 可观测性（结构化日志/错误上报/指标端点）；17. ~~迁移手写 SQL~~ **（schema_migrations + run_migration.js）**；
18. 发布流程（CHANGELOG + tag + Release 已运作；自动化收尾待做）。

### 多环境架构专项（2026-09 新增登记）

19. **API 进程以 root 运行**（qbao-api / qbao-api-beta，历史单机惯例）→ 目标：专用低权用户 + capability 收敛；
20. **仓库 init.sql 与线上生产 schema 漂移**（qbao_beta 已用 schema-only 克隆规避）→ 目标：迁移 018+ 对齐基线或归档 init.sql 为「新装最小集」；
21. **清单校验双份实现**（installer-lib.js / desktopManifest.js）→ 已互为镜像，改动须双端同步；长期收敛为共享模块；
22. **CF 边缘缓存治理**：生产静态经 CF 缓存 7 天，紧急改版需控制台 Purge（手动）；长期：接入 CF API 或缩短边缘缓存 TTL；
23. **单行 JSONB 同步放大**（全量 PUT，见 P0-3 遗留）与 **user_games_stats 单行增长**（警戒 64KB，见 GAMES.md）。

### 收口记录（v3.30–v3.37 复核，2026-09）

T5 积分并发（行锁+幂等快照+keyset 对账）、T6 成功才计费、T7 gemini SSE、T8 定时器 unref、T9 chapterMaterials 合并、
T10 beforeunload keepalive、T11 AI 任务自动续跑、T12 持久化配额治理、T13 无 rev PUT 保护、T14 v1 死代码删除、T16 上传目录收敛、T17 迁移工具化
等全部落地（全量 T1–T23 记录见 docs/REVIEW-2026-08.md 第十节）。v3.31–v3.37 增量：分层持久化 E2E、同步写收敛、safeStorage 加固、
组件/Store 拆分、API 封装统一、虚拟滚动、错题本与 AI 讲解、导入导出、登录门禁与账号隔离三层钉扎、竖屏专项、看板口径统一（恒等式单测锁定）。

## 10. 迁移与兼容性注意

- 2026-07 目录重组（backend→server、前端→app/）后，部署路径以本文件 §3.2 与 docs/DEPLOY.md 为准；代码内部相对路径未变。
- 2026-07 已重写 Git 历史（清除服务器地址等敏感信息）：**其他机器上的克隆必须删除后重新克隆**，不可 `git pull`。
- 行为调整备忘：① 无 rev 的 PUT /data 仅在服务器无数据时允许（旧客户端需升级，T13）；② AI 计费改为成功时扣取（T6）；
  ③ 管理员引导改 ADMIN_USERNAMES 环境变量（T3）；④ 内测注册即管理员仅 AUTO_ADMIN=1 开启时生效（默认关闭）。

## 11. 修订记录

- 2026-09-08 v1 重写：由「单机拓扑 + 模块清单」升级为多环境架构事实源——新增公网 HTTPS 链路（CDN/网关/源站）、
  ICP 分流机制（X-Qbao-Route + 白名单 map）、运行实体拓扑、隔离矩阵、防互害权限模型、分发架构、工具链与变更检查单；
  原模块清单与技术债登记并入 §5/§9。
