const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {once} = require('node:events');
const {randomBytes} = require('node:crypto');
const WebSocket = require('ws');
const sharp = require('sharp');
const {Platform} = require('../server/dist/core/Platform');
const {IdentityStore} = require('../server/dist/storage/IdentityStore');
const {ChatHubServer} = require('../server/dist/server');
const {PlatformSettings} = require('../server/dist/storage/PlatformSettings');
const {ImageStore, MAX_IMAGE_BYTES, IMAGE_TTL_MS} = require('../server/dist/storage/ImageStore');
const {loadConfig} = require('../server/dist/config');

const base64 = buffer => 'base64://' + buffer.toString('base64');
const raster = () => sharp({create:{width:2,height:2,channels:3,background:'#2563eb'}});
function temporary(t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chathub-images-'));
    t.after(() => fs.rmSync(dir,{recursive:true,force:true}));
    return dir;
}
async function fixture(t, extra={}) {
    const directory = temporary(t);
    const platform = new Platform(new IdentityStore());
    const deliveries=[];
    const group=platform.attach('images','Image target','online',[],{deliver:async delivery=>deliveries.push(delivery)});
    const config={host:'127.0.0.1',port:0,node_password:'nodes',onebot_token:'apps',dashboard_token:'admin',
        identity_file:'',delivery_timeout_ms:1000,onebot_reverse_urls:[],relay:{enabled:false,nodes:[]},
        settings_file:path.join(directory,'settings.json'),image_directory:path.join(directory,'images'),...extra};
    const server=new ChatHubServer(config,platform);
    const port=await server.start();
    t.after(()=>server.stop());
    const url=`http://127.0.0.1:${port}`;
    const api=(endpoint='/api/settings',options={})=>fetch(url+endpoint,{...options,
        headers:{Authorization:'Bearer admin','Content-Type':'application/json',...options.headers}});
    const setOrigin=async public_url=>{
        const {settings}=await (await api()).json();
        return api('/api/settings',{method:'PUT',body:JSON.stringify({public_url,revision:settings.revision})});
    };
    const socket=new WebSocket(url.replace('http:','ws:')+'/onebot/v11/api',{headers:{Authorization:'Bearer apps'}});
    await once(socket,'open');
    let nextEcho=0;
    const call=async (action,params)=>{
        const reply=once(socket,'message');
        socket.send(JSON.stringify({action,params,echo:++nextEcho}));
        const result=JSON.parse((await reply)[0].toString());
        assert.equal(result.echo,nextEcho);
        return result;
    };
    const send=message=>call('send_group_msg',{group_id:group.id,message});
    return {directory,platform,group,deliveries,config,url,api,setOrigin,call,send};
}

test('missing public origin fails base64 sends in the API and logs page data, without delivery or storage',async t=>{
    const f=await fixture(t);
    const encoded=base64(await raster().png().toBuffer());
    const reply=await f.send([{type:'image',data:{file:encoded}}]);
    assert.equal(reply.status,'failed');assert.equal(reply.retcode,1400);
    assert.match(reply.message,/未设置公网地址.*平台设置/);
    assert.equal(f.deliveries.length,0);assert.equal(f.platform.messageCount,0);
    assert.equal(fs.existsSync(f.config.image_directory),false);
    const snapshot=await (await f.api('/api/dashboard')).json();
    assert.equal(snapshot.logs.length,1);assert.equal(snapshot.logs[0].groupId,f.group.id);
    assert.equal(snapshot.logs[0].groupName,'Image target');assert.equal(snapshot.logs[0].origin,'application');
    assert.match(snapshot.logs[0].error,/未设置公网地址/);
    assert.equal(JSON.stringify(snapshot.logs).includes(encoded),false);
    assert.equal(snapshot.traces[0].steps.find(step=>step.kind==='core').status,'failed');
    assert.equal((await f.send([{type:'image',data:{file:'https://example.org/existing.png'}}])).status,'ok');
    assert.equal((await f.call('can_send_image')).data.yes,true);
});

test('settings are authenticated, strict, origin-checked, revision-checked and persisted without exposing private paths',async t=>{
    const f=await fixture(t);
    for(const token of ['', 'apps', 'nodes']) {
        assert.equal((await f.api('/api/settings',{headers:{Authorization:'Bearer '+token}})).status,401);
    }
    const initial=await (await f.api()).json();
    assert.equal(initial.settings.public_url,'');
    assert.equal((await f.api('/api/settings',{method:'POST'})).status,405);
    assert.equal((await f.api('/api/settings',{method:'PUT',headers:{'Content-Type':'text/plain'}})).status,415);
    assert.equal((await f.api('/api/settings',{method:'PUT',headers:{Origin:'https://evil.example'},
        body:JSON.stringify({...initial.settings,public_url:f.url})})).status,403);
    for(const public_url of ['wss://example.org','https://example.org/path','https://user:pass@example.org',
        'https://example.org?token=secret','https://example.org#fragment','not a URL']) {
        assert.equal((await f.setOrigin(public_url)).status,400,public_url);
    }
    assert.equal((await f.api('/api/settings',{method:'PUT',body:JSON.stringify({...initial.settings,
        public_url:f.url,image_directory:'/etc'})})).status,400);
    const saved=await f.setOrigin(' https://images.example.org:8443/ ');
    assert.equal(saved.status,200);assert.equal(saved.headers.get('cache-control'),'no-store');
    assert.equal(saved.headers.get('access-control-allow-origin'),null);
    assert.equal((await saved.json()).settings.public_url,'https://images.example.org:8443');
    const reloaded=new PlatformSettings(f.config.settings_file);
    assert.equal(reloaded.snapshot().public_url,'https://images.example.org:8443');
    assert.equal(fs.statSync(f.config.settings_file).mode & 0o777,0o600);
    assert.equal((await f.api('/api/settings',{method:'PUT',body:JSON.stringify(initial.settings)})).status,409);
    const details=await (await f.api('/api/onebot/connection')).json();
    assert.equal(details.public_url,'wss://images.example.org:8443/onebot/v11');
    const snapshot=await (await f.api('/api/dashboard')).text();
    assert.equal(snapshot.includes(f.directory),false);
    assert.equal((await f.api('/settings')).status,200);
});

test('PNG/JPEG/GIF/WebP uploads become downloadable URLs, roundtrip through get_msg, and support CQ/send_msg',async t=>{
    const f=await fixture(t);
    assert.equal((await f.setOrigin(f.url)).status,200);
    for(const format of ['png','jpeg','gif','webp']) {
        const buffer=await raster()[format]().toBuffer();
        const reply=await f.send([{type:'text',data:{text:'photo'}},{type:'image',data:{file:base64(buffer)}}]);
        assert.equal(reply.status,'ok',JSON.stringify(reply));
        const delivery=f.deliveries.at(-1), image=delivery.segments[1];
        const extension=format==='jpeg'?'jpg':format;
        assert.match(image.url,new RegExp('^'+f.url+'/media/images/[0-9a-f]{64}\\.'+extension+'$'));
        assert.equal(JSON.stringify(delivery).includes('base64://'),false);
        const response=await fetch(image.url); // No credentials: real ChatImage download.
        assert.equal(response.status,200);
        assert.equal(response.headers.get('content-type'),'image/'+format);
        assert.equal(response.headers.get('x-content-type-options'),'nosniff');
        const downloaded=Buffer.from(await response.arrayBuffer());
        assert.equal((await sharp(downloaded).metadata()).format,format);
        const head=await fetch(image.url,{method:'HEAD'});
        assert.equal(head.status,200);assert.equal(await head.text(),'');
        assert.equal(Number(head.headers.get('content-length')),downloaded.length);
        const message=await f.call('get_msg',{message_id:reply.data.message_id});
        assert.equal(message.data.message[1].data.file,image.url);
    }
    const buffer=await raster().png().toBuffer();
    assert.equal((await f.send('[CQ:image,file='+base64(buffer)+']')).status,'ok');
    assert.equal((await f.call('send_msg',{group_id:f.group.id,message_type:'group',message:[{type:'image',data:{file:base64(buffer)}}]})).status,'ok');
    assert.equal(f.platform.recentLogs().length,0);
    assert.equal((await f.setOrigin('')).status,200);
    assert.equal((await f.send([{type:'image',data:{file:base64(buffer)}}])).status,'failed');
});

test('invalid encoding, unsupported formats, truncated raster and excess pixels fail safely and log once',async t=>{
    const f=await fixture(t);await f.setOrigin(f.url);
    const png=await raster().png().toBuffer();
    const oversizedPixels=await sharp({create:{width:4100,height:4100,channels:3,background:'white'}}).png().toBuffer();
    for(const file of ['base64://','base64://!!!!','base64://YWJj\n','base64://AB==',base64(Buffer.from('not an image')),
        base64(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>')),
        base64(png.subarray(0,png.length-15)),base64(oversizedPixels),'base64://'+'A'.repeat(Math.ceil(MAX_IMAGE_BYTES/3)*4+4)]) {
        const before=f.platform.recentLogs().length;
        const reply=await f.send([{type:'image',data:{file}}]);
        assert.equal(reply.retcode,1400,JSON.stringify(reply));assert.equal(reply.status,'failed');
        assert.equal(f.platform.recentLogs().length,before+1);
        assert.equal(f.deliveries.length,0);assert.equal(f.platform.messageCount,0);
    }
    assert.equal(fs.existsSync(f.config.image_directory),false);
});

test('GIF and WebP retain animation frames, timing and loop after validation',async t=>{
    const f=await fixture(t);await f.setOrigin(f.url);
    const raw=Buffer.concat([Buffer.from([255,0,0,255,0,0,255,0,0,255,0,0]),
        Buffer.from([0,0,255,0,0,255,0,0,255,0,0,255])]);
    for (const format of ['gif','webp']) {
        const encoded=await sharp(raw,{raw:{width:2,height:4,channels:3,pageHeight:2}})[format]({delay:[100,200],loop:0}).toBuffer();
        const reply=await f.send([{type:'image',data:{file:base64(encoded)}}]);
        assert.equal(reply.status,'ok',JSON.stringify(reply));
        const bytes=Buffer.from(await (await fetch(f.deliveries.at(-1).segments[0].url)).arrayBuffer());
        const metadata=await sharp(bytes,{animated:true}).metadata();
        assert.equal(metadata.format,format);assert.equal(metadata.pages,2);assert.equal(metadata.pageHeight,2);
        assert.equal(metadata.loop,0);assert.deepEqual(metadata.delay,[100,200]);
    }
});

test('large valid base64 frames exceed the old 256 KiB limit but are accepted on OneBot',async t=>{
    const f=await fixture(t);await f.setOrigin(f.url);
    const input=randomBytes(600*600*3);
    const png=await sharp(input,{raw:{width:600,height:600,channels:3}}).png().toBuffer();
    assert.ok(png.length>256*1024);
    const reply=await f.send([{type:'image',data:{file:base64(png)}}]);
    assert.equal(reply.status,'ok',JSON.stringify(reply));
    const downloaded=Buffer.from(await (await fetch(f.deliveries[0].segments[0].url)).arrayBuffer());
    assert.deepEqual(await sharp(downloaded).raw().toBuffer(),input);
});

test('reverse OneBot API connections accept large base64 frames using the same image pipeline',async t=>{
    const peer=new WebSocket.WebSocketServer({host:'127.0.0.1',port:0});
    await once(peer,'listening');
    t.after(()=>{for(const socket of peer.clients)socket.terminate();return new Promise(resolve=>peer.close(resolve));});
    const connection=once(peer,'connection');
    const f=await fixture(t,{onebot_reverse_urls:[`ws://127.0.0.1:${peer.address().port}/reverse?role=API`]});
    await f.setOrigin(f.url);
    const [socket]=await connection;
    const png=await sharp(randomBytes(400*400*3),{raw:{width:400,height:400,channels:3}}).png().toBuffer();
    assert.ok(png.length>256*1024);
    const message=once(socket,'message');
    socket.send(JSON.stringify({action:'send_group_msg',echo:'reverse-image',params:{group_id:f.group.id,
        message:[{type:'image',data:{file:base64(png)}}]}}));
    const reply=JSON.parse((await message)[0]);
    assert.equal(reply.echo,'reverse-image');assert.equal(reply.status,'ok',JSON.stringify(reply));
    assert.equal((await fetch(f.deliveries[0].segments[0].url)).status,200);
});

test('an explicit public OneBot gateway remains independent of the image download origin',async t=>{
    const f=await fixture(t,{onebot_public_url:'wss://gateway.example.org/onebot/v11'});
    await f.setOrigin('https://images.example.org');
    const details=await (await f.api('/api/onebot/connection')).json();
    assert.equal(details.public_url,'wss://gateway.example.org/onebot/v11');
});

test('general platform settings save independently of unavailable image storage',async t=>{
    const dir=temporary(t), blocked=path.join(dir,'blocked');fs.writeFileSync(blocked,'not a directory');
    const f=await fixture(t,{image_directory:blocked});
    assert.equal((await f.setOrigin('https://platform.example.org')).status,200);
    assert.equal(new PlatformSettings(f.config.settings_file).snapshot().public_url,'https://platform.example.org');
    assert.equal((await f.setOrigin('')).status,200);
    assert.equal(fs.readFileSync(blocked,'utf8'),'not a directory');
    assert.equal(f.deliveries.length,0);assert.equal(f.platform.recentLogs().length,0);
});

test('cache paths cannot expose private files; expiration, pruning, quota and write errors are bounded',async t=>{
    const dir=temporary(t), settings=new PlatformSettings(undefined,'https://images.example.org');
    const origin=()=>settings.snapshot().public_url;
    const images=new ImageStore(path.join(dir,'images'),origin), png=await raster().png().toBuffer();
    const url=await images.ingest(base64(png)), name=url.split('/').at(-1);
    assert.ok(await images.read(name));
    for(const invalid of ['../settings.json','%2e%2e%2fsettings.json',name+'/../secret',name+'.html','x.png']) {
        assert.equal(await images.read(invalid),undefined);
    }
    const secret=path.join(dir,'private');fs.writeFileSync(secret,'secret');
    const link='b'.repeat(64)+'.png';fs.symlinkSync(secret,path.join(dir,'images',link));
    assert.equal(await images.read(link),undefined);
    const old=new Date(Date.now()-IMAGE_TTL_MS-1000);
    fs.utimesSync(path.join(dir,'images',name),old,old);
    assert.equal(await images.read(name),undefined);
    await images.ingest(base64(png));assert.equal(fs.existsSync(path.join(dir,'images',name)),false);
    const full=path.join(dir,'images','c'.repeat(64)+'.png');
    const fd=fs.openSync(full,'w');fs.ftruncateSync(fd,256*1024*1024);fs.closeSync(fd);
    await assert.rejects(images.ingest(base64(png)),/256 MiB/);
    fs.unlinkSync(full);
    assert.ok(await images.ingest(base64(png))); // A failure never poisons the serial queue.
    const blocked=path.join(dir,'blocked');fs.writeFileSync(blocked,'file');
    await assert.rejects(new ImageStore(blocked,origin).ingest(base64(png)),/保存失败/);
});

test('public origin config validates deployment values and resolves private data paths',t=>{
    const directory=temporary(t), previous=process.env.CHATHUB_PUBLIC_URL;
    t.after(()=>{if(previous===undefined)delete process.env.CHATHUB_PUBLIC_URL;else process.env.CHATHUB_PUBLIC_URL=previous;});
    delete process.env.CHATHUB_PUBLIC_URL;
    const write=public_url=>fs.writeFileSync(path.join(directory,'config.yaml'),JSON.stringify({node_password:'nodes',onebot_token:'apps',public_url}));
    write('https://images.example.org/');
    assert.equal(loadConfig(directory).public_url,'https://images.example.org');
    assert.equal(loadConfig(directory).settings_file,path.join(directory,'data/settings.json'));
    assert.equal(loadConfig(directory).image_directory,path.join(directory,'data/images'));
    write('wss://images.example.org');assert.throws(()=>loadConfig(directory));
    process.env.CHATHUB_PUBLIC_URL='https://override.example.org';
    assert.equal(loadConfig(directory).public_url,'https://override.example.org');
});
