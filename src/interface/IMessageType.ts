export interface MessageElement {
    type: string;
    data: {
        text?: string;
        url?: string;
        file?: string;
        [key: string]: any;
    };
}

export interface RawChatMessage {
    meta_event_type?: 'lifecycle' | 'heartbeat';
    self_id: string;
    user_id: string;
    time: string;
    message_id: string;
    message_seq: string;
    real_id: string;
    real_seq: string;
    message_type: 'private' | 'group' | 'discuss' | string;
    sender: {
        user_id: string;
        nickname: string;
        card: string;
        role: 'member' | 'admin' | 'owner' | string;
    };
    raw_message: string;
    font: string;
    sub_type: 'normal' | string;
    message: MessageElement[];
    message_format: 'array' | 'string';
    post_type: 'message' | string;
    group_id: string;
    group_name?: string;
    raw: RawMessage;
}


interface RawMessage {
    msgId: string;
    msgRandom: string;
    msgSeq: string;
    cntSeq: string;
    chatType: number;
    msgType: number;
    subMsgType: number;
    sendType: number;
    senderUid: string;
    peerUid: string;
    channelId: string;
    guildId: string;
    guildCode: string;
    fromUid: string;
    fromAppid: string;
    msgTime: string;
    msgMeta: Record<string, any>;
    sendStatus: number;
    sendRemarkName: string;
    sendMemberName: string;
    sendNickName: string;
    guildName: string;
    channelName: string;
    elements: any[];
    records: any[];
    emojiLikesList: any[];
    commentCnt: string;
    directMsgFlag: number;
    directMsgMembers: any[];
    peerName: string;
    freqLimitInfo: any | null;
    editable: boolean;
    avatarMeta: string;
    avatarPendant: string;
    feedId: string;
    roleId: string;
    timeStamp: string;
    clientIdentityInfo: any | null;
    isImportMsg: boolean;
    atType: number;
    roleType: number;
    fromChannelRoleInfo: RoleInfo;
    fromGuildRoleInfo: RoleInfo;
    levelRoleInfo: RoleInfo;
    recallTime: string;
    isOnlineMsg: boolean;
    generalFlags: Record<string, any>;
    clientSeq: string;
    fileGroupSize: number | null;
    foldingInfo: any | null;
    multiTransInfo: any | null;
    senderUin: string;
    peerUin: string;
    msgAttrs: Record<string, any>;
    anonymousExtInfo: any | null;
    nameType: number;
    avatarFlag: number;
    extInfoForUI: any | null;
    personalMedal: any | null;
    categoryManage: number;
    msgEventInfo: any | null;
    sourceType: number;
    id: number;
}

interface RoleInfo {
    roleId: string;
    name: string;
    color: number;
}