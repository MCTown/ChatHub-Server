import fs from "node:fs";
import path from "node:path";
import {randomUUID} from "node:crypto";
import {z} from "zod";
import {PluginError} from "./PluginError";

/** Versioned, schema-validated private JSON. A missing file uses defaults;
 * a corrupt/unsupported file fails closed. Reads/writes are isolated copies. */
export class JsonConfigStore<T extends {version: number}> {
    private value: T;

    constructor(private readonly file: string | undefined, private readonly schema: z.ZodType<T, z.ZodTypeDef, unknown>,
        defaults: T, private readonly label: string) {
        try {
            this.value = this.validate(file && fs.existsSync(file)
                ? JSON.parse(fs.readFileSync(file, "utf8")) : structuredClone(defaults));
        } catch {
            // JSON.parse errors can quote private file contents; never propagate them.
            throw new PluginError(`${label}读取失败：请检查 JSON 格式、版本及配置字段，拒绝重置文件。`);
        }
    }

    read(): T { return structuredClone(this.value); }

    write(input: T): void {
        const next = this.validate(structuredClone(input));
        if (this.file) {
            const temporary = `${this.file}.${randomUUID()}.tmp`;
            try {
                fs.mkdirSync(path.dirname(this.file), {recursive: true});
                fs.writeFileSync(temporary, JSON.stringify(next, null, 2), {mode: 0o600, flag: "wx"});
                fs.renameSync(temporary, this.file);
            } catch {
                try { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); } catch { /* Keep the original failure. */ }
                throw new PluginError(`无法保存${this.label}，请检查服务端数据目录权限。`);
            }
        }
        this.value = next;
    }

    private validate(input: unknown): T {
        const parsed = this.schema.safeParse(input);
        if (!parsed.success || !Number.isSafeInteger(parsed.data.version) || parsed.data.version < 1) {
            throw new PluginError(`${this.label}配置无效：请检查版本及配置字段。`, 400);
        }
        return parsed.data;
    }
}
