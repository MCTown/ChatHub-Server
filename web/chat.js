/* QQNT-inspired virtual group chat workspace. Kept separate from the
 * observability dashboard so the existing pages remain intentionally read-only. */
(() => {
  'use strict';

  const ChatHubChat = {mount};
  window.ChatHubChat = ChatHubChat;

  function mount(container, options) {
    let selected = null;
    let filter = '';
    let draft = '';
    let image = null;
    let busy = false;
    let composing = false;
    let mobileListOpen = false;
    let destroyed = false;
    let sendController = null;
    let messageSignature = '';
    let groupSignature = '';
    const drafts = new Map();
    let imageReadVersion = 0;

    const state = {data: null, stale: false, error: '', paused: false};
    const safe = value => options.escape(value);
    const text = message => (message?.segments || []).map(segment => {
      if (segment.type === 'text') return String(segment.text || '');
      if (segment.type === 'image') return '[图片]';
      return `@${segment.userId}`;
    }).join('');
    const avatar = (name, group = false) =>
      `<span class="qq-avatar ${group ? 'qq-group-avatar' : ''}">${safe(String(name || '?').slice(0, 1).toUpperCase())}</span>`;
    const validImage = url => {
      try {
        const parsed = new URL(url, location.href);
        return parsed.origin === location.origin && !parsed.username && !parsed.password && parsed.pathname.startsWith('/media/images/');
      } catch { return false; }
    };
    const groups = () => (state.data?.groups || []).filter(group =>
      !filter || `${group.name} ${group.id}`.toLowerCase().includes(filter.toLowerCase()));
    const allMessages = () => state.data?.messages || [];
    const current = () => {
      const list = state.data?.groups || [];
      return list.find(group => group.id === selected) || list[0] || null;
    };
    const groupMessages = group => group ? allMessages().filter(message => message.groupId === group.id) : [];
    const time = seconds => new Date(seconds * 1000).toLocaleTimeString('zh-CN', {
      hour12: false, hour: '2-digit', minute: '2-digit'
    });

    function messageHtml(message) {
      const mine = message.authorId === 1 || message.origin === 'application' || message.origin === 'plugin';
      const content = (message.segments || []).map(segment => {
        if (segment.type === 'image') return validImage(segment.url)
          ? `<a class="qq-image-link" href="${safe(segment.url)}" target="_blank" rel="noreferrer"><img class="qq-message-image" src="${safe(segment.url)}" alt="聊天图片" loading="lazy"></a>`
          : '<span class="qq-unsupported-image">[图片]</span>';
        if (segment.type === 'mention') return `<span class="qq-mention">@${safe(segment.userId)}</span>`;
        return safe(String(segment.text || '')).replace(/\n/g, '<br>');
      }).join('');
      return `<article class="qq-message ${mine ? 'qq-message-mine' : ''}">${avatar(message.authorName)}<div class="qq-message-body"><div class="qq-message-meta"><strong>${safe(message.authorName)}</strong><time>${time(message.time)}</time></div><div class="qq-bubble">${content}</div></div></article>`;
    }

    function shell() {
      container.innerHTML = `<div class="qq-shell">
        <aside class="qq-rail" aria-label="群聊导航">
          <div class="qq-user-avatar">A<span></span></div>
          <button class="qq-rail-button active" type="button" aria-label="群聊">●</button>
          <button class="qq-rail-button" type="button" data-qq-placeholder="联系人" aria-label="联系人">♙</button>
          <button class="qq-rail-button" type="button" data-qq-placeholder="收藏" aria-label="收藏">☆</button>
          <div class="qq-rail-spacer"></div>
          <button class="qq-rail-button" type="button" data-qq-theme aria-label="切换主题">☼</button>
          <button class="qq-rail-button" type="button" data-qq-logout aria-label="退出">↪</button>
        </aside>
        <aside class="qq-conversations" aria-label="群聊列表">
          <div class="qq-conversation-top"><strong>群聊</strong><button type="button" data-qq-new aria-label="新建群聊" title="虚拟群由已接入客户端提供">＋</button></div>
          <label class="qq-search"><span aria-hidden="true">⌕</span><input data-qq-filter value="" placeholder="搜索群聊" aria-label="搜索群聊"></label>
          <div class="qq-group-list" data-qq-groups></div>
        </aside>
        <main class="qq-chat-main" aria-label="群聊窗口">
          <header class="qq-chat-header" data-qq-header></header>
          <div class="qq-stale" data-qq-stale hidden></div>
          <section class="qq-message-list" data-qq-messages aria-live="polite"></section>
          <form class="qq-composer" data-qq-form>
            <div class="qq-composer-tools"><label class="qq-tool" title="发送图片"><input type="file" accept="image/png,image/jpeg,image/gif,image/webp" data-qq-image hidden>▧</label><button class="qq-tool" type="button" data-qq-clear title="清空输入">⌫</button><span class="qq-image-name" data-qq-image-name></span></div>
            <div class="qq-image-preview" data-qq-preview hidden></div>
            <textarea data-qq-text placeholder="输入消息，Enter 发送 · Shift+Enter 换行" aria-label="消息内容"></textarea>
            <div class="qq-composer-bottom"><span data-qq-status>消息会以 ChatHub 虚拟账号发送</span><button class="qq-send" type="submit">发送 <span>⌄</span></button></div>
          </form>
        </main>
        <aside class="qq-members" data-qq-members aria-label="群成员"></aside>
      </div>`;
    }

    function ensureSelection() {
      const list = state.data?.groups || [];
      for (const id of drafts.keys()) if (!list.some(group => group.id === id)) drafts.delete(id);
      if (!list.some(group => group.id === selected)) {
        selected = list[0]?.id ?? null;
        draft = drafts.get(selected)?.text || '';
        clearImage();
        image = drafts.get(selected)?.image || null;
        const field = container.querySelector('[data-qq-text]');
        if (field) field.value = draft;
        messageSignature = ''; groupSignature = '';
      }
      if (!current()) mobileListOpen = true;
    }

    function renderGroups() {
      const list = container.querySelector('[data-qq-groups]');
      if (!list) return;
      const rows = groups();
      list.innerHTML = rows.length ? rows.map(group => {
        const last = allMessages().find(message => message.groupId === group.id);
        return `<button type="button" class="qq-group-row ${group.id === selected ? 'selected' : ''}" data-qq-group="${safe(group.id)}" aria-current="${group.id === selected ? 'true' : 'false'}" ${busy ? 'disabled' : ''}>${avatar(group.name, true)}<span class="qq-group-copy"><strong>${safe(group.name)}</strong><small>${safe(last ? text(last) : `${group.members.length} 位成员`)}</small></span><time>${last ? time(last.time) : ''}</time></button>`;
      }).join('') : '<div class="qq-empty">暂无已连接的虚拟群聊<br><small>接入 Minecraft 或 OneBot 客户端后显示</small></div>';
      const input = container.querySelector('[data-qq-filter]');
      if (input && document.activeElement !== input && input.value !== filter) input.value = filter;
    }

    function renderHeader(group) {
      const header = container.querySelector('[data-qq-header]');
      if (!header) return;
      header.innerHTML = group ? `<button class="qq-mobile-back" type="button" data-qq-mobile-list aria-label="返回群聊列表">‹ <span>群聊</span></button><div class="qq-chat-title"><h1>${safe(group.name)}</h1><span>${group.members.length} 位成员 · ${group.kind === 'onebot' ? 'OneBot 群' : 'Minecraft 世界'}</span></div><div class="qq-header-actions"><button type="button" data-qq-placeholder="搜索消息" aria-label="搜索消息">⌕</button><button type="button" data-qq-placeholder="群设置" aria-label="群设置">⋯</button></div>` : '<div class="qq-no-group-title">选择一个群聊开始对话</div>';
    }

    function renderMessages(group, force = false) {
      const list = container.querySelector('[data-qq-messages]');
      if (!list) return;
      const messages = groupMessages(group);
      const signature = `${group?.id ?? ''}:${messages.map(message => `${message.id}:${message.time}`).join(',')}`;
      if (!force && signature === messageSignature) return;
      const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 32 || !messageSignature;
      const previousTop = list.scrollTop;
      messageSignature = signature;
      list.innerHTML = messages.length ? [...messages].reverse().map(messageHtml).join('') : '<div class="qq-chat-empty"><b>还没有消息</b><span>在下方输入内容，开始和这个虚拟群聊对话</span></div>';
      if (atBottom) list.scrollTop = list.scrollHeight;
      else list.scrollTop = previousTop;
    }

    function renderMembers(group) {
      const members = container.querySelector('[data-qq-members]');
      if (!members) return;
      const signature = group ? `${group.id}:${group.members.map(member => `${member.userId}:${member.online}`).join(',')}` : '';
      if (signature === groupSignature) return;
      groupSignature = signature;
      members.innerHTML = group ? `<div class="qq-members-title"><strong>群成员</strong><span>${group.members.length}</span></div><div class="qq-member-list">${group.members.map(member => `<div class="qq-member">${avatar(member.name)}<span><strong>${safe(member.name)}</strong><small>${member.online ? '在线' : '离线'}</small></span></div>`).join('')}</div>` : '';
    }

    function renderComposer(group) {
      const form = container.querySelector('[data-qq-form]');
      const field = container.querySelector('[data-qq-text]');
      const button = container.querySelector('.qq-send');
      const status = container.querySelector('[data-qq-status]');
      if (!form || !field || !button || !status) return;
      form.hidden = !group;
      if (!group) return;
      if (document.activeElement !== field && field.value !== draft) field.value = draft;
      field.disabled = busy;
      button.disabled = busy || state.stale;
      status.textContent = busy ? '正在发送…' : state.stale ? '连接中断，暂时无法发送' : image ? '图片已选择，服务端将进行安全校验' : '消息会以 ChatHub 虚拟账号发送';
      const name = container.querySelector('[data-qq-image-name]');
      if (name) name.textContent = image?.name || '';
      const preview = container.querySelector('[data-qq-preview]');
      if (preview) {
        preview.hidden = !image;
        preview.innerHTML = image ? `<img src="${safe(image.preview)}" alt="待发送图片预览"><button type="button" data-qq-remove-image aria-label="移除图片">×</button>` : '';
      }
    }

    function render({forceMessages = false} = {}) {
      if (destroyed) return;
      ensureSelection();
      const group = current();
      const shellElement = container.querySelector('.qq-shell');
      shellElement?.classList.toggle('qq-mobile-list', mobileListOpen);
      renderGroups(); renderHeader(group); renderMessages(group, forceMessages); renderMembers(group); renderComposer(group);
      const stale = container.querySelector('[data-qq-stale]');
      if (stale) { stale.hidden = !state.stale; stale.textContent = state.stale ? `连接暂时中断，以下为过期快照。${state.error || ''}` : ''; }
    }

    function clearImage() {
      imageReadVersion++;
      image = null;
      const input = container.querySelector('[data-qq-image]');
      if (input) input.value = '';
    }

    async function send(event) {
      event.preventDefault();
      const group = current();
      const field = container.querySelector('[data-qq-text]');
      const value = field?.value ?? draft;
      if (busy || state.stale || !group || (!value.trim() && !image)) return;
      const requestGroupId = group.id;
      const requestText = value;
      const requestImage = image?.data;
      busy = true;
      sendController = new AbortController();
      const request = sendController;
      const timeout = setTimeout(() => request.abort(), 15000);
      render();
      try {
        const response = await fetch('/api/chat/messages', {
          method: 'POST',
          headers: {Authorization: `Bearer ${options.token()}`, 'Content-Type': 'application/json'},
          body: JSON.stringify({group_id: requestGroupId, text: requestText, ...(requestImage ? {image: requestImage} : {})}),
          signal: request.signal,
        });
        if (destroyed || request !== sendController) return;
        let result;
        try { result = await response.json(); } catch { result = {}; }
        if (destroyed || request !== sendController) return;
        if (response.status === 401) { options.unauthorized(); return; }
        if (!response.ok) throw new Error(result.error || `消息发送失败（${response.status}）`);
        if (!result.message) throw new Error('服务端未返回已发送消息。');
        options.accepted?.(result.message);
        if (selected === requestGroupId) {
          draft = '';
          clearImage();
          if (field) field.value = '';
        }
        drafts.delete(requestGroupId);
        options.notice('消息已发送');
      } catch (error) {
        if (!destroyed && request === sendController) options.notice(error.name === 'AbortError' ? '发送超时，请检查连接后重试。' : (error.message || '消息发送失败'));
      } finally {
        clearTimeout(timeout);
        if (request === sendController) {
          sendController = null;
          busy = false;
          if (!destroyed) render({forceMessages: true});
        }
      }
    }

    function chooseImage(event) {
      const file = event.target.files?.[0];
      if (!file || busy) return;
      if (file.size > 5 * 1024 * 1024) { options.notice('图片不能超过 5 MiB'); event.target.value = ''; return; }
      const reader = new FileReader();
      const readVersion = ++imageReadVersion;
      const readGroupId = selected;
      reader.onload = () => {
        if (destroyed || busy || readVersion !== imageReadVersion || selected !== readGroupId || !String(reader.result).startsWith('data:')) return;
        const comma = String(reader.result).indexOf(',');
        if (comma < 0) { options.notice('图片读取失败'); return; }
        const encoded = String(reader.result).slice(comma + 1);
        image = {name: file.name, data: `base64://${encoded}`, preview: String(reader.result)};
        render();
      };
      reader.onerror = () => {
        if (!destroyed && readVersion === imageReadVersion) options.notice('图片读取失败，请重试。');
      };
      reader.readAsDataURL(file);
    }

    function click(event) {
      const target = event.target instanceof Element ? event.target : null;
      const groupButton = target?.closest('[data-qq-group]');
      if (groupButton && !busy) {
        drafts.set(selected, {text: draft, image});
        selected = Number(groupButton.dataset.qqGroup);
        draft = drafts.get(selected)?.text || '';
        clearImage(); image = drafts.get(selected)?.image || null;
        const field = container.querySelector('[data-qq-text]');
        if (field) field.value = draft;
        messageSignature = ''; groupSignature = '';
        mobileListOpen = false; render({forceMessages: true}); return;
      }
      if (target?.closest('[data-qq-clear]') && !busy) { draft = ''; clearImage(); const field = container.querySelector('[data-qq-text]'); if (field) field.value = ''; render(); return; }
      if (target?.closest('[data-qq-remove-image]') && !busy) { clearImage(); render(); return; }
      if (target?.closest('[data-qq-mobile-list]')) { mobileListOpen = true; render(); return; }
      if (target?.closest('[data-qq-new]')) { options.notice('群聊由已接入的 Minecraft 或 OneBot 客户端提供，暂不支持在控制台新建。'); return; }
      const placeholder = target?.closest('[data-qq-placeholder]');
      if (placeholder) { options.notice(`${placeholder.dataset.qqPlaceholder}暂未开放。`); return; }
      if (target?.closest('[data-qq-theme]')) { options.theme(event); return; }
      if (target?.closest('[data-qq-logout]')) { options.logout(); }
    }
    function input(event) {
      if (event.target.matches('[data-qq-filter]')) { filter = event.target.value; renderGroups(); }
      else if (event.target.matches('[data-qq-text]')) draft = event.target.value;
    }
    function keydown(event) {
      if (event.target.matches('[data-qq-text]') && event.key === 'Enter' && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey && !event.isComposing && !composing && event.keyCode !== 229) {
        event.preventDefault(); container.querySelector('[data-qq-form]')?.requestSubmit();
      }
    }
    function compositionStart() { composing = true; }
    function compositionEnd() { composing = false; }
    function change(event) { if (event.target.matches('[data-qq-image]')) chooseImage(event); }

    function sync(data, meta = {}) {
      if (destroyed) return;
      state.data = data; state.stale = !!meta.stale; state.error = meta.error || ''; state.paused = !!meta.paused;
      render();
    }

    container.addEventListener('click', click);
    container.addEventListener('input', input);
    container.addEventListener('keydown', keydown);
    container.addEventListener('compositionstart', compositionStart);
    container.addEventListener('compositionend', compositionEnd);
    container.addEventListener('change', change);
    container.addEventListener('submit', send);
    shell();
    render({forceMessages: true});

    return {
      sync,
      unmount() {
        destroyed = true;
        drafts.clear(); draft = ''; image = null; imageReadVersion++;
        sendController?.abort(); sendController = null;
        container.removeEventListener('click', click); container.removeEventListener('input', input);
        container.removeEventListener('keydown', keydown); container.removeEventListener('compositionstart', compositionStart);
        container.removeEventListener('compositionend', compositionEnd); container.removeEventListener('change', change);
        container.removeEventListener('submit', send); container.replaceChildren();
      },
    };
  }
})();
