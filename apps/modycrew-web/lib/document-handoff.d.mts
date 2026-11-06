export const DOCUMENT_HANDOFF_KEY: string;
export const DOCUMENT_HANDOFF_TTL_MS: number;
export type DocumentHandoff = { title: string; text: string; sourceLabel: string; workThreadId?: string; workRoot?: string };
export type PendingDocumentHandoff = DocumentHandoff & { receipt: string; id: string; expired: boolean };
export function peekDocumentHandoff(storage: Pick<Storage, 'getItem'> | null | undefined, now?: number): PendingDocumentHandoff | null;
export function acknowledgeDocumentHandoff(storage: Pick<Storage, 'getItem' | 'removeItem'> | null | undefined, receipt: string): boolean;
export function stageDocumentHandoff(storage: Pick<Storage, "setItem"> & Partial<Pick<Storage, 'getItem'>> | null | undefined, input?: { title?: string; text?: string; sourceLabel?: string; workThreadId?: string; workRoot?: string }, now?: number): boolean;
export function takeDocumentHandoff(storage: Pick<Storage, "getItem" | "removeItem"> | null | undefined, now?: number): DocumentHandoff | null;
