import {Logger} from "./Logger";
import {JsonDB} from 'node-json-db';
import {Config} from 'node-json-db/dist/lib/JsonDBConfig'
import {db, get_uuid_by_player_name} from "../OnebotServer";
export class MessageFilter {
    // 仅处理Message,不处理sender之类的数据
    static async filterMessages(messages: any[], client_type: string): Promise<any[]> {
        let processedMessages = [];
        for (let message of messages) {
            let msg_type: string = message.type
            switch (msg_type) {
                case 'text':
                    processedMessages.push(message);
                    break;
                case 'image':
                    Logger.warn("图片消息", message.data);
                    if (message.url) {
                        Logger.warn("图片消息 URL:", message.url);
                        processedMessages.push({
                            type: 'image',
                            data: {
                                url: message.url,
                                summary: message.summary
                            }
                        });
                        break
                    }
                    if (message.data.url) {
                        Logger.warn("图片消息 URL:", message.data.url);
                        processedMessages.push({
                            type: 'image',
                            data: {
                                url: message.data.url
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
                            } else if (at_info.player_name) {
                                // chathub传参{'type': 'at', 'data': {'player_name': player_name}}
                                // MC->QQ 需要查表并转换为 QQ ID
                                await get_uuid_by_player_name(at_info.player_name).then(async r => {
                                    await db.getData(`/uuid_to_qq/${r}`).then(r => {
                                        processedMessages.push({
                                            type: 'at',
                                            data: {
                                                qq: r.player_qq_id
                                            }
                                        });
                                        processedMessages.push({
                                            type: 'text',
                                            data: {
                                                'text': ' '
                                            }
                                        });
                                    }).catch(err => {
                                        processedMessages.push({
                                            type: 'text',
                                            data: {
                                                'text': '@' + at_info.player_name + ' '
                                            }
                                        });
                                        Logger.warn("玩家", at_info.player_name, "未绑定 QQ 账号，无法发送 at 消息", err);
                                    })
                                })
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