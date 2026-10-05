const {test} = require('node:test');
const assert = require('node:assert/strict');
const {OneBotTraffic} = require('../server/dist/adapters/onebot/Traffic');

const context = {connectionId:'test',peer:'gateway',peerName:'OneBot 应用'};

test('OneBot snapshots classify frames, preserve echo, redact nested credentials and stay independent',()=>{
    const traffic = new OneBotTraffic();
    const request = {action:'send_group_msg',params:{group_id:'123',message:'hello',access_token:'secret',
        nested:{Authorization:'Bearer hidden',password:'hidden'}},echo:{id:[1,2]}};
    const recorded = traffic.record('received',JSON.stringify(request),context);
    assert.equal(recorded.kind,'request');
    assert.equal(recorded.groupId,123);
    assert.equal(recorded.action,'send_group_msg');
    assert.deepEqual(recorded.payload.echo,{id:[1,2]});
    assert.equal(recorded.payload.params.access_token,'[已脱敏]');
    assert.doesNotMatch(JSON.stringify(recorded),/secret|hidden/);
    assert.equal(recorded.truncated,false);
    recorded.payload.params.message='changed';
    assert.equal(traffic.recent()[0].payload.params.message,'hello');
    traffic.record('sent',{status:'failed',retcode:1404,data:null,echo:{id:[1,2]}},{...context,action:recorded.action});
    traffic.record('sent',{post_type:'meta_event',meta_event_type:'heartbeat'},context);
    traffic.record('received','{invalid token=secret',context);
    assert.deepEqual(traffic.recent().map(entry=>entry.kind),['invalid','event','response','request']);
    assert.doesNotMatch(JSON.stringify(traffic.recent()),/secret/);
    const snapshot=traffic.recent();snapshot[0].payload.invalid='changed';
    assert.notEqual(traffic.recent()[0].payload.invalid,'changed');
    const invalidGroup=traffic.record('received',{action:'get_group_info',params:{group_id:{toString:42}}},context);
    assert.equal(invalidGroup.groupId,undefined);
});

test('OneBot snapshots bound oversized/deep data and keep only the last 200 entries',()=>{
    const traffic = new OneBotTraffic();
    const deep = {};let node=deep;
    for(let i=0;i<100;i++){node.child={};node=node.child;}
    traffic.record('received',{post_type:'message',deep,data:Array.from({length:1000},()=> 'x'.repeat(20000))},context);
    const entry=traffic.recent()[0];
    assert.equal(entry.truncated,true);
    assert.ok(JSON.stringify(entry).length<18000);
    for(let i=0;i<220;i++)traffic.record('sent',{action:'get_status',echo:i},context);
    const entries=traffic.recent();
    assert.equal(entries.length,200);
    assert.equal(entries[0].payload.echo,219);
    assert.equal(entries.at(-1).payload.echo,20);
    assert.equal(new Set(entries.map(entry=>entry.id)).size,200);
});
