import { mkdir, readFile, writeFile, readdir, rename, lstat, realpath, open, stat } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { extractOfficeText, loadSafeZip } from '../document-production/template-files.mjs';
import { nativeOffice } from '../document-production/native-office.mjs';
import { redactCompanyText, COMPANY_PRIVACY_NOTICE } from './privacy.mjs';

export const clean = (value, max = 2000) => typeof value === 'string' ? value.replace(/\u0000/gu, '').trim().slice(0, max) : '';
export const digest = (value) => createHash('sha256').update(value).digest('hex');
export const companyRoot = (options) => options.companyRoot || path.join(options.app.getPath('userData'), 'company-automation');
export async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(value, null, 2), { flag: 'wx' });
  await rename(temp, file);
}
export async function readJson(file, fallback) {
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT' && fallback !== undefined) return fallback; throw new Error('저장된 회사 기록을 읽지 못했습니다. 원본을 보존한 채 복구가 필요합니다.'); }
}
const validId = (id) => /^[a-f0-9-]{36}$/u.test(id || '');
// Record files hold the whole extracted text and tables (a ledger can be tens of MB), but listing
// needs only the summary. Summaries are cached in memory per file and re-read when the file's
// modification time or size changes, so every writer (import, handover transfer) stays correct.
const recordSummaryCache = new Map();
const RECORD_SUMMARY_CACHE_LIMIT = 5000;
async function readRecordSummary(file) {
  let info;
  try { info = await stat(file); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  const cached = recordSummaryCache.get(file);
  if (cached && cached.mtimeMs === info.mtimeMs && cached.size === info.size) return structuredClone(cached.summary);
  const { text, tables, ...summary } = await readJson(file);
  recordSummaryCache.delete(file);
  recordSummaryCache.set(file, { mtimeMs: info.mtimeMs, size: info.size, summary });
  while (recordSummaryCache.size > RECORD_SUMMARY_CACHE_LIMIT) recordSummaryCache.delete(recordSummaryCache.keys().next().value);
  return structuredClone(summary);
}
export async function listCompanyRecords(options = {}) {
  const folder = path.join(companyRoot(options), 'records');
  let names;
  try { names = await readdir(folder); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const files = names.filter((name) => /^[a-f0-9-]{36}\.json$/u.test(name)).map((name) => path.join(folder, name));
  const present = new Set(files);
  for (const file of recordSummaryCache.keys()) if (path.dirname(file) === folder && !present.has(file)) recordSummaryCache.delete(file);
  return (await Promise.all(files.map(readRecordSummary))).filter(Boolean).sort((a, b) => b.importedAt.localeCompare(a.importedAt));
}
export async function readCompanyRecord(id, options = {}) {
  if (!validId(id)) throw new Error('회사 자료를 다시 선택해 주세요.');
  const record = await readJson(path.join(companyRoot(options), 'records', `${id}.json`));
  const buffer = await readFile(path.join(companyRoot(options), 'originals', id));
  if (digest(buffer) !== record.hash || digest(record.text) !== record.textHash || digest(JSON.stringify(record.tables)) !== record.tablesHash) throw new Error('자료 사본이 변경됐습니다. 원본을 다시 가져와 주세요.');
  return record;
}

export function parseCsv(input) {
  const rows = []; let row = []; let field = ''; let quoted = false;
  for (let i = 0; i < input.length; i += 1) {
    const c = input[i];
    if (c === '"' && (quoted || field === '')) { if (quoted && input[i + 1] === '"') { field += '"'; i += 1; } else quoted = !quoted; }
    else if (c === ',' && !quoted) { row.push(field); field = ''; }
    else if ((c === '\n' || c === '\r') && !quoted) { if (c === '\r' && input[i + 1] === '\n') i += 1; row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (quoted) throw new Error('CSV 따옴표가 닫히지 않았습니다. Excel에서 CSV UTF-8로 다시 저장해 주세요.');
  if (field || row.length) { row.push(field); rows.push(row); }
  if (rows.length > 10001 || rows.some((r) => r.length > 100)) throw new Error('회계 자료는 한 번에 10,000행, 100열까지 가져올 수 있습니다.');
  return rows;
}

async function extract(file, buffer, options) {
  const format = path.extname(file).slice(1).toLowerCase(); let text = ''; const tables = [];
  if (['txt', 'md', 'csv'].includes(format)) {
    const decoded = new TextDecoder('utf-8', { fatal: true });
    try { text = decoded.decode(buffer); } catch { throw new Error('텍스트 파일을 UTF-8로 저장한 다음 가져와 주세요.'); }
    if (format === 'csv') tables.push({ name: 'CSV', rows: parseCsv(text) });
  } else if (format === 'xlsx') {
    await loadSafeZip(buffer); const { default: ExcelJS } = await import('exceljs'); const book = new ExcelJS.Workbook(); await book.xlsx.load(buffer);
    for (const sheet of book.worksheets) {
      if (sheet.rowCount > 10001 || sheet.columnCount > 100) throw new Error('시트는 한 번에 10,000행, 100열까지 가져올 수 있습니다.');
      const rows = []; const unresolvedFormulas = [];
      for (let n = 1; n <= sheet.rowCount; n += 1) {
        const row = sheet.getRow(n); const cells = [];
        for (let col = 1; col <= Math.min(sheet.columnCount, 100); col += 1) {
          const cell = row.getCell(col);
          if (cell.formula && cell.result === undefined) unresolvedFormulas.push(cell.address);
          const value = cell.value instanceof Date ? cell.value.toISOString().slice(0, 10) : cell.text;
          cells.push(clean(String(value ?? ''), 3000));
        }
        rows.push(cells);
      }
      tables.push({ name: sheet.name, rows, unresolvedFormulas });
    }
    text = tables.map((t) => `[${t.name}]\n${t.rows.map((r, i) => `${i + 1}: ${r.join(' | ')}`).join('\n')}`).join('\n\n');
  } else if (format === 'hwp') text = (await (options.nativeOffice || nativeOffice)({ action: 'hancom', input: file, inputFormat: 'HWP' })).text;
  else if (format === 'pdf') {
    const { PDFParse } = await import('pdf-parse'); const parser = new PDFParse({ data: buffer });
    try { text = (await parser.getText()).text; } finally { await parser.destroy(); }
  } else if (['docx', 'pptx', 'hwpx'].includes(format)) text = await extractOfficeText(buffer, format);
  else throw new Error('지원하지 않는 회사 자료 형식입니다.');
  text = clean(text, 2000000);
  if (!text) throw new Error('읽을 수 있는 본문이 없습니다. 스캔 문서는 OCR로 텍스트를 추출한 파일을 가져와 주세요.');
  return { format, text, tables };
}

const COMPANY_FORMATS = ['docx', 'pptx', 'xlsx', 'pdf', 'hwpx', 'hwp', 'csv', 'txt', 'md'];
const EXCLUDED_FOLDERS = new Set(['node_modules', 'dist', 'build', 'out', 'coverage', 'vendor', '__pycache__', 'target', 'bin', 'obj', 'packages-cache']);
const execFileAsync = promisify(execFile);
const hiddenFolderScript = Buffer.from(`$ErrorActionPreference = 'Stop'
$folder = [System.IO.DirectoryInfo]::new($env:MODYCREW_COMPANY_IMPORT_DIRECTORY)
$mask = [System.IO.FileAttributes]::Hidden -bor [System.IO.FileAttributes]::System -bor [System.IO.FileAttributes]::ReparsePoint
$names = @($folder.EnumerateFileSystemInfos() | Where-Object { ($_.Attributes -band $mask) -ne 0 } | ForEach-Object { $_.Name })
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
ConvertTo-Json -InputObject @{ excluded = $names; rootExcluded = (($folder.Attributes -band $mask) -ne 0) } -Compress`, 'utf16le').toString('base64');
async function hiddenFolderEntries(folder, deadline) {
  if (process.platform !== 'win32') return new Set();
  try {
    // Fixed read-only code; the selected path is data and never shell source.
    const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', hiddenFolderScript], { windowsHide: true, timeout: Math.max(1, Math.min(10000, deadline - Date.now())), maxBuffer: 256 * 1024, encoding: 'utf8', env: { ...process.env, MODYCREW_COMPANY_IMPORT_DIRECTORY: folder } });
    const value = JSON.parse(stdout.replace(/^\uFEFF/u, ''));
    if (value.rootExcluded || !Array.isArray(value.excluded)) throw new Error('hidden directory');
    return new Set(value.excluded);
  } catch {
    if (Date.now() >= deadline) return null;
    throw new Error('폴더의 숨김·시스템 속성을 확인하지 못했습니다. 일반 폴더를 다시 선택해 주세요.');
  }
}
function isInside(root, file) {
  const relative = path.relative(root, file);
  return !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`);
}
async function collectCompanyFolder(folder) {
  const deadline = Date.now() + 30000; let visitedFolders = 0;
  const rootInfo = await lstat(folder);
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) throw new Error('바로가기나 연결된 폴더 대신 실제 회사 자료 폴더를 선택해 주세요.');
  if (path.basename(folder).startsWith('.') || EXCLUDED_FOLDERS.has(path.basename(folder).toLowerCase())) throw new Error('숨김·빌드·의존성 폴더는 가져오지 않습니다. 회사 자료 폴더를 선택해 주세요.');
  const root = await realpath(folder); const files = []; let visited = 0; let skippedCount = 0; let limitReached = false; let depthLimited = false;
  const pending = [{ folder: root, depth: 0 }];
  while (pending.length && !limitReached) {
    if (Date.now() >= deadline || visitedFolders >= 50) { limitReached = true; break; }
    const current = pending.shift();
    if ((await lstat(current.folder)).isSymbolicLink() || !isInside(root, await realpath(current.folder))) { skippedCount += 1; continue; }
    visitedFolders += 1;
    const excluded = await hiddenFolderEntries(current.folder, deadline);
    if (!excluded || Date.now() >= deadline) { limitReached = true; break; }
    const entries = (await readdir(current.folder, { withFileTypes: true })).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    for (const entry of entries) {
      if (Date.now() >= deadline) { limitReached = true; break; }
      visited += 1;
      if (visited > 2000) { limitReached = true; break; }
      if (entry.name.startsWith('.') || entry.name.startsWith('~$') || excluded.has(entry.name) || entry.isSymbolicLink()) { skippedCount += 1; continue; }
      const file = path.join(current.folder, entry.name); const info = await lstat(file);
      if (info.isSymbolicLink() || !isInside(root, await realpath(file))) { skippedCount += 1; continue; }
      if (info.isDirectory()) {
        if (EXCLUDED_FOLDERS.has(entry.name.toLowerCase())) { skippedCount += 1; continue; }
        if (current.depth >= 5) { skippedCount += 1; depthLimited = true; continue; }
        pending.push({ folder: file, depth: current.depth + 1 });
      } else if (info.isFile() && COMPANY_FORMATS.includes(path.extname(entry.name).slice(1).toLowerCase())) {
        if (files.length === 20) { limitReached = true; break; }
        files.push({ file, sourceRelativePath: path.relative(root, file).split(path.sep).join('/') });
      } else skippedCount += 1;
    }
  }
  if (!files.length) throw new Error('가져올 수 있는 회사 자료가 없습니다. 지원 문서가 있는 더 작은 폴더를 선택해 주세요.');
  return { root, files, skippedCount, limitReached: limitReached || depthLimited };
}
export async function importCompanyRecords(options = {}, request = {}) {
  const mode = request.selection ?? 'files';
  if (!['files', 'folder'].includes(mode)) throw new Error('자료 선택 방식을 다시 확인해 주세요.');
  const selection = await options.dialog.showOpenDialog(mode === 'folder'
    ? { title: '회사 자료 폴더 가져오기 · 지원 문서 최대 20개', properties: ['openDirectory'] }
    : { title: '회사 기존 문서·장부·증빙 가져오기', properties: ['openFile', 'multiSelections'], filters: [{ name: '회사 자료', extensions: COMPANY_FORMATS }] });
  const importSummary = { selection: mode, importedCount: 0, skippedCount: 0, limitReached: false };
  if (selection.canceled) return { cancelled: true, records: [], importedSourceIds: [], importSummary };
  if (!Array.isArray(selection.filePaths) || !selection.filePaths.length || selection.filePaths.length > (mode === 'folder' ? 1 : 20)) throw new Error('파일은 1~20개, 폴더는 한 개를 선택해 주세요.');
  const collected = mode === 'folder' ? await collectCompanyFolder(selection.filePaths[0]) : { files: selection.filePaths.map((file) => ({ file })), skippedCount: 0, limitReached: false };
  Object.assign(importSummary, { skippedCount: collected.skippedCount, limitReached: collected.limitReached });
  // Complete extraction first. A bad source never leaves a misleading partial import.
  const staged = [];
  let bytes = 0;
  for (const { file, sourceRelativePath } of collected.files) {
    const info = await lstat(file); bytes += info.size;
    if (info.isSymbolicLink() || (collected.root && !isInside(collected.root, await realpath(file)))) throw new Error('연결된 파일은 가져올 수 없습니다. 실제 회사 자료를 선택해 주세요.');
    if (!info.isFile() || info.size > 32 * 1024 * 1024 || bytes > 128 * 1024 * 1024) throw new Error('파일당 32MB, 한 번에 총 128MB까지 가져올 수 있습니다.');
    const handle = await open(file, 'r'); let buffer;
    try {
      const opened = await handle.stat();
      if (!opened.isFile() || opened.dev !== info.dev || opened.ino !== info.ino || opened.size !== info.size) throw new Error('가져오는 중 자료가 바뀌었습니다. 다시 선택해 주세요.');
      const bounded = Buffer.alloc(info.size + 1); let offset = 0;
      while (offset < bounded.length) {
        const { bytesRead } = await handle.read(bounded, offset, bounded.length - offset, offset);
        if (!bytesRead) break;
        offset += bytesRead;
      }
      buffer = bounded.subarray(0, offset);
      const after = await handle.stat();
      if (buffer.length !== info.size || after.mtimeMs !== info.mtimeMs || after.size !== info.size) throw new Error('가져오는 중 자료가 바뀌었습니다. 다시 선택해 주세요.');
    } finally { await handle.close(); }
    const extracted = await extract(file, buffer, options);
    staged.push({ buffer, name: path.basename(file), ...(sourceRelativePath ? { sourceRelativePath } : {}), ...extracted });
  }
  const existing = await listCompanyRecords(options); const records = [];
  for (const item of staged) {
    const hash = digest(item.buffer); const previous = existing.find((r) => r.hash === hash);
    if (previous) { records.push(previous); continue; }
    const { buffer, ...data } = item; const id = randomUUID();
    const record = { ...data, id, hash, textHash: digest(data.text), tablesHash: digest(JSON.stringify(data.tables)), bytes: buffer.length, importedAt: new Date().toISOString(), version: 1 + Math.max(0, ...existing.filter((r) => r.name === item.name).map((r) => r.version)), tableNames: data.tables.map((t) => t.name) };
    await mkdir(path.join(companyRoot(options), 'originals'), { recursive: true });
    await writeFile(path.join(companyRoot(options), 'originals', id), buffer, { flag: 'wx' });
    await writeJson(path.join(companyRoot(options), 'records', `${id}.json`), record);
    const { text, tables, ...summary } = record; records.push(summary); existing.push(summary);
  }
  const uniqueRecords = [...new Map(records.map((record) => [record.id, record])).values()];
  importSummary.importedCount = uniqueRecords.length;
  return { records: uniqueRecords, importedSourceIds: uniqueRecords.map((record) => record.id), importSummary };
}

export function explicitCompanySourceIds(sourceIds) {
  if (!Array.isArray(sourceIds) || sourceIds.length > 200 || sourceIds.some((id) => !validId(id))) throw new Error('AI가 참고할 회사 자료를 명시적으로 다시 선택해 주세요.');
  return [...new Set(sourceIds)].sort();
}

export async function readSelectedCompanyRecords(sourceIds, options = {}) {
  const ids = explicitCompanySourceIds(sourceIds);
  return Promise.all(ids.map((id) => readCompanyRecord(id, options)));
}

export const companyRecordReference = ({ id, hash, textHash, tablesHash, version }) => ({ id, hash, textHash, tablesHash, version });

export async function companyContext({ query = '', sourceIds, limit = 6, excerptChars = 9000, totalChars } = {}, options = {}) {
  const candidates = await readSelectedCompanyRecords(sourceIds, options);
  if (!Number.isInteger(limit) || limit < 1 || limit > 20 || !Number.isInteger(excerptChars) || excerptChars < 500 || excerptChars > 9000 || (totalChars !== undefined && (!Number.isInteger(totalChars) || totalChars < 1000 || totalChars > 90000))) throw new Error('회사 자료 발췌 범위를 다시 확인해 주세요.');
  const words = clean(query, 500).toLowerCase().split(/\s+/u).filter((s) => s.length > 1);
  // Rank exact material matches; no invented facts or implicit access to other folders.
  const ranked = candidates.map((r) => ({ record: r, score: words.reduce((n, w) => n + (r.name.toLowerCase().includes(w) ? 5 : 0) + (r.text.toLowerCase().includes(w) ? 1 : 0), 0) }));
  const selected = ranked.sort((a, b) => b.score - a.score).slice(0, limit).map(({ record }) => record);
  let redactionCount = 0; const categories = new Set();
  const redact = (value) => { const result = redactCompanyText(value); redactionCount += result.redactionCount; result.categories.forEach((category) => categories.add(category)); return result.text; };
  const records = selected.map(({ id, name, hash, version, sourceRelativePath }) => ({ id, name: redact(name), hash, version, ...(sourceRelativePath ? { sourceRelativePath: redact(sourceRelativePath) } : {}) }));
  // Include separators and headings in the total budget, giving every selected source a slot.
  const sourceBudget = totalChars === undefined ? Infinity : Math.floor((totalChars - Math.max(0, selected.length - 1) * 2) / Math.max(1, selected.length));
  const text = selected.map((r, index) => {
    // Redact before slicing so a credential crossing an excerpt boundary cannot leak.
    const safeText = redact(r.text);
    const at = words.map((w) => safeText.toLowerCase().indexOf(w)).filter((n) => n >= 0).sort((a, b) => a - b)[0] || 0;
    const start = Math.max(0, at - 800);
    let header = `[회사 원본: ${records[index].name} / 자료 ID:${r.id} / v${r.version} / SHA256:${r.hash} / 정제본문 문자 ${start + 1}부터${records[index].sourceRelativePath ? ` / 폴더 내 위치: ${records[index].sourceRelativePath}` : ''}]`;
    const headerBudget = Math.floor(sourceBudget * 0.45);
    if (header.length > headerBudget) {
      const suffix = ' / 제목·경로 축약]'; const prefix = `[회사 원본: ${r.id} `;
      header = headerBudget > prefix.length + suffix.length
        ? `${prefix}${`${records[index].name}${records[index].sourceRelativePath ? ` / ${records[index].sourceRelativePath}` : ''}`.slice(0, headerBudget - prefix.length - suffix.length)}${suffix}`
        : `[${r.id}·축약]`;
    }
    // Even the minimum budget retains the complete UUID and at least one body character.
    const truncatedNotice = sourceBudget - header.length > 20 ? '\n[본문 발췌: 일부만 포함]' : '\n[발췌]';
    const available = Math.min(excerptChars, sourceBudget - header.length - 1);
    const needsNotice = start > 0 || safeText.length - start > available;
    const excerpt = safeText.slice(start, start + Math.max(1, needsNotice ? Math.min(excerptChars, sourceBudget - header.length - 1 - truncatedNotice.length) : available));
    const truncated = start > 0 || start + excerpt.length < safeText.length;
    return `${header}\n${excerpt}${truncated ? truncatedNotice : ''}`;
  }).join('\n\n');
  return { records, text, sourceRefs: candidates.map(companyRecordReference), privacy: { redactionCount, categories: [...categories].sort(), notice: COMPANY_PRIVACY_NOTICE } };
}
