// Optional real tModLoader server smoke test. No live ChatHub/game servers touched.
// TML_PATH=/path/to/tModLoader CHATHUB_TMOD=/path/to/ChatHub.tmod node tmod/tests/runtime-smoke.cjs
const assert = require('node:assert/strict');
const {spawn} = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const {ChatHubServer} = require('../../server/dist/server');
const {Platform} = require('../../server/dist/core/Platform');
const {IdentityStore} = require('../../server/dist/storage/IdentityStore');

async function main() {
    const tml = process.env.TML_PATH;
    const mod = process.env.CHATHUB_TMOD;
    assert.ok(tml && mod, 'Set TML_PATH and CHATHUB_TMOD');
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'chathub-tmod-smoke-'));
    fs.mkdirSync(path.join(directory, 'Mods'));
    fs.mkdirSync(path.join(directory, 'ModConfigs'));
    fs.copyFileSync(mod, path.join(directory, 'Mods/ChatHub.tmod'));
    fs.writeFileSync(path.join(directory, 'Mods/enabled.json'), JSON.stringify(['ChatHub']));
    const platform = new Platform(new IdentityStore());
    const hub = new ChatHubServer({host: '127.0.0.1', port: 0, node_password: 'smoke-only', onebot_token: 'smoke-app',
        identity_file: '', delivery_timeout_ms: 5000, onebot_reverse_urls: [], relay: {enabled: false, nodes: []}}, platform);
    const port = await hub.start();
    fs.writeFileSync(path.join(directory, 'ModConfigs/ChatHub.json'), JSON.stringify({Enabled: true,
        ServerUrl: `ws://127.0.0.1:${port}/chathub/v2/connect`, Password: 'smoke-only', NodeId: 'terraria-smoke',
        Name: '泰拉瑞亚测试', IdentityScope: 'terraria:characters:smoke'}));
    const allocator = net.createServer();
    await new Promise(resolve => allocator.listen(0, '127.0.0.1', resolve));
    const gamePort = allocator.address().port;
    await new Promise(resolve => allocator.close(resolve));
    fs.writeFileSync(path.join(directory, 'serverconfig.txt'), `world=${directory}/smoke.wld\nautocreate=1\nworldname=ChatHubSmoke\nmaxplayers=2\nport=${gamePort}\n`);
    const child = spawn(process.env.DOTNET ?? 'dotnet', ['tModLoader.dll', '-server', '-nosteam', '-ip', '127.0.0.1',
        '-tmlsavedirectory', directory, '-config', path.join(directory, 'serverconfig.txt')], {cwd: tml, stdio: ['pipe', 'pipe', 'pipe']});
    const log = fs.createWriteStream(path.join(directory, 'console.log'));
    child.stdout.pipe(log, {end: false});
    child.stderr.pipe(log, {end: false});
    let exited = false;
    let failure;
    child.on('exit', code => {exited = true; failure = new Error(`tModLoader exited (${code}); see ${directory}/console.log`);});
    child.on('error', error => {exited = true; failure = error;});
    try {
        const until = Date.now() + 150000;
        while (!platform.groups().length) {
            if (exited) throw failure;
            if (Date.now() > until) throw new Error(`tModLoader registration timed out; see ${directory}/console.log`);
            await new Promise(resolve => setTimeout(resolve, 200));
        }
        const group = platform.groups()[0];
        assert.equal(group.nodeId, 'terraria-smoke');
        // ACK is issued on the Terraria game thread, not merely the socket reader.
        await platform.send(group.id, [{type: 'text', text: 'ChatHub 真实服务器投递测试 [i:1]'},
            {type: 'mention', userId: 'all'}, {type: 'image', url: 'https://example.com/a.png'}]);
        await new Promise(resolve => setTimeout(resolve, 6500));
        assert.equal(platform.groups().length, 1, 'Periodic empty roster queries keep the server registered');
        assert.equal(platform.group(group.id).members.size, 0);
        console.log('PASS real tModLoader: mod load/hooks, world load, auth/register, online API polling, game-thread broadcast/ACK');
        console.log(`Smoke log: ${directory}/console.log`);
    } finally {
        if (!exited) {
            child.stdin.write('exit-nosave\n');
            await Promise.race([new Promise(resolve => child.once('exit', resolve)), new Promise(resolve => setTimeout(resolve, 5000))]);
            if (!exited) child.kill('SIGTERM');
        }
        log.end();
        await hub.stop();
    }
}
main().catch(error => {console.error(error); process.exitCode = 1;});
