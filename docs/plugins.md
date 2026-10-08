# 平台插件规范

平台业务插件与 MCDR 插件不是同一概念。MCDR 插件是节点接入程序；平台插件是服务端的可信业务模块。
当前不支持上传、动态导入任意路径、热重载或沙箱执行。
内置插件由 PluginRegistry、PluginControls 与 PluginHost 统一管理，可在网页开启 / 关闭；这是已导入模块的生命周期控制，不是任意代码热加载。
另有内置客户端适配器 `OneBotAdapter`，通过同一 PluginHost 管理生命周期；它拥有自己的 WS 连接与配置文件，
与只订阅事件的业务插件不同。网页可添加 / 移除其群客户端，详见 [接入文档](onebot-client-adapter.md)。

## 1. 注册入口与稳定 ID

唯一注册入口为 `server/src/plugins/builtins.ts` 的 `builtinPlugins`。插件必须显式导入，不根据文件名扫描或动态执行配置中的路径。

```text
server/src/plugins/
  builtins.ts             唯一内置注册表、配置类型与旧配置适配
  definitions/            每个插件的声明：元信息 / Schema / 工厂 / 公开配置白名单
    onebot.ts
    relay.ts
  PluginRegistry.ts       注册校验、ID 唯一性、公开快照
  PluginControls.ts       通用开关、持久化优先级、失败回滚
  PluginHost.ts           安装与逆序清理
  JsonConfigStore.ts      统一版本校验、复制隔离、0600 原子写入
  PluginError.ts          安全的管理错误
```

稳定 ID 必须匹配 `^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$`，例如 `onebot`、`relay`、`chat-logger`。
**注册表键、manifest.id、实例 name、YAML 配置节、开关文件键及 API 路径必须使用同一个 ID。**
显示名称与模块名可以改变，ID 不能随改名变化。重复注册、ID 不匹配、无效生命周期均拒绝启动。
注册表在创建开关管理器时封闭，不允许运行时增加模块；安装失败会逆序清理此前成功安装的插件。

## 2. 插件声明

使用 `definePlugin()`，一个声明负责以下内容：

| 字段 | 规范 |
| --- | --- |
| manifest | id、name、module、SemVer version、kind（adapter / business）、icon、description |
| manifest.schemaVersion | 当前配置 Schema 版本，现为 1；不同于代码版本 |
| settingsPanel / settingsMode / help | 前端设置面板标识、managed / readonly、操作说明；不会加载任意前端代码 |
| configSchema | Zod Schema，必须包含 enabled、默认值并 `.strict()`，拒绝未知配置字段 |
| files | 文件配置字段与默认相对路径；统一相对 `server/config.yaml` 所在目录解析 |
| create | 只创建实例；网络、订阅与定时器应在 install / setEnabled 中启动 |
| publicConfig | **明确的公开字段白名单**；不能返回 Token、密码、完整配置或私有绝对文件路径 |
| editor（可选） | 字段 presentation + apply；由服务端 Schema 生成统一编辑 UI，保存时实时校验、版本冲突检测并回滚 |

配置在创建实例前校验；工厂与公开配置投影使用独立副本，不通过修改对象影响其他插件。
`PluginRegistry.snapshot()` 是前端名单与共用元信息的来源，不能在控制台重复维护已安装插件列表。
新插件没有专用表单时，前端自动展示统一列表、开关与安全的只读配置快照；专用表单需显式加入前端白名单。

### 配置编辑器

需要网页编辑的插件在 definition 中声明 `editor.fields`，不得再在前端复制一套字段 Schema：

```ts
editor: {
  fields: [
    {key: "nodes", label: "转发客户端范围", description: "每行一个客户端 ID", placeholder: "survival\\ncreative"},
    {key: "include_system", label: "转发系统账号消息"},
  ],
  apply: (instance, config) => instance.configure(config),
}
```

字段 key 必须存在于插件的严格 Zod object Schema；`enabled`、文件路径、Token、密码和其他未列入
`publicConfig` 的字段不能编辑。当前支持 boolean、string、number、enum、string-array；服务端从 Zod
提取默认值、范围、长度、允许选项和数组约束，前端只负责控件显示与基本输入转换，最终校验仍在服务端。

注册快照的 `configuration` 包含 `editable`、`fields`、`revision`、`schemaVersion`、公开 `values` 和
`applyMode`。前端设置弹窗根据这些元数据生成表单；OneBot 的客户端连接管理仍使用专用表单，Token 不进入通用编辑器。

配置接口：

```text
GET /api/plugins/<id>/config
PUT /api/plugins/<id>/config
{"schemaVersion":1,"revision":"<sha256>","values":{"nodes":["survival"],"include_system":true}}
```

PUT 使用 dashboard_token 和 Origin 检查。revision 不匹配返回 409 并携带最新配置，避免覆盖别的管理员修改；
保存使用与开关相同的版本化、0600、原子 JSON 文件。成功后立即调用插件 `apply`，失败会尝试恢复文件和运行状态。
前端保留未提交草稿，配置更新或断线不会静默覆盖；退出、认证失效或离开会话清除敏感状态。

## 3. 启动配置与优先级

新增配置统一放在 `plugins.<id>`，不再增加插件专属的顶层键：

```yaml
plugin_state_file: data/plugins.json
plugins:
  onebot:
    enabled: true
    clients_file: data/onebot-clients.json
  relay:
    enabled: false
    nodes: []
    blacklist: []
    include_system: true
```

默认值由各插件的 Schema / files 声明提供，不在入口、控制器与网页各维护一份。
未操作过开关时，启动 enabled 使用 YAML / Schema 默认值；网页开关是持久覆盖，优先于启动 enabled。
其他启动策略修改后重启生效，网页目前只修改启停及 OneBot 客户端配置，不任意写回 YAML。

旧顶层 `relay` 和 `onebot_adapter_file` 仍可读取，加载后归一化为 `plugins.relay` 与 `plugins.onebot.clients_file`。
`plugins.relay` 整节优先于旧 relay，未填写字段使用 Schema 默认值；显式 clients_file 优先于旧文件路径。
旧数据文件不改名、不删除、不自动覆盖，原开关和客户端 UUID、凭证可以继续使用。
`Config.relay` / `Config.onebot_adapter_file` 是兼容投影，新业务代码使用规范配置或注册表。

## 4. 可变配置文件

数据与启动 YAML 分离，所有可变插件文件共用 `JsonConfigStore`：

```json
{"version": 1, "enabled": {"onebot": true, "relay": false}}
```

以上是 `plugin_state_file`（默认 `server/data/plugins.json`）。没有记录的 ID 使用启动默认值，不把默认值误写为用户覆盖。
`plugins.onebot.clients_file` 则维持现有格式：

```json
{"version": 1, "clients": []}
```

每个文件必须有 `version`，由插件自己的严格 Schema 定义其余字段；客户端 Token 属于私有配置，只供服务端连接使用。
规范要求：读取和保存前校验、缺失文件使用默认值、损坏 / 未支持版本 / 未注册 ID 拒绝启动。
保存使用同目录唯一临时文件、0600 权限和原子重命名；失败不修改已保存文件或内存值，清理临时文件。
不在加载时自动重写、重置或降级未知版本。升级文件格式必须提供明确迁移与测试；移除插件时需先备份并处理对应开关记录。
数据文件与身份库均只由一个 ChatHub 进程使用；数据目录及其备份不得提交 Git。

## 5. 生命周期与错误

托管插件实现 `ManagedPlugin`：

```ts
interface ManagedPlugin {
    name: string; // 与 manifest.id 一致
    install(platform: Platform): () => void;
    setEnabled(enabled: boolean): void;
}
```

install 只调用一次，必须返回清理函数；其内部失败时必须先清理自身部分创建的资源再抛错。
setEnabled 必须同步、幂等；禁用释放业务资源，但保留配置管理能力。开关保存失败不会调用生命周期操作；
生命周期切换失败时尝试恢复旧文件与运行状态，回滚异常单独写日志，不将内部错误或凭证回显给网页。
退出时按相反顺序卸载。清理函数必须清理订阅、定时器、连接及未完成调用，可安全重复清理。
管理错误统一使用 `PluginError(message, status)`；旧 AdapterError 是兼容别名。错误文本不得包含凭证或完整消息正文。

`onebot`：禁用停止连接与重连，保留群配置；`relay`：禁用无消息订阅，启用仅创建一份订阅。
底层临时工具 / 测试仍可直接用 `PlatformPlugin` / `PluginHost`，但不自动成为控制台托管插件。

## 6. 管理 API 与前端

- `GET /api/plugins`：返回已注册插件的安全元信息、enabled、enabledSource（default / persisted）、公开配置节与值。
- `GET /api/dashboard`：包含同一 `plugins` 列表，保留 pluginStates、relay、onebotAdapters 兼容投影。
- `PUT /api/plugins/<id>/state`：严格接受 `{"enabled": true}` 或 `{"enabled": false}`，只允许已注册 ID。
- OneBot 客户端专用接口仍为 `/api/plugins/onebot/clients`，保持现有鉴权与输入范围。

以上使用独立 dashboard_token；写接口执行相同 Origin 检查，返回 no-store、不允许 CORS。
通用控制器、开关接口和前端列表没有为每个插件新增 if / switch 分支；展示只能使用注册表公开投影，不直接返回磁盘 JSON。

## 7. 新增插件步骤

1. 编写实现类与严格配置 Schema，实现 install / setEnabled 和完整清理。
2. 在 `definitions/<id>.ts` 用 definePlugin 声明元信息、工厂、文件路径与公开配置白名单。
3. 在 `builtins.ts` 显式导入，并将它加入 builtinPlugins；配置类型、默认值、开关验证和列表自动派生。
4. 如需专用表单，再给前端 settingsPanels 增加受信任渲染器；否则自动使用只读快照。
5. 测试无配置默认值、未知字段、旧版本、秘密脱敏、幂等开关、安装 / 保存失败、清理与重启恢复。

参考 `definitions/relay.ts` 与 `definitions/onebot.ts`，不要复制已有入口的专用开关分支或直接 fs.writeFile 写文件。

## 8. 平台事件与消息规则

事件回调是同步的；耗时工作自行异步处理，并显式捕获 Promise 拒绝。
平台给订阅者传递消息副本，插件不能通过修改事件影响别的插件。

发送消息使用 `platform.send(groupId, segments)`；转发玩家消息时传入第三个 sourceMessage 参数，
核心保存因果来源，节点展示来源群与原作者。发送结果不会再次产生入站 `message` 事件；只有 OneBot Gateway
成功执行 API 发送时，才会发布带 `application: "onebot_api"` 的独立 `application` 事件。
message.origin 区分 player/system/application/plugin；系统消息的 systemKind 是节点提供的分类，
插件可按需过滤。presence 可订阅，但不能伪造标准 OneBot 的入群/退群语义。
异步投递必须处理群下线、超时等失败；不要在失败后无限重试，ACK 丢失不代表命令未执行。

`CrossServerRelay` 是完整示例：监听玩家 / QQ 成员 / 系统消息 / OneBot API 应用消息、排除源群、限定客户端范围、默认关闭。
启用后 plugins.relay.nodes 为空时向所有其他在线客户端转发，包含之后上线的客户端。
plugins.relay.blacklist 按客户端 nodeId 同时排除消息来源与投递目标，优先于 plugins.relay.nodes；
Minecraft 使用节点 node_id，OneBot 使用 `onebot:<机器人账号>:<群号>`。两份名单留空时不限制范围。
黑名单只影响跨服转发，不阻止连接、消息上报或应用直接发送。修改 server/config.yaml 后重启生效，控制台展示当前名单。
跨服转发的开关可即时切换，关闭时卸载订阅，开启时重新订阅，不累积重复订阅；网页开关保存到 plugin_state_file，优先于 plugins.relay.enabled 初始配置。
不同机器人对应同一个外部 QQ 群时不直接在这些客户端间转发。
plugins.relay.include_system=false 可只转发玩家聊天；识别 Minecraft 日志不属于转发插件的职责。

## 9. 指令系统

平台内置 `platform.commands`。客户端在聊天中直接发送 `help` 或 `指令名 参数`，无需斜杠或其他前缀。
只匹配纯文本消息的第一个完整单词，指令名不区分大小写，首尾空白会忽略；未注册、已禁用、
含图片 / mention 的消息仍走普通聊天。系统通知不执行指令。
原生 MCDR / Terraria、OneBot 群客户端入站，以及网页群聊 / OneBot API 发送均支持。
指令请求保留在消息历史中，但不发布普通聊天或应用事件，因此不会跨服转发或交给应用网关重复处理。
回复仅广播到来源客户端，不是私聊；回复不会递归触发指令。
API 发送指令时返回指令请求的 message_id，表示请求已接受；处理器与回复投递异步执行，最终回复另有 message_id。

插件通过可选 `commands` 字段声明指令，由 PluginHost 自动注册与清理：

```ts
const plugin: PlatformPlugin = {
    name: "example",
    commands: [{
        name: "echo",
        description: "回显文本",
        usage: "<text>",
        async execute({message, args, rawArgs, reply, platform}) {
            await reply(rawArgs || "用法：echo <text>");
        },
    }],
    install: platform => () => {},
};
```

指令名匹配 `^[a-z][a-z0-9_-]*$`，全平台唯一；`help`、`online` 为核心保留指令。
`online` 列出所有已连接的游戏服务器（Minecraft / Terraria），每服显示名称、nodeId、在线人数和玩家名单；
仅统计最近同步状态中 online=true 的真实成员，不包含 OneBot 群成员、虚拟机器人或系统账号。
空服务器显示“暂无在线玩家”，没有游戏服务器时返回提示；从任何客户端调用都仅回复来源客户端。
重复名称拒绝安装，部分注册会回滚；插件卸载时自动清理声明的指令，托管插件关闭时指令从 help 隐藏且不可调用。
`message` 包含来源 groupId、authorId、authorName；`args` 按空白分词（不解析引号），`rawArgs` 保留参数内部空白。
`reply` 接受字符串或 `Segment[]`，返回投递 Promise，处理器应等待它；异常记录到服务端日志并返回不含内部错误的提示。
指令默认对所有客户端用户开放，敏感操作需处理器按身份自行鉴权。

动态注册也可使用 `platform.commands.register(pluginId, definition)`，返回注销函数；
此方式的清理由插件自行负责，pluginId 应与实例 name 一致，以便托管开关同步生效。
