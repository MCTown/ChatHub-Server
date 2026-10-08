import {z} from "zod";
import {Platform} from "../core/Platform";
import {PluginHost} from "./PluginHost";
import {PluginRegistry} from "./PluginRegistry";
import {JsonConfigStore} from "./JsonConfigStore";
import {PluginError} from "./PluginError";
import type {PluginId, PluginInstances} from "./builtins";

export type {PluginId} from "./builtins";
interface SavedConfiguration { schemaVersion: 1; values: Record<string, unknown>; }
interface PluginStateFile {
    version: 1;
    enabled: Record<string, boolean | undefined>;
    config?: Record<string, SavedConfiguration | undefined>;
}

/** Controls only explicitly built-in plugins, never arbitrary code or configuration. */
export class PluginControls {
    private readonly host: PluginHost;
    private overrides: Record<string, boolean | undefined>;
    private readonly store: JsonConfigStore<PluginStateFile>;
    private started = false;

    constructor(private readonly platform: Platform, private readonly registry: PluginRegistry, file?: string) {
        this.host = new PluginHost(platform);
        registry.seal();
        const enabled = z.object(Object.fromEntries(registry.all().map(entry =>
            [entry.manifest.id, z.boolean().optional()]))).strict();
        const config = z.object(Object.fromEntries(registry.all().map(entry => [entry.manifest.id,
            entry.editor ? z.object({schemaVersion: z.literal(entry.manifest.schemaVersion), values: entry.editor.schema}).strict().optional()
                : z.never().optional()]))).strict().optional();
        const schema = z.object({version: z.literal(1), enabled, config}).strict();
        this.store = new JsonConfigStore(file, schema, {version: 1, enabled: {}}, "插件开关与配置");
        this.overrides = this.store.read().enabled;
        const saved = this.store.read().config ?? {};
        try {
            for (const entry of registry.all()) {
                if (saved[entry.manifest.id]) entry.editor!.apply(entry.editor!.validate(saved[entry.manifest.id]!.values));
            }
        } catch { throw new PluginError("插件配置读取失败：保存的字段不符合当前 Schema，拒绝重置文件。"); }
    }

    has(id: string): boolean { return this.registry.has(id); }

    instance<K extends PluginId>(id: K): PluginInstances[K] {
        return this.registry.get(id).instance as PluginInstances[K];
    }

    states(): Record<string, boolean> {
        return Object.fromEntries(this.registry.all().map(entry =>
            [entry.manifest.id, this.overrides[entry.manifest.id] ?? entry.defaultEnabled]));
    }

    snapshot() {
        const saved = this.store.read().config ?? {};
        return this.registry.snapshot(this.states()).map(entry => ({...entry,
            enabledSource: this.overrides[entry.id] === undefined ? "default" : "persisted",
            configuration: {...entry.configuration, source: saved[entry.id] ? "persisted" : "default"}}));
    }

    configuration(id: string) {
        const entry = this.snapshot().find(plugin => plugin.id === id);
        if (!entry) throw new PluginError("插件不存在。", 404);
        return entry;
    }

    setConfiguration(id: string, schemaVersion: number, revision: string, values: unknown): void {
        if (!this.started) throw new PluginError("插件尚未启动。", 503);
        if (!this.registry.has(id)) throw new PluginError("插件不存在。", 404);
        const entry = this.registry.get(id);
        if (!entry.editor) throw new PluginError("此插件未声明可编辑配置，请使用其专用管理表单。", 405);
        if (schemaVersion !== entry.manifest.schemaVersion || revision !== entry.editor.revision()) {
            throw new PluginError("配置已更新，请加载最新配置后重新编辑。", 409);
        }
        const next = entry.editor.validate(values);
        const previousValues = entry.editor.values();
        const previousFile = this.store.read();
        this.store.write({...previousFile, config: {...previousFile.config,
            [id]: {schemaVersion: entry.manifest.schemaVersion, values: next}}});
        try {
            if (JSON.stringify(next) !== JSON.stringify(previousValues)) entry.editor.apply(next);
        } catch {
            let rollbackFailed = false;
            try { this.store.write(previousFile); } catch { rollbackFailed = true; }
            try { entry.editor.apply(previousValues); } catch { rollbackFailed = true; }
            if (rollbackFailed) console.error(`Plugin ${id} configuration rollback failed`);
            throw new PluginError("应用配置失败，已尝试恢复原配置，请检查服务端日志。", 500);
        }
    }

    start(): void {
        if (this.started) throw new Error("Plugin controls already started");
        try {
            const states = this.states();
            for (const entry of this.registry.all()) {
                entry.instance.setEnabled(states[entry.manifest.id]);
                this.platform.commands.setEnabled(entry.manifest.id, states[entry.manifest.id]);
                this.host.use(entry.instance);
            }
            this.started = true;
        } catch (error) { this.host.close(); throw error; }
    }

    setEnabled(id: string, enabled: boolean): void {
        if (!this.started) throw new PluginError("插件尚未启动。", 503);
        // Also enforce the boundary for callers outside the HTTP adapter.
        if (!this.registry.has(id) || typeof enabled !== "boolean") {
            throw new PluginError("无效的插件开关。", 400);
        }
        const previousEnabled = this.states()[id];
        const next = {...this.overrides, [id]: enabled};
        const previousFile = this.store.read();
        this.store.write({...previousFile, enabled: next}); // Disk failure never changes runtime.
        try {
            if (previousEnabled !== enabled) this.registry.get(id).instance.setEnabled(enabled);
        } catch {
            let rollbackFailed = false;
            try { this.store.write(previousFile); } catch { rollbackFailed = true; }
            try { this.registry.get(id).instance.setEnabled(previousEnabled); } catch { rollbackFailed = true; }
            if (rollbackFailed) console.error(`Plugin ${id} state rollback failed`);
            throw new PluginError("插件切换失败，请检查服务端日志。", 500);
        }
        this.overrides = next;
        this.platform.commands.setEnabled(id, enabled);
    }

    close(): void { this.host.close(); this.started = false; }
}
