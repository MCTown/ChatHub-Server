import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import {z} from "zod";
import {normalizePluginConfigurations, pluginInputSchema, PluginConfigurations} from "./plugins/builtins";
import {publicUrlSchema} from "./storage/PlatformSettings";

const dashboardOrigin = z.string().trim().url().refine(value => {
    try {
        const url = new URL(value);
        return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password &&
            url.pathname === "/" && !url.search && !url.hash;
    } catch { return false; }
}, "Use an http/https origin without credentials, path, query or fragment")
    .transform(value => new URL(value).origin);

const schema = z.object({
    host: z.string().default("127.0.0.1"),
    port: z.number().int().min(0).max(65535).default(6700),
    node_password: z.string().min(1).refine(value => !/[\r\n]/.test(value), "Invalid password"),
    onebot_token: z.string().min(1).refine(value => !/[\r\n]/.test(value), "Invalid token"),
    onebot_public_url: z.string().trim().url().refine(value => {
        try {
            const url = new URL(value);
            return ["ws:", "wss:"].includes(url.protocol) && !url.username && !url.password &&
                url.pathname === "/onebot/v11" && !url.search && !url.hash;
        } catch { return false; }
    }, "Use a ws/wss Universal gateway URL without credentials, query or fragment").optional(),
    dashboard_token: z.string().min(1).refine(value => !/[\r\n]/.test(value), "Invalid dashboard token").optional(),
    dashboard_origins: z.array(dashboardOrigin).max(50).default([]),
    identity_file: z.string().default("data/identities.json"),
    public_url: publicUrlSchema.default(""),
    settings_file: z.string().min(1).default("data/settings.json"),
    image_directory: z.string().min(1).default("data/images"),
    onebot_adapter_file: z.string().min(1).optional(), // Legacy input alias.
    plugin_state_file: z.string().default("data/plugins.json"),
    delivery_timeout_ms: z.number().int().min(100).default(5000),
    onebot_reverse_urls: z.array(z.string().url()
        .refine(value => /^wss?:/.test(value), "Use ws/wss")
        .refine(value => {
            const role = new URL(value).searchParams.get("role");
            return role === null || ["API", "Event", "Universal"].includes(role);
        }, "Invalid reverse connection role")).default([]),
    plugins: pluginInputSchema.optional(),
    relay: z.unknown().optional(), // Legacy input alias, validated by the relay definition.
});

export type Config = Omit<z.infer<typeof schema>, "plugins" | "relay" | "onebot_adapter_file"> & {
    plugins: PluginConfigurations;
    /** Compatibility projections; use plugins.<id> for new code. */
    relay: PluginConfigurations["relay"];
    onebot_adapter_file: string;
};

export function loadConfig(directory: string): Config {
    const input = z.record(z.unknown()).parse(YAML.parse(fs.readFileSync(path.join(directory, "config.yaml"), "utf8")) ?? {});
    const parsed = schema.parse({...input,
        node_password: process.env.CHATHUB_NODE_PASSWORD ?? input.node_password,
        onebot_token: process.env.CHATHUB_ONEBOT_TOKEN ?? input.onebot_token,
        onebot_public_url: process.env.CHATHUB_ONEBOT_PUBLIC_URL ?? input.onebot_public_url,
        public_url: process.env.CHATHUB_PUBLIC_URL ?? input.public_url,
        dashboard_token: process.env.CHATHUB_DASHBOARD_TOKEN ?? input.dashboard_token,
        dashboard_origins: process.env.CHATHUB_DASHBOARD_ORIGINS === undefined ? input.dashboard_origins
            : process.env.CHATHUB_DASHBOARD_ORIGINS.split(",").map(value => value.trim()).filter(Boolean),
    });
    const plugins = normalizePluginConfigurations(parsed.plugins, {relay: parsed.relay,
        onebotClientsFile: parsed.onebot_adapter_file}, directory);
    return {...parsed, plugins, relay: plugins.relay, onebot_adapter_file: plugins.onebot.clients_file!,
        identity_file: path.resolve(directory, parsed.identity_file),
        settings_file: path.resolve(directory, parsed.settings_file),
        image_directory: path.resolve(directory, parsed.image_directory),
        plugin_state_file: path.resolve(directory, parsed.plugin_state_file)};
}
