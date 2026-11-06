import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

export async function nativeOffice(request, { timeoutMs = 45000 } = {}) {
  if (process.platform !== 'win32') throw new Error('설치된 Windows Office 프로그램이 필요한 작업입니다.');
  const folder = await mkdtemp(path.join(tmpdir(), 'modycrew-document-'));
  const requestPath = path.join(folder, 'request.json');
  const resultPath = path.join(folder, 'result.json');
  const progressPath = path.join(folder, 'progress.json');
  const processPath = path.join(folder, 'process.json');
  // PowerShell cannot read Electron's virtual app.asar paths. Stage our bundled
  // script in this private operation folder; never execute a renderer-supplied script.
  const helperPath = path.join(folder, 'native-office.ps1');
  await writeFile(helperPath, await readFile(new URL('./native-office.ps1', import.meta.url)));
  await writeFile(requestPath, JSON.stringify({ ...request, ...(request.input ? { input: path.resolve(request.input) } : {}), ...(request.output ? { output: path.resolve(request.output) } : {}), resultPath, progressPath, processPath }), 'utf8');
  try {
    await new Promise((resolve, reject) => {
      const env = { ...process.env }; for (const key of Object.keys(env)) if (key.toLowerCase() === 'psmodulepath') delete env[key];
      const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File', helperPath, '-RequestPath', requestPath], { windowsHide: true, stdio: 'ignore', env });
      let doneAt = 0; let settled = false;
      const stopOwnedProcess = async () => {
        child.kill();
        try { const owner = JSON.parse((await readFile(processPath, 'utf8')).replace(/^\uFEFF/u, '')); if (Number.isInteger(owner.pid) && ['Hwp', 'WINWORD', 'POWERPNT'].includes(owner.process)) process.kill(owner.pid); } catch { /* An already exited process needs no cleanup. */ }
      };
      const finish = (error) => { if (settled) return; settled = true; clearTimeout(timer); clearInterval(poll); error ? reject(error) : resolve(); };
      const timer = setTimeout(async () => {
        await stopOwnedProcess();
        let stage = ''; try { stage = JSON.parse((await readFile(progressPath, 'utf8')).replace(/^\uFEFF/u, '')).stage || ''; } catch {}
        finish(new Error(`Office 응답 시간이 초과됐습니다${stage ? ` (${stage})` : ''}. 파일 접근 알림을 확인하고 다시 시도해 주세요. 원본은 변경하지 않았습니다.`));
      }, timeoutMs);
      const poll = setInterval(async () => {
        try {
          const saved = JSON.parse((await readFile(resultPath, 'utf8')).replace(/^\uFEFF/u, ''));
          if (!saved.stage && !doneAt) doneAt = Date.now();
          // Some Office versions retain a COM reference after successful export.
          // Only this newly created application's window PID may be terminated.
          if (doneAt && Date.now() - doneAt > 4000) { await stopOwnedProcess(); finish(); }
        } catch { /* The result appears atomically when the operation is complete. */ }
      }, 200);
      child.once('error', finish);
      child.once('exit', () => finish());
    });
    const result = JSON.parse((await readFile(resultPath, 'utf8')).replace(/^\uFEFF/u, ''));
    if (result.error) throw new Error(result.error);
    if (result.stage) throw new Error(`Office 문서 작업이 완료되지 않았습니다 (${result.stage}).`);
    return result;
  } finally { await rm(folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
}

export async function nativeCapabilities() {
  if (process.platform !== 'win32') return { hwp: false, word: false, powerpoint: false };
  try {
    const result = await nativeOffice({ action: 'probe' }, { timeoutMs: 10000 });
    return { hwp: result['HWPFrame.HwpObject'] === true, word: result['Word.Application'] === true, powerpoint: result['PowerPoint.Application'] === true };
  } catch { return { hwp: false, word: false, powerpoint: false }; }
}
