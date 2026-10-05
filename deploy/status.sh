#!/usr/bin/env bash
# 查看 ChatHub 部署状态：tmux 会话、端口、控制台数据。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEPLOY="$ROOT/deploy"

echo "== tmux 会话 =="
tmux ls 2>/dev/null || echo "（无）"

echo
echo "== 端口 =="
ss -ltn 2>/dev/null | grep -E ':(6700|25565|25566)\b' || echo "（无监听）"

echo
echo "== 控制台快照 =="
if [ -f "$DEPLOY/.secrets" ]; then
    # shellcheck disable=SC1090
    set -a; . "$DEPLOY/.secrets"; set +a
    curl -fsS -H "Authorization: Bearer $DASHBOARD_TOKEN" http://127.0.0.1:6700/api/dashboard \
        | python3 -c '
import json, sys
data = json.load(sys.stdin)
print("节点 / 群：", [(g["nodeId"], g["name"], g["id"]) for g in data["groups"]])
print("统计：", data["stats"])
print("最近消息：", [(m["origin"], m["authorName"], m["segments"][0]["text"][:40]) for m in data["messages"][:8]])
'
else
    echo "缺少 deploy/.secrets"
fi

echo
echo "== 节点注册日志 =="
for node in survival creative; do
    log="$DEPLOY/logs/$node.log"
    [ -f "$log" ] && { echo "--- $node ---"; grep -aE 'Registered as group|ChatHub|Done \(' "$log" | tail -5; }
done
