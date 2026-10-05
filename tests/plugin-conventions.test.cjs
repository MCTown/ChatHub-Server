const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {z}=require('zod');
const {Platform}=require('../server/dist/core/Platform');
const {IdentityStore}=require('../server/dist/storage/IdentityStore');
const {PluginRegistry,definePlugin}=require('../server/dist/plugins/PluginRegistry');
const {PluginControls}=require('../server/dist/plugins/PluginControls');
const {JsonConfigStore}=require('../server/dist/plugins/JsonConfigStore');
const {builtinPlugins,normalizePluginConfigurations,createBuiltinRegistry}=require('../server/dist/plugins/builtins');
const {loadConfig}=require('../server/dist/config');
const {ChatHubServer}=require('../server/dist/server');
const {OneBotAdapter}=require('../server/dist/plugins/OneBotAdapter');

const context={deliveryTimeoutMs:200};
function directory(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'chathub-plugin-spec-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;}
function definition(id,events=[],{failInstall=false,failEnable=false}={}) {
    return definePlugin({
        manifest:{id,name:`Plugin ${id}`,module:'TestPlugin',version:'1.0.0',kind:'business',icon:'puzzle',
            description:'test',settingsPanel:id,settingsMode:'readonly',help:'test',schemaVersion:1},
        configSchema:z.object({enabled:z.boolean().default(false),text:z.string().default('public'),token:z.string().default('secret')}).strict(),
        create(config){let enabled=config.enabled;return {
            name:id,
            install(){if(failInstall)throw new Error('install failed');events.push('start:'+id);return()=>events.push('stop:'+id);},
            setEnabled(value){if(value===enabled)return;if(failEnable&&value)throw new Error('private runtime error');enabled=value;events.push(`${id}:${value}`);},
        };},
        publicConfig:config=>({text:config.text}),
    });
}

test('registry validates stable IDs, duplicate registrations, lifecycle contracts and seals before startup',()=>{
    const registry=new PluginRegistry();
    registry.register(definition('demo'),{},context);
    assert.throws(()=>registry.register(definition('demo'),{},context),/already registered/);
    assert.throws(()=>registry.register(definition('Bad ID'),{},context));
    assert.throws(()=>registry.register(definition('other'),{enabled:'true'},context));
    const prerelease=definition('prerelease');prerelease.manifest.version='1.0.0-beta.1+build.7';registry.register(prerelease,{},context);
    for(const version of ['01.0.0','1.0.0-01','1.0','v1.0.0']) {
        const invalid=definition('bad-version');invalid.manifest.version=version;assert.throws(()=>registry.register(invalid,{},context));
    }
    const mismatch=definition('mismatch');
    const bad={...mismatch,bind:()=>({manifest:mismatch.manifest,instance:{name:'wrong'},defaultEnabled:false,publicConfig:()=>({})})};
    assert.throws(()=>registry.register(bad,{},context),/ID mismatch/);
    const lifecycle=definition('lifecycle');
    assert.throws(()=>registry.register({...lifecycle,bind:()=>({manifest:lifecycle.manifest,instance:{name:'lifecycle'},defaultEnabled:false,publicConfig:()=>({})})},{},context),/lifecycle/);
    registry.seal();assert.throws(()=>registry.register(definition('late'),{},context),/sealed/);
    assert.equal(registry.has('constructor'),false);
});

test('new registered plugins automatically receive state management, manifest snapshots and reverse-order cleanup',()=>{
    const events=[],registry=new PluginRegistry();
    registry.register(definition('first',events),{},context);registry.register(definition('extra-plugin',events),{enabled:true},context);
    const controls=new PluginControls(new Platform(new IdentityStore()),registry);
    controls.start();
    assert.deepEqual(controls.states(),{first:false,'extra-plugin':true});
    controls.setEnabled('first',true);controls.setEnabled('first',true);
    assert.equal(events.filter(event=>event==='first:true').length,1);
    assert.equal(controls.snapshot()[0].enabledSource,'persisted');
    assert.equal(controls.snapshot()[1].configuration.section,'plugins.extra-plugin');
    assert.throws(()=>controls.setEnabled('unregistered',true),/无效/);
    assert.throws(()=>registry.register(definition('after-start'),{},context),/sealed/);
    controls.close();assert.deepEqual(events.slice(-2),['stop:extra-plugin','stop:first']);
});

test('startup failure cleans prior plugins, and failed runtime switching rolls private state back',t=>{
    const events=[],registry=new PluginRegistry();
    registry.register(definition('first',events),{},context);registry.register(definition('broken',events,{failInstall:true}),{},context);
    const controls=new PluginControls(new Platform(new IdentityStore()),registry);
    assert.throws(()=>controls.start(),/install failed/);
    assert.deepEqual(events,['start:first','stop:first']);
    assert.throws(()=>controls.setEnabled('first',true),/尚未启动/);
    const file=path.join(directory(t),'states.json'),runtimeRegistry=new PluginRegistry();
    runtimeRegistry.register(definition('switch-failure',[],{failEnable:true}),{},context);
    const runtime=new PluginControls(new Platform(new IdentityStore()),runtimeRegistry,file);runtime.start();t.after(()=>runtime.close());
    assert.throws(()=>runtime.setEnabled('switch-failure',true),error=>{
        assert.equal(error.message.includes('private runtime error'),false);return /插件切换失败/.test(error.message);
    });
    assert.deepEqual(runtime.states(),{'switch-failure':false});
    assert.deepEqual(JSON.parse(fs.readFileSync(file)),{version:1,enabled:{}});
});

test('server releases its HTTP listener when registered plugin startup fails',async t=>{
    t.mock.method(OneBotAdapter.prototype,'install',()=>{throw new Error('fixture install failed');});
    const server=new ChatHubServer({host:'127.0.0.1',port:0,node_password:'nodes',onebot_token:'apps',
        identity_file:'',delivery_timeout_ms:200,onebot_reverse_urls:[],plugins:{onebot:{enabled:true},relay:{enabled:false}}},
        new Platform(new IdentityStore()));
    t.after(()=>server.stop());
    await assert.rejects(server.start(),/fixture install failed/);
    assert.equal(server.http.listening,false);
});

test('public manifests are isolated projections and never expose tokens or private storage paths',t=>{
    const privateFile=path.join(directory(t),'private','clients.json');
    const configs=normalizePluginConfigurations({onebot:{clients_file:privateFile},relay:{blacklist:['private']}});
    const registry=createBuiltinRegistry(configs,context);
    const publicSnapshot=registry.snapshot({onebot:true,relay:false});
    assert.deepEqual(publicSnapshot.map(plugin=>plugin.id),Object.keys(builtinPlugins));
    assert.deepEqual(publicSnapshot[0].configuration.values,{});
    assert.equal(JSON.stringify(publicSnapshot).includes('clients_file'),false);
    assert.equal(JSON.stringify(publicSnapshot).includes(privateFile),false);
    publicSnapshot[1].configuration.values.blacklist.push('changed');
    assert.deepEqual(registry.snapshot({onebot:true,relay:false})[1].configuration.values.blacklist,['private']);
    const extra=new PluginRegistry();extra.register(definition('projection'),{token:'must-not-leak'},context);
    assert.equal(JSON.stringify(extra.snapshot({projection:true})).includes('must-not-leak'),false);
});

test('canonical plugin configurations own their schema/defaults, reject unknown IDs and accept legacy aliases',t=>{
    const dir=directory(t),file=path.join(dir,'config.yaml');
    const base='node_password: nodes\nonebot_token: apps\n';
    fs.writeFileSync(file,base+'plugins:\n  onebot:\n    enabled: false\n    clients_file: custom/clients.json\n  relay:\n    enabled: true\n    blacklist: [private]\n');
    let config=loadConfig(dir);
    assert.equal(config.plugins.onebot.enabled,false);
    assert.equal(config.plugins.onebot.clients_file,path.join(dir,'custom/clients.json'));
    assert.equal(config.onebot_adapter_file,config.plugins.onebot.clients_file);
    assert.deepEqual(config.plugins.relay,{enabled:true,nodes:[],blacklist:['private'],include_system:true});
    assert.deepEqual(config.relay,config.plugins.relay);
    fs.writeFileSync(file,base+'relay: {enabled: true}\nonebot_adapter_file: legacy/clients.json\n');
    config=loadConfig(dir);assert.equal(config.plugins.relay.enabled,true);
    assert.equal(config.plugins.onebot.clients_file,path.join(dir,'legacy/clients.json'));
    fs.writeFileSync(file,base+'relay: {enabled: true}\nplugins: {relay: {enabled: false}}\n');
    assert.equal(loadConfig(dir).plugins.relay.enabled,false);
    for(const plugins of [{unknown:{}},{relay:{enabeld:true}},{onebot:{enabled:'false'}},{relay:{blacklist:[' ']}},{onebot:{clients_file:''}}]) {
        fs.writeFileSync(file,base+'plugins: '+JSON.stringify(plugins)+'\n');assert.throws(()=>loadConfig(dir));
    }
});

test('shared JSON config store validates versions, is atomic/private and isolates memory from caller mutations',t=>{
    const dir=directory(t),file=path.join(dir,'store.json');
    const schema=z.object({version:z.literal(1),values:z.array(z.string())}).strict();
    const store=new JsonConfigStore(file,schema,{version:1,values:[]},'测试配置');
    const input={version:1,values:['saved']};store.write(input);input.values.push('external');
    const result=store.read();result.values.push('external');assert.deepEqual(store.read().values,['saved']);
    assert.equal(fs.statSync(file).mode&0o777,0o600);assert.deepEqual(fs.readdirSync(dir),['store.json']);
    assert.throws(()=>store.write({version:2,values:[]}));assert.deepEqual(store.read().values,['saved']);
    assert.deepEqual(new JsonConfigStore(file,schema,{version:1,values:[]},'测试配置').read().values,['saved']);
    fs.writeFileSync(file,'{"version":2,"values":[]}');assert.throws(()=>new JsonConfigStore(file,schema,{version:1,values:[]},'测试配置'));
    fs.writeFileSync(file,'{broken');assert.throws(()=>new JsonConfigStore(file,schema,{version:1,values:[]},'测试配置'));
    fs.writeFileSync(file,'{"token":"must-not-leak", broken}');
    assert.throws(()=>new JsonConfigStore(file,schema,{version:1,values:[]},'测试配置'),error=>{
        assert.equal(error.message.includes('must-not-leak'),false);return /拒绝重置/.test(error.message);
    });
    assert.throws(()=>new JsonConfigStore(undefined,z.object({values:z.array(z.string())}),{values:[]},'缺少版本'));
    const memory=new JsonConfigStore(undefined,schema,{version:1,values:[]},'测试配置');memory.write({version:1,values:['memory']});
    assert.deepEqual(memory.read().values,['memory']);
});

test('registry API and dashboard publish the same authenticated manifests, including default/persisted enable sources',async t=>{
    const platform=new Platform(new IdentityStore());
    const server=new ChatHubServer({host:'127.0.0.1',port:0,node_password:'nodes',onebot_token:'apps',dashboard_token:'dashboard',
        identity_file:'',delivery_timeout_ms:200,onebot_reverse_urls:[],plugins:{onebot:{enabled:false},relay:{enabled:false,blacklist:['private']}}},platform);
    const port=await server.start();t.after(()=>server.stop());
    const base=`http://127.0.0.1:${port}`,headers={Authorization:'Bearer dashboard'};
    assert.equal((await fetch(base+'/api/plugins')).status,401);
    const response=await fetch(base+'/api/plugins',{headers});assert.equal(response.headers.get('cache-control'),'no-store');
    let registry=(await response.json()).plugins;
    const dashboard=await (await fetch(base+'/api/dashboard',{headers})).json();
    assert.deepEqual(registry,dashboard.plugins);assert.deepEqual(dashboard.pluginStates,{onebot:false,relay:false});
    assert.ok(registry.every(plugin=>plugin.enabledSource==='default'));
    assert.equal(registry[1].configuration.section,'plugins.relay');
    assert.equal(JSON.stringify(registry).includes('clients_file'),false);
    await fetch(base+'/api/plugins/relay/state',{method:'PUT',headers:{...headers,'Content-Type':'application/json'},body:'{"enabled":true}'});
    registry=(await (await fetch(base+'/api/plugins',{headers})).json()).plugins;
    assert.equal(registry[1].enabled,true);assert.equal(registry[1].enabledSource,'persisted');
});
