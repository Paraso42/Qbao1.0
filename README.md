# Qbao — 全能互动学习做题引擎

> AI 智能出题 · 间隔复习 · 考试模拟 · 数据复盘 —— 面向个人学习与小组协作的一体化学习平台。
> 网页端在线使用，Windows 桌面端（Electron）双形态。

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
![Frontend](https://img.shields.io/badge/Frontend-Vue%203%20%2F%20Vite-42b883)
![Backend](https://img.shields.io/badge/Backend-Node.js%2FExpress-339933)
![DB](https://img.shields.io/badge/DB-PostgreSQL-4169E1)
![Desktop](https://img.shields.io/badge/Desktop-Electron%2036-47848F)
![Release](https://img.shields.io/badge/Release-v3.37.0-2ea44f)

## 项目简介

Qbao 解决学习中最常见的问题：**资料很多、题源很少、练完没有反馈**。

- 将任意学习资料（PDF / 文本 / 图片）交给 AI，自动生成选择、判断、名词解释、简答题；
- 以「科目 → 章节 → 轮次」组织刷题，配合间隔复习（SRS）计划与错题本，让复习有节奏；
- 科目总览看板以统一口径呈现准确率、进度、连续学习与趋势——每个数字都可验算；
- 好友 / 群聊协作学习，题目与题库一键分享，聊天内直接答题。

网页端与 Windows 桌面端共用同一套前端产物（singlefile），数据经云端同步，多端一致。

## 核心特性

### 🧠 学习闭环

- 科目 / 章节体系、章节折叠定位、答题历史与章节强弱策略分析
- 练习轮次、限时考试、大考卷薄弱点组卷（键盘快捷键、两段式防误触确认）
- 间隔复习（SRS）自动排期；错题本按章聚合，AI 逐题讲解
- 科目总览看板：核心指标卡、掌握度环形图、章节明细、薄弱标签、趋势洞察

### 🤖 AI 能力

- 多 Provider：DeepSeek / OpenAI 兼容 / Gemini / ECNU
- 上传 PDF / 文本 / 图片自动出题（选择 / 判断 / 名词解释 / 简答），LaTeX / KaTeX 公式渲染
- 服务端任务队列后台生成：断点续做、失败自动标记、并发生成锁
- 流式输出 + 严格 JSON 校验；AI Key 用户自管、服务端不落库，成功才计费

### 🔄 数据与同步

- rev 乐观锁云端同步，409 自动合并重推；本地骨架 + IndexedDB 大字段分流
- 多账号、多标签页严格隔离（属主钉扎 + 跨标签守卫，E2E 验证零串账）
- 本地备份 / 云端恢复；题库 JSON / CSV 导入导出、批量移动 / 删除 / 打标

### 👥 协作与平台

- 好友 / 群聊：文字、图片、文件消息，Ctrl+V 粘贴图，消息撤回
- 题目与题库分享，聊天内直接答题
- 成就系统、积分经济（台账审计、防滥用、学期清零）
- 反馈工单闭环：悬浮入口 → 处理 → 用户确认

### 💻 形态与分发

- 网页在线版 + Windows 桌面客户端（Electron 36，自动更新）
- 桌面端自托管更新源：stable / beta 双渠道、强制更新门槛、撤回熔断、历史版本回退
- 移动端响应式专项：竖屏交互规范、触控目标优化、存储配额治理
- 亮 / 暗双主题、字号调节；桌面端密钥 DPAPI 加密

## 快速开始

### 桌面端

从分发页下载最新 `Qbao-Setup-*.exe` 安装，首次启动按引导填写服务器地址即可使用（自动检查并更新）。

### 自托管部署

环境要求：Node.js ≥ 18、PostgreSQL ≥ 13、nginx。

```bash
# 1) 后端
git clone git@github.com:Paraso42/Qbao.git
cd Qbao/server
npm ci
cp .env.example .env            # 配置 PGPASSWORD / JWT_SECRET / AI Key
psql -U postgres -d qbao -f init.sql
node scripts/run_migration.js   # 版本化迁移（schema_migrations 自动追踪）
npm start                       # 默认 3000 端口

# 2) 前端（singlefile 构建产物）
cd ../app && npm ci && npm run build
# 将 app/dist/ 发布到 nginx 静态目录（桌面端内嵌加载同一产物，无需另行部署）
```

完整部署（nginx 配置、HTTPS、备份、升级）见 [docs/DEPLOY.md](docs/DEPLOY.md)。

### 本地开发

```bash
cd server && npm ci --include=dev && npm run dev   # 后端 :3000（node --watch）
cd app    && npm ci && npm run dev                 # 前端 Vite HMR
cd desktop && npm ci && npm run dev                # Electron 窗口
```

## 质量与发布

- **测试**：app 239 + server 183 + scripts 6 + desktop 5 = **433 例**，CI 全绿
- **CI**：gitleaks 全历史密钥扫描 · npm audit · 构建产物冒烟（singlefile + CSP）· Vitest · ESLint 0 error
- **发布纪律**：本地提交 → 部署 → 用户验收「测试通过」→ push + tag（版本与三端断言）→ Release 构建 → 公网逐字节核验（见 [docs/DEVELOPMENT_FLOW.md](docs/DEVELOPMENT_FLOW.md)）
- 完整版本历史见 [CHANGELOG.md](CHANGELOG.md) 与 [Releases](https://github.com/Paraso42/Qbao/releases)

## 文档

| 文档 | 内容 |
|------|------|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 架构说明、模块清单、技术债追踪 |
| [docs/DEPLOY.md](docs/DEPLOY.md) | 部署：nginx / systemd / 数据库 / 备份 / 升级 |
| [docs/PUBLISHING.md](docs/PUBLISHING.md) | 桌面端发布：双渠道、强制更新、撤回、回滚 |
| [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) | 开发工作流、隐私分离规则、诊断脚本 |
| [docs/DEVELOPMENT_FLOW.md](docs/DEVELOPMENT_FLOW.md) | 发布流程唯一事实源 + DoD 检核表 |
| [docs/MOBILE_UX.md](docs/MOBILE_UX.md) | 移动端交互规范与真机验收清单 |
| [docs/REVIEW-2026-09.md](docs/REVIEW-2026-09.md) | 项目全貌与专业点评（2026-09） |
| [CONTRIBUTING.md](CONTRIBUTING.md) / [SECURITY.md](SECURITY.md) | 贡献指南 / 安全政策 |

## 目录结构

```
Qbao/
├── app/          # 前端 SPA：Vue 3 + Vite + Pinia（源码 src/，singlefile 产物 dist/）
├── desktop/      # Electron 桌面壳（main / preload / updater，Windows NSIS 打包）
├── server/       # Node.js 后端：Express + PostgreSQL
│   ├── src/      # 路由、鉴权中间件、AI Provider 适配器、服务层
│   ├── sql/      # 版本化数据库迁移（NNN_*.sql，schema_migrations 追踪）
│   ├── scripts/  # 迁移执行 / 管理员引导 / 诊断脚本
│   ├── deploy/   # systemd 单元 + 上传目录初始化脚本
│   └── init.sql  # 建库脚本
├── docs/         # 架构 / 部署 / 发布 / 开发文档
├── scripts/      # 发布工具（publish-installer：manifest 驱动入库）
├── tools/        # 一次性维护脚本（默认不上传）
└── local/        # 【本地专用】密钥 / 日志 / 数据快照，永不上传（.gitignore）
```

## 技术架构

Vue 3 + Vite + Pinia 前端（singlefile 产物，网页 / Electron 双形态共用）+ Node.js / Express 后端（14 个路由模块、约 105 个端点）+ PostgreSQL（业务状态 JSONB + rev 乐观锁同步；会话 / 聊天 / 工单 / 积分等独立关系表）。

关键设计：

- **双形态同源**：同一份构建产物既是网页也是桌面端界面，API 地址运行时注入，桌面端免部署；
- **同步引擎**：rev 乐观锁、409 实体级并集合并重推、空推跳过、账号与标签页隔离守卫；
- **AI 代理层**：Provider 工厂统一接入，任务队列（SKIP LOCKED）+ 生成锁 + 成功才计费；
- **自托管分发**：manifest-first 双渠道下载 / 更新平台，服务器不依赖 GitHub 可达性。

## 隐私与安全

- 公开仓库不含任何真实服务器地址与密钥（占位符纪律）；2026-07 已重写历史清除敏感信息
- 密码 bcrypt 哈希、JWT（强密钥启动校验）、登录与全局限流
- 上传通道扩展名白名单 + 魔数嗅探 + 附件响应头；CSP 收紧；systemd 非 root 运行
- AI API Key 用户自管、服务端不落库；桌面端凭据以 DPAPI（safeStorage）加密

## 许可证

[MIT](LICENSE)