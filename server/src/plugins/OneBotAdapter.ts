import {randomUUID} from "node:crypto";
import {Platform} from "../core/Platform";
import {PlatformPlugin} from "./PluginHost";
import {OneBotClient} from "./onebot/Client";
import {clientFile, clientInput, ClientSettings, ClientSnapshot} from "./onebot/settings";
import {PluginError as AdapterError} from "./PluginError";
import {JsonConfigStore} from "./JsonConfigStore";

export {PluginError as AdapterError} from "./PluginError";

/** Trusted adapter plugin. Its settings are separate from native registrations. */
export class OneBotAdapter implements PlatformPlugin {
    readonly name = "onebot";
    private platform?: Platform;
    private readonly clients = new Map<string, OneBotClient>();
    private settings: ClientSettings[];
    private enabled = true;
    private readonly store: JsonConfigStore<{version: 1; clients: ClientSettings[]}>;

    constructor(file: string | undefined, private readonly timeoutMs: number,
        private readonly retryMs = 5000) {
        this.store = new JsonConfigStore(file, clientFile, {version: 1, clients: []}, "OneBot 客户端配置");
        this.settings = this.store.read().clients;
        if (new Set(this.settings.map(client => client.id)).size !== this.settings.length ||
            new Set(this.settings.map(client => `${new URL(client.address).href}|${client.group_id}`)).size !== this.settings.length) {
            throw new Error("Duplicate OneBot adapter settings");
        }
    }

    install(platform: Platform): () => void {
        if (this.platform) throw new Error("OneBot adapter already installed");
        this.platform = platform;
        for (const settings of this.settings) this.connect(settings);
        return () => {
            for (const client of this.clients.values()) client.stop();
            this.clients.clear(); this.platform = undefined;
        };
    }

    list(): ClientSnapshot[] { return [...this.clients.values()].map(client => client.snapshot()); }

    setEnabled(enabled: boolean): void {
        if (this.enabled === enabled) return;
        this.enabled = enabled;
        for (const client of this.clients.values()) {
            if (enabled) client.start(); else client.stop();
        }
    }

    add(input: unknown): ClientSnapshot {
        if (!this.platform) throw new AdapterError("适配器尚未启动。", 503);
        const parsed = clientInput.parse(input);
        parsed.address = new URL(parsed.address).href;
        if (this.settings.length >= 50) throw new AdapterError("最多添加 50 个 OneBot 客户端。", 409);
        if (this.settings.some(client => new URL(client.address).href === parsed.address && client.group_id === parsed.group_id)) {
            throw new AdapterError("该地址和群号已经配置。", 409);
        }
        const settings = {...parsed, id: randomUUID()};
        this.persist([...this.settings, settings]);
        this.settings.push(settings);
        this.connect(settings);
        return this.clients.get(settings.id)!.snapshot();
    }

    remove(id: string): boolean {
        if (!this.settings.some(client => client.id === id)) return false;
        const next = this.settings.filter(client => client.id !== id);
        this.persist(next);
        this.clients.get(id)?.stop(); this.clients.delete(id);
        this.settings = next;
        return true;
    }

    private connect(settings: ClientSettings): void {
        const client = new OneBotClient(settings, this.platform!, this.timeoutMs,
            id => [...this.clients.values()].some(item => item.snapshot().botId === id), this.retryMs);
        this.clients.set(settings.id, client);
        if (this.enabled) client.start();
    }

    private persist(clients: ClientSettings[]): void {
        this.store.write({version: 1, clients});
    }
}
