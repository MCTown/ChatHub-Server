import {randomUUID} from "node:crypto";
import {snapshot} from "./Snapshot";

export type TraceStatus = "received" | "processing" | "accepted" | "confirmed" | "sent" | "failed" | "timeout" | "skipped";
export interface TraceNode {
    label: string;
    kind: "source" | "core" | "delivery" | "onebot" | "plugin";
    groupId?: number;
    nodeId?: string;
    /** Display-only sender of the source step; never used for routing or identity. */
    authorName?: string;
    /** Display-only human-readable source group of the source step. */
    groupName?: string;
    messageId?: number;
    eventId?: string;
    connectionId?: string;
    action?: string;
    direction?: "sent" | "received";
    pluginName?: string;
}
export interface TraceStep extends TraceNode {
    id: string;
    parentId?: string;
    status: TraceStatus;
    timestampMs: number;
    finishedAtMs?: number;
    durationMs?: number;
    error?: string;
    payload?: unknown;
    truncated?: boolean;
}
export interface MessageTrace {
    id: string;
    timestampMs: number;
    origin: "player" | "system" | "application" | "plugin" | "onebot_received" | "onebot_sent";
    preview: string;
    steps: TraceStep[];
    truncated: boolean;
}
interface StoredTrace { trace: MessageTrace; bytes: number; nextStep: number; }

/** Passive, session-local observation. IDs never go onto client/OneBot protocols.
 * Evicted traces cannot be resurrected by late async completions. */
export class TraceStore {
    private readonly traces = new Map<string, StoredTrace>();

    start(origin: MessageTrace["origin"], preview: string, source: TraceNode, payload?: unknown): string {
        const id = randomUUID(), timestampMs = Date.now();
        this.traces.set(id, {trace: {id, timestampMs, origin, preview: preview.slice(0, 800), steps: [], truncated: false},
            bytes: 0, nextStep: 1});
        if (this.traces.size > 1000) this.traces.delete(this.traces.keys().next().value!);
        this.add(id, undefined, source, origin === "onebot_sent" ? "accepted" : "received", payload);
        return id;
    }

    add(traceId: string, parentId: string | undefined, node: TraceNode, status: TraceStatus, payload?: unknown): string | undefined {
        const stored = this.traces.get(traceId);
        if (!stored) return undefined;
        if (stored.trace.steps.length >= 100) { stored.trace.truncated = true; return undefined; }
        const step: TraceStep = {...node, label: node.label.slice(0, 200), nodeId: node.nodeId?.slice(0, 100),
            authorName: node.authorName?.slice(0, 100), groupName: node.groupName?.slice(0, 100),
            eventId: node.eventId?.slice(0, 100), pluginName: node.pluginName?.slice(0, 100), action: node.action?.slice(0, 100),
            id: String(stored.nextStep++), parentId, status, timestampMs: Date.now()};
        this.capture(stored, step, payload);
        stored.trace.steps.push(step);
        return step.id;
    }

    finish(traceId: string, stepId: string | undefined, status: TraceStatus, error?: string): void {
        const step = this.traces.get(traceId)?.trace.steps.find(step => step.id === stepId);
        if (!step || step.status !== "processing") return;
        step.status = status;
        step.finishedAtMs = Date.now();
        step.durationMs = Math.max(0, step.finishedAtMs - step.timestampMs);
        if (error) step.error = error.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 500);
    }

    identifyMessage(traceId: string, stepId: string | undefined, messageId: number): void {
        const step = this.traces.get(traceId)?.trace.steps.find(step => step.id === stepId);
        if (step) step.messageId = messageId;
    }

    get(id: string): MessageTrace | undefined {
        const trace = this.traces.get(id)?.trace;
        return trace ? structuredClone(trace) : undefined;
    }

    recent(limit = 150): MessageTrace[] {
        const count = Number.isFinite(limit) ? Math.max(0, Math.min(1000, Math.floor(limit))) : 0;
        if (!count) return [];
        return [...this.traces.values()].slice(-count).reverse().map(({trace}) => ({...trace,
            steps: trace.steps.map(({payload, ...step}) => ({...step}))}));
    }

    private capture(stored: StoredTrace, step: TraceStep, payload: unknown): void {
        if (payload === undefined) return;
        const remaining = 24000 - stored.bytes;
        if (remaining < 1000) { step.truncated = true; stored.trace.truncated = true; return; }
        const result = snapshot(payload, Math.min(4000, Math.floor(remaining / 6)));
        const size = JSON.stringify(result.payload)?.length ?? 0;
        if (size > remaining) { step.truncated = true; stored.trace.truncated = true; return; }
        step.payload = result.payload;
        step.truncated = result.truncated;
        stored.bytes += size;
        stored.trace.truncated ||= result.truncated;
    }
}
