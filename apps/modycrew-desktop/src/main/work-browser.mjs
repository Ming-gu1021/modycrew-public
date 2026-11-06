import { createHash, randomUUID } from 'node:crypto';

export function workBrowserPartition(scope) {
  if (!scope) return `mody-work-${randomUUID()}`;
  if (typeof scope !== 'string' || !/^personal:[A-Za-z0-9_-]{1,128}$/.test(scope)) throw new Error('브라우저 계정을 다시 확인해 주세요.');
  return `persist:mody-work-${createHash('sha256').update(scope).digest('hex').slice(0, 32)}`;
}

export function workBrowserUrl(value) {
  const raw = String(value ?? '').trim();
  const url = new URL(/^[a-z][a-z\d+.-]*:/i.test(raw) ? raw : `https://${raw}`);
  if (!['https:', 'http:'].includes(url.protocol) || !url.hostname || url.username || url.password) throw new Error('http 또는 https 웹 주소를 입력해 주세요.');
  return url.href;
}

export function clampBrowserBounds(bounds, size, zoom = 1) {
  if (!bounds || !Number.isFinite(zoom) || zoom <= 0) return null;
  const values = ['x', 'y', 'width', 'height'].map(key => Number(bounds[key]) * zoom);
  if (!values.every(Number.isFinite)) return null;
  const [x, y, width, height] = values.map(Math.round);
  if (x < 0 || y < 0 || width < 100 || height < 100) return null;
  const clipped = { x, y, width: Math.min(width, size[0] - x), height: Math.min(height, size[1] - y) };
  return clipped.width >= 100 && clipped.height >= 100 ? clipped : null;
}

// This code runs in an isolated world, without preload, Node, cookies or input values.
const snapshotScript = `(() => {
  const visible = el => { const r=el.getBoundingClientRect(); const s=getComputedStyle(el); return r.width>0 && r.height>0 && s.visibility!=='hidden' && s.display!=='none'; };
  if (/\\b(login|signin|oauth|authorize|checkout|payment)\\b/i.test(location.pathname) || [...new URLSearchParams(location.search).keys()].some(key=>/^(code|access_token|id_token|password|secret)$/i.test(key)) || [...document.querySelectorAll('input[type=password]')].some(visible)) throw new Error('로그인·결제 화면은 직접 진행해 주세요.');
  const label = el => (el.getAttribute('aria-label') || (el.labels && [...el.labels].map(x=>x.innerText).join(' ')) || el.innerText || el.getAttribute('placeholder') || el.getAttribute('title') || '').replace(/\\s+/g,' ').trim().slice(0,160);
  const allowed = el => !el.disabled && !/password|hidden|file/i.test(el.type||'') && !/password|secret|token|otp|one-time|card|cvc|비밀번호|인증번호/i.test([el.name,el.id,el.autocomplete,label(el)].join(' '));
  const nodes = [...document.querySelectorAll('a[href],button,input,textarea,select,[role=button]')].filter(el=>visible(el)&&allowed(el)).slice(0,100);
  const token = crypto.randomUUID();
  globalThis.__modyWorkSnapshot = {token, url:location.href, nodes, labels:nodes.map(label)};
  const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);let text='',node;
  while((node=walker.nextNode()) && text.length<14000) { const parent=node.parentElement;if(parent && visible(parent) && !parent.closest('script,style,noscript,input,textarea,select,[hidden],[aria-hidden=true]')) text+=node.textContent.trim()+' '; }
  globalThis.__modyWorkSnapshot.fingerprints=nodes.map(el=>[el.tagName,el.type,el.getAttribute('href'),el.getAttribute('formaction'),label(el)].join('|'));
  return {token, url:location.href, title:document.title, text:text.slice(0,14000), elements:nodes.map((el,i)=>({id:String(i),tag:el.tagName.toLowerCase(),type:el.type||'',label:label(el)}))};
})()`;

export function createWorkBrowser({ BrowserWindow, WebContentsView, dialog, managedContents, trustedOrigin }) {
  const entries = new Map();
  const isTrusted = event => {
    if (!event?.sender || managedContents.has(event.sender)) return false;
    const frame = event.senderFrame;
    if (frame && frame !== event.sender.mainFrame) return false;
    try {
      const url = new URL(event.sender.getURL());
      return trustedOrigin(url) && !/^\/(account|setup|welcome|mail-share|legal|privacy|terms)(\/|$)/.test(url.pathname);
    } catch { return false; }
  };
  const state = entry => {
    if(entry?.view.webContents.isDestroyed?.()) entry=undefined;
    return { available: true, url: entry?.view.webContents.getURL() || '', title: entry?.view.webContents.getTitle() || '', loading: entry?.view.webContents.isLoading() || false, canGoBack: entry?.view.webContents.navigationHistory.canGoBack() || false, canGoForward: entry?.view.webContents.navigationHistory.canGoForward() || false, notice: entry?.notice || '', persistent: Boolean(entry?.scope) };
  };
  function detach(entry) { entry.view.setVisible(false); entry.visible = false; }
  function destroy(id) {
    const entry = entries.get(id); if (!entry) return;
    entries.delete(id); clearInterval(entry.lease);
    entry.owner.removeListener('did-start-navigation', entry.onNavigate);
    entry.owner.removeListener('did-navigate-in-page', entry.onRoute);
    entry.owner.removeListener('destroyed', entry.onDestroyed);
    entry.win.removeListener('resize', entry.onResize);
    entry.view.webContents.session.removeListener('will-download', entry.onDownload);
    for (const popup of entry.popups) if (!popup.isDestroyed()) popup.destroy();
    if (!entry.win.isDestroyed()) entry.win.contentView.removeChildView(entry.view);
    if (!entry.view.webContents.isDestroyed()) entry.view.webContents.close();
    managedContents.delete(entry.view.webContents);
  }
  function create(event, scope) {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) throw new Error('앱 창을 찾을 수 없습니다.');
    const partition = workBrowserPartition(scope);
    const webPreferences = { sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, partition };
    const view = new WebContentsView({ webPreferences });
    managedContents.add(view.webContents);
    const entry = { win, view, owner: event.sender, scope: scope || '', popups: new Set(), notice: '', lastBounds: 0, visible: false, busy: false };
    entries.set(event.sender.id, entry);
    win.contentView.addChildView(view); view.setVisible(false);
    const wc = view.webContents;
    wc.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    wc.session.setPermissionCheckHandler(() => false);
    entry.onDownload = (_event, item) => {
      // Electron presents its native Save dialog; never pick a path or overwrite silently.
      item.setSaveDialogOptions({ title: '업무 자료 저장', buttonLabel: '저장' });
      item.once('done', (_event, result) => { entry.notice = result === 'completed' ? `자료를 저장했습니다: ${item.getFilename()}` : result === 'cancelled' ? '자료 저장을 취소했습니다.' : '자료를 저장하지 못했습니다. 다시 다운로드해 주세요.'; });
    };
    wc.session.on('will-download', entry.onDownload);
    const navigationGuard = (event, url) => { try { workBrowserUrl(url); } catch { event.preventDefault(); entry.notice = '이 주소는 업무 브라우저에서 열 수 없습니다.'; } };
    wc.on('will-navigate', navigationGuard); wc.on('will-redirect', navigationGuard);
    wc.setWindowOpenHandler(({ url }) => {
      try { workBrowserUrl(url); } catch { entry.notice = '지원하지 않는 새 창입니다.'; return { action: 'deny' }; }
      return { action: 'allow', overrideBrowserWindowOptions: { parent: win, width: 1000, height: 760, autoHideMenuBar: true, webPreferences: { ...webPreferences, preload: undefined } } };
    });
    wc.on('did-create-window', popup => {
      entry.popups.add(popup); managedContents.add(popup.webContents);
      popup.webContents.on('will-navigate', navigationGuard); popup.webContents.on('will-redirect', navigationGuard);
      popup.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      popup.on('closed', () => { entry.popups.delete(popup); });
    });
    wc.on('did-fail-load', (_event, code, _description, _url, mainFrame) => { if (mainFrame && code !== -3) entry.notice = '페이지를 열지 못했습니다. 주소와 인터넷 연결을 확인해 주세요.'; });
    entry.onNavigate = (_e, _url, inPlace, mainFrame) => { if (mainFrame && !inPlace) destroy(event.sender.id); };
    entry.onRoute = () => { if (!isTrusted({sender:entry.owner})) destroy(event.sender.id); };
    entry.onDestroyed = () => destroy(event.sender.id);
    entry.onResize = () => detach(entry);
    event.sender.on('did-start-navigation', entry.onNavigate);
    event.sender.on('did-navigate-in-page', entry.onRoute);
    event.sender.once('destroyed', entry.onDestroyed);
    win.on('resize', entry.onResize);
    entry.lease = setInterval(() => { if (entry.visible && (Date.now()-entry.lastBounds > 2500 || !isTrusted({sender:entry.owner}))) detach(entry); }, 1000);
    entry.lease.unref?.();
    return entry;
  }
  async function handle(event, payload = {}) {
    if (!isTrusted(event)) throw new Error('앱의 업무 화면에서만 사용할 수 있습니다.');
    let entry = entries.get(event.sender.id);
    if (payload.scope !== undefined && entry && entry.scope !== payload.scope) {
      destroy(event.sender.id); entry = undefined;
    }
    if (payload.kind === 'close') { destroy(event.sender.id); return state(); }
    if (payload.kind === 'hide') { if (entry) detach(entry); return state(entry); }
    if (payload.kind === 'state') return state(entry);
    if (!entry && payload.kind !== 'open') throw new Error('먼저 웹 페이지를 열어 주세요.');
    if (payload.kind === 'open') {
      const url = workBrowserUrl(payload.url);
      entry ??= create(event, payload.scope); entry.notice = '';
      try { await entry.view.webContents.loadURL(url); }
      catch { entry.notice = '페이지를 열지 못했습니다. 주소와 인터넷 연결을 확인해 주세요.'; }
      return state(entry);
    }
    const wc = entry.view.webContents;
    if (payload.kind === 'bounds') {
      const bounds = clampBrowserBounds(payload.bounds, entry.win.getContentSize(), event.sender.getZoomFactor());
      if (!bounds || payload.visible !== true || entry.busy) detach(entry);
      else { entry.lastBounds=Date.now(); entry.view.setBounds(bounds); entry.view.setVisible(true); entry.visible=true; }
    } else if (payload.kind === 'back') { if(wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack(); }
    else if (payload.kind === 'forward') { if(wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward(); }
    else if (payload.kind === 'reload') wc.reload();
    else if (payload.kind === 'snapshot') {
      const snapshot=await wc.executeJavaScriptInIsolatedWorld(999, [{ code: snapshotScript }]);
      if(entries.get(event.sender.id)!==entry) throw new Error('브라우저가 닫혔습니다. 페이지를 다시 열어 주세요.');
      return { ...state(entry), snapshot };
    }
    else if (payload.kind === 'apply') {
      if (entry.busy) throw new Error('이전 작업을 확인 중입니다.');
      const action = payload.action;
      if (!action || !['click','fill','scroll'].includes(action.kind)) throw new Error('지원하지 않는 동작입니다.');
      const before = await wc.executeJavaScriptInIsolatedWorld(999, [{code: 'globalThis.__modyWorkSnapshot && ({token:__modyWorkSnapshot.token,url:__modyWorkSnapshot.url,labels:__modyWorkSnapshot.labels})'}]);
      if (!before || before.token !== payload.token || before.url !== wc.getURL()) throw new Error('페이지가 바뀌었습니다. 다시 읽어 주세요.');
      const id = Number(action.elementId);
      if (action.kind !== 'scroll' && (!Number.isInteger(id) || !before.labels[id])) throw new Error('화면 요소를 다시 확인해 주세요.');
      const text = String(action.text || '').slice(0,2000);
      entry.busy=true; detach(entry);
      try {
        const approval = await dialog.showMessageBox(entry.win, { type:'question', title:'브라우저 작업 확인', message: action.kind==='fill' ? '이 내용을 입력할까요?' : action.kind==='scroll' ? '페이지를 아래로 스크롤할까요?' : '이 항목을 누를까요?', detail: `${new URL(before.url).origin}\n${before.labels[id] || ''}${action.kind==='fill' ? '\n\n'+text : ''}\n\n발송·등록·결제 버튼이면 실제로 실행될 수 있습니다.`, buttons:['취소','이번 작업 실행'], defaultId:0, cancelId:0 });
        if (approval.response !== 1) return { ...state(entry), notice:'작업을 취소했습니다.' };
        if (entries.get(event.sender.id)!==entry || !isTrusted(event) || wc.getURL() !== before.url) throw new Error('페이지가 바뀌어 작업을 중단했습니다.');
        const input = JSON.stringify({token:before.token,url:before.url,id,kind:action.kind,text,label:before.labels[id]});
        await wc.executeJavaScriptInIsolatedWorld(999, [{code: `(() => { const a=${input}; const s=globalThis.__modyWorkSnapshot;
          if(!s || s.token!==a.token || location.href!==a.url) throw new Error('페이지를 다시 읽어 주세요.');
          if(a.kind==='scroll') { window.scrollBy({top:innerHeight*0.7,behavior:'instant'}); delete globalThis.__modyWorkSnapshot; return; }
          const el=s.nodes[a.id]; if(!el?.isConnected || el.disabled) throw new Error('대상 요소가 바뀌었습니다.');
          const label=(el.getAttribute('aria-label') || (el.labels && [...el.labels].map(x=>x.innerText).join(' ')) || el.innerText || el.getAttribute('placeholder') || el.getAttribute('title') || '').replace(/\\s+/g,' ').trim().slice(0,160);
          if(s.fingerprints[a.id]!==[el.tagName,el.type,el.getAttribute('href'),el.getAttribute('formaction'),label].join('|') || !el.getBoundingClientRect().width) throw new Error('대상 요소가 바뀌었습니다.');
          if(/password|hidden|file/i.test(el.type||'') || /password|secret|token|otp|one-time|card|cvc|비밀번호|인증번호/i.test([el.name,el.id,el.autocomplete,label].join(' '))) throw new Error('직접 입력해 주세요.');
          if(a.kind==='fill') { if(!['INPUT','TEXTAREA'].includes(el.tagName)) throw new Error('입력 칸이 아닙니다.'); const proto=el.tagName==='INPUT'?HTMLInputElement.prototype:HTMLTextAreaElement.prototype; Object.getOwnPropertyDescriptor(proto,'value').set.call(el,a.text); el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); }
          else el.click(); delete globalThis.__modyWorkSnapshot;
        })()`}]);
        return { ...state(entry), notice:'작업을 실행했습니다. 변경된 화면을 확인해 주세요.' };
      } finally { entry.busy=false; }
    }
    return state(entry);
  }
  return { handle, isTrusted, dispose: () => [...entries.keys()].forEach(destroy) };
}
