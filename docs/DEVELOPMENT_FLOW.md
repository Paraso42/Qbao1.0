# 开发上线流程规范

> 版本 v1.3 · 生效 2026-09-08 · 本文档为开发流程的**唯一事实源**（CHANGELOG 只记产品变更）。
> 配套文档：环境与网络地图（L0/L1/L2 概念与内测入口）见 `docs/ENVIRONMENTS.md`；架构事实源（HTTPS 链路 / 环境路由 / 安全边界）见 `docs/ARCHITECTURE.md`；环境与隐私铁律见 `docs/DEVELOPMENT.md`；
> 部署细节见 `docs/DEPLOY.md`（含 §4B 内测环境）；桌面端发布/事故处置见 `docs/PUBLISHING.md`；游戏测试与内测规范见 `docs/GAMES.md` 第六节。

## 1. 总则（核心节奏）

```
① 提出要求（用户）
      ↓
② 方案确认（影响面大/有歧义时，先一句话方案再动手）
      ↓
③ 代码修改 + ④ 本地 DoD 全绿
      ↓
⑤ 版本对齐 + CHANGELOG + 本地 commit（不 push）
      ↓
⑥ 部署 L1 内测环境（同步代码/静态 → 内测库迁移 → 重启内测服务）+ L1 自动冒烟（可写 E2E，断言只写内测库）
      ↓（需要同学试用时：把内测网址发给受邀者）
⑦ 用户验收（默认在内测环境进行；「测试通过」前禁止部署生产）
      ├─ 通过 → ⑧ 部署 L2 生产 + 生产只读巡检（金丝雀账号，零写操作）
      │        ↓
      │      ⑨ git push + tag vX.Y.Z（稳定版）→ ⑩ Release 构建 → ⑪ 收尾（含公网验证）
      └─ 不通过 → 回 ③/⑤ 继续本地修复，重走 ⑥⑦⑧，绝不推送
```

一句话：**内测先行、验收后门 —— push/tag/Release 的唯一门票是用户明确说「测试通过」；生产库永不用于测试写入。**

### 为什么引入内测环境（v1.2 变更说明）

v1.1 及以前：本地测完直接部署生产，测试动作（测试账号、对局、兑换、清库实验）都发生在唯一的生产环境上，
真实用户可能看到半成品，测试数据混进真实账本。v1.2 起新增 **L1 内测环境**（独立数据库 qbao_beta、
独立 API 端口、独立静态目录、不缓存），所有测试/内测先在 L1 完成，验收通过后才上生产。

## 2. 阶段总表

| 阶段 | 动作 | 产出 | 责任人 |
|------|------|------|--------|
| ① 需求 | 用户提出要求 | 明确的问题/需求条目 | 用户 |
| ② 方案 | 影响面大或有歧义时先给一句话方案，确认后再动手 | 确认过的方案 | 双方 |
| ③ 修改 | 先定位根因（日志/复现证据）→ 修改 → 按需补测试 | 干净的代码 | Agent |
| ④ DoD | 见 §5 清单，全部通过才允许部署 | 通过清单 | Agent |
| ⑤ 版本+提交 | 三端版本对齐、CHANGELOG 条目、`git commit`（本地） | 本地提交（回滚点） | Agent |
| ⑥ 部署 L1 | 同步 server/app 到内测目录 → 内测库迁移 → 重启内测服务 → L1 冒烟（可写 E2E）；按需分发内测网址 | 内测新版 + 冒烟报告 | Agent |
| ⑦ 用户验收 | 用户在内测网址测试（或按 §3 例外直接在生产验收），等待明确结论 | 验收结论 | 用户 |
| ⑧ 部署 L2 | 仅当 ⑦ 通过：同步到生产目录（先备份）→ 生产库迁移 → 重启生产服务 → 生产只读巡检（金丝雀） | 生产新版 + 巡检报告 | Agent |
| ⑨ 推送 | `git push origin main` + `git tag vX.Y.Z` + push tag（稳定版） | 远端提交与标签 | Agent |
| ⑩ Release | GitHub Actions「Release 桌面版构建」→ 校验发布资产 | 公开发布 | Agent |
| ⑪ 收尾 | 按 PUBLISHING.md 搬包入库（add）+ 公网逐字节验证；L1 保持与 L2 同步；`local/log.md` 记录 | 日志 | Agent |

## 3. 环境纪律（L0 / L1 / L2，v1.2 新增）

| | L0 本机 | L1 内测（默认验收点） | L2 生产（真实用户） |
|---|---|---|---|
| 入口 | 本地端口（游戏静态 127.0.0.1:8124 等） | 内测域名（见 local/ENV.md） | 生产域名与 IP 直连 |
| 数据库 | 无（单测假库） | qbao_beta（可随时重建） | qbao（禁测试写入） |
| API | — | 源站 :3100（qbao-api-beta） | 源站 :3000（qbao-api） |
| 静态 | 仓库源码 | qbao-beta 目录（不缓存） | 生产目录（静态 7 天缓存） |
| 允许动作 | 写码/单测/本地页面 | 注册/对局/兑换/领奖/清库/压测 | 只读巡检（金丝雀账号） |
| 部署工具 | — | scripts/stage.ps1 -Env beta | scripts/stage.ps1 -Env prod |

**必须走 L1 再上 L2 的改动类型**：数据库迁移、经济/积分规则、新游戏接入、游戏云存档逻辑、账号/鉴权、
任何产生写操作的端到端验证。**例外**：纯展示/文案类小改动可在 L1 冒烟后直接上生产验收；
紧急修复可压缩 ②③⑥ 的节奏（先 L1 快验再上 L2），但 ⑦→⑧ 与 ⑨ 的闸门不变。

## 4. 阶段细则

### 4A. 版本与渠道纪律（沿用 v1.1）

| 态 | 版本号 | 构建方式 | 分发入口 | 强制更新 |
|---|---|---|---|---|
| 开发态 | 三端 = X.Y.Z | 无安装包产出 | 无 | — |
| 测试态 | 构建时覆盖 `X.Y.Z-beta.N`（`npx electron-builder --win nsis --publish never --config.extraMetadata.version=X.Y.Z-beta.N`，**不改任何跟踪文件、不推 tag、不进 CHANGELOG**） | 本地构建 | 服务器 beta 渠道（`publish-installer add --channel beta`）；测试者设 `updateChannel: beta` | **永不**（工具+服务端双重拒绝） |
| 稳定态 | `X.Y.Z`（三端对齐，验收后 bump） | 正式 tag → CI Release → GitHub 归档 | 服务器 stable 渠道（`add --channel stable`）；普通用户默认自动更新 | 仅显式 `promote --required`，白名单：API 破坏性变更 / 安全漏洞 / 数据迁移 |

规则（工具强制，非约定）：
- `add --channel stable` 拒绝 prerelease 版本号；beta 渠道永不进入 stable；release.yml 对含 `-` 的 tag 整体跳过。
- **required 默认不存在**；普通版本更新永远由用户确认。强制更新只作用于自动更新通道，手动下载通道始终提供全部留存旧版。
- 恶性 bug 两级机制：用户自助回退 + 维护者 `retract`（见 docs/PUBLISHING.md §4）。
- **注意区分两个"beta"**：桌面「安装包 beta 渠道」= 安装包试验通道；「L1 内测环境」= 服务器数据隔离环境。两者正交，可组合使用（内测环境 + 桌面测试包）。
- 测试版构建时机：仅当(1)需要真实桌面机器验证（更新机制/安装行为等网页端无法覆盖的能力）；(2)用户要求试用。常规迭代不产出测试包。

### ③ 修改
- 每次动代码先给根因（以日志/线上 state/复现脚本为证据），说明「修症状」还是「修根因」的取舍。
- 修改小步、局部；同一轮涉及多个无关问题时逐条编号，对应 ⑪ 的日志条目。
- 涉及数据库变更：`server/sql/` 提供幂等迁移脚本，编号递增（当前已到 017），本地验证可重复执行；**迁移先内测库、验收后生产库**。

### ⑤ 版本与提交
- 版本号 `vMAJOR.MINOR.PATCH` 三端对齐：app/server/desktop 的 `package.json` + `package-lock.json` 的 `packages[""].version`；**一律 JSON parse/stringify 更新，禁止文本替换锁文件**（v3.34.1 事故教训）。
- 测试态不参与版本对齐（extraMetadata 构建覆盖）。
- `CHANGELOG.md` 顶部追加条目；`git add`（仅本次改动文件）→ `git commit`（**只本地提交，不 push**，为部署提供回滚点）。
- 严禁把服务器地址/凭据/密钥写入任何跟踪文件（见 docs/DEVELOPMENT.md §1 隐私铁律；真实环境值只放 `local/ENV.md`）。

### ⑥ 部署 L1（内测）
- 同步：`scripts/stage.ps1 -Env beta -Mode all`（server 代码 + app 构建产物/静态游戏 → 内测目录；真实主机/密钥从 gitignored 的 `local/stage.env.ps1` 读取）。
- 迁移：在内测目录执行 `node scripts/run_migration.js`（读内测 .env → qbao_beta）。
- 重启：`systemctl restart qbao-api-beta`；`/health` OK。
- L1 自动冒烟：`scripts/qa/smoke-stage.ps1 -Env beta`（可写 E2E：注册→登录→游戏成绩→弹珠兑换/对局；断言写入 qbao_beta 且生产库零变化）。失败 → 回 ③ 或 ⑥，不得进入 ⑦。
- 需要同学内测时：把内测网址发给受邀者（开放注册；内测页带「内测环境」角标）。

### ⑦ 用户验收
- Agent 通知：「L1 已部署 vX.Y.Z，请打开内测网址测试：<待测清单>」；需要桌面真实验证时提供 beta 渠道测试版。
- 用户明确给出「测试通过」之前，**禁止**部署生产与推送（纯文案/展示例外见 §3）。
- 同一轮可多次迭代：不通过 → 本地修复 → 重新部署 L1 → 再验收。

### ⑧ 部署 L2（生产，仅验收后）+ 只读巡检
- 备份：服务器保留 `.bak_时间戳` 快照（沿用历史惯例）。
- 同步/迁移/重启同 ⑥（目标为生产目录与 qbao 库）；`/health` OK。
- 只读巡检（金丝雀账号，零写操作）：health / 登录 / GET（游戏成绩、弹珠 profile 等）；`index.html` 字节数/sha256 与本地一致；nginx 如有新 location 需同步修改并备份。
- 桌面分发类改动额外验证：`/api/v1/desktop/manifest`、`/download?file=`（含 404/410）、`/update/<channel>/latest.yml`、`/dl`、Range 206 与统计计数。
- 需要界面回归时按需 CDP（Edge remote-debugging）：登录 + 改动点 + 2~3 条主流程，Runtime 异常计数 = 0。
- 缓存提醒：生产静态 7 天缓存 —— 改 js/css 时同步更新页面引用版本参数 ?v=，并提醒用户强刷。

### ⑨ 推送
- 前置：Clash Verge 运行且 127.0.0.1:7897 可达（GitHub 走 SOCKS 代理）。
- `git push origin main` → `git tag v3.x.x` → `git push origin v3.x.x`（稳定版 tag 不含 `-`；测试版不推 tag）。
- 大功能可走 feature 分支 + PR，但验收门槛不变：合并进 main 前必须先过 ⑦⑧。

### ⑩ Release / ⑪ 收尾
- Release：等待 GitHub Actions「Release 桌面版构建」success（job 级守卫：tag 含 `-` 自动跳过），核对发布资产齐全（三端版本一致）。
- 收尾：按 docs/PUBLISHING.md §3 搬包入库 → 公网逐字节验证 → `local/log.md` 追加 → 提醒用户强刷；**L1 保持与 L2 同版本同步**（下次开发直接基于最新）。

## 5. DoD（部署前必须全绿）

- `server`: `npx vitest run` 全绿（基线 233 用例 / 39 文件，2026-09-08 复核）
- `app`: `npx vitest run` 全绿（基线 250 用例 / 27 文件）；**登录门禁：未登录整页登录门禁、匿名零写盘、匿名改动锁重建**
- **手机竖屏检查**（≤768px：360/390 两档）无横向滚动、输入控件 ≥16px、主操作按钮 ≤1 屏内可达、无「查看报告」章节入口、活动会话大键不落 localStorage
- **科目总览数字自洽检查**（涉及看板/统计改动时）：总览与题库 tab 同数；环形图分母 = 图例合计；跳过不计正确率；科目级 = Σ章节（单测锁定）
- `scripts`: `node --test scripts/installer-lib.test.js` 全绿（6 例）
- `desktop`: `node --check main.js preload.js updater.js updater-util.js` + `node --test desktop/test` 全绿（5 例）
- `npx eslint .`（app/server）0 error
- `app`: `npx vite build` 成功；`dist/index.html` 大小**以字节核对**；涉及 Vue 模板时 compiler-sfc 扫描无悬空绑定
- **游戏 QA（新游戏/游戏逻辑改动时）**：宿主门禁单测（`app/src/games/qa-gate`）全绿；游戏 QA 清单见 docs/GAMES.md 第六节

## 6. 回滚

| 场景 | 操作 |
|------|------|
| L1 内测坏了 | 重放上一版本到内测目录 + 重启；或直接重建 qbao_beta（清库脚本，1 分钟内；不涉及任何真实用户） |
| L2 网页端回滚 | 服务器 `.bak*` 恢复，或重新部署上一验收版本的工作树构建；不影响 git |
| 未推送的本地提交 | `git reset` / `git commit --amend` 清理 |
| 已推送的缺陷版本 | revert 或新版本修复 + 新 tag；旧 tag 不动 |
| 稳定渠道坏版本（恶性 bug） | `retract` 熔断 + 用户自助下载旧版重装 + 修复版走 beta → 新稳定版 |
| beta 渠道坏版本 | 删除 beta 渠道该版本条目（文件人工清理） |
| manifest 损坏 | 恢复 downloads/manifest.json.bak |
| 生产事故 | 先应急部署修复恢复服务（压缩节奏），再走验收闸门（红线不变：仍须验收后才推送） |

## 7. 硬性红线

1. **push/tag/Release 只允许在用户明确验收之后**——无例外，包括紧急修复。
2. **生产库禁止任何测试写入**：对局/兑换/领奖/删改只允许发生在 L1 内测库（金丝雀账号仅只读）。
3. **迁移/发布顺序固定：L1 先、L2 后**（数据库迁移两库分别记账）。
4. **游戏 QA 钩子仅限内测域名与 localhost 生效**（生产域名代码层忽略，见 GAMES.md §六）。
5. 生产地址、凭据、密钥、用户数据永不进 git 跟踪文件（真实环境值只放 `local/ENV.md`，部署脚本读 gitignored 配置）。
6. DoD 未全绿不允许部署；每次 L2 部署前服务器保留备份；部署顺序固定：本地提交 → L1 → 验收 → L2 → 推送。
7. 测试版永不进入 stable 渠道；required 仅限 stable 且必须显式 promote 设置。

## 8. 例外与备注

- 纯文档/流程类改动（如本文档）无网页可测：本地提交后，随下一个验收通过的版本一并推送，或用户明确指示立即推送。
- 紧急修复可压缩 ②③⑥ 的节奏，但 ⑦→⑧ 与 ⑨ 的闸门不变。
- **视觉校验（v3.34 增补）**：需要图片类视觉判断（界面截图审阅、视觉回归、图像内容校验）时，统一交给视觉模型分析（工作方式约定，不属于产品功能）。
- 本规范修订：更新版本号 + `local/log.md` 记录变更；修订后以此文件为准。
- 修订记录：v1.3（2026-09-08）—— DoD 基线刷新（server 233 / app 250 / scripts 6 / desktop 5）；配套新增 docs/ARCHITECTURE.md 为架构事实源；公开文档统一占位符 {PROD_ROOT}/{BETA_ROOT}。
