# 通过 SSH 隧道把服务映射到本地

服务器（`server.apricityx.top`）上的端口：

| 端口 | 用途 |
| --- | --- |
| `6700` | ChatHub 原生协议 + OneBot V11 + Web 控制台 |
| `25565` | 生存服 |
| `25566` | 创造服 |

你的登录方式 `ssh apricityx@server.apricityx.top -p 8789` 会话就落在运行这些服务的这台机器上，
所以在 SSH 里 `127.0.0.1` 就是它们监听的地址，直接做本地转发即可。

## 一条命令（Linux / macOS / Windows PowerShell 通用）

在你自己的电脑上运行：

```bash
ssh -N -p 8789 \
  -o ExitOnForwardFailure=yes \
  -o ServerAliveInterval=30 \
  -o ServerAliveCountMax=3 \
  -L 25565:127.0.0.1:25565 \
  -L 25566:127.0.0.1:25566 \
  -L 6700:127.0.0.1:6700 \
  apricityx@server.apricityx.top
```

- `-N`：只建立隧道，不开远程 shell。
- `-L 本地端口:目标主机:目标端口`：把本地端口转发到服务器上的 `127.0.0.1:目标端口`。
- 命令会占用当前终端；按 `Ctrl-C` 结束隧道。
- 想后台运行就加 `-f`，结束用 `pkill -f 'ssh -N -p 8789'`。

也可使用仓库里的脚本（复制到你本地执行）：

```bash
bash deploy/local-tunnel.sh
# 自定义本地端口： LOCAL_BASE=20000 bash deploy/local-tunnel.sh
```

## 更省事：写进 ~/.ssh/config

```sshconfig
Host chathub
    HostName server.apricityx.top
    Port 8789
    User apricityx
    LocalForward 25565 127.0.0.1:25565
    LocalForward 25566 127.0.0.1:25566
    LocalForward 6700  127.0.0.1:6700
    ExitOnForwardFailure yes
    ServerAliveInterval 30
    ServerAliveCountMax 3
```

之后只需 `ssh -N chathub`。

## 本地怎么连

- **控制台**：浏览器打开 <http://127.0.0.1:6700/>，用 `deploy/.secrets` 里的 `DASHBOARD_TOKEN` 登录。
- **Minecraft**：客户端「多人游戏 → 直接连接」→ `localhost:25565`（生存服）/ `localhost:25566`（创造服）。
  服务端 `online-mode=false`，离线模式用户名即可进入；两个服同名玩家会识别为同一虚拟用户。
- **OneBot 应用**：`ws://127.0.0.1:6700/onebot/v11`，Bearer token 用 `ONEBOT_TOKEN`。

## 验证隧道

```bash
# Linux / macOS
nc -vz 127.0.0.1 6700 && nc -vz 127.0.0.1 25565 && nc -vz 127.0.0.1 25566
# Windows PowerShell
Test-NetConnection 127.0.0.1 -Port 6700
```

成功后 `ss -ltnp | grep -E ':(6700|25565|25566)'`（Linux）应能看到本地监听。

## 让局域网内其它设备也能用

默认 `-L` 只绑定本地 `127.0.0.1`。若想让手机或第二台电脑通过你的电脑中转，
改成绑定所有网卡（Windows 首次会弹出防火墙授权，选允许）：

```bash
ssh -N -p 8789 \
  -L 0.0.0.0:25565:127.0.0.1:25565 \
  -L 0.0.0.0:25566:127.0.0.1:25566 \
  -L 0.0.0.0:6700:127.0.0.1:6700 \
  apricityx@server.apricityx.top
```

然后其它设备连 `<你的电脑IP>:25565` 等。

## 常见问题

- `bind: Address already in use`：本地该端口被占用。换本地端口，例如
  `-L 15565:127.0.0.1:25565`，然后连 `localhost:15565`。本机 6700 常被占用，
  可改用 `-L 16700:127.0.0.1:6700`。
- `administratively prohibited` / `open failed`：服务器 sshd 关闭了 `AllowTcpForwarding`。
  本机 sshd 使用默认值 `yes`，正常可用；如报此错请检查 `/etc/ssh/sshd_config`。
- 连接被重置：确认 `deploy/status.sh` 里三个端口在监听、`chathub-*` 会话在运行。
- 长时间空闲断线：命令里的 `ServerAliveInterval=30` 会保活；也可用 `autossh` 自动重连。

> 隧道本身不额外加密或开放公网端口：流量走已有的 SSH 连接。不要把本机 `deploy/.secrets`
> 中的凭证转发给他人；测试完成按 `Ctrl-C` 关闭隧道即可。
