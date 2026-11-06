import { execFile, spawn } from 'node:child_process';
import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
// PowerShell cannot read Electron's virtual asar filesystem.
const script = fileURLToPath(new URL('./document-open-apps.ps1', import.meta.url)).replace(/([\\/])app\.asar([\\/])/, '$1app.asar.unpacked$2');
const unsafeHost = /^(?:cmd|powershell|pwsh|wscript|cscript|mshta|rundll32|regsvr32|msiexec|node|python[\d.]*|pythonw[\d.]*|bash|sh|wsl|conhost|wt|OpenWith)\.exe$/i;

async function verifiedExecutable(executable) {
  if (typeof executable !== 'string' || !/^[a-z]:[\\/]/i.test(executable) || /[\0\r\n]/.test(executable) || path.win32.extname(executable).toLowerCase() !== '.exe' || unsafeHost.test(path.win32.basename(executable))) return null;
  const stat = await lstat(executable).catch(() => null);
  if (!stat?.isFile() || stat.isSymbolicLink()) return null;
  const real = await realpath(executable).catch(() => null);
  return real && !unsafeHost.test(path.win32.basename(real)) ? real : null;
}

export async function queryWindowsDocumentApps(extension) {
  if (!/^\.[a-z0-9]{1,12}$/.test(extension)) return [];
  const root = process.env.SystemRoot;
  if (!root || !path.win32.isAbsolute(root)) return [];
  const executable = path.win32.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const { stdout } = await execFileAsync(executable, ['-NoProfile', '-NonInteractive', '-File', script, '-Extension', extension], { shell: false, windowsHide: true, timeout: 6000, maxBuffer: 256 * 1024, encoding: 'utf8' });
  const rows = JSON.parse(stdout.replace(/^\uFEFF/, '').trim() || '[]');
  return Array.isArray(rows) ? rows : [];
}

// The renderer receives only index/name/icon, never a command or executable path.
// A sender's presented list stays stable even if another menu refreshes the extension cache.
export function createDocumentAppRegistry({ platform = process.platform, query = queryWindowsDocumentApps, verify = verifiedExecutable, spawnProcess = spawn, now = Date.now } = {}) {
  const cache = new Map();
  const presented = new WeakMap();
  async function discover(extension, getIcon) {
    if (cache.has(extension) && cache.get(extension).expires > now()) return cache.get(extension).promise;
    const promise = (async () => {
      const rows = await query(extension);
      const result = []; const seen = new Set();
      for (const row of rows.slice(0, 128)) {
        const executable = await verify(row?.executable);
        if (!executable || seen.has(executable.toLowerCase())) continue;
        seen.add(executable.toLowerCase());
        let icon = '';
        try { const value = await getIcon?.(executable); if (typeof value === 'string' && /^data:image\/png;base64,/.test(value) && value.length < 96 * 1024) icon = value; } catch { /* OS icon is optional. */ }
        const name = String(row.name || path.win32.basename(executable, '.exe')).replace(/[\x00-\x1f\x7f]/g, '').slice(0, 100);
        result.push({ executable, name, icon });
        if (result.length === 4) break;
      }
      return result;
    })();
    if (cache.size >= 64) cache.delete(cache.keys().next().value);
    cache.set(extension, { promise, expires: now() + 5 * 60 * 1000 });
    try { return await promise; } catch (error) { cache.delete(extension); throw error; }
  }
  return {
    async list(sender, extension, getIcon) {
      if (platform !== 'win32' || !sender || !/^\.[a-z0-9]{1,12}$/.test(extension)) return [];
      const rows = await discover(extension, getIcon);
      const previous = presented.get(sender) ?? new Map();
      previous.set(extension, rows); presented.set(sender, previous);
      return rows.map(({ name, icon }, index) => ({ index, name, icon }));
    },
    async open(sender, extension, index, file) {
      if (platform !== 'win32' || !Number.isInteger(index) || index < 0 || index > 3) throw new Error('앱 목록을 다시 열어 선택해 주세요.');
      const app = presented.get(sender)?.get(extension)?.[index];
      const executable = app && await verify(app.executable);
      if (!executable || executable.toLowerCase() !== app.executable.toLowerCase()) throw new Error('프로그램이 변경됐거나 없습니다. 다른 앱 선택을 이용해 주세요.');
      await new Promise((resolve, reject) => {
        const child = spawnProcess(executable, [file], { shell: false, windowsHide: true, stdio: 'ignore' });
        child.once('error', reject);
        child.once('spawn', () => { child.unref(); resolve(); });
      });
    },
  };
}

export const documentAppRegistry = createDocumentAppRegistry();
