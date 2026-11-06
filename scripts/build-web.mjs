import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const version = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
const child = spawnSync(process.execPath, ['apps/modycrew-web/node_modules/next/dist/bin/next', 'build', '--webpack', 'apps/modycrew-web'], { stdio: 'inherit', shell: false, windowsHide: true, env: { ...process.env, NEXT_PUBLIC_APP_VERSION: version } });
if (child.error) throw child.error;
process.exit(child.status ?? 1);
