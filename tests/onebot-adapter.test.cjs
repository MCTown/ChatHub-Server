const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {once} = require('node:events');
const {setTimeout: delay} = require('node:timers/promises');
const {WebSocketServer,WebSocket} = require('ws');
const {Platform} = require('../server/dist/core/Platform');
const {IdentityStore} = require('../server/dist/storage/IdentityStore');
const {ChatHubServer} = require('../server/dist/server');
const {OneBotAdapter} = require('../server/dist/plugins/OneBotAdapter');
const {installCrossServerRelay} = require('../server/dist/plugins/CrossServerRelay');

async function until(predicate) {
    for (let i=0;i<300;i++) {if(predicate())return;await delay(10);}
    assert.fail('Timed out waiting for adapter state');
}
async function bot(t, {botId=12345,groupId=555,sendStatus='ok',sendRetcode=0,ignoreSend=false}={}) {
    const server = new WebSocketServer({host:'127.0.0.1',port:0});
    await once(server,'listening');
    const requests=[], sockets=[], headers=[];
    let nextMessage=200;
    server.on('connection',(socket,request)=>{
        sockets.push(socket);headers.push(request.headers);
        socket.on('message',raw=>{
            const call=JSON.parse(raw);requests.push(call);
            let data;
            if(call.action==='get_login_info')data={user_id:botId,nickname:'Fixture Bot'};
            else if(call.action==='get_group_info')data={group_id:groupId,group_name:'Fixture QQ Group'};
            else if(call.action==='get_group_member_info')data={group_id:groupId,user_id:botId};
            else if(call.action==='send_group_msg') {
                if(ignoreSend)return;
                socket.send(JSON.stringify({status:sendStatus,retcode:sendRetcode,data:{message_id:nextMessage++},echo:call.echo}));
                return;
            }
            socket.send(JSON.stringify({status:'ok',retcode:0,data,echo:call.echo}));
        });
    });
    t.after(async()=>{for(const socket of server.clients)socket.terminate();await new Promise(resolve=>server.close(resolve));});
    const event = (overrides={}) => ({time:Math.floor(Date.now()/1000),self_id:botId,post_type:'message',message_type:'group',
        sub_type:'normal',group_id:groupId,user_id:98765,message_id:101,message:[{type:'text',data:{text:'hello from QQ'}}],
        sender:{nickname:'QQ User',card:'Group Card'},...overrides});
    return {url:`ws://127.0.0.1:${server.address().port}/`,requests,sockets,headers,event,
        emit:overrides=>sockets.at(-1).send(JSON.stringify(event(overrides)))};
}
function adapter(t, platform, file, timeout=200) {
    const plugin=new OneBotAdapter(file,timeout,30);
    const dispose=plugin.install(platform);
    t.after(dispose);
    return {plugin,dispose};
}

test('OneBot bot + group is a client: verify account/group, scoped users, filtered/deduplicated incoming messages', async t=>{
    const remote=await bot(t);
    const platform=new Platform(new IdentityStore());
    const {plugin}=adapter(t,platform);
    plugin.add({address:remote.url,group_id:'555',access_token:'bot-secret'});
    await until(()=>platform.groups().length===1);
    const group=platform.groups()[0];
    assert.equal(group.kind,'onebot');assert.equal(group.nodeId,'onebot:12345:555');
    assert.equal(group.externalGroupId,555);assert.equal(group.name,'Fixture QQ Group');
    assert.equal(remote.headers[0].authorization,'Bearer bot-secret');
    assert.deepEqual(remote.requests.slice(0,2).map(r=>r.action),['get_login_info','get_group_info']);
    assert.equal(platform.messageCount,0);
    const events=[];platform.subscribe(e=>events.push(e));
    for (const override of [{group_id:666},{message_type:'private'},{post_type:'notice'},{post_type:'message_sent'},
        {self_id:54321},{user_id:12345},{anonymous:{id:1}},{user_id:'invalid'}]) remote.emit(override);
    remote.sockets[0].send('{malformed');
    remote.emit();remote.emit();
    await until(()=>events.length===1);
    await delay(30);assert.equal(events.length,1);
    const incoming=events[0].message;
    assert.equal(incoming.authorName,'Group Card');assert.equal(incoming.origin,'player');
    const member=platform.member(group.id,incoming.authorId);
    assert.equal(member.externalId,'98765');assert.equal(member.uuid,undefined);assert.equal(member.online,false);
    assert.notEqual(incoming.authorId,98765);
    const mc=platform.attach('mc','MC','minecraft:online',[],{deliver:async()=>{}});
    const player=platform.ingest(mc.id,{uuid:'98765',name:'MC'},[{type:'text',text:'separate scope'}]);
    assert.notEqual(player.authorId,incoming.authorId);
});

test('bidirectional relay preserves source labels, maps mentions and never loops bot echoes into chat', async t=>{
    const remote=await bot(t);
    const platform=new Platform(new IdentityStore());
    const {plugin}=adapter(t,platform);
    plugin.add({address:remote.url,group_id:555});
    await until(()=>platform.groups().length===1);
    const qq=platform.groups()[0], received=[];
    const mc=platform.attach('survival','Survival','minecraft:online',[],{deliver:async message=>received.push(message)});
    const stopRelay=installCrossServerRelay(platform,{enabled:true,nodes:[],include_system:true});t.after(stopRelay);
    remote.emit({message:[{type:'text',data:{text:'QQ ' }},{type:'at',data:{qq:'98765'}},
        {type:'image',data:{url:'https://example.org/a.png'}},{type:'record',data:{file:'/secret'}}]});
    await until(()=>received.length===1);
    assert.equal(received[0].authorName,'Group Card');assert.equal(received[0].sourceGroupName,'Fixture QQ Group');
    assert.equal(received[0].segments[3].text,'[语音]');
    const qqMessage=platform.recentMessages().find(m=>m.groupId===qq.id&&m.origin==='player');
    assert.equal(qqMessage.segments[1].userId,qqMessage.authorId);
    platform.ingest(mc.id,{uuid:'8667ba71-b85a-4004-af54-457a9734eed7',name:'Steve'},[{type:'text',text:'[CQ:at,qq=all]'}]);
    await until(()=>remote.requests.some(r=>r.action==='send_group_msg'));
    await until(()=>platform.recentMessages().some(m=>m.groupId===qq.id&&m.origin==='plugin'));
    const sent=remote.requests.find(r=>r.action==='send_group_msg');
    assert.equal(sent.params.group_id,555);
    assert.deepEqual(sent.params.message,[{type:'text',data:{text:'[Survival] <Steve> '}},
        {type:'text',data:{text:'[CQ:at,qq=all]'}}]);
    const count=platform.messageCount;
    remote.emit({message_id:202,user_id:12345,message:sent.params.message});
    remote.emit({post_type:'message_sent',message_id:203,message:sent.params.message});
    await delay(30);assert.equal(platform.messageCount,count);assert.equal(received.length,1);
    await platform.send(qq.id,[{type:'mention',userId:qqMessage.authorId},{type:'mention',userId:777},{type:'mention',userId:'all'}]);
    assert.deepEqual(remote.requests.at(-1).params.message,[{type:'at',data:{qq:'98765'}},
        {type:'text',data:{text:'@777'}},{type:'at',data:{qq:'all'}}]);
});

test('OneBot displays source client and sender in Minecraft-style prefixes for player and system deliveries',async t=>{
    const remote=await bot(t);
    const platform=new Platform(new IdentityStore());
    const {plugin}=adapter(t,platform);
    plugin.add({address:remote.url,group_id:555,name:'玩家交流群'});
    await until(()=>platform.groups().length===1);
    const qq=platform.groups()[0];
    const mc=platform.attach('survival','生存服','minecraft:online',[],{deliver:async()=>{}});
    const segments=[{type:'text',text:'你好 [CQ:at,qq=all]'},
        {type:'image',url:'https://example.org/a.png'},{type:'mention',userId:'all'}];
    const player=platform.ingest(mc.id,{uuid:'8667ba71-b85a-4004-af54-457a9734eed7',name:'Steve'},segments);
    await platform.send(qq.id,player.segments,player);
    assert.deepEqual(remote.requests.at(-1).params.message,[
        {type:'text',data:{text:'[生存服] <Steve> '}},
        {type:'text',data:{text:segments[0].text}},
        {type:'image',data:{file:segments[1].url}},
        {type:'at',data:{qq:'all'}},
    ]);
    assert.deepEqual(platform.message(player.id).segments,segments); // Prefixes are presentation only.
    const system=platform.system(mc.id,'death','Steve fell from a high place');
    await platform.send(qq.id,system.segments,system);
    assert.deepEqual(remote.requests.at(-1).params.message,[
        {type:'text',data:{text:'[生存服] <Minecraft Server> '}},
        {type:'text',data:{text:'Steve fell from a high place'}},
    ]);
    await platform.send(qq.id,[{type:'text',text:'应用直接投递'}]);
    assert.deepEqual(remote.requests.at(-1).params.message,[{type:'text',data:{text:'应用直接投递'}}]);
});

test('different configured bridge bots are ignored and same external group is not relayed to itself', async t=>{
    const a=await bot(t,{botId:12345}), b=await bot(t,{botId:23456});
    const platform=new Platform(new IdentityStore());
    const {plugin}=adapter(t,platform);
    plugin.add({address:a.url,group_id:555});plugin.add({address:b.url,group_id:555});
    await until(()=>platform.groups().length===2);
    const stop=installCrossServerRelay(platform,{enabled:true,nodes:[]});t.after(stop);
    a.emit({user_id:23456});b.emit({user_id:12345});
    await delay(40);assert.equal(platform.messageCount,0);
    a.emit({user_id:98765,message_id:102});
    await until(()=>platform.messageCount===1);
    assert.equal(b.requests.filter(r=>r.action==='send_group_msg').length,0);
});

test('delivery needs successful echo-correlated ACK; queued/failed API responses do not enter cache', async t=>{
    for(const [sendStatus,sendRetcode] of [['failed',100],['async',1]]) {
        const remote=await bot(t,{sendStatus,sendRetcode});
        const platform=new Platform(new IdentityStore());
        const {plugin,dispose}=adapter(t,platform);
        plugin.add({address:remote.url,group_id:555});await until(()=>platform.groups().length===1);
        await assert.rejects(platform.send(platform.groups()[0].id,[{type:'text',text:'rejected'}]),/rejected/);
        assert.equal(platform.recentLogs().length,1);
        assert.match(platform.recentLogs()[0].nodeId,/^onebot:/);
        assert.equal(platform.recentLogs()[0].error,'OneBot API rejected request');
        assert.equal(platform.messageCount,0);dispose();
    }
});

test('disconnect rejects pending delivery, detaches group, and reconnect preserves group/user identities and dedup', async t=>{
    const remote=await bot(t,{ignoreSend:true});
    const platform=new Platform(new IdentityStore());
    const {plugin,dispose}=adapter(t,platform,undefined,100);
    const entry=plugin.add({address:remote.url,group_id:555});await until(()=>platform.groups().length===1);
    const id=platform.groups()[0].id;remote.emit();await until(()=>platform.messageCount===1);
    const authorId=platform.recentMessages()[0].authorId;
    await assert.rejects(platform.send(id,[{type:'text',text:'timeout'}]),/timed out/);
    const pending=assert.rejects(platform.send(id,[{type:'text',text:'disconnect'}]),/closed/);
    remote.sockets.at(-1).terminate();await pending;
    assert.equal(platform.recentLogs().length,2);
    assert.equal(platform.recentLogs()[0].groupId,id);
    assert.match(platform.recentLogs()[0].error,/closed/);
    assert.match(platform.recentLogs()[1].error,/timed out/);
    await until(()=>remote.sockets.length===2&&platform.groups().length===1);
    assert.equal(platform.groups()[0].id,id);
    remote.emit();remote.emit({message_id:102});await until(()=>platform.messageCount===2);
    assert.equal(platform.recentMessages()[0].authorId,authorId);
    assert.equal(plugin.remove(entry.id),true);assert.equal(platform.groups().length,0);
    await delay(60);assert.equal(remote.sockets.length,2);dispose();
});

test('wrong group or duplicate bot + group never creates a phantom client', async t=>{
    const remote=await bot(t);
    const platform=new Platform(new IdentityStore());
    const {plugin}=adapter(t,platform);
    plugin.add({address:remote.url,group_id:666});await until(()=>plugin.list()[0].status==='retrying');
    assert.equal(platform.groups().length,0);
    plugin.add({address:remote.url,group_id:555});await until(()=>platform.groups().length===1);
    // Same bot, different endpoint URL: duplicate is discovered after account verification.
    plugin.add({address:remote.url+'universal',group_id:555});
    await until(()=>plugin.list()[2].status==='retrying');assert.equal(platform.groups().length,1);
});

test('OneBot plugin switch stops all clients and pending deliveries, preserves settings and reconnects only when enabled',async t=>{
    const remote=await bot(t,{ignoreSend:true});
    const platform=new Platform(new IdentityStore());
    const directory=fs.mkdtempSync(path.join(os.tmpdir(),'chathub-onebot-switch-'));
    t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
    const config={host:'127.0.0.1',port:0,node_password:'nodes',onebot_token:'apps',dashboard_token:'dashboard',
        identity_file:'',onebot_adapter_file:path.join(directory,'clients.json'),plugin_state_file:path.join(directory,'plugins.json'),
        delivery_timeout_ms:200,onebot_reverse_urls:[],relay:{enabled:false,nodes:[]}};
    const server=new ChatHubServer(config,platform);
    const port=await server.start();t.after(()=>server.stop());
    const base=`http://127.0.0.1:${port}`;
    const write=(endpoint,method,body)=>fetch(base+endpoint,{method,headers:{Authorization:'Bearer dashboard','Content-Type':'application/json'},body:JSON.stringify(body)});
    const state=()=>fetch(base+'/api/dashboard',{headers:{Authorization:'Bearer dashboard'}}).then(r=>r.json());
    await write('/api/plugins/onebot/clients','POST',{address:remote.url,group_id:555});
    await until(()=>platform.groups().length===1);
    const id=platform.groups()[0].id;
    const pending=assert.rejects(platform.send(id,[{type:'text',text:'pending'}]),/closed/);
    assert.equal((await write('/api/plugins/onebot/state','PUT',{enabled:false})).status,200);
    await pending;
    assert.equal(platform.groups().length,0);
    let snapshot=await state();
    assert.equal(snapshot.pluginStates.onebot,false);
    assert.equal(snapshot.onebotAdapters.clients.length,1);
    assert.equal(snapshot.onebotAdapters.clients[0].status,'stopped');
    await delay(60);assert.equal(remote.sockets.length,1);
    // Adding while stopped persists the client but makes no connection.
    const second=await write('/api/plugins/onebot/clients','POST',{address:remote.url+'universal',group_id:555});
    assert.equal(second.status,201);assert.equal((await second.json()).client.status,'stopped');
    assert.equal((await state()).onebotAdapters.clients.length,2);
    assert.equal(remote.sockets.length,1);
    for(let i=0;i<3;i++) assert.equal((await write('/api/plugins/onebot/state','PUT',{enabled:true})).status,200);
    await until(()=>platform.groups().length===1);
    assert.equal(platform.groups()[0].id,id);
    assert.equal((await state()).pluginStates.onebot,true);
    assert.equal((await write('/api/plugins/onebot/state','PUT',{enabled:false})).status,200);
    const count=remote.sockets.length;await delay(60);assert.equal(remote.sockets.length,count);
    await server.stop();
    const restoredPlatform=new Platform(new IdentityStore());
    const restored=new ChatHubServer(config,restoredPlatform);const restoredPort=await restored.start();t.after(()=>restored.stop());
    await delay(60);assert.equal(remote.sockets.length,count);assert.equal(restoredPlatform.groups().length,0);
    snapshot=await (await fetch(`http://127.0.0.1:${restoredPort}/api/dashboard`,{headers:{Authorization:'Bearer dashboard'}})).json();
    assert.equal(snapshot.pluginStates.onebot,false);
    assert.equal(snapshot.onebotAdapters.clients.length,2);
    assert.ok(snapshot.onebotAdapters.clients.every(c=>c.status==='stopped'));
});

test('adapter settings are restricted, private, atomic and restored; corrupt files fail closed', async t=>{
    const remote=await bot(t);
    const directory=fs.mkdtempSync(path.join(os.tmpdir(),'chathub-onebot-'));
    t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
    const file=path.join(directory,'clients.json');
    const platform=new Platform(new IdentityStore());
    const {plugin,dispose}=adapter(t,platform,file);
    for (const input of [{address:'https://example.org',group_id:1},{address:'ws://user:pass@example.org',group_id:1},
        {address:'ws://example.org?access_token=secret',group_id:1},{address:remote.url,group_id:0},
        {address:remote.url,group_id:555,access_token:'bad\nheader'},{address:remote.url,group_id:555,extra:true}]) assert.throws(()=>plugin.add(input));
    const saved=plugin.add({address:remote.url,group_id:555,access_token:'private-token'});
    assert.throws(()=>plugin.add({address:remote.url,group_id:555}),/已经配置/);
    await until(()=>platform.groups().length===1);
    assert.equal(JSON.stringify(plugin.list()).includes('private-token'),false);
    assert.equal(fs.statSync(file).mode&0o777,0o600);assert.equal(fs.readdirSync(directory).length,1);
    dispose();
    const restored=adapter(t,platform,file).plugin;
    await until(()=>platform.groups().length===1);assert.equal(restored.list()[0].id,saved.id);
    restored.remove(saved.id);assert.deepEqual(JSON.parse(fs.readFileSync(file)).clients,[]);
    fs.writeFileSync(file,'{corrupt');assert.throws(()=>new OneBotAdapter(file,200));
});

test('authenticated dashboard can only add/remove adapter clients; secrets are never returned', async t=>{
    const remote=await bot(t), platform=new Platform(new IdentityStore());
    const server=new ChatHubServer({host:'127.0.0.1',port:0,node_password:'nodes',onebot_token:'apps',dashboard_token:'dashboard',
        identity_file:'',delivery_timeout_ms:200,onebot_reverse_urls:[],relay:{enabled:false,nodes:[]}},platform);
    const port=await server.start();t.after(()=>server.stop());
    const endpoint=`http://127.0.0.1:${port}/api/plugins/onebot/clients`;
    const post=(input,token='dashboard',extra={})=>fetch(endpoint,{method:'POST',
        headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json',...extra},body:JSON.stringify(input)});
    const input={address:remote.url,group_id:555,access_token:'bot-private'};
    for(const token of ['','nodes','apps','wrong'])assert.equal((await post(input,token)).status,401);
    assert.equal((await post(input,'dashboard',{Origin:'https://evil.example'})).status,403);
    assert.equal((await post({...input,group_id:'bad'})).status,400);
    assert.equal((await post({...input,access_token:'x'.repeat(9000)})).status,413);
    assert.equal((await fetch(endpoint,{method:'POST',headers:{Authorization:'Bearer dashboard','Content-Type':'application/json'},body:'invalid'})).status,400);
    assert.equal((await fetch(endpoint,{method:'POST',headers:{Authorization:'Bearer dashboard'},body:'{}'})).status,415);
    const response=await post(input);assert.equal(response.status,201);
    const body=await response.text();assert.equal(body.includes('bot-private'),false);
    const id=JSON.parse(body).client.id;
    assert.equal((await post(input)).status,409);
    await until(()=>platform.groups().length===1);
    const snapshot=await fetch(`http://127.0.0.1:${port}/api/dashboard`,{headers:{Authorization:'Bearer dashboard'}});
    const text=await snapshot.text();assert.equal(text.includes('bot-private'),false);
    assert.equal(JSON.parse(text).onebotAdapters.clients[0].status,'connected');
    assert.equal(JSON.parse(text).groups[0].kind,'onebot');
    assert.deepEqual(JSON.parse(text).onebotTraffic,[]); // Upstream verification APIs are not the ChatHub interface.
    assert.equal((await fetch(endpoint+'/'+id,{method:'DELETE',headers:{Authorization:'Bearer apps'}})).status,401);
    assert.equal((await fetch(endpoint+'/'+id,{method:'DELETE',headers:{Authorization:'Bearer dashboard'}})).status,200);
    assert.equal(platform.groups().length,0);
    assert.equal((await fetch(endpoint+'/'+id,{method:'DELETE',headers:{Authorization:'Bearer dashboard'}})).status,404);
    assert.equal((await fetch(endpoint,{method:'PUT',headers:{Authorization:'Bearer dashboard'}})).status,405);
});

test('OneBot stream observes only ChatHub public interface with abstract IDs, never upstream bot traffic',async t=>{
    const remote=await bot(t),platform=new Platform(new IdentityStore());
    const server=new ChatHubServer({host:'127.0.0.1',port:0,node_password:'nodes',onebot_token:'apps',dashboard_token:'dashboard',
        identity_file:'',delivery_timeout_ms:200,onebot_reverse_urls:[],relay:{enabled:false,nodes:[]}},platform);
    const port=await server.start();t.after(()=>server.stop());
    const base=`http://127.0.0.1:${port}`;
    const snapshot=()=>fetch(base+'/api/dashboard',{headers:{Authorization:'Bearer dashboard'}}).then(r=>r.json());
    await fetch(base+'/api/plugins/onebot/clients',{method:'POST',headers:{Authorization:'Bearer dashboard','Content-Type':'application/json'},
        body:JSON.stringify({address:remote.url,group_id:555})});
    await until(()=>platform.groups().length===1);
    const qq=platform.groups()[0];
    await platform.send(qq.id,[{type:'text',text:'upstream only'}]);
    remote.emit();await until(()=>platform.recentMessages().some(m=>m.origin==='player'));
    assert.deepEqual((await snapshot()).onebotTraffic,[]);

    const socket=new WebSocket(base.replace('http:','ws:')+'/onebot/v11',{headers:{Authorization:'Bearer apps'}});
    const lifecycle=once(socket,'message');await once(socket,'open');await lifecycle;
    const published=once(socket,'message');remote.emit({message_id:102});
    const event=JSON.parse((await published)[0].toString());
    assert.equal(event.group_id,qq.id);assert.notEqual(event.group_id,555);
    assert.notEqual(event.user_id,98765);assert.equal(event.self_id,1);

    const request={action:'send_group_msg',params:{group_id:qq.id,message:'from OneBot application'},echo:'abstract'};
    const replied=once(socket,'message');socket.send(JSON.stringify(request));
    const response=JSON.parse((await replied)[0].toString());
    assert.equal(response.status,'ok');
    assert.equal(remote.requests.at(-1).params.group_id,555); // Translation remains internal to the adapter.
    const traffic=(await snapshot()).onebotTraffic;
    assert.equal(traffic.length,4); // lifecycle, published event, application request and gateway response.
    assert.ok(traffic.every(entry=>entry.peer==='gateway'));
    assert.deepEqual(traffic[0].payload,response);assert.equal(traffic[0].direction,'sent');
    assert.deepEqual(traffic[1].payload,request);assert.equal(traffic[1].direction,'received');
    assert.deepEqual(traffic[2].payload,event);assert.equal(traffic[2].direction,'sent');
    assert.equal(traffic[2].groupId,qq.id);
    assert.equal(traffic.some(entry=>entry.action==='get_group_info'||entry.action==='get_group_member_info'),false);
    socket.close();await once(socket,'close');
});

test('explicit public origins work behind a Host-rewriting proxy without trusting forwarded headers or allowing CORS', async t=>{
    const remote=await bot(t), platform=new Platform(new IdentityStore());
    const publicOrigin='https://console.example:55555';
    const server=new ChatHubServer({host:'127.0.0.1',port:0,node_password:'nodes',onebot_token:'apps',dashboard_token:'dashboard',
        dashboard_origins:[publicOrigin],identity_file:'',delivery_timeout_ms:200,onebot_reverse_urls:[],relay:{enabled:false,nodes:[]}},platform);
    const port=await server.start();t.after(()=>server.stop());
    const base=`http://127.0.0.1:${port}`;
    const endpoint=base+'/api/plugins/onebot/clients';
    const post=(origin,extra={},token='dashboard')=>fetch(endpoint,{method:'POST',headers:{
        Authorization:`Bearer ${token}`,'Content-Type':'application/json',Origin:origin,...extra},body:'{}'});
    // Validation errors mean origin checks passed, with no settings changed.
    assert.equal((await post(base)).status,400);
    assert.equal((await post(publicOrigin)).status,400);
    for(const origin of ['https://evil.example','http://console.example:55555','https://console.example:55556',
        'https://console.example:55555.evil.example','null',publicOrigin+'/path',publicOrigin+'/',
        'https://user:pass@console.example:55555',`https://127.0.0.1:${port}`]) {
        assert.equal((await post(origin)).status,403,origin);
    }
    assert.equal((await post('https://evil.example',{'X-Forwarded-Host':'evil.example','X-Forwarded-Proto':'https',
        Forwarded:'host=evil.example;proto=https'})).status,403);
    assert.equal((await post(publicOrigin,{},'wrong')).status,401);
    const created=await fetch(endpoint,{method:'POST',headers:{Authorization:'Bearer dashboard','Content-Type':'application/json',
        Origin:publicOrigin},body:JSON.stringify({address:remote.url,group_id:555})});
    assert.equal(created.status,201);
    assert.equal(created.headers.has('access-control-allow-origin'),false);
    const {client}=await created.json();
    await until(()=>platform.groups().length===1);
    const remove=origin=>fetch(endpoint+'/'+client.id,{method:'DELETE',headers:{Authorization:'Bearer dashboard',Origin:origin}});
    assert.equal((await remove('https://evil.example')).status,403);
    assert.equal(platform.groups().length,1);
    assert.equal((await remove(publicOrigin)).status,200);
    assert.equal(platform.groups().length,0);
    const preflight=await fetch(endpoint,{method:'OPTIONS',headers:{Origin:'https://evil.example',
        'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'authorization,content-type'}});
    assert.equal(preflight.status,401);
    assert.equal(preflight.headers.has('access-control-allow-origin'),false);
});
