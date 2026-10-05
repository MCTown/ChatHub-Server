#!/usr/bin/env bash
# 一键准备本机 ChatHub 演示环境：
#   - 构建 ChatHub 服务端与 MCDR 插件
#   - 下载 Paper 服务端 jar
#   - 创建 2 个 MCDR 节点（生存服 / 创造服），各自带独立端口与配置
#   - 写入节点密码、OneBot token、控制台 token（保存在 deploy/.secrets）
#
# 重复执行是安全的：已存在的文件会被覆盖为最新配置。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEPLOY="$ROOT/deploy"
CACHE="$DEPLOY/cache"
LOGS="$DEPLOY/logs"
PAPER_NAME="paper-1.21.8-60.jar"
PAPER_SHA="8de7c52c3b02403503d16fac58003f1efef7dd7a0256786843927fa92ee57f1e"
PAPER_URL="https://fill-data.papermc.io/v1/objects/$PAPER_SHA/$PAPER_NAME"
SERVER_URL="ws://127.0.0.1:6700/chathub/v2/connect"
PLUGIN_FILE="chathub-2.0.0.mcdr"

mkdir -p "$CACHE" "$LOGS"

echo "==> 检查依赖"
command -v java >/dev/null || { echo "缺少 java（需要 Java 21）"; exit 1; }
command -v mcdreforged >/dev/null || { echo "缺少 mcdreforged，请先 pip install mcdreforged"; exit 1; }
command -v tmux >/dev/null || { echo "缺少 tmux"; exit 1; }
if ! python3 -c "import websocket" >/dev/null 2>&1; then
    echo "==> 安装插件依赖 websocket-client"
    python3 -m pip install --user 'websocket-client>=1.8.0'
fi

echo "==> 生成/复用管理凭证"
SECRETS="$DEPLOY/.secrets"
if [ ! -f "$SECRETS" ]; then
    umask 077
    {
        echo "NODE_PASSWORD=$(openssl rand -hex 16)"
        echo "ONEBOT_TOKEN=$(openssl rand -hex 20)"
        echo "DASHBOARD_TOKEN=$(openssl rand -hex 20)"
    } > "$SECRETS"
fi
# shellcheck disable=SC1090
set -a; . "$SECRETS"; set +a

echo "==> 构建 ChatHub 服务端与插件"
( cd "$ROOT" && npm run build:all )

echo "==> 准备 Paper $PAPER_NAME"
if [ ! -f "$CACHE/$PAPER_NAME" ]; then
    curl -fsSL -o "$CACHE/$PAPER_NAME" "$PAPER_URL"
fi
printf '%s  %s\n' "$PAPER_SHA" "$CACHE/$PAPER_NAME" | sha256sum -c -

setup_node() {
    local node_id="$1" name="$2" port="$3" motd="$4"
    local dir="$DEPLOY/$node_id"
    mkdir -p "$dir"
    echo "==> 配置节点 $node_id ($name, :$port)"
    ( cd "$dir" && mcdreforged init >/dev/null )
    (
        cd "$dir"
        # MCDR：用 Paper、分配内存、关闭联网检查与交互式控制台包装
        sed -i \
            -e 's|^start_command:.*|start_command: java -Xms512M -Xmx1G -XX:+UseG1GC -jar server.jar nogui|' \
            -e 's|^handler: .*|handler: bukkit_handler|' \
            -e 's|^check_update:.*|check_update: false|' \
            -e 's|^advanced_console:.*|advanced_console: false|' \
            -e 's|^telemetry:.*|telemetry: false|' \
            config.yml

        mkdir -p server plugins config/chathub
        cp "$CACHE/$PAPER_NAME" server/server.jar
        printf 'eula=true\n' > server/eula.txt
        cat > server/server.properties <<PROPERTIES
server-port=$port
online-mode=false
enforce-secure-profile=false
motd=$motd
level-name=world
level-type=flat
generate-structures=false
difficulty=hard
spawn-protection=0
view-distance=4
simulation-distance=4
max-players=20
network-compression-threshold=-1
enable-command-block=false
allow-flight=true
PROPERTIES

        cp "$ROOT/dist/$PLUGIN_FILE" plugins/
        # MCDR 的 load_config_simple 读取插件数据目录 config/<plugin_id>/，
        # 不是 plugins/。早期版本误放此处，清理掉避免误解。
        rm -f plugins/chathub.json
        NODE_ID="$node_id" NODE_NAME="$name" SRV_URL="$SERVER_URL" NODE_PW="$NODE_PASSWORD" \
            python3 - <<'PY'
import json, os
config = {
    "server_url": os.environ["SRV_URL"],
    "password": os.environ["NODE_PW"],
    "node_id": os.environ["NODE_ID"],
    "name": os.environ["NODE_NAME"],
    # 本机服务端 online-mode=false，因此使用离线 UUID 身份。
    # 两个节点共享同一离线身份范围：同名玩家跨服仍是同一虚拟用户。
    "identity_mode": "offline",
    "identity_scope": "minecraft:offline",
    "reconnect_seconds": 5,
}
with open("config/chathub/chathub.json", "w", encoding="utf-8") as handle:
    json.dump(config, handle, ensure_ascii=False, indent=2)
PY
    )
}

setup_node survival "生存服" 25565 "ChatHub 生存服"
setup_node creative "创造服" 25566 "ChatHub 创造服"

echo
echo "==> 准备完成。下一步： bash deploy/start.sh"
echo "    凭证见 $SECRETS"
