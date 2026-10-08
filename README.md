# ChatHub 2

**游戏聊天平台的 OneBot 实现端。** ChatHub 服务端与 MCDReforged / tModLoader 节点共同组成平台，
每个 MC 服务端是一个群，玩家 UUID 是内部身份，玩家名是昵称。对外提供 OneBot V11 数值虚拟身份。

```text
MC → MCDR 节点 → ChatHub 原生协议 → 平台核心 → OneBot V11 → Koishi / NoneBot
                                        └─ 跨服转发插件（默认关闭）
```

## 文档

- [架构与开发约定](docs/architecture.md)
- [原生节点协议](docs/native-protocol.md)
- [OneBot V11 接口与兼容范围](docs/onebot-v11.md)
- [OneBot 机器人 / 群客户端适配器](docs/onebot-client-adapter.md)
- [平台插件注册、配置与生命周期规范](docs/plugins.md)
- [MCDR 系统消息](docs/mcdr-system-messages.md)
- [Web 控制台与群聊](docs/dashboard.md)
- [本机部署与 SSH 隧道](deploy/README.md)

## 仓库

```text
server/src/domain/       内部模型
server/src/core/         群、用户、消息、投递、稳定身份映射
server/src/storage/      稳定身份端口的文件适配器
server/src/adapters/     原生节点 / OneBot 网关
server/src/plugins/      业务插件 / OneBot 群客户端适配器
web/                    响应式控制台、独立群聊与插件接入（无外部资源依赖）
plugin/chathub/          MCDR 节点：身份解析、网络线程、游戏展示、事件钩子
tests/                  服务端与协议测试
plugin/tests/           Python 单元测试
scripts/                插件打包
```

## 服务端

Node.js >=22：

```bash
npm install
npm test
npm run build
npm start
```

编辑 `server/config.yaml`，先更改 `node_password` 与 `onebot_token`。
也可使用 `CHATHUB_NODE_PASSWORD`、`CHATHUB_ONEBOT_TOKEN` 覆盖；不要使用示例密码上线。
Web 控制台使用独立 `dashboard_token` / `CHATHUB_DASHBOARD_TOKEN`，不共用上述凭证。
默认监听 127.0.0.1:6700；远程节点需调整 host，公网需 WSS 反向代理。
`npm run dev` 启动开发模式。配置改变后重启；不再提供旧版 worker 热重载。

- MCDR 节点：`ws://host:6700/chathub/v2/connect`
- OneBot 应用：`ws://host:6700/onebot/v11`
- 反向连接应用：配置 `onebot_reverse_urls`
- Web 控制台：`http://host:6700/`，支持明暗切换；登录后查看客户端、成员、消息及发送失败日志，并在平台插件页添加 / 移除 OneBot 群客户端。
  各页面使用独立路由（如 `/plugins`、`/messages`），支持深链接、刷新及前进 / 后退；页面与设置窗口提供轻量动效。

原生游戏节点凭密码自报身份，服务端不维护节点白名单。身份映射保存到
`server/data/identities.json`，不要删除；同一文件只供一个 ChatHub 进程使用。
网页管理的 OneBot 群客户端单独保存到 `server/data/onebot-clients.json`（含机器人 Token，勿提交）。

## Terraria / tModLoader 节点

新增服务器侧 mod：[`tmod/ChatHub/`](tmod/ChatHub/)。转发玩家聊天、进退服、死亡，以及 Boss 开战 / 结算 / 每人伤害占比；支持接收 ChatHub 消息、在线名单查询和自动重连，玩家无需安装。
安装、构建、凭证配置与统计口径见 [tModLoader 节点说明](tmod/README.md)。

## MCDR 节点

Python >=3.10、MCDR >=2.13：安装 `plugin/requirements.txt` 中依赖。

```bash
python3 -m pip install -r plugin/requirements.txt
npm run build:plugin
```

将 `dist/chathub-2.0.0.mcdr` 放入 MCDR 的 plugins/。首次运行生成 `config/chathub/chathub.json`：

```json
{
  "server_url": "ws://127.0.0.1:6700/chathub/v2/connect",
  "password": "change-node-password",
  "node_id": "survival",
  "name": "生存服",
  "identity_mode": "cache",
  "identity_scope": "minecraft:online",
  "game_directory": "",
  "reconnect_seconds": 5,
  "color": "gray",
  "chat_image": true
}
```

每服 node_id 必须不同，改名不改 ID。cache 模式从登录日志或 game_directory/usercache.json 解析真实 UUID，
无可验证 UUID 时跳过玩家聊天并警告，在线名单查询返回失败，不使用玩家名伪造在线身份；进出服系统通知不受影响。game_directory 空值使用 MCDR working_directory。
离线服使用 identity_mode=offline，并设置独立 scope，例如 `minecraft:offline:my-network`。
代理服应使用实际转发的 UUID 和适当 scope；不保证特殊认证插件无需适配。

原生协议 v2：客户端提供 `get_online_players` API，服务端注册后立即调用，成功后每 5 秒再次查询。
每次调用通过 `list` 读取完整在线名单，目前支持英文原版输出；自定义/本地化输出需要解析适配。
不再发送 hello.players 或 presence；查询失败 / 超时断开节点并重新连接，不把部分名单当作成功。
只提供群广播，使用 JSON 编码的 tellraw；图片默认像 v1 一样转成 `[[CICode,url=...,name=图片]]`。
游戏客户端安装 [ChatImage](https://modrinth.com/mod/chatimage) 后可显示图片 / GIF，无需服务端安装模组。
已有 `config/chathub/chathub.json` 若设置了 `"chat_image": false`，需改为 `true` 并重载 MCDR 插件；
显式设置 `false` 时仍只显示可点击的 `[图片]` 链接。节点仅接收 HTTP(S) 图片 URL，不下载本地文件 / base64。
OneBot 应用可发送 `base64://` 图片：先登录控制台 **平台设置** 填写玩家可访问的 HTTP(S) 公网地址，
服务端校验、存储后生成 `/media/images/` 下载链接供 ChatImage 使用；未设置时发送失败并出现在 **日志** 页。
支持 PNG / JPEG / GIF / WebP（含动画），单张最多 5 MiB、总像素 1600 万，链接有效期 7 天，缓存上限 256 MiB。
图片链接公开下载且无需 Token；反向代理必须转发 `/media/images/`，不要发送敏感内容。
详见 [OneBot 图片说明](docs/onebot-v11.md#base64-图片与-chatimage)。
MCDR 负责开服/关服、玩家进出服通知、常见英文原版死亡/成就日志识别及文本组织；可选事件提供插件也可补充。
这些消息由虚拟系统账号 Minecraft Server（user_id=2，非机器人 self_id=1）上报到 OneBot 群消息流。
system_messages 可设置开关、通知文本和日志正则；本地化/模组日志可自定义 death_patterns / advancement_patterns。
相同日志与事件提供插件的重复上报会在 MCDR 端短期去重。
不重放断线期间聊天；投递结果代表命令被 MCDR 接受，不代表游戏确认或玩家阅读。

## 指令系统

在任意 ChatHub 客户端的聊天中直接发送 `help`，查看所有当前可用指令，**不需要 `/` 或其他前缀**。
内置 `online` 返回每个已连接游戏服务器（Minecraft / Terraria）的在线人数与玩家名单，使用最近同步的在线状态，不包含 OneBot 群成员。
插件可以定义 `指令名 参数` 形式的指令；MCDR、Terraria、OneBot 群客户端及网页群聊共用同一套指令。
指令与回复不会跨服转发，结果只广播到来源客户端；未匹配指令的文本仍作为普通聊天。
插件关闭后其指令不可用，卸载时自动移除。开发接口见 [插件指令规范](docs/plugins.md#9-指令系统)。

## 跨服转发

OneBot 群客户端：登录 **平台插件 → OneBot 群客户端**，填写真实机器人的 V11 Universal 正向 WS 地址、
群号与可选 Token，保存后该账号 / 群成为平台客户端。双向收发、重连及重启恢复详见
[适配器文档](docs/onebot-client-adapter.md)。`dashboard_token` 因此不再是纯只读凭证，应只交给受信任管理员。
插件列表与设置窗口均提供 **开启 / 关闭** 按钮，即时生效，无需重启。
关闭 OneBot 断开所有外连群客户端但保留配置，开启后自动连接；关闭跨服转发不影响节点与应用网关。
网页开关保存在 `server/data/plugins.json`（可用 plugin_state_file 修改），重启后保留，优先于 plugins.relay.enabled 的初始值；
未操作过开关时 OneBot 默认开启，跨服转发默认使用下述配置。

`server/config.yaml`：

```yaml
plugins:
  onebot:
    enabled: true
    clients_file: data/onebot-clients.json
  relay:
    enabled: true
    nodes: []
    blacklist: [private-server, "onebot:123456:987654"]
    include_system: true
```

转发功能默认关闭；开启后默认转发玩家、系统账号消息，以及来自 ChatHub OneBot API 的成功应用发送；include_system=false 时仅排除系统消息。
nodes 为空且 enabled=true 时转发所有在线 Minecraft / OneBot 群客户端；限定名单时使用
`onebot:<机器人账号>:<群号>` 加入 OneBot 客户端。
blacklist 使用相同的客户端 ID；黑名单客户端的消息不向其他客户端转发，也不接收其他客户端的转发，
且黑名单优先于 nodes 名单。留空即不排除任何客户端；修改配置后重启 ChatHub 生效。
转发不回发源客户端，也不在同一个外部 QQ 群的不同机器人客户端之间转发；新上线客户端自动加入转发范围。
黑名单仅限制此插件，不影响客户端连接、OneBot 消息事件或应用直接投递。
ChatHub OneBot API 调用 send_group_msg/send_msg 及网页群聊的共享 OneBot API 发送成功后会按上述规则转发到其他客户端；其他普通应用发送不会触发跨服转发。API 指定的源群已直接投递，因此不会重复回发源客户端。
插件配置统一位于 `plugins.<id>`，注册、Schema 与默认值由 `server/src/plugins/builtins.ts` 及 definitions/ 声明，
前端从注册表读取元信息。旧顶层 relay / onebot_adapter_file 仍兼容，现有数据文件无需改名或重建；详见 [插件规范](docs/plugins.md)。

## 网页群聊

控制台导航“群聊”或 **http://127.0.0.1:6700/chat** 提供独立 QQNT 风格虚拟群聊天，不改变原有观测页。
仅用 `dashboard_token` 登录，群列表与文字 / 图片发送复用共享 `OneBotApi`，不获取节点密码或网关 Token。
支持桌面 / 手机切群、Enter 发送、Shift+Enter 换行与中文输入法保护；草稿仅保存在当前工作区内存中。
图片支持 PNG / JPEG / GIF / WebP，最多 5 MiB；需配置可访问的 `public_url`，通过 `ImageStore.ingest()` 校验存储，聊天仅加载同源 `/media/images/` 图片。
受限接口 `POST /api/chat/messages` 接收 `{group_id, text, image?}`，要求独立 Dashboard Bearer 凭证、JSON 与 Origin 校验，图片仅接受 `base64://...`。
详情见 [控制台文档](docs/dashboard.md#群聊工作区)。

## 检查

```bash
npm run check
npm test
npm run test:plugin
npm run test:integration # requires Python dependencies; live WS, simulated MC console
npm run build:all
```

## 2.0 不兼容升级

原生协议从 v1 改为 v2，服务端与 MCDR 插件必须同步升级；已有节点配置的 server_url 需手动改为
`/chathub/v2/connect`。保留 node_id、identity_scope 与身份库。详见 [协议迁移说明](docs/native-protocol.md#从-v1-迁移不兼容)。

旧 `/onebot/chathub`、onebot_client_config、clients.yaml、QQ 群号路由和 QQ↔UUID 绑定已移除。
节点配置需重新填写。旧 qq_uuid_map 不能当新虚拟身份库迁入。
这是标准 OneBot V11 **群聊能力子集**，不实现 QQ 专属群管理、私聊、音频、HTTP 或 V12。
