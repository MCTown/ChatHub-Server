import {WebSocketServer} from "ws";
import {IOneBotConnection, IOneBotServer} from "./interface/IOneBotConnection";
import {Logger} from "./utils/Logger";
import {ConfigManager} from "./utils/ConfigLoader";
import {Config} from "./interface/Config";
import {MessageFilter} from "./utils/MessageFilter";

const config: Config = ConfigManager.getServerConfig();

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
            ws.on('message', data => {
                const raw = data.toString();
                try {
                    const msg = JSON.parse(raw);
                    Logger.network.receive('收到 JSON 消息：', msg);
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
                                    // if (msg.params.token === null) {
                                    //     console.log(`[OneBotServer] 客户端 ${clientInfo.client_id} 的 token 为空，可能无法正常工作`);
                                    // }
                                    client_id = msg.self_id;
                                    // const token = msg.params.token;
                                    // if (clientInfo.client_token !== token) {
                                    //     Logger.warn(`[OneBotServer] 客户端 ${clientInfo.client_id} 的 token 验证失败，断开连接`);
                                    //     ws.close(1000, 'Token verification failed');
                                    //     return;
                                    // }
                                    Logger.debug(`客户端成功验证，${client_id}已连接`);
                                    /**
                                     * 处理验证通过的客户端连接
                                     */
                                    conn.client_id = clientInfo.client_id;
                                    conn.client_type = clientInfo.client_type;
                                    this.wsClients.push(conn);
                                    Logger.info(`[OneBotServer] 客户端 ${clientInfo.client_id} 已注册，类型：${clientInfo.client_type}`);
                                    return;
                                } else Logger.debug(`${clientInfo.client_id} 不匹配 ${msg.self_id}`);
                            }
                            Logger.warn(`${msg.self_id} 已连接，但是该客户端不在 clients.yaml 中，断开当前连接`);
                            ws.close(1000, 'Client not found in clients.yaml');
                            return;
                        }
                        // else if (msg.action === 'get_login_info'){
                        //     ws.send(JSON.stringify({
                        //         "retcode": 0,
                        //         "data": {
                        //             "user_id": "chathub",
                        //             "nickname": "Chathub",
                        //         },
                        //         "echo": msg.echo || "0",
                        //     })
                        // );
                        // }
                        // else if (msg.action === 'get_guild_service_profile'){
                        //
                        // }
                    } else if (msg.self_id) { // 通过判断 self_id 是否存在来区分是否为用户发的消息
                        if (client_id === null) {
                            Logger.warn(`收到消息，但未验证连接，消息不予处理：${JSON.stringify(msg)}`);
                            return;
                        }
                        /**
                         * 处理接收消息的逻辑
                         * 不予转发来源不是chathub或不是qq_active_group的消息
                         */
                        if (!(msg.group_id === config.qq_active_group || msg.group_id === 'chathub')) return;

                        const data = msg.message

                        this.broadcast(msg.sender.user_id, msg.sender.nickname, data, conn);
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
    public broadcast(sender_id:string,sender_name:string,messages:any[], conn: IOneBotConnection): void {
        this.wsClients.forEach(client => {
            if (client !== conn) { // 避免向当前连接发送消息
                const payload = {
                    "action": "send_group_msg",
                    "params": {
                        "group_id": config.qq_active_group,
                        "message": MessageFilter.filterMessages(messages, <string>client.client_type),
                    },
                    "sender": {
                        "user_id": sender_id,
                        "nickname": sender_name
                    },
                    "echo": "0"
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
}