'use client';

import { useEffect, useRef, useState } from 'react';
import { createDesktopBridge } from '@/lib/desktop-bridge';
import type { CompanyState } from '@/lib/company-automation';
import { buildProviderModelChoices } from '@/lib/model-catalog';
import { buildQuickAutomationPlan, normalizeQuickAutomationRoot, QUICK_AUTOMATION_DRAFT_KEY, readQuickAutomationDraft, type QuickAutomationDraft } from '@/lib/automation-quick-plan';
import styles from './AutomationQuickSetup.module.css';

type ConnectKind = 'ai' | 'mail' | 'sources' | 'messenger';
type Props = { initialRequest?: string; onConnect?: (kind: ConnectKind) => void; onSaved?: () => void };
type ReadyState = { company: CompanyState; root: string; aiReady: boolean; aiLabel: string };
const examples = ['매주 월요일 오전 9시에 회사 자료로 운영 보고서 초안을 만들어 줘', '새 메일이 오면 문의 내용을 정리하고 답변 초안을 만들어 줘', '매일 오전 9시에 오늘 업무를 준비할 체크리스트를 만들어 줘'];

export default function AutomationQuickSetup({ initialRequest = '', onConnect, onSaved }: Props) {
  const [request, setRequest] = useState(initialRequest);
  const [ready, setReady] = useState<ReadyState | null>(null);
  const [connectionId, setConnectionId] = useState('');
  const [mailAccountId, setMailAccountId] = useState('');
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState('준비 상태 확인 중');
  const [message, setMessage] = useState('연결한 AI와 회사 자료를 확인하고 있습니다.');
  const [error, setError] = useState(false);
  const [storageError, setStorageError] = useState(false);
  const draftRef = useRef<QuickAutomationDraft | null>(null);
  const initialRequestRef = useRef(initialRequest);
  const mountedRef = useRef(true);
  const busyRef = useRef(false);
  const generationRef = useRef(0);

  function persist(draft: QuickAutomationDraft) {
    draftRef.current = draft;
    try { sessionStorage.setItem(QUICK_AUTOMATION_DRAFT_KEY, JSON.stringify(draft)); setStorageError(false); return true; }
    catch { setStorageError(true); setError(true); setMessage('요청을 임시 보관하지 못했습니다. 설정을 이동하기 전에 입력한 문장을 복사하고 앱을 다시 열어 주세요.'); return false; }
  }

  async function readReady(): Promise<ReadyState> {
    const bridge = createDesktopBridge();
    if (!bridge.isAvailable) throw new Error('간편 자동화는 설치된 ModyCrew 앱에서 시작할 수 있습니다.');
    const [companyResult, memory, ai] = await Promise.all([bridge.companyAutomation({ kind: 'status' }), bridge.getLocalMemoryStatus(), bridge.getAIProviderStatus()]);
    if (!companyResult.state || companyResult.status !== 'ready') throw new Error(companyResult.userMessage || '회사 운영 상태를 확인해 주세요.');
    if (!companyResult.state.scopeId) throw new Error('회사 운영 저장 범위를 확인하지 못했습니다. 앱을 업데이트하거나 준비 상태를 다시 확인해 주세요.');
    if (!memory.root?.trim() || /error|failed|unavailable|desktop_required/u.test(memory.status)) throw new Error('현재 기억 저장 위치를 확인하지 못했습니다. 앱 연결을 확인하고 준비 상태를 다시 확인해 주세요.');
    const selected = ai.providers.find((provider) => ai.activeProvider ? provider.provider === ai.activeProvider : provider.isActive);
    let availability = selected?.modelAvailability;
    if (selected?.provider && selected.hasLocalKey && selected.status !== 'codex_oauth_detected') {
      try { availability = (await bridge.listAIProviderModels(selected.provider, { forceRefresh: true })).modelAvailability; }
      catch { availability = undefined; }
    }
    const credentialReady = Boolean(selected?.hasLocalKey && (selected.provider === 'codex_oauth' ? selected.status === 'codex_oauth_ready' : selected.chatContentAllowed === true));
    const modelReady = selected?.provider ? buildProviderModelChoices(selected.provider, selected.provider, { ready: credentialReady, modelAvailability: availability }, []).some((choice) => choice.id === selected.model && choice.ready) : false;
    return { company: companyResult.state, root: memory.root, aiReady: modelReady, aiLabel: modelReady ? `${selected?.model} · 연결한 계정에서 확인됨` : selected?.hasLocalKey ? '선택한 AI 모델을 계정에서 확인해 주세요' : 'AI 계정 연결이 필요합니다' };
  }

  function receiveReady(next: ReadyState) {
    const previous = draftRef.current;
    if (!previous || normalizeQuickAutomationRoot(previous.root) !== normalizeQuickAutomationRoot(next.root)) {
      let raw: string | null = null;
      try { raw = sessionStorage.getItem(QUICK_AUTOMATION_DRAFT_KEY); } catch { setStorageError(true); }
      const restored = readQuickAutomationDraft(raw, next.root);
      const draft: QuickAutomationDraft = restored || { request: raw ? '' : initialRequestRef.current, root: next.root, setupId: crypto.randomUUID(), createdAt: Date.now() };
      draft.saved = next.company.rules.some((rule) => rule.setupId === draft.setupId);
      if (!draft.nextRunAt) draft.nextRunAt = buildQuickAutomationPlan(draft.request, next.company.departments).nextRunAt;
      // Keep the exact reviewed first occurrence stable across navigation and response-loss retries.
      if (draft.request) persist(draft); else draftRef.current = draft;
      setRequest(draft.request); setSaved(draft.saved === true); setConnectionId(draft.connectionId || '');
      if (raw && !restored) { setMessage('저장 위치가 달라 이전 요청을 가져오지 않았습니다. 이 위치에서 새 자동화를 입력해 주세요.'); setError(false); }
    } else {
      const isSaved = next.company.rules.some((rule) => rule.setupId === previous.setupId);
      if (previous.saved !== isSaved) persist({ ...previous, saved: isSaved });
      setSaved(isSaved);
    }
    setReady(next);
  }

  async function refresh() {
    if (busyRef.current) return;
    busyRef.current = true; const generation = ++generationRef.current; setBusy('준비 상태 확인 중'); setError(false);
    try { const next = await readReady(); if (mountedRef.current && generation === generationRef.current) { receiveReady(next); setMessage('자동화가 할 일과 시작 조건을 확인해 주세요.'); } }
    catch (reason) { if (mountedRef.current) { setReady(null); setError(true); setMessage(reason instanceof Error ? reason.message : '준비 상태를 확인하지 못했습니다. 다시 확인해 주세요.'); } }
    finally { busyRef.current = false; if (mountedRef.current) setBusy(''); }
  }

  useEffect(() => { mountedRef.current = true; void refresh(); return () => { mountedRef.current = false; generationRef.current += 1; }; }, []); // Initial props are deliberately not reapplied over the user's draft.

  function changeRequest(value: string) {
    setRequest(value); setSaved(false); setError(false);
    const current = draftRef.current;
    if (current) persist({ ...current, request: value, saved: false, setupId: current.saved || current.request !== value ? crypto.randomUUID() : current.setupId, nextRunAt: buildQuickAutomationPlan(value, ready?.company.departments || []).nextRunAt, createdAt: Date.now() });
  }
  function chooseConnection(value: string) {
    setConnectionId(value); setSaved(false);
    if (draftRef.current) persist({ ...draftRef.current, connectionId: value, setupId: crypto.randomUUID(), saved: false });
  }
  function connect(kind: ConnectKind) {
    if (!draftRef.current || !persist({ ...draftRef.current, request, connectionId })) return;
    onConnect?.(kind);
  }

  const plan = buildQuickAutomationPlan(request, ready?.company.departments || []);
  if (draftRef.current?.request === request && draftRef.current.nextRunAt) plan.nextRunAt = draftRef.current.nextRunAt;
  const departments = ready?.company.departments.filter((department) => plan.departmentIds.includes(department.id)) || [];
  const approvedMail = ready?.company.connections.filter((connection) => connection.provider === 'mail' && connection.enabled && connection.scopeApprovedAt) || [];
  const selectedMail = approvedMail.find((connection) => connection.id === connectionId) || (approvedMail.length === 1 ? approvedMail[0] : undefined);
  const unapprovedMail = ready?.company.mailAccounts?.filter((account) => !ready.company.connections.some((connection) => connection.provider === 'mail' && connection.accountId === account.id && connection.enabled && connection.scopeApprovedAt)) || [];
  const selectedAccount = unapprovedMail.find((account) => account.id === mailAccountId) || (unapprovedMail.length === 1 ? unapprovedMail[0] : undefined);
  const missingSources = plan.sourceRequired ? departments.filter((department) => !department.sourceIds.some((id) => ready?.company.records.some((record) => record.id === id))) : [];
  const readyToStart = Boolean(ready?.aiReady && !plan.issues.length && !missingSources.length && (!plan.needsMail || selectedMail) && !storageError && draftRef.current && !saved);

  async function approveMail() {
    if (!selectedAccount || busyRef.current || !ready) return;
    const expectedRoot = ready.root;
    const expectedScopeId = ready.company.scopeId;
    busyRef.current = true; setBusy('메일 읽기 범위 연결 중'); setError(false);
    try {
      const fresh = await readReady();
      if (normalizeQuickAutomationRoot(fresh.root) !== normalizeQuickAutomationRoot(expectedRoot)) { receiveReady(fresh); throw new Error('저장 위치가 변경되었습니다. 이 위치의 요청과 계정을 다시 확인해 주세요.'); }
      if (fresh.company.scopeId !== expectedScopeId) { setReady(null); throw new Error('회사 운영 저장 범위가 변경되었습니다. 준비 상태를 다시 확인해 주세요.'); }
      const result = await createDesktopBridge().companyAutomation({ kind: 'connect_mail_source', expectedScopeId, accountId: selectedAccount.id, approved: true });
      if (result.status !== 'waiting_message' || !result.state) throw new Error(result.userMessage);
      const connection = result.state.connections.find((item) => item.provider === 'mail' && item.accountId === selectedAccount.id);
      if (connection) chooseConnection(connection.id);
      setReady({ ...fresh, company: result.state }); setMessage('선택한 메일함의 읽기 범위를 연결했습니다. 아래 내용을 확인하고 자동화를 시작해 주세요.');
    } catch (reason) { setError(true); setMessage(reason instanceof Error ? reason.message : '메일 연결을 완료하지 못했습니다.'); }
    finally { busyRef.current = false; if (mountedRef.current) setBusy(''); }
  }

  async function start() {
    if (!readyToStart || busyRef.current || !draftRef.current || !ready) return;
    const draft = { ...draftRef.current, request, connectionId: selectedMail?.id || '' };
    const expectedScopeId = ready.company.scopeId;
    const reviewedAssignment = JSON.stringify(ready.company.departments.filter((department) => plan.departmentIds.includes(department.id)).map((department) => ({ id: department.id, sourceIds: [...department.sourceIds].sort() })).sort((a, b) => a.id.localeCompare(b.id)));
    if (!persist(draft)) return;
    busyRef.current = true; setBusy('자동화 저장 중'); setError(false);
    try {
      const fresh = await readReady();
      if (!mountedRef.current) return;
      if (normalizeQuickAutomationRoot(fresh.root) !== normalizeQuickAutomationRoot(draft.root)) { receiveReady(fresh); throw new Error('저장 위치가 변경되었습니다. 이 위치에서 요청을 다시 확인해 주세요.'); }
      if (fresh.company.scopeId !== expectedScopeId) { setReady(null); throw new Error('회사 운영 저장 범위가 변경되었습니다. 준비 상태를 다시 확인해 주세요.'); }
      setReady(fresh);
      const freshPlan = buildQuickAutomationPlan(draft.request, fresh.company.departments);
      const currentAssignment = JSON.stringify(fresh.company.departments.filter((department) => freshPlan.departmentIds.includes(department.id)).map((department) => ({ id: department.id, sourceIds: [...department.sourceIds].sort() })).sort((a, b) => a.id.localeCompare(b.id)));
      if (currentAssignment !== reviewedAssignment) throw new Error('담당 부서나 읽을 자료가 변경되었습니다. 갱신된 계획을 확인한 뒤 다시 시작해 주세요.');
      if (!fresh.aiReady) throw new Error(fresh.aiLabel);
      if (freshPlan.issues.length) throw new Error(freshPlan.issues[0]);
      if (freshPlan.sourceRequired && freshPlan.departmentIds.some((id) => !fresh.company.departments.find((department) => department.id === id)?.sourceIds.some((sourceId) => fresh.company.records.some((record) => record.id === sourceId)))) throw new Error('담당 부서가 읽을 회사 자료를 연결한 뒤 다시 시작해 주세요.');
      if (freshPlan.needsMail && !fresh.company.connections.some((connection) => connection.id === draft.connectionId && connection.provider === 'mail' && connection.enabled && connection.scopeApprovedAt)) throw new Error('메일 연결 상태가 바뀌었습니다. 읽을 계정을 다시 확인해 주세요.');
      const result = await createDesktopBridge().companyAutomation({ kind: 'save_rule', setupId: draft.setupId, expectedScopeId, name: draft.request.trim().slice(0, 60), request: draft.request, departmentIds: freshPlan.departmentIds, trigger: freshPlan.trigger, nextRunAt: draft.nextRunAt || freshPlan.nextRunAt, repeat: freshPlan.repeat, connectionId: freshPlan.needsMail ? draft.connectionId : undefined, keywords: [] });
      if (result.status !== 'saved') throw new Error(result.userMessage || '자동화를 저장하지 못했습니다. 다시 시도해 주세요.');
      if (!mountedRef.current) return;
      persist({ ...draft, saved: true }); setSaved(true);
      if (result.state) setReady({ ...fresh, company: result.state });
      setMessage('자동화를 저장했습니다. 조건에 맞으면 회사 운영의 업무에서 진행 상태와 결과를 확인할 수 있습니다.');
      onSaved?.();
    } catch (reason) { if (mountedRef.current) { setError(true); setMessage(reason instanceof Error ? reason.message : '저장을 확인하지 못했습니다. 같은 요청으로 다시 시도하면 중복을 확인합니다.'); } }
    finally { busyRef.current = false; if (mountedRef.current) setBusy(''); }
  }

  return <section className={styles.panel} aria-labelledby="quick-automation-title" data-automation-quick-setup="request_to_existing_company_runner">
    <div className={styles.heading}><div><p className={styles.eyebrow}>간편 자동화</p><h2 id="quick-automation-title">하고 싶은 일을 말해 주세요</h2><p>연결한 AI와 회사 자료로 실행할 흐름을 준비합니다.</p></div><button type="button" disabled={Boolean(busy)} onClick={() => void refresh()}>연결 상태 다시 확인</button></div>
    <label className={styles.inputLabel} htmlFor="quick-automation-request">반복해서 맡길 업무</label>
    <textarea id="quick-automation-request" rows={3} maxLength={5000} value={request} disabled={Boolean(busy) || !ready} placeholder={examples[0]} onChange={(event) => changeRequest(event.target.value)} />
    <div className={styles.examples} aria-label="자동화 요청 예시">{examples.map((example, index) => <button type="button" key={example} disabled={Boolean(busy) || !ready} onClick={() => changeRequest(example)}>{['주간 보고서', '새 메일 답변 초안', '매일 체크리스트'][index]}</button>)}</div>
    <p className={styles.notice} role={error ? 'alert' : 'status'} data-error={error}>{busy || message}</p>
    {ready && <>
      <div className={styles.readiness} aria-label="자동화 준비 상태">
        <div data-ready={ready.aiReady}><strong>AI 연결</strong><span>{ready.aiLabel}</span>{!ready.aiReady && onConnect && <button type="button" disabled={Boolean(busy)} onClick={() => connect('ai')}>AI 연결 확인</button>}</div>
        <div data-ready={!missingSources.length}><strong>담당 부서</strong><span>{departments.map((department) => department.name).join(' · ') || '활성 부서 없음'}</span><small>{missingSources.length ? `${missingSources.map((department) => department.name).join(' · ')}에 읽을 자료가 필요합니다` : plan.sourceRequired ? '담당 부서에 지정한 자료를 사용합니다' : '추가 회사 자료가 필수인 요청은 아닙니다'}</small>{(missingSources.length > 0 || !departments.length) && onConnect && <button type="button" disabled={Boolean(busy)} onClick={() => connect('sources')}>자료·부서 연결</button>}</div>
        <div data-ready={!plan.needsMail || Boolean(selectedMail)}><strong>결과 확인</strong><span>회사 운영 → 업무</span><small>초안과 확인할 항목을 앱 안에 모읍니다.</small></div>
      </div>
      {plan.needsMail && <section className={styles.mail} aria-labelledby="quick-mail-title"><h3 id="quick-mail-title">읽을 메일함</h3>
        {approvedMail.length > 1 ? <label>계정 선택<select value={selectedMail?.id || ''} disabled={Boolean(busy)} onChange={(event) => chooseConnection(event.target.value)}><option value="">메일함을 선택해 주세요</option>{approvedMail.map((connection) => <option key={connection.id} value={connection.id}>{connection.name}</option>)}</select></label> : selectedMail ? <p>{selectedMail.name} · 승인한 읽기 범위 사용</p> : <p>메일함의 업무 분류와 읽기 범위를 한 번 승인해 주세요.</p>}
        {!selectedMail && unapprovedMail.length > 0 && <><label>이미 연결한 메일 계정<select value={selectedAccount?.id || ''} disabled={Boolean(busy)} onChange={(event) => setMailAccountId(event.target.value)}><option value="">메일 계정 선택</option>{unapprovedMail.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label><p>선택한 계정의 새 메일을 보안 분류한 뒤 업무 본문만 담당 부서에 전달합니다.</p><button type="button" disabled={!selectedAccount || Boolean(busy)} onClick={() => void approveMail()}>이 메일함의 업무 읽기 승인</button></>}
        {!selectedMail && onConnect && <button type="button" disabled={Boolean(busy)} onClick={() => connect('mail')}>메일 계정 연결</button>}
      </section>}
      {request.trim() && <section className={styles.preview} aria-labelledby="quick-preview-title">
        <h3 id="quick-preview-title">이렇게 이어집니다</h3>
        <ol>
          <li><strong>{plan.whenLabel}</strong>{plan.nextRunAt && <span>처음 실행: {new Date(plan.nextRunAt).toLocaleString('ko-KR')} · 이 PC 시간 기준{Date.parse(plan.nextRunAt) <= Date.now() ? ' · 예정 시각이 지나 시작 후 한 번 처리' : ''}</span>}</li>
          <li><strong>{departments.map((department) => department.name).join(' · ') || '담당 부서 확인'}가 요청을 처리</strong><span>{plan.needsMail ? '연결한 업무 메일과 지정한 자료를 읽고 초안을 작성합니다.' : plan.sourceRequired ? '지정한 회사 자료를 읽고 요청한 초안을 작성합니다.' : '요청에 맞는 초안을 작성하고 필요한 자료가 있으면 질문합니다.'}</span></li>
          <li><strong>마스터가 결과를 모아 검토</strong><span>자료가 부족하면 질문하고, 실패하면 같은 업무에서 다시 시도할 수 있습니다.</span></li>
          <li><strong>회사 운영의 업무에서 결과 확인</strong><span>{plan.notes[0]}</span></li>
        </ol>{plan.notes.slice(1).map((note) => <p key={note}>{note}</p>)}
      </section>}
      {request.trim() && plan.issues.length > 0 && <div className={styles.issues} role="status"><strong>시작 전에 확인해 주세요</strong><ul>{plan.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul>{plan.needsMessenger && onConnect && <button type="button" disabled={Boolean(busy)} onClick={() => connect('messenger')}>메일·메신저 확인</button>}</div>}
      <div className={styles.footer}><button type="button" className={styles.start} disabled={!readyToStart || Boolean(busy)} onClick={() => void start()}>{saved ? '자동화 저장됨' : '이대로 시작'}</button><p>시작하면 조건에 따라 읽기와 초안을 준비합니다. 외부 작업은 최종 승인을 기다립니다.</p></div>
    </>}
  </section>;
}
