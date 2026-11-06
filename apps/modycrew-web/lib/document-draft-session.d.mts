import type { DocumentEditorDraft } from './document-draft-storage.mjs';
export type DocumentDraftRevision = { id: string; createdAt: number; reason: string; draft: DocumentEditorDraft };
export type DocumentDraftSession = {
  load(): DocumentEditorDraft | null;
  save(value: DocumentEditorDraft, previous?: DocumentEditorDraft, reason?: string): Promise<void>;
  reload(value: DocumentEditorDraft): Promise<DocumentEditorDraft | null>;
  history(): { entries: DocumentDraftRevision[]; unreadable: number };
  close(): void;
};
export function createDocumentDraftSession(storage: Storage, key: string, withLock: <T>(name: string, action: () => T) => Promise<T>): DocumentDraftSession;
