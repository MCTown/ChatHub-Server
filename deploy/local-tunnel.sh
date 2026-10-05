#!/usr/bin/env bash
# 在你自己的电脑上运行（不是服务器），把服务器端口映射到本地：
#   LOCAL_BASE=20000 bash deploy/local-tunnel.sh   # 自定义本地端口基址
#
# 默认映射： 本地 25565/25566/6700 -> 服务器 127.0.0.1:相同端口
set -euo pipefail

REMOTE_USER="${REMOTE_USER:-apricityx}"
REMOTE_HOST="${REMOTE_HOST:-server.apricityx.top}"
REMOTE_PORT="${REMOTE_PORT:-8789}"
LOCAL_BASE="${LOCAL_BASE:-0}"          # 0 = 本地端口与服务器相同

if [ "$LOCAL_BASE" = "0" ]; then
    hub=6700; survival=25565; creative=25566
else
    hub="$LOCAL_BASE"; survival=$((LOCAL_BASE + 1)); creative=$((LOCAL_BASE + 2))
fi

echo "隧道：本地 $hub/$survival/$creative -> $REMOTE_HOST:$REMOTE_PORT"
echo "控制台： http://127.0.0.1:$hub/    MC： localhost:$survival / localhost:$creative"
exec ssh -N \
    -o ExitOnForwardFailure=yes \
    -o ServerAliveInterval=30 \
    -o ServerAliveCountMax=3 \
    -p "$REMOTE_PORT" \
    -L "$survival:127.0.0.1:25565" \
    -L "$creative:127.0.0.1:25566" \
    -L "$hub:127.0.0.1:6700" \
    "$REMOTE_USER@$REMOTE_HOST"
