import path from "node:path";
import {z} from "zod";
import {PluginContext, PluginRegistry} from "./PluginRegistry";
import {onebotPlugin} from "./definitions/onebot";
import {relayPlugin} from "./definitions/relay";

/** The only built-in registration list. Keys must match each manifest's stable ID. */
export const builtinPlugins = {onebot: onebotPlugin, relay: relayPlugin};
export type PluginId = keyof typeof builtinPlugins;
export type PluginConfigurations = {[K in PluginId]: z.output<(typeof builtinPlugins)[K]["configSchema"]>};
export type PluginInstances = {[K in PluginId]: ReturnType<(typeof builtinPlugins)[K]["create"]>};
export const pluginIds = Object.keys(builtinPlugins) as PluginId[];
export const pluginInputSchema = z.object(Object.fromEntries(pluginIds.map(id =>
    [id, builtinPlugins[id].configSchema.optional()]))).strict() as z.ZodType<Partial<PluginConfigurations>>;

/** Compatibility is input-only. Canonical plugins.<id> takes precedence over old keys. */
export function normalizePluginConfigurations(input: unknown, legacy: {relay?: unknown; onebotClientsFile?: string} = {},
    directory?: string): PluginConfigurations {
    const supplied = pluginInputSchema.parse(input ?? {});
    const values: Record<string, unknown> = {...supplied};
    if (supplied.relay === undefined && legacy.relay !== undefined) values.relay = legacy.relay;
    const onebot: Partial<PluginConfigurations["onebot"]> = supplied.onebot ?? {};
    values.onebot = {...onebot, clients_file: onebot.clients_file ?? legacy.onebotClientsFile};
    const result: Record<string, unknown> = {};
    for (const id of pluginIds) {
        const definition = builtinPlugins[id];
        const config = definition.configSchema.parse(values[id] ?? {}) as Record<string, unknown>;
        if (directory) for (const file of definition.files) {
            config[file.key] = path.resolve(directory, String(config[file.key] ?? file.defaultPath));
        }
        result[id] = config;
    }
    return result as PluginConfigurations;
}

export function createBuiltinRegistry(configs: PluginConfigurations, context: PluginContext): PluginRegistry {
    const registry = new PluginRegistry();
    for (const id of pluginIds) {
        if (builtinPlugins[id].manifest.id !== id) throw new Error(`Built-in plugin key mismatch: ${id}`);
        registry.register(builtinPlugins[id], configs[id], context);
    }
    return registry;
}
