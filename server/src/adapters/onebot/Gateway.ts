import WebSocket from "ws";
import {randomUUID} from "node:crypto";
import {Platform, PlatformError} from "../../core/Platform";
import {ChatMessage} from "../../domain/model";
import {cqString, numericId, toV11} from "./codec";
import {OneBotTraffic, TrafficContext} from "./Traffic";
import {ImageStore} from "../../storage/ImageStore";
import {OneBotApi} from "./Api";

export type Role = "API" | "Event" | "Universal";
export interface ApplicationConnection {
    id: string;
    direction: "forward" | "reverse";
    role: Role;
    address: string;
}
export function connectionRole(value: string | undefined): Role {
    if (!value || value === "Universal") return "Universal";
    if (value === "API" || value === "Event") return value;
    throw new Error("Invalid OneBot X-Client-Role");
}

/** This is a OneBot IMPLEMENTATION. Applications call actions, we publish
 * events. WS direction (forward/reverse) does not change that role.
 */
export class OneBotGateway {
    private readonly applications = new Map<WebSocket, ApplicationConnection>();
    private readonly api: OneBotApi;
    constructor(private readonly platform: Platform, private readonly traffic = new OneBotTraffic(),
        images?: ImageStore, api?: OneBotApi) {
        this.api = api ?? new OneBotApi(platform, images);
    }

    onebotApi(): OneBotApi { return this.api; }

    connections(): ApplicationConnection[] {
        return [...this.applications].filter(([socket]) => socket.readyState === WebSocket.OPEN)
            .map(([, connection]) => ({...connection}));
    }

    attach(socket: WebSocket, role: Role, endpoint: Pick<ApplicationConnection, "direction" | "address"> =
        {direction: "forward", address: ""}): void {
        const context = {connectionId: randomUUID(), peer: "gateway" as const, peerName: `ChatHub OneBot · ${role}`};
        let address = endpoint.address;
        if (endpoint.direction === "reverse") {
            // Endpoint metadata is public dashboard data, never a config/credential dump.
            const url = new URL(address);
            address = `${url.protocol}//${url.host}${url.pathname}`;
        }
        this.applications.set(socket, {id: context.connectionId, direction: endpoint.direction, role, address});
        const send = (data: unknown, requestContext: Partial<TrafficContext> = {}): void => {
            const frame = data as Record<string, unknown>;
            const operation = frame.post_type === "message" ? "OneBot 事件上报" : frame.post_type === "meta_event"
                ? "OneBot 元事件" : "OneBot API 响应";
            const traceId = requestContext.traceId ?? this.platform.traces.start("onebot_sent", "OneBot 元事件",
                {kind: "source", label: "ChatHub OneBot", connectionId: context.connectionId}, data);
            const stepId = this.platform.traces.add(traceId, requestContext.traceId ? "2" : "1",
                {kind: "onebot", label: `${operation} → 应用 · ${role} · ${context.connectionId.slice(0, 8)}`,
                    direction: "sent", connectionId: context.connectionId, action: requestContext.action, groupId: requestContext.groupId},
                "processing", data);
            try {
                if (socket.readyState !== WebSocket.OPEN) throw new Error("OneBot application disconnected");
                if (socket.bufferedAmount > 1024 * 1024) {
                    socket.terminate(); throw new Error("OneBot outbound buffer exceeded");
                }
                socket.send(JSON.stringify(data), error => this.platform.traces.finish(traceId, stepId,
                    error ? "failed" : "sent", error?.message));
                this.traffic.record("sent", data, {...context, ...requestContext, traceId});
            } catch (error) {
                this.platform.traces.finish(traceId, stepId, "failed", error instanceof Error ? error.message : "OneBot send failed");
            }
        };
        const eventBase = (): Record<string, unknown> => ({time: Math.floor(Date.now() / 1000), self_id: this.platform.botId});
        const unsubscribe = role === "API" ? () => {} : this.platform.subscribe(event => {
            if (event.type === "message") send(this.messageEvent(event.message),
                {traceId: event.message.traceId, groupId: event.message.groupId});
            // Presence is not group membership. Do not forge group_increase/decrease.
        });
        let heartbeat: NodeJS.Timeout | undefined;
        if (role !== "API") {
            send({...eventBase(), post_type: "meta_event", meta_event_type: "lifecycle", sub_type: "connect"});
            heartbeat = setInterval(() => send({...eventBase(), post_type: "meta_event",
                meta_event_type: "heartbeat", status: {online: true, good: true}, interval: 30000}), 30000);
        }
        let inFlight = 0;
        socket.on("message", raw => {
            const received = this.traffic.record("received", raw.toString(), context);
            const value = received.payload as Record<string, unknown> | null;
            const params = value && typeof value.params === "object" && value.params !== null
                ? value.params as Record<string, unknown> : {};
            const preview = typeof params.message === "string" ? params.message : Array.isArray(params.message)
                ? params.message.map(segment => segment?.type === "text" && typeof segment.data?.text === "string"
                    ? segment.data.text : `[${typeof segment?.type === "string" ? segment.type : "消息"}]`).join("") : "";
            const traceId = this.platform.traces.start("onebot_received", `${received.action ?? "无效报文"}${preview ? " · " + preview : ""}`,
                {kind: "source", label: `OneBot 应用 · ${role} · ${context.connectionId.slice(0, 8)}`, connectionId: context.connectionId,
                    direction: "received", action: received.action, groupId: received.groupId}, received.payload);
            this.traffic.link(received.id, traceId);
            const coreStep = this.platform.traces.add(traceId, "1", {kind: "core", label: "ChatHub Core", action: received.action}, "processing");
            if (role === "Event") { this.platform.traces.finish(traceId, coreStep, "skipped", "Event 通道不处理 API 请求"); return; }
            if (inFlight >= 100) {
                this.platform.traces.finish(traceId, coreStep, "failed", "Too many pending API calls");
                socket.close(1008, "Too many pending API calls"); return;
            }
            inFlight++;
            void this.handle(raw.toString(), traceId).then(data => {
                this.platform.traces.finish(traceId, coreStep, data.status === "ok" ? "accepted" : "failed",
                    typeof data.message === "string" ? data.message : undefined);
                send(data, {traceId, action: received.action, groupId: received.groupId});
            })
                .catch(error => console.error("OneBot response failed", error))
                .finally(() => { inFlight--; });
        });
        socket.on("close", () => { this.applications.delete(socket); unsubscribe(); if (heartbeat) clearInterval(heartbeat); });
    }

    private async handle(raw: string, traceId: string): Promise<Record<string, unknown>> {
        let request: Record<string, unknown> = {};
        try {
            let value: unknown;
            try { value = JSON.parse(raw); }
            catch { throw new PlatformError("Invalid JSON", 1400); }
            if (!value || typeof value !== "object" || Array.isArray(value)) throw new PlatformError("Expected JSON object", 1400);
            request = value as Record<string, unknown>;
            if (typeof request.action !== "string") throw new PlatformError("action is required", 1400);
            const params = request.params ?? {};
            if (!params || typeof params !== "object" || Array.isArray(params)) throw new PlatformError("Invalid params", 1400);
            const data = await this.dispatch(request.action, params as Record<string, unknown>, traceId);
            return {status: "ok", retcode: 0, data, ...(Object.hasOwn(request, "echo") ? {echo: request.echo} : {})};
        } catch (error) {
            return {status: "failed", retcode: error instanceof PlatformError ? error.retcode : 100,
                data: null, message: error instanceof Error ? error.message : "Internal error",
                ...(Object.hasOwn(request, "echo") ? {echo: request.echo} : {})};
        }
    }

    private async dispatch(action: string, params: Record<string, unknown>, traceId: string): Promise<unknown> {
        switch (action) {
            case "get_login_info": return {user_id: this.platform.botId, nickname: "ChatHub"};
            case "get_friend_list": return [];
            case "get_status": return {online: true, good: true};
            case "get_version_info": return {app_name: "ChatHub", app_version: "2.0.0", protocol_version: "v11"};
            case "get_group_list": return this.api.getGroupList();
            case "get_group_info": return this.api.getGroupInfo(params.group_id);
            case "get_group_member_list": return this.api.getGroupMemberList(params.group_id);
            case "get_group_member_info": return this.api.getGroupMemberInfo(params.group_id, params.user_id);
            case "get_stranger_info": {
                const id = numericId(params.user_id);
                if (id === this.platform.botId) return {user_id: id, nickname: "ChatHub", sex: "unknown", age: 0};
                if (id === this.platform.systemId) {
                    return {user_id: id, nickname: this.platform.systemName, sex: "unknown", age: 0};
                }
                for (const group of this.platform.groups()) {
                    const member = group.members.get(id);
                    if (member) return {user_id: id, nickname: member.name, sex: "unknown", age: 0};
                }
                throw new PlatformError("Unknown user");
            }
            case "send_group_msg":
            case "send_msg": {
                if (action === "send_msg" && (params.message_type === "private" || params.group_id === undefined)) {
                    throw new PlatformError("Private messaging is not supported", 1404);
                }
                const groupId = numericId(params.group_id);
                const result = await this.api.sendGroupMessage(groupId, params.message, params.auto_escape === true, {traceId});
                return {message_id: result.message_id};
            }
            case "get_msg": {
                const message = this.platform.message(numericId(params.message_id));
                return {time: message.time, message_type: "group", message_id: message.id, real_id: message.id,
                    sender: {user_id: message.authorId, nickname: message.authorName}, message: toV11(message.segments)};
            }
            case "can_send_image": return {yes: true};
            case "can_send_record": return {yes: false};
            default: throw new PlatformError(`Unsupported API: ${action}`, 1404);
        }
    }

    private messageEvent(message: ChatMessage): Record<string, unknown> {
        return {time: message.time, self_id: this.platform.botId, post_type: "message", message_type: "group",
            sub_type: "normal", message_id: message.id, group_id: message.groupId, user_id: message.authorId,
            anonymous: null, message: toV11(message.segments), raw_message: cqString(message.segments), font: 0,
            sender: {user_id: message.authorId, nickname: message.authorName, card: "", sex: "unknown", age: 0,
                area: "", level: "", role: "member", title: ""}};
    }
}
