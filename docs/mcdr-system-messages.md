# MCDR 系统消息

Minecraft 业务识别和文案组织放在 `plugin/chathub/system_messages.py`，不在 ChatHub 核心或跨服转发插件。

| 类型 | MCDR 输入 | 输出 |
| --- | --- | --- |
| startup | on_server_startup | 配置的开服文案 |
| shutdown | on_server_stop | 配置的关服文案 |
| join | on_player_joined | 玩家名 + 加入了服务器 |
| leave | on_player_left | 玩家名 + 离开了服务器 |
| advancement | 常见英文原版日志 / PlayerAdvancementEvent | 清理颜色代码后的系统文本 |
| death | 常见英文原版日志 / PlayerDeathEvent | 清理颜色代码后的系统文本 |

节点通过原生 `system` 帧上报最终文本和事件 ID，不需要查玩家 UUID，也不能指定任意虚拟用户 ID。
ChatHub 将其转换为普通群消息，固定作者是 **Minecraft Server（user_id=2）**。
它不是 ChatHub 机器人（self_id=1），也不是消息中提到的玩家。
不需要伪造 Minecraft UUID。系统账号出现在 OneBot 群成员查询中，保留最后发言时间。
进出服通知与在线状态同步独立，即使无法解析玩家 UUID 也会发送通知。
服务端调用客户端 get_online_players 时通过 `list` 查询完整名单，不产生加入通知；
关服后的 API 查询返回空名单，不额外产生离开通知。进出服钩子不再发送 presence 状态帧。

## 节点配置

在 MCDR 的 `chathub.json` 中加入或修改：

```json
{
  "system_messages": {
    "enabled": true,
    "startup_text": "服务器已启动",
    "shutdown_text": "服务器已关闭",
    "dedup_seconds": 2
  }
}
```

省略的字段使用默认值。可自定义 `death_patterns` / `advancement_patterns` 正则数组，
适配本地化、模组或不同服务端的日志；显式指定数组会替换默认规则，空数组关闭该类日志识别。
例如：

```json
{
  "system_messages": {
    "death_patterns": ["^\\w+ 被僵尸杀死了$"],
    "advancement_patterns": ["^\\w+ 达成了进度.*$"]
  }
}
```

规则是运维者提供的受信任配置。只识别服务端日志，排除玩家聊天；不会把全部控制台输出上传。
可选事件提供插件可上报更多死亡/成就类型，同一文本由日志和 provider 在窗口内同时观察时去重，
同来源连续发生的真实事件不合并。并不承诺覆盖所有 Minecraft 版本、语言和模组的死亡文案。

## 转发仍由 ChatHub 决定

```yaml
plugins:
  relay:
    enabled: true
    nodes: [survival, creative]
    include_system: true
```

include_system=false 仅排除跨服转发，不影响 OneBot 应用收到系统消息；节点 enabled=false 才是不再上报。
MCDR 不知道转发目标，节点从不自己决定发送到其他服务器。

## 生命周期限制

正常 on_server_stop 可发送关服消息，插件卸载时最多等待 1 秒让当前连接队列发出。
断线期间的系统消息不会缓存重放；强制杀死 MCDR、机器断电时无法保证产生/送达关服通知。
注册/重连不会伪造开服消息。投递仍是 best-effort，不承诺 exactly-once。
