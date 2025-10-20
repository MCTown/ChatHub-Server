import {Logger} from "./Logger";

export class MessageFilter {
    // 仅处理Message,不处理sender之类的数据
    static filterMessages(messages: any[], client_type: string): any[] {
        let processedMessages = [];
        for (let message of messages) {
            let msg_type: string = message.type
            switch (msg_type) {
                case 'text':
                    processedMessages.push(message);
                    break;
                case 'image':
                    if (message.url) {
                        Logger.warn("图片消息 URL:", message.url);
                        processedMessages.push({
                            type: 'image',
                            data: {
                                url: message.url
                            }
                        });
                        break
                    }
                    Logger.warn("图片消息缺少 URL，此种情况尚未实现处理");
                    break;
                case 'at':
                    let at_info = message.data
                    switch (client_type) {
                        case 'chathub':
                            if (at_info.qq) {
                                // QQ->MC 需要查表并转换为 MC UUID
                                processedMessages.push({
                                    type: 'at',
                                    data: {
                                        mcuuid: "101441166bbc43399d4b128fa792feeb", // todo
                                    }
                                });
                            } else if (at_info.mcuuid) {
                                // MC->MC 无需处理
                                processedMessages.push(message);
                            }
                            break;
                        case 'onebot':
                            if (at_info.qq) {
                                // QQ->QQ 直接转发
                                processedMessages.push({
                                    type: 'at',
                                    data: {
                                        qq: "3026194904" // todo
                                    }
                                });
                            } else if (at_info.mcuuid) {
                                // MC->QQ 需要查表并转换为 QQ ID
                                processedMessages.push({
                                    type: 'at',
                                    data: {
                                        qq: "3026194904" // todo
                                    }
                                });
                            }
                            break
                        default:
                            Logger.warn(`未知客户端类型 ${client_type}，无法处理 at 消息`);
                    }
            }
            // Logger.debug('Messages:', processedMessages, 'Broadcast client Type:', client_type);
        }
        return processedMessages
    }
}