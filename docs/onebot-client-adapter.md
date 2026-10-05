# OneBot 群客户端适配器

`OneBotAdapter` 是受信任的平台客户端适配器插件。它让 **真实机器人账号 + 一个 QQ 群** 成为
一个 ChatHub 客户端：群内消息进入平台，平台投递通过机器人发送回这个群。
它不是 ChatHub 的 `/onebot/v11` 应用网关，也不是 MCDR 插件。

## 网页添加

1. 升级构建后重启 ChatHub，登录控制台，打开 **平台插件 → OneBot 群客户端**。
2. 填写机器人端的 **OneBot V11 Universal 正向 WebSocket** 地址，例如 `ws://127.0.0.1:3001/`。
   这是从 **ChatHub 服务端** 可访问的地址；不是浏览器的 localhost，也不是 ChatHub 自己的网关。
3. 填写一个群号；可选填写客户端名称及机器人端的 Access Token。
4. 点击 **保存并连接**。配置先保存，随后显示连接、验证、已连接或重连状态。

适用于提供标准 V11 Universal WS 的 NapCat、Lagrange 等实现。机器人必须已登录并加入目标群，
支持 `get_login_info`、`get_group_info`、`get_group_member_info`、`send_group_msg` 及原样返回 `echo`。
连接后查询账号、群信息和机器人自身的群成员身份，全部验证成功后才创建在线 ChatHub 群。
只提供 HTTP、反向 WS 或分离 API/Event 地址的机器人不适用于此入口；V12 不支持。

同一地址可添加不同群。同一真实账号和群只有一个在线客户端；不同地址指向同一账号 / 群时，
重复配置仍保留但显示验证失败，不抢占已连接的客户端。名称变化不改变身份。
群稳定节点 ID 为 `onebot:<机器人账号>:<群号>`，ChatHub 群 ID 使用平台的稳定身份分配器。
移除立即断开连接，删除保存的配置；重新添加相同账号 / 群保留虚拟群 ID。

## 双向消息与转发

- 仅接收目标账号、目标群的 `post_type=message` 群消息。私聊、通知、匿名消息、自发消息、
  `message_sent` 和其他已配置桥接机器人的消息忽略；每个客户端有 2,000 条入站 ID 的有界去重缓存。
- QQ 成员使用 `onebot:v11:qq + QQ号` 分配虚拟用户 ID，不伪造 UUID，也不与 Minecraft 玩家自动绑定。
  昵称优先使用群名片，其次昵称。成员列表仅包含本次连接中发言的成员，不是完整群名单，
  不推断 QQ 在线状态，也不增加“在线玩家”指标。
- 支持文本、HTTP(S) 图片 URL 与 @。其他内容显示 `[语音]`、`[文件]` 等文字占位；
  不读取或下载机器人本地文件，不转发 base64，不支持撤回、私聊或群管理。
- 入站 @QQ号映射为 ChatHub 虚拟 ID。投递回 QQ 时，仅把已观察到的 QQ 成员映射为真实 @；
  不认识的虚拟 ID 降级成 `@ID` 文本，绝不把 Minecraft / ChatHub ID 误当 QQ号。`@all` 保留。
- 转发到 QQ 与 MCDR 的消息统一显示为 `[来源客户端名称] <发送方名> 消息内容`，例如 `[生存服] <Steve> 你好`。OneBot 使用分段数组发送，文本内的 CQ 字符串不会被执行；应用直接投递到 QQ 时不添加来源前缀。
- `send_group_msg` 必须返回 `status=ok, retcode=0` 和消息 ID 才记入已投递缓存。
  排队 / 失败、断线或超时均失败，**超时不证明群消息未发送，不自动重试投递**。

添加客户端不自动开启群间转发。开启现有业务插件：

```yaml
plugins:
  relay:
    enabled: true
    nodes: [] # 全部在线 Minecraft / OneBot 客户端
    include_system: true
```

若 nodes 已限制为 `[survival, creative]`，需加入对应 `onebot:<账号>:<群号>` 或改为空数组。
变更 plugins.relay 策略需重启；网页开关与添加 / 移除客户端即时生效。
不同机器人接同一真实 QQ 群时，不在这两个客户端之间直接转发，且忽略已配置桥接机器人发言，
防止平台自己的群发回声重新进入消息流。其他未配置的机器人或外部桥接工具仍需自行避免回环。

## 持久化与安全

`plugins.onebot.clients_file` 默认是 `server/data/onebot-clients.json`，共用 JsonConfigStore 的版本校验、0600 权限及原子重命名规则。
旧顶层 onebot_adapter_file 仍兼容，文件格式和客户端 ID 保持不变；详见 [插件规范](plugins.md)。
该文件包含连接 Token 的明文，服务端必须能读取它来重连；保护数据目录及备份，不要提交到 Git。
与稳定身份文件分离，不改变 Minecraft 节点自行接入、不维护节点白名单的机制。
重启恢复已保存客户端，断线每 5 秒重连并重新验证；离线期间不排队或重放聊天。
身份和配置文件均只应由一个 ChatHub 进程使用，损坏配置会拒绝启动而非静默覆盖。

Token 仅以 `Authorization: Bearer ...` 发给机器人，不放在地址中，不在 API、列表、错误信息中回显，
不写入浏览器 storage；表单仅临时保留未提交草稿，成功保存、离开插件页或退出登录会清空 Token。
地址必须是 ws/wss，不带 userinfo、查询参数或片段；需鉴权时使用独立 Token 输入框。
公网使用 WSS，明文 WS 不保护凭证。

**dashboard_token 现在有添加 / 移除外连客户端的权限，不再是纯只读凭证。**
插件列表及设置窗口的开启 / 关闭按钮控制整个 OneBot 适配器，关闭会断开所有群并取消重连，但不删除配置。
关闭状态保存在 plugin_state_file，重启后保留；开启后自动连接所有保留客户端。ChatHub 的 OneBot 应用网关不受此开关影响。
这是受信任的管理员功能，会让服务器连接填写的网络地址（包括内网）；不要把该凭证交给只读访客。
每个服务端最多保存 50 个客户端，单个连接最多 100 个待完成 API 调用；帧限制 256 KiB。
客户端的安全约束不能防止管理员误填不可信端点；管理员必须有权使用目标机器人与群。

## 管理 API

使用独立 `Authorization: Bearer <dashboard_token>`，不接受 query token、节点密码或 onebot_token。
不校验请求来源，可经反向代理访问；不返回 CORS 响应头，其他网站无法读取管理接口响应。
POST 使用 `application/json`，请求体上限 8 KiB。

```text
POST /api/plugins/onebot/clients
{"address":"ws://127.0.0.1:3001/","group_id":"123456789","access_token":"可选","name":"可选"}

DELETE /api/plugins/onebot/clients/<配置UUID>
```

POST 返回 201 和不含 Token 的配置状态，**不代表机器人已经连接**；列表与后续状态由
`GET /api/dashboard` 的 `onebotAdapters.clients` 返回。重复地址 / 群返回 409，输入错误返回 400。
此 API 不支持修改其他配置、安装任意插件、群管理或重启服务端。
网页超时或退出登录只取消等待，不保证服务端没保存；重新登录后查看列表再决定是否重试。
