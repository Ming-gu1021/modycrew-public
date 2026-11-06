import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { companyRoot, readJson, writeJson, clean, digest, readCompanyRecord } from './company-records.mjs';

const queues = new Map();
const LOCKED_STATUSES = new Set(['sending', 'sent', 'uncertain']);
const ROUNDING = '품목별 수량 × 단가를 원 단위로 반올림(0.5원 이상 올림)한 뒤 합산하며, 부가세는 공급가액 합계 × 세율을 원 단위로 반올림합니다.';
const copy = (value) => structuredClone(value);
const own = (value, key) => Object.hasOwn(value, key);
const stable = (value) => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b, 'en'))) : item);
const fingerprint = (value) => digest(stable(value));
const issue = (field, code, message) => ({ field, code, message });
const scalar = (value) => typeof value === 'string' ? value.trim() : typeof value === 'number' && Number.isFinite(value) ? String(value) : '';
const emptyStore = () => ({ version: 1, settings: null, settingsHistory: [], quotations: [], requests: {}, sequence: 0 });

/** One process owns this store, as with the desktop company runtime. Alias paths share a queue. */
export async function loadQuotationStore(options = {}) {
  const store = await readJson(path.join(companyRoot(options), 'quotations.json'), emptyStore());
  if (store?.version !== 1 || !Array.isArray(store.quotations) || !Array.isArray(store.settingsHistory) || !store.requests || typeof store.requests !== 'object' || Array.isArray(store.requests) || !Number.isSafeInteger(store.sequence) || store.sequence < 0) {
    throw new Error('저장된 견적 기록의 형식이 올바르지 않습니다. 원본을 보존한 채 복구가 필요합니다.');
  }
  return store;
}

export async function mutateQuotationStore(options, callback) {
  const root = path.resolve(companyRoot(options));
  const key = process.platform === 'win32' ? root.toLowerCase() : root;
  const previous = queues.get(key) || Promise.resolve();
  const operation = previous.catch(() => {}).then(async () => {
    const store = await loadQuotationStore({ ...options, companyRoot: root });
    const result = await callback(store);
    await writeJson(path.join(root, 'quotations.json'), store);
    return copy(result);
  });
  queues.set(key, operation);
  try { return await operation; } finally { if (queues.get(key) === operation) queues.delete(key); }
}

function normalizeDays(value) {
  const text = scalar(value);
  return /^\d{1,4}$/u.test(text) && Number(text) >= 1 && Number(text) <= 3650 ? Number(text) : null;
}

function normalizeVat(value) {
  return value === 0 || value === '0' ? 0 : value === 10 || value === '10' ? 10 : null;
}

export function normalizeQuotationSettings(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('회사 견적 기준을 확인해 주세요.');
  const fieldMapping = {};
  const mapping = input.fieldMapping ?? input.mapping ?? {};
  if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping) || Object.keys(mapping).length > 150) throw new Error('회사 양식의 연결 항목을 확인해 주세요.');
  for (const [key, value] of Object.entries(mapping)) {
    if (!key || key.length > 300 || ['__proto__', 'prototype', 'constructor'].includes(key) || typeof value !== 'string' || !value.trim() || value.length > 120) throw new Error('회사 양식의 연결 항목을 확인해 주세요.');
    fieldMapping[key] = value.trim();
  }
  return {
    supplierName: clean(input.supplierName, 140), supplierContact: clean(input.supplierContact, 500),
    paymentTerms: clean(input.paymentTerms, 2000), deliveryTerms: clean(input.deliveryTerms, 2000),
    validityDays: normalizeDays(input.validityDays), numberPrefix: clean(input.numberPrefix, 32),
    currency: input.currency === undefined ? 'KRW' : clean(input.currency, 10), vatRate: normalizeVat(input.vatRate),
    templateId: clean(input.templateId, 100), templateHash: clean(input.templateHash ?? input.hash, 64),
    templateFormat: clean(input.templateFormat ?? input.format, 10).toLowerCase(),
    templateVersion: Number.isSafeInteger(input.templateVersion) && input.templateVersion > 0 ? input.templateVersion : null,
    fieldMapping,
  };
}

export function quotationSettingsIssues(settings) {
  const result = [];
  for (const [field, label] of [['supplierName', '공급자 회사명'], ['supplierContact', '공급자 연락처'], ['paymentTerms', '결제 조건'], ['deliveryTerms', '납기 조건'], ['numberPrefix', '견적 번호 머리말']]) {
    if (!settings[field]) result.push(issue(field, 'required', `${label}을 입력해 주세요.`));
  }
  if (settings.numberPrefix && !/^[\p{L}\p{N}_-]{1,32}$/u.test(settings.numberPrefix)) result.push(issue('numberPrefix', 'invalid', '견적 번호 머리말에는 글자·숫자·밑줄·하이픈만 사용할 수 있습니다.'));
  if (settings.validityDays === null) result.push(issue('validityDays', 'invalid', '견적 유효기간을 1~3650일로 입력해 주세요.'));
  if (settings.currency !== 'KRW') result.push(issue('currency', 'unsupported', '현재 견적 계산은 원화(KRW)를 지원합니다.'));
  if (![0, 10].includes(settings.vatRate)) result.push(issue('vatRate', 'invalid', '부가세율을 0% 또는 10%로 선택해 주세요.'));
  if (settings.templateId && (!/^[a-f0-9]{64}$/u.test(settings.templateHash) || !['docx', 'pptx', 'xlsx', 'hwpx', 'hwp'].includes(settings.templateFormat))) result.push(issue('templateId', 'invalid', '회사 양식의 파일 해시와 형식을 다시 확인해 주세요.'));
  if (!settings.templateId && (settings.templateHash || settings.templateFormat || Object.keys(settings.fieldMapping).length)) result.push(issue('templateId', 'required', '연결할 회사 양식을 선택해 주세요.'));
  if (['supplierName', 'supplierContact', 'paymentTerms', 'deliveryTerms'].some((field) => /확인\s*필요|미확인|미정|\{\{[^}]+\}\}/u.test(settings[field]))) result.push(issue('content', 'unresolved', '회사 기준에 확인 필요·미정 표시가 남아 있습니다. 실제 내용을 확인해 주세요.'));
  return result;
}

function assertRevision(expectedRevision, currentRevision, label) {
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision !== currentRevision) throw new Error(`${label}이 다른 창에서 변경됐습니다. 최신 내용을 다시 열고 확인해 주세요.`);
}

export async function saveQuotationSettings({ settings: input, expectedRevision, approved } = {}, options = {}) {
  if (approved !== true) throw new Error('회사 견적 기준을 검토하고 저장을 승인해 주세요.');
  const settings = normalizeQuotationSettings(input);
  const issues = quotationSettingsIssues(settings);
  if (issues.length) throw new Error(issues.map((item) => item.message).join(' '));
  return mutateQuotationStore(options, (store) => {
    assertRevision(expectedRevision, store.settings?.revision || 0, '회사 견적 기준');
    if (store.settings) store.settingsHistory.push(copy(store.settings));
    store.settings = { ...settings, revision: (store.settings?.revision || 0) + 1, approvedAt: new Date().toISOString() };
    return store.settings;
  });
}

function integerWon(value) {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) throw new Error('단가는 정확한 원 단위 정수로 입력해 주세요. 큰 금액은 숫자 문자열로 입력해 주세요.');
  const text = scalar(value);
  if (!/^\d{1,60}$/u.test(text)) throw new Error('단가는 음수·쉼표·소수점 없는 원 단위 정수로 입력해 주세요.');
  return BigInt(text);
}

function quantityThousandths(value) {
  if (typeof value === 'number' && Math.abs(value) > Number.MAX_SAFE_INTEGER) throw new Error('큰 수량은 정확한 숫자 문자열로 입력해 주세요.');
  const text = scalar(value);
  if (!/^\d{1,30}(?:\.\d{1,3})?$/u.test(text)) throw new Error('수량은 양수이며 소수점 아래 세 자리까지 입력할 수 있습니다.');
  const [whole, fraction = ''] = text.split('.');
  const result = BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, '0'));
  if (result <= 0n) throw new Error('수량은 0보다 크게 입력해 주세요.');
  return result;
}

const round = (numerator, denominator) => (numerator + denominator / 2n) / denominator;

/** Integer strings keep won exact beyond JavaScript's safe integer range. */
export function calculateQuotation(items, vatRate) {
  const rate = normalizeVat(vatRate);
  if (rate === null) throw new Error('부가세율을 0% 또는 10%로 선택해 주세요.');
  if (!Array.isArray(items) || !items.length || items.length > 500) throw new Error('견적 품목은 1~500개 입력해 주세요.');
  const lineAmounts = items.map((item) => round(integerWon(item.unitPrice) * quantityThousandths(item.quantity), 1000n).toString());
  const subtotal = lineAmounts.reduce((sum, amount) => sum + BigInt(amount), 0n);
  const vat = round(subtotal * BigInt(rate), 100n);
  return { subtotal: subtotal.toString(), vat: vat.toString(), total: (subtotal + vat).toString(), lineAmounts, rounding: ROUNDING };
}

function dateOnly(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value || '')) return '';
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : '';
}

function today() {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const read = (name) => parts.find((part) => part.type === name).value;
  return `${read('year')}-${read('month')}-${read('day')}`;
}

function validUntil(issuedAt, days) {
  if (!dateOnly(issuedAt) || days === null) return '';
  const date = new Date(`${issuedAt}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function normalizeItems(items) {
  if (!Array.isArray(items)) return [];
  if (items.length > 500) throw new Error('견적 품목은 500개까지 입력할 수 있습니다.');
  return items.map((item) => {
    if (!item || typeof item !== 'object') return { description: '', quantity: '', unitPrice: '', unit: '' };
    // Unsafe numeric inputs must not be converted to seemingly exact strings.
    if (typeof item.unitPrice === 'number' && !Number.isSafeInteger(item.unitPrice)) throw new Error('큰 금액이나 소수 단가는 사용할 수 없습니다. 정확한 원 단위 정수 문자열로 입력해 주세요.');
    if (typeof item.quantity === 'number' && Math.abs(item.quantity) > Number.MAX_SAFE_INTEGER) throw new Error('큰 수량은 정확한 숫자 문자열로 입력해 주세요.');
    return { description: clean(item.description, 1000), quantity: scalar(item.quantity), unitPrice: scalar(item.unitPrice), unit: clean(item.unit, 40) };
  });
}

const EDITABLE = ['customerName', 'customerEmail', 'items', 'paymentTerms', 'deliveryTerms', 'validityDays', 'vatRate', 'currency', 'issuedAt', 'sourceIds', 'request', 'sourceWorkId', 'emailSubject', 'emailBody'];

function normalizeInput(input) {
  const result = {};
  for (const field of EDITABLE) {
    if (!own(input, field)) continue;
    if (field === 'items') result.items = normalizeItems(input.items);
    else if (field === 'validityDays') result.validityDays = normalizeDays(input.validityDays);
    else if (field === 'vatRate') result.vatRate = normalizeVat(input.vatRate);
    else if (field === 'sourceIds') {
      if (!Array.isArray(input.sourceIds) || input.sourceIds.length > 30 || input.sourceIds.some((id) => typeof id !== 'string' || !/^[a-f0-9-]{36}$/u.test(id))) throw new Error('견적의 회사 근거 자료를 다시 선택해 주세요.');
      result.sourceIds = [...new Set(input.sourceIds)].sort();
    } else result[field] = clean(input[field], field === 'emailBody' || field === 'request' ? 10000 : field.endsWith('Terms') ? 2000 : field === 'customerName' ? 140 : field === 'emailSubject' ? 180 : 500);
  }
  return result;
}

export function quotationIssues(quotation) {
  const issues = [];
  if (!quotation.settingsSnapshot?.approvedAt || !quotation.settingsRevision) issues.push(issue('settings', 'approval_required', '먼저 회사 견적 기준을 검토하고 승인해 주세요.'));
  for (const [field, label] of [['customerName', '고객 회사명'], ['customerEmail', '고객 이메일'], ['paymentTerms', '결제 조건'], ['deliveryTerms', '납기 조건']]) {
    if (!quotation[field]) issues.push(issue(field, 'required', `${label}을 입력해 주세요.`));
  }
  if (quotation.customerEmail && (!/^[^\s@<>;,]+@[^\s@<>;,]+\.[^\s@<>;,]+$/u.test(quotation.customerEmail) || quotation.customerEmail.length > 254)) issues.push(issue('customerEmail', 'invalid', '고객 이메일 주소 한 개를 정확하게 입력해 주세요.'));
  if (quotation.validityDays === null) issues.push(issue('validityDays', 'invalid', '견적 유효기간을 1~3650일로 입력해 주세요.'));
  if (quotation.currency !== 'KRW') issues.push(issue('currency', 'unsupported', '현재 견적 계산은 원화(KRW)를 지원합니다.'));
  if (![0, 10].includes(quotation.vatRate)) issues.push(issue('vatRate', 'invalid', '부가세율을 0% 또는 10%로 선택해 주세요.'));
  if (!dateOnly(quotation.issuedAt)) issues.push(issue('issuedAt', 'invalid', '견적일을 올바른 날짜로 입력해 주세요.'));
  if (/\r|\n/u.test(quotation.emailSubject || '')) issues.push(issue('emailSubject', 'invalid', '메일 제목은 한 줄로 입력해 주세요.'));
  if (!quotation.items.length) issues.push(issue('items', 'required', '견적 품목을 한 개 이상 입력해 주세요.'));
  quotation.items.forEach((item, index) => {
    if (!item.description) issues.push(issue(`items.${index}.description`, 'required', `${index + 1}번째 품목명을 입력해 주세요.`));
    for (const [field, parse] of [['unitPrice', integerWon], ['quantity', quantityThousandths]]) {
      try { parse(item[field]); } catch (error) { issues.push(issue(`items.${index}.${field}`, 'invalid', `${index + 1}번째 품목: ${error.message}`)); }
    }
  });
  const values = [quotation.customerName, quotation.customerEmail, quotation.paymentTerms, quotation.deliveryTerms, quotation.settingsSnapshot?.supplierName, quotation.settingsSnapshot?.supplierContact, ...quotation.items.map((item) => item.description)];
  if (values.some((value) => /확인\s*필요|미확인|미정|\{\{[^}]+\}\}/u.test(value || ''))) issues.push(issue('content', 'unresolved', '확인 필요·미정 또는 빈 양식 표시가 남아 있습니다. 실제 내용을 확인해 주세요.'));
  return issues;
}

async function sourceEvidence(ids, options) {
  return Promise.all(ids.map(async (id) => {
    const record = await readCompanyRecord(id, options);
    return { id: record.id, name: record.name, hash: record.hash, version: record.version, textHash: record.textHash, tablesHash: record.tablesHash, importedAt: record.importedAt };
  }));
}

function refreshDerived(quotation) {
  quotation.validUntil = validUntil(quotation.issuedAt, quotation.validityDays);
  quotation.issues = quotationIssues(quotation);
  try { quotation.totals = calculateQuotation(quotation.items, quotation.vatRate); } catch { quotation.totals = null; }
}

function findQuotation(store, id) {
  const quotation = store.quotations.find((item) => item.id === id);
  if (!quotation) throw new Error('견적을 찾지 못했습니다. 목록을 새로 열어 주세요.');
  return quotation;
}

export async function createQuotation(input = {}, options = {}) {
  const requestId = clean(input.requestId, 200);
  if (!requestId || requestId !== input.requestId) throw new Error('견적 생성 요청을 다시 시작해 주세요. 중복 방지 번호가 필요합니다.');
  const normalized = normalizeInput(input);
  const inputHash = fingerprint(normalized);
  const key = digest(requestId);
  return mutateQuotationStore(options, async (store) => {
    if (own(store.requests, key)) {
      const previous = store.requests[key];
      if (previous.inputHash !== inputHash) throw new Error('같은 요청 번호로 다른 견적 내용이 전달됐습니다. 새 견적 작성을 시작해 주세요.');
      return findQuotation(store, previous.id);
    }
    if (store.quotations.length >= 5000) throw new Error('견적 기록이 5,000건에 도달했습니다. 기존 기록을 내보내고 정리해 주세요.');
    const settings = store.settings ? copy(store.settings) : null;
    const issuedAt = own(normalized, 'issuedAt') ? normalized.issuedAt : today();
    const sequence = store.sequence + 1;
    const now = new Date().toISOString();
    const quotation = {
      id: randomUUID(), revision: 1, status: 'draft', requestId,
      number: `${settings?.numberPrefix || 'QUOTE'}-${issuedAt.replace(/-/gu, '')}-${String(sequence).padStart(6, '0')}`,
      customerName: '', customerEmail: '', items: [], request: '', sourceWorkId: '', emailSubject: '', emailBody: '',
      paymentTerms: settings?.paymentTerms || '', deliveryTerms: settings?.deliveryTerms || '', validityDays: settings?.validityDays ?? null,
      currency: settings?.currency || 'KRW', vatRate: settings?.vatRate ?? null,
      issuedAt, sourceIds: [], ...normalized, settingsSnapshot: settings, settingsRevision: settings?.revision || 0,
      sourceEvidence: await sourceEvidence(normalized.sourceIds || [], options),
      createdAt: now, updatedAt: now, history: [], document: null, approval: null,
    };
    refreshDerived(quotation);
    store.quotations.push(quotation); store.sequence = sequence; store.requests[key] = { id: quotation.id, inputHash, createdAt: now };
    return quotation;
  });
}

export async function updateQuotation({ id, expectedRevision, patch } = {}, options = {}) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('수정할 견적 내용을 확인해 주세요.');
  const normalized = normalizeInput(patch);
  return mutateQuotationStore(options, async (store) => {
    const quotation = findQuotation(store, id);
    assertRevision(expectedRevision, quotation.revision, '견적');
    if (LOCKED_STATUSES.has(quotation.status)) throw new Error('발송 중이거나 발송 결과가 기록된 견적은 수정할 수 없습니다. 내용을 복사해 새 견적을 만들어 주세요.');
    if (!['draft', 'reviewed', 'prepared'].includes(quotation.status)) throw new Error('현재 상태의 견적은 수정할 수 없습니다.');
    const evidence = own(normalized, 'sourceIds') ? await sourceEvidence(normalized.sourceIds, options) : quotation.sourceEvidence;
    const { history, ...snapshot } = quotation;
    history.push(copy(snapshot));
    Object.assign(quotation, normalized, { sourceEvidence: evidence, revision: quotation.revision + 1, status: 'draft', updatedAt: new Date().toISOString(), document: null, approval: null });
    // Any delivery information belongs only to the superseded document snapshot.
    for (const key of ['prepared', 'preparedDocument', 'sendApproval', 'delivery', 'sendAttempt', 'sentAt', 'error', 'artifact', 'sendPreview', 'receipt', 'sendError']) delete quotation[key];
    refreshDerived(quotation);
    return quotation;
  });
}

const formatWon = (value) => `${BigInt(value).toString().replace(/\B(?=(\d{3})+(?!\d))/gu, ',')}원`;

export function buildQuotationDocumentSpec(quotation) {
  const issues = quotationIssues(quotation);
  if (issues.length) throw new Error(`견적서 작성 전에 확인해 주세요. ${issues.map((item) => item.message).join(' ')}`);
  const totals = calculateQuotation(quotation.items, quotation.vatRate);
  const supplier = quotation.settingsSnapshot;
  return {
    title: `${quotation.customerName} 견적서`, templateId: 'quotation', company: supplier.supplierName, author: '', period: `${quotation.issuedAt} ~ ${quotation.validUntil}`,
    sections: [
      { heading: '견적 대상', paragraphs: [`견적 번호: ${quotation.number}`, `견적일: ${quotation.issuedAt}`, `고객 회사명: ${quotation.customerName}`, `고객 이메일: ${quotation.customerEmail}`, `공급자: ${supplier.supplierName}`, `공급자 연락처: ${supplier.supplierContact}`] },
      { heading: '품목 및 금액', paragraphs: ['통화: KRW (원)'], table: { columns: ['번호', '품목', '수량', '단위', '단가', '공급가액'], rows: quotation.items.map((item, index) => [String(index + 1), item.description, item.quantity, item.unit, formatWon(item.unitPrice), formatWon(totals.lineAmounts[index])]) } },
      { heading: '견적 합계', paragraphs: [`공급가액: ${formatWon(totals.subtotal)}`, `부가세 (${quotation.vatRate}%): ${formatWon(totals.vat)}`, `합계: ${formatWon(totals.total)}`] },
      { heading: '거래 조건', paragraphs: [`결제 조건: ${quotation.paymentTerms}`, `납기 조건: ${quotation.deliveryTerms}`, `유효기간: 견적일로부터 ${quotation.validityDays}일 (${quotation.validUntil}까지)`] },
    ],
    sources: [`사용자 확인 견적 ${quotation.number} / 수정 ${quotation.revision}`, `사용자 승인 회사 견적 기준 v${quotation.settingsRevision} / ${supplier.approvedAt}`,
      ...(supplier.templateId ? [`회사 양식 ${supplier.templateId}${supplier.templateVersion ? ` / v${supplier.templateVersion}` : ''} / SHA256:${supplier.templateHash}`] : []),
      ...quotation.sourceEvidence.map((source) => `${source.name} / v${source.version} / SHA256:${source.hash}`)],
    notes: [ROUNDING],
  };
}

/** Explicit review approves only the immutable document snapshot, never email delivery. */
export async function reviewQuotation({ id, expectedRevision, approved } = {}, options = {}) {
  if (approved !== true) throw new Error('견적 내용과 금액을 검토한 뒤 승인을 눌러 주세요.');
  return mutateQuotationStore(options, async (store) => {
    const quotation = findQuotation(store, id);
    assertRevision(expectedRevision, quotation.revision, '견적');
    if (LOCKED_STATUSES.has(quotation.status)) throw new Error('발송 중이거나 발송 결과가 기록된 견적은 다시 승인할 수 없습니다.');
    if (!['draft', 'reviewed', 'prepared'].includes(quotation.status)) throw new Error('현재 상태의 견적은 승인할 수 없습니다.');
    const currentSources = await sourceEvidence(quotation.sourceIds, options);
    if (fingerprint(currentSources) !== fingerprint(quotation.sourceEvidence)) throw new Error('견적 작성에 사용한 회사 자료가 변경됐습니다. 근거 자료를 다시 선택하고 검토해 주세요.');
    refreshDerived(quotation);
    const spec = buildQuotationDocumentSpec(quotation);
    const hash = fingerprint(spec);
    if (quotation.approval?.revision === quotation.revision && quotation.approval.documentHash === hash && quotation.document?.hash === hash && ['reviewed', 'prepared'].includes(quotation.status)) return quotation;
    const now = new Date().toISOString();
    quotation.document = { spec, hash, revision: quotation.revision, createdAt: now };
    quotation.approval = { revision: quotation.revision, documentHash: hash, approvedAt: now };
    quotation.status = 'reviewed'; quotation.updatedAt = now;
    return quotation;
  });
}
