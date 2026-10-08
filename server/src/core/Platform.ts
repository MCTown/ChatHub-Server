import {EventEmitter} from "node:events";
import {randomInt} from "node:crypto";
import {ChatMessage, DeliveryFailureLog, Group, Member, NodeTransport, Participant, PlatformEvent, Segment} from "../domain/model";
import {IdentityDirectory} from "./ports";
import {TraceStore} from "./TraceStore";
import {CommandSystem} from "./CommandSystem";

interface Session {
    group: Group;
    transport: NodeTransport;
}

export class PlatformError extends Error {
    constructor(message: string, public readonly retcode = 100) { super(message); }
}

/** Chat platform core. No OneBot payloads, WebSocket or file IO here. */
export class Platform {
    readonly traces = new TraceStore();
    readonly commands = new CommandSystem(this);
    readonly botId = 1;
    readonly systemId = 2;
    readonly systemName = "Minecraft Server";
    private readonly sessions = new Map<number, Session>();
    private readonly events = new EventEmitter();
    private readonly messages = new Map<number, ChatMessage>();
    private readonly logs: DeliveryFailureLog[] = [];
    private nextLogId = 1;
    // V11 message_id is int32. History is session-local; do not encode UUID/time here.
    private nextMessageId = randomInt(1, 1000000000);

    constructor(private readonly identities: IdentityDirectory) {}

    subscribe(listener: (event: PlatformEvent) => void): () => void {
        this.events.on("event", listener);
        return () => this.events.off("event", listener);
    }

    attach(nodeId: string, name: string, identityScope: string, players: Participant[], transport: NodeTransport,
        metadata: Pick<Group, "kind" | "externalGroupId" | "botId"> = {kind: "minecraft"}): Group {
        const id = this.identities.group(nodeId);
        if (this.sessions.has(id)) throw new PlatformError("Node ID is already connected");
        const group: Group = {id, nodeId, name, identityScope, members: new Map(), systemLastSentTime: 0, ...metadata};
        for (const player of players) this.upsert(group, player, true);
        this.sessions.set(id, {group, transport});
        return group;
    }

    detach(groupId: number, transport: NodeTransport): void {
        if (this.sessions.get(groupId)?.transport === transport) this.sessions.delete(groupId);
    }

    groups(): Group[] { return [...this.sessions.values()].map(session => session.group); }

    group(id: number): Group {
        const group = this.sessions.get(id)?.group;
        if (!group) throw new PlatformError("Group is offline or unknown");
        return group;
    }

    member(groupId: number, userId: number): Member {
        const member = this.group(groupId).members.get(userId);
        if (!member) throw new PlatformError("Member not known in this session");
        return member;
    }

    presence(groupId: number, player: Participant, online: boolean): void {
        const member = this.upsert(this.group(groupId), player, online);
        this.emit({type: "presence", groupId, userId: member.userId, online});
    }

    /** Reconcile a complete, successful client API result, retaining observed offline members. */
    syncOnlinePlayers(groupId: number, players: Participant[]): void {
        const group = this.group(groupId);
        const ids = new Set(players.map(player => this.participantId(groupId, player)));
        for (const member of group.members.values()) {
            if (member.online && !ids.has(member.userId)) this.presence(groupId, member, false);
        }
        for (const player of players) {
            const id = this.participantId(groupId, player);
            if (!group.members.get(id)?.online) this.presence(groupId, player, true);
            else this.upsert(group, player, true);
        }
    }

    ingest(groupId: number, player: Participant, segments: Segment[], observation?: {eventId: string; payload: unknown}): ChatMessage {
        const group = this.group(groupId);
        // Chat is not authoritative evidence of current presence (it can be queued).
        const member = this.upsert(group, player,
            group.members.get(this.participantId(groupId, player))?.online ?? false);
        member.lastSentTime = Math.floor(Date.now() / 1000);
        const message = this.create(groupId, member.userId, member.name, segments, "player");
        this.traceIncoming(message, group, observation);
        this.remember(message);
        if (this.commands.dispatch(message)) return message;
        this.emit({type: "message", message});
        return message;
    }

    system(groupId: number, kind: string, text: string, observation?: {eventId: string; payload: unknown}): ChatMessage {
        const group = this.group(groupId);
        const message = this.create(groupId, this.systemId, this.systemName, [{type: "text", text}], "system");
        message.systemKind = kind;
        this.traceIncoming(message, group, observation);
        group.systemLastSentTime = message.time;
        this.remember(message);
        this.emit({type: "message", message});
        return message;
    }

    async send(groupId: number, segments: Segment[], source?: ChatMessage,
        observation: {traceId?: string; pluginName?: string; application?: "onebot_api";
            /** Display-only override; an empty name hides the author without changing identity. */
            authorName?: string} = {}): Promise<ChatMessage> {
        // Dashboard and OneBot application sends share the same command entry point.
        // Replies/relays carry a source and must never execute commands recursively.
        if (!source && this.commands.accepts(segments)) {
            const group = this.group(groupId);
            const command = this.create(groupId, this.botId, "ChatHub", segments, "application");
            if (observation.traceId) command.traceId = observation.traceId;
            else this.traceIncoming(command, group);
            this.remember(command);
            this.commands.dispatch(command);
            return command;
        }
        const session = this.sessions.get(groupId);
        const traceId = source?.traceId ?? observation.traceId ?? this.traces.start(source ? "plugin" : "application",
            this.preview(segments), {kind: "source", label: source ? "插件投递" : "应用投递",
                authorName: source ? (observation.authorName ?? source.authorName ?? "插件") : "ChatHub"}, {segments});
        if (!source?.traceId && !observation.traceId) this.traces.add(traceId, "1", {kind: "core", label: "ChatHub Core"}, "accepted");
        const stepId = this.traces.add(traceId, "2", {kind: "delivery", groupId, nodeId: session?.group.nodeId,
            label: `${source ? (observation.pluginName ?? "插件") + " → " : ""}${session?.group.name ?? `群 #${groupId}`}`,
            pluginName: observation.pluginName}, "processing", {segments});
        let message: ChatMessage | undefined;
        try {
            if (!session) throw new PlatformError("Group is offline or unknown");
            message = this.create(groupId, this.botId, "ChatHub", segments,
                source ? "plugin" : "application");
            if (source) message.sourceMessageId = source.id;
            message.traceId = traceId;
            this.traces.identifyMessage(traceId, stepId, message.id);
            await session.transport.deliver({
                messageId: message.id,
                segments: structuredClone(segments),
                authorName: observation.authorName ?? source?.authorName ?? message.authorName,
                sourceGroupName: source ? this.group(source.groupId).name : undefined,
            }, {record: (direction, payload) => {
                this.traces.add(traceId, stepId, {kind: "delivery", label: direction === "sent" ? "客户端投递报文" : "客户端确认报文",
                    groupId, messageId: message!.id, direction}, direction === "sent" ? "sent" : "received", payload);
            }});
        } catch (error) {
            const reason = error instanceof Error ? error.message : typeof error === "string" ? error : "Unknown delivery error";
            // Snapshot the target before it disappears; never retain payloads or error stacks.
            this.recordDeliveryFailure(groupId, reason, {origin: source ? "plugin" : "application",
                messageId: message?.id, sourceMessageId: source?.id, target: session?.group});
            this.traces.finish(traceId, stepId, /timed out|timeout/i.test(reason) ? "timeout" : "failed", reason);
            throw error;
        }
        this.traces.finish(traceId, stepId, "confirmed");
        this.traces.add(traceId, stepId, {kind: "delivery", label: "投递确认", groupId, messageId: message.id}, "confirmed",
            {messageId: message.id, sourceMessageId: source?.id});
        this.remember(message);
        // Outgoing deliveries are deliberately NOT emitted as incoming chat.
        if (!source && observation.application === "onebot_api") {
            this.emit({type: "application", application: "onebot_api", message});
        }
        return message;
    }

    message(id: number): ChatMessage {
        const message = this.messages.get(id);
        if (!message) throw new PlatformError("Message not found or expired");
        return structuredClone(message);
    }

    get messageCount(): number { return this.messages.size; }

    recentMessages(limit = 150): ChatMessage[] {
        const count = Number.isFinite(limit) ? Math.max(0, Math.min(1000, Math.floor(limit))) : 0;
        if (count === 0) return [];
        return structuredClone([...this.messages.values()].slice(-count).reverse());
    }

    recentLogs(limit = 200): DeliveryFailureLog[] {
        const count = Number.isFinite(limit) ? Math.max(0, Math.min(200, Math.floor(limit))) : 0;
        return count === 0 ? [] : structuredClone(this.logs.slice(-count).reverse());
    }

    /** Includes gateway preparation failures, before a delivery/message ID exists. */
    recordDeliveryFailure(groupId: number, reason: string,
        context: {origin?: "application" | "plugin"; messageId?: number; sourceMessageId?: number;
            target?: Pick<Group, "name" | "nodeId">} = {}): void {
        const group = context.target ?? this.sessions.get(groupId)?.group;
        this.logs.push({id: this.nextLogId++, time: Math.floor(Date.now() / 1000), level: "error", type: "delivery_failed",
            origin: context.origin ?? "application", groupId, groupName: group?.name ?? `群 #${groupId}`,
            nodeId: group?.nodeId, messageId: context.messageId, sourceMessageId: context.sourceMessageId,
            error: reason.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 500) || "Unknown delivery error"});
        if (this.logs.length > 200) this.logs.shift();
    }

    participantId(groupId: number, participant: Participant): number {
        const group = this.group(groupId);
        return this.identities.user(group.identityScope, participant.uuid ?? participant.externalId);
    }

    private upsert(group: Group, player: Participant, online: boolean): Member {
        const userId = this.identities.user(group.identityScope, player.uuid ?? player.externalId);
        const now = Math.floor(Date.now() / 1000);
        const previous = group.members.get(userId);
        const member = {...player, userId, online, joinedAt: previous?.joinedAt ?? now, lastSeen: now,
            lastSentTime: previous?.lastSentTime ?? 0};
        group.members.set(userId, member);
        return member;
    }

    private create(groupId: number, authorId: number, authorName: string, segments: Segment[],
        origin: ChatMessage["origin"]): ChatMessage {
        const id = this.nextMessageId++;
        if (this.nextMessageId > 2147483647) this.nextMessageId = 1;
        return {id, groupId, authorId, authorName,
            segments: structuredClone(segments), time: Math.floor(Date.now() / 1000), origin};
    }

    private remember(message: ChatMessage): void {
        this.messages.set(message.id, message);
        if (this.messages.size > 1000) this.messages.delete(this.messages.keys().next().value!);
    }

    private preview(segments: Segment[]): string {
        return segments.map(segment => segment.type === "text" ? segment.text : segment.type === "image" ? "[图片]" : `@${segment.userId}`).join("").slice(0, 800);
    }

    private traceIncoming(message: ChatMessage, group: Group, observation?: {eventId: string; payload: unknown}): void {
        const traceId = this.traces.start(message.origin, this.preview(message.segments),
            {kind: "source", label: `${group.name} · ${message.authorName}`, groupId: group.id, nodeId: group.nodeId,
                authorName: message.authorName, groupName: group.name, messageId: message.id, eventId: observation?.eventId}, observation?.payload ?? message);
        message.traceId = traceId;
        this.traces.add(traceId, "1", {kind: "core", label: "ChatHub Core", messageId: message.id}, "accepted");
    }

    private emit(event: PlatformEvent): void {
        for (const listener of this.events.listeners("event")) {
            try { (listener as (event: PlatformEvent) => void)(structuredClone(event)); }
            catch (error) { console.error("Platform subscriber failed", error); }
        }
    }
}
