import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import path from 'node:path';

// OS가 실제 설치된 연결 프로그램을 나열한다. 앱 이름이나 실행 명령을 렌더러에서 받지 않는다.
export async function chooseDocumentApp(file, { platform = process.platform, windowsRoot = process.env.SystemRoot, spawnProcess = spawn } = {}) {
  if (platform !== 'win32' || !windowsRoot || !path.win32.isAbsolute(windowsRoot)) throw new Error('이 PC에서는 앱 선택을 지원하지 않습니다.');
  const executable = path.win32.join(windowsRoot, 'System32', 'OpenWith.exe');
  await access(executable);
  await new Promise((resolve, reject) => {
    const child = spawnProcess(executable, [file], { shell: false, windowsHide: true, stdio: 'ignore' });
    child.once('error', reject);
    child.once('spawn', () => { child.unref(); resolve(); });
  });
}
