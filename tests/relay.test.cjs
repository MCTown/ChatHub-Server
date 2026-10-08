const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {Platform} = require('../server/dist/core/Platform');
const {IdentityStore} = require('../server/dist/storage/IdentityStore');
const {installCrossServerRelay} = require('../server/dist/plugins/CrossServerRelay');
const {loadConfig} = require('../server/dist/config');

const player = {uuid:'8667ba71-b85a-4004-af54-457a9734eed7',name:'Steve'};
const segments = [{type:'text',text:'hello'}, {type:'image',url:'https://example.org/a.png'}];
const flush = () => new Promise(resolve => setImmediate(resolve));

function client(platform, nodeId, externalGroupId) {
    const received = [];
    const transport = {deliver:async message => received.push(message)};
    const group = platform.attach(nodeId, nodeId, externalGroupId ? 'onebot:qq' : 'minecraft:online', [], transport,
        externalGroupId ? {kind:'onebot',externalGroupId} : {kind:'minecraft'});
    return {group, received, transport};
}

test('relay broadcasts from every client to all other online Minecraft and OneBot clients', async t => {
    const platform = new Platform(new IdentityStore());
    const clients = [client(platform,'survival'), client(platform,'creative'), client(platform,'onebot:123:555',555)];
    t.after(installCrossServerRelay(platform,{enabled:true}));
    for (const source of clients) {
        const participant = source.group.kind === 'onebot' ? {externalId:'98765',name:'QQ User'} : player;
        const message = platform.ingest(source.group.id,participant,segments);
        await flush();
        for (const target of clients.filter(target => target !== source)) {
            const delivery = target.received.at(-1);
            assert.deepEqual(delivery.segments,segments);
            assert.equal(delivery.authorName,participant.name);
            assert.equal(delivery.sourceGroupName,source.group.name);
            assert.equal(platform.message(delivery.messageId).sourceMessageId,message.id);
        }
    }
    assert.deepEqual(clients.map(c => c.received.length),[2,2,2]);
    assert.equal(platform.messageCount,9); // three incoming messages, six deliveries, no loops
});

test('relay broadcasts successful OneBot API sends without relaying ordinary application sends', async t => {
    const platform = new Platform(new IdentityStore());
    const source = client(platform,'onebot:123:555',555), target = client(platform,'survival');
    t.after(installCrossServerRelay(platform,{enabled:true}));
    await platform.send(source.group.id,segments);
    await flush();
    assert.equal(target.received.length,0);
    await platform.send(source.group.id,segments,undefined,{application:'onebot_api'});
    await flush();
    assert.equal(source.received.length,2);
    assert.equal(target.received.length,1);
    assert.equal(target.received[0].sourceGroupName,source.group.name);
    assert.equal(platform.message(target.received[0].messageId).origin,'plugin');
});

test('blacklisted Minecraft and OneBot clients cannot source or receive relays, including system messages', async t => {
    const platform = new Platform(new IdentityStore());
    const a = client(platform,'a'), b = client(platform,'b');
    const blocked = [client(platform,'private'),client(platform,'onebot:123:555',555)];
    t.after(installCrossServerRelay(platform,{enabled:true,blacklist:blocked.map(c => c.group.nodeId)}));
    platform.ingest(a.group.id,player,segments);
    platform.system(a.group.id,'startup','Server started');
    for (const source of blocked) {
        const participant = source.group.kind === 'onebot' ? {externalId:'98765',name:'QQ User'} : player;
        platform.ingest(source.group.id,participant,segments);
        platform.system(source.group.id,'shutdown','Server stopped');
    }
    await flush();
    assert.equal(a.received.length,0);
    assert.equal(b.received.length,2);
    assert.deepEqual(blocked.map(c => c.received.length),[0,0]);
    assert.equal(platform.recentMessages().filter(m => m.origin !== 'plugin').length,6);
    assert.deepEqual(platform.recentLogs(),[]);
    // Blacklisting is a relay policy, not an access control for direct sends.
    await platform.send(blocked[0].group.id,segments);
    await flush();
    assert.equal(blocked[0].received.length,1);
    assert.equal(b.received.length,2);
});

test('blacklist wins over the legacy nodes allowlist for both sources and targets', async t => {
    const platform = new Platform(new IdentityStore());
    const a = client(platform,'a'), b = client(platform,'b');
    const blocked = client(platform,'blocked'), outside = client(platform,'outside');
    t.after(installCrossServerRelay(platform,{enabled:true,nodes:['a','b','blocked'],blacklist:['blocked']}));
    for (const source of [a,blocked,outside]) platform.ingest(source.group.id,player,segments);
    await flush();
    assert.equal(a.received.length,0);
    assert.equal(b.received.length,1);
    assert.equal(blocked.received.length,0);
    assert.equal(outside.received.length,0);
});

test('relay follows late attachment, disconnect and reconnect while preserving blacklist exclusions', async t => {
    const platform = new Platform(new IdentityStore());
    const a = client(platform,'a');
    t.after(installCrossServerRelay(platform,{enabled:true,blacklist:['blocked','unknown']}));
    const b = client(platform,'b'), blocked = client(platform,'blocked');
    platform.ingest(a.group.id,player,segments);
    await flush();
    assert.equal(b.received.length,1);
    platform.detach(b.group.id,b.transport);
    platform.detach(blocked.group.id,blocked.transport);
    platform.ingest(a.group.id,player,segments);
    await flush();
    assert.equal(b.received.length,1);
    const restored = client(platform,'b'), restoredBlocked = client(platform,'blocked');
    platform.ingest(a.group.id,player,segments);
    await flush();
    assert.equal(restored.group.id,b.group.id);
    assert.equal(restored.received.length,1);
    assert.equal(restoredBlocked.received.length,0);
});

test('disabled relay, excluded systems and uninstalled relay never broadcast', async () => {
    const platform = new Platform(new IdentityStore());
    const a = client(platform,'a'), b = client(platform,'b');
    const disabled = installCrossServerRelay(platform,{enabled:false,blacklist:[]});
    platform.ingest(a.group.id,player,segments);
    disabled();
    const stop = installCrossServerRelay(platform,{enabled:true,blacklist:[],include_system:false});
    platform.system(a.group.id,'death','Steve died');
    stop();
    platform.ingest(a.group.id,player,segments);
    await flush();
    assert.equal(b.received.length,0);
});

test('blacklist filtering retains protection against relay back into the same external QQ group', async t => {
    const platform = new Platform(new IdentityStore());
    const source = client(platform,'onebot:123:555',555), same = client(platform,'onebot:456:555',555);
    const other = client(platform,'onebot:123:666',666), mc = client(platform,'mc');
    t.after(installCrossServerRelay(platform,{enabled:true,blacklist:[]}));
    platform.ingest(source.group.id,{externalId:'98765',name:'QQ User'},segments);
    await flush();
    assert.equal(source.received.length,0);
    assert.equal(same.received.length,0);
    assert.equal(other.received.length,1);
    assert.equal(mc.received.length,1);
});

test('relay config defaults and validates blacklist without breaking existing configurations', t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(),'chathub-relay-'));
    t.after(() => fs.rmSync(directory,{recursive:true,force:true}));
    const file = path.join(directory,'config.yaml');
    const base = 'node_password: nodes\nonebot_token: apps\n';
    const load = relay => {
        fs.writeFileSync(file,base+(relay === undefined ? '' : 'relay: '+JSON.stringify(relay)+'\n'));
        return loadConfig(directory).relay;
    };
    assert.deepEqual(load(),{enabled:false,nodes:[],blacklist:[],include_system:true,system_name:'server',hide_system_name:true});
    assert.deepEqual(load({enabled:true}),{enabled:true,nodes:[],blacklist:[],include_system:true,system_name:'server',hide_system_name:true});
    assert.deepEqual(load({enabled:true,nodes:['a','b']}).blacklist,[]);
    assert.deepEqual(load({blacklist:[' private ','onebot:123:555']}).blacklist,['private','onebot:123:555']);
    for (const blacklist of ['private',[123],[''],['   '],null]) assert.throws(() => load({blacklist}));
    assert.equal(load({system_name:' 通知 '}).system_name,'通知');
    for (const system_name of ['', '   ', 123, 'x'.repeat(81)]) assert.throws(() => load({system_name}));
    assert.throws(() => load({hide_system_name:'true'}));
});

test('system display overrides preserve identities, source labels and player names', async t => {
    for (const hide_system_name of [false,true]) {
        const platform = new Platform(new IdentityStore());
        const a = client(platform,'a'), b = client(platform,'b');
        t.after(installCrossServerRelay(platform,{enabled:true,system_name:'服务器通知',hide_system_name}));
        const original = platform.system(a.group.id,'death','Steve died');
        platform.ingest(a.group.id,player,segments);
        await flush();
        assert.equal(b.received[0].authorName,hide_system_name ? '' : '服务器通知');
        assert.equal(b.received[0].sourceGroupName,a.group.name);
        assert.equal(b.received[1].authorName,player.name);
        assert.equal(original.authorName,'Minecraft Server');
        assert.equal(original.authorId,2);
        const forwarded = platform.message(b.received[0].messageId);
        assert.equal(forwarded.authorName,'ChatHub');
        assert.equal(forwarded.authorId,1);
        assert.equal(forwarded.sourceMessageId,original.id);
    }
});
