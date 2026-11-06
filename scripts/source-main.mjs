import { app } from 'electron';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
const data = path.resolve(process.env.MODYCREW_SOURCE_PROFILE || path.join(os.homedir(), '.modycrew-source'));
mkdirSync(data, { recursive: true });
app.setPath('userData', data);
process.env.MODYCREW_SOURCE_EDITION = '1';
await import('../apps/modycrew-desktop/src/main/main.mjs');
