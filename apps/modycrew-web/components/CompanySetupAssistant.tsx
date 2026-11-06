'use client';

import { useEffect, useRef, useState } from 'react';
import { createDesktopBridge } from '@/lib/desktop-bridge';
import { buildProviderModelChoices } from '@/lib/model-catalog';
import type { CompanyState, CompanyAutomationResult, CompanyDepartment, CompanySetupDepartment, CompanySetupPreview, CompanySetupProposal, CompanySetupWorkflow, CompanySetupReceipt } from '@/lib/company-automation';
import styles from './CompanySetupAssistant.module.css';

type Props = {
  company: CompanyState | null;
  initialSourceIds?: string[];
  disabledReason?: string;
  onState: (state: CompanyState) => void;
  onConnect: (kind: 'ai' | 'mail') => void;
  onOpenWork: (id: string) => void;
  onOpenRules: () => void;
};
const DRAFT_KEY = 'modycrew.company-setup.sources.v1';
const stages = ['폴더와 업무 목표', 'AI에 보낼 내용 확인', '직원 구성 검토', '설정 완료·첫 업무'];
const MAX_SOURCES = 20;
const union = (left: string[] = [], right: string[] = []) => [...new Set([...left, ...right])];
function suggestedAdditions(department: CompanySetupDepartment, references: CompanySetupProposal['references'], existingDepartments: CompanyDepartment[]): CompanySetupDepartment {
  const previous = existingDepartments.find((existing) => existing.id === department.existingDepartmentId);
  return {
    ...department,
    sourceIds: department.sourceIds.filter((id) => references.some((reference) => reference.id === id)),
    keywords: department.keywords.filter((item) => !previous?.keywords.includes(item)),
    responsibilities: department.responsibilities?.filter((item) => !previous?.responsibilities?.includes(item)),
    deliverables: department.deliverables?.filter((item) => !previous?.deliverables?.includes(item)),
  };
}
function assignDepartment(department: CompanySetupDepartment, existing?: CompanyDepartment, edits?: Partial<Pick<CompanyDepartment, 'name' | 'role'>>): CompanySetupDepartment {
  return {
    ...department,
    existingDepartmentId: existing?.id,
    name: edits?.name ?? existing?.name ?? department.name,
    role: edits?.role ?? existing?.role ?? department.role,
    sourceIds: union(existing?.sourceIds, department.sourceIds),
    keywords: union(existing?.keywords, department.keywords),
    responsibilities: union(existing?.responsibilities, department.responsibilities),
    deliverables: union(existing?.deliverables, department.deliverables),
  };
}
function departmentIssue(department: CompanySetupDepartment): string {
  if (!department.name.trim() || !department.role.trim()) return '직원 이름과 역할을 입력해 주세요.';
  if (department.sourceIds.length > (department.existingDepartmentId ? 200 : MAX_SOURCES)) return '참고 자료가 ' + (department.existingDepartmentId ? '200' : '20') + '개를 넘습니다. 새 직원으로 맡기거나 기존 직원의 자료 범위를 정리한 뒤 다시 추천받으세요.';
  if (department.keywords.length > 20 || department.keywords.some((keyword) => keyword.length > 40)) return '기존 업무 키워드와 추천 키워드가 허용 범위를 넘습니다. 새 직원으로 맡기거나 기존 업무 범위를 정리해 주세요.';
  if ([department.responsibilities, department.deliverables].some((items) => (items?.length ?? 0) > 6 || items?.some((item) => item.length > 160))) return '합친 맡길 일 또는 산출물이 6개·항목당 160자를 넘습니다. 새 직원으로 맡기거나 기존 업무 범위를 정리해 주세요.';
  return '';
}
const localTime = (iso?: string) => { if (!iso || !Number.isFinite(Date.parse(iso))) return ''; const d = new Date(iso); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
const nextMorning = () => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); return d.toISOString(); };

export default function CompanySetupAssistant({ company, initialSourceIds = [], disabledReason, onState, onConnect, onOpenWork, onOpenRules }: Props) {
  const [sourceIds, setSourceIds] = useState<string[]>([]);
  const [workGoal, setWorkGoal] = useState('');
  const [preview, setPreview] = useState<CompanySetupPreview | null>(null);
  const [proposal, setProposal] = useState<CompanySetupProposal | null>(null);
  const [departments, setDepartments] = useState<CompanySetupDepartment[]>([]);
  const [existingDepartments, setExistingDepartments] = useState<CompanyDepartment[]>([]);
  const [selectedDepartmentIds, setSelectedDepartmentIds] = useState<string[]>([]);
  const [workflows, setWorkflows] = useState<CompanySetupWorkflow[]>([]);
  const [selectedWorkflowIds, setSelectedWorkflowIds] = useState<string[]>([]);
  const [receipt, setReceipt] = useState<CompanySetupReceipt | null>(null);
  const [runIds, setRunIds] = useState<Record<string, string>>({});
  const [ai, setAi] = useState({ ready: false, label: 'AI 연결 확인 중' });
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('평소 사용하던 양식과 업무 자료를 선택하세요. 어떤 업무를 맡길지 AI가 제안합니다.');
  const [error, setError] = useState(false);
  const alive = useRef(true);
  const locked = useRef(false);
  const scope = useRef('');
  const setupId = useRef('');
  const departmentEdits = useRef<Record<string, Partial<Pick<CompanyDepartment, 'name' | 'role'>>>>({});
  const currentCompany = useRef(company);
  currentCompany.current = company;

  function clearPlan() { setPreview(null); setProposal(null); setDepartments([]); setExistingDepartments([]); setSelectedDepartmentIds([]); setWorkflows([]); setSelectedWorkflowIds([]); setReceipt(null); setRunIds({}); setupId.current = ''; departmentEdits.current = {}; }
  function remember(ids: string[], scopeId = scope.current) {
    // Keep only selected record IDs locally; source text and AI proposals are never persisted by this view.
    try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ scopeId, sourceIds: ids })); } catch { /* Selection remains in this view. */ }
  }
  async function refreshAI() {
    try {
      const bridge = createDesktopBridge();
      if (!bridge.isAvailable) { if (alive.current) setAi({ ready: false, label: '설치된 앱에서 AI를 연결하세요' }); return; }
      const status = await bridge.getAIProviderStatus();
      const provider = status.providers.find((item) => status.activeProvider ? item.provider === status.activeProvider : item.isActive);
      const credentialReady = Boolean(provider?.hasLocalKey && (provider.provider === 'codex_oauth' ? provider.status === 'codex_oauth_ready' : provider.chatContentAllowed === true));
      let availability = provider?.modelAvailability;
      if (provider?.provider && credentialReady) {
        try { availability = (await bridge.listAIProviderModels(provider.provider, { forceRefresh: true })).modelAvailability; } catch { availability = undefined; }
      }
      const ready = Boolean(provider?.provider && buildProviderModelChoices(provider.provider, provider.provider, { ready: credentialReady, modelAvailability: availability }, []).some((choice) => choice.id === provider.model && choice.ready));
      if (alive.current) setAi({ ready, label: ready ? `${provider?.model} 연결됨` : '사용할 AI 계정을 연결해 주세요' });
    } catch { if (alive.current) setAi({ ready: false, label: 'AI 연결을 다시 확인해 주세요' }); }
  }
  useEffect(() => { alive.current = true; void refreshAI(); return () => { alive.current = false; }; }, []);
  useEffect(() => {
    if (!company?.scopeId || scope.current === company.scopeId) return;
    const hadScope = Boolean(scope.current); scope.current = company.scopeId; clearPlan(); setWorkGoal('');
    let restored: string[] = [];
    try { const value = JSON.parse(sessionStorage.getItem(DRAFT_KEY) || 'null'); if (value?.scopeId === company.scopeId && Array.isArray(value.sourceIds)) restored = value.sourceIds; } catch { /* Start with an explicit empty selection. */ }
    const ids = [...new Set(initialSourceIds.length ? initialSourceIds : restored)].filter((id) => company.records.some((record) => record.id === id)).slice(0, MAX_SOURCES);
    setSourceIds(ids); remember(ids, company.scopeId);
    if (hadScope) { setNotice('회사 자료의 저장 위치가 바뀌었습니다. 사용할 자료를 다시 확인하세요.'); setError(true); }
  }, [company?.scopeId]); // Do not overwrite a selection when the parent polls for work status.
  const sourceSeed = initialSourceIds.join('|');
  useEffect(() => {
    if (!sourceSeed || !currentCompany.current?.scopeId) return;
    const ids = [...new Set(sourceSeed.split('|'))].filter((id) => currentCompany.current?.records.some((record) => record.id === id)).slice(0, MAX_SOURCES);
    clearPlan(); setSourceIds(ids); remember(ids);
  }, [sourceSeed]);

  async function act(label: string, operation: (scopeId: string) => Promise<CompanyAutomationResult>) {
    const expectedScopeId = currentCompany.current?.scopeId;
    if (locked.current || !expectedScopeId || disabledReason) return null;
    locked.current = true; setBusy(label); setError(false);
    try {
      const result = await operation(expectedScopeId);
      if (!alive.current || currentCompany.current?.scopeId !== expectedScopeId) return null;
      if (['error', 'desktop_required'].includes(result.status)) throw new Error(result.userMessage);
      if (result.state) onState(result.state);
      setNotice(result.userMessage); return result;
    } catch (reason) {
      if (alive.current && currentCompany.current?.scopeId === expectedScopeId) { setError(true); setNotice(reason instanceof Error ? reason.message : '완료하지 못했습니다. 연결 상태를 확인하고 다시 시도하세요.'); }
      return null;
    } finally { locked.current = false; if (alive.current) setBusy(''); }
  }
  function chooseSource(id: string) {
    const ids = sourceIds.includes(id) ? sourceIds.filter((item) => item !== id) : [...sourceIds, id];
    if (ids.length > MAX_SOURCES) { setError(true); setNotice('업무를 파악할 자료를 최대 20개까지 선택하세요.'); return; }
    clearPlan(); setSourceIds(ids); remember(ids); setError(false);
  }
  async function importFiles(selection: 'files' | 'folder' = 'files') {
    const result = await act('선택한 업무 자료를 이 PC로 가져오는 중', (expectedScopeId) => createDesktopBridge().companyAutomation({ kind: 'import_records', selection, expectedScopeId }));
    if (result?.status === 'imported') {
      clearPlan();
      const records = result.state?.records ?? currentCompany.current?.records ?? [];
      const imported = (result.importedSourceIds ?? []).filter((id) => records.some((record) => record.id === id));
      const candidates = union(imported, sourceIds).filter((id) => records.some((record) => record.id === id));
      const ids = candidates.slice(0, MAX_SOURCES);
      setSourceIds(ids); remember(ids);
      if (candidates.length > MAX_SOURCES) setNotice('가져온 자료 중 최대 20개를 먼저 선택했습니다. 추천에 사용할 자료를 확인해 주세요.');
    }
  }
  async function preparePreview() {
    const result = await act('이 PC에서 전송할 자료를 준비하는 중', (expectedScopeId) => createDesktopBridge().companyAutomation({ kind: 'preview_organization', sourceIds, workGoal, expectedScopeId }));
    if (result?.preview) { setPreview(result.preview); setExistingDepartments(result.preview.existingDepartments ?? []); setProposal(null); setReceipt(null); }
  }
  async function recommend() {
    if (!preview || !ai.ready) return;
    const result = await act('자료에 맞는 직원 구성과 맡길 업무를 추천하는 중', (expectedScopeId) => createDesktopBridge().companyAutomation({ kind: 'suggest_organization', approved: true, previewToken: preview.token, sourceIds: preview.sourceIds, expectedScopeId }));
    if (result?.proposal?.token) {
      const next = result.proposal; setProposal(next); setPreview(null); departmentEdits.current = {};
      setDepartments(next.departments.map((department) => assignDepartment(suggestedAdditions(department, next.references, existingDepartments), existingDepartments.find((existing) => existing.id === department.existingDepartmentId))));
      setSelectedDepartmentIds(next.departments.map((department) => department.id));
      setWorkflows((next.workflows || []).map((workflow) => ({ ...workflow, trigger: 'manual', repeat: undefined, nextRunAt: undefined, connectionId: undefined })));
      setSelectedWorkflowIds((next.workflows || []).map((workflow) => workflow.id)); setupId.current = crypto.randomUUID();
    }
  }
  function chooseDepartment(id: string) {
    const selected = selectedDepartmentIds.includes(id);
    setSelectedDepartmentIds((current) => selected ? current.filter((item) => item !== id) : [...current, id]);
    if (selected) setSelectedWorkflowIds((current) => current.filter((workflowId) => !workflows.find((workflow) => workflow.id === workflowId)?.departmentIds.includes(id)));
    setupId.current = crypto.randomUUID();
  }
  function changeDepartment(id: string, patch: Partial<Pick<CompanyDepartment, 'name' | 'role'>>) {
    departmentEdits.current[id] = { ...departmentEdits.current[id], ...patch };
    setDepartments((current) => current.map((department) => department.id === id ? { ...department, ...patch } : department));
    setupId.current = crypto.randomUUID();
  }
  function chooseAssignee(id: string, existingId: string) {
    const original = proposal?.departments.find((department) => department.id === id);
    if (!original) return;
    const additions = suggestedAdditions(original, proposal!.references, existingDepartments);
    const assigned = assignDepartment(additions, existingDepartments.find((department) => department.id === existingId), departmentEdits.current[id]);
    setDepartments((current) => current.map((department) => department.id === id ? assigned : department));
    setupId.current = crypto.randomUUID();
  }
  function changeWorkflow(id: string, patch: Partial<CompanySetupWorkflow>) {
    setWorkflows((current) => current.map((workflow) => workflow.id === id ? { ...workflow, ...patch } : workflow)); setupId.current = crypto.randomUUID();
  }
  function setTrigger(id: string, value: string) {
    changeWorkflow(id, value === 'manual' ? { trigger: 'manual', repeat: undefined, nextRunAt: undefined, connectionId: undefined }
      : value === 'message' ? { trigger: 'message', repeat: undefined, nextRunAt: undefined, connectionId: undefined }
      : { trigger: 'schedule', repeat: value as 'daily' | 'weekly', nextRunAt: nextMorning(), connectionId: undefined });
  }
  const hasSelectedDepartments = (workflow: CompanySetupWorkflow) => workflow.departmentIds.length > 0 && workflow.departmentIds.every((id) => selectedDepartmentIds.includes(id));
  const reviewedWorkflows = workflows.map((workflow) => ({ ...workflow, sourceIds: [...new Set(workflow.departmentIds.flatMap((id) => departments.find((department) => department.id === id)?.sourceIds ?? []))].sort() }));
  const selectedWorkflows = reviewedWorkflows.filter((workflow) => selectedWorkflowIds.includes(workflow.id) && hasSelectedDepartments(workflow));
  const selectedDepartments = departments.filter((department) => selectedDepartmentIds.includes(department.id));
  const duplicateAssignees = new Set(selectedDepartments.filter((department) => department.existingDepartmentId && selectedDepartments.filter((other) => other.existingDepartmentId === department.existingDepartmentId).length > 1).map((department) => department.existingDepartmentId));
  const newCount = selectedDepartments.filter((department) => !department.existingDepartmentId).length;
  const reusedCount = new Set(selectedDepartments.flatMap((department) => department.existingDepartmentId ? [department.existingDepartmentId] : [])).size;
  const approvedMail = company?.connections.filter((connection) => connection.provider === 'mail' && connection.enabled && connection.scopeApprovedAt) || [];
  const invalidSetup = !selectedDepartments.length || duplicateAssignees.size > 0 || selectedWorkflows.some((workflow) => !workflow.request.trim() || (workflow.trigger === 'message' && !approvedMail.some((connection) => connection.id === workflow.connectionId)) || (workflow.trigger === 'schedule' && !workflow.nextRunAt)) || selectedDepartments.some((department) => Boolean(departmentIssue(department)) || (department.existingDepartmentId && !existingDepartments.some((existing) => existing.id === department.existingDepartmentId)));
  async function apply() {
    if (!proposal?.token || invalidSetup || !ai.ready) return;
    const result = await act('검토한 직원 구성과 업무를 적용하는 중', (expectedScopeId) => createDesktopBridge().companyAutomation({ kind: 'apply_organization_setup', approved: true, enableRules: true, setupId: setupId.current, proposalToken: proposal.token, expectedScopeId, departments: selectedDepartments, workflows: selectedWorkflows }));
    if (result?.setup && result.status === 'saved') { setReceipt(result.setup); setProposal(null); }
  }
  async function runOnce(workflow: CompanySetupWorkflow) {
    if (runIds[workflow.id]) { onOpenWork(runIds[workflow.id]); return; }
    const result = await act('첫 업무를 실행 대기열에 넣는 중', (expectedScopeId) => createDesktopBridge().companyAutomation({ kind: 'run_work', expectedScopeId, setupId: receipt?.id, setupWorkflowId: workflow.id, request: workflow.request, departmentIds: workflow.departmentIds }));
    if (result?.work) { setRunIds((current) => ({ ...current, [workflow.id]: result.work!.id })); setNotice('업무를 접수했습니다. 진행 상태와 결과를 확인하세요.'); }
  }
  const stage = receipt ? 3 : proposal ? 2 : preview ? 1 : 0;

  return <section className={styles.panel} aria-labelledby="company-setup-title" data-company-setup="sources-to-working-agents">
    <div className={styles.heading}><div><h2 id="company-setup-title">내 업무에 맞는 AI 직원 구성</h2><p>평소 쓰던 자료와 원하는 목표를 바탕으로, 필요한 직원과 맡길 일을 함께 추천합니다.</p></div><span className={styles.local}>이 PC의 선택한 자료로 시작</span></div>
    <ol className={styles.steps} aria-label="직원 구성 단계">{stages.map((label, index) => <li key={label} aria-current={index === stage ? 'step' : undefined} data-done={index < stage}><span>{index + 1}</span>{label}</li>)}</ol>
    <div className={styles.connection}><div><strong>{ai.label}</strong><p>외부 AI를 연결하면 승인한 발췌 내용이 해당 서비스로 전달됩니다.</p></div><div className={styles.actions}>{!ai.ready && <button type="button" disabled={Boolean(busy)} onClick={() => onConnect('ai')}>AI 연결 안내</button>}<button type="button" disabled={Boolean(busy)} onClick={() => void refreshAI()}>연결 다시 확인</button></div></div>
    <p className={styles.notice} role={error || disabledReason ? 'alert' : 'status'} data-error={error || Boolean(disabledReason)}>{disabledReason || busy || notice}</p>
    <fieldset className={styles.fieldset} disabled={Boolean(busy) || !company?.scopeId || Boolean(disabledReason)}>
      {stage === 0 && <>
        <div className={styles.sectionHeading}><div><h3>어떤 자료로 업무를 파악할까요?</h3><p>업무 폴더를 가져오거나 보고서·양식·업무 절차 자료를 최대 20개 선택하세요.</p></div><div className={styles.actions}><button type="button" className={styles.primary} onClick={() => void importFiles('folder')}>업무 폴더 가져오기</button><button type="button" onClick={() => void importFiles()}>파일 선택하기</button></div></div>
        <label className={styles.label}>어떤 일을 맡기고 싶나요? <span className={styles.optional}>선택</span><input aria-label="맡기고 싶은 업무 목표" maxLength={500} placeholder="예: 고객 문의를 정리하고 매주 운영 보고서를 만들고 싶어요" value={workGoal} onChange={(event) => { clearPlan(); setWorkGoal(event.target.value); }}/><small>업무 목표도 다음 화면에서 확인한 뒤 AI에 전달합니다. {workGoal.length}/500자</small></label>
        {!company?.records.length && <div className={styles.empty}><strong>사용하던 파일이 출발점입니다.</strong><p>한글·Word·Excel·PPT·PDF·CSV·텍스트 자료를 가져오세요.<br/>원본 파일은 그대로 두고, 이 PC에 사본을 보관합니다.</p><button type="button" className={styles.primary} onClick={() => void importFiles()}>내 업무 자료 선택</button></div>}
        <div className={styles.sources}>{company?.records.map((record) => <label className={styles.source} key={record.id}><input type="checkbox" checked={sourceIds.includes(record.id)} onChange={() => chooseSource(record.id)}/><span><strong>{record.name}</strong><small>{record.format.toUpperCase()} · 버전 {record.version}</small></span></label>)}</div>
        <div className={styles.footer}><span>{sourceIds.length}개 선택 · 아직 AI에 보내지 않았습니다.</span><button type="button" className={styles.primary} disabled={!sourceIds.length} onClick={() => void preparePreview()}>AI에 보낼 내용 확인</button></div>
      </>}
      {stage === 1 && preview && <>
        <h3>선택한 자료에서 이 내용을 사용합니다.</h3><p>업무 분석에 사용할 발췌입니다. 탐지한 인증 정보·개인식별정보를 가린 뒤 보냅니다. 가림이 완전하지 않을 수 있으니 회사 기밀이 남아 있는지 확인하세요.</p>
        <div className={styles.previewContext}><h4>함께 전달할 업무 목표</h4><p>{preview.workGoal || '별도로 입력한 업무 목표가 없습니다.'}</p></div>
        {preview.existingDepartmentContext && <details className={styles.excerpt} open><summary>함께 전달할 기존 직원 정보 · {preview.existingDepartments?.length ?? 0}명</summary><p>기존 직원에게 이어 맡길 수 있는지 확인하기 위해 아래 직원 요약을 함께 보냅니다.</p><pre data-company-setup-existing-context>{preview.existingDepartmentContext}</pre></details>}
        <div className={styles.chips}>{preview.references.map((record) => <span key={record.id}>{record.name} · v{record.version}</span>)}</div>
        <details className={styles.excerpt} open><summary>AI에 전달할 발췌 내용</summary><pre data-company-setup-excerpt>{preview.text}</pre></details>
        <p className={styles.hint}>자료 사본은 로컬에 보관됩니다. 아래 버튼을 누르면 위 발췌·업무 목표·표시된 기존 직원 정보를 연결한 AI로 보내 직원 구성을 추천받습니다.</p>
        <div className={styles.footer}><button type="button" onClick={() => setPreview(null)}>자료 다시 선택</button><button type="button" className={styles.primary} disabled={!ai.ready} onClick={() => void recommend()}>이 내용으로 AI 추천 받기</button></div>
      </>}
      {stage === 2 && proposal && <>
        <div className={styles.sectionHeading}><div><h3>우리 업무에 맞춰 이렇게 구성합니다.</h3><p>{proposal.summary}</p></div><button type="button" onClick={() => { clearPlan(); }}>자료부터 다시 선택</button></div>
        <h4 className={styles.groupHeading}>1. 필요한 역할과 담당자를 고르세요</h4><p>직원을 새로 만들거나, 이미 있는 직원에게 이어 맡길 수 있습니다.</p>
        <div className={styles.agents}>{departments.map((department) => {
          const selected = selectedDepartmentIds.includes(department.id);
          const originalName = proposal.departments.find((item) => item.id === department.id)?.name ?? department.name;
          const issue = department.existingDepartmentId && duplicateAssignees.has(department.existingDepartmentId) ? '같은 기존 직원에게 두 역할을 한 번에 맡길 수 없습니다. 역할 하나를 해제하거나 다른 담당자를 선택하세요.' : departmentIssue(department);
          return <article key={department.id} className={styles.department} data-department-id={department.id} data-selected={selected}>
            <label className={styles.workflowTitle}><input type="checkbox" aria-label={originalName + ' 역할 선택'} checked={selected} onChange={() => chooseDepartment(department.id)}/><strong>{originalName}</strong></label>
            <p className={styles.reason}>{department.reason || department.role}</p>
            <dl className={styles.roleDetails}>
              <div><dt>맡길 일</dt><dd>{department.responsibilities?.length ? <ul>{department.responsibilities.map((item) => <li key={item}>{item}</li>)}</ul> : department.role}</dd></div>
              <div><dt>받을 결과</dt><dd>{department.deliverables?.length ? <ul>{department.deliverables.map((item) => <li key={item}>{item}</li>)}</ul> : '첫 업무를 정할 때 결과물 형태를 함께 확인합니다.'}</dd></div>
              <div><dt>참고 자료</dt><dd>{department.sourceIds.map((id) => company?.records.find((record) => record.id === id)?.name || '자료 확인 필요').join(', ') || '참고 자료 없음'}</dd></div>
            </dl>
            <fieldset className={styles.fieldset} disabled={!selected}>
              <label className={styles.label}>누가 맡을까요?<select aria-label={originalName + ' 담당 직원'} value={department.existingDepartmentId || ''} onChange={(event) => chooseAssignee(department.id, event.target.value)}><option value="">새 직원 만들기</option>{existingDepartments.map((existing) => <option key={existing.id} value={existing.id}>{existing.name}에게 맡기기</option>)}</select></label>
              {department.existingDepartmentId && <p className={styles.hint}>기존 직원의 이름·역할과 자료를 이어받습니다. 아래에서 이름이나 역할을 직접 바꿀 수 있습니다.</p>}
              <details className={styles.edit}><summary>직원 이름·역할 확인·수정</summary><label className={styles.label}>직원 이름<input aria-label={originalName + ' 이름'} maxLength={40} value={department.name} onChange={(event) => changeDepartment(department.id, { name: event.target.value })}/></label><label className={styles.label}>역할·업무 지침<textarea aria-label={originalName + ' 역할'} rows={4} maxLength={500} value={department.role} onChange={(event) => changeDepartment(department.id, { role: event.target.value })}/></label></details>
            </fieldset>
            {selected && issue && <p className={styles.validation} role="alert">{issue}</p>}
          </article>;
        })}</div>
        <h4 className={styles.groupHeading}>2. 함께 준비할 업무를 고르세요</h4><p>업무를 모두 해제해도 선택한 직원 역할은 적용할 수 있습니다.</p>
        <div className={styles.workflows}>{reviewedWorkflows.map((workflow) => <article className={styles.workflow} key={workflow.id} data-selected={selectedWorkflowIds.includes(workflow.id) && hasSelectedDepartments(workflow)}>
          <label className={styles.workflowTitle}><input type="checkbox" checked={selectedWorkflowIds.includes(workflow.id) && hasSelectedDepartments(workflow)} disabled={!hasSelectedDepartments(workflow)} onChange={() => { setSelectedWorkflowIds((current) => current.includes(workflow.id) ? current.filter((id) => id !== workflow.id) : [...current, workflow.id]); setupId.current = crypto.randomUUID(); }}/><strong>{workflow.name}</strong></label>
          <p>{workflow.reason}</p><div className={styles.chips}>{workflow.departmentIds.map((id) => <span key={id}>{departments.find((department) => department.id === id)?.name || '담당 확인'}</span>)}</div>
          {!hasSelectedDepartments(workflow) && <p className={styles.hint}>이 업무를 준비하려면 위에서 담당 역할을 먼저 선택하세요.</p>}
          <fieldset className={styles.fieldset} disabled={!hasSelectedDepartments(workflow) || !selectedWorkflowIds.includes(workflow.id)}>
          <label className={styles.label}>실행 방법<select aria-label={`${workflow.name} 실행 방법`} value={workflow.trigger === 'schedule' ? workflow.repeat || 'daily' : workflow.trigger} onChange={(event) => setTrigger(workflow.id, event.target.value)}><option value="manual">필요할 때 직접 시작</option><option value="daily">매일 실행</option><option value="weekly">매주 실행</option><option value="message">새 업무 메일이 오면</option></select></label>
          {workflow.trigger === 'schedule' && <label className={styles.label}>처음 실행할 날짜와 시간<input aria-label={`${workflow.name} 처음 실행`} type="datetime-local" value={localTime(workflow.nextRunAt)} onChange={(event) => changeWorkflow(workflow.id, { nextRunAt: event.target.value && Number.isFinite(Date.parse(event.target.value)) ? new Date(event.target.value).toISOString() : undefined })}/><small>{workflow.repeat === 'weekly' ? '선택한 날짜의 요일과 시간에 매주 실행합니다.' : '선택한 시간에 매일 실행합니다.'} 이 PC에서 앱이 실행 중일 때 처리합니다.</small></label>}
          {workflow.trigger === 'message' && <label className={styles.label}>읽을 업무 메일함<select aria-label={`${workflow.name} 업무 메일함`} value={workflow.connectionId || ''} onChange={(event) => changeWorkflow(workflow.id, { connectionId: event.target.value })}><option value="">읽기 범위를 승인한 메일함 선택</option>{approvedMail.map((connection) => <option key={connection.id} value={connection.id}>{connection.name}</option>)}</select>{!approvedMail.length && <button type="button" onClick={() => onConnect('mail')}>업무 메일함 연결·읽기 승인</button>}</label>}
          <details className={styles.edit}><summary>맡길 업무와 참고 자료 확인·수정</summary><label className={styles.label}>에이전트에게 맡길 업무<textarea aria-label={`${workflow.name} 업무 지침`} rows={4} maxLength={5000} value={workflow.request} onChange={(event) => changeWorkflow(workflow.id, { request: event.target.value })}/></label><p>참고 자료: {workflow.sourceIds.map((id) => company?.records.find((record) => record.id === id)?.name || '자료 확인 필요').join(', ')}</p>{workflow.missingInputs.length > 0 && <p>진행 전 확인할 점: {workflow.missingInputs.join(' · ')}</p>}</details>
          </fieldset>
        </article>)}</div>
        <div className={styles.summary}><strong>새 직원 {newCount}명 · 기존 직원 {reusedCount}명 · 선택한 업무 {selectedWorkflows.length}개</strong><p>직접 시작할 업무는 준비 상태로 저장합니다. 정한 시간·새 메일 조건은 저장 후 활성화합니다. 메일 발송 등 외부 작업은 최종 승인을 기다립니다.</p></div>
        <div className={styles.footer}><span>선택한 역할과 업무 구성을 적용합니다.</span><button type="button" className={styles.primary} disabled={invalidSetup || !ai.ready} onClick={() => void apply()}>선택한 직원·업무 구성 적용</button></div>
      </>}
      {stage === 3 && receipt && <>
        <div className={styles.success}><span aria-hidden="true">✓</span><div><h3>내 업무를 맡길 환경이 준비됐습니다.</h3><p>새 직원 {receipt.createdDepartmentIds?.length ?? receipt.departmentIds.length}명 · 기존 직원 {receipt.reusedDepartmentIds?.length ?? 0}명 · 반복 자동화 {receipt.ruleIds.length}개를 설정했습니다.</p><p>{receipt.workflows.length ? '아래에서 첫 업무를 실행하고 결과를 확인하세요.' : '직원 역할을 먼저 준비했습니다. 직원에게 원하는 업무를 맡겨보세요.'}</p></div></div>
        <div className={styles.workflows}>{receipt.workflows.map((workflow) => <article className={styles.workflow} key={workflow.id}><h4>{workflow.name}</h4><p>{workflow.request}</p><small>{workflow.trigger === 'manual' ? '직접 시작할 업무' : workflow.trigger === 'message' ? '새 업무 메일 수신 시 실행' : `${workflow.repeat === 'weekly' ? '매주' : '매일'} · ${workflow.nextRunAt ? new Date(workflow.nextRunAt).toLocaleString('ko-KR') : ''}부터`}</small><div className={styles.actions}><button type="button" className={styles.primary} onClick={() => void runOnce(workflow)}>{runIds[workflow.id] ? '진행 상태·결과 보기' : '이 업무 한 번 실행'}</button></div></article>)}</div>
        <div className={styles.footer}><button type="button" onClick={onOpenRules}>자동화 관리</button><button type="button" onClick={() => { clearPlan(); setNotice('추가로 맡길 업무의 자료를 선택하세요.'); }}>다른 업무도 구성하기</button></div>
      </>}
    </fieldset>
  </section>;
}
