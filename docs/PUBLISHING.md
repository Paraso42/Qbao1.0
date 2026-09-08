# 桌面端发布手册（PUBLISHING）

> v1.0 · v3.35 起生效 · 配套：docs/DEVELOPMENT_FLOW.md（流程唯一事实源）、docs/DEPLOY.md（部署）。
> 本文档取代 log.md 中的「搬包」人工步骤：**一切安装包入库/强制门槛/撤回操作都通过 scripts/publish-installer.js 完成**。

## 1. 概述

```
GitHub Release（云端归档，CI 构建）
        │  固定流程：签名直链下载 → digest 核对 → 暂存目录
        ▼
scripts/publish-installer.js add --channel stable|beta
        │  三重校验（size/sha256/sha512）→ 原子写 manifest.json（.bak 滚动备份）→ 可选剪枝
        ▼
服务器 downloads/ ← 桌面端 updater（generic feed）与下载页 /dl、网页设置同步呈现
```

- 服务器**永不直连 GitHub**；每次 Release 后由发布者走「签名直链」通道人工搬运（见 §3）。
- downloads/ 位于 repo 根（QBAO_DESKTOP_DIR），部署清理脚本不会触碰。

## 2. 渠道与版本纪律（与 DEVELOPMENT_FLOW.md §3A 一致）

| 项 | 测试版（beta） | 稳定版（stable） |
|---|---|---|
| 版本号 | X.Y.Z-beta.N（构建时 extraMetadata 覆盖，**不改跟踪文件/不推 tag**） | X.Y.Z（三端对齐） |
| 出口 | 本地 electron-builder 构建 → add --channel beta | 验收通过 → tag vX.Y.Z → CI Release → add --channel stable |
| 强制更新 | 永不（工具+服务端双重拒绝 required） | 仅显式 promote --required |
| 用户面 | 测试者设置 updateChannel=beta 订阅 | 默认渠道 |

硬约束（工具强制）：
- `add --channel stable` 拒绝 prerelease 版本号；重复版本需 --force。
- `promote` 仅允许 stable 渠道、且只能作用于**当前最新可用版本**；--required 必须低于 --version。
- `retract` 仅允许 stable；自动清除该版本的 required（防升级死循环）；文件保留在磁盘待人工清理。

## 3. 发布固定流程（Release 后执行）

### 3.1 下载 Release 资产（签名直链通道）
```bash
# 1) api.github.com 取资产元信息与签名直链（api.github.com 国内可达；github.com 直连不稳定）
TAG=v3.35.0
ASSET_JSON=$(curl -s -H "Accept: application/vnd.github+json" \
  "https://api.github.com/repos/Paraso42/Qbao/releases/tags/$TAG")
EXE_URL=$(echo "$ASSET_JSON" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);const a=j.assets.find(x=>/^Qbao-Setup-.*\.exe$/.test(x.name));console.log(a.browser_download_url)})")
DIGEST=$(echo "$ASSET_JSON" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);const a=j.assets.find(x=>/^Qbao-Setup-.*\.exe$/.test(x.name));console.log(a.digest)})")

# 2) 本机下载（release-assets CDN 国内可达）
curl -sL -o Qbao-Setup-$TAG.exe "$EXE_URL"
BM_URL=$(echo "$ASSET_JSON" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);const a=j.assets.find(x=>/\.blockmap$/.test(x.name));console.log(a.browser_download_url)})")
curl -sL -o Qbao-Setup-$TAG.exe.blockmap "$BM_URL"
YML_URL=$(echo "$ASSET_JSON" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);const a=j.assets.find(x=>x.name==='latest.yml');console.log(a.browser_download_url)})")
curl -sL -o latest.yml "$YML_URL"

# 3) digest 核对（GitHub 官方 sha256 摘要，必须与本地一致）
node scripts/publish-installer.js verify --file Qbao-Setup-$TAG.exe --sha256 "${DIGEST#sha256:}"
```
> 说明：release-assets.githubusercontent.com 的签名直链有效期约 30–60 分钟，请在 Release 发布后尽快执行。

### 3.2 入库（服务器或本机指定 --root）
```bash
mkdir -p /tmp/stage && cp Qbao-Setup-$TAG.exe Qbao-Setup-$TAG.exe.blockmap latest.yml /tmp/stage/
node scripts/publish-installer.js add --dir /tmp/stage --channel stable \
  --notes "版本说明（可选）" --prune --keep 3
node scripts/publish-installer.js ls
```

### 3.3 公网验证（必须）
```bash
# manifest 返回新版本；/update/stable/latest.yml 200；/dl 展示新版本
curl -s https://<host>/api/v1/desktop/manifest | grep -F "v$TAG" ; curl -s "https://<host>/api/v1/desktop/manifest" | grep -F "$TAG"
curl -sI https://<host>/api/v1/desktop/update/stable/latest.yml | grep -i "200 OK"
curl -s "https://<host>/api/v1/desktop/download?file=Qbao-Setup-$TAG.exe" -o /tmp/verify.exe
node scripts/publish-installer.js verify --file /tmp/verify.exe --sha256 "${DIGEST#sha256:}"   # MATCH 才算完成
```
> 全部通过后，网页端设置「桌面端」与 /dl 自动呈现新版本（manifest 驱动，无需发版）。

## 4. 强制更新（promote）与撤回（retract）

### 4.1 promote（触发器白名单：API 破坏性变更 / 安全漏洞 / 数据迁移）
```bash
node scripts/publish-installer.js promote --channel stable --version 3.35.0 --required 3.34.0
```
- 效果：低于 3.34.0 的客户端自动更新被阻断为强制（仅 stable 渠道）；下载列表对 < 3.34.0 标注「已停止服务」。
- 决策原则：**不是每个新版本都 promote**；默认 required=null，普通更新永远用户确认。

### 4.2 retract（稳定版出现恶性 bug 的熔断）
```bash
node scripts/publish-installer.js retract --channel stable --version 3.35.0 --reason "启动闪退，请安装 3.34.2 或等待修复版"
```
- 自动行为：manifest 标 retracted + 下载端点 410 + /dl 显示撤回横幅 + latest 回退上一可用版本 + 清除该版本 required + 已装用户桌面端弹「当前版本已被撤回」引导打开下载页。
- 用户自救不依赖 retract：任何用户在桌面端「历史版本」/网页版本历史/ /dl 均可自行下载旧版覆盖安装（不丢数据）。
- 修复流程：修复版先走 beta 验证 → 用户验收 → 新稳定版 Release → add --channel stable。

## 5. 回滚

| 场景 | 操作 |
|---|---|
| manifest 损坏 | 恢复 downloads/manifest.json.bak（滚动备份，每次发布前自动生成） |
| 误 promote | retract 该版本（自动清除 required）或重新 promote 调整门槛 |
| 误 retract | 手动编辑 manifest.json 移除 retracted 标记后保存（工具不提供 unretract，避免误操作） |
| 磁盘文件错误 | verify/ls 排查；多余文件由 add --prune 按留存策略剪枝 |

## 6. 常见故障判定表

| 现象 | 判定 | 处理 |
|---|---|---|
| add 报「latest.yml 与安装包不一致」 | 错包/篡改/双包 | 重新从 Release 下载资产，勿用 --force 跳过 |
| add 报「stable 渠道禁止 prerelease」 | 版本号带 -beta 误入 stable | 改发 beta 渠道，或验收后去掉后缀重发 |
| promote 报「只允许作用于最新可用版本」 | 已有更新版本发布 | 先评估新版本是否需要门槛 |
| 下载返回 410 | 版本被 retract | 下载页已引导回退版本 |
| 桌面端弹「当前版本已被撤回」 | 用户装了被撤回版本 | 打开下载页/历史版本重装其他版本 |
| /update/stable/latest.yml 404 | 渠道目录缺 latest.yml | add 会保证写入；检查目录权限 |

## 7. 测试版（beta）构建

```bash
# 不改任何跟踪文件；版本号由构建时覆盖（产物：Qbao-Setup-X.Y.Z-beta.N.exe + latest-beta.yml + blockmap）
npx electron-builder --win nsis --publish never --config.extraMetadata.version=3.35.0-beta.1
# 暂存目录内把 latest-beta.yml 改名为 latest.yml 后入库（beta 渠道目录固定使用 latest.yml）
node scripts/publish-installer.js add --dir <stage> --channel beta [--prune]
```
- 测试者订阅方式：desktop/config.local.json 或用户设置写入 `updateChannel: beta`。
- 测试版不推 tag、不发 CHANGELOG、不进发布记录（仅记录测试结论）。

> 术语澄清：本节「beta」指**安装包试验渠道**；「L1 内测环境」（服务器数据隔离：独立库/端口/静态目录）见 docs/ENVIRONMENTS.md。两者正交可组合：桌面测试包 + 应用内「服务器地址」指向内测域名，即在隔离环境里测试真实安装形态。


## 8. 手机端发布（Android / iOS · v3.38 起）

> 与桌面端共用同一份 `downloads/manifest.json`（schemaVersion 2 起含 `platforms{android,ios}`）。
> 入库工具：**scripts/publish-mobile.js**（零依赖；add/retract/ls/verify，纪律与桌面端一致：
> 仅 stable 语义——拒绝 prerelease/required；重复需 --force；清单引用的文件必须真实存在；写入前滚动备份 manifest.json.bak）。

### 8.1 Android：构建
```bash
# 壳工程在 mobile/（Capacitor 6）：加载现网主站，包名 com.qbao.app，应用名 Qbao
cd mobile/android && gradlew.bat assembleRelease          # Windows
# 或 ./gradlew assembleRelease                              # macOS/Linux
# 产物：mobile/android/app/build/outputs/apk/release/app-release.apk（release 签名，keystore 见 mobile/README.md）
# 可选项——内测版壳：capacitor.config.ts 支持环境变量 QBAO_APP_ID/QBAO_SHELL_URL/QBAO_APP_NAME 覆盖，
#   可构建"内测版"（独立应用标识、指向内测域名、与正式版共存安装）；内测包不进下载中心清单，
#   文件/二维码直传分发（见 docs/ENVIRONMENTS.md §7.1）
# 版本号：android/app/build.gradle → versionCode / versionName（与清单版本一致，如 1.0.0）
```

### 8.2 入库
```bash
mkdir -p /tmp/mstage && cp app-release.apk /tmp/mstage/Qbao-Android-1.0.0.apk
node scripts/publish-mobile.js add --platform android --dir /tmp/mstage --notes "手机端首发" [--root ./downloads]
node scripts/publish-mobile.js ls
```

### 8.3 iOS
- 需 **macOS + Xcode + Apple Developer 账号**签名出包（TestFlight 内测 / 企业签名分发）。
- 产物命名 `Qbao-iOS-X.Y.Z.ipa` 后执行 `publish-mobile.js add --platform ios`；未发布前，
  下载中心 iOS 卡片与 /dl?platform=ios 自动显示「尚未发布」引导（Safari 添加到主屏幕）。

### 8.4 公网验证（必须）
```bash
curl -s "https://<host>/api/v1/apps/manifest?platform=android"          # 含新版本
curl -sI "https://<host>/api/v1/apps/download?platform=android&file=Qbao-Android-1.0.0.apk"   # 200
curl -s "https://<host>/dl?platform=android"                             # 落地页 Android 视图
```

### 8.5 撤回/回滚
```bash
node scripts/publish-mobile.js retract --platform android --version 1.0.0 --reason "原因"   # 下载端点 410
# 误操作：手动编辑 manifest.json 移除 retracted 标记（工具不提供 unretract）
```

> 分发入口：网页端设置页「桌面端」已升级为「**下载中心**」（Windows/Android/iOS 三端卡片，
> 按访问设备 UA 自动高亮「本机」）；落地页 /dl 同构（?platform=android|ios，UA 自动跳转）。
