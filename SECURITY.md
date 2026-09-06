# 安全政策（Security Policy）

## 支持版本与响应

- 仅最新 `main` 分支接收安全修复；发现安全问题**请勿在公开 Issue 中披露**。
- 请通过私密渠道（GitHub 私信或维护者邮箱）说明：影响范围、复现步骤、建议修复方案；修复版本发布后可按需署名致谢。

## 已实施的防护

- 密码 bcrypt 哈希；JWT 鉴权（启动校验密钥强度，密钥来自环境变量、不入库）
- 登录与全局接口限流（express-rate-limit）；CORS 白名单
- 上传通道：扩展名白名单 + 魔数嗅探 + 附件响应头；不静态暴露 /uploads
- AI API Key 用户自持、服务端不落库；桌面端凭据以 DPAPI（safeStorage）加密
- CSP 收紧（客户端 meta）；systemd 非 root 运行（NoNewPrivileges）
- CI：gitleaks 全历史密钥扫描；npm audit（高危告警留痕）

## 自托管注意事项

见 docs/DEPLOY.md §9 安全清单：强随机 JWT_SECRET、.env 权限 600、后端 3000/5432 端口不对外、定期 npm audit、启用 HTTPS。