import type { DocumentFormat, DocumentSpec } from './document-production';
export type DocumentEditorDraft = {
  title: string; source: string; company: string; author: string; period: string; templateId: string;
  companyTemplateId: string; from: string; to: string; query: string; sources: string[]; companySourceIds: string[];
  mapping: Record<string, string>; fields: Record<string, string>; format: DocumentFormat; spec: DocumentSpec | null;
  workLink: { threadId: string; root: string } | null; dirty: boolean; appliedHandoffs: string[];
};
export function documentDraftKey(account: string, root: string): string;
export function normalizeDocumentDraft(value: unknown): DocumentEditorDraft;
export function readDocumentDraft(storage: Pick<Storage, 'getItem'>, key: string): DocumentEditorDraft | null;
export function saveDocumentDraft(storage: Pick<Storage, 'setItem'>, key: string, value: DocumentEditorDraft): void;
