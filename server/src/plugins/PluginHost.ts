import {Platform} from "../core/Platform";

export interface PlatformPlugin {
    name: string;
    /** Trusted business plugins or client adapters; cleanup owns all resources. */
    install(platform: Platform): () => void;
}

/** Trusted, explicitly imported modules; not a third-party code sandbox. */
export class PluginHost {
    private readonly installed = new Map<string, () => void>();

    constructor(private readonly platform: Platform) {}

    use(plugin: PlatformPlugin): void {
        if (this.installed.has(plugin.name)) throw new Error(`Plugin already installed: ${plugin.name}`);
        const dispose = plugin.install(this.platform);
        if (typeof dispose !== "function") throw new Error(`Plugin ${plugin.name} must return a cleanup function`);
        this.installed.set(plugin.name, dispose);
    }

    remove(name: string): boolean {
        const dispose = this.installed.get(name);
        if (!dispose) return false;
        dispose();
        this.installed.delete(name);
        return true;
    }

    close(): void {
        for (const [name, dispose] of [...this.installed.entries()].reverse()) {
            try { dispose(); }
            catch (error) { console.error(`Plugin ${name} disposal failed`, error); }
        }
        this.installed.clear();
    }
}
