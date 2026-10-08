# 本机部署：2 个 MC 服务端 + ChatHub

> 本目录脚本用于本机演示环境，不是生产部署流程。生产服务器为 `ubuntu@192.168.31.236`，应用目录 `/opt/chathub`，由 `chathub.service` 管理。生产升级见 [production.md](production.md)。本文中的旧公网 SSH 地址仅属于演示环境。

一台机器上运行：

```text
Paper 生存服 (:25565) ─┐
                        ├─ MCDR 节点 ──ws── ChatHub (:6700) ── OneBot V11
Paper 创造服 (:25566) ─┘                        └─ Web 控制台 :6700
```

两个 Minecraft 服务端分别由 MCDR 管理，各自加载 ChatHub 插件并以独立 `node_id`
注册到同一个 ChatHub 服务端。ChatHub 监听 `0.0.0.0:6700`，因此控制台可通过局域网访问。

## 使用

```bash
bash deploy/setup.sh    # 构建 + 下载 Paper + 生成 2 个节点配置（可重复执行）
bash deploy/start.sh    # 在 tmux 中启动 ChatHub 与两个节点
bash deploy/status.sh   # 查看会话、端口、群/消息快照
bash deploy/stop.sh     # 优雅停止
```

首次启动 Paper 需要生成世界，大约 30–60 秒。之后用 `deploy/status.sh` 应能看到
两个群（`survival` / `creative`）以及 `服务器已启动` 系统消息。

## 凭证与文件

- `deploy/.secrets` 保存节点密码、OneBot token、控制台 token；由 `setup.sh` 首次生成，
  已被 git 忽略。控制台 token 用于登录 `http://<本机IP>:6700/`。
- `deploy/<node>/` 是各节点的 MCDR 工作目录；`server/` 中是 Paper 与 `server.properties`，
  `config/chathub/chathub.json` 是节点配置（MCDR 插件数据目录）。
- `deploy/logs/` 保存各进程输出。

原生节点协议现为 v2。已有部署升级时需更新服务端和节点插件，并将各节点
`config/chathub/chathub.json` 的 server_url 改为 `/chathub/v2/connect`，再重启两端。
保留 node_id、identity_scope 和 `server/data/identities.json`；不要为协议升级清空身份库。
setup.sh 会生成 v2 地址，但也会覆盖演示节点配置，不适合直接用于保留自定义配置的升级。

## 配置要点

- 两个服务端 `online-mode=false`，所以插件使用 `identity_mode=offline`、
  `identity_scope=minecraft:offline`。同名玩家跨服会被识别为同一虚拟用户。
- `server/config.yaml` 的 `host` 已设为 `0.0.0.0`；密码保持占位，实际值由
  `start.sh` 通过 `CHATHUB_*` 环境变量注入，避免写入仓库。
- 控制台展示客户端、成员、消息与转发配置，并可在“平台插件”添加 / 移除 OneBot 群客户端。
  控制台 token 因此属于受信任管理员权限，不再是纯只读凭证；机器人 Token 单独保存到
  `server/data/onebot-clients.json`，勿提交或暴露。
- 管理接口只校验 `dashboard_token`，不校验请求来源，反向代理改写 Host 不影响添加 / 移除客户端；服务端不返回 CORS 响应头。

## 从本地访问

服务在服务器上，用 SSH 隧道映射到本地即可测试，见 [ssh-tunnel.md](ssh-tunnel.md)：

```bash
ssh -N -p 8789 \
  -L 25565:127.0.0.1:25565 \
  -L 25566:127.0.0.1:25566 \
  -L 6700:127.0.0.1:6700 \
  apricityx@server.apricityx.top
```

之后本地访问 `http://127.0.0.1:6700/`，Minecraft 连 `localhost:25565` / `localhost:25566`。

## 验证

```bash
# 群列表（需要 onebot_token）
source deploy/.secrets
node -e '
const WebSocket = require("ws");
const ws = new WebSocket("ws://127.0.0.1:6700/onebot/v11/api",
  {headers: {Authorization: "Bearer " + process.env.ONEBOT_TOKEN}});
ws.on("open", () => ws.send(JSON.stringify({action: "get_group_list", echo: 1})));
ws.on("message", raw => { console.log(raw.toString()); ws.close(); });
'; 
```

## 局限

- 没有可用的 Minecraft 客户端时，无法触发真实的玩家聊天；可用 OneBot 应用
  发送 `send_group_msg`，MCDR 会把消息渲染进游戏并在控制台显示投递结果。
- 这是本机演示环境，未配置代理、防火墙与 WSS，请勿直接暴露到公网。
