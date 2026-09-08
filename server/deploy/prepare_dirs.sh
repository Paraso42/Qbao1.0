#!/usr/bin/env bash
# ============================================================
# Qbao 上传目录初始化（T16）
# 用法: sudo bash prepare_dirs.sh <部署根目录>   （必填；占位符 {PROD_ROOT} 的真实值仅存 local/ENV.md）
# 在首次部署/升级后以部署用户执行一次；systemd 服务运行前目录必须就绪。
# ============================================================
set -euo pipefail

BASE="${1:?请提供部署根目录（公开文档用 {PROD_ROOT} 占位，真实值见 local/ENV.md）}"
APP_USER="${SUDO_USER:-qbao}"
UPLOADS="$BASE/uploads"

echo "[prepare_dirs] 初始化上传目录: $UPLOADS"
mkdir -p "$UPLOADS/chat" "$UPLOADS/issues" "$UPLOADS/pool" "$UPLOADS/avatars"

# 目录归属服务运行用户（默认 qbao，非 root 运行 systemd 服务）
if [ "$APP_USER" != "root" ]; then
  chown -R "$APP_USER":"$APP_USER" "$UPLOADS"
fi
chmod 750 "$UPLOADS"
chmod 750 "$UPLOADS/chat" "$UPLOADS/issues" "$UPLOADS/pool" "$UPLOADS/avatars"

echo "[prepare_dirs] 完成："
ls -ld "$UPLOADS" "$UPLOADS"/*
