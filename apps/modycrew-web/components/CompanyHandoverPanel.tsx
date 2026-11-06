'use client';

import { useEffect, useRef, useState } from 'react';
import { createDesktopBridge } from '@/lib/desktop-bridge';
import { navigateInternalPath } from '@/lib/safe-navigation';
import { companyStatusLabel, type CompanyAutomationPayload, type CompanyDepartment, type CompanyRecord, type CompanyWork } from '@/lib/company-automation';
import {
  draftFromHandover, emptyHandoverDraft, handoverPurposeLabels, handoverStatusLabels,
  type CompanyHandover, type HandoverAnswer, type HandoverDraft, type HandoverPurpose, type HandoverResult,
  type HandoverState, type HandoverSuggestion, type HandoverTransferPreview,
} from '@/lib/company-handover';
import styles from './CompanyHandoverPanel.module.css';

const dateLabel = (value?: string) => value && !Number.isNaN(Date.parse(value)) ? new Date(value).toLocaleString('ko-KR') : '—';
const toggle = (values: string[], value: string) => values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
const successful = (result: HandoverResult | null) => result && !['error', 'desktop_required', 'conflict', 'cancelled'].includes(result.status);
const stageOrder: CompanyHandover['status'][] = ['draft', 'ready', 'active', 'completed'];

export default function CompanyHandoverPanel() {
  const [state, setState] = useState<HandoverState | null>(null);
  const [records, setRecords] = useState<CompanyRecord[]>([]);
  const [departments, setDepartments] = useState<CompanyDepartment[]>([]);
  const [works, setWorks] = useState<CompanyWork[]>([]);
  const [draft, setDraft] = useState<HandoverDraft>(emptyHandoverDraft);
  const [stepsText, setStepsText] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [draftRevision, setDraftRevision] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [revising, setRevising] = useState(false);
  const [pendingSelection, setPendingSelection] = useState<string | null>(null);
  const [pendingNavigation, setPendingNavigation] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<HandoverSuggestion | null>(null);
  const [question, setQuestion] = useState('');
  const [openSource, setOpenSource] = useState<CompanyRecord | null>(null);
  const [accessReviewed, setAccessReviewed] = useState(false);
  const [exportPassword, setExportPassword] = useState('');
  const [importPassword, setImportPassword] = useState('');
  const [exportApproved, setExportApproved] = useState(false);
  const [importApproved, setImportApproved] = useState(false);
  const [preview, setPreview] = useState<HandoverTransferPreview | null>(null);
  const [exported, setExported] = useState<HandoverResult['file']>();
  const [message, setMessage] = useState('인수인계 기록을 불러오고 있습니다.');
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState('');
  const busyRef = useRef(false);
  const navigationAllowedRef = useRef(false);
  const navigationNoticeRef = useRef<HTMLDivElement>(null);
  const requestRef = useRef<{ key: string; id: string } | null>(null);
  const questionRef = useRef<{ key: string; id: string } | null>(null);
  const selected = state?.handovers.find((item) => item.id === selectedId);
  const editable = !selected || selected.status === 'draft' || revising;
  const savedClean = Boolean(selected && !dirty && !revising && selected.revision === draftRevision);
  const canAsk = Boolean(savedClean && selected && selected.status !== 'draft');
  const availableWorks = works.filter((work) => work.status !== 'completed' || draft.workIds.includes(work.id));
  const stepsDone = selected?.steps.filter((step) => step.done).length || 0;

  function receive(result: HandoverResult) {
    if (result.handoverState) setState(result.handoverState);
    if (result.handover) {
      const handover = result.handover;
      setState((previous) => ({ version: 1, handovers: [handover, ...(previous?.handovers || []).filter((item) => item.id !== handover.id)] }));
    }
    if (result.records) setRecords(result.records);
    if (result.departments) setDepartments(result.departments);
    if (result.works) setWorks(result.works);
  }

  useEffect(() => {
    let active = true;
    void createDesktopBridge().companyAutomation({ kind: 'handover_status' }).then((raw) => {
      if (!active) return;
      const result = raw as HandoverResult;
      receive(result); setMessage(result.userMessage); setError(['error', 'desktop_required'].includes(result.status));
    }).catch(() => { if (active) { setError(true); setMessage('인수인계 기록을 불러오지 못했습니다. 새로고침으로 다시 확인해 주세요.'); } });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (dirty) navigationAllowedRef.current = false;
    else setPendingNavigation(null);
    const handler = (event: BeforeUnloadEvent) => { if (dirty && !navigationAllowedRef.current) { event.preventDefault(); event.returnValue = ''; } };
    const guardLinkNavigation = (event: MouseEvent) => {
      if (!dirty || navigationAllowedRef.current || event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      const target = event.target instanceof Element ? event.target : null;
      const anchor = target?.closest<HTMLAnchorElement>('a[href]');
      if (!anchor || anchor.hasAttribute('download') || (anchor.target && anchor.target.toLowerCase() !== '_self')) return;
      let destination: URL;
      try { destination = new URL(anchor.href); } catch { return; }
      if (destination.origin !== window.location.origin || destination.protocol !== window.location.protocol || destination.host !== window.location.host) return;
      const normalizePath = (value: string) => value.replace(/\/+$/u, '') || '/';
      if (normalizePath(destination.pathname) === normalizePath(window.location.pathname)) return;
      event.preventDefault(); event.stopPropagation();
      setPendingNavigation(destination.href);
      window.dispatchEvent(new Event('modycrew:handover-navigation-blocked'));
    };
    window.addEventListener('beforeunload', handler);
    document.addEventListener('click', guardLinkNavigation, true);
    return () => { window.removeEventListener('beforeunload', handler); document.removeEventListener('click', guardLinkNavigation, true); };
  }, [dirty]);

  useEffect(() => {
    if (!pendingNavigation) return;
    const frame = requestAnimationFrame(() => { navigationNoticeRef.current?.scrollIntoView({ block: 'nearest' }); navigationNoticeRef.current?.focus({ preventScroll: true }); });
    return () => cancelAnimationFrame(frame);
  }, [pendingNavigation]);

  function discardAndNavigate() {
    if (!pendingNavigation) return;
    navigationAllowedRef.current = true; setDirty(false);
    navigateInternalPath(pendingNavigation);
  }

  async function act(payload: CompanyAutomationPayload, label: string) {
    if (busyRef.current) return null;
    busyRef.current = true; setBusy(label); setMessage(label); setError(false);
    try {
      const result = await createDesktopBridge().companyAutomation(payload) as HandoverResult;
      receive(result); setMessage(result.userMessage); setError(['error', 'desktop_required', 'conflict'].includes(result.status));
      return result;
    } catch {
      setError(true); setMessage('요청을 완료하지 못했습니다. 작성 내용은 유지됩니다. 새로고침으로 저장 상태를 확인한 뒤 다시 시도해 주세요.');
      return null;
    } finally { busyRef.current = false; setBusy(''); }
  }

  function changeDraft(patch: Partial<HandoverDraft>) {
    setDraft((previous) => ({ ...previous, ...patch })); setDirty(true); setSuggestion(null);
  }
  function acceptHandover(handover: CompanyHandover) {
    setSelectedId(handover.id); setDraft(draftFromHandover(handover)); setStepsText(handover.steps.map((step) => step.text).join('\n'));
    setDraftRevision(handover.revision); setDirty(false); setRevising(false); setSuggestion(null); setAccessReviewed(false);
  }
  function chooseHandover(id: string) {
    const handover = state?.handovers.find((item) => item.id === id);
    if (handover) acceptHandover(handover);
    else { setSelectedId(''); setDraft(emptyHandoverDraft()); setStepsText(''); setDraftRevision(0); setDirty(false); setRevising(false); setSuggestion(null); }
    setPendingSelection(null); setQuestion(''); setOpenSource(null); setAccessReviewed(false);
    setExportPassword(''); setExportApproved(false); setExported(undefined);
    requestRef.current = null; questionRef.current = null;
  }
  function requestSelection(id: string) {
    if (id && id === selectedId) return;
    if (dirty) setPendingSelection(id); else chooseHandover(id);
  }
  function draftWithSteps(): HandoverDraft {
    const used = new Set<string>();
    const steps = stepsText.split('\n').map((text) => text.trim()).filter(Boolean).map((text) => {
      const old = draft.steps.find((step) => step.text === text && step.id && !used.has(step.id));
      if (old?.id) used.add(old.id);
      return { ...(old?.id ? { id: old.id } : {}), text };
    });
    return { ...draft, steps };
  }
  async function saveDraft() {
    if (!editable) return;
    const value = draftWithSteps();
    const key = JSON.stringify(value);
    if (!requestRef.current || requestRef.current.key !== key) requestRef.current = { key, id: crypto.randomUUID() };
    const result = await act({ kind: 'handover_save', ...(selected ? { id: selected.id } : { requestId: requestRef.current.id }), expectedRevision: draftRevision, draft: value }, '업무와 자료의 인계 시점을 기록하고 있습니다…');
    if (successful(result) && result?.handover) acceptHandover(result.handover);
  }
  async function changeStage(kind: string, extra: Record<string, unknown>, label: string) {
    if (!selected || !savedClean) return;
    const result = await act({ kind, id: selected.id, expectedRevision: draftRevision, ...extra }, label);
    if (successful(result) && result?.handover) acceptHandover(result.handover);
  }
  async function askQuestion() {
    if (!selected || !canAsk || !question.trim()) return;
    const key = `${selected.id}:${question.trim()}`;
    if (!questionRef.current || questionRef.current.key !== key) questionRef.current = { key, id: crypto.randomUUID() };
    const result = await act({ kind: 'handover_ask', id: selected.id, expectedRevision: draftRevision, question: question.trim(), requestId: questionRef.current.id }, '승인한 자료에서 근거와 다음 단계를 찾고 있습니다…');
    if (successful(result) && result?.answer) {
      setQuestion(''); questionRef.current = null;
      const handover = result.handover || result.handoverState?.handovers.find((item) => item.id === selected.id);
      if (handover) setDraftRevision(handover.revision);
    }
  }
  async function refresh() {
    const result = await act({ kind: 'handover_status' }, '최신 인수인계·회사 자료를 확인하고 있습니다…');
    if (!dirty && selectedId && result?.handoverState) {
      const handover = result.handoverState.handovers.find((item) => item.id === selectedId);
      if (handover) acceptHandover(handover);
    }
  }
  async function readSource(sourceId: string) {
    if (!selected) return;
    const result = await act({ kind: 'handover_read_source', id: selected.id, sourceId }, '승인 당시의 자료와 현재 원본을 확인하고 있습니다…');
    if (result?.record) setOpenSource(result.record);
  }
  async function exportHandover() {
    if (!selected || !savedClean || !exportApproved || exportPassword.length < 12 || exportPassword.length > 128) return;
    const result = await act({ kind: 'handover_export', id: selected.id, expectedRevision: draftRevision, password: exportPassword, approved: true }, '선택한 자료를 암호로 보호해 저장하고 있습니다…');
    if (successful(result) && result?.file) { setExported(result.file); setExportPassword(''); setExportApproved(false); }
  }
  async function previewImport() {
    if (importPassword.length < 12 || importPassword.length > 128) return;
    setPreview(null); setImportApproved(false);
    const result = await act({ kind: 'handover_import_preview', password: importPassword }, '가져올 파일을 선택하고 내용을 확인하고 있습니다…');
    if (successful(result) && result?.transferPreview) { setPreview(result.transferPreview); setImportPassword(''); }
  }
  async function applyImport() {
    if (!preview || !importApproved || dirty) return;
    const result = await act({ kind: 'handover_import_apply', token: preview.token, approved: true }, '이 PC에 새 인수인계 초안을 만들고 있습니다…');
    if (successful(result) && result?.handover) {
      acceptHandover(result.handover); setQuestion(''); setOpenSource(null); setPreview(null); setImportPassword(''); setImportApproved(false);
      requestRef.current = null; questionRef.current = null;
      await act({ kind: 'handover_status' }, '가져온 회사 자료를 확인하고 있습니다…');
    }
  }

  const answerCard = (answer: HandoverAnswer) => <article key={answer.id} className={styles.answer} data-testid="handover-answer">
    <div className={styles.row}><h3>{answer.question}</h3><span className={styles.badge}>{answer.status === 'answered' ? '근거 확인' : '확인 필요'}</span></div>
    <p className={styles.text}>{answer.answer}</p>
    {answer.citations?.length > 0 && <div className={styles.stack}><strong>답변의 근거</strong>{answer.citations.map((citation, index) => <div key={`${citation.sourceId}-${index}`} className={styles.citation}>
      <div className={styles.row}><strong>{citation.name}</strong>{!citation.sourceId.startsWith('procedure:') && <button onClick={() => readSource(citation.sourceId)}>자료 원문 보기</button>}</div>
      <small className={styles.muted}>버전 {citation.version} · {citation.startLine === citation.endLine ? `${citation.startLine}행` : `${citation.startLine}–${citation.endLine}행`}</small>
      <blockquote>{citation.quote}</blockquote>
      <details><summary>자료 확인 정보</summary><p className={styles.muted}>원본 해시 {citation.hash}</p></details>
    </div>)}</div>}
    {answer.aiExplanation && <details><summary>AI 안내 · 원문 확인</summary><p className={styles.text}>{answer.aiExplanation}</p><p className={styles.muted}>AI가 풀어 쓴 안내입니다. 실제 업무 기준은 위 원문과 확인된 절차를 확인하세요.</p></details>}
    {Boolean(answer.nextSteps?.length) && <div><strong>다음에 할 일</strong><ol>{answer.nextSteps.map((text, index) => <li key={index}>{text}</li>)}</ol></div>}
    {Boolean(answer.missing?.length) && <div className={styles.warning}><strong>담당자에게 확인할 내용</strong><ul>{answer.missing.map((text, index) => <li key={index}>{text}</li>)}</ul></div>}
    <small className={styles.muted}>{dateLabel(answer.createdAt)}{answer.handoverRevision ? ` · 인수인계 버전 ${answer.handoverRevision}의 답변` : ''}</small>
  </article>;

  return <section className={styles.panel} data-testid="company-handover-panel" aria-label="회사 인수인계">
    <header className={styles.header}><div><h2>사람이 바뀌어도 이어지는 업무</h2><p className={styles.muted}>회사 자료와 절차를 남기고, 새 담당자가 물어보며 이어받을 수 있게 도와줍니다.</p></div><button disabled={Boolean(busy)} onClick={refresh}>인수인계 새로고침</button></header>
    <p role={error ? 'alert' : 'status'} className={`${styles.message} ${error ? styles.error : ''}`}>{message}</p>
    {pendingNavigation && <div className={styles.warning} role="alert" tabIndex={-1} ref={navigationNoticeRef} data-testid="handover-navigation-warning"><p>작성 중인 내용이 있습니다. 저장한 뒤 이동하거나 작성 내용을 버리고 이동하세요.</p><div className={styles.actions}><button onClick={() => setPendingNavigation(null)}>이동 취소</button><button disabled={Boolean(busy)} onClick={discardAndNavigate}>저장하지 않고 이동</button></div></div>}
    <fieldset className={styles.stack} disabled={!state || Boolean(busy)} aria-busy={Boolean(busy)}>
      {pendingSelection !== null && <div className={styles.warning} role="alert"><p>아직 저장하지 않은 내용이 있습니다. 다른 인수인계를 열기 전에 저장하거나 작성 내용을 정리해 주세요.</p><div className={styles.actions}><button onClick={() => { chooseHandover(pendingSelection); }}>작성 내용 버리고 이동</button><button onClick={() => setPendingSelection(null)}>계속 작성</button></div></div>}
      <section className={styles.card}><div className={styles.row}><h3>우리 회사 인수인계</h3><button onClick={() => requestSelection('')}>새 인수인계</button></div>
        {!state?.handovers.length ? <p className={styles.muted}>첫 인수인계를 만들어 보세요. 자주 하는 업무, 판단 기준, 미완료 업무를 함께 남길 수 있습니다.</p> : <div className={styles.list}>{state.handovers.map((item) => <button key={item.id} className={`${styles.listButton} ${item.id === selectedId ? styles.selected : ''}`} aria-pressed={item.id === selectedId} onClick={() => requestSelection(item.id)}><span><strong>{item.title || '제목 없는 초안'}</strong><small>{item.fromPerson || '기존 담당자 미입력'} → {item.toPerson || '새 담당자 미입력'} · {dateLabel(item.updatedAt)}</small></span><span className={styles.badge}>{handoverStatusLabels[item.status]}</span></button>)}</div>}
      </section>

      <section className={styles.card}>
        <div className={styles.row}><h3>{selected ? selected.title || '인수인계 내용' : '새 인수인계 작성'}</h3><span className={styles.badge}>{selected ? `${handoverStatusLabels[selected.status]} · 버전 ${selected.revision}` : '새 초안'}</span></div>
        {selected && selected.revision !== draftRevision && <div className={styles.warning}><p>다른 창에서 변경한 새 버전이 있습니다. 지금 작성한 내용은 보존하고 있습니다. 최신 내용을 다시 열면 저장하지 않은 내용은 사라집니다.</p><button onClick={() => dirty ? setPendingSelection(selected.id) : chooseHandover(selected.id)}>최신 내용으로 다시 열기</button></div>}
        <ol className={styles.progress} aria-label="인수인계 진행 단계">{stageOrder.map((status, index) => <li key={status} className={(selected?.status || 'draft') === status ? styles.current : ''} aria-current={(selected?.status || 'draft') === status ? 'step' : undefined}>{index + 1}. {['작성·검토', '인수 요청', '업무 익히기', '완료'][index]}</li>)}</ol>
        {!editable && <div className={styles.stack}><p className={styles.muted}>승인한 절차와 자료가 현재 인수인계의 기준입니다. 자료나 업무가 바뀌었다면 내용을 수정하고 다시 검토해 주세요.</p><button disabled={!savedClean} onClick={() => { setRevising(true); setAccessReviewed(false); }}>인계 내용 수정</button></div>}
        {revising && <div className={styles.warning}><p>수정 내용을 저장하면 새 초안으로 돌아갑니다. 승인·인수 확인·단계 완료를 다시 확인해야 합니다. 이전 버전의 질문은 변경 이력에 보관합니다.</p><button onClick={() => { if (selected) acceptHandover(selected); }}>수정 취소 · 승인 내용 유지</button></div>}
        <fieldset className={styles.stack} disabled={!editable}>
          <div className={styles.two}><label>인수인계 제목<input value={draft.title} maxLength={160} onChange={(event) => changeDraft({ title: event.target.value })} placeholder="예: 영업 담당자 견적·납기 업무"/></label><label>인수인계 목적<select value={draft.purpose} onChange={(event) => changeDraft({ purpose: event.target.value as HandoverPurpose })}>{Object.entries(handoverPurposeLabels).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label></div>
          <div className={styles.two}><label>보내는 사람<input value={draft.fromPerson} maxLength={100} onChange={(event) => changeDraft({ fromPerson: event.target.value })} placeholder="기존 담당자 또는 자료 정리 담당자"/></label><label>받는 사람<input value={draft.toPerson} maxLength={100} onChange={(event) => changeDraft({ toPerson: event.target.value })} placeholder="새 담당자 이름"/></label></div>
          <label>담당 부서<select value={draft.departmentId} onChange={(event) => changeDraft({ departmentId: event.target.value })}><option value="">부서 지정 안 함</option>{departments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}</select></label>
          <label>업무 개요<textarea value={draft.summary} rows={4} maxLength={6000} onChange={(event) => changeDraft({ summary: event.target.value })} placeholder="업무의 목적, 자주 생기는 문제, 판단 기준과 주의할 점을 적어 주세요."/></label>
          <details><summary>참고할 회사 자료 · {draft.sourceIds.length}개 선택</summary><div className={styles.stack}><p className={styles.muted}>자료·부서에서 가져온 문서 중 이 업무에 필요한 자료만 선택하세요. AI 정리를 요청하면 선택한 내용이 연결한 AI에 전달됩니다.</p>{records.length ? <div className={styles.checklist}>{records.map((record) => <label key={record.id} className={styles.check}><input type="checkbox" checked={draft.sourceIds.includes(record.id)} onChange={() => changeDraft({ sourceIds: toggle(draft.sourceIds, record.id) })}/><span>{record.name}<small className={styles.muted}>버전 {record.version} · {record.format.toUpperCase()}</small></span></label>)}</div> : <p className={styles.muted}>아직 가져온 자료가 없습니다. 직접 업무 절차를 작성하거나, 자료·부서에서 문서를 가져온 뒤 새로고침하세요.</p>}
            {draft.sourceIds.some((id) => !records.some((record) => record.id === id)) && <p className={styles.warning}>선택했던 자료 중 현재 목록에 없는 자료가 있습니다. 저장하거나 승인하기 전에 자료 상태를 확인해 주세요.</p>}
          </div></details>
          <details><summary>이어서 처리할 업무 · {draft.workIds.length}개 선택</summary><div className={styles.stack}><p className={styles.muted}>현재 요청과 처리 상태를 인계 시점의 기록으로 남깁니다. 선택해도 업무를 자동으로 다시 실행하지 않습니다.</p>{availableWorks.length ? <div className={styles.checklist}>{availableWorks.map((work) => <label key={work.id} className={styles.check}><input type="checkbox" checked={draft.workIds.includes(work.id)} onChange={() => changeDraft({ workIds: toggle(draft.workIds, work.id) })}/><span>{work.request}<small className={styles.muted}>{companyStatusLabel[work.status] || work.status} · {dateLabel(work.createdAt)}</small></span></label>)}</div> : <p className={styles.muted}>현재 목록에 진행 중인 회사 업무가 없습니다.</p>}</div></details>
          <label>업무 절차 · 한 줄에 한 단계<textarea value={stepsText} rows={6} onChange={(event) => { setStepsText(event.target.value); setDirty(true); setSuggestion(null); }} placeholder={'메일의 요청 품목과 납기일을 확인한다.\n기존 단가표에서 적용 단가를 확인한다.\n예외 할인은 영업 책임자에게 확인한다.'}/></label>
        </fieldset>
        {editable && <><div className={styles.actions}><button className={styles.primary} onClick={saveDraft}>인수인계 저장</button><button disabled={!savedClean} onClick={async () => { const result = await act({ kind: 'handover_suggest', id: selected!.id, expectedRevision: draftRevision }, '자료와 기존 업무에서 인수인계 초안을 정리하고 있습니다…'); if (successful(result) && result?.suggestion) setSuggestion(result.suggestion); }}>자료로 절차 초안 만들기</button>{dirty && <span className={styles.muted}>저장하지 않은 내용이 있습니다.</span>}</div><p className={styles.muted}>먼저 내용을 저장한 뒤 AI 초안을 요청할 수 있습니다. AI가 제안한 절차는 검토하고 적용해야 반영됩니다.</p></>}
        {suggestion && <div className={styles.proposal}><h3>검토할 AI 초안</h3><p className={styles.text}>{suggestion.summary}</p><ol>{suggestion.steps.map((text, index) => <li key={index}>{text}</li>)}</ol>{Boolean(suggestion.missing.length) && <div><strong>추가 확인할 내용</strong><ul>{suggestion.missing.map((text, index) => <li key={index}>{text}</li>)}</ul></div>}<p className={styles.muted}>적용하면 작성 중인 업무 개요와 절차가 이 초안으로 바뀝니다.</p><div className={styles.actions}><button onClick={() => { changeDraft({ summary: suggestion.summary }); setStepsText(suggestion.steps.join('\n')); setSuggestion(null); }}>검토한 초안을 작성란에 적용</button><button onClick={() => setSuggestion(null)}>초안 닫기</button></div></div>}
        {selected && selected.status === 'draft' && <div className={styles.proposal}><h3>업무 기준을 확인하고 인수를 요청하세요</h3><p>받는 사람, 절차, 선택한 자료를 확인해 주세요. 승인하면 이 버전을 기준으로 질문에 답하고 진행 상황을 기록합니다.</p><button className={styles.primary} disabled={!savedClean || !selected.title.trim() || !selected.toPerson.trim() || !selected.steps.length} onClick={() => changeStage('handover_approve', { approved: true }, '검토한 절차와 자료를 인수 기준으로 확정하고 있습니다…')}>검토 완료 · 인수 요청</button></div>}
        {selected && selected.status === 'ready' && !revising && <div className={styles.proposal}><h3>{selected.toPerson}님이 업무를 이어받을 차례입니다</h3><p>전달받은 자료와 절차를 확인했으면 인수를 시작하세요. 모르는 내용은 아래에서 물어볼 수 있습니다.</p><button className={styles.primary} disabled={!savedClean} onClick={() => changeStage('handover_accept', { accepted: true }, '새 담당자의 업무 인수 확인을 기록하고 있습니다…')}>업무 인수 확인</button></div>}
        {selected && selected.status !== 'draft' && !revising && <>
          <div className={styles.row}><h3>업무를 익히며 확인하세요</h3><span className={styles.badge}>{stepsDone} / {selected.steps.length} 완료</span></div>
          <div className={styles.procedure}>{selected.steps.map((step, index) => <label key={step.id} className={`${styles.check} ${step.done ? styles.done : ''}`}><input type="checkbox" checked={step.done} disabled={selected.status !== 'active' || !savedClean} onChange={(event) => changeStage('handover_step', { stepId: step.id, done: event.target.checked }, '업무 절차 확인을 기록하고 있습니다…')}/><span><strong>{index + 1}. {step.text}</strong>{step.completedAt && <small className={styles.muted}>{dateLabel(step.completedAt)} 확인</small>}</span></label>)}</div>
          {selected.status === 'active' && <div className={styles.stack}><label className={styles.check}><input type="checkbox" checked={accessReviewed} onChange={(event) => setAccessReviewed(event.target.checked)}/><span>계정·자료 접근 권한을 별도로 확인했습니다.<small className={styles.muted}>이 확인은 기록으로 남습니다. 앱이 계정 권한을 변경하거나 회수하지는 않습니다.</small></span></label><button className={styles.primary} disabled={!savedClean || !accessReviewed || !selected.steps.length || stepsDone !== selected.steps.length} onClick={() => changeStage('handover_complete', { confirmed: true, accessReviewed: true }, '인수인계 완료와 확인 내역을 기록하고 있습니다…')}>인수인계 완료</button></div>}
          {selected.status === 'completed' && <p className={styles.message}>인수인계를 완료했습니다. {dateLabel(selected.completedAt)} · 남겨 둔 자료와 질문 기록은 계속 확인할 수 있습니다.</p>}
        </>}
        {selected && <details><summary>인계 시점의 자료·업무와 확인 기록</summary><div className={styles.stack}><dl className={styles.facts}><dt>검토 승인</dt><dd>{dateLabel(selected.approvedAt)}</dd><dt>업무 인수</dt><dd>{dateLabel(selected.acceptedAt)}</dd><dt>인수인계 완료</dt><dd>{dateLabel(selected.completedAt)}</dd></dl>{selected.sourceEvidence.map((source) => <div key={source.id} className={styles.row}><span>{source.name} · 버전 {source.version}</span><button onClick={() => readSource(source.id)}>자료 원문 보기</button></div>)}{selected.workSnapshots.map((work) => <details key={work.id}><summary>{work.request.split('\n')[0]} · {companyStatusLabel[work.status] || work.status}</summary><p className={styles.muted}>{dateLabel(work.createdAt)} 생성{work.capturedAt ? ` · ${dateLabel(work.capturedAt)} 인계 시점의 기록` : ' · 인계 시점의 기록'}</p><p className={styles.text}>{work.request}</p>{work.result && <p className={styles.text}>{work.result}</p>}</details>)}<p className={styles.muted}>담당자 이름과 인수 확인은 이 PC에서 남긴 기록입니다. 실제 회사 계정의 본인 확인·접근 권한 변경은 연결된 서비스에서 관리해 주세요.</p></div></details>}
        {selected && selected.history.some((entry) => entry.action === 'revised') && <details><summary>변경 이력·이전 질문 기록</summary><div className={styles.stack}>{selected.history.filter((entry) => entry.action === 'revised').slice().reverse().map((entry, index) => <details key={`${entry.at}-${index}`}><summary>{dateLabel(entry.at)} 개정 · 이전 버전 {entry.snapshot?.revision || '—'} · 질문 {entry.snapshot?.questions?.length || 0}개</summary><div className={styles.stack}>{(entry.snapshot?.questions || []).map(answerCard)}{!entry.snapshot?.questions?.length && <p className={styles.muted}>이전 버전에 저장한 질문이 없습니다.</p>}</div></details>)}</div></details>}
      </section>

      {selected && <section className={styles.card}><h3>기존 자료에 물어보며 업무 이어가기</h3><p>예전 담당자가 없어도 남아 있는 자료와 확인된 절차에서 답변의 근거를 찾습니다. 자료에 없는 내용은 확인할 항목으로 남깁니다.</p><label>업무 질문<textarea value={question} rows={3} maxLength={1500} onChange={(event) => setQuestion(event.target.value)} disabled={!canAsk} placeholder="이 업무는 어떤 순서로 처리하나요? 예외 상황은 누구에게 확인하나요?"/></label><div className={styles.actions}><button className={styles.primary} disabled={!canAsk || !question.trim()} onClick={askQuestion}>자료에 물어보기</button>{!canAsk && <span className={styles.muted}>저장한 인수인계를 검토 승인한 뒤 질문할 수 있습니다.</span>}</div><p className={styles.muted}>질문 시 선택한 인수인계 자료가 연결한 AI에 전달될 수 있습니다.</p>{(selected.questions || []).slice().reverse().map(answerCard)}</section>}
      {openSource && <section className={styles.card} aria-label="인수인계 자료 원문"><div className={styles.row}><h3>{openSource.name} · 버전 {openSource.version}</h3><button onClick={() => setOpenSource(null)}>원문 닫기</button></div><p className={styles.muted}>가져온 자료에서 읽은 텍스트입니다. 문서의 시각적 서식과 다를 수 있습니다.</p><div className={styles.source}>{openSource.text ? <ol>{openSource.text.split('\n').map((line, index) => <li key={index}>{line || '\u00a0'}</li>)}</ol> : <p>읽을 수 있는 본문이 없습니다. 표 또는 원본 문서를 확인해 주세요.</p>}</div>{openSource.tables?.map((table, index) => <details key={index}><summary>{table.name} · {table.rowCount}행</summary><div className={styles.source}><ol>{table.rows.map((row, rowIndex) => <li key={rowIndex}>{row.join(' | ')}</li>)}</ol></div></details>)}</section>}

      <section className={styles.card}><details><summary>회사 자료·인수인계를 다른 PC로 옮기기</summary><div className={styles.stack}><p>선택한 자료와 인수인계 기록만 이전합니다. 계정·메일·메신저·자동화는 새 PC에서 다시 연결합니다.</p>
        <div className={styles.transfer}><h3>이 PC에서 이전 파일 만들기</h3><p className={styles.muted}>현재 선택한 인수인계와 참고 자료를 암호로 보호해 저장합니다. 이전받는 사람에게 암호를 따로 전달해 주세요.</p>{selected ? <p><strong>{selected.title}</strong> · 회사 자료 {selected.sourceIds.length}개</p> : <p className={styles.muted}>먼저 내보낼 인수인계를 선택하고 저장해 주세요.</p>}<label>이전 파일 암호<input type="password" autoComplete="new-password" minLength={12} maxLength={128} value={exportPassword} onChange={(event) => setExportPassword(event.target.value)} placeholder="12~128자"/></label><label className={styles.check}><input type="checkbox" checked={exportApproved} onChange={(event) => setExportApproved(event.target.checked)}/><span>선택한 회사 자료와 인수인계 기록의 이전을 승인합니다.</span></label><button disabled={!savedClean || !exportApproved || exportPassword.length < 12 || exportPassword.length > 128} onClick={exportHandover}>승인하고 이전 파일 저장</button>{exported && <div className={styles.message}><strong>이전 파일을 저장했습니다.</strong><p>{exported.name}</p><p className={styles.muted}>{exported.path}</p></div>}</div>
        <div className={styles.transfer}><h3>새 PC에서 이전 파일 가져오기</h3><p className={styles.muted}>파일을 확인한 뒤 새 초안으로 가져옵니다. 기존 회사 자료나 인수인계는 덮어쓰지 않습니다.</p><label>가져올 파일의 암호<input type="password" autoComplete="off" minLength={12} maxLength={128} value={importPassword} onChange={(event) => { setImportPassword(event.target.value); setPreview(null); setImportApproved(false); }} placeholder="이전 파일을 만들 때 정한 암호"/></label><button disabled={importPassword.length < 12 || importPassword.length > 128} onClick={previewImport}>이전 파일 선택·내용 확인</button>{preview && <div className={styles.proposal}><h3>가져올 내용 확인</h3><dl className={styles.facts}><dt>보낸 회사</dt><dd>{preview.companyName || '회사명 미입력'}</dd><dt>인수인계</dt><dd>{preview.title}</dd><dt>만든 일시</dt><dd>{dateLabel(preview.createdAt)}</dd><dt>회사 자료</dt><dd>{preview.recordCount}개</dd></dl>{preview.recordNames.length > 0 && <ul>{preview.recordNames.map((name, index) => <li key={index}>{name}</li>)}</ul>}{preview.exclusions.length > 0 && <div><strong>함께 이전되지 않는 항목</strong><ul>{preview.exclusions.map((text, index) => <li key={index}>{text}</li>)}</ul></div>}<p className={styles.muted}>확인 유효 시간: {dateLabel(preview.expiresAt)}. 새 PC에서는 회사 자료를 다시 검토하고 계정을 연결하세요.</p><label className={styles.check}><input type="checkbox" checked={importApproved} onChange={(event) => setImportApproved(event.target.checked)}/><span>위 자료를 이 PC에 가져오고 새 인수인계 초안을 만드는 데 동의합니다.</span></label>{dirty && <p className={styles.warning}>현재 작성 중인 인수인계를 먼저 저장해 주세요.</p>}<div className={styles.actions}><button className={styles.primary} disabled={!importApproved || dirty} onClick={applyImport}>확인한 자료 가져오기</button><button onClick={() => { setPreview(null); setImportApproved(false); }}>가져오기 취소</button></div></div>}</div>
      </div></details></section>
    </fieldset>
  </section>;
}
