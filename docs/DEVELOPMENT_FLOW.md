# 开发上线流程规范

> 版本 v1.1 · 生效 2026-09-05 · 本文档为本开发流程的**唯一事实源**（CHANGELOG 只记产品变更）。
> 配套文档：环境与隐私铁律见 `docs/DEVELOPMENT.md`，部署细节见 `docs/DEPLOY.md`，桌面端发布/事故处置见 `docs/PUBLISHING.md`。

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
⑥ 部署网页端（app + server，生产）；如需要真实桌面验证，同步构建测试版 → beta 渠道
      ↓
⑦ CDP 冒烟自检
      ↓
⑧ 用户验收（Ctrl+F5 强刷 → 测试；桌面端可装 beta 渠道测试版实测）
      ├─ 通过 → ⑨ git push + tag vX.Y.Z（稳定版）→ ⑩ Release 构建 → ⑪ 收尾（含搬包入库 + 公网验证）
      └─ 不通过 → 回 ③/⑤ 继续本地修复，重新 ⑥⑦⑧，绝不推送
```

一句话：**网页先行、验收后门 —— push/tag/Release 的唯一门票是用户明确说「测试通过」。**

## 2. 阶段总表

| 阶段 | 动作 | 产出 | 责任人 |
|------|------|------|--------|
| ① 需求 | 用户提出要求 | 明确的问题/需求条目 | 用户 |
| ② 方案 | 影响面大或有歧义时先给一句话方案，确认后再动手 | 确认过的方案 | 双方 |
| ③ 修改 | 先定位根因（日志/复现证据）→ 修改 → 按需补测试 | 干净的代码 | Agent |
| ④ DoD | 见 §4 清单，全部通过才允许部署 | 通过清单 | Agent |
| ⑤ 版本+提交 | 三端版本对齐、CHANGELOG 条目、`git commit`（本地） | 本地提交（回滚点） | Agent |
| ⑥ 部署网页端 | 本地工作树直接打包部署，不依赖 GitHub；可选构建桌面端测试版 → beta 渠道 | 生产新版（+测试版） | Agent |
| ⑦ 冒烟 | CDP 回归改动点 + 主流程，0 异常；产物 sha256 校验 | 冒烟报告 | Agent |
| ⑧ 用户验收 | 通知测试清单，等待明确结论 | 验收结论 | 用户 |
| ⑨ 推送 | `git push origin main` + `git tag vX.Y.Z` + push tag（稳定版） | 远端提交与标签 | Agent |
| ⑩ Release | GitHub Actions「Release 桌面版构建」→ 校验发布资产 | 公开发布 | Agent |
| ⑪ 收尾 | 按 PUBLISHING.md 搬包入库（add）+ 公网逐字节验证；`local/log.md` 记录 | 日志 | Agent |

## 3. 阶段细则

### 3A. 版本与渠道纪律（v1.1 新增）

| 态 | 版本号 | 构建方式 | 分发入口 | 强制更新 |
|---|---|---|---|---|
| 开发态 | 三端 = X.Y.Z | 无安装包产出 | 无 | — |
| 测试态 | 构建时覆盖 `X.Y.Z-beta.N`（`npx electron-builder --win nsis --publish never --config.extraMetadata.version=X.Y.Z-beta.N`，**不改任何跟踪文件、不推 tag、不进 CHANGELOG**） | 本地构建 | 服务器 beta 渠道（`publish-installer add --channel beta`）；测试者设 `updateChannel: beta` | **永不**（工具+服务端双重拒绝） |
| 稳定态 | `X.Y.Z`（三端对齐，验收后 bump） | 正式 tag → CI Release → GitHub 归档 | 服务器 stable 渠道（`add --channel stable`）；普通用户默认自动更新 | 仅显式 `promote --required`，白名单：API 破坏性变更 / 安全漏洞 / 数据迁移 |

规则（工具强制，非约定）：
- `add --channel stable` 拒绝 prerelease 版本号；beta 渠道永不进入 stable；release.yml 对含 `-` 的 tag 整体跳过（测试版 tag 不会误发稳定版 Release）。
- **required 默认不存在**；普通版本更新永远由用户确认。强制更新只作用于自动更新通道，手动下载通道（桌面端历史版本/网页/ /dl）始终提供全部留存旧版，用户可自行覆盖安装回退（不丢数据）。
- **恶性 bug 两级机制**：用户自助回退（自行下载旧版）+ 维护者 `retract`（latest 自动回退上一版本、自动清除相关 required 防升级死循环、下载端点 410、桌面端撤回感知提示）。详见 docs/PUBLISHING.md §4。
- 测试版构建时机：仅当(1)需要真实桌面机器验证（更新机制/安装行为/开机自启等网页端无法覆盖的能力）；(2)用户要求试用。常规迭代不产出测试包。

### ③ 修改
- 每次动代码先给根因（以日志/线上 state/复现脚本为证据），说明「修症状」还是「修根因」的取舍。
- 修改小步、局部；同一轮涉及多个无关问题时逐条编号，对应 ⑪ 的日志条目。
- 涉及数据库变更：`server/sql/` 提供幂等迁移脚本，编号递增（当前已到 013），并本地验证迁移可重复执行。

### ④ DoD（部署前必须全绿）
- `server`: `npx vitest run` 全绿（基线 166 用例，v3.35 后 187）
- `app`: `npx vitest run` 全绿（基线 175 用例，v3.35 后 177，v3.36 后 203）；**登录门禁（v3.36.1）：未登录整页登录门禁、匿名零写盘（公共键停用）、匿名改动锁重建**
- **手机竖屏检查（v3.36 新增，涉及展示层改动时必做）**：≤768px（360/390 两档）无横向滚动、输入控件 ≥16px（iOS 不聚焦缩放）、主操作按钮 ≤1 屏内可达、无「查看报告」章节入口、活动会话大键不落 localStorage（>1MB 走 IndexedDB）
- **科目总览数字自洽检查（v3.37 新增，涉及看板/统计改动时必做）**：总览与题库 tab 章节头/侧栏题量同数；环形图分母 = 图例合计；累计作答 = 客观 + 主观（可验算）；无实答客观题显示「—」而非 0%/100%；跳过（-1）不计入正确率；科目级数字 = Σ章节（单测锁定）
- `scripts`: `node --test scripts/installer-lib.test.js` 全绿（发布工具，零依赖）
- `desktop`: `node --check main.js preload.js updater.js updater-util.js` + `node --test desktop/test` 全绿
- `npx eslint .`（app/server）0 error
- `app`: `npx vite build` 成功；`dist/index.html` 大小**以字节核对**（坑：UTF-16 长度 ≠ 字节数）
- 改动涉及 Vue 模板时：compiler-sfc 扫描全部 vue 文件，确认无悬空模板绑定（改动后新增引用也纳入）

### ⑤ 版本与提交
- 版本号 `vMAJOR.MINOR.PATCH` 三端对齐：app/server/desktop 的 `package.json` + `package-lock.json` 的 `packages[""].version`（旧版 `lock.version` 字段不动，npm ci 容忍）；**一律 JSON parse/stringify 更新，禁止文本替换锁文件**（v3.34.1 事故教训）。
- 测试态不参与版本对齐（extraMetadata 构建覆盖，跟踪文件保持正式版本号）。
- `CHANGELOG.md` 顶部追加条目：修复/功能项 + 测试数量 + 版本号，格式沿用历史条目。
- `git add`（仅本次改动文件）→ `git commit -m "v3.x.x: <中文摘要>"`（**只本地提交，不 push**，为部署提供回滚点）。
- 严禁把服务器地址/凭据/密钥写入任何跟踪文件（见 docs/DEVELOPMENT.md §1 隐私铁律）。

### ⑥ 部署网页端（不依赖 GitHub，从本地工作树）
- 打包：server tgz（排除 `node_modules/`、`.env`、`uploads/`）；app 用 `-C app/dist .` 打根级 tgz（不带 `dist/` 前缀）。
- 传输：走 `local/` 的 pem（ssh/scp），凭据不落盘到跟踪文件。
- 应用：远端 deploy 脚本（保留 `node_modules/` `.env` `.backup*` `downloads/`；`run_migration.js` 应用新迁移（含 013）；`systemctl restart`；app 先删 `index.html`/`img`/`vendor`/`favicon.svg` 再解包）。
- 校验：systemd active、`/health` OK、迁移数符合预期、`index.html` 字节数与 sha256 与本地一致；nginx 如有新 location（如 `/dl`）需同步修改并备份（.bak_rN）。
- 桌面端**稳定版**不在本阶段产出：由 ⑩ GitHub Actions 构建（验收通过后）；如需真实机器验证可在本阶段构建测试版 → beta 渠道（PUBLISHING.md §7）。

### ⑦ 冒烟（Agent 自检，不等用户）
- CDP（Edge remote-debugging，端口见 local/ 记录）连生产页面，执行登录 + 本次改动点 + 2~3 条主流程（按改动范围选：题库/出题/复习/设置…）。
- 桌面分发类改动额外验证：`/api/v1/desktop/manifest`、`/download?file=`（含 404/410）、`/update/<channel>/latest.yml`、`/dl`、`/download` 302；Range 206 与统计计数。
- 全程 Runtime 异常计数 = 0；关键状态通过 `window.__pinia` 内省确认。
- 冒烟失败 → 回 ③ 或 ⑥，不得进入 ⑧。

### ⑧ 用户验收
- Agent 通知：「已部署 v3.x.x，请 **Ctrl+F5 强刷** 后测试：<待测清单>」；桌面端功能验证可提供 beta 渠道测试版（版本号如 3.35.0-beta.1）。
- 用户明确给出「测试通过」之前，**禁止** ⑨/⑩。同一轮可多次迭代：不通过 → 本地修复 → 重新部署 → 再验收；GitHub 上始终不存在任何未验收内容。

### ⑨ 推送
- 前置：Clash Verge 运行且 127.0.0.1:7897 可达（GitHub 走 SOCKS 代理）。
- `git push origin main` → `git tag v3.x.x` → `git push origin v3.x.x`（稳定版 tag 不含 `-`；测试版不推 tag）。
- 大功能可走 feature 分支 + PR，但验收门槛不变：合并进 main 前必须先过 ⑧。

### ⑩ Release
- 等待 GitHub Actions「Release 桌面版构建」success（job 级守卫：tag 含 `-` 自动跳过），核对发布资产齐全（三端版本一致，含 release 版本断言）。

### ⑪ 收尾
- 稳定版：按 docs/PUBLISHING.md §3 搬包入库（签名直链 → digest 核对 → `add --channel stable` → 公网逐字节验证）。
- `local/log.md` 追加：需求、根因、修复、验证数据、测试版/稳定版发布记录、残余风险。
- 提醒用户强刷；涉及桌面端时提示等待更新推送。

## 4. 回滚

| 场景 | 操作 |
|------|------|
| 网页端回滚 | 服务器 `.backup*` 恢复，或重新部署上一验收版本的工作树构建；不影响 git |
| 未推送的本地提交 | `git reset` / `git commit --amend` 清理 |
| 已推送的缺陷版本 | revert 或新版本修复 + 新 tag；旧 tag 不动 |
| 稳定渠道坏版本（恶性 bug） | `retract` 熔断（latest 自动回退）+ 用户自助下载旧版重装 + 修复版走 beta → 新稳定版 |
| beta 渠道坏版本 | 删除 beta 渠道该版本条目（文件人工清理） |
| manifest 损坏 | 恢复 downloads/manifest.json.bak |
| 生产事故 | 先 ⑥ 应急部署修复恢复服务，再走 ⑧⑨（红线不变：仍须验收后才推送） |

## 5. 硬性红线

1. **push/tag/Release 只允许在用户明确验收之后**——无例外，包括紧急修复。
2. 生产地址、凭据、密钥、用户数据永不进 git 跟踪文件（一律占位符）。
3. DoD 未全绿不允许部署。
4. 每次部署前服务器保留备份；部署顺序固定：本地提交 → 部署 → 验收 → 推送。
5. **测试版永不进入 stable 渠道；required 仅限 stable 且必须显式 promote 设置**（工具强制，见 PUBLISHING.md）。

## 6. 例外与备注

- 纯文档/流程类改动（如本文档）无网页可测：本地提交后，随下一个验收通过的版本一并推送，或用户明确指示立即推送。
- 紧急修复可压缩 ②③⑥⑦ 的节奏，但 ⑧→⑨ 的闸门不变。
- **视觉校验（v3.34 增补）**：开发/测试中需要图片类视觉判断（界面截图审阅、视觉回归、图像内容校验）时，统一交给视觉模型 **ecnu-plus** 分析——当前日常默认模型 ecnu-max 无视觉能力，这是工作方式约定，不属于产品功能。
- 本规范修订：更新版本号 + `local/log.md` 记录变更；修订后以此文件为准。