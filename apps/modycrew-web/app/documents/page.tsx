"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import { createDesktopBridge } from '@/lib/desktop-bridge';
import type { CompanyRecord, CompanyWork } from '@/lib/company-automation';
import { documentFormatLabels, type DocumentFormat, type DocumentSpec, type DocumentProductionPayload, type DocumentProductionResult, type CompanyDocumentTemplate, type SavedDocument } from '@/lib/document-production';
import DocumentLibrary from '@/components/DocumentLibrary';
import { peekDocumentHandoff, acknowledgeDocumentHandoff, type PendingDocumentHandoff } from '@/lib/document-handoff.mjs';
import { getCurrentSession, onAuthSession } from '@/lib/firebase-client';
import { documentDraftKey, normalizeDocumentDraft, readDocumentDraft, type DocumentEditorDraft } from '@/lib/document-draft-storage.mjs';
import { createDocumentDraftSession, type DocumentDraftSession, type DocumentDraftRevision } from '@/lib/document-draft-session.mjs';
import { documentSpecShareText } from '@/lib/team-share.mjs';
import ShareToTeamButton from '@/components/ShareToTeamButton';
import styles from './page.module.css';
import DownloadablePdfViewer from '@/components/DownloadablePdfViewer';
import { DocumentViewerDialog, type DocumentViewerSource } from '@/components/DocumentViewer';

/** 최근 문서의 내용(spec)을 읽어 팀 공유용 글로. 화면 상태(바쁨·안내 문구)는 건드리지 않는다. */
async function loadDocumentShareContent(doc: SavedDocument) {
  const result = await createDesktopBridge().documentProduction({ kind: 'load_document', id: doc.id });
  if (!result.spec) return null;
  return { title: result.spec.title || doc.title, text: documentSpecShareText(result.spec) };
}

export default function DocumentsPage() {
  const [scope, setScope] = useState('');
  const [scopeError, setScopeError] = useState('');
  useEffect(() => {
    let alive = true; let generation = 0; let unsubscribe: (() => void) | undefined;
    const refresh = async () => {
      const token = ++generation;
      try {
        const bridge = createDesktopBridge();
        const [session, workspace] = await Promise.all([getCurrentSession(), bridge.loadWorkSessionWorkspace()]);
        const key = documentDraftKey(session?.uid || 'local', workspace.root || (!bridge.isAvailable ? 'browser' : ''));
        if (alive && token === generation) { setScope(key); setScopeError(''); }
      } catch { if (alive && token === generation) { setScope(''); setScopeError('초안을 보관할 계정과 업무 저장소를 확인하지 못했습니다. 화면을 다시 열어 주세요.'); } }
    };
    void refresh(); window.addEventListener('focus', refresh); window.addEventListener('modycrew-work-sessions-changed', refresh);
    void onAuthSession(()=>{if(alive)void refresh();}).then(stop=>{if(alive)unsubscribe=stop;else stop();}).catch(()=>{});
    return () => { alive = false; unsubscribe?.(); window.removeEventListener('focus', refresh); window.removeEventListener('modycrew-work-sessions-changed', refresh); };
  }, []);
  if (!scope) return <main className={styles.page}><p role={scopeError ? 'alert' : 'status'}>{scopeError || '작성 중인 문서를 확인하고 있습니다…'}</p></main>;
  return <DocumentWorkspace key={scope} draftKey={scope}/>;
}

function DocumentWorkspace({ draftKey }: { draftKey: string }) {
  const [editorOpen, setEditorOpen] = useState(false);
  const [status, setStatus] = useState<DocumentProductionResult | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState(false); const [busy, setBusy] = useState(''); const busyRef = useRef(false);
  const [title, setTitle] = useState(''); const [source, setSource] = useState(''); const [templateId, setTemplateId] = useState('general');
  const [company, setCompany] = useState(''); const [author, setAuthor] = useState(''); const [period, setPeriod] = useState('');
  const [sources, setSources] = useState<string[]>([]); const [spec, setSpec] = useState<DocumentSpec | null>(null);
  const [format, setFormat] = useState<DocumentFormat>('docx'); const [companyTemplateId, setCompanyTemplateId] = useState('');
  const [mapping, setMapping] = useState<Record<string, string>>({}); const [fields, setFields] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<SavedDocument | null>(null); const [recent, setRecent] = useState<SavedDocument[]>([]);
  const [from, setFrom] = useState(''); const [to, setTo] = useState(''); const [query, setQuery] = useState('');
  const [dirty, setDirty] = useState(false); const [draftRestored, setDraftRestored] = useState(false);
  // 이전 버전의 한 칸짜리 보관함은 읽기 전용으로 유지한다.
  const previousDraftKey = `${draftKey}::previous`;
  const [previousDraftTitle, setPreviousDraftTitle] = useState('');
  const [draftLoaded, setDraftLoaded] = useState(false); const [draftSaveError, setDraftSaveError] = useState('');
  const persistence = useRef<DocumentDraftSession | null>(null);
  const [draftSaving, setDraftSaving] = useState(true);
  const [history, setHistory] = useState<DocumentDraftRevision[]>([]);
  const [historyWarning, setHistoryWarning] = useState('');
  const [appliedHandoffs, setAppliedHandoffs] = useState<string[]>([]);
  const [pendingReplacement, setPendingReplacement] = useState<{ draft: DocumentEditorDraft; reason: string } | null>(null);
  const [legacyDraft, setLegacyDraft] = useState(false);
  const [companyRecords, setCompanyRecords] = useState<CompanyRecord[]>([]); const [companySourceIds, setCompanySourceIds] = useState<string[]>([]);
  const [companyWork, setCompanyWork] = useState<CompanyWork | null>(null);
  // 대화의 보고서 등에서 [문서로 저장]으로 넘어온 글. 작성 중인 자료가 있으면 덮지 않고 붙일지 묻는다.
  const [handoff, setHandoff] = useState<PendingDocumentHandoff | null>(null); const [handoffNote, setHandoffNote] = useState('');
  const [workLink,setWorkLink]=useState<{threadId:string;root:string}|null>(null);
  const [linkNotice,setLinkNotice]=useState('');
  // 앱 안 문서 보기(읽기 전용). 저장한 문서는 '만든 문서' 폴더 안이어야 열린다.
  const [viewerSource, setViewerSource] = useState<DocumentViewerSource | null>(null);
  // 문서 보관함 본문 검색: 설치 앱이 작성 기록(제목·문단·표)에서 찾는다. 설치 앱이 아니면 제목으로만 찾는다.
  const searchSavedDocuments = useCallback(async (query: string) => {
    const result = await createDesktopBridge().documentProduction({ kind: 'search_documents', query });
    return result.status === 'search_ready' ? result.matches ?? [] : null;
  }, []);
  const companyTemplate = status?.templates?.find((t) => t.id === companyTemplateId);
  const available = status?.status === 'ready';

  useEffect(() => {
    let active = true;
    createDesktopBridge().companyAutomation({ kind: 'status' }).then((r) => { if (active && r.state) { setCompanyRecords(r.state.records); const workId = new URLSearchParams(window.location.search).get('companyWork'); if (workId) setEditorOpen(true); if (workId) setCompanyWork(r.state.works.find((work) => work.id === workId && work.result) || null); } }).catch(() => {});
    createDesktopBridge().documentProduction({ kind: 'status' }).then((result) => { if (active) { setStatus(result); if (result.status !== 'ready') { setMessage(result.userMessage); setError(result.status === 'error'); } setRecent(result.documents || []); } }).catch(() => { if (active) { setMessage('문서 제작 환경을 불러오지 못했습니다. 앱을 다시 열어 주세요.'); setError(true); } });
    const session = createDocumentDraftSession(localStorage, draftKey, async (name, action) => {
      if (!navigator.locks) throw new Error('이 실행 환경에서는 안전한 초안 보관을 지원하지 않습니다. 창을 닫기 전에 파일로 저장해 주세요.');
      return navigator.locks.request(name, action);
    });
    persistence.current = session;
    void (async () => {
      try {
        let restored = session.load() || normalizeDocumentDraft({});
        restoreDraft(restored);
        let received: PendingDocumentHandoff | null = null;
        try { received = peekDocumentHandoff(sessionStorage); }
        catch { setHandoffNote('전달받은 글을 읽지 못했습니다. 전달 원본은 보존했습니다.'); }
        if (received) {
          if (restored.appliedHandoffs.includes(received.id)) acknowledgeDocumentHandoff(sessionStorage, received.receipt);
          else if (new URLSearchParams(window.location.search).get('handoff') && !received.expired) {
            setEditorOpen(true);
            const next = handoffDraft(normalizeDocumentDraft({ appliedHandoffs: restored.appliedHandoffs }), received);
            try {
              await session.save(next, restored, '채팅에서 새 글 가져오기 전');
              if (!active) return;
              restored = next; restoreDraft(next); finishHandoff(received);
            } catch (e) {
              if (!active) return;
              setHandoff(received); setHandoffNote('전달한 글을 아직 저장하지 못했습니다. 기존 초안과 전달 원본을 보존했습니다.');
              setDraftSaveError(saveFailure(e));
            }
          } else { setHandoff(received); setEditorOpen(true); }
        }
        if (active) { setDraftRestored(Boolean(restored.title || restored.source || restored.spec)); setDraftLoaded(true); refreshHistory(session); }
      } catch { if (active) { setDraftSaving(false); setDraftSaveError('보관한 초안을 읽지 못했습니다. 기존 내용은 덮어쓰지 않습니다. 파일 저장은 계속 사용할 수 있습니다.'); } }
    })();
    try { setLegacyDraft(Boolean(sessionStorage.getItem('modycrew-document-draft-v1'))); } catch { /* Optional pre-upgrade draft. */ }
    try { const previous = readDocumentDraft(localStorage, previousDraftKey); setPreviousDraftTitle(previous ? previous.spec?.title || previous.title || '제목 없는 문서' : ''); } catch { /* 이전 초안을 읽지 못해도 지금 문서는 계속 쓴다. */ }
    return () => { active = false; session.close(); };
  }, [draftKey]);
  useEffect(() => {
    if (!draftLoaded) return;
    let active = true; setDraftSaving(true);
    void persistence.current!.save(currentDraft()).then(() => { if (active) setDraftSaveError(''); }).catch(e => { if (active) setDraftSaveError(saveFailure(e)); }).finally(() => { if (active) setDraftSaving(false); });
    return () => { active = false; };
  }, [draftLoaded, draftKey, title, source, spec, company, author, period, sources, templateId, workLink, format, companyTemplateId, mapping, fields, companySourceIds, from, to, query, dirty, appliedHandoffs]);
  useEffect(() => { const beforeUnload = (event: BeforeUnloadEvent) => { if ((draftSaveError || draftSaving || pendingReplacement) && (dirty || title || source || pendingReplacement)) { event.preventDefault(); event.returnValue = ''; } }; window.addEventListener('beforeunload', beforeUnload); return () => window.removeEventListener('beforeunload', beforeUnload); }, [dirty, title, source, draftSaveError, draftSaving, pendingReplacement]);

  function restoreDraft(draft: DocumentEditorDraft) {
    setTitle(draft.title); setSource(draft.source); setSpec(draft.spec); setCompany(draft.company); setAuthor(draft.author); setPeriod(draft.period);
    setSources(draft.sources); setTemplateId(draft.templateId); setWorkLink(draft.workLink); setFormat(draft.format); setCompanyTemplateId(draft.companyTemplateId);
    setMapping(draft.mapping); setFields(draft.fields); setCompanySourceIds(draft.companySourceIds); setFrom(draft.from); setTo(draft.to); setQuery(draft.query); setDirty(draft.dirty); setAppliedHandoffs(draft.appliedHandoffs);
  }
  function currentDraft() { return normalizeDocumentDraft({ title, source, spec, company, author, period, sources, templateId, workLink, format, companyTemplateId, mapping, fields, companySourceIds, from, to, query, dirty, appliedHandoffs }); }
  function saveFailure(e: unknown) { return `${e instanceof Error ? e.message : '초안을 보관하지 못했습니다.'} 현재 편집 내용은 유지했습니다.`; }
  function refreshHistory(session = persistence.current) {
    try { const result = session!.history(); setHistory(result.entries); setHistoryWarning(result.unreadable ? `읽을 수 없는 이전 초안 ${result.unreadable}개는 삭제하지 않고 보존했습니다.` : ''); }
    catch { setHistoryWarning('이전 초안 목록을 읽지 못했습니다. 보관된 내용은 그대로 두었습니다.'); }
  }
  async function replaceDraft(next: DocumentEditorDraft, reason: string) {
    if (busyRef.current || !draftLoaded || !persistence.current) return false;
    const session = persistence.current;
    busyRef.current = true; setBusy('현재 초안을 보관하고 있습니다…');
    try {
      // Preserve acknowledgement history even when restoring an older revision.
      next = { ...next, appliedHandoffs: [...new Set([...appliedHandoffs, ...next.appliedHandoffs])] };
      await session.save(next, currentDraft(), reason);
      restoreDraft(next); setSaved(null); setDraftRestored(false); setDraftSaveError(''); setPendingReplacement(null); setEditorOpen(true);
      return true;
    } catch (e) { setPendingReplacement({ draft: next, reason }); setDraftSaveError(saveFailure(e)); return false; }
    finally { busyRef.current = false; setBusy(''); refreshHistory(session); }
  }
  async function reloadOtherDraft() {
    if (busyRef.current || !draftLoaded || !persistence.current) return;
    busyRef.current = true; setBusy('현재 편집본을 보관하고 있습니다…');
    try { const next = await persistence.current.reload(currentDraft()); restoreDraft(next || normalizeDocumentDraft({})); setSaved(null); setDraftSaveError(''); }
    catch (e) { setDraftSaveError(saveFailure(e)); }
    finally { busyRef.current = false; setBusy(''); refreshHistory(); }
  }
  async function reopenPreviousDraft() {
    if (busyRef.current) return;
    try {
      const previous = readDocumentDraft(localStorage, previousDraftKey);
      if (!previous) { setPreviousDraftTitle(''); return; }
      await replaceDraft(previous, '이전 버전의 초안 복원 전');
    } catch { setDraftSaveError('보관한 이전 초안을 열지 못했습니다. 지금 작성 중인 내용은 그대로 두었습니다.'); }
  }
  async function importLegacyDraft() {
    try {
      const draft = normalizeDocumentDraft(JSON.parse(sessionStorage.getItem('modycrew-document-draft-v1') || 'null'));
      if (await replaceDraft(draft, '이전 임시 초안 가져오기 전')) setLegacyDraft(false);
    } catch { setDraftSaveError('이전 임시 초안을 가져오지 못했습니다. 이전 내용은 그대로 남겨 두었습니다.'); }
  }

  async function act(payload: DocumentProductionPayload, label: string) {
    if (busyRef.current) return null;
    busyRef.current = true; setBusy(label); setError(false); setMessage(label);
    try { const result = await createDesktopBridge().documentProduction(payload); setMessage(result.userMessage); setError(result.status === 'error' || result.status === 'desktop_required'); return result; }
    catch (e) { setMessage(e instanceof Error ? e.message : '처리하지 못했습니다. 다시 시도해 주세요.'); setError(true); return null; }
    finally { busyRef.current = false; setBusy(''); }
  }
  function handoffDraft(base: DocumentEditorDraft, received: PendingDocumentHandoff) {
    return normalizeDocumentDraft({ ...base, title: base.title || received.title, source: [base.source, received.text].filter(Boolean).join('\n\n'),
      sources: [...new Set([...base.sources, received.sourceLabel].filter(Boolean))], dirty: true,
      workLink: received.workThreadId && received.workRoot ? { threadId: received.workThreadId, root: received.workRoot } : null,
      appliedHandoffs: [...new Set([...base.appliedHandoffs, received.id])] });
  }
  function finishHandoff(received: PendingDocumentHandoff) {
    const acknowledged = acknowledgeDocumentHandoff(sessionStorage, received.receipt);
    setHandoff(null);
    setHandoffNote(acknowledged ? `${received.sourceLabel || '가져온 글'} 내용을 문서 자료에 보관했습니다. ‘자료 그대로 정리’나 ‘AI로 초안 만들기’를 눌러 주세요.` : '내용은 문서에 보관했지만 전달 완료 처리를 못했습니다. 다시 열어도 같은 글을 중복해서 넣지 않습니다.');
  }
  async function applyHandoff(received: PendingDocumentHandoff, asNew = false) {
    const base = asNew ? normalizeDocumentDraft({ appliedHandoffs }) : currentDraft();
    if (appliedHandoffs.includes(received.id) || await replaceDraft(handoffDraft(base, received), '전달받은 글 적용 전')) finishHandoff(received);
  }
  function editSpec(next: DocumentSpec) { if (busyRef.current) return; setSpec(next); setDirty(true); setSaved(null); }
  function selectCompanyTemplate(template?: CompanyDocumentTemplate) { setCompanyTemplateId(template?.id || ''); setMapping({}); setFields({}); if (template) setFormat(template.format); }
  async function importSources() {
    const result = await act({ kind: 'import_sources' }, '자료를 읽고 있습니다…');
    if (result?.sources) { setSource((old) => [old, ...result.sources!.map((s) => `[${s.name}]\n${s.text}`)].filter(Boolean).join('\n\n')); setSources((old) => [...new Set([...old, ...result.sources!.map((s) => s.name)])]); }
  }
  async function importTemplate() {
    const result = await act({ kind: 'import_template' }, '회사 양식을 보관하고 있습니다…');
    if (result?.template) { setStatus((old) => old ? { ...old, templates: [result.template!, ...(old.templates || [])] } : old); selectCompanyTemplate(result.template); }
  }
  async function draft(useAI: boolean) {
    const result = await act({ kind: 'draft', title, source, templateId, company, author, period, sources, useAI, useCompanyRecords: companySourceIds.length > 0, companySourceIds }, useAI ? '자료를 바탕으로 AI가 초안을 작성하고 있습니다…' : '입력한 자료를 문서로 정리하고 있습니다…');
    if (result?.spec) await replaceDraft({ ...currentDraft(), spec: result.spec, dirty: true }, '초안 다시 만들기 전');
  }
  async function copyDocument(doc: SavedDocument) {
    const result = await act({ kind: 'load_document', id: doc.id }, '문서를 불러오고 있습니다…');
    if (result?.spec) await replaceDraft(normalizeDocumentDraft({ ...result.spec, spec: result.spec, source: documentSpecShareText(result.spec), format: doc.format, dirty: true, appliedHandoffs }), '저장 문서 복사 전');
  }
  async function saveDocument() {
    if (!spec) return;
    const result = await act({ kind: 'export', spec, format, companyTemplateId, mapping, fields }, `${format.toUpperCase()} 파일을 만들고 있습니다…`);
    if (result?.document) { setSaved(result.document); setRecent((old) => [result.document!, ...old].slice(0, 1000)); setDirty(false); await linkDocument(result.document); }
  }
  async function linkDocument(document:SavedDocument) {
    if(!workLink) return;
    try {
      const result=await createDesktopBridge().updateWorkSessionWorkspace({type:'save_artifact',threadId:workLink.threadId,artifact:{documentId:document.id,title:document.title.slice(0,300),format:document.format,bytes:document.bytes,sha256:document.sha256,savedAt:Date.parse(document.createdAt)||Date.now()}},workLink.root);
      if(result.status!=='work_session_workspace_updated')throw new Error(result.userMessage);
      setLinkNotice('원래 업무에도 결과물을 연결했습니다. 업무 대화에서 다시 열 수 있습니다.');
      window.dispatchEvent(new Event('modycrew-work-sessions-changed'));
    } catch {setLinkNotice('파일은 저장했지만 업무 연결을 저장하지 못했습니다. 원래 저장소로 돌아온 뒤 연결을 다시 눌러 주세요.');}
  }
  const fieldNames = ['제목', '회사', '작성자', '기간', 'body', ...(spec?.sections.map((s) => s.heading) || [])].filter(Boolean);
  return <main className={styles.page}>
    <header className={styles.header}><div><h1>문서</h1><p>만든 문서를 열고, 작성하던 내용을 이어가세요.</p></div><button type="button" onClick={() => setViewerSource({ kind: 'pick' })}>파일 골라 보기</button><button className={editorOpen ? undefined : styles.primary} onClick={() => setEditorOpen(!editorOpen)}>{editorOpen ? '문서 목록' : title || source || spec ? '작성 중인 문서 열기' : '문서 작성'}</button></header>
    {(message || busy) && <div role={error ? 'alert' : 'status'} className={`${styles.message} ${error ? styles.error : ''}`}>{busy ? <span aria-hidden="true">◌ </span> : null}{message}</div>}
    {!editorOpen && <DocumentLibrary documents={recent} catalog={status?.catalog} busy={Boolean(busy)} search={searchSavedDocuments}
      onView={(doc) => setViewerSource({ kind: 'path', path: doc.path })}
      onOpen={(doc) => void act({ kind: 'open', id: doc.id }, '문서를 열고 있습니다…')}
      onCopy={(doc) => void copyDocument(doc)}
      renderShare={(doc) => <ShareToTeamButton source="document" disabled={Boolean(busy)} resolveContent={() => loadDocumentShareContent(doc)} />} />}
    {!editorOpen && Boolean(title || source || spec) && <section className={styles.draftRow} aria-label="작성 중인 문서"><div><small>작성 중 · 자동 보관</small><strong>{spec?.title || title || '제목 없는 문서'}</strong></div><button onClick={() => setEditorOpen(true)}>이어서 작성</button></section>}
    {draftSaveError && !editorOpen && <p role="alert" className={styles.error}>{draftSaveError}</p>}
    <div hidden={!editorOpen} data-document-editor>
    <p className={styles.note} role={draftSaveError ? 'alert' : undefined} data-document-autosave={draftSaveError ? 'error' : !draftLoaded || draftSaving ? 'saving' : 'saved'}>{draftSaveError || (!draftLoaded || draftSaving ? '초안 보관 중…' : draftRestored ? '작성 중인 초안 · 자동 보관됨' : '변경 내용 자동 보관됨')}</p>
    {draftSaveError && draftLoaded && <button type="button" disabled={Boolean(busy)} onClick={reloadOtherDraft}>현재 편집본 보관 후 저장된 초안 불러오기</button>}
    {pendingReplacement && <section className={styles.card} aria-label="적용 대기 초안"><h2>새 초안 적용 대기</h2><p>현재 편집본을 보존했습니다. 저장 공간을 확인한 뒤 다시 시도하세요. 새 초안을 다시 생성할 필요는 없습니다.</p><details><summary>새 초안 내용 확인</summary><pre className={styles.pendingText}>{pendingReplacement.draft.spec ? documentSpecShareText(pendingReplacement.draft.spec) : pendingReplacement.draft.source}</pre></details><button type="button" disabled={Boolean(busy)} onClick={async () => { if (await replaceDraft(pendingReplacement.draft, pendingReplacement.reason)) { if (handoff && pendingReplacement.draft.appliedHandoffs.includes(handoff.id)) finishHandoff(handoff); } }}>초안 보관 다시 시도</button></section>}
    {(history.length > 0 || historyWarning) && <details className={styles.history} data-document-history><summary>보관한 이전 초안 {history.length}개</summary><p className={styles.note}>새 글을 가져오거나 초안을 교체하기 전 내용입니다. 복원할 때 현재 편집본도 먼저 보관합니다.</p>{historyWarning && <p role="alert">{historyWarning}</p>}{history.map(entry => <div className={styles.historyRow} key={entry.id}><span><strong>{entry.draft.spec?.title || entry.draft.title || '제목 없는 문서'}</strong><small>{entry.reason} · {new Date(entry.createdAt).toLocaleString('ko-KR')}</small></span><button type="button" disabled={Boolean(busy)} aria-label={`초안 복원: ${entry.draft.spec?.title || entry.draft.title || '제목 없는 문서'}`} onClick={() => replaceDraft(entry.draft, '이전 초안 복원 전')}>복원</button></div>)}</details>}
    {legacyDraft && !title && !source && !spec && <button type="button" onClick={importLegacyDraft}>이전 창의 임시 초안 가져오기</button>}
    {handoffNote && <p className={styles.note} role="status" data-document-handoff="applied">{handoffNote}</p>}
    {previousDraftTitle && <p className={styles.note} data-document-previous-draft="kept">작성 중이던 ‘{previousDraftTitle}’ 초안은 따로 보관했어요. <button type="button" onClick={reopenPreviousDraft} disabled={Boolean(busy)}>이전 초안 다시 열기</button></p>}
    {workLink&&<p className={styles.note}>이 문서는 출발한 메일 업무의 결과물로 함께 저장됩니다. <a href={`/?thread=${encodeURIComponent(workLink.threadId)}`}>업무 대화로 돌아가기</a></p>}
    {linkNotice&&<p className={styles.note} role="status">{linkNotice} {saved&&workLink&&<button type="button" onClick={()=>void linkDocument(saved)}>업무 연결 다시 확인</button>}</p>}
    {companyWork && <section className={styles.card}><h2>회사 운영에서 취합한 결과</h2><p>{companyWork.request.split('\n')[0]}</p><p className={styles.note}>현재 초안에 업무 결과를 덧붙입니다. 본문·표를 검토하고 원하는 파일 형식으로 저장해 주세요.</p><button disabled={Boolean(busy)} onClick={() => { setTitle((old) => old || companyWork.request.split('\n')[0].slice(0, 180)); setSource((old) => [old, companyWork.result].filter(Boolean).join('\n\n')); setSources((old) => [...new Set([...old, `ModyCrew 회사 업무 ${companyWork.id}`, ...companyWork.tasks.flatMap((task) => (task.references || []).map((record) => `${record.name} / v${record.version} / SHA256:${record.hash}`))])]); setCompanyWork(null); setMessage('취합 결과를 문서 자료에 추가했습니다. 초안을 만들고 검토해 주세요.'); }}>현재 자료에 취합 결과 추가</button></section>}
    {handoff && <section className={styles.card} data-document-handoff="pending"><h2>{handoff.sourceLabel || '가져온 글'}</h2><p>{handoff.title}</p><p className={styles.note}>{handoff.expired ? '전달한 지 30분이 지나 자동 적용하지 않았습니다. 내용을 확인한 뒤 적용하세요.' : '전달 원본을 보관하고 있습니다. 저장에 성공한 뒤에만 전달 완료로 처리합니다.'}</p><div className={styles.actions}><button disabled={Boolean(busy)} onClick={() => applyHandoff(handoff)}>현재 자료에 붙이기</button><button disabled={Boolean(busy)} onClick={() => applyHandoff(handoff, true)}>새 문서로 보관</button><button disabled={Boolean(busy)} onClick={() => setHandoff(null)}>나중에</button></div></section>}
    {!available && status?.status === 'desktop_required' && <p className={styles.note}>설치된 앱의 왼쪽 메뉴에서 ‘문서’를 선택하면 파일을 만들 수 있습니다.</p>}
    <fieldset className={styles.editorFields} disabled={Boolean(busy)}><div className={styles.workspace} data-has-preview={Boolean(spec)} aria-busy={Boolean(busy)}>
      <details className={styles.card} open={!spec} aria-labelledby="document-source-heading"><summary id="document-source-heading">자료와 양식</summary>
        <label>문서 제목<input value={title} maxLength={180} onChange={(e) => setTitle(e.target.value)} placeholder="예: 9월 첫째 주 업무보고" disabled={Boolean(busy)} /></label>
        <label>기본 양식<select aria-label="기본 양식" value={templateId} onChange={(e) => setTemplateId(e.target.value)} disabled={Boolean(busy)}>{status?.catalog?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>) || <option value="general">일반 문서</option>}</select></label>
        <div className={styles.sourceHeader}><label htmlFor="document-source">문서에 넣을 자료</label><button type="button" onClick={importSources} disabled={!available || Boolean(busy)}>자료 파일 가져오기</button></div>
        <textarea id="document-source" value={source} onChange={(e) => setSource(e.target.value)} rows={12} placeholder="업무 내용, 회의 메모, 보고할 숫자 등을 넣어 주세요. 자료에 없는 사실은 확인이 필요한 항목으로 남깁니다." disabled={Boolean(busy)} />
        <p className={styles.note}>DOCX · PPTX · XLSX · PDF · HWPX · HWP · TXT · MD / 최대 6개, 파일당 32MB</p>
        <details><summary>보관한 회사 자료 참고하기 · {companySourceIds.length}개 선택</summary><p className={styles.note}>회사 운영에서 보관한 자료를 최대 2개 선택하세요. AI로 작성하면 선택 자료가 연결된 AI에 전달되고, 작성 근거에 원본 버전과 해시가 남습니다.</p>{companyRecords.map((record) => <label key={record.id}><input type="checkbox" checked={companySourceIds.includes(record.id)} disabled={Boolean(busy) || !companySourceIds.includes(record.id) && companySourceIds.length >= 2} onChange={() => setCompanySourceIds((old) => old.includes(record.id) ? old.filter((id) => id !== record.id) : [...old, record.id])}/>{record.name} · v{record.version}</label>)}{!companyRecords.length && <p className={styles.note}><a href="/automation">회사 운영에서 기존 자료 가져오기 →</a></p>}</details>
        <details><summary>작성자·기간과 업무 기록</summary><div className={styles.details}>
          <label>회사<input value={company} onChange={(e) => setCompany(e.target.value)} maxLength={140}/></label><label>작성자<input value={author} onChange={(e) => setAuthor(e.target.value)} maxLength={80}/></label><label>문서에 표시할 기간<input value={period} onChange={(e) => setPeriod(e.target.value)} maxLength={140} placeholder="예: 2026. 9. 1. ~ 9. 7."/></label>
          <div className={styles.twoColumns}><label>기록 시작일<input type="date" value={from} onChange={(e) => setFrom(e.target.value)}/></label><label>기록 종료일<input type="date" value={to} onChange={(e) => setTo(e.target.value)}/></label></div>
          <label>기록 검색<input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="업무명·고객·담당자"/></label>
          <button type="button" disabled={!available || Boolean(busy)} onClick={async () => { const r = await act({ kind: 'records', from, to, query }, '업무 기록을 찾고 있습니다…'); if (r?.records?.length) { setSource((old) => [old, ...r.records!.map((record) => `${record.createdAt?.slice(0, 10) || ''} · ${record.title} (${record.status})\n${record.detail || ''}`)].filter(Boolean).join('\n\n')); setSources((old) => [...new Set([...old, `ModyCrew 업무 기록 ${from || '전체'} ~ ${to || '전체'} (${r.records!.length}건)`])]); } }}>업무 기록 가져오기</button>
          <p className={styles.note}>앱에 남아 있는 최근 업무 활동에서 조회합니다. 외부 메일·일정 전체를 조회하는 기능은 아닙니다.</p>
        </div></details>
        <div className={styles.actions}><button className={styles.primary} disabled={!available || Boolean(busy) || !title.trim() || !source.trim() && !companySourceIds.length} onClick={() => draft(true)}>AI로 초안 만들기</button><button disabled={!available || Boolean(busy) || !title.trim() || !source.trim() && !companySourceIds.length} onClick={() => draft(false)}>자료 그대로 정리</button></div>
        {spec && <p className={styles.note}>초안을 다시 만들기 전에 현재 편집 내용을 이전 초안으로 보관합니다.</p>}
      </details>
      <section className={styles.card} aria-labelledby="document-preview-heading"><h2 id="document-preview-heading">내용을 확인하고 저장하세요</h2>
        {!spec ? <div className={styles.empty}><span aria-hidden="true">▤</span><h3>완성할 내용이 여기에 표시됩니다</h3><p>자료를 넣고 초안을 만들면 제목·본문·표를 직접 수정할 수 있어요.</p></div> : <>
          <div className={styles.preview}><label>저장할 제목<input value={spec.title} onChange={(e) => editSpec({ ...spec, title: e.target.value })} disabled={Boolean(busy)}/></label>
            <div className={styles.twoColumns}><label>작성 회사<input value={spec.company} onChange={(e) => editSpec({ ...spec, company: e.target.value })}/></label><label>작성자 이름<input value={spec.author} onChange={(e) => editSpec({ ...spec, author: e.target.value })}/></label></div><label>보고 기간<input value={spec.period} onChange={(e) => editSpec({ ...spec, period: e.target.value })}/></label>
            {spec.sections.map((section, index) => <article key={index} className={styles.section}><label>항목 {index + 1}<input value={section.heading} onChange={(e) => editSpec({ ...spec, sections: spec.sections.map((s, i) => i === index ? { ...s, heading: e.target.value } : s) })} disabled={Boolean(busy)}/></label><label>본문 {index + 1}<textarea aria-label={`본문 ${index + 1}`} rows={Math.min(12, Math.max(4, section.paragraphs.join('\n\n').split('\n').length + 1))} value={section.paragraphs.join('\n\n')} onChange={(e) => editSpec({ ...spec, sections: spec.sections.map((s, i) => i === index ? { ...s, paragraphs: e.target.value.split(/\n\s*\n/u) } : s) })} disabled={Boolean(busy)}/></label>
              {section.table && <div className={styles.tableWrap}><table><caption>{section.heading || '문서'} 표</caption><thead><tr>{section.table.columns.map((c, col) => <th key={col}><input aria-label={`${index + 1}번째 표 ${col + 1}열 이름`} value={c} onChange={(e) => editSpec({ ...spec, sections: spec.sections.map((s, i) => i === index ? { ...s, table: { ...s.table!, columns: s.table!.columns.map((v, j) => j === col ? e.target.value : v) } } : s) })}/></th>)}</tr></thead><tbody>{section.table.rows.map((row, r) => <tr key={r}>{row.map((cell, col) => <td key={col}><textarea rows={2} aria-label={`${index + 1}번째 표 ${r + 1}행 ${col + 1}열`} value={cell} onChange={(e) => editSpec({ ...spec, sections: spec.sections.map((s, i) => i === index ? { ...s, table: { ...s.table!, rows: s.table!.rows.map((v, j) => j === r ? v.map((value, k) => k === col ? e.target.value : value) : v) } } : s) })}/></td>)}</tr>)}</tbody></table></div>}
            </article>)}
            <button disabled={Boolean(busy) || spec.sections.length >= 60} onClick={() => editSpec({ ...spec, sections: [...spec.sections, { heading: '추가 항목', paragraphs: [''] }] })}>항목 추가</button>
          </div>
          {spec.notes.map((note, i) => <p className={styles.note} key={i}>{note}</p>)}
          <details><summary>회사 양식에 넣기</summary><div className={styles.details}><button type="button" onClick={importTemplate} disabled={Boolean(busy)}>회사 양식 가져오기</button><label>사용할 양식<select value={companyTemplateId} onChange={(e) => selectCompanyTemplate(status?.templates?.find((t) => t.id === e.target.value))}><option value="">기본 양식으로 새로 만들기</option>{status?.templates?.map((t) => <option key={t.id} value={t.id}>{t.name} · v{t.version} · {t.format.toUpperCase()}</option>)}</select></label>
          {companyTemplate && <><p className={styles.note}>원본 서식을 유지합니다. {'{{제목}}, {{body}}'} 표시는 자동으로 채우고, 다른 칸은 아래에서 직접 지정하세요. 변경하지 않을 칸은 그대로 두면 됩니다.</p><p className={styles.note}>아래 미리보기는 내용 검토용입니다. 저장한 파일을 열어 회사 양식의 줄바꿈과 페이지를 확인해 주세요.</p>
            {companyTemplate.fields.filter((f) => !fieldNames.includes(f) && !['title', 'company', 'author', 'period'].includes(f)).map((f) => <label key={f}>{f}<textarea aria-label={f} rows={2} value={fields[f] || ''} onChange={(e) => setFields((old) => ({ ...old, [f]: e.target.value }))}/></label>)}
            <div className={styles.slots}>{companyTemplate.slots.map((slot, index) => <label key={slot.id}><span>{index + 1}. {slot.text}</span><select aria-label={`양식 ${index + 1}번째 칸에 넣을 내용`} value={mapping[slot.id] || ''} onChange={(e) => setMapping((old) => { const next = { ...old }; if (e.target.value) next[slot.id] = e.target.value; else delete next[slot.id]; return next; })}><option value="">현재 내용 유지 / 표시 자동 채움</option>{fieldNames.map((field, i) => <option key={`${field}-${i}`} value={field}>{field === 'body' ? '전체 본문' : field}</option>)}</select></label>)}</div></>}
          </div></details>
          <div className={styles.saveRow}><label>파일 형식<select value={format} onChange={(e) => setFormat(e.target.value as DocumentFormat)} disabled={Boolean(busy)}>{(status?.formats || []).map((f) => <option key={f} value={f} disabled={Boolean(companyTemplate && companyTemplate.format !== f && !(companyTemplate.format === 'hwpx' && f === 'hwp'))}>{documentFormatLabels[f]}</option>)}</select></label><button className={styles.primary} onClick={saveDocument} disabled={Boolean(busy) || !spec.title.trim()}>파일로 저장</button></div>
          {!status?.capabilities?.hwp && <p className={styles.note}>HWP 저장에는 한글 프로그램이 필요합니다. HWPX는 한글 없이도 만들 수 있습니다.</p>}
          <p className={styles.note}>파일은 내 문서 → ModyCrew → 만든 문서에 저장됩니다. 원본을 덮어쓰거나 외부로 전송하지 않습니다.</p>
          {saved && <div className={styles.saved}><strong>{saved.name}</strong><p>{Math.ceil(saved.bytes / 1024).toLocaleString('ko-KR')} KB · 저장 완료</p><div className={styles.actions}><button type="button" disabled={Boolean(busy) || !saved.path} onClick={() => setViewerSource({ kind: 'path', path: saved.path })}>앱에서 보기</button><button disabled={Boolean(busy)} onClick={() => act({ kind: 'open', id: saved.id }, '문서를 열고 있습니다…')}>파일 열기</button><button disabled={Boolean(busy)} onClick={() => act({ kind: 'open_folder', id: saved.id }, '저장 폴더를 열고 있습니다…')}>저장 폴더 열기</button><ShareToTeamButton source="document" title={spec.title} text={documentSpecShareText(spec)} disabled={Boolean(busy)} /></div></div>}
        </>}
      </section>
    </div></fieldset>

    </div>
    {viewerSource ? <DocumentViewerDialog source={viewerSource} title="앱에서 문서 보기" onClose={() => setViewerSource(null)} /> : null}
    {/* 선택 설치 PDF 도구는 문서 목록·작성 화면 아래의 보조 도구로 둔다(제목보다 먼저 보이지 않게). */}
    <DownloadablePdfViewer />
  </main>;
}
