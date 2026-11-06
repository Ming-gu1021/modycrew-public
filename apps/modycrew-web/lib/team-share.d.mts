export const TEAM_SHARE_HEADING: string;
export const TEAM_SHARE_TITLE_MAX: number;
export const TEAM_SHARE_TEXT_MAX: number;
export const MAIL_SHARE_EXCERPT_CHARS: number;
export const RECORD_SHARE_EXCERPT_CHARS: number;
export const TEAM_SHARE_CUT_NOTE: string;

export type TeamSharePreview = {
  title: string;
  text: string;
  truncated: boolean;
  characters: number;
  redactionCount: number;
  redactionCategories: string[];
  announcement: string;
  ready: boolean;
};
export type TeamShareContent = { title: string; text: string; fullText?: string };
export type ShareLinkPart = { kind: "text"; value: string } | { kind: "link"; value: string; href: string };
export type ShareTarget = { companyId: string; teamId: string };
type StorageLike = Pick<Storage, "getItem" | "setItem"> | null | undefined;

export function tidyShareText(value: unknown): string;
export function teamShareAnnouncement(title: string): string;
export function describeShareRedactions(categories?: string[]): string;
export function buildTeamSharePreview(input?: { title?: string; text?: string }): TeamSharePreview;
export function buildMailShareContent(row?: { subject?: string; from?: string; receivedAt?: string; preview?: string }, options?: { excerptChars?: number }): TeamShareContent;
export function documentSpecShareText(spec?: {
  title?: string;
  company?: string;
  author?: string;
  period?: string;
  sections?: Array<{ heading?: string; paragraphs?: string[]; table?: { columns?: string[]; rows?: string[][] } }>;
}): string;
export function companyWorkShareContent(work?: { request?: string; result?: string; status?: string }, options?: { masterName?: string }): TeamShareContent;
export function companyRecordShareContent(record?: { name?: string; version?: number; format?: string; text?: string }, options?: { excerptChars?: number }): TeamShareContent;
export function driveLinkShareText(file?: { webViewLink?: string }, note?: string): string;
export function splitShareLinks(text: string): ShareLinkPart[];
export function readLastShareTarget(storage: StorageLike, uid: string): ShareTarget | null;
export function rememberShareTarget(storage: StorageLike, uid: string, target: ShareTarget): void;
export function chooseShareCompany(memberships?: Array<{ companyId: string; status: string }>, last?: ShareTarget | null): string;
export function shareableTeams<T extends { id: string; name: string; visibility: string; memberIds: string[] }>(teams?: T[], uid?: string): T[];
