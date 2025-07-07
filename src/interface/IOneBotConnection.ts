// src/onebot.ts

import WebSocket from 'ws';

// src/onebot-server.interface.ts


/**
 * 表示一个客户端连接（即你的 Python 脚本连接）
 */
export interface IOneBotConnection {
    /** 向客户端发送一个 OneBot 格式的 JSON */
    send(payload: Record<string, any>): void;
}

/**
 * OneBot WS 服务端接口
 */
export interface IOneBotServer {
    /**
     * 启动服务，监听指定端口
     * @param port WebSocket 服务监听端口
     */
    start(port: number): void;

    /** 停止服务 */
    stop(): void;

}
