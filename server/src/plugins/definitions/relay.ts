import {CrossServerRelay, relayConfigSchema} from "../CrossServerRelay";
import {definePlugin} from "../PluginRegistry";

export const relayPlugin = definePlugin({
    manifest: {id: "relay", name: "跨服消息转发", module: "CrossServerRelay", version: "2.0.0",
        kind: "business", icon: "arrow", settingsPanel: "relay", settingsMode: "managed", schemaVersion: 1,
        help: "保存后即时生效并覆盖 plugins.relay 的启动策略，重启后保留；启停使用上方开关。黑名单同时排除来源与目标。",
        description: "在 Minecraft 与 OneBot 客户端间转发消息，支持黑名单与循环保护。"},
    configSchema: relayConfigSchema,
    create: config => new CrossServerRelay(config),
    publicConfig: config => ({nodes: config.nodes, blacklist: config.blacklist, include_system: config.include_system}),
    editor: {
        fields: [
            {key: "nodes", label: "转发客户端范围", description: "每行一个客户端 ID；留空表示所有在线客户端。", placeholder: "survival\ncreative\nonebot:机器人账号:群号"},
            {key: "blacklist", label: "客户端黑名单", description: "每行一个客户端 ID；黑名单优先于转发范围，留空表示不排除。", placeholder: "private-server\nonebot:机器人账号:群号"},
            {key: "include_system", label: "转发系统账号消息", description: "开启时转发开关服、死亡、成就等系统通知；关闭时仅转发成员聊天。"},
        ],
        apply: (instance, config) => instance.configure(config),
    },
});
