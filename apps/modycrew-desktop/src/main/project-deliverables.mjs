import { createHash, randomUUID } from 'node:crypto';
import { mkdir, lstat, readFile, writeFile, rename, realpath, readdir } from 'node:fs/promises';
import path from 'node:path';

const digest = text => createHash('sha256').update(text).digest('hex');
const filePattern = /^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,79}\.(html|css|js|ts|tsx|jsx|py|json|md|txt)$/;
const previewPolicy = "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' data: blob:; connect-src 'none'; form-action 'none'; base-uri 'none'";

export function createProjectDeliverables({ fallbackRoot, loadWorkspace, trustedOrigin, openFolder, openPreview }) {
  const pending = new Map();
  async function authorize(payload) {
    if (typeof payload.workspaceRoot !== 'string' || !payload.workspaceRoot || typeof payload.threadId !== 'string' || !payload.threadId || typeof payload.messageId !== 'string' || !payload.messageId) throw new Error('대화와 저장 위치를 먼저 선택해 주세요.');
    const loaded = await loadWorkspace(payload.workspaceRoot);
    if (loaded.status !== 'work_session_workspace_loaded' || !loaded.root || path.resolve(loaded.root) !== path.resolve(payload.workspaceRoot)) throw new Error('저장 위치가 바뀌었습니다. 현재 대화에서 다시 시도해 주세요.');
    const session = loaded.workspace.sessions.find(item => item.threadId === payload.threadId && !item.archivedAt);
    if (!session) throw new Error('저장된 업무 대화에서 결과를 만들어 주세요.');
    const project = loaded.workspace.projects.find(item => item.id === session.projectId && !item.archivedAt);
    return { root: loaded.root, project };
  }
  async function verifiedDirectory(parent, name) {
    const directory = path.join(parent, name);
    await mkdir(directory).catch(error => { if (error.code !== 'EEXIST') throw error; });
    const info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('결과 폴더가 일반 폴더가 아닙니다. 저장 위치를 확인해 주세요.');
    if (path.resolve(await realpath(directory)) !== path.resolve(directory)) throw new Error('결과 폴더의 실제 위치가 달라 저장하지 않았습니다.');
    return directory;
  }
  async function perform(payload) {
    const { root, project } = await authorize(payload);
    const files = payload.files;
    if (!Array.isArray(files) || !files.length || files.length > 20 || files.some(file => !file || typeof file.name !== 'string' || !filePattern.test(file.name) || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])\./i.test(file.name) || typeof file.content !== 'string') || new Set(files.map(file => file.name.toLowerCase())).size !== files.length) throw new Error('지원하는 결과 파일 이름과 내용을 확인해 주세요.');
    if (files.reduce((size, file) => size + Buffer.byteLength(file.content), 0) > 2_000_000) throw new Error('결과 파일이 너무 큽니다. 나누어 만들어 주세요.');
    let base;
    if (project?.sourceFolder) {
      if (!path.isAbsolute(project.sourceFolder)) throw new Error('프로젝트 폴더를 다시 선택해 주세요.');
      base = await realpath(project.sourceFolder);
      if (!(await lstat(base)).isDirectory()) throw new Error('프로젝트 폴더를 찾을 수 없습니다.');
    } else {
      await mkdir(fallbackRoot, { recursive: true }); base = await realpath(fallbackRoot);
    }
    let directory = base;
    for (const part of ['ModyCrew 결과', digest(root).slice(0, 20), digest(payload.threadId).slice(0, 20), digest(payload.messageId).slice(0, 20)]) directory = await verifiedDirectory(directory, part);
    const contentHash = digest(JSON.stringify(files));
    const output = path.join(directory, contentHash);
    if (payload.kind === 'save') {
      const current = await authorize(payload);
      if ((current.project?.sourceFolder || '') !== (project?.sourceFolder || '')) throw new Error('프로젝트 폴더가 바뀌었습니다. 다시 시도해 주세요.');
      let present = false;
      try { await lstat(output); present = true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (!present) {
        // Stage a complete new bundle, then publish it. Existing project files are never replaced.
        const staging = await verifiedDirectory(directory, `.writing-${randomUUID()}`);
        for (const file of files) await writeFile(path.join(staging, file.name), file.content, { flag: 'wx', encoding: 'utf8' });
        await authorize(payload);
        await rename(staging, output);
      }
    }
    const info = await lstat(output);
    if (!info.isDirectory() || info.isSymbolicLink() || path.resolve(await realpath(output)) !== path.resolve(output)) throw new Error('저장 결과의 위치를 확인할 수 없습니다.');
    for (const file of files) {
      const filePath = path.join(output, file.name), info = await lstat(filePath);
      if (!info.isFile() || info.isSymbolicLink() || info.size > 2_000_000 || digest(await readFile(filePath)) !== digest(file.content)) throw new Error('저장된 파일이 변경되었습니다. 기존 파일은 보존했습니다.');
    }
    await authorize(payload);
    if (payload.kind === 'open_folder') await openFolder(output);
    if (payload.kind === 'preview') {
      const file = files.find(item => item.name === payload.name && item.name.endsWith('.html'));
      if (!file || !/<html\b[\s\S]*<\/html>/i.test(file.content)) throw new Error('완성된 HTML 파일만 실행할 수 있습니다.');
      // Read the saved result, not a separately invented preview.
      const savedFiles = await Promise.all(files.map(async item => ({ name: item.name, content: await readFile(path.join(output, item.name), 'utf8') })));
      await openPreview({ files: savedFiles, policy: previewPolicy, name: file.name, directory: output });
    }
    return { status: payload.kind === 'save' ? 'saved' : 'opened', directory: output, location: project?.sourceFolder ? '프로젝트 폴더' : '앱 작업 결과 폴더', files: files.map(file => ({ name: file.name, bytes: Buffer.byteLength(file.content), sha256: digest(file.content) })) };
  }
  /** Result roots the workspace can own: each folder project plus the app fallback. Read-only. */
  async function resultRoots(workspaceRoot) {
    if (typeof workspaceRoot !== 'string' || !workspaceRoot) throw new Error('저장 위치를 먼저 선택해 주세요.');
    const loaded = await loadWorkspace(workspaceRoot);
    if (loaded.status !== 'work_session_workspace_loaded' || !loaded.root || path.resolve(loaded.root) !== path.resolve(workspaceRoot)) throw new Error('저장 위치가 바뀌었습니다. 다시 열어 주세요.');
    const rootHash = digest(loaded.root).slice(0, 20);
    const roots = [];
    for (const project of loaded.workspace.projects.filter(item => !item.archivedAt)) {
      if (!project.sourceFolder || !path.isAbsolute(project.sourceFolder)) continue;
      try {
        const base = await realpath(project.sourceFolder);
        if ((await lstat(base)).isDirectory()) roots.push({ projectId: project.id, projectName: project.name, base, directory: path.join(base, 'ModyCrew 결과', rootHash), location: '프로젝트 폴더' });
      } catch { /* A missing folder is reported through the project list, not as a crash. */ }
    }
    try {
      const base = await realpath(fallbackRoot);
      roots.push({ projectId: '', projectName: '', base, directory: path.join(base, 'ModyCrew 결과', rootHash), location: '앱 작업 결과 폴더' });
    } catch { /* No fallback results yet. */ }
    return { loaded, roots };
  }
  async function listDirectories(directory) {
    try { return (await readdir(directory, { withFileTypes: true })).filter(entry => entry.isDirectory() && !entry.name.startsWith('.')).map(entry => entry.name); }
    catch (error) { if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return []; throw error; }
  }
  async function readBundle(directory) {
    const entries = (await readdir(directory, { withFileTypes: true })).filter(entry => entry.isFile() && filePattern.test(entry.name)).slice(0, 20);
    const files = [];
    let savedAt = 0;
    for (const entry of entries) {
      const info = await lstat(path.join(directory, entry.name));
      if (info.isSymbolicLink() || info.size > 2_000_000) continue;
      savedAt = Math.max(savedAt, info.mtimeMs);
      files.push({ name: entry.name, bytes: info.size });
    }
    return { files, savedAt };
  }
  /** Lists saved result bundles for the dev workspace. Nothing is written or opened here. */
  async function listResults(payload) {
    const { loaded, roots } = await resultRoots(payload.workspaceRoot);
    const sessions = loaded.workspace.sessions.map(session => ({ ...session, hash: digest(session.threadId).slice(0, 20) }));
    const results = [];
    for (const root of roots) {
      if (payload.projectId !== undefined && payload.projectId !== root.projectId) continue;
      for (const threadHash of await listDirectories(root.directory)) {
        const session = sessions.find(item => item.hash === threadHash);
        for (const messageHash of await listDirectories(path.join(root.directory, threadHash))) {
          for (const contentHash of await listDirectories(path.join(root.directory, threadHash, messageHash))) {
            const directory = path.join(root.directory, threadHash, messageHash, contentHash);
            const bundle = await readBundle(directory);
            if (!bundle.files.length) continue;
            results.push({ directory, projectId: root.projectId, projectName: root.projectName, location: root.location, threadId: session?.threadId ?? '', sessionTitle: session?.title ?? '', archived: Boolean(session?.archivedAt), savedAt: bundle.savedAt, files: bundle.files, runnable: bundle.files.some(file => file.name.endsWith('.html')) });
          }
        }
      }
    }
    results.sort((left, right) => right.savedAt - left.savedAt);
    return { status: 'listed', results: results.slice(0, 200), projects: roots.filter(root => root.projectId).map(root => ({ id: root.projectId, name: root.projectName, folder: root.base })) };
  }
  /** Opens or runs a bundle that the listing already returned. The directory must sit inside a known result root. */
  /** Read-only look at a folder project: top-level entries, package scripts, README head. Nothing is executed. */
  async function projectOverview(payload) {
    const { loaded } = await resultRoots(payload.workspaceRoot);
    const project = loaded.workspace.projects.find(item => item.id === payload.projectId && !item.archivedAt);
    if (!project?.sourceFolder || !path.isAbsolute(project.sourceFolder)) throw new Error('폴더를 연결한 프로젝트를 선택해 주세요.');
    const base = await realpath(project.sourceFolder);
    if (!(await lstat(base)).isDirectory()) throw new Error('프로젝트 폴더를 찾을 수 없습니다.');
    const heavy = new Set(['node_modules', '.git', '.next', 'dist', 'build', 'out', '__pycache__', '.venv', 'venv', 'target']);
    const dirents = (await readdir(base, { withFileTypes: true })).filter(entry => !entry.isSymbolicLink());
    const entries = dirents.map(entry => ({ name: entry.name, kind: entry.isDirectory() ? 'directory' : 'file', heavy: entry.isDirectory() && heavy.has(entry.name) }))
      .sort((left, right) => Number(right.kind === 'directory') - Number(left.kind === 'directory') || left.name.localeCompare(right.name, 'ko')).slice(0, 80);
    const names = new Set(dirents.map(entry => entry.name));
    const readSmall = async name => { try { const info = await lstat(path.join(base, name)); if (!info.isFile() || info.size > 200_000) return ''; return await readFile(path.join(base, name), 'utf8'); } catch { return ''; } };
    let scripts = [];
    let packageName = '';
    if (names.has('package.json')) {
      try { const pkg = JSON.parse(await readSmall('package.json')); packageName = typeof pkg.name === 'string' ? pkg.name.slice(0, 80) : ''; scripts = Object.entries(pkg.scripts || {}).slice(0, 12).map(([name, command]) => ({ name: String(name).slice(0, 40), command: String(command).slice(0, 160) })); } catch { /* A broken package.json is shown as having no scripts. */ }
    }
    const readmeName = dirents.find(entry => /^readme(\.md|\.txt)?$/iu.test(entry.name))?.name || '';
    const readme = readmeName ? (await readSmall(readmeName)).split(/\r?\n/u).slice(0, 30).join('\n').slice(0, 2_000) : '';
    const stacks = [];
    if (names.has('package.json')) stacks.push(names.has('pnpm-lock.yaml') ? 'Node.js · pnpm' : names.has('yarn.lock') ? 'Node.js · yarn' : 'Node.js · npm');
    if (names.has('requirements.txt') || names.has('pyproject.toml') || names.has('Pipfile')) stacks.push('Python');
    if (names.has('next.config.js') || names.has('next.config.mjs') || names.has('next.config.ts')) stacks.push('Next.js');
    if (names.has('vercel.json')) stacks.push('Vercel 설정 있음');
    if (names.has('wrangler.toml') || names.has('wrangler.jsonc')) stacks.push('Cloudflare 설정 있음');
    if (names.has('supabase')) stacks.push('Supabase 폴더 있음');
    if (names.has('index.html') && !names.has('package.json')) stacks.push('정적 HTML');
    return { status: 'overview', folder: base, entries, truncated: dirents.length > entries.length, git: names.has('.git'), packageName, scripts, readmeName, readme, stacks, totalEntries: dirents.length };
  }
  async function actOnResult(payload) {
    const { roots } = await resultRoots(payload.workspaceRoot);
    if (typeof payload.directory !== 'string' || !payload.directory) throw new Error('결과 폴더를 선택해 주세요.');
    const directory = path.resolve(payload.directory);
    const root = roots.find(item => directory.startsWith(item.directory + path.sep));
    const relative = root ? path.relative(root.directory, directory).split(path.sep) : [];
    if (!root || relative.length !== 3 || relative.some(part => !/^[0-9a-f]{20}$|^[0-9a-f]{64}$/u.test(part))) throw new Error('모디크루가 저장한 결과 폴더만 열 수 있습니다.');
    const info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink() || path.resolve(await realpath(directory)) !== directory) throw new Error('결과 폴더의 실제 위치를 확인할 수 없습니다.');
    if (payload.kind === 'open_result') { await openFolder(directory); return { status: 'opened', directory }; }
    const bundle = await readBundle(directory);
    const target = bundle.files.find(file => file.name === payload.name && file.name.endsWith('.html'));
    if (!target) throw new Error('완성된 HTML 파일만 실행할 수 있습니다.');
    const files = await Promise.all(bundle.files.map(async file => ({ name: file.name, content: await readFile(path.join(directory, file.name), 'utf8') })));
    if (!/<html\b[\s\S]*<\/html>/i.test(files.find(file => file.name === target.name).content)) throw new Error('완성된 HTML 파일만 실행할 수 있습니다.');
    await openPreview({ files, policy: previewPolicy, name: target.name, directory });
    return { status: 'opened', directory };
  }
  return {
    async handle(event, payload = {}) {
      try {
        const frame = event?.senderFrame;
        if (!frame || frame !== event?.sender?.mainFrame || !trustedOrigin(new URL(frame.url))) throw new Error('모디크루 대화 화면에서 실행해 주세요.');
        if (payload.kind === 'list') return await listResults(payload);
        if (payload.kind === 'project_overview') return await projectOverview(payload);
        if (payload.kind === 'open_result' || payload.kind === 'preview_result') return await actOnResult(payload);
        if (!['save', 'open_folder', 'preview'].includes(payload.kind)) throw new Error('지원하지 않는 결과 작업입니다.');
        const key = digest(JSON.stringify([payload.workspaceRoot, payload.threadId, payload.messageId]));
        const prior = pending.get(key) || Promise.resolve();
        const current = prior.catch(() => {}).then(() => perform(payload));
        pending.set(key, current);
        try { return await current; } finally { if (pending.get(key) === current) pending.delete(key); }
      } catch (error) { return { status: 'failed', userMessage: error instanceof Error ? error.message : '결과 파일을 저장하지 못했습니다.' }; }
    },
  };
}

export async function openDeliverablePreview(BrowserWindow, { files, policy, name, visible = true }) {
      const preview = new BrowserWindow({ width: 1000, height: 760, minWidth: 360, minHeight: 300, show: false,
        title: `${name} · ModyCrew 실행`, autoHideMenuBar: true,
        webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, nodeIntegrationInSubFrames: false, webSecurity: true, webviewTag: false, partition: `mody-result-${randomUUID()}` },
      });
      const session = preview.webContents.session;
      session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
      session.setPermissionCheckHandler(() => false);
      const previewOrigin = "https://modycrew-result.invalid";
      session.webRequest.onBeforeRequest((request, callback) => callback({ cancel: !request.url.startsWith(`${previewOrigin}/`) && !/^(data|blob):/u.test(request.url) }));
      session.protocol.handle("https", request => {
        const url = new URL(request.url);
        const file = files.find(item => url.origin === previewOrigin && url.pathname === `/${item.name}`);
        if (!file) return new Response("결과 파일을 찾을 수 없습니다.", { status: 404 });
        const extension = file.name.split(".").at(-1);
        const type = ({ html: "text/html", css: "text/css", js: "text/javascript", json: "application/json" })[extension] || "text/plain";
        return new Response(file.content, { headers: { "Content-Type": `${type}; charset=utf-8`, "Content-Security-Policy": policy, "X-Content-Type-Options": "nosniff" } });
      });
      session.on("will-download", event => event.preventDefault());
      preview.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      preview.webContents.on("will-navigate", event => event.preventDefault());
      preview.webContents.on("will-frame-navigate", event => event.preventDefault());
      try {
        await preview.loadURL(`${previewOrigin}/${name}`);
        if (visible) preview.show();
        return preview;
      } catch (error) { preview.destroy(); throw error; }
}
