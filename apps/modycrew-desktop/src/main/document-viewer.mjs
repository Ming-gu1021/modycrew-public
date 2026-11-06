// 앱 안 문서 보기(읽기 전용).
// - 허용된 폴더(프로젝트·작업 기억·앱 결과·만든 문서)와 사용자가 직접 고른 파일만 연다.
// - 바로가기(심볼릭 링크·정션)를 거치는 경로와 허용 폴더 밖 경로는 거부한다.
// - 원본 파일에는 절대 쓰지 않는다. 화면에 보내기 전에 민감정보를 감지해 기본으로 가린다.
// - HWP 5.0(바이너리)은 외부 프로그램 없이 CFB(OLE) 컨테이너 → BodyText 섹션(raw deflate)
//   → HWPTAG_PARA_TEXT 순서로 직접 읽는다.
import { createHash, randomBytes } from 'node:crypto';
import { lstat, open, realpath } from 'node:fs/promises';
import path from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { DOMParser } from '@xmldom/xmldom';
import { chooseDocumentApp } from './document-file-actions.mjs';
import { documentAppRegistry } from './document-open-apps.mjs';

const MB = 1024 * 1024;

export const DOCUMENT_VIEWER_LIMITS = Object.freeze({
  maxFileBytes: 64 * MB,
  maxPdfViewerBytes: 128 * MB,
  maxTextBytes: 4 * MB,
  maxImageBytes: 8 * MB,
  maxSpreadsheetBytes: 24 * MB,
  maxZipEntries: 5000,
  maxZipEntryBytes: 64 * MB,
  maxZipTotalBytes: 256 * MB,
  maxZipRatio: 1500,
  maxHwpStreamBytes: 64 * MB,
  maxHwpTotalBytes: 160 * MB,
  maxBlocks: 8000,
  maxTotalChars: 2_000_000,
  maxBlockChars: 20_000,
  maxTableRows: 500,
  maxTableCols: 60,
  maxSheets: 20,
  maxPdfPages: 500,
  maxPdfPageChars: 50_000,
  maxDiffChars: 4_000_000,
  maxDiffLines: 60_000,
  maxDiffEdits: 2000,
  maxDiffOutputLines: 4000,
  parseTimeoutMs: 45_000,
});

class ViewerError extends Error {
  constructor(status, userMessage) {
    super(userMessage);
    this.name = 'ViewerError';
    this.status = status;
    this.userMessage = userMessage;
  }
}

const baseResult = { externalMutation: false, originalModified: false };
const failure = (status, userMessage, extra = {}) => ({ status, userMessage, ...baseResult, ...extra });

// ───────────────────────── 형식 구분 ─────────────────────────

const MARKDOWN_EXTENSIONS = new Set(['md', 'markdown', 'mdown', 'mkd', 'mdx']);
const TEXT_EXTENSIONS = new Set(['txt', 'text', 'log', 'ini', 'cfg', 'conf', 'env', 'properties', 'rst', 'adoc', 'srt', 'vtt', 'tex', 'gitignore', 'gitattributes', 'editorconfig', 'npmrc', 'nvmrc']);
const TEXT_FILE_NAMES = new Set(['license', 'licence', 'readme', 'changelog', 'authors', 'notice', 'copying', 'codeowners']);
const CSV_EXTENSIONS = new Set(['csv', 'tsv']);
const JSON_EXTENSIONS = new Set(['json', 'jsonl', 'ndjson', 'geojson', 'jsonc', 'json5', 'ipynb', 'webmanifest']);
const CODE_LANGUAGES = Object.freeze({
  js: 'JavaScript', mjs: 'JavaScript', cjs: 'JavaScript', jsx: 'JavaScript', ts: 'TypeScript', tsx: 'TypeScript', mts: 'TypeScript', cts: 'TypeScript',
  py: 'Python', rb: 'Ruby', php: 'PHP', java: 'Java', kt: 'Kotlin', kts: 'Kotlin', swift: 'Swift', go: 'Go', rs: 'Rust', c: 'C', h: 'C', cpp: 'C++', cc: 'C++', cxx: 'C++', hpp: 'C++', cs: 'C#',
  sql: 'SQL', sh: 'Shell', bash: 'Shell', zsh: 'Shell', ps1: 'PowerShell', psm1: 'PowerShell', bat: '배치 파일', cmd: '배치 파일',
  yaml: 'YAML', yml: 'YAML', toml: 'TOML', xml: 'XML', html: 'HTML', htm: 'HTML', css: 'CSS', scss: 'SCSS', less: 'Less', vue: 'Vue', svelte: 'Svelte',
  gradle: 'Gradle', r: 'R', lua: 'Lua', dart: 'Dart', scala: 'Scala', pl: 'Perl', graphql: 'GraphQL', gql: 'GraphQL', proto: 'Protocol Buffers', tf: 'Terraform',
});
const IMAGE_TYPES = Object.freeze({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml', ico: 'image/x-icon' });
const FORMAT_LABELS = Object.freeze({
  markdown: '마크다운', text: '텍스트', csv: 'CSV 표', json: 'JSON', code: '코드', docx: 'Word 문서', hwpx: '한글 문서 (HWPX)', hwp: '한글 문서 (HWP)',
  pptx: 'PowerPoint 발표 자료', xlsx: 'Excel 통합 문서', pdf: 'PDF 문서', image: '이미지', other: '앱에서 미리 볼 수 없는 형식',
});
// 기본 프로그램으로 여는 것은 문서·이미지 형식만 허용한다. 실행 파일·스크립트·HTML은 열면 실행될 수 있다.
const EXTERNAL_OPEN_EXTENSIONS = new Set(['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'hwp', 'hwpx', 'odt', 'ods', 'odp', 'rtf', 'txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'log', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp']);

export const DOCUMENT_VIEWER_EXTENSIONS = Object.freeze([...new Set([
  ...MARKDOWN_EXTENSIONS, ...TEXT_EXTENSIONS, ...CSV_EXTENSIONS, ...JSON_EXTENSIONS, ...Object.keys(CODE_LANGUAGES),
  'docx', 'docm', 'hwpx', 'hwp', 'pptx', 'xlsx', 'xlsm', 'pdf', ...Object.keys(IMAGE_TYPES),
])]);

export function classifyDocumentPath(filePath) {
  const name = path.basename(String(filePath ?? ''));
  const lower = name.toLowerCase();
  const extension = path.extname(lower).slice(1);
  const make = (kind, extra = {}) => ({ kind, extension, name, label: FORMAT_LABELS[kind], ...extra });
  if (/^\.env(?:\.[\w.-]+)?$/u.test(lower) || TEXT_FILE_NAMES.has(lower) || (lower.startsWith('.') && !extension && TEXT_EXTENSIONS.has(lower.slice(1)))) return make('text');
  if (lower === 'dockerfile' || lower === 'makefile') {
    const language = lower === 'dockerfile' ? 'Dockerfile' : 'Makefile';
    return make('code', { language, label: language });
  }
  if (MARKDOWN_EXTENSIONS.has(extension)) return make('markdown');
  if (TEXT_EXTENSIONS.has(extension)) return make('text');
  if (CSV_EXTENSIONS.has(extension)) return make('csv', { label: extension === 'tsv' ? 'TSV 표' : 'CSV 표', delimiter: extension === 'tsv' ? '\t' : ',' });
  if (JSON_EXTENSIONS.has(extension)) return make('json');
  if (CODE_LANGUAGES[extension]) return make('code', { language: CODE_LANGUAGES[extension], label: `${CODE_LANGUAGES[extension]} 코드` });
  if (extension === 'docx' || extension === 'docm') return make('docx');
  if (extension === 'hwpx') return make('hwpx');
  if (extension === 'hwp') return make('hwp');
  if (extension === 'pptx') return make('pptx');
  if (extension === 'xlsx' || extension === 'xlsm') return make('xlsx');
  if (extension === 'pdf') return make('pdf');
  if (IMAGE_TYPES[extension]) return make('image', { mime: IMAGE_TYPES[extension], label: `이미지 (${extension.toUpperCase()})` });
  return make('other');
}

// ───────────────────────── 민감정보 감지·가림 ─────────────────────────
// 웹 쪽 lib/document-viewer.ts 와 같은 규칙이다. 둘 중 하나를 고치면 다른 쪽도 맞춘다.

export const SENSITIVE_KINDS = Object.freeze(['email', 'phone', 'rrn', 'card', 'token']);

function maskDigits(value, keepStart, keepEnd) {
  const total = value.replace(/\D/gu, '').length;
  let index = -1;
  return value.replace(/\d/gu, (digit) => {
    index += 1;
    return index < keepStart || index >= total - keepEnd ? digit : '•';
  });
}
function maskPhone(value) {
  const groups = value.match(/\d+/gu) || [];
  if (groups.length >= 3) {
    let seen = 0;
    return value.replace(/\d+/gu, (group) => (++seen === groups.length - 1 ? '•'.repeat(group.length) : group));
  }
  return maskDigits(value, value.startsWith('+') ? 4 : value.startsWith('02') ? 2 : 3, 4);
}
function maskEmail(value) {
  const at = value.indexOf('@');
  const local = value.slice(0, at);
  return `${local.slice(0, 1)}${'•'.repeat(Math.max(3, Math.min(local.length - 1, 8)))}${value.slice(at)}`;
}
const maskToken = (value) => `${value.slice(0, 4)}${'•'.repeat(8)}`;
const maskPrivateKey = (value) => value.replace(/^(-----BEGIN[^\r\n]*-----)([\s\S]*?)(-----END[^\r\n]*-----)$/u, (_match, head, body, tail) => head + body.replace(/[^\r\n]+/gu, '••••••••') + tail);
function luhnValid(digits) {
  if (digits.length < 13 || digits.length > 19 || /^(\d)\1+$/u.test(digits)) return false;
  let sum = 0;
  for (let index = 0; index < digits.length; index += 1) {
    let digit = digits.charCodeAt(digits.length - 1 - index) - 48;
    if (index % 2 === 1) { digit *= 2; if (digit > 9) digit -= 9; }
    sum += digit;
  }
  return sum % 10 === 0;
}
function looksLikeSecret(value) {
  if (value.length < 8) return false;
  if (/^(?:string|number|boolean|undefined|null|true|false|required|optional|none|changeme|placeholder|example\w*|your[\w-]*|password\w*|\*+|•+|x{4,}|\.{3,})$/iu.test(value)) return false;
  if (/^(?:process\.env|import\.meta|os\.environ|\$\{|\{\{|<|%)/u.test(value)) return false;
  return (/\d/u.test(value) && /[A-Za-z]/u.test(value)) || value.length >= 20;
}

const SENSITIVE_RULES = [
  { kind: 'token', pattern: /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z0-9]+ )*PRIVATE KEY-----/gu, mask: maskPrivateKey },
  { kind: 'token', pattern: /(?<![A-Za-z0-9_-])(?:sk-(?:proj-|ant-|live-|test-)?[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|xox[abposr]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}|ya29\.[0-9A-Za-z_-]{20,}|glpat-[A-Za-z0-9_-]{20,}|eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})/gu, mask: maskToken },
  { kind: 'token', pattern: /(?:api[_-]?key|secret[_-]?key|client[_-]?secret|access[_-]?token|refresh[_-]?token|auth[_-]?token|private[_-]?key|password|passwd|pwd|비밀번호|암호|토큰)["']?[ \t]*[:=][ \t]*["']?([^\s"'`<>,;]{8,})/dgiu, group: 1, accept: looksLikeSecret, mask: () => '••••••••' },
  { kind: 'rrn', pattern: /(?<!\d)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])[- ]?[1-8]\d{6}(?!\d)/gu, mask: (value) => maskDigits(value, 6, 0) },
  { kind: 'card', pattern: /(?<!\d)(?:\d{4}[- ]?){3}\d{4}(?!\d)|(?<!\d)3[47]\d{2}[- ]?\d{6}[- ]?\d{5}(?!\d)/gu, accept: (value) => luhnValid(value.replace(/\D/gu, '')), mask: (value) => maskDigits(value, 0, 4) },
  { kind: 'email', pattern: /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}(?![A-Za-z0-9-])/gu, mask: maskEmail },
  { kind: 'phone', pattern: /(?<![\d+])(?:\+82[-. ]?(?:\(0\)|0)?(?:1[016789]|2|[3-6][1-5]|70)|0(?:1[016789]|2|[3-6][1-5]|70|50[2-8]))[-. )]?\d{3,4}[-. ]?\d{4}(?!\d)/gu, mask: maskPhone },
];

/** 겹치지 않는 민감정보 위치 목록. 앞선 규칙이 우선이다. */
export function findSensitiveMatches(text) {
  const value = String(text ?? '');
  if (value.length < 6) return [];
  const found = [];
  SENSITIVE_RULES.forEach((rule, priority) => {
    for (const match of value.matchAll(rule.pattern)) {
      let start = match.index;
      let end = start + match[0].length;
      if (rule.group) {
        const indices = match.indices?.[rule.group];
        if (!indices) continue;
        [start, end] = indices;
      }
      const raw = value.slice(start, end);
      if (rule.accept && !rule.accept(raw)) continue;
      found.push({ kind: rule.kind, start, end, priority });
      if (found.length > 20000) break;
    }
  });
  found.sort((left, right) => left.start - right.start || left.priority - right.priority || (right.end - right.start) - (left.end - left.start));
  const accepted = [];
  let lastEnd = -1;
  for (const item of found) {
    if (item.start < lastEnd) continue;
    accepted.push(item);
    lastEnd = item.end;
  }
  return accepted;
}

export function applySensitiveMask(text, matches) {
  const value = String(text ?? '');
  let output = '';
  let cursor = 0;
  for (const match of matches) {
    output += value.slice(cursor, match.start) + SENSITIVE_RULES[match.priority].mask(value.slice(match.start, match.end));
    cursor = match.end;
  }
  return output + value.slice(cursor);
}

export function maskSensitiveText(text) {
  const matches = findSensitiveMatches(text);
  const kinds = Object.fromEntries(SENSITIVE_KINDS.map((kind) => [kind, 0]));
  for (const match of matches) kinds[match.kind] += 1;
  return { text: matches.length ? applySensitiveMask(text, matches) : String(text ?? ''), total: matches.length, kinds };
}

function createSensitiveShield(mask) {
  const kinds = Object.fromEntries(SENSITIVE_KINDS.map((kind) => [kind, 0]));
  const count = (matches) => { for (const match of matches) kinds[match.kind] += 1; };
  return {
    mask,
    protect(text) {
      const value = String(text ?? '');
      const matches = findSensitiveMatches(value);
      count(matches);
      return mask && matches.length ? applySensitiveMask(value, matches) : value;
    },
    /** 서식 조각(굵게·링크)을 유지하며 가린다. 조각 경계를 걸친 항목이 있으면 한 조각으로 합쳐 가린다. */
    protectRuns(runs) {
      const full = runs.map((run) => run.text).join('');
      const matches = findSensitiveMatches(full);
      count(matches);
      if (!mask) return runs;
      const hrefSafe = (run) => {
        if (!run.href || !findSensitiveMatches(run.href).length) return run;
        const { href: _href, ...rest } = run;
        return rest;
      };
      if (!matches.length) return runs.map(hrefSafe);
      let offset = 0;
      const bounds = runs.map((run) => { const bound = [offset, offset + run.text.length]; offset += run.text.length; return bound; });
      if (!matches.every((match) => bounds.some(([start, end]) => match.start >= start && match.end <= end))) return [{ text: applySensitiveMask(full, matches) }];
      return runs.map((run, index) => {
        const [start, end] = bounds[index];
        const local = matches.filter((match) => match.start >= start && match.end <= end).map((match) => ({ ...match, start: match.start - start, end: match.end - start }));
        return local.length ? hrefSafe({ ...run, text: applySensitiveMask(run.text, local) }) : hrefSafe(run);
      });
    },
    summary() {
      const total = Object.values(kinds).reduce((sum, value) => sum + value, 0);
      return { total, kinds: { ...kinds }, masked: mask };
    },
  };
}

// ───────────────────────── 줄 단위 비교(diff) ─────────────────────────

export function splitLines(text) {
  const value = String(text ?? '');
  if (!value) return [];
  const lines = value.replace(/\r\n?/gu, '\n').split('\n');
  if (lines.at(-1) === '') lines.pop();
  return lines;
}

function myersEdits(a, b, maxEdits) {
  const n = a.length;
  const m = b.length;
  const max = n + m;
  if (!max) return [];
  const offset = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace = [];
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
  const edits = [];
  let x = n;
  let y = m;
  for (let d = found; d >= 0; d -= 1) {
    const window = trace[d];
    const at = (k) => window[k + d + 1];
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

/** 두 글을 줄 단위로 비교해 추가·삭제 줄 수와 묶음(hunk)을 만든다. 줄바꿈 방식(CRLF/LF) 차이는 무시한다. */
export function computeLineDiff(beforeText, afterText, options = {}) {
  const context = Number.isInteger(options.context) ? options.context : 3;
  const maxEdits = options.maxEdits ?? DOCUMENT_VIEWER_LIMITS.maxDiffEdits;
  const maxLines = options.maxLines ?? DOCUMENT_VIEWER_LIMITS.maxDiffLines;
  const maxOutputLines = options.maxOutputLines ?? DOCUMENT_VIEWER_LIMITS.maxDiffOutputLines;
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
  if (approximate) edits = [...middleA.map(() => '-'), ...middleB.map(() => '+')];
  const changes = [];
  let ai = start;
  let bi = start;
  let current = null;
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
  const groups = [];
  for (const change of changes) {
    const last = groups.at(-1);
    if (last && change.aStart - last.aEnd <= context * 2) { last.aEnd = change.aEnd; last.bEnd = change.bEnd; last.changes.push(change); }
    else groups.push({ aStart: change.aStart, aEnd: change.aEnd, bStart: change.bStart, bEnd: change.bEnd, changes: [change] });
  }
  let emitted = 0;
  let truncated = false;
  const hunks = [];
  for (const group of groups) {
    if (emitted >= maxOutputLines) { truncated = true; break; }
    const oldStart = Math.max(0, group.aStart - context);
    const newStart = group.bStart - (group.aStart - oldStart);
    const oldEnd = Math.min(a.length, group.aEnd + context);
    const newEnd = group.bEnd + (oldEnd - group.aEnd);
    const lines = [];
    let x = oldStart;
    let y = newStart;
    const push = (line) => { if (emitted < maxOutputLines) { lines.push(line); emitted += 1; } else truncated = true; };
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

// ───────────────────────── 경로 확인 ─────────────────────────

const pathKey = (value) => {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
};
const samePath = (left, right) => pathKey(left) === pathKey(right);
function isInside(root, target) {
  const relative = path.relative(root, target);
  return Boolean(relative) && relative.split(path.sep)[0] !== '..' && !path.isAbsolute(relative);
}

// 사용자가 파일 선택 창에서 직접 고른 파일. 보낸 화면별로 12시간만 기억한다.
const pickedGrants = new Map();
const PICK_TTL_MS = 12 * 60 * 60 * 1000;
const senderKey = (event) => (Number.isInteger(event?.sender?.id) ? `sender:${event.sender.id}` : 'internal');
function grantPickedFile(event, filePath) {
  const key = senderKey(event);
  const now = Date.now();
  const files = pickedGrants.get(key) || new Map();
  for (const [file, expiresAt] of files) if (expiresAt <= now) files.delete(file);
  files.set(path.resolve(filePath), now + PICK_TTL_MS);
  while (files.size > 200) files.delete(files.keys().next().value);
  pickedGrants.delete(key);
  pickedGrants.set(key, files);
  while (pickedGrants.size > 20) pickedGrants.delete(pickedGrants.keys().next().value);
}
function pickedRoots(event) {
  const files = pickedGrants.get(senderKey(event));
  if (!files) return [];
  const now = Date.now();
  return [...files].filter(([, expiresAt]) => expiresAt > now).map(([file]) => ({ path: file, label: '직접 고른 파일', kind: 'picked' }));
}

async function normalizeRoots(rawRoots) {
  const roots = [];
  for (const item of rawRoots) {
    const entry = typeof item === 'string' ? { path: item } : item;
    if (!entry || typeof entry.path !== 'string' || !entry.path || entry.path.includes('\0') || !path.isAbsolute(entry.path)) continue;
    try {
      const resolved = path.resolve(entry.path);
      const real = await realpath(resolved);
      const info = await lstat(real);
      const type = info.isDirectory() ? 'directory' : info.isFile() ? 'file' : '';
      // 드라이브 전체(C:\, /)를 허용 폴더로 받지 않는다. 잘못 넘긴 설정이 모든 파일을 여는 일을 막는다.
      if (!type || (type === 'directory' && path.parse(real).root === real)) continue;
      roots.push({ path: resolved, real, type, label: String(entry.label || (type === 'file' ? '선택한 파일' : '허용된 폴더')).slice(0, 120), kind: String(entry.kind || type).slice(0, 40) });
    } catch { /* 없는 폴더는 허용 목록에서 뺀다. */ }
  }
  return roots;
}

async function viewerRoots(event, payload, options) {
  const raw = [];
  if (Array.isArray(options.allowedRoots)) raw.push(...options.allowedRoots);
  if (typeof options.resolveAllowedRoots === 'function') {
    try { raw.push(...((await options.resolveAllowedRoots(payload, event)) || [])); }
    catch { throw new ViewerError('failed', '열 수 있는 폴더 목록을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.'); }
  }
  raw.push(...pickedRoots(event));
  return normalizeRoots(raw);
}

async function assertNoLinks(rootPath, filePath) {
  let current = rootPath;
  for (const part of path.relative(rootPath, filePath).split(path.sep)) {
    current = path.join(current, part);
    if ((await lstat(current)).isSymbolicLink()) throw new ViewerError('denied', '바로가기(링크)를 거치는 파일은 안전을 위해 열지 않습니다.');
  }
}

const deepest = (roots) => roots.sort((left, right) => right.real.length - left.real.length)[0];

async function resolveAllowedFile(rawPath, roots) {
  if (typeof rawPath !== 'string' || !rawPath || rawPath.length > 4096 || rawPath.includes('\0')) throw new ViewerError('denied', '파일 위치가 올바르지 않습니다.');
  if (!path.isAbsolute(rawPath) || /^\\\\[?.]\\/u.test(rawPath)) throw new ViewerError('denied', '앱이 확인한 전체 파일 위치가 필요합니다.');
  const resolved = path.resolve(rawPath);
  let info;
  try { info = await lstat(resolved); }
  catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') throw new ViewerError('not_found', '파일을 찾을 수 없습니다. 옮겨졌거나 지워졌을 수 있습니다.');
    throw new ViewerError('failed', '파일 정보를 읽지 못했습니다.');
  }
  if (info.isSymbolicLink()) throw new ViewerError('denied', '바로가기(링크) 파일은 안전을 위해 열지 않습니다.');
  if (!info.isFile()) throw new ViewerError('denied', '파일만 열 수 있습니다.');
  const real = await realpath(resolved);
  const lexical = deepest(roots.filter((root) => root.type === 'directory' && isInside(root.path, resolved)));
  if (lexical) await assertNoLinks(lexical.path, resolved);
  else if (!samePath(resolved, real)) throw new ViewerError('denied', '경로 중간에 바로가기(링크)가 있어 열지 않았습니다.');
  const root = deepest(roots.filter((item) => (item.type === 'file' ? samePath(item.real, real) : isInside(item.real, real))));
  if (!root) throw new ViewerError('denied', '연결한 프로젝트·작업 기억·결과 폴더 밖의 파일이라 열지 않았습니다. 필요하면 ‘파일 골라 보기’로 직접 선택해 주세요.');
  return { resolved, real, info, root, format: classifyDocumentPath(real) };
}

async function readVerified(target, limit) {
  const handle = await open(target.real, 'r');
  try {
    const before = await handle.stat();
    if (!before.isFile()) throw new ViewerError('denied', '파일만 열 수 있습니다.');
    if (target.info.ino && before.ino && (before.ino !== target.info.ino || before.dev !== target.info.dev)) throw new ViewerError('changed', '확인하는 사이 파일이 바뀌었습니다. 다시 열어 주세요.');
    if (before.size > limit) throw new ViewerError('too_large', `앱 안 보기는 ${Math.round(limit / MB)}MB 이하 파일만 지원합니다. 기본 프로그램으로 열어 확인해 주세요.`);
    const buffer = await handle.readFile();
    const after = await handle.stat();
    return { buffer, stats: after, unchanged: buffer.length === before.size && after.size === before.size && after.mtimeMs === before.mtimeMs };
  } finally {
    await handle.close();
  }
}

// ───────────────────────── 공통 도구 ─────────────────────────

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;
const CDATA_NODE = 4;
function* childNodes(node) { for (let child = node?.firstChild; child; child = child.nextSibling) yield child; }
function elementChildren(node, localName) {
  const result = [];
  for (const child of childNodes(node)) if (child.nodeType === ELEMENT_NODE && (!localName || child.localName === localName)) result.push(child);
  return result;
}
const firstElement = (node, localName) => elementChildren(node, localName)[0] || null;

function parseXml(xml) {
  if (/<!DOCTYPE|<!ENTITY/iu.test(xml)) throw new ViewerError('unsafe', '외부 정의(DTD)가 들어 있는 문서는 안전을 위해 열지 않습니다.');
  try {
    return new DOMParser({ onError: (level, message) => { if (level !== 'warning') throw new Error(String(message)); } }).parseFromString(xml, 'application/xml');
  } catch {
    throw new ViewerError('corrupt', '문서 내부 구조가 손상되어 읽지 못했습니다.');
  }
}

const byTrailingNumber = (left, right) => Number(left.match(/(\d+)\D*$/u)?.[1] ?? 0) - Number(right.match(/(\d+)\D*$/u)?.[1] ?? 0);

function withTimeout(promise, ms, onTimeout) {
  let timer;
  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(() => {
      try { onTimeout?.(); } catch { /* 정리 실패는 결과에 영향이 없다. */ }
      reject(new ViewerError('timeout', '문서를 읽는 데 시간이 너무 오래 걸려 멈췄습니다. 기본 프로그램으로 열어 확인해 주세요.'));
    }, ms);
    timer.unref?.();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

let activeParses = 0;
const waitingParses = [];
async function withParseSlot(task) {
  if (activeParses >= 2) await new Promise((resolve) => waitingParses.push(resolve));
  activeParses += 1;
  try { return await task(); }
  finally { activeParses -= 1; waitingParses.shift()?.(); }
}

/** 표시용 블록을 모은다. 개수·글자 수 상한과 민감정보 가림을 한곳에서 적용한다. */
function createBlockSink(limits, shield) {
  const blocks = [];
  const notes = [];
  let chars = 0;
  let truncated = false;
  const clip = (text) => {
    const value = String(text ?? '').replace(/\u0000/gu, '');
    if (value.length <= limits.maxBlockChars) return value;
    truncated = true;
    return `${value.slice(0, limits.maxBlockChars)}…`;
  };
  const room = (size = 0) => {
    if (blocks.length >= limits.maxBlocks || chars + size > limits.maxTotalChars) { truncated = true; return false; }
    chars += size;
    return true;
  };
  return {
    heading(level, text) {
      const value = clip(text).trim();
      if (value && room(value.length)) blocks.push({ type: 'heading', level: Math.min(6, Math.max(1, level)), text: shield.protect(value) });
    },
    paragraph(text) {
      const value = clip(text).replace(/[ \t]+$/gmu, '');
      if (value.trim() && room(value.length)) blocks.push({ type: 'paragraph', text: shield.protect(value) });
    },
    rich(type, level, runs) {
      const clipped = [];
      let length = 0;
      for (const run of runs) {
        if (length >= limits.maxBlockChars) { truncated = true; break; }
        const text = String(run.text ?? '').replace(/\u0000/gu, '').slice(0, limits.maxBlockChars - length);
        length += text.length;
        if (text) clipped.push({ ...run, text });
      }
      const plain = clipped.map((run) => run.text).join('');
      if (!plain.trim() || !room(plain.length)) return;
      const protectedRuns = shield.protectRuns(clipped);
      const text = protectedRuns.map((run) => run.text).join('');
      const block = type === 'heading' ? { type, level: Math.min(6, Math.max(1, level)), text } : { type: 'paragraph', text };
      if (protectedRuns.some((run) => run.bold || run.italic || run.href)) block.inlines = protectedRuns;
      blocks.push(block);
    },
    list(ordered, items) {
      const kept = [];
      for (const item of items) {
        const runs = (item.runs || [{ text: item.text }]).map((run) => ({ ...run, text: String(run.text ?? '').replace(/\u0000/gu, '').slice(0, limits.maxBlockChars) }));
        const plain = runs.map((run) => run.text).join('');
        if (!plain.trim() || !room(plain.length)) continue;
        const protectedRuns = shield.protectRuns(runs);
        const entry = { text: protectedRuns.map((run) => run.text).join(''), depth: Math.min(6, Math.max(0, item.depth || 0)) };
        if (protectedRuns.some((run) => run.bold || run.italic || run.href)) entry.inlines = protectedRuns;
        kept.push(entry);
      }
      if (kept.length) blocks.push({ type: 'list', ordered: Boolean(ordered), items: kept });
    },
    table(rows, extra = {}) {
      if (extra.truncated) truncated = true;
      const width = Math.min(limits.maxTableCols, Math.max(0, ...rows.map((row) => row.length)));
      if (rows.length > limits.maxTableRows || rows.some((row) => row.length > limits.maxTableCols)) truncated = true;
      const kept = rows.slice(0, limits.maxTableRows).map((row) => Array.from({ length: width }, (_value, index) => clip(row[index] ?? '').trim()));
      const size = kept.reduce((sum, row) => sum + row.reduce((inner, cell) => inner + cell.length, 0), 0);
      if (!width || !kept.some((row) => row.some(Boolean)) || !room(size)) return;
      blocks.push({ type: 'table', rows: kept.map((row) => row.map((cell) => shield.protect(cell))) });
    },
    image(alt) { if (room(0)) blocks.push({ type: 'image', alt: shield.protect(clip(alt).trim()) }); },
    note(text) { if (!notes.includes(text)) notes.push(text); },
    result() { return { kind: 'blocks', blocks, truncated, notes }; },
  };
}

function tableGrid(rowCount, colCount, cells, limits) {
  const rows = Math.min(Math.max(0, rowCount | 0), limits.maxTableRows);
  const cols = Math.min(Math.max(0, colCount | 0), limits.maxTableCols);
  const truncated = rowCount > limits.maxTableRows || colCount > limits.maxTableCols;
  if (rows > 0 && cols > 0 && cells.length && cells.every((cell) => Number.isInteger(cell.row) && Number.isInteger(cell.col) && cell.row >= 0 && cell.col >= 0)) {
    const grid = Array.from({ length: rows }, () => Array.from({ length: cols }, () => ''));
    for (const cell of cells) if (cell.row < rows && cell.col < cols) grid[cell.row][cell.col] = cell.text.trim();
    return { rows: grid, truncated };
  }
  const width = Math.max(1, Math.min(cols || cells.length || 1, limits.maxTableCols));
  const grid = [];
  cells.forEach((cell, index) => {
    const row = Math.floor(index / width);
    if (row < limits.maxTableRows) (grid[row] ||= Array.from({ length: width }, () => ''))[index % width] = cell.text.trim();
  });
  return { rows: grid, truncated: truncated || Math.ceil(cells.length / width) > limits.maxTableRows };
}

const flattenTable = (rows) => rows.map((row) => row.filter(Boolean).join(' · ')).filter(Boolean).join('\n');

// ───────────────────────── 텍스트 ─────────────────────────

function trimPartialUtf8(buffer) {
  let index = buffer.length - 1;
  let continuation = 0;
  while (index >= 0 && continuation < 4 && (buffer[index] & 0xc0) === 0x80) { index -= 1; continuation += 1; }
  if (index < 0) return buffer;
  const lead = buffer[index];
  const needed = lead >= 0xf0 ? 4 : lead >= 0xe0 ? 3 : lead >= 0xc0 ? 2 : 1;
  return needed > continuation + 1 ? buffer.subarray(0, index) : buffer;
}
function decodeUtf16(buffer, bigEndian) {
  const even = buffer.subarray(0, buffer.length - (buffer.length % 2));
  if (!bigEndian) return new TextDecoder('utf-16le').decode(even);
  const swapped = Buffer.from(even);
  swapped.swap16();
  return new TextDecoder('utf-16le').decode(swapped);
}
export function decodeTextBuffer(buffer, truncated = false) {
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) return { text: new TextDecoder('utf-8').decode(truncated ? trimPartialUtf8(buffer.subarray(3)) : buffer.subarray(3)), encoding: 'UTF-8' };
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) return { text: decodeUtf16(buffer.subarray(2), false), encoding: 'UTF-16' };
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) return { text: decodeUtf16(buffer.subarray(2), true), encoding: 'UTF-16 BE' };
  if (buffer.subarray(0, 8192).includes(0)) return { binary: true };
  const body = truncated ? trimPartialUtf8(buffer) : buffer;
  try { return { text: new TextDecoder('utf-8', { fatal: true }).decode(body), encoding: 'UTF-8' }; } catch { /* 한국어 옛 인코딩일 수 있다. */ }
  try { return { text: new TextDecoder('euc-kr', { fatal: true }).decode(body), encoding: 'EUC-KR (CP949)' }; } catch { /* 아래에서 깨진 글자를 표시한다. */ }
  return { text: new TextDecoder('utf-8').decode(body), encoding: 'UTF-8 (일부 글자를 읽지 못함)' };
}

function textContent(buffer, format, limits, shield) {
  const truncated = buffer.length > limits.maxTextBytes;
  const decoded = decodeTextBuffer(truncated ? buffer.subarray(0, limits.maxTextBytes) : buffer, truncated);
  if (decoded.binary) return { kind: 'unsupported', reason: '글자로 된 파일이 아닌 것 같아 앱 안에서 표시하지 않았습니다.' };
  const text = shield.protect(decoded.text.replace(/\u0000/gu, ''));
  const syntax = { markdown: 'markdown', csv: 'csv', json: 'json', code: 'code' }[format.kind] || 'plain';
  return { kind: 'text', syntax, language: format.language, delimiter: format.delimiter, text, encoding: decoded.encoding, lineCount: splitLines(text).length, truncated, shownBytes: Math.min(buffer.length, limits.maxTextBytes) };
}

// ───────────────────────── ZIP(DOCX·HWPX·PPTX·XLSX) ─────────────────────────

function readZipDirectory(buffer, limits) {
  let end = -1;
  for (let index = buffer.length - 22; index >= Math.max(0, buffer.length - 65557); index -= 1) {
    if (buffer.readUInt32LE(index) === 0x06054b50) { end = index; break; }
  }
  if (end < 0) throw new ViewerError('corrupt', '문서의 압축 구조를 찾지 못했습니다. 손상되었거나 다른 형식의 파일일 수 있습니다.');
  const count = buffer.readUInt16LE(end + 10);
  let offset = buffer.readUInt32LE(end + 16);
  if (count === 0xffff || offset === 0xffffffff) throw new ViewerError('unsupported', '매우 큰 압축 형식(ZIP64) 문서는 앱 안에서 열 수 없습니다.');
  if (count > limits.maxZipEntries) throw new ViewerError('too_large', '문서 안의 파일 수가 너무 많아 열지 않았습니다.');
  const entries = new Map();
  let total = 0;
  for (let index = 0; index < count; index += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) throw new ViewerError('corrupt', '문서의 압축 목록이 손상되었습니다.');
    const flags = buffer.readUInt16LE(offset + 8);
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const size = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    if (offset + 46 + nameLength > buffer.length) throw new ViewerError('corrupt', '문서의 압축 목록이 손상되었습니다.');
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength);
    if (flags & 1) throw new ViewerError('protected', '암호가 걸린 문서입니다. 원래 프로그램에서 암호를 풀고 다시 열어 주세요.');
    if (size > limits.maxZipEntryBytes) throw new ViewerError('too_large', '문서 안의 항목이 너무 커서 열지 않았습니다.');
    total += size;
    if (total > limits.maxZipTotalBytes) throw new ViewerError('too_large', '압축을 풀면 너무 커지는 문서라 열지 않았습니다.');
    if (compressedSize > 0 && size > MB && size / compressedSize > limits.maxZipRatio) throw new ViewerError('too_large', '압축 비율이 비정상적으로 높은 문서라 안전을 위해 열지 않았습니다.');
    entries.set(name, { name, method, compressedSize, size, localOffset });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function readZipEntry(buffer, entry, limits) {
  const at = entry.localOffset;
  if (at + 30 > buffer.length || buffer.readUInt32LE(at) !== 0x04034b50) throw new ViewerError('corrupt', '문서의 압축 항목이 손상되었습니다.');
  const start = at + 30 + buffer.readUInt16LE(at + 26) + buffer.readUInt16LE(at + 28);
  const end = start + entry.compressedSize;
  if (end > buffer.length) throw new ViewerError('corrupt', '문서의 압축 항목이 손상되었습니다.');
  const raw = buffer.subarray(start, end);
  if (entry.method === 0) {
    if (raw.length !== entry.size) throw new ViewerError('corrupt', '문서의 압축 항목이 손상되었습니다.');
    return raw;
  }
  if (entry.method !== 8) throw new ViewerError('unsupported', '지원하지 않는 압축 방식의 문서입니다.');
  let data;
  // 선언된 크기보다 크게 풀리는 항목(압축 폭탄)은 중간에 멈춘다.
  try { data = inflateRawSync(raw, { maxOutputLength: Math.max(1, Math.min(limits.maxZipEntryBytes, entry.size)) }); }
  catch { throw new ViewerError('corrupt', '문서 압축을 풀지 못했습니다. 파일이 손상되었을 수 있습니다.'); }
  if (data.length !== entry.size) throw new ViewerError('corrupt', '문서의 압축 항목 크기가 맞지 않습니다.');
  return data;
}

const zipText = (buffer, entries, name, limits) => {
  const entry = entries.get(name);
  return entry ? readZipEntry(buffer, entry, limits).toString('utf8').replace(/^\uFEFF/u, '') : null;
};

// ───────────────────────── DOCX ─────────────────────────

let mammothPromise;
const loadMammoth = () => (mammothPromise ??= import('mammoth').then((module) => module.default ?? module));

function mergeRuns(runs) {
  const merged = [];
  for (const run of runs) {
    if (!run.text) continue;
    const last = merged.at(-1);
    if (last && Boolean(last.bold) === Boolean(run.bold) && Boolean(last.italic) === Boolean(run.italic) && (last.href || '') === (run.href || '')) last.text += run.text;
    else merged.push({ ...run });
  }
  return merged.map((run) => {
    const clean = { text: run.text };
    if (run.bold) clean.bold = true;
    if (run.italic) clean.italic = true;
    if (run.href) clean.href = run.href;
    return clean;
  });
}

function htmlRuns(node, format = {}, output = [], counters = { images: 0 }) {
  if (node.nodeType === TEXT_NODE || node.nodeType === CDATA_NODE) { output.push({ ...format, text: node.data }); return output; }
  if (node.nodeType !== ELEMENT_NODE) return output;
  const tag = node.localName.toLowerCase();
  if (tag === 'br') { output.push({ ...format, text: '\n' }); return output; }
  if (tag === 'img') {
    counters.images += 1;
    const alt = (node.getAttribute('alt') || '').trim();
    output.push({ text: alt ? `[그림: ${alt}]` : '[그림]' });
    return output;
  }
  const next = { ...format };
  if (tag === 'strong' || tag === 'b') next.bold = true;
  if (tag === 'em' || tag === 'i') next.italic = true;
  if (tag === 'a') {
    const href = node.getAttribute('href') || '';
    if (/^(?:https?:|mailto:)/iu.test(href)) next.href = href.slice(0, 2048);
  }
  for (const child of childNodes(node)) htmlRuns(child, next, output, counters);
  return output;
}

function htmlCellText(cell, counters) {
  const parts = [];
  let inline = [];
  const flush = () => { const text = inline.map((run) => run.text).join('').trim(); if (text) parts.push(text); inline = []; };
  for (const child of childNodes(cell)) {
    const tag = child.nodeType === ELEMENT_NODE ? child.localName.toLowerCase() : '';
    if (tag === 'table') { flush(); parts.push(flattenTable(htmlTableRows(child, counters))); }
    else if (['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'ul', 'ol', 'div'].includes(tag)) { flush(); const text = htmlCellText(child, counters); if (text) parts.push(text); }
    else htmlRuns(child, {}, inline, counters);
  }
  flush();
  return parts.join('\n');
}

function htmlTableRows(table, counters) {
  const rows = [];
  const visit = (node) => {
    for (const child of elementChildren(node)) {
      const tag = child.localName.toLowerCase();
      if (tag === 'tr') rows.push(elementChildren(child).filter((cell) => ['td', 'th'].includes(cell.localName.toLowerCase())).map((cell) => htmlCellText(cell, counters)));
      else if (['thead', 'tbody', 'tfoot'].includes(tag)) visit(child);
    }
  };
  visit(table);
  return rows;
}

function htmlListItems(list, depth, items, counters) {
  for (const item of elementChildren(list)) {
    if (item.localName.toLowerCase() !== 'li') continue;
    const runs = [];
    const nested = [];
    for (const child of childNodes(item)) {
      const tag = child.nodeType === ELEMENT_NODE ? child.localName.toLowerCase() : '';
      if (tag === 'ul' || tag === 'ol') nested.push(child);
      else if (tag === 'p') { if (runs.length) runs.push({ text: '\n' }); htmlRuns(child, {}, runs, counters); }
      else htmlRuns(child, {}, runs, counters);
    }
    items.push({ runs: mergeRuns(runs), depth });
    for (const child of nested) htmlListItems(child, depth + 1, items, counters);
  }
}

function htmlBlocks(parent, sink, counters) {
  for (const element of elementChildren(parent)) {
    const tag = element.localName.toLowerCase();
    if (/^h[1-6]$/u.test(tag)) sink.rich('heading', Number(tag[1]), mergeRuns(htmlRuns(element, {}, [], counters)));
    else if (tag === 'ul' || tag === 'ol') { const items = []; htmlListItems(element, 0, items, counters); sink.list(tag === 'ol', items); }
    else if (tag === 'table') sink.table(htmlTableRows(element, counters));
    else if (tag === 'blockquote' || tag === 'div' || tag === 'section') htmlBlocks(element, sink, counters);
    else sink.rich('paragraph', 0, mergeRuns(htmlRuns(element, {}, [], counters)));
  }
}

async function docxContent(buffer, limits, shield) {
  const entries = readZipDirectory(buffer, limits);
  if (!entries.has('word/document.xml')) throw new ViewerError('corrupt', 'Word 문서(DOCX) 본문을 찾지 못했습니다.');
  // mammoth 가 읽는 XML 부분을 먼저 실제 크기로 풀어 본다(압축 폭탄 차단). 그림은 읽지 않는다.
  for (const entry of entries.values()) if (/\.(?:xml|rels)$/iu.test(entry.name)) readZipEntry(buffer, entry, limits);
  const mammoth = await loadMammoth();
  const sink = createBlockSink(limits, shield);
  const counters = { images: 0 };
  let converted;
  try { converted = await mammoth.convertToHtml({ buffer }, { convertImage: mammoth.images.imgElement(async () => ({ src: '' })) }); }
  catch { throw new ViewerError('corrupt', 'Word 문서를 읽지 못했습니다. 파일이 손상되었을 수 있습니다.'); }
  try {
    const dom = parseXml(`<root>${String(converted.value || '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/gu, '')}</root>`);
    htmlBlocks(dom.documentElement, sink, counters);
  } catch (error) {
    if (error instanceof ViewerError && error.status === 'unsafe') throw error;
    const raw = await mammoth.extractRawText({ buffer });
    for (const paragraph of String(raw.value || '').split(/\n{2,}/u)) sink.paragraph(paragraph);
    sink.note('서식을 읽지 못해 글자만 표시합니다.');
  }
  if (counters.images) sink.note(`그림 ${counters.images}개는 자리만 표시합니다. 그림 내용은 원본에서 확인해 주세요.`);
  sink.note('머리글·바닥글과 메모는 표시하지 않습니다.');
  return sink.result();
}

// ───────────────────────── HWPX ─────────────────────────

function hwpxRunText(node) {
  let text = '';
  for (const child of childNodes(node)) {
    if (child.nodeType === TEXT_NODE || child.nodeType === CDATA_NODE) text += child.data;
    else if (child.nodeType === ELEMENT_NODE) {
      const name = child.localName;
      if (name === 'lineBreak') text += '\n';
      else if (name === 'tab') text += '\t';
      else if (name === 'fwSpace' || name === 'nbSpace') text += ' ';
      else if (name === 'hyphen') text += '-';
      else text += hwpxRunText(child);
    }
  }
  return text;
}

function hwpxParagraph(paragraph, emit, limits) {
  let text = '';
  const flush = () => { if (text.trim()) emit.paragraph(text); text = ''; };
  const walk = (node) => {
    for (const child of elementChildren(node)) {
      const name = child.localName;
      if (name === 't') text += hwpxRunText(child);
      else if (name === 'tbl') { flush(); emit.table(hwpxTableRows(child, limits)); }
      else if (name === 'p') { flush(); hwpxParagraph(child, emit, limits); }
      else if (name === 'header' || name === 'footer' || name === 'masterPage') continue;
      else walk(child);
    }
  };
  walk(paragraph);
  flush();
}

function hwpxTableRows(table, limits) {
  const cells = [];
  for (const row of elementChildren(table, 'tr')) {
    for (const cell of elementChildren(row, 'tc')) {
      const parts = [];
      const collector = { paragraph: (value) => parts.push(value), table: (grid) => parts.push(flattenTable(grid.rows)) };
      const walkCell = (node) => { for (const child of elementChildren(node)) { if (child.localName === 'p') hwpxParagraph(child, collector, limits); else if (child.localName === 'subList') walkCell(child); } };
      walkCell(cell);
      const address = firstElement(cell, 'cellAddr');
      cells.push({ row: address ? Number(address.getAttribute('rowAddr')) : -1, col: address ? Number(address.getAttribute('colAddr')) : -1, text: parts.join('\n') });
    }
  }
  return tableGrid(Number(table.getAttribute('rowCnt')) || 0, Number(table.getAttribute('colCnt')) || 0, cells, limits);
}

function hwpxContent(buffer, limits, shield) {
  const entries = readZipDirectory(buffer, limits);
  const manifest = zipText(buffer, entries, 'META-INF/manifest.xml', limits);
  if (manifest && /encryption-data|EncryptionData/iu.test(manifest)) throw new ViewerError('protected', '암호가 걸린 한글 문서입니다. 한글에서 암호를 풀고 다시 열어 주세요.');
  const sink = createBlockSink(limits, shield);
  const emit = { paragraph: (text) => sink.paragraph(text), table: (grid) => sink.table(grid.rows, { truncated: grid.truncated }) };
  const sections = [...entries.keys()].filter((name) => /^Contents\/section\d+\.xml$/iu.test(name)).sort(byTrailingNumber);
  if (!sections.length) {
    const preview = zipText(buffer, entries, 'Preview/PrvText.txt', limits);
    if (!preview) throw new ViewerError('corrupt', '한글 문서(HWPX) 본문을 찾지 못했습니다.');
    for (const line of preview.split(/\r?\n/u)) sink.paragraph(line.replace(/^<|>$/gu, ''));
    sink.note('본문을 찾지 못해 문서에 저장된 미리보기 글만 표시합니다.');
    return sink.result();
  }
  for (const name of sections) {
    const dom = parseXml(zipText(buffer, entries, name, limits));
    for (const child of elementChildren(dom.documentElement)) if (child.localName === 'p') hwpxParagraph(child, emit, limits);
  }
  sink.note('머리말·꼬리말과 그림은 표시하지 않습니다.');
  return sink.result();
}

// ───────────────────────── HWP 5.0 (CFB + raw deflate) ─────────────────────────

const CFB_SIGNATURE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const END_OF_CHAIN = 0xfffffffe;
const NO_STREAM = 0xffffffff;

/** 최소한의 복합 문서(CFB/OLE2) 읽기. 스트림 이름으로 내용을 꺼낸다. */
export function readCompoundFile(buffer, { maxStreamBytes = DOCUMENT_VIEWER_LIMITS.maxHwpStreamBytes } = {}) {
  const corrupt = () => new ViewerError('corrupt', '한글(HWP) 파일 구조가 손상되었습니다.');
  if (!Buffer.isBuffer(buffer) || buffer.length < 512 || !buffer.subarray(0, 8).equals(CFB_SIGNATURE)) throw new ViewerError('corrupt', '한글 5.0(HWP) 형식의 파일이 아닙니다.');
  const major = buffer.readUInt16LE(26);
  const sectorShift = buffer.readUInt16LE(30);
  if (!((major === 3 && sectorShift === 9) || (major === 4 && sectorShift === 12)) || buffer.readUInt16LE(32) !== 6) throw corrupt();
  const sectorSize = 2 ** sectorShift;
  const fatCount = buffer.readUInt32LE(44);
  const directoryStart = buffer.readUInt32LE(48);
  const cutoff = buffer.readUInt32LE(56) || 4096;
  const miniFatStart = buffer.readUInt32LE(60);
  const miniFatCount = buffer.readUInt32LE(64);
  let difatNext = buffer.readUInt32LE(68);
  const difatCount = buffer.readUInt32LE(72);
  const sectorTotal = Math.ceil(Math.max(0, buffer.length - sectorSize) / sectorSize);
  if (fatCount > sectorTotal) throw corrupt();
  const sector = (id) => {
    if (id >= sectorTotal) throw corrupt();
    const start = (id + 1) * sectorSize;
    return buffer.subarray(start, Math.min(start + sectorSize, buffer.length));
  };
  const fatSectors = [];
  for (let index = 0; index < 109 && fatSectors.length < fatCount; index += 1) fatSectors.push(buffer.readUInt32LE(76 + index * 4));
  const seenDifat = new Set();
  for (let count = 0; count < difatCount && fatSectors.length < fatCount && difatNext !== END_OF_CHAIN && difatNext !== NO_STREAM; count += 1) {
    if (seenDifat.has(difatNext)) throw corrupt();
    seenDifat.add(difatNext);
    const data = sector(difatNext);
    if (data.length < sectorSize) throw corrupt();
    for (let index = 0; index < sectorSize / 4 - 1 && fatSectors.length < fatCount; index += 1) fatSectors.push(data.readUInt32LE(index * 4));
    difatNext = data.readUInt32LE(sectorSize - 4);
  }
  const perSector = sectorSize / 4;
  const fat = new Uint32Array(fatSectors.length * perSector).fill(NO_STREAM);
  fatSectors.forEach((id, position) => {
    const data = sector(id);
    for (let index = 0; index < perSector && index * 4 + 4 <= data.length; index += 1) fat[position * perSector + index] = data.readUInt32LE(index * 4);
  });
  const chain = (start, table, limit) => {
    const ids = [];
    const seen = new Set();
    for (let id = start; id !== END_OF_CHAIN; id = table[id]) {
      if (id >= table.length || seen.has(id) || ids.length > limit) throw corrupt();
      seen.add(id);
      ids.push(id);
    }
    return ids;
  };
  const readChain = (start, bytes) => Buffer.concat(chain(start, fat, Math.ceil(bytes / sectorSize) + 1).map(sector));
  const directory = readChain(directoryStart, 16 * MB);
  const entries = [];
  for (let offset = 0; offset + 128 <= directory.length; offset += 128) {
    const nameLength = directory.readUInt16LE(offset + 64);
    entries.push({
      name: nameLength >= 2 && nameLength <= 64 ? directory.toString('utf16le', offset, offset + nameLength - 2) : '',
      type: directory[offset + 66],
      left: directory.readUInt32LE(offset + 68),
      right: directory.readUInt32LE(offset + 72),
      child: directory.readUInt32LE(offset + 76),
      start: directory.readUInt32LE(offset + 116),
      size: major === 3 ? directory.readUInt32LE(offset + 120) : Number(directory.readBigUInt64LE(offset + 120)),
    });
  }
  const root = entries[0];
  if (!root || root.type !== 5) throw corrupt();
  const streams = new Map();
  const visited = new Set();
  const collect = (first, prefix, nesting) => {
    if (nesting > 32) throw corrupt();
    const stack = [first];
    while (stack.length) {
      const id = stack.pop();
      if (id === NO_STREAM || id >= entries.length) continue;
      if (visited.has(id)) throw corrupt();
      visited.add(id);
      const entry = entries[id];
      stack.push(entry.left, entry.right);
      const fullName = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.type === 2) streams.set(fullName, entry);
      else if (entry.type === 1) collect(entry.child, fullName, nesting + 1);
    }
  };
  collect(root.child, '', 0);
  let miniFat;
  let miniStream;
  const loadMini = () => {
    if (miniStream) return;
    const bytes = miniFatCount ? readChain(miniFatStart, miniFatCount * sectorSize) : Buffer.alloc(0);
    miniFat = new Uint32Array(Math.floor(bytes.length / 4));
    for (let index = 0; index < miniFat.length; index += 1) miniFat[index] = bytes.readUInt32LE(index * 4);
    miniStream = root.size ? readChain(root.start, root.size).subarray(0, root.size) : Buffer.alloc(0);
  };
  const readStream = (entry) => {
    if (entry.size > maxStreamBytes) throw new ViewerError('too_large', '한글 문서 안의 내용이 너무 커서 열지 않았습니다.');
    if (!entry.size) return Buffer.alloc(0);
    let data;
    if (entry.size < cutoff) {
      loadMini();
      data = Buffer.concat(chain(entry.start, miniFat, Math.ceil(entry.size / 64) + 1).map((id) => {
        if (id * 64 >= miniStream.length) throw corrupt();
        return miniStream.subarray(id * 64, id * 64 + 64);
      }));
    } else data = readChain(entry.start, entry.size);
    if (data.length < entry.size) throw corrupt();
    return data.subarray(0, entry.size);
  };
  return {
    names: () => [...streams.keys()],
    has: (name) => streams.has(name),
    read: (name) => (streams.has(name) ? readStream(streams.get(name)) : null),
  };
}

const HWPTAG_PARA_TEXT = 67;
const HWPTAG_CTRL_HEADER = 71;
const HWPTAG_LIST_HEADER = 72;
const HWPTAG_TABLE = 77;
// 8워드(16바이트)를 차지하는 인라인·확장 제어문자. 나머지 0~31은 1워드짜리 글자 제어문자다.
const HWP_WIDE_CONTROLS = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23]);

export function decodeHwpParaText(payload) {
  let text = '';
  for (let offset = 0; offset + 1 < payload.length;) {
    const code = payload.readUInt16LE(offset);
    if (code >= 32) { text += String.fromCharCode(code); offset += 2; continue; }
    if (HWP_WIDE_CONTROLS.has(code)) { if (code === 9) text += '\t'; offset += 16; continue; }
    if (code === 10) text += '\n';
    else if (code === 24) text += '-';
    else if (code === 30 || code === 31) text += ' ';
    offset += 2;
  }
  return text;
}

function* hwpRecords(data) {
  let offset = 0;
  while (offset + 4 <= data.length) {
    const header = data.readUInt32LE(offset);
    offset += 4;
    let size = header >>> 20;
    if (size === 0xfff) {
      if (offset + 4 > data.length) return;
      size = data.readUInt32LE(offset);
      offset += 4;
    }
    if (offset + size > data.length) return;
    yield { tag: header & 0x3ff, level: (header >>> 10) & 0x3ff, payload: data.subarray(offset, offset + size) };
    offset += size;
  }
}

const ctrlId = (value) => String.fromCharCode((value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255);

function hwpSectionBlocks(data, emit, limits) {
  const tables = [];
  let skipLevel = -1;
  const finish = (table) => {
    const grid = tableGrid(table.rows, table.cols, table.cells.map((cell) => ({ row: cell.row, col: cell.col, text: cell.paragraphs.join('\n') })), limits);
    const parent = tables.at(-1);
    if (parent) { if (parent.cell) parent.cell.paragraphs.push(flattenTable(grid.rows)); }
    else emit.table(grid);
  };
  for (const record of hwpRecords(data)) {
    if (skipLevel >= 0) {
      if (record.level > skipLevel) continue;
      skipLevel = -1;
    }
    while (tables.length && record.level <= tables.at(-1).level) finish(tables.pop());
    const table = tables.at(-1);
    if (record.tag === HWPTAG_CTRL_HEADER && record.payload.length >= 4) {
      const id = ctrlId(record.payload.readUInt32LE(0));
      if (id === 'tbl ') tables.push({ level: record.level, rows: 0, cols: 0, cells: [], cell: null });
      else if (id === 'head' || id === 'foot') skipLevel = record.level;
    } else if (table && record.tag === HWPTAG_TABLE && record.level === table.level + 1 && record.payload.length >= 8) {
      table.rows = record.payload.readUInt16LE(4);
      table.cols = record.payload.readUInt16LE(6);
    } else if (table && record.tag === HWPTAG_LIST_HEADER && record.level === table.level + 1) {
      const payload = record.payload;
      table.cell = { col: payload.length >= 12 ? payload.readUInt16LE(8) : -1, row: payload.length >= 12 ? payload.readUInt16LE(10) : -1, paragraphs: [] };
      table.cells.push(table.cell);
    } else if (record.tag === HWPTAG_PARA_TEXT) {
      const text = decodeHwpParaText(record.payload);
      if (table) { if (table.cell) table.cell.paragraphs.push(text); }
      else emit.paragraph(text);
    }
  }
  while (tables.length) finish(tables.pop());
}

function hwpContent(buffer, limits, shield) {
  const file = readCompoundFile(buffer, { maxStreamBytes: limits.maxHwpStreamBytes });
  const header = file.read('FileHeader');
  if (!header || header.length < 40 || header.toString('latin1', 0, 17) !== 'HWP Document File') throw new ViewerError('unsupported', '한글 5.0 이후 형식의 HWP만 열 수 있습니다. 한글에서 새 형식으로 저장해 주세요.');
  const flags = header.readUInt32LE(36);
  const version = header.readUInt32LE(32);
  if (flags & 2) throw new ViewerError('protected', '암호가 걸린 한글 문서입니다. 한글에서 암호를 풀고 다시 열어 주세요.');
  const sink = createBlockSink(limits, shield);
  const emit = { paragraph: (text) => sink.paragraph(text), table: (grid) => sink.table(grid.rows, { truncated: grid.truncated }) };
  const preview = () => {
    const text = file.read('PrvText');
    if (!text?.length) return false;
    for (const line of decodeUtf16(text, false).split(/\r?\n/u)) sink.paragraph(line.replace(/^<|>$/gu, ''));
    return true;
  };
  if (flags & 4) {
    if (!preview()) throw new ViewerError('protected', '배포용(보기 전용) 한글 문서라 본문을 읽을 수 없습니다. 한글에서 열어 확인해 주세요.');
    sink.note('배포용 문서라 문서에 저장된 미리보기 글만 표시합니다.');
    return sink.result();
  }
  const sections = file.names().filter((name) => /^BodyText\/Section\d+$/u.test(name)).sort(byTrailingNumber);
  let total = 0;
  try {
    if (!sections.length) throw new ViewerError('corrupt', '한글 문서 본문을 찾지 못했습니다.');
    for (const name of sections) {
      let data = file.read(name);
      if (flags & 1) data = inflateRawSync(data, { maxOutputLength: limits.maxHwpStreamBytes });
      total += data.length;
      if (total > limits.maxHwpTotalBytes) throw new ViewerError('too_large', '한글 문서 본문이 너무 커서 앞부분만 표시합니다.');
      hwpSectionBlocks(data, emit, limits);
    }
  } catch (error) {
    if (sink.result().blocks.length && error instanceof ViewerError && error.status === 'too_large') { sink.note(error.userMessage); return { ...sink.result(), truncated: true }; }
    if (!sink.result().blocks.length && preview()) { sink.note('본문을 읽지 못해 문서에 저장된 미리보기 글만 표시합니다.'); return sink.result(); }
    if (error instanceof ViewerError) throw error;
    throw new ViewerError('corrupt', '한글 문서 본문을 풀지 못했습니다. 파일이 손상되었을 수 있습니다.');
  }
  sink.note('머리말·꼬리말과 그림은 표시하지 않습니다.');
  return { ...sink.result(), version: `${version >>> 24}.${(version >>> 16) & 255}.${(version >>> 8) & 255}.${version & 255}` };
}

// ───────────────────────── PPTX ─────────────────────────

const DRAWING_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const RELATIONSHIP_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

function drawingParagraphText(paragraph) {
  let text = '';
  const walk = (node) => {
    for (const child of elementChildren(node)) {
      if (child.localName === 't') text += child.textContent || '';
      else if (child.localName === 'br') text += '\n';
      else walk(child);
    }
  };
  walk(paragraph);
  return text;
}

function pptxSlideNames(buffer, entries, limits) {
  const fallback = [...entries.keys()].filter((name) => /^ppt\/slides\/slide\d+\.xml$/u.test(name)).sort(byTrailingNumber);
  try {
    const presentation = parseXml(zipText(buffer, entries, 'ppt/presentation.xml', limits) || '');
    const relations = parseXml(zipText(buffer, entries, 'ppt/_rels/presentation.xml.rels', limits) || '');
    const targets = new Map();
    for (const relation of elementChildren(relations.documentElement, 'Relationship')) targets.set(relation.getAttribute('Id'), relation.getAttribute('Target'));
    const ordered = [];
    const list = elementChildren(presentation.documentElement, 'sldIdLst')[0];
    for (const slide of elementChildren(list, 'sldId')) {
      const target = targets.get(slide.getAttributeNS(RELATIONSHIP_NS, 'id') || slide.getAttribute('r:id'));
      const name = target ? path.posix.normalize(path.posix.join('ppt', target)) : '';
      if (entries.has(name)) ordered.push(name);
    }
    return ordered.length ? ordered : fallback;
  } catch { return fallback; }
}

function pptxContent(buffer, limits, shield) {
  const entries = readZipDirectory(buffer, limits);
  const slides = pptxSlideNames(buffer, entries, limits);
  if (!slides.length) throw new ViewerError('corrupt', 'PowerPoint 슬라이드를 찾지 못했습니다.');
  const sink = createBlockSink(limits, shield);
  slides.forEach((name, index) => {
    sink.heading(2, `슬라이드 ${index + 1}`);
    const walk = (node) => {
      for (const child of elementChildren(node)) {
        if (child.namespaceURI === DRAWING_NS && child.localName === 'tbl') {
          sink.table(elementChildren(child, 'tr').map((row) => elementChildren(row, 'tc').map((cell) => elementChildren(firstElement(cell, 'txBody'), 'p').map(drawingParagraphText).filter((text) => text.trim()).join('\n'))));
        } else if (child.namespaceURI === DRAWING_NS && child.localName === 'p') sink.paragraph(drawingParagraphText(child));
        else walk(child);
      }
    };
    walk(parseXml(zipText(buffer, entries, name, limits)).documentElement);
  });
  sink.note('발표자 메모와 그림은 표시하지 않습니다.');
  return sink.result();
}

// ───────────────────────── XLSX ─────────────────────────

async function xlsxContent(buffer, limits, shield) {
  const entries = readZipDirectory(buffer, limits);
  for (const entry of entries.values()) if (!entry.name.endsWith('/')) readZipEntry(buffer, entry, limits);
  const module = await import('exceljs');
  const ExcelJS = module.default ?? module;
  const workbook = new ExcelJS.Workbook();
  try { await workbook.xlsx.load(buffer); }
  catch { throw new ViewerError('corrupt', 'Excel 문서를 읽지 못했습니다. 파일이 손상되었을 수 있습니다.'); }
  const sink = createBlockSink(limits, shield);
  workbook.worksheets.slice(0, limits.maxSheets).forEach((sheet) => {
    sink.heading(2, `시트: ${sheet.name}`);
    const width = Math.min(sheet.columnCount || 0, limits.maxTableCols);
    const rows = [];
    let truncated = (sheet.columnCount || 0) > limits.maxTableCols;
    sheet.eachRow({ includeEmpty: false }, (row) => {
      if (rows.length >= limits.maxTableRows) { truncated = true; return; }
      const cells = [];
      for (let column = 1; column <= width; column += 1) cells.push(String(row.getCell(column).text ?? ''));
      rows.push(cells);
    });
    if (rows.length && width) sink.table(rows, { truncated });
    else sink.paragraph('(빈 시트)');
  });
  if (workbook.worksheets.length > limits.maxSheets) sink.note(`시트가 많아 앞쪽 ${limits.maxSheets}개만 표시합니다.`);
  sink.note('수식은 저장된 결과 값으로 표시합니다. 차트·그림은 표시하지 않습니다.');
  return sink.result();
}

// ───────────────────────── PDF ─────────────────────────

const PDF_MAGIC = Buffer.from('%PDF-');
let pdfParsePromise;
const loadPdfParse = () => (pdfParsePromise ??= import('pdf-parse').then((module) => module.PDFParse));
const isPdfPasswordError = (error) => error?.name === 'PasswordException' || /password/iu.test(String(error?.message || ''));

async function pdfContent(buffer, limits, shield, options) {
  if (!buffer.subarray(0, 1024).includes(PDF_MAGIC)) throw new ViewerError('corrupt', 'PDF 문서인지 확인하지 못했습니다.');
  const PDFParse = await loadPdfParse();
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  let result;
  try { result = await withTimeout(parser.getText({ first: limits.maxPdfPages, pageJoiner: '' }), limits.parseTimeoutMs); }
  catch (error) {
    if (isPdfPasswordError(error)) throw new ViewerError('protected', '암호가 걸린 PDF입니다. PDF 창에서 암호를 입력해 열어 주세요.');
    if (error instanceof ViewerError) throw error;
    throw new ViewerError('corrupt', 'PDF를 읽지 못했습니다. 파일이 손상되었을 수 있습니다.');
  } finally { await parser.destroy().catch(() => {}); }
  const pages = result.pages.slice(0, limits.maxPdfPages).map((page) => ({
    number: page.num,
    text: shield.protect(String(page.text || '').replace(/\u0000/gu, '').replace(/\n?-- \d+ of \d+ --\s*$/u, '').trimEnd().slice(0, limits.maxPdfPageChars)),
  }));
  const textChars = pages.reduce((sum, page) => sum + page.text.trim().length, 0);
  return {
    kind: 'pdf', pages, pageCount: result.total, truncated: result.total > pages.length, textLayer: textChars > 0,
    viewer: { builtIn: true, available: Boolean(options.BrowserWindow && options.dialog) },
    notes: textChars ? [] : ['글자 정보가 없는 PDF(스캔본)입니다. 페이지 이미지로 확인해 주세요. 글자 인식(OCR)은 하지 않습니다.'],
  };
}

// ───────────────────────── 이미지 ─────────────────────────

function imageSignatureMatches(buffer, extension) {
  const head = buffer.subarray(0, 16);
  if (extension === 'png') return head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (extension === 'jpg' || extension === 'jpeg') return head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
  if (extension === 'gif') return head.toString('latin1', 0, 4) === 'GIF8';
  if (extension === 'webp') return head.toString('latin1', 0, 4) === 'RIFF' && head.toString('latin1', 8, 12) === 'WEBP';
  if (extension === 'bmp') return head.toString('latin1', 0, 2) === 'BM';
  if (extension === 'ico') return head[0] === 0 && head[1] === 0 && head[2] === 1 && head[3] === 0;
  if (extension === 'svg') return /<svg[\s>]/iu.test(buffer.subarray(0, 4096).toString('utf8'));
  return false;
}

function imageContent(buffer, format) {
  if (!imageSignatureMatches(buffer, format.extension)) return { kind: 'unsupported', reason: '확장자와 실제 이미지 형식이 달라 표시하지 않았습니다.' };
  return { kind: 'image', mime: format.mime, dataUrl: `data:${format.mime};base64,${buffer.toString('base64')}`, notes: ['이미지 안의 글자는 민감정보 검사를 하지 않습니다.'] };
}

// ───────────────────────── 문서 모델 ─────────────────────────

function sizeLimitFor(format, limits) {
  if (format.kind === 'image') return limits.maxImageBytes;
  if (format.kind === 'xlsx') return limits.maxSpreadsheetBytes;
  return limits.maxFileBytes;
}

async function parseContent(buffer, format, limits, shield, options) {
  switch (format.kind) {
    case 'markdown': case 'text': case 'csv': case 'json': case 'code': return textContent(buffer, format, limits, shield);
    case 'docx': return withTimeout(docxContent(buffer, limits, shield), limits.parseTimeoutMs);
    case 'hwpx': return hwpxContent(buffer, limits, shield);
    case 'hwp': return hwpContent(buffer, limits, shield);
    case 'pptx': return pptxContent(buffer, limits, shield);
    case 'xlsx': return withTimeout(xlsxContent(buffer, limits, shield), limits.parseTimeoutMs);
    case 'pdf': return pdfContent(buffer, limits, shield, options);
    case 'image': return imageContent(buffer, format);
    default: return { kind: 'unsupported', reason: '이 형식은 앱 안에서 미리 볼 수 없습니다.' };
  }
}

function fileInfo(target, bytes, mtimeMs) {
  return { name: path.basename(target.real), path: target.real, extension: target.format.extension, format: target.format.kind, formatLabel: target.format.label, bytes, modifiedAt: new Date(mtimeMs).toISOString() };
}

const emptySensitive = () => ({ total: 0, kinds: Object.fromEntries(SENSITIVE_KINDS.map((kind) => [kind, 0])), masked: true });

function securityInfo(target, { sha256 = '', bytes, unchanged, shield, notes = [] }) {
  const relative = target.root.type === 'file' ? path.basename(target.real) : path.relative(target.root.real, target.real);
  return {
    readOnly: true, originalModified: false, externalTransfer: false, insideAllowedRoot: true, unchangedDuringRead: unchanged !== false,
    rootLabel: target.root.label, rootKind: target.root.kind, relativePath: relative, sha256, bytes,
    sensitive: shield ? shield.summary() : emptySensitive(),
    canOpenExternally: EXTERNAL_OPEN_EXTENSIONS.has(target.format.extension),
    notes,
  };
}

async function buildDocumentModel(target, limits, reveal, options) {
  const limit = sizeLimitFor(target.format, limits);
  if (target.info.size > limit) {
    return failure('too_large', `앱 안 보기는 ${Math.round(limit / MB)}MB 이하 파일만 지원합니다. 기본 프로그램으로 열어 확인해 주세요.`, {
      file: fileInfo(target, target.info.size, target.info.mtimeMs), security: securityInfo(target, { bytes: target.info.size }),
    });
  }
  const { buffer, stats, unchanged } = await readVerified(target, limit);
  const sha256 = createHash('sha256').update(buffer).digest('hex');
  const shield = createSensitiveShield(!reveal);
  const file = fileInfo(target, buffer.length, stats.mtimeMs);
  let content;
  try {
    content = await parseContent(buffer, target.format, limits, shield, options);
  } catch (error) {
    const known = error instanceof ViewerError;
    return failure(known ? error.status : 'failed', known ? error.userMessage : '문서를 읽지 못했습니다. 파일이 손상되었거나 지원하지 않는 내용일 수 있습니다.', { file, security: securityInfo(target, { sha256, bytes: buffer.length, unchanged, shield }) });
  }
  const notes = [];
  if (!unchanged) notes.push('읽는 동안 파일이 바뀌었습니다. 다시 열면 최신 내용을 볼 수 있습니다.');
  if (content.kind === 'pdf') notes.push('페이지 이미지는 원본 그대로라 민감정보를 가릴 수 없습니다.');
  return {
    status: 'ready',
    userMessage: content.kind === 'unsupported' ? content.reason : '읽기 전용으로 열었습니다. 원본은 바뀌지 않습니다.',
    file, content, security: securityInfo(target, { sha256, bytes: buffer.length, unchanged, shield, notes }), ...baseResult,
  };
}

/** diff 와 다른 모듈이 쓰는 평문 변환. 표는 칸을 ' | ' 로 잇는다. */
export function documentPlainText(content) {
  if (!content) return '';
  if (content.kind === 'text') return content.text;
  if (content.kind === 'pdf') return content.pages.map((page) => `[${page.number}쪽]\n${page.text}`).join('\n');
  if (content.kind !== 'blocks') return '';
  const lines = [];
  for (const block of content.blocks) {
    if (block.type === 'heading') lines.push(`${'#'.repeat(block.level)} ${block.text}`);
    else if (block.type === 'paragraph') lines.push(block.text);
    else if (block.type === 'list') block.items.forEach((item, index) => lines.push(`${'  '.repeat(item.depth)}${block.ordered ? `${index + 1}.` : '-'} ${item.text}`));
    else if (block.type === 'table') for (const row of block.rows) lines.push(row.join(' | '));
    else if (block.type === 'image') lines.push(block.alt ? `[그림: ${block.alt}]` : '[그림]');
  }
  return lines.join('\n');
}

// ───────────────────────── 요청 처리 ─────────────────────────

function assertTrustedSender(event, options) {
  if (options.trustedSender === true) return;
  const frame = event?.senderFrame;
  if (!frame || frame !== event?.sender?.mainFrame) throw new ViewerError('denied', '모디크루 화면에서만 문서를 열 수 있습니다.');
  let url;
  try { url = new URL(frame.url); } catch { throw new ViewerError('denied', '모디크루 화면에서만 문서를 열 수 있습니다.'); }
  const trusted = typeof options.trustedOrigin === 'function' ? options.trustedOrigin(url) : url.protocol === 'modycrew:' && url.host === 'app';
  if (!trusted) throw new ViewerError('denied', '모디크루 화면에서만 문서를 열 수 있습니다.');
}

async function diffSide(side, roots, limits) {
  if (side === null || side === undefined) return { text: '', label: '없음' };
  if (typeof side !== 'object') throw new ViewerError('failed', '비교할 내용을 확인해 주세요.');
  if (typeof side.text === 'string') {
    if (side.text.length > limits.maxDiffChars) throw new ViewerError('too_large', '비교할 글이 너무 깁니다.');
    return { text: side.text, label: String(side.label || '글').slice(0, 120) };
  }
  if (typeof side.path === 'string') {
    const target = await resolveAllowedFile(side.path, roots);
    const model = await withParseSlot(() => buildDocumentModel(target, limits, true, {}));
    if (model.status !== 'ready') throw new ViewerError(model.status, model.userMessage);
    if (!['text', 'blocks', 'pdf'].includes(model.content.kind)) throw new ViewerError('unsupported', '이 형식은 글자 비교를 지원하지 않습니다.');
    return { text: documentPlainText(model.content).slice(0, limits.maxDiffChars), label: model.file.name, sha256: model.security.sha256 };
  }
  throw new ViewerError('failed', '비교할 내용을 확인해 주세요.');
}

async function openPdfViewerWindow(target, options) {
  if (!options.BrowserWindow || !options.dialog) return failure('unavailable', '설치된 ModyCrew 앱에서 PDF 창을 열 수 있습니다.');
  const { ensureBundledPdfViewer, featureModulePaths } = await import('./feature-modules/runtime.mjs');
  const { createPdfViewerServer, registerPdfCopySaving } = await import('./feature-modules/pdf-viewer.mjs');
  await ensureBundledPdfViewer(options);
  const { buffer } = await readVerified(target, DOCUMENT_VIEWER_LIMITS.maxPdfViewerBytes);
  if (!buffer.subarray(0, 1024).includes(PDF_MAGIC)) throw new ViewerError('corrupt', 'PDF 문서인지 확인하지 못했습니다.');
  const server = await createPdfViewerServer({ moduleFolder: featureModulePaths(options).folder, pdfBytes: buffer, fileName: path.basename(target.real) });
  const window = new options.BrowserWindow({
    title: `${path.basename(target.real)} · ModyCrew PDF`, width: 1140, height: 860, minWidth: 640, minHeight: 480, show: false, autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, partition: `mody-pdf-${randomBytes(16).toString('hex')}`, spellcheck: false },
  });
  const session = window.webContents.session;
  session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.setPermissionCheckHandler(() => false);
  session.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !details.url.startsWith(`${server.origin}/`) && !/^(?:blob:|data:|devtools:)/u.test(details.url) }));
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => { if (url !== server.url) event.preventDefault(); });
  window.once('closed', () => { void server.close(); });
  try {
    await registerPdfCopySaving({ session, window, dialog: options.dialog, app: options.app, originalPath: target.real, originalInfo: target.info });
    await window.loadURL(server.url);
    window.show();
  } catch (error) {
    window.destroy();
    await server.close();
    throw error;
  }
  return { status: 'opened', userMessage: 'PDF 창에서 열었습니다. 주석을 달면 사본으로만 저장되고 원본은 바뀌지 않습니다.', ...baseResult };
}

async function renderPdfPage(target, payload, limits) {
  if (target.format.kind !== 'pdf') throw new ViewerError('unsupported', 'PDF 파일만 페이지 이미지를 만들 수 있습니다.');
  const page = Number(payload.page);
  if (!Number.isInteger(page) || page < 1 || page > 100000) throw new ViewerError('failed', '페이지 번호를 확인해 주세요.');
  const width = Math.min(1600, Math.max(480, Number(payload.width) || 1100));
  const { buffer } = await readVerified(target, limits.maxFileBytes);
  if (!buffer.subarray(0, 1024).includes(PDF_MAGIC)) throw new ViewerError('corrupt', 'PDF 문서인지 확인하지 못했습니다.');
  const PDFParse = await loadPdfParse();
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const shot = await withTimeout(parser.getScreenshot({ partial: [page], desiredWidth: width, imageDataUrl: true, imageBuffer: false }), limits.parseTimeoutMs);
    const image = shot.pages?.[0];
    if (!image || typeof image.dataUrl !== 'string' || !image.dataUrl.startsWith('data:image/png;base64,')) throw new ViewerError('failed', '페이지 이미지를 만들지 못했습니다.');
    return { status: 'ready', page, pageCount: shot.total, dataUrl: image.dataUrl, width: image.width, height: image.height, sensitiveMaskApplied: false, userMessage: '페이지 이미지는 원본 그대로라 민감정보를 가릴 수 없습니다.', ...baseResult };
  } catch (error) {
    if (isPdfPasswordError(error)) throw new ViewerError('protected', '암호가 걸린 PDF입니다. PDF 창에서 암호를 입력해 열어 주세요.');
    if (error instanceof ViewerError) throw error;
    throw new ViewerError('failed', '이 컴퓨터에서 페이지 이미지를 만들지 못했습니다. PDF 창에서 열어 확인해 주세요.');
  } finally { await parser.destroy().catch(() => {}); }
}

/**
 * IPC 진입점. kind: status | open | pick | pdf_page | diff | open_external | show_in_folder | open_pdf_viewer
 * options: { trustedOrigin(url), allowedRoots[], resolveAllowedRoots(payload, event), openPath(file), showItemInFolder(file),
 *            dialog, BrowserWindow, app, userDataPath, limits, trustedSender(내부 호출·테스트 전용) }
 */
export async function handleDocumentViewerMessage(event, payload = {}, options = {}) {
  try {
    assertTrustedSender(event, options);
    const limits = { ...DOCUMENT_VIEWER_LIMITS, ...(options.limits || {}) };
    const kind = payload?.kind;
    if (kind === 'status') {
      return {
        status: 'ready', userMessage: '문서를 앱 안에서 읽기 전용으로 볼 수 있습니다.', extensions: DOCUMENT_VIEWER_EXTENSIONS,
        capabilities: { pick: Boolean(options.dialog), openExternal: typeof options.openPath === 'function', showInFolder: typeof options.showItemInFolder === 'function', pdfViewer: Boolean(options.BrowserWindow && options.dialog), pdfPageImages: true },
        ...baseResult,
      };
    }
    if (kind === 'diff') {
      const roots = await viewerRoots(event, payload, options);
      const before = await diffSide(payload.before, roots, limits);
      const after = await diffSide(payload.after, roots, limits);
      const diff = computeLineDiff(before.text, after.text, { context: 3 });
      const shield = createSensitiveShield(payload.reveal !== true);
      for (const hunk of diff.hunks) for (const line of hunk.lines) line.text = shield.protect(line.text);
      return { status: 'ready', userMessage: diff.identical ? '두 내용이 같습니다.' : `${diff.added}줄 추가, ${diff.removed}줄 삭제`, diff, before: { label: before.label, sha256: before.sha256 }, after: { label: after.label, sha256: after.sha256 }, sensitive: shield.summary(), ...baseResult };
    }
    if (kind === 'pick') {
      if (!options.dialog?.showOpenDialog) return failure('unavailable', '설치된 ModyCrew 앱에서 파일을 고를 수 있습니다.');
      const owner = options.BrowserWindow?.fromWebContents?.(event?.sender) || undefined;
      const dialogOptions = { title: '앱에서 볼 문서 선택', properties: ['openFile'], filters: [{ name: '문서·표·이미지', extensions: [...DOCUMENT_VIEWER_EXTENSIONS] }, { name: '모든 파일', extensions: ['*'] }] };
      const selection = owner ? await options.dialog.showOpenDialog(owner, dialogOptions) : await options.dialog.showOpenDialog(dialogOptions);
      const chosen = selection?.filePaths?.[0];
      if (selection?.canceled || !chosen) return failure('cancelled', '파일 선택을 취소했습니다.');
      const info = await lstat(chosen);
      if (info.isSymbolicLink() || !info.isFile()) throw new ViewerError('denied', '바로가기(링크)가 아닌 일반 파일을 선택해 주세요.');
      grantPickedFile(event, await realpath(chosen));
      payload = { ...payload, path: chosen };
    }
    if (!['open', 'pick', 'pdf_page', 'file_info', 'list_apps', 'open_app', 'save_copy', 'open_with', 'open_external', 'show_in_folder', 'open_pdf_viewer'].includes(kind)) return failure('unsupported', '지원하지 않는 문서 보기 요청입니다.');
    const roots = await viewerRoots(event, payload, options);
    const target = await resolveAllowedFile(payload.path, roots);
    if (kind === 'file_info') {
      return { status: 'ready', userMessage: '저장된 파일을 확인했습니다.', file: fileInfo(target, target.info.size, target.info.mtimeMs),
        actions: {
          preview: (options.platform ?? process.platform) === 'win32' && DOCUMENT_VIEWER_EXTENSIONS.includes(target.format.extension),
          openExternal: EXTERNAL_OPEN_EXTENSIONS.has(target.format.extension) && typeof options.openPath === 'function',
          openWith: EXTERNAL_OPEN_EXTENSIONS.has(target.format.extension) && (options.platform ?? process.platform) === 'win32',
          showInFolder: typeof options.showItemInFolder === 'function',
          saveCopy: DOCUMENT_VIEWER_EXTENSIONS.includes(target.format.extension) && target.info.size <= limits.maxFileBytes && Boolean(options.dialog?.showSaveDialog),
        }, ...baseResult };
    }
    if (kind === 'save_copy') {
      if (!DOCUMENT_VIEWER_EXTENSIONS.includes(target.format.extension)) return failure('blocked', '이 형식은 사본 저장을 지원하지 않습니다.');
      if (!options.dialog?.showSaveDialog) return failure('unavailable', '설치된 앱에서 사본을 저장할 수 있습니다.');
      const selection = await options.dialog.showSaveDialog({ title: '파일 사본 저장', defaultPath: path.basename(target.real), filters: [{ name: target.format.label, extensions: [target.format.extension] }] });
      if (selection.canceled || !selection.filePath) return failure('cancelled', '사본 저장을 취소했습니다.');
      if (!path.isAbsolute(selection.filePath)) return failure('denied', '사본을 저장할 폴더를 다시 선택해 주세요.');
      const destination = path.resolve(selection.filePath);
      if (samePath(destination, target.real)) return failure('denied', '원본과 다른 이름이나 폴더를 선택해 주세요.');
      if (path.extname(destination).toLowerCase() !== path.extname(target.real).toLowerCase()) return failure('denied', '원본과 같은 파일 형식으로 저장해 주세요.');
      // 선택창을 열어 둔 사이 소스가 교체되거나 링크로 바뀌었는지도 다시 확인한다.
      const current = await resolveAllowedFile(payload.path, await viewerRoots(event, payload, options));
      const snapshot = await readVerified(current, limits.maxFileBytes);
      if (!snapshot.unchanged) return failure('changed', '파일이 바뀌고 있어 사본을 만들지 않았습니다. 다시 시도해 주세요.');
      let output;
      try {
        output = await open(destination, 'wx');
        await output.writeFile(snapshot.buffer);
      } catch (error) {
        if (error.code === 'EEXIST') return failure('denied', '같은 이름의 파일이 있습니다. 기존 파일을 덮어쓰지 않았으니 다른 이름을 선택해 주세요.');
        return failure('failed', '사본 저장을 마치지 못했습니다. 선택한 위치에 일부 사본이 남았을 수 있으니 확인해 주세요. 원본은 그대로입니다.');
      } finally { await output?.close(); }
      return { status: 'saved', userMessage: '선택한 위치에 사본을 저장했습니다. 원본은 그대로입니다.', ...baseResult };
    }
    if (kind === 'open' || kind === 'pick') return await withParseSlot(() => buildDocumentModel(target, limits, payload.reveal === true, options));
    if (kind === 'pdf_page') return await withParseSlot(() => renderPdfPage(target, payload, limits));
    if (kind === 'show_in_folder') {
      if (typeof options.showItemInFolder !== 'function') return failure('unavailable', '설치된 ModyCrew 앱에서 파일 위치를 열 수 있습니다.');
      await options.showItemInFolder(target.real);
      return { status: 'opened', userMessage: '파일 위치를 열었습니다.', ...baseResult };
    }
    if (kind === 'open_pdf_viewer') {
      if (target.format.kind !== 'pdf') return failure('unsupported', 'PDF 파일만 PDF 창에서 열 수 있습니다.');
      return await openPdfViewerWindow(target, options);
    }
    if (!EXTERNAL_OPEN_EXTENSIONS.has(target.format.extension)) return failure('blocked', '열면 실행될 수 있는 형식이라 앱 밖에서 열지 않았습니다. 파일 위치에서 직접 확인해 주세요.');
    if (kind === 'list_apps' || kind === 'open_app') {
      if ((options.platform ?? process.platform) !== 'win32') return failure('unavailable', '이 PC에서는 기본 앱으로 열기를 이용해 주세요.');
      const registry = options.appRegistry ?? documentAppRegistry;
      const extension = '.' + target.format.extension;
      if (kind === 'list_apps') {
        try {
          return { status: 'ready', userMessage: '', apps: await registry.list(event.sender, extension, options.getFileIcon), ...baseResult };
        } catch { return { status: 'unavailable', userMessage: '앱 목록을 확인하지 못했습니다. 기본 앱 또는 다른 앱 선택을 이용해 주세요.', apps: [], ...baseResult }; }
      }
      await registry.open(event.sender, extension, payload.appIndex, target.real);
      return { status: 'opened', userMessage: '선택한 앱으로 파일을 열었습니다.', ...baseResult };
    }
    if (kind === 'open_with') {
      if ((options.platform ?? process.platform) !== 'win32') return failure('unavailable', '이 PC에서는 앱 선택 대신 기본 프로그램으로 열기를 이용해 주세요.');
      await (options.chooseApp ?? chooseDocumentApp)(target.real);
      return { status: 'opened', userMessage: 'Windows 앱 선택 창을 열었습니다. 사용할 프로그램을 선택해 주세요.', ...baseResult };
    }
    if (typeof options.openPath !== 'function') return failure('unavailable', '설치된 ModyCrew 앱에서 기본 프로그램으로 열 수 있습니다.');
    const error = await options.openPath(target.real);
    if (error) return failure('failed', '기본 프로그램으로 열지 못했습니다. 연결된 프로그램이 있는지 확인해 주세요.');
    return { status: 'opened', userMessage: '기본 프로그램으로 열었습니다. 그 프로그램에서 저장하면 원본이 바뀔 수 있습니다.', ...baseResult };
  } catch (error) {
    if (error instanceof ViewerError) return failure(error.status, error.userMessage);
    return failure('failed', '문서를 열지 못했습니다. 잠시 후 다시 시도해 주세요.');
  }
}

/** main.mjs 가 쓰는 허용 폴더 목록: 작업 기억 폴더·연결된 프로젝트 폴더·앱 결과 폴더·만든 문서 폴더. */
export async function workspaceDocumentRoots({ workspaceRoot, loadWorkspace, deliverablesRoot, documentsRoot, extraRoots = [] } = {}) {
  const roots = [];
  if (typeof loadWorkspace === 'function') {
    const loaded = await loadWorkspace(typeof workspaceRoot === 'string' && workspaceRoot ? workspaceRoot : undefined);
    if (loaded?.status === 'work_session_workspace_loaded' && typeof loaded.root === 'string' && loaded.root) {
      roots.push({ path: loaded.root, label: '작업 기억 폴더', kind: 'memory' });
      for (const project of loaded.workspace?.projects || []) {
        if (project?.archivedAt || typeof project?.sourceFolder !== 'string' || !path.isAbsolute(project.sourceFolder)) continue;
        roots.push({ path: project.sourceFolder, label: project.name ? `프로젝트 폴더 · ${String(project.name).slice(0, 60)}` : '프로젝트 폴더', kind: 'project' });
      }
    }
  }
  if (typeof deliverablesRoot === 'string' && deliverablesRoot) roots.push({ path: deliverablesRoot, label: '앱 결과 폴더', kind: 'results' });
  if (typeof documentsRoot === 'string' && documentsRoot) roots.push({ path: documentsRoot, label: '만든 문서', kind: 'documents' });
  return [...roots, ...extraRoots];
}

