const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {Platform} = require('../server/dist/core/Platform');
const {IdentityStore} = require('../server/dist/storage/IdentityStore');
const {ChatHubServer} = require('../server/dist/server');
const {loadConfig} = require('../server/dist/config');

const player={uuid:'8667ba71-b85a-4004-af54-457a9734eed7',name:'Steve'};
const flush=()=>new Promise(resolve=>setImmediate(resolve));
async function fixture(t,extra={}) {
    const platform=new Platform(new IdentityStore());
    const config={host:'127.0.0.1',port:0,node_password:'nodes',onebot_token:'apps',dashboard_token:'dashboard',
        identity_file:'',delivery_timeout_ms:200,onebot_reverse_urls:[],relay:{enabled:false,nodes:[]},...extra};
    const server=new ChatHubServer(config,platform);
    const port=await server.start();t.after(()=>server.stop());
    const base=`http://127.0.0.1:${port}`;
    const set=(id,enabled,headers={})=>fetch(`${base}/api/plugins/${id}/state`,{method:'PUT',
        headers:{Authorization:'Bearer dashboard','Content-Type':'application/json',...headers},body:JSON.stringify({enabled})});
    const snapshot=async()=> (await fetch(base+'/api/dashboard',{headers:{Authorization:'Bearer dashboard'}})).json();
    return {platform,server,base,set,snapshot};
}

test('relay switch applies immediately, keeps blacklist policies and does not multiply subscriptions',async t=>{
    const {platform,set,snapshot}=await fixture(t,{relay:{enabled:false,nodes:[],blacklist:['private']}});
    const received=[];
    const a=platform.attach('a','A','online',[],{deliver:async()=>{}});
    platform.attach('b','B','online',[],{deliver:async delivery=>received.push(delivery)});
    platform.attach('private','Private','online',[],{deliver:async()=>assert.fail('blacklist ignored')});
    const chat=()=>platform.ingest(a.id,player,[{type:'text',text:'hello'}]);
    assert.deepEqual((await snapshot()).pluginStates,{onebot:true,relay:false});
    chat();await flush();assert.equal(received.length,0);
    for(let i=0;i<3;i++) assert.equal((await set('relay',true)).status,200);
    const message=chat();await flush();assert.equal(received.length,1);
    assert.equal(platform.message(received[0].messageId).sourceMessageId,message.id);
    assert.equal((await snapshot()).relay.enabled,true);
    assert.equal((await set('relay',false)).status,200);
    chat();await flush();assert.equal(received.length,1);
    assert.equal((await set('relay',true)).status,200);
    chat();await flush();assert.equal(received.length,2);
});

test('plugin switch API requires management credentials and same/explicit origin; only booleans and built-ins are accepted',async t=>{
    const {base,set,snapshot}=await fixture(t,{dashboard_origins:['https://console.example']});
    for(const credential of ['','nodes','apps','wrong']) assert.equal((await set('relay',true,{Authorization:`Bearer ${credential}`})).status,401);
    assert.equal((await set('relay',true,{Origin:'https://evil.example'})).status,403);
    assert.equal((await set('relay',true,{Origin:'https://evil.example','X-Forwarded-Host':'evil.example','X-Forwarded-Proto':'https'})).status,403);
    for(const value of ['true',1,null,{},[]]) assert.equal((await set('relay',value)).status,400);
    const raw=(body,headers={})=>fetch(base+'/api/plugins/relay/state',{method:'PUT',headers:{Authorization:'Bearer dashboard','Content-Type':'application/json',...headers},body});
    assert.equal((await raw('invalid')).status,400);
    assert.equal((await raw('{"enabled":true,"blacklist":[]}')).status,400);
    assert.equal((await raw('{}')).status,400);
    assert.equal((await raw('x'.repeat(9000))).status,413);
    assert.equal((await raw('{}',{'Content-Type':'text/plain'})).status,415);
    assert.equal((await set('untrusted-code',true)).status,404);
    assert.equal((await fetch(base+'/api/plugins/relay/state',{method:'POST',headers:{Authorization:'Bearer dashboard'}})).status,405);
    assert.equal((await snapshot()).relay.enabled,false);
    const response=await set('relay',true,{Origin:'https://console.example'});
    assert.equal(response.status,200);
    assert.equal(response.headers.get('cache-control'),'no-store');
    assert.equal(response.headers.has('access-control-allow-origin'),false);
    assert.deepEqual(await response.json(),{plugin:{id:'relay',enabled:true}});
    assert.equal((await set('relay',false,{Origin:base})).status,200);
});

test('plugin switches are atomically persisted and restored without overwriting unrelated config',async t=>{
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'chathub-switches-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
    const file=path.join(dir,'plugins.json');
    const first=await fixture(t,{plugin_state_file:file});
    await first.set('relay',true);await first.set('onebot',false);
    assert.equal(fs.statSync(file).mode&0o777,0o600);
    assert.deepEqual(JSON.parse(fs.readFileSync(file)),{version:1,enabled:{relay:true,onebot:false}});
    assert.deepEqual(fs.readdirSync(dir),['plugins.json']);
    await first.server.stop();
    const restored=await fixture(t,{plugin_state_file:file});
    assert.deepEqual((await restored.snapshot()).pluginStates,{onebot:false,relay:true});
    assert.equal((await restored.snapshot()).relay.enabled,true);
    assert.equal((await restored.set('relay',false)).status,200);
    assert.deepEqual((await restored.snapshot()).pluginStates,{onebot:false,relay:false});
});

test('failed plugin persistence leaves both the runtime and advertised state unchanged',async t=>{
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'chathub-switch-failure-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
    const file=path.join(dir,'plugins.json');
    const {set,snapshot}=await fixture(t,{plugin_state_file:file});
    fs.mkdirSync(file); // Rename must fail even when tests run as root.
    const response=await set('relay',true);
    assert.equal(response.status,500);
    assert.match((await response.json()).error,/无法保存插件开关/);
    assert.deepEqual((await snapshot()).pluginStates,{onebot:true,relay:false});
    assert.deepEqual(fs.readdirSync(dir),['plugins.json']);
});

test('corrupt or unsupported plugin state files fail closed; config resolves their storage path',t=>{
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'chathub-switch-invalid-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
    const file=path.join(dir,'plugins.json');
    const config={plugin_state_file:file,delivery_timeout_ms:200,relay:{enabled:false,nodes:[]}};
    for(const value of ['{corrupt',JSON.stringify({version:1,enabled:{relay:'true'}}),JSON.stringify({version:1,enabled:{arbitrary:true}})]) {
        fs.writeFileSync(file,value);
        assert.throws(()=>new ChatHubServer(config,new Platform(new IdentityStore())));
    }
    fs.writeFileSync(path.join(dir,'config.yaml'),'node_password: nodes\nonebot_token: apps\n');
    assert.equal(loadConfig(dir).plugin_state_file,path.join(dir,'data/plugins.json'));
});
