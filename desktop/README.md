# Qbao 桌面端（Electron · Windows）

Qbao 的 Windows 桌面客户端：内嵌与网页端完全相同的 singlefile 前端产物，经配置的服务器地址访问同一套账号与数据，并支持自动更新与 DPAPI 凭据加密。

## 安装与更新

- 安装包：`Qbao-Setup-<版本>.exe`（NSIS，x64）。获取渠道：自托管分发站（网页「设置 → 桌面端」与 `/dl` 下载页）或 GitHub Releases（CI 构建归档）。
- 自动更新：启动延迟检查 + 应用内「检查更新」；更新源为**服务器自托管 feed**（`update/<channel>/latest.yml`，v3.35 起），不依赖 GitHub 可达性。
- 渠道：`stable`（默认）/ `beta`（测试版）；强制更新与撤回由服务器 manifest 控制（见 docs/PUBLISHING.md）。
- 提示：安装包暂未代码签名，SmartScreen 可能显示安全警告；建议核对下载来源与发布页信息的一致性。

## 配置服务器地址

复制 `config.json` 为 `config.local.json`（已被 .gitignore 忽略）并填入：

```json
{
  "apiBase": "https://your.domain.com/api/v1",
  "serverLabel": "线上服务器",
  "updateChannel": "stable"
}
```

也可以设置环境变量 `QBAO_API_BASE`。

- **安装版**：首次启动会弹出「设置服务器地址」引导框（输入主机地址，自动补全 `/api/v1`），地址保存在用户数据目录 `settings.json`，应用内可随时修改。
- **apiBase 留空**：应用仅显示登录门禁与设置页（账号、同步与 AI 能力均依赖服务器，无离线业务模式）。

## 凭据安全

- 登录令牌与 AI Key 经主进程 `safeStorage`（Windows DPAPI）加密存于 `userData/secrets.json`，渲染进程不持久化明文；不可用时自动降级。
- 窗口安全基线：`sandbox` + `contextIsolation` + `nodeIntegration: false`；外链经白名单转系统浏览器打开。

## 开发与打包

```bash
cd desktop
npm ci                            # 首次（Electron 二进制较大）
npm run dev                       # 开发窗口
npm run dist                      # 打包 NSIS 安装包（输出 release/）
node --test test/updater.test.js  # updater 纯函数测试（CI 同步执行）
```

版本号必须与 app / server 三端同步对齐（发布纪律见 docs/DEVELOPMENT_FLOW.md）。

## 相关文档

- docs/DEPLOY.md §8.5 —— 自托管分发（储藏室结构 / 公开端点）
- docs/PUBLISHING.md —— 发布流程（双渠道 / promote / retract / 回滚）
- docs/DEVELOPMENT_FLOW.md —— 发布纪律与 DoD