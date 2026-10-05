import {z} from "zod";
import {OneBotAdapter} from "../OneBotAdapter";
import {definePlugin} from "../PluginRegistry";

export const onebotPlugin = definePlugin({
    manifest: {id: "onebot", name: "OneBot 群客户端", module: "OneBotAdapter", version: "2.0.0",
        kind: "adapter", icon: "message", settingsPanel: "onebot", settingsMode: "managed", schemaVersion: 1,
        help: "关闭插件会断开所有 OneBot 群客户端，保留配置；开启后自动重连。机器人 Token 不在列表回显。",
        description: "将真实机器人与群聊接入 ChatHub，统一收发消息、自动重连。"},
    configSchema: z.object({enabled: z.boolean().default(true), clients_file: z.string().min(1).optional()}).strict(),
    files: [{key: "clients_file", defaultPath: "data/onebot-clients.json"}],
    create: (config, context) => new OneBotAdapter(config.clients_file, context.deliveryTimeoutMs),
    publicConfig: () => ({}), // Client tokens and private filesystem paths never enter manifests.
});
