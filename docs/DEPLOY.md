# 部署指南

> 面向运维与自托管用户。**本文所有地址一律使用占位符**：{DOMAIN}/{BETA_HOST} 域名、{ORIGIN_IP}/{HK_IP} IP、
> {PROD_ROOT}/{BETA_ROOT} 源站两套部署根、{BACKUP_DIR} 备份目录（真实值只在本机 gitignored 的 `local/ENV.md`），请勿将真实服务器信息写入本仓库。

## 1. 拓扑

```text
用户 ──HTTPS──> Cloudflare（{DOMAIN} 代理）或 DNS 直连（{BETA_HOST}）
        │
        ▼
香港中转 {HK_IP} · Caddy（TLS 终结 / 自动证书）——回源 Host 统一改写为 {ORIGIN_IP}
        │ 内测请求额外携带 X-Qbao-Route: beta
        ▼ http://{ORIGIN_IP}
源站 nginx（80 + 9178）单一 server 块（server_name _；root/缓存由 conf.d map 决定）
        ├─ 默认（生产）：root {PROD_ROOT}/app（静态 7 天）→ /api 等 → :3000 → 库 qbao
        ├─ 路由头=beta 且来源=网关白名单：root {BETA_ROOT}/app（不缓存）→ :3100 → 库 qbao_beta
        ├─ /games/werewolf/* → :3011（两环境共享房间服务）
        └─ http://{ORIGIN_IP} 直连（无域名兜底）= 生产
```

> 机制原理（ICP 拦截、map 分流、缓存头、证书拓扑）见 docs/ARCHITECTURE.md §2；§4B 为内测环境落地操作。

## 2. 环境要求

- Node.js ≥ 18，PostgreSQL ≥ 13，nginx（生产），域名 + TLS 证书。

## 3. 后端部署

> 本项目线上实例**不使用 PM2**：以 systemd 单元运行（qbao-api / qbao-api-beta / qbao-werewolf，模板 server/deploy/qbao-api.service，见 §4B 与 docs/ARCHITECTURE.md §3.1）。以下为自托管最小部署写法。

```bash
# 1) 获取代码（注意：2026-07 历史已重写，需全新克隆）
git clone git@github.com:Paraso42/Qbao.git {PROD_ROOT}

# 2) 初始化数据库
sudo -u postgres psql -c "CREATE DATABASE qbao"
sudo -u postgres psql -d qbao -f {PROD_ROOT}/server/init.sql
# 历史/新增迁移（T17 版本化：schema_migrations 追踪，只执行未应用项）
cd {PROD_ROOT}/server && npm ci --omit=dev && node scripts/run_migration.js

# 3) 配置环境变量
cd {PROD_ROOT}/server
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
（singlefile：index.html + vendor/，CI 亦会构建并冒烟校验 CSP）。
> 线上实例把构建产物解包发布为独立静态目录 {PROD_ROOT}/app（nginx root 直接指向该目录，见 §1/§4B）；
> 下列示例以仓库内 app/dist 为自托管最小写法。nginx 配置示例：

```nginx
server {
    listen 80;
    server_name your.domain.com;
    root {PROD_ROOT}/app/dist;     # 线上实例 = {PROD_ROOT}/app（解包目录）；自托管最小写法 = 仓库内 app/dist
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

> 内测环境与生产**同服务器、同代码、不同目录/进程/数据库**：静态 {BETA_ROOT}/app、API :3100、库 qbao_beta。
> 所有测试动作只允许发生在内测环境；生产库禁止测试写入。流程纪律见 docs/DEVELOPMENT_FLOW.md（§3、§7），
> 概念与内测入口见 docs/ENVIRONMENTS.md，链路机制见 docs/ARCHITECTURE.md §2。

### 4B.1 目标布局（占位符，真实值见 local/ENV.md）

| 层 | 入口 | 静态根 | API | 数据库 | 缓存 |
|---|---|---|---|---|---|
| L2 生产 | https://{DOMAIN} 与 http://{ORIGIN_IP} | {PROD_ROOT}/app | :3000（qbao-api） | qbao | 静态 7 天 |
| L1 内测 | https://{BETA_HOST} | {BETA_ROOT}/app | :3100（qbao-api-beta） | qbao_beta | 不缓存 |

### 4B.2 一次性初始化

```bash
# 1) 目录与代码（部署侧非 git 检出；日常同步走 scripts/stage.ps1 -Env beta，首次可手工铺底）
mkdir -p {BETA_ROOT}/server {BETA_ROOT}/app {BETA_ROOT}/downloads {BETA_ROOT}/uploads

# 2) 建库（同一 PostgreSQL 集群，独立账本；<db_user> 为实际 PG 属主，见 local/ENV.md）
sudo -u postgres createdb -O <db_user> qbao_beta

# 3) 内测环境变量（.env）
cp -n {PROD_ROOT}/server/.env {BETA_ROOT}/server/.env   # 或从 .env.example 起
#   必改：PORT=3100、PGDATABASE=qbao_beta、JWT_SECRET=新随机值（openssl rand -hex 32）、CORS_ORIGIN=https://{BETA_HOST}
#   AI Key 留空；chmod 600 .env
#   内测网全员管理员：追加 AUTO_ADMIN=1（注册即 admin，仅内测可开；生产严禁）

# 4) Schema 初始化 —— 以生产库 schema-only 克隆（勿用仓库 init.sql：线上生产库与基线已漂移，克隆保证一致）
pg_dump --schema-only -U <db_user> -d qbao | sudo -u postgres psql -d qbao_beta
pg_dump -U <db_user> -d qbao -t schema_migrations --data-only | sudo -u postgres psql -d qbao_beta
#   再执行剩余迁移：cd {BETA_ROOT}/server && node scripts/run_migration.js（读本目录 .env → qbao_beta）

# 5) systemd 单元（以 server/deploy/qbao-api.service 为模板另存 qbao-api-beta.service）
#    WorkingDirectory={BETA_ROOT}/server，ExecStart=node server.js
systemctl daemon-reload && systemctl enable --now qbao-api-beta
curl -s http://127.0.0.1:3100/api/v1/health

# 6) 静态首灌与后续同步：scripts/stage.ps1 -Env beta -Mode app（构建产物 → {BETA_ROOT}/app）
#    nginx 双环境路由见 4B.3（已合并为单一 server 块，勿恢复旧"按 Host 分块"配置）
```

### 4B.3 nginx 双环境路由（合并 server 块 + conf.d map）

> 2026-09-08 起**不再按 Host 分两个 server 块**：大陆源站拦截未单列备案子域名的 Host（内测域名直接回源 → 403），
> 且生产/内测都经香港 Caddy 回源（Host 统一改写为源站 IP）。环境区分改为**网关注入路由头 + 网关出口 IP 白名单**。
> 以下为真实配置的结构化示意（conf 见 /etc/nginx/conf.d/qbao-env.conf 与 /etc/nginx/sites-enabled/qbao）：

```nginx
# conf.d/qbao-env.conf —— 双环境分流 map（其余一切请求默认 = 生产）
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

```nginx
# sites-enabled/qbao —— 单一 server 块（要点；其余 location 的转发头与 /api/ 示例一致）
server {
    listen 80;
    listen 9178 default_server;      # 内网保留入口
    server_name _;                   # 兼容 IP 直连 / 网关回源任意 Host
    root $env_root;
    index index.html;

    # API / 上传 / 下载：按环境变量选路（内测 :3100，默认生产 :3000）
    location /api/ {
        if ($env_root = {BETA_ROOT}/app) { proxy_pass http://127.0.0.1:3100; }
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
    location ^~ /uploads/ { if ($env_root = {BETA_ROOT}/app) { proxy_pass http://127.0.0.1:3100; } proxy_pass http://127.0.0.1:3000; }
    location ^~ /avatars/ { if ($env_root = {BETA_ROOT}/app) { proxy_pass http://127.0.0.1:3100; } proxy_pass http://127.0.0.1:3000; }
    location ^~ /dl      { if ($env_root = {BETA_ROOT}/app) { proxy_pass http://127.0.0.1:3100; } proxy_pass http://127.0.0.1:3000; }

    # 狼人杀：两环境前台静态各自直出；房间/API 复用 :3011（内存房，无持久化，可接受）
    location ^~ /games/werewolf/werewolf-ws { proxy_pass http://127.0.0.1:3011; proxy_http_version 1.1; proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade"; }
    location ^~ /games/werewolf/api/        { proxy_pass http://127.0.0.1:3011/; }
    location ^~ /games/werewolf/            { try_files $uri $uri/ /games/werewolf/index.html; }

    # 静态缓存：生产 7 天 / 内测不缓存（expires 与 Cache-Control 均由 map 决定）
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff2?)$ {
        expires $env_expires;
        add_header Cache-Control $env_cache;
        try_files $uri =404;
    }
    location / { try_files $uri $uri/ /index.html; }
}
```

> HTTPS：{DOMAIN}/{BETA_HOST} 均由香港中转 Caddy 终结 TLS 并回源 http://{ORIGIN_IP}（生产与内测都改写 Host；内测另带 X-Qbao-Route: beta）。
> 证书：{BETA_HOST} DNS 仅解析（不走 CDN 代理），Caddy 走标准 ACME 自动签发；{DOMAIN} 另经 Cloudflare 代理（Full strict）。
> 改动后必须：先备份 sites-enabled/qbao 与 conf.d/*，再 `nginx -t && systemctl reload nginx`；**禁止从 .bak 恢复旧的"按 Host 分块"配置**。

### 4B.4 部署 / 冒烟 / 清理

```bash
# 部署（同步代码/静态 → 内测目录 → 迁移 → 重启），流程见 docs/DEVELOPMENT_FLOW.md §⑥
scripts/stage.ps1 -Env beta -Mode all          # 或手工 tgz+scp（同 §8 流程，目标改 beta 目录）
systemctl restart qbao-api-beta

# 冒烟：可写 E2E 走内测库（scripts/qa/smoke-stage.ps1 -Env beta）+ 只读健康检查
curl -s https://{BETA_HOST}/api/v1/health

# 内测库清理重建（允许随时执行，不影响生产；重建后需重开 AUTO_ADMIN 测试账号）
sudo -u postgres dropdb qbao_beta
sudo -u postgres createdb -O <db_user> qbao_beta
#   再按 4B.2 第 4 步重新做 schema-only 克隆 + run_migration.js，然后 restart qbao-api-beta + 冒烟
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
sudo bash server/deploy/prepare_dirs.sh {PROD_ROOT}
```

## 6. HTTPS

本项目线上链路：TLS 由**边缘网关（Caddy）终结**并自动续期（{DOMAIN} 另经 Cloudflare 代理，Full strict）；
源站 80 只服务回源与 IP 直连，443 不对外暴露（详见 docs/ARCHITECTURE.md §2.3）。改 Caddyfile 后 `systemctl reload caddy`。

自托管用户（独立公网主机、无网关分层）按常规签发即可：

```bash
sudo certbot --nginx -d your.domain.com
```

## 7. 备份

```bash
# 数据库（每日）
pg_dump -U qbao qbao | gzip > {BACKUP_DIR}/qbao_$(date +%F).sql.gz
# 上传文件（每日）
rsync -a {PROD_ROOT}/uploads/ {BACKUP_DIR}/uploads/
```

## 8. 升级流程

1. `git pull`（首次从旧历史切换必须先重新克隆）。
2. 执行迁移：`cd server && node scripts/run_migration.js`（schema_migrations 自动跳过已应用项；旧库手工迁移过可先 `--mark-applied`）。
3. `cd server && npm ci --omit=dev`（依赖有变化时）。
4. `sudo bash server/deploy/prepare_dirs.sh {PROD_ROOT}`（目录属主修正）后重启服务。
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
- 双环境权限模型：内测可开 `AUTO_ADMIN=1`（注册即管理员，仅内测）；生产严禁开启。管理员不可被其他管理员封禁/改密/改角色（服务端强制 403，客户端界面同步收敛），角色变更仅后台脚本（见 docs/ARCHITECTURE.md §4.2）。
- 备份互导只含业务数据，不携带账号属性（封禁/角色），见 docs/ARCHITECTURE.md §4.2 与 docs/ENVIRONMENTS.md §5.
- 定期 `npm audit` 检查依赖漏洞；CI 已含 gitleaks 密钥扫描与产物冒烟。