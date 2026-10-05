import {z} from "zod";

export const clientInput = z.object({
    name: z.string().trim().min(1).max(80).optional(),
    address: z.string().trim().max(2048).url().refine(value => {
        const url = new URL(value);
        return ["ws:", "wss:"].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash;
    }, "Use a ws/wss URL without embedded credentials, query or fragment"),
    group_id: z.preprocess(value => typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value,
        z.number().int().positive().safe()),
    access_token: z.string().max(1000).refine(value => /^[\x20-\x7e]*$/.test(value), "Invalid access token").default(""),
}).strict();

export const savedClient = clientInput.extend({id: z.string().uuid()});
export const clientFile = z.object({version: z.literal(1), clients: z.array(savedClient).max(50)}).strict();
export type ClientSettings = z.infer<typeof savedClient>;
export interface ClientSnapshot {
    id: string;
    name: string;
    address: string;
    groupId: number;
    botId?: number;
    platformGroupId?: number;
    status: "connecting" | "verifying" | "connected" | "retrying" | "stopped";
    error: string;
}
