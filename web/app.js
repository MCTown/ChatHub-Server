/* Dependency-free dashboard. All runtime data is escaped before
 * rendering; message images/links are displayed as text, never loaded. */
(() => {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const icons = {
    grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    server: '<rect x="3" y="3" width="18" height="7" rx="2"/><rect x="3" y="14" width="18" height="7" rx="2"/><path d="M7 6.5h.01M7 17.5h.01M11 6.5h6M11 17.5h6"/>',
    message: '<path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5Z"/><path d="M8 9h8M8 13h5"/>',
    puzzle: '<path d="M8 3h3a2.5 2.5 0 1 1 5 0h4v6a2.5 2.5 0 1 0 0 5v6h-6a2.5 2.5 0 1 1-5 0H3v-6a2.5 2.5 0 1 0 0-5V3h5Z"/>',
    close: '<path d="m6 6 12 12M6 18 18 6"/>',
    settings: '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3" fill="var(--surface)"/><circle cx="15" cy="17" r="3" fill="var(--surface)"/>',
    code: '<path d="m8 6-6 6 6 6m8-12 6 6-6 6m-3-14-2 16"/>',
    layers: '<path d="m12 3 10 5-10 5L2 8l10-5Zm-9 10 9 5 9-5M3 18l9 5 9-5"/>',
    logout: '<path d="M9 4H4v16h5m6-12 4 4-4 4m-6-4h10"/>',
    refresh: '<path d="M20 7v5h-5M4 17v-5h5M6.1 6.1a8 8 0 0 1 13.1 3M17.9 17.9a8 8 0 0 1-13.1-3"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3m.1 4h.01"/>',
    menu: '<path d="M3 6h18M3 12h18M3 18h18"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10h.01"/>',
    alert: '<path d="m12 3 10 18H2L12 3Z"/><path d="M12 9v5m0 3h.01"/>',
    pause: '<path d="M8 5v14M16 5v14"/>',
    play: '<path d="m8 4 12 8-12 8V4Z"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    lock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2"/>',
    users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2m22 0v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/><circle cx="9" cy="7" r="4"/>',
    link: '<path d="M10 13a5 5 0 0 0 7 .1l3-3a5 5 0 0 0-7.1-7.1l-1.7 1.7M14 11a5 5 0 0 0-7-.1l-3 3a5 5 0 0 0 7.1 7.1l1.7-1.7"/>',
    arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
    copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
    activity: '<path d="M2 12h5l3-8 4 16 3-8h5"/>',
    globe: '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/>',
    moon: '<path d="M20.5 15.5A8.5 8.5 0 0 1 8.5 3.5 8.5 8.5 0 1 0 20.5 15.5Z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>',
  };
  const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${Object.hasOwn(icons,name) ? icons[name] : icons.message}</svg>`;
  document.querySelectorAll('[data-icon]').forEach(el => { el.innerHTML = icon(el.dataset.icon); });
  const themeKey = 'chathub.theme';
  const systemTheme = window.matchMedia?.('(prefers-color-scheme: dark)');
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  let themeTransition = null;
  let themeAnimationTimer;
  let themePreference;
  try { themePreference = sessionStorage.getItem(themeKey); } catch { /* storage may be disabled */ }
  if (themePreference !== 'light' && themePreference !== 'dark') themePreference = null;
  let theme = themePreference || (systemTheme?.matches ? 'dark' : 'light');
  function applyTheme() {
    document.documentElement.dataset.theme = theme;
    const label = theme === 'dark' ? '切换到浅色模式' : '切换到深色模式';
    document.querySelectorAll('#theme-toggle, #theme-toggle-login').forEach(button => {
      button.setAttribute('aria-label', label);
      button.setAttribute('title', label);
      button.querySelector('[data-icon]').innerHTML = icon(theme === 'dark' ? 'sun' : 'moon');
      const text = button.querySelector('.theme-toggle-label');
      if (text) text.textContent = theme === 'dark' ? '浅色模式' : '深色模式';
    });
    $('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#000000' : '#2563eb');
  }
  function animateTheme(button) {
    const root = document.documentElement;
    clearTimeout(themeAnimationTimer);
    root.classList.remove('theme-changing');
    if (reducedMotion?.matches) { applyTheme(); return; }
    // Only animate explicit changes, never the initial theme on page load.
    if (document.startViewTransition && button) {
      const rect = button.getBoundingClientRect();
      const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
      const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
      root.style.setProperty('--theme-x', `${x}px`);
      root.style.setProperty('--theme-y', `${y}px`);
      root.style.setProperty('--theme-radius', `${radius}px`);
      root.classList.add('theme-reveal');
      const cleanup = () => {
        root.classList.remove('theme-reveal');
        root.style.removeProperty('--theme-x');
        root.style.removeProperty('--theme-y');
        root.style.removeProperty('--theme-radius');
        themeTransition = null;
      };
      try {
        const transition = document.startViewTransition(applyTheme);
        themeTransition = transition;
        // A hidden tab or a skipped snapshot must not prevent the theme change.
        transition.ready.catch(() => {});
        transition.finished.then(cleanup, cleanup);
        return;
      } catch { cleanup(); }
    }
    // Color transitions are the fallback when View Transitions are unavailable.
    root.classList.add('theme-changing');
    applyTheme();
    themeAnimationTimer = setTimeout(() => root.classList.remove('theme-changing'), 450);
  }
  function toggleTheme(event) {
    if (themeTransition) return;
    themePreference = theme = theme === 'dark' ? 'light' : 'dark';
    try { sessionStorage.setItem(themeKey, theme); } catch { /* keep memory-only preference */ }
    animateTheme(event?.currentTarget);
  }
  systemTheme?.addEventListener('change', event => {
    if (!themePreference) { theme = event.matches ? 'dark' : 'light'; animateTheme(); }
  });
  applyTheme();
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const views = {
    overview: ['平台总览', '所有世界的连接与对话，尽在这里。'],
    nodes: ['客户端与成员', 'Minecraft 节点与 OneBot 群客户端，统一查看连接与成员。'],
    messages: ['消息流', '跨越世界的对话，还有每一个值得记录的瞬间。'],
    chat: ['群聊', '连接每一个虚拟群，在这里开始对话。'],
    logs: ['日志', '消息发送失败时，在这里查看目标客户端与失败原因。'],
    plugins: ['平台插件', '统一查看插件状态、接入能力与配置。'],
    settings: ['平台设置', '管理平台的基础配置。'],
    guide: ['接入指南', '连接 Minecraft 节点与 OneBot 应用，从这里开始。'],
  };
  const routes = {overview:'/',nodes:'/nodes',messages:'/messages',chat:'/chat',logs:'/logs',plugins:'/plugins',settings:'/settings',guide:'/guide'};
  const routeView = () => Object.keys(routes).find(view => routes[view] ===
    (location.pathname.replace(/\/+$/, '') || '/')) || 'overview';
  const entryAnimations = new Map();
  function animateEntry(element, type='page') {
    if (!element || reducedMotion?.matches || !element.animate) return;
    entryAnimations.get(element)?.cancel();
    const frames = type==='dialog'
      ? [{opacity:0,transform:'translateY(14px) scale(.97)'},{opacity:1,transform:'translateY(0) scale(1)'}]
      : [{opacity:0,transform:`translateY(${type==='detail'?8:12}px)`},{opacity:1,transform:'translateY(0)'}];
    const animation = element.animate(frames,{duration:type==='dialog'?240:280,easing:'cubic-bezier(.22, 1, .36, 1)'});
    entryAnimations.set(element,animation);
    const cleanup = () => {if(entryAnimations.get(element)===animation)entryAnimations.delete(element);};
    animation.finished.then(cleanup,cleanup);
  }
  function stopEntryAnimations() {
    for (const animation of entryAnimations.values()) animation.cancel();
    entryAnimations.clear();
  }
  const closingDialogs = new Map();
  function showDialog(dialog) {
    const closing = closingDialogs.get(dialog);
    if (closing) {
      closingDialogs.delete(dialog);
      closing.animation.cancel();
      dialog.classList.remove('dialog-closing');
      dialog.inert=false;
    }
    if (!dialog.open || closing) {
      if (!dialog.open) dialog.showModal();
      animateEntry(dialog,'dialog');
    }
  }
  function closeDialog(dialog, cleanup) {
    const closing = closingDialogs.get(dialog);
    if (closing) {
      if (!state.data) closing.finish();
      return;
    }
    const finish = () => {
      dialog.inert=false;
      if (dialog.open) dialog.close();
      dialog.classList.remove('dialog-closing');
      cleanup();
    };
    if (!dialog.open || !state.data || reducedMotion?.matches || !dialog.animate) {
      entryAnimations.get(dialog)?.cancel();
      finish();return;
    }
    // Preserve the current frame when closing during the entrance animation.
    const current = getComputedStyle(dialog);
    const from = {opacity:current.opacity,transform:current.transform};
    entryAnimations.get(dialog)?.cancel();
    dialog.classList.add('dialog-closing');
    dialog.inert=true;
    const animation = dialog.animate([from,{opacity:0,transform:'translateY(14px) scale(.97)'}],
      {duration:180,easing:'cubic-bezier(.4, 0, 1, 1)',fill:'forwards'});
    const pending = {animation,finish:()=>{
      if (closingDialogs.get(dialog)!==pending) return;
      closingDialogs.delete(dialog);
      finish();animation.cancel();
    }};
    closingDialogs.set(dialog,pending);
    animation.finished.then(pending.finish,pending.finish);
  }
  reducedMotion?.addEventListener?.('change',event=>{
    if (!event.matches) return;
    stopEntryAnimations();
    cancelTopologyAnimation(true);
    for (const closing of closingDialogs.values()) closing.finish();
  });
  let token = '';
  try { token = sessionStorage.getItem('chathub.dashboard.token') || ''; } catch { /* storage may be disabled */ }
  const state = {view:'overview', data:null, paused:false, stale:false, error:'', loading:false,
    messageFilter:'all', messageSearch:'', groupFilter:'all', nodeSearch:'', selectedGroup:null,
    selectedMessage:null, selectedMessageOnebot:false, messageReturnFocus:'',
    selectedTrace:null,
    logSearch:'', logOrigin:'all', logGroupFilter:'all', selectedPlugin:'onebot', pluginDialogOpen:false, pluginReturnFocus:'',
    adapterDraft:{name:'',address:'',group_id:'',access_token:''},adapterBusy:false,adapterError:'',adapterNotice:'',
    pluginBusy:null,pluginError:'',pluginErrorId:'',configBusy:null,configDrafts:Object.create(null),
    settingsDraft:null,settingsBusy:false};
  let controller = null;
  let adapterController = null;
  let pluginController = null;
  let configController = null;
  let onebotController = null;
  let traceController = null;
  let settingsController = null;
  let settingsSaveTimer = null;
  let onebotConnection = null;
  let onebotDialogOpen = false;
  let onebotReturnFocus = '';
  let onebotError = '';
  let nativeConnection = null;
  let nativeRequested = false;
  let generation = 0;
  let toastTimer;
  let chatWorkspace = null;
  const saveToken = value => { token = value; try { value ? sessionStorage.setItem('chathub.dashboard.token', value) : sessionStorage.removeItem('chathub.dashboard.token'); } catch { /* keep memory-only token */ } };
  const emptyData = () => ({version:'2.0.0', stats:{groups:0,onlinePlayers:0,messages:0,onebot:{forward:0,reverse:0}}, groups:[], messages:[],logs:[],relay:{enabled:false,nodes:[],blacklist:[],includeSystem:true},uptimeSeconds:0,memoryBytes:0});
  const data = () => state.data || emptyData();
  const time = seconds => new Date(seconds * 1000).toLocaleTimeString('zh-CN', {hour12:false});
  const duration = seconds => seconds >= 86400 ? `${Math.floor(seconds/86400)} 天 ${Math.floor(seconds%86400/3600)} 小时` : seconds >= 3600 ? `${Math.floor(seconds/3600)} 小时 ${Math.floor(seconds%3600/60)} 分钟` : `${Math.floor(seconds/60)} 分钟`;
  const online = group => group.members.filter(member => member.online);
  const pill = (text, color='green') => `<span class="pill ${color}">${escape(text)}</span>`;
  const panelTitle = (title, right='', subtitle='') => `<div class="panel-header"><div><h2 class="panel-title"><span class="section-marker"></span>${title}</h2>${subtitle ? `<p class="panel-subtitle">${subtitle}</p>` : ''}</div>${right}</div>`;
  const viewLink = (view, label) => `<a class="panel-link" data-view="${view}" href="${routes[view]}">${label} <span>↗</span></a>`;
  const empty = (title, description, name='server') => `<div class="empty-state"><span class="empty-icon">${icon(name)}</span><strong>${title}</strong><p>${description}</p></div>`;
  function toast(message) {
    $('#toast').hidden = true; $('#plugin-dialog-toast').hidden = true; $('#message-dialog-toast').hidden = true; $('#onebot-connection-toast').hidden = true;
    const target = $('#onebot-connection-dialog').open ? $('#onebot-connection-toast') : $('#message-data-dialog').open ? $('#message-dialog-toast') : $('#plugin-settings-dialog').open ? $('#plugin-dialog-toast') : $('#toast');
    target.textContent = message; target.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { target.hidden = true; }, 3200);
  }
  function statCards() {
    const d = data(), known = !!state.data;
    const cards = [
      ['在线客户端',d.stats.groups,'个','server','已连接的 Minecraft 节点与 OneBot 群'],
      ['在线玩家',d.stats.onlinePlayers,'人','users','按虚拟用户 ID 去重'],
      ['缓存消息',d.stats.messages,'条','message','当前进程 · 最多保留 1,000 条'],
      ['OneBot 应用连接',d.stats.onebot.forward+d.stats.onebot.reverse,'路','link',`${d.stats.onebot.forward} 正向 / ${d.stats.onebot.reverse} 反向应用通道`],
    ];
    return `<section class="stats-grid" aria-label="平台统计">${cards.map(([label,value,unit,name,note]) => {
      const gateway = name==='link';
      return `<${gateway?'button':'article'} class="stat-card${gateway?' onebot-stat-button':''}"${gateway?' id="onebot-stat-open" type="button" data-onebot-connection aria-haspopup="dialog" aria-controls="onebot-connection-dialog" title="查看 OneBot 接口接入信息"':''}><div class="stat-header"><span>${label}</span><span class="stat-icon">${icon(name)}</span></div><div class="stat-value">${known?value:'—'}<small>${unit}</small></div><div class="stat-caption"><span class="status-dot${!known?' muted':''}"></span>${known?note:'连接控制台后查看'}</div>${gateway?'<span class="onebot-stat-hint">查看接口配置 ↗</span>':''}</${gateway?'button':'article'}>`;
    }).join('')}</section>`;
  }
  // Keep the camera and node positions outside the polled dashboard snapshot.
  const topologyState = {positions:new Map(),nodes:[],camera:{x:0,y:0,scale:1},initialized:false,
    signature:'',pointers:new Map(),gesture:null,cleanup:null,edges:[],animation:null};
  const topologyScale = value => Math.min(2.5,Math.max(.1,value));
  function topology() {
    return `<section class="topology-workspace" aria-label="连接拓扑">
      <svg id="topology-canvas" class="topology-canvas" tabindex="0" role="group" aria-label="连接拓扑画布" aria-describedby="topology-help"><g id="topology-world"></g></svg>
      <div id="topology-status" class="topology-status" role="status" hidden></div>
      <div class="topology-tools" role="toolbar" aria-label="拓扑画布控制">
        <button type="button" data-topology-action="out" aria-label="缩小" title="缩小">−</button><output id="topology-zoom" aria-label="当前缩放">100%</output><button type="button" data-topology-action="in" aria-label="放大" title="放大">+</button>
        <span class="topology-tool-divider"></span><button type="button" data-topology-action="fit" title="适应所有节点">适应</button><button type="button" data-topology-action="reset" title="重置节点布局与缩放">重置</button>
      </div>
      <p id="topology-help" class="topology-help">拖动节点或空白处 · 滚轮 / 双指缩放</p>
    </section>`;
  }
  function topologyNodes() {
    const d=data(), channels=d.stats.onebot.forward+d.stats.onebot.reverse;
    const upstreams=new Map();
    for (const client of d.onebotAdapters?.clients || []) {
      if (client.status!=='connected') continue;
      // Public adapter snapshots omit tokens. Strip URL credentials/query as an
      // extra safeguard, including when talking to older server versions.
      let address='';
      try {const url=new URL(client.address);address=`${url.protocol}//${url.host}${url.pathname}`;} catch { /* Unknown endpoint. */ }
      const key=`upstream:${JSON.stringify([address,client.botId ?? null])}`;
      if (!upstreams.has(key)) upstreams.set(key,{key,name:'OneBot 上游',kind:'upstream',
        detail:client.botId?`机器人 #${client.botId}`:'机器人已连接',address,groups:[],width:270,height:106});
      const group=`group:${client.platformGroupId}`;
      if (d.groups.some(g=>g.kind==='onebot' && `group:${g.id}`===group) && !upstreams.get(key).groups.includes(group)) upstreams.get(key).groups.push(group);
    }
    return [...d.groups.map(g=>({key:`group:${g.id}`,name:g.name,kind:g.kind==='onebot'?'onebot':'mcdr',
      detail:g.kind==='onebot'?`${g.members.length} 人已观察 · OneBot`:`${online(g).length} 人在线 · MCDR`,width:232,height:86})),
      {key:'hub',name:'ChatHub',kind:'hub',detail:'统一聊天平台',width:196,height:112},
      {key:'gateway',name:'OneBot V11 ↗',kind:'gateway',detail:`${channels} 路应用连接`,width:232,height:86,channels},...upstreams.values(),
      ...(d.onebotApplications || []).map(app=>({key:`application:${app.id}`,name:'OneBot 应用服务',kind:'application',
        detail:`${app.direction==='reverse'?'反向':'正向'} WS · ${app.role}`,address:app.address,width:270,height:106}))];
  }
  function topologyDefaultPosition(node,index,clientCount) {
    if (node.key==='hub') return {x:0,y:0};
    if (node.key==='gateway') return {x:420,y:0};
    if (node.kind==='application') {
      const apps=topologyState.nodes.filter(n=>n.kind==='application'), i=apps.indexOf(node),column=Math.floor(i/6),rows=Math.min(6,apps.length-column*6);
      return {x:800+column*340,y:(i%6-(rows-1)/2)*146};
    }
    if (node.kind==='upstream') {
      const upstreams=topologyState.nodes.filter(n=>n.kind==='upstream'), row=upstreams.indexOf(node);
      return {x:-800-Math.max(0,Math.ceil(clientCount/6)-1)*310,y:(row-(upstreams.length-1)/2)*146};
    }
    const columns=Math.ceil(clientCount/6), column=Math.floor(index/6), rows=Math.min(6,clientCount-column*6);
    return {x:-420-(columns-1-column)*310,y:(index%6-(rows-1)/2)*126};
  }
  function topologyEdge(from,to) {
    const a=topologyState.positions.get(from.key), b=topologyState.positions.get(to.key);
    const direction=b.x>=a.x?1:-1;
    const x1=a.x+direction*from.width/2, x2=b.x-direction*to.width/2;
    const bend=Math.max(70,Math.abs(x2-x1)/2);
    return `M${x1} ${a.y} C${x1+direction*bend} ${a.y},${x2-direction*bend} ${b.y},${x2} ${b.y}`;
  }
  function drawTopology() {
    const {nodes,positions,camera}=topologyState, world=$('#topology-world');
    if (!world) return;
    world.setAttribute('transform',`translate(${camera.x} ${camera.y}) scale(${camera.scale})`);
    nodes.forEach((node,index)=>{
      const position=positions.get(node.key);
      world.querySelector(`[data-topology-node="${index}"]`)?.setAttribute('transform',`translate(${position.x} ${position.y})`);
    });
    topologyState.edges.forEach(edge=>world.querySelector(`#${edge.id}`)?.setAttribute('d',topologyEdge(edge.from,edge.to)));
    $('#topology-zoom').textContent=`${Math.round(camera.scale*100)}%`;
    const canvas=$('#topology-canvas');
    canvas.style.setProperty('--grid-size',`${Math.max(12,24*camera.scale)}px`);
    canvas.style.setProperty('--grid-x',`${camera.x}px`);
    canvas.style.setProperty('--grid-y',`${camera.y}px`);
  }
  function cancelTopologyAnimation(finish=false) {
    const animation=topologyState.animation;
    if (!animation) return;
    cancelAnimationFrame(animation.frame);topologyState.animation=null;
    if (finish) {Object.assign(topologyState.camera,animation.target);drawTopology();}
  }
  function moveTopologyCamera(target,animate=true) {
    cancelTopologyAnimation();
    const {camera}=topologyState;
    if (!animate || reducedMotion?.matches || typeof requestAnimationFrame==='undefined') {
      Object.assign(camera,target);drawTopology();return;
    }
    const animation={from:{...camera},target,start:null,frame:null};
    topologyState.animation=animation;
    const frame=time=>{
      if (topologyState.animation!==animation) return;
      animation.start ??= time;
      const progress=Math.min(1,(time-animation.start)/220),ease=1-(1-progress)**3;
      for (const key of ['x','y','scale']) camera[key]=animation.from[key]+(target[key]-animation.from[key])*ease;
      if (progress===1) {Object.assign(camera,target);topologyState.animation=null;}
      else animation.frame=requestAnimationFrame(frame);
      drawTopology();
    };
    animation.frame=requestAnimationFrame(frame);
  }
  function fitTopology(animate=true) {
    const {nodes,positions}=topologyState, canvas=$('#topology-canvas');
    if (!canvas || !nodes.length) return;
    const {width,height}=canvas.getBoundingClientRect();
    if (!width || !height) return;
    const left=Math.min(...nodes.map(n=>positions.get(n.key).x-n.width/2));
    const right=Math.max(...nodes.map(n=>positions.get(n.key).x+n.width/2));
    const top=Math.min(...nodes.map(n=>positions.get(n.key).y-n.height/2));
    const bottom=Math.max(...nodes.map(n=>positions.get(n.key).y+n.height/2));
    const scale=topologyScale(Math.min(1,(width-80)/(right-left),(height-140)/(bottom-top)));
    topologyState.initialized=true;
    moveTopologyCamera({scale,x:width/2-(left+right)/2*scale,y:height/2-(top+bottom)/2*scale},animate);
  }
  function zoomTopology(scale,x,y) {
    const camera=topologyState.animation?.target || topologyState.camera, next=topologyScale(scale), ratio=next/camera.scale;
    moveTopologyCamera({x:x-(x-camera.x)*ratio,y:y-(y-camera.y)*ratio,scale:next});
  }
  function syncTopology() {
    const status=$('#topology-status');
    status.hidden=!state.stale;
    status.textContent=state.stale?`连接暂时中断，当前拓扑为过期快照。${state.error}`:'';
    // Do not replace SVG targets during a captured drag or pinch gesture.
    if (topologyState.pointers.size) return;
    const nodes=topologyNodes(), signature=JSON.stringify(nodes);
    if (signature!==topologyState.signature) {
      const focusedIndex=document.activeElement?.dataset?.topologyNode;
      const focusedKey=focusedIndex===undefined?null:topologyState.nodes[Number(focusedIndex)]?.key;
      const {positions}=topologyState;
      const keys=new Set(nodes.map(n=>n.key));
      for (const key of positions.keys()) if (!keys.has(key)) positions.delete(key);
      topologyState.nodes=nodes;topologyState.signature=signature;
      const clientCount=nodes.filter(n=>n.key.startsWith('group:')).length;
      nodes.forEach((node,index)=>{if (!positions.has(node.key)) positions.set(node.key,topologyDefaultPosition(node,index,clientCount));});
      const hub=nodes.find(n=>n.key==='hub');
      const gateway=nodes.find(n=>n.key==='gateway');
      topologyState.edges=nodes.flatMap((node,index)=>node===hub?[]:node.kind==='upstream'
        ?node.groups.map((key,i)=>({id:`topology-edge-${index}-${i}`,from:node,to:nodes.find(n=>n.key===key)}))
        :node.kind==='application'?[{id:`topology-edge-${index}`,from:gateway,to:node}]
        :[{id:`topology-edge-${index}`,from:node.key==='gateway'?hub:node,to:node.key==='gateway'?node:hub,inactive:node.key==='gateway'&&!node.channels}]);
      const edges=topologyState.edges.map(edge=>`<path id="${edge.id}" class="topology-edge${edge.inactive?' inactive':''}" d="${topologyEdge(edge.from,edge.to)}"/>`).join('');
      const cards=nodes.map((node,index)=>{
        const {x,y}=positions.get(node.key), core=node===hub, gateway=node.key==='gateway';
        const label=`${node.name}，${node.detail}${node.address?'，'+node.address:''}。可拖动，方向键移动${gateway?'，回车查看接口信息':''}`;
        return `<g ${gateway?'id="onebot-topology-open" data-onebot-connection aria-haspopup="dialog" aria-controls="onebot-connection-dialog"':''} data-topology-node="${index}" class="topology-node${core?' core':''}" transform="translate(${x} ${y})" tabindex="0" role="${gateway?'button':'group'}" aria-label="${escape(label)}">
          <title>${escape(node.name)} · ${escape(node.detail)}${node.address?' · '+escape(node.address):''}</title><rect class="topology-node-surface" x="${-node.width/2}" y="${-node.height/2}" width="${node.width}" height="${node.height}" rx="14"/>
          <rect class="topology-node-icon" x="${-node.width/2+18}" y="-19" width="38" height="38" rx="10"/>
          <svg x="${-node.width/2+26}" y="-11" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${icons[core?'message':gateway||node.kind==='application'?'code':node.kind==='upstream'?'link':node.kind==='onebot'?'message':'server']}</svg>
          <text class="topology-node-name" x="${-node.width/2+68}" y="${node.address?-16:-4}">${escape(!core&&!gateway&&node.name.length>11?node.name.slice(0,10)+'…':node.name)}</text><text class="topology-node-detail" x="${-node.width/2+68}" y="${node.address?5:17}">${escape(node.detail)}</text>
          ${node.address?`<text class="topology-node-detail" x="${-node.width/2+68}" y="26">${escape(node.address.length>23?node.address.slice(0,22)+'…':node.address)}</text>`:''}
          ${!core&&!gateway?`<circle class="topology-node-dot" cx="${node.width/2-17}" cy="${-node.height/2+16}" r="3"/>`:''}
        </g>`;
      }).join('');
      $('#topology-world').innerHTML=edges+cards;
      if (focusedKey) {
        const index=nodes.findIndex(n=>n.key===focusedKey);
        (index<0?$('#topology-canvas'):$('#topology-world').querySelector(`[data-topology-node="${index}"]`))?.focus({preventScroll:true});
      }
    }
    if (!topologyState.initialized) fitTopology(false);else drawTopology();
  }
  function mountTopology() {
    const canvas=$('#topology-canvas');
    if (!canvas) return;
    const {pointers,camera}=topologyState;
    let suppressClick=false;
    const point=event=>{const rect=canvas.getBoundingClientRect();return {x:event.clientX-rect.left,y:event.clientY-rect.top};};
    const startGesture=()=>{
      const points=[...pointers.values()];
      if (points.length>=2) {
        for (const point of points) point.node=undefined;
        const [a,b]=points, x=(a.x+b.x)/2,y=(a.y+b.y)/2;
        topologyState.gesture={type:'pinch',distance:Math.max(1,Math.hypot(b.x-a.x,b.y-a.y)),scale:camera.scale,
          worldX:(x-camera.x)/camera.scale,worldY:(y-camera.y)/camera.scale};
        suppressClick=true;
      } else if (points.length) {
        const p=points[0], node=topologyState.nodes[p.node], position=node&&topologyState.positions.get(node.key);
        topologyState.gesture={type:node?'node':'pan',key:node?.key,start:p,origin:position?{...position}:{x:camera.x,y:camera.y}};
      } else topologyState.gesture=null;
    };
    canvas.addEventListener('pointerdown',event=>{
      if (event.button!==0 || pointers.size>=2) return;
      cancelTopologyAnimation();
      event.preventDefault();
      if (!pointers.size) suppressClick=false;
      const target=event.target.closest('[data-topology-node]');
      (target || canvas).focus({preventScroll:true});
      pointers.set(event.pointerId,{...point(event),node:target?Number(target.dataset.topologyNode):undefined});
      canvas.setPointerCapture(event.pointerId);canvas.classList.add('dragging');startGesture();
    });
    canvas.addEventListener('pointermove',event=>{
      const previous=pointers.get(event.pointerId), gesture=topologyState.gesture;
      if (!previous || !gesture) return;
      const current={...point(event),node:previous.node};pointers.set(event.pointerId,current);
      if (gesture.type==='pinch') {
        const [a,b]=[...pointers.values()], scale=topologyScale(gesture.scale*Math.hypot(b.x-a.x,b.y-a.y)/gesture.distance);
        camera.x=(a.x+b.x)/2-gesture.worldX*scale;camera.y=(a.y+b.y)/2-gesture.worldY*scale;camera.scale=scale;
      } else {
        const dx=current.x-gesture.start.x,dy=current.y-gesture.start.y;
        if (!suppressClick && Math.hypot(dx,dy)<4) return;
        suppressClick=true;
        if (gesture.type==='node') topologyState.positions.set(gesture.key,{x:gesture.origin.x+dx/camera.scale,y:gesture.origin.y+dy/camera.scale});
        else {camera.x=gesture.origin.x+dx;camera.y=gesture.origin.y+dy;}
      }
      drawTopology();
    });
    const endGesture=event=>{
      if (!pointers.delete(event.pointerId)) return;
      if (event.type==='pointercancel') suppressClick=true;
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      startGesture();
      if (!pointers.size) {canvas.classList.remove('dragging');syncTopology();}
    };
    for (const name of ['pointerup','pointercancel','lostpointercapture']) canvas.addEventListener(name,endGesture);
    // Capturing on the canvas retargets pointer clicks: activate the saved node
    // only for a tap, never for a drag, and stop the document-level gateway click.
    canvas.addEventListener('click',event=>{
      if (event.detail===0) return;
      event.stopPropagation();
      if (suppressClick) {event.preventDefault();return;}
      const target=document.activeElement;
      if (target?.id==='onebot-topology-open') openOnebotDialog(target);
    });
    canvas.addEventListener('wheel',event=>{
      event.preventDefault();if (pointers.size) return;
      const p=point(event), delta=event.deltaY*(event.deltaMode===1?16:event.deltaMode===2?canvas.getBoundingClientRect().height:1);
      zoomTopology((topologyState.animation?.target || camera).scale*Math.exp(-Math.max(-200,Math.min(200,delta))*.002),p.x,p.y);
    },{passive:false});
    canvas.addEventListener('keydown',event=>{
      const target=event.target.closest('[data-topology-node]'), node=target&&topologyState.nodes[Number(target.dataset.topologyNode)];
      const directions={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]};
      if (directions[event.key]) {
        cancelTopologyAnimation();
        event.preventDefault();const [dx,dy]=directions[event.key],step=event.shiftKey?60:20;
        if (node) {const p=topologyState.positions.get(node.key);p.x+=dx*step;p.y+=dy*step;}
        else {camera.x+=dx*step;camera.y+=dy*step;}
        drawTopology();
      } else if (['+','=','-','0'].includes(event.key)) {
        event.preventDefault();
        if (event.key==='0') fitTopology();
        else {const rect=canvas.getBoundingClientRect();zoomTopology((topologyState.animation?.target || camera).scale*(event.key==='-'?1/1.2:1.2),rect.width/2,rect.height/2);}
      }
    });
    let size=canvas.getBoundingClientRect();
    const observer=typeof ResizeObserver==='undefined'?null:new ResizeObserver(()=>{
      const next=canvas.getBoundingClientRect();
      cancelTopologyAnimation();
      if (!topologyState.initialized) fitTopology(false);
      else {camera.x+=(next.width-size.width)/2;camera.y+=(next.height-size.height)/2;drawTopology();}
      size=next;
    });
    observer?.observe(canvas);
    topologyState.cleanup=()=>{cancelTopologyAnimation();observer?.disconnect();pointers.clear();topologyState.gesture=null;};
  }
  function onebotUrl() {
    return `${location.protocol==='https:'?'wss:':'ws:'}//${location.host}${onebotConnection?.path || '/onebot/v11'}`;
  }
  function onebotAddresses() {
    const current=onebotUrl(), entries=[], seen=new Set();
    const add=(name,url)=>{
      if (seen.has(url)) return;
      seen.add(url);entries.push({name:url===current?`${name}（当前访问）`:name,url});
    };
    if (onebotConnection?.public_url) add('公网访问地址',onebotConnection.public_url);
    for (const entry of onebotConnection?.direct_urls || []) add('内网访问地址',entry.url);
    if (!seen.has(current)) add('Web 访问地址',current);
    return entries;
  }
  function renderOnebotDialog(onClose=()=>{}) {
    const dialog=$('#onebot-connection-dialog'), content=$('#onebot-connection-content');
    if (!state.data || !onebotDialogOpen) {
      closeDialog(dialog,()=>{content.replaceChildren();$('#onebot-connection-toast').hidden=true;onClose();});
      return;
    }
    const details=onebotConnection;
    const address=(label,url)=>`<div class="onebot-address"><span>${escape(label)}</span><code>${escape(url)}</code><button class="copy-button" type="button" data-copy="${escape(url)}" aria-label="复制${escape(label)}">${icon('copy')}</button></div>`;
    content.innerHTML=`<div class="plugin-dialog-header"><div><span class="plugins-eyebrow">应用网关 · ONEBOT V11</span><h2 id="onebot-connection-title">OneBot 接口接入信息</h2></div><button id="onebot-connection-close" class="plugin-dialog-close" type="button" aria-label="关闭 OneBot 接口信息">${icon('close')}</button></div>
      <div class="plugin-dialog-scroll"><div class="plugin-settings-body">
        <div class="plugin-settings-section"><h3>连接地址</h3>
          ${onebotAddresses().map(entry=>address(entry.name,entry.url)).join('')}
        </div>
        ${details?`<div class="plugin-settings-section"><h3>鉴权与机器人身份</h3>
          <dl class="plugin-settings-values"><div><dt>机器人 self_id</dt><dd>${escape(details.self_id)} · ChatHub（所有虚拟群统一）</dd></div></dl>
          <label class="onebot-token-label" for="onebot-token">Access Token · onebot_token</label><div class="onebot-token-controls"><input id="onebot-token" type="password" readonly autocomplete="off" spellcheck="false" value="${escape(details.access_token)}"><button id="onebot-token-reveal" class="button secondary" type="button" aria-controls="onebot-token" aria-pressed="false">显示</button><button id="onebot-token-copy" class="button secondary" type="button">${icon('copy')}复制</button></div>
        </div>`
          :`<div class="plugin-settings-section"><h3>鉴权与机器人身份</h3><p role="${onebotError?'alert':'status'}" class="${onebotError?'form-error':'plugin-section-description'}">${escape(onebotError || '正在获取当前生效的 Token 和接口配置…')}</p>${onebotError?'<button id="onebot-connection-retry" class="button secondary" type="button">重试</button>':''}</div>`}
      </div></div>`;
    showDialog(dialog);
    $('#onebot-connection-close').focus({preventScroll:true});
  }
  async function openOnebotDialog(trigger) {
    if (!state.data || onebotController) return;
    if (trigger) onebotReturnFocus=trigger.id;
    onebotDialogOpen=true;onebotConnection=null;onebotError='';renderOnebotDialog();
    const requestController=new AbortController();onebotController=requestController;
    const timeout=setTimeout(()=>requestController.abort(),10000);
    try {
      const response=await fetch('/api/onebot/connection',{headers:{Authorization:`Bearer ${token}`},cache:'no-store',signal:requestController.signal});
      if (onebotController!==requestController) return;
      if (response.status===401) {disconnect();$('#auth-error').textContent='管理凭证失效，请重新登录。';return;}
      if (response.status===404) throw new Error('运行中的服务端尚未启用接入详情接口，请更新并重启 ChatHub 服务端后重试。');
      const result=await response.json();
      if (onebotController!==requestController) return;
      if (!response.ok) throw new Error(result.error || `获取接口信息失败（${response.status}）`);
      if (typeof result.access_token!=='string' || !Number.isSafeInteger(result.self_id) || !Array.isArray(result.direct_urls)) throw new Error('服务端返回了无效的接口配置。');
      onebotConnection=result;
    } catch(error) {
      if (onebotController===requestController) onebotError=error.name==='AbortError'?'请求超时，请重试。':error.message;
    } finally {
      clearTimeout(timeout);
      if (onebotController===requestController) {onebotController=null;renderOnebotDialog();}
    }
  }
  function closeOnebotDialog({restoreFocus=true}={}) {
    if (!onebotDialogOpen) return;
    const returnFocus=onebotReturnFocus;
    onebotController?.abort();onebotController=null;onebotConnection=null;onebotError='';onebotDialogOpen=false;onebotReturnFocus='';
    renderOnebotDialog(()=>{
      if (restoreFocus && state.data && !onebotDialogOpen) ($(`#${CSS.escape(returnFocus)}`) || $('#main')).focus({preventScroll:true});
    });
  }
  async function ensureNativeConnection() {
    if (nativeConnection || nativeRequested || !state.data) return;
    nativeRequested = true;
    try {
      const response = await fetch('/api/native/connection',{headers:{Authorization:`Bearer ${token}`},cache:'no-store'});
      if (response.status===401) { disconnect(); $('#auth-error').textContent='管理凭证失效，请重新登录。'; return; }
      const result = await response.json();
      if (response.ok && result && typeof result.access_token==='string') {
        nativeConnection = result;
        if (state.data && state.view==='guide') render();
      }
    } catch { /* keep the placeholder; the guide stays usable without the credential */ }
  }
  // All plugins share metadata, list rendering and the same settings dialog.
  // Only their settings body is plugin-specific.
  function relayConfiguration() {
    const registered = data().plugins?.find(plugin=>plugin.id==='relay');
    if (!registered) return data().relay || emptyData().relay;
    const values = registered.configuration?.values || {};
    return {enabled:registered.enabled,nodes:values.nodes || [],blacklist:values.blacklist || [],includeSystem:values.include_system!==false};
  }
  function pluginCatalog() {
    const relay = relayConfiguration(), clients = data().onebotAdapters?.clients || [];
    const available = !!data().onebotAdapters;
    const connected = clients.filter(client => client.status === 'connected').length;
    const retrying = clients.some(client => client.status === 'retrying');
    const onebotEnabled = (data().plugins?.find(plugin=>plugin.id==='onebot')?.enabled ?? data().pluginStates?.onebot) !== false;
    // Presenters provide plugin-specific live metrics/settings. The installed
    // list and all common metadata come from the server registry, not this list.
    const presenters = [
      {id:'onebot',name:'OneBot 群客户端',module:'OneBotAdapter',kind:'客户端适配器',icon:'message',
        description:'将真实机器人与群聊接入 ChatHub，统一收发消息、自动重连。',
        enabled:onebotEnabled,
        status:!available?'未加载':!onebotEnabled?'已关闭':retrying?'等待重连':connected?'运行中':clients.length?'连接中':'待配置',
        color:!onebotEnabled?'neutral':retrying?'amber':connected?'green':'neutral',
        metrics:[['已配置客户端',`${clients.length} 个`],['已连接客户端',`${connected} 个`]],
        action:'管理客户端',mode:'网页管理',
        help:'关闭插件会断开所有 OneBot 群客户端，保留配置；开启后自动重连。机器人 Token 不在列表回显。',
        render:adapterSettings},
      {id:'relay',name:'跨服消息转发',module:'CrossServerRelay',kind:'业务插件',icon:'arrow',
        description:'在 Minecraft 与 OneBot 客户端间转发消息，支持黑名单与循环保护。',
        enabled:relay.enabled,status:relay.enabled?'已启用':'未启用',color:relay.enabled?'green':'neutral',
        metrics:[['转发范围',relay.nodes.length?`${relay.nodes.length} 个配置客户端`:'所有在线客户端'],
          ['客户端黑名单',relay.blacklist?.length?`${relay.blacklist.length} 个配置客户端`:'未设置']],
        action:'查看配置',mode:'策略只读',
        help:'开关即时生效并保存。转发策略需编辑 server/config.yaml 后重启 ChatHub 生效。',
        render:relaySettings},
    ];
    if (!Array.isArray(data().plugins)) return presenters; // Compatibility with older servers.
    const settingsPanels = {onebot:adapterSettings,relay:relaySettings};
    return data().plugins.map(manifest=>{
      const presenter = presenters.find(plugin=>plugin.id===manifest.id) || {
        status:manifest.enabled?'已启用':'未启用',color:manifest.enabled?'green':'neutral',
        metrics:[['配置节',manifest.configuration?.section || `plugins.${manifest.id}`],['配置版本',String(manifest.schemaVersion)]],
        action:'查看配置',
      };
      return {...presenter,id:manifest.id,name:manifest.name,module:manifest.module,version:manifest.version,
        description:manifest.description,icon:manifest.icon,enabled:manifest.enabled,
        kind:manifest.kind==='adapter'?'客户端适配器':'业务插件',
        mode:manifest.settingsMode==='managed'?'网页管理':'策略只读',help:manifest.help,
        action:manifest.configuration?.editable?'编辑配置':presenter.action,
        render:manifest.configuration?.editable?()=>pluginConfigurationForm(manifest)
          :Object.hasOwn(settingsPanels,manifest.settingsPanel)?settingsPanels[manifest.settingsPanel]:()=>genericPluginSettings(manifest)};
    });
  }
  function genericPluginSettings(manifest) {
    return `<div class="plugin-settings-section"><h3>配置快照</h3><p class="plugin-section-description">${escape(manifest.configuration?.section || `plugins.${manifest.id}`)} · 未提供专用表单，仅展示公开配置。</p>
      <div class="code-box"><pre>${escape(JSON.stringify(manifest.configuration?.values || {},null,2))}</pre></div></div>`;
  }
  function configFormValue(field,value) {
    if (field.type==='boolean') return value===true;
    if (field.type==='string-array') return Array.isArray(value)?value.join('\n'):'';
    return value===undefined || value===null ? '' : String(value);
  }
  function makeConfigDraft(manifest) {
    return {revision:manifest.configuration.revision,schemaVersion:manifest.schemaVersion,
      values:Object.fromEntries(manifest.configuration.fields.map(field=>[field.key,
        configFormValue(field,Object.hasOwn(manifest.configuration.values,field.key)?manifest.configuration.values[field.key]:field.default)])),
      dirty:false,error:'',fieldErrors:{},notice:''};
  }
  function configDraft(manifest) {
    let draft=state.configDrafts[manifest.id];
    if (!draft || (!draft.dirty && state.configBusy!==manifest.id && draft.revision!==manifest.configuration.revision)) {
      draft=state.configDrafts[manifest.id]=makeConfigDraft(manifest);
    }
    return draft;
  }
  function pluginConfigurationForm(manifest) {
    const draft=configDraft(manifest), fields=manifest.configuration.fields;
    const disabled=state.stale || !!state.configBusy || !!state.pluginBusy || state.adapterBusy;
    const conflict=draft.revision!==manifest.configuration.revision || draft.schemaVersion!==manifest.schemaVersion;
    const controls=fields.map(field=>{
      const id=`plugin-config-${manifest.id}-${field.key}`, value=draft.values[field.key];
      const error=draft.fieldErrors[field.key];
      const attributes=`id="${escape(id)}" name="${escape(field.key)}" data-config-plugin="${escape(manifest.id)}" data-config-field="${escape(field.key)}"
        aria-describedby="${escape(id)}-help${error?` ${escape(id)}-error`:''}" aria-invalid="${!!error}" ${disabled?'disabled':''}`;
      const help=`<span id="${escape(id)}-help" class="config-field-help">${escape(field.description || (field.type==='string-array'?'每行一个值；留空表示空列表。':''))}</span>`;
      const feedback=error?`<span id="${escape(id)}-error" class="config-field-error">${escape(error)}</span>`:'';
      if (field.type==='boolean') return `<div class="config-field config-field-boolean"><label for="${escape(id)}"><input type="checkbox" ${attributes} ${value?'checked':''}><span>${escape(field.label)}</span></label>${help}${feedback}</div>`;
      let input;
      if (field.type==='string-array' || field.multiline) input=`<textarea ${attributes} rows="5" placeholder="${escape(field.placeholder || '')}">${escape(value)}</textarea>`;
      else if (field.type==='enum') input=`<select ${attributes}>${value===''?'<option value="">请选择…</option>':''}${(field.options||[]).map(option=>`<option value="${escape(option)}"${value===option?' selected':''}>${escape(option)}</option>`).join('')}</select>`;
      else input=`<input ${attributes} type="${field.type==='number'?'number':'text'}" value="${escape(value)}" placeholder="${escape(field.placeholder || '')}"
        ${field.type==='number'?`step="${field.integer?'1':'any'}" ${field.minimum!==undefined?`min="${field.minimum}"`:''} ${field.maximum!==undefined?`max="${field.maximum}"`:''}`
          :`${field.minLength!==undefined?`minlength="${field.minLength}"`:''} ${field.maxLength!==undefined?`maxlength="${field.maxLength}"`:''}`}>`;
      return `<div class="config-field"><label for="${escape(id)}">${escape(field.label)}</label>${input}${help}${feedback}</div>`;
    }).join('');
    return `<div class="plugin-settings-section"><div class="plugin-section-heading"><h3>编辑插件配置</h3><span class="plugin-source">${escape(manifest.configuration.section)} · Schema v${manifest.schemaVersion}</span></div>
      <p class="plugin-section-description">保存后即时生效，并在重启后恢复。${manifest.configuration.source==='persisted'?'当前使用网页保存的配置。':'当前使用启动配置 / 默认值。'}</p>
      ${conflict?'<div class="config-conflict" role="alert">服务端配置已变更。草稿已保留，请放弃草稿并加载最新配置后重试。</div>':''}
      <form id="plugin-config-form" data-plugin-config="${escape(manifest.id)}" class="plugin-config-form" novalidate aria-busy="${state.configBusy===manifest.id}">
        ${controls}
        <p class="config-form-error" role="alert">${escape(draft.error)}</p><p class="plugin-form-notice" role="status">${escape(draft.notice)}</p>
        <div class="config-form-actions"><button class="button primary" type="submit" ${disabled||conflict?'disabled':''}>${icon('settings')}${state.configBusy===manifest.id?'正在保存…':'保存配置'}</button>
          <button class="button secondary" type="button" data-reset-config="${escape(manifest.id)}" ${state.configBusy?'disabled':''}>${conflict?'加载最新配置':'放弃更改'}</button>
          <button class="panel-link" type="button" data-default-config="${escape(manifest.id)}" ${disabled?'disabled':''}>使用默认值</button></div>
      </form></div>`;
  }
  function updateConfigDraft(target,render=true) {
    const id=target.dataset?.configPlugin, key=target.dataset?.configField;
    const manifest=state.data?.plugins?.find(plugin=>plugin.id===id);
    const field=manifest?.configuration.fields?.find(candidate=>candidate.key===key);
    if (!field || !manifest.configuration.editable || state.configBusy) return false;
    const draft=configDraft(manifest);
    draft.values[key]=field.type==='boolean'?target.checked:target.value;
    draft.dirty=true;draft.error='';draft.notice='';delete draft.fieldErrors[key];
    if (render) renderContent();
    return true;
  }
  function pluginIdentity(plugin, heading='h2') {
    return `<div class="plugin-identity"><span class="plugin-card-icon">${icon(plugin.icon)}</span>
      <div class="plugin-card-name"><${heading}>${escape(plugin.name)}</${heading}><span>${escape(plugin.module)}${plugin.version?` · v${escape(plugin.version)}`:''}</span></div></div>`;
  }
  function pluginCard(plugin, compact=false) {
    return `<article class="panel plugin-card${compact?' plugin-card-compact':''}" data-plugin-card="${plugin.id}">
      <div class="plugin-card-heading">${pluginIdentity(plugin)}${pill(state.stale?'快照过期':plugin.status,state.stale?'amber':plugin.color)}</div>
      <div class="plugin-card-tags"><span>${escape(plugin.kind)}</span><span>内置</span></div>
      <p class="plugin-card-description">${escape(plugin.description)}</p>
      <dl class="plugin-card-metrics">${plugin.metrics.map(([label,value])=>`<div><dt>${escape(label)}</dt><dd>${escape(value)}</dd></div>`).join('')}</dl>
      <div class="plugin-card-footer"><span>${icon(plugin.mode==='网页管理'?'layers':'lock')}${escape(plugin.mode)}</span>
        <button id="plugin-open-${plugin.id}${compact?'-overview':''}" class="plugin-card-action" type="button" data-plugin="${plugin.id}"
          aria-haspopup="dialog" aria-controls="plugin-settings-dialog">${escape(plugin.action)}${icon('arrow')}</button></div>
    </article>`;
  }
  function pluginPanel() {
    const relay = pluginCatalog().find(plugin=>plugin.id==='relay');
    return relay ? pluginCard(relay,true) : '';
  }
  function pluginToggle(plugin, context='list') {
    const supported = typeof data().pluginStates?.[plugin.id] === 'boolean';
    const disabled = !supported || state.stale || !!state.pluginBusy || !!state.configBusy || state.adapterBusy;
    return `<button id="plugin-toggle-${plugin.id}-${context}" class="button ${plugin.enabled?'secondary':'primary'} plugin-toggle" type="button"
      data-toggle-plugin="${plugin.id}" role="switch" aria-checked="${plugin.enabled}" aria-label="${escape(plugin.name)}开关"
      title="${!supported?'请升级并重启服务端以使用插件开关':plugin.enabled?'关闭插件':'开启插件'}" ${disabled?'disabled':''}>
      ${icon(plugin.enabled?'pause':'play')}${state.pluginBusy===plugin.id?'处理中…':plugin.enabled?'关闭':'开启'}</button>`;
  }
  function pluginRow(plugin) {
    return `<article class="plugin-row" data-plugin-row="${plugin.id}">
      <div class="plugin-row-main">${pluginIdentity(plugin,'h3')}<p class="plugin-row-description">${escape(plugin.description)}</p></div>
      <div class="plugin-row-type"><span>${escape(plugin.kind)}</span><small>内置插件 · ${escape(plugin.mode)}</small></div>
      <div class="plugin-row-status">${pill(state.stale?'快照过期':plugin.status,state.stale?'amber':plugin.color)}</div>
      <div class="plugin-row-actions">${pluginToggle(plugin)}<button id="plugin-open-${plugin.id}" class="button secondary plugin-row-action" type="button" data-plugin="${plugin.id}"
        aria-haspopup="dialog" aria-controls="plugin-settings-dialog" aria-label="设置${escape(plugin.name)}">${icon('settings')}设置</button></div>
    </article>`;
  }
  function pluginsPage() {
    const plugins = pluginCatalog();
    return `<div class="plugins-workspace"><div class="plugins-toolbar"><div><span class="plugins-eyebrow">PLUGIN LIBRARY</span>
      <h2>已集成插件 <span>${plugins.length}</span></h2></div><p>点击设置，在窗口中管理插件</p></div>
      ${state.pluginError?`<div class="plugin-toggle-error" role="alert">${escape(state.pluginError)}</div>`:''}
      <section class="panel plugins-list" aria-label="已集成插件"><div class="plugin-list-heading" aria-hidden="true"><span>插件</span><span>类型</span><span>状态</span><span>操作</span></div>
        ${plugins.map(plugin=>pluginRow(plugin)).join('')}</section>
      <p class="plugins-boundary">${icon('puzzle')}平台内置插件统一管理；暂不支持插件市场、任意代码安装或热加载。</p></div>`;
  }
  function renderPluginDialog(onClose=()=>{}) {
    const dialog = $('#plugin-settings-dialog'), content = $('#plugin-dialog-content');
    if (!state.data || !state.pluginDialogOpen) {
      closeDialog(dialog,()=>{content.replaceChildren();$('#plugin-dialog-toast').hidden=true;onClose();});
      return;
    }
    const selected = pluginCatalog().find(plugin=>plugin.id===state.selectedPlugin);
    const scrollTop = $('#plugin-dialog-scroll')?.scrollTop || 0;
    content.innerHTML = `<div class="plugin-dialog-header"><div><span class="plugins-eyebrow">插件设置 · ${escape(selected.module)}</span>
      <h2 id="plugin-settings-title">${escape(selected.name)}</h2></div>
      <div class="plugin-dialog-actions">${pluginToggle(selected,'dialog')}<button id="plugin-dialog-close" class="plugin-dialog-close" type="button" aria-label="关闭插件设置">${icon('close')}</button></div></div>
      <div id="plugin-dialog-scroll" class="plugin-dialog-scroll"><div class="plugin-dialog-summary">${pill(state.stale?'快照过期':selected.status,state.stale?'amber':selected.color)}
        <span>${escape(selected.kind)}</span><span>${escape(selected.mode)}</span></div>
        ${state.stale?'<div class="offline-bar" role="status">连接中断，以下为过期快照，暂不可保存。</div>':''}
        ${state.pluginError&&state.pluginErrorId===selected.id?`<div class="plugin-toggle-error" role="alert">${escape(state.pluginError)}</div>`:''}
        <div class="plugin-settings-body">${selected.render()}</div></div>
      <div class="plugin-settings-footer">${icon('info')}<p>${escape(selected.help)}</p></div>`;
    showDialog(dialog);
    $('#plugin-dialog-scroll').scrollTop = scrollTop;
  }
  function closePluginDialog() {
    if (!state.pluginDialogOpen) return;
    const returnFocus = state.pluginReturnFocus;
    state.pluginDialogOpen=false;
    state.adapterDraft.access_token='';
    renderPluginDialog(()=>{
      if (state.data && !state.pluginDialogOpen && returnFocus) $(`#${CSS.escape(returnFocus)}`)?.focus({preventScroll:true});
    });
    renderContent();
  }
  function relaySettings() {
    const relay = relayConfiguration();
    const config = `plugins:\n  relay:\n    enabled: ${relay.enabled}\n    nodes: ${JSON.stringify(relay.nodes)}\n    blacklist: ${JSON.stringify(relay.blacklist || [])}\n    include_system: ${relay.includeSystem}`;
    const rows = [['插件状态',relay.enabled?'已启用':'未启用'],['转发范围',relay.nodes.length?relay.nodes.join('、'):'所有在线客户端'],
      ['客户端黑名单',relay.blacklist?.length?relay.blacklist.join('、'):'未设置'],
      ['系统账号消息',relay.includeSystem?'包含系统消息':'仅成员聊天'],['循环消息保护','不转发应用 / 插件投递']];
    return `<div class="plugin-settings-section"><h3>转发策略</h3><p class="plugin-section-description">消息发送到其他在线客户端，不回发来源客户端。</p>
      <dl class="plugin-settings-values">${rows.map(([label,value])=>`<div><dt>${escape(label)}</dt><dd>${escape(value)}</dd></div>`).join('')}</dl>
      <div class="plugin-policy-note">${icon('lock')}<p>黑名单客户端不发送或接收跨服转发，优先于 nodes 名单；不影响连接与应用直接投递。</p></div></div>
       <div class="plugin-settings-section"><div class="plugin-section-heading"><h3>配置快照</h3><span class="plugin-source">plugins.relay · server/config.yaml</span></div>
        <div class="code-box"><pre>${escape(config)}</pre><button class="copy-button" type="button" data-copy="${escape(config)}" aria-label="复制转发配置">${icon('copy')}</button></div></div>`;
  }
  function adapterSettings() {
    const available = !!data().onebotAdapters;
    const clients = data().onebotAdapters?.clients || [];
    const draft = state.adapterDraft;
    const statuses = {connecting:'连接中',verifying:'验证账号 / 群',connected:'已连接',retrying:'等待重连',stopped:'已停止'};
    const disabled = state.adapterBusy || !!state.pluginBusy || !!state.configBusy || state.stale || !available;
    const fields = [
      ['name','客户端名称（可选）','如：玩家交流群','maxlength="80"'],
      ['address','机器人 WebSocket 地址','ws://127.0.0.1:3001/','required maxlength="2048"'],
      ['group','群号','如：123456789','required inputmode="numeric" pattern="[0-9]+"'],
      ['token','Access Token（可选）','机器人端的连接凭证','type="password" autocomplete="new-password" maxlength="1000"'],
    ];
    const inputs = fields.map(([id,label,placeholder,attributes])=>{
      const name = id==='group'?'group_id':id==='token'?'access_token':id;
      return `<label for="adapter-${id}">${label}<input id="adapter-${id}" name="${name}" aria-label="${label}" ${attributes} placeholder="${placeholder}" value="${escape(draft[name])}" ${disabled?'disabled':''}></label>`;
    }).join('');
    return `<div class="plugin-settings-section">
        <h3>添加群客户端</h3>
        <p class="plugin-section-description">机器人账号 + 一个群聊 = 一个 ChatHub 客户端。填写真实机器人的 V11 Universal 正向 WebSocket 地址。</p>
        ${!available?'<div class="offline-bar">服务端尚未加载此插件，请重启升级后的 ChatHub 再添加客户端。</div>':''}
        ${available&&data().pluginStates?.onebot===false?'<div class="plugin-policy-note"><p>插件已关闭。可以保存客户端配置，开启插件后再连接机器人。</p></div>':''}
        <form id="onebot-client-form" class="adapter-form" aria-busy="${state.adapterBusy}">
          ${inputs}
          <p class="adapter-hint">不要填写 ChatHub 网关地址。Token 不放在 URL 中；保存在服务端受限配置文件，不回显、不写入浏览器存储。请只添加你有权使用的机器人和群。</p>
          <p class="form-error" role="alert">${escape(state.adapterError)}</p>
          <p class="plugin-form-notice" role="status">${escape(state.adapterNotice)}</p>
          <button class="button primary" type="submit" ${disabled?'disabled':''}>${icon('plus')}${state.adapterBusy?'正在处理…':'保存并连接'}</button>
        </form>
      </div><div class="plugin-settings-section">
        <div class="plugin-section-heading"><h3>已配置客户端 <span class="plugin-section-count">${clients.length}</span></h3><span class="plugin-source">自动连接 · 断线重连</span></div>
        <div class="adapter-clients">${clients.length?clients.map(client=>`
          <article class="adapter-client">
            <div class="adapter-client-heading"><strong>${escape(client.name)}</strong>
              ${pill(statuses[client.status]||'未知',client.status==='connected'?'green':'neutral')}
               <button class="button secondary" type="button" data-remove-adapter="${escape(client.id)}" ${state.adapterBusy||state.pluginBusy||state.configBusy||state.stale?'disabled':''}>移除</button>
            </div>
            <p class="mono">${escape(client.address)}</p>
            <p>群号 ${escape(client.groupId)} · 机器人 ${escape(client.botId??'待验证')}${client.platformGroupId?` · ChatHub 群 #${escape(client.platformGroupId)}`:''}</p>
            ${client.error?`<p class="adapter-client-error">${escape(client.error)}</p>`:''}
          </article>`).join(''):empty('尚未配置 OneBot 客户端','填写机器人地址与群号，保存后自动连接；断线后自动重连。','message')}
        </div>
      </div>`;
  }

  async function manageAdapter(method, endpoint, body) {
    if (!state.data?.onebotAdapters || state.adapterBusy || state.pluginBusy || state.configBusy || state.stale) return;
    const requestController = new AbortController();
    adapterController = requestController;
    state.adapterBusy = true; state.adapterError = ''; state.adapterNotice = ''; renderContent();
    const timeout = setTimeout(()=>requestController.abort(),10000);
    try {
      const response = await fetch(endpoint,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
        ...(body?{body:JSON.stringify(body)}:{}),signal:requestController.signal,cache:'no-store'});
      if (adapterController !== requestController) return;
      if (response.status===401) {disconnect();$('#auth-error').textContent='管理凭证失效，请重新登录。';return;}
      const result = await response.json();
      if (adapterController !== requestController) return;
      if (!response.ok) throw new Error(result.error || `操作失败（${response.status}）`);
      if (method==='POST') state.adapterDraft = {name:'',address:'',group_id:'',access_token:''};
      // Update immediately; the next snapshot supplies handshake/reconnect status.
      if (state.data.onebotAdapters) {
        if (method==='POST') state.data.onebotAdapters.clients.push(result.client);
        else state.data.onebotAdapters.clients = state.data.onebotAdapters.clients.filter(client=>!endpoint.endsWith('/'+client.id));
      }
      state.adapterNotice = method==='POST' ? data().pluginStates?.onebot===false
        ? '已保存客户端，开启插件后自动连接。' : '已保存客户端，正在连接机器人并验证群聊。' : '客户端已移除。';
      if (!state.pluginDialogOpen) toast(state.adapterNotice);
      cancelRequest();refresh();
    } catch(error) {
      if (adapterController === requestController) state.adapterError = error.name==='AbortError'
        ? '请求超时；保存可能已生效，请刷新客户端列表确认后再重试。' : error.message;
    } finally {
      clearTimeout(timeout);
      if (adapterController === requestController) {adapterController=null;state.adapterBusy=false;renderContent();}
    }
  }
  async function togglePlugin(id) {
    const plugin = pluginCatalog().find(entry=>entry.id===id);
    if (!plugin || !state.data?.pluginStates || typeof state.data.pluginStates[id] !== 'boolean' ||
        state.stale || state.pluginBusy || state.configBusy || state.adapterBusy) return;
    const enabled = !plugin.enabled;
    if (!enabled && id==='onebot' && !window.confirm('关闭 OneBot 插件？所有群客户端将断开连接，但已保存的配置不会删除。')) return;
    cancelRequest();
    const requestController = new AbortController();
    pluginController=requestController;state.pluginBusy=id;state.pluginError='';state.pluginErrorId=id;renderContent();
    const timeout=setTimeout(()=>requestController.abort(),10000);
    try {
      const response=await fetch(`/api/plugins/${id}/state`,{method:'PUT',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
        body:JSON.stringify({enabled}),signal:requestController.signal,cache:'no-store'});
      if (pluginController!==requestController) return;
      if (response.status===401) {disconnect();$('#auth-error').textContent='管理凭证失效，请重新登录。';return;}
      const result=await response.json();
      if (pluginController!==requestController) return;
      if (!response.ok) throw new Error(result.error || `操作失败（${response.status}）`);
      if (result.plugin?.id!==id || typeof result.plugin.enabled!=='boolean') throw new Error('服务端返回了无效的插件状态，请刷新确认。');
      state.data.pluginStates[id]=result.plugin.enabled;
      if (id==='relay' && state.data.relay) state.data.relay.enabled=result.plugin.enabled;
      const registered=state.data.plugins?.find(plugin=>plugin.id===id);
      if (registered) {registered.enabled=result.plugin.enabled;registered.enabledSource='persisted';}
      toast(`${plugin.name}已${result.plugin.enabled?'开启':'关闭'}，状态已保存。`);
    } catch(error) {
      if (pluginController===requestController) state.pluginError=error.name==='AbortError'
        ? '请求超时；开关可能已生效，请刷新确认后再重试。' : error.message;
    } finally {
      clearTimeout(timeout);
      if (pluginController===requestController) {pluginController=null;state.pluginBusy=null;renderContent();refresh();}
    }
  }
  function updateRegisteredPlugin(plugin) {
    if (!state.data) return;
    const index=state.data.plugins?.findIndex(candidate=>candidate.id===plugin.id) ?? -1;
    if (index>=0) state.data.plugins[index]=plugin;
    if (plugin.id==='relay' && state.data.relay) state.data.relay={enabled:plugin.enabled,
      nodes:plugin.configuration.values.nodes,blacklist:plugin.configuration.values.blacklist,includeSystem:plugin.configuration.values.include_system};
  }
  async function savePluginConfiguration(id) {
    const manifest=state.data?.plugins?.find(plugin=>plugin.id===id);
    if (!manifest?.configuration.editable || state.stale || state.configBusy || state.pluginBusy || state.adapterBusy) return;
    const draft=configDraft(manifest);
    if (draft.revision!==manifest.configuration.revision || draft.schemaVersion!==manifest.schemaVersion) {
      draft.error='配置已变更，请加载最新配置后重新编辑。';renderContent();return;
    }
    const values={},errors={};
    for (const field of manifest.configuration.fields) {
      const raw=draft.values[field.key];let value=raw;
      if (field.type==='string-array') {
        value=String(raw??'').split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
        if (field.minItems!==undefined&&value.length<field.minItems || field.maxItems!==undefined&&value.length>field.maxItems) errors[field.key]='列表项数量不符合要求。';
      } else if (field.type==='number') {
        value=String(raw).trim()===''?NaN:Number(raw);
        if (!Number.isFinite(value) || field.integer&&!Number.isInteger(value) || field.minimum!==undefined&&value<field.minimum || field.maximum!==undefined&&value>field.maximum) errors[field.key]='请输入符合范围的有效数字。';
      } else if (field.type==='enum') {
        if (!(field.options||[]).includes(value)) errors[field.key]='请选择允许的选项。';
      } else if (field.type==='string') {
        value=String(raw??'');
        if (field.required&&!value || field.minLength!==undefined&&value.length<field.minLength || field.maxLength!==undefined&&value.length>field.maxLength) errors[field.key]='文本长度不符合要求。';
      }
      values[field.key]=value;
    }
    draft.fieldErrors=errors;draft.notice='';draft.error='';draft.dirty=true;
    if (Object.keys(errors).length) {draft.error='请修正标记的配置项。';renderContent();return;}
    cancelRequest();
    const requestController=new AbortController();configController=requestController;state.configBusy=id;renderContent();
    const timeout=setTimeout(()=>requestController.abort(),10000);
    try {
      const response=await fetch(`/api/plugins/${id}/config`,{method:'PUT',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
        body:JSON.stringify({schemaVersion:draft.schemaVersion,revision:draft.revision,values}),signal:requestController.signal,cache:'no-store'});
      if (configController!==requestController) return;
      if (response.status===401) {disconnect();$('#auth-error').textContent='管理凭证失效，请重新登录。';return;}
      const result=await response.json();
      if (configController!==requestController) return;
      if (!response.ok) {
        if (response.status===409 && result.plugin?.id===id) updateRegisteredPlugin(result.plugin);
        draft.fieldErrors=Object.fromEntries(Object.entries(result.fieldErrors||{}).filter(([key])=>manifest.configuration.fields.some(field=>field.key===key)));
        throw new Error(result.error || `配置保存失败（${response.status}）`);
      }
      if (result.plugin?.id!==id || typeof result.plugin.configuration?.revision!=='string') throw new Error('服务端返回了无效配置，请刷新确认。');
      updateRegisteredPlugin(result.plugin);
      state.configDrafts[id]={...makeConfigDraft(result.plugin),notice:'配置已保存并即时生效，重启后保留。'};
      if (!state.pluginDialogOpen || state.selectedPlugin!==id) toast(`${manifest.name}配置已保存。`);
    } catch(error) {
      if (configController===requestController) draft.error=error.name==='AbortError'
        ? '请求超时；保存可能已生效，请加载最新配置确认后再重试。' : error.message;
    } finally {
      clearTimeout(timeout);
      if (configController===requestController) {configController=null;state.configBusy=null;renderContent();refresh();}
    }
  }
  function nodeTable(full=false) {
    const groups = data().groups.filter(g => !full || `${g.name} ${g.nodeId} ${g.id}`.toLowerCase().includes(state.nodeSearch.toLowerCase()));
    const members = g => g.kind==='onebot'?g.members:online(g);
    return `<section class="panel node-section">${panelTitle('平台客户端',full?`<span class="panel-count">${groups.length} CLIENTS</span>`:viewLink('nodes','查看全部'))}${full?`<div class="message-toolbar"><label class="search-field">${icon('search')}<input id="node-search" aria-label="搜索客户端" placeholder="搜索名称、ID…" value="${escape(state.nodeSearch)}"></label><span class="toolbar-spacer"></span><span class="mono">仅展示已连接客户端</span></div>`:''}${!groups.length?empty('没有匹配的在线客户端','接入 Minecraft 节点，或在平台插件页添加 OneBot 群客户端。'):`<div class="table-wrap"><table><thead><tr><th>客户端 / 群</th><th>类型</th><th>群 ID</th><th>成员</th><th>身份范围</th><th></th></tr></thead><tbody>${groups.map(g => `<tr><td><div class="node-cell"><span class="node-avatar">${icon(g.kind==='onebot'?'message':'server')}</span><div><strong>${escape(g.name)}</strong><small>${escape(g.nodeId)}</small></div></div></td><td>${pill(g.kind==='onebot'?'OneBot 群':'Minecraft')}</td><td class="mono">#${g.id}</td><td><div class="member-stack">${members(g).slice(0,3).map(m=>`<span class="mini-avatar" title="${escape(m.name)}">${escape(m.name.slice(0,1).toUpperCase())}</span>`).join('')}<small>${members(g).length} 人${g.kind==='onebot'?'已观察':'在线'}</small></div></td><td class="mono">${escape(g.identityScope)}</td><td><button class="row-button" data-group="${g.id}" aria-label="查看${escape(g.name)}的成员">详情 ${icon('arrow')}</button></td></tr>`).join('')}</tbody></table></div>`}</section>`;
  }
  function playerDetail() {
    const g = data().groups.find(g=>g.id===state.selectedGroup);
    if (!g) return '';
    return `<section class="panel detail-panel"><div class="detail-heading"><div><h2>${escape(g.name)} · 成员</h2><p>${g.kind==='onebot'?'仅展示本次连接中发言的群成员，不代表完整群名单或 QQ 在线状态。':'本次节点会话内观察到的玩家；在线状态不等于群成员身份。'}</p></div><button class="button secondary" id="close-detail">收起</button></div>${!g.members.length?empty('暂未观察到成员','成员发言或节点同步后，其身份会出现在这里。','users'):`<div class="table-wrap"><table><thead><tr><th>名称</th><th>用户 ID</th><th>状态</th><th>${g.kind==='onebot'?'QQ 账号':'Minecraft UUID'}</th><th>最后发言</th></tr></thead><tbody>${g.members.map(m=>`<tr><td>${escape(m.name)}</td><td class="mono">${m.userId}</td><td><span class="player-state"><i class="status-dot${m.online?'':' muted'}"></i>${g.kind==='onebot'?'已观察':m.online?'在线':'离线'}</span></td><td class="mono">${escape(m.uuid??m.externalId)}</td><td class="mono">${m.lastSentTime?time(m.lastSentTime):'—'}</td></tr>`).join('')}</tbody></table></div>`}<div class="plugin-note">ChatHub 用户 ID 是平台虚拟身份；QQ 账号与 Minecraft UUID 使用不同身份范围。</div></section>`;
  }
  function messageText(message) {
    if (message.trace) return message.trace.preview;
    if (message.traffic) {
      const entry = message.traffic;
      const kinds = {request:'API 请求',response:'API 响应',event:'事件',invalid:'无效报文'};
      return `${kinds[entry.kind]||'报文'}${entry.action?` · ${entry.action}`:''}${entry.truncated?' · 已截断':''} · ${JSON.stringify(entry.payload)}`;
    }
    return message.segments.map(segment => segment.type==='text'?segment.text:segment.type==='image'?`[图片] ${segment.url}`:`@${segment.userId==='all'?'全体成员':segment.userId}`).join('');
  }
  function streamMessages() {
    if (Array.isArray(data().traces)) return data().traces.map(trace => ({id:trace.id,trace,
      time:Math.floor(trace.timestampMs/1000),timestampMs:trace.timestampMs,origin:trace.origin,
      authorName:trace.steps[0]?.label || '消息链路',groupId:trace.steps[0]?.groupId,
      groupName:trace.steps[0]?.nodeId || 'ChatHub 统一接口'}));
    const traffic = (data().onebotTraffic||[]).filter(entry=>entry.peer==='gateway').map(entry => {
      const groupId = entry.groupId;
      return {id:entry.id,time:entry.time,timestampMs:entry.timestampMs,groupId,
        authorName:entry.peerName,origin:`onebot_${entry.direction}`,traffic:entry,
        groupName:data().groups.find(group=>group.id===groupId)?.name || (groupId?`群 #${groupId}`:'ChatHub 统一接口')};
    });
    return [...data().messages,...traffic].sort((a,b)=>(b.timestampMs??b.time*1000)-(a.timestampMs??a.time*1000));
  }
  function messageRows(messages) {
    const labels = {system:'系统',application:'应用投递',plugin:'插件投递',onebot_sent:'OneBot 发送 →',onebot_received:'OneBot 接收 ←'};
    return messages.map(m=>m.trace ? traceCard(m) : `<article class="message-row" id="message-open-${escape(m.id)}" data-message="${escape(m.id)}" role="button" tabindex="0" aria-haspopup="dialog" aria-controls="message-data-dialog" aria-label="查看${escape(m.authorName)}的消息原始数据" title="点击查看原始数据"><span class="message-avatar ${m.origin==='system'?'system':m.origin==='player'?'':'application'}">${m.origin==='player'?escape(m.authorName.slice(0,1).toUpperCase()):icon(m.traffic?'code':m.origin==='system'?'server':'message')}</span><div class="message-main"><div class="message-meta"><strong>${escape(m.authorName)}</strong>${labels[m.origin]?`<span class="origin-tag">${labels[m.origin]}</span>`:''}<span class="message-group">${escape(m.groupName)}</span><time datetime="${new Date(m.time*1000).toISOString()}">${time(m.time)}</time></div><p class="message-text">${escape(m.traffic&&messageText(m).length>300?messageText(m).slice(0,300)+'…':messageText(m))}</p></div><span class="message-data-hint" aria-hidden="true">${icon('code')}</span></article>`).join('');
  }
  const traceStatuses = {received:['已接收','neutral'],processing:['处理中','amber'],accepted:['已接受','green'],
    confirmed:['已确认','green'],sent:['已发送（未确认处理）','blue'],failed:['失败','red'],timeout:['超时','red'],skipped:['未处理','neutral']};
  function traceStatus(step) {
    const [label,color]=traceStatuses[step.status] || ['未知','neutral'];
    return pill(label,color);
  }
  function traceNodeType(step) {
    if (step.kind==='source') return ['消息来源',step.connectionId?'globe':'message'];
    if (step.kind==='core') return ['平台核心','layers'];
    if (step.kind==='onebot') return ['OneBot 接口','globe'];
    if (step.direction==='sent') return ['投递报文','code'];
    if (step.direction==='received') return ['确认报文','code'];
    if (step.pluginName || step.kind==='plugin') return ['插件转发','puzzle'];
    return [step.parentId==='2'?'客户端投递':'投递确认','server'];
  }
  function traceGraph(trace) {
    const ids=new Set(trace.steps.map(step=>step.id)),children=new Map(),visited=new Set();
    trace.steps.forEach(step=>{
      const parent=ids.has(step.parentId)?step.parentId:undefined;
      if (!children.has(parent)) children.set(parent,[]);
      children.get(parent).push(step);
    });
    const branch = step => {
      if (visited.has(step.id)) return '';
      visited.add(step.id);
      const [type,glyph]=traceNodeType(step),color=traceStatuses[step.status]?.[1] || 'neutral';
      const wire=step.kind==='delivery'&&!!step.direction;
      const identity=step.nodeId || (step.connectionId?`连接 ${step.connectionId.slice(0,8)}`:step.messageId?`消息 #${step.messageId}`:step.action || `步骤 ${step.id}`);
      const next=children.get(step.id)||[];
      return `<li class="trace-branch" data-outcome="${color}"><button id="trace-step-${escape(trace.id)}-${escape(step.id)}" class="trace-node${wire?' trace-wire-node':''}" type="button" data-message="${escape(trace.id)}" data-step="${escape(step.id)}" aria-haspopup="dialog" aria-controls="message-data-dialog" aria-label="查看${escape(step.label)}的节点原始内容" title="${escape(step.label)} · 点击只查看此节点报文"><span class="trace-node-top"><span class="trace-node-icon">${icon(glyph)}</span><span class="trace-node-type">${type}</span><span class="trace-node-number">${escape(step.id.padStart(2,'0'))}</span></span><strong>${escape(step.label)}</strong><span class="trace-node-identity">${escape(identity)}</span><span class="trace-node-bottom">${traceStatus(step)}${step.durationMs!==undefined?`<span class="trace-duration">${escape(step.durationMs)} ms</span>`:''}</span>${step.error?`<span class="trace-error">${escape(step.error)}</span>`:''}${step.truncated?'<span class="trace-node-note">快照已截断</span>':''}</button>${next.length?`<ol class="trace-branches">${next.map(branch).join('')}</ol>`:''}</li>`;
    };
    return `<div id="trace-graph-${escape(trace.id)}" class="trace-graph-viewport" tabindex="0" role="region" aria-label="消息链路图，可横向滚动查看；点击节点查看该节点报文"><ol class="trace-graph">${(children.get(undefined)||[]).map(branch).join('')}</ol></div>`;
  }
  function traceCard(message) {
    const trace=message.trace;
    const origin={player:'玩家',system:'系统',application:'应用',plugin:'插件',onebot_received:'OneBot 接收',onebot_sent:'OneBot 发送'};
    const failures=trace.steps.filter(step=>step.status==='failed'||step.status==='timeout').length;
    const branches=trace.steps.filter(step=>step.parentId==='2').length;
    return `<article class="trace-card" aria-label="消息链路"><div class="trace-card-header"><button class="trace-heading" id="message-open-${escape(trace.id)}" data-message="${escape(trace.id)}" type="button" aria-haspopup="dialog" aria-controls="message-data-dialog" title="查看来源节点的原始内容"><span class="trace-heading-main"><span class="trace-kicker">MESSAGE TRACE <span>${escape(origin[trace.origin]||trace.origin)}</span></span><strong>${escape(trace.preview || '消息链路')}</strong><span class="trace-id">${escape(trace.id.slice(0,8))}${trace.truncated?' · 记录已截断':''}</span></span></button><div class="trace-card-summary"><time datetime="${new Date(trace.timestampMs).toISOString()}">${time(message.time)}</time><span>${trace.steps.length} 个节点 · ${branches} 条分支</span>${failures?pill(`${failures} 个异常`,'red'):''}</div></div>${traceGraph(trace)}<div class="trace-legend"><span>${icon('arrow')}沿箭头查看流向 · 点击节点查看独立报文</span><span class="trace-legend-status"><i class="trace-dot green"></i>已确认 / 接受<i class="trace-dot blue"></i>已发送，未确认处理<i class="trace-dot red"></i>失败 / 超时</span></div></article>`;
  }
  async function openMessageDialog(id, selectedStep) {
    const message = streamMessages().find(message=>String(message.id)===id);
    if (!state.data || !message) return;
    traceController?.abort();traceController=null;state.selectedTrace=null;
    if (message.trace) {
      const stepId=selectedStep ?? message.trace.steps[0]?.id;
      const node=message.trace.steps.find(step=>step.id===stepId);
      if (!node) return;
      state.selectedTrace={id,selectedStep:stepId,node,loaded:false,error:''};state.selectedMessage='';
      state.messageReturnFocus=selectedStep?`trace-step-${id}-${selectedStep}`:`message-open-${id}`;renderMessageDialog(()=>{},true);
      const requestController=new AbortController();traceController=requestController;
      const timeout=setTimeout(()=>requestController.abort(),10000);
      try {
        const response=await fetch(`/api/traces/${encodeURIComponent(id)}`,{headers:{Authorization:`Bearer ${token}`},cache:'no-store',signal:requestController.signal});
        if (traceController!==requestController) return;
        if (response.status===401) {disconnect();$('#auth-error').textContent='管理凭证失效，请重新登录。';return;}
        const detail=await response.json();
        if (traceController!==requestController) return;
        if (!response.ok) throw new Error(detail.error || `链路读取失败（${response.status}）`);
        if (detail.id!==id || !Array.isArray(detail.steps)) throw new Error('服务端返回了无效链路。');
        const selectedNode=detail.steps.find(step=>step.id===stepId);
        if (!selectedNode) throw new Error('所选节点不存在，未显示其他节点的报文。');
        state.selectedTrace.node=selectedNode;state.selectedTrace.loaded=true;
        state.selectedMessage=selectedNode.payload===undefined?'':JSON.stringify(selectedNode.payload,null,2);
      } catch(error) {
        if (traceController===requestController) state.selectedTrace.error=error.name==='AbortError'?'请求超时，请关闭后重试。':error.message;
      } finally {
        clearTimeout(timeout);
        if (traceController===requestController) {traceController=null;renderMessageDialog(()=>{},true);}
      }
      return;
    }
    state.selectedMessage = JSON.stringify(message.traffic||message,null,2);
    state.selectedMessageOnebot = !!message.traffic;
    state.messageReturnFocus = `message-open-${id}`;
    renderMessageDialog();
  }
  function renderMessageDialog(onClose=()=>{}, replace=false) {
    const dialog = $('#message-data-dialog'), content = $('#message-data-content');
    if (!state.data || state.selectedMessage===null) {
      closeDialog(dialog,()=>{content.replaceChildren();$('#message-dialog-toast').hidden=true;onClose();});
      return;
    }
    // Keep the opened snapshot, scroll position and text selection across polling.
    if (dialog.open && !closingDialogs.has(dialog) && !replace) return;
    if (state.selectedTrace) {
      const selected=state.selectedTrace,node=selected.node,[type,glyph]=traceNodeType(node);
      const context=[node.messageId?`消息 #${node.messageId}`:'',node.eventId?`event_id: ${node.eventId}`:'',node.nodeId?`客户端 ${node.nodeId}`:'',node.groupId?`群 #${node.groupId}`:'',node.connectionId?`连接 ${node.connectionId}`:'',node.action || ''].filter(Boolean).join(' · ');
      const hasPayload=selected.loaded&&node.payload!==undefined;
      content.innerHTML=`<div class="plugin-dialog-header"><div><span class="plugins-eyebrow">NODE PAYLOAD · 步骤 ${escape(node.id)}</span><h2 id="message-data-title">节点原始内容</h2></div><button id="message-dialog-close" class="plugin-dialog-close" type="button" aria-label="关闭节点原始内容">${icon('close')}</button></div><div class="plugin-dialog-scroll"><div class="message-data-body"><div class="trace-selected-node"><span class="trace-node-icon">${icon(glyph)}</span><div><span class="trace-node-type">${type}</span><h3>${escape(node.label)}</h3></div>${traceStatus(node)}</div><p class="trace-selected-context">${escape(context)}</p><p>${escape(new Date(node.timestampMs).toLocaleString('zh-CN',{hour12:false}))}${node.durationMs!==undefined?` · 耗时 ${escape(node.durationMs)} ms`:''}</p>${node.error?`<p class="trace-payload-warning">${escape(node.error)}</p>`:''}<p id="message-data-description">仅显示此节点保存的报文，不包含其他节点或整条链路。敏感字段已脱敏；没有协议报文的内部步骤不伪造原始内容。此窗口保留打开时快照。</p>${selected.error?`<p role="alert">${escape(selected.error)}</p>`:!selected.loaded?'<p role="status">正在读取节点原始内容…</p>':`${node.truncated?'<p class="trace-payload-warning">此节点报文已截断或省略。</p>':''}${hasPayload?`<pre id="message-data-json" tabindex="0">${escape(state.selectedMessage)}</pre>`:'<div class="trace-payload-empty">此节点没有报文快照。请关闭窗口，点击链路中的入站、投递报文、确认报文或 OneBot 节点查看对应内容。</div>'}`}</div></div><div class="message-data-footer"><button id="message-data-copy" class="button secondary" type="button" ${hasPayload?'':'disabled'}>${icon('copy')}复制此节点 JSON</button></div>`;
      showDialog(dialog);$('#message-dialog-close').focus({preventScroll:true});return;
    }
    content.innerHTML = `<div class="plugin-dialog-header"><div><span class="plugins-eyebrow">消息详情 · JSON</span><h2 id="message-data-title">消息原始数据</h2></div><button id="message-dialog-close" class="plugin-dialog-close" type="button" aria-label="关闭消息原始数据">${icon('close')}</button></div>
      <div class="plugin-dialog-scroll"><div class="message-data-body"><p id="message-data-description">${state.selectedMessageOnebot?'ChatHub 对外 OneBot 接口收发快照：接收为应用 → ChatHub，发送为 ChatHub → 应用。payload 为协议数据，敏感字段已脱敏，过大的报文会截断。':'服务端缓存的完整消息对象（含平台字段），不是上游协议原始报文。'}打开后保留此刻快照，不随自动刷新变化。</p><pre id="message-data-json" tabindex="0">${escape(state.selectedMessage)}</pre></div></div>
      <div class="message-data-footer"><button id="message-data-copy" class="button secondary" type="button">${icon('copy')}复制 JSON</button></div>`;
    showDialog(dialog);
    $('#message-dialog-close').focus({preventScroll:true});
  }
  function closeMessageDialog({restoreFocus=true}={}) {
    if (state.selectedMessage===null) return;
    const returnFocus = state.messageReturnFocus;
    traceController?.abort();traceController=null;state.selectedTrace=null;
    state.selectedMessage=null;state.messageReturnFocus='';
    renderMessageDialog(()=>{
      if (restoreFocus && state.data && state.selectedMessage===null) ($(`#${CSS.escape(returnFocus)}`) || $('#main')).focus({preventScroll:true});
    });
  }
  function messagePanel(full=false) {
    const allMessages = streamMessages();
    let messages = allMessages;
    if (full) messages = messages.filter(m => {
      const steps=m.trace?.steps || [];
      const matchesOrigin=state.messageFilter==='all'||m.origin===state.messageFilter ||
        state.messageFilter==='application'&&steps.some(step=>step.kind==='delivery'&&step.parentId==='2'&&!step.pluginName) ||
        state.messageFilter==='plugin'&&steps.some(step=>step.pluginName) ||
        state.messageFilter==='onebot_sent'&&steps.some(step=>step.kind==='onebot'&&step.direction==='sent') ||
        state.messageFilter==='onebot_received'&&steps.some(step=>step.kind==='source'&&step.direction==='received');
      const matchesGroup=state.groupFilter==='all'||String(m.groupId)===state.groupFilter||steps.some(step=>String(step.groupId)===state.groupFilter);
      return matchesOrigin && matchesGroup && `${m.id} ${m.authorName} ${messageText(m)} ${m.groupName} ${steps.map(step=>[step.label,step.error,step.nodeId,step.action,step.messageId,step.eventId,step.connectionId].join(' ')).join(' ')}`.toLowerCase().includes(state.messageSearch.toLowerCase());
    });
    else messages = messages.slice(0,4);
    return `<section class="panel${full?' view-message-panel':''}">${panelTitle(full?'平台消息流':'最近消息',full?`<span class="panel-count">${messages.length} / ${allMessages.length}</span>`:viewLink('messages','查看消息流'),Array.isArray(data().traces)?'一条源消息、一张链路卡片 · 展示最近 150 条，内存保留 1,000 条；重启清空。':'最近 150 条聊天及 200 条 ChatHub 对外 OneBot 接口收发记录（不含 QQ 机器人上游 API）；重启清空。')}${full?`<div class="message-toolbar">${[['all','全部'],['player','玩家'],['system','系统'],['application','应用'],['plugin','插件'],['onebot_sent','OneBot 发送'],['onebot_received','OneBot 接收']].map(([value,label])=>`<button class="filter-button${state.messageFilter===value?' active':''}" data-filter="${value}" aria-pressed="${state.messageFilter===value}">${label}</button>`).join('')}<span class="toolbar-spacer"></span><select id="group-filter" class="field-select" aria-label="按节点筛选"><option value="all">所有节点</option>${data().groups.map(g=>`<option value="${g.id}"${state.groupFilter===String(g.id)?' selected':''}>${escape(g.name)}</option>`).join('')}</select><label class="search-field">${icon('search')}<input id="message-search" aria-label="搜索消息" placeholder="搜索消息、玩家、API…" value="${escape(state.messageSearch)}"></label></div>`:''}<div class="message-list">${messages.length?messageRows(messages):empty(state.data?'还没有匹配的消息':'对话将在这里汇聚',state.data?'聊天、系统通知与 OneBot 接口消息到达后自动刷新。':'连接后查看最新消息与 OneBot 接口收发。','message')}</div></section>`;
  }
  function logPanel(full=false) {
    const allLogs = data().logs || [];
    const clients = new Map(allLogs.map(log => [String(log.groupId),log.groupName]));
    const labels = {application:'应用投递',plugin:'跨客户端转发'};
    const logs = full ? allLogs.filter(log =>
      (state.logOrigin==='all'||log.origin===state.logOrigin) &&
      (state.logGroupFilter==='all'||String(log.groupId)===state.logGroupFilter) &&
      `${log.groupName} ${log.nodeId||''} ${log.groupId} ${log.error} ${log.messageId||''} ${log.sourceMessageId||''}`.toLowerCase().includes(state.logSearch.toLowerCase())) : allLogs.slice(0,3);
    return `<section class="panel log-panel">${panelTitle(full?'发送失败日志':'最近发送失败',full?`<span class="panel-count">${logs.length} / ${allLogs.length}</span>`:viewLink('logs','查看日志'),'记录最近 200 次发送失败；仅保留在内存中，服务端重启后清空。')}
      ${full?`<div class="message-toolbar">${[['all','全部'],['plugin','跨客户端转发'],['application','应用投递']].map(([value,label])=>`<button class="filter-button${state.logOrigin===value?' active':''}" data-log-origin="${value}" aria-pressed="${state.logOrigin===value}">${label}</button>`).join('')}<span class="toolbar-spacer"></span><select id="log-group-filter" class="field-select" aria-label="按目标客户端筛选"><option value="all">所有目标客户端</option>${[...clients].map(([id,name])=>`<option value="${escape(id)}"${state.logGroupFilter===id?' selected':''}>${escape(name)} · #${escape(id)}</option>`).join('')}</select><label class="search-field">${icon('search')}<input id="log-search" aria-label="搜索日志" placeholder="搜索客户端、失败原因…" value="${escape(state.logSearch)}"></label></div>`:''}
      <div class="log-list">${logs.length?logs.map(log=>`<article class="log-row"><span class="log-icon">${icon('alert')}</span><div class="log-main"><div class="log-meta">${pill('发送失败','red')}<strong>${escape(log.groupName)}</strong><span class="origin-tag">${labels[log.origin]||'消息投递'}</span><time datetime="${new Date(log.time*1000).toISOString()}">${escape(new Date(log.time*1000).toLocaleString('zh-CN',{hour12:false}))}</time></div><p class="log-error">${escape(log.error)}</p><p class="log-context">目标群 #${escape(log.groupId)}${log.nodeId?` · 客户端 ${escape(log.nodeId)}`:''}${log.messageId?` · 投递 ID ${escape(log.messageId)}`:''}${log.sourceMessageId?` · 来源消息 #${escape(log.sourceMessageId)}`:''}</p></div></article>`).join(''):empty(allLogs.length?'没有匹配的日志':'暂无发送失败',allLogs.length?'请调整筛选条件或搜索关键词。':'消息发送失败后，会自动记录目标客户端与失败原因。','activity')}</div>
    </section>`;
  }
  function healthPanel() {
    const d = data();
    return `<section class="panel">${panelTitle('运行状态',state.data?pill(state.stale?'连接中断':'运行中',state.stale?'amber':'green'):pill('等待连接','neutral'))}<div class="health-body"><div class="health-row"><span>运行时长</span><span class="health-value mono">${state.data?duration(d.uptimeSeconds):'—'}</span></div><div class="health-row"><span>服务内存 · RSS</span><span class="health-value mono">${state.data?`${(d.memoryBytes/1048576).toFixed(1)} MB`:'—'}</span></div><div class="health-row"><span>原生节点协议</span><span class="health-value">${pill('v2','neutral')}</span></div><div class="health-row"><span>OneBot 网关</span><span class="health-value">V11 · 群聊子集</span></div><div class="health-row"><span>系统虚拟账号</span><span class="health-value mono">user_id = 2</span></div><div class="health-note">${state.stale?'最后一次成功获取的数据已过期，不能代表当前在线状态。':'每 5 秒同步状态。消息缓存随进程重启清空，不代表历史累计消息数。'}</div></div></section>`;
  }
  function settingsDraft() {
    const current=data().settings;
    if (!current) return null;
    if (!state.settingsDraft || !state.settingsDraft.dirty && state.settingsDraft.revision!==current.revision) {
      state.settingsDraft={...current,dirty:false,error:'',status:'idle',edit:0,composing:false,blocked:false};
    }
    return state.settingsDraft;
  }
  function settingsPage() {
    const draft=settingsDraft();
    if (!draft) return `<section class="panel">${empty('平台设置暂不可用','请更新并重启 ChatHub 服务端后刷新。','settings')}</section>`;
    return `<section class="panel platform-settings"><form id="platform-settings-form" aria-busy="${state.settingsBusy}">
      <div class="settings-field-heading"><label for="settings-public-url">平台公网地址</label><span id="settings-save-state" class="settings-save-status" role="status" aria-live="polite" aria-atomic="true"></span></div>
      <div class="config-field"><input id="settings-public-url" type="text" inputmode="url" autocomplete="off" spellcheck="false" maxlength="2048" placeholder="https://chathub.example.com" value="${escape(draft.public_url)}" aria-describedby="settings-error" ${state.stale?'disabled':''}></div>
      <p id="settings-error" class="config-form-error" role="alert">${escape(draft.error)}</p>
    </form></section>`;
  }
  function syncSettingsPage() {
    if (state.view!=='settings' || !state.data) return;
    const draft=settingsDraft(), input=$('#settings-public-url'), status=$('#settings-save-state');
    if (!draft || !input || !status) return;
    // Keep the input and animated status mounted across polling and save replies.
    if (document.activeElement!==input) input.value=draft.public_url;
    input.disabled=state.stale;
    input.setAttribute('aria-invalid',String(!!draft.error));
    $('#platform-settings-form').setAttribute('aria-busy',String(state.settingsBusy));
    $('#settings-error').textContent=draft.error;
    const value=state.settingsBusy?'saving':draft.status;
    if (status.dataset.state!==value) {
      status.dataset.state=value;
      status.innerHTML=value==='saving'?'<span class="settings-save-spinner" aria-hidden="true"></span>保存中'
        :value==='saved'?'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m5 12 4 4 10-10"/></svg>已保存'
        :value==='pending'?(state.stale?'等待连接':'等待保存'):value==='error'?'未保存':'自动保存';
    }
  }
  function queueSettingsSave() {
    clearTimeout(settingsSaveTimer);settingsSaveTimer=null;
    const draft=settingsDraft();
    if (!draft || !draft.dirty || draft.blocked || draft.composing || state.stale) return;
    settingsSaveTimer=setTimeout(()=>{settingsSaveTimer=null;saveSettings();},600);
  }
  function editSettings(input, composing=false) {
    const draft=settingsDraft();
    if (!draft) return;
    draft.public_url=input.value;draft.edit++;draft.dirty=true;draft.composing=composing;
    if (!draft.blocked) {draft.error='';draft.status='pending';}
    syncSettingsPage();queueSettingsSave();
  }
  async function saveSettings() {
    clearTimeout(settingsSaveTimer);settingsSaveTimer=null;
    const draft=settingsDraft();
    if (!draft || !draft.dirty || draft.blocked || draft.composing || state.stale || state.settingsBusy) return;
    if (draft.revision!==data().settings.revision) {
      draft.blocked=true;draft.status='error';draft.error='设置已被其他管理员更新，请刷新页面后重试。';syncSettingsPage();return;
    }
    const publicUrl=draft.public_url.trim(), edit=draft.edit;
    if (publicUrl===data().settings.public_url) {draft.dirty=false;draft.status='idle';draft.error='';syncSettingsPage();return;}
    draft.error='';draft.status='saving';
    cancelRequest();
    const requestController=new AbortController();settingsController=requestController;state.settingsBusy=true;syncSettingsPage();
    const timeout=setTimeout(()=>requestController.abort(),10000);
    try {
      const response=await fetch('/api/settings',{method:'PUT',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
        body:JSON.stringify({public_url:publicUrl,revision:draft.revision}),cache:'no-store',signal:requestController.signal});
      if (settingsController!==requestController) return;
      if (response.status===401) {disconnect();$('#auth-error').textContent='管理凭证失效，请重新登录。';return;}
      const result=await response.json();
      if (settingsController!==requestController) return;
      if (!response.ok) {
        if (response.status===409) {
          if (result.settings) state.data.settings=result.settings;
          draft.blocked=true;
          throw new Error('设置已被其他管理员更新，请刷新页面后重试。');
        }
        throw new Error(result.error || `平台设置保存失败（${response.status}）`);
      }
      if (typeof result.settings?.public_url!=='string' || typeof result.settings.revision!=='string') throw new Error('服务端返回了无效设置，请重新加载确认。');
      state.data.settings=result.settings;
      draft.revision=result.settings.revision;
      if (draft.edit===edit) {draft.public_url=result.settings.public_url;draft.dirty=false;draft.status='saved';}
    } catch(error) {
      if (settingsController===requestController && (draft.edit===edit || draft.blocked)) {
        draft.status='error';draft.error=error.name==='AbortError'?'保存超时，请刷新确认。':error.message;
      }
    } finally {
      clearTimeout(timeout);
      if (settingsController===requestController) {
        settingsController=null;state.settingsBusy=false;
        if (draft.dirty && draft.edit!==edit && !draft.blocked) {draft.status='pending';queueSettingsSave();}
        syncSettingsPage();
      }
    }
  }
  function guide() {
    const scheme = location.protocol==='https:'?'wss:':'ws:';
    const nativeUrl = `${scheme}//${location.host}/chathub/v2/connect`;
    const onebotUrl = `${scheme}//${location.host}/onebot/v11`;
    const nodePassword = nativeConnection?.access_token || '<node_password>';
    const code = text => `<div class="code-box"><pre>${escape(text)}</pre><button class="copy-button" data-copy="${escape(text)}" aria-label="复制配置">${icon('copy')}</button></div>`;
    return `<div class="guide-grid"><section class="panel guide-card"><h2>${icon('server')}接入 ChatHub 客户端</h2><p>将构建好的 chathub-2.0.0.mcdr 放入 MCDR 插件目录。节点自带配置，无需在 ChatHub 维护注册名单。</p><div class="guide-step"><span>1</span>运行 npm run build:plugin，安装 dist/ 中的插件。</div><div class="guide-step"><span>2</span>在 MCDR chathub.json 中填写地址与独立节点密码。</div><div class="guide-step"><span>3</span>为节点设置唯一 node_id，重载插件后自动接入。</div>${code(JSON.stringify({server_url:nativeUrl,password:nodePassword,node_id:'survival',name:'生存世界',identity_mode:'cache',identity_scope:'minecraft:online'},null,2))}<p>离线模式请使用 identity_mode=offline 并设置独立的身份范围。缓存模式从登录日志 / usercache 读取权威 UUID。</p></section><section class="panel guide-card"><h2>${icon('code')}连接 OneBot 应用</h2><p>ChatHub 是 OneBot V11 实现端。Koishi / NoneBot 等应用连接网关，接收事件、调用群聊 API。</p><div class="guide-step"><span>1</span>在应用中配置 OneBot V11 正向 WebSocket。</div><div class="guide-step"><span>2</span>使用 onebot_token；不要使用节点或管理密码。</div><div class="guide-step"><span>3</span>按需使用 Universal 或独立 API / Event 通道。</div>${code(`${onebotUrl}\nAuthorization: Bearer <onebot_token>\n\n${onebotUrl}/api\n${onebotUrl}/event`)}<p>平台群 ID / 用户 ID 为虚拟身份，并非 QQ 账号。机器人 self_id=1，系统消息发送者 user_id=2。</p></section></div>
      <div class="guide-callout">${icon('message')}<div><strong>接入真实机器人与 QQ 群？</strong><br>到“平台插件”填写真实机器人的 V11 Universal 正向 WS 地址、群号和可选 Access Token。该群成为平台客户端；不要把 ChatHub 自己的网关地址填入此适配器。跨群转发需要启用 CrossServerRelay。</div></div>
      <div class="guide-callout">${icon('lock')}<div><strong>分离凭证，保持边界。</strong><br>dashboard_token 用于观测及 OneBot 客户端管理，只应交给受信任管理员；node_password 用于 MCDR；onebot_token 用于应用网关。真实机器人使用它自己的 Access Token。公开部署请使用 HTTPS / WSS 并修改所有示例密码。没有重启、踢出或任意配置写入操作。</div></div>`;
  }
  function renderContent() {
    const overview=!!state.data && state.view==='overview', container=$('#view-content');
    const chatting=!!state.data && state.view==='chat';
    $('#workspace').classList.toggle('chat-mode',chatting);
    if (!chatting && chatWorkspace) {chatWorkspace.unmount();chatWorkspace=null;}
    $('#main').classList.toggle('topology-only',overview);
    $('#main').classList.toggle('settings-only',!!state.data && state.view==='settings');
    $('#page-heading').hidden=overview || chatting;
    if (chatting) {
      topologyState.cleanup?.();topologyState.cleanup=null;
      if (!chatWorkspace) {
        container.replaceChildren();container.dataset.view='chat';
        chatWorkspace=window.ChatHubChat.mount(container,{icon,escape,token:()=>token,
          unauthorized:disconnect,notice:toast,navigate:setView,
          refresh,accepted:message=>{if(state.data){state.data.messages=[message,...state.data.messages.filter(item=>item.id!==message.id)];}}});
      }
      chatWorkspace.sync(data(),{stale:state.stale,error:state.error,paused:state.paused});
      renderPluginDialog();renderMessageDialog();return;
    }
    if (overview) {
      if (container.dataset.view!=='overview') {
        container.innerHTML=topology();container.dataset.view='overview';topologyState.signature='';
        mountTopology();
      }
      syncTopology();renderPluginDialog();renderMessageDialog();return;
    }
    if (state.data && state.view==='settings' && container.dataset.view==='settings' && container.dataset.settingsForm==='true' && data().settings) {
      syncSettingsPage();renderPluginDialog();renderMessageDialog();return;
    }
    topologyState.cleanup?.();topologyState.cleanup=null;container.dataset.view=state.data?state.view:'';
    if (!state.data) { $('#view-content').replaceChildren(); renderPluginDialog(); renderMessageDialog(); renderOnebotDialog(); return; }
    const focus = document.activeElement;
    const graphScrolls=new Map([...document.querySelectorAll('.trace-graph-viewport')].map(graph=>[graph.id,graph.scrollLeft]));
    const focusedId = focus?.id;
    const position = focus instanceof HTMLInputElement || focus instanceof HTMLTextAreaElement ? focus.selectionStart : null;
    const inDialog = $('#plugin-settings-dialog').contains(focus);
    const focusSelector = focus instanceof HTMLElement && (inDialog || (!state.pluginDialogOpen && !onebotDialogOpen && state.selectedMessage===null && $('#view-content').contains(focus)))
      ? focusedId ? `#${CSS.escape(focusedId)}`
        : ['filter','logOrigin','group','copy','view'].map(key => focus.dataset[key]===undefined?null:`[data-${key.replace(/[A-Z]/g,letter=>'-'+letter.toLowerCase())}="${CSS.escape(focus.dataset[key])}"]`).find(Boolean)
      : null;
    let content = '';
    if (state.stale) content += `<div class="offline-bar" role="status">${icon('info')}连接暂时中断，以下为过期快照。${escape(state.error)}</div>`;
    if (state.view==='nodes') content += `${statCards()}${nodeTable(true)}${playerDetail()}`;
    else if (state.view==='messages') content += messagePanel(true);
    else if (state.view==='logs') content += logPanel(true);
    else if (state.view==='plugins') content += pluginsPage();
    else if (state.view==='settings') content += settingsPage();
    else { content += guide(); ensureNativeConnection(); }
    $('#view-content').innerHTML = content;
    container.dataset.settingsForm=String(state.view==='settings' && !!data().settings);
    if (state.view==='settings') syncSettingsPage();
    graphScrolls.forEach((left,id)=>{const graph=$(`#${CSS.escape(id)}`);if(graph)graph.scrollLeft=left;});
    renderPluginDialog();
    renderMessageDialog();
    if (focusSelector) {
      const replacement = (inDialog ? $('#plugin-dialog-content') : $('#view-content')).querySelector(focusSelector);
      replacement?.focus({preventScroll:true});
      if (position!==null && (replacement instanceof HTMLInputElement || replacement instanceof HTMLTextAreaElement)) replacement.setSelectionRange(position,position);
    }
  }
  function render() {
    const authenticated = !!state.data;
    $('#login-page').hidden = authenticated;
    $('#workspace').hidden = !authenticated;
    $('#workspace-skip').hidden = !authenticated;
    document.title = authenticated ? `${views[state.view][0]} · ChatHub` : '登录 · ChatHub';
    $('#login-submit').disabled = state.loading;
    $('#token').disabled = state.loading;
    $('#login-form').setAttribute('aria-busy', String(state.loading));
    $('#login-submit-label').textContent = state.loading ? '正在验证…' : '登录工作台';
    $('#login-status').textContent = state.loading ? '正在验证管理凭证，请稍候。' : '';
    $('#environment-label').textContent = state.stale?'连接中断':state.data?'已连接':'本地环境';
    $('#node-count').textContent = state.data?String(data().stats.groups):'—';
    $('#log-count').textContent = String((data().logs||[]).length);
    $('#last-update').textContent = state.data?`更新于 ${time(data().now/1000)}`:'等待连接';
    $('#pause').innerHTML = `${icon(state.paused?'play':'pause')}<span>${state.paused?'恢复刷新':'暂停刷新'}</span>`;
    $('#pause').setAttribute('aria-pressed', String(state.paused));
    $('#refresh').disabled = state.loading;
    $('#footer-status').textContent = state.paused?'自动刷新已暂停':state.stale?'连接中断 · 数据已过期':'每 5 秒刷新 · 插件接入';
    renderContent();
  }
  function setView(view, {history='push',animate=true}={}) {
    if (!state.data || !Object.hasOwn(routes,view)) return;
    const changed = state.view !== view;
    if (changed && state.selectedMessage!==null) closeMessageDialog({restoreFocus:false});
    if (changed && onebotDialogOpen) closeOnebotDialog({restoreFocus:false});
    if (changed && state.pluginDialogOpen) {
      state.pluginDialogOpen=false;state.adapterDraft.access_token='';
    }
    if (view !== 'plugins') state.adapterDraft.access_token = '';
    state.view = view;
    if (history!=='none' && (location.pathname!==routes[view] || location.search || location.hash)) {
      window.history[history==='replace'?'replaceState':'pushState'](null,'',routes[view]);
    }
    document.title = `${views[view][0]} · ChatHub`;
    $('#breadcrumb-title').textContent = views[view][0];
    $('#page-title').innerHTML = `${views[view][0]}<span class="heading-dot">.</span>`;
    $('#page-description').textContent = views[view][1];
    document.querySelectorAll('.nav-item').forEach(el => {
      el.classList.toggle('active',el.dataset.view===view);
      el.dataset.view===view ? el.setAttribute('aria-current','page') : el.removeAttribute('aria-current');
    });
    $('#sidebar').classList.remove('open'); $('#menu-toggle').setAttribute('aria-expanded','false');
    renderContent();
    if (changed) {
      if (view==='chat') refresh();
      if (history==='push') window.scrollTo({top:0,behavior:'instant'});
      $('#main').focus({preventScroll:true});
      if (animate) {animateEntry($('#view-content'));animateEntry($('#page-heading'));}
    }
  }
  function cancelRequest() { generation++; controller?.abort(); controller=null; state.loading=false; }
  async function refresh() {
    if (!token || state.loading || state.pluginBusy || state.configBusy || state.settingsBusy) return;
    const wasAuthenticated = !!state.data;
    const current = ++generation;
    const requestController = new AbortController();
    controller = requestController;
    state.loading=true; $('#auth-error').textContent=''; render();
    const timeout = setTimeout(()=>requestController.abort(), 8000);
    try {
      const chatQuery=(state.data?state.view:routeView())==='chat'?'&chat_view=1':'';
      const response = await fetch('/api/dashboard?trace_view=1'+chatQuery,{headers:{Authorization:`Bearer ${token}`},cache:'no-store',signal:requestController.signal});
      if (current!==generation) return;
      if (!response.ok) {
        if (response.status===401) {
          saveToken(''); state.data=null; resetWorkspace();
          throw new Error('管理凭证无效，请重新输入 Dashboard Token。');
        }
        throw new Error(response.status===503?'请先配置 dashboard_token 或 CHATHUB_DASHBOARD_TOKEN。':`请求失败（${response.status}）`);
      }
      const snapshot = await response.json();
      if (current!==generation) return;
      state.data=snapshot; state.stale=false; state.error=''; $('#auth-error').textContent='';
      saveToken(token); // Store only after successful server-side verification.
      if (!wasAuthenticated) setView(routeView(),{history:'replace',animate:false});
    } catch (error) {
      if (current!==generation) return;
      state.error=error.name==='AbortError'?'请求超时，请检查连接。':error.message;
      state.stale=!!state.data;
      $('#auth-error').textContent=state.error;
    } finally {
      clearTimeout(timeout);
      if (current===generation) {
        state.loading=false; controller=null; render();
        if (state.settingsDraft?.dirty && state.settingsDraft.status==='pending' && !settingsSaveTimer) queueSettingsSave();
        if (!wasAuthenticated && state.data) $('#main').focus({preventScroll:true});
        else if (!state.data) $('#token').focus({preventScroll:true});
      }
    }
  }
  function resetWorkspace() {
    chatWorkspace?.unmount();chatWorkspace=null;
    topologyState.cleanup?.();topologyState.cleanup=null;
    topologyState.positions.clear();topologyState.nodes=[];topologyState.edges=[];topologyState.initialized=false;topologyState.signature='';
    $('#view-content').dataset.view='';
    closeOnebotDialog({restoreFocus:false});
    state.view='overview';state.paused=false;state.selectedGroup=null;
    state.messageFilter='all';state.messageSearch='';state.groupFilter='all';state.nodeSearch='';
    state.selectedMessage=null;state.messageReturnFocus='';
    traceController?.abort();traceController=null;state.selectedTrace=null;
    nativeConnection=null;nativeRequested=false;
    state.logSearch='';state.logOrigin='all';state.logGroupFilter='all';
    state.selectedPlugin='onebot';
    state.pluginDialogOpen=false;state.pluginReturnFocus='';
    adapterController?.abort();adapterController=null;state.adapterBusy=false;state.adapterError='';state.adapterNotice='';
    pluginController?.abort();pluginController=null;state.pluginBusy=null;state.pluginError='';state.pluginErrorId='';
    configController?.abort();configController=null;state.configBusy=null;state.configDrafts=Object.create(null);
    settingsController?.abort();settingsController=null;state.settingsBusy=false;state.settingsDraft=null;
    clearTimeout(settingsSaveTimer);settingsSaveTimer=null;
    state.adapterDraft={name:'',address:'',group_id:'',access_token:''};
    stopEntryAnimations();
    $('#sidebar').classList.remove('open');$('#menu-toggle').setAttribute('aria-expanded','false');
  }
  function disconnect() {
    cancelRequest(); saveToken('');state.data=null;state.stale=false;state.error='';resetWorkspace();
    $('#token').value='';$('#auth-error').textContent='';render();$('#token').focus();
  }
  $('#login-form').addEventListener('submit',event=>{
    event.preventDefault();
    const value = $('#token').value.trim();
    if (!value) { $('#auth-error').textContent='请输入 Dashboard Token。'; return; }
    cancelRequest();token=value;$('#token').value='';refresh();
  });
  $('#logout').addEventListener('click',()=>{disconnect();toast('已退出当前控制台会话');});
  $('#theme-toggle').addEventListener('click',toggleTheme);
  $('#theme-toggle-login').addEventListener('click',toggleTheme);
  $('#refresh').addEventListener('click',refresh);
  $('#pause').addEventListener('click',()=>{state.paused=!state.paused;render();if(!state.paused)refresh();});
  $('#help').addEventListener('click',()=>setView('guide'));
  $('#menu-toggle').addEventListener('click',()=>{$('#sidebar').classList.toggle('open');$('#menu-toggle').setAttribute('aria-expanded',String($('#sidebar').classList.contains('open')));});
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape'){$('#sidebar').classList.remove('open');$('#menu-toggle').setAttribute('aria-expanded','false');}
    if (event.target instanceof Element && (event.key==='Enter' || event.key===' ')) {
      const gateway=event.target.closest('[data-onebot-connection][role="button"]');
      if (gateway) {event.preventDefault();openOnebotDialog(gateway);return;}
      const message=event.target.closest('[data-message]');
      if (message && message.tagName!=='BUTTON') {event.preventDefault();openMessageDialog(message.dataset.message,message.dataset.step);}
    }
  });
  document.addEventListener('click',async event=>{
    if (!(event.target instanceof Element)) return;
    const topologyAction=event.target.closest('[data-topology-action]');
    if (topologyAction && state.data && state.view==='overview' && !topologyState.pointers.size) {
      const action=topologyAction.dataset.topologyAction, camera=topologyState.camera;
      if (action==='reset') {
        cancelTopologyAnimation();topologyState.positions.clear();topologyState.signature='';syncTopology();fitTopology();
      } else if (action==='fit') fitTopology();
      else {const rect=$('#topology-canvas').getBoundingClientRect();zoomTopology((topologyState.animation?.target || camera).scale*(action==='out'?1/1.2:1.2),rect.width/2,rect.height/2);}
      return;
    }
    const gateway=event.target.closest('[data-onebot-connection]');
    if (gateway) {openOnebotDialog(gateway);return;}
    if (event.target.closest('#onebot-connection-close')) {closeOnebotDialog();return;}
    if (event.target.closest('#onebot-connection-retry')) {openOnebotDialog();return;}
    if (event.target.closest('#onebot-token-reveal') && onebotConnection) {
      const input=$('#onebot-token'), reveal=$('#onebot-token-reveal'), visible=input.type==='password';
      input.type=visible?'text':'password';reveal.textContent=visible?'隐藏':'显示';reveal.setAttribute('aria-pressed',String(visible));return;
    }
    if (event.target.closest('#onebot-token-copy') && onebotConnection) {
      try {await navigator.clipboard.writeText(onebotConnection.access_token);toast('OneBot Token 已复制');}
      catch {toast('无法访问剪贴板，请点击“显示”后手动复制 Token 和地址');}
      return;
    }
    const message = event.target.closest('[data-message]');
    if (message) {openMessageDialog(message.dataset.message,message.dataset.step);return;}
    if (event.target.closest('#message-dialog-close')) {closeMessageDialog();return;}
    if (event.target.closest('#message-data-copy')) {
      if (state.selectedMessage===null) return;
      if (state.selectedTrace && (!state.selectedTrace.loaded || state.selectedTrace.node.payload===undefined)) return;
      try {await navigator.clipboard.writeText(state.selectedMessage);toast('消息 JSON 已复制');}
      catch {toast('无法访问剪贴板，请手动选择并复制 JSON');}
      return;
    }
    const resetConfig=event.target.closest('[data-reset-config]');
    if (resetConfig && !state.configBusy) {delete state.configDrafts[resetConfig.dataset.resetConfig];renderContent();return;}
    const defaultConfig=event.target.closest('[data-default-config]');
    if (defaultConfig && !state.configBusy && !state.stale) {
      const manifest=state.data?.plugins?.find(plugin=>plugin.id===defaultConfig.dataset.defaultConfig);
      if (manifest?.configuration.editable) {
        const draft=configDraft(manifest);
        draft.values=Object.fromEntries(manifest.configuration.fields.map(field=>[field.key,configFormValue(field,field.default)]));
        draft.dirty=true;draft.error='';draft.fieldErrors={};draft.notice='已填入 Schema 默认值，点击保存后生效。';renderContent();
      }
      return;
    }
    const toggle = event.target.closest('[data-toggle-plugin]');
    if (toggle) {togglePlugin(toggle.dataset.togglePlugin);return;}
    const plugin = event.target.closest('[data-plugin]');
    if (plugin) {
      if (!state.data || !pluginCatalog().some(entry=>entry.id===plugin.dataset.plugin)) return;
      if (state.selectedPlugin !== plugin.dataset.plugin) state.adapterDraft.access_token = '';
      state.selectedPlugin = plugin.dataset.plugin;
      state.pluginDialogOpen = true;
      state.pluginReturnFocus = plugin.id;
      renderContent();
      return;
    }
    if (event.target.closest('#plugin-dialog-close')) {closePluginDialog();return;}
    const view = event.target.closest('[data-view]');
    if(view && view!==$('#view-content')){
      // Keep real links useful for new tabs, copying URLs and native navigation.
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || (event.button!==undefined && event.button!==0)) return;
      if (!state.data || !Object.hasOwn(routes,view.dataset.view)) return;
      event.preventDefault();setView(view.dataset.view);return;
    }
    const removeAdapter = event.target.closest('[data-remove-adapter]');
    if (removeAdapter) {if(window.confirm('移除此 OneBot 群客户端？这会断开连接并删除保存的配置。'))manageAdapter('DELETE','/api/plugins/onebot/clients/'+encodeURIComponent(removeAdapter.dataset.removeAdapter));return;}
    const group = event.target.closest('[data-group]'); if(group){state.selectedGroup=Number(group.dataset.group);setView('nodes');animateEntry($('.detail-panel'),'detail');$('.detail-panel')?.scrollIntoView({block:'nearest'});return;}
    if(event.target.closest('#close-detail')){state.selectedGroup=null;renderContent();return;}
    const filter = event.target.closest('[data-filter]');if(filter){state.messageFilter=filter.dataset.filter;renderContent();return;}
    const logOrigin = event.target.closest('[data-log-origin]');if(logOrigin){state.logOrigin=logOrigin.dataset.logOrigin;renderContent();return;}
    const copy = event.target.closest('[data-copy]');if(copy){try{await navigator.clipboard.writeText(copy.dataset.copy);toast(onebotDialogOpen?'连接地址已复制':state.pluginDialogOpen?'配置已复制':'配置已复制，请替换占位密码');}catch{toast('无法访问剪贴板，请手动复制配置');}}
    if(!event.target.closest('#sidebar')&&!event.target.closest('#menu-toggle')){$('#sidebar').classList.remove('open');$('#menu-toggle').setAttribute('aria-expanded','false');}
  });
  for (const [selector,close] of [
    ['#plugin-settings-dialog',closePluginDialog],
    ['#message-data-dialog',closeMessageDialog],
    ['#onebot-connection-dialog',closeOnebotDialog],
  ]) {
    const dialog=$(selector);
    let backdropPress=false;
    const isBackdrop=event=>{
      if (event.target!==dialog) return false;
      const rect=dialog.getBoundingClientRect();
      return event.clientX<rect.left || event.clientX>rect.right || event.clientY<rect.top || event.clientY>rect.bottom;
    };
    dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
    dialog.addEventListener('pointerdown',event=>{backdropPress=event.button===0 && isBackdrop(event);});
    dialog.addEventListener('pointercancel',()=>{backdropPress=false;});
    dialog.addEventListener('click',event=>{
      if (backdropPress && isBackdrop(event)) close();
      backdropPress=false;
    });
  }
  document.addEventListener('input',event=>{
    if (event.target.id==='settings-public-url') {
      editSettings(event.target,event.isComposing || state.settingsDraft?.composing);
      return;
    }
    if (updateConfigDraft(event.target,!event.isComposing)) return;
    const draftFields = {'adapter-name':'name','adapter-address':'address','adapter-group':'group_id','adapter-token':'access_token'};
    if (draftFields[event.target.id]) state.adapterDraft[draftFields[event.target.id]] = event.target.value;
    if(event.target.id==='message-search'){state.messageSearch=event.target.value;renderContent();}
    if(event.target.id==='node-search'){state.nodeSearch=event.target.value;renderContent();}
    if(event.target.id==='log-search'){state.logSearch=event.target.value;renderContent();}
  });
  document.addEventListener('compositionstart',event=>{
    if (event.target.id==='settings-public-url' && state.settingsDraft) {
      state.settingsDraft.composing=true;clearTimeout(settingsSaveTimer);settingsSaveTimer=null;
    }
  });
  document.addEventListener('compositionend',event=>{
    if (event.target.id==='settings-public-url') {editSettings(event.target);return;}
    updateConfigDraft(event.target);
  });
  document.addEventListener('focusout',event=>{if(event.target.id==='settings-public-url')saveSettings();});
  document.addEventListener('submit',event=>{
    if (event.target.id==='platform-settings-form') {event.preventDefault();saveSettings();return;}
    if (event.target.id==='plugin-config-form') {event.preventDefault();savePluginConfiguration(event.target.dataset.pluginConfig);return;}
    if (event.target.id !== 'onebot-client-form') return;
    event.preventDefault();
    const draft = state.adapterDraft;
    manageAdapter('POST','/api/plugins/onebot/clients',{address:draft.address.trim(),group_id:draft.group_id.trim(),
      access_token:draft.access_token,...(draft.name.trim()?{name:draft.name.trim()}:{})});
  });
  document.addEventListener('change',event=>{
    if (updateConfigDraft(event.target)) return;
    if(event.target.id==='group-filter'){state.groupFilter=event.target.value;renderContent();}
    if(event.target.id==='log-group-filter'){state.logGroupFilter=event.target.value;renderContent();}
  });
  setInterval(()=>{if(state.data&&!state.paused&&!document.hidden)refresh();},5000);
  document.addEventListener('visibilitychange',()=>{if(state.data&&!document.hidden&&!state.paused)refresh();});
  window.addEventListener('popstate',()=>{if(state.data)setView(routeView(),{history:'none'});});
  render();if(token)refresh();
})();
