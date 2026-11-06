'use client';

import { useEffect, useRef, useState } from 'react';
import { createDesktopBridge } from '@/lib/desktop-bridge';
import type { CompanyAutomationPayload, CompanyRecord } from '@/lib/company-automation';
import type { CompanyDocumentTemplate, DocumentFormat } from '@/lib/document-production';
import {
  draftFromQuotation, emptyQuotationDraft, emptyQuotationSettings, quotationFieldLabels, quotationMoney, quotationStatusLabels,
  type CompanyQuotation, type QuotationDraft, type QuotationResult, type QuotationSettings,
  type QuotationSettingsProposal, type QuotationState, type QuotationSuggestion,
} from '@/lib/company-quotation';
import styles from './CompanyQuotationPanel.module.css';

const formats: { id: DocumentFormat; label: string }[] = [
  { id: 'pdf', label: 'PDF' }, { id: 'docx', label: 'Word · DOCX' }, { id: 'hwpx', label: '한글 · HWPX' },
  { id: 'hwp', label: '한글 · HWP' }, { id: 'xlsx', label: 'Excel · XLSX' },
];
const toggle = (values: string[], value: string) => values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
const dateLabel = (value?: string) => value && !Number.isNaN(Date.parse(value)) ? new Date(value).toLocaleString('ko-KR') : '—';
const successful = (result: QuotationResult | null) => result && !['error', 'desktop_required', 'cancelled', 'conflict'].includes(result.status);

export default function CompanyQuotationPanel() {
  const [state, setState] = useState<QuotationState | null>(null);
  const [templates, setTemplates] = useState<CompanyDocumentTemplate[]>([]);
  const [records, setRecords] = useState<CompanyRecord[]>([]);
  const [accounts, setAccounts] = useState<NonNullable<QuotationResult['mailAccounts']>>([]);
  const [inquiries, setInquiries] = useState<NonNullable<QuotationResult['inquiries']>>([]);
  const [settings, setSettings] = useState<QuotationSettings>(emptyQuotationSettings);
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsProposal, setSettingsProposal] = useState<QuotationSettingsProposal | null>(null);
  const [draft, setDraft] = useState<QuotationDraft>(emptyQuotationDraft);
  const [dirty, setDirty] = useState(false);
  const [selectedId, setSelectedId] = useState('');
  const [draftRevision, setDraftRevision] = useState(0);
  const [pendingSelection, setPendingSelection] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<QuotationSuggestion | null>(null);
  const [format, setFormat] = useState<DocumentFormat>('pdf');
  const [availableFormats, setAvailableFormats] = useState<DocumentFormat[]>(['pdf', 'docx', 'hwpx', 'xlsx']);
  const [accountId, setAccountId] = useState('');
  const [sendContext, setSendContext] = useState<{ id: string; revision: number; accountId: string; token: string } | null>(null);
  const [message, setMessage] = useState('저장한 견적 기준을 확인하고 있습니다.');
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState('');
  const busyRef = useRef(false);
  const requestRef = useRef<{ key: string; id: string } | null>(null);
  const selected = state?.quotations.find((quotation) => quotation.id === selectedId);
  const activeTemplate = templates.find((template) => template.id === settings.templateId);
  const locked = Boolean(selected && ['sending', 'sent', 'uncertain'].includes(selected.status));
  const savedClean = Boolean(selected && !dirty);
  const readyToSend = Boolean(savedClean && selected?.artifact && ['reviewed', 'prepared'].includes(selected.status));
  const previewReady = Boolean(sendContext && selected && sendContext.id === selected.id && sendContext.revision === selected.revision && sendContext.accountId === accountId && !dirty);
  const templateFormat = selected?.settingsSnapshot.templateFormat;
  const exportFormats = formats.filter((item) => availableFormats.includes(item.id) && (!templateFormat || templateFormat === item.id || (templateFormat === 'hwpx' && item.id === 'hwp')));
  const exportFormat = exportFormats.find((item) => item.id === format)?.id || exportFormats[0]?.id;

  function receive(result: QuotationResult) {
    if (result.quotationState) setState(result.quotationState);
    if (result.quotation) {
      const quotation = result.quotation;
      setState((previous) => previous ? { ...previous, quotations: [quotation, ...previous.quotations.filter((item) => item.id !== quotation.id)] } : previous);
    }
    if (result.templates) setTemplates(result.templates.filter((template) => template.format !== 'pptx'));
    if (result.formats) setAvailableFormats(result.formats);
    if (result.records) setRecords(result.records);
    if (result.mailAccounts) setAccounts(result.mailAccounts);
    if (result.inquiries) setInquiries(result.inquiries);
  }

  useEffect(() => {
    let active = true;
    void createDesktopBridge().companyAutomation({ kind: 'quotation_status' }).then((raw) => {
      if (!active) return;
      const result = raw as QuotationResult;
      receive(result);
      if (result.quotationState?.settings) setSettings(result.quotationState.settings);
      else setSettingsOpen(true);
      setMessage(result.userMessage);
      setError(['error', 'desktop_required'].includes(result.status));
    }).catch(() => { if (active) { setError(true); setMessage('견적 정보를 불러오지 못했습니다. 새로고침으로 다시 확인해 주세요.'); } });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => { if (dirty || settingsDirty) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty, settingsDirty]);

  async function act(payload: CompanyAutomationPayload, label: string) {
    if (busyRef.current) return null;
    busyRef.current = true; setBusy(label); setMessage(label); setError(false);
    try {
      const result = await createDesktopBridge().companyAutomation(payload) as QuotationResult;
      receive(result); setMessage(result.userMessage); setError(['error', 'desktop_required', 'conflict'].includes(result.status));
      return result;
    } catch {
      setMessage(payload.kind === 'quotation_send'
        ? '발송 결과를 받지 못했습니다. 다시 발송하기 전에 새로고침하고 보낸 메일함을 확인해 주세요.'
        : '요청을 완료하지 못했습니다. 작성 내용은 유지됩니다. 연결을 확인한 뒤 다시 시도해 주세요.');
      setError(true); return null;
    } finally { busyRef.current = false; setBusy(''); }
  }

  function changeDraft(patch: Partial<QuotationDraft>) {
    setDraft((previous) => ({ ...previous, ...patch })); setDirty(true); setSendContext(null);
  }
  function changeSettings(patch: Partial<QuotationSettings>) {
    setSettings((previous) => ({ ...previous, ...patch })); setSettingsDirty(true);
  }
  function chooseQuotation(id: string) {
    const quotation = state?.quotations.find((item) => item.id === id);
    setSelectedId(id); setDraft(quotation ? draftFromQuotation(quotation) : emptyQuotationDraft());
    setDraftRevision(quotation?.revision || 0);
    setDirty(false); setSuggestion(null); setPendingSelection(null); setSendContext(null); requestRef.current = null;
  }
  function requestSelection(id: string) {
    if (id === selectedId && id) return;
    if (dirty) setPendingSelection(id); else chooseQuotation(id);
  }
  function acceptQuotation(quotation: CompanyQuotation) {
    setSelectedId(quotation.id); setDraft(draftFromQuotation(quotation)); setDirty(false); setSuggestion(null); setSendContext(null);
    setDraftRevision(quotation.revision);
  }

  async function saveDraft() {
    if (selected && locked) return;
    const key = JSON.stringify(draft);
    if (!requestRef.current || requestRef.current.key !== key) requestRef.current = { key, id: crypto.randomUUID() };
    const result = await act(selected
      ? { kind: 'quotation_update', id: selected.id, expectedRevision: draftRevision, patch: draft }
      : { kind: 'quotation_create', requestId: requestRef.current.id, ...draft }, '견적 내용을 저장하고 금액을 확인하고 있습니다…');
    if (successful(result) && result?.quotation) acceptQuotation(result.quotation);
  }

  async function importTemplate() {
    if (busyRef.current) return;
    busyRef.current = true; setBusy('회사 양식을 가져오고 있습니다…'); setError(false);
    try {
      const result = await createDesktopBridge().documentProduction({ kind: 'import_template' });
      setMessage(result.userMessage); setError(['error', 'desktop_required'].includes(result.status));
      if (result.templates) setTemplates(result.templates.filter((template) => template.format !== 'pptx'));
      if (result.template) {
        const template = result.template;
        if (template.format === 'pptx') { setError(true); setMessage('견적 양식은 Word, Excel, 한글 파일로 가져와 주세요. 발표 자료 양식은 사용할 수 없습니다.'); return; }
        setTemplates((previous) => [template, ...previous.filter((item) => item.id !== template.id)]);
        changeSettings({ templateId: template.id, templateHash: template.hash, templateFormat: template.format, fieldMapping: {} });
      }
    } catch { setError(true); setMessage('회사 양식을 가져오지 못했습니다. 다른 파일로 다시 시도해 주세요.'); }
    finally { busyRef.current = false; setBusy(''); }
  }

  async function refresh() {
    const result = await act({ kind: 'quotation_status' }, '견적과 회사 자료를 새로 확인하고 있습니다…');
    if (!settingsDirty && result?.quotationState?.settings) setSettings(result.quotationState.settings);
    if (!dirty && result?.quotationState) {
      const quotation = result.quotationState.quotations.find((item) => item.id === selectedId);
      if (quotation) { setDraft(draftFromQuotation(quotation)); setDraftRevision(quotation.revision); }
    }
  }

  async function openArtifact(id: string) {
    if (busyRef.current) return;
    busyRef.current = true; setBusy('저장한 견적서를 열고 있습니다…'); setError(false);
    try {
      const result = await createDesktopBridge().documentProduction({ kind: 'open', id });
      setMessage(result.userMessage); setError(['error', 'desktop_required'].includes(result.status));
    } catch { setError(true); setMessage('견적서를 열지 못했습니다. 파일이 있는지 확인해 주세요.'); }
    finally { busyRef.current = false; setBusy(''); }
  }

  const sourcePicker = <div className={styles.checklist}>
    {!records.length && <p className={styles.muted}>‘자료·부서’에서 가격표나 회사 자료를 가져오면 여기서 선택할 수 있습니다.</p>}
    {records.map((record) => <label className={styles.check} key={record.id}>
      <input type="checkbox" checked={draft.sourceIds.includes(record.id)} disabled={locked} onChange={() => changeDraft({ sourceIds: toggle(draft.sourceIds, record.id) })} />
      <span>{record.name}<br /><small className={styles.muted}>자료 버전 {record.version}</small></span>
    </label>)}
  </div>;

  return <section className={styles.panel} aria-label="회사 견적 업무" data-testid="company-quotation-panel">
    <div className={styles.header}><div><h2>회사 기준으로 만드는 견적</h2><p className={styles.muted}>승인한 양식과 거래 조건을 기억하고, 문의마다 견적을 준비합니다.</p></div>
      <button type="button" disabled={Boolean(busy)} onClick={() => void refresh()}>견적 새로고침</button></div>
    <div className={`${styles.message} ${error ? styles.error : ''}`} role={error ? 'alert' : 'status'} aria-live="polite">{busy || message}</div>
    <fieldset disabled={Boolean(busy) || !state} className={styles.stack}>
      <section className={styles.card}>
        <div className={styles.row}><h3><span className={styles.step}>1</span>회사 견적 기준</h3><span className={styles.badge}>{state?.settings ? `승인 기준 ${state.settings.revision}차` : '첫 설정 필요'}</span></div>
        {state?.settings && <p className={styles.muted}>{state.settings.supplierName} · {templates.find((template) => template.id === state.settings?.templateId)?.name || '기본 견적 양식'} · 승인 {dateLabel(state.settings.approvedAt)}</p>}
        <details open={settingsOpen} onToggle={(event) => setSettingsOpen(event.currentTarget.open)}>
          <summary>{state?.settings ? '저장한 회사 기준 확인·수정' : '회사 정보와 견적 양식 설정'}</summary>
          <div className={styles.stack}>
            <div className={styles.two}>
              <label>공급자명<input value={settings.supplierName} onChange={(event) => changeSettings({ supplierName: event.target.value })} placeholder="사업자명 또는 회사명" /></label>
              <label>공급자 연락처<input value={settings.supplierContact} onChange={(event) => changeSettings({ supplierContact: event.target.value })} placeholder="담당자 · 전화 · 이메일" /></label>
              <label>결제 조건<textarea rows={2} value={settings.paymentTerms} onChange={(event) => changeSettings({ paymentTerms: event.target.value })} placeholder="회사에서 승인한 결제 조건" /></label>
              <label>납기 조건<textarea rows={2} value={settings.deliveryTerms} onChange={(event) => changeSettings({ deliveryTerms: event.target.value })} placeholder="확인된 납기 또는 협의 조건" /></label>
            </div>
            <div className={styles.three}>
              <label>견적 유효 기간 · 일<input type="number" min={1} max={3650} value={settings.validityDays} onChange={(event) => changeSettings({ validityDays: Number(event.target.value) })} /></label>
              <label>견적 번호 접두어<input value={settings.numberPrefix} onChange={(event) => changeSettings({ numberPrefix: event.target.value })} placeholder="회사에서 사용하는 번호 접두어" /></label>
              <label>부가세 · 통화 원(KRW)<select value={settings.vatRate} onChange={(event) => changeSettings({ vatRate: Number(event.target.value) as 0 | 10 })}><option value={10}>10%</option><option value={0}>0%</option></select></label>
            </div>
            <div className={styles.two}><label>견적에 사용할 회사 양식<select value={settings.templateId} onChange={(event) => { const template = templates.find((item) => item.id === event.target.value); changeSettings({ templateId: event.target.value, templateHash: template?.hash, templateFormat: template?.format, fieldMapping: {} }); }}>
              <option value="">기본 견적 양식</option>{templates.map((template) => <option key={template.id} value={template.id}>{template.name} · {template.format.toUpperCase()}</option>)}
            </select></label><div className={styles.actions}><button type="button" onClick={() => void importTemplate()}>회사 양식 가져오기</button></div></div>
            {activeTemplate && <details open={Object.keys(settings.fieldMapping).length === 0}><summary>양식의 칸 연결하기</summary><div className={styles.stack}><p className={styles.muted}>표시 항목은 모두 연결해 주세요. 고객명·품목 목록·합계가 포함되어야 합니다. 일반 텍스트 칸은 원본을 유지할 수 있습니다.</p><div className={styles.mapping}>
              {[...activeTemplate.fields.map((field) => ({ id: field, label: field })), ...activeTemplate.slots.filter((slot) => !activeTemplate.fields.includes(slot.id)).map((slot) => ({ id: slot.id, label: slot.text || '빈 칸' }))].map((field) => <label key={field.id} className={styles.mappingRow}><span title={field.label}>{field.label.length > 100 ? `${field.label.slice(0, 100)}…` : field.label}</span><select aria-label={`${field.label}에 넣을 견적 항목`} value={settings.fieldMapping[field.id] || ''} onChange={(event) => { const mapping = { ...settings.fieldMapping }; if (event.target.value) mapping[field.id] = event.target.value; else delete mapping[field.id]; changeSettings({ fieldMapping: mapping }); }}><option value="">{activeTemplate.fields.includes(field.id) ? '견적 항목 선택 · 필수' : '원본 유지'}</option>{Object.entries(quotationFieldLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>)}
            </div></div></details>}
            <details><summary>회사 자료에서 기준 제안받기</summary><div className={styles.stack}><p className={styles.muted}>아래 ‘문의와 견적 작성’에서 선택한 회사 자료를 읽고 제안합니다. 적용한 내용을 확인한 뒤 저장해 주세요.</p><button type="button" disabled={!draft.sourceIds.length} onClick={async () => { const result = await act({ kind: 'quotation_suggest_settings', sourceIds: draft.sourceIds }, '선택한 회사 자료에서 견적 기준을 찾고 있습니다…'); if (result?.settingsProposal) setSettingsProposal(result.settingsProposal); }}>회사 기준 제안받기</button></div></details>
            {settingsProposal && <div className={styles.proposal}><h3>회사 기준 제안 · 저장 전 확인</h3><dl className={styles.facts}>{Object.entries(settingsProposal.settings || settingsProposal).filter(([key, value]) => ['supplierName', 'supplierContact', 'paymentTerms', 'deliveryTerms', 'validityDays', 'numberPrefix', 'vatRate'].includes(key) && value !== undefined).map(([key, value]) => <div key={key} style={{ display: 'contents' }}><dt>{({ supplierName: '공급자명', supplierContact: '연락처', paymentTerms: '결제 조건', deliveryTerms: '납기 조건', validityDays: '유효 기간', numberPrefix: '번호 접두어', vatRate: '부가세' } as Record<string, string>)[key]}</dt><dd>{String(value)}</dd></div>)}</dl>{settingsProposal.notes?.length ? <ul>{settingsProposal.notes.map((note, index) => <li key={index}>{note}</li>)}</ul> : null}<div className={styles.actions}><button type="button" onClick={() => { const proposal = settingsProposal.settings || settingsProposal; const patch: Partial<QuotationSettings> = {}; for (const key of ['supplierName', 'supplierContact', 'paymentTerms', 'deliveryTerms', 'numberPrefix'] as const) if (typeof proposal[key] === 'string') patch[key] = proposal[key]; if (typeof proposal.validityDays === 'number') patch.validityDays = proposal.validityDays; if (proposal.vatRate === 0 || proposal.vatRate === 10) patch.vatRate = proposal.vatRate; changeSettings(patch); setSettingsProposal(null); }}>제안을 기준 입력란에 적용</button><button type="button" onClick={() => setSettingsProposal(null)}>제안 닫기</button></div></div>}
            <p className={styles.muted}>승인한 기준은 다음 견적부터 적용됩니다. 기존 견적은 작성 당시 기준을 유지합니다.</p>
            <div className={styles.actions}><button type="button" className={styles.primary} disabled={!settings.supplierName.trim() || !settings.numberPrefix.trim() || (!settingsDirty && Boolean(state?.settings))} onClick={async () => { const result = await act({ kind: 'quotation_save_settings', settings, expectedRevision: settings.revision, approved: true }, '확인한 회사 기준을 승인하고 저장하고 있습니다…'); if (successful(result) && result?.quotationState?.settings) { setSettings(result.quotationState.settings); setSettingsDirty(false); setSettingsOpen(false); } }}>이 기준을 승인하고 저장</button>{settingsDirty && <span className={styles.muted}>저장하지 않은 변경 사항</span>}</div>
          </div>
        </details>
        {Boolean(state?.settingsHistory.length) && <details><summary>회사 기준 변경 이력</summary><div className={styles.stack}>{state?.settingsHistory.slice().reverse().map((previous) => <p className={styles.muted} key={previous.revision}>{previous.revision}차 · {previous.supplierName} · 승인 {dateLabel(previous.approvedAt)}</p>)}</div></details>}
      </section>

      <section className={styles.card}>
        <div className={styles.row}><h3><span className={styles.step}>2</span>문의와 견적 작성</h3><button type="button" onClick={() => requestSelection('')}>새 견적 작성</button></div>
        {pendingSelection !== null && <div className={styles.warning} role="alert"><p>현재 작성한 변경 사항이 아직 저장되지 않았습니다.</p><div className={styles.actions}><button type="button" onClick={() => chooseQuotation(pendingSelection)}>작성 내용 버리고 {pendingSelection ? '견적 선택' : '새 견적 작성'}</button><button type="button" onClick={() => setPendingSelection(null)}>계속 작성</button></div></div>}
        {selected && <div className={styles.row}><strong>{selected.number} · {selected.customerName || '고객 확인 필요'}</strong><span className={styles.badge}>{quotationStatusLabels[selected.status]}</span></div>}
        {selected && dirty && selected.revision !== draftRevision && <div className={styles.warning}><p>다른 화면에서 이 견적이 변경되었습니다. 현재 입력은 유지됩니다. 필요한 변경 내용을 복사한 뒤 최신 견적을 불러와 반영해 주세요.</p><button type="button" onClick={() => setPendingSelection(selected.id)}>최신 견적 다시 불러오기</button></div>}
        {locked && <p className={styles.warning}>{selected?.status === 'uncertain' ? '발송 결과가 확정되지 않았습니다. 보낸 메일함에서 전송 여부를 확인해 주세요. 이 견적의 중복 발송은 잠겨 있습니다.' : selected?.status === 'sending' ? '메일 발송을 처리하고 있습니다. 새로고침으로 결과를 확인해 주세요.' : '발송을 완료한 견적입니다. 추가 견적이 필요하면 새 견적을 작성해 주세요.'}</p>}
        <fieldset disabled={locked} className={styles.stack}>
          <details open={!selected}><summary>문의 내용과 참고 자료</summary><div className={styles.stack}>
            <label>접수한 문의 연결<select value={draft.sourceWorkId} onChange={(event) => { const inquiry = inquiries.find((item) => item.id === event.target.value); changeDraft({ sourceWorkId: event.target.value, ...(inquiry ? { request: inquiry.request } : {}) }); setSuggestion(null); }}><option value="">직접 입력</option>{inquiries.map((inquiry) => <option key={inquiry.id} value={inquiry.id}>{inquiry.request.slice(0, 90)}</option>)}</select></label>
            <label>견적 요청 내용<textarea rows={3} value={draft.request} onChange={(event) => changeDraft({ request: event.target.value })} placeholder="고객 문의 또는 필요한 품목·수량을 입력하세요." /></label>
            <fieldset><legend>참고할 회사 자료</legend>{sourcePicker}</fieldset>
            <div className={styles.actions}><button type="button" disabled={!draft.request.trim()} onClick={async () => { const result = await act({ kind: 'quotation_suggest', request: draft.request, sourceWorkId: draft.sourceWorkId || undefined, sourceIds: draft.sourceIds }, '문의와 선택한 자료를 바탕으로 견적 내용을 제안하고 있습니다…'); if (result?.suggestion) setSuggestion(result.suggestion); }}>문의로 견적 초안 제안받기</button><span className={styles.muted}>제안은 확인 후 입력란에 적용합니다.</span></div>
          </div></details>
          {suggestion && <div className={styles.proposal}><h3>견적 초안 제안 · 미저장</h3><dl className={styles.facts}><dt>고객명</dt><dd>{suggestion.customerName || '확인 필요'}</dd><dt>고객 이메일</dt><dd>{suggestion.customerEmail || '직접 확인해 입력'}</dd></dl>{suggestion.items?.length ? <ul>{suggestion.items.map((item, index) => <li key={index}>{item.description || '품목 확인 필요'} · 수량 {item.quantity} · 단가 {quotationMoney(item.unitPrice)}</li>)}</ul> : <p>품목과 단가는 입력란에서 확인해 주세요.</p>}{suggestion.notes?.length ? <ul>{suggestion.notes.map((note, index) => <li key={index}>{note}</li>)}</ul> : null}<div className={styles.actions}><button type="button" onClick={() => { const patch: Partial<QuotationDraft> = {}; for (const key of ['customerName', 'customerEmail', 'emailSubject', 'emailBody'] as const) if (typeof suggestion[key] === 'string') patch[key] = suggestion[key]; if (suggestion.items?.length) patch.items = suggestion.items.map((item) => ({ ...item })); changeDraft(patch); setSuggestion(null); }}>제안을 견적 입력란에 적용</button><button type="button" onClick={() => setSuggestion(null)}>제안 닫기</button></div></div>}
          <div className={styles.two}><label>고객명<input value={draft.customerName} onChange={(event) => changeDraft({ customerName: event.target.value })} placeholder="고객 회사명 또는 성명" /></label><label>고객 이메일<input type="email" autoComplete="off" value={draft.customerEmail} onChange={(event) => changeDraft({ customerEmail: event.target.value })} placeholder="실제 수신할 이메일 주소" /></label></div>
          <div className={styles.stack}>{draft.items.map((item, index) => <div className={styles.item} key={index}><span className={styles.itemTitle}>품목 {index + 1}</span><label className={styles.description}>품목·규격<input aria-label={`품목 ${index + 1} 이름과 규격`} value={item.description} onChange={(event) => changeDraft({ items: draft.items.map((previous, itemIndex) => itemIndex === index ? { ...previous, description: event.target.value } : previous) })} placeholder="품목명과 규격" /></label><label>수량<input aria-label={`품목 ${index + 1} 수량`} inputMode="decimal" value={item.quantity} onChange={(event) => changeDraft({ items: draft.items.map((previous, itemIndex) => itemIndex === index ? { ...previous, quantity: event.target.value } : previous) })} /></label><label>단가 · 원<input aria-label={`품목 ${index + 1} 단가`} inputMode="decimal" value={item.unitPrice} onChange={(event) => changeDraft({ items: draft.items.map((previous, itemIndex) => itemIndex === index ? { ...previous, unitPrice: event.target.value } : previous) })} placeholder="확인된 단가" /></label><button type="button" aria-label={`품목 ${index + 1} 삭제`} disabled={draft.items.length === 1} onClick={() => changeDraft({ items: draft.items.filter((_, itemIndex) => itemIndex !== index) })}>삭제</button></div>)}</div>
          <div className={styles.actions}><button type="button" onClick={() => changeDraft({ items: [...draft.items, { description: '', quantity: '1', unitPrice: '' }] })}>품목 추가</button></div>
          {selected && <details><summary>이번 견적의 거래 조건 수정</summary><div className={styles.stack}><p className={styles.muted}>이 견적에만 적용됩니다. 저장하면 검토 승인을 다시 받아야 합니다.</p><div className={styles.two}><label>이번 견적 결제 조건<textarea rows={2} value={draft.paymentTerms || ''} onChange={(event) => changeDraft({ paymentTerms: event.target.value })} /></label><label>이번 견적 납기 조건<textarea rows={2} value={draft.deliveryTerms || ''} onChange={(event) => changeDraft({ deliveryTerms: event.target.value })} /></label><label>이번 견적 유효 기간 · 일<input type="number" min={1} max={3650} value={draft.validityDays ?? ''} onChange={(event) => changeDraft({ validityDays: Number(event.target.value) })} /></label><label>이번 견적 부가세<select value={draft.vatRate ?? 10} onChange={(event) => changeDraft({ vatRate: Number(event.target.value) as 0 | 10 })}><option value={10}>10%</option><option value={0}>0%</option></select></label></div></div></details>}
          <details><summary>발송할 메일 내용</summary><div className={styles.stack}><label>메일 제목<input value={draft.emailSubject} onChange={(event) => changeDraft({ emailSubject: event.target.value })} placeholder="견적서 발송 제목" /></label><label>메일 본문<textarea rows={5} value={draft.emailBody} onChange={(event) => changeDraft({ emailBody: event.target.value })} placeholder="고객에게 전달할 내용을 작성하세요." /></label></div></details>
          <div className={styles.actions}><button type="button" className={styles.primary} disabled={!state?.settings || (Boolean(selected) && !dirty)} onClick={() => void saveDraft()}>{selected ? '변경 내용 저장' : '견적 초안 저장'}</button><span className={styles.muted}>{!state?.settings ? '회사 견적 기준을 먼저 승인해 주세요.' : dirty ? '저장하면 금액과 누락 항목을 확인합니다.' : selected ? `작성 당시 회사 기준 ${selected.settingsRevision}차 적용` : `회사 기준 ${state.settings.revision}차 적용`}</span></div>
        </fieldset>
      </section>

      {selected && <section className={styles.card}>
        <div className={styles.row}><h3><span className={styles.step}>3</span>검토·문서 저장·발송</h3><span className={styles.badge}>{quotationStatusLabels[selected.status]}</span></div>
        {dirty && <p className={styles.warning}>수정한 내용을 먼저 저장해 주세요. 아래 금액과 문서는 마지막 저장 내용을 기준으로 표시됩니다.</p>}
        <dl className={styles.totals}><div><dt>공급가액</dt><dd>{quotationMoney(selected.totals?.subtotal)}</dd></div><div><dt>부가세 {selected.vatRate}%</dt><dd>{quotationMoney(selected.totals?.vat)}</dd></div><div><dt>견적 합계</dt><dd>{quotationMoney(selected.totals?.total)}</dd></div></dl>
        {!!selected.issues?.length && <div className={styles.warning}><h3>승인 전에 확인할 항목</h3><ul className={styles.issues}>{selected.issues.map((issue, index) => <li key={`${issue.field}-${index}`}>{issue.message}</li>)}</ul></div>}
        <details><summary>적용한 거래 조건·자료 확인</summary><div className={styles.stack}><dl className={styles.facts}><dt>공급자</dt><dd>{selected.settingsSnapshot.supplierName}</dd><dt>연락처</dt><dd>{selected.settingsSnapshot.supplierContact || '—'}</dd><dt>결제 조건</dt><dd>{selected.paymentTerms || '—'}</dd><dt>납기 조건</dt><dd>{selected.deliveryTerms || '—'}</dd><dt>발행일</dt><dd>{dateLabel(selected.issuedAt)}</dd><dt>유효 기한</dt><dd>{dateLabel(selected.validUntil)}</dd><dt>회사 기준</dt><dd>{selected.settingsRevision}차 · {dateLabel(selected.settingsSnapshot.approvedAt)}</dd></dl>{selected.sourceEvidence?.map((source) => <p className={styles.muted} key={source.id}>{source.name} · 자료 버전 {source.version}</p>)}{!selected.sourceEvidence?.length && <p className={styles.muted}>연결한 회사 자료가 없습니다.</p>}</div></details>
        {!locked && <div className={styles.actions}><button type="button" disabled={!savedClean || Boolean(selected.issues?.length) || selected.status !== 'draft'} onClick={async () => { const result = await act({ kind: 'quotation_review', id: selected.id, expectedRevision: selected.revision, approved: true }, '견적 금액과 조건을 검토 승인하고 있습니다…'); if (successful(result) && result?.quotation) acceptQuotation(result.quotation); }}>금액과 조건을 확인하고 검토 승인</button>{selected.status !== 'draft' && <span className={styles.muted}>검토한 내용이 승인되어 있습니다.</span>}</div>}
        <hr className={styles.divider} />
        <div className={styles.two}><label>견적서 파일 형식<select value={exportFormat || ''} onChange={(event) => setFormat(event.target.value as DocumentFormat)}>{exportFormats.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}{!exportFormats.length && <option value="">이 환경에서 저장할 수 있는 형식 없음</option>}</select></label><div className={styles.actions}><button type="button" disabled={!savedClean || locked || selected.status === 'draft' || !exportFormat} onClick={async () => { const result = await act({ kind: 'quotation_export', id: selected.id, expectedRevision: selected.revision, format: exportFormat }, '승인한 견적을 회사 양식으로 저장하고 있습니다…'); if (successful(result) && result?.quotation) acceptQuotation(result.quotation); }}>견적서 파일 저장</button></div></div>
        {selected.artifact && <div className={styles.row}><p className={styles.muted}>저장한 파일: {selected.artifact.name}</p><button type="button" onClick={() => void openArtifact(selected.artifact!.id)}>견적서 열어보기</button></div>}
        {!locked && <><hr className={styles.divider} /><label>발송할 메일 계정<select value={accountId} onChange={(event) => { setAccountId(event.target.value); setSendContext(null); }}><option value="">연결된 업무 메일 계정 선택</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>{!accounts.length && <p className={styles.muted}>‘메일·메신저’에서 업무 메일을 연결한 뒤 새로고침해 주세요.</p>}<div className={styles.actions}><button type="button" disabled={!readyToSend || !accountId} onClick={async () => { setSendContext(null); const result = await act({ kind: 'quotation_prepare_send', id: selected.id, expectedRevision: selected.revision, accountId }, '수신자와 첨부 파일을 발송 전에 확인하고 있습니다…'); if (successful(result) && result?.quotation?.sendPreview?.token) { const quotation = result.quotation; setSendContext({ id: quotation.id, revision: quotation.revision, accountId, token: quotation.sendPreview!.token! }); } }}>수신자·첨부 파일 최종 확인</button>{!readyToSend && <span className={styles.muted}>검토 승인과 견적서 파일 저장 후 발송할 수 있습니다.</span>}</div></>}
        {previewReady && selected.sendPreview && <div className={styles.proposal}><h3>이 내용으로 메일을 발송합니다</h3><dl className={styles.facts}><dt>발송 계정</dt><dd>{selected.sendPreview.accountName || selected.sendPreview.from || accounts.find((account) => account.id === accountId)?.name}</dd><dt>받는 사람</dt><dd>{selected.sendPreview.recipient || selected.sendPreview.to || selected.customerEmail}</dd><dt>메일 제목</dt><dd>{selected.sendPreview.subject || selected.emailSubject}</dd><dt>첨부 파일</dt><dd>{selected.sendPreview.artifactName || selected.sendPreview.attachmentName || selected.artifact?.name}</dd></dl><p className={styles.mailBody}>{selected.sendPreview.body || selected.emailBody}</p><button type="button" className={styles.primary} onClick={async () => { if (!sendContext) return; const context = sendContext; setSendContext(null); await act({ kind: 'quotation_send', id: context.id, expectedRevision: context.revision, token: context.token }, '최종 승인 후 견적 메일을 발송하고 있습니다…'); }}>최종 승인하고 견적 메일 발송</button></div>}
      </section>}

      <section className={styles.card}><div className={styles.row}><h3>저장한 견적</h3><span className={styles.muted}>{state?.quotations.length || 0}건</span></div>{!state?.quotations.length ? <p className={styles.muted}>첫 견적을 저장하면 적용한 회사 기준과 진행 상태를 여기서 확인할 수 있습니다.</p> : <div className={styles.list}>{state.quotations.map((quotation) => <button type="button" key={quotation.id} className={`${styles.quoteButton} ${quotation.id === selectedId ? styles.selected : ''}`} aria-pressed={quotation.id === selectedId} onClick={() => requestSelection(quotation.id)}><span><strong>{quotation.number} · {quotation.customerName || '고객 확인 필요'}</strong><small className={styles.muted}>{quotationMoney(quotation.totals?.total)} · 회사 기준 {quotation.settingsRevision}차</small></span><span className={styles.badge}>{quotationStatusLabels[quotation.status]}</span></button>)}</div>}</section>
      {selected?.receipt && <section className={styles.card}>
        <h3>견적 발송 기록</h3>
        <dl className={styles.facts}>
          <dt>기록 시각</dt><dd>{dateLabel(selected.receipt.completedAt)}</dd>
          <dt>발신 계정</dt><dd>{selected.receipt.snapshot.accountName}</dd>
          <dt>수신자</dt><dd>{selected.receipt.snapshot.recipient}</dd>
          <dt>첨부 파일</dt><dd>{selected.receipt.snapshot.artifactName}</dd>
          <dt>처리 결과</dt><dd>{selected.receipt.status === 'sent' ? '메일 서버 접수 확인' : selected.receipt.status === 'uncertain' ? '발송 여부 확인 필요' : '발송 전 연결·입력 확인 필요'}</dd>
        </dl>
        {selected.sendError && <p className={styles.warning}>{selected.sendError}</p>}
        <details><summary>발송한 내용과 파일 근거</summary><div className={styles.stack}><strong>{selected.receipt.snapshot.subject}</strong><p className={styles.mailBody}>{selected.receipt.snapshot.body}</p><p className={styles.muted}>첨부 SHA-256: {selected.receipt.snapshot.artifactHash}</p></div></details>
      </section>}
    </fieldset>
  </section>;
}
