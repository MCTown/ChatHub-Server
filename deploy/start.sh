#!/usr/bin/env bash
# 启动 ChatHub 服务端与 2 个 MCDR 节点（各自运行一个 Paper 服务端）。
# 每个进程在一个 tmux 会话中运行，输出同时写入 deploy/logs/。
# 停止使用 deploy/stop.sh。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEPLOY="$ROOT/deploy"
LOGS="$DEPLOY/logs"
SECRETS="$DEPLOY/.secrets"

[ -f "$SECRETS" ] || { echo "缺少 $SECRETS，请先运行 bash deploy/setup.sh"; exit 1; }
# shellcheck disable=SC1090
set -a; . "$SECRETS"; set +a
mkdir -p "$LOGS"

echo "==> 启动 ChatHub 服务端（监听 0.0.0.0:6700）"
if tmux has-session -t chathub-server 2>/dev/null; then
    echo "    chathub-server 已在运行"
else
    tmux new-session -d -s chathub-server -c "$ROOT" \
        "CHATHUB_NODE_PASSWORD='$NODE_PASSWORD' CHATHUB_ONEBOT_TOKEN='$ONEBOT_TOKEN' CHATHUB_DASHBOARD_TOKEN='$DASHBOARD_TOKEN' npm start 2>&1 | tee '$LOGS/chathub.log'"
fi

# 等待 ChatHub 端口就绪，避免节点首次连接失败后等待重连
for _ in $(seq 1 30); do
    if ss -ltn 2>/dev/null | grep -q ':6700'; then break; fi
    sleep 0.5
done

for node in survival creative; do
    echo "==> 启动节点 $node"
    if tmux has-session -t "chathub-$node" 2>/dev/null; then
        echo "    chathub-$node 已在运行"
    else
        tmux new-session -d -s "chathub-$node" -c "$DEPLOY/$node" \
            "mcdreforged start 2>&1 | tee '$LOGS/$node.log'"
    fi
done

echo
echo "==> 已启动。用 bash deploy/status.sh 查看状态"
echo "    控制台： http://<本机IP>:6700/   (token 见 deploy/.secrets)"
