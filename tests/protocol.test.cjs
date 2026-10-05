const {test} = require('node:test');
const assert = require('node:assert/strict');
const {once} = require('node:events');
const WebSocket = require('ws');
const {WebSocketServer} = WebSocket;
const {IdentityStore} = require('../server/dist/storage/IdentityStore');
const {Platform} = require('../server/dist/core/Platform');
const {ChatHubServer} = require('../server/dist/server');
const {installCrossServerRelay} = require('../server/dist/plugins/CrossServerRelay');
const {attachNative} = require('../server/dist/adapters/native');

const player = {uuid: '8667ba71-b85a-4004-af54-457a9734eed7', name: 'Steve'};
function config(extra = {}) {
    return {host: '127.0.0.1', port: 0, node_password: 'nodes', onebot_token: 'apps',
        identity_file: '', delivery_timeout_ms: 200, onebot_reverse_urls: [], relay: {enabled: false, nodes: []}, ...extra};
}

class Inbox {
    constructor(socket) {
        this.socket = socket;
        this.messages = [];
        this.waiters = [];
        socket.on('message', raw => {
            const message = JSON.parse(raw.toString());
            const index = this.waiters.findIndex(waiter => waiter.filter(message));
            if (index >= 0) {
                const waiter = this.waiters.splice(index, 1)[0];
                clearTimeout(waiter.timer); waiter.resolve(message);
            } else this.messages.push(message);
        });
    }
    next(filter = () => true) {
        const index = this.messages.findIndex(filter);
        if (index >= 0) return Promise.resolve(this.messages.splice(index, 1)[0]);
        return new Promise((resolve, reject) => {
            const waiter = {filter, resolve, timer: setTimeout(() => {
                this.waiters = this.waiters.filter(item => item !== waiter);
                reject(new Error('Timed out waiting for protocol frame'));
            }, 4000)};
            this.waiters.push(waiter);
        });
    }
    send(value) {this.socket.send(JSON.stringify(value));}
}

async function connect(url, token) {
    const socket = new WebSocket(url, {headers: {Authorization: `Bearer ${token}`}});
    const inbox = new Inbox(socket);
    await once(socket, 'open');
    return inbox;
}

async function fixture(t, extra = {}) {
    const platform = new Platform(new IdentityStore());
    const server = new ChatHubServer(config(extra), platform);
    const port = await server.start();
    t.after(() => server.stop());
    return {platform, url: `ws://127.0.0.1:${port}`};
}

async function node(url, nodeId = 'survival', players = [player]) {
    const inbox = await connect(url + '/chathub/v2/connect', 'nodes');
    inbox.send({type: 'hello', version: 2, node_id: nodeId, name: nodeId, identity_scope: 'online'});
    inbox.registration = await inbox.next(message => message.type === 'registered');
    const query = await inbox.next(message => message.type === 'api_call');
    assert.equal(query.action, 'get_online_players');
    inbox.send({type: 'api_result', request_id: query.request_id, ok: true, players});
    inbox.users = (await inbox.next(message => message.type === 'users')).users;
    return inbox;
}

test('Terraria Unicode character names, system reports and deliveries use native v2', async t => {
    const {url, platform} = await fixture(t);
    const character = {uuid: '9d155751642748ce92fa10444c93032b', name: '小明 One'};
    const tr = await connect(url + '/chathub/v2/connect', 'nodes');
    tr.send({type: 'hello', version: 2, node_id: 'terraria', name: '泰拉瑞亚', identity_scope: 'terraria:characters:test'});
    const registered = await tr.next(frame => frame.type === 'registered');
    const query = await tr.next(frame => frame.type === 'api_call');
    tr.send({type: 'api_result', request_id: query.request_id, ok: true, players: [character]});
    const users = await tr.next(frame => frame.type === 'users');
    assert.equal(users.users[0].name, character.name);
    tr.send({type: 'chat', event_id: 'tr-chat', player: character, segments: [{type: 'text', text: '你好'}]});
    const chat = await tr.next(frame => frame.type === 'accepted');
    assert.equal(platform.message(chat.message_id).authorName, character.name);
    for (const kind of ['join', 'leave', 'death', 'boss_start', 'boss_progress', 'boss_defeat', 'boss_escape']) {
        tr.send({type: 'system', event_id: `tr-${kind}`, kind, text: `${kind}: 小明 One 100（100.00%）`});
        const accepted = await tr.next(frame => frame.type === 'accepted');
        assert.equal(platform.message(accepted.message_id).systemKind, kind);
    }
    for (const name of [' ', 'bad\nname', 'bad\0name', 'x'.repeat(81)]) {
        tr.send({type: 'chat', event_id: 'invalid-name', player: {...character, name}, segments: [{type: 'text', text: 'invalid'}]});
        assert.equal((await tr.next(frame => frame.type === 'error')).code, 'invalid_request');
    }
    const send = platform.send(registered.group_id, [{type: 'text', text: '跨服回复'}]);
    const delivery = await tr.next(frame => frame.type === 'deliver');
    tr.send({type: 'delivery_result', request_id: delivery.request_id, ok: true});
    assert.equal((await send).id, delivery.messageId);
});

test('authentication rejects upgrade, native registration is separate from OneBot', async t => {
    const {url} = await fixture(t);
    const socket = new WebSocket(url + '/chathub/v2/connect', {headers: {Authorization: 'Bearer wrong'}});
    const status = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {socket.terminate(); reject(new Error('Authentication rejection timed out'));}, 4000);
        socket.on('error', () => {});
        socket.once('unexpected-response', (request, response) => {
            clearTimeout(timer); response.resume(); request.destroy(); resolve(response.statusCode);
        });
    });
    assert.equal(status, 401);
    const api = await connect(url + '/onebot/v11/api', 'apps');
    api.send({action: 'get_group_list', echo: 1});
    assert.deepEqual((await api.next()).data, []);
    const mc = await node(url);
    api.send({action: 'get_group_list', echo: 2});
    const groups = await api.next();
    assert.equal(groups.data[0].group_id, mc.registration.group_id);
    const duplicate = await connect(url + '/chathub/v2/connect', 'nodes');
    const closed = once(duplicate.socket, 'close');
    duplicate.send({type: 'hello', version: 2, node_id: 'survival', name: 'other', identity_scope: 'online'});
    assert.equal((await duplicate.next()).type, 'error');
    assert.equal((await closed)[0], 1008);
    assert.equal(mc.socket.readyState, WebSocket.OPEN);
});

test('API/Event channels coexist, incoming player message has standard IDs and seconds', async t => {
    const {url} = await fixture(t);
    const event = await connect(url + '/onebot/v11/event', 'apps');
    const lifecycle = await event.next();
    assert.equal(lifecycle.self_id, 1);
    assert.equal(lifecycle.meta_event_type, 'lifecycle');
    assert.ok(lifecycle.time < 100000000000);
    const api = await connect(url + '/onebot/v11/api', 'apps');
    const mc = await node(url);
    mc.send({type: 'chat', event_id: 'm1', player, segments: [{type: 'text', text: 'hi'}]});
    const accepted = await mc.next(frame => frame.type === 'accepted');
    const message = await event.next(frame => frame.post_type === 'message');
    assert.equal(message.message_id, accepted.message_id);
    assert.equal(message.group_id, mc.registration.group_id);
    assert.equal(message.user_id, mc.users[0].user_id);
    assert.equal(message.sender.nickname, 'Steve');
    api.send({action: 'get_group_member_list', params: {group_id: message.group_id}, echo: {id: [1, 2]}});
    const response = await api.next();
    assert.deepEqual(response.echo, {id: [1, 2]});
    assert.equal(response.data[0].user_id, message.user_id);
    assert.equal(response.data.at(-1).user_id, 1);
    api.send({action: 'get_group_member_info', params: {group_id: message.group_id, user_id: 1}, echo: 'self'});
    assert.equal((await api.next()).data.nickname, 'ChatHub');
    assert.equal(event.socket.readyState, WebSocket.OPEN);
    mc.send({type: 'chat', event_id: 'm1', player, segments: [{type: 'text', text: 'duplicate'}]});
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(event.messages.filter(frame => frame.post_type === 'message').length, 0);
});

test('send_group_msg waits for native acknowledgement and does not emit incoming chat', async t => {
    const {url,platform} = await fixture(t);
    const app = await connect(url + '/onebot/v11', 'apps');
    await app.next();
    const mc = await node(url);
    app.send({action: 'send_group_msg', params: {group_id: mc.registration.group_id,
        message: 'hello [CQ:at,qq=all]'}, echo: null});
    const delivery = await mc.next(frame => frame.type === 'deliver');
    assert.deepEqual(delivery.segments, [{type: 'text', text: 'hello '}, {type: 'mention', userId: 'all'}]);
    assert.equal(app.messages.length, 0);
    mc.send({type: 'delivery_result', request_id: delivery.request_id, ok: true});
    const reply = await app.next();
    assert.equal(reply.status, 'ok');
    assert.equal(reply.echo, null);
    assert.equal(reply.data.message_id, delivery.messageId);
    assert.equal(Object.hasOwn(delivery,'traceId'),false);
    const traceId=platform.message(delivery.messageId).traceId;
    const trace=platform.traces.get(traceId);
    const sent=trace.steps.find(step=>step.label==='客户端投递报文');
    const ack=trace.steps.find(step=>step.label==='客户端确认报文');
    assert.equal(sent.payload.request_id,delivery.request_id);
    assert.equal(ack.payload.request_id,delivery.request_id);
    assert.equal(ack.payload.ok,true);
    assert.equal(trace.steps.find(step=>step.kind==='onebot').payload.data.message_id,delivery.messageId);
    assert.deepEqual(platform.recentLogs(),[]);
    app.send({action: 'get_msg', params: {message_id: delivery.messageId}, echo: true});
    const stored = await app.next();
    assert.equal(stored.data.sender.user_id, 1);
    assert.equal(stored.echo, true);
    assert.equal(app.messages.some(frame => frame.post_type === 'message'), false);
    app.send({action: 'set_group_kick', params: {}, echo: ['unsupported']});
    const unsupported = await app.next();
    assert.equal(unsupported.retcode, 1404);
    assert.deepEqual(unsupported.echo, ['unsupported']);
    app.send({action: 'send_group_msg', params: {group_id: mc.registration.group_id, message: 'timeout'}, echo: 'timeout'});
    await mc.next(frame => frame.type === 'deliver');
    const timeout = await app.next();
    assert.equal(timeout.status, 'failed');
    assert.match(timeout.message, /timed out/);
    app.send({action: 'send_group_msg', params: {group_id: mc.registration.group_id, message: 'rejected'}, echo: 'reject'});
    const rejected = await mc.next(frame => frame.type === 'deliver');
    mc.send({type: 'delivery_result', request_id: rejected.request_id, ok: false, error: 'MC offline'});
    assert.match((await app.next()).message, /MC offline/);
    const logs = platform.recentLogs();
    assert.equal(logs.length,2);
    assert.equal(logs[0].groupId,mc.registration.group_id);
    assert.equal(logs[0].messageId,rejected.messageId);
    assert.equal(logs[0].error,'MC offline');
    assert.match(logs[1].error,/timed out/);
});

test('OneBot API sends are relayed to other clients only after successful delivery', async t => {
    const {url, platform} = await fixture(t);
    const uninstall = installCrossServerRelay(platform, {enabled: true, nodes: []});
    t.after(uninstall);
    const app = await connect(url + '/onebot/v11/api', 'apps');
    const source = await node(url, 'source');
    const target = await node(url, 'target');
    app.send({action: 'send_group_msg', params: {group_id: source.registration.group_id, message: 'from API'}, echo: 'api'});
    const sourceDelivery = await source.next(frame => frame.type === 'deliver');
    assert.deepEqual(sourceDelivery.segments, [{type: 'text', text: 'from API'}]);
    source.send({type: 'delivery_result', request_id: sourceDelivery.request_id, ok: true});
    const targetDelivery = await target.next(frame => frame.type === 'deliver');
    assert.equal(targetDelivery.sourceGroupName, 'source');
    assert.deepEqual(targetDelivery.segments, [{type: 'text', text: 'from API'}]);
    target.send({type: 'delivery_result', request_id: targetDelivery.request_id, ok: true});
    assert.equal((await app.next()).echo, 'api');
    assert.equal(platform.recentMessages().filter(message => message.origin === 'application').length, 1);
});

test('disconnect cleans groups and pending deliveries, reconnect retains group ID', async t => {
    const {url, platform} = await fixture(t);
    const app = await connect(url + '/onebot/v11/api', 'apps');
    const mc = await node(url);
    const id = mc.registration.group_id;
    app.send({action: 'send_group_msg', params: {group_id: id, message: 'disconnected'}, echo: 0});
    await mc.next(frame => frame.type === 'deliver');
    const closed = once(mc.socket, 'close'); mc.socket.close(); await closed;
    assert.equal((await app.next()).status, 'failed');
    assert.equal(platform.groups().length, 0);
    assert.equal(platform.recentLogs()[0].groupName,'survival');
    assert.match(platform.recentLogs()[0].error,/disconnected/);
    const restored = await node(url);
    assert.equal(restored.registration.group_id, id);
});

test('relay plugin forwards between native groups without recursive OneBot events', async t => {
    const {url, platform} = await fixture(t);
    const uninstall = installCrossServerRelay(platform, {enabled: true, nodes: []});
    t.after(uninstall);
    const a = await node(url, 'a');
    const b = await node(url, 'b');
    const app = await connect(url + '/onebot/v11/event', 'apps'); await app.next();
    a.send({type: 'chat', event_id: 'relay', player, segments: [{type: 'text', text: 'hello'}]});
    const delivery = await b.next(frame => frame.type === 'deliver');
    assert.equal(delivery.sourceGroupName, 'a');
    b.send({type: 'delivery_result', request_id: delivery.request_id, ok: true});
    const event = await app.next(frame => frame.post_type === 'message');
    assert.equal(event.group_id, a.registration.group_id);
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(app.messages.length, 0);
    assert.equal(a.messages.some(frame => frame.type === 'deliver'), false);
});

test('reverse OneBot connection sends standard headers and executes actions', async t => {
    const application = new WebSocketServer({port: 0, host: '127.0.0.1'});
    await once(application, 'listening');
    t.after(() => new Promise(resolve => application.close(resolve)));
    const connected = new Promise(resolve => application.once('connection', (socket, request) => {
        resolve({inbox: new Inbox(socket), headers: request.headers, url: request.url});
    }));
    const {url:serverUrl}=await fixture(t, {dashboard_token:'dashboard',
        onebot_reverse_urls: [`ws://127.0.0.1:${application.address().port}/reverse?role=API`]});
    const {inbox, headers, url} = await connected;
    assert.equal(headers['x-self-id'], '1');
    assert.equal(headers['x-client-role'], 'API');
    assert.equal(headers.authorization, 'Bearer apps');
    assert.equal(url, '/reverse');
    inbox.send({action: 'get_login_info', echo: 'reverse'});
    const response = await inbox.next();
    assert.equal(response.status, 'ok');
    assert.equal(response.echo, 'reverse');
    assert.deepEqual(response.data, {user_id: 1, nickname: 'ChatHub'});
    const snapshot=await fetch(serverUrl.replace('ws:','http:')+'/api/dashboard',
        {headers:{Authorization:'Bearer dashboard'}}).then(r=>r.json());
    assert.deepEqual(snapshot.onebotTraffic.map(entry=>[entry.direction,entry.kind]),[['sent','response'],['received','request']]);
    assert.ok(snapshot.onebotTraffic.every(entry=>entry.peer==='gateway'));
    assert.equal(snapshot.onebotTraffic[0].payload.echo,'reverse');
    inbox.socket.close();
});

test('malformed native registration does not create a group or interfere with application API', async t => {
    const {url, platform} = await fixture(t);
    const invalid = await connect(url + '/chathub/v2/connect', 'nodes');
    const closed = once(invalid.socket, 'close');
    invalid.send({type: 'hello', version: 2, node_id: 'bad', name: 'Bad', identity_scope: 'online',
        players: [{uuid: 'not-a-uuid', name: 'Steve'}]});
    assert.equal((await invalid.next()).type, 'error');
    assert.equal((await closed)[0], 1008);
    assert.equal(platform.groups().length, 0);
    const api = await connect(url + '/onebot/v11/api', 'apps');
    api.socket.send('{not-json');
    assert.equal((await api.next()).retcode, 1400);
    api.send({action: 'get_login_info', echo: 'still-working'});
    assert.equal((await api.next()).status, 'ok');
});

test('MCDR system messages appear as OneBot group messages, with dedup and queryable system user', async t => {
    const {url} = await fixture(t);
    const app = await connect(url + '/onebot/v11', 'apps'); await app.next();
    const mc = await node(url, 'systems', []);
    assert.deepEqual(mc.registration.system_user, {user_id: 2, name: 'Minecraft Server'});
    assert.equal('users' in mc.registration, false);
    assert.deepEqual(mc.users, []);
    for (const kind of ['startup', 'advancement', 'death', 'shutdown']) {
        mc.send({type: 'system', event_id: kind, kind, text: `MCDR composed ${kind}`});
        const accepted = await mc.next(frame => frame.type === 'accepted');
        const message = await app.next(frame => frame.post_type === 'message');
        assert.equal(message.self_id, 1);
        assert.equal(message.user_id, 2);
        assert.equal(message.sender.nickname, 'Minecraft Server');
        assert.equal(message.group_id, mc.registration.group_id);
        assert.equal(message.message_id, accepted.message_id);
        assert.deepEqual(message.message, [{type: 'text', data: {text: `MCDR composed ${kind}`}}]);
        assert.equal('uuid' in accepted, false);
        app.send({action: 'get_msg', params: {message_id: message.message_id}, echo: kind});
        assert.equal((await app.next(frame => frame.echo === kind)).data.sender.user_id, 2);
    }
    mc.send({type: 'system', event_id: 'shutdown', kind: 'shutdown', text: 'duplicate'});
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(app.messages.some(frame => frame.post_type === 'message'), false);
    app.send({action: 'get_group_member_info', params: {group_id: mc.registration.group_id, user_id: 2}, echo: 'system'});
    const member = await app.next(frame => frame.echo === 'system');
    assert.equal(member.data.nickname, 'Minecraft Server');
    assert.ok(member.data.last_sent_time > 0);
    app.send({action: 'get_stranger_info', params: {user_id: 2}, echo: 'stranger'});
    assert.equal((await app.next(frame => frame.echo === 'stranger')).data.nickname, 'Minecraft Server');
});

async function pollingNode(t) {
    const platform = new Platform(new IdentityStore());
    const server = new WebSocketServer({port: 0, host: '127.0.0.1'});
    server.on('connection', socket => attachNative(socket, platform, 300, 20));
    await once(server, 'listening');
    t.after(async () => {
        for (const socket of server.clients) socket.terminate();
        await new Promise(resolve => server.close(resolve));
    });
    const inbox = await connect(`ws://127.0.0.1:${server.address().port}`, 'nodes');
    inbox.send({type: 'hello', version: 2, node_id: 'poll', name: 'Poll', identity_scope: 'online'});
    inbox.registration = await inbox.next(frame => frame.type === 'registered');
    return {platform, inbox};
}

test('v2 server queries client API and replaces the online list without presence or hello players', async t => {
    const {platform, inbox} = await pollingNode(t);
    assert.equal(inbox.registration.version, 2);
    assert.equal('users' in inbox.registration, false);
    const query = await inbox.next(frame => frame.type === 'api_call');
    assert.equal(query.action, 'get_online_players');
    assert.equal(platform.group(inbox.registration.group_id).members.size, 0);
    // An unsolicited or mismatched response cannot seed presence.
    inbox.send({type: 'api_result', request_id: 'unknown', ok: true, players: [player]});
    inbox.send({type: 'api_result', request_id: query.request_id, ok: true, players: [player]});
    const users = await inbox.next(frame => frame.type === 'users');
    const id = users.users[0].user_id;
    assert.equal(platform.member(inbox.registration.group_id, id).online, true);
    inbox.send({type: 'presence', player, online: false});
    assert.equal((await inbox.next(frame => frame.type === 'error')).code, 'invalid_request');
    assert.equal(platform.member(inbox.registration.group_id, id).online, true);
    const next = await inbox.next(frame => frame.type === 'api_call');
    assert.notEqual(next.request_id, query.request_id);
    inbox.send({type: 'api_result', request_id: query.request_id, ok: true, players: [player]});
    inbox.send({type: 'api_result', request_id: next.request_id, ok: true, players: []});
    await inbox.next(frame => frame.type === 'users');
    assert.equal(platform.member(inbox.registration.group_id, id).online, false);
    inbox.send({type: 'chat', event_id: 'late', player, segments: [{type: 'text', text: 'late'}]});
    await inbox.next(frame => frame.type === 'accepted');
    assert.equal(platform.member(inbox.registration.group_id, id).online, false);
});

test('online API failure or timeout disconnects the node rather than retaining a stale roster', async t => {
    for (const fail of [false, true]) {
        const {platform, inbox} = await pollingNode(t);
        const query = await inbox.next(frame => frame.type === 'api_call');
        inbox.send({type: 'api_result', request_id: query.request_id, ok: true, players: [player]});
        await inbox.next(frame => frame.type === 'users');
        const next = await inbox.next(frame => frame.type === 'api_call');
        const closed = once(inbox.socket, 'close');
        if (fail) inbox.send({type: 'api_result', request_id: next.request_id, ok: false, error: 'list unavailable'});
        assert.equal((await closed)[0], 1011);
        assert.equal(platform.groups().length, 0);
    }
});

test('invalid roster is rejected atomically and a corrected response can complete the pending call', async t => {
    const {platform, inbox} = await pollingNode(t);
    const query = await inbox.next(frame => frame.type === 'api_call');
    for (const players of [undefined, [{uuid: 'bad', name: 'Steve'}],
        [player, {...player, uuid: player.uuid.replaceAll('-', '').toUpperCase()}]]) {
        inbox.send({type: 'api_result', request_id: query.request_id, ok: true, players});
        assert.equal((await inbox.next(frame => frame.type === 'error')).code, 'invalid_request');
        assert.equal(platform.group(inbox.registration.group_id).members.size, 0);
    }
    inbox.send({type: 'api_result', request_id: query.request_id, ok: true, players: [player]});
    await inbox.next(frame => frame.type === 'users');
    assert.equal([...platform.group(inbox.registration.group_id).members.values()][0].online, true);
});

test('old v1 hello is rejected on the v2 endpoint', async t => {
    const {url, platform} = await fixture(t);
    const inbox = await connect(url + '/chathub/v2/connect', 'nodes');
    const closed = once(inbox.socket, 'close');
    inbox.send({type: 'hello', version: 1, node_id: 'legacy', name: 'Legacy', identity_scope: 'online', players: [player]});
    assert.equal((await inbox.next()).type, 'error');
    assert.equal((await closed)[0], 1008);
    assert.equal(platform.groups().length, 0);
});

test('removed v1 endpoint is not silently served as v2', async t => {
    const {url} = await fixture(t);
    const socket = new WebSocket(url + '/chathub/v1/connect', {headers: {Authorization: 'Bearer nodes'}});
    const status = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {socket.terminate(); reject(new Error('Legacy endpoint rejection timed out'));}, 4000);
        socket.on('error', () => {});
        socket.once('unexpected-response', (request, response) => {
            clearTimeout(timer); response.resume(); request.destroy(); resolve(response.statusCode);
        });
    });
    assert.equal(status, 404);
});
