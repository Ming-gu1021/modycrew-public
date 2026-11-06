'use client';

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import dynamic from 'next/dynamic';
import { WORK_BROWSER_OPEN_EVENT, requestWorkBrowser } from '@/lib/work-browser';
import { WORKSPACE_PANE_OPEN, WORKSPACE_PANE_STATE, WORKSPACE_PANE_CLOSE, type WorkspaceFileTarget } from '@/lib/workspace-side-pane';
import styles from './BrowserWorkspace.module.css';
import { RESULT_PANE_OPEN, RESULT_PANE_CLEAR, resultKey, type SavedResult } from '@/lib/deliverable-changes';

const WorkBrowser = dynamic(() => import('./WorkBrowser').then(module => module.WorkBrowser), { ssr: false });
const WorkspaceFiles = dynamic(() => import('./WorkspaceFiles').then(module => module.WorkspaceFiles), { ssr: false });
const DeliverableInspector = dynamic(() => import('./DeliverableInspector'), { ssr: false });

/** Keep the work subtree mounted, including its unsent message, beside the browser. */
export function BrowserWorkspace({ children, enabled = true }: { children: ReactNode; enabled?: boolean }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'files' | 'browser' | 'results'>('files');
  const [result, setResult] = useState<SavedResult | null>(null);
  const [initialized, setInitialized] = useState({ files: false, browser: false });
  // '웹 페이지' 탭은 링크·AI 작업이 페이지를 열었을 때만 보이고, 사이드 패널을 닫으면 다시 숨는다(상시 브라우저 탭 없음).
  const [browserInUse, setBrowserInUse] = useState(false);
  const [fileTarget, setFileTarget] = useState<WorkspaceFileTarget>();
  const [active, setActive] = useState<'work' | 'browser'>('browser');
  const [width, setWidth] = useState(36);
  const [expanded, setExpanded] = useState(false);
  const [narrow, setNarrow] = useState(false);
  const [target, setTarget] = useState<{ url: string; revision: number }>();
  const [dragging, setDragging] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const query=window.matchMedia('(max-width: 1000px)');
    const sync=()=>setNarrow(query.matches);
    sync(); query.addEventListener('change',sync);
    return ()=>query.removeEventListener('change',sync);
  }, []);
  const showTab = (next: 'files' | 'browser' | 'results') => {
    if(next!=='browser')void requestWorkBrowser({kind:'hide'}).catch(()=>{});
    if(next==='browser')setBrowserInUse(true);
    setTab(next);setInitialized(current=>({...current,[next]:true}));setOpen(true);setActive('browser');
  };

  useEffect(() => {
    if (!enabled) return;
    const show = (data?: { url?: string }) => {
      const focused = document.activeElement;
      if (focused instanceof HTMLElement && !root.current?.querySelector('[data-browser-pane]')?.contains(focused)) returnFocus.current = focused;
      if (data?.url) setTarget({ url: data.url, revision: Date.now() });
      showTab('browser');
    };
    const listener = (event: Event) => show((event as CustomEvent<{ url?: string }>).detail);
    const showFiles = (event: Event) => {
      const focused = document.activeElement;
      if (focused instanceof HTMLElement && !root.current?.querySelector('[data-browser-pane]')?.contains(focused)) returnFocus.current = focused;
      const data=(event as CustomEvent<WorkspaceFileTarget>).detail||{};setFileTarget({...data,revision:Date.now()});showTab('files');
    };
    const showResult = (event: Event) => {
      const data = (event as CustomEvent<SavedResult>).detail;
      if (!data?.scope || data.receipt?.status !== 'saved' || !Array.isArray(data.files) || data.files.length > 20) return;
      const focused = document.activeElement;
      if (focused instanceof HTMLElement && !root.current?.querySelector('[data-browser-pane]')?.contains(focused)) returnFocus.current = focused;
      setResult(data); showTab('results');
    };
    const clearResult = (event: Event) => {
      setResult(current => current && resultKey(current.scope) === (event as CustomEvent<string>).detail ? null : current);
    };
    window.addEventListener(WORK_BROWSER_OPEN_EVENT, listener);
    window.addEventListener(WORKSPACE_PANE_OPEN, showFiles);
    window.addEventListener(RESULT_PANE_OPEN, showResult);
    window.addEventListener(RESULT_PANE_CLEAR, clearResult);
    const unsubscribe = window.modyCrewWorkBrowser?.onOpen?.(show);
    const params=new URLSearchParams(window.location.search);
    if(pathname==='/'&&params.get('openWorkspace')==='browser'){
      show({url:params.get('url')||undefined});params.delete('openWorkspace');params.delete('url');
      window.history.replaceState(window.history.state,'',`/${params.size?'?'+params.toString():''}`);
    }
    return () => { window.removeEventListener(WORK_BROWSER_OPEN_EVENT, listener);window.removeEventListener(WORKSPACE_PANE_OPEN,showFiles);window.removeEventListener(RESULT_PANE_OPEN,showResult);window.removeEventListener(RESULT_PANE_CLEAR,clearResult); unsubscribe?.(); };
  }, [enabled, pathname]);
  useEffect(() => { if (open) closeButton.current?.focus({ preventScroll: true }); }, [open]);
  useEffect(()=>{window.dispatchEvent(new CustomEvent(WORKSPACE_PANE_STATE,{detail:{open,tab}}));},[open,tab]);
  const close = () => {
    setOpen(false);setDragging(false);setBrowserInUse(false);
    void requestWorkBrowser({ kind: 'hide' }).catch(() => {});
    requestAnimationFrame(() => { if (returnFocus.current?.isConnected) returnFocus.current.focus({ preventScroll: true }); });
  };
  useEffect(() => {
    const dismiss = () => close();
    const escape = (event: KeyboardEvent) => {
      if (open && event.key === 'Escape' && !event.defaultPrevented && !document.querySelector('[aria-modal="true"],dialog[open]')) {
        event.preventDefault(); close();
      }
    };
    window.addEventListener(WORKSPACE_PANE_CLOSE, dismiss);
    window.addEventListener('keydown', escape);
    return () => { window.removeEventListener(WORKSPACE_PANE_CLOSE, dismiss); window.removeEventListener('keydown', escape); };
  }, [open]);
  return <div ref={root} className={styles.workspace} data-browser-open={open} data-browser-active={active} data-panel-expanded={open && expanded} style={{ '--browser-width': `${width}%` } as CSSProperties}>
    {open && <nav className={styles.mobileTabs} aria-label="업무와 사이드 패널 전환">
      <button type="button" aria-pressed={active === 'work'} onClick={() => setActive('work')}>업무로 돌아가기</button>
      <button type="button" aria-pressed={active === 'browser'} onClick={() => setActive('browser')}>{tab==='browser'?'웹 페이지 보기':tab==='results'?'결과 보기':'파일 보기'}</button>
      <button type="button" onClick={close}>닫기</button>
    </nav>}
    <div className={styles.split}>
      <div className={styles.work} data-browser-work>{children}</div>
      <>
        {open&&!expanded&&<div className={styles.resizer} role="separator" tabIndex={0} aria-label="사이드 패널 너비" aria-orientation="vertical" aria-valuemin={32} aria-valuemax={58} aria-valuenow={Math.round(width)}
          onKeyDown={event => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) { event.preventDefault(); setWidth(value => event.key === 'Home' ? 32 : event.key === 'End' ? 58 : Math.max(32, Math.min(58, value + (event.key === 'ArrowLeft' ? 2 : -2)))); } }}
          onPointerDown={event => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); setDragging(true); void requestWorkBrowser({ kind: 'hide' }).catch(() => {}); }}
          onPointerMove={event => { if (!event.currentTarget.hasPointerCapture(event.pointerId)) return; const rect = root.current?.getBoundingClientRect(); if (rect) setWidth(Math.max(32, Math.min(58, (rect.right - event.clientX) / rect.width * 100))); }}
          onPointerUp={event => { event.currentTarget.releasePointerCapture(event.pointerId); setDragging(false); }} onLostPointerCapture={() => setDragging(false)} />}
        <aside className={styles.browser} data-browser-pane aria-label="작업 사이드 패널" hidden={!open}>
          <header className={styles.header}><div className={styles.panelTabs} role="tablist" aria-label="사이드 패널 도구">
            {(result || tab === 'results') && <button type="button" role="tab" aria-selected={tab==='results'} aria-controls="workspace-results-panel" id="workspace-results-tab" onClick={()=>showTab('results')}>결과</button>}
            <button type="button" role="tab" aria-selected={tab==='files'} aria-controls="workspace-files-panel" id="workspace-files-tab" onClick={()=>showTab('files')}>파일</button>
            {(browserInUse || tab === 'browser') && <button type="button" role="tab" aria-selected={tab==='browser'} aria-controls="workspace-browser-panel" id="workspace-browser-tab" onClick={()=>showTab('browser')}>웹 페이지</button>}
          </div><button type="button" aria-label={expanded?'사이드 패널 너비 복원':'사이드 패널 넓게 보기'} aria-pressed={expanded} onClick={()=>setExpanded(value=>!value)}>{expanded?'나란히':'넓게'}</button><button ref={closeButton} type="button" className={styles.closeButton} onClick={close} aria-label="사이드 패널 닫기" title="사이드 패널 닫기">×</button></header>
          <div className={styles.panelBody} id="workspace-results-panel" role="tabpanel" aria-labelledby="workspace-results-tab" hidden={tab!=='results'}>{result ? <DeliverableInspector key={resultKey(result.scope)} result={result}/> : <p style={{padding:18,fontSize:13}}>대화에서 결과 파일을 선택해 주세요.</p>}</div>
          <div className={styles.panelBody} id="workspace-files-panel" role="tabpanel" aria-labelledby="workspace-files-tab" hidden={tab!=='files'}>{initialized.files&&<WorkspaceFiles target={fileTarget}/>}</div>
          <div className={styles.panelBody} id="workspace-browser-panel" role="tabpanel" aria-labelledby="workspace-browser-tab" hidden={tab!=='browser'}>{initialized.browser&&<WorkBrowser embedded initialTarget={target} suspended={dragging||!open||tab!=='browser'||(narrow&&active==='work')} />}</div>
        </aside>
      </>
    </div>
  </div>;
}
