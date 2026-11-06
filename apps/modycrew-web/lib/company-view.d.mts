type RequestLike = { id: string; status: string; outputText?: string; updatedAtEpochMs?: number; createdAtEpochMs?: number };
type MessageLike = { id: string; authorUid: string; authorName?: string; kind: string; requestId?: string; createdAtEpochMs: number };
type MemberLike = { uid: string; email?: string; displayName?: string; role: string; status: string };
export function visibleCompanyRequests<T extends RequestLike>(requests: T[], messages: Array<{ requestId?: string }>, now?: number, recentMs?: number): T[];
export function companyAuthorBadge(message: MessageLike | null | undefined, members: MemberLike[]): string;
export const PERSONAL_AI_NOTE: string;
export function mergeCompanyMessages<T extends { id: string; createdAtEpochMs: number }>(older: T[], live: T[]): T[];
