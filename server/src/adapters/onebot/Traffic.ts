import {snapshot} from "../../core/Snapshot";

export interface TrafficContext {
    connectionId: string;
    peer: "gateway";
    peerName: string;
    groupId?: number;
    action?: string;
    traceId?: string;
}

export interface OneBotTrafficEntry extends TrafficContext {
    id: string;
    time: number;
    timestampMs: number;
    direction: "sent" | "received";
    kind: "request" | "response" | "event" | "invalid";
    payload: unknown;
    truncated: boolean;
}

const object = (value: unknown): value is Record<string, unknown> =>
    !!value && typeof value === "object" && !Array.isArray(value);

/** ChatHub's public OneBot interface only, not upstream QQ client API traffic.
 * Dashboard-only wire snapshots; never publish these as platform chat events. */
export class OneBotTraffic {
    private readonly entries: OneBotTrafficEntry[] = [];
    private nextId = 1;

    record(direction: OneBotTrafficEntry["direction"], input: unknown, context: TrafficContext): OneBotTrafficEntry {
        let value = input;
        if (typeof input === "string") {
            try { value = JSON.parse(input); }
            catch { value = {invalid: "非 JSON 报文（不保留原文）"}; }
        }
        const kind = !object(value) ? "invalid" : typeof value.action === "string" ? "request"
            : typeof value.post_type === "string" ? "event" : Object.hasOwn(value, "retcode") ? "response" : "invalid";
        const {payload, truncated} = snapshot(value);
        const params = object(value) && object(value.params) ? value.params : undefined;
        const candidate = object(value) ? value.group_id ?? params?.group_id : undefined;
        const numericGroupId = typeof candidate === "number" || typeof candidate === "string" ? Number(candidate) : NaN;
        const groupId = context.groupId ?? (Number.isSafeInteger(numericGroupId) && numericGroupId > 0
            ? numericGroupId : undefined);
        const timestampMs = Date.now();
        const entry: OneBotTrafficEntry = {...context, groupId,
            action: (context.action ?? (object(value) && typeof value.action === "string" ? value.action : "")).slice(0, 4000) || undefined,
            id: `onebot-${this.nextId++}`, time: Math.floor(timestampMs / 1000), timestampMs,
            direction, kind, payload, truncated};
        this.entries.push(entry);
        if (this.entries.length > 200) this.entries.shift();
        return structuredClone(entry);
    }

    link(id: string, traceId: string): void {
        const entry = this.entries.find(entry => entry.id === id);
        if (entry) entry.traceId = traceId;
    }

    recent(): OneBotTrafficEntry[] { return structuredClone(this.entries.slice().reverse()); }
}
