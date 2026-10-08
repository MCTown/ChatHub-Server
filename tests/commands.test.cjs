const {test} = require('node:test');
const assert = require('node:assert/strict');
const {Platform} = require('../server/dist/core/Platform');
const {IdentityStore} = require('../server/dist/storage/IdentityStore');
const {PluginHost} = require('../server/dist/plugins/PluginHost');
const {installCrossServerRelay} = require('../server/dist/plugins/CrossServerRelay');
const {OneBotApi} = require('../server/dist/adapters/onebot/Api');
const {PluginRegistry, definePlugin} = require('../server/dist/plugins/PluginRegistry');
const {PluginControls} = require('../server/dist/plugins/PluginControls');
const {z} = require('zod');

const player = {uuid: '8667ba71-b85a-4004-af54-457a9734eed7', name: 'Steve'};
const text = value => [{type: 'text', text: value}];
const settle = () => new Promise(resolve => setImmediate(resolve));
function fixture(kind = 'minecraft') {
    const platform = new Platform(new IdentityStore());
    const deliveries = [], events = [];
    const group = platform.attach('source', 'Source', 'test', [],
        {deliver: async delivery => deliveries.push(delivery)}, {kind});
    platform.subscribe(event => events.push(event));
    return {platform, group, deliveries, events};
}

test('prefix-free help lists commands and replies only to the originating client', async () => {
    const {platform, group, deliveries, events} = fixture();
    const other = [];
    platform.attach('other', 'Other', 'test', [], {deliver: async delivery => other.push(delivery)});
    const uninstall = installCrossServerRelay(platform, {enabled: true});
    const host = new PluginHost(platform);
    host.use({name: 'example', commands: [{name: 'echo', usage: '<text>', description: '回显文本',
        execute: async context => {await context.reply(context.rawArgs);}}], install: () => () => {}});
    const message = platform.ingest(group.id, player, text('  HELP  '));
    await settle();
    assert.match(deliveries[0].segments[0].text, /help — 显示所有可用指令/);
    assert.match(deliveries[0].segments[0].text, /online — 显示每个服务器的在线人数和玩家名单/);
    assert.match(deliveries[0].segments[0].text, /echo <text> — 回显文本/);
    assert.equal(deliveries[0].authorName, 'ChatHub');
    assert.equal(platform.message(deliveries[0].messageId).sourceMessageId, message.id);
    assert.deepEqual(events, []);
    assert.deepEqual(other, []);
    host.close(); uninstall();
});

test('plugins receive identity, arguments and segmented replies; replies do not execute again', async () => {
    const {platform, group, deliveries} = fixture('onebot');
    const host = new PluginHost(platform);
    let called = 0;
    host.use({name: 'example', commands: [{name: 'echo', description: 'Echo', execute: async context => {
        called++;
        assert.equal(context.message.groupId, group.id);
        assert.equal(context.message.authorId, platform.participantId(group.id, {externalId: '42', name: 'QQ'}));
        assert.deepEqual(context.args, ['hello', 'world']);
        assert.equal(context.rawArgs, 'hello  world');
        await context.reply(text('echo hello  world'));
    }}], install: () => () => {}});
    platform.ingest(group.id, {externalId: '42', name: 'QQ'},
        [{type: 'text', text: 'echo hello'}, {type: 'text', text: '  world'}]);
    await settle();
    assert.equal(called, 1);
    assert.equal(deliveries.length, 1);
    host.close();
});

test('online uses the command bus to list every game server, including empty servers, but not QQ members', async () => {
    const {platform, group, deliveries, events} = fixture('onebot');
    platform.syncOnlinePlayers(group.id, [{externalId: '42', name: 'QQ member'}]);
    const otherDeliveries = [];
    const transport = {deliver: async delivery => otherDeliveries.push(delivery)};
    const mc = platform.attach('survival', '生存服', 'mc', [], transport);
    const tr = platform.attach('terraria', '泰拉瑞亚', 'tr', [], transport);
    const empty = platform.attach('empty', '空服', 'mc', [], transport);
    const alex = {uuid: 'ec561538-f3fd-461d-aff5-086b22154bce', name: 'Alex'};
    const character = {uuid: '9d155751642748ce92fa10444c93032b', name: '小明 One'};
    platform.syncOnlinePlayers(mc.id, [player, alex]);
    platform.syncOnlinePlayers(tr.id, [character]);
    platform.presence(mc.id, alex, false);
    platform.ingest(mc.id, alex, text('queued chat does not imply online'));
    events.length = 0;
    const uninstall = installCrossServerRelay(platform, {enabled: true});
    const command = platform.ingest(group.id, {externalId: '42', name: 'QQ member'}, text('online'));
    await settle();
    const output = deliveries[0].segments[0].text;
    assert.match(output, /生存服 \(survival\) — 1 人在线：Steve/);
    assert.match(output, /泰拉瑞亚 \(terraria\) — 1 人在线：小明 One/);
    assert.match(output, /空服 \(empty\) — 0 人在线：暂无在线玩家/);
    assert.equal(output.includes('Alex'), false);
    assert.equal(output.includes('QQ member'), false);
    assert.equal(output.includes('Source'), false);
    assert.equal(platform.message(deliveries[0].messageId).sourceMessageId, command.id);
    assert.deepEqual(otherDeliveries, []);
    assert.deepEqual(events, []);
    platform.syncOnlinePlayers(mc.id, []);
    platform.detach(tr.id, transport);
    platform.ingest(group.id, {externalId: '42', name: 'QQ member'}, text('online'));
    await settle();
    assert.match(deliveries[1].segments[0].text, /生存服 \(survival\) — 0 人在线/);
    assert.equal(deliveries[1].segments[0].text.includes('泰拉瑞亚'), false);
    uninstall();
});

test('online reports no game servers and cannot be disabled or replaced by plugins', async () => {
    const {platform, group, deliveries} = fixture('onebot');
    platform.commands.setEnabled('core', false);
    assert.throws(() => platform.commands.register('example', {name: 'online', description: 'Override', execute: () => {}}),
        /already registered/);
    await new OneBotApi(platform).sendGroupMessage(group.id, 'ONLINE');
    await settle();
    assert.equal(deliveries[0].segments[0].text, '当前没有已连接的游戏服务器。');
});

test('unknown, prefixed and mixed-segment messages remain ordinary chat', async () => {
    const {platform, group, deliveries, events} = fixture();
    for (const segments of [text('hello everyone'), text('/help'), text('helpful'),
        [{type: 'text', text: 'help'}, {type: 'image', url: 'https://example.org/a.png'}]]) {
        platform.ingest(group.id, player, segments);
    }
    platform.system(group.id, 'custom', 'help');
    await settle();
    assert.equal(events.length, 5);
    assert.deepEqual(deliveries, []);
});

test('plugin disable, re-enable and uninstall update help and dispatch', async () => {
    const {platform, group, deliveries, events} = fixture();
    const host = new PluginHost(platform);
    host.use({name: 'example', commands: [{name: 'ping', description: 'Ping', execute: async c => {await c.reply('pong');}}],
        install: () => () => {}});
    platform.commands.setEnabled('example', false);
    assert.deepEqual(platform.commands.list().map(c => c.name), ['help', 'online']);
    platform.ingest(group.id, player, text('ping'));
    assert.equal(events.length, 1);
    platform.commands.setEnabled('example', true);
    platform.ingest(group.id, player, text('ping'));
    await settle();
    assert.equal(deliveries[0].segments[0].text, 'pong');
    host.remove('example');
    assert.deepEqual(platform.commands.list().map(c => c.name), ['help', 'online']);
});

test('duplicate commands reject installation and roll back partial registrations', () => {
    const {platform} = fixture();
    const host = new PluginHost(platform);
    const command = name => ({name, description: name, execute: () => {}});
    assert.throws(() => host.use({name: 'bad', commands: [command('ping'), command('help')],
        install: () => assert.fail('should not install')}), /already registered/);
    assert.deepEqual(platform.commands.list().map(c => c.name), ['help', 'online']);
    assert.throws(() => host.use({name: 'bad', commands: [command('ping')],
        install: () => {throw new Error('install failed');}}), /install failed/);
    assert.deepEqual(platform.commands.list().map(c => c.name), ['help', 'online']);
    assert.throws(() => platform.commands.register('bad', command('/ping')), /Invalid/);
});

test('managed plugin controls synchronize command availability across start, switches and close', () => {
    const {platform} = fixture();
    const registry = new PluginRegistry();
    registry.register(definePlugin({
        manifest: {id: 'example', name: 'Example', module: 'Example', version: '1.0.0', kind: 'business',
            icon: 'puzzle', description: 'Example', settingsPanel: 'example', settingsMode: 'readonly', help: 'Example', schemaVersion: 1},
        configSchema: z.object({enabled: z.boolean().default(false)}).strict(),
        create: () => ({name: 'example', commands: [{name: 'ping', description: 'Ping', execute: () => {}}],
            install: () => () => {}, setEnabled: () => {}}),
        publicConfig: () => ({}),
    }), {}, {deliveryTimeoutMs: 200});
    const controls = new PluginControls(platform, registry);
    controls.start();
    assert.equal(platform.commands.accepts(text('ping')), false);
    controls.setEnabled('example', true);
    assert.equal(platform.commands.accepts(text('ping')), true);
    controls.setEnabled('example', false);
    assert.equal(platform.commands.accepts(text('ping')), false);
    controls.close();
    assert.deepEqual(platform.commands.list().map(c => c.name), ['help', 'online']);
});

test('handler failures return a safe error and failed replies do not cause unhandled rejections', async t => {
    t.mock.method(console, 'error', () => {});
    const {platform, group, deliveries} = fixture();
    platform.commands.register('example', {name: 'fail', description: 'Fail', execute: () => {throw new Error('secret');}});
    platform.ingest(group.id, player, text('fail'));
    await settle();
    assert.match(deliveries[0].segments[0].text, /执行失败/);
    assert.equal(deliveries[0].segments[0].text.includes('secret'), false);
    const offline = platform.attach('failure', 'Failure', 'test', [], {deliver: async () => {throw new Error('offline');}});
    platform.ingest(offline.id, player, text('help'));
    await settle();
    assert.ok(platform.recentLogs().length > 0);
});

test('dashboard-style and OneBot API sends invoke commands without publishing application events', async () => {
    const {platform, group, deliveries, events} = fixture();
    await platform.send(group.id, text('help'));
    const result = await new OneBotApi(platform).sendGroupMessage(group.id, 'help');
    await settle();
    assert.equal(platform.message(result.message_id).segments[0].text, 'help');
    assert.equal(deliveries.length, 2);
    assert.ok(deliveries.every(d => d.segments[0].text.startsWith('ChatHub 指令：')));
    assert.deepEqual(events, []);
});
