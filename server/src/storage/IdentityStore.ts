import fs from "node:fs";
import path from "node:path";
import {z} from "zod";
import {IdentityDirectory} from "../core/ports";

const schema = z.object({
    version: z.literal(1),
    nextUserId: z.number().int().min(10000).max(Number.MAX_SAFE_INTEGER),
    nextGroupId: z.number().int().min(10000).max(Number.MAX_SAFE_INTEGER),
    users: z.record(z.number().int().min(10000).max(Number.MAX_SAFE_INTEGER)),
    groups: z.record(z.number().int().min(10000).max(Number.MAX_SAFE_INTEGER)),
});

/** Only stable identity mappings are persisted. Never stores node passwords,
 * connection addresses, registrations or routing subscriptions.
 */
export class IdentityStore implements IdentityDirectory {
    private data: z.infer<typeof schema>;

    constructor(private readonly file?: string) {
        this.data = file && fs.existsSync(file)
            ? schema.parse(JSON.parse(fs.readFileSync(file, "utf8")))
            : {version: 1, nextUserId: 10000, nextGroupId: 10000, users: {}, groups: {}};
        for (const [values, next] of [
            [Object.values(this.data.users), this.data.nextUserId],
            [Object.values(this.data.groups), this.data.nextGroupId],
        ] as const) {
            if (new Set(values).size !== values.length || values.some(id => id >= next)) {
                throw new Error("Invalid or duplicate stable identity mappings");
            }
        }
    }

    user(scope: string, uuid: string): number {
        return this.allocate("users", JSON.stringify([scope, uuid.toLowerCase().replace(/-/g, "")]));
    }

    group(nodeId: string): number {
        return this.allocate("groups", JSON.stringify([nodeId]));
    }

    private allocate(kind: "users" | "groups", key: string): number {
        const existing = this.data[kind][key];
        if (existing !== undefined) return existing;
        const counter = kind === "users" ? "nextUserId" : "nextGroupId";
        const id = this.data[counter];
        if (id >= Number.MAX_SAFE_INTEGER) throw new Error("Identity ID space exhausted");
        const next = {...this.data, [counter]: id + 1, [kind]: {...this.data[kind], [key]: id}};
        if (this.file) {
            fs.mkdirSync(path.dirname(this.file), {recursive: true});
            const temp = `${this.file}.tmp`;
            fs.writeFileSync(temp, JSON.stringify(next, null, 2), {mode: 0o600});
            fs.renameSync(temp, this.file);
        }
        this.data = next;
        return id;
    }
}
