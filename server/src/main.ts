import {loadConfig} from "./config";
import {IdentityStore} from "./storage/IdentityStore";
import {Platform} from "./core/Platform";
import {ChatHubServer} from "./server";

async function main(): Promise<void> {
    const config = loadConfig(process.cwd());
    const platform = new Platform(new IdentityStore(config.identity_file));
    const server = new ChatHubServer(config, platform);
    const port = await server.start();
    console.log(`ChatHub: ws://${config.host}:${port}/chathub/v2/connect (MCDR)`);
    console.log(`OneBot V11: ws://${config.host}:${port}/onebot/v11 (applications)`);
    console.log(`Dashboard: http://${config.host}:${port}/`);
    let shuttingDown = false;
    const shutdown = (): void => {
        if (shuttingDown) return;
        shuttingDown = true;
        void server.stop().catch(error => { console.error(error); process.exitCode = 1; });
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
}

if (require.main === module) void main().catch(error => { console.error(error); process.exitCode = 1; });
