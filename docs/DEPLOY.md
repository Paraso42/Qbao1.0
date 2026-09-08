# 部署指南

> 面向运维与自托管用户。**本文所有地址一律使用占位符**（`your.domain.com`、`/srv/qbao`），请勿将真实服务器信息写入本仓库。

## 1. 拓扑

```
用户 ──HTTPS──> Nginx ──静态文件──> app/（前端）
                  └──/api, /uploads──> server/（Express :3000）──> PostgreSQL

内测（可选）──HTTPS──> 同一 Nginx 按主机名分流 ──> app-beta/（前端）
                  └──/api──> server-beta（Express :3100）──> PostgreSQL qbao_beta
```

## 2. 环境要求

- Node.js ≥ 18，PostgreSQL ≥ 13，nginx（生产），域名 + TLS 证书。

## 3. 后端部署

```bash
# 1) 获取代码（注意：2026-07 历史已重写，需全新克隆）
git clone git@github.com:Paraso42/Qbao.git /srv/qbao

# 2) 初始化数据库
sudo -u postgres psql -c "CREATE DATABASE qbao"
sudo -u postgres psql -d qbao -f /srv/qbao/server/init.sql
# 历史/新增迁移（T17 版本化：schema_migrations 追踪，只执行未应用项）
cd /srv/qbao/server && npm ci --omit=dev && node scripts/run_migration.js

# 3) 配置环境变量
cd /srv/qbao/server
cp .env.example .env   # 必填：PGPASSWORD、JWT_SECRET；按需填各 AI Key
chmod 600 .env
openssl rand -hex 32   # 生成 JWT_SECRET

# 4) 安装并启动
npm ci --omit=dev
npm start              # 或 PM2 守护（见下）
```

PM2（参考 `server/ecosystem.config.js`，**按实际路径修改 script**）：

```bash
pm2 start server/ecosystem.config.js
pm2 save && pm2 startup
```

## 4. 前端部署（nginx）

前端为 Vue+Vite 构建产物：`cd app && npm ci && npm run build` 后发布 `app/dist/`
（singlefile：index.html + vendor/，CI 亦会构建并冒烟校验 CSP）。nginx 配置示例：

```nginx
server {
    listen 80;
    server_name your.domain.com;
    root /srv/qbao/app/dist;     # 注意：静态根目录是构建产物 app/dist/
    index index.html;

    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
    location ^~ /uploads/ {
        proxy_pass http://127.0.0.1:3000;
    }
    location ^~ /avatars/ {
        proxy_pass http://127.0.0.1:3000;
    }
    location / {
        try_files $uri $uri/ /index.html;
    }

    # 注意：静态资源正则 location 优先级高于普通前缀 location。
    # 上传/头像目录（/uploads/、/avatars/）必须写成 ^~ 前缀，否则会被此规则
    # try_files 拦截（在静态根目录找不到图片 → 404）。
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff2?)$ {
        expires 7d;
        add_header Cache-Control "public, max-age=604800";
        try_files $uri =404;
    }
}
```

## 4B. 内测环境（beta）部署 —— 双环境纪律

> 内测环境与生产**同服务器、同代码、不同目录/进程/数据库**：静态 /srv/qbao-beta/app、API :3100、库 qbao_beta。
> 所有测试动作只允许发生在内测环境；生产库禁止测试写入。流程纪律见 docs/DEVELOPMENT_FLOW.md（§3、§7），
> 概念与内测入口见 docs/ENVIRONMENTS.md。

### 4B.1 目标布局（占位符，真实值见 local/ENV.md）

| 层 | 入口 | 静态根 | API | 数据库 | 缓存 |
|---|---|---|---|---|---|
| L2 生产 | https://{DOMAIN} 与 http://{ORIGIN_IP} | /srv/qbao/app | :3000（qbao-api） | qbao | 静态 7 天 |
| L1 内测 | https://{BETA_HOST} | /srv/qbao-beta/app | :3100（qbao-api-beta） | qbao_beta | 不缓存 |

### 4B.2 一次性初始化

```bash
# 1) 目录与代码（部署侧非 git 检出，与生产同模式）
mkdir -p /srv/qbao-beta
cp -a /srv/qbao/server /srv/qbao-beta/server   # 或从本地同步（scripts/stage.ps1 -Env beta）

# 2) 建库（同一 PostgreSQL 集群，独立账本）
sudo -u postgres createdb -O qbao qbao_beta

# 3) beta 环境变量（.env）
cd /srv/qbao-beta/server && cp .env.example .env
#   必改：PORT=3100、PGDATABASE=qbao_beta、JWT_SECRET=新随机值（openssl rand -hex 32）；AI Key 留空；chmod 600 .env

# 4) 基础结构 + 迁移（读本目录 .env → qbao_beta；与生产共用同一 sql/ 目录）
psql -d qbao_beta -f init.sql                       # 按实际 PG 凭据（PGPASSWORD 等）
node scripts/run_migration.js

# 5) systemd 单元（以 server/deploy/qbao-api.service 为模板）
#    WorkingDirectory=/srv/qbao-beta/server，ExecStart=node server.js
systemctl enable --now qbao-api-beta && curl -s http://127.0.0.1:3100/api/v1/health

# 6) 静态首灌：app/dist 内容 + public/games → /srv/qbao-beta/app；配置 nginx（见 4B.3）
```

### 4B.3 nginx server 块（内测，与生产块并存，按 Host 分流）

```nginx
server {
    listen 80;
    server_name {BETA_HOST};
    root /srv/qbao-beta/app;
    index index.html;

    location /api/ {
        proxy_pass http://127.0.0.1:3100;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
    location ^~ /uploads/ { proxy_pass http://127.0.0.1:3100; }
    location ^~ /avatars/ { proxy_pass http://127.0.0.1:3100; }

    # 狼人杀：前台静态走内测目录；房间/API 复用生产 :3011（临时房无持久化，可接受）
    location ^~ /games/werewolf/werewolf-ws { proxy_pass http://127.0.0.1:3011; proxy_http_version 1.1; proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade"; }
    location ^~ /games/werewolf/api/ { proxy_pass http://127.0.0.1:3011/; }
    location ^~ /games/werewolf/ { try_files $uri $uri/ /games/werewolf/index.html; }

    # 内测禁用长缓存：改完刷新即见
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff2?)$ {
        expires -1;
        add_header Cache-Control "no-cache, no-store, must-revalidate";
        try_files $uri =404;
    }
    location / { try_files $uri $uri/ /index.html; }
}
```

> HTTPS：{BETA_HOST} 由中转服务器（Caddy）终结 TLS 并回源 http://{ORIGIN_IP}。
> **备案拦截说明（2026-09-08 实测）**：大陆源站会拦截公网请求中"未单列备案域名"的 Host 头（返回 403 ICP Non-compliance），故回源 Host **统一改写为源站 IP**（与生产一致），内测识别改用自定义头 `X-Qbao-Route: beta`：源站 nginx 以 conf.d map（`$http_x_qbao_route|$remote_addr`，仅信任中转出口 IP）分流 root/API/缓存头——生产与内测共享一个 server 块，不再按 Host 分块。上表 nginx 片段为逻辑示意，实际以服务器 conf 为准。
> 证书：{BETA_HOST} 的 DNS 记录为「仅 DNS（不走 CDN 代理）」时，中转 Caddy 自动签发证书（HTTP-01 直连可达）。

### 4B.4 部署 / 冒烟 / 清理

```bash
# 部署（同步代码/静态 → 内测目录 → 迁移 → 重启），流程见 docs/DEVELOPMENT_FLOW.md §⑥
scripts/stage.ps1 -Env beta -Mode all          # 或手工 tgz+scp（同 §8 流程，目标改 beta 目录）
systemctl restart qbao-api-beta

# 冒烟：可写 E2E 走内测库（scripts/qa/smoke-stage.ps1 -Env beta）+ 只读健康检查
curl -s https://{BETA_HOST}/api/v1/health

# 内测库清理重建（允许随时执行，不影响生产）
sudo -u postgres dropdb qbao_beta
sudo -u postgres createdb -O qbao qbao_beta
#   再按 4B.2 第 4 步重新 init.sql + run_migration.js
```

### 4B.5 内存预案（共用一台小内存源站时）

1. 内测实例不开 AI 任务（服务端预留 `SKIP_AI_WORKER=1` 环境变量支持）；AI Key 留空自然不消费额度。
2. 观察 RSS：`systemctl status qbao-api-beta` / `ps -o rss,cmd -p <pid>`。
3. 最坏回退：内测仅保留静态目录（页面/UI 可测），API 暂共享生产 :3000 —— 放弃「先于生产测新代码」能力，恢复即移除。

### 4B.6 纪律要点（与 DEVELOPMENT_FLOW §7 红线一致）

- 迁移与发布顺序固定：**L1 先、L2 后**；两库 schema_migrations 各自记账，任意一边失败可单独重试（迁移幂等）。
- 测试账号只建在 qbao_beta；生产保持金丝雀账号只读巡检。
- 游戏页 `?qa=1` 钩子仅 {BETA_HOST}/localhost 生效（代码门禁，见 docs/GAMES.md §六）。

## 5. 上传目录

**所有上传统一在 `<仓库根>/uploads/`**（T16 已收敛，AI 临时文件与其余通道同根）：

| 目录 | 用途 |
|------|------|
| `uploads/pool/` | 共享文件池（AI 出题资料，生产数据，**必须备份**） |
| `uploads/chat/` | 聊天附件 |
| `uploads/issues/` | 反馈图片 |
| `uploads/avatars/` | 头像 |

非 root 运行（推荐，见 §3.5）时，用 `server/deploy/prepare_dirs.sh` 初始化属主：
```bash
sudo bash server/deploy/prepare_dirs.sh /srv/qbao
```

## 6. HTTPS

```bash
sudo certbot --nginx -d your.domain.com
```

## 7. 备份

```bash
# 数据库（每日）
pg_dump -U qbao qbao | gzip > /backup/qbao_$(date +%F).sql.gz
# 上传文件（每日）
rsync -a /srv/qbao/uploads/ /backup/uploads/
```

## 8. 升级流程

1. `git pull`（首次从旧历史切换必须先重新克隆）。
2. 执行迁移：`cd server && node scripts/run_migration.js`（schema_migrations 自动跳过已应用项；旧库手工迁移过可先 `--mark-applied`）。
3. `cd server && npm ci --omit=dev`（依赖有变化时）。
4. `sudo bash server/deploy/prepare_dirs.sh /srv/qbao`（目录属主修正）后重启服务。
5. 前端为 Vue+Vite 构建产物：`cd app && npm ci && npm run build` 后，用 `app/dist/` 覆盖式发布到 nginx 静态目录，必要时刷新浏览器缓存。

## 8.5 服务器恢复（2026-07 归档下线后重建）

服务器曾于 2026-07-06 完整卸载运行环境（Node/PM2/PostgreSQL/Nginx 均 purge，社交类数据表已删除、uploads 已清空）。重新上线流程：

1. 重装基础环境：Node.js ≥ 18、PostgreSQL ≥ 13、Nginx、certbot（如需公网 HTTPS）、**WireGuard**（内网访问模式）。
2. 按 §3-4 完成建库与部署（init.sql + migration_v*.sql 顺序执行）。
3. **恢复数据库**：将本地存档 `local/Version/server_archive_20260706/qbao_full_20260706.sql` 导入（含用户账号与题库数据；聊天等已删除表不可恢复，以空库开始）。
4. 执行新增迁移：`cd server && node scripts/run_migration.js`（历史已手工导入则先 `--mark-applied` 再跑，避免重复执行基线）。
5. 验证四用户凭原账号密码登录、数据完整。

### 桌面版分发（v3.35 · 自托管更新源 + 统一下载站）

桌面端更新、下载完全由本站服务器提供（**不依赖 GitHub**；GitHub 仅作 CI 与发布归档，服务器永不直连 GitHub）。

1. **储藏室目录结构**（QBAO_DESKTOP_DIR，默认 `<repo>/downloads`，位于 server/ 之外，发布清理脚本不触碰）：

```
downloads/
  manifest.json            # 唯一事实源（scripts/publish-installer.js 生成，服务器只读）
  manifest.json.bak        # 每次发布前的滚动备份（回滚依据）
  stable/latest.yml  Qbao-Setup-<v>.exe  Qbao-Setup-<v>.exe.blockmap
  beta/latest.yml   ...
```

2. **公开端点**（全部无鉴权、支持断点续传 / GET 自动支持 HEAD）：
   - `/api/v1/desktop/manifest?channel=stable|beta` — 版本清单（latest 在前，含 required/retracted/stopped）
   - `/api/v1/desktop/latest` — 最新稳定版元信息（旧版兼容，字段不变）
   - `/api/v1/desktop/download?file=<fileName>` — 任意留存版本精确下载（缺省=最新稳定版；retracted → 410）
   - `/api/v1/desktop/update/<channel>/latest.yml` 与 `<file>` — 桌面端 electron-updater generic feed（exe/blockmap）
   - `/api/v1/desktop/stats` — 下载统计（版本×日聚合，无 PII）
   - `/dl` — 公开下载落地页（中国大陆镜像站点，服务端动态渲染）
   - `/download` — 短链 302 → /api/v1/desktop/download

3. **nginx 追加/确认**（反代 `/api` 已覆盖全部 API 端点）：

```nginx
location = /download { return 302 /api/v1/desktop/download; }
location ^~ /dl { proxy_pass http://127.0.0.1:3000; proxy_set_header Host $host; proxy_set_header X-Real-IP $remote_addr; }
# 大文件下载需放宽读超时（https://<host>/download 完整直出 85MB+ 安装包）
proxy_read_timeout 1800s;
```

4. **数据库迁移**：`013_desktop_download_stats.sql`（下载统计表；`run_migration.js` 自动应用）。
5. **发布安装包**：见 `docs/PUBLISHING.md`（scripts/publish-installer.js：add/promote/retract/verify/ls）。

### 防火墙端口矩阵（内网 VPN 模式，推荐）

| 端口 | 协议 | 用途 | 开放范围 |
|------|------|------|----------|
| 22 | TCP | SSH 管理 | 仅管理员固定 IP |
| 51820 | UDP | WireGuard 入口 | 公网 |
| 9178 | TCP | nginx HTTP 生产入口 | 仅 VPN 网段（10.0.0.0/24） |
| 8080 | TCP | nginx 测试入口（可选） | 仅 VPN 网段 |
| 3000 | TCP | Node 后端（生产） | **永不对外**（仅 127.0.0.1） |
| 3100 | TCP | Node 后端（内测） | **永不对外**（仅 127.0.0.1） |
| 5432 | TCP | PostgreSQL | **永不对外**（仅 localhost） |

> 公网开放模式（无 VPN）时另需 80/443，且强烈建议 HTTPS（certbot 免费签发）；后端与数据库端口规则不变。

## 9. 安全清单

- 修改数据库默认口令；`.env` 权限 600，JWT_SECRET 使用强随机值。
- 防火墙仅开放 80/443；后端 3000 端口不对外。
- AI API Key 由用户在前端自行配置，服务端不留存（`x-ai-api-key` 请求头透传）。
- 管理员引导：首个注册用户且用户名在 `ADMIN_USERNAMES` 环境变量中时自动成为 admin（server/.env.example 有说明）。
- 定期 `npm audit` 检查依赖漏洞；CI 已含 gitleaks 密钥扫描与产物冒烟。