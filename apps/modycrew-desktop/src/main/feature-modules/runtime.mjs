import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, rm, lstat, open } from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';
import { resolveFeatureModule } from './catalog.mjs';

const queues = new Map();
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const MAX_EXPANDED_BYTES = 100 * 1024 * 1024;
const MAX_FILES = 2500;

export function featureModulePaths(options, id = 'pdf_viewer') {
  const entry = resolveFeatureModule(id);
  const userData = options.userDataPath || options.app?.getPath('userData');
  if (!userData) throw new Error('앱의 기능 저장 위치를 확인할 수 없습니다.');
  const root = path.resolve(userData, 'feature-modules', entry.id);
  return { root, folder: path.join(root, entry.version), receipt: path.join(root, entry.version, 'modycrew-install.json') };
}

function safeRelativePath(value) {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.startsWith('/') || /[\x00-\x1f:]/u.test(value)) throw new Error('기능 패키지의 경로가 올바르지 않습니다.');
  const parts = value.replace(/\/$/u, '').split('/');
  if (parts.some((part) => !part || part === '.' || part === '..' || /[. ]$/u.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(part))) throw new Error('기능 패키지의 경로가 올바르지 않습니다.');
  return parts.join('/');
}

export async function inspectFeatureModule(options = {}, id = 'pdf_viewer') {
  const entry = resolveFeatureModule(id);
  const paths = featureModulePaths(options, id);
  const base = { id, name: entry.name, version: entry.version, license: entry.license, upstream: entry.upstream, downloadBytes: entry.bytes, platforms: entry.platforms, offlineAfterInstall: true };
  try {
    const receipt = JSON.parse(await readFile(paths.receipt, 'utf8'));
    if (receipt.id !== id || receipt.version !== entry.version || receipt.archiveSha256 !== entry.sha256 || !Array.isArray(receipt.files) || !receipt.files.length || receipt.files.length > MAX_FILES) throw new Error('invalid receipt');
    const seen = new Set();
    for (const item of receipt.files) {
      const relative = safeRelativePath(item.path);
      if (seen.has(relative.toLowerCase()) || !/^[a-f0-9]{64}$/u.test(item.sha256)) throw new Error('invalid receipt');
      seen.add(relative.toLowerCase());
      const file = path.join(paths.folder, ...relative.split('/'));
      const info = await lstat(file);
      if (!info.isFile() || info.isSymbolicLink() || info.size !== item.bytes || hash(await readFile(file)) !== item.sha256) throw new Error('changed module');
    }
    if (entry.requiredFiles.some((file) => !seen.has(file.toLowerCase()))) throw new Error('missing entry');
    return { ...base, status: 'installed', installedAt: receipt.installedAt, userMessage: '설치되었습니다. 인터넷 연결 없이 PDF를 열 수 있습니다.' };
  } catch (error) {
    if (error.code === 'ENOENT') {
      try { await lstat(paths.receipt); } catch { return { ...base, status: 'not_installed', userMessage: '필요할 때 한 번 내려받아 설치하세요.' }; }
    }
    return { ...base, status: 'damaged', userMessage: '설치 파일을 확인하지 못했습니다. 다시 설치해 주세요.' };
  }
}

async function locked(options, id, operation) {
  const paths = featureModulePaths(options, id);
  const previous = queues.get(paths.root) || Promise.resolve();
  const next = previous.catch(() => {}).then(async () => {
    await mkdir(paths.root, { recursive: true });
    const lockPath = path.join(paths.root, '.install.lock');
    let handle;
    try { handle = await open(lockPath, 'wx'); }
    catch (error) { if (error.code === 'EEXIST') throw new Error('다른 창에서 기능을 설치 중입니다. 잠시 후 다시 시도해 주세요.'); throw error; }
    try { await handle.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })); return await operation(paths); }
    finally { await handle.close(); await rm(lockPath, { force: true }); }
  });
  queues.set(paths.root, next);
  try { return await next; } finally { if (queues.get(paths.root) === next) queues.delete(paths.root); }
}

async function readOfficialFile(url, options, maximumBytes, timeout) {
  let response;
  try { response = await (options.fetch || globalThis.fetch)(url, { signal: AbortSignal.timeout(timeout), redirect: 'error' }); }
  catch { throw new Error('모디 자료실에 연결하지 못했습니다. 다시 시도하거나 내려받은 파일로 설치해 주세요.'); }
  if (!response.ok || !response.body) throw new Error('모디 자료실에서 파일을 내려받지 못했습니다. 잠시 후 다시 시도해 주세요.');
  if (response.url && response.url !== url) throw new Error('모디 공식 다운로드 주소를 확인하지 못했습니다.');
  if (Number(response.headers.get('content-length')) > maximumBytes) throw new Error('모디 자료실 파일의 크기가 허용 범위를 넘었습니다.');
  const chunks = []; let size = 0;
  for await (const chunk of response.body) { size += chunk.length; if (size > maximumBytes) throw new Error('모디 자료실 파일의 크기가 허용 범위를 넘었습니다.'); chunks.push(Buffer.from(chunk)); }
  return Buffer.concat(chunks);
}

function sameValues(actual, expected) {
  return Array.isArray(actual) && actual.length === expected.length && new Set(actual).size === actual.length && actual.every((value) => expected.includes(value));
}

async function download(entry, options) {
  const catalogBytes = await readOfficialFile(entry.catalogUrl, options, 64 * 1024, 30000);
  let catalog;
  try { catalog = JSON.parse(catalogBytes.toString('utf8')); }
  catch { throw new Error('모디 자료실의 기능 목록을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.'); }
  const matches = Array.isArray(catalog?.modules) ? catalog.modules.filter((item) => item?.id === entry.id) : [];
  const approved = matches[0];
  let downloadUrl;
  try { if (typeof approved?.download?.url === 'string') downloadUrl = new URL(approved.download.url, entry.catalogUrl).href; } catch {}
  if (catalog?.schema !== 'modycrew.feature-module-catalog.v1' || matches.length !== 1 ||
      approved.version !== entry.version || approved.minimumAppVersion !== entry.minimumAppVersion ||
      approved.license !== entry.license || approved.upstream !== entry.upstream ||
      !['preview', 'available'].includes(approved.status) ||
      !sameValues(approved.platforms, entry.platforms) || !sameValues(approved.permissions, entry.permissions) ||
      downloadUrl !== entry.url || approved.download.bytes !== entry.bytes || approved.download.sha256 !== entry.sha256) {
    throw new Error('모디 자료실의 기능 정보가 이 앱에서 승인한 버전과 다릅니다. 앱 업데이트 또는 자료실 안내를 확인해 주세요.');
  }
  const bytes = await readOfficialFile(entry.url, options, entry.bytes, 120000);
  if (bytes.length !== entry.bytes || hash(bytes) !== entry.sha256) throw new Error('다운로드 파일의 무결성 검증에 실패했습니다. 다시 시도해 주세요.');
  return bytes;
}

export async function extractFeatureArchive(bytes, directory, entry) {
  const archive = await JSZip.loadAsync(bytes, { checkCRC32: true, createFolders: false });
  const items = Object.values(archive.files);
  if (items.length > MAX_FILES) throw new Error('기능 패키지의 파일 수가 너무 많습니다.');
  const files = []; const seen = new Set(); let total = 0;
  for (const item of items) {
    const relative = safeRelativePath(item.unsafeOriginalName || item.name);
    if (seen.has(relative.toLowerCase())) throw new Error('중복된 패키지 경로입니다.');
    seen.add(relative.toLowerCase());
    if ((Number(item.unixPermissions) & 0o170000) === 0o120000) throw new Error('기능 패키지의 바로가기는 허용되지 않습니다.');
    if (item.dir) continue;
    if (Number(item._data?.uncompressedSize) > MAX_EXPANDED_BYTES - total) throw new Error('기능 패키지가 너무 큽니다.');
    const data = await item.async('nodebuffer'); total += data.length;
    if (total > MAX_EXPANDED_BYTES) throw new Error('기능 패키지가 너무 큽니다.');
    const file = path.join(directory, ...relative.split('/'));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, data, { flag: 'wx' });
    files.push({ path: relative, bytes: data.length, sha256: hash(data) });
  }
  if (entry.requiredFiles.some((name) => !files.some((item) => item.path === name))) throw new Error('PDF 기능의 필수 파일이 없습니다.');
  return files;
}

export async function installFeatureModule(options = {}, id = 'pdf_viewer') {
  const entry = resolveFeatureModule(id);
  return locked(options, id, async (paths) => {
    if ((await inspectFeatureModule(options, id)).status === 'installed') return inspectFeatureModule(options, id);
    const archive = options.archiveBytes ? Buffer.from(options.archiveBytes) : await download(entry, options);
    const expectedBytes = options.bundledArchive ? entry.bundledBytes : entry.bytes;
    const expectedHash = options.bundledArchive ? entry.bundledSha256 : entry.sha256;
    if (archive.length !== expectedBytes || hash(archive) !== expectedHash) throw new Error('PDF 기능 파일을 확인하지 못했습니다. 모디크루 설치파일로 복구해 주세요.');
    const pending = path.join(paths.root, `.pending-${randomUUID()}`);
    const previous = path.join(paths.root, `.previous-${randomUUID()}`);
    let backedUp = false;
    try {
      await mkdir(pending);
      const files = await extractFeatureArchive(archive, pending, entry);
      await writeFile(path.join(pending, 'modycrew-install.json'), JSON.stringify({ id, version: entry.version, archiveSha256: entry.sha256, source: options.bundledArchive ? 'bundled' : options.archiveBytes ? 'archive-file' : 'mody-site', installedAt: new Date().toISOString(), files }));
      try { await rename(paths.folder, previous); backedUp = true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
      try { await rename(pending, paths.folder); }
      catch (error) { if (backedUp) await rename(previous, paths.folder); throw error; }
      await rm(previous, { recursive: true, force: true });
      return inspectFeatureModule(options, id);
    } finally { await rm(pending, { recursive: true, force: true }); }
  });
}

export async function uninstallFeatureModule(options = {}, id = 'pdf_viewer') {
  return locked(options, id, async (paths) => {
    // Only engine files are removed; selected PDFs are never copied into this folder.
    await rm(paths.folder, { recursive: true, force: true });
    return inspectFeatureModule(options, id);
  });
}

/** Core document tooling is shipped with the app. Never download during first use. */
export async function ensureBundledPdfViewer(options = {}) {
  let state = await inspectFeatureModule(options);
  if (state.status !== 'installed') {
    const archiveBytes = await readFile(new URL('./assets/pdfjs-bundled-6.4.299.zip', import.meta.url));
    state = await installFeatureModule({ ...options, archiveBytes, bundledArchive: true });
  }
  return { ...state, builtIn: true, userMessage: '기본 제공 PDF 기능입니다. 인터넷 없이 열기·주석 편집·사본 저장을 사용할 수 있습니다.' };
}
