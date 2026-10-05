import {Platform, PlatformError} from "../../core/Platform";
import {ChatMessage, Group, Member, Segment} from "../../domain/model";
import {ImageStore} from "../../storage/ImageStore";
import {fromV11, numericId} from "./codec";

export interface OneBotSendOptions {
    traceId?: string;
}

/** Shared application-facing OneBot operations used by all transports. */
export class OneBotApi {
    constructor(private readonly platform: Platform, private readonly images?: ImageStore) {}

    listGroups(): Group[] { return this.platform.groups(); }

    getGroupList(): Record<string, unknown>[] {
        return this.listGroups().map(group => this.groupInfo(group));
    }

    getGroupInfo(groupId: unknown): Record<string, unknown> {
        return this.groupInfo(this.platform.group(numericId(groupId)));
    }

    getGroupMemberList(groupId: unknown): Record<string, unknown>[] {
        const id = numericId(groupId);
        const group = this.platform.group(id);
        return [...group.members.values(), this.systemMember(group), this.botMember()]
            .map(member => this.memberInfo(id, member));
    }

    getGroupMemberInfo(groupId: unknown, userId: unknown): Record<string, unknown> {
        const id = numericId(groupId);
        const group = this.platform.group(id);
        const memberId = numericId(userId);
        return this.memberInfo(id, memberId === this.platform.botId ? this.botMember()
            : memberId === this.platform.systemId ? this.systemMember(group) : this.platform.member(id, memberId));
    }

    async sendGroupMessage(groupId: unknown, input: unknown, autoEscape = false,
        options: OneBotSendOptions = {}): Promise<{message_id: number; message: ChatMessage}> {
        const id = numericId(groupId);
        let segments: Segment[];
        try {
            // Do not retain uploads for an offline or unknown target.
            this.platform.group(id);
            segments = fromV11(input, autoEscape, source => source);
            for (const segment of segments) {
                if (segment.type !== "image" || !segment.url.startsWith("base64://")) continue;
                if (!this.images) throw new PlatformError("Image storage is unavailable", 1400);
                segment.url = await this.images.ingest(segment.url);
            }
        } catch (error) {
            this.platform.recordDeliveryFailure(id, error instanceof Error ? error.message : "消息准备失败。");
            if (options.traceId) {
                this.platform.traces.add(options.traceId, "2", {kind: "delivery", groupId: id,
                    label: "消息准备失败"}, "failed", {reason: error instanceof Error ? error.message : "消息准备失败。"});
            }
            throw error;
        }
        const message = await this.platform.send(id, segments, undefined, {...options, application: "onebot_api"});
        return {message_id: message.id, message};
    }

    private groupInfo(group: Group): Record<string, unknown> {
        return {group_id: group.id, group_name: group.name, member_count: group.members.size + 2, max_member_count: 0};
    }

    private botMember(): Member {
        return {uuid: "", name: "ChatHub", userId: this.platform.botId, online: true,
            joinedAt: 0, lastSeen: 0, lastSentTime: 0};
    }

    private systemMember(group: Group): Member {
        return {uuid: "", name: this.platform.systemName, userId: this.platform.systemId, online: true,
            joinedAt: 0, lastSeen: group.systemLastSentTime, lastSentTime: group.systemLastSentTime};
    }

    private memberInfo(groupId: number, member: Member): Record<string, unknown> {
        return {group_id: groupId, user_id: member.userId, nickname: member.name, card: "", sex: "unknown", age: 0,
            area: "", join_time: member.joinedAt, last_sent_time: member.lastSentTime, level: "", role: "member",
            unfriendly: false, title: "", title_expire_time: 0, card_changeable: false};
    }
}
