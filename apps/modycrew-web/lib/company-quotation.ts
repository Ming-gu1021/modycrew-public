import type { CompanyRecord, CompanyAutomationResult } from './company-automation';
import type { CompanyDocumentTemplate, DocumentFormat, SavedDocument } from './document-production';

export type QuotationSettings = {
  revision: number;
  supplierName: string;
  supplierContact: string;
  paymentTerms: string;
  deliveryTerms: string;
  validityDays: number;
  numberPrefix: string;
  currency: 'KRW';
  vatRate: 0 | 10;
  templateId: string;
  templateHash?: string;
  templateFormat?: DocumentFormat;
  fieldMapping: Record<string, string>;
  approvedAt?: string;
};
export type QuotationItem = { description: string; quantity: string | number; unitPrice: string | number };
export type QuotationDraft = {
  customerName: string;
  customerEmail: string;
  items: QuotationItem[];
  sourceIds: string[];
  sourceWorkId: string;
  request: string;
  emailSubject: string;
  emailBody: string;
  paymentTerms?: string;
  deliveryTerms?: string;
  validityDays?: number;
  vatRate?: 0 | 10;
};
export type CompanyQuotation = QuotationDraft & {
  id: string;
  revision: number;
  status: 'draft' | 'reviewed' | 'prepared' | 'sending' | 'sent' | 'uncertain';
  number: string;
  settingsSnapshot: QuotationSettings;
  settingsRevision: number;
  paymentTerms: string;
  deliveryTerms: string;
  validityDays: number;
  currency: 'KRW';
  vatRate: 0 | 10;
  totals: { subtotal: string; vat: string; total: string; lineAmounts?: string[] } | null;
  issues: { field: string; code: string; message: string }[];
  sourceEvidence: { id: string; name: string; hash: string; version: number }[];
  document: { hash: string; revision: number; createdAt: string } | null;
  artifact?: SavedDocument;
  sendError?: string;
  receipt?: { id: string; status: string; completedAt: string; providerStatus: string; providerMessageId?: string; snapshot: { accountName: string; recipient: string; subject: string; body: string; artifactName: string; artifactHash: string; total: string } };
  issuedAt: string;
  validUntil: string;
  sendPreview?: { token?: string; accountId?: string; accountName?: string; recipient?: string; artifactName?: string; from?: string; to?: string; subject?: string; body?: string; attachmentName?: string; [key: string]: unknown };
  history?: { at?: string; action?: string; status?: string; [key: string]: unknown }[];
};
export type QuotationState = { settings: QuotationSettings | null; settingsHistory: QuotationSettings[]; quotations: CompanyQuotation[]; sequence: number };
export type QuotationSuggestion = Partial<QuotationDraft> & { notes?: string[] };
export type QuotationSettingsProposal = Partial<QuotationSettings> & { evidence?: unknown[]; notes?: string[]; settings?: Partial<QuotationSettings> };
export type QuotationResult = CompanyAutomationResult & {
  quotationState?: QuotationState;
  quotation?: CompanyQuotation;
  templates?: CompanyDocumentTemplate[];
  formats?: DocumentFormat[];
  records?: CompanyRecord[];
  mailAccounts?: { id: string; name: string; status: string }[];
  inquiries?: { id: string; request: string; source?: { kind?: string; provider?: string }; createdAt: string }[];
  suggestion?: QuotationSuggestion;
  settingsProposal?: QuotationSettingsProposal;
};

export const quotationFieldLabels: Record<string, string> = {
  number: '견적 번호', customerName: '고객명', customerEmail: '고객 이메일', supplierName: '공급자명', supplierContact: '공급자 연락처',
  paymentTerms: '결제 조건', deliveryTerms: '납기 조건', issuedAt: '발행일', validUntil: '유효 기한', subtotal: '공급가액', vat: '부가세', total: '합계', items: '품목 목록',
};
export const quotationStatusLabels: Record<CompanyQuotation['status'], string> = {
  draft: '작성 중', reviewed: '검토 승인', prepared: '발송 준비', sending: '발송 처리 중', sent: '발송 완료', uncertain: '발송 결과 확인 필요',
};
export const emptyQuotationSettings = (): QuotationSettings => ({
  revision: 0, supplierName: '', supplierContact: '', paymentTerms: '', deliveryTerms: '', validityDays: 30,
  numberPrefix: '', currency: 'KRW', vatRate: 10, templateId: '', fieldMapping: {},
});
export const emptyQuotationDraft = (): QuotationDraft => ({
  customerName: '', customerEmail: '', items: [{ description: '', quantity: '1', unitPrice: '' }],
  sourceIds: [], sourceWorkId: '', request: '', emailSubject: '', emailBody: '',
});
export function draftFromQuotation(quotation: CompanyQuotation): QuotationDraft {
  return {
    customerName: quotation.customerName || '', customerEmail: quotation.customerEmail || '',
    items: quotation.items.map((item) => ({ ...item })),
    sourceIds: quotation.sourceIds || quotation.sourceEvidence?.map((source) => source.id) || [],
    sourceWorkId: quotation.sourceWorkId || '', request: quotation.request || '',
    emailSubject: quotation.emailSubject || '', emailBody: quotation.emailBody || '',
    paymentTerms: quotation.paymentTerms || '', deliveryTerms: quotation.deliveryTerms || '',
    validityDays: quotation.validityDays, vatRate: quotation.vatRate,
  };
}
export function quotationMoney(value?: string | number | null) {
  if (value === undefined || value === null || value === '') return '확인 필요';
  const text = String(value);
  if (!/^-?\d+(\.\d+)?$/.test(text)) return text;
  const [whole, fraction] = text.split('.');
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${fraction ? `.${fraction}` : ''}원`;
}
