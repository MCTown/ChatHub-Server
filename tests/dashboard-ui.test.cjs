const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../web/app.js'), 'utf8');
const chatSource = fs.readFileSync(require.resolve('../web/chat.js'), 'utf8');
const snapshot = () => ({version:'2.0.0',now:Date.now(),uptimeSeconds:60,memoryBytes:1048576,
    stats:{groups:0,onlinePlayers:0,messages:0,onebot:{forward:0,reverse:0}},
    groups:[],messages:[],relay:{enabled:false,nodes:[],includeSystem:true}});
const tick = () => new Promise(resolve => setImmediate(resolve));

/** Minimal DOM harness for authentication state transitions. Actual layout and
 * browser interactions are checked separately in the running browser. */
function app(storedToken, {storedTheme, systemDark=false, blockedStorage=false, noMatchMedia=false,
    reducedMotion=false, viewTransitions=false, transitionThrows=false, confirm=true,
    initialPath='/',webAnimations=true,clipboardDenied=false} = {}) {
    const elements = new Map(), storage = new Map(), requests = [], intervals = [], clipboard = [];
    const transitions = [], animationTimers = new Map(), settingsTimers = new Map(), chatTimers = new Map(), readers = [];
    const entries=[],historyCalls=[],windowListeners={},scrolls=[],frames=new Map();let frameId=0,frameTime=0;
    const advanceFrames = (ms=16) => {frameTime+=ms;const pending=[...frames.values()];frames.clear();for(const callback of pending)callback(frameTime);};
    const finishZoom = () => {for(let i=0;frames.size&&i<40;i++)advanceFrames();assert.equal(frames.size,0);};
    const location={protocol:'http:',host:'localhost:6700',pathname:initialPath,search:'',hash:'',origin:'http://localhost:6700',href:'http://localhost:6700'+initialPath};
    const historyEntries=[initialPath];let historyIndex=0;
    const history={
        pushState(state,title,url){historyCalls.push({method:'push',url,state});location.pathname=url;location.search='';location.hash='';historyEntries.splice(historyIndex+1);historyEntries.push(url);historyIndex++;},
        replaceState(state,title,url){historyCalls.push({method:'replace',url,state});location.pathname=url;location.search='';location.hash='';historyEntries[historyIndex]=url;},
        back(){if(historyIndex>0){location.pathname=historyEntries[--historyIndex];windowListeners.popstate?.({});}},
        forward(){if(historyIndex<historyEntries.length-1){location.pathname=historyEntries[++historyIndex];windowListeners.popstate?.({});}},
    };
    if (storedToken) storage.set('chathub.dashboard.token',storedToken);
    if (storedTheme) storage.set('chathub.theme',storedTheme);
    const media = {matches:systemDark,addEventListener(type,handler){this.listener=handler;}};
    const motionMedia={matches:reducedMotion,addEventListener(type,handler){this.listener=handler;}};
    class Element {
        constructor(id) {
            this.id=id;this.hidden=id==='workspace'||id==='workspace-skip';
            this.open=false;this.showModalCount=0;this.scrollTop=0;this.scrollLeft=0;
            this.dataset={};this.value='';this.innerHTML='';this.textContent='';this.listeners={};this.attributes={};
            const classes = new Set();
            this.classList={add:value=>classes.add(value),remove:value=>classes.delete(value),contains:value=>classes.has(value),
                toggle:(value,force)=>{const on=force??!classes.has(value);on?classes.add(value):classes.delete(value);return on;}};
            const styles = new Map();
            this.style={setProperty:(key,value)=>styles.set(key,value),removeProperty:key=>styles.delete(key),getPropertyValue:key=>styles.get(key)||''};
        }
        getBoundingClientRect() {return this.id==='topology-canvas'?{left:0,top:0,right:1000,bottom:650,width:1000,height:650}:{left:1000,top:28,right:1120,bottom:64,width:120,height:36};}
        setPointerCapture(id) {this.captures??=new Set();this.captures.add(id);}
        hasPointerCapture(id) {return !!this.captures?.has(id);}
        releasePointerCapture(id) {this.captures?.delete(id);}
        addEventListener(type,handler) {this.listeners[type]=handler;}
        removeEventListener(type) {delete this.listeners[type];}
        matches(selector) {return this.id===selector;}
        requestSubmit() {get('view-content').listeners.submit?.({target:this,preventDefault(){}});}
        setAttribute(key,value) {this.attributes[key]=value;}
        removeAttribute(key) {delete this.attributes[key];}
        replaceChildren() {this.innerHTML='';}
        contains(element) {return this.id==='plugin-settings-dialog'&&this.open&&!!element&&/^(adapter-|plugin-dialog-|onebot-client-form)/.test(element.id);}
        querySelector(selector) {
            if (this.id==='view-content' && this.innerHTML.includes('qq-shell')) return get(selector);
            if (this.id==='topology-world') {
                if (selector.startsWith('#')) return get(selector.slice(1));
                const index=selector.match(/^\[data-topology-node="(\d+)"\]$/)?.[1];
                if (index!==undefined) {const node=get('topology-node-'+index);node.dataset.topologyNode=index;return node;}
            }
            if (this.id==='plugin-dialog-content' && selector.startsWith('#')) return get(selector.slice(1));
            if (this.id==='theme-toggle'||this.id==='theme-toggle-login') {
                if (selector==='[data-icon]') return get(`${this.id}-icon`);
                if (selector==='.theme-toggle-label'&&this.id==='theme-toggle-login') return get('theme-toggle-label');
            }
            return null;
        }
        focus() {document.activeElement=this;}
        scrollIntoView() {this.scrolled=true;}
        showModal() {this.open=true;this.showModalCount++;get(this.id==='message-data-dialog'?'message-dialog-close':'plugin-dialog-close').focus();}
        close() {this.open=false;}
    }
    if (webAnimations) Element.prototype.animate=function(frames,options){
        let finish,fail;
        const animation={element:this,frames,options,cancelled:false,finished:new Promise((resolve,reject)=>{finish=resolve;fail=reject;}),
            finish:()=>finish(),cancel(){this.cancelled=true;fail(new Error('Animation cancelled'));}};
        entries.push(animation);return animation;
    };
    const get = id => {if(!elements.has(id))elements.set(id,new Element(id));return elements.get(id);};
    const document = {title:'登录 · ChatHub',hidden:false,activeElement:null,documentElement:get('html'),listeners:{},
        querySelector:selector=>selector==='meta[name="theme-color"]'?get('theme-meta'):selector.startsWith('#')?get(selector.slice(1)):null,
        querySelectorAll:selector=>selector==='#theme-toggle, #theme-toggle-login'?[get('theme-toggle'),get('theme-toggle-login')]
            : selector==='.nav-item'?['overview','nodes','messages','chat','logs','plugins','settings','guide'].map(view=>{const node=get('nav-'+view);node.dataset.view=view;return node;})
            : selector==='.trace-graph-viewport'?[...get('view-content').innerHTML.matchAll(/id="(trace-graph-[^"]+)" class="trace-graph-viewport"/g)].map(match=>get(match[1])):[],
        addEventListener(type,handler){this.listeners[type]=handler;}};
    if (viewTransitions) document.startViewTransition = update => {
        if (transitionThrows) throw new Error('View transition unavailable');
        let finish, fail;
        const transition = {ready:Promise.resolve(),finished:new Promise((resolve,reject)=>{finish=resolve;fail=reject;}),finish:()=>finish(),fail:()=>fail(new Error('Skipped transition'))};
        update();transitions.push(transition);return transition;
    };
    const checkStorage = () => {if(blockedStorage)throw new Error('Storage disabled');};
    const context = {
        document,Element,HTMLElement:Element,HTMLInputElement:class extends Element {},HTMLTextAreaElement:class extends Element {},
        getComputedStyle:()=>({opacity:'1',transform:'none'}),
        sessionStorage:{getItem:key=>{checkStorage();return storage.get(key);},setItem:(key,value)=>{checkStorage();storage.set(key,value);},removeItem:key=>{checkStorage();storage.delete(key);}},
        window:{...(noMatchMedia?{}:{matchMedia:query=>query.includes('reduced-motion')?motionMedia:media}),confirm:()=>confirm,innerWidth:1200,innerHeight:800,
            history,addEventListener:(type,handler)=>{windowListeners[type]=handler;},scrollTo:options=>scrolls.push(options)},
        FileReader:class {
            readAsDataURL(file) {this.file=file;readers.push(this);}
        },
        AbortController,Date,URL,requestAnimationFrame:callback=>{frames.set(++frameId,callback);return frameId;},cancelAnimationFrame:id=>frames.delete(id),setTimeout:(callback,delay)=>{
            if(delay===600){const id={};settingsTimers.set(id,callback);return id;}
            if(delay===15000){const id={};chatTimers.set(id,callback);return id;}
            if(delay!==450)return setTimeout(callback,delay);
            const id={};animationTimers.set(id,callback);return id;
        },clearTimeout:id=>{if(!animationTimers.delete(id) && !settingsTimers.delete(id) && !chatTimers.delete(id))clearTimeout(id);},setInterval:callback=>intervals.push(callback),
        fetch:(url,options)=>new Promise((resolve,reject)=>{
            requests.push({url,options,resolve,reject});
            if(url==='/api/chat/messages') options.signal.addEventListener('abort',()=>reject(Object.assign(new Error('Aborted'),{name:'AbortError'})),{once:true});
        }),
        location,CSS:{escape:value=>value},
        navigator:{clipboard:{writeText:async value=>{if(clipboardDenied)throw new Error('Clipboard denied');clipboard.push(value);}}},
    };
    vm.runInNewContext(chatSource,context,{filename:'web/chat.js'});
    vm.runInNewContext(source,context,{filename:'web/app.js'});
    const submit = value => {get('token').value=value;get('login-form').listeners.submit({preventDefault(){}});};
    const respond = async (index,status=200,payload=snapshot()) => {requests[index].resolve({ok:status>=200&&status<300,status,json:async()=>payload});await tick();};
    const navigate = (view,modifiers={}) => {
        const target=get('navigate-'+view);target.dataset.view=view;
        target.closest=selector=>selector==='[data-view]'?target:null;
        let prevented=false;
        document.listeners.click({target,preventDefault(){prevented=true;},...modifiers});
        return prevented;
    };
    const closePlugin = () => {
        const target=get('plugin-dialog-close');
        target.closest=selector=>selector==='#plugin-dialog-close'?target:null;
        document.listeners.click({target});
    };
    const cancelPlugin = () => {let prevented=false;get('plugin-settings-dialog').listeners.cancel({preventDefault(){prevented=true;}});return prevented;};
    const copyConfig = async value => {
        const target=get('copy-config');target.dataset.copy=value;
        target.closest=selector=>selector==='[data-copy]'?target:null;
        await document.listeners.click({target});
    };
    const messageAction = (selector,id,{key,step}={}) => {
        const target=get(selector==='[data-message]'?step?`trace-step-${id}-${step}`:`message-open-${id}`:selector.slice(1));
        if (selector==='[data-message]') {
            target.dataset.message=String(id);
            if (step) target.dataset.step=step;else delete target.dataset.step;
        }
        target.closest=match=>match===selector?target:null;
        if (key) {
            let prevented=false;
            document.listeners.keydown({target,key,preventDefault(){prevented=true;}});
            return prevented;
        }
        return document.listeners.click({target});
    };
    const cancelMessage = () => {let prevented=false;get('message-data-dialog').listeners.cancel({preventDefault(){prevented=true;}});return prevented;};
    const toggleTrace = id => {const target=get(`trace-toggle-${id}`);target.dataset.traceToggle=id;
        target.closest=selector=>selector==='[data-trace-toggle]'?target:null;
        document.listeners.click({target});};
    const onebotAction = (selector='[data-onebot-connection]', {key,id='onebot-stat-open'}={}) => {
        const target=get(selector.startsWith('#')?selector.slice(1):id);
        target.closest=match=>match===selector || key&&match==='[data-onebot-connection][role="button"]'?target:null;
        if (key) {
            let prevented=false;document.listeners.keydown({target,key,preventDefault(){prevented=true;}});return prevented;
        }
        return document.listeners.click({target});
    };
    const cancelOnebot = () => {let prevented=false;get('onebot-connection-dialog').listeners.cancel({preventDefault(){prevented=true;}});return prevented;};
    const selectPlugin = id => {
        if(get('plugin-settings-dialog').open) closePlugin();
        const target=get('plugin-open-'+id);target.dataset.plugin=id;
        target.closest=selector=>selector==='[data-plugin]'?target:null;
        document.listeners.click({target});
    };
    const togglePlugin = id => {
        const target=get('plugin-toggle-'+id+'-list');target.dataset.togglePlugin=id;
        target.closest=selector=>selector==='[data-toggle-plugin]'?target:null;
        document.listeners.click({target});
    };
    const inputConfig = (id,key,value,{checkbox=false}={}) => {
        const target=get(`plugin-config-${id}-${key}`);target.dataset.configPlugin=id;target.dataset.configField=key;
        if(checkbox)target.checked=value;else target.value=value;
        document.listeners.input({target});
    };
    const submitConfig = id => {const target=get('plugin-config-form');target.dataset.pluginConfig=id;
        document.listeners.submit({target,preventDefault(){}});};
    const configButton = (id,action) => {const target=get(`config-${action}-${id}`);
        target.dataset[action==='reset'?'resetConfig':'defaultConfig']=id;
        target.closest=selector=>selector===`[data-${action==='reset'?'reset':'default'}-config]`?target:null;
        document.listeners.click({target});};
    const inputField = (id,value) => {const target=get(id);target.value=value;document.listeners.input({target});};
    const logOrigin = origin => {
        const target=get('log-origin-'+origin);target.dataset.logOrigin=origin;
        target.closest=selector=>selector==='[data-log-origin]'?target:null;
        document.listeners.click({target});
    };
    const logGroup = id => {const target=get('log-group-filter');target.value=id;document.listeners.change({target});};
    const submitAdapter = () => document.listeners.submit({target:get('onebot-client-form'),preventDefault(){}});
    const flushSettings = () => {for(const [id,callback] of [...settingsTimers]){settingsTimers.delete(id);callback();}};
    const blurSettings = () => document.listeners.focusout({target:get('settings-public-url')});
    const composeSettings = type => document.listeners[type]({target:get('settings-public-url')});
    const removeAdapter = id => {
        const target=get('remove-'+id);target.dataset.removeAdapter=id;
        target.closest=selector=>selector==='[data-remove-adapter]'?target:null;
        document.listeners.click({target});
    };
    const changeSystemTheme = dark => {media.matches=dark;media.listener?.({matches:dark});};
    const changeReducedMotion = matches => {motionMedia.matches=matches;motionMedia.listener?.({matches});};
    const clickTheme = (id='theme-toggle-login') => get(id).listeners.click({currentTarget:get(id)});
    const finishAnimation = () => {for(const callback of animationTimers.values())callback();animationTimers.clear();};
    const finishClose = async () => {for(const animation of entries)if(animation.options.fill==='forwards'&&!animation.cancelled)animation.finish();await tick();};
    const chatInput = (value,selector='[data-qq-text]') => {const target=get(selector);target.value=value;get('view-content').listeners.input({target});};
    const chatClick = (selector,values={}) => {const target=new Element('chat-action');target.dataset=values;
        target.closest=match=>match===selector?target:null;get('view-content').listeners.click({target});};
    const chatKey = (extra={}) => {let prevented=false;get('view-content').listeners.keydown({target:get('[data-qq-text]'),key:'Enter',preventDefault(){prevented=true;},...extra});return prevented;};
    const chatComposition = type => get('view-content').listeners[type]({target:get('[data-qq-text]')});
    const chatSubmit = () => get('view-content').listeners.submit({target:get('[data-qq-form]'),preventDefault(){}});
    const chatImage = (file={name:'pixel.png',size:68,type:'image/png'}) => {const target=get('[data-qq-image]');target.files=[file];get('view-content').listeners.change({target});return readers.at(-1);};
    const readImage = (reader,data='data:image/png;base64,cGl4ZWw=') => {reader.result=data;reader.onload();};
    return {get,storage,requests,intervals,document,submit,respond,changeSystemTheme,changeReducedMotion,navigate,selectPlugin,togglePlugin,closePlugin,cancelPlugin,copyConfig,clipboard,inputAdapter:inputField,inputField,logOrigin,logGroup,submitAdapter,removeAdapter,
         entries,history,location,historyCalls,scrolls,inputConfig,submitConfig,configButton,messageAction,cancelMessage,toggleTrace,onebotAction,cancelOnebot,
            transitions,clickTheme,finishAnimation,finishClose,flushSettings,blurSettings,composeSettings,settingsTimers,advanceFrames,finishZoom,frames,
            chatInput,chatClick,chatKey,chatComposition,chatSubmit,chatImage,readImage,readers,chatTimers};
}

const topologySnapshot = (count=8) => ({...snapshot(),groups:Array.from({length:count},(_,index)=>({
    id:100+index,name:index===0?'<世界>':`世界 ${index+1}`,kind:index%2?'onebot':'mcdr',members:[{name:'Steve',online:true}],
})),stats:{...snapshot().stats,groups:count}});
function topologyEvent(ui,type,{node,pointerId=1,x=300,y=300,...extra}={}) {
    const canvas=ui.get('topology-canvas'),target=node===undefined?canvas:ui.get('topology-node-'+node);
    if (node!==undefined) target.dataset.topologyNode=String(node);
    target.closest=selector=>selector==='[data-topology-node]'&&node!==undefined?target:null;
    const event={type,target,pointerId,button:0,clientX:x,clientY:y,detail:1,preventDefault(){this.prevented=true;},stopPropagation(){this.stopped=true;},...extra};
    canvas.listeners[type](event);return event;
}
function topologyCamera(ui) {
    return ui.get('topology-world').attributes.transform.match(/translate\(([-\d.]+) ([-\d.]+)\) scale\(([-\d.]+)\)/).slice(1).map(Number);
}
function topologyAction(ui,action) {
    const target=ui.get('topology-action-'+action);target.dataset.topologyAction=action;
    target.closest=selector=>selector==='[data-topology-action]'?target:null;
    ui.document.listeners.click({target});
}

const chatSnapshot = () => ({...snapshot(),groups:[
    {id:100,name:'<生存世界>',kind:'mcdr',members:[{userId:10,name:'<Steve>',online:true}]},
    {id:101,name:'机器人群',kind:'onebot',members:[]},
],messages:[{id:1,groupId:100,authorId:10,authorName:'<Steve>',origin:'player',time:1700000000,
    segments:[{type:'text',text:'<script>你好</script>\n第二行'},{type:'mention',userId:11},
        {type:'image',url:'http://localhost:6700/media/images/pixel.png'},
        {type:'image',url:'https://remote.example/media/images/pixel.png'},
        {type:'image',url:'http://localhost:6700/assets/logo.svg'},
        {type:'image',url:'javascript:alert(1)'}]}]});
const sentChat = (id=2,groupId=100) => ({id,groupId,authorId:1,authorName:'ChatHub',origin:'application',time:1700000010,
    segments:[{type:'text',text:'已确认的消息'}]});

test('chat uses three panels without a duplicate navigation rail or nested dashboard main',async()=>{
    const ui=app('dashboard',{initialPath:'/chat'});await ui.respond(0,200,chatSnapshot());
    const shell=ui.get('view-content').innerHTML;
    assert.match(shell,/<aside class="qq-conversations"/);
    assert.match(shell,/<section class="qq-chat-main"/);
    assert.match(shell,/<aside class="qq-members"/);
    assert.doesNotMatch(shell,/qq-rail|qq-user-avatar|data-qq-theme|data-qq-logout|联系人|收藏|<main\b/);
    assert.match(shell,/data-qq-clear[^>]*aria-label="清空输入"/);
    assert.match(ui.get('[data-qq-header]').innerHTML,/data-qq-mobile-list/);
    assert.match(ui.get('[data-qq-members]').innerHTML,/class="qq-member-copy"/);
    ui.clickTheme('theme-toggle');assert.equal(ui.get('html').dataset.theme,'dark');
});

test('chat deep link authenticates with Dashboard only, escapes messages and renders only same-origin media',async()=>{
    const ui=app('dashboard',{initialPath:'/chat'});
    assert.equal(ui.get('workspace').hidden,true);
    assert.equal(ui.requests[0].url,'/api/dashboard?trace_view=1&chat_view=1');
    await ui.respond(0,200,chatSnapshot());
    assert.equal(ui.get('workspace').classList.contains('chat-mode'),true);
    assert.equal(ui.document.title,'群聊 · ChatHub');
    assert.match(ui.get('[data-qq-header]').innerHTML,/&lt;生存世界&gt;/);
    assert.match(ui.get('[data-qq-members]').innerHTML,/&lt;Steve&gt;/);
    const messages=ui.get('[data-qq-messages]').innerHTML;
    assert.match(messages,/&lt;script&gt;你好&lt;\/script&gt;<br>第二行/);
    assert.match(messages,/@11/);
    assert.equal((messages.match(/<img /g)||[]).length,1);
    assert.doesNotMatch(messages,/<script>|remote\.example|javascript:|assets\/logo/);
    assert.ok(ui.requests.every(request=>!request.url.includes('/api/onebot/connection')));
    assert.ok(ui.requests.every(request=>request.options.headers.Authorization==='Bearer dashboard'));
    ui.intervals[0]();await ui.respond(1,200,{...chatSnapshot(),groups:[]});
    assert.doesNotMatch(ui.get('[data-qq-messages]').innerHTML,/第二行/);
    assert.equal(ui.get('[data-qq-form]').hidden,true);
});

test('chat polling preserves input, focus and scroll; switching groups restores per-group text and image drafts',async()=>{
    const ui=app('dashboard',{initialPath:'/chat'});await ui.respond(0,200,chatSnapshot());
    const shell=ui.get('view-content').innerHTML,field=ui.get('[data-qq-text]'),list=ui.get('[data-qq-messages]');
    field.focus();field.selectionStart=3;ui.chatInput('第一群草稿');
    list.scrollHeight=1000;list.clientHeight=100;list.scrollTop=100;
    ui.readImage(ui.chatImage());
    ui.intervals[0]();await ui.respond(1,200,{...chatSnapshot(),messages:[sentChat(),...chatSnapshot().messages]});
    assert.equal(ui.get('view-content').innerHTML,shell);
    assert.equal(ui.document.activeElement,field);assert.equal(field.selectionStart,3);
    assert.equal(field.value,'第一群草稿');assert.equal(list.scrollTop,100);
    ui.chatClick('[data-qq-group]',{qqGroup:'101'});assert.equal(field.value,'');
    ui.chatInput('第二群草稿');ui.chatClick('[data-qq-group]',{qqGroup:'100'});
    assert.equal(field.value,'第一群草稿');assert.equal(ui.get('[data-qq-preview]').hidden,false);
    ui.chatClick('[data-qq-mobile-list]');assert.equal(ui.get('.qq-shell').classList.contains('qq-mobile-list'),true);
    ui.chatClick('[data-qq-group]',{qqGroup:'101'});
    assert.equal(field.value,'第二群草稿');assert.equal(ui.get('.qq-shell').classList.contains('qq-mobile-list'),false);
    ui.chatInput('机器人','[data-qq-filter]');assert.doesNotMatch(ui.get('[data-qq-groups]').innerHTML,/生存世界/);
    ui.chatClick('[data-qq-placeholder]',{qqPlaceholder:'搜索消息'});assert.match(ui.get('toast').textContent,/暂未开放/);
    ui.chatClick('[data-qq-new]');assert.match(ui.get('toast').textContent,/暂不支持/);
    ui.chatClick('[data-qq-clear]');assert.equal(field.value,'');
});

test('chat Enter sends once, Shift+Enter and IME never send, and confirmed response is inserted immediately',async()=>{
    const ui=app('dashboard',{initialPath:'/chat'});await ui.respond(0,200,chatSnapshot());
    ui.chatInput('你好\n[CQ:at,qq=10]');
    for(const extra of [{shiftKey:true},{isComposing:true},{keyCode:229},{ctrlKey:true}]) assert.equal(ui.chatKey(extra),false);
    ui.chatComposition('compositionstart');assert.equal(ui.chatKey(),false);ui.chatComposition('compositionend');
    assert.equal(ui.requests.length,1);assert.equal(ui.chatKey(),true);assert.equal(ui.requests.length,2);
    const request=ui.requests[1];
    assert.equal(request.url,'/api/chat/messages');assert.equal(request.options.method,'POST');
    assert.equal(request.options.headers.Authorization,'Bearer dashboard');
    assert.deepEqual(JSON.parse(request.options.body),{group_id:100,text:'你好\n[CQ:at,qq=10]'});
    assert.equal(ui.get('[data-qq-text]').disabled,true);
    ui.chatKey();ui.chatClick('[data-qq-group]',{qqGroup:'101'});assert.equal(ui.requests.length,2);
    await ui.respond(1,201,{message:sentChat()});
    assert.match(ui.get('[data-qq-messages]').innerHTML,/已确认的消息/);
    assert.equal(ui.get('[data-qq-text]').value,'');assert.equal(ui.get('[data-qq-text]').disabled,false);
    assert.equal(ui.chatTimers.size,0);
    ui.chatClick('[data-qq-group]',{qqGroup:'101'});ui.chatClick('[data-qq-group]',{qqGroup:'100'});
    assert.equal(ui.get('[data-qq-text]').value,'');
});

test('chat image selection, removal and stale file reads are bounded; image-only sends use base64',async()=>{
    const ui=app('dashboard',{initialPath:'/chat'});await ui.respond(0,200,chatSnapshot());
    ui.chatImage({name:'large.png',size:5*1024*1024+1});assert.equal(ui.readers.length,0);
    assert.match(ui.get('toast').textContent,/5 MiB/);
    const old=ui.chatImage();ui.chatClick('[data-qq-group]',{qqGroup:'101'});ui.readImage(old);
    assert.equal(ui.get('[data-qq-preview]').hidden,true);
    ui.readImage(ui.chatImage());assert.match(ui.get('[data-qq-preview]').innerHTML,/待发送图片预览/);
    ui.chatClick('[data-qq-remove-image]');assert.equal(ui.get('[data-qq-preview]').hidden,true);
    ui.readImage(ui.chatImage());ui.chatSubmit();
    assert.deepEqual(JSON.parse(ui.requests[1].options.body),{group_id:101,text:'',image:'base64://cGl4ZWw='});
    await ui.respond(1,201,{message:{...sentChat(3,101),segments:[{type:'image',url:'/media/images/sent.png'}]}});
    assert.match(ui.get('[data-qq-messages]').innerHTML,/src="\/media\/images\/sent.png"/);
    assert.equal(ui.get('[data-qq-preview]').hidden,true);
});

test('chat failures and timeouts retain drafts, stale snapshots disable sending and 401 clears the workspace',async()=>{
    const ui=app('dashboard',{initialPath:'/chat'});await ui.respond(0,200,chatSnapshot());
    ui.chatInput('失败保留');ui.readImage(ui.chatImage());ui.chatSubmit();
    await ui.respond(1,400,{error:'未设置公网地址'});
    assert.equal(ui.get('[data-qq-text]').value,'失败保留');assert.equal(ui.get('[data-qq-preview]').hidden,false);
    assert.match(ui.get('toast').textContent,/未设置公网地址/);
    ui.chatSubmit();for(const callback of ui.chatTimers.values())callback();await tick();
    assert.equal(ui.requests[2].options.signal.aborted,true);assert.match(ui.get('toast').textContent,/发送超时/);
    assert.equal(ui.get('[data-qq-text]').value,'失败保留');
    ui.intervals[0]();await ui.respond(3,500,{error:'offline'});
    assert.equal(ui.get('.qq-send').disabled,true);assert.equal(ui.get('[data-qq-stale]').hidden,false);
    ui.chatSubmit();assert.equal(ui.requests.length,4);
    ui.intervals[0]();await ui.respond(4,200,chatSnapshot());ui.chatSubmit();await ui.respond(5,401,{});
    assert.equal(ui.get('workspace').hidden,true);assert.equal(ui.get('view-content').innerHTML,'');
    assert.equal(ui.storage.has('chathub.dashboard.token'),false);
});

test('leaving chat or logging out aborts pending sends, ignores late responses and clears drafts',async()=>{
    const ui=app('dashboard',{initialPath:'/chat'});await ui.respond(0,200,chatSnapshot());
    ui.chatInput('离开时清除');ui.chatSubmit();ui.navigate('messages');
    assert.equal(ui.requests[1].options.signal.aborted,true);assert.equal(ui.get('workspace').classList.contains('chat-mode'),false);
    await ui.respond(1,201,{message:sentChat()});assert.doesNotMatch(ui.get('view-content').innerHTML,/已确认的消息/);
    ui.navigate('chat');await ui.respond(2,200,chatSnapshot());
    assert.equal(ui.get('[data-qq-text]').value,'');
    const reader=ui.chatImage();ui.get('logout').listeners.click();ui.readImage(reader);
    assert.equal(ui.get('workspace').hidden,true);assert.equal(ui.get('view-content').innerHTML,'');
    assert.deepEqual(Object.keys(ui.get('view-content').listeners),[]);
});

test('overview is only a full canvas with every client, escaped labels and the core/gateway even when empty',async()=>{
    const ui=app('dashboard');await ui.respond(0,200,topologySnapshot());
    assert.equal(ui.get('main').classList.contains('topology-only'),true);
    assert.equal(ui.get('page-heading').hidden,true);
    assert.match(ui.get('view-content').innerHTML,/topology-workspace/);
    assert.doesNotMatch(ui.get('view-content').innerHTML,/class="panel"|stats-grid|dashboard-grid|mobile-topology|message-list/);
    const graph=ui.get('topology-world').innerHTML;
    assert.equal((graph.match(/data-topology-node=/g)||[]).length,10);
    assert.match(graph,/&lt;世界&gt;/);assert.doesNotMatch(graph,/<世界>/);
    assert.match(graph,/世界 8/);assert.match(graph,/OneBot V11 ↗/);
    ui.intervals[0]();await ui.respond(1,200,snapshot());
    assert.equal((ui.get('topology-world').innerHTML.match(/data-topology-node=/g)||[]).length,2);
    assert.match(ui.get('topology-world').innerHTML,/ChatHub/);
    ui.navigate('messages');assert.equal(ui.get('page-heading').hidden,false);
    assert.equal(ui.get('main').classList.contains('topology-only'),false);
});

test('canvas pan and zoom stay anchored, clamp scale and survive polling and navigation',async()=>{
    const ui=app('dashboard');await ui.respond(0,200,topologySnapshot(2));
    const before=topologyCamera(ui), shell=ui.get('view-content').innerHTML;
    topologyEvent(ui,'pointerdown');topologyEvent(ui,'pointermove',{x:380,y:350});topologyEvent(ui,'pointerup',{x:380,y:350});
    let camera=topologyCamera(ui);
    assert.equal(camera[0],before[0]+80);assert.equal(camera[1],before[1]+50);
    const anchor=[(400-camera[0])/camera[2],(200-camera[1])/camera[2]];
    assert.equal(topologyEvent(ui,'wheel',{x:400,y:200,deltaY:-100,deltaMode:0}).prevented,true);
    ui.finishZoom();
    camera=topologyCamera(ui);
    assert.ok(Math.abs((400-camera[0])/camera[2]-anchor[0])<.000001);
    assert.ok(Math.abs((200-camera[1])/camera[2]-anchor[1])<.000001);
    for(let i=0;i<30;i++)topologyAction(ui,'in');ui.finishZoom();assert.equal(topologyCamera(ui)[2],2.5);
    for(let i=0;i<30;i++)topologyAction(ui,'out');ui.finishZoom();assert.equal(topologyCamera(ui)[2],.1);
    camera=topologyCamera(ui);
    ui.intervals[0]();await ui.respond(1,200,topologySnapshot(2));
    assert.deepEqual(topologyCamera(ui),camera);assert.equal(ui.get('view-content').innerHTML,shell);
    ui.navigate('messages');ui.navigate('overview');assert.deepEqual(topologyCamera(ui),camera);
    topologyAction(ui,'fit');ui.finishZoom();assert.ok(topologyCamera(ui)[2]>.2);
});

test('zoom animates around the cursor, accumulates input and survives polling without jumps',async()=>{
    const ui=app('dashboard');await ui.respond(0,200,topologySnapshot(2));
    const before=topologyCamera(ui),anchor=[(400-before[0])/before[2],(200-before[1])/before[2]];
    topologyEvent(ui,'wheel',{x:400,y:200,deltaY:-100,deltaMode:0});
    assert.deepEqual(topologyCamera(ui),before);assert.equal(ui.frames.size,1);
    ui.advanceFrames();ui.advanceFrames(80);
    const middle=topologyCamera(ui);
    assert.ok(middle[2]>before[2]&&middle[2]<before[2]*Math.exp(.2));
    assert.ok(Math.abs((400-middle[0])/middle[2]-anchor[0])<.000001);
    assert.ok(Math.abs((200-middle[1])/middle[2]-anchor[1])<.000001);
    topologyEvent(ui,'wheel',{x:400,y:200,deltaY:-100,deltaMode:0});
    assert.deepEqual(topologyCamera(ui),middle);assert.equal(ui.frames.size,1);
    ui.intervals[0]();await ui.respond(1,200,topologySnapshot(3));
    assert.deepEqual(topologyCamera(ui),middle);assert.equal(ui.frames.size,1);
    ui.finishZoom();assert.ok(Math.abs(topologyCamera(ui)[2]-before[2]*Math.exp(.4))<.000001);
    assert.ok(Math.abs((400-topologyCamera(ui)[0])/topologyCamera(ui)[2]-anchor[0])<.000001);
    const end=topologyCamera(ui);
    topologyEvent(ui,'keydown',{key:'+'});ui.finishZoom();assert.ok(Math.abs(topologyCamera(ui)[2]-end[2]*1.2)<.000001);
    topologyAction(ui,'fit');assert.equal(ui.frames.size,1);ui.finishZoom();
    topologyAction(ui,'reset');assert.equal(ui.frames.size,1);ui.finishZoom();
});

test('drag, motion preference and navigation interrupt zoom; reduced motion applies it immediately',async()=>{
    const ui=app('dashboard');await ui.respond(0,200,topologySnapshot(1));
    topologyAction(ui,'in');ui.advanceFrames();ui.advanceFrames(70);
    const middle=topologyCamera(ui);
    topologyEvent(ui,'pointerdown');assert.equal(ui.frames.size,0);
    topologyEvent(ui,'pointermove',{x:320,y:310});topologyEvent(ui,'pointerup',{x:320,y:310});
    ui.advanceFrames(500);assert.equal(topologyCamera(ui)[2],middle[2]);assert.equal(topologyCamera(ui)[0],middle[0]+20);
    const scale=topologyCamera(ui)[2];topologyAction(ui,'in');ui.changeReducedMotion(true);
    assert.equal(ui.frames.size,0);assert.equal(topologyCamera(ui)[2],scale*1.2);
    topologyAction(ui,'out');assert.equal(ui.frames.size,0);assert.equal(topologyCamera(ui)[2],scale);
    ui.changeReducedMotion(false);topologyAction(ui,'in');ui.advanceFrames();ui.advanceFrames(70);
    const leaving=topologyCamera(ui);ui.navigate('nodes');assert.equal(ui.frames.size,0);
    ui.advanceFrames(500);ui.navigate('overview');assert.deepEqual(topologyCamera(ui),leaving);
    topologyAction(ui,'in');ui.get('logout').listeners.click();assert.equal(ui.frames.size,0);
    const reduced=app('dashboard',{reducedMotion:true});await reduced.respond(0,200,topologySnapshot(1));
    const initial=topologyCamera(reduced)[2];topologyAction(reduced,'in');
    assert.equal(reduced.frames.size,0);assert.equal(topologyCamera(reduced)[2],initial*1.2);
});

test('connected upstream robots link to their groups, share nodes and never expose URL credentials or tokens',async()=>{
    const ui=app('dashboard'),d=topologySnapshot(4);
    const client=(id,group,botId=12345,status='connected')=>({id,name:'adapter-'+id,address:'ws://user:password@localhost:3001/onebot?access_token=SECRET#private',
        groupId:900+group,platformGroupId:100+group,botId,status,access_token:'TOKEN_MUST_NOT_RENDER'});
    d.onebotAdapters={clients:[client('a',1),client('b',3),client('c',3,67890),client('retry',1,999,'retrying'),client('stopped',1,888,'stopped')]};
    await ui.respond(0,200,d);
    const html=ui.get('topology-world').innerHTML;
    assert.equal((html.match(/data-topology-node=/g)||[]).length,8);
    assert.equal((html.match(/class="topology-edge/g)||[]).length,8);
    assert.match(html,/机器人 #12345/);assert.match(html,/机器人 #67890/);assert.match(html,/ws:\/\/localhost:3001\/onebot/);
    assert.doesNotMatch(html,/SECRET|TOKEN_MUST_NOT_RENDER|user:password|#private|机器人 #999|机器人 #888/);
    assert.match(ui.get('topology-node-6').attributes.transform,/translate\(-800 -73\)/);
    const first=ui.get('topology-edge-6-0').attributes.d,second=ui.get('topology-edge-6-1').attributes.d;
    topologyEvent(ui,'keydown',{node:1,key:'ArrowRight'});
    assert.notEqual(ui.get('topology-edge-6-0').attributes.d,first);assert.equal(ui.get('topology-edge-6-1').attributes.d,second);
    topologyEvent(ui,'pointerdown',{node:6});topologyEvent(ui,'pointermove',{node:6,x:350,y:320});topologyEvent(ui,'pointerup',{node:6,x:350,y:320});
    const moved=ui.get('topology-node-6').attributes.transform;
    assert.notEqual(ui.get('topology-edge-6-1').attributes.d,second);
    ui.intervals[0]();await ui.respond(1,200,d);assert.equal(ui.get('topology-node-6').attributes.transform,moved);
    d.onebotAdapters.clients[0].status='retrying';d.onebotAdapters.clients[1].status='retrying';
    ui.intervals[0]();await ui.respond(2,200,d);
    assert.equal((ui.get('topology-world').innerHTML.match(/data-topology-node=/g)||[]).length,7);
    assert.doesNotMatch(ui.get('topology-world').innerHTML,/机器人 #12345/);
});

test('gateway applications appear on the right with direction, role and peer address, and their edges follow drags',async()=>{
    const ui=app('dashboard'),d=topologySnapshot(1);
    d.stats.onebot={forward:2,reverse:1};
    d.onebotApplications=[{id:'a',direction:'forward',role:'Universal',address:'192.168.1.2:23456'},
        {id:'b',direction:'reverse',role:'API',address:'wss://app.example/onebot'},
        {id:'c',direction:'forward',role:'Event',address:'[::1]:23457'}];
    await ui.respond(0,200,d);
    const html=ui.get('topology-world').innerHTML;
    assert.equal((html.match(/data-topology-node=/g)||[]).length,6);
    assert.equal((html.match(/class="topology-edge/g)||[]).length,5);
    assert.match(html,/OneBot 应用服务/);assert.match(html,/正向 WS · Universal/);assert.match(html,/反向 WS · API/);assert.match(html,/正向 WS · Event/);
    assert.match(html,/192\.168\.1\.2:23456/);assert.match(html,/wss:\/\/app\.example\/onebot/);
    assert.equal(ui.get('topology-node-3').attributes.transform,'translate(800 -146)');
    assert.match(ui.get('topology-edge-3').attributes.d,/^M536 0 C.*,665 -146$/); // Gateway → service, never core → service.
    const edge=ui.get('topology-edge-3').attributes.d;
    topologyEvent(ui,'keydown',{node:2,key:'ArrowUp'});assert.notEqual(ui.get('topology-edge-3').attributes.d,edge);
    const gatewayMoved=ui.get('topology-edge-3').attributes.d;
    topologyEvent(ui,'pointerdown',{node:3});topologyEvent(ui,'pointermove',{node:3,x:340,y:320});topologyEvent(ui,'pointerup',{node:3,x:340,y:320});
    const position=ui.get('topology-node-3').attributes.transform;
    assert.notEqual(ui.get('topology-edge-3').attributes.d,gatewayMoved);
    ui.intervals[0]();await ui.respond(1,200,d);assert.equal(ui.get('topology-node-3').attributes.transform,position);
    d.onebotApplications.shift();d.stats.onebot.forward--;
    ui.intervals[0]();await ui.respond(2,200,d);
    assert.equal((ui.get('topology-world').innerHTML.match(/data-topology-node=/g)||[]).length,5);
    assert.doesNotMatch(ui.get('topology-world').innerHTML,/192\.168\.1\.2:23456/);
});

test('node drags update edges in world coordinates, defer polled changes and reset restores layout',async()=>{
    const ui=app('dashboard');await ui.respond(0,200,topologySnapshot(2));
    const original=ui.get('topology-node-0').attributes.transform, edge=ui.get('topology-edge-0').attributes.d;
    const scale=topologyCamera(ui)[2], graph=ui.get('topology-world').innerHTML;
    topologyEvent(ui,'pointerdown',{node:0});topologyEvent(ui,'pointermove',{node:0,x:400,y:350});
    assert.equal(ui.get('topology-node-0').attributes.transform,`translate(${-420+100/scale} ${-63+50/scale})`);
    assert.notEqual(ui.get('topology-edge-0').attributes.d,edge);
    ui.intervals[0]();await ui.respond(1,200,topologySnapshot(3));
    assert.equal(ui.get('topology-world').innerHTML,graph);
    topologyEvent(ui,'pointerup',{node:0,x:400,y:350});
    assert.equal((ui.get('topology-world').innerHTML.match(/data-topology-node=/g)||[]).length,5);
    const dragged=ui.get('topology-node-0').attributes.transform;
    ui.navigate('nodes');ui.navigate('overview');assert.equal(ui.get('topology-node-0').attributes.transform,dragged);
    topologyAction(ui,'reset');assert.equal(ui.get('topology-node-0').attributes.transform,'translate(-420 -126)');
    assert.notEqual(dragged,original);
});

test('two-finger pinch scales around the midpoint and continues as pan, cancellation releases capture',async()=>{
    const ui=app('dashboard');await ui.respond(0,200,topologySnapshot(1));
    const scale=topologyCamera(ui)[2];
    topologyEvent(ui,'pointerdown',{node:0,pointerId:1,x:200,y:200});
    topologyEvent(ui,'pointerdown',{pointerId:2,x:400,y:200});
    topologyEvent(ui,'pointermove',{pointerId:2,x:500,y:200});
    assert.ok(Math.abs(topologyCamera(ui)[2]-scale*1.5)<.000001);
    const node=ui.get('topology-node-0').attributes.transform;
    topologyEvent(ui,'pointerup',{pointerId:2,x:500,y:200});
    const before=topologyCamera(ui);
    topologyEvent(ui,'pointermove',{pointerId:1,x:230,y:220});
    assert.equal(topologyCamera(ui)[0],before[0]+30);
    assert.equal(ui.get('topology-node-0').attributes.transform,node);
    topologyEvent(ui,'pointercancel',{pointerId:1});
    assert.equal(ui.get('topology-canvas').hasPointerCapture(1),false);
    assert.equal(ui.get('topology-canvas').classList.contains('dragging'),false);
});

test('gateway tap opens details but drag never does; keyboard moves nodes and logout clears positions',async()=>{
    const ui=app('dashboard');await ui.respond(0,200,topologySnapshot(1));
    const target=ui.get('topology-node-2');target.id='onebot-topology-open';
    topologyEvent(ui,'pointerdown',{node:2});topologyEvent(ui,'pointermove',{node:2,x:350});topologyEvent(ui,'pointerup',{node:2,x:350});
    topologyEvent(ui,'click',{node:2});assert.equal(ui.requests.length,1);
    topologyEvent(ui,'pointerdown',{node:2});topologyEvent(ui,'pointerup',{node:2});topologyEvent(ui,'click',{node:2});
    assert.equal(ui.requests[1].url,'/api/onebot/connection');await ui.respond(1,200,connectionDetails());
    ui.cancelOnebot();await ui.finishClose();
    assert.equal(topologyEvent(ui,'keydown',{node:0,key:'ArrowRight',shiftKey:true}).prevented,true);
    assert.equal(ui.get('topology-node-0').attributes.transform,'translate(-360 0)');
    ui.get('logout').listeners.click();ui.submit('dashboard');await ui.respond(2,200,topologySnapshot(1));
    assert.equal(ui.get('topology-node-0').attributes.transform,'translate(-420 0)');
});

test('logged-out UI only shows login, no workspace contents or automatic API polling', () => {
    const ui = app();
    assert.equal(ui.get('workspace').hidden,true);
    assert.equal(ui.get('login-page').hidden,false);
    assert.equal(ui.get('view-content').innerHTML,'');
    ui.intervals[0]();
    assert.equal(ui.requests.length,0);
    ui.submit('   ');
    assert.equal(ui.requests.length,0);
    assert.match(ui.get('auth-error').textContent,/请输入/);
});

const connectionDetails = () => ({self_id:1,system_user_id:2,access_token:'<secret>&"token',path:'/onebot/v11',
    direct_urls:[{name:'ens18',url:'ws://192.168.31.99:6700/onebot/v11'}]});
const nativeDetails = () => ({access_token:'nodes-secret',path:'/chathub/v2/connect',
    direct_urls:[{name:'ens18',url:'ws://192.168.31.99:6700/chathub/v2/connect'}]});

function traceSnapshot() {
    const id='00000000-0000-4000-8000-000000000001', timestampMs=1700000000000;
    const d=snapshot();
    d.traces=[{id,timestampMs,origin:'player',preview:'<help>',truncated:false,steps:[
        {id:'1',kind:'source',label:'A · Steve',nodeId:'a',groupName:'A',authorName:'Steve',groupId:100,messageId:42,eventId:'event-help',timestampMs,status:'received'},
        {id:'2',parentId:'1',kind:'core',label:'ChatHub Core',timestampMs,status:'accepted'},
        {id:'3',parentId:'2',kind:'delivery',label:'CrossServerRelay → B',groupId:101,nodeId:'b',pluginName:'CrossServerRelay',timestampMs,status:'confirmed',durationMs:12},
        {id:'4',parentId:'2',kind:'delivery',label:'CrossServerRelay → C',groupId:102,nodeId:'c',pluginName:'CrossServerRelay',timestampMs,status:'timeout',error:'<unsafe> timeout'},
        {id:'5',parentId:'2',kind:'onebot',label:'ChatHub OneBot',direction:'sent',connectionId:'app-1',timestampMs,status:'sent'},
        {id:'6',parentId:'3',kind:'delivery',label:'投递确认',groupId:101,messageId:43,timestampMs,status:'confirmed'},
    ]}];
    d.messages=[{id:42,time:1,origin:'player',authorName:'Steve',groupName:'A',segments:[{type:'text',text:'duplicate legacy chat'}]}];
    d.onebotTraffic=[{id:'legacy-traffic',peer:'gateway',direction:'sent',time:1,payload:{text:'duplicate legacy frame'}}];
    return d;
}

test('trace stream folds branches into a single escaped card, filters descendant nodes and lazily opens/copies snapshots',async()=>{
    const ui=app('dashboard',{initialPath:'/messages'}),d=traceSnapshot(),trace=d.traces[0];
    assert.equal(ui.requests[0].url,'/api/dashboard?trace_view=1');
    await ui.respond(0,200,d);
    let html=ui.get('view-content').innerHTML;
    assert.equal((html.match(/class="trace-card"/g)||[]).length,1);
    // Node graph is folded by default and only appears after an explicit toggle.
    assert.doesNotMatch(html,/class="trace-graph"/);
    assert.match(html,/data-trace-toggle="/);assert.match(html,/aria-expanded="false"/);
    // Each message shows its [source] sender prefix.
    assert.match(html,/\[A\]Steve:&lt;help&gt;/);
    ui.toggleTrace(trace.id);
    html=ui.get('view-content').innerHTML;
    assert.match(html,/trace-card-expanded/);assert.match(html,/aria-expanded="true"/);
    assert.match(html,/ChatHub Core/);assert.match(html,/CrossServerRelay → B/);
    assert.match(html,/12 ms/);assert.match(html,/已发送（未确认处理）/);
    assert.match(html,/class="trace-graph"/);assert.match(html,/class="trace-branches"/);
    assert.match(html,/6 个节点 · 3 条分支/);assert.match(html,/1 个异常/);
    assert.match(html,/data-step="6"/); // Confirmation descendants stay visible, not hidden by depth.
    assert.match(html,/data-outcome="red"/);
    assert.match(html,/&lt;help&gt;/);assert.match(html,/&lt;unsafe&gt;/);
    assert.doesNotMatch(html,/<help>|<unsafe>|duplicate legacy/);
    const filter=ui.get('trace-filter');filter.dataset.filter='application';
    filter.closest=selector=>selector==='[data-filter]'?filter:null;
    ui.document.listeners.click({target:filter});
    assert.doesNotMatch(ui.get('view-content').innerHTML,/class="trace-card/);
    filter.dataset.filter='onebot_sent';
    ui.document.listeners.click({target:filter});
    assert.match(ui.get('view-content').innerHTML,/class="trace-card/);
    ui.get('group-filter').value='101';ui.document.listeners.change({target:ui.get('group-filter')});
    assert.match(ui.get('view-content').innerHTML,/class="trace-card/);
    ui.inputField('message-search','event-help');
    assert.match(ui.get('view-content').innerHTML,/class="trace-card/);
    ui.messageAction('[data-message]',trace.id);
    assert.equal(ui.requests.length,2);
    assert.equal(ui.requests[1].url,`/api/traces/${trace.id}`);
    assert.equal(ui.requests[1].options.headers.Authorization,'Bearer dashboard');
    assert.match(ui.get('message-data-content').innerHTML,/正在读取节点原始内容/);
    const detail=structuredClone(trace);detail.steps[0].payload={content:'<script>snapshot'};
    detail.steps[2].payload={content:'other node must not appear'};
    await ui.respond(1,200,detail);
    assert.match(ui.get('message-data-content').innerHTML,/&lt;script&gt;snapshot/);
    assert.match(ui.get('message-data-content').innerHTML,/消息 #42/);
    assert.match(ui.get('message-data-content').innerHTML,/节点原始内容/);
    assert.doesNotMatch(ui.get('message-data-content').innerHTML,/other node must not appear|CrossServerRelay|完整链路 JSON|trace-graph|trace-step-detail/);
    const content=ui.get('message-data-content').innerHTML;
    ui.intervals[0]();await ui.respond(2,200,{...snapshot(),traces:[]});
    assert.equal(ui.get('message-data-content').innerHTML,content);
    await ui.messageAction('#message-data-copy');assert.deepEqual(JSON.parse(ui.clipboard[0]),detail.steps[0].payload);
    ui.get('logout').listeners.click();
    assert.equal(ui.get('message-data-dialog').open,false);assert.equal(ui.get('message-data-content').innerHTML,'');
});

test('every graph node opens only its own raw payload, including ACK children and nodes without snapshots',async()=>{
    const ui=app('dashboard',{initialPath:'/messages',reducedMotion:true}),d=traceSnapshot(),trace=d.traces[0];
    trace.steps.push({id:'7',parentId:'3',kind:'delivery',label:'客户端确认报文',direction:'received',timestampMs:trace.timestampMs,status:'received'});
    await ui.respond(0,200,d);
    ui.toggleTrace(trace.id);
    assert.match(ui.get('view-content').innerHTML,/data-step="7"/);
    assert.match(ui.get('view-content').innerHTML,/trace-wire-node/);
    const detail=structuredClone(trace);
    detail.steps[0].payload={content:'SOURCE-ONLY'};
    detail.steps[2].payload={content:'DELIVERY-ONLY'};
    detail.steps[6].payload={type:'delivery_result',request_id:'ack-id',ok:true,note:'<img onerror=bad>'};
    ui.messageAction('[data-message]',trace.id,{step:'7'});
    assert.equal(ui.requests[1].url,`/api/traces/${trace.id}`);
    await ui.respond(1,200,detail);
    let html=ui.get('message-data-content').innerHTML;
    assert.match(html,/客户端确认报文/);assert.match(html,/ack-id/);
    assert.match(html,/&lt;img onerror=bad&gt;/);assert.doesNotMatch(html,/<img|SOURCE-ONLY|DELIVERY-ONLY|A · Steve/);
    await ui.messageAction('#message-data-copy');assert.deepEqual(JSON.parse(ui.clipboard[0]),detail.steps[6].payload);
    await ui.messageAction('#message-dialog-close');
    assert.equal(ui.document.activeElement.id,`trace-step-${trace.id}-7`);
    ui.messageAction('[data-message]',trace.id,{step:'2'});await ui.respond(2,200,detail);
    html=ui.get('message-data-content').innerHTML;
    assert.match(html,/ChatHub Core/);assert.match(html,/此节点没有报文快照/);
    assert.doesNotMatch(html,/id="message-data-json"|ack-id|SOURCE-ONLY/);
    assert.match(html,/id="message-data-copy"[^>]*disabled/);
    await ui.messageAction('#message-data-copy');assert.equal(ui.clipboard.length,1);
    await ui.messageAction('#message-dialog-close');
    ui.messageAction('[data-message]',trace.id,{step:'4'});
    detail.steps[3].truncated=true;detail.steps[3].payload=null;
    await ui.respond(3,200,detail);
    assert.match(ui.get('message-data-content').innerHTML,/快照|报文已截断/);
    assert.match(ui.get('message-data-content').innerHTML,/&lt;unsafe&gt; timeout/);
    await ui.messageAction('#message-data-copy');assert.equal(ui.clipboard[1],'null');
});

test('graph horizontal scroll survives polling and missing nodes never fall back to another payload',async()=>{
    const ui=app('dashboard',{initialPath:'/messages',reducedMotion:true}),d=traceSnapshot(),id=d.traces[0].id;
    await ui.respond(0,200,d);
    ui.toggleTrace(id);
    const graph=ui.get(`trace-graph-${id}`);graph.scrollLeft=286;
    ui.intervals[0]();await ui.respond(1,200,d);
    assert.equal(graph.scrollLeft,286);
    ui.messageAction('[data-message]',id,{step:'5'});
    const detail=structuredClone(d.traces[0]);detail.steps=detail.steps.filter(step=>step.id!=='5');detail.steps[0].payload={text:'not selected'};
    await ui.respond(2,200,detail);
    assert.match(ui.get('message-data-content').innerHTML,/所选节点不存在/);
    assert.doesNotMatch(ui.get('message-data-content').innerHTML,/not selected|id="message-data-json"/);
    await ui.messageAction('#message-data-copy');assert.equal(ui.clipboard.length,0);
});

test('trace loading can be cancelled, ignores late results and reports expired IDs without inventing paths',async()=>{
    const ui=app('dashboard',{initialPath:'/messages',reducedMotion:true}),d=traceSnapshot(),id=d.traces[0].id;
    await ui.respond(0,200,d);ui.messageAction('[data-message]',id);
    await ui.messageAction('#message-dialog-close');
    assert.equal(ui.requests[1].options.signal.aborted,true);
    await ui.respond(1,200,d.traces[0]);
    assert.equal(ui.get('message-data-dialog').open,false);
    ui.messageAction('[data-message]',id);await ui.respond(2,404,{error:'链路不存在或已过期。'});
    assert.match(ui.get('message-data-content').innerHTML,/链路不存在或已过期/);
    assert.doesNotMatch(ui.get('message-data-content').innerHTML,/trace-step-detail/);
    await ui.messageAction('#message-dialog-close');
    ui.messageAction('[data-message]',id);await ui.respond(3,401,{});
    assert.equal(ui.get('workspace').hidden,true);assert.equal(ui.get('message-data-dialog').open,false);
});

test('message stream merges OneBot traffic, filters directions, searches payloads and opens wire snapshots',async()=>{
    const ui=app('dashboard',{initialPath:'/messages'});
    const d=snapshot();
    d.messages=[{id:1,time:1,origin:'player',authorName:'Steve',groupName:'MC',segments:[{type:'text',text:'chat'}]}];
    d.onebotTraffic=[{id:'onebot-2',time:3,timestampMs:3000,direction:'sent',kind:'response',
        connectionId:'application',peer:'gateway',peerName:'ChatHub OneBot · Universal',action:'send_group_msg',payload:{status:'failed',retcode:100,echo:'request-id'}},
        {id:'onebot-1',time:2,timestampMs:2000,direction:'received',kind:'request',connectionId:'application',peer:'gateway',peerName:'ChatHub OneBot · Universal',
            action:'send_group_msg',payload:{action:'send_group_msg',params:{message:'<script> hello'},echo:'request-id'}},
        {id:'upstream-bot',time:4,timestampMs:4000,direction:'sent',kind:'request',connectionId:'client',peer:'client',peerName:'QQ Bot',
            action:'get_login_info',payload:{action:'get_login_info',params:{}}}];
    await ui.respond(0,200,d);
    let html=ui.get('view-content').innerHTML;
    assert.match(html,/OneBot 发送 →/);assert.match(html,/OneBot 接收 ←/);
    assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>/);
    assert.match(html,/ChatHub 统一接口/);assert.doesNotMatch(html,/QQ Bot|data-message="upstream-bot"/);
    assert.ok(html.indexOf('data-message="onebot-2"')<html.indexOf('data-message="onebot-1"'));
    assert.ok(html.indexOf('data-message="onebot-1"')<html.indexOf('data-message="1"'));
    const filter=ui.get('onebot-filter');filter.dataset.filter='onebot_received';
    filter.closest=selector=>selector==='[data-filter]'?filter:null;
    ui.document.listeners.click({target:filter});
    html=ui.get('view-content').innerHTML;
    assert.match(html,/data-message="onebot-1"/);assert.doesNotMatch(html,/data-message="onebot-2"|data-message="1"/);
    ui.inputField('message-search','request-id');
    assert.match(ui.get('view-content').innerHTML,/data-message="onebot-1"/);
    ui.messageAction('[data-message]','onebot-1');
    assert.match(ui.get('message-data-content').innerHTML,/payload 为协议数据/);
    assert.match(ui.get('message-data-content').innerHTML,/应用 → ChatHub/);
    await ui.messageAction('#message-data-copy');
    assert.deepEqual(JSON.parse(ui.clipboard[0]),d.onebotTraffic[1]);
    ui.intervals[0]();await ui.respond(1,200,snapshot());
    assert.match(ui.get('message-data-content').innerHTML,/send_group_msg/);
});

test('simplified OneBot details fetch on demand, escape and mask credentials, and copy addresses/token',async()=>{
    const ui=app('dashboard');await ui.respond(0);
    assert.equal(ui.requests.length,1);
    assert.match(ui.get('topology-world').innerHTML,/data-onebot-connection aria-haspopup="dialog"/);
    await ui.onebotAction();
    assert.equal(ui.requests[1].url,'/api/onebot/connection');
    assert.equal(ui.requests[1].options.headers.Authorization,'Bearer dashboard');
    assert.equal(ui.requests[1].options.cache,'no-store');
    assert.equal(ui.get('onebot-connection-dialog').open,true);
    assert.match(ui.get('onebot-connection-content').innerHTML,/正在获取/);
    await ui.respond(1,200,connectionDetails());
    const html=ui.get('onebot-connection-content').innerHTML;
    assert.match(html,/ws:\/\/192\.168\.31\.99:6700\/onebot\/v11/);
    assert.match(html,/id="onebot-token" type="password"/);
    assert.match(html,/value="&lt;secret&gt;&amp;&quot;token"/);
    assert.doesNotMatch(html,/<secret>|data-copy="&lt;secret/);
    assert.match(html,/所有虚拟群统一/);
    assert.deepEqual([...html.matchAll(/<h3>(.*?)<\/h3>/g)].map(match=>match[1]),['连接地址','鉴权与机器人身份']);
    assert.doesNotMatch(html,/鉴权方式|Authorization:|Bearer|虚拟群与各插件|MCDR 插件|onebot-config|完整配置|HTTP API|plugin-settings-footer/);
    assert.equal([...ui.storage.values()].includes(connectionDetails().access_token),false);
    await ui.onebotAction('#onebot-token-copy');
    assert.equal(ui.clipboard[0],connectionDetails().access_token);
    await ui.copyConfig('ws://192.168.31.99:6700/onebot/v11');
    assert.equal(ui.get('onebot-connection-toast').textContent,'连接地址已复制');
    ui.get('onebot-token').type='password';
    await ui.onebotAction('#onebot-token-reveal');assert.equal(ui.get('onebot-token').type,'text');
    await ui.onebotAction('#onebot-token-reveal');assert.equal(ui.get('onebot-token').type,'password');
    ui.intervals[0]();await ui.respond(2);
    assert.equal(ui.get('onebot-connection-content').innerHTML,html);
    assert.equal(ui.get('onebot-connection-dialog').showModalCount,1);
    assert.equal(ui.requests.filter(request=>request.url==='/api/onebot/connection').length,1);
    assert.equal(ui.cancelOnebot(),true);
    await ui.finishClose();
    assert.equal(ui.get('onebot-connection-dialog').open,false);
    assert.equal(ui.get('onebot-connection-content').innerHTML,'');
    assert.equal(ui.document.activeElement.id,'onebot-stat-open');
    await ui.onebotAction('#onebot-token-copy');assert.equal(ui.clipboard.length,2);
});

test('OneBot dialog supports keyboard opening, retry, close-during-load and rejects late responses',async()=>{
    const ui=app('dashboard');await ui.respond(0);
    assert.equal(ui.onebotAction('[data-onebot-connection]',{key:'Enter',id:'onebot-topology-open'}),true);
    await ui.respond(1,503,{error:'<unavailable>'});
    assert.match(ui.get('onebot-connection-content').innerHTML,/&lt;unavailable&gt;/);
    await ui.onebotAction('#onebot-connection-retry');
    await ui.onebotAction('#onebot-connection-close');
    await ui.finishClose();
    assert.equal(ui.requests[2].options.signal.aborted,true);
    await ui.respond(2,200,connectionDetails());
    assert.equal(ui.get('onebot-connection-dialog').open,false);
    assert.equal(ui.get('onebot-connection-content').innerHTML,'');
    assert.equal(ui.onebotAction('[data-onebot-connection]',{key:' ',id:'onebot-topology-open'}),true);
    await ui.respond(3,200,connectionDetails());
    ui.navigate('guide');await ui.finishClose();assert.equal(ui.get('onebot-connection-content').innerHTML,'');
    await ui.respond(4,200,nativeDetails());
    await ui.onebotAction();await ui.respond(5,200,connectionDetails());
    ui.get('logout').listeners.click();assert.equal(ui.get('onebot-connection-content').innerHTML,'');
    await ui.onebotAction();assert.equal(ui.requests.length,6);
});

test('the access guide requests the node password and shows it as the ChatHub client credential',async()=>{
    const ui=app('dashboard');await ui.respond(0);
    ui.navigate('guide');
    const request=ui.requests.at(-1);
    assert.equal(request.url,'/api/native/connection');
    assert.equal(request.options.headers.Authorization,'Bearer dashboard');
    assert.match(ui.get('view-content').innerHTML,/&lt;node_password&gt;/);
    await ui.respond(ui.requests.length-1,200,nativeDetails());
    const html=ui.get('view-content').innerHTML;
    assert.match(html,/接入 ChatHub 客户端/);
    assert.doesNotMatch(html,/接入 Minecraft 节点/);
    assert.match(html,/nodes-secret/);
    assert.doesNotMatch(html,/&lt;node_password&gt;/);
    assert.equal(ui.requests.filter(entry=>entry.url==='/api/native/connection').length,1);
    ui.get('logout').listeners.click();
});

test('OneBot addresses show public access from the LAN and deduplicate current/internal entries',async()=>{
    const ui=app('dashboard');await ui.respond(0);
    ui.location.host='192.168.31.99:6700';
    const details={...connectionDetails(),public_url:'wss://console.example:55555/onebot/v11'};
    details.direct_urls.push({...details.direct_urls[0]});
    await ui.onebotAction();await ui.respond(1,200,details);
    const html=ui.get('onebot-connection-content').innerHTML;
    assert.match(html,/公网访问地址/);
    assert.match(html,/内网访问地址（当前访问）/);
    assert.doesNotMatch(html,/Web 访问地址/);
    assert.equal((html.match(/class="onebot-address"/g)||[]).length,2);
    await ui.copyConfig(details.public_url);
    assert.equal(ui.clipboard[0],details.public_url);
    ui.cancelOnebot();await ui.finishClose();
    ui.location.protocol='https:';ui.location.host='console.example:55555';
    await ui.onebotAction();await ui.respond(2,200,details);
    const publicHtml=ui.get('onebot-connection-content').innerHTML;
    assert.match(publicHtml,/公网访问地址（当前访问）/);
    assert.doesNotMatch(publicHtml,/Web 访问地址/);
    assert.equal((publicHtml.match(/class="onebot-address"/g)||[]).length,2);
});

test('old running backends report an actionable upgrade message instead of a bare Not found',async()=>{
    const ui=app('dashboard');await ui.respond(0);await ui.onebotAction();
    await ui.respond(1,404,{error:'Not found'});
    assert.match(ui.get('onebot-connection-content').innerHTML,/重启 ChatHub 服务端/);
    assert.doesNotMatch(ui.get('onebot-connection-content').innerHTML,/Not found/);
});

test('OneBot credential expiry clears dialog data and clipboard denial provides manual copy guidance',async()=>{
    const ui=app('dashboard',{clipboardDenied:true});await ui.respond(0);
    await ui.onebotAction();await ui.respond(1,200,connectionDetails());
    await ui.onebotAction('#onebot-token-copy');
    assert.match(ui.get('onebot-connection-toast').textContent,/手动复制 Token 和地址/);
    ui.intervals[0]();await ui.respond(2,401);
    assert.equal(ui.get('onebot-connection-dialog').open,false);
    assert.equal(ui.get('onebot-connection-content').innerHTML,'');
    ui.submit('new-token');await ui.respond(3);
    await ui.onebotAction();await ui.respond(4,401);
    assert.equal(ui.get('workspace').hidden,true);
    assert.equal(ui.get('onebot-connection-content').innerHTML,'');
    assert.match(ui.get('auth-error').textContent,/管理凭证失效/);
});

function messageSnapshot() {
    const d=snapshot();
    d.messages=[{id:42,groupId:100,groupName:'<World>',authorId:2,authorName:'<System>',time:1700000000,
        origin:'system',systemKind:'death',sourceMessageId:12,
        segments:[{type:'text',text:'<img src=x onerror=alert(1)>'},{type:'image',url:'https://example.com/image.png'},{type:'at',userId:'all'}]}];
    d.stats.messages=1;
    return d;
}

test('message stream opens escaped complete message JSON and copies the unmodified snapshot',async()=>{
    const ui=app('dashboard',{initialPath:'/messages'}),d=messageSnapshot();await ui.respond(0,200,d);
    assert.match(ui.get('view-content').innerHTML,/data-message="42" role="button" tabindex="0"/);
    await ui.messageAction('[data-message]',42);
    assert.equal(ui.get('message-data-dialog').open,true);
    assert.equal(ui.document.activeElement.id,'message-dialog-close');
    const content=ui.get('message-data-content').innerHTML;
    assert.match(content,/&lt;img src=x onerror=alert\(1\)&gt;/);
    assert.match(content,/&quot;sourceMessageId&quot;: 12/);
    assert.match(content,/&quot;systemKind&quot;: &quot;death&quot;/);
    assert.doesNotMatch(content,/<img|<World>|<System>/);
    await ui.messageAction('#message-data-copy');
    assert.equal(ui.clipboard[0],JSON.stringify(d.messages[0],null,2));
    assert.equal(ui.get('message-dialog-toast').textContent,'消息 JSON 已复制');
    await ui.messageAction('#message-dialog-close');
    await ui.finishClose();
    assert.equal(ui.get('message-data-dialog').open,false);
    assert.equal(ui.get('message-data-content').innerHTML,'');
    assert.equal(ui.document.activeElement.id,'message-open-42');
    ui.navigate('messages');
    assert.equal(ui.messageAction('[data-message]',42,{key:'Enter'}),true);
    assert.equal(ui.get('message-data-dialog').open,true);
    assert.equal(ui.cancelMessage(),true);
    await ui.finishClose();
    assert.equal(ui.get('message-data-dialog').open,false);
    assert.equal(ui.messageAction('[data-message]',42,{key:' '}),true);
    assert.equal(ui.get('message-data-dialog').open,true);
});

test('polling and cache eviction preserve an opened message snapshot without reopening or animating the dialog',async()=>{
    const ui=app('dashboard');await ui.respond(0,200,messageSnapshot());ui.navigate('messages');
    await ui.messageAction('[data-message]',42);
    const content=ui.get('message-data-content').innerHTML,animationCount=ui.entries.length;
    ui.intervals[0]();await ui.respond(1,200,snapshot());
    assert.equal(ui.get('message-data-content').innerHTML,content);
    assert.equal(ui.get('message-data-dialog').showModalCount,1);
    assert.equal(ui.entries.length,animationCount);
    assert.equal(ui.document.activeElement.id,'message-dialog-close');
    await ui.messageAction('#message-data-copy');
    assert.equal(JSON.parse(ui.clipboard[0]).id,42);
    ui.cancelMessage();
    await ui.finishClose();
    await ui.messageAction('[data-message]',42);
    assert.equal(ui.get('message-data-dialog').open,false);
});

test('navigation, logout and credential expiry clear message data and reject unavailable messages',async()=>{
    const ui=app('dashboard');await ui.respond(0,200,messageSnapshot());ui.navigate('messages');
    await ui.messageAction('[data-message]',999);
    assert.equal(ui.get('message-data-dialog').open,false);
    await ui.messageAction('[data-message]',42);ui.history.back();
    await ui.finishClose();
    assert.equal(ui.get('message-data-dialog').open,false);
    assert.equal(ui.get('message-data-content').innerHTML,'');
    await ui.messageAction('[data-message]',42);ui.get('logout').listeners.click();
    assert.equal(ui.get('message-data-dialog').open,false);
    assert.equal(ui.get('message-data-content').innerHTML,'');
    await ui.messageAction('[data-message]',42);
    assert.equal(ui.get('message-data-dialog').open,false);
    ui.submit('new-token');await ui.respond(1,200,messageSnapshot());
    await ui.messageAction('[data-message]',42);
    ui.intervals[0]();await ui.respond(2,401);
    assert.equal(ui.get('message-data-dialog').open,false);
    assert.equal(ui.get('message-data-content').innerHTML,'');
});

test('clipboard errors leave selectable message JSON visible with manual copy guidance',async()=>{
    const ui=app('dashboard',{clipboardDenied:true,reducedMotion:true});await ui.respond(0,200,messageSnapshot());
    await ui.messageAction('[data-message]',42);await ui.messageAction('#message-data-copy');
    assert.equal(ui.get('message-data-dialog').open,true);
    assert.match(ui.get('message-data-content').innerHTML,/<pre id="message-data-json" tabindex="0">/);
    assert.match(ui.get('message-dialog-toast').textContent,/手动选择并复制 JSON/);
    assert.equal(ui.clipboard.length,0);assert.equal(ui.entries.length,0);
});

test('deep links remain behind authentication and login restores the requested route, title and active navigation',async()=>{
    const ui=app('dashboard',{initialPath:'/plugins/'});
    assert.equal(ui.get('workspace').hidden,true);
    assert.equal(ui.document.title,'登录 · ChatHub');
    assert.equal(ui.location.pathname,'/plugins/');
    await ui.respond(0,200,adapterSnapshot());
    assert.equal(ui.document.title,'平台插件 · ChatHub');
    assert.equal(ui.get('breadcrumb-title').textContent,'平台插件');
    assert.match(ui.get('view-content').innerHTML,/plugins-list/);
    assert.equal(ui.get('nav-plugins').attributes['aria-current'],'page');
    assert.equal(ui.get('nav-overview').attributes['aria-current'],undefined);
    assert.equal(ui.location.pathname,'/plugins');
    assert.deepEqual(ui.historyCalls,[{method:'replace',url:'/plugins',state:null}]);
    assert.equal(ui.entries.length,0); // No animation during credential verification.
});

test('page navigation updates paths without reload, avoids duplicate history and supports browser back/forward',async()=>{
    const ui=app('dashboard');await ui.respond(0);
    assert.equal(ui.navigate('messages'),true);
    assert.equal(ui.location.pathname,'/messages');
    assert.equal(ui.document.title,'消息流 · ChatHub');
    ui.navigate('messages');assert.equal(ui.historyCalls.length,1);
    ui.navigate('logs');ui.navigate('plugins');
    assert.deepEqual(ui.historyCalls.map(call=>call.url),['/messages','/logs','/plugins']);
    assert.equal(ui.requests.length,1);
    ui.history.back();
    assert.equal(ui.location.pathname,'/logs');
    assert.equal(ui.document.title,'日志 · ChatHub');
    assert.equal(ui.get('nav-logs').attributes['aria-current'],'page');
    ui.history.back();assert.equal(ui.document.title,'消息流 · ChatHub');
    ui.history.forward();assert.equal(ui.document.title,'日志 · ChatHub');
    assert.equal(ui.historyCalls.length,3); // Popstate never pushes a new entry.
    assert.equal(ui.document.activeElement.id,'main');
});

test('modified link clicks keep native new-tab behavior and logged-out navigation never reveals workspace data',async()=>{
    const ui=app('dashboard');await ui.respond(0);
    for(const modifier of [{ctrlKey:true},{metaKey:true},{shiftKey:true},{altKey:true},{button:1}]) {
        assert.equal(ui.navigate('plugins',modifier),false);
    }
    assert.equal(ui.location.pathname,'/');assert.equal(ui.historyCalls.length,0);
    assert.equal(ui.navigate('constructor'),false);
    ui.navigate('logs');ui.navigate('plugins');ui.get('logout').listeners.click();
    ui.history.back();
    assert.equal(ui.location.pathname,'/logs');assert.equal(ui.get('workspace').hidden,true);
    assert.equal(ui.get('view-content').innerHTML,'');
    assert.equal(ui.navigate('messages'),false);
    ui.submit('replacement');await ui.respond(1);
    assert.equal(ui.document.title,'日志 · ChatHub');
    assert.equal(ui.location.pathname,'/logs');
});

test('browser navigation closes secondary dialogs and clears sensitive drafts without breaking the route',async()=>{
    const ui=app('dashboard');await ui.respond(0,200,adapterSnapshot());ui.navigate('plugins');ui.selectPlugin('onebot');
    ui.inputAdapter('adapter-token','sensitive-draft');
    ui.history.back();
    await ui.finishClose();
    assert.equal(ui.get('plugin-settings-dialog').open,false);
    assert.equal(ui.location.pathname,'/');
    ui.history.forward();ui.selectPlugin('onebot');
    assert.doesNotMatch(ui.get('plugin-dialog-content').innerHTML,/sensitive-draft/);
});

test('entrance animations run only on navigation/opening, never polling, and rapid navigation cancels older motion',async()=>{
    const ui=app('dashboard');await ui.respond(0,200,adapterSnapshot());ui.navigate('plugins');
    assert.equal(ui.entries.length,2);
    assert.deepEqual(ui.entries.slice(0,2).map(entry=>entry.element.id),['view-content','page-heading']);
    ui.navigate('plugins');assert.equal(ui.entries.length,2);
    ui.intervals[0]();await ui.respond(1,200,adapterSnapshot());
    assert.equal(ui.entries.length,2);
    ui.selectPlugin('onebot');assert.equal(ui.entries.length,3);
    assert.equal(ui.entries[2].element.id,'plugin-settings-dialog');
    assert.match(ui.entries[2].frames[0].transform,/scale/);
    ui.inputAdapter('adapter-name','kept draft');
    ui.intervals[0]();await ui.respond(2,200,adapterSnapshot());
    assert.equal(ui.entries.length,3);
    assert.equal(ui.get('plugin-settings-dialog').showModalCount,1);
    ui.closePlugin();ui.navigate('logs');
    assert.equal(ui.entries.length,6);
    assert.ok(ui.entries[0].cancelled);assert.ok(ui.entries[1].cancelled);
    ui.get('logout').listeners.click();
    assert.ok(ui.entries.every(entry=>entry.cancelled));
});

test('reduced motion cancels active entrances and unsupported animation APIs keep navigation/dialogs functional',async()=>{
    const ui=app('dashboard');await ui.respond(0,200,adapterSnapshot());ui.navigate('plugins');ui.selectPlugin('onebot');
    ui.changeReducedMotion(true);
    assert.ok(ui.entries.every(entry=>entry.cancelled));
    const count=ui.entries.length;
    ui.closePlugin();ui.navigate('logs');ui.navigate('plugins');ui.selectPlugin('onebot');
    assert.equal(ui.entries.length,count);
    assert.equal(ui.location.pathname,'/plugins');
    const reduced=app('dashboard',{reducedMotion:true});await reduced.respond(0,200,adapterSnapshot());reduced.navigate('plugins');reduced.selectPlugin('onebot');
    assert.equal(reduced.entries.length,0);
    const fallback=app('dashboard',{webAnimations:false});await fallback.respond(0,200,adapterSnapshot());fallback.navigate('plugins');fallback.selectPlugin('onebot');
    assert.equal(fallback.entries.length,0);assert.equal(fallback.get('plugin-settings-dialog').open,true);
    assert.equal(fallback.location.pathname,'/plugins');
});

const dialogCases = [
    {dialog:'plugin-settings-dialog',content:'plugin-dialog-content',focus:'plugin-open-relay',
        open:ui=>ui.selectPlugin('relay'),close:ui=>ui.closePlugin()},
    {dialog:'message-data-dialog',content:'message-data-content',focus:'message-open-42',
        open:ui=>ui.messageAction('[data-message]',42),close:ui=>ui.messageAction('#message-dialog-close')},
    {dialog:'onebot-connection-dialog',content:'onebot-connection-content',focus:'onebot-stat-open',
        open:ui=>ui.onebotAction(),close:ui=>ui.onebotAction('#onebot-connection-close')},
];
for (const example of dialogCases) {
    test(`${example.dialog} retains its contents until exit completes and ignores repeated closes/polling`,async()=>{
        const ui=app('dashboard');await ui.respond(0,200,messageSnapshot());await example.open(ui);
        const dialog=ui.get(example.dialog),content=ui.get(example.content).innerHTML;
        await example.close(ui);
        const exit=ui.entries.at(-1);
        assert.equal(exit.element,dialog);assert.equal(exit.options.duration,180);
        assert.equal(exit.frames[1].opacity,0);assert.match(exit.frames[1].transform,/scale/);
        assert.equal(dialog.open,true);assert.equal(dialog.inert,true);
        assert.equal(dialog.classList.contains('dialog-closing'),true);
        assert.equal(ui.get(example.content).innerHTML,content);
        await example.close(ui);
        ui.get('pause').listeners.click(); // Re-rendering must not clear the closing surface.
        assert.equal(ui.entries.at(-1),exit);
        assert.equal(ui.get(example.content).innerHTML,content);
        await ui.finishClose();
        assert.equal(dialog.open,false);assert.equal(dialog.inert,false);
        assert.equal(dialog.classList.contains('dialog-closing'),false);
        assert.equal(ui.get(example.content).innerHTML,'');
        assert.equal(ui.document.activeElement.id,example.focus);
        if (example.dialog==='onebot-connection-dialog') {
            assert.equal(ui.requests[1].options.signal.aborted,true);
            await ui.respond(1,200,connectionDetails());
            assert.equal(dialog.open,false);
        }
    });

    test(`${example.dialog} closes on backdrop clicks, not content clicks or drags from inside`,async()=>{
        const ui=app('dashboard');await ui.respond(0,200,messageSnapshot());await example.open(ui);
        const dialog=ui.get(example.dialog);
        const outside={target:dialog,button:0,clientX:20,clientY:20};
        const inside={target:dialog,button:0,clientX:1050,clientY:50};
        dialog.listeners.pointerdown(inside);dialog.listeners.click(inside);
        assert.equal(dialog.classList.contains('dialog-closing'),false);
        dialog.listeners.pointerdown(inside);dialog.listeners.click(outside);
        assert.equal(dialog.classList.contains('dialog-closing'),false);
        const contentClick={...inside,target:ui.get(example.content)};
        dialog.listeners.pointerdown(contentClick);dialog.listeners.click(contentClick);
        assert.equal(dialog.classList.contains('dialog-closing'),false);
        dialog.listeners.pointerdown(outside);dialog.listeners.pointercancel();dialog.listeners.click(outside);
        assert.equal(dialog.classList.contains('dialog-closing'),false);
        dialog.listeners.pointerdown(outside);dialog.listeners.click(outside);
        assert.equal(dialog.classList.contains('dialog-closing'),true);
        await ui.finishClose();assert.equal(dialog.open,false);
        if (example.dialog==='onebot-connection-dialog') await ui.respond(1,200,connectionDetails());
    });
}

test('reopening during exit cancels the old close without clearing new contents or restoring old focus',async()=>{
    const ui=app('dashboard');await ui.respond(0,200,messageSnapshot());
    await ui.messageAction('[data-message]',42);await ui.messageAction('#message-dialog-close');
    const exit=ui.entries.at(-1);
    await ui.messageAction('[data-message]',42);await tick();
    assert.equal(exit.cancelled,true);
    const dialog=ui.get('message-data-dialog');
    assert.equal(dialog.open,true);assert.equal(dialog.inert,false);assert.equal(dialog.showModalCount,1);
    assert.equal(dialog.classList.contains('dialog-closing'),false);
    assert.match(ui.get('message-data-content').innerHTML,/&quot;id&quot;: 42/);
    assert.equal(ui.document.activeElement.id,'message-dialog-close');
    await ui.finishClose();assert.equal(dialog.open,true);
});

test('motion preference changes and logout finish pending exits; reduced motion and missing APIs close immediately',async()=>{
    for (const options of [{reducedMotion:true},{webAnimations:false}]) {
        const ui=app('dashboard',options);await ui.respond(0,200,messageSnapshot());
        await ui.messageAction('[data-message]',42);await ui.messageAction('#message-dialog-close');
        assert.equal(ui.get('message-data-dialog').open,false);
        assert.equal(ui.get('message-data-content').innerHTML,'');
    }
    for (const finish of [ui=>ui.changeReducedMotion(true),ui=>ui.get('logout').listeners.click()]) {
        const ui=app('dashboard');await ui.respond(0,200,messageSnapshot());
        await ui.messageAction('[data-message]',42);await ui.messageAction('#message-dialog-close');
        finish(ui);
        assert.equal(ui.get('message-data-dialog').open,false);
        assert.equal(ui.get('message-data-content').innerHTML,'');
        assert.equal(ui.entries.at(-1).cancelled,true);
    }
});

test('plugin panel displays escaped blacklist configuration and handles legacy snapshots', async () => {
    const ui = app('token');
    const d = snapshot();
    d.relay = {enabled:true,nodes:[],blacklist:['private','<unsafe>'],includeSystem:true};
    await ui.respond(0,200,d);
    ui.navigate('plugins');
    ui.selectPlugin('relay');
    const content = ui.get('plugin-dialog-content').innerHTML;
    assert.match(content,/客户端黑名单/);
    assert.match(content,/private/);
    assert.match(content,/blacklist: \[&quot;private&quot;,&quot;&lt;unsafe&gt;&quot;\]/);
    assert.doesNotMatch(content,/<unsafe>/);
    assert.match(content,/编辑 server\/config.yaml 后重启/);
    ui.intervals[0]();
    await ui.respond(1);
    assert.match(ui.get('plugin-dialog-content').innerHTML,/blacklist: \[\]/);
});

test('login opens workspace only after verification, logout clears data and credential', async () => {
    const ui = app();
    ui.submit('valid-token');
    assert.equal(ui.get('workspace').hidden,true);
    assert.equal(ui.get('login-submit').disabled,true);
    assert.equal(ui.storage.size,0);
    assert.equal(ui.requests[0].options.headers.Authorization,'Bearer valid-token');
    await ui.respond(0);
    assert.equal(ui.get('workspace').hidden,false);
    assert.equal(ui.get('login-page').hidden,true);
    assert.match(ui.get('view-content').innerHTML,/连接拓扑/);
    assert.equal(ui.storage.get('chathub.dashboard.token'),'valid-token');
    ui.get('logout').listeners.click();
    assert.equal(ui.get('workspace').hidden,true);
    assert.equal(ui.get('login-page').hidden,false);
    assert.equal(ui.get('view-content').innerHTML,'');
    assert.equal(ui.storage.size,0);
    assert.equal(ui.document.title,'登录 · ChatHub');
});

test('stored credentials are revalidated without exposing workspace; rejected credentials stay logged out', async () => {
    const ui = app('expired-token');
    assert.equal(ui.requests.length,1);
    assert.equal(ui.get('workspace').hidden,true);
    await ui.respond(0,401);
    assert.equal(ui.get('workspace').hidden,true);
    assert.equal(ui.storage.size,0);
    assert.match(ui.get('auth-error').textContent,/凭证无效/);
    assert.equal(ui.get('login-submit').disabled,false);
    ui.submit('replacement-token');
    await ui.respond(1);
    assert.equal(ui.get('workspace').hidden,false);
});

test('failed login stays on login page; credential expiry during refresh returns to login', async () => {
    const ui = app();
    ui.submit('token');
    await ui.respond(0,503);
    assert.equal(ui.get('workspace').hidden,true);
    assert.match(ui.get('auth-error').textContent,/配置 dashboard_token/);
    ui.submit('token');
    await ui.respond(1);
    ui.intervals[0]();
    await ui.respond(2,401);
    assert.equal(ui.get('workspace').hidden,true);
    assert.equal(ui.get('view-content').innerHTML,'');
    assert.equal(ui.storage.size,0);
});

test('late responses after logout cannot restore a session, network failures mark existing snapshot stale', async () => {
    const ui = app('token');
    await ui.respond(0);
    ui.intervals[0]();
    await ui.respond(1,500);
    assert.equal(ui.get('workspace').hidden,false);
    assert.equal(ui.get('topology-status').hidden,false);
    assert.match(ui.get('topology-status').textContent,/过期快照/);
    ui.intervals[0]();
    ui.get('logout').listeners.click();
    assert.equal(ui.requests[2].options.signal.aborted,true);
    await ui.respond(2);
    assert.equal(ui.get('workspace').hidden,true);
    assert.equal(ui.storage.size,0);
    assert.equal(ui.get('view-content').innerHTML,'');
});

test('theme follows system until an explicit choice; both controls stay synchronized', () => {
    const ui = app(undefined,{systemDark:true});
    assert.equal(ui.document.documentElement.dataset.theme,'dark');
    assert.equal(ui.get('theme-meta').attributes.content,'#000000');
    assert.equal(ui.get('theme-toggle-label').textContent,'浅色模式');
    ui.changeSystemTheme(false);
    assert.equal(ui.document.documentElement.dataset.theme,'light');
    ui.get('theme-toggle-login').listeners.click();
    assert.equal(ui.document.documentElement.dataset.theme,'dark');
    assert.equal(ui.storage.get('chathub.theme'),'dark');
    for (const id of ['theme-toggle','theme-toggle-login']) {
        assert.equal(ui.get(id).attributes['aria-label'],'切换到浅色模式');
        assert.match(ui.get(`${id}-icon`).innerHTML,/<circle/);
    }
    ui.changeSystemTheme(false);
    assert.equal(ui.document.documentElement.dataset.theme,'dark');
    ui.get('theme-toggle').listeners.click();
    assert.equal(ui.document.documentElement.dataset.theme,'light');
    assert.equal(ui.get('theme-meta').attributes.content,'#2563eb');
    assert.equal(ui.requests.length,0);
});

test('stored theme overrides system on reload and invalid preferences are ignored', () => {
    const ui = app(undefined,{storedTheme:'light',systemDark:true});
    assert.equal(ui.document.documentElement.dataset.theme,'light');
    ui.changeSystemTheme(true);
    assert.equal(ui.document.documentElement.dataset.theme,'light');
    assert.equal(app(undefined,{storedTheme:'invalid',systemDark:true}).document.documentElement.dataset.theme,'dark');
    assert.equal(app(undefined,{noMatchMedia:true}).document.documentElement.dataset.theme,'light');
});

test('theme survives login, polling and logout without changing dashboard authentication', async () => {
    const ui = app();
    ui.get('theme-toggle-login').listeners.click();
    ui.submit('valid-token');
    await ui.respond(0);
    ui.get('theme-toggle').listeners.click();
    assert.equal(ui.get('workspace').hidden,false);
    assert.equal(ui.requests.length,1);
    assert.equal(ui.storage.get('chathub.dashboard.token'),'valid-token');
    ui.intervals[0]();
    await ui.respond(1);
    assert.equal(ui.document.documentElement.dataset.theme,'light');
    ui.get('logout').listeners.click();
    assert.equal(ui.storage.has('chathub.dashboard.token'),false);
    assert.equal(ui.storage.get('chathub.theme'),'light');
    assert.equal(ui.document.documentElement.dataset.theme,'light');
    assert.equal(ui.get('login-page').hidden,false);
});

test('disabled storage retains an in-memory theme choice and still allows login', async () => {
    const ui = app(undefined,{blockedStorage:true});
    ui.get('theme-toggle-login').listeners.click();
    ui.changeSystemTheme(false);
    assert.equal(ui.document.documentElement.dataset.theme,'dark');
    ui.submit('valid-token');
    await ui.respond(0);
    assert.equal(ui.get('workspace').hidden,false);
    assert.equal(ui.storage.size,0);
    ui.get('logout').listeners.click();
    assert.equal(ui.document.documentElement.dataset.theme,'dark');
});

test('fallback animates only theme changes, handles repeated clicks and cleans up', () => {
    const ui=app(), root=ui.document.documentElement;
    assert.equal(root.classList.contains('theme-changing'),false);
    ui.clickTheme();
    assert.equal(root.dataset.theme,'dark');
    assert.equal(root.classList.contains('theme-changing'),true);
    ui.clickTheme('theme-toggle');
    assert.equal(root.dataset.theme,'light');
    ui.finishAnimation();
    assert.equal(root.classList.contains('theme-changing'),false);
});

test('view transition reveals from the button, prevents overlapping transitions and cleans up', async () => {
    const ui=app(undefined,{viewTransitions:true}), root=ui.document.documentElement;
    assert.equal(ui.transitions.length,0);
    ui.clickTheme();
    assert.equal(root.dataset.theme,'dark');
    assert.equal(root.classList.contains('theme-reveal'),true);
    assert.equal(root.style.getPropertyValue('--theme-x'),'1060px');
    assert.equal(root.style.getPropertyValue('--theme-y'),'46px');
    assert.equal(root.style.getPropertyValue('--theme-radius'),`${Math.hypot(1060,754)}px`);
    ui.clickTheme();
    assert.equal(ui.transitions.length,1);
    assert.equal(ui.storage.get('chathub.theme'),'dark');
    ui.transitions[0].finish();await tick();
    assert.equal(root.classList.contains('theme-reveal'),false);
    assert.equal(root.style.getPropertyValue('--theme-radius'),'');
    ui.clickTheme('theme-toggle');
    assert.equal(root.dataset.theme,'light');
    ui.transitions[1].fail();await tick();
    assert.equal(root.classList.contains('theme-reveal'),false);
    ui.clickTheme();
    assert.equal(root.dataset.theme,'dark');
    ui.transitions[2].finish();await tick();
});

test('reduced motion bypasses all theme animations, including system changes', () => {
    const ui=app(undefined,{reducedMotion:true,viewTransitions:true}), root=ui.document.documentElement;
    ui.changeSystemTheme(true);
    assert.equal(root.dataset.theme,'dark');
    ui.clickTheme();
    assert.equal(root.dataset.theme,'light');
    assert.equal(ui.transitions.length,0);
    assert.equal(root.classList.contains('theme-changing'),false);
    assert.equal(root.classList.contains('theme-reveal'),false);
});

test('a failing View Transition API falls back without losing the theme preference', () => {
    const ui=app(undefined,{viewTransitions:true,transitionThrows:true}), root=ui.document.documentElement;
    ui.clickTheme();
    assert.equal(root.dataset.theme,'dark');
    assert.equal(ui.storage.get('chathub.theme'),'dark');
    assert.equal(root.classList.contains('theme-changing'),true);
    assert.equal(root.classList.contains('theme-reveal'),false);
    assert.equal(root.style.getPropertyValue('--theme-x'),'');
    ui.finishAnimation();
});

const adapterSnapshot = clients => ({...snapshot(),onebotAdapters:{clients:clients||[]}});
const adapterEntry = {id:'12345678-1234-4123-8123-123456789012',name:'QQ 群',address:'ws://localhost:3001/',groupId:555,status:'connecting',error:''};
const controllableSnapshot = (enabled=false) => ({...adapterSnapshot(),pluginStates:{onebot:true,relay:enabled},
    relay:{enabled,nodes:[],blacklist:[],includeSystem:true}});
const registryManifest = (id,extra={}) => ({id,name:'服务器定义的插件',module:'ServerPlugin',version:'1.2.3',
    kind:'business',icon:'puzzle',settingsPanel:id,settingsMode:'readonly',help:'服务器配置说明',schemaVersion:1,
    description:'服务器定义的说明',enabled:false,enabledSource:'default',configuration:{section:`plugins.${id}`,values:{}},...extra});
const editorSnapshot = (values={nodes:[],blacklist:[],include_system:true},revision='initial') => ({...controllableSnapshot(),
    plugins:[registryManifest('relay',{name:'跨服消息转发',settingsMode:'managed',configuration:{section:'plugins.relay',values,
        editable:true,revision,source:'default',applyMode:'live',fields:[
            {key:'nodes',label:'转发范围',type:'string-array',default:[],description:'每行一个客户端 ID'},
            {key:'blacklist',label:'黑名单',type:'string-array',default:[]},
            {key:'include_system',label:'系统消息',type:'boolean',default:true},
        ]}})]});

test('registry editor renders typed controls, keeps drafts across polling, saves typed values and refreshes its revision',async()=>{
    const ui=app('dashboard');await ui.respond(0,200,editorSnapshot());ui.navigate('plugins');ui.selectPlugin('relay');
    let html=ui.get('plugin-dialog-content').innerHTML;
    assert.match(html,/plugin-config-form/);assert.match(html,/<textarea/);assert.match(html,/type="checkbox"/);
    assert.doesNotMatch(html,/配置快照/);
    ui.inputConfig('relay','nodes','survival\n creative \n\n');ui.inputConfig('relay','blacklist','<private>');
    ui.inputConfig('relay','include_system',false,{checkbox:true});
    ui.intervals[0]();await ui.respond(1,200,editorSnapshot());
    html=ui.get('plugin-dialog-content').innerHTML;assert.match(html,/&lt;private&gt;/);assert.match(html,/survival/);
    ui.submitConfig('relay');
    assert.equal(ui.requests[2].url,'/api/plugins/relay/config');assert.equal(ui.requests[2].options.method,'PUT');
    assert.equal(ui.requests[2].options.headers.Authorization,'Bearer dashboard');
    assert.deepEqual(JSON.parse(ui.requests[2].options.body),{schemaVersion:1,revision:'initial',
        values:{nodes:['survival','creative'],blacklist:['<private>'],include_system:false}});
    ui.submitConfig('relay');ui.togglePlugin('relay');ui.intervals[0]();assert.equal(ui.requests.length,3);
    const saved=editorSnapshot({nodes:['survival','creative'],blacklist:['<private>'],include_system:false},'saved');
    saved.plugins[0].configuration.source='persisted';
    await ui.respond(2,200,{plugin:saved.plugins[0]});
    assert.match(ui.get('plugin-dialog-content').innerHTML,/配置已保存并即时生效/);
    await ui.respond(3,200,saved);
    assert.equal(ui.get('plugin-settings-dialog').open,true);
    ui.inputConfig('relay','nodes','creative');ui.submitConfig('relay');
    assert.equal(JSON.parse(ui.requests[4].options.body).revision,'saved');
    await ui.respond(4,500,{error:'无法保存配置',fieldErrors:{nodes:'范围无效'}});await ui.respond(5,200,saved);
    html=ui.get('plugin-dialog-content').innerHTML;assert.match(html,/无法保存配置/);assert.match(html,/范围无效/);assert.match(html,/creative/);
});

test('editor defaults do not write automatically and version conflicts preserve drafts until explicitly discarded',async()=>{
    const ui=app('dashboard');await ui.respond(0,200,editorSnapshot({nodes:['a'],blacklist:['b'],include_system:false}));ui.selectPlugin('relay');
    ui.configButton('relay','default');assert.equal(ui.requests.length,1);
    assert.match(ui.get('plugin-dialog-content').innerHTML,/点击保存后生效/);
    ui.inputConfig('relay','nodes','unsaved');
    const latest=editorSnapshot({nodes:['latest'],blacklist:[],include_system:true},'changed');
    ui.intervals[0]();await ui.respond(1,200,latest);
    assert.match(ui.get('plugin-dialog-content').innerHTML,/服务端配置已变更/);
    assert.match(ui.get('plugin-dialog-content').innerHTML,/unsaved/);
    ui.submitConfig('relay');assert.equal(ui.requests.length,2);
    ui.configButton('relay','reset');
    let html=ui.get('plugin-dialog-content').innerHTML;assert.doesNotMatch(html,/unsaved/);assert.match(html,/latest/);
    ui.inputConfig('relay','nodes','my draft');ui.submitConfig('relay');
    const newer=editorSnapshot({nodes:['newer'],blacklist:[],include_system:true},'newer');
    await ui.respond(2,409,{error:'配置已更新',plugin:newer.plugins[0]});
    html=ui.get('plugin-dialog-content').innerHTML;assert.match(html,/my draft/);assert.match(html,/配置已更新/);
    await ui.respond(3,200,newer);
});

test('generic editor supports strings, enums and numbers with frontend validation; config writes never leak into browser storage',async()=>{
    const ui=app('dashboard');const d={...controllableSnapshot(),plugins:[registryManifest('demo',{settingsMode:'managed',
        configuration:{section:'plugins.demo',values:{title:'hello',limit:5,mode:'full'},editable:true,revision:'revision',fields:[
            {key:'title',label:'Title',type:'string',minLength:2,maxLength:10,default:'hello'},
            {key:'limit',label:'Limit',type:'number',minimum:1,maximum:10,integer:true,default:5},
            {key:'mode',label:'Mode',type:'enum',options:['compact','full'],default:'full'},
        ]}})],pluginStates:{demo:false}};
    await ui.respond(0,200,d);ui.selectPlugin('demo');
    assert.match(ui.get('plugin-dialog-content').innerHTML,/<select/);assert.match(ui.get('plugin-dialog-content').innerHTML,/type="number"/);
    ui.inputConfig('demo','limit','99');ui.submitConfig('demo');assert.equal(ui.requests.length,1);
    assert.match(ui.get('plugin-dialog-content').innerHTML,/有效数字/);
    ui.inputConfig('demo','limit','8');ui.inputConfig('demo','mode','compact');ui.submitConfig('demo');
    assert.deepEqual(JSON.parse(ui.requests[1].options.body).values,{title:'hello',limit:8,mode:'compact'});
    assert.equal([...ui.storage.values()].includes('hello'),false);
    await ui.respond(1,500,{error:'fixture failure'});await ui.respond(2,200,d);
});

test('closing or logging out while saving config cannot reopen a dialog or restore an obsolete session',async()=>{
    const ui=app('dashboard');await ui.respond(0,200,editorSnapshot());ui.selectPlugin('relay');ui.inputConfig('relay','blacklist','private');ui.submitConfig('relay');
    ui.closePlugin();const saved=editorSnapshot({nodes:[],blacklist:['private'],include_system:true},'saved');
    await ui.finishClose();
    await ui.respond(1,200,{plugin:saved.plugins[0]});await ui.respond(2,200,saved);
    await ui.finishClose();
    assert.equal(ui.get('plugin-settings-dialog').open,false);
    ui.selectPlugin('relay');ui.inputConfig('relay','nodes','a');ui.submitConfig('relay');
    ui.get('logout').listeners.click();assert.equal(ui.requests[3].options.signal.aborted,true);
    await ui.respond(3,200,{plugin:saved.plugins[0]});assert.equal(ui.get('workspace').hidden,true);
    ui.submit('replacement');await ui.respond(4,200,editorSnapshot());ui.selectPlugin('relay');
    assert.doesNotMatch(ui.get('plugin-dialog-content').innerHTML,/private/);
    ui.submitConfig('relay');await ui.respond(5,401,{error:'invalid'});assert.equal(ui.get('workspace').hidden,true);
});

test('stale editor snapshots disable saving without discarding typed values',async()=>{
    const ui=app('dashboard');await ui.respond(0,200,editorSnapshot());ui.selectPlugin('relay');ui.inputConfig('relay','blacklist','draft');
    ui.intervals[0]();await ui.respond(1,500);ui.submitConfig('relay');assert.equal(ui.requests.length,2);
    assert.match(ui.get('plugin-dialog-content').innerHTML,/暂不可保存/);assert.match(ui.get('plugin-dialog-content').innerHTML,/draft/);
});

test('plugin list uses server registration metadata rather than a hardcoded installed list',async()=>{
    const ui=app('dashboard');
    const d={...controllableSnapshot(),plugins:[registryManifest('onebot',{name:'机器人接入 <server>',module:'OneBotAdapter',kind:'adapter',settingsPanel:'onebot',settingsMode:'managed',enabled:true})]};
    await ui.respond(0,200,d);ui.navigate('plugins');
    const html=ui.get('view-content').innerHTML;
    assert.equal((html.match(/class="plugin-row"/g)||[]).length,1);
    assert.match(html,/机器人接入 &lt;server&gt;/);
    assert.match(html,/v1\.2\.3/);
    assert.doesNotMatch(html,/data-plugin-row="relay"/);
    ui.selectPlugin('onebot');
    assert.match(ui.get('plugin-dialog-content').innerHTML,/服务器配置说明/);
    assert.match(ui.get('plugin-dialog-content').innerHTML,/onebot-client-form/);
});

test('new registered plugins get generic safe settings and state controls without adding a frontend presenter',async()=>{
    const ui=app('dashboard');
    const d={...controllableSnapshot(),pluginStates:{'chat-logger':false},plugins:[registryManifest('chat-logger',
        {configuration:{section:'plugins.chat-logger',values:{label:'<unsafe>',retention:30}}})]};
    await ui.respond(0,200,d);ui.navigate('plugins');ui.selectPlugin('chat-logger');
    let html=ui.get('plugin-dialog-content').innerHTML;
    assert.match(html,/plugins.chat-logger/);assert.match(html,/&lt;unsafe&gt;/);assert.doesNotMatch(html,/<unsafe>/);
    assert.match(html,/仅展示公开配置/);
    ui.togglePlugin('chat-logger');
    assert.equal(ui.requests[1].url,'/api/plugins/chat-logger/state');
    await ui.respond(1,200,{plugin:{id:'chat-logger',enabled:true}});
    assert.match(ui.get('plugin-dialog-content').innerHTML,/aria-checked="true"/);
    await ui.respond(2,200,{...d,pluginStates:{'chat-logger':true},plugins:[{...d.plugins[0],enabled:true}]});
});

test('an empty server registry stays empty instead of inventing built-in plugins',async()=>{
    const ui=app('dashboard');await ui.respond(0,200,{...controllableSnapshot(),plugins:[]});
    assert.doesNotMatch(ui.get('view-content').innerHTML,/data-plugin-card="relay"/);
    ui.navigate('plugins');
    assert.doesNotMatch(ui.get('view-content').innerHTML,/data-plugin-row=/);
    ui.selectPlugin('onebot');assert.equal(ui.get('plugin-settings-dialog').open,false);
});

test('plugin switches send explicit authenticated state, prevent duplicate operations and update only after success',async()=>{
    const ui=app('dashboard');await ui.respond(0,200,controllableSnapshot());ui.navigate('plugins');
    let html=ui.get('view-content').innerHTML;
    assert.match(html,/id="plugin-toggle-relay-list"[^]*?aria-checked="false"/);
    ui.togglePlugin('relay');
    assert.equal(ui.requests[1].url,'/api/plugins/relay/state');
    assert.equal(ui.requests[1].options.method,'PUT');
    assert.equal(ui.requests[1].options.headers.Authorization,'Bearer dashboard');
    assert.deepEqual(JSON.parse(ui.requests[1].options.body),{enabled:true});
    html=ui.get('view-content').innerHTML;
    assert.match(html,/处理中…/);
    assert.match(html,/id="plugin-toggle-relay-list"[^]*?aria-checked="false"/);
    ui.togglePlugin('relay');ui.togglePlugin('onebot');ui.intervals[0]();
    assert.equal(ui.requests.length,2);
    await ui.respond(1,200,{plugin:{id:'relay',enabled:true}});
    assert.match(ui.get('view-content').innerHTML,/id="plugin-toggle-relay-list"[^]*?aria-checked="true"/);
    await ui.respond(2,200,controllableSnapshot(true));
    ui.togglePlugin('relay');assert.deepEqual(JSON.parse(ui.requests[3].options.body),{enabled:false});
    await ui.respond(3,500,{error:'无法保存插件开关'});
    assert.match(ui.get('view-content').innerHTML,/无法保存插件开关/);
    assert.match(ui.get('view-content').innerHTML,/id="plugin-toggle-relay-list"[^]*?aria-checked="true"/);
    await ui.respond(4,200,controllableSnapshot(true));
});

test('switches are unavailable on old/stale snapshots; disabling OneBot requires confirmation',async()=>{
    const old=app('dashboard');await old.respond(0,200,adapterSnapshot());old.navigate('plugins');
    old.togglePlugin('relay');assert.equal(old.requests.length,1);
    assert.match(old.get('view-content').innerHTML,/请升级并重启服务端/);
    const stale=app('dashboard');await stale.respond(0,200,controllableSnapshot());
    stale.intervals[0]();await stale.respond(1,500);stale.togglePlugin('relay');assert.equal(stale.requests.length,2);
    const declined=app('dashboard',{confirm:false});await declined.respond(0,200,controllableSnapshot());
    declined.togglePlugin('onebot');assert.equal(declined.requests.length,1);
});

test('OneBot switch displays stopped clients, works inside the settings dialog and keeps the dialog open',async()=>{
    const ui=app('dashboard');await ui.respond(0,200,controllableSnapshot());ui.navigate('plugins');ui.selectPlugin('onebot');
    ui.togglePlugin('onebot');
    assert.deepEqual(JSON.parse(ui.requests[1].options.body),{enabled:false});
    await ui.respond(1,200,{plugin:{id:'onebot',enabled:false}});
    const stopped={...controllableSnapshot(),pluginStates:{onebot:false,relay:false},onebotAdapters:{clients:[{...adapterEntry,status:'stopped'}]}};
    await ui.respond(2,200,stopped);
    const html=ui.get('plugin-dialog-content').innerHTML;
    assert.equal(ui.get('plugin-settings-dialog').open,true);
    assert.match(html,/id="plugin-toggle-onebot-dialog"/);
    assert.match(html,/已关闭/);
    assert.match(html,/开启插件后再连接/);
    assert.match(html,/已停止/);
    ui.togglePlugin('onebot');assert.deepEqual(JSON.parse(ui.requests[3].options.body),{enabled:true});
    await ui.respond(3,200,{plugin:{id:'onebot',enabled:true}});await ui.respond(4,200,controllableSnapshot());
});

test('logout cancels switch requests and ignores late results; switch authentication failures return to login',async()=>{
    const ui=app('dashboard');await ui.respond(0,200,controllableSnapshot());ui.togglePlugin('relay');
    ui.get('logout').listeners.click();assert.equal(ui.requests[1].options.signal.aborted,true);
    await ui.respond(1,200,{plugin:{id:'relay',enabled:true}});
    assert.equal(ui.get('workspace').hidden,true);assert.equal(ui.requests.length,2);
    ui.submit('replacement');await ui.respond(2,200,controllableSnapshot());ui.togglePlugin('relay');
    await ui.respond(3,401,{error:'invalid token'});
    assert.equal(ui.get('workspace').hidden,true);assert.equal(ui.get('plugin-settings-dialog').open,false);
    assert.match(ui.get('auth-error').textContent,/失效/);
});

test('all plugins use unified list rows and settings stay hidden until their button opens a dialog', async () => {
    const ui=app('dashboard');await ui.respond(0,200,adapterSnapshot());ui.navigate('plugins');
    let content=ui.get('view-content').innerHTML;
    for(const className of ['plugin-row','plugin-identity','plugin-row-main','plugin-row-type','plugin-row-status']) {
        assert.equal((content.match(new RegExp(`class="${className}"`,'g'))||[]).length,2,className);
    }
    assert.match(content,/data-plugin-row="onebot"/);
    assert.match(content,/data-plugin-row="relay"/);
    assert.match(content,/aria-haspopup="dialog" aria-controls="plugin-settings-dialog"/);
    assert.doesNotMatch(content,/onebot-client-form/);
    assert.doesNotMatch(content,/relay:\n/);
    assert.equal(ui.get('plugin-settings-dialog').open,false);
    ui.selectPlugin('onebot');
    assert.equal(ui.get('plugin-settings-dialog').open,true);
    assert.match(ui.get('plugin-dialog-content').innerHTML,/onebot-client-form/);
    ui.closePlugin();
    await ui.finishClose();
    assert.equal(ui.get('plugin-settings-dialog').open,false);
    assert.equal(ui.document.activeElement.id,'plugin-open-onebot');
    ui.selectPlugin('relay');content=ui.get('plugin-dialog-content').innerHTML;
    assert.match(content,/id="plugin-settings-title">跨服消息转发/);
    assert.match(content,/relay:\n/);
    assert.doesNotMatch(content,/onebot-client-form/);
    assert.equal(ui.document.activeElement.id,'plugin-dialog-close');
    assert.equal(ui.cancelPlugin(),true);
    await ui.finishClose();
    assert.equal(ui.get('plugin-settings-dialog').open,false);
    assert.equal(ui.document.activeElement.id,'plugin-open-relay');
    const before=ui.get('view-content').innerHTML;ui.selectPlugin('unknown');
    assert.equal(ui.get('view-content').innerHTML,before);
    assert.equal(ui.get('plugin-settings-dialog').open,false);
});

test('settings dialog survives polling without reopening; stale data is marked and logout closes it', async () => {
    const ui=app('dashboard');await ui.respond(0,200,adapterSnapshot());ui.selectPlugin('relay');
    const dialog=ui.get('plugin-settings-dialog');
    ui.get('plugin-dialog-scroll').scrollTop=200;
    ui.intervals[0]();
    const d=adapterSnapshot([{...adapterEntry,status:'connected'}]);
    d.relay.enabled=true;
    await ui.respond(1,200,d);
    let content=ui.get('view-content').innerHTML;
    assert.equal(dialog.open,true);
    assert.equal(dialog.showModalCount,1);
    assert.equal(ui.get('plugin-dialog-scroll').scrollTop,200);
    assert.match(ui.get('plugin-dialog-content').innerHTML,/id="plugin-settings-title">跨服消息转发/);
    ui.intervals[0]();await ui.respond(2,500);
    content=ui.get('plugin-dialog-content').innerHTML;
    assert.match(content,/快照过期/);
    assert.match(content,/暂不可保存/);
    assert.match(content,/id="plugin-settings-title">跨服消息转发/);
    ui.get('logout').listeners.click();ui.submit('dashboard');await ui.respond(3,200,adapterSnapshot());ui.navigate('plugins');
    assert.equal(dialog.open,false);
    assert.equal(ui.get('plugin-dialog-content').innerHTML,'');
    assert.doesNotMatch(ui.get('view-content').innerHTML,/onebot-client-form/);
});

test('overview has no plugin cards; plugin configuration remains on the plugins page', async () => {
    const ui=app('dashboard');await ui.respond(0,200,adapterSnapshot());
    const content=ui.get('view-content').innerHTML;
    assert.doesNotMatch(content,/plugin-card|plugin-open-relay-overview|stats-grid|log-panel|message-list/);
    ui.navigate('plugins');
    ui.selectPlugin('relay');
    assert.equal(ui.document.title,'平台插件 · ChatHub');
    assert.match(ui.get('plugin-dialog-content').innerHTML,/id="plugin-settings-title">跨服消息转发/);
});

test('copy feedback is shown inside the modal top layer and cleared when closing', async () => {
    const ui=app('dashboard');await ui.respond(0,200,adapterSnapshot());ui.selectPlugin('relay');
    await ui.copyConfig('relay:\n  enabled: true');
    assert.deepEqual(ui.clipboard,['relay:\n  enabled: true']);
    assert.equal(ui.get('plugin-dialog-toast').hidden,false);
    assert.equal(ui.get('plugin-dialog-toast').textContent,'配置已复制');
    assert.equal(ui.get('toast').hidden,true);
    ui.closePlugin();
    await ui.finishClose();
    assert.equal(ui.get('plugin-dialog-toast').hidden,true);
});

test('closing and switching settings dialogs clears tokens but preserves other OneBot drafts', async () => {
    const ui=app('dashboard');await ui.respond(0,200,adapterSnapshot());ui.navigate('plugins');ui.selectPlugin('onebot');
    ui.inputAdapter('adapter-address','ws://localhost:3001/');ui.inputAdapter('adapter-name','<draft>');ui.inputAdapter('adapter-token','sensitive-token');
    ui.selectPlugin('relay');ui.selectPlugin('onebot');
    let content=ui.get('plugin-dialog-content').innerHTML;
    assert.match(content,/value="ws:\/\/localhost:3001\/"/);
    assert.match(content,/value="&lt;draft&gt;"/);
    assert.doesNotMatch(content,/sensitive-token/);
    ui.intervals[0]();await ui.respond(1,200,adapterSnapshot([{...adapterEntry,status:'retrying'}]));
    content=ui.get('plugin-dialog-content').innerHTML;
    assert.match(content,/等待重连/);
    assert.match(content,/value="&lt;draft&gt;"/);
    ui.clickTheme('theme-toggle');
    assert.equal(ui.document.documentElement.dataset.theme,'dark');
    assert.match(ui.get('view-content').innerHTML,/plugin-row/);
});

test('OneBot plugin form preserves drafts across polling, adds/removes clients, and never stores the bot token', async () => {
    const ui=app('dashboard');await ui.respond(0,200,adapterSnapshot());ui.navigate('plugins');ui.selectPlugin('onebot');
    assert.match(ui.get('plugin-dialog-content').innerHTML,/onebot-client-form/);
    ui.inputAdapter('adapter-address','ws://localhost:3001/');ui.inputAdapter('adapter-group','555');
    ui.inputAdapter('adapter-name','<QQ Group>');ui.inputAdapter('adapter-token','private-bot-token');
    ui.intervals[0]();await ui.respond(1,200,adapterSnapshot());
    assert.match(ui.get('plugin-dialog-content').innerHTML,/value="private-bot-token"/);
    assert.match(ui.get('plugin-dialog-content').innerHTML,/&lt;QQ Group&gt;/);
    ui.submitAdapter();
    const request=ui.requests[2];
    assert.equal(request.url,'/api/plugins/onebot/clients');assert.equal(request.options.method,'POST');
    assert.equal(request.options.headers.Authorization,'Bearer dashboard');
    assert.equal(JSON.parse(request.options.body).access_token,'private-bot-token');
    assert.equal([...ui.storage.values()].includes('private-bot-token'),false);
    await ui.respond(2,201,{client:adapterEntry});
    assert.doesNotMatch(ui.get('plugin-dialog-content').innerHTML,/private-bot-token/);
    assert.match(ui.get('plugin-dialog-content').innerHTML,/已保存客户端，正在连接/);
    await ui.respond(3,200,adapterSnapshot([adapterEntry]));
    ui.removeAdapter(adapterEntry.id);
    assert.equal(ui.requests[4].options.method,'DELETE');
    await ui.respond(4,200,{ok:true});await ui.respond(5,200,adapterSnapshot());
    assert.doesNotMatch(ui.get('plugin-dialog-content').innerHTML,/data-remove-adapter=/);
    assert.match(ui.get('plugin-dialog-content').innerHTML,/客户端已移除/);
});

test('closing a dialog during a save does not reopen it on a late result or keep the unsent token', async () => {
    const ui=app('dashboard');await ui.respond(0,200,adapterSnapshot());ui.navigate('plugins');ui.selectPlugin('onebot');
    ui.inputAdapter('adapter-address','ws://localhost:3001/');ui.inputAdapter('adapter-group','555');ui.inputAdapter('adapter-token','secret');
    ui.submitAdapter();ui.closePlugin();
    await ui.finishClose();
    assert.equal(ui.get('plugin-settings-dialog').open,false);
    await ui.respond(1,201,{client:adapterEntry});await ui.respond(2,200,adapterSnapshot([adapterEntry]));
    assert.equal(ui.get('plugin-settings-dialog').open,false);
    assert.equal(ui.get('plugin-dialog-content').innerHTML,'');
    ui.selectPlugin('onebot');
    assert.doesNotMatch(ui.get('plugin-dialog-content').innerHTML,/value="secret"/);
    assert.match(ui.get('plugin-dialog-content').innerHTML,/QQ 群/);
});

test('adapter writes are blocked for stale/old servers and failed creation preserves drafts', async () => {
    const ui=app('dashboard');await ui.respond(0);ui.navigate('plugins');ui.selectPlugin('onebot');
    assert.match(ui.get('plugin-dialog-content').innerHTML,/请重启升级后的/);
    ui.intervals[0]();await ui.respond(1,200,adapterSnapshot());
    ui.inputAdapter('adapter-address','ws://localhost:3001/');ui.inputAdapter('adapter-group','555');
    ui.submitAdapter();await ui.respond(2,409,{error:'该客户端已经配置。'});
    assert.match(ui.get('plugin-dialog-content').innerHTML,/该客户端已经配置/);
    assert.match(ui.get('plugin-dialog-content').innerHTML,/value="ws:\/\/localhost:3001\/"/);
    ui.intervals[0]();await ui.respond(3,500);
    ui.submitAdapter();assert.equal(ui.requests.length,4);
});

test('logout cancels late adapter writes and clears drafts; write-side 401 returns to login', async () => {
    const ui=app('dashboard');await ui.respond(0,200,adapterSnapshot());ui.navigate('plugins');ui.selectPlugin('onebot');
    ui.inputAdapter('adapter-address','ws://localhost:3001/');ui.inputAdapter('adapter-group','555');
    ui.inputAdapter('adapter-token','secret');ui.submitAdapter();ui.get('logout').listeners.click();
    assert.equal(ui.requests[1].options.signal.aborted,true);
    await ui.respond(1,201,{client:adapterEntry});
    assert.equal(ui.get('workspace').hidden,true);assert.equal(ui.get('view-content').innerHTML,'');
    ui.submit('new-dashboard');await ui.respond(2,200,adapterSnapshot());ui.navigate('plugins');ui.selectPlugin('onebot');
    assert.doesNotMatch(ui.get('plugin-dialog-content').innerHTML,/value="secret"/);
    ui.submitAdapter();await ui.respond(3,401,{error:'Invalid token'});
    assert.equal(ui.get('workspace').hidden,true);assert.equal(ui.storage.has('chathub.dashboard.token'),false);
    assert.equal(ui.get('plugin-settings-dialog').open,false);
    assert.match(ui.get('auth-error').textContent,/失效/);
});

const failureLogs = () => [
    {id:2,time:1728000001,level:'error',type:'delivery_failed',origin:'plugin',groupId:10001,
        groupName:'<创造服>',nodeId:'creative',messageId:321,sourceMessageId:123,error:'<img src=x onerror=alert(1)>'},
    {id:1,time:1728000000,level:'error',type:'delivery_failed',origin:'application',groupId:10000,
        groupName:'生存服',nodeId:'survival',messageId:320,error:'MCDR delivery acknowledgement timed out'},
];
const logSnapshot = () => ({...snapshot(),logs:failureLogs()});

test('log view renders escaped failures, detached clients and source/delivery IDs; overview omits logs', async () => {
    const ui=app('dashboard');await ui.respond(0,200,logSnapshot());
    assert.doesNotMatch(ui.get('view-content').innerHTML,/最近发送失败|data-view="logs"/);
    assert.equal(ui.get('log-count').textContent,'2');
    ui.navigate('logs');
    const html=ui.get('view-content').innerHTML;
    assert.equal(ui.document.title,'日志 · ChatHub');
    assert.match(html,/发送失败日志/);
    assert.match(html,/&lt;创造服&gt;/);
    assert.match(html,/&lt;img src=x onerror=alert\(1\)&gt;/);
    assert.doesNotMatch(html,/<img src=x/);
    assert.match(html,/目标群 #10001 · 客户端 creative · 投递 ID 321 · 来源消息 #123/);
    assert.match(html,/<option value="10001">&lt;创造服&gt; · #10001<\/option>/);
    assert.match(html,/最近 200 次发送失败/);
});

test('logs support origin, target and text filters, preserve filters across refresh and clear them on logout', async () => {
    const ui=app('dashboard');await ui.respond(0,200,logSnapshot());ui.navigate('logs');
    ui.logOrigin('application');
    assert.match(ui.get('view-content').innerHTML,/class="panel-count">1 \/ 2/);
    assert.doesNotMatch(ui.get('view-content').innerHTML,/class="log-error">&lt;img/);
    ui.logOrigin('all');ui.logGroup('10001');
    assert.match(ui.get('view-content').innerHTML,/class="panel-count">1 \/ 2/);
    assert.doesNotMatch(ui.get('view-content').innerHTML,/class="log-error">MCDR/);
    ui.inputField('log-search','CREATIVE');
    assert.match(ui.get('view-content').innerHTML,/class="panel-count">1 \/ 2/);
    ui.intervals[0]();await ui.respond(1,200,logSnapshot());
    assert.match(ui.get('view-content').innerHTML,/value="CREATIVE"/);
    assert.match(ui.get('view-content').innerHTML,/<option value="10001" selected/);
    ui.inputField('log-search','not found');
    assert.match(ui.get('view-content').innerHTML,/没有匹配的日志/);
    ui.get('logout').listeners.click();
    assert.equal(ui.get('log-count').textContent,'0');
    assert.equal(ui.get('view-content').innerHTML,'');
    ui.submit('dashboard');await ui.respond(2,200,logSnapshot());ui.navigate('logs');
    assert.match(ui.get('view-content').innerHTML,/class="panel-count">2 \/ 2/);
    assert.match(ui.get('view-content').innerHTML,/id="log-search"[^>]+value=""/);
});

test('log view handles empty/older snapshots, automatically refreshes and marks stale logs', async () => {
    const ui=app('dashboard');await ui.respond(0);ui.navigate('logs');
    assert.match(ui.get('view-content').innerHTML,/暂无发送失败/);
    assert.equal(ui.get('log-count').textContent,'0');
    ui.intervals[0]();await ui.respond(1,200,logSnapshot());
    assert.match(ui.get('view-content').innerHTML,/MCDR delivery acknowledgement timed out/);
    assert.equal(ui.get('log-count').textContent,'2');
    ui.intervals[0]();await ui.respond(2,500);
    assert.match(ui.get('view-content').innerHTML,/过期快照/);
    assert.match(ui.get('view-content').innerHTML,/MCDR delivery acknowledgement timed out/);
    ui.intervals[0]();await ui.respond(3,401);
    assert.equal(ui.get('workspace').hidden,true);
    assert.equal(ui.get('view-content').innerHTML,'');
    assert.equal(ui.get('log-count').textContent,'0');
});

const settingsSnapshot = (public_url='',revision='initial') => ({...snapshot(),settings:{public_url,revision}});

test('platform settings are concise and debounce autosave with saving/saved states, independent of images',async()=>{
    const ui=app('dashboard',{initialPath:'/settings'});await ui.respond(0,200,settingsSnapshot());
    assert.equal(ui.document.title,'平台设置 · ChatHub');
    assert.equal(ui.get('main').classList.contains('settings-only'),true);
    assert.match(ui.get('view-content').innerHTML,/platform-settings-form/);
    assert.doesNotMatch(ui.get('view-content').innerHTML,/<button|ChatImage|base64|图片|MiB|缓存|settings-url-help/);
    assert.match(ui.get('view-content').innerHTML,/平台公网地址/);
    assert.equal(ui.get('settings-save-state').innerHTML,'自动保存');
    assert.equal(ui.requests.length,1);ui.flushSettings();assert.equal(ui.requests.length,1);
    ui.inputField('settings-public-url','https://first.example.org');
    ui.inputField('settings-public-url','https://platform.example.org');
    assert.equal(ui.settingsTimers.size,1);assert.equal(ui.requests.length,1);
    ui.intervals[0]();await ui.respond(1,200,settingsSnapshot());
    assert.equal(ui.get('settings-public-url').value,'https://platform.example.org');
    ui.flushSettings();
    const request=ui.requests[2];
    assert.equal(request.url,'/api/settings');assert.equal(request.options.method,'PUT');
    assert.equal(request.options.headers.Authorization,'Bearer dashboard');
    assert.deepEqual(JSON.parse(request.options.body),{public_url:'https://platform.example.org',revision:'initial'});
    assert.equal(ui.get('settings-save-state').dataset.state,'saving');
    assert.match(ui.get('settings-save-state').innerHTML,/settings-save-spinner/);
    assert.equal(ui.get('settings-public-url').disabled,false);
    ui.intervals[0]();assert.equal(ui.requests.length,3); // No competing poll during save.
    await ui.respond(2,200,{settings:{public_url:'https://platform.example.org',revision:'saved'}});
    assert.equal(ui.get('settings-save-state').dataset.state,'saved');
    assert.match(ui.get('settings-save-state').innerHTML,/已保存/);
    ui.intervals[0]();await ui.respond(3,200,settingsSnapshot('https://platform.example.org','saved'));
    assert.equal(ui.get('settings-save-state').dataset.state,'saved');
    assert.equal(ui.get('settings-public-url').value,'https://platform.example.org');
    ui.blurSettings();assert.equal(ui.requests.length,4); // Unchanged blur is not another write.
});

test('editing during autosave keeps the latest draft and serializes writes with the updated revision',async()=>{
    const ui=app('dashboard');await ui.respond(0,200,settingsSnapshot());ui.navigate('settings');
    ui.inputField('settings-public-url','https://first.example.org');ui.flushSettings();
    ui.inputField('settings-public-url','https://latest.example.org');ui.flushSettings();
    assert.equal(ui.requests.length,2); // Do not run concurrent writes.
    await ui.respond(1,200,{settings:{public_url:'https://first.example.org',revision:'first'}});
    assert.equal(ui.get('settings-public-url').value,'https://latest.example.org');
    assert.equal(ui.get('settings-save-state').dataset.state,'pending');
    ui.flushSettings();
    assert.deepEqual(JSON.parse(ui.requests[2].options.body),{public_url:'https://latest.example.org',revision:'first'});
    ui.navigate('nodes');await ui.respond(2,200,{settings:{public_url:'https://latest.example.org',revision:'latest'}});
    assert.equal(ui.location.pathname,'/nodes');
    ui.navigate('settings');assert.equal(ui.get('settings-public-url').value,'https://latest.example.org');
    assert.equal(ui.get('settings-save-state').dataset.state,'saved');
});

test('autosave errors preserve drafts and retry only after editing; conflicts never overwrite another administrator',async()=>{
    const ui=app('dashboard');await ui.respond(0,200,settingsSnapshot());ui.navigate('settings');
    ui.inputField('settings-public-url','<invalid>');ui.flushSettings();
    await ui.respond(1,400,{error:'公网地址无效。'});
    assert.equal(ui.get('settings-error').textContent,'公网地址无效。');
    assert.equal(ui.get('settings-public-url').attributes['aria-invalid'],'true');
    ui.navigate('nodes');ui.navigate('settings');
    assert.match(ui.get('view-content').innerHTML,/value="&lt;invalid&gt;"/);
    ui.intervals[0]();await ui.respond(2,200,settingsSnapshot());ui.flushSettings();
    assert.equal(ui.requests.length,3);
    ui.inputField('settings-public-url','https://mine.example.org');ui.flushSettings();
    await ui.respond(3,409,{settings:{public_url:'https://other.example.org',revision:'other'}});
    assert.equal(ui.get('settings-public-url').value,'https://mine.example.org');
    assert.match(ui.get('settings-error').textContent,/其他管理员更新.*刷新/);
    assert.equal(ui.get('settings-save-state').dataset.state,'error');
    ui.inputField('settings-public-url','https://again.example.org');ui.flushSettings();ui.blurSettings();
    assert.equal(ui.requests.length,4);
});

test('autosave handles older servers, waits for connection recovery and clears expired credentials',async()=>{
    const ui=app('dashboard');await ui.respond(0);ui.navigate('settings');
    assert.match(ui.get('view-content').innerHTML,/暂不可用/);
    ui.inputField('settings-public-url','https://platform.example.org');ui.flushSettings();assert.equal(ui.requests.length,1);
    ui.intervals[0]();await ui.respond(1,200,settingsSnapshot());
    assert.match(ui.get('view-content').innerHTML,/platform-settings-form/);
    ui.inputField('settings-public-url','https://platform.example.org');
    ui.intervals[0]();await ui.respond(2,500);
    ui.flushSettings();assert.equal(ui.requests.length,3);
    assert.equal(ui.get('settings-public-url').disabled,true);
    ui.intervals[0]();await ui.respond(3,200,settingsSnapshot());
    ui.flushSettings();await ui.respond(4,401,{error:'Invalid token'});
    assert.equal(ui.get('workspace').hidden,true);assert.match(ui.get('auth-error').textContent,/失效/);
});

test('autosave respects IME composition, flushes on blur and cancels pending/active work on logout',async()=>{
    const ui=app('dashboard');await ui.respond(0,200,settingsSnapshot());ui.navigate('settings');
    ui.composeSettings('compositionstart');ui.inputField('settings-public-url','https://platform.example.org');
    ui.flushSettings();ui.blurSettings();assert.equal(ui.requests.length,1);
    ui.composeSettings('compositionend');assert.equal(ui.settingsTimers.size,1);
    ui.blurSettings();assert.equal(ui.settingsTimers.size,0);assert.equal(ui.requests.length,2);
    ui.get('logout').listeners.click();assert.equal(ui.requests[1].options.signal.aborted,true);
    await ui.respond(1,200,{settings:{public_url:'https://platform.example.org',revision:'late'}});
    assert.equal(ui.get('workspace').hidden,true);assert.equal(ui.get('view-content').innerHTML,'');
    ui.submit('dashboard');await ui.respond(2,200,settingsSnapshot());ui.navigate('settings');
    ui.inputField('settings-public-url','https://pending.example.org');ui.get('logout').listeners.click();
    assert.equal(ui.settingsTimers.size,0);ui.flushSettings();assert.equal(ui.requests.length,3);
});

test('an outdated successful or failed save never marks a newer draft as saved or invalid',async()=>{
    const ui=app('dashboard');await ui.respond(0,200,settingsSnapshot());ui.navigate('settings');
    ui.inputField('settings-public-url','invalid');ui.flushSettings();
    ui.inputField('settings-public-url','https://valid.example.org');
    await ui.respond(1,400,{error:'旧输入无效。'});
    assert.equal(ui.get('settings-error').textContent,'');
    assert.equal(ui.get('settings-save-state').dataset.state,'pending');
    ui.flushSettings();await ui.respond(2,200,{settings:{public_url:'https://valid.example.org',revision:'valid'}});
    ui.inputField('settings-public-url','');ui.flushSettings();
    assert.equal(JSON.parse(ui.requests[3].options.body).public_url,'');
    await ui.respond(3,200,{settings:{public_url:'',revision:'cleared'}});
    assert.equal(ui.get('settings-save-state').dataset.state,'saved');
});
