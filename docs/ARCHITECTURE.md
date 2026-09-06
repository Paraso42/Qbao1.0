# 架构说明与重构方向

> 最后更新：2026-09（v3.37.0）。本文描述当前架构、已知技术债，以及向正式软件转化的初步重构方向。

## 1. 系统拓扑

**双形态**（v3.25 起）：同一 SPA 既由 nginx 托管为在线网页，也被 Electron 桌面端（desktop/）内嵌加载；桌面端经 preload 注入 `window.__QBAO_RUNTIME__`（apiBase/isDesktop/updateChannel），API 地址动态化。

```
【形态一：网页】浏览器 → nginx → app/ 静态文件 + /api 反代 → server/
【形态二：桌面】Electron(desktop/) → 加载本地 app/ → fetch RUNTIME.apiBase → 线上 server/
                 └── electron-updater ← 自托管更新源（v3.35+；GitHub 仅作构建与归档）
```

```
浏览器 (app/ 纯静态 SPA，无构建)
   │ HTTPS  /api/v1/*   /uploads/*
   ▼
Nginx (静态托管 + 反向代理 + TLS)
   │ /api → http://127.0.0.1:3000
   ▼
server/  Node.js + Express API（端口 3000）
   ├── PostgreSQL（库名 qbao）
   └── 外部 AI API（ECNU / DeepSeek / OpenAI / Gemini，由后端代理调用）
```

- 前后端**同源部署**：前端运行时经 `core/env.js` 解析 API 基址（网页形态同源 `/api/v1`，桌面形态由 preload 注入的 `RUNTIME.apiBase` 提供），由 nginx 反代到后端。
- 移动端与桌面共用同一套响应式前端，无独立客户端。

## 2. 前端（app/）

- **技术形态**：Vue 3 + Vite + Pinia 组件化工程（v3.27 起重构，此前为手写 DOM 单文件）。构建采用 `vite-plugin-singlefile`，产物 `app/dist/index.html` 内嵌全部 JS/CSS（singlefile，约 550KB）；同一份产物既由 nginx 托管为网页，也被 Electron 以 file:// 内嵌加载（桌面端免部署）。
- **状态与持久化**：Pinia stores 统一状态入口；`services/persistence.js`（localStorage 骨架 + 大字段分流 IndexedDB + 配额自愈）、`services/stateDb.js`（IDB 行键按账号分区）、`services/sync.js`（带 rev 乐观锁的同步引擎：空推跳过、409 实体级并集合并重推、keepalive 补推）。
- **账号隔离（v3.36–v3.37）**：登录门禁（弃匿名态）+ 属主钉扎（写盘属主 / 会话令牌 / 跨标签 storage 守卫），多标签页零串账，E2E 验证。
- **渲染**：组件化渲染（scoped CSS + 设计令牌 `styles/tokens.css`）；图表为零依赖 SVG 组件（DonutChart / TrendChart）。
- **主要模块**（v3.32 拆分后，按领域）：

| 模块 | 职责 |
|------|------|
| views/ + components/features/* | 5 个视图、约 60 个业务组件（答题 / 科目看板 / 聊天 / 反馈 / 用户中心 / 设置 / 题库） |
| stores/ | 11 个 Pinia store（数据 / 答题 / 会话 / 同步 / UI / 积分 / 工单等） |
| services/ | 纯逻辑层：subjectStats 统计引擎（单一权威源）、sync 同步引擎、chatVirtual 虚拟滚动、importExport 导入导出、secureStore（桌面 DPAPI 凭据）、API 封装族 |
| core/ | 启动引导 boot.js（含跨标签守卫接线）、运行时环境注入 env.js |

## 3. 后端（server/）

- **框架**：Express 4 + pg 连接池；14 个路由模块（auth/data/backup/ai/aiTasks/share/notices/users/points/quiz/files/issues/chat/desktop，v1 死代码已删，T14；路由层全部 asyncHandler + zod 校验）。
- **桌面分发端点（v3.35+）**：desktop.routes 提供 manifest / latest / download（断点续传）/ update feed / stats 与 /dl、/download（详见 docs/DEPLOY.md §8.5 与 docs/PUBLISHING.md）；安装包由 GitHub Actions 构建并归档 Release，经 scripts/publish-installer.js 搬入自托管储藏室 downloads/，桌面端从自托管 feed 更新。
- **鉴权**：JWT（30 天）+ bcrypt 密码哈希；`requireAuth` / `requireAdmin` 中间件；`express-rate-limit` 全局与登录限流。
- **AI 层**：`providers/` 统一实现（openaiCompatible 工厂覆盖 ecnu/deepseek/openai + 独立 gemini 适配器，T14 删除死 provider），能力目录在 `providers/catalog.js`；用户自配 API Key，经请求头 `x-ai-api-key` 传入后端；**成功才计费**（T6）。
- **数据**：核心业务数据整包存 `user_data.state_json JSONB`，`GET/PUT /api/v1/data` 全量读写；答题会话、聊天、反馈、公告、文件、分享各有独立表。
- **上传**：multer 多实例；所有上传统一落在仓库根 `uploads/`（chat/issues/pool/avatars 四目录，T16 收敛）；上传类型白名单 + 魔数嗅探 + 下载附件头（T2）。

## 4. 数据模型要点

`users`（账号）、`user_data`（整包业务状态 JSONB）、`backups`（用户备份）、`shared_banks`（题库分享）、`ai_request_log`（AI 调用审计）、`answer_sessions`（按章节答题会话）、`user_files`（资料文件池）、`issues / issue_messages`（反馈工单）、`points_ledger`（积分台账）等；建表脚本 `server/init.sql` + 版本化迁移 `server/sql/NNN_*.sql`（T17：schema_migrations 追踪，`node scripts/run_migration.js` 执行）。

## 5. 已知技术债与重构方向（初步判断）

### P0 — 安全与正确性（优先）

1. **CORS 全开**：~~`cors({ origin: true })` 反射任意 Origin~~ **（已落地白名单）**。
2. **上传安全**：~~缺 MIME 白名单~~ **（T2 已完成：扩展名白名单 + 魔数嗅探 + 下载附件头 + 移除 /uploads 静态映射）**。
3. **全量同步冲突**：~~`user_data` 单行 JSONB 全量覆盖是 last-write-wins~~ **（v3.25 已加 rev 乐观锁 + 409 冲突实体级合并，见 js/sync.js）**。遗留：合并粒度仍为实体级并集（同 id 本地优先），按字段时间戳的精确裁决、以及按实体拆表，留待后续。同步放大写问题仍在（每次全量 PUT）。
4. **统一错误处理**：~~路由内大量手工 try/catch~~ **（v3.26 已完成核心部分：`src/lib/` ApiError + errorHandler + asyncHandler，全局兜底 404/400/413/500，auth/data/quiz 已迁移）**。其余路由（ai/share/files/issues/chat/users/backup/notices）仍为手工 try/catch，逐步迁移。
5. **请求校验缺失**：~~大部分端点直接信任入参~~ **（v3.26 已引入 zod：`src/lib/validate.js` + `src/schemas/`，auth/data/quiz 已接入）**。其余路由待接入。
6. **上传目录不一致**：~~统一 server/uploads/~~ **（T16 已完成：全部收敛到仓库根 `uploads/`，部署侧 `server/deploy/prepare_dirs.sh` 初始化属主）**。

### P1 — 可维护性

7. **chat.js（90KB）拆分**：~~消息渲染 / 增量轮询 / 分享选择器 / 撤回各自独立模块~~ **（v3.27 已完成：聊天拆为 `app/src/components/features/chat/` 组件族 + `stores/chat.js` + `services/chatApi.js`）**。
8. **index.html 单文件 DOM**：~~按页面拆分模板，弹窗组件化~~ **（v3.27 已完成：全部弹窗/页面组件化，见 `app/src/components/` 与 `app/src/views/`）**。
9. **前端模块化**：~~迁移 ES Modules~~ **（v3.27 已完成：Vue 3 + Vite + Pinia 全量组件化重构 + Vite singlefile 打包，兼容桌面 file:// 加载）**。
10. **后端分层**：routes → services → repositories，SQL 集中到数据访问层（当前散落各路由）。
11. **测试骨架**：~~后端 supertest 覆盖 auth/data/quiz 主流程；接入 CI~~ **（v3.26 已完成：`server/test/` 22 个用例，CI 后端 job 跑 `vitest run`）**。前端纯逻辑（quiz-engine/srs）的 Vitest + jsdom 测试仍待补。
12. **配置集中**：散落的路径常量（uploads、pool）收敛到 server/src/config.js。

### P2 — 工程化与正式软件化

13. **渐进 TypeScript**：后端先行，JSDoc 注解过渡。
14. **容器化**：Docker Compose（nginx + server + postgres）一键部署。
15. **CI/CD**：CI 现有语法检查，逐步加测试、构建产物、自动部署。
16. **可观测性**：结构化日志（pino）、错误上报（Sentry/自建）、健康与指标端点。
17. **迁移工具化**：~~手写 SQL 人工执行~~ **（T17 已完成：`schema_migrations` 版本化 + `node scripts/run_migration.js` 自动应用未执行项）**。
18. **发布流程**：CHANGELOG + git tag + GitHub Release，自动打包 app/ 静态资源。

### v3.30–v3.37 收口情况（2026-09 复核）

- **v3.30 审计收口**：无 rev PUT → 409 保护（T13）、积分并发行锁与对账 keyset 分页（T5）、AI 成功才计费（T6）、gemini SSE 跨 chunk 修复（T7）、定时器 unref（T8）、chapterMaterials 合并（T9）、beforeunload keepalive（T10）、AI 任务自动续跑（T11）、持久化可见化与配额治理（T12）、v1 死代码删除（T14）、上传目录收敛（T16）等整改全部落地（T1–T23 记录见 docs/REVIEW-2026-08.md 第十节）。
- **v3.31–v3.37 增量**：分层持久化 E2E 回归、同步写收敛（空推跳过 / 账号键 / 指纹）、safeStorage 密钥加固（桌面 DPAPI）、store 与巨型组件拆分、API 封装统一、聊天虚拟滚动、错题本 + AI 讲解、题库导入导出与批量编辑、登录门禁与账号隔离四层、串号根治三层钉扎（令牌 / 写盘属主 / 跨标签守卫）、移动端竖屏交互专项、科目总览看板口径统一（subjectStats 单一权威源，恒等式单测锁定）。

## 5.5 积分系统（v3.29）

- 余额缓存：`users.storage_points`（v3 预留）；台账：`points_ledger`（delta/balance_after/reason/ref_type/ref_id，唯一键幂等）。
- 规则集中在 `server/src/config/points.js`（注册/每日登录/答题/成就/分享奖励；文件续期与 AI 超额消耗）。
- 服务：`server/src/services/pointsService.js`；API：`GET /points/{ledger,balance,rules,quota}`、`POST /points/claims`，管理员 `/users/:id/points/{ledger,adjust}`。
- 生命周期：每年 2/1、8/1 学期清零（进程定时器 + advisory lock，幂等记账）；每日 03:00 余额对账（台账为准）。
- 防滥用：AI 任务每用户排队 ≤3、AI 每日免费额度 + 积分超额（**成功才扣费**，T6）、答题每日上限 30、一次性事件唯一约束。
- 并发正确性（T5）：答题结算走行级锁事务（FOR UPDATE + 幂等快照）；余额对账 keyset 游标全量分页。

## 6. 迁移与兼容性注意

- 2026-07 目录重组（`backend→server`、前端→`app/`）后，**生产部署路径需同步更新**（见 DEPLOY.md）；代码内部相对路径逻辑未变。
- 2026-07 已重写 Git 历史（清除服务器地址等敏感信息）：**其他机器上的克隆必须删除后重新克隆**，不可 `git pull`。
- 2026-08 整改的行为调整：① 无 rev 的 PUT /data 仅在服务器无数据时允许（旧客户端需升级，T13）；② AI 计费改为成功时扣取（T6）；③ 管理员引导改 `ADMIN_USERNAMES` 环境变量（T3）。