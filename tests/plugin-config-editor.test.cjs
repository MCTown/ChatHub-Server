const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {z}=require('zod');
const {Platform}=require('../server/dist/core/Platform');
const {IdentityStore}=require('../server/dist/storage/IdentityStore');
const {ChatHubServer}=require('../server/dist/server');
const {PluginRegistry,definePlugin}=require('../server/dist/plugins/PluginRegistry');
const {PluginControls}=require('../server/dist/plugins/PluginControls');
const {buildConfigEditor}=require('../server/dist/plugins/ConfigEditor');

async function fixture(t,extra={}) {
    const platform=new Platform(new IdentityStore());
    const server=new ChatHubServer({host:'127.0.0.1',port:0,node_password:'nodes',onebot_token:'apps',dashboard_token:'dashboard',
        identity_file:'',delivery_timeout_ms:200,onebot_reverse_urls:[],relay:{enabled:true,nodes:[],blacklist:[],include_system:true},...extra},platform);
    const port=await server.start();t.after(()=>server.stop());
    const base=`http://127.0.0.1:${port}`,headers={Authorization:'Bearer dashboard','Content-Type':'application/json'};
    const get=async(id='relay')=>(await (await fetch(`${base}/api/plugins/${id}/config`,{headers})).json()).plugin;
    const put=(plugin,values,extra={})=>fetch(`${base}/api/plugins/${plugin.id}/config`,{method:'PUT',headers:{...headers,...extra},
        body:JSON.stringify({schemaVersion:plugin.schemaVersion,revision:plugin.configuration.revision,values})});
    return {platform,server,base,headers,get,put};
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const player={uuid:'8667ba71-b85a-4004-af54-457a9734eed7',name:'Steve'};
const temporary=t=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'chathub-editor-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;};

test('editor metadata derives types, default values and constraints from Zod; unsafe/unsupported fields are rejected',()=>{
    const schema=z.object({enabled:z.boolean(),hidden:z.string(),flag:z.boolean().default(true),
        title:z.string().min(2).max(80).default('Default'),limit:z.number().int().min(1).max(50).default(5),
        mode:z.enum(['compact','full']).default('full'),nodes:z.array(z.string()).min(1).max(20).default(['a'])}).strict();
    const presentations=['flag','title','limit','mode','nodes'].map(key=>({key,label:key}));
    const editor=buildConfigEditor(schema,presentations,['hidden']);
    const fields=Object.fromEntries(editor.fields.map(field=>[field.key,field]));
    assert.equal(fields.flag.type,'boolean');assert.equal(fields.flag.default,true);
    assert.equal(fields.title.type,'string');assert.equal(fields.title.minLength,2);assert.equal(fields.title.maxLength,80);
    assert.equal(fields.limit.type,'number');assert.equal(fields.limit.integer,true);assert.equal(fields.limit.minimum,1);assert.equal(fields.limit.maximum,50);
    assert.deepEqual(fields.mode.options,['compact','full']);assert.equal(fields.mode.default,'full');
    assert.equal(fields.nodes.type,'string-array');assert.equal(fields.nodes.minItems,1);assert.equal(fields.nodes.maxItems,20);
    for(const key of ['enabled','hidden','missing','constructor']) assert.throws(()=>buildConfigEditor(schema,[{key,label:key}],['hidden']));
    assert.throws(()=>buildConfigEditor(schema,[presentations[0],presentations[0]],[]));
    assert.throws(()=>buildConfigEditor(z.object({nested:z.object({value:z.string()})}),[{key:'nested',label:'Nested'}],[]));
});

test('configuration endpoint exposes public editor metadata and strictly validates authentication and field types',async t=>{
    const {base,headers,get,put}=await fixture(t);
    const plugin=await get();
    assert.equal(plugin.configuration.editable,true);assert.equal(plugin.configuration.applyMode,'live');
    assert.equal(plugin.configuration.section,'plugins.relay');assert.match(plugin.configuration.revision,/^[a-f0-9]{64}$/);
    assert.deepEqual(plugin.configuration.fields.map(field=>field.key),['nodes','blacklist','include_system']);
    assert.equal(plugin.configuration.fields[0].type,'string-array');assert.equal(plugin.configuration.fields[2].default,true);
    const onebot=await get('onebot');assert.equal(onebot.configuration.editable,false);
    assert.equal(JSON.stringify(onebot).includes('clients_file'),false);
    for(const token of ['','nodes','apps','wrong']) assert.equal((await fetch(base+'/api/plugins/relay/config',{headers:{Authorization:`Bearer ${token}`}})).status,401);
    for(const values of [{nodes:[1]}, {blacklist:['']}, {include_system:'true'}, {enabled:false}, {clients_file:'/etc/passwd'}, {unknown:1},null,[]]) {
        const response=await put(plugin,values);assert.equal(response.status,400,JSON.stringify(values));
    }
    const invalid=await put(plugin,{include_system:'true'});assert.ok((await invalid.json()).fieldErrors.include_system);
    assert.equal((await put(onebot,{})).status,405);
    assert.equal((await fetch(base+'/api/plugins/missing/config',{headers})).status,404);
    assert.equal((await fetch(base+'/api/plugins/relay/config',{method:'POST',headers,body:'{}'})).status,405);
    assert.equal((await put(plugin,{}, {'Content-Type':'text/plain'})).status,415);
    assert.equal((await fetch(base+'/api/plugins/relay/config',{method:'PUT',headers,body:'{malformed'})).status,400);
    assert.equal((await fetch(base+'/api/plugins/relay/config',{method:'PUT',headers,body:'x'.repeat(9000)})).status,413);
    assert.deepEqual((await get()).configuration.values,plugin.configuration.values);
});

test('live configuration immediately updates relay policy, preserves enabled state and rejects stale revisions',async t=>{
    const {platform,headers,base,get,put}=await fixture(t);
    const a=platform.attach('a','A','online',[],{deliver:async()=>{}}), received=[],blocked=[];
    platform.attach('b','B','online',[],{deliver:async value=>received.push(value)});
    platform.attach('private','Private','online',[],{deliver:async value=>blocked.push(value)});
    const original=await get();
    let response=await put(original,{blacklist:['private'],include_system:false});assert.equal(response.status,200);
    let saved=(await response.json()).plugin;
    assert.equal(saved.enabled,true);assert.equal(saved.configuration.source,'persisted');assert.deepEqual(saved.configuration.values.nodes,[]);
    platform.ingest(a.id,player,[{type:'text',text:'new policy'}]);platform.system(a.id,'startup','ignored');await flush();
    assert.equal(received.length,1);assert.equal(blocked.length,0);
    response=await put(original,{blacklist:[]});assert.equal(response.status,409);
    assert.deepEqual((await response.json()).plugin.configuration.values.blacklist,['private']);
    assert.equal((await put({...saved,schemaVersion:2},{})).status,409);
    await fetch(base+'/api/plugins/relay/state',{method:'PUT',headers,body:'{"enabled":false}'});
    saved=await get();response=await put(saved,{blacklist:[],include_system:true});assert.equal(response.status,200);
    assert.equal((await response.json()).plugin.enabled,false);
    platform.ingest(a.id,player,[{type:'text',text:'still disabled'}]);await flush();assert.equal(received.length,1);
});

test('editable overrides survive restart alongside switches, maintain 0600 atomic storage and leave YAML untouched',async t=>{
    const dir=temporary(t),file=path.join(dir,'plugins.json'),yaml=path.join(dir,'config.yaml');
    fs.writeFileSync(yaml,'plugins: {relay: {enabled: true}}\n');const before=fs.readFileSync(yaml,'utf8');
    const first=await fixture(t,{plugin_state_file:file});
    assert.equal((await first.put(await first.get(),{nodes:['a','b'],blacklist:['private'],include_system:false})).status,200);
    await fetch(first.base+'/api/plugins/onebot/state',{method:'PUT',headers:first.headers,body:'{"enabled":false}'});
    const persisted=JSON.parse(fs.readFileSync(file));
    assert.deepEqual(persisted.config.relay,{schemaVersion:1,values:{nodes:['a','b'],blacklist:['private'],include_system:false}});
    assert.equal(persisted.enabled.onebot,false);assert.equal(fs.statSync(file).mode&0o777,0o600);
    assert.equal(fs.readFileSync(yaml,'utf8'),before);assert.deepEqual(fs.readdirSync(dir).sort(),['config.yaml','plugins.json']);
    await first.server.stop();
    const restored=await fixture(t,{plugin_state_file:file,relay:{enabled:false,nodes:['startup'],blacklist:[],include_system:true}});
    const plugin=await restored.get();assert.deepEqual(plugin.configuration.values,persisted.config.relay.values);
    assert.equal(plugin.enabled,false);assert.equal((await restored.get('onebot')).enabled,false);
});

test('failed persistence cannot change effective configuration, and corrupt/unregistered saved config fails closed',async t=>{
    const dir=temporary(t),file=path.join(dir,'plugins.json');
    const server=await fixture(t,{plugin_state_file:file});fs.mkdirSync(file);
    const original=await server.get();const response=await server.put(original,{blacklist:['private']});
    assert.equal(response.status,500);assert.deepEqual((await server.get()).configuration.values,original.configuration.values);
    assert.deepEqual(fs.readdirSync(dir),['plugins.json']);
    const invalidFile=path.join(dir,'invalid.json');
    for(const config of [{unknown:{schemaVersion:1,values:{}}}, {onebot:{schemaVersion:1,values:{clients_file:'secret'}}},
        {relay:{schemaVersion:2,values:{}}}, {relay:{schemaVersion:1,values:{nodes:[],blacklist:[],include_system:'true'}}}]) {
        fs.writeFileSync(invalidFile,JSON.stringify({version:1,enabled:{},config}));
        assert.throws(()=>new ChatHubServer({plugin_state_file:invalidFile,delivery_timeout_ms:200,relay:{enabled:false,nodes:[]}},new Platform(new IdentityStore())));
    }
});

test('editor apply failures roll runtime and file back, and private projections cannot become editable',t=>{
    const file=path.join(temporary(t),'plugins.json');let effective='old';
    const definition=definePlugin({manifest:{id:'custom',name:'Custom',module:'Custom',version:'1.0.0',kind:'business',icon:'puzzle',
        description:'Custom',settingsPanel:'custom',settingsMode:'managed',help:'help',schemaVersion:1},
        configSchema:z.object({enabled:z.boolean().default(false),text:z.string().default('old'),token:z.string().default('secret')}).strict(),
        create:()=>({name:'custom',install:()=>()=>{},setEnabled(){}}),publicConfig:config=>({text:config.text}),
        editor:{fields:[{key:'text',label:'Text'}],apply(instance,config){effective=config.text;if(config.text==='broken')throw new Error('private exception');}}});
    const registry=new PluginRegistry();registry.register(definition,{}, {deliveryTimeoutMs:200});
    const controls=new PluginControls(new Platform(new IdentityStore()),registry,file);controls.start();t.after(()=>controls.close());
    const initial=controls.configuration('custom');
    assert.throws(()=>controls.setConfiguration('custom',1,initial.configuration.revision,{text:'broken'}),error=>{
        assert.equal(error.message.includes('private exception'),false);return /应用配置失败/.test(error.message);
    });
    assert.equal(effective,'old');assert.deepEqual(controls.configuration('custom').configuration.values,{text:'old'});
    assert.deepEqual(JSON.parse(fs.readFileSync(file)),{version:1,enabled:{}});
    const privateDefinition=definePlugin({...definition,editor:{fields:[{key:'token',label:'Token'}],apply(){}}});
    assert.throws(()=>new PluginRegistry().register(privateDefinition,{}, {deliveryTimeoutMs:200}),/fully public/);
});
