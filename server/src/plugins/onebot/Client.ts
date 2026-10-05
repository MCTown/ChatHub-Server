import {randomUUID} from "node:crypto";
import WebSocket from "ws";
import {Platform} from "../../core/Platform";
import {Delivery, NodeTransport, Segment} from "../../domain/model";
import {numericId, parseCq, V11Segment} from "../../adapters/onebot/codec";
import {ClientSettings, ClientSnapshot} from "./settings";

interface Pending {
    resolve: (data: unknown) => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
}
const object = (value: unknown): value is Record<string, unknown> =>
    !!value && typeof value === "object" && !Array.isArray(value);

/** OneBot APPLICATION role: connects to a real bot's Universal forward WS. */
export class OneBotClient {
    private socket?: WebSocket;
    private retry?: NodeJS.Timeout;
    private heartbeat?: NodeJS.Timeout;
    private stopped = true;
    private readonly pending = new Map<string, Pending>();
    private readonly seen = new Set<string>();
    private readonly transport: NodeTransport = {deliver: delivery => this.deliver(delivery)};
    private readonly state: ClientSnapshot;

    constructor(readonly settings: ClientSettings, private readonly platform: Platform,
        private readonly timeoutMs: number, private readonly isBridgeBot: (id: number) => boolean,
        private readonly retryMs = 5000) {
        this.state = {id: settings.id, name: settings.name ?? `OneBot 群 ${settings.group_id}`,
            address: settings.address, groupId: settings.group_id, status: "stopped", error: ""};
    }

    snapshot(): ClientSnapshot { return {...this.state}; }
    start(): void { if (this.stopped) { this.stopped = false; this.connect(); } }
    stop(): void {
        this.stopped = true;
        if (this.retry) clearTimeout(this.retry);
        this.retry = undefined;
        this.disconnect();
        this.socket?.terminate();
        this.socket = undefined;
        this.state.status = "stopped";
        this.state.error = "";
    }

    private disconnect(): void {
        if (this.heartbeat) clearInterval(this.heartbeat);
        this.heartbeat = undefined;
        if (this.state.platformGroupId !== undefined) this.platform.detach(this.state.platformGroupId, this.transport);
        this.state.platformGroupId = undefined;
        for (const call of this.pending.values()) {
            clearTimeout(call.timer); call.reject(new Error("OneBot connection closed"));
        }
        this.pending.clear();
    }

    private connect(): void {
        if (this.stopped) return;
        this.state.status = "connecting";
        const socket = new WebSocket(this.settings.address, {maxPayload: 256 * 1024,
            handshakeTimeout: 10000, followRedirects: false, headers: this.settings.access_token
                ? {Authorization: `Bearer ${this.settings.access_token}`} : {}});
        this.socket = socket;
        socket.on("message", raw => { if (this.socket === socket && !this.stopped) this.receive(raw.toString()); });
        socket.on("error", () => {
            if (this.socket === socket && !this.stopped) this.state.error = "连接失败，请检查地址、网络及 Access Token。";
        });
        socket.on("close", () => {
            if (this.socket !== socket) return;
            this.disconnect();
            this.socket = undefined;
            if (!this.stopped) {
                this.state.status = "retrying";
                if (!this.state.error) this.state.error = "连接中断，正在等待重连。";
                this.retry = setTimeout(() => { this.retry = undefined; this.connect(); }, this.retryMs);
            }
        });
        socket.on("open", () => {
            if (this.socket !== socket || this.stopped) { socket.terminate(); return; }
            this.state.status = "verifying";
            let awaitingPong = false;
            socket.on("pong", () => { awaitingPong = false; });
            this.heartbeat = setInterval(() => {
                if (socket.readyState !== WebSocket.OPEN) return;
                if (awaitingPong) { socket.terminate(); return; }
                awaitingPong = true; socket.ping();
            }, 30000);
            void this.verify(socket).catch(() => {
                if (this.socket !== socket || this.stopped) return;
                this.state.error = "账号 / 群验证失败，请检查 Universal WS、群号、群权限或重复客户端。";
                socket.terminate();
            });
        });
    }

    private async verify(socket: WebSocket): Promise<void> {
        const login = await this.call("get_login_info", {});
        if (!object(login)) throw new Error("Invalid login info");
        const botId = numericId(login.user_id);
        if (botId === this.platform.botId) throw new Error("Cannot adapt the ChatHub gateway itself");
        this.state.botId = botId;
        const groupInfo = await this.call("get_group_info", {group_id: this.settings.group_id, no_cache: true});
        if (!object(groupInfo) || numericId(groupInfo.group_id) !== this.settings.group_id) throw new Error("Unknown group");
        const membership = await this.call("get_group_member_info", {
            group_id: this.settings.group_id, user_id: botId, no_cache: true,
        });
        if (!object(membership) || numericId(membership.group_id) !== this.settings.group_id ||
            numericId(membership.user_id) !== botId) throw new Error("Bot is not a group member");
        if (this.socket !== socket || this.stopped) return;
        if (!this.settings.name && typeof groupInfo.group_name === "string" && groupInfo.group_name.trim()) {
            this.state.name = groupInfo.group_name.slice(0, 80);
        }
        const group = this.platform.attach(`onebot:${botId}:${this.settings.group_id}`, this.state.name,
            "onebot:v11:qq", [], this.transport, {kind: "onebot", externalGroupId: this.settings.group_id, botId});
        this.state.platformGroupId = group.id;
        this.state.status = "connected";
        this.state.error = "";
    }

    private call(action: string, params: Record<string, unknown>): Promise<unknown> {
        return new Promise((resolve, reject) => {
            const socket = this.socket;
            if (!socket || socket.readyState !== WebSocket.OPEN) { reject(new Error("OneBot disconnected")); return; }
            if (this.pending.size >= 100 || socket.bufferedAmount > 1024 * 1024) {
                reject(new Error("OneBot pending request limit exceeded")); return;
            }
            const echo = randomUUID();
            const timer = setTimeout(() => { this.pending.delete(echo); reject(new Error("OneBot API timed out")); }, this.timeoutMs);
            this.pending.set(echo, {resolve, reject, timer});
            socket.send(JSON.stringify({action, params, echo}), error => {
                if (!error) return;
                const call = this.pending.get(echo);
                if (call) { clearTimeout(call.timer); this.pending.delete(echo); call.reject(new Error("OneBot send failed")); }
            });
        });
    }

    private receive(raw: string): void {
        try {
            const value: unknown = JSON.parse(raw);
            if (!object(value)) return;
            if (typeof value.echo === "string" && this.pending.has(value.echo) && !value.post_type) {
                const call = this.pending.get(value.echo)!;
                clearTimeout(call.timer); this.pending.delete(value.echo);
                // 'async' / retcode 1 means queued, not confirmed successful.
                if (value.status === "ok" && value.retcode === 0) call.resolve(value.data);
                else call.reject(new Error("OneBot API rejected request"));
                return;
            }
            const groupId = this.state.platformGroupId;
            if (groupId === undefined || value.post_type !== "message" || value.message_type !== "group" ||
                numericId(value.group_id) !== this.settings.group_id || numericId(value.self_id) !== this.state.botId) return;
            const userId = numericId(value.user_id);
            if (userId === this.state.botId || this.isBridgeBot(userId) || value.sub_type === "anonymous" || value.anonymous) return;
            const messageId = typeof value.message_id === "number" && Number.isSafeInteger(value.message_id)
                ? String(value.message_id) : typeof value.message_id === "string" && /^-?\d{1,20}$/.test(value.message_id)
                    ? value.message_id : undefined;
            if (!messageId || this.seen.has(messageId)) return;
            const sender = object(value.sender) ? value.sender : {};
            const name = [sender.card, sender.nickname, String(userId)].find(v => typeof v === "string" && v.trim()) as string;
            const segments = this.inbound(value.message, groupId);
            if (!segments.length) return;
            this.platform.ingest(groupId, {externalId: String(userId), name: name.slice(0, 80)}, segments);
            this.seen.add(messageId);
            if (this.seen.size > 2000) this.seen.delete(this.seen.values().next().value!);
        } catch { /* Ignore malformed/unrelated events; never ingest API responses. */ }
    }

    private inbound(input: unknown, groupId: number): Segment[] {
        const values: unknown = typeof input === "string" ? parseCq(input) : input;
        if (!Array.isArray(values) || values.length > 100) throw new Error("Invalid message");
        return values.map((value): Segment => {
            if (!object(value) || typeof value.type !== "string" || !object(value.data)) throw new Error("Invalid segment");
            if (value.type === "text" && typeof value.data.text === "string" && value.data.text.length <= 16000) {
                return {type: "text", text: value.data.text};
            }
            if (value.type === "at") {
                const target = value.data.qq;
                return {type: "mention", userId: target === "all" ? "all" : this.platform.participantId(groupId,
                    {externalId: String(numericId(target)), name: String(target)})};
            }
            if (value.type === "image") {
                const url = value.data.url ?? value.data.file;
                if (typeof url === "string" && url.length <= 16000 && /^https?:\/\//.test(url)) {
                    new URL(url); return {type: "image", url};
                }
            }
            // Never expose or download local bot files/base64. Preserve unsupported content as text.
            const labels: Record<string, string> = {image: "图片", record: "语音", video: "视频", file: "文件", face: "表情", forward: "合并转发"};
            return {type: "text", text: `[${labels[value.type] ?? "不支持的消息"}]`};
        });
    }

    private async deliver(delivery: Delivery): Promise<void> {
        const groupId = this.state.platformGroupId;
        if (groupId === undefined || this.state.status !== "connected") throw new Error("OneBot group offline");
        const message: V11Segment[] = [];
        if (delivery.sourceGroupName) message.push({type: "text", data: {text: `[${delivery.sourceGroupName}] <${delivery.authorName}> `}});
        for (const segment of delivery.segments) {
            if (segment.type === "text") message.push({type: "text", data: {text: segment.text}});
            else if (segment.type === "image") message.push({type: "image", data: {file: segment.url}});
            else {
                const member = segment.userId === "all" ? undefined : this.platform.group(groupId).members.get(segment.userId);
                // A virtual ChatHub ID is never blindly used as a QQ account.
                if (segment.userId === "all") message.push({type: "at", data: {qq: "all"}});
                else if (member?.externalId) message.push({type: "at", data: {qq: member.externalId}});
                else message.push({type: "text", data: {text: `@${segment.userId}`}});
            }
        }
        const response = await this.call("send_group_msg", {group_id: this.settings.group_id, message});
        if (!object(response) || !Number.isSafeInteger(response.message_id)) throw new Error("Invalid OneBot delivery acknowledgement");
    }
}
