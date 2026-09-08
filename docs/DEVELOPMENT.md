# 开发指南

## 1. GitHub 与本地信息分离（隐私铁律）

| 内容 | 位置 | 是否上传 GitHub |
|------|------|----------------|
| 前端代码 | `app/` | ✅ |
| 后端代码 | `server/` | ✅ |
| 公开文档 | `docs/`、根目录 `*.md` | ✅ |
| 密钥/证书 | `local/keys/`、`local/wg-*.conf` | ❌ |
| 用户数据与分析 | `local/my_data/`、`local/analysis/`、`local/console/` | ❌ |
| 开发日志 | `local/log.md` | ❌ |
| 版本快照 | `local/Version/` | ❌ |
| 历史备份 bundle | `local/*.bundle` | ❌ |
| 环境真实值对照（域名 / IP / 部署根 / 服务名） | `local/ENV.md` | ❌ |
| 部署参数（SSH 主机 / 密钥 / 远端目录 / 服务名） | `local/stage.env.ps1` | ❌ |

**铁律**：真实服务器地址、密钥、用户数据、VPN 配置一律只放 `local/`（已被 `.gitignore` 整体排除）。部署文档只用占位符。
公开文档统一占位符：{DOMAIN}/{BETA_HOST} 域名、{ORIGIN_IP}/{HK_IP} IP、{PROD_ROOT}/{BETA_ROOT} 部署根、{BACKUP_DIR} 备份目录、{SSH_USER} 服务器用户；
提交前对改动文件做敏感词扫描（真实域名 / IP / 密钥模式不得出现在跟踪文件中）。
CI 另有 privacy-guard job（`.github/workflows/ci.yml`）硬性拦截真实基础设施痕迹（源站 IP / 私钥文件名 / 部署根路径 / 真实微信 AppID），命中即构建失败。

## 2. 目录结构

```
Qbao/
├── app/            # 前端 SPA（Vue 3 + Vite + Pinia，源码 src/，构建产物 dist/，网页与桌面共用）
├── desktop/        # Electron 桌面壳（main/preload/updater，配置见 desktop/README）
├── server/         # Node.js 后端
│   ├── src/        # routes/ providers/ 中间件
│   ├── sql/        # 数据库迁移
│   ├── scripts/    # 诊断/迁移/引导脚本（run_migration.js、bootstrap_admin.js）
│   ├── deploy/     # systemd 单元 + prepare_dirs.sh + 部署说明
│   └── init.sql    # 建库脚本
├── docs/           # 架构/部署/开发文档（公开）
├── tools/          # 一次性维护脚本（默认不上传，见 tools/README）
├── local/          # 【本地专用】隐私文件，永不上传
├── CHANGELOG.md    # 公开版本日志
└── README.md
```

## 3. 本地启动

```bash
# 后端
cd server
npm install
cp .env.example .env     # 配置数据库与 JWT_SECRET
npm run dev              # node --watch，改动自动重启

# 前端（Vue 3 + Vite 工程）
cd app
npm install
npm run dev                          # Vite dev server（HMR，默认 http://localhost:5173）
npm run build                        # 构建 singlefile 产物到 app/dist/

# 桌面端（Electron）
cd desktop
npm install
npm run dev                          # 加载 Vite dev server；未启动时自动回退 app/dist/index.html
# 生产静态服务（nginx 指向 app/dist/，配置见 docs/DEPLOY.md）
```

## 4. 版本与发布流程

1. 功能开发完成后提交：`git commit -m "feat: 描述"`；发布提交带版本号：`v3.25: ...`。
2. **本地快照**（惯例）：发布前把工作副本复制到 `local/Version/Qbao_vX.Y.Z_<主题>/` 留存。
3. 更新 `CHANGELOG.md`（公开摘要），开发细节写 `local/log.md`（不公开）。
4. 推送 GitHub；正式版本打 tag（规划中，配合 GitHub Release）。

## 5. 诊断脚本

```bash
# 直接测 ECNU 出题（流式/非流式 + response_format 组合）
node server/scripts/diagnose_ai.js <api_key> [model]
# 端到端测 /api/v1/ai/generate（需本地后端跑在 3001）
node server/scripts/diagnose_api.js <api_key> [model] [jwt_token]
```

## 6. 测试与 CI

- **后端**：`cd server && npx vitest run --pool=forks --poolOptions.forks.maxForks=2`（fake pool 不依赖真实数据库；forks+maxForks=2 为稳定性参数，CI 已固定）。
- **前端**：`cd app && npx vitest run`。
- **套件规模基线**（随迭代刷新；唯一出处 = docs/DEVELOPMENT_FLOW.md §5）：server 233 / app 250 / scripts 6 / desktop 5（2026-09-08 复核）。
- **构建**：`cd app && npm run build`（Vite singlefile → dist/index.html，含 CSP；CI 冒烟校验）。
- **CI**（`.github/workflows/ci.yml`）：gitleaks 密钥扫描 → 公开脱敏扫描（privacy-guard，§1 护栏）→ 后端语法+测试 → 前端构建冒烟+单测 → 双方 npm audit（高危告警不阻断）。
- 新增/修改逻辑时按模块补测试：routes 用 supertest + installFakePool；纯函数直接单测。

## 7. 数据库变更

- 新增迁移文件放 `server/sql/`，命名 `NNN_描述.sql`（序号递增），SQL 保持幂等（IF NOT EXISTS）。
- 本地执行：`cd server && node scripts/run_migration.js`（自动应用未执行项并记入 schema_migrations）。
- 查看待执行：`node scripts/run_migration.js --list`；旧库手工迁移过：先 `node scripts/run_migration.js --mark-applied`。


新表/字段变更：在 `server/sql/` 新增 `migration_vX.Y.sql`（幂等写法：`ALTER TABLE ... IF NOT EXISTS` 或先判断），新装环境按文件名顺序执行即可。