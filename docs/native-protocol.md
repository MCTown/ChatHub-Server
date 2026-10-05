# ChatHub Native Protocol v2

WebSocket：`/chathub/v2/connect`。UTF-8 JSON 文本帧。鉴权在 HTTP Upgrade 前完成，
使用 `Authorization: Bearer <node_password>`，兼容 `?access_token=...`。失败返回 HTTP 401。
内部协议与 OneBot 无关。密码不能放进 hello 或聊天帧。

## 注册

连接建立后 10 秒内发送：

```json
{
  "type": "hello", "version": 2,
  "node_id": "survival", "name": "生存服",
  "identity_scope": "minecraft:online"
}
```

`node_id` 为 1–64 位字母、数字、下划线、点、短横线；稳定且每个节点唯一。
重复的在线节点 ID 被拒绝。UUID 为带/不带短横线的 32 位十六进制值。
hello.name 是节点显示名；后续 player.name 为 Java 玩家名，identity_scope 表示 UUID 的认证来源。
hello 不携带 players；在线名单必须由服务端调用客户端 API 获取。

响应：

```json
{"type":"registered","version":2,"group_id":10000,"system_user":{"user_id":2,"name":"Minecraft Server"}}
```

注册不保存服务端客户端配置，仅分配稳定身份映射。断线后群从在线列表移除。

## 客户端 API：获取在线名单

客户端无需额外监听 HTTP 端口，在同一条 WebSocket 上处理服务端发起的 API 调用。
注册后服务端立即查询；每次成功后等待 5 秒再次查询，同一连接最多一个待完成的在线名单请求。

服务端 → 客户端：

```json
{"type":"api_call","request_id":"opaque-query-id","action":"get_online_players"}
```

客户端 → 服务端（成功时 players 必填，空数组明确表示无人在线）：

```json
{"type":"api_result","request_id":"opaque-query-id","ok":true,"players":[{"uuid":"8667ba71-b85a-4004-af54-457a9734eed7","name":"Steve"}]}
{"type":"api_result","request_id":"opaque-query-id","ok":true,"players":[]}
```

这是调用时获取的**完整当前在线名单**，不能返回历史 usercache、局部变化或未经核实的旧缓存。
最多 1000 个玩家，UUID 不可重复（忽略大小写与短横线）。不得返回机器人或系统虚拟账号。
request_id 必须原样返回；未知、已完成或旧连接请求的响应不生效。客户端不得主动推送 api_result。

失败时：

```json
{"type":"api_result","request_id":"opaque-query-id","ok":false,"error":"Minecraft list response timed out"}
```

无法获得完整名单或解析 UUID 时必须报错，不能用空数组或部分名单冒充成功。
服务端 API 超时使用 delivery_timeout_ms（默认 5000 ms）；失败或超时关闭连接（1011）并移除在线群，
避免无限保留过期在线名单。客户端按正常重连策略重新注册，再由服务端重新查询。
格式错误返回 invalid_request；不更新在线状态，请求仍待完成，直到收到有效响应或超时。

成功结果替换本群在线状态：名单中玩家标记在线，原在线但未出现的玩家标记离线；
已观察成员保留，不因离线从成员查询中删除。聊天、join/leave 系统消息均不改变在线状态。
服务端随后发送身份映射，供客户端展示结构化提及：

```json
{"type":"users","users":[{"uuid":"8667ba71-b85a-4004-af54-457a9734eed7","user_id":10000,"name":"Steve"}]}
```

users 是会话内已观察玩家的身份映射（含已离线玩家），不是另一份在线名单。
系统账号由 registered.system_user 单独提供。

MCDR 客户端每次调用执行 `list` 并等待英文原版输出（最多 3 秒），不阻塞 WS 收消息 / 投递线程。
MC 已停止时返回空名单；自定义 / 本地化输出需适配，否则调用失败。

## 入站事件

```json
{"type":"chat","event_id":"unique-in-session","player":{"uuid":"8667ba71-b85a-4004-af54-457a9734eed7","name":"Steve"},"segments":[{"type":"text","text":"hello"}]}
```

响应 `accepted` 含 event_id、message_id、user_id、uuid、name；去重范围为当前连接最近 2000 个事件。
消息 ID 由核心生成，不使用客户端时间作为 ID。

```json
{"type":"system","event_id":"unique-system-event","kind":"startup","text":"服务器已启动"}
```

system kind 是节点提供的分类（1–64 位小写字母/数字/下划线/短横线，字母开头），常见值为
startup/shutdown/join/leave/death/advancement。服务端不解析其业务含义；文本由 MCDR 完成后上报。
它生成 origin=system 的群消息，由虚拟账号 2（Minecraft Server）发送，通过标准 OneBot 事件流输出。
系统消息与玩家聊天一样具有 event_id 去重和 accepted 响应；系统 accepted 不含 uuid。
进出服系统消息仅用于聊天通知，不作为在线成员状态来源。

内容段：

```json
[{"type":"text","text":"hello"},{"type":"image","url":"https://example.com/a.png"},{"type":"mention","userId":10000},{"type":"mention","userId":"all"}]
```

单消息 1–100 段，每个文本最长 16000 字符，图片只接受 HTTP(S)。
首版插件发送玩家聊天为纯文本，不将普通 `@name` 文本自动解析成结构化提及。

## 出站投递

```json
{"type":"deliver","request_id":"opaque-id","messageId":123456,"authorName":"ChatHub","sourceGroupName":"创造服","segments":[{"type":"text","text":"hello"}]}
```

sourceGroupName 为来源客户端名称，转发消息显示为 `[客户端名称] <发送方名> 消息内容`。sourceGroupName 可省略，此时仅显示 `<发送方名> 消息内容`。插件使用 JSON 编码的 `tellraw @a` 展示，不拼接用户输入为控制台命令。

```json
{"type":"delivery_result","request_id":"opaque-id","ok":true}
{"type":"delivery_result","request_id":"opaque-id","ok":false,"error":"Minecraft server is not running"}
```

ACK 表示 MCDR 接受广播命令，不表示玩家已阅读或 MC 已反馈执行成功。
超时/断线使调用失败。超时后命令仍有可能执行，不保证 exactly-once。

## 错误与重连

协议错误返回 `{"type":"error","code":"invalid_request","message":"..."}`。
注册错误同时关闭连接（1008）。节点通过 WS ping/pong 保活，断线 5 秒后重连。
未注册期间不发送聊天；不保存离线聊天，不把旧连接排队事件发送到新连接。
重连 hello 不携带在线快照；registered 后由服务端重新调用 get_online_players。

## 从 v1 迁移（不兼容）

- 服务端与所有原生客户端必须一起升级；server_url 改为 `/chathub/v2/connect`。
- hello.version 改为 2，删除 hello.players；registered 不再含 users。
- 删除客户端 presence 进出服上报及注册后补同步逻辑，改为处理 api_call 并回复 api_result。
- 用户映射由 users 消息刷新，聊天 accepted 仍可更新对应玩家的映射。
- v1 路径不再提供，v1 hello、v2 hello 中的 players、presence 帧均被拒绝；不回退旧状态来源。
- node_id、identity_scope 和现有 identities.json 保持不变，虚拟身份 ID 不需重新分配。
- OneBot V11 协议与群聊通知不变；内部 presence 订阅事件仍由核心在名单对账时产生。
