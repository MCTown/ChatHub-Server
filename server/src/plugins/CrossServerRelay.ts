import {Platform} from "../core/Platform";
import {PlatformPlugin} from "./PluginHost";
import {z} from "zod";

export const relayConfigSchema = z.object({
    enabled: z.boolean().default(false),
    nodes: z.array(z.string().trim().min(1)).default([]),
    blacklist: z.array(z.string().trim().min(1)).default([]),
    include_system: z.boolean().default(true),
    system_name: z.string().trim().min(1).max(80).default("server"),
    hide_system_name: z.boolean().default(true),
}).strict();

export interface RelayOptions {
    enabled: boolean;
    /** Empty = all authenticated online groups. Otherwise restrict by node ID. */
    nodes?: string[];
    /** Node IDs excluded as both sources and destinations; takes precedence over nodes. */
    blacklist?: string[];
    include_system?: boolean;
    system_name?: string;
    hide_system_name?: boolean;
}

export function crossServerRelay(options: RelayOptions): PlatformPlugin {
    return {name: "relay", install: platform => installCrossServerRelay(platform, options)};
}

/** Managed lifecycle: disabled relays own no message subscription. */
export class CrossServerRelay implements PlatformPlugin {
    readonly name = "relay";
    private platform?: Platform;
    private enabled: boolean;
    private unsubscribe?: () => void;

    constructor(private options: RelayOptions) { this.enabled = options.enabled; }
    install(platform: Platform): () => void {
        if (this.platform) throw new Error("Relay already installed");
        this.platform = platform;
        if (this.enabled) this.unsubscribe = installCrossServerRelay(platform, {...this.options, enabled: true});
        return () => { this.unsubscribe?.(); this.unsubscribe = undefined; this.platform = undefined; };
    }
    setEnabled(enabled: boolean): void {
        if (this.enabled === enabled) return;
        this.unsubscribe?.(); this.unsubscribe = undefined;
        if (enabled && this.platform) this.unsubscribe = installCrossServerRelay(this.platform, {...this.options, enabled: true});
        this.enabled = enabled;
    }
    configure(options: RelayOptions): void {
        this.unsubscribe?.(); this.unsubscribe = undefined;
        this.options = structuredClone(options);
        if (this.platform && this.enabled) this.unsubscribe = installCrossServerRelay(this.platform, {...this.options, enabled: true});
    }
}

/** Optional business plugin. Native registration and OneBot work without it. */
export function installCrossServerRelay(platform: Platform, options: RelayOptions): () => void {
    if (!options.enabled) return () => {};
    const nodes = new Set(options.nodes ?? []);
    const blacklist = new Set(options.blacklist ?? []);
    const allowed = (nodeId: string): boolean => !blacklist.has(nodeId) &&
        (nodes.size === 0 || nodes.has(nodeId));
    return platform.subscribe(event => {
        const message = event.type === "message" ? event.message
            : event.type === "application" && event.application === "onebot_api" ? event.message : undefined;
        if (!message) return;
        if (message.origin !== "player" && message.origin !== "application" &&
            !(message.origin === "system" && options.include_system !== false)) return;
        const source = platform.group(message.groupId);
        if (!allowed(source.nodeId)) return;
        for (const target of platform.groups()) {
            if (target.id === source.id || !allowed(target.nodeId)) continue;
            // Different bots in the same external group are not different destinations.
            if (source.kind === "onebot" && target.kind === "onebot" &&
                source.externalGroupId === target.externalGroupId) continue;
            void platform.send(target.id, message.segments, message, {pluginName: "CrossServerRelay",
                ...(message.origin === "system" ? {authorName: options.hide_system_name !== false ? "" :
                    options.system_name ?? "server"} : {})})
                .catch(error => console.error(`Relay to ${target.nodeId} failed`, error));
        }
    });
}
