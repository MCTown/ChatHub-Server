# ChatHub 2 架构决策

## 定位与边界

ChatHub 服务端 + MCDR 节点共同构成 **Minecraft 聊天平台的 OneBot 实现端**。
MCDR 不再伪装成 QQ OneBot 客户端；OneBot 应用（Koishi/NoneBot）不再被当作聊天来源节点。

```text
MC A ─ MCDR node ─┐
MC B ─ MCDR node ─┼─ Native adapter ─ Platform core ─ OneBot adapter ─ 应用
MC C ─ MCDR node ─┘                       │
QQ 群 ─ 真实 OneBot 机器人 ─ OneBotAdapter ─┘
                                   事件总线 / 插件
                                     跨服转发
```

依赖方向：适配器和业务插件 → 平台核心 → 领域模型。只有适配器识别 JSON/WebSocket/OneBot。
核心通过 IdentityDirectory 端口查询身份，文件实现位于 storage/；测试可替换该端口。
核心方法不返回 OneBot payload。入口是唯一的依赖组装点。

### 消息追溯（被动观测）

Platform 持有独立的 TraceStore；Core、native 投递、CrossServerRelay 与对外 OneBot Gateway 在现有处理位置记录步骤。
源消息携带仅限服务端内部的 traceId，插件复用它；每个 OneBot 请求单独建链路，显式传递给 Core 的应用投递。
traceId 不进入 native / OneBot 协议，不新增聊天事件，不改变路由，也不把真实机器人上游 API 纳入网关收发观测。
没有跨应用因果字段时，不推测玩家命令与应用回复之间的关联。
TraceStore 使用有界内存、脱敏快照及每条步骤 / 报文上限；晚到的完成回调不会恢复已淘汰链路。
Dashboard 轮询只取摘要，独立鉴权的详情 API 按需读取报文。具体状态语义见 [控制台](dashboard.md#消息链路)。

## 平台模型

- Group：一个 MCDR 节点对应一个群，稳定身份为 `node_id`；名称只是显示名称。
- OneBot 客户端群：稳定身份为 `onebot:<机器人账号>:<群号>`，带 kind=onebot 和外部群号。
- User：`identity_scope + UUID` 为身份；玩家名为可变昵称，不是主键。
- 外部 QQ 成员：`onebot:v11:qq + QQ号` 为身份，使用 externalId，不伪造 UUID、不推断 QQ 在线状态。
- Member：会话期间观察到的玩家，包含在线状态。下线不等于退群。
- Message：核心生成数值 ID，保存来源、作者、群、内容及转发来源消息 ID。
- NodeTransport：核心调用的投递端口，返回异步投递结果。

V11 使用稳定、正数、安全整数的虚拟 `user_id` / `group_id`。机器人自身用户 ID 为 1。
系统账号 ID 为 2，昵称 Minecraft Server，与机器人账号、玩家 UUID 身份独立。
它是每个群的虚拟成员，不需要伪造 Minecraft UUID，不能由玩家或在线名单覆盖。
虚拟 ID **不是实际 QQ 号**。禁止直接把 128 位 UUID 转成 JS 数字。
同一身份作用域内同 UUID 跨服合并；离线服、不同身份体系必须使用不同作用域。

映射文件只存身份键 → 数值 ID 和分配计数器。分配时原子写盘，启动时校验，损坏时拒绝启动。
不存密码、连接地址、节点名单、成员名单或订阅关系；节点凭密码注册，完全不需要服务端白名单。
OneBot 插件管理的外连配置另存到 plugins.onebot.clients_file（兼容 onebot_adapter_file），不与上述身份映射或 Minecraft 注册混在一起。
不得删除生产映射文件，否则外部机器人保存的 ID 将失效。不要同时启动多个进程共享该文件。

## 消息语义与防回环

1. 玩家聊天：入站消息，生成 ID，发布 `message` 事件。
2. OneBot `send_group_msg`：应用出站投递，MCDR ACK 后返回 API 结果，并发布独立的应用发送事件，不作为玩家聊天发布。
3. 跨服插件：订阅玩家、系统及显式标记的 OneBot API 应用消息，向其他群投递，带来源群和作者信息，不重新生成入站事件。
4. 系统消息：启动、停止、死亡、成就由 MCDR 识别和组织文本；上报后核心以系统账号发布
   `message` 事件，origin=system，并保留节点提供的 opaque systemKind。它不是某个玩家发言，也不是机器人自发消息。
5. 在线变化：服务端调用客户端 get_online_players，对完整名单对账，生成内部 `presence` 事件，
   不伪造 OneBot `group_increase/decrease`；玩家聊天和系统 join/leave 通知不更新在线状态。

节点 event_id 在当前会话内做有界去重；断线后不重放聊天，重连注册后服务端重新查询在线名单。
客户端排队事件绑定连接实例，旧连接消息不进入新会话；断线期间系统消息也不重放。
消息历史最多 1000 条，仅内存。
插件和外部应用必须避免主动制造新的聊天回环；跨进程重放、持久队列不是首版能力。

## 核心与插件

核心负责认证接入、身份映射、群生命周期、成员状态、消息 ID、投递 ACK 和事件发布。
跨服转发属于独立业务插件 `server/src/plugins/CrossServerRelay.ts`，默认关闭。
启用后默认包含玩家和系统消息，可设置 plugins.relay.include_system=false 只转发玩家聊天。
插件由统一注册表声明 ID、元信息、Schema、实例工厂与公开配置投影；生命周期与原子存储规范见 [插件规范](plugins.md)。
死亡/成就日志识别、通知模板、可选事件提供插件的去重归 MCDR，服务端不理解 Minecraft 特定日志格式。
业务插件通过 `Platform.subscribe` 和 `Platform.send` 工作，不直接操作 socket。OneBot API 成功应用发送以独立的 `application` 事件发布；Dashboard 等未标记的应用发送不会进入跨服转发。
OneBot 客户端适配器作为受信任的插件独立实现外部 WS、API 确认、重连及接入 / 断开，不将协议逻辑放入核心。
统一生命周期由 PluginHost 管理，插件提供 name/install/dispose，详见 plugins.md。
首版插件是受信任的代码模块，不是动态加载第三方脚本的沙箱；没有通用插件商店或管理 API。

## 协议接口

- `/chathub/v2/connect`：原生节点接口，节点是 WS 客户端，并在该连接上提供 get_online_players API。
- `/onebot/v11`：正向 WS Universal 接口，OneBot 应用主动连接。
- `/onebot/v11/api`、`/onebot/v11/event`：正向 WS 分离接口。
- `onebot_reverse_urls`：服务端向 OneBot 应用建立反向 WS，支持 Universal/API/Event。

外部接口无论正向还是反向，ChatHub 始终是 OneBot **实现端**：发布事件，执行 action。
NapCat 等其他 OneBot 实现端不能接入这个应用接口；QQ 接入通过独立 `OneBotAdapter` 插件，
此时 ChatHub 在该连接上作为 OneBot 应用端调用真实机器人的 API。详见 onebot-client-adapter.md。
V12、HTTP 和完整 QQ API 不属于首版范围。不要将首版描述为“全部 OneBot 能力均已实现”。

## 安全与运维

节点密码和 OneBot 应用 token 分离，可通过环境变量提供。默认只监听回环地址。
公网部署应由反向代理提供 WSS；明文 WS 不保护密码。所有持有节点密码的节点都是受信任的平台成员，
可以声明节点 ID、UUID 和作用域；这不是 Minecraft 账户所有权验证。
同 ID 重复节点拒绝注册，不踢掉旧节点。原生连接需 10 秒内 hello，消息最大 256 KiB。
单连接最多 100 个待完成调用，出站 WS 缓冲超过 1 MiB 时断开慢消费者。
身份文件是单进程数据；投递超时会失败，但无法证明命令绝未执行，调用方不能盲目重试。
dashboard_token 还允许添加 / 移除 OneBot 外连群客户端及开启 / 关闭两个内置插件，是受信任的管理员权限；不再是纯只读凭证。

## 验证与开发规则

新增协议先实现适配器，新增业务先实现事件订阅插件。变更应同时更新协议文档和测试。
提交前执行 `npm run check`、`npm test`、`npm run test:plugin`、`npm run build:plugin`。
群查询只返回当前已连接节点；成员是当前会话内观察到的玩家，非完整离线玩家数据库。
热重载、私聊、封禁/踢人、消息撤回、音频、QQ 账号绑定已从旧架构移除，不假装成功。
