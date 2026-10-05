const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {once} = require('node:events');
const WebSocket = require('ws');
const {Platform} = require('../server/dist/core/Platform');
const {IdentityStore} = require('../server/dist/storage/IdentityStore');
const {ChatHubServer} = require('../server/dist/server');
const {loadConfig} = require('../server/dist/config');

async function fixture(t, extra = {}) {
    const platform = new Platform(new IdentityStore());
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(),'chathub-dashboard-data-'));
    t.after(() => fs.rmSync(dataDir,{recursive:true,force:true}));
    const server = new ChatHubServer({host:'127.0.0.1',port:0,node_password:'nodes-secret',
        onebot_token:'apps-secret',dashboard_token:'dashboard-secret',identity_file:'',
        delivery_timeout_ms:200,onebot_reverse_urls:[],relay:{enabled:false,nodes:[],include_system:true},
        settings_file:path.join(dataDir,'settings.json'),image_directory:path.join(dataDir,'images'),...extra},platform);
    const port = await server.start();
    t.after(() => server.stop());
    const url = `http://127.0.0.1:${port}`;
    const read = (endpoint='/api/dashboard', token='dashboard-secret', options={}) => fetch(url+endpoint,
        {...options,headers:{Authorization:`Bearer ${token}`,...options.headers}});
    return {platform,read,url};
}

test('dashboard serves built assets with CSP and exposes no arbitrary files', async t => {
    const {read} = await fixture(t);
    for (const [endpoint,type] of [['/','text/html'],['/assets/app.js','text/javascript'],
        ['/assets/styles.css','text/css'],['/assets/logo.svg','image/svg+xml']]) {
        const response = await read(endpoint);
        assert.equal(response.status,200);
        assert.ok(response.headers.get('content-type').startsWith(type));
        assert.match(response.headers.get('content-security-policy'),/script-src 'self'/);
        assert.equal(response.headers.get('x-content-type-options'),'nosniff');
        assert.ok((await response.text()).length>0);
    }
    assert.equal((await read('/server/config.yaml')).status,404);
    assert.equal((await read('/assets/../config.yaml')).status,404);
    assert.equal((await read('/api/dashboard','dashboard-secret',{method:'POST'})).status,405);
});

test('dashboard deep routes serve the authenticated shell for reloads, never arbitrary paths or unknown APIs',async t=>{
    const {read}=await fixture(t);
    const root=await (await read('/')).text();
    for(const endpoint of ['/chat','/chat/','/nodes','/messages','/logs','/plugins','/settings','/guide','/plugins/','/messages?source=bookmark']) {
        const response=await read(endpoint);
        assert.equal(response.status,200,endpoint);
        assert.match(response.headers.get('content-type'),/^text\/html/);
        assert.match(response.headers.get('content-security-policy'),/script-src 'self'/);
        assert.equal(await response.text(),root);
    }
    assert.match(root,/id="workspace" hidden/);
    for(const endpoint of ['/unknown','/api/not-found','/plugins/not-a-route','/assets/missing.js','/plugins//','/data/plugins.json']) {
        assert.equal((await read(endpoint)).status,404,endpoint);
    }
    for(const [view,href] of [['overview','/'],['nodes','/nodes'],['messages','/messages'],['logs','/logs'],['plugins','/plugins'],['settings','/settings'],['guide','/guide']]) {
        assert.ok(root.includes(`data-view="${view}" href="${href}"`));
    }
});

test('login page uses the existing stylesheet and every referenced asset is served with its MIME type', async t => {
    const {read} = await fixture(t);
    const html = await (await read('/')).text();
    assert.doesNotMatch(html,/blue\.css/);
    const stylesheets = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map(match => match[1]);
    assert.deepEqual(stylesheets,['/assets/styles.css','/assets/chat.css']);
    const types = {css:'text/css',js:'text/javascript',svg:'image/svg+xml'};
    for (const match of html.matchAll(/(?:src|href)="(\/assets\/[^"?]+)"/g)) {
        const asset = await read(match[1]);
        assert.equal(asset.status,200,match[1]);
        assert.ok(asset.headers.get('content-type').startsWith(types[path.extname(match[1]).slice(1)]),match[1]);
    }
    const css = await (await read(stylesheets[0])).text();
    assert.match(css,/--accent: #2563eb/);
    assert.match(css,/\.login-page\s*\{/);
});

test('dashboard requires a separate Bearer credential, never query tokens or OneBot/node passwords', async t => {
    const {read} = await fixture(t);
    for (const token of ['','wrong','nodes-secret','apps-secret']) assert.equal((await read('/api/dashboard',token)).status,401);
    assert.equal((await read('/api/dashboard?access_token=dashboard-secret','')).status,401);
    const response = await read();
    assert.equal(response.status,200);
    assert.equal(response.headers.get('cache-control'),'no-store');
    assert.equal(response.headers.get('access-control-allow-origin'),null);
    const body = await response.text();
    for (const secret of ['nodes-secret','apps-secret','dashboard-secret']) assert.equal(body.includes(secret),false);
    const d = JSON.parse(body);
    assert.deepEqual(d.groups,[]);
    assert.deepEqual(d.messages,[]);
    assert.deepEqual(d.logs,[]);
    assert.deepEqual(d.onebotTraffic,[]);
    assert.equal(d.stats.onlinePlayers,0);
});

test('missing dashboard token disables data API but leaves login page accessible and workspace initially hidden', async t => {
    const {read} = await fixture(t,{dashboard_token:undefined});
    assert.equal((await read()).status,503);
    const page = await read('/');
    assert.equal(page.status,200);
    const html = await page.text();
    assert.match(html,/id="login-page"/);
    assert.match(html,/id="workspace" hidden/);
    assert.doesNotMatch(html,/enter-demo|demo-banner/);
});

test('dashboard includes gateway requests, success/failure replies and events without creating chat',async t=>{
    const {read,url,platform}=await fixture(t);
    const socket=new WebSocket(url.replace('http:','ws:')+'/onebot/v11',{headers:{Authorization:'Bearer apps-secret'}});
    await once(socket,'open');
    const call=async request=>{
        const reply=once(socket,'message');socket.send(JSON.stringify(request));
        return JSON.parse((await reply)[0].toString());
    };
    const request={action:'get_login_info',params:{access_token:'sensitive'},echo:{id:1}};
    assert.equal((await call(request)).status,'ok');
    assert.equal((await call({action:'unsupported',echo:'failed'})).status,'failed');
    const snapshot=await (await read()).json();
    const traffic=snapshot.onebotTraffic;
    assert.equal(traffic.length,5);
    assert.equal(traffic.at(-1).payload.meta_event_type,'lifecycle');
    assert.deepEqual(traffic.slice(0,4).map(entry=>[entry.direction,entry.kind]),
        [['sent','response'],['received','request'],['sent','response'],['received','request']]);
    assert.equal(traffic[0].action,'unsupported');
    assert.equal(traffic[0].payload.retcode,1404);
    assert.deepEqual(traffic[2].payload.echo,{id:1});
    assert.equal(traffic[3].payload.params.access_token,'[已脱敏]');
    assert.doesNotMatch(JSON.stringify(snapshot),/sensitive|apps-secret/);
    assert.equal(platform.messageCount,0);
    assert.deepEqual(snapshot.messages,[]);
    assert.equal((await read('/api/dashboard','apps-secret')).status,401);
    socket.close();await once(socket,'close');
});

test('OneBot connection details reveal only the gateway credential on an explicit authenticated request', async t => {
    const {read,url} = await fixture(t);
    const endpoint='/api/onebot/connection';
    for (const token of ['', 'wrong', 'nodes-secret', 'apps-secret']) {
        assert.equal((await read(endpoint,token)).status,401);
    }
    assert.equal((await read(endpoint+'?access_token=dashboard-secret','')).status,401);
    assert.equal((await read(endpoint,'dashboard-secret',{method:'POST'})).status,405);
    const response=await read(endpoint,'dashboard-secret',{headers:{Authorization:'Bearer dashboard-secret',Origin:url}});
    assert.equal(response.status,200);
    assert.equal(response.headers.get('cache-control'),'no-store');
    assert.equal(response.headers.get('access-control-allow-origin'),null);
    const details=await response.json();
    assert.deepEqual(details,{self_id:1,system_user_id:2,access_token:'apps-secret',path:'/onebot/v11',
        direct_urls:[{name:'监听地址',url:url.replace('http:','ws:')+'/onebot/v11'}]});
    for (const secret of ['nodes-secret','dashboard-secret']) assert.equal(JSON.stringify(details).includes(secret),false);
    for (const route of ['/api/dashboard','/','/assets/app.js']) assert.equal((await (await read(route)).text()).includes('apps-secret'),false);
    const app=new WebSocket(details.direct_urls[0].url+'/api',{headers:{Authorization:`Bearer ${details.access_token}`}});
    await once(app,'open');
    app.send(JSON.stringify({action:'get_login_info',echo:'connection-details'}));
    const [raw]=await once(app,'message');
    assert.equal(JSON.parse(raw.toString()).data.user_id,details.self_id);
    app.close();await once(app,'close');
});

test('OneBot connection details require management credentials and ignore request origin', async t => {
    const disabled=await fixture(t,{dashboard_token:undefined});
    assert.equal((await disabled.read('/api/onebot/connection')).status,503);
    const enabled=await fixture(t);
    assert.equal((await enabled.read('/api/onebot/connection','dashboard-secret',{
        headers:{Authorization:'Bearer dashboard-secret',Origin:'https://any.example'},
    })).status,200);
});

test('node connection details reveal the MCDR node password only to authenticated management requests', async t => {
    const {read,url} = await fixture(t);
    const endpoint='/api/native/connection';
    for (const token of ['', 'wrong', 'nodes-secret', 'apps-secret']) {
        assert.equal((await read(endpoint,token)).status,401, token || 'missing');
    }
    assert.equal((await read(endpoint,'dashboard-secret',{method:'POST'})).status,405);
    const response=await read(endpoint,'dashboard-secret');
    assert.equal(response.status,200);
    assert.equal(response.headers.get('cache-control'),'no-store');
    assert.equal(response.headers.get('access-control-allow-origin'),null);
    const details=await response.json();
    assert.deepEqual(details,{access_token:'nodes-secret',path:'/chathub/v2/connect',
        direct_urls:[{name:'监听地址',url:url.replace('http:','ws:')+'/chathub/v2/connect'}]});
    for (const secret of ['apps-secret','dashboard-secret']) assert.equal(JSON.stringify(details).includes(secret),false);
    for (const route of ['/api/dashboard','/','/assets/app.js']) assert.equal((await (await read(route)).text()).includes('nodes-secret'),false);
    const disabled=await fixture(t,{dashboard_token:undefined});
    assert.equal((await disabled.read(endpoint)).status,503);
});

test('OneBot connection details include an explicitly configured public WS address for LAN callers',async t=>{
    const public_url='wss://console.example:55555/onebot/v11';
    const {read}=await fixture(t,{onebot_public_url:public_url});
    const response=await read('/api/onebot/connection');
    assert.equal(response.status,200);
    const details=await response.json();
    assert.equal(details.public_url,public_url);
    assert.equal(details.access_token,'apps-secret');
    assert.match(details.direct_urls[0].url,/^ws:\/\/127\.0\.0\.1:/);
});

test('public OneBot URL config rejects credentials and non-Universal URLs and supports an environment override',t=>{
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'chathub-public-url-'));
    t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
    const previous=process.env.CHATHUB_ONEBOT_PUBLIC_URL;
    t.after(()=>{if(previous===undefined)delete process.env.CHATHUB_ONEBOT_PUBLIC_URL;else process.env.CHATHUB_ONEBOT_PUBLIC_URL=previous;});
    delete process.env.CHATHUB_ONEBOT_PUBLIC_URL;
    const write=value=>fs.writeFileSync(path.join(dir,'config.yaml'),JSON.stringify({node_password:'node',onebot_token:'bot',onebot_public_url:value}));
    const publicUrl='wss://console.example:55555/onebot/v11';
    write(publicUrl);assert.equal(loadConfig(dir).onebot_public_url,publicUrl);
    for(const invalid of ['https://console.example/onebot/v11','wss://user:password@console.example/onebot/v11',
        'wss://console.example/onebot/v11?access_token=secret','wss://console.example/onebot/v11/api','wss://console.example/onebot/v11#secret']) {
        write(invalid);assert.throws(()=>loadConfig(dir));
    }
    process.env.CHATHUB_ONEBOT_PUBLIC_URL=publicUrl;
    write('invalid');assert.equal(loadConfig(dir).onebot_public_url,publicUrl);
});

test('dashboard exposes relay blacklist and defaults it for legacy configurations', async t => {
    const legacy = await fixture(t);
    assert.deepEqual((await (await legacy.read()).json()).relay.blacklist,[]);
    const relay = {enabled:true,nodes:[],blacklist:['private','onebot:123:555'],include_system:false};
    const configured = await fixture(t,{relay});
    assert.deepEqual((await (await configured.read()).json()).relay,
        {enabled:true,nodes:[],blacklist:relay.blacklist,includeSystem:false});
});

test('snapshot includes presence, incoming and delivered messages without changing event semantics', async t => {
    const {platform,read} = await fixture(t);
    const p = {uuid:'8667ba71-b85a-4004-af54-457a9734eed7',name:'Steve'};
    const transport = {deliver:async()=>{}};
    const a = platform.attach('a','<unsafe>','online',[p],transport);
    const b = platform.attach('b','B','online',[p],transport);
    platform.ingest(a.id,p,[{type:'text',text:'<img src=x onerror=alert(1)>'}]);
    platform.system(a.id,'death','Steve died');
    const events = [];
    platform.subscribe(e=>events.push(e));
    await platform.send(b.id,[{type:'text',text:'Application delivery'}]);
    assert.deepEqual(events,[]);
    let snapshot = await (await read()).json();
    assert.equal(snapshot.stats.groups,2);
    assert.equal(snapshot.stats.onlinePlayers,1); // same virtual user in two worlds
    assert.equal(snapshot.stats.messages,3);
    assert.deepEqual(snapshot.messages.map(m=>m.origin),['application','system','player']);
    assert.equal(snapshot.groups[0].members[0].uuid,p.uuid);
    assert.equal(snapshot.messages[2].segments[0].text,'<img src=x onerror=alert(1)>');
    platform.presence(a.id,p,false);
    platform.detach(b.id,transport);
    snapshot = await (await read()).json();
    assert.equal(snapshot.stats.onlinePlayers,0);
    assert.equal(snapshot.groups.length,1);
    assert.equal(snapshot.groups[0].members[0].online,false);
});

test('dashboard lists live gateway application services and roles without URL credentials, and removes disconnected peers', async t => {
    const upstream = new WebSocket.Server({host:'127.0.0.1',port:0});
    await once(upstream,'listening');
    t.after(async()=>{for(const socket of upstream.clients)socket.terminate();await new Promise(resolve=>upstream.close(resolve));});
    const reverseAddress=`ws://private-user:private-password@127.0.0.1:${upstream.address().port}/application?access_token=private-query-token&role=Event`;
    const reverseConnected=once(upstream,'connection');
    const {read,url}=await fixture(t,{onebot_reverse_urls:[reverseAddress]});
    const [reverseSocket]=await reverseConnected;
    const reverseMessage=once(reverseSocket,'message');
    await reverseMessage; // Gateway is attached and has sent its lifecycle event.
    const sockets=[];
    for(const suffix of ['', '/api', '/event']) {
        const socket=new WebSocket(url.replace('http:','ws:')+'/onebot/v11'+suffix+'?access_token=apps-secret');
        sockets.push(socket);await once(socket,'open');
    }
    const response=await read(),d=await response.json();
    assert.deepEqual(d.stats.onebot,{forward:3,reverse:1});
    assert.equal(d.onebotApplications.length,4);
    assert.equal(new Set(d.onebotApplications.map(app=>app.id)).size,4);
    const forward=d.onebotApplications.filter(app=>app.direction==='forward');
    assert.deepEqual(forward.map(app=>app.role).sort(),['API','Event','Universal']);
    for(const app of forward) {
        assert.match(app.address,/^127\.0\.0\.1:\d+$/);
        assert.deepEqual(Object.keys(app).sort(),['address','direction','id','role']);
    }
    const reverse=d.onebotApplications.find(app=>app.direction==='reverse');
    assert.equal(reverse.role,'Event');
    assert.equal(reverse.address,`ws://127.0.0.1:${upstream.address().port}/application`);
    assert.doesNotMatch(JSON.stringify(d),/private-user|private-password|private-query-token|access_token=|apps-secret/);
    assert.ok(d.onebotTraffic.some(frame=>frame.connectionId===reverse.id));
    for(const socket of sockets) {const closed=once(socket,'close');socket.close();await closed;}
    let remaining=await (await read()).json();
    assert.deepEqual(remaining.stats.onebot,{forward:0,reverse:1});
    assert.deepEqual(remaining.onebotApplications,[reverse]);
    const closed=once(reverseSocket,'close');reverseSocket.close();await closed;
    remaining=await (await read()).json();
    assert.deepEqual(remaining.stats.onebot,{forward:0,reverse:0});assert.deepEqual(remaining.onebotApplications,[]);
});

test('dashboard counts actual OneBot channels, not node connections', async t => {
    const {url,read} = await fixture(t);
    const app = new WebSocket(url.replace('http:','ws:')+'/onebot/v11/api',{headers:{Authorization:'Bearer apps-secret'}});
    await once(app,'open');
    assert.deepEqual((await (await read()).json()).stats.onebot,{forward:1,reverse:0});
    app.close(); await once(app,'close');
    assert.equal((await (await read()).json()).stats.onebot.forward,0);
});

test('authenticated snapshots expose failure logs even after the target disconnects, not failed chat messages', async t => {
    const {platform,read} = await fixture(t);
    const transport = {deliver:async()=>{throw new Error('<unsafe> delivery rejected');}};
    const target = platform.attach('target','<Target>','online',[],transport);
    await assert.rejects(platform.send(target.id,[{type:'text',text:'failed payload'}]),/rejected/);
    platform.detach(target.id,transport);
    assert.equal((await read('/api/dashboard','apps-secret')).status,401);
    const response = await read();
    assert.equal(response.headers.get('cache-control'),'no-store');
    const snapshot = await response.json();
    assert.deepEqual(snapshot.groups,[]);
    assert.deepEqual(snapshot.messages,[]);
    assert.equal(snapshot.logs.length,1);
    assert.equal(snapshot.logs[0].groupName,'<Target>');
    assert.equal(snapshot.logs[0].nodeId,'target');
    assert.equal(snapshot.logs[0].error,'<unsafe> delivery rejected');
    assert.equal(JSON.stringify(snapshot.logs).includes('failed payload'),false);
    assert.equal(snapshot.traces[0].preview,'failed payload');
    assert.equal(snapshot.traces[0].steps.find(step=>step.kind==='delivery').status,'failed');
    assert.equal(snapshot.traces[0].steps.some(step=>Object.hasOwn(step,'payload')),false);
});

test('trace detail is authenticated, bounded to known IDs and loaded separately from polling',async t=>{
    const {platform,read}=await fixture(t);
    const group=platform.attach('a','A','online',[],{deliver:async()=>{}});
    const message=platform.system(group.id,'notice','trace test');
    const endpoint=`/api/traces/${message.traceId}`;
    for(const token of ['','wrong','nodes-secret','apps-secret'])assert.equal((await read(endpoint,token)).status,401);
    assert.equal((await read(endpoint+'?access_token=dashboard-secret','')).status,401);
    assert.equal((await read(endpoint,'dashboard-secret',{method:'POST'})).status,405);
    const response=await read(endpoint);
    assert.equal(response.headers.get('cache-control'),'no-store');
    assert.equal(response.headers.get('access-control-allow-origin'),null);
    const trace=await response.json();
    assert.equal(trace.id,message.traceId);assert.equal(trace.steps[0].payload.systemKind,'notice');
    const compact=await (await read('/api/dashboard?trace_view=1')).json();
    assert.deepEqual(compact.messages,[]);assert.deepEqual(compact.onebotTraffic,[]);
    assert.equal(compact.traces.length,1);
    assert.equal(compact.traces[0].steps.some(step=>Object.hasOwn(step,'payload')),false);
    assert.equal((await read('/api/traces/00000000-0000-0000-0000-000000000000')).status,404);
    assert.equal((await read('/api/traces/../../config.yaml')).status,404);
});

test('recentMessages is bounded, newest first, and isolated from cache mutation', () => {
    const platform = new Platform(new IdentityStore());
    const g = platform.attach('a','A','online',[],{deliver:async()=>{}});
    for (let i=0;i<1002;i++) platform.system(g.id,'startup',String(i));
    assert.equal(platform.messageCount,1000);
    assert.equal(platform.recentMessages().length,150);
    assert.equal(platform.recentMessages(1005).length,1000);
    for (const limit of [0,-1,NaN,Infinity]) assert.deepEqual(platform.recentMessages(limit),[]);
    const recent = platform.recentMessages(1);
    assert.equal(recent[0].segments[0].text,'1001');
    recent[0].segments[0].text='mutated';
    assert.equal(platform.message(recent[0].id).segments[0].text,'1001');
});

test('dashboard credential loads from config or environment and rejects newlines', t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(),'chathub-dashboard-'));
    t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
    const old = process.env.CHATHUB_DASHBOARD_TOKEN;
    t.after(()=>{if(old===undefined)delete process.env.CHATHUB_DASHBOARD_TOKEN;else process.env.CHATHUB_DASHBOARD_TOKEN=old;});
    const file = path.join(dir,'config.yaml');
    fs.writeFileSync(file,'node_password: nodes\nonebot_token: apps\ndashboard_token: configured\n');
    delete process.env.CHATHUB_DASHBOARD_TOKEN;
    assert.equal(loadConfig(dir).dashboard_token,'configured');
    process.env.CHATHUB_DASHBOARD_TOKEN='env-dashboard';
    assert.equal(loadConfig(dir).dashboard_token,'env-dashboard');
    process.env.CHATHUB_DASHBOARD_TOKEN='bad\nvalue';
    assert.throws(()=>loadConfig(dir),/Invalid dashboard token/);
});

const PNG_1X1 = 'base64://iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

test('群聊发送只接受独立 Dashboard Token，严格校验请求并返回已投递消息', async t => {
    const {platform,read} = await fixture(t);
    const transport = {deliver: async delivery => { assert.deepEqual(delivery.segments,[{type:'text',text:'hello'}]); }};
    const group = platform.attach('chat-node','生存世界','online',[],transport);
    const post = (body, token='dashboard-secret', headers={}) => read('/api/chat/messages',token,{
        method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});

    for (const token of ['', 'wrong', 'nodes-secret', 'apps-secret']) {
        assert.equal((await post({group_id:group.id,text:'no'},token)).status,401,token || 'missing');
    }
    assert.equal((await read('/api/chat/messages','dashboard-secret')).status,405);
    assert.equal((await post({group_id:group.id,text:'hello',extra:true})).status,400);
    assert.equal((await post({group_id:group.id,text:'   '})).status,400);
    assert.equal((await post({group_id:group.id,text:'hello',image:'https://evil.example/photo.png'})).status,400);
    assert.equal((await post({group_id:String(group.id),text:'hello'})).status,400);
    assert.equal((await post({group_id:group.id,text:'x'.repeat(8001)})).status,400);

    const response = await post({group_id:group.id,text:'hello'});
    assert.equal(response.status,201);
    const result = await response.json();
    assert.equal(result.message.groupId,group.id);
    assert.equal(result.message.authorName,'ChatHub');
    assert.deepEqual(result.message.segments,[{type:'text',text:'hello'}]);
    assert.equal(result.message.origin,'application');
    assert.equal(platform.messageCount,1);
});

test('群聊发送要求在线虚拟群，图片经过 ImageStore 校验并只公开同源媒体文件', async t => {
    const publicUrl = 'https://chat.example.test';
    const {platform,read} = await fixture(t,{public_url:publicUrl});
    const deliveries=[];
    const group = platform.attach('image-node','图片世界','online',[],{deliver:async delivery=>deliveries.push(delivery)});
    const post = body => read('/api/chat/messages','dashboard-secret',{
        method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});

    const response = await post({group_id:group.id,text:'看图',image:PNG_1X1});
    assert.equal(response.status,201);
    const {message} = await response.json();
    assert.equal(message.segments.length,2);
    assert.equal(message.segments[0].text,'看图');
    assert.match(message.segments[1].url,/^https:\/\/chat\.example\.test\/media\/images\/[0-9a-f]{64}\.png$/);
    assert.deepEqual(deliveries[0].segments,message.segments);

    const mediaPath = new URL(message.segments[1].url).pathname;
    const media = await read(mediaPath,'');
    assert.equal(media.status,200);
    assert.equal(media.headers.get('content-type'),'image/png');
    assert.equal(media.headers.get('content-security-policy'),'default-src \'none\'; sandbox');
    assert.ok((await media.arrayBuffer()).byteLength > 0);
    assert.equal((await read('/media/images/not-a-real-file.png','')).status,404);
    assert.equal((await read('/media/images/../../config.yaml','')).status,404);

    const bad = await post({group_id:group.id,text:'bad',image:'base64://not-an-image'});
    assert.equal(bad.status,400);
    assert.match((await bad.json()).error,/图片无效|base64 图片编码无效/);
    assert.equal(platform.messageCount,1);
    const snapshot = await (await read('/api/dashboard?trace_view=1&chat_view=1')).json();
    assert.equal(snapshot.messages[0].id,message.id);
});

test('群聊图片没有公网地址时失败且不会进入消息缓存，离线群也不会处理图片', async t => {
    const {platform,read} = await fixture(t);
    const transport = {deliver:async()=>{}};
    const group = platform.attach('offline-image','离线前的世界','online',[],transport);
    const post = body => read('/api/chat/messages','dashboard-secret',{
        method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const missingOrigin = await post({group_id:group.id,text:'图片',image:PNG_1X1});
    assert.equal(missingOrigin.status,400);
    assert.match((await missingOrigin.json()).error,/未设置公网地址/);
    assert.equal(platform.messageCount,0);
    platform.detach(group.id,transport);
    const unknown = await post({group_id:group.id,text:'不会发送',image:PNG_1X1});
    assert.equal(unknown.status,400);
    assert.match((await unknown.json()).error,/offline|unknown|离线|未知/);
});

test('chat_view=1 returns the bounded recent chat stream while trace polling remains compact', async t => {
    const {platform,read} = await fixture(t);
    const group = platform.attach('history','历史世界','online',[],{deliver:async()=>{}});
    for (let i=0;i<1000;i++) platform.system(group.id,'test',String(i));
    const compact = await (await read('/api/dashboard?trace_view=1')).json();
    assert.deepEqual(compact.messages,[]);
    const chat = await (await read('/api/dashboard?trace_view=1&chat_view=1')).json();
    assert.equal(chat.messages.length,1000);
    assert.equal(chat.messages[0].segments[0].text,'999');
    assert.equal(chat.messages.at(-1).segments[0].text,'0');
});
