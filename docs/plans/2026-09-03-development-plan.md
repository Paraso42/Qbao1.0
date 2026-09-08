# Qbao 开发方案（P0–P3 逐轮实施路线图）

> - 创建：2026-09-03 ｜ 依据：`REVIEW-2026-08 审计（原件归档 local/archive/）` 结论 + 2026-09-03 全仓复检（测试、Release 均为实测）
> - 执行模式：**后续每轮开发实施 1 个 P**（顺序 P0 → P1 → P2 → P3），每轮结束后更新本文件 §0 方案状态表与对应任务表。
> - 适用阶段：v3.30.1 已发布（Release 资产已验证）、工作树干净的稳定期。

---

## 0. 方案状态表

| P | 主题 | 目标版本 | 状态 | 完成日期 |
|---|------|---------|------|---------|
| P0 | 发布闭环收尾 + 低风险清理 | v3.30.2 | ✅ 已完成 | 2026-09-03 |
| P1 | 数据面可靠性 | v3.31 | ✅ 已完成 | 2026-09-03 |
| P2 | 架构收敛 | v3.32 | ✅ 已完成 | 2026-09-03 |
| P3 | 产品功能 | v3.33 | ✅ 已完成 | 2026-09-03 |
| 积压 | 不入轮（见 §7） | — | ▢ 待触发 | — |

---

## 1. 执行约定（每个 P 轮次的统一流程与完成定义）

### 1.1 轮次流程

1. 读取本方案 → 锁定当前状态为「未开始」的最小 P（按 §0 顺序取第一个 ▢）。
2. 基线验证：server `npx vitest run --pool=forks --poolOptions.forks.maxForks=2`、app `npx vitest run`、app `npm run build`，确认全绿后再改动（近期停更约 2 周，先回归再开工）。
3. 按该 P 的任务表逐项实施；**每项改动必须附带或更新测试**。
4. 完成定义（DoD）：
   - 新增/修改逻辑有测试，两端 vitest 全绿（基线 server 142 / app 34，只增不减）；
   - `npm run build` 通过（冒烟规则同 `.github/workflows/ci.yml`：singlefile + CSP 存在性 + 无 `javascript:`）；
   - 本方案 §0 状态表与对应 P 任务表已更新（状态/版本/完成日期）；
   - `CHANGELOG.md` 已记录；三端版本号（app/server/desktop）对齐；
   - 提交信息带版本号（如 `v3.30.2: …`）；正式发布打 tag 走 `.github/workflows/release.yml`。
5. 版本节奏：P0→v3.30.2（修复小发）、P1→v3.31、P2→v3.32、P3→v3.33；每轮结束是否立即 tag 发布由改动面决定（纯修复可并入下一版），但 CHANGELOG 与版本号必须在轮内同步。

### 1.2 纪律（沿用 DEVELOPMENT.md / REVIEW-2026-08 整改口径）

- **隐私铁律**：真实服务器地址/密钥/用户数据只进 `local/`；公开文档（含本文件）只用占位符。
- **DB 变更**：必须新增 `server/sql/NNN_*.sql`（幂等写法）+ `node scripts/run_migration.js` 应用并记入 schema_migrations。
- **构建产物**：不手工提交 `app/dist`（CI/发布流程构建）；涉及上传的改动必须过 `uploadSecurity` 类测试。
- **删除/停用**：先 grep 引用再删，防死代码回流（v1 路由教训）。

---

## 2. 现状基线（2026-09-03 复检，实测）

| 项 | 实测结果 |
|----|---------|
| 版本/代码 | v3.30.1；HEAD `c38d129` = tag `v3.30.1`；工作树干净，与 origin/main 同步 |
| 后端测试 | 29 文件 / 142 用例全绿（66s） |
| 前端测试 | 7 文件 / 34 用例全绿（1.7s） |
| GitHub Release v3.30.1 | ✅ 已验证成功：`Qbao-Setup-3.30.1.exe`（83.4MB）+ `latest.yml` + `*.blockmap` 资产齐全（API 实测） |
| 路由层 | 13 个路由文件全部 asyncHandler + zod schemas（v2 收敛完成，审计 T14/T15 落地） |
| 仓库卫生 | `app/dist`、`uploads/` 均未被 git 跟踪；CI：gitleaks 全历史 + npm audit + 构建 CSP 冒烟 |
| 已知开放项 | 见 §3–§7 任务表（均经代码核验存在） |

---

## 3. P0 — 发布闭环收尾与低风险清理（→ v3.30.2）

目标：发布链路确认闭环；把审计剩余的低风险、小改动项一次性清干净，恢复稳定提交节奏。

| 编号 | 任务 | 位置 | 验收标准 |
|------|------|------|---------|
| P0.1 | 核对 v3.30.1 Release 产物 | GitHub Releases | ✅ 已完成（2026-09-03）：exe / latest.yml / blockmap 齐全，release.yml 链路可用 |
| P0.2 | 桌面升级链路冒烟 | desktop/updater.js | 已装 v3.30.0 的机器能校验到 v3.30.1 并完成升级（electron-updater 手动确认流程）；结果记入 local/log.md |
| P0.3 | E2E 回归资产入库 | `.tmp/`（qa-*.cjs、probe-*.cjs、vision-qa-*.json 等）→ `tools/e2e/` | 可复用探针/QA 脚本与样例入库 + `tools/e2e/README.md` 用法文档；不再依赖 `.tmp` 与 local 单点 |
| P0.4 | 引入 eslint（app + server） | 两端新增强制配置文件 + `lint` 脚本 | 本地 `npm run lint` 可用；CI 新增 eslint job（错误阻断、警告留痕） |
| P0.5 | 替换 `window.prompt/alert` | `app/src/services/api.js:40-46`（4 处，服务器地址设置） | 改为应用内弹层/确认框；代码中无原生 prompt/alert 残留 |
| P0.6 | renderMarkdown 占位符伪造防护 | `app/src/services/utils.js:61-94`（`%%DM%d%%`/`%%IM%d%%` 还原） | 用户输入含伪占位符时不误渲染、不报错；补单测 |
| P0.7 | AI 配额 TOCTOU | `server/src/services/pointsService.js`（checkAndChargeAiQuota）+ `server/src/routes/ai.routes.js:26,155` | 计数与扣费原子化（事务/行锁），并发用例覆盖（免费额度边界） |
| P0.8 | AI 上传配额失败清理落盘文件 | `server/src/routes/ai.routes.js:155` 附近 | 配额/校验抛错时本次已落盘文件被删除（防磁盘耗尽）；补测试 |
| P0.9 | 收尾发布 | CHANGELOG / 三端版本 / 提交 / tag | v3.30.2 发布（或并入 v3.31，视改动面），DoD 全过 |

---

## 4. P1 — 数据面可靠性（→ v3.31）

目标：v3.30 本地持久化分层与同步链路在真实场景下回归验证；消灭「无变化也全量 PUT」的写放大；密钥存放加固。

| 编号 | 任务 | 位置 | 验收标准 |
|------|------|------|---------|
| P1.1 | 分层持久化 E2E 回归 | `app/src/services/persistence.js`、`services/stateDb.js`、`core/boot.js` | ✅ 已完成（2026-09-03）：tools/e2e/probe-p1-persistence.cjs 真实 Electron 留档（2100 题启动/刷新续答第 38 题/骨架 1.1KB/IDB 分流/多账号隔离/离线 pending+IDB） |
| P1.2 | 同步写收敛 | `app/src/services/sync.js`、`stores/data.js` | ✅ 已完成（2026-09-03）：空推跳过（脱敏推送指纹+rev 基线）、pending/lastSync 按账号隔离、keepalive 同检测、resumePendingSync 返回 Promise；引擎级单测 5 例（门闩/多账号/空推/rev 预检/409 重推） |
| P1.3 | 密钥存储加固 | `desktop/main.js` + `preload.js`（safeStorage）、`app/src/services/aiKeys.js`、`services/api.js` | ✅ 已完成（2026-09-03）：桌面 token/AI Key 走主进程 safeStorage（renderer 无明文持久化），启动预热+旧明文迁移+不可用降级；网页端最小混淆+设置页提示；单测 20 例 |
| P1.4 | store 层单测补位 | `app/src/stores/`（ai/quiz/chat/users） | ✅ 已完成（2026-09-03）：4 store 共 27 例；修复 getActiveSet userAnswers 写穿透（重开一轮不落盘）与 restoreFromText 指针落盘时序 |
| P1.5 | 收尾发布 | CHANGELOG / 三端版本 / 提交 / tag | ✅ 已完成（2026-09-03）：v3.31.0 三端对齐 + 提交 + tag v3.31.0 |

---

## 5. P2 — 架构收敛（→ v3.32）

目标：35KB 级 store 与 30KB 级组件拆到可维护粒度；API 封装归一；长聊天列表窗口化渲染。

| 编号 | 任务 | 位置 | 验收标准 |
|------|------|------|---------|
| P2.1 | store 拆分 | `stores/ai.js`（35.3KB：上传/队列/服务端协调）、`stores/users.js`（14.1KB） | ✅ 已完成（2026-09-03）：ai.js 35.3→17KB（生成核心→aiTasks.js、服务端任务→aiServerTasks.js、资料→aiMaterials.js、历史统计→aiHistory.js）；users.js 原 14.1KB 达标；+8 例单测 |
| P2.2 | 巨型组件拆分 | `views/SubjectDashView.vue`（33.7KB）、`components/AdminTab.vue`（29.6KB）、`SettingsModal.vue`（22.4KB） | ✅ 已完成（2026-09-03）：SettingsModal 23.7→15.6KB（AiConfigSection）、AdminTab 29.6→15.5KB（Notices/Users 两区）、SubjectDashView 33.7→26.1KB（SubjectOverviewPanel） |
| P2.3 | API 封装统一 | `services/aiApi.js`（裸 fetch）、`services/api.js`（重复 _handle）、readApiErrorSafe/readApiError 合并、`noticesApi.getAdminNotices` 死代码 | ✅ 已完成（2026-09-03）：apiFetch/apiHandle 统一（3 处私有 _handle 删除）、aiApi 收敛、死代码清理、+6 例单测 |
| P2.4 | 聊天虚拟滚动 | `components/features/chat/ChatMessages.vue`（19.9KB） | ✅ 已完成（2026-09-03）：窗口化渲染（chatVirtual.js 纯窗口计算，4 例单测）；Electron 探针实测 1000 条消息仅渲染 ~11 节点并留档 |
| P2.5 | 发布断言 | `.github/workflows/release.yml` | ✅ 已完成（2026-09-03）：版本-tag 断言步骤 + 三要素产物存在性检查 |
| P2.6 | 收尾发布 | CHANGELOG / 三端版本 / 提交 / tag | ✅ 已完成（2026-09-03）：v3.32.0 三端对齐 + 提交 + tag v3.32.0 |

---

## 6. P3 — 产品功能（→ v3.33）

目标：给答题链路补闭环价值（错题讲解）与数据资产（题库导入导出）。

| 编号 | 任务 | 位置/说明 | 验收标准 |
|------|------|----------|---------|
| P3.1 | 错题本 + AI 错题讲解 | 复用「我不懂」标记与答题记录；新增服务端讲解端点（非流式、成功才计费、zod 校验、走 openaiCompatible 工厂） | ✅ 已完成（2026-09-03）：/ai/explain 端点（8 例测试）+ 错题本页签（章节过滤/我的 vs 标准答案）+ wrongBook 缓存回看（LRU 200）+ 2 例 store 测试 |
| P3.2 | 题库导入导出 | 前端批量导入（JSON/CSV）+ 校验预览 + 幂等去重；导出 JSON | ✅ 已完成（2026-09-03）：文件/粘贴导入 + JSON/CSV 自动识别 + 签名去重（8 例纯函数单测）+ 章节导出 JSON（round-trip） |
| P3.3 | 批量编辑（容量允许时） | 题目列表多选：改章节 / 删除 / 题型标签 | ✅ 已完成（2026-09-03）：题库批量模式——移动章节/删除（题库+轮次+SRS 同步清理）/设标签 |
| P3.4 | 收尾发布 | CHANGELOG / 三端版本 / 提交 / tag | ✅ 已完成（2026-09-03）：v3.33.0 三端对齐 + 提交 + tag v3.33.0 |

> 容量约定：若单个 P 超出 1 轮容量，续轮先完成同一 P（不跨 P），并在 §0 状态表注明「进行中」。

---

## 7. 积压（不入轮，条件成熟时再触发）

- **工程化**：Docker Compose（nginx + server + postgres，消除 systemd/PM2 文档二义）、pino 结构化日志 + 健康/指标端点、Electron 代码签名（需证书，SmartScreen 红屏）、updateChannel 实现或移除、Express 5 / multer 2 / helmet 调研升级、渐进 TypeScript。
- **数据**：同步冲突精确（按时间戳）裁决与按实体拆表（长期）。
- **产品**：排行榜与学习数据可视化、PWA + 离线优先、i18n、a11y 审计。
- **安全**：纵深防御评估（CSRF 同源核对、桌面端 update 校验策略复查）。

---

## 8. 风险与依赖

| 风险 | 缓解 |
|------|------|
| 停更约 2 周，v3.30.1 真实环境回归不足 | 每轮开工先跑基线测试（§1.1-2），P0.3 入库的 E2E 脚本用于真实场景回归 |
| Windows 上 vitest forks 偶发崩溃 | 本地/CI 固定 `--pool=forks --poolOptions.forks.maxForks=2`；CI 跑 ubuntu（release job 已去测试） |
| P1.3 safeStorage 涉及主进程 IPC，改动面较大 | 独立成批：先桌面端（IPC 加密读写）后网页端（最小混淆兜底）；不动云端同步语义 |
| 发布依赖 tag 触发 GitHub Actions | 每轮结束即更新 CHANGELOG 与三端版本；tag 时机按改动面选择 |
| P3 功能依赖 AI Provider 可用性 | 讲解端点复用现有 provider 工厂与失败降级（非流式、成功计费） |

---

## 9. 变更记录

- **2026-09-03**：初版。基于当日全仓复检（测试双端全绿、Release 资产实测、债务位置逐项核验）；P0.1 标记为已完成态。
- **2026-09-03（P0 轮完成）**：P0.2–P0.9 全部落地 → v3.30.2。P0.2 配置级核验完成（实机升级冒烟留待人工，见 local/log.md）；P0.3 E2E 资产入库 tools/e2e/；P0.4 eslint（app/server + CI，0 error）；P0.5 原生 prompt/alert 全清；P0.6 占位符盐 + 4 用例；P0.7 配额原子化（advisory 锁）+ 3 用例；P0.8 上传残留清理 + 路由用例；测试基线升至 server 146 / app 38。
- **2026-09-03（P1 轮完成）**：P1.1–P1.5 全部落地 → v3.31.0。P1.1 分层持久化 E2E 留档（探针真实 Electron 跑通，报告 tools/e2e/out/）；P1.2 同步写收敛（空推跳过/账号隔离 pending/keepalive 同检测，引擎级 5 例）；P1.3 桌面 safeStorage（DPAPI）密钥存储 + 网页最小混淆 + 预热迁移（20 例）；P1.4 store 单测 27 例并修复 2 个数据缺陷；v3.30.2 Release 资产核实（CI/Release Actions 均成功）；测试基线 app 38 → 92（14 文件）。
- **2026-09-03（P2 轮完成）**：P2.1–P2.6 全部落地 → v3.32.0。P2.1 store 拆分（ai.js 35.3→17KB，4 个关注点模块）；P2.2 三组件拆分（SettingsModal/AdminTab/SubjectDashView 各拆出子组件）；P2.3 API 统一（apiFetch/apiHandle，删 3 份 _handle + 死代码）；P2.4 聊天虚拟滚动（chatVirtual 纯函数 + Electron 探针实测 11 节点/1000 条）；P2.5 release 版本-tag 断言；测试基线 app 92 → 108（17 文件）。
- **2026-09-03（P3 轮完成）**：P3.1–P3.4 全部落地 → v3.33.0。P3.1 错题本 + /ai/explain 讲解端点（成功计费，8+2 例测试，wrongBook LRU 缓存回看）；P3.2 题库导入导出（JSON/CSV 自动识别 + 签名幂等去重 + 导出 round-trip，8 例纯函数单测）；P3.3 题库批量编辑（移动/删除/标签）；探针 probe-p3-wrongbook.cjs 留档；P0–P3 全部完成。测试基线 app 108 → 118（18 文件）、server 146 → 154。
