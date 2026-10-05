# ChatHub · tModLoader 节点

服务器侧 mod，连接 **ChatHub Native Protocol v2**。针对 Terraria 1.4.4 / tModLoader **2026.08** 构建（.NET 8），玩家无需安装此 mod。适用于专用服务器，也包括“Host & Play”启动的独立服务器进程；不会在普通客户端或单人世界额外连接 ChatHub。

## 功能

- 玩家聊天 → ChatHub；ChatHub / 跨服 / OneBot 消息 → 游戏聊天。普通聊天保留原文本，不转发 `/` 命令或队伍私聊。
- 进服、退服：服务器每 tick 比对完成登录的玩家槽位，保留离线角色名；同槽位换角色也会正确通知。
- 玩家死亡：拦截实际 `Player.KillMe`，转发 Terraria 本地化死亡原因，不靠字符串猜测。
- Boss 开战、击败、逃脱 / 团灭，以及可选的定时战况：每名本场在线玩家的伤害、百分比，包含 0 伤害玩家和中途离线玩家。
- 完整在线名单查询、提及显示、图片 URL 文本显示、投递 ACK、自动重连；断线期间的消息不补发，旧连接工作不带到新连接。

## 安装与配置

1. 将 `ChatHub.tmod` 放入**服务器** tModLoader 保存目录的 `Mods/`，在 `Mods/enabled.json` 数组中加入 `"ChatHub"`（保留其他 mod）。
2. 启动并加载一次世界，生成 `ModConfigs/ChatHub.json`。首次默认关闭，不会使用示例密码连接。
3. 停服后修改配置，再启动。保存目录可通过 `-tmlsavedirectory` 指定。

```json
{
  "Enabled": true,
  "ServerUrl": "ws://127.0.0.1:6700/chathub/v2/connect",
  "Password": "填写 ChatHub 服务端 node_password",
  "NodeId": "terraria-survival",
  "Name": "泰拉瑞亚生存服",
  "IdentityScope": "terraria:characters:my-network",
  "ReconnectSeconds": 5,
  "ForwardChat": true,
  "ForwardJoinLeave": true,
  "ForwardDeaths": true,
  "ForwardBosses": true,
  "BossProgressSeconds": 0,
  "BroadcastBossReports": true
}
```

也可用服务器环境变量 `CHATHUB_NODE_PASSWORD` 覆盖 `Password`。该配置**不是** tModLoader 的 ServerSide ModConfig，凭证不会同步到玩家；Linux/macOS 加载时限制文件权限为 0600。修改配置需重新加载世界或重启服务器。跨公网建议使用 `wss://`。

`NodeId` 每台服务器唯一。`IdentityScope` 必须是 `terraria:` 命名空间；不同认证域不要复用。**Terraria 原版没有可信的账户 UUID**，节点按精确角色名生成稳定的 32 位十六进制角色标识，作用域用于隔离服务器。它不是 Steam 账户，不提供身份防冒用；改角色名会产生新身份，同域同名视作同一角色。

ChatHub 服务端也要使用本次代码构建的版本：旧版本只接受 Minecraft 玩家名，会拒绝中文或带空格角色名。使用 `npm run build` 构建并重启 ChatHub。

### 跨服 / 群转发

mod 上报消息后由现有 ChatHub 插件负责路由：网页和 OneBot 事件可直接看到；要转发到其他游戏 / QQ 群，需要开启 **cross-server-relay**，确认节点未被黑名单排除。系统通知要保持 `include_system=true`。详见根目录 README 的转发配置。

接收显示：`[来源服] <发送方> 内容`。图片显示 URL，不下载或执行远端内容；远端 Terraria 聊天标签转成全角括号，防止物品/颜色标签注入。

## Boss 统计口径

结算示例：

```text
Boss：克苏鲁之眼 · 已击败 · 42.5s
伤害合计：3000
小明: 1800（60.00%）
Alice: 900（30.00%）
旁观者: 0（0.00%）
未归属伤害: 300（10.00%）
```

- 多人直接命中通过服务器 **DamageNPC 包发送者 + 实际 StrikeNPC 结果**归属，不使用 `NPC.target`、最后攻击者或客户端 `OnHitNPC` 推测。伤害最多计到命中前剩余生命，避免过量伤害刷占比。
- Debuff 持续伤害、环境 / 无可信玩家来源的服务器伤害归入“未归属伤害”，持续伤害按真实生命扣除统计，**不假装归给最后攻击者**。占比分母是所有已统计伤害，包括未归属部分。
- 同一战斗保留全体在场角色，在线新玩家也加入统计；离线玩家已有伤害不会丢失。百分比独立保留两位小数，合计可能因四舍五入略有误差。
- 默认识别 `npc.boss` 和 `realLife` 关联。原版额外处理世吞分裂、双子（两只共同结算）、骷髅王手、机械骷髅王部件、石巨人部件和月总部件。
- Boss 所有部件消失后等待 2 秒再结算；杀死附肢不提前报击败，没有完整死亡证据则报“逃脱 / 团灭”。`BossProgressSeconds=0` 只报开战与结算，设为如 `30` 每 30 秒发一次完整战况。
- 一般模组 Boss 的 `boss/realLife` 机制可直接使用；**自定义多阶段换 NPC、未设置 realLife 的独立附肢、自行修改 life 的特殊伤害需要专门适配**，不保证所有模组通用。当前同一时间多个世吞 / 多对双子按原版家族合并，其他 Boss 按独立根 NPC 区分；普通小怪 / Boss 召唤物不计入 Boss 伤害。
- 原版多人伤害包本身是客户端上报，本 mod 并非反作弊系统。

## 构建

### tModLoader 内构建

把 `tmod/ChatHub/` 完整复制到 tModLoader 的 `ModSources/ChatHub/`（文件夹名必须是 `ChatHub`），从 Workshop → Develop Mods 构建；生成的 `Mods/ChatHub.tmod` 放到服务器。

### .NET CLI

安装 .NET 8 SDK 与对应版本 tModLoader，仓库根目录执行：

```sh
dotnet build tmod/ChatHub/ChatHub.csproj -p:TModLoaderPath=/absolute/path/to/tModLoader
```

默认在 tModLoader 保存目录生成 `Mods/ChatHub.tmod`。隔离构建时可增加：

```sh
dotnet build tmod/ChatHub/ChatHub.csproj \
  -p:TModLoaderPath=/absolute/path/to/tModLoader \
  -p:ExtraBuildModFlags="-tmlsavedirectory /absolute/path/to/build-save"
```

只校验程序集、不打包：增加 `-p:BuildMod=false`。

## 验证

```sh
npm test
dotnet run --project tmod/tests/ChatHub.Tests.csproj
```

C# 测试无需 Terraria、NuGet 测试框架或运行中的 ChatHub：覆盖身份、Boss 分组结算/占比/0 伤害/逃脱、渲染，以及真实 loopback WebSocket 鉴权、API、ACK、重连会话隔离。

可选的实际 tModLoader 服务器冒烟测试：创建独立小世界，只监听 localhost，连接临时 ChatHub 并检验注册、在线名单轮询、游戏主线程广播/ACK，然后退出服务器，不动真实存档：

```sh
npm run build
TML_PATH=/absolute/path/to/tModLoader \
CHATHUB_TMOD=/absolute/path/to/ChatHub.tmod \
node tmod/tests/runtime-smoke.cjs
```

上线前建议两名真实玩家验收：分别进服/聊天/死亡/退服，打一次克眼、双子、世吞，检查伤害排行与逃脱结算；再断开 ChatHub 并重连，确认离线聊天没有补发。模组特有 Boss 需在目标整合包验收。
