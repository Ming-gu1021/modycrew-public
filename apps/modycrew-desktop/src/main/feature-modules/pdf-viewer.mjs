import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFile, lstat, realpath, mkdtemp, writeFile, rename, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { featureModulePaths, ensureBundledPdfViewer } from './runtime.mjs';

const viewers = new Set();
const mime = { '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.bcmap': 'application/octet-stream', '.ftl': 'text/plain; charset=utf-8', '.wasm': 'application/wasm', '.ttf': 'font/ttf', '.otf': 'font/otf', '.woff2': 'font/woff2' };
const csp = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self' blob: data:; connect-src 'self' blob:; worker-src 'self' blob:; object-src 'none'; frame-ancestors 'none'; form-action 'none'; base-uri 'self'";

export async function createPdfViewerServer({ moduleFolder, pdfBytes, fileName = '문서.pdf' }) {
  const root = await realpath(moduleFolder);
  const token = randomBytes(32).toString('hex');
  const prefix = `/${token}/`;
  let origin;
  const server = createServer(async (request, response) => {
    const reply = (status, text = '') => { response.writeHead(status, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' }); response.end(text); };
    try {
      if (!['GET', 'HEAD'].includes(request.method) || request.headers.host !== new URL(origin).host) return reply(403);
      if (request.headers.origin && request.headers.origin !== origin) return reply(403);
      const url = new URL(request.url, origin);
      if (!url.pathname.startsWith(prefix)) return reply(404);
      const relative = decodeURIComponent(url.pathname.slice(prefix.length));
      if (!relative || relative.includes('\\') || /[\x00-\x1f:]/u.test(relative) || relative.split('/').some((part) => !part || part === '.' || part === '..')) return reply(404);
      let bytes; let contentType;
      if (relative === 'document.pdf') { bytes = pdfBytes; contentType = 'application/pdf'; }
      else {
        // Serve reviewed viewer assets only. The upstream demo PDF and install receipt are private.
        if (!/^(?:build|web)\//u.test(relative) || /\.pdf$/iu.test(relative)) return reply(404);
        const candidate = path.join(root, ...relative.split('/'));
        const absolute = await realpath(candidate);
        if (!absolute.startsWith(root + path.sep)) return reply(404);
        const info = await lstat(candidate);
        if (!info.isFile() || info.isSymbolicLink()) return reply(404);
        bytes = await readFile(absolute);
        contentType = mime[path.extname(relative)] || 'application/octet-stream';
        if (relative === 'web/viewer.html') {
          bytes = Buffer.from(bytes.toString('utf8').replace(/<title>[^<]*<\/title>/u, '<title>ModyCrew PDF</title>').replace('</head>', '<style>:root{--toolbar-bg-color:#f4f8f7;--toolbar-border-color:#cbded8;--toggled-btn-bg-color:#d6eae2}#toolbarContainer{border-top:3px solid #267c76}</style></head>'));
        }
      }
      const headers = { 'Content-Type': contentType, 'Cache-Control': 'no-store', 'Content-Security-Policy': csp, 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer', 'Cross-Origin-Resource-Policy': 'same-origin' };
      if (relative === 'document.pdf') headers['Content-Disposition'] = `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`;
      response.writeHead(200, { ...headers, 'Content-Length': bytes.length });
      response.end(request.method === 'HEAD' ? undefined : bytes);
    } catch { if (!response.headersSent) reply(404); else response.destroy(); }
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  server.unref();
  origin = `http://127.0.0.1:${server.address().port}`;
  const documentUrl = `${origin}${prefix}document.pdf`;
  return {
    origin,
    url: `${origin}${prefix}web/viewer.html?file=${encodeURIComponent(documentUrl)}#locale=ko`,
    documentUrl,
    close: () => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }),
  };
}

export async function registerPdfCopySaving({ session, window, dialog, app, originalPath, originalInfo }) {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'mody-pdf-save-'));
  const active = new Set(); const operations = new Set(); let closed = false;
  const key = (value) => process.platform === 'win32' ? value.toLowerCase() : value;
  const checkTarget = async (selected) => {
    const target = path.resolve(selected);
    if (key(target) === key(originalPath)) throw new Error('원본을 보호하려면 다른 이름으로 저장해 주세요.');
    try {
      const actual = await realpath(target); const info = await lstat(actual);
      if (key(actual) === key(originalPath) || (info.dev === originalInfo.dev && info.ino === originalInfo.ino)) throw new Error('원본을 보호하려면 다른 이름으로 저장해 주세요.');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    return target;
  };
  const onDownload = (event, item) => {
    if (closed) { event.preventDefault(); return; }
    const staged = path.join(temporary, `${randomBytes(16).toString('hex')}.pdf`);
    // Electron requires setSavePath inside this synchronous callback. No pause/resume or second native dialog.
    item.setSavePath(staged); active.add(item);
    const completed = new Promise((resolve) => item.once('done', (_event, state) => { active.delete(item); resolve(state); }));
    const cancel = () => { if (active.has(item)) item.cancel(); };
    let pending;
    const operation = (async () => {
      let documents;
      try { documents = app.getPath('documents'); } catch { documents = path.dirname(originalPath); }
      const selected = await dialog.showSaveDialog(window, { title: 'PDF 사본 저장', defaultPath: path.join(documents, `${path.parse(originalPath).name}-검토본.pdf`), filters: [{ name: 'PDF 문서', extensions: ['pdf'] }] });
      if (closed || selected.canceled || !selected.filePath) { cancel(); await completed; return; }
      const target = await checkTarget(selected.filePath);
      if (await completed !== 'completed' || closed) throw new Error('PDF 사본을 내려받지 못했습니다. 다시 저장해 주세요.');
      const info = await lstat(staged);
      if (!info.isFile() || info.size > 128 * 1024 * 1024) throw new Error('128MB 이하의 PDF 사본만 저장할 수 있습니다.');
      const bytes = await readFile(staged);
      if (!bytes.subarray(0, 1024).includes(Buffer.from('%PDF-'))) throw new Error('PDF 사본인지 확인하지 못했습니다.');
      pending = path.join(path.dirname(target), `.mody-pdf-${randomBytes(16).toString('hex')}.tmp`);
      await writeFile(pending, bytes, { flag: 'wx', mode: 0o600 });
      await checkTarget(target);
      if (closed) return;
      await rename(pending, target); pending = undefined;
    })().catch(async (error) => {
      cancel(); await completed;
      if (!closed && !window.isDestroyed()) {
        try { await dialog.showMessageBox?.(window, { type: 'error', title: 'PDF 사본 저장', message: error.message || 'PDF 사본을 저장하지 못했습니다.' }); } catch {}
      }
    }).finally(async () => {
      await rm(staged, { force: true }).catch(() => {});
      if (pending) await rm(pending, { force: true }).catch(() => {});
    });
    operations.add(operation); void operation.finally(() => operations.delete(operation));
  };
  session.on('will-download', onDownload);
  const dispose = async () => {
    closed = true; session.removeListener('will-download', onDownload);
    for (const item of active) item.cancel();
    await Promise.allSettled([...operations]); await rm(temporary, { recursive: true, force: true });
  };
  window.once('closed', () => { void dispose().catch(() => {}); });
  return { waitForIdle: () => Promise.allSettled([...operations]), dispose };
}

export async function openPdfViewer(options = {}) {
  await ensureBundledPdfViewer(options);
  if (!options.BrowserWindow || !options.dialog) throw new Error('설치된 ModyCrew 앱에서 PDF를 열어 주세요.');
  const selection = await options.dialog.showOpenDialog({ title: 'PDF 열기', properties: ['openFile'], filters: [{ name: 'PDF 문서', extensions: ['pdf'] }] });
  if (selection.canceled || !selection.filePaths?.[0]) return { status: 'cancelled', userMessage: 'PDF 선택을 취소했습니다.' };
  const originalPath = await realpath(selection.filePaths[0]);
  const info = await lstat(originalPath);
  if (!info.isFile() || path.extname(originalPath).toLowerCase() !== '.pdf' || info.size > 128 * 1024 * 1024) throw new Error('128MB 이하의 PDF 파일을 선택해 주세요.');
  const pdfBytes = await readFile(originalPath);
  if (!pdfBytes.subarray(0, 1024).includes(Buffer.from('%PDF-'))) throw new Error('PDF 문서인지 확인해 주세요.');
  const server = await createPdfViewerServer({ moduleFolder: featureModulePaths(options).folder, pdfBytes, fileName: path.basename(originalPath) });
  const window = new options.BrowserWindow({ title: 'ModyCrew PDF', width: 1140, height: 860, minWidth: 640, minHeight: 480, show: false, autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, partition: `mody-pdf-${randomBytes(16).toString('hex')}`, spellcheck: false } });
  const record = { window, root: featureModulePaths(options).root };
  viewers.add(record);
  const session = window.webContents.session;
  session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.setPermissionCheckHandler(() => false);
  session.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !details.url.startsWith(server.origin + '/') && !/^(blob:|data:|devtools:)/u.test(details.url) }));
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => { if (url !== server.url) event.preventDefault(); });
  window.once('closed', () => { viewers.delete(record); void server.close(); });
  try { await registerPdfCopySaving({ session, window, dialog: options.dialog, app: options.app, originalPath, originalInfo: info }); await window.loadURL(server.url); window.show(); }
  catch (error) { window.destroy(); await server.close(); throw error; }
  return { status: 'opened', userMessage: 'PDF를 열었습니다. 수정한 내용은 사본으로 저장할 수 있습니다.' };
}

export async function handlePdfViewerMessage(payload, options) {
  let result;
  if (['pdf_viewer_status', 'pdf_viewer_install', 'pdf_viewer_import'].includes(payload.kind)) result = await ensureBundledPdfViewer(options);
  else if (payload.kind === 'pdf_viewer_remove') {
    result = { ...await ensureBundledPdfViewer(options), userMessage: 'PDF는 모디크루 기본 기능으로 유지됩니다. 문서 원본은 변경하지 않았습니다.' };
  } else if (payload.kind === 'pdf_viewer_open') result = await openPdfViewer(options);
  else throw new Error('지원하지 않는 PDF 요청입니다.');
  return { ...result, externalMutation: false };
}
