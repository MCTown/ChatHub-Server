import {WebSocketServer} from "ws";
import {IOneBotConnection, IOneBotServer} from "./interface/IOneBotConnection";
import {Logger} from "./utils/Logger";
import {ConfigManager} from "./utils/ConfigLoader";
import {Config as ServerConfig} from "./interface/Config";
import {MessageFilter} from "./utils/MessageFilter";
import {MessageElement, RawChatMessage} from "./interface/IMessageType";
import {JsonDB} from 'node-json-db';
import {Config} from 'node-json-db/dist/lib/JsonDBConfig'

export const db = new JsonDB(new Config("qq_uuid_map", true, true, '/'));
const config: ServerConfig = ConfigManager.getServerConfig();

export class OnebotServer implements IOneBotServer {
    private wss?: WebSocketServer;

    private wsClients: Array<IOneBotConnection> = [];
    private clientConfig = ConfigManager.getClientsList()
    private clientsList = this.clientConfig.clients

    public start(port: number): void {
        this.wss = new WebSocketServer({
            port,
            path: '/onebot/chathub',       // ws-reverse 约定的路径
        });
        Logger.info(`[OneBotServer] listening on ws://0.0.0.0:${port}/onebot/chathub`);

        this.wss.on('connection', (ws, req) => {
            let client_id: string | null = null
            Logger.info('[OneBotServer] 客户端已连接:', req.socket.remoteAddress);

            // 把 ws 包装成 IOneBotConnection
            const conn: IOneBotConnection = {
                send: (payload: any) => {
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify(payload));
                    }
                },
            };
            /**
             * 接受客户端消息
             */
            // 接收客户端消息并打印
            ws.on('message', async data => {
                const raw = data.toString();
                try {
                    const msg: RawChatMessage = JSON.parse(raw);
                    // 心跳和生命周期消息用于验证连接
                    if (msg.meta_event_type) {
                        if (msg.meta_event_type === 'lifecycle' || msg.meta_event_type === 'heartbeat') {
                            if (client_id !== null) return;
                            Logger.debug("接收到 verify 消息，client_id:", msg.self_id);
                            /**
                             * 进行验证，如果验证通过，则将该连接添加到 wsClients 中
                             */
                            for (const clientInfo of this.clientsList) {
                                if (clientInfo.client_id === msg.self_id.toString()) {
                                    /**
                                     * client_id 匹配，开始验证 token
                                     */
                                    client_id = msg.self_id;
                                    Logger.debug(`客户端成功验证，${client_id}已连接`);
                                    /**
                                     * 处理验证通过的客户端连接
                                     */
                                    conn.client_id = clientInfo.client_id;
                                    conn.client_type = clientInfo.client_type;
                                    conn.client_name = clientInfo.client_name
                                    this.wsClients.push(conn);
                                    Logger.info(`[OneBotServer] 客户端 ${clientInfo.client_id} 已注册，类型：${clientInfo.client_type}`);
                                    return;
                                } else Logger.debug(`配置的ID：${clientInfo.client_id} 不匹配 ${msg.self_id}`);
                            }
                            Logger.warn(`${msg.self_id} 已连接，但是该客户端不在 clients.yaml 中，断开当前连接`);
                            ws.close(1000, 'Client not found in clients.yaml');
                            return;
                        }
                    } else if (msg.self_id) { // 通过判断 self_id 是否存在来区分是否为用户发的消息
                        Logger.network.receive('收到 JSON 消息：', msg);
                        if (client_id === null) {
                            Logger.warn(`收到消息，但未验证连接，消息不予处理：${JSON.stringify(msg)}`);
                            return;
                        }
                        /**
                         * 处理接收消息的逻辑
                         * 不予转发来源不是chathub或不是qq_active_group的消息
                         */
                        if (!(msg.group_id === config.qq_active_group || msg.group_id === 'chathub')) return;
                        Logger.network.receive(msg)
                        const data: MessageElement[] = msg.message
                        /**
                         * 指令模块
                         */
                        if (data[0].data.text?.startsWith('!!')) {
                            Logger.debug(`[Command] 收到指令消息：`, data[0].data?.text);
                            const command = (data[0].data.text?.split('!!')[1].trim()).split(' ')[0]
                            Logger.debug("[Command] 解析指令为：", command)
                            const args = (data[0].data.text?.split('!!')[1].trim()).split(' ').filter((_, index) => index > 0);
                            Logger.debug("[Command] 解析参数为：", args)

                            switch (command) {
                                case 'ping':
                                    this.respond([{'type': 'text', data: {'text': 'pong!!'}}], conn)
                                    break
                                case 'bind':
                                    // 绑定客户端 ID 与昵称
                                    if (args.length !== 1) {
                                        db.getData(`/qq_to_uuid/${msg.sender.user_id}`).then((data) => {
                                            this.respond([{
                                                'type': 'text',
                                                data: {'text': `当前已绑定${JSON.stringify(data)}\n如需再次绑定，请使用：\n!!bind 玩家昵称`}
                                            }], conn)
                                        }).catch(() => {
                                            this.respond([{
                                                'type': 'text',
                                                data: {'text': '绑定失败，使用该指令进行绑定：\n!!bind 玩家昵称'}
                                            }], conn)
                                        })
                                    } else {
                                        const player_name = args[0]
                                        Logger.debug("开始绑定...")
                                        get_uuid_by_player_name(player_name).then(async data => {
                                            const player_uuid = data
                                            const player_qq_id = msg.sender.user_id
                                            const exists = await db.exists(`/qq_to_uuid/${player_qq_id}`);
                                            if (exists) {
                                                this.respond([{
                                                    type: 'text',
                                                    data: {text: `已将QQ ${player_qq_id} 的MC账户更改为 ${player_name}`}
                                                }], conn)
                                                const old_uuid = (await db.getData(`/qq_to_uuid/${player_qq_id}`)).player_uuid
                                                await db.delete(`/uuid_to_qq/${old_uuid}`)
                                                await db.delete(`/qq_to_uuid/${player_qq_id}`)
                                            } else {
                                                // 判断该uuid是否已被绑定
                                                const uuid_exists = await db.exists(`/uuid_to_qq/${player_uuid}`);
                                                if (uuid_exists) {
                                                    const bound_qq = (await db.getData(`/uuid_to_qq/${player_uuid}`)).player_qq_id
                                                    this.respond([{
                                                        type: 'text',
                                                        data: {text: `绑定失败，MC账户 ${player_name} 已被QQ ${bound_qq} 绑定`}
                                                    }], conn)
                                                    return
                                                }
                                                this.respond([{
                                                    type: 'text',
                                                    data: {text: `已绑定QQ ${player_qq_id} 的MC账户为 ${player_name}`}
                                                }], conn)

                                            }
                                            await db.push(`/uuid_to_qq/${player_uuid}`, {player_qq_id})
                                            await db.push(`/qq_to_uuid/${player_qq_id}`, {player_uuid})
                                            Logger.debug(player_name, player_uuid, player_qq_id, exists)
                                            Logger.debug("绑定完成！")
                                        })
                                    }
                                    break
                                case ('unbind'):
                                    // 解绑客户端 ID 与昵称
                                    db.getData(`/qq_to_uuid/${msg.sender.user_id}`).then(async (data) => {
                                            const player_uuid = data.player_uuid
                                            const player_qq_id = msg.sender.user_id
                                            await db.delete(`/qq_to_uuid/${player_qq_id}`)
                                            await db.delete(`/uuid_to_qq/${player_uuid}`)
                                            this.respond([{
                                                type: 'text',
                                                data: {text: `已解绑QQ ${player_qq_id} 的MC账户`}
                                            }], conn)
                                            Logger.debug("解绑完成！")
                                        }
                                    ).catch(() => {
                                        this.respond([{
                                            'type': 'text',
                                            data: {'text': '解绑失败，您尚未绑定任何MC账户'}
                                        }], conn)
                                    })
                                    break
                                default:
                                    this.respond([{
                                        'type': 'text',
                                        data: {'text': `未知指令：${command}`}
                                    }], conn);
                            }
                            return;
                        }
                        if (msg.sender.nickname === 'null') {
                            // Chathub服务端的消息，
                            this.broadcast(data, conn);
                        } else if (msg.group_id === 'koishi') {
                            // 来自 Koishi 的消息

                        } else if (msg.group_id === config.qq_active_group) {
                            // 来自 QQ 群的消息，添加昵称
                            this.broadcast(data, conn, msg.sender.user_id, (config.is_use_group_nickname && msg.sender.card !== '') ? msg.sender.card : msg.sender.nickname);
                        } else if (msg.group_id === 'chathub') {
                            // 来自 Chathub 的消息
                            this.broadcast(data, conn, msg.sender.user_id, msg.sender.nickname);
                        }
                    }
                } catch (e) {
                    Logger.error(this.clientsList)
                    console.log(e);
                    console.log('[OneBotServer] 收到非 JSON 数据：', raw);
                }
            });

            ws.on('close', (code, reason) => {
                Logger.info("WS 客户端关闭，断开原因：", code, reason.toString());
            });

            ws.on('error', err => {
                console.error('[OneBotServer] 连接错误：', err.message);
            });
        });
    }

    public stop(): void {
        if (this.wss) {
            this.wss.close();
            console.log('[OneBotServer] 已停止');
        }
    }

    /**
     * 广播消息，向所有连接的客户端发送消息
     * @param sender_id
     * @param sender_name
     * @param messages
     * @param conn 连接对象，表示当前的客户端连接，广播时会避开当前连接
     */
    public broadcast(messages: any[], conn: IOneBotConnection, sender_id?: string, sender_name?: string): void {
        // 在转发时, 不动消息体, 而是加上客户端标识符
        // Logger.warn('start',messages,'stop')
        if (sender_name) {
            messages.unshift({
                type: 'text',
                data: {
                    text: `<${sender_name}> `
                }
            })
        }
        if (conn.client_name) {
            messages.unshift({
                type: 'text',
                data: {
                    text: `[${conn.client_name}] `
                }
            })
        }

        this.wsClients.forEach(async client => {
            if (client !== conn) { // 避免向当前连接发送消息
                const payload = {
                    "action": "send_group_msg",
                    "params": {
                        "group_id": config.qq_active_group,
                        "message": await MessageFilter.filterMessages(messages, <string>client.client_type),
                    },
                }
                try {
                    Logger.network.send('[OneBotServer] 广播消息到客户端:', client.client_id, payload);
                    client.send(payload);
                } catch (e) {
                    Logger.error('[OneBotServer] 发送消息失败:', e);
                }
            }
        })
    }

    public respond(message: MessageElement[], conn: IOneBotConnection): void {
        conn.send({
            "action": "send_group_msg",
            "params": {
                "group_id": config.qq_active_group,
                "message": message
            },
        });
    }
}


/**
 * 通过玩家名获取 UUID
 * @param playerName 玩家名（Minecraft 用户名）
 * @returns Promise<string | null> 若成功则返回 UUID（去掉中划线），失败返回 null
 */
export const get_uuid_by_player_name = async (playerName: string): Promise<string | null> => {
    try {
        // Mojang 官方 API
        const response = await fetch(`https://api.mojang.com/users/profiles/minecraft/${playerName}`);

        if (!response.ok) {
            // 404 表示玩家不存在
            if (response.status === 404) return null;
            Logger.error(`请求失败: ${response.status} ${response.statusText}`)
        }

        const data = (await response.json()) as { id: string; name: string };

        // 返回去掉中划线的 UUID（Mojang 默认无中划线）
        return data.id || null;
    } catch (error) {
        console.error(`[get_uuid_by_player_name] 查询失败:`, error);
        return null;
    }
}
