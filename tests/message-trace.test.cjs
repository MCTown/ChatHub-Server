const {test} = require('node:test');
const assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');
const WebSocket = require('ws');
const {TraceStore} = require('../server/dist/core/TraceStore');
const {Platform} = require('../server/dist/core/Platform');
const {IdentityStore} = require('../server/dist/storage/IdentityStore');
const {OneBotGateway} = require('../server/dist/adapters/onebot/Gateway');
const {OneBotTraffic} = require('../server/dist/adapters/onebot/Traffic');
const {installCrossServerRelay} = require('../server/dist/plugins/CrossServerRelay');
const player = {uuid:'8667ba71-b85a-4004-af54-457a9734eed7',name:'Steve'};
const text = value => [{type:'text',text:value}];
const tick = () => new Promise(resolve=>setImmediate(resolve));

class Socket extends EventEmitter {
    readyState = WebSocket.OPEN;
    bufferedAmount = 0;
    frames = [];
    send(raw, callback) { this.frames.push(JSON.parse(raw)); callback?.(this.sendError); }
    terminate() { this.readyState = WebSocket.CLOSED; this.emit('close'); }
    close() { this.terminate(); }
}

test('trace snapshots redact, bound data, omit polled payloads and isolate callers',()=>{
    const store=new TraceStore();
    const id=store.start('player','hello',{kind:'source',label:'A'},{password:'private',nested:{Authorization:'hidden'}});
    const step=store.add(id,'1',{kind:'delivery',label:'B'},'processing',{segments:text('hello')});
    assert.equal(store.get(id).steps[0].payload.password,'[已脱敏]');
    assert.doesNotMatch(JSON.stringify(store.get(id)),/private|hidden/);
    assert.equal(store.recent()[0].steps.some(step=>Object.hasOwn(step,'payload')),false);
    const read=store.get(id);read.steps[0].label='mutated';read.steps[1].payload.segments[0].text='mutated';
    const recent=store.recent();recent[0].steps[0].label='mutated';
    assert.equal(store.get(id).steps[0].label,'A');
    assert.equal(store.get(id).steps[1].payload.segments[0].text,'hello');
    store.finish(id,step,'confirmed');store.finish(id,step,'failed','late callback');
    assert.equal(store.get(id).steps[1].status,'confirmed');
    assert.ok(store.get(id).steps[1].durationMs>=0);
    for(let i=0;i<120;i++)store.add(id,'1',{kind:'onebot',label:'x'.repeat(10000)},'sent',{value:'x'.repeat(30000)});
    const trace=store.get(id);
    assert.equal(trace.steps.length,100);assert.equal(trace.truncated,true);
    assert.ok(trace.steps.reduce((size,step)=>size+(JSON.stringify(step.payload)?.length||0),0)<=24000);
    assert.ok(trace.steps.every(step=>step.label.length<=200));
    for(const limit of [0,-1,NaN,Infinity])assert.deepEqual(store.recent(limit),[]);
});

test('trace retention is per root and late async completions never resurrect evicted traces',()=>{
    const store=new TraceStore();
    const first=store.start('player','first',{kind:'source',label:'A'});
    const pending=store.add(first,'1',{kind:'delivery',label:'B'},'processing');
    for(let i=0;i<1000;i++)store.start('player',String(i),{kind:'source',label:'A'});
    assert.equal(store.get(first),undefined);
    store.finish(first,pending,'confirmed');
    assert.equal(store.add(first,'1',{kind:'onebot',label:'late'},'sent'),undefined);
    assert.equal(store.recent(1000).length,1000);
    assert.equal(store.recent(1)[0].preview,'999');
    assert.equal(new TraceStore().recent().length,0);
});

test('core folds successful and failed relay deliveries into the source, without altering chat events',async()=>{
    const platform=new Platform(new IdentityStore()),events=[];
    const a=platform.attach('a','A','online',[],{deliver:async()=>{}});
    platform.attach('b','B','online',[],{deliver:async()=>{}});
    const c=platform.attach('c','C','online',[],{deliver:async()=>{throw new Error('MC offline');}});
    platform.subscribe(event=>events.push(event));
    const uninstall=installCrossServerRelay(platform,{enabled:true});
    const message=platform.ingest(a.id,player,text('/help'),{eventId:'native-help',payload:{type:'chat',event_id:'native-help'}});
    await tick();uninstall();
    const trace=platform.traces.get(message.traceId);
    assert.equal(platform.traces.recent().length,1);
    assert.equal(trace.steps[0].eventId,'native-help');
    assert.equal(trace.steps[0].messageId,message.id);
    assert.deepEqual(trace.steps.filter(step=>step.parentId==='2').map(step=>[step.label,step.status]),
        [['CrossServerRelay → B','confirmed'],['CrossServerRelay → C','failed']]);
    assert.equal(trace.steps.find(step=>step.groupId===c.id).error,'MC offline');
    assert.equal(events.filter(event=>event.type==='message').length,1);
    assert.equal(platform.recentMessages().filter(msg=>msg.sourceMessageId===message.id)[0].traceId,message.traceId);
});

test('offline and timeout application attempts have visible traces but never accepted chat',async()=>{
    const platform=new Platform(new IdentityStore());
    await assert.rejects(platform.send(123,text('offline')),/offline/);
    const group=platform.attach('target','Target','online',[],{deliver:async()=>{throw new Error('acknowledgement timed out');}});
    await assert.rejects(platform.send(group.id,text('timeout')),/timed out/);
    assert.equal(platform.messageCount,0);
    assert.deepEqual(platform.traces.recent().map(trace=>trace.steps.find(step=>step.kind==='delivery').status),['timeout','failed']);
});

test('gateway correlates concurrent identical/no-echo requests by trace, not content or echo',async()=>{
    const platform=new Platform(new IdentityStore()),pending=[];
    const group=platform.attach('a','A','online',[],{deliver:delivery=>new Promise(resolve=>pending.push({delivery,resolve}))});
    const traffic=new OneBotTraffic(),gateway=new OneBotGateway(platform,traffic),socket=new Socket();gateway.attach(socket,'API');
    const request={action:'send_group_msg',params:{group_id:group.id,message:'same',access_token:'hidden'}};
    socket.emit('message',Buffer.from(JSON.stringify(request)));
    socket.emit('message',Buffer.from(JSON.stringify(request)));
    assert.equal(pending.length,2);
    const roots=platform.traces.recent();assert.equal(roots.length,2);
    assert.notEqual(roots[0].id,roots[1].id);
    assert.ok(roots.every(trace=>trace.steps.find(step=>step.kind==='delivery').status==='processing'));
    pending[1].resolve();await tick();pending[0].resolve();await tick();
    for(const trace of platform.traces.recent()) {
        const detail=platform.traces.get(trace.id);
        const messageId=detail.steps.find(step=>step.label==='投递确认').messageId;
        assert.equal(detail.steps.find(step=>step.kind==='onebot').payload.data.message_id,messageId);
        assert.equal(platform.message(messageId).traceId,trace.id);
        assert.equal(detail.steps.find(step=>step.kind==='onebot').status,'sent');
        const frames=traffic.recent().filter(entry=>entry.traceId===trace.id);
        assert.deepEqual(frames.map(entry=>entry.direction),['sent','received']);
        assert.doesNotMatch(JSON.stringify(detail),/hidden/);
    }
    assert.doesNotMatch(JSON.stringify(socket.frames),/traceId/);
    socket.emit('message',Buffer.from(JSON.stringify({action:'send_group_msg',params:{group_id:group.id,
        message:[{type:'text',data:{text:{toString:123}}}]}})));
    socket.emit('message',Buffer.from('{invalid secret=private'));
    await tick();
    assert.ok(platform.traces.recent(2).every(trace=>trace.steps.find(step=>step.kind==='core').status==='failed'));
    assert.doesNotMatch(JSON.stringify(platform.traces.recent()),/private/);
    socket.close();
});

test('multiple gateway event connections share the chat trace; wire errors are failures, not confirmations',t=>{
    const platform=new Platform(new IdentityStore());
    const group=platform.attach('a','A','online',[],{deliver:async()=>{}});
    const gateway=new OneBotGateway(platform),ok=new Socket(),bad=new Socket();
    gateway.attach(ok,'Universal');gateway.attach(bad,'Universal');
    t.after(()=>{ok.close();bad.close();});
    bad.sendError=new Error('write failed');
    const message=platform.ingest(group.id,player,text('1'));
    const trace=platform.traces.get(message.traceId);
    const branches=trace.steps.filter(step=>step.kind==='onebot');
    assert.equal(branches.length,2);
    assert.notEqual(branches[0].connectionId,branches[1].connectionId);
    assert.deepEqual(branches.map(step=>step.status),['sent','failed']);
    assert.equal(branches[1].error,'write failed');
    assert.ok(branches.every(step=>step.payload.message_id===message.id));
    bad.bufferedAmount=1024*1024+1;
    const other=platform.system(group.id,'notice','system');
    assert.match(platform.traces.get(other.traceId).steps.find(step=>step.status==='failed').error,/buffer exceeded/);
    assert.equal(platform.recentMessages().length,2);
});
