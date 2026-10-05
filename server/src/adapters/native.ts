import {randomUUID} from "node:crypto";
import WebSocket from "ws";
import {z} from "zod";
import {Platform} from "../core/Platform";
import {Delivery, DeliveryObservation, NodeTransport} from "../domain/model";

const player = z.object({
    uuid: z.string().regex(/^(?:[0-9a-fA-F]{32}|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/),
    // Native nodes also include Terraria characters (Unicode and spaces).
    name: z.string().min(1).max(80).refine(name => name.trim().length > 0 && !/[\u0000-\u001f\u007f]/.test(name)),
});
const segments = z.array(z.discriminatedUnion("type", [
    z.object({type: z.literal("text"), text: z.string().max(16000)}),
    z.object({type: z.literal("image"), url: z.string().url().refine(url => /^https?:\/\//.test(url))}),
    z.object({type: z.literal("mention"), userId: z.union([z.number().int().positive().safe(), z.literal("all")])}),
])).min(1).max(100);
const request = z.discriminatedUnion("type", [
    z.object({type: z.literal("hello"), version: z.literal(2),
        node_id: z.string().regex(/^[A-Za-z0-9_.-]{1,64}$/),
        name: z.string().min(1).max(80), identity_scope: z.string().min(1).max(100)}).strict(),
    z.object({type: z.literal("chat"), event_id: z.string().min(1).max(100), player, segments}),
    z.object({type: z.literal("api_result"), request_id: z.string().min(1).max(100), ok: z.boolean(),
        players: z.array(player).max(1000).optional(), error: z.string().max(500).optional()}),
    z.object({type: z.literal("system"), event_id: z.string().min(1).max(100),
        kind: z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/),
        text: z.string().max(16000)}),
    z.object({type: z.literal("delivery_result"), request_id: z.string(), ok: z.boolean(),
        error: z.string().max(500).optional()}),
]);

interface Pending {
    resolve: () => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
    observation?: DeliveryObservation;
}

export function attachNative(socket: WebSocket, platform: Platform, timeoutMs: number, onlinePollMs = 5000): void {
    let groupId: number | undefined;
    let onlineCall: {id: string; timer: NodeJS.Timeout} | undefined;
    let onlinePoll: NodeJS.Timeout | undefined;
    const pending = new Map<string, Pending>();
    const seen = new Set<string>();
    const send = (data: unknown): void => {
        if (socket.readyState !== WebSocket.OPEN) throw new Error("Node disconnected");
        if (socket.bufferedAmount > 1024 * 1024) {
            socket.terminate(); throw new Error("Node outbound buffer exceeded");
        }
        socket.send(JSON.stringify(data));
    };
    const transport: NodeTransport = {
        deliver: (delivery: Delivery, observation?: DeliveryObservation) => new Promise<void>((resolve, reject) => {
            if (pending.size >= 100) { reject(new Error("Node has too many pending deliveries")); return; }
            const requestId = randomUUID();
            const timer = setTimeout(() => {
                pending.delete(requestId);
                reject(new Error("MCDR delivery acknowledgement timed out"));
            }, timeoutMs);
            pending.set(requestId, {resolve, reject, timer, observation});
            try {
                const payload = {type: "deliver", request_id: requestId, ...delivery};
                send(payload);
                observation?.record("sent", payload);
            }
            catch (error) {
                clearTimeout(timer); pending.delete(requestId); reject(error);
            }
        }),
    };
    const helloTimer = setTimeout(() => socket.close(1008, "hello required"), 10000);
    const queryOnlinePlayers = (): void => {
        if (socket.readyState !== WebSocket.OPEN || onlineCall) return;
        const id = randomUUID();
        onlineCall = {id, timer: setTimeout(() => {
            // Never leave a healthy-looking group with an indefinitely stale roster.
            socket.close(1011, "Online player query timed out");
            if (groupId !== undefined) platform.detach(groupId, transport);
        }, timeoutMs)};
        try { send({type: "api_call", request_id: id, action: "get_online_players"}); }
        catch { socket.terminate(); }
    };

    socket.on("message", raw => {
        try {
            const event = request.parse(JSON.parse(raw.toString()));
            if (event.type === "hello") {
                if (groupId !== undefined) throw new Error("Already registered");
                const group = platform.attach(event.node_id, event.name, event.identity_scope, [], transport);
                groupId = group.id;
                clearTimeout(helloTimer);
                send({type: "registered", version: 2, group_id: group.id,
                    system_user: {user_id: platform.systemId, name: platform.systemName}});
                queryOnlinePlayers();
                return;
            }
            if (groupId === undefined) throw new Error("hello required before events");
            switch (event.type) {
                case "chat": {
                    if (seen.has(event.event_id)) return;
                    const message = platform.ingest(groupId, event.player, event.segments, {eventId: event.event_id, payload: event});
                    seen.add(event.event_id);
                    if (seen.size > 2000) seen.delete(seen.values().next().value!);
                    send({type: "accepted", event_id: event.event_id, message_id: message.id,
                        user_id: message.authorId, uuid: event.player.uuid, name: message.authorName});
                    break;
                }
                case "api_result": {
                    if (event.request_id !== onlineCall?.id) break;
                    if (!event.ok) {
                        clearTimeout(onlineCall.timer); onlineCall = undefined;
                        platform.detach(groupId, transport);
                        socket.close(1011, "Online player query failed");
                        break;
                    }
                    if (!event.players) throw new Error("Successful online player query requires players");
                    const ids = event.players.map(player => player.uuid.replace(/-/g, "").toLowerCase());
                    if (new Set(ids).size !== ids.length) throw new Error("Duplicate player UUID in online list");
                    platform.syncOnlinePlayers(groupId, event.players);
                    clearTimeout(onlineCall.timer); onlineCall = undefined;
                    send({type: "users", users: [...platform.group(groupId).members.values()]
                        .map(member => ({uuid: member.uuid, user_id: member.userId, name: member.name}))});
                    onlinePoll = setTimeout(queryOnlinePlayers, onlinePollMs);
                    break;
                }
                case "system": {
                    if (seen.has(event.event_id)) return;
                    const message = platform.system(groupId, event.kind, event.text, {eventId: event.event_id, payload: event});
                    seen.add(event.event_id);
                    if (seen.size > 2000) seen.delete(seen.values().next().value!);
                    send({type: "accepted", event_id: event.event_id, message_id: message.id,
                        user_id: message.authorId, name: message.authorName});
                    break;
                }
                case "delivery_result": {
                    const call = pending.get(event.request_id);
                    if (!call) break;
                    clearTimeout(call.timer); pending.delete(event.request_id);
                    call.observation?.record("received", event);
                    if (event.ok) call.resolve();
                    else call.reject(new Error(event.error ?? "MCDR delivery failed"));
                    break;
                }
            }
        } catch (error) {
            console.warn("Native protocol rejected:", String(error));
            try { send({type: "error", code: "invalid_request", message: String(error).slice(0, 500)}); }
            catch { /* Already disconnected. */ }
            if (groupId === undefined) socket.close(1008, "Invalid registration");
        }
    });
    socket.on("close", () => {
        clearTimeout(helloTimer);
        if (onlineCall) clearTimeout(onlineCall.timer);
        if (onlinePoll) clearTimeout(onlinePoll);
        if (groupId !== undefined) platform.detach(groupId, transport);
        for (const call of pending.values()) {
            clearTimeout(call.timer); call.reject(new Error("Node disconnected"));
        }
        pending.clear();
    });
}
