/**
 * 앱 안 문서 보기·대화 변경 사항 패널의 순수 함수와 데스크톱 연결.
 * 민감정보 규칙과 줄 비교는 데스크톱 apps/modycrew-desktop/src/main/document-viewer.mjs 와 같다.
 * 둘 중 하나를 고치면 다른 쪽도 맞춘다(tests/web/document-viewer.test.mjs 가 같은 결과를 확인한다).
 * 이 파일은 값(import) 없이 타입만 가져온다 — node --test 가 그대로 읽을 수 있어야 한다.
 */
import type { SavedResult } from './deliverable-changes';

// ───────────────────────── 모델 타입(데스크톱 응답과 같은 모양) ─────────────────────────

export type SensitiveKind = 'email' | 'phone' | 'rrn' | 'card' | 'token';
export const SENSITIVE_KINDS: readonly SensitiveKind[] = ['email', 'phone', 'rrn', 'card', 'token'];
export const SENSITIVE_LABELS: Record<SensitiveKind, string> = { email: '이메일', phone: '전화번호', rrn: '주민등록번호', card: '카드번호', token: '토큰·비밀키' };
export type SensitiveSummary = { total: number; kinds: Record<SensitiveKind, number>; masked: boolean };

export type DocumentInline = { text: string; bold?: boolean; italic?: boolean; href?: string };
export type DocumentListItem = { text: string; depth: number; inlines?: DocumentInline[] };
export type DocumentBlock =
  | { type: 'heading'; level: number; text: string; inlines?: DocumentInline[] }
  | { type: 'paragraph'; text: string; inlines?: DocumentInline[] }
  | { type: 'list'; ordered: boolean; items: DocumentListItem[] }
  | { type: 'table'; rows: string[][] }
  | { type: 'image'; alt: string };
export type TextSyntax = 'markdown' | 'csv' | 'json' | 'code' | 'plain';
export type DocumentContent =
  | { kind: 'text'; syntax: TextSyntax; language?: string; delimiter?: string; text: string; encoding: string; lineCount: number; truncated: boolean; shownBytes?: number }
  | { kind: 'blocks'; blocks: DocumentBlock[]; truncated: boolean; notes: string[]; version?: string }
  | { kind: 'pdf'; pages: Array<{ number: number; text: string }>; pageCount: number; truncated: boolean; textLayer: boolean; viewer: { builtIn: boolean; available: boolean }; notes: string[] }
  | { kind: 'image'; mime: string; dataUrl: string; notes?: string[] }
  | { kind: 'unsupported'; reason: string };
export type DocumentFileInfo = { name: string; path: string; extension: string; format: string; formatLabel: string; bytes: number; modifiedAt: string };
export type DocumentSecurity = {
  readOnly: boolean; originalModified: boolean; externalTransfer: boolean; insideAllowedRoot: boolean; unchangedDuringRead: boolean;
  rootLabel: string; rootKind: string; relativePath: string; sha256: string; bytes: number; sensitive: SensitiveSummary;
  canOpenExternally: boolean; notes: string[]; isNewFile?: boolean; location?: string;
};
export type DocumentViewModel = { status: 'ready'; userMessage: string; file: DocumentFileInfo; content: DocumentContent; security: DocumentSecurity; externalMutation: false; originalModified: false; source?: 'desktop' | 'inline' };
export type DocumentViewerFailure = { status: string; userMessage: string; file?: DocumentFileInfo; security?: DocumentSecurity };
export type DocumentViewerResult = DocumentViewModel | DocumentViewerFailure;
export const isDocumentReady = (result: DocumentViewerResult | null | undefined): result is DocumentViewModel => Boolean(result && result.status === 'ready' && 'content' in result && result.content);

export type DiffLine = { type: 'context' | 'add' | 'remove'; text: string; oldNumber?: number; newNumber?: number };
export type DiffHunk = { oldStart: number; oldLines: number; newStart: number; newLines: number; lines: DiffLine[] };
export type LineDiff = { added: number; removed: number; unchanged: number; identical: boolean; approximate: boolean; truncated: boolean; beforeLines: number; afterLines: number; hunks: DiffHunk[] };
export type DocumentDiffSide = { text: string; label?: string } | { path: string } | null;
export type DocumentDiffResult = { status: string; userMessage: string; diff?: LineDiff; before?: { label: string; sha256?: string }; after?: { label: string; sha256?: string }; sensitive?: SensitiveSummary };
export type PdfPageResult = { status: string; userMessage: string; page?: number; pageCount?: number; dataUrl?: string; width?: number; height?: number; sensitiveMaskApplied?: boolean };
export type DocumentActionResult = { status: string; userMessage: string };
export type DocumentFileActions = { preview: boolean; openExternal: boolean; openWith: boolean; showInFolder: boolean; saveCopy: boolean };
export type DocumentFileInfoResult = DocumentActionResult & { file?: DocumentFileInfo; actions?: DocumentFileActions };
export type DocumentOpenApp = { index: number; name: string; icon: string };
export type DocumentAppsResult = DocumentActionResult & { apps?: DocumentOpenApp[] };

export type DocumentViewerPayload =
  | { kind: 'status' }
  | { kind: 'open'; path: string; workspaceRoot?: string; reveal?: boolean }
  | { kind: 'pick'; workspaceRoot?: string; reveal?: boolean }
  | { kind: 'pdf_page'; path: string; page: number; width?: number; workspaceRoot?: string }
  | { kind: 'diff'; before: DocumentDiffSide; after: DocumentDiffSide; reveal?: boolean; workspaceRoot?: string }
  | { kind: 'list_apps'; path: string; workspaceRoot?: string }
  | { kind: 'open_app'; path: string; workspaceRoot?: string; appIndex: number }
  | { kind: 'file_info' | 'save_copy' | 'open_with' | 'open_external' | 'show_in_folder' | 'open_pdf_viewer'; path: string; workspaceRoot?: string };

// ───────────────────────── 데스크톱 연결 ─────────────────────────

type DocumentViewerBridge = { documentViewer?: (payload: DocumentViewerPayload) => Promise<unknown> };
const desktopRequired = { status: 'desktop_required', userMessage: '문서를 앱 안에서 여는 기능은 최신 ModyCrew 데스크톱 앱에서 사용할 수 있습니다.' };

export function hasDocumentViewerBridge(): boolean {
  if (typeof window === 'undefined') return false;
  return typeof (window as unknown as { modyCrewDesktopBridge?: DocumentViewerBridge }).modyCrewDesktopBridge?.documentViewer === 'function';
}

async function request<T extends { status: string; userMessage: string }>(payload: DocumentViewerPayload): Promise<T> {
  const bridge = typeof window === 'undefined' ? undefined : (window as unknown as { modyCrewDesktopBridge?: DocumentViewerBridge }).modyCrewDesktopBridge;
  if (!bridge?.documentViewer) return desktopRequired as T;
  try {
    const result = await bridge.documentViewer(payload);
    if (!result || typeof result !== 'object' || typeof (result as { status?: unknown }).status !== 'string') return { status: 'failed', userMessage: '문서 보기 응답을 확인하지 못했습니다.' } as T;
    return result as T;
  } catch {
    return { status: 'failed', userMessage: '문서 보기 연결을 확인하지 못했습니다. 앱을 최신 버전으로 업데이트해 주세요.' } as T;
  }
}

export const openDocumentInApp = (path: string, options: { workspaceRoot?: string; reveal?: boolean } = {}) => request<DocumentViewerResult>({ kind: 'open', path, ...options });
export const pickDocumentInApp = (options: { workspaceRoot?: string; reveal?: boolean } = {}) => request<DocumentViewerResult>({ kind: 'pick', ...options });
export const renderPdfPageImage = (path: string, page: number, options: { width?: number; workspaceRoot?: string } = {}) => request<PdfPageResult>({ kind: 'pdf_page', path, page, ...options });
export const diffDocumentsInApp = (before: DocumentDiffSide, after: DocumentDiffSide, options: { reveal?: boolean; workspaceRoot?: string } = {}) => request<DocumentDiffResult>({ kind: 'diff', before, after, ...options });
export const documentAction = (kind: 'save_copy' | 'open_with' | 'open_external' | 'show_in_folder' | 'open_pdf_viewer', path: string, workspaceRoot?: string) => request<DocumentActionResult>({ kind, path, workspaceRoot });
export const describeDocumentFile = (path: string, workspaceRoot?: string) => request<DocumentFileInfoResult>({ kind: 'file_info', path, workspaceRoot });
export const listDocumentApps = (path: string, workspaceRoot?: string) => request<DocumentAppsResult>({ kind: 'list_apps', path, workspaceRoot });
export const openDocumentWithApp = (path: string, appIndex: number, workspaceRoot?: string) => request<DocumentActionResult>({ kind: 'open_app', path, appIndex, workspaceRoot });

// ───────────────────────── 민감정보 감지·가림 ─────────────────────────

type SensitiveRule = { kind: SensitiveKind; pattern: RegExp; group?: number; accept?: (value: string) => boolean; mask: (value: string) => string };
export type SensitiveMatch = { kind: SensitiveKind; start: number; end: number; rule: number };

function maskDigits(value: string, keepStart: number, keepEnd: number): string {
  const total = value.replace(/\D/gu, '').length;
  let index = -1;
  return value.replace(/\d/gu, (digit) => {
    index += 1;
    return index < keepStart || index >= total - keepEnd ? digit : '•';
  });
}
function maskPhone(value: string): string {
  const groups = value.match(/\d+/gu) || [];
  if (groups.length >= 3) {
    let seen = 0;
    return value.replace(/\d+/gu, (group) => (++seen === groups.length - 1 ? '•'.repeat(group.length) : group));
  }
  return maskDigits(value, value.startsWith('+') ? 4 : value.startsWith('02') ? 2 : 3, 4);
}
function maskEmail(value: string): string {
  const at = value.indexOf('@');
  const local = value.slice(0, at);
  return `${local.slice(0, 1)}${'•'.repeat(Math.max(3, Math.min(local.length - 1, 8)))}${value.slice(at)}`;
}
const maskToken = (value: string) => `${value.slice(0, 4)}${'•'.repeat(8)}`;
const maskPrivateKey = (value: string) => value.replace(/^(-----BEGIN[^\r\n]*-----)([\s\S]*?)(-----END[^\r\n]*-----)$/u, (_match, head: string, body: string, tail: string) => head + body.replace(/[^\r\n]+/gu, '••••••••') + tail);
function luhnValid(digits: string): boolean {
  if (digits.length < 13 || digits.length > 19 || /^(\d)\1+$/u.test(digits)) return false;
  let sum = 0;
  for (let index = 0; index < digits.length; index += 1) {
    let digit = digits.charCodeAt(digits.length - 1 - index) - 48;
    if (index % 2 === 1) { digit *= 2; if (digit > 9) digit -= 9; }
    sum += digit;
  }
  return sum % 10 === 0;
}
function looksLikeSecret(value: string): boolean {
  if (value.length < 8) return false;
  if (/^(?:string|number|boolean|undefined|null|true|false|required|optional|none|changeme|placeholder|example\w*|your[\w-]*|password\w*|\*+|•+|x{4,}|\.{3,})$/iu.test(value)) return false;
  if (/^(?:process\.env|import\.meta|os\.environ|\$\{|\{\{|<|%)/u.test(value)) return false;
  return (/\d/u.test(value) && /[A-Za-z]/u.test(value)) || value.length >= 20;
}

const SENSITIVE_RULES: SensitiveRule[] = [
  { kind: 'token', pattern: /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z0-9]+ )*PRIVATE KEY-----/gu, mask: maskPrivateKey },
  { kind: 'token', pattern: /(?<![A-Za-z0-9_-])(?:sk-(?:proj-|ant-|live-|test-)?[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|xox[abposr]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}|ya29\.[0-9A-Za-z_-]{20,}|glpat-[A-Za-z0-9_-]{20,}|eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})/gu, mask: maskToken },
  { kind: 'token', pattern: /(?:api[_-]?key|secret[_-]?key|client[_-]?secret|access[_-]?token|refresh[_-]?token|auth[_-]?token|private[_-]?key|password|passwd|pwd|비밀번호|암호|토큰)["']?[ \t]*[:=][ \t]*["']?([^\s"'`<>,;]{8,})/dgiu, group: 1, accept: looksLikeSecret, mask: () => '••••••••' },
  { kind: 'rrn', pattern: /(?<!\d)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])[- ]?[1-8]\d{6}(?!\d)/gu, mask: (value) => maskDigits(value, 6, 0) },
  { kind: 'card', pattern: /(?<!\d)(?:\d{4}[- ]?){3}\d{4}(?!\d)|(?<!\d)3[47]\d{2}[- ]?\d{6}[- ]?\d{5}(?!\d)/gu, accept: (value) => luhnValid(value.replace(/\D/gu, '')), mask: (value) => maskDigits(value, 0, 4) },
  { kind: 'email', pattern: /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}(?![A-Za-z0-9-])/gu, mask: maskEmail },
  { kind: 'phone', pattern: /(?<![\d+])(?:\+82[-. ]?(?:\(0\)|0)?(?:1[016789]|2|[3-6][1-5]|70)|0(?:1[016789]|2|[3-6][1-5]|70|50[2-8]))[-. )]?\d{3,4}[-. ]?\d{4}(?!\d)/gu, mask: maskPhone },
];

export function findSensitiveMatches(text: string): SensitiveMatch[] {
  const value = String(text ?? '');
  if (value.length < 6) return [];
  const found: SensitiveMatch[] = [];
  SENSITIVE_RULES.forEach((rule, index) => {
    for (const match of value.matchAll(rule.pattern)) {
      let start = match.index ?? 0;
      let end = start + match[0].length;
      if (rule.group) {
        const indices = (match as RegExpMatchArray & { indices?: Array<[number, number] | undefined> }).indices?.[rule.group];
        if (!indices) continue;
        [start, end] = indices;
      }
      if (rule.accept && !rule.accept(value.slice(start, end))) continue;
      found.push({ kind: rule.kind, start, end, rule: index });
      if (found.length > 20000) break;
    }
  });
  found.sort((left, right) => left.start - right.start || left.rule - right.rule || (right.end - right.start) - (left.end - left.start));
  const accepted: SensitiveMatch[] = [];
  let lastEnd = -1;
  for (const item of found) {
    if (item.start < lastEnd) continue;
    accepted.push(item);
    lastEnd = item.end;
  }
  return accepted;
}

export function applySensitiveMask(text: string, matches: SensitiveMatch[]): string {
  const value = String(text ?? '');
  let output = '';
  let cursor = 0;
  for (const match of matches) {
    output += value.slice(cursor, match.start) + SENSITIVE_RULES[match.rule].mask(value.slice(match.start, match.end));
    cursor = match.end;
  }
  return output + value.slice(cursor);
}

export const emptySensitiveCounts = (): Record<SensitiveKind, number> => ({ email: 0, phone: 0, rrn: 0, card: 0, token: 0 });

export function maskSensitiveText(text: string): { text: string; total: number; kinds: Record<SensitiveKind, number> } {
  const matches = findSensitiveMatches(text);
  const kinds = emptySensitiveCounts();
  for (const match of matches) kinds[match.kind] += 1;
  return { text: matches.length ? applySensitiveMask(text, matches) : String(text ?? ''), total: matches.length, kinds };
}

export function mergeSensitive(summaries: SensitiveSummary[], masked = true): SensitiveSummary {
  const kinds = emptySensitiveCounts();
  for (const summary of summaries) for (const kind of SENSITIVE_KINDS) kinds[kind] += summary.kinds?.[kind] ?? 0;
  return { total: SENSITIVE_KINDS.reduce((sum, kind) => sum + kinds[kind], 0), kinds, masked };
}

export function sensitiveSummaryText(summary: SensitiveSummary): string {
  return SENSITIVE_KINDS.filter((kind) => summary.kinds[kind]).map((kind) => `${SENSITIVE_LABELS[kind]} ${summary.kinds[kind]}건`).join(' · ');
}

// ───────────────────────── 줄 단위 비교 ─────────────────────────

export function splitLines(text: string): string[] {
  const value = String(text ?? '');
  if (!value) return [];
  const lines = value.replace(/\r\n?/gu, '\n').split('\n');
  if (lines.at(-1) === '') lines.pop();
  return lines;
}

function myersEdits(a: string[], b: string[], maxEdits: number): string[] | null {
  const n = a.length;
  const m = b.length;
  const max = n + m;
  if (!max) return [];
  const offset = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  let found = -1;
  for (let d = 0; d <= max; d += 1) {
    if (d > maxEdits) return null;
    trace.push(v.slice(offset - d - 1, offset + d + 2));
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1]) ? v[offset + k + 1] : v[offset + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) { x += 1; y += 1; }
      v[offset + k] = x;
      if (x >= n && y >= m) { found = d; break; }
    }
    if (found >= 0) break;
  }
  const edits: string[] = [];
  let x = n;
  let y = m;
  for (let d = found; d >= 0; d -= 1) {
    const window = trace[d];
    const at = (k: number) => window[k + d + 1];
    const k = x - y;
    const previousK = k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1;
    const previousX = at(previousK);
    const previousY = previousX - previousK;
    while (x > previousX && y > previousY) { edits.push('='); x -= 1; y -= 1; }
    if (d > 0) edits.push(x === previousX ? '+' : '-');
    x = previousX;
    y = previousY;
  }
  return edits.reverse();
}

/** 두 글을 줄 단위로 비교한다. 줄바꿈 방식(CRLF/LF) 차이와 마지막 줄바꿈 유무는 무시한다. */
export function computeLineDiff(beforeText: string, afterText: string, options: { context?: number; maxEdits?: number; maxLines?: number; maxOutputLines?: number } = {}): LineDiff {
  const context = options.context ?? 3;
  const maxEdits = options.maxEdits ?? 2000;
  const maxLines = options.maxLines ?? 60_000;
  const maxOutputLines = options.maxOutputLines ?? 4000;
  const a = splitLines(beforeText);
  const b = splitLines(afterText);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA -= 1; endB -= 1; }
  const middleA = a.slice(start, endA);
  const middleB = b.slice(start, endB);
  let edits = middleA.length > maxLines || middleB.length > maxLines ? null : myersEdits(middleA, middleB, maxEdits);
  const approximate = edits === null;
  if (!edits) edits = [...middleA.map(() => '-'), ...middleB.map(() => '+')];
  type Change = { aStart: number; aEnd: number; bStart: number; bEnd: number };
  const changes: Change[] = [];
  let ai = start;
  let bi = start;
  let current: Change | null = null;
  for (const edit of edits) {
    if (edit === '=') {
      if (current) { changes.push(current); current = null; }
      ai += 1; bi += 1;
      continue;
    }
    current ||= { aStart: ai, aEnd: ai, bStart: bi, bEnd: bi };
    if (edit === '-') { ai += 1; current.aEnd = ai; } else { bi += 1; current.bEnd = bi; }
  }
  if (current) changes.push(current);
  const groups: Array<Change & { changes: Change[] }> = [];
  for (const change of changes) {
    const last = groups.at(-1);
    if (last && change.aStart - last.aEnd <= context * 2) { last.aEnd = change.aEnd; last.bEnd = change.bEnd; last.changes.push(change); }
    else groups.push({ ...change, changes: [change] });
  }
  let emitted = 0;
  let truncated = false;
  const hunks: DiffHunk[] = [];
  for (const group of groups) {
    if (emitted >= maxOutputLines) { truncated = true; break; }
    const oldStart = Math.max(0, group.aStart - context);
    const newStart = group.bStart - (group.aStart - oldStart);
    const oldEnd = Math.min(a.length, group.aEnd + context);
    const newEnd = group.bEnd + (oldEnd - group.aEnd);
    const lines: DiffLine[] = [];
    let x = oldStart;
    let y = newStart;
    const push = (line: DiffLine) => { if (emitted < maxOutputLines) { lines.push(line); emitted += 1; } else truncated = true; };
    for (const change of group.changes) {
      while (x < change.aStart) { push({ type: 'context', text: a[x], oldNumber: x + 1, newNumber: y + 1 }); x += 1; y += 1; }
      for (; x < change.aEnd; x += 1) push({ type: 'remove', text: a[x], oldNumber: x + 1 });
      for (; y < change.bEnd; y += 1) push({ type: 'add', text: b[y], newNumber: y + 1 });
    }
    while (x < oldEnd) { push({ type: 'context', text: a[x], oldNumber: x + 1, newNumber: y + 1 }); x += 1; y += 1; }
    hunks.push({ oldStart: oldStart + 1, oldLines: oldEnd - oldStart, newStart: newStart + 1, newLines: newEnd - newStart, lines });
  }
  const added = changes.reduce((sum, change) => sum + change.bEnd - change.bStart, 0);
  const removed = changes.reduce((sum, change) => sum + change.aEnd - change.aStart, 0);
  return { added, removed, unchanged: b.length - added, identical: !added && !removed, approximate, truncated, beforeLines: a.length, afterLines: b.length, hunks };
}

/** 화면에 보이기 전에 diff 줄의 민감정보를 가린다. 원래 diff 는 바꾸지 않는다. */
export function maskDiff(diff: LineDiff): { diff: LineDiff; sensitive: SensitiveSummary } {
  const kinds = emptySensitiveCounts();
  const hunks = diff.hunks.map((hunk) => ({ ...hunk, lines: hunk.lines.map((line) => {
    const masked = maskSensitiveText(line.text);
    for (const kind of SENSITIVE_KINDS) kinds[kind] += masked.kinds[kind];
    return masked.total ? { ...line, text: masked.text } : line;
  }) }));
  return { diff: { ...diff, hunks }, sensitive: { total: SENSITIVE_KINDS.reduce((sum, kind) => sum + kinds[kind], 0), kinds, masked: true } };
}

// ───────────────────────── 마크다운(HTML 주입 없이 구조로만) ─────────────────────────

export type MdInline =
  | { type: 'text'; text: string }
  | { type: 'code'; text: string }
  | { type: 'strong' | 'em' | 'del'; children: MdInline[] }
  | { type: 'link'; href: string; children: MdInline[] }
  | { type: 'image'; alt: string; src: string }
  | { type: 'break' };
export type MdListItem = { checked: boolean | null; children: MdBlock[] };
export type MdAlign = 'left' | 'center' | 'right' | null;
export type MdBlock =
  | { type: 'heading'; level: number; children: MdInline[] }
  | { type: 'paragraph'; children: MdInline[] }
  | { type: 'code'; lang: string; text: string }
  | { type: 'quote'; children: MdBlock[] }
  | { type: 'list'; ordered: boolean; start: number; tight: boolean; items: MdListItem[] }
  | { type: 'table'; align: MdAlign[]; header: MdInline[][]; rows: MdInline[][][] }
  | { type: 'rule' }
  | { type: 'html'; text: string };

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0', middot: '·', hellip: '…', mdash: '—', ndash: '–', copy: '©', reg: '®', trade: '™' };
function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,8});/giu, (match, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff) ? String.fromCodePoint(code) : match;
    }
    return ENTITIES[body.toLowerCase()] ?? match;
  });
}

const ESCAPABLE = /[!-/:-@[-\u0060{-~]/u;

function parseLinkAt(text: string, start: number): { label: string; href: string; end: number } | null {
  let depth = 0;
  let index = start;
  for (; index < text.length; index += 1) {
    const char = text[index];
    if (char === '\\') { index += 1; continue; }
    if (char === '\u0060') { const close = text.indexOf('\u0060', index + 1); if (close > index) { index = close; continue; } }
    if (char === '[') depth += 1;
    else if (char === ']') { depth -= 1; if (depth === 0) break; }
  }
  if (index >= text.length || text[index + 1] !== '(') return null;
  const label = text.slice(start + 1, index);
  let cursor = index + 2;
  while (text[cursor] === ' ') cursor += 1;
  let href = '';
  if (text[cursor] === '<') {
    const close = text.indexOf('>', cursor);
    if (close < 0) return null;
    href = text.slice(cursor + 1, close);
    cursor = close + 1;
  } else {
    const begin = cursor;
    let parens = 0;
    for (; cursor < text.length; cursor += 1) {
      const char = text[cursor];
      if (char === '\\') { cursor += 1; continue; }
      if (char === '(') parens += 1;
      else if (char === ')') { if (!parens) break; parens -= 1; }
      else if (/\s/u.test(char)) break;
    }
    href = text.slice(begin, cursor);
  }
  while (text[cursor] === ' ') cursor += 1;
  if (text[cursor] === '"' || text[cursor] === "'" || (text[cursor] === '(' && href)) {
    const closeChar = text[cursor] === '(' ? ')' : text[cursor];
    const close = text.indexOf(closeChar, cursor + 1);
    if (close < 0) return null;
    cursor = close + 1;
    while (text[cursor] === ' ') cursor += 1;
  }
  if (text[cursor] !== ')') return null;
  return { label, href: href.replace(/\\([!-/:-@[-\u0060{-~])/gu, '$1'), end: cursor + 1 };
}

function parseEmphasisAt(text: string, start: number, depth: number): { node: MdInline; end: number } | null {
  const char = text[start];
  if (char === '~') {
    if (text[start + 1] !== '~' || !text[start + 2] || /\s/u.test(text[start + 2])) return null;
    const close = text.indexOf('~~', start + 2);
    if (close <= start + 2) return null;
    return { node: { type: 'del', children: parseMarkdownInline(text.slice(start + 2, close), depth + 1) }, end: close + 2 };
  }
  const size = text.startsWith(char.repeat(3), start) ? 3 : text.startsWith(char.repeat(2), start) ? 2 : 1;
  const run = char.repeat(size);
  const after = text[start + size];
  if (!after || /\s/u.test(after)) return null;
  if (char === '_' && start > 0 && /[\p{L}\p{N}]/u.test(text[start - 1])) return null;
  let search = start + size;
  while (search < text.length) {
    const close = text.indexOf(run, search);
    if (close < 0) return null;
    const before = text[close - 1];
    const next = text[close + size];
    const separate = size === 3 || (next !== char && before !== char);
    const wordSafe = char !== '_' || !next || !/[\p{L}\p{N}]/u.test(next);
    if (close > start + size && before && !/\s/u.test(before) && separate && wordSafe) {
      const inner = parseMarkdownInline(text.slice(start + size, close), depth + 1);
      const node: MdInline = size === 3 ? { type: 'strong', children: [{ type: 'em', children: inner }] } : { type: size === 2 ? 'strong' : 'em', children: inner };
      return { node, end: close + size };
    }
    search = close + 1;
  }
  return null;
}

/** 줄 안 서식. 결과는 텍스트 조각 구조뿐이고 HTML 은 만들지 않는다. 문단 안 줄바꿈은 줄바꿈으로 보인다. */
export function parseMarkdownInline(source: string, depth = 0): MdInline[] {
  const text = String(source ?? '');
  if (depth > 8) return text ? [{ type: 'text', text: decodeEntities(text) }] : [];
  const output: MdInline[] = [];
  let buffer = '';
  const flush = () => { if (buffer) { output.push({ type: 'text', text: decodeEntities(buffer) }); buffer = ''; } };
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    if (char === '\\' && index + 1 < text.length && ESCAPABLE.test(text[index + 1])) { buffer += text[index + 1]; index += 2; continue; }
    if (char === '\\' && text[index + 1] === '\n') { flush(); output.push({ type: 'break' }); index += 2; continue; }
    if (char === '\n') { buffer = buffer.replace(/[ \t]+$/u, ''); flush(); output.push({ type: 'break' }); index += 1; while (text[index] === ' ' || text[index] === '\t') index += 1; continue; }
    if (char === '\u0060') {
      const run = /^\u0060+/u.exec(text.slice(index))?.[0] ?? '\u0060';
      const close = text.indexOf(run, index + run.length);
      if (close > index) {
        flush();
        const code = text.slice(index + run.length, close).replace(/\n/gu, ' ');
        output.push({ type: 'code', text: /^ .* $/u.test(code) && code.trim() ? code.slice(1, -1) : code });
        index = close + run.length;
        continue;
      }
      buffer += run;
      index += run.length;
      continue;
    }
    if (char === '!' && text[index + 1] === '[') {
      const link = parseLinkAt(text, index + 1);
      if (link) { flush(); output.push({ type: 'image', alt: decodeEntities(link.label), src: link.href }); index = link.end; continue; }
    }
    if (char === '[') {
      const link = parseLinkAt(text, index);
      if (link) { flush(); output.push({ type: 'link', href: link.href, children: parseMarkdownInline(link.label, depth + 1) }); index = link.end; continue; }
    }
    if (char === '<') {
      const auto = /^<((?:https?|mailto):[^\s<>]+)>/iu.exec(text.slice(index));
      if (auto) { flush(); output.push({ type: 'link', href: auto[1], children: [{ type: 'text', text: auto[1].replace(/^mailto:/iu, '') }] }); index += auto[0].length; continue; }
    }
    if ((char === 'h' || char === 'H' || char === 'w' || char === 'W') && (index === 0 || /[\s(（"'“‘<]/u.test(text[index - 1]))) {
      const bare = /^(?:https?:\/\/|www\.)[^\s<>"'）]+/iu.exec(text.slice(index));
      if (bare) {
        const url = bare[0].replace(/[.,;:!?)\]}'"]+$/u, '');
        if (url.length > 4) {
          flush();
          output.push({ type: 'link', href: /^www\./iu.test(url) ? `https://${url}` : url, children: [{ type: 'text', text: url }] });
          index += url.length;
          continue;
        }
      }
    }
    if (char === '*' || char === '_' || char === '~') {
      const emphasis = parseEmphasisAt(text, index, depth);
      if (emphasis) { flush(); output.push(emphasis.node); index = emphasis.end; continue; }
    }
    buffer += char;
    index += 1;
  }
  flush();
  return output;
}

export function markdownInlineText(nodes: MdInline[]): string {
  return nodes.map((node) => node.type === 'text' || node.type === 'code' ? node.text : node.type === 'break' ? '\n' : node.type === 'image' ? node.alt : markdownInlineText(node.children)).join('');
}

const LIST_ITEM = /^( {0,3})([-*+]|(\d{1,3})([.)]))(?:[ \t]+(.*)|[ \t]*)$/u;
const BLOCK_START = /^ {0,3}(?:\u0060{3,}|~{3,}|#{1,6}(?:[ \t]|$)|>|([-*_])(?:[ \t]*\1){2,}[ \t]*$)/u;
const TABLE_DELIMITER = /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/u;

function splitTableRow(row: string): string[] {
  let value = row.trim();
  if (value.startsWith('|')) value = value.slice(1);
  if (value.endsWith('|') && !value.endsWith('\\|')) value = value.slice(0, -1);
  const cells: string[] = [];
  let cell = '';
  let inCode = false;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === '\\' && value[index + 1] === '|') { cell += '|'; index += 1; continue; }
    if (char === '\u0060') inCode = !inCode;
    if (char === '|' && !inCode) { cells.push(cell); cell = ''; continue; }
    cell += char;
  }
  cells.push(cell);
  return cells;
}

/** 블록 구조로 바꾼다. 원본 HTML 블록은 실행하지 않고 글자로만 보인다. */
export function parseMarkdown(source: string, depth = 0): MdBlock[] {
  const lines = String(source ?? '').replace(/\r\n?/gu, '\n').split('\n').map((line) => line.replace(/^\t+/u, (tabs) => '    '.repeat(tabs.length)));
  const blocks: MdBlock[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length) blocks.push({ type: 'paragraph', children: parseMarkdownInline(paragraph.join('\n').trim(), depth) });
    paragraph = [];
  };
  const nested = (text: string): MdBlock[] => (depth < 8 ? parseMarkdown(text, depth + 1) : [{ type: 'paragraph', children: [{ type: 'text', text }] }]);
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) { flush(); index += 1; continue; }
    const fence = /^ {0,3}(\u0060{3,}|~{3,})[ \t]*([^\s\u0060]*)[^\u0060]*$/u.exec(line);
    if (fence) {
      flush();
      const marker = fence[1];
      const closing = new RegExp(`^ {0,3}${marker[0] === '~' ? '~' : '\u0060'}{${marker.length},}[ \\t]*$`, 'u');
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !closing.test(lines[index])) { body.push(lines[index]); index += 1; }
      index += 1;
      blocks.push({ type: 'code', lang: fence[2] || '', text: body.join('\n') });
      continue;
    }
    const heading = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/u.exec(line);
    if (heading) { flush(); blocks.push({ type: 'heading', level: heading[1].length, children: parseMarkdownInline((heading[2] || '').trim(), depth) }); index += 1; continue; }
    if (paragraph.length && /^ {0,3}(?:=+|-+)[ \t]*$/u.test(line)) {
      blocks.push({ type: 'heading', level: line.trim()[0] === '=' ? 1 : 2, children: parseMarkdownInline(paragraph.join('\n').trim(), depth) });
      paragraph = [];
      index += 1;
      continue;
    }
    if (/^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/u.test(line)) { flush(); blocks.push({ type: 'rule' }); index += 1; continue; }
    if (/^ {0,3}>/u.test(line)) {
      flush();
      const body: string[] = [];
      while (index < lines.length && /^ {0,3}>/u.test(lines[index])) { body.push(lines[index].replace(/^ {0,3}> ?/u, '')); index += 1; }
      blocks.push({ type: 'quote', children: nested(body.join('\n')) });
      continue;
    }
    if (line.includes('|') && index + 1 < lines.length && lines[index + 1].includes('|') && TABLE_DELIMITER.test(lines[index + 1])) {
      const header = splitTableRow(line);
      const delimiter = splitTableRow(lines[index + 1]);
      if (header.length === delimiter.length) {
        flush();
        const align: MdAlign[] = delimiter.map((cell) => { const value = cell.trim(); const left = value.startsWith(':'); const right = value.endsWith(':'); return left && right ? 'center' : right ? 'right' : left ? 'left' : null; });
        index += 2;
        const rows: MdInline[][][] = [];
        while (index < lines.length && lines[index].trim() && lines[index].includes('|') && rows.length < 2000) {
          const cells = splitTableRow(lines[index]);
          rows.push(header.map((_cell, column) => parseMarkdownInline((cells[column] ?? '').trim(), depth)));
          index += 1;
        }
        blocks.push({ type: 'table', align, header: header.map((cell) => parseMarkdownInline(cell.trim(), depth)), rows });
        continue;
      }
    }
    const item = LIST_ITEM.exec(line);
    if (item && (!paragraph.length || !item[3] || item[3] === '1') && (item[5] ?? '').trim()) {
      flush();
      const ordered = Boolean(item[3]);
      const start = ordered ? Number(item[3]) : 1;
      const items: MdListItem[] = [];
      let tight = true;
      while (index < lines.length) {
        const match = LIST_ITEM.exec(lines[index]);
        if (!match || Boolean(match[3]) !== ordered) break;
        const markerEnd = match[1].length + match[2].length;
        const spaces = /^[ ]*/u.exec(lines[index].slice(markerEnd))?.[0].length ?? 0;
        const contentIndent = markerEnd + (spaces >= 1 && spaces <= 4 ? spaces : 1);
        const body = [lines[index].slice(contentIndent)];
        index += 1;
        let sawBlank = false;
        while (index < lines.length) {
          const next = lines[index];
          if (!next.trim()) { body.push(''); sawBlank = true; index += 1; continue; }
          const indent = /^ */u.exec(next)?.[0].length ?? 0;
          if (indent >= contentIndent) { body.push(next.slice(contentIndent)); if (sawBlank) tight = false; sawBlank = false; index += 1; continue; }
          if (sawBlank || LIST_ITEM.test(next) || BLOCK_START.test(next)) break;
          body.push(next.trim());
          index += 1;
        }
        while (body.length && !body[body.length - 1].trim()) body.pop();
        const following = index < lines.length ? LIST_ITEM.exec(lines[index]) : null;
        if (sawBlank && following && Boolean(following[3]) === ordered) tight = false;
        let checked: boolean | null = null;
        const task = /^\[([ xX])\][ \t]+/u.exec(body[0] ?? '');
        if (task) { checked = task[1] !== ' '; body[0] = body[0].slice(task[0].length); }
        items.push({ checked, children: nested(body.join('\n')) });
      }
      blocks.push({ type: 'list', ordered, start, tight, items });
      continue;
    }
    if (!paragraph.length && /^ {4}/u.test(line)) {
      const body: string[] = [];
      while (index < lines.length && (/^ {4}/u.test(lines[index]) || !lines[index].trim())) { body.push(lines[index].slice(4)); index += 1; }
      while (body.length && !body[body.length - 1].trim()) body.pop();
      blocks.push({ type: 'code', lang: '', text: body.join('\n') });
      continue;
    }
    if (!paragraph.length && /^ {0,3}<(?:!--|\/?[A-Za-z][A-Za-z0-9-]*(?:[\s/>]|$))/u.test(line)) {
      const body: string[] = [];
      while (index < lines.length && lines[index].trim()) { body.push(lines[index]); index += 1; }
      blocks.push({ type: 'html', text: body.join('\n') });
      continue;
    }
    paragraph.push(line);
    index += 1;
  }
  flush();
  return blocks;
}

// ───────────────────────── CSV·링크·표시 도우미 ─────────────────────────

export function parseDelimited(text: string, delimiter = ',', maxRows = 1000, maxColumns = 60): { rows: string[][]; truncated: boolean } {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let truncated = false;
  const value = String(text ?? '');
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (quoted) {
      if (char === '"') { if (value[index + 1] === '"') { field += '"'; index += 1; } else quoted = false; }
      else field += char;
      continue;
    }
    if (char === '"' && field === '') { quoted = true; continue; }
    if (char === delimiter) { row.push(field); field = ''; continue; }
    if (char === '\r' && value[index + 1] === '\n') continue;
    if (char === '\n' || char === '\r') {
      row.push(field); rows.push(row); row = []; field = '';
      if (rows.length >= maxRows) { truncated = index < value.length - 1; break; }
      continue;
    }
    field += char;
  }
  if (!truncated && (field || row.length)) { row.push(field); rows.push(row); }
  const limited = rows.map((cells) => { if (cells.length > maxColumns) truncated = true; return cells.slice(0, maxColumns); });
  return { rows: limited, truncated };
}

export type LinkKind = 'web' | 'mail' | 'anchor' | 'relative' | 'blocked';
export function classifyLink(href: string): LinkKind {
  const value = String(href ?? '').trim();
  if (!value) return 'blocked';
  if (value.startsWith('#')) return 'anchor';
  if (value.startsWith('//') || value.startsWith('\\\\')) return 'blocked';
  const scheme = /^([a-z][a-z0-9+.-]*):/iu.exec(value)?.[1]?.toLowerCase();
  if (scheme === 'http' || scheme === 'https') {
    try { const url = new URL(value); return url.username || url.password ? 'blocked' : 'web'; } catch { return 'blocked'; }
  }
  if (scheme === 'mailto') return 'mail';
  if (scheme) return 'blocked';
  return 'relative';
}

/** 문서 안 상대 링크(예: ./부록.md)를 같은 폴더 기준의 절대 경로로 바꾼다. 허용 여부는 데스크톱이 다시 확인한다. */
export function resolveRelativeDocumentPath(basePath: string, href: string): string | null {
  if (classifyLink(href) !== 'relative' || !basePath) return null;
  let target = href.split(/[?#]/u)[0];
  try { target = decodeURIComponent(target); } catch { return null; }
  if (!target || /^[a-z]:/iu.test(target) || target.startsWith('/') || target.startsWith('\\')) return null;
  const separator = basePath.includes('\\') ? '\\' : '/';
  const parts = basePath.split(/[\\/]/u);
  parts.pop();
  for (const part of target.split(/[\\/]/u)) {
    if (!part || part === '.') continue;
    if (part === '..') { if (parts.length <= 1) return null; parts.pop(); }
    else parts.push(part);
  }
  return parts.join(separator);
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
  return `${value >= 10 ? Math.round(value) : Math.round(value * 10) / 10} ${units[unit]}`;
}

export const joinDocumentPath = (directory: string, name: string) => (directory ? `${directory.replace(/[\\/]+$/u, '')}${directory.includes('\\') ? '\\' : '/'}${name}` : name);

const INLINE_CODE_LANGUAGES: Record<string, string> = { html: 'HTML', htm: 'HTML', css: 'CSS', js: 'JavaScript', mjs: 'JavaScript', cjs: 'JavaScript', jsx: 'JavaScript', ts: 'TypeScript', tsx: 'TypeScript', py: 'Python', sh: 'Shell', sql: 'SQL', yaml: 'YAML', yml: 'YAML', xml: 'XML' };

export function inlineFormatForName(name: string): { syntax: TextSyntax; extension: string; label: string; language?: string; delimiter?: string } {
  const extension = /\.([A-Za-z0-9]+)$/u.exec(name)?.[1]?.toLowerCase() ?? '';
  if (['md', 'markdown', 'mdx'].includes(extension)) return { syntax: 'markdown', extension, label: '마크다운' };
  if (extension === 'csv' || extension === 'tsv') return { syntax: 'csv', extension, label: extension === 'tsv' ? 'TSV 표' : 'CSV 표', delimiter: extension === 'tsv' ? '\t' : ',' };
  if (['json', 'jsonl', 'ndjson'].includes(extension)) return { syntax: 'json', extension, label: 'JSON' };
  if (INLINE_CODE_LANGUAGES[extension]) return { syntax: 'code', extension, label: `${INLINE_CODE_LANGUAGES[extension]} 코드`, language: INLINE_CODE_LANGUAGES[extension] };
  return { syntax: 'plain', extension, label: '텍스트' };
}

export type InlineDocumentInput = { name: string; content: string; sha256?: string; bytes?: number; location?: string; directory?: string; isNewFile?: boolean; pending?: boolean; reveal?: boolean };

/** 이미 화면에 있는 글(대화 결과 파일 등)을 데스크톱 응답과 같은 모양으로 만든다. 기본은 민감정보 가림. */
export function inlineDocumentModel(input: InlineDocumentInput): DocumentViewModel {
  const format = inlineFormatForName(input.name);
  const content = String(input.content ?? '');
  const masked = maskSensitiveText(content);
  const text = input.reveal ? content : masked.text;
  const bytes = Number.isFinite(input.bytes) ? Number(input.bytes) : new TextEncoder().encode(content).length;
  const isNewFile = input.isNewFile !== false;
  const pending = input.pending === true;
  const notes = pending ? ['아직 파일로 저장하지 않았습니다. 저장할 때도 새 파일로만 만들고 원본은 덮어쓰지 않습니다.'] : isNewFile ? ['새 파일로 저장해 프로젝트 원본을 덮어쓰지 않았습니다.'] : [];
  return {
    status: 'ready', source: 'inline', externalMutation: false, originalModified: false,
    userMessage: pending ? '아직 저장하지 않은 답변 속 파일입니다.' : isNewFile ? '새로 저장한 결과 파일입니다. 원본은 바뀌지 않았습니다.' : '읽기 전용으로 표시합니다.',
    file: { name: input.name, path: input.directory && !pending ? joinDocumentPath(input.directory, input.name) : input.name, extension: format.extension, format: format.syntax, formatLabel: format.label, bytes, modifiedAt: '' },
    content: { kind: 'text', syntax: format.syntax, language: format.language, delimiter: format.delimiter, text, encoding: 'UTF-8', lineCount: splitLines(text).length, truncated: false },
    security: {
      readOnly: true, originalModified: false, externalTransfer: false, insideAllowedRoot: true, unchangedDuringRead: true,
      rootLabel: pending ? '저장 전' : input.location || '앱 결과 폴더', rootKind: pending ? 'pending' : 'results', relativePath: input.name, sha256: pending ? '' : input.sha256 || '', bytes,
      sensitive: { total: masked.total, kinds: masked.kinds, masked: !input.reveal }, canOpenExternally: false,
      notes, isNewFile, location: pending ? undefined : input.directory,
    },
  };
}

// ───────────────────────── 대화 변경 사항·소스·보안 요약 ─────────────────────────

export type ConversationAttachment = { id?: string; name?: string; fileName?: string; absolutePath?: string; path?: string; sizeBytes?: number; mimeType?: string };
export type ConversationTool = { id: string; label: string; detail?: string; kind?: 'tool' | 'connector' | 'web' | 'memory' | 'skill' };
export type ConversationOutboundStatus = 'drafted' | 'pending_approval' | 'approved' | 'sent' | 'rejected' | 'failed';
export type ConversationOutbound = { id: string; label: string; channel: string; status: ConversationOutboundStatus; target?: string; at?: string };
export type ConversationModifiedFile = { id?: string; name: string; path?: string; before?: string | null; after: string; location?: string };
export type ConversationChangesInput = {
  threadId: string;
  projectName?: string;
  results?: SavedResult[];
  /** 대화 중 기존 파일을 고친 기록. 넘기지 않으면 '연결되지 않음'으로 정직하게 표시한다. */
  modifiedFiles?: ConversationModifiedFile[];
  attachments?: ConversationAttachment[];
  tools?: ConversationTool[];
  /** 메일·메시지 발송, 일정 등록, 외부 업로드 기록. 넘기지 않으면 '확인 안 됨'으로 표시한다. */
  outbound?: ConversationOutbound[];
  aiDestination?: string;
};
export type ConversationChangeFile = {
  id: string; name: string; status: 'added' | 'modified';
  added: number | null; removed: number | null; beforeMissing: boolean;
  bytes?: number; sha256?: string; location?: string; directory?: string; path?: string;
  content?: string; before?: string; sensitive: SensitiveSummary;
};
export type ConversationSource = { id: string; name: string; kind: 'file' | 'tool' | 'connector' | 'web' | 'memory' | 'skill'; detail?: string; path?: string; bytes?: number; viewable: boolean };
export type ConversationSecurityItem = { id: 'original' | 'location' | 'outbound' | 'ai' | 'sensitive'; tone: 'safe' | 'notice' | 'warning'; title: string; detail: string };
export type ConversationOutboundSummary = Record<ConversationOutboundStatus, number> & { total: number; known: boolean };
export type ConversationChangesModel = {
  threadId: string; projectName: string;
  totals: { files: number; added: number; removed: number; unknownFiles: number };
  files: ConversationChangeFile[]; sources: ConversationSource[];
  security: { originalFilesModified: number; newFiles: number; locations: Array<{ label: string; directory: string }>; outbound: ConversationOutboundSummary; sensitive: SensitiveSummary; items: ConversationSecurityItem[] };
};

const OUTBOUND_LABELS: Record<ConversationOutboundStatus, string> = { drafted: '초안만 작성', pending_approval: '승인 대기', approved: '승인됨', sent: '보냄', rejected: '거절됨', failed: '보내기 실패' };
export const outboundStatusLabel = (status: ConversationOutboundStatus) => OUTBOUND_LABELS[status] ?? status;

const sensitiveOf = (text: string): SensitiveSummary => { const masked = maskSensitiveText(text); return { total: masked.total, kinds: masked.kinds, masked: true }; };

export function collectConversationChanges(input: ConversationChangesInput): ConversationChangesModel {
  const files: ConversationChangeFile[] = [];
  const seen = new Set<string>();
  const locations = new Map<string, string>();
  for (const result of input.results ?? []) {
    if (result?.receipt?.status !== 'saved' || !Array.isArray(result.files)) continue;
    const directory = result.receipt.directory ?? '';
    for (const file of result.files) {
      const proof = result.receipt.files?.find((item) => item.name === file.name);
      if (!proof) continue;
      const id = JSON.stringify([result.scope?.workspaceRoot, result.scope?.threadId, result.scope?.messageId, file.name]);
      if (seen.has(id)) continue;
      seen.add(id);
      if (directory) locations.set(directory, result.receipt.location || '앱 결과 폴더');
      files.push({
        id, name: file.name, status: 'added', added: splitLines(file.content).length, removed: 0, beforeMissing: false,
        bytes: proof.bytes, sha256: proof.sha256, location: result.receipt.location, directory, path: directory ? joinDocumentPath(directory, file.name) : undefined,
        content: file.content, sensitive: sensitiveOf(file.content),
      });
    }
  }
  for (const [index, file] of (input.modifiedFiles ?? []).entries()) {
    const id = file.id || `modified:${file.path || file.name}:${index}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const hasBefore = typeof file.before === 'string';
    const diff = hasBefore ? computeLineDiff(file.before as string, file.after) : null;
    files.push({
      id, name: file.name, status: 'modified', added: diff ? diff.added : null, removed: diff ? diff.removed : null, beforeMissing: !hasBefore,
      location: file.location, path: file.path, content: file.after, before: hasBefore ? (file.before as string) : undefined, sensitive: sensitiveOf(file.after),
    });
  }
  const sources: ConversationSource[] = [];
  const sourceKeys = new Set<string>();
  for (const [index, attachment] of (input.attachments ?? []).entries()) {
    const filePath = attachment.absolutePath || attachment.path || '';
    const name = attachment.fileName || attachment.name || (filePath ? filePath.split(/[\\/]/u).pop() || '' : '') || '첨부 파일';
    const key = (filePath || name).toLowerCase();
    if (sourceKeys.has(key)) continue;
    sourceKeys.add(key);
    sources.push({ id: attachment.id || `attachment:${index}`, name, kind: 'file', path: filePath || undefined, bytes: attachment.sizeBytes, detail: attachment.mimeType || undefined, viewable: Boolean(filePath) });
  }
  for (const tool of input.tools ?? []) {
    const key = `tool:${tool.id}`;
    if (sourceKeys.has(key)) continue;
    sourceKeys.add(key);
    sources.push({ id: tool.id, name: tool.label, kind: tool.kind ?? 'tool', detail: tool.detail, viewable: false });
  }
  const outbound = { drafted: 0, pending_approval: 0, approved: 0, sent: 0, rejected: 0, failed: 0, total: 0, known: Array.isArray(input.outbound) } as ConversationOutboundSummary;
  for (const item of input.outbound ?? []) { if (item.status in outbound) { outbound[item.status] += 1; outbound.total += 1; } }
  const sensitive = mergeSensitive(files.map((file) => file.sensitive));
  const added = files.reduce((sum, file) => sum + (file.added ?? 0), 0);
  const removed = files.reduce((sum, file) => sum + (file.removed ?? 0), 0);
  const unknownFiles = files.filter((file) => file.added === null).length;
  const modified = files.filter((file) => file.status === 'modified');
  const newFiles = files.length - modified.length;
  const items: ConversationSecurityItem[] = [];
  if (!input.modifiedFiles) {
    items.push({ id: 'original', tone: 'safe', title: '원본 덮어쓰기 없음', detail: newFiles ? `모디크루는 결과 ${newFiles}개를 새 파일로만 저장했습니다. Codex·Claude 같은 외부 실행기가 직접 고친 파일은 이 목록에 아직 연결되지 않았습니다.` : '모디크루가 이 대화에서 저장한 파일이 없습니다. 외부 실행기가 직접 고친 파일은 이 목록에 아직 연결되지 않았습니다.' });
  } else if (!modified.length) {
    items.push({ id: 'original', tone: 'safe', title: '원본 파일 수정 없음', detail: newFiles ? `결과 ${newFiles}개를 새 파일로만 저장했습니다.` : '이 대화에서 바꾼 파일이 없습니다.' });
  } else {
    const missing = modified.filter((file) => file.beforeMissing).length;
    items.push({ id: 'original', tone: 'notice', title: `원본 파일 ${modified.length}개 수정`, detail: missing ? `${modified.length - missing}개는 바뀐 줄을 비교할 수 있습니다. ${missing}개는 이전본 기록이 없어 무엇이 바뀌었는지 비교할 수 없습니다.` : '모든 수정 파일의 이전본이 있어 바뀐 줄을 비교할 수 있습니다.' });
  }
  const locationList = [...locations].map(([directory, label]) => ({ label, directory }));
  items.push(locationList.length
    ? { id: 'location', tone: 'safe', title: '저장 위치', detail: locationList.map((item) => `${item.label} · ${item.directory}`).join('\n') }
    : { id: 'location', tone: 'notice', title: '저장한 결과 파일 없음', detail: '이 대화에서 모디크루가 파일로 저장한 결과가 없습니다.' });
  if (!outbound.known) items.push({ id: 'outbound', tone: 'notice', title: '외부 발송 기록 미연결', detail: '이 화면에는 메일·메시지 발송 기록이 연결되지 않았습니다. 발송은 승인함에서 확인해 주세요.' });
  else if (!outbound.total) items.push({ id: 'outbound', tone: 'safe', title: '외부 전송·발송 없음', detail: '이 대화에서 메일·메시지 발송, 일정 등록, 외부 업로드를 하지 않았습니다.' });
  else {
    const parts = (Object.keys(OUTBOUND_LABELS) as ConversationOutboundStatus[]).filter((status) => outbound[status]).map((status) => `${OUTBOUND_LABELS[status]} ${outbound[status]}건`);
    items.push({ id: 'outbound', tone: outbound.pending_approval ? 'warning' : 'notice', title: `외부 전송 ${outbound.total}건`, detail: `${parts.join(' · ')}. 중요한 발송은 사용자가 승인한 뒤에만 실행합니다.` });
  }
  items.push({ id: 'ai', tone: 'notice', title: 'AI로 보내는 내용', detail: `대화에 쓴 글과 첨부한 자료는 답변을 만들기 위해 ${input.aiDestination || '연결된 AI'}로 보냅니다. 문서 보기에서 연 파일은 AI로 보내지 않습니다.` });
  items.push(sensitive.total
    ? { id: 'sensitive', tone: 'notice', title: `민감정보 ${sensitive.total}건 · 화면에서 가림`, detail: `${sensitiveSummaryText(sensitive)}. 파일 내용은 그대로이고, 화면에 보일 때만 가립니다.` }
    : { id: 'sensitive', tone: 'safe', title: '감지된 민감정보 없음', detail: '결과 파일에서 이메일·전화번호·주민번호·카드번호·토큰을 찾지 못했습니다.' });
  return {
    threadId: input.threadId, projectName: input.projectName || '',
    totals: { files: files.length, added, removed, unknownFiles },
    files, sources,
    security: { originalFilesModified: modified.length, newFiles, locations: locationList, outbound, sensitive, items },
  };
}

