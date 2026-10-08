import type {Platform} from "./Platform";
import {ChatMessage, Segment} from "../domain/model";

export interface CommandContext {
    platform: Platform;
    message: ChatMessage;
    /** Whitespace-separated arguments; rawArgs preserves the original text. */
    args: string[];
    rawArgs: string;
    reply(content: string | Segment[]): Promise<ChatMessage>;
}

export interface CommandDefinition {
    /** Lowercase name, invoked directly without a prefix. */
    name: string;
    description: string;
    /** Optional argument synopsis, e.g. "<text>". */
    usage?: string;
    execute(context: CommandContext): void | Promise<void>;
}

/** Shared by all client adapters; command replies are deliveries, not incoming chat. */
export class CommandSystem {
    private readonly entries = new Map<string, {owner: string; definition: CommandDefinition}>();
    private readonly disabled = new Set<string>();

    constructor(private readonly platform: Platform) {
        this.register("core", {name: "help", description: "显示所有可用指令", execute: async context => {
            await context.reply(["ChatHub 指令：", ...this.list().map(command =>
                `${command.name}${command.usage ? " " + command.usage : ""} — ${command.description}`)].join("\n"));
        }});
        this.register("core", {name: "online", description: "显示每个服务器的在线人数和玩家名单", execute: async context => {
            const servers = context.platform.groups().filter(group => group.kind === "minecraft")
                .sort((a, b) => a.name.localeCompare(b.name) || a.nodeId.localeCompare(b.nodeId));
            if (!servers.length) {
                await context.reply("当前没有已连接的游戏服务器。");
                return;
            }
            const lines = servers.map(group => {
                const names = [...group.members.values()].filter(member => member.online)
                    .map(member => member.name).sort((a, b) => a.localeCompare(b));
                return `${group.name} (${group.nodeId}) — ${names.length} 人在线：${names.length ? names.join("、") : "暂无在线玩家"}`;
            });
            await context.reply(["服务器在线名单：", ...lines].join("\n"));
        }});
    }

    register(owner: string, definition: CommandDefinition): () => void {
        if (!owner || !/^[a-z][a-z0-9_-]*$/.test(definition.name) || !definition.description.trim() ||
            typeof definition.execute !== "function") throw new Error("Invalid command definition");
        if (this.entries.has(definition.name)) throw new Error(`Command already registered: ${definition.name}`);
        const entry = {owner, definition: {...definition}};
        this.entries.set(definition.name, entry);
        return () => { if (this.entries.get(definition.name) === entry) this.entries.delete(definition.name); };
    }

    setEnabled(owner: string, enabled: boolean): void {
        if (owner === "core") return;
        if (enabled) this.disabled.delete(owner); else this.disabled.add(owner);
    }

    list(): Array<{name: string; description: string; usage?: string; owner: string}> {
        return [...this.entries.values()].filter(entry => !this.disabled.has(entry.owner))
            .map(({owner, definition: {name, description, usage}}) => ({owner, name, description, usage}))
            .sort((a, b) => a.name.localeCompare(b.name));
    }

    private match(segments: Segment[]): RegExpExecArray | undefined {
        if (!segments.length || segments.some(segment => segment.type !== "text")) return undefined;
        const text = segments.map(segment => segment.type === "text" ? segment.text : "").join("").trim();
        const match = /^([a-z][a-z0-9_-]*)(?:\s+([\s\S]*))?$/i.exec(text);
        if (!match) return undefined;
        const entry = this.entries.get(match[1].toLowerCase());
        return entry && !this.disabled.has(entry.owner) ? match : undefined;
    }

    accepts(segments: Segment[]): boolean { return this.match(segments) !== undefined; }

    /** Returns synchronously so no command can leak into relay subscriptions. */
    dispatch(message: ChatMessage): boolean {
        const match = this.match(message.segments);
        if (!match) return false;
        const entry = this.entries.get(match[1].toLowerCase())!;
        const reply = (content: string | Segment[]) => this.platform.send(message.groupId,
            typeof content === "string" ? [{type: "text", text: content}] : content, message,
            {pluginName: entry?.owner ?? "commands", authorName: "ChatHub"});
        const run = async (): Promise<void> => {
            const rawArgs = match[2]?.trim() ?? "";
            try {
                await entry.definition.execute({platform: this.platform, message: structuredClone(message),
                    rawArgs, args: rawArgs ? rawArgs.split(/\s+/) : [], reply});
            } catch (error) {
                console.error(`Command ${entry.definition.name} failed`, error);
                await reply(`指令 ${entry.definition.name} 执行失败，请联系管理员。`);
            }
        };
        void run().catch(error => console.error("Command reply failed", error));
        return true;
    }
}
