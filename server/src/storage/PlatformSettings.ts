import {createHash} from "node:crypto";
import {z} from "zod";
import {JsonConfigStore} from "../plugins/JsonConfigStore";
import {PluginError} from "../plugins/PluginError";

/** Explicit deployment origin; never infer it from Host / forwarded headers. */
export const publicUrlSchema = z.string().trim().max(2048).refine(value => {
    if (!value) return true;
    try {
        const url = new URL(value);
        return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password &&
            url.pathname === "/" && !url.search && !url.hash;
    } catch { return false; }
}, "请填写 HTTP(S) 公网地址，不含路径、账号密码、查询参数或片段。")
    .transform(value => value ? new URL(value).origin : "");

const settingsSchema = z.object({version: z.literal(1), public_url: publicUrlSchema}).strict();

export class PlatformSettings {
    private readonly store: JsonConfigStore<z.output<typeof settingsSchema>>;

    constructor(file?: string, publicUrl = "") {
        this.store = new JsonConfigStore(file, settingsSchema, {version: 1, public_url: publicUrl}, "平台设置");
    }

    snapshot() {
        const {public_url} = this.store.read();
        return {public_url, revision: createHash("sha256").update(public_url).digest("hex")};
    }

    save(publicUrl: string, revision: string): void {
        if (revision !== this.snapshot().revision) throw new PluginError("平台设置已更新，请重新加载后保存。", 409);
        this.store.write({version: 1, public_url: publicUrlSchema.parse(publicUrl)});
    }
}
