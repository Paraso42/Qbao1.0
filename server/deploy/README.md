# 服务器现场手册 — systemd 守护

> 当前生产形态：后端以 systemd 服务 `qbao-api` 运行（非 root 用户 `qbao`，NoNewPrivileges）；完整部署、备份与升级流程见 docs/DEPLOY.md。本文是服务器现场的速查手册。

## 常用命令

```bash
systemctl status qbao-api               # 状态
systemctl restart qbao-api              # 重启
journalctl -u qbao-api -f               # 实时日志
curl -s http://127.0.0.1:3000/health    # 健康检查（或 /api/v1/health）
```

## 首次安装

1. 创建部署用户与目录：代码位于 `/home/qbao/qbao`（含 server/、app/dist、downloads/、uploads/）。
2. 上传单元文件并注册：

   ```bash
   sudo cp server/deploy/qbao-api.service /etc/systemd/system/
   sudo systemctl daemon-reload
   ```

3. **先初始化上传目录属主**（非 root 进程无写权限会失败）：

   ```bash
   sudo bash server/deploy/prepare_dirs.sh /home/qbao/qbao
   ```

4. 启用并启动，随后健康检查：

   ```bash
   sudo systemctl enable --now qbao-api
   curl -s http://127.0.0.1:3000/health
   ```

## 升级后端

1. 先备份数据库（pg_dump，见 docs/DEPLOY.md §7）。
2. 上传新代码（保留 node_modules/、.env、downloads/、uploads/）。
3. 有数据库变更时执行迁移：`cd /home/qbao/qbao/server && node scripts/run_migration.js`。
4. 再次执行 prepare_dirs.sh 修正属主；`systemctl restart qbao-api`；健康检查通过。

## 上传目录（收敛根：部署根 uploads/）

| 目录 | 用途 |
| ---- | ---- |
| `uploads/chat` | 聊天附件 |
| `uploads/issues` | 问题反馈图片 |
| `uploads/pool` | 文件池（AI 出题资料） |
| `uploads/avatars` | 用户头像 |

## 注意事项

- `WorkingDirectory` 与 `server/.env` 路径固定在 `/home/qbao/qbao/server`；服务不读取 `EnvironmentFile`，由 `server.js` 内 dotenv 加载 `.env`。
- 非 root 属主：`uploads/` 必须归 `qbao` 用户（prepare_dirs.sh 负责），否则上传 / 头像写入失败。
- 桌面端储藏室 `downloads/`（QBAO_DESKTOP_DIR）位于 server/ 之外，发布清理脚本不会触碰。