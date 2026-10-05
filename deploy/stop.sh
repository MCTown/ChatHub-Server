#!/usr/bin/env bash
# 优雅停止：先让两个 Minecraft 服务端执行 stop（MCDR 会发出关服系统消息），
# 再停止 ChatHub，最后清理 tmux 会话与可能残留的 Paper 进程。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORTS=(25565 25566)

echo "==> 请求 Minecraft 服务端停止"
for node in survival creative; do
    tmux send-keys -t "chathub-$node" "stop" Enter 2>/dev/null || true
done
for _ in $(seq 1 15); do
    if ! ss -ltn 2>/dev/null | grep -qE ":(${PORTS[0]}|${PORTS[1]})\b"; then break; fi
    sleep 1
done

echo "==> 停止 ChatHub"
tmux send-keys -t chathub-server C-c 2>/dev/null || true
sleep 2

for name in chathub-server chathub-survival chathub-creative; do
    tmux kill-session -t "$name" 2>/dev/null || true
done

# MCDR 若被强制结束，可能遗留 Paper 子进程；按端口精确定位后清理。
for port in "${PORTS[@]}"; do
    for pid in $(ss -ltnp 2>/dev/null | grep -E ":$port\b" | grep -oE 'pid=[0-9]+' | cut -d= -f2 | sort -u); do
        echo "    清理残留进程 pid=$pid (:$port)"
        kill "$pid" 2>/dev/null || true
    done
done
sleep 1

echo "==> 已停止"
