import {z} from "zod";
import {PlatformPlugin} from "./PluginHost";
import {createHash} from "node:crypto";
import {buildConfigEditor, ConfigField, ConfigFieldPresentation} from "./ConfigEditor";

export interface ManagedPlugin extends PlatformPlugin {
    /** Synchronous and idempotent; disabled plugins retain management access. */
    setEnabled(enabled: boolean): void;
}

const manifestSchema = z.object({
    id: z.string().regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/),
    name: z.string().min(1).max(80),
    module: z.string().min(1).max(80),
    version: z.string().max(80)
        .regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/)
        .refine(value => !value.split("+")[0].split("-").slice(1).join("-").split(".")
            .some(part => /^\d+$/.test(part) && part.length > 1 && part.startsWith("0")), "Invalid semantic version"),
    kind: z.enum(["adapter", "business"]),
    icon: z.string().regex(/^[a-z]+$/),
    description: z.string().min(1).max(300),
    settingsPanel: z.string().regex(/^[a-z][a-z0-9-]*$/),
    settingsMode: z.enum(["managed", "readonly"]),
    help: z.string().min(1).max(500),
    schemaVersion: z.literal(1),
}).strict();
export type PluginManifest = z.infer<typeof manifestSchema>;
export interface PluginContext { deliveryTimeoutMs: number; }
export interface PluginFile { key: string; defaultPath: string; }
export interface RegisteredPlugin {
    manifest: PluginManifest;
    instance: ManagedPlugin;
    defaultEnabled: boolean;
    /** Explicit public projection, never the full configuration or file paths. */
    publicConfig(): Record<string, unknown>;
    editor?: {
        fields: ConfigField[];
        schema: z.AnyZodObject;
        values(): Record<string, unknown>;
        revision(): string;
        validate(input: unknown): Record<string, unknown>;
        apply(values: Record<string, unknown>): void;
    };
}
export interface PluginDefinition {
    manifest: PluginManifest;
    configSchema: z.ZodType<unknown>;
    files: readonly PluginFile[];
    bind(input: unknown, context: PluginContext): RegisteredPlugin;
}

/** Every definition owns its schema, defaults, instance factory and redaction. */
export function definePlugin<S extends z.ZodType<{enabled: boolean}, z.ZodTypeDef, unknown>, P extends ManagedPlugin>(definition: {
    manifest: PluginManifest;
    configSchema: S;
    files?: readonly PluginFile[];
    create(config: z.output<S>, context: PluginContext): P;
    publicConfig(config: z.output<S>): Record<string, unknown>;
    editor?: {
        fields: readonly ConfigFieldPresentation[];
        /** Must apply without altering the separately managed enable state. */
        apply(instance: P, config: z.output<S>): void;
    };
}) {
    return {...definition, files: definition.files ?? [],
        bind(input: unknown, context: PluginContext): RegisteredPlugin {
            let config = definition.configSchema.parse(input) as z.output<S>;
            const editor = definition.editor ? buildConfigEditor(definition.configSchema, definition.editor.fields,
                (definition.files ?? []).map(file => file.key)) : undefined;
            const fieldValue = (value: z.output<S>, key: string): unknown => (value as Record<string, unknown>)[key];
            if (editor) {
                const publicValues = definition.publicConfig(structuredClone(config));
                for (const field of editor.fields) {
                    if (!Object.hasOwn(publicValues, field.key) || JSON.stringify(publicValues[field.key]) !== JSON.stringify(fieldValue(config, field.key))) {
                        throw new Error(`Editable field must be fully public: ${field.key}`);
                    }
                }
            }
            const instance = definition.create(structuredClone(config), context);
            const values = (): Record<string, unknown> => Object.fromEntries((editor?.fields ?? []).map(field =>
                [field.key, structuredClone(fieldValue(config, field.key))]));
            const validate = (input: unknown): Record<string, unknown> => {
                const patch = editor!.schema.partial().parse(input);
                const next = definition.configSchema.parse({...config, ...patch}) as z.output<S>;
                return Object.fromEntries(editor!.fields.map(field => [field.key, structuredClone(fieldValue(next, field.key))]));
            };
            return {manifest: manifestSchema.parse(definition.manifest), instance, defaultEnabled: config.enabled,
                publicConfig: () => structuredClone(definition.publicConfig(structuredClone(config))),
                ...(editor ? {editor: {...editor, values, validate,
                    revision: () => createHash("sha256").update(JSON.stringify({version: definition.manifest.schemaVersion, values: values()})).digest("hex"),
                    apply(next: Record<string, unknown>): void {
                        const parsed = definition.configSchema.parse({...config, ...next}) as z.output<S>;
                        definition.editor!.apply(instance, structuredClone(parsed));
                        config = parsed;
                    }}} : {})};
        }};
}

/** Explicit trusted registrations only. No directory scan, path import or sandbox. */
export class PluginRegistry {
    private readonly entries = new Map<string, RegisteredPlugin>();
    private sealed = false;

    register(definition: PluginDefinition, input: unknown, context: PluginContext): void {
        if (this.sealed) throw new Error("Plugin registry is sealed");
        const manifest = manifestSchema.parse(definition.manifest);
        if (this.entries.has(manifest.id)) throw new Error(`Plugin already registered: ${manifest.id}`);
        const entry = definition.bind(input, context);
        if (entry.manifest.id !== manifest.id || entry.instance.name !== manifest.id) throw new Error(`Plugin ID mismatch: ${manifest.id}`);
        if (typeof entry.instance.install !== "function" || typeof entry.instance.setEnabled !== "function") {
            throw new Error(`Invalid managed plugin lifecycle: ${manifest.id}`);
        }
        if (typeof entry.defaultEnabled !== "boolean" || typeof entry.publicConfig !== "function") {
            throw new Error(`Invalid plugin configuration contract: ${manifest.id}`);
        }
        this.entries.set(manifest.id, Object.freeze({...entry, manifest: Object.freeze(manifest)}));
    }

    seal(): void { this.sealed = true; }

    has(id: string): boolean { return this.entries.has(id); }
    all(): RegisteredPlugin[] { return [...this.entries.values()]; }
    get(id: string): RegisteredPlugin {
        const entry = this.entries.get(id);
        if (!entry) throw new Error(`Plugin not registered: ${id}`);
        return entry;
    }

    snapshot(states: Record<string, boolean>) {
        return this.all().map(entry => ({...entry.manifest, enabled: states[entry.manifest.id],
            configuration: {section: `plugins.${entry.manifest.id}`, values: entry.publicConfig(),
                editable: !!entry.editor, fields: structuredClone(entry.editor?.fields ?? []),
                revision: entry.editor?.revision() ?? null, applyMode: entry.editor ? "live" : "readonly"}}));
    }
}
