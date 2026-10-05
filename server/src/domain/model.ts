export interface Player {
    /** UUID is scoped by the authentication system, not by a display name. */
    uuid: string;
    externalId?: never;
    name: string;
}

/** External accounts are never represented by fabricated Minecraft UUIDs. */
export interface ExternalUser {
    externalId: string;
    uuid?: never;
    name: string;
}
export type Participant = Player | ExternalUser;

export type Segment =
    | {type: "text"; text: string}
    | {type: "image"; url: string}
    | {type: "mention"; userId: number | "all"};

export type Member = Participant & {
    userId: number;
    online: boolean;
    joinedAt: number;
    lastSeen: number;
    lastSentTime: number;
};

export interface Group {
    id: number;
    nodeId: string;
    name: string;
    identityScope: string;
    members: Map<number, Member>;
    systemLastSentTime: number;
    kind: "minecraft" | "onebot";
    externalGroupId?: number;
    botId?: number;
}

export interface ChatMessage {
    id: number;
    groupId: number;
    authorId: number;
    authorName: string;
    segments: Segment[];
    time: number;
    origin: "player" | "system" | "application" | "plugin";
    /** Opaque category supplied by the node; the core does not parse MC logs. */
    systemKind?: string;
    sourceMessageId?: number;
    /** Internal observation ID; never serialized onto native or OneBot protocols. */
    traceId?: string;
}

/** Session-local diagnostics, separate from accepted chat history and events. */
export interface DeliveryFailureLog {
    id: number;
    time: number;
    level: "error";
    type: "delivery_failed";
    origin: "application" | "plugin";
    groupId: number;
    groupName: string;
    nodeId?: string;
    messageId?: number;
    sourceMessageId?: number;
    error: string;
}

export interface Delivery {
    messageId: number;
    segments: Segment[];
    authorName: string;
    sourceGroupName?: string;
}

export interface NodeTransport {
    /** Resolves on transport acceptance (MCDR ACK or external bot API success). */
    deliver(delivery: Delivery, observation?: DeliveryObservation): Promise<void>;
}

/** Optional server-side diagnostics, never added to the wire protocol. */
export interface DeliveryObservation {
    record(direction: "sent" | "received", payload: unknown): void;
}

export type PlatformEvent =
    | {type: "message"; message: ChatMessage}
    /** A successfully delivered application message with an explicit trusted source. */
    | {type: "application"; application: "onebot_api"; message: ChatMessage}
    | {type: "presence"; groupId: number; userId: number; online: boolean};
