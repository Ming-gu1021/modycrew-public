import path from 'node:path';
import { mkdir, readFile, writeFile, lstat, realpath, unlink } from 'node:fs/promises';
import { randomUUID, randomBytes, scrypt as scryptCallback, createCipheriv, createDecipheriv } from 'node:crypto';
import { promisify } from 'node:util';
import { companyRoot, digest, readJson, readCompanyRecord } from './company-records.mjs';
import { loadHandoverStore, mutateHandoverStore } from './handover.mjs';

const scrypt = promisify(scryptCallback);
const MAGIC = 'ModyCrew.Handover.Transfer';
const AAD = Buffer.from(`${MAGIC}:1:AES-256-GCM:scrypt:32768:8:1`, 'utf8');
const MiB = 1024 * 1024;
const MAX_CONTENT = 64 * MiB;
const MAX_PAYLOAD = 96 * MiB;
const MAX_PACKAGE = 128 * MiB;
const TTL = 10 * 60 * 1000;
const previews = new Map();
const formats = new Set(['docx', 'pptx', 'xlsx', 'pdf', 'hwpx', 'hwp', 'csv', 'txt', 'md']);
const exclusions = Object.freeze(['로그인 계정·비밀번호·토큰·브라우저 프로필', '회사 조직 설정·자동화 규칙·실행 중인 업무', '견적 승인·발송 상태와 기존 인수인계의 승인·질문·완료 기록']);
const fail = (message = '이전 묶음의 형식이나 자료 검증에 실패했습니다.') => { throw new Error(message); };
const now = (options) => options.transferNow?.() ?? Date.now();
const rootKey = (options) => { const value = path.resolve(companyRoot(options)); return process.platform === 'win32' ? value.toLowerCase() : value; };
function removePreview(token, erase = true) {
  const preview = previews.get(token);
  if (!preview) return;
  clearTimeout(preview.timer); previews.delete(token);
  if (erase) for (const { original } of preview.payload.records) original.fill(0);
}
const uuid = (value) => typeof value === 'string' && /^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/u.test(value);
const hash = (value) => typeof value === 'string' && /^[a-f\d]{64}$/u.test(value);
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
function text(value, max, required = false) {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) fail();
  return value;
}
function date(value) { text(value, 40, true); if (!Number.isFinite(Date.parse(value))) fail(); return value; }
function positive(value) { if (!Number.isSafeInteger(value) || value < 1) fail(); return value; }
function array(value, max) { if (!Array.isArray(value) || value.length > max) fail(); return value; }
function sender(options) { if (!Number.isSafeInteger(options.senderId) || options.senderId <= 0) fail('앱의 인수인계 화면에서 이전을 진행해 주세요.'); return options.senderId; }
function passwordValue(value) {
  if (typeof value !== 'string' || !value.trim() || [...value].length < 12 || [...value].length > 128 || Buffer.byteLength(value, 'utf8') > 512 || /[\u0000-\u001f\u007f]/u.test(value)) fail('이전 암호는 공백을 포함할 수 있는 12~128자로 입력해 주세요. 제어 문자는 사용할 수 없습니다.');
  return value;
}
function base64(value, maxBytes, exactBytes) {
  // Repeating four-character groups can exhaust V8's regexp stack on ordinary multi-MiB office files.
  if (typeof value !== 'string' || value.length > Math.ceil(maxBytes / 3) * 4 || value.length % 4 || !/^[A-Za-z\d+/]*={0,2}$/u.test(value)) fail();
  const result = Buffer.from(value, 'base64');
  if (result.length > maxBytes || (exactBytes !== undefined && result.length !== exactBytes) || result.toString('base64') !== value) fail();
  return result;
}
function parse(input) {
  let value;
  try { value = JSON.parse(input); } catch { fail(); }
  const pending = [{ value, depth: 0 }]; let count = 0;
  while (pending.length) {
    const item = pending.pop();
    if (++count > 2000000 || item.depth > 12) fail();
    if (!item.value || typeof item.value !== 'object') continue;
    if (!Array.isArray(item.value) && !object(item.value)) fail();
    for (const [key, child] of Object.entries(item.value)) {
      if (['__proto__', 'prototype', 'constructor'].includes(key)) fail();
      if (child && typeof child === 'object') pending.push({ value: child, depth: item.depth + 1 });
    }
  }
  return value;
}
function tableValue(table) {
  if (!object(table)) fail();
  const result = { name: text(table.name, 500, true), rows: array(table.rows, 10001).map((row) => array(row, 100).map((cell) => text(cell, 2000000))) };
  if (table.unresolvedFormulas !== undefined) result.unresolvedFormulas = array(table.unresolvedFormulas, 1000100).map((cell) => text(cell, 50, true));
  return result;
}
function recordValue(value) {
  if (!object(value) || !uuid(value.id) || !formats.has(value.format) || !hash(value.hash) || !hash(value.textHash) || !hash(value.tablesHash)) fail();
  const name = text(value.name, 240, true);
  if (name === '.' || name === '..' || /[\\/:\u0000-\u001f\u007f]/u.test(name)) fail();
  const tables = array(value.tables, 100).map(tableValue);
  const record = { id: value.id, name, format: value.format, hash: value.hash, textHash: value.textHash, tablesHash: value.tablesHash, bytes: value.bytes, version: positive(value.version), importedAt: date(value.importedAt), text: text(value.text, 2000000, true), tables, tableNames: tables.map((table) => table.name) };
  if (!Number.isSafeInteger(record.bytes) || record.bytes < 0 || record.bytes > 32 * MiB || digest(record.text) !== record.textHash || digest(JSON.stringify(record.tables)) !== record.tablesHash) fail('이전 묶음의 본문 또는 표 해시가 일치하지 않습니다.');
  return record;
}
function handoverValue(value) {
  if (!object(value) || !uuid(value.id) || !['replacement', 'new_hire', 'device_move'].includes(value.purpose)) fail();
  const sourceIds = array(value.sourceIds, 20);
  if (sourceIds.some((id) => !uuid(id)) || new Set(sourceIds).size !== sourceIds.length) fail();
  const sourceEvidence = array(value.sourceEvidence, 20).map((entry) => {
    if (!object(entry) || !uuid(entry.id) || !hash(entry.hash) || !hash(entry.textHash) || !hash(entry.tablesHash)) fail();
    return { id: entry.id, name: text(entry.name, 240, true), hash: entry.hash, textHash: entry.textHash, tablesHash: entry.tablesHash, version: positive(entry.version) };
  });
  if (sourceEvidence.length !== sourceIds.length || new Set(sourceEvidence.map((entry) => entry.id)).size !== sourceIds.length || sourceEvidence.some((entry) => !sourceIds.includes(entry.id))) fail();
  return {
    id: value.id, title: text(value.title, 160, true), fromPerson: text(value.fromPerson ?? '', 100), purpose: value.purpose, summary: text(value.summary ?? '', 6000), sourceIds: [...sourceIds], sourceEvidence,
    workSnapshots: array(value.workSnapshots ?? [], 30).map((work) => {
      if (!object(work)) fail();
      return { id: text(work.id, 200, true), request: text(work.request ?? '', 10000), status: text(work.status ?? '', 60), result: text(work.result ?? '', 12000), createdAt: date(work.createdAt) };
    }),
    steps: array(value.steps ?? [], 100).map((step) => { if (!object(step) || !uuid(step.id)) fail(); return { id: step.id, text: text(step.text, 2000, true) }; }),
  };
}
function packageValue(input) {
  if (!object(input) || input.version !== 1 || !uuid(input.packageId)) fail('지원하지 않는 이전 묶음 버전입니다.');
  const handover = handoverValue(input.handover);
  let contentBytes = 0;
  const records = array(input.records, 20).map((entry) => {
    if (!object(entry)) fail();
    const record = recordValue(entry.record);
    const original = base64(entry.originalBase64, 32 * MiB, record.bytes);
    if (digest(original) !== record.hash) fail('이전 묶음의 원본 파일 해시가 일치하지 않습니다.');
    const evidence = handover.sourceEvidence.find((source) => source.id === record.id);
    if (!evidence || ['name', 'hash', 'textHash', 'tablesHash', 'version'].some((key) => evidence[key] !== record[key])) fail('인수인계가 참조하는 자료 버전이 일치하지 않습니다.');
    contentBytes += original.length + Buffer.byteLength(JSON.stringify(record), 'utf8');
    if (contentBytes > MAX_CONTENT) fail('이전할 원본과 추출 자료는 합계 64MiB까지 지원합니다.');
    return { record, original };
  });
  if (records.length !== handover.sourceIds.length || new Set(records.map((entry) => entry.record.id)).size !== records.length) fail();
  return { version: 1, packageId: input.packageId, companyName: text(input.companyName, 200), exportedAt: date(input.exportedAt), handover, records, contentBytes };
}
async function folders(options, create = false) {
  const root = path.resolve(companyRoot(options));
  if (create) await mkdir(root, { recursive: true });
  const canonical = await realpath(root);
  for (const name of ['originals', 'records']) {
    const folder = path.join(root, name);
    if (create) await mkdir(folder, { recursive: true });
    const info = await lstat(folder);
    const relative = path.relative(canonical, await realpath(folder));
    if (!info.isDirectory() || info.isSymbolicLink() || relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) fail('회사 자료 폴더의 경로를 확인해 주세요.');
  }
  return root;
}
async function originalFile(id, options, remainingBytes) {
  let sourceBytes = 0;
  for (const file of [path.join(companyRoot(options), 'originals', id), path.join(companyRoot(options), 'records', `${id}.json`)]) {
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink() || info.size > (path.extname(file) === '.json' ? MAX_CONTENT : 32 * MiB)) fail('회사 자료 사본의 경로와 크기를 확인해 주세요.');
    sourceBytes += info.size;
    if (sourceBytes > remainingBytes) fail('이전할 원본과 추출 자료는 합계 64MiB까지 지원합니다.');
  }
  const original = await readFile(path.join(companyRoot(options), 'originals', id));
  if (original.length > 32 * MiB) fail('이전할 원본은 파일당 32MiB까지 지원합니다.');
  if (original.length > remainingBytes) fail('이전할 원본과 추출 자료는 합계 64MiB까지 지원합니다.');
  return { original, sourceBytes };
}
async function keyFor(password, salt) { return scrypt(password, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * MiB }); }
async function encrypt(payload, password) {
  const plaintext = Buffer.from(JSON.stringify(payload), 'utf8');
  if (plaintext.length > MAX_PAYLOAD) fail('이전 묶음이 너무 큽니다. 자료를 나누어 선택해 주세요.');
  const salt = randomBytes(32); const iv = randomBytes(12); const key = await keyFor(password, salt);
  try {
    const cipher = createCipheriv('aes-256-gcm', key, iv); cipher.setAAD(AAD);
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return Buffer.from(JSON.stringify({ magic: MAGIC, version: 1, cipher: 'AES-256-GCM', kdf: 'scrypt', N: 32768, r: 8, p: 1, salt: salt.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: encrypted.toString('base64') }), 'utf8');
  } finally { key.fill(0); plaintext.fill(0); }
}
async function decrypt(buffer, password) {
  if (buffer.length > MAX_PACKAGE) fail('이전 파일이 허용 크기 128MiB를 초과했습니다.');
  const envelope = parse(buffer.toString('utf8'));
  if (!object(envelope) || Object.keys(envelope).sort().join(',') !== 'N,cipher,data,iv,kdf,magic,p,r,salt,tag,version' || envelope.magic !== MAGIC || envelope.version !== 1 || envelope.cipher !== 'AES-256-GCM' || envelope.kdf !== 'scrypt' || envelope.N !== 32768 || envelope.r !== 8 || envelope.p !== 1) fail('지원하지 않는 이전 묶음 버전 또는 암호화 방식입니다.');
  const salt = base64(envelope.salt, 32, 32); const iv = base64(envelope.iv, 12, 12); const tag = base64(envelope.tag, 16, 16); const data = base64(envelope.data, MAX_PAYLOAD);
  const key = await keyFor(password, salt); let plaintext;
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv); decipher.setAAD(AAD); decipher.setAuthTag(tag);
    try { plaintext = Buffer.concat([decipher.update(data), decipher.final()]); } catch { fail('암호가 다르거나 이전 파일이 변경됐습니다. 암호와 파일을 다시 확인해 주세요.'); }
    return { payload: packageValue(parse(plaintext.toString('utf8'))), payloadHash: digest(plaintext) };
  } finally { key.fill(0); plaintext?.fill(0); }
}

/** The native picker is the only source of export paths. Selected company records are copied, never moved. */
export async function exportHandoverPackage({ id, expectedRevision, password, approved } = {}, options = {}) {
  sender(options); passwordValue(password);
  if (approved !== true) fail('선택한 회사 자료를 이전할 권한과 범위를 확인하고 승인해 주세요.');
  if (!uuid(id)) fail('이전할 인수인계를 선택해 주세요.');
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) fail('내보낼 인수인계의 수정 번호를 확인해 주세요.');
  const handover = (await loadHandoverStore(options)).handovers.find((entry) => entry.id === id);
  if (!handover) fail('이전할 인수인계를 찾지 못했습니다.');
  if (handover.revision !== expectedRevision) fail('다른 창에서 인계 내용이나 자료가 변경됐습니다. 새로고침 후 이전 범위를 다시 확인해 주세요.');
  const assertCurrentRevision = async () => {
    const current = (await loadHandoverStore(options)).handovers.find((entry) => entry.id === id);
    if (!current || current.revision !== expectedRevision) fail('다른 창에서 인계 내용이나 자료가 변경됐습니다. 새로고침 후 이전 범위를 다시 확인해 주세요.');
  };
  const selected = handoverValue(handover);
  if (selected.sourceIds.length) await folders(options);
  const records = []; let totalSourceBytes = 0;
  for (const recordId of selected.sourceIds) {
    const { original, sourceBytes } = await originalFile(recordId, options, MAX_CONTENT - totalSourceBytes);
    const record = recordValue(await readCompanyRecord(recordId, options));
    totalSourceBytes += Math.max(sourceBytes, original.length + Buffer.byteLength(JSON.stringify(record), 'utf8'));
    if (totalSourceBytes > MAX_CONTENT) fail('이전할 원본과 추출 자료는 합계 64MiB까지 지원합니다.');
    records.push({ record, originalBase64: original.toString('base64') });
  }
  const state = options.companyName === undefined ? await readJson(path.join(companyRoot(options), 'state.json'), {}) : null;
  const payload = { version: 1, packageId: randomUUID(), companyName: options.companyName ?? state.companyName ?? '', exportedAt: new Date(now(options)).toISOString(), handover: selected, records };
  packageValue(payload);
  const fileName = `${selected.title.replace(/[<>:"/\\|?*\u0000-\u001f]/gu, '-').slice(0, 80) || '인수인계'}.modyhandover`;
  const choice = await options.dialog.showSaveDialog({ title: '선택한 인수인계·자료를 암호화하여 내보내기', defaultPath: fileName, filters: [{ name: 'ModyCrew 인수인계 이전', extensions: ['modyhandover'] }] });
  if (choice.canceled || !choice.filePath) return { cancelled: true };
  if (!path.isAbsolute(choice.filePath) || path.extname(choice.filePath).toLowerCase() !== '.modyhandover') fail('.modyhandover 확장자로 새 파일을 저장해 주세요.');
  await assertCurrentRevision();
  if (records.length) await folders(options);
  let verifiedBytes = 0;
  for (const { record: snapshot } of records) {
    const { original, sourceBytes } = await originalFile(snapshot.id, options, MAX_CONTENT - verifiedBytes);
    const current = recordValue(await readCompanyRecord(snapshot.id, options));
    verifiedBytes += Math.max(sourceBytes, original.length + Buffer.byteLength(JSON.stringify(current), 'utf8'));
    if (verifiedBytes > MAX_CONTENT) fail('이전할 원본과 추출 자료는 합계 64MiB까지 지원합니다.');
    if (digest(original) !== snapshot.hash || ['name', 'format', 'hash', 'textHash', 'tablesHash', 'bytes', 'version'].some((key) => current[key] !== snapshot[key])) fail('저장 위치를 선택하는 동안 인계 자료가 변경됐습니다. 이전 범위를 다시 확인해 주세요.');
  }
  const encrypted = await encrypt(payload, password);
  await assertCurrentRevision();
  try { await writeFile(choice.filePath, encrypted, { flag: 'wx', mode: 0o600 }); }
  catch (error) { if (error.code === 'EEXIST') fail('같은 이름의 파일이 이미 있습니다. 기존 파일을 보존하도록 새 이름을 선택해 주세요.'); throw error; }
  return { file: { name: path.basename(choice.filePath), path: choice.filePath, bytes: encrypted.length }, summary: { companyName: payload.companyName, title: selected.title, recordCount: records.length, packageId: payload.packageId, exclusions: [...exclusions] } };
}

export async function previewHandoverImport({ password } = {}, options = {}) {
  const owner = sender(options); passwordValue(password);
  const choice = await options.dialog.showOpenDialog({ title: '암호화된 인수인계·자료 이전 파일 선택', properties: ['openFile'], filters: [{ name: 'ModyCrew 인수인계 이전', extensions: ['modyhandover'] }] });
  if (choice.canceled) return { cancelled: true };
  if (!Array.isArray(choice.filePaths) || choice.filePaths.length !== 1 || !path.isAbsolute(choice.filePaths[0])) fail('이전 파일 한 개를 선택해 주세요.');
  const info = await lstat(choice.filePaths[0]);
  if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_PACKAGE) fail('128MiB 이하의 일반 이전 파일을 선택해 주세요.');
  const decrypted = await decrypt(await readFile(choice.filePaths[0]), password);
  const time = now(options);
  for (const [key, preview] of previews) if (preview.expiresAt <= time || (preview.owner === owner && preview.root === rootKey(options))) removePreview(key);
  const heldBytes = [...previews.values()].reduce((sum, preview) => sum + preview.payload.contentBytes, 0);
  if (previews.size >= 20 || heldBytes + decrypted.payload.contentBytes > 128 * MiB) fail('열려 있는 이전 미리보기가 많습니다. 다른 창의 이전을 마치고 다시 시도해 주세요.');
  const token = randomUUID(); const expiresAt = time + TTL;
  const timer = setTimeout(() => removePreview(token), TTL); timer.unref?.();
  previews.set(token, { ...decrypted, owner, root: rootKey(options), expiresAt, timer });
  const { payload } = decrypted;
  return { transferPreview: { token, companyName: payload.companyName, title: payload.handover.title, recordCount: payload.records.length, recordNames: payload.records.map(({ record }) => record.name), createdAt: payload.exportedAt, expiresAt: new Date(expiresAt).toISOString(), exclusions: [...exclusions] } };
}

export async function applyHandoverImport({ token, approved } = {}, options = {}) {
  const owner = sender(options);
  if (approved !== true) fail('미리보기의 회사와 자료 범위를 확인하고 가져오기를 승인해 주세요.');
  const preview = previews.get(token);
  if (!preview || preview.owner !== owner || preview.root !== rootKey(options)) fail('이 창에서 이전 파일을 다시 미리보기해 주세요.');
  if (preview.expiresAt <= now(options)) { removePreview(token); fail('미리보기 유효시간 10분이 지났습니다. 파일을 다시 선택해 주세요.'); }
  removePreview(token, false);
  const created = [];
  try {
    return await mutateHandoverStore(options, async (store) => {
      const previous = store.imports.find((entry) => entry.packageId === preview.payload.packageId);
      if (previous) {
        if (previous.payloadHash !== preview.payloadHash) fail('같은 이전 번호의 내용이 변경됐습니다. 기존 인수인계를 보존합니다.');
        const handover = store.handovers.find((entry) => entry.id === previous.handoverId);
        if (!handover) fail('기존 이전 기록의 인수인계를 찾지 못했습니다. 원본을 보존한 채 확인이 필요합니다.');
        return { handover, alreadyImported: true };
      }
      if (store.handovers.length >= 1000) fail('인수인계 기록이 1,000건에 도달했습니다. 기존 기록을 확인해 주세요.');
      const { payload } = preview; const root = await folders(options, true); const importedAt = new Date(now(options)).toISOString();
      const sourceMap = new Map(payload.records.map(({ record }) => [record.id, randomUUID()]));
      const records = payload.records.map(({ record, original }) => ({ record: { ...record, id: sourceMap.get(record.id), importedAt }, original }));
      const handover = { id: randomUUID(), revision: 1, title: payload.handover.title, departmentId: '', fromPerson: payload.handover.fromPerson, toPerson: '', purpose: payload.handover.purpose, summary: payload.handover.summary, sourceIds: payload.handover.sourceIds.map((id) => sourceMap.get(id)), sourceEvidence: payload.handover.sourceEvidence.map((entry) => ({ ...entry, id: sourceMap.get(entry.id) })), workSnapshots: payload.handover.workSnapshots.map((work) => ({ ...work })), steps: payload.handover.steps.map((step) => ({ id: randomUUID(), text: step.text, done: false })), status: 'draft', createdAt: importedAt, updatedAt: importedAt, history: [], questions: [], origin: { companyName: payload.companyName, exportedAt: payload.exportedAt, packageId: payload.packageId } };
      for (const { record, original } of records) {
        for (const [file, bytes] of [[path.join(root, 'originals', record.id), original], [path.join(root, 'records', `${record.id}.json`), Buffer.from(JSON.stringify(record, null, 2), 'utf8')]]) {
          await writeFile(file, bytes, { flag: 'wx', mode: 0o600 }); created.push(file);
        }
      }
      store.handovers.push(handover);
      store.imports.push({ packageId: payload.packageId, payloadHash: preview.payloadHash, handoverId: handover.id, importedAt });
      return { handover, alreadyImported: false };
    });
  } catch (error) {
    for (const file of created.reverse()) {
      const relative = path.relative(path.resolve(companyRoot(options)), file);
      if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) continue;
      try { await unlink(file); } catch (cleanupError) { if (cleanupError.code !== 'ENOENT') error.message += ' 새로 만든 일부 자료 사본의 정리가 필요합니다.'; }
    }
    throw error;
  } finally { for (const { original } of preview.payload.records) original.fill(0); }
}
