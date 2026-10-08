const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {IdentityStore} = require('../server/dist/storage/IdentityStore');
const {Platform} = require('../server/dist/core/Platform');
const {installCrossServerRelay} = require('../server/dist/plugins/CrossServerRelay');
const {PluginHost} = require('../server/dist/plugins/PluginHost');
const {loadConfig} = require('../server/dist/config');
const {fromV11, toV11, cqString} = require('../server/dist/adapters/onebot/codec');

const steve = {uuid: '8667ba71-b85a-4004-af54-457a9734eed7', name: 'Steve'};

test('stable numeric identities survive restart without storing registrations', t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'chathub-identities-'));
    t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
    const file = path.join(directory, 'identity.json');
    const store = new IdentityStore(file);
    const user = store.user('online', steve.uuid);
    const group = store.group('survival');
    const restored = new IdentityStore(file);
    assert.equal(restored.user('online', steve.uuid.replaceAll('-', '').toUpperCase()), user);
    assert.equal(restored.group('survival'), group);
    assert.notEqual(restored.user('offline:realm', steve.uuid), user);
    const persisted = JSON.parse(fs.readFileSync(file));
    assert.deepEqual(Object.keys(persisted).sort(), ['version', 'users', 'groups', 'nextUserId', 'nextGroupId'].sort());
    assert.equal(Number.isSafeInteger(user), true);
    assert.equal(Number.isSafeInteger(group), true);
});

test('corrupt identity files fail instead of silently reallocating IDs', t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'chathub-corrupt-'));
    t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
    const file = path.join(directory, 'identity.json');
    fs.writeFileSync(file, '{bad');
    assert.throws(() => new IdentityStore(file));
    fs.writeFileSync(file, JSON.stringify({version: 1, nextUserId: 10001, nextGroupId: 10000,
        users: {a: 10000, b: 10000}, groups: {}}));
    assert.throws(() => new IdentityStore(file), /duplicate/);
});

test('core treats nodes as groups, shared UUIDs as users, presence separately', async () => {
    const platform = new Platform(new IdentityStore());
    const events = [];
    platform.subscribe(event => events.push(event));
    const received = [];
    const transport = {deliver: async message => {received.push(message);}};
    const a = platform.attach('a', 'A', 'online', [steve], transport);
    const b = platform.attach('b', 'B', 'online', [steve], {deliver: async () => {}});
    assert.equal([...a.members.keys()][0], [...b.members.keys()][0]);
    assert.throws(() => platform.attach('a', 'duplicate', 'online', [], transport), /already connected/);
    const segments = [{type: 'text', text: 'hello'}];
    const message = platform.ingest(a.id, steve, segments);
    segments[0].text = 'mutated';
    assert.equal(message.segments[0].text, 'hello');
    platform.presence(a.id, steve, false);
    assert.equal(platform.member(a.id, message.authorId).online, false);
    await platform.send(a.id, [{type: 'text', text: 'outgoing'}]);
    assert.deepEqual(events.map(event => event.type), ['message', 'presence']);
    assert.equal(received.length, 1);
    platform.detach(a.id, {deliver: async () => {}});
    assert.equal(platform.groups().length, 2);
    platform.detach(a.id, transport);
    assert.equal(platform.groups().length, 1);
    await assert.rejects(platform.send(a.id, [{type: 'text', text: 'offline'}]), /offline/);
});

test('only explicitly identified OneBot API sends publish application events', async () => {
    const platform = new Platform(new IdentityStore());
    const events = [];
    const group = platform.attach('api', 'API', 'online', [], {deliver: async () => {}});
    platform.subscribe(event => events.push(event));
    await platform.send(group.id, [{type: 'text', text: 'dashboard'}]);
    await platform.send(group.id, [{type: 'text', text: 'onebot'}], undefined, {application: 'onebot_api'});
    assert.deepEqual(events.map(event => event.type), ['application']);
    assert.equal(events[0].application, 'onebot_api');
    assert.equal(events[0].message.origin, 'application');
    assert.equal(events[0].message.segments[0].text, 'onebot');
});

test('cross-server relay is an optional plugin and never relays its own deliveries', async () => {
    const platform = new Platform(new IdentityStore());
    const deliveries = [];
    const a = platform.attach('a', 'A', 'online', [], {deliver: async () => {}});
    const b = platform.attach('b', 'B', 'online', [], {deliver: async data => deliveries.push(data)});
    platform.attach('excluded', 'Excluded', 'online', [], {deliver: async () => assert.fail('excluded group received relay')});
    platform.ingest(a.id, steve, [{type: 'text', text: 'before'}]);
    assert.equal(deliveries.length, 0);
    const uninstall = installCrossServerRelay(platform, {enabled: true, nodes: ['a', 'b']});
    const message = platform.ingest(a.id, steve, [{type: 'text', text: 'relay'}]);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(deliveries.length, 1);
    assert.equal(deliveries[0].sourceGroupName, 'A');
    assert.equal(deliveries[0].authorName, 'Steve');
    const outgoing = platform.message(deliveries[0].messageId);
    assert.equal(outgoing.groupId, b.id);
    assert.equal(outgoing.sourceMessageId, message.id);
    uninstall();
    platform.ingest(a.id, steve, [{type: 'text', text: 'after'}]);
    assert.equal(deliveries.length, 1);
});

test('complete online roster replaces presence but retains observed members; chat cannot change it', () => {
    const platform = new Platform(new IdentityStore());
    const group = platform.attach('roster', 'Roster', 'online', [], {deliver: async () => {}});
    const message = platform.ingest(group.id, steve, [{type: 'text', text: 'queued'}]);
    assert.equal(platform.member(group.id, message.authorId).online, false);
    platform.syncOnlinePlayers(group.id, [steve]);
    assert.equal(platform.member(group.id, message.authorId).online, true);
    const joined = platform.member(group.id, message.authorId).joinedAt;
    platform.syncOnlinePlayers(group.id, [{...steve, name: 'NewName'}]);
    assert.equal(platform.member(group.id, message.authorId).name, 'NewName');
    platform.syncOnlinePlayers(group.id, []);
    platform.ingest(group.id, steve, [{type: 'text', text: 'late chat'}]);
    assert.equal(group.members.size, 1);
    assert.equal(platform.member(group.id, message.authorId).online, false);
    assert.equal(platform.member(group.id, message.authorId).joinedAt, joined);
});

test('OneBot codec handles CQ escaping, arrays, auto_escape and rejects unsupported segments', () => {
    const original = [{type: 'text', text: 'a &[b]'}, {type: 'mention', userId: 'all'},
        {type: 'image', url: 'https://example.org/a?x=1,2&b=3'}];
    assert.deepEqual(fromV11(cqString(original)), original);
    assert.deepEqual(fromV11(toV11(original)), original);
    assert.deepEqual(fromV11('[CQ:at,qq=all]', true), [{type: 'text', text: '[CQ:at,qq=all]'}]);
    assert.throws(() => fromV11([{type: 'record', data: {file: 'x'}}]), /Unsupported/);
    assert.throws(() => fromV11('[CQ:at,qq=not-a-number]'), /integer/);
    assert.throws(() => fromV11([{type: 'image', data: {file: '/etc/passwd'}}]), /Unsupported/);
});

test('business plugins have explicit installation and reverse-order cleanup', () => {
    const host = new PluginHost(new Platform(new IdentityStore()));
    const cleaned = [];
    host.use({name: 'a', install: () => () => cleaned.push('a')});
    host.use({name: 'b', install: () => () => cleaned.push('b')});
    assert.throws(() => host.use({name: 'a', install: () => () => {}}), /already installed/);
    host.close(); host.close();
    assert.deepEqual(cleaned, ['b', 'a']);
});

test('config validates protocol roles, supports environment passwords, resolves data path', t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'chathub-config-'));
    t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
    const file = path.join(directory, 'config.yaml');
    const oldNode = process.env.CHATHUB_NODE_PASSWORD, oldApp = process.env.CHATHUB_ONEBOT_TOKEN;
    t.after(() => {
        if (oldNode === undefined) delete process.env.CHATHUB_NODE_PASSWORD; else process.env.CHATHUB_NODE_PASSWORD = oldNode;
        if (oldApp === undefined) delete process.env.CHATHUB_ONEBOT_TOKEN; else process.env.CHATHUB_ONEBOT_TOKEN = oldApp;
    });
    process.env.CHATHUB_NODE_PASSWORD = 'node-env'; process.env.CHATHUB_ONEBOT_TOKEN = 'app-env';
    fs.writeFileSync(file, 'port: 6700\n');
    const config = loadConfig(directory);
    assert.equal(config.node_password, 'node-env');
    assert.equal(config.onebot_token, 'app-env');
    assert.equal(config.relay.enabled, false);
    assert.equal(config.identity_file, path.join(directory, 'data/identities.json'));
    fs.writeFileSync(file, 'onebot_reverse_urls: ["ws://localhost/reverse?role=invalid"]\n');
    assert.throws(() => loadConfig(directory), /Invalid reverse connection role/);
});

test('system text becomes a stored group message from a separate virtual account', () => {
    const platform = new Platform(new IdentityStore());
    const group = platform.attach('a', 'A', 'online', [], {deliver: async () => {}});
    const events = [];
    platform.subscribe(event => events.push(event));
    // The platform accepts an opaque node category, not only hardcoded MC events.
    const message = platform.system(group.id, 'custom_announcement', 'Prepared by MCDR');
    assert.equal(message.origin, 'system');
    assert.equal(message.systemKind, 'custom_announcement');
    assert.equal(message.authorId, 2);
    assert.notEqual(message.authorId, platform.botId);
    assert.equal(message.authorName, 'Minecraft Server');
    assert.deepEqual(events, [{type: 'message', message}]);
    assert.equal(platform.message(message.id).authorId, 2);
    assert.equal(group.members.size, 0); // never fabricates a Minecraft UUID
    assert.equal(group.systemLastSentTime, message.time);
});

test('relay handles system messages only when selected and never re-emits deliveries', async () => {
    const platform = new Platform(new IdentityStore());
    const deliveries = [];
    const a = platform.attach('a', 'A', 'online', [], {deliver: async () => {}});
    platform.attach('b', 'B', 'online', [], {deliver: async message => deliveries.push(message)});
    const unsubscribe = installCrossServerRelay(platform, {enabled: true, nodes: [], include_system: false});
    platform.system(a.id, 'startup', 'Server started');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(deliveries.length, 0);
    unsubscribe();
    const uninstall = installCrossServerRelay(platform, {enabled: true, nodes: []});
    const message = platform.system(a.id, 'death', 'Steve was slain by Zombie');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(deliveries.length, 1);
    assert.equal(deliveries[0].authorName, '');
    assert.equal(deliveries[0].sourceGroupName, 'A');
    assert.equal(platform.message(deliveries[0].messageId).sourceMessageId, message.id);
    uninstall();
});

test('failed deliveries are logged once, preserve the original error and stay out of chat history/events', async () => {
    const platform = new Platform(new IdentityStore());
    const failure = new Error('MCDR delivery acknowledgement timed out');
    const transport = {deliver:async()=>{throw failure;}};
    const group = platform.attach('survival','生存服','online',[],transport);
    const events = [];
    platform.subscribe(event=>events.push(event));
    await assert.rejects(platform.send(group.id,[{type:'text',text:'private payload'}]),error=>error===failure);
    const [log] = platform.recentLogs();
    assert.equal(log.level,'error');
    assert.equal(log.type,'delivery_failed');
    assert.equal(log.origin,'application');
    assert.equal(log.groupId,group.id);
    assert.equal(log.groupName,'生存服');
    assert.equal(log.nodeId,'survival');
    assert.equal(log.error,failure.message);
    assert.ok(log.time>0);
    assert.ok(Number.isInteger(log.messageId));
    assert.equal(JSON.stringify(log).includes('private payload'),false);
    assert.equal(JSON.stringify(log).includes(failure.stack),false);
    assert.equal(platform.messageCount,0);
    assert.throws(()=>platform.message(log.messageId),/not found/);
    assert.deepEqual(events,[]);
    transport.deliver=async()=>{};
    await platform.send(group.id,[{type:'text',text:'succeeds'}]);
    assert.equal(platform.recentLogs().length,1);
    assert.equal(platform.messageCount,1);
});

test('in-flight disconnect logs retain target metadata; offline attempts are also recorded', async () => {
    const platform = new Platform(new IdentityStore());
    let reject;
    const transport = {deliver:()=>new Promise((resolve,fail)=>{reject=fail;})};
    const group = platform.attach('creative','创造服','online',[],transport);
    const pending = assert.rejects(platform.send(group.id,[{type:'text',text:'pending'}]),/disconnected/);
    platform.detach(group.id,transport);
    reject(new Error('Node disconnected'));
    await pending;
    assert.equal(platform.recentLogs()[0].groupName,'创造服');
    assert.equal(platform.recentLogs()[0].nodeId,'creative');
    await assert.rejects(platform.send(group.id,[{type:'text',text:'offline'}]),/offline/);
    const logs = platform.recentLogs();
    assert.equal(logs.length,2);
    assert.equal(logs[0].groupId,group.id);
    assert.equal(logs[0].messageId,undefined);
    assert.match(logs[0].error,/offline/);
    assert.equal(logs[1].groupName,'创造服');
});

test('relay failures identify the source and target without blocking other clients or creating chat events', async t => {
    t.mock.method(console,'error',()=>{});
    const platform = new Platform(new IdentityStore());
    const source = platform.attach('source','Source','online',[],{deliver:async()=>{}});
    const failed = platform.attach('failed','Failed','online',[],{deliver:async()=>{throw new Error('MC offline');}});
    const received = [];
    platform.attach('healthy','Healthy','online',[],{deliver:async delivery=>received.push(delivery)});
    const uninstall = installCrossServerRelay(platform,{enabled:true,nodes:[]});
    t.after(uninstall);
    const events = [];
    platform.subscribe(event=>events.push(event));
    const message = platform.ingest(source.id,steve,[{type:'text',text:'relay'}]);
    await new Promise(resolve=>setImmediate(resolve));
    const [log] = platform.recentLogs();
    assert.equal(platform.recentLogs().length,1);
    assert.equal(log.origin,'plugin');
    assert.equal(log.groupId,failed.id);
    assert.equal(log.sourceMessageId,message.id);
    assert.equal(log.error,'MC offline');
    assert.equal(received.length,1);
    assert.equal(platform.messageCount,2); // incoming source + successful target only
    assert.deepEqual(events.map(event=>event.type),['message']);
});

test('delivery logs are bounded, newest first, copied on read and handle non-Error rejections', async () => {
    const platform = new Platform(new IdentityStore());
    let reason;
    const group = platform.attach('a','A','online',[],{deliver:async()=>{throw reason;}});
    for (let i=0;i<202;i++) {
        reason=String(i);
        await assert.rejects(platform.send(group.id,[{type:'text',text:'test'}]),error=>error===reason);
    }
    const logs = platform.recentLogs(500);
    assert.equal(logs.length,200);
    assert.equal(logs[0].error,'201');
    assert.equal(logs.at(-1).error,'2');
    assert.ok(logs[0].id>logs[1].id);
    logs[0].error='mutated';
    assert.equal(platform.recentLogs(1)[0].error,'201');
    for (const limit of [0,-1,NaN,Infinity]) assert.deepEqual(platform.recentLogs(limit),[]);
    reason=new Error('x'.repeat(600)+'\nstack-like text');
    await assert.rejects(platform.send(group.id,[]),error=>error===reason);
    assert.equal(platform.recentLogs(1)[0].error.length,500);
    reason={secret:'do not stringify errors'};
    await assert.rejects(platform.send(group.id,[]),error=>error===reason);
    assert.equal(platform.recentLogs(1)[0].error,'Unknown delivery error');
    reason=new Error('line 1\nline 2\u0000');
    await assert.rejects(platform.send(group.id,[]));
    assert.equal(platform.recentLogs(1)[0].error,'line 1 line 2 ');
    assert.deepEqual(new Platform(new IdentityStore()).recentLogs(),[]);
});
