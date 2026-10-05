import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import {networkInterfaces} from "node:os";
import {timingSafeEqual} from "node:crypto";
import {Config} from "../config";
import {Platform, PlatformError} from "../core/Platform";
import {z, ZodError} from "zod";
import {OneBotAdapter} from "../plugins/OneBotAdapter";
import {PluginError} from "../plugins/PluginError";
import {PluginControls} from "../plugins/PluginControls";
import {OneBotTraffic} from "./onebot/Traffic";
import {ApplicationConnection} from "./onebot/Gateway";
import {PlatformSettings, publicUrlSchema} from "../storage/PlatformSettings";
import {ImageStore, ONEBOT_MAX_PAYLOAD} from "../storage/ImageStore";
import {OneBotApi} from "./onebot/Api";

export interface ConnectionStats { forward: number; reverse: number; applications?: ApplicationConnection[]; }

/** Dashboard and narrowly scoped OneBot adapter management. Snapshots never return credentials;
 * the explicit connection-details endpoints reveal only the gateway token and the MCDR node
 * password to authenticated admins.
 * Never returns configuration files or shares authentication with native nodes / OneBot apps.
 */
export class Dashboard {
    private readonly startedAt = Date.now();
    private readonly staticDirectory = fs.existsSync(path.resolve(__dirname, "../web/index.html"))
        ? path.resolve(__dirname, "../web") : path.resolve(__dirname, "../../../web");

    constructor(private readonly config: Config, private readonly platform: Platform,
        private readonly connections: () => ConnectionStats, private readonly adapters: OneBotAdapter,
        private readonly plugins: PluginControls, private readonly onebotTraffic: OneBotTraffic,
        private readonly settings: PlatformSettings, private readonly images: ImageStore,
        private readonly onebotApi: OneBotApi) {}

    async handle(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
        response.setHeader("X-Content-Type-Options", "nosniff");
        response.setHeader("Referrer-Policy", "no-referrer");
        response.setHeader("X-Frame-Options", "DENY");
        let url: URL;
        try { url = new URL(request.url ?? "/", "http://localhost"); }
        catch { this.json(response, 400, {error: "Bad request"}); return; }
        if (url.pathname.startsWith("/media/images/")) {
            if (request.method !== "GET" && request.method !== "HEAD") { this.json(response, 405, {error: "Use GET or HEAD"}); return; }
            const image = await this.images.read(url.pathname.slice("/media/images/".length));
            if (!image) { this.json(response, 404, {error: "图片不存在或已过期。"}); return; }
            response.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
            response.setHeader("Cache-Control", "public, max-age=3600");
            response.writeHead(200, {"Content-Type": image.type, "Content-Length": image.bytes.length});
            response.end(request.method === "HEAD" ? undefined : image.bytes);
            return;
        }
        if (url.pathname === "/api/settings") {
            if (!this.authorize(request, response)) return;
            await this.manageSettings(request, response);
            return;
        }
        if (url.pathname === "/api/chat/messages") {
            if (!this.authorize(request, response)) return;
            await this.sendChatMessage(request, response);
            return;
        }
        if (url.pathname === "/api/plugins/onebot/clients" || url.pathname.startsWith("/api/plugins/onebot/clients/")) {
            if (!this.authorize(request, response)) return;
            await this.manageAdapters(request, response, url.pathname);
            return;
        }
        const pluginState = /^\/api\/plugins\/([^/]+)\/state$/.exec(url.pathname);
        if (pluginState) {
            if (!this.authorize(request, response)) return;
            await this.managePluginState(request, response, pluginState[1]);
            return;
        }
        const pluginConfig = /^\/api\/plugins\/([^/]+)\/config$/.exec(url.pathname);
        if (pluginConfig) {
            if (!this.authorize(request, response)) return;
            await this.managePluginConfiguration(request, response, pluginConfig[1]);
            return;
        }
        if (request.method !== "GET") { this.json(response, 405, {error: "Read-only dashboard"}); return; }
        const traceRoute = /^\/api\/traces\/([0-9a-f-]{36})$/.exec(url.pathname);
        if (traceRoute) {
            if (!this.authorize(request, response)) return;
            const trace = this.platform.traces.get(traceRoute[1]);
            this.json(response, trace ? 200 : 404, trace ?? {error: "链路不存在或已过期。"});
            return;
        }
        if (url.pathname === "/api/onebot/connection") {
            if (!this.authorize(request, response)) return;
            const port = request.socket.localPort ?? this.config.port;
            const publicOrigin = this.settings.snapshot().public_url;
            const publicGateway = this.config.onebot_public_url ??
                (publicOrigin ? publicOrigin.replace(/^http/, "ws") + "/onebot/v11" : undefined);
            this.json(response, 200, {
                self_id: this.platform.botId, system_user_id: this.platform.systemId,
                access_token: this.config.onebot_token, path: "/onebot/v11",
                ...(publicGateway ? {public_url: publicGateway} : {}),
                direct_urls: this.connectionUrls("/onebot/v11", port),
            });
            return;
        }
        if (url.pathname === "/api/native/connection") {
            if (!this.authorize(request, response)) return;
            const port = request.socket.localPort ?? this.config.port;
            this.json(response, 200, {
                access_token: this.config.node_password, path: "/chathub/v2/connect",
                direct_urls: this.connectionUrls("/chathub/v2/connect", port),
            });
            return;
        }
        if (url.pathname === "/api/plugins") {
            if (!this.authorize(request, response)) return;
            this.json(response, 200, {plugins: this.plugins.snapshot()});
            return;
        }
        if (url.pathname === "/api/dashboard") {
            response.setHeader("Cache-Control", "no-store");
            if (!this.authorize(request, response)) return;
            const groups = this.onebotApi.listGroups();
            const online = new Set(groups.flatMap(group => [...group.members.values()]
                .filter(member => member.online).map(member => member.userId)));
            const pluginStates = this.plugins.states();
            const plugins = this.plugins.snapshot();
            const relay = plugins.find(plugin => plugin.id === "relay")!.configuration.values;
            const traceView = url.searchParams.get("trace_view") === "1";
            const {forward, reverse, applications = []} = this.connections();
            this.json(response, 200, {
                version: "2.0.0", now: Date.now(), startedAt: this.startedAt,
                uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
                stats: {groups: groups.length, onlinePlayers: online.size, messages: this.platform.messageCount,
                    onebot: {forward, reverse}},
                onebotApplications: applications,
                groups: groups.map(group => ({id: group.id, nodeId: group.nodeId, name: group.name,
                    kind: group.kind, externalGroupId: group.externalGroupId, botId: group.botId,
                    identityScope: group.identityScope, members: [...group.members.values()],
                    systemLastSentTime: group.systemLastSentTime})),
                messages: traceView && url.searchParams.get("chat_view") !== "1" ? [] : this.platform.recentMessages(url.searchParams.get("chat_view") === "1" ? 1000 : 150).map(message => ({...message,
                    groupName: groups.find(group => group.id === message.groupId)?.name ?? `群 #${message.groupId}`})),
                logs: this.platform.recentLogs(),
                onebotTraffic: traceView ? [] : this.onebotTraffic.recent(),
                traces: this.platform.traces.recent(),
                relay: {enabled: pluginStates.relay, nodes: relay.nodes,
                    blacklist: relay.blacklist, includeSystem: relay.include_system}, // Legacy projection.
                onebotAdapters: {clients: this.adapters.list()},
                pluginStates, plugins,
                settings: this.settings.snapshot(),
                endpoints: {native: "/chathub/v2/connect", onebot: "/onebot/v11"},
                memoryBytes: process.memoryUsage().rss,
            });
            return;
        }
        const assets: Record<string, [string, string]> = {
            "/": ["index.html", "text/html; charset=utf-8"],
            "/index.html": ["index.html", "text/html; charset=utf-8"],
            "/assets/styles.css": ["styles.css", "text/css; charset=utf-8"],
            "/assets/app.js": ["app.js", "text/javascript; charset=utf-8"],
            "/assets/chat.js": ["chat.js", "text/javascript; charset=utf-8"],
            "/assets/chat.css": ["chat.css", "text/css; charset=utf-8"],
            "/assets/logo.svg": ["logo.svg", "image/svg+xml"],
        };
        // Explicit SPA entry routes only: refreshing a deep link must work,
        // without turning unknown APIs or arbitrary filesystem paths into HTML.
        const pageRoute = ["/chat", "/nodes", "/messages", "/logs", "/plugins", "/settings", "/guide"]
            .includes(url.pathname.replace(/\/$/, ""));
        const asset = pageRoute ? assets["/"] : assets[url.pathname];
        if (!asset) { this.json(response, 404, {error: "Not found"}); return; }
        try {
            const content = fs.readFileSync(path.join(this.staticDirectory, asset[0]));
            response.setHeader("Content-Security-Policy",
                "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
            response.setHeader("Cache-Control", "no-cache");
            response.writeHead(200, {"Content-Type": asset[1]}); response.end(content);
        } catch {
            this.json(response, 503, {error: "Dashboard assets missing; run npm run build"});
        }
    }

    private async sendChatMessage(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
        if (request.method !== "POST") { this.json(response, 405, {error: "Use POST to send a group message"}); return; }
        if (request.headers["content-type"]?.split(";")[0].trim() !== "application/json") {
            this.json(response, 415, {error: "Use application/json"}); return;
        }
        let groupId: number | undefined;
        try {
            const input = z.object({group_id: z.number().int().positive().safe(), text: z.string().max(8000).default(""),
                image: z.string().startsWith("base64://").max(7 * 1024 * 1024).optional()}).strict()
                .refine(value => !!value.text.trim() || !!value.image, "Empty message")
                .parse(await this.readJson(request, ONEBOT_MAX_PAYLOAD));
            groupId = input.group_id;
            const segments: Array<{type: string; data: Record<string, string>}> = [];
            if (input.text.trim()) segments.push({type: "text", data: {text: input.text}});
            if (input.image) segments.push({type: "image", data: {file: input.image}});
            const traceId = this.platform.traces.start("application", input.text.slice(0, 800) || "[图片]",
                {kind: "source", label: "网页群聊", groupId}, {groupId, segments});
            this.platform.traces.add(traceId, "1", {kind: "core", label: "ChatHub Core"}, "accepted");
            const result = await this.onebotApi.sendGroupMessage(groupId, segments, false, {traceId});
            this.json(response, 201, {message: result.message});
        } catch (error) {
            const reason = error instanceof Error ? error.message : "消息发送失败。";
            this.json(response, error instanceof PluginError ? error.status : error instanceof ZodError ? 400
                : error instanceof PlatformError ? 400 : 502,
                {error: error instanceof ZodError ? "消息无效：请选择虚拟群，输入最多 8000 字或附加一张图片，不允许其他字段。" : reason});
        }
    }

    private authorize(request: http.IncomingMessage, response: http.ServerResponse): boolean {
        response.setHeader("Cache-Control", "no-store");
        if (!this.config.dashboard_token) {
            this.json(response, 503, {error: "Configure dashboard_token or CHATHUB_DASHBOARD_TOKEN"}); return false;
        }
        const value = request.headers.authorization?.replace(/^Bearer /, "");
        const expected = Buffer.from(this.config.dashboard_token), supplied = Buffer.from(value ?? "");
        if (!request.headers.authorization?.startsWith("Bearer ") || supplied.length !== expected.length ||
            !timingSafeEqual(supplied, expected)) {
            this.json(response, 401, {error: "Invalid dashboard token"}); return false;
        }
        return true;
    }

    private connectionUrls(pathname: string, port: number): Array<{name: string; url: string}> {
        const wildcard = ["0.0.0.0", "::"].includes(this.config.host);
        const addresses = wildcard ? Object.entries(networkInterfaces()).flatMap(([name, entries]) =>
            /^(docker|br-|veth)/.test(name) ? [] : (entries ?? [])
                .filter(entry => entry.family === "IPv4" && !entry.internal &&
                    /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(entry.address))
                .map(entry => ({name, address: entry.address})))
            : [{name: "监听地址", address: this.config.host}];
        return addresses.map(({name, address}) => ({name,
            url: `ws://${address.includes(":") ? `[${address}]` : address}:${port}${pathname}`}));
    }

    private async managePluginState(request: http.IncomingMessage, response: http.ServerResponse, id: string): Promise<void> {
        if (!this.plugins.has(id)) { this.json(response, 404, {error: "插件不存在。"}); return; }
        if (request.method !== "PUT") { this.json(response, 405, {error: "Use PUT to set plugin state"}); return; }
        if (request.headers["content-type"]?.split(";")[0].trim() !== "application/json") {
            this.json(response, 415, {error: "Use application/json"}); return;
        }
        try {
            const input = z.object({enabled: z.boolean()}).strict().parse(await this.readJson(request));
            this.plugins.setEnabled(id, input.enabled);
            this.json(response, 200, {plugin: {id, enabled: this.plugins.states()[id]}});
        } catch (error) {
            this.json(response, error instanceof PluginError ? error.status : error instanceof ZodError ? 400 : 500,
                {error: error instanceof PluginError ? error.message : error instanceof ZodError
                    ? "输入无效：enabled 必须为布尔值，且不允许其他配置项。" : "插件开关操作失败。"});
        }
    }

    private async manageSettings(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
        if (request.method === "GET") { this.json(response, 200, {settings: this.settings.snapshot()}); return; }
        if (request.method !== "PUT") { this.json(response, 405, {error: "Use PUT to save platform settings"}); return; }
        if (request.headers["content-type"]?.split(";")[0].trim() !== "application/json") {
            this.json(response, 415, {error: "Use application/json"}); return;
        }
        try {
            const input = z.object({public_url: publicUrlSchema, revision: z.string().min(1).max(100)}).strict()
                .parse(await this.readJson(request));
            this.settings.save(input.public_url, input.revision);
            this.json(response, 200, {settings: this.settings.snapshot()});
        } catch (error) {
            const status = error instanceof PluginError ? error.status : error instanceof ZodError ? 400 : 500;
            this.json(response, status, {error: error instanceof PluginError ? error.message : error instanceof ZodError
                ? "设置无效：公网地址须为 HTTP(S) 地址，不含路径、账号密码、查询参数或片段。" : "平台设置保存失败。",
                ...(status === 409 ? {settings: this.settings.snapshot()} : {})});
        }
    }

    private async managePluginConfiguration(request: http.IncomingMessage, response: http.ServerResponse, id: string): Promise<void> {
        if (!this.plugins.has(id)) { this.json(response, 404, {error: "插件不存在。"}); return; }
        if (request.method === "GET") { this.json(response, 200, {plugin: this.plugins.configuration(id)}); return; }
        if (request.method !== "PUT") { this.json(response, 405, {error: "Use PUT to save plugin configuration"}); return; }
        if (!this.plugins.configuration(id).configuration.editable) {
            this.json(response, 405, {error: "此插件未声明可编辑配置，请使用其专用管理表单。"}); return;
        }
        if (request.headers["content-type"]?.split(";")[0].trim() !== "application/json") {
            this.json(response, 415, {error: "Use application/json"}); return;
        }
        try {
            const input = z.object({schemaVersion: z.number().int().positive(), revision: z.string().min(1).max(100),
                values: z.unknown()}).strict().parse(await this.readJson(request));
            this.plugins.setConfiguration(id, input.schemaVersion, input.revision, input.values);
            this.json(response, 200, {plugin: this.plugins.configuration(id)});
        } catch (error) {
            const status = error instanceof PluginError ? error.status : error instanceof ZodError ? 400 : 500;
            const fields = this.plugins.configuration(id).configuration.fields;
            const fieldErrors: Record<string, string> = {};
            if (error instanceof ZodError) for (const issue of error.issues) {
                const key = String(issue.path[0]);
                const field = fields.find(candidate => candidate.key === key);
                if (field) fieldErrors[key] = `${field.label}无效，请检查类型、允许值和范围。`;
            }
            this.json(response, status, {error: error instanceof PluginError ? error.message
                : error instanceof ZodError ? "配置无效：请检查字段类型、允许值和范围，不允许修改未声明的配置项。" : "配置保存失败。",
                fieldErrors, ...(status === 409 ? {plugin: this.plugins.configuration(id)} : {})});
        }
    }

    private async manageAdapters(request: http.IncomingMessage, response: http.ServerResponse, pathname: string): Promise<void> {
        try {
            if (pathname === "/api/plugins/onebot/clients" && request.method === "POST") {
                if (request.headers["content-type"]?.split(";")[0].trim() !== "application/json") {
                    this.json(response, 415, {error: "Use application/json"}); return;
                }
                const input = await this.readJson(request);
                this.json(response, 201, {client: this.adapters.add(input)});
            } else if (request.method === "DELETE" && /^\/api\/plugins\/onebot\/clients\/[0-9a-f-]{36}$/.test(pathname)) {
                const id = pathname.split("/").pop()!;
                if (!this.adapters.remove(id)) { this.json(response, 404, {error: "客户端不存在。"}); return; }
                this.json(response, 200, {ok: true});
            } else this.json(response, 405, {error: "Only client creation and removal are supported"});
        } catch (error) {
            this.json(response, error instanceof PluginError ? error.status : error instanceof ZodError ? 400 : 500,
                {error: error instanceof PluginError ? error.message : error instanceof ZodError
                    ? "输入无效：请填写 ws/wss 地址（不含查询参数或凭证）、正整数群号及有效 Token。" : "适配器操作失败。"});
        }
    }

    private readJson(request: http.IncomingMessage, maximum = 8192): Promise<unknown> {
        return new Promise((resolve, reject) => {
            const chunks: Buffer[] = [];
            let size = 0;
            const cleanup = (): void => {
                clearTimeout(timer);
                request.off("data", onData); request.off("end", onEnd);
                request.off("aborted", onAbort); request.off("error", onAbort);
            };
            const fail = (error: Error): void => { cleanup(); request.resume(); reject(error); };
            const onData = (chunk: Buffer): void => {
                size += chunk.length;
                if (size > maximum) { fail(new PluginError("请求内容过大。", 413)); return; }
                chunks.push(chunk);
            };
            const onEnd = (): void => {
                cleanup();
                try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
                catch { reject(new PluginError("JSON 格式无效。", 400)); }
            };
            const onAbort = (): void => fail(new PluginError("请求已中断。", 400));
            const timer = setTimeout(() => fail(new PluginError("请求超时。", 408)), 8000);
            request.on("data", onData); request.once("end", onEnd);
            request.once("aborted", onAbort); request.once("error", onAbort);
        });
    }

    private json(response: http.ServerResponse, status: number, data: unknown): void {
        response.writeHead(status, {"Content-Type": "application/json; charset=utf-8"});
        response.end(JSON.stringify(data));
    }
}
