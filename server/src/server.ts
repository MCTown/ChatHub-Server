import http from "node:http";
import path from "node:path";
import {timingSafeEqual} from "node:crypto";
import WebSocket, {WebSocketServer} from "ws";
import {Config} from "./config";
import {Platform} from "./core/Platform";
import {attachNative} from "./adapters/native";
import {connectionRole, OneBotGateway, Role} from "./adapters/onebot/Gateway";
import {OneBotTraffic} from "./adapters/onebot/Traffic";
import {Dashboard} from "./adapters/dashboard";
import {OneBotAdapter} from "./plugins/OneBotAdapter";
import {PluginControls} from "./plugins/PluginControls";
import {createBuiltinRegistry, normalizePluginConfigurations} from "./plugins/builtins";
import {PlatformSettings} from "./storage/PlatformSettings";
import {ImageStore, ONEBOT_MAX_PAYLOAD} from "./storage/ImageStore";
import {OneBotApi} from "./adapters/onebot/Api";

function authenticated(request: http.IncomingMessage, url: URL, expected: string): boolean {
    const header = request.headers.authorization;
    const value = header?.startsWith("Bearer ") ? header.slice(7) : url.searchParams.get("access_token");
    if (!value) return false;
    const a = Buffer.from(value), b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
}

export class ChatHubServer {
    private readonly ws = new WebSocketServer({noServer: true, maxPayload: 256 * 1024});
    private readonly onebotWs = new WebSocketServer({noServer: true, maxPayload: ONEBOT_MAX_PAYLOAD});
    private readonly http = http.createServer((_request, response) => {
        void this.dashboard.handle(_request, response).catch(() => {
            if (!response.headersSent) { response.writeHead(500); response.end("Internal error"); }
        });
    });
    private readonly dashboard: Dashboard;
    private readonly forwardApplications = new Set<WebSocket>();
    private readonly gateway: OneBotGateway;
    private readonly onebotTraffic = new OneBotTraffic();
    private readonly adapters: OneBotAdapter;
    private readonly plugins: PluginControls;
    private readonly reverse = new Set<WebSocket>();
    private readonly retry = new Set<NodeJS.Timeout>();
    private stopping = false;
    private ping?: NodeJS.Timeout;

    constructor(private readonly config: Config, platform: Platform) {
        const configurations = normalizePluginConfigurations(config.plugins, {relay: config.relay,
            onebotClientsFile: config.onebot_adapter_file});
        this.plugins = new PluginControls(platform, createBuiltinRegistry(configurations,
            {deliveryTimeoutMs: config.delivery_timeout_ms}), config.plugin_state_file);
        this.adapters = this.plugins.instance("onebot");
        const settings = new PlatformSettings(config.settings_file, config.public_url);
        const images = new ImageStore(config.image_directory ?? path.resolve("data/images"), () => settings.snapshot().public_url);
        const onebotApi = new OneBotApi(platform, images);
        this.gateway = new OneBotGateway(platform, this.onebotTraffic, images, onebotApi);
        this.dashboard = new Dashboard(config, platform, () => ({forward: this.forwardApplications.size,
            reverse: [...this.reverse].filter(socket => socket.readyState === WebSocket.OPEN).length,
            applications: this.gateway.connections()}),
             this.adapters, this.plugins, this.onebotTraffic, settings, images, onebotApi);
        this.http.on("upgrade", (request, socket, head) => {
            let url: URL;
            try { url = new URL(request.url ?? "/", "http://localhost"); }
            catch {
                socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
                return;
            }
            const native = url.pathname === "/chathub/v2/connect";
            const role: Role | undefined = url.pathname === "/onebot/v11" || url.pathname === "/onebot/v11/"
                ? "Universal" : /^\/onebot\/v11\/api\/?$/.test(url.pathname)
                    ? "API" : /^\/onebot\/v11\/event\/?$/.test(url.pathname) ? "Event" : undefined;
            const reject = (status: string): void => {
                socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
            };
            if (this.stopping) { reject("503 Service Unavailable"); return; }
            if (!native && !role) { reject("404 Not Found"); return; }
            if (!authenticated(request, url, native ? config.node_password : config.onebot_token)) {
                reject("401 Unauthorized"); return;
            }
            (native ? this.ws : this.onebotWs).handleUpgrade(request, socket, head, connection => {
                connection.on("error", error => console.warn("WebSocket error:", error.message));
                if (native) attachNative(connection, platform, config.delivery_timeout_ms);
                else {
                    this.forwardApplications.add(connection);
                    connection.once("close", () => this.forwardApplications.delete(connection));
                    const host = request.socket.remoteAddress ?? "";
                    const address = host.includes(":") ? `[${host}]:${request.socket.remotePort}` : `${host}:${request.socket.remotePort}`;
                    this.gateway.attach(connection, role!, {direction: "forward", address});
                }
            });
        });
    }

    async start(): Promise<number> {
        await new Promise<void>((resolve, reject) => {
            this.http.once("error", reject);
            this.http.listen(this.config.port, this.config.host, () => {
                this.http.off("error", reject); resolve();
            });
        });
        this.http.on("error", error => console.error("HTTP server error", error));
        try { this.plugins.start(); }
        catch (error) {
            await new Promise<void>(resolve => this.http.close(() => resolve()));
            throw error;
        }
        // Dead connections must not retain phantom online groups forever.
        const awaitingPong = new Set<WebSocket>();
        const tracked = new WeakSet<WebSocket>();
        this.ping = setInterval(() => {
            for (const socket of [...this.ws.clients, ...this.onebotWs.clients, ...this.reverse]) {
                if (socket.readyState !== WebSocket.OPEN) continue;
                if (awaitingPong.has(socket)) { socket.terminate(); continue; }
                if (!tracked.has(socket)) {
                    tracked.add(socket);
                    socket.on("pong", () => awaitingPong.delete(socket));
                    socket.once("close", () => awaitingPong.delete(socket));
                }
                awaitingPong.add(socket);
                socket.ping();
            }
        }, 30000);
        for (const url of this.config.onebot_reverse_urls) this.connectReverse(url);
        const address = this.http.address();
        return typeof address === "object" && address ? address.port : this.config.port;
    }

    async stop(): Promise<void> {
        this.stopping = true;
        this.plugins.close();
        if (this.ping) clearInterval(this.ping);
        for (const timer of this.retry) clearTimeout(timer);
        for (const socket of this.reverse) socket.terminate();
        for (const socket of this.ws.clients) socket.terminate();
        for (const socket of this.onebotWs.clients) socket.terminate();
        await new Promise<void>(resolve => this.ws.close(() => resolve()));
        await new Promise<void>(resolve => this.onebotWs.close(() => resolve()));
        await new Promise<void>(resolve => this.http.close(() => resolve()));
    }

    private connectReverse(address: string): void {
        if (this.stopping) return;
        // Optional role parameter allows standard split API/Event connections.
        const url = new URL(address);
        const role = connectionRole(url.searchParams.get("role") ?? undefined);
        url.searchParams.delete("role");
        const socket = new WebSocket(url, {maxPayload: ONEBOT_MAX_PAYLOAD, handshakeTimeout: 10000, headers: {
            Authorization: `Bearer ${this.config.onebot_token}`,
            "X-Self-ID": "1", "X-Client-Role": role,
        }});
        this.reverse.add(socket);
        socket.on("open", () => this.gateway.attach(socket, role, {direction: "reverse", address}));
        socket.on("error", error => console.warn("OneBot reverse connection failed:", error.message));
        socket.on("close", () => {
            this.reverse.delete(socket);
            if (this.stopping) return;
            const timer = setTimeout(() => { this.retry.delete(timer); this.connectReverse(address); }, 5000);
            this.retry.add(timer);
        });
    }
}
