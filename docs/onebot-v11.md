# OneBot V11 网关

ChatHub 是 **实现端**，Koishi/NoneBot 等是应用端。MCDR 节点不使用 OneBot。

## 正向 WebSocket

应用连接：

```text
ws://127.0.0.1:6700/onebot/v11        Universal
ws://127.0.0.1:6700/onebot/v11/api    只调用 API
ws://127.0.0.1:6700/onebot/v11/event  只接收事件
```

`Authorization: Bearer <onebot_token>` 或 URL `access_token` 鉴权，失败返回 HTTP 401。
无需 client_id、client_type、client_name。应用不发送生命周期事件来注册自己。
ChatHub 在 Event/Universal 连接上发布 lifecycle 和 30 秒 heartbeat，时间为 Unix **秒**。

## 反向 WebSocket

服务端配置 `onebot_reverse_urls`，ChatHub 主动连接应用端地址并发送标准请求头：

```http
Authorization: Bearer <onebot_token>
X-Self-ID: 1
X-Client-Role: Universal
```

要拆分连接，使用两个 URL 并添加 `?role=API` / `?role=Event`。
role 是本地配置参数，建立请求前移除。两条连接不互相踢掉。
失败后 5 秒重连；反向连接使用与正向网关相同的 API/事件处理器。

## 虚拟平台身份

机器人 `self_id = 1`，昵称 ChatHub。每个已连接 MCDR 服务端是一个群。
系统虚拟账号 `user_id = 2`，昵称 Minecraft Server；开服、关服、成就、死亡消息由它发送，
其 user_id 与 self_id 不同，避免应用误判为机器人自己的消息。
玩家 UUID+作用域映射为稳定的安全整数 user_id；node_id 映射为 group_id；这不是实际 QQ 身份。
OneBot 群客户端也通过该网关暴露为虚拟群；QQ 成员的 externalId + 独立作用域映射为虚拟 user_id，
并不把真实 QQ 号直接用作网关身份。客户端接入与这个网关的方向相反，见 [OneBot 客户端适配器](onebot-client-adapter.md)。
同 UUID 跨群保持同用户 ID，玩家名作为 nickname。群列表只含在线节点。
成员查询返回本次节点会话内观察到的玩家，包括已离线玩家，并包含虚拟机器人 ChatHub 和系统账号；不是在线列表。
Minecraft 在线状态由原生协议 v2 的客户端 get_online_players API 查询结果维护，不由聊天或进出服通知推断。

## API 范围

| API | 行为 |
| --- | --- |
| get_login_info / get_status / get_version_info | 平台登录、状态、版本 |
| get_friend_list | 空列表（平台没有好友/私聊模型） |
| get_group_list / get_group_info | 在线 MC 节点群 |
| get_group_member_list / get_group_member_info | 会话内已观察成员 |
| get_stranger_info | 当前群中可查到的用户、或平台机器人 |
| send_group_msg / send_msg（仅群） | 投递至该 MC 群；等待 MCDR ACK |
| get_msg | 最近 1000 条内存消息，包括成功出站消息 |
| can_send_image / can_send_record | HTTP(S) / base64 图片支持；语音不支持 |

接受 message 字符串/CQ 码或消息段数组；支持 text、at（包括 all）、image（HTTP(S) URL 或 `base64://`）。
auto_escape=true 时字符串全部视为纯文本。MCDR 节点默认将图片转为 v1 兼容的 CICode，游戏客户端安装 ChatImage 后可显示图片 / GIF。
节点配置 chat_image=false 时仅显示点击链接；已有配置若关闭了此项，需改为 true 并重载 MCDR 插件。
本地文件、音频、私聊、群管理和未实现 API 明确失败，不吞掉不支持的段。
不提供 HTTP API/上报或 V12，不保证所有依赖 QQ 专属 API 的机器人插件可用。

```json
{"action":"send_group_msg","params":{"group_id":10000,"message":"hello"},"echo":{"request":1}}
{"status":"ok","retcode":0,"data":{"message_id":123456},"echo":{"request":1}}
```

echo 可为任意 JSON 值，原样返回。参数错误 retcode=1400；未支持 action=1404；
离线、投递失败、超时或未知成员/消息 retcode=100，data=null。无 echo 不添加该字段。

### base64 图片与 ChatImage

先在控制台 **平台设置**（`/settings`）填写玩家端 ChatImage 可访问的 HTTP(S) 公网地址，例如
`https://chathub.example.com:6700`。只填写来源，不含路径、凭证、查询参数或片段。
保存即时生效并持久化；未设置时，base64 图片调用返回 `retcode=1400`，**日志**页面记录原因，
不投递到节点。现有 HTTP(S) 图片 URL 不需要此设置。

```json
{"action":"send_group_msg","params":{"group_id":10000,"message":[{"type":"image","data":{"file":"base64://<标准 Base64 编码>"}}]},"echo":1}
```

同样支持 `[CQ:image,file=base64://...]` 和群聊 `send_msg`。标准 Base64 必须含所需的补齐字符，不支持 data URI。
服务端限制原始和重新编码后的图片各不超过 **5 MiB**，仅接收完整 PNG、JPEG、GIF、WebP，
解码总像素不超过 **1600 万**（动画帧合计），完整解码并重新编码、移除元数据后保存。
GIF / WebP 保留动画；生成不可猜测文件名的 `/media/images/<随机文件名>` URL，
节点只收到此 URL，`get_msg` 也返回 URL，不再携带 base64。

图片下载通过 GET / HEAD，无需管理或 OneBot Token；**任何持有链接的人均可下载，请勿发送敏感内容**。
反向代理需将 `/media/images/` 转发到 ChatHub。默认保存在 `server/data/images/`，
链接有效期 **7 天**，后续上传清理过期文件；缓存最多 **256 MiB**，满额返回明确错误，不挤掉仍有效的图片。
公网地址变更只影响新链接，旧链接仍使用原地址。
正向和反向 OneBot WebSocket 的单报文上限为 **8 MiB**（含所有消息段和 JSON 开销）；原生节点通道仍为 256 KiB。

## 事件

玩家聊天和 MCDR 系统消息发布标准 group message event，带数值 self_id、user_id、group_id、message_id，
sender.nickname 为玩家名、QQ 成员名片 / 昵称或 Minecraft Server，message 为数组，raw_message 为 CQ 字符串。
应用发送和跨服投递不会再次伪装成玩家聊天事件，避免回环。
上线/下线不是入群/退群，因此不伪造 group_increase/decrease。

规范参考：[OneBot V11](https://github.com/botuniverse/onebot-11)。这是实现了上述子集的 Minecraft 平台网关，
不是 QQ 客户端、不是 OneBot 透明中继，也不是全 API 实现。
