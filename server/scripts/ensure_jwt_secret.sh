#!/usr/bin/env bash
# 确保服务器 .env 中 JWT_SECRET 为强随机值。
# 用法（服务器 root）: bash ensure_jwt_secret.sh <server/.env 绝对路径>
set -euo pipefail

ENV_FILE="${1:?用法: bash ensure_jwt_secret.sh <server/.env 绝对路径>}"

if [ ! -f "$ENV_FILE" ]; then
  echo "MISSING_ENV_FILE $ENV_FILE"
  exit 1
fi

current="$(grep -E '^JWT_SECRET=' "$ENV_FILE" | tail -1 | sed 's/^JWT_SECRET=//' | tr -d '"' | tr -d "'" || true)"

if [ "${#current}" -ge 32 ] && [ "$current" != "change_me_to_a_long_random_string" ]; then
  echo "JWT_SECRET_OK length=${#current}"
  exit 0
fi

secret="$(openssl rand -hex 32)"

if grep -q '^JWT_SECRET=' "$ENV_FILE"; then
  sed -i "s|^JWT_SECRET=.*|JWT_SECRET=$secret|" "$ENV_FILE"
else
  printf '\nJWT_SECRET=%s\n' "$secret" >> "$ENV_FILE"
fi

chmod 600 "$ENV_FILE"
echo "JWT_SECRET_UPDATED length=${#secret}"
